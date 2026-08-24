import { describe, expect, it, vi } from "vitest";

import {
  checkpointGenerationExecution,
  markGenerationNeedsReview,
} from "@/lib/api/generation-execution";
import { StaleExecutionFenceError } from "@/lib/api/generation-errors";

const fence = {
  generationId: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
  deliveryVersion: 3,
  executionToken: "94f23894-0dc2-4ada-a62a-609a0fe8a00f",
};

describe("generation execution checkpoints", () => {
  it("writes only bounded, non-secret provider metadata through the execution fence", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await checkpointGenerationExecution({ rpc }, fence, {
      phase: "submitted",
      upstreamTaskId: "task_123",
      upstreamProvider: "newapi",
      upstreamStatus: "QUEUED\u0000",
      resultPayload: {
        resultCount: 2,
        expectedCount: 4,
        apiKey: "must-not-be-persisted",
        rawResponse: { authorization: "secret" },
      },
    });

    expect(rpc).toHaveBeenCalledWith("checkpoint_generation_execution", expect.objectContaining({
      p_generation_id: fence.generationId,
      p_delivery_version: 3,
      p_execution_token: fence.executionToken,
      p_execution_phase: "submitted",
      p_upstream_task_id: "task_123",
      p_upstream_status: "QUEUED",
      p_result_payload: { resultCount: 2, expectedCount: 4 },
    }));
  });

  it("rejects stale workers when the database fence no longer matches", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    await expect(checkpointGenerationExecution({ rpc }, fence, { phase: "polling" }))
      .rejects.toBeInstanceOf(StaleExecutionFenceError);
  });

  it("moves an ambiguous submission to manual review without leaking raw errors", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await markGenerationNeedsReview(
      { rpc },
      fence,
      "Authorization: Bearer top-secret\nupstream connection reset",
    );

    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(rpc.mock.calls[0]?.[0]).toBe("mark_generation_needs_review");
    expect(args.p_reason).not.toContain("top-secret");
    expect(args.p_upstream_status).toBe("submission_outcome_unknown");
  });
});
