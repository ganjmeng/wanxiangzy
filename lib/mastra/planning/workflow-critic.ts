import { generateText, Output } from "ai";
import { z } from "zod";
import type {
  GenerationDefaults,
  PlanValidationIssue,
  PlanValidationResult,
  WorkflowInputImage,
  WorkflowPlan,
  WorkflowStepPlan,
} from "@/lib/agent/workflow/types";
import { getMastraAgentModel, getMastraAgentModelInfo } from "@/lib/mastra/model";

export type WorkflowCriticIssue = {
  code: string;
  severity: "warning" | "blocker";
  message: string;
  stepId?: string;
};

export type WorkflowCriticResult = {
  ok: boolean;
  action: "approve" | "clarify" | "reject";
  score: number;
  message: string;
  issues: WorkflowCriticIssue[];
  source: "deterministic" | "llm" | "fallback";
};

export type WorkflowCriticRequest = {
  userText: string;
  images: WorkflowInputImage[];
  plan: WorkflowPlan;
  validation: PlanValidationResult;
  defaults: GenerationDefaults;
  userPreferences?: Record<string, unknown>;
};

const criticOutputSchema = z.object({
  ok: z.boolean(),
  action: z.enum(["approve", "clarify", "reject"]),
  score: z.number().min(0).max(1),
  message: z.string(),
  issues: z.array(z.object({
    code: z.string(),
    severity: z.enum(["warning", "blocker"]),
    message: z.string(),
    stepId: z.string().optional(),
  })),
});

type CriticOutput = z.infer<typeof criticOutputSchema>;

export async function critiqueWorkflowPlanWithMastra(request: WorkflowCriticRequest): Promise<WorkflowCriticResult> {
  const deterministic = runDeterministicPlanCritic(request);
  if (!deterministic.ok || deterministic.action !== "approve") return deterministic;

  try {
    const result = await generateText({
      model: getMastraAgentModel(),
      temperature: 0,
      maxOutputTokens: 1000,
      output: Output.object({ schema: criticOutputSchema }),
      system: [
        "You are an independent verifier for a production visual-commerce agent.",
        "Return structured output only.",
        "Do not create a new plan. Review whether the proposed workflow faithfully matches the user's request.",
        "Block unsafe or clearly wrong plans. Ask a concise Chinese clarification question if needed.",
        "Pay special attention to ecommerce detail pages, image number relationships, try-on direction, pose output mode, disabled tools, and user negative constraints.",
      ].join("\n"),
      prompt: buildCriticPrompt(request),
    });

    return normalizeCriticOutput(result.output, deterministic.issues);
  } catch (error) {
    console.error("[mastra:workflow-critic] failed:", {
      model: getMastraAgentModelInfo(),
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ...deterministic,
      source: "fallback",
      issues: [
        ...deterministic.issues,
        {
          code: "LLM_CRITIC_UNAVAILABLE",
          severity: "warning",
          message: "LLM critic unavailable; deterministic checks passed.",
        },
      ],
    };
  }
}

export function runDeterministicPlanCritic(request: WorkflowCriticRequest): WorkflowCriticResult {
  const issues: WorkflowCriticIssue[] = [];
  const text = request.userText;
  const steps = request.plan.steps;

  for (const error of request.validation.errors) {
    issues.push(toCriticIssue(error));
  }

  if (request.plan.needsClarification) {
    issues.push({
      code: "PLAN_NEEDS_CLARIFICATION",
      severity: "blocker",
      message: request.plan.clarificationQuestion || "需要补充任务信息。",
    });
  }

  if (!steps.length) {
    issues.push({
      code: "NO_EXECUTABLE_STEPS",
      severity: "blocker",
      message: "计划里没有可执行步骤。",
    });
  }

  const missingRefs = findMissingImageRefs(steps, request.images);
  for (const ref of missingRefs) {
    issues.push({
      code: "IMAGE_REF_NOT_FOUND",
      severity: "blocker",
      message: `计划引用了不存在的图片：图${ref}。`,
    });
  }

  if (isCommerceDetailRequest(text) && !steps.some((step) => step.type === "commerce_detail")) {
    issues.push({
      code: "DETAIL_PAGE_INTENT_MISMATCH",
      severity: "blocker",
      message: "用户要的是电商详情页/长图，但计划没有使用详情页工作流。",
    });
  }

  if (wantsSeparatePoseOutputs(text)) {
    const pose = steps.find((step) => step.type === "pose_variation");
    if (pose && pose.params.outputMode !== "separate") {
      issues.push({
        code: "POSE_OUTPUT_MODE_MISMATCH",
        severity: "blocker",
        stepId: pose.id,
        message: "用户要求每张姿势单独出图，但计划仍是拼图/宫格输出。",
      });
    }
  }

  if (excludesTryon(text) && steps.some((step) => step.type === "tryon")) {
    issues.push({
      code: "NEGATIVE_TRYON_CONFLICT",
      severity: "blocker",
      message: "用户明确排除了换装/上身，但计划包含换装步骤。",
    });
  }

  if (request.plan.confidence < 0.45) {
    issues.push({
      code: "LOW_PLAN_CONFIDENCE",
      severity: "blocker",
      message: "计划置信度偏低，需要先向用户确认。",
    });
  }

  const blockers = issues.filter((issue) => issue.severity === "blocker");
  if (blockers.length) {
    return {
      ok: false,
      action: "clarify",
      score: Math.min(0.45, request.plan.confidence || 0.35),
      message: blockers[0].message,
      issues,
      source: "deterministic",
    };
  }

  return {
    ok: true,
    action: "approve",
    score: Math.max(0.7, request.plan.confidence),
    message: "Plan passed deterministic checks.",
    issues,
    source: "deterministic",
  };
}

export function buildCriticPrompt(request: WorkflowCriticRequest) {
  return [
    "User request:",
    request.userText,
    "",
    "Images:",
    request.images.length
      ? request.images.map((image) => `图${image.index}: role=${image.role || "auto"} file=${image.fileName || ""}`).join("\n")
      : "none",
    "",
    "Generation defaults:",
    JSON.stringify(request.defaults),
    "",
    "Preferences and knowledge:",
    request.userPreferences ? JSON.stringify(request.userPreferences) : "none",
    "",
    "Proposed workflow plan:",
    JSON.stringify(request.plan),
    "",
    "Validation result:",
    JSON.stringify(request.validation),
    "",
    "Return approve only when the plan faithfully matches the user's original intent and can be safely shown as an approval card.",
  ].join("\n");
}

function normalizeCriticOutput(raw: CriticOutput, deterministicIssues: WorkflowCriticIssue[]): WorkflowCriticResult {
  const issues = [
    ...deterministicIssues,
    ...raw.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      stepId: issue.stepId,
    })),
  ];
  const hasBlocker = issues.some((issue) => issue.severity === "blocker");
  return {
    ok: raw.ok && !hasBlocker && raw.action === "approve",
    action: hasBlocker && raw.action === "approve" ? "clarify" : raw.action,
    score: clampScore(raw.score),
    message: raw.message || (hasBlocker ? "计划需要先确认。" : "Plan approved."),
    issues,
    source: "llm",
  };
}

function toCriticIssue(issue: PlanValidationIssue): WorkflowCriticIssue {
  return {
    code: issue.code,
    severity: issue.severity === "error" ? "blocker" : "warning",
    message: issue.message,
    stepId: issue.stepId,
  };
}

function findMissingImageRefs(steps: WorkflowStepPlan[], images: WorkflowInputImage[]) {
  const available = new Set(images.map((image) => image.index));
  const refs = new Set<number>();
  for (const step of steps) {
    const text = JSON.stringify({ input: step.input, params: step.params });
    for (const match of text.matchAll(/(?:图|image)\s*(\d+)/gi)) {
      refs.add(Number(match[1]));
    }
  }
  return Array.from(refs).filter((ref) => !available.has(ref));
}

function isCommerceDetailRequest(text: string) {
  return /详情页|长图|淘宝|天猫|京东|卖点图|参数图|商品详情/i.test(text) && !/不要.*详情页|不是.*详情页/.test(text);
}

function wantsSeparatePoseOutputs(text: string) {
  return /每张.*单独|单独出图|独立出图|一张一张|每个姿势一张/i.test(text);
}

function excludesTryon(text: string) {
  return /不要.*(换装|上身|试穿)|不是.*(换装|上身|试穿)/i.test(text);
}

function clampScore(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return 0.5;
  return Math.max(0, Math.min(1, num));
}
