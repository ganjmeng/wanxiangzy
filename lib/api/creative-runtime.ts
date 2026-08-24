type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export type CreativeSurface = "agent" | "canvas" | "api" | "system";

export async function createCreativeRun(
  client: RpcClient,
  input: {
    userId: string;
    surface: CreativeSurface;
    intent?: string;
    summary?: string;
    inputPayload?: Record<string, unknown>;
    projectId?: string;
    conversationId?: string;
    clientRequestId?: string;
  },
) {
  const { data, error } = await client.rpc("create_creative_run", {
    p_user_id: requireUuid(input.userId, "userId"),
    p_surface: input.surface,
    p_intent: boundedText(input.intent, 4_000),
    p_summary: boundedText(input.summary, 500),
    p_input_payload: safePayload(input.inputPayload),
    p_project_id: optionalUuid(input.projectId, "projectId"),
    p_conversation_id: optionalUuid(input.conversationId, "conversationId"),
    p_client_request_id: cleanKey(input.clientRequestId, 160),
  });
  if (error) throw new Error(`创意任务创建失败: ${error.message || "unknown database error"}`);
  return requireUuid(firstScalar(data), "creativeRunId");
}

export async function attachGenerationToCreativeRun(
  client: RpcClient,
  input: {
    userId: string;
    runId: string;
    generationId: string;
    stepKey: string;
    stepType: string;
    title?: string;
    inputPayload?: Record<string, unknown>;
    parentStepId?: string;
    dependsOnStepIds?: string[];
    canvasNodeId?: string;
  },
) {
  const { data, error } = await client.rpc("attach_generation_to_creative_run", {
    p_user_id: requireUuid(input.userId, "userId"),
    p_run_id: requireUuid(input.runId, "runId"),
    p_generation_id: requireUuid(input.generationId, "generationId"),
    p_step_key: requireKey(input.stepKey, "stepKey", 120),
    p_step_type: requireKey(input.stepType, "stepType", 120),
    p_title: boundedText(input.title, 300),
    p_input_payload: safePayload(input.inputPayload),
    p_parent_step_id: optionalUuid(input.parentStepId, "parentStepId"),
    p_depends_on_step_ids: uniqueUuids(input.dependsOnStepIds, 100),
    p_canvas_node_id: cleanKey(input.canvasNodeId, 160),
  });
  if (error) throw new Error(`生成任务关联创意步骤失败: ${error.message || "unknown database error"}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("生成任务关联创意步骤失败: invalid database response");
  }
  const result = row as Record<string, unknown>;
  return {
    runId: requireUuid(result.run_id, "runId"),
    stepId: requireUuid(result.step_id, "stepId"),
    generationId: requireUuid(result.generation_id, "generationId"),
  };
}

function safePayload(value?: Record<string, unknown>) {
  const payload = value || {};
  const serialized = JSON.stringify(payload);
  if (serialized.length > 262_144) throw new Error("creative payload exceeds 256 KiB");
  assertNoSecretKeys(payload, 0);
  return payload;
}

function assertNoSecretKeys(value: unknown, depth: number): void {
  if (depth > 12) throw new Error("creative payload nesting is too deep");
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecretKeys(item, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/^(authorization|api[_-]?key|access[_-]?token|secret|password)$/i.test(key)) {
      throw new Error(`creative payload contains forbidden secret field: ${key}`);
    }
    assertNoSecretKeys(item, depth + 1);
  }
}

function firstScalar(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length === 1) return firstScalar(value[0]);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    return row.create_creative_run ?? row.id ?? value;
  }
  return value;
}

function requireUuid(value: unknown, field: string) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${field} must be a UUID`);
  }
  return value;
}

function optionalUuid(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return null;
  return requireUuid(value, field);
}

function uniqueUuids(values: string[] | undefined, limit: number) {
  const unique = Array.from(new Set(values || []));
  if (unique.length > limit) throw new Error(`dependsOnStepIds exceeds ${limit}`);
  return unique.map((value) => requireUuid(value, "dependsOnStepIds"));
}

function requireKey(value: unknown, field: string, maxLength: number) {
  const normalized = cleanKey(value, maxLength);
  if (!normalized) throw new Error(`${field} is invalid`);
  return normalized;
}

function cleanKey(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || !/^[A-Za-z0-9._:-]+$/.test(normalized)) return null;
  return normalized;
}

function boundedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return replaceControlCharacters(value).trim().slice(0, maxLength);
}

function replaceControlCharacters(value: string) {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
}
