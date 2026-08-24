import { describe, expect, it } from "vitest";
import { buildAgentGenerationIdempotencyKey } from "@/lib/agent-generation-idempotency";

describe("Agent generation idempotency keys", () => {
  it("matches the server contract and remains unique per model slot", () => {
    const requestId = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
    const first = buildAgentGenerationIdempotencyKey(requestId, 0);
    const second = buildAgentGenerationIdempotencyKey(requestId, 1);

    expect(first).toBe("agent-6ba7b810-9dad-41d1-80b4-00c04fd430c8-1");
    expect(first).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{19,159}$/);
    expect(second).not.toBe(first);
  });

  it("rejects malformed request ids and model slots before sending", () => {
    expect(() => buildAgentGenerationIdempotencyKey("not-a-uuid", 0)).toThrow("Agent 请求 ID 无效");
    expect(() => buildAgentGenerationIdempotencyKey("6ba7b810-9dad-41d1-80b4-00c04fd430c8", -1)).toThrow("Agent 模型槽位无效");
  });
});

