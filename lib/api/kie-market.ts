import {
  GenerationSubmissionOutcomeUnknownError,
  NonRetryableGenerationError,
  ProviderHttpResponseError,
  RetryableGenerationError,
  sanitizeGenerationErrorMessage,
} from "@/lib/api/generation-errors";

const DEFAULT_SUBMIT_PATH = "/api/v1/jobs/createTask";
const DEFAULT_STATUS_PATH = "/api/v1/jobs/recordInfo";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 20 * 60_000;

export type KieMarketProgress = {
  taskId?: string;
  status: "queued" | "running" | "completed" | "failed";
  providerStatus: string;
  progress: number;
  urls?: string[];
  error?: string;
};

export type KieMarketTaskResult = {
  taskId: string;
  providerStatus: string;
  urls: string[];
  progress: number;
  rawResult?: Record<string, unknown>;
};

export async function runKieMarketTask(input: {
  apiBase: string;
  apiKey: string;
  model: string;
  modelInput: Record<string, unknown>;
  resumeTaskId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  pollIntervalMs?: number;
  submitPath?: string;
  statusPath?: string;
  onProgress?: (progress: KieMarketProgress) => Promise<void> | void;
}): Promise<KieMarketTaskResult> {
  const apiBase = normalizeApiBase(input.apiBase);
  const submitPath = normalizePath(input.submitPath || DEFAULT_SUBMIT_PATH);
  const statusPath = normalizePath(input.statusPath || DEFAULT_STATUS_PATH);
  const pollIntervalMs = boundedPositiveInteger(input.pollIntervalMs, getEnvNumber("KIE_MARKET_POLL_INTERVAL_MS", DEFAULT_POLL_INTERVAL_MS), 250, 60_000);
  const timeoutMs = boundedPositiveInteger(input.timeoutMs, getEnvNumber("KIE_MARKET_TASK_TIMEOUT_MS", DEFAULT_TIMEOUT_MS), 5_000, 45 * 60_000);

  let taskId = input.resumeTaskId?.trim() || "";
  if (!taskId) {
    await input.onProgress?.({ status: "queued", providerStatus: "SUBMITTING", progress: 1 });
    let response: unknown;
    try {
      response = await requestJson(`${apiBase}${submitPath}`, {
        method: "POST",
        headers: kieHeaders(input.apiKey),
        body: JSON.stringify({ model: input.model, input: input.modelInput }),
        signal: input.signal,
      }, true);
    } catch (error) {
      if (isAmbiguousTransportError(error)) {
        throw new GenerationSubmissionOutcomeUnknownError("Kie 任务提交连接中断，无法确认上游是否已创建任务", { cause: error });
      }
      throw error;
    }
    taskId = extractTaskId(response);
    if (!taskId) {
      throw new NonRetryableGenerationError(
        `Kie 创建任务成功但未返回 taskId，响应字段: ${describeKeys(response)}`,
        "KIE_TASK_ID_MISSING",
      );
    }
    await input.onProgress?.({ taskId, status: "queued", providerStatus: "waiting", progress: 2 });
  } else {
    await input.onProgress?.({ taskId, status: "running", providerStatus: "resuming", progress: 2 });
  }

  const startedAt = Date.now();
  let lastProgress = 2;
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(pollIntervalMs, input.signal);
    let response: unknown;
    try {
      const url = new URL(`${apiBase}${statusPath}`);
      url.searchParams.set("taskId", taskId);
      response = await requestJson(url.toString(), {
        method: "GET",
        headers: kieHeaders(input.apiKey, false),
        signal: input.signal,
      }, false);
    } catch (error) {
      if (!(error instanceof ProviderHttpResponseError) || !isRetryableStatus(error.status)) throw error;
      lastProgress = Math.max(lastProgress, elapsedProgress(startedAt, timeoutMs));
      await input.onProgress?.({ taskId, status: "running", providerStatus: `query_${error.status}`, progress: lastProgress });
      continue;
    }

    const record = extractTaskRecord(response);
    const providerStatus = String(record.state || "waiting").trim().toLowerCase();
    const urls = extractResultUrls(record.resultJson);
    const failed = providerStatus === "fail";
    const completed = providerStatus === "success" && urls.length > 0;
    lastProgress = completed
      ? 100
      : failed
        ? 100
        : Math.max(lastProgress, normalizeProgress(record.progress), elapsedProgress(startedAt, timeoutMs));
    const error = failed ? sanitizeGenerationErrorMessage(record.failMsg || record.failCode, "Kie 生成失败") : undefined;
    await input.onProgress?.({
      taskId,
      status: completed ? "completed" : failed ? "failed" : providerStatus === "waiting" || providerStatus === "queuing" ? "queued" : "running",
      providerStatus,
      progress: lastProgress,
      urls,
      error,
    });

    if (completed) {
      return { taskId, providerStatus, urls, progress: 100, rawResult: parseResultObject(record.resultJson) };
    }
    if (providerStatus === "success") {
      throw new NonRetryableGenerationError("Kie 任务已成功但未返回 resultUrls", "KIE_RESULT_URL_MISSING");
    }
    if (failed) {
      throw new NonRetryableGenerationError(error || "Kie 生成失败", String(record.failCode || "KIE_TASK_FAILED"));
    }
  }

  throw new RetryableGenerationError(
    `Kie 任务轮询窗口结束，将从任务断点继续。taskId: ${taskId}`,
    "KIE_TASK_POLL_RESUME_REQUIRED",
  );
}

async function requestJson(url: string, init: RequestInit, submitting: boolean): Promise<unknown> {
  const response = await fetch(url, init);
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new NonRetryableGenerationError("Kie API 返回了无效 JSON", "KIE_INVALID_JSON");
  }
  const apiCode = extractApiCode(json);
  if (!response.ok || (apiCode !== undefined && apiCode !== 200)) {
    const status = response.ok ? normalizeApiErrorStatus(apiCode) : response.status;
    throw new ProviderHttpResponseError(`Kie API 拒绝了${submitting ? "任务提交" : "状态查询"}（HTTP ${status}）`, {
      status,
      code: apiCode === undefined ? `KIE_HTTP_${status}` : `KIE_${apiCode}`,
      retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
      safeToFailover: submitting && [400, 401, 402, 403, 404, 422, 429].includes(status),
    });
  }
  return json;
}

function extractTaskId(value: unknown) {
  const root = asRecord(value);
  const data = asRecord(root.data);
  return typeof data.taskId === "string" ? data.taskId.trim() : "";
}

function extractTaskRecord(value: unknown) {
  const root = asRecord(value);
  return asRecord(root.data);
}

function extractResultUrls(value: unknown): string[] {
  const result = parseResultObject(value);
  return Array.isArray(result.resultUrls)
    ? result.resultUrls.filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url))
    : [];
}

function parseResultObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string" && value.trim()) {
    try { return asRecord(JSON.parse(value)); } catch { return {}; }
  }
  return asRecord(value);
}

function normalizeProgress(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(99, Math.max(0, Math.round(parsed)));
}

function elapsedProgress(startedAt: number, timeoutMs: number) {
  return Math.min(95, 2 + Math.round(((Date.now() - startedAt) / timeoutMs) * 93));
}

function extractApiCode(value: unknown) {
  const code = Number(asRecord(value).code);
  return Number.isFinite(code) ? code : undefined;
}

function normalizeApiErrorStatus(code: number | undefined) {
  if (code && code >= 400 && code <= 599) return code;
  return 502;
}

function parseRetryAfter(value: string | null) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(Math.ceil(seconds), 3600) : undefined;
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isAmbiguousTransportError(error: unknown) {
  if (!error || typeof error !== "object" || error instanceof ProviderHttpResponseError || error instanceof NonRetryableGenerationError) return false;
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  const name = String(candidate.name || "");
  const code = String(candidate.code || "").toUpperCase();
  const message = String(candidate.message || "").toLowerCase();
  return name === "AbortError"
    || name === "TimeoutError"
    || /^(ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR_)/.test(code)
    || message.includes("fetch failed")
    || message.includes("network error")
    || message.includes("connection reset")
    || message.includes("timed out");
}

function kieHeaders(apiKey: string, json = true): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function normalizeApiBase(value: string) {
  return value.trim().replace(/\/+$/, "").replace(/\/api\/v1$/i, "");
}

function normalizePath(value: string) {
  const path = value.trim();
  return path.startsWith("/") ? path : `/${path}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function describeKeys(value: unknown) {
  const keys = Object.keys(asRecord(value)).slice(0, 12);
  return keys.length ? keys.join(",") : "none";
}

function boundedPositiveInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function getEnvNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sleep(ms: number, signal?: AbortSignal) {
  if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(signal.reason || new DOMException("Aborted", "AbortError"));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
