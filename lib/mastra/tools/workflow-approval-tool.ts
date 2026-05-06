import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getAgentKnowledgeContext } from "@/lib/agent/brain/knowledge";
import { recordAgentMetric } from "@/lib/agent/brain/metrics";
import { getAgentUserPreferences } from "@/lib/agent/brain/preferences";
import { estimateWorkflowCost } from "@/lib/agent/workflow/cost";
import { createWorkflowRecord } from "@/lib/agent/workflow/repository";
import { applyDefaultsToPlan, normalizeGenerationDefaults } from "@/lib/agent/workflow/request";
import { validateWorkflowPlan } from "@/lib/agent/workflow/validator";
import { buildWorkflowApprovalInputFromWorkflow } from "@/lib/agent-v2/workflow-approval";
import { critiqueWorkflowPlanWithMastra } from "@/lib/mastra/planning/workflow-critic";
import { planWorkflowWithMastra } from "@/lib/mastra/planning/workflow-planner";
import type { MastraAgentUiContext } from "@/lib/mastra/planning/chat-router";
import type { WorkflowInputImage } from "@/lib/agent/workflow/types";

const workflowImageSchema = z.object({
  index: z.number().int().positive().optional(),
  url: z.string().optional(),
  role: z.string().optional(),
  fileName: z.string().optional(),
});

const requestContextSchema = z.object({
  userId: z.string().min(1),
  conversationId: z.string().nullable().optional(),
  userText: z.string().optional(),
  images: z.array(workflowImageSchema).optional(),
  defaults: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const createWorkflowApprovalInputSchema = z.object({
  userText: z.string().min(1).describe("The user's full visual task request."),
  images: z.array(workflowImageSchema).optional().describe("Attached images relevant to the task."),
  defaults: z.record(z.string(), z.unknown()).optional().describe("Optional explicit generation defaults from the user."),
  userPreferences: z.record(z.string(), z.unknown()).optional().describe("Optional persistent user preferences already loaded by the agent."),
});

const createWorkflowApprovalOutputSchema = z.object({
  state: z.enum(["waiting_approval", "needs_clarification", "failed"]),
  canExecute: z.literal(false),
  message: z.string(),
  approval: z.unknown().optional(),
});

export const createWorkflowApprovalTool = createTool({
  id: "createWorkflowApproval",
  description: [
    "Plan a production visual workflow and create a user approval card.",
    "Use this only for image/text-to-image/image-to-image/try-on/pose/3D/product-detail-page tasks.",
    "The tool saves a workflow record and never reserves credits or starts generation.",
  ].join(" "),
  inputSchema: createWorkflowApprovalInputSchema,
  outputSchema: createWorkflowApprovalOutputSchema,
  requestContextSchema,
  execute: async (input, context) => {
    const requestContext = context.requestContext;
    const userId = requestContext?.get("userId") as string | undefined;
    const conversationId = requestContext?.get("conversationId") as string | null | undefined;
    const contextText = requestContext?.get("userText") as string | undefined;
    const contextImages = requestContext?.get("images") as WorkflowInputImage[] | undefined;
    const contextDefaults = requestContext?.get("defaults") as Record<string, unknown> | undefined;
    const contextUiContext = requestContext?.get("uiContext") as MastraAgentUiContext | undefined;

    const userText = (input.userText || contextText || "").trim();
    const images = resolveWorkflowImages(input.images, contextImages);

    if (!userId) {
      return {
        state: "failed" as const,
        canExecute: false as const,
        message: "Missing authenticated user context.",
      };
    }

    if (!userText) {
      return {
        state: "needs_clarification" as const,
        canExecute: false as const,
        message: "Please describe what you want to create.",
      };
    }

    try {
      const started = Date.now();
      const defaults = normalizeGenerationDefaults(hasValues(input.defaults) ? input.defaults : contextDefaults || {});
      const [storedPreferences, knowledge] = await Promise.all([
        getAgentUserPreferences(userId),
        getAgentKnowledgeContext({
          userId,
          conversationId: conversationId || null,
          query: userText,
          limit: 6,
        }),
      ]);
      const userPreferences = {
        ...storedPreferences,
        ...(input.userPreferences || {}),
        knowledge: knowledge.map((item) => ({
          scope: item.scope,
          title: item.title,
          content: item.content.slice(0, 800),
          tags: item.tags,
        })),
      };
      const rawPlan = await planWorkflowWithMastra({
        userText,
        images,
        defaults,
        userPreferences,
        uiContext: contextUiContext,
      });
      const plan = applyDefaultsToPlan(rawPlan, defaults);
      const validation = validateWorkflowPlan({ plan, images, defaults });
      const finalPlan = validation.repairedPlan || plan;

      if (finalPlan.needsClarification || (!validation.ok && validation.clarificationQuestion)) {
        void recordAgentMetric({
          userId,
          conversationId,
          event: "mastra_workflow_planning_blocked",
          route: "mastra:createWorkflowApproval",
          ok: false,
          latencyMs: Date.now() - started,
          action: "needs_clarification",
          confidence: finalPlan.confidence,
          module: finalPlan.intent,
          metadata: {
            stage: "validator",
            message: finalPlan.clarificationQuestion || validation.clarificationQuestion,
          },
        });
        return {
          state: "needs_clarification" as const,
          canExecute: false as const,
          message: finalPlan.clarificationQuestion || validation.clarificationQuestion || "I need one more detail before I can plan this safely.",
        };
      }

      if (!validation.ok && validation.errors.some((issue) => issue.severity === "error")) {
        void recordAgentMetric({
          userId,
          conversationId,
          event: "mastra_workflow_planning_blocked",
          route: "mastra:createWorkflowApproval",
          ok: false,
          latencyMs: Date.now() - started,
          action: "validation_error",
          confidence: finalPlan.confidence,
          module: finalPlan.intent,
          metadata: {
            stage: "validator",
            errors: validation.errors.map((issue) => issue.code),
          },
        });
        return {
          state: "needs_clarification" as const,
          canExecute: false as const,
          message: validation.errors[0]?.message || "I need one more detail before I can build a safe workflow.",
        };
      }

      const critic = await critiqueWorkflowPlanWithMastra({
        userText,
        images,
        plan: finalPlan,
        validation,
        defaults,
        userPreferences,
      });
      if (!critic.ok || critic.action !== "approve") {
        void recordAgentMetric({
          userId,
          conversationId,
          event: "mastra_workflow_planning_blocked",
          route: "mastra:createWorkflowApproval",
          ok: false,
          latencyMs: Date.now() - started,
          action: `critic_${critic.action}`,
          confidence: critic.score,
          module: finalPlan.intent,
          metadata: {
            stage: "critic",
            source: critic.source,
            issues: critic.issues.map((issue) => issue.code),
          },
        });
        return {
          state: "needs_clarification" as const,
          canExecute: false as const,
          message: critic.message || "I need one more detail before I can build a safe workflow.",
        };
      }

      const finalValidation = {
        ...validation,
        warnings: [
          ...validation.warnings,
          ...critic.issues
            .filter((issue) => issue.severity === "warning")
            .map((issue) => ({
              code: `CRITIC_${issue.code}`,
              message: issue.message,
              stepId: issue.stepId,
              severity: "warning" as const,
            })),
        ],
      };
      const costEstimate = estimateWorkflowCost(finalPlan, defaults);
      const bundle = await createWorkflowRecord({
        userId,
        conversationId: conversationId || null,
        mode: "agent",
        inputImages: images,
        plan: finalPlan,
        validation: finalValidation,
        costEstimate,
        idempotencyKey: conversationId
          ? `mastra:${conversationId}:${stableWorkflowKey(userText, images)}`
          : null,
      });

      const approval = buildWorkflowApprovalInputFromWorkflow({
        workflow: bundle.workflow,
        plan: finalPlan,
        steps: bundle.steps,
        costEstimate,
        inputImages: images,
      });

      void recordAgentMetric({
        userId,
        conversationId,
        event: "mastra_workflow_planned",
        route: "mastra:createWorkflowApproval",
        ok: true,
        latencyMs: Date.now() - started,
        action: "waiting_approval",
        confidence: finalPlan.confidence,
        module: finalPlan.intent,
        metadata: {
          workflowId: bundle.workflow.id,
          stepTypes: finalPlan.steps.map((step) => step.type),
          costEstimate: costEstimate.total,
          criticScore: critic.score,
          criticSource: critic.source,
        },
      });

      return {
        state: "waiting_approval" as const,
        canExecute: false as const,
        message: "Workflow planned. Ask the user to review and approve before execution.",
        approval,
      };
    } catch (error) {
      console.error("[mastra:createWorkflowApproval] failed:", error);
      void recordAgentMetric({
        userId,
        conversationId,
        event: "mastra_workflow_planning_failed",
        route: "mastra:createWorkflowApproval",
        ok: false,
        action: "exception",
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return {
        state: "failed" as const,
        canExecute: false as const,
        message: error instanceof Error ? error.message : "Workflow planning failed.",
      };
    }
  },
});

function hasValues(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
}

function normalizeWorkflowImages(images: unknown): WorkflowInputImage[] {
  if (!Array.isArray(images)) return [];

  const normalized: WorkflowInputImage[] = [];
  const seen = new Set<string>();
  for (const [index, image] of images.entries()) {
    if (!image || typeof image !== "object") continue;
    const record = image as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    normalized.push({
      index: typeof record.index === "number" ? record.index : index + 1,
      url,
      role: typeof record.role === "string" ? record.role as WorkflowInputImage["role"] : "auto",
      fileName: typeof record.fileName === "string" ? record.fileName : undefined,
    });
  }
  return normalized.slice(0, 8).map((image, index) => ({ ...image, index: index + 1 }));
}

function resolveWorkflowImages(inputImages: unknown, contextImages: unknown): WorkflowInputImage[] {
  const fromInput = normalizeWorkflowImages(inputImages);
  if (fromInput.length > 0) return fromInput;

  const fromContext = normalizeWorkflowImages(contextImages);
  if (!Array.isArray(inputImages) || fromContext.length === 0) return fromContext;

  const rolesByIndex = new Map<number, WorkflowInputImage["role"]>();
  for (const image of inputImages) {
    if (!image || typeof image !== "object") continue;
    const record = image as Record<string, unknown>;
    const index = typeof record.index === "number" ? record.index : undefined;
    const role = typeof record.role === "string" ? record.role as WorkflowInputImage["role"] : undefined;
    if (index && role) rolesByIndex.set(index, role);
  }

  return fromContext.map((image) => ({
    ...image,
    role: rolesByIndex.get(image.index) || image.role,
  }));
}

function stableWorkflowKey(text: string, images: WorkflowInputImage[]) {
  const input = JSON.stringify({ text, images: images.map((image) => image.url) });
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
