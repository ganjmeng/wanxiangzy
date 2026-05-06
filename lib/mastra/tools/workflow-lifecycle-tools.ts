import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  appendWorkflowEvent,
  cancelWorkflowSteps,
  getLatestWorkflowBundle,
  getWorkflowBundle,
  releaseWorkflowCredits,
  setWorkflowStatus,
  type WorkflowBundle,
} from "@/lib/agent/workflow/repository";

const requestContextSchema = z.object({
  userId: z.string().min(1),
  conversationId: z.string().nullable().optional(),
}).passthrough();

const workflowLookupInputSchema = z.object({
  workflowId: z.string().min(1).optional().describe("Workflow id. If omitted, the latest workflow in the conversation is used."),
});

const workflowStatusOutputSchema = z.object({
  kind: z.literal("workflow_status"),
  found: z.boolean(),
  message: z.string(),
  workflow: z.object({
    id: z.string(),
    status: z.string(),
    summary: z.string().nullable().optional(),
    intent: z.string().nullable().optional(),
    costReserved: z.number(),
    costSettled: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }).optional(),
  progress: z.object({
    total: z.number(),
    completed: z.number(),
    running: z.number(),
    failed: z.number(),
    pending: z.number(),
  }).optional(),
  steps: z.array(z.object({
    id: z.string(),
    title: z.string(),
    type: z.string(),
    status: z.string(),
    errorMessage: z.string().nullable().optional(),
  })).optional(),
  outputs: z.array(z.object({
    kind: z.string(),
    role: z.string(),
    url: z.string(),
  })).optional(),
  events: z.array(z.object({
    id: z.string(),
    type: z.string(),
    message: z.string().nullable().optional(),
    createdAt: z.string(),
  })).optional(),
});

const cancelWorkflowOutputSchema = z.object({
  kind: z.literal("workflow_cancel"),
  ok: z.boolean(),
  message: z.string(),
  workflowId: z.string().optional(),
  status: z.string().optional(),
  releasedCredits: z.number().optional(),
});

export const getWorkflowStatusTool = createTool({
  id: "getWorkflowStatus",
  description: [
    "Read the saved workflow status, progress, steps, and generated output URLs.",
    "Use this when the user asks about progress, results, what happened, or the latest task.",
  ].join(" "),
  inputSchema: workflowLookupInputSchema,
  outputSchema: workflowStatusOutputSchema,
  requestContextSchema,
  execute: async (input, context) => {
    const userId = context.requestContext?.get("userId") as string | undefined;
    const conversationId = context.requestContext?.get("conversationId") as string | null | undefined;
    if (!userId) {
      return {
        kind: "workflow_status" as const,
        found: false,
        message: "Missing authenticated user context.",
      };
    }

    const bundle = await resolveWorkflowBundle({
      userId,
      conversationId,
      workflowId: input.workflowId,
    });
    if (!bundle) {
      return {
        kind: "workflow_status" as const,
        found: false,
        message: "No workflow found in the current conversation.",
      };
    }

    return summarizeWorkflowBundle(bundle);
  },
});

export const cancelWorkflowTool = createTool({
  id: "cancelWorkflow",
  description: [
    "Cancel a saved workflow that has not finished and release unspent reserved credits.",
    "Use only when the user clearly asks to cancel, stop, abort, or withdraw a workflow.",
  ].join(" "),
  inputSchema: workflowLookupInputSchema,
  outputSchema: cancelWorkflowOutputSchema,
  requestContextSchema,
  execute: async (input, context) => {
    const userId = context.requestContext?.get("userId") as string | undefined;
    const conversationId = context.requestContext?.get("conversationId") as string | null | undefined;
    if (!userId) {
      return {
        kind: "workflow_cancel" as const,
        ok: false,
        message: "Missing authenticated user context.",
      };
    }

    const bundle = await resolveWorkflowBundle({
      userId,
      conversationId,
      workflowId: input.workflowId,
    });
    if (!bundle) {
      return {
        kind: "workflow_cancel" as const,
        ok: false,
        message: "No cancellable workflow found in the current conversation.",
      };
    }

    const status = bundle.workflow.status;
    if (["completed", "failed", "cancelled"].includes(status)) {
      return {
        kind: "workflow_cancel" as const,
        ok: false,
        workflowId: bundle.workflow.id,
        status,
        message: `Workflow is already ${status} and cannot be cancelled.`,
      };
    }

    const releasedCredits = Math.max(
      0,
      Number(bundle.workflow.cost_reserved || 0) - Number(bundle.workflow.cost_settled || 0),
    );
    if (releasedCredits > 0) {
      await releaseWorkflowCredits(
        userId,
        bundle.workflow.id,
        releasedCredits,
        `Agent workflow cancelled release (${bundle.workflow.id})`,
      );
      await appendWorkflowEvent({
        workflowId: bundle.workflow.id,
        type: "credit_released",
        message: `Released ${releasedCredits} credits`,
        payload: { releaseAmount: releasedCredits },
      });
    }

    await cancelWorkflowSteps(bundle.workflow.id, "Workflow cancelled by Mastra agent");
    await setWorkflowStatus(bundle.workflow.id, "cancelled");
    await appendWorkflowEvent({
      workflowId: bundle.workflow.id,
      type: "workflow_cancelled",
      message: "Workflow cancelled by Mastra agent",
    });

    return {
      kind: "workflow_cancel" as const,
      ok: true,
      workflowId: bundle.workflow.id,
      status: "cancelled",
      releasedCredits,
      message: releasedCredits > 0
        ? `Workflow cancelled. Released ${releasedCredits} reserved credits.`
        : "Workflow cancelled.",
    };
  },
});

async function resolveWorkflowBundle(params: {
  userId: string;
  conversationId?: string | null;
  workflowId?: string;
}) {
  if (params.workflowId) {
    return getWorkflowBundle(params.workflowId, params.userId);
  }

  return getLatestWorkflowBundle({
    userId: params.userId,
    conversationId: params.conversationId || null,
  });
}

function summarizeWorkflowBundle(bundle: WorkflowBundle): z.infer<typeof workflowStatusOutputSchema> {
  const completed = bundle.steps.filter((step) => step.status === "completed").length;
  const running = bundle.steps.filter((step) => step.status === "running" || step.status === "queued").length;
  const failed = bundle.steps.filter((step) => step.status === "failed").length;
  const pending = bundle.steps.length - completed - running - failed;
  const outputs = [...bundle.assets]
    .sort((left, right) => Number(right.role === "final") - Number(left.role === "final"))
    .filter((asset) => asset.role !== "source")
    .map((asset) => ({
      kind: asset.kind,
      role: asset.role,
      url: asset.url,
    }));

  const finalOutputUrls = [
    ...(bundle.workflow.final_outputs?.imageUrls || []),
    ...(bundle.workflow.final_outputs?.videoUrls || []),
  ];
  for (const url of finalOutputUrls) {
    if (!outputs.some((asset) => asset.url === url)) {
      outputs.push({
        kind: url.match(/\.(mp4|mov|webm)(\?|$)/i) ? "video" : "image",
        role: "final",
        url,
      });
    }
  }

  return {
    kind: "workflow_status" as const,
    found: true,
    message: buildStatusMessage(bundle, { completed, running, failed, pending }),
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
      total: bundle.steps.length,
      completed,
      running,
      failed,
      pending: Math.max(0, pending),
    },
    steps: bundle.steps.map((step) => ({
      id: step.id,
      title: step.title,
      type: step.type,
      status: step.status,
      errorMessage: step.error_message || null,
    })),
    outputs,
    events: bundle.events.slice(-6).map((event) => ({
      id: event.id,
      type: event.type,
      message: event.message,
      createdAt: event.created_at,
    })),
  };
}

function buildStatusMessage(
  bundle: WorkflowBundle,
  progress: { completed: number; running: number; failed: number; pending: number },
) {
  const status = bundle.workflow.status;
  if (status === "completed") return "Workflow completed.";
  if (status === "partially_completed") return "Workflow partially completed. Some outputs are available.";
  if (status === "failed") return bundle.workflow.error_message || "Workflow failed.";
  if (status === "cancelled") return "Workflow cancelled.";
  if (status === "needs_confirmation") return "Workflow is waiting for user approval.";
  if (status === "confirmed" || status === "queued") return "Workflow is queued for processing.";
  if (status === "running") return `Workflow is running: ${progress.completed}/${bundle.steps.length} steps completed.`;
  return `Workflow status: ${status}.`;
}
