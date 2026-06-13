import type { AspectRatio, ImageSize, LingyaModel } from "@/lib/api/lingya";
import type { Garment3dDisplayStyle, ModelShootStyle, PoseSeriesStyle } from "@/lib/module-style-presets";
import type { PoseOutputMode } from "@/lib/pose-prompt";
import type { PoseVisualAnalysis } from "@/lib/pose-analysis";
import type { PosePlan } from "@/lib/pose-plan";
import type { AutoDesignSettings, TryOnSceneMode } from "@/lib/tryon-scene";
import type { TryOnClothingAnalysis } from "@/lib/tryon-reference-config";
import type { TryOnReferenceAnalysis } from "@/lib/tryon-reference-analysis";
import type { TryOnAgeGroup, TryOnGarmentAudience } from "@/lib/tryon-prompt";
import type { TryOnClothingMode, TryOnClothingRole } from "@/lib/tryon-upload-rules";
import type { GrassPayloadBase } from "@/lib/grass-planting";
import type { ModelBackgroundPayloadBase } from "@/lib/model-background";
import type { MaterialEnhancementPayloadBase } from "@/lib/material-enhancement";
import type {
  ProductSetCreationMode,
  ProductSetCustomTemplate,
  ProductSetImageType,
  ProductSetModuleOverride,
  ProductSetProductProfile,
  ProductSetSettings,
} from "@/lib/product-set";
import type { AiVideoAspectRatio, AiVideoAudioMode, AiVideoDuration, AiVideoModelMode, AiVideoResolution } from "@/lib/ai-video";

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
  result_urls?: string[] | null;
  job_payload?: HistoryJobPayload | Record<string, unknown> | null;
};

export type HistoryApplyDetail<K extends HistoryJobPayload["kind"] = HistoryJobPayload["kind"]> = {
  row: HistoryApplyRow;
  payload: Extract<HistoryJobPayload, { kind: K }>;
  resultUrls: string[];
};

export function getApplyPath(kind: HistoryJobPayload["kind"], generationId?: string) {
  const path = getModulePath(kind);
  if (!generationId) return path;
  return `${path}?apply=${encodeURIComponent(generationId)}`;
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

export async function takeApplyDetail<K extends HistoryJobPayload["kind"]>(
  kind: K
): Promise<HistoryApplyDetail<K> | null> {
  if (typeof window === "undefined") return null;

  const url = new URL(window.location.href);
  const generationId = url.searchParams.get("apply");
  if (!generationId) return null;

  try {
    const detail = await fetchHistoryApplyDetail(generationId, kind);
    url.searchParams.delete("apply");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    return detail;
  } catch (error) {
    console.error("[history-apply] failed:", error);
    return null;
  }
}

function getModulePath(kind: HistoryJobPayload["kind"]) {
  if (kind === "tryon") return "/create";
  if (kind === "grass") return "/grass";
  if (kind === "modelBackground") return "/model-background";
  if (kind === "materialEnhancement") return "/material-enhancement";
  if (kind === "generalImage") return "/general-image";
  if (kind === "outfitFusion") return "/outfit-fusion";
  if (kind === "productSet") return "/product-set";
  if (kind === "garment3d") return "/garment-3d";
  if (kind === "faceSwap") return "/face-swap";
  if (kind === "videoImageToVideo") return "/video";
  if (kind === "videoMotion") return "/video/motion-control";
  if (kind === "videoFirstLastFrame") return "/video/first-last-frame";
  if (kind === "model") return "/model";
  return "/pose";
}
