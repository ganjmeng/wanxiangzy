const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const SECRET_PAIR_PATTERN = /\b(authorization|api[_-]?key|access[_-]?key(?:id)?|secret|signature|security[_-]?token|token)\b\s*[:=]\s*([^\s,;]+)/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const OSS_QUERY_PATTERN = /\b(OSSAccessKeyId|Signature|security-token|x-oss-security-token)=([^&\s]+)/gi;

export class RetryableGenerationError extends Error {
  readonly code: string;

  constructor(message: string, code = "GENERATION_INFRASTRUCTURE_RETRYABLE", options?: { cause?: unknown }) {
    super(sanitizeGenerationErrorMessage(message), options);
    this.name = "RetryableGenerationError";
    this.code = code;
  }
}

/**
 * The provider request may have been accepted, but the local process did not
 * durably receive/bind an upstream task id. Retrying automatically can create
 * a second billable generation, so this outcome must stop in needs_review.
 */
export class GenerationSubmissionOutcomeUnknownError extends Error {
  readonly code = "GENERATION_SUBMISSION_OUTCOME_UNKNOWN";

  constructor(message = "上游任务提交结果未知，需要人工确认", options?: { cause?: unknown }) {
    super(sanitizeGenerationErrorMessage(message), options);
    this.name = "GenerationSubmissionOutcomeUnknownError";
  }
}

export function isGenerationSubmissionOutcomeUnknownError(
  error: unknown,
): error is GenerationSubmissionOutcomeUnknownError {
  if (error instanceof GenerationSubmissionOutcomeUnknownError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === "GenerationSubmissionOutcomeUnknownError"
    || candidate.code === "GENERATION_SUBMISSION_OUTCOME_UNKNOWN";
}

/** A provider/customer decision that must never enter a retry budget. */
export class NonRetryableGenerationError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, code = "GENERATION_TERMINAL", status?: number) {
    super(sanitizeGenerationErrorMessage(message));
    this.name = "NonRetryableGenerationError";
    this.code = code;
    this.status = status;
  }
}

/**
 * A completed HTTP response from an image provider. Unlike a network error,
 * this proves that the provider returned a decision and lets the router make
 * a conservative failover decision without parsing an error message.
 */
export class ProviderHttpResponseError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfterSeconds?: number;
  readonly providerRequestId?: string;
  readonly safeToFailover: boolean;

  constructor(message: string, options: {
    status: number;
    code?: string;
    retryAfterSeconds?: number;
    providerRequestId?: string;
    safeToFailover?: boolean;
  }) {
    super(sanitizeGenerationErrorMessage(message));
    this.name = "ProviderHttpResponseError";
    this.status = options.status;
    this.code = options.code;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.providerRequestId = options.providerRequestId;
    this.safeToFailover = options.safeToFailover === true;
  }
}

export function isProviderHttpResponseError(error: unknown): error is ProviderHttpResponseError {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: unknown;
    status?: unknown;
    safeToFailover?: unknown;
  };
  return candidate.name === "ProviderHttpResponseError"
    && Number.isInteger(candidate.status)
    && Number(candidate.status) >= 400
    && Number(candidate.status) <= 599
    && typeof candidate.safeToFailover === "boolean";
}

/**
 * The database has already moved this execution to a newer delivery fence.
 * This is an expected race between a stale worker and recovery, not a job
 * failure that BullMQ should retry.
 */
export class StaleExecutionFenceError extends Error {
  readonly code = "STALE_EXECUTION_FENCE";

  constructor(message = "STALE_EXECUTION_FENCE", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StaleExecutionFenceError";
  }
}

export function isStaleExecutionFenceError(error: unknown) {
  if (error instanceof StaleExecutionFenceError) return true;
  if (!error || typeof error !== "object") return false;

  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  return code === "STALE_EXECUTION_FENCE"
    || code === "40001"
    || message.includes("stale_execution_fence")
    || message.includes("execution fence")
    || message.includes("任务执行租约已丢失");
}
export function sanitizeGenerationErrorMessage(value: unknown, fallback = "生成服务暂时不可用", maxLength = 500) {
  const raw = value instanceof Error ? value.message : typeof value === "string" ? value : String(value ?? "");
  const sanitized = raw
    .replace(URL_PATTERN, "[redacted-url]")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(SECRET_PAIR_PATTERN, (_match, key: string) => `${key}=[redacted]`)
    .replace(OSS_QUERY_PATTERN, (_match, key: string) => `${key}=[redacted]`);
  return (replaceControlCharacters(sanitized) || fallback).slice(0, Math.max(1, maxLength));
}

function replaceControlCharacters(value: string) {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("").replace(/\s+/g, " ").trim();
}

export function isRetryableGenerationError(error: unknown) {
  if (isStaleExecutionFenceError(error)) return false;
  if (isGenerationSubmissionOutcomeUnknownError(error)) return false;
  if (error instanceof NonRetryableGenerationError) return false;
  if (error instanceof RetryableGenerationError) return true;
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    name?: unknown;
    code?: unknown;
    retryable?: unknown;
    status?: unknown;
    message?: unknown;
  };
  const status = Number(candidate.status);
  // An explicit retryable flag must never override a terminal HTTP decision.
  // This protects policy/validation responses such as 451 from being retried
  // by a provider adapter that copied an overly broad retryable flag.
  if (status >= 400 && status < 500 && status !== 408 && status !== 425 && status !== 429) return false;
  if (status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)) return true;
  if (candidate.retryable === true) return true;
  if (candidate.name === "AbortError" || candidate.name === "TimeoutError") return true;

  const code = typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
  if (/^(ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR_|REDIS_|SUPABASE_)/.test(code)) return true;

  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  return (
    /\b(408|425|429|500|502|503|504)\b/.test(message)
    || message.includes("timeout")
    || message.includes("timed out")
    || message.includes("connection reset")
    || message.includes("connection refused")
    || message.includes("econnreset")
    || message.includes("econnrefused")
    || message.includes("enotfound")
    || message.includes("eai_again")
    || message.includes("fetch failed")
    || message.includes("network error")
    || message.includes("service unavailable")
    || message.includes("bad gateway")
    || message.includes("gateway timeout")
    || message.includes("registry is unavailable")
    || message.includes("任务执行心跳失败")
    || message.includes("任务执行租约已丢失")
    || message.includes("更新任务进度失败")
    || message.includes("任务完成结算失败")
    || message.includes("模型容量排队失败")
    || message.includes("生成任务状态同步失败")
    || message.includes("durably stored")
    || message.includes("oss mirror")
  );
}
