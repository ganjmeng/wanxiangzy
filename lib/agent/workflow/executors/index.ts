import { persistGeneratedImageUrls } from "@/lib/api/result-image-storage";
import { gatewayGenerateImages, gatewayTryOn } from "@/lib/agent/workflow/model-gateway";
import { checkImageOutputs } from "@/lib/agent/workflow/quality";
import type {
  StepExecutionInput,
  StepExecutionResult,
  WorkflowStepRecord,
  WorkflowToolType,
} from "@/lib/agent/workflow/types";

type StepExecutor = (input: StepExecutionInput) => Promise<StepExecutionResult>;

export const STEP_EXECUTORS: Partial<Record<WorkflowToolType, StepExecutor>> = {
  text_to_image: executeTextToImage,
  image_to_image: executeImageToImage,
  commerce_detail: executeCommerceDetail,
  commerce_creative: executeCommerceCreative,
  background_replace: executeBackgroundReplace,
  garment_3d: executeGarment3d,
  tryon: executeTryon,
  pose_variation: executePoseVariation,
  select_image: executeSelectImage,
  image_quality_check: executeQualityCheck,
  prompt_repair: executePromptRepair,
};

export function getStepExecutor(type: WorkflowToolType) {
  return STEP_EXECUTORS[type] || null;
}

async function executeTextToImage(input: StepExecutionInput) {
  return runImageGeneration(input, {
    images: [],
    promptKind: undefined,
    fallbackPrompt: String(input.step.params.prompt || input.workflow.summary || "professional commercial visual"),
  });
}

async function executeImageToImage(input: StepExecutionInput) {
  return runImageGeneration(input, {
    images: resolveImageList(input, input.step.input.sourceImages || input.step.input.sourceImage),
    promptKind: undefined,
    fallbackPrompt: String(input.step.params.prompt || input.workflow.summary || "regenerate based on reference images"),
  });
}

async function executeCommerceDetail(input: StepExecutionInput) {
  const prompt = [
    "生成可用于淘宝/天猫/京东的商品详情页或电商长图版式。",
    "必须包含首屏主视觉、核心卖点区、细节展示区、参数/功能区，具备清晰标题、卖点文案、图标和分区层级。",
    "不要生成单张生活方式照片或小红书种草图。",
    String(input.step.params.prompt || input.workflow.summary || ""),
  ].join("\n");
  return runImageGeneration(input, {
    images: resolveImageList(input, input.step.input.referenceImages),
    promptKind: undefined,
    fallbackPrompt: prompt,
  });
}

async function executeCommerceCreative(input: StepExecutionInput) {
  const prompt = [
    "生成电商主图、banner、活动海报或推广视觉。",
    "画面需要明确商品主体、商业标题区、卖点文案区和可投放的版式层级。",
    String(input.step.params.prompt || input.workflow.summary || ""),
  ].join("\n");
  return runImageGeneration(input, {
    images: resolveImageList(input, input.step.input.referenceImages),
    promptKind: undefined,
    fallbackPrompt: prompt,
  });
}

async function executeBackgroundReplace(input: StepExecutionInput) {
  const images = [
    ...resolveImageList(input, input.step.input.sourceImage),
    ...resolveImageList(input, input.step.input.backgroundReference),
  ];
  const prompt = [
    "保留主体身份、服装、比例和真实光影关系，只替换背景/场景并自然融合。",
    String(input.step.params.prompt || input.workflow.summary || ""),
  ].join("\n");
  return runImageGeneration(input, { images, promptKind: "modelBackground", fallbackPrompt: prompt });
}

async function executeGarment3d(input: StepExecutionInput) {
  const images = resolveImageList(input, input.step.input.garmentImage || input.step.input.sourceImage);
  const prompt = [
    "生成服装或商品的 3D 展示感商品图，主体完整清晰，适合电商详情页或主图素材。",
    "保留商品结构、颜色、面料纹理、logo 和关键细节，背景干净，商业产品摄影质感。",
    String(input.step.params.prompt || input.workflow.summary || ""),
  ].join("\n");
  return runImageGeneration(input, { images, promptKind: "garment3d", fallbackPrompt: prompt });
}

async function executeTryon(input: StepExecutionInput): Promise<StepExecutionResult> {
  const clothingUrls = resolveImageList(input, input.step.input.clothingImage || input.step.input.garmentImage);
  const referenceUrl = resolveImageList(input, input.step.input.personImage || input.step.input.referenceImage)[0];
  if (!clothingUrls.length) throw new Error("换装步骤缺少服装图");

  const count = normalizeCount(input.step.params.count || 1);
  const result = await gatewayTryOn({
    model: input.model,
    clothingUrls,
    referenceUrl,
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    count,
    style: typeof input.step.params.style === "string" ? input.step.params.style : undefined,
  });
  return persistAndCheck(input, result.urls, result.promptTrace, result.providerTrace, count);
}

async function executePoseVariation(input: StepExecutionInput) {
  const source = resolveImageList(input, input.step.input.sourceImage)[0];
  if (!source) throw new Error("姿势裂变步骤缺少主图");
  const outputMode = input.step.params.outputMode === "separate" ? "separate" : "grid";
  const prompt = [
    outputMode === "separate"
      ? "基于主图生成一组不同姿势的独立图片，保持人物身份、服装结构、身体比例和光线质感稳定。"
      : "基于主图生成 2x2 四宫格姿势变化图，保持人物身份、服装结构、身体比例和光线质感稳定。",
    "姿势自然可信，避免手指、关节、肢体拉长和换脸。",
    String(input.step.params.prompt || input.workflow.summary || ""),
  ].join("\n");
  const count = outputMode === "separate"
    ? normalizeCount(input.step.params.count || input.step.params.genCount || 4)
    : 1;
  const result = await gatewayGenerateImages({
    model: input.model,
    prompt,
    promptKind: "pose",
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    images: [source],
    count,
  });
  return persistAndCheck(input, result.urls, result.promptTrace, result.providerTrace, count);
}

async function executeSelectImage(input: StepExecutionInput): Promise<StepExecutionResult> {
  const candidates = resolveImageList(input, input.step.input.imageUrls || input.step.input.images || input.step.input.sourceImages);
  const selectedImageUrl = candidates[0];
  if (!selectedImageUrl) throw new Error("没有可选择的候选图片");
  return {
    output: {
      selectedImageUrl,
      imageUrls: [selectedImageUrl],
      text: "已自动选择第一张候选图；用户可在前端改选。",
    },
    quality: await checkImageOutputs([selectedImageUrl], 1),
  };
}

async function executeQualityCheck(input: StepExecutionInput): Promise<StepExecutionResult> {
  const urls = resolveImageList(input, input.step.input.imageUrls || input.step.input.images);
  const quality = await checkImageOutputs(urls, urls.length || 1);
  return {
    output: {
      imageUrls: urls,
      text: quality.checks.map((check) => `${check.label}: ${check.status} - ${check.detail}`).join("\n"),
    },
    quality,
  };
}

async function executePromptRepair(input: StepExecutionInput): Promise<StepExecutionResult> {
  const prompt = String(input.step.params.prompt || "");
  const issue = String(input.step.params.issue || input.workflow.error_message || "用户反馈需要修复");
  return {
    output: {
      text: `${prompt}\n修复要求：${issue}\n严格优先满足用户原始目标，不要擅自切换任务类型。`,
    },
  };
}

async function runImageGeneration(
  input: StepExecutionInput,
  options: {
    images: string[];
    promptKind?: "model" | "grass" | "modelBackground" | "pose" | "garment3d" | "tryon";
    fallbackPrompt: string;
  }
) {
  const count = normalizeCount(input.step.params.count || input.step.params.genCount || 1);
  const result = await gatewayGenerateImages({
    model: input.model,
    prompt: String(input.step.params.prompt || options.fallbackPrompt),
    promptKind: options.promptKind,
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    images: options.images,
    count,
  });
  return persistAndCheck(input, result.urls, result.promptTrace, result.providerTrace, count);
}

async function persistAndCheck(
  input: StepExecutionInput,
  rawUrls: string[],
  promptTrace: StepExecutionResult["promptTrace"],
  providerTrace: StepExecutionResult["providerTrace"],
  expectedCount: number
): Promise<StepExecutionResult> {
  const persisted = await persistGeneratedImageUrls(rawUrls, `${input.workflow.id}-${input.step.step_key}`, {
    forceServerDownload: rawUrls.some((url) => url.startsWith("http")),
  });
  const quality = await checkImageOutputs(persisted, expectedCount);
  return {
    output: { imageUrls: persisted },
    promptTrace,
    providerTrace,
    quality,
  };
}

function resolveImageList(input: StepExecutionInput, value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => resolveImageList(input, item));
  const single = resolveImageRef(input, value);
  return single ? [single] : [];
}

function resolveImageRef(input: StepExecutionInput, value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.startsWith("http") || value.startsWith("data:image/")) return value;

  const imageMatch = value.match(/(?:图|image:)\s*(\d+)/i);
  if (imageMatch) {
    const index = Number(imageMatch[1]);
    return input.inputImages.find((img) => img.index === index)?.url || null;
  }

  const stepMatch = value.match(/^\$?([A-Za-z0-9_-]+)\.output\.(imageUrls|selectedImageUrl)(?:\[(\d+)])?$/);
  if (stepMatch) {
    const [, stepKey, field, rawIndex] = stepMatch;
    const step = input.steps.find((item) => item.step_key === stepKey || item.id === stepKey);
    if (!step?.output) return null;
    if (field === "selectedImageUrl") return step.output.selectedImageUrl || step.output.imageUrls?.[0] || null;
    const index = Number(rawIndex || 0);
    return step.output.imageUrls?.[index] || null;
  }

  return null;
}

function normalizeCount(value: unknown) {
  const num = Number(value || 1);
  if (!Number.isFinite(num)) return 1;
  return Math.min(Math.max(Math.floor(num), 1), 4);
}
