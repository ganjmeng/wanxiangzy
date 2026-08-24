import { describe, expect, it, vi } from "vitest";

import {
  attachGenerationToCreativeRun,
  createCreativeRun,
} from "@/lib/api/creative-runtime";

const userId = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const runId = "94f23894-0dc2-4ada-a62a-609a0fe8a00f";
const generationId = "9fb5a795-8380-4df7-9fab-e739f019c10f";
const stepId = "a01b60c2-e282-4ff4-b9c8-22d86d39568b";

describe("creative runtime service", () => {
  it("creates idempotent Agent/canvas parents for the current account", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: runId, error: null });
    await expect(createCreativeRun({ rpc }, {
      userId,
      surface: "canvas",
      intent: "生成电商套图",
      inputPayload: { inputUrls: ["https://cdn.example.com/input.png"] },
      clientRequestId: "canvas-request-1",
    })).resolves.toBe(runId);

    expect(rpc).toHaveBeenCalledWith("create_creative_run", expect.objectContaining({
      p_user_id: userId,
      p_surface: "canvas",
      p_client_request_id: "canvas-request-1",
    }));
  });

  it("binds an already charged generation as a durable run step", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ run_id: runId, step_id: stepId, generation_id: generationId }],
      error: null,
    });
    await expect(attachGenerationToCreativeRun({ rpc }, {
      userId,
      runId,
      generationId,
      stepKey: "hero.1",
      stepType: "image.generate",
      canvasNodeId: "node:hero-1",
    })).resolves.toEqual({ runId, stepId, generationId });
  });

  it("refuses to persist provider secrets in creative payloads", async () => {
    const rpc = vi.fn();
    await expect(createCreativeRun({ rpc }, {
      userId,
      surface: "agent",
      inputPayload: { provider: { apiKey: "secret" } },
    })).rejects.toThrow("forbidden secret field");
    expect(rpc).not.toHaveBeenCalled();
  });
});
