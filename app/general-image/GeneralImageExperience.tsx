"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowUpRight,
  ImagePlus,
} from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { FeatureTabs } from "@/components/FeatureTabs";
import { ModuleHeader } from "@/components/ModuleHeader";
import { ModuleTaskRail } from "@/components/studio/ModuleTaskRail";
import type { TaskSelectionSession } from "@/components/studio/useTaskSelectionSession";
import { ErrorStage } from "@/components/studio/ErrorStage";
import { LoadingStage } from "@/components/studio/LoadingStage";
import { TaskSwitchLoading } from "@/components/studio/TaskSwitchLoading";
import { ResultImageGrid } from "@/components/ResultImageGrid";
import { StudioImagePreviewDialog } from "@/components/studio/StudioImagePreviewDialog";
import { PreviewGuide } from "@/components/PreviewGuide";
import { StudioModelSelector, StudioToggleRow } from "@/components/studio/StudioFormControls";
import { ResolutionSelector } from "@/components/studio/ResolutionSelector";
import { PromptTextarea } from "@/components/studio/PromptTextarea";
import { AspectRatioSelector } from "@/components/studio/AspectRatioSelector";
import { GenerationCountField } from "@/components/studio/GenerationCountField";
import { useStudioAuth } from "@/components/studio/useStudioAuth";
import { StudioRunBar } from "@/components/studio/StudioRunBar";
import { StudioUploadSection } from "@/components/studio/StudioUploadSection";
import { MultiImageUploadV2 } from "@/components/studio/MultiImageUploadV2";
import { StudioMediaLightbox } from "@/components/studio/StudioMediaLightbox";
import { StudioShowcaseGallery } from "@/components/studio/StudioShowcaseGallery";
import { useTaskQueueGeneration } from "@/components/studio/useTaskQueueGeneration";
import { useGenerationPolling } from "@/hooks/use-generation-polling";
import { setCachedProfileCredits } from "@/lib/supabase/client";
import { MAX_FILE_SIZE, MAX_FILE_SIZE_MB, uploadImage } from "@/lib/utils";
import { getCreditCost, getSupportedImageSizes, normalizeAspectRatio, normalizeImageSize, normalizeLingyaModel, type AspectRatio, type ImageSize, type LingyaModel } from "@/lib/api/lingya";
import { useStudioImageModelOptions } from "@/lib/studio-models";
import { fetchHistoryApplyDetail, getApplyPath, getHistoryApplyFailureMessage, isHistoryApplyRowFailed, type HistoryJobPayload } from "@/lib/history-apply";
import { clampTaskExpectedCount, safeTaskQueueUrls, type TaskQueueItem } from "@/lib/task-queue";
import { requestStudioNavigation } from "@/lib/studio-navigation";
import { useResourcePicker } from "@/features/resource-library";
import { applyGenerationResponseStatus, showInsufficientCreditsToast } from "@/lib/ui/credit-copy";
import { takeSourceImageFromLocation, type ImagePreviewAction } from "@/lib/studio-image-preview";
import { useStudioPreview } from "@/hooks/use-studio-preview";
import { useHistoryApply } from "@/hooks/use-history-apply";
import { FAILED_RETRY_NOTICE, buildFailedTaskDetail, buildPartialFailureDetail, coerceErrorMessage, summarizeGenerationError } from "@/lib/studio-generation-feedback";
import {
  buildRetryPendingResultUrls,
  getRetryDisplayExpectedCount,
  mergeRetryResultUrls,
  normalizeRetryResultIndex,
} from "@/lib/result-slot-retry";
import { ImagePromptDialog, type ImagePromptSource } from "@/features/general-image/image-prompt-dialog";
import {
  getGeneralImageDefaultSettings,
  MAX_GENERAL_IMAGE_REFERENCE_IMAGES,
  MAX_GENERAL_IMAGE_OUTPUT_COUNT,
  MAX_GENERAL_IMAGE_SPLIT_REFERENCES,
  MAX_GENERAL_IMAGE_TOTAL_COUNT,
  type GeneralImageMode,
} from "@/lib/general-image-config";
import type { StudioShowcaseExample, StudioShowcaseModule } from "@/lib/showcase-examples";

type ReferenceImage = {
  id: string;
  name: string;
  url: string;
  preview: string;
};

type GeneralImageHistoryPayload = Extract<HistoryJobPayload, { kind: "generalImage" }>;
type GeneralImageGenerateOptions = {
  genCountOverride?: number;
  expectedCountOverride?: number;
  retryResultIndex?: number;
  toastMessage?: string;
};

function createDraftSignature(prompt: string, referenceUrls: string[], imagePromptUrl = "") {
  return JSON.stringify({ prompt: prompt.trim(), referenceUrls, imagePromptUrl });
}

const ASPECTS: { value: AspectRatio; label: string; labelKey?: string }[] = [
  { value: "3:4", label: "3:4 竖版", labelKey: "aspect34" },
  { value: "4:3", label: "4:3 横版", labelKey: "aspect43" },
  { value: "1:1", label: "1:1 方图", labelKey: "aspect11" },
  { value: "9:16", label: "9:16 手机", labelKey: "aspect916" },
  { value: "16:9", label: "16:9 宽屏", labelKey: "aspect169" },
  { value: "4:5", label: "4:5 电商", labelKey: "aspect45" },
  { value: "auto", label: "智能", labelKey: "aspectAuto" },
];

const IMAGE_PROMPT_PLACEHOLDER_KEY = "imagePromptPlaceholder";

const GENERAL_IMAGE_PREVIEW_ACTIONS: Array<ImagePreviewAction & { labelKey: string }> = [
  { kind: "download", label: "下载图片", labelKey: "actionDownload" },
  { kind: "copy", label: "复制链接", labelKey: "actionCopy" },
  { kind: "repair", label: "AI修图", labelKey: "actionRepair" },
  { kind: "aiVideo", label: "AI视频", labelKey: "actionAiVideo" },
  { kind: "modelBackground", label: "换背景", labelKey: "actionModelBackground" },
  { kind: "pose", label: "姿势裂变", labelKey: "actionPose" },
  { kind: "productSet", label: "商品套图", labelKey: "actionProductSet" },
  { kind: "regenerateAll", label: "重新创作", labelKey: "actionRegenerateAll" },
  { kind: "feedback", label: "反馈", labelKey: "actionFeedback" },
];

export function GeneralImageExperience({ initialMode = "text-to-image" }: { initialMode?: GeneralImageMode }) {
  const router = useRouter();
  const t = useTranslations("GeneralImage");
  const { openResourcePicker } = useResourcePicker();
  const tShared = useTranslations("Shared");
  const { confirm, confirmDialog } = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagePromptInputRef = useRef<HTMLInputElement>(null);
  const imagePromptTriggerRef = useRef<HTMLButtonElement>(null);
  const defaultSettings = getGeneralImageDefaultSettings(initialMode);

  const [mode, setMode] = useState<GeneralImageMode>(initialMode);
  const [prompt, setPrompt] = useState("");
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);

  const {
    authChecked,
    isAuthenticated,
    userId,
    credits,
    setCredits,
    refreshCredits,
    refreshAuth,
  } = useStudioAuth();
  const [aiModel, setAiModel] = useState<LingyaModel>(
    defaultSettings.model,
  );
  const modelOptions = useStudioImageModelOptions(mode === "text-to-image" ? "generation" : "edit");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(defaultSettings.aspectRatio);
  const [imageSize, setImageSize] = useState<ImageSize>(defaultSettings.imageSize);
  const [genCount, setGenCount] = useState(1);
  const [onePerReference, setOnePerReference] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultUrls, setResultUrls] = useState<string[]>([]);
  const [resultGroupReferences, setResultGroupReferences] = useState<ReferenceImage[]>([]);
  const [error, setError] = useState("");
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [referenceLightboxSrc, setReferenceLightboxSrc] = useState<string | null>(null);
  const [showImagePromptModal, setShowImagePromptModal] = useState(false);
  const [imagePromptImage, setImagePromptImage] = useState<ImagePromptSource | null>(null);
  const [imagePromptText, setImagePromptText] = useState("");
  const [isImagePromptUploading, setIsImagePromptUploading] = useState(false);
  const [isImagePromptGenerating, setIsImagePromptGenerating] = useState(false);
  const [activeQueueTask, setActiveQueueTask] = useState<TaskQueueItem | null>(null);
  const [displayedTaskId, setDisplayedTaskId] = useState<string | null>(null);
  const [restoringTaskId, setRestoringTaskId] = useState<string | null>(null);
  const displayedTaskIdRef = useRef<string | null>(null);
  const [cleanDraftSignature, setCleanDraftSignature] = useState(() => createDraftSignature("", []));
  const currentDraftSignature = useMemo(
    () => createDraftSignature(
      prompt,
      referenceImages.map((item) => item.url),
      imagePromptImage?.url || "",
    ),
    [imagePromptImage?.url, prompt, referenceImages],
  );
  // Restored/generated tasks are a saved baseline; only edits after that point
  // should ask for confirmation. Mode switches within general image stay exempt.
  const { unsavedDialog } = useUnsavedChangesGuard(
    currentDraftSignature !== cleanDraftSignature,
    { exemptPaths: ["/general-image", "/general-image/image-to-image"] },
  );

  const supportedSizes = getSupportedImageSizes(aiModel, aspectRatio);
  const costPerImage = getCreditCost(aiModel, imageSize, aspectRatio);
  const isImageMode = mode === "image-to-image";
  const referenceUploadLimit = onePerReference
    ? MAX_GENERAL_IMAGE_SPLIT_REFERENCES
    : MAX_GENERAL_IMAGE_REFERENCE_IMAGES;
  const splitReferenceLimitExceeded = onePerReference
    && referenceImages.length > MAX_GENERAL_IMAGE_SPLIT_REFERENCES;
  const splitMultiplier = isImageMode && onePerReference && referenceImages.length > 1
    ? referenceImages.length
    : 1;
  const effectiveGenCount = genCount * splitMultiplier;
  const effectiveTotalCost = costPerImage * effectiveGenCount;
  const authIsAnonymous = authChecked && !isAuthenticated;
  const activeFeature = isImageMode ? "imageToImage" : "textToImage";
  const taskInputThumbnails = useMemo(
    () => isImageMode
      ? referenceImages.map((item) => item.preview || item.url).filter((url): url is string => Boolean(url))
      : [],
    [isImageMode, referenceImages]
  );
  const taskQueue = useTaskQueueGeneration({
    module: "generalImage",
    scope: mode,
    title: t("taskQueueTitle"),
    defaultExpectedCount: effectiveGenCount,
    applyPath: isImageMode ? "/general-image/image-to-image" : "/general-image",
  });

  // 后台轮询：useGenerationPolling 替代 inline for-loop + setTimeout + fetch
  // general-image 比较直白：completed / failed 二选一，没有 transient 分支。
  const pollCtxRef = useRef<{
    activeTaskId: string;
    generationId: string;
    displayExpectedCount: number;
    retryPreviousResultUrls: string[];
    retryResultIndex: number | null;
    taskInputThumbnails: string[];
    latestTaskResultUrlsRef: { current: string[] };
    setProgress: (p: number) => void;
    setResultUrls: (urls: string[]) => void;
    setIsGenerating: (b: boolean) => void;
    setError: (msg: string) => void;
    setActiveQueueTask: (task: TaskQueueItem) => void;
    refreshCredits: () => Promise<number | null | undefined>;
    taskQueue: typeof taskQueue;
    isImageMode: boolean;
  } | null>(null);

  const { start: startGeneralImagePolling } = useGenerationPolling<{
    status: string;
    progress?: number;
    result_urls?: unknown;
    error?: string;
    partial_failure?: { message?: unknown };
  }>({
    id: "",
    buildUrl: (id) => {
      const ctx = pollCtxRef.current;
      return `/api/general-image?generation_id=${encodeURIComponent(ctx?.generationId ?? id)}`;
    },
    isTerminal: (state) => state.status === "completed" || state.status === "failed",
    intervalMs: 2000,
    maxAttempts: 150,
    onTick: (state) => {
      const ctx = pollCtxRef.current;
      if (!ctx) return;
      // 终端态交给 onComplete
      if (state.status === "completed" || state.status === "failed") return;

      if (Array.isArray(state.result_urls) && state.result_urls.length) {
        ctx.latestTaskResultUrlsRef.current = mergeRetryResultUrls(
          ctx.retryPreviousResultUrls,
          ctx.retryResultIndex,
          state.result_urls,
          ctx.displayExpectedCount
        );
        if (displayedTaskIdRef.current === ctx.activeTaskId) {
          ctx.setResultUrls(ctx.latestTaskResultUrlsRef.current);
        }
      }

      const nextProgress = Number(state.progress);
      if (Number.isFinite(nextProgress)) {
        const runningProgress = Math.min(Math.max(Math.round(nextProgress), 0), 99);
        if (displayedTaskIdRef.current === ctx.activeTaskId) {
          ctx.setProgress(runningProgress);
        }
      }
      const runningTask = ctx.taskQueue.markRunning(ctx.activeTaskId, {
        expectedCount: ctx.displayExpectedCount,
        inputThumbnails: ctx.taskInputThumbnails,
        resultThumbnails: ctx.latestTaskResultUrlsRef.current,
        resultCount: ctx.latestTaskResultUrlsRef.current.filter(Boolean).length,
        progress: Number.isFinite(nextProgress) ? Math.min(Math.max(Math.round(nextProgress), 0), 99) : 25,
        status: state.status || "processing",
      });
      if (displayedTaskIdRef.current === ctx.activeTaskId) {
        ctx.setActiveQueueTask(runningTask);
      }
    },
    onComplete: (state) => {
      const ctx = pollCtxRef.current;
      if (!ctx) return;

      if (state.status === "completed") {
        const isDisplayedTask = displayedTaskIdRef.current === ctx.activeTaskId;
        const finalUrls = mergeRetryResultUrls(
          ctx.retryPreviousResultUrls,
          ctx.retryResultIndex,
          Array.isArray(state.result_urls) ? state.result_urls : ctx.latestTaskResultUrlsRef.current,
          ctx.displayExpectedCount
        );
        ctx.latestTaskResultUrlsRef.current = finalUrls;
        const finalResultCount = finalUrls.filter(Boolean).length;
        const partialFailure = state.partial_failure && typeof state.partial_failure === "object"
          ? (state.partial_failure as { message?: unknown })
          : null;
        const completedError = state.error || coerceErrorMessage(partialFailure?.message);
        const completedTask = ctx.taskQueue.markCompleted(ctx.activeTaskId, {
          expectedCount: ctx.displayExpectedCount,
          inputThumbnails: ctx.taskInputThumbnails,
          resultThumbnails: finalUrls,
          resultCount: finalResultCount,
          error: completedError ? summarizeGenerationError(completedError) : "",
        });
        if (isDisplayedTask) {
          ctx.setProgress(100);
          ctx.setResultUrls(finalUrls);
          ctx.setActiveQueueTask(completedTask);
          ctx.setIsGenerating(false);
        }
        if (completedError || finalResultCount < ctx.displayExpectedCount) {
          void ctx.refreshCredits();
          if (isDisplayedTask) {
            toast.warning(t(ctx.isImageMode ? "partialCompleteImageToImage" : "partialCompleteTextToImage", { done: finalResultCount, expected: ctx.displayExpectedCount }));
          }
        } else if (isDisplayedTask) {
          toast.success(t(ctx.isImageMode ? "completeImageToImage" : "completeTextToImage"));
        }
        return;
      }

      if (state.status === "failed") {
        const isDisplayedTask = displayedTaskIdRef.current === ctx.activeTaskId;
        const message = summarizeGenerationError(state.error || t("generateFailed"));
        const failedTask = ctx.taskQueue.markFailed(ctx.activeTaskId, message, {
          expectedCount: ctx.displayExpectedCount,
          inputThumbnails: ctx.taskInputThumbnails,
          resultThumbnails: ctx.latestTaskResultUrlsRef.current,
          resultCount: ctx.latestTaskResultUrlsRef.current.filter(Boolean).length,
        });
        if (isDisplayedTask) {
          ctx.setError(message);
          ctx.setActiveQueueTask(failedTask);
          ctx.setIsGenerating(false);
        }
        if (isDisplayedTask) toast.error(message);
        void ctx.refreshCredits();
      }
    },
    onError: (error) => {
      const ctx = pollCtxRef.current;
      if (!ctx) return;
      const message = summarizeGenerationError(error.message || t("generateTimeout"));
      const isDisplayedTask = displayedTaskIdRef.current === ctx.activeTaskId;
      const failedTask = ctx.taskQueue.markFailed(ctx.activeTaskId, message, {
        expectedCount: ctx.displayExpectedCount,
        inputThumbnails: ctx.taskInputThumbnails,
        resultThumbnails: ctx.latestTaskResultUrlsRef.current,
        resultCount: ctx.latestTaskResultUrlsRef.current.filter(Boolean).length,
      });
      if (isDisplayedTask) {
        ctx.setError(message);
        ctx.setActiveQueueTask(failedTask);
        ctx.setIsGenerating(false);
      }
      if (isDisplayedTask) toast.error(message);
      void ctx.refreshCredits();
    },
  });
  const modeMeta = isImageMode
    ? {
        title: t("modeImageToImage"),
        tooltip: t("imageToImageTooltip"),
        emptyTitle: t("imageToImageEmptyTitle"),
        emptySubtitle: t("imageToImageEmptySubtitle"),
        emptyImage: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/guides/image-to-image-guide-v3.png",
        emptyImageFit: "contain" as const,
      }
    : {
        title: t("modeTextToImage"),
        tooltip: t("textToImageTooltip"),
        emptyTitle: t("textToImageEmptyTitle"),
        emptySubtitle: t("textToImageEmptySubtitle"),
        emptyImage: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/guides/text-to-image-guide-v1.png",
        emptyImageFit: "contain" as const,
      };
  const showcaseModule: StudioShowcaseModule = isImageMode
    ? "general-image-image-to-image"
    : "general-image-text-to-image";
  const previewReferenceUrls = safeTaskQueueUrls(activeQueueTask?.inputThumbnails).length
    ? safeTaskQueueUrls(activeQueueTask?.inputThumbnails)
    : referenceImages.map((item) => item.preview || item.url).filter(Boolean);
  const activeResultExpectedCount = activeQueueTask
    ? clampTaskExpectedCount(activeQueueTask, 1, MAX_GENERAL_IMAGE_TOTAL_COUNT, effectiveGenCount)
    : isGenerating
      ? effectiveGenCount
      : Math.max(
          resultUrls.length,
          resultGroupReferences.length > 1 ? resultGroupReferences.length * genCount : 1,
        );
  const displayedResultUrls = resultUrls.filter(Boolean);
  const hasCompletedPartialResults = Boolean(
    activeQueueTask?.statusGroup === "completed"
    && activeResultExpectedCount > displayedResultUrls.length
  );
  const partialFailureMessage = buildPartialFailureDetail({
    message: activeQueueTask?.error,
    failedCount: activeResultExpectedCount - displayedResultUrls.length,
  });
  const retryDisabled = isGenerating;
  function handleRetryFailedResult(index: number) {
    if (retryDisabled) return;
    void generate({
      genCountOverride: 1,
      expectedCountOverride: 1,
      retryResultIndex: index,
      toastMessage: t("retryToast", { index: index + 1 }),
    });
  }
  const previewSession = useStudioPreview({
    module: "generalImage",
    title: modeMeta.title,
    taskId: activeQueueTask?.id,
    urls: resultUrls,
    expectedCount: activeResultExpectedCount,
    isGenerating,
    statusGroup: activeQueueTask?.statusGroup || (isGenerating ? "running" : undefined),
    createdAt: activeQueueTask?.createdAt,
    references: previewReferenceUrls.map((url, index) => ({
      url,
      label: t("referenceImageLabel", { index: index + 1 }),
      role: "reference" as const,
    })),
    promptText: prompt,
    metaItems: [
      { label: t("metaMode"), value: modeMeta.title },
      { label: t("metaModel"), value: aiModel },
      { label: t("metaRatio"), value: aspectRatio },
      { label: t("metaResolution"), value: imageSize },
      { label: t("metaCount"), value: genCount },
    ],
    resultTitlePrefix: isImageMode ? t("resultPrefixImageToImage") : t("resultPrefixTextToImage"),
    aspectRatio,
  });
  const canGenerate = !isGenerating
    && !isUploading
    && !splitReferenceLimitExceeded
    && prompt.trim().length > 0
    && (!isImageMode || referenceImages.length > 0);
  const runDisabledReason = !prompt.trim()
    ? t("needPrompt")
    : isImageMode && referenceImages.length === 0
      ? t("needReference")
      : splitReferenceLimitExceeded
        ? `${t("onePerReferenceLabel")}：${tShared("maxCountBadge", { maxCount: MAX_GENERAL_IMAGE_SPLIT_REFERENCES })}`
      : "";

  useEffect(() => {
    const nextSizes = getSupportedImageSizes(aiModel, aspectRatio);
    if (!nextSizes.includes(imageSize)) setImageSize(nextSizes[0] || "1K");
  }, [aiModel, aspectRatio, imageSize]);

  useEffect(() => {
    const nextDefaults = getGeneralImageDefaultSettings(initialMode);
    setMode(initialMode);
    setAiModel(nextDefaults.model);
    setAspectRatio(nextDefaults.aspectRatio);
    setImageSize(nextDefaults.imageSize);
    resetOutput();
  }, [initialMode]);

  useEffect(() => {
    const sourceImage = takeSourceImageFromLocation();
    if (sourceImage) {
      setMode("image-to-image");
      setAiModel(getGeneralImageDefaultSettings("image-to-image").model);
      setReferenceImages([{
        id: `source-${Date.now()}`,
        name: t("fromPreview"),
        url: sourceImage,
        preview: sourceImage,
      }]);
      setPrompt((prev) => prev.trim() || t("defaultImagePrompt"));
      toast.success(t("broughtPreviewImage"));
    }
  }, [t]);

  function selectDisplayedTask(taskId: string | null) {
    displayedTaskIdRef.current = taskId;
    setDisplayedTaskId(taskId);
  }

  function applyGeneralImageHistoryPayload(
    payload: GeneralImageHistoryPayload,
    historyResultUrls: string[] = [],
    options?: { silent?: boolean; task?: TaskQueueItem | null; taskId?: string | null }
  ) {
    const restoredAiModel = normalizeLingyaModel(payload.aiModel);
    const restoredAspectRatio = normalizeAspectRatio(payload.aspectRatio, "auto");
    const restoredImageSize = normalizeImageSize(restoredAiModel, payload.imageSize, restoredAspectRatio);
    // NOTE: do NOT change `mode` here. The page wrapper owns the mode via
    // initialMode + URL route (/general-image ↔ /general-image/image-to-image);
    // clicking a history row should restore the prompt/referenceImages/result
    // for the CURRENT route's mode, not silently switch routes underneath the
    // user. The previous behavior — setMode(payload.mode === "image-to-image"
    // ? "image-to-image" : "text-to-image") — caused two bugs:
    //   1. applying a text-to-image row while on /image-to-image flipped
    //      the right preview's filenamePrefix + applyPath to text-to-image,
    //      so the next Generate routed to /general-image ("callback to text-to-image").
    //   2. the conditional {isImageMode && <StudioUploadSection ...>} hid the
    //      reference upload UI even though the user had applied a row that
    //      included referenceUrls — making it look like the apply "did nothing".
    setPrompt(payload.prompt);
    setAiModel(restoredAiModel);
    setAspectRatio(restoredAspectRatio);
    // Restore the size AFTER aspect ratio so the validation uses the just-restored
    // ratio — passing the closure-captured `aspectRatio` here would silently force
    // the size to fall back to the lowest supported tier on re-apply.
    setImageSize(restoredImageSize);
    setGenCount(payload.genCount);
    // A split (multi-to-one) history row carries onePerReference=true so the
    // editor returns to the same mode with all references restored.
    setOnePerReference(payload.onePerReference === true);
    const restoredReferences = (payload.referenceUrls ?? []).map((url, index) => ({
      id: `history-general-${index}-${url}`,
      name: t("historyReferenceName", { index: index + 1 }),
      url,
      preview: url,
    }));
    setReferenceImages(restoredReferences);
    setResultGroupReferences(
      payload.onePerReference === true && restoredReferences.length > 1
        ? restoredReferences
        : [],
    );
    setImagePromptImage(null);
    setCleanDraftSignature(createDraftSignature(payload.prompt, payload.referenceUrls ?? []));
    selectDisplayedTask(options?.task?.id || options?.taskId || null);
    setActiveQueueTask(options?.task || null);
    setResultUrls(historyResultUrls);
    setIsGenerating(false);
    setError("");
    setProgress(historyResultUrls.length ? 100 : 0);
    if (!options?.silent) toast.success(t("historyAppliedToast"));
  }

  useHistoryApply({
    kind: "generalImage",
    apply: (payload, resultUrls, { row }) => {
      applyGeneralImageHistoryPayload(payload, resultUrls, { silent: true, taskId: row.id });
      if (isHistoryApplyRowFailed(row)) {
        setError(getHistoryApplyFailureMessage(row));
      }
    },
    onError: (err) => toast.error(err.message),
  });

  function resetOutput() {
    selectDisplayedTask(null);
    setRestoringTaskId(null);
    setActiveQueueTask(null);
    setIsGenerating(false);
    setResultUrls([]);
    setResultGroupReferences([]);
    setError("");
    setProgress(0);
  }

  function performContinueCreate() {
    setMode(initialMode);
    setPrompt("");
    setReferenceImages([]);
    setAiModel(defaultSettings.model);
    setAspectRatio(defaultSettings.aspectRatio);
    setImageSize(defaultSettings.imageSize);
    setGenCount(1);
    setOnePerReference(false);
    setIsDragging(false);
    setShowImagePromptModal(false);
    setImagePromptImage(null);
    setImagePromptText("");
    setIsImagePromptGenerating(false);
    setCleanDraftSignature(createDraftSignature("", []));
    resetOutput();
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (imagePromptInputRef.current) imagePromptInputRef.current.value = "";
  }

  function handleContinueCreate() {
    confirm({
      title: t("continueCreateTitle"),
      content: t("continueCreateContent"),
      okText: t("confirm"),
      cancelText: t("cancel"),
      onOk: performContinueCreate,
    });
  }

  function handleCreateSimilar(example: StudioShowcaseExample) {
    const nextModel: LingyaModel = example.model === "Nano Banana Pro"
      ? "nano-banana-pro"
      : example.model === "Nano Banana 2"
        ? "nano-banana-2"
        : "gpt-image-2";
    const nextAspectRatio = normalizeAspectRatio(example.aspectRatio, "3:4");
    const requestedSize: ImageSize = example.imageSize === "4K" ? "4K" : example.imageSize === "2K" ? "2K" : "1K";
    if (isImageMode) {
      const referenceUrls = (example.referenceImageUrls.length ? example.referenceImageUrls : [example.imageUrl])
        .slice(0, MAX_GENERAL_IMAGE_REFERENCE_IMAGES);
      setReferenceImages(referenceUrls.map((referenceUrl, index) => ({
        id: `showcase-reference-${example.id}-${index}`,
        name: `${example.title} ${index + 1}`,
        url: referenceUrl,
        preview: referenceUrl,
      })));
    } else {
      setReferenceImages([]);
    }
    setPrompt(example.prompt.slice(0, 4000));
    setAiModel(nextModel);
    setAspectRatio(nextAspectRatio);
    setImageSize(normalizeImageSize(nextModel, requestedSize, nextAspectRatio));
    setGenCount(1);
    setOnePerReference(false);
    setImagePromptImage(null);
    resetOutput();
    toast.success(isImageMode ? t("broughtPreviewImage") : t("appliedToDescription"));
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".studio-general-image-parameters-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  async function handleFiles(files?: FileList | File[]) {
    const selected = Array.from(files || []);
    if (!selected.length) return;

    const invalid = selected.find((file) => !file.type.startsWith("image/"));
    if (invalid) return toast.error(t("selectImageFile"));

    const oversized = selected.find((file) => file.size > MAX_FILE_SIZE);
    if (oversized) return toast.error(t("exceedsSize", { name: oversized.name, max: MAX_FILE_SIZE_MB }));

    const remain = Math.max(0, referenceUploadLimit - referenceImages.length);
    if (!remain) {
      return toast.error(tShared("multiImageCount", {
        count: referenceUploadLimit,
        max: referenceUploadLimit,
      }));
    }
    const limited = selected.slice(0, remain);
    if (selected.length > limited.length) {
      toast.info(tShared("multiImageCount", {
        count: referenceUploadLimit,
        max: referenceUploadLimit,
      }));
    }

    setIsUploading(true);
    toast.info(t("uploadingReferences", { count: limited.length }));
    try {
      const results = await Promise.allSettled(limited.map((file) => uploadImage(file)));
      const nextImages: ReferenceImage[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          nextImages.push({
            id: `${limited[index].name}-${Date.now()}-${index}`,
            name: limited[index].name || t("referenceImageDefaultName", { index: referenceImages.length + index + 1 }),
            url: result.value.url,
            preview: result.value.display_url || result.value.url,
          });
        } else {
          toast.error(t("uploadFailed", { name: limited[index].name }));
        }
      });
      if (nextImages.length) {
        setReferenceImages((prev) => [...prev, ...nextImages].slice(0, referenceUploadLimit));
        toast.success(t("referenceUploaded"));
      }
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function optimizePrompt() {
    if (!isAuthenticated && !(await refreshAuth())) {
      toast.error(t("pleaseLogin"));
      router.push("/login");
      return;
    }
    if (!prompt.trim() && referenceImages.length === 0) {
      toast.error(isImageMode ? t("needPromptOrReference") : t("needBasicIdea"));
      return;
    }

    setIsOptimizing(true);
    try {
      const res = await fetch("/api/general-image/optimize-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          prompt,
          reference_urls: isImageMode ? referenceImages.map((item) => item.url) : [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("promptOptimizeFailed"));
      if (data.prompt) {
        setPrompt(String(data.prompt).slice(0, 4000));
        toast.success(data.source === "fallback" ? t("optimizeFallback") : t("promptOptimized"));
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("promptOptimizeFailed"));
    } finally {
      setIsOptimizing(false);
    }
  }

  async function uploadImageForPrompt(files?: FileList | File[]) {
    const file = Array.from(files || [])[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error(t("selectImageFile"));
    if (file.size > MAX_FILE_SIZE) return toast.error(t("exceedsSize", { name: file.name, max: MAX_FILE_SIZE_MB }));

    if (!isAuthenticated && !(await refreshAuth())) {
      toast.error(t("pleaseLogin"));
      router.push("/login");
      return;
    }

    setIsImagePromptUploading(true);
    setImagePromptText("");
    try {
      const result = await uploadImage(file);
      const nextImage = {
        name: file.name,
        url: result.url,
        preview: result.display_url || result.url,
      };
      setImagePromptImage(nextImage);
      toast.success(t("imageUploadedGenerating"));
      await generateImagePrompt(nextImage.url);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("imageUploadFailed"));
    } finally {
      setIsImagePromptUploading(false);
      if (imagePromptInputRef.current) imagePromptInputRef.current.value = "";
    }
  }

  async function generateImagePrompt(imageUrl = imagePromptImage?.url) {
    if (!imageUrl) return toast.error(t("needUploadImage"));
    if (!isAuthenticated && !(await refreshAuth())) {
      toast.error(t("pleaseLogin"));
      router.push("/login");
      return;
    }

    setIsImagePromptGenerating(true);
    try {
      const res = await fetch("/api/general-image/image-to-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: imageUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("imageToPromptFailed"));
      if (data.prompt) {
        setImagePromptText(String(data.prompt).slice(0, 4000));
        toast.success(data.source === "fallback" ? t("imageToPromptFallback") : t("imagePromptGenerated"));
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("imageToPromptFailed"));
    } finally {
      setIsImagePromptGenerating(false);
    }
  }

  function applyImagePromptToDescription() {
    if (!imagePromptText.trim()) return toast.error(t("needGeneratePrompt"));
    setPrompt(imagePromptText.trim().slice(0, 4000));
    setShowImagePromptModal(false);
    toast.success(t("appliedToDescription"));
  }

  async function generate(options: GeneralImageGenerateOptions = {}) {
    if (!isAuthenticated && !(await refreshAuth())) {
      toast.error(t("pleaseLogin"));
      router.push("/login");
      return;
    }
    if (!prompt.trim()) return toast.error(t("enterPrompt"));
    if (isImageMode && !referenceImages.length) return toast.error(t("needReference"));
    const runGenCount = Math.min(
      Math.max(Math.round(Number(options.genCountOverride ?? genCount) || 1), 1),
      MAX_GENERAL_IMAGE_OUTPUT_COUNT,
    );
    const shouldSplit = onePerReference && isImageMode && referenceImages.length > 1;
    const runExpectedCount = Math.max(1, Math.round(Number(options.expectedCountOverride ?? runGenCount) || runGenCount));
    const retryResultIndex = normalizeRetryResultIndex(options.retryResultIndex);
    const retryPreviousResultUrls = retryResultIndex !== null ? resultUrls : [];
    // A retry inside a split run targets only the reference that owns the
    // failed slot; the request is sent as a single-reference run so the server
    // does not regenerate the whole batch.
    const retryGroupCount = resultGroupReferences.length;
    const perGroupCount = Math.max(1, Math.round(activeResultExpectedCount / Math.max(1, retryGroupCount)));
    const retryGroupIndex = retryResultIndex !== null && retryGroupCount > 1
      ? Math.min(retryGroupCount - 1, Math.max(0, Math.floor(retryResultIndex / perGroupCount)))
      : null;
    const retryReferenceUrl = retryGroupIndex !== null ? resultGroupReferences[retryGroupIndex]?.url : null;
    const requestMultiplier = retryGroupIndex !== null ? 1 : shouldSplit ? referenceImages.length : 1;
    const displayExpectedCount = getRetryDisplayExpectedCount({
      retryIndex: retryResultIndex,
      currentExpectedCount: activeResultExpectedCount,
      previousUrls: retryPreviousResultUrls,
      fallbackExpectedCount: runExpectedCount,
    });
    // Total images the UI should reserve (grid slots, run bar, cost):
    // split runs produce genCount images per reference; retries keep the
    // already-displayed total instead of multiplying again.
    const displayTotalExpectedCount = retryResultIndex !== null
      ? displayExpectedCount
      : displayExpectedCount * requestMultiplier;
    const runTotalCost = costPerImage * runExpectedCount * requestMultiplier;
    if (credits !== null && credits < runTotalCost) {
      showInsufficientCreditsToast({ required: runTotalCost, balance: credits, onRecharge: () => router.push("/pricing") });
      return;
    }

    setActiveQueueTask(null);
    setIsGenerating(true);
    setProgress(8);
    setError("");
    if (retryResultIndex === null) {
      setResultGroupReferences(shouldSplit ? referenceImages.map((item) => ({ ...item })) : []);
    }
    setResultUrls(buildRetryPendingResultUrls(retryPreviousResultUrls, retryResultIndex, displayTotalExpectedCount));
    if (options.toastMessage) toast.info(options.toastMessage);
    const provisionalTask = taskQueue.startTask({
      expectedCount: displayTotalExpectedCount,
      inputThumbnails: taskInputThumbnails,
      progress: 8,
    });
    selectDisplayedTask(provisionalTask.id);
    setActiveQueueTask(provisionalTask);
    let activeTaskId = provisionalTask.id;
    try {
      const res = await fetch("/api/general-image", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `generation-${activeTaskId}` },
        body: JSON.stringify({
          mode,
          prompt,
          reference_urls: retryReferenceUrl !== null
            ? [retryReferenceUrl]
            : isImageMode
              ? referenceImages.map((item) => item.url)
              : [],
          ai_model: aiModel,
          aspect_ratio: aspectRatio,
          image_size: imageSize,
          one_per_reference: retryGroupIndex !== null ? false : shouldSplit,
          gen_count: runGenCount,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          taskQueue.removeTask(activeTaskId);
          setActiveQueueTask(null);
          setIsGenerating(false);
          await refreshAuth();
          router.push("/login");
          return;
        }
        // 402 仅在服务端返回数字余额时更新（?? 0 会把真实余额清零并持久化缓存）；其余非 ok 抛服务端错误
        applyGenerationResponseStatus({ res, data, userId, setCredits, fallbackError: t("generateFailed") });
      }
      if (data.credits_remaining !== undefined) {
        setCredits(data.credits_remaining);
        if (userId) setCachedProfileCredits(userId, data.credits_remaining);
      }

      if (typeof data.generation_id === "string" && data.generation_id) {
        const serverTask = taskQueue.replaceWithServerTask(activeTaskId, {
          id: data.generation_id,
          expectedCount: displayTotalExpectedCount,
          inputThumbnails: taskInputThumbnails,
          status: data.status || "processing",
          progress: 12,
        });
        selectDisplayedTask(serverTask.id);
        setActiveQueueTask(serverTask);
        activeTaskId = serverTask.id;
      }
      setCleanDraftSignature(currentDraftSignature);

      // 后台轮询：useGenerationPolling 替代原 inline for-loop
      pollCtxRef.current = {
        activeTaskId,
        generationId: typeof data.generation_id === "string" ? data.generation_id : "",
        displayExpectedCount: displayTotalExpectedCount,
        retryPreviousResultUrls,
        retryResultIndex,
        taskInputThumbnails: taskInputThumbnails,
        latestTaskResultUrlsRef: { current: [] },
        setProgress,
        setResultUrls,
        setIsGenerating,
        setError,
        setActiveQueueTask,
        refreshCredits,
        taskQueue,
        isImageMode,
      };
      startGeneralImagePolling();
    } catch (err: unknown) {
      const message = summarizeGenerationError(err instanceof Error ? err.message : t("generateFailed"));
      setError(message);
      const failedTask = taskQueue.markFailed(activeTaskId, message, {
        expectedCount: displayTotalExpectedCount,
        inputThumbnails: taskInputThumbnails,
        resultThumbnails: pollCtxRef.current?.latestTaskResultUrlsRef.current ?? [],
        resultCount: pollCtxRef.current?.latestTaskResultUrlsRef.current.filter(Boolean).length ?? 0,
      });
      setActiveQueueTask(failedTask);
      toast.error(message);
      void refreshCredits();
      setIsGenerating(false);
    }
  }

  async function handleRunningTask(item: TaskQueueItem, session: TaskSelectionSession) {
    // Stop the previous task poll from writing into the selected preview, and
    // keep all task-specific UI hidden until its grouping metadata is ready.
    selectDisplayedTask(item.id);
    setRestoringTaskId(item.id);
    try {
      const detail = await fetchHistoryApplyDetail(item.id, "generalImage", session.signal);
      if (!session.isCurrent()) return true;
      if (detail.payload.mode !== mode) {
        setRestoringTaskId((current) => current === item.id ? null : current);
        return false;
      }
      applyGeneralImageHistoryPayload(detail.payload, safeTaskQueueUrls(item.resultThumbnails), {
        silent: true,
        task: item,
      });
      setIsGenerating(true);
      setProgress(Math.min(Math.max(Math.round(Number(item.progress) || 12), 1), 99));
      setRestoringTaskId((current) => current === item.id ? null : current);
      return true;
    } catch (err) {
      if (session.signal.aborted || !session.isCurrent()) return true;
      console.warn("[general-image] failed to restore running task grouping", err);
      // The queue snapshot cannot recover split grouping. Use it only when the
      // detailed payload fails, after the previous task has already been hidden.
      setActiveQueueTask(item);
      setIsGenerating(true);
      setProgress(Math.min(Math.max(Math.round(Number(item.progress) || 12), 1), 99));
      setError("");
      setResultUrls(safeTaskQueueUrls(item.resultThumbnails));
      setResultGroupReferences([]);
      setRestoringTaskId((current) => current === item.id ? null : current);
      return true;
    }
  }

  async function handleCompletedTask(item: TaskQueueItem, session: TaskSelectionSession) {
    // Completed rows also need their detailed payload before rendering because
    // the queue snapshot does not include split-group metadata.
    selectDisplayedTask(item.id);
    setRestoringTaskId(item.id);
    try {
      const detail = await fetchHistoryApplyDetail(item.id, "generalImage", session.signal);
      if (!session.isCurrent()) return true;
      if (detail.payload.mode !== mode) {
        setRestoringTaskId((current) => current === item.id ? null : current);
        const href = getApplyPath(detail.payload, item.id);
        return requestStudioNavigation(href, () => router.push(href));
      }
      applyGeneralImageHistoryPayload(detail.payload, detail.resultUrls.length ? detail.resultUrls : safeTaskQueueUrls(item.resultThumbnails), {
        silent: session.reason === "restore",
        task: item,
      });
      if (item.statusGroup === "failed" || isHistoryApplyRowFailed(detail.row)) {
        setError(getHistoryApplyFailureMessage(detail.row, item.error || t("generateFailed")));
      }
      setRestoringTaskId((current) => current === item.id ? null : current);
      return true;
    } catch (err) {
      if (session.signal.aborted || !session.isCurrent()) return true;
      setActiveQueueTask(item);
      setIsGenerating(false);
      setProgress(item.statusGroup === "completed" ? 100 : Math.min(Math.max(Math.round(Number(item.progress) || 0), 0), 99));
      setResultUrls(safeTaskQueueUrls(item.resultThumbnails));
      setResultGroupReferences([]);
      setError(item.statusGroup === "failed" ? item.error : "");
      setRestoringTaskId((current) => current === item.id ? null : current);
      toast.error(err instanceof Error ? err.message : t("historyLoadFailed"));
      return true;
    }
  }

  return (
    <div className="studio-workbench studio-general-image-workbench min-h-[calc(100dvh-64px)] lg:h-[calc(100vh-64px)] flex flex-col lg:flex-row" data-mode={mode}>
      <FeatureTabs active={activeFeature} />
      <ModuleTaskRail module="generalImage" taskScope={mode} moduleLabel={t("moduleLabel")} onContinue={handleContinueCreate} onRunningTask={handleRunningTask} onCompletedTask={handleCompletedTask} />
      <div className="studio-parameters studio-general-image-parameters w-full lg:w-[472px] border-b lg:border-b-0 lg:border-r flex flex-col overflow-visible lg:overflow-hidden">
        <div className="studio-parameters-scroll studio-general-image-parameters-scroll flex-1 overflow-visible lg:overflow-y-auto p-3 sm:p-5 space-y-4 sm:space-y-6">
          <ModuleHeader
            title={modeMeta.title}
            tooltip={modeMeta.tooltip}
          />

          {isImageMode && (
            <StudioUploadSection
              title={t("referenceSectionTitle")}
              inputRef={fileInputRef}
              multiple
              isDragging={isDragging}
              setDragging={setIsDragging}
              onFiles={async (files) => {
                await handleFiles(files);
              }}
              className="studio-general-reference-upload"
            >
              {(openFileDialog) => (
                <MultiImageUploadV2
                  urls={referenceImages.map((item) => item.preview || item.url)}
                  maxCount={referenceUploadLimit}
                  title={t("referenceSectionTitle")}
                  showExamples={false}
                  descriptionSlot={(
                    <span>
                      {t("uploadDescriptionSlot")} {" "}
                      <Link
                        href="/all-category-product-image"
                        className="inline-flex items-center gap-1"
                      >
                        {t("uploadDescriptionLink")}
                        <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
                      </Link>
                    </span>
                  )}
                  description={t("uploadTileDescription")}
                  footnote={t("uploadFootnote")}
                  imageRequirement={t("orderMarkedAsImages")}
                  tips={[
                    { text: t("uploadTipText") },
                    { text: t("uploadResolutionTip") },
                  ]}
                  imageFit="cover"
                  loading={isUploading}
                  isDragging={isDragging}
                  libraryLabel={t("libraryLabel")}
                  onUploadClick={openFileDialog}
                  onLibraryClick={async () => {
                    const assets = await openResourcePicker({
                      title: t("referenceSectionTitle"),
                      role: "reference",
                      selectionMode: "multiple",
                      maxCount: referenceUploadLimit,
                      existingCount: referenceImages.length,
                      excludedUrls: referenceImages.map((item) => item.url),
                      mediaTypes: ["image"],
                      moduleKey: "generalImage",
                    });
                    if (!assets?.length) return;
                    setReferenceImages((current) => {
                      const existing = new Set(current.map((item) => item.url));
                      const added = assets
                        .filter((asset) => !existing.has(asset.url))
                        .map((asset) => ({
                          id: `resource-${asset.id}`,
                          name: asset.title || t("referenceImage"),
                          url: asset.url,
                          preview: asset.previewUrl || asset.thumbnailUrl || asset.url,
                        }));
                      return [...current, ...added].slice(0, referenceUploadLimit);
                    });
                  }}
                  onPreview={(url) => setReferenceLightboxSrc(url)}
                  onRemove={(_, index) => {
                    setReferenceImages((prev) => prev.filter((__, itemIndex) => itemIndex !== index));
                  }}
                  onClear={() => setReferenceImages([])}
                />
              )}
            </StudioUploadSection>
          )}

          {isImageMode && (
            <StudioToggleRow
              title={t("onePerReferenceLabel")}
              description={t("onePerReferenceHint")}
              checked={onePerReference}
              onChange={(checked) => {
                if (checked && referenceImages.length > MAX_GENERAL_IMAGE_SPLIT_REFERENCES) {
                  toast.error(`${t("onePerReferenceLabel")}：${tShared("maxCountBadge", { maxCount: MAX_GENERAL_IMAGE_SPLIT_REFERENCES })}`);
                  return;
                }
                setOnePerReference(checked);
              }}
              disabled={referenceImages.length < 2}
              ariaLabel={t("onePerReferenceLabel")}
            />
          )}

          <div>
            <PromptTextarea
              title={t("textDescriptionTitle")}
              value={prompt}
              maxLength={4000}
              onChange={(event) => { setPrompt(event.target.value.slice(0, 4000)); }}
              placeholder={isImageMode ? t(IMAGE_PROMPT_PLACEHOLDER_KEY) : t("textPlaceholder")}
              rows={6}
              hasAiAssistant
              isOptimizing={isOptimizing}
              onOptimizePrompt={optimizePrompt}
              onClear={() => { setPrompt(""); resetOutput(); }}
              onSubmitOnEnter={() => { if (prompt.trim() && !isGenerating) void generate(); }}
              className="studio-general-image-prompt"
            />
            {!isImageMode && (
              <button
                ref={imagePromptTriggerRef}
                type="button"
                onClick={() => setShowImagePromptModal(true)}
                className="studio-button studio-button-compact mt-2"
              >
                <ImagePlus className="h-3.5 w-3.5" />
                {t("imageToPromptButton")}
              </button>
            )}
          </div>

          <StudioModelSelector
            models={modelOptions}
            value={aiModel}
            onChange={setAiModel}
            ariaLabel={t("modelAriaLabel")}
            className="studio-general-image-model-selector"
          />

          <section>
            <AspectRatioSelector
              options={ASPECTS.map((item) => ({
                value: item.value,
                label: item.labelKey ? t(item.labelKey) : item.label,
              }))}
              value={aspectRatio}
              onChange={setAspectRatio}
              titleKey="GeneralImage.ratioSectionTitle"
              ariaLabel={t("ratioAriaLabel")}
            />
          </section>

          <section>
            <ResolutionSelector
              title={t("resolutionSectionTitle")}
              options={supportedSizes.map((size) => ({
                value: size,
                label: size,
                description: t("resolutionCostDescription", { cost: getCreditCost(aiModel, size, aspectRatio) }),
              }))}
              value={imageSize}
              onChange={setImageSize}
              ariaLabel={t("resolutionAriaLabel")}
            />
          </section>

          <section>
            <GenerationCountField
              title={t("countSectionTitle")}
              label={t("countSectionTitle")}
              value={genCount}
              onChange={setGenCount}
              ariaLabel={t("countAriaLabel")}
            />
          </section>
        </div>

        <StudioRunBar
          summary={`${isImageMode ? t("summaryImageToImage", { count: referenceImages.length }) : t("summaryTextToImage")} · ${costPerImage} × ${effectiveGenCount}`}
          estimateLabel={isGenerating ? t("runBar.estimateGenerating") : t("runBar.estimateReady", { count: effectiveGenCount })}
          costLabel={authIsAnonymous ? t("costLoginView") : t("costLabel", { cost: effectiveTotalCost, balance: credits ?? "-" })}
          disabled={!canGenerate}
          disabledReason={runDisabledReason}
          primaryLabel={authIsAnonymous ? t("primaryLogin") : isGenerating ? t("primaryGenerating") : t("primaryGenerate", { count: effectiveGenCount })}
          isLoading={isGenerating}
          onPrimaryAction={generate}
        />
      </div>

      <div className="studio-canvas min-h-[260px] sm:min-h-[360px] lg:min-h-0 flex-1 relative overflow-hidden mt-3 mb-6 lg:mt-0 lg:mb-0">
        {restoringTaskId && (
          <div
            className="studio-task-restore-stage flex min-h-[260px] items-center justify-center px-4 sm:min-h-[360px] lg:h-full"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <TaskSwitchLoading label={tShared("loadingDots")} />
          </div>
        )}

        {!restoringTaskId && !isGenerating && resultUrls.length === 0 && !error && !activeQueueTask && (
          <div className="studio-empty-stage min-h-[260px] overflow-y-auto px-4 py-6 sm:min-h-[360px] lg:h-full">
            <div className="studio-general-empty-content">
              <PreviewGuide
                title={modeMeta.emptyTitle}
                subtitle={modeMeta.emptySubtitle}
                imageSrc={modeMeta.emptyImage}
                imageFit={modeMeta.emptyImageFit}
                imagePriority
                presentation="hero-image"
                imageAlt={isImageMode ? t("guideImageAltImageToImage") : t("guideImageAltTextToImage")}
                steps={[]}
                variant="editorial"
              />
              <StudioShowcaseGallery module={showcaseModule} onCreateSimilar={handleCreateSimilar} />
            </div>
          </div>
        )}

        {!restoringTaskId && isGenerating && resultUrls.length === 0 && !activeQueueTask && (
          <LoadingStage
            genCount={activeQueueTask ? clampTaskExpectedCount(activeQueueTask, 1, MAX_GENERAL_IMAGE_TOTAL_COUNT, effectiveGenCount) : effectiveGenCount}
            progress={progress}
            moduleName={modeMeta.title}
            referenceImages={referenceImages.map((item, index) => ({ label: item.name || t("referenceImageLabel", { index: index + 1 }), url: item.preview || item.url }))}
            metaItems={[aspectRatio, imageSize, isImageMode ? t("summaryImageToImage", { count: referenceImages.length }) : t("summaryTextToImage")]}
          />
        )}
        {!restoringTaskId && ((isGenerating && resultUrls.length > 0) || resultUrls.length > 0 || Boolean(activeQueueTask)) && (
          <div className="studio-result-stage min-h-[260px] sm:min-h-[360px] overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:h-full flex flex-col">
            <div className="flex min-h-0 flex-1 items-start justify-start">
              {isImageMode && resultGroupReferences.length > 1 ? (
                <div className="flex w-full flex-col gap-6">
                  {resultGroupReferences.map((reference, groupIndex) => {
                    const perGroupCount = Math.max(1, Math.round(activeResultExpectedCount / resultGroupReferences.length));
                    const start = groupIndex * perGroupCount;
                    const groupUrls = resultUrls.slice(start, start + perGroupCount);
                    const groupFailedCount = Math.max(0, perGroupCount - groupUrls.filter(Boolean).length);
                    return (
                      <ResultImageGrid
                        key={`general-image-group-${groupIndex}-${reference.url}`}
                        urls={groupUrls}
                        filenamePrefix="image-to-image"
                        expectedCount={perGroupCount}
                        downloadUrls={groupIndex === 0 ? resultUrls : undefined}
                        downloadExpectedCount={activeResultExpectedCount}
                        showDownloadAction={groupIndex === 0}
                        isGenerating={isGenerating}
                        inputReferences={[{ url: reference.preview || reference.url, label: t("referenceImageLabel", { index: groupIndex + 1 }) }]}
                        createdAt={activeQueueTask?.createdAt}
                        statusGroup={activeQueueTask?.statusGroup || (isGenerating ? "running" : undefined)}
                        variant="task"
                        resourceFavorite={{ generationId: displayedTaskId || undefined, moduleKey: "generalImage", mediaType: "image", resultIndexOffset: start }}
                        failureLabel={t("failedLabel")}
                        failureDetail={activeQueueTask?.statusGroup === "failed" ? buildFailedTaskDetail(activeQueueTask.error || error || undefined) : undefined}
                        markMissingAsFailed={hasCompletedPartialResults}
                        missingFailureLabel={t("missingFailLabel")}
                        missingFailureDetail={groupFailedCount > 0 ? buildPartialFailureDetail({ message: activeQueueTask?.error, failedCount: groupFailedCount }) : undefined}
                        missingFailureActionLabel={t("retryThis")}
                        onMissingFailureAction={(index) => handleRetryFailedResult(start + index)}
                        missingFailureActionDisabled={retryDisabled}
                        onOpen={(_, index) => setPreviewIndex(start + index)}
                        tileAspectRatio={aspectRatio}
                      />
                    );
                  })}
                </div>
              ) : (
                <ResultImageGrid
                  urls={resultUrls}
                  filenamePrefix={isImageMode ? "image-to-image" : "text-to-image"}
                  expectedCount={activeResultExpectedCount}
                  isGenerating={isGenerating}
                  inputThumbnails={isImageMode ? (safeTaskQueueUrls(activeQueueTask?.inputThumbnails).length ? safeTaskQueueUrls(activeQueueTask?.inputThumbnails) : referenceImages.map((item) => item.preview || item.url)) : []}
                  createdAt={activeQueueTask?.createdAt}
                  statusGroup={activeQueueTask?.statusGroup || (isGenerating ? "running" : undefined)}
                  variant="task"
                  resourceFavorite={{ generationId: displayedTaskId || undefined, moduleKey: "generalImage", mediaType: "image" }}
                  failureLabel={t("failedLabel")}
                  failureDetail={activeQueueTask?.statusGroup === "failed" ? buildFailedTaskDetail(activeQueueTask.error || error || undefined) : undefined}
                  markMissingAsFailed={hasCompletedPartialResults}
                  missingFailureLabel={t("missingFailLabel")}
                  missingFailureDetail={partialFailureMessage}
                  missingFailureActionLabel={t("retryThis")}
                  onMissingFailureAction={handleRetryFailedResult}
                  missingFailureActionDisabled={retryDisabled}
                  onOpen={(_, index) => setPreviewIndex(index)}
                  tileAspectRatio={aspectRatio}
                />
              )}
            </div>
            <StudioImagePreviewDialog
              open={previewIndex !== null}
              onClose={() => setPreviewIndex(null)}
              session={previewSession}
              selectedIndex={previewIndex || 0}
              onSelectedIndexChange={setPreviewIndex}
              filenamePrefix={isImageMode ? "image-to-image" : "text-to-image"}
              actions={GENERAL_IMAGE_PREVIEW_ACTIONS.map((action) => ({ ...action, label: action.labelKey ? t(action.labelKey) : action.label }))}
              onRegenerateAll={resetOutput}
            />
          </div>
        )}

        {!restoringTaskId && error && !activeQueueTask && (
          <ErrorStage
            error={summarizeGenerationError(error)}
            onRetry={() => generate()}
            isGenerating={isGenerating}
            retryDisabled={retryDisabled}
            retryLabel={t("retryGenerate")}
            notice={FAILED_RETRY_NOTICE}
          />
        )}
      </div>

      <ImagePromptDialog
        open={showImagePromptModal}
        onOpenChange={setShowImagePromptModal}
        fileInputRef={imagePromptInputRef}
        returnFocusRef={imagePromptTriggerRef}
        image={imagePromptImage}
        text={imagePromptText}
        isUploading={isImagePromptUploading}
        isGenerating={isImagePromptGenerating}
        onUpload={uploadImageForPrompt}
        onGenerate={() => void generateImagePrompt()}
        onTextChange={setImagePromptText}
        onApply={applyImagePromptToDescription}
      />
      <StudioMediaLightbox
        src={referenceLightboxSrc}
        alt={t("referenceImageAlt")}
        onClose={() => setReferenceLightboxSrc(null)}
      />
      {unsavedDialog}
      {confirmDialog}
    </div>
  );
}
