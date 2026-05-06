import type {
  QualityCheckResult,
  WorkflowStepRecord,
  WorkflowStepResultOutput,
  WorkflowToolType,
} from "@/lib/agent/workflow/types";
import {
  applyQualityRepairToPrompt,
  type VisualQualityEvaluation,
} from "@/lib/agent/brain/visual-quality";

const reviewableToolTypes = new Set<WorkflowToolType>([
  "text_to_image",
  "image_to_image",
  "tryon",
  "pose_variation",
  "garment_3d",
  "commerce_detail",
  "commerce_creative",
  "background_replace",
]);

export function shouldReviewStepImageQuality(
  step: WorkflowStepRecord,
  output: WorkflowStepResultOutput
) {
  return reviewableToolTypes.has(step.type) && Boolean(output.imageUrls?.length);
}

export function readMaxQualityRepairAttempts(raw = process.env.AGENT_WORKFLOW_QUALITY_REPAIR_MAX_ATTEMPTS) {
  const parsed = Number(raw ?? 1);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(Math.floor(parsed), 0), 2);
}

export function isQualityRepairEnabled() {
  return process.env.AGENT_WORKFLOW_QUALITY_REPAIR_ENABLED !== "false";
}

export function shouldRetryForQuality(params: {
  quality: VisualQualityEvaluation;
  retryCount: number;
  toolMaxAttempts: number;
  maxQualityRepairAttempts?: number;
}) {
  if (!params.quality.shouldRegenerate) return false;
  const maxQualityRepairAttempts =
    params.maxQualityRepairAttempts ?? readMaxQualityRepairAttempts();
  if (maxQualityRepairAttempts <= 0) return false;

  const nextRetry = params.retryCount + 1;
  return nextRetry <= maxQualityRepairAttempts && nextRetry < params.toolMaxAttempts;
}

export function toQualityCheckResult(evaluation: VisualQualityEvaluation): QualityCheckResult {
  const status: QualityCheckResult["checks"][number]["status"] = evaluation.ok
    ? "pass"
    : evaluation.shouldRegenerate
      ? "fail"
      : "warn";

  return {
    ok: evaluation.ok,
    score: evaluation.score,
    checks: [
      {
        label: "visual_review",
        status,
        detail: `${evaluation.summary} (${evaluation.source})`,
      },
      ...evaluation.issues.slice(0, 8).map((issue) => ({
        label: "issue",
        status: evaluation.shouldRegenerate ? "fail" as const : "warn" as const,
        detail: issue,
      })),
    ],
  };
}

export function buildQualityRepairPatch(
  step: WorkflowStepRecord,
  evaluation: VisualQualityEvaluation,
  retryCount: number
) {
  const existingPrompt = typeof step.params.prompt === "string" ? step.params.prompt : "";
  const repairedPrompt = applyQualityRepairToPrompt(
    existingPrompt || String(step.input.prompt || step.title || ""),
    evaluation
  );

  return {
    input: { ...step.input },
    params: {
      ...step.params,
      prompt: repairedPrompt,
      _qualityRepair: {
        retryCount,
        score: evaluation.score,
        summary: evaluation.summary,
        issues: evaluation.issues.slice(0, 8),
        repairedAt: new Date().toISOString(),
      },
    },
    summary: evaluation.summary,
  };
}

export function getExpectedImageCount(step: WorkflowStepRecord, output: WorkflowStepResultOutput) {
  if (step.type === "pose_variation" && step.params.outputMode !== "separate") return 1;

  const countFromParams = Number(
    step.params.count ??
    step.params.genCount ??
    step.params.outputCount ??
    step.input.count ??
    step.input.genCount
  );
  if (Number.isFinite(countFromParams) && countFromParams > 0) {
    return Math.min(Math.max(Math.floor(countFromParams), 1), 4);
  }
  if (step.type === "pose_variation" && step.params.outputMode === "separate") return 4;
  return Math.max(1, output.imageUrls?.length || 1);
}
