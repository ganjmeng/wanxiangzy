"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, ChevronRight, Sparkles, UserRound, XCircle } from "lucide-react";
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
import { StudioMultiImageUpload } from "@/components/studio/StudioMultiImageUpload";
import { StudioUploadSection } from "@/components/studio/StudioUploadSection";
import { RawPreviewImage } from "@/components/studio/RawPreviewImage";
import { useTaskQueueGeneration } from "@/components/studio/useTaskQueueGeneration";
import { ResultImageGrid } from "@/components/ResultImageGrid";
import { StudioImagePreviewDialog } from "@/components/studio/StudioImagePreviewDialog";
import { setCachedProfileCredits } from "@/lib/supabase/client";
import { MAX_FILE_SIZE, MAX_FILE_SIZE_MB, isLikelyImageFile, uploadImage } from "@/lib/utils";
import { getCreditCost, getSupportedImageSizes, type AspectRatio, type ImageSize, type LingyaModel } from "@/lib/api/lingya";
import { fetchHistoryApplyDetail, getHistoryApplyFailureMessage, isHistoryApplyRowFailed, takeApplyDetail, type HistoryJobPayload } from "@/lib/history-apply";
import { clampTaskExpectedCount, safeTaskQueueUrls, type TaskQueueItem } from "@/lib/task-queue";
import { enforceModelPromptRequirements } from "@/lib/model-prompt";
import { showInsufficientCreditsToast } from "@/lib/ui/credit-copy";
import { createGenericImagePreviewSession, referencesFromUrls, type ImagePreviewAction } from "@/lib/studio-image-preview";
import { FAILED_RETRY_NOTICE, buildPartialFailureDetail, summarizeGenerationError } from "@/lib/studio-generation-feedback";
import {
  buildRetryPendingResultUrls,
  getRetryDisplayExpectedCount,
  mergeRetryResultUrls,
  normalizeRetryResultIndex,
} from "@/lib/result-slot-retry";
import {
  DEFAULT_MODEL_SHOOT_STYLE,
  MODEL_SHOOT_STYLES,
  applyModelShootStylePrompt,
  buildModelShootStylePrompt,
  normalizeModelShootStyle,
  type ModelShootStyle,
} from "@/lib/module-style-presets";
import { MODEL_UPLOAD_RULE, type ModelRuleDemo } from "@/lib/model-upload-rules";

type Gender = "female" | "male";
type ModelGenerateOptions = {
  genCountOverride?: number;
  expectedCountOverride?: number;
  retryResultIndex?: number;
  toastMessage?: string;
};

const MODELS: { value: LingyaModel; label: string; desc: string; badge?: string; icon: string }[] = [
  { value: "nano-banana-2", label: "Nano-Banana-2", desc: "最高4K", badge: "推荐", icon: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/model-icons/gemini.png" },
  { value: "gpt-image-2", label: "GPT-Image-2", desc: "最高4K", badge: "最新", icon: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/model-icons/openai.svg" },
  { value: "nano-banana-pro", label: "Nano-Banana-Pro", desc: "最高4K", badge: "推荐", icon: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/model-icons/gemini.png" },
];

type ModelHistoryPayload = Extract<HistoryJobPayload, { kind: "model" }>;

const ASPECTS: { value: AspectRatio; label: string }[] = [
  { value: "auto", label: "智能" },
  { value: "3:4", label: "3:4 竖版" },
  { value: "1:1", label: "1:1 头像" },
  { value: "4:3", label: "4:3 横版" },
];

const MODEL_PREVIEW_ACTIONS: ImagePreviewAction[] = [
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

const HAIR_STYLES = {
  female: [
    { value: "自然黑长直发，偏分，发丝顺滑垂落", label: "黑长直", image: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/exclusive-model/female-black-long-side.png" },
    { value: "齐肩短波波头，空气刘海，发尾内扣", label: "短波波", image: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/exclusive-model/female-short-bob.png" },
    { value: "高丸子头，干净利落，露出脸部轮廓", label: "丸子头", image: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/exclusive-model/female-high-bun.png" },
    { value: "侧边低马尾，柔和自然，发束垂在肩侧", label: "侧马尾", image: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/exclusive-model/female-side-ponytail.png" },
    { value: "长卷发，大波浪，发丝蓬松有层次", label: "大波浪", image: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/exclusive-model/female-black-wavy.png" },
  ],
  male: [
    { value: "短寸头，清爽硬朗，发际线自然", label: "寸头", image: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/exclusive-model/male-buzz-cut.png" },
    { value: "短碎发，顶部自然蓬松，干净少年感", label: "短碎发", image: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/exclusive-model/male-short-textured.png" },
    { value: "蓬松微卷短发，前额自然碎刘海", label: "微卷发", image: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/exclusive-model/male-wavy-volume.png" },
  ],
};

const HAIR_COLORS = [
  { value: "自然黑色", label: "黑色", image: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/exclusive-model/female-black-long-side.png" },
  { value: "深棕色", label: "深棕", image: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/exclusive-model/female-brown-straight.png" },
  { value: "冷灰色", label: "灰色", image: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/exclusive-model/female-gray-long.png" },
  { value: "铂金白色", label: "白金", image: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/exclusive-model/female-platinum-long.png" },
  { value: "柔粉色", label: "粉色", image: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/exclusive-model/female-pink-long.png" },
];
export default function ModelPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hairInputRef = useRef<HTMLInputElement>(null);
  const hairColorInputRef = useRef<HTMLInputElement>(null);
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
  const [referenceUrls, setReferenceUrls] = useState<string[]>([]);
  const [isReferenceDragging, setIsReferenceDragging] = useState(false);
  const [isUploadingReference, setIsUploadingReference] = useState(false);
  const [gender, setGender] = useState<Gender>("female");
  const [modelStyle, setModelStyle] = useState<ModelShootStyle>(DEFAULT_MODEL_SHOOT_STYLE);
  const [hairStyle, setHairStyle] = useState<string | null>(null);
  const [hairColor, setHairColor] = useState<string | null>(null);
  const [hairReferenceUrl, setHairReferenceUrl] = useState<string | null>(null);
  const [hairColorReferenceUrl, setHairColorReferenceUrl] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState<LingyaModel>("nano-banana-2");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("auto");
  const [imageSize, setImageSize] = useState<ImageSize>("1K");
  const [genCount, setGenCount] = useState(1);
  const [prompt, setPrompt] = useState("");
  const [promptTouched, setPromptTouched] = useState(false);
  const [userExtraPrompt, setUserExtraPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [, setProgress] = useState(0);
  const [resultUrls, setResultUrls] = useState<string[]>([]);
  const [runningExpectedCount, setRunningExpectedCount] = useState<number | null>(null);
  const [activeResultMeta, setActiveResultMeta] = useState<{ createdAt: string; inputThumbnails: string[] } | null>(null);
  const [error, setError] = useState("");
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [referencePreviewIndex, setReferencePreviewIndex] = useState<number | null>(null);
  const [showModelRules, setShowModelRules] = useState(false);
  const [rulesPopoverStyle, setRulesPopoverStyle] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  const imageSizes = getSupportedImageSizes(aiModel, aspectRatio);
  const cost = getCreditCost(aiModel, imageSize, aspectRatio);
  const totalCost = cost * genCount;
  const authIsAnonymous = authChecked && !isAuthenticated;
  const runDisabledReason = !referenceUrls.length
    ? "请上传至少 1 张参考图"
    : credits !== null && credits < totalCost
      ? `灵点不足，生成需要 ${totalCost} 灵点`
      : undefined;
  const defaultPrompt = useMemo(
    () => buildDefaultPrompt(referenceUrls.length || 1, gender, hairStyle, hairColor, !!hairReferenceUrl, !!hairColorReferenceUrl, modelStyle),
    [referenceUrls.length, gender, hairStyle, hairColor, hairReferenceUrl, hairColorReferenceUrl, modelStyle]
  );
  const taskInputThumbnails = useMemo(
    () => [...referenceUrls, hairReferenceUrl, hairColorReferenceUrl].filter(Boolean) as string[],
    [referenceUrls, hairReferenceUrl, hairColorReferenceUrl]
  );
  const previewReferences = useMemo(
    () => referencesFromUrls(activeResultMeta?.inputThumbnails.length ? activeResultMeta.inputThumbnails : taskInputThumbnails, "reference", "参考图"),
    [activeResultMeta, taskInputThumbnails]
  );
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
      module: "model",
      title: "专属模特",
      urls: resultUrls,
      expectedCount: activeResultExpectedCount,
      isGenerating,
      statusGroup: isGenerating ? "running" : undefined,
      createdAt: activeResultMeta?.createdAt,
      references: previewReferences,
      promptText: userExtraPrompt,
      metaItems: [
        { label: "性别", value: gender === "female" ? "女模特" : "男模特" },
        { label: "拍摄风格", value: modelStyle },
        { label: "模型", value: aiModel },
        { label: "比例", value: aspectRatio },
        { label: "分辨率", value: imageSize },
        { label: "生成数量", value: genCount },
      ],
      resultTitlePrefix: "专属模特结果",
      aspectRatio,
    }),
    [activeResultExpectedCount, activeResultMeta, aiModel, aspectRatio, gender, genCount, imageSize, isGenerating, modelStyle, previewReferences, resultUrls, userExtraPrompt]
  );
  const referencePreviewSession = useMemo(
    () => createGenericImagePreviewSession({
      module: "model",
      title: "专属模特参考图",
      urls: referenceUrls,
      expectedCount: Math.max(referenceUrls.length, 1),
      references: referencesFromUrls(referenceUrls, "reference", "参考图"),
      resultTitlePrefix: "参考图",
      aspectRatio: "auto",
    }),
    [referenceUrls]
  );
  const taskQueue = useTaskQueueGeneration({
    module: "model",
    title: "专属模特",
    defaultExpectedCount: genCount,
    applyPath: "/model",
  });

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
    setShowModelRules(true);
  };

  const scheduleRulesHide = () => {
    cancelRulesHide();
    rulesHideTimerRef.current = setTimeout(() => {
      setShowModelRules(false);
      setRulesPopoverStyle(null);
    }, 120);
  };

  useEffect(() => {
    if (!promptTouched) {
      setPrompt(defaultPrompt);
    }
  }, [defaultPrompt, promptTouched]);

  useEffect(() => {
    return () => cancelRulesHide();
  }, []);

  useEffect(() => {
    const nextSizes = getSupportedImageSizes(aiModel, aspectRatio);
    if (!nextSizes.includes(imageSize)) setImageSize(nextSizes[0]);
  }, [aiModel, aspectRatio, imageSize]);

  function applyModelHistoryPayload(payload: ModelHistoryPayload, historyResultUrls: string[] = [], options?: { silent?: boolean }) {
    const normalizedStyle = normalizeModelShootStyle(payload.modelStyle);
    setReferenceUrls(payload.referenceUrls);
    setHairReferenceUrl(payload.hairReferenceUrl || null);
    setHairColorReferenceUrl(payload.hairColorReferenceUrl || null);
    setGender(payload.gender || "female");
    setModelStyle(normalizedStyle);
    setHairStyle(payload.hairStyle || null);
    setHairColor(payload.hairColor || null);
    setAiModel(payload.aiModel);
    setAspectRatio(payload.aspectRatio);
    setImageSize(payload.imageSize);
    setGenCount(payload.genCount);
    // Rebuild the default prompt from the freshly-restored inputs rather
    // than sending the historical (already-styled) prompt raw. The
    // server's `applyModelShootStylePrompt` only replaces the marker
    // line — the rest of the historical style's descriptive text would
    // otherwise leak into `fragments.userIntent` when the user changes
    // `modelStyle` after applying history.
    setPromptTouched(false);
    setPrompt(
      buildDefaultPrompt(
        payload.referenceUrls.length || 1,
        payload.gender || "female",
        payload.hairStyle || null,
        payload.hairColor || null,
        !!payload.hairReferenceUrl,
        !!payload.hairColorReferenceUrl,
        normalizedStyle,
      ),
    );
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
    const detail = await takeApplyDetail("model");
    const payload = detail?.payload;
    if (cancelled || !payload) return;

    const normalizedStyle = normalizeModelShootStyle(payload.modelStyle);
    setReferenceUrls(payload.referenceUrls);
    setHairReferenceUrl(payload.hairReferenceUrl || null);
    setHairColorReferenceUrl(payload.hairColorReferenceUrl || null);
    setGender(payload.gender || "female");
    setModelStyle(normalizedStyle);
    setHairStyle(payload.hairStyle || null);
    setHairColor(payload.hairColor || null);
    setAiModel(payload.aiModel);
    setAspectRatio(payload.aspectRatio);
    setImageSize(payload.imageSize);
    setGenCount(payload.genCount);
    // See applyModelHistoryPayload — rebuild from the restored inputs
    // so historical style prose doesn't leak into a future re-run.
    setPromptTouched(false);
    setPrompt(
      buildDefaultPrompt(
        payload.referenceUrls.length || 1,
        payload.gender || "female",
        payload.hairStyle || null,
        payload.hairColor || null,
        !!payload.hairReferenceUrl,
        !!payload.hairColorReferenceUrl,
        normalizedStyle,
      ),
    );
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

  async function addFiles(files?: FileList | File[]) {
    if (!files) return;
    const incoming = Array.from(files).slice(0, 3 - referenceUrls.length);
    if (!incoming.length) {
      toast.error("最多上传 3 张参考图");
      return;
    }

    // Pre-validate every file before kicking off uploads so we surface
    // every error in one toast instead of partially-uploading and then
    // complaining about the rest. Bounds come from MODEL_UPLOAD_RULE so
    // the displayed "20KB-15MB" range and the actual enforcement stay in
    // sync.
    const accepted: File[] = [];
    for (const file of incoming) {
      if (!isLikelyImageFile(file)) {
        toast.error(`${file.name} 不是图片文件，已跳过`);
        continue;
      }
      if (file.size < MODEL_UPLOAD_RULE.minFileSize) {
        toast.error(`${file.name} 小于 ${MODEL_UPLOAD_RULE.minFileSize / 1024}KB，已跳过`);
        continue;
      }
      if (file.size > MODEL_UPLOAD_RULE.maxFileSize) {
        toast.error(`${file.name} 超过 ${MAX_FILE_SIZE_MB}MB`);
        continue;
      }
      accepted.push(file);
    }
    if (!accepted.length) return;

    setIsUploadingReference(true);
    toast.info(`正在上传 ${accepted.length} 张参考图...`);
    try {
      // Upload in parallel — each file's network round-trip runs
      // concurrently, cutting wall-clock time from N*RTT to ~RTT for
      // the common case of a multi-file drop.
      const results = await Promise.all(
        accepted.map(async (file) => {
          try {
            const result = await uploadImage(file);
            return { ok: true as const, name: file.name, url: result.url };
          } catch {
            return { ok: false as const, name: file.name };
          }
        }),
      );
      const next: string[] = [];
      for (const r of results) {
        if (r.ok) next.push(r.url);
        else toast.error(`${r.name} 上传失败，请重试`);
      }
      if (next.length) {
        setReferenceUrls((prev) => [...prev, ...next].slice(0, 3));
        toast.success(`已添加 ${next.length} 张参考图`);
      }
    } finally {
      setIsUploadingReference(false);
    }
  }

  function selectGender(nextGender: Gender) {
    setGender(nextGender);
    setHairStyle(null);
  }

  function selectModelStyle(nextStyle: ModelShootStyle) {
    setModelStyle(nextStyle);
    if (promptTouched) {
      setPrompt((prev) => applyModelShootStylePrompt(prev, nextStyle));
    }
  }

  async function uploadHairVariant(files: FileList | File[] | undefined, options: {
    label: string; // "发型" | "发色" — used in toasts
    setUrl: (url: string | null) => void;
    clearSelection: () => void;
  }) {
    const file = files?.[0];
    if (!file) return;
    if (!isLikelyImageFile(file)) {
      toast.error("请上传图片文件");
      return;
    }
    if (file.size < MODEL_UPLOAD_RULE.minFileSize) {
      toast.error(`${file.name} 小于 ${MODEL_UPLOAD_RULE.minFileSize / 1024}KB，已跳过`);
      return;
    }
    if (file.size > MODEL_UPLOAD_RULE.maxFileSize) {
      toast.error(`${file.name} 超过 ${MAX_FILE_SIZE_MB}MB`);
      return;
    }
    options.clearSelection();

    toast.info(`正在上传${options.label}参考图...`);
    try {
      const result = await uploadImage(file);
      options.setUrl(result.url);
      toast.success(`已上传${options.label}参考图`);
    } catch {
      options.setUrl(null);
      toast.error(`${options.label}参考图上传失败，请重试`);
    }
  }

  function uploadHairReference(files?: FileList | File[]) {
    return uploadHairVariant(files, {
      label: "发型",
      setUrl: setHairReferenceUrl,
      clearSelection: () => setHairStyle(null),
    });
  }

  function uploadHairColorReference(files?: FileList | File[]) {
    return uploadHairVariant(files, {
      label: "发色",
      setUrl: setHairColorReferenceUrl,
      clearSelection: () => setHairColor(null),
    });
  }

  async function generate(promptForRun?: string, options: ModelGenerateOptions = {}) {
    // Concurrent submit guard: a rapid second click (or retry fired
    // while a previous run is still polling) would otherwise post twice
    // and double-charge credits. The button is also `disabled` while
    // `isGenerating`, but that only protects keyboard / screen-reader
    // paths — direct re-entry from hot-reload or programmatic callers
    // needs the in-function guard.
    if (isGenerating) return;
    if (!isAuthenticated && !(await refreshAuth())) {
      toast.error("请先登录");
      router.push("/login");
      return;
    }
    if (!referenceUrls.length) {
      toast.error("请上传至少 1 张参考图");
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
    const runTotalCost = cost * runExpectedCount;
    if (credits !== null && credits < runTotalCost) {
      showInsufficientCreditsToast({ required: runTotalCost, balance: credits, onRecharge: () => router.push("/pricing") });
      return;
    }

    setIsGenerating(true);
    setRunningExpectedCount(displayExpectedCount);
    setProgress(10);
    setError("");
    setResultUrls(buildRetryPendingResultUrls(retryPreviousResultUrls, retryResultIndex, displayExpectedCount));
    if (options.toastMessage) toast.info(options.toastMessage);
    setActiveResultMeta({
      createdAt: new Date().toISOString(),
      inputThumbnails: taskInputThumbnails,
    });
    const provisionalTask = taskQueue.startTask({
      expectedCount: displayExpectedCount,
      inputThumbnails: taskInputThumbnails,
      progress: 10,
    });
    let activeTaskId = provisionalTask.id;
    let latestTaskResultUrls: string[] = [];

    try {
      const res = await fetch("/api/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference_urls: referenceUrls,
          ai_model: aiModel,
          aspect_ratio: aspectRatio,
          image_size: imageSize,
          gen_count: runGenCount,
          hair_reference_url: hairReferenceUrl,
          hair_color_reference_url: hairColorReferenceUrl,
          gender,
          model_style: modelStyle,
          hair_style: hairStyle,
          hair_color: hairColor,
          prompt: typeof promptForRun === "string"
            ? promptForRun
            : userExtraPrompt.trim()
              ? `${prompt}\n\n用户补充要求：${userExtraPrompt.trim()}`
              : prompt,
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
      if (typeof data.generation_id !== "string" || !data.generation_id) {
        // Server returned 200 without a generation id (partial deploy,
        // upstream outage short-circuited into JSON, etc.). Without this
        // guard the polling loop would happily call
        // `/api/model?generation_id=undefined` for the full 120-attempt
        // budget and surface a misleading '生成超时'.
        throw new Error("生成服务未返回任务标识，请稍后重试");
      }
      const generationId = data.generation_id;
      const serverTask = taskQueue.replaceWithServerTask(activeTaskId, {
        id: generationId,
        expectedCount: displayExpectedCount,
        inputThumbnails: taskInputThumbnails,
        status: data.status || "processing_tryon",
        progress: 25,
      });
      activeTaskId = serverTask.id;

      let attempts = 0;
      // Track consecutive 5xx failures so a persistent server outage
      // surfaces immediately instead of burning the full 4-minute budget.
      // 4xx responses (e.g. invalid id, bad auth) are non-recoverable and
      // bail out on the first occurrence with an actionable error.
      let consecutiveServerErrors = 0;
      const MAX_CONSECUTIVE_SERVER_ERRORS = 5;
      while (attempts < 120) {
        await new Promise((r) => setTimeout(r, 2000));
        attempts++;
        const poll = await fetch(`/api/model?generation_id=${encodeURIComponent(generationId)}`);
        if (!poll.ok) {
          if (poll.status >= 400 && poll.status < 500) {
            // Non-recoverable client error (missing/invalid id, auth,
            // rate limit). Bail immediately with the server's message.
            let message = `生成服务返回 ${poll.status}`;
            try {
              const errBody = await poll.json();
              if (errBody && typeof errBody.error === "string") message = errBody.error;
            } catch {
              // ignore JSON parse error
            }
            throw new Error(message);
          }
          consecutiveServerErrors += 1;
          if (consecutiveServerErrors >= MAX_CONSECUTIVE_SERVER_ERRORS) {
            throw new Error("生成服务暂时不可用，请稍后重试");
          }
          continue;
        }
        consecutiveServerErrors = 0;
        const state = await poll.json();
        if (state.status === "processing_tryon" || state.status === "processing" || state.status === "pending") {
          if (Array.isArray(state.result_urls) && state.result_urls.length) {
            const nextResultUrls = mergeRetryResultUrls(retryPreviousResultUrls, retryResultIndex, state.result_urls, displayExpectedCount);
            latestTaskResultUrls = nextResultUrls;
            setResultUrls(nextResultUrls);
          }
          const nextProgress = Number(state.progress);
          const runningProgress = Number.isFinite(nextProgress)
            ? Math.min(Math.max(Math.round(nextProgress), 0), 99)
            : Math.min(25 + attempts * 1.5, 90);
          setProgress(runningProgress);
          taskQueue.markRunning(activeTaskId, {
            expectedCount: displayExpectedCount,
            inputThumbnails: taskInputThumbnails,
            resultThumbnails: latestTaskResultUrls,
            progress: runningProgress,
            status: state.status,
          });
        } else if (state.status === "completed") {
          const rawFinalUrls = Array.isArray(state.result_urls) ? state.result_urls : [];
          const finalUrls = mergeRetryResultUrls(retryPreviousResultUrls, retryResultIndex, rawFinalUrls, displayExpectedCount);
          latestTaskResultUrls = finalUrls;
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
            inputThumbnails: taskInputThumbnails,
            resultThumbnails: finalUrls,
            resultCount: finalResultCount,
            error: completedError ? summarizeGenerationError(completedError) : "",
          });
          if (completedError || finalResultCount < displayExpectedCount) {
            void refreshCredits();
            toast.warning(`专属模特部分完成：已生成 ${finalResultCount}/${displayExpectedCount} 张，失败图片灵点会自动退回`);
          } else {
            toast.success("专属模特生成完成");
          }
          return;
        } else if (state.status === "failed") {
          throw new Error(state.error || "生成失败");
        }
      }
      throw new Error("生成超时");
    } catch (err: unknown) {
      const message = summarizeGenerationError(err instanceof Error ? err.message : "生成失败");
      setError(message);
      setIsGenerating(false);
      taskQueue.markFailed(activeTaskId, message, {
        expectedCount: displayExpectedCount,
        inputThumbnails: taskInputThumbnails,
        resultThumbnails: latestTaskResultUrls,
      });
      toast.error(message);
      void refreshCredits();
    }
  }

  function applyRuleDemo(demo: ModelRuleDemo) {
    setReferenceUrls(demo.imageUrls.slice(0, 3));
    setPromptTouched(false);
    setShowModelRules(false);
    setRulesPopoverStyle(null);
    toast.success(`已套用${demo.title}`);
  }

  function handleRunningTask(item: TaskQueueItem) {
    setRunningExpectedCount(clampTaskExpectedCount(item, 1, 4));
    setIsGenerating(true);
    setProgress(Math.min(Math.max(Math.round(Number(item.progress) || 12), 1), 99));
    setError("");
    setResultUrls(safeTaskQueueUrls(item.resultThumbnails));
    setActiveResultMeta({
      createdAt: item.createdAt || item.updatedAt || new Date().toISOString(),
      inputThumbnails: safeTaskQueueUrls(item.inputThumbnails),
    });
  }

  async function handleCompletedTask(item: TaskQueueItem, session: TaskSelectionSession) {
    try {
      const detail = await fetchHistoryApplyDetail(item.id, "model", session.signal);
      if (!session.isCurrent()) return true;
      applyModelHistoryPayload(detail.payload, detail.resultUrls.length ? detail.resultUrls : safeTaskQueueUrls(item.resultThumbnails), {
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
    setReferenceUrls([]);
    setGender("female");
    setModelStyle(DEFAULT_MODEL_SHOOT_STYLE);
    setHairStyle(null);
    setHairColor(null);
    setHairReferenceUrl(null);
    setHairColorReferenceUrl(null);
    setAiModel("nano-banana-2");
    setAspectRatio("auto");
    setImageSize("1K");
    setGenCount(1);
    setPrompt("");
    setPromptTouched(false);
    setUserExtraPrompt("");
    setIsGenerating(false);
    setRunningExpectedCount(null);
    setProgress(0);
    setResultUrls([]);
    setActiveResultMeta(null);
    setError("");
    setPreviewIndex(null);
    setReferencePreviewIndex(null);
    setShowModelRules(false);
    setRulesPopoverStyle(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (hairInputRef.current) hairInputRef.current.value = "";
    if (hairColorInputRef.current) hairColorInputRef.current.value = "";
  }

  return (
    <div className="studio-workbench min-h-[calc(100dvh-64px)] lg:h-[calc(100vh-64px)] flex flex-col lg:flex-row">
      <FeatureTabs active="model" />
      <ModuleTaskRail module="model" moduleLabel="模特生成" onContinue={handleContinueCreate} onRunningTask={handleRunningTask} onCompletedTask={handleCompletedTask} />
      <div className="studio-parameters w-full lg:w-[472px] border-b lg:border-b-0 lg:border-r flex flex-col overflow-visible lg:overflow-hidden">
        <div className="studio-parameters-scroll flex-1 overflow-visible lg:overflow-y-auto p-3 sm:p-5 space-y-4 sm:space-y-6">
          <ModuleHeader
            title="专属模特"
            tooltip="上传 1-3 张人物参考图，融合脸型、五官比例、肤色、妆感和气质，生成稳定可复用的品牌模特形象。"
            actions={(
              <button
                ref={rulesButtonRef}
                type="button"
                onMouseEnter={openRulesPopover}
                onMouseLeave={scheduleRulesHide}
                onFocus={openRulesPopover}
                onBlur={scheduleRulesHide}
                aria-expanded={showModelRules}
                className="studio-upload-rule-button"
              >
                图片规则 <ChevronRight className="h-3 w-3" />
              </button>
            )}
          />
          <StudioUploadSection
            title="上传参考图"
            inputRef={fileInputRef}
            multiple
            isDragging={isReferenceDragging}
            setDragging={setIsReferenceDragging}
            onFiles={addFiles}
          >
            {(openFileDialog) => (
              <StudioMultiImageUpload
                urls={referenceUrls}
                maxCount={3}
                title="已上传人物参考图"
                emptyTitle="上传 / 拖拽 1-3 张人物参考图"
                description="图片已进入融合参考，可继续补充或移除单张。"
                emptyDescription="用于融合脸型、肤色、妆感和气质。"
                itemLabelPrefix="图"
                loading={isUploadingReference}
                isDragging={isReferenceDragging}
                uploadLabel="从本地上传"
                libraryLabel="从作品选择"
                summary={referenceUrls.length ? "用于脸型 / 五官 / 肤色融合" : undefined}
                footnote="建议 1-3 张清晰正脸或半身图；光线统一、无遮挡会更稳定。"
                onUploadClick={openFileDialog}
                onLibraryClick={() => toast.info("作品库选择即将接入")}
                onPreview={(_, index) => setReferencePreviewIndex(index)}
                onRemove={(_, index) => {
                  setReferenceUrls((prev) => prev.filter((__, i) => i !== index));
                  setReferencePreviewIndex((current) => {
                    if (current === null) return null;
                    if (referenceUrls.length <= 1) return null;
                    if (current === index) return Math.max(0, Math.min(index, referenceUrls.length - 2));
                    return current > index ? current - 1 : current;
                  });
                }}
                onClear={() => {
                  setReferenceUrls([]);
                  setReferencePreviewIndex(null);
                }}
                examples={{
                  label: "试一试",
                  images: MODEL_UPLOAD_RULE.demos.map((demo) => ({
                    url: demo.imageUrls[0],
                    title: demo.title,
                    previewUrls: demo.imageUrls,
                  })),
                  disabled: isUploadingReference,
                  onSelect: (image) => {
                    const demo = MODEL_UPLOAD_RULE.demos.find((item) => item.title === image.title && item.imageUrls[0] === image.url);
                    if (demo) applyRuleDemo(demo);
                  },
                }}
              />
            )}
          </StudioUploadSection>

          <section>
            <h3 className="font-bold text-sm mb-3">模特风格</h3>
            <StudioOptionGrid
              options={MODEL_SHOOT_STYLES.map((style) => ({
                value: style.value,
                label: style.label,
                description: style.desc,
              }))}
              value={modelStyle}
              onChange={selectModelStyle}
              columns={2}
              ariaLabel="模特风格"
            />
            <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
              风格只决定妆造、光线和商业气质；多图融合、肤色、脸型骨相和五官辨识度优先级更高。
            </p>
          </section>

          <section>
            <h3 className="font-bold text-sm mb-3">性别</h3>
            <StudioOptionGrid<Gender>
              options={[
                { value: "female", label: "女" },
                { value: "male", label: "男" },
              ]}
              value={gender}
              onChange={selectGender}
              columns={2}
              ariaLabel="性别"
            />
          </section>

          <section>
            <h3 className="font-bold text-sm mb-3">参考发型</h3>
            <input
              ref={hairInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const input = event.currentTarget;
                const files = Array.from(input.files || []);
                void uploadHairReference(files).finally(() => {
                  input.value = "";
                });
              }}
            />
            <div className="grid grid-cols-4 gap-2">
              <button
                onClick={() => { setHairStyle(null); setHairReferenceUrl(null); }}
                className={`rounded-lg border p-2 text-center transition-all aspect-[3/4] flex flex-col items-center justify-center ${
                  !hairStyle && !hairReferenceUrl ? "border-zinc-950 bg-zinc-100 text-zinc-900 ring-1 ring-zinc-200" : "border-gray-100 text-gray-500 hover:border-gray-300"
                }`}
              >
                <UserRound className="w-5 h-5 mb-1" />
                <span className="text-[10px] font-medium">不选默认</span>
              </button>
              {HAIR_STYLES[gender].map((item) => (
                <button key={item.value} onClick={() => { setHairStyle(item.value); setHairReferenceUrl(null); }}
                  className={`rounded-lg overflow-hidden border text-left transition-all ${
                    hairStyle === item.value && !hairReferenceUrl ? "border-zinc-950 ring-1 ring-zinc-200" : "border-gray-100 hover:border-gray-300"
                  }`}>
                  <RawPreviewImage src={item.image} alt={item.label} className="w-full aspect-[3/4] object-cover bg-gray-50" />
                  <div className="px-1 py-1 text-[10px] text-center font-medium">{item.label}</div>
                </button>
              ))}
              <button
                onClick={() => hairInputRef.current?.click()}
                className={`relative rounded-lg border-2 border-dashed p-2 text-center transition-all aspect-[3/4] flex flex-col items-center justify-center overflow-hidden ${
                  hairReferenceUrl
                    ? "studio-checkerboard border-zinc-950 text-zinc-900 ring-2 ring-zinc-200 shadow-[0_14px_34px_rgba(5,5,5,0.18)]"
                    : "border-slate-200 bg-slate-50/70 text-slate-400 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-700"
                }`}
              >
                {hairReferenceUrl ? (
                  <>
                    <RawPreviewImage src={hairReferenceUrl} className="absolute inset-0 h-full w-full object-contain p-1" alt="上传发型参考" />
                    <span className="absolute inset-0 bg-gradient-to-t from-zinc-950/38 via-transparent to-transparent" />
                    <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-emerald-500 shadow">
                      <CheckCircle2 className="h-4 w-4" />
                    </span>
                    <span className="absolute bottom-0 left-0 right-0 bg-white/94 px-1.5 py-1 text-center backdrop-blur">
                      <span className="block text-[10px] font-bold text-zinc-900">已上传发型参考</span>
                      <span className="block truncate text-[9px] text-slate-400">只参考发型轮廓</span>
                    </span>
                  </>
                ) : (
                  <>
                    <Camera className="w-5 h-5 mb-1.5" />
                    <span className="text-[10px] font-bold">上传发型参考</span>
                    <span className="mt-1 max-w-[78px] text-[9px] leading-snug text-slate-400">
                      只参考发型，不参考脸
                    </span>
                    <span className="mt-1 text-[8px] text-slate-300">≤15MB</span>
                  </>
                )}
              </button>
            </div>
            {hairReferenceUrl && (
              <button
                onClick={() => setHairReferenceUrl(null)}
                className="mt-2 text-xs text-gray-400 hover:text-red-500"
              >
                移除上传的发型参考
              </button>
            )}
          </section>

          <section>
            <h3 className="font-bold text-sm mb-3">参考发色</h3>
            <input
              ref={hairColorInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const input = event.currentTarget;
                const files = Array.from(input.files || []);
                void uploadHairColorReference(files).finally(() => {
                  input.value = "";
                });
              }}
            />
            <div className="grid grid-cols-4 gap-2">
              <button
                onClick={() => { setHairColor(null); setHairColorReferenceUrl(null); }}
                className={`rounded-lg border p-2 text-center transition-all aspect-[3/4] flex flex-col items-center justify-center ${
                  !hairColor && !hairColorReferenceUrl ? "border-zinc-950 bg-zinc-100 text-zinc-900 ring-1 ring-zinc-200" : "border-gray-100 text-gray-500 hover:border-gray-300"
                }`}
              >
                <UserRound className="w-5 h-5 mb-1" />
                <span className="text-[10px] font-medium">不选默认</span>
              </button>
              {HAIR_COLORS.map((item) => (
                <button key={item.value} onClick={() => { setHairColor(item.value); setHairColorReferenceUrl(null); }}
                  className={`rounded-lg overflow-hidden border text-left transition-all ${
                    hairColor === item.value && !hairColorReferenceUrl ? "border-zinc-950 ring-1 ring-zinc-200" : "border-gray-100 hover:border-gray-300"
                  }`}>
                  <RawPreviewImage src={item.image} alt={item.label} className="w-full aspect-[3/4] object-cover bg-gray-50" />
                  <div className="px-1 py-1 text-[10px] text-center font-medium">{item.label}</div>
                </button>
              ))}
              <button
                onClick={() => hairColorInputRef.current?.click()}
                className={`relative rounded-lg border-2 border-dashed p-2 text-center transition-all aspect-[3/4] flex flex-col items-center justify-center overflow-hidden ${
                  hairColorReferenceUrl
                    ? "studio-checkerboard border-zinc-950 text-zinc-900 ring-2 ring-zinc-200 shadow-[0_14px_34px_rgba(5,5,5,0.18)]"
                    : "border-slate-200 bg-slate-50/70 text-slate-400 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-700"
                }`}
              >
                {hairColorReferenceUrl ? (
                  <>
                    <RawPreviewImage src={hairColorReferenceUrl} className="absolute inset-0 h-full w-full object-contain p-1" alt="上传发色参考" />
                    <span className="absolute inset-0 bg-gradient-to-t from-zinc-950/38 via-transparent to-transparent" />
                    <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-emerald-500 shadow">
                      <CheckCircle2 className="h-4 w-4" />
                    </span>
                    <span className="absolute bottom-0 left-0 right-0 bg-white/94 px-1.5 py-1 text-center backdrop-blur">
                      <span className="block text-[10px] font-bold text-zinc-900">已上传发色参考</span>
                      <span className="block truncate text-[9px] text-slate-400">只提取发色明暗</span>
                    </span>
                  </>
                ) : (
                  <>
                    <Camera className="w-5 h-5 mb-1.5" />
                    <span className="text-[10px] font-bold">上传发色参考</span>
                    <span className="mt-1 max-w-[78px] text-[9px] leading-snug text-slate-400">
                      只提取发色，不参考身份
                    </span>
                    <span className="mt-1 text-[8px] text-slate-300">≤15MB</span>
                  </>
                )}
              </button>
            </div>
            {hairColorReferenceUrl && (
              <button
                onClick={() => setHairColorReferenceUrl(null)}
                className="mt-2 text-xs text-gray-400 hover:text-red-500"
              >
                移除上传的发色参考
              </button>
            )}
          </section>

          <section>
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-zinc-700" /> 生成模型
            </h3>
            <StudioModelSelector
              models={MODELS}
              value={aiModel}
              onChange={setAiModel}
              ariaLabel="生成模型"
              getMeta={(model) => `${model.desc} · 当前${getCreditCost(model.value, imageSize, aspectRatio)}分`}
            />
          </section>

          <section>
            <h3 className="font-bold text-sm mb-3">比例</h3>
            <StudioOptionGrid
              options={ASPECTS}
              value={aspectRatio}
              onChange={setAspectRatio}
              columns={3}
              ariaLabel="比例"
            />
          </section>

          {imageSizes.length > 1 && (
            <section>
              <h3 className="font-bold text-sm mb-3">分辨率</h3>
              <StudioOptionGrid
                options={imageSizes.map((size) => ({
                  value: size,
                  label: `${size} · ${getCreditCost(aiModel, size, aspectRatio)}灵点`,
                }))}
                value={imageSize}
                onChange={setImageSize}
                ariaLabel="分辨率"
              />
            </section>
          )}

          <section>
            <StudioPromptTextarea
              title="补充要求"
              badge="可选"
              value={userExtraPrompt}
              onChange={(event) => setUserExtraPrompt(event.target.value)}
              placeholder="可选：例如希望模特表情更自然、背景偏暖色调、妆容淡雅..."
              rows={4}
              description="补充说明会附加到系统提示词中，影响最终生成效果。"
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
          summary={`${referenceUrls.length} 张参考图 · ${cost} × ${genCount}`}
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
              title="创建专属模特"
              subtitle="从人像参考中提取稳定身份，再用风格和外观设置生成可复用的品牌模特。"
              imageSrc="https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/exclusive-model-02.png"
              imageAlt="专属模特指引"
              steps={[
                { title: "上传参考人像", desc: "上传 1-3 张清晰人像，用于锁定脸型、五官和人物气质。" },
                { title: "选择外观设置", desc: "调整肤色、年龄、发型、发色、妆容和拍摄风格。" },
                { title: "生成专属模特", desc: "得到统一人物形象，后续可继续用于服装上身和商品视觉。" },
              ]}
            />
          </div>
        )}

        {(isGenerating || resultUrls.length > 0) && (
          <div className="studio-result-stage min-h-[260px] sm:min-h-[360px] overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:h-full flex flex-col animate-fade-in">
            <div className="flex min-h-0 flex-1 items-start justify-start">
              <ResultImageGrid
                urls={resultUrls}
                filenamePrefix="model"
                extension="jpg"
                expectedCount={activeResultExpectedCount}
                isGenerating={isGenerating}
                inputThumbnails={activeResultMeta?.inputThumbnails.length ? activeResultMeta.inputThumbnails : taskInputThumbnails}
                createdAt={activeResultMeta?.createdAt}
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
              filenamePrefix="model"
              extension="jpg"
              actions={MODEL_PREVIEW_ACTIONS}
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

        <StudioImagePreviewDialog
          open={referencePreviewIndex !== null}
          onClose={() => setReferencePreviewIndex(null)}
          session={referencePreviewSession}
          selectedIndex={referencePreviewIndex || 0}
          onSelectedIndexChange={setReferencePreviewIndex}
          filenamePrefix="model-reference"
          extension="jpg"
        />
      </div>

      {showModelRules && rulesPopoverStyle && (
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
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--codex-accent)]">{MODEL_UPLOAD_RULE.shortTitle}</p>
                <h3 className="mt-1 text-base font-bold text-slate-950">{MODEL_UPLOAD_RULE.title}</h3>
                <p className="mt-1 text-xs text-slate-500">{MODEL_UPLOAD_RULE.uploadSpecText}</p>
              </div>
              <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-700">Hover 预览</span>
            </div>

            <div className="studio-scrollbar-hide overflow-y-auto px-5 py-4" style={{ maxHeight: rulesPopoverStyle.maxHeight - 88 }}>
              <div className="grid gap-3 md:grid-cols-3">
                {MODEL_UPLOAD_RULE.demos.map((demo) => (
                  <div key={demo.title} className="flex min-h-[300px] flex-col rounded-2xl border border-slate-100 bg-slate-50/70 p-2">
                    <div className={`grid h-36 gap-1 ${demo.imageUrls.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                      {demo.imageUrls.slice(0, 4).map((url) => (
                        <div key={url} className="relative flex min-h-0 items-center justify-center overflow-hidden rounded-xl bg-white">
                          <RawPreviewImage src={url} alt={demo.title} className="h-full w-full object-cover object-top" />
                          <CheckCircle2 className="absolute right-2 top-2 h-5 w-5 rounded-full bg-white text-emerald-500" />
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs font-bold text-slate-800">{demo.title}</p>
                    <p className="mt-1 line-clamp-2 min-h-[34px] text-[10px] leading-relaxed text-slate-400">{demo.description}</p>
                    <button
                      type="button"
                      onClick={() => applyRuleDemo(demo)}
                      className="mt-auto w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-zinc-300 hover:text-zinc-900"
                    >
                      试一试
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-2xl bg-red-50/40 p-3">
                <p className="mb-3 text-center text-xs font-medium text-slate-500">{MODEL_UPLOAD_RULE.deprecatedTitle}</p>
                <div className="mx-auto grid max-w-lg grid-cols-3 gap-3">
                  {MODEL_UPLOAD_RULE.deprecatedImages.map((image) => (
                    <div key={image.title} className="rounded-2xl border border-red-100 bg-white/70 p-2 text-center">
                      <div className="relative h-36 overflow-hidden rounded-xl bg-white">
                        <RawPreviewImage src={image.url} alt={image.title} className="h-full w-full object-cover object-top" />
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

    </div>
  );
}

function buildDefaultPrompt(
  refCount: number,
  gender: Gender,
  hairStyle: string | null,
  hairColor: string | null,
  hasHairReference: boolean,
  hasHairColorReference: boolean,
  modelStyle: ModelShootStyle
) {
  const hairImageIndex = refCount + 1;
  const hairColorImageIndex = refCount + (hasHairReference ? 2 : 1);
  return enforceModelPromptRequirements({
    prompt: buildModelShootStylePrompt(modelStyle),
    referenceCount: refCount,
    gender,
    hairStyle,
    hairColor,
    hairReferenceIndex: hasHairReference ? hairImageIndex : null,
    hairColorReferenceIndex: hasHairColorReference ? hairColorImageIndex : null,
  });
}
