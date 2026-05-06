import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rate-limit";
import { extractPreferencePatchFromFeedback, upsertAgentUserPreferences } from "@/lib/agent/brain/preferences";
import { getAgentFeatureFlags } from "@/lib/agent/brain/feature-flags";
import { recordAgentMetric } from "@/lib/agent/brain/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FeedbackRating = "good" | "bad";

export async function POST(request: NextRequest) {
  const started = Date.now();
  const auth = await requireApiUser();
  if (auth.response) return auth.response;

  const flags = getAgentFeatureFlags(auth.user.id);
  if (!flags.feedback) {
    return NextResponse.json({ error: "反馈功能当前未开启" }, { status: 404 });
  }

  const limit = await checkRateLimit(`agent-feedback:${auth.user.id}`, 60, 60_000);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSeconds);

  const body = await request.json().catch(() => ({}));
  const rating = normalizeRating(body.rating);
  if (!rating) return NextResponse.json({ error: "rating must be good or bad" }, { status: 400 });

  const conversationId = stringOrNull(body.conversationId);
  const messageId = stringOrNull(body.messageId);
  const traceId = stringOrNull(body.traceId);
  const messageExcerpt = stringOrNull(body.messageExcerpt) ?? stringOrNull(body.userText);
  const assistantExcerpt = stringOrNull(body.assistantExcerpt) ?? stringOrNull(body.assistantText);
  const imageUrls = normalizeImageUrls(body.imageUrls ?? body.images);
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 800) : "";
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((tag: unknown): tag is string => typeof tag === "string" && tag.trim().length > 0).slice(0, 12)
    : [];

  const trace = traceId ? await loadTrace(auth.supabase, auth.user.id, traceId) : null;
  const evalCase = rating === "bad"
    ? buildEvalCase({ trace, rating, reason, tags, messageExcerpt, assistantExcerpt, imageUrls })
    : null;
  const preferencePatch = extractPreferencePatchFromFeedback({ rating, reason, tags });

  const { error } = await auth.supabase
    .from("agent_feedback")
    .insert({
      user_id: auth.user.id,
      conversation_id: conversationId,
      message_id: messageId,
      trace_id: traceId,
      rating,
      reason: reason || null,
      tags,
      feedback: {
        userAgent: request.headers.get("user-agent") || null,
        traceFinal: trace?.trace?.final || null,
        messageExcerpt,
        assistantExcerpt,
        imageUrls,
      },
      eval_case: evalCase,
    });

  if (error) {
    return NextResponse.json({
      error: "反馈表尚未就绪，请先运行 supabase/agent-brain-traces.sql。",
      detail: error.message,
    }, { status: 503 });
  }

  if (rating === "bad" && hasPreferencePatch(preferencePatch)) {
    void upsertAgentUserPreferences(auth.user.id, preferencePatch, "feedback");
  }

  void recordAgentMetric({
    userId: auth.user.id,
    conversationId,
    traceId,
    event: "agent_feedback",
    route: "/api/agent/feedback",
    ok: true,
    latencyMs: Date.now() - started,
    action: rating,
    metadata: { tags, learned: hasPreferencePatch(preferencePatch) },
  });

  return NextResponse.json({ ok: true, learned: hasPreferencePatch(preferencePatch), preferencePatch });
}

async function loadTrace(
  supabase: { from: (table: string) => unknown },
  userId: string,
  traceId: string
) {
  const query = supabase.from("agent_brain_traces") as {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => PromiseLike<{ data: TraceRow | null; error: { message: string } | null }>;
        };
      };
    };
  };
  const { data, error } = await query
    .select("*")
    .eq("user_id", userId)
    .eq("id", traceId)
    .maybeSingle();
  if (error) {
    console.warn("[agent-feedback] trace lookup skipped:", error.message);
    return null;
  }
  return data;
}

type TraceRow = {
  id: string;
  message_excerpt?: string | null;
  action?: string | null;
  module?: string | null;
  confidence?: number | null;
  source?: string | null;
  trace?: Record<string, unknown> | null;
};

function buildEvalCase(params: {
  trace: TraceRow | null;
  rating: FeedbackRating;
  reason: string;
  tags: string[];
  messageExcerpt: string | null;
  assistantExcerpt: string | null;
  imageUrls: string[];
}) {
  const userText = params.trace?.message_excerpt || params.messageExcerpt || "";
  return {
    id: `feedback-${params.trace?.id || Date.now()}`,
    title: params.reason ? params.reason.slice(0, 80) : "用户标记 Agent 判断不符合预期",
    request: {
      userText,
      intentMode: "smart",
      images: params.imageUrls.map((url, index) => ({
        index: index + 1,
        url,
        role: "source",
      })),
    },
    observed: {
      action: params.trace?.action || null,
      module: params.trace?.module || null,
      confidence: params.trace?.confidence || null,
      source: params.trace?.source || null,
      assistantExcerpt: params.assistantExcerpt,
    },
    feedback: {
      rating: params.rating,
      reason: params.reason || null,
      tags: params.tags,
      assistantExcerpt: params.assistantExcerpt,
    },
    expectedBehavior: inferExpectedBehavior(`${params.reason}\n${params.tags.join("\n")}`),
    trace: params.trace?.trace || null,
  };
}

function inferExpectedBehavior(text: string) {
  if (/详情页|淘宝|天猫|京东/.test(text)) return "应识别为电商详情页/长图任务，不要误判为种草图。";
  if (/比例|画幅|构图/.test(text)) return "应尊重用户指定比例、画幅或构图。";
  if (/换脸|不像|身份/.test(text)) return "应保持人物身份、脸部一致性和身体比例。";
  if (/自由发挥|死板|随机/.test(text)) return "应在用户边界内让 AI 自主创作，不套固定模板。";
  return "应根据用户原始目标重新判断，而不是复用错误链路。";
}

function hasPreferencePatch(patch: Record<string, unknown>) {
  return Object.values(patch).some((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value && typeof value === "object" ? Object.keys(value).length : value)
  );
}

function normalizeRating(value: unknown): FeedbackRating | null {
  return value === "good" || value === "bad" ? value : null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeImageUrls(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      return typeof record.url === "string"
        ? record.url
        : typeof record.hostedUrl === "string"
          ? record.hostedUrl
          : "";
    })
    .filter((url): url is string => /^https?:\/\//i.test(url))
    .slice(0, 8);
}
