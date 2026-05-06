import { describe, expect, it } from "vitest";
import {
  buildAgentFeedbackContext,
  buildAgentFeedbackPayload,
  extractTraceIdFromMetadata,
} from "@/lib/agent-v2/feedback";

describe("agent-v2 feedback", () => {
  it("maps assistant-ui positive feedback to the agent feedback API shape", () => {
    const payload = buildAgentFeedbackPayload({
      conversationId: "conversation-1",
      messageId: "message-1",
      type: "positive",
    });

    expect(payload.rating).toBe("good");
    expect(payload.reason).toBe("结果符合预期");
    expect(payload.tags).toEqual(["assistant_ui", "quick_positive"]);
  });

  it("maps assistant-ui negative feedback to an eval-friendly payload", () => {
    const payload = buildAgentFeedbackPayload({
      conversationId: "conversation-1",
      messageId: "message-1",
      type: "negative",
      traceId: "trace-1",
      reason: "误判成种草图",
      tags: ["commerce", " detail-page ", ""],
    });

    expect(payload).toEqual({
      conversationId: "conversation-1",
      messageId: "message-1",
      traceId: "trace-1",
      rating: "bad",
      reason: "误判成种草图",
      tags: ["commerce", "detail-page"],
    });
  });

  it("extracts trace id from common assistant-ui metadata locations", () => {
    expect(extractTraceIdFromMetadata({ custom: { traceId: "trace-a" } })).toBe("trace-a");
    expect(extractTraceIdFromMetadata({ unstable_state: { trace_id: "trace-b" } })).toBe("trace-b");
    expect(extractTraceIdFromMetadata({ custom: {} })).toBeNull();
  });

  it("captures the previous user request for feedback eval cases", () => {
    const context = buildAgentFeedbackContext([
      {
        id: "user-1",
        role: "user",
        content: [
          { type: "text", text: "生成淘宝详情页" },
          { type: "image", image: "https://example.com/product.jpg" },
        ],
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: [{ type: "text", text: "我理解为种草图" }],
      },
    ], "assistant-1");

    expect(context).toEqual({
      messageExcerpt: "生成淘宝详情页",
      assistantExcerpt: "我理解为种草图",
      imageUrls: ["https://example.com/product.jpg"],
    });
  });
});
