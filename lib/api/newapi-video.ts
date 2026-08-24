import {
  AI_VIDEO_DEFAULT_ASPECT_RATIO,
  normalizeAiVideoAudioMode,
  normalizeAiVideoFixedAspectRatio,
  type AiVideoAspectRatio,
  type AiVideoAudioMode,
} from "@/lib/ai-video";
import {
  clampVideoDuration,
  resolveUpstreamVideoModel,
} from "@/lib/api/video-catalog";
import type {
  NewApiVideoProviderConfig,
  VideoFirstLastFrameInput,
  VideoGenerationResult,
  VideoImageToVideoInput,
  VideoMotionControlInput,
  VideoTaskProgress,
  VideoTaskResume,
} from "@/lib/api/video-types";
import {
  GenerationSubmissionOutcomeUnknownError,
  isRetryableGenerationError,
  RetryableGenerationError,
  sanitizeGenerationErrorMessage,
} from "@/lib/api/generation-errors";

// Generic new.bi new-api "openai-video" gateway:
//   POST /v1/video/generations
//   GET  /v1/video/generations/{task_id}
// Used by both MiniMax H3 and Seedance 2.0. Resolution is chosen via the
// upstream model id from `lib/api/video-catalog.ts`.
const SUBMIT_PATH = "/v1/video/generations";
const QUERY_PATH = "/v1/video/generations";
const VIDEO_SUBMIT_PROGRESS_MAX = 10;
const VIDEO_POLL_INTERVAL_MS = 10_000;
const VIDEO_POLL_TIMEOUT_MS = 20 * 60 * 1000;

export async function generateNewApiImageToVideo(
  input: VideoImageToVideoInput,
  provider: NewApiVideoProviderConfig,
): Promise<VideoGenerationResult> {
  const model = resolveUpstreamVideoModel(provider.provider, input.modelMode, input.resolution);
  const prompt = buildPrompt(buildImageToVideoPrompt(input.prompt, input.aspectRatio), input.audioMode, input.audioPrompt);
  const body = buildTaskBody({
    model,
    prompt,
    image: input.imageUrl,
    duration: clampVideoDuration(provider.provider, input.duration),
  });

  const completed = await runTask(provider, body, input.onProgress, input.resumeTask, input.idempotencyKey, input.abortSignal);
  return toVideoResult(completed, prompt, body);
}

export async function generateNewApiMotionControl(
  input: VideoMotionControlInput,
  provider: NewApiVideoProviderConfig,
): Promise<VideoGenerationResult> {
  const model = resolveUpstreamVideoModel(provider.provider, input.modelMode, input.resolution);
  const prompt = buildPrompt(buildMotionControlPrompt(input.prompt || "", input.aspectRatio), input.audioMode, input.audioPrompt);
  const body = buildTaskBody({
    model,
    prompt,
    image: input.modelImageUrl,
    referenceVideo: input.referenceVideoUrl,
    duration: clampVideoDuration(provider.provider, input.duration),
  });

  const completed = await runTask(provider, body, input.onProgress, input.resumeTask, input.idempotencyKey, input.abortSignal);
  return toVideoResult(completed, prompt, body);
}

export async function generateNewApiFirstLastFrame(
  input: VideoFirstLastFrameInput,
  provider: NewApiVideoProviderConfig,
): Promise<VideoGenerationResult> {
  const model = resolveUpstreamVideoModel(provider.provider, input.modelMode, input.resolution);
  const prompt = buildPrompt(buildFirstLastFramePrompt(input.prompt, input.aspectRatio), input.audioMode, input.audioPrompt);
  const body = buildTaskBody({
    model,
    prompt,
    firstFrameImage: input.firstFrameUrl,
    lastFrameImage: input.lastFrameUrl,
    duration: clampVideoDuration(provider.provider, input.duration),
  });

  const completed = await runTask(provider, body, input.onProgress, input.resumeTask, input.idempotencyKey, input.abortSignal);
  return toVideoResult(completed, prompt, body);
}

function toVideoResult(completed: PollState, prompt: string, body: Record<string, unknown>): VideoGenerationResult {
  return {
    url: completed.urls[0],
    urls: completed.urls,
    taskId: completed.taskId,
    requestId: completed.requestId,
    providerStatus: completed.providerStatus,
    prompt,
    compiledPrompt: JSON.stringify(redactSignedUrls(body)),
    providerDetails: completed.providerDetails,
  };
}

function buildTaskBody(params: {
  model: string;
  prompt: string;
  image?: string;
  firstFrameImage?: string;
  lastFrameImage?: string;
  referenceVideo?: string;
  duration: number;
}) {
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    duration: params.duration,
  };
  if (params.image) body.image = params.image;
  if (params.firstFrameImage) body.first_frame_image = params.firstFrameImage;
  if (params.lastFrameImage) body.last_frame_image = params.lastFrameImage;
  if (params.referenceVideo) body.reference_video = params.referenceVideo;
  return body;
}

function buildPrompt(prompt: string, audioMode: AiVideoAudioMode, audioPrompt?: string | null) {
  const mode = normalizeAiVideoAudioMode(audioMode);
  const parts = [prompt];
  if (mode === "off") {
    // The new.bi gateway exposes no audio toggle for these models, so this is a
    // best-effort text hint rather than a hard guarantee.
    parts.push("声音要求：尽量生成安静画面，弱化背景音乐、人声和环境音。");
  } else if (mode === "custom" && audioPrompt?.trim()) {
    parts.push(`音效要求：${audioPrompt.trim()}`);
  }
  return parts.filter(Boolean).join("\n");
}

function buildImageToVideoPrompt(prompt: string, aspectRatio: AiVideoAspectRatio) {
  const trimmed = prompt.trim();
  return [
    trimmed,
    "以输入首帧图片作为人物、服装和画面风格参考，保持主体身份、服装结构、颜色、材质和比例一致。",
    "生成真实商业摄影风格的短视频，镜头稳定，动作自然，不添加字幕、水印或无关人物。",
    buildAspectRatioPrompt(aspectRatio),
  ].filter(Boolean).join("\n");
}

function buildMotionControlPrompt(prompt: string, aspectRatio: AiVideoAspectRatio) {
  const trimmed = prompt.trim();
  return [
    trimmed || "模仿参考视频里的动作和镜头运动，生成自然衔接的短视频。",
    "参考视频只提供动作和运镜参考，不要复制视频里的场景、人物身份或服装；输出画面以输入图片中的人物、服装和场景为准。",
    "保持人物身份、服装结构、颜色、材质和画面主体一致，动作幅度与参考视频一致，使用稳定商业摄影运镜，不添加字幕、水印、额外人物或无关物体。",
    buildAspectRatioPrompt(aspectRatio),
  ].filter(Boolean).join("\n");
}

function buildFirstLastFramePrompt(prompt: string, aspectRatio: AiVideoAspectRatio) {
  const trimmed = prompt.trim();
  return [
    trimmed || "根据首帧和尾帧生成顺滑过渡视频。",
    "首帧图片必须作为视频开头的主体参考，尾帧图片必须作为视频结尾的目标参考；中间过程自然衔接。",
    "保持人物身份、服装结构、颜色、材质和画面主体一致，使用稳定商业摄影运镜，不添加字幕、水印、额外人物或无关物体。",
    buildAspectRatioPrompt(aspectRatio),
  ].join("\n");
}

function buildAspectRatioPrompt(aspectRatio: AiVideoAspectRatio) {
  if (aspectRatio === "auto") {
    return "输出画面优先沿用输入图片的自然比例，主体自然铺满画面，不添加黑边、白边、留白边框或画中画式缩放。";
  }
  const fixed = normalizeAiVideoFixedAspectRatio(aspectRatio || AI_VIDEO_DEFAULT_ASPECT_RATIO);
  return `输出画面必须保持 ${fixed} 比例，主体铺满画面，不添加黑边、白边、留白边框或画中画式缩放。`;
}

type PollState = {
  taskId: string;
  requestId?: string;
  providerStatus: string;
  status: VideoTaskProgress["status"];
  progress: number;
  urls: string[];
  error?: string;
  providerDetails?: Record<string, unknown>;
};

async function runTask(
  provider: NewApiVideoProviderConfig,
  body: Record<string, unknown>,
  onProgress: VideoImageToVideoInput["onProgress"],
  resumeTask?: VideoTaskResume,
  idempotencyKey?: string,
  abortSignal?: AbortSignal,
): Promise<PollState> {
  const resumable = normalizeResumeTask(resumeTask);
  let taskId: string;
  let requestId: string | undefined;
  let providerStatus: string;

  if (resumable) {
    taskId = resumable.taskId;
    requestId = resumable.requestId;
    providerStatus = "RESUMING";
    await onProgress?.({
      taskId,
      requestId,
      status: "running",
      providerStatus,
      progress: VIDEO_SUBMIT_PROGRESS_MAX,
      providerDetails: buildProviderDetails({ taskId, requestId }),
    });
  } else {
    await onProgress?.({
      status: "queued",
      providerStatus: "SUBMITTING",
      progress: 1,
      providerDetails: buildProviderDetails({ requestBody: body }),
    });

    let submitted: unknown;
    try {
      submitted = await submitJson(
        `${provider.apiBase}${SUBMIT_PATH}`,
        provider.apiKey,
        body,
        normalizeIdempotencyKey(idempotencyKey),
        abortSignal,
      );
    } catch (error) {
      // A completed HTTP response is a known provider decision. A transport
      // failure after POST started is ambiguous: the provider may already have
      // accepted and billed the task, so automatic redelivery is unsafe.
      if (isAmbiguousSubmissionTransportError(error)) {
        throw new GenerationSubmissionOutcomeUnknownError(
          "视频任务提交连接中断，无法确认上游是否已创建任务",
          { cause: error },
        );
      }
      throw error;
    }
    const video = extractVideoObject(submitted) || {};
    taskId = typeof video.task_id === "string" && video.task_id ? video.task_id : extractTaskId(submitted);
    if (!taskId) throw new Error(`视频接口未返回 task_id，响应字段: ${describeResponseKeys(submitted)}`);

    requestId = extractRequestId(submitted);
    providerStatus = typeof video.status === "string" && video.status ? video.status : "queued";
    await onProgress?.({
      taskId,
      requestId,
      status: "queued",
      providerStatus,
      progress: VIDEO_SUBMIT_PROGRESS_MAX,
      providerDetails: buildProviderDetails({ requestBody: body, submitResponse: submitted, taskId, requestId }),
    });
  }

  const startedAt = Date.now();
  let lastState: PollState = {
    taskId,
    requestId,
    providerStatus,
    status: "queued",
    progress: VIDEO_SUBMIT_PROGRESS_MAX,
    urls: [],
  };

  while (Date.now() - startedAt < VIDEO_POLL_TIMEOUT_MS) {
    await sleep(VIDEO_POLL_INTERVAL_MS, abortSignal);
    const elapsed = Date.now() - startedAt;
    let json: unknown;
    try {
      json = await getJson(`${provider.apiBase}${QUERY_PATH}/${encodeURIComponent(taskId)}`, provider.apiKey, abortSignal);
    } catch (error) {
      if (!isRetryableGenerationError(error)) throw error;
      lastState = {
        ...lastState,
        status: "running",
        providerStatus: "PollingRetry",
        progress: Math.max(lastState.progress, Math.min(95, VIDEO_SUBMIT_PROGRESS_MAX + Math.round((elapsed / VIDEO_POLL_TIMEOUT_MS) * 85))),
        error: "",
      };
      await onProgress?.({
        taskId: lastState.taskId,
        requestId: lastState.requestId,
        status: lastState.status,
        providerStatus: lastState.providerStatus,
        progress: lastState.progress,
        urls: lastState.urls,
        error: "",
        providerDetails: lastState.providerDetails,
      });
      continue;
    }

    const state = normalizePollState(json, taskId, requestId);
    lastState = {
      ...state,
      progress: state.status === "completed"
        ? 100
        : state.status === "failed"
          ? Math.max(state.progress, 100)
          : Math.max(state.progress, Math.min(95, VIDEO_SUBMIT_PROGRESS_MAX + Math.round((elapsed / VIDEO_POLL_TIMEOUT_MS) * 85))),
    };

    await onProgress?.({
      taskId: lastState.taskId,
      requestId: lastState.requestId,
      status: lastState.status,
      providerStatus: lastState.providerStatus,
      progress: lastState.progress,
      urls: lastState.urls,
      error: lastState.error,
      providerDetails: lastState.providerDetails,
    });

    if (lastState.status === "completed" && lastState.urls.length) return lastState;
    if (lastState.status === "failed") {
      throw new Error(sanitizeGenerationErrorMessage(lastState.error, "视频生成失败"));
    }
  }

  throw new RetryableGenerationError(
    `视频任务已提交，轮询窗口结束，将从持久断点继续。task_id: ${lastState.taskId}`,
    "VIDEO_POLL_RESUME_REQUIRED",
  );
}

function isAmbiguousSubmissionTransportError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof candidate.name === "string" ? candidate.name : "";
  const code = typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  return name === "AbortError"
    || name === "TimeoutError"
    || /^(ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR_)/.test(code)
    || message.includes("fetch failed")
    || message.includes("network error")
    || message.includes("connection reset")
    || message.includes("timed out");
}

function normalizePollState(json: unknown, fallbackTaskId: string, fallbackRequestId: string | undefined): PollState {
  const video = extractVideoObject(json);
  const outerStatus = extractOuterStatus(json);
  const status = normalizeStatus(video?.status ?? outerStatus);
  const urls = extractVideoUrls(video) || extractVideoUrls(json);

  return {
    taskId: typeof video?.task_id === "string" && video.task_id ? video.task_id : fallbackTaskId,
    requestId: extractRequestId(json) || fallbackRequestId,
    providerStatus: (typeof video?.status === "string" && video.status) || outerStatus || "processing",
    status: status === "completed" ? "completed" : status === "failed" ? "failed" : "running",
    progress: typeof video?.progress === "number" ? video.progress : 0,
    urls,
    error: status === "failed" ? extractErrorMessage(json) : undefined,
    providerDetails: buildProviderDetails({ latestResponse: json, taskId: fallbackTaskId }),
  };
}

function normalizeStatus(value: unknown): "completed" | "failed" | "running" {
  const status = String(value ?? "").toLowerCase();
  if (["completed", "succeeded", "success", "successful", "done"].includes(status)) return "completed";
  if (["failed", "fail", "cancelled", "canceled", "error"].includes(status)) return "failed";
  return "running";
}

function extractOuterStatus(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  const data = record.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const outer = data as Record<string, unknown>;
    if (typeof outer.status === "string") return outer.status;
    if (typeof outer.progress === "string") return outer.progress;
  }
  return "";
}

function extractVideoObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractVideoObject(item);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.object === "video") return record;
  for (const entryValue of Object.values(record)) {
    const found = extractVideoObject(entryValue);
    if (found) return found;
  }
  return null;
}

function extractTaskId(value: unknown): string {
  const candidates = findValuesByKey(value, ["task_id", "id"]);
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

function extractRequestId(value: unknown): string | undefined {
  const candidates = findValuesByKey(value, ["request_id", "trace_id", "trace-id"]);
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function extractVideoUrls(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const direct = typeof record.video_url === "string" ? record.video_url : "";
  const output = record.output;
  const urls = new Set<string>();
  if (direct && /^https?:\/\//i.test(direct)) urls.add(direct);
  if (typeof output === "string" && /^https?:\/\//i.test(output)) urls.add(output);
  if (Array.isArray(output)) {
    for (const item of output) {
      if (typeof item === "string" && /^https?:\/\//i.test(item)) urls.add(item);
    }
  }
  // Fallback: http(s) URLs that look like video result files.
  walk(value, (entry, key) => {
    if (typeof entry !== "string" || !/^https?:\/\//i.test(entry)) return;
    const keyLooksVideo = /video_url|result_url|download_url|file_url|video/i.test(key || "");
    const valueLooksVideo = /\.(mp4|mov|webm|m4v)(?:$|[?#])/i.test(entry);
    if (keyLooksVideo || valueLooksVideo) urls.add(entry);
  });
  return [...urls];
}

function extractErrorMessage(value: unknown): string {
  const candidates = findValuesByKey(value, ["fail_reason", "error", "error_message", "message", "msg"]);
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() && !/^success$/i.test(candidate.trim())) {
      return candidate.trim();
    }
    if (candidate && typeof candidate === "object") {
      const nested = extractErrorMessage(candidate);
      if (nested) return nested;
    }
  }
  return "";
}

function findValuesByKey(value: unknown, keys: string[]) {
  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()));
  const values: unknown[] = [];
  walk(value, (entry, key) => {
    if (key && normalizedKeys.has(key.toLowerCase())) values.push(entry);
  });
  return values;
}

function walk(value: unknown, visit: (entry: unknown, key?: string) => void, key?: string) {
  visit(value, key);
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry) => walk(entry, visit));
    return;
  }
  for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
    walk(entryValue, visit, entryKey);
  }
}

function describeResponseKeys(value: unknown) {
  if (!value || typeof value !== "object") return typeof value;
  return Object.keys(value as Record<string, unknown>).slice(0, 12).join(", ") || "empty";
}

function buildProviderDetails(input: {
  requestBody?: Record<string, unknown>;
  submitResponse?: unknown;
  latestResponse?: unknown;
  taskId?: string;
  requestId?: string;
}) {
  const out: Record<string, unknown> = { platform: "newapi-video" };
  if (input.taskId) out.taskId = input.taskId;
  if (input.requestId) out.requestId = input.requestId;
  if (input.requestBody !== undefined) out.request = redactSignedUrls(input.requestBody);
  if (input.submitResponse !== undefined) out.submitResponse = redactSignedUrls(limitProviderDetail(input.submitResponse));
  if (input.latestResponse !== undefined) out.latestResponse = redactSignedUrls(limitProviderDetail(input.latestResponse));
  out.updatedAt = new Date().toISOString();
  return out;
}

function limitProviderDetail(value: unknown): unknown {
  const text = JSON.stringify(value);
  if (text.length <= 20_000) return value;
  return { truncated: true, preview: text.slice(0, 20_000) };
}

function redactSignedUrls(value: unknown): unknown {
  if (typeof value === "string") return redactSignedUrl(value);
  if (Array.isArray(value)) return value.map((item) => redactSignedUrls(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, redactSignedUrls(entry)]),
  );
}

function redactSignedUrl(value: string) {
  if (!/^https?:\/\//i.test(value) || !/[?&](OSSAccessKeyId|Signature|Expires)=/i.test(value)) return value;
  try {
    const url = new URL(value);
    url.searchParams.delete("OSSAccessKeyId");
    url.searchParams.delete("Expires");
    url.searchParams.delete("Signature");
    url.searchParams.delete("security-token");
    url.searchParams.set("signed", "redacted");
    return url.toString();
  } catch {
    return "[signed-url-redacted]";
  }
}

async function submitJson(url: string, apiKey: string, body: Record<string, unknown>, idempotencyKey?: string, abortSignal?: AbortSignal) {
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(apiKey, idempotencyKey),
    body: JSON.stringify(body),
    signal: combineAbortSignals(abortSignal, 60_000),
  });
  return readJsonResponse(response, "视频任务提交失败");
}

async function getJson(url: string, apiKey: string, abortSignal?: AbortSignal) {
  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(apiKey),
    signal: combineAbortSignals(abortSignal, 60_000),
  });
  return readJsonResponse(response, "视频任务查询失败");
}

async function readJsonResponse(response: Response, prefix: string) {
  const text = await response.text();
  if (!response.ok) {
    const message = `${prefix}: HTTP ${response.status}`;
    if (response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500) {
      throw new RetryableGenerationError(message, `VIDEO_PROVIDER_HTTP_${response.status}`);
    }
    throw new Error(message);
  }
  if (!text.trim()) throw new Error(`${prefix}: 响应为空`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${prefix}: 响应不是 JSON`);
  }
}

function buildHeaders(apiKey: string, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "Accept-Encoding": "identity",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return headers;
}

function normalizeResumeTask(value?: VideoTaskResume) {
  if (!value || !/^[A-Za-z0-9._-]{1,256}$/.test(value.taskId)) return null;
  const requestId = value.requestId && /^[A-Za-z0-9._-]{1,256}$/.test(value.requestId)
    ? value.requestId
    : undefined;
  return { taskId: value.taskId, requestId };
}

function normalizeIdempotencyKey(value?: string) {
  if (!value) return undefined;
  const normalized = value.trim();
  return /^[A-Za-z0-9._-]{8,200}$/.test(normalized) ? normalized : undefined;
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException("The operation was aborted", "AbortError"));
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason || new DOMException("The operation was aborted", "AbortError"));
    };
    const done = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    timer = setTimeout(done, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function combineAbortSignals(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (signal.aborted) return signal;
  return AbortSignal.any([signal, timeout]);
}
