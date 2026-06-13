/**
 * AI 图像生成 API
 * 支持 gpt-image-2 和 nano-banana 系列
 */

import { normalizeOpenAiCompatibleBaseUrl } from "@/lib/api/url-utils";
import { resolveExactAspectPixelSize, resolveSmartImageAspectRatio } from "@/lib/api/image-size";
import {
  TRYON_CLOTHING_IMAGE_ROLE_RULE,
  TRYON_FIT_RULE,
  TRYON_GARMENT_RULE,
  TRYON_COLOR_RULE,
  TRYON_MATERIAL_RULE,
  TRYON_PHOTOGRAPHY_RULE,
  TRYON_QUALITY,
  TRYON_SKIN_TONE_RULE,
  applyTryOnAudiencePrompt,
  applyTryOnFramePrompt,
  buildTryOnAudiencePrompt,
  buildTryOnBodyProportionPrompt,
  buildTryOnFacePrompt,
  buildTryOnFramePrompt,
  buildTryOnGarmentCategoryPrompt,
  buildTryOnNegativePrompt,
  buildTryOnReferencePrompt,
  enforceTryOnPromptRequirements,
  type TryOnAgeGroup,
  type TryOnGarmentCategory,
  type TryOnGarmentAudience,
} from "@/lib/tryon-prompt";
import { compileImagePromptForModel, type ImagePromptKind } from "@/lib/api/prompt-compiler";
import { buildGarmentDetailReferencePrompt, normalizeGarmentDetailUrls } from "@/lib/garment-detail-references";
import { TRYON_CATEGORY_BY_CODE, type TryOnClothingAnalysis } from "@/lib/tryon-reference-config";
import {
  buildTryOnReferenceCropLockRule,
  buildTryOnReferenceAnalysisRule,
  type TryOnReferenceAnalysis,
} from "@/lib/tryon-reference-analysis";
import {
  TRYON_CLOTHING_ROLE_LABELS,
  normalizeTryOnClothingMode,
  normalizeTryOnClothingRole,
  type TryOnClothingMode,
  type TryOnClothingRole,
} from "@/lib/tryon-upload-rules";

const DEFAULT_API_BASE = "https://api.lingyaai.cn/v1";
const DEFAULT_PLATO_API_BASE = "https://yunwu.ai/v1";
const DEFAULT_LAOZHANG_API_BASE = "https://api.laozhang.ai";
const DEFAULT_GPT_IMAGE_2_PROVIDER_MODEL = "gpt-image-2";
const DEFAULT_NANO_BANANA_PROVIDER_MODEL = "gemini-3.1-flash-image-preview";
const DEFAULT_NANO_BANANA_PRO_PROVIDER_MODEL = "gemini-3-pro-image-preview";
const CONCISE_TRYON_PROMPT_MODE = true;
const IMAGE_REQUEST_PROGRESS_INITIAL = 2;
const IMAGE_REQUEST_PROGRESS_INTERVAL_MS = 8000;
const IMAGE_REQUEST_PROGRESS_CURVE_MS = 90_000;
const SYNC_IMAGE_REQUEST_PROGRESS_MAX = 92;
const ASYNC_IMAGE_SUBMIT_PROGRESS_MAX = 8;
const IMAGE_EDIT_MAX_IMAGES = 15;
const IMAGE_EDIT_MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const IMAGE_EDIT_FETCH_TIMEOUT_MS = 60_000;

export type LingyaModel = "gpt-image-2" | "nano-banana-pro" | "nano-banana-2";
export type AspectRatio = "auto" | "1:1" | "9:16" | "16:9" | "4:3" | "3:4" | "2:3" | "3:2" | "4:5" | "5:4" | "21:9";
export type ImageSize = "1K" | "2K" | "4K";
export const DEFAULT_LINGYA_MODEL: LingyaModel = "nano-banana-2";

const LINGYA_MODELS: LingyaModel[] = [
  "nano-banana-2",
  "gpt-image-2",
  "nano-banana-pro",
];

const ASPECT_RATIOS: AspectRatio[] = [
  "auto",
  "1:1",
  "9:16",
  "16:9",
  "4:3",
  "3:4",
  "2:3",
  "3:2",
  "4:5",
  "5:4",
  "21:9",
];

export const CREDIT_COSTS: Record<LingyaModel, Record<ImageSize, number>> = {
  "gpt-image-2":      { "1K": 2, "2K": 3, "4K": 4 },
  "nano-banana-pro":   { "1K": 2, "2K": 3, "4K": 4 },
  "nano-banana-2":     { "1K": 1, "2K": 2, "4K": 3 },
};

export function normalizeLingyaModel(value: unknown): LingyaModel {
  return typeof value === "string" && LINGYA_MODELS.includes(value as LingyaModel)
    ? (value as LingyaModel)
    : DEFAULT_LINGYA_MODEL;
}

export function normalizeAspectRatio(value: unknown, fallback: AspectRatio = "3:4"): AspectRatio {
  return typeof value === "string" && ASPECT_RATIOS.includes(value as AspectRatio)
    ? (value as AspectRatio)
    : fallback;
}

export function getCreditCost(model: LingyaModel, size: ImageSize = "1K", aspectRatio?: AspectRatio): number {
  return CREDIT_COSTS[model]?.[normalizeImageSize(model, size, aspectRatio)] ?? 1;
}

export function getSupportedImageSizes(model: LingyaModel, aspectRatio?: AspectRatio): ImageSize[] {
  if (isSeedreamModel(model)) return ["2K", "4K"];
  return ["1K", "2K", "4K"];
}

export function normalizeImageSize(model: LingyaModel, size: ImageSize = "1K", aspectRatio?: AspectRatio): ImageSize {
  const supported = getSupportedImageSizes(model, aspectRatio);
  return supported.includes(size) ? size : supported[0] || "1K";
}

interface GenerateInput {
  model: LingyaModel;
  prompt: string;
  prompt_kind?: ImagePromptKind;
  aspect_ratio?: AspectRatio;
  image?: string[];
  smart_aspect_image?: string;
  image_size?: ImageSize;
  search?: boolean;
  onProgress?: (update: ImageTaskProgress) => Promise<void> | void;
}

interface GenerateResult {
  url?: string;
  b64_json?: string;
  prompt?: string;
  compiledPrompt?: string;
  taskId?: string;
}

export type ImageTaskProgress = {
  taskId?: string;
  status: "queued" | "running" | "completed" | "failed";
  providerStatus?: string;
  progress: number;
  urls?: string[];
  error?: string;
};

interface BatchTryOnInput {
  model: LingyaModel;
  clothingUrls: string[];
  clothingMode?: TryOnClothingMode;
  clothingRoles?: TryOnClothingRole[];
  clothingAnalysis?: TryOnClothingAnalysis | null;
  garmentDetailUrls?: string[];
  garmentAudience?: TryOnGarmentAudience;
  ageGroup?: TryOnAgeGroup;
  garmentCategory?: TryOnGarmentCategory;
  modelFaceUrl?: string;
  referenceUrl?: string;
  referenceAnalysis?: TryOnReferenceAnalysis | null;
  aspect_ratio?: AspectRatio;
  image_size?: ImageSize;
  style?: string;
  raw_prompt?: string;
  candidateIndex?: number;
  candidateCount?: number;
  onProgress?: (update: ImageTaskProgress) => Promise<void> | void;
}

type TryOnRequestPromptOptions = {
  model: LingyaModel;
  candidateIndex?: number;
  candidateCount?: number;
  referenceUrl?: string;
  referenceAnalysis?: TryOnReferenceAnalysis | null;
  referenceImageNumber?: number;
  modelFaceUrl?: string;
  garmentDetailCount?: number;
};

export async function generateImage(input: GenerateInput, retries = 2): Promise<GenerateResult> {
  const requestInput = await resolveGenerateInputAspectRatio(input);
  const provider = getImageProvider(requestInput.model);
  const apiKey = provider.apiKey;
  if (!apiKey) throw new Error(`${provider.name} API Key 未配置`);
  const apiBase = provider.apiBase;
  const compiledPrompt = compileImagePromptForModel({
    kind: requestInput.prompt_kind,
    model: requestInput.model,
    prompt: requestInput.prompt,
  });

  const useLaozhangNativeEndpoint = shouldUseLaozhangNativeEndpoint(requestInput, provider);
  const useImageEditEndpoint = !useLaozhangNativeEndpoint && shouldUseImageEditEndpoint(requestInput, provider);
  const body = buildGenerateRequestBody(requestInput, compiledPrompt);
  body.model = resolveProviderImageModel(requestInput.model, provider);

  // 日志（不含完整 base64、不含完整 prompt 内容）
  const logBody: Record<string, unknown> = {
    model: body.model,
    endpoint: useLaozhangNativeEndpoint ? "generateContent" : useImageEditEndpoint ? "images/edits" : "images/generations",
    aspect_ratio: body.aspect_ratio,
    image_size: body.image_size || body.size,
    quality: body.quality,
    image_count: Array.isArray(requestInput.image) ? requestInput.image.length : 0,
    prompt_length: typeof body.prompt === "string" ? body.prompt.length : 0,
  };
  console.log(`[api:${provider.name}] 请求:`, JSON.stringify(logBody));

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const isAsyncSubmit = !useLaozhangNativeEndpoint && !useImageEditEndpoint && shouldRequestAsyncImageTask(provider);
      await requestInput.onProgress?.({ status: "queued", providerStatus: "REQUEST_QUEUED", progress: 1 });
      let res: Response;
      let resText: string;
      const stopRequestHeartbeat = startImageRequestProgressHeartbeat(requestInput.onProgress, {
        maxProgress: isAsyncSubmit ? ASYNC_IMAGE_SUBMIT_PROGRESS_MAX : SYNC_IMAGE_REQUEST_PROGRESS_MAX,
        providerStatus: isAsyncSubmit ? "SUBMITTING" : "GENERATING",
      });
      try {
        const request = useLaozhangNativeEndpoint
          ? await buildLaozhangNativeImageRequest({
              apiBase,
              apiKey,
              model: String(body.model),
              prompt: compiledPrompt,
              imageUrls: requestInput.image || [],
              aspectRatio: requestInput.aspect_ratio,
              imageSize: requestInput.image_size,
            })
          : useImageEditEndpoint
            ? await buildImageEditRequest({ apiBase, apiKey, body, imageUrls: requestInput.image || [] })
            : buildImageGenerationRequest({ apiBase, apiKey, provider, body });
        res = await fetch(request.url, request.init);

        resText = await res.text();
      } finally {
        stopRequestHeartbeat();
      }

      if (!res.ok) {
        console.error(`[api:${provider.name}] 第${attempt}次失败: ${res.status}`, resText.slice(0, 300));
        if (isRetryableStatus(res.status) && attempt < retries) {
          await new Promise(r => setTimeout(r, attempt * 5000));
          continue;
        }
        throw new Error(`API 错误 ${res.status}: ${resText.slice(0, 300)}`);
      }

      const json = JSON.parse(resText);
      const taskId = extractTaskId(json);
      const immediateResult = extractGeneratedImages(json);
      console.log(`[api:${provider.name}] 生成响应: ok=${res.ok}, async=${shouldRequestAsyncImageTask(provider)}, hasTask=${Boolean(taskId)}, imageCount=${immediateResult.urls.length + (immediateResult.b64Json ? 1 : 0)}`);

      if (!taskId) {
        if (immediateResult.urls.length || immediateResult.b64Json) {
          await requestInput.onProgress?.({
            status: "completed",
            providerStatus: "SYNC_COMPLETED",
            progress: 100,
            urls: immediateResult.urls,
          });
          return {
            url: immediateResult.urls[0],
            b64_json: normalizeB64Image(immediateResult.b64Json),
            prompt: requestInput.prompt,
            compiledPrompt,
          };
        }
        if (attempt < retries) { await new Promise(r => setTimeout(r, attempt * 5000)); continue; }
        throw new Error(`图片生成接口未返回任务 ID 或图片结果，响应字段: ${describeResponseKeys(json)}`);
      }

      await requestInput.onProgress?.({ taskId, status: "queued", providerStatus: "SUBMITTED", progress: 1 });
      const completed = await pollImageTask({
        provider,
        apiBase,
        apiKey,
        taskId,
        onProgress: requestInput.onProgress,
      });

      return {
        url: completed.urls[0],
        b64_json: normalizeB64Image(completed.b64Json),
        prompt: requestInput.prompt,
        compiledPrompt,
        taskId,
      };

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < retries && (msg.includes("fetch") || msg.includes("Internal Error"))) {
        await new Promise(r => setTimeout(r, attempt * 5000));
        continue;
      }
      throw err;
    }
  }

  throw new Error("API 多次重试后失败");
}

async function resolveGenerateInputAspectRatio(input: GenerateInput): Promise<GenerateInput> {
  if (input.aspect_ratio !== "auto") return input;

  const aspectRatio = await resolveSmartImageAspectRatio({
    aspectRatio: input.aspect_ratio,
    image: input.smart_aspect_image || input.image?.[0],
    fallback: "3:4",
  });

  return { ...input, aspect_ratio: normalizeAspectRatio(aspectRatio, "3:4") };
}

function startImageRequestProgressHeartbeat(
  onProgress: GenerateInput["onProgress"],
  options: { maxProgress: number; providerStatus: string }
) {
  if (!onProgress) return () => {};

  const startedAt = Date.now();
  let stopped = false;
  let lastProgress = 1;
  let pending: Promise<void> = Promise.resolve();

  const emit = (progress: number) => {
    if (stopped) return;
    const nextProgress = Math.max(lastProgress, progress);
    if (nextProgress === lastProgress) return;
    lastProgress = nextProgress;
    pending = pending
      .then(async () => {
        if (stopped) return;
        await onProgress({
          status: "running",
          providerStatus: options.providerStatus,
          progress: nextProgress,
        });
      })
      .catch(() => {});
  };

  emit(IMAGE_REQUEST_PROGRESS_INITIAL);
  const timer = setInterval(() => {
    emit(calculateImageRequestHeartbeatProgress(Date.now() - startedAt, lastProgress, options.maxProgress));
  }, IMAGE_REQUEST_PROGRESS_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

function calculateImageRequestHeartbeatProgress(elapsedMs: number, previousProgress: number, maxProgress: number) {
  const safeMax = Math.min(99, Math.max(IMAGE_REQUEST_PROGRESS_INITIAL, Math.round(maxProgress)));
  const safePrevious = Math.min(safeMax, Math.max(0, Math.round(previousProgress)));
  const elapsed = Math.max(0, elapsedMs);
  const eased = 1 - Math.exp(-elapsed / IMAGE_REQUEST_PROGRESS_CURVE_MS);
  const target = Math.round(IMAGE_REQUEST_PROGRESS_INITIAL + (safeMax - IMAGE_REQUEST_PROGRESS_INITIAL) * eased);
  const stepped = safePrevious < safeMax ? safePrevious + 1 : safePrevious;
  return Math.min(safeMax, Math.max(safePrevious, stepped, target));
}

export async function batchTryOn(input: BatchTryOnInput): Promise<{ resultUrls: string[]; prompt: string; compiledPrompt: string; taskId?: string }> {
  if (!input.clothingUrls.length) {
    throw new Error("缺少服装图片");
  }
  const garmentDetailUrls = normalizeGarmentDetailUrls(input.garmentDetailUrls);
  const aspectRatio = normalizeAspectRatio(await resolveSmartImageAspectRatio({
    aspectRatio: input.aspect_ratio || "3:4",
    image: input.referenceUrl || input.modelFaceUrl || input.clothingUrls[0],
    fallback: "3:4",
  }), "3:4");

  const { prompt } = buildTryOnPrompt({
    clothingCount: input.clothingUrls.length,
    clothingMode: input.clothingMode,
    clothingRoles: input.clothingRoles,
    clothingAnalysis: input.clothingAnalysis,
    garmentAudience: input.garmentAudience,
    ageGroup: input.ageGroup,
    garmentCategory: input.garmentCategory,
    aspectRatio,
    hasModelFace: !!input.modelFaceUrl,
    hasReference: !!input.referenceUrl,
    referenceAnalysis: input.referenceAnalysis,
    style: input.style,
  });
  const finalPrompt = applyTryOnRequestPrompt(input.raw_prompt?.trim() || prompt, {
    ...input,
    referenceImageNumber: input.referenceUrl ? input.clothingUrls.length + 1 : undefined,
    garmentDetailCount: garmentDetailUrls.length,
  });

  const imageInputs = [
    ...input.clothingUrls,
    ...(input.referenceUrl ? [input.referenceUrl] : []),
    ...(input.modelFaceUrl ? [input.modelFaceUrl] : []),
    ...garmentDetailUrls,
  ];

  const result = await generateImage({
    model: input.model,
    prompt: finalPrompt,
    prompt_kind: "tryon",
    aspect_ratio: aspectRatio,
    image: imageInputs,
    smart_aspect_image: input.referenceUrl || input.modelFaceUrl || input.clothingUrls[0],
    image_size: input.image_size,
    onProgress: input.onProgress,
  });

  const resultUrl = result.url || result.b64_json;
  if (!resultUrl) {
    throw new Error("图片生成接口未返回结果 URL");
  }

  return { resultUrls: [resultUrl], prompt: finalPrompt, compiledPrompt: result.compiledPrompt || finalPrompt, taskId: result.taskId };
}

export function applyTryOnRequestPrompt(prompt: string, input: TryOnRequestPromptOptions) {
  const lines = [prompt.trim()];
  lines.push(buildTryOnPhotoFinishDirective(input));
  const cropDirective = buildTryOnRequestCropDirective(input);
  if (cropDirective) lines.push(cropDirective);
  const candidateDirective = buildTryOnCandidateDirective(input);
  if (candidateDirective) lines.push(candidateDirective);
  const garmentDetailDirective = buildGarmentDetailReferencePrompt(input.garmentDetailCount || 0);
  if (garmentDetailDirective) lines.push(garmentDetailDirective);
  return lines.filter(Boolean).join("\n");
}

function buildTryOnPhotoFinishDirective(input: TryOnRequestPromptOptions) {
  if (input.referenceUrl) {
    return [
      "Reference-based photo finish:",
      "Use the target reference as the photography style source.",
      "Replicate its shadow design: cast-shadow direction, shadow length, edge softness, density, wall/floor shadow geometry, body shadow placement, and contact-shadow intensity.",
      "Inherit its light direction, light hardness, color temperature, contrast curve, shadow shape, highlight rolloff, exposure, white balance, lens perspective, depth of field, texture/noise level, and filter/color mood.",
      "Make the reference filter/color mood visibly present in the final image while preserving true garment color; you may subtly polish clarity and shadow depth, but do not apply a new generic fashion filter or a different color grade.",
      input.modelFaceUrl ? "Before applying the global color mood, make the final face skin match the target reference's neck, chest, arms, and hands in undertone, brightness, shadow falloff, pores, and reflected light." : "",
      "Keep garment colors, logos/text, fabric texture, visible identity cues, visible skin tone continuity, and visible body proportions accurate; no heavy beauty filter, no poster layout, no added text, no washed-out skin, no color-shifted clothing.",
    ].filter(Boolean).join(" ");
  }

  return [
    "Photo finish:",
    "Use a clean natural fashion-photo finish with believable light, accurate white balance, real camera lens perspective, and subtle texture.",
    "Keep garment colors, logos/text, fabric texture, face identity, skin tone continuity, and body proportions accurate; no heavy beauty filter, no poster layout, no added text, no washed-out skin, no color-shifted clothing.",
  ].join(" ");
}

function buildTryOnRequestCropDirective(input: TryOnRequestPromptOptions) {
  if (!input.referenceAnalysis || !input.referenceUrl) return "";
  return [
    "Reference crop lock:",
    buildTryOnReferenceCropLockRule(input.referenceAnalysis, input.referenceImageNumber || 2),
    "Generate the best pose only inside the reference's detected visible range. Do not solve ambiguity by zooming out, adding a full person, or revealing body parts outside the target crop.",
  ].join(" ");
}

function buildTryOnCandidateDirective(input: TryOnRequestPromptOptions) {
  const count = Math.max(1, Math.floor(Number(input.candidateCount || 1)));
  if (count <= 1) return "";

  const index = Math.max(0, Math.floor(Number(input.candidateIndex || 0))) % count;
  const variants = [
    "balanced clean fit with natural front drape",
    "slightly relaxed fit with deeper sleeve and waist folds",
    "more structured fit with cleaner seams and sharper collar/hem edges",
    "subtle live-model variation with tiny hand or shoulder relaxation and different hem/contact shadows",
  ];
  const variant = variants[index % variants.length];
  const shouldKeepFaceFixed = Boolean(input.referenceUrl && input.modelFaceUrl && shouldApplyFaceIdentityToReference(input.referenceAnalysis));
  const gptExpression = input.model === "gpt-image-2" && !shouldKeepFaceFixed
    ? " For GPT candidate variation, keep any visible face naturally consistent; do not create a stock expression or beauty-retouched face."
    : "";
  const cropVariation = buildCandidateCropVariationRule(input.referenceAnalysis);

  const faceVariationLock = shouldKeepFaceFixed
    ? " Do not vary the face, facial expression, gaze, head pose, head scale, makeup, or face lighting between candidates; candidate diversity must come from garment fit, folds, hem, contact shadows, and tiny non-face body relaxation only."
    : "";

  return `Candidate ${index + 1}/${count}: create a distinct but consistent try-on variation, not a near-duplicate. Keep the same visible identity cues, natural visible-skin integration, target visible-body proportions, target pose family, exact camera/framing/crop boundary, background, non-sourced outfit areas, sourced garment design, and reference-derived photography mood; vary garment fit, folds, hem, contact shadows, and small natural relaxation only within the visible crop as ${variant}. ${cropVariation}${faceVariationLock}${gptExpression}`;
}

function buildCandidateCropVariationRule(analysis?: TryOnReferenceAnalysis | null) {
  if (!analysis) return "Do not change the target crop type while creating variation.";
  if (analysis.bodyCrop === "lower_body") {
    return "Variation is limited to lower-body stance tension, pant folds, hem shape, shoes/floor contact when visible, and shadows; never add head, face, shoulders, or full torso.";
  }
  if (analysis.bodyCrop === "upper_body") {
    return "Variation is limited to upper-body posture, shoulder/arm/hand relaxation when visible, garment folds, and shadows; never zoom out to add legs or feet.";
  }
  if (analysis.bodyCrop === "closeup") {
    return "Variation is limited to the same close-up/detail area, fabric fit, contact shadows, and local pose cues; never zoom out to a half-body or full-body photo.";
  }
  if (analysis.bodyCrop === "scene_only") {
    return "Variation is limited to clothing fit and scene-consistent lighting; do not infer a person crop or full-body pose from the scene-only reference.";
  }
  if (analysis.bodyCrop === "three_quarter") {
    return "Variation must keep the same three-quarter body range and camera distance; never force a head-to-toe expansion.";
  }
  return "Variation must preserve the detected visible body range and crop boundaries; do not reveal body parts outside the reference crop.";
}

function buildGenerateRequestBody(input: GenerateInput, compiledPrompt: string): Record<string, any> {
  const body: Record<string, any> = {
    model: input.model,
    prompt: compiledPrompt,
  };

  if (input.model !== "gpt-image-2") {
    body.response_format = "url";
  }
  if (!isSeedreamModel(input.model) && input.model !== "gpt-image-2") {
    body.aspect_ratio = input.aspect_ratio || "3:4";
  }
  if (input.image && input.image.length > 0 && input.model !== "gpt-image-2") body.image = input.image;
  if (input.model === "gpt-image-2") {
    // gpt-image-2 /images/edits uses the documented size field, not image_size.
    body.size = input.image_size ? resolveGptImage2Size(input.image_size, input.aspect_ratio || "auto") : "auto";
    body.quality = "high";
  }
  if (input.image_size && isSeedreamModel(input.model)) {
    body.size = normalizeImageSize(input.model, input.image_size, input.aspect_ratio);
    body.watermark = false;
  }
  if (input.image_size && (input.model === "nano-banana-pro" || input.model === "nano-banana-2")) {
    body.image_size = input.image_size;
  }
  if (input.search && (input.model === "nano-banana-pro" || input.model === "nano-banana-2")) {
    body.search = input.search;
  }

  return body;
}

function shouldUseImageEditEndpoint(input: Pick<GenerateInput, "model" | "image">, provider: { name: string }): boolean {
  return provider.name === "plato" && input.model === "gpt-image-2" && Boolean(input.image?.length);
}

function shouldUseLaozhangNativeEndpoint(input: Pick<GenerateInput, "model">, provider: { name: string }): boolean {
  return provider.name === "laozhang" && isNanoBananaModel(input.model);
}

function buildImageGenerationRequest(params: {
  apiBase: string;
  apiKey: string;
  provider: { name: string };
  body: Record<string, any>;
}): { url: string; init: RequestInit } {
  return {
    url: getImageGenerationUrl(params.apiBase, params.provider),
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${params.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(params.body),
    },
  };
}

async function buildLaozhangNativeImageRequest(params: {
  apiBase: string;
  apiKey: string;
  model: string;
  prompt: string;
  imageUrls: string[];
  aspectRatio?: AspectRatio;
  imageSize?: ImageSize;
}): Promise<{ url: string; init: RequestInit }> {
  const imageParts = await Promise.all(params.imageUrls.map(fetchImageInlineDataPart));
  const parts = [
    { text: params.prompt },
    ...imageParts,
  ];

  return {
    url: getLaozhangGenerateContentUrl(params.apiBase, params.model),
    init: {
      method: "POST",
      headers: { "x-goog-api-key": params.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio: normalizeLaozhangAspectRatio(params.aspectRatio),
            imageSize: params.imageSize || "1K",
          },
        },
      }),
    },
  };
}

async function fetchImageInlineDataPart(src: string, index: number): Promise<{ inline_data: { mime_type: string; data: string } }> {
  const image = await fetchImageFormPart(src, index);
  const bytes = await image.blob.arrayBuffer();
  return {
    inline_data: {
      mime_type: image.blob.type || "image/png",
      data: Buffer.from(bytes).toString("base64"),
    },
  };
}

async function buildImageEditRequest(params: {
  apiBase: string;
  apiKey: string;
  body: Record<string, any>;
  imageUrls: string[];
}): Promise<{ url: string; init: RequestInit }> {
  if (!params.imageUrls.length) {
    throw new Error("gpt-image-2 image edit requires at least one reference image");
  }
  if (params.imageUrls.length > IMAGE_EDIT_MAX_IMAGES) {
    throw new Error("gpt-image-2 image edit supports fewer than 16 reference images");
  }

  const form = new FormData();
  for (const [key, value] of Object.entries(params.body)) {
    if (key === "image" || key === "response_format" || value === undefined || value === null) continue;
    form.append(key, String(value));
  }
  if (!Object.prototype.hasOwnProperty.call(params.body, "n")) {
    form.append("n", "1");
  }

  const images = await Promise.all(params.imageUrls.map(fetchImageFormPart));
  for (const image of images) {
    form.append("image", image.blob, image.filename);
  }

  return {
    url: getImageEditUrl(params.apiBase),
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${params.apiKey}`, Accept: "application/json" },
      body: form,
    },
  };
}

async function fetchImageFormPart(src: string, index: number): Promise<{ blob: Blob; filename: string }> {
  const imageUrl = typeof src === "string" ? src.trim() : "";
  if (!imageUrl) throw new Error("Missing reference image");
  if (!/^https?:\/\//i.test(imageUrl) && !/^data:image\//i.test(imageUrl)) {
    throw new Error("gpt-image-2 image edit requires public image URLs or data image URLs");
  }

  let res: Response;
  try {
    res = await fetch(imageUrl, { signal: AbortSignal.timeout(IMAGE_EDIT_FETCH_TIMEOUT_MS) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to download reference image: ${message}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Failed to download reference image ${res.status}: ${detail.slice(0, 200)}`);
  }

  const responseMimeType = normalizeImageMimeType(res.headers.get("content-type"));
  const inferredMimeType = inferImageMimeType(imageUrl);
  const mimeType = isSupportedEditImageMime(responseMimeType) ? responseMimeType : inferredMimeType;
  if (!mimeType) {
    throw new Error(`Unsupported reference image type: ${responseMimeType || "unknown"}`);
  }

  const bytes = await res.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new Error("Reference image is empty");
  }
  if (bytes.byteLength > IMAGE_EDIT_MAX_IMAGE_BYTES) {
    throw new Error("Reference image exceeds 50MB");
  }

  return {
    blob: new Blob([bytes], { type: mimeType }),
    filename: buildImageFilename(imageUrl, index, mimeType),
  };
}

async function pollImageTask(params: {
  provider: { name: string };
  apiBase: string;
  apiKey: string;
  taskId: string;
  onProgress?: GenerateInput["onProgress"];
}): Promise<{ urls: string[]; b64Json?: string }> {
  const startedAt = Date.now();
  const timeoutMs = getImageTaskTimeoutMs();
  const resultGraceMs = getImageTaskResultGraceMs();
  let lastProgress = 1;
  let completedWithoutResultAt: number | null = null;
  let lastResultlessSummary = "";
  let lastResultlessProviderStatus = "";
  let transientQueryErrors = 0;
  let lastTransientQueryError = "";
  const transientQueryErrorLimit = getImageTaskPollErrorRetryLimit();

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, getImageTaskPollIntervalMs()));
    const res = await fetch(`${params.apiBase}/images/tasks/${encodeURIComponent(params.taskId)}`, {
      headers: { Authorization: `Bearer ${params.apiKey}` },
    });
    const resText = await res.text();
    if (!res.ok) {
      const message = `任务查询失败 ${res.status}: ${resText.slice(0, 300)}`;
      if (isRetryableStatus(res.status) && transientQueryErrors < transientQueryErrorLimit) {
        transientQueryErrors += 1;
        lastTransientQueryError = message;
        await params.onProgress?.({
          taskId: params.taskId,
          status: "running",
          providerStatus: `QUERY_${res.status}`,
          progress: lastProgress,
          urls: [],
          error: message,
        });
        continue;
      }
      throw new Error(message);
    }
    transientQueryErrors = 0;
    lastTransientQueryError = "";
    const json = JSON.parse(resText);
    const task = normalizeImageTaskResponse(json, params.taskId);
    const progress = Math.max(lastProgress, task.progress);
    lastProgress = progress;
    const providerDoneWithoutResult = isImageTaskDoneStatus(task.providerStatus) && !task.urls.length && !task.b64Json;
    if (providerDoneWithoutResult) {
      completedWithoutResultAt ??= Date.now();
      lastResultlessSummary = describeResponseKeys(json);
      lastResultlessProviderStatus = task.providerStatus || "";
    } else {
      completedWithoutResultAt = null;
    }

    await params.onProgress?.({
      taskId: params.taskId,
      status: task.status,
      providerStatus: task.providerStatus,
      progress,
      urls: task.urls,
      error: task.error,
    });

    if (task.status === "completed") {
      return { urls: task.urls, b64Json: task.b64Json };
    }
    if (task.status === "failed") {
      throw new Error(task.error || "异步图片任务失败");
    }
    if (completedWithoutResultAt && Date.now() - completedWithoutResultAt >= resultGraceMs) {
      throw new Error(
        `异步图片任务已完成但结果 URL 未就绪，任务 ${params.taskId}，状态 ${lastResultlessProviderStatus || "-"}，响应字段: ${lastResultlessSummary || "unknown"}`
      );
    }
  }

  throw new Error(lastTransientQueryError ? `异步图片任务超时，最后一次查询错误：${lastTransientQueryError}` : "异步图片任务超时");
}

function normalizeImageTaskResponse(json: any, fallbackTaskId: string): {
  taskId: string;
  status: ImageTaskProgress["status"];
  providerStatus?: string;
  progress: number;
  urls: string[];
  b64Json?: string;
  error?: string;
} {
  const root = json?.data && !Array.isArray(json.data) ? json.data : json;
  const providerStatus = String(root?.status || json?.status || "").toUpperCase();
  const progress = parseProgress(root?.progress ?? json?.progress);
  const generatedImages = extractGeneratedImages(root);
  const urls = generatedImages.urls;
  const b64Json = normalizeB64Image(generatedImages.b64Json);
  const failReason = root?.fail_reason || root?.error || root?.message || json?.message;

  if (isImageTaskFailedStatus(providerStatus)) {
    return { taskId: root?.task_id || root?.taskId || root?.id || fallbackTaskId, status: "failed", providerStatus, progress, urls, b64Json, error: String(failReason || "生成失败") };
  }
  if (urls.length > 0 || b64Json) {
    return { taskId: root?.task_id || root?.taskId || root?.id || fallbackTaskId, status: "completed", providerStatus, progress: 100, urls, b64Json };
  }
  if (isImageTaskDoneStatus(providerStatus)) {
    return { taskId: root?.task_id || root?.taskId || root?.id || fallbackTaskId, status: "running", providerStatus, progress: 99, urls, b64Json };
  }
  return {
    taskId: root?.task_id || root?.taskId || root?.id || fallbackTaskId,
    status: isImageTaskQueuedStatus(providerStatus) ? "queued" : "running",
    providerStatus,
    progress,
    urls,
    b64Json,
  };
}

function extractTaskId(json: any): string {
  const candidates = [
    json?.task_id,
    json?.taskId,
    json?.task?.task_id,
    json?.task?.id,
    json?.data?.task_id,
    json?.data?.taskId,
    json?.data?.task?.task_id,
    json?.data?.task?.id,
    json?.result?.task_id,
    json?.result?.taskId,
    json?.output?.task_id,
    json?.output?.taskId,
    json?.request_id,
    json?.data?.request_id,
    Array.isArray(json?.data) ? json.data[0]?.task_id : undefined,
    Array.isArray(json?.data) ? json.data[0]?.taskId : undefined,
    Array.isArray(json?.data) ? json.data[0]?.id : undefined,
  ];
  const explicit = candidates.find((value) => (typeof value === "string" && value.trim()) || (typeof value === "number" && Number.isFinite(value)));
  if (typeof explicit === "number") return String(explicit);
  if (typeof explicit === "string") return explicit.trim();

  const statusLike = json?.status || json?.data?.status || json?.progress || json?.data?.progress;
  const ambiguousId = json?.id || json?.data?.id;
  if (!statusLike) return "";
  if (typeof ambiguousId === "number" && Number.isFinite(ambiguousId)) return String(ambiguousId);
  return typeof ambiguousId === "string" ? ambiguousId.trim() : "";
}

const IMAGE_URL_FIELDS = [
  "url",
  "image_url",
  "imageUrl",
  "imageURL",
  "result_url",
  "resultUrl",
  "asset_url",
  "assetUrl",
  "src",
  "file_url",
  "fileUrl",
  "download_url",
  "downloadUrl",
  "public_url",
  "publicUrl",
  "media_url",
  "mediaUrl",
  "output_url",
  "outputUrl",
  "signed_url",
  "signedUrl",
  "uri",
  "href",
  "link",
  "location",
  "image",
  "result",
  "output",
  "asset",
  "file",
  "media",
] as const;

const IMAGE_BASE64_FIELDS = [
  "b64_json",
  "b64Json",
  "base64",
  "base64_image",
  "base64Image",
  "image_base64",
  "imageBase64",
] as const;

function extractGeneratedImages(root: any): { urls: string[]; b64Json?: string } {
  const imageItems = extractImageItems(root);
  const urls = imageItems
    .flatMap(extractImageUrls)
    .filter(isImageUrl);
  const b64Json = imageItems
    .map(extractImageBase64)
    .find(Boolean);
  return { urls: Array.from(new Set(urls)), b64Json };
}

function extractImageItems(root: any): any[] {
  if (!root) return [];
  if (typeof root === "string") return isImageUrl(root) ? [{ url: root }] : [];
  if (Array.isArray(root)) {
    if (root.every((item) => typeof item === "string")) return root.map((url) => ({ url }));
    return root;
  }
  if (hasKnownImageResultField(root)) {
    return [root];
  }

  const candidates = [
    root?.data?.data,
    root?.data,
    root?.data?.images,
    root?.data?.image,
    root?.data?.urls,
    root?.data?.url,
    root?.data?.result_urls,
    root?.data?.result,
    root?.data?.output,
    root?.data?.outputs,
    root?.data?.artifacts,
    root?.data?.files,
    Array.isArray(root?.candidates) ? root.candidates.flatMap((candidate: any) => candidate?.content?.parts || []) : undefined,
    root?.content?.parts,
    root?.output?.images,
    root?.output?.image,
    root?.output?.data,
    root?.output?.urls,
    root?.output?.url,
    root?.output?.results,
    root?.output?.artifacts,
    root?.output?.files,
    root?.output,
    root?.outputs,
    root?.output_images,
    root?.result?.images,
    root?.result?.image,
    root?.result?.data,
    root?.result?.urls,
    root?.result?.url,
    root?.result?.outputs,
    root?.result?.artifacts,
    root?.result?.files,
    root?.result,
    root?.results,
    root?.images,
    root?.image,
    root?.artifacts,
    root?.files,
    root?.items,
    root?.assets,
    root?.resources,
    root?.result_urls,
    root?.urls,
    root?.image_url,
    root?.result_url,
    root?.file_url,
    root?.download_url,
  ];
  for (const candidate of candidates) {
    const items = extractImageItems(candidate);
    if (items.length) return items;
  }
  return collectImageItemsFromOutputContainers(root);
}

function extractImageUrls(item: any): string[] {
  if (typeof item === "string") return [item];
  if (!item || typeof item !== "object") return [];
  const urls: string[] = [];
  for (const field of IMAGE_URL_FIELDS) {
    const value = item[field];
    if (typeof value === "string" && value.trim()) {
      urls.push(value.trim());
      continue;
    }
    urls.push(...extractGeneratedImages(value).urls);
  }
  return urls;
}

function extractImageBase64(item: any): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const inlineData = item.inlineData || item.inline_data;
  if (inlineData && typeof inlineData === "object" && typeof inlineData.data === "string" && inlineData.data.trim()) {
    const mimeType = normalizeImageMimeType(inlineData.mimeType || inlineData.mime_type) || "image/png";
    return `data:${mimeType};base64,${inlineData.data.trim()}`;
  }
  for (const field of IMAGE_BASE64_FIELDS) {
    const value = item[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function isImageUrl(value: unknown): value is string {
  return typeof value === "string" && (/^https?:\/\//i.test(value) || /^data:image\//i.test(value));
}

function hasKnownImageResultField(value: any): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return IMAGE_URL_FIELDS.some((field) => value[field])
    || IMAGE_BASE64_FIELDS.some((field) => value[field])
    || Boolean(value.inlineData?.data || value.inline_data?.data);
}

function collectImageItemsFromOutputContainers(value: any, depth = 0, seen = new WeakSet<object>()): any[] {
  if (!value || depth > 6) return [];
  if (typeof value === "string") return isImageUrl(value) ? [{ url: value }] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectImageItemsFromOutputContainers(item, depth + 1, seen));
  }
  if (typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (hasKnownImageResultField(value)) return [value];

  const items: any[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (shouldSkipImageScanKey(key)) continue;
    if (isLikelyImageResultContainerKey(key)) {
      items.push(...collectImageItemsFromOutputContainers(child, depth + 1, seen));
    }
  }
  return items;
}

function shouldSkipImageScanKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return /input|source|reference|prompt|request|origin|mask|init/.test(normalized);
}

function isLikelyImageResultContainerKey(key: string): boolean {
  const normalized = key.replace(/[_-]/g, "").toLowerCase();
  return [
    "data",
    "output",
    "outputs",
    "result",
    "results",
    "response",
    "images",
    "image",
    "generatedimages",
    "resultimages",
    "artifacts",
    "artifact",
    "files",
    "file",
    "items",
    "item",
    "resources",
    "assets",
    "media",
    "urls",
    "url",
    "links",
  ].includes(normalized)
    || normalized.includes("image")
    || normalized.includes("result")
    || normalized.includes("output")
    || normalized.includes("artifact")
    || normalized.includes("file")
    || normalized.includes("url")
    || normalized.includes("media");
}

function describeResponseKeys(value: any): string {
  if (!value || typeof value !== "object") return typeof value;
  const topKeys = Object.keys(value).slice(0, 12);
  const dataKeys = value.data && typeof value.data === "object" && !Array.isArray(value.data)
    ? Object.keys(value.data).slice(0, 12)
    : [];
  const firstDataKeys = Array.isArray(value.data) && value.data[0] && typeof value.data[0] === "object"
    ? Object.keys(value.data[0]).slice(0, 12)
    : [];
  return [
    `top=${topKeys.join(",") || "none"}`,
    dataKeys.length ? `data=${dataKeys.join(",")}` : "",
    firstDataKeys.length ? `data[0]=${firstDataKeys.join(",")}` : "",
  ].filter(Boolean).join("; ");
}

function parseProgress(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.min(Math.max(Math.round(value), 0), 100);
  if (typeof value === "string") {
    const match = value.match(/\d+(?:\.\d+)?/);
    if (match) return Math.min(Math.max(Math.round(Number(match[0])), 0), 100);
  }
  return 1;
}

function isImageTaskDoneStatus(status?: string): boolean {
  return ["SUCCESS", "SUCCEEDED", "COMPLETED", "DONE"].includes(String(status || "").toUpperCase());
}

function isImageTaskFailedStatus(status?: string): boolean {
  return ["FAILURE", "FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(String(status || "").toUpperCase());
}

function isImageTaskQueuedStatus(status?: string): boolean {
  return ["NOT_START", "PENDING", "QUEUED", "SUBMITTED"].includes(String(status || "").toUpperCase());
}

function getImageTaskPollIntervalMs() {
  const value = Number(process.env.IMAGE_TASK_POLL_INTERVAL_MS || 2500);
  return Number.isFinite(value) ? Math.min(Math.max(value, 1000), 10000) : 2500;
}

function getImageTaskTimeoutMs() {
  const value = Number(process.env.IMAGE_TASK_TIMEOUT_MS || 20 * 60 * 1000);
  return Number.isFinite(value) ? Math.min(Math.max(value, 30_000), 45 * 60 * 1000) : 20 * 60 * 1000;
}

function getImageTaskResultGraceMs() {
  const value = Number(process.env.IMAGE_TASK_RESULT_GRACE_MS || 90_000);
  return Number.isFinite(value) ? Math.min(Math.max(value, 10_000), 5 * 60 * 1000) : 90_000;
}

function getImageTaskPollErrorRetryLimit() {
  const value = Number(process.env.IMAGE_TASK_POLL_ERROR_RETRY_LIMIT || 12);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 0), 60) : 12;
}

function getImageApiBaseUrl(): string {
  const envValue = process.env.LINGYA_BASE_URL;
  return envValue ? normalizeOpenAiCompatibleBaseUrl(envValue) : DEFAULT_API_BASE;
}

function getPlatoApiBaseUrl(): string {
  const envValue = process.env.PLATO_BASE_URL;
  const normalized = envValue ? normalizeOpenAiCompatibleBaseUrl(envValue) : "";
  if (!normalized || isDeprecatedGptImage2ProviderBase(normalized)) return DEFAULT_PLATO_API_BASE;
  return normalized;
}

function getLaozhangApiBaseUrl(): string {
  const raw = (process.env.LAOZHANG_BASE_URL || DEFAULT_LAOZHANG_API_BASE).trim().replace(/\/+$/, "");
  return raw.replace(/\/v1beta$/i, "").replace(/\/v1$/i, "");
}

function getImageProvider(model: LingyaModel): { name: string; apiBase: string; apiKey?: string } {
  if (model === "gpt-image-2") {
    return {
      name: "plato",
      apiBase: getPlatoApiBaseUrl(),
      apiKey: process.env.PLATO_API_KEY || process.env.LINGYA_API_KEY,
    };
  }
  if (isNanoBananaModel(model)) {
    return {
      name: "laozhang",
      apiBase: getLaozhangApiBaseUrl(),
      apiKey: process.env.LAOZHANG_API_KEY?.trim(),
    };
  }

  return {
    name: "lingya",
    apiBase: getImageApiBaseUrl(),
    apiKey: process.env.LINGYA_API_KEY,
  };
}

function getImageGenerationUrl(apiBase: string, provider: { name: string }): string {
  const endpoint = `${apiBase}/images/generations`;
  return shouldRequestAsyncImageTask(provider) ? `${endpoint}?async=true` : endpoint;
}

function getImageEditUrl(apiBase: string): string {
  return `${apiBase}/images/edits`;
}

function getLaozhangGenerateContentUrl(apiBase: string, model: string): string {
  return `${apiBase}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function shouldRequestAsyncImageTask(provider: { name: string }): boolean {
  return provider.name !== "plato" && provider.name !== "laozhang";
}

function resolveProviderImageModel(model: LingyaModel, provider: { name: string }): string {
  if (provider.name === "plato" && model === "gpt-image-2") {
    return DEFAULT_GPT_IMAGE_2_PROVIDER_MODEL;
  }
  if (provider.name === "laozhang" && model === "nano-banana-2") {
    return process.env.LAOZHANG_NANO_BANANA_MODEL?.trim() || DEFAULT_NANO_BANANA_PROVIDER_MODEL;
  }
  if (provider.name === "laozhang" && model === "nano-banana-pro") {
    return process.env.LAOZHANG_NANO_BANANA_PRO_MODEL?.trim() || DEFAULT_NANO_BANANA_PRO_PROVIDER_MODEL;
  }
  return model;
}

function isDeprecatedGptImage2ProviderBase(apiBase: string) {
  try {
    return new URL(apiBase).hostname === "api.bltcy.ai";
  } catch {
    return false;
  }
}

function resolveGptImage2Size(imageSize: ImageSize | undefined, aspectRatio: AspectRatio): string {
  const normalizedImageSize = isImageSizeValue(imageSize) ? imageSize : "1K";
  return resolveExactAspectPixelSize(normalizedImageSize, aspectRatio);
}

function isImageSizeValue(value: unknown): value is ImageSize {
  return value === "1K" || value === "2K" || value === "4K";
}

function normalizeB64Image(value?: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("data:")) return value;
  return `data:image/png;base64,${value}`;
}

function normalizeImageMimeType(value: string | null): string {
  return value?.split(";")[0]?.trim().toLowerCase() || "";
}

function inferImageMimeType(src: string): string | undefined {
  const dataMatch = src.match(/^data:([^;,]+)/i);
  if (dataMatch && isSupportedEditImageMime(dataMatch[1].toLowerCase())) {
    return dataMatch[1].toLowerCase();
  }

  let pathname = src;
  try {
    pathname = new URL(src).pathname;
  } catch {
    // Keep the raw value for extension inference.
  }

  const lower = pathname.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return undefined;
}

function isSupportedEditImageMime(value?: string): value is string {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp";
}

function buildImageFilename(src: string, index: number, mimeType: string): string {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.replace("image/", "") || "png";
  let basename = "";

  if (!src.startsWith("data:")) {
    try {
      basename = decodeURIComponent(new URL(src).pathname.split("/").pop() || "");
    } catch {
      basename = "";
    }
  }

  const safeName = basename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  if (!safeName || !/\.(png|jpe?g|webp)$/i.test(safeName)) {
    return `reference-${index + 1}.${extension}`;
  }
  return safeName;
}

function normalizeLaozhangAspectRatio(value?: AspectRatio): string {
  return value && value !== "auto" ? value : "1:1";
}

export function isNanoBananaModel(model: LingyaModel): boolean {
  return model === "nano-banana-2" || model === "nano-banana-pro";
}

function isSeedreamModel(model: LingyaModel): boolean {
  return model.startsWith("doubao-seedream-");
}

function isRetryableStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

function buildStructuredTryOnUserInstruction(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  const parts = trimmed
    .split(/[，,。；;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const uniqueParts = parts.filter((part) => {
    const normalized = part.replace(/\s+/g, "").toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
  const source = uniqueParts.length ? uniqueParts : [trimmed];

  const groups = {
    clothing: [] as string[],
    target: [] as string[],
    face: [] as string[],
    cleanup: [] as string[],
    other: [] as string[],
  };

  for (const part of source) {
    if (/水印|文字|去除|删除|多余|清理/.test(part)) {
      groups.cleanup.push(part);
      continue;
    }
    if (/脸|五官|肤色|皮肤|头部|头大小|头的大小|头姿|表情|妆容|face|skin|expression|head/i.test(part)) {
      groups.face.push(part);
      continue;
    }
    if (/模特|参考图|身体|姿势|背景|光线|构图|镜头|比例|身上|target|reference|pose|body|background/i.test(part)) {
      groups.target.push(part);
      continue;
    }
    if (/衣|服|裙|裤|上装|下装|内衬|带子|颜色|版型|长度|面料|纹理|细节|图案|logo|领|袖|下摆|腰|clothing|garment|dress|skirt|color|fabric/i.test(part)) {
      groups.clothing.push(part);
      continue;
    }
    groups.other.push(part);
  }

  const lines = [
    ["Clothing constraints", groups.clothing],
    ["Target body/reference constraints", groups.target],
    ["Face identity and integration constraints", groups.face],
    ["Cleanup constraints", groups.cleanup],
    ["Other user constraints", groups.other],
  ]
    .filter(([, entries]) => (entries as string[]).length > 0)
    .map(([label, entries]) => `- ${label}: ${(entries as string[]).join("; ")}`);

  if (!lines.length) return `User constraints: ${trimmed}`;

  return [
    "User constraints structured from the original request:",
    ...lines,
    "Apply these constraints within the image-role priorities above; repeated user wording must not override clothing/source/reference/face role separation.",
  ].join("\n");
}

// ============================================================
// 提示词构建 —— 多图任务必须显式标记每张图的角色
// ============================================================
//
// 图片顺序：
//   图1..图N：服装图
//   图N+1：参考图（可选，提供人物/姿势/背景/光影）
//   图N+2：模特脸（可选，提供最终脸部身份）
//
// 核心理念：先定义图像角色，再定义主目标、保留项、替换项和禁止项。
// 这样可以减少模型把参考图、服装图、脸图混淆的概率。
// ============================================================

export function buildTryOnPrompt(params: {
  clothingCount: number;
  clothingMode?: TryOnClothingMode;
  clothingRoles?: TryOnClothingRole[];
  clothingAnalysis?: TryOnClothingAnalysis | null;
  garmentAudience?: TryOnGarmentAudience;
  ageGroup?: TryOnAgeGroup;
  garmentCategory?: TryOnGarmentCategory;
  aspectRatio?: AspectRatio;
  hasModelFace: boolean;
  hasReference: boolean;
  referenceAnalysis?: TryOnReferenceAnalysis | null;
  style?: string;
}): { prompt: string; imageRoles: string[] } {
  const imageRoles: string[] = [];
  let prompt = "";
  const clothingMode = normalizeTryOnClothingMode(params.clothingMode || (params.clothingCount > 1 ? "multi" : "single"));
  const normalizedRoles = Array.from({ length: params.clothingCount }, (_, index) => {
    const fallback: TryOnClothingRole = clothingMode === "multi"
      ? index === 0 ? "upper" : index === 1 ? "lower" : "extra"
      : "single";
    return normalizeTryOnClothingRole(params.clothingRoles?.[index], fallback);
  });

  for (let i = 0; i < params.clothingCount; i++) {
    imageRoles.push(TRYON_CLOTHING_ROLE_LABELS[normalizedRoles[i]] || `服装${i + 1}`);
  }
  if (params.hasReference) imageRoles.push("参考图");
  if (params.hasModelFace) imageRoles.push("模特脸");

  const clothingRefs = Array.from({ length: params.clothingCount }, (_, i) => `图${i + 1}`);
  const clothingRoleText = clothingRefs
    .map((ref, index) => `${ref}是${TRYON_CLOTHING_ROLE_LABELS[normalizedRoles[index]] || "服装"}图，只提供衣服本身`)
    .join("，");
  const mainClothingRef = clothingRefs[0];
  const explicitSlotText = clothingRefs
    .map((ref, index) => `${ref}的${TRYON_CLOTHING_ROLE_LABELS[normalizedRoles[index]] || "服装"}`)
    .join("、");
  const clothingText = clothingMode === "multi"
    ? normalizedRoles.includes("upper") && normalizedRoles.includes("lower")
      ? `${clothingRefs.join("、")}的上装与下装`
      : explicitSlotText
    : `${mainClothingRef}的连体/全身服装`;
  const outfitAssemblyRule = clothingMode === "multi"
    ? "用户已选择换上下装槽位：每张服装图必须按显式槽位正确穿着，上装只替换上半身衣服，下装只替换下半身衣服；如果只上传一个槽位，只替换该槽位覆盖的服装并保留不冲突穿搭，保持层次关系、遮挡关系、腰线衔接和真实垂坠，不要把不同槽位融合成一件新衣服。"
    : `用户已选择连体/全身槽位：将${mainClothingRef}作为一件完整连体衣、连衣裙、套装或全身服装来处理，替换它覆盖范围内所有冲突的上装和下装，不要把它拆成无关上下装，也不要额外生成${mainClothingRef}以外的新服装；鞋履和不冲突配饰可自然保留。`;
  const referenceImageNumber = params.clothingCount + 1;
  const faceImageNumber = params.clothingCount + (params.hasReference ? 2 : 1);

  if (CONCISE_TRYON_PROMPT_MODE) {
    return {
      prompt: buildConciseTryOnPrompt({
        clothingRefs,
        clothingMode,
        clothingRoles: normalizedRoles,
        clothingAnalysis: params.clothingAnalysis,
        garmentAudience: params.garmentAudience,
        ageGroup: params.ageGroup,
        garmentCategory: params.garmentCategory,
        aspectRatio: params.aspectRatio,
        hasReference: params.hasReference,
        hasModelFace: params.hasModelFace,
        referenceAnalysis: params.referenceAnalysis,
        referenceImageNumber,
        faceImageNumber,
        style: params.style,
      }),
      imageRoles,
    };
  }

  // ---- 核心提示词（显式编号 + 保留/替换约束） ----
  const skinAndQuality = `真实皮肤质感，可见毛孔、自然纹理和轻微瑕疵，不过度磨皮。${TRYON_QUALITY}。`;
  const poseLock = `【最重要】${buildTryOnReferencePrompt(referenceImageNumber)}`;
  const garmentRules = [
    TRYON_CLOTHING_IMAGE_ROLE_RULE,
    buildTryOnClothingAnalysisRule(params.clothingAnalysis, normalizedRoles, clothingMode),
    buildTryOnAudiencePrompt({
      garmentAudience: params.garmentAudience,
      ageGroup: params.ageGroup,
    }),
    buildTryOnGarmentCategoryPrompt({
      garmentCategory: params.garmentCategory,
      ageGroup: params.ageGroup,
    }),
    buildTryOnFramePrompt({
      aspectRatio: params.aspectRatio,
      hasReference: params.hasReference,
      referenceImageNumber,
    }),
    params.hasReference ? buildTryOnReferenceAnalysisRule(params.referenceAnalysis, referenceImageNumber) : "",
    TRYON_GARMENT_RULE,
    TRYON_FIT_RULE,
    TRYON_MATERIAL_RULE,
    TRYON_SKIN_TONE_RULE,
    buildTryOnBodyProportionPrompt({
      garmentAudience: params.garmentAudience,
      ageGroup: params.ageGroup,
    }),
    TRYON_COLOR_RULE,
    TRYON_PHOTOGRAPHY_RULE,
  ].join("\n");
  const faceRule = buildTryOnFacePrompt({
    garmentAudience: params.garmentAudience,
    ageGroup: params.ageGroup,
    garmentCategory: params.garmentCategory,
    hasReference: params.hasReference,
    hasModelFace: params.hasModelFace,
    referenceImageNumber,
    modelFaceImageNumber: faceImageNumber,
  });
  const negativeRule = buildTryOnNegativePrompt({
    garmentAudience: params.garmentAudience,
    ageGroup: params.ageGroup,
    garmentCategory: params.garmentCategory,
  });

  if (params.hasReference && params.hasModelFace) {
    prompt = [
      `图像角色：${clothingRoleText}，图${referenceImageNumber}是参考图，图${faceImageNumber}是模特脸图。`,
      `任务：将${clothingText}穿在图${referenceImageNumber}参考图中的人物身上，并将人物脸部替换为图${faceImageNumber}的模特脸。`,
      outfitAssemblyRule,
      poseLock,
      faceRule,
      garmentRules,
      skinAndQuality,
      "不要改变参考图场景，不要生成多余人物，不要改变发型以外的主体身份特征。",
      negativeRule,
    ].join("\n");
  } else if (params.hasReference && !params.hasModelFace) {
    prompt = [
      `图像角色：${clothingRoleText}，图${referenceImageNumber}是参考图。`,
      `任务：将${clothingText}穿在图${referenceImageNumber}参考图中的人物身上。`,
      outfitAssemblyRule,
      poseLock,
      garmentRules,
      skinAndQuality,
      "不要改变参考图场景，不要生成多余人物，脸部身份保持不变。",
      negativeRule,
    ].join("\n");
  } else if (!params.hasReference && params.hasModelFace) {
    prompt = [
      `图像角色：${clothingRoleText}，图${faceImageNumber}是模特脸图。`,
      `任务：生成一张时尚换装照片，让人物穿上${clothingText}，脸部身份使用图${faceImageNumber}的模特脸。`,
      outfitAssemblyRule,
      faceRule,
      garmentRules,
      skinAndQuality,
      "姿势自然，光影真实，单人半身或全身构图，不要生成多余人物。",
      negativeRule,
    ].join("\n");
  } else {
    prompt = [
      `图像角色：${clothingRoleText}。`,
      `任务：生成一张时尚换装照片，让一个人物穿上${clothingText}。`,
      outfitAssemblyRule,
      garmentRules,
      skinAndQuality,
      "姿势自然，专业灯光，单人半身或全身构图，不要生成多余人物。",
      negativeRule,
    ].join("\n");
  }

  // 用户风格补充
  const userInstruction = buildStructuredTryOnUserInstruction(params.style);
  if (userInstruction) {
    prompt += `\n${userInstruction}`;
  }

  return { prompt, imageRoles };
}

function buildConciseTryOnPrompt(params: {
  clothingRefs: string[];
  clothingMode: TryOnClothingMode;
  clothingRoles: TryOnClothingRole[];
  clothingAnalysis?: TryOnClothingAnalysis | null;
  garmentAudience?: TryOnGarmentAudience;
  ageGroup?: TryOnAgeGroup;
  garmentCategory?: TryOnGarmentCategory;
  aspectRatio?: AspectRatio;
  hasReference: boolean;
  hasModelFace: boolean;
  referenceAnalysis?: TryOnReferenceAnalysis | null;
  referenceImageNumber: number;
  faceImageNumber: number;
  style?: string;
}) {
  const clothingSource = params.clothingRefs.length === 1
    ? "image 1"
    : `${params.clothingRefs.slice(0, -1).map(toEnglishImageRef).join(", ")} and ${toEnglishImageRef(params.clothingRefs[params.clothingRefs.length - 1])}`;
  const sourceNoun = params.clothingRefs.length === 1 ? "clothing source" : "clothing sources";
  const targetRef = `image ${params.referenceImageNumber}`;
  const faceRef = `image ${params.faceImageNumber}`;
  const lines: string[] = [];

  if (params.hasReference && params.hasModelFace) {
    return buildFixedBaseTryOnPrompt({
      ...params,
      clothingSource,
      sourceNoun,
      targetRef,
      faceRef,
      clothingAnalysis: params.clothingAnalysis,
      referenceAnalysis: params.referenceAnalysis,
    });
  }

  lines.push(buildConciseRoleLockRule(params));

  if (params.hasReference && params.hasModelFace) {
    lines.push(`Task: use ${clothingSource} only as ${sourceNoun}; replace the outfit on the person in ${targetRef} with the clothing from ${clothingSource}; discard ${targetRef}'s original facial identity; rebuild ${faceRef}'s recognizable identity and facial landmark geometry inside ${targetRef}'s original head space; retarget ${targetRef}'s visible expression category, expression intensity, emotional direction, gaze behavior, facial tension, natural asymmetry, skin tone, makeup style, visible-skin continuity, pose/body/head placement/background/camera/framing/lighting onto that ${faceRef} identity as one coherent performance.`);
  } else if (params.hasReference) {
    lines.push(`Task: use ${clothingSource} only as ${sourceNoun}; replace the outfit on the person in ${targetRef} with the clothing from ${clothingSource}; keep ${targetRef}'s pose/body/background/camera/framing/lighting.`);
  } else if (params.hasModelFace) {
    lines.push(`Task: create a believable single-person fashion photo wearing the clothing from ${clothingSource}; use ${faceRef} as the final recognizable face identity, natural skin-tone range, hairstyle character, and facial structure reference.`);
  } else {
    lines.push(`Task: create a photorealistic single-person fashion photo wearing the clothing from ${clothingSource}.`);
  }

  lines.push(buildConciseSourceIsolationRule(params.clothingRefs));
  lines.push(buildConciseClothingRoleRule(params.clothingRefs, params.clothingRoles, params.clothingMode));
  const analysisRule = buildTryOnClothingAnalysisRule(params.clothingAnalysis, params.clothingRoles, params.clothingMode);
  if (analysisRule) lines.push(analysisRule);

  if (params.hasReference) {
    const referenceAnalysisRule = buildTryOnReferenceAnalysisRule(params.referenceAnalysis, params.referenceImageNumber);
    if (referenceAnalysisRule) lines.push(referenceAnalysisRule);
    lines.push(...buildReferenceNoHeadFaceLockLines({
      referenceAnalysis: params.referenceAnalysis,
      targetRef,
      faceRef: params.hasModelFace ? faceRef : undefined,
    }));
    lines.push(buildConciseTargetCanvasRule({
      targetRef,
      clothingMode: params.clothingMode,
      clothingRoles: params.clothingRoles,
      hasModelFace: params.hasModelFace,
      referenceAnalysis: params.referenceAnalysis,
    }));
    lines.push(`Body/composition rule: keep ${targetRef}'s body proportions, adult body type when applicable, pose, visible body range, facial expression, head-to-body ratio, neck length, shoulder connection, camera angle, camera distance, perspective, framing, background, lighting direction, exposure, color temperature, shadows, and overall photo mood. Only allow natural changes caused by the new garment: fabric volume, folds, contact shadows, occlusion, sleeve coverage, and realistic drape.`);
  }

  if (params.hasModelFace) {
    lines.push(buildConciseFaceIntegrationRule({
      hasReference: params.hasReference,
      targetRef,
      faceRef,
    }));
  }

  if (params.hasReference && params.hasModelFace) {
    lines.push(`Identity lock - HARD: the final face must be immediately recognizable as the same person as ${faceRef}, after expression/skin/makeup/lighting are adapted from ${targetRef}. Do not solve the expression match by keeping ${targetRef}'s original face identity. If likeness to ${faceRef} becomes weak, the result is invalid even when the pose, clothing, or expression is correct.`);
  }

  lines.push(buildConcisePriorityRule({
    clothingSource,
    hasReference: params.hasReference,
    hasModelFace: params.hasModelFace,
    targetRef,
    faceRef,
  }));
  lines.push(buildConciseFailureHandlingRule({
    clothingSource,
    hasReference: params.hasReference,
    hasModelFace: params.hasModelFace,
    targetRef,
    faceRef,
  }));
  lines.push("Preserve source clothing type, silhouette, color, pattern/logo/text, fabric texture, neckline, sleeves, hem, pockets, buttons, zippers, seams, layers, length, and visible construction details.");
  lines.push(buildConciseAudienceRule(params.garmentAudience, params.ageGroup));
  if (params.garmentCategory === "intimate") {
    lines.push("Sensitive apparel rule: treat the source as adult intimate apparel or swimwear for a neutral commercial catalog/lookbook photo; keep the image non-erotic, non-suggestive, and do not show nudity, nipples, genitals, transparent exposure, sexual acts, bedroom/erotic scenes, minors, or minor-looking people.");
  }
  if (params.aspectRatio && params.aspectRatio !== "auto") {
    lines.push(`Output aspect ratio: ${params.aspectRatio}.`);
  }
  lines.push(`Photography: real camera fashion photo with believable lighting, natural visible skin texture, realistic fabric contact shadows, and accurate visible body parts within the target crop. ${params.hasReference ? `Preserve ${targetRef}'s original scene, camera distance, and crop boundary; only if ${targetRef} has no clear scene, use a natural commercial fashion setting.` : "Use a natural commercial fashion setting, not an empty gray stock-studio backdrop unless explicitly requested."} No extra people, no watermark, no added text, no plastic skin, no AI-render look, no stock-model expression, no model-face expression leakage, no model-face skin-tone leakage, no model-face makeup leakage, no pasted head, no face-swap seam, no mismatched skin, no oversized head, no long neck, no ID-photo face, no generic catalog face, no unrelated outfit changes.`);

  const userInstruction = buildStructuredTryOnUserInstruction(params.style);
  if (userInstruction) {
    lines.push(userInstruction);
  }

  return lines.join("\n");
}

function buildFixedBaseTryOnPrompt(params: {
  clothingRefs: string[];
  clothingMode: TryOnClothingMode;
  clothingRoles: TryOnClothingRole[];
  garmentAudience?: TryOnGarmentAudience;
  ageGroup?: TryOnAgeGroup;
  garmentCategory?: TryOnGarmentCategory;
  aspectRatio?: AspectRatio;
  targetRef: string;
  faceRef: string;
  clothingSource: string;
  sourceNoun: string;
  clothingAnalysis?: TryOnClothingAnalysis | null;
  referenceAnalysis?: TryOnReferenceAnalysis | null;
  style?: string;
}) {
  const targetImageNumber = Number(params.targetRef.replace(/\D/g, "")) || 2;
  const shouldUseFaceIdentity = shouldApplyFaceIdentityToReference(params.referenceAnalysis);
  const faceSetupLines = shouldUseFaceIdentity
    ? [
        `Reconstruct the final face from ${params.faceRef}'s recognizable identity, face outline, eye/brow/nose/mouth anatomy, feature spacing, and facial proportions, while naturally performing ${params.targetRef}'s expression, skin tone, makeup, head angle, lighting, and camera perspective.`,
        `Do not preserve ${params.targetRef}'s original facial identity, face shape, eyes, nose, mouth, or recognizable person. Every generated candidate must use ${params.faceRef}'s identity.`,
      ]
    : [
        `${params.targetRef} does not provide a visible head/face target. Do not zoom out, add a head, add a face, or convert the crop into a full-body portrait just to use ${params.faceRef}.`,
        `For this crop, ${params.faceRef} is inactive unless a face is already visible inside ${params.targetRef}'s original crop. Preserving the reference crop is higher priority than showing face identity.`,
      ];
  const faceRuleLines = shouldUseFaceIdentity
    ? [
        "Face identity rule:",
        "This is identity reconstruction, not a hard face swap.",
        `Use ${params.faceRef} only for recognizable facial identity: face shape, eyes, brows, nose, mouth anatomy, and feature proportions.`,
        `Use ${params.targetRef}'s original face only as an expression/pose/lighting carrier; do not keep its face outline, eye shape, nose shape, mouth anatomy, or recognizable identity.`,
        `Do not copy ${params.faceRef}'s original expression style, expression intensity, skin tone, makeup, lighting, pose, body, head size, or background.`,
        `Adapt ${params.faceRef}'s identity to ${params.targetRef}'s natural expression performance: visible expression category, intensity, emotional direction, gaze behavior, facial tension, and natural asymmetry. Allow subtle human micro-adjustments so the final face feels like ${params.faceRef}'s real person making that expression, not a mask or ID-photo overlay. Limit adaptation to expression muscles, gaze, skin relighting, makeup matching, pores, shadows, and edge blending; do not alter ${params.faceRef}'s face outline, eye shape, eye spacing, brow shape, nose structure, mouth anatomy, feature proportions, or recognizable likeness.`,
        `The final face must be recognizable as ${params.faceRef}'s person but naturally integrated, not pasted or ID-photo-like.`,
        "Face integration:",
        `Match ${params.targetRef}'s visible skin tone, undertone, brightness, makeup style, pores, subtle redness, reflected light, shadows, and scene lighting.`,
        `Blend continuously with ${params.targetRef}'s neck, chest, arms, and hands when those body areas are visible, with no mask edge or separate lighting.`,
      ]
    : [
        "Face identity rule:",
        `No final face should be generated when ${params.targetRef}'s detected crop has no visible head/face. Do not create a new identity outside the original frame.`,
      ];
  const priorityLines = shouldUseFaceIdentity
    ? [
        `1. ${params.faceRef} controls final facial identity and feature proportions where a face is visible in the target crop; likeness to ${params.faceRef} is mandatory and must be stronger than preserving ${params.targetRef}'s original face.`,
        `2. ${params.clothingSource} controls only the sourced clothing.`,
        `3. ${params.targetRef} controls the final face's natural expression direction and strength, plus visible body proportions, pose family, skin tone, makeup, lighting, scene, camera style, crop boundary, non-sourced outfit areas, and final mood; it must not control final facial identity.`,
      ]
    : [
        `1. ${params.targetRef} controls visible body range, crop boundary, pose family, lighting, scene, camera style, non-sourced outfit areas, and final mood.`,
        `2. ${params.clothingSource} controls only the sourced clothing.`,
        `3. ${params.faceRef} must not expand the crop or introduce a new visible face/head.`,
      ];
  const lines: string[] = [
    shouldUseFaceIdentity
      ? `Use ${params.targetRef} as the body/composition/lighting base try-on photo, but replace its facial identity with ${params.faceRef}. Perform a realistic fashion edit, not a full photo regeneration.`
      : `Use ${params.targetRef} as the base try-on photo. Perform a realistic fashion edit, not a full photo regeneration.`,
    "Image roles:",
    ...buildFixedBaseRoleBullets(params),
    "Task:",
    `Edit ${params.targetRef} into a believable try-on photo.`,
    buildFixedBaseReplacementTask(params),
    ...buildFixedBaseFaceIdentityLockLines(params, shouldUseFaceIdentity),
    ...buildReferenceNoHeadFaceLockLines({
      referenceAnalysis: params.referenceAnalysis,
      targetRef: params.targetRef,
      faceRef: params.faceRef,
    }),
    ...buildFixedBaseExpressionLockLines(params, shouldUseFaceIdentity),
    buildTryOnReferenceAnalysisRule(params.referenceAnalysis, targetImageNumber),
    ...faceSetupLines,
    `Keep natural adult proportions for the body parts visible in ${params.targetRef}; preserve its detected body scale, crop boundary, and camera distance. If head or full body is not visible, do not invent it. Avoid oversized head, tiny body, long neck, short legs, distorted shoulders, or changed body type.`,
    `Keep the overall camera distance, framing style, background, floor, and non-sourced outfit areas close to ${params.targetRef}, while allowing natural variation in garment fit, folds, hem shape, contact shadows, fabric drape, and small body/hand relaxation.`,
    "Clothing rule:",
    `${params.clothingSource} ${params.clothingRefs.length === 1 ? "is" : "are"} not a person reference. Do not copy any model, body, face, pose, skin, lighting, background, or scene from ${params.clothingSource}. Extract only the sourced garment material.`,
    buildTryOnClothingAnalysisRule(params.clothingAnalysis, params.clothingRoles, params.clothingMode),
    "Preserve source clothing accurately: garment type, silhouette, color, pattern, logo/text, fabric texture, neckline, sleeves, hem, pockets, buttons, zippers, seams, layers, length, and visible construction details.",
    ...buildFixedBaseLayeringRules(params),
    buildFixedBaseAreaRule(params),
    ...faceRuleLines,
    "Priority:",
    ...priorityLines,
    "Important:",
    shouldUseFaceIdentity
      ? `Do not keep ${params.targetRef}'s original facial identity.`
      : `Do not add a visible face/head that is outside ${params.targetRef}'s original crop.`,
    shouldUseFaceIdentity
      ? `Do not leave the face unchanged. The identity change to ${params.faceRef} is mandatory in every output.`
      : `Do not treat the absence of a visible face as an error; preserve the partial-body target crop.`,
    `Do not create a new model, unrelated scene, generic catalog face, or mismatched head/body composite.`,
    `Quality: realistic edited photo, natural fabric drape, realistic contact shadows, natural skin texture, accurate visible hands and feet when present in the crop. ${buildConciseAudienceRule(params.garmentAudience, params.ageGroup)} No extra people, no watermark, no added text, no AI-render look, no stock-model expression, no pasted head, no face-swap seam, no oversized head, no long neck, no ID-photo face, no unrelated outfit changes.`,
  ];

  if (params.garmentCategory === "intimate") {
    lines.push("Sensitive apparel rule: treat the source as adult intimate apparel or swimwear for a neutral commercial catalog/lookbook photo; keep the image non-erotic, non-suggestive, and do not show nudity, nipples, genitals, transparent exposure, sexual acts, bedroom/erotic scenes, minors, or minor-looking people.");
  }
  if (params.aspectRatio && params.aspectRatio !== "auto") {
    lines.push(`Output aspect ratio: ${params.aspectRatio}.`);
  }
  const userInstruction = buildStructuredTryOnUserInstruction(params.style);
  if (userInstruction) {
    lines.push(userInstruction);
  }

  return lines.filter(Boolean).join("\n");
}

function buildFixedBaseRoleBullets(params: {
  clothingRefs: string[];
  clothingMode: TryOnClothingMode;
  clothingRoles: TryOnClothingRole[];
  targetRef: string;
  faceRef: string;
  referenceAnalysis?: TryOnReferenceAnalysis | null;
}) {
  const clothing = params.clothingRefs.map((ref, index) => {
    const imageRef = toEnglishImageRef(ref);
    if (params.clothingMode === "multi") {
      const role = params.clothingRoles[index];
      if (role === "upper") return `- ${imageRef} = upper-body clothing source only.`;
      if (role === "lower") return `- ${imageRef} = lower-body clothing source only.`;
      return `- ${imageRef} = extra clothing source only.`;
    }
    return `- ${imageRef} = complete clothing source only.`;
  });

  const faceRole = shouldApplyFaceIdentityToReference(params.referenceAnalysis)
    ? `- ${params.faceRef} = mandatory final face identity reference only: facial structure, feature anatomy, face outline, eye/brow/nose/mouth geometry, and recognizable likeness; do not copy its original expression style, expression intensity, skin tone, makeup, head pose, head scale, lighting, body, clothing, background, or scene.`
    : `- ${params.faceRef} = conditional face identity reference only; do not use it to add a head/face outside ${params.targetRef}'s original crop.`;
  const targetRole = shouldApplyFaceIdentityToReference(params.referenceAnalysis)
    ? `- ${params.targetRef} = target expression and try-on reference: visible expression category, intensity, emotional direction, gaze behavior, facial tension, natural asymmetry, visible skin tone, makeup style, head pose, head size, visible body range, crop boundary, pose family, background, lighting, camera style, framing style, non-sourced outfit areas, and final photo mood. Its original facial identity, face outline, eyes, nose, and mouth anatomy must not be preserved as the final person.`
    : `- ${params.targetRef} = target try-on reference: visible body range, crop boundary, pose family, visible expression/skin/makeup when present, background, lighting, camera style, framing style, non-sourced outfit areas, and final photo mood. Its original facial identity must not be preserved only when a face is visible in the target crop.`;

  return [
    ...clothing,
    targetRole,
    faceRole,
  ];
}

function buildFixedBaseFaceIdentityLockLines(
  params: {
    targetRef: string;
    faceRef: string;
  },
  shouldUseFaceIdentity: boolean
) {
  if (!shouldUseFaceIdentity) return [];
  return [
    "Face identity lock - HARD:",
    `${params.faceRef} is the final person identity. The final face must be clearly recognizable as ${params.faceRef}'s person, not ${params.targetRef}'s original person.`,
    `${params.targetRef}'s face is only an expression, head-pose, skin-tone, makeup, lighting, and scale carrier; do not keep its face outline, eye shape, brow shape, nose shape, mouth anatomy, facial proportions, or recognizable identity.`,
    `If preserving ${params.targetRef}'s original facial identity conflicts with matching ${params.faceRef}'s likeness, ${params.faceRef}'s likeness wins. A result that still looks like ${params.targetRef}'s original face is invalid.`,
  ];
}

function buildFixedBaseExpressionLockLines(
  params: {
    targetRef: string;
    faceRef: string;
  },
  shouldUseFaceIdentity: boolean
) {
  if (!shouldUseFaceIdentity) return [];
  return [
    "Expression transfer:",
    `${params.targetRef} is the expression performance source. Preserve its visible expression category, intensity, emotional direction, gaze behavior, facial tension, and natural asymmetry as one coherent performance, not as rigid geometry.`,
    `${params.faceRef} is not an expression source. Retarget ${params.targetRef}'s expression performance onto ${params.faceRef}'s identity without copying ${params.faceRef}'s original expression or neutralizing ${params.targetRef}'s expression.`,
    `Anti-stock-expression constraints only prohibit generic fake expressions; they must not flatten or remove a natural expression that is visibly present in ${params.targetRef}.`,
  ];
}

function buildReferenceNoHeadFaceLockLines(params: {
  referenceAnalysis?: TryOnReferenceAnalysis | null;
  targetRef: string;
  faceRef?: string;
}) {
  if (!isHeadlessReference(params.referenceAnalysis)) return [];
  const isLowerBodyOnly = isHeadlessLowerBodyReference(params.referenceAnalysis);
  const faceSourceRule = params.faceRef
    ? `This applies even if ${params.faceRef} was uploaded; ignore ${params.faceRef} completely for this no-head crop.`
    : "This applies even when no model face was uploaded; do not invent a default face or complete person.";
  return [
    "Head/face absence lock - HARD:",
    isLowerBodyOnly
      ? `${params.targetRef} is a lower-body-only target frame with no visible head or face. The final image must remain lower-body-only/partial-body.`
      : `${params.targetRef} is a no-head/no-face target frame. The final image must preserve that crop and must not create a visible face or head.`,
    isLowerBodyOnly
      ? `Do not generate, reveal, add, infer, or hallucinate any head, face, neck, shoulders, upper torso, portrait, or full-body expansion outside ${params.targetRef}'s original crop.`
      : `Do not generate, reveal, add, infer, or hallucinate any head, face, hair, portrait, or full-body expansion outside ${params.targetRef}'s original crop.`,
    `${faceSourceRule} A result with any visible face or newly added head is invalid, even if the clothing looks correct.`,
  ];
}

function shouldApplyFaceIdentityToReference(analysis?: TryOnReferenceAnalysis | null) {
  if (!analysis) return true;
  if (analysis.bodyCrop === "lower_body" || analysis.bodyCrop === "scene_only") return false;
  if (analysis.bodyCrop === "closeup" && !analysis.faceVisible && !analysis.headVisible) return false;
  return analysis.faceVisible || analysis.headVisible;
}

function isHeadlessLowerBodyReference(analysis?: TryOnReferenceAnalysis | null) {
  return Boolean(analysis && analysis.bodyCrop === "lower_body" && !analysis.faceVisible && !analysis.headVisible);
}

function isHeadlessReference(analysis?: TryOnReferenceAnalysis | null) {
  return Boolean(analysis && !analysis.faceVisible && !analysis.headVisible);
}

function buildFixedBaseReplacementTask(params: {
  clothingMode: TryOnClothingMode;
  clothingRoles: TryOnClothingRole[];
  clothingSource: string;
  targetRef: string;
}) {
  if (params.clothingMode === "multi") {
    const hasUpper = params.clothingRoles.includes("upper");
    const hasLower = params.clothingRoles.includes("lower");
    if (hasUpper && !hasLower) {
      return `Replace only the upper-body clothing on the person in ${params.targetRef} with the upper-body garment from ${params.clothingSource}.`;
    }
    if (hasLower && !hasUpper) {
      return `Replace only the lower-body clothing on the person in ${params.targetRef} with the lower-body garment from ${params.clothingSource}.`;
    }
    if (hasUpper && hasLower) {
      return `Replace only the sourced upper- and lower-body clothing on the person in ${params.targetRef} with the garments from ${params.clothingSource}.`;
    }
    return `Replace only the sourced clothing areas on the person in ${params.targetRef} with the garments from ${params.clothingSource}.`;
  }

  return `Replace only the outfit area naturally covered by the clothing from ${params.clothingSource} on the person in ${params.targetRef}.`;
}

function buildFixedBaseLayeringRules(params: {
  clothingRefs: string[];
  clothingMode: TryOnClothingMode;
  clothingRoles: TryOnClothingRole[];
}) {
  if (params.clothingMode !== "multi") {
    return ["If the source contains multiple naturally layered clothing items, preserve their natural layering; if it contains only one garment, do not invent extra garments."];
  }

  return params.clothingRefs.flatMap((ref, index) => {
    const imageRef = toEnglishImageRef(ref);
    const role = params.clothingRoles[index];
    if (role === "upper") {
      return [
        `If ${imageRef} contains multiple upper-body items, preserve their natural layering.`,
        `If ${imageRef} contains only one garment, do not invent extra upper-body garments.`,
      ];
    }
    if (role === "lower") {
      return [
        `If ${imageRef} contains multiple lower-body items, preserve their natural layering.`,
        `If ${imageRef} contains only one garment, do not invent extra lower-body garments.`,
      ];
    }
    return [`If ${imageRef} contains only one item, do not invent extra garments.`];
  });
}

function buildFixedBaseAreaRule(params: {
  clothingMode: TryOnClothingMode;
  clothingRoles: TryOnClothingRole[];
  targetRef: string;
}) {
  if (params.clothingMode === "multi") {
    const hasUpper = params.clothingRoles.includes("upper");
    const hasLower = params.clothingRoles.includes("lower");
    if (hasUpper && !hasLower) {
      return `Upper-body-only rule: Replace only the conflicting upper-body outfit. Keep ${params.targetRef}'s visible lower-body clothing, shoes, legs, hands, accessories, background, and scene close to the reference unless naturally covered by the new upper garment. Do not reveal lower-body areas outside the original crop.`;
    }
    if (hasLower && !hasUpper) {
      return `Lower-body-only rule: Replace only the conflicting lower-body outfit. Keep ${params.targetRef}'s visible upper-body clothing, hands, accessories, background, and scene close to the reference unless naturally covered by the new lower garment. Do not reveal upper-body areas, head, or face outside the original crop.`;
    }
    if (hasUpper && hasLower) {
      return `Sourced-outfit-area rule: Replace only the conflicting upper- and lower-body outfit areas. Keep ${params.targetRef}'s visible hands, shoes, accessories, background, and scene close to the reference unless naturally covered by the new garments. Do not reveal body areas outside the original crop.`;
    }
  }

  return `Outfit-area rule: Replace only the clothing area naturally covered by the source garment. Keep ${params.targetRef}'s visible shoes, hands, accessories, background, and scene close to the reference unless naturally covered by the new garment. Do not reveal body areas outside the original crop.`;
}

function buildConciseRoleLockRule(params: {
  clothingRefs: string[];
  clothingRoles: TryOnClothingRole[];
  clothingMode: TryOnClothingMode;
  hasReference: boolean;
  hasModelFace: boolean;
  referenceImageNumber: number;
  faceImageNumber: number;
  referenceAnalysis?: TryOnReferenceAnalysis | null;
}) {
  const roles = params.clothingRefs.map((ref, index) => {
    const imageRef = toEnglishImageRef(ref);
    if (params.clothingMode === "multi") {
      const role = params.clothingRoles[index];
      if (role === "upper") return `${imageRef} = upper clothing source ONLY`;
      if (role === "lower") return `${imageRef} = lower clothing source ONLY`;
      return `${imageRef} = extra clothing source ONLY`;
    }
    return `${imageRef} = clothing source ONLY`;
  });

  if (params.hasReference) {
    if (isHeadlessLowerBodyReference(params.referenceAnalysis)) {
      roles.push(`image ${params.referenceImageNumber} = lower-body target frame / visible hips-legs-feet stance / crop boundary / camera distance / background / lighting ONLY; no head, no face, no upper torso, no full-body expansion`);
    } else {
      roles.push(params.hasModelFace
        ? `image ${params.referenceImageNumber} = target expression driver / skin tone / makeup / target body / pose / head placement / composition / background / lighting / skin continuity ONLY, not final facial identity`
        : `image ${params.referenceImageNumber} = target body / pose / head placement / composition / background / lighting / skin continuity ONLY`);
    }
  }
  if (params.hasModelFace) {
    roles.push(`image ${params.faceImageNumber} = final face identity / full facial landmark geometry / feature anatomy / likeness anchor ONLY, not facial expression, skin tone, makeup, body, clothing, head pose, head scale, background, or scene lighting`);
  }

  return `Strict role lock: ${roles.join("; ")}. Do not mix roles under any circumstance.`;
}

function buildConcisePriorityRule(params: {
  clothingSource: string;
  hasReference: boolean;
  hasModelFace: boolean;
  targetRef: string;
  faceRef: string;
}) {
  if (params.hasReference && params.hasModelFace) {
    return `Priority order: 1) ${params.faceRef} controls final recognizable facial identity, feature anatomy, relative spacing, and likeness. The final face must still read as ${params.faceRef}'s person. 2) ${params.targetRef} controls natural expression performance, skin tone, makeup style, head pose, head scale, neck/shoulder connection, lighting, background, composition, camera perspective, and photo mood, but NOT identity. 3) ${params.clothingSource} controls clothing only. Retarget ${params.targetRef}'s expression/skin/makeup onto ${params.faceRef}'s identity; do not keep ${params.targetRef}'s original eyes, nose, mouth, or face shape as identity features, and do not copy ${params.faceRef}'s fixed original expression, pale skin, or makeup unless they already match ${params.targetRef}. No hard face-swap, no ID-photo face, no pasted-head look.`;
  }

  if (params.hasReference) {
    return `Conflict priority: clothing = ${params.clothingSource}; body/pose/composition/background = ${params.targetRef}. No fallback to the target's original outfit.`;
  }

  if (params.hasModelFace) {
    return `Conflict priority: face identity = ${params.faceRef}; clothing = ${params.clothingSource}. No blending, no fallback, no reinterpretation.`;
  }

  return `Conflict priority: clothing = ${params.clothingSource}. No unrelated outfit redesign.`;
}

function buildConciseFailureHandlingRule(params: {
  clothingSource: string;
  hasReference: boolean;
  hasModelFace: boolean;
  targetRef: string;
  faceRef: string;
}) {
  if (params.hasReference && params.hasModelFace) {
    return `Failure handling: if anything is ambiguous, preserve ${params.faceRef}'s recognizable identity first, then keep ${params.targetRef}'s natural expression performance, skin tone, makeup style, body, head pose, head size, lighting, shadows, background, lower-body clothing when not sourced, and scene. Never fall back to ${params.targetRef}'s original facial identity. Do not keep ${params.faceRef}'s fixed original expression, pale skin, or makeup if ${params.targetRef} does not have them. Clothing accuracy stays from ${params.clothingSource}.`;
  }

  if (params.hasReference) {
    return `Failure handling: if anything is ambiguous, never use identity, pose, or scene from ${params.clothingSource}; clothing accuracy from ${params.clothingSource} and body/scene from ${params.targetRef} are mandatory.`;
  }

  if (params.hasModelFace) {
    return `Failure handling: if anything is ambiguous, never use identity from ${params.clothingSource}; face identity must stay from ${params.faceRef} and clothing accuracy from ${params.clothingSource}.`;
  }

  return `Failure handling: if anything is ambiguous, use ${params.clothingSource} only for clothing and generate one neutral photorealistic model.`;
}

function buildConciseFaceIntegrationRule(params: {
  hasReference: boolean;
  targetRef: string;
  faceRef: string;
}) {
  if (params.hasReference) {
    return `Face identity integration: this is identity retargeting, not a hard face swap and not target-face preservation. Use ${params.faceRef} as the identity anchor for the final recognizable person: face outline, eye shape and spacing, brow shape, nose bridge/tip/nostril geometry, mouth anatomy, facial feature size/proportions, and overall likeness. Do not use ${params.faceRef} for facial expression, skin tone, makeup, body, pose, scene lighting, or generic beauty retouch. Use ${params.targetRef} as the natural expression, skin-tone, makeup, pose, scale, and lighting driver. Expression transfer means preserving ${params.targetRef}'s visible expression category, intensity, emotional direction, gaze behavior, facial tension, and natural asymmetry as one coherent performance, while allowing subtle human micro-adjustments so ${params.faceRef}'s identity does not look pasted or rigid. Natural integration is achieved by adjusting expression muscles, gaze, skin relighting, makeup matching, pores, shadows, and edge blending only; never adjust ${params.faceRef}'s identity geometry, face outline, eye spacing, nose structure, mouth anatomy, feature proportions, or recognizable likeness to make it fit the reference. Do not neutralize, redesign, or flatten ${params.targetRef}'s visible expression because of anti-stock-expression constraints. Keep ${params.targetRef}'s head pose, head size, head-to-body ratio, neck connection, lighting direction, exposure, shadows, camera perspective, and photo mood. Reconstruct ${params.faceRef}'s identity within ${params.targetRef}'s head space, then relight it to ${params.targetRef}'s scene using ${params.targetRef}'s skin tone and makeup. The face must blend naturally with ${params.targetRef}'s neck, chest, arms, and hands, with continuous undertone, pores, subtle redness, reflected light, and shadow falloff. If ${params.faceRef} conflicts with ${params.targetRef}, ${params.faceRef} wins for identity/likeness/features; ${params.targetRef} wins for expression category, expression intensity, skin tone, makeup, pose, scale, lighting, perspective, and mood. No pasted head, ID-photo face, mask edge, mismatched skin, porcelain retouch, oversized head, long neck, forced generic expression, weak identity likeness, copied model-face expression, model-face skin-tone leakage, model-face makeup leakage, generic catalog face, separate lighting, target-original-face identity leakage, or face-swap seam.`;
  }

  return `${params.faceRef} is the final face identity source. Preserve recognizable facial structure, hair character, natural skin-tone range, and identity impression, while generating a realistic head size, neck connection, body skin continuity, lighting, skin texture, natural asymmetry, and a restrained non-stock expression for one believable camera photo. Do not replace it with a generic catalog expression, porcelain retouch, gray-studio stock model, or AI-render look.`;
}

function buildConciseSourceIsolationRule(clothingRefs: string[]) {
  const source = clothingRefs.length === 1 ? toEnglishImageRef(clothingRefs[0]) : clothingRefs.map(toEnglishImageRef).join(", ");
  const verb = clothingRefs.length === 1 ? "is" : "are";
  return `Clothing source isolation - HARD: ${source} ${verb} NOT person reference. Ignore any face, body, pose, skin, lighting, background, room, outdoor scene, or model identity in the clothing image; extract ONLY the garment as standalone product material.`;
}

function buildConciseClothingRoleRule(clothingRefs: string[], roles: TryOnClothingRole[], mode: TryOnClothingMode) {
  if (mode === "multi") {
    const roleLines = clothingRefs.map((ref, index) => {
      const imageRef = toEnglishImageRef(ref);
      const role = roles[index];
      if (role === "upper") return `${imageRef} = upper-body garment`;
      if (role === "lower") return `${imageRef} = lower-body garment`;
      return `${imageRef} = extra clothing item`;
    });
    const roleDetails: string[] = [];
    if (roles.includes("upper")) {
      roleDetails.push("If an upper-body source contains multiple upper-body items, preserve their natural layering and body placement; if it contains only one garment, do not invent extra upper-body garments.");
    }
    if (roles.includes("lower")) {
      roleDetails.push("If a lower-body source contains multiple lower-body items, preserve their natural layering and placement; if it contains only one garment, do not invent extra lower-body garments.");
    }
    return `Multi-garment rule: ${roleLines.join("; ")}. Wear each item on its correct body area, keep natural layering, and do not merge them into one new garment. ${roleDetails.join(" ")}`.trim();
  }

  return "Single-garment rule: image 1 was uploaded into the explicit one-piece/full-outfit slot. Treat it as one complete dress, jumpsuit, set, coat, or full-body garment; replace every conflicting target garment it covers, do not split it into unrelated upper/lower pieces, and do not invent extra clothing outside image 1.";
}

function buildTryOnClothingAnalysisRule(
  analysis: TryOnClothingAnalysis | null | undefined,
  roles: TryOnClothingRole[],
  mode: TryOnClothingMode
) {
  if (!analysis) return "";

  const categoryLabels = [
    ...analysis.subcategories.map((code) => TRYON_CATEGORY_BY_CODE.get(code)?.nameEn || code),
    analysis.mainCategory ? TRYON_CATEGORY_BY_CODE.get(analysis.mainCategory)?.nameEn || analysis.mainCategory : "",
  ].filter(Boolean);
  const explicitScope = mode === "multi" && roles.length === 1 && (roles[0] === "upper" || roles[0] === "lower")
    ? roles[0]
    : null;
  const slot = explicitScope || analysis.slot || null;
  const fit = analysis.fit || "regular";
  const rawType = analysis.clothTypeRaw || categoryLabels[0] || "garment";
  const confidence = analysis.confidence ? ` Confidence: ${Math.round(analysis.confidence * 100)}%.` : "";
  const categoryText = categoryLabels.length ? categoryLabels.join(" / ") : rawType;
  const explicitRoles = roles.map((role, index) => `image ${index + 1}=${role}`).join(", ");
  const explicitScopeNote = explicitScope && analysis.slot && analysis.slot !== explicitScope
    ? ` User explicit upload slot overrides visual classifier slot=${analysis.slot}; use ${explicitScope} as the replacement scope.`
    : "";

  const scopeRule = slot === "lower"
      ? "Treat this as a lower-body garment source. Replace only lower-body clothing and preserve non-conflicting visible upper-body clothing, hands, face/hair only when already visible in the target reference, background, and scene."
      : slot === "upper" || slot === "outer"
        ? "Treat this as an upper-body garment source. Replace only upper/outer clothing and preserve non-conflicting visible lower-body clothing, shoes, hands, face/hair only when already visible in the target reference, background, and scene."
        : slot === "single" || slot === "intimate" || slot === "functional"
          ? "Treat this as a complete single-piece/full-body garment source and replace only the body areas it naturally covers."
          : "Use the explicit upload slot roles as the replacement scope when classification is uncertain.";

  return `Visual clothing classification: detected ${categoryText}; raw type=${rawType}; slot=${slot || "unknown"}; fit=${fit}; upload mode=${mode}; explicit slots=${explicitRoles}.${confidence}${explicitScopeNote} ${scopeRule}`;
}

function buildConciseTargetCanvasRule(params: {
  targetRef: string;
  clothingMode: TryOnClothingMode;
  clothingRoles: TryOnClothingRole[];
  hasModelFace: boolean;
  referenceAnalysis?: TryOnReferenceAnalysis | null;
}) {
  const faceInstruction = isHeadlessReference(params.referenceAnalysis)
    ? isHeadlessLowerBodyReference(params.referenceAnalysis)
      ? `There is no visible face, head, hair, neck, shoulders, or upper torso to preserve; do not add any of them.`
      : `There is no visible face, head, or hair to preserve; do not add a new face, head, or hair outside the original crop.`
    : params.hasModelFace
    ? `Do not preserve ${params.targetRef}'s original facial identity; preserve only head placement, head pose, scale, hair/occlusion when compatible, lighting, and scene continuity.`
    : `Preserve ${params.targetRef}'s original facial identity, hair, and scene continuity.`;

  if (params.clothingMode === "multi") {
    const hasUpper = params.clothingRoles.includes("upper");
    const hasLower = params.clothingRoles.includes("lower");
    if (hasUpper && !hasLower) {
      return `${params.targetRef} is the target canvas. Replace only the upper-body outfit that conflicts with the upper source. Preserve ${params.targetRef}'s visible lower-body clothing, shoes, legs, hands, accessories, background, and scene unless naturally covered by the new upper garment. Do not reveal lower-body areas outside the original crop. ${faceInstruction}`;
    }
    if (hasLower && !hasUpper) {
      return `${params.targetRef} is the target canvas. Replace only the lower-body outfit that conflicts with the lower source. Preserve ${params.targetRef}'s visible upper-body clothing, hands, accessories, background, and scene unless naturally covered by the new lower garment. Do not reveal upper-body areas, head, or face outside the original crop. ${faceInstruction}`;
    }
    if (hasUpper && hasLower) {
      return `${params.targetRef} is the target canvas. Replace the sourced upper and lower outfit areas only. Preserve ${params.targetRef}'s visible hands, shoes, non-conflicting accessories, background, and scene unless naturally covered by the new garments. Do not reveal body areas outside the original crop. ${faceInstruction}`;
    }
    return `${params.targetRef} is the target canvas. Replace only the clothing area explicitly sourced by the clothing images and preserve all visible non-conflicting body, accessories, background, and scene details. Do not reveal body areas outside the original crop. ${faceInstruction}`;
  }

  return `${params.targetRef} is the target canvas. Treat the single clothing source as a complete one-piece/full-outfit garment and replace only the outfit area it naturally covers. Preserve ${params.targetRef}'s visible shoes, hands, accessories, background, scene, and visible skin continuity unless naturally covered by the new garment. Do not reveal body areas outside the original crop. ${faceInstruction}`;
}

function buildConciseAudienceRule(garmentAudience?: TryOnGarmentAudience, ageGroup?: TryOnAgeGroup) {
  const audience = garmentAudience === "men" ? "male" : "female";
  const group = ageGroup || "adult";

  if (group === "adult") {
    return `Model age/body rule: adult ${audience}; keep natural adult proportions and do not make the person childlike.`;
  }

  if (group === "teen") {
    return `Model age/body rule: teenage ${audience}; keep natural teen proportions and avoid adult, sexualized, or heavy-makeup styling.`;
  }

  const childLabel: Record<TryOnAgeGroup, string> = {
    adult: "adult",
    teen: "teen",
    big_child: "older child",
    middle_child: "middle child",
    small_child: "young child",
    toddler: "toddler",
  };
  const childGender = garmentAudience === "men" ? "boy" : "girl";
  return `Model age/body rule: ${childLabel[group]} ${childGender}; use age-appropriate child proportions. No adult body, sexualized styling, mature pose, or heavy makeup.`;
}

function toEnglishImageRef(value: string) {
  const match = value.match(/\d+/);
  return `image ${match?.[0] || "1"}`;
}

export const __lingyaTaskResponseTestUtils = {
  buildImageEditRequest,
  buildLaozhangNativeImageRequest,
  buildGenerateRequestBody,
  calculateImageRequestHeartbeatProgress,
  extractGeneratedImages,
  getImageEditUrl,
  getImageGenerationUrl,
  getLaozhangGenerateContentUrl,
  getPlatoApiBaseUrl,
  normalizeImageTaskResponse,
  resolveGptImage2Size,
  resolveProviderImageModel,
  shouldUseLaozhangNativeEndpoint,
  shouldUseImageEditEndpoint,
  shouldRequestAsyncImageTask,
};
