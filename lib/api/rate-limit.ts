import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

const BUCKET_TABLE = "rate_limit_buckets";
const ONE_MINUTE_MS = 60_000;

export type ApiRateLimitPolicy = {
  bucket: string;
  limit: number;
  windowMs: number;
  label?: string;
};

export const API_RATE_LIMITS = {
  authLogin: { bucket: "auth-login", limit: 5, windowMs: ONE_MINUTE_MS, label: "登录" },
  authSignup: { bucket: "auth-signup", limit: 3, windowMs: ONE_MINUTE_MS, label: "注册" },
  tryonGenerate: { bucket: "tryon", limit: 20, windowMs: ONE_MINUTE_MS, label: "换装生成" },
  tryonClothingAnalyze: { bucket: "tryon-clothing-analyze", limit: 30, windowMs: ONE_MINUTE_MS, label: "服装分析" },
  tryonReferenceAnalyze: { bucket: "tryon-reference-analyze", limit: 60, windowMs: ONE_MINUTE_MS, label: "参考图分析" },
  poseVisualAnalyze: { bucket: "pose-visual-analyze", limit: 60, windowMs: ONE_MINUTE_MS, label: "姿势分析" },
  posePlan: { bucket: "pose-plan", limit: 60, windowMs: ONE_MINUTE_MS, label: "姿势规划" },
  tryonReferenceRecommendations: { bucket: "tryon-reference-recommendations", limit: 120, windowMs: ONE_MINUTE_MS, label: "参考图推荐" },
  conversationReadMutation: { bucket: "conversation-read-mutation", limit: 120, windowMs: ONE_MINUTE_MS, label: "对话读取" },
  conversationMutation: { bucket: "conversation-mutation", limit: 60, windowMs: ONE_MINUTE_MS, label: "对话操作" },
  messageMutation: { bucket: "message-mutation", limit: 120, windowMs: ONE_MINUTE_MS, label: "消息操作" },
  favoriteMutation: { bucket: "favorite-mutation", limit: 60, windowMs: ONE_MINUTE_MS, label: "收藏操作" },
  apiPlatformTestProxy: { bucket: "api-platform-test-proxy", limit: 5, windowMs: ONE_MINUTE_MS, label: "接口测试" },
  taskQueueRead: { bucket: "task-queue-read", limit: 120, windowMs: ONE_MINUTE_MS, label: "任务列表刷新" },
  historyRead: { bucket: "history-read", limit: 120, windowMs: ONE_MINUTE_MS, label: "历史记录读取" },
} as const satisfies Record<string, ApiRateLimitPolicy>;

function getRateLimitClient() {
  try {
    return getAdminClient();
  } catch {
    console.warn("[rate-limit] Supabase admin client unavailable");
    return null;
  }
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const supabase = getRateLimitClient();
  if (!supabase) {
    console.error("[rate-limit] admin client unavailable, failing open");
    return { ok: true };
  }

  const now = Date.now();
  const windowStart = now - windowMs;

  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_start: new Date(windowStart).toISOString(),
      p_now: new Date(now).toISOString(),
      p_window_ms: windowMs,
    });

    if (error) {
      console.error(
        "[rate-limit] rpc error, failing open:",
        error.message,
        (error as { cause?: unknown }).cause ?? ""
      );
      return { ok: true };
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (row?.allowed) return { ok: true };

    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((row?.retry_after_ms ?? windowMs) / 1000)),
    };
  } catch (err) {
    console.error("[rate-limit] unexpected error, failing open:", err);
    return { ok: true };
  }
}

export async function enforceApiRateLimit(userId: string, policy: ApiRateLimitPolicy) {
  const limit = await checkRateLimit(`${policy.bucket}:${userId}`, policy.limit, policy.windowMs);
  if (limit.ok) return null;
  return rateLimitResponse(limit.retryAfterSeconds, policy);
}

export function rateLimitResponse(
  retryAfterSeconds: number,
  options: { label?: string; limit?: number; windowMs?: number } = {}
) {
  const safeRetryAfter = Math.max(1, Math.ceil(retryAfterSeconds));
  const retryAfterLabel = formatRetryAfter(safeRetryAfter);
  const retryAfterText = retryAfterLabel.replace(/\s+/g, "");
  const label = options.label ? `${options.label}请求` : "请求";
  const policyHint = options.limit && options.windowMs
    ? `当前限制为 ${Math.max(1, Math.floor(options.windowMs / 1000))} 秒内最多 ${options.limit} 次。`
    : "";
  const error = `${label}过于频繁，请${retryAfterText}后再试。本次请求未执行；如果这是生成操作，不会扣除灵点。${policyHint}`;
  return NextResponse.json(
    {
      error,
      code: "RATE_LIMITED",
      retry_after_seconds: safeRetryAfter,
      retry_after_label: retryAfterLabel,
      limit: options.limit,
      window_seconds: options.windowMs ? Math.max(1, Math.floor(options.windowMs / 1000)) : undefined,
    },
    {
      status: 429,
      headers: { "Retry-After": String(safeRetryAfter) },
    }
  );
}

function formatRetryAfter(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} 分钟`;
}
