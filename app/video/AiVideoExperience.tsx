"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { ClientPortal } from "@/components/ClientPortal";
import { FeatureTabs } from "@/components/FeatureTabs";
import { ModuleHeader } from "@/components/ModuleHeader";
import { PreviewGuide } from "@/components/PreviewGuide";
import { ResultVideoGrid } from "@/components/ResultVideoGrid";
import { ModuleTaskRail } from "@/components/studio/ModuleTaskRail";
import { RawPreviewImage } from "@/components/studio/RawPreviewImage";
import { StudioGenerationCountSelector, StudioOptionGrid, StudioPromptTextarea, StudioToggleRow } from "@/components/studio/StudioFormControls";
import { StudioRunBar } from "@/components/studio/StudioRunBar";
import { StudioSideDrawer } from "@/components/studio/StudioSideDrawer";
import { StudioUploadTile } from "@/components/studio/StudioUploadTile";
import { StudioVideoUploadTile } from "@/components/studio/StudioVideoUploadTile";
import { useStableFileDrag } from "@/components/studio/useStableFileDrag";
import { useStudioAuth } from "@/components/studio/useStudioAuth";
import type { TaskSelectionSession } from "@/components/studio/useTaskSelectionSession";
import { useTaskQueueGeneration } from "@/components/studio/useTaskQueueGeneration";
import {
  AI_VIDEO_ACTION_TEMPLATES,
  AI_VIDEO_ASPECT_RATIO_OPTIONS,
  AI_VIDEO_DEFAULT_AUDIO_MODE,
  AI_VIDEO_DEFAULT_DURATION,
  AI_VIDEO_DEFAULT_FIXED_ASPECT_RATIO,
  AI_VIDEO_DEFAULT_RESOLUTION,
  AI_VIDEO_DURATION_OPTIONS,
  AI_VIDEO_MODEL_MODE_OPTIONS,
  getClosestAiVideoAspectRatio,
  getAiVideoPerVideoCreditCost,
  getAiVideoCreditCost,
  getAiVideoKind,
  getAiVideoPath,
  getAiVideoResolutionOptions,
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
import { fetchHistoryApplyDetail, getHistoryApplyFailureMessage, isHistoryApplyRowFailed, takeApplyDetail, type HistoryJobPayload } from "@/lib/history-apply";
import { setCachedProfileCredits } from "@/lib/supabase/client";
import { safeTaskQueueUrls, type TaskQueueItem } from "@/lib/task-queue";
import { takeSourceImageFromLocation } from "@/lib/studio-image-preview";
import { showInsufficientCreditsToast } from "@/lib/ui/credit-copy";
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

type AiVideoExperienceProps = {
  mode: AiVideoMode;
};

function normalizeHappyHorseUiAudioMode(value: unknown): AiVideoAudioMode {
  const audioMode = normalizeAiVideoAudioMode(value);
  return audioMode === "custom" ? "generated" : audioMode;
}

export function AiVideoExperience({ mode }: AiVideoExperienceProps) {
  const router = useRouter();
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
  const moduleTitle = isFirstLastFrame ? "首尾帧" : isMotion ? "动作模仿" : "图生视频";
  const moduleLabel = moduleTitle;
  const apiPath = isFirstLastFrame ? "/api/video/first-last-frame" : isMotion ? "/api/video/motion-control" : "/api/video/image-to-video";
  const applyPath = getAiVideoPath(generationKind);

  const { authChecked, isAuthenticated, userId, credits, setCredits, refreshAuth } = useStudioAuth();
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
  const [resolution, setResolution] = useState<AiVideoResolution>(AI_VIDEO_DEFAULT_RESOLUTION);
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
  const aspectRatioSummary = aspectRatio === "auto" ? `智能(${effectiveAspectRatio})` : effectiveAspectRatio;
  const resolutionOptions = useMemo(
    () => getAiVideoResolutionOptions(effectiveModelMode),
    [effectiveModelMode]
  );
  const cost = getAiVideoCreditCost({ modelMode: effectiveModelMode, resolution, duration, genCount, audioMode });
  const inputThumbnails = isFirstLastFrame
    ? [firstFrameUrl, lastFrameUrl].filter(Boolean)
    : isMotion
    ? [modelImageUrl, referenceVideoUrl].filter(Boolean)
    : [imageUrl].filter(Boolean);
  const runDisabledReason = isFirstLastFrame
    ? !firstFrameUrl
      ? "请先上传首帧图片"
      : !lastFrameUrl
        ? "请先上传尾帧图片"
        : !prompt.trim()
          ? "请输入视频生成效果描述"
          : credits !== null && credits < cost
            ? `灵点不足，生成需要 ${cost} 灵点`
            : undefined
    : isMotion
    ? !modelImageUrl
      ? "请先上传模特图"
      : !referenceVideoUrl
        ? "请先上传参考视频"
        : credits !== null && credits < cost
          ? `灵点不足，生成需要 ${cost} 灵点`
          : undefined
    : !imageUrl
      ? "请先上传图片"
      : !prompt.trim()
        ? "请输入动作描述或选择动作模板"
        : credits !== null && credits < cost
          ? `灵点不足，生成需要 ${cost} 灵点`
          : undefined;
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
    () => AI_VIDEO_MODEL_MODE_OPTIONS.map((item) => ({
      value: item.value,
      label: item.label,
      description: isFirstLastFrame && item.value === "fast" ? "首尾帧需高清模式" : item.description,
      disabled: isFirstLastFrame && item.value === "fast",
    })),
    [isFirstLastFrame]
  );
  const perVideoCost = getAiVideoPerVideoCreditCost({ modelMode: effectiveModelMode, resolution, duration, audioMode });

  useEffect(() => {
    const nextMode = isFirstLastFrame ? "pro" : normalizeAiVideoModelMode(modelMode);
    if (nextMode !== modelMode) setModelMode(nextMode);
    const nextResolution = normalizeAiVideoResolution(resolution, nextMode);
    if (nextResolution !== resolution) setResolution(nextResolution);
  }, [isFirstLastFrame, modelMode, resolution]);

  useEffect(() => {
    const sourceImage = takeSourceImageFromLocation();
    if (!sourceImage) return;
    if (isFirstLastFrame) {
      setFirstFrameUrl(sourceImage);
      setFirstFrameRatio(null);
      toast.success("已带入首帧图片");
      return;
    }
    if (isMotion) {
      setModelImageUrl(sourceImage);
      setModelImageRatio(null);
      toast.success("已带入模特图");
      return;
    }
    setImageUrl(sourceImage);
    setImageRatio(null);
    toast.success("已带入预览图片");
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
      toast.error("请上传图片文件");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(`图片不能超过 ${MAX_FILE_SIZE_MB}MB`);
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
    toast.info("正在上传图片...");
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
      toast.success("图片已上传");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "图片上传失败，请重试");
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
      toast.error("请上传 MP4 或 MOV 视频");
      return;
    }
    if (file.size > MAX_VIDEO_FILE_SIZE) {
      toast.error(`视频不能超过 ${MAX_VIDEO_FILE_SIZE_MB}MB`);
      return;
    }

    setError("");
    setResultUrls([]);
    setIsUploadingVideo(true);
    toast.info("正在上传参考视频...");
    try {
      const result = await uploadVideo(file);
      setReferenceVideoUrl(result.url);
      setSelectedTemplateId(null);
      toast.success("参考视频已上传");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "视频上传失败，请重试");
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
    toast.success(isMotion ? "已套用示例参考视频" : "已套用动作模板");
  }

  function removeReferenceVideo() {
    setReferenceVideoUrl("");
    setSelectedTemplateId(null);
  }

  function applyFirstLastPromptSuggestion() {
    setSelectedTemplateId(null);
    setPrompt("围绕首尾帧主体生成顺滑过渡视频，主体从首帧自然移动到尾帧姿态，服装版型和人物身份保持一致，镜头稳定，动作连贯，避免跳切、变形和多余人物。");
    setResultUrls([]);
    setError("");
  }

  async function generate() {
    if (submitLockRef.current || isSubmitting) {
      toast.info("视频任务正在提交，请稍候。");
      return;
    }
    if (!isAuthenticated && !(await refreshAuth())) {
      toast.error("请先登录");
      router.push("/login");
      return;
    }
    if (runDisabledReason) {
      if (runDisabledReason.startsWith("灵点不足")) {
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
            };
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        if (res.status === 402) {
          const nextCredits = data.balance ?? 0;
          setCredits(nextCredits);
          if (userId) setCachedProfileCredits(userId, nextCredits);
        }
        throw new Error(data.error || "视频生成失败");
      }

      if (data.credits_remaining !== undefined) {
        setCredits(data.credits_remaining);
        if (userId) setCachedProfileCredits(userId, data.credits_remaining);
      }
      if (typeof data.generation_id === "string" && data.generation_id) {
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
        toast.success("视频任务已提交，可继续创建");
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
            toast.success("视频生成完成");
          }
          taskQueue.markCompleted(activeTaskId, {
            expectedCount: genCount,
            inputThumbnails,
            resultThumbnails: finalUrls,
            resultCount: finalUrls.length,
          });
          return;
        } else if (state.status === "failed") {
          throw new Error(state.error || "视频生成失败");
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
        toast.info("视频仍在后台生成，可稍后在任务队列或作品库查看");
      }
    } catch (err) {
      submitLockRef.current = false;
      const message = err instanceof Error ? err.message : "视频生成失败";
      taskQueue.markFailed(activeTaskId, message, {
        expectedCount: genCount,
        inputThumbnails,
        resultThumbnails: latestTaskResultUrls,
      });
      if (isCurrentRun()) {
        setError(message);
        if (message.includes("灵点不足")) {
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
      applyHistoryPayload(detail.payload, detail.resultUrls.length ? detail.resultUrls : safeTaskQueueUrls(item.resultThumbnails), {
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
    if (!options?.silent) toast.success("已套用历史参数");
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
    setModelMode("pro");
    setResolution(AI_VIDEO_DEFAULT_RESOLUTION);
    setAspectRatio("auto");
    setDuration(AI_VIDEO_DEFAULT_DURATION);
    setAudioMode(AI_VIDEO_DEFAULT_AUDIO_MODE);
    setAudioPrompt("");
    setGenCount(1);
    setResultUrls([]);
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
            <section className="rounded-xl bg-slate-50/90 p-4">
              <div className="mb-3">
                <h3 className="text-sm font-black text-codex-ink">上传图片</h3>
                <p className="mt-2 text-[11px] font-semibold leading-5 text-codex-faint">
                  图片大小不超过 {MAX_FILE_SIZE_MB}MB，首帧和尾帧的主体、比例和画面风格建议保持一致。
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <section {...firstFrameDrag.dragHandlers} className={`rounded-xl transition-[box-shadow] ${isDraggingFirstFrame ? "ring-2 ring-zinc-900/30 ring-offset-2" : ""}`}>
                  <input
                    ref={firstFrameInputRef}
                    type="file"
                    accept="image/*"
                    aria-label="上传首帧图片"
                    className="hidden"
                    onChange={(event) => {
                      const input = event.currentTarget;
                      void handleImageFile(input.files?.[0], "firstFrame").finally(() => {
                        input.value = "";
                      });
                    }}
                  />
                  <StudioUploadTile
                    title="上传首帧图片"
                    description="点击或拖拽图片至此"
                    imageRequirement="主体清晰，比例和画面风格建议与尾帧一致。"
                    imageUrl={firstFrameUrl || null}
                    imageAlt="首帧图片"
                    isDragging={isDraggingFirstFrame}
                    loading={isUploadingFirstFrame}
                    onUploadClick={() => firstFrameInputRef.current?.click()}
                    onLibraryClick={() => toast.info("作品库选择即将接入")}
                    onPreview={firstFrameUrl ? () => setLightboxImage(firstFrameUrl) : undefined}
                    onRemove={firstFrameUrl ? () => {
                      setFirstFrameUrl("");
                      setFirstFrameRatio(null);
                    } : undefined}
                    libraryLabel="从作品库选择"
                    uploadLabel="上传首帧"
                  />
                </section>
                <section {...lastFrameDrag.dragHandlers} className={`rounded-xl transition-[box-shadow] ${isDraggingLastFrame ? "ring-2 ring-zinc-900/30 ring-offset-2" : ""}`}>
                  <input
                    ref={lastFrameInputRef}
                    type="file"
                    accept="image/*"
                    aria-label="上传尾帧图片"
                    className="hidden"
                    onChange={(event) => {
                      const input = event.currentTarget;
                      void handleImageFile(input.files?.[0], "lastFrame").finally(() => {
                        input.value = "";
                      });
                    }}
                  />
                  <StudioUploadTile
                    title="上传尾帧图片"
                    description="点击或拖拽图片至此"
                    imageRequirement="主体清晰，比例和画面风格建议与首帧一致。"
                    imageUrl={lastFrameUrl || null}
                    imageAlt="尾帧图片"
                    isDragging={isDraggingLastFrame}
                    loading={isUploadingLastFrame}
                    onUploadClick={() => lastFrameInputRef.current?.click()}
                    onLibraryClick={() => toast.info("作品库选择即将接入")}
                    onPreview={lastFrameUrl ? () => setLightboxImage(lastFrameUrl) : undefined}
                    onRemove={lastFrameUrl ? () => {
                      setLastFrameUrl("");
                      setLastFrameRatio(null);
                    } : undefined}
                    libraryLabel="从作品库选择"
                    uploadLabel="上传尾帧"
                  />
                </section>
              </div>
            </section>
          </>
        ) : !isMotion ? (
          <section {...imageDrag.dragHandlers} className={`rounded-xl transition-[box-shadow] ${isDraggingImage ? "ring-2 ring-zinc-900/30 ring-offset-2" : ""}`}>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              aria-label="上传图片"
              className="hidden"
              onChange={(event) => {
                const input = event.currentTarget;
                void handleImageFile(input.files?.[0], "image").finally(() => {
                  input.value = "";
                });
              }}
            />
            <StudioUploadTile
              title="上传图片"
              description="PNG、JPG 或 WebP，建议主体清晰、人物或服装完整。"
              imageRequirement="主体完整、边缘清楚，人物或服装不要被遮挡。"
              imageUrl={imageUrl || null}
              imageAlt="图生视频输入图"
              isDragging={isDraggingImage}
              loading={isUploadingImage}
              onUploadClick={() => imageInputRef.current?.click()}
              onLibraryClick={() => toast.info("作品库选择即将接入")}
              onPreview={imageUrl ? () => setLightboxImage(imageUrl) : undefined}
              onRemove={imageUrl ? () => {
                setImageUrl("");
                setImageRatio(null);
              } : undefined}
              libraryLabel="从作品库选择"
              uploadLabel="点击或拖拽上传"
              footnote="模板动作会作为运动方向，图片主体和服装细节会作为硬参考。"
            />
          </section>
        ) : (
          <>
            <section {...modelImageDrag.dragHandlers} className={`rounded-xl transition-[box-shadow] ${isDraggingModelImage ? "ring-2 ring-zinc-900/30 ring-offset-2" : ""}`}>
              <input
                ref={modelImageInputRef}
                type="file"
                accept="image/*"
                aria-label="上传模特图"
                className="hidden"
                onChange={(event) => {
                  const input = event.currentTarget;
                  void handleImageFile(input.files?.[0], "model").finally(() => {
                    input.value = "";
                  });
                }}
              />
              <StudioUploadTile
                title="上传模特图"
                description="PNG、JPG 或 WebP，人物正面或半身更稳定。"
                imageRequirement="人物主体完整，脸和服装清晰，单人画面最稳。"
                imageUrl={modelImageUrl || null}
                imageAlt="动作模仿模特图"
                isDragging={isDraggingModelImage}
                loading={isUploadingModelImage}
                onUploadClick={() => modelImageInputRef.current?.click()}
                onLibraryClick={() => toast.info("作品库选择即将接入")}
                onPreview={modelImageUrl ? () => setLightboxImage(modelImageUrl) : undefined}
                onRemove={modelImageUrl ? () => {
                  setModelImageUrl("");
                  setModelImageRatio(null);
                } : undefined}
                libraryLabel="从作品库选择"
                uploadLabel="点击或拖拽上传"
              />
            </section>
            <section {...videoDrag.dragHandlers} className={`rounded-xl transition-[box-shadow] ${isDraggingVideo ? "ring-2 ring-zinc-900/30 ring-offset-2" : ""}`}>
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
                title="上传参考视频"
                description="单镜头动作更稳，参考视频只作为动作来源。"
                videoUrl={referenceVideoUrl}
                isDragging={isDraggingVideo}
                loading={isUploadingVideo}
                onUploadClick={() => videoInputRef.current?.click()}
                onLibraryClick={() => toast.info("作品库选择即将接入")}
                onRemove={referenceVideoUrl ? removeReferenceVideo : undefined}
                sourceLabel={selectedTemplate ? `示例参考视频 · ${selectedTemplate.title}` : undefined}
                uploadLabel="点击上传"
                libraryLabel="从作品库选择"
                videoRequirement="MP4、MOV，最大100MB；避免剪辑、转场和多人同框。"
                tips={[
                  { label: "说明", text: "参考视频只提供动作节奏。" },
                  { label: "视频要求", text: "单镜头、动作清楚、少转场。" },
                ]}
              />
            </section>
          </>
        )}

        <StudioPromptTextarea
          title={isFirstLastFrame ? "描述视频生成效果" : isMotion ? "动作补充" : "动作描述"}
          badge={isFirstLastFrame ? `${duration}秒` : selectedTemplate ? selectedTemplate.title : "自定义"}
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            if (!isMotion) setSelectedTemplateId(null);
          }}
          rows={isFirstLastFrame ? 5 : isMotion ? 4 : 7}
          placeholder={isFirstLastFrame
            ? "描述两张图之间的动态衔接过程、运镜和转场方式，例如：模特从自然站立过渡到抬手展示包袋，固定镜头，动作连贯。"
            : "描述想要的视频动作，例如：模特自然向前走，保持微笑，镜头平稳推进"}
          description={isFirstLastFrame
            ? "重点描述首帧到尾帧之间如何过渡，主体身份、服装版型和画面比例会作为硬参考。"
            : isMotion ? "可选：补充服装、动作细节或镜头稳定要求；参考视频仍是主要动作来源。" : "模板会自动填入动作描述，也可以自行编辑。"}
          action={isFirstLastFrame ? (
            <button
              type="button"
              onClick={applyFirstLastPromptSuggestion}
              className="gradient-brand inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-black text-white shadow-[0_10px_24px_rgba(7,8,13,0.18)] transition hover:opacity-95"
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI帮写
            </button>
          ) : undefined}
        />

        {!isFirstLastFrame && (
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-black text-codex-ink">{isMotion ? "示例参考视频" : "动作模板"}</h3>
              <button
                type="button"
                onClick={() => setTemplatePanelOpen(true)}
                className="inline-flex h-7 items-center gap-1 rounded-full border border-zinc-200 bg-zinc-100 px-2.5 text-xs font-black text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-200"
              >
                更多 <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <TemplateStrip selectedId={selectedTemplateId} onSelect={applyTemplate} />
          </section>
        )}

        <section>
          <h3 className="mb-3 text-sm font-black text-codex-ink">生成模式</h3>
          <StudioOptionGrid
            options={modelModeOptions}
            value={effectiveModelMode}
            onChange={(value) => {
              const nextMode = normalizeAiVideoModelMode(value, generationKind);
              setModelMode(nextMode);
              setResolution((current) => normalizeAiVideoResolution(current, nextMode));
            }}
            columns={2}
            ariaLabel="视频生成模式"
          />
        </section>

        <section>
          <h3 className="mb-3 text-sm font-black text-codex-ink">分辨率</h3>
          <StudioOptionGrid
            options={resolutionOptions.map((item) => ({
              value: item.value,
              label: item.label,
              description: item.description,
            }))}
            value={resolution}
            onChange={(value) => setResolution(normalizeAiVideoResolution(value, effectiveModelMode))}
            columns={2}
            ariaLabel="视频分辨率"
          />
        </section>

        <section>
          <h3 className="mb-3 text-sm font-black text-codex-ink">画面比例</h3>
          <StudioOptionGrid
            options={AI_VIDEO_ASPECT_RATIO_OPTIONS.map((item) => ({
              value: item.value,
              label: item.label,
              description: item.description,
            }))}
            value={aspectRatio}
            onChange={handleAspectRatioChange}
            columns={3}
            ariaLabel="视频画面比例"
          />
        </section>

        <section>
          <h3 className="mb-3 text-sm font-black text-codex-ink">视频时长</h3>
          <StudioOptionGrid
            options={AI_VIDEO_DURATION_OPTIONS.map((item) => ({
              value: String(item.value),
              label: item.label,
              description: `${getAiVideoPerVideoCreditCost({ modelMode: effectiveModelMode, resolution, duration: item.value, audioMode })} 灵点/条`,
            }))}
            value={String(duration)}
            onChange={(value) => setDuration(normalizeAiVideoDuration(value))}
            columns={3}
            ariaLabel="视频时长"
          />
        </section>

        <section>
          <StudioToggleRow
            title={(
              <span className="inline-flex items-center gap-1.5">
                <Volume2 className="h-4 w-4 text-[var(--codex-accent)]" />
                声音
              </span>
            )}
            description="HappyHorse 支持原生有声视频；关闭时会明确请求静音。"
            meta={generateAudio ? "原生音效" : "请求静音"}
            checked={generateAudio}
            onChange={(checked) => {
              setAudioMode(checked ? "generated" : "off");
              if (!checked) setAudioPrompt("");
            }}
            ariaLabel="视频音效开关"
          />
          {generateAudio && (
            <div className="mt-3 space-y-3">
              <StudioPromptTextarea
                title="声音描述"
                badge="可选"
                value={audioPrompt}
                onChange={(event) => setAudioPrompt(event.target.value)}
                rows={3}
                placeholder="例如：轻快清爽的商拍环境声，保留脚步声和衣料轻响，不要人声，不要夸张音效。"
                description="不填写时由模型按画面自动生成声音。"
              />
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-black text-codex-ink">生成条数</h3>
            <span className="text-[11px] font-bold text-codex-faint">{perVideoCost} 灵点/条</span>
          </div>
          <StudioGenerationCountSelector
            value={genCount}
            onChange={(value) => setGenCount(normalizeAiVideoGenCount(value))}
            counts={[1, 2, 3, 4]}
            unit="条"
            ariaLabel="视频生成条数"
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
              ? "上传首帧和尾帧图片，描述中间动态过程，系统会生成从首帧过渡到尾帧的视频。"
              : isMotion
                ? "上传模特图与参考视频，系统会复刻参考视频中的人物动作并生成新视频。"
                : "上传图片并选择动作模板，系统会生成服装或模特展示视频。"}
          />
        </div>
        {controlPanel}
        <StudioRunBar
          summary={`${effectiveModelMode === "pro" ? "高清模式" : "快速模式"} · ${resolution} · ${aspectRatioSummary} · ${duration}秒 · ${generateAudio ? "音效" : "静音"} · ${genCount}条`}
          costLabel={authIsAnonymous ? "登录后查看灵点" : `消耗 ${cost} · 余额 ${credits ?? "-"}`}
          disabled={isSubmitting || Boolean(runDisabledReason)}
          disabledReason={runDisabledReason}
          primaryLabel={authIsAnonymous ? "登录后生成" : isSubmitting ? "提交中..." : "生成视频"}
          isLoading={isSubmitting}
          onPrimaryAction={generate}
        />
      </div>

      <main className="studio-canvas min-h-[520px] flex-1 overflow-hidden">
        {error ? (
          <div className="studio-result-stage flex h-full items-center justify-center px-4">
            <div className="max-w-md rounded-[16px] border border-red-100 bg-white/82 p-6 text-center shadow-[0_18px_54px_rgba(15,23,42,0.08)]">
              <X className="mx-auto mb-3 h-10 w-10 rounded-full bg-red-50 p-2 text-red-500" />
              <h2 className="text-base font-black text-red-600">视频生成失败</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">{error}</p>
              <button type="button" onClick={() => setError("")} className="mac-button mt-4 h-10 px-5 text-sm font-black">
                返回编辑
              </button>
            </div>
          </div>
        ) : (isGenerating || resultUrls.length > 0) ? (
          <div className="studio-result-stage h-full overflow-y-auto p-4 pb-28 sm:p-6">
            {isGenerating && (
              <div className="mb-4 rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-xs font-bold text-zinc-700 shadow-sm">
                视频生成中 {Math.round(progress)}%，完成后会自动显示在这里。
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
          title={isMotion ? "示例参考视频" : "动作模板"}
          description={isMotion ? "选择示例后会作为参考视频试用；手动上传参考视频会自动取消示例选择。" : "选择模板后会自动写入动作描述，也可以在左侧继续编辑。"}
          ariaLabel={isMotion ? "示例参考视频选择" : "动作模板选择"}
          onClose={() => setTemplatePanelOpen(false)}
        >
          <div className="border-b border-slate-100 px-5 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <TemplateTabs />
              </div>
              <button type="button" className="mac-button inline-flex h-10 shrink-0 items-center gap-2 px-4 text-sm font-black">
                <Sparkles className="h-4 w-4" />
                AI 推荐
              </button>
            </div>
          </div>
          <div className="custom-scroll min-h-0 flex-1 overflow-y-auto p-5">
            <TemplateGrid selectedId={selectedTemplateId} onSelect={applyTemplate} actionLabel={isMotion ? "试用示例视频" : "使用模板"} />
          </div>
        </StudioSideDrawer>
      )}

      {lightboxVideo && (
        <ClientPortal>
          <div className="fixed inset-0 z-[180] flex cursor-zoom-out items-center justify-center bg-slate-950/66 p-4 backdrop-blur-xl sm:p-8" onClick={() => setLightboxVideo(null)}>
            <video
              src={lightboxVideo}
              controls
              autoPlay
              playsInline
              className="max-h-full max-w-full rounded-[16px] bg-black shadow-[0_32px_120px_rgba(0,0,0,0.45)]"
              onClick={(event) => event.stopPropagation()}
            />
            <button onClick={() => setLightboxVideo(null)} aria-label="关闭大图预览" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/85 bg-white/90 text-slate-700 shadow-[0_12px_34px_rgba(15,23,42,0.22)] backdrop-blur transition-colors hover:bg-white hover:text-slate-950 sm:right-6 sm:top-6">
              <X className="h-5 w-5" />
            </button>
          </div>
        </ClientPortal>
      )}

      {lightboxImage && (
        <ClientPortal>
          <div
            className="fixed inset-0 z-[180] flex cursor-zoom-out items-center justify-center bg-slate-950/66 p-4 backdrop-blur-xl sm:p-8"
            onClick={() => setLightboxImage(null)}
          >
            <RawPreviewImage
              src={lightboxImage}
              alt="上传图片预览"
              className="max-h-full max-w-full cursor-default rounded-[16px] bg-white object-contain shadow-[0_32px_120px_rgba(0,0,0,0.45)]"
              onClick={(event) => event.stopPropagation()}
            />
            <button
              type="button"
              onClick={() => setLightboxImage(null)}
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/85 bg-white/90 text-slate-700 shadow-[0_12px_34px_rgba(15,23,42,0.22)] backdrop-blur transition-colors hover:bg-white hover:text-slate-950 sm:right-6 sm:top-6"
              aria-label="关闭图片预览"
              title="关闭图片预览"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </ClientPortal>
      )}
    </div>
  );
}

function TemplateStrip({ selectedId, onSelect }: { selectedId: number | null; onSelect: (template: AiVideoActionTemplate) => void }) {
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
        <div className="pointer-events-none absolute bottom-[94px] left-0 z-30 aspect-[4/5] w-[232px] overflow-hidden rounded-[18px] border border-white/90 bg-slate-950 shadow-[0_28px_70px_rgba(15,23,42,0.22)] ring-1 ring-zinc-200/80">
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
          <div className="absolute inset-0 bg-gradient-to-b from-black/18 via-transparent to-slate-950/42" />
          <span className="absolute left-3 top-3 rounded-full bg-slate-950/72 px-3 py-1.5 text-sm font-black text-white shadow-sm backdrop-blur">00:05</span>
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
              className={`group relative h-[78px] w-[68px] shrink-0 overflow-hidden rounded-[12px] border bg-slate-100 transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/30 focus-visible:ring-offset-2 ${
                selected || previewing
                  ? "border-zinc-950 shadow-[0_12px_28px_rgba(5,5,5,0.18)] ring-2 ring-zinc-200"
                  : "border-slate-200 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-[0_10px_22px_rgba(15,23,42,0.10)]"
              }`}
              title={template.title}
            >
              <RawPreviewImage src={template.previewImage} alt={template.title} className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.04]" />
              <span className={`absolute inset-0 transition ${previewing ? "bg-zinc-950/10" : "bg-transparent"}`} />
              {selected && (
                <span className="absolute left-1.5 top-1.5 rounded-full bg-zinc-950 px-1.5 py-0.5 text-[10px] font-black leading-none text-white shadow-sm">
                  已选
                </span>
              )}
              {(selected || previewing) && <span className="absolute inset-x-2 bottom-1 h-1.5 rounded-full bg-zinc-950 shadow-[0_0_0_1px_rgba(255,255,255,0.8)]" />}
              {previewing && (
                <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white/92 text-zinc-900 shadow-sm">
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
  return (
    <div className="studio-empty-stage flex h-full min-h-[520px] items-center justify-center px-4 py-8">
      <div className="w-full max-w-3xl">
        <PreviewGuide
          title="开始生成服饰视频"
          subtitle="先上传主体清晰的图片，再选择或编辑动作描述；系统会把图片中的人物、服装和细节作为硬参考生成竖版视频。"
          imageSrc={AI_VIDEO_ACTION_TEMPLATES[0]?.previewImage}
          imageAlt="图生视频指引"
          icon={<Clapperboard className="h-9 w-9" />}
          steps={[
            { title: "上传图片", desc: "人物或服装尽量完整，边缘清晰时更容易保持版型和细节。" },
            { title: "选择动作模板", desc: "模板只控制动作和镜头方向，左侧动作描述可以继续微调。" },
            { title: "生成竖版视频", desc: "默认输出 9:16 视频，完成后会显示在当前区域和最近任务中。" },
          ]}
        />
        <div className="mt-5 flex justify-center">
          <button type="button" onClick={onOpenTemplates} className="gradient-brand inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-black text-white shadow-[0_18px_44px_rgba(7,8,13,0.22)]">
            <ImagePlus className="h-4 w-4" />
            选择动作模板
          </button>
        </div>
      </div>
    </div>
  );
}

function FirstLastFrameCanvas({ firstFrameUrl, lastFrameUrl }: { firstFrameUrl: string; lastFrameUrl: string }) {
  const generatedPreview = AI_VIDEO_ACTION_TEMPLATES[6]?.previewImage || AI_VIDEO_ACTION_TEMPLATES[0]?.previewImage || "";

  return (
    <div className="studio-empty-stage flex h-full min-h-[520px] items-center justify-center px-4 py-8">
      <PreviewGuide
        title="上传首帧和尾帧，生成过渡视频"
        subtitle="首尾两张图决定开始和结束画面，描述控制中间动作、镜头和转场节奏。"
        icon={<ImagePlus className="h-9 w-9" />}
        steps={[
          {
            title: "首帧画面",
            desc: firstFrameUrl ? "已锁定开始画面。" : "先上传开始画面。",
            imageSrc: firstFrameUrl || undefined,
            imageAlt: "首帧画面",
            imageFit: firstFrameUrl ? "contain" : undefined,
            badge: "首帧",
          },
          {
            title: "尾帧画面",
            desc: lastFrameUrl ? "已锁定结束画面。" : "再上传结束画面。",
            imageSrc: lastFrameUrl || undefined,
            imageAlt: "尾帧画面",
            imageFit: lastFrameUrl ? "contain" : undefined,
            badge: "尾帧",
          },
          {
            title: "生成视频",
            desc: "按描述补齐中间动作。",
            imageSrc: generatedPreview,
            imageAlt: "生成视频预览",
            badge: "生成视频",
          },
        ]}
      />
    </div>
  );
}

function TemplateTabs() {
  return (
    <div className="flex gap-7 overflow-x-auto text-sm font-black text-slate-950">
      {["示例动作", "男装", "女装", "儿童", "幼童"].map((item, index) => (
        <button
          key={item}
          type="button"
          className={`h-9 shrink-0 border-b-2 px-0.5 transition ${
            index === 0 ? "border-slate-950 text-slate-950" : "border-transparent text-slate-700 hover:text-slate-950"
          }`}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function TemplateGrid({
  selectedId,
  onSelect,
  actionLabel = "使用模板",
}: {
  selectedId: number | null;
  onSelect: (template: AiVideoActionTemplate) => void;
  actionLabel?: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {AI_VIDEO_ACTION_TEMPLATES.map((template) => (
        <TemplateCard
          key={template.id}
          template={template}
          selected={selectedId === template.id}
          onSelect={() => onSelect(template)}
          actionLabel={actionLabel}
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
      className={`group overflow-hidden rounded-[12px] border bg-white shadow-sm transition hover:-translate-y-0.5 ${
        selected ? "border-zinc-950 ring-2 ring-zinc-200" : "border-slate-200"
      }`}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-slate-100">
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
          <span className="absolute inset-0 flex items-center justify-center bg-slate-950/18 text-white">
            <Maximize2 className="h-9 w-9 drop-shadow" />
          </span>
        )}
      </div>
      <div className="p-4">
        <h3 className="truncate text-base font-black text-slate-950">{template.title}</h3>
        <p className="mt-1 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-slate-500">{template.promptContent}</p>
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
  return (
    <div className="studio-empty-stage flex h-full min-h-[520px] items-center justify-center px-4 py-8">
      <PreviewGuide
        title="动作模仿"
        subtitle="上传模特图和参考视频，复刻参考视频的动作节奏，生成同款动作结果。"
        icon={<Clapperboard className="h-9 w-9" />}
        steps={[
          {
            title: "上传模特图",
            desc: "人物和服装作为硬参考。",
            imageSrc: AI_VIDEO_ACTION_TEMPLATES[0]?.previewImage || "",
            imageAlt: "动作模仿模特图",
            badge: "模特图",
          },
          {
            title: "上传参考视频",
            desc: "参考动作节奏和镜头方向。",
            imageSrc: AI_VIDEO_ACTION_TEMPLATES[8]?.previewImage || "",
            imageAlt: "动作参考视频",
            badge: "参考视频",
          },
          {
            title: "生成视频",
            desc: "输出同款动作成片。",
            imageSrc: AI_VIDEO_ACTION_TEMPLATES[6]?.previewImage || "",
            imageAlt: "生成视频",
            badge: "生成视频",
          },
        ]}
      />
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
