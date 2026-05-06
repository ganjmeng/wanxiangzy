import { describe, expect, it } from "vitest";
import {
  agentEventTypeLabel,
  describeAgentLiveEvent,
  describeMastraRouteLiveEvent,
} from "@/lib/mastra/planning/route-live";

describe("Mastra route live labels", () => {
  it("describes direct chat routing", () => {
    expect(
      describeMastraRouteLiveEvent({
        event: "agent_chat_v2_routed",
        confidence: 0.93,
        metadata: {
          requestedRoute: "direct_chat",
          effectiveRoute: "direct_chat",
          guarded: false,
        },
      }),
    ).toBe("进入自然对话模式 · 93%");
  });

  it("describes workflow routing", () => {
    expect(
      describeMastraRouteLiveEvent({
        event: "agent_chat_v2_routed",
        confidence: 0.88,
        metadata: {
          requestedRoute: "workflow_agent",
          effectiveRoute: "workflow_agent",
          guarded: false,
        },
      }),
    ).toBe("已理解为可执行视觉任务，正在规划 · 88%");
  });

  it("describes guarded workflow redirects", () => {
    expect(
      describeMastraRouteLiveEvent({
        event: "agent_chat_v2_routed",
        confidence: 0.41,
        metadata: {
          requestedRoute: "workflow_agent",
          effectiveRoute: "direct_chat",
          guarded: true,
        },
      }),
    ).toBe("已留在聊天模式，避免误进工作流 · 41%");
  });

  it("ignores unrelated metric events", () => {
    expect(describeMastraRouteLiveEvent({ event: "scheduled_agent_eval" })).toBe("");
  });

  it("describes generic agent metric events", () => {
    expect(
      describeAgentLiveEvent({
        kind: "agent_metric",
        event: "agent_chat_v2_stream_started",
      }),
    ).toBe("正在回复");
  });

  it("describes workflow events with readable labels", () => {
    expect(
      describeAgentLiveEvent({
        kind: "workflow_event",
        type: "workflow_completed",
      }),
    ).toBe("任务完成");
  });

  it("describes brain trace decisions", () => {
    expect(
      describeAgentLiveEvent({
        kind: "brain_trace",
        action: "generate",
        module: "general",
      }),
    ).toBe("generate · general");
  });

  it("maps known event types to product labels", () => {
    expect(agentEventTypeLabel("workflow_queued")).toBe("已入队");
    expect(agentEventTypeLabel("quality_checked")).toBe("已复盘生成质量");
    expect(agentEventTypeLabel("step_retried")).toBe("已自动修正并重试");
    expect(agentEventTypeLabel("custom_event")).toBe("custom_event");
  });
});

