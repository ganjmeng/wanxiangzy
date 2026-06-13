import { isRecord } from "@/lib/utils";
import { logger } from "@/lib/logger";
import {
  batchTryOn,
  generateImage,
  type AspectRatio,
  type ImageTaskProgress,
  type ImageSize,
  type LingyaModel,
} from "@/lib/api/lingya";
import { completeGenerationWithCreditAdjustment, failGenerationWithRefund } from "@/lib/api/credits";
import { resolveImageInputs } from "@/lib/api/image-inputs.server";
import { persistGeneratedImageUrls } from "@/lib/api/result-image-storage";
import { persistGeneratedMediaUrls } from "@/lib/api/result-media-storage";
import {
  generateHappyHorseFirstLastFrame,
  generateHappyHorseImageToVideo,
  generateHappyHorseMotionControl,
  type VideoGenerationResult,
  type VideoTaskProgress,
} from "@/lib/api/happyhorse-video";
import type { OutfitFusionHistoryAsset } from "@/lib/history-apply";
import { getOutfitFusionDisplayPrompt } from "@/lib/outfit-fusion";
import { syncGenerationTaskQueueById } from "@/lib/task-queue-store";
// Agent module is temporarily disabled; the visual quality evaluator
// (applyQualityRepairToPrompt / evaluateGeneratedImages) is stubbed locally.
// Restore the import from "@/lib/agent/brain/visual-quality" once the
// agent module is brought back from `refactor/extract-agent-module`.
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
  _quality: VisualQualityEvaluation,
): string => prompt;
const evaluateGeneratedImages = async (_args: {
  userPrompt: string;
  module: string;
  resultUrls: string[];
  expectedCount: number;
  referenceImageUrls?: string[];
}): Promise<VisualQualityEvaluation> => ({
  ok: true,
  score: 1,
  shouldRegenerate: false,
  summary: "智能视觉评估已下线，已跳过自动重生。",
  issues: [],
  source: "deterministic",
});
import {
  buildCommerceDetailSectionPrompt,
  buildCommerceDetailSections,
  normalizeCommerceDetailLayout,
  resolveCommerceDetailAspectRatio,
  type CommerceDetailLayout,
  type CommerceDetailSectionSpec,
} from "@/lib/commerce-detail-sections";
import { enforceModelPromptRequirements } from "@/lib/model-prompt";
import { buildGarmentDetailReferencePrompt, buildPoseRoleBasedPrompt, normalizeGarmentDetailUrls } from "@/lib/garment-detail-references";
import { buildSeparatePosePrompt, buildPoseHardRule, decidePoseMode, enforcePosePromptRequirements, type PoseOutputMode } from "@/lib/pose-prompt";
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
import { normalizePosePlan, type PosePlan } from "@/lib/pose-plan";
import type { TryOnAgeGroup, TryOnGarmentCategory, TryOnGarmentAudience } from "@/lib/tryon-prompt";
import type { TryOnClothingMode, TryOnClothingRole } from "@/lib/tryon-upload-rules";
import type { GrassPayloadBase } from "@/lib/grass-planting";
import type { ModelBackgroundPayloadBase } from "@/lib/model-background";
import type { MaterialEnhancementPayloadBase } from "@/lib/material-enhancement";
import { enforceFaceSwapPromptRequirements, normalizeFaceSwapSourceUrls } from "@/lib/face-swap";
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
  type ProductSetResolvedTemplate,
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
};

export type GenerationJobPayload = GenerationJobPayloadBase & (
  | {
      kind: "tryon";
      clothingUrls: string[];
      clothingMode?: TryOnClothingMode;
      clothingRoles?: TryOnClothingRole[];
      clothingAnalysis?: TryOnClothingAnalysis | null;
      garmentDetailUrls?: string[];
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
  | {
      kind: "generalImage";
      mode: "text-to-image" | "image-to-image";
      referenceUrls: string[];
      aiModel: LingyaModel;
      aspectRatio: AspectRatio;
      imageSize: ImageSize;
      prompt: string;
      genCount: number;
    }
  | {
      kind: "outfitFusion";
      mode: "text-to-image" | "image-to-image";
      referenceUrls: string[];
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
      posePlanMode?: "preset" | "ai";
      outputMode?: PoseOutputMode;
      genCount?: number;
      poseAnalysis?: PoseVisualAnalysis | null;
      posePlan?: PosePlan | null;
      garmentDetailUrls?: string[];
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
}

interface ExhaustedJob {
  id: string;
  user_id: string;
  credits_cost: number | null;
  processing_started_at: string | null;
  error_message: string | null;
}

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
  providerDetails?: Record<string, unknown>;
  failedCount?: number;
  partialError?: string;
};

type GenerationProgressUpdate = GenerationExecutionResult;
type GenerationProgressCallback = (update: GenerationProgressUpdate) => Promise<void>;

export function startGenerationJob(generationId: string) {
  runGenerationJobById(generationId).catch((err) => {
    logger.error(`[jobs] background job ${generationId} failed:`, err);
  });
}

export async function runGenerationJobById(generationId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("claim_generation_job", {
    p_generation_id: generationId,
  });

  if (error) {
    throw new Error(`任务认领失败: ${error.message}`);
  }

  const job = getFirstRow(data);
  if (!job) return { processed: 0, skipped: 1 };

  await runClaimedJob(supabase, job);
  return { processed: 1, skipped: 0 };
}

export async function runNextGenerationJobs(limit = 2) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("claim_next_generation_jobs", {
    p_limit: limit,
  });

  if (error) {
    throw new Error(`任务批量认领失败: ${error.message}`);
  }

  const jobs = Array.isArray(data) ? (data as ClaimedJob[]) : [];
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const job of jobs) {
    try {
      await runClaimedJob(supabase, job);
      results.push({ id: job.id, ok: true });
    } catch (err) {
      results.push({
        id: job.id,
        ok: false,
        error: err instanceof Error ? err.message : "任务失败",
      });
    }
  }

  const exhaustedRefunded = await refundExhaustedJobs(supabase);
  return { claimed: jobs.length, exhausted_refunded: exhaustedRefunded, results };
}

async function runClaimedJob(
  supabase: ReturnType<typeof createAdminClient>,
  job: ClaimedJob
) {
  try {
    await syncGenerationQueueIndex(job.id, "claim");
    const payload = parseJobPayload(job.job_payload);
    const partialResultUrls: string[] = [];
    const partialPromptTrace: PromptTraceItem[] = [];
    let partialModuleResults: ProductSetModuleResult[] = [];
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

    const execution = await executePayload(payload, async (update) => {
      if (update.moduleResults?.length) {
        const persistedModules = await persistModuleResults(update.moduleResults);
        const nextProgress = typeof update.progress === "number" ? update.progress : lastProgress;
        partialPromptTrace.splice(0, partialPromptTrace.length, ...update.promptTrace);
        lastProgress = Math.max(lastProgress, nextProgress);
        await writeGenerationProgress(supabase, job, payload, {
          resultUrls: compactResultUrls(partialResultUrls),
          promptTrace: partialPromptTrace,
          moduleResults: persistedModules,
          progress: lastProgress,
          externalTaskId: update.externalTaskId,
          externalRequestId: update.externalRequestId,
          externalStatus: update.externalStatus,
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

      const persistedNextUrls = hasNextRawUrls ? await persistOrderedResultUrls(nextRawUrls) : nextRawUrls;
      partialResultUrls.splice(0, partialResultUrls.length, ...persistedNextUrls);
      partialPromptTrace.splice(0, partialPromptTrace.length, ...update.promptTrace);
      lastProgress = Math.max(lastProgress, nextProgress);
      lastExternalTaskId = update.externalTaskId || lastExternalTaskId;
      lastExternalStatus = update.externalStatus || lastExternalStatus;

      await writeGenerationProgress(supabase, job, payload, {
        resultUrls: compactResultUrls(partialResultUrls),
        promptTrace: partialPromptTrace,
        moduleResults: partialModuleResults,
        progress: lastProgress,
        externalTaskId: update.externalTaskId,
        externalRequestId: update.externalRequestId,
        externalStatus: update.externalStatus,
        providerDetails: update.providerDetails,
      });
    });
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
    const finalPayload = appendGenerationSettlementMetadata(appendProductSetModuleResults(
      appendPromptTrace(appendQualityMetadata(repaired?.payload || payload, finalQuality, Boolean(repaired)), finalPromptTrace),
      finalModulePayload
    ), {
      expectedCount,
      resultCount: finalUrls.length,
      failedCount: Math.max(Number(execution.failedCount || 0), Math.max(0, expectedCount - finalUrls.length)),
      refundAmount,
      errorMessage: settlementError,
    });

    await completeGenerationRecord(supabase, job, finalUrls, finalPayload, {
      refundAmount,
      errorMessage: settlementError,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "生成失败";
    const settled = await settleFailedGenerationFromProgress(supabase, job, message);
    if (!settled) {
      await failGenerationWithRefund(supabase, {
        userId: job.user_id,
        generationId: job.id,
        amount: Number(job.credits_cost || 0),
        reason: "生成失败退还",
        errorMessage: message,
      });
      await annotateFailedGenerationPayload(supabase, job, message);
    }
    throw err;
  }
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
    jobPayload,
    creditsUsed,
    refundAmount,
    refundReason: refundAmount > 0 ? "部分生成失败退还" : "生成完成",
    errorMessage: options.errorMessage || null,
  });

  if (adjusted) return;
  if (refundAmount > 0) {
    logger.error(`[jobs] generation ${job.id} completed partially but credit adjustment rpc is unavailable; run supabase/atomic-credit-rpc.sql`);
  }

  const { data, error } = await supabase
    .from("generations")
    .update({
      status: "completed",
      result_urls: resultUrls,
      job_payload: jobPayload,
      processing_started_at: null,
      completed_at: new Date().toISOString(),
      credits_used: refundAmount > 0 ? totalCost : creditsUsed,
    })
    .eq("id", job.id)
    .eq("user_id", job.user_id)
    .neq("status", "failed")
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`更新任务结果失败: ${error.message}`);
  if (!data) {
    logger.warn(`[jobs] generation ${job.id} was no longer completable; skipped completion write`);
  } else {
    await syncGenerationQueueIndex(job.id, "complete-fallback");
  }
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
  });
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

async function executePayload(
  payload: GenerationJobPayload,
  onProgress?: GenerationProgressCallback
): Promise<GenerationExecutionResult> {
  const promptTrace: PromptTraceItem[] = [];
  const resolvePayloadImageInputs = (input: Parameters<typeof resolveImageInputs>[0]) =>
    resolveImageInputs(input, { publicBaseUrl: payload.publicBaseUrl });
  type ParallelImageRunResult = {
    resultUrl?: string;
    resultUrls?: string[];
    prompt: string;
    compiledPrompt: string;
    taskId?: string;
  };
  const executeParallelImageBatch = async (params: {
    count: number;
    concurrency?: number;
    maxAttemptsPerSlot?: number;
    promptKind: string | ((index: number) => string);
    run: (index: number, onTaskProgress: (progress: ImageTaskProgress) => Promise<void>) => Promise<ParallelImageRunResult>;
  }): Promise<GenerationExecutionResult> => {
    const expectedCount = Math.max(1, Math.floor(params.count || 1));
    const maxAttemptsPerSlot = Math.max(1, Math.floor(params.maxAttemptsPerSlot || 1));
    const resultUrlSlots: string[][] = Array.from({ length: expectedCount }, () => []);
    const traceSlots: Array<PromptTraceItem | null> = Array.from({ length: expectedCount }, () => null);
    const failures: Array<{ index: number; message: string }> = [];
    const taskProgress = Array.from({ length: expectedCount }, () => 0);
    let completedCount = 0;
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
      for (let attempt = 1; attempt <= maxAttemptsPerSlot; attempt++) {
        try {
          const result = await params.run(index, (progress) => {
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
          });
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
          lastMessage = error instanceof Error ? error.message : "image task failed";
          if (attempt < maxAttemptsPerSlot) {
            taskProgress[index] = Math.max(taskProgress[index] || 0, 5);
            await emitProgress({
              resultUrls: getSlottedResultUrls(),
              promptTrace: getCompletedPromptTrace(),
              progress: Math.min(99, Math.round(taskProgress.reduce((sum, value) => sum + value, 0) / expectedCount)),
              externalStatus: `RETRYING_${attempt + 1}`,
            });
            continue;
          }
        }
      }

      failures.push({ index, message: lastMessage });
      taskProgress[index] = 100;
      await emitProgress({
        resultUrls: getSlottedResultUrls(),
        promptTrace: getCompletedPromptTrace(),
        progress: Math.min(99, Math.round(taskProgress.reduce((sum, value) => sum + value, 0) / expectedCount)),
        externalStatus: "FAILED",
      });
    };

    const workerCount = Math.min(
      expectedCount,
      Math.max(1, Math.floor(params.concurrency || expectedCount))
    );
    let nextIndex = 0;
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < expectedCount) {
        const index = nextIndex;
        nextIndex += 1;
        await runOne(index);
      }
    }));

    await progressQueue;
    const resultUrls = getCompletedResultUrls();
    const traces = getCompletedPromptTrace();
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
    runOne: (index: number, onVideoProgress: (progress: VideoTaskProgress) => Promise<void>) => Promise<VideoGenerationResult>
  ) => {
    const expectedCount = normalizeAiVideoGenCount(payload.genCount);
    const resultUrls: string[] = [];
    let externalTaskId: string | undefined;
    let externalRequestId: string | undefined;
    let externalStatus: string | undefined;
    let providerDetails: Record<string, unknown> | undefined;

    for (let index = 0; index < expectedCount; index += 1) {
      const result = await runOne(index, async (progress) => {
        const currentUrls = progress.urls?.length ? [...resultUrls, ...progress.urls] : resultUrls;
        await onProgress?.({
          resultUrls: currentUrls,
          promptTrace,
          progress: Math.min(99, Math.round((index / expectedCount) * 100 + progress.progress / expectedCount)),
          externalTaskId: progress.taskId,
          externalRequestId: progress.requestId,
          externalStatus: progress.providerStatus || progress.status,
          providerDetails: progress.providerDetails,
        });
      });

      resultUrls.push(...result.urls);
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
        resultUrls,
        promptTrace,
        progress: Math.min(99, Math.round(((index + 1) / expectedCount) * 100)),
        externalTaskId,
        externalRequestId,
        externalStatus,
        providerDetails,
      });
    }

    return {
      resultUrls,
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
    return runVideoBatch("video:image-to-video", (_index, onVideoProgress) => generateHappyHorseImageToVideo({
      imageUrl: payload.imageUrl,
      prompt: payload.prompt,
      modelMode,
      duration: normalizeAiVideoDuration(payload.duration),
      resolution: normalizeAiVideoResolution(payload.resolution, modelMode),
      aspectRatio: normalizeAiVideoAspectRatio(payload.aspectRatio),
      audioMode,
      audioUrl: payload.audioUrl,
      audioPrompt: payload.audioPrompt,
      generateAudio: normalizeAiVideoGenerateAudio(payload.generateAudio),
      onProgress: onVideoProgress,
    }));
  }

  if (payload.kind === "videoMotion") {
    const modelMode = normalizeAiVideoModelMode(payload.modelMode, payload.kind);
    const audioMode = resolvePayloadAiVideoAudioMode(payload);
    return runVideoBatch("video:motion-control", (_index, onVideoProgress) => generateHappyHorseMotionControl({
      modelImageUrl: payload.modelImageUrl,
      referenceVideoUrl: payload.referenceVideoUrl,
      prompt: payload.prompt,
      modelMode,
      duration: normalizeAiVideoDuration(payload.duration),
      resolution: normalizeAiVideoResolution(payload.resolution, modelMode),
      aspectRatio: normalizeAiVideoAspectRatio(payload.aspectRatio),
      audioMode,
      audioUrl: payload.audioUrl,
      audioPrompt: payload.audioPrompt,
      generateAudio: normalizeAiVideoGenerateAudio(payload.generateAudio),
      onProgress: onVideoProgress,
    }));
  }

  if (payload.kind === "videoFirstLastFrame") {
    const modelMode = normalizeAiVideoModelMode(payload.modelMode, payload.kind);
    const audioMode = resolvePayloadAiVideoAudioMode(payload);
    return runVideoBatch("video:first-last-frame", (_index, onVideoProgress) => generateHappyHorseFirstLastFrame({
      firstFrameUrl: payload.firstFrameUrl,
      lastFrameUrl: payload.lastFrameUrl,
      prompt: payload.prompt,
      modelMode,
      duration: normalizeAiVideoDuration(payload.duration),
      resolution: normalizeAiVideoResolution(payload.resolution, modelMode),
      aspectRatio: normalizeAiVideoAspectRatio(payload.aspectRatio),
      audioMode,
      audioUrl: payload.audioUrl,
      audioPrompt: payload.audioPrompt,
      generateAudio: normalizeAiVideoGenerateAudio(payload.generateAudio),
      onProgress: onVideoProgress,
    }));
  }

  if (payload.kind === "tryon") {
    const referenceUrls = getTryOnPayloadReferenceUrls(payload);
    const garmentDetailUrls = normalizeGarmentDetailUrls(payload.garmentDetailUrls);
    const imageInputs = await resolvePayloadImageInputs({
      clothingUrls: payload.clothingUrls,
      modelFaceUrl: payload.modelFaceUrl || undefined,
      referenceUrls,
    });
    const garmentDetailInputs = garmentDetailUrls.length
      ? await resolvePayloadImageInputs({ clothingUrls: garmentDetailUrls })
      : { clothingUrls: [] as string[] };
    const resolvedReferenceUrls = imageInputs.referenceUrls?.length ? imageInputs.referenceUrls : [];
    const referenceAnalyses = alignTryOnReferenceAnalyses(payload.referenceAnalyses, resolvedReferenceUrls.length);
    const referenceBatchSize = Math.max(1, resolvedReferenceUrls.length);
    const perReferenceCount = Math.max(1, Math.floor(payload.genCount || 1));
    return executeParallelImageBatch({
      count: perReferenceCount * referenceBatchSize,
      concurrency: 4,
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
          garmentDetailUrls: garmentDetailInputs.clothingUrls,
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
    const sourceImages = [
      payload.sourceUrl,
      payload.modelReferenceUrl,
      payload.backgroundReferenceUrl,
    ].filter(Boolean) as string[];
    const imageInputs = await resolvePayloadImageInputs({ clothingUrls: sourceImages });

    return executeParallelImageBatch({
      count: payload.genCount,
      promptKind: "modelBackground",
      run: async (_index, onTaskProgress) => {
        const result = await generateImage({
          model: payload.aiModel,
          prompt: payload.prompt,
          prompt_kind: "modelBackground",
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

  if (payload.kind === "generalImage" || payload.kind === "outfitFusion") {
    const imageInputs = payload.mode === "image-to-image"
      ? await resolvePayloadImageInputs({ clothingUrls: payload.referenceUrls })
      : { clothingUrls: [] };

    return executeParallelImageBatch({
      count: payload.genCount,
      promptKind: payload.mode,
      run: async (_index, onTaskProgress) => {
        const result = await generateImage({
          model: payload.aiModel,
          prompt: payload.prompt,
          aspect_ratio: payload.aspectRatio,
          image: imageInputs.clothingUrls,
          smart_aspect_image: payload.referenceUrls[0],
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
    const garmentDetailUrls = normalizeGarmentDetailUrls(payload.garmentDetailUrls);
    const imageInputs = await resolvePayloadImageInputs({ clothingUrls: [payload.mainImageUrl, ...garmentDetailUrls] });
    const poseStyle = normalizePoseSeriesStyle(payload.poseStyle);
    const outputMode = normalizePoseOutputMode(payload.outputMode);
    const poseAnalysis = normalizePoseVisualAnalysis(payload.poseAnalysis);
    const posePlan = normalizePosePlan(payload.posePlan, {
      poseAnalysis,
      poseStyle,
      outputMode,
      prompt: payload.prompt,
    });
    const detailCount = Math.max(0, imageInputs.clothingUrls.length - 1);
    const poseMode = decidePoseMode({ analysis: poseAnalysis, outputMode });
    const hardRule = buildPoseHardRule({ poseMode, outputMode });
    const roleBasedPrompt = buildPoseRoleBasedPrompt({
      outputMode,
      detailCount,
      poseCount: getPoseGenerationCount(payload),
    });
    const fallbackPrompt = [
      enforcePosePromptRequirements(applyPoseSeriesStylePrompt(payload.prompt, poseStyle), {
        poseStyle,
        outputMode,
        poseAnalysis,
        posePlan,
      }),
      hardRule,
    ].filter(Boolean).join("\n");
    const garmentDetailDirective = buildGarmentDetailReferencePrompt(detailCount);
    const userIntent = (payload.prompt || "").trim();

    if (outputMode === "separate") {
      const generationCount = getPoseGenerationCount(payload);
      const aspectRatio = payload.aspectRatio || "auto";
      return executeParallelImageBatch({
        count: generationCount,
        concurrency: 2,
        maxAttemptsPerSlot: 3,
        promptKind: "pose",
        run: async (index, onTaskProgress) => {
          // CRITICAL: when the user picked a preset plan (4-pose template),
          // payload.prompt contains ALL 4 pose descriptions joined together.
          // If we forward the whole string, the image model interprets
          // "姿势1..姿势4" as a 2x2 grid request and returns a 4-pose
          // contact sheet per slot (the bug the user reported on
          // v2026.06.14-pose-mode-decide). For preset/AI plans, narrow
          // userIntent to ONLY the current slot's line + non-pose
          // supplement lines. For user_custom, keep the full intent.
          const slotIndex = index + 1;
          const scopedUserIntent = poseStyle === "user_custom"
            ? userIntent
            : scopePoseUserIntentToSlot(userIntent, slotIndex);
          const posePrompt = [
            roleBasedPrompt,
            scopedUserIntent ? `用户补充：${scopedUserIntent}` : "",
            buildSeparatePosePrompt(fallbackPrompt, slotIndex, poseStyle, payload.prompt, poseAnalysis, posePlan),
            garmentDetailDirective,
          ].filter(Boolean).join("\n");
          const result = await generateImage({
            model: payload.aiModel,
            prompt: posePrompt,
            prompt_kind: "pose",
            aspect_ratio: aspectRatio,
            image: imageInputs.clothingUrls,
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

    const posePrompt = [
      roleBasedPrompt,
      userIntent ? `用户补充：${userIntent}` : "",
      fallbackPrompt,
      garmentDetailDirective,
    ].filter(Boolean).join("\n");
    const result = await generateImage({
      model: payload.aiModel,
      prompt: posePrompt,
      prompt_kind: "pose",
      aspect_ratio: payload.aspectRatio || "auto",
      image: imageInputs.clothingUrls,
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
    const prompt = enforceFaceSwapPromptRequirements(payload.prompt);
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
    const moduleResults = targetEntries.map(({ template, index }) => createProductSetModuleResult(template, index, {
      promptVariant: settings.stylePackId || "auto",
      updatedAt: new Date().toISOString(),
    }));
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

    await runWithConcurrency(targetEntries, Math.min(3, Math.max(1, targetEntries.length)), async ({ template, index }) => {
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
          if (attempt < 2) {
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
} {
  const maybePayload = payload as unknown as { asyncTask?: unknown };
  const asyncTask = maybePayload.asyncTask;
  if (!asyncTask || typeof asyncTask !== "object") return {};
  const task = asyncTask as {
    taskId?: unknown;
    task_id?: unknown;
    requestId?: unknown;
    request_id?: unknown;
    status?: unknown;
    progress?: unknown;
    providerDetails?: unknown;
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
  };
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
  if (payload.kind === "tryon" || payload.kind === "pose" || isVideoPayload(payload)) return true;
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
  return process.env.AGENT_VISUAL_AUTO_REGENERATE_ENABLED === "true";
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
  if (payload.kind === "tryon") {
    const referenceCount = getTryOnPayloadReferenceUrls(payload).length || 1;
    return Math.max(1, Number(payload.genCount || 1)) * referenceCount;
  }
  return Math.max(1, Number((payload as { genCount?: number }).genCount || 1));
}

function getPayloadReferenceImages(payload: GenerationJobPayload) {
  if (payload.kind === "tryon") return [
    ...payload.clothingUrls,
    ...getTryOnPayloadReferenceUrls(payload),
    payload.modelFaceUrl,
    ...(Array.isArray(payload.garmentDetailUrls) ? payload.garmentDetailUrls : []),
  ].filter((url): url is string => typeof url === "string" && url.length > 0);
  if (payload.kind === "model") return [
    ...payload.referenceUrls,
    payload.hairReferenceUrl,
    payload.hairColorReferenceUrl,
  ].filter((url): url is string => typeof url === "string" && url.length > 0);
  if (payload.kind === "grass") return [payload.garmentUrl, payload.referenceUrl].filter((url): url is string => typeof url === "string" && url.length > 0);
  if (payload.kind === "modelBackground") return [payload.sourceUrl, payload.modelReferenceUrl, payload.backgroundReferenceUrl].filter((url): url is string => typeof url === "string" && url.length > 0);
  if (payload.kind === "materialEnhancement") return [payload.sourceUrl, payload.garmentUrl];
  if (payload.kind === "generalImage" || payload.kind === "outfitFusion") return payload.referenceUrls;
  if (payload.kind === "pose") return [payload.mainImageUrl, ...(Array.isArray(payload.garmentDetailUrls) ? payload.garmentDetailUrls : [])];
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

  if (value.kind === "materialEnhancement") {
    return typeof value.sourceUrl === "string" &&
      typeof value.garmentUrl === "string" &&
      typeof value.aiModel === "string" &&
      typeof value.aspectRatio === "string" &&
      typeof value.imageSize === "string" &&
      typeof value.prompt === "string" &&
      typeof value.genCount === "number";
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
  const { error } = await supabase
    .from("generations")
    .update({
      result_urls: update.resultUrls,
      job_payload: appendAsyncProgress(appendPromptTrace(payload, update.promptTrace), update),
    })
    .eq("id", job.id)
    .eq("user_id", job.user_id)
    .eq("status", "processing_tryon");

  if (error) throw new Error(`更新任务进度失败: ${error.message}`);
  await syncGenerationQueueIndex(job.id, "progress");
}

function normalizePoseOutputMode(value: unknown): PoseOutputMode {
  return value === "grid" ? "grid" : "separate";
}

function getPoseGenerationCount(payload: Extract<GenerationJobPayload, { kind: "pose" }>) {
  if (normalizePoseOutputMode(payload.outputMode) !== "separate") return 1;
  const num = Number(payload.genCount || 4);
  if (!Number.isFinite(num)) return 4;
  return Math.min(Math.max(Math.floor(num), 1), 4);
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

async function refundExhaustedJobs(supabase: ReturnType<typeof createAdminClient>) {
  const cutoffMs = Date.now() - getStaleMinutes() * 60 * 1000;
  const { data, error } = await supabase
    .from("generations")
    .select("id,user_id,credits_cost,processing_started_at,error_message")
    .eq("status", "processing_tryon")
    .gte("job_attempts", 3)
    .order("created_at", { ascending: true })
    .limit(10);

  if (error) {
    logger.error("[jobs] query exhausted jobs failed:", error.message);
    return 0;
  }

  const jobs = (Array.isArray(data) ? data : []) as ExhaustedJob[];
  const staleJobs = jobs.filter((job) => {
    if (!job.processing_started_at) return true;
    return Date.parse(job.processing_started_at) < cutoffMs;
  });

  for (const job of staleJobs) {
    await failGenerationWithRefund(supabase, {
      userId: job.user_id,
      generationId: job.id,
      amount: Number(job.credits_cost || 0),
      reason: "生成多次失败退还",
      errorMessage: job.error_message || "任务多次重试后仍未完成",
    });
  }

  return staleJobs.length;
}

function getStaleMinutes() {
  const value = Number(process.env.GENERATION_JOB_STALE_MINUTES || 45);
  if (!Number.isFinite(value)) return 45;
  return Math.min(Math.max(value, 1), 60);
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

// Narrow a multi-pose user prompt to the lines relevant to one slot.
// Preset / AI-plan prompts contain "姿势1..姿势4" descriptions joined
// together. Forwarding all of them makes the image model interpret it
// as a 2x2 grid request. Keep only the current slot's pose line and
// any non-pose supplement lines (e.g. "补充要求: ...").
// For user_custom, the caller should pass the full prompt unchanged.
export function scopePoseUserIntentToSlot(prompt: string, slotIndex: number): string {
  if (!prompt) return "";
  const lines = prompt.split("\n");
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    // Always keep the current slot's pose line
    if (new RegExp(`^姿势\\s*${slotIndex}[：:]`).test(trimmed)) return true;
    // Drop other slots' pose lines
    if (/^姿势\s*[1-4][：:]/.test(trimmed)) return false;
    // Keep everything else (supplements, style direction, etc.)
    return true;
  });
  return kept.join("\n").trim();
}
