"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronRight, Loader2, Minus, PenLine, Plus, Sparkles, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { setCachedProfileCredits } from "@/lib/supabase/client";
import { isLikelyImageFile, MAX_FILE_SIZE, MAX_FILE_SIZE_MB, uploadImage } from "@/lib/utils";
import { getCreditCost, getSupportedImageSizes, type AspectRatio, type ImageSize, type LingyaModel } from "@/lib/api/lingya";
import { FeatureTabs } from "@/components/FeatureTabs";
import { ClientPortal } from "@/components/ClientPortal";
import { type PoseOutputMode } from "@/lib/pose-prompt";
import {
  buildPoseVisualAnalysisKey,
  fallbackPoseVisualAnalysis,
  getPoseVisualAnalysisDetailItems,
  getPoseVisualAnalysisSummary,
  normalizePoseVisualAnalysis,
  shouldSuppressPoseFacePlanning,
  type PoseVisualAnalysis,
} from "@/lib/pose-analysis";
import {
  DEFAULT_POSE_ANGLE_COUNTS,
  POSE_PLAN_ANGLE_LABELS,
  POSE_PLAN_MAX_COUNT,
  POSE_PLAN_MIN_COUNT,
  buildPosePlanCacheKey,
  buildDefaultPoseAngleCounts,
  getCommercialPoseActionPresets,
  getCommercialPoseExpressionPresets,
  getPoseAngleTotal,
  getPosePlanSummary,
  normalizePoseAngleCounts,
  normalizePosePlan,
  normalizePosePlanCount,
  type PoseAngleCounts,
  type PosePlanAngle,
  type PosePlan,
} from "@/lib/pose-plan";
import { ModuleHeader } from "@/components/ModuleHeader";
import { PreviewGuide } from "@/components/PreviewGuide";
import { ErrorStage } from "@/components/studio/ErrorStage";
import { ModuleTaskRail } from "@/components/studio/ModuleTaskRail";
import { useStudioAuth } from "@/components/studio/useStudioAuth";
import type { TaskSelectionSession } from "@/components/studio/useTaskSelectionSession";
import { ResultImageGrid } from "@/components/ResultImageGrid";
import { StudioImagePreviewDialog } from "@/components/studio/StudioImagePreviewDialog";
import { StudioModelSelector, StudioOptionGrid, StudioPromptTextarea } from "@/components/studio/StudioFormControls";
import { StudioRunBar } from "@/components/studio/StudioRunBar";
import { StudioMultiImageUpload } from "@/components/studio/StudioMultiImageUpload";
import { StudioUploadSection } from "@/components/studio/StudioUploadSection";
import { StudioUploadTile } from "@/components/studio/StudioUploadTile";
import { VisualAnalysisStatusCard, type VisualAnalysisSummaryItem } from "@/components/studio/VisualAnalysisStatus";
import { RawPreviewImage } from "@/components/studio/RawPreviewImage";
import { useStableFileDrag } from "@/components/studio/useStableFileDrag";
import { useTaskQueueGeneration } from "@/components/studio/useTaskQueueGeneration";
import { fetchHistoryApplyDetail, getHistoryApplyFailureMessage, isHistoryApplyRowFailed, takeApplyDetail, type HistoryJobPayload } from "@/lib/history-apply";
import { clampTaskExpectedCount, safeTaskQueueUrls, type TaskQueueItem } from "@/lib/task-queue";
import { showInsufficientCreditsToast } from "@/lib/ui/credit-copy";
import { createGenericImagePreviewSession, takeSourceImageFromLocation, type ImagePreviewAction } from "@/lib/studio-image-preview";
import { FAILED_RETRY_NOTICE, buildPartialFailureDetail, summarizeGenerationError } from "@/lib/studio-generation-feedback";
import {
  DEFAULT_POSE_SERIES_STYLE,
  type PoseSeriesStyle,
} from "@/lib/module-style-presets";
import { POSE_UPLOAD_RULE, type PoseRuleDemo } from "@/lib/pose-upload-rules";
import {
  GARMENT_ANGLE_TARGET_OPTIONS,
  GARMENT_ANGLE_UPLOAD_FOOTNOTE,
  GARMENT_ANGLE_VIEW_OPTIONS,
  MAX_GARMENT_ANGLE_IMAGES,
  flattenGarmentAngleReferences,
  formatGarmentAngleReferenceLabel,
  normalizeGarmentAngleReferences,
  type GarmentAngleReference,
  type GarmentAngleTarget,
  type GarmentAngleView,
} from "@/lib/garment-angle-references";
import { MAX_POSE_REFERENCE_IMAGES, normalizePoseReferenceCopies, normalizePoseReferenceUrls } from "@/lib/pose-reference";
import {
  buildRetryPendingResultUrls,
  getRetryDisplayExpectedCount,
  mergeRetryResultUrls,
  normalizeRetryResultIndex,
} from "@/lib/result-slot-retry";

const MODELS: { value: LingyaModel; label: string; desc: string; badge?: string; icon: string }[] = [
  { value: "nano-banana-2", label: "Nano-Banana-2", desc: "最高4K", badge: "推荐", icon: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/model-icons/gemini.png" },
  { value: "gpt-image-2", label: "GPT-Image-2", desc: "最高4K", badge: "最新", icon: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/model-icons/openai.svg" },
  { value: "nano-banana-pro", label: "Nano-Banana-Pro", desc: "最高4K", badge: "推荐", icon: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/model-icons/gemini.png" },
];

const POSE_GENERATION_POLL_TIMEOUT_MS = 4 * 60 * 1000;
const POSE_GENERATION_POLL_FAST_WINDOW_MS = 30 * 1000;
const POSE_GENERATION_POLL_FAST_MS = 3 * 1000;
const POSE_GENERATION_POLL_SLOW_MS = 5 * 1000;
const POSE_ANALYSIS_CLIENT_CACHE_MIN_CONFIDENCE = 0.5;

const POSE_PREVIEW_ACTIONS: ImagePreviewAction[] = [
  { kind: "download", label: "下载图片" },
  { kind: "copy", label: "复制链接" },
  { kind: "repair", label: "AI修图" },
  { kind: "aiVideo", label: "AI视频" },
  { kind: "modelBackground", label: "换背景" },
  { kind: "productSet", label: "商品套图" },
  { kind: "regenerateAll", label: "重新创作" },
  { kind: "feedback", label: "反馈" },
];

const ASPECTS: { value: AspectRatio; label: string; description?: string }[] = [
  { value: "auto", label: "智能", description: "按主图匹配" },
  { value: "3:4", label: "3:4", description: "竖版" },
  { value: "4:5", label: "4:5", description: "商品图" },
  { value: "1:1", label: "1:1", description: "方图" },
  { value: "9:16", label: "9:16", description: "手机竖屏" },
  { value: "16:9", label: "16:9", description: "横屏" },
];

const POSE_REFERENCE_DEMOS = [
  {
    title: "蓝裙商业姿势组",
    imageUrls: [
      "/pose-reference-demos/vwg-pose-0617-0835-01.jpg",
      "/pose-reference-demos/vwg-pose-0617-0836-02.jpg",
      "/pose-reference-demos/vwg-pose-0617-0836-03.jpg",
      "/pose-reference-demos/vwg-pose-0617-0836-04.jpg",
    ],
  },
];

type PoseHistoryPayload = Extract<HistoryJobPayload, { kind: "pose" }>;
type PoseCreationMode = "free" | "reference";
type PoseGenerateOptions = {
  genCountOverride?: number;
  expectedCountOverride?: number;
  poseStartIndex?: number;
  retryResultIndex?: number;
  toastMessage?: string;
};
type PoseAnalysisSource = "vision" | "cache" | "fallback" | "history";
type PoseAnalysisEntry = {
  analysis: PoseVisualAnalysis;
  source: PoseAnalysisSource;
  error: string | null;
};
type PosePlanMode = "preset" | "ai";
type PosePlanSource = "vision_plan" | "cache" | "fallback" | "preset" | "history" | "user_custom";
type PosePlanEntry = {
  plan: PosePlan;
  source: PosePlanSource;
  error: string | null;
};

const POSE_PLAN_SOURCE_LABELS: Record<PosePlanSource, string> = {
  vision_plan: "智能优化",
  cache: "缓存规划",
  fallback: "保守规划",
  preset: "预设计划",
  history: "历史规划",
  user_custom: "已编辑",
};

const DEFAULT_POSE_PROMPT = `图1是唯一的人物、服装、背景、光线和整体摄影质感参考。
目标：基于商业模特拍摄动作库，生成明确不同的姿势变化；同一角度多张也必须在手势、重心、视线、表情和构图上有可察觉差异。
保持：同一个人、同一张脸、同一身体比例、同一套服装、同一颜色图案、同一面料纹理、同一场景光线和真实商业摄影质感。
允许：根据每个姿势自然调整身体角度、手部动作、表情视线、镜头距离和构图留白。
禁止：换脸、换衣服、改变体型比例、额外人物、拼贴、文字水印、畸形手指、断肢、夸张回眸、过度摆拍。`;

const POSE_ANGLE_OPTIONS: Array<{
  value: PosePlanAngle;
  label: string;
  desc: string;
  hint: string;
}> = [
  {
    value: "front",
    label: "正面展示",
    desc: "保留正脸、正面轮廓和完整穿搭。",
    hint: "适合主图、首图和服装正面卖点。",
  },
  {
    value: "side",
    label: "侧身变化",
    desc: "侧身、三分之二侧身和自然转身。",
    hint: "让版型、肩线、腰线和身体线条更立体。",
  },
  {
    value: "back",
    label: "背面/侧后",
    desc: "生成背面、侧后或回身角度。",
    hint: "建议补一张同款背面图，背后结构会更准。",
  },
  {
    value: "detail",
    label: "近景细节",
    desc: "生成领口、袖口、腰线、面料等近景成片。",
    hint: "这是输出画面类型，不是上传服装细节图。",
  },
];

const POSE_ANGLE_PRESETS: Array<{
  id: string;
  label: string;
  countLabel: string;
  desc: string;
  counts: PoseAngleCounts;
}> = [
  {
    id: "recommended",
    label: "推荐组合",
    countLabel: "4 张",
    desc: "正面 + 侧身 + 近景",
    counts: { front: 1, side: 2, back: 0, detail: 1 },
  },
  {
    id: "commerce",
    label: "电商四视角",
    countLabel: "4 张",
    desc: "含背面",
    counts: { front: 1, side: 1, back: 1, detail: 1 },
  },
  {
    id: "sequence",
    label: "连拍扩展",
    countLabel: "8 张",
    desc: "更多动作变化",
    counts: { front: 2, side: 3, back: 1, detail: 2 },
  },
];

type PosePlanSlot = PosePlan["slots"][number];
type PosePlanSlotPatch = Partial<Pick<PosePlanSlot, "poseName" | "bodyAction" | "handAction" | "headDirection" | "cameraFraming" | "garmentVisibilityRule">>;

function isSamePoseAngleCounts(left: PoseAngleCounts, right: PoseAngleCounts) {
  return (Object.keys(POSE_PLAN_ANGLE_LABELS) as PosePlanAngle[])
    .every((angle) => left[angle] === right[angle]);
}

function normalizePoseSelectorText(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function getSelectedActionPresetId(slot: PosePlanSlot | null | undefined) {
  if (!slot) return "current";
  const source = normalizePoseSelectorText([slot.poseName, slot.bodyAction, slot.handAction].filter(Boolean).join(" "));
  const poseName = normalizePoseSelectorText(slot.poseName || "");
  const preset = getCommercialPoseActionPresets(slot.angle).find((item) => {
    const label = normalizePoseSelectorText(item.label);
    const body = normalizePoseSelectorText(item.bodyAction);
    const hand = normalizePoseSelectorText(item.handAction);
    const keywordMatched = item.matchKeywords?.some((keyword) => source.includes(normalizePoseSelectorText(keyword)));
    return item.label === slot.poseName
      || item.bodyAction === slot.bodyAction
      || source.includes(label)
      || Boolean(poseName && label.includes(poseName))
      || Boolean(body.length >= 14 && source.includes(body.slice(0, 14)))
      || Boolean(hand.length >= 10 && source.includes(hand.slice(0, 10)))
      || Boolean(keywordMatched);
  });
  return preset?.id || "current";
}

function getSelectedExpressionPresetId(slot: PosePlanSlot | null | undefined) {
  if (!slot) return "current";
  const source = normalizePoseSelectorText(slot.headDirection || "");
  const preset = getCommercialPoseExpressionPresets(slot.angle).find((item) => {
    const text = normalizePoseSelectorText(item.text);
    const label = normalizePoseSelectorText(item.label);
    return item.text === slot.headDirection
      || source.includes(label)
      || source.includes(text.slice(0, 10));
  });
  return preset?.id || "current";
}

function getPoseAngleBadgeClass(angle?: PosePlanAngle) {
  const base = "rounded-full px-1.5 py-0.5 text-[9px] font-black ring-1";
  if (angle === "front") return `${base} bg-zinc-100 text-zinc-700 ring-zinc-200`;
  if (angle === "side") return `${base} bg-zinc-100 text-zinc-700 ring-zinc-200`;
  if (angle === "back") return `${base} bg-amber-50 text-amber-700 ring-amber-100`;
  if (angle === "detail") return `${base} bg-teal-50 text-teal-700 ring-teal-100`;
  return `${base} bg-slate-100 text-slate-500 ring-slate-200`;
}

function resolvePoseOutputModeFromPayload(payload: PoseHistoryPayload): PoseOutputMode {
  return payload.outputMode === "grid" ? "grid" : "separate";
}

function resolvePoseAngleCountsFromPayload(payload: PoseHistoryPayload): PoseAngleCounts {
  if (payload.angleCounts) return normalizePoseAngleCounts(payload.angleCounts);
  if (payload.posePlan?.angleCounts) return normalizePoseAngleCounts(payload.posePlan.angleCounts);
  const slotCounts = payload.posePlan?.slots?.reduce((counts, slot) => {
    if (slot.angle) counts[slot.angle] += 1;
    return counts;
  }, { front: 0, side: 0, back: 0, detail: 0 } as PoseAngleCounts);
  if (slotCounts && getPoseAngleTotal(slotCounts) > 0) return normalizePoseAngleCounts(slotCounts);
  const payloadCount = payload.poseCount || payload.posePlan?.slots?.length || payload.genCount || 4;
  return buildDefaultPoseAngleCounts(normalizePosePlanCount(payloadCount));
}

function resolvePoseAspectRatioFromPayload(payload: PoseHistoryPayload): AspectRatio {
  return payload.aspectRatio || "auto";
}

function resolvePosePlanModeFromPayload(payload: PoseHistoryPayload): PosePlanMode {
  const rawPayload = payload as PoseHistoryPayload & { pose_plan_mode?: unknown };
  return rawPayload.posePlanMode === "ai" || rawPayload.pose_plan_mode === "ai" ? "ai" : "preset";
}

function stripLegacyRuleDemoText(value: string) {
  return value
    .replace(/\n?人物和姿势气质参考：[^\n]*(?:\n|$)/g, "\n")
    .replace(/\n?姿势裂变拍摄风格档位：[^\n]*(?:\n|$)/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getPoseGenerationPollDelay(elapsedMs: number) {
  return elapsedMs < POSE_GENERATION_POLL_FAST_WINDOW_MS
    ? POSE_GENERATION_POLL_FAST_MS
    : POSE_GENERATION_POLL_SLOW_MS;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class PoseGenerationPollTimeoutError extends Error {
  constructor() {
    super("生成仍在后台处理中，可稍后在任务队列或作品库查看。");
    this.name = "PoseGenerationPollTimeoutError";
  }
}

function isCacheablePoseAnalysisEntry(entry: PoseAnalysisEntry) {
  return entry.source !== "fallback"
    && entry.analysis.confidence >= POSE_ANALYSIS_CLIENT_CACHE_MIN_CONFIDENCE
    && hasMeaningfulPoseAnalysis(entry.analysis);
}

function hasMeaningfulPoseAnalysis(analysis: PoseVisualAnalysis) {
  if (analysis.genderExpression !== "unknown") return true;
  if (analysis.ageRange !== "unknown") return true;
  if (analysis.bodyCrop !== "partial_unknown") return true;
  if (typeof analysis.headVisible === "boolean" || typeof analysis.faceVisible === "boolean") return true;
  return Boolean(
    analysis.poseBaseline
    || analysis.cameraFraming
    || analysis.outfitDescription
    || analysis.background
    || analysis.lighting
    || analysis.promptNotes
  );
}

export default function PosePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const poseReferenceInputRef = useRef<HTMLInputElement>(null);
  const garmentDetailInputRef = useRef<HTMLInputElement>(null);
  const rulesButtonRef = useRef<HTMLButtonElement>(null);
  const rulesHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRunRef = useRef(0);
  const poseAnalysisCacheRef = useRef(new Map<string, PoseAnalysisEntry>());
  const poseAnalysisInflightRef = useRef(new Map<string, Promise<PoseAnalysisEntry>>());
  const lastPoseAnalysisKeyRef = useRef("");
  const poseAnalysisSeqRef = useRef(0);
  const posePlanCacheRef = useRef(new Map<string, PosePlanEntry>());
  const posePlanInflightRef = useRef(new Map<string, Promise<PosePlanEntry>>());
  const lastPosePlanKeyRef = useRef("");
  const posePlanSeqRef = useRef(0);
  const posePlanBypassCacheRef = useRef(false);
  const applyPoseHistoryPayloadRef = useRef<((payload: PoseHistoryPayload, historyResultUrls?: string[], options?: { silent?: boolean }) => void) | null>(null);

  const {
    authChecked,
    isAuthenticated,
    userId,
    credits,
    setCredits,
    refreshCredits,
    refreshAuth,
  } = useStudioAuth();
  const [aiModel, setAiModel] = useState<LingyaModel>("nano-banana-2");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("auto");
  const [imageSize, setImageSize] = useState<ImageSize>("1K");
  const [mainImage, setMainImage] = useState<string>("");
  const [prompt, setPrompt] = useState(DEFAULT_POSE_PROMPT);
  const [supplementPrompt, setSupplementPrompt] = useState("");
  const [outputMode, setOutputMode] = useState<PoseOutputMode>("separate");
  const [poseStyle, setPoseStyle] = useState<PoseSeriesStyle>(DEFAULT_POSE_SERIES_STYLE);
  const [poseAngleCounts, setPoseAngleCounts] = useState<PoseAngleCounts>({ ...DEFAULT_POSE_ANGLE_COUNTS });
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggingPoseReferences, setIsDraggingPoseReferences] = useState(false);
  const [poseCreationMode, setPoseCreationMode] = useState<PoseCreationMode>("free");
  const [poseReferenceUrls, setPoseReferenceUrls] = useState<string[]>([]);
  const [poseReferenceCopies, setPoseReferenceCopies] = useState(1);
  const [isUploadingPoseReferences, setIsUploadingPoseReferences] = useState(false);
  const [isDraggingGarmentDetails, setIsDraggingGarmentDetails] = useState(false);
  const [garmentAngleEnabled, setGarmentAngleEnabled] = useState(false);
  const [garmentAngleReferences, setGarmentAngleReferences] = useState<GarmentAngleReference[]>([]);
  const [garmentAngleTarget, setGarmentAngleTarget] = useState<GarmentAngleTarget>("outfit");
  const [garmentAngleView, setGarmentAngleView] = useState<GarmentAngleView>("front");
  const [isUploadingGarmentDetails, setIsUploadingGarmentDetails] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzingPose, setIsAnalyzingPose] = useState(false);
  const [poseAnalysis, setPoseAnalysis] = useState<PoseVisualAnalysis | null>(null);
  const [poseAnalysisEntryKey, setPoseAnalysisEntryKey] = useState("");
  const [poseAnalysisSource, setPoseAnalysisSource] = useState<PoseAnalysisSource | null>(null);
  const [poseAnalysisError, setPoseAnalysisError] = useState<string | null>(null);
  const [poseAnalysisRetryCount, setPoseAnalysisRetryCount] = useState(0);
  const [posePlanMode, setPosePlanMode] = useState<PosePlanMode>("preset");
  const [isPlanningPose, setIsPlanningPose] = useState(false);
  const [posePlan, setPosePlan] = useState<PosePlan | null>(null);
  const [posePlanSource, setPosePlanSource] = useState<PosePlanSource | null>(null);
  const [posePlanError, setPosePlanError] = useState<string | null>(null);
  const [posePlanRetryCount, setPosePlanRetryCount] = useState(0);
  const [showPosePlanEditor, setShowPosePlanEditor] = useState(false);
  const [selectedPosePlanSlotIndex, setSelectedPosePlanSlotIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [resultUrls, setResultUrls] = useState<string[]>([]);
  const [runningExpectedCount, setRunningExpectedCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [showPoseRules, setShowPoseRules] = useState(false);
  const [rulesPopoverStyle, setRulesPopoverStyle] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const mainImageDrag = useStableFileDrag<HTMLDivElement>({
    isDragging,
    setDragging: setIsDragging,
    fileFilter: (file) => file.type.startsWith("image/"),
    onFiles: (files) => handleFile(files[0]),
  });

  const imageSizes = getSupportedImageSizes(aiModel, aspectRatio);
  const unitCost = getCreditCost(aiModel, imageSize, aspectRatio);
  const activeGarmentAngleReferences = useMemo(
    () => garmentAngleEnabled ? normalizeGarmentAngleReferences(garmentAngleReferences) : [],
    [garmentAngleEnabled, garmentAngleReferences]
  );
  const activeGarmentAngleUrls = useMemo(
    () => flattenGarmentAngleReferences(activeGarmentAngleReferences),
    [activeGarmentAngleReferences]
  );
  const activePoseReferenceUrls = useMemo(
    () => poseCreationMode === "reference" ? poseReferenceUrls.slice(0, MAX_POSE_REFERENCE_IMAGES) : [],
    [poseCreationMode, poseReferenceUrls]
  );
  const isPoseReferenceMode = poseCreationMode === "reference";
  const activePoseReferenceCopies = normalizePoseReferenceCopies(poseReferenceCopies, Math.max(activePoseReferenceUrls.length, 1));
  const poseReferenceOutputCount = isPoseReferenceMode
    ? Math.max(activePoseReferenceUrls.length * activePoseReferenceCopies, 1)
    : 0;
  const posePlanTargetCount = getPoseAngleTotal(poseAngleCounts);
  const poseRunTargetCount = isPoseReferenceMode ? poseReferenceOutputCount : posePlanTargetCount;
  const effectiveOutputMode: PoseOutputMode = isPoseReferenceMode ? "separate" : outputMode;
  const poseExpectedCount = isPoseReferenceMode
    ? poseReferenceOutputCount
    : outputMode === "separate" ? posePlanTargetCount : 1;
  const poseDeliveryLabel = isPoseReferenceMode
    ? activePoseReferenceUrls.length
      ? `${activePoseReferenceUrls.length} 张参考 × 每张 ${activePoseReferenceCopies} 张 = ${poseReferenceOutputCount} 张独立图`
      : "参考图独立生成"
    : outputMode === "separate"
      ? `${posePlanTargetCount} 张独立图`
      : `${posePlanTargetCount} 姿势自动宫格`;
  const cost = unitCost * poseExpectedCount;
  const activeGarmentAngleTargetOption = GARMENT_ANGLE_TARGET_OPTIONS.find((item) => item.value === garmentAngleTarget) || GARMENT_ANGLE_TARGET_OPTIONS[0];
  const activeGarmentAngleViewOption = GARMENT_ANGLE_VIEW_OPTIONS.find((item) => item.value === garmentAngleView) || GARMENT_ANGLE_VIEW_OPTIONS[0];
  const activeGarmentAngleMark = `${activeGarmentAngleTargetOption.label} · ${activeGarmentAngleViewOption.label}`;
  const requestedBackPoseCount = poseAngleCounts.back || 0;
  const hasBackGarmentReference = activeGarmentAngleReferences.some((ref) => ref.view === "back");
  const shouldSuggestBackReference = !isPoseReferenceMode && requestedBackPoseCount > 0 && !hasBackGarmentReference;
  const taskQueue = useTaskQueueGeneration({
    module: "pose",
    title: "姿势裂变",
    defaultExpectedCount: poseExpectedCount,
    applyPath: "/pose",
  });
  const authIsAnonymous = authChecked && !isAuthenticated;
  const activePoseAnalysisForGate = mainImage ? getActivePoseAnalysis() : null;
  const activePoseAnalysisErrorForGate = mainImage ? getActivePoseAnalysisError() : null;
  const isPoseAnalysisPending = Boolean(
    mainImage && (isAnalyzingPose || (!activePoseAnalysisForGate && !activePoseAnalysisErrorForGate))
  );
  const runDisabledReason = !mainImage
    ? "请先上传主图"
    : isUploading
      ? "主图上传中，请稍候"
      : isUploadingPoseReferences
        ? "姿势参考图正在上传，请稍候"
        : poseCreationMode === "reference" && activePoseReferenceUrls.length === 0
          ? "请先上传姿势参考图"
          : isUploadingGarmentDetails
        ? "背/侧补充图正在上传，请稍候"
        : isPoseAnalysisPending
          ? "主图正在识别，请稍候。"
          : !isPoseReferenceMode && posePlanMode === "ai" && isPlanningPose
            ? "姿势计划正在整理，请稍候。"
            : credits !== null && credits < cost
              ? `灵点不足，生成需要 ${cost} 灵点`
              : undefined;
  const previewPosePlan = getActivePosePlan();
  const previewPosePlanText = isPoseReferenceMode
    ? [
        activePoseReferenceUrls.length
          ? `参考图模式：${activePoseReferenceUrls.length} 张姿势参考 × 每张 ${activePoseReferenceCopies} 张 = ${poseReferenceOutputCount} 张独立图。`
          : "参考图模式：上传姿势参考图后生成独立图。",
        supplementPrompt.trim() ? `补充要求：${supplementPrompt.trim()}` : "",
      ].map((item) => item.trim()).filter(Boolean).join("\n")
    : [
        ...getPosePlanSummary(previewPosePlan).map((item) => `${item.title}：${item.detail}`),
        supplementPrompt.trim() ? `补充要求：${supplementPrompt.trim()}` : "",
      ].map((item) => item.trim()).filter(Boolean).join("\n");
  const activeResultExpectedCount = isGenerating
    ? runningExpectedCount || poseExpectedCount
    : runningExpectedCount || Math.max(resultUrls.length, 1);
  const displayedResultUrls = resultUrls.filter(Boolean);
  const hasCompletedPartialResults = Boolean(
    !isGenerating
    && activeResultExpectedCount > displayedResultUrls.length
    && displayedResultUrls.length > 0
  );
  const partialFailureMessage = buildPartialFailureDetail({
    failedCount: activeResultExpectedCount - displayedResultUrls.length,
  });
  const retryDisabled = isSubmitting || isGenerating;
  function handleRetryFailedResult(index: number) {
    if (retryDisabled) return;
    void generate(undefined, {
      genCountOverride: 1,
      expectedCountOverride: 1,
      poseStartIndex: index + 1,
      retryResultIndex: index,
      toastMessage: `正在补位重试姿势 ${index + 1}，失败图已退款，完成后会回填到当前结果中...`,
    });
  }
  const previewSession = useMemo(
    () => createGenericImagePreviewSession({
      module: "pose",
      title: "姿势裂变",
      urls: resultUrls,
      expectedCount: activeResultExpectedCount,
      isGenerating,
      statusGroup: isGenerating ? "running" : undefined,
      references: [
        ...(mainImage ? [{ url: mainImage, label: "主图", role: "source" as const }] : []),
        ...activePoseReferenceUrls.map((url, index) => ({ url, label: `姿势参考 ${index + 1}`, role: "reference" as const })),
        ...activeGarmentAngleReferences.map((ref, index) => ({ url: ref.url, label: formatGarmentAngleReferenceLabel(ref, index), role: "reference" as const })),
      ],
      promptText: previewPosePlanText,
      metaItems: [
        { label: "交付方式", value: poseDeliveryLabel },
        { label: "姿势数量", value: poseRunTargetCount },
        { label: "画布比例", value: aspectRatio === "auto" ? "智能" : aspectRatio },
        { label: "计划", value: isPoseReferenceMode ? "参考图直出" : posePlanMode === "ai" ? POSE_PLAN_SOURCE_LABELS[posePlanSource || "vision_plan"] : "自动计划" },
        { label: "模型", value: aiModel },
        { label: "分辨率", value: imageSize },
        { label: "结果数量", value: poseExpectedCount },
      ],
      resultTitlePrefix: effectiveOutputMode === "separate" ? "姿势结果" : "姿势宫格",
      aspectRatio: aspectRatio === "auto" ? undefined : aspectRatio,
    }),
    [activeGarmentAngleReferences, activePoseReferenceUrls, activeResultExpectedCount, aiModel, aspectRatio, effectiveOutputMode, imageSize, isGenerating, isPoseReferenceMode, mainImage, poseDeliveryLabel, poseExpectedCount, posePlanMode, posePlanSource, poseRunTargetCount, previewPosePlanText, resultUrls]
  );

  useEffect(() => {
    setPoseReferenceCopies((count) => normalizePoseReferenceCopies(count, Math.max(activePoseReferenceUrls.length, 1)));
  }, [activePoseReferenceUrls.length]);

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
    const width = Math.min(720, window.innerWidth - 32);
    const top = Math.max(16, Math.min(rect.top - 10, window.innerHeight - 360));
    const left = Math.max(16, Math.min(rect.right + 12, window.innerWidth - width - 16));
    setRulesPopoverStyle({
      top,
      left,
      maxHeight: Math.max(320, window.innerHeight - top - 16),
    });
    setShowPoseRules(true);
  };

  const scheduleRulesHide = () => {
    cancelRulesHide();
    rulesHideTimerRef.current = setTimeout(() => {
      setShowPoseRules(false);
      setRulesPopoverStyle(null);
    }, 120);
  };

  function setPoseAnalysisEntry(entry: PoseAnalysisEntry | null, analysisKey = "") {
    setPoseAnalysisEntryKey(entry ? analysisKey : "");
    setPoseAnalysis(entry?.analysis || null);
    setPoseAnalysisSource(entry?.source || null);
    setPoseAnalysisError(entry?.error || null);
    setIsAnalyzingPose(false);
  }

  function setPosePlanEntry(entry: PosePlanEntry | null) {
    setPosePlan(entry?.plan || null);
    setPosePlanSource(entry?.source || null);
    setPosePlanError(entry?.error || null);
    setIsPlanningPose(false);
  }

  function applyPoseAnalysisSnapshot(mainImageUrl: string, rawAnalysis: unknown, source: PoseAnalysisSource = "history") {
    const analysis = normalizePoseVisualAnalysis(rawAnalysis);
    const analysisKey = mainImageUrl ? buildPoseVisualAnalysisKey(mainImageUrl) : "";
    poseAnalysisSeqRef.current += 1;
    if (analysis && analysisKey) {
      const entry: PoseAnalysisEntry = { analysis, source, error: null };
      poseAnalysisCacheRef.current.set(analysisKey, entry);
      lastPoseAnalysisKeyRef.current = analysisKey;
      setPoseAnalysisEntry(entry, analysisKey);
      return;
    }
    lastPoseAnalysisKeyRef.current = "";
    setPoseAnalysisEntry(null);
  }

  function applyPosePlanSnapshot(payload: PoseHistoryPayload, source: PosePlanSource = "history") {
    const analysis = normalizePoseVisualAnalysis(payload.poseAnalysis);
    const planMode = resolvePosePlanModeFromPayload(payload);
    const historyAngleCounts = resolvePoseAngleCountsFromPayload(payload);
    const historyPoseCount = getPoseAngleTotal(historyAngleCounts);
    const planKey = buildPosePlanKey(payload.mainImageUrl, analysis, DEFAULT_POSE_SERIES_STYLE, resolvePoseOutputModeFromPayload(payload), payload.prompt, planMode, historyPoseCount, historyAngleCounts);
    posePlanSeqRef.current += 1;
    if (payload.posePlan && planKey) {
      const entry: PosePlanEntry = {
        plan: normalizePosePlan(payload.posePlan, {
          poseAnalysis: analysis,
          poseStyle: DEFAULT_POSE_SERIES_STYLE,
          outputMode: resolvePoseOutputModeFromPayload(payload),
          prompt: payload.prompt,
          poseCount: historyPoseCount,
          angleCounts: historyAngleCounts,
        }),
        source,
        error: null,
      };
      posePlanCacheRef.current.set(planKey, entry);
      lastPosePlanKeyRef.current = planKey;
      setPosePlanEntry(entry);
      return;
    }
    lastPosePlanKeyRef.current = "";
    setPosePlanEntry(null);
  }

  function getActivePoseAnalysis() {
    if (!mainImage || !poseAnalysis) return null;
    return poseAnalysisEntryKey === buildPoseVisualAnalysisKey(mainImage) ? poseAnalysis : null;
  }

  function getActivePoseAnalysisError() {
    if (!mainImage || !poseAnalysisError) return null;
    return poseAnalysisEntryKey === buildPoseVisualAnalysisKey(mainImage) ? poseAnalysisError : null;
  }

  function buildPlanPromptSource() {
    return stripLegacyRuleDemoText([
      prompt,
      supplementPrompt.trim() ? `补充要求：${supplementPrompt.trim()}` : "",
    ].filter(Boolean).join("\n\n"));
  }

  function buildPosePlanKey(
    imageUrl = mainImage,
    analysis = getActivePoseAnalysis(),
    style = poseStyle,
    mode = outputMode,
    planPrompt = buildPlanPromptSource(),
    planMode = posePlanMode,
    targetCount = posePlanTargetCount,
    angleCounts = poseAngleCounts
  ) {
    if (!imageUrl) return "";
    const baseKey = buildPosePlanCacheKey({
      mainImageUrl: imageUrl,
      poseAnalysis: analysis,
      poseStyle: style,
      outputMode: mode,
      poseCount: targetCount,
      angleCounts,
      prompt: planPrompt,
    });
    return `${baseKey}|mode:${planMode}`;
  }

  function getActivePosePlan() {
    if (poseCreationMode === "reference") return null;
    if (!mainImage || !posePlan) return null;
    return lastPosePlanKeyRef.current === buildPosePlanKey() ? posePlan : null;
  }

  function retryPoseAnalysis() {
    if (!mainImage || isAnalyzingPose) return;
    const analysisKey = buildPoseVisualAnalysisKey(mainImage);
    poseAnalysisCacheRef.current.delete(analysisKey);
    lastPoseAnalysisKeyRef.current = "";
    poseAnalysisSeqRef.current += 1;
    setPoseAnalysisEntry(null);
    setPoseAnalysisRetryCount((count) => count + 1);
  }

  function retryPosePlan() {
    if (!mainImage || isPlanningPose) return;
    setPosePlanMode("ai");
    const planKey = buildPosePlanKey();
    if (planKey) posePlanCacheRef.current.delete(planKey);
    lastPosePlanKeyRef.current = "";
    posePlanSeqRef.current += 1;
    posePlanBypassCacheRef.current = true;
    setPosePlanEntry(null);
    setPosePlanRetryCount((count) => count + 1);
  }

  function usePresetPosePlan() {
    if (posePlanMode === "preset") return;
    posePlanBypassCacheRef.current = false;
    lastPosePlanKeyRef.current = "";
    posePlanSeqRef.current += 1;
    setPosePlanMode("preset");
    setPosePlanEntry(null);
    setSelectedPosePlanSlotIndex(0);
  }

  function patchPosePlanSlot(index: number, patch: PosePlanSlotPatch) {
    setPosePlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        edited: true,
        slots: prev.slots.map((slot, slotIndex) => (
          slotIndex === index ? { ...slot, ...patch } : slot
        )),
      };
    });
    setPosePlanSource("user_custom");
  }

  function updatePosePlanSlot(index: number, key: keyof Pick<PosePlan["slots"][number], "bodyAction" | "handAction" | "headDirection" | "cameraFraming" | "garmentVisibilityRule">, value: string) {
    patchPosePlanSlot(index, { [key]: value } as PosePlanSlotPatch);
  }

  function applyPoseActionPreset(index: number, presetId: string) {
    const slot = getActivePosePlan()?.slots[index];
    if (!slot || presetId === "current") return;
    const preset = getCommercialPoseActionPresets(slot.angle).find((item) => item.id === presetId);
    if (!preset) return;
    patchPosePlanSlot(index, {
      poseName: preset.label,
      bodyAction: preset.bodyAction,
      handAction: preset.handAction,
    });
  }

  function applyPoseExpressionPreset(index: number, presetId: string) {
    const slot = getActivePosePlan()?.slots[index];
    if (!slot || presetId === "current") return;
    const preset = getCommercialPoseExpressionPresets(slot.angle).find((item) => item.id === presetId);
    if (!preset) return;
    patchPosePlanSlot(index, { headDirection: preset.text });
  }

  function updatePoseAngleCount(angle: PosePlanAngle, delta: number) {
    setPoseAngleCounts((prev) => {
      const current = normalizePoseAngleCounts(prev);
      const total = getPoseAngleTotal(current);
      if (delta > 0 && total >= POSE_PLAN_MAX_COUNT) return current;
      if (delta < 0 && total <= POSE_PLAN_MIN_COUNT) return current;
      const nextValue = Math.max(0, current[angle] + delta);
      if (nextValue === current[angle]) return current;
      const next = normalizePoseAngleCounts({ ...current, [angle]: nextValue }, current);
      const nextTotal = getPoseAngleTotal(next);
      if (nextTotal < POSE_PLAN_MIN_COUNT || nextTotal > POSE_PLAN_MAX_COUNT) return current;
      return next;
    });
  }

  function applyPoseAnglePreset(counts: PoseAngleCounts) {
    setPoseAngleCounts(normalizePoseAngleCounts(counts));
    setSelectedPosePlanSlotIndex(0);
  }

  useEffect(() => {
    setSelectedPosePlanSlotIndex((index) => Math.max(0, Math.min(index, posePlanTargetCount - 1)));
  }, [posePlanTargetCount]);

  useEffect(() => {
    const sourceImage = takeSourceImageFromLocation();
    if (sourceImage) {
      setMainImage(sourceImage);
      toast.success("已带入预览图片");
    }
  }, []);

  useEffect(() => {
    return () => cancelRulesHide();
  }, []);

  useEffect(() => {
    const nextSizes = getSupportedImageSizes(aiModel, aspectRatio);
    if (!nextSizes.includes(imageSize)) setImageSize(nextSizes[0]);
  }, [aiModel, aspectRatio, imageSize]);

  useEffect(() => {
    setPrompt((prev) => stripLegacyRuleDemoText(prev));
  }, []);

  useEffect(() => {
    if (poseCreationMode !== "reference") return;
    lastPosePlanKeyRef.current = "";
    posePlanSeqRef.current += 1;
    setPosePlanEntry(null);
    setShowPosePlanEditor(false);
    setOutputMode("separate");
  }, [poseCreationMode]);

  useEffect(() => {
    const imageUrl = mainImage.trim();
    if (!imageUrl) {
      lastPoseAnalysisKeyRef.current = "";
      poseAnalysisSeqRef.current += 1;
      setPoseAnalysisEntry(null);
      return;
    }

    const analysisKey = buildPoseVisualAnalysisKey(imageUrl);
    if (lastPoseAnalysisKeyRef.current === analysisKey) return;
    lastPoseAnalysisKeyRef.current = analysisKey;
    const seq = poseAnalysisSeqRef.current + 1;
    poseAnalysisSeqRef.current = seq;

    const cachedAnalysis = poseAnalysisCacheRef.current.get(analysisKey);
    if (cachedAnalysis) {
      if (isCacheablePoseAnalysisEntry(cachedAnalysis)) {
        setPoseAnalysisEntry(cachedAnalysis, analysisKey);
        return;
      }
      poseAnalysisCacheRef.current.delete(analysisKey);
    }

    const run = async () => {
      setIsAnalyzingPose(true);
      setPoseAnalysisError(null);
      try {
        let request = poseAnalysisInflightRef.current.get(analysisKey);
        if (!request) {
          const nextRequest = fetch("/api/pose/analyze-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ main_image_url: imageUrl }),
          }).then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "主图识别失败");
            const nextAnalysis = normalizePoseVisualAnalysis(data.analysis);
            if (!nextAnalysis) throw new Error("主图识别结果无效");
            const nextSource: PoseAnalysisSource = data.source === "fallback"
              ? "fallback"
              : data.cached ? "cache" : "vision";
            const nextError = nextSource === "fallback"
              ? "主图识别失败，已按保守规则继续"
              : nextAnalysis.confidence < 0.45
                ? "主图识别置信较低，已按保守规则继续"
                : null;
            return {
              analysis: nextAnalysis,
              source: nextSource,
              error: nextError,
            };
          });
          poseAnalysisInflightRef.current.set(analysisKey, nextRequest);
          void nextRequest.finally(() => {
            if (poseAnalysisInflightRef.current.get(analysisKey) === nextRequest) {
              poseAnalysisInflightRef.current.delete(analysisKey);
            }
          }).catch(() => undefined);
          request = nextRequest;
        }

        const nextEntry = await request;
        if (isCacheablePoseAnalysisEntry(nextEntry)) {
          poseAnalysisCacheRef.current.set(analysisKey, nextEntry);
        } else {
          poseAnalysisCacheRef.current.delete(analysisKey);
        }
        if (poseAnalysisSeqRef.current !== seq) return;
        setPoseAnalysisEntry(nextEntry, analysisKey);
      } catch (err: unknown) {
        if (poseAnalysisSeqRef.current !== seq) return;
        setPoseAnalysisEntry({
          analysis: fallbackPoseVisualAnalysis(),
          source: "fallback",
          error: err instanceof Error ? err.message : "主图识别失败，已按保守规则继续",
        }, analysisKey);
      } finally {
        if (poseAnalysisSeqRef.current === seq) setIsAnalyzingPose(false);
      }
    };

    void run();
  }, [mainImage, poseAnalysisRetryCount]);

  useEffect(() => {
    const imageUrl = mainImage.trim();
    if (!imageUrl) {
      lastPosePlanKeyRef.current = "";
      posePlanSeqRef.current += 1;
      setPosePlanEntry(null);
      return;
    }

    const imageAnalysisKey = buildPoseVisualAnalysisKey(imageUrl);
    const activeAnalysis = poseAnalysisEntryKey === imageAnalysisKey ? poseAnalysis : null;
    const activeAnalysisError = poseAnalysisEntryKey === imageAnalysisKey ? poseAnalysisError : null;
    const planPrompt = stripLegacyRuleDemoText([
      prompt,
      supplementPrompt.trim() ? `补充要求：${supplementPrompt.trim()}` : "",
    ].filter(Boolean).join("\n\n"));
    const basePlanKey = buildPosePlanCacheKey({
      mainImageUrl: imageUrl,
      poseAnalysis: activeAnalysis,
      poseStyle,
      outputMode,
      poseCount: posePlanTargetCount,
      angleCounts: poseAngleCounts,
      prompt: planPrompt,
    });
    const planKey = `${basePlanKey}|mode:${posePlanMode}`;
    if (lastPosePlanKeyRef.current === planKey) return;
    lastPosePlanKeyRef.current = planKey;
    const seq = posePlanSeqRef.current + 1;
    posePlanSeqRef.current = seq;

    const cachedPlan = posePlanCacheRef.current.get(planKey);
    if (cachedPlan) {
      setPosePlanEntry(cachedPlan);
      return;
    }

    if (posePlanMode === "preset") {
      const plan = normalizePosePlan(null, {
        poseAnalysis: activeAnalysis,
        poseStyle,
        outputMode,
        prompt: planPrompt,
        poseCount: posePlanTargetCount,
        angleCounts: poseAngleCounts,
      });
      const entry: PosePlanEntry = { plan, source: "preset", error: null };
      posePlanCacheRef.current.set(planKey, entry);
      setPosePlanEntry(entry);
      return;
    }

    if (!activeAnalysis && !activeAnalysisError) return;

    const run = async () => {
      setIsPlanningPose(true);
      setPosePlanError(null);
      const forcePlanRequest = posePlanBypassCacheRef.current;
      try {
        let request = posePlanInflightRef.current.get(planKey);
        if (!request || forcePlanRequest) {
          const nextRequest = fetch("/api/pose/plan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              main_image_url: imageUrl,
              pose_analysis: activeAnalysis,
              pose_style: poseStyle,
              output_mode: outputMode,
              pose_count: posePlanTargetCount,
              angle_counts: poseAngleCounts,
              prompt: planPrompt,
              force: forcePlanRequest,
            }),
          }).then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "姿势规划失败");
            const nextPlan = normalizePosePlan(data.posePlan, {
              poseAnalysis: activeAnalysis,
              poseStyle,
              outputMode,
              prompt: planPrompt,
              poseCount: posePlanTargetCount,
              angleCounts: poseAngleCounts,
            });
            const nextSource: PosePlanSource = data.source === "fallback"
              ? "fallback"
              : data.cached ? "cache" : "vision_plan";
            return {
              plan: nextPlan,
              source: nextSource,
              error: nextSource === "fallback" ? (data.reasonText || "姿势规划已使用保守方案") : null,
            };
          });
          posePlanInflightRef.current.set(planKey, nextRequest);
          void nextRequest.finally(() => {
            if (posePlanInflightRef.current.get(planKey) === nextRequest) {
              posePlanInflightRef.current.delete(planKey);
            }
          }).catch(() => undefined);
          request = nextRequest;
        }

        const nextEntry = await request;
        posePlanCacheRef.current.set(planKey, nextEntry);
        if (posePlanSeqRef.current !== seq) return;
        setPosePlanEntry(nextEntry);
      } catch (err: unknown) {
        if (posePlanSeqRef.current !== seq) return;
        const fallback = normalizePosePlan(null, {
          poseAnalysis: activeAnalysis,
          poseStyle,
          outputMode,
          prompt: planPrompt,
          poseCount: posePlanTargetCount,
          angleCounts: poseAngleCounts,
        });
        setPosePlanEntry({
          plan: fallback,
          source: "fallback",
          error: err instanceof Error ? err.message : "姿势规划失败，已使用保守方案",
        });
      } finally {
        if (posePlanSeqRef.current === seq) {
          posePlanBypassCacheRef.current = false;
          setIsPlanningPose(false);
        }
      }
    };

    void run();
  }, [
    mainImage,
    poseAnalysis,
    poseAnalysisError,
    poseAnalysisEntryKey,
    poseAnalysisSource,
    poseStyle,
    poseCreationMode,
    posePlanMode,
    outputMode,
    prompt,
    supplementPrompt,
    poseAngleCounts,
    posePlanTargetCount,
    posePlanRetryCount,
  ]);

  function applyPoseHistoryPayload(payload: PoseHistoryPayload, historyResultUrls: string[] = [], options?: { silent?: boolean }) {
    generationRunRef.current += 1;
    const nextPosePlanMode = resolvePosePlanModeFromPayload(payload);
    setPosePlanMode(nextPosePlanMode);
    setMainImage(payload.mainImageUrl);
    const historyGarmentAngleReferences = normalizeGarmentAngleReferences(
      payload.garmentAngleReferences?.length ? payload.garmentAngleReferences : payload.garmentDetailUrls
    );
    const historyPoseReferenceUrls = normalizePoseReferenceUrls(payload.poseReferenceUrls);
    const historyPoseReferenceCopies = normalizePoseReferenceCopies(payload.poseReferenceCopies, Math.max(historyPoseReferenceUrls.length, 1));
    setGarmentAngleReferences(historyGarmentAngleReferences);
    setGarmentAngleEnabled(historyGarmentAngleReferences.length > 0);
    setPoseReferenceUrls(historyPoseReferenceUrls);
    setPoseReferenceCopies(historyPoseReferenceCopies);
    const historyCreationMode = historyPoseReferenceUrls.length ? "reference" : "free";
    setPoseCreationMode(historyCreationMode);
    applyPoseAnalysisSnapshot(payload.mainImageUrl, payload.poseAnalysis);
    if (historyCreationMode === "reference") {
      setPosePlanEntry(null);
      lastPosePlanKeyRef.current = "";
    } else {
      applyPosePlanSnapshot(payload);
    }
    setAiModel(payload.aiModel);
    setAspectRatio(resolvePoseAspectRatioFromPayload(payload));
    setImageSize(payload.imageSize);
    setPrompt(stripLegacyRuleDemoText(payload.prompt || DEFAULT_POSE_PROMPT));
    setSupplementPrompt("");
    setPoseStyle(DEFAULT_POSE_SERIES_STYLE);
    setOutputMode(historyCreationMode === "reference" ? "separate" : resolvePoseOutputModeFromPayload(payload));
    setPoseAngleCounts(resolvePoseAngleCountsFromPayload(payload));
    setRunningExpectedCount(null);
    setResultUrls(historyResultUrls);
    setIsSubmitting(false);
    setIsGenerating(false);
    setError("");
    if (!options?.silent) toast.success("已套用历史参数");
  }

  applyPoseHistoryPayloadRef.current = applyPoseHistoryPayload;

  useEffect(() => {
    let cancelled = false;
    (async () => {
    const detail = await takeApplyDetail("pose");
    const payload = detail?.payload;
    if (cancelled || !payload) return;

    applyPoseHistoryPayloadRef.current?.(payload, detail?.resultUrls || []);
    if (isHistoryApplyRowFailed(detail.row)) {
      setError(getHistoryApplyFailureMessage(detail.row));
    }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("请上传图片文件");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(`图片不能超过 ${MAX_FILE_SIZE_MB}MB`);
      return;
    }
    toast.info("正在上传主图...");
    setIsUploading(true);
    try {
      const result = await uploadImage(file);
      setMainImage(result.url);
      toast.success("主图已选择");
    } catch {
      setMainImage("");
      toast.error("主图上传失败，请重试");
    } finally {
      setIsUploading(false);
    }
  }

  async function handlePoseReferenceFiles(files?: FileList | File[]) {
    if (isUploadingPoseReferences) {
      toast.info("姿势参考图正在上传，请稍候");
      return;
    }
    const arr = Array.from(files || []);
    if (!arr.length) return;
    const remaining = MAX_POSE_REFERENCE_IMAGES - poseReferenceUrls.length;
    if (remaining <= 0) {
      toast.info(`姿势参考图最多 ${MAX_POSE_REFERENCE_IMAGES} 张`);
      return;
    }
    const limited = arr.slice(0, remaining);
    if (arr.length > limited.length) {
      toast.info(`最多还能添加 ${remaining} 张姿势参考图，已自动截取`);
    }
    const validFiles: File[] = [];
    for (const file of limited) {
      if (!isLikelyImageFile(file)) { toast.error(`${file.name} 不是图片`); continue; }
      if (file.size > MAX_FILE_SIZE) { toast.error(`${file.name} 超过 ${MAX_FILE_SIZE_MB}MB`); continue; }
      validFiles.push(file);
    }
    if (!validFiles.length) return;

    setIsUploadingPoseReferences(true);
    toast.info(`正在上传 ${validFiles.length} 张姿势参考图...`);
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
        setPoseReferenceUrls((prev) => Array.from(new Set([...prev, ...uploadedUrls])).slice(0, MAX_POSE_REFERENCE_IMAGES));
        setPoseCreationMode("reference");
        toast.success(`已添加 ${uploadedUrls.length} 张姿势参考图`);
      }
    } finally {
      setIsUploadingPoseReferences(false);
    }
  }

  function toggleGarmentDetails() {
    setGarmentAngleEnabled((value) => !value);
  }

  async function handleGarmentDetailFiles(files?: FileList | File[]) {
    if (isUploadingGarmentDetails) {
      toast.info("背/侧补充图正在上传，请稍候");
      return;
    }
    if (isPoseReferenceMode && activePoseReferenceUrls.length === 0) {
      toast.info("请先上传姿势参考图");
      return;
    }
    const arr = Array.from(files || []);
    if (!arr.length) return;
    const remaining = MAX_GARMENT_ANGLE_IMAGES - activeGarmentAngleReferences.length;
    if (remaining <= 0) {
      toast.info(`背/侧补充图最多 ${MAX_GARMENT_ANGLE_IMAGES} 张`);
      return;
    }
    const limited = arr.slice(0, remaining);
    if (arr.length > limited.length) {
      toast.info(`最多还能添加 ${remaining} 张角度参考，已自动截取`);
    }
    const validFiles: File[] = [];
    for (const file of limited) {
      if (!isLikelyImageFile(file)) { toast.error(`${file.name} 不是图片`); continue; }
      if (file.size > MAX_FILE_SIZE) { toast.error(`${file.name} 超过 ${MAX_FILE_SIZE_MB}MB`); continue; }
      validFiles.push(file);
    }
    if (!validFiles.length) return;

    setIsUploadingGarmentDetails(true);
    toast.info(`正在上传 ${validFiles.length} 张背/侧补充图...`);
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
        setGarmentAngleReferences((prev) => normalizeGarmentAngleReferences([
          ...prev,
          ...uploadedUrls.map((url) => ({ url, target: garmentAngleTarget, view: garmentAngleView })),
        ]));
        toast.success(`已添加 ${uploadedUrls.length} 张背/侧补充图`);
      }
    } finally {
      setIsUploadingGarmentDetails(false);
    }
  }

  function removeGarmentDetail(url: string) {
    setGarmentAngleReferences((prev) => prev.filter((item) => item.url !== url));
  }

  function applyRuleDemo(demo: PoseRuleDemo) {
    setMainImage(demo.imageUrl);
    setPrompt((prev) => stripLegacyRuleDemoText(prev));
    setShowPoseRules(false);
    setRulesPopoverStyle(null);
    toast.success("已套用示例图");
  }

  function applyPoseReferenceDemo(demo: typeof POSE_REFERENCE_DEMOS[number]) {
    setPoseCreationMode("reference");
    setPoseReferenceUrls(demo.imageUrls.slice(0, MAX_POSE_REFERENCE_IMAGES));
    setPoseReferenceCopies(1);
    toast.success("已套用姿势参考示例");
  }

  async function generate(promptForRun?: string, options: PoseGenerateOptions = {}) {
    if (isSubmitting) return;
    if (!isAuthenticated && !(await refreshAuth())) {
      toast.error("请先登录");
      router.push("/login");
      return;
    }
    if (!mainImage) {
      toast.error("请先上传主图");
      return;
    }
    if (isUploadingGarmentDetails) {
      toast.info("背/侧补充图正在上传，请稍候");
      return;
    }
    const activePoseAnalysis = getActivePoseAnalysis();
    const activePoseAnalysisError = getActivePoseAnalysisError();
    const poseAnalysisPending = isAnalyzingPose || (!activePoseAnalysis && !activePoseAnalysisError);
    if (poseAnalysisPending) {
      toast.info("主图视觉识别中，完成后再生成");
      return;
    }
    const runExpectedCount = normalizePosePlanCount(options.expectedCountOverride ?? options.genCountOverride ?? poseExpectedCount, poseExpectedCount);
    const runGenCount = normalizePosePlanCount(options.genCountOverride ?? runExpectedCount, runExpectedCount);
    const retryResultIndex = normalizeRetryResultIndex(options.retryResultIndex);
    const retryPreviousResultUrls = retryResultIndex !== null ? resultUrls : [];
    const displayExpectedCount = getRetryDisplayExpectedCount({
      retryIndex: retryResultIndex,
      currentExpectedCount: activeResultExpectedCount,
      previousUrls: retryPreviousResultUrls,
      fallbackExpectedCount: runExpectedCount,
    });
    const runTotalCost = unitCost * runExpectedCount;
    if (credits !== null && credits < runTotalCost) {
      showInsufficientCreditsToast({ required: runTotalCost, balance: credits, onRecharge: () => router.push("/pricing") });
      return;
    }

    const runId = generationRunRef.current + 1;
    generationRunRef.current = runId;
    const isCurrentRun = () => generationRunRef.current === runId;
    setIsSubmitting(true);
    setIsGenerating(true);
    setRunningExpectedCount(displayExpectedCount);
    setError("");
    setResultUrls(buildRetryPendingResultUrls(retryPreviousResultUrls, retryResultIndex, displayExpectedCount));
    if (options.toastMessage) toast.info(options.toastMessage);
    const taskInputThumbnails = mainImage ? [mainImage, ...activePoseReferenceUrls, ...activeGarmentAngleUrls] : [];
    const activePosePlan = isPoseReferenceMode ? null : getActivePosePlan();
    const runPrompt = stripLegacyRuleDemoText(
      isPoseReferenceMode
        ? [
            "图1是唯一的人物、服装、背景、光线和整体摄影质感参考。姿势参考图只用于借鉴身体动作、重心、手脚位置、头颈方向、镜头节奏和兼容构图，不复制参考图人物、服装、背景、色调或道具。",
            supplementPrompt.trim() ? `补充要求：${supplementPrompt.trim()}` : "",
          ].filter(Boolean).join("\n\n")
        : [
            typeof promptForRun === "string" ? promptForRun : prompt,
            supplementPrompt.trim() ? `补充要求：${supplementPrompt.trim()}` : "",
          ].filter(Boolean).join("\n\n")
    );
    const provisionalTask = taskQueue.startTask({
      expectedCount: displayExpectedCount,
      inputThumbnails: taskInputThumbnails,
      progress: 10,
    });
    let activeTaskId = provisionalTask.id;
    let latestTaskResultUrls: string[] = [];

    try {
      const res = await fetch("/api/pose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          main_image_url: mainImage,
          ai_model: aiModel,
          aspect_ratio: aspectRatio,
          image_size: imageSize,
          prompt: runPrompt,
          pose_style: poseStyle,
          pose_creation_mode: isPoseReferenceMode ? "reference" : "free",
          pose_plan_mode: isPoseReferenceMode ? "preset" : posePlanMode,
          output_mode: effectiveOutputMode,
          pose_count: poseRunTargetCount,
          angle_counts: poseAngleCounts,
          gen_count: runGenCount,
          pose_start_index: options.poseStartIndex,
          pose_analysis: activePoseAnalysis,
          pose_plan: activePosePlan,
          pose_reference_urls: activePoseReferenceUrls,
          pose_reference_copies: activePoseReferenceCopies,
          garment_angle_references: activeGarmentAngleReferences,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          await refreshAuth();
          taskQueue.removeTask(activeTaskId);
          if (isCurrentRun()) {
            setIsSubmitting(false);
            setIsGenerating(false);
            router.push("/login");
          }
          return;
        }
        if (res.status === 402) {
          const nextCredits = data.balance ?? 0;
          setCredits(nextCredits);
          if (userId) setCachedProfileCredits(userId, nextCredits);
        }
        throw new Error(data.error || "生成失败");
      }
      if (data.credits_remaining !== undefined) {
        setCredits(data.credits_remaining);
        if (userId) setCachedProfileCredits(userId, data.credits_remaining);
      }
      if (typeof data.generation_id === "string" && data.generation_id) {
        const serverTask = taskQueue.replaceWithServerTask(activeTaskId, {
          id: data.generation_id,
          expectedCount: displayExpectedCount,
          inputThumbnails: taskInputThumbnails,
          status: data.status || "processing_tryon",
          progress: 25,
        });
        activeTaskId = serverTask.id;
      }
      if (isCurrentRun()) {
        setIsSubmitting(false);
        toast.success("任务已提交，可继续创建");
      }

      let elapsedMs = 0;
      while (elapsedMs < POSE_GENERATION_POLL_TIMEOUT_MS) {
        const pollDelayMs = getPoseGenerationPollDelay(elapsedMs);
        await sleep(pollDelayMs);
        elapsedMs += pollDelayMs;
        const poll = await fetch(`/api/pose?generation_id=${data.generation_id}`);
        if (!poll.ok) continue;
        const state = await poll.json();
        if (state.status === "processing_tryon" || state.status === "processing" || state.status === "pending") {
          if (Array.isArray(state.result_urls) && state.result_urls.length) {
            const nextResultUrls = mergeRetryResultUrls(retryPreviousResultUrls, retryResultIndex, state.result_urls, displayExpectedCount);
            latestTaskResultUrls = nextResultUrls;
            if (isCurrentRun()) setResultUrls(nextResultUrls);
          }
          const runningProgress = Math.min(25 + (elapsedMs / POSE_GENERATION_POLL_TIMEOUT_MS) * 65, 90);
          taskQueue.markRunning(activeTaskId, {
            expectedCount: displayExpectedCount,
            inputThumbnails: taskInputThumbnails,
            resultThumbnails: latestTaskResultUrls,
            progress: runningProgress,
            status: state.status,
          });
        } else if (state.status === "completed") {
          const rawFinalUrls = Array.isArray(state.result_urls) ? state.result_urls : latestTaskResultUrls;
          const finalUrls = mergeRetryResultUrls(retryPreviousResultUrls, retryResultIndex, rawFinalUrls, displayExpectedCount);
          const finalResultCount = finalUrls.filter(Boolean).length;
          const expectedResultCount = retryResultIndex !== null
            ? displayExpectedCount
            : Math.max(Number(state.expected_count) || runExpectedCount, runExpectedCount);
          const partialFailure = state.partial_failure && typeof state.partial_failure === "object"
            ? state.partial_failure as { message?: unknown }
            : null;
          const completedError = state.error || partialFailure?.message || "";
          if (isCurrentRun()) {
            setResultUrls(finalUrls);
          }
          taskQueue.markCompleted(activeTaskId, {
            expectedCount: expectedResultCount,
            inputThumbnails: taskInputThumbnails,
            resultThumbnails: finalUrls,
            resultCount: finalResultCount,
            error: completedError ? summarizeGenerationError(completedError) : "",
          });
          if (isCurrentRun()) {
            if (completedError || finalResultCount < expectedResultCount) {
              void refreshCredits();
              toast.warning(`姿势裂变部分完成：已生成 ${finalResultCount}/${expectedResultCount} 张，失败图片灵点会自动退回`);
            } else {
              toast.success("姿势裂变完成");
            }
            setIsGenerating(false);
          }
          return;
        } else if (state.status === "failed") {
          throw new Error(state.error || "生成失败");
        }
      }
      throw new PoseGenerationPollTimeoutError();
    } catch (err: unknown) {
      const message = summarizeGenerationError(err instanceof Error ? err.message : "生成失败");
      if (err instanceof PoseGenerationPollTimeoutError) {
        taskQueue.markRunning(activeTaskId, {
          expectedCount: displayExpectedCount,
          inputThumbnails: taskInputThumbnails,
          resultThumbnails: latestTaskResultUrls,
          progress: 90,
          status: "processing",
        });
        taskQueue.refresh();
        if (isCurrentRun()) {
          setError("");
          toast.info(message);
          setIsSubmitting(false);
          setIsGenerating(false);
        }
        return;
      }
      taskQueue.markFailed(activeTaskId, message, {
        expectedCount: displayExpectedCount,
        inputThumbnails: taskInputThumbnails,
        resultThumbnails: latestTaskResultUrls,
      });
      if (isCurrentRun()) {
        setError(message);
        toast.error(message);
        void refreshCredits();
        setIsSubmitting(false);
        setIsGenerating(false);
      }
    }
  }

  function handleRunningTask(item: TaskQueueItem) {
    generationRunRef.current += 1;
    const expectedCount = clampTaskExpectedCount(item, 1, POSE_PLAN_MAX_COUNT);
    setRunningExpectedCount(expectedCount);
    setIsSubmitting(false);
    setIsGenerating(true);
    setError("");
    setResultUrls(safeTaskQueueUrls(item.resultThumbnails));
  }

  async function handleCompletedTask(item: TaskQueueItem, session: TaskSelectionSession) {
    setRunningExpectedCount(null);
    try {
      const detail = await fetchHistoryApplyDetail(item.id, "pose", session.signal);
      if (!session.isCurrent()) return true;
      applyPoseHistoryPayload(detail.payload, detail.resultUrls.length ? detail.resultUrls : safeTaskQueueUrls(item.resultThumbnails), {
        silent: session.reason === "restore",
      });
      if (item.statusGroup === "failed" || isHistoryApplyRowFailed(detail.row)) {
        setError(getHistoryApplyFailureMessage(detail.row, item.error || "生成失败"));
      }
      return true;
    } catch (err) {
      if (session.signal.aborted || !session.isCurrent()) return true;
      toast.error(err instanceof Error ? err.message : "历史参数加载失败");
      return true;
    }
  }

  function handleContinueCreate() {
    generationRunRef.current += 1;
    setAiModel("nano-banana-2");
    setAspectRatio("auto");
    setImageSize("1K");
    setMainImage("");
    setGarmentAngleEnabled(false);
    setGarmentAngleReferences([]);
    setGarmentAngleTarget("outfit");
    setGarmentAngleView("front");
    setIsDraggingGarmentDetails(false);
    setIsUploadingGarmentDetails(false);
    lastPoseAnalysisKeyRef.current = "";
    poseAnalysisSeqRef.current += 1;
    setPoseAnalysisEntry(null);
    lastPosePlanKeyRef.current = "";
    posePlanSeqRef.current += 1;
    setPosePlanEntry(null);
    setPosePlanMode("preset");
    setShowPosePlanEditor(false);
    setSelectedPosePlanSlotIndex(0);
    setPoseAngleCounts({ ...DEFAULT_POSE_ANGLE_COUNTS });
    setPoseCreationMode("free");
    setPoseReferenceUrls([]);
    setPoseReferenceCopies(1);
    setIsUploadingPoseReferences(false);
    setPrompt(DEFAULT_POSE_PROMPT);
    setSupplementPrompt("");
    setOutputMode("separate");
    setPoseStyle(DEFAULT_POSE_SERIES_STYLE);
    setRunningExpectedCount(null);
    setIsSubmitting(false);
    setIsGenerating(false);
    setResultUrls([]);
    setError("");
    setLightboxSrc(null);
    setShowPoseRules(false);
    setRulesPopoverStyle(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (poseReferenceInputRef.current) poseReferenceInputRef.current.value = "";
    if (garmentDetailInputRef.current) garmentDetailInputRef.current.value = "";
  }

  const activePoseAnalysis = getActivePoseAnalysis();
  const activePoseAnalysisError = getActivePoseAnalysisError();
  const activePosePlan = getActivePosePlan();
  const poseAnalysisSummary = getPoseVisualAnalysisSummary(activePoseAnalysis);
  const poseAnalysisDetails = getPoseVisualAnalysisDetailItems(activePoseAnalysis);
  const poseAnalysisSummaries: VisualAnalysisSummaryItem[] = poseAnalysisDetails.map((item) => ({
    key: item.label,
    title: `${item.label} · ${item.value}`,
    detail: item.title && item.title !== item.value ? item.title : "",
  }));
  const poseAnalysisStatus = isAnalyzingPose
    ? { tone: "loading" as const, text: "正在读取主图" }
    : activePoseAnalysis
      ? {
          tone: activePoseAnalysisError || poseAnalysisSource === "fallback" || activePoseAnalysis.confidence < 0.45
            ? "warning" as const
            : "success" as const,
          text: poseAnalysisSource === "fallback" ? "主图已保守处理" : "主图信息已就绪",
          description: poseAnalysisSummary || "人物与构图已读取",
        }
      : activePoseAnalysisError
        ? { tone: "warning" as const, text: "主图读取未完成", description: activePoseAnalysisError }
        : null;
  const posePlanSummaries = getPosePlanSummary(activePosePlan);
  const posePlanStatus = isPlanningPose
    ? { tone: "loading" as const, text: "正在整理姿势" }
    : activePosePlan
      ? {
          tone: posePlanError || posePlanSource === "fallback" ? "warning" as const : "success" as const,
          text: posePlanError || posePlanSource === "fallback" ? "姿势计划已保守处理" : "姿势计划已就绪",
          description: `${activePosePlan.edited ? "已编辑" : POSE_PLAN_SOURCE_LABELS[posePlanSource || "vision_plan"]} · ${activePosePlan.slots.length} 个姿势`,
        }
      : posePlanError
        ? { tone: "warning" as const, text: "姿势计划未完成", description: posePlanError }
        : null;
  const selectedPosePlanSlot = activePosePlan?.slots[selectedPosePlanSlotIndex] || activePosePlan?.slots[0] || null;
  const suppressPoseFaceControls = shouldSuppressPoseFacePlanning(activePoseAnalysis);
  const selectedActionPresets = getCommercialPoseActionPresets(selectedPosePlanSlot?.angle);
  const selectedExpressionPresets = getCommercialPoseExpressionPresets(selectedPosePlanSlot?.angle, suppressPoseFaceControls);
  const selectedActionPresetId = getSelectedActionPresetId(selectedPosePlanSlot);
  const selectedExpressionPresetId = getSelectedExpressionPresetId(selectedPosePlanSlot);
  const selectedActionPreset = selectedActionPresets.find((preset) => preset.id === selectedActionPresetId) || null;
  const selectedExpressionPreset = selectedExpressionPresets.find((preset) => preset.id === selectedExpressionPresetId) || null;
  const normalizedPoseAngleCounts = normalizePoseAngleCounts(poseAngleCounts);
  const activePoseAnglePreset = POSE_ANGLE_PRESETS.find((preset) => isSamePoseAngleCounts(normalizedPoseAngleCounts, preset.counts)) || null;
  const poseAnglePlanLabel = activePoseAnglePreset ? activePoseAnglePreset.label : "自定义组合";

  return (
    <div className="studio-workbench min-h-[calc(100dvh-64px)] lg:h-[calc(100vh-64px)] flex flex-col lg:flex-row">
      <FeatureTabs active="pose" />
      <ModuleTaskRail module="pose" moduleLabel="姿势裂变" onContinue={handleContinueCreate} onRunningTask={handleRunningTask} onCompletedTask={handleCompletedTask} />
      <div className="studio-parameters w-full lg:w-[472px] border-b lg:border-b-0 lg:border-r flex flex-col overflow-visible lg:overflow-hidden">
        <div className="studio-parameters-scroll flex-1 overflow-visible lg:overflow-y-auto p-3 sm:p-5 space-y-4 sm:space-y-6">
          <ModuleHeader
            title="姿势裂变"
            tooltip="基于图1人物、服装、场景和光线，按选择的角度数量生成同一套视觉里的姿势变化，适合主图延展、搭配展示和社媒排版。"
            actions={(
              <button
                ref={rulesButtonRef}
                type="button"
                onMouseEnter={openRulesPopover}
                onMouseLeave={scheduleRulesHide}
                onFocus={openRulesPopover}
                onBlur={scheduleRulesHide}
                aria-expanded={showPoseRules}
                className="studio-upload-rule-button"
              >
                图片规则 <ChevronRight aria-hidden="true" className="h-3 w-3" />
              </button>
            )}
          />
          <section
            {...mainImageDrag.dragHandlers}
            className={`studio-stable-upload-boundary relative rounded-xl transition-[box-shadow] ${isDragging ? "ring-2 ring-zinc-900/30 ring-offset-2" : ""}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              aria-label="上传模特图"
              onChange={(event) => {
                const input = event.currentTarget;
                void handleFile(input.files?.[0]).finally(() => {
                  input.value = "";
                });
              }}
            />
            <StudioUploadTile
              title="上传模特图"
              description="图1作为服装、人物关系和构图基础，建议主体完整、服装清晰。"
              imageUrl={mainImage || null}
              imageAlt="姿势裂变主图"
              isDragging={isDragging}
              loading={isUploading}
              onUploadClick={() => fileInputRef.current?.click()}
              onLibraryClick={() => toast.info("作品库选择即将接入")}
              onPreview={mainImage ? () => setLightboxSrc(mainImage) : undefined}
              onRemove={mainImage ? () => setMainImage("") : undefined}
              libraryLabel="从作品选择"
              footnote="主体完整、服装清晰、无遮挡时最稳；系统会保留人物和穿搭，只变化姿势。"
              examples={{
                label: "试一试",
                images: POSE_UPLOAD_RULE.demos.map((demo) => ({ url: demo.imageUrl, title: demo.title })),
                onSelect: (image) => applyRuleDemo({ title: image.title, imageUrl: image.url }),
              }}
            />
            {poseAnalysisStatus && (
              <VisualAnalysisStatusCard
                status={poseAnalysisStatus}
                summaries={poseAnalysisSummaries}
                isAnalyzing={isAnalyzingPose}
                className="mt-2"
                action={poseAnalysisStatus.tone === "warning" && mainImage ? (
                    <button
                      type="button"
                      onClick={retryPoseAnalysis}
                      className="rounded-full border border-current/15 bg-white/75 px-2.5 py-1 text-[10px] font-semibold transition hover:bg-white"
                    >
                      重试
                    </button>
                  ) : null}
              />
            )}
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="font-bold text-sm">创作模式</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                自由模式按商业动作库生成；参考图模式只借鉴参考图姿势，不复制人物、服装和背景。
              </p>
            </div>

            <div className="grid grid-cols-2 rounded-2xl bg-slate-100 p-1">
              {[
                { value: "free" as const, label: "自由模式", desc: "默认动作库" },
                { value: "reference" as const, label: "参考图模式", desc: "按图借姿势" },
              ].map((item) => {
                const selected = poseCreationMode === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setPoseCreationMode(item.value)}
                    className={`rounded-xl px-3 py-2 text-center transition ${
                      selected
                        ? "bg-white text-zinc-900 shadow-[0_8px_18px_rgba(5,5,5,0.10)]"
                        : "text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    <span className="block text-xs font-black">{item.label}</span>
                    <span className="mt-0.5 block text-[10px] font-bold opacity-70">{item.desc}</span>
                  </button>
                );
              })}
            </div>

            {poseCreationMode === "reference" && (
              <>
              <StudioUploadSection
                title={(
                  <span className="flex items-center gap-2">
                    姿势参考图
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-700">
                      {poseReferenceUrls.length}/{MAX_POSE_REFERENCE_IMAGES}
                    </span>
                  </span>
                )}
                inputRef={poseReferenceInputRef}
                onFiles={handlePoseReferenceFiles}
                multiple
                isDragging={isDraggingPoseReferences}
                setDragging={setIsDraggingPoseReferences}
              >
                {(openFileDialog) => (
                  <StudioMultiImageUpload
                    urls={poseReferenceUrls}
                    maxCount={MAX_POSE_REFERENCE_IMAGES}
                    title="已上传姿势参考图"
                    emptyTitle="上传 / 拖拽参考图"
                    description="已选择的参考图只用于借鉴动作、重心和镜头节奏。"
                    emptyDescription="参考图只借动作、重心和镜头节奏，不复制人物、服装或背景。"
                    itemLabelPrefix="图"
                    loading={isUploadingPoseReferences}
                    isDragging={isDraggingPoseReferences}
                    uploadLabel="从本地上传"
                    libraryLabel="从作品选择"
                    summary={poseReferenceUrls.length ? `${poseReferenceOutputCount} 张独立图` : undefined}
                    footnote="建议选择肢体完整、动作清楚、不要多人同框的参考图；人物身份、脸、服装和背景仍以主图为准。"
                    imageFit="cover"
                    onUploadClick={openFileDialog}
                    onLibraryClick={() => toast.info("作品库选择即将接入")}
                    onPreview={(url) => setLightboxSrc(url)}
                    onRemove={(_, index) => setPoseReferenceUrls((prev) => prev.filter((__, i) => i !== index))}
                    onClear={() => setPoseReferenceUrls([])}
                    examples={!poseReferenceUrls.length ? {
                      label: "试一试",
                      images: POSE_REFERENCE_DEMOS.map((demo) => ({
                        url: demo.imageUrls[0],
                        title: demo.title,
                        previewUrls: demo.imageUrls,
                      })),
                      disabled: isUploadingPoseReferences,
                      onSelect: (image) => {
                        const demo = POSE_REFERENCE_DEMOS.find((item) => item.title === image.title && item.imageUrls[0] === image.url);
                        if (demo) applyPoseReferenceDemo(demo);
                      },
                    } : undefined}
                  />
                )}
              </StudioUploadSection>
              {activePoseReferenceUrls.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-950">生成数量</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                        {activePoseReferenceUrls.length} 张参考图 × 每张 {activePoseReferenceCopies} 张 = {poseReferenceOutputCount} 张独立图
                      </p>
                    </div>
                    <div className="grid h-9 shrink-0 grid-cols-[34px_52px_34px] overflow-hidden rounded-full border border-slate-200 bg-slate-50">
                      <button
                        type="button"
                        onClick={() => setPoseReferenceCopies((count) => normalizePoseReferenceCopies(count - 1, activePoseReferenceUrls.length))}
                        disabled={activePoseReferenceCopies <= 1}
                        className="inline-flex items-center justify-center text-slate-500 transition hover:bg-white hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30"
                        aria-label="减少每张参考图生成数量"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <input
                        type="number"
                        min={1}
                        value={activePoseReferenceCopies}
                        onChange={(event) => setPoseReferenceCopies(normalizePoseReferenceCopies(event.target.value, activePoseReferenceUrls.length))}
                        className="w-full border-x border-slate-200 bg-white text-center text-xs font-black text-slate-900 outline-none"
                        aria-label="每张参考图生成数量"
                      />
                      <button
                        type="button"
                        onClick={() => setPoseReferenceCopies((count) => normalizePoseReferenceCopies(count + 1, activePoseReferenceUrls.length))}
                        className="inline-flex items-center justify-center text-slate-500 transition hover:bg-white hover:text-zinc-900"
                        aria-label="增加每张参考图生成数量"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <div className="rounded-2xl border border-emerald-100 bg-[linear-gradient(180deg,#f7fffb_0%,#ffffff_100%)] px-3 py-3 shadow-sm">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div className="min-w-0">
                    <p className="text-xs font-black text-slate-900">
                      {activePoseReferenceUrls.length ? `将生成 ${poseReferenceOutputCount} 张独立图` : "上传参考图后独立生成"}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                      参考图模式直接按上传图片借姿势，不生成姿势计划，也不输出宫格；人物、服装、背景和光线仍以主图为准。
                    </p>
                  </div>
                </div>
              </div>
              </>
            )}
          </section>

          <section className="space-y-3">
            <button
              type="button"
              onClick={toggleGarmentDetails}
              className={`flex w-full items-center justify-between rounded-2xl border p-3 text-left transition-all ${
                garmentAngleEnabled
                  ? "border-zinc-300 bg-zinc-100 text-zinc-900"
                  : shouldSuggestBackReference
                    ? "border-amber-200 bg-amber-50/70 text-amber-900 hover:border-amber-300"
                    : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
              }`}
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-sm font-black">
                  背面 / 侧面服装补充
                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold text-slate-500">可选</span>
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                  {shouldSuggestBackReference
                    ? "已选择背面/侧后姿势，最好补一张同款背面图，避免背部结构靠猜。"
                    : "只补服装隐藏面的结构，不会作为人物、脸、姿势、背景或光线参考。"}
                </span>
              </span>
              <span className={`ml-3 flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition ${garmentAngleEnabled ? "bg-[var(--codex-accent)]" : "bg-neutral-200"}`}>
                <span className={`h-5 w-5 rounded-full bg-white shadow transition ${garmentAngleEnabled ? "translate-x-5" : "translate-x-0"}`} />
              </span>
            </button>

            {garmentAngleEnabled && (
              <StudioUploadSection
                title={(
                  <span className="flex items-center gap-2">
                    上传服装背面、侧面或平铺图
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-700">
                      {activeGarmentAngleReferences.length}/{MAX_GARMENT_ANGLE_IMAGES}
                    </span>
                  </span>
                )}
                inputRef={garmentDetailInputRef}
                onFiles={handleGarmentDetailFiles}
                multiple
                isDragging={isDraggingGarmentDetails}
                setDragging={setIsDraggingGarmentDetails}
                className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3"
              >
                {(openFileDialog) => (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-zinc-200 bg-white/92 p-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-zinc-700">这张补充图属于</p>
                          <p className="mt-0.5 truncate text-sm font-black text-slate-900">{activeGarmentAngleMark}</p>
                          <p className="mt-0.5 truncate text-[11px] text-slate-500" title={activeGarmentAngleTargetOption.description}>
                            {activeGarmentAngleTargetOption.description}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-1 text-[10px] font-bold text-zinc-700">
                          还可上传 {MAX_GARMENT_ANGLE_IMAGES - activeGarmentAngleReferences.length} 张
                        </span>
                      </div>

                      <div className="mt-3 space-y-2">
                        <div className="flex items-start gap-2">
                          <span className="mt-1 w-8 shrink-0 text-[11px] font-bold text-slate-500">衣服</span>
                          <div className="flex flex-wrap gap-1.5">
                            {GARMENT_ANGLE_TARGET_OPTIONS.map((item) => {
                              const selected = item.value === garmentAngleTarget;
                              return (
                                <button
                                  key={item.value}
                                  type="button"
                                  onClick={() => setGarmentAngleTarget(item.value)}
                                  title={item.description}
                                  className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                                    selected
                                      ? "border-zinc-900 bg-zinc-900 text-white shadow-sm"
                                      : "border-slate-200 bg-white text-slate-600 hover:border-zinc-300 hover:text-zinc-900"
                                  }`}
                                >
                                  {item.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="flex items-start gap-2">
                          <span className="mt-1 w-8 shrink-0 text-[11px] font-bold text-slate-500">角度</span>
                          <div className="flex flex-wrap gap-1.5">
                            {GARMENT_ANGLE_VIEW_OPTIONS.map((item) => {
                              const selected = item.value === garmentAngleView;
                              return (
                                <button
                                  key={item.value}
                                  type="button"
                                  onClick={() => setGarmentAngleView(item.value)}
                                  className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                                    selected
                                      ? "border-zinc-900 bg-zinc-900 text-white shadow-sm"
                                      : "border-slate-200 bg-white text-slate-600 hover:border-zinc-300 hover:text-zinc-900"
                                  }`}
                                >
                                  {item.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={openFileDialog}
                      disabled={isUploadingGarmentDetails || activeGarmentAngleReferences.length >= MAX_GARMENT_ANGLE_IMAGES}
                      className={`flex w-full items-center gap-3 rounded-xl border border-dashed bg-white/85 p-3 text-left transition hover:border-zinc-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-55 ${
                        isDraggingGarmentDetails ? "border-zinc-900 bg-zinc-50" : "border-zinc-200"
                      }`}
                      aria-label={`上传${activeGarmentAngleMark}背/侧补充图`}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700">
                        {isUploadingGarmentDetails ? <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" /> : <Sparkles aria-hidden="true" className="h-5 w-5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-black text-slate-900">
                          上传为 {activeGarmentAngleMark}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                          建议上传完整背面、侧面、平铺或悬挂图；不要上传纯局部纹理特写。
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-1 text-[10px] font-bold text-zinc-700 shadow-sm">
                        最多 {MAX_GARMENT_ANGLE_IMAGES} 张
                      </span>
                    </button>

                    {activeGarmentAngleReferences.length > 0 && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {activeGarmentAngleReferences.map((ref, index) => {
                            const label = formatGarmentAngleReferenceLabel(ref, index);
                            return (
                              <div key={ref.url} className="group relative overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
                                <button
                                  type="button"
                                  onClick={() => setLightboxSrc(ref.url)}
                                  className="block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/30 focus-visible:ring-offset-2"
                                  aria-label={`预览${label}`}
                                >
                                  <RawPreviewImage src={ref.url} alt={label} className="aspect-[3/4] w-full object-cover" />
                                  <span className="absolute bottom-1 left-1 max-w-[calc(100%-8px)] truncate rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-zinc-900">
                                    {label}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeGarmentDetail(ref.url)}
                                  className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/88 text-slate-500 shadow-sm transition hover:text-red-500"
                                  aria-label={`移除${label}`}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <p className="rounded-lg bg-zinc-100 px-2.5 py-2 text-[11px] leading-relaxed text-zinc-900">
                      {GARMENT_ANGLE_UPLOAD_FOOTNOTE}
                    </p>
                  </div>
                )}
              </StudioUploadSection>
            )}
          </section>

          <section>
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[var(--codex-accent)]" /> 生成模型
            </h3>
            <StudioModelSelector
              models={MODELS}
              value={aiModel}
              onChange={setAiModel}
              ariaLabel="生成模型"
              getMeta={(model) => `${model.desc} · 单张${getCreditCost(model.value, imageSize, aspectRatio)}灵点`}
            />
          </section>

          {!isPoseReferenceMode && (
          <section className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm">生成姿势</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  选择想要的成片方向，系统会自动补动作、表情和构图。
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                activePoseAnglePreset ? "bg-zinc-100 text-zinc-900" : "bg-slate-100 text-slate-600"
              }`}>
                {poseAnglePlanLabel} · {posePlanTargetCount} 张
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {POSE_ANGLE_PRESETS.map((preset) => {
                const selected = activePoseAnglePreset?.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPoseAnglePreset(preset.counts)}
                    aria-pressed={selected}
                    className={`rounded-2xl border px-3 py-2 text-left transition ${
                      selected
                        ? "border-zinc-300 bg-zinc-100 shadow-sm"
                        : "border-slate-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-1.5">
                      <span className={`min-w-0 truncate text-xs font-black ${selected ? "text-zinc-900" : "text-slate-800"}`}>
                        {preset.label}
                      </span>
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-black ${
                        selected ? "bg-white text-zinc-900" : "bg-slate-100 text-slate-500"
                      }`}>
                        {preset.countLabel}
                      </span>
                    </span>
                    <span className={`mt-0.5 block truncate text-[10px] font-semibold ${selected ? "text-zinc-700" : "text-slate-500"}`}>
                      {selected ? "当前方案" : preset.desc}
                    </span>
                  </button>
                );
              })}
            </div>
            {!activePoseAnglePreset ? (
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                已按你的加减调整为自定义组合；上方方案卡可随时一键套用。
              </p>
            ) : null}

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
              {POSE_ANGLE_OPTIONS.map((item) => {
                const count = poseAngleCounts[item.value] || 0;
                const total = posePlanTargetCount;
                const isBack = item.value === "back";
                const isDetail = item.value === "detail";
                return (
                  <div key={item.value} className="border-b border-slate-100 p-3 last:border-b-0">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-black text-slate-950">{item.label}</p>
                          {isDetail ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">输出近景</span>
                          ) : null}
                          {isBack && count > 0 ? (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">建议补背面图</span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{item.desc}</p>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{item.hint}</p>
                      </div>
                      <div className="grid h-9 shrink-0 grid-cols-[34px_34px_34px] overflow-hidden rounded-full border border-slate-200 bg-slate-50">
                        <button
                          type="button"
                          onClick={() => updatePoseAngleCount(item.value, -1)}
                          disabled={count <= 0 || total <= POSE_PLAN_MIN_COUNT}
                          className="inline-flex items-center justify-center text-slate-500 transition hover:bg-white hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30"
                          aria-label={`减少${item.label}姿势`}
                        >
                          <Minus aria-hidden="true" className="h-3.5 w-3.5" />
                        </button>
                        <span className="inline-flex items-center justify-center border-x border-slate-200 bg-white text-xs font-black text-slate-900">
                          {count}
                        </span>
                        <button
                          type="button"
                          onClick={() => updatePoseAngleCount(item.value, 1)}
                          disabled={total >= POSE_PLAN_MAX_COUNT}
                          className="inline-flex items-center justify-center text-slate-500 transition hover:bg-white hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30"
                          aria-label={`增加${item.label}姿势`}
                        >
                          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {shouldSuggestBackReference ? (
              <button
                type="button"
                onClick={() => {
                  setGarmentAngleEnabled(true);
                  setGarmentAngleView("back");
                }}
                className="flex w-full items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-3 text-left transition hover:border-amber-300 hover:bg-amber-50"
              >
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-black text-amber-700">
                  !
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-black text-amber-900">要生成背面，建议上传同款背面参考</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-amber-700">
                    背后拉链、后袋、裙摆后片、肩背线条会更稳定，不会靠模型猜。
                  </span>
                </span>
              </button>
            ) : null}

            <div>
              <StudioOptionGrid
                options={[
                  { value: "separate" as const, label: "独立图", description: `每个姿势单独生成，共 ${posePlanTargetCount} 张` },
                  { value: "grid" as const, label: "自动宫格", description: `${posePlanTargetCount} 个姿势排进 1 张图` },
                ]}
                value={outputMode}
                onChange={setOutputMode}
                columns={2}
                ariaLabel="交付方式"
              />
            </div>
          </section>
          )}

          <section>
            <h3 className="font-bold text-sm mb-3">画布比例</h3>
            <StudioOptionGrid
              options={ASPECTS}
              value={aspectRatio}
              onChange={setAspectRatio}
              columns={3}
              ariaLabel="画布比例"
            />
            <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] leading-relaxed text-slate-500">
              选择智能时会按主图比例自动匹配最接近的画布；选择固定比例时按你的选择生成。人物头身比、服装穿着尺度和身体比例仍按图1保护。
            </div>
          </section>

          {imageSizes.length > 1 && (
            <section>
              <h3 className="font-bold text-sm mb-3">分辨率</h3>
              <StudioOptionGrid
                options={imageSizes.map((size) => ({
                  value: size,
                  label: `${size} · 单张${getCreditCost(aiModel, size, aspectRatio)}灵点`,
                }))}
                value={imageSize}
                onChange={setImageSize}
                columns={3}
                ariaLabel="分辨率"
              />
            </section>
          )}

          {!mainImage && !isPoseReferenceMode && (
            <section className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-sm flex items-center gap-2">
                    <PenLine className="w-4 h-4 text-[var(--codex-accent)]" /> 姿势计划
                  </h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                    自由模式会在上传主图后自动规划姿势。
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#f8fffb_100%)] px-3 py-3 shadow-[0_10px_28px_rgba(16,185,129,0.07)]">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200/80">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-black text-emerald-900">上传主图后自动规划</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                      上传主图后，系统会识别人物、服装、背景和光线，再生成姿势计划；未上传前不生成空计划，避免误导。
                    </p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {mainImage && !isPoseReferenceMode && (
            <section className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-sm flex items-center gap-2">
                    <PenLine className="w-4 h-4 text-[var(--codex-accent)]" /> 姿势计划
                  </h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                    默认使用商业模特动作库；需要更贴合主图时，再点智能优化。
                  </p>
                </div>
                {activePosePlan && showPosePlanEditor ? (
                  <button
                    type="button"
                    onClick={() => setShowPosePlanEditor(false)}
                    className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:border-zinc-300 hover:text-zinc-900"
                  >
                    收起编辑
                  </button>
                ) : null}
              </div>

              <div className="rounded-[22px] border border-[#d9e4f2] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-3 shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex rounded-full bg-[#edf3fa] p-1 shadow-inner shadow-slate-200/70">
                    <button
                      type="button"
                      onClick={usePresetPosePlan}
                      className={`rounded-full px-3.5 py-1.5 text-[11px] font-black transition ${
                        posePlanMode === "preset"
                          ? "bg-white text-zinc-900 shadow-[0_5px_14px_rgba(5,5,5,0.10)]"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      商业预设
                    </button>
                    <button
                      type="button"
                      onClick={retryPosePlan}
                      disabled={isPlanningPose || !mainImage}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        posePlanMode === "ai"
                          ? "bg-white text-zinc-900 shadow-[0_5px_14px_rgba(5,5,5,0.10)]"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      {isPlanningPose ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-700" /> : null}
                      智能优化
                    </button>
                  </div>
                  <span className="rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-black text-slate-500 ring-1 ring-slate-200/80">
                    {activePosePlan ? `${activePosePlan.slots.length} 个姿势` : "待规划"}
                  </span>
                </div>

                {posePlanStatus && (
                  <div className="mt-3">
                    <VisualAnalysisStatusCard status={posePlanStatus} />
                  </div>
                )}

                {activePosePlan && (
                  <div className="mt-3 overflow-hidden rounded-[18px] border border-slate-200/90 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                    {posePlanSummaries.map((item, index) => {
                      const slot = activePosePlan.slots[index];
                      const editing = showPosePlanEditor && index === selectedPosePlanSlotIndex && selectedPosePlanSlot;
                      return (
                        <div
                          key={item.key}
                          className={`group border-t border-slate-100 first:border-t-0 ${
                            editing ? "bg-[linear-gradient(90deg,#f5f9ff_0%,#ffffff_74%)]" : "bg-white hover:bg-slate-50/45"
                          }`}
                        >
                          <div className="flex items-start gap-3 px-3.5 py-3.5">
                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${
                              editing
                                ? "bg-zinc-950 text-white shadow-[0_8px_16px_rgba(5,5,5,0.20)]"
                                : "bg-slate-100 text-slate-500 ring-1 ring-slate-200/70 group-hover:bg-white group-hover:text-slate-700"
                            }`}>
                              {index + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="text-[11px] font-black text-slate-500">
                                  姿势 {index + 1}
                                </span>
                                {slot?.angle ? (
                                  <span className={getPoseAngleBadgeClass(slot.angle)}>
                                    {POSE_PLAN_ANGLE_LABELS[slot.angle]}
                                  </span>
                                ) : null}
                                <span className="min-w-0 truncate text-[13px] font-black text-slate-950">
                                  {slot?.poseName || item.title}
                                </span>
                              </div>
                              <p className="mt-1 line-clamp-2 text-[11px] leading-[1.65] text-slate-500" title={item.detail}>
                                {item.detail || slot?.bodyAction || "姿势规划已就绪"}
                              </p>
                              {slot?.headDirection && !suppressPoseFaceControls ? (
                                <p className="mt-1 line-clamp-1 text-[11px] leading-relaxed text-slate-400" title={slot.headDirection}>
                                  表情/视线：{slot.headDirection}
                                </p>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedPosePlanSlotIndex(index);
                                setShowPosePlanEditor((current) => !(current && index === selectedPosePlanSlotIndex));
                              }}
                              className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-black transition ${
                                editing
                                  ? "border-zinc-950 bg-zinc-950 text-white shadow-[0_8px_16px_rgba(5,5,5,0.18)]"
                                  : "border-slate-200 bg-white/90 text-slate-600 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
                              }`}
                            >
                              {editing ? "收起" : "编辑"}
                            </button>
                          </div>

                          {editing ? (
                            <div className="border-t border-zinc-200 px-3.5 pb-3.5 pt-3">
                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="block">
                                  <span className="mb-1.5 block text-[11px] font-black text-slate-700">
                                    {selectedPosePlanSlot.angle ? `${POSE_PLAN_ANGLE_LABELS[selectedPosePlanSlot.angle]}动作模板` : "动作模板"}
                                  </span>
                                  <select
                                    value={selectedActionPresetId}
                                    onChange={(event) => applyPoseActionPreset(selectedPosePlanSlotIndex, event.target.value)}
                                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-950 shadow-sm outline-none transition hover:border-zinc-300 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-200"
                                  >
                                    <option value="current">{selectedActionPresetId === "current" ? `按计划：${selectedPosePlanSlot.poseName || "原计划"}` : "按计划"}</option>
                                    {selectedActionPresets.map((preset) => (
                                      <option key={preset.id} value={preset.id}>{preset.label}</option>
                                    ))}
                                  </select>
                                </label>

                                <label className="block">
                                  <span className="mb-1.5 block text-[11px] font-black text-slate-700">表情 / 视线</span>
                                  <select
                                    value={selectedExpressionPresetId}
                                    onChange={(event) => applyPoseExpressionPreset(selectedPosePlanSlotIndex, event.target.value)}
                                    disabled={suppressPoseFaceControls || selectedExpressionPresets.length === 0}
                                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-950 shadow-sm outline-none transition hover:border-zinc-300 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                                  >
                                    <option value="current">{suppressPoseFaceControls ? "主图无清晰脸部" : "按计划表情/视线"}</option>
                                    {selectedExpressionPresets.map((preset) => (
                                      <option key={preset.id} value={preset.id}>{preset.label}</option>
                                    ))}
                                  </select>
                                </label>
                              </div>

                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                <div className="rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-slate-200/90">
                                  <p className="text-[10px] font-black text-slate-400">动作说明</p>
                                  <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-slate-600">
                                    {selectedActionPreset?.bodyAction || selectedPosePlanSlot.bodyAction || selectedPosePlanSlot.poseName}
                                  </p>
                                </div>
                                <div className="rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-slate-200/90">
                                  <p className="text-[10px] font-black text-slate-400">表情说明</p>
                                  <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-slate-600">
                                    {suppressPoseFaceControls
                                      ? "主图没有清晰脸部时，系统会自动关闭表情和视线规划。"
                                      : selectedExpressionPreset?.text || selectedPosePlanSlot.headDirection || "自然表情，视线跟随当前镜头方向。"}
                                  </p>
                                </div>
                              </div>

                              <details className="mt-3 rounded-xl border border-slate-200/90 bg-white px-3 py-2 shadow-sm">
                                <summary className="cursor-pointer text-[11px] font-bold text-slate-500 transition-colors hover:text-zinc-900">高级微调：动作、手部、镜头文字</summary>
                                <div className="mt-3 grid gap-3">
                                  <div>
                                    <label className="mb-1 block text-[10px] font-bold text-slate-500">动作细节</label>
                                    <StudioPromptTextarea
                                      value={selectedPosePlanSlot.bodyAction || ""}
                                      onChange={(event) => updatePosePlanSlot(selectedPosePlanSlotIndex, "bodyAction", event.target.value)}
                                      rows={3}
                                      className="custom-scroll"
                                      placeholder="例如：正面站定，双手轻扶腰侧，肩线自然打开。"
                                    />
                                  </div>
                                  <div>
                                    <label className="mb-1 block text-[10px] font-bold text-slate-500">手部动作</label>
                                    <StudioPromptTextarea
                                      value={selectedPosePlanSlot.handAction || ""}
                                      onChange={(event) => updatePosePlanSlot(selectedPosePlanSlotIndex, "handAction", event.target.value)}
                                      rows={2}
                                      className="custom-scroll"
                                      placeholder="例如：一只手轻触衣摆，另一只手自然放松。"
                                    />
                                  </div>
                                  {!suppressPoseFaceControls && (
                                    <div>
                                      <label className="mb-1 block text-[10px] font-bold text-slate-500">表情 / 视线细节</label>
                                      <StudioPromptTextarea
                                        value={selectedPosePlanSlot.headDirection || ""}
                                        onChange={(event) => updatePosePlanSlot(selectedPosePlanSlotIndex, "headDirection", event.target.value)}
                                        rows={2}
                                        className="custom-scroll"
                                        placeholder="例如：自然看向镜头，轻微微笑。"
                                      />
                                    </div>
                                  )}
                                  <div>
                                    <label className="mb-1 block text-[10px] font-bold text-slate-500">镜头补充</label>
                                    <StudioPromptTextarea
                                      value={selectedPosePlanSlot.cameraFraming || ""}
                                      onChange={(event) => updatePosePlanSlot(selectedPosePlanSlotIndex, "cameraFraming", event.target.value)}
                                      rows={2}
                                      className="custom-scroll"
                                      placeholder="例如：近全身商业构图，保留自然留白。"
                                    />
                                  </div>
                                </div>
                              </details>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          )}

          <StudioPromptTextarea
            title="补充要求"
            badge="可选"
            value={supplementPrompt}
            onChange={(event) => setSupplementPrompt(event.target.value)}
            rows={4}
            placeholder="可选：例如希望动作更自然、镜头更干净、服装褶皱保持一致、整组构图更统一..."
            description="补充说明会附加到系统提示词中，影响最终生成效果。"
          />
        </div>

        <StudioRunBar
          summary={`${poseDeliveryLabel}${activeGarmentAngleUrls.length ? ` · ${activeGarmentAngleUrls.length} 张服装角度` : ""}`}
          costLabel={authIsAnonymous ? "登录后查看灵点" : `消耗 ${cost} · 余额 ${credits ?? "-"}`}
          disabled={isSubmitting || Boolean(runDisabledReason)}
          disabledReason={runDisabledReason}
          primaryLabel={authIsAnonymous
            ? "登录后生成"
            : isUploading
              ? "上传中…"
              : isSubmitting
                ? "提交中…"
                : isGenerating
                  ? "继续生成"
                  : isPoseReferenceMode
                    ? `生成 ${activePoseReferenceUrls.length ? poseReferenceOutputCount : 0} 张独立图`
                    : outputMode === "separate" ? `生成 ${posePlanTargetCount} 张姿势图` : `生成 ${posePlanTargetCount} 姿势宫格`}
          isLoading={isSubmitting}
          onPrimaryAction={() => generate()}
        />
      </div>

      <div className="studio-canvas min-h-[260px] sm:min-h-[360px] lg:min-h-0 flex-1 relative overflow-hidden mt-3 mb-6 lg:mt-0 lg:mb-0">
        {!isGenerating && resultUrls.length === 0 && !error && (
          <div className="studio-empty-stage min-h-[260px] sm:min-h-[360px] lg:h-full flex items-center justify-center px-4">
            <PreviewGuide
              title="一张原图，裂变多姿势"
              subtitle="保留人物和穿搭，只变化姿势。"
              steps={[
                {
                  title: "上传原图",
                  desc: "",
                  imageSrc: "/tutorial-guides/pose-source.webp",
                  imageAlt: "姿势裂变原图",
                  badge: "原图",
                },
                {
                  title: "生成结果",
                  desc: "",
                  imageSrc: "/tutorial-guides/pose-result.webp",
                  imageAlt: "姿势裂变结果图",
                  badge: "结果图",
                },
              ]}
            />
          </div>
        )}

        {(isGenerating || resultUrls.length > 0) && (
          <div className="studio-result-stage min-h-[260px] sm:min-h-[360px] overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:h-full flex flex-col animate-fade-in">
            {isGenerating && (
              <div className="mb-4 rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-xs font-medium text-zinc-700 shadow-sm">
                已生成 {resultUrls.length}{` / ${runningExpectedCount || poseExpectedCount}`}，剩余图片生成中...
              </div>
            )}
            <div className="flex min-h-0 flex-1 items-start justify-start">
              <ResultImageGrid
                urls={resultUrls}
                filenamePrefix="pose"
                extension="jpg"
                onOpen={(_, index) => setPreviewIndex(index)}
                expectedCount={activeResultExpectedCount}
                isGenerating={isGenerating}
                inputThumbnails={mainImage ? [mainImage, ...activePoseReferenceUrls, ...activeGarmentAngleUrls] : []}
                statusGroup={isGenerating ? "running" : undefined}
                variant="task"
                markMissingAsFailed={hasCompletedPartialResults}
                missingFailureLabel="本张生成失败"
                missingFailureDetail={partialFailureMessage}
                missingFailureActionLabel="重试本张"
                onMissingFailureAction={handleRetryFailedResult}
                missingFailureActionDisabled={retryDisabled}
              />
            </div>
            <StudioImagePreviewDialog
              open={previewIndex !== null}
              onClose={() => setPreviewIndex(null)}
              session={previewSession}
              selectedIndex={previewIndex || 0}
              onSelectedIndexChange={setPreviewIndex}
              filenamePrefix="pose"
              extension="jpg"
              actions={POSE_PREVIEW_ACTIONS}
              onRegenerateAll={() => void generate()}
            />
          </div>
        )}

        {error && (
          <ErrorStage
            error={summarizeGenerationError(error)}
            onRetry={() => { setError(""); void generate(); }}
            isGenerating={isGenerating}
            retryDisabled={retryDisabled}
            retryLabel="重新生成"
            notice={FAILED_RETRY_NOTICE}
          />
        )}
      </div>

      {showPoseRules && rulesPopoverStyle && (
        <ClientPortal>
          <div
            className="fixed z-[240] w-[min(720px,calc(100vw-32px))] overflow-hidden rounded-[24px] border border-white/80 bg-white/[0.96] shadow-[0_28px_90px_rgba(15,23,42,0.18)] backdrop-blur-2xl animate-fade-in"
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
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--codex-accent)]">{POSE_UPLOAD_RULE.shortTitle}</p>
                <h3 className="mt-1 text-base font-bold text-slate-950">{POSE_UPLOAD_RULE.title}</h3>
                <p className="mt-1 text-xs text-slate-500">{POSE_UPLOAD_RULE.uploadSpecText}</p>
              </div>
              <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-700">Hover 预览</span>
            </div>

            <div className="studio-scrollbar-hide overflow-y-auto px-5 py-4" style={{ maxHeight: rulesPopoverStyle.maxHeight - 88 }}>
              <div className="grid gap-3 md:grid-cols-5">
                {POSE_UPLOAD_RULE.demos.map((demo) => (
                  <div key={demo.imageUrl} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-2">
                    <div className="relative overflow-hidden rounded-xl bg-white">
                      <RawPreviewImage src={demo.imageUrl} alt={demo.title} className="aspect-[3/4] w-full object-cover" />
                      <CheckCircle2 className="absolute right-2 top-2 h-5 w-5 rounded-full bg-white text-emerald-500" />
                    </div>
                    <p className="mt-2 truncate text-center text-xs font-medium text-slate-700">{demo.title}</p>
                    <button
                      type="button"
                      onClick={() => applyRuleDemo(demo)}
                      className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-zinc-300 hover:text-zinc-900"
                    >
                      试一试
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-2xl bg-red-50/40 p-3">
                <p className="mb-3 text-center text-xs font-medium text-slate-500">{POSE_UPLOAD_RULE.deprecatedTitle}</p>
                <div className="mx-auto grid max-w-lg grid-cols-3 gap-3">
                  {POSE_UPLOAD_RULE.deprecatedImages.map((image) => (
                    <div key={image.title} className="rounded-2xl border border-red-100 bg-white/70 p-2 text-center">
                      <div className="relative overflow-hidden rounded-xl bg-white">
                        <RawPreviewImage src={image.url} alt={image.title} className="aspect-square w-full object-cover" />
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

      {lightboxSrc && (
        <ClientPortal>
          <div className="fixed inset-0 z-[180] flex cursor-zoom-out items-center justify-center bg-slate-950/66 p-4 backdrop-blur-xl sm:p-8"
            onClick={() => setLightboxSrc(null)}>
            <RawPreviewImage src={lightboxSrc} alt="姿势参考预览" className="max-h-full max-w-full rounded-2xl object-contain shadow-[0_32px_120px_rgba(0,0,0,0.45)]" />
            <button onClick={() => setLightboxSrc(null)}
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/85 bg-white/90 text-slate-700 shadow-[0_12px_34px_rgba(15,23,42,0.22)] backdrop-blur transition-colors hover:bg-white hover:text-slate-950 sm:right-6 sm:top-6">
              <X className="w-5 h-5" />
            </button>
          </div>
        </ClientPortal>
      )}
    </div>
  );
}
