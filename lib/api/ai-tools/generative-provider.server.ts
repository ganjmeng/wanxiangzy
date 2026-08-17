import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type {
  AiToolCreateRequest,
  AiToolSubmitResult,
  OutpaintOptions,
} from "@/lib/ai-tools/types";
import { createDebitedGeneration } from "@/lib/api/credits";
import { getConfiguredImageCreditCost } from "@/lib/ai-control-plane/server";
import { normalizeGenerationState } from "@/lib/api/generation-state";
import { startGenerationJob, type GenerationJobPayload } from "@/lib/api/generation-jobs";
import type { AspectRatio, ImageSize } from "@/lib/api/lingya";
import { storeImage } from "@/lib/api/image-storage";
import { fetchRemoteImageBuffer } from "@/lib/api/remote-image-fetch";

export const GENERATIVE_AI_TOOL_OPERATIONS = new Set<AiToolCreateRequest["operation"]>([
  "outpaint",
  "erase",
  "repair-limbs",
  "repair-garment",
  "repair-footwear",
]);

type GenerativeAiToolOperation = "outpaint" | "erase" | "repair-limbs" | "repair-garment" | "repair-footwear";
type GenerativeAiToolRequest = Extract<AiToolCreateRequest, { operation: GenerativeAiToolOperation }>;

type GenerationRow = {
  status?: string | null;
  result_urls?: unknown;
  error_message?: string | null;
  job_payload?: unknown;
  completed_at?: string | null;
  credits_cost?: number | null;
};

type GenerativeProviderDependencies = {
  createGeneration: typeof createDebitedGeneration;
  startGeneration: typeof startGenerationJob;
  prepareInputs?: typeof prepareGenerativeAiToolInputs;
  getCreditCost?: typeof getConfiguredImageCreditCost;
};

type AuthenticatedGenerationContext = {
  userId: string;
  client: Pick<SupabaseClient, "from" | "rpc">;
};

const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 32_000_000;

export class AiToolGenerativeInputError extends Error {
  readonly code: string;
  readonly status = 400;
  readonly retryable = false;

  constructor(message: string, code: string) {
    super(message);
    this.name = "AiToolGenerativeInputError";
    this.code = code;
  }
}

export async function submitGenerativeAiToolTask(
  request: GenerativeAiToolRequest,
  context: AuthenticatedGenerationContext,
  dependencies: GenerativeProviderDependencies = defaultDependencies(),
): Promise<AiToolSubmitResult> {
  const model = request.options.model || "nano-banana-2";
  const imageSize: ImageSize = "2K";
  const aspectRatio = getAiToolAspectRatio(request);
  const preparedInputs = await (dependencies.prepareInputs || prepareGenerativeAiToolInputs)(
    request,
    context.userId,
  );
  const imageInputs = preparedInputs.imageInputs;
  const prompt = buildGenerativeAiToolPrompt(request);
  const creditsCost = await (dependencies.getCreditCost || getConfiguredImageCreditCost)(model, imageSize);
  const jobPayload: GenerationJobPayload = {
    kind: "generalImage",
    mode: "image-to-image",
    referenceUrls: imageInputs,
    aiModel: model,
    aspectRatio,
    imageSize,
    prompt,
    genCount: 1,
    aiTool: {
      requestId: request.request_id,
      operation: request.operation,
      nativeMaskUrl: preparedInputs.nativeMaskUrl,
    },
  };
  const debit = await dependencies.createGeneration(context.client, {
    userId: context.userId,
    clothingUrls: imageInputs,
    referenceUrl: request.source_url,
    creditsCost,
    aiModel: model,
    imageSize,
    reason: `${getOperationLabel(request.operation)} (${model}, ${imageSize})`,
    jobPayload,
  });

  dependencies.startGeneration(debit.generationId);
  return {
    task_id: debit.generationId,
    request_id: request.request_id,
    operation: request.operation,
    status: "queued",
    stage: "generation_queued",
    progress: 1,
    expected_count: 1,
    result_urls: [],
    outputs: [],
    warnings: [],
    error: null,
    execution_mode: "live",
    provider: "generative-image-edit",
    capability: request.operation === "outpaint" ? "outpaint" : "inpaint",
    provider_status: "QUEUED",
    credits_cost: creditsCost,
    credits_remaining: debit.creditsRemaining,
    billing_status: "debited",
  };
}

export async function getGenerativeAiToolTask(
  taskId: string,
  context: AuthenticatedGenerationContext & {
    operation: GenerativeAiToolRequest["operation"];
    requestId: string;
  },
): Promise<AiToolSubmitResult> {
  const query = await context.client
    .from("generations")
    .select("status,result_urls,error_message,job_payload,completed_at,credits_cost")
    .eq("id", taskId)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (query.error) {
    throw new Error(`读取生图任务失败：${query.error.message || "unknown database error"}`);
  }
  if (!query.data) {
    const error = new Error("AI 工具生图任务不存在") as Error & { code?: string; status?: number };
    error.code = "AI_TOOL_TASK_NOT_FOUND";
    error.status = 404;
    throw error;
  }

  const row = query.data as GenerationRow;
  const resultUrls = stringArray(row.result_urls);
  const state = normalizeGenerationState({
    status: row.status,
    resultUrls,
    payload: row.job_payload,
    completedAt: row.completed_at,
  });
  const status = state.status === "completed"
    ? "completed"
    : state.status === "failed"
      ? "failed"
      : state.progress > 1
        ? "processing"
        : "queued";
  const failed = status === "failed";
  const errorMessage = failed ? row.error_message?.trim() || "图像生成失败" : null;

  return {
    task_id: taskId,
    request_id: context.requestId,
    operation: context.operation,
    status,
    stage: failed ? "generation_failed" : status === "completed" ? "generation_completed" : "generation_processing",
    progress: state.progress,
    expected_count: 1,
    result_urls: status === "completed" ? resultUrls.slice(0, 1) : [],
    outputs: status === "completed"
      ? resultUrls.slice(0, 1).map((url) => ({
          url,
          role: "result" as const,
          kind: "image" as const,
          mime_type: null,
          dimensions: null,
        }))
      : [],
    warnings: [],
    error: errorMessage ? {
      code: "AI_TOOL_GENERATION_FAILED",
      message: errorMessage,
      retryable: false,
    } : null,
    execution_mode: "live",
    provider: "generative-image-edit",
    capability: context.operation === "outpaint" ? "outpaint" : "inpaint",
    provider_status: state.providerStatus || String(row.status || "PROCESSING").toUpperCase(),
    credits_cost: Math.max(0, Math.floor(Number(row.credits_cost) || 0)),
    billing_status: "debited",
  };
}

export function isGenerativeAiToolOperation(
  operation: AiToolCreateRequest["operation"],
): operation is GenerativeAiToolRequest["operation"] {
  return GENERATIVE_AI_TOOL_OPERATIONS.has(operation);
}

export function isGenerativeAiToolRequest(
  request: AiToolCreateRequest,
): request is GenerativeAiToolRequest {
  return isGenerativeAiToolOperation(request.operation);
}

export function buildGenerativeAiToolPrompt(request: GenerativeAiToolRequest) {
  const common = [
    "输出一张完整的最终图片，不要输出拼图、步骤图、蒙版、文字说明或水印。",
    "图1是必须保真的原图；除明确允许修改的区域外，人物身份、商品事实、构图、色彩、光线、文字与 Logo 必须保持不变。",
  ];

  if (request.operation === "outpaint") {
    const scale = Math.round((request.options.source_scale ?? 1) * 100);
    return [
      "任务：AI 扩图。图1是已经按目标位置排好的透明画布，非透明区域是必须保真的原图；只补全透明区域。",
      "图2是黑底白色扩区蒙版：只生成白色区域，黑色原图区域严禁重绘。",
      `目标画布为 ${request.options.target_width}×${request.options.target_height}px；原图按 ${scale}% 等比放置，横向位置 ${percent(request.options.position_x)}，纵向位置 ${percent(request.options.position_y)}。`,
      "自然延续原图的透视、纹理、景深、光线与边缘，不新增无依据的人物、商品、文字或 Logo。",
      request.options.prompt ? `用户补充要求：${request.options.prompt}` : "",
      ...common,
    ].filter(Boolean).join("\n");
  }

  const maskRule = "图2是黑底白色编辑蒙版：只允许修改白色区域，黑色区域严禁变化。";
  if (request.operation === "erase") {
    return [
      "任务：AI 消除。移除白色蒙版内的目标，并依据周围真实内容自然补全背景、纹理、阴影和遮挡关系。",
      maskRule,
      request.options.instruction ? `用户补充要求：${request.options.instruction}` : "",
      ...common,
    ].filter(Boolean).join("\n");
  }
  if (request.operation === "repair-limbs") {
    const target = request.options.target === "hands" ? "手部" : request.options.target === "feet" ? "脚部" : "手脚";
    return [
      `任务：修复图1白色蒙版内的${target}结构。恢复真实解剖、自然关节、手指或脚趾数量、姿势与透视。`,
      maskRule,
      "严格保持同一人物身份、脸部、肤色、身材、服装、姿势意图和场景，只修复结构错误。",
      request.options.instruction ? `用户补充要求：${request.options.instruction}` : "",
      ...common,
    ].filter(Boolean).join("\n");
  }

  const referenceMaskRule = request.reference_mask_url
    ? "图4是图3的黑底白色参考选区，只从白色区域读取商品结构与细节。"
    : "";
  if (request.operation === "repair-garment") {
    return [
      `任务：服饰${request.options.repair_mode === "detail" ? "细节" : "款式"}修复。图3是商品参考图。`,
      maskRule,
      referenceMaskRule,
      "仅在图1白色选区内恢复图3可证实的版型、纹理、图案、缝线、拉链、纽扣或 Logo；不得编造参考图不存在的商品事实。",
      request.options.instruction ? `用户补充要求：${request.options.instruction}` : "",
      ...common,
    ].filter(Boolean).join("\n");
  }

  return [
    "任务：鞋靴修复。图3是鞋靴商品参考图。",
    maskRule,
    referenceMaskRule,
    "仅在图1白色选区内恢复真实鞋型、左右脚关系、鞋底、材质、图案、Logo 与接地阴影；不得改变人物、服装或场景。",
    request.options.instruction ? `用户补充要求：${request.options.instruction}` : "",
    ...common,
  ].filter(Boolean).join("\n");
}

function getAiToolImageInputs(request: GenerativeAiToolRequest) {
  return [
    request.source_url,
    request.operation === "outpaint" ? null : request.mask_url,
    ...request.reference_urls,
    request.reference_mask_url,
  ].filter((url): url is string => typeof url === "string" && Boolean(url));
}

async function prepareGenerativeAiToolInputs(
  request: GenerativeAiToolRequest,
  userId: string,
) {
  if (request.operation !== "outpaint") {
    if (!request.mask_url) throw new Error("局部编辑任务缺少目标蒙版");
    const remoteMask = await fetchRemoteImageBuffer(request.mask_url, {
      maxBytes: MAX_SOURCE_BYTES,
      timeoutMs: 30_000,
    });
    const nativeMask = await createNativeInpaintMaskBuffer(remoteMask.bytes);
    const userScope = createHash("sha256").update(userId).digest("hex").slice(0, 12);
    const storedNativeMask = await storeImage({
      bytes: nativeMask,
      contentType: "image/png",
      name: `${request.request_id}-${userScope}-native-inpaint-mask`,
      storageClass: "temp",
    }, { preservePixelDimensions: true });
    return {
      imageInputs: getAiToolImageInputs(request),
      nativeMaskUrl: storedNativeMask.url,
    };
  }

  const remote = await fetchRemoteImageBuffer(request.source_url, {
    maxBytes: MAX_SOURCE_BYTES,
    timeoutMs: 30_000,
  });
  const guidance = await createOutpaintGuidanceBuffers(remote.bytes, request.options);
  const userScope = createHash("sha256").update(userId).digest("hex").slice(0, 12);
  const baseName = `${request.request_id}-${userScope}`;
  const [storedCanvas, storedSemanticMask, storedNativeMask] = await Promise.all([
    storeImage({
      bytes: guidance.canvas,
      contentType: "image/png",
      name: `${baseName}-outpaint-canvas`,
      storageClass: "temp",
    }, { preservePixelDimensions: true }),
    storeImage({
      bytes: guidance.semanticMask,
      contentType: "image/png",
      name: `${baseName}-outpaint-semantic-mask`,
      storageClass: "temp",
    }, { preservePixelDimensions: true }),
    storeImage({
      bytes: guidance.nativeMask,
      contentType: "image/png",
      name: `${baseName}-outpaint-native-mask`,
      storageClass: "temp",
    }, { preservePixelDimensions: true }),
  ]);
  return {
    imageInputs: [storedCanvas.url, storedSemanticMask.url],
    nativeMaskUrl: storedNativeMask.url,
  };
}

/** Converts white=edit/black=preserve masks into OpenAI's transparent=edit alpha convention. */
export async function createNativeInpaintMaskBuffer(maskBytes: Buffer) {
  const image = sharp(maskBytes, {
    animated: true,
    failOn: "warning",
    limitInputPixels: MAX_SOURCE_PIXELS,
  });
  const metadata = await image.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (
    metadata.format !== "png"
    || !width
    || !height
    || (metadata.pages ?? 1) !== 1
    || width * height > MAX_SOURCE_PIXELS
  ) {
    throw new Error("目标蒙版尺寸或格式无效");
  }
  const luminance = await sharp(maskBytes, {
    failOn: "warning",
    limitInputPixels: MAX_SOURCE_PIXELS,
  }).flatten({ background: "#000000" }).greyscale().raw().toBuffer();
  const rgba = Buffer.alloc(luminance.length * 4);
  for (let pixel = 0; pixel < luminance.length; pixel += 1) {
    const offset = pixel * 4;
    rgba[offset] = 0;
    rgba[offset + 1] = 0;
    rgba[offset + 2] = 0;
    rgba[offset + 3] = 255 - luminance[pixel];
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

export async function createOutpaintGuidanceBuffers(
  sourceBytes: Buffer,
  options: OutpaintOptions,
) {
  const source = sharp(sourceBytes, {
    animated: true,
    failOn: "warning",
    limitInputPixels: MAX_SOURCE_PIXELS,
  });
  const metadata = await source.metadata();
  const sourceWidth = metadata.width || 0;
  const sourceHeight = metadata.height || 0;
  if (
    !sourceWidth
    || !sourceHeight
    || (metadata.pages ?? 1) !== 1
    || (metadata.orientation ?? 1) !== 1
    || sourceWidth * sourceHeight > MAX_SOURCE_PIXELS
  ) {
    throw new Error("扩图原图尺寸或格式无效");
  }

  const scale = options.source_scale ?? 1;
  const placedWidth = Math.max(1, Math.round(sourceWidth * scale));
  const placedHeight = Math.max(1, Math.round(sourceHeight * scale));
  const freeWidth = options.target_width - placedWidth;
  const freeHeight = options.target_height - placedHeight;
  if (freeWidth < 0 || freeHeight < 0) {
    throw new AiToolGenerativeInputError(
      "目标画布必须完整容纳原图，请增大输出尺寸或在调整区域中缩小原图",
      "AI_TOOL_OUTPAINT_SOURCE_OUT_OF_BOUNDS",
    );
  }
  const left = Math.round(freeWidth * options.position_x);
  const top = Math.round(freeHeight * options.position_y);
  const placedSource = await sharp(sourceBytes, {
    failOn: "warning",
    limitInputPixels: MAX_SOURCE_PIXELS,
  }).resize({
    width: placedWidth,
    height: placedHeight,
    fit: "fill",
    kernel: sharp.kernel.lanczos3,
  }).png().toBuffer();
  const canvas = await sharp({
    create: {
      width: options.target_width,
      height: options.target_height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{ input: placedSource, left, top }]).png().toBuffer();
  const protectedRect = await sharp({
    create: {
      width: placedWidth,
      height: placedHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  }).png().toBuffer();
  const semanticMask = await sharp({
    create: {
      width: options.target_width,
      height: options.target_height,
      channels: 3,
      background: "#ffffff",
    },
  }).composite([{ input: protectedRect, left, top }]).png().toBuffer();
  const nativeMask = await sharp({
    create: {
      width: options.target_width,
      height: options.target_height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{ input: protectedRect, left, top }]).png().toBuffer();
  return { canvas, semanticMask, nativeMask, left, top, placedWidth, placedHeight };
}

function getAiToolAspectRatio(request: GenerativeAiToolRequest): AspectRatio {
  if (request.operation !== "outpaint") return "auto";
  const ratio = request.options.target_width / request.options.target_height;
  const candidates: Array<{ value: Exclude<AspectRatio, "auto">; ratio: number }> = [
    { value: "1:1", ratio: 1 },
    { value: "9:16", ratio: 9 / 16 },
    { value: "16:9", ratio: 16 / 9 },
    { value: "4:3", ratio: 4 / 3 },
    { value: "3:4", ratio: 3 / 4 },
    { value: "2:3", ratio: 2 / 3 },
    { value: "3:2", ratio: 3 / 2 },
    { value: "4:5", ratio: 4 / 5 },
    { value: "5:4", ratio: 5 / 4 },
    { value: "21:9", ratio: 21 / 9 },
  ];
  return candidates.reduce((best, candidate) => (
    Math.abs(Math.log(candidate.ratio / ratio)) < Math.abs(Math.log(best.ratio / ratio))
      ? candidate
      : best
  )).value;
}

function getOperationLabel(operation: GenerativeAiToolRequest["operation"]) {
  if (operation === "outpaint") return "AI 扩图";
  if (operation === "erase") return "AI 消除";
  if (operation === "repair-limbs") return "手脚修复";
  if (operation === "repair-garment") return "服饰修复";
  return "鞋靴修复";
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item))
    : [];
}

function defaultDependencies(): GenerativeProviderDependencies {
  return {
    createGeneration: createDebitedGeneration,
    startGeneration: startGenerationJob,
  };
}
