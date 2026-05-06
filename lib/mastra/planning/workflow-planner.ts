import { generateText, Output } from "ai";
import { z } from "zod";
import { getPlannerToolCatalog } from "@/lib/agent/workflow/tools";
import type { MastraAgentUiContext } from "@/lib/mastra/planning/chat-router";
import type {
  GenerationDefaults,
  ImageRoleResolution,
  WorkflowInputImage,
  WorkflowPlan,
  WorkflowStepOutputShape,
  WorkflowStepPlan,
  WorkflowToolType,
} from "@/lib/agent/workflow/types";
import { getMastraAgentModel, getMastraAgentModelInfo } from "@/lib/mastra/model";

export type MastraWorkflowPlannerRequest = {
  userText: string;
  images: WorkflowInputImage[];
  defaults: GenerationDefaults;
  userPreferences?: Record<string, unknown>;
  conversationSummary?: string;
  activeWorkflowSummary?: string;
  uiContext?: MastraAgentUiContext;
};

const workflowToolTypeSchema = z.enum([
  "text_to_image",
  "image_to_image",
  "tryon",
  "pose_variation",
  "garment_3d",
  "commerce_detail",
  "commerce_creative",
  "background_replace",
  "select_image",
  "image_quality_check",
  "prompt_repair",
  "image_to_video",
  "image_to_3d_asset",
]);

const imageRoleSchema = z.enum([
  "auto",
  "person",
  "clothing",
  "product",
  "background",
  "style",
  "source",
  "reference",
  "face",
  "unknown",
]);

const plannerOutputSchema = z.object({
  intent: z.string(),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().optional(),
  imageRoles: z.array(z.object({
    ref: z.string(),
    imageIndex: z.number().int().positive(),
    role: imageRoleSchema,
    confidence: z.number().min(0).max(1),
    reason: z.string().optional(),
  })),
  userConstraints: z.array(z.string()),
  assumptions: z.array(z.string()),
  steps: z.array(z.object({
    id: z.string(),
    type: workflowToolTypeSchema,
    title: z.string(),
    dependsOn: z.array(z.string()),
    input: z.record(z.string(), z.unknown()),
    params: z.record(z.string(), z.unknown()),
    expectedOutput: z.object({
      imageUrls: z.boolean().optional(),
      videoUrls: z.boolean().optional(),
      selectedImageUrl: z.boolean().optional(),
      text: z.boolean().optional(),
    }),
    riskNotes: z.array(z.string()).optional(),
  })),
});

type PlannerOutput = z.infer<typeof plannerOutputSchema>;

export async function planWorkflowWithMastra(request: MastraWorkflowPlannerRequest): Promise<WorkflowPlan> {
  const prompt = buildMastraPlannerPrompt(request);
  const started = Date.now();

  try {
    const result = await generateText({
      model: getMastraAgentModel(),
      temperature: 0.1,
      maxOutputTokens: 2200,
      output: Output.object({
        schema: plannerOutputSchema,
      }),
      system: [
        "You are Wanxiang's production workflow planner inside a Mastra agent.",
        "Return structured output only. Do not write prose.",
        "Plan semantically from the user's goal, image roles, and persistent preferences.",
        "Do not use brittle keyword templates.",
        "If image relationships or user intent are ambiguous, set needsClarification=true, ask one concise Chinese question, and return zero steps.",
        "Never spend credits or start generation. You only create a reviewable workflow plan.",
        "Use only the provided workflow tool catalog.",
        "Respect disabled tools. If the user asks for disabled video or true 3D asset generation, ask whether they want an available image workflow instead.",
        "Prefer the minimum reliable workflow. Do not over-plan.",
      ].join("\n"),
      prompt,
    });

    return normalizeMastraPlannerOutput(result.output, request);
  } catch (error) {
    console.error("[mastra:workflow-planner] failed:", {
      latencyMs: Date.now() - started,
      model: getMastraAgentModelInfo(),
      error: error instanceof Error ? error.message : String(error),
    });
    return buildClarificationPlan("我需要再确认一下你的目标和图片关系，才能安全创建生成工作流。");
  }
}

export function buildMastraPlannerPrompt(request: MastraWorkflowPlannerRequest) {
  return [
    "Workflow tool catalog:",
    JSON.stringify(getPlannerToolCatalog()),
    "",
    "Generation defaults:",
    JSON.stringify(request.defaults),
    "",
    "Composer UI context:",
    JSON.stringify(request.uiContext || { mode: "agent", speed: "Instant", appModule: "auto" }),
    "",
    "Images:",
    request.images.length
      ? request.images.map((image) => `图${image.index}: role=${image.role || "auto"} file=${image.fileName || ""}`).join("\n")
      : "none",
    "",
    request.userPreferences ? `Persistent preferences and knowledge:\n${JSON.stringify(request.userPreferences)}` : "Persistent preferences and knowledge: none",
    request.conversationSummary ? `Conversation summary:\n${request.conversationSummary}` : "",
    request.activeWorkflowSummary ? `Active workflow:\n${request.activeWorkflowSummary}` : "",
    "",
    "User request:",
    request.userText,
    "",
    "Planning rules:",
    "- Normal chat or capability questions are not visual workflows: ask no tool plan.",
    "- For text-to-image, image-to-image, try-on, pose variation, ecommerce detail page, ecommerce creative, background replacement, garment 3D display image: create executable steps.",
    "- Treat composer appModule as an explicit user hint, not decoration: tryon=>tryon, pose_variation=>pose_variation, ecommerce_detail=>commerce_detail, garment_3d=>garment_3d, image_create/free_create=>text_to_image or image_to_image.",
    "- If appModule=image_analysis and the user did not ask to generate, ask no workflow plan.",
    "- For multi-step requests such as try-on then pose variation, preserve dependencies explicitly.",
    "- If the user says each pose/image should be separate, use pose_variation params.outputMode='separate'; if they ask for a grid/collage, use 'grid'.",
    "- Preserve user freedom around style, camera, aspect ratio, and composition unless they explicitly lock them.",
    "- Do not silently reinterpret ecommerce detail-page requests as grass/seed content.",
    "- Keep prompts concise in params.prompt. Do not stuff long template text.",
  ].filter(Boolean).join("\n");
}

export function normalizeMastraPlannerOutput(raw: PlannerOutput, request: MastraWorkflowPlannerRequest): WorkflowPlan {
  const steps = raw.steps.map((step, index): WorkflowStepPlan => ({
    id: step.id.trim() || `step_${index + 1}`,
    type: step.type,
    title: step.title.trim() || defaultStepTitle(step.type),
    dependsOn: step.dependsOn.filter(Boolean),
    input: step.input || {},
    params: {
      prompt: request.userText,
      ...step.params,
    },
    expectedOutput: normalizeExpectedOutput(step.expectedOutput, step.type),
    riskNotes: step.riskNotes?.slice(0, 6) || [],
  }));

  return {
    intent: raw.intent.trim() || inferIntentFromSteps(steps),
    summary: raw.summary.trim() || request.userText,
    confidence: clampConfidence(raw.confidence),
    needsClarification: raw.needsClarification || steps.length === 0,
    clarificationQuestion: raw.clarificationQuestion?.trim() || (steps.length ? undefined : "你希望我具体生成或修改什么？"),
    imageRoles: normalizeImageRoles(raw.imageRoles, request.images),
    userConstraints: raw.userConstraints.map((item) => item.trim()).filter(Boolean).slice(0, 12),
    assumptions: raw.assumptions.map((item) => item.trim()).filter(Boolean).slice(0, 12),
    steps,
  };
}

function normalizeImageRoles(items: PlannerOutput["imageRoles"], images: WorkflowInputImage[]): ImageRoleResolution[] {
  const normalized = items
    .filter((item) => images.some((image) => image.index === item.imageIndex))
    .map((item) => ({
      ref: item.ref || `图${item.imageIndex}`,
      imageIndex: item.imageIndex,
      role: item.role,
      confidence: clampConfidence(item.confidence),
      reason: item.reason,
    }));

  if (normalized.length) return normalized;

  return images.map((image, index) => ({
    ref: `图${image.index}`,
    imageIndex: image.index,
    role: image.role && image.role !== "auto" ? image.role : index === 0 ? "source" : "reference",
    confidence: image.role && image.role !== "auto" ? 0.88 : 0.45,
    reason: image.role && image.role !== "auto" ? "来自用户设置的图片角色" : "图片角色未明确，按顺序保守推断",
  }));
}

function normalizeExpectedOutput(value: WorkflowStepOutputShape, type: WorkflowToolType): WorkflowStepOutputShape {
  if (value.imageUrls || value.videoUrls || value.selectedImageUrl || value.text) return value;
  if (type === "image_to_video") return { videoUrls: true };
  if (type === "select_image") return { selectedImageUrl: true };
  if (type === "image_quality_check" || type === "prompt_repair") return { text: true };
  return { imageUrls: true };
}

function defaultStepTitle(type: WorkflowToolType) {
  const titles: Record<WorkflowToolType, string> = {
    text_to_image: "文生图",
    image_to_image: "图生图",
    tryon: "人物换装",
    pose_variation: "姿势裂变",
    garment_3d: "服装 3D 展示图",
    commerce_detail: "电商详情页",
    commerce_creative: "电商创意图",
    background_replace: "替换背景",
    select_image: "选择最佳图片",
    image_quality_check: "图片质量检查",
    prompt_repair: "提示词修复",
    image_to_video: "图生视频",
    image_to_3d_asset: "真实 3D 资产",
  };
  return titles[type];
}

function inferIntentFromSteps(steps: WorkflowStepPlan[]) {
  if (steps.length > 1) return "multi_step_visual_workflow";
  return steps[0]?.type || "visual_workflow";
}

function buildClarificationPlan(message: string): WorkflowPlan {
  return {
    intent: "clarification",
    summary: message,
    confidence: 0.35,
    needsClarification: true,
    clarificationQuestion: message,
    imageRoles: [],
    userConstraints: [],
    assumptions: [],
    steps: [],
  };
}

function clampConfidence(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return 0.5;
  return Math.max(0, Math.min(1, num));
}
