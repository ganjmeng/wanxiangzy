"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronRight, Loader2, Plus, Wand, X, XCircle, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { FeatureTabs } from "@/components/FeatureTabs";
import { ClientPortal } from "@/components/ClientPortal";
import { ModuleHeader } from "@/components/ModuleHeader";
import { PreviewGuide } from "@/components/PreviewGuide";
import { ErrorStage } from "@/components/studio/ErrorStage";
import { ModuleTaskRail } from "@/components/studio/ModuleTaskRail";
import { useStudioAuth } from "@/components/studio/useStudioAuth";
import type { TaskSelectionSession } from "@/components/studio/useTaskSelectionSession";
import { StudioGenerationCountSelector, StudioModelSelector, StudioOptionGrid, StudioPromptTextarea } from "@/components/studio/StudioFormControls";
import { StudioRunBar } from "@/components/studio/StudioRunBar";
import { StudioUploadSection } from "@/components/studio/StudioUploadSection";
import { StudioUploadTile } from "@/components/studio/StudioUploadTile";
import { RawPreviewImage } from "@/components/studio/RawPreviewImage";
import { useTaskQueueGeneration } from "@/components/studio/useTaskQueueGeneration";
import { ResultImageGrid } from "@/components/ResultImageGrid";
import { StudioImagePreviewDialog } from "@/components/studio/StudioImagePreviewDialog";
import { setCachedProfileCredits } from "@/lib/supabase/client";
import { MAX_FILE_SIZE, MAX_FILE_SIZE_MB, uploadImage } from "@/lib/utils";
import { getCreditCost, getSupportedImageSizes, type AspectRatio, type ImageSize, type LingyaModel } from "@/lib/api/lingya";
import { fetchHistoryApplyDetail, getHistoryApplyFailureMessage, isHistoryApplyRowFailed, takeApplyDetail, type HistoryJobPayload } from "@/lib/history-apply";
import { clampTaskExpectedCount, safeTaskQueueUrls, type TaskQueueItem } from "@/lib/task-queue";
import { GARMENT_TYPE_OPTIONS, type GarmentType } from "@/lib/garment-types";
import { showInsufficientCreditsToast } from "@/lib/ui/credit-copy";
import { createGenericImagePreviewSession, type ImagePreviewAction } from "@/lib/studio-image-preview";
import { FAILED_RETRY_NOTICE, buildPartialFailureDetail, summarizeGenerationError } from "@/lib/studio-generation-feedback";
import {
  buildRetryPendingResultUrls,
  getRetryDisplayExpectedCount,
  mergeRetryResultUrls,
  normalizeRetryResultIndex,
} from "@/lib/result-slot-retry";
import {
  DEFAULT_GARMENT_3D_DISPLAY_STYLE,
  GARMENT_3D_DISPLAY_STYLES,
  buildGarment3dDisplayStylePrompt,
  normalizeGarment3dDisplayStyle,
  type Garment3dDisplayStyle,
} from "@/lib/module-style-presets";
import { GARMENT_3D_UPLOAD_RULE, type Garment3dRuleDemo } from "@/lib/garment-3d-upload-rules";

type OutputMode = "reference" | "prompt";
type Garment3dHistoryPayload = Extract<HistoryJobPayload, { kind: "garment3d" }>;
type Garment3dGenerateOptions = {
  genCountOverride?: number;
  expectedCountOverride?: number;
  retryResultIndex?: number;
  toastMessage?: string;
};

const DEFAULT_PROMPT = "衣服变为类似穿在人身上的立体效果，微微向左旋转，保留原始版型、面料厚度、纹理和所有细节，使用干净白色或浅灰棚拍背景。";
const GARMENT_3D_QUALITY =
  "photorealistic, 8K ultra-detailed, RAW photo quality, high contrast, commercial e-commerce catalog quality, sharp fabric details";

const MODELS: { value: LingyaModel; label: string; desc: string; badge?: string; icon: string }[] = [
  { value: "nano-banana-2", label: "Nano-Banana-2", desc: "最高4K", badge: "推荐", icon: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/model-icons/gemini.png" },
  { value: "gpt-image-2", label: "GPT-Image-2", desc: "最高4K", badge: "最新", icon: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/model-icons/openai.svg" },
  { value: "nano-banana-pro", label: "Nano-Banana-Pro", desc: "最高4K", badge: "推荐", icon: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/model-icons/gemini.png" },
];

const SITE_ASSET_BASE = "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original";

const GARMENT_3D_PREVIEW_ACTIONS: ImagePreviewAction[] = [
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

const REFERENCE_PRESETS = [
  { id: "r1", label: "灰色连帽", url: `${SITE_ASSET_BASE}/references/garment-3d/ref-01.webp` },
  { id: "r2", label: "立体牛仔", url: `${SITE_ASSET_BASE}/references/garment-3d/ref-02.png` },
  { id: "r3", label: "棒球外套", url: `${SITE_ASSET_BASE}/references/garment-3d/ref-03.png` },
  { id: "r4", label: "直筒裤装", url: `${SITE_ASSET_BASE}/references/garment-3d/ref-04.png` },
  { id: "r5", label: "纹理卫衣", url: `${SITE_ASSET_BASE}/references/garment-3d/ref-05.png` },
  { id: "r6", label: "敞开夹克", url: `${SITE_ASSET_BASE}/references/garment-3d/ref-06.png` },
  { id: "r7", label: "侧身外套", url: `${SITE_ASSET_BASE}/references/garment-3d/ref-07.png` },
  { id: "r8", label: "羽绒厚度", url: `${SITE_ASSET_BASE}/references/garment-3d/ref-08.png` },
  { id: "r9", label: "背面廓形", url: `${SITE_ASSET_BASE}/references/garment-3d/ref-09.jpg` },
  { id: "r10", label: "短外套", url: `${SITE_ASSET_BASE}/references/garment-3d/ref-10.png` },
];

export default function Garment3dPage() {
  const router = useRouter();
  const garmentInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
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

  const [garmentUrl, setGarmentUrl] = useState("");
  const [garmentName, setGarmentName] = useState("");
  const [garmentType, setGarmentType] = useState<GarmentType>("上装");
  const [customGarmentType, setCustomGarmentType] = useState("");
  const [outputMode, setOutputMode] = useState<OutputMode>("reference");
  const [displayStyle, setDisplayStyle] = useState<Garment3dDisplayStyle>(DEFAULT_GARMENT_3D_DISPLAY_STYLE);
  const [selectedReference, setSelectedReference] = useState(REFERENCE_PRESETS[0]);
  const [customReferenceUrl, setCustomReferenceUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [promptOverride, setPromptOverride] = useState<string | null>(null);

  const [aiModel, setAiModel] = useState<LingyaModel>("nano-banana-2");
  const [aspectRatio, setAspectRatio] = useState<Extract<AspectRatio, "auto" | "1:1" | "3:4">>("auto");
  const [imageSize, setImageSize] = useState<ImageSize>("1K");
  const [genCount, setGenCount] = useState(1);

  const [isDragging, setIsDragging] = useState(false);
  const [isUploadingGarment, setIsUploadingGarment] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [, setProgress] = useState(0);
  const [resultUrls, setResultUrls] = useState<string[]>([]);
  const [runningExpectedCount, setRunningExpectedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [showGarmentRules, setShowGarmentRules] = useState(false);
  const [rulesPopoverStyle, setRulesPopoverStyle] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  const imageSizes = getSupportedImageSizes(aiModel, aspectRatio);
  const costPerImage = getCreditCost(aiModel, imageSize, aspectRatio);
  const totalCost = costPerImage * genCount;
  const activeReferenceUrl = customReferenceUrl || selectedReference.url;
  const authIsAnonymous = authChecked && !isAuthenticated;
  const taskInputThumbnails = useMemo(
    () => [garmentUrl, outputMode === "reference" ? activeReferenceUrl : ""].filter(Boolean) as string[],
    [garmentUrl, outputMode, activeReferenceUrl]
  );
  const taskQueue = useTaskQueueGeneration({
    module: "garment3d",
    title: "服装 3D",
    defaultExpectedCount: genCount,
    applyPath: "/garment-3d",
  });

  const builtPrompt = useMemo(() => {
    return buildGarment3dPrompt({
      garmentType: garmentType === "其他" ? customGarmentType || "其他服装" : garmentType,
      outputMode,
      displayStyle,
      hasReference: outputMode === "reference" && !!activeReferenceUrl,
      prompt,
    });
  }, [activeReferenceUrl, customGarmentType, displayStyle, garmentType, outputMode, prompt]);
  const finalPrompt = promptOverride ?? builtPrompt;
  const displayStyleLabel = GARMENT_3D_DISPLAY_STYLES.find((item) => item.value === displayStyle)?.label || displayStyle;
  const activeResultExpectedCount = isGenerating
    ? runningExpectedCount || genCount
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
    void generate(undefined, {
      genCountOverride: 1,
      expectedCountOverride: 1,
      retryResultIndex: index,
      toastMessage: `正在补位重试第 ${index + 1} 张，失败图已退款，完成后会回填到当前结果中...`,
    });
  }
  const previewSession = useMemo(
    () => createGenericImagePreviewSession({
      module: "garment3d",
      title: "服装 3D",
      urls: resultUrls,
      expectedCount: activeResultExpectedCount,
      isGenerating,
      statusGroup: isGenerating ? "running" : undefined,
      references: [
        ...(garmentUrl ? [{ url: garmentUrl, label: "服装图", role: "garment" as const }] : []),
        ...(outputMode === "reference" && activeReferenceUrl ? [{ url: activeReferenceUrl, label: customReferenceUrl ? "自定义立体参考" : selectedReference.label, role: "reference" as const }] : []),
      ],
      promptText: prompt.trim() && prompt.trim() !== DEFAULT_PROMPT ? prompt : "",
      metaItems: [
        { label: "服装类型", value: garmentType === "其他" ? customGarmentType : garmentType },
        { label: "输出方式", value: outputMode === "reference" ? "参考图控制" : "提示词控制" },
        { label: "展示风格", value: displayStyleLabel },
        { label: "模型", value: aiModel },
        { label: "比例", value: aspectRatio },
        { label: "分辨率", value: imageSize },
        { label: "生成数量", value: genCount },
      ],
      resultTitlePrefix: "服装 3D 结果",
      aspectRatio,
    }),
    [activeReferenceUrl, activeResultExpectedCount, aiModel, aspectRatio, customGarmentType, customReferenceUrl, displayStyleLabel, garmentType, garmentUrl, genCount, imageSize, isGenerating, outputMode, prompt, resultUrls, selectedReference.label]
  );
  const runDisabledReason = !garmentUrl
    ? "请先上传服装图"
    : credits !== null && credits < totalCost
      ? `灵点不足，生成需要 ${totalCost} 灵点`
      : undefined;

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
    setShowGarmentRules(true);
  };

  const scheduleRulesHide = () => {
    cancelRulesHide();
    rulesHideTimerRef.current = setTimeout(() => {
      setShowGarmentRules(false);
      setRulesPopoverStyle(null);
    }, 120);
  };

  useEffect(() => {
    return () => cancelRulesHide();
  }, []);

  useEffect(() => {
    const nextSizes = getSupportedImageSizes(aiModel, aspectRatio);
    if (!nextSizes.includes(imageSize)) setImageSize(nextSizes[0]);
  }, [aiModel, aspectRatio, imageSize]);

  function applyGarment3dHistoryPayload(payload: Garment3dHistoryPayload, historyResultUrls: string[] = [], options?: { silent?: boolean }) {
    setGarmentUrl(payload.garmentUrl);
    setGarmentName("历史服装图");
    setGarmentType(
      payload.garmentType === "上装" || payload.garmentType === "下装" || payload.garmentType === "连体衣"
        ? payload.garmentType
        : "其他"
    );
    setCustomGarmentType(
      payload.garmentType && !["上装", "下装", "连体衣"].includes(payload.garmentType)
        ? payload.garmentType
        : ""
    );
    setOutputMode(payload.outputMode || (payload.referenceUrl ? "reference" : "prompt"));
    setDisplayStyle(normalizeGarment3dDisplayStyle(payload.displayStyle));
    setCustomReferenceUrl(payload.referenceUrl || "");
    setAiModel(payload.aiModel);
    setAspectRatio(payload.aspectRatio === "auto" || payload.aspectRatio === "1:1" ? payload.aspectRatio : "3:4");
    setImageSize(payload.imageSize);
    setGenCount(payload.genCount);
    setPrompt(payload.userPrompt || payload.prompt);
    setPromptOverride(payload.prompt);
    setRunningExpectedCount(null);
    setResultUrls(historyResultUrls);
    setIsGenerating(false);
    setProgress(historyResultUrls.length ? 100 : 0);
    setError(null);
    if (!options?.silent) toast.success("已套用历史参数");
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const detail = await takeApplyDetail("garment3d");
      if (cancelled || !detail) return;
      applyGarment3dHistoryPayload(detail.payload, detail.resultUrls);
      if (isHistoryApplyRowFailed(detail.row)) {
        setError(getHistoryApplyFailureMessage(detail.row));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleGarmentFiles(files: FileList | File[]) {
    const file = Array.from(files)[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("请上传图片文件");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(`图片不能超过 ${MAX_FILE_SIZE_MB}MB`);
      return;
    }

    setGarmentName(file.name);

    toast.info("正在上传服装图...");
    setIsUploadingGarment(true);
    try {
      const result = await uploadImage(file);
      setGarmentUrl(result.url);
      toast.success("服装图已准备");
    } catch {
      setGarmentUrl("");
      toast.error("服装图上传失败，请重试");
    } finally {
      setIsUploadingGarment(false);
    }
  }

  async function handleCustomReference(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("请上传图片文件");
      return;
    }
    setPromptOverride(null);

    toast.info("正在上传参考图...");
    try {
      const result = await uploadImage(file);
      setCustomReferenceUrl(result.url);
      toast.success("参考图已选择");
    } catch {
      setCustomReferenceUrl("");
      toast.error("参考图上传失败，请重试");
    }
  }

  const base64Cache = useRef<Map<string, string>>(new Map());
  async function urlToBase64(url: string) {
    if (url.startsWith("data:")) return url;
    if (url.startsWith("http")) return url;
    const cached = base64Cache.current.get(url);
    if (cached) return cached;
    const res = await fetch(url);
    const blob = await res.blob();
    const result = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
    base64Cache.current.set(url, result);
    return result;
  }

  async function optimizePrompt() {
    if (!garmentUrl) {
      toast.error("请先上传服装图");
      return;
    }

    setIsOptimizing(true);
    try {
      const res = await fetch("/api/garment-3d/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          garment_url: garmentUrl,
          garment_type: garmentType,
          custom_garment_type: customGarmentType,
          display_style: displayStyle,
          prompt: finalPrompt,
        }),
      });
      const data = await res.json();
      if (data.prompt) {
        const optimizedPrompt = buildGarment3dPrompt({
          garmentType: garmentType === "其他" ? customGarmentType || "其他服装" : garmentType,
          outputMode,
          displayStyle,
          hasReference: outputMode === "reference" && !!activeReferenceUrl,
          prompt: data.prompt,
        });
        setPrompt(data.prompt);
        setPromptOverride(optimizedPrompt);
        toast.success("视觉分析已优化提示词");
      } else {
        toast.error("暂时没有返回优化结果");
      }
    } catch {
      toast.error("优化失败");
    } finally {
      setIsOptimizing(false);
    }
  }

  async function generate(finalPromptForRun?: string, options: Garment3dGenerateOptions = {}) {
    if (!isAuthenticated && !(await refreshAuth())) {
      toast.error("请先登录");
      router.push("/login");
      return;
    }
    if (!garmentUrl) {
      toast.error("请上传服装图");
      return;
    }
    if (garmentType === "其他" && !customGarmentType.trim()) {
      toast.error("请输入自定义服装类型");
      return;
    }
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

    setIsGenerating(true);
    setRunningExpectedCount(displayExpectedCount);
    setProgress(12);
    setResultUrls(buildRetryPendingResultUrls(retryPreviousResultUrls, retryResultIndex, displayExpectedCount));
    setError(null);
    if (options.toastMessage) toast.info(options.toastMessage);

    const provisionalTask = taskQueue.startTask({
      expectedCount: displayExpectedCount,
      inputThumbnails: taskInputThumbnails,
      progress: 12,
    });
    let activeTaskId = provisionalTask.id;
    let latestTaskResultUrls: string[] = [];

    try {
      const submittedFinalPrompt = typeof finalPromptForRun === "string" ? finalPromptForRun : finalPrompt;
      const referencePayload = outputMode === "reference" ? await urlToBase64(activeReferenceUrl) : null;
      const res = await fetch("/api/garment-3d", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          garment_url: garmentUrl,
          garment_type: garmentType,
          custom_garment_type: customGarmentType,
          output_mode: outputMode,
          display_style: displayStyle,
          reference_url: referencePayload,
          ai_model: aiModel,
          aspect_ratio: aspectRatio,
          image_size: imageSize,
          prompt,
          final_prompt: submittedFinalPrompt,
          gen_count: runGenCount,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          taskQueue.removeTask(activeTaskId);
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
        const initialResultUrls = mergeRetryResultUrls(
          retryPreviousResultUrls,
          retryResultIndex,
          Array.isArray(data.result_urls) ? data.result_urls : [],
          displayExpectedCount
        );
        const serverTask = taskQueue.replaceWithServerTask(activeTaskId, {
          id: data.generation_id,
          expectedCount: displayExpectedCount,
          inputThumbnails: taskInputThumbnails,
          status: data.status || "processing",
          progress: data.status === "completed" ? 100 : 25,
          resultThumbnails: initialResultUrls,
          resultCount: initialResultUrls.filter(Boolean).length,
        });
        activeTaskId = serverTask.id;
      }

      if (data.status === "completed") {
        const finalUrls = mergeRetryResultUrls(
          retryPreviousResultUrls,
          retryResultIndex,
          Array.isArray(data.result_urls) ? data.result_urls : [],
          displayExpectedCount
        );
        latestTaskResultUrls = finalUrls;
        const finalResultCount = finalUrls.filter(Boolean).length;
        const completedError = data.error || "";
        setProgress(100);
        setResultUrls(finalUrls);
        taskQueue.markCompleted(activeTaskId, {
          expectedCount: displayExpectedCount,
          inputThumbnails: taskInputThumbnails,
          resultThumbnails: finalUrls,
          resultCount: finalResultCount,
          error: completedError ? summarizeGenerationError(completedError) : "",
        });
        if (completedError || finalResultCount < displayExpectedCount) {
          void refreshCredits();
          toast.warning(`服装 3D 部分完成：已生成 ${finalResultCount}/${displayExpectedCount} 张，失败图片灵点会自动退回`);
        } else {
          toast.success("服装转3D完成");
        }
        return;
      }

      let attempts = 0;
      while (attempts < 120) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        attempts++;
        const fallbackProgress = Math.min(18 + attempts * 1.6, 92);
        let runningProgress = fallbackProgress;
        setProgress(fallbackProgress);

        const poll = await fetch(`/api/garment-3d?generation_id=${data.generation_id}`);
        if (!poll.ok) continue;
        const pollData = await poll.json();
        if (Array.isArray(pollData.result_urls) && pollData.result_urls.length) {
          latestTaskResultUrls = mergeRetryResultUrls(retryPreviousResultUrls, retryResultIndex, pollData.result_urls, displayExpectedCount);
          setResultUrls(latestTaskResultUrls);
        }
        const nextProgress = Number(pollData.progress);
        if (Number.isFinite(nextProgress)) {
          runningProgress = Math.min(Math.max(Math.round(nextProgress), 0), 99);
          setProgress(runningProgress);
        }
        taskQueue.markRunning(activeTaskId, {
          expectedCount: displayExpectedCount,
          inputThumbnails: taskInputThumbnails,
          resultThumbnails: latestTaskResultUrls,
          resultCount: latestTaskResultUrls.filter(Boolean).length,
          progress: runningProgress,
          status: pollData.status || "processing",
        });

        if (pollData.status === "completed") {
          const finalUrls = mergeRetryResultUrls(
            retryPreviousResultUrls,
            retryResultIndex,
            Array.isArray(pollData.result_urls) ? pollData.result_urls : latestTaskResultUrls,
            displayExpectedCount
          );
          latestTaskResultUrls = finalUrls;
          const finalResultCount = finalUrls.filter(Boolean).length;
          const partialFailure = pollData.partial_failure && typeof pollData.partial_failure === "object"
            ? pollData.partial_failure as { message?: unknown }
            : null;
          const completedError = pollData.error || partialFailure?.message || "";
          setProgress(100);
          setResultUrls(finalUrls);
          taskQueue.markCompleted(activeTaskId, {
            expectedCount: displayExpectedCount,
            inputThumbnails: taskInputThumbnails,
            resultThumbnails: finalUrls,
            resultCount: finalResultCount,
            error: completedError ? summarizeGenerationError(completedError) : "",
          });
          if (completedError || finalResultCount < displayExpectedCount) {
            void refreshCredits();
            toast.warning(`服装 3D 部分完成：已生成 ${finalResultCount}/${displayExpectedCount} 张，失败图片灵点会自动退回`);
          } else {
            toast.success("服装转3D完成");
          }
          return;
        }
        if (pollData.status === "failed") {
          throw new Error(pollData.error || "生成失败");
        }
      }
      throw new Error("生成超时");
    } catch (err: unknown) {
      const message = summarizeGenerationError(err instanceof Error ? err.message : "操作失败");
      setError(message);
      taskQueue.markFailed(activeTaskId, message, {
        expectedCount: displayExpectedCount,
        inputThumbnails: taskInputThumbnails,
        resultThumbnails: latestTaskResultUrls,
        resultCount: latestTaskResultUrls.filter(Boolean).length,
      });
      toast.error(message);
      void refreshCredits();
    } finally {
      setIsGenerating(false);
    }
  }

  function applyRuleDemo(demo: Garment3dRuleDemo) {
    setGarmentUrl(demo.imageUrl);
    setGarmentName(demo.title);
    setGarmentType(demo.garmentType);
    setPromptOverride(null);
    setShowGarmentRules(false);
    setRulesPopoverStyle(null);
    toast.success(`已套用${demo.title}`);
  }

  function handleRunningTask(item: TaskQueueItem) {
    const urls = safeTaskQueueUrls(item.resultThumbnails);
    const nextProgress = Number.isFinite(Number(item.progress)) ? Number(item.progress) : 8;
    setRunningExpectedCount(clampTaskExpectedCount(item, 1, 4));
    setIsGenerating(true);
    setProgress(Math.min(Math.max(Math.round(nextProgress), 1), 99));
    setResultUrls(urls);
    setError(null);
  }

  async function handleCompletedTask(item: TaskQueueItem, session: TaskSelectionSession) {
    try {
      const detail = await fetchHistoryApplyDetail(item.id, "garment3d", session.signal);
      if (!session.isCurrent()) return true;
      applyGarment3dHistoryPayload(detail.payload, detail.resultUrls.length ? detail.resultUrls : safeTaskQueueUrls(item.resultThumbnails), {
        silent: session.reason === "restore",
      });
      if (item.statusGroup === "failed" || isHistoryApplyRowFailed(detail.row)) {
        setError(getHistoryApplyFailureMessage(detail.row, item.error || "生成失败"));
      }
      return true;
    } catch (err) {
      if (session.signal.aborted || !session.isCurrent()) return true;
      toast.error(err instanceof Error ? err.message : "历史任务加载失败");
      return true;
    }
  }

  function handleContinueCreate() {
    setGarmentUrl("");
    setGarmentName("");
    setGarmentType("上装");
    setCustomGarmentType("");
    setOutputMode("reference");
    setDisplayStyle(DEFAULT_GARMENT_3D_DISPLAY_STYLE);
    setSelectedReference(REFERENCE_PRESETS[0]);
    setCustomReferenceUrl("");
    setPrompt("");
    setPromptOverride(null);
    setAiModel("nano-banana-2");
    setAspectRatio("auto");
    setImageSize("1K");
    setGenCount(1);
    setIsGenerating(false);
    setRunningExpectedCount(null);
    setProgress(0);
    setResultUrls([]);
    setError(null);
    setLightboxSrc(null);
    setShowGarmentRules(false);
    setRulesPopoverStyle(null);
    if (garmentInputRef.current) garmentInputRef.current.value = "";
    if (referenceInputRef.current) referenceInputRef.current.value = "";
  }

  return (
    <div className="studio-workbench min-h-[calc(100dvh-64px)] lg:h-[calc(100vh-64px)] flex flex-col lg:flex-row">
      <FeatureTabs active="garment3d" />
      <ModuleTaskRail
        module="garment3d"
        moduleLabel="服装 3D"
        onContinue={handleContinueCreate}
        onRunningTask={handleRunningTask}
        onCompletedTask={handleCompletedTask}
      />
      <div className="studio-parameters w-full lg:w-[472px] border-b lg:border-b-0 lg:border-r flex flex-col overflow-visible lg:overflow-hidden">
        <div className="studio-parameters-scroll flex-1 overflow-visible lg:overflow-y-auto p-3 sm:p-5 space-y-4 sm:space-y-6">
          <ModuleHeader
            title="服装 3D"
            tooltip="上传单张清晰服装图，将平铺、挂拍或人台服装转成更有厚度、体积和材质表达的商品展示图。"
            actions={(
              <button
                ref={rulesButtonRef}
                type="button"
                onMouseEnter={openRulesPopover}
                onMouseLeave={scheduleRulesHide}
                onFocus={openRulesPopover}
                onBlur={scheduleRulesHide}
                aria-expanded={showGarmentRules}
                className="studio-upload-rule-button"
              >
                图片规则 <ChevronRight className="h-3 w-3" />
              </button>
            )}
          />
          <StudioUploadSection
            title="上传服装图"
            inputRef={garmentInputRef}
            isDragging={isDragging}
            setDragging={setIsDragging}
            onFiles={handleGarmentFiles}
          >
            {(openFileDialog, dragContext) => (
              <>
                <StudioUploadTile
                  title="上传单件衣服平铺图"
                  description="建议单件商品、主体完整、边缘清晰，避免套装和复杂背景。"
                  imageUrl={garmentUrl || null}
                  imageAlt="已上传服装图"
                  isDragging={isDragging}
                  loading={isUploadingGarment}
                  onUploadClick={openFileDialog}
                  onLibraryClick={() => toast.info("作品库选择即将接入")}
                  onPreview={garmentUrl ? () => setLightboxSrc(garmentUrl) : undefined}
                  onRemove={garmentUrl ? () => {
                    setGarmentUrl("");
                    setGarmentName("");
                  } : undefined}
                  onDropFile={(file) => handleGarmentFiles(file ? [file] : [])}
                  dragContext={dragContext}
                  uploadLabel="从本地上传"
                  libraryLabel="从作品选择"
                  footnote={garmentUrl ? garmentName || "已上传图片" : "单件商品、边缘清晰、背景干净，更容易还原版型、厚度和材质。"}
                  examples={{
                    label: "试一试",
                    images: GARMENT_3D_UPLOAD_RULE.demos.map((demo) => ({ url: demo.imageUrl, title: demo.title })),
                    onSelect: (image) => {
                      const demo = GARMENT_3D_UPLOAD_RULE.demos.find((item) => item.imageUrl === image.url);
                      if (demo) applyRuleDemo(demo);
                    },
                  }}
                />
              </>
            )}
          </StudioUploadSection>

          <section>
            <h3 className="font-bold text-sm mb-3">上传的服装类型</h3>
            <StudioOptionGrid
              options={GARMENT_TYPE_OPTIONS.map((type) => ({
                value: type,
                label: type,
              }))}
              value={garmentType}
              onChange={setGarmentType}
              columns={4}
              ariaLabel="上传的服装类型"
            />
            {garmentType === "其他" && (
              <input
                value={customGarmentType}
                onChange={(e) => setCustomGarmentType(e.target.value)}
                placeholder="例如：斗篷、围巾、礼服套装"
                className="studio-text-input mt-2"
              />
            )}
          </section>

          <section>
            <h3 className="font-bold text-sm mb-3">出图模式</h3>
            <StudioOptionGrid
              options={[
                { value: "reference" as const, label: "选择参考图" },
                { value: "prompt" as const, label: "自定义提示词" },
              ]}
              value={outputMode}
              onChange={(nextMode) => {
                setOutputMode(nextMode);
                setPromptOverride(null);
                if (nextMode === "reference" && prompt.trim() === DEFAULT_PROMPT) setPrompt("");
                if (nextMode === "prompt" && !prompt.trim()) setPrompt(DEFAULT_PROMPT);
              }}
              columns={2}
              ariaLabel="出图模式"
              className="mb-3"
            />

            {outputMode === "reference" && (
              <div className="space-y-3">
                <div className="grid grid-cols-5 gap-2">
                  {REFERENCE_PRESETS.map((ref) => (
                    <button
                      key={ref.id}
                      onClick={() => { setSelectedReference(ref); setCustomReferenceUrl(""); setPromptOverride(null); }}
                      className={`group relative aspect-square rounded-lg overflow-hidden border bg-gray-50 ${
                        !customReferenceUrl && selectedReference.id === ref.id ? "border-purple-500 ring-2 ring-purple-100" : "border-gray-200"
                      }`}
                      title={ref.label}
                    >
                      <RawPreviewImage src={ref.url} alt={ref.label} className="w-full h-full object-cover" />
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); setLightboxSrc(ref.url); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            setLightboxSrc(ref.url);
                          }
                        }}
                        className="absolute right-1.5 top-1.5 w-7 h-7 rounded-full bg-white/90 text-gray-700 shadow-sm opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity flex items-center justify-center hover:bg-white"
                        title="放大预览"
                      >
                        <ZoomIn className="w-3.5 h-3.5" />
                      </span>
                    </button>
                  ))}
                  <button
                    onClick={() => referenceInputRef.current?.click()}
                    className={`aspect-square rounded-lg border-2 border-dashed flex items-center justify-center ${
                      customReferenceUrl ? "border-zinc-950 bg-zinc-50" : "border-gray-200"
                    }`}
                    title="上传参考图"
                  >
                    <Plus className="w-5 h-5 text-gray-400" />
                  </button>
                </div>
                <input
                  ref={referenceInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const input = event.currentTarget;
                    void handleCustomReference(input.files?.[0]).finally(() => {
                      input.value = "";
                    });
                  }}
                />
                <p className="text-[11px] text-gray-400">参考图用于锁定立体风格和角度，不会替换用户服装的款式和颜色。</p>
              </div>
            )}

            <div className="mt-3">
              <h3 className="font-bold text-sm mb-3">展示质感</h3>
              <StudioOptionGrid
                options={GARMENT_3D_DISPLAY_STYLES.map((style) => ({
                  value: style.value,
                  label: style.label,
                  description: style.desc,
                }))}
                value={displayStyle}
                onChange={(nextStyle) => {
                  setDisplayStyle(nextStyle);
                  setPromptOverride(null);
                }}
                columns={2}
                ariaLabel="展示质感"
              />
              <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
                质感档位只控制棚拍、体积和材质表现；图1服装款式、颜色、logo 和细节必须优先保留。
              </p>
            </div>

            <div className="relative mt-3">
              <StudioPromptTextarea
                title={outputMode === "reference" ? "补充生成要求" : "描述3D效果"}
                badge={outputMode === "reference" ? "可选" : undefined}
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); setPromptOverride(null); }}
                placeholder={outputMode === "reference"
                  ? "可补充角度、厚度、背景、布料质感等要求；参考图只负责立体结构和棚拍光影"
                  : "描述衣服的立体角度、厚度、旋转方向、背景风格等"}
                rows={4}
                description={outputMode === "reference"
                  ? "参考图用于锁定立体感、厚度、空间角度和棚拍光影；这里输入的文字会作为额外生成要求一起进入最终提示词。"
                  : undefined}
                action={(
                  <button
                    type="button"
                    onClick={optimizePrompt}
                    disabled={isOptimizing || !garmentUrl}
                    className="studio-prompt-icon-action"
                    title="视觉分析优化提示词"
                  >
                    {isOptimizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand className="w-3.5 h-3.5" />}
                  </button>
                )}
              />
            </div>
          </section>

          <section>
            <h3 className="font-bold text-sm mb-3">生成模型</h3>
            <StudioModelSelector
              models={MODELS}
              value={aiModel}
              onChange={setAiModel}
              ariaLabel="生成模型"
            />
          </section>

          <section>
            <h3 className="font-bold text-sm mb-3">图片比例</h3>
            <StudioOptionGrid
              options={[
                { value: "auto", label: "智能" },
                { value: "1:1", label: "1:1 方图" },
                { value: "3:4", label: "3:4 竖版" },
              ] as const}
              value={aspectRatio}
              onChange={setAspectRatio}
              columns={2}
              ariaLabel="图片比例"
            />
          </section>

          <section>
            <h3 className="font-bold text-sm mb-3">分辨率</h3>
            <StudioOptionGrid
              options={imageSizes.map((size) => ({
                value: size,
                label: `${size} · ${getCreditCost(aiModel, size, aspectRatio)}灵点`,
              }))}
              value={imageSize}
              onChange={setImageSize}
              columns={2}
              ariaLabel="分辨率"
            />
          </section>
          <section>
            <h3 className="font-bold text-sm mb-3">生成数量</h3>
            <StudioGenerationCountSelector
              value={genCount}
              onChange={setGenCount}
              ariaLabel="生成数量"
            />
          </section>
        </div>

        <StudioRunBar
          summary={`${costPerImage} × ${genCount} 张`}
          costLabel={authIsAnonymous ? "登录后查看灵点" : `消耗 ${totalCost} · 余额 ${credits ?? "-"}`}
          disabled={isGenerating || Boolean(runDisabledReason)}
          disabledReason={runDisabledReason}
          primaryLabel={authIsAnonymous ? "登录后生成" : isGenerating ? "生成中..." : `生成 ${genCount} 张`}
          isLoading={isGenerating}
          onPrimaryAction={() => generate()}
        />
      </div>

      <div className="studio-canvas min-h-[260px] sm:min-h-[360px] lg:min-h-0 flex-1 relative overflow-hidden mt-3 mb-6 lg:mt-0 lg:mb-0">
        {!isGenerating && resultUrls.length === 0 && !error && (
          <div className="studio-empty-stage min-h-[260px] sm:min-h-[360px] lg:h-full flex items-center justify-center px-4">
            <PreviewGuide
              title="服装转 3D 商品图"
              subtitle="把平铺、挂拍或人台图转成更有厚度、体积和材质表现的棚拍商品图。"
              imageSrc="https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/garment-blue-hoodie-3d.png"
              imageAlt="服装3D指引"
              steps={[
                { title: "上传服装图", desc: "建议单件商品、主体完整、边缘清晰，避免复杂背景和套装。" },
                { title: "选择类型 / 风格", desc: "确认上装、下装、连体衣等类型，可上传立体参考图辅助角度。" },
                { title: "生成立体展示", desc: "保留原始版型、面料纹理和细节，输出干净商业棚拍效果。" },
              ]}
            />
          </div>
        )}

        {(isGenerating || resultUrls.length > 0) && (
          <div className="studio-result-stage min-h-[260px] sm:min-h-[360px] overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:h-full animate-fade-in">
            <div className="flex min-h-full items-start justify-start">
              <ResultImageGrid
                urls={resultUrls}
                filenamePrefix="garment-3d"
                expectedCount={activeResultExpectedCount}
                isGenerating={isGenerating}
                inputThumbnails={taskInputThumbnails}
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
              filenamePrefix="garment-3d"
              actions={GARMENT_3D_PREVIEW_ACTIONS}
              onRegenerateAll={() => { setResultUrls([]); setProgress(0); }}
            />
          </div>
        )}

        {error && (
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

      {showGarmentRules && rulesPopoverStyle && (
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
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-700">{GARMENT_3D_UPLOAD_RULE.shortTitle}</p>
                <h3 className="mt-1 text-base font-bold text-slate-950">{GARMENT_3D_UPLOAD_RULE.title}</h3>
                <p className="mt-1 text-xs text-slate-500">{GARMENT_3D_UPLOAD_RULE.uploadSpecText}</p>
              </div>
              <span className="rounded-full bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-700">Hover 预览</span>
            </div>

            <div className="studio-scrollbar-hide overflow-y-auto px-5 py-4" style={{ maxHeight: rulesPopoverStyle.maxHeight - 88 }}>
              <div className="grid gap-3 md:grid-cols-5">
                {GARMENT_3D_UPLOAD_RULE.demos.map((demo) => (
                  <div key={demo.imageUrl} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-2">
                    <div className="relative overflow-hidden rounded-xl bg-white">
                      <RawPreviewImage src={demo.imageUrl} alt={demo.title} className="aspect-square w-full object-cover" />
                      <CheckCircle2 className="absolute right-2 top-2 h-5 w-5 rounded-full bg-white text-emerald-500" />
                    </div>
                    <p className="mt-2 truncate text-xs font-medium text-slate-700">{demo.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-slate-400">{demo.description}</p>
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
                <p className="mb-3 text-center text-xs font-medium text-slate-500">{GARMENT_3D_UPLOAD_RULE.deprecatedTitle}</p>
                <div className="mx-auto grid max-w-lg grid-cols-3 gap-3">
                  {GARMENT_3D_UPLOAD_RULE.deprecatedImages.map((image) => (
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
          <div className="fixed inset-0 z-[180] flex cursor-zoom-out items-center justify-center bg-slate-950/66 p-4 backdrop-blur-xl sm:p-8" onClick={() => setLightboxSrc(null)}>
            <RawPreviewImage src={lightboxSrc} alt="服装 3D 预览" className="max-h-full max-w-full rounded-2xl object-contain shadow-[0_32px_120px_rgba(0,0,0,0.45)]" />
            <button onClick={() => setLightboxSrc(null)} className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/85 bg-white/90 text-slate-700 shadow-[0_12px_34px_rgba(15,23,42,0.22)] backdrop-blur transition-colors hover:bg-white hover:text-slate-950 sm:right-6 sm:top-6">
              <X className="w-5 h-5" />
            </button>
          </div>
        </ClientPortal>
      )}
    </div>
  );
}

function buildGarment3dPrompt(params: {
  garmentType: string;
  outputMode: OutputMode;
  displayStyle: Garment3dDisplayStyle;
  hasReference: boolean;
  prompt: string;
}) {
  const roles = params.hasReference
    ? "图像角色：图1是用户上传的服装图，图2是3D立体效果参考图。"
    : "图像角色：图1是用户上传的服装图。";
  const referenceLine = params.hasReference
    ? "参考图2只用于学习立体角度、布料厚度、支撑形态、阴影结构和商业棚拍光影，不参考图2的背景元素、颜色、图案、文字或具体款式。"
    : "按照用户提示生成类似穿在人身上的3D立体展示效果，使用干净白色背景。";
  const backgroundLine = "画面要求：主体居中，边缘干净，真实商业棚拍质感，柔和自然阴影，背景使用干净白色或浅灰棚拍背景，不带场景杂物。";
  const userRequirement = params.prompt.trim()
    ? `用户补充要求：${params.prompt.trim()}`
    : params.hasReference
      ? "用户补充要求：无，优先按照图2的立体角度、厚度、支撑形态和棚拍光影生成。"
      : `用户要求：${DEFAULT_PROMPT}`;

  return `${roles}
任务：将图1的${params.garmentType || "服装"}从平面图或人台图转换为无真人、无头部、无脸、无手的3D立体服装展示图。
${referenceLine}
严格保留图1服装的版型、颜色、材质、纹理、图案、纽扣、拉链、口袋、帽绳、袖口、裤腰、裤脚等细节。
${buildGarment3dDisplayStylePrompt(params.displayStyle)}
${userRequirement}
${backgroundLine}
图像质量：${GARMENT_3D_QUALITY}。
负面约束：不要生成真人身体，不要生成模特脸，不要多件衣服，不要改变服装品类，不要改变主要颜色，不要扭曲文字和 logo。`;
}
