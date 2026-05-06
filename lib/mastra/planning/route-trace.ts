import { v4 } from "@/lib/store/uuid";
import type {
  MastraAgentUiContext,
  MastraChatAgentRoute,
  MastraChatRoute,
} from "@/lib/mastra/planning/chat-router";

type SupabaseLike = {
  from: (table: string) => {
    insert: (value: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  };
};

export function buildMastraRouteTracePayload(params: {
  userId: string;
  conversationId?: string | null;
  userText: string;
  chatRoute: MastraChatRoute;
  resolvedRoute: MastraChatAgentRoute;
  latencyMs: number;
  imageCount: number;
  uiContext?: MastraAgentUiContext;
}) {
  const now = new Date().toISOString();
  const action =
    params.resolvedRoute.effectiveRoute === "workflow_agent"
      ? "generate"
      : "chat";
  const trace = {
    id: v4(),
    version: "agent-brain-v2" as const,
    startedAt: now,
    finishedAt: now,
    latencyMs: Math.max(0, params.latencyMs),
    events: [
      {
        stage: "mastra_chat_router",
        status: params.resolvedRoute.guarded ? "warn" : "ok",
        summary: params.chatRoute.reason,
        latencyMs: Math.max(0, params.latencyMs),
        data: {
          requestedRoute: params.chatRoute.route,
          effectiveRoute: params.resolvedRoute.effectiveRoute,
          agentId: params.resolvedRoute.agentId,
          source: params.chatRoute.source,
          confidence: params.chatRoute.confidence,
          imageCount: params.imageCount,
          uiContext: params.uiContext || null,
        },
      },
      ...(params.resolvedRoute.guarded
        ? [
            {
              stage: "mastra_route_guard",
              status: "blocked" as const,
              summary:
                params.resolvedRoute.guardReason ||
                "Low-confidence workflow route was redirected to direct chat.",
              data: {
                requestedRoute: params.chatRoute.route,
                effectiveRoute: params.resolvedRoute.effectiveRoute,
                confidence: params.chatRoute.confidence,
              },
            },
          ]
        : []),
    ],
    final: {
      action,
      module: null,
      confidence: params.chatRoute.confidence,
      source: params.chatRoute.source,
    },
    flags: {
      runtime: "mastra",
      routedBy: "chat-router",
      guarded: params.resolvedRoute.guarded,
      uiContext: params.uiContext || null,
    },
  };

  return {
    id: trace.id,
    user_id: params.userId,
    conversation_id: params.conversationId || null,
    message_excerpt: params.userText.slice(0, 240),
    action,
    module: null,
    confidence: params.chatRoute.confidence,
    source: params.chatRoute.source,
    trace,
  };
}

export async function saveMastraRouteTrace(params: {
  supabase: unknown;
  userId: string;
  conversationId?: string | null;
  userText: string;
  chatRoute: MastraChatRoute;
  resolvedRoute: MastraChatAgentRoute;
  latencyMs: number;
  imageCount: number;
  uiContext?: MastraAgentUiContext;
}) {
  try {
    const client = params.supabase as SupabaseLike;
    const payload = buildMastraRouteTracePayload(params);
    const { error } = await client.from("agent_brain_traces").insert(payload);
    if (error) {
      console.warn("[mastra:route-trace] save skipped:", error);
    }
  } catch (error) {
    console.warn(
      "[mastra:route-trace] save failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
