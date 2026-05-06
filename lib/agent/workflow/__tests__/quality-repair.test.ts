import { describe, expect, it } from "vitest";
import {
  buildQualityRepairPatch,
  getExpectedImageCount,
  readMaxQualityRepairAttempts,
  shouldReviewStepImageQuality,
  shouldRetryForQuality,
  toQualityCheckResult,
} from "@/lib/agent/workflow/quality-repair";
import type { VisualQualityEvaluation } from "@/lib/agent/brain/visual-quality";
import type { WorkflowStepRecord } from "@/lib/agent/workflow/types";

function makeStep(overrides: Partial<WorkflowStepRecord> = {}): WorkflowStepRecord {
  return {
    id: "step-id",
    workflow_id: "workflow-id",
    step_key: "step_1",
    type: "pose_variation",
    title: "Pose variation",
    status: "running",
    depends_on: [],
    input: {},
    params: {},
    output: null,
    quality: null,
    error_message: null,
    retry_count: 0,
    started_at: null,
    completed_at: null,
    created_at: "2026-05-06T00:00:00.000Z",
    updated_at: "2026-05-06T00:00:00.000Z",
    ...overrides,
  };
}

const failingEvaluation: VisualQualityEvaluation = {
  ok: false,
  score: 0.42,
  shouldRegenerate: true,
  summary: "Wrong garment and distorted hands",
  issues: ["garment changed", "hands distorted"],
  repairPrompt: "Regenerate with the same garment and natural hands.",
  source: "vision_llm",
};

describe("workflow visual quality repair", () => {
  it("reviews only image-producing generation steps", () => {
    expect(shouldReviewStepImageQuality(makeStep({ type: "tryon" }), { imageUrls: ["https://x.test/1.png"] })).toBe(true);
    expect(shouldReviewStepImageQuality(makeStep({ type: "select_image" }), { selectedImageUrl: "https://x.test/1.png" })).toBe(false);
    expect(shouldReviewStepImageQuality(makeStep({ type: "tryon" }), { imageUrls: [] })).toBe(false);
  });

  it("limits quality repairs independently from normal step retries", () => {
    expect(shouldRetryForQuality({
      quality: failingEvaluation,
      retryCount: 0,
      toolMaxAttempts: 3,
      maxQualityRepairAttempts: 1,
    })).toBe(true);

    expect(shouldRetryForQuality({
      quality: failingEvaluation,
      retryCount: 1,
      toolMaxAttempts: 3,
      maxQualityRepairAttempts: 1,
    })).toBe(false);
  });

  it("converts visual evaluation into workflow quality checks", () => {
    const quality = toQualityCheckResult(failingEvaluation);
    expect(quality.ok).toBe(false);
    expect(quality.score).toBe(0.42);
    expect(quality.checks[0]).toMatchObject({ label: "visual_review", status: "fail" });
    expect(quality.checks.some((check) => check.detail === "garment changed")).toBe(true);
  });

  it("derives expected count from params and pose separate mode", () => {
    expect(getExpectedImageCount(makeStep({ type: "text_to_image", params: { count: 2 } }), { imageUrls: ["a"] })).toBe(2);
    expect(getExpectedImageCount(makeStep({ params: { outputMode: "separate" } }), { imageUrls: ["a"] })).toBe(4);
    expect(getExpectedImageCount(makeStep({ params: { outputMode: "grid", count: 4 } }), { imageUrls: ["a"] })).toBe(1);
    expect(getExpectedImageCount(makeStep({ type: "text_to_image" }), { imageUrls: ["a", "b"] })).toBe(2);
  });

  it("builds a repaired prompt patch with retry metadata", () => {
    const patch = buildQualityRepairPatch(
      makeStep({ params: { prompt: "Create a fashion image" } }),
      failingEvaluation,
      1
    );

    expect(String(patch.params.prompt)).toContain("Create a fashion image");
    expect(patch.params._qualityRepair).toMatchObject({
      retryCount: 1,
      score: 0.42,
      summary: "Wrong garment and distorted hands",
    });
  });

  it("clamps configured quality repair attempts", () => {
    expect(readMaxQualityRepairAttempts("3")).toBe(2);
    expect(readMaxQualityRepairAttempts("-1")).toBe(0);
    expect(readMaxQualityRepairAttempts("bad")).toBe(1);
  });
});
