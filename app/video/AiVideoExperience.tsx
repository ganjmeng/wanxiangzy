"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  Clapperboard,
  ImagePlus,
  Maximize2,
  Play,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { FeatureTabs } from "@/components/FeatureTabs";
import { ModuleHeader } from "@/components/ModuleHeader";
import { PreviewGuide } from "@/components/PreviewGuide";
import { ResultVideoGrid } from "@/components/ResultVideoGrid";
import { ModuleTaskRail } from "@/components/studio/ModuleTaskRail";
import { RawPreviewImage } from "@/components/studio/RawPreviewImage";
import { StudioOptionGrid, StudioToggleRow } from "@/components/studio/StudioFormControls";
import { PromptTextarea } from "@/components/studio/PromptTextarea";
import { AspectRatioSelector } from "@/components/studio/AspectRatioSelector";
import { ResolutionSelector } from "@/components/studio/ResolutionSelector";
import { GenerationCountField } from "@/components/studio/GenerationCountField";
import { StudioRunBar } from "@/components/studio/StudioRunBar";
import { StudioSideDrawer } from "@/components/studio/StudioSideDrawer";
import { StudioMediaLightbox } from "@/components/studio/StudioMediaLightbox";
import { StudioUploadTile } from "@/components/studio/StudioUploadTile";
import { StudioVideoUploadTile } from "@/components/studio/StudioVideoUploadTile";
import { useStableFileDrag } from "@/components/studio/useStableFileDrag";
import { useStudioAuth } from "@/components/studio/useStudioAuth";
import type { TaskSelectionSession } from "@/components/studio/useTaskSelectionSession";
import { useTaskQueueGeneration } from "@/components/studio/useTaskQueueGeneration";
import { assetUrls, useResourcePicker } from "@/features/resource-library";
import {
  AI_VIDEO_ACTION_TEMPLATES,
  AI_VIDEO_ASPECT_RATIO_OPTIONS,
  AI_VIDEO_DEFAULT_AUDIO_MODE,
  AI_VIDEO_DEFAULT_DURATION,
  AI_VIDEO_DEFAULT_FIXED_ASPECT_RATIO,
  getClosestAiVideoAspectRatio,
  getAiVideoKind,
  getAiVideoPath,
  normalizeAiVideoAspectRatio,
  normalizeAiVideoAudioMode,
  normalizeAiVideoDuration,
  normalizeAiVideoFixedAspectRatio,
  normalizeAiVideoGenCount,
  normalizeAiVideoModelMode,
  normalizeAiVideoResolution,
  type AiVideoActionTemplate,
  type AiVideoAudioMode,
  type AiVideoAspectRatio,
  type AiVideoDuration,
  type AiVideoFixedAspectRatio,
  type AiVideoMode,
  type AiVideoModelMode,
  type AiVideoResolution,
} from "@/lib/ai-video";
import {
  calculateVideoCreditCost,
  getVideoCreditCost,
  getVideoDefaultMode,
  getVideoDefaultResolution,
  getVideoDurationOptions,
  getVideoModes,
  getVideoResolutions,
  resolveVideoSelection,
  VIDEO_PROVIDER_DESCRIPTIONS,
  VIDEO_PROVIDER_LABELS,
  type VideoProviderName,
} from "@/lib/api/video-catalog";
import { fetchHistoryApplyDetail, getHistoryApplyFailureMessage, isHistoryApplyRowFailed, takeApplyDetail, type HistoryJobPayload } from "@/lib/history-apply";
import { setCachedProfileCredits } from "@/lib/supabase/client";
import { safeTaskQueueUrls, type TaskQueueItem } from "@/lib/task-queue";
import { takeSourceImageFromLocation } from "@/lib/studio-image-preview";
import { applyGenerationResponseStatus, showInsufficientCreditsToast } from "@/lib/ui/credit-copy";
import {
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_MB,
  MAX_VIDEO_FILE_SIZE,
  MAX_VIDEO_FILE_SIZE_MB,
  uploadImage,
  uploadVideo,
} from "@/lib/utils";

const VIDEO_GENERATION_POLL_TIMEOUT_MS = 20 * 60 * 1000;
const VIDEO_GENERATION_POLL_FAST_WINDOW_MS = 60 * 1000;
const VIDEO_GENERATION_POLL_FAST_MS = 4 * 1000;
const VIDEO_GENERATION_POLL_SLOW_MS = 7 * 1000;

type VideoImagePayload = Extract<HistoryJobPayload, { kind: "videoImageToVideo" }>;
type VideoMotionPayload = Extract<HistoryJobPayload, { kind: "videoMotion" }>;
type VideoFirstLastPayload = Extract<HistoryJobPayload, { kind: "videoFirstLastFrame" }>;
type VideoPricingMap = Partial<Record<VideoProviderName, Record<string, { minimum: number; perSecond: number }>>>;

type AiVideoExperienceProps = {
  mode: AiVideoMode;
};

function normalizeHappyHorseUiAudioMode(value: unknown): AiVideoAudioMode {
  const audioMode = normalizeAiVideoAudioMode(value);
  return audioMode === "custom" ? "generated" : audioMode;
}

export function AiVideoExperience({ mode }: AiVideoExperienceProps) {
  const router = useRouter();
  const t = useTranslations("Video");
  const { openResourcePicker } = useResourcePicker();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const modelImageInputRef = useRef<HTMLInputElement>(null);
  const firstFrameInputRef = useRef<HTMLInputElement>(null);
  const lastFrameInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const generationRunRef = useRef(0);
  const submitLockRef = useRef(false);
  const isMotion = mode === "motion-control";
  const isFirstLastFrame = mode === "first-last-frame";
  const generationKind = getAiVideoKind(mode);
  const featureKey = isFirstLastFrame ? "videoFirstLastFrame" : isMotion ? "videoMotion" : "videoImageToVideo";
  const moduleTitle = isFirstLastFrame ? t("moduleFirstLastFrame") : isMotion ? t("moduleMotionControl") : t("moduleImageToVideo");
  const moduleLabel = moduleTitle;
  const apiPath = isFirstLastFrame ? "/api/video/first-last-frame" : isMotion ? "/api/video/motion-control" : "/api/video/image-to-video";
  const applyPath = getAiVideoPath(generationKind);

  const { authChecked, isAuthenticated, userId, credits, setCredits, refreshAuth } = useStudioAuth();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/video/options", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const providerEntries = Array.isArray(data?.providers)
          ? (data.providers as Array<{ provider: VideoProviderName; pricingByMode?: Record<string, { minimum: number; perSecond: number }> }>)
          : [];
        const providers = providerEntries
          .map((item) => item.provider)
          .filter((item): item is VideoProviderName => ["minimax", "seedance", "seedance25", "wan"].includes(item));
        if (providers.length) {
          setAvailableProviders(providers);
          setVideoProvider((current) => current && providers.includes(current) ? current : providers[0]);
          setVideoPricing(Object.fromEntries(providerEntries.map((item) => [item.provider, item.pricingByMode || {}])) as VideoPricingMap);
        }
      } catch {
        // keep defaults when options are unavailable
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const [imageUrl, setImageUrl] = useState("");
  const [modelImageUrl, setModelImageUrl] = useState("");
  const [firstFrameUrl, setFirstFrameUrl] = useState("");
  const [lastFrameUrl, setLastFrameUrl] = useState("");
  const [referenceVideoUrl, setReferenceVideoUrl] = useState("");
  const [imageRatio, setImageRatio] = useState<AiVideoFixedAspectRatio | null>(null);
  const [modelImageRatio, setModelImageRatio] = useState<AiVideoFixedAspectRatio | null>(null);
  const [firstFrameRatio, setFirstFrameRatio] = useState<AiVideoFixedAspectRatio | null>(null);
  const [lastFrameRatio, setLastFrameRatio] = useState<AiVideoFixedAspectRatio | null>(null);
  const [prompt, setPrompt] = useState(isFirstLastFrame ? "" : isMotion ? "" : AI_VIDEO_ACTION_TEMPLATES[0]?.promptContent || "");
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(isFirstLastFrame || isMotion ? null : AI_VIDEO_ACTION_TEMPLATES[0]?.id || null);
  const [modelMode, setModelMode] = useState<AiVideoModelMode>("pro");
  const [resolution, setResolution] = useState<AiVideoResolution>("720p");
  const [videoProvider, setVideoProvider] = useState<VideoProviderName | null>(null);
  const [availableProviders, setAvailableProviders] = useState<VideoProviderName[]>([]);
  const [videoPricing, setVideoPricing] = useState<VideoPricingMap>({});
  const [aspectRatio, setAspectRatio] = useState<AiVideoAspectRatio>("auto");
  const [duration, setDuration] = useState<AiVideoDuration>(AI_VIDEO_DEFAULT_DURATION);
  const [audioMode, setAudioMode] = useState<AiVideoAudioMode>(AI_VIDEO_DEFAULT_AUDIO_MODE);
  const [audioPrompt, setAudioPrompt] = useState("");
  const [genCount, setGenCount] = useState(1);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [isDraggingModelImage, setIsDraggingModelImage] = useState(false);
  const [isDraggingFirstFrame, setIsDraggingFirstFrame] = useState(false);
  const [isDraggingLastFrame, setIsDraggingLastFrame] = useState(false);
  const [isDraggingVideo, setIsDraggingVideo] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isUploadingModelImage, setIsUploadingModelImage] = useState(false);
  const [isUploadingFirstFrame, setIsUploadingFirstFrame] = useState(false);
  const [isUploadingLastFrame, setIsUploadingLastFrame] = useState(false);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultUrls, setResultUrls] = useState<string[]>([]);
  const [activeGenerationId, setActiveGenerationId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [templatePanelOpen, setTemplatePanelOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [lightboxVideo, setLightboxVideo] = useState<string | null>(null);

  const taskQueue = useTaskQueueGeneration({
    module: generationKind,
    title: moduleTitle,
    defaultExpectedCount: genCount,
    applyPath,
  });
  const authIsAnonymous = authChecked && !isAuthenticated;
  const providerKey: VideoProviderName = videoProvider ?? "minimax";
  const effectiveModelMode = isFirstLastFrame ? "pro" : modelMode;
  const generateAudio = audioMode !== "off";
  const detectedAspectRatio = isFirstLastFrame
    ? firstFrameRatio || lastFrameRatio
    : isMotion
      ? modelImageRatio
      : imageRatio;
  const effectiveAspectRatio = aspectRatio === "auto"
    ? detectedAspectRatio || AI_VIDEO_DEFAULT_FIXED_ASPECT_RATIO
    : normalizeAiVideoFixedAspectRatio(aspectRatio);
  const aspectRatioSummary = aspectRatio === "auto" ? `${t("aspectAuto")}(${effectiveAspectRatio})` : effectiveAspectRatio;
  const resolutionOptions = useMemo(
    () => getVideoResolutions(providerKey, effectiveModelMode).map((item) => {
      const price = videoPricing[providerKey]?.[`${effectiveModelMode}:${item.value}`];
      return {
        value: item.value,
        label: item.label,
        description: price ? `${item.label} · ${price.perSecond} 灵点/秒` : item.description,
      };
    }),
    [providerKey, effectiveModelMode, videoPricing]
  );
  const cost = getDisplayedVideoCreditCost({ provider: providerKey, modelMode: effectiveModelMode, resolution, duration, genCount, audioMode }, videoPricing);
  const inputThumbnails = isFirstLastFrame
    ? [firstFrameUrl, lastFrameUrl].filter(Boolean)
    : isMotion
    ? [modelImageUrl, referenceVideoUrl].filter(Boolean)
    : [imageUrl].filter(Boolean);
  const runDisabledReason = isFirstLastFrame
    ? !firstFrameUrl
      ? t("needFirstFrame")
      : !lastFrameUrl
        ? t("needLastFrame")
        : !prompt.trim()
          ? t("needEffectPrompt")
          : credits !== null && credits < cost
            ? t("insufficientCredits", { cost })
            : undefined
    : isMotion
    ? !modelImageUrl
      ? t("needModelImage")
      : !referenceVideoUrl
        ? t("needReferenceVideo")
        : credits !== null && credits < cost
          ? t("insufficientCredits", { cost })
          : undefined
    : !imageUrl
      ? t("needImage")
      : !prompt.trim()
        ? t("needActionPrompt")
        : credits !== null && credits < cost
          ? t("insufficientCredits", { cost })
          : undefined;
  const creditInsufficient = Boolean(runDisabledReason && credits !== null && credits < cost);
  const imageDrag = useStableFileDrag<HTMLDivElement>({
    isDragging: isDraggingImage,
    setDragging: setIsDraggingImage,
    accept: "image/*",
    multiple: false,
    onFiles: (files) => handleImageFile(files[0], "image"),
  });
  const modelImageDrag = useStableFileDrag<HTMLDivElement>({
    isDragging: isDraggingModelImage,
    setDragging: setIsDraggingModelImage,
    accept: "image/*",
    multiple: false,
    onFiles: (files) => handleImageFile(files[0], "model"),
  });
  const firstFrameDrag = useStableFileDrag<HTMLDivElement>({
    isDragging: isDraggingFirstFrame,
    setDragging: setIsDraggingFirstFrame,
    accept: "image/*",
    multiple: false,
    onFiles: (files) => handleImageFile(files[0], "firstFrame"),
  });
  const lastFrameDrag = useStableFileDrag<HTMLDivElement>({
    isDragging: isDraggingLastFrame,
    setDragging: setIsDraggingLastFrame,
    accept: "image/*",
    multiple: false,
    onFiles: (files) => handleImageFile(files[0], "lastFrame"),
  });
  const videoDrag = useStableFileDrag<HTMLDivElement>({
    isDragging: isDraggingVideo,
    setDragging: setIsDraggingVideo,
    accept: "video/mp4,video/quicktime,.mp4,.mov",
    multiple: false,
    onFiles: (files) => handleVideoFile(files[0]),
  });
  const selectedTemplate = useMemo(
    () => AI_VIDEO_ACTION_TEMPLATES.find((item) => item.id === selectedTemplateId) || null,
    [selectedTemplateId]
  );
  const modelModeOptions = useMemo(
    () => getVideoModes(providerKey).map((item) => ({
      value: item.value,
      label: item.label,
      description: isFirstLastFrame && item.value !== "pro" ? t("modelModeFastOnlyDesc") : item.description,
      disabled: isFirstLastFrame && item.value !== "pro",
    })),
    [providerKey, isFirstLastFrame]
  );
  const perVideoCost = getDisplayedVideoCreditCost({ provider: providerKey, modelMode: effectiveModelMode, resolution, duration, audioMode }, videoPricing);

  useEffect(() => {
    if (!videoProvider) return;
    const requestedMode = isFirstLastFrame ? "pro" : normalizeAiVideoModelMode(modelMode, generationKind);
    const requestedResolution = normalizeAiVideoResolution(resolution, requestedMode);
    const selection = resolveVideoSelection(providerKey, requestedMode, requestedResolution);
    if (selection.mode !== modelMode) setModelMode(selection.mode);
    if (selection.resolution !== resolution) setResolution(selection.resolution);
  }, [isFirstLastFrame, modelMode, resolution, videoProvider]);

  useEffect(() => {
    const sourceImage = takeSourceImageFromLocation();
    if (!sourceImage) return;
    if (isFirstLastFrame) {
      setFirstFrameUrl(sourceImage);
      setFirstFrameRatio(null);
      toast.success(t("broughtFirstFrame"));
      return;
    }
    if (isMotion) {
      setModelImageUrl(sourceImage);
      setModelImageRatio(null);
      toast.success(t("broughtModelImage"));
      return;
    }
    setImageUrl(sourceImage);
    setImageRatio(null);
    toast.success(t("broughtPreviewImage"));
  }, [isFirstLastFrame, isMotion]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const detail = await takeApplyDetail(generationKind);
      if (cancelled || !detail?.payload) return;
      applyHistoryPayload(detail.payload, detail.resultUrls, { silent: true });
      if (isHistoryApplyRowFailed(detail.row)) {
        setError(getHistoryApplyFailureMessage(detail.row));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [generationKind]);

  async function handleImageFile(file?: File, target: "image" | "model" | "firstFrame" | "lastFrame" = "image") {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("uploadImageFileError"));
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(t("imageTooLarge", { max: MAX_FILE_SIZE_MB }));
      return;
    }

    setError("");
    setResultUrls([]);
    const setUploading = target === "model"
      ? setIsUploadingModelImage
      : target === "firstFrame"
        ? setIsUploadingFirstFrame
        : target === "lastFrame"
          ? setIsUploadingLastFrame
          : setIsUploadingImage;
    setUploading(true);
    toast.info(t("uploadingImage"));
    try {
      const result = await uploadImage(file);
      const nextRatio = getClosestAiVideoAspectRatio(result.width, result.height);
      if (target === "model") {
        setModelImageUrl(result.url);
        setModelImageRatio(nextRatio);
      } else if (target === "firstFrame") {
        setFirstFrameUrl(result.url);
        setFirstFrameRatio(nextRatio);
      } else if (target === "lastFrame") {
        setLastFrameUrl(result.url);
        setLastFrameRatio(nextRatio);
      } else {
        setImageUrl(result.url);
        setImageRatio(nextRatio);
      }
      toast.success(t("imageUploaded"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("imageUploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  function handleAspectRatioChange(value: string) {
    const nextAspectRatio = normalizeAiVideoAspectRatio(value);
    if (nextAspectRatio === aspectRatio) return;
    setAspectRatio(nextAspectRatio);
  }

  async function handleVideoFile(file?: File) {
    if (!file) return;
    const accepted = file.type === "video/mp4" || file.type === "video/quicktime" || /\.(mp4|mov)$/i.test(file.name);
    if (!accepted) {
      toast.error(t("uploadMp4Mov"));
      return;
    }
    if (file.size > MAX_VIDEO_FILE_SIZE) {
      toast.error(t("videoTooLarge", { max: MAX_VIDEO_FILE_SIZE_MB }));
      return;
    }

    setError("");
    setResultUrls([]);
    setIsUploadingVideo(true);
    toast.info(t("uploadingReferenceVideo"));
    try {
      const result = await uploadVideo(file);
      setReferenceVideoUrl(result.url);
      setSelectedTemplateId(null);
      toast.success(t("referenceVideoUploaded"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("videoUploadFailed"));
    } finally {
      setIsUploadingVideo(false);
    }
  }

  function applyTemplate(template: AiVideoActionTemplate) {
    setSelectedTemplateId(template.id);
    if (isMotion) {
      setReferenceVideoUrl(template.previewVideo);
      setPrompt("");
    } else {
      setPrompt(template.promptContent);
    }
    setTemplatePanelOpen(false);
    setResultUrls([]);
    setError("");
    toast.success(isMotion ? t("appliedSampleReference") : t("appliedActionTemplate"));
  }

  function removeReferenceVideo() {
    setReferenceVideoUrl("");
    setSelectedTemplateId(null);
  }

  function applyFirstLastPromptSuggestion() {
    setSelectedTemplateId(null);
    setPrompt(t("firstLastPromptSuggestion"));
    setResultUrls([]);
    setError("");
  }

  async function generate() {
    if (submitLockRef.current || isSubmitting) {
      toast.info(t("submittingPleaseWait"));
      return;
    }
    if (!isAuthenticated && !(await refreshAuth())) {
      toast.error(t("pleaseLogin"));
      router.push("/login");
      return;
    }
    if (runDisabledReason) {
      if (creditInsufficient) {
        showInsufficientCreditsToast({ required: cost, balance: credits, onRecharge: () => router.push("/pricing") });
      } else {
        toast.error(runDisabledReason);
      }
      return;
    }

    const runId = generationRunRef.current + 1;
    generationRunRef.current = runId;
    const isCurrentRun = () => generationRunRef.current === runId;
    submitLockRef.current = true;
    setIsSubmitting(true);
    setIsGenerating(true);
    setProgress(10);
    setError("");
    setResultUrls([]);

    const provisionalTask = taskQueue.startTask({
      expectedCount: genCount,
      inputThumbnails,
      progress: 10,
    });
    let activeTaskId = provisionalTask.id;
    let latestTaskResultUrls: string[] = [];

    try {
      const requestBody = isFirstLastFrame
        ? {
            firstFrameUrl,
            lastFrameUrl,
            prompt: prompt.trim(),
            modelMode: effectiveModelMode,
            duration,
            resolution,
            aspectRatio: effectiveAspectRatio,
            audioMode,
            audioPrompt: audioPrompt.trim(),
            generateAudio,
            genCount,
            provider: providerKey,
          }
        : isMotion
          ? {
              modelImageUrl,
              referenceVideoUrl,
              prompt: prompt.trim(),
              templateId: selectedTemplateId,
              modelMode: effectiveModelMode,
              duration,
              resolution,
              aspectRatio: effectiveAspectRatio,
              audioMode,
              audioPrompt: audioPrompt.trim(),
              generateAudio,
              genCount,
              provider: providerKey,
            }
          : {
              imageUrl,
              prompt: prompt.trim(),
              templateId: selectedTemplateId,
              modelMode: effectiveModelMode,
              duration,
              resolution,
              aspectRatio: effectiveAspectRatio,
              audioMode,
              audioPrompt: audioPrompt.trim(),
              generateAudio,
              genCount,
              provider: providerKey,
            };
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `generation-${crypto.randomUUID()}` },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          await refreshAuth();
          taskQueue.removeTask(activeTaskId);
          submitLockRef.current = false;
          if (isCurrentRun()) {
            setIsSubmitting(false);
            setIsGenerating(false);
            router.push("/login");
          }
          return;
        }
        // 402 仅在服务端返回数字余额时更新（?? 0 会把真实余额清零并持久化缓存）；其余非 ok 抛服务端错误
        applyGenerationResponseStatus({ res, data, userId, setCredits, fallbackError: t("videoGenerateFailed") });
      }

      if (data.credits_remaining !== undefined) {
        setCredits(data.credits_remaining);
        if (userId) setCachedProfileCredits(userId, data.credits_remaining);
      }
      if (typeof data.generation_id === "string" && data.generation_id) {
        setActiveGenerationId(data.generation_id);
        const serverTask = taskQueue.replaceWithServerTask(activeTaskId, {
          id: data.generation_id,
          expectedCount: genCount,
          inputThumbnails,
          status: data.status || "processing_tryon",
          progress: 25,
        });
        activeTaskId = serverTask.id;
      }
      submitLockRef.current = false;
      if (isCurrentRun()) {
        setProgress(25);
        setIsSubmitting(false);
        toast.success(t("videoSubmitted"));
      }

      let elapsedMs = 0;
      while (elapsedMs < VIDEO_GENERATION_POLL_TIMEOUT_MS) {
        const pollDelayMs = elapsedMs < VIDEO_GENERATION_POLL_FAST_WINDOW_MS
          ? VIDEO_GENERATION_POLL_FAST_MS
          : VIDEO_GENERATION_POLL_SLOW_MS;
        await sleep(pollDelayMs);
        elapsedMs += pollDelayMs;
        const poll = await fetch(`${apiPath}?generation_id=${encodeURIComponent(data.generation_id)}`);
        if (!poll.ok) continue;
        const state = await poll.json();
        const statusGroup = typeof state.status_group === "string" ? state.status_group : "";
        const isRunningStatus = statusGroup === "running" ||
          state.status === "processing_tryon" ||
          state.status === "processing" ||
          state.status === "pending";
        if (isRunningStatus) {
          if (Array.isArray(state.result_urls) && state.result_urls.length) {
            latestTaskResultUrls = state.result_urls;
            if (isCurrentRun()) setResultUrls(state.result_urls);
          }
          const runningProgress = Math.min(Number(state.progress) || 25 + (elapsedMs / VIDEO_GENERATION_POLL_TIMEOUT_MS) * 65, 95);
          if (isCurrentRun()) setProgress(runningProgress);
          taskQueue.markRunning(activeTaskId, {
            expectedCount: genCount,
            inputThumbnails,
            resultThumbnails: latestTaskResultUrls,
            progress: runningProgress,
            status: state.status,
          });
        } else if (state.status === "completed") {
          const finalUrls = Array.isArray(state.result_urls) ? state.result_urls : latestTaskResultUrls;
          if (isCurrentRun()) {
            setProgress(100);
            setResultUrls(finalUrls);
            setIsGenerating(false);
            toast.success(t("videoComplete"));
          }
          taskQueue.markCompleted(activeTaskId, {
            expectedCount: genCount,
            inputThumbnails,
            resultThumbnails: finalUrls,
            resultCount: finalUrls.length,
          });
          return;
        } else if (state.status === "failed") {
          throw new Error(state.error || t("videoGenerateFailed"));
        }
      }

      taskQueue.markRunning(activeTaskId, {
        expectedCount: genCount,
        inputThumbnails,
        resultThumbnails: latestTaskResultUrls,
        progress: 90,
        status: "processing",
      });
      taskQueue.refresh();
      if (isCurrentRun()) {
        setIsGenerating(false);
        setIsSubmitting(false);
        toast.info(t("videoStillGenerating"));
      }
    } catch (err) {
      submitLockRef.current = false;
      const message = err instanceof Error ? err.message : t("videoGenerateFailed");
      taskQueue.markFailed(activeTaskId, message, {
        expectedCount: genCount,
        inputThumbnails,
        resultThumbnails: latestTaskResultUrls,
      });
      if (isCurrentRun()) {
        setError(message);
        if (creditInsufficient) {
          showInsufficientCreditsToast({ required: cost, balance: credits, onRecharge: () => router.push("/pricing") });
        } else {
          toast.error(message);
        }
        setIsSubmitting(false);
        setIsGenerating(false);
      }
    }
  }

  function handleRunningTask(item: TaskQueueItem) {
    setActiveGenerationId(item.id);
    generationRunRef.current += 1;
    submitLockRef.current = false;
    setIsSubmitting(false);
    setIsGenerating(true);
    setProgress(Math.min(Math.max(Math.round(Number(item.progress) || 12), 1), 99));
    setError("");
    setResultUrls(safeTaskQueueUrls(item.resultThumbnails));
  }

  async function handleCompletedTask(item: TaskQueueItem, session: TaskSelectionSession) {
    try {
      const detail = await fetchHistoryApplyDetail(item.id, generationKind, session.signal);
      if (!session.isCurrent()) return true;
      setActiveGenerationId(item.id);
      applyHistoryPayload(detail.payload, detail.resultUrls.length ? detail.resultUrls : safeTaskQueueUrls(item.resultThumbnails), {
        silent: session.reason === "restore",
      });
      if (item.statusGroup === "failed" || isHistoryApplyRowFailed(detail.row)) {
        setError(getHistoryApplyFailureMessage(detail.row, item.error || t("generateFailed")));
      }
      return true;
    } catch (err) {
      if (session.signal.aborted || !session.isCurrent()) return true;
      toast.error(err instanceof Error ? err.message : t("historyLoadFailed"));
      return true;
    }
  }

  function applyHistoryPayload(payload: VideoImagePayload | VideoMotionPayload | VideoFirstLastPayload, historyResultUrls: string[] = [], options?: { silent?: boolean }) {
    generationRunRef.current += 1;
    submitLockRef.current = false;
    if (payload.kind === "videoFirstLastFrame") {
      setFirstFrameUrl(payload.firstFrameUrl);
      setLastFrameUrl(payload.lastFrameUrl);
      setImageUrl("");
      setModelImageUrl("");
      setReferenceVideoUrl("");
      setFirstFrameRatio(null);
      setLastFrameRatio(null);
      setImageRatio(null);
      setModelImageRatio(null);
      setPrompt(payload.prompt);
      setSelectedTemplateId(null);
      setModelMode(normalizeAiVideoModelMode(payload.modelMode, payload.kind));
      setDuration(normalizeAiVideoDuration(payload.duration));
      setResolution(normalizeAiVideoResolution(payload.resolution, normalizeAiVideoModelMode(payload.modelMode, payload.kind)));
      setAspectRatio(normalizeAiVideoAspectRatio(payload.aspectRatio));
      setAudioMode(normalizeHappyHorseUiAudioMode(payload.generateAudio === true ? "generated" : payload.audioMode));
      setAudioPrompt(payload.audioPrompt || "");
      setGenCount(normalizeAiVideoGenCount(payload.genCount));
    } else if (payload.kind === "videoMotion") {
      setFirstFrameUrl("");
      setLastFrameUrl("");
      setModelImageUrl(payload.modelImageUrl);
      setReferenceVideoUrl(payload.referenceVideoUrl);
      setImageUrl("");
      setFirstFrameRatio(null);
      setLastFrameRatio(null);
      setImageRatio(null);
      setModelImageRatio(null);
      setPrompt(payload.prompt || "");
      setSelectedTemplateId(resolveMotionTemplateId(payload.referenceVideoUrl, payload.templateId));
      setModelMode(normalizeAiVideoModelMode(payload.modelMode, payload.kind));
      setDuration(normalizeAiVideoDuration(payload.duration));
      setResolution(normalizeAiVideoResolution(payload.resolution, normalizeAiVideoModelMode(payload.modelMode, payload.kind)));
      setAspectRatio(normalizeAiVideoAspectRatio(payload.aspectRatio));
      setAudioMode(normalizeHappyHorseUiAudioMode(payload.generateAudio === true ? "generated" : payload.audioMode));
      setAudioPrompt(payload.audioPrompt || "");
      setGenCount(normalizeAiVideoGenCount(payload.genCount));
    } else {
      setFirstFrameUrl("");
      setLastFrameUrl("");
      setImageUrl(payload.imageUrl);
      setModelImageUrl("");
      setReferenceVideoUrl("");
      setFirstFrameRatio(null);
      setLastFrameRatio(null);
      setImageRatio(null);
      setModelImageRatio(null);
      setPrompt(payload.prompt);
      setSelectedTemplateId(payload.templateId || null);
      setModelMode(normalizeAiVideoModelMode(payload.modelMode, payload.kind));
      setDuration(normalizeAiVideoDuration(payload.duration));
      setResolution(normalizeAiVideoResolution(payload.resolution, normalizeAiVideoModelMode(payload.modelMode, payload.kind)));
      setAspectRatio(normalizeAiVideoAspectRatio(payload.aspectRatio));
      setAudioMode(normalizeHappyHorseUiAudioMode(payload.generateAudio === true ? "generated" : payload.audioMode));
      setAudioPrompt(payload.audioPrompt || "");
      setGenCount(normalizeAiVideoGenCount(payload.genCount));
    }
    setResultUrls(historyResultUrls);
    setIsSubmitting(false);
    setIsGenerating(false);
    setProgress(historyResultUrls.length ? 100 : 0);
    setError("");
    if (!options?.silent) toast.success(t("historyAppliedToast"));
  }

  function handleContinueCreate() {
    generationRunRef.current += 1;
    submitLockRef.current = false;
    setImageUrl("");
    setModelImageUrl("");
    setFirstFrameUrl("");
    setLastFrameUrl("");
    setReferenceVideoUrl("");
    setImageRatio(null);
    setModelImageRatio(null);
    setFirstFrameRatio(null);
    setLastFrameRatio(null);
    setPrompt(isFirstLastFrame ? "" : isMotion ? "" : AI_VIDEO_ACTION_TEMPLATES[0]?.promptContent || "");
    setSelectedTemplateId(isFirstLastFrame || isMotion ? null : AI_VIDEO_ACTION_TEMPLATES[0]?.id || null);
    setModelMode(videoProvider ? getVideoDefaultMode(videoProvider) : "pro");
    setResolution(videoProvider ? getVideoDefaultResolution(videoProvider, videoProvider ? getVideoDefaultMode(videoProvider) : "pro") : "720p");
    setAspectRatio("auto");
    setDuration(AI_VIDEO_DEFAULT_DURATION);
    setAudioMode(AI_VIDEO_DEFAULT_AUDIO_MODE);
    setAudioPrompt("");
    setGenCount(1);
    setResultUrls([]);
    setActiveGenerationId(null);
    setError("");
    setProgress(0);
    setIsSubmitting(false);
    setIsGenerating(false);
    setTemplatePanelOpen(false);
    setLightboxVideo(null);
  }

  const controlPanel = (
    <div className="studio-parameters-scroll flex-1 overflow-visible p-3 sm:p-5 lg:overflow-y-auto">
      <div className="space-y-4">
        {isFirstLastFrame ? (
          <>
            <section className="rounded-xl bg-[var(--codex-surface-soft)]/90 p-4">
              <div className="mb-3">
                <h3 className="studio-control-title">{t("uploadSectionTitle")}</h3>
                <p className="mt-2 text-[11px] font-semibold leading-5 text-codex-faint">
                  {t("uploadSectionHint", { max: MAX_FILE_SIZE_MB })}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <section {...firstFrameDrag.dragHandlers} className={`rounded-xl transition-[box-shadow] ${isDraggingFirstFrame ? "ring-2 ring-[var(--codex-accent-38)] ring-offset-2" : ""}`}>
                  <input
                    ref={firstFrameInputRef}
                    type="file"
                    accept="image/*"
                    aria-label={t("uploadFirstFrameAria")}
                    className="hidden"
                    onChange={(event) => {
                      const input = event.currentTarget;
                      void handleImageFile(input.files?.[0], "firstFrame").finally(() => {
                        input.value = "";
                      });
                    }}
                  />
                  <StudioUploadTile
                    title={t("uploadFirstFrameTitle")}
                    description={t("clickDragHint")}
                    imageRequirement={t("firstFrameRequirement")}
                    imageUrl={firstFrameUrl || null}
                    imageAlt={t("firstFrameAlt")}
                    isDragging={isDraggingFirstFrame}
                    loading={isUploadingFirstFrame}
                    onUploadClick={() => firstFrameInputRef.current?.click()}
                    onLibraryClick={async () => {
                      const assets = await openResourcePicker({
                        title: t("uploadFirstFrameTitle"),
                        role: "first-frame",
                        selectionMode: "single",
                        maxCount: 1,
                        existingCount: firstFrameUrl ? 1 : 0,
                        excludedUrls: firstFrameUrl ? [firstFrameUrl] : [],
                        mediaTypes: ["image"],
                        moduleKey: "videoFirstLastFrame",
                      });
                      const [url] = assetUrls(assets);
                      if (!url) return;
                      setFirstFrameUrl(url);
                      setFirstFrameRatio(null);
                    }}
                    onPreview={firstFrameUrl ? () => setLightboxImage(firstFrameUrl) : undefined}
                    onRemove={firstFrameUrl ? () => {
                      setFirstFrameUrl("");
                      setFirstFrameRatio(null);
                    } : undefined}
                    libraryLabel={t("libraryLabel")}
                    uploadLabel={t("uploadFirstFrameLabel")}
                  />
                </section>
                <section {...lastFrameDrag.dragHandlers} className={`rounded-xl transition-[box-shadow] ${isDraggingLastFrame ? "ring-2 ring-[var(--codex-accent-38)] ring-offset-2" : ""}`}>
                  <input
                    ref={lastFrameInputRef}
                    type="file"
                    accept="image/*"
                    aria-label={t("uploadLastFrameAria")}
                    className="hidden"
                    onChange={(event) => {
                      const input = event.currentTarget;
                      void handleImageFile(input.files?.[0], "lastFrame").finally(() => {
                        input.value = "";
                      });
                    }}
                  />
                  <StudioUploadTile
                    title={t("uploadLastFrameTitle")}
                    description={t("clickDragHint")}
                    imageRequirement={t("lastFrameRequirement")}
                    imageUrl={lastFrameUrl || null}
                    imageAlt={t("lastFrameAlt")}
                    isDragging={isDraggingLastFrame}
                    loading={isUploadingLastFrame}
                    onUploadClick={() => lastFrameInputRef.current?.click()}
                    onLibraryClick={async () => {
                      const assets = await openResourcePicker({
                        title: t("uploadLastFrameTitle"),
                        role: "last-frame",
                        selectionMode: "single",
                        maxCount: 1,
                        existingCount: lastFrameUrl ? 1 : 0,
                        excludedUrls: lastFrameUrl ? [lastFrameUrl] : [],
                        mediaTypes: ["image"],
                        moduleKey: "videoFirstLastFrame",
                      });
                      const [url] = assetUrls(assets);
                      if (!url) return;
                      setLastFrameUrl(url);
                      setLastFrameRatio(null);
                    }}
                    onPreview={lastFrameUrl ? () => setLightboxImage(lastFrameUrl) : undefined}
                    onRemove={lastFrameUrl ? () => {
                      setLastFrameUrl("");
                      setLastFrameRatio(null);
                    } : undefined}
                    libraryLabel={t("libraryLabel")}
                    uploadLabel={t("uploadLastFrameLabel")}
                  />
                </section>
              </div>
            </section>
          </>
        ) : !isMotion ? (
          <section {...imageDrag.dragHandlers} className={`rounded-xl transition-[box-shadow] ${isDraggingImage ? "ring-2 ring-[var(--codex-accent-38)] ring-offset-2" : ""}`}>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              aria-label={t("uploadImageAria")}
              className="hidden"
              onChange={(event) => {
                const input = event.currentTarget;
                void handleImageFile(input.files?.[0], "image").finally(() => {
                  input.value = "";
                });
              }}
            />
            <StudioUploadTile
              title={t("uploadImageTitle")}
              description={t("uploadImageDesc")}
              imageRequirement={t("imageRequirement")}
              imageUrl={imageUrl || null}
              imageAlt={t("imageToVideoInputAlt")}
              isDragging={isDraggingImage}
              loading={isUploadingImage}
              onUploadClick={() => imageInputRef.current?.click()}
              onLibraryClick={async () => {
                const assets = await openResourcePicker({
                  title: t("uploadImageTitle"),
                  role: "source-image",
                  selectionMode: "single",
                  maxCount: 1,
                  existingCount: imageUrl ? 1 : 0,
                  excludedUrls: imageUrl ? [imageUrl] : [],
                  mediaTypes: ["image"],
                  moduleKey: "videoImageToVideo",
                });
                const [url] = assetUrls(assets);
                if (!url) return;
                setImageUrl(url);
                setImageRatio(null);
                setSelectedTemplateId(null);
              }}
              onPreview={imageUrl ? () => setLightboxImage(imageUrl) : undefined}
              onRemove={imageUrl ? () => {
                setImageUrl("");
                setImageRatio(null);
              } : undefined}
              libraryLabel={t("libraryLabel")}
              uploadLabel={t("uploadClickDragLabel")}
              footnote={t("uploadFootnoteTemplate")}
            />
          </section>
        ) : (
          <>
            <section {...modelImageDrag.dragHandlers} className={`rounded-xl transition-[box-shadow] ${isDraggingModelImage ? "ring-2 ring-[var(--codex-accent-38)] ring-offset-2" : ""}`}>
              <input
                ref={modelImageInputRef}
                type="file"
                accept="image/*"
                aria-label={t("uploadModelImageAria")}
                className="hidden"
                onChange={(event) => {
                  const input = event.currentTarget;
                  void handleImageFile(input.files?.[0], "model").finally(() => {
                    input.value = "";
                  });
                }}
              />
              <StudioUploadTile
                title={t("uploadModelImageTitle")}
                description={t("uploadModelImageDesc")}
                imageRequirement={t("modelImageRequirement")}
                imageUrl={modelImageUrl || null}
                imageAlt={t("modelImageAlt")}
                isDragging={isDraggingModelImage}
                loading={isUploadingModelImage}
                onUploadClick={() => modelImageInputRef.current?.click()}
                onLibraryClick={async () => {
                  const assets = await openResourcePicker({
                    title: t("uploadModelImageTitle"),
                    role: "model-image",
                    selectionMode: "single",
                    maxCount: 1,
                    existingCount: modelImageUrl ? 1 : 0,
                    excludedUrls: modelImageUrl ? [modelImageUrl] : [],
                    mediaTypes: ["image"],
                    moduleKey: "videoMotion",
                  });
                  const [url] = assetUrls(assets);
                  if (!url) return;
                  setModelImageUrl(url);
                  setModelImageRatio(null);
                }}
                onPreview={modelImageUrl ? () => setLightboxImage(modelImageUrl) : undefined}
                onRemove={modelImageUrl ? () => {
                  setModelImageUrl("");
                  setModelImageRatio(null);
                } : undefined}
                libraryLabel={t("libraryLabel")}
                uploadLabel={t("uploadClickDragLabel")}
              />
            </section>
            <section {...videoDrag.dragHandlers} className={`rounded-xl transition-[box-shadow] ${isDraggingVideo ? "ring-2 ring-[var(--codex-accent-38)] ring-offset-2" : ""}`}>
              <input
                ref={videoInputRef}
                type="file"
                accept="video/mp4,video/quicktime,.mp4,.mov"
                className="hidden"
                onChange={(event) => {
                  const input = event.currentTarget;
                  void handleVideoFile(input.files?.[0]).finally(() => {
                    input.value = "";
                  });
                }}
              />
              <StudioVideoUploadTile
                title={t("uploadReferenceVideoTitle")}
                description={t("uploadReferenceVideoDesc")}
                videoUrl={referenceVideoUrl}
                isDragging={isDraggingVideo}
                loading={isUploadingVideo}
                onUploadClick={() => videoInputRef.current?.click()}
                onLibraryClick={async () => {
                  const assets = await openResourcePicker({
                    title: t("uploadReferenceVideoTitle"),
                    role: "motion-video",
                    selectionMode: "single",
                    maxCount: 1,
                    existingCount: referenceVideoUrl ? 1 : 0,
                    excludedUrls: referenceVideoUrl ? [referenceVideoUrl] : [],
                    mediaTypes: ["video"],
                    view: "video",
                    moduleKey: "videoMotion",
                  });
                  const [url] = assetUrls(assets);
                  if (!url) return;
                  setReferenceVideoUrl(url);
                  setSelectedTemplateId(null);
                }}
                onRemove={referenceVideoUrl ? removeReferenceVideo : undefined}
                sourceLabel={selectedTemplate ? t("sampleReferenceVideo", { title: selectedTemplate.title }) : undefined}
                uploadLabel={t("uploadClickLabel")}
                libraryLabel={t("libraryLabel")}
                videoRequirement={t("videoRequirement")}
                tips={[
                  { label: t("tipNoteLabel"), text: t("tipNoteText") },
                  { label: t("tipVideoReqLabel"), text: t("tipVideoReqText") },
                ]}
              />
            </section>
          </>
        )}

        <PromptTextarea
          title={isFirstLastFrame ? t("promptTitleFirstLast") : isMotion ? t("promptTitleMotion") : t("promptTitleImage")}
          badge={isFirstLastFrame ? t("durationValue", { seconds: duration }) : selectedTemplate ? selectedTemplate.title : t("promptBadgeCustom")}
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            if (!isMotion) setSelectedTemplateId(null);
          }}
          rows={isFirstLastFrame ? 5 : isMotion ? 4 : 7}
          placeholder={isFirstLastFrame
            ? t("promptPlaceholderFirstLast")
            : t("promptPlaceholderDefault")}
          description={isFirstLastFrame
            ? t("promptDescFirstLast")
            : isMotion ? t("promptDescMotion") : t("promptDescImage")}
          maxLength={4000}
          hasAiAssistant={isFirstLastFrame}
          onOptimizePrompt={isFirstLastFrame ? applyFirstLastPromptSuggestion : undefined}
          onClear={() => {
            setPrompt("");
            if (!isMotion) setSelectedTemplateId(null);
          }}
        />

        {!isFirstLastFrame && (
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="studio-control-title">{isMotion ? t("sampleReferenceVideoSection") : t("actionTemplateSection")}</h3>
              <button
                type="button"
                onClick={() => setTemplatePanelOpen(true)}
                className="inline-flex h-7 items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2.5 text-xs font-black text-blue-600 transition hover:border-blue-200 hover:bg-blue-100"
              >
                {t("more")} <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <TemplateStrip selectedId={selectedTemplateId} onSelect={applyTemplate} />
          </section>
        )}

        {availableProviders.length > 1 && (
          <section>
            <h3 className="studio-control-title mb-3">{t("videoModelSection")}</h3>
            <StudioOptionGrid
              options={availableProviders.map((provider) => ({
                value: provider,
                label: provider === "minimax"
                  ? t("modelMinimaxLabel")
                  : provider === "seedance"
                    ? t("modelSeedanceLabel")
                    : VIDEO_PROVIDER_LABELS[provider],
                description: provider === "minimax"
                  ? t("modelMinimaxDesc")
                  : provider === "seedance"
                    ? t("modelSeedanceDesc")
                    : VIDEO_PROVIDER_DESCRIPTIONS[provider],
              }))}
              value={providerKey}
              onChange={(value) => {
                const provider = value as VideoProviderName;
                setVideoProvider(provider);
                const defaultMode = getVideoDefaultMode(provider);
                setModelMode(defaultMode);
                setResolution(getVideoDefaultResolution(provider, defaultMode));
                setDuration(AI_VIDEO_DEFAULT_DURATION);
              }}
              columns={2}
              ariaLabel={t("videoModelAria")}
            />
          </section>
        )}

        <section>
          <h3 className="studio-control-title mb-3">{t("generationModeSection")}</h3>
          <StudioOptionGrid
            options={modelModeOptions}
            value={effectiveModelMode}
            onChange={(value) => {
              const nextMode = normalizeAiVideoModelMode(value, generationKind);
              setModelMode(nextMode);
              setResolution((current) => normalizeAiVideoResolution(current, nextMode));
            }}
            columns={2}
            ariaLabel={t("generationModeAria")}
          />
        </section>

        <section>
          <ResolutionSelector
            title={t("resolutionSection")}
            options={resolutionOptions.map((item) => ({
              value: item.value,
              label: item.label,
              description: item.description,
            }))}
            value={resolution}
            onChange={(value) => setResolution(normalizeAiVideoResolution(value, effectiveModelMode))}
            ariaLabel={t("resolutionAria")}
          />
        </section>

        <section>
          <h3 className="studio-control-title mb-3">{t("aspectRatioSection")}</h3>
          <AspectRatioSelector
            options={AI_VIDEO_ASPECT_RATIO_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
            value={aspectRatio}
            onChange={handleAspectRatioChange}
            ariaLabel={t("aspectRatioAria")}
          />
        </section>

        <section>
          <h3 className="studio-control-title mb-3">{t("durationSection")}</h3>
          <StudioOptionGrid
            options={getVideoDurationOptions(providerKey).map((value) => ({
              value: String(value),
              label: t("durationValue", { seconds: value }),
              description: t("durationDesc", { cost: getDisplayedVideoCreditCost({ provider: providerKey, modelMode: effectiveModelMode, resolution, duration: value, audioMode }, videoPricing) }),
            }))}
            value={String(duration)}
            onChange={(value) => setDuration(normalizeAiVideoDuration(value))}
            columns={3}
            ariaLabel={t("durationAria")}
          />
        </section>

        <section>
          <StudioToggleRow
            title={(
              <span className="inline-flex items-center gap-1.5">
                <Volume2 className="h-4 w-4 text-[var(--codex-accent)]" />
                {t("audioSection")}
              </span>
            )}
            description={t("audioDescription")}
            meta={generateAudio ? t("nativeAudio") : t("mutedRequest")}
            checked={generateAudio}
            onChange={(checked) => {
              setAudioMode(checked ? "generated" : "off");
              if (!checked) setAudioPrompt("");
            }}
            ariaLabel={t("audioAria")}
          />
          {generateAudio && (
            <div className="mt-3 space-y-3">
              <PromptTextarea
                title={t("audioPromptTitle")}
                badge={t("audioPromptBadge")}
                value={audioPrompt}
                onChange={(event) => setAudioPrompt(event.target.value)}
                rows={3}
                placeholder={t("audioPromptPlaceholder")}
                description={t("audioPromptDesc")}
                maxLength={1000}
                onClear={() => setAudioPrompt("")}
              />
            </div>
          )}
        </section>

        <section>
          <GenerationCountField
            title={t("genCountSection")}
            label={t("genCountSection")}
            titleMeta={t("genCountPerVideo", { cost: perVideoCost })}
            value={genCount}
            onChange={(value) => setGenCount(normalizeAiVideoGenCount(value))}
            counts={[1, 2, 3, 4]}
            unit={t("genCountUnit")}
            ariaLabel={t("genCountAria")}
          />
        </section>
      </div>
    </div>
  );

  return (
    <div className="studio-workbench min-h-[calc(100dvh-64px)] lg:h-[calc(100vh-64px)] flex flex-col lg:flex-row">
      <FeatureTabs active={featureKey} />
      <ModuleTaskRail
        module={generationKind}
        moduleLabel={moduleTitle}
        onContinue={handleContinueCreate}
        onRunningTask={handleRunningTask}
        onCompletedTask={handleCompletedTask}
      />
      <div className="studio-parameters w-full lg:w-[472px] border-b lg:border-b-0 lg:border-r flex flex-col overflow-visible lg:overflow-hidden">
        <div className="studio-shell-header">
          <ModuleHeader
            title={moduleLabel}
            tooltip={isFirstLastFrame
              ? t("tooltipFirstLast")
              : isMotion
                ? t("tooltipMotion")
                : t("tooltipImage")}
          />
        </div>
        {controlPanel}
        <StudioRunBar
          summary={`${effectiveModelMode === "pro" ? t("summaryHighQuality") : t("summaryFastMode")} · ${resolution} · ${aspectRatioSummary} · ${t("durationValue", { seconds: duration })} · ${generateAudio ? t("summaryAudioOn") : t("summaryAudioOff")} · ${genCount}${t("countUnit")}`}
          estimateLabel={isSubmitting ? t("runBar.estimateGenerating") : t("runBar.estimateReady", { count: genCount })}
          costLabel={authIsAnonymous ? t("costLoginView") : t("costLabel", { cost, balance: credits ?? "-" })}
          disabled={isSubmitting || Boolean(runDisabledReason)}
          disabledReason={runDisabledReason}
          primaryLabel={authIsAnonymous ? t("primaryLogin") : isSubmitting ? t("primarySubmitting") : t("primaryGenerate")}
          isLoading={isSubmitting}
          onPrimaryAction={generate}
        />
      </div>

      <main className="studio-canvas min-h-[520px] flex-1 overflow-hidden">
        {error ? (
          <div className="studio-result-stage flex h-full items-center justify-center px-4">
            <div className="max-w-md rounded-2xl border border-red-100 bg-white/82 p-6 text-center shadow-[0_18px_54px_rgba(15,23,42,0.08)]">
              <X className="mx-auto mb-3 h-10 w-10 rounded-full bg-red-50 p-2 text-red-500" />
              <h2 className="text-base font-black text-red-600">{t("videoFailedHeading")}</h2>
              <p className="mt-2 text-sm leading-6 text-codex-muted">{error}</p>
              <button type="button" onClick={() => setError("")} className="mac-button mt-4 h-10 px-5 text-sm font-black">
                {t("backToEdit")}
              </button>
            </div>
          </div>
        ) : (isGenerating || resultUrls.length > 0) ? (
          <div className="studio-result-stage h-full overflow-y-auto p-4 pb-28 sm:p-6">
            {isGenerating && (
              <div className="mb-4 rounded-xl border border-blue-100 bg-white/80 px-3 py-2 text-xs font-bold text-blue-600 shadow-sm">
                {t("generatingBanner", { progress: Math.round(progress) })}
              </div>
            )}
            <ResultVideoGrid
              urls={resultUrls}
              filenamePrefix={isFirstLastFrame ? "first-last-frame-video" : isMotion ? "motion-video" : "image-video"}
              onOpen={(url) => setLightboxVideo(url)}
              aspectRatio={effectiveAspectRatio}
              expectedCount={isGenerating ? genCount : undefined}
              isGenerating={isGenerating}
              inputThumbnails={inputThumbnails}
              statusGroup={isGenerating ? "running" : undefined}
              resourceFavorite={{ generationId: activeGenerationId, moduleKey: generationKind, mediaType: "video" }}
            />
          </div>
        ) : isFirstLastFrame ? (
          <FirstLastFrameCanvas firstFrameUrl={firstFrameUrl} lastFrameUrl={lastFrameUrl} />
        ) : isMotion ? (
          <MotionControlCanvas />
        ) : (
          <ImageToVideoGuide onOpenTemplates={() => setTemplatePanelOpen(true)} />
        )}
      </main>

      {!isFirstLastFrame && templatePanelOpen && (
        <StudioSideDrawer
          open={templatePanelOpen}
          side="left"
          size="lg"
          title={isMotion ? t("drawerMotionTitle") : t("drawerImageTitle")}
          description={isMotion ? t("drawerMotionDesc") : t("drawerImageDesc")}
          ariaLabel={isMotion ? t("drawerMotionAria") : t("drawerImageAria")}
          onClose={() => setTemplatePanelOpen(false)}
        >
          <div className="border-b border-[var(--codex-border)] px-5 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <TemplateTabs />
              </div>
              <button type="button" className="mac-button inline-flex h-10 shrink-0 items-center gap-2 px-4 text-sm font-black">
                <Sparkles className="h-4 w-4" />
                {t("aiRecommend")}
              </button>
            </div>
          </div>
          <div className="custom-scroll min-h-0 flex-1 overflow-y-auto p-5">
            <TemplateGrid selectedId={selectedTemplateId} onSelect={applyTemplate} actionLabel={isMotion ? t("trySampleVideo") : t("useTemplate")} />
          </div>
        </StudioSideDrawer>
      )}

      <StudioMediaLightbox
        src={lightboxVideo}
        alt={t("lightboxVideoAlt")}
        kind="video"
        mediaClassName="rounded-2xl"
        onClose={() => setLightboxVideo(null)}
      />

      <StudioMediaLightbox
        src={lightboxImage}
        alt={t("lightboxImageAlt")}
        mediaClassName="rounded-2xl bg-codex-surface"
        onClose={() => setLightboxImage(null)}
      />
    </div>
  );
}

function TemplateStrip({ selectedId, onSelect }: { selectedId: number | null; onSelect: (template: AiVideoActionTemplate) => void }) {
  const t = useTranslations("Video");
  const [previewTemplate, setPreviewTemplate] = useState<AiVideoActionTemplate | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video) return;

    if (previewTemplate) {
      video.currentTime = 0;
      void video.play().catch(() => undefined);
      return;
    }

    video.pause();
    video.currentTime = 0;
  }, [previewTemplate]);

  return (
    <div className="relative" onMouseLeave={() => setPreviewTemplate(null)}>
      {previewTemplate && (
        <div className="pointer-events-none absolute bottom-[94px] left-0 z-30 aspect-[4/5] w-[232px] overflow-hidden rounded-2xl border border-white/90 bg-codex-ink shadow-[0_28px_70px_rgba(15,23,42,0.22)] ring-1 ring-blue-200/80">
          <RawPreviewImage src={previewTemplate.previewImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <video
            ref={previewVideoRef}
            key={previewTemplate.id}
            src={previewTemplate.previewVideo}
            muted
            loop
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/18 via-transparent to-codex-ink/42" />
          <span className="absolute left-3 top-3 rounded-full bg-codex-ink/72 px-3 py-1.5 text-sm font-black text-white shadow-sm backdrop-blur">00:05</span>
          <span className="absolute inset-x-3 bottom-3 rounded-full border border-white/22 bg-white/16 px-3 py-2 text-xs font-black text-white shadow-sm backdrop-blur-md">
            {previewTemplate.title}
          </span>
        </div>
      )}

      <div className="studio-scrollbar-hide flex gap-2 overflow-x-auto pb-1 pt-1">
        {AI_VIDEO_ACTION_TEMPLATES.slice(0, 6).map((template) => {
          const selected = selectedId === template.id;
          const previewing = previewTemplate?.id === template.id;

          return (
            <button
              key={template.id}
              type="button"
              onClick={() => onSelect(template)}
              onMouseEnter={() => setPreviewTemplate(template)}
              onFocus={() => setPreviewTemplate(template)}
              onBlur={() => setPreviewTemplate(null)}
              aria-pressed={selected}
              className={`group relative h-[78px] w-[68px] shrink-0 overflow-hidden rounded-sm border bg-[var(--codex-surface-soft)] transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 ${
                selected || previewing
                  ? "border-blue-500 shadow-[0_12px_28px_rgba(59,130,246,0.2)] ring-2 ring-blue-100"
                  : "border-[var(--codex-border)] hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_10px_22px_rgba(15,23,42,0.10)]"
              }`}
              title={template.title}
            >
              <RawPreviewImage src={template.previewImage} alt={template.title} className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.04]" />
              <span className={`absolute inset-0 transition ${previewing ? "bg-blue-500/10" : "bg-transparent"}`} />
              {selected && (
                <span className="absolute left-1.5 top-1.5 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-black leading-none text-white shadow-sm">
                  {t("selected")}
                </span>
              )}
              {(selected || previewing) && <span className="absolute inset-x-2 bottom-1 h-1.5 rounded-full bg-blue-500 shadow-[0_0_0_1px_rgba(255,255,255,0.8)]" />}
              {previewing && (
                <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white/92 text-blue-600 shadow-sm">
                  <Play className="ml-0.5 h-3 w-3 fill-current" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function resolveMotionTemplateId(referenceVideoUrl: string, templateId?: number | null) {
  if (!referenceVideoUrl) return null;
  const template = AI_VIDEO_ACTION_TEMPLATES.find((item) => item.id === templateId);
  if (template?.previewVideo === referenceVideoUrl) return template.id;
  return AI_VIDEO_ACTION_TEMPLATES.find((item) => item.previewVideo === referenceVideoUrl)?.id || null;
}

function ImageToVideoGuide({ onOpenTemplates }: { onOpenTemplates: () => void }) {
  const t = useTranslations("Video");
  return (
    <div className="studio-empty-stage flex h-full min-h-[520px] items-center justify-center px-4 py-8">
      <div className="w-full max-w-3xl">
        <PreviewGuide
          title={t("guideTitle")}
          subtitle={t("guideSubtitle")}
          imageSrc={AI_VIDEO_ACTION_TEMPLATES[0]?.previewImage}
          imageAlt={t("guideImageAlt")}
          icon={<Clapperboard className="h-9 w-9" />}
          steps={[
            { title: t("stepUploadTitle"), desc: t("stepUploadDesc") },
            { title: t("stepTemplateTitle"), desc: t("stepTemplateDesc") },
            { title: t("stepGenerateTitle"), desc: t("stepGenerateDesc") },
          ]}
        />
        <div className="mt-5 flex justify-center">
          <button type="button" onClick={onOpenTemplates} className="gradient-brand inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-black text-white shadow-[0_18px_44px_var(--codex-accent-24)]">
            <ImagePlus className="h-4 w-4" />
            {t("chooseTemplate")}
          </button>
        </div>
      </div>
    </div>
  );
}

function FirstLastFrameCanvas({ firstFrameUrl, lastFrameUrl }: { firstFrameUrl: string; lastFrameUrl: string }) {
  const t = useTranslations("Video");
  const generatedPreview = AI_VIDEO_ACTION_TEMPLATES[6]?.previewImage || AI_VIDEO_ACTION_TEMPLATES[0]?.previewImage || "";

  return (
    <div className="studio-empty-stage flex h-full min-h-[520px] items-center justify-center px-4 py-8">
      <PreviewGuide
        title={t("firstLastGuideTitle")}
        subtitle={t("firstLastGuideSubtitle")}
        icon={<ImagePlus className="h-9 w-9" />}
        steps={[
          {
            title: t("stepFirstFrameTitle"),
            desc: firstFrameUrl ? t("stepFirstFrameLocked") : t("stepFirstFramePending"),
            imageSrc: firstFrameUrl || undefined,
            imageAlt: t("stepFirstFrameAlt"),
            imageFit: firstFrameUrl ? "contain" : undefined,
            badge: t("badgeFirstFrame"),
          },
          {
            title: t("stepLastFrameTitle"),
            desc: lastFrameUrl ? t("stepLastFrameLocked") : t("stepLastFramePending"),
            imageSrc: lastFrameUrl || undefined,
            imageAlt: t("stepLastFrameAlt"),
            imageFit: lastFrameUrl ? "contain" : undefined,
            badge: t("badgeLastFrame"),
          },
          {
            title: t("stepGenerateVideoTitle"),
            desc: t("stepGenerateVideoDesc"),
            imageSrc: generatedPreview,
            imageAlt: t("stepGenerateVideoAlt"),
            badge: t("badgeGenerateVideo"),
          },
        ]}
      />
    </div>
  );
}

function TemplateTabs() {
  const t = useTranslations("Video");
  const tabs = [
    { key: "templateTabExample", label: "示例动作" },
    { key: "templateTabMen", label: "男装" },
    { key: "templateTabWomen", label: "女装" },
    { key: "templateTabKids", label: "儿童" },
    { key: "templateTabToddler", label: "幼童" },
  ];
  return (
    <div className="flex gap-7 overflow-x-auto text-sm font-black text-codex-ink">
      {tabs.map((item, index) => (
        <button
          key={item.key}
          type="button"
          className={`h-9 shrink-0 border-b-2 px-0.5 transition ${
            index === 0 ? "border-[var(--codex-ink)] text-codex-ink" : "border-transparent text-codex-ink hover:text-codex-ink"
          }`}
        >
          {t(item.key)}
        </button>
      ))}
    </div>
  );
}

function TemplateGrid({
  selectedId,
  onSelect,
  actionLabel = "",
}: {
  selectedId: number | null;
  onSelect: (template: AiVideoActionTemplate) => void;
  actionLabel?: string;
}) {
  const t = useTranslations("Video");
  const resolvedLabel = actionLabel || t("useTemplate");
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {AI_VIDEO_ACTION_TEMPLATES.map((template) => (
        <TemplateCard
          key={template.id}
          template={template}
          selected={selectedId === template.id}
          onSelect={() => onSelect(template)}
          actionLabel={resolvedLabel}
        />
      ))}
    </div>
  );
}

function TemplateCard({
  template,
  selected,
  onSelect,
  actionLabel,
}: {
  template: AiVideoActionTemplate;
  selected: boolean;
  onSelect: () => void;
  actionLabel: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
      video.currentTime = 0;
    }
  }, [active]);

  return (
    <article
      className={`group overflow-hidden rounded-sm border bg-codex-surface shadow-sm transition hover:-translate-y-0.5 ${
        selected ? "border-blue-500 ring-2 ring-blue-100" : "border-[var(--codex-border)]"
      }`}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-[var(--codex-surface-soft)]">
        <RawPreviewImage src={template.previewImage} alt={template.title} className={`h-full w-full object-cover transition ${active ? "opacity-0" : "opacity-100"}`} />
        <video
          ref={videoRef}
          src={template.previewVideo}
          muted
          loop
          playsInline
          preload="metadata"
          className={`absolute inset-0 h-full w-full object-cover transition ${active ? "opacity-100" : "opacity-0"}`}
        />
        {active && (
          <span className="absolute left-3 top-3 rounded-full bg-black/72 px-2.5 py-1 text-xs font-black text-white">00:05</span>
        )}
        {selected && (
          <span className="absolute inset-0 flex items-center justify-center bg-codex-ink/18 text-white">
            <Maximize2 className="h-9 w-9 drop-shadow" />
          </span>
        )}
      </div>
      <div className="p-4">
        <h3 className="truncate text-base font-black text-codex-ink">{template.title}</h3>
        <p className="mt-1 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-codex-faint">{template.promptContent}</p>
        <button
          type="button"
          onClick={onSelect}
          className="gradient-brand mt-4 inline-flex h-10 w-full items-center justify-center rounded-[8px] text-sm font-black text-white"
        >
          {actionLabel}
        </button>
      </div>
    </article>
  );
}

function MotionControlCanvas() {
  const t = useTranslations("Video");
  return (
    <div className="studio-empty-stage flex h-full min-h-[520px] items-center justify-center px-4 py-8">
      <PreviewGuide
        title={t("motionCanvasTitle")}
        subtitle={t("motionCanvasSubtitle")}
        icon={<Clapperboard className="h-9 w-9" />}
        steps={[
          {
            title: t("motionStepModelTitle"),
            desc: t("motionStepModelDesc"),
            imageSrc: AI_VIDEO_ACTION_TEMPLATES[0]?.previewImage || "",
            imageAlt: t("motionStepModelAlt"),
            badge: t("badgeModelImage"),
          },
          {
            title: t("motionStepVideoTitle"),
            desc: t("motionStepVideoDesc"),
            imageSrc: AI_VIDEO_ACTION_TEMPLATES[8]?.previewImage || "",
            imageAlt: t("motionStepVideoAlt"),
            badge: t("badgeReferenceVideo"),
          },
          {
            title: t("motionStepGenerateTitle"),
            desc: t("motionStepGenerateDesc"),
            imageSrc: AI_VIDEO_ACTION_TEMPLATES[6]?.previewImage || "",
            imageAlt: t("motionStepGenerateAlt"),
            badge: t("badgeGenerateVideoMotion"),
          },
        ]}
      />
    </div>
  );
}

function getDisplayedVideoCreditCost(
  input: {
    provider: VideoProviderName;
    modelMode: AiVideoModelMode;
    resolution: AiVideoResolution;
    duration?: AiVideoDuration | number;
    genCount?: number;
    audioMode?: AiVideoAudioMode;
  },
  pricing: VideoPricingMap,
) {
  const selection = resolveVideoSelection(input.provider, input.modelMode, input.resolution);
  const configured = pricing[input.provider]?.[`${selection.mode}:${selection.resolution}`];
  if (!configured) return getVideoCreditCost(input);
  return calculateVideoCreditCost({ provider: input.provider, price: configured, duration: input.duration, genCount: input.genCount, audioMode: input.audioMode });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
