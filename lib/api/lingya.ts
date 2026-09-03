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
import {
  buildGarmentDetailReferencePrompt,
  flattenGarmentDetailGroups,
  normalizeGarmentDetailGroups,
  normalizeGarmentDetailUrls,
  type GarmentDetailPromptGroup,
  type GarmentDetailReferenceGroup,
} from "@/lib/garment-detail-references";
import { TRYON_CATEGORY_BY_CODE, type TryOnClothingAnalysis } from "@/lib/tryon-reference-config";
import {
  buildTryOnReferenceCropLockRule,
  buildTryOnReferenceAnalysisRule,
  decideTryOnFaceMode,
  type TryOnReferenceAnalysis,
} from "@/lib/tryon-reference-analysis";
import {
  TRYON_CLOTHING_ROLE_LABELS,
  normalizeTryOnClothingMode,
  normalizeTryOnClothingRole,
  type TryOnClothingMode,
  type TryOnClothingRole,
} from "@/lib/tryon-upload-rules";
import { logger } from "@/lib/logger";
import {
  getImageCreditCost,
  IMAGE_CREDIT_COSTS,
  IMAGE_MODEL_DISPLAY_ORDER,
  type PricedImageModel,
  type PricedImageSize,
} from "@/lib/model-pricing";
import { getRegisteredImageCreditCost, getRegisteredImageSizes } from "@/lib/image-model-catalog";
import {
  NonRetryableGenerationError,
  ProviderHttpResponseError,
  RetryableGenerationError,
  sanitizeGenerationErrorMessage,
} from "@/lib/api/generation-errors";
import type { AiResolvedDeployment } from "@/lib/ai-control-plane/types";
import { generateKieImage } from "@/lib/api/kie-image";

const CONCISE_TRYON_PROMPT_MODE = true;
const IMAGE_REQUEST_PROGRESS_INITIAL = 2;
const IMAGE_REQUEST_PROGRESS_INTERVAL_MS = 8000;
const IMAGE_REQUEST_PROGRESS_CURVE_MS = 90_000;
const SYNC_IMAGE_REQUEST_PROGRESS_MAX = 92;
const ASYNC_IMAGE_SUBMIT_PROGRESS_MAX = 8;
const GPT_IMAGE_2_QUALITY = "auto";
const IMAGE_EDIT_MAX_IMAGES = 15;
const IMAGE_EDIT_MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const IMAGE_EDIT_FETCH_TIMEOUT_MS = 60_000;
const TRYON_REAL_HUMAN_SKIN_RULE = "真人皮肤质感：保留可见毛孔、细微纹理、自然油光、局部红润、轻微瑕疵、法令纹/眼下细纹等真实人像细节；不要磨成瓷肌、塑料皮、蜡像皮、过度美颜、过度锐化或无瑕 AI 网红脸。";
const TRYON_REAL_HUMAN_SKIN_RULE_EN = "Real human skin texture: preserve visible pores, fine skin texture, natural shine, subtle redness, tiny blemishes, under-eye lines, and believable camera grain; no porcelain retouch, plastic/waxy skin, over-smoothing, over-sharpening, flawless AI influencer skin, or beauty-filter face.";

export type LingyaModel = PricedImageModel;
export type AspectRatio = "auto" | "1:1" | "9:16" | "16:9" | "4:3" | "3:4" | "2:3" | "3:2" | "4:5" | "5:4" | "21:9";
export type ImageSize = PricedImageSize;
export const DEFAULT_LINGYA_MODEL: LingyaModel = "nano-banana-2";

const LINGYA_MODELS: LingyaModel[] = [...IMAGE_MODEL_DISPLAY_ORDER];

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

export const CREDIT_COSTS = IMAGE_CREDIT_COSTS;

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
  const normalized = normalizeImageSize(model, size, aspectRatio);
  return getRegisteredImageCreditCost(model, normalized) ?? getImageCreditCost(model, normalized);
}

export function getSupportedImageSizes(model: LingyaModel, aspectRatio?: AspectRatio): ImageSize[] {
  const registered = getRegisteredImageSizes(model);
  if (registered?.length) return registered;
  if (model === "nano-banana-2-lite" || model === "z-image") return ["1K"];
  if (model === "qwen3" || model === "qwen3-pro") return ["1K", "2K"];
  if (isSeedreamModel(model)) return ["2K", "4K"];
  return ["1K", "2K", "4K"];
}

export function normalizeImageSize(model: LingyaModel, size: ImageSize = "1K", aspectRatio?: AspectRatio): ImageSize {
  if (model === "nano-banana-2-lite" || model === "z-image") return "1K";
  if ((model === "qwen3" || model === "qwen3-pro") && size === "4K") return "2K";
  const supported = getSupportedImageSizes(model, aspectRatio);
  return supported.includes(size) ? size : supported[0] || "1K";
}

export interface GenerateInput {
  model: LingyaModel;
  prompt: string;
  prompt_kind?: ImagePromptKind;
  aspect_ratio?: AspectRatio;
  image?: string[];
  smart_aspect_image?: string;
  image_size?: ImageSize;
  search?: boolean;
  onProgress?: (update: ImageTaskProgress) => Promise<void> | void;
  /** Stable provider submission key used across retries and failover fences. */
  idempotencyKey?: string;
  routingDeployment?: AiResolvedDeployment;
}

export interface GenerateResult {
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

type ImageProvider = {
  name: "admin";
  apiBase: string;
  apiKey?: string;
  upstreamModel?: string;
  responseType: "openai-image" | "gemini-native" | "kie-market";
  enabled?: boolean;
};

interface BatchTryOnInput {
  model: LingyaModel;
  clothingUrls: string[];
  clothingMode?: TryOnClothingMode;
  clothingRoles?: TryOnClothingRole[];
  clothingAnalysis?: TryOnClothingAnalysis | null;
  garmentDetailUrls?: string[];
  garmentDetailGroups?: GarmentDetailReferenceGroup[];
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
  imageGenerator?: (input: GenerateInput, retries?: number) => Promise<GenerateResult>;
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
  garmentDetailPromptGroups?: GarmentDetailPromptGroup[];
  unassignedGarmentDetailUrls?: string[];
  unassignedGarmentDetailImageNumbers?: number[];
};

export async function generateImage(input: GenerateInput, retries = 1): Promise<GenerateResult> {
  const requestInput = await resolveGenerateInputAspectRatio(input);
  if (!requestInput.routingDeployment) {
    throw new Error(`模型 ${requestInput.model} 必须通过统一模型控制平面选择供应商`);
  }
  const provider = imageProviderFromDeployment(requestInput.routingDeployment);
  if (provider.enabled === false) {
    throw new Error(`模型 ${requestInput.model} 已在后台关闭，暂不可用`);
  }
  const apiKey = provider.apiKey;
  if (!apiKey) throw new Error(`${provider.name} API Key 未配置`);
  const apiBase = provider.apiBase;
  const compiledPrompt = compileImagePromptForModel({
    kind: requestInput.prompt_kind,
    model: requestInput.model,
    prompt: requestInput.prompt,
  });

  if (provider.responseType === "kie-market") {
    logger.info(`[api:${provider.name}] Kie 图片任务: model=${requestInput.model}, image_count=${requestInput.image?.length || 0}`);
    const result = await generateKieImage({
      deployment: requestInput.routingDeployment,
      model: requestInput.model,
      prompt: compiledPrompt,
      imageUrls: requestInput.image,
      aspectRatio: requestInput.aspect_ratio,
      imageSize: requestInput.image_size,
      onProgress: requestInput.onProgress,
    });
    return {
      url: result.url,
      prompt: requestInput.prompt,
      compiledPrompt,
      taskId: result.taskId,
    };
  }

  const useGeminiNativeEndpoint = shouldUseGeminiNativeEndpoint(requestInput, provider);
  const useImageEditEndpoint = !useGeminiNativeEndpoint && shouldUseImageEditEndpoint(requestInput, provider);
  const body = buildGenerateRequestBody(requestInput, compiledPrompt);
  body.model = resolveProviderImageModel(requestInput.model, provider);

  // 日志（不含完整 base64、不含完整 prompt 内容）
  const logBody: Record<string, unknown> = {
    model: body.model,
    endpoint: useGeminiNativeEndpoint ? "generateContent" : useImageEditEndpoint ? "images/edits" : "images/generations",
    aspect_ratio: body.aspect_ratio,
    image_size: body.image_size || body.size,
    quality: body.quality,
    image_count: Array.isArray(requestInput.image) ? requestInput.image.length : 0,
    prompt_length: typeof body.prompt === "string" ? body.prompt.length : 0,
  };
  logger.info(`[api:${provider.name}] 请求:`, JSON.stringify(logBody));

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const isAsyncSubmit = !useGeminiNativeEndpoint && !useImageEditEndpoint && shouldRequestAsyncImageTask(provider);
      await requestInput.onProgress?.({ status: "queued", providerStatus: "REQUEST_QUEUED", progress: 1 });
      let res: Response;
      let resText: string;
      const stopRequestHeartbeat = startImageRequestProgressHeartbeat(requestInput.onProgress, {
        maxProgress: isAsyncSubmit ? ASYNC_IMAGE_SUBMIT_PROGRESS_MAX : SYNC_IMAGE_REQUEST_PROGRESS_MAX,
        providerStatus: isAsyncSubmit ? "SUBMITTING" : "GENERATING",
      });
      try {
        const request = useGeminiNativeEndpoint
          ? await buildGeminiNativeImageRequest({
              apiBase,
              apiKey,
              model: String(body.model),
              prompt: compiledPrompt,
              imageUrls: requestInput.image || [],
              aspectRatio: requestInput.aspect_ratio,
              imageSize: requestInput.image_size,
              idempotencyKey: requestInput.idempotencyKey,
            })
          : useImageEditEndpoint
            ? await buildImageEditRequest({ apiBase, apiKey, body, imageUrls: requestInput.image || [], idempotencyKey: requestInput.idempotencyKey })
            : buildImageGenerationRequest({ apiBase, apiKey, provider, body, idempotencyKey: requestInput.idempotencyKey });
        res = await fetch(request.url, { ...request.init, signal: requestInput.routingDeployment?.abortSignal });

        resText = await res.text();
      } finally {
        stopRequestHeartbeat();
      }

      if (!res.ok) {
        // Provider bodies are untrusted and frequently contain signed URLs or
        // internal diagnostics. Keep them out of logs, DB error fields and the
        // user-facing generation payload.
        const providerErrorCode = extractProviderErrorCode(resText);
        const providerRequestId = extractProviderRequestId(res.headers, resText);
        const retryAfterSeconds = parseRetryAfterSeconds(res.headers.get("retry-after"));
        logger.warn(
          `[api:${provider.name}] 第${attempt}次失败: HTTP ${res.status}`
          + `${providerErrorCode ? ` code=${providerErrorCode}` : ""}`
          + `${providerRequestId ? ` request_id=${providerRequestId}` : ""}`,
        );
        if (isRetryableStatus(res.status) && attempt < retries) {
          await new Promise(r => setTimeout(r, attempt * 5000));
          continue;
        }
        throw new ProviderHttpResponseError(describeProviderRejection(res.status), {
          status: res.status,
          code: providerErrorCode || `PROVIDER_HTTP_${res.status}`,
          retryAfterSeconds,
          providerRequestId,
          safeToFailover: isDefinitelyUnacceptedProviderResponse(res.status, providerErrorCode),
        });
      }

      let json: unknown;
      try {
        json = JSON.parse(resText);
      } catch {
        // A 2xx response with an unreadable body is ambiguous: the upstream
        // may already have accepted the request. Never re-POST it through a
        // durable retry/failover path without an explicit reconciliation API.
        throw new NonRetryableGenerationError(
          "图片生成接口返回了无效响应",
          "PROVIDER_INVALID_RESPONSE",
        );
      }
      const taskId = extractTaskId(json);
      const immediateResult = extractGeneratedImages(json);
      logger.info(`[api:${provider.name}] 生成响应: ok=${res.ok}, async=${shouldRequestAsyncImageTask(provider)}, hasTask=${Boolean(taskId)}, imageCount=${immediateResult.urls.length + (immediateResult.b64Json ? 1 : 0)}`);

      // Some synchronous Gemini gateways include a provider trace task_id next
      // to the final inline image. The image is authoritative: polling that ID
      // through the generic async endpoint discards a valid result.
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

      if (!taskId || !isAsyncSubmit) {
        throw new NonRetryableGenerationError(
          `图片生成接口未返回图片结果，响应字段: ${describeResponseKeys(json)}`,
          "PROVIDER_AMBIGUOUS_RESPONSE",
        );
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
      if (attempt < retries && isRetryableGenerationErrorForAdapter(err)) {
        await new Promise(r => setTimeout(r, attempt * 5000));
        continue;
      }
      throw err;
    }
  }

  throw new Error("API 多次重试后失败");
}

function describeProviderRejection(status: number) {
  if (status === 451) {
    return "提示词或输入图片可能包含模型暂不支持的敏感、受限或不符合内容政策的信息，请检查并调整后稍后再试（HTTP 451）";
  }
  return `供应商拒绝了生成请求（HTTP ${status}）`;
}

function isDefinitelyUnacceptedProviderResponse(status: number, code?: string) {
  if (status === 401 || status === 403 || status === 404 || status === 429) return true;

  // Some gateways wrap a pre-submission routing/configuration rejection in a
  // 5xx response. These codes prove that no billable upstream task was
  // created, so cross-deployment failover is safe. Generic 5xx responses stay
  // ambiguous and must never be replayed automatically.
  const normalizedCode = String(code || "").trim().toLowerCase();
  return normalizedCode === "model_not_found"
    || normalizedCode === "model-not-found"
    || normalizedCode === "local:convert_request_failed";
}

function parseRetryAfterSeconds(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.ceil(seconds), 3600);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(Math.max(Math.ceil((date - Date.now()) / 1000), 0), 3600);
}

function extractProviderRequestId(headers: Headers, body: string) {
  for (const name of [
    "x-request-id",
    "x-goog-request-id",
    "request-id",
    "x-trace-id",
    "trace-id",
    "x-correlation-id",
  ]) {
    const value = sanitizeProviderDiagnosticToken(headers.get(name));
    if (value) return value;
  }
  if (body && body.length <= 256_000) {
    try {
      const parsed = JSON.parse(body) as unknown;
      for (const candidate of collectProviderRequestIdCandidates(parsed)) {
        const value = sanitizeProviderDiagnosticToken(candidate);
        if (value) return value;
      }
    } catch {
      // Provider HTML/plain-text bodies are intentionally not persisted.
    }
  }
  return undefined;
}

function collectProviderRequestIdCandidates(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  const nested = root.error && typeof root.error === "object"
    ? root.error as Record<string, unknown>
    : {};
  return [
    nested.request_id,
    nested.requestId,
    nested.trace_id,
    nested.traceId,
    root.request_id,
    root.requestId,
    root.trace_id,
    root.traceId,
  ];
}

function extractProviderErrorCode(body: string) {
  if (!body || body.length > 256_000) return undefined;
  try {
    const parsed = JSON.parse(body) as unknown;
    const candidates = collectProviderErrorCodeCandidates(parsed);
    for (const candidate of candidates) {
      const sanitized = sanitizeProviderDiagnosticToken(candidate);
      if (sanitized) return sanitized;
    }
  } catch {
    // Provider HTML/plain-text bodies are intentionally not persisted.
  }
  return undefined;
}

function collectProviderErrorCodeCandidates(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  const nested = root.error && typeof root.error === "object"
    ? root.error as Record<string, unknown>
    : {};
  return [nested.code, nested.status, root.code, root.error_code, root.errorCode];
}

function sanitizeProviderDiagnosticToken(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const token = String(value).trim();
  if (!token || token.length > 160 || !/^[A-Za-z0-9._:/-]+$/.test(token)) return undefined;
  return token;
}

function imageProviderFromDeployment(deployment: AiResolvedDeployment): ImageProvider {
  if (deployment.protocol !== "openai-image" && deployment.protocol !== "gemini-native" && deployment.protocol !== "kie-market") {
    throw new Error(`图片部署 ${deployment.id} 的协议 ${deployment.protocol} 不受支持`);
  }
  const apiBase = deployment.protocol === "kie-market"
    ? deployment.provider.baseUrl.trim().replace(/\/+$/, "")
    : deployment.protocol === "gemini-native"
    ? normalizeGeminiNativeApiBaseUrl(deployment.provider.baseUrl, deployment.provider.baseUrl)
    : normalizeOpenAiCompatibleBaseUrl(deployment.provider.baseUrl);
  return {
    name: "admin",
    apiBase,
    apiKey: deployment.apiKey,
    upstreamModel: deployment.upstreamModel,
    responseType: deployment.protocol,
    enabled: deployment.enabled,
  };
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
  const hasReference = Boolean(input.referenceUrl);
  const clothingImageOffset = hasReference ? 1 : 0;
  const garmentDetailGroups = normalizeGarmentDetailGroups(input.garmentDetailGroups, input.clothingUrls.length);
  const groupedGarmentDetailUrls = flattenGarmentDetailGroups(garmentDetailGroups);
  const unassignedGarmentDetailUrls = garmentDetailGroups.length
    ? []
    : normalizeGarmentDetailUrls(input.garmentDetailUrls);
  const garmentDetailUrls = garmentDetailGroups.length ? groupedGarmentDetailUrls : unassignedGarmentDetailUrls;
  const aspectRatio = normalizeAspectRatio(await resolveSmartImageAspectRatio({
    aspectRatio: input.aspect_ratio || "3:4",
    image: input.referenceUrl || input.modelFaceUrl || input.clothingUrls[0],
    fallback: "3:4",
  }), "3:4");

  const { prompt } = buildTryOnPrompt({
    model: input.model,
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
    garmentDetailCount: garmentDetailUrls.length,
    style: input.style,
  });
  const detailStartImageNumber = clothingImageOffset
    + input.clothingUrls.length
    + (input.modelFaceUrl ? 1 : 0)
    + 1;
  const garmentDetailPromptGroups = buildGarmentDetailPromptGroups({
    groups: garmentDetailGroups,
    detailStartImageNumber,
    clothingRoles: input.clothingRoles,
    clothingImageOffset,
  });
  const rawPrompt = input.raw_prompt?.trim();
  const basePrompt = rawPrompt
    ? normalizeTryOnRawPromptImageReferences(rawPrompt, {
      clothingCount: input.clothingUrls.length,
      hasReference,
      hasModelFace: Boolean(input.modelFaceUrl),
    })
    : prompt;
  const finalPrompt = applyTryOnRequestPrompt(basePrompt, {
    ...input,
    referenceImageNumber: input.referenceUrl ? 1 : undefined,
    garmentDetailCount: garmentDetailUrls.length,
    garmentDetailPromptGroups,
    unassignedGarmentDetailUrls,
    unassignedGarmentDetailImageNumbers: unassignedGarmentDetailUrls.map((_, index) => detailStartImageNumber + index),
  });

  const imageInputs = buildTryOnImageInputsForRequest({
    clothingUrls: input.clothingUrls,
    referenceUrl: input.referenceUrl,
    modelFaceUrl: input.modelFaceUrl,
    garmentDetailUrls,
  });

  const result = await (input.imageGenerator || generateImage)({
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

export function buildTryOnImageInputsForRequest(input: {
  clothingUrls: string[];
  referenceUrl?: string;
  modelFaceUrl?: string;
  garmentDetailUrls?: string[];
}) {
  return [
    ...(input.referenceUrl ? [input.referenceUrl] : []),
    ...input.clothingUrls,
    ...(input.modelFaceUrl ? [input.modelFaceUrl] : []),
    ...(input.garmentDetailUrls || []),
  ];
}

export function normalizeTryOnRawPromptImageReferences(value: string | undefined, params: {
  clothingCount: number;
  hasReference: boolean;
  hasModelFace: boolean;
}) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  if (!shouldRemapTryOnRawPromptImageReferences(trimmed, params)) return trimmed;
  return remapTryOnImageReferences(trimmed, buildTryOnInputImageNumberMap(params));
}

export function applyTryOnRequestPrompt(prompt: string, input: TryOnRequestPromptOptions) {
  const basePrompt = prompt.trim();
  const lines = [basePrompt];
  lines.push(buildTryOnPhotoFinishDirective(input));
  const cropDirective = buildTryOnRequestCropDirective(input);
  if (cropDirective && shouldAppendTryOnRequestCropDirective(basePrompt)) lines.push(cropDirective);
  const multiOutputDirective = buildTryOnMultiOutputDirective(input);
  if (multiOutputDirective) lines.push(multiOutputDirective);
  const garmentDetailDirective = buildGarmentDetailReferencePrompt({
    groups: input.garmentDetailPromptGroups,
    unassignedUrls: input.unassignedGarmentDetailUrls,
    unassignedImageNumbers: input.unassignedGarmentDetailImageNumbers,
  }) || buildGarmentDetailReferencePrompt(input.garmentDetailCount || 0);
  if (garmentDetailDirective) lines.push(garmentDetailDirective);
  return lines.filter(Boolean).join("\n");
}

function shouldAppendTryOnRequestCropDirective(prompt: string) {
  return !/Reference visual analysis|Crop lock - HARD|裁切锁定/i.test(prompt);
}

function buildTryOnPhotoFinishDirective(input: TryOnRequestPromptOptions) {
  if (input.referenceUrl) {
    const referenceRef = buildTryOnReferenceLabel(input.referenceImageNumber || 1);
    return [
      `摄影风格：跟随${referenceRef}的影调（光线方向、色温、曝光、白平衡、景深、相机质感、滤镜氛围）。`,
      "服装固有色、图案、logo、面料纹理、人物身份、肤色连续性和身体比例保持准确；不要厚重美颜滤镜、不要海报版式、不要添加文字、不要漂白衣服颜色。",
      TRYON_REAL_HUMAN_SKIN_RULE,
      input.modelFaceUrl ? `在套用全局色调前，让最终脸部肤色与${referenceRef}的颈、胸、手臂、手在色相、亮度、阴影过渡、毛孔和反射光上自然衔接。` : "",
    ].filter(Boolean).join("");
  }

  return [
    "摄影风格：干净自然的商业时装摄影调性，光线可信，白平衡准确，真实相机透视，纹理克制。",
    "服装固有色、图案、logo、面料纹理、人物身份、肤色连续性和身体比例保持准确；不要厚重美颜滤镜、不要海报版式、不要添加文字、不要漂白衣服颜色。",
    TRYON_REAL_HUMAN_SKIN_RULE,
  ].join("");
}

function buildTryOnRequestCropDirective(input: TryOnRequestPromptOptions) {
  if (!input.referenceAnalysis || !input.referenceUrl) return "";
  const referenceRef = buildTryOnReferenceLabel(input.referenceImageNumber || 2);
  return [
    "裁切锁定：" + buildTryOnReferenceCropLockRule(input.referenceAnalysis, input.referenceImageNumber || 2),
    `只在${referenceRef}检测到的可见范围内生成最佳姿势，不要为了补全人物而拉远镜头、添加完整人体或显示${referenceRef}裁切之外的部位。`,
  ].join("");
}

function buildTryOnReferenceLabel(imageNumber: number) {
  return `image ${imageNumber}`;
}

function buildTryOnMultiOutputDirective(input: TryOnRequestPromptOptions) {
  const count = Math.max(1, Math.floor(Number(input.candidateCount || 1)));
  if (count <= 1) return "";
  const referenceRef = input.referenceUrl ? buildTryOnReferenceLabel(input.referenceImageNumber || 1) : "当前画面";
  return `多图输出规则：保持同一身份、脸部、表情、视线、头部姿态、身体比例、姿势族、镜头/裁切边界和${referenceRef}的影调；仅允许服装褶皱、下摆、接触阴影和布料自然贴合有轻微差异。`;
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
    body.quality = GPT_IMAGE_2_QUALITY;
  }
  if (input.image_size && isSeedreamModel(input.model)) {
    body.size = normalizeImageSize(input.model, input.image_size, input.aspect_ratio);
    body.watermark = false;
  }
  if (input.image_size && isNanoBananaModel(input.model)) {
    body.image_size = input.image_size;
  }
  if (input.search && isNanoBananaModel(input.model)) {
    body.search = input.search;
  }

  return body;
}

function shouldUseImageEditEndpoint(input: Pick<GenerateInput, "model" | "image">, provider: Pick<ImageProvider, "name" | "responseType">): boolean {
  return provider.responseType === "openai-image"
    && input.model === "gpt-image-2"
    && Boolean(input.image?.length);
}

function shouldUseGeminiNativeEndpoint(input: Pick<GenerateInput, "model">, provider: Pick<ImageProvider, "name" | "responseType">): boolean {
  return provider.responseType === "gemini-native" && isNanoBananaModel(input.model);
}

function buildImageGenerationRequest(params: {
  apiBase: string;
  apiKey: string;
  provider: Pick<ImageProvider, "name">;
  body: Record<string, any>;
  idempotencyKey?: string;
}): { url: string; init: RequestInit } {
  return {
    url: getImageGenerationUrl(params.apiBase, params.provider),
    init: {
      method: "POST",
      headers: imageHeaders(params.apiKey, params.idempotencyKey),
      body: JSON.stringify(params.body),
    },
  };
}

async function buildGeminiNativeImageRequest(params: {
  apiBase: string;
  apiKey: string;
  model: string;
  prompt: string;
  imageUrls: string[];
  aspectRatio?: AspectRatio;
  imageSize?: ImageSize;
  idempotencyKey?: string;
}): Promise<{ url: string; init: RequestInit }> {
  const imageParts = await Promise.all(params.imageUrls.map(fetchImageInlineDataPart));
  const parts = [
    { text: params.prompt },
    ...imageParts,
  ];

  return {
    url: getGeminiGenerateContentUrl(params.apiBase, params.model),
    init: {
      method: "POST",
      headers: { "x-goog-api-key": params.apiKey, "Content-Type": "application/json", ...(params.idempotencyKey ? { "Idempotency-Key": params.idempotencyKey } : {}) },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio: normalizeGeminiAspectRatio(params.aspectRatio),
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
  maskUrl?: string;
  idempotencyKey?: string;
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
  if (params.maskUrl) {
    const mask = await fetchImageFormPart(params.maskUrl, images.length);
    form.append("mask", mask.blob, mask.filename);
  }

  return {
    url: getImageEditUrl(params.apiBase),
    init: {
      method: "POST",
      // Let fetch add the multipart boundary. Reusing the JSON headers here
      // makes the upstream parse FormData as application/json and return 400.
      headers: imageAuthHeaders(params.apiKey, params.idempotencyKey),
      body: form,
    },
  };
}

function imageHeaders(apiKey: string, idempotencyKey?: string): Record<string, string> {
  return {
    ...imageAuthHeaders(apiKey, idempotencyKey),
    "Content-Type": "application/json",
  };
}

function imageAuthHeaders(apiKey: string, idempotencyKey?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
}

async function fetchImageFormPart(src: string, index: number): Promise<{ blob: Blob; filename: string }> {
  const imageUrl = typeof src === "string" ? src.trim() : "";
  if (!imageUrl) throw new Error("Missing reference image");
  if (!/^https?:\/\//i.test(imageUrl) && !/^data:image\//i.test(imageUrl)) {
    throw new Error("gpt-image-2 image edit requires public image URLs or data image URLs");
  }

  // SSRF protection is applied earlier in `lib/api/image-inputs.server.ts`
  // (DNS lookup + private-IP blocklist for RFC1918 / loopback / link-local /
  // cloud metadata). Here we just download the bytes for an already-validated
  // URL. `data:` URLs are bounded by MAX_DATA_URL_LENGTH upstream.
  let res: Response;
  try {
    res = await fetch(imageUrl, { signal: AbortSignal.timeout(IMAGE_EDIT_FETCH_TIMEOUT_MS) });
  } catch (err: unknown) {
    throw new RetryableGenerationError("参考图片下载网络暂时不可用", "REFERENCE_IMAGE_NETWORK", { cause: err });
  }

  if (!res.ok) {
    if (isRetryableStatus(res.status)) {
      throw new RetryableGenerationError(`参考图片下载暂时失败（HTTP ${res.status}）`, `REFERENCE_IMAGE_HTTP_${res.status}`);
    }
    throw new Error(`参考图片下载被拒绝（HTTP ${res.status}）`);
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
      const message = `任务查询失败（HTTP ${res.status}）`;
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
      if (isRetryableStatus(res.status)) {
        throw new RetryableGenerationError(message, `IMAGE_TASK_POLL_HTTP_${res.status}`);
      }
      throw new Error(message);
    }
    let json: unknown;
    try {
      json = JSON.parse(resText);
    } catch {
      const message = "任务查询返回了无效响应";
      if (transientQueryErrors < transientQueryErrorLimit) {
        transientQueryErrors += 1;
        lastTransientQueryError = message;
        continue;
      }
      // The task ID is already known. Do not surface this as a durable
      // execution retry, which would submit the same image again.
      throw new NonRetryableGenerationError(message, "IMAGE_TASK_POLL_INVALID_RESPONSE");
    }
    transientQueryErrors = 0;
    lastTransientQueryError = "";
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
      error: task.error ? sanitizeGenerationErrorMessage(task.error, "异步图片任务失败") : undefined,
    });

    if (task.status === "completed") {
      return { urls: task.urls, b64Json: task.b64Json };
    }
    if (task.status === "failed") {
      throw new Error(sanitizeGenerationErrorMessage(task.error, "异步图片任务失败"));
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
  const value = Number(process.env.IMAGE_TASK_POLL_ERROR_RETRY_LIMIT || 3);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 0), 10) : 3;
}

function normalizeGeminiNativeApiBaseUrl(value: string | undefined, fallback: string): string {
  const raw = (value || fallback).trim().replace(/\/+$/, "");
  return raw.replace(/\/v1beta$/i, "").replace(/\/v1$/i, "");
}

function getImageGenerationUrl(apiBase: string, provider: Pick<ImageProvider, "name">): string {
  const endpoint = `${apiBase}/images/generations`;
  return shouldRequestAsyncImageTask(provider) ? `${endpoint}?async=true` : endpoint;
}

function getImageEditUrl(apiBase: string): string {
  return `${apiBase}/images/edits`;
}

function getGeminiGenerateContentUrl(apiBase: string, model: string): string {
  return `${apiBase}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function shouldRequestAsyncImageTask(_provider: Pick<ImageProvider, "name">): boolean {
  return false;
}

function resolveProviderImageModel(model: LingyaModel, provider: Pick<ImageProvider, "name" | "upstreamModel">): string {
  if (provider.upstreamModel?.trim()) return provider.upstreamModel.trim();
  return model;
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

function normalizeGeminiAspectRatio(value?: AspectRatio): string {
  return value && value !== "auto" ? value : "1:1";
}

export function isNanoBananaModel(model: LingyaModel): boolean {
  return model === "nano-banana-2" || model === "nano-banana-2-lite" || model === "nano-banana-pro";
}

type GptTryOnPromptTemplate = "banana" | "legacy";

function getGptTryOnPromptTemplate(): GptTryOnPromptTemplate {
  return process.env.GPT_TRYON_PROMPT_TEMPLATE?.trim().toLowerCase() === "legacy"
    ? "legacy"
    : "banana";
}

function shouldUseNanoBananaTryOnTemplate(model: LingyaModel): boolean {
  if (isNanoBananaModel(model)) return true;
  if (model !== "gpt-image-2") return false;
  return getGptTryOnPromptTemplate() === "banana";
}

function isSeedreamModel(model: LingyaModel): boolean {
  return model.startsWith("doubao-seedream-");
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isRetryableGenerationErrorForAdapter(error: unknown): boolean {
  if (error instanceof NonRetryableGenerationError) return false;
  if (error instanceof ProviderHttpResponseError) return isRetryableStatus(error.status);
  if (error instanceof RetryableGenerationError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|network error|econnreset|econnrefused|enotfound|eai_again|etimedout|internal error/i.test(message);
}

function buildStructuredTryOnUserInstruction(value?: string, options: {
  imageNumberMap?: Map<number, number>;
  referenceImageNumber?: number;
} = {}) {
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

  for (const rawPart of source) {
    const part = normalizeTryOnGenericReferenceText(
      remapTryOnImageReferences(rawPart, options.imageNumberMap),
      options.referenceImageNumber
    );
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

function buildTryOnInputImageNumberMap(params: {
  clothingCount: number;
  hasReference: boolean;
  hasModelFace: boolean;
}) {
  const map = new Map<number, number>();
  const clothingCount = Math.max(0, Math.floor(Number(params.clothingCount) || 0));
  if (!params.hasReference) return map;

  for (let index = 0; index < clothingCount; index++) {
    map.set(index + 1, index + 2);
  }
  map.set(clothingCount + 1, 1);
  if (params.hasModelFace) {
    map.set(clothingCount + 2, clothingCount + 2);
  }
  return map;
}

function remapTryOnImageReferences(value: string | undefined, imageNumberMap?: Map<number, number>) {
  if (!value || !imageNumberMap?.size) return value || "";

  const replaceNumber = (raw: string) => {
    const parsed = parseImageRefNumber(raw);
    if (!parsed) return raw;
    return String(imageNumberMap.get(parsed) || parsed);
  };

  return value
    .replace(/图\s*([一二三四五六七八九十\d]+)/g, (_match, numberText: string) => `图${replaceNumber(numberText)}`)
    .replace(/image\s*([1-9]\d*)/gi, (_match, numberText: string) => `image ${replaceNumber(numberText)}`);
}

function normalizeTryOnGenericReferenceText(value: string, referenceImageNumber?: number) {
  if (!value || !referenceImageNumber) return value;
  const referenceLabel = `image ${referenceImageNumber}`;
  return value
    .replace(/(?<!图[一二三四五六七八九十\d]\s*)参考图(?!\s*[一二三四五六七八九十\d])/g, referenceLabel)
    .replace(/\breference image\b(?!\s*[1-9]\d*)/gi, `image ${referenceImageNumber}`);
}

function shouldRemapTryOnRawPromptImageReferences(value: string, params: {
  clothingCount: number;
  hasReference: boolean;
}) {
  if (!params.hasReference) return false;

  const oldTargetNumber = Math.max(1, Math.floor(Number(params.clothingCount) || 0)) + 1;
  const firstImageRef = buildImageRefRegexSource(1);
  const oldTargetRef = buildImageRefRegexSource(oldTargetNumber);
  const textWindow = "[^\\n。；;,.，]{0,80}";
  const clothingWords = "(?:服装|衣服|衣|上衣|上装|下装|裙|裤|clothing|garment|dress|shirt|top|bottom|skirt|pants)";
  const targetWords = "(?:参考图|参考|人物|模特|身上|target|reference|base|canvas|body|pose|composition|lighting)";
  const firstImageLooksClothing = new RegExp(`(?:${firstImageRef})${textWindow}${clothingWords}`, "i")
    .test(value);
  if (!firstImageLooksClothing) return false;

  const oldTargetLooksReference = new RegExp(`(?:${oldTargetRef})${textWindow}${targetWords}|${targetWords}${textWindow}(?:${oldTargetRef})`, "i")
    .test(value);
  return oldTargetLooksReference || new RegExp(targetWords, "i").test(value);
}

function buildImageRefRegexSource(imageNumber: number) {
  const aliases = [String(imageNumber), chineseImageNumber(imageNumber)].filter(Boolean).map(escapeRegExp);
  return `(?:image\\s*${imageNumber}|图\\s*(?:${aliases.join("|")}))`;
}

function chineseImageNumber(value: number) {
  const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const number = Math.floor(value);
  if (number <= 0 || number > 99) return "";
  if (number <= 9) return digits[number];
  if (number === 10) return "十";
  if (number < 20) return `十${digits[number - 10]}`;
  const tens = Math.floor(number / 10);
  const ones = number % 10;
  return `${digits[tens]}十${digits[ones]}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseImageRefNumber(value: string) {
  const normalized = value.trim();
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric);

  const chineseDigits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (Object.prototype.hasOwnProperty.call(chineseDigits, normalized)) return chineseDigits[normalized];
  if (/^十[一二三四五六七八九]$/.test(normalized)) return 10 + chineseDigits[normalized[1]];
  if (/^[一二三四五六七八九]十$/.test(normalized)) return chineseDigits[normalized[0]] * 10;
  if (/^[一二三四五六七八九]十[一二三四五六七八九]$/.test(normalized)) {
    return chineseDigits[normalized[0]] * 10 + chineseDigits[normalized[2]];
  }
  return 0;
}

// ============================================================
// 提示词构建 —— 多图任务必须显式标记每张图的角色
// ============================================================
//
// 图片顺序：
//   有参考图：图1=参考图（人物/姿势/背景/光影/base canvas），图2..图N+1=服装图，之后是模特脸（可选）
//   无参考图：图1..图N=服装图，之后是模特脸（可选）
//
// 核心理念：先定义图像角色，再定义主目标、保留项、替换项和禁止项。
// 这样可以减少模型把参考图、服装图、脸图混淆的概率。
// ============================================================

export function buildTryOnPrompt(params: {
  model?: LingyaModel;
  clothingCount: number;
  clothingMode?: TryOnClothingMode;
  clothingRoles?: TryOnClothingRole[];
  clothingAnalysis?: TryOnClothingAnalysis | null;
  garmentDetailCount?: number;
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
  const clothingImageOffset = params.hasReference ? 1 : 0;
  const imageNumberMap = buildTryOnInputImageNumberMap({
    clothingCount: params.clothingCount,
    hasReference: params.hasReference,
    hasModelFace: params.hasModelFace,
  });

  if (params.hasReference) imageRoles.push("参考图");
  for (let i = 0; i < params.clothingCount; i++) {
    imageRoles.push(TRYON_CLOTHING_ROLE_LABELS[normalizedRoles[i]] || `服装${i + 1}`);
  }
  if (params.hasModelFace) imageRoles.push("模特脸");

  const clothingRefs = Array.from({ length: params.clothingCount }, (_, i) => `图${i + 1 + clothingImageOffset}`);
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
  const referenceImageNumber = params.hasReference ? 1 : params.clothingCount + 1;
  const faceImageNumber = params.clothingCount + clothingImageOffset + 1;

  if (CONCISE_TRYON_PROMPT_MODE) {
    return {
      prompt: shouldUseNanoBananaTryOnTemplate(params.model || "gpt-image-2")
        ? buildNanoBananaTryOnPrompt({
          model: params.model || "gpt-image-2",
          clothingRefs,
          clothingMode,
          clothingRoles: normalizedRoles,
          clothingAnalysis: params.clothingAnalysis,
          garmentDetailCount: params.garmentDetailCount,
          garmentAudience: params.garmentAudience,
          ageGroup: params.ageGroup,
          garmentCategory: params.garmentCategory,
          aspectRatio: params.aspectRatio,
          hasReference: params.hasReference,
          hasModelFace: params.hasModelFace,
          referenceAnalysis: params.referenceAnalysis,
          referenceImageNumber,
          faceImageNumber,
          imageNumberMap,
          style: params.style,
        })
        : buildConciseTryOnPrompt({
        clothingRefs,
        clothingMode,
        clothingRoles: normalizedRoles,
        clothingAnalysis: params.clothingAnalysis,
        garmentDetailCount: params.garmentDetailCount,
        garmentAudience: params.garmentAudience,
        ageGroup: params.ageGroup,
        garmentCategory: params.garmentCategory,
        aspectRatio: params.aspectRatio,
        hasReference: params.hasReference,
        hasModelFace: params.hasModelFace,
        referenceAnalysis: params.referenceAnalysis,
        referenceImageNumber,
        faceImageNumber,
        imageNumberMap,
        style: params.style,
      }),
      imageRoles,
    };
  }

  // ---- 核心提示词（显式编号 + 保留/替换约束） ----
  const skinAndQuality = `${TRYON_REAL_HUMAN_SKIN_RULE}${TRYON_QUALITY}。`;
  const poseLock = `【最重要】${buildTryOnReferencePrompt(referenceImageNumber)}`;
  const garmentRules = [
    TRYON_CLOTHING_IMAGE_ROLE_RULE,
    buildTryOnClothingAnalysisRule(params.clothingAnalysis, normalizedRoles, clothingMode, {
      clothingImageNumbers: clothingRefs.map((ref) => Number(ref.replace(/\D/g, "")) || 1),
    }),
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
  const userInstruction = buildStructuredTryOnUserInstruction(params.style, {
    imageNumberMap,
    referenceImageNumber: params.hasReference ? referenceImageNumber : undefined,
  });
  if (userInstruction) {
    prompt += `\n${userInstruction}`;
  }

  return { prompt, imageRoles };
}

function buildNanoBananaTryOnPrompt(params: {
  model?: LingyaModel;
  clothingRefs: string[];
  clothingMode: TryOnClothingMode;
  clothingRoles: TryOnClothingRole[];
  clothingAnalysis?: TryOnClothingAnalysis | null;
  garmentDetailCount?: number;
  garmentAudience?: TryOnGarmentAudience;
  ageGroup?: TryOnAgeGroup;
  garmentCategory?: TryOnGarmentCategory;
  aspectRatio?: AspectRatio;
  hasReference: boolean;
  hasModelFace: boolean;
  referenceAnalysis?: TryOnReferenceAnalysis | null;
  referenceImageNumber: number;
  faceImageNumber: number;
  imageNumberMap?: Map<number, number>;
  style?: string;
}) {
  const clothingSource = params.clothingRefs.length === 1
    ? toEnglishImageRef(params.clothingRefs[0])
    : `${params.clothingRefs.slice(0, -1).map(toEnglishImageRef).join(", ")} and ${toEnglishImageRef(params.clothingRefs[params.clothingRefs.length - 1])}`;
  const sourceNoun = params.clothingRefs.length === 1 ? "clothing source" : "clothing sources";
  const targetRef = params.hasReference ? `image ${params.referenceImageNumber}` : "";
  const faceRef = `image ${params.faceImageNumber}`;
  const faceMode = params.hasReference
    ? decideTryOnFaceMode({
      hasModelFace: params.hasModelFace,
      referenceAnalysis: params.referenceAnalysis ?? null,
    })
    : params.hasModelFace ? "must_use_model_face" : "preserve_reference_face";
  const mustUseModelFace = params.hasModelFace && faceMode === "must_use_model_face";
  const garmentDetailCount = Math.max(0, Math.floor(Number(params.garmentDetailCount || 0)));
  const firstDetailImageNumber = params.clothingRefs.length
    + (params.hasReference ? 1 : 0)
    + (params.hasModelFace ? 1 : 0)
    + 1;
  const clothingAnalysisRule = buildNanoBananaClothingAnalysisRule(params.clothingAnalysis, params.clothingRoles, params.clothingMode, {
    clothingImageNumbers: params.clothingRefs.map((ref) => Number(ref.replace(/\D/g, "")) || 1),
  });
  const referenceAnalysisRule = params.hasReference
    ? buildTryOnReferenceAnalysisRule(params.referenceAnalysis, params.referenceImageNumber)
    : "";
  const userInstruction = buildStructuredTryOnUserInstruction(params.style, {
    imageNumberMap: params.imageNumberMap,
    referenceImageNumber: params.hasReference ? params.referenceImageNumber : undefined,
  });
  const lines: string[] = [
    "Follow the image roles below exactly: each input image has one source role only; do not average identities, garments, poses, or backgrounds across unrelated sources.",
    "Input image roles:",
    ...buildNanoBananaTryOnRoleLines(params, {
      targetRef,
      faceRef,
      mustUseModelFace,
      firstDetailImageNumber,
      garmentDetailCount,
    }),
    "Main task:",
    buildNanoBananaTryOnTaskLine(params, {
      clothingSource,
      sourceNoun,
      targetRef,
      faceRef,
      mustUseModelFace,
    }),
    params.hasReference
      ? `${targetRef} is the base canvas. Keep its body proportions, head-to-body ratio, head size, neck length, shoulder connection, visible-body range, pose family, camera distance, lens perspective, crop boundary, background, lighting direction, exposure, color temperature, shadows, and final photo mood. Only garment fit, folds, contact shadows, sleeve/hem coverage, and natural drape may change.`
      : "No target/base photo was uploaded. Generate one believable single-person fashion photo with natural body proportions, realistic head size, realistic neck/shoulder connection, and commercial camera perspective.",
    referenceAnalysisRule,
    ...buildReferenceNoHeadFaceLockLines({
      referenceAnalysis: params.referenceAnalysis,
      targetRef: targetRef || "the target frame",
      faceRef: params.hasModelFace ? faceRef : undefined,
    }),
    "Garment assembly:",
    buildConciseSourceIsolationRule(params.clothingRefs),
    buildNanoBananaClothingRoleRule(params.clothingRefs, params.clothingRoles, params.clothingMode),
    clothingAnalysisRule,
    params.hasReference
      ? buildFixedBaseAreaRule({
        clothingMode: params.clothingMode,
        clothingRoles: params.clothingRoles,
        targetRef,
      })
      : "When there is no target photo, wear every sourced garment on its correct body area; keep believable layering, waist connection, sleeve/hem placement, fabric tension, and contact shadows. Do not invent extra garments outside the uploaded clothing sources.",
    ...buildFixedBaseLayeringRules(params),
    "Preserve source clothing accurately: garment type, silhouette, color, pattern/logo/text, fabric texture, neckline, sleeves, hem, pockets, buttons, zippers, seams, layers, length, and visible construction details.",
    ...(garmentDetailCount > 0 ? [
      "Garment detail references:",
      `${formatEnglishImageRange(firstDetailImageNumber, garmentDetailCount)} are local detail supplements for the main clothing image assigned in the garment-detail section. Use them only to restore fabric, neckline, cuff, pocket, button, zipper, logo, back-view, or side-view details for that assigned garment. Never treat detail images as new garments, people, poses, faces, bodies, backgrounds, lighting, or cross-garment texture sources.`,
    ] : []),
    ...buildNanoBananaTryOnFaceLines(params, {
      targetRef,
      faceRef,
      mustUseModelFace,
    }),
    "Priority:",
    ...buildNanoBananaTryOnPriorityLines(params, {
      clothingSource,
      targetRef,
      faceRef,
      mustUseModelFace,
    }),
    buildConciseAudienceRule(params.garmentAudience, params.ageGroup),
    buildVisualAudienceHintRule(params.clothingAnalysis, params.garmentAudience, params.ageGroup),
    params.garmentCategory === "intimate"
      ? "Sensitive apparel rule: treat the source as adult intimate apparel or swimwear for a neutral commercial catalog/lookbook photo; keep the image non-erotic, non-suggestive, and do not show nudity, nipples, genitals, transparent exposure, sexual acts, bedroom/erotic scenes, minors, or minor-looking people."
      : "",
    params.aspectRatio && params.aspectRatio !== "auto" ? `Output aspect ratio: ${params.aspectRatio}.` : "",
    `Quality and negatives: realistic edited photo, ${TRYON_REAL_HUMAN_SKIN_RULE_EN} Believable fabric drape, accurate visible hands/feet when present, no extra people, no watermark, no added text, no AI-render look, no pasted head, no face-swap seam, no mismatched skin, no oversized head, no tiny body, no long neck, no changed body type, no generic catalog face, no unrelated outfit redesign.`,
    userInstruction,
  ];

  return lines.filter(Boolean).join("\n");
}

function buildNanoBananaTryOnRoleLines(
  params: {
    clothingRefs: string[];
    clothingMode: TryOnClothingMode;
    clothingRoles: TryOnClothingRole[];
    hasReference: boolean;
    hasModelFace: boolean;
    referenceAnalysis?: TryOnReferenceAnalysis | null;
  },
  refs: {
    targetRef: string;
    faceRef: string;
    mustUseModelFace: boolean;
    firstDetailImageNumber: number;
    garmentDetailCount: number;
  }
) {
  const clothing = params.clothingRefs.map((ref, index) => {
    const imageRef = toEnglishImageRef(ref);
    if (params.clothingMode === "multi") {
      const role = params.clothingRoles[index];
      if (role === "upper") return `- ${imageRef} = upper clothing source only: garment material, color, silhouette, construction, and upper-body placement.`;
      if (role === "lower") return `- ${imageRef} = lower clothing source only: garment material, color, silhouette, construction, and lower-body placement.`;
      return `- ${imageRef} = extra clothing source only: use only for the explicitly sourced garment/accessory area.`;
    }
    return `- ${imageRef} = clothing source only: the uploaded garment/outfit itself, its natural body coverage, material, color, silhouette, construction, and visible details; not a person, body, pose, face, lighting, or background reference.`;
  });

  const target = !params.hasReference ? [] : [
    refs.mustUseModelFace
      ? `- ${refs.targetRef} = target/base canvas only: body, body proportions, head-to-body ratio, head position/size, expression performance, visible skin tone, makeup style, pose, crop, background, lighting, camera, and final mood; not final facial identity.`
      : `- ${refs.targetRef} = target/base canvas and preserved visible identity: body, body proportions, visible face/head when present, pose, crop, background, lighting, camera, and final mood.`,
  ];
  const face = !params.hasModelFace ? [] : [
    refs.mustUseModelFace
      ? `- ${refs.faceRef} = final face identity only: facial structure, feature anatomy, face outline, eye/brow/nose/mouth geometry, hairstyle character, and recognizable likeness; not body, pose, expression source, background, scene, or garment source.`
      : `- ${refs.faceRef} = inactive because the target crop has no usable face/head swap area; do not add a face or head outside the target crop.`,
  ];

  return [
    ...clothing,
    ...target,
    ...face,
    ...(refs.garmentDetailCount > 0
      ? [`- ${formatEnglishImageRange(refs.firstDetailImageNumber, refs.garmentDetailCount)} = garment detail references only, assigned by "服装细节归属规则"; never use them as new clothing/person/background references.`]
      : []),
  ];
}

function formatEnglishImageRange(firstImageNumber: number, count: number) {
  const safeFirst = Math.max(1, Math.floor(Number(firstImageNumber) || 1));
  const safeCount = Math.max(0, Math.floor(Number(count) || 0));
  if (safeCount <= 1) return `image ${safeFirst}`;
  return `images ${safeFirst}-${safeFirst + safeCount - 1}`;
}

function buildNanoBananaTryOnTaskLine(
  params: {
    hasReference: boolean;
    hasModelFace: boolean;
  },
  refs: {
    clothingSource: string;
    sourceNoun: string;
    targetRef: string;
    faceRef: string;
    mustUseModelFace: boolean;
  }
) {
  if (params.hasReference && refs.mustUseModelFace) {
    return `Use ${refs.targetRef} as the base try-on photo; replace only the sourced outfit areas with ${refs.clothingSource} as ${refs.sourceNoun}; rebuild the final visible face from ${refs.faceRef} while keeping ${refs.targetRef}'s visible expression category, intensity, emotional direction, gaze behavior, head space, body proportions, pose, crop, lighting, and scene.`;
  }
  if (params.hasReference) {
    return `Use ${refs.targetRef} as the base try-on photo; replace only the sourced outfit areas with ${refs.clothingSource} as ${refs.sourceNoun}; preserve the visible face/head identity and the original target crop.`;
  }
  if (params.hasModelFace) {
    return `Create one believable fashion try-on photo wearing ${refs.clothingSource} as ${refs.sourceNoun}; use ${refs.faceRef} as the final recognizable face identity while generating a natural matching body, pose, lighting, and camera view.`;
  }
  return `Create one believable single-person fashion try-on photo wearing ${refs.clothingSource} as ${refs.sourceNoun}; no extra person and no unrelated outfit redesign.`;
}

function buildNanoBananaTryOnFaceLines(
  params: {
    model?: LingyaModel;
    hasReference: boolean;
    hasModelFace: boolean;
    referenceAnalysis?: TryOnReferenceAnalysis | null;
  },
  refs: {
    targetRef: string;
    faceRef: string;
    mustUseModelFace: boolean;
  }
) {
  if (refs.mustUseModelFace && params.hasReference) {
    const similarFaceClause = params.model === "gpt-image-2"
      ? ` When ${refs.targetRef} and ${refs.faceRef} look similar, hair color, skin tone, makeup, or beauty styling alone is not identity transfer; do not settle for an averaged face, and keep ${refs.faceRef}'s face outline, eye spacing/shape, brow-eye relation, nose bridge/tip/nostrils, mouth shape, jaw/chin, cheekbone balance, hairline, ear placement, and recognizable likeness stronger than ${refs.targetRef}.`
      : "";
    return [
      "Face identity:",
      `${refs.faceRef} is the only final face identity source. The final face must be immediately recognizable as ${refs.faceRef}, not ${refs.targetRef}'s original person, not a random new face, not a generic influencer/catalog face, and not an average blend of both faces.${similarFaceClause}`,
      `${refs.targetRef} may guide only expression category/intensity, gaze direction, head placement, head size, skin brightness range, makeup mood, lighting, shadows, and face-to-neck/body continuity. It must not donate final face outline, eyes, nose, mouth, facial proportions, or recognizable identity.`,
      `Expression transfer: preserve ${refs.targetRef}'s visible expression category, intensity, emotional direction, gaze behavior, facial tension, eyelid/cheek/mouth-corner dynamics, and natural asymmetry as one coherent performance. Retarget that performance onto ${refs.faceRef}'s identity without copying ${refs.faceRef}'s original expression and without flattening ${refs.targetRef}'s expression into a neutral catalog face.`,
      `Face blending: rebuild the visible head-and-face area from ${refs.faceRef}'s identity inside ${refs.targetRef}'s original head space, head bounding box, head-to-body ratio, camera perspective, and lighting direction. Fit ${refs.faceRef}'s identity geometry into ${refs.targetRef}'s head scale, including face size, skull volume, hair volume, neck length, shoulder distance, jaw-to-neck contact, hairline, ears, and occlusion edges; do not enlarge the head/face, create a doll-like oversized head, stretch the neck, thicken the hair mass, or leave a mask edge. Match surrounding skin undertone, brightness, subtle redness, makeup density, pores, reflected light, shadow falloff, and face-to-neck/body continuity with the visible neck, chest, arms, and hands.`,
      `Natural integration may adjust expression muscles, gaze, relighting, makeup matching, pores, shadows, edge blending, and skin continuity only. Do not change ${refs.faceRef}'s face outline, feature structure, feature proportions, bone structure, or recognizable likeness.`,
    ];
  }

  if (params.hasReference && params.hasModelFace && !refs.mustUseModelFace) {
    return [
      "Face identity:",
      isHeadlessReference(params.referenceAnalysis)
        ? `${refs.targetRef} has no usable visible face/head for identity. Preserve the crop and ignore ${refs.faceRef}; do not invent a new face, head, hair, portrait, or full-body expansion.`
        : `Preserve ${refs.targetRef}'s visible face/head identity, expression, skin tone, hair, and scene continuity. Ignore ${refs.faceRef} unless the target crop visibly supports a face swap; do not synthesize a new person or beautify into a generic face.`,
    ];
  }

  if (params.hasModelFace) {
    return [
      "Face identity:",
      `${refs.faceRef} is the final face identity source for the generated person. Preserve its recognizable face structure, hairstyle character, and identity impression while adapting lighting, skin texture, head size, and expression naturally to the generated fashion photo.`,
      `Do not copy any body, clothing, background, lighting, or pose from ${refs.faceRef}; do not turn the result into an ID-photo face pasted onto a body.`,
    ];
  }

  if (params.hasReference) {
    return [
      "Face identity:",
      isHeadlessReference(params.referenceAnalysis)
        ? `${refs.targetRef} has no usable visible face/head for identity. Preserve the crop and do not invent a new face, head, hair, portrait, or full-body expansion.`
        : `Preserve ${refs.targetRef}'s visible face/head identity, expression, skin tone, hair, and scene continuity. Do not synthesize a new person or beautify into a generic face.`,
    ];
  }

  return [
    "Face identity:",
    "No face reference was uploaded. Generate one natural, non-generic person with believable facial proportions and no identity copied from clothing images.",
  ];
}

function buildNanoBananaTryOnPriorityLines(
  params: {
    hasReference: boolean;
    hasModelFace: boolean;
  },
  refs: {
    clothingSource: string;
    targetRef: string;
    faceRef: string;
    mustUseModelFace: boolean;
  }
) {
  if (params.hasReference && refs.mustUseModelFace) {
    return [
      `1. ${refs.faceRef} controls final facial identity, facial anatomy, and likeness.`,
      `2. ${refs.clothingSource} controls clothing only.`,
      `3. ${refs.targetRef} controls body proportions, head-to-body ratio, pose, expression performance, crop, scene, lighting, camera, skin-tone continuity, and final photo mood, but not final identity.`,
    ];
  }
  if (params.hasReference) {
    return [
      `1. ${refs.targetRef} controls body, visible identity when present, pose, crop, scene, lighting, camera, and final mood.`,
      `2. ${refs.clothingSource} controls clothing only.`,
      `3. Any uploaded face image is ignored unless the target crop visibly supports a face swap.`,
    ];
  }
  if (params.hasModelFace) {
    return [
      `1. ${refs.faceRef} controls final facial identity.`,
      `2. ${refs.clothingSource} controls clothing only.`,
      "3. Generate body, pose, lighting, and background naturally; do not borrow them from clothing images.",
    ];
  }
  return [
    `1. ${refs.clothingSource} controls clothing only.`,
    "2. Generate one natural person, pose, lighting, and background without copying any person from clothing/detail images.",
  ];
}

function buildNanoBananaClothingRoleRule(clothingRefs: string[], roles: TryOnClothingRole[], mode: TryOnClothingMode) {
  if (mode === "multi") {
    const roleLines = clothingRefs.map((ref, index) => {
      const imageRef = toEnglishImageRef(ref);
      const role = roles[index];
      if (role === "upper") return `${imageRef} supplies the upper-body garment only`;
      if (role === "lower") return `${imageRef} supplies the lower-body garment only`;
      return `${imageRef} supplies only its visible garment or accessory area`;
    });
    const layering: string[] = [];
    if (roles.includes("upper")) layering.push("upper sources keep their natural inner/outer layering and shoulder/neck/hem placement");
    if (roles.includes("lower")) layering.push("lower sources keep their waistband, leg/hem shape, drape, and shoe/ground clearance");
    return `Wear each source on its assigned body area: ${roleLines.join("; ")}. Keep natural layering, waist connection, occlusion, fabric tension, and contact shadows; do not merge multiple sources into a new hybrid garment. ${layering.join("; ")}.`.trim();
  }

  const source = toEnglishImageRef(clothingRefs[0] || "图1");
  return `Single-source garment rule: ${source} defines the uploaded garment or outfit and its natural coverage. If it is a top, replace upper-body clothing only; if it is a bottom, replace lower-body clothing only; if it is a dress, jumpsuit, coat, set, or full outfit, replace every conflicting garment area it naturally covers. Do not split it into unrelated pieces and do not invent extra garments outside ${source}.`;
}

function buildNanoBananaClothingAnalysisRule(
  analysis: TryOnClothingAnalysis | null | undefined,
  roles: TryOnClothingRole[],
  mode: TryOnClothingMode,
  options: { clothingImageNumbers?: number[] } = {}
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
  const categoryText = categoryLabels.length ? categoryLabels.join(" / ") : rawType;
  const visibleTypeText = rawType && rawType !== categoryText ? `${categoryText} (${rawType})` : categoryText;
  const imageRoles = roles
    .map((role, index) => {
      const imageRef = `image ${options.clothingImageNumbers?.[index] || index + 1}`;
      if (role === "upper") return `${imageRef} as the upper-body source`;
      if (role === "lower") return `${imageRef} as the lower-body source`;
      if (role === "extra") return `${imageRef} as the extra garment/accessory source`;
      return `${imageRef} as the single garment/outfit source`;
    })
    .join("; ");
  const explicitScopeNote = explicitScope && analysis.slot && analysis.slot !== explicitScope
    ? ` User-selected ${explicitScope} upload area wins over the visual read that looked ${analysis.slot}; replace only the user-selected ${explicitScope} area.`
    : "";

  const fitText = fit === "fitted"
    ? "Keep a fitted silhouette without over-tightening."
    : fit === "loose"
      ? "Keep a relaxed silhouette with natural extra fabric and folds."
      : "Keep a regular wearable fit with realistic fabric tension.";
  const scopeRule = slot === "lower"
    ? "Use it as a lower-body garment: replace only lower-body clothing and preserve non-conflicting upper-body clothing, hands, face/hair when visible, background, and scene."
    : slot === "upper" || slot === "outer"
      ? "Use it as an upper/outer garment: replace only upper or outer clothing and preserve non-conflicting lower-body clothing, shoes, hands, face/hair when visible, background, and scene."
      : slot === "single" || slot === "intimate" || slot === "functional"
        ? "Use it as one complete garment/outfit and replace only the body areas it naturally covers."
        : "Use the user-selected upload roles as the replacement area when the garment type is ambiguous.";

  return `Visual garment read: the source appears to be ${visibleTypeText}. Use ${imageRoles}. ${fitText}${explicitScopeNote} ${scopeRule}`;
}

function buildVisualAudienceHintRule(
  analysis: TryOnClothingAnalysis | null | undefined,
  garmentAudience?: TryOnGarmentAudience,
  ageGroup?: TryOnAgeGroup
) {
  if (!analysis || analysis.confidence < 0.86) return "";

  const visualAudience = analysis.genderType === "men"
    ? "male"
    : analysis.genderType === "women"
      ? "female"
      : analysis.genderType === "unisex"
        ? "unisex"
        : "";
  const visualAgeLabels: Partial<Record<TryOnAgeGroup | "all", string>> = {
    adult: "adult",
    teen: "teen",
    big_child: "older-child",
    middle_child: "middle-child",
    small_child: "young-child",
    toddler: "toddler",
    all: "all-age",
  };
  const visualAge = analysis.ageRange ? visualAgeLabels[analysis.ageRange] : "";
  const selectedAudience = garmentAudience === "men" ? "male" : "female";
  const selectedAge = visualAgeLabels[ageGroup || "adult"] || "adult";

  if ((!visualAudience || visualAudience === selectedAudience || visualAudience === "unisex")
    && (!visualAge || visualAge === selectedAge || visualAge === "all-age")) {
    return "";
  }

  const visualParts = [visualAudience, visualAge].filter(Boolean).join(" ");
  return `Visual audience hint: the clothing source itself reads as ${visualParts}. Use this only as garment-fit/body-context evidence; keep the current user audience setting (${selectedAge} ${selectedAudience}) when it is an explicit choice. Never copy any person, face, pose, body, background, or lighting from the clothing image.`;
}

function buildConciseTryOnPrompt(params: {
  clothingRefs: string[];
  clothingMode: TryOnClothingMode;
  clothingRoles: TryOnClothingRole[];
  clothingAnalysis?: TryOnClothingAnalysis | null;
  garmentDetailCount?: number;
  garmentAudience?: TryOnGarmentAudience;
  ageGroup?: TryOnAgeGroup;
  garmentCategory?: TryOnGarmentCategory;
  aspectRatio?: AspectRatio;
  hasReference: boolean;
  hasModelFace: boolean;
  referenceAnalysis?: TryOnReferenceAnalysis | null;
  referenceImageNumber: number;
  faceImageNumber: number;
  imageNumberMap?: Map<number, number>;
  style?: string;
}) {
  const clothingSource = params.clothingRefs.length === 1
    ? toEnglishImageRef(params.clothingRefs[0])
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
  const analysisRule = buildTryOnClothingAnalysisRule(params.clothingAnalysis, params.clothingRoles, params.clothingMode, {
    clothingImageNumbers: params.clothingRefs.map((ref) => Number(ref.replace(/\D/g, "")) || 1),
  });
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
  const visualAudienceRule = buildVisualAudienceHintRule(params.clothingAnalysis, params.garmentAudience, params.ageGroup);
  if (visualAudienceRule) lines.push(visualAudienceRule);
  if (params.garmentCategory === "intimate") {
    lines.push("Sensitive apparel rule: treat the source as adult intimate apparel or swimwear for a neutral commercial catalog/lookbook photo; keep the image non-erotic, non-suggestive, and do not show nudity, nipples, genitals, transparent exposure, sexual acts, bedroom/erotic scenes, minors, or minor-looking people.");
  }
  if (params.aspectRatio && params.aspectRatio !== "auto") {
    lines.push(`Output aspect ratio: ${params.aspectRatio}.`);
  }
  lines.push(`Photography: real camera fashion photo with believable lighting, ${TRYON_REAL_HUMAN_SKIN_RULE_EN} Realistic fabric contact shadows and accurate visible body parts within the target crop. ${params.hasReference ? `Preserve ${targetRef}'s original scene, camera distance, and crop boundary; only if ${targetRef} has no clear scene, use a natural commercial fashion setting.` : "Use a natural commercial fashion setting, not an empty gray stock-studio backdrop unless explicitly requested."} No extra people, no watermark, no added text, no plastic skin, no waxy skin, no porcelain retouch, no AI-render look, no stock-model expression, no model-face expression leakage, no model-face skin-tone leakage, no model-face makeup leakage, no pasted head, no face-swap seam, no mismatched skin, no oversized head, no long neck, no ID-photo face, no generic catalog face, no unrelated outfit changes.`);

  const userInstruction = buildStructuredTryOnUserInstruction(params.style, {
    imageNumberMap: params.imageNumberMap,
    referenceImageNumber: params.hasReference ? params.referenceImageNumber : undefined,
  });
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
  hasModelFace: boolean;
  targetRef: string;
  faceRef: string;
  clothingSource: string;
  sourceNoun: string;
  clothingAnalysis?: TryOnClothingAnalysis | null;
  referenceAnalysis?: TryOnReferenceAnalysis | null;
  imageNumberMap?: Map<number, number>;
  style?: string;
}) {
  const targetImageNumber = Number(params.targetRef.replace(/\D/g, "")) || 2;
  const faceMode = decideTryOnFaceMode({
    hasModelFace: params.hasModelFace,
    referenceAnalysis: params.referenceAnalysis ?? null,
  });
  const mustUseModelFace = faceMode === "must_use_model_face";
  const faceSetupLines = mustUseModelFace
    ? [
        `从 ${params.faceRef}（模特脸图）重建最终脸部身份：保留其脸型、五官、骨相、肤色、年龄感、辨识度；同时适配 ${params.targetRef}（参考图）的自然表情、肤色明暗、妆容、头部角度、光照和镜头视角。`,
        `禁止保留 ${params.targetRef} 的原脸身份、脸型、眼鼻嘴和可识别特征。每张生成图都必须使用 ${params.faceRef} 的身份。`,
        `禁止生成与 ${params.faceRef} 无关的新脸；最终图中的脸部只能来源于 ${params.faceRef}，不允许出现合成脸、模板脸或随机脸。`,
      ]
    : [
        `preserve_reference_face mode：${params.targetRef} 当前裁切不承载换脸。保留 ${params.targetRef} 的原脸身份、表情和肤色；不要合成新脸，也不要把 ${params.faceRef} 的身份引入裁切之外的区域。`,
      ];
  const faceRuleLines = mustUseModelFace
    ? [
        "脸部身份规则（must_use_model_face 模式）：",
        "这是身份重建，不是贴脸。模特脸图是最终脸部来源。",
        `用 ${params.faceRef} 的脸型、五官、骨相、眉眼鼻嘴比例作为最终脸部身份。`,
        `${params.targetRef} 的原脸仅作为表情/姿态/光照载体；不要保留其脸型、眉眼鼻嘴、可识别身份。`,
        `不要照搬 ${params.faceRef} 原图的表情强度、肤色、妆容、光照、姿态、身体比例和背景。`,
        `让 ${params.faceRef} 的身份自然适配 ${params.targetRef} 的可见表情：表情类别、强度、情绪方向、视线、面部张力和自然不对称。只在表情肌肉、视线、肤色重新打光、妆容匹配、毛孔、阴影、边缘融合上做适配；不要改变 ${params.faceRef} 的脸型、眉形、眼距、鼻结构、嘴形、五官比例和可识别度。`,
        `最终脸部必须能被识别为 ${params.faceRef} 本人，且与场景自然融合，不能像贴上去或证件照。`,
        "肤色融合：",
        `匹配 ${params.targetRef} 可见区域的肤色、色调、明度、妆容风格、毛孔、细微纹理、自然油光、轻微红润、真实瑕疵、反射光、阴影和场景光照；不要为了融合而磨成瓷肌、塑料皮或无瑕 AI 脸。`,
        `当颈、胸、手臂、手可见时，与 ${params.targetRef} 这些部位自然衔接，无蒙版边缘或独立打光。`,
      ]
    : [
        "脸部身份规则（preserve_reference_face 模式）：",
        `参考图的脸部是身份来源。不要生成新身份；不要用 ${params.faceRef} 在 ${params.targetRef} 裁切外添加脸部或头部。`,
      ];
  const priorityLines = mustUseModelFace
    ? [
        `1. ${params.faceRef} 控制最终脸部身份和五官比例；目标与 ${params.faceRef} 的相似度必须强于保留 ${params.targetRef} 的原脸。`,
        `2. ${params.clothingSource} 仅控制来源服装。`,
        `3. ${params.targetRef} 控制表情方向与强度、身体比例、姿势族、肤色、妆容、光照、场景、镜头、构图、裁切边界、非服装区、最终氛围；它不能控制最终脸部身份。`,
      ]
    : [
        `1. ${params.targetRef} 控制脸部身份、表情、肤色、可见身体范围、裁切边界、姿势族、光照、场景、镜头、非服装区、最终氛围。`,
        `2. ${params.clothingSource} 仅控制来源服装。`,
        `3. ${params.faceRef} 不能扩展裁切或引入新的可见脸部/头部。`,
      ];
  const lines: string[] = [
    mustUseModelFace
      ? `【HARD 硬规则 · 脸部模式 must_use_model_face】模特脸图（${params.faceRef}）是最终脸部身份的唯一来源。本任务禁止出现以下任何一种情况：(a) 最终脸仍像 ${params.targetRef} 原人物；(b) 生成一张与 ${params.faceRef} 无关的新脸、模板脸或合成脸；(c) 跳过换脸或弱化换脸。最终脸必须是 ${params.faceRef} 本人，自然适配 ${params.targetRef} 的表情与场景。`
      : `【HARD 硬规则 · 脸部模式 preserve_reference_face】参考图（${params.targetRef}）的脸部是最终身份来源。本任务禁止生成新脸，也禁止把 ${params.faceRef} 的身份引入裁切之外的区域。`,
    mustUseModelFace
      ? `Use ${params.targetRef} as the body/composition/lighting base try-on photo, but replace its facial identity with ${params.faceRef}. Perform a realistic fashion edit, not a full photo regeneration.`
      : `Use ${params.targetRef} as the base try-on photo (face identity preserved, no swap). Perform a realistic fashion edit, not a full photo regeneration.`,
    "Image roles:",
    ...buildFixedBaseRoleBullets(params, mustUseModelFace),
    "Task:",
    `Edit ${params.targetRef} into a believable try-on photo.`,
    buildFixedBaseReplacementTask(params),
    ...buildFixedBaseFaceIdentityLockLines(params, mustUseModelFace),
    ...buildReferenceNoHeadFaceLockLines({
      referenceAnalysis: params.referenceAnalysis,
      targetRef: params.targetRef,
      faceRef: params.faceRef,
    }),
    ...buildFixedBaseExpressionLockLines(params, mustUseModelFace),
    buildTryOnReferenceAnalysisRule(params.referenceAnalysis, targetImageNumber),
    ...faceSetupLines,
    `Keep natural adult proportions for the body parts visible in ${params.targetRef}; preserve its detected body scale, crop boundary, and camera distance. If head or full body is not visible, do not invent it. Avoid oversized head, tiny body, long neck, short legs, distorted shoulders, or changed body type.`,
    `Keep the overall camera distance, framing style, background, floor, and non-sourced outfit areas close to ${params.targetRef}, while allowing natural variation in garment fit, folds, hem shape, contact shadows, fabric drape, and small body/hand relaxation.`,
    "Clothing rule:",
    `${params.clothingSource} ${params.clothingRefs.length === 1 ? "is" : "are"} not a person reference. Do not copy any model, body, face, pose, skin, lighting, background, or scene from ${params.clothingSource}. Extract only the sourced garment material.`,
    buildTryOnClothingAnalysisRule(params.clothingAnalysis, params.clothingRoles, params.clothingMode, {
      clothingImageNumbers: params.clothingRefs.map((ref) => Number(ref.replace(/\D/g, "")) || 1),
    }),
    "Preserve source clothing accurately: garment type, silhouette, color, pattern, logo/text, fabric texture, neckline, sleeves, hem, pockets, buttons, zippers, seams, layers, length, and visible construction details.",
    ...buildFixedBaseLayeringRules(params),
    buildFixedBaseAreaRule(params),
    ...faceRuleLines,
    "Priority:",
    ...priorityLines,
    "Important:",
    mustUseModelFace
      ? `Do not keep ${params.targetRef}'s original facial identity. The identity change to ${params.faceRef} is mandatory in every output.`
      : `Do not add a visible face/head outside ${params.targetRef}'s original crop. Do not treat the absence of a visible face as an error; preserve the partial-body target crop.`,
    `Do not create a new model, unrelated scene, generic catalog face, or mismatched head/body composite.`,
    `Quality: realistic edited photo, natural fabric drape, realistic contact shadows. ${TRYON_REAL_HUMAN_SKIN_RULE} Accurate visible hands and feet when present in the crop. ${buildConciseAudienceRule(params.garmentAudience, params.ageGroup)} ${buildVisualAudienceHintRule(params.clothingAnalysis, params.garmentAudience, params.ageGroup)} No extra people, no watermark, no added text, no AI-render look, no stock-model expression, no pasted head, no face-swap seam, no oversized head, no long neck, no ID-photo face, no unrelated outfit changes.`,
  ];

  if (params.garmentCategory === "intimate") {
    lines.push("Sensitive apparel rule: treat the source as adult intimate apparel or swimwear for a neutral commercial catalog/lookbook photo; keep the image non-erotic, non-suggestive, and do not show nudity, nipples, genitals, transparent exposure, sexual acts, bedroom/erotic scenes, minors, or minor-looking people.");
  }
  if (params.aspectRatio && params.aspectRatio !== "auto") {
    lines.push(`Output aspect ratio: ${params.aspectRatio}.`);
  }
  const userInstruction = buildStructuredTryOnUserInstruction(params.style, {
    imageNumberMap: params.imageNumberMap,
    referenceImageNumber: targetImageNumber,
  });
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
}, mustUseModelFace: boolean) {
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

  const faceRole = mustUseModelFace
    ? `- ${params.faceRef} = mandatory final face identity reference only: facial structure, feature anatomy, face outline, eye/brow/nose/mouth geometry, and recognizable likeness; do not copy its original expression style, expression intensity, skin tone, makeup, head pose, head scale, lighting, body, clothing, background, or scene.`
    : `- ${params.faceRef} = inactive for this try-on (no face swap); do not use it to add a head/face outside ${params.targetRef}'s original crop.`;
  const targetRole = mustUseModelFace
    ? `- ${params.targetRef} = target expression and try-on reference: visible expression category, intensity, emotional direction, gaze behavior, facial tension, natural asymmetry, visible skin tone, makeup style, head pose, head size, visible body range, crop boundary, pose family, background, lighting, camera style, framing style, non-sourced outfit areas, and final photo mood. Its original facial identity, face outline, eyes, nose, and mouth anatomy must not be preserved as the final person.`
    : `- ${params.targetRef} = target try-on reference including original face identity: visible body range, crop boundary, pose family, visible expression/skin/makeup when present, background, lighting, camera style, framing style, non-sourced outfit areas, and final photo mood. Original face identity is preserved.`;

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

  const source = toEnglishImageRef(clothingRefs[0] || "图1");
  return `Single-garment rule: ${source} was uploaded into the explicit one-piece/full-outfit slot. Treat it as one complete dress, jumpsuit, set, coat, or full-body garment; replace every conflicting target garment it covers, do not split it into unrelated upper/lower pieces, and do not invent extra clothing outside ${source}.`;
}

function buildTryOnClothingAnalysisRule(
  analysis: TryOnClothingAnalysis | null | undefined,
  roles: TryOnClothingRole[],
  mode: TryOnClothingMode,
  options: { clothingImageNumbers?: number[] } = {}
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
  const categoryText = categoryLabels.length ? categoryLabels.join(" / ") : rawType;
  const explicitRoles = roles
    .map((role, index) => `image ${options.clothingImageNumbers?.[index] || index + 1}=${role}`)
    .join(", ");
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

  return `Visual clothing classification: detected ${categoryText}; raw type=${rawType}; slot=${slot || "unknown"}; fit=${fit}; upload mode=${mode}; explicit slots=${explicitRoles}.${explicitScopeNote} ${scopeRule}`;
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

function buildGarmentDetailPromptGroups(params: {
  groups: GarmentDetailReferenceGroup[];
  detailStartImageNumber: number;
  clothingRoles?: TryOnClothingRole[];
  clothingImageOffset?: number;
}): GarmentDetailPromptGroup[] {
  let offset = 0;
  return params.groups.map((group) => {
    const detailImageNumbers = group.urls.map((_, index) => params.detailStartImageNumber + offset + index);
    offset += group.urls.length;
    const role = params.clothingRoles?.[group.clothingIndex];
    return {
      ...group,
      clothingImageNumber: group.clothingIndex + 1 + (params.clothingImageOffset || 0),
      clothingLabel: role ? TRYON_CLOTHING_ROLE_LABELS[role] : undefined,
      detailImageNumbers,
    };
  });
}

export const __lingyaTaskResponseTestUtils = {
  buildImageEditRequest,
  buildImageGenerationRequest,
  buildGeminiNativeImageRequest,
  buildGenerateRequestBody,
  calculateImageRequestHeartbeatProgress,
  extractGeneratedImages,
  getImageEditUrl,
  getImageGenerationUrl,
  getGeminiGenerateContentUrl,
  isDefinitelyUnacceptedProviderResponse,
  normalizeImageTaskResponse,
  resolveGptImage2Size,
  resolveProviderImageModel,
  shouldUseGeminiNativeEndpoint,
  shouldUseImageEditEndpoint,
  shouldRequestAsyncImageTask,
};
