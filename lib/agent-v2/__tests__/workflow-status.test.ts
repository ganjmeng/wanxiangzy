import { describe, expect, it } from "vitest";
import {
  buildWorkflowStatusResultFromBundle,
  isWorkflowCancellableStatus,
  isWorkflowTerminalStatus,
} from "@/lib/agent-v2/workflow-status";
import type {
  WorkflowAssetRecord,
  WorkflowRecord,
  WorkflowStepRecord,
} from "@/lib/agent/workflow/types";

describe("agent-v2 workflow status", () => {
  it("summarizes a live workflow bundle for inline status rendering", () => {
    const result = buildWorkflowStatusResultFromBundle({
      workflow: makeWorkflow({ status: "running" }),
      steps: [
        makeStep({ id: "step-1", status: "completed" }),
        makeStep({ id: "step-2", status: "running" }),
        makeStep({ id: "step-3", status: "pending" }),
      ],
      assets: [makeAsset({ url: "https://example.com/final.png" })],
      events: [],
    });

    expect(result.found).toBe(true);
    expect(result.workflow?.status).toBe("running");
    expect(result.progress).toEqual({
      total: 3,
      completed: 1,
      running: 1,
      failed: 0,
      pending: 1,
    });
    expect(result.outputs).toEqual([
      { kind: "image", role: "final", url: "https://example.com/final.png" },
    ]);
  });

  it("dedupes final output URLs from workflow and assets", () => {
    const result = buildWorkflowStatusResultFromBundle({
      workflow: makeWorkflow({
        final_outputs: {
          imageUrls: ["https://example.com/final.png", "https://example.com/extra.png"],
        },
      }),
      steps: [],
      assets: [makeAsset({ url: "https://example.com/final.png" })],
      events: [],
    });

    expect(result.outputs?.map((output) => output.url)).toEqual([
      "https://example.com/final.png",
      "https://example.com/extra.png",
    ]);
  });

  it("includes intermediate generated assets so running workflows can stream visible results", () => {
    const result = buildWorkflowStatusResultFromBundle({
      workflow: makeWorkflow({ status: "running" }),
      steps: [makeStep({ status: "completed" }), makeStep({ id: "step-2", status: "running" })],
      assets: [
        makeAsset({ role: "intermediate", url: "https://example.com/tryon.png" }),
        makeAsset({ role: "source", url: "https://example.com/source.png" }),
      ],
      events: [],
    });

    expect(result.outputs).toEqual([
      { kind: "image", role: "intermediate", url: "https://example.com/tryon.png" },
    ]);
  });

  it("recognizes terminal statuses", () => {
    expect(isWorkflowTerminalStatus("completed")).toBe(true);
    expect(isWorkflowTerminalStatus("partially_completed")).toBe(true);
    expect(isWorkflowTerminalStatus("running")).toBe(false);
  });

  it("only allows cancellation after confirmation and before terminal states", () => {
    expect(isWorkflowCancellableStatus("queued")).toBe(true);
    expect(isWorkflowCancellableStatus("running")).toBe(true);
    expect(isWorkflowCancellableStatus("needs_confirmation")).toBe(false);
    expect(isWorkflowCancellableStatus("completed")).toBe(false);
    expect(isWorkflowCancellableStatus("cancelled")).toBe(false);
  });
});

function makeWorkflow(patch: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    id: "workflow-1",
    user_id: "user-1",
    conversation_id: "conversation-1",
    status: "running",
    intent: "commerce_detail",
    summary: "生成详情页",
    mode: "agent",
    input_images: [],
    active_plan_version_id: null,
    final_outputs: null,
    cost_estimate: null,
    cost_reserved: 2,
    cost_settled: 0,
    idempotency_key: null,
    error_message: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...patch,
  };
}

function makeStep(patch: Partial<WorkflowStepRecord> = {}): WorkflowStepRecord {
  return {
    id: "step-1",
    workflow_id: "workflow-1",
    step_key: "step-1",
    type: "image_to_image",
    title: "生成图片",
    status: "pending",
    depends_on: [],
    input: {},
    params: {},
    output: null,
    quality: null,
    error_message: null,
    retry_count: 0,
    started_at: null,
    completed_at: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...patch,
  };
}

function makeAsset(patch: Partial<WorkflowAssetRecord> = {}): WorkflowAssetRecord {
  return {
    id: "asset-1",
    user_id: "user-1",
    workflow_id: "workflow-1",
    step_id: "step-1",
    kind: "image",
    role: "final",
    url: "https://example.com/final.png",
    provider: "test",
    model: "test-model",
    metadata: {},
    created_at: new Date(0).toISOString(),
    ...patch,
  };
}
