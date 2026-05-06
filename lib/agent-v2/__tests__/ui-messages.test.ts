import { describe, expect, it } from "vitest";
import { buildFallbackAgentReply, getLastUserText, normalizeUiMessages } from "@/lib/agent-v2/ui-messages";

describe("agent-v2 ui message helpers", () => {
  it("extracts the last user text from AI SDK v6 text parts", () => {
    const messages = normalizeUiMessages([
      { id: "1", role: "user", parts: [{ type: "text", text: "你好" }] },
      { id: "2", role: "assistant", parts: [{ type: "text", text: "你好呀" }] },
      { id: "3", role: "user", parts: [{ type: "text", text: "你能做什么？" }] },
    ]);

    expect(getLastUserText(messages)).toBe("你能做什么？");
  });

  it("keeps generation requests in confirmation-safe fallback mode", () => {
    const reply = buildFallbackAgentReply("帮我生成一套淘宝详情页");

    expect(reply).toContain("确认");
    expect(reply).toContain("不会扣积分");
  });
});
