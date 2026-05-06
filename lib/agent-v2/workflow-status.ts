import type {
  WorkflowAssetRecord,
  WorkflowEventRecord,
  WorkflowRecord,
  WorkflowStepRecord,
  QualityCheckResult,
} from "@/lib/agent/workflow/types";

export type WorkflowStatusToolResult = {
  kind: "workflow_status";
  found: boolean;
  message: string;
  workflow?: {
    id: string;
    status: string;
    summary?: string | null;
    intent?: string | null;
    costReserved: number;
    costSettled: number;
    createdAt: string;
    updatedAt: string;
  };
  progress?: {
    total: number;
    completed: number;
    running: number;
    failed: number;
    pending: number;
  };
  steps?: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    errorMessage?: string | null;
    quality?: QualityCheckResult | null;
  }>;
  outputs?: Array<{
    kind: string;
    role: string;
    url: string;
  }>;
  events?: Array<{
    id: string;
    type: string;
    message?: string | null;
    payload?: Record<string, unknown>;
    createdAt: string;
  }>;
};

export type WorkflowStatusBundleResponse = {
  ok?: boolean;
  workflow: WorkflowRecord;
  steps?: WorkflowStepRecord[];
  assets?: WorkflowAssetRecord[];
  events?: WorkflowEventRecord[];
};

export function buildWorkflowStatusResultFromBundle(
  bundle: WorkflowStatusBundleResponse,
): WorkflowStatusToolResult {
  const steps = bundle.steps || [];
  const assets = bundle.assets || [];
  const completed = steps.filter((step) => step.status === "completed").length;
  const running = steps.filter((step) => step.status === "running" || step.status === "queued").length;
  const failed = steps.filter((step) => step.status === "failed").length;
  const pending = Math.max(0, steps.length - completed - running - failed);
  const outputs = collectWorkflowOutputs(bundle.workflow, assets);

  return {
    kind: "workflow_status",
    found: true,
    message: buildStatusMessage(bundle.workflow, { completed, failed, pending }),
    workflow: {
      id: bundle.workflow.id,
      status: bundle.workflow.status,
      summary: bundle.workflow.summary,
      intent: bundle.workflow.intent,
      costReserved: Number(bundle.workflow.cost_reserved || 0),
      costSettled: Number(bundle.workflow.cost_settled || 0),
      createdAt: bundle.workflow.created_at,
      updatedAt: bundle.workflow.updated_at,
    },
    progress: {
      total: steps.length,
      completed,
      running,
      failed,
      pending,
    },
    steps: steps.map((step) => ({
      id: step.id,
      title: step.title,
      type: step.type,
      status: step.status,
      errorMessage: step.error_message || null,
      quality: step.quality || null,
    })),
    outputs,
    events: (bundle.events || []).slice(-6).map((event) => ({
      id: event.id,
      type: event.type,
      message: event.message,
      payload: event.payload,
      createdAt: event.created_at,
    })),
  };
}

export function isWorkflowTerminalStatus(status: string | undefined) {
  return Boolean(status && ["completed", "partially_completed", "failed", "cancelled"].includes(status));
}

export function isWorkflowCancellableStatus(status: string | undefined) {
  return Boolean(status && !isWorkflowTerminalStatus(status) && status !== "needs_confirmation");
}

function collectWorkflowOutputs(workflow: WorkflowRecord, assets: WorkflowAssetRecord[]) {
  const outputs = [...assets]
    .sort((left, right) => Number(right.role === "final") - Number(left.role === "final"))
    .filter((asset) => asset.role !== "source")
    .map((asset) => ({
      kind: asset.kind,
      role: asset.role,
      url: asset.url,
    }));

  const finalOutputUrls = [
    ...(workflow.final_outputs?.imageUrls || []),
    ...(workflow.final_outputs?.videoUrls || []),
  ];
  for (const url of finalOutputUrls) {
    if (!outputs.some((asset) => asset.url === url)) {
      outputs.push({
        kind: /\.(mp4|mov|webm)(\?|$)/i.test(url) ? "video" : "image",
        role: "final",
        url,
      });
    }
  }

  return outputs;
}

function buildStatusMessage(
  workflow: WorkflowRecord,
  progress: { completed: number; failed: number; pending: number },
) {
  const status = workflow.status;
  if (status === "completed") return "任务已完成。";
  if (status === "partially_completed") return "任务已部分完成，已有结果可以查看。";
  if (status === "failed") return workflow.error_message || "任务执行失败。";
  if (status === "cancelled") return "任务已取消。";
  if (status === "needs_confirmation") return "任务正在等待确认。";
  if (status === "confirmed" || status === "queued") return "任务已确认，正在排队执行。";
  if (status === "running") return `任务执行中：已完成 ${progress.completed} 步，待处理 ${progress.pending} 步。`;
  if (progress.failed > 0) return "任务有步骤失败，等待处理。";
  return `任务状态：${status}。`;
}
