const GENERATION_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{19,159}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Builds one stable generation key per model slot in an Agent submission.
 * Keep this aligned with the server-side generation idempotency contract.
 */
export function buildAgentGenerationIdempotencyKey(clientRequestId: string, slotIndex: number) {
  if (!UUID_PATTERN.test(clientRequestId)) {
    throw new Error("Agent 请求 ID 无效");
  }
  if (!Number.isSafeInteger(slotIndex) || slotIndex < 0) {
    throw new Error("Agent 模型槽位无效");
  }

  const key = `agent-${clientRequestId}-${slotIndex + 1}`;
  if (!GENERATION_IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new Error("Agent 生成幂等键无效");
  }
  return key;
}

