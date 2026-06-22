"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Copy,
  ImagePlus,
  Loader2,
  RefreshCw,
  Trash2,
  Brush,
  X,
} from "lucide-react";
import { Modal } from "antd";
import { toast } from "sonner";
import { FeatureTabs } from "@/components/FeatureTabs";
import { ModuleHeader } from "@/components/ModuleHeader";
import { ModuleTaskRail } from "@/components/studio/ModuleTaskRail";
import type { TaskSelectionSession } from "@/components/studio/useTaskSelectionSession";
import { ErrorStage } from "@/components/studio/ErrorStage";
import { LoadingStage } from "@/components/studio/LoadingStage";
import { ResultImageGrid } from "@/components/ResultImageGrid";
import { StudioImagePreviewDialog } from "@/components/studio/StudioImagePreviewDialog";
import { ClientPortal } from "@/components/ClientPortal";
import { PreviewGuide } from "@/components/PreviewGuide";
import { StudioGenerationCountSelector, StudioModelSelector, StudioOptionGrid, StudioPromptTextarea } from "@/components/studio/StudioFormControls";
import { useStudioAuth } from "@/components/studio/useStudioAuth";
import { StudioRunBar } from "@/components/studio/StudioRunBar";
import { StudioUploadSection } from "@/components/studio/StudioUploadSection";
import { StudioUploadTile } from "@/components/studio/StudioUploadTile";
import { RawPreviewImage } from "@/components/studio/RawPreviewImage";
import { useTaskQueueGeneration } from "@/components/studio/useTaskQueueGeneration";
import { setCachedProfileCredits } from "@/lib/supabase/client";
import { MAX_FILE_SIZE, MAX_FILE_SIZE_MB, uploadImage } from "@/lib/utils";
import { getCreditCost, getSupportedImageSizes, type AspectRatio, type ImageSize, type LingyaModel } from "@/lib/api/lingya";
import { fetchHistoryApplyDetail, getHistoryApplyFailureMessage, isHistoryApplyRowFailed, takeApplyDetail, type HistoryJobPayload } from "@/lib/history-apply";
import { clampTaskExpectedCount, safeTaskQueueUrls, type TaskQueueItem } from "@/lib/task-queue";
import { showInsufficientCreditsToast } from "@/lib/ui/credit-copy";
import { createGenericImagePreviewSession, takeSourceImageFromLocation, type ImagePreviewAction } from "@/lib/studio-image-preview";
import { FAILED_RETRY_NOTICE, buildFailedTaskDetail, buildPartialFailureDetail, summarizeGenerationError } from "@/lib/studio-generation-feedback";
import {
  buildRetryPendingResultUrls,
  getRetryDisplayExpectedCount,
  mergeRetryResultUrls,
  normalizeRetryResultIndex,
} from "@/lib/result-slot-retry";

type GeneralImageMode = "text-to-image" | "image-to-image";

type ReferenceImage = {
  id: string;
  name: string;
  url: string;
  preview: string;
};

type ImagePromptImage = {
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

const MODELS: { value: LingyaModel; label: string; desc: string; badge?: string; icon: string }[] = [
  { value: "nano-banana-2", label: "Nano-Banana-2", desc: "最高4K", badge: "默认", icon: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/model-icons/gemini.png" },
  { value: "gpt-image-2", label: "GPT-Image-2", desc: "最高4K", badge: "高质感", icon: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/model-icons/openai.svg" },
  { value: "nano-banana-pro", label: "Nano-Banana-Pro", desc: "最高4K", badge: "推荐", icon: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/model-icons/gemini.png" },
];

const ASPECTS: { value: AspectRatio; label: string }[] = [
  { value: "3:4", label: "3:4 竖版" },
  { value: "4:3", label: "4:3 横版" },
  { value: "1:1", label: "1:1 方图" },
  { value: "9:16", label: "9:16 手机" },
  { value: "16:9", label: "16:9 宽屏" },
  { value: "4:5", label: "4:5 电商" },
  { value: "auto", label: "智能" },
];

const IMAGE_PROMPT_PLACEHOLDER =
  "例如：将图1中的无袖灰色连衣裙穿到图2的人物身上，图2人物需穿着图1的灰色无袖连衣裙，保留图2人物的黑色长发、金色十字架项链、金色耳环，背景为浅灰色，光线柔和自然，突出服装的质感和人物的优雅气质，同时参考图3的服装风格，但此处主要是替换图1的服装到图2人物身上，无需添加图3元素。";

const GENERAL_IMAGE_PREVIEW_ACTIONS: ImagePreviewAction[] = [
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

export function GeneralImageExperience({ initialMode = "text-to-image" }: { initialMode?: GeneralImageMode }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagePromptInputRef = useRef<HTMLInputElement>(null);

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
  const [aiModel, setAiModel] = useState<LingyaModel>("nano-banana-2");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("auto");
  const [imageSize, setImageSize] = useState<ImageSize>("1K");
  const [genCount, setGenCount] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultUrls, setResultUrls] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [showImagePromptModal, setShowImagePromptModal] = useState(false);
  const [imagePromptImage, setImagePromptImage] = useState<ImagePromptImage | null>(null);
  const [imagePromptText, setImagePromptText] = useState("");
  const [isImagePromptUploading, setIsImagePromptUploading] = useState(false);
  const [isImagePromptGenerating, setIsImagePromptGenerating] = useState(false);
  const [activeQueueTask, setActiveQueueTask] = useState<TaskQueueItem | null>(null);

  const supportedSizes = getSupportedImageSizes(aiModel, aspectRatio);
  const costPerImage = getCreditCost(aiModel, imageSize, aspectRatio);
  const totalCost = costPerImage * genCount;
  const isImageMode = mode === "image-to-image";
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
    title: "创意生图",
    defaultExpectedCount: genCount,
    applyPath: "/general-image",
  });
  const modeMeta = isImageMode
    ? {
        title: "图生图",
        tooltip: "上传多张参考图并用文字说明每张图的角色，适合换装、风格参考、背景参考和多图合成生成。",
        emptyTitle: "创建多图参考生成",
        emptySubtitle: "按图1、图2、图3明确分配服装、人物、风格或背景角色，让模型按关系生成新图。",
        emptyImage: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/model-grey-tank-denim.jpg",
      }
    : {
        title: "文生图",
        tooltip: "仅通过文字描述生成图片，支持图片转提示词、帮写、模型、比例、清晰度和张数配置。",
        emptyTitle: "创建文本生成图片",
        emptySubtitle: "写下主体、场景、光线和风格，也可以先用图片转提示词获得更稳定的描述。",
        emptyImage: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/exclusive-model-01.png",
      };
  const previewReferenceUrls = safeTaskQueueUrls(activeQueueTask?.inputThumbnails).length
    ? safeTaskQueueUrls(activeQueueTask?.inputThumbnails)
    : referenceImages.map((item) => item.preview || item.url).filter(Boolean);
  const activeResultExpectedCount = activeQueueTask
    ? clampTaskExpectedCount(activeQueueTask, 1, 4, genCount)
    : isGenerating
      ? genCount
      : Math.max(resultUrls.length, 1);
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
      toastMessage: `正在补位重试第 ${index + 1} 张，失败图已退款，完成后会回填到当前结果中...`,
    });
  }
  const previewSession = useMemo(
    () => createGenericImagePreviewSession({
      module: "generalImage",
      title: modeMeta.title,
      urls: resultUrls,
      expectedCount: activeResultExpectedCount,
      isGenerating,
      statusGroup: activeQueueTask?.statusGroup || (isGenerating ? "running" : undefined),
      createdAt: activeQueueTask?.createdAt,
      references: previewReferenceUrls.map((url, index) => ({
        url,
        label: `参考图 ${index + 1}`,
        role: "reference" as const,
      })),
      promptText: prompt,
      metaItems: [
        { label: "生成模式", value: modeMeta.title },
        { label: "模型", value: aiModel },
        { label: "比例", value: aspectRatio },
        { label: "分辨率", value: imageSize },
        { label: "生成数量", value: genCount },
      ],
      resultTitlePrefix: `${modeMeta.title}结果`,
      aspectRatio,
    }),
    [activeQueueTask, activeResultExpectedCount, aiModel, aspectRatio, genCount, imageSize, isGenerating, modeMeta.title, previewReferenceUrls, prompt, resultUrls]
  );
  const canGenerate = !isGenerating && !isUploading && prompt.trim().length > 0 && (!isImageMode || referenceImages.length > 0);
  const runDisabledReason = !prompt.trim()
    ? "请先输入文本描述"
    : isImageMode && referenceImages.length === 0
      ? "请先上传参考图"
      : "";

  useEffect(() => {
    const nextSizes = getSupportedImageSizes(aiModel, aspectRatio);
    if (!nextSizes.includes(imageSize)) setImageSize(nextSizes[0] || "1K");
  }, [aiModel, aspectRatio, imageSize]);

  useEffect(() => {
    setMode(initialMode);
    resetOutput();
  }, [initialMode]);

  useEffect(() => {
    const sourceImage = takeSourceImageFromLocation();
    if (sourceImage) {
      setMode("image-to-image");
      setReferenceImages([{
        id: `source-${Date.now()}`,
        name: "来自结果预览",
        url: sourceImage,
        preview: sourceImage,
      }]);
      setPrompt((prev) => prev.trim() || "基于图1进行自然修图，保持主体、构图和风格不变。");
      toast.success("已带入预览图片");
    }
  }, []);

  function applyGeneralImageHistoryPayload(payload: GeneralImageHistoryPayload, historyResultUrls: string[] = [], options?: { silent?: boolean }) {
    setMode(payload.mode);
    setPrompt(payload.prompt);
    setAiModel(payload.aiModel);
    setAspectRatio(payload.aspectRatio);
    setImageSize(payload.imageSize);
    setGenCount(payload.genCount);
    setReferenceImages(payload.referenceUrls.map((url, index) => ({
      id: `history-general-${index}-${url}`,
      name: `历史参考图${index + 1}`,
      url,
      preview: url,
    })));
    setActiveQueueTask(null);
    setResultUrls(historyResultUrls);
    setIsGenerating(false);
    setError("");
    setProgress(historyResultUrls.length ? 100 : 0);
    if (!options?.silent) toast.success("已套用历史参数");
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
    const detail = await takeApplyDetail("generalImage");
    const payload = detail?.payload;
    if (cancelled || !payload) return;
    setMode(payload.mode);
    setPrompt(payload.prompt);
    setAiModel(payload.aiModel);
    setAspectRatio(payload.aspectRatio);
    setImageSize(payload.imageSize);
    setGenCount(payload.genCount);
    setReferenceImages(payload.referenceUrls.map((url, index) => ({
      id: `history-general-${index}-${url}`,
      name: `历史参考图${index + 1}`,
      url,
      preview: url,
    })));
    setActiveQueueTask(null);
    setResultUrls(detail?.resultUrls || []);
    setIsGenerating(false);
    setError(isHistoryApplyRowFailed(detail.row) ? getHistoryApplyFailureMessage(detail.row) : "");
    setProgress(detail?.resultUrls.length ? 100 : 0);
    toast.success("已套用历史参数");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function resetOutput() {
    setActiveQueueTask(null);
    setIsGenerating(false);
    setResultUrls([]);
    setError("");
    setProgress(0);
  }

  function performContinueCreate() {
    setMode(initialMode);
    setPrompt("");
    setReferenceImages([]);
    setAiModel("nano-banana-2");
    setAspectRatio("auto");
    setImageSize("1K");
    setGenCount(1);
    setIsDragging(false);
    setShowImagePromptModal(false);
    setImagePromptImage(null);
    setImagePromptText("");
    setIsImagePromptGenerating(false);
    setLightboxSrc(null);
    resetOutput();
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (imagePromptInputRef.current) imagePromptInputRef.current.value = "";
  }

  function handleContinueCreate() {
    Modal.confirm({
      title: "继续创建",
      content: "继续创建将清空当前所有内容，确定要继续吗？",
      okText: "确定",
      cancelText: "取消",
      onOk: performContinueCreate,
    });
  }

  async function handleFiles(files?: FileList | File[]) {
    const selected = Array.from(files || []);
    if (!selected.length) return;

    const invalid = selected.find((file) => !file.type.startsWith("image/"));
    if (invalid) return toast.error("请选择图片文件");

    const oversized = selected.find((file) => file.size > MAX_FILE_SIZE);
    if (oversized) return toast.error(`${oversized.name} 超过 ${MAX_FILE_SIZE_MB}MB`);

    const remain = Math.max(0, 8 - referenceImages.length);
    if (!remain) return toast.error("最多上传 8 张参考图");
    const limited = selected.slice(0, remain);
    if (selected.length > limited.length) toast.info("已自动保留前 8 张参考图");

    setIsUploading(true);
    toast.info(`正在上传 ${limited.length} 张参考图...`);
    try {
      const results = await Promise.allSettled(limited.map((file) => uploadImage(file)));
      const nextImages: ReferenceImage[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          nextImages.push({
            id: `${limited[index].name}-${Date.now()}-${index}`,
            name: limited[index].name || `参考图${referenceImages.length + index + 1}`,
            url: result.value.url,
            preview: result.value.display_url || result.value.url,
          });
        } else {
          toast.error(`${limited[index].name} 上传失败`);
        }
      });
      if (nextImages.length) {
        setReferenceImages((prev) => [...prev, ...nextImages].slice(0, 8));
        toast.success("参考图已上传");
      }
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function optimizePrompt() {
    if (!isAuthenticated && !(await refreshAuth())) {
      toast.error("请先登录");
      router.push("/login");
      return;
    }
    if (!prompt.trim() && referenceImages.length === 0) {
      toast.error(isImageMode ? "请先输入基本想法或上传参考图" : "请先输入基本想法");
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
      if (!res.ok) throw new Error(data.error || "提示词优化失败");
      if (data.prompt) {
        setPrompt(String(data.prompt).slice(0, 4000));
        toast.success(data.source === "fallback" ? "已用本地模板优化提示词" : "提示词已优化");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "提示词优化失败");
    } finally {
      setIsOptimizing(false);
    }
  }

  async function uploadImageForPrompt(files?: FileList | File[]) {
    const file = Array.from(files || [])[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("请选择图片文件");
    if (file.size > MAX_FILE_SIZE) return toast.error(`${file.name} 超过 ${MAX_FILE_SIZE_MB}MB`);

    if (!isAuthenticated && !(await refreshAuth())) {
      toast.error("请先登录");
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
      toast.success("图片已上传，正在反推提示词");
      await generateImagePrompt(nextImage.url);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "图片上传失败");
    } finally {
      setIsImagePromptUploading(false);
      if (imagePromptInputRef.current) imagePromptInputRef.current.value = "";
    }
  }

  async function generateImagePrompt(imageUrl = imagePromptImage?.url) {
    if (!imageUrl) return toast.error("请先上传图片");
    if (!isAuthenticated && !(await refreshAuth())) {
      toast.error("请先登录");
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
      if (!res.ok) throw new Error(data.error || "图片转提示词失败");
      if (data.prompt) {
        setImagePromptText(String(data.prompt).slice(0, 4000));
        toast.success(data.source === "fallback" ? "已用本地模板生成提示词" : "图片提示词已生成");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "图片转提示词失败");
    } finally {
      setIsImagePromptGenerating(false);
    }
  }

  function applyImagePromptToDescription() {
    if (!imagePromptText.trim()) return toast.error("请先生成提示词");
    setPrompt(imagePromptText.trim().slice(0, 4000));
    setShowImagePromptModal(false);
    toast.success("已应用到文本描述");
  }

  async function generate(options: GeneralImageGenerateOptions = {}) {
    if (!isAuthenticated && !(await refreshAuth())) {
      toast.error("请先登录");
      router.push("/login");
      return;
    }
    if (!prompt.trim()) return toast.error("请输入提示词");
    if (isImageMode && !referenceImages.length) return toast.error("请先上传参考图");
    const runGenCount = Math.min(Math.max(Math.round(Number(options.genCountOverride ?? genCount) || 1), 1), 4);
    const runExpectedCount = Math.max(1, Math.round(Number(options.expectedCountOverride ?? runGenCount) || runGenCount));
    const retryResultIndex = normalizeRetryResultIndex(options.retryResultIndex);
    const retryPreviousResultUrls = retryResultIndex !== null ? resultUrls : [];
    const displayExpectedCount = getRetryDisplayExpectedCount({
      retryIndex: retryResultIndex,
      currentExpectedCount: activeResultExpectedCount,
      previousUrls: retryPreviousResultUrls,
      fallbackExpectedCount: runExpectedCount,
    });
    const runTotalCost = costPerImage * runExpectedCount;
    if (credits !== null && credits < runTotalCost) {
      showInsufficientCreditsToast({ required: runTotalCost, balance: credits, onRecharge: () => router.push("/pricing") });
      return;
    }

    setActiveQueueTask(null);
    setIsGenerating(true);
    setProgress(8);
    setError("");
    setResultUrls(buildRetryPendingResultUrls(retryPreviousResultUrls, retryResultIndex, displayExpectedCount));
    if (options.toastMessage) toast.info(options.toastMessage);
    const provisionalTask = taskQueue.startTask({
      expectedCount: displayExpectedCount,
      inputThumbnails: taskInputThumbnails,
      progress: 8,
    });
    setActiveQueueTask(provisionalTask);
    let activeTaskId = provisionalTask.id;
    let latestTaskResultUrls: string[] = [];
    try {
      const res = await fetch("/api/general-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          prompt,
          reference_urls: isImageMode ? referenceImages.map((item) => item.url) : [],
          ai_model: aiModel,
          aspect_ratio: aspectRatio,
          image_size: imageSize,
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
          status: data.status || "processing",
          progress: 12,
        });
        setActiveQueueTask(serverTask);
        activeTaskId = serverTask.id;
      }

      for (let attempts = 0; attempts < 150; attempts++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const poll = await fetch(`/api/general-image?generation_id=${encodeURIComponent(data.generation_id)}`);
        if (!poll.ok) continue;
        const state = await poll.json();
        const nextProgress = Number(state.progress);
        const runningProgress = Number.isFinite(nextProgress) ? Math.min(Math.max(Math.round(nextProgress), 0), 99) : 25;
        if (Number.isFinite(nextProgress)) setProgress(runningProgress);
        if (Array.isArray(state.result_urls) && state.result_urls.length) {
          latestTaskResultUrls = mergeRetryResultUrls(retryPreviousResultUrls, retryResultIndex, state.result_urls, displayExpectedCount);
          setResultUrls(latestTaskResultUrls);
        }
        const runningTask = taskQueue.markRunning(activeTaskId, {
          expectedCount: displayExpectedCount,
          inputThumbnails: taskInputThumbnails,
          resultThumbnails: latestTaskResultUrls,
          resultCount: latestTaskResultUrls.filter(Boolean).length,
          progress: runningProgress,
          status: state.status || "processing",
        });
        setActiveQueueTask(runningTask);
        if (state.status === "completed") {
          const finalUrls = mergeRetryResultUrls(
            retryPreviousResultUrls,
            retryResultIndex,
            Array.isArray(state.result_urls) ? state.result_urls : latestTaskResultUrls,
            displayExpectedCount
          );
          latestTaskResultUrls = finalUrls;
          const finalResultCount = finalUrls.filter(Boolean).length;
          const partialFailure = state.partial_failure && typeof state.partial_failure === "object"
            ? state.partial_failure as { message?: unknown }
            : null;
          const completedError = state.error || partialFailure?.message || "";
          setProgress(100);
          setResultUrls(finalUrls);
          const completedTask = taskQueue.markCompleted(activeTaskId, {
            expectedCount: displayExpectedCount,
            inputThumbnails: taskInputThumbnails,
            resultThumbnails: finalUrls,
            resultCount: finalResultCount,
            error: completedError ? summarizeGenerationError(completedError) : "",
          });
          setActiveQueueTask(completedTask);
          setIsGenerating(false);
          if (completedError || finalResultCount < displayExpectedCount) {
            void refreshCredits();
            toast.warning(`${modeMeta.title}部分完成：已生成 ${finalResultCount}/${displayExpectedCount} 张，失败图片灵点会自动退回`);
          } else {
            toast.success(`${modeMeta.title}生成完成`);
          }
          return;
        }
        if (state.status === "failed") throw new Error(state.error || "生成失败");
      }
      throw new Error("生成超时");
    } catch (err: unknown) {
      const message = summarizeGenerationError(err instanceof Error ? err.message : "生成失败");
      setError(message);
      const failedTask = taskQueue.markFailed(activeTaskId, message, {
        expectedCount: displayExpectedCount,
        inputThumbnails: taskInputThumbnails,
        resultThumbnails: latestTaskResultUrls,
        resultCount: latestTaskResultUrls.filter(Boolean).length,
      });
      setActiveQueueTask(failedTask);
      toast.error(message);
      void refreshCredits();
      setIsGenerating(false);
    }
  }

  function handleRunningTask(item: TaskQueueItem) {
    setActiveQueueTask(item);
    setIsGenerating(true);
    setProgress(Math.min(Math.max(Math.round(Number(item.progress) || 12), 1), 99));
    setError("");
    setResultUrls(safeTaskQueueUrls(item.resultThumbnails));
  }

  async function handleCompletedTask(item: TaskQueueItem, session: TaskSelectionSession) {
    try {
      const detail = await fetchHistoryApplyDetail(item.id, "generalImage", session.signal);
      if (!session.isCurrent()) return true;
      applyGeneralImageHistoryPayload(detail.payload, detail.resultUrls.length ? detail.resultUrls : safeTaskQueueUrls(item.resultThumbnails), {
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

  return (
    <div className="studio-workbench min-h-[calc(100dvh-64px)] lg:h-[calc(100vh-64px)] flex flex-col lg:flex-row">
      <FeatureTabs active={activeFeature} />
      <ModuleTaskRail module="generalImage" moduleLabel="创意生图" onContinue={handleContinueCreate} onRunningTask={handleRunningTask} onCompletedTask={handleCompletedTask} />
      <div className="studio-parameters w-full lg:w-[472px] border-b lg:border-b-0 lg:border-r flex flex-col overflow-visible lg:overflow-hidden">
        <div className="studio-parameters-scroll flex-1 overflow-visible lg:overflow-y-auto p-3 sm:p-5 space-y-4 sm:space-y-6">
          <ModuleHeader
            title={modeMeta.title}
            tooltip={modeMeta.tooltip}
          />

          {isImageMode && (
            <StudioUploadSection
              title="参考图"
              inputRef={fileInputRef}
              multiple
              isDragging={isDragging}
              setDragging={setIsDragging}
              onFiles={async (files) => {
                await handleFiles(files);
              }}
              className="studio-general-reference-upload"
              actions={(
                <span className="rounded-full bg-zinc-100 px-2 py-1 text-[10px] font-bold text-zinc-900">
                  {referenceImages.length}/8
                </span>
              )}
            >
              {(openFileDialog) => (
                <>
                  <StudioUploadTile
                    title={referenceImages.length >= 8 ? "已达 8 张上限" : referenceImages.length ? "继续上传参考图" : "上传 / 拖拽参考图"}
                    description="支持上传多张参考图，系统会按顺序识别为图1、图2、图3。"
                    imageUrl={null}
                    imageAlt="图生图参考图"
                    isDragging={isDragging}
                    loading={isUploading}
                    disabled={referenceImages.length >= 8}
                    onUploadClick={openFileDialog}
                    uploadLabel="从本地上传"
                    footnote="参考图会按上传顺序作为图1、图2、图3；画面清晰、主体明确更好控图。"
                  />

                  {referenceImages.length > 0 && (
                    <div className="mt-3">
                      <div className="mb-2 flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-500">上传顺序会标记为图1、图2、图3</span>
                        <button type="button" onClick={() => { setReferenceImages([]); }} className="inline-flex items-center gap-1 text-slate-400 hover:text-red-500">
                          <Trash2 className="h-3.5 w-3.5" /> 清空
                        </button>
                      </div>
                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                        {referenceImages.map((item, index) => (
                          <div key={item.id} className="studio-checkerboard group relative aspect-square overflow-hidden rounded-xl border border-white shadow-sm">
                            <RawPreviewImage src={item.preview} alt={item.name} className="h-full w-full object-contain p-1" />
                            <span className="absolute left-1 top-1 rounded bg-white/92 px-1.5 py-0.5 text-[10px] font-black text-slate-500">图{index + 1}</span>
                            <button
                              type="button"
                              onClick={() => { setReferenceImages((prev) => prev.filter((image) => image.id !== item.id)); }}
                              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/80 text-white opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                              aria-label={`移除图${index + 1}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </StudioUploadSection>
          )}

          <div>
            <StudioPromptTextarea
              title="文本描述"
              value={prompt}
              onChange={(event) => { setPrompt(event.target.value.slice(0, 4000)); }}
              placeholder={isImageMode ? IMAGE_PROMPT_PLACEHOLDER : "输入文本描述内容，如：1个中国女性模特身着丝绸质感粉色连衣裙，妆容柔和高级，背景为玫瑰金纯色，整体氛围浪漫而精致"}
              rows={6}
              className="studio-prompt-textarea-compact"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                {!isImageMode && (
                  <button
                    type="button"
                    onClick={() => setShowImagePromptModal(true)}
                    className="studio-button studio-button-compact"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    图片转提示词
                  </button>
                )}
                <button
                  type="button"
                  onClick={optimizePrompt}
                  disabled={isOptimizing}
                  className="studio-button studio-button-compact"
                >
                  {isOptimizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brush className="h-3.5 w-3.5" />}
                  AI帮写
                </button>
              </div>
              <span className="text-[11px] font-medium text-slate-400">{prompt.length} / 4000</span>
            </div>
          </div>

          <section>
            <h3 className="mb-3 font-bold text-sm">生成模型</h3>
            <StudioModelSelector
              models={MODELS}
              value={aiModel}
              onChange={setAiModel}
              ariaLabel="选择生成模型"
            />
          </section>

          <section>
            <h3 className="mb-3 font-bold text-sm">图片比例</h3>
            <StudioOptionGrid
              options={ASPECTS.map((item) => ({
                value: item.value,
                label: item.label,
              }))}
              value={aspectRatio}
              onChange={setAspectRatio}
              columns={3}
              ariaLabel="选择图片比例"
            />
          </section>

          <section>
            <h3 className="mb-3 font-bold text-sm">分辨率</h3>
            <StudioOptionGrid
              options={supportedSizes.map((size) => ({
                value: size,
                label: size,
                description: `${getCreditCost(aiModel, size, aspectRatio)}灵点`,
              }))}
              value={imageSize}
              onChange={setImageSize}
              columns={3}
              ariaLabel="选择分辨率"
            />
          </section>

          <section>
            <h3 className="mb-3 font-bold text-sm">生成数量</h3>
            <StudioGenerationCountSelector
              value={genCount}
              onChange={setGenCount}
              ariaLabel="生成数量"
            />
          </section>
        </div>

        <StudioRunBar
          summary={`${isImageMode ? `图生图 · ${referenceImages.length} 张参考` : "文生图"} · ${costPerImage} × ${genCount}`}
          costLabel={authIsAnonymous ? "登录后查看灵点" : `消耗 ${totalCost} · 余额 ${credits ?? "-"}`}
          disabled={!canGenerate}
          disabledReason={runDisabledReason}
          primaryLabel={authIsAnonymous ? "登录后生成" : isGenerating ? "生成中..." : `立即生成 ${genCount} 张`}
          isLoading={isGenerating}
          onPrimaryAction={generate}
        />
      </div>

      <div className="studio-canvas min-h-[260px] sm:min-h-[360px] lg:min-h-0 flex-1 relative overflow-hidden mt-3 mb-6 lg:mt-0 lg:mb-0">
        {!isGenerating && resultUrls.length === 0 && !error && (
          <div className="studio-empty-stage min-h-[260px] sm:min-h-[360px] lg:h-full flex items-center justify-center px-4">
            <PreviewGuide
              title={modeMeta.emptyTitle}
              subtitle={modeMeta.emptySubtitle}
              imageSrc={modeMeta.emptyImage}
              imageAlt={`${modeMeta.title}指引`}
              steps={!isImageMode ? [
                { title: "输入想法", desc: "可先写一句简短描述，再让系统优化成生成描述。" },
                { title: "选择参数", desc: "确认模型、画幅、清晰度和张数。" },
                { title: "生成结果", desc: "结果会进入作品资产，可下载或继续放大查看。" },
              ] : [
                { title: "上传参考图", desc: "多张图会按上传顺序标记为图1、图2、图3。" },
                { title: "写清图号", desc: "说明每张图承担服装、人物、风格、背景或构图等角色。" },
                { title: "生成结果", desc: "模型会按提示词处理参考关系并输出新图。" },
              ]}
            />
          </div>
        )}

        {isGenerating && resultUrls.length === 0 && !activeQueueTask && (
          <LoadingStage
            genCount={activeQueueTask ? clampTaskExpectedCount(activeQueueTask, 1, 4, genCount) : genCount}
            progress={progress}
            moduleName={modeMeta.title}
            referenceImages={referenceImages.map((item, index) => ({ label: item.name || `参考图 ${index + 1}`, url: item.preview || item.url }))}
            metaItems={[aspectRatio, imageSize, isImageMode ? `${referenceImages.length} 张参考` : "文生图"]}
          />
        )}
        {((isGenerating && resultUrls.length > 0) || resultUrls.length > 0 || Boolean(activeQueueTask)) && (
          <div className="studio-result-stage min-h-[260px] sm:min-h-[360px] overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:h-full flex flex-col animate-fade-in">
            <div className="flex min-h-0 flex-1 items-start justify-start">
              <ResultImageGrid
                urls={resultUrls}
                filenamePrefix={isImageMode ? "image-to-image" : "text-to-image"}
                expectedCount={activeResultExpectedCount}
                isGenerating={isGenerating}
                inputThumbnails={safeTaskQueueUrls(activeQueueTask?.inputThumbnails).length ? safeTaskQueueUrls(activeQueueTask?.inputThumbnails) : referenceImages.map((item) => item.preview || item.url)}
                createdAt={activeQueueTask?.createdAt}
                statusGroup={activeQueueTask?.statusGroup || (isGenerating ? "running" : undefined)}
                variant="task"
                failureLabel="生成失败"
                failureDetail={activeQueueTask?.statusGroup === "failed" ? buildFailedTaskDetail(activeQueueTask.error || error || undefined) : undefined}
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
              filenamePrefix={isImageMode ? "image-to-image" : "text-to-image"}
              actions={GENERAL_IMAGE_PREVIEW_ACTIONS}
              onRegenerateAll={resetOutput}
            />
          </div>
        )}

        {error && !activeQueueTask && (
          <ErrorStage
            error={summarizeGenerationError(error)}
            onRetry={() => generate()}
            isGenerating={isGenerating}
            retryDisabled={retryDisabled}
            retryLabel="重新生成"
            notice={FAILED_RETRY_NOTICE}
          />
        )}
      </div>

      {showImagePromptModal && (
        <ClientPortal>
          <div
            className="fixed inset-0 z-[220] flex min-h-dvh w-dvw items-center justify-center bg-slate-950/38 p-4 backdrop-blur-xl sm:p-6"
            onClick={() => setShowImagePromptModal(false)}
          >
            <div
              className="w-full max-w-2xl overflow-hidden rounded-[22px] border border-zinc-200 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.28)] ring-1 ring-zinc-200"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 px-5 py-4">
                <div>
                  <h3 className="text-base font-black text-slate-950">图片转提示词</h3>
                  <p className="mt-2 text-sm leading-5 text-slate-500">
                    上传图片，使用 自动反推图片内容描述，用于生成相似内容图片
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowImagePromptModal(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  aria-label="关闭图片转提示词"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid gap-4 px-5 pb-5 sm:grid-cols-[120px_minmax(0,1fr)]">
                <div className="space-y-3">
                  <input
                    ref={imagePromptInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    aria-label="上传图片"
                    tabIndex={-1}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => uploadImageForPrompt(event.target.files || undefined)}
                  />
                  <button
                    type="button"
                    onClick={() => imagePromptInputRef.current?.click()}
                    className={`group relative flex aspect-[3/4] w-full min-w-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 text-slate-400 transition hover:border-zinc-300 ${
                      imagePromptImage ? "studio-checkerboard" : "bg-slate-50 hover:bg-zinc-100"
                    }`}
                  >
                    {imagePromptImage ? (
                      <RawPreviewImage src={imagePromptImage.preview} alt={imagePromptImage.name} className="h-full w-full object-contain p-1" />
                    ) : (
                      <span className="flex flex-col items-center gap-2 text-xs font-bold">
                        {isImagePromptUploading ? <Loader2 className="h-6 w-6 animate-spin text-[var(--codex-accent)]" /> : <ImagePlus className="h-6 w-6 text-[var(--codex-accent)]" />}
                        上传图片
                      </span>
                    )}
                    {imagePromptImage && (
                      <span className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg border border-white/80 bg-white/90 text-slate-600 shadow-sm group-hover:text-[var(--codex-accent)]">
                        <ImagePlus className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => generateImagePrompt()}
                    disabled={!imagePromptImage || isImagePromptUploading || isImagePromptGenerating}
                    className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 transition hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {isImagePromptGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    重新生成
                  </button>
                </div>

                <textarea
                  value={imagePromptText}
                  onChange={(event) => setImagePromptText(event.target.value.slice(0, 4000))}
                  placeholder="上传图片后，系统会在这里生成可用于文生图的内容描述。"
                  aria-label="图片反推提示词"
                  className="min-h-[260px] w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-300 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-200 sm:min-h-0"
                />
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (!imagePromptText.trim()) return toast.error("暂无可复制内容");
                    navigator.clipboard.writeText(imagePromptText);
                    toast.success("已复制");
                  }}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-5 text-sm font-bold text-slate-600 transition hover:text-[var(--codex-accent)]"
                >
                  <Copy className="h-3.5 w-3.5" />
                  复制
                </button>
                <button
                  type="button"
                  onClick={applyImagePromptToDescription}
                  disabled={!imagePromptText.trim()}
                  className="gradient-brand inline-flex h-9 items-center justify-center rounded-lg px-5 text-sm font-black text-white shadow-lg shadow-slate-300/40 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  应用到描述
                </button>
              </div>
            </div>
          </div>
        </ClientPortal>
      )}

      {lightboxSrc && (
        <ClientPortal>
          <div
            className="fixed inset-0 z-[180] flex cursor-zoom-out items-center justify-center bg-slate-950/66 p-4 backdrop-blur-xl sm:p-8"
            onClick={() => setLightboxSrc(null)}
          >
            <RawPreviewImage src={lightboxSrc} className="max-h-full max-w-full rounded-2xl object-contain shadow-[0_32px_120px_rgba(0,0,0,0.45)]" alt={`${modeMeta.title}结果预览`} />
            <button
              onClick={() => setLightboxSrc(null)}
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/85 bg-white/90 text-slate-700 shadow-[0_12px_34px_rgba(15,23,42,0.22)] backdrop-blur transition-colors hover:bg-white hover:text-slate-950 sm:right-6 sm:top-6"
              aria-label="关闭大图预览"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </ClientPortal>
      )}
    </div>
  );
}
