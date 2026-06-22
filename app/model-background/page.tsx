"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  CheckCircle2,
  ChevronRight,
  Images,
  Sparkles,
  UserRound,
  X,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { ClientPortal } from "@/components/ClientPortal";
import { FeatureTabs } from "@/components/FeatureTabs";
import { ModuleHeader } from "@/components/ModuleHeader";
import { PreviewGuide } from "@/components/PreviewGuide";
import { ErrorStage } from "@/components/studio/ErrorStage";
import { ModuleTaskRail } from "@/components/studio/ModuleTaskRail";
import { useStudioAuth } from "@/components/studio/useStudioAuth";
import type { TaskSelectionSession } from "@/components/studio/useTaskSelectionSession";
import { StudioGenerationCountSelector, StudioModelSelector, StudioOptionGrid, StudioPromptTextarea } from "@/components/studio/StudioFormControls";
import { StudioRunBar } from "@/components/studio/StudioRunBar";
import { StudioMultiImageUpload } from "@/components/studio/StudioMultiImageUpload";
import { StudioUploadSection } from "@/components/studio/StudioUploadSection";
import { RawPreviewImage } from "@/components/studio/RawPreviewImage";
import { useTaskQueueGeneration } from "@/components/studio/useTaskQueueGeneration";
import { ResultImageGrid } from "@/components/ResultImageGrid";
import { StudioImagePreviewDialog } from "@/components/studio/StudioImagePreviewDialog";
import { setCachedProfileCredits } from "@/lib/supabase/client";
import { MAX_FILE_SIZE, MAX_FILE_SIZE_MB, uploadImage } from "@/lib/utils";
import { getCreditCost, getSupportedImageSizes, type AspectRatio, type ImageSize, type LingyaModel } from "@/lib/api/lingya";
import { fetchHistoryApplyDetail, getHistoryApplyFailureMessage, isHistoryApplyRowFailed, takeApplyDetail, type HistoryJobPayload } from "@/lib/history-apply";
import { clampTaskExpectedCount, safeTaskQueueUrls, type TaskQueueItem } from "@/lib/task-queue";
import { showInsufficientCreditsToast } from "@/lib/ui/credit-copy";
import { createGenericImagePreviewSession, takeSourceImageFromLocation, type ImagePreviewAction } from "@/lib/studio-image-preview";
import { FAILED_RETRY_NOTICE, buildPartialFailureDetail, summarizeGenerationError } from "@/lib/studio-generation-feedback";
import {
  buildRetryPendingResultUrls,
  getRetryDisplayExpectedCount,
  mergeRetryResultUrls,
  normalizeRetryResultIndex,
} from "@/lib/result-slot-retry";
import {
  BACKGROUND_PRESETS,
  BACKGROUND_SOURCE_LABELS,
  BACKGROUND_TEXT_PRESETS,
  DEFAULT_BACKGROUND_TEXT,
  MAX_MODEL_BACKGROUND_SOURCE_IMAGES,
  MODEL_BACKGROUND_MODE_LABELS,
  MODEL_BACKGROUND_USER_PROMPT_PLACEHOLDER,
  MODEL_BACKGROUND_UPLOAD_RULE,
  PRESET_BACKGROUND_MODELS,
  buildModelBackgroundPrompt,
  getBackgroundPreset,
  normalizeBackgroundPreset,
  normalizeBackgroundSourceMode,
  normalizeModelBackgroundMode,
  normalizeModelBackgroundSourceUrls,
  type BackgroundPresetId,
  type BackgroundSourceMode,
  type ModelBackgroundMode,
} from "@/lib/model-background";

const MODELS: { value: LingyaModel; label: string; desc: string; badge?: string; icon: string }[] = [
  { value: "nano-banana-2", label: "Nano-Banana-2", desc: "最高4K", badge: "推荐", icon: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/model-icons/gemini.png" },
  { value: "gpt-image-2", label: "GPT-Image-2", desc: "最高4K", badge: "最新", icon: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/model-icons/openai.svg" },
  { value: "nano-banana-pro", label: "Nano-Banana-Pro", desc: "最高4K", badge: "推荐", icon: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/model-icons/gemini.png" },
];

type ModelBackgroundHistoryPayload = Extract<HistoryJobPayload, { kind: "modelBackground" }>;
type ModelBackgroundGenerateOptions = {
  sourceUrlsOverride?: string[];
  genCountOverride?: number;
  expectedCountOverride?: number;
  retryResultIndex?: number;
  toastMessage?: string;
};

const ASPECTS: { value: AspectRatio; label: string }[] = [
  { value: "auto", label: "智能" },
  { value: "3:4", label: "3:4 竖版" },
  { value: "4:5", label: "4:5 种草" },
  { value: "1:1", label: "1:1 方图" },
  { value: "9:16", label: "9:16 手机" },
  { value: "4:3", label: "4:3 横图" },
];

const MODE_OPTIONS: { value: ModelBackgroundMode; desc: string }[] = [
  { value: "background_only", desc: "默认" },
  { value: "model_background", desc: "换人+景" },
  { value: "model_only", desc: "只换脸" },
];

const BACKGROUND_SOURCE_OPTIONS: BackgroundSourceMode[] = ["preset", "upload", "text"];
const CARD_ZOOM_BUTTON_CLASS =
  "absolute right-1 top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white/85 text-slate-600 opacity-0 shadow-sm transition-opacity hover:bg-white hover:text-zinc-900 focus-visible:opacity-100 group-hover:opacity-100";

const MODEL_BACKGROUND_PREVIEW_ACTIONS: ImagePreviewAction[] = [
  { kind: "download", label: "下载图片" },
  { kind: "copy", label: "复制链接" },
  { kind: "repair", label: "AI修图" },
  { kind: "aiVideo", label: "AI视频" },
  { kind: "pose", label: "姿势裂变" },
  { kind: "productSet", label: "商品套图" },
  { kind: "regenerateAll", label: "重新创作" },
  { kind: "feedback", label: "反馈" },
];

type UploadTarget = "source" | "model" | "background";

export default function ModelBackgroundPage() {
  const router = useRouter();
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const rulesButtonRef = useRef<HTMLButtonElement>(null);
  const rulesHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    authChecked,
    isAuthenticated,
    userId,
    credits,
    setCredits,
    refreshCredits,
    refreshAuth,
  } = useStudioAuth();
  const [sourceUrls, setSourceUrls] = useState<string[]>([]);
  const [mode, setMode] = useState<ModelBackgroundMode>("background_only");
  const [modelReferenceUrl, setModelReferenceUrl] = useState("");
  const [modelReferenceName, setModelReferenceName] = useState("");
  const [backgroundSource, setBackgroundSource] = useState<BackgroundSourceMode>("preset");
  const [backgroundPresetId, setBackgroundPresetId] = useState<BackgroundPresetId>("cafe-courtyard");
  const [backgroundReferenceUrl, setBackgroundReferenceUrl] = useState(BACKGROUND_PRESETS[0].imageUrl);
  const [backgroundText, setBackgroundText] = useState(DEFAULT_BACKGROUND_TEXT);
  const [userPrompt, setUserPrompt] = useState("");
  const [aiModel, setAiModel] = useState<LingyaModel>("nano-banana-2");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("auto");
  const [imageSize, setImageSize] = useState<ImageSize>("1K");
  const [genCount, setGenCount] = useState(1);
  const [promptOverride, setPromptOverride] = useState<string | null>(null);
  const [isSourceDragging, setIsSourceDragging] = useState(false);
  const [uploadingTarget, setUploadingTarget] = useState<UploadTarget | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultUrls, setResultUrls] = useState<string[]>([]);
  const [runningExpectedCount, setRunningExpectedCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [showRules, setShowRules] = useState(false);
  const [rulesPopoverStyle, setRulesPopoverStyle] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const hasModelReference = mode !== "background_only" && Boolean(modelReferenceUrl);
  const hasBackgroundReference = mode !== "model_only" && (backgroundSource === "preset" || backgroundSource === "upload") && Boolean(backgroundReferenceUrl);
  const selectedBackgroundPreset = useMemo(() => getBackgroundPreset(backgroundPresetId), [backgroundPresetId]);
  const primarySourceUrl = sourceUrls[0] || "";
  const promptImages = useMemo(() => [
    ...(primarySourceUrl ? [{ imageNumber: 1, url: primarySourceUrl, role: "原始人物/服装/穿搭硬参考" }] : []),
    ...(hasModelReference ? [{ imageNumber: 2, url: modelReferenceUrl, role: mode === "model_only" ? "脸部参考图 / 只替换主图脸部" : "必选模特参考图 / 人物气质身份参考" }] : []),
    ...(hasBackgroundReference ? [{ imageNumber: mode === "model_background" ? 3 : 2, url: backgroundReferenceUrl, role: "背景参考图 / 场景光线构图参考" }] : []),
  ], [primarySourceUrl, hasModelReference, modelReferenceUrl, mode, hasBackgroundReference, backgroundReferenceUrl]);
  const finalPrompt = useMemo(() => promptOverride ?? buildModelBackgroundPrompt({
    mode,
    backgroundSource,
    templateId: backgroundPresetId,
    backgroundText,
    userPrompt,
    hasModelReference,
    hasBackgroundReference,
  }), [promptOverride, mode, backgroundSource, backgroundPresetId, backgroundText, userPrompt, hasModelReference, hasBackgroundReference]);
  const requestedResultCount = genCount * Math.max(sourceUrls.length, 1);
  const activeResultExpectedCount = isGenerating
    ? runningExpectedCount || requestedResultCount
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
  const retryDisabled = isGenerating;
  function handleRetryFailedResult(index: number) {
    if (retryDisabled) return;
    const perSourceCount = Math.max(1, Math.min(Math.max(Math.round(Number(genCount) || 1), 1), 4));
    const sourceIndex = Math.min(Math.max(0, Math.floor(index / perSourceCount)), Math.max(sourceUrls.length - 1, 0));
    const retrySourceUrl = sourceUrls[sourceIndex] || sourceUrls[0];
    if (!retrySourceUrl) {
      toast.error("未找到要重试的原图");
      return;
    }
    void generate(undefined, {
      sourceUrlsOverride: [retrySourceUrl],
      genCountOverride: 1,
      expectedCountOverride: 1,
      retryResultIndex: index,
      toastMessage: `正在补位重试第 ${index + 1} 张，失败图已退款，完成后会回填到当前结果中...`,
    });
  }
  const previewSession = useMemo(
    () => createGenericImagePreviewSession({
      module: "modelBackground",
      title: "模特换背景",
      urls: resultUrls,
      expectedCount: activeResultExpectedCount,
      isGenerating,
      statusGroup: isGenerating ? "running" : undefined,
      references: promptImages.map((item) => ({
        url: item.url,
        label: item.imageNumber === 1 ? "原图" : item.imageNumber === 2 && hasModelReference ? "模特参考" : "背景参考",
        role: item.imageNumber === 1 ? "source" : item.imageNumber === 2 && hasModelReference ? "model" : "background",
      })),
      promptText: [
        mode !== "model_only" && backgroundSource === "text" && backgroundText.trim() !== DEFAULT_BACKGROUND_TEXT
          ? `背景描述：${backgroundText}`
          : "",
        userPrompt,
      ].map((item) => item.trim()).filter(Boolean).join("\n\n"),
      metaItems: [
        { label: "模式", value: MODEL_BACKGROUND_MODE_LABELS[mode] },
        { label: "背景来源", value: mode === "model_only" ? null : BACKGROUND_SOURCE_LABELS[backgroundSource] },
        { label: "背景模板", value: backgroundSource === "preset" && mode !== "model_only" ? selectedBackgroundPreset.name : null },
        { label: "模型", value: aiModel },
        { label: "比例", value: aspectRatio },
        { label: "分辨率", value: imageSize },
        { label: "生成数量", value: genCount },
      ],
      resultTitlePrefix: "换背景结果",
      aspectRatio,
    }),
    [activeResultExpectedCount, aiModel, aspectRatio, backgroundSource, backgroundText, genCount, hasModelReference, imageSize, isGenerating, mode, promptImages, resultUrls, selectedBackgroundPreset.name, userPrompt]
  );
  const imageSizes = getSupportedImageSizes(aiModel, aspectRatio);
  const unitCost = getCreditCost(aiModel, imageSize, aspectRatio);
  const cost = unitCost * requestedResultCount;
  const taskQueue = useTaskQueueGeneration({
    module: "modelBackground",
    title: "换背景",
    defaultExpectedCount: requestedResultCount,
    applyPath: "/model-background",
  });
  const authIsAnonymous = authChecked && !isAuthenticated;
  const runDisabledReason = sourceUrls.length === 0
    ? "请先上传原图"
    : mode !== "background_only" && !modelReferenceUrl
      ? "请选择或上传模特参考图"
      : mode !== "model_only" && (backgroundSource === "preset" || backgroundSource === "upload") && !backgroundReferenceUrl
        ? "请选择或上传背景参考图"
        : credits !== null && credits < cost
          ? `灵点不足，生成需要 ${cost} 灵点`
          : undefined;
  useEffect(() => {
    const sourceImage = takeSourceImageFromLocation();
    if (sourceImage) {
      setSourceUrls([sourceImage]);
      toast.success("已带入预览图片");
    }
  }, []);

  useEffect(() => {
    const nextSizes = getSupportedImageSizes(aiModel, aspectRatio);
    if (!nextSizes.includes(imageSize)) setImageSize(nextSizes[0]);
  }, [aiModel, aspectRatio, imageSize]);

  function applyModelBackgroundHistoryPayload(payload: ModelBackgroundHistoryPayload, historyResultUrls: string[] = [], options?: { silent?: boolean }) {
    const nextSource = normalizeBackgroundSourceMode(payload.backgroundSource);
    const nextPreset = normalizeBackgroundPreset(payload.templateId);
    setSourceUrls(normalizeModelBackgroundSourceUrls(payload.sourceUrls, payload.sourceUrl));
    setModelReferenceUrl(payload.modelReferenceUrl || "");
    setModelReferenceName(payload.modelReferenceUrl ? "历史模特" : "");
    setBackgroundReferenceUrl(payload.backgroundReferenceUrl || getBackgroundPreset(nextPreset).imageUrl);
    setMode(normalizeModelBackgroundMode(payload.mode));
    setBackgroundSource(nextSource === "auto" ? "preset" : nextSource);
    setBackgroundPresetId(nextPreset);
    setBackgroundText(payload.backgroundText || DEFAULT_BACKGROUND_TEXT);
    setUserPrompt(payload.userPrompt || "");
    setAiModel(payload.aiModel);
    setAspectRatio(payload.aspectRatio);
    setImageSize(payload.imageSize);
    setGenCount(payload.genCount);
    setPromptOverride(payload.prompt);
    setRunningExpectedCount(null);
    setResultUrls(historyResultUrls);
    setIsGenerating(false);
    setProgress(historyResultUrls.length ? 100 : 0);
    setError("");
    if (!options?.silent) toast.success("已套用历史参数");
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
    const detail = await takeApplyDetail("modelBackground");
    const payload = detail?.payload;
    if (cancelled || !payload) return;
    const nextSource = normalizeBackgroundSourceMode(payload.backgroundSource);
    const nextPreset = normalizeBackgroundPreset(payload.templateId);
    setSourceUrls(normalizeModelBackgroundSourceUrls(payload.sourceUrls, payload.sourceUrl));
    setModelReferenceUrl(payload.modelReferenceUrl || "");
    setModelReferenceName(payload.modelReferenceUrl ? "历史模特" : "");
    setBackgroundReferenceUrl(payload.backgroundReferenceUrl || getBackgroundPreset(nextPreset).imageUrl);
    setMode(normalizeModelBackgroundMode(payload.mode));
    setBackgroundSource(nextSource === "auto" ? "preset" : nextSource);
    setBackgroundPresetId(nextPreset);
    setBackgroundText(payload.backgroundText || DEFAULT_BACKGROUND_TEXT);
    setUserPrompt(payload.userPrompt || "");
    setAiModel(payload.aiModel);
    setAspectRatio(payload.aspectRatio);
    setImageSize(payload.imageSize);
    setGenCount(payload.genCount);
    setPromptOverride(payload.prompt);
    setRunningExpectedCount(null);
    setResultUrls(detail?.resultUrls || []);
    setIsGenerating(false);
    setProgress(detail?.resultUrls.length ? 100 : 0);
    setError(isHistoryApplyRowFailed(detail.row) ? getHistoryApplyFailureMessage(detail.row) : "");
    toast.success("已套用历史参数");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    if (rulesHideTimerRef.current) clearTimeout(rulesHideTimerRef.current);
  }, []);

  const cancelRulesHide = () => {
    if (rulesHideTimerRef.current) clearTimeout(rulesHideTimerRef.current);
  };

  const openRulesPopover = () => {
    cancelRulesHide();
    const rect = rulesButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(760, window.innerWidth - 32);
    const top = Math.max(16, Math.min(rect.top - 10, window.innerHeight - 360));
    const left = Math.max(16, Math.min(rect.right + 12, window.innerWidth - width - 16));
    setRulesPopoverStyle({ top, left, maxHeight: Math.max(320, window.innerHeight - top - 16) });
    setShowRules(true);
  };

  const scheduleRulesHide = () => {
    cancelRulesHide();
    rulesHideTimerRef.current = setTimeout(() => {
      setShowRules(false);
      setRulesPopoverStyle(null);
    }, 120);
  };

  async function handleUpload(files: File[], target: UploadTarget) {
    const validFiles = files.filter((file) => {
      if (!file.type.startsWith("image/")) {
        toast.error(`"${file.name}" 不是图片格式`);
        return false;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`"${file.name}" 超过 ${MAX_FILE_SIZE_MB}MB`);
        return false;
      }
      return true;
    });
    if (validFiles.length === 0) return;

    const label = target === "source" ? "原图" : target === "model" ? "模特参考图" : "背景参考图";
    if (target === "source" && sourceUrls.length >= MAX_MODEL_BACKGROUND_SOURCE_IMAGES) {
      toast.error(`原图最多 ${MAX_MODEL_BACKGROUND_SOURCE_IMAGES} 张`);
      return;
    }
    toast.info(`正在上传${label}...`);
    setUploadingTarget(target);
    try {
      const remaining = Math.max(MAX_MODEL_BACKGROUND_SOURCE_IMAGES - sourceUrls.length, 0);
      const uploadFiles = target === "source" ? validFiles.slice(0, remaining) : validFiles.slice(0, 1);
      const uploads = await Promise.all(uploadFiles.map((file) => uploadImage(file)));
      if (target === "source") {
        setSourceUrls((prev) => {
          const merged = [...prev, ...uploads.map((item) => item.url)];
          return merged.slice(0, MAX_MODEL_BACKGROUND_SOURCE_IMAGES);
        });
        toast.success(`已上传 ${uploads.length} 张原图`);
      } else if (target === "model") {
        setModelReferenceUrl(uploads[0].url);
        setModelReferenceName("自定义");
        toast.success(`${label}已上传`);
      } else {
        setBackgroundReferenceUrl(uploads[0].url);
        setBackgroundSource("upload");
        toast.success(`${label}已上传`);
      }
      setPromptOverride(null);
    } catch {
      toast.error("上传失败，请重试");
    } finally {
      setUploadingTarget(null);
    }
  }

  function applyDemo(demo: { title: string; imageUrl: string }) {
    setSourceUrls([demo.imageUrl]);
    setPromptOverride(null);
    setShowRules(false);
    setRulesPopoverStyle(null);
    toast.success("已套用示例图");
  }

  async function generate(promptForRun?: string, options: ModelBackgroundGenerateOptions = {}) {
    if (!isAuthenticated && !(await refreshAuth())) {
      toast.error("请先登录");
      router.push("/login");
      return;
    }
    const runSourceUrls = options.sourceUrlsOverride?.length ? options.sourceUrlsOverride : sourceUrls;
    if (runSourceUrls.length === 0) return toast.error("请先上传原图");
    if (mode !== "background_only" && !modelReferenceUrl) return toast.error("请选择或上传模特参考图");
    if (mode !== "model_only" && (backgroundSource === "preset" || backgroundSource === "upload") && !backgroundReferenceUrl) return toast.error("请选择或上传背景参考图");
    const runGenCount = Math.min(Math.max(Math.round(Number(options.genCountOverride ?? genCount) || 1), 1), 4);
    const runExpectedCount = Math.max(1, Math.round(Number(options.expectedCountOverride ?? (runSourceUrls.length * runGenCount)) || runGenCount));
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

    setIsGenerating(true);
    setRunningExpectedCount(displayExpectedCount);
    setProgress(10);
    setResultUrls(buildRetryPendingResultUrls(retryPreviousResultUrls, retryResultIndex, displayExpectedCount));
    setError("");
    if (options.toastMessage) toast.info(options.toastMessage);
    const runTaskInputThumbnails = [
      ...runSourceUrls,
      ...(hasModelReference ? [modelReferenceUrl] : []),
      ...(hasBackgroundReference ? [backgroundReferenceUrl] : []),
    ].filter(Boolean);
    const provisionalTask = taskQueue.startTask({
      expectedCount: displayExpectedCount,
      inputThumbnails: runTaskInputThumbnails,
      progress: 10,
    });
    let activeTaskId = provisionalTask.id;
    let latestTaskResultUrls: string[] = [];

    try {
      const res = await fetch("/api/model-background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_url: runSourceUrls[0] || "",
          source_urls: runSourceUrls,
          model_reference_url: mode !== "background_only" ? modelReferenceUrl : null,
          background_reference_url: hasBackgroundReference ? backgroundReferenceUrl : null,
          mode,
          background_source: backgroundSource,
          template_id: backgroundPresetId,
          background_text: backgroundText,
          user_prompt: userPrompt,
          ai_model: aiModel,
          aspect_ratio: aspectRatio,
          image_size: imageSize,
          gen_count: runGenCount,
          prompt: typeof promptForRun === "string" ? promptForRun : finalPrompt,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          await refreshAuth();
          taskQueue.removeTask(activeTaskId);
          setIsGenerating(false);
          router.push("/login");
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
      setProgress(25);
      if (typeof data.generation_id === "string" && data.generation_id) {
        const serverTask = taskQueue.replaceWithServerTask(activeTaskId, {
          id: data.generation_id,
          expectedCount: displayExpectedCount,
          inputThumbnails: runTaskInputThumbnails,
          status: data.status || "processing_tryon",
          progress: 25,
        });
        activeTaskId = serverTask.id;
      }
      for (let attempts = 0; attempts < 120; attempts++) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await fetch(`/api/model-background?generation_id=${data.generation_id}`);
        if (!poll.ok) continue;
        const state = await poll.json();
        if (Array.isArray(state.result_urls) && state.result_urls.length) {
          latestTaskResultUrls = mergeRetryResultUrls(retryPreviousResultUrls, retryResultIndex, state.result_urls, displayExpectedCount);
          setResultUrls(latestTaskResultUrls);
        }
        if (state.status === "completed") {
          const finalUrls = mergeRetryResultUrls(
            retryPreviousResultUrls,
            retryResultIndex,
            Array.isArray(state.result_urls) ? state.result_urls : latestTaskResultUrls,
            displayExpectedCount
          );
          const finalResultCount = finalUrls.filter(Boolean).length;
          const partialFailure = state.partial_failure && typeof state.partial_failure === "object"
            ? state.partial_failure as { message?: unknown }
            : null;
          const completedError = state.error || partialFailure?.message || "";
          setProgress(100);
          setResultUrls(finalUrls);
          setIsGenerating(false);
          taskQueue.markCompleted(activeTaskId, {
            expectedCount: displayExpectedCount,
            inputThumbnails: runTaskInputThumbnails,
            resultThumbnails: finalUrls,
            resultCount: finalResultCount,
            error: completedError ? summarizeGenerationError(completedError) : "",
          });
          if (completedError || finalResultCount < displayExpectedCount) {
            void refreshCredits();
            toast.warning(`换背景部分完成：已生成 ${finalResultCount}/${displayExpectedCount} 张，失败图片灵点会自动退回`);
          } else {
            toast.success("换背景生成完成");
          }
          return;
        }
        if (state.status === "failed") throw new Error(state.error || "生成失败");
        const nextProgress = Number(state.progress);
        const runningProgress = Number.isFinite(nextProgress)
          ? Math.min(Math.max(Math.round(nextProgress), 0), 99)
          : Math.min(25 + attempts * 1.5, 90);
        setProgress(runningProgress);
        taskQueue.markRunning(activeTaskId, {
          expectedCount: displayExpectedCount,
          inputThumbnails: runTaskInputThumbnails,
          resultThumbnails: latestTaskResultUrls,
          progress: runningProgress,
          status: state.status,
        });
      }
      throw new Error("生成超时");
    } catch (err: unknown) {
      const message = summarizeGenerationError(err instanceof Error ? err.message : "生成失败");
      setError(message);
      taskQueue.markFailed(activeTaskId, message, {
        expectedCount: displayExpectedCount,
        inputThumbnails: runTaskInputThumbnails,
        resultThumbnails: latestTaskResultUrls,
      });
      toast.error(message);
      void refreshCredits();
      setIsGenerating(false);
    }
  }

  function handleRunningTask(item: TaskQueueItem) {
    setRunningExpectedCount(clampTaskExpectedCount(item, 1, MAX_MODEL_BACKGROUND_SOURCE_IMAGES * 4));
    setIsGenerating(true);
    setProgress(Math.min(Math.max(Math.round(Number(item.progress) || 12), 1), 99));
    setError("");
    setResultUrls(safeTaskQueueUrls(item.resultThumbnails));
  }

  async function handleCompletedTask(item: TaskQueueItem, session: TaskSelectionSession) {
    try {
      const detail = await fetchHistoryApplyDetail(item.id, "modelBackground", session.signal);
      if (!session.isCurrent()) return true;
      applyModelBackgroundHistoryPayload(detail.payload, detail.resultUrls.length ? detail.resultUrls : safeTaskQueueUrls(item.resultThumbnails), {
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
    setSourceUrls([]);
    setMode("background_only");
    setModelReferenceUrl("");
    setModelReferenceName("");
    setBackgroundSource("preset");
    setBackgroundPresetId("cafe-courtyard");
    setBackgroundReferenceUrl(BACKGROUND_PRESETS[0].imageUrl);
    setBackgroundText(DEFAULT_BACKGROUND_TEXT);
    setUserPrompt("");
    setAiModel("nano-banana-2");
    setAspectRatio("auto");
    setImageSize("1K");
    setGenCount(1);
    setPromptOverride(null);
    setIsGenerating(false);
    setRunningExpectedCount(null);
    setProgress(0);
    setResultUrls([]);
    setError("");
    setLightboxSrc(null);
    setShowRules(false);
    setRulesPopoverStyle(null);
    if (sourceInputRef.current) sourceInputRef.current.value = "";
    if (modelInputRef.current) modelInputRef.current.value = "";
    if (backgroundInputRef.current) backgroundInputRef.current.value = "";
  }

  return (
    <div className="studio-workbench min-h-[calc(100dvh-64px)] lg:h-[calc(100vh-64px)] flex flex-col lg:flex-row">
      <FeatureTabs active="modelBackground" />
      <ModuleTaskRail module="modelBackground" moduleLabel="换背景" onContinue={handleContinueCreate} onRunningTask={handleRunningTask} onCompletedTask={handleCompletedTask} />
      <div className="studio-parameters w-full lg:w-[472px] border-b lg:border-b-0 lg:border-r flex flex-col overflow-visible lg:overflow-hidden">
        <div className="studio-parameters-scroll flex-1 overflow-visible lg:overflow-y-auto p-3 sm:p-5 space-y-4 sm:space-y-5">
          <ModuleHeader
            title="换背景"
            tooltip="默认只替换原图背景，人物、服装和穿搭保持不变；切换到换模特时需要先选择或上传模特参考图。"
            actions={(
              <button
                ref={rulesButtonRef}
                type="button"
                onMouseEnter={openRulesPopover}
                onMouseLeave={scheduleRulesHide}
                onFocus={openRulesPopover}
                onBlur={scheduleRulesHide}
                aria-expanded={showRules}
                className="studio-upload-rule-button"
              >
                图片规则 <ChevronRight className="h-3 w-3" />
              </button>
            )}
          />

          <StudioUploadSection
            title="需要处理的原图"
            inputRef={sourceInputRef}
            multiple
            isDragging={isSourceDragging}
            setDragging={setIsSourceDragging}
            onFiles={(files) => handleUpload(files, "source")}
          >
            {(openFileDialog) => (
              <StudioMultiImageUpload
                urls={sourceUrls}
                maxCount={MAX_MODEL_BACKGROUND_SOURCE_IMAGES}
                title="已上传原图"
                emptyTitle="上传需要处理的原图"
                description="图1作为人物、服装、姿势、画幅和裁切基础，可继续补充多张原图批量换背景。"
                emptyDescription="图1作为人物、服装、姿势、画幅和裁切基础，建议主体完整、服装清晰。"
                itemLabelPrefix="图"
                loading={uploadingTarget === "source"}
                isDragging={isSourceDragging}
                uploadLabel="从本地上传"
                libraryLabel="从作品选择"
                summary={sourceUrls.length ? `共生成 ${sourceUrls.length * genCount} 张` : undefined}
                footnote={`支持同时上传多张原图（最多 ${MAX_MODEL_BACKGROUND_SOURCE_IMAGES} 张），每张原图 × 生成数量。只换背景时会锁定原图景别和裁切。`}
                tips={[
                  { label: "说明", text: "只换背景时锁定原图人物、服装、姿势和裁切。" },
                  { label: "图片要求", text: "主体清晰、边缘完整、服装和人物关系明确。" },
                ]}
                imageFit="cover"
                onUploadClick={openFileDialog}
                onLibraryClick={() => toast.info("作品库选择即将接入")}
                onPreview={(url) => setLightboxSrc(url)}
                onRemove={(_, index) => {
                  setSourceUrls((prev) => prev.filter((__, i) => i !== index));
                  setPromptOverride(null);
                }}
                onClear={() => {
                  setSourceUrls([]);
                  setPromptOverride(null);
                }}
                examples={{
                  label: "试一试",
                  images: MODEL_BACKGROUND_UPLOAD_RULE.demos.map((demo) => ({ url: demo.imageUrl, title: demo.title })),
                  disabled: uploadingTarget === "source",
                  onSelect: (image) => applyDemo({ title: image.title, imageUrl: image.url }),
                }}
              />
            )}
          </StudioUploadSection>

          <section>
            <h3 className="font-bold text-sm mb-3">操作模式</h3>
            <StudioOptionGrid
              options={MODE_OPTIONS.map((item) => ({
                value: item.value,
                label: MODEL_BACKGROUND_MODE_LABELS[item.value],
                description: item.desc,
              }))}
              value={mode}
              onChange={(value) => { setMode(value); setPromptOverride(null); }}
              columns={3}
              ariaLabel="操作模式"
            />
          </section>

          {mode !== "background_only" ? (
            <section>
              <h3 className="font-bold text-sm mb-1 flex items-center gap-2">
                <UserRound className="w-4 h-4 text-zinc-700" /> 模特参考 <span className="text-zinc-500 font-normal text-xs">· 必选</span>
                <span className="px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-700 text-[9px]">请选择</span>
              </h3>
              <p className="text-[11px] text-gray-400 mb-3">
                {mode === "model_only" ? "只换主图脸部，身体、服装、发型、姿势、背景都保持原图不变。" : "请选择系统模特或上传模特图，再替换模特与背景；图1服装和穿搭仍保持不变。"}
              </p>
              <input
                ref={modelInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label="上传模特参考图"
                onChange={(event) => {
                  const input = event.currentTarget;
                  void handleUpload(Array.from(input.files || []), "model").finally(() => {
                    input.value = "";
                  });
                }}
              />
              <div className="grid grid-cols-3 gap-2">
                {PRESET_BACKGROUND_MODELS.map((model) => (
                  <div
                    key={model.id}
                    className={`group relative overflow-hidden rounded-lg border-2 transition-[border-color,box-shadow] ${modelReferenceUrl === model.imageUrl ? "border-zinc-950 ring-1 ring-zinc-200" : "border-transparent hover:border-gray-300"}`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setModelReferenceUrl(model.imageUrl);
                        setModelReferenceName(model.name);
                        setPromptOverride(null);
                      }}
                      className="block w-full"
                    >
                      <RawPreviewImage src={model.imageUrl} alt={model.name} className="aspect-square w-full object-cover" />
                      <div className="p-1 text-center"><span className="text-[10px] font-medium">{model.name}</span></div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setLightboxSrc(model.imageUrl); }}
                      className={CARD_ZOOM_BUTTON_CLASS}
                      title="放大预览"
                    >
                      <ZoomIn className="h-3.5 w-3.5" />
                    </button>
                    {modelReferenceUrl === model.imageUrl ? <CheckCircle2 className="absolute left-1.5 top-1.5 h-4 w-4 rounded-full bg-white text-emerald-500" /> : null}
                  </div>
                ))}
                <div className={`group relative overflow-hidden rounded-lg border-2 border-dashed transition-colors ${modelReferenceUrl && !PRESET_BACKGROUND_MODELS.some((item) => item.imageUrl === modelReferenceUrl) ? "border-zinc-900 bg-zinc-50" : "border-gray-200 hover:border-zinc-300"}`}>
                  <button type="button" onClick={() => modelInputRef.current?.click()} className="flex aspect-square w-full flex-col items-center justify-center">
                    {modelReferenceUrl && !PRESET_BACKGROUND_MODELS.some((item) => item.imageUrl === modelReferenceUrl)
                      ? <RawPreviewImage src={modelReferenceUrl} alt={modelReferenceName || "自定义模特"} className="h-full w-full rounded-lg object-contain p-1" />
                      : <><Camera className="w-5 h-5 text-gray-300" /><span className="mt-1 text-[10px] text-gray-400">点击上传</span></>
                    }
                  </button>
                  {modelReferenceUrl && !PRESET_BACKGROUND_MODELS.some((item) => item.imageUrl === modelReferenceUrl) ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setLightboxSrc(modelReferenceUrl); }}
                      className={CARD_ZOOM_BUTTON_CLASS}
                      title="放大预览"
                    >
                      <ZoomIn className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {mode !== "model_only" ? (
            <section>
              <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-950">
                <Images className="h-4 w-4 text-zinc-700" /> 参考图 / 场景
              </h3>
              <p className="mb-3 text-[11px] text-slate-400">预设背景、上传背景和文生背景互斥；选择参考图后会优先锁定场景、光线和构图氛围。</p>
              <div className="mb-3">
                <StudioOptionGrid
                  options={BACKGROUND_SOURCE_OPTIONS.map((item) => ({
                    value: item,
                    label: BACKGROUND_SOURCE_LABELS[item],
                  }))}
                  value={backgroundSource}
                  onChange={(item) => {
                    setBackgroundSource(item);
                    if (item === "preset") {
                      setBackgroundReferenceUrl(getBackgroundPreset(backgroundPresetId).imageUrl);
                    }
                    if (item === "upload" && backgroundSource !== "upload") {
                      setBackgroundReferenceUrl("");
                    }
                    setPromptOverride(null);
                  }}
                  columns={3}
                  ariaLabel="背景来源"
                />
              </div>
              <input
                ref={backgroundInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label="上传背景参考图"
                onChange={(event) => {
                  const input = event.currentTarget;
                  void handleUpload(Array.from(input.files || []), "background").finally(() => {
                    input.value = "";
                  });
                }}
              />
              {backgroundSource === "preset" ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white/55 p-3">
                  <p className="mb-3 text-[11px] text-slate-500">选择系统参考图，只参考场景、光线、色彩和空间氛围。</p>
                  <div className="grid grid-cols-3 gap-2">
                    {BACKGROUND_PRESETS.map((item) => (
                      <div key={item.id} className={`group relative overflow-hidden rounded-xl border bg-white text-center shadow-sm transition ${backgroundPresetId === item.id ? "border-zinc-950 ring-2 ring-zinc-200" : "border-slate-100 hover:border-zinc-300"}`}>
                        <button
                          type="button"
                          onClick={() => {
                            setBackgroundPresetId(item.id);
                            setBackgroundReferenceUrl(item.imageUrl);
                            setPromptOverride(null);
                          }}
                          className="block w-full"
                        >
                          <div className="relative aspect-[3/4] overflow-hidden bg-slate-100">
                            <RawPreviewImage src={item.imageUrl} alt={item.name} className="h-full w-full object-cover transition group-hover:scale-105" />
                          </div>
                          <p className="truncate px-1.5 py-1.5 text-[11px] font-bold text-slate-800">{item.name}</p>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setLightboxSrc(item.imageUrl); }}
                          className={CARD_ZOOM_BUTTON_CLASS}
                          title="放大预览"
                        >
                          <ZoomIn className="h-3.5 w-3.5" />
                        </button>
                        {backgroundPresetId === item.id ? <CheckCircle2 className="absolute left-2 top-2 h-4 w-4 rounded-full bg-white text-emerald-500" /> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : backgroundSource === "upload" ? (
                <button type="button" onClick={() => backgroundInputRef.current?.click()} className="group studio-upload-dropzone studio-fixed-upload-slot flex w-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-slate-200 p-3 text-center transition hover:border-zinc-300" style={{ "--studio-fixed-upload-height": "328px" } as CSSProperties}>
                  {backgroundReferenceUrl ? (
                    <div className="studio-fixed-upload-preview studio-checkerboard relative mb-2 overflow-hidden rounded-xl" style={{ "--studio-fixed-preview-height": "220px" } as CSSProperties}>
                      <RawPreviewImage src={backgroundReferenceUrl} alt="背景参考" className="h-full w-full object-contain p-2" />
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setLightboxSrc(backgroundReferenceUrl); }}
                        className={CARD_ZOOM_BUTTON_CLASS}
                        title="放大预览"
                        aria-label="放大预览背景参考"
                      >
                        <ZoomIn aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
                      <Images className="h-7 w-7 text-zinc-700" />
                    </div>
                  )}
                  <span className="text-sm font-semibold text-slate-800">{backgroundReferenceUrl ? "更换背景参考图" : "上传背景参考图"}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-slate-500">只参考场景、光线、空间和构图氛围，不复制图里的衣服或人物。</span>
                </button>
              ) : (
                <div className="space-y-3">
                <StudioPromptTextarea value={backgroundText} onChange={(e) => { setBackgroundText(e.target.value); setPromptOverride(null); }} rows={4} className="studio-prompt-textarea-compact" placeholder="描述你想要的背景..." />
                  <div className="flex flex-wrap gap-2">
                    {BACKGROUND_TEXT_PRESETS.map((preset) => (
                      <button key={preset} type="button" onClick={() => { setBackgroundText(preset); setPromptOverride(null); }} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-600 hover:border-zinc-300 hover:text-zinc-900">
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          ) : null}

          <StudioPromptTextarea
            title="补充要求"
            badge="可选"
            value={userPrompt}
            onChange={(e) => { setUserPrompt(e.target.value); setPromptOverride(null); }}
            rows={4}
            placeholder={MODEL_BACKGROUND_USER_PROMPT_PLACEHOLDER}
          />

          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-950"><Sparkles className="h-4 w-4 text-[var(--codex-accent)]" /> 生成模型</h3>
            <StudioModelSelector
              models={MODELS}
              value={aiModel}
              onChange={setAiModel}
              ariaLabel="生成模型"
              getMeta={(model) => `${model.desc} · 当前${getCreditCost(model.value, imageSize, aspectRatio)}灵点`}
            />
          </section>

          <section>
            <h3 className="mb-3 text-sm font-bold text-slate-950">图片比例</h3>
            <StudioOptionGrid options={ASPECTS} value={aspectRatio} onChange={setAspectRatio} columns={3} ariaLabel="图片比例" />
          </section>

          <section>
            <h3 className="mb-3 text-sm font-bold text-slate-950">分辨率</h3>
            <StudioOptionGrid
              options={imageSizes.map((size) => ({
                value: size,
                label: `${size} · ${getCreditCost(aiModel, size, aspectRatio)}灵点`,
              }))}
              value={imageSize}
              onChange={setImageSize}
              columns={3}
              ariaLabel="分辨率"
            />
          </section>
          <section>
            <h3 className="mb-3 text-sm font-bold text-slate-950">生成数量</h3>
            <StudioGenerationCountSelector
              value={genCount}
              onChange={setGenCount}
              ariaLabel="生成数量"
            />
          </section>
        </div>
        <StudioRunBar
          summary={sourceUrls.length > 1 ? `${sourceUrls.length} 张原图 × ${genCount} · ${imageSize}` : `${sourceUrls.length ? "原图已上传" : "等待上传原图"} · ${genCount} 张`}
          costLabel={authIsAnonymous ? "登录后查看灵点" : `消耗 ${cost} · 余额 ${credits ?? "-"}`}
          disabled={isGenerating || Boolean(runDisabledReason)}
          disabledReason={runDisabledReason}
          primaryLabel={authIsAnonymous ? "登录后生成" : isGenerating ? `生成中 ${Math.round(progress)}%` : `生成 ${genCount} 张`}
          isLoading={isGenerating}
          onPrimaryAction={() => generate()}
        />
      </div>

      <div className="studio-canvas relative flex-1 min-h-[520px] lg:h-full overflow-hidden mt-3 mb-6 lg:mt-0 lg:mb-0">
        {!isGenerating && resultUrls.length === 0 && !error && (
          <div className="studio-empty-stage min-h-[260px] sm:min-h-[360px] lg:h-full flex items-center justify-center px-4">
            <PreviewGuide
              title="上传原图和背景，生成换背景结果"
              subtitle="保留人物和穿搭，只替换场景氛围。"
              steps={[
                {
                  title: "上传原图",
                  desc: "",
                  imageSrc: "/tutorial-guides/background-source.webp",
                  imageAlt: "换背景原图",
                  badge: "原图",
                },
                {
                  title: "选择背景",
                  desc: "",
                  imageSrc: "/tutorial-guides/background-reference.webp",
                  imageAlt: "背景参考图",
                  badge: "背景参考",
                },
                {
                  title: "生成结果",
                  desc: "",
                  imageSrc: "/tutorial-guides/background-result.webp",
                  imageAlt: "换背景结果图",
                  badge: "结果图",
                },
              ]}
            />
          </div>
        )}

        {(isGenerating || resultUrls.length > 0) && (
          <div className="studio-result-stage min-h-[260px] sm:min-h-[360px] overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:h-full flex flex-col animate-fade-in">
            <div className="flex min-h-0 flex-1 items-start justify-start">
              <ResultImageGrid
                urls={resultUrls}
                filenamePrefix="model-background"
                expectedCount={activeResultExpectedCount}
                isGenerating={isGenerating}
                inputThumbnails={promptImages.map((item) => item.url)}
                statusGroup={isGenerating ? "running" : undefined}
                variant="task"
                markMissingAsFailed={hasCompletedPartialResults}
                missingFailureLabel="本张生成失败"
                missingFailureDetail={partialFailureMessage}
                missingFailureActionLabel="重试本张"
                onMissingFailureAction={handleRetryFailedResult}
                missingFailureActionDisabled={retryDisabled}
                onOpen={(_, index) => setPreviewIndex(index)}
              />
            </div>
            <StudioImagePreviewDialog
              open={previewIndex !== null}
              onClose={() => setPreviewIndex(null)}
              session={previewSession}
              selectedIndex={previewIndex || 0}
              onSelectedIndexChange={setPreviewIndex}
              filenamePrefix="model-background"
              actions={MODEL_BACKGROUND_PREVIEW_ACTIONS}
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

      {showRules && rulesPopoverStyle ? (
        <ClientPortal>
          <div
            className="fixed z-[240] w-[min(760px,calc(100vw-32px))] overflow-hidden rounded-[24px] border border-white/80 bg-white/[0.96] shadow-[0_28px_90px_rgba(15,23,42,0.18)] backdrop-blur-2xl animate-fade-in"
            style={{ top: rulesPopoverStyle.top, left: rulesPopoverStyle.left, maxHeight: rulesPopoverStyle.maxHeight }}
            onMouseEnter={cancelRulesHide}
            onMouseLeave={scheduleRulesHide}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-base font-black text-slate-950">{MODEL_BACKGROUND_UPLOAD_RULE.title}</h3>
                <p className="mt-1 text-xs text-slate-400">{MODEL_BACKGROUND_UPLOAD_RULE.uploadSpecText}</p>
              </div>
              <button type="button" onClick={() => setShowRules(false)} aria-label="关闭" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="studio-scrollbar-hide overflow-y-auto px-5 py-4" style={{ maxHeight: rulesPopoverStyle.maxHeight - 88 }}>
              <div className="grid gap-3 md:grid-cols-4">
                {MODEL_BACKGROUND_UPLOAD_RULE.demos.map((demo) => (
                  <div key={demo.imageUrl} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-2">
                    <div className="relative overflow-hidden rounded-xl bg-white">
                      <RawPreviewImage src={demo.imageUrl} alt={demo.title} className="aspect-[3/4] w-full object-cover" />
                      <CheckCircle2 className="absolute right-2 top-2 h-5 w-5 rounded-full bg-white text-emerald-500" />
                    </div>
                    <p className="mt-2 text-center text-xs font-semibold text-slate-700">{demo.title}</p>
                    <button type="button" onClick={() => applyDemo(demo)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-zinc-300 hover:text-zinc-900">试一试</button>
                  </div>
                ))}
              </div>
              <p className="mt-5 text-center text-xs font-semibold text-slate-500">小贴士：请勿上传以下错误图片，会极大影响生成效果</p>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                {MODEL_BACKGROUND_UPLOAD_RULE.badExamples.map((bad) => (
                  <div key={bad.imageUrl} className="rounded-2xl border border-red-100 bg-red-50/50 p-2">
                    <div className="relative overflow-hidden rounded-xl bg-white">
                      <RawPreviewImage src={bad.imageUrl} alt={bad.title} className="aspect-[3/4] w-full object-cover" />
                      <X className="absolute right-2 top-2 h-5 w-5 rounded-full bg-red-500 p-0.5 text-white" />
                    </div>
                    <p className="mt-2 text-center text-xs font-semibold text-slate-700">{bad.title}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ClientPortal>
      ) : null}

      {lightboxSrc ? (
        <ClientPortal>
          <div className="fixed inset-0 z-[180] flex cursor-zoom-out items-center justify-center bg-slate-950/66 p-4 backdrop-blur-xl sm:p-8" onClick={() => setLightboxSrc(null)}>
            <RawPreviewImage src={lightboxSrc} alt="预览" className="max-h-full max-w-full rounded-2xl object-contain shadow-[0_32px_120px_rgba(0,0,0,0.45)]" />
            <button type="button" onClick={() => setLightboxSrc(null)} className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/85 bg-white/90 text-slate-700 shadow-[0_12px_34px_rgba(15,23,42,0.22)] backdrop-blur transition-colors hover:bg-white hover:text-slate-950 sm:right-6 sm:top-6">
              <X className="h-5 w-5" />
            </button>
          </div>
        </ClientPortal>
      ) : null}
    </div>
  );
}
