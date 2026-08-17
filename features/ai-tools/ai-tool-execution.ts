import {
  createScaledOutpaintSourceRect,
  type FrameRect,
} from "@/components/studio/image-editor/frame-geometry";

export const AI_TOOL_TARGET_MAX_EDGE = 5_120;
export const AI_TOOL_TARGET_MAX_PIXELS = 32_000_000;
const AI_TOOL_TARGET_MIN_EDGE = 64;
const DEFAULT_RATE_LIMIT_DELAY_MS = 3_000;
const MAX_RATE_LIMIT_DELAY_MS = 65_000;
const DEFAULT_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RATE_LIMIT_WAIT_BUDGET_MS = 75_000;

export class AiToolBatchCancelledError extends Error {
  constructor() {
    super("批量处理已取消");
    this.name = "AiToolBatchCancelledError";
  }
}

export type JsonHttpResult<T> = {
  response: Response;
  data: T;
};

export function isAiToolReferenceFresh(
  reference: { expiresAt: string } | undefined,
  now = Date.now(),
  safetyWindowMs = 60_000,
) {
  if (!reference) return false;
  const expiresAt = Date.parse(reference.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt - safetyWindowMs > now;
}

export async function requestJsonWithRateLimitRetry<T>(
  request: (signal: AbortSignal) => Promise<Response>,
  options: {
    signal: AbortSignal;
    maxRetries?: number;
    maxTotalDelayMs?: number;
    onRateLimit?: (seconds: number, attempt: number) => void;
    sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    now?: () => number;
  },
): Promise<JsonHttpResult<T>> {
  const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? DEFAULT_RATE_LIMIT_RETRIES));
  const maxTotalDelayMs = Math.max(0, options.maxTotalDelayMs ?? DEFAULT_RATE_LIMIT_WAIT_BUDGET_MS);
  const sleep = options.sleep || abortableDelay;
  const now = options.now || Date.now;
  let waitedMs = 0;

  for (let attempt = 0; ; attempt += 1) {
    throwIfAiToolBatchCancelled(options.signal);
    let response: Response;
    try {
      response = await request(options.signal);
    } catch (error) {
      if (options.signal.aborted || isAbortLikeError(error)) throw new AiToolBatchCancelledError();
      throw error;
    }
    const data = await response.json().catch(() => ({})) as T;
    if (response.status !== 429 || attempt >= maxRetries) return { response, data };

    const retryAfterMs = parseRetryAfterMs(response, data, now());
    if (waitedMs + retryAfterMs > maxTotalDelayMs) return { response, data };
    waitedMs += retryAfterMs;
    options.onRateLimit?.(Math.ceil(retryAfterMs / 1000), attempt + 1);
    await sleep(retryAfterMs, options.signal);
  }
}

export function dimensionsForAiToolAspect(value: string, width: number, height: number) {
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match) return { width, height };
  const ratio = Number(match[1]) / Number(match[2]);
  if (!Number.isFinite(ratio) || ratio <= 0) return { width, height };

  const desiredArea = Math.max(800 * 800, positiveDimension(width) * positiveDimension(height));
  const maxAreaForWidth = AI_TOOL_TARGET_MAX_EDGE ** 2 / ratio;
  const maxAreaForHeight = AI_TOOL_TARGET_MAX_EDGE ** 2 * ratio;
  const area = Math.min(
    desiredArea,
    AI_TOOL_TARGET_MAX_PIXELS,
    maxAreaForWidth,
    maxAreaForHeight,
  );
  return {
    width: floorToEight(Math.sqrt(area * ratio)),
    height: floorToEight(Math.sqrt(area / ratio)),
  };
}

export function dimensionsForAiToolOutpaintAspect(
  value: string,
  sourceWidth: number,
  sourceHeight: number,
) {
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match) return scaleDimensionsWithinLimits(sourceWidth, sourceHeight, 2);
  const ratio = Number(match[1]) / Number(match[2]);
  if (!Number.isFinite(ratio) || ratio <= 0) return scaleDimensionsWithinLimits(sourceWidth, sourceHeight, 2);

  const preferredWidth = positiveDimension(sourceWidth) * 2;
  return scaleDimensionsWithinLimits(preferredWidth, preferredWidth / ratio, 1);
}

export function resolveAiToolOutpaintSourceScale(input: {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  sourceRect?: FrameRect;
}) {
  if (input.sourceRect) return input.sourceRect.width / input.sourceWidth;
  const defaultRect = createScaledOutpaintSourceRect(
    { width: input.sourceWidth, height: input.sourceHeight },
    { width: input.targetWidth, height: input.targetHeight },
    { x: 0.5, y: 0.5 },
  );
  return defaultRect.width / input.sourceWidth;
}

export function getAiToolTargetDimensionError(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < AI_TOOL_TARGET_MIN_EDGE || height < AI_TOOL_TARGET_MIN_EDGE) {
    return "输出宽高不能小于 64px";
  }
  if (
    width > AI_TOOL_TARGET_MAX_EDGE
    || height > AI_TOOL_TARGET_MAX_EDGE
    || width * height > AI_TOOL_TARGET_MAX_PIXELS
  ) {
    return "输出尺寸单边不能超过 5120px，且总像素不能超过 3200 万";
  }
  return undefined;
}

function scaleDimensionsWithinLimits(width: number, height: number, preferredScale: number) {
  const safeWidth = positiveDimension(width);
  const safeHeight = positiveDimension(height);
  const scale = Math.min(
    preferredScale,
    AI_TOOL_TARGET_MAX_EDGE / safeWidth,
    AI_TOOL_TARGET_MAX_EDGE / safeHeight,
    Math.sqrt(AI_TOOL_TARGET_MAX_PIXELS / (safeWidth * safeHeight)),
  );
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

export function throwIfAiToolBatchCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new AiToolBatchCancelledError();
}

export function isAiToolBatchCancelled(error: unknown, signal?: AbortSignal) {
  return Boolean(signal?.aborted) || error instanceof AiToolBatchCancelledError || isAbortLikeError(error);
}

export function waitForAiToolBatchDelay(milliseconds: number, signal: AbortSignal) {
  return abortableDelay(milliseconds, signal);
}

async function abortableDelay(milliseconds: number, signal: AbortSignal) {
  throwIfAiToolBatchCancelled(signal);
  await new Promise<void>((resolve, reject) => {
    const timeout = globalThis.setTimeout(finish, milliseconds);
    const onAbort = () => {
      globalThis.clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(new AiToolBatchCancelledError());
    };
    function finish() {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function parseRetryAfterMs(response: Response, data: unknown, now: number) {
  const header = response.headers.get("Retry-After")?.trim();
  let milliseconds = Number.NaN;
  if (header && /^\d+(?:\.\d+)?$/.test(header)) {
    milliseconds = Number(header) * 1000;
  } else if (header) {
    const retryAt = Date.parse(header);
    if (Number.isFinite(retryAt)) milliseconds = retryAt - now;
  }
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    const record = asRecord(data);
    const seconds = Number(record?.retry_after_seconds);
    milliseconds = Number.isFinite(seconds) && seconds > 0
      ? seconds * 1000
      : DEFAULT_RATE_LIMIT_DELAY_MS;
  }
  // A small boundary buffer avoids retrying inside the same fixed window.
  return Math.min(MAX_RATE_LIMIT_DELAY_MS, Math.max(1_000, Math.ceil(milliseconds) + 250));
}

function positiveDimension(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 800;
}

function floorToEight(value: number) {
  return Math.max(AI_TOOL_TARGET_MIN_EDGE, Math.floor(value / 8) * 8);
}

function isAbortLikeError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
    || error instanceof Error && error.name === "AbortError";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
