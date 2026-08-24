import type { AspectRatio, ImageSize, LingyaModel } from "@/lib/api/lingya";
import type { Garment3dDisplayStyle, ModelShootStyle, PoseSeriesStyle } from "@/lib/module-style-presets";
import type { PoseOutputMode } from "@/lib/pose-prompt";
import type { PoseVisualAnalysis } from "@/lib/pose-analysis";
import type { PoseAngleCounts, PosePlan } from "@/lib/pose-plan";
import type { AutoDesignSettings, TryOnSceneMode } from "@/lib/tryon-scene";
import type { TryOnClothingAnalysis } from "@/lib/tryon-reference-config";
import type { TryOnReferenceAnalysis } from "@/lib/tryon-reference-analysis";
import type { TryOnAgeGroup, TryOnGarmentAudience } from "@/lib/tryon-prompt";
import type { TryOnClothingMode, TryOnClothingRole } from "@/lib/tryon-upload-rules";
import type { GarmentDetailReferenceGroup } from "@/lib/garment-detail-references";
import type { GarmentAngleReference } from "@/lib/garment-angle-references";
import type { GrassPayloadBase } from "@/lib/grass-planting";
import type { ModelBackgroundPayloadBase } from "@/lib/model-background";
import type { ImageTranslationPayloadBase } from "@/lib/image-translation";
import type { MaterialEnhancementPayloadBase } from "@/lib/material-enhancement";
import type { FaceSwapMode } from "@/lib/face-swap";
import type {
  ProductSetCreationMode,
  ProductSetCustomTemplate,
  ProductSetImageType,
  ProductSetModuleOverride,
  ProductSetProductProfile,
  ProductSetSettings,
} from "@/lib/product-set";
import type { AiVideoAspectRatio, AiVideoAudioMode, AiVideoDuration, AiVideoModelMode, AiVideoResolution } from "@/lib/ai-video";
import type { ProductRetouchMode } from "@/lib/product-retouch";

export type OutfitFusionHistoryAsset = {
  id?: string;
  role: "outfit" | "reference" | "model";
  url: string;
  name?: string;
};

export type HistoryJobPayload =
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
      modelFaceUrl?: string | null;
      referenceUrl?: string | null;
      referenceUrls?: string[];
      referenceAnalyses?: TryOnReferenceAnalysis[];
      aiModel: LingyaModel;
      aspectRatio: AspectRatio;
      imageSize: ImageSize;
      style?: string;
      rawPrompt?: string;
      sceneMode?: TryOnSceneMode;
      autoDesign?: AutoDesignSettings;
      genCount: number;
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
      poseCreationMode?: "free" | "reference";
      posePlanMode?: "preset" | "ai";
      outputMode?: PoseOutputMode;
      poseCount?: number;
      angleCounts?: PoseAngleCounts;
      genCount?: number;
      poseStartIndex?: number;
      poseAnalysis?: PoseVisualAnalysis | null;
      posePlan?: PosePlan | null;
      poseReferenceUrls?: string[];
      poseReferenceCopies?: number;
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
      regenerateIndex?: number;
      aiModel: LingyaModel;
      aspectRatio: AspectRatio;
      imageSize: ImageSize;
      prompt: string;
      genCount: number;
    }
  | {
      kind: "productRetouch";
      batchId: string;
      requestId: string;
      mode: ProductRetouchMode;
      category: string;
      variantsPerSource: number;
      expectedCount: number;
      genCount: number;
      aiModel: LingyaModel;
      aspectRatio: AspectRatio;
      imageSize: ImageSize;
      userInstruction?: string;
      skillVersion: string;
      skillContentHash: string;
      batchStatus?: string;
      completedCount?: number;
      failedCount?: number;
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
    };

export type HistoryApplyRow = {
  id?: string | null;
  status?: string | null;
  error_message?: string | null;
  result_urls?: string[] | null;
  job_payload?: HistoryJobPayload | Record<string, unknown> | null;
};

export type HistoryApplyDetail<K extends HistoryJobPayload["kind"] = HistoryJobPayload["kind"]> = {
  row: HistoryApplyRow;
  payload: Extract<HistoryJobPayload, { kind: K }>;
  resultUrls: string[];
};

type HistoryRouteSource = HistoryJobPayload["kind"] | HistoryJobPayload;

export function getApplyPath(source: HistoryRouteSource, generationId?: string) {
  const payload = typeof source === "string" ? undefined : source;
  const kind = typeof source === "string" ? source : source.kind;
  const path = getHistoryModulePath(kind, payload);
  if (!generationId) return path;
  return `${path}?apply=${encodeURIComponent(generationId)}`;
}

export function isHistoryApplyRowFailed(row?: HistoryApplyRow | null) {
  const status = String(row?.status || "").toLowerCase();
  return Boolean(status && (status.includes("fail") || status.includes("error") || status.includes("cancel")));
}

export function getHistoryApplyFailureMessage(row?: HistoryApplyRow | null, fallback = "生成失败") {
  const message = typeof row?.error_message === "string" ? row.error_message.trim() : "";
  return message || fallback;
}

export async function fetchHistoryApplyDetail<K extends HistoryJobPayload["kind"]>(
  generationId: string,
  kind?: K,
  signal?: AbortSignal
): Promise<HistoryApplyDetail<K>> {
  const res = await fetch(`/api/history?id=${encodeURIComponent(generationId)}`, {
    method: "GET",
    cache: "no-store",
    signal,
  });
  const data = await res.json().catch(() => ({})) as {
    row?: HistoryApplyRow | null;
    error?: string;
  };

  if (!res.ok || !data.row?.job_payload) {
    throw new Error(data.error || "历史参数加载失败");
  }

  const payload = data.row.job_payload as HistoryJobPayload;
  if (kind && payload.kind !== kind) {
    throw new Error("历史任务类型不匹配");
  }

  return {
    row: data.row,
    payload: payload as Extract<HistoryJobPayload, { kind: K }>,
    resultUrls: Array.isArray(data.row.result_urls)
      ? data.row.result_urls.filter((url): url is string => typeof url === "string" && url.length > 0)
      : [],
  };
}

export async function takeApplyPayload<K extends HistoryJobPayload["kind"]>(
  kind: K
): Promise<Extract<HistoryJobPayload, { kind: K }> | null> {
  if (typeof window === "undefined") return null;

  const url = new URL(window.location.href);
  const generationId = url.searchParams.get("apply");
  if (!generationId) return null;

  try {
    const res = await fetch(`/api/history?id=${encodeURIComponent(generationId)}`, {
      method: "GET",
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({})) as {
      row?: { job_payload?: HistoryJobPayload | Record<string, unknown> | null };
      error?: string;
    };

    if (!res.ok || !data.row?.job_payload) {
      throw new Error(data.error || "历史参数加载失败");
    }

    const payload = data.row.job_payload as HistoryJobPayload;
    if (payload.kind !== kind) return null;
    url.searchParams.delete("apply");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    return payload as Extract<HistoryJobPayload, { kind: K }>;
  } catch (error) {
    console.error("[history-apply] failed:", error);
    return null;
  }
}

/**
 * Fetch the history row referenced by `?apply=<id>` WITHOUT stripping the
 * URL — the caller (typically `useHistoryApply`) is responsible for stripping
 * it as the LAST step after the apply succeeds. Stripping inside the fetch
 * helper meant a fetch failure left the URL polluted AND a synchronous apply
 * throw left the URL stripped with no way to retry.
 */
export async function takeApplyDetail<K extends HistoryJobPayload["kind"]>(
  kind: K
): Promise<HistoryApplyDetail<K> | null> {
  if (typeof window === "undefined") return null;

  const url = new URL(window.location.href);
  const generationId = url.searchParams.get("apply");
  if (!generationId) return null;

  try {
    const detail = await fetchHistoryApplyDetail(generationId, kind);
    return detail;
  } catch (error) {
    console.error("[history-apply] failed:", error);
    return null;
  }
}

/**
 * Strip `?apply=<id>` from the current URL via replaceState. Called by
 * `useHistoryApply` after the apply succeeds so the URL stays intact for
 * retries on failure.
 */
export function stripApplyParamFromUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("apply")) return;
  url.searchParams.delete("apply");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function getHistoryModulePath(
  kind: HistoryJobPayload["kind"] | string,
  payload?: object,
) {
  if (kind === "tryon") return "/create";
  if (kind === "grass") return "/grass";
  if (kind === "modelBackground") return "/model-background";
  if (kind === "imageTranslation") return "/image-translation";
  if (kind === "materialEnhancement") return "/material-enhancement";
  if (kind === "generalImage") {
    return getGeneralImageHistoryMode(payload) === "image-to-image"
      ? "/general-image/image-to-image"
      : "/general-image";
  }
  if (kind === "outfitFusion") return "/outfit-fusion";
  if (kind === "productRetouch") return "/product-retouch";
  if (kind === "productSet") return "/product-set";
  if (kind === "garment3d") return "/garment-3d";
  if (kind === "faceSwap") return "/face-swap";
  if (kind === "videoImageToVideo") return "/video";
  if (kind === "videoMotion") return "/video/motion-control";
  if (kind === "videoFirstLastFrame") return "/video/first-last-frame";
  if (kind === "model") return "/model";
  if (kind === "pose") return "/pose";
  return "";
}

export function getGeneralImageHistoryMode(payload?: object) {
  if (payload && "mode" in payload && payload.mode === "image-to-image") return "image-to-image";
  if (payload && "mode" in payload && payload.mode === "text-to-image") return "text-to-image";
  if (payload && "referenceUrls" in payload && Array.isArray(payload.referenceUrls) && payload.referenceUrls.length > 0) {
    return "image-to-image";
  }
  return "text-to-image";
}
