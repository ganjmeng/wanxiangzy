import { describe, expect, it, vi } from "vitest";
import {
  AI_TOOL_TARGET_MAX_EDGE,
  AI_TOOL_TARGET_MAX_PIXELS,
  AiToolBatchCancelledError,
  dimensionsForAiToolAspect,
  dimensionsForAiToolOutpaintAspect,
  resolveAiToolOutpaintSourceScale,
  getAiToolTargetDimensionError,
  isAiToolReferenceFresh,
  requestJsonWithRateLimitRetry,
} from "@/features/ai-tools/ai-tool-execution";

describe("AI tool expiring references", () => {
  it("refreshes a mask before its server-side expiry window", () => {
    const now = Date.parse("2026-08-17T12:00:00.000Z");

    expect(isAiToolReferenceFresh({ expiresAt: "2026-08-17T12:02:00.000Z" }, now)).toBe(true);
    expect(isAiToolReferenceFresh({ expiresAt: "2026-08-17T12:00:30.000Z" }, now)).toBe(false);
    expect(isAiToolReferenceFresh({ expiresAt: "invalid" }, now)).toBe(false);
  });
});

describe("AI tool batch request reliability", () => {
  it("honors Retry-After and lets the rate-limited 21st task continue", async () => {
    const controller = new AbortController();
    const request = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, { code: "RATE_LIMITED" }, { "Retry-After": "60" }))
      .mockResolvedValueOnce(jsonResponse(200, { status: "completed" }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onRateLimit = vi.fn();

    const result = await requestJsonWithRateLimitRetry<{ status?: string }>(request, {
      signal: controller.signal,
      sleep,
      onRateLimit,
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(60_250, controller.signal);
    expect(onRateLimit).toHaveBeenCalledWith(61, 1);
    expect(result.response.status).toBe(200);
    expect(result.data.status).toBe("completed");
  });

  it("bounds repeated rate-limit waiting instead of sleeping forever", async () => {
    const controller = new AbortController();
    const request = vi.fn().mockImplementation(() => jsonResponse(
      429,
      { retry_after_seconds: 60 },
    ));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await requestJsonWithRateLimitRetry(request, {
      signal: controller.signal,
      sleep,
      maxRetries: 4,
      maxTotalDelayMs: 70_000,
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(result.response.status).toBe(429);
  });

  it("cancels immediately during a Retry-After backoff", async () => {
    const controller = new AbortController();
    const request = vi.fn().mockResolvedValue(jsonResponse(429, {}, { "Retry-After": "60" }));

    await expect(requestJsonWithRateLimitRetry(request, {
      signal: controller.signal,
      onRateLimit: () => controller.abort(),
    })).rejects.toBeInstanceOf(AiToolBatchCancelledError);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("accepts an HTTP-date Retry-After value", async () => {
    const controller = new AbortController();
    const now = Date.UTC(2026, 7, 17, 12, 0, 0);
    const request = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, {}, {
        "Retry-After": new Date(now + 10_000).toUTCString(),
      }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await requestJsonWithRateLimitRetry(request, {
      signal: controller.signal,
      now: () => now,
      sleep,
    });

    expect(sleep).toHaveBeenCalledWith(10_250, controller.signal);
  });
});

describe("AI tool target dimensions", () => {
  it("matches the original 2x-width outpaint preset behavior", () => {
    const dimensions = dimensionsForAiToolOutpaintAspect("1:1", 1_280, 1_707);

    expect(dimensions).toEqual({ width: 2_560, height: 2_560 });
    expect(getAiToolTargetDimensionError(dimensions.width, dimensions.height)).toBeUndefined();
  });

  it("uses the same fitted source scale as the outpaint canvas before a transform is emitted", () => {
    const scale = resolveAiToolOutpaintSourceScale({
      sourceWidth: 1_280,
      sourceHeight: 1_707,
      targetWidth: 800,
      targetHeight: 800,
    });

    expect(1_280 * scale).toBeLessThanOrEqual(800);
    expect(1_707 * scale).toBeCloseTo(800);
  });

  it("keeps a 16:9 preset within edge and 32MP limits after a huge square", () => {
    const dimensions = dimensionsForAiToolAspect("16:9", 8_192, 8_192);

    expect(dimensions.width).toBeLessThanOrEqual(AI_TOOL_TARGET_MAX_EDGE);
    expect(dimensions.height).toBeLessThanOrEqual(AI_TOOL_TARGET_MAX_EDGE);
    expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(AI_TOOL_TARGET_MAX_PIXELS);
    expect(dimensions.width % 8).toBe(0);
    expect(dimensions.height % 8).toBe(0);
    expect(dimensions.width / dimensions.height).toBeCloseTo(16 / 9, 2);
    expect(getAiToolTargetDimensionError(dimensions.width, dimensions.height)).toBeUndefined();
  });

  it("reports manual edge and total-pixel violations", () => {
    expect(getAiToolTargetDimensionError(5_121, 1_000)).toContain("5120px");
    expect(getAiToolTargetDimensionError(8_000, 8_000)).toContain("3200 万");
    expect(getAiToolTargetDimensionError(64, 64)).toBeUndefined();
  });
});

function jsonResponse(status: number, body: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
