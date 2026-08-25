import { describe, expect, it } from "vitest";
import { parseCreativeAgentDecision } from "@/lib/creative-agent-planner.server";

describe("creative Agent conversation planner", () => {
  it("accepts a real conversation reply", () => {
    expect(parseCreativeAgentDecision({
      choices: [{ message: { content: JSON.stringify({ kind: "conversation", capability: null, reply: "你好，我在。" }) } }],
    }, "image")).toEqual({ kind: "conversation", capability: null, reply: "你好，我在。" });
  });

  it("routes a planned media request to generation", () => {
    expect(parseCreativeAgentDecision({
      choices: [{ message: { content: "```json\n{\"kind\":\"generation\",\"capability\":\"video\",\"reply\":\"开始制作视频。\"}\n```" } }],
    }, "image")).toEqual({ kind: "generation", capability: "video", reply: "开始制作视频。" });
  });

  it("removes reasoning blocks before parsing a planner decision", () => {
    expect(parseCreativeAgentDecision({
      choices: [{ message: { content: '<think>internal reasoning</think>\n{"kind":"conversation","capability":null,"reply":"你好！"}' } }],
    }, "image")).toEqual({ kind: "conversation", capability: null, reply: "你好！" });
  });

  it("rejects incomplete structured planner output", () => {
    expect(() => parseCreativeAgentDecision({
      choices: [{ message: { content: JSON.stringify({ kind: "conversation", reply: "" }) } }],
    }, "image")).toThrow("不完整结果");
  });
});
