import { describe, expect, it } from "vitest";
import { summarizeMastraRouteEvents } from "@/lib/mastra/planning/route-observability";

describe("Mastra route observability", () => {
  it("summarizes route decisions and guarded redirects", () => {
    const summary = summarizeMastraRouteEvents([
      {
        id: "event-1",
        event: "agent_chat_v2_routed",
        ok: true,
        confidence: 0.91,
        action: "workflow_agent",
        metadata: {
          requestedRoute: "workflow_agent",
          effectiveRoute: "workflow_agent",
          source: "llm",
          guarded: false,
          reason: "Clear generation request.",
        },
        created_at: "2026-05-06T00:00:00.000Z",
      },
      {
        id: "event-2",
        event: "agent_chat_v2_routed",
        ok: false,
        confidence: 0.41,
        action: "direct_chat",
        metadata: {
          requestedRoute: "workflow_agent",
          effectiveRoute: "direct_chat",
          source: "llm",
          guarded: true,
          reason: "Intent unclear.",
        },
        created_at: "2026-05-06T00:01:00.000Z",
      },
      {
        id: "event-3",
        event: "scheduled_agent_eval",
        ok: true,
      },
    ]);

    expect(summary.total).toBe(2);
    expect(summary.guarded).toBe(1);
    expect(summary.guardedRate).toBe(0.5);
    expect(summary.averageConfidence).toBe(0.66);
    expect(summary.requestedRoutes).toEqual({ workflow_agent: 2 });
    expect(summary.effectiveRoutes).toEqual({
      workflow_agent: 1,
      direct_chat: 1,
    });
    expect(summary.sources).toEqual({ llm: 2 });
    expect(summary.latest[0]).toMatchObject({
      id: "event-1",
      requestedRoute: "workflow_agent",
      effectiveRoute: "workflow_agent",
      guarded: false,
    });
  });

  it("returns an empty summary when there are no route events", () => {
    const summary = summarizeMastraRouteEvents([]);

    expect(summary.total).toBe(0);
    expect(summary.averageConfidence).toBeNull();
    expect(summary.requestedRoutes).toEqual({});
    expect(summary.latest).toEqual([]);
  });
});
