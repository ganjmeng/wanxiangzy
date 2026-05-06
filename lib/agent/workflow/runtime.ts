import { normalizeAspectRatio, normalizeImageSize, normalizeLingyaModel, type ImageSize } from "@/lib/api/lingya";
import { evaluateGeneratedImages } from "@/lib/agent/brain/visual-quality";
import { getStepExecutor } from "@/lib/agent/workflow/executors";
import {
  buildQualityRepairPatch,
  getExpectedImageCount,
  isQualityRepairEnabled,
  shouldReviewStepImageQuality,
  shouldRetryForQuality,
  toQualityCheckResult,
} from "@/lib/agent/workflow/quality-repair";
import {
  appendWorkflowEvent,
  claimAgentWorkflowById,
  claimNextAgentWorkflows,
  createWorkflowAssets,
  getWorkflowBundleForWorker,
  releaseWorkflowCredits,
  setStepStatus,
  setWorkflowStatus,
  settleWorkflowCredits,
  tryStartWorkflowStep,
  updateStepDefinition,
} from "@/lib/agent/workflow/repository";
import type { WorkflowBundle } from "@/lib/agent/workflow/repository";
import type { StepExecutionResult, WorkflowCostEstimate, WorkflowStepRecord, WorkflowStepResultOutput } from "@/lib/agent/workflow/types";
import { getWorkflowTool } from "@/lib/agent/workflow/tools";

const terminalWorkflowStatuses = new Set(["completed", "partially_completed", "failed", "cancelled"]);
const backgroundWorkflowRuns = new Set<string>();

export function wakeAgentWorkflow(workflowId: string) {
  if (!workflowId || process.env.AGENT_WORKFLOW_INLINE_WAKE === "0") return false;
  if (backgroundWorkflowRuns.has(workflowId)) return false;

  backgroundWorkflowRuns.add(workflowId);
  setTimeout(() => {
    void runAgentWorkflowById(workflowId)
      .catch((err) => {
        console.error(`[agent-workflow] immediate wake failed for ${workflowId}:`, err);
      })
      .finally(() => {
        backgroundWorkflowRuns.delete(workflowId);
      });
  }, 0);

  return true;
}

export async function runNextAgentWorkflows(
  limit = 2,
  options: { staleAfterMinutes?: number } = {},
) {
  const ids = await claimNextAgentWorkflows(limit, options.staleAfterMinutes);
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const id of ids) {
    try {
      await runAgentWorkflowById(id, { alreadyClaimed: true });
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof Error ? err.message : "workflow failed" });
    }
  }
  return { claimed: ids.length, results };
}

export async function runAgentWorkflowById(
  workflowId: string,
  options: { alreadyClaimed?: boolean } = {}
) {
  if (!options.alreadyClaimed) {
    const claimed = await claimAgentWorkflowById(workflowId);
    if (!claimed) return { processed: 0, skipped: 1 };
  }

  const bundle = await getWorkflowBundleForWorker(workflowId);
  if (!bundle) return { processed: 0, skipped: 1 };
  if (terminalWorkflowStatuses.has(bundle.workflow.status)) {
    return { processed: 0, skipped: 1 };
  }

  await setWorkflowStatus(workflowId, "running");
  await appendWorkflowEvent({ workflowId, type: "workflow_queued", message: "Workflow picked by worker" });

  let current = await recoverInterruptedSteps(bundle);
  while (true) {
    let ready = getReadySteps(current.steps);
    if (!ready.length) {
      const refreshed = await refreshAfterMarkingReadySteps(workflowId, current);
      current = refreshed;
      ready = getReadySteps(current.steps);
      if (!ready.length) break;
    }
    for (const step of ready) {
      await executeStep(current, step);
      const refreshed = await getWorkflowBundleForWorker(workflowId);
      if (!refreshed) throw new Error("Workflow disappeared during execution");
      current = refreshed;
      if (terminalWorkflowStatuses.has(current.workflow.status)) return { processed: 1, skipped: 0 };
    }
    if (terminalWorkflowStatuses.has(current.workflow.status)) return { processed: 1, skipped: 0 };
    current = await refreshAfterMarkingReadySteps(workflowId, current);
    if (terminalWorkflowStatuses.has(current.workflow.status)) return { processed: 1, skipped: 0 };
  }

  await finalizeWorkflow(current);
  return { processed: 1, skipped: 0 };
}

async function executeStep(bundle: WorkflowBundle, step: WorkflowStepRecord) {
  const started = await tryStartWorkflowStep(step.id);
  if (!started) {
    await appendWorkflowEvent({
      workflowId: bundle.workflow.id,
      stepId: step.id,
      type: "step_skipped",
      message: `${step.title} was not started because its status changed`,
      payload: { previousStatus: step.status },
    });
    return;
  }

  const executor = getStepExecutor(step.type);
  if (!executor) {
    await failStep(bundle, step, `工具 ${step.type} 没有可用 executor`);
    return;
  }

  await appendWorkflowEvent({
    workflowId: bundle.workflow.id,
    stepId: step.id,
    type: "step_started",
    message: `${step.title} started`,
    payload: { type: step.type },
  });

  try {
    const model = normalizeLingyaModel(step.params.model || step.params.aiModel || "gpt-image-2");
    const aspectRatio = normalizeAspectRatio(step.params.aspectRatio || step.params.aspect_ratio || "3:4");
    const imageSize = normalizeImageSize(model, String(step.params.imageSize || step.params.image_size || "1K") as ImageSize, aspectRatio);
    const result = await executor({
      workflow: bundle.workflow,
      step,
      steps: bundle.steps,
      inputImages: bundle.workflow.input_images,
      model,
      aspectRatio,
      imageSize,
    });
    if (await shouldIgnoreStepWrite(bundle.workflow.id, step.id)) {
      await appendWorkflowEvent({
        workflowId: bundle.workflow.id,
        stepId: step.id,
        type: "step_skipped",
        message: `${step.title} result ignored because workflow was cancelled`,
      });
      return;
    }

    const qualityReview = await reviewStepOutputQuality(bundle, step, result);
    if (qualityReview.retry) return;
    const quality = qualityReview.quality || result.quality || null;

    const assets = result.output.imageUrls?.length
      ? await createWorkflowAssets({
        userId: bundle.workflow.user_id,
        workflowId: bundle.workflow.id,
        stepId: step.id,
        kind: "image",
        role: isTerminalOutputStep(bundle.steps, step) ? "final" : "intermediate",
        urls: result.output.imageUrls,
        provider: result.providerTrace?.[0]?.provider || null,
        model,
        metadata: { toolType: step.type, promptTrace: result.promptTrace || [] },
      })
      : [];
    const output = {
      ...result.output,
      assetIds: assets.length ? assets.map((asset) => asset.id) : result.output.assetIds,
    };
    await setStepStatus(step.id, "completed", { output, quality });
    await appendWorkflowEvent({
      workflowId: bundle.workflow.id,
      stepId: step.id,
      type: "step_completed",
      message: `${step.title} completed`,
      payload: { output, quality, providerTrace: result.providerTrace || [] },
    });
  } catch (err) {
    if (await shouldIgnoreStepWrite(bundle.workflow.id, step.id)) {
      await appendWorkflowEvent({
        workflowId: bundle.workflow.id,
        stepId: step.id,
        type: "step_skipped",
        message: `${step.title} failure ignored because workflow was cancelled`,
      });
      return;
    }
    await failStep(bundle, step, err instanceof Error ? err.message : "step failed");
  }
}

async function reviewStepOutputQuality(
  bundle: WorkflowBundle,
  step: WorkflowStepRecord,
  result: StepExecutionResult
): Promise<{ retry: boolean; quality: StepExecutionResult["quality"] | null }> {
  if (!isQualityRepairEnabled() || !shouldReviewStepImageQuality(step, result.output)) {
    return { retry: false, quality: result.quality || null };
  }

  try {
    const expectedCount = getExpectedImageCount(step, result.output);
    const evaluation = await evaluateGeneratedImages({
      userPrompt: String(step.params.prompt || bundle.workflow.summary || step.title),
      module: step.type,
      resultUrls: result.output.imageUrls || [],
      expectedCount,
      referenceImageUrls: bundle.workflow.input_images.map((image) => image.url).filter(Boolean).slice(0, 4),
    });
    const quality = toQualityCheckResult(evaluation);
    const tool = getWorkflowTool(step.type);
    const toolMaxAttempts = tool?.retryPolicy.maxAttempts ?? 3;

    await appendWorkflowEvent({
      workflowId: bundle.workflow.id,
      stepId: step.id,
      type: "quality_checked",
      message: evaluation.ok ? `${step.title} visual review passed` : `${step.title} visual review needs attention`,
      payload: {
        score: evaluation.score,
        ok: evaluation.ok,
        shouldRegenerate: evaluation.shouldRegenerate,
        source: evaluation.source,
        summary: evaluation.summary,
        issues: evaluation.issues.slice(0, 8),
        expectedCount,
        outputCount: result.output.imageUrls?.length || 0,
      },
    });

    if (shouldRetryForQuality({
      quality: evaluation,
      retryCount: step.retry_count,
      toolMaxAttempts,
    })) {
      const nextRetry = step.retry_count + 1;
      const repaired = buildQualityRepairPatch(step, evaluation, nextRetry);
      await updateStepDefinition(step.id, {
        params: repaired.params,
        input: repaired.input,
      });
      await setStepStatus(step.id, "ready", {
        quality,
        errorMessage: evaluation.summary,
        retryCount: nextRetry,
      });
      await appendWorkflowEvent({
        workflowId: bundle.workflow.id,
        stepId: step.id,
        type: "step_retried",
        message: `${step.title} will retry after visual quality review`,
        payload: {
          retryCount: nextRetry,
          maxAttempts: toolMaxAttempts,
          repairSummary: repaired.summary,
          score: evaluation.score,
          issues: evaluation.issues.slice(0, 8),
        },
      });
      return { retry: true, quality };
    }

    return { retry: false, quality };
  } catch (err) {
    await appendWorkflowEvent({
      workflowId: bundle.workflow.id,
      stepId: step.id,
      type: "quality_checked",
      message: `${step.title} visual review unavailable`,
      payload: {
        ok: result.quality?.ok ?? true,
        score: result.quality?.score ?? null,
        error: err instanceof Error ? err.message : "visual quality review failed",
      },
    });
    return { retry: false, quality: result.quality || null };
  }
}

async function shouldIgnoreStepWrite(workflowId: string, stepId: string) {
  const latest = await getWorkflowBundleForWorker(workflowId);
  if (!latest) return true;
  const latestStep = latest.steps.find((candidate) => candidate.id === stepId);
  return terminalWorkflowStatuses.has(latest.workflow.status) || latestStep?.status === "cancelled";
}

async function failStep(bundle: WorkflowBundle, step: WorkflowStepRecord, message: string) {
  const nextRetry = step.retry_count + 1;
  const tool = getWorkflowTool(step.type);
  const maxAttempts = tool?.retryPolicy.maxAttempts ?? 3;
  const retryable = tool?.retryPolicy.retryable !== false && process.env.AGENT_WORKFLOW_SELF_REPAIR_ENABLED !== "false";

  await appendWorkflowEvent({
    workflowId: bundle.workflow.id,
    stepId: step.id,
    type: "step_failed",
    message,
    payload: { type: step.type, retryCount: nextRetry, maxAttempts },
  });

  if (retryable && nextRetry < maxAttempts) {
    const repaired = buildSelfRepairPatch(step, message, nextRetry);
    await updateStepDefinition(step.id, {
      params: repaired.params,
      input: repaired.input,
      title: repaired.title,
    });
    await setStepStatus(step.id, "ready", {
      errorMessage: message,
      retryCount: nextRetry,
    });
    await appendWorkflowEvent({
      workflowId: bundle.workflow.id,
      stepId: step.id,
      type: "step_retried",
      message: `${step.title} will retry with a repaired prompt`,
      payload: {
        retryCount: nextRetry,
        repairSummary: repaired.summary,
      },
    });
    return;
  }

  await setStepStatus(step.id, "failed", {
    errorMessage: message,
    retryCount: nextRetry,
  });
  if (nextRetry >= maxAttempts) {
    await finalizeFailedWorkflow(bundle.workflow.id, bundle.workflow.user_id, bundle.workflow.cost_estimate, bundle.workflow.cost_reserved, bundle.steps);
  }
}

function buildSelfRepairPatch(step: WorkflowStepRecord, message: string, retryCount: number) {
  const params = { ...step.params };
  const input = { ...step.input };
  const existingPrompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
  const repairLines = [
    `失败复盘：第 ${retryCount} 次执行失败，原因是「${message.slice(0, 220)}」。`,
    "修复计划：重新检查输入图引用、输出数量、比例、提示词边界和用户原始目标；优先修复失败点，不要擅自切换任务类型。",
    getToolSpecificRepairLine(step.type),
  ].filter(Boolean);

  params.prompt = existingPrompt
    ? `${existingPrompt}\n\n${repairLines.join("\n")}`
    : repairLines.join("\n");
  params._selfRepair = {
    retryCount,
    lastError: message,
    repairedAt: new Date().toISOString(),
  };

  return {
    title: step.title,
    params,
    input,
    summary: repairLines.join(" "),
  };
}

function getToolSpecificRepairLine(type: string) {
  if (type === "commerce_detail") {
    return "详情页修复重点：必须保持电商详情页/长图版式，包含首屏、卖点、细节和参数区，不要变成单张种草图或街拍图。";
  }
  if (type === "pose_variation") {
    return "姿势裂变修复重点：保持人物身份、服装结构、身体比例和真实关节逻辑；若用户要求每张单独出图，则不要输出四宫格。";
  }
  if (type === "tryon") {
    return "换装修复重点：确认服装图和人物/参考图关系，严格保留服装版型、颜色、logo 和人物身份。";
  }
  if (type === "garment_3d") {
    return "3D 展示修复重点：当前输出是 3D 展示感图片，不是真实 3D 模型文件；保持商品结构和可检视细节。";
  }
  return "通用修复重点：保持用户原始目标、参考图角色和商业可用性，不要把任务改写成其他模块。";
}

async function markNewReadySteps(bundle: WorkflowBundle) {
  const completed = new Set(bundle.steps.filter((step) => step.status === "completed").map((step) => step.step_key));
  const pendingReady = bundle.steps.filter((step) =>
    step.status === "pending" &&
    step.depends_on.every((dep) => completed.has(dep))
  );
  for (const step of pendingReady) {
    await setStepStatus(step.id, "ready");
    await appendWorkflowEvent({
      workflowId: bundle.workflow.id,
      stepId: step.id,
      type: "step_queued",
      message: `${step.title} is ready`,
    });
  }
}

async function finalizeWorkflow(bundle: WorkflowBundle) {
  const failed = bundle.steps.filter((step) => step.status === "failed");
  const runnable = bundle.steps.filter((step) => !["skipped", "cancelled"].includes(step.status));
  const completed = runnable.filter((step) => step.status === "completed");

  if (failed.length) {
    await finalizeFailedWorkflow(bundle.workflow.id, bundle.workflow.user_id, bundle.workflow.cost_estimate, bundle.workflow.cost_reserved, bundle.steps);
    return;
  }

  if (runnable.length && completed.length === runnable.length) {
    const finalOutputs = collectFinalOutputs(bundle.steps);
    const total = bundle.workflow.cost_estimate?.total || bundle.workflow.cost_reserved || 0;
    await settleWorkflowCredits(bundle.workflow.user_id, bundle.workflow.id, total);
    await setWorkflowStatus(bundle.workflow.id, "completed", {
      final_outputs: finalOutputs,
      cost_settled: total,
    });
    await appendWorkflowEvent({
      workflowId: bundle.workflow.id,
      type: "workflow_completed",
      message: "Workflow completed",
      payload: { finalOutputs },
    });
  }
}

async function finalizeFailedWorkflow(
  workflowId: string,
  userId: string,
  costEstimate: WorkflowCostEstimate | null,
  reserved: number,
  steps: WorkflowStepRecord[]
) {
  const settleAmount = estimateCompletedCost(costEstimate, steps.filter((step) => step.status === "completed").map((step) => step.step_key));
  const releaseAmount = Math.max(0, reserved - settleAmount);
  if (settleAmount > 0) await settleWorkflowCredits(userId, workflowId, settleAmount);
  if (releaseAmount > 0) await releaseWorkflowCredits(userId, workflowId, releaseAmount, `Agent workflow failed release (${workflowId})`);
  await setWorkflowStatus(workflowId, settleAmount > 0 ? "partially_completed" : "failed", {
    error_message: "Workflow failed after step error",
    cost_settled: settleAmount,
  });
  await appendWorkflowEvent({
    workflowId,
    type: settleAmount > 0 ? "workflow_partially_completed" : "workflow_failed",
    message: "Workflow stopped because a step failed",
    payload: { releaseAmount, settleAmount },
  });
}

function getReadySteps(steps: WorkflowStepRecord[]) {
  return steps.filter((step) => step.status === "ready");
}

async function recoverInterruptedSteps(bundle: WorkflowBundle) {
  if (bundle.workflow.status !== "running") return bundle;

  const interrupted = bundle.steps.filter((step) => step.status === "running" || step.status === "queued");
  if (!interrupted.length) return bundle;

  for (const step of interrupted) {
    await setStepStatus(step.id, "ready", {
      errorMessage: "Recovered from an interrupted worker run; retrying this step.",
      retryCount: step.retry_count,
    });
    await appendWorkflowEvent({
      workflowId: bundle.workflow.id,
      stepId: step.id,
      type: "step_retried",
      message: `${step.title} recovered after interrupted worker run`,
      payload: { recoveredStatus: step.status, retryCount: step.retry_count },
    });
  }

  return getRequiredWorkerBundle(bundle.workflow.id);
}

async function refreshAfterMarkingReadySteps(workflowId: string, bundle: WorkflowBundle) {
  await markNewReadySteps(bundle);
  return getRequiredWorkerBundle(workflowId);
}

async function getRequiredWorkerBundle(workflowId: string) {
  const refreshed = await getWorkflowBundleForWorker(workflowId);
  if (!refreshed) throw new Error("Workflow disappeared during execution");
  return refreshed;
}

function isTerminalOutputStep(steps: WorkflowStepRecord[], step: WorkflowStepRecord) {
  return !steps.some((candidate) =>
    !["skipped", "cancelled"].includes(candidate.status) &&
    candidate.depends_on.includes(step.step_key)
  );
}

function collectFinalOutputs(steps: WorkflowStepRecord[]): WorkflowStepResultOutput {
  const lastCompleted = [...steps].reverse().find((step) => step.status === "completed" && step.output);
  if (lastCompleted?.output) return lastCompleted.output;
  return {
    imageUrls: steps.flatMap((step) => step.output?.imageUrls || []),
  };
}

function estimateCompletedCost(costEstimate: WorkflowCostEstimate | null, completedStepIds: string[]) {
  if (!costEstimate) return 0;
  const completed = new Set(completedStepIds);
  return costEstimate.steps
    .filter((step) => completed.has(step.stepId))
    .reduce((sum, step) => sum + step.estimatedCredits, 0);
}
