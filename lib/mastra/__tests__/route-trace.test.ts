import { describe, expect, it } from "vitest";
import { buildMastraRouteTracePayload } from "@/lib/mastra/planning/route-trace";

describe("Mastra route trace", () => {
  it("records guarded workflow routes as chat with a blocked guard event", () => {
    const payload = buildMastraRouteTracePayload({
      userId: "user-1",
      conversationId: "conversation-1",
      userText: "帮我看看这张图能做什么",
      chatRoute: {
        route: "workflow_agent",
        confidence: 0.42,
        reason: "Intent may be visual but execution is unclear.",
        source: "llm",
      },
      resolvedRoute: {
        agentId: "directChatAgent",
        effectiveRoute: "direct_chat",
        maxSteps: 1,
        guarded: true,
        guardReason: "Low confidence.",
      },
      latencyMs: 123,
      imageCount: 1,
    });

    expect(payload.action).toBe("chat");
    expect(payload.module).toBeNull();
    expect(payload.confidence).toBe(0.42);
    expect(payload.trace.final).toMatchObject({
      action: "chat",
      source: "llm",
    });
    expect(payload.trace.events.map((event) => event.stage)).toEqual([
      "mastra_chat_router",
      "mastra_route_guard",
    ]);
    expect(payload.trace.events[1]?.status).toBe("blocked");
  });

  it("records confident workflow routes as generate traces", () => {
    const payload = buildMastraRouteTracePayload({
      userId: "user-1",
      userText: "生成一套淘宝详情页",
      chatRoute: {
        route: "workflow_agent",
        confidence: 0.91,
        reason: "Clear ecommerce detail page generation request.",
        source: "llm",
      },
      resolvedRoute: {
        agentId: "mainAgent",
        effectiveRoute: "workflow_agent",
        maxSteps: 6,
        guarded: false,
      },
      latencyMs: 88,
      imageCount: 2,
    });

    expect(payload.action).toBe("generate");
    expect(payload.trace.events).toHaveLength(1);
    expect(payload.trace.events[0]?.data).toMatchObject({
      requestedRoute: "workflow_agent",
      effectiveRoute: "workflow_agent",
      agentId: "mainAgent",
      imageCount: 2,
    });
  });
});
