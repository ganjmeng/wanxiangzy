import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { toAISdkStream } from "@mastra/ai-sdk";
import { RequestContext } from "@mastra/core/request-context";
import { requireApiUser } from "@/lib/api/auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rate-limit";
import { getAgentV2Config } from "@/lib/agent-v2/config";
import {
  buildFallbackAgentReply,
  extractWorkflowImagesFromMessages,
  getLastAssistantMessageId,
  getLastUserText,
  getRecentConversationContext,
  normalizeUiMessages,
  prepareMessagesForMastra,
  writeTextToUiStream,
  writeWorkflowApprovalToolToUiStream,
} from "@/lib/agent-v2/ui-messages";
import {
  runLegacyBrainForAgentV2,
  toAgentV2Reply,
} from "@/lib/agent-v2/legacy-brain-adapter";
import {
  buildWorkflowApprovalInput,
  shouldCreateWorkflowApproval,
  type AgentV2WorkflowApprovalInput,
} from "@/lib/agent-v2/workflow-approval";
import { createOriginalMessagesPreservingStream } from "@/lib/agent-v2/ui-stream";
import { recordAgentMetric } from "@/lib/agent/brain/metrics";
import { saveAgentBrainTrace } from "@/lib/agent/brain/trace";
import { normalizeGenerationDefaults } from "@/lib/agent/workflow/request";
import { mastra } from "@/lib/mastra";
import {
  resolveMastraChatAgentRoute,
  routeMastraChat,
} from "@/lib/mastra/planning/chat-router";
import { saveMastraRouteTrace } from "@/lib/mastra/planning/route-trace";
import type { AgentBrainDecision } from "@/lib/agent/brain/types";
import type {
  GenerationDefaults,
  WorkflowInputImage,
} from "@/lib/agent/workflow/types";

export const maxDuration = 60;

type AgentUiContext = {
  mode: "agent" | "chat";
  speed: "Instant" | "Balanced" | "Deep";
  appModule:
    | "auto"
    | "image_analysis"
    | "image_create"
    | "tryon"
    | "pose_variation"
    | "ecommerce_detail"
    | "garment_3d"
    | "free_create";
};

export async function POST(req: Request) {
  const started = Date.now();
  const auth = await requireApiUser();
  if (auth.response) return auth.response;

  const limit = await checkRateLimit(
    `agent-chat-v2:${auth.user.id}`,
    40,
    60_000,
  );
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSeconds);

  const body = await req.json().catch(() => ({}));
  const messages = normalizeUiMessages(
    (body as { messages?: unknown }).messages,
  );
  const userText = getLastUserText(messages);
  const conversationId = getConversationId(body);
  const workflowImages = extractWorkflowImagesFromMessages(messages);
  const recentContext = getRecentConversationContext(messages, 80);
  const generationDefaults = normalizeGenerationDefaults(
    (body as { generationDefaults?: unknown }).generationDefaults,
  );
  const agentUiContext = normalizeAgentUiContext(
    (body as { agentUiContext?: unknown }).agentUiContext,
  );
  const config = getAgentV2Config();
  void touchConversationForLatestUserMessage({
    supabase: auth.supabase,
    userId: auth.user.id,
    conversationId,
    messages,
    userText,
  }).catch((error) => {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "agent_chat_v2_touch_conversation_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  });

  if (config.chatV2Enabled && config.runtimeProvider === "mastra") {
    try {
      const response = await streamMastraAgent({
        supabase: auth.supabase,
        messages,
        userId: auth.user.id,
        conversationId,
        userText,
        images: workflowImages,
        recentContext,
        defaults: generationDefaults,
        uiContext: agentUiContext,
        abortSignal: req.signal,
      });
      response.headers.set("X-Agent-Runtime", "mastra");
      response.headers.set("X-Agent-UI-Protocol", "ai-sdk-v6");
      void recordAgentMetric({
        userId: auth.user.id,
        conversationId,
        event: "agent_chat_v2_stream_started",
        route: "/api/agent/chat-v2",
        ok: true,
        latencyMs: Date.now() - started,
        metadata: {
          runtime: "mastra",
          imageCount: workflowImages.length,
          messageCount: messages.length,
          generationDefaults,
          agentUiContext,
        },
      });
      return response;
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "agent_chat_v2_mastra_failed",
          latency_ms: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  const useLegacyFallback = process.env.AGENT_ALLOW_LEGACY_FALLBACK === "1";
  const fallback =
    config.chatV2Enabled && useLegacyFallback
      ? await getAgentDecisionResult({
          userId: auth.user.id,
          conversationId,
          userText,
          messages,
          images: workflowImages,
          supabase: auth.supabase,
        })
      : { reply: buildFallbackAgentReply(userText), approval: null };

  const response = streamFallbackReply({
    messages,
    reply: fallback.reply,
    approval: fallback.approval,
  });
  response.headers.set(
    "X-Agent-Runtime",
    config.chatV2Enabled && useLegacyFallback
      ? "legacy-fallback"
      : "safe-fallback",
  );
  response.headers.set("X-Agent-UI-Protocol", "ai-sdk-v6");
  return response;
}

async function streamMastraAgent({
  supabase,
  messages,
  userId,
  conversationId,
  userText,
  images,
  recentContext,
  defaults,
  uiContext,
  abortSignal,
}: {
  supabase: Awaited<
    ReturnType<typeof import("@/lib/supabase/server").createServerSupabase>
  >;
  messages: ReturnType<typeof normalizeUiMessages>;
  userId: string;
  conversationId: string | null;
  userText: string;
  images: WorkflowInputImage[];
  recentContext: Array<{ role: string; content: string }>;
  defaults: GenerationDefaults;
  uiContext: AgentUiContext;
  abortSignal: AbortSignal;
}) {
  const requestContext = new RequestContext();
  const routeStarted = Date.now();
  const mastraMessages = prepareMessagesForMastra(messages);
  const chatRoute = await routeMastraChat({
    userText,
    images,
    recentContext,
    defaults,
    uiContext,
    abortSignal,
  });
  const resolvedRoute = resolveMastraChatAgentRoute(chatRoute, {
    userText,
    images,
    uiContext,
  });
  const routeLatencyMs = Date.now() - routeStarted;
  void saveMastraRouteTrace({
    supabase,
    userId,
    conversationId,
    userText,
    chatRoute,
    resolvedRoute,
    latencyMs: routeLatencyMs,
    imageCount: images.length,
    uiContext,
  });
  void recordAgentMetric({
    userId,
    conversationId,
    event: "agent_chat_v2_routed",
    route: "/api/agent/chat-v2",
    ok: !resolvedRoute.guarded,
    latencyMs: routeLatencyMs,
    action: resolvedRoute.effectiveRoute,
    confidence: chatRoute.confidence,
    metadata: {
      requestedRoute: chatRoute.route,
      effectiveRoute: resolvedRoute.effectiveRoute,
      source: chatRoute.source,
      reason: chatRoute.reason,
      guarded: resolvedRoute.guarded,
      guardReason: resolvedRoute.guardReason,
      imageCount: images.length,
      uiContext,
    },
  });
  requestContext.set("userId", userId);
  requestContext.set("conversationId", conversationId);
  requestContext.set("userText", userText);
  requestContext.set("images", images);
  requestContext.set("defaults", defaults);
  requestContext.set("uiContext", uiContext);
  requestContext.set("chatRoute", chatRoute);
  requestContext.set("resolvedRoute", resolvedRoute);

  const agent = mastra.getAgent(resolvedRoute.agentId);
  const agentStream = await agent.stream(mastraMessages, {
    abortSignal,
    maxSteps: resolvedRoute.maxSteps,
    requestContext,
    memory: conversationId
      ? {
          thread: conversationId,
          resource: userId,
        }
      : undefined,
    tracingContext: {
      currentSpan: undefined,
    },
  });

  const mastraStream = toAISdkStream(agentStream, {
    from: "agent",
    version: "v6",
    sendStart: true,
    sendFinish: true,
    sendReasoning: false,
    sendSources: true,
    lastMessageId: getLastAssistantMessageId(messages),
  });

  const uiStream = createOriginalMessagesPreservingStream<UIMessage>({
    originalMessages: messages,
    source: mastraStream,
    onError: (error) => (error instanceof Error ? error.message : "Mastra stream failed"),
  });

  const response = createUIMessageStreamResponse({ stream: uiStream });
  response.headers.set("X-Agent-Route", resolvedRoute.effectiveRoute);
  response.headers.set("X-Agent-Raw-Route", chatRoute.route);
  response.headers.set("X-Agent-Route-Confidence", String(chatRoute.confidence));
  response.headers.set("X-Agent-Route-Source", chatRoute.source);
  response.headers.set("X-Agent-Route-Guarded", String(resolvedRoute.guarded));
  return response;
}

function streamFallbackReply({
  messages,
  reply,
  approval,
}: {
  messages: ReturnType<typeof normalizeUiMessages>;
  reply: string;
  approval: AgentV2WorkflowApprovalInput | null;
}) {
  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: ({ writer }) => {
      writeTextToUiStream(writer, reply, { finish: false });
      if (approval) writeWorkflowApprovalToolToUiStream(writer, approval);
      writer.write({ type: "finish", finishReason: "stop" });
    },
    onError: (error) =>
      error instanceof Error ? error.message : "Agent v2 stream failed",
  });

  return createUIMessageStreamResponse({ stream });
}

async function getAgentDecisionResult({
  userId,
  conversationId,
  userText,
  messages,
  images,
  supabase,
}: {
  userId: string;
  conversationId: string | null;
  userText: string;
  messages: ReturnType<typeof normalizeUiMessages>;
  images: WorkflowInputImage[];
  supabase: Awaited<
    ReturnType<typeof import("@/lib/supabase/server").createServerSupabase>
  >;
}): Promise<{
  decision: AgentBrainDecision;
  reply: string;
  approval: AgentV2WorkflowApprovalInput | null;
}> {
  try {
    const decision = await runLegacyBrainForAgentV2({
      userId,
      conversationId,
      userText,
      messages,
      images: images.map((image) => ({
        index: image.index,
        url: image.url,
        role: image.role as never,
        fileName: image.fileName,
      })),
    });
    void saveAgentBrainTrace({
      supabase,
      userId,
      conversationId,
      message: userText,
      decision,
    });
    return {
      decision,
      reply: toAgentV2Reply(decision),
      approval: shouldCreateWorkflowApproval(decision)
        ? buildWorkflowApprovalInput(decision, userText)
        : null,
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "agent_chat_v2_legacy_fallback_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    const decision: AgentBrainDecision = {
      action: "chat",
      reply: buildFallbackAgentReply(userText),
      module: null,
      params: {},
      style: null,
      confidence: 0.3,
      missingFields: [],
      source: "fallback",
      visualTaskPlan: null,
      imageUnderstanding: null,
      safety: {
        allowed: true,
        requiresClarification: false,
        reasons: [],
        blockedModules: [],
      },
      trace: {
        id: crypto.randomUUID(),
        version: "agent-brain-v2",
        startedAt: new Date().toISOString(),
        events: [],
      },
    };
    return { decision, reply: decision.reply, approval: null };
  }
}

function getConversationId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const value = record.conversationId ?? record.id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeAgentUiContext(value: unknown): AgentUiContext {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    mode: readOption(record.mode, ["agent", "chat"] as const, "agent"),
    speed: readOption(record.speed, ["Instant", "Balanced", "Deep"] as const, "Instant"),
    appModule: readOption(
      record.appModule,
      [
        "auto",
        "image_analysis",
        "image_create",
        "tryon",
        "pose_variation",
        "ecommerce_detail",
        "garment_3d",
        "free_create",
      ] as const,
      "auto",
    ),
  };
}

function readOption<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
) {
  return typeof value === "string" && options.includes(value as T)
    ? value as T
    : fallback;
}

async function touchConversationForLatestUserMessage({
  supabase,
  userId,
  conversationId,
  messages,
  userText,
}: {
  supabase: Awaited<
    ReturnType<typeof import("@/lib/supabase/server").createServerSupabase>
  >;
  userId: string;
  conversationId: string | null;
  messages: ReturnType<typeof normalizeUiMessages>;
  userText: string;
}) {
  if (!conversationId) return;
  const lastUser = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  if (!lastUser || !userText.trim()) return;

  const { data: conversation } = await supabase
    .from("agent_conversations")
    .select("id,title")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .single();
  if (!conversation) return;

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (isUntitledConversation(conversation.title)) {
    updates.title =
      userText.length > 26 ? `${userText.slice(0, 26)}...` : userText;
  }

  await supabase
    .from("agent_conversations")
    .update(updates)
    .eq("id", conversationId)
    .eq("user_id", userId);
}

function isUntitledConversation(title: unknown) {
  const value = typeof title === "string" ? title.trim() : "";
  return (
    !value || value === "新对话" || value === "New chat" || value === "Untitled"
  );
}
