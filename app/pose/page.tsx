"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronRight, Loader2, PenLine, Sparkles, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { setCachedProfileCredits } from "@/lib/supabase/client";
import { isLikelyImageFile, MAX_FILE_SIZE, MAX_FILE_SIZE_MB, uploadImage } from "@/lib/utils";
import { getCreditCost, getSupportedImageSizes, type AspectRatio, type ImageSize, type LingyaModel } from "@/lib/api/lingya";
import { FeatureTabs } from "@/components/FeatureTabs";
import { RepairPromptPanel } from "@/components/RepairPromptPanel";
import { ClientPortal } from "@/components/ClientPortal";
import { type PoseOutputMode } from "@/lib/pose-prompt";
import {
  buildPoseVisualAnalysisKey,
  getPoseVisualAnalysisDetailItems,
  getPoseVisualAnalysisSummary,
  normalizePoseVisualAnalysis,
  type PoseVisualAnalysis,
} from "@/lib/pose-analysis";
import {
  buildPosePlanCacheKey,
  buildUserCustomPosePlan,
  getPosePlanSummary,
  normalizePosePlan,
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
import { StudioUploadSection } from "@/components/studio/StudioUploadSection";
import { StudioUploadTile } from "@/components/studio/StudioUploadTile";
import { useStableFileDrag } from "@/components/studio/useStableFileDrag";
import { useTaskQueueGeneration } from "@/components/studio/useTaskQueueGeneration";
import { fetchHistoryApplyDetail, takeApplyDetail, type HistoryJobPayload } from "@/lib/history-apply";
import { clampTaskExpectedCount, safeTaskQueueUrls, type TaskQueueItem } from "@/lib/task-queue";
import { applyRepairPrompt } from "@/lib/generation-repair";
import { showInsufficientCreditsToast } from "@/lib/ui/credit-copy";
import { createGenericImagePreviewSession, takeSourceImageFromLocation, type ImagePreviewAction } from "@/lib/studio-image-preview";
import {
  DEFAULT_POSE_SERIES_STYLE,
  POSE_SERIES_STYLES,
  USER_CUSTOM_POSE_DEFAULT,
  applyPoseSeriesStylePrompt,
  normalizePoseSeriesStyle,
  type PoseSeriesStyle,
} from "@/lib/module-style-presets";
import { POSE_UPLOAD_RULE, type PoseRuleDemo } from "@/lib/pose-upload-rules";
import {
  GARMENT_DETAIL_SWITCH_DESCRIPTION,
  GARMENT_DETAIL_UPLOAD_FOOTNOTE,
  MAX_GARMENT_DETAIL_IMAGES,
  normalizeGarmentDetailUrls,
} from "@/lib/garment-detail-references";

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

type PoseHistoryPayload = Extract<HistoryJobPayload, { kind: "pose" }>;
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

const POSE_ANALYSIS_SOURCE_LABELS: Record<PoseAnalysisSource, string> = {
  vision: "已识别",
  cache: "缓存识别",
  fallback: "保守识别",
  history: "历史识别",
};

const POSE_PLAN_SOURCE_LABELS: Record<PosePlanSource, string> = {
  vision_plan: "AI 规划",
  cache: "缓存规划",
  fallback: "保守规划",
  preset: "预设计划",
  history: "历史规划",
  user_custom: "已编辑",
};

const DEFAULT_POSE_PROMPT = `Use 图1 as the only reference for the same person, outfit, background, lighting and overall photography style.
Main priority: create clearly different body poses while keeping the outfit design, color, pattern, fabric texture, face identity, natural skin tone and realistic body proportions.
Allow camera framing, body angle and composition to change naturally for each target pose.
Negative: no outfit change, no face change, no extra person, no collage, no text, no distorted hands, no broken limbs.

姿势1：正面服装展示方向；AI 可自由选择自然手势、重心、视线、表情和镜头语言，服装正面轮廓必须清楚。
姿势2：侧身或三分之二侧身展示方向；AI 可自由选择头发/衣领/袖口/衣摆手势、腿部节奏、视线和镜头语言，侧面轮廓和肩线必须清楚。
姿势3：站定造型方向，不要走路；AI 可自由选择扶腰、胯部、肩线、手部造型、视线和镜头语言，腰线、廓形和面料垂坠必须清楚。
姿势4：轻微迈步或自然转身方向，不要静态扶腰；头部方向与肩膀、躯干和身体转向保持一致，不要单独回头看镜头；AI 可自由选择步态、手臂运动、身体转向、视线和镜头语言，服装运动褶皱和垂坠必须清楚。`;

function resolvePoseOutputModeFromPayload(payload: PoseHistoryPayload): PoseOutputMode {
  return payload.outputMode === "grid" ? "grid" : "separate";
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

export default function PosePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const {
    authChecked,
    isAuthenticated,
    userId,
    credits,
    setCredits,
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
  const [customPosePrompt, setCustomPosePrompt] = useState(USER_CUSTOM_POSE_DEFAULT.prompt);
  const [customCamera, setCustomCamera] = useState(USER_CUSTOM_POSE_DEFAULT.camera);
  const [customPoses, setCustomPoses] = useState([...USER_CUSTOM_POSE_DEFAULT.poses]);
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggingGarmentDetails, setIsDraggingGarmentDetails] = useState(false);
  const [garmentDetailEnabled, setGarmentDetailEnabled] = useState(false);
  const [garmentDetailUrls, setGarmentDetailUrls] = useState<string[]>([]);
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
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
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
  const poseExpectedCount = outputMode === "separate" ? 4 : 1;
  const cost = unitCost * poseExpectedCount;
  const activeGarmentDetailUrls = useMemo(
    () => garmentDetailEnabled ? normalizeGarmentDetailUrls(garmentDetailUrls) : [],
    [garmentDetailEnabled, garmentDetailUrls]
  );
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
      : isUploadingGarmentDetails
        ? "服装细节图正在上传，请稍候"
        : isPoseAnalysisPending
          ? "主图正在识别，请稍候。"
          : posePlanMode === "ai" && isPlanningPose
            ? "AI 姿势计划生成中，也可切回预设计划立即生成。"
            : credits !== null && credits < cost
              ? `灵点不足，生成需要 ${cost} 灵点`
              : undefined;
  const poseStyleLabel = POSE_SERIES_STYLES.find((item) => item.value === poseStyle)?.label || poseStyle;
  const previewPosePlan = getActivePosePlan();
  const previewPosePlanText = [
    ...getPosePlanSummary(previewPosePlan).map((item) => `${item.title}：${item.detail}`),
    supplementPrompt.trim() ? `补充要求：${supplementPrompt.trim()}` : "",
  ].map((item) => item.trim()).filter(Boolean).join("\n");
  const previewSession = useMemo(
    () => createGenericImagePreviewSession({
      module: "pose",
      title: "姿势裂变",
      urls: resultUrls,
      expectedCount: isGenerating ? runningExpectedCount || poseExpectedCount : Math.max(resultUrls.length, 1),
      isGenerating,
      statusGroup: isGenerating ? "running" : undefined,
      references: [
        ...(mainImage ? [{ url: mainImage, label: "主图", role: "source" as const }] : []),
        ...activeGarmentDetailUrls.map((url, index) => ({ url, label: `服装细节${index + 1}`, role: "reference" as const })),
      ],
      promptText: previewPosePlanText,
      metaItems: [
        { label: "输出方式", value: outputMode === "separate" ? "每姿势一张" : "四宫格" },
        { label: "画布比例", value: aspectRatio === "auto" ? "智能" : aspectRatio },
        { label: "姿势风格", value: poseStyleLabel },
        { label: "规划方式", value: posePlanMode === "ai" ? POSE_PLAN_SOURCE_LABELS[posePlanSource || "vision_plan"] : "预设计划" },
        { label: "模型", value: aiModel },
        { label: "分辨率", value: imageSize },
        { label: "结果数量", value: poseExpectedCount },
      ],
      resultTitlePrefix: outputMode === "separate" ? "姿势结果" : "姿势四宫格",
      aspectRatio: aspectRatio === "auto" ? undefined : aspectRatio,
    }),
    [activeGarmentDetailUrls, aiModel, aspectRatio, imageSize, isGenerating, mainImage, outputMode, poseExpectedCount, posePlanMode, posePlanSource, poseStyleLabel, previewPosePlanText, resultUrls, runningExpectedCount]
  );
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
    const planKey = buildPosePlanKey(payload.mainImageUrl, analysis, normalizePoseSeriesStyle(payload.poseStyle), resolvePoseOutputModeFromPayload(payload), payload.prompt, planMode);
    posePlanSeqRef.current += 1;
    if (payload.posePlan && planKey) {
      const entry: PosePlanEntry = {
        plan: normalizePosePlan(payload.posePlan, {
          poseAnalysis: analysis,
          poseStyle: normalizePoseSeriesStyle(payload.poseStyle),
          outputMode: resolvePoseOutputModeFromPayload(payload),
          prompt: payload.prompt,
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

  function buildPlanPromptSource() {
    return stripLegacyRuleDemoText([
      poseStyle === "user_custom" ? buildCustomPosePrompt() : prompt,
      supplementPrompt.trim() ? `补充要求：${supplementPrompt.trim()}` : "",
    ].filter(Boolean).join("\n\n"));
  }

  function buildPosePlanKey(
    imageUrl = mainImage,
    analysis = getActivePoseAnalysis(),
    style = poseStyle,
    mode = outputMode,
    planPrompt = buildPlanPromptSource(),
    planMode = posePlanMode
  ) {
    if (!imageUrl) return "";
    const baseKey = buildPosePlanCacheKey({
      mainImageUrl: imageUrl,
      poseAnalysis: analysis,
      poseStyle: style,
      outputMode: mode,
      prompt: planPrompt,
    });
    return `${baseKey}|mode:${style === "user_custom" ? "custom" : planMode}`;
  }

  function getActivePosePlan() {
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

  function updatePosePlanSlot(index: number, key: keyof Pick<PosePlan["slots"][number], "bodyAction" | "handAction" | "headDirection" | "cameraFraming" | "garmentVisibilityRule">, value: string) {
    setPosePlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        edited: true,
        slots: prev.slots.map((slot, slotIndex) => (
          slotIndex === index ? { ...slot, [key]: value } : slot
        )),
      };
    });
    setPosePlanSource("user_custom");
  }

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
      } catch (err: any) {
        if (poseAnalysisSeqRef.current !== seq) return;
        setPoseAnalysisEntryKey(analysisKey);
        setPoseAnalysis(null);
        setPoseAnalysisSource(null);
        setPoseAnalysisError(err?.message || "主图识别失败，已按默认规则继续");
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

    const activeAnalysis = getActivePoseAnalysis();
    const activeAnalysisError = getActivePoseAnalysisError();
    const planPrompt = buildPlanPromptSource();
    const planKey = buildPosePlanKey(imageUrl, activeAnalysis, poseStyle, outputMode, planPrompt);
    if (lastPosePlanKeyRef.current === planKey) return;
    lastPosePlanKeyRef.current = planKey;
    const seq = posePlanSeqRef.current + 1;
    posePlanSeqRef.current = seq;

    if (poseStyle === "user_custom") {
      const plan = buildUserCustomPosePlan({
        poseAnalysis: activeAnalysis,
        poseStyle,
        outputMode,
        prompt: planPrompt,
        customPosePrompt,
        customCamera,
        customPoses,
      });
      const entry: PosePlanEntry = { plan, source: "user_custom", error: null };
      posePlanCacheRef.current.set(planKey, entry);
      setPosePlanEntry(entry);
      return;
    }

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
      } catch (err: any) {
        if (posePlanSeqRef.current !== seq) return;
        const fallback = normalizePosePlan(null, {
          poseAnalysis: activeAnalysis,
          poseStyle,
          outputMode,
          prompt: planPrompt,
        });
        setPosePlanEntry({
          plan: fallback,
          source: "fallback",
          error: err?.message || "姿势规划失败，已使用保守方案",
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
    posePlanMode,
    outputMode,
    prompt,
    supplementPrompt,
    customPosePrompt,
    customCamera,
    customPoses,
    posePlanRetryCount,
  ]);

  function applyPoseHistoryPayload(payload: PoseHistoryPayload, historyResultUrls: string[] = [], options?: { silent?: boolean }) {
    generationRunRef.current += 1;
    const nextPosePlanMode = resolvePosePlanModeFromPayload(payload);
    setPosePlanMode(nextPosePlanMode);
    setMainImage(payload.mainImageUrl);
    const historyGarmentDetailUrls = normalizeGarmentDetailUrls(payload.garmentDetailUrls);
    setGarmentDetailUrls(historyGarmentDetailUrls);
    setGarmentDetailEnabled(historyGarmentDetailUrls.length > 0);
    applyPoseAnalysisSnapshot(payload.mainImageUrl, payload.poseAnalysis);
    applyPosePlanSnapshot(payload);
    setAiModel(payload.aiModel);
    setAspectRatio(resolvePoseAspectRatioFromPayload(payload));
    setImageSize(payload.imageSize);
    setPrompt(payload.prompt);
    setSupplementPrompt("");
    setPoseStyle(normalizePoseSeriesStyle(payload.poseStyle));
    setOutputMode(resolvePoseOutputModeFromPayload(payload));
    setRunningExpectedCount(null);
    setResultUrls(historyResultUrls);
    setIsSubmitting(false);
    setIsGenerating(false);
    setProgress(historyResultUrls.length ? 100 : 0);
    setError("");
    if (!options?.silent) toast.success("已套用历史参数");
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
    const detail = await takeApplyDetail("pose");
    const payload = detail?.payload;
    if (cancelled || !payload) return;

    applyPoseHistoryPayload(payload, detail?.resultUrls || []);
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
    setResultUrls([]);
    setError("");

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

  function toggleGarmentDetails() {
    setGarmentDetailEnabled((value) => !value);
  }

  async function handleGarmentDetailFiles(files?: FileList | File[]) {
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
        toast.success(`已添加 ${uploadedUrls.length} 张服装细节图`);
      }
    } finally {
      setIsUploadingGarmentDetails(false);
    }
  }

  function removeGarmentDetail(url: string) {
    setGarmentDetailUrls((prev) => prev.filter((item) => item !== url));
  }

  async function optimizePrompt() {
    if (!mainImage) {
      toast.error("请先上传主图");
      return;
    }
    setIsOptimizing(true);
    try {
      const res = await fetch("/api/pose/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ main_image_url: mainImage, prompt: stripLegacyRuleDemoText(prompt), pose_style: poseStyle }),
      });
      const data = await res.json();
      if (data.prompt) {
        setPrompt(data.prompt);
        toast.success("视觉分析已优化提示词");
      } else {
        toast.error("视觉优化失败，已保留当前提示词");
      }
    } catch {
      toast.error("视觉优化失败");
    } finally {
      setIsOptimizing(false);
    }
  }

  function selectPoseStyle(nextStyle: PoseSeriesStyle) {
    setPoseStyle(nextStyle);
    if (nextStyle === "user_custom") {
      // 自定义风格：用用户编辑的值构建提示词
      setPrompt(buildCustomPosePrompt());
    } else {
      setPrompt((prev) => applyPoseSeriesStylePrompt(prev, nextStyle));
    }
  }

  function buildCustomPosePrompt(): string {
    return [
      customPosePrompt,
      "",
      customCamera,
      "",
      ...customPoses,
    ].join("\n");
  }

  function applyRuleDemo(demo: PoseRuleDemo) {
    setMainImage(demo.imageUrl);
    setPrompt((prev) => stripLegacyRuleDemoText(prev));
    setResultUrls([]);
    setError("");
    setShowPoseRules(false);
    setRulesPopoverStyle(null);
    toast.success("已套用示例图");
  }

  async function generate(promptForRun?: string) {
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
      toast.info("服装细节图正在上传，请稍候");
      return;
    }
    const activePoseAnalysis = getActivePoseAnalysis();
    const activePoseAnalysisError = getActivePoseAnalysisError();
    const poseAnalysisPending = isAnalyzingPose || (!activePoseAnalysis && !activePoseAnalysisError);
    if (poseAnalysisPending) {
      toast.info("主图视觉识别中，完成后再生成");
      return;
    }
    if (credits !== null && credits < cost) {
      showInsufficientCreditsToast({ required: cost, balance: credits, onRecharge: () => router.push("/pricing") });
      return;
    }

    const runId = generationRunRef.current + 1;
    generationRunRef.current = runId;
    const isCurrentRun = () => generationRunRef.current === runId;
    setIsSubmitting(true);
    setIsGenerating(true);
    setRunningExpectedCount(poseExpectedCount);
    setProgress(10);
    setError("");
    setResultUrls([]);
    const taskInputThumbnails = mainImage ? [mainImage, ...activeGarmentDetailUrls] : [];
    const activePosePlan = getActivePosePlan();
    const provisionalTask = taskQueue.startTask({
      expectedCount: poseExpectedCount,
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
          prompt: stripLegacyRuleDemoText([
            typeof promptForRun === "string"
              ? promptForRun
              : poseStyle === "user_custom"
                ? buildCustomPosePrompt()
                : prompt,
            supplementPrompt.trim() ? `补充要求：${supplementPrompt.trim()}` : "",
          ].filter(Boolean).join("\n\n")),
          pose_style: poseStyle,
          pose_plan_mode: posePlanMode,
          output_mode: outputMode,
          gen_count: poseExpectedCount,
          pose_analysis: activePoseAnalysis,
          pose_plan: activePosePlan,
          garment_detail_urls: activeGarmentDetailUrls,
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
      if (isCurrentRun()) setProgress(25);
      if (typeof data.generation_id === "string" && data.generation_id) {
        const serverTask = taskQueue.replaceWithServerTask(activeTaskId, {
          id: data.generation_id,
          expectedCount: poseExpectedCount,
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
            latestTaskResultUrls = state.result_urls;
            if (isCurrentRun()) setResultUrls(state.result_urls);
          }
          const runningProgress = Math.min(25 + (elapsedMs / POSE_GENERATION_POLL_TIMEOUT_MS) * 65, 90);
          if (isCurrentRun()) setProgress(runningProgress);
          taskQueue.markRunning(activeTaskId, {
            expectedCount: poseExpectedCount,
            inputThumbnails: taskInputThumbnails,
            resultThumbnails: latestTaskResultUrls,
            progress: runningProgress,
            status: state.status,
          });
        } else if (state.status === "completed") {
          const finalUrls = Array.isArray(state.result_urls) ? state.result_urls : latestTaskResultUrls;
          const finalResultCount = finalUrls.filter(Boolean).length;
          const expectedResultCount = Math.max(Number(state.expected_count) || poseExpectedCount, poseExpectedCount);
          if (isCurrentRun()) {
            setProgress(100);
            setResultUrls(finalUrls);
          }
          taskQueue.markCompleted(activeTaskId, {
            expectedCount: expectedResultCount,
            inputThumbnails: taskInputThumbnails,
            resultThumbnails: finalUrls,
            resultCount: finalResultCount,
          });
          if (isCurrentRun()) {
            if (finalResultCount < expectedResultCount) {
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
      const message = err instanceof Error ? err.message : "生成失败";
      if (err instanceof PoseGenerationPollTimeoutError) {
        taskQueue.markRunning(activeTaskId, {
          expectedCount: poseExpectedCount,
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
        expectedCount: poseExpectedCount,
        inputThumbnails: taskInputThumbnails,
        resultThumbnails: latestTaskResultUrls,
      });
      if (isCurrentRun()) {
        setError(message);
        toast.error(message);
        setIsSubmitting(false);
        setIsGenerating(false);
      }
    }
  }

  function handleRepairGenerate(repairValue: string) {
    const repairedPrompt = applyRepairPrompt(prompt, "pose", repairValue);
    setPrompt(repairedPrompt);
    toast.info("已加入修复指令，正在重新生成...");
    generate(repairedPrompt);
  }

  function handleRunningTask(item: TaskQueueItem) {
    generationRunRef.current += 1;
    const expectedCount = clampTaskExpectedCount(item, 1, 4);
    setRunningExpectedCount(expectedCount);
    setIsSubmitting(false);
    setIsGenerating(true);
    setProgress(Math.min(Math.max(Math.round(Number(item.progress) || 12), 1), 99));
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
    setGarmentDetailEnabled(false);
    setGarmentDetailUrls([]);
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
    setPrompt(DEFAULT_POSE_PROMPT);
    setSupplementPrompt("");
    setOutputMode("separate");
    setPoseStyle(DEFAULT_POSE_SERIES_STYLE);
    setCustomPosePrompt(USER_CUSTOM_POSE_DEFAULT.prompt);
    setCustomCamera(USER_CUSTOM_POSE_DEFAULT.camera);
    setCustomPoses([...USER_CUSTOM_POSE_DEFAULT.poses]);
    setRunningExpectedCount(null);
    setIsSubmitting(false);
    setIsGenerating(false);
    setProgress(0);
    setResultUrls([]);
    setError("");
    setLightboxSrc(null);
    setShowPoseRules(false);
    setRulesPopoverStyle(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (garmentDetailInputRef.current) garmentDetailInputRef.current.value = "";
  }

  const activePoseAnalysis = getActivePoseAnalysis();
  const activePoseAnalysisError = getActivePoseAnalysisError();
  const activePosePlan = getActivePosePlan();
  const poseAnalysisSummary = getPoseVisualAnalysisSummary(activePoseAnalysis);
  const poseAnalysisDetails = getPoseVisualAnalysisDetailItems(activePoseAnalysis);
  const poseAnalysisStatus = isAnalyzingPose
    ? { tone: "loading" as const, text: "识别主图中" }
    : activePoseAnalysis
      ? {
          tone: activePoseAnalysisError || poseAnalysisSource === "fallback" || activePoseAnalysis.confidence < 0.45
            ? "warning" as const
            : "success" as const,
          text: `${POSE_ANALYSIS_SOURCE_LABELS[poseAnalysisSource || "vision"]}：${poseAnalysisSummary || "主图已识别"}`,
        }
      : activePoseAnalysisError
        ? { tone: "warning" as const, text: activePoseAnalysisError }
        : null;
  const posePlanSummaries = getPosePlanSummary(activePosePlan);
  const posePlanStatus = isPlanningPose
    ? { tone: "loading" as const, text: "规划姿势中" }
    : activePosePlan
      ? {
          tone: posePlanError || posePlanSource === "fallback" ? "warning" as const : "success" as const,
          text: `${activePosePlan.edited ? "已编辑" : POSE_PLAN_SOURCE_LABELS[posePlanSource || "vision_plan"]}：${activePosePlan.slots.length} 个姿势`,
        }
      : posePlanError
        ? { tone: "warning" as const, text: posePlanError }
        : null;

  return (
    <div className="studio-workbench min-h-[calc(100dvh-64px)] lg:h-[calc(100vh-64px)] flex flex-col lg:flex-row">
      <FeatureTabs active="pose" />
      <ModuleTaskRail module="pose" moduleLabel="姿势裂变" onContinue={handleContinueCreate} onRunningTask={handleRunningTask} onCompletedTask={handleCompletedTask} />
      <div className="studio-parameters w-full lg:w-[472px] border-b lg:border-b-0 lg:border-r flex flex-col overflow-visible lg:overflow-hidden">
        <div className="studio-parameters-scroll flex-1 overflow-visible lg:overflow-y-auto p-3 sm:p-5 space-y-4 sm:space-y-6">
          <ModuleHeader
            title="姿势裂变"
            tooltip="基于图1人物、服装、场景和光线，生成同一套视觉里的四宫格姿势变化，适合主图延展、搭配展示和社媒排版。"
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
                图片规则 <ChevronRight className="h-3 w-3" />
              </button>
            )}
          />
          <section
            {...mainImageDrag.dragHandlers}
            className={`studio-stable-upload-boundary relative rounded-xl transition-all ${isDragging ? "ring-2 ring-[rgba(91,124,255,0.38)] ring-offset-2" : ""}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
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
              <div
                className={`mt-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
                  poseAnalysisStatus.tone === "loading"
                    ? "border-violet-100 bg-violet-50/70 text-violet-600"
                    : poseAnalysisStatus.tone === "success"
                      ? "border-emerald-100 bg-emerald-50/80 text-emerald-700"
                      : "border-amber-100 bg-amber-50/80 text-amber-700"
                }`}
              >
                <div className="flex items-center gap-2">
                  {poseAnalysisStatus.tone === "loading" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : poseAnalysisStatus.tone === "success" ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  <span className="min-w-0 truncate" title={poseAnalysisStatus.text}>{poseAnalysisStatus.text}</span>
                  {poseAnalysisStatus.tone === "warning" && mainImage && (
                    <button
                      type="button"
                      onClick={retryPoseAnalysis}
                      className="ml-auto shrink-0 rounded-md bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-amber-700 transition-colors hover:bg-white"
                    >
                      重试
                    </button>
                  )}
                </div>
                {!isAnalyzingPose && activePoseAnalysis && poseAnalysisDetails.length > 0 && (
                  <div className="mt-1.5 grid grid-cols-1 gap-1.5 pl-5 sm:grid-cols-2">
                    {poseAnalysisDetails.map((item) => (
                      <span
                        key={item.label}
                        className={`min-w-0 truncate rounded-md bg-white/70 px-2 py-1 text-[10px] font-medium leading-4 ${
                          poseAnalysisStatus.tone === "warning" ? "text-amber-800" : "text-emerald-800"
                        }`}
                        title={item.title || `${item.label}：${item.value}`}
                      >
                        <span className="font-bold">{item.label}：</span>{item.value}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="font-bold text-sm">服装细节</h3>
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
                              onClick={() => setLightboxSrc(url)}
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
                            {isUploadingGarmentDetails ? <Loader2 className="mb-1 h-5 w-5 animate-spin" /> : <Sparkles className="mb-1 h-5 w-5" />}
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

          <section>
            <h3 className="font-bold text-sm mb-3">输出方式</h3>
            <StudioOptionGrid
              options={[
                { value: "separate" as const, label: "单张", description: "每个姿势独立出图" },
                { value: "grid" as const, label: "四宫格", description: "1 张 2x2 pose sheet" },
              ]}
              value={outputMode}
              onChange={setOutputMode}
              columns={2}
              ariaLabel="输出方式"
            />
          </section>

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

          <section>
            <h3 className="font-bold text-sm mb-3">拍摄风格</h3>
            <StudioOptionGrid
              options={POSE_SERIES_STYLES.map((style) => ({
                value: style.value,
                label: style.label,
                description: style.desc,
              }))}
              value={poseStyle}
              onChange={selectPoseStyle}
              columns={2}
              ariaLabel="拍摄风格"
            />
            <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
              预设只给风格方向，AI 会自由设计四个姿势；人物身份、服装结构和身体比例仍然优先。
            </p>

            {/* 用户自定义姿势编辑器 */}
            {poseStyle === "user_custom" && (
              <div className="mt-4 space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-amber-700">
                  <PenLine className="h-4 w-4" />
                  自定义姿势描述
                </div>
                <p className="text-[11px] text-amber-600">
                  编辑下方内容自定义四个姿势；镜头、画幅和构图是可选项，不填则由 AI 自然决定。
                </p>

                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">整体描述</label>
                  <StudioPromptTextarea
                    value={customPosePrompt}
                    onChange={(e) => setCustomPosePrompt(e.target.value)}
                    rows={4}
                    className="custom-scroll studio-prompt-textarea-compact"
                    placeholder="描述四宫格的整体拍摄方向..."
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">镜头/画幅补充（可选）</label>
                  <StudioPromptTextarea
                    value={customCamera}
                    onChange={(e) => setCustomCamera(e.target.value)}
                    rows={3}
                    className="custom-scroll"
                    placeholder="可为空；需要时可写统一镜头，或指定某个姿势的镜头距离、焦段、景别、画幅和构图。"
                  />
                </div>

                {customPoses.map((pose, i) => (
                  <div key={i}>
                    <label className="mb-1 block text-xs font-bold text-slate-600">姿势 {i + 1}</label>
                    <StudioPromptTextarea
                      value={pose}
                      onChange={(e) => {
                        const next = [...customPoses];
                        next[i] = e.target.value;
                        setCustomPoses(next);
                      }}
                      rows={3}
                      className="custom-scroll"
                    />
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => {
                    setCustomPosePrompt(USER_CUSTOM_POSE_DEFAULT.prompt);
                    setCustomCamera(USER_CUSTOM_POSE_DEFAULT.camera);
                    setCustomPoses([...USER_CUSTOM_POSE_DEFAULT.poses]);
                  }}
                  className="text-[11px] font-medium text-amber-600 hover:text-amber-800"
                >
                  恢复默认值
                </button>
              </div>
            )}
          </section>

          {mainImage && (
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="font-bold text-sm flex items-center gap-2">
                  <PenLine className="w-4 h-4 text-[var(--codex-accent)]" /> 姿势计划
                </h3>
                <div className="flex shrink-0 items-center gap-2">
                  {poseStyle !== "user_custom" && posePlanMode === "ai" && (
                    <button
                      type="button"
                      onClick={retryPosePlan}
                      disabled={isPlanningPose || !mainImage}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500 transition-colors hover:border-violet-200 hover:text-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      重新 AI 规划
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowPosePlanEditor((value) => !value)}
                    disabled={!activePosePlan}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:border-violet-200 hover:text-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {showPosePlanEditor ? "收起编辑" : "高级编辑"}
                  </button>
                </div>
              </div>

              {poseStyle !== "user_custom" && (
                <div className="mb-3">
                  <StudioOptionGrid
                    options={[
                      { value: "preset" as const, label: "预设计划", description: "默认 · 立即生成" },
                      { value: "ai" as const, label: "AI 精修", description: "更贴主图 · 较慢" },
                    ]}
                    value={posePlanMode}
                    onChange={setPosePlanMode}
                    columns={2}
                    ariaLabel="姿势计划模式"
                  />
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                    默认走本地预设计划，不等待 AI 规划；需要更贴合主图气质时再开启 AI 精修。
                  </p>
                </div>
              )}

              {posePlanStatus && (
                <div
                  className={`mb-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
                    posePlanStatus.tone === "loading"
                      ? "border-violet-100 bg-violet-50/70 text-violet-600"
                      : posePlanStatus.tone === "success"
                        ? "border-emerald-100 bg-emerald-50/80 text-emerald-700"
                        : "border-amber-100 bg-amber-50/80 text-amber-700"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {posePlanStatus.tone === "loading" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : posePlanStatus.tone === "success" ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5" />
                    )}
                    <span className="min-w-0 truncate" title={posePlanStatus.text}>{posePlanStatus.text}</span>
                  </div>
                  {posePlanError && posePlanStatus.tone !== "loading" && (
                    <p className="mt-1 pl-5 text-[10px] leading-relaxed font-medium opacity-80">
                      {posePlanError}
                    </p>
                  )}
                </div>
              )}

              {activePosePlan && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {posePlanSummaries.map((item, index) => (
                    <div key={item.key} className="rounded-xl border border-slate-200 bg-white/80 p-2.5">
                      <p className="truncate text-[11px] font-bold text-slate-800" title={item.title}>{item.title}</p>
                      <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-slate-500" title={item.detail}>{item.detail || "姿势规划已就绪"}</p>
                      {showPosePlanEditor && (
                        <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
                          <StudioPromptTextarea
                            value={activePosePlan.slots[index]?.bodyAction || ""}
                            onChange={(event) => updatePosePlanSlot(index, "bodyAction", event.target.value)}
                            rows={2}
                            className="custom-scroll"
                            placeholder="身体动作"
                          />
                          <StudioPromptTextarea
                            value={activePosePlan.slots[index]?.handAction || ""}
                            onChange={(event) => updatePosePlanSlot(index, "handAction", event.target.value)}
                            rows={2}
                            className="custom-scroll"
                            placeholder="手部动作"
                          />
                          <StudioPromptTextarea
                            value={activePosePlan.slots[index]?.headDirection || ""}
                            onChange={(event) => updatePosePlanSlot(index, "headDirection", event.target.value)}
                            rows={2}
                            className="custom-scroll"
                            placeholder="头部/视线"
                          />
                          <StudioPromptTextarea
                            value={activePosePlan.slots[index]?.cameraFraming || ""}
                            onChange={(event) => updatePosePlanSlot(index, "cameraFraming", event.target.value)}
                            rows={2}
                            className="custom-scroll"
                            placeholder="镜头构图"
                          />
                          <StudioPromptTextarea
                            value={activePosePlan.slots[index]?.garmentVisibilityRule || ""}
                            onChange={(event) => updatePosePlanSlot(index, "garmentVisibilityRule", event.target.value)}
                            rows={2}
                            className="custom-scroll"
                            placeholder="服装展示重点"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <StudioPromptTextarea
            title="补充要求"
            badge="可选"
            value={supplementPrompt}
            onChange={(event) => setSupplementPrompt(event.target.value)}
            rows={4}
            placeholder="可选：例如希望动作更自然、镜头更干净、服装褶皱保持一致、四张图构图更统一..."
            description="补充说明会附加到系统提示词中，影响最终生成效果。"
          />
        </div>

        <StudioRunBar
          summary={`${outputMode === "separate" ? "每姿势一张 · 4 张结果" : "四宫格 · 单张结果"}${activeGarmentDetailUrls.length ? ` · ${activeGarmentDetailUrls.length} 张服装细节` : ""}`}
          costLabel={authIsAnonymous ? "登录后查看灵点" : `消耗 ${cost} · 余额 ${credits ?? "-"}`}
          disabled={isSubmitting || Boolean(runDisabledReason)}
          disabledReason={runDisabledReason}
          primaryLabel={authIsAnonymous ? "登录后生成" : isUploading ? "上传中..." : isSubmitting ? "提交中..." : isGenerating ? "继续生成" : outputMode === "separate" ? "生成 4 张独立图" : "生成四宫格"}
          isLoading={isSubmitting}
          onPrimaryAction={() => generate()}
        />
      </div>

      <div className="studio-canvas min-h-[260px] sm:min-h-[360px] lg:min-h-0 flex-1 relative overflow-hidden mt-3 mb-6 lg:mt-0 lg:mb-0">
        {!isGenerating && resultUrls.length === 0 && !error && (
          <div className="studio-empty-stage min-h-[260px] sm:min-h-[360px] lg:h-full flex items-center justify-center px-4">
            <PreviewGuide
              title="开始姿势裂变"
              subtitle="用一张主图生成同人物、同服装、同风格的多姿势图片，可输出四宫格或四张独立图。"
              imageSrc="https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/pose-grid-black-outfit.png"
              imageAlt="姿势裂变指引"
              steps={[
                { title: "上传主图", desc: "人物身份、服装、背景和镜头关系都会作为硬参考保留。" },
                { title: "选择姿势风格", desc: "可切换自然站姿、走动感、商拍动作等裂变方向。" },
                { title: "选择输出方式", desc: "可输出 2x2 四宫格，也可每个姿势单独生成一张图。" },
              ]}
            />
          </div>
        )}

        {(isGenerating || resultUrls.length > 0) && (
          <div className="studio-result-stage min-h-[260px] sm:min-h-[360px] overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:h-full flex flex-col animate-fade-in">
            {isGenerating && (
              <div className="mb-4 rounded-xl border border-purple-100 bg-white/80 px-3 py-2 text-xs font-medium text-purple-600 shadow-sm">
                已生成 {resultUrls.length}{` / ${runningExpectedCount || poseExpectedCount}`}，剩余图片生成中...
              </div>
            )}
            <div className="flex min-h-0 flex-1 items-start justify-start">
              <ResultImageGrid
                urls={resultUrls}
                filenamePrefix="pose"
                extension="jpg"
                onOpen={(_, index) => setPreviewIndex(index)}
                expectedCount={isGenerating ? runningExpectedCount || poseExpectedCount : undefined}
                isGenerating={isGenerating}
                inputThumbnails={mainImage ? [mainImage, ...activeGarmentDetailUrls] : []}
                statusGroup={isGenerating ? "running" : undefined}
                variant="task"
              />
            </div>
            <div className="mt-4 flex justify-center">
              <RepairPromptPanel
                kind="pose"
                onRepair={handleRepairGenerate}
                disabled={isGenerating}
                className="w-full max-w-3xl"
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
            error={error}
            onRetry={() => setError("")}
            onRepair={handleRepairGenerate}
            isGenerating={isGenerating}
            repairKind="pose"
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
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-500">{POSE_UPLOAD_RULE.shortTitle}</p>
                <h3 className="mt-1 text-base font-bold text-slate-950">{POSE_UPLOAD_RULE.title}</h3>
                <p className="mt-1 text-xs text-slate-500">{POSE_UPLOAD_RULE.uploadSpecText}</p>
              </div>
              <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-600">Hover 预览</span>
            </div>

            <div className="studio-scrollbar-hide overflow-y-auto px-5 py-4" style={{ maxHeight: rulesPopoverStyle.maxHeight - 88 }}>
              <div className="grid gap-3 md:grid-cols-5">
                {POSE_UPLOAD_RULE.demos.map((demo) => (
                  <div key={demo.imageUrl} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-2">
                    <div className="relative overflow-hidden rounded-xl bg-white">
                      <img src={demo.imageUrl} alt={demo.title} className="aspect-[3/4] w-full object-cover" />
                      <CheckCircle2 className="absolute right-2 top-2 h-5 w-5 rounded-full bg-white text-emerald-500" />
                    </div>
                    <p className="mt-2 truncate text-center text-xs font-medium text-slate-700">{demo.title}</p>
                    <button
                      type="button"
                      onClick={() => applyRuleDemo(demo)}
                      className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-violet-200 hover:text-violet-600"
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

      {lightboxSrc && (
        <ClientPortal>
          <div className="fixed inset-0 z-[180] flex cursor-zoom-out items-center justify-center bg-slate-950/66 p-4 backdrop-blur-xl sm:p-8"
            onClick={() => setLightboxSrc(null)}>
            <img src={lightboxSrc} className="max-h-full max-w-full rounded-2xl object-contain shadow-[0_32px_120px_rgba(0,0,0,0.45)]" />
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
