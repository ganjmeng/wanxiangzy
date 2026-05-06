import { getChatCompletionsUrl, getLlmFallbackConfigs } from "@/lib/api/llm-provider";
import { getPlannerToolCatalog } from "@/lib/agent/workflow/tools";
import type {
  GenerationDefaults,
  ImageRoleResolution,
  WorkflowInputImage,
  WorkflowMode,
  WorkflowPlan,
  WorkflowStepPlan,
  WorkflowStepOutputShape,
  WorkflowToolType,
} from "@/lib/agent/workflow/types";

export type PlannerRequest = {
  userText: string;
  images: WorkflowInputImage[];
  mode: WorkflowMode;
  defaults: GenerationDefaults;
  fallbackStrategy?: "deterministic" | "clarify";
  conversationSummary?: string;
  activeWorkflowSummary?: string;
  userPreferences?: Record<string, unknown>;
};

type RawPlannerResponse = Partial<WorkflowPlan> & {
  action?: "chat" | "workflow" | "clarify";
};

export async function planWorkflow(request: PlannerRequest): Promise<WorkflowPlan> {
  if (request.mode === "chat") {
    return buildClarificationPlan("当前处于纯聊天模式，不会创建生成工作流。");
  }

  const llmPlan = await callPlannerModel(request).catch(() => null);
  const normalized = llmPlan ? normalizePlannerOutput(llmPlan, request) : null;
  if (request.fallbackStrategy === "clarify") {
    return normalized || buildClarificationPlan("我需要再确认一下你的目标和图片关系，才能安全创建生成工作流。");
  }

  const fallback = buildFallbackPlan(request);
  if (normalized) {
    if (shouldPreferFallbackPlan(normalized, fallback, request)) return fallback;
    return normalized;
  }

  return fallback;
}

async function callPlannerModel(request: PlannerRequest): Promise<RawPlannerResponse | null> {
  const providers = getLlmFallbackConfigs(request.images.length ? "vision" : "text");
  if (!providers.length) return null;

  const system = [
    "You are a production visual workflow planner.",
    "Return ONLY valid JSON. Do not execute tools.",
    "Plan by semantic intent, not by keyword matching.",
    "Use the provided tool catalog. If a tool is disabled, you may mention it but must not include it as an executable step.",
    "If critical information is missing, set needsClarification=true and ask one concise question.",
    "Respect user negative constraints strictly, such as 'do not make it Xiaohongshu/try-on/four-grid/video'.",
    "Prefer the minimum reliable number of steps.",
  ].join("\n");

  const text = [
    "Tool catalog:",
    JSON.stringify(getPlannerToolCatalog()),
    "",
    "Output schema:",
    JSON.stringify({
      intent: "string",
      summary: "string",
      confidence: "number 0-1",
      needsClarification: "boolean",
      clarificationQuestion: "string optional",
      imageRoles: [{ ref: "图1", imageIndex: 1, role: "person|clothing|product|background|style|source|reference|face|unknown", confidence: 0.8, reason: "string" }],
      userConstraints: ["string"],
      assumptions: ["string"],
      steps: [{
        id: "step_1",
        type: "text_to_image|image_to_image|tryon|pose_variation|garment_3d|commerce_detail|commerce_creative|background_replace|select_image|image_quality_check|prompt_repair",
        title: "string",
        dependsOn: ["step_1"],
        input: {},
        params: {},
        expectedOutput: { imageUrls: true },
        riskNotes: ["string"],
      }],
    }),
    "",
    `Mode: ${request.mode}`,
    `Default model: ${request.defaults.model}`,
    `Default aspectRatio: ${request.defaults.aspectRatio}`,
    `Default imageSize: ${request.defaults.imageSize}`,
    `Default count: ${request.defaults.count}`,
    request.conversationSummary ? `Conversation summary: ${request.conversationSummary}` : "",
    request.activeWorkflowSummary ? `Active workflow: ${request.activeWorkflowSummary}` : "",
    request.userPreferences ? `User preferences: ${JSON.stringify(request.userPreferences)}` : "",
    `Images: ${request.images.map((img) => `图${img.index} role=${img.role || "auto"} file=${img.fileName || ""}`).join("; ") || "none"}`,
    `User request: ${request.userText}`,
  ].filter(Boolean).join("\n");

  const content: Array<Record<string, unknown>> = [{ type: "text", text }];
  for (const image of request.images.slice(0, 8)) {
    content.push({ type: "image_url", image_url: { url: image.url } });
  }

  for (const provider of providers) {
    const response = await fetch(getChatCompletionsUrl(provider), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content },
        ],
      }),
      signal: AbortSignal.timeout(35_000),
    });

    const bodyText = await response.text();
    if (!response.ok) continue;
    const data = JSON.parse(bodyText);
    const modelText = data?.choices?.[0]?.message?.content;
    if (typeof modelText !== "string") continue;
    const parsed = extractJson(modelText);
    if (parsed) return parsed as RawPlannerResponse;
  }

  return null;
}

function normalizePlannerOutput(raw: RawPlannerResponse, request: PlannerRequest): WorkflowPlan | null {
  if (raw.action === "chat") return buildClarificationPlan(raw.summary || "这是普通聊天请求，不需要创建工作流。");

  const steps = Array.isArray(raw.steps)
    ? raw.steps.map((step, index) => normalizeStep(step, index)).filter((step): step is WorkflowStepPlan => Boolean(step))
    : [];

  if (!raw.needsClarification && steps.length === 0) return null;

  const imageRoles = Array.isArray(raw.imageRoles)
    ? raw.imageRoles.map((role) => normalizeImageRole(role, request.images)).filter((role): role is ImageRoleResolution => Boolean(role))
    : inferImageRoles(request.images);

  return {
    intent: String(raw.intent || inferIntentFromSteps(steps) || "visual_workflow"),
    summary: String(raw.summary || request.userText || "视觉工作流"),
    confidence: clampConfidence(raw.confidence),
    needsClarification: Boolean(raw.needsClarification),
    clarificationQuestion: typeof raw.clarificationQuestion === "string" ? raw.clarificationQuestion : undefined,
    imageRoles,
    userConstraints: Array.isArray(raw.userConstraints) ? raw.userConstraints.map(String).slice(0, 8) : inferNegativeConstraints(request.userText),
    assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.map(String).slice(0, 8) : [],
    steps,
  };
}

function normalizeStep(value: unknown, index: number): WorkflowStepPlan | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  if (!isPlannerToolType(type)) return null;
  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `step_${index + 1}`,
    type,
    title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : getDefaultStepTitle(type),
    dependsOn: Array.isArray(record.dependsOn) ? record.dependsOn.map(String).filter(Boolean) : [],
    input: isRecord(record.input) ? record.input : {},
    params: isRecord(record.params) ? record.params : {},
    expectedOutput: isRecord(record.expectedOutput) ? record.expectedOutput : defaultOutputShape(type),
    riskNotes: Array.isArray(record.riskNotes) ? record.riskNotes.map(String).slice(0, 5) : [],
  };
}

function buildFallbackPlan(request: PlannerRequest): WorkflowPlan {
  const text = request.userText;
  const roles = inferImageRoles(request.images);
  const steps: WorkflowStepPlan[] = [];
  const wantsVideo = /视频|短片|动起来|走秀|运镜|镜头运动/.test(text);
  const wants3d = /3d|3D|立体|悬浮|三维|商品展示/.test(text);
  const wantsTryon = /穿上|穿到|传到|转移到|套到|换到|换装|上身|试穿|把.*衣服.*(?:穿|传|转移|套|换)|(?:穿|传|转移|套|换).*衣服|衣服.*(?:穿|传|转移|套|换)|模特.*衣服/.test(text);
  const wantsPose = /姿势|站姿|动作|四宫格|多几个.*姿|不同.*姿|pose/i.test(text);
  const wantsDetail = /详情页|长图|卖点图|参数图|功能图|淘宝|天猫|京东/.test(text) && !/主图|banner|海报/.test(text);
  const wantsCreative = /主图|banner|海报|活动图|推广图|封面/.test(text);
  const hasImages = request.images.length > 0;
  const tryonRefs = inferExplicitTryonRefs(text, request.images);

  if (wantsTryon) {
    steps.push({
      id: "step_1",
      type: "tryon",
      title: "人物换装",
      dependsOn: [],
      input: {
        personImage: tryonRefs.personImage || findImageRef(roles, ["person", "source", "reference"]) || "图1",
        clothingImage: tryonRefs.clothingImage || findImageRef(roles, ["clothing", "product"]) || (request.images.length > 1 ? "图2" : "图1"),
      },
      params: { prompt: text, count: 1 },
      expectedOutput: { imageUrls: true },
      riskNotes: ["需要检查人物身份和服装结构是否稳定。"],
    });
  }

  if (wantsPose) {
    const dependsOn = steps.length ? [steps[steps.length - 1].id] : [];
    steps.push({
      id: `step_${steps.length + 1}`,
      type: "pose_variation",
      title: "姿势裂变",
      dependsOn,
      input: { sourceImage: dependsOn.length ? `$${dependsOn[0]}.output.imageUrls[0]` : "图1" },
      params: { prompt: text, outputMode: /每个|单独|独立/.test(text) ? "separate" : "grid" },
      expectedOutput: { imageUrls: true },
      riskNotes: ["需要检查手指、关节、脸和身体比例。"],
    });
  }

  if (wants3d) {
    steps.push({
      id: `step_${steps.length + 1}`,
      type: "garment_3d",
      title: "服装 3D 展示",
      dependsOn: [],
      input: { garmentImage: findImageRef(roles, ["clothing", "product", "source"]) || "图1" },
      params: { prompt: text, count: request.defaults.count },
      expectedOutput: { imageUrls: true },
      riskNotes: ["复杂穿着图生成 3D 展示会有结构还原风险。"],
    });
  }

  if (wantsDetail || wantsCreative) {
    steps.push({
      id: `step_${steps.length + 1}`,
      type: wantsDetail ? "commerce_detail" : "commerce_creative",
      title: wantsDetail ? "电商详情页" : "电商视觉图",
      dependsOn: [],
      input: { referenceImages: hasImages ? request.images.map((img) => `图${img.index}`) : [] },
      params: { prompt: text, count: request.defaults.count },
      expectedOutput: { imageUrls: true },
      riskNotes: wantsDetail ? ["需要检查是否生成了详情页分区，而不是单张氛围图。"] : [],
    });
  }

  if (!steps.length && /生成|制作|出图|设计|画|做一张|来一张|改图|重做|重新/.test(text)) {
    steps.push({
      id: "step_1",
      type: hasImages ? "image_to_image" : "text_to_image",
      title: hasImages ? "通用图生图" : "通用文生图",
      dependsOn: [],
      input: hasImages ? { sourceImages: request.images.map((img) => `图${img.index}`) } : {},
      params: { prompt: text, count: request.defaults.count },
      expectedOutput: { imageUrls: true },
      riskNotes: [],
    });
  }

  if (wantsVideo) {
    steps.push({
      id: `step_${steps.length + 1}`,
      type: "image_to_video",
      title: "图生视频（预留）",
      dependsOn: steps.length ? [steps[steps.length - 1].id] : [],
      input: { sourceImage: steps.length ? `$${steps[steps.length - 1].id}.output.imageUrls[0]` : "图1" },
      params: { motionPrompt: text },
      expectedOutput: { videoUrls: true },
      riskNotes: ["视频能力当前未开启，Validator 会阻断执行。"],
    });
  }

  if (!steps.length) {
    return buildClarificationPlan("我可以先聊天分析，也可以创建生图工作流。请补充你希望生成或修改什么。");
  }

  return {
    intent: inferIntentFromSteps(steps) || "visual_workflow",
    summary: summarizeSteps(steps),
    confidence: 0.68,
    needsClarification: false,
    imageRoles: roles,
    userConstraints: inferNegativeConstraints(text),
    assumptions: ["这是本地兜底规划，确认前请检查图片角色和步骤。"],
    steps,
  };
}

function shouldPreferFallbackPlan(normalized: WorkflowPlan, fallback: WorkflowPlan, request: PlannerRequest) {
  if (!fallback.steps.length) return false;
  const strongWorkflow = isStrongWorkflowRequest(request.userText, request.images.length);
  if (strongWorkflow && normalized.needsClarification && normalized.steps.length === 0) return true;
  const fallbackTypes = new Set(fallback.steps.map((step) => step.type));
  const normalizedTypes = new Set(normalized.steps.map((step) => step.type));
  if (strongWorkflow && fallback.steps.length > normalized.steps.length) return true;
  if (fallbackTypes.has("tryon") && !normalizedTypes.has("tryon")) return true;
  if (fallbackTypes.has("pose_variation") && /每张|单独|独立|不同姿势|姿势/.test(request.userText) && !normalizedTypes.has("pose_variation")) return true;
  return false;
}

function isStrongWorkflowRequest(text: string, imageCount: number) {
  if (imageCount > 0 && /然后|再|接着|最后|先.*再|从.*选|工作流|分步/.test(text)) return true;
  if (/图\d+.*(?:穿|传|转移|套|换).*图\d+|图\d+.*人物.*图\d+.*衣服|图\d+.*衣服.*图\d+.*(?:人物|模特|人)/.test(text)) return true;
  if (/每张.*单独|独立出图|不同姿势|四个.*姿势|4个.*姿势/.test(text)) return true;
  return false;
}

function inferExplicitTryonRefs(text: string, images: WorkflowInputImage[]) {
  const hasImage = (index: number) => images.some((image) => image.index === index);
  const patterns = [
    /图\s*(\d+)\s*(?:的)?(?:人物|模特|人)\s*(?:穿|换上|穿上|上身)\s*图\s*(\d+)\s*(?:的)?(?:衣服|服装|裙子|上衣|裤子|外套)?/,
    /图\s*(\d+)\s*(?:的)?(?:衣服|服装|裙子|上衣|裤子|外套)\s*(?:穿到|穿在|给|传到|转移到|套到|换到)\s*图\s*(\d+)\s*(?:的)?(?:人物|模特|人)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (!hasImage(first) || !hasImage(second)) continue;
    if (pattern === patterns[1]) {
      return { personImage: `图${second}`, clothingImage: `图${first}` };
    }
    return { personImage: `图${first}`, clothingImage: `图${second}` };
  }
  return { personImage: null, clothingImage: null };
}

function inferImageRoles(images: WorkflowInputImage[]): ImageRoleResolution[] {
  return images.map((image, index) => ({
    ref: `图${image.index}`,
    imageIndex: image.index,
    role: normalizeInputRole(image.role, index),
    confidence: image.role && image.role !== "auto" ? 0.9 : 0.55,
    reason: image.role && image.role !== "auto" ? "用户已设置图片角色" : "按图片顺序自动推测",
  }));
}

function normalizeInputRole(role: WorkflowInputImage["role"], index: number): ImageRoleResolution["role"] {
  if (role === "clothing") return "clothing";
  if (role === "face") return "face";
  if (role === "background") return "background";
  if (role === "source") return "source";
  if (role === "reference") return "reference";
  if (role === "person" || role === "product" || role === "style") return role;
  return index === 0 ? "source" : "reference";
}

function normalizeImageRole(value: unknown, images: WorkflowInputImage[]): ImageRoleResolution | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const imageIndex = Number(record.imageIndex || String(record.ref || "").match(/\d+/)?.[0]);
  if (!Number.isFinite(imageIndex) || !images.some((img) => img.index === imageIndex)) return null;
  const role = typeof record.role === "string" ? record.role : "unknown";
  return {
    ref: typeof record.ref === "string" ? record.ref : `图${imageIndex}`,
    imageIndex,
    role: isImageRole(role) ? role : "unknown",
    confidence: clampConfidence(record.confidence),
    reason: typeof record.reason === "string" ? record.reason : undefined,
  };
}

function findImageRef(roles: ImageRoleResolution[], candidates: ImageRoleResolution["role"][]) {
  return roles.find((role) => candidates.includes(role.role))?.ref || null;
}

function extractJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text.trim());
  } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function buildClarificationPlan(message: string): WorkflowPlan {
  return {
    intent: "clarification",
    summary: message,
    confidence: 0.5,
    needsClarification: true,
    clarificationQuestion: message,
    imageRoles: [],
    userConstraints: [],
    assumptions: [],
    steps: [],
  };
}

function inferNegativeConstraints(text: string): string[] {
  const constraints: string[] = [];
  if (/不要|别|不做|不是|无需|避免/.test(text)) constraints.push(text.slice(0, 160));
  return constraints;
}

function inferIntentFromSteps(steps: WorkflowStepPlan[]) {
  if (!steps.length) return null;
  if (steps.length > 1) return "multi_step_visual_workflow";
  return steps[0].type;
}

function summarizeSteps(steps: WorkflowStepPlan[]) {
  return steps.map((step, index) => `${index + 1}. ${step.title}`).join(" -> ");
}

function defaultOutputShape(type: WorkflowToolType): WorkflowStepOutputShape {
  if (type === "select_image") return { selectedImageUrl: true };
  if (type === "image_to_video") return { videoUrls: true };
  if (type === "prompt_repair" || type === "image_quality_check") return { text: true };
  return { imageUrls: true };
}

function getDefaultStepTitle(type: WorkflowToolType) {
  return type.replace(/_/g, " ");
}

function isPlannerToolType(value: string): value is WorkflowToolType {
  return [
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
  ].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isImageRole(value: string): value is ImageRoleResolution["role"] {
  return ["auto", "person", "clothing", "product", "background", "style", "source", "reference", "face", "unknown"].includes(value);
}

function clampConfidence(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return 0.7;
  return Math.max(0, Math.min(1, num));
}
