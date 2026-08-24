import {
  RetryableGenerationError,
  sanitizeGenerationErrorMessage,
  StaleExecutionFenceError,
} from "@/lib/api/generation-errors";

export type GenerationExecutionPhase =
  | "submitting"
  | "submitted"
  | "polling"
  | "result_ready"
  | "persisting"
  | "settling";

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export type GenerationExecutionFence = {
  generationId: string;
  deliveryVersion: number;
  executionToken: string;
};

export async function checkpointGenerationExecution(
  client: RpcClient,
  fence: GenerationExecutionFence,
  checkpoint: {
    phase: GenerationExecutionPhase;
    upstreamTaskId?: string;
    upstreamRequestId?: string;
    upstreamProvider?: string;
    upstreamDeploymentId?: string;
    upstreamStatus?: string;
    nextPollAt?: string | null;
    resultPayload?: Record<string, unknown>;
  },
) {
  const { data, error } = await client.rpc("checkpoint_generation_execution", {
    p_generation_id: fence.generationId,
    p_delivery_version: fence.deliveryVersion,
    p_execution_token: fence.executionToken,
    p_execution_phase: checkpoint.phase,
    p_upstream_task_id: cleanIdentifier(checkpoint.upstreamTaskId, 256),
    p_upstream_request_id: cleanIdentifier(checkpoint.upstreamRequestId, 256),
    p_upstream_provider: cleanIdentifier(checkpoint.upstreamProvider, 120),
    p_upstream_deployment_id: cleanIdentifier(checkpoint.upstreamDeploymentId, 160),
    p_upstream_status: cleanText(checkpoint.upstreamStatus, 160),
    p_next_poll_at: checkpoint.nextPollAt || null,
    p_result_payload: sanitizeCheckpointPayload(checkpoint.resultPayload),
  });
  if (error) {
    throw new RetryableGenerationError(
      `生成阶段检查点写入失败: ${error.message || "unknown database error"}`,
      "GENERATION_CHECKPOINT_WRITE_FAILED",
      { cause: error },
    );
  }
  if (data !== true) throw new StaleExecutionFenceError("任务执行租约已丢失");
}

export async function markGenerationNeedsReview(
  client: RpcClient,
  fence: GenerationExecutionFence,
  reason: string,
  upstreamStatus = "submission_outcome_unknown",
) {
  const safeReason = sanitizeGenerationErrorMessage(reason, "上游任务状态需要人工确认", 500);
  const { data, error } = await client.rpc("mark_generation_needs_review", {
    p_generation_id: fence.generationId,
    p_delivery_version: fence.deliveryVersion,
    p_execution_token: fence.executionToken,
    p_reason: safeReason,
    p_upstream_status: cleanText(upstreamStatus, 160) || "needs_review",
  });
  if (error) {
    throw new RetryableGenerationError(
      `任务转人工复核失败: ${error.message || "unknown database error"}`,
      "GENERATION_REVIEW_WRITE_FAILED",
      { cause: error },
    );
  }
  if (data !== true) throw new StaleExecutionFenceError("任务执行租约已丢失");
}

function cleanIdentifier(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || !/^[A-Za-z0-9._:@/-]+$/.test(normalized)) return null;
  return normalized.slice(0, maxLength);
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = replaceControlCharacters(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function replaceControlCharacters(value: string) {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
}

function sanitizeCheckpointPayload(value?: Record<string, unknown>) {
  if (!value) return null;
  const allowed = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => ["resultCount", "expectedCount", "slot", "mediaType", "persistenceAttempt"].includes(key))
      .slice(0, 12),
  );
  return allowed;
}
