import { randomUUID } from "node:crypto";

import { isRecord } from "@/lib/utils";
import { logger } from "@/lib/logger";
import {
  batchTryOn,
  type AspectRatio,
  type ImageTaskProgress,
  type ImageSize,
  type LingyaModel,
} from "@/lib/api/lingya";
import { generateImageWithControlPlane as generateImage } from "@/lib/api/lingya-routing.server";
import { completeGenerationWithCreditAdjustment, failGenerationWithRefund } from "@/lib/api/credits";
import { resolveImageInputs, resolveMediaInput } from "@/lib/api/image-inputs.server";
import { persistGeneratedImageUrls } from "@/lib/api/result-image-storage";
import { persistGeneratedMediaUrls } from "@/lib/api/result-media-storage";
import {
  generateVideoFirstLastFrame,
  generateVideoImageToVideo,
  generateVideoMotionControl,
} from "@/lib/api/video-provider";
import type { VideoGenerationResult, VideoTaskProgress } from "@/lib/api/video-types";
import type { VideoProviderName } from "@/lib/api/video-catalog";
import type { OutfitFusionHistoryAsset } from "@/lib/history-apply";
import { getOutfitFusionDisplayPrompt, resolveOutfitFusionSmartAspectImage } from "@/lib/outfit-fusion";
import { syncGenerationTaskQueueById } from "@/lib/task-queue-store";
import { dispatchGenerationJob } from "@/lib/api/generation-job-dispatch";
import { getAiRouteContext, runWithAiRouteContext } from "@/lib/ai-control-plane/context.server";
import { getAiTenantConcurrencyPolicy } from "@/lib/ai-control-plane/fairness.server";
import { getWorkerShutdownSignal } from "@/lib/queue/worker-shutdown.server";
import {
  isAiCapacityUnavailableError,
  isAiTenantCapacityUnavailableError,
} from "@/lib/ai-control-plane/router.server";
import { getAiControlPlaneConfig } from "@/lib/ai-control-plane/server";
import {
  isGenerationSubmissionOutcomeUnknownError,
  isRetryableGenerationError,
  isStaleExecutionFenceError,
  RetryableGenerationError,
  sanitizeGenerationErrorMessage,
  StaleExecutionFenceError,
} from "@/lib/api/generation-errors";
import {
  checkpointGenerationExecution,
  markGenerationNeedsReview,
} from "@/lib/api/generation-execution";
import {
  attachGenerationMediaAssetReferences,
  collectGenerationInputMediaAssetIds,
  parseCanonicalMediaAssetId,
} from "@/lib/api/media-asset-references.server";
// Visual quality evaluation remains intentionally inert in the generation
// worker; automatic repair is controlled independently by runtime config.
type VisualQualityEvaluation = {
  ok: boolean;
  score: number;
  shouldRegenerate: boolean;
  summary: string;
  issues: string[];
  repairPrompt?: string;
  source: "vision_llm" | "deterministic";
  trace?: { id: string };
};
const applyQualityRepairToPrompt = (
  prompt: string,
  quality: VisualQualityEvaluation,
): string => {
  void quality;
  return prompt;
};
const evaluateGeneratedImages = async (args: {
  userPrompt: string;
  module: string;
  resultUrls: string[];
  expectedCount: number;
  referenceImageUrls?: string[];
}): Promise<VisualQualityEvaluation> => {
  void args;
  return {
    ok: true,
    score: 1,
    shouldRegenerate: false,
    summary: "智能视觉评估已下线，已跳过自动重生。",
    issues: [],
    source: "deterministic",
  };
};
import {
  buildCommerceDetailSectionPrompt,
  buildCommerceDetailSections,
  normalizeCommerceDetailLayout,
  resolveCommerceDetailAspectRatio,
  type CommerceDetailLayout,
  type CommerceDetailSectionSpec,
} from "@/lib/commerce-detail-sections";
import { enforceModelPromptRequirements } from "@/lib/model-prompt";
import {
  buildPoseRoleBasedPrompt,
  flattenGarmentDetailGroups,
  normalizeGarmentDetailGroups,
  normalizeGarmentDetailUrls,
  type GarmentDetailReferenceGroup,
} from "@/lib/garment-detail-references";
import {
  buildPoseGarmentAngleReferencePrompt,
  flattenGarmentAngleReferences,
  normalizeGarmentAngleReferences,
  type GarmentAngleReference,
} from "@/lib/garment-angle-references";
import { buildPoseReferenceImagePrompt, normalizePoseReferenceCopies, normalizePoseReferenceUrls } from "@/lib/pose-reference";
import { buildPoseReferenceModeSeparatePrompt, buildSeparatePosePrompt, enforcePosePromptRequirements, type PoseOutputMode } from "@/lib/pose-prompt";
import {
  applyGarment3dDisplayStylePrompt,
  applyModelShootStylePrompt,
  applyPoseSeriesStylePrompt,
  normalizeGarment3dDisplayStyle,
  normalizeModelShootStyle,
  normalizePoseSeriesStyle,
  type Garment3dDisplayStyle,
  type ModelShootStyle,
  type PoseSeriesStyle,
} from "@/lib/module-style-presets";
import type { AutoDesignSettings, TryOnSceneMode } from "@/lib/tryon-scene";
import type { TryOnClothingAnalysis } from "@/lib/tryon-reference-config";
import { alignTryOnReferenceAnalyses, type TryOnReferenceAnalysis } from "@/lib/tryon-reference-analysis";
import { normalizePoseVisualAnalysis, type PoseVisualAnalysis } from "@/lib/pose-analysis";
import { normalizePosePlan, normalizePosePlanCount, type PoseAngleCounts, type PosePlan } from "@/lib/pose-plan";
import type { TryOnAgeGroup, TryOnGarmentCategory, TryOnGarmentAudience } from "@/lib/tryon-prompt";
import type { TryOnClothingMode, TryOnClothingRole } from "@/lib/tryon-upload-rules";
import type { GrassPayloadBase } from "@/lib/grass-planting";
import { normalizeModelBackgroundSourceUrls, type ModelBackgroundPayloadBase } from "@/lib/model-background";
import {
  buildImageTranslationPerCallPrompt,
  enforceImageTranslationPromptRequirements,
  normalizeImageTranslationSourceUrls,
  type ImageTranslationPayloadBase,
} from "@/lib/image-translation";
import type { MaterialEnhancementPayloadBase } from "@/lib/material-enhancement";
import type {
  ProductRetouchHardValidationPolicy,
  ProductRetouchHardValidationResult,
  ProductRetouchMode,
} from "@/lib/product-retouch";
import { validateGeneratedProductImage } from "@/lib/api/product-retouch-validation";
import { enforceFaceSwapPromptRequirements, normalizeFaceSwapMode, normalizeFaceSwapSourceUrls, type FaceSwapMode } from "@/lib/face-swap";
import {
  buildProductSetPrompt,
  createProductSetModuleResult,
  getProductSetModuleKey,
  getProductSetReferenceUrls,
  getProductSetResultUrlsFromModules,
  PRODUCT_SET_PROMPT_VERSION,
  normalizeProductSetCreationMode,
  normalizeProductSetImageType,
  normalizeProductSetModuleOverrides,
  normalizeProductSetModuleResults,
  normalizeProductSetProductProfile,
  normalizeProductSetSettings,
  resolveProductSetTemplates,
  type ProductSetCreationMode,
  type ProductSetCustomTemplate,
  type ProductSetImageType,
  type ProductSetModuleOverride,
  type ProductSetModuleResult,
  type ProductSetProductProfile,
  type ProductSetSettings,
} from "@/lib/product-set";
import {
  normalizeAiVideoAudioMode,
  normalizeAiVideoAspectRatio,
  normalizeAiVideoDuration,
  normalizeAiVideoGenCount,
  normalizeAiVideoGenerateAudio,
  normalizeAiVideoModelMode,
  normalizeAiVideoResolution,
  type AiVideoAudioMode,
  type AiVideoAspectRatio,
  type AiVideoDuration,
  type AiVideoModelMode,
  type AiVideoResolution,
} from "@/lib/ai-video";

type GenerationJobPayloadBase = {
  publicBaseUrl?: string | null;
  asyncTask?: {
    taskId?: string;
    requestId?: string;
    status?: string;
    progress?: unknown;
    providerDetails?: Record<string, unknown>;
    slots?: Array<{
      slot: number;
      taskId: string;
      requestId?: string;
      deploymentId?: string;
      status?: string;
      progress?: number;
      updatedAt: string;
    }>;
    updatedAt?: string;
  };
  generationBatchProgress?: {
    version: 1;
    expectedCount: number;
    resultUrls: string[];
    updatedAt: string;
  };
  batchId?: string;
  batchIndex?: number;
};

export type GenerationJobPayload = GenerationJobPayloadBase & (
  | {
      kind: "tryon";
      clothingUrls: string[];
      clothingMode?: TryOnClothingMode;
      clothingRoles?: TryOnClothingRole[];
      clothingAnalysis?: TryOnClothingAnalysis | null;
      garmentDetailUrls?: string[];
      garmentDetailGroups?: GarmentDetailReferenceGroup[];
      garmentAudience?: TryOnGarmentAudience;
      ageGroup?: TryOnAgeGroup;
      garmentCategory?: TryOnGarmentCategory;
      modelFaceUrl?: string | null;
      referenceUrl?: string | null;
      referenceUrls?: string[];
      referenceAnalyses?: TryOnReferenceAnalysis[];
      aiModel: LingyaModel;
      aspectRatio: AspectRatio;
      imageSize: ImageSize;
      style?: string;
      genCount: number;
      rawPrompt?: string;
      sceneMode?: TryOnSceneMode;
      autoDesign?: AutoDesignSettings;
    }
  | {
      kind: "model";
      referenceUrls: string[];
      hairReferenceUrl?: string | null;
      hairColorReferenceUrl?: string | null;
      gender?: "female" | "male";
      modelStyle?: ModelShootStyle;
      hairStyle?: string | null;
      hairColor?: string | null;
      aiModel: LingyaModel;
      aspectRatio: AspectRatio;
      imageSize: ImageSize;
      prompt: string;
      genCount: number;
    }
  | ({ kind: "grass" } & GrassPayloadBase)
  | ({ kind: "modelBackground" } & ModelBackgroundPayloadBase)
  | ({ kind: "materialEnhancement" } & MaterialEnhancementPayloadBase)
  | ({ kind: "imageTranslation" } & ImageTranslationPayloadBase)
  | {
      kind: "productRetouch";
      internalTask: true;
      batchId: string;
      outputId: string;
      sourceClientId: string;
      sourceIndex: number;
      variantIndex: number;
      sourceUrl: string;
      sourceFilename: string;
      mode: ProductRetouchMode;
      category: string;
      userInstruction?: string;
      skillVersion: string;
      skillContentHash: string;
      hardValidationPolicy: ProductRetouchHardValidationPolicy;
      aiModel: LingyaModel;
      aspectRatio: AspectRatio;
      imageSize: ImageSize;
      prompt: string;
      genCount: 1;
    }
  | {
      kind: "generalImage";
      mode: "text-to-image" | "image-to-image";
      referenceUrls: string[];
      onePerReference?: boolean;
      aiModel: LingyaModel;
      aspectRatio: AspectRatio;
      imageSize: ImageSize;
      userPrompt?: string;
      prompt: string;
      genCount: number;
      aiTool?: {
        requestId: string;
        operation: string;
        nativeMaskUrl?: string;
      };
    }
  | {
      kind: "outfitFusion";
      mode: "text-to-image" | "image-to-image";
      referenceUrls: string[];
      clothingUrls?: string[];
      modelFaceUrl?: string | null;
      referenceUrl?: string | null;
      assets?: OutfitFusionHistoryAsset[];
      aiModel: LingyaModel;
      aspectRatio: AspectRatio;
      imageSize: ImageSize;
      userPrompt?: string;
      prompt: string;
      genCount: number;
    }
  | {
      kind: "pose";
      mainImageUrl: string;
      aiModel: LingyaModel;
      aspectRatio?: AspectRatio;
      imageSize: ImageSize;
      prompt: string;
      poseStyle?: PoseSeriesStyle;
      poseCreationMode?: "free" | "reference";
      poseReferenceCopies?: number;
      posePlanMode?: "preset" | "ai";
      outputMode?: PoseOutputMode;
      poseCount?: number;
      angleCounts?: PoseAngleCounts;
      genCount?: number;
      poseStartIndex?: number;
      poseAnalysis?: PoseVisualAnalysis | null;
      posePlan?: PosePlan | null;
      poseReferenceUrls?: string[];
      garmentDetailUrls?: string[];
      garmentAngleReferences?: GarmentAngleReference[];
    }
  | {
      kind: "garment3d";
      garmentUrl: string;
      referenceUrl?: string | null;
      garmentType?: string;
      outputMode?: "reference" | "prompt";
      displayStyle?: Garment3dDisplayStyle;
      userPrompt?: string;
      aiModel: LingyaModel;
      aspectRatio: AspectRatio;
      imageSize: ImageSize;
      prompt: string;
      genCount: number;
    }
  | {
      kind: "faceSwap";
      sourceUrl: string;
      sourceUrls?: string[];
      faceUrl: string;
      aiModel: LingyaModel;
      aspectRatio: AspectRatio;
      imageSize: ImageSize;
      userPrompt?: string;
      prompt: string;
      genCount: number;
      textureEnhance?: boolean;
      faceSwapMode?: FaceSwapMode;
    }
  | {
      kind: "commerceDetail";
      sourceUrls: string[];
      aiModel: LingyaModel;
      aspectRatio: AspectRatio;
      imageSize: ImageSize;
      prompt: string;
      genCount: number;
      platform?: string;
      layout?: CommerceDetailLayout;
      mobileWidth?: number;
      sections?: CommerceDetailSectionSpec[];
    }
  | {
      kind: "productSet";
      productImageUrls: string[];
      productInfo?: string;
      productProfile?: ProductSetProductProfile;
      mode: ProductSetCreationMode;
      imageType: ProductSetImageType;
      settings?: ProductSetSettings;
      selectedTemplateIds?: number[];
      customTemplates?: ProductSetCustomTemplate[];
      moduleOverrides?: ProductSetModuleOverride[];
      moduleResults?: ProductSetModuleResult[];
      regenerateIndex?: number;
      aiModel: LingyaModel;
      aspectRatio: AspectRatio;
      imageSize: ImageSize;
      prompt: string;
      genCount: number;
    }
  | {
      kind: "videoImageToVideo";
      provider: VideoProviderName;
      imageUrl: string;
      prompt: string;
      templateId?: number;
      templateTitle?: string;
      modelMode?: AiVideoModelMode;
      duration?: AiVideoDuration;
      resolution: AiVideoResolution;
      aspectRatio?: AiVideoAspectRatio;
      audioMode?: AiVideoAudioMode;
      audioUrl?: string;
      audioPrompt?: string;
      generateAudio?: boolean;
      aiModel: string;
      genCount: number;
    }
  | {
      kind: "videoMotion";
      provider: VideoProviderName;
      modelImageUrl: string;
      referenceVideoUrl: string;
      prompt?: string;
      templateId?: number;
      templateTitle?: string;
      modelMode?: AiVideoModelMode;
      duration?: AiVideoDuration;
      resolution: AiVideoResolution;
      aspectRatio?: AiVideoAspectRatio;
      audioMode?: AiVideoAudioMode;
      audioUrl?: string;
      audioPrompt?: string;
      generateAudio?: boolean;
      aiModel: string;
      genCount: number;
    }
  | {
      kind: "videoFirstLastFrame";
      provider: VideoProviderName;
      firstFrameUrl: string;
      lastFrameUrl: string;
      prompt: string;
      modelMode?: AiVideoModelMode;
      duration?: AiVideoDuration;
      resolution: AiVideoResolution;
      aspectRatio?: AiVideoAspectRatio;
      audioMode?: AiVideoAudioMode;
      audioUrl?: string;
      audioPrompt?: string;
      generateAudio?: boolean;
      aiModel: string;
      genCount: number;
    }
);

interface ClaimedJob {
  id: string;
  user_id: string;
  job_payload: unknown;
  credits_cost: number;
  job_attempts: number;
  delivery_version: number;
  execution_token: string;
  service_tier?: "standard" | "vip";
  result_urls?: string[] | null;
}

const DEFAULT_IMAGE_BATCH_CONCURRENCY = 8;
const IMAGE_BATCH_MAX_CONCURRENCY = 8;
const GENERATION_MAX_EXECUTION_ATTEMPTS = 2;

type PromptTraceItem = {
  index: number;
  kind: GenerationJobPayload["kind"];
  model: string;
  promptKind: string;
  prompt: string;
  compiledPrompt: string;
  createdAt: string;
};

type GenerationExecutionResult = {
  resultUrls: string[];
  promptTrace: PromptTraceItem[];
  moduleResults?: ProductSetModuleResult[];
  progress?: number;
  externalTaskId?: string;
  externalRequestId?: string;
  externalStatus?: string;
  externalSlotIndex?: number;
  providerDetails?: Record<string, unknown>;
  failedCount?: number;
  partialError?: string;
  hardValidation?: ProductRetouchHardValidationResult;
};

type GenerationProgressUpdate = GenerationExecutionResult;
type GenerationProgressCallback = (update: GenerationProgressUpdate) => Promise<void>;

export function startGenerationJob(generationId: string) {
  return dispatchGenerationJob({
    generationId,
    execute: (id) => runGenerationJobById(id, 1),
    onError: (err) => logger.error(`[jobs] local job ${generationId} failed:`, err),
  });
}

export async function runGenerationJobById(generationId: string, deliveryVersion: number) {
  const supabase = createAdminClient();
  if (!Number.isInteger(deliveryVersion) || deliveryVersion < 1) {
    throw new Error("任务投递版本无效");
  }
  const executionToken = randomUUID();
  const { data, error } = await supabase.rpc("claim_generation_job", {
    p_generation_id: generationId,
    p_delivery_version: deliveryVersion,
    p_execution_token: executionToken,
    p_lease_seconds: 45,
  });

  if (error) {
    throw new Error(`任务认领失败: ${error.message}`);
  }

  const claimed = getFirstRow(data);
  const job = claimed
    ? { ...claimed, delivery_version: deliveryVersion, execution_token: executionToken }
    : null;
  if (!job) return { processed: 0, skipped: 1 };

  let result: Awaited<ReturnType<typeof runClaimedJob>>;
  try {
    result = await runWithExecutionHeartbeat(supabase, job, (executionSignal) =>
      runWithAiRouteContext(
        {
          generationId: job.id,
          userId: job.user_id,
          serviceTier: job.service_tier === "vip" ? "vip" : "standard",
          executionSignal,
        },
        () => runClaimedJob(supabase, job),
      ),
    );
  } catch (error) {
    // Recovery may have advanced the delivery fence while the old provider
    // call was still in flight. The newer delivery owns the job now; do not
    // turn this expected race into another BullMQ retry.
    if (isStaleExecutionFenceError(error)) {
      return { processed: 0, skipped: 1 };
    }
    throw error;
  }
  return {
    processed: result.deferred || result.stale ? 0 : 1,
    deferred: result.deferred ? 1 : 0,
    skipped: result.stale ? 1 : 0,
    failed: result.businessFailed ? 1 : 0,
  };
}

async function runWithExecutionHeartbeat<T>(
  supabase: ReturnType<typeof createAdminClient>,
  job: ClaimedJob,
  execute: (executionSignal: AbortSignal) => Promise<T>,
) {
  let heartbeatInFlight = false;
  let heartbeatError: Error | null = null;
  let consecutiveTransientFailures = 0;
  let leaseDeadline = Date.now() + 45_000;
  const executionAbort = new AbortController();
  const shutdownSignal = getWorkerShutdownSignal();
  const abortForShutdown = () => executionAbort.abort(shutdownSignal.reason);
  if (shutdownSignal.aborted) abortForShutdown();
  else shutdownSignal.addEventListener("abort", abortForShutdown, { once: true });
  const loseExecutionLease = (error: Error) => {
    if (heartbeatError) return;
    heartbeatError = error;
    executionAbort.abort(error);
  };
  const timer = setInterval(() => {
    if (heartbeatInFlight || heartbeatError) return;
    heartbeatInFlight = true;
    const heartbeatRpc = Promise.resolve(supabase.rpc("heartbeat_generation_job", {
      p_generation_id: job.id,
      p_delivery_version: job.delivery_version,
      p_execution_token: job.execution_token,
      p_lease_seconds: 45,
    }));
    void withHeartbeatTimeout(heartbeatRpc, 10_000).then(({ data, error }) => {
      if (error || data !== true) {
        if (isStaleExecutionFenceError(error) || (!error && data !== true)) {
          loseExecutionLease(new StaleExecutionFenceError("任务执行租约已丢失", { cause: error || undefined }));
          return;
        }
        consecutiveTransientFailures += 1;
        if (consecutiveTransientFailures >= 2 || Date.now() + 15_000 >= leaseDeadline) {
          loseExecutionLease(new Error(`任务执行心跳失败: ${error?.message || "heartbeat rejected"}`));
        }
        return;
      }
      consecutiveTransientFailures = 0;
      leaseDeadline = Date.now() + 45_000;
    }).catch((error: unknown) => {
      if (isStaleExecutionFenceError(error)) {
        loseExecutionLease(new StaleExecutionFenceError("任务执行租约已丢失", { cause: error }));
        return;
      }
      consecutiveTransientFailures += 1;
      if (consecutiveTransientFailures >= 2 || Date.now() + 15_000 >= leaseDeadline) {
        loseExecutionLease(new Error(`任务执行心跳失败: ${error instanceof Error ? error.message : String(error)}`));
      }
    }).finally(() => {
      heartbeatInFlight = false;
    });
  }, 15_000);
  timer.unref?.();

  try {
    const result = await execute(executionAbort.signal);
    if (heartbeatError) throw heartbeatError;
    return result;
  } finally {
    clearInterval(timer);
    shutdownSignal.removeEventListener("abort", abortForShutdown);
  }
}

function withHeartbeatTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("任务执行心跳超时")), timeoutMs);
    Promise.resolve(promise).then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}

async function runClaimedJob(
  supabase: ReturnType<typeof createAdminClient>,
  job: ClaimedJob
): Promise<{ businessFailed: boolean; deferred: boolean; stale?: boolean }> {
  let parsedPayload: GenerationJobPayload | null = null;
  let partialResultUrls: string[] = [];
  let partialModuleResults: ProductSetModuleResult[] = [];
  try {
    await syncGenerationQueueIndex(job.id, "claim");
    const checkpoint = await loadClaimedGenerationCheckpoint(supabase, job);
    job = {
      ...job,
      job_payload: checkpoint.jobPayload,
      result_urls: checkpoint.resultUrls,
    };
    const payload = recoverCompletedBatchCheckpoint(
      parseJobPayload(job.job_payload),
      checkpoint.resultUrls,
    );
    parsedPayload = payload;
    await attachGenerationMediaAssetReferences({
      client: supabase,
      generationId: job.id,
      ownerUserId: job.user_id,
      assetIds: collectGenerationInputMediaAssetIds(payload),
      role: "generation_input",
    });
    partialResultUrls = readResumableBatchResultUrls(payload, getExpectedResultCount(payload));
    const partialPromptTrace: PromptTraceItem[] = [];
    const rawModuleUrlByKey = new Map<string, string>();
    const persistedModuleUrlByKey = new Map<string, string>();
    const persistedResultUrlByRawUrl = new Map<string, string>();
    let lastProgress = 0;
    let lastExternalTaskId: string | undefined;
    let lastExternalStatus: string | undefined;
    const persistOrderedResultUrls = async (rawUrls: string[]) => {
      const persistedUrls = Array.from({ length: rawUrls.length }, () => "");
      for (const [index, rawUrl] of rawUrls.entries()) {
        if (!rawUrl) continue;
        const cached = persistedResultUrlByRawUrl.get(rawUrl);
        if (cached) {
          persistedUrls[index] = cached;
          continue;
        }

        const [persisted] = await persistGeneratedMediaUrls([rawUrl], job.id, {
          forceServerDownload: isSeedreamPayload(payload),
          startIndex: index,
          mediaType: isVideoPayload(payload) ? "video" : "image",
        });
        const finalUrl = persisted || rawUrl;
        persistedResultUrlByRawUrl.set(rawUrl, finalUrl);
        persistedUrls[index] = finalUrl;
      }
      return persistedUrls;
    };
    const persistModuleResults = async (moduleResults: ProductSetModuleResult[]) => {
      const normalized = normalizeProductSetModuleResults(moduleResults);
      const persistedModules: ProductSetModuleResult[] = [];

      for (const moduleResult of normalized) {
        let resultUrl = moduleResult.resultUrl;
        if (resultUrl) {
          const previousRawUrl = rawModuleUrlByKey.get(moduleResult.moduleKey);
          if (previousRawUrl !== resultUrl) {
            const [persisted] = await persistGeneratedImageUrls([resultUrl], `${job.id}-${moduleResult.moduleKey}`, {
              forceServerDownload: isSeedreamPayload(payload),
              startIndex: moduleResult.index - 1,
            });
            rawModuleUrlByKey.set(moduleResult.moduleKey, resultUrl);
            persistedModuleUrlByKey.set(moduleResult.moduleKey, persisted || resultUrl);
            resultUrl = persisted || resultUrl;
          } else {
            resultUrl = persistedModuleUrlByKey.get(moduleResult.moduleKey) || resultUrl;
          }
        }
        persistedModules.push({ ...moduleResult, resultUrl });
      }

      partialModuleResults = persistedModules;
      partialResultUrls.splice(0, partialResultUrls.length, ...getProductSetResultUrlsFromModules(persistedModules));
      return persistedModules;
    };

    const existingUpstream = readExistingAsyncTask(payload);
    await checkpointGenerationExecution(supabase, generationFence(job), {
      phase: existingUpstream.taskId ? "polling" : "submitting",
      upstreamTaskId: existingUpstream.taskId,
      upstreamRequestId: existingUpstream.requestId,
      upstreamDeploymentId: stringField(existingUpstream.providerDetails, "deploymentId"),
      upstreamStatus: existingUpstream.status || (existingUpstream.taskId ? "resuming" : "submitting"),
    });

    const execution = await executePayload(payload, async (update) => {
      if (update.moduleResults?.length) {
        await checkpointFromProgress(supabase, job, update);
        if (update.resultUrls.some(Boolean) || update.moduleResults.some((item) => Boolean(item.resultUrl))) {
          await checkpointGenerationExecution(supabase, generationFence(job), {
            phase: "persisting",
            resultPayload: { resultCount: update.resultUrls.filter(Boolean).length },
          });
        }
        const persistedModules = await persistModuleResults(update.moduleResults);
        const nextProgress = typeof update.progress === "number" ? update.progress : lastProgress;
        partialPromptTrace.splice(0, partialPromptTrace.length, ...update.promptTrace);
        lastProgress = Math.max(lastProgress, nextProgress);
        await writeGenerationProgress(supabase, job, payload, {
          resultUrls: [...partialResultUrls],
          promptTrace: partialPromptTrace,
          moduleResults: persistedModules,
          progress: lastProgress,
          externalTaskId: update.externalTaskId,
          externalRequestId: update.externalRequestId,
          externalStatus: update.externalStatus,
          externalSlotIndex: update.externalSlotIndex,
          providerDetails: update.providerDetails,
        });
        return;
      }

      const nextRawUrls = update.resultUrls;
      const hasNextRawUrls = nextRawUrls.some(Boolean);
      const nextProgress = typeof update.progress === "number" ? update.progress : lastProgress;
      const hasExternalChange = Boolean(
        (update.externalTaskId && update.externalTaskId !== lastExternalTaskId) ||
        (update.externalStatus && update.externalStatus !== lastExternalStatus)
      );
      if (!hasNextRawUrls && update.promptTrace.length === partialPromptTrace.length && nextProgress === lastProgress && !hasExternalChange) return;

      await checkpointFromProgress(supabase, job, update);
      if (hasNextRawUrls) {
        await checkpointGenerationExecution(supabase, generationFence(job), {
          phase: "persisting",
          resultPayload: { resultCount: nextRawUrls.filter(Boolean).length },
        });
      }
      const persistedNextUrls = hasNextRawUrls ? await persistOrderedResultUrls(nextRawUrls) : nextRawUrls;
      partialResultUrls.splice(0, partialResultUrls.length, ...persistedNextUrls);
      partialPromptTrace.splice(0, partialPromptTrace.length, ...update.promptTrace);
      lastProgress = Math.max(lastProgress, nextProgress);
      lastExternalTaskId = update.externalTaskId || lastExternalTaskId;
      lastExternalStatus = update.externalStatus || lastExternalStatus;

      await writeGenerationProgress(supabase, job, payload, {
        resultUrls: [...partialResultUrls],
        promptTrace: partialPromptTrace,
        moduleResults: partialModuleResults,
        progress: lastProgress,
        externalTaskId: update.externalTaskId,
        externalRequestId: update.externalRequestId,
        externalStatus: update.externalStatus,
        externalSlotIndex: update.externalSlotIndex,
        providerDetails: update.providerDetails,
      });
    }, job.user_id, job.id);
    await checkpointGenerationExecution(supabase, generationFence(job), {
      phase: "result_ready",
      upstreamTaskId: execution.externalTaskId,
      upstreamRequestId: execution.externalRequestId,
      upstreamStatus: execution.externalStatus || "result_ready",
      resultPayload: {
        resultCount: execution.resultUrls.filter(Boolean).length,
        expectedCount: getExpectedResultCount(payload),
      },
    });
    await checkpointGenerationExecution(supabase, generationFence(job), {
      phase: "persisting",
      resultPayload: { resultCount: execution.resultUrls.filter(Boolean).length },
    });
    if (payload.kind === "productRetouch" && execution.hardValidation) {
      await assertProductRetouchResultUnique(supabase, payload, execution.hardValidation);
    }
    const finalModuleResults = execution.moduleResults?.length
      ? await persistModuleResults(execution.moduleResults)
      : undefined;
    const persistedResultUrls = finalModuleResults
      ? getProductSetResultUrlsFromModules(finalModuleResults)
      : await persistOrderedResultUrls(execution.resultUrls);
    const validPersistedResultUrls = compactResultUrls(persistedResultUrls);
    if (!validPersistedResultUrls.length) {
      throw new Error(execution.partialError || "生成任务未返回有效图片 URL");
    }
    const quality = shouldSkipVisualQualityEvaluation(payload)
      ? createSkippedVisualQualityEvaluation(payload)
      : await evaluateGeneratedImages({
        userPrompt: getPayloadPrompt(payload),
        module: payload.kind,
        resultUrls: validPersistedResultUrls,
        expectedCount: getExpectedResultCount(payload),
        referenceImageUrls: getPayloadReferenceImages(payload),
      });
    const repaired = !shouldSkipVisualQualityEvaluation(payload) && quality.shouldRegenerate && shouldAutoRegenerate(payload, job)
      ? await regenerateForQuality(supabase, job, payload, quality, partialPromptTrace)
      : null;
    if (quality.shouldRegenerate && !repaired && !isAutoRegenerationEnabled()) {
      logger.info(`[jobs] quality auto-regeneration disabled ${job.id}: score=${quality.score}`);
    }
    const finalUrls = compactResultUrls(repaired?.resultUrls || validPersistedResultUrls);
    if (!finalUrls.length) {
      throw new Error(execution.partialError || "生成任务未返回有效图片 URL");
    }
    const finalPromptTrace = repaired?.promptTrace || execution.promptTrace;
    const finalQuality = repaired?.quality || quality;
    const finalModulePayload = finalModuleResults
      ? await evaluateProductSetModuleResults({
        payload,
        moduleResults: finalModuleResults,
        promptTrace: finalPromptTrace,
        fallbackQuality: finalQuality,
      })
      : undefined;
    const expectedCount = getExpectedResultCount(payload);
    const moduleFailureSummary = finalModulePayload
      ?.filter((item) => item.status === "failed")
      .map((item) => `${item.name || item.moduleKey}: ${item.error || "failed"}`)
      .join("; ");
    const refundAmount = calculatePartialRefund(Number(job.credits_cost || 0), finalUrls.length, expectedCount);
    const settlementError = execution.partialError || moduleFailureSummary;
    const finalPayload = clearResumableBatchProgress(appendGenerationSettlementMetadata(appendProductSetModuleResults(
      appendProductRetouchHardValidation(
        appendPromptTrace(appendQualityMetadata(repaired?.payload || payload, finalQuality, Boolean(repaired)), finalPromptTrace),
        execution.hardValidation,
      ),
      finalModulePayload
    ), {
      expectedCount,
      resultCount: finalUrls.length,
      failedCount: Math.max(Number(execution.failedCount || 0), Math.max(0, expectedCount - finalUrls.length)),
      refundAmount,
      errorMessage: settlementError,
    }));

    await attachGenerationMediaAssetReferences({
      client: supabase,
      generationId: job.id,
      ownerUserId: job.user_id,
      assetIds: finalUrls.map(parseCanonicalMediaAssetId).filter((id): id is string => Boolean(id)),
      role: "generation_result",
    });
    await checkpointGenerationExecution(supabase, generationFence(job), {
      phase: "settling",
      resultPayload: { resultCount: finalUrls.length, expectedCount },
    });
    await completeGenerationRecord(supabase, job, finalUrls, finalPayload, {
      refundAmount,
      errorMessage: settlementError,
    });
    return { businessFailed: false, deferred: false };
  } catch (err) {
    if (isStaleExecutionFenceError(err)) {
      return { businessFailed: false, deferred: false, stale: true };
    }
    const message = sanitizeGenerationErrorMessage(err, "生成失败");
    if (isGenerationSubmissionOutcomeUnknownError(err)) {
      await markGenerationNeedsReview(
        supabase,
        generationFence(job),
        message,
        "submission_outcome_unknown",
      );
      await syncGenerationQueueIndex(job.id, "needs-review");
      return { businessFailed: true, deferred: false };
    }
    if (isAiTenantCapacityUnavailableError(err)) {
      const outcome = await deferGenerationForTenantCapacity(supabase, job, err.retryAfterSeconds, message);
      return { businessFailed: outcome === "failed", deferred: outcome === "deferred" };
    }
    if (isAiCapacityUnavailableError(err)) {
      const outcome = await deferGenerationForAiCapacity(supabase, job, err.retryAfterSeconds, message);
      return { businessFailed: outcome === "failed", deferred: outcome === "deferred" };
    }
    // Transient provider/DB/Redis/OSS faults must remain retryable. Settling
    // and refunding here would turn a short outage into a user-visible terminal
    // failure and make BullMQ's durable retry policy ineffective.
    if (isRetryableGenerationError(err)) {
      if (shouldSettlePartialResultOnRetryExhaustion(job.job_attempts)) {
        const settled = await settleFailedGenerationFromProgress(supabase, job, message);
        if (settled) return { businessFailed: false, deferred: false };
      }
      const outcome = await deferGenerationForRetryableError(supabase, job, message);
      return { businessFailed: outcome === "failed", deferred: outcome === "deferred" };
    }
    if (parsedPayload?.kind === "productRetouch" && Number(job.credits_cost || 0) === 0) {
      await failZeroCostProductRetouchChild(supabase, job, parsedPayload, message);
      return { businessFailed: true, deferred: false };
    }
    const settled = await settleFailedGenerationFromProgress(supabase, job, message);
    if (!settled) {
      await failGenerationWithRefund(supabase, {
        userId: job.user_id,
        generationId: job.id,
        amount: Number(job.credits_cost || 0),
        deliveryVersion: job.delivery_version,
        executionToken: job.execution_token,
        reason: "生成失败退还",
        errorMessage: message,
      });
      await annotateFailedGenerationPayload(supabase, job, message);
    }
    return { businessFailed: true, deferred: false };
  }
}

function shouldSettlePartialResultOnRetryExhaustion(jobAttempts: number) {
  return Math.max(0, Math.floor(Number(jobAttempts) || 0)) >= GENERATION_MAX_EXECUTION_ATTEMPTS;
}

async function deferGenerationForTenantCapacity(
  supabase: ReturnType<typeof createAdminClient>,
  job: ClaimedJob,
  retryAfterSeconds: number,
  reason: string,
): Promise<"deferred" | "failed"> {
  const { data, error } = await supabase.rpc("settle_generation_for_tenant_capacity", {
    p_generation_id: job.id,
    p_user_id: job.user_id,
    p_delivery_version: job.delivery_version,
    p_execution_token: job.execution_token,
    p_delay_seconds: Math.min(Math.max(Math.ceil(retryAfterSeconds), 5), 60),
    p_reason: reason.slice(0, 500),
  });
  if (error) {
    if (isStaleExecutionFenceError(error)) {
      throw new StaleExecutionFenceError("任务执行租约已丢失", { cause: error });
    }
    throw new Error(`用户并发排队失败: ${error.message}`);
  }
  if (data !== "deferred" && data !== "failed") {
    throw new Error("用户并发排队失败: execution fence 已变化");
  }
  await syncGenerationQueueIndex(job.id, "tenant-capacity-defer");
  return data;
}

async function deferGenerationForAiCapacity(
  supabase: ReturnType<typeof createAdminClient>,
  job: ClaimedJob,
  retryAfterSeconds: number,
  reason: string,
): Promise<"deferred" | "failed"> {
  const { data, error } = await supabase.rpc("settle_generation_for_ai_capacity", {
    p_generation_id: job.id,
    p_user_id: job.user_id,
    p_delivery_version: job.delivery_version,
    p_execution_token: job.execution_token,
    p_delay_seconds: Math.min(Math.max(Math.ceil(retryAfterSeconds), 5), 300),
    p_reason: reason.slice(0, 500),
  });
  if (error) {
    if (isStaleExecutionFenceError(error)) {
      throw new StaleExecutionFenceError("任务执行租约已丢失", { cause: error });
    }
    throw new Error(`模型容量排队失败: ${error.message}`);
  }
  if (data !== "deferred" && data !== "failed") {
    throw new Error("模型容量排队失败: execution fence 已变化");
  }
  await syncGenerationQueueIndex(job.id, "capacity-defer");
  return data;
}

async function deferGenerationForRetryableError(
  supabase: ReturnType<typeof createAdminClient>,
  job: ClaimedJob,
  reason: string,
): Promise<"deferred" | "failed"> {
  const { data, error } = await supabase.rpc("settle_generation_for_retryable_error", {
    p_generation_id: job.id,
    p_user_id: job.user_id,
    p_delivery_version: job.delivery_version,
    p_execution_token: job.execution_token,
    p_delay_seconds: 15,
    p_max_attempts: GENERATION_MAX_EXECUTION_ATTEMPTS,
    p_reason: reason.slice(0, 500),
  });
  if (error) {
    if (isStaleExecutionFenceError(error)) {
      throw new StaleExecutionFenceError("任务执行租约已丢失", { cause: error });
    }
    throw new RetryableGenerationError(`生成任务重试排队失败: ${error.message}`, "GENERATION_RETRY_SETTLEMENT_FAILED", { cause: error });
  }
  if (data !== "deferred" && data !== "failed") {
    throw new RetryableGenerationError("生成任务重试排队失败: execution fence 已变化", "GENERATION_RETRY_SETTLEMENT_FAILED");
  }
  await syncGenerationQueueIndex(job.id, "retryable-defer");
  return data;
}

async function failZeroCostProductRetouchChild(
  supabase: ReturnType<typeof createAdminClient>,
  job: ClaimedJob,
  payload: Extract<GenerationJobPayload, { kind: "productRetouch" }>,
  errorMessage: string,
) {
  const failedPayload = appendGenerationSettlementMetadata(payload, {
    expectedCount: 1,
    resultCount: 0,
    failedCount: 1,
    refundAmount: 0,
    errorMessage,
  });
  await failGenerationWithRefund(supabase, {
    userId: job.user_id,
    generationId: job.id,
    amount: 0,
    deliveryVersion: job.delivery_version,
    executionToken: job.execution_token,
    reason: "商品精修子任务失败",
    errorMessage,
  });
  const { error } = await supabase
    .from("generations")
    .update({
      job_payload: failedPayload,
    })
    .eq("id", job.id)
    .eq("user_id", job.user_id)
    .eq("delivery_version", job.delivery_version)
    .eq("status", "failed");
  if (error) throw new Error(`更新商品精修子任务失败: ${error.message}`);
  await syncGenerationQueueIndex(job.id, "product-retouch-fail");
}

async function completeGenerationRecord(
  supabase: ReturnType<typeof createAdminClient>,
  job: ClaimedJob,
  resultUrls: string[],
  jobPayload: Record<string, unknown>,
  options: { refundAmount?: number; errorMessage?: string } = {}
) {
  const totalCost = Math.max(0, Math.floor(Number(job.credits_cost || 0)));
  const refundAmount = Math.min(totalCost, Math.max(0, Math.floor(Number(options.refundAmount || 0))));
  const creditsUsed = Math.max(0, totalCost - refundAmount);
  const adjusted = await completeGenerationWithCreditAdjustment(supabase, {
    userId: job.user_id,
    generationId: job.id,
    resultUrls,
    deliveryVersion: job.delivery_version,
    executionToken: job.execution_token,
    jobPayload,
    creditsUsed,
    refundAmount,
    refundReason: refundAmount > 0 ? "部分生成失败退还" : "生成完成",
    errorMessage: options.errorMessage || null,
  });

  if (!adjusted) throw new Error(`任务完成结算失败: ${job.id}`);
  // The durable generation row is the source of truth. Refresh the recent-task
  // read model after every fenced completion so a stale child FAILED status
  // cannot remain visible beside successful result URLs.
  await syncGenerationQueueIndex(job.id, "complete");
}

async function assertProductRetouchResultUnique(
  supabase: ReturnType<typeof createAdminClient>,
  payload: Extract<GenerationJobPayload, { kind: "productRetouch" }>,
  validation: ProductRetouchHardValidationResult,
) {
  if (!payload.hardValidationPolicy.rejectDuplicateContent) return;
  const { data, error } = await supabase
    .from("product_retouch_outputs")
    .select("id")
    .eq("batch_id", payload.batchId)
    .neq("id", payload.outputId)
    .eq("status", "completed")
    .eq("content_sha256", validation.sha256)
    .limit(1);
  if (error) throw new Error(`商品精修重复结果校验失败: ${error.message}`);
  if (data?.length) throw new Error("结果与批次内已有图片重复");
}

async function loadClaimedGenerationCheckpoint(
  supabase: ReturnType<typeof createAdminClient>,
  job: ClaimedJob,
) {
  const { data, error } = await supabase
    .from("generations")
    .select("job_payload,result_urls")
    .eq("id", job.id)
    .eq("user_id", job.user_id)
    .eq("status", "processing_tryon")
    .eq("delivery_version", job.delivery_version)
    .eq("execution_token", job.execution_token)
    .maybeSingle();

  if (error) throw new Error(`读取任务恢复点失败: ${error.message}`);
  if (!data) throw new StaleExecutionFenceError("任务执行租约已丢失");
  return {
    jobPayload: data.job_payload,
    resultUrls: Array.isArray(data.result_urls) ? compactResultUrls(data.result_urls) : [],
  };
}

function recoverCompletedBatchCheckpoint(payload: GenerationJobPayload, durableResultUrls: string[]) {
  if (payload.kind === "productRetouch" || payload.kind === "productSet" || isVideoPayload(payload)) return payload;
  const expectedCount = getExpectedResultCount(payload);
  if (durableResultUrls.length !== expectedCount || !durableResultUrls.every(isCanonicalMediaAssetUrl)) return payload;
  const existing = readResumableBatchResultUrls(payload, expectedCount);
  if (existing.every(Boolean)) return payload;
  return appendResumableBatchProgress(payload, {
    resultUrls: durableResultUrls,
    promptTrace: [],
    progress: 99,
  });
}

async function settleFailedGenerationFromProgress(
  supabase: ReturnType<typeof createAdminClient>,
  job: ClaimedJob,
  errorMessage: string
) {
  const { data, error } = await supabase
    .from("generations")
    .select("status,result_urls,job_payload,credits_cost")
    .eq("id", job.id)
    .eq("user_id", job.user_id)
    .maybeSingle();

  if (error) {
    logger.error(`[jobs] failed to inspect partial progress for ${job.id}: ${error.message}`);
    return false;
  }

  const row = data as { status?: string | null; result_urls?: string[] | null; job_payload?: unknown; credits_cost?: number | null } | null;
  if (!row) return false;
  const status = String(row.status || "").toLowerCase();
  if (status === "completed" || status === "success" || status === "succeeded") return true;

  const resultUrls = Array.isArray(row.result_urls) ? compactResultUrls(row.result_urls) : [];
  if (!resultUrls.length) return false;

  const payloadRecord = isRecord(row.job_payload) ? row.job_payload : {};
  const expectedCount = readExpectedCountFromRecord(payloadRecord, resultUrls.length);
  const refundAmount = calculatePartialRefund(Number(row.credits_cost ?? job.credits_cost ?? 0), resultUrls.length, expectedCount);
  const settledPayload = appendGenerationSettlementMetadata(payloadRecord, {
    expectedCount,
    resultCount: resultUrls.length,
    failedCount: Math.max(0, expectedCount - resultUrls.length),
    refundAmount,
    errorMessage,
  });

  await completeGenerationRecord(supabase, job, resultUrls, settledPayload, {
    refundAmount,
    errorMessage,
  });
  return true;
}

async function annotateFailedGenerationPayload(
  supabase: ReturnType<typeof createAdminClient>,
  job: ClaimedJob,
  errorMessage: string
) {
  const { data, error } = await supabase
    .from("generations")
    .select("result_urls,job_payload,credits_cost")
    .eq("id", job.id)
    .eq("user_id", job.user_id)
    .maybeSingle();

  if (error) {
    logger.error(`[jobs] failed to annotate failed payload for ${job.id}: ${error.message}`);
    return;
  }

  const row = data as { result_urls?: string[] | null; job_payload?: unknown; credits_cost?: number | null } | null;
  if (!row) return;

  const resultUrls = Array.isArray(row.result_urls) ? compactResultUrls(row.result_urls) : [];
  const payloadRecord = isRecord(row.job_payload) ? row.job_payload : {};
  const expectedCount = readExpectedCountFromRecord(payloadRecord, resultUrls.length || 1);
  const failedPayload = appendGenerationSettlementMetadata(payloadRecord, {
    expectedCount,
    resultCount: resultUrls.length,
    failedCount: Math.max(1, expectedCount - resultUrls.length),
    refundAmount: Number(row.credits_cost ?? job.credits_cost ?? 0),
    errorMessage,
  });

  const { error: updateError } = await supabase
    .from("generations")
    .update({ job_payload: failedPayload })
    .eq("id", job.id)
    .eq("user_id", job.user_id)
    .eq("delivery_version", job.delivery_version)
    .neq("status", "completed");

  if (updateError) {
    logger.error(`[jobs] failed to write failed payload for ${job.id}: ${updateError.message}`);
    return;
  }
  await syncGenerationQueueIndex(job.id, "fail-payload");
}

function appendGenerationSettlementMetadata<T extends Record<string, unknown>>(
  payload: T,
  params: {
    expectedCount: number;
    resultCount: number;
    failedCount: number;
    refundAmount: number;
    errorMessage?: string;
  }
): T {
  if (!params.errorMessage && params.refundAmount <= 0 && params.failedCount <= 0) return payload;
  const asyncTask = isRecord(payload.asyncTask) ? payload.asyncTask : {};
  return {
    ...payload,
    asyncTask: {
      ...asyncTask,
      status: params.resultCount > 0 ? "PARTIAL_SUCCESS" : "FAILED",
      progress: 100,
      updatedAt: new Date().toISOString(),
    },
    partialFailure: {
      message: params.errorMessage || "",
      expectedCount: params.expectedCount,
      resultCount: params.resultCount,
      failedCount: params.failedCount,
      refundAmount: params.refundAmount,
      settledAt: new Date().toISOString(),
    },
  } as T;
}

function calculatePartialRefund(totalCost: number, resultCount: number, expectedCount: number) {
  const cost = Math.max(0, Math.floor(Number(totalCost) || 0));
  const expected = Math.max(1, Math.floor(Number(expectedCount) || 1));
  const completed = Math.min(expected, Math.max(0, Math.floor(Number(resultCount) || 0)));
  if (cost <= 0 || completed >= expected) return 0;
  if (completed <= 0) return cost;
  const charged = Math.min(cost, Math.max(1, Math.floor((cost * completed) / expected)));
  return Math.max(0, cost - charged);
}

function compactResultUrls(urls: string[]) {
  return urls.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
}

function isCanonicalMediaAssetUrl(value: unknown): value is string {
  return typeof value === "string"
    && /^\/api\/media-assets\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/?$/i.test(value);
}

function readExpectedCountFromRecord(payload: Record<string, unknown>, fallback: number) {
  const moduleResults = normalizeProductSetModuleResults(payload.moduleResults);
  if (moduleResults.length) return moduleResults.length;
  const count = Number(payload.genCount);
  if (Number.isFinite(count) && count > 0) return Math.floor(count);
  return Math.max(1, fallback);
}

async function regenerateForQuality(
  supabase: ReturnType<typeof createAdminClient>,
  job: ClaimedJob,
  payload: GenerationJobPayload,
  quality: VisualQualityEvaluation,
  previousPromptTrace: PromptTraceItem[]
) {
  const repairedPayload = repairPayloadPrompt(payload, quality);
  logger.warn(`[jobs] quality auto-regeneration ${job.id}: score=${quality.score} issues=${quality.issues.join(";")}`);
  const execution = await executePayload(repairedPayload, async (update) => {
    const persisted = update.resultUrls.length
      ? await persistGeneratedImageUrls(update.resultUrls, `${job.id}-quality-repair`, {
        forceServerDownload: isSeedreamPayload(repairedPayload),
      })
      : [];
    await writeGenerationProgress(supabase, job, repairedPayload, {
      resultUrls: persisted,
      promptTrace: [...previousPromptTrace, ...update.promptTrace],
    });
  }, job.user_id, job.id);
  const persisted = await persistGeneratedImageUrls(execution.resultUrls, `${job.id}-quality-repair`, {
    forceServerDownload: isSeedreamPayload(repairedPayload),
  });
  const repairedQuality = await evaluateGeneratedImages({
    userPrompt: getPayloadPrompt(repairedPayload),
    module: repairedPayload.kind,
    resultUrls: persisted,
    expectedCount: getExpectedResultCount(repairedPayload),
    referenceImageUrls: getPayloadReferenceImages(repairedPayload),
  });
  if (repairedQuality.score + 0.02 < quality.score) {
    return null;
  }
  return {
    payload: repairedPayload,
    resultUrls: persisted,
    promptTrace: [...previousPromptTrace, ...execution.promptTrace],
    quality: repairedQuality,
  };
}

async function evaluateProductSetModuleResults(params: {
  payload: GenerationJobPayload;
  moduleResults: ProductSetModuleResult[];
  promptTrace: PromptTraceItem[];
  fallbackQuality: VisualQualityEvaluation;
}) {
  if (params.payload.kind !== "productSet") return params.moduleResults;
  const normalized = normalizeProductSetModuleResults(params.moduleResults);
  const referenceImageUrls = getPayloadReferenceImages(params.payload);
  const traceByKey = new Map(params.promptTrace.map((item) => [item.promptKind.split(":").pop() || "", item]));
  const evaluated = [...normalized];

  await runWithConcurrency(evaluated, Math.min(2, Math.max(1, evaluated.length)), async (moduleResult, index) => {
    if (moduleResult.status === "failed" || !moduleResult.resultUrl) {
      evaluated[index] = {
        ...moduleResult,
        qualityScore: 0,
        qualitySummary: moduleResult.error || "模块生成失败",
        qualityIssues: [moduleResult.error || "模块没有返回可用图片"],
        qualitySource: "module_status",
      };
      return;
    }

    const trace = traceByKey.get(moduleResult.moduleKey);
    const userPrompt = trace?.prompt || [
      getPayloadPrompt(params.payload),
      moduleResult.moduleRole || moduleResult.name,
      moduleResult.contentScope || "",
    ].filter(Boolean).join("\n");
    const quality = await evaluateGeneratedImages({
      userPrompt,
      module: `productSet:${moduleResult.moduleKey}`,
      resultUrls: [moduleResult.resultUrl],
      expectedCount: 1,
      referenceImageUrls,
    }).catch(() => params.fallbackQuality);

    evaluated[index] = {
      ...moduleResult,
      qualityScore: quality.score,
      qualitySummary: quality.summary,
      qualityIssues: quality.issues.slice(0, 8),
      qualitySource: quality.source,
    };
  });

  return normalizeProductSetModuleResults(evaluated);
}

/**
 * Resolve the inner `executeParallelImageBatch` parallelism for a given model.
 *
 * The router rejects attempts beyond a deployment's `maxConcurrency` with
 * an `AiCapacityUnavailableError` ("供应商池当前已满"), and the router treats
 * these as fail-fast. So this helper caps a single job's parallel slots at
 * the summed capacity across the model's enabled deployments, while retaining
 * the application-wide 32-image ceiling. This uses fallback deployments as
 * one pool without allowing one generation to monopolize an unbounded number
 * of provider requests.
 *
 * Returns `0` when totalCount is 0, otherwise a positive integer ≤ totalCount
 * and ≤ the enabled deployment pool capacity for `modelId`.
 */
export async function resolveImageBatchConcurrency(modelId: string, totalCount: number): Promise<number> {
  const safeTotal = Math.max(0, Math.floor(Number.isFinite(totalCount) ? totalCount : 0));
  if (safeTotal === 0) return 0;
  const configuredLimit = getImageBatchConcurrency();
  try {
    const config = await getAiControlPlaneConfig({ decryptSecrets: false, allowLegacy: true });
    if (!config || !Array.isArray(config.deployments) || config.deployments.length === 0) {
      return Math.min(safeTotal, configuredLimit);
    }
    const enabledProviders = new Set(config.providers.filter((provider) => provider.enabled).map((provider) => provider.id));
    const caps = config.deployments
      .filter((deployment) => deployment.enabled
        && deployment.modelId === modelId
        && deployment.maxConcurrency > 0
        && enabledProviders.has(deployment.providerId))
      .map((d) => d.maxConcurrency);
    if (!caps.length) return Math.min(safeTotal, configuredLimit);
    const poolCapacity = caps.reduce((sum, value) => sum + value, 0);
    return Math.max(1, Math.min(safeTotal, configuredLimit, poolCapacity));
  } catch {
    return Math.min(safeTotal, configuredLimit);
  }
}

export function getImageBatchConcurrency(
  env?: { GENERATION_IMAGE_BATCH_CONCURRENCY?: string },
) {
  const raw = env?.GENERATION_IMAGE_BATCH_CONCURRENCY ?? process.env.GENERATION_IMAGE_BATCH_CONCURRENCY;
  if (raw === undefined || raw.trim() === "") return DEFAULT_IMAGE_BATCH_CONCURRENCY;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > IMAGE_BATCH_MAX_CONCURRENCY) {
    throw new Error(`[worker] GENERATION_IMAGE_BATCH_CONCURRENCY must be an integer between 1 and ${IMAGE_BATCH_MAX_CONCURRENCY}`);
  }
  return parsed;
}

export async function runCapacityAwareBatchWorkers(options: {
  count: number;
  concurrency: number;
  shouldSkip?: (index: number) => boolean;
  run: (index: number) => Promise<void>;
}) {
  const count = Math.max(0, Math.floor(options.count));
  const workerCount = Math.min(count, Math.max(1, Math.floor(options.concurrency)));
  let nextIndex = 0;
  let firstError: unknown;

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (firstError === undefined && nextIndex < count) {
      const index = nextIndex;
      nextIndex += 1;
      if (options.shouldSkip?.(index)) continue;
      try {
        await options.run(index);
      } catch (error) {
        firstError ??= error;
      }
    }
  }));

  if (firstError !== undefined) throw firstError;
}

async function executePayload(
  payload: GenerationJobPayload,
  onProgress: GenerationProgressCallback | undefined,
  ownerUserId: string,
  generationId?: string,
): Promise<GenerationExecutionResult> {
  const promptTrace: PromptTraceItem[] = Array.isArray((payload as GenerationJobPayload & { promptTrace?: unknown }).promptTrace)
    ? ((payload as GenerationJobPayload & { promptTrace?: unknown }).promptTrace as PromptTraceItem[]).slice(-8)
    : [];
  const resolvePayloadImageInputs = (input: Parameters<typeof resolveImageInputs>[0]) =>
    resolveImageInputs(input, { publicBaseUrl: payload.publicBaseUrl, ownerUserId });
  const resolvePayloadMediaInput = (src: string, expectedKind: "audio" | "image" | "video") =>
    resolveMediaInput(src, {
      publicBaseUrl: payload.publicBaseUrl,
      ownerUserId,
      expectedKind,
    });
  type ParallelImageRunResult = {
    resultUrl?: string;
    resultUrls?: string[];
    prompt: string;
    compiledPrompt: string;
    taskId?: string;
  };
  function isRetryableSlotError(message: string): boolean {
    if (!message) return false;
    const lower = message.toLowerCase();
    if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many requests")) return true;
    if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("aborted")) return true;
    if (/\b(502|503|504)\b/.test(lower)) return true;
    if (lower.includes("bad gateway") || lower.includes("service unavailable") || lower.includes("gateway timeout")) return true;
    if (lower.includes("upstream") || lower.includes("connection reset") || lower.includes("econnreset") || lower.includes("enotfound") || lower.includes("eai_again")) return true;
    return false;
  }

  function isAbortLikeError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const candidate = error as { name?: unknown; message?: unknown };
    return candidate.name === "AbortError"
      || (typeof candidate.message === "string" && candidate.message.toLowerCase().includes("aborted"));
  }

  const executeParallelImageBatch = async (params: {
    count: number;
    concurrency?: number;
    maxAttemptsPerSlot?: number;
    promptKind: string | ((index: number) => string);
    run: (index: number, onTaskProgress: (progress: ImageTaskProgress) => Promise<void>) => Promise<ParallelImageRunResult>;
  }): Promise<GenerationExecutionResult> => {
    const expectedCount = Math.max(1, Math.floor(params.count || 1));
    const maxAttemptsPerSlot = Math.max(1, Math.floor(params.maxAttemptsPerSlot || 1));
    const resumedUrls = readResumableBatchResultUrls(payload, expectedCount)
      .map((url) => isCanonicalMediaAssetUrl(url) ? url : "");
    const resultUrlSlots: string[][] = resumedUrls.map((url) => url ? [url] : []);
    const traceSlots: Array<PromptTraceItem | null> = Array.from({ length: expectedCount }, () => null);
    const failures: Array<{ index: number; message: string; retryable: boolean }> = [];
    const taskProgress: number[] = resumedUrls.map((url) => url ? 100 : 0);
    let completedCount = resumedUrls.filter(Boolean).length;
    let progressQueue = Promise.resolve();
    const getCompletedResultUrls = () => resultUrlSlots.flat();
    const getSlottedResultUrls = () => resultUrlSlots.map((slot) => slot[0] || "");
    const getCompletedPromptTrace = () => traceSlots.filter((item): item is PromptTraceItem => Boolean(item));
    const emitProgress = (update: GenerationProgressUpdate) => {
      if (!onProgress) return Promise.resolve();
      progressQueue = progressQueue.then(() => onProgress(update));
      return progressQueue;
    };

    const runOne = async (index: number) => {
      let lastMessage = "image task failed";
      let lastRetryable = false;
      for (let attempt = 1; attempt <= maxAttemptsPerSlot; attempt++) {
        try {
          const slotContext = { ...getAiRouteContext(), slotIndex: index };
          const result = await runWithAiRouteContext(slotContext, () => params.run(index, (progress) => {
            taskProgress[index] = Math.max(taskProgress[index] || 0, clampProgress(progress.progress));
            const aggregateProgress = Math.min(
              99,
              Math.max(1, Math.round(taskProgress.reduce((sum, value) => sum + value, 0) / expectedCount))
            );
            return emitProgress({
              resultUrls: getSlottedResultUrls(),
              promptTrace: getCompletedPromptTrace(),
              progress: aggregateProgress,
              externalTaskId: progress.taskId,
              externalStatus: progress.providerStatus || progress.status,
            });
          }));
          const nextUrls = (result.resultUrls?.length ? result.resultUrls : result.resultUrl ? [result.resultUrl] : [])
            .filter((url): url is string => Boolean(url));
          if (!nextUrls.length) throw new Error("image task returned no image");
          resultUrlSlots[index] = nextUrls;
          traceSlots[index] = createPromptTraceItem({
            index: index + 1,
            kind: payload.kind,
            model: payload.aiModel,
            promptKind: typeof params.promptKind === "function" ? params.promptKind(index) : params.promptKind,
            prompt: result.prompt,
            compiledPrompt: result.compiledPrompt,
          });
          taskProgress[index] = 100;
          completedCount += 1;
          await emitProgress(createCompletedImageProgress(
            getSlottedResultUrls(),
            getCompletedPromptTrace(),
            result.taskId,
            completedCount,
            expectedCount
          ));
          return;
        } catch (error) {
          const rawMessage = error instanceof Error ? error.message : "image task failed";
          lastMessage = rawMessage;
          if (isAiTenantCapacityUnavailableError(error) || isAiCapacityUnavailableError(error)) throw error;
          const retryable = isRetryableGenerationError(error) || isRetryableSlotError(rawMessage);
          lastRetryable = retryable;
          if (attempt < maxAttemptsPerSlot && retryable) {
            const backoffMs = Math.min(2000 * attempt, 5000);
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            taskProgress[index] = Math.max(taskProgress[index] || 0, 5);
            await emitProgress({
              resultUrls: getSlottedResultUrls(),
              promptTrace: getCompletedPromptTrace(),
              progress: Math.min(99, Math.round(taskProgress.reduce((sum, value) => sum + value, 0) / expectedCount)),
              externalStatus: `RETRYING_${attempt + 1}`,
            });
            continue;
          }
          if (attempt >= maxAttemptsPerSlot && retryable) {
            lastMessage = `${rawMessage}（已重试 ${maxAttemptsPerSlot - 1} 次）`;
          }
        }
      }

      failures.push({ index, message: lastMessage, retryable: lastRetryable });
      taskProgress[index] = 100;
      await emitProgress({
        resultUrls: getSlottedResultUrls(),
        promptTrace: getCompletedPromptTrace(),
        progress: Math.min(99, Math.round(taskProgress.reduce((sum, value) => sum + value, 0) / expectedCount)),
        // This is one child slot, not the durable parent generation. A plain
        // FAILED value makes status polling terminate the whole batch before
        // the worker can persist partial results and settle credits.
        externalStatus: "BATCH_RUNNING",
      });
    };

    let poolError: unknown;
    try {
      const modelPoolConcurrency = await resolveImageBatchConcurrency(payload.aiModel, expectedCount);
      await runCapacityAwareBatchWorkers({
        count: expectedCount,
        concurrency: Math.min(
          params.concurrency || expectedCount,
          modelPoolConcurrency || getImageBatchConcurrency(),
          getAiTenantConcurrencyPolicy(getAiRouteContext()).taskImageConcurrency,
        ),
        shouldSkip: (index) => Boolean(resultUrlSlots[index]?.length),
        run: runOne,
      });
    } catch (error) {
      poolError = error;
    }

    await progressQueue;
    if (poolError !== undefined) throw poolError;
    const resultUrls = getCompletedResultUrls();
    const traces = getCompletedPromptTrace();
    const retryableFailures = failures.filter((item) => item.retryable);
    if (retryableFailures.length) {
      throw new RetryableGenerationError(
        `图片批次仍有 ${retryableFailures.length} 个槽位因上游临时故障待重试`,
        "IMAGE_BATCH_RETRYABLE",
      );
    }
    if (!resultUrls.length && failures.length) {
      throw new Error(failures[0]?.message || "image task failed");
    }

    return {
      resultUrls,
      promptTrace: traces,
      failedCount: failures.length,
      partialError: failures.length ? failures.map((item) => `#${item.index + 1}: ${item.message}`).join("; ") : undefined,
    };
  };

  const runVideoBatch = async (
    promptKind: string,
    runOne: (
      index: number,
      onVideoProgress: (progress: VideoTaskProgress) => Promise<void>,
      resumeTask?: { taskId: string; requestId?: string; deploymentId?: string },
    ) => Promise<VideoGenerationResult>
  ) => {
    const expectedCount = normalizeAiVideoGenCount(payload.genCount);
    const resultSlots = readResumableBatchResultUrls(payload, expectedCount)
      .map((url) => isCanonicalMediaAssetUrl(url) ? url : "");
    const externalSlots = readExistingAsyncTask(payload).slots || [];
    let externalTaskId: string | undefined;
    let externalRequestId: string | undefined;
    let externalStatus: string | undefined;
    let providerDetails: Record<string, unknown> | undefined;

    for (let index = 0; index < expectedCount; index += 1) {
      if (resultSlots[index]) continue;
      const checkpoint = externalSlots.find((item) => item.slot === index);
      const result = await runOne(index, async (progress) => {
        const currentUrls = [...resultSlots];
        if (progress.urls?.[0]) currentUrls[index] = progress.urls[0];
        await onProgress?.({
          resultUrls: currentUrls,
          promptTrace,
          progress: Math.min(99, Math.round((index / expectedCount) * 100 + progress.progress / expectedCount)),
          externalTaskId: progress.taskId,
          externalRequestId: progress.requestId,
          externalStatus: progress.providerStatus || progress.status,
          externalSlotIndex: index,
          providerDetails: progress.providerDetails,
        });
      }, checkpoint ? { taskId: checkpoint.taskId, requestId: checkpoint.requestId, deploymentId: checkpoint.deploymentId } : undefined);

      resultSlots[index] = result.urls[0];
      externalTaskId = result.taskId;
      externalRequestId = result.requestId || externalRequestId;
      externalStatus = result.providerStatus;
      providerDetails = result.providerDetails || providerDetails;
      promptTrace.push(createPromptTraceItem({
        index: index + 1,
        kind: payload.kind,
        model: payload.aiModel,
        promptKind,
        prompt: result.prompt,
        compiledPrompt: result.compiledPrompt,
      }));

      await onProgress?.({
        resultUrls: [...resultSlots],
        promptTrace,
        progress: Math.min(99, Math.round(((index + 1) / expectedCount) * 100)),
        externalTaskId,
        externalRequestId,
        externalStatus,
        externalSlotIndex: index,
        providerDetails,
      });
    }

    return {
      resultUrls: compactResultUrls(resultSlots),
      promptTrace,
      progress: 100,
      externalTaskId,
      externalRequestId,
      externalStatus,
      providerDetails,
    };
  };

  if (payload.kind === "videoImageToVideo") {
    const modelMode = normalizeAiVideoModelMode(payload.modelMode, payload.kind);
    const audioMode = resolvePayloadAiVideoAudioMode(payload);
    const [imageUrl, audioUrl] = await Promise.all([
      resolvePayloadMediaInput(payload.imageUrl, "image"),
      audioMode === "custom" && payload.audioUrl
        ? resolvePayloadMediaInput(payload.audioUrl, "audio")
        : undefined,
    ]);
    return runVideoBatch("video:image-to-video", (index, onVideoProgress, resumeTask) => generateVideoImageToVideo({
      provider: payload.provider,
      generationId,
      userId: ownerUserId,
      imageUrl,
      prompt: payload.prompt,
      modelMode,
      duration: normalizeAiVideoDuration(payload.duration),
      resolution: normalizeAiVideoResolution(payload.resolution, modelMode),
      aspectRatio: normalizeAiVideoAspectRatio(payload.aspectRatio),
      audioMode,
      audioUrl,
      audioPrompt: payload.audioPrompt,
      generateAudio: normalizeAiVideoGenerateAudio(payload.generateAudio),
      idempotencyKey: generationId ? `gen-${generationId}-video-${index}` : undefined,
      resumeTask,
      onProgress: onVideoProgress,
    }));
  }

  if (payload.kind === "videoMotion") {
    const modelMode = normalizeAiVideoModelMode(payload.modelMode, payload.kind);
    const audioMode = resolvePayloadAiVideoAudioMode(payload);
    const [modelImageUrl, referenceVideoUrl] = await Promise.all([
      resolvePayloadMediaInput(payload.modelImageUrl, "image"),
      resolvePayloadMediaInput(payload.referenceVideoUrl, "video"),
    ]);
    const audioUrl = audioMode === "custom" && payload.audioUrl
      ? await resolvePayloadMediaInput(payload.audioUrl, "audio")
      : undefined;
    return runVideoBatch("video:motion-control", (index, onVideoProgress, resumeTask) => generateVideoMotionControl({
      provider: payload.provider,
      generationId,
      userId: ownerUserId,
      modelImageUrl,
      referenceVideoUrl,
      prompt: payload.prompt,
      modelMode,
      duration: normalizeAiVideoDuration(payload.duration),
      resolution: normalizeAiVideoResolution(payload.resolution, modelMode),
      aspectRatio: normalizeAiVideoAspectRatio(payload.aspectRatio),
      audioMode,
      audioUrl,
      audioPrompt: payload.audioPrompt,
      generateAudio: normalizeAiVideoGenerateAudio(payload.generateAudio),
      idempotencyKey: generationId ? `gen-${generationId}-video-${index}` : undefined,
      resumeTask,
      onProgress: onVideoProgress,
    }));
  }

  if (payload.kind === "videoFirstLastFrame") {
    const modelMode = normalizeAiVideoModelMode(payload.modelMode, payload.kind);
    const audioMode = resolvePayloadAiVideoAudioMode(payload);
    const [firstFrameUrl, lastFrameUrl] = await Promise.all([
      resolvePayloadMediaInput(payload.firstFrameUrl, "image"),
      resolvePayloadMediaInput(payload.lastFrameUrl, "image"),
    ]);
    const audioUrl = audioMode === "custom" && payload.audioUrl
      ? await resolvePayloadMediaInput(payload.audioUrl, "audio")
      : undefined;
    return runVideoBatch("video:first-last-frame", (index, onVideoProgress, resumeTask) => generateVideoFirstLastFrame({
      provider: payload.provider,
      generationId,
      userId: ownerUserId,
      firstFrameUrl,
      lastFrameUrl,
      prompt: payload.prompt,
      modelMode,
      duration: normalizeAiVideoDuration(payload.duration),
      resolution: normalizeAiVideoResolution(payload.resolution, modelMode),
      aspectRatio: normalizeAiVideoAspectRatio(payload.aspectRatio),
      audioMode,
      audioUrl,
      audioPrompt: payload.audioPrompt,
      generateAudio: normalizeAiVideoGenerateAudio(payload.generateAudio),
      idempotencyKey: generationId ? `gen-${generationId}-video-${index}` : undefined,
      resumeTask,
      onProgress: onVideoProgress,
    }));
  }

  if (payload.kind === "tryon") {
    const referenceUrls = getTryOnPayloadReferenceUrls(payload);
    const garmentDetailGroups = normalizeGarmentDetailGroups(payload.garmentDetailGroups, payload.clothingUrls.length);
    const groupedGarmentDetailUrls = flattenGarmentDetailGroups(garmentDetailGroups);
    const legacyGarmentDetailUrls = garmentDetailGroups.length
      ? []
      : normalizeGarmentDetailUrls(payload.garmentDetailUrls);
    const garmentDetailUrls = garmentDetailGroups.length ? groupedGarmentDetailUrls : legacyGarmentDetailUrls;
    const imageInputs = await resolvePayloadImageInputs({
      clothingUrls: payload.clothingUrls,
      modelFaceUrl: payload.modelFaceUrl || undefined,
      referenceUrls,
    });
    const garmentDetailInputs = garmentDetailUrls.length
      ? await resolvePayloadImageInputs({ clothingUrls: garmentDetailUrls })
      : { clothingUrls: [] as string[] };
    const resolvedGarmentDetailGroups = garmentDetailGroups.length
      ? rehydrateGarmentDetailGroups(garmentDetailGroups, garmentDetailInputs.clothingUrls)
      : [];
    const resolvedReferenceUrls = imageInputs.referenceUrls?.length ? imageInputs.referenceUrls : [];
    const referenceAnalyses = alignTryOnReferenceAnalyses(payload.referenceAnalyses, resolvedReferenceUrls.length);
    const referenceBatchSize = Math.max(1, resolvedReferenceUrls.length);
    const perReferenceCount = Math.max(1, Math.floor(payload.genCount || 1));
    return executeParallelImageBatch({
      count: perReferenceCount * referenceBatchSize,
      concurrency: 4,
      maxAttemptsPerSlot: 1,
      promptKind: (index) => resolvedReferenceUrls.length
        ? `tryon:reference-${Math.floor(index / perReferenceCount) + 1}`
        : "tryon",
      run: async (index, onTaskProgress) => {
        const referenceIndex = resolvedReferenceUrls.length ? Math.floor(index / perReferenceCount) : -1;
        const candidateIndex = resolvedReferenceUrls.length ? index % perReferenceCount : index;
        const referenceUrl = referenceIndex >= 0 ? resolvedReferenceUrls[referenceIndex] : undefined;
        const referenceAnalysis = referenceIndex >= 0 ? referenceAnalyses[referenceIndex] : undefined;
        const result = await batchTryOn({
          model: payload.aiModel,
          clothingUrls: imageInputs.clothingUrls,
          clothingMode: payload.clothingMode,
          clothingRoles: payload.clothingRoles,
          clothingAnalysis: payload.clothingAnalysis,
          garmentDetailUrls: legacyGarmentDetailUrls.length ? garmentDetailInputs.clothingUrls : [],
          garmentDetailGroups: resolvedGarmentDetailGroups,
          garmentAudience: payload.garmentAudience,
          ageGroup: payload.ageGroup,
          garmentCategory: payload.garmentCategory,
          modelFaceUrl: imageInputs.modelFaceUrl,
          referenceUrl,
          referenceAnalysis,
          aspect_ratio: payload.aspectRatio,
          image_size: payload.imageSize,
          style: payload.style,
          raw_prompt: payload.rawPrompt,
          candidateIndex,
          candidateCount: perReferenceCount,
          onProgress: onTaskProgress,
          imageGenerator: generateImage,
        });
        return {
          resultUrls: result.resultUrls,
          prompt: result.prompt,
          compiledPrompt: result.compiledPrompt,
          taskId: result.taskId,
        };
      },
    });
  }

  if (payload.kind === "model") {
    const references = [
      ...payload.referenceUrls,
      payload.hairReferenceUrl,
      payload.hairColorReferenceUrl,
    ].filter(Boolean) as string[];
    const imageInputs = await resolvePayloadImageInputs({ clothingUrls: references });
    const modelStyle = normalizeModelShootStyle(payload.modelStyle);

    return executeParallelImageBatch({
      count: payload.genCount,
      promptKind: "model",
      run: async (_index, onTaskProgress) => {
        const prompt = enforceModelPromptRequirements({
          prompt: applyModelShootStylePrompt(payload.prompt, modelStyle),
          referenceCount: payload.referenceUrls.length,
          gender: payload.gender,
          hairStyle: payload.hairStyle,
          hairColor: payload.hairColor,
          hairReferenceIndex: payload.hairReferenceUrl ? payload.referenceUrls.length + 1 : null,
          hairColorReferenceIndex: payload.hairColorReferenceUrl ? payload.referenceUrls.length + (payload.hairReferenceUrl ? 2 : 1) : null,
        });
        const result = await generateImage({
          model: payload.aiModel,
          prompt,
          prompt_kind: "model",
          aspect_ratio: payload.aspectRatio,
          image: imageInputs.clothingUrls,
          smart_aspect_image: references[0],
          image_size: payload.imageSize,
          onProgress: onTaskProgress,
        });
        return {
          resultUrl: getResultUrl(result),
          prompt,
          compiledPrompt: result.compiledPrompt || prompt,
          taskId: result.taskId,
        };
      },
    });
  }

  if (payload.kind === "grass") {
    const imageInputs = await resolvePayloadImageInputs({
      clothingUrls: [
        payload.garmentUrl,
        ...(payload.referenceUrl ? [payload.referenceUrl] : []),
      ],
    });

    return executeParallelImageBatch({
      count: payload.genCount,
      promptKind: "grass",
      run: async (_index, onTaskProgress) => {
        const result = await generateImage({
          model: payload.aiModel,
          prompt: payload.prompt,
          prompt_kind: "grass",
          aspect_ratio: payload.aspectRatio,
          image: imageInputs.clothingUrls,
          smart_aspect_image: payload.referenceUrl || payload.garmentUrl,
          image_size: payload.imageSize,
          onProgress: onTaskProgress,
        });
        return {
          resultUrl: getResultUrl(result),
          prompt: payload.prompt,
          compiledPrompt: result.compiledPrompt || payload.prompt,
          taskId: result.taskId,
        };
      },
    });
  }

  if (payload.kind === "modelBackground") {
    const sourceUrls = normalizeModelBackgroundSourceUrls(payload.sourceUrls, payload.sourceUrl);
    const sourceInputs = await resolvePayloadImageInputs({ clothingUrls: sourceUrls });
    const referenceUrls = [
      payload.modelReferenceUrl,
      payload.backgroundReferenceUrl,
    ].filter(Boolean) as string[];
    const referenceInputs = await resolvePayloadImageInputs({ clothingUrls: referenceUrls });
    const perSourceCount = Math.max(1, Math.floor(Number(payload.genCount || 1)));

    return executeParallelImageBatch({
      count: Math.max(1, sourceUrls.length) * perSourceCount,
      concurrency: 4,
      promptKind: (index) => `modelBackground:source-${Math.floor(index / perSourceCount) + 1}`,
      run: async (index, onTaskProgress) => {
        const sourceIndex = Math.min(Math.floor(index / perSourceCount), sourceInputs.clothingUrls.length - 1);
        const sourceInputUrl = sourceInputs.clothingUrls[sourceIndex] || sourceInputs.clothingUrls[0] || payload.sourceUrl;
        const result = await generateImage({
          model: payload.aiModel,
          prompt: payload.prompt,
          prompt_kind: "modelBackground",
          aspect_ratio: payload.aspectRatio,
          image: [sourceInputUrl, ...referenceInputs.clothingUrls],
          smart_aspect_image: sourceUrls[sourceIndex] || payload.sourceUrl,
          image_size: payload.imageSize,
          onProgress: onTaskProgress,
        });
        return {
          resultUrl: getResultUrl(result),
          prompt: payload.prompt,
          compiledPrompt: result.compiledPrompt || payload.prompt,
          taskId: result.taskId,
        };
      },
    });
  }

  if (payload.kind === "imageTranslation") {
    const sourceUrls = normalizeImageTranslationSourceUrls(payload.sourceUrls, payload.sourceUrl);
    const sourceInputs = await resolvePayloadImageInputs({ clothingUrls: sourceUrls });
    const languages = Array.isArray(payload.languages) ? payload.languages.filter((value: unknown): value is string => typeof value === "string" && value.length > 0) : [];
    const languageLabels = Array.isArray(payload.languageLabels) ? payload.languageLabels.filter((value: unknown): value is string => typeof value === "string" && value.length > 0) : [];
    const languageCount = Math.max(1, languages.length);
    const perLanguageCount = Math.max(1, Math.floor(Number(payload.genCount || 1)));
    const perSourceCount = perLanguageCount * languageCount;
    const totalCount = Math.max(1, sourceInputs.clothingUrls.length) * perSourceCount;

    return executeParallelImageBatch({
      count: totalCount,
      concurrency: await resolveImageBatchConcurrency(payload.aiModel, totalCount),
      maxAttemptsPerSlot: 1,
      promptKind: (index) => {
        const sourceIndex = Math.min(Math.floor(index / perSourceCount), sourceInputs.clothingUrls.length - 1);
        const languageIndex = Math.max(0, Math.floor((index % perSourceCount) / perLanguageCount));
        const language = languages[languageIndex] || `lang-${languageIndex + 1}`;
        return `imageTranslation:source-${sourceIndex + 1}:lang-${languageIndex + 1}:${String(language).replace(/[^\w-]+/g, "-").slice(0, 24)}`;
      },
      run: async (index, onTaskProgress) => {
        const sourceIndex = Math.min(Math.floor(index / perSourceCount), sourceInputs.clothingUrls.length - 1);
        const languageIndex = Math.max(0, Math.floor((index % perSourceCount) / perLanguageCount));
        const languageCode = languages[languageIndex] || `lang-${languageIndex + 1}`;
        const languageLabel = languageLabels[languageIndex] || languageCode;
        const sourceInputUrl = sourceInputs.clothingUrls[sourceIndex] || sourceInputs.clothingUrls[0] || payload.sourceUrl;
        const perCallPrompt = enforceImageTranslationPromptRequirements(
          buildImageTranslationPerCallPrompt({
            sourceIndex,
            sourceCount: sourceInputs.clothingUrls.length,
            language: languageCode,
            languageLabel,
            userPrompt: typeof payload.userPrompt === "string" ? payload.userPrompt : "",
            aiModel: payload.aiModel,
            imageSize: payload.imageSize,
          }),
          { sourceCount: 1, languages: [languageCode], languageLabels: [languageLabel] }
        );
        const result = await generateImage({
          model: payload.aiModel,
          prompt: perCallPrompt,
          prompt_kind: "imageTranslation",
          aspect_ratio: payload.aspectRatio,
          image: [sourceInputUrl],
          smart_aspect_image: sourceUrls[sourceIndex] || payload.sourceUrl,
          image_size: payload.imageSize,
          onProgress: onTaskProgress,
        });
        return {
          resultUrl: getResultUrl(result),
          prompt: perCallPrompt,
          compiledPrompt: result.compiledPrompt || perCallPrompt,
          taskId: result.taskId,
        };
      },
    });
  }

  if (payload.kind === "materialEnhancement") {
    const imageInputs = await resolvePayloadImageInputs({
      clothingUrls: [payload.sourceUrl, payload.garmentUrl],
    });

    return executeParallelImageBatch({
      count: payload.genCount,
      promptKind: "materialEnhancement",
      run: async (_index, onTaskProgress) => {
        const result = await generateImage({
          model: payload.aiModel,
          prompt: payload.prompt,
          prompt_kind: "materialEnhancement",
          aspect_ratio: payload.aspectRatio,
          image: imageInputs.clothingUrls,
          smart_aspect_image: payload.sourceUrl,
          image_size: payload.imageSize,
          onProgress: onTaskProgress,
        });
        return {
          resultUrl: getResultUrl(result),
          prompt: payload.prompt,
          compiledPrompt: result.compiledPrompt || payload.prompt,
          taskId: result.taskId,
        };
      },
    });
  }

  if (payload.kind === "productRetouch") {
    const imageInputs = await resolvePayloadImageInputs({
      clothingUrls: [payload.sourceUrl],
    });
    const sourceInputUrl = imageInputs.clothingUrls[0] || payload.sourceUrl;
    const result = await generateImage({
      model: payload.aiModel,
      prompt: payload.prompt,
      prompt_kind: "productRetouch",
      aspect_ratio: payload.aspectRatio,
      image: [sourceInputUrl],
      smart_aspect_image: payload.sourceUrl,
      image_size: payload.imageSize,
      onProgress: async (progress) => {
        await onProgress?.({
          resultUrls: [],
          promptTrace: [],
          progress: Math.min(99, Math.max(1, Math.round(progress.progress))),
          externalTaskId: progress.taskId,
          externalStatus: progress.providerStatus || progress.status,
        });
      },
    });
    const resultUrl = getResultUrl(result);
    const hardValidation = payload.hardValidationPolicy.enabled
      ? await validateGeneratedProductImage(resultUrl, payload.hardValidationPolicy)
      : undefined;
    const trace = createPromptTraceItem({
      index: 1,
      kind: payload.kind,
      model: payload.aiModel,
      promptKind: `productRetouch:${payload.mode}`,
      prompt: payload.prompt,
      compiledPrompt: result.compiledPrompt || payload.prompt,
    });
    await onProgress?.({
      resultUrls: [resultUrl],
      promptTrace: [trace],
      progress: 99,
      externalTaskId: result.taskId,
      externalStatus: "SUCCEEDED",
      hardValidation,
    });
    return {
      resultUrls: [resultUrl],
      promptTrace: [trace],
      progress: 100,
      externalTaskId: result.taskId,
      externalStatus: "SUCCEEDED",
      hardValidation,
    };
  }

  if (payload.kind === "generalImage" || payload.kind === "outfitFusion") {
    const imageInputs = payload.mode === "image-to-image"
      ? await resolvePayloadImageInputs({ clothingUrls: payload.referenceUrls })
      : { clothingUrls: [] };
    const isSplitRun = payload.kind === "generalImage"
      && payload.onePerReference === true
      && payload.referenceUrls.length > 1;
    const perReferenceCount = Math.max(1, Number(payload.genCount) || 1);
    const smartAspectImage = payload.kind === "outfitFusion"
      ? resolveOutfitFusionSmartAspectImage({
          assets: payload.assets,
          referenceUrls: payload.referenceUrls,
          resolvedReferenceUrls: imageInputs.clothingUrls,
        })
      : payload.referenceUrls[0];

    const references = imageInputs.clothingUrls.length ? imageInputs.clothingUrls : payload.referenceUrls;
    const totalCount = isSplitRun ? references.length * perReferenceCount : perReferenceCount;
    return executeParallelImageBatch({
      count: totalCount,
      concurrency: await resolveImageBatchConcurrency(payload.aiModel, totalCount),
      maxAttemptsPerSlot: 1,
      promptKind: payload.kind === "outfitFusion" ? "outfitFusion" : payload.mode,
      run: async (index, onTaskProgress) => {
        // One-per-reference: each reference owns `genCount` slots, so results are
        // produced reference-major and the client can slice them per group.
        const slotReferences = isSplitRun
          ? [references[Math.min(references.length - 1, Math.floor(index / perReferenceCount))]]
          : imageInputs.clothingUrls;
        const slotSmartAspectImage = isSplitRun ? slotReferences[0] : smartAspectImage;
        const result = await generateImage({
          model: payload.aiModel,
          prompt: payload.prompt,
          prompt_kind: payload.kind === "outfitFusion" ? "outfitFusion" : undefined,
          aspect_ratio: payload.aspectRatio,
          image: slotReferences,
          smart_aspect_image: slotSmartAspectImage,
          image_size: payload.imageSize,
          onProgress: onTaskProgress,
        });
        return {
          resultUrl: getResultUrl(result),
          prompt: payload.prompt,
          compiledPrompt: result.compiledPrompt || payload.prompt,
          taskId: result.taskId,
        };
      },
    });
  }

  if (payload.kind === "pose") {
    const garmentAngleReferences = normalizeGarmentAngleReferences(payload.garmentAngleReferences);
    const legacyGarmentAngleReferences = normalizeGarmentAngleReferences(
      normalizeGarmentDetailUrls(payload.garmentDetailUrls).map((url) => ({ url, target: "outfit" as const, view: "other" as const }))
    );
    const activeGarmentAngleReferences = garmentAngleReferences.length ? garmentAngleReferences : legacyGarmentAngleReferences;
    const garmentAngleUrls = flattenGarmentAngleReferences(activeGarmentAngleReferences);
    const poseReferenceUrls = normalizePoseReferenceUrls(payload.poseReferenceUrls);
    const imageInputs = await resolvePayloadImageInputs({
      clothingUrls: [payload.mainImageUrl, ...garmentAngleUrls],
      referenceUrls: poseReferenceUrls,
    });
    const resolvedPoseReferenceUrls = imageInputs.referenceUrls || [];
    const resolvedGarmentAngleReferences = rehydrateGarmentAngleReferences(activeGarmentAngleReferences, imageInputs.clothingUrls.slice(1));
    const poseStyle = normalizePoseSeriesStyle(payload.poseStyle);
    const isPoseReferenceMode = payload.poseCreationMode === "reference" && resolvedPoseReferenceUrls.length > 0;
    const poseReferenceCopies = normalizePoseReferenceCopies(payload.poseReferenceCopies, Math.max(resolvedPoseReferenceUrls.length, 1));
    const poseReferenceOutputCount = Math.max(1, resolvedPoseReferenceUrls.length * poseReferenceCopies);
    const outputMode = isPoseReferenceMode ? "separate" : normalizePoseOutputMode(payload.outputMode);
    const poseAnalysis = normalizePoseVisualAnalysis(payload.poseAnalysis);
    const targetPoseCount = isPoseReferenceMode
      ? poseReferenceOutputCount
      : normalizePosePlanCount(payload.poseCount ?? payload.posePlan?.slots.length ?? payload.genCount ?? 4);
    const posePlan = isPoseReferenceMode
      ? null
      : normalizePosePlan(payload.posePlan, {
          poseAnalysis,
          poseStyle,
          outputMode,
          prompt: payload.prompt,
          poseCount: targetPoseCount,
          angleCounts: payload.angleCounts,
        });
    const angleCount = resolvedGarmentAngleReferences.length;
    const roleBasedPrompt = buildPoseRoleBasedPrompt({
      outputMode,
      detailCount: angleCount,
      poseCount: outputMode === "grid" ? posePlan?.slots.length || targetPoseCount : getPoseGenerationCount(payload),
    });
    const fallbackPrompt = enforcePosePromptRequirements(applyPoseSeriesStylePrompt(payload.prompt, poseStyle), {
      poseStyle: isPoseReferenceMode ? "user_custom" : poseStyle,
      outputMode,
      poseAnalysis,
      posePlan,
    });
    const userIntent = (payload.prompt || "").trim();

    if (outputMode === "separate") {
      const generationCount = getPoseGenerationCount(payload);
      const poseStartIndex = normalizePoseStartIndex(payload.poseStartIndex);
      const aspectRatio = payload.aspectRatio || "auto";
      return executeParallelImageBatch({
        count: generationCount,
        concurrency: 2,
        maxAttemptsPerSlot: 1,
        promptKind: "pose",
        run: async (index, onTaskProgress) => {
          // Separate mode is already split into one API call per pose slot.
          // Keep group-level "4 poses / user raw plan" wording out of each call.
          const poseSlotIndex = poseStartIndex + index;
          const poseReferenceIndex = resolvedPoseReferenceUrls.length
            ? Math.floor((poseSlotIndex - 1) / poseReferenceCopies) % resolvedPoseReferenceUrls.length
            : 0;
          const currentPoseReferenceUrl = resolvedPoseReferenceUrls.length
            ? resolvedPoseReferenceUrls[poseReferenceIndex]
            : "";
          const slotPoseReferenceUrls = currentPoseReferenceUrl ? [currentPoseReferenceUrl] : [];
          const poseReferenceDirective = buildPoseReferenceImagePrompt({
            referenceCount: slotPoseReferenceUrls.length,
            startImageNumber: 2,
            outputMode: "separate",
            poseIndex: poseSlotIndex,
            poseCount: targetPoseCount,
            copiesPerReference: poseReferenceCopies,
          });
          const garmentAngleDirective = buildPoseGarmentAngleReferencePrompt({
            references: resolvedGarmentAngleReferences,
            startImageNumber: 2 + slotPoseReferenceUrls.length,
          });
          const posePrompt = [
            isPoseReferenceMode
              ? buildPoseReferenceModeSeparatePrompt(fallbackPrompt, poseSlotIndex)
              : buildSeparatePosePrompt(fallbackPrompt, poseSlotIndex, poseStyle, payload.prompt, poseAnalysis, posePlan),
            poseReferenceDirective,
            garmentAngleDirective,
          ].filter(Boolean).join("\n");
          const result = await generateImage({
            model: payload.aiModel,
            prompt: posePrompt,
            prompt_kind: "pose",
            aspect_ratio: aspectRatio,
            image: [imageInputs.clothingUrls[0], ...slotPoseReferenceUrls, ...imageInputs.clothingUrls.slice(1)],
            smart_aspect_image: payload.mainImageUrl,
            image_size: payload.imageSize,
            onProgress: onTaskProgress,
          });
          return {
            resultUrl: getResultUrl(result),
            prompt: posePrompt,
            compiledPrompt: result.compiledPrompt || posePrompt,
            taskId: result.taskId,
          };
        },
      });
    }

    const poseReferenceDirective = buildPoseReferenceImagePrompt({
      referenceCount: resolvedPoseReferenceUrls.length,
      startImageNumber: 2,
      outputMode: "grid",
      poseCount: posePlan?.slots.length || targetPoseCount,
    });
    const garmentAngleDirective = buildPoseGarmentAngleReferencePrompt({
      references: resolvedGarmentAngleReferences,
      startImageNumber: 2 + resolvedPoseReferenceUrls.length,
    });
    const posePrompt = [
      roleBasedPrompt,
      userIntent ? `用户补充：${userIntent}` : "",
      fallbackPrompt,
      poseReferenceDirective,
      garmentAngleDirective,
    ].filter(Boolean).join("\n");
    const result = await generateImage({
      model: payload.aiModel,
      prompt: posePrompt,
      prompt_kind: "pose",
      aspect_ratio: payload.aspectRatio || "auto",
      image: [imageInputs.clothingUrls[0], ...resolvedPoseReferenceUrls, ...imageInputs.clothingUrls.slice(1)],
      smart_aspect_image: payload.mainImageUrl,
      image_size: payload.imageSize,
      onProgress: (progress) => onProgress?.(mapImageTaskProgress(progress, [], [], 0, 1)),
    });

    return {
      resultUrls: [getResultUrl(result)],
      promptTrace: [createPromptTraceItem({
        index: 1,
        kind: payload.kind,
        model: payload.aiModel,
        promptKind: "pose",
        prompt: posePrompt,
        compiledPrompt: result.compiledPrompt || posePrompt,
      })],
    };
  }

  if (payload.kind === "faceSwap") {
    const sourceUrls = normalizeFaceSwapSourceUrls(payload.sourceUrls, payload.sourceUrl);
    const sourceInputs = await resolvePayloadImageInputs({ clothingUrls: sourceUrls });
    const faceInputs = await resolvePayloadImageInputs({ clothingUrls: [payload.faceUrl] });
    const faceInputUrl = faceInputs.clothingUrls[0] || payload.faceUrl;
    const faceSwapMode = normalizeFaceSwapMode(payload.faceSwapMode);
    const prompt = enforceFaceSwapPromptRequirements(payload.prompt, faceSwapMode);
    const perSourceCount = Math.max(1, Math.floor(Number(payload.genCount || 1)));

    return executeParallelImageBatch({
      count: Math.max(1, sourceUrls.length) * perSourceCount,
      concurrency: 4,
      promptKind: (index) => `faceSwap:source-${Math.floor(index / perSourceCount) + 1}`,
      run: async (index, onTaskProgress) => {
        const sourceIndex = Math.min(Math.floor(index / perSourceCount), sourceInputs.clothingUrls.length - 1);
        const sourceInputUrl = sourceInputs.clothingUrls[sourceIndex] || sourceInputs.clothingUrls[0] || payload.sourceUrl;
        const result = await generateImage({
          model: payload.aiModel,
          prompt,
          prompt_kind: "faceSwap",
          aspect_ratio: payload.aspectRatio,
          image: [sourceInputUrl, faceInputUrl],
          smart_aspect_image: sourceUrls[sourceIndex] || payload.sourceUrl,
          image_size: payload.imageSize,
          onProgress: onTaskProgress,
        });
        return {
          resultUrl: getResultUrl(result),
          prompt,
          compiledPrompt: result.compiledPrompt || prompt,
          taskId: result.taskId,
        };
      },
    });
  }

  if (payload.kind === "commerceDetail") {
    const imageInputs = await resolvePayloadImageInputs({ clothingUrls: payload.sourceUrls });
    const layout = normalizeCommerceDetailLayout(payload.layout);
    const sections = normalizeCommerceDetailSections(payload.sections, payload.genCount);
    const generationCount = sections.length;

    return executeParallelImageBatch({
      count: generationCount,
      promptKind: (index) => `commerceDetail:${sections[index]?.id || index + 1}`,
      run: async (index, onTaskProgress) => {
        const section = sections[index];
        const prompt = buildCommerceDetailSectionPrompt({
          userPrompt: payload.prompt,
          platform: payload.platform || "general",
          layout,
          mobileWidth: payload.mobileWidth || 750,
          section,
          sectionIndex: index + 1,
          sectionTotal: generationCount,
          referenceCount: imageInputs.clothingUrls.length,
        });
        const result = await generateImage({
          model: payload.aiModel,
          prompt,
          prompt_kind: "commerceDetail",
          aspect_ratio: resolveCommerceDetailAspectRatio(layout, payload.aspectRatio),
          image: imageInputs.clothingUrls,
          image_size: payload.imageSize,
          onProgress: onTaskProgress,
        });
        return {
          resultUrl: getResultUrl(result),
          prompt,
          compiledPrompt: result.compiledPrompt || prompt,
          taskId: result.taskId,
        };
      },
    });
  }

  if (payload.kind === "productSet") {
    const imageType = normalizeProductSetImageType(payload.imageType);
    const mode = normalizeProductSetCreationMode(payload.mode);
    const settings = normalizeProductSetSettings(payload.settings);
    const productProfile = normalizeProductSetProductProfile(payload.productProfile, payload.productInfo || payload.prompt);
    const moduleOverrides = normalizeProductSetModuleOverrides(payload.moduleOverrides);
    const templates = resolveProductSetTemplates({
      mode,
      imageType,
      selectedTemplateIds: payload.selectedTemplateIds,
      customTemplates: payload.customTemplates,
      genCount: payload.genCount,
      productProfile,
      settings,
      moduleOverrides,
    });
    const fallbackTemplates = templates.length ? templates : resolveProductSetTemplates({ mode: "smart", imageType, genCount: 1, productProfile, settings, moduleOverrides });
    const rawRegenerateIndex = Number(payload.regenerateIndex);
    const regenerateIndex = Number.isFinite(rawRegenerateIndex) ? Math.floor(rawRegenerateIndex) : null;
    const targetEntries = fallbackTemplates
      .map((template, index) => ({ template, index }))
      .filter((entry) => regenerateIndex === null || entry.index === regenerateIndex);
    const persistedModuleResults = normalizeProductSetModuleResults(payload.moduleResults);
    const persistedByKey = new Map(persistedModuleResults.map((item) => [item.moduleKey, item]));
    const moduleResults = targetEntries.map(({ template, index }) => persistedByKey.get(getProductSetModuleKey(template, index)) || createProductSetModuleResult(template, index, {
      promptVariant: settings.stylePackId || "auto",
      updatedAt: new Date().toISOString(),
    }));
    const pendingEntries = targetEntries.filter(({ template, index }) => {
      if (regenerateIndex === index) return true;
      const existing = persistedByKey.get(getProductSetModuleKey(template, index));
      return !existing || existing.status !== "completed" || !existing.resultUrl;
    });
    const moduleStartedAt = new Map<string, number>();
    const updateModule = (moduleKey: string, patch: Partial<ProductSetModuleResult>) => {
      const index = moduleResults.findIndex((item) => item.moduleKey === moduleKey);
      if (index < 0) return;
      moduleResults[index] = {
        ...moduleResults[index],
        ...patch,
        updatedAt: patch.updatedAt || new Date().toISOString(),
        progress: typeof patch.progress === "number" ? Math.min(Math.max(Math.round(patch.progress), 0), 100) : moduleResults[index].progress,
      };
    };
    const moduleProgress = () => {
      const count = Math.max(1, moduleResults.length);
      const total = moduleResults.reduce((sum, item) => sum + (item.status === "completed" || item.status === "failed" ? 100 : Math.min(item.progress, 99)), 0);
      return Math.min(99, Math.round(total / count));
    };
    const emitModuleProgress = async (externalTaskId?: string, externalStatus?: string) => {
      await onProgress?.({
        resultUrls: getProductSetResultUrlsFromModules(moduleResults),
        promptTrace,
        moduleResults: normalizeProductSetModuleResults(moduleResults),
        progress: moduleProgress(),
        externalTaskId,
        externalStatus,
      });
    };

    await emitModuleProgress();

    await runWithConcurrency(pendingEntries, Math.min(3, Math.max(1, pendingEntries.length)), async ({ template, index }) => {
      const moduleKey = getProductSetModuleKey(template, index);
      const outputAspectRatio = template.aspectRatio || payload.aspectRatio;
      const styleReferenceUrls = getProductSetReferenceUrls(template).slice(0, 3);
      const prompt = buildProductSetPrompt({
        productInfo: payload.productInfo || payload.prompt,
        productProfile,
        productImageCount: payload.productImageUrls.length,
        template,
        allTemplates: fallbackTemplates,
        settings,
        mode,
        aspectRatio: outputAspectRatio,
        imageSize: payload.imageSize,
        sequenceIndex: index,
        totalCount: fallbackTemplates.length,
      });

      moduleStartedAt.set(moduleKey, Date.now());
      updateModule(moduleKey, { status: "running", progress: 3, startedAt: new Date().toISOString(), attempt: 1 });
      await emitModuleProgress();

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          updateModule(moduleKey, { status: "running", attempt, error: undefined });
          const imageInputs = await resolvePayloadImageInputs({
            clothingUrls: [
              ...payload.productImageUrls,
              ...styleReferenceUrls,
            ],
          });
          const result = await generateImage({
            model: payload.aiModel,
            idempotencyKey: generationId ? `gen-image:${generationId}:module-${moduleKey}` : undefined,
            prompt,
            prompt_kind: "productSet",
            aspect_ratio: outputAspectRatio,
            image: imageInputs.clothingUrls,
            smart_aspect_image: styleReferenceUrls[0] || payload.productImageUrls[0],
            image_size: payload.imageSize,
            onProgress: async (progress) => {
              updateModule(moduleKey, {
                status: "running",
                progress: Math.min(clampProgress(progress.progress), 99),
                taskId: progress.taskId,
                providerStatus: progress.providerStatus || progress.status,
              });
              await emitModuleProgress(progress.taskId, progress.providerStatus || progress.status);
            },
          });
          const resultUrl = getResultUrl(result);
          promptTrace.push(createPromptTraceItem({
            index: index + 1,
            kind: payload.kind,
            model: payload.aiModel,
            promptKind: `productSet:${PRODUCT_SET_PROMPT_VERSION}:${settings.stylePackId || "auto"}:${moduleKey}`,
            prompt,
            compiledPrompt: result.compiledPrompt || prompt,
          }));
          updateModule(moduleKey, {
            status: "completed",
            progress: 100,
            resultUrl,
            taskId: result.taskId,
            providerStatus: "SUCCESS",
            promptVersion: PRODUCT_SET_PROMPT_VERSION,
            promptVariant: settings.stylePackId || "auto",
            promptHash: hashPrompt(result.compiledPrompt || prompt),
            completedAt: new Date().toISOString(),
            durationMs: Math.max(0, Date.now() - (moduleStartedAt.get(moduleKey) || Date.now())),
            error: undefined,
          });
          await emitModuleProgress(result.taskId, "SUCCESS");
          return;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "模块生成失败";
          if (isAiTenantCapacityUnavailableError(err) || isAiCapacityUnavailableError(err) || isRetryableGenerationError(err) || isAbortLikeError(err)) {
            throw err;
          }
          // Permanent policy/validation/client failures must not be replayed.
          // Only explicitly transient network/provider errors get the bounded
          // module retry; unknown application errors fail closed as well.
          if (attempt < 2 && isRetryableSlotError(message)) {
            updateModule(moduleKey, {
              status: "running",
              progress: 5,
              error: `${message}，正在自动重试`,
            });
            await emitModuleProgress();
            continue;
          }
          updateModule(moduleKey, {
            status: "failed",
            progress: 100,
            error: message,
            providerStatus: "FAILED",
            attempt,
            completedAt: new Date().toISOString(),
            durationMs: Math.max(0, Date.now() - (moduleStartedAt.get(moduleKey) || Date.now())),
          });
          await emitModuleProgress(undefined, "FAILED");
        }
      }
    });

    const resultUrls = getProductSetResultUrlsFromModules(moduleResults);
    if (!resultUrls.length) {
      const firstError = moduleResults.find((item) => item.error)?.error || "商品套图全部模块生成失败";
      throw new Error(firstError);
    }
    return {
      resultUrls,
      promptTrace: promptTrace.sort((a, b) => a.index - b.index),
      moduleResults: normalizeProductSetModuleResults(moduleResults),
    };
  }

  const imageInputs = await resolvePayloadImageInputs({
    clothingUrls: [
      payload.garmentUrl,
      ...(payload.referenceUrl ? [payload.referenceUrl] : []),
    ],
  });
  const displayStyle = normalizeGarment3dDisplayStyle(payload.displayStyle);

  return executeParallelImageBatch({
    count: payload.genCount,
    promptKind: "garment3d",
    run: async (_index, onTaskProgress) => {
      const prompt = applyGarment3dDisplayStylePrompt(payload.prompt, displayStyle);
      const result = await generateImage({
        model: payload.aiModel,
        prompt,
        prompt_kind: "garment3d",
        aspect_ratio: payload.aspectRatio,
        image: imageInputs.clothingUrls,
        smart_aspect_image: payload.referenceUrl || payload.garmentUrl,
        image_size: payload.imageSize,
        onProgress: onTaskProgress,
      });
      return {
        resultUrl: getResultUrl(result),
        prompt,
        compiledPrompt: result.compiledPrompt || prompt,
        taskId: result.taskId,
      };
    },
  });
}

function resolvePayloadAiVideoAudioMode(payload: { audioMode?: AiVideoAudioMode; audioUrl?: string | null; generateAudio?: boolean }) {
  if (payload.audioMode) return normalizeAiVideoAudioMode(payload.audioMode);
  if (payload.audioUrl) return "custom";
  return normalizeAiVideoGenerateAudio(payload.generateAudio) ? "generated" : "off";
}

function mapImageTaskProgress(
  progress: ImageTaskProgress,
  currentResultUrls: string[],
  currentPromptTrace: PromptTraceItem[],
  completedCount: number,
  expectedCount: number
): GenerationProgressUpdate {
  const safeExpected = Math.max(1, expectedCount);
  const taskProgress = clampProgress(progress.progress);
  const overall = Math.min(99, Math.round(((completedCount + taskProgress / 100) / safeExpected) * 100));
  return {
    resultUrls: currentResultUrls,
    promptTrace: currentPromptTrace,
    progress: overall,
    externalTaskId: progress.taskId,
    externalStatus: progress.providerStatus || progress.status,
  };
}

function createCompletedImageProgress(
  resultUrls: string[],
  promptTrace: PromptTraceItem[],
  taskId: string | undefined,
  completedCount: number,
  expectedCount: number
): GenerationProgressUpdate {
  const safeExpected = Math.max(1, expectedCount);
  return {
    resultUrls,
    promptTrace,
    progress: Math.min(100, Math.round((completedCount / safeExpected) * 100)),
    externalTaskId: taskId,
    externalStatus: "SUCCESS",
  };
}

function clampProgress(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.min(Math.max(Math.round(num), 0), 100);
}

function hashPrompt(prompt: string) {
  let hash = 2166136261;
  for (let i = 0; i < prompt.length; i++) {
    hash ^= prompt.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
) {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length || 1);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  }));
}

function createPromptTraceItem(params: Omit<PromptTraceItem, "createdAt">): PromptTraceItem {
  return {
    ...params,
    prompt: limitStoredPrompt(params.prompt),
    compiledPrompt: limitStoredPrompt(params.compiledPrompt),
    createdAt: new Date().toISOString(),
  };
}

function appendPromptTrace(payload: GenerationJobPayload, promptTrace: PromptTraceItem[]) {
  if (!promptTrace.length) return payload;

  return {
    ...payload,
    promptTraceVersion: 1,
    promptTrace: promptTrace.slice(-8),
  };
}

function appendProductSetModuleResults(payload: GenerationJobPayload, moduleResults?: ProductSetModuleResult[]) {
  if (payload.kind !== "productSet" || !moduleResults?.length) return payload;
  return {
    ...payload,
    moduleResults: normalizeProductSetModuleResults(moduleResults),
  } as GenerationJobPayload;
}

function appendProductRetouchHardValidation(
  payload: GenerationJobPayload,
  hardValidation?: ProductRetouchHardValidationResult,
) {
  if (payload.kind !== "productRetouch" || !hardValidation) return payload;
  return {
    ...payload,
    hardValidation,
  } as GenerationJobPayload;
}

function appendAsyncProgress(payload: GenerationJobPayload, update: GenerationProgressUpdate): GenerationJobPayload {
  if (
    typeof update.progress !== "number" &&
    !update.externalTaskId &&
    !update.externalRequestId &&
    !update.externalStatus &&
    !update.providerDetails
  ) {
    return payload;
  }

  const existingAsyncTask = readExistingAsyncTask(payload);
  const nextSlots = [...(existingAsyncTask.slots || [])];
  if (Number.isInteger(update.externalSlotIndex) && update.externalTaskId) {
    const slot = Math.max(0, Math.floor(update.externalSlotIndex!));
    const checkpoint = {
      slot,
      taskId: update.externalTaskId,
      requestId: update.externalRequestId,
      deploymentId: typeof update.providerDetails?.deploymentId === "string" ? update.providerDetails.deploymentId : undefined,
      status: update.externalStatus,
      progress: typeof update.progress === "number"
        ? Math.min(Math.max(Math.round(update.progress), 0), 100)
        : undefined,
      updatedAt: new Date().toISOString(),
    };
    const previousIndex = nextSlots.findIndex((item) => item.slot === slot);
    if (previousIndex >= 0) nextSlots[previousIndex] = checkpoint;
    else nextSlots.push(checkpoint);
    nextSlots.sort((left, right) => left.slot - right.slot);
  }
  const nextPayload = {
    ...payload,
    asyncTask: {
      taskId: update.externalTaskId || existingAsyncTask.taskId,
      requestId: update.externalRequestId || existingAsyncTask.requestId,
      status: update.externalStatus || existingAsyncTask.status,
      progress: typeof update.progress === "number"
        ? Math.min(Math.max(Math.round(update.progress), 0), 100)
        : existingAsyncTask.progress,
      providerDetails: update.providerDetails || existingAsyncTask.providerDetails,
      slots: nextSlots,
      updatedAt: new Date().toISOString(),
    },
  } as unknown as GenerationJobPayload;
  return appendProductSetModuleResults(nextPayload, update.moduleResults);
}

function readExistingAsyncTask(payload: GenerationJobPayload): {
  taskId?: string;
  requestId?: string;
  status?: string;
  progress?: unknown;
  providerDetails?: Record<string, unknown>;
  slots?: Array<{
    slot: number;
    taskId: string;
    requestId?: string;
    deploymentId?: string;
    status?: string;
    progress?: number;
    updatedAt: string;
  }>;
} {
  const maybePayload = payload as unknown as { asyncTask?: unknown };
  const asyncTask = maybePayload.asyncTask;
  if (!asyncTask || typeof asyncTask !== "object") return {};
  const task = asyncTask as {
    taskId?: unknown;
    task_id?: unknown;
    requestId?: unknown;
    deploymentId?: unknown;
    request_id?: unknown;
    status?: unknown;
    progress?: unknown;
    providerDetails?: unknown;
    slots?: unknown;
  };
  return {
    taskId: typeof task.taskId === "string"
      ? task.taskId
      : typeof task.task_id === "string"
        ? task.task_id
        : undefined,
    requestId: typeof task.requestId === "string"
      ? task.requestId
      : typeof task.request_id === "string"
        ? task.request_id
        : undefined,
    status: typeof task.status === "string" ? task.status : undefined,
    progress: task.progress,
    providerDetails: isRecord(task.providerDetails) ? task.providerDetails : undefined,
    slots: normalizeExternalTaskSlots(task.slots),
  };
}

function normalizeExternalTaskSlots(value: unknown) {
  if (!Array.isArray(value)) return [];
  const slots: NonNullable<ReturnType<typeof readExistingAsyncTask>["slots"]> = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const slot = Number(entry.slot);
    const taskId = typeof entry.taskId === "string" ? entry.taskId.trim() : "";
    if (!Number.isInteger(slot) || slot < 0 || slot > 999 || !/^[A-Za-z0-9._-]{1,256}$/.test(taskId)) continue;
    slots.push({
      slot,
      taskId,
      requestId: typeof entry.requestId === "string" && /^[A-Za-z0-9._-]{1,256}$/.test(entry.requestId)
        ? entry.requestId
        : undefined,
      deploymentId: typeof entry.deploymentId === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.deploymentId)
        ? entry.deploymentId
        : undefined,
      status: typeof entry.status === "string" ? entry.status.slice(0, 80) : undefined,
      progress: Number.isFinite(Number(entry.progress)) ? clampProgress(Number(entry.progress)) : undefined,
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
    });
  }
  return slots.slice(0, 1000);
}

function appendQualityMetadata(
  payload: GenerationJobPayload,
  quality: VisualQualityEvaluation,
  autoRegenerated: boolean
) {
  if (isSkippedQualityEvaluation(quality)) {
    const rest = { ...payload } as Record<string, unknown>;
    delete rest.qualityEvaluation;
    delete rest.autoRegeneration;
    return rest as GenerationJobPayload;
  }

  return {
    ...payload,
    qualityEvaluation: {
      ok: quality.ok,
      score: quality.score,
      shouldRegenerate: quality.shouldRegenerate,
      summary: quality.summary,
      issues: quality.issues,
      source: quality.source,
      traceId: quality.trace?.id,
      evaluatedAt: new Date().toISOString(),
    },
    autoRegeneration: {
      enabled: isAutoRegenerationEnabled(),
      performed: autoRegenerated,
      maxAttempts: 1,
    },
  };
}

function isSkippedQualityEvaluation(quality: VisualQualityEvaluation) {
  return quality.source === "deterministic"
    && quality.ok
    && !quality.shouldRegenerate
    && /已跳过自动视觉评估/.test(quality.summary);
}

function shouldAutoRegenerate(payload: GenerationJobPayload, job: ClaimedJob) {
  if (!isAutoRegenerationEnabled()) return false;
  if (payload.kind === "productSet") return false;
  if (job.job_attempts > 1) return false;
  const meta = payload as GenerationJobPayload & { autoRegeneration?: { performed?: boolean } };
  return meta.autoRegeneration?.performed !== true;
}

function shouldSkipVisualQualityEvaluation(payload: GenerationJobPayload) {
  if (payload.kind === "tryon" || payload.kind === "pose" || payload.kind === "productRetouch" || isVideoPayload(payload)) return true;
  return false;
}

function createSkippedVisualQualityEvaluation(payload: GenerationJobPayload): VisualQualityEvaluation {
  return {
    ok: true,
    score: 1,
    shouldRegenerate: false,
    summary: payload.kind === "tryon"
      ? "服装上身已跳过自动视觉评估。"
      : payload.kind === "pose"
        ? "姿势裂变已跳过自动视觉评估。"
        : isVideoPayload(payload)
          ? "视频生成已跳过自动视觉评估。"
          : "已跳过自动视觉评估。",
    issues: [],
    source: "deterministic",
  };
}

function isAutoRegenerationEnabled() {
  return process.env.GENERATION_AUTO_REGENERATE_ENABLED === "true";
}

function repairPayloadPrompt(payload: GenerationJobPayload, quality: VisualQualityEvaluation): GenerationJobPayload {
  const prompt = applyQualityRepairToPrompt(getPayloadPrompt(payload), quality);
  if (payload.kind === "tryon") return { ...payload, rawPrompt: prompt };
  if (payload.kind === "outfitFusion") return { ...payload, userPrompt: prompt };
  if (payload.kind === "garment3d") return { ...payload, prompt, userPrompt: prompt };
  if (payload.kind === "materialEnhancement") return { ...payload, prompt, userPrompt: prompt };
  return { ...payload, prompt } as GenerationJobPayload;
}

function getPayloadPrompt(payload: GenerationJobPayload) {
  if (payload.kind === "tryon") return payload.rawPrompt || payload.style || "人物换装生成";
  if (payload.kind === "outfitFusion") return getOutfitFusionDisplayPrompt(payload.userPrompt || payload.prompt, "搭配融图任务");
  if (payload.kind === "garment3d") return payload.userPrompt || payload.prompt;
  if (payload.kind === "materialEnhancement") return payload.userPrompt || payload.prompt;
  if (payload.kind === "productRetouch") return payload.userInstruction || payload.prompt;
  if (payload.kind === "videoMotion") return payload.prompt || "动作模仿视频生成";
  if (payload.kind === "videoFirstLastFrame") return payload.prompt || "首尾帧视频生成";
  return payload.prompt;
}

function getExpectedResultCount(payload: GenerationJobPayload) {
  if (payload.kind === "pose") return getPoseGenerationCount(payload);
  if (payload.kind === "productSet" && payload.moduleResults?.length) return payload.moduleResults.length;
  if (payload.kind === "faceSwap") {
    const sourceCount = normalizeFaceSwapSourceUrls(payload.sourceUrls, payload.sourceUrl).length || 1;
    return Math.max(1, Number(payload.genCount || 1)) * sourceCount;
  }
  if (payload.kind === "modelBackground") {
    const sourceCount = normalizeModelBackgroundSourceUrls(payload.sourceUrls, payload.sourceUrl).length || 1;
    return Math.max(1, Number(payload.genCount || 1)) * sourceCount;
  }
  if (payload.kind === "imageTranslation") {
    const sourceCount = normalizeImageTranslationSourceUrls(payload.sourceUrls, payload.sourceUrl).length || 1;
    const languageCount = Math.max(1, Array.isArray(payload.languages) ? payload.languages.length : 0);
    return Math.max(1, Number(payload.genCount || 1)) * sourceCount * languageCount;
  }
  if (payload.kind === "tryon") {
    const referenceCount = getTryOnPayloadReferenceUrls(payload).length || 1;
    return Math.max(1, Number(payload.genCount || 1)) * referenceCount;
  }
  if (payload.kind === "generalImage" && payload.onePerReference && payload.referenceUrls.length > 1) {
    return Math.max(1, Number(payload.genCount || 1)) * payload.referenceUrls.length;
  }
  return Math.max(1, Number((payload as { genCount?: number }).genCount || 1));
}

function getPayloadReferenceImages(payload: GenerationJobPayload) {
  if (payload.kind === "tryon") return [
    ...payload.clothingUrls,
    ...getTryOnPayloadReferenceUrls(payload),
    payload.modelFaceUrl,
    ...getTryOnPayloadGarmentDetailUrls(payload),
  ].filter((url): url is string => typeof url === "string" && url.length > 0);
  if (payload.kind === "model") return [
    ...payload.referenceUrls,
    payload.hairReferenceUrl,
    payload.hairColorReferenceUrl,
  ].filter((url): url is string => typeof url === "string" && url.length > 0);
  if (payload.kind === "grass") return [payload.garmentUrl, payload.referenceUrl].filter((url): url is string => typeof url === "string" && url.length > 0);
  if (payload.kind === "modelBackground") return [
    ...normalizeModelBackgroundSourceUrls(payload.sourceUrls, payload.sourceUrl),
    payload.modelReferenceUrl,
    payload.backgroundReferenceUrl,
  ].filter((url): url is string => typeof url === "string" && url.length > 0);
  if (payload.kind === "imageTranslation") return normalizeImageTranslationSourceUrls(payload.sourceUrls, payload.sourceUrl).filter((url): url is string => typeof url === "string" && url.length > 0);
  if (payload.kind === "materialEnhancement") return [payload.sourceUrl, payload.garmentUrl];
  if (payload.kind === "productRetouch") return [payload.sourceUrl];
  if (payload.kind === "generalImage" || payload.kind === "outfitFusion") return payload.referenceUrls;
  if (payload.kind === "pose") return [
    payload.mainImageUrl,
    ...getPosePayloadReferenceUrls(payload),
    ...getPosePayloadGarmentAngleUrls(payload),
  ];
  if (payload.kind === "videoImageToVideo") return [payload.imageUrl];
  if (payload.kind === "videoMotion") return [payload.modelImageUrl];
  if (payload.kind === "videoFirstLastFrame") return [payload.firstFrameUrl, payload.lastFrameUrl];
  if (payload.kind === "faceSwap") return [...normalizeFaceSwapSourceUrls(payload.sourceUrls, payload.sourceUrl), payload.faceUrl];
  if (payload.kind === "commerceDetail") return payload.sourceUrls;
  if (payload.kind === "productSet") {
    const imageType = normalizeProductSetImageType(payload.imageType);
    const mode = normalizeProductSetCreationMode(payload.mode);
    const settings = normalizeProductSetSettings(payload.settings);
    const productProfile = normalizeProductSetProductProfile(payload.productProfile, payload.productInfo || payload.prompt);
    const templates = resolveProductSetTemplates({
      mode,
      imageType,
      selectedTemplateIds: payload.selectedTemplateIds,
      customTemplates: payload.customTemplates,
      genCount: payload.genCount,
      productProfile,
      settings,
      moduleOverrides: normalizeProductSetModuleOverrides(payload.moduleOverrides),
    });
    return [
      ...payload.productImageUrls,
      ...Array.from(new Set(templates.flatMap((template) => getProductSetReferenceUrls(template)))).slice(0, 8),
    ];
  }
  return [payload.garmentUrl, payload.referenceUrl].filter((url): url is string => typeof url === "string" && url.length > 0);
}

function getTryOnPayloadReferenceUrls(payload: Extract<GenerationJobPayload, { kind: "tryon" }>) {
  if (payload.sceneMode === "auto_design") return [];
  return uniqueStrings([
    ...(Array.isArray(payload.referenceUrls) ? payload.referenceUrls : []),
    payload.referenceUrl,
  ]).slice(0, 8);
}

function getTryOnPayloadGarmentDetailUrls(payload: Extract<GenerationJobPayload, { kind: "tryon" }>) {
  const groups = normalizeGarmentDetailGroups(payload.garmentDetailGroups, payload.clothingUrls.length);
  if (groups.length) return flattenGarmentDetailGroups(groups);
  return normalizeGarmentDetailUrls(payload.garmentDetailUrls);
}

function getPosePayloadGarmentAngleUrls(payload: Extract<GenerationJobPayload, { kind: "pose" }>) {
  const angleReferences = normalizeGarmentAngleReferences(payload.garmentAngleReferences);
  if (angleReferences.length) return flattenGarmentAngleReferences(angleReferences);
  return normalizeGarmentDetailUrls(payload.garmentDetailUrls);
}

function getPosePayloadReferenceUrls(payload: Extract<GenerationJobPayload, { kind: "pose" }>) {
  return normalizePoseReferenceUrls(payload.poseReferenceUrls);
}

function rehydrateGarmentDetailGroups(groups: GarmentDetailReferenceGroup[], resolvedUrls: string[]) {
  let offset = 0;
  return groups.map((group) => {
    const urls = resolvedUrls.slice(offset, offset + group.urls.length);
    offset += group.urls.length;
    return { clothingIndex: group.clothingIndex, urls };
  }).filter((group) => group.urls.length);
}

function rehydrateGarmentAngleReferences(references: GarmentAngleReference[], resolvedUrls: string[]) {
  return references.map((ref, index) => ({
    ...ref,
    url: resolvedUrls[index],
  })).filter((ref) => typeof ref.url === "string" && ref.url.length > 0);
}

function limitStoredPrompt(prompt: string) {
  const normalized = prompt.replace(/\r\n/g, "\n").trim();
  return normalized.length > 12_000 ? `${normalized.slice(0, 12_000)}\n[truncated]` : normalized;
}

function getResultUrl(result: { url?: string; b64_json?: string }) {
  const resultUrl = result.url || result.b64_json;
  if (!resultUrl) throw new Error("图片生成接口未返回结果 URL");
  return resultUrl;
}

function parseJobPayload(value: unknown): GenerationJobPayload {
  if (!isJobPayload(value)) {
    throw new Error("任务 payload 无效，请重新提交生成");
  }

  return value;
}

function isJobPayload(value: unknown): value is GenerationJobPayload {
  if (!isRecord(value) || typeof value.kind !== "string") return false;

  if (value.kind === "tryon") {
    return hasStringArray(value.clothingUrls) &&
      typeof value.aiModel === "string" &&
      typeof value.aspectRatio === "string" &&
      typeof value.imageSize === "string" &&
      typeof value.genCount === "number";
  }

  if (value.kind === "model") {
    return hasStringArray(value.referenceUrls) &&
      typeof value.aiModel === "string" &&
      typeof value.aspectRatio === "string" &&
      typeof value.imageSize === "string" &&
      typeof value.prompt === "string" &&
      typeof value.genCount === "number";
  }

  if (value.kind === "grass") {
    return typeof value.garmentUrl === "string" &&
      typeof value.aiModel === "string" &&
      typeof value.aspectRatio === "string" &&
      typeof value.imageSize === "string" &&
      typeof value.prompt === "string" &&
      typeof value.genCount === "number";
  }

  if (value.kind === "modelBackground") {
    return typeof value.sourceUrl === "string" &&
      typeof value.aiModel === "string" &&
      typeof value.aspectRatio === "string" &&
      typeof value.imageSize === "string" &&
      typeof value.prompt === "string" &&
      typeof value.genCount === "number";
  }
  if (value.kind === "imageTranslation") {
    return typeof value.sourceUrl === "string" &&
      hasStringArray(value.sourceUrls) &&
      hasStringArray(value.languages) &&
      typeof value.aiModel === "string" &&
      typeof value.aspectRatio === "string" &&
      typeof value.imageSize === "string" &&
      typeof value.prompt === "string" &&
      typeof value.genCount === "number";
  }

  if (value.kind === "materialEnhancement") {
    return typeof value.sourceUrl === "string" &&
      typeof value.garmentUrl === "string" &&
      typeof value.aiModel === "string" &&
      typeof value.aspectRatio === "string" &&
      typeof value.imageSize === "string" &&
      typeof value.prompt === "string" &&
      typeof value.genCount === "number";
  }

  if (value.kind === "productRetouch") {
    return value.internalTask === true &&
      typeof value.batchId === "string" &&
      typeof value.outputId === "string" &&
      typeof value.sourceUrl === "string" &&
      typeof value.sourceFilename === "string" &&
      typeof value.mode === "string" &&
      typeof value.category === "string" &&
      typeof value.aiModel === "string" &&
      typeof value.aspectRatio === "string" &&
      typeof value.imageSize === "string" &&
      typeof value.prompt === "string" &&
      value.genCount === 1 &&
      isRecord(value.hardValidationPolicy);
  }

  if (value.kind === "generalImage" || value.kind === "outfitFusion") {
    return (value.mode === "text-to-image" || value.mode === "image-to-image") &&
      hasStringArray(value.referenceUrls) &&
      typeof value.aiModel === "string" &&
      typeof value.aspectRatio === "string" &&
      typeof value.imageSize === "string" &&
      typeof value.prompt === "string" &&
      typeof value.genCount === "number";
  }

  if (value.kind === "pose") {
    return typeof value.mainImageUrl === "string" &&
      typeof value.aiModel === "string" &&
      typeof value.imageSize === "string" &&
      typeof value.prompt === "string";
  }

  if (value.kind === "garment3d") {
    return typeof value.garmentUrl === "string" &&
      typeof value.aiModel === "string" &&
      typeof value.aspectRatio === "string" &&
      typeof value.imageSize === "string" &&
      typeof value.prompt === "string" &&
      typeof value.genCount === "number";
  }

  if (value.kind === "faceSwap") {
    return typeof value.sourceUrl === "string" &&
      typeof value.faceUrl === "string" &&
      typeof value.aiModel === "string" &&
      typeof value.aspectRatio === "string" &&
      typeof value.imageSize === "string" &&
      typeof value.prompt === "string" &&
      typeof value.genCount === "number";
  }

  if (value.kind === "commerceDetail") {
    return hasStringArray(value.sourceUrls) &&
      typeof value.aiModel === "string" &&
      typeof value.aspectRatio === "string" &&
      typeof value.imageSize === "string" &&
      typeof value.prompt === "string" &&
      typeof value.genCount === "number";
  }

  if (value.kind === "productSet") {
    return hasStringArray(value.productImageUrls) &&
      typeof value.aiModel === "string" &&
      typeof value.aspectRatio === "string" &&
      typeof value.imageSize === "string" &&
      typeof value.prompt === "string" &&
      typeof value.genCount === "number";
  }

  if (value.kind === "videoImageToVideo") {
    return typeof value.imageUrl === "string" &&
      typeof value.prompt === "string" &&
      typeof value.resolution === "string" &&
      typeof value.aiModel === "string" &&
      typeof value.genCount === "number";
  }

  if (value.kind === "videoMotion") {
    return typeof value.modelImageUrl === "string" &&
      typeof value.referenceVideoUrl === "string" &&
      typeof value.resolution === "string" &&
      typeof value.aiModel === "string" &&
      typeof value.genCount === "number";
  }

  if (value.kind === "videoFirstLastFrame") {
    return typeof value.firstFrameUrl === "string" &&
      typeof value.lastFrameUrl === "string" &&
      typeof value.prompt === "string" &&
      typeof value.resolution === "string" &&
      typeof value.aiModel === "string" &&
      typeof value.genCount === "number";
  }

  return false;
}

async function writeGenerationProgress(
  supabase: ReturnType<typeof createAdminClient>,
  job: ClaimedJob,
  payload: GenerationJobPayload,
  update: GenerationProgressUpdate
) {
  const { data, error } = await supabase
    .from("generations")
    .update({
      result_urls: update.resultUrls,
      job_payload: appendResumableBatchProgress(
        appendAsyncProgress(appendPromptTrace(payload, update.promptTrace), update),
        update,
      ),
    })
    .eq("id", job.id)
    .eq("user_id", job.user_id)
    .eq("status", "processing_tryon")
    .eq("delivery_version", job.delivery_version)
    .eq("execution_token", job.execution_token)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`更新任务进度失败: ${error.message}`);
  if (!data) throw new StaleExecutionFenceError("任务执行租约已丢失");
  await syncGenerationQueueIndex(job.id, "progress");
}

function generationFence(job: ClaimedJob) {
  return {
    generationId: job.id,
    deliveryVersion: job.delivery_version,
    executionToken: job.execution_token,
  };
}

async function checkpointFromProgress(
  supabase: ReturnType<typeof createAdminClient>,
  job: ClaimedJob,
  update: GenerationProgressUpdate,
) {
  const hasResult = update.resultUrls.some(Boolean)
    || Boolean(update.moduleResults?.some((item) => Boolean(item.resultUrl)));
  const status = String(update.externalStatus || "").trim().toLowerCase();
  const phase = hasResult
    ? "result_ready" as const
    : update.externalTaskId
      ? status === "queued" || status === "submitted"
        ? "submitted" as const
        : "polling" as const
      : null;
  if (!phase) return;
  await checkpointGenerationExecution(supabase, generationFence(job), {
    phase,
    upstreamTaskId: update.externalTaskId,
    upstreamRequestId: update.externalRequestId,
    upstreamProvider: stringField(update.providerDetails, "providerId")
      || stringField(update.providerDetails, "provider"),
    upstreamDeploymentId: stringField(update.providerDetails, "deploymentId"),
    upstreamStatus: update.externalStatus,
    resultPayload: hasResult ? { resultCount: update.resultUrls.filter(Boolean).length } : undefined,
  });
}

function stringField(value: Record<string, unknown> | undefined, key: string) {
  const field = value?.[key];
  return typeof field === "string" && field.trim() ? field.trim() : undefined;
}

function appendResumableBatchProgress<T extends GenerationJobPayload>(
  payload: T,
  update: Pick<GenerationProgressUpdate, "resultUrls" | "progress" | "promptTrace">,
): T {
  const expectedCount = getExpectedResultCount(payload);
  const previous = readResumableBatchResultUrls(payload, expectedCount);
  const next = Array.from({ length: expectedCount }, (_, index) => {
    const value = update.resultUrls[index];
    return typeof value === "string" && value.trim() ? value : previous[index] || "";
  });
  return {
    ...payload,
    generationBatchProgress: {
      version: 1,
      expectedCount,
      resultUrls: next,
      updatedAt: new Date().toISOString(),
    },
  };
}

function readResumableBatchResultUrls(payload: GenerationJobPayload, expectedCount: number) {
  const state = payload.generationBatchProgress;
  if (!state || state.version !== 1 || state.expectedCount !== expectedCount) {
    return Array.from({ length: expectedCount }, () => "");
  }
  return Array.from({ length: expectedCount }, (_, index) => {
    const value = state.resultUrls[index];
    return typeof value === "string" ? value : "";
  });
}

function clearResumableBatchProgress<T extends GenerationJobPayload>(payload: T): T {
  const { generationBatchProgress: _discarded, ...rest } = payload;
  return rest as T;
}

export const __generationJobTestUtils = {
  appendResumableBatchProgress,
  readResumableBatchResultUrls,
  shouldSettlePartialResultOnRetryExhaustion,
  clearResumableBatchProgress,
  isCanonicalMediaAssetUrl,
};

function normalizePoseOutputMode(value: unknown): PoseOutputMode {
  return value === "grid" ? "grid" : "separate";
}

function getPoseGenerationCount(payload: Extract<GenerationJobPayload, { kind: "pose" }>) {
  if (payload.poseCreationMode === "reference") {
    const referenceCount = normalizePoseReferenceUrls(payload.poseReferenceUrls).length || 1;
    const copies = normalizePoseReferenceCopies(payload.poseReferenceCopies, referenceCount);
    return normalizePositiveGenerationCount(payload.genCount, referenceCount * copies);
  }
  if (normalizePoseOutputMode(payload.outputMode) !== "separate") return 1;
  const num = Number(payload.genCount || payload.poseCount || 4);
  if (!Number.isFinite(num)) return normalizePosePlanCount(payload.poseCount || 4);
  return normalizePosePlanCount(num);
}

function normalizePoseStartIndex(value: unknown) {
  const num = Number(value || 1);
  if (!Number.isFinite(num)) return 1;
  return Math.max(Math.floor(num), 1);
}

function normalizePositiveGenerationCount(value: unknown, fallback = 1) {
  const num = Number(value ?? fallback);
  if (!Number.isFinite(num)) return Math.max(1, Math.floor(Number(fallback) || 1));
  return Math.max(1, Math.floor(num));
}

function normalizeCommerceDetailSections(
  sections: CommerceDetailSectionSpec[] | undefined,
  count: number
): CommerceDetailSectionSpec[] {
  const safeCount = Math.min(Math.max(Math.floor(Number(count) || 1), 1), 8);
  const defaults = buildCommerceDetailSections(safeCount);
  return Array.from({ length: safeCount }, (_, index) => {
    const section = sections?.[index];
    return {
      ...defaults[index],
      ...(section || {}),
      title: section?.title || defaults[index].title,
      purpose: section?.purpose || defaults[index].purpose,
      template: section?.template || defaults[index].template,
      avoid: Array.isArray(section?.avoid) && section.avoid.length ? section.avoid : defaults[index].avoid,
    };
  });
}

function hasStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function getFirstRow(data: unknown): ClaimedJob | null {
  return Array.isArray(data) && data.length > 0 ? (data[0] as ClaimedJob) : null;
}

function isSeedreamPayload(payload: GenerationJobPayload) {
  return "aiModel" in payload && typeof payload.aiModel === "string" && payload.aiModel.startsWith("doubao-seedream-");
}

function isVideoPayload(payload: GenerationJobPayload): payload is Extract<GenerationJobPayload, { kind: "videoImageToVideo" | "videoMotion" | "videoFirstLastFrame" }> {
  return payload.kind === "videoImageToVideo" || payload.kind === "videoMotion" || payload.kind === "videoFirstLastFrame";
}

async function syncGenerationQueueIndex(generationId: string, phase: string) {
  try {
    await syncGenerationTaskQueueById(generationId);
  } catch (error) {
    logger.warn(`[task-queue-index] generation ${phase} sync skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

import { getAdminClient } from "@/lib/supabase/admin";

function createAdminClient() {
  return getAdminClient();
}
