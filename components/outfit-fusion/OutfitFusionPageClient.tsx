"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Clapperboard,
  Copy,
  Download,
  Eye,
  Loader2,
  PenLine,
  RefreshCw,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { FeatureTabs } from "@/components/FeatureTabs";
import { ModuleTaskRail } from "@/components/studio/ModuleTaskRail";
import { OutfitFusionComposer } from "@/components/outfit-fusion/OutfitFusionComposer";
import { OutfitFusionExampleGallery } from "@/components/outfit-fusion/OutfitFusionExampleGallery";
import { RawPreviewImage } from "@/components/studio/RawPreviewImage";
import { StudioHomeHeroLoadingBackdrop } from "@/components/studio/StudioHomeHeroLoadingBackdrop";
import { StudioImagePreviewDialog } from "@/components/studio/StudioImagePreviewDialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { TaskSelectionSession } from "@/components/studio/useTaskSelectionSession";
import { useTaskQueueGeneration } from "@/components/studio/useTaskQueueGeneration";
import { useStudioAuth } from "@/components/studio/useStudioAuth";
import { cn, downloadImage, generateDownloadFilename, MAX_FILE_SIZE, MAX_FILE_SIZE_MB, uploadImage } from "@/lib/utils";
import { safeTaskQueueUrls, type TaskQueueItem, type TaskStatusGroup } from "@/lib/task-queue";
import { getCreditCost } from "@/lib/api/lingya";
import { showInsufficientCreditsToast } from "@/lib/ui/credit-copy";
import { fetchHistoryApplyDetail, getHistoryApplyFailureMessage, isHistoryApplyRowFailed, takeApplyDetail, type HistoryApplyDetail, type HistoryJobPayload } from "@/lib/history-apply";
import {
  buildOutfitFusionComposerText,
  buildOutfitFusionPrompt,
  buildOutfitFusionVisibleFaceText,
  buildOutfitFusionVisionPromptRequest,
  clampOutfitFusionCount,
  DEFAULT_OUTFIT_FUSION_CONFIG,
  getOutfitFusionRoleLabel,
  getOutfitFusionDisplayPrompt,
  normalizeOutfitFusionAssistantPrompt,
  outfitFusionReferencesFromAssets,
  OUTFIT_FUSION_TEMPLATES,
  type OutfitFusionAsset,
  type OutfitFusionAssetRole,
  type OutfitFusionConfig,
  type OutfitFusionTemplate,
} from "@/lib/outfit-fusion";
import { buildSourceImageHref, createGenericImagePreviewSession, createImagePreviewSession, type ImagePreviewAction } from "@/lib/studio-image-preview";

type OutfitFusionTask = {
  id: string;
  remoteId?: string | null;
  taskNo: string;
  templateId?: string | null;
  createdAt: string;
  statusGroup: TaskStatusGroup;
  progress: number;
  prompt: string;
  requestPrompt: string;
  inputAssets: OutfitFusionAsset[];
  config: OutfitFusionConfig;
  expectedCount: number;
  resultUrls: string[];
  error?: string | null;
};

const PREVIEW_ACTIONS: ImagePreviewAction[] = [
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

export function OutfitFusionPageClient() {
  const router = useRouter();
  const [assets, setAssets] = useState<OutfitFusionAsset[]>([]);
  const [prompt, setPrompt] = useState("");
  const [config, setConfig] = useState<OutfitFusionConfig>(DEFAULT_OUTFIT_FUSION_CONFIG);
  const [selectedTemplate, setSelectedTemplate] = useState<OutfitFusionTemplate | null>(null);
  const [tasks, setTasks] = useState<OutfitFusionTask[]>([]);
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const [uploadRole, setUploadRole] = useState<OutfitFusionAssetRole>("outfit");
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [autoWriting, setAutoWriting] = useState(false);
  const [composerHeight, setComposerHeight] = useState(0);
  const [composerReserveHeight, setComposerReserveHeight] = useState(320);
  const [preview, setPreview] = useState<{ taskId: string; index: number } | null>(null);
  const [assetPreviewId, setAssetPreviewId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const taskListRef = useRef<HTMLDivElement | null>(null);
  const composerWrapRef = useRef<HTMLDivElement | null>(null);
  const lastScrollYRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollIntentRef = useRef<{ direction: "up" | "down" | null; distance: number }>({ direction: null, distance: 0 });
  const lastComposerToggleAtRef = useRef(0);
  const applyOutfitFusionApplyDetailRef = useRef(applyOutfitFusionApplyDetail);
  const {
    authChecked,
    isAuthenticated,
    credits,
    setCredits,
    refreshAuth,
  } = useStudioAuth();
  const authIsAnonymous = authChecked && !isAuthenticated;
  const totalCost = getCreditCost(config.aiModel, config.imageSize, config.aspectRatio) * clampOutfitFusionCount(config.genCount);
  const taskQueue = useTaskQueueGeneration({
    module: "outfitFusion",
    title: "搭配融图",
    defaultExpectedCount: DEFAULT_OUTFIT_FUSION_CONFIG.genCount,
    applyPath: "/outfit-fusion",
  });

  useEffect(() => {
    applyOutfitFusionApplyDetailRef.current = applyOutfitFusionApplyDetail;
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const detail = await takeApplyDetail("outfitFusion");
      if (cancelled || !detail) return;
      applyOutfitFusionApplyDetailRef.current(detail);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleHistoryApply(event: Event) {
      const detail = (event as CustomEvent<{ id?: string; module?: string }>).detail;
      if (!detail?.id || (detail.module && detail.module !== "outfitFusion")) return;
      const generationId = detail.id;
      void (async () => {
        try {
          const historyDetail = await fetchHistoryApplyDetail(generationId, "outfitFusion");
          applyOutfitFusionApplyDetailRef.current(historyDetail);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "作品库参数加载失败");
        }
      })();
    }

    window.addEventListener("wanxiang:history-apply", handleHistoryApply);
    return () => window.removeEventListener("wanxiang:history-apply", handleHistoryApply);
  }, []);

  useEffect(() => {
    const scrollContainer = mainRef.current;
    const getScrollTop = () => scrollContainer ? scrollContainer.scrollTop : window.scrollY;
    lastScrollYRef.current = getScrollTop();
    scrollIntentRef.current = { direction: null, distance: 0 };
    if (getScrollTop() > 180) {
      setComposerCollapsed(true);
    }
    const restoreChecks = [120, 360, 760].map((delay) =>
      window.setTimeout(() => {
        const scrollTop = getScrollTop();
        lastScrollYRef.current = scrollTop;
        if (scrollTop > 180) {
          setComposerCollapsed(true);
        }
      }, delay)
    );
    function applyScrollIntent(delta: number, scrollTop: number) {
      const absDelta = Math.abs(delta);
      const activeElement = document.activeElement;
      const isEditingComposer = activeElement instanceof Element && Boolean(composerWrapRef.current?.contains(activeElement));
      if (isEditingComposer || absDelta < 3) return;

      if (scrollTop < 96 && delta < 0) {
        scrollIntentRef.current = { direction: null, distance: 0 };
        setComposerCollapsed(false);
        return;
      }

      const direction = delta > 0 ? "down" : "up";
      const currentIntent = scrollIntentRef.current;
      scrollIntentRef.current = currentIntent.direction === direction
        ? { direction, distance: currentIntent.distance + absDelta }
        : { direction, distance: absDelta };

      const now = window.performance.now();
      if (now - lastComposerToggleAtRef.current < 240) return;

      if (direction === "down" && scrollIntentRef.current.distance >= 72 && !composerCollapsed) {
        lastComposerToggleAtRef.current = now;
        scrollIntentRef.current = { direction, distance: 0 };
        setComposerCollapsed(true);
      }

      if (direction === "up" && scrollIntentRef.current.distance >= 44 && composerCollapsed) {
        lastComposerToggleAtRef.current = now;
        scrollIntentRef.current = { direction, distance: 0 };
        setComposerCollapsed(false);
      }
    }

    function handleScroll() {
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        const scrollTop = window.scrollY;
        const delta = scrollTop - lastScrollYRef.current;
        lastScrollYRef.current = scrollTop;
        applyScrollIntent(delta, scrollTop);
      });
    }
    function handleWheel(event: WheelEvent) {
      const target = event.target;
      if (target instanceof Element && composerWrapRef.current?.contains(target)) return;
      const projectedScrollTop = Math.max(0, getScrollTop() + event.deltaY);
      applyScrollIntent(event.deltaY, projectedScrollTop);
    }
    const handleWheelEvent: EventListener = (event) => {
      if (event instanceof WheelEvent) handleWheel(event);
    };
    const scrollPoll = window.setInterval(() => {
      const scrollTop = getScrollTop();
      const delta = scrollTop - lastScrollYRef.current;
      if (Math.abs(delta) < 3) return;
      lastScrollYRef.current = scrollTop;
      applyScrollIntent(delta, scrollTop);
    }, 120);

    const scrollTarget: Window | HTMLElement = scrollContainer || window;
    scrollTarget.addEventListener("scroll", handleScroll, { passive: true });
    scrollTarget.addEventListener("wheel", handleWheelEvent, { passive: true });
    return () => {
      scrollTarget.removeEventListener("scroll", handleScroll);
      scrollTarget.removeEventListener("wheel", handleWheelEvent);
      window.clearInterval(scrollPoll);
      restoreChecks.forEach((timer) => window.clearTimeout(timer));
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [assets.length, composerCollapsed, prompt, tasks.length]);

  useEffect(() => {
    const node = composerWrapRef.current;
    if (!node) return;
    const targetNode = node;
    function updateHeight() {
      const nextHeight = Math.ceil(targetNode.getBoundingClientRect().height);
      setComposerHeight(nextHeight);
      if (!composerCollapsed) {
        setComposerReserveHeight(Math.max(320, nextHeight + 48));
      }
    }
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(targetNode);
    window.addEventListener("resize", updateHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [assets.length, autoWriting, composerCollapsed, config.aiModel, config.genCount, config.imageSize, creating, prompt, uploading]);

  const previewTask = useMemo(() => {
    if (!preview) return null;
    return tasks.find((task) => task.id === preview.taskId) || null;
  }, [preview, tasks]);

  const composerBottomReserve = Math.max(320, composerReserveHeight, composerHeight + 24);

  const previewSession = useMemo(() => {
    if (!previewTask) return null;
    return createGenericImagePreviewSession({
      module: "outfitFusion",
      title: "搭配融图生成",
      urls: previewTask.resultUrls,
      expectedCount: previewTask.expectedCount,
      statusGroup: previewTask.statusGroup,
      taskId: previewTask.remoteId || previewTask.taskNo,
      createdAt: previewTask.createdAt,
      references: outfitFusionReferencesFromAssets(previewTask.inputAssets),
      promptText: previewTask.prompt,
      selectedIndex: preview?.index || 0,
      resultTitlePrefix: "生成图",
      aspectRatio: getOutfitFusionAspectRatioLabel(previewTask.config.aspectRatio),
      metaItems: [
        { label: "来源", value: "搭配融图生成" },
        { label: "比例", value: getOutfitFusionAspectRatioLabel(previewTask.config.aspectRatio) },
        { label: "分辨率", value: previewTask.config.imageSize },
        { label: "模型", value: previewTask.config.aiModel },
        { label: "任务 ID", value: previewTask.remoteId || previewTask.taskNo },
      ],
    });
  }, [preview?.index, previewTask]);

  const assetPreviewIndex = useMemo(() => {
    if (!assetPreviewId) return -1;
    return assets.findIndex((asset) => asset.id === assetPreviewId);
  }, [assetPreviewId, assets]);

  const assetPreview = useMemo(() => {
    if (assetPreviewIndex < 0) return null;
    const asset = assets[assetPreviewIndex];
    if (!asset) return null;
    const label = getCanonicalInputImageLabel(assetPreviewIndex);
    return {
      asset,
      label,
      roleLabel: getOutfitFusionRoleLabel(asset.role),
    };
  }, [assetPreviewIndex, assets]);

  const assetPreviewSession = useMemo(() => {
    if (!assetPreview) return null;
    const metaItems = [
      { label: "图片类型", value: assetPreview.roleLabel },
      { label: "图片编号", value: assetPreview.label },
    ];
    return createImagePreviewSession({
      module: "outfitFusion",
      title: `${assetPreview.label} · ${assetPreview.roleLabel}`,
      statusGroup: "completed",
      selectedIndex: 0,
      metaItems,
      results: [{
        url: assetPreview.asset.url,
        title: assetPreview.label,
        badgeLabel: assetPreview.roleLabel,
        status: "completed",
      }],
    });
  }, [assetPreview]);

  useEffect(() => {
    if (assetPreviewId && !assets.some((asset) => asset.id === assetPreviewId)) {
      setAssetPreviewId(null);
    }
  }, [assetPreviewId, assets]);

  function applyTemplate(template: OutfitFusionTemplate) {
    const namedAssets = template.assets.map((asset, index) => ({
      ...asset,
      name: asset.name || getTemplateAssetName(template.assets, asset, index),
    }));
    setSelectedTemplate(template);
    setAssets(namedAssets);
    setPrompt(limitComposerPrompt(buildOutfitFusionComposerText(template)));
    setConfig((current) => ({
      ...current,
      genCount: clampOutfitFusionCount(template.outputCount || current.genCount),
      aspectRatio: "auto",
    }));
    setComposerCollapsed(false);
  }

  function handleUploadClick(role: OutfitFusionAssetRole) {
    setUploadRole(role);
    window.requestAnimationFrame(() => {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
        fileInputRef.current.click();
      }
    });
  }

  async function handleFiles(files: FileList | File[] | null, roleOverride = uploadRole) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    const role = roleOverride;
    const limited = role === "outfit" ? selected.slice(0, Math.max(1, 8 - assets.filter((asset) => asset.role === "outfit").length)) : selected.slice(0, 1);
    const valid = limited.filter((file) => {
      if (!file.type.startsWith("image/")) {
        toast.error(`${file.name} 不是图片文件`);
        return false;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} 超过 ${MAX_FILE_SIZE_MB}MB`);
        return false;
      }
      return true;
    });
    if (!valid.length) return;

    setUploading(true);
    try {
      const uploaded: OutfitFusionAsset[] = [];
      for (const file of valid) {
        const result = await uploadImage(file);
        uploaded.push({
          id: `upload-${Date.now()}-${uploaded.length}`,
          role,
          url: result.display_url || result.url,
          name: getUploadedAssetName(role, assets, uploaded.length),
        });
      }
      setSelectedTemplate(null);
      setAssets((current) => {
        const kept = role === "outfit" ? current : current.filter((asset) => asset.role !== role);
        return [...kept, ...uploaded].slice(0, 10);
      });
      if (!prompt.trim()) {
        setPrompt(limitComposerPrompt(buildPromptDraft(uploaded, role)));
      }
      toast.success("素材已上传到 OSS");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  function handleRemoveAsset(id: string) {
    setAssets((current) => current.filter((asset) => asset.id !== id));
    setSelectedTemplate(null);
  }

  function handleClear() {
    setAssets([]);
    setPrompt("");
    setSelectedTemplate(null);
    setConfig(DEFAULT_OUTFIT_FUSION_CONFIG);
  }

  async function handleAutoWrite() {
    if (!assets.length) {
      toast.info("请先上传或套用搭配素材");
      return;
    }
    const seedPrompt = prompt.trim() || (selectedTemplate ? buildOutfitFusionComposerText(selectedTemplate) : buildPromptDraft(assets, "outfit"));
    setAutoWriting(true);
    try {
      const response = await fetch("/api/general-image/optimize-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "image-to-image",
          reference_urls: assets.map((asset) => asset.url),
          prompt: buildOutfitFusionVisionPromptRequest(assets, seedPrompt),
        }),
      });
      const data = await response.json().catch(() => ({})) as { prompt?: unknown; source?: unknown; error?: unknown };
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "AI 帮写失败");
      }
      const nextPrompt = data.source === "fallback"
        ? seedPrompt
        : typeof data.prompt === "string" && data.prompt.trim()
        ? normalizeOutfitFusionAssistantPrompt(data.prompt, seedPrompt)
        : seedPrompt;
      setPrompt(limitComposerPrompt(getOutfitFusionDisplayPrompt(nextPrompt, seedPrompt)));
      toast.success(data.source === "fallback" ? "已生成搭配描述" : "视觉分析完成");
    } catch (error) {
      setPrompt(seedPrompt);
      toast.error(error instanceof Error ? error.message : "AI 帮写失败，已保留基础描述");
    } finally {
      setAutoWriting(false);
    }
  }

  function handleJumpToBottom() {
    setComposerCollapsed(false);
    scrollContainerToBottom(mainRef.current, 30);
  }

  function scrollTaskListToTop(delay = 0) {
    scrollNodeToContainerTop(mainRef.current, taskListRef.current, 24, delay);
    scrollNodeToContainerTop(mainRef.current, taskListRef.current, 24, delay + 240);
  }

  function handleExpandComposer() {
    setComposerCollapsed(false);
  }

  function handleCollapseComposer() {
    setComposerCollapsed(true);
  }

  function handleReedit(task: OutfitFusionTask) {
    setAssets(task.inputAssets);
    setPrompt(limitComposerPrompt(task.prompt));
    setConfig(task.config);
    setSelectedTemplate(OUTFIT_FUSION_TEMPLATES.find((item) => item.id === task.templateId) || null);
    setComposerCollapsed(false);
  }

  function handleDeleteTask(id: string) {
    setTasks((current) => current.filter((task) => task.id !== id));
  }

  async function handleCopyTask(task: OutfitFusionTask) {
    const value = task.remoteId || task.taskNo;
    try {
      await navigator.clipboard.writeText(value);
      toast.success("任务编号已复制");
    } catch {
      toast.error("复制失败，请手动选择任务编号");
    }
  }

  function handleGenerate() {
    void createTaskFromState(assets, prompt, config, selectedTemplate);
  }

  async function handleRegenerate(task: OutfitFusionTask) {
    const template = OUTFIT_FUSION_TEMPLATES.find((item) => item.id === task.templateId) || null;
    await createTaskFromState(task.inputAssets, task.prompt, task.config, template);
  }

  async function createTaskFromState(
    inputAssets: OutfitFusionAsset[],
    inputPrompt: string,
    inputConfig: OutfitFusionConfig,
    template: OutfitFusionTemplate | null
  ) {
    if (!inputAssets.length) {
      toast.error("请先上传或套用搭配素材");
      return;
    }
    if (!inputPrompt.trim()) {
      toast.error("请先填写搭配描述");
      return;
    }

    const expectedCount = clampOutfitFusionCount(inputConfig.genCount);
    const taskCost = getCreditCost(inputConfig.aiModel, inputConfig.imageSize, inputConfig.aspectRatio) * expectedCount;
    const inputThumbnails = inputAssets.map((asset) => asset.url);
    if (!isAuthenticated && !(await refreshAuth())) {
      toast.error("请先登录");
      router.push("/login");
      return;
    }
    if (credits !== null && credits < taskCost) {
      showInsufficientCreditsToast({ required: taskCost, balance: credits, onRecharge: () => router.push("/pricing") });
      return;
    }

    const taskId = `outfit-fusion-${Date.now()}`;
    const taskNo = String(281115000 + Math.floor(Math.random() * 9000));
    const requestPrompt = buildOutfitFusionPrompt({
      templatePrompt: inputPrompt,
      assets: inputAssets,
      config: { ...inputConfig, genCount: expectedCount },
    });
    const task: OutfitFusionTask = {
      id: taskId,
      taskNo,
      templateId: template?.id || null,
      createdAt: new Date().toISOString(),
      statusGroup: "running",
      progress: 12,
      prompt: inputPrompt,
      requestPrompt,
      inputAssets: inputAssets.map((asset) => ({ ...asset })),
      config: { ...inputConfig, genCount: expectedCount },
      expectedCount,
      resultUrls: [],
    };

    setTasks([task]);
    taskQueue.startTask({
      id: taskId,
      expectedCount,
      inputThumbnails,
      progress: task.progress,
      status: "processing",
      statusGroup: "running",
      applyUrl: "",
    });
    setComposerCollapsed(true);
    scrollTaskListToTop(80);
    toast.success("创建成功，请等待任务执行完成");

    setCreating(true);
    try {
      const result = await submitGeneration(task);
      setCreating(false);
      if (typeof result.creditsRemaining === "number") setCredits(result.creditsRemaining);
      const remoteId = result.generationId;
      if (remoteId) {
        updateTask(taskId, { remoteId, progress: 24 });
        taskQueue.replaceWithServerTask(taskId, {
          id: remoteId,
          expectedCount,
          inputThumbnails,
          progress: 24,
          status: "processing",
          statusGroup: "running",
          applyUrl: `/outfit-fusion?task=${encodeURIComponent(remoteId)}`,
        });
        taskQueue.refresh();
        void pollGeneration(taskId, remoteId, expectedCount, inputThumbnails).catch(async (error) => {
          taskQueue.markFailed(remoteId, error instanceof Error ? error.message : "生成轮询超时", {
            expectedCount,
            inputThumbnails,
          });
          updateTask(taskId, {
            error: error instanceof Error ? error.message : "生成轮询超时",
            progress: 100,
            statusGroup: "failed",
          });
          taskQueue.refresh();
        });
      } else {
        taskQueue.markFailed(taskId, "任务提交失败，未返回任务编号", {
          expectedCount,
          inputThumbnails,
        });
        updateTask(taskId, {
          error: "任务提交失败，未返回任务编号",
          progress: 100,
          statusGroup: "failed",
        });
      }
    } catch (error) {
      setCreating(false);
      const message = error instanceof Error ? error.message : "生成任务提交失败";
      taskQueue.markFailed(taskId, message, {
        expectedCount,
        inputThumbnails,
      });
      updateTask(taskId, { error: message, progress: 100, statusGroup: "failed" });
      toast.error(message);
    }
  }

  async function submitGeneration(task: OutfitFusionTask): Promise<{ generationId: string | null; creditsRemaining?: number }> {
    const response = await fetch("/api/general-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "image-to-image",
        prompt: task.requestPrompt,
        user_prompt: task.prompt,
        reference_urls: task.inputAssets.map((asset) => asset.url),
        input_assets: task.inputAssets.map((asset) => ({
          id: asset.id,
          role: asset.role,
          url: asset.url,
          name: asset.name,
        })),
        ai_model: task.config.aiModel,
        aspect_ratio: task.config.aspectRatio,
        image_size: task.config.imageSize,
        gen_count: task.expectedCount,
        module_kind: "outfitFusion",
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        await refreshAuth();
        router.push("/login");
      }
      if (response.status === 402 && typeof data.balance === "number") {
        setCredits(data.balance);
      }
      throw new Error(typeof data.error === "string" ? data.error : "生成任务提交失败");
    }
    return {
      generationId: typeof data.generation_id === "string" ? data.generation_id : null,
      creditsRemaining: typeof data.credits_remaining === "number" ? data.credits_remaining : undefined,
    };
  }

  async function pollGeneration(taskId: string, remoteId: string, expectedCount: number, inputThumbnails: string[]) {
    let latestUrls: string[] = [];
    for (let attempt = 0; attempt < 90; attempt++) {
      await wait(2000);
      const response = await fetch(`/api/general-image?generation_id=${encodeURIComponent(remoteId)}`);
      if (!response.ok) continue;
      const state = await response.json();
      const progress = Number(state.progress);
      const nextProgress = Number.isFinite(progress) ? Math.min(Math.max(Math.round(progress), 24), 99) : Math.min(24 + attempt * 3, 92);
      if (Array.isArray(state.result_urls) && state.result_urls.length) {
        latestUrls = state.result_urls.filter((url: unknown): url is string => typeof url === "string" && url.trim().length > 0);
      }
      updateTask(taskId, {
        statusGroup: state.status === "completed" ? "completed" : state.status === "failed" ? "failed" : "running",
        progress: state.status === "completed" ? 100 : nextProgress,
        resultUrls: latestUrls,
        expectedCount,
        error: typeof state.error === "string" ? state.error : null,
      });
      if (state.status === "completed") {
        taskQueue.markCompleted(remoteId, {
          expectedCount,
          inputThumbnails,
          resultThumbnails: latestUrls,
          resultCount: latestUrls.length,
        });
        toast.success("搭配融图生成完成");
        taskQueue.refresh();
        return;
      }
      if (state.status === "failed") {
        taskQueue.markFailed(remoteId, typeof state.error === "string" ? state.error : "生成失败", {
          expectedCount,
          inputThumbnails,
          resultThumbnails: latestUrls,
          resultCount: latestUrls.length,
        });
        throw new Error(typeof state.error === "string" ? state.error : "生成失败");
      }
      taskQueue.markRunning(remoteId, {
        expectedCount,
        inputThumbnails,
        resultThumbnails: latestUrls,
        resultCount: latestUrls.length,
        progress: nextProgress,
        status: "processing",
      });
    }
    throw new Error("生成超时");
  }

  function updateTask(id: string, patch: Partial<OutfitFusionTask>) {
    setTasks((current) => current.map((task) => (task.id === id ? { ...task, ...patch } : task)));
  }

  function handleContinueCreate() {
    setPreview(null);
    setAssetPreviewId(null);
    setTasks([]);
    setAssets([]);
    setPrompt("");
    setSelectedTemplate(null);
    setConfig(DEFAULT_OUTFIT_FUSION_CONFIG);
    setComposerCollapsed(false);
  }

  function handleRailRunningTask(item: TaskQueueItem) {
    const existing = tasks.find((task) => task.remoteId === item.id || task.id === item.id);
    if (existing) {
      scrollTaskListToTop(40);
      return;
    }
    upsertTaskFromQueueItem(item);
    scrollTaskListToTop(40);
  }

  async function handleRailTaskSelect(item: TaskQueueItem, session: TaskSelectionSession) {
    if (session.reason === "restore" && item.statusGroup !== "running" && item.statusGroup !== "queued") {
      return true;
    }
    try {
      const detail = await fetchHistoryApplyDetail(item.id, "outfitFusion", session.signal);
      if (!session.isCurrent()) return true;
      if (detail.payload.kind !== "outfitFusion") {
        upsertTaskFromQueueItem(item);
        return true;
      }
      applyOutfitFusionHistoryPayload(detail.payload, detail.resultUrls.length ? detail.resultUrls : safeTaskQueueUrls(item.resultThumbnails), item, {
        silent: session.reason === "restore",
      });
      return true;
    } catch {
      if (session.signal.aborted || !session.isCurrent()) return true;
      upsertTaskFromQueueItem(item);
      if (item.statusGroup === "failed") toast.error(item.error || "历史任务加载失败");
      return true;
    }
  }

  function applyOutfitFusionHistoryPayload(
    payload: Extract<HistoryJobPayload, { kind: "outfitFusion" }>,
    resultUrls: string[],
    item: TaskQueueItem,
    options?: { silent?: boolean }
  ) {
    const restoredAssets = restoreOutfitFusionAssetsFromPayload(payload, item.id);
    const restoredConfig: OutfitFusionConfig = {
      aiModel: payload.aiModel,
      aspectRatio: payload.aspectRatio === "auto" || payload.aspectRatio === "1:1" ? payload.aspectRatio : "3:4",
      imageSize: payload.imageSize,
      quality: DEFAULT_OUTFIT_FUSION_CONFIG.quality,
      genCount: clampOutfitFusionCount(payload.genCount),
    };
    const displayPrompt = getOutfitFusionDisplayPrompt(payload.userPrompt || payload.prompt);

    setSelectedTemplate(null);
    setAssets(restoredAssets);
    setPrompt(limitComposerPrompt(displayPrompt));
    setConfig(restoredConfig);
    upsertTaskFromQueueItem(item, {
      prompt: displayPrompt,
      requestPrompt: payload.prompt,
      inputAssets: restoredAssets,
      config: restoredConfig,
      resultUrls,
      statusGroup: resultUrls.length ? "completed" : item.statusGroup,
      progress: resultUrls.length ? 100 : item.progress,
    });
    setComposerCollapsed(false);
    scrollTaskListToTop(80);
    if (!options?.silent) toast.success("已套用侧边历史任务");
  }

  function applyOutfitFusionApplyDetail(
    detail: HistoryApplyDetail<"outfitFusion">,
    options?: { silent?: boolean }
  ) {
    const item = createTaskQueueItemFromApplyDetail(detail);
    applyOutfitFusionHistoryPayload(
      detail.payload,
      detail.resultUrls.length ? detail.resultUrls : safeTaskQueueUrls(item.resultThumbnails),
      item,
      options
    );
  }

  function createTaskQueueItemFromApplyDetail(detail: HistoryApplyDetail<"outfitFusion">): TaskQueueItem {
    const id = detail.row.id || `history-${Date.now()}`;
    const resultUrls = detail.resultUrls;
    const inputThumbnails = getOutfitFusionPayloadAssetUrls(detail.payload);
    const statusGroup: TaskStatusGroup = resultUrls.length
      ? "completed"
      : isHistoryApplyRowFailed(detail.row)
        ? "failed"
        : "running";
    const now = new Date().toISOString();
    return {
      id,
      module: "outfitFusion",
      title: "搭配融图",
      status: detail.row.status || (statusGroup === "completed" ? "completed" : "processing"),
      statusGroup,
      time: "0:00",
      createdAt: now,
      updatedAt: now,
      completedAt: statusGroup === "completed" ? now : null,
      error: getHistoryApplyFailureMessage(detail.row, ""),
      progress: statusGroup === "completed" ? 100 : statusGroup === "failed" ? 0 : 30,
      expectedCount: clampOutfitFusionCount(detail.payload.genCount),
      resultCount: resultUrls.length,
      inputThumbnails,
      resultThumbnails: resultUrls,
      thumbnails: resultUrls.length ? resultUrls : inputThumbnails.slice(0, 4),
      applyUrl: `/outfit-fusion?apply=${encodeURIComponent(id)}`,
    };
  }

  function upsertTaskFromQueueItem(item: TaskQueueItem, patch: Partial<OutfitFusionTask> = {}) {
    const existingTask = tasks.find((task) => task.remoteId === item.id || task.id === item.id || task.id === `queue-${item.id}`);
    const inputAssets = patch.inputAssets || existingTask?.inputAssets || safeTaskQueueUrls(item.inputThumbnails).map((url, index) => ({
      id: `queue-${item.id}-${index}`,
      role: "outfit" as const,
      url,
      name: getIndexedAssetLabel({ role: "outfit" }, index),
    }));
    const resultUrls = patch.resultUrls || safeTaskQueueUrls(item.resultThumbnails);
    const queueTitle = item.title?.trim() || "";
    const titleLooksGeneric = !queueTitle || queueTitle === "搭配融图" || queueTitle === "搭配融图任务";
    const fallbackPrompt = titleLooksGeneric ? prompt.trim() || buildPromptDraft(inputAssets, "outfit") : queueTitle;
    const restoredPrompt = patch.prompt || existingTask?.prompt || fallbackPrompt;
    const preservedTaskPatch = {
      prompt: restoredPrompt,
      requestPrompt: patch.requestPrompt || existingTask?.requestPrompt || restoredPrompt,
      config: patch.config || existingTask?.config || DEFAULT_OUTFIT_FUSION_CONFIG,
    };
    const restoredTask: OutfitFusionTask = {
      id: `queue-${item.id}`,
      remoteId: item.id,
      taskNo: item.id,
      templateId: null,
      createdAt: item.createdAt,
      statusGroup: item.statusGroup,
      progress: item.progress,
      inputAssets,
      expectedCount: Math.max(1, patch.expectedCount || item.expectedCount || resultUrls.length || existingTask?.expectedCount || preservedTaskPatch.config.genCount || DEFAULT_OUTFIT_FUSION_CONFIG.genCount),
      resultUrls,
      error: item.error || null,
      ...patch,
      ...preservedTaskPatch,
    };
    setTasks([restoredTask]);
  }

  return (
    <div className="studio-workbench outfit-fusion-workbench flex min-h-[calc(100dvh-64px)] flex-col bg-[#f4f5fb] lg:flex-row">
      <FeatureTabs active="outfitFusion" />
      <ModuleTaskRail
        module="outfitFusion"
        moduleLabel="搭配融图"
        onContinue={handleContinueCreate}
        onRunningTask={handleRailRunningTask}
        onCompletedTask={handleRailTaskSelect}
      />

      <main
        ref={mainRef}
        className="min-w-0 flex-1 overflow-visible"
        style={{ paddingBottom: composerBottomReserve }}
      >
        <section className="px-4 pb-8 pt-10 sm:px-6 lg:px-10">
          <div className="mx-auto mb-5 w-full max-w-[1120px] text-[12px] leading-5 tracking-normal text-slate-400">
            因产品处于持续学习调优阶段，可能有不恰当的信息，请您谨慎甄别。
          </div>

          <div ref={taskListRef} className="mx-auto w-full max-w-[1120px]">
            <div className={cn("space-y-4", tasks.length > 0 && "mb-8")}>
              {tasks.map((task, index) => (
                <OutfitFusionTaskCard
                  key={task.id}
                  task={task}
                  index={index}
                  onPreview={(index) => setPreview({ taskId: task.id, index })}
                  onReedit={() => handleReedit(task)}
                  onReuseInputs={() => handleReedit(task)}
                  onRegenerate={() => void handleRegenerate(task)}
                  onCopy={() => void handleCopyTask(task)}
                  onDelete={() => handleDeleteTask(task.id)}
                />
              ))}
            </div>
          </div>

          <div className={cn("animate-fade-in motion-reduce:animate-none", tasks.length > 0 && "mt-8")}>
            <h1 className="mb-6 text-center text-[24px] font-semibold leading-[34px] tracking-normal text-slate-900">自由搭配组合，生成模特图</h1>
            <OutfitFusionExampleGallery
              templates={OUTFIT_FUSION_TEMPLATES}
              activeTemplateId={selectedTemplate?.id || null}
              onUseTemplate={applyTemplate}
            />
          </div>
        </section>

        <div ref={bottomRef} className="h-1" />
      </main>

      <div
        ref={composerWrapRef}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform lg:left-[calc(var(--studio-nav-rail-width)+var(--studio-task-rail-width))] lg:right-0 lg:px-6"
      >
        <OutfitFusionComposer
          assets={assets}
          prompt={prompt}
          config={config}
          collapsed={composerCollapsed}
          generating={creating}
          autoWriting={autoWriting}
          uploading={uploading}
          creditCost={totalCost}
          credits={credits}
          authIsAnonymous={authIsAnonymous}
          onPromptChange={setPrompt}
          onConfigChange={setConfig}
          onUploadClick={handleUploadClick}
          onUploadFiles={(role, files) => void handleFiles(files, role)}
          onPreviewAsset={setAssetPreviewId}
          onRemoveAsset={handleRemoveAsset}
          onClear={handleClear}
          onAutoWrite={handleAutoWrite}
          onGenerate={handleGenerate}
          onCollapse={handleCollapseComposer}
          onExpand={handleExpandComposer}
          onJumpToBottom={handleJumpToBottom}
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp,image/heic"
        multiple={uploadRole === "outfit"}
        className="hidden"
        onChange={(event) => void handleFiles(event.target.files)}
      />

      {previewSession ? (
        <StudioImagePreviewDialog
          open
          onClose={() => {
            setPreview(null);
          }}
          session={previewSession}
          filenamePrefix="outfit-fusion"
          selectedIndex={preview?.index || 0}
          onSelectedIndexChange={(index) => {
            if (preview) setPreview({ taskId: preview.taskId, index });
          }}
          actions={PREVIEW_ACTIONS}
          onRegenerateAll={!previewTask ? undefined : () => {
            void handleRegenerate(previewTask);
          }}
        />
      ) : null}
      {assetPreviewSession ? (
        <StudioImagePreviewDialog
          open
          onClose={() => setAssetPreviewId(null)}
          session={assetPreviewSession}
          filenamePrefix="outfit-fusion-asset"
          selectedIndex={0}
          actions={[]}
          className="studio-image-preview-dialog-content--asset"
        />
      ) : null}
    </div>
  );
}

function getOutfitFusionTaskGridClass(count: number) {
  if (count <= 1) return "max-w-[min(340px,100%)] grid-cols-1";
  if (count === 2) return "max-w-[min(700px,100%)] grid-cols-1 sm:grid-cols-2";
  if (count === 3) return "max-w-[min(1048px,100%)] grid-cols-1 sm:grid-cols-3";
  return "max-w-[min(1396px,100%)] grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";
}

function OutfitFusionTaskCard({
  task,
  index,
  onPreview,
  onReedit,
  onReuseInputs,
  onRegenerate,
  onCopy,
  onDelete,
}: {
  task: OutfitFusionTask;
  index: number;
  onPreview: (index: number) => void;
  onReedit: () => void;
  onReuseInputs: () => void;
  onRegenerate: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  const running = task.statusGroup === "running" || task.statusGroup === "queued";
  const failed = task.statusGroup === "failed";
  const slots = Math.max(task.expectedCount, task.resultUrls.length, 1);
  const displaySlots = slots;
  const [promptExpanded, setPromptExpanded] = useState(false);
  const canExpandPrompt = task.prompt.length > 64;
  const openImageRepair = (url: string) => {
    router.push(buildSourceImageHref("/general-image/image-to-image", url));
  };
  const openAiVideo = (url: string) => {
    router.push(buildSourceImageHref("/video", url));
  };
  const downloadResult = (url: string, slotIndex: number) => {
    void downloadImage(url, generateDownloadFilename("outfit-fusion", slotIndex, "png"));
  };

  return (
    <article
      className="animate-slide-up rounded-[8px] bg-white p-3 shadow-sm ring-1 ring-slate-100 transition duration-300 hover:shadow-[0_14px_34px_rgba(15,23,42,0.09)] motion-reduce:animate-none sm:p-4"
      style={{ animationDelay: `${Math.min(index * 40, 160)}ms` }}
    >
      <div className="flex items-start gap-1.5">
        <TaskInputReuseStack assets={task.inputAssets} onReuse={onReuseInputs} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <p className={cn("min-w-0 flex-1 whitespace-pre-wrap break-words text-[14px] leading-[23px] tracking-normal text-slate-900", !promptExpanded && "line-clamp-2")}>{task.prompt}</p>
            {canExpandPrompt ? (
              <button
                type="button"
                onClick={() => setPromptExpanded((value) => !value)}
                className="mt-0.5 inline-flex shrink-0 items-center gap-0.5 rounded-[5px] px-1.5 py-0.5 text-xs font-medium text-[var(--codex-accent)] transition hover:bg-[rgba(5,5,5,0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/30"
                aria-expanded={promptExpanded}
              >
                {promptExpanded ? "收起" : "展开"}
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", promptExpanded && "rotate-180")} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <TooltipProvider delayDuration={120}>
        <div className={cn("mt-3 grid w-full gap-3 sm:gap-4", getOutfitFusionTaskGridClass(displaySlots))}>
          {Array.from({ length: displaySlots }, (_, index) => {
            const url = task.resultUrls[index];
            return url ? (
              <div
                key={`${task.id}-${index}`}
                role="button"
                tabIndex={0}
                aria-label={`预览生成图 ${index + 1}`}
                title={`预览生成图 ${index + 1}`}
                onClick={() => onPreview(index)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onPreview(index);
                }}
                className="studio-result-card outfit-fusion-result-card group/slot relative aspect-[3/4] cursor-zoom-in overflow-hidden rounded-[4px] bg-[#f4f6fa] text-sm text-slate-400 outline-none transition duration-300 hover:z-[1] hover:shadow-[0_10px_28px_rgba(15,23,42,0.18)] focus-visible:ring-2 focus-visible:ring-zinc-950/30 focus-visible:ring-offset-2"
              >
                <LoadableResultImage src={url} alt={`生成图${index + 1}`} />
                <span className="pointer-events-none absolute left-2 top-2 rounded-[4px] bg-[var(--codex-accent)] px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-white shadow-sm">
                  {index + 1}/{slots}
                </span>
                <div className="studio-result-focus-layer" aria-hidden={false}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="studio-result-focus-view inline-flex h-8 items-center gap-1.5 px-3"
                    onClick={(event) => {
                      event.stopPropagation();
                      onPreview(index);
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <Eye className="h-4 w-4" />
                    查看
                  </Button>
                  <div className="studio-result-focus-actions">
                    <OutfitFusionFocusAction label="AI修图" onClick={() => openImageRepair(url)} icon={<WandSparkles className="h-3.5 w-3.5" />} />
                    <OutfitFusionFocusAction label="AI视频" onClick={() => openAiVideo(url)} icon={<Clapperboard className="h-3.5 w-3.5" />} />
                    <OutfitFusionFocusAction label="下载" onClick={() => downloadResult(url, index)} icon={<Download className="h-3.5 w-3.5" />} />
                  </div>
                </div>
              </div>
            ) : (
              <div
                key={`${task.id}-${index}`}
                role="status"
                aria-live="polite"
                className="studio-result-card group/slot relative aspect-[3/4] overflow-hidden bg-white text-sm text-white"
              >
                <div className={cn("gen-card studio-result-pending-card outfit-fusion-pending-card relative z-[1] flex h-full w-full flex-col items-center justify-center gap-2", failed && "studio-result-pending-card-failed")}>
                  {failed ? (
                    <span className="text-xs font-semibold text-red-100">生成失败</span>
                  ) : (
                    <>
                      <div className="relative flex h-14 w-14 items-center justify-center">
                        <span className="gen-ring absolute inset-0 rounded-full bg-zinc-300/40" />
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-white/16 bg-white/10 shadow-lg backdrop-blur-md">
                          <Loader2 className="h-6 w-6 animate-spin text-white" />
                        </div>
                      </div>
                      <p className="relative z-[1] text-xs font-semibold text-white/72">生成中，请稍候</p>
                      <p className="relative z-[1] text-[11px] font-medium text-white/42">第 {index + 1} 张生成中</p>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </TooltipProvider>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs leading-5 text-slate-400">
        <div className="flex flex-wrap items-center gap-2">
          <span>{formatTaskTime(task.createdAt)}</span>
          <span>|</span>
          <span>任务: {task.remoteId || task.taskNo}</span>
          <button
            type="button"
            onClick={onCopy}
            className="rounded-[5px] p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/30"
            aria-label="复制任务编号"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          {running ? <span className="text-[var(--codex-accent)]">{task.progress}%</span> : null}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onReedit} className="inline-flex items-center gap-1 rounded-[5px] px-1 py-0.5 text-slate-700 transition hover:bg-[rgba(5,5,5,0.06)] hover:text-[var(--codex-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/30">
            <PenLine className="h-3.5 w-3.5" />
            重新编辑
          </button>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={running}
            className="inline-flex items-center gap-1 rounded-[5px] px-1 py-0.5 text-slate-700 transition hover:bg-[rgba(5,5,5,0.06)] hover:text-[var(--codex-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/30 disabled:text-slate-300"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重新生成
          </button>
          <button type="button" onClick={onDelete} className="inline-flex items-center gap-1 rounded-[5px] px-1 py-0.5 text-slate-500 transition hover:bg-[rgba(5,5,5,0.06)] hover:text-[var(--codex-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/30">
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </button>
        </div>
      </div>
    </article>
  );
}

function OutfitFusionFocusAction({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="studio-result-focus-action"
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
          onKeyDown={(event) => event.stopPropagation()}
          aria-label={label}
        >
          {icon}
          <span>{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function TaskInputReuseStack({ assets, onReuse }: { assets: OutfitFusionAsset[]; onReuse: () => void }) {
  const displayAssets = assets.slice(0, 3);
  const hiddenCount = Math.max(assets.length - displayAssets.length, 0);
  const hasHiddenAssets = hiddenCount > 0;

  return (
    <div className="hidden w-[68px] shrink-0 sm:block">
      <TooltipProvider delayDuration={120}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onReuse}
              className="group/reuse relative h-[54px] w-[68px] rounded-[6px] outline-none transition focus-visible:ring-2 focus-visible:ring-zinc-950/30 focus-visible:ring-offset-2"
              aria-label="再次使用图片"
            >
              {displayAssets.map((asset, index) => {
                const label = getCanonicalInputImageLabel(index);
                return (
                  <span
                    key={asset.id}
                    className={cn(
                      "absolute top-1 h-11 w-8 overflow-hidden rounded-[4px] border border-white bg-white shadow-sm transition duration-300 group-hover/reuse:-translate-y-1 group-hover/reuse:shadow-md group-focus-visible/reuse:-translate-y-1 group-focus-visible/reuse:shadow-md",
                      index === 0 && "left-0 -rotate-6",
                      index === 1 && (hasHiddenAssets ? "left-3.5 rotate-1" : "left-4 rotate-2"),
                      index === 2 && (hasHiddenAssets ? "left-7 rotate-3" : "left-8 rotate-6")
                    )}
                    title={`${label} · ${getOutfitFusionRoleLabel(asset.role)}`}
                  >
                    <span className="absolute left-0 top-0 z-[1] max-w-full truncate rounded-br-[4px] bg-slate-950/72 px-1 py-0.5 text-[9px] font-semibold leading-none text-white">
                      {label}
                    </span>
                    <RawPreviewImage src={asset.url} alt={`${label}${getOutfitFusionRoleLabel(asset.role)}`} className="h-full w-full object-cover" />
                  </span>
                );
              })}
              {hasHiddenAssets ? (
                <span className="absolute right-0 top-1 z-[4] flex h-11 w-8 rotate-6 items-center justify-center overflow-hidden rounded-[4px] border border-white bg-[linear-gradient(135deg,rgba(31,41,55,0.92),rgba(100,116,139,0.78))] text-[11px] font-bold leading-none text-white shadow-[0_6px_14px_rgba(15,23,42,0.20)] transition duration-300 group-hover/reuse:-translate-y-1 group-hover/reuse:shadow-md group-focus-visible/reuse:-translate-y-1 group-focus-visible/reuse:shadow-md">
                  +{hiddenCount}
                </span>
              ) : null}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" sideOffset={6} className="rounded-[4px] bg-slate-950 px-2.5 py-1 text-xs font-medium text-white">
            再次使用图片
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function LoadableResultImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      {!loaded ? (
        <StudioHomeHeroLoadingBackdrop />
      ) : null}
      <RawPreviewImage
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        className={cn(
          "h-full w-full object-contain transition duration-500 group-hover/slot:scale-[1.012]",
          loaded ? "opacity-100" : "opacity-0"
        )}
      />
    </>
  );
}

function getTemplateAssetName(_assets: OutfitFusionAsset[], asset: OutfitFusionAsset, index: number) {
  return getIndexedAssetLabel(asset, index);
}

type OutfitFusionHistoryPayload = Extract<HistoryJobPayload, { kind: "outfitFusion" }>;

function restoreOutfitFusionAssetsFromPayload(payload: OutfitFusionHistoryPayload, sourceId: string): OutfitFusionAsset[] {
  const payloadAssets = Array.isArray(payload.assets) ? payload.assets : [];
  const restoredFromAssets = payloadAssets.flatMap((asset, index) => {
    const url = typeof asset.url === "string" ? asset.url.trim() : "";
    const role = normalizeOutfitFusionAssetRole(asset.role);
    if (!url || !role) return [];
    return [{
      id: asset.id || `history-${sourceId}-${index}`,
      role,
      url,
      name: asset.name || getIndexedAssetLabel({ role }, index),
    }];
  });
  if (restoredFromAssets.length) return restoredFromAssets;

  return getOutfitFusionPayloadAssetUrls(payload).map((url, index) => {
    const role = inferOutfitFusionRoleFromPrompt(payload.prompt, index);
    return {
      id: `history-${sourceId}-${index}`,
      role,
      url,
      name: getIndexedAssetLabel({ role }, index),
    };
  });
}

function getOutfitFusionPayloadAssetUrls(payload: OutfitFusionHistoryPayload) {
  const assetUrls = Array.isArray(payload.assets)
    ? payload.assets
        .map((asset) => typeof asset.url === "string" ? asset.url.trim() : "")
        .filter((url) => url.length > 0)
    : [];
  if (assetUrls.length) return assetUrls;
  return payload.referenceUrls.filter((url) => typeof url === "string" && url.trim().length > 0);
}

function getOutfitFusionAspectRatioLabel(value: OutfitFusionConfig["aspectRatio"]) {
  return value === "auto" ? "智能" : value;
}

function normalizeOutfitFusionAssetRole(value: unknown): OutfitFusionAssetRole | null {
  if (value === "reference" || value === "model" || value === "outfit") return value;
  return null;
}

function inferOutfitFusionRoleFromPrompt(prompt: string, index: number): OutfitFusionAssetRole {
  void prompt;
  void index;
  return "outfit";
}

function getUploadedAssetName(role: OutfitFusionAssetRole, existing: OutfitFusionAsset[], offset: number) {
  const index = existing.filter((asset) => asset.role === role).length + offset + 1;
  if (role === "model") return `模特图${index}`;
  return `${getOutfitFusionRoleLabel(role)}${index}`;
}

function getCanonicalInputImageLabel(index: number) {
  return `图${index + 1}`;
}

function getIndexedAssetLabel(asset: Pick<OutfitFusionAsset, "role">, index: number) {
  if (asset.role === "reference") return `参考图${index + 1}`;
  if (asset.role === "model") return `模特图${index + 1}`;
  return `搭配图${index + 1}`;
}

function buildPromptDraft(inputAssets: OutfitFusionAsset[], fallbackRole: OutfitFusionAssetRole) {
  const assets = inputAssets.length ? inputAssets : [{ role: fallbackRole } as OutfitFusionAsset];
  const outfitCount = assets.filter((asset) => asset.role === "outfit").length;
  const referenceIndex = assets.findIndex((asset) => asset.role === "reference");
  const modelIndex = assets.findIndex((asset) => asset.role === "model");
  const base = referenceIndex >= 0
    ? `让图${referenceIndex + 1}的人物姿态、构图和场景氛围作为画面基础`
    : "让自然商业模特";
  const outfitText = `穿上、佩戴或手持${outfitCount || 1}张搭配图中的服装、鞋包和配饰`;
  const faceText = modelIndex >= 0
    ? `，${buildOutfitFusionVisibleFaceText(`图${modelIndex + 1}`)}`
    : "";
  return `${base}，${outfitText}${faceText}，生成真实自然、细节准确、适合电商展示的模特穿搭图。`;
}

function formatTaskTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function scrollContainerToBottom(container: HTMLElement | null, delay = 0) {
  window.setTimeout(() => {
    const target = container || (document.scrollingElement as HTMLElement | null);
    target?.scrollTo({ top: target.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, delay);
}

function scrollNodeToContainerTop(container: HTMLElement | null, node: HTMLElement | null, offset = 0, delay = 0) {
  if (!node) return;
  window.setTimeout(() => {
    window.requestAnimationFrame(() => {
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const nodeRect = node.getBoundingClientRect();
        const top = Math.max(0, container.scrollTop + nodeRect.top - containerRect.top - offset);
        container.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
        return;
      }
      const top = Math.max(0, window.scrollY + node.getBoundingClientRect().top - offset);
      window.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    });
  }, delay);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function limitComposerPrompt(value: string) {
  return value.slice(0, 800);
}
