"use client";

import type { ChangeEvent, CSSProperties, KeyboardEvent } from "react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { 
  Upload, UserRound, Image, Sparkles,
  X, Camera, ChevronRight, Wand, Loader2, ZoomIn,
  FolderOpen, CheckCircle2, XCircle,
} from "lucide-react";
import { useTryOnStore } from "@/lib/store/tryon-store";
import { createLocalImagePreview, isLikelyImageFile, MAX_FILE_SIZE, MAX_FILE_SIZE_MB, uploadImage } from "@/lib/utils";
import { setCachedProfileCredits } from "@/lib/supabase/client";
import { getCreditCost, getSupportedImageSizes, buildTryOnPrompt, isNanoBananaModel, type LingyaModel, type ImageSize, type AspectRatio } from "@/lib/api/lingya";
import { toast } from "sonner";
import { ClientPortal } from "@/components/ClientPortal";
import { ModuleHeader } from "@/components/ModuleHeader";
import { LoadingStage } from "@/components/studio/LoadingStage";
import { ErrorStage } from "@/components/studio/ErrorStage";
import { ResultImageGrid } from "@/components/ResultImageGrid";
import { StudioImagePreviewDialog } from "@/components/studio/StudioImagePreviewDialog";
import { ImgSkeleton } from "@/components/studio/ImgSkeleton";
import { StudioControlPanel } from "@/components/studio/StudioControlPanel";
import { StudioEmptyState } from "@/components/studio/StudioEmptyState";
import { StudioPageShell } from "@/components/studio/StudioPageShell";
import { StudioResultViewport, type StudioResultStatus } from "@/components/studio/StudioResultViewport";
import { StudioRunBar } from "@/components/studio/StudioRunBar";
import { StudioSection } from "@/components/studio/StudioSection";
import { StudioSegmentedControl } from "@/components/studio/StudioSegmentedControl";
import { StudioTaskRail } from "@/components/studio/StudioTaskRail";
import { StudioUploadSection } from "@/components/studio/StudioUploadSection";
import { StudioUploadTile } from "@/components/studio/StudioUploadTile";
import { useStudioAuth } from "@/components/studio/useStudioAuth";
import { useTaskSelectionSession, type TaskSelectionSession } from "@/components/studio/useTaskSelectionSession";
import { useStableFileDrag } from "@/components/studio/useStableFileDrag";
import { useTaskQueueGeneration } from "@/components/studio/useTaskQueueGeneration";
import { StudioGenerationCountSelector, StudioModelSelector, StudioOptionGrid, StudioPromptTextarea } from "@/components/studio/StudioFormControls";
import { fetchHistoryApplyDetail, takeApplyPayload, type HistoryJobPayload } from "@/lib/history-apply";
import { applyRepairPrompt } from "@/lib/generation-repair";
import { clampTaskExpectedCount, isTaskRunning, safeTaskQueueUrls, type TaskQueueItem } from "@/lib/task-queue";
import { showInsufficientCreditsToast } from "@/lib/ui/credit-copy";
import {
  AUTO_DESIGN_BACKGROUNDS,
  AUTO_DESIGN_FRAMINGS,
  AUTO_DESIGN_PLATFORMS,
  DEFAULT_AUTO_DESIGN,
  SCENE_MODE_LABELS,
  buildAutoDesignPrompt,
  normalizeAutoDesignSettings,
  type AutoDesignSettings,
  type TryOnSceneMode,
} from "@/lib/tryon-scene";
import {
  TRYON_CLOTHING_MODE_LABELS,
  TRYON_CLOTHING_ROLE_LABELS,
  TRYON_UPLOAD_RULES,
  TRYON_UPLOAD_SLOT_EXAMPLES,
  normalizeTryOnClothingMode,
  normalizeTryOnClothingRole,
  type TryOnClothingMode,
  type TryOnClothingRole,
  type TryOnRuleDemo,
  type TryOnRuleImage,
} from "@/lib/tryon-upload-rules";
import {
  TRYON_AGE_GROUP_LABELS,
  TRYON_GARMENT_AUDIENCE_LABELS,
  normalizeTryOnAgeGroup,
  normalizeTryOnGarmentAudience,
  type TryOnAgeGroup,
  type TryOnGarmentAudience,
} from "@/lib/tryon-prompt";
import {
  AGE_GROUP_OPTIONS,
  BANANA_ASPECTS,
  GARMENT_AUDIENCE_OPTIONS,
  GPT_ASPECTS,
  MODELS,
  PRESET_MODELS,
  PRESET_REFERENCES,
  SCENE_MODE_TABS,
  STYLE_PRESETS,
} from "@/lib/tryon-studio-options";
import { TRYON_CATEGORY_BY_CODE, isIntimateAnalysis, normalizeTryOnClothingAnalysis, type TryOnClothingAnalysis } from "@/lib/tryon-reference-config";
import { alignTryOnReferenceAnalyses, type TryOnReferenceAnalysis, type TryOnReferenceBodyCrop } from "@/lib/tryon-reference-analysis";
import { TryOnSourceLibraryDialog } from "@/components/tryon/TryOnSourceLibraryDialog";
import {
  ReferenceScenePicker,
  type ReferenceScenePickerTab,
} from "@/components/tryon/ReferenceScenePicker";
import { useTryOnSourceLibrary } from "@/components/tryon/useTryOnSourceLibrary";
import type { TryOnSourceLibraryItem } from "@/lib/tryon-source-library";
import { buildTryOnInputReferences } from "@/lib/tryon-input-references";
import type { TryOnInputReference } from "@/lib/tryon-input-references";
import {
  GARMENT_DETAIL_SWITCH_DESCRIPTION,
  GARMENT_DETAIL_UPLOAD_FOOTNOTE,
  MAX_GARMENT_DETAIL_IMAGES,
  normalizeGarmentDetailUrls,
} from "@/lib/garment-detail-references";
import { createGenericImagePreviewSession, type ImagePreviewAction } from "@/lib/studio-image-preview";
import type { ReferenceImage } from "@/types";

type FavoriteReference = {
  id: string;
  url: string;
  label: string;
  category: "scene" | "style" | "pose";
  is_preset: false;
  user_id: null;
};

type ReferenceSource = "preset" | "upload" | "favorite" | "history" | "template";

type SelectedReferenceImage = ReferenceImage & {
  source?: ReferenceSource;
  sceneKey?: string;
  score?: number;
  matchReasons?: string[];
  clothCategories?: string[];
  childReferences?: SelectedReferenceImage[];
  viewTags?: string[];
  cropTags?: string[];
  sceneTags?: string[];
  styleTags?: string[];
};

type ReferenceTemplate = {
  id: string;
  name: string;
  coverUrl: string;
  references: SelectedReferenceImage[];
};

type CustomReferenceUpload = {
  id: string;
  preview: string;
  label: string;
  status: "uploading" | "ready" | "error";
  url?: string;
  error?: string;
};

type ClothingAnalysisCacheEntry = {
  analysis: TryOnClothingAnalysis | null;
  source: "yunwu" | "cache" | "fallback" | "history";
  error?: string | null;
};

type ReferenceAnalysisCacheEntry = {
  analyses: TryOnReferenceAnalysis[];
  source: "yunwu" | "cache" | "fallback" | "history";
  error?: string | null;
  reasonText?: string | null;
};

const CLOTHING_ANALYSIS_CLIENT_CACHE_MIN_CONFIDENCE = 0.5;
const REFERENCE_ANALYSIS_CLIENT_CACHE_MIN_CONFIDENCE = 0.5;

const TRYON_PREVIEW_ACTIONS: ImagePreviewAction[] = [
  { kind: "download", label: "下载图片" },
  { kind: "copy", label: "复制链接" },
  { kind: "repair", label: "AI修图" },
  { kind: "aiVideo", label: "AI视频" },
  { kind: "modelBackground", label: "换背景" },
  { kind: "pose", label: "姿势裂变" },
  { kind: "productSet", label: "商品套图" },
  { kind: "regenerateAll", label: "重新创作" },
  { kind: "feedback", label: "反馈" },
];

type SystemReferenceApiItem = {
  id?: string;
  sceneKey?: string;
  name?: string;
  imageUrl?: string;
  reference?: {
    id?: string;
    url?: string;
    label?: string;
    category?: unknown;
    is_preset?: boolean;
    user_id?: string | null;
  };
  score?: number;
  matchReasons?: string[];
  clothCategories?: string[];
  childReferences?: Array<{
    id?: string;
    url?: string;
    label?: string;
    category?: unknown;
    is_preset?: boolean;
    user_id?: string | null;
    source?: unknown;
  }>;
  viewTags?: string[];
  cropTags?: string[];
  sceneTags?: string[];
  styleTags?: string[];
};

type TryOnHistoryPayload = Extract<HistoryJobPayload, { kind: "tryon" }>;

type ClothingItemState = {
  file: File;
  preview: string;
  url: string;
  role: TryOnClothingRole;
};

const CLOTHING_ROLE_ORDER: Record<TryOnClothingRole, number> = {
  upper: 0,
  lower: 1,
  single: 0,
  extra: 3,
};

const TRYON_STATUS_POLL_BASE_TIMEOUT_MS = 20 * 60 * 1000;
const TRYON_STATUS_POLL_PER_IMAGE_MS = 4 * 60 * 1000;
const TRYON_STATUS_POLL_MAX_TIMEOUT_MS = 90 * 60 * 1000;
const TRYON_STATUS_FETCH_TIMEOUT_MS = 8_000;
const TRYON_STATUS_HIDDEN_POLL_MS = 30_000;
const TRYON_STATUS_QUEUE_REFRESH_MS = 20_000;
const activeTryOnStatusWatchers = new Map<string, AbortController>();
const TRYON_FACE_MODEL_BANANA_NOTICE = "已选择模特脸时，Banana 暂不可用。建议用 GPT-Image-2 直接融合；如果想用 Banana 的换装效果，先不选模特图完成换装，再到换脸模块处理脸部。";
const MAX_TRYON_REFERENCE_IMAGES = 8;
const MAX_TRYON_OUTPUT_IMAGES = 32;
const TRYON_REFERENCE_UPLOAD_CONCURRENCY = 2;
const TRYON_REFERENCE_BODY_CROP_LABELS: Record<TryOnReferenceBodyCrop, string> = {
  full_body: "全身",
  three_quarter: "七分身",
  upper_body: "上半身",
  lower_body: "下半身局部",
  closeup: "局部特写",
  scene_only: "纯场景",
  partial_unknown: "局部未知",
};

function createPlaceholderFile(name: string) {
  return new File([], name, { type: "image/jpeg" });
}

function normalizeAssetUrl(value?: string | null) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.toLowerCase();
  } catch {
    return value.split("?")[0].trim().toLowerCase();
  }
}

function sameAssetUrl(left?: string | null, right?: string | null) {
  const normalizedLeft = normalizeAssetUrl(left);
  const normalizedRight = normalizeAssetUrl(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function findPresetModelByUrl(url?: string | null) {
  return PRESET_MODELS.find((model) => sameAssetUrl(model.image_url, url));
}

function findPresetReferenceByUrl(url?: string | null) {
  return PRESET_REFERENCES.find((reference) => sameAssetUrl(reference.url, url));
}

function uniqueReferenceImages(refs: SelectedReferenceImage[]) {
  const seen = new Set<string>();
  const unique: SelectedReferenceImage[] = [];
  for (const ref of refs) {
    if (!ref?.url || seen.has(ref.url)) continue;
    seen.add(ref.url);
    unique.push(ref);
    if (unique.length >= MAX_TRYON_REFERENCE_IMAGES) break;
  }
  return unique;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

function toPresetReference(ref: typeof PRESET_REFERENCES[number]): SelectedReferenceImage {
  return { ...ref, is_preset: true, user_id: null, source: "preset" } as SelectedReferenceImage;
}

function toSystemReference(ref: SystemReferenceApiItem): SelectedReferenceImage | null {
  const url = ref.reference?.url || ref.imageUrl;
  if (!url) return null;
  return {
    id: ref.reference?.id || ref.id || ref.sceneKey || url,
    url,
    label: ref.reference?.label || ref.name || "系统参考图",
    category: normalizeReferenceCategoryValue(ref.reference?.category),
    is_preset: ref.reference?.is_preset ?? true,
    user_id: ref.reference?.user_id ?? null,
    source: "preset",
    sceneKey: ref.sceneKey,
    score: typeof ref.score === "number" ? ref.score : undefined,
    matchReasons: Array.isArray(ref.matchReasons) ? ref.matchReasons.filter((item): item is string => typeof item === "string") : [],
    clothCategories: Array.isArray(ref.clothCategories) ? ref.clothCategories.filter((item): item is string => typeof item === "string") : [],
    childReferences: Array.isArray(ref.childReferences)
      ? ref.childReferences.map((item, index) => toSystemReferenceChild(item, `${ref.sceneKey || ref.id || "scene"}-${index + 1}`)).filter(Boolean) as SelectedReferenceImage[]
      : [],
    viewTags: normalizeStringTags(ref.viewTags),
    cropTags: normalizeStringTags(ref.cropTags),
    sceneTags: normalizeStringTags(ref.sceneTags),
    styleTags: normalizeStringTags(ref.styleTags),
  };
}

function toSystemReferenceChild(ref: NonNullable<SystemReferenceApiItem["childReferences"]>[number], fallbackId: string): SelectedReferenceImage | null {
  if (!ref?.url) return null;
  return {
    id: ref.id || fallbackId,
    url: ref.url,
    label: ref.label || "场景姿势图",
    category: normalizeReferenceCategoryValue(ref.category),
    is_preset: ref.is_preset ?? true,
    user_id: ref.user_id ?? null,
    source: "preset",
  };
}

function toFavoriteReference(ref: FavoriteReference): SelectedReferenceImage {
  return { ...ref, source: "favorite" };
}

function normalizeReferenceCategoryValue(value: unknown): FavoriteReference["category"] {
  return value === "style" || value === "pose" || value === "scene" ? value : "scene";
}

function normalizeStringTags(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim().toLowerCase() : "").filter(Boolean)
    : [];
}

function getFallbackSystemReferences() {
  return PRESET_REFERENCES.map(toPresetReference);
}

function normalizeSystemReferenceList(value: unknown) {
  return Array.isArray(value)
    ? uniqueReferenceImages(value.map((item) => toSystemReference(item as SystemReferenceApiItem)).filter(Boolean) as SelectedReferenceImage[])
    : [];
}

function getClothingAnalysisLabel(analysis: TryOnClothingAnalysis | null) {
  if (!analysis) return "";
  const categoryCode = analysis.subcategories[0] || analysis.mainCategory || "";
  const category = categoryCode ? TRYON_CATEGORY_BY_CODE.get(categoryCode) : null;
  const audienceLabel = analysis.genderType === "men" ? "男装" : analysis.genderType === "unisex" ? "通用" : "女装";
  const ageLabel = analysis.ageRange === "adult" || !analysis.ageRange ? "成人" : TRYON_AGE_GROUP_LABELS[analysis.ageRange as TryOnAgeGroup] || "成人";
  return [category?.nameZh || categoryCode, audienceLabel, ageLabel].filter(Boolean).join(" / ");
}

function getAutoClothingRoleFromAnalysis(analysis: TryOnClothingAnalysis | null): TryOnClothingRole | null {
  if (!analysis || analysis.confidence < 0.62) return null;
  const scope = analysis.slot;
  if (scope === "lower") return "lower";
  if (scope === "upper" || scope === "outer") return "upper";
  if (scope === "single" || scope === "intimate" || scope === "functional") return "single";

  const main = analysis.mainCategory;
  if (main === "bottom_pants" || main === "bottom_skirt") return "lower";
  if (main === "single_piece_top" || main === "outerwear") return "upper";
  if (main === "dress" || main === "underwear" || main === "sports_wear" || main === "functional_wear") return "single";
  return null;
}

function isCacheableClothingAnalysisEntry(entry: ClothingAnalysisCacheEntry) {
  return entry.source !== "fallback"
    && Boolean(entry.analysis)
    && (entry.analysis?.confidence || 0) >= CLOTHING_ANALYSIS_CLIENT_CACHE_MIN_CONFIDENCE;
}

function isCacheableReferenceAnalysisEntry(entry: ReferenceAnalysisCacheEntry, expectedCount: number) {
  return entry.source !== "fallback"
    && entry.analyses.length === expectedCount
    && entry.analyses.every((analysis) => analysis.confidence >= REFERENCE_ANALYSIS_CLIENT_CACHE_MIN_CONFIDENCE);
}

function getReferenceAnalysisSummary(analysis: TryOnReferenceAnalysis | null | undefined, options?: { fallback?: boolean }) {
  if (!analysis) return "";
  if (options?.fallback) return "识别不可用 / 保持原图构图";
  const parts = [TRYON_REFERENCE_BODY_CROP_LABELS[analysis.bodyCrop] || "参考图"];
  if (analysis.personVisible) {
    parts.push(analysis.faceVisible ? "露脸" : "无脸");
    if (!analysis.headVisible) parts.push("无头部");
    if (analysis.upperBodyVisible && !analysis.lowerBodyVisible) parts.push("只见上身");
    if (!analysis.upperBodyVisible && analysis.lowerBodyVisible) parts.push("只见下身");
    if (analysis.handsVisible) parts.push("手部可见");
    if (analysis.feetVisible) parts.push("脚部可见");
  } else {
    parts.push("无人像");
  }
  return parts.slice(0, 4).join(" / ");
}

function getReferenceAnalysisDetailText(analysis: TryOnReferenceAnalysis | null | undefined, options?: { fallback?: boolean; reasonText?: string | null }) {
  if (!analysis) return "";
  if (options?.fallback) return options.reasonText || "不会按兜底值判断露脸或头部";
  const details = analysis.detailFocus.slice(0, 3).join("、");
  const confidence = Math.round(analysis.confidence * 100);
  return [details ? `细节：${details}` : "", confidence ? `置信 ${confidence}%` : ""].filter(Boolean).join(" · ");
}

function buildClothingAnalysisKey(params: {
  urls: string[];
  clothingMode: TryOnClothingMode;
  clothingRoles: TryOnClothingRole[];
  garmentAudience: TryOnGarmentAudience;
  ageGroup: TryOnAgeGroup;
}) {
  return JSON.stringify({
    urls: params.urls.filter(Boolean).map((url) => normalizeAssetUrl(url) || url),
    clothingMode: params.clothingMode,
    clothingRoles: params.clothingRoles,
    garmentAudience: params.garmentAudience,
    ageGroup: params.ageGroup,
  });
}

function buildReferenceAnalysisKey(params: {
  urls: string[];
  clothingMode: TryOnClothingMode;
  clothingRoles: TryOnClothingRole[];
  garmentAudience: TryOnGarmentAudience;
  ageGroup: TryOnAgeGroup;
}) {
  return JSON.stringify({
    urls: params.urls.filter(Boolean).map((url) => normalizeAssetUrl(url) || url),
    clothingMode: params.clothingMode,
    clothingRoles: [...new Set(params.clothingRoles)].sort(),
    garmentAudience: params.garmentAudience,
    ageGroup: params.ageGroup,
  });
}

function getReferenceSceneMode(ref: SelectedReferenceImage): TryOnSceneMode {
  if (ref.source === "favorite" || ref.source === "template") return "favorites";
  if (ref.source === "upload" || ref.source === "history") return "upload_reference";
  return "system_reference";
}

function referenceBelongsToSceneMode(ref: SelectedReferenceImage, mode: TryOnSceneMode) {
  if (mode === "auto_design") return false;
  return getReferenceSceneMode(ref) === mode;
}

function coerceVisibleSceneMode(mode: TryOnSceneMode | undefined): TryOnSceneMode {
  if (mode && mode !== "system_reference") return mode;
  return "upload_reference";
}

function getSceneChildReferences(scene: SelectedReferenceImage | null) {
  if (!scene) return [];
  return uniqueReferenceImages((scene.childReferences?.length ? scene.childReferences : [scene]) as SelectedReferenceImage[]);
}

function referenceMatchesSceneFilters(ref: SelectedReferenceImage, filters: {
  view: "all" | "front" | "back";
  body: "all" | "whole" | "upper" | "lower";
  search: string;
}) {
  const haystack = [
    ref.label,
    ...(ref.viewTags || []),
    ...(ref.cropTags || []),
    ...(ref.sceneTags || []),
    ...(ref.styleTags || []),
    ...(ref.clothCategories || []),
  ].join(" ").toLowerCase();
  const search = filters.search.trim().toLowerCase();
  if (search && !haystack.includes(search)) return false;
  if (filters.view === "front" && !haystack.includes("front") && !haystack.includes("正面")) return false;
  if (filters.view === "back" && !haystack.includes("back") && !haystack.includes("背面")) return false;
  if (filters.body === "whole" && !haystack.includes("whole") && !haystack.includes("full") && !haystack.includes("全身")) return false;
  if (filters.body === "upper" && !haystack.includes("upper") && !haystack.includes("half") && !haystack.includes("上半身")) return false;
  if (filters.body === "lower" && !haystack.includes("lower") && !haystack.includes("下半身")) return false;
  return true;
}

function toHistoryReference(url: string, index = 0, source: ReferenceSource = "history"): SelectedReferenceImage {
  const preset = findPresetReferenceByUrl(url);
  if (preset) return { ...toPresetReference(preset), source };
  return {
    id: `history-reference-${index + 1}`,
    url,
    label: index > 0 ? `历史参考${index + 1}` : "历史参考",
    category: "style",
    is_preset: false,
    user_id: null,
    source,
  };
}

function getHistoryReferenceSource(sceneMode: TryOnSceneMode): ReferenceSource {
  if (sceneMode === "favorites") return "favorite";
  return "history";
}

function getHistoryReferenceUrls(payload: TryOnHistoryPayload) {
  return uniqueReferenceImages([
    ...((Array.isArray(payload.referenceUrls) ? payload.referenceUrls : [])
      .map((url, index) => typeof url === "string" && url.trim() ? toHistoryReference(url.trim(), index) : null)
      .filter(Boolean) as SelectedReferenceImage[]),
    ...(payload.referenceUrl ? [toHistoryReference(payload.referenceUrl)] : []),
  ]).map((item) => item.url);
}

function getTryOnHistoryExpectedCount(payload: TryOnHistoryPayload) {
  const referenceCount = payload.sceneMode === "auto_design" ? 1 : getHistoryReferenceUrls(payload).length || 1;
  return Math.min(MAX_TRYON_OUTPUT_IMAGES, Math.max(1, payload.genCount * referenceCount));
}

export default function CreatePage() {
  const router = useRouter();
  const store = useTryOnStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rulesButtonRef = useRef<HTMLButtonElement>(null);
  const rulesHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeGenerationRef = useRef<string | null>(null);
  const generationSubmitRef = useRef<{ id: string; controller: AbortController } | null>(null);
  const watchedGenerationIdsRef = useRef<Set<string>>(new Set());
  const statusWatcherControllersRef = useRef<Map<string, AbortController>>(new Map());
  const {
    pendingId: applyingTaskId,
    begin: beginTaskSelection,
    cancel: cancelTaskSelection,
  } = useTaskSelectionSession();
  const [genCount, setGenCount] = useState(1);

  const {
    authChecked,
    isAuthenticated,
    userId,
    credits,
    setCredits,
    refreshAuth,
  } = useStudioAuth();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingClothingRoles, setUploadingClothingRoles] = useState<TryOnClothingRole[]>([]);
  const [aiModel, setAiModel] = useState<LingyaModel>("gpt-image-2");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("auto");
  const [imageSize, setImageSize] = useState<ImageSize>("1K");
  const [customStyle, setCustomStyle] = useState("");
  const [optimizing, setOptimizing] = useState(false);
  const [promptOverride, setPromptOverride] = useState<string | null>(null);
  const [sceneMode, setSceneMode] = useState<TryOnSceneMode>("upload_reference");
  const [autoDesign, setAutoDesign] = useState<AutoDesignSettings>(DEFAULT_AUTO_DESIGN);
  const [favoriteReferences, setFavoriteReferences] = useState<FavoriteReference[]>([]);
  const [referenceTemplates, setReferenceTemplates] = useState<ReferenceTemplate[]>([]);
  const [isLoadingFavoriteReferences, setIsLoadingFavoriteReferences] = useState(false);
  const [isSavingFavoriteReference, setIsSavingFavoriteReference] = useState(false);
  const [clothingMode, setClothingMode] = useState<TryOnClothingMode>("multi");
  const [clothingRoles, setClothingRoles] = useState<TryOnClothingRole[]>([]);
  const [garmentAudience, setGarmentAudience] = useState<TryOnGarmentAudience>("women");
  const [ageGroup, setAgeGroup] = useState<TryOnAgeGroup>("adult");
  const [isIntimateGarment, setIsIntimateGarment] = useState(false);
  const [pendingClothingRole, setPendingClothingRole] = useState<TryOnClothingRole>("upper");
  const [showClothingRules, setShowClothingRules] = useState(false);
  const [rulesPopoverStyle, setRulesPopoverStyle] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  const [customModelPreview, setCustomModelPreview] = useState<string | null>(null);
  const [customRefUploads, setCustomRefUploads] = useState<CustomReferenceUpload[]>([]);
  const [isUploadingCustomModel, setIsUploadingCustomModel] = useState(false);
  const [isDraggingModel, setIsDraggingModel] = useState(false);
  const [isDraggingRef, setIsDraggingRef] = useState(false);
  const [isDraggingGarmentDetails, setIsDraggingGarmentDetails] = useState(false);
  const [garmentDetailEnabled, setGarmentDetailEnabled] = useState(false);
  const [garmentDetailUrls, setGarmentDetailUrls] = useState<string[]>([]);
  const [isUploadingGarmentDetails, setIsUploadingGarmentDetails] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeQueueTask, setActiveQueueTask] = useState<TaskQueueItem | null>(null);
  const [activeTaskReferences, setActiveTaskReferences] = useState<TryOnInputReference[]>([]);
  const taskQueue = useTaskQueueGeneration({
    module: "tryon",
    title: "服装上身",
    defaultExpectedCount: genCount,
    applyPath: "/create",
  });
  const referenceDrag = useStableFileDrag<HTMLElement>({
    isDragging: isDraggingRef,
    setDragging: setIsDraggingRef,
    stopPropagation: true,
    fileFilter: isLikelyImageFile,
    onFiles: (files) => handleCustomRefFiles(files),
  });
  const modelDrag = useStableFileDrag<HTMLElement>({
    isDragging: isDraggingModel,
    setDragging: setIsDraggingModel,
    stopPropagation: true,
    fileFilter: isLikelyImageFile,
    onFiles: (files) => handleCustomModelFile(files[0]),
  });
  const customRefInputRef = useRef<HTMLInputElement>(null);
  const customModelInputRef = useRef<HTMLInputElement>(null);
  const garmentDetailInputRef = useRef<HTMLInputElement>(null);
  const customRefUploadSeqRef = useRef(0);
  const customModelUploadSeqRef = useRef(0);
  const referenceSelectionTouchedRef = useRef(false);
  const clothingAnalysisSeqRef = useRef(0);
  const lastClothingAnalysisKeyRef = useRef("");
  const lastAutoAppliedClothingAnalysisKeyRef = useRef("");
  const referenceAnalysisSeqRef = useRef(0);
  const lastReferenceAnalysisKeyRef = useRef("");
  const clothingAnalysisCacheRef = useRef(new Map<string, ClothingAnalysisCacheEntry>());
  const clothingAnalysisInflightRef = useRef(new Map<string, Promise<ClothingAnalysisCacheEntry>>());
  const referenceAnalysisCacheRef = useRef(new Map<string, ReferenceAnalysisCacheEntry>());
  const referenceAnalysisInflightRef = useRef(new Map<string, Promise<ReferenceAnalysisCacheEntry>>());
  const sourceLibrary = useTryOnSourceLibrary({
    ensureAuthenticated: refreshAuth,
    isAuthenticated,
    onUnauthenticated: () => {
      toast.error("请先登录后使用作品库");
      router.push("/login");
    },
  });

  // 已上传的服装 URL 列表（选择后立即上传）
  const [uploadedClothingUrls, setUploadedClothingUrls] = useState<string[]>([]);
  const [clothingAnalysis, setClothingAnalysis] = useState<TryOnClothingAnalysis | null>(null);
  const [clothingAnalysisSource, setClothingAnalysisSource] = useState<"yunwu" | "cache" | "fallback" | "history" | null>(null);
  const [isAnalyzingClothing, setIsAnalyzingClothing] = useState(false);
  const [referenceAnalyses, setReferenceAnalyses] = useState<TryOnReferenceAnalysis[]>([]);
  const [referenceAnalysisKey, setReferenceAnalysisKey] = useState("");
  const [isAnalyzingReferences, setIsAnalyzingReferences] = useState(false);
  const [clothingAnalysisError, setClothingAnalysisError] = useState<string | null>(null);
  const [referenceAnalysisError, setReferenceAnalysisError] = useState<string | null>(null);
  const [referenceAnalysisSource, setReferenceAnalysisSource] = useState<"yunwu" | "cache" | "fallback" | "history" | null>(null);
  const [isLoadingSystemReferences, setIsLoadingSystemReferences] = useState(false);
  const [recommendedSystemReferences, setRecommendedSystemReferences] = useState<SelectedReferenceImage[]>(getFallbackSystemReferences().slice(0, 4));
  const [allSystemReferences, setAllSystemReferences] = useState<SelectedReferenceImage[]>(getFallbackSystemReferences());
  const [isReferenceScenePanelOpen, setIsReferenceScenePanelOpen] = useState(false);
  const [referencePanelTab, setReferencePanelTab] = useState<ReferenceScenePickerTab>("recommended");
  const [referencePanelViewFilter, setReferencePanelViewFilter] = useState<"all" | "front" | "back">("all");
  const [referencePanelBodyFilter, setReferencePanelBodyFilter] = useState<"all" | "whole" | "upper" | "lower">("all");
  const [referencePanelSearch, setReferencePanelSearch] = useState("");
  const [activeReferenceSceneUrl, setActiveReferenceSceneUrl] = useState<string | null>(null);

  // 大图预览
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const aspects = aiModel === "gpt-image-2" ? GPT_ASPECTS : BANANA_ASPECTS;
  const imageSizes = getSupportedImageSizes(aiModel, aspectRatio);
  const allSelectedReferenceImages = useMemo(() => (
    uniqueReferenceImages((store.referenceImages?.length ? store.referenceImages : store.referenceImage ? [store.referenceImage] : []) as SelectedReferenceImage[])
  ), [store.referenceImage, store.referenceImages]);
  const selectedReferenceImages = useMemo(() => (
    allSelectedReferenceImages.filter((item) => referenceBelongsToSceneMode(item, sceneMode))
  ), [allSelectedReferenceImages, sceneMode]);
  const effectiveReferenceUrls = useMemo(
    () => selectedReferenceImages.map((item) => item.url).filter(Boolean),
    [selectedReferenceImages]
  );
  const activeReferenceAnalysisKey = useMemo(() => {
    if (sceneMode === "auto_design" || !effectiveReferenceUrls.length) return "";
    return buildReferenceAnalysisKey({ urls: effectiveReferenceUrls, clothingMode, clothingRoles, garmentAudience, ageGroup });
  }, [effectiveReferenceUrls, sceneMode, clothingMode, clothingRoles, garmentAudience, ageGroup]);
  const effectiveReferenceUrl = effectiveReferenceUrls[0] || null;
  const activeGarmentDetailUrls = useMemo(
    () => garmentDetailEnabled ? normalizeGarmentDetailUrls(garmentDetailUrls) : [],
    [garmentDetailEnabled, garmentDetailUrls]
  );
  const referenceMultiplier = sceneMode === "auto_design" ? 1 : effectiveReferenceUrls.length;
  const expectedOutputCount = genCount * referenceMultiplier;
  const isUploadingCustomRef = customRefUploads.some((item) => item.status === "uploading");
  const isAuxiliaryUploading = isUploadingCustomModel || isUploadingCustomRef || isUploadingGarmentDetails;
  const isReferenceUploadPending = isUploadingCustomRef;
  const isModelUploadPending = Boolean(customModelPreview) && !store.selectedModel?.image_url;
  const isReferenceUploadBusy = isUploadingCustomRef || isReferenceUploadPending;
  const isModelUploadBusy = isUploadingCustomModel || isModelUploadPending;
  const hasModelFace = Boolean(store.selectedModel?.image_url);
  const isBananaDisabledByModelFace = hasModelFace;
  const selectableModels = MODELS.map((model) => ({
    ...model,
    disabled: isBananaDisabledByModelFace && isNanoBananaModel(model.value),
  }));
  const selectedReferenceCount = selectedReferenceImages.length;
  const visibleCustomRefUploads = customRefUploads.filter((item) => item.status === "uploading" || item.status === "error");
  const showUploadReferenceEmptyTile = sceneMode === "upload_reference" && selectedReferenceCount === 0 && visibleCustomRefUploads.length === 0;
  const resolvedAutoDesign = normalizeAutoDesignSettings(autoDesign);
  const autoDesignBackgroundOptions = resolvedAutoDesign.platform === "ecommerce_clean"
    ? AUTO_DESIGN_BACKGROUNDS.filter((item) => item.value === "white")
    : AUTO_DESIGN_BACKGROUNDS;
  const autoDesignPrompt = sceneMode === "auto_design" ? buildAutoDesignPrompt(resolvedAutoDesign) : "";
  const stylePrompt = [autoDesignPrompt, customStyle.trim()].filter(Boolean).join("\n");
  const clothingItems = store.clothingPreviews.map((preview, index) => ({
    preview,
    url: uploadedClothingUrls[index],
    role: clothingRoles[index] || (clothingMode === "multi" ? index === 0 ? "upper" : index === 1 ? "lower" : "extra" : "single"),
  })).filter((item) => item.url);
  const currentUploadRule = TRYON_UPLOAD_RULES[clothingMode];
  const upperClothing = clothingItems.find((item) => item.role === "upper");
  const lowerClothing = clothingItems.find((item) => item.role === "lower");
  const singleClothing = clothingItems[0] || null;
  const openLightbox = (src: string, alt: string) => {
    setLightboxImage({ src, alt });
  };

  const handlePreviewKeyDown = (event: KeyboardEvent, action: () => void) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    action();
  };

  const cancelRulesHide = () => {
    if (rulesHideTimerRef.current) {
      clearTimeout(rulesHideTimerRef.current);
      rulesHideTimerRef.current = null;
    }
  };

  const openRulesPopover = () => {
    cancelRulesHide();
    const rect = rulesButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(760, window.innerWidth - 32);
    const top = Math.max(16, Math.min(rect.top - 10, window.innerHeight - 360));
    const left = Math.max(16, Math.min(rect.right + 12, window.innerWidth - width - 16));
    setRulesPopoverStyle({
      top,
      left,
      maxHeight: Math.max(320, window.innerHeight - top - 16),
    });
    setShowClothingRules(true);
  };

  const scheduleRulesHide = () => {
    cancelRulesHide();
    rulesHideTimerRef.current = setTimeout(() => {
      setShowClothingRules(false);
      setRulesPopoverStyle(null);
    }, 120);
  };

  const resetScenePrompt = () => {
    setPromptOverride(null);
    store.setPromptUsed("");
  };

  const setSelectedReferences = (refs: SelectedReferenceImage[], options: { touch?: boolean; mode?: TryOnSceneMode } = {}) => {
    if (options.touch !== false) referenceSelectionTouchedRef.current = true;
    const mode = options.mode || sceneMode;
    const currentReferences = uniqueReferenceImages(
      (useTryOnStore.getState().referenceImages?.length
        ? useTryOnStore.getState().referenceImages
        : useTryOnStore.getState().referenceImage
          ? [useTryOnStore.getState().referenceImage]
          : []) as SelectedReferenceImage[]
    );
    const nextReferenceUrlKeys = new Set(refs.map((item) => normalizeAssetUrl(item.url) || item.url));
    const inactiveReferences = currentReferences.filter((item) => (
      !referenceBelongsToSceneMode(item, mode)
      && !nextReferenceUrlKeys.has(normalizeAssetUrl(item.url) || item.url)
    ));
    store.setReferenceImages(uniqueReferenceImages([...refs, ...inactiveReferences]) as ReferenceImage[]);
    resetScenePrompt();
  };

  const toggleReferenceImage = (ref: SelectedReferenceImage) => {
    const exists = selectedReferenceImages.some((item) => item.url === ref.url);
    if (exists) {
      setSelectedReferences(selectedReferenceImages.filter((item) => item.url !== ref.url));
      return;
    }
    if (selectedReferenceImages.length >= MAX_TRYON_REFERENCE_IMAGES) {
      toast.info(`参考图最多选择 ${MAX_TRYON_REFERENCE_IMAGES} 张`);
      return;
    }
    setSelectedReferences([...selectedReferenceImages, ref]);
  };

  const clearSelectedReferences = () => {
    referenceSelectionTouchedRef.current = true;
    customRefUploadSeqRef.current += 1;
    setSelectedReferences([], { touch: false });
    setCustomRefUploads([]);
    resetScenePrompt();
  };

  const applyReferenceTemplate = (template: ReferenceTemplate) => {
    setSelectedReferences(template.references);
    toast.success(`已套用${template.name}`);
  };

  const switchSceneMode = (mode: TryOnSceneMode) => {
    if (isUploadingCustomRef) {
      toast.info("参考图上传中，请稍候");
      return false;
    }
    const isChangingSource = mode !== sceneMode;
    setSceneMode(mode);
    resetScenePrompt();

    if (mode === "auto_design") {
      referenceSelectionTouchedRef.current = true;
      return true;
    }

    if (isChangingSource) {
      referenceSelectionTouchedRef.current = true;
    }

    return true;
  };

  const updateGarmentAudience = (value: TryOnGarmentAudience) => {
    setGarmentAudience(value);
    setPromptOverride(null);
    store.setPromptUsed("");
  };

  const updateAgeGroup = (value: TryOnAgeGroup) => {
    if (value !== "adult" && isIntimateGarment) {
      setIsIntimateGarment(false);
      toast.info("内衣/泳衣类服装仅支持成人模特，已关闭该选项");
    }
    setAgeGroup(value);
    setPromptOverride(null);
    store.setPromptUsed("");
  };

  const updateIntimateGarment = (checked: boolean) => {
    if (checked && ageGroup !== "adult") {
      toast.error("内衣/泳衣类服装仅支持成人模特，请先将年龄段改为成人");
      return;
    }
    setIsIntimateGarment(checked);
    setPromptOverride(null);
    store.setPromptUsed("");
  };

  const saveSelectedReferenceTemplate = async () => {
    if (!isAuthenticated && !(await refreshAuth())) {
      toast.error("请先登录后收藏");
      router.push("/login");
      return;
    }
    if (!selectedReferenceImages.length) {
      toast.error("请先选择参考图");
      return;
    }

    setIsSavingFavoriteReference(true);
    try {
      const res = await fetch("/api/tryon/reference-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `参考模板 ${selectedReferenceImages.length} 张`,
          references: selectedReferenceImages.map((item) => ({
            id: item.id,
            url: item.url,
            label: item.label,
            category: normalizeReferenceCategory(item.category),
            source: item.source || (item.is_preset ? "preset" : "upload"),
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "收藏模板失败");

      const template = normalizeReferenceTemplate(data.template);
      if (!template) throw new Error("模板数据异常");
      setReferenceTemplates((prev) => [
        template,
        ...prev.filter((item) => item.id !== template.id),
      ].slice(0, 24));
      toast.success("已收藏为参考模板");
    } catch (err: any) {
      toast.error(err?.message || "收藏模板失败");
    } finally {
      setIsSavingFavoriteReference(false);
    }
  };

  const removeFavoriteReference = async (id: string) => {
    const removed = favoriteReferences.find((item) => item.id === id);
    if (!removed) return;
    setFavoriteReferences((prev) => prev.filter((item) => item.id !== id));
    if (selectedReferenceImages.some((item) => item.url === removed.url)) {
      setSelectedReferences(selectedReferenceImages.filter((item) => item.url !== removed.url));
    }
    try {
      const res = await fetch(`/api/tryon/reference-favorites/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "删除失败");
      toast.success("已移除收藏");
    } catch (err: any) {
      setFavoriteReferences((prev) => [removed, ...prev].slice(0, 24));
      toast.error(err?.message || "删除失败");
    }
  };

  function normalizeFavoriteReference(value: unknown): FavoriteReference | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.url !== "string") return null;
    return {
      id: record.id,
      url: record.url,
      label: typeof record.label === "string" && record.label.trim() ? record.label : "收藏参考图",
      category: normalizeReferenceCategory(record.category),
      is_preset: false,
      user_id: null,
    };
  }

  function normalizeReferenceTemplate(value: unknown): ReferenceTemplate | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (typeof record.id !== "string") return null;
    const references = Array.isArray(record.references)
      ? uniqueReferenceImages(record.references.map((item, index) => {
        if (!item || typeof item !== "object") return null;
        const ref = item as Record<string, unknown>;
        if (typeof ref.url !== "string" || !ref.url.trim()) return null;
        return {
          id: typeof ref.id === "string" && ref.id.trim() ? ref.id : `template-${record.id}-${index}`,
          url: ref.url.trim(),
          label: typeof ref.label === "string" && ref.label.trim() ? ref.label : `参考图${index + 1}`,
          category: normalizeReferenceCategory(ref.category),
          is_preset: ref.source === "preset",
          user_id: null,
          source: "template",
        } as SelectedReferenceImage;
      }).filter(Boolean) as SelectedReferenceImage[])
      : [];
    if (!references.length) return null;
    return {
      id: record.id,
      name: typeof record.name === "string" && record.name.trim() ? record.name : `参考模板 ${references.length} 张`,
      coverUrl: typeof record.coverUrl === "string" && record.coverUrl ? record.coverUrl : references[0].url,
      references,
    };
  }

  function normalizeReferenceCategory(value: unknown): FavoriteReference["category"] {
    return normalizeReferenceCategoryValue(value);
  }

  useEffect(() => {
    return () => cancelRulesHide();
  }, []);

  useEffect(() => {
    return () => {
      generationSubmitRef.current?.controller.abort();
      generationSubmitRef.current = null;
      statusWatcherControllersRef.current.forEach((controller) => controller.abort());
      statusWatcherControllersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!authChecked) return;
    if (!isAuthenticated) {
      setFavoriteReferences([]);
      setReferenceTemplates([]);
      setIsLoadingFavoriteReferences(false);
      return;
    }

    setIsLoadingFavoriteReferences(true);
    Promise.all([
      fetch("/api/tryon/reference-favorites").then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "收藏加载失败");
        return Array.isArray(data.favorites)
          ? data.favorites.map(normalizeFavoriteReference).filter(Boolean) as FavoriteReference[]
          : [];
      }),
      fetch("/api/tryon/reference-templates").then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "参考模板加载失败");
        return Array.isArray(data.templates)
          ? data.templates.map(normalizeReferenceTemplate).filter(Boolean) as ReferenceTemplate[]
          : [];
      }),
    ])
      .then(([favorites, templates]) => {
        if (cancelled) return;
        setFavoriteReferences(favorites.slice(0, 24));
        setReferenceTemplates(templates.slice(0, 24));
      })
      .catch((err: any) => {
        if (!cancelled) toast.error(err?.message || "收藏加载失败");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingFavoriteReferences(false);
      });

    return () => { cancelled = true; };
  }, [authChecked, isAuthenticated]);

  useEffect(() => {
    const urls = uploadedClothingUrls.filter(Boolean);
    if (!urls.length) {
      lastClothingAnalysisKeyRef.current = "";
      lastAutoAppliedClothingAnalysisKeyRef.current = "";
      clothingAnalysisSeqRef.current += 1;
      setClothingAnalysis(null);
      setClothingAnalysisSource(null);
      setClothingAnalysisError(null);
      setIsAnalyzingClothing(false);
      setIsLoadingSystemReferences(false);
      setRecommendedSystemReferences(getFallbackSystemReferences().slice(0, 4));
      setAllSystemReferences(getFallbackSystemReferences());
      return;
    }

    const analysisKey = buildClothingAnalysisKey({ urls, clothingMode, clothingRoles, garmentAudience, ageGroup });
    if (lastClothingAnalysisKeyRef.current === analysisKey) return;
    lastClothingAnalysisKeyRef.current = analysisKey;
    const seq = clothingAnalysisSeqRef.current + 1;
    clothingAnalysisSeqRef.current = seq;

    const cachedAnalysis = clothingAnalysisCacheRef.current.get(analysisKey);
    if (cachedAnalysis) {
      if (isCacheableClothingAnalysisEntry(cachedAnalysis)) {
        setClothingAnalysis(cachedAnalysis.analysis);
        setClothingAnalysisSource(cachedAnalysis.source);
        setClothingAnalysisError(cachedAnalysis.error || null);
        setIsAnalyzingClothing(false);
        setIsLoadingSystemReferences(false);
        return;
      }
      clothingAnalysisCacheRef.current.delete(analysisKey);
    }

    const run = async () => {
      setIsAnalyzingClothing(true);
      setIsLoadingSystemReferences(false);
      setClothingAnalysisError(null);
      try {
        let request = clothingAnalysisInflightRef.current.get(analysisKey);
        if (!request) {
          const nextRequest = fetch("/api/tryon/analyze-clothing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clothing_urls: urls,
              clothing_mode: clothingMode,
              clothing_roles: clothingRoles,
              garment_audience: garmentAudience,
              age_group: ageGroup,
            }),
          }).then(async (analysisRes) => {
            const analysisData = await analysisRes.json().catch(() => ({}));
            if (!analysisRes.ok) throw new Error(analysisData.error || "服装识别失败");
            const nextAnalysis = analysisData.analysis as TryOnClothingAnalysis;
            const nextSource: "yunwu" | "cache" | "fallback" = analysisData.source === "fallback"
              ? "fallback"
              : analysisData.cached ? "cache" : "yunwu";
            return {
              analysis: nextAnalysis,
              source: nextSource,
              error: null,
            };
          });
          clothingAnalysisInflightRef.current.set(analysisKey, nextRequest);
          void nextRequest.finally(() => {
            if (clothingAnalysisInflightRef.current.get(analysisKey) === nextRequest) {
              clothingAnalysisInflightRef.current.delete(analysisKey);
            }
          }).catch(() => undefined);
          request = nextRequest;
        }

        const nextEntry = await request;
        if (isCacheableClothingAnalysisEntry(nextEntry)) {
          clothingAnalysisCacheRef.current.set(analysisKey, nextEntry);
        } else {
          clothingAnalysisCacheRef.current.delete(analysisKey);
        }
        if (clothingAnalysisSeqRef.current !== seq) return;
        const nextAnalysis = nextEntry.analysis;
        setClothingAnalysis(nextAnalysis);
        setClothingAnalysisSource(nextEntry.source);
        setClothingAnalysisError(nextEntry.error || null);
        const autoRole = getAutoClothingRoleFromAnalysis(nextAnalysis);
        const autoMode: TryOnClothingMode | null = autoRole ? autoRole === "single" ? "single" : "multi" : null;
        const autoApplyKey = JSON.stringify({ urls, autoRole, autoMode, intimate: isIntimateAnalysis(nextAnalysis) });
        const hasUserSelectedRole = clothingRoles.some((role) => role === "upper" || role === "lower" || role === "single");
        if (!hasUserSelectedRole && urls.length === 1 && autoRole && autoMode && lastAutoAppliedClothingAnalysisKeyRef.current !== autoApplyKey) {
          lastAutoAppliedClothingAnalysisKeyRef.current = autoApplyKey;
          if (autoMode !== clothingMode) setClothingMode(autoMode);
          setPendingClothingRole(autoRole);
          setClothingRoles([autoRole]);
          toast.info(`已识别为${TRYON_CLOTHING_ROLE_LABELS[autoRole]}，自动切换上传分类`);
        }
        if (isIntimateAnalysis(nextAnalysis) && !isIntimateGarment) {
          if (ageGroup !== "adult") {
            setAgeGroup("adult");
            toast.info("识别为内衣/泳衣类服装，已切换为成人安全规则");
          }
          setIsIntimateGarment(true);
        }
      } catch (err: any) {
        if (clothingAnalysisSeqRef.current !== seq) return;
        const message = err?.message || "服装识别失败，已按当前上传分类继续";
        setClothingAnalysis(null);
        setClothingAnalysisSource(null);
        setClothingAnalysisError(message);
        setRecommendedSystemReferences(getFallbackSystemReferences().slice(0, 4));
        setAllSystemReferences(getFallbackSystemReferences());
        if (message && !String(message).includes("请先登录")) {
          toast.info("服装识别失败，已按当前上传分类继续");
        }
      } finally {
        if (clothingAnalysisSeqRef.current === seq) {
          setIsAnalyzingClothing(false);
          setIsLoadingSystemReferences(false);
        }
      }
    };

    void run();
  }, [uploadedClothingUrls, clothingMode, clothingRoles, garmentAudience, ageGroup, isIntimateGarment]);

  useEffect(() => {
    const urls = effectiveReferenceUrls.filter(Boolean);
    if (!activeReferenceAnalysisKey) {
      lastReferenceAnalysisKeyRef.current = "";
      referenceAnalysisSeqRef.current += 1;
      setReferenceAnalyses((prev) => prev.length ? [] : prev);
      setReferenceAnalysisKey("");
      setIsAnalyzingReferences((prev) => prev ? false : prev);
      setReferenceAnalysisError(null);
      setReferenceAnalysisSource(null);
      return;
    }

    const analysisKey = activeReferenceAnalysisKey;
    if (lastReferenceAnalysisKeyRef.current === analysisKey) return;
    lastReferenceAnalysisKeyRef.current = analysisKey;
    const seq = referenceAnalysisSeqRef.current + 1;
    referenceAnalysisSeqRef.current = seq;
    setReferenceAnalyses((prev) => prev.length ? [] : prev);
    setReferenceAnalysisKey("");
    setReferenceAnalysisSource(null);

    const cachedAnalysis = referenceAnalysisCacheRef.current.get(analysisKey);
    if (cachedAnalysis) {
      if (isCacheableReferenceAnalysisEntry(cachedAnalysis, urls.length)) {
        const cachedAnalyses = alignTryOnReferenceAnalyses(cachedAnalysis.analyses, urls.length);
        setReferenceAnalyses(cachedAnalyses);
        setReferenceAnalysisKey(analysisKey);
        setReferenceAnalysisSource(cachedAnalysis.source);
        setReferenceAnalysisError(cachedAnalysis.error || null);
        setIsAnalyzingReferences(false);
        return;
      }
      referenceAnalysisCacheRef.current.delete(analysisKey);
    }

    const run = async () => {
      setIsAnalyzingReferences(true);
      setReferenceAnalysisError(null);
      try {
        let request = referenceAnalysisInflightRef.current.get(analysisKey);
        if (!request) {
          const nextRequest = fetch("/api/tryon/analyze-references", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              reference_urls: urls,
              clothing_mode: clothingMode,
              clothing_roles: clothingRoles,
              garment_audience: garmentAudience,
              age_group: ageGroup,
            }),
          }).then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "参考图识别失败");
            const nextAnalyses = alignTryOnReferenceAnalyses(data.analyses, urls.length);
            const nextSource: "yunwu" | "cache" | "fallback" = data.source === "fallback"
              ? "fallback"
              : data.cached ? "cache" : "yunwu";
            const reasonText = typeof data.reasonText === "string" && data.reasonText.trim()
              ? data.reasonText.trim()
              : null;
            const nextError = nextSource === "fallback" ? reasonText || "参考图识别未成功，已按原图构图保守处理" : null;
            return {
              analyses: nextAnalyses,
              source: nextSource,
              error: nextError,
              reasonText,
            };
          });
          referenceAnalysisInflightRef.current.set(analysisKey, nextRequest);
          void nextRequest.finally(() => {
            if (referenceAnalysisInflightRef.current.get(analysisKey) === nextRequest) {
              referenceAnalysisInflightRef.current.delete(analysisKey);
            }
          }).catch(() => undefined);
          request = nextRequest;
        }

        const nextEntry = await request;
        if (isCacheableReferenceAnalysisEntry(nextEntry, urls.length)) {
          referenceAnalysisCacheRef.current.set(analysisKey, nextEntry);
        } else {
          referenceAnalysisCacheRef.current.delete(analysisKey);
        }
        if (referenceAnalysisSeqRef.current !== seq) return;
        setReferenceAnalyses(nextEntry.analyses);
        setReferenceAnalysisKey(analysisKey);
        setReferenceAnalysisSource(nextEntry.source);
        setReferenceAnalysisError(nextEntry.error || null);
      } catch (err: any) {
        if (referenceAnalysisSeqRef.current !== seq) return;
        const fallbackAnalyses = alignTryOnReferenceAnalyses([], urls.length);
        setReferenceAnalyses(fallbackAnalyses);
        setReferenceAnalysisKey(analysisKey);
        setReferenceAnalysisSource("fallback");
        setReferenceAnalysisError(err?.message || "参考图识别失败，已按原参考图继续");
      } finally {
        if (referenceAnalysisSeqRef.current === seq) setIsAnalyzingReferences(false);
      }
    };

    void run();
  }, [activeReferenceAnalysisKey, effectiveReferenceUrls, clothingMode, clothingRoles, garmentAudience, ageGroup]);

  useEffect(() => {
    if (!aspects.find(a => a.value === aspectRatio)) setAspectRatio("auto");
    const nextImageSizes = getSupportedImageSizes(aiModel, aspectRatio);
    if (!nextImageSizes.includes(imageSize)) setImageSize(nextImageSizes[0]);
  }, [aiModel, aspectRatio, imageSize]);

  useEffect(() => {
    if (!hasModelFace || !isNanoBananaModel(aiModel)) return;
    setAiModel("gpt-image-2");
    toast.info(TRYON_FACE_MODEL_BANANA_NOTICE);
  }, [aiModel, hasModelFace]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
    const payload = await takeApplyPayload("tryon");
    if (cancelled || !payload) return;

    const files = payload.clothingUrls.map((_, index) =>
      new File([], `history-clothing-${index + 1}.jpg`, { type: "image/jpeg" })
    );
    store.setClothing(files, payload.clothingUrls);
    setUploadedClothingUrls(payload.clothingUrls);
    const historyGarmentDetailUrls = normalizeGarmentDetailUrls(payload.garmentDetailUrls);
    setGarmentDetailUrls(historyGarmentDetailUrls);
    setGarmentDetailEnabled(historyGarmentDetailUrls.length > 0);
    const nextClothingMode = normalizeTryOnClothingMode(payload.clothingMode || (payload.clothingUrls.length > 1 ? "multi" : "single"));
    setClothingMode(nextClothingMode);
    const nextClothingRoles = payload.clothingUrls.map((_, index) => normalizeTryOnClothingRole(
      payload.clothingRoles?.[index],
      nextClothingMode === "multi" ? index === 0 ? "upper" : index === 1 ? "lower" : "extra" : "single"
    ));
    setClothingRoles(nextClothingRoles);
    const nextGarmentAudience = normalizeTryOnGarmentAudience(payload.garmentAudience);
    const nextAgeGroup = normalizeTryOnAgeGroup(payload.ageGroup);
    setGarmentAudience(nextGarmentAudience);
    setAgeGroup(nextAgeGroup);
    const historyClothingAnalysis = payload.clothingAnalysis
      ? normalizeTryOnClothingAnalysis(payload.clothingAnalysis)
      : null;
    const historyClothingAnalysisKey = buildClothingAnalysisKey({
      urls: payload.clothingUrls,
      clothingMode: nextClothingMode,
      clothingRoles: nextClothingRoles,
      garmentAudience: nextGarmentAudience,
      ageGroup: nextAgeGroup,
    });
    if (historyClothingAnalysis) {
      lastClothingAnalysisKeyRef.current = historyClothingAnalysisKey;
      clothingAnalysisCacheRef.current.set(historyClothingAnalysisKey, {
        analysis: historyClothingAnalysis,
        source: "history",
        error: null,
      });
      setClothingAnalysis(historyClothingAnalysis);
      setClothingAnalysisSource("history");
      setClothingAnalysisError(null);
      setIsAnalyzingClothing(false);
    } else {
      lastClothingAnalysisKeyRef.current = "";
      setClothingAnalysis(null);
      setClothingAnalysisSource(null);
      setClothingAnalysisError(null);
    }
    if (payload.modelFaceUrl) {
      const presetModel = findPresetModelByUrl(payload.modelFaceUrl);
      if (presetModel) {
        setCustomModelPreview(null);
        store.setSelectedModel({ ...presetModel, is_preset: true, user_id: null });
      } else {
        setCustomModelPreview(payload.modelFaceUrl);
        store.setSelectedModel({
          id: "history-model",
          name: "历史模特",
          image_url: payload.modelFaceUrl,
          gender: "female",
          is_preset: false,
          user_id: null,
        });
      }
    } else {
      setCustomModelPreview(null);
      store.setSelectedModel(null);
    }
    const historyReferenceUrls = getHistoryReferenceUrls(payload);
    const appliedSceneMode = coerceVisibleSceneMode(payload.sceneMode);
    const historyReferenceSource = getHistoryReferenceSource(appliedSceneMode);
    const historyReferences = historyReferenceUrls.map((url, index) => toHistoryReference(url, index, historyReferenceSource));
    setCustomRefUploads([]);
    referenceSelectionTouchedRef.current = historyReferences.length > 0;
    store.setReferenceImages(appliedSceneMode === "auto_design" ? [] : historyReferences as ReferenceImage[]);
    setSceneMode(appliedSceneMode);
    const historyReferenceAnalyses = alignTryOnReferenceAnalyses(payload.referenceAnalyses, historyReferenceUrls.length);
    const historyReferenceAnalysisKey = buildReferenceAnalysisKey({
      urls: appliedSceneMode === "auto_design" ? [] : historyReferenceUrls,
      clothingMode: nextClothingMode,
      clothingRoles: nextClothingRoles,
      garmentAudience: nextGarmentAudience,
      ageGroup: nextAgeGroup,
    });
    if (appliedSceneMode !== "auto_design" && historyReferenceAnalyses.length) {
      lastReferenceAnalysisKeyRef.current = historyReferenceAnalysisKey;
      referenceAnalysisCacheRef.current.set(historyReferenceAnalysisKey, {
        analyses: historyReferenceAnalyses,
        source: "history",
        error: null,
      });
      setReferenceAnalyses(historyReferenceAnalyses);
      setReferenceAnalysisKey(historyReferenceAnalysisKey);
      setReferenceAnalysisSource("history");
      setReferenceAnalysisError(null);
      setIsAnalyzingReferences(false);
    } else {
      lastReferenceAnalysisKeyRef.current = "";
      setReferenceAnalyses([]);
      setReferenceAnalysisKey("");
      setReferenceAnalysisSource(null);
      setReferenceAnalysisError(null);
    }
    setAutoDesign(normalizeAutoDesignSettings(payload.autoDesign || DEFAULT_AUTO_DESIGN));
    setAiModel(payload.aiModel);
    setAspectRatio(payload.aspectRatio);
    setImageSize(payload.imageSize);
    setGenCount(payload.genCount);
    setCustomStyle(payload.style || "");
    setPromptOverride(null);
    store.setPromptUsed("");
    setActiveTaskReferences(buildTryOnInputReferences({
      clothingUrls: payload.clothingUrls,
      clothingMode: nextClothingMode,
      clothingRoles: nextClothingRoles,
      referenceUrls: appliedSceneMode === "auto_design" ? [] : historyReferenceUrls,
      modelFaceUrl: payload.modelFaceUrl,
      garmentDetailUrls: historyGarmentDetailUrls,
    }));
    toast.success("已套用历史参数");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const costPerImage = getCreditCost(aiModel, imageSize, aspectRatio);
  const totalCost = costPerImage * expectedOutputCount;
  const promptPreview = buildTryOnPrompt({
    clothingCount: store.clothingFiles.length || 1,
    clothingMode,
    clothingRoles,
    clothingAnalysis,
    garmentAudience,
    ageGroup,
    aspectRatio,
    hasModelFace: !!store.selectedModel,
    hasReference: effectiveReferenceUrls.length > 0,
    referenceAnalysis: referenceAnalyses[0] || null,
    style: stylePrompt || undefined,
  });
  const finalPrompt = promptOverride ?? (store.promptUsed || promptPreview.prompt);

  // ---- 智能优化提示词 ----
  const handleOptimizePrompt = async () => {
    if (!customStyle.trim()) { toast.error("请先输入风格描述"); return; }
    setOptimizing(true);
    try {
      const res = await fetch("/api/optimize-prompt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style: customStyle }),
      });
      const data = await res.json();
      if (data.optimized) { setCustomStyle(data.optimized); toast.success("提示词已优化"); }
    } catch { toast.error("优化失败"); }
    setOptimizing(false);
  };

  const applyClothingItems = (items: ClothingItemState[]) => {
    const sortedItems = [...items].sort((a, b) => CLOTHING_ROLE_ORDER[a.role] - CLOTHING_ROLE_ORDER[b.role]);
    store.setClothing(sortedItems.map((item) => item.file), sortedItems.map((item) => item.preview));
    setUploadedClothingUrls(sortedItems.map((item) => item.url));
    setClothingRoles(sortedItems.map((item) => item.role));
    setPromptOverride(null);
    store.setPromptUsed("");
  };

  const getCurrentClothingItemStates = (): ClothingItemState[] => store.clothingPreviews
    .map((preview, index) => ({
      file: store.clothingFiles[index] || createPlaceholderFile(`clothing-${index + 1}.jpg`),
      preview,
      url: uploadedClothingUrls[index],
      role: clothingRoles[index] || (clothingMode === "multi" ? index === 0 ? "upper" : index === 1 ? "lower" : "extra" : "single"),
    }))
    .filter((item) => item.url);

  const switchClothingMode = (mode: TryOnClothingMode) => {
    if (isUploading) {
      toast.info("图片上传中，请稍候再切换模式");
      return;
    }
    if (mode === clothingMode) return;
    setClothingMode(mode);
    setPendingClothingRole(mode === "multi" ? "upper" : "single");
    applyClothingItems([]);
  };

  const openClothingPicker = (role: TryOnClothingRole) => {
    setPendingClothingRole(role);
    fileInputRef.current?.click();
  };

  const applySourceLibraryItem = (item: TryOnSourceLibraryItem) => {
    if (!sourceLibrary.role) return;

    const nextRole = clothingMode === "single" ? "single" : sourceLibrary.role;
    const retainedItems = clothingMode === "single"
      ? []
      : getCurrentClothingItemStates().filter((current) => current.role !== nextRole);
    applyClothingItems([
      ...retainedItems,
      {
        file: createPlaceholderFile(`library-${item.generationId}-${Date.now()}.jpg`),
        preview: item.url,
        url: item.url,
        role: nextRole,
      },
    ]);
    sourceLibrary.close();
    toast.success(`已从作品库加入${TRYON_CLOTHING_ROLE_LABELS[nextRole] || "服装"}`);
  };

  const applyRuleDemo = (demo: TryOnRuleDemo) => {
    if (isUploading) return;
    const nextMode: TryOnClothingMode = demo.images.length > 1 ? "multi" : "single";
    setClothingMode(nextMode);
    setPendingClothingRole(nextMode === "multi" ? "upper" : "single");
    applyClothingItems(demo.images.map((image) => ({
      file: createPlaceholderFile(`demo-${image.role}.jpg`),
      preview: image.url,
      url: image.url,
      role: image.role,
    })));
    setShowClothingRules(false);
    setRulesPopoverStyle(null);
    toast.success(`已套用${demo.title}`);
  };

  const applyRuleImage = (image: TryOnRuleImage) => {
    if (isUploading) return;
    const nextMode: TryOnClothingMode = image.role === "single" ? "single" : "multi";
    const retainedItems = nextMode === "multi" && clothingMode === "multi"
      ? getCurrentClothingItemStates().filter((current) => current.role !== image.role && current.role !== "single")
      : [];

    setClothingMode(nextMode);
    setPendingClothingRole(image.role === "single" ? "single" : image.role);
    applyClothingItems([
      ...retainedItems,
      {
        file: createPlaceholderFile(`demo-${image.role}.jpg`),
        preview: image.url,
        url: image.url,
        role: image.role,
      },
    ]);
    toast.success(`已套用${image.title}`);
  };

  const applyReferenceExample = (image: { url: string; title: string }) => {
    if (isReferenceUploadBusy) {
      toast.info("参考图上传中，请稍候");
      return;
    }
    const uploadReferences = allSelectedReferenceImages.filter((item) => referenceBelongsToSceneMode(item, "upload_reference"));
    if (uploadReferences.some((item) => item.url === image.url)) {
      toast.info("这张参考图已在上传参考里");
      setSceneMode("upload_reference");
      return;
    }
    if (uploadReferences.length >= MAX_TRYON_REFERENCE_IMAGES) {
      toast.info(`参考图最多选择 ${MAX_TRYON_REFERENCE_IMAGES} 张`);
      return;
    }
    setSceneMode("upload_reference");
    setSelectedReferences([
      ...uploadReferences,
      {
        id: `reference-demo-${image.url}`,
        url: image.url,
        label: image.title,
        category: "style",
        is_preset: true,
        user_id: null,
        source: "upload",
      },
    ], { mode: "upload_reference" });
    toast.success(`已套用${image.title}`);
  };

  // ---- 文件处理：选择后立即上传到图床 ----
  const processFiles = async (files: FileList | File[], targetRole: TryOnClothingRole = pendingClothingRole) => {
    if (isUploading) {
      toast.info("图片上传中，请稍候");
      return;
    }
    const arr = Array.from(files);
    if (!arr.length) return;

    const rolePlan: TryOnClothingRole[] = clothingMode === "multi" && arr.length > 1
      ? (["upper", "lower"] as TryOnClothingRole[]).slice(0, arr.length)
      : [clothingMode === "multi" ? targetRole === "lower" ? "lower" : "upper" : "single"];
    const filesToUpload = arr.slice(0, rolePlan.length);

    if (arr.length > filesToUpload.length) {
      toast.info(clothingMode === "multi" ? "换上下装最多一次处理上装和下装各 1 张" : "换连体只需上传 1 张服装图");
    }

    setIsUploading(true);
    setUploadingClothingRoles([...new Set(rolePlan.slice(0, filesToUpload.length))]);
    const validItems: { file: File; preview: string; role: TryOnClothingRole }[] = [];

    for (let index = 0; index < filesToUpload.length; index++) {
      const file = filesToUpload[index];
      if (!isLikelyImageFile(file)) { toast.error(`${file.name} 不是图片`); continue; }
      if (file.size > MAX_FILE_SIZE) { toast.error(`${file.name} 超过 ${MAX_FILE_SIZE_MB}MB`); continue; }
      validItems.push({ file, preview: createLocalImagePreview(file), role: rolePlan[index] });
    }

    if (validItems.length > 0) {
      toast.info(`正在上传 ${validItems.length} 张图片到图床...`);
      const uploadResults = await Promise.allSettled(validItems.map((item) => uploadImage(item.file)));
      const uploadedItems: ClothingItemState[] = [];

      uploadResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          uploadedItems.push({
            file: validItems[index].file,
            preview: validItems[index].preview,
            url: result.value.url,
            role: validItems[index].role,
          });
        } else {
          const message = result.reason instanceof Error ? result.reason.message : "上传失败";
          toast.error(`${validItems[index].file.name} 上传失败：${message}`);
        }
      });

      if (uploadedItems.length > 0) {
        const replaceRoles = new Set(uploadedItems.map((item) => item.role));
        const retainedItems = clothingMode === "single"
          ? []
          : getCurrentClothingItemStates().filter((item) => !replaceRoles.has(item.role));
        applyClothingItems([...retainedItems, ...uploadedItems]);
        toast.success(clothingMode === "multi" ? "服装槽位已就绪" : "连体服装已就绪");
      }
    }
    setIsUploading(false);
    setUploadingClothingRoles([]);
  };

  // 删除服装时同步删除已上传的 URL
  const removeClothing = (index: number) => {
    store.removeClothing(index);
    setUploadedClothingUrls(prev => prev.filter((_, i) => i !== index));
    setClothingRoles(prev => prev.filter((_, i) => i !== index));
    setPromptOverride(null);
    store.setPromptUsed("");
  };

  const toggleGarmentDetails = () => {
    setGarmentDetailEnabled((value) => !value);
    setPromptOverride(null);
    store.setPromptUsed("");
  };

  const handleGarmentDetailFiles = async (files?: FileList | File[]) => {
    if (isUploadingGarmentDetails) {
      toast.info("服装细节图上传中，请稍候");
      return;
    }
    const arr = Array.from(files || []);
    if (!arr.length) return;
    const remaining = MAX_GARMENT_DETAIL_IMAGES - garmentDetailUrls.length;
    if (remaining <= 0) {
      toast.info(`服装细节图最多 ${MAX_GARMENT_DETAIL_IMAGES} 张`);
      return;
    }
    const limited = arr.slice(0, remaining);
    if (arr.length > limited.length) {
      toast.info(`最多还能添加 ${remaining} 张细节图，已自动截取`);
    }
    const validFiles: File[] = [];
    for (const file of limited) {
      if (!isLikelyImageFile(file)) { toast.error(`${file.name} 不是图片`); continue; }
      if (file.size > MAX_FILE_SIZE) { toast.error(`${file.name} 超过 ${MAX_FILE_SIZE_MB}MB`); continue; }
      validFiles.push(file);
    }
    if (!validFiles.length) return;

    setIsUploadingGarmentDetails(true);
    toast.info(`正在上传 ${validFiles.length} 张服装细节图...`);
    try {
      const results = await Promise.allSettled(validFiles.map((file) => uploadImage(file)));
      const uploadedUrls: string[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          uploadedUrls.push(result.value.url);
        } else {
          const message = result.reason instanceof Error ? result.reason.message : "上传失败";
          toast.error(`${validFiles[index].name} 上传失败：${message}`);
        }
      });
      if (uploadedUrls.length) {
        setGarmentDetailUrls((prev) => normalizeGarmentDetailUrls([...prev, ...uploadedUrls]));
        setPromptOverride(null);
        store.setPromptUsed("");
        toast.success(`已添加 ${uploadedUrls.length} 张服装细节图`);
      }
    } finally {
      setIsUploadingGarmentDetails(false);
    }
  };

  const removeGarmentDetail = (url: string) => {
    setGarmentDetailUrls((prev) => prev.filter((item) => item !== url));
    setPromptOverride(null);
    store.setPromptUsed("");
  };

  const handleCustomModelFile = async (file?: File) => {
    if (!file) return;
    if (!isLikelyImageFile(file)) return toast.error("请上传图片文件");
    if (file.size > MAX_FILE_SIZE) return toast.error(`${file.name} 超过 ${MAX_FILE_SIZE_MB}MB`);

    const uploadSeq = customModelUploadSeqRef.current + 1;
    customModelUploadSeqRef.current = uploadSeq;
    setIsUploadingCustomModel(true);
    store.setSelectedModel(null);
    setCustomModelPreview(null);
    setPromptOverride(null);
    toast.info("正在上传模特图...");
    try {
      if (customModelUploadSeqRef.current !== uploadSeq) return;
      setCustomModelPreview(createLocalImagePreview(file));
      const result = await uploadImage(file);
      if (customModelUploadSeqRef.current !== uploadSeq) return;
      store.setSelectedModel({ id: "custom", name: "自定义", image_url: result.url, gender: "female", is_preset: false, user_id: null });
      setPromptOverride(null);
      toast.success("模特已选择");
    } catch (error) {
      if (customModelUploadSeqRef.current === uploadSeq) {
        setCustomModelPreview(null);
        const message = error instanceof Error ? error.message : "上传失败";
        toast.error(`模特图上传失败：${message}`);
      }
    } finally {
      if (customModelUploadSeqRef.current === uploadSeq) setIsUploadingCustomModel(false);
    }
  };

  const handleCustomModel = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    void handleCustomModelFile(file).finally(() => {
      input.value = "";
    });
  };

  const handleCustomRefFiles = async (files?: FileList | File[]) => {
    if (isUploadingCustomRef) {
      toast.info("参考图上传中，请稍候");
      return;
    }
    const arr = Array.from(files || []);
    if (!arr.length) return;
    const baseUploadReferences = allSelectedReferenceImages.filter((item) => referenceBelongsToSceneMode(item, "upload_reference"));
    const remaining = MAX_TRYON_REFERENCE_IMAGES - baseUploadReferences.length;
    if (remaining <= 0) {
      toast.info(`参考图最多选择 ${MAX_TRYON_REFERENCE_IMAGES} 张`);
      return;
    }
    const limited = arr.slice(0, remaining);
    if (arr.length > limited.length) {
      toast.info(`最多还能添加 ${remaining} 张参考图，已自动截取`);
    }

    const uploadSeq = customRefUploadSeqRef.current + 1;
    customRefUploadSeqRef.current = uploadSeq;
    if (sceneMode !== "upload_reference") {
      referenceSelectionTouchedRef.current = true;
    }
    setSceneMode("upload_reference");
    resetScenePrompt();

    const uploadItems: Array<{ id: string; file: File; preview: string; label: string }> = [];
    for (const file of limited) {
      if (!isLikelyImageFile(file)) { toast.error(`${file.name} 不是图片`); continue; }
      if (file.size > MAX_FILE_SIZE) { toast.error(`${file.name} 超过 ${MAX_FILE_SIZE_MB}MB`); continue; }
      uploadItems.push({
        id: `custom-ref-${Date.now()}-${uploadItems.length}`,
        file,
        preview: createLocalImagePreview(file),
        label: file.name.replace(/\.[^.]+$/, "").slice(0, 24) || `上传参考${baseUploadReferences.length + uploadItems.length + 1}`,
      });
    }
    if (!uploadItems.length) return;

    setCustomRefUploads((prev) => [
      ...prev,
      ...uploadItems.map((item) => ({
        id: item.id,
        preview: item.preview,
        label: item.label,
        status: "uploading" as const,
      })),
    ]);
    toast.info(`正在上传 ${uploadItems.length} 张参考图，系统会分批处理以提高成功率...`);

    const results = await mapWithConcurrency(
      uploadItems,
      TRYON_REFERENCE_UPLOAD_CONCURRENCY,
      async (upload) => {
        try {
          const result = await uploadImage(upload.file);
          if (customRefUploadSeqRef.current === uploadSeq) {
            setCustomRefUploads((prev) => prev.map((item) => item.id === upload.id
              ? { ...item, status: "ready" as const, url: result.url }
              : item
            ));
          }
          return { status: "fulfilled" as const, upload, url: result.url };
        } catch (error) {
          const message = error instanceof Error ? error.message : "上传失败";
          if (customRefUploadSeqRef.current === uploadSeq) {
            setCustomRefUploads((prev) => prev.map((item) => item.id === upload.id
              ? { ...item, status: "error" as const, error: message }
              : item
            ));
          }
          return { status: "rejected" as const, upload, reason: error };
        }
      }
    );
    if (customRefUploadSeqRef.current !== uploadSeq) return;

    const readyRefs: SelectedReferenceImage[] = results.flatMap((result) => {
      if (result.status !== "fulfilled") return [];
      return [{
        id: result.upload.id,
        url: result.url,
        label: result.upload.label,
        category: "style",
        is_preset: false,
        user_id: null,
        source: "upload",
      }];
    });

    if (readyRefs.length) {
      const currentUploadReferences = uniqueReferenceImages(
        ((useTryOnStore.getState().referenceImages || []) as SelectedReferenceImage[])
          .filter((item) => referenceBelongsToSceneMode(item, "upload_reference"))
      );
      setSelectedReferences(
        uniqueReferenceImages([...currentUploadReferences, ...readyRefs]),
        { mode: "upload_reference" }
      );
      toast.success(`已添加 ${readyRefs.length} 张参考图`);
    }
    const failedCount = results.filter((item) => item.status === "rejected").length;
    if (failedCount) {
      const firstFailure = results.find((item) => item.status === "rejected");
      const message = firstFailure?.status === "rejected" && firstFailure.reason instanceof Error
        ? firstFailure.reason.message
        : "请重试";
      toast.error(`${failedCount} 张参考图上传失败：${message}`);
    }
  };

  const handleCustomRef = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = input.files;
    void handleCustomRefFiles(files || undefined).finally(() => {
      input.value = "";
    });
  };

  // ---- 生成（识图 → 生成提示词 → 生成图片） ----
  const refreshTaskQueue = useCallback(() => {
    taskQueue.refresh();
  }, [taskQueue]);

  const removeTaskQueueItem = useCallback((taskId: string) => {
    taskQueue.removeTask(taskId);
  }, [taskQueue]);

  const watchGeneration = useCallback(async (generationId: string, expectedCount: number) => {
    if (watchedGenerationIdsRef.current.has(generationId)) return;
    const globalWatcher = activeTryOnStatusWatchers.get(generationId);
    if (globalWatcher && !globalWatcher.signal.aborted) return;

    const watcherController = new AbortController();
    activeTryOnStatusWatchers.set(generationId, watcherController);
    statusWatcherControllersRef.current.set(generationId, watcherController);
    watchedGenerationIdsRef.current.add(generationId);
    let attempts = 0;
    const startedAt = Date.now();
    let lastQueueRefreshAt = Date.now();
    const updateActiveTask = (patch: Partial<TaskQueueItem>) => {
      const updatedAt = patch.updatedAt ?? new Date().toISOString();
      taskQueue.patchTask(generationId, { ...patch, updatedAt });
      setActiveQueueTask((prev) => {
        if (prev?.id !== generationId) return prev;
        return { ...prev, ...patch, updatedAt };
      });
    };

    try {
      const pollTimeoutMs = getTryOnStatusPollTimeoutMs(expectedCount);
      while (!watcherController.signal.aborted && Date.now() - startedAt < pollTimeoutMs) {
        try {
          await waitForTryOnStatusPoll(attempts, watcherController.signal);
        } catch (error) {
          if (watcherController.signal.aborted || isAbortLikeError(error)) return;
          throw error;
        }
        if (watcherController.signal.aborted) return;
        if (typeof document !== "undefined" && document.visibilityState === "hidden") continue;
        attempts++;

        const isActive = activeGenerationRef.current === generationId;
        try {
          const pollRes = await fetchTryOnGenerationStatus(generationId, watcherController.signal);
          if (!pollRes.ok) continue;

          const pollData = await pollRes.json();
          if (pollData.status === "processing_tryon" || pollData.status === "processing" || pollData.status === "pending") {
            const partialResultUrls = Array.isArray(pollData.result_urls) ? pollData.result_urls : [];
            const partialResultCount = partialResultUrls.filter(Boolean).length;
            const elapsedSeconds = Math.max(0, (Date.now() - startedAt) / 1000);
            const progress = Math.min(
              Math.max(Number(pollData.progress) || 0, 25 + elapsedSeconds * 0.6),
              99
            );
            if (isActive) {
              store.updateProgress(progress);
              if (partialResultUrls.length) store.setPartialResult(partialResultUrls);
            }
            updateActiveTask({
              status: "processing_tryon",
              statusGroup: "running",
              progress,
              resultCount: partialResultCount,
              ...(partialResultCount ? {
                resultThumbnails: partialResultUrls,
                thumbnails: partialResultUrls.filter(Boolean).slice(0, 2),
              } : {}),
            });
            if (Date.now() - lastQueueRefreshAt >= TRYON_STATUS_QUEUE_REFRESH_MS) {
              lastQueueRefreshAt = Date.now();
              refreshTaskQueue();
            }
            continue;
          }

          if (pollData.status === "completed") {
            const resultUrls = Array.isArray(pollData.result_urls) ? pollData.result_urls : [];
            const resultCount = resultUrls.filter(Boolean).length;
            const expectedResultCount = Math.max(Number(pollData.expected_count) || expectedCount, resultCount || 1);
            const partialFailure = pollData.partial_failure && typeof pollData.partial_failure === "object"
              ? pollData.partial_failure as { message?: unknown }
              : null;
            const completedError = String(pollData.error || partialFailure?.message || "");
            if (isActive) {
              store.updateProgress(100);
              store.setResult(resultUrls);
              toast.success("生成完成");
            }
            updateActiveTask({
              status: "completed",
              statusGroup: "completed",
              progress: 100,
              error: completedError,
              resultCount,
              expectedCount: expectedResultCount,
              resultThumbnails: resultUrls,
              thumbnails: resultUrls.filter(Boolean).slice(0, 2),
              completedAt: new Date().toISOString(),
            });
            refreshTaskQueue();
            return;
          }

          if (pollData.status === "failed") {
            const message = pollData.error || "生成失败";
            if (isActive) {
              store.setError(message);
              toast.error(message);
            }
            updateActiveTask({
              status: "failed",
              statusGroup: "failed",
              error: message,
              progress: 100,
            });
            refreshTaskQueue();
            return;
          }
        } catch (error) {
          if (watcherController.signal.aborted || isAbortLikeError(error)) return;
          // Network blips are tolerated during polling.
        }
      }

      if (!watcherController.signal.aborted && activeGenerationRef.current === generationId) {
        updateActiveTask({
          status: "processing_delayed",
          statusGroup: "running",
          error: "",
          progress: 99,
        });
        store.updateProgress(99);
        toast.info("生成时间较长，任务仍在后台处理中，可稍后从左侧任务列表查看结果");
      }
      if (!watcherController.signal.aborted) refreshTaskQueue();
    } finally {
      watchedGenerationIdsRef.current.delete(generationId);
      if (statusWatcherControllersRef.current.get(generationId) === watcherController) {
        statusWatcherControllersRef.current.delete(generationId);
      }
      if (activeTryOnStatusWatchers.get(generationId) === watcherController) {
        activeTryOnStatusWatchers.delete(generationId);
      }
    }
  }, [refreshTaskQueue, store, taskQueue]);

  const handleContinueCreate = useCallback(() => {
    cancelTaskSelection();
    const pendingSubmitId = generationSubmitRef.current?.id || "";
    generationSubmitRef.current?.controller.abort();
    statusWatcherControllersRef.current.forEach((controller) => controller.abort());
    statusWatcherControllersRef.current.clear();
    if (pendingSubmitId.startsWith("local-")) removeTaskQueueItem(pendingSubmitId);
    generationSubmitRef.current = null;
    activeGenerationRef.current = null;
    customModelUploadSeqRef.current += 1;
    customRefUploadSeqRef.current += 1;
    clothingAnalysisSeqRef.current += 1;
    referenceAnalysisSeqRef.current += 1;
    referenceSelectionTouchedRef.current = false;
    lastClothingAnalysisKeyRef.current = "";
    lastReferenceAnalysisKeyRef.current = "";
    setActiveQueueTask(null);
    setIsSubmitting(false);
    setIsUploadingCustomModel(false);
    setIsUploadingGarmentDetails(false);
    setGarmentDetailEnabled(false);
    setGarmentDetailUrls([]);
    setIsDraggingGarmentDetails(false);
    setUploadedClothingUrls([]);
    setClothingRoles([]);
    setClothingAnalysis(null);
    setClothingAnalysisSource(null);
    setClothingAnalysisError(null);
    setIsAnalyzingClothing(false);
    setReferenceAnalyses([]);
    setReferenceAnalysisSource(null);
    setReferenceAnalysisError(null);
    setIsAnalyzingReferences(false);
    setIsLoadingSystemReferences(false);
    setRecommendedSystemReferences(getFallbackSystemReferences().slice(0, 4));
    setAllSystemReferences(getFallbackSystemReferences());
    setCustomModelPreview(null);
    setCustomRefUploads([]);
    setPromptOverride(null);
    setActiveTaskReferences([]);
    setSceneMode("upload_reference");
    setAutoDesign(DEFAULT_AUTO_DESIGN);
    if (garmentDetailInputRef.current) garmentDetailInputRef.current.value = "";
    store.reset();
  }, [cancelTaskSelection, removeTaskQueueItem, store]);

  const applyTryOnHistoryPayload = useCallback((
    payload: TryOnHistoryPayload,
    options?: { resultUrls?: string[]; selectedTask?: TaskQueueItem | null; errorMessage?: string | null; silent?: boolean }
  ) => {
    customModelUploadSeqRef.current += 1;
    customRefUploadSeqRef.current += 1;
    setIsUploadingCustomModel(false);
    setCustomRefUploads([]);

    const files = payload.clothingUrls.map((_, index) =>
      new File([], `history-clothing-${index + 1}.jpg`, { type: "image/jpeg" })
    );
    store.setClothing(files, payload.clothingUrls);
    setUploadedClothingUrls(payload.clothingUrls);
    const historyGarmentDetailUrls = normalizeGarmentDetailUrls(payload.garmentDetailUrls);
    setGarmentDetailUrls(historyGarmentDetailUrls);
    setGarmentDetailEnabled(historyGarmentDetailUrls.length > 0);

    const nextClothingMode = normalizeTryOnClothingMode(
      payload.clothingMode || (payload.clothingUrls.length > 1 ? "multi" : "single")
    );
    setClothingMode(nextClothingMode);
    const nextClothingRoles = payload.clothingUrls.map((_, index) => normalizeTryOnClothingRole(
      payload.clothingRoles?.[index],
      nextClothingMode === "multi" ? index === 0 ? "upper" : index === 1 ? "lower" : "extra" : "single"
    ));
    setClothingRoles(nextClothingRoles);
    const nextGarmentAudience = normalizeTryOnGarmentAudience(payload.garmentAudience);
    const nextAgeGroup = normalizeTryOnAgeGroup(payload.ageGroup);
    setGarmentAudience(nextGarmentAudience);
    setAgeGroup(nextAgeGroup);
    const historyClothingAnalysis = payload.clothingAnalysis
      ? normalizeTryOnClothingAnalysis(payload.clothingAnalysis)
      : null;
    const historyClothingAnalysisKey = buildClothingAnalysisKey({
      urls: payload.clothingUrls,
      clothingMode: nextClothingMode,
      clothingRoles: nextClothingRoles,
      garmentAudience: nextGarmentAudience,
      ageGroup: nextAgeGroup,
    });
    if (historyClothingAnalysis) {
      lastClothingAnalysisKeyRef.current = historyClothingAnalysisKey;
      clothingAnalysisCacheRef.current.set(historyClothingAnalysisKey, {
        analysis: historyClothingAnalysis,
        source: "history",
        error: null,
      });
      setClothingAnalysis(historyClothingAnalysis);
      setClothingAnalysisSource("history");
      setClothingAnalysisError(null);
      setIsAnalyzingClothing(false);
    } else {
      lastClothingAnalysisKeyRef.current = "";
      setClothingAnalysis(null);
      setClothingAnalysisSource(null);
      setClothingAnalysisError(null);
    }

    if (payload.modelFaceUrl) {
      const presetModel = findPresetModelByUrl(payload.modelFaceUrl);
      if (presetModel) {
        setCustomModelPreview(null);
        store.setSelectedModel({ ...presetModel, is_preset: true, user_id: null });
      } else {
        setCustomModelPreview(payload.modelFaceUrl);
        store.setSelectedModel({
          id: "history-model",
          name: "历史模特",
          image_url: payload.modelFaceUrl,
          gender: "female",
          is_preset: false,
          user_id: null,
        });
      }
    } else {
      setCustomModelPreview(null);
      store.setSelectedModel(null);
    }

    const historyReferenceUrls = getHistoryReferenceUrls(payload);
    const appliedSceneMode = coerceVisibleSceneMode(payload.sceneMode);
    const historyReferenceSource = getHistoryReferenceSource(appliedSceneMode);
    const historyReferences = historyReferenceUrls.map((url, index) => toHistoryReference(url, index, historyReferenceSource));
    setCustomRefUploads([]);
    referenceSelectionTouchedRef.current = historyReferences.length > 0;
    store.setReferenceImages(appliedSceneMode === "auto_design" ? [] : historyReferences as ReferenceImage[]);

    setSceneMode(appliedSceneMode);
    const historyReferenceAnalyses = alignTryOnReferenceAnalyses(payload.referenceAnalyses, historyReferenceUrls.length);
    const historyReferenceAnalysisKey = buildReferenceAnalysisKey({
      urls: appliedSceneMode === "auto_design" ? [] : historyReferenceUrls,
      clothingMode: nextClothingMode,
      clothingRoles: nextClothingRoles,
      garmentAudience: nextGarmentAudience,
      ageGroup: nextAgeGroup,
    });
    if (appliedSceneMode !== "auto_design" && historyReferenceAnalyses.length) {
      lastReferenceAnalysisKeyRef.current = historyReferenceAnalysisKey;
      referenceAnalysisCacheRef.current.set(historyReferenceAnalysisKey, {
        analyses: historyReferenceAnalyses,
        source: "history",
        error: null,
      });
      setReferenceAnalyses(historyReferenceAnalyses);
      setReferenceAnalysisKey(historyReferenceAnalysisKey);
      setReferenceAnalysisSource("history");
      setReferenceAnalysisError(null);
      setIsAnalyzingReferences(false);
    } else {
      lastReferenceAnalysisKeyRef.current = "";
      setReferenceAnalyses([]);
      setReferenceAnalysisKey("");
      setReferenceAnalysisSource(null);
      setReferenceAnalysisError(null);
    }
    setAutoDesign(normalizeAutoDesignSettings(payload.autoDesign || DEFAULT_AUTO_DESIGN));
    setAiModel(payload.aiModel);
    setAspectRatio(payload.aspectRatio);
    setImageSize(payload.imageSize);
    setGenCount(payload.genCount);
    setCustomStyle(payload.style || "");
    setPromptOverride(null);
    store.setPromptUsed("");
    setActiveTaskReferences(buildTryOnInputReferences({
      clothingUrls: payload.clothingUrls,
      clothingMode: nextClothingMode,
      clothingRoles: nextClothingRoles,
      referenceUrls: appliedSceneMode === "auto_design" ? [] : historyReferenceUrls,
      modelFaceUrl: payload.modelFaceUrl,
      garmentDetailUrls: historyGarmentDetailUrls,
    }));
    store.setResult(options?.resultUrls || []);
    store.setError(options?.errorMessage || null);
    activeGenerationRef.current = null;
    setActiveQueueTask(options?.selectedTask ?? null);
    if (!options?.silent) toast.success("已套用历史参数");
  }, [store]);

  const handleTaskSelect = useCallback(async (item: TaskQueueItem, railSelection?: TaskSelectionSession) => {
    const selection = beginTaskSelection(item.id, railSelection?.reason ?? "manual");
    setActiveTaskReferences([]);

    if (isTaskRunning(item)) {
      const expectedCount = clampTaskExpectedCount(item, 1, MAX_TRYON_OUTPUT_IMAGES);
      const partialResultUrls = safeTaskQueueUrls(item.resultThumbnails);
      const progress = Math.min(Math.max(Math.round(Number(item.progress) || 10), 1), 99);
      activeGenerationRef.current = item.id;
      setActiveQueueTask(item);
      setGenCount(Math.min(Math.max(expectedCount, 1), 4));
      store.startGeneration();
      if (partialResultUrls.length) store.setPartialResult(partialResultUrls);
      store.updateProgress(progress);
      try {
        const detail = await fetchHistoryApplyDetail(item.id, "tryon", selection.signal);
        if (!selection.isCurrent()) return;
        const nextExpectedCount = clampTaskExpectedCount(
          { ...item, expectedCount: getTryOnHistoryExpectedCount(detail.payload) },
          1,
          MAX_TRYON_OUTPUT_IMAGES,
          expectedCount
        );
        const nextResultUrls = detail.resultUrls.length ? detail.resultUrls : partialResultUrls;
        applyTryOnHistoryPayload(detail.payload, {
          resultUrls: nextResultUrls,
          selectedTask: item,
          silent: true,
        });
        activeGenerationRef.current = item.id;
        setActiveQueueTask(item);
        store.startGeneration();
        if (nextResultUrls.length) store.setPartialResult(nextResultUrls);
        store.updateProgress(progress);
        void watchGeneration(item.id, nextExpectedCount);
      } catch {
        if (selection.signal.aborted || !selection.isCurrent()) return;
        void watchGeneration(item.id, expectedCount);
      } finally {
        selection.finish();
      }
      return;
    }

    if (item.statusGroup === "completed" || item.statusGroup === "failed") {
      const isFailedTask = item.statusGroup === "failed";
      if (item.module === "tryon") {
        const resultThumbnails = safeTaskQueueUrls(item.resultThumbnails);
        const thumbnails = safeTaskQueueUrls(item.thumbnails);
        const resultUrls = resultThumbnails.length ? resultThumbnails : isFailedTask ? [] : thumbnails;
        const errorMessage = isFailedTask ? item.error || "任务失败，可重新生成" : null;
        activeGenerationRef.current = null;
        setActiveQueueTask(item);
        store.setResult(resultUrls);
        store.setError(errorMessage);
        try {
          const detail = await fetchHistoryApplyDetail(item.id, "tryon", selection.signal);
          if (!selection.isCurrent()) return;
          applyTryOnHistoryPayload(detail.payload, {
            resultUrls: detail.resultUrls.length ? detail.resultUrls : resultUrls,
            selectedTask: item,
            errorMessage,
            silent: selection.reason === "restore",
          });
        } catch (err: any) {
          if (selection.signal.aborted || !selection.isCurrent()) return;
          toast.error(err?.message || "历史参数加载失败");
        } finally {
          selection.finish();
        }
        return;
      }

      if (item.applyUrl) {
        router.push(item.applyUrl);
      } else if (isFailedTask) {
        activeGenerationRef.current = null;
        setActiveQueueTask(item);
        store.setResult([]);
        store.setError(item.error || "任务失败，可重新生成");
      }
      selection.finish();
      return;
    }
  }, [applyTryOnHistoryPayload, beginTaskSelection, router, store, watchGeneration]);

  const handleGenerate = async (promptForRun?: string) => {
    if (isSubmitting || generationSubmitRef.current) return;
    if (!isAuthenticated && !(await refreshAuth())) {
      toast.error("请先登录");
      router.push("/login");
      return;
    }
    if (isUploading) {
      toast.info("服装图正在上传，请稍候");
      return;
    }
    if (!uploadedClothingUrls.length) { toast.error("请上传衣服"); return; }
    if (isAuxiliaryUploading || isReferenceUploadPending || isModelUploadPending) {
      const pendingLabel = isModelUploadBusy ? "模特图" : isUploadingGarmentDetails ? "服装细节图" : "参考图";
      toast.info(`${pendingLabel}正在上传，请稍候`);
      return;
    }
    if (sceneMode !== "auto_design" && !effectiveReferenceUrls.length) {
      toast.error("请选择至少 1 张参考图");
      return;
    }
    if (
      sceneMode !== "auto_design"
      && (
        referenceAnalysisKey !== activeReferenceAnalysisKey
        || referenceAnalyses.length !== effectiveReferenceUrls.length
      )
    ) {
      toast.info("参考图正在识别，请稍候");
      return;
    }
    if (isIntimateGarment && ageGroup !== "adult") {
      toast.error("内衣/泳衣类服装仅支持成人模特生成");
      return;
    }
    if (credits !== null && credits < totalCost) {
      showInsufficientCreditsToast({ required: totalCost, balance: credits, onRecharge: () => router.push("/pricing") });
      return;
    }

    setIsSubmitting(true);
    cancelTaskSelection();
    const provisionalTaskId = `local-tryon-${Date.now()}`;
    const submitController = new AbortController();
    generationSubmitRef.current = { id: provisionalTaskId, controller: submitController };
    const isCurrentSubmit = () =>
      generationSubmitRef.current?.id === provisionalTaskId && !submitController.signal.aborted;
    const submittingAt = new Date().toISOString();
    const taskInputReferences = buildTryOnInputReferences({
      clothingUrls: uploadedClothingUrls,
      clothingMode,
      clothingRoles,
      referenceUrls: effectiveReferenceUrls,
      modelFaceUrl: store.selectedModel?.image_url,
      garmentDetailUrls: activeGarmentDetailUrls,
    });
    const taskInputThumbnails = taskInputReferences.map((item) => item.url);
    setActiveTaskReferences(taskInputReferences);
    const provisionalTask = taskQueue.startTask({
      id: provisionalTaskId,
      status: "submitting",
      statusGroup: "queued",
      time: "0:00",
      createdAt: submittingAt,
      updatedAt: submittingAt,
      completedAt: null,
      error: "",
      progress: 5,
        expectedCount: expectedOutputCount,
      resultCount: 0,
      inputThumbnails: taskInputThumbnails,
      resultThumbnails: [],
      thumbnails: taskInputThumbnails.slice(0, 2),
      applyUrl: "",
    });
    setActiveQueueTask(provisionalTask);
    store.startGeneration();

    try {
      // ---- Step 1: 构建稳定的编号提示词 ----
      store.updateProgress(5);

      let finalStyle = stylePrompt || "";
      let usedAiPrompt = false;
      const activePromptOverride = typeof promptForRun === "string" ? promptForRun : promptOverride;
      if (activePromptOverride?.trim()) {
        finalStyle = activePromptOverride.trim();
        usedAiPrompt = true;
        store.setPromptUsed(finalStyle);
      }
      console.log("[generate] 跳过自动图片分析，使用当前提示词");

      store.updateProgress(15);
      toast.info("正在提交生成任务...");

      // ---- Step 2: 调用生成 API ----
      const res = await fetch("/api/tryon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: submitController.signal,
        body: JSON.stringify({
          clothing_urls: uploadedClothingUrls,
          clothing_mode: clothingMode,
          clothing_roles: clothingRoles,
          clothing_analysis: clothingAnalysis,
          garment_detail_urls: activeGarmentDetailUrls,
          garment_audience: garmentAudience,
          age_group: ageGroup,
          garment_category: isIntimateGarment ? "intimate" : "regular",
          is_intimate_garment: isIntimateGarment,
          model_face_url: store.selectedModel?.image_url,
          reference_url: effectiveReferenceUrl,
          reference_urls: effectiveReferenceUrls,
          reference_analyses: alignTryOnReferenceAnalyses(referenceAnalyses, effectiveReferenceUrls.length),
          ai_model: aiModel,
          aspect_ratio: aspectRatio,
          image_size: imageSize,
          style: usedAiPrompt ? undefined : finalStyle,
          raw_prompt: usedAiPrompt ? finalStyle : undefined,
          gen_count: genCount,
          scene_mode: sceneMode,
          auto_design: sceneMode === "auto_design" ? resolvedAutoDesign : undefined,
        }),
      });
      if (!isCurrentSubmit()) return;

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        if (!isCurrentSubmit()) return;
        if (res.status === 401) {
          await refreshAuth();
          if (!isCurrentSubmit()) return;
          store.setError(null);
          setActiveQueueTask((prev) => prev?.id === provisionalTaskId ? null : prev);
          removeTaskQueueItem(provisionalTaskId);
          setIsSubmitting(false);
          generationSubmitRef.current = null;
          router.push("/login");
          return;
        }
        if (res.status === 402) {
          const nextCredits = e.balance ?? 0;
          setCredits(nextCredits);
          if (userId) setCachedProfileCredits(userId, nextCredits);
        }
        throw new Error(e.error || "生成失败");
      }

      const { generation_id, credits_remaining } = await res.json();
      if (!isCurrentSubmit()) return;
      if (credits_remaining !== undefined) {
        setCredits(credits_remaining);
        if (userId) setCachedProfileCredits(userId, credits_remaining);
      }
      store.updateProgress(25);

      if (!generation_id) throw new Error("任务提交失败");
      const now = new Date().toISOString();
      const optimisticTask: TaskQueueItem = {
        id: generation_id,
        module: "tryon",
        title: "服装上身",
        status: "processing_tryon",
        statusGroup: "running",
        time: "0:00",
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        error: "",
        progress: 25,
      expectedCount: expectedOutputCount,
        resultCount: 0,
        inputThumbnails: taskInputThumbnails,
        resultThumbnails: [],
        thumbnails: taskInputThumbnails.slice(0, 2),
        applyUrl: `/create?apply=${encodeURIComponent(generation_id)}`,
      };

      activeGenerationRef.current = generation_id;
      setActiveQueueTask(optimisticTask);
      taskQueue.replaceWithServerTask(provisionalTaskId, optimisticTask);
      refreshTaskQueue();
      toast.success("任务已提交，可继续创建");
      setIsSubmitting(false);
      generationSubmitRef.current = null;
      void watchGeneration(generation_id, expectedOutputCount);
      return;
    } catch (err: any) {
      if (err?.name === "AbortError" || !isCurrentSubmit()) return;
      store.setError(err.message);
      setActiveQueueTask((prev) => prev?.id === provisionalTaskId ? null : prev);
      removeTaskQueueItem(provisionalTaskId);
      toast.error(err.message);
      setIsSubmitting(false);
      generationSubmitRef.current = null;
    }
  };

  const handleRepairGenerate = (repairValue: string) => {
    const repairedPrompt = applyRepairPrompt(finalPrompt, "tryon", repairValue);
    setPromptOverride(repairedPrompt);
    store.setPromptUsed(repairedPrompt);
    toast.info("已加入修复指令，正在重新生成...");
    handleGenerate(repairedPrompt);
  };

  const displayedResultUrls = store.resultUrls.filter(Boolean);
  const activeResultExpectedCount = activeQueueTask
    ? clampTaskExpectedCount(activeQueueTask, 1, MAX_TRYON_OUTPUT_IMAGES, expectedOutputCount || genCount)
    : expectedOutputCount || genCount;
  const hasCompletedPartialResults = Boolean(
    activeQueueTask?.statusGroup === "completed"
    && activeResultExpectedCount > displayedResultUrls.length
  );
  const tryonPreviewReferences = useMemo(() => {
    const references = activeTaskReferences.length
      ? activeTaskReferences
      : buildTryOnInputReferences({
          clothingUrls: uploadedClothingUrls,
          clothingMode,
          clothingRoles,
          referenceUrls: effectiveReferenceUrls,
          modelFaceUrl: store.selectedModel?.image_url,
          garmentDetailUrls: activeGarmentDetailUrls,
        });
    return references.map((item) => ({
      url: item.url,
      label: item.label,
      role: item.label.includes("服装") || item.label.includes("上装") || item.label.includes("下装") || item.label.includes("连体")
        ? "clothing" as const
        : item.label.includes("模特")
          ? "model" as const
          : "reference" as const,
    }));
  }, [activeGarmentDetailUrls, activeTaskReferences, clothingMode, clothingRoles, effectiveReferenceUrls, store.selectedModel?.image_url, uploadedClothingUrls]);
  const tryonPreviewErrors = useMemo(
    () => Array.from({ length: activeResultExpectedCount }, (_, index) => (
      hasCompletedPartialResults && !displayedResultUrls[index]
        ? "本张生成失败，成功图片可正常使用，失败张数已按任务结算处理。"
        : null
    )),
    [activeResultExpectedCount, displayedResultUrls, hasCompletedPartialResults]
  );
  const tryonPreviewSession = useMemo(
    () => createGenericImagePreviewSession({
      module: "tryon",
      title: "服装上身",
      taskId: activeQueueTask?.id,
      createdAt: activeQueueTask?.createdAt,
      statusGroup: activeQueueTask?.statusGroup || (store.isGenerating ? "running" : undefined),
      urls: store.resultUrls,
      expectedCount: activeResultExpectedCount,
      isGenerating: store.isGenerating,
      references: tryonPreviewReferences,
      promptText: customStyle,
      errors: tryonPreviewErrors,
      metaItems: [
        { label: "服装模式", value: TRYON_CLOTHING_MODE_LABELS[clothingMode] },
        { label: "场景模式", value: SCENE_MODE_LABELS[sceneMode] },
        { label: "人群", value: TRYON_GARMENT_AUDIENCE_LABELS[garmentAudience] },
        { label: "年龄", value: TRYON_AGE_GROUP_LABELS[ageGroup] },
        { label: "模型", value: aiModel },
        { label: "比例", value: aspectRatio },
        { label: "分辨率", value: imageSize },
        { label: "生成数量", value: activeResultExpectedCount },
      ],
      resultTitlePrefix: "服装上身结果",
      aspectRatio,
    }),
    [activeQueueTask, activeResultExpectedCount, ageGroup, aiModel, aspectRatio, clothingMode, customStyle, garmentAudience, imageSize, sceneMode, store.isGenerating, store.resultUrls, tryonPreviewErrors, tryonPreviewReferences]
  );
  const resultStatus: StudioResultStatus = store.error
      ? "error"
      : store.isGenerating || store.resultUrls.length > 0
        ? "results"
        : "empty";
  const retryDisabled = store.isGenerating || Boolean(applyingTaskId);
  const isVisualAnalysisPending = isAnalyzingClothing || (sceneMode !== "auto_design" && isAnalyzingReferences);
  const isReferenceAnalysisReady = sceneMode === "auto_design"
    || !effectiveReferenceUrls.length
    || (
      referenceAnalysisKey === activeReferenceAnalysisKey
      && referenceAnalyses.length === effectiveReferenceUrls.length
    );
  const runDisabled = isSubmitting
    || isUploading
    || isAuxiliaryUploading
    || isReferenceUploadPending
    || isModelUploadPending
    || isVisualAnalysisPending
    || !isReferenceAnalysisReady
    || (sceneMode !== "auto_design" && !effectiveReferenceUrls.length)
    || !uploadedClothingUrls.length;
  const authIsAnonymous = authChecked && !isAuthenticated;
  const runDisabledReason = (() => {
    if (isSubmitting) return "正在提交任务，请稍候。";
    if (isUploading) return "服装图正在上传，请稍候。";
    if (isModelUploadBusy) return "模特图正在上传，请稍候。";
    if (isUploadingGarmentDetails) return "服装细节图正在上传，请稍候。";
    if (isReferenceUploadBusy) return "参考图正在上传，请稍候。";
    if (isAnalyzingClothing) return "服装图正在识别，请稍候。";
    if (sceneMode !== "auto_design" && isAnalyzingReferences) return "参考图正在识别，请稍候。";
    if (!isReferenceAnalysisReady) return "参考图识别结果正在更新，请稍候。";
    if (sceneMode !== "auto_design" && !effectiveReferenceUrls.length) return "请先选择至少 1 张参考图。";
    if (!uploadedClothingUrls.length) return "请先上传服装图，或从作品库选择一张历史结果。";
    return undefined;
  })();
  const clothingAnalysisLabel = getClothingAnalysisLabel(clothingAnalysis);
  const visibleSceneModeTabs = SCENE_MODE_TABS.filter((tab) => tab.value !== "system_reference");
  const clothingAnalysisStatus = isAnalyzingClothing
    ? { tone: "loading" as const, text: "识别服装中" }
    : clothingAnalysisLabel
      ? { tone: "success" as const, text: `${clothingAnalysisSource === "history" ? "历史识别" : clothingAnalysisSource === "cache" ? "缓存识别" : "已识别"}：${clothingAnalysisLabel}` }
      : clothingAnalysisError
        ? { tone: "warning" as const, text: clothingAnalysisError }
        : null;
  const referenceAnalysisStatus = isAnalyzingReferences
    ? { tone: "loading" as const, text: "识别参考图中" }
    : referenceAnalysisError
      ? { tone: "warning" as const, text: referenceAnalysisError }
      : selectedReferenceCount > 0 && referenceAnalyses.length > 0
        ? {
            tone: referenceAnalysisSource === "fallback" ? "warning" as const : "success" as const,
            text: `${referenceAnalysisSource === "history" ? "历史识别" : referenceAnalysisSource === "cache" ? "缓存识别" : "已识别"} ${Math.min(referenceAnalyses.length, selectedReferenceCount)}/${selectedReferenceCount} 张参考图`,
          }
        : null;
  const referenceAnalysisSummaries = selectedReferenceImages
    .map((ref, index) => {
      const analysis = referenceAnalyses[index];
      if (!analysis) return null;
      const isFallback = referenceAnalysisSource === "fallback";
      return {
        key: ref.url || `${analysis.index}-${index}`,
        title: `#${index + 1} ${getReferenceAnalysisSummary(analysis, { fallback: isFallback })}`,
        detail: getReferenceAnalysisDetailText(analysis, {
          fallback: isFallback,
          reasonText: referenceAnalysisError,
        }),
      };
    })
    .filter(Boolean) as Array<{ key: string; title: string; detail: string }>;
  const isCustomModelSelected = Boolean(store.selectedModel && !store.selectedModel.is_preset);
  const customModelImageUrl = customModelPreview || (isCustomModelSelected ? store.selectedModel?.image_url || "" : "");
  const recommendedSystemReferenceUrls = new Set(recommendedSystemReferences.map((item) => item.url));
  const secondarySystemReferences = allSystemReferences.filter((item) => !recommendedSystemReferenceUrls.has(item.url));
  const referencePanelBaseReferences = referencePanelTab === "recommended"
    ? recommendedSystemReferences
    : referencePanelTab === "exclusive"
      ? allSystemReferences.filter((item) => item.styleTags?.some((tag) => tag.includes("exclusive")) || item.sceneTags?.some((tag) => tag.includes("exclusive")))
      : allSystemReferences;
  const referencePanelMainReferences = referencePanelBaseReferences.filter((ref) => referenceMatchesSceneFilters(ref, {
    view: referencePanelViewFilter,
    body: referencePanelBodyFilter,
    search: referencePanelSearch,
  }));
  const activeReferenceScene = referencePanelMainReferences.find((item) => item.url === activeReferenceSceneUrl)
    || referencePanelMainReferences[0]
    || recommendedSystemReferences[0]
    || allSystemReferences[0]
    || null;
  const activeReferenceSceneChildren = getSceneChildReferences(activeReferenceScene);
  const isReferenceSelected = (url: string) => selectedReferenceImages.some((item) => item.url === url);
  const referenceSelectionFooter = sceneMode !== "auto_design" && selectedReferenceCount > 0 ? (
    <div className="mt-3 flex flex-wrap items-center justify-end gap-3 text-[11px] font-medium">
      <span className="text-[var(--codex-accent)]">已选 {selectedReferenceCount}/{MAX_TRYON_REFERENCE_IMAGES}</span>
      <button
        type="button"
        onClick={clearSelectedReferences}
        disabled={!selectedReferenceCount}
        className="text-red-500 transition hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        全部删除
      </button>
      <button
        type="button"
        onClick={saveSelectedReferenceTemplate}
        disabled={!selectedReferenceCount || isSavingFavoriteReference}
        className="text-[var(--codex-accent)] transition hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSavingFavoriteReference ? "收藏中" : "收藏为模板"}
      </button>
    </div>
  ) : null;

  return (
    <>
      <StudioPageShell
        activeFeature="tryon"
        taskRail={(
          <StudioTaskRail
            module="tryon"
            moduleLabel="服装上身"
            onContinue={handleContinueCreate}
            onSelectTask={handleTaskSelect}
          />
        )}
        header={(
          <ModuleHeader
            title="服装上身"
            tooltip="按上装、下装或连体槽位上传服装，选择模特与参考场景，生成可直接用于商品展示、主图延展和内容投放的成片。"
            actions={(
              <button
                ref={rulesButtonRef}
                type="button"
                onMouseEnter={openRulesPopover}
                onMouseLeave={scheduleRulesHide}
                onFocus={openRulesPopover}
                onBlur={scheduleRulesHide}
                aria-expanded={showClothingRules}
                className="studio-upload-rule-button"
              >
                图片规则 <ChevronRight className="h-3 w-3" />
              </button>
            )}
          />
        )}
        controlPanel={(
          <StudioControlPanel>
          {/* ---- 服装（整个区域可拖拽） ---- */}
          <StudioSection
            title="上传服装"
            description={currentUploadRule.uploadSpecText}
            badge={isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" /> : null}
            className="studio-clothing-upload-section studio-stable-upload-boundary relative rounded-xl transition-all"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple={clothingMode === "multi"}
              className="hidden"
              onChange={(e) => {
                if (isUploading) {
                  e.currentTarget.value = "";
                  return;
                }
                if (e.target.files) processFiles(e.target.files, pendingClothingRole);
                e.currentTarget.value = "";
              }}
            />

            <StudioSegmentedControl<TryOnClothingMode>
              value={clothingMode}
              ariaLabel="选择服装上身模式"
              onChange={switchClothingMode}
              options={[
                { value: "multi", label: TRYON_CLOTHING_MODE_LABELS.multi, description: "上装 + 下装", disabled: isUploading },
                { value: "single", label: TRYON_CLOTHING_MODE_LABELS.single, description: "连体 / 全身", disabled: isUploading },
              ]}
            />

            {clothingAnalysisStatus && (
              <div
                className={`mt-2 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
                  clothingAnalysisStatus.tone === "loading"
                    ? "border-violet-100 bg-violet-50/70 text-violet-600"
                    : clothingAnalysisStatus.tone === "success"
                      ? "border-emerald-100 bg-emerald-50/80 text-emerald-700"
                      : "border-amber-100 bg-amber-50/80 text-amber-700"
                }`}
              >
                {clothingAnalysisStatus.tone === "loading" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : clothingAnalysisStatus.tone === "success" ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                <span className="min-w-0 truncate" title={clothingAnalysisStatus.text}>{clothingAnalysisStatus.text}</span>
              </div>
            )}

            {clothingMode === "single" ? (
              <div className="studio-clothing-slot-stack" data-mode="single">
                <StudioUploadTile
                  title="上传 / 拖拽【连体/全身】"
                  description="图1会按连衣裙、套装或全身服装处理，建议主体完整、边缘清晰。"
                  imageUrl={singleClothing?.preview}
                  imageAlt="已上传的连体/全身服装"
                  disabled={isUploading}
                  loading={isUploading && uploadingClothingRoles.includes("single")}
                  supportBadge="1张服装图"
                  onUploadClick={() => openClothingPicker("single")}
                  onLibraryClick={() => sourceLibrary.open("single")}
                  onPreview={singleClothing ? () => openLightbox(singleClothing.preview, "已上传的连体/全身服装") : undefined}
                  onRemove={singleClothing ? () => removeClothing(0) : undefined}
                  onDropFile={(file) => {
                    if (file) processFiles([file], "single");
                  }}
                  libraryLabel="从资源库导入"
                  footnote="连体/全身服装建议主体完整、边缘清晰、无遮挡，生成会更稳定。"
                  examples={{
                    label: "试一试",
                    images: TRYON_UPLOAD_SLOT_EXAMPLES.overall,
                    disabled: isUploading,
                    onSelect: (image) => applyRuleImage(image as TryOnRuleImage),
                  }}
                />
              </div>
            ) : (
              <div className="studio-clothing-slot-stack" data-mode="multi">
                {([
                  ["upper", "上传 / 拖拽【上装】", upperClothing],
                  ["lower", "上传 / 拖拽【下装】", lowerClothing],
                ] as const).map(([role, title, item]) => {
                  const itemIndex = clothingItems.findIndex((clothing) => clothing.role === role);
                  return (
                    <div key={role} className="studio-clothing-slot-card">
                      <StudioUploadTile
                        title={title}
                        description={`${TRYON_CLOTHING_ROLE_LABELS[role]}会锁定到对应身体区域，可单独上传也可上下装组合。`}
                        imageUrl={item?.preview}
                        imageAlt={`已上传的${TRYON_CLOTHING_ROLE_LABELS[role]}`}
                        disabled={isUploading}
                        loading={isUploading && uploadingClothingRoles.includes(role)}
                        supportBadge="可单独上传"
                        onUploadClick={() => openClothingPicker(role)}
                        onLibraryClick={() => sourceLibrary.open(role)}
                        onPreview={item ? () => openLightbox(item.preview, `已上传的${TRYON_CLOTHING_ROLE_LABELS[role]}`) : undefined}
                        onRemove={item && itemIndex >= 0 ? () => removeClothing(itemIndex) : undefined}
                        onDropFile={(file) => {
                          if (file) processFiles([file], role);
                        }}
                        libraryLabel="从资源库导入"
                        footnote="款式图上传无遮挡、无码图；平铺、人台或干净上身图效果更稳。"
                        examples={{
                          label: "试一试",
                          images: role === "upper" ? TRYON_UPLOAD_SLOT_EXAMPLES.upper : TRYON_UPLOAD_SLOT_EXAMPLES.lower,
                          disabled: isUploading,
                          onSelect: (image) => applyRuleImage(image as TryOnRuleImage),
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl border border-slate-100 bg-white/70 px-3 py-2 text-xs text-slate-700 transition-colors hover:border-violet-200">
              <input
                type="checkbox"
                checked={isIntimateGarment}
                onChange={(event) => updateIntimateGarment(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              <span>
                <span className="font-semibold">上传服装为内衣、泳衣、情趣内衣类服装</span>
                <span className="mt-0.5 block text-[11px] leading-4 text-slate-400">
                  勾选后按成人商品图安全处理，生成会避免裸露、挑逗姿势和未成年人场景。
                </span>
              </span>
            </label>

            <div className="mt-3 space-y-3">
              <button
                type="button"
                onClick={toggleGarmentDetails}
                className={`flex w-full items-center justify-between rounded-2xl border p-3 text-left transition-all ${
                  garmentDetailEnabled
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-black">服装细节参考</span>
                  <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                    {GARMENT_DETAIL_SWITCH_DESCRIPTION}
                  </span>
                </span>
                <span className={`ml-3 flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition ${garmentDetailEnabled ? "bg-emerald-600" : "bg-neutral-200"}`}>
                  <span className={`h-5 w-5 rounded-full bg-white shadow transition ${garmentDetailEnabled ? "translate-x-5" : "translate-x-0"}`} />
                </span>
              </button>

              {garmentDetailEnabled && (
                <StudioUploadSection
                  title={(
                    <span className="flex items-center gap-2">
                      服装细节图
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                        {garmentDetailUrls.length}/{MAX_GARMENT_DETAIL_IMAGES}
                      </span>
                    </span>
                  )}
                  inputRef={garmentDetailInputRef}
                  onFiles={handleGarmentDetailFiles}
                  multiple
                  isDragging={isDraggingGarmentDetails}
                  setDragging={setIsDraggingGarmentDetails}
                  className="rounded-2xl border border-emerald-100 bg-emerald-50/35 p-3"
                >
                  {(openFileDialog) => (
                    garmentDetailUrls.length === 0 ? (
                      <StudioUploadTile
                        title="上传 / 拖拽服装细节"
                        description="面料、领口、口袋、背面、侧面、袖口、拉链、纽扣、logo 或局部特写。"
                        imageAlt="服装细节图"
                        isDragging={isDraggingGarmentDetails}
                        disabled={isUploadingGarmentDetails}
                        loading={isUploadingGarmentDetails}
                        supportBadge={`最多 ${MAX_GARMENT_DETAIL_IMAGES} 张`}
                        onUploadClick={openFileDialog}
                        uploadLabel="上传细节图"
                        loadingLabel="上传细节图..."
                        footnote={GARMENT_DETAIL_UPLOAD_FOOTNOTE}
                      />
                    ) : (
                      <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-2">
                          {garmentDetailUrls.map((url, index) => (
                            <div key={url} className="group relative overflow-hidden rounded-lg border-2 border-emerald-300 bg-white shadow-sm">
                              <button
                                type="button"
                                onClick={() => openLightbox(url, `服装细节图${index + 1}`)}
                                className="block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                                aria-label={`预览服装细节图${index + 1}`}
                              >
                                <img src={url} alt={`服装细节图${index + 1}`} className="aspect-[3/4] w-full object-cover" />
                                <span className="absolute bottom-1 left-1 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                                  细节{index + 1}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => removeGarmentDetail(url)}
                                className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/88 text-slate-500 shadow-sm transition hover:text-red-500"
                                aria-label={`移除服装细节图${index + 1}`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                          {garmentDetailUrls.length < MAX_GARMENT_DETAIL_IMAGES && (
                            <button
                              type="button"
                              onClick={openFileDialog}
                              disabled={isUploadingGarmentDetails}
                              className={`flex aspect-[3/4] flex-col items-center justify-center rounded-lg border-2 border-dashed bg-white text-emerald-500 transition hover:border-emerald-400 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 ${isDraggingGarmentDetails ? "border-emerald-400 bg-emerald-50" : "border-emerald-200"}`}
                              aria-label="添加服装细节图"
                            >
                              {isUploadingGarmentDetails ? <Loader2 className="mb-1 h-5 w-5 animate-spin" /> : <Upload className="mb-1 h-5 w-5" />}
                              <span className="text-xs font-semibold">添加</span>
                            </button>
                          )}
                        </div>
                        <p className="text-[11px] leading-relaxed text-emerald-700/85">
                          {GARMENT_DETAIL_UPLOAD_FOOTNOTE}
                        </p>
                      </div>
                    )
                  )}
                </StudioUploadSection>
              )}
            </div>
          </StudioSection>

          {/* ---- 服装人群 ---- */}
          <section className="rounded-2xl border border-violet-100 bg-white/78 p-3 shadow-sm">
            <div className="mb-2.5 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[13px] font-bold text-slate-900">
                  服装人群 <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">可选</span>
                </h3>
                <p className="mt-1 truncate text-[11px] text-slate-400">
                  影响人物性别线和年龄比例，默认女装成人。
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-500">
                影响比例
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {GARMENT_AUDIENCE_OPTIONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => updateGarmentAudience(value)}
                  className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium leading-none transition-all ${
                    garmentAudience === value
                      ? "border-violet-400 bg-violet-50 text-violet-700 shadow-sm"
                      : "border-slate-200 bg-white text-slate-500 hover:border-violet-200 hover:text-violet-600"
                  }`}
                >
                  {TRYON_GARMENT_AUDIENCE_LABELS[value]}
                </button>
              ))}
            </div>

            <div className="mt-2 grid grid-cols-6 gap-1.5">
              {AGE_GROUP_OPTIONS.map((value) => {
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => updateAgeGroup(value)}
                    className={`rounded-lg border px-1.5 py-1.5 text-[11px] font-medium leading-none transition-all ${
                      ageGroup === value
                        ? "border-violet-400 bg-violet-50 text-violet-700 shadow-sm"
                        : "border-slate-200 bg-white text-slate-500 hover:border-violet-200 hover:text-violet-600"
                    }`}
                  >
                    {TRYON_AGE_GROUP_LABELS[value]}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ---- 参考图（整个区域可拖拽） ---- */}
          <section
            {...referenceDrag.dragHandlers}
            className={`studio-stable-upload-boundary relative rounded-xl transition-all ${isDraggingRef ? "ring-2 ring-[rgba(91,124,255,0.38)] ring-offset-2" : ""}`}
          >
            {isDraggingRef && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-[rgba(91,124,255,0.58)] bg-[rgba(91,124,255,0.12)]">
                <div className="text-center">
                  <Upload className="mx-auto mb-1 h-7 w-7 text-[var(--codex-accent)]" />
                  <p className="text-xs font-semibold text-[var(--codex-accent)]">松开上传参考图</p>
                </div>
              </div>
            )}
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-sm flex items-center gap-2">
                  <Image className="w-4 h-4 text-purple-500" /> 参考图 / 场景
                </h3>
                <p className="mt-1 text-[11px] text-gray-400">默认上传参考图；切换 tab 会保留记录，生成只使用当前 tab 的参考图</p>
              </div>
              {sceneMode !== "auto_design" && (
                <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-semibold text-[var(--codex-accent)]">
                  最多 {MAX_TRYON_REFERENCE_IMAGES} 张
                </span>
              )}
            </div>

            <StudioOptionGrid
              options={visibleSceneModeTabs.map((tab) => ({
                value: tab.value,
                label: tab.label,
              }))}
              value={sceneMode}
              onChange={switchSceneMode}
              columns={3}
              ariaLabel="参考图 / 场景"
              className="tryon-scene-mode-tabs mb-3"
            />

            {false && sceneMode === "system_reference" && (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 p-3">
                {selectedReferenceImages.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setReferencePanelTab("recommended");
                      setActiveReferenceSceneUrl((prev) => prev || recommendedSystemReferences[0]?.url || allSystemReferences[0]?.url || null);
                      setIsReferenceScenePanelOpen(true);
                    }}
                    className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white/80 p-3 text-left transition hover:border-[var(--codex-accent)] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                    aria-label="打开系统参考图场景选择"
                  >
                    <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-100 shadow-sm">
                      <ImgSkeleton
                        src={recommendedSystemReferences[0]?.url || allSystemReferences[0]?.url || ""}
                        alt="推荐参考图"
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-900">选择参考图 <span className="font-medium text-slate-400">（可多选）</span></p>
                      <p className="mt-2 inline-flex max-w-full rounded-lg bg-orange-50 px-2 py-1 text-[11px] font-medium text-orange-600">
                        请选择尽量与服装图款式、角度一致的参考图，效果更佳
                      </p>
                      {clothingAnalysisLabel && (
                        <p className="mt-2 truncate text-[10px] font-semibold text-[var(--codex-accent)]">已识别：{clothingAnalysisLabel}</p>
                      )}
                      {(isAnalyzingClothing || isLoadingSystemReferences) && (
                        <p className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-violet-500">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {isAnalyzingClothing ? "识别服装中" : "推荐场景中"}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="h-7 w-7 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-[var(--codex-accent)]" />
                  </button>
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    {selectedReferenceImages.slice(0, 8).map((ref) => (
                      <button
                        key={ref.url}
                        type="button"
                        onClick={() => openLightbox(ref.url, ref.label || "参考图")}
                        className="group relative overflow-hidden rounded-lg border-2 border-[var(--codex-accent)] bg-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                        aria-label={`预览已选参考图：${ref.label}`}
                      >
                        <img src={ref.url} alt={ref.label || "参考图"} className="aspect-[3/4] w-full object-cover" />
                        <CheckCircle2 className="absolute right-1 top-1 h-4 w-4 rounded-full bg-[var(--codex-accent)] text-white" />
                      </button>
                    ))}
                    {!isReferenceScenePanelOpen && selectedReferenceCount < MAX_TRYON_REFERENCE_IMAGES && (
                      <button
                        type="button"
                        onClick={() => {
                          setReferencePanelTab("recommended");
                          setActiveReferenceSceneUrl((prev) => prev || recommendedSystemReferences[0]?.url || allSystemReferences[0]?.url || null);
                          setIsReferenceScenePanelOpen(true);
                        }}
                        className="flex aspect-[3/4] flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-white text-slate-400 transition hover:border-[var(--codex-accent)] hover:bg-violet-50/40 hover:text-[var(--codex-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                        aria-label="添加系统参考图"
                      >
                        <ChevronRight className="mb-1 h-6 w-6" />
                        <span className="text-xs font-medium">添加</span>
                      </button>
                    )}
                  </div>
                )}
                {referenceSelectionFooter}
              </div>
            )}

            {sceneMode === "upload_reference" && (
              <div className={`studio-reference-upload-panel rounded-xl border p-2.5 transition-colors ${isDraggingRef ? "border-[rgba(91,124,255,0.58)] bg-violet-50/50" : "border-[rgba(91,124,255,0.16)] bg-white/80"}`}>
                <input ref={customRefInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleCustomRef} disabled={selectedReferenceCount >= MAX_TRYON_REFERENCE_IMAGES || isReferenceUploadBusy} />
                {referenceAnalysisStatus && (
                  <div
                    className={`mb-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
                      referenceAnalysisStatus.tone === "loading"
                        ? "border-violet-100 bg-violet-50/70 text-violet-600"
                        : referenceAnalysisStatus.tone === "success"
                          ? "border-emerald-100 bg-emerald-50/80 text-emerald-700"
                          : "border-amber-100 bg-amber-50/80 text-amber-700"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {referenceAnalysisStatus.tone === "loading" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : referenceAnalysisStatus.tone === "success" ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      <span className="min-w-0 truncate" title={referenceAnalysisStatus.text}>{referenceAnalysisStatus.text}</span>
                    </div>
                    {!isAnalyzingReferences && referenceAnalysisSummaries.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5 pl-5">
                        {referenceAnalysisSummaries.slice(0, 4).map((item) => (
                          <span
                            key={item.key}
                            className={`inline-block max-w-full truncate rounded-md bg-white/70 px-2 py-1 text-[10px] font-medium leading-4 ${
                              referenceAnalysisStatus.tone === "warning" ? "text-amber-800" : "text-emerald-800"
                            }`}
                            title={[item.title, item.detail].filter(Boolean).join(" · ")}
                          >
                            {item.title}{item.detail ? ` · ${item.detail}` : ""}
                          </span>
                        ))}
                        {referenceAnalysisSummaries.length > 4 && (
                          <span className={`rounded-md bg-white/70 px-2 py-1 text-[10px] font-medium leading-4 ${
                            referenceAnalysisStatus.tone === "warning" ? "text-amber-700" : "text-emerald-700"
                          }`}>
                            另 {referenceAnalysisSummaries.length - 4} 张
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {showUploadReferenceEmptyTile ? (
                  <StudioUploadTile
                    title="上传 / 拖拽参考图"
                    description={`可上传 1-${MAX_TRYON_REFERENCE_IMAGES} 张人物姿势、场景或构图参考图。`}
                    imageAlt="服装上身参考图"
                    isDragging={isDraggingRef}
                    disabled={isReferenceUploadBusy}
                    loading={isReferenceUploadBusy}
                    supportBadge={`最多 ${MAX_TRYON_REFERENCE_IMAGES} 张`}
                    onUploadClick={() => customRefInputRef.current?.click()}
                    uploadLabel="从本地上传"
                    loadingLabel="上传参考图..."
                    footnote="拖拽图片到此区域也可以上传；参考图会作为人物姿势、场景、构图和光影来源。"
                    examples={{
                      label: "试一试",
                      images: PRESET_REFERENCES.slice(0, 6).map((item) => ({
                        url: item.url,
                        title: item.label,
                      })),
                      disabled: isReferenceUploadBusy,
                      onSelect: applyReferenceExample,
                    }}
                  />
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    {selectedReferenceImages.map((ref) => (
                      <div key={ref.url} className="group relative overflow-hidden rounded-lg border-2 border-[var(--codex-accent)] bg-white shadow-sm">
                        <button
                          type="button"
                          onClick={() => openLightbox(ref.url, ref.label || "参考图")}
                          className="block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                          aria-label={`预览参考图：${ref.label}`}
                        >
                          <img src={ref.url} alt={`参考图：${ref.label}`} className="aspect-[3/4] w-full object-cover" />
                          <span className="absolute inset-0 flex items-center justify-center bg-slate-950/0 opacity-0 transition group-hover:bg-slate-950/18 group-hover:opacity-100 group-focus-within:bg-slate-950/18 group-focus-within:opacity-100">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/92 text-slate-700 shadow-sm">
                              <ZoomIn className="h-4 w-4" />
                            </span>
                          </span>
                        </button>
                        <span className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--codex-accent)] text-white shadow-sm">
                          <CheckCircle2 className="h-4 w-4" />
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedReferences(selectedReferenceImages.filter((item) => item.url !== ref.url))}
                          className="absolute left-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/88 text-slate-500 shadow-sm transition hover:text-red-500"
                          aria-label={`移除参考图：${ref.label}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {visibleCustomRefUploads.map((item) => (
                      <div key={item.id} className="relative overflow-hidden rounded-lg border-2 border-dashed border-gray-200 bg-white">
                        <img src={item.preview} alt={item.label} className="aspect-[3/4] w-full object-cover opacity-70" />
                        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-white/70 text-[10px] font-bold text-[var(--codex-accent)] backdrop-blur-[1px]">
                          {item.status === "uploading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4 text-red-500" />}
                          {item.status === "uploading" ? "上传中" : "失败"}
                        </span>
                        {item.status === "error" && (
                          <button
                            type="button"
                            onClick={() => setCustomRefUploads((prev) => prev.filter((upload) => upload.id !== item.id))}
                            className="absolute right-1 top-1 z-[2] inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/88 text-slate-500 shadow-sm transition hover:text-red-500"
                            aria-label={`移除上传失败参考图：${item.label}`}
                            title={item.error || "上传失败"}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => customRefInputRef.current?.click()}
                      disabled={selectedReferenceCount >= MAX_TRYON_REFERENCE_IMAGES || isReferenceUploadBusy}
                      className={`flex aspect-[3/4] flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-dashed bg-white text-slate-400 transition-all hover:border-[var(--codex-accent)] hover:bg-violet-50/40 hover:text-[var(--codex-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${isDraggingRef ? "border-[var(--codex-accent)] bg-violet-50 text-[var(--codex-accent)]" : "border-gray-200"}`}
                      aria-label="上传参考图"
                    >
                      <ChevronRight className="mb-1 h-6 w-6" />
                      <span className="text-xs font-medium">添加</span>
                    </button>
                  </div>
                )}
                {referenceSelectionFooter}
              </div>
            )}

            {sceneMode === "auto_design" && (
              <div className="space-y-4 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                <div>
                  <p className="mb-2 text-xs font-bold text-gray-800">摄影方案</p>
                  <StudioOptionGrid
                    options={AUTO_DESIGN_PLATFORMS.map((item) => ({
                      value: item.value,
                      label: item.label,
                      description: item.desc,
                    }))}
                    value={resolvedAutoDesign.platform}
                    onChange={(platform) => {
                      setAutoDesign((prev) => normalizeAutoDesignSettings({ ...prev, platform }));
                      setPromptOverride(null);
                    }}
                    columns={2}
                    ariaLabel="摄影方案"
                  />
                </div>
                <div>
                  <p className="mb-2 text-xs font-bold text-gray-800">构图</p>
                  <StudioOptionGrid
                    options={AUTO_DESIGN_FRAMINGS.map((item) => ({
                      value: item.value,
                      label: item.label,
                    }))}
                    value={resolvedAutoDesign.framing}
                    onChange={(framing) => {
                      setAutoDesign((prev) => normalizeAutoDesignSettings({ ...prev, framing }));
                      setPromptOverride(null);
                    }}
                    columns={4}
                    ariaLabel="构图"
                  />
                </div>
                <div>
                  <p className="mb-2 text-xs font-bold text-gray-800">背景</p>
                  <StudioOptionGrid
                    options={autoDesignBackgroundOptions.map((item) => ({
                      value: item.value,
                      label: item.label,
                    }))}
                    value={resolvedAutoDesign.background}
                    onChange={(background) => {
                      setAutoDesign((prev) => normalizeAutoDesignSettings({ ...prev, background }));
                      setPromptOverride(null);
                    }}
                    columns={2}
                    ariaLabel="背景"
                  />
                </div>
              </div>
            )}

            {sceneMode === "favorites" && (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 p-3">
                {authIsAnonymous ? (
                  <div className="py-8 text-center text-xs text-gray-400">登录后查看收藏参考图</div>
                ) : isLoadingFavoriteReferences ? (
                  <div className="py-8 text-center text-xs text-gray-400 flex items-center justify-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    加载收藏中
                  </div>
                ) : favoriteReferences.length === 0 && referenceTemplates.length === 0 ? (
                  <div className="py-8 text-center text-xs text-gray-400">还没有收藏参考图</div>
                ) : (
                  <div className="space-y-3">
                    {referenceTemplates.length > 0 && (
                      <div>
                        <p className="mb-2 text-[11px] font-bold text-slate-600">参考模板</p>
                        <div className="grid grid-cols-2 gap-2">
                          {referenceTemplates.map((template) => (
                            <button
                              key={template.id}
                              type="button"
                              onClick={() => applyReferenceTemplate(template)}
                              className="group overflow-hidden rounded-lg border-2 border-transparent bg-white text-left transition hover:border-[var(--codex-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                              aria-label={`套用参考模板：${template.name}`}
                            >
                              <div className="relative aspect-[4/3] overflow-hidden">
                                <img src={template.coverUrl} alt={template.name} className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" />
                                <span className="absolute right-1 top-1 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-[var(--codex-accent)]">
                                  {template.references.length}张
                                </span>
                              </div>
                              <div className="px-2 py-1">
                                <p className="truncate text-[10px] font-bold text-slate-700">{template.name}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {favoriteReferences.length > 0 && (
                      <div>
                        <p className="mb-2 text-[11px] font-bold text-slate-600">单张收藏</p>
                        <div className="grid grid-cols-3 gap-2">
                    {favoriteReferences.map((ref) => {
                      const selected = isReferenceSelected(ref.url);
                      return (
                      <div key={ref.id} role="button" tabIndex={0}
                        aria-label={`选择收藏参考图：${ref.label}`}
                        onClick={() => {
                          if (!switchSceneMode("favorites")) return;
                          toggleReferenceImage(toFavoriteReference(ref));
                        }}
                        onKeyDown={(event) => handlePreviewKeyDown(event, () => {
                          if (!switchSceneMode("favorites")) return;
                          toggleReferenceImage(toFavoriteReference(ref));
                        })}
                        className={`group relative rounded-lg overflow-hidden border-2 bg-white transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${
                          selected ? "border-[var(--codex-accent)] ring-1 ring-blue-200" : "border-transparent hover:border-gray-300"
                        }`}>
                        <ImgSkeleton src={ref.url} alt={`收藏参考图：${ref.label}`} className="w-full aspect-[3/4] object-cover" />
                        {selected && (
                          <span className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--codex-accent)] text-white shadow-sm">
                            <CheckCircle2 className="h-4 w-4" />
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openLightbox(ref.url, `收藏参考图：${ref.label}`); }}
                          onKeyDown={(e) => { e.stopPropagation(); }}
                          className="absolute left-1 top-1 w-6 h-6 rounded-full bg-white/85 shadow-sm flex items-center justify-center opacity-100 transition-opacity hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                          aria-label={`预览收藏参考图：${ref.label}`}
                          title={`预览收藏参考图：${ref.label}`}
                        >
                          <ZoomIn className="w-3 h-3 text-gray-500" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeFavoriteReference(ref.id); }}
                          onKeyDown={(e) => { e.stopPropagation(); }}
                          className="absolute right-1 top-1 w-6 h-6 rounded-full bg-white/85 shadow-sm flex items-center justify-center opacity-100 transition-opacity hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                          aria-label={`移除收藏参考图：${ref.label}`}
                          title={`移除收藏参考图：${ref.label}`}
                        >
                          <X className="w-3 h-3 text-gray-500" />
                        </button>
                        <div className="p-1 text-center"><span className="text-[10px] font-medium">{ref.label}</span></div>
                      </div>
                    );})}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {referenceSelectionFooter}
              </div>
            )}
          </section>

          {/* ---- 模特（整个区域可拖拽·可选） ---- */}
          <section
            {...modelDrag.dragHandlers}
            className={`studio-stable-upload-boundary relative rounded-xl transition-all ${isDraggingModel ? "ring-2 ring-[rgba(91,124,255,0.38)] ring-offset-2" : ""}`}
          >
            {isDraggingModel && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-[rgba(91,124,255,0.48)] bg-[rgba(91,124,255,0.10)] pointer-events-none">
                <div className="text-center">
                  <Upload className="w-8 h-8 mx-auto text-[var(--codex-accent)] mb-1" />
                  <p className="text-sm font-medium text-[var(--codex-accent)]">松开上传模特图</p>
                </div>
              </div>
            )}
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-[13px] font-bold text-slate-900">
                  <UserRound className="h-4 w-4 text-purple-500" />
                  模特
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">可选</span>
                </h3>
                <p className="mt-1 text-[11px] text-gray-400">默认不选；上传或选择模特时只控制脸部身份</p>
              </div>
              <span className="shrink-0 rounded-full bg-violet-50 px-2 py-1 text-[10px] font-semibold text-[var(--codex-accent)]">
                可拖拽上传
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => {
                  if (isModelUploadBusy) {
                    toast.info("模特图上传中，请稍候");
                    return;
                  }
                  store.setSelectedModel(null);
                  setCustomModelPreview(null);
                  toast.success("已设为不替换脸部");
                }}
                disabled={isModelUploadBusy}
                className={`group relative overflow-hidden rounded-xl border bg-white text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                  !store.selectedModel
                    ? "border-[var(--codex-accent)] bg-[rgba(91,124,255,0.10)] shadow-sm ring-1 ring-blue-100"
                    : "border-slate-200 hover:border-[rgba(91,124,255,0.34)] hover:bg-violet-50/30"
                }`}
              >
                <span className="flex aspect-[4/5] items-center justify-center">
                  <span className="flex flex-col items-center gap-2">
                    <UserRound className={`h-7 w-7 ${!store.selectedModel ? "text-[var(--codex-accent)]" : "text-slate-300"}`} />
                    <span className={`text-[13px] font-bold ${!store.selectedModel ? "text-[var(--codex-accent)]" : "text-slate-400"}`}>
                      不选默认
                    </span>
                  </span>
                </span>
                <span className={`block border-t px-2 py-2 text-[11px] font-semibold ${!store.selectedModel ? "border-[rgba(91,124,255,0.12)] text-[var(--codex-accent)]" : "border-slate-100 text-slate-500"}`}>
                  不替换脸部
                </span>
              </button>
              {PRESET_MODELS.map((m) => (
                <div
                  key={m.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`选择模特：${m.name}`}
                  onClick={() => {
                    if (isModelUploadBusy) {
                      toast.info("模特图上传中，请稍候");
                      return;
                    }
                    setCustomModelPreview(null);
                    store.setSelectedModel({ ...m, is_preset: true, user_id: null });
                    setPromptOverride(null);
                  }}
                  onKeyDown={(event) => handlePreviewKeyDown(event, () => {
                    if (isModelUploadBusy) {
                      toast.info("模特图上传中，请稍候");
                      return;
                    }
                    setCustomModelPreview(null);
                    store.setSelectedModel({ ...m, is_preset: true, user_id: null });
                    setPromptOverride(null);
                  })}
                  className={`group relative overflow-hidden rounded-xl border bg-white transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${
                    isModelUploadBusy ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                  } ${
                    store.selectedModel?.id === m.id
                      ? "border-[var(--codex-accent)] shadow-sm ring-1 ring-blue-100"
                      : "border-slate-200 hover:border-[rgba(91,124,255,0.34)] hover:shadow-sm"
                  }`}>
                  <ImgSkeleton src={m.image_url} alt={`模特：${m.name}`} className="aspect-[4/5] w-full object-cover" />
                  {store.selectedModel?.id === m.id && (
                    <span className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--codex-accent)] text-white shadow-sm">
                      <CheckCircle2 className="h-4 w-4" />
                    </span>
                  )}
                  <div className="absolute inset-0 pointer-events-none flex items-end justify-end bg-violet-950/0 p-2 opacity-100 transition-all sm:opacity-0 sm:group-hover:bg-violet-950/10 sm:group-hover:opacity-100 sm:group-focus-within:bg-violet-950/10 sm:group-focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openLightbox(m.image_url, `模特：${m.name}`); }}
                      onKeyDown={(e) => { e.stopPropagation(); }}
                      className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                      aria-label={`预览模特：${m.name}`}
                      title={`预览模特：${m.name}`}
                    >
                      <ZoomIn className="h-4 w-4 text-gray-600" />
                    </button>
                  </div>
                  <div className={`border-t px-2 py-2 text-center ${store.selectedModel?.id === m.id ? "border-[rgba(91,124,255,0.12)] bg-blue-50" : "border-slate-100"}`}>
                    <span className="block truncate text-[11px] font-bold text-slate-800">{m.name}</span>
                  </div>
                </div>
              ))}
              <div
                role="button"
                tabIndex={0}
                onClick={() => customModelInputRef.current?.click()}
                onKeyDown={(event) => handlePreviewKeyDown(event, () => customModelInputRef.current?.click())}
                className={`group relative overflow-hidden rounded-xl border bg-white text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${
                  isModelUploadBusy ? "cursor-not-allowed opacity-80" : "cursor-pointer"
                } ${
                  isCustomModelSelected
                    ? "border-[var(--codex-accent)] shadow-sm ring-1 ring-blue-100"
                    : "border-dashed border-slate-200 hover:border-[rgba(91,124,255,0.38)] hover:bg-violet-50/30"
                }`}
                aria-label={customModelImageUrl ? "更换上传模特图" : "上传模特图"}
              >
                <span className="flex aspect-[4/5] items-center justify-center overflow-hidden bg-slate-50">
                  {customModelImageUrl
                    ? <img src={customModelImageUrl} alt="已上传的模特图" className="h-full w-full object-cover" />
                    : (
                      <span className="flex flex-col items-center gap-2 px-3 text-slate-400">
                        <Camera className="h-7 w-7" />
                        <span className="text-[13px] font-bold text-slate-500">上传模特脸</span>
                        <span className="text-[10px] leading-4 text-slate-400">只参考脸，不参考姿势</span>
                        <span className="text-[10px] text-slate-300">≤{MAX_FILE_SIZE_MB}MB</span>
                      </span>
                    )
                  }
                </span>
                {isCustomModelSelected && (
                  <span className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--codex-accent)] text-white shadow-sm">
                    <CheckCircle2 className="h-4 w-4" />
                  </span>
                )}
                {customModelImageUrl && (
                  <div className="absolute inset-0 pointer-events-none flex items-end justify-end bg-violet-950/0 p-2 opacity-100 transition-all sm:opacity-0 sm:group-hover:bg-violet-950/10 sm:group-hover:opacity-100 sm:group-focus-within:bg-violet-950/10 sm:group-focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openLightbox(customModelImageUrl, "已上传的模特图");
                      }}
                      onKeyDown={(event) => { event.stopPropagation(); }}
                      className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                      aria-label="预览上传模特图"
                      title="预览上传模特图"
                    >
                      <ZoomIn className="h-4 w-4 text-gray-600" />
                    </button>
                  </div>
                )}
                <span className={`block truncate border-t px-2 py-2 text-[11px] font-bold ${
                  isCustomModelSelected ? "border-[rgba(91,124,255,0.12)] bg-blue-50 text-slate-800" : "border-slate-100 text-slate-500"
                }`}>
                  {customModelImageUrl ? "已上传" : "上传"}
                </span>
                {isModelUploadBusy && (
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl bg-white/78 text-[11px] font-bold text-[var(--codex-accent)] backdrop-blur-[1px]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    上传中
                  </span>
                )}
              </div>
              <input ref={customModelInputRef} type="file" accept="image/*" className="hidden" onChange={handleCustomModel} disabled={isModelUploadBusy} />
            </div>
          </section>

          {/* ---- 生成模型 ---- */}
          <section>
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-500" /> 生成模型
            </h3>
            <StudioModelSelector
              models={selectableModels}
              value={aiModel}
              onChange={(value) => {
                if (hasModelFace && isNanoBananaModel(value)) {
                  toast.info(TRYON_FACE_MODEL_BANANA_NOTICE);
                  return;
                }
                setAiModel(value);
              }}
              ariaLabel="生成模型"
              getMeta={(model) => (
                hasModelFace && isNanoBananaModel(model.value)
                  ? "带模特脸时暂不可用"
                  : `${model.desc} · 当前${getCreditCost(model.value, imageSize, aspectRatio)}分`
              )}
            />
            {hasModelFace && (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
                已选择模特脸，Banana 会临时关闭。当前推荐用 GPT-Image-2 做“参考图 + 模特脸”融合；如果想保留 Banana 的换装质感，先取消模特脸完成换装，再去
                <a href="/face-swap" className="mx-1 font-bold text-amber-900 underline decoration-amber-400 underline-offset-2">换脸模块</a>
                替换脸部。
              </div>
            )}
          </section>

          {/* ---- 比例 ---- */}
          <section>
            <h3 className="font-bold text-sm mb-3">图片比例</h3>
            <StudioOptionGrid options={aspects} value={aspectRatio} onChange={setAspectRatio} ariaLabel="图片比例" />
          </section>

          {/* ---- 分辨率 ---- */}
          {imageSizes.length > 1 && (
            <section>
              <h3 className="font-bold text-sm mb-3">分辨率</h3>
              <StudioOptionGrid
                options={imageSizes.map((size) => ({ value: size, label: `${size} · ${getCreditCost(aiModel, size, aspectRatio)}灵点` }))}
                value={imageSize}
                onChange={setImageSize}
                ariaLabel="分辨率"
              />
            </section>
          )}

          {/* ---- 细节补充 + 智能整理 ---- */}
          <section>
            <StudioPromptTextarea
              title="补充要求"
              badge="可选"
              value={customStyle}
              onChange={(e) => { setCustomStyle(e.target.value); setPromptOverride(null); store.setPromptUsed(""); }}
              placeholder="可选：补充不改变主风格的细节要求，如面料、肤色、光线、商品细节..."
              rows={4}
              action={(
                <button
                  type="button"
                  onClick={handleOptimizePrompt}
                  disabled={optimizing || !customStyle.trim()}
                  className="studio-prompt-icon-action"
                  title="智能整理提示词"
                >
                  {optimizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand className="w-3.5 h-3.5" />}
                </button>
              )}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {STYLE_PRESETS.map((s, i) => (
                <button key={i} onClick={() => { setCustomStyle(s); setPromptOverride(null); store.setPromptUsed(""); }}
                  className="px-2 py-0.5 rounded-full bg-gray-50 border text-[10px] text-gray-500 hover:bg-purple-50 hover:text-purple-600 transition-all">{s}</button>
              ))}
            </div>

          </section>

          {/* ---- 生成数量 ---- */}
          <StudioSection title="生成数量" description="结果张数越多，消耗灵点越高。">
            <StudioGenerationCountSelector
              value={genCount}
              onChange={setGenCount}
              ariaLabel="选择生成数量"
            />
          </StudioSection>
          </StudioControlPanel>
        )}
        runBar={(
          <StudioRunBar
            summary={`${TRYON_CLOTHING_MODE_LABELS[clothingMode]} · ${store.clothingFiles.length} 张输入${activeGarmentDetailUrls.length ? ` · ${activeGarmentDetailUrls.length} 张细节` : ""} · ${sceneMode === "auto_design" ? "自动设计" : `${selectedReferenceCount} 张参考`} · ${costPerImage} × ${expectedOutputCount} 张`}
            costLabel={authIsAnonymous ? "登录后查看灵点" : `消耗 ${totalCost} · 余额 ${credits ?? "—"}`}
            disabled={runDisabled}
            disabledReason={runDisabledReason}
            primaryLabel={authIsAnonymous ? "登录后生成" : isSubmitting ? "提交中..." : `生成 ${expectedOutputCount} 张`}
            isLoading={isSubmitting}
            onPrimaryAction={() => handleGenerate()}
          />
        )}

        canvas={(
          <StudioResultViewport
            status={resultStatus}
            emptyState={(
              <div className="flex min-h-[320px] items-center justify-center p-4 sm:min-h-[420px] lg:h-full">
                <StudioEmptyState
                  title="开始制作服装上身图"
                  description="先选择上装、下装或连体槽位，再选择模特和场景，生成可直接用于商品展示的成片。"
                  imageSrc="https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/model-striped-top-white-skirt.png"
                  imageAlt="服装上身指引"
                  steps={[
                    { title: "选择槽位", description: "换上下装时明确上传上装或下装；换连体时上传整件连体/全身服装。" },
                    { title: "选择模特 / 场景", description: "可用系统模特、上传模特图；场景参考只控制姿势、背景、构图和镜头。" },
                    { title: "生成上身图", description: "保持服装款式、颜色、图案和穿搭关系不变，输出真实成片。" },
                  ]}
                  actions={(
                    <>
                      <button
                        type="button"
                        onClick={() => openClothingPicker(clothingMode === "multi" ? "upper" : "single")}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                      >
                        <Upload className="h-3.5 w-3.5" /> 上传服装
                      </button>
                      <button
                        type="button"
                        onClick={() => sourceLibrary.open(clothingMode === "multi" ? "upper" : "single")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-violet-200 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                      >
                        <FolderOpen className="h-3.5 w-3.5" /> 从作品库选择
                      </button>
                    </>
                  )}
                />
              </div>
            )}
            loadingState={(
              <LoadingStage
                genCount={genCount}
                progress={store.generationProgress}
                moduleName="服装上身"
                referenceImages={[
                  { label: clothingMode === "multi" ? "上装/下装参考" : "连体服装参考", url: store.clothingPreviews[0] },
                  { label: "模特参考", url: store.selectedModel?.image_url },
                  ...selectedReferenceImages.map((item, index) => ({ label: `姿势/场景参考${selectedReferenceImages.length > 1 ? index + 1 : ""}`, url: item.url })),
                  ...activeGarmentDetailUrls.map((url, index) => ({ label: `服装细节${index + 1}`, url })),
                ]}
                metaItems={[aspectRatio, imageSize, sceneMode === "auto_design" ? "自动设计" : `${selectedReferenceCount} 张参考`, activeGarmentDetailUrls.length ? `${activeGarmentDetailUrls.length} 张细节` : ""].filter(Boolean)}
              />
            )}
            errorState={store.error ? (
              <ErrorStage
                error={store.error}
                onRetry={() => { store.setError(null); handleGenerate(); }}
                onRepair={handleRepairGenerate}
                isGenerating={store.isGenerating}
                retryDisabled={retryDisabled}
                retryLabel={applyingTaskId ? "正在套用..." : undefined}
                repairKind="tryon"
              />
            ) : null}
            results={(
              <div className="relative min-h-[320px] sm:min-h-[420px] lg:h-full">
                <div className="studio-result-stage min-h-[320px] overflow-y-auto overflow-x-hidden p-4 sm:min-h-[420px] sm:p-6 lg:h-full">
                  <div className="flex min-h-full items-start justify-start">
                    <ResultImageGrid
                      urls={store.resultUrls}
                      filenamePrefix="tryon"
                      onOpen={(_, index) => setPreviewIndex(index)}
                      imageAltPrefix="服装上身结果"
                      expectedCount={activeResultExpectedCount}
                      isGenerating={store.isGenerating}
                      inputThumbnails={safeTaskQueueUrls(activeQueueTask?.inputThumbnails)}
                      inputReferences={activeTaskReferences}
                      createdAt={activeQueueTask?.createdAt}
                      statusGroup={activeQueueTask?.statusGroup}
                      variant="task"
                      renderKey={activeQueueTask?.id || "tryon-create"}
                      markMissingAsFailed={hasCompletedPartialResults}
                      missingFailureLabel="本张生成失败"
                      missingFailureDetail="成功图片可正常使用，失败张数已按任务结算处理。"
                    />
                  </div>
                </div>

                <StudioImagePreviewDialog
                  open={previewIndex !== null}
                  onClose={() => setPreviewIndex(null)}
                  session={tryonPreviewSession}
                  selectedIndex={previewIndex || 0}
                  onSelectedIndexChange={setPreviewIndex}
                  filenamePrefix="tryon"
                  actions={TRYON_PREVIEW_ACTIONS}
                  onRegenerateAll={handleContinueCreate}
                />
              </div>
            )}
          />
        )}
      />

      <TryOnSourceLibraryDialog
        open={sourceLibrary.role !== null}
        targetLabel={sourceLibrary.targetLabel}
        items={sourceLibrary.items}
        isLoading={sourceLibrary.isLoading}
        error={sourceLibrary.error}
        onClose={sourceLibrary.close}
        onRefresh={sourceLibrary.load}
        onSelect={applySourceLibraryItem}
      />

      {showClothingRules && rulesPopoverStyle && (
        <ClientPortal>
          <div
            className="fixed z-[240] w-[min(760px,calc(100vw-32px))] overflow-hidden rounded-[24px] border border-white/80 bg-white/[0.96] shadow-[0_28px_90px_rgba(15,23,42,0.18)] backdrop-blur-2xl animate-fade-in"
            style={{
              top: rulesPopoverStyle.top,
              left: rulesPopoverStyle.left,
              maxHeight: rulesPopoverStyle.maxHeight,
            }}
            onMouseEnter={cancelRulesHide}
            onMouseLeave={scheduleRulesHide}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-500">{currentUploadRule.shortTitle}</p>
                <h3 className="mt-1 text-base font-bold text-slate-950">{currentUploadRule.title}</h3>
                <p className="mt-1 text-xs text-slate-500">{currentUploadRule.uploadSpecText}</p>
              </div>
              <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-600">Hover 预览</span>
            </div>

            <div className="studio-scrollbar-hide overflow-y-auto px-5 py-4" style={{ maxHeight: rulesPopoverStyle.maxHeight - 88 }}>
              <div className={`grid gap-3 ${clothingMode === "multi" ? "md:grid-cols-3" : "md:grid-cols-5"}`}>
                {currentUploadRule.demos.map((demo, demoIndex) => (
                  <div key={`${clothingMode}-${demo.title}-${demoIndex}`} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-2">
                    <div className={`grid gap-1 ${demo.images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                      {demo.images.map((image, imageIndex) => (
                        <div key={`${demo.title}-${image.role}-${imageIndex}-${image.url}`} className="relative overflow-hidden rounded-xl bg-white">
                          <img src={image.url} alt={image.title} className="aspect-square w-full object-cover" />
                          <CheckCircle2 className="absolute right-2 top-2 h-5 w-5 rounded-full bg-white text-emerald-500" />
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-slate-700">{demo.title}</p>
                      <button
                        type="button"
                        onClick={() => applyRuleDemo(demo)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-violet-200 hover:text-violet-600"
                      >
                        试一试
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-2xl bg-red-50/40 p-3">
                <p className="mb-3 text-center text-xs font-medium text-slate-500">{currentUploadRule.deprecatedTitle}</p>
                <div className="mx-auto grid max-w-lg grid-cols-3 gap-3">
                  {currentUploadRule.deprecatedImages.map((image) => (
                    <div key={image.title} className="rounded-2xl border border-red-100 bg-white/70 p-2 text-center">
                      <div className="relative overflow-hidden rounded-xl bg-white">
                        <img src={image.url} alt={image.title} className="aspect-square w-full object-cover" />
                        <XCircle className="absolute right-2 top-2 h-5 w-5 rounded-full bg-white text-red-500" />
                      </div>
                      <p className="mt-2 text-xs font-medium text-slate-600">{image.title}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </ClientPortal>
      )}

      <ReferenceScenePicker
        open={false && isReferenceScenePanelOpen}
        tabs={[
          { value: "recommended", label: "推荐场景" },
          { value: "exclusive", label: "专属场景" },
          { value: "all", label: "全部场景" },
        ]}
        activeTab={referencePanelTab}
        onTabChange={(tab) => {
          setReferencePanelTab(tab);
          setActiveReferenceSceneUrl(null);
        }}
        mainReferences={referencePanelMainReferences}
        activeReference={activeReferenceScene}
        childReferences={activeReferenceSceneChildren}
        selectedCount={selectedReferenceCount}
        maxSelected={MAX_TRYON_REFERENCE_IMAGES}
        categoryLabels={(clothingAnalysis?.subcategories || [])
          .slice(0, 2)
          .map((category) => TRYON_CATEGORY_BY_CODE.get(category)?.nameZh || category)}
        viewFilter={referencePanelViewFilter}
        onViewFilterChange={setReferencePanelViewFilter}
        bodyFilter={referencePanelBodyFilter}
        onBodyFilterChange={setReferencePanelBodyFilter}
        search={referencePanelSearch}
        onSearchChange={setReferencePanelSearch}
        isSelected={isReferenceSelected}
        onActiveReferenceChange={setActiveReferenceSceneUrl}
        onToggleReference={(ref) => {
          if (!switchSceneMode("upload_reference")) return;
          toggleReferenceImage(ref as SelectedReferenceImage);
        }}
        onClearSelected={clearSelectedReferences}
        onClose={() => setIsReferenceScenePanelOpen(false)}
        onConfirm={() => setIsReferenceScenePanelOpen(false)}
        onPreview={(url, label) => openLightbox(url, label || "主场景")}
      />

      {/* ========== 大图 Lightbox ========== */}
      {lightboxImage && (
        <ClientPortal>
          <div
            className="fixed inset-0 z-[180] flex cursor-zoom-out items-center justify-center bg-slate-950/66 p-4 backdrop-blur-xl sm:p-8"
            role="dialog"
            aria-modal="true"
            aria-label={lightboxImage.alt}
            onClick={() => setLightboxImage(null)}
          >
            <img
              src={lightboxImage.src}
              alt={lightboxImage.alt}
              className="max-h-full max-w-full rounded-2xl object-contain shadow-[0_32px_120px_rgba(0,0,0,0.45)]" />
            <button
              type="button"
              onClick={() => setLightboxImage(null)}
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/85 bg-white/90 text-slate-700 shadow-[0_12px_34px_rgba(15,23,42,0.22)] backdrop-blur transition-colors hover:bg-white hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:right-6 sm:top-6"
              aria-label="关闭图片预览"
              title="关闭图片预览"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </ClientPortal>
      )}

    </>
  );
}

function getTryOnStatusPollDelayMs(attempts: number) {
  if (attempts < 1) return 5_000;
  if (attempts < 3) return 7_000;
  if (attempts < 8) return 10_000;
  return 15_000;
}

function waitForTryOnStatusPoll(attempts: number, signal: AbortSignal) {
  const delay = typeof document !== "undefined" && document.visibilityState === "hidden"
    ? TRYON_STATUS_HIDDEN_POLL_MS
    : getTryOnStatusPollDelayMs(attempts);
  return waitForAbortableDelay(delay, signal);
}

function getTryOnStatusPollTimeoutMs(expectedCount: number) {
  const count = Math.max(1, Math.min(Math.round(Number(expectedCount) || 1), MAX_TRYON_OUTPUT_IMAGES));
  const dynamicTimeout = TRYON_STATUS_POLL_BASE_TIMEOUT_MS + count * TRYON_STATUS_POLL_PER_IMAGE_MS;
  return Math.min(Math.max(dynamicTimeout, TRYON_STATUS_POLL_BASE_TIMEOUT_MS), TRYON_STATUS_POLL_MAX_TIMEOUT_MS);
}

function waitForAbortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function fetchTryOnGenerationStatus(generationId: string, watcherSignal: AbortSignal) {
  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  watcherSignal.addEventListener("abort", relayAbort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), TRYON_STATUS_FETCH_TIMEOUT_MS);

  try {
    return await fetch(`/api/tryon?generation_id=${encodeURIComponent(generationId)}`, {
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
    watcherSignal.removeEventListener("abort", relayAbort);
  }
}

function isAbortLikeError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
