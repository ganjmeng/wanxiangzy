"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Bookmark,
  Check,
  ChevronRight,
  Download,
  Edit3,
  ImagePlus,
  Layers3,
  Loader2,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Activity,
  Trash2,
  Upload,
  Brush,
  X,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { Modal } from "antd";
import { FeatureTabs } from "@/components/FeatureTabs";
import { ModuleHeader } from "@/components/ModuleHeader";
import { PreviewGuide } from "@/components/PreviewGuide";
import { ModuleTaskRail } from "@/components/studio/ModuleTaskRail";
import { useStudioAuth } from "@/components/studio/useStudioAuth";
import type { TaskSelectionSession } from "@/components/studio/useTaskSelectionSession";
import { LoadingStage } from "@/components/studio/LoadingStage";
import { StudioGenerationCountSelector } from "@/components/studio/StudioFormControls";
import { StudioUploadTile } from "@/components/studio/StudioUploadTile";
import { RawPreviewImage } from "@/components/studio/RawPreviewImage";
import { VisualAnalysisStatusCard } from "@/components/studio/VisualAnalysisStatus";
import { useStableFileDrag } from "@/components/studio/useStableFileDrag";
import { useTaskQueueGeneration } from "@/components/studio/useTaskQueueGeneration";
import { StudioImagePreviewDialog } from "@/components/studio/StudioImagePreviewDialog";
import { ClientPortal } from "@/components/ClientPortal";
import { setCachedProfileCredits } from "@/lib/supabase/client";
import { fetchHistoryApplyDetail, getHistoryApplyFailureMessage, isHistoryApplyRowFailed, takeApplyDetail } from "@/lib/history-apply";
import { getImageVariantUrl } from "@/lib/image-variants";
import { clampTaskExpectedCount, safeTaskQueueUrls, type TaskQueueItem } from "@/lib/task-queue";
import { downloadImage, generateDownloadFilename, MAX_FILE_SIZE, MAX_FILE_SIZE_MB, uploadImage } from "@/lib/utils";
import { getCreditCost, getSupportedImageSizes, type AspectRatio, type ImageSize, type LingyaModel } from "@/lib/api/lingya";
import { showInsufficientCreditsToast } from "@/lib/ui/credit-copy";
import { FAILED_RETRY_NOTICE, buildPartialFailureDetail, summarizeGenerationError } from "@/lib/studio-generation-feedback";
import { createProductSetPreviewSession, takeSourceImageFromLocation, type ImagePreviewResultStatus } from "@/lib/studio-image-preview";
import {
  PRODUCT_SET_COUNTRIES,
  PRODUCT_SET_EXAMPLE_GROUPS,
  PRODUCT_SET_FONT_STYLE_LABELS,
  PRODUCT_SET_LANGUAGES,
  PRODUCT_SET_PLATFORMS,
  PRODUCT_SET_PRESET_PLANS,
  PRODUCT_SET_PROMPT_VERSION,
  PRODUCT_SET_STYLE_PACKS,
  buildProductSetPlanRecommendation,
  getProductSetModuleQualityLabel,
  getProductSetModuleKey,
  getProductSetModuleReason,
  getProductSetTemplates,
  getProductSetVisualDirectorPlanCount,
  normalizeProductSetProductProfile,
  resolveProductSetTemplates,
  shouldUseModelForTemplate,
  type ProductSetCopyDensity,
  type ProductSetCreationMode,
  type ProductSetCustomTemplate,
  type ProductSetFontStyle,
  type ProductSetImageType,
  type ProductSetApparelType,
  type ProductSetModuleOverride,
  type ProductSetModuleResult,
  type ProductSetModelStrategy,
  type ProductSetProductKind,
  type ProductSetProductProfile,
  type ProductSetResolvedTemplate,
  type ProductSetSettings,
  type ProductSetStylePack,
  type ProductSetTemplate,
  type ProductSetThemeMode,
} from "@/lib/product-set";
import {
  buildDefaultFavoritePlanName,
  buildFavoritePlanApplyState,
  buildSavedProductSetPlan,
  getPlanSourceTabForProductSetState,
  getSelectedPlanIdForProductSetState,
  normalizeFavoriteProductSetPlan,
  type ProductSetPlanSourceTab,
  type SavedProductSetPlan,
} from "@/lib/product-set-ui-state";
import {
  formatMissingInfo,
  getAnalysisFallbackMessage,
  getDefaultGenerationCount,
  getProductAnalysisStatus,
  isPlaceholderProductName,
  parseProductInfo,
  resolveAnalysisSource,
  splitBriefText,
  type ProductAnalysisSource,
  type ProductInfoFields,
} from "@/features/product-set/create/product-info";
import {
  COUNT_OPTIONS,
  CUSTOM_ASPECTS,
  DEFAULT_DRAFT,
  DEFAULT_REFERENCE_STYLE_BRIEF,
  DEFAULT_SETTINGS,
  FAVORITE_PRODUCT_SET_PLAN_LIMIT,
  MODELS,
  PLAN_SOURCE_TABS,
  PRODUCT_SET_PREVIEW_ACTIONS,
  buildReferenceStyleBrief,
} from "@/features/product-set/create/config";
import type {
  CustomDraft,
  ProductImage,
  ProductSetAnalysisDetail,
  ProductSetHistoryPayload,
  TemplateFilter,
} from "@/features/product-set/create/types";

export default function ProductSetPage() {
  const router = useRouter();
  const productInputRef = useRef<HTMLInputElement>(null);
  const customRefInputRef = useRef<HTMLInputElement>(null);
  const customModelRefInputRef = useRef<HTMLInputElement>(null);
  const customOtherRefInputRef = useRef<HTMLInputElement>(null);

  const {
    authChecked,
    isAuthenticated,
    userId,
    credits,
    setCredits,
    refreshAuth,
    refreshCredits,
  } = useStudioAuth();
  const [productImages, setProductImages] = useState<ProductImage[]>([]);
  const [productInfo, setProductInfo] = useState("");
  const [productProfile, setProductProfile] = useState<ProductSetProductProfile | null>(null);
  const [analysisDetail, setAnalysisDetail] = useState<ProductSetAnalysisDetail | null>(null);
  const [analysisSource, setAnalysisSource] = useState<ProductAnalysisSource>("idle");
  const [analysisMessage, setAnalysisMessage] = useState("");
  const [showProductInfoEditor, setShowProductInfoEditor] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [settings, setSettings] = useState<ProductSetSettings>(DEFAULT_SETTINGS);
  const [mode, setMode] = useState<ProductSetCreationMode>("smart");
  const [planSourceTab, setPlanSourceTab] = useState<ProductSetPlanSourceTab>("smart");
  const [imageType, setImageType] = useState<ProductSetImageType>("details");
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<number[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("smart");
  const [customTemplates, setCustomTemplates] = useState<ProductSetCustomTemplate[]>([]);
  const [moduleOverrides, setModuleOverrides] = useState<ProductSetModuleOverride[]>([]);
  const [editingModuleIndex, setEditingModuleIndex] = useState<number | null>(null);
  const [customDraft, setCustomDraft] = useState<CustomDraft>(DEFAULT_DRAFT);
  const [aiModel, setAiModel] = useState<LingyaModel>("nano-banana-2");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("auto");
  const [imageSize, setImageSize] = useState<ImageSize>("2K");
  const [genCount, setGenCount] = useState(0);
  const [qualityMode, setQualityMode] = useState<"standard" | "advanced">("standard");
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isUploadingCustomRef, setIsUploadingCustomRef] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [resultUrls, setResultUrls] = useState<string[]>([]);
  const [moduleResults, setModuleResults] = useState<ProductSetModuleResult[]>([]);
  const [resultPlan, setResultPlan] = useState<ProductSetResolvedTemplate[]>([]);
  const [error, setError] = useState("");
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [activeQueueTask, setActiveQueueTask] = useState<TaskQueueItem | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showCustomBuilder, setShowCustomBuilder] = useState(false);
  const [showAnalysisDetails, setShowAnalysisDetails] = useState(false);
  const [showFullPlan, setShowFullPlan] = useState(false);
  const [showGenerationSettings, setShowGenerationSettings] = useState(false);
  const [showReferenceStyleModal, setShowReferenceStyleModal] = useState(false);
  const [referenceStyleBrief, setReferenceStyleBrief] = useState("");
  const [referenceStyleDraft, setReferenceStyleDraft] = useState(DEFAULT_REFERENCE_STYLE_BRIEF);
  const [templateFilter, setTemplateFilter] = useState<TemplateFilter>("all");
  const [templateQuery, setTemplateQuery] = useState("");
  const [favoritePlans, setFavoritePlans] = useState<SavedProductSetPlan[]>([]);
  const [favoritePlanName, setFavoritePlanName] = useState("");
  const [isLoadingFavoritePlans, setIsLoadingFavoritePlans] = useState(false);
  const [isSavingFavoritePlan, setIsSavingFavoritePlan] = useState(false);
  const productImageDrag = useStableFileDrag<HTMLElement>({
    isDragging,
    setDragging: setIsDragging,
    fileFilter: (file) => file.type.startsWith("image/"),
    onFiles: processFiles,
  });

  const templates = useMemo(() => getProductSetTemplates(imageType), [imageType]);
  const activeSelectedTemplateIds = useMemo(
    () => selectedTemplateIds.filter((id) => templates.some((template) => template.id === id)),
    [selectedTemplateIds, templates]
  );
  const activeCustomTemplates = useMemo(
    () => customTemplates.filter((template) => template.imageType === imageType),
    [customTemplates, imageType]
  );
  const productInfoFields = useMemo(() => parseProductInfo(productInfo), [productInfo]);
  const displayProductInfoFields = useMemo(() => ({
    ...productInfoFields,
    name: isPlaceholderProductName(productInfoFields.name) ? "未识别出具体商品名" : productInfoFields.name,
  }), [productInfoFields]);
  const effectiveProductProfile = useMemo(
    () => normalizeProductSetProductProfile(productProfile, productInfo),
    [productProfile, productInfo]
  );
  const analysisStatus = getProductAnalysisStatus({
    source: isAnalyzing ? "running" : analysisSource,
    hasProductInfo: Boolean(productInfo.trim()),
    message: analysisMessage,
  });
  const hasAnalyzedProduct = analysisSource === "ai" || analysisSource === "history";
  const isReferenceMode = planSourceTab !== "smart";
  const canResolvePlan = hasAnalyzedProduct;
  const planTemplates = useMemo(
    () => canResolvePlan ? resolveProductSetTemplates({
      mode,
      imageType,
      selectedTemplateIds: activeSelectedTemplateIds,
      customTemplates: activeCustomTemplates,
      genCount,
      productProfile: effectiveProductProfile,
      settings,
      moduleOverrides,
    }) : [],
    [canResolvePlan, mode, imageType, activeSelectedTemplateIds, activeCustomTemplates, genCount, effectiveProductProfile, settings, moduleOverrides]
  );
  const planRecommendation = useMemo(
    () => buildProductSetPlanRecommendation({
      mode,
      imageType,
      templates: planTemplates,
      productProfile: effectiveProductProfile,
    }),
    [mode, imageType, planTemplates, effectiveProductProfile]
  );
  const supportedSizes = getSupportedImageSizes(aiModel, aspectRatio);
  const outputCount = planTemplates.length;
  const cost = planTemplates.length
    ? planTemplates.reduce((sum, template) => sum + getCreditCost(aiModel, imageSize, template.aspectRatio || aspectRatio), 0)
    : 0;
  const taskInputThumbnails = useMemo(
    () => productImages.map((item) => item.url).filter(Boolean),
    [productImages]
  );
  const taskQueue = useTaskQueueGeneration({
    module: "productSet",
    title: "商品套图",
    defaultExpectedCount: Math.max(1, outputCount || genCount),
    applyPath: "/product-set",
  });
  useEffect(() => {
    const sourceImage = takeSourceImageFromLocation();
    if (sourceImage) {
      setProductImages([{ url: sourceImage, name: "来自结果预览" }]);
      toast.success("已带入预览图片");
    }
  }, []);
  const requiresProductConfirmation = productImages.length > 0 && !isAnalyzing && mode === "smart" && !hasAnalyzedProduct;
  const canGenerate = !isGenerating && !isUploading && !isAnalyzing && canResolvePlan && productImages.length > 0 && Boolean(productInfo.trim()) && outputCount > 0;
  const canAnalyzeProduct = !isAnalyzing && !isUploading && productImages.length > 0;
  const workflowStep = !productImages.length ? 1 : (!productInfo.trim() || genCount <= 0) ? 2 : canResolvePlan && outputCount > 0 ? 4 : 3;
  const selectedStylePack = PRODUCT_SET_STYLE_PACKS.find((pack) => pack.id === settings.stylePackId) || PRODUCT_SET_STYLE_PACKS[0];
  const settingsSummary = `${settings.country} · ${settings.language} · ${settings.platform} · ${selectedStylePack.name} · ${PRODUCT_SET_FONT_STYLE_LABELS[settings.fontStyle]}`;
  const countOptions = COUNT_OPTIONS;
  const outputUnit = imageType === "main" ? "张主图" : "屏详情页";
  const detailsResolutionWarning = imageType === "details" && imageSize === "1K";
  const visiblePresetPlans = useMemo(
    () => PRODUCT_SET_PRESET_PLANS.filter((plan) => plan.id === "smart" || plan.imageType === imageType),
    [imageType]
  );
  const favoritePlanDefaultName = useMemo(
    () => buildDefaultFavoritePlanName(displayProductInfoFields.name, imageType, isPlaceholderProductName),
    [displayProductInfoFields.name, imageType]
  );

  useEffect(() => {
    let cancelled = false;
    if (!authChecked) return;
    if (!isAuthenticated) {
      setFavoritePlans([]);
      setIsLoadingFavoritePlans(false);
      return;
    }

    setIsLoadingFavoritePlans(true);
    fetch("/api/product-set/favorite-plans")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "收藏方案加载失败");
        const rawPlans = data && typeof data === "object" && Array.isArray((data as { plans?: unknown }).plans)
          ? (data as { plans: unknown[] }).plans
          : [];
        const plans = rawPlans.length
          ? rawPlans.map((item) => normalizeFavoriteProductSetPlan(item, DEFAULT_SETTINGS)).filter((plan): plan is SavedProductSetPlan => Boolean(plan))
          : [];
        if (!cancelled) setFavoritePlans(plans);
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "收藏方案加载失败");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingFavoritePlans(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authChecked, isAuthenticated]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
    const detail = await takeApplyDetail("productSet");
    const applyPayload = detail?.payload;
    if (cancelled || !applyPayload) return;

    const appliedImageType = applyPayload.imageType === "details" ? "details" : "main";
    setProductImages(applyPayload.productImageUrls.slice(0, 3).map((url, index) => ({ url, name: `历史商品图${index + 1}` })));
    setProductInfo(applyPayload.productInfo || "");
    setProductProfile(normalizeProductSetProductProfile(applyPayload.productProfile, applyPayload.productInfo || ""));
    setAnalysisDetail(null);
    setAnalysisSource(applyPayload.productInfo ? "history" : "idle");
    setAnalysisMessage("");
    setSettings({ ...DEFAULT_SETTINGS, ...(applyPayload.settings || {}) });
    const appliedMode = applyPayload.mode === "custom" ? "custom" : "smart";
    setMode(appliedMode);
    setPlanSourceTab(getPlanSourceTabForProductSetState({
      mode: appliedMode,
      selectedPlanId: appliedMode === "custom" ? "custom" : "smart",
      customTemplates: applyPayload.customTemplates || [],
    }));
    setImageType(appliedImageType);
    setSelectedTemplateIds(applyPayload.selectedTemplateIds || []);
    setSelectedPlanId(appliedMode === "custom" ? "custom" : "smart");
    setCustomTemplates(applyPayload.customTemplates || []);
    setModuleOverrides(applyPayload.moduleOverrides || []);
    setAiModel(applyPayload.aiModel);
    setAspectRatio(applyPayload.aspectRatio);
    setImageSize(applyPayload.imageSize);
    setGenCount(Math.min(Math.max(applyPayload.genCount || getDefaultGenerationCount(appliedImageType), 1), appliedImageType === "details" ? 8 : 6));
    setActiveQueueTask(null);
    setResultUrls(detail.resultUrls);
    setModuleResults([]);
    setResultPlan([]);
    setError(isHistoryApplyRowFailed(detail.row) ? getHistoryApplyFailureMessage(detail.row) : "");
    setProgress(detail.resultUrls.length ? 100 : 0);
    setIsGenerating(false);
    toast.success("已套用历史商品套图参数");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const nextSizes = getSupportedImageSizes(aiModel, aspectRatio);
    if (!nextSizes.includes(imageSize)) setImageSize(nextSizes[0] || "1K");
  }, [aiModel, aspectRatio, imageSize]);

  function resetOutput() {
    setActiveQueueTask(null);
    setIsGenerating(false);
    setRegeneratingIndex(null);
    setResultUrls([]);
    setModuleResults([]);
    setResultPlan([]);
    setError("");
    setProgress(0);
  }

  function handleContinueCreate() {
    setProductImages([]);
    setProductInfo("");
    setProductProfile(null);
    setAnalysisDetail(null);
    setAnalysisSource("idle");
    setAnalysisMessage("");
    setShowProductInfoEditor(false);
    setShowProfileEditor(false);
    setSettings({ ...DEFAULT_SETTINGS });
    setMode("smart");
    setPlanSourceTab("smart");
    setImageType("details");
    setSelectedTemplateIds([]);
    setSelectedPlanId("smart");
    setCustomTemplates([]);
    setModuleOverrides([]);
    setEditingModuleIndex(null);
    setCustomDraft({ ...DEFAULT_DRAFT });
    setAiModel("nano-banana-2");
    setAspectRatio("auto");
    setImageSize("2K");
    setGenCount(0);
    setQualityMode("standard");
    setReferenceStyleBrief("");
    setReferenceStyleDraft(DEFAULT_REFERENCE_STYLE_BRIEF);
    setTemplateFilter("all");
    setTemplateQuery("");
    setFavoritePlanName("");
    setShowSettingsModal(false);
    setShowTemplateModal(false);
    setShowCustomBuilder(false);
    setShowAnalysisDetails(false);
    setShowFullPlan(false);
    setShowGenerationSettings(false);
    setShowReferenceStyleModal(false);
    setLightboxSrc(null);
    resetOutput();
    if (productInputRef.current) productInputRef.current.value = "";
    if (customRefInputRef.current) customRefInputRef.current.value = "";
    if (customModelRefInputRef.current) customModelRefInputRef.current.value = "";
    if (customOtherRefInputRef.current) customOtherRefInputRef.current.value = "";
  }

  function confirmContinueCreate() {
    Modal.confirm({
      title: "继续创建",
      content: "继续创建将清空当前所有内容，确定要继续吗？",
      okText: "确定",
      cancelText: "取消",
      onOk: () => {
        handleContinueCreate();
      },
    });
  }

  function applyProductSetHistoryPayload(applyPayload: ProductSetHistoryPayload, historyResultUrls: string[] = [], options?: { silent?: boolean }) {
    const appliedImageType = applyPayload.imageType === "details" ? "details" : "main";
    const nextSettings = { ...DEFAULT_SETTINGS, ...(applyPayload.settings || {}) };
    const nextMode = applyPayload.mode === "custom" ? "custom" : "smart";
    const nextSelectedTemplateIds = applyPayload.selectedTemplateIds || [];
    const nextCustomTemplates = applyPayload.customTemplates || [];
    const nextSelectedPlanId = getSelectedPlanIdForProductSetState({
      mode: nextMode,
      imageType: appliedImageType,
      selectedTemplateIds: nextSelectedTemplateIds,
    });
    const nextGenCount = Math.min(
      Math.max(applyPayload.genCount || getDefaultGenerationCount(appliedImageType), 1),
      appliedImageType === "details" ? 8 : 6
    );

    setProductImages(applyPayload.productImageUrls.slice(0, 3).map((url, index) => ({ url, name: `历史商品图${index + 1}` })));
    setProductInfo(applyPayload.productInfo || "");
    setProductProfile(normalizeProductSetProductProfile(applyPayload.productProfile, applyPayload.productInfo || ""));
    setAnalysisDetail(null);
    setAnalysisSource(applyPayload.productInfo ? "history" : "idle");
    setAnalysisMessage("");
    setSettings(nextSettings);
    setMode(nextMode);
    setPlanSourceTab(getPlanSourceTabForProductSetState({
      mode: nextMode,
      selectedPlanId: nextSelectedPlanId,
      customTemplates: nextCustomTemplates,
    }));
    setImageType(appliedImageType);
    setSelectedTemplateIds(nextSelectedTemplateIds);
    setSelectedPlanId(nextSelectedPlanId);
    setCustomTemplates(nextCustomTemplates);
    setModuleOverrides(applyPayload.moduleOverrides || []);
    setAiModel(applyPayload.aiModel);
    setAspectRatio(applyPayload.aspectRatio);
    setImageSize(applyPayload.imageSize);
    setGenCount(nextGenCount);
    setActiveQueueTask(null);
    setResultUrls(historyResultUrls);
    setModuleResults([]);
    setResultPlan([]);
    setError("");
    setProgress(historyResultUrls.length ? 100 : 0);
    setIsGenerating(false);
    setRegeneratingIndex(null);
    if (!options?.silent) toast.success("已套用历史商品套图参数");
  }

  function resetAnalysisPlan(source: ProductAnalysisSource = productInfo.trim() ? "manual" : "idle", message = "") {
    setProductProfile(null);
    setAnalysisDetail(null);
    setAnalysisSource(source);
    setAnalysisMessage(message);
    setSettings((prev) => ({ ...prev, visualDirectorScript: "", visualDirectorPlan: undefined }));
    setModuleOverrides([]);
    setShowAnalysisDetails(false);
    setShowFullPlan(false);
    setShowGenerationSettings(false);
    resetOutput();
  }

  function changeGenerationCount(value: number) {
    setGenCount(value);
    resetOutput();
    if (analysisSource === "ai" || analysisSource === "history") {
      resetAnalysisPlan("manual", "数量已调整，请重新分析，让系统按新的数量重排方案。");
      toast.info("已更新数量，请重新分析生成对应方案");
    }
  }

  async function processFiles(files: FileList | File[]) {
    const incoming = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!incoming.length) return toast.error("请上传图片文件");
    const freeSlots = Math.max(0, 3 - productImages.length);
    if (!freeSlots) return toast.error("最多上传 3 张商品图");
    const filesToUpload = incoming.slice(0, freeSlots);
    if (incoming.length > filesToUpload.length) toast.info("商品图最多 3 张，已自动忽略超出的图片");
    const oversized = filesToUpload.find((file) => file.size > MAX_FILE_SIZE);
    if (oversized) return toast.error(`${oversized.name} 超过 ${MAX_FILE_SIZE_MB}MB`);

    setIsUploading(true);
    setProductInfo("");
    setProductProfile(null);
    setAnalysisDetail(null);
    setAnalysisSource("idle");
    setAnalysisMessage("");
    setSettings((prev) => ({ ...prev, visualDirectorScript: "", visualDirectorPlan: undefined }));
    setModuleOverrides([]);
    resetOutput();
    toast.info(`正在上传 ${filesToUpload.length} 张商品图...`);
    try {
      const results = await Promise.allSettled(filesToUpload.map((file) => uploadImage(file)));
      const next: ProductImage[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          next.push({ url: result.value.url, name: filesToUpload[index].name || `商品图${productImages.length + index + 1}` });
        } else {
          toast.error(`${filesToUpload[index].name} 上传失败`);
        }
      });
      if (next.length) {
        setProductImages((prev) => [...prev, ...next].slice(0, 3));
        toast.success("商品图已上传，请补充商品信息、选择数量后点击分析");
      }
    } finally {
      setIsUploading(false);
      if (productInputRef.current) productInputRef.current.value = "";
    }
  }

  function applyExampleGroup(group: typeof PRODUCT_SET_EXAMPLE_GROUPS[number]) {
    setProductImages(group.images.map((url, index) => ({ url, name: `${group.name} 图${index + 1}` })));
    setProductInfo("");
    setProductProfile(null);
    setAnalysisDetail(null);
    setAnalysisSource("idle");
    setAnalysisMessage("");
    setSettings((prev) => ({ ...prev, visualDirectorScript: "", visualDirectorPlan: undefined }));
    setModuleOverrides([]);
    resetOutput();
    toast.success(`已套用${group.name}，请补充商品信息、选择数量后点击分析`);
  }

  function removeProductImage(index: number) {
    setProductImages((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    setProductInfo("");
    setProductProfile(null);
    setAnalysisDetail(null);
    setAnalysisSource("idle");
    setAnalysisMessage("");
    setSettings((prev) => ({ ...prev, visualDirectorScript: "", visualDirectorPlan: undefined }));
    setModuleOverrides([]);
    resetOutput();
  }

  async function analyzeProductInfo(options: { silent?: boolean } = {}) {
    if (!productImages.length) return toast.error("请先上传商品图");
    if (genCount <= 0) return toast.error(`请先选择${imageType === "main" ? "生成张数" : "详情页屏数"}`);
    if (!isAuthenticated && !(await refreshAuth())) {
      if (!options.silent) toast.error("请先登录后使用智能分析");
      return;
    }
    setIsAnalyzing(true);
    setAnalysisSource("running");
    setAnalysisMessage("");
    if (!options.silent) toast.info(productInfo.trim() ? "正在优化商品信息和生成规划..." : "正在根据商品图帮你写商品信息...");
    try {
      const res = await fetch("/api/product-set/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_image_urls: productImages.map((item) => item.url),
          product_info: productInfo.trim(),
          reference_style_info: referenceStyleBrief.trim(),
          image_type: imageType,
          gen_count: genCount,
          target_platform: settings.platform,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        await refreshAuth();
        if (!options.silent) router.push("/login");
        return;
      }
      if (!res.ok) throw new Error(data.error || "分析失败");
      if (data.product_info) {
        const nextProductInfo = String(data.product_info).slice(0, 2000);
        const nextAnalysisSource = resolveAnalysisSource(data, nextProductInfo);
        setProductInfo(nextProductInfo);
        setAnalysisSource(nextAnalysisSource);
        setAnalysisMessage(nextAnalysisSource === "fallback" ? getAnalysisFallbackMessage(data.reason) : "");
        const nextProfile = normalizeProductSetProductProfile(data.product_profile, nextProductInfo);
        setProductProfile(nextProfile);
        setAnalysisDetail(nextAnalysisSource === "ai" && data.analysis && typeof data.analysis === "object" ? data.analysis as ProductSetAnalysisDetail : null);
        let analyzedPlanCount = 0;
        if (nextAnalysisSource === "ai" && data.settings_patch && typeof data.settings_patch === "object") {
          const patch = data.settings_patch as Partial<ProductSetSettings>;
          analyzedPlanCount = getProductSetVisualDirectorPlanCount(patch.visualDirectorPlan, imageType);
          setSettings((prev) => ({
            ...prev,
            ...patch,
            extraDescription: patch.extraDescription
              ? [prev.extraDescription, patch.extraDescription].filter(Boolean).join("\n").slice(0, 600)
              : prev.extraDescription,
            visualDirectorScript: patch.visualDirectorScript || "",
            visualDirectorPlan: patch.visualDirectorPlan,
          }));
        }
        if (mode === "smart" && selectedPlanId === "smart" && analyzedPlanCount > 0 && analyzedPlanCount !== genCount) {
          setAnalysisMessage(`已按你选择的 ${genCount}${imageType === "main" ? "张" : "屏"} 生成方案；接口返回 ${analyzedPlanCount} 个模块，前端会自动补齐或截断。`);
        }
        setShowProductInfoEditor(false);
        setShowAnalysisDetails(false);
        setShowFullPlan(false);
        setShowGenerationSettings(false);
        if (!options.silent) {
          if (nextAnalysisSource === "ai") toast.success(productInfo.trim() ? "商品信息已分析" : "已帮你写好商品信息");
          else toast.warning("视觉分析未完成，已先根据图片整理基础信息");
        }
      } else {
        setAnalysisSource("fallback");
        setAnalysisDetail(null);
        setAnalysisMessage("分析接口没有返回商品信息，请重新分析或手动填写。");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "分析失败";
      setAnalysisSource("failed");
      setAnalysisDetail(null);
      setAnalysisMessage(message);
      if (!options.silent) toast.error(message);
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function uploadCustomReference(kind: "style" | "model" | "other", file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("请上传图片文件");
    if (file.size > MAX_FILE_SIZE) return toast.error(`图片不能超过 ${MAX_FILE_SIZE_MB}MB`);
    setMode("custom");
    setPlanSourceTab("upload");
    setSelectedPlanId("custom");
    setIsUploadingCustomRef(true);
    try {
      const result = await uploadImage(file);
      setCustomDraft((prev) => {
        const defaults = {
          name: prev.name && prev.name !== DEFAULT_DRAFT.name ? prev.name : (imageType === "details" ? "参考图详情方案" : "参考图主图方案"),
          typeDescription: prev.typeDescription || "参考上传图片的构图、光影、版式和视觉风格，结合商品信息生成整组商品图。",
          moduleRole: prev.moduleRole || (imageType === "details" ? "详情页参考风格" : "主图参考风格"),
        };
        if (kind === "model") return { ...prev, ...defaults, modelReferenceImageUrls: [result.url], modelConsistency: true };
        if (kind === "other") return { ...prev, ...defaults, otherReferenceImageUrls: [...prev.otherReferenceImageUrls, result.url].slice(0, 3) };
        return { ...prev, ...defaults, referenceImageUrls: [result.url] };
      });
      toast.success("自定义参考图已上传");
      resetOutput();
    } catch {
      toast.error("参考图上传失败");
    } finally {
      setIsUploadingCustomRef(false);
      if (customRefInputRef.current) customRefInputRef.current.value = "";
      if (customModelRefInputRef.current) customModelRefInputRef.current.value = "";
      if (customOtherRefInputRef.current) customOtherRefInputRef.current.value = "";
    }
  }

  function addCustomTemplate() {
    const hasReferenceImage = [
      ...customDraft.referenceImageUrls,
      ...customDraft.modelReferenceImageUrls,
      ...customDraft.otherReferenceImageUrls,
    ].some(Boolean);
    if (!customDraft.typeDescription.trim() && !hasReferenceImage) return toast.error("请上传参考图或填写类型描述");
    if (genCount <= 0) return toast.error(`请先选择${imageType === "main" ? "生成张数" : "详情页屏数"}`);
    const fallbackDescription = `参考图模式：按上传参考图的构图、光影、版式和视觉风格，结合商品信息生成 ${genCount || 1} ${imageType === "main" ? "张主图/辅图" : "屏详情页"}。`;
    const fallbackName = imageType === "main" ? "参考图主图方案" : "参考图详情方案";
    const item: ProductSetCustomTemplate = {
      id: `custom-${Date.now()}`,
      name: (customDraft.name.trim() || fallbackName).slice(0, 20),
      imageType,
      typeDescription: (customDraft.typeDescription.trim() || fallbackDescription).slice(0, 600),
      aspectRatio: customDraft.aspectRatio,
      referenceImageUrls: customDraft.referenceImageUrls,
      modelReferenceImageUrls: customDraft.modelReferenceImageUrls,
      otherReferenceImageUrls: customDraft.otherReferenceImageUrls,
      extraDescription: customDraft.extraDescription.trim().slice(0, 600),
      subjectConsistency: customDraft.subjectConsistency,
      modelConsistency: customDraft.modelConsistency,
      intelligentCopy: customDraft.intelligentCopy,
      copyDensity: customDraft.copyDensity,
      moduleRole: (customDraft.moduleRole.trim() || (imageType === "details" ? "参考图详情页风格" : "参考图主图风格")).slice(0, 120),
      contentScope: customDraft.contentScope.trim().slice(0, 240),
      layoutRules: customDraft.layoutRules.trim().slice(0, 320),
      textRules: customDraft.textRules.trim().slice(0, 260),
      avoidRules: customDraft.avoidRules.trim().slice(0, 320),
    };
    setMode("custom");
    setPlanSourceTab("upload");
    setSelectedPlanId("custom");
    setCustomTemplates((prev) => [...prev, item].slice(-10));
    setModuleOverrides([]);
    setCustomDraft(DEFAULT_DRAFT);
    setShowCustomBuilder(false);
    resetOutput();
    toast.success("已添加参考图模式，会按当前数量生成");
  }

  function toggleTemplate(id: number) {
    setMode("custom");
    setPlanSourceTab("preset");
    setSelectedPlanId("custom");
    setSelectedTemplateIds((prev) => replaceSelectedTemplateIdsForImageType(
      prev,
      imageType,
      activeSelectedTemplateIds.includes(id)
        ? activeSelectedTemplateIds.filter((item) => item !== id)
        : [...activeSelectedTemplateIds, id].slice(0, 10)
    ));
    setModuleOverrides([]);
    resetOutput();
  }

  function upsertModuleOverride(index: number, patch: Partial<ProductSetModuleOverride>) {
    const template = planTemplates[index];
    if (!template) return;
    const key = getProductSetModuleKey(template, index);
    setModuleOverrides((prev) => {
      const existing = prev.find((item) => item.key === key);
      const next = { ...(existing || { key }), ...patch, key };
      return [...prev.filter((item) => item.key !== key), next].slice(-10);
    });
    resetOutput();
  }

  function removePlanModule(index: number) {
    upsertModuleOverride(index, { disabled: true });
    toast.success("已从本次生成计划移除该模块");
  }

  async function saveCurrentPlanAsFavorite() {
    if (!isAuthenticated && !(await refreshAuth())) return toast.error("请先登录后再收藏方案");
    if (!planTemplates.length) return toast.error("当前还没有可收藏的生成方案");
    const now = new Date().toISOString();
    const name = (favoritePlanName.trim() || favoritePlanDefaultName).slice(0, 40);
    const existing = favoritePlans.find((plan) => plan.name === name);
    const nextPlan = buildSavedProductSetPlan({
      existingPlan: existing,
      name,
      now,
      mode,
      imageType,
      genCount,
      settings,
      selectedTemplateIds: activeSelectedTemplateIds,
      customTemplates: activeCustomTemplates,
      moduleOverrides,
      aiModel,
      aspectRatio,
      imageSize,
      qualityMode,
      planTemplates,
      productProfile: effectiveProductProfile,
    });
    setIsSavingFavoritePlan(true);
    try {
      const res = await fetch("/api/product-set/favorite-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextPlan),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        await refreshAuth();
        router.push("/login");
        return;
      }
      if (!res.ok) throw new Error(data.error || "收藏方案保存失败");
      const savedPlan = normalizeFavoriteProductSetPlan(data.plan, DEFAULT_SETTINGS);
      if (!savedPlan) throw new Error("收藏方案保存结果无效");
      setFavoritePlans((prev) => [savedPlan, ...prev.filter((plan) => plan.id !== savedPlan.id && plan.name !== savedPlan.name)]
        .slice(0, FAVORITE_PRODUCT_SET_PLAN_LIMIT));
      setFavoritePlanName("");
      toast.success(existing ? "已更新收藏方案" : "已收藏当前方案，下次可直接套用");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "收藏方案保存失败");
    } finally {
      setIsSavingFavoritePlan(false);
    }
  }

  function applyFavoritePlan(plan: SavedProductSetPlan) {
    const nextState = buildFavoritePlanApplyState(plan, {
      defaultSettings: DEFAULT_SETTINGS,
      defaultGenCount: getDefaultGenerationCount(plan.imageType, effectiveProductProfile),
    });
    setMode(nextState.mode);
    setPlanSourceTab(nextState.planSourceTab);
    setImageType(nextState.imageType);
    setSelectedPlanId(nextState.selectedPlanId);
    setSelectedTemplateIds(nextState.selectedTemplateIds);
    setCustomTemplates(nextState.customTemplates);
    setModuleOverrides(nextState.moduleOverrides);
    setSettings(nextState.settings);
    setAiModel(nextState.aiModel);
    setAspectRatio(nextState.aspectRatio);
    setImageSize(nextState.imageSize);
    setQualityMode(nextState.qualityMode);
    setGenCount(nextState.genCount);
    resetOutput();
    toast.success(`已套用收藏方案「${plan.name}」`);
  }

  async function removeFavoritePlan(id: string) {
    if (!isAuthenticated && !(await refreshAuth())) return toast.error("请先登录");
    const previousPlans = favoritePlans;
    setFavoritePlans((prev) => prev.filter((plan) => plan.id !== id));
    try {
      const res = await fetch(`/api/product-set/favorite-plans/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        await refreshAuth();
        router.push("/login");
        return;
      }
      if (!res.ok) throw new Error(data.error || "删除收藏方案失败");
      toast.success("已删除收藏方案");
    } catch (err: unknown) {
      setFavoritePlans(previousPlans);
      toast.error(err instanceof Error ? err.message : "删除收藏方案失败");
    }
  }

  function confirmRemoveFavoritePlan(id: string) {
    Modal.confirm({
      title: "删除收藏方案",
      content: "确定要删除这个收藏方案吗？",
      okText: "确定",
      cancelText: "取消",
      onOk: () => {
        void removeFavoritePlan(id);
      },
    });
  }

  function saveProductProfile(profile: ProductSetProductProfile) {
    setProductProfile(normalizeProductSetProductProfile(profile, productInfo));
    resetOutput();
  }

  function createClientModuleResults(plan: ProductSetResolvedTemplate[]): ProductSetModuleResult[] {
    return plan.map((template, index) => ({
      moduleKey: getProductSetModuleKey(template, index),
      index: index + 1,
      templateId: String(template.id),
      templateSource: template.source,
      name: template.name,
      imageType: template.imageType,
      aspectRatio: template.aspectRatio,
      moduleRole: template.moduleRole,
      contentScope: template.contentScope,
      status: "queued",
      progress: 0,
      updatedAt: new Date().toISOString(),
      promptVersion: PRODUCT_SET_PROMPT_VERSION,
      promptVariant: settings.stylePackId || "auto",
    }));
  }

  function readModuleResults(value: unknown): ProductSetModuleResult[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is ProductSetModuleResult => Boolean(item && typeof item === "object" && typeof (item as ProductSetModuleResult).moduleKey === "string"))
      .sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  }

  function getModuleResultUrl(module?: ProductSetModuleResult) {
    const url = module?.resultUrl;
    return typeof url === "string" && url.length > 0 ? url : "";
  }

  function findModuleResultForTemplate(
    modules: ProductSetModuleResult[],
    template: ProductSetResolvedTemplate | undefined,
    index: number
  ) {
    if (!modules.length) return undefined;
    if (template) {
      const key = getProductSetModuleKey(template, index);
      const byKey = modules.find((item) => item.moduleKey === key);
      if (byKey) return byKey;
    }
    return modules.find((item) => Number(item.index) === index + 1) || modules[index];
  }

  function urlsFromModules(modules: ProductSetModuleResult[], plan: ProductSetResolvedTemplate[]) {
    const urls = plan
      .map((template, index) => getModuleResultUrl(findModuleResultForTemplate(modules, template, index)))
      .filter(Boolean);

    modules.forEach((module) => {
      const url = getModuleResultUrl(module);
      if (url && !urls.includes(url)) urls.push(url);
    });

    return urls;
  }

  function mergeModuleResults(prev: ProductSetModuleResult[], incoming: ProductSetModuleResult[]) {
    const byKey = new Map(prev.map((item) => [item.moduleKey, item]));
    incoming.forEach((item) => byKey.set(item.moduleKey, { ...(byKey.get(item.moduleKey) || {}), ...item }));
    return Array.from(byKey.values()).sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  }

  function applyPresetPlan(planId: string) {
    const plan = PRODUCT_SET_PRESET_PLANS.find((item) => item.id === planId);
    if (!plan) return;
    setSelectedPlanId(plan.id);
    setModuleOverrides([]);
    if (plan.id === "smart") {
      setMode("smart");
      setPlanSourceTab("smart");
      resetOutput();
      return;
    }

    setMode("smart");
    setPlanSourceTab("preset");
    setImageType(plan.imageType);
    setAspectRatio("auto");
    if (plan.id === "amazon-listing") {
      setSettings((prev) => ({ ...prev, country: "美国", language: "英语", platform: "亚马逊" }));
    } else if (plan.scenario === "womenswear") {
      setSettings((prev) => ({ ...prev, platform: plan.imageType === "main" ? "小红书" : prev.platform }));
    }
    setReferenceStyleDraft(referenceStyleBrief || buildReferenceStyleBrief(plan));
    setShowReferenceStyleModal(true);
    resetAnalysisPlan(productInfo.trim() ? "manual" : "idle", "已选择参考风格，请点击“帮我写商品信息”开始分析。");
  }

  function changeImageType(value: ProductSetImageType) {
    const nextAspect: AspectRatio = "auto";
    const nextSizes = getSupportedImageSizes(aiModel, nextAspect);
    const nextSelectedTemplateIds = getSelectedTemplateIdsForImageType(selectedTemplateIds, value);
    setImageType(value);
    setAspectRatio(nextAspect);
    if (value === "details" && nextSizes.includes("2K")) {
      setImageSize("2K");
    } else if (!nextSizes.includes(imageSize)) {
      setImageSize(nextSizes[0] || "1K");
    }
    if (mode === "smart") setGenCount(0);
    setSelectedPlanId(getSelectedPlanIdForProductSetState({
      mode,
      imageType: value,
      selectedTemplateIds: nextSelectedTemplateIds,
    }));
    resetAnalysisPlan(productInfo.trim() ? "manual" : "idle", "已切换生成类型，请重新选择数量并分析。");
  }

  function changePlanSourceTab(value: ProductSetPlanSourceTab) {
    setPlanSourceTab(value);
    if (value === "smart") {
      setMode("smart");
      setSelectedPlanId("smart");
      resetOutput();
      return;
    }
    setMode(value === "preset" ? "smart" : "custom");
    if (value === "upload") setSelectedPlanId("custom");
    resetOutput();
  }

  function changePlanMode(value: "smart" | "reference") {
    if (value === "smart") {
      changePlanSourceTab("smart");
      return;
    }
    changePlanSourceTab(planSourceTab === "smart" ? "preset" : planSourceTab);
  }

  function saveReferenceStyleBrief() {
    const nextBrief = referenceStyleDraft.trim().slice(0, 2000);
    if (!nextBrief) return toast.error("请填写参考风格说明");
    setReferenceStyleBrief(nextBrief);
    setShowReferenceStyleModal(false);
    setPlanSourceTab("preset");
    setMode("smart");
    resetAnalysisPlan(productInfo.trim() ? "manual" : "idle", "参考风格已保存，请点击“帮我写商品信息”开始分析。");
    resetOutput();
    toast.success("已保存参考风格，点击下方分析时会一起传入");
  }

  function updateSetting<K extends keyof ProductSetSettings>(key: K, value: ProductSetSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    resetOutput();
  }

  function getSelectedTemplateIdsForImageType(sourceIds: number[], nextImageType: ProductSetImageType) {
    const templateIds = new Set(getProductSetTemplates(nextImageType).map((template) => template.id));
    return sourceIds.filter((id) => templateIds.has(id));
  }

  function replaceSelectedTemplateIdsForImageType(sourceIds: number[], nextImageType: ProductSetImageType, nextIds: number[]) {
    const templateIds = new Set(getProductSetTemplates(nextImageType).map((template) => template.id));
    return [
      ...sourceIds.filter((id) => !templateIds.has(id)),
      ...nextIds,
    ];
  }

  async function generate() {
    if (!isAuthenticated && !(await refreshAuth())) {
      toast.error("请先登录");
      router.push("/login");
      return;
    }
    if (!productImages.length) return toast.error("请先上传商品图");
    if (requiresProductConfirmation) return toast.warning("请先完成智能分析，或手动确认商品信息后再生成");
    if (outputCount <= 0) return toast.error("请至少选择 1 个套图样式");
    if (credits !== null && credits < cost) {
      showInsufficientCreditsToast({ required: cost, balance: credits, onRecharge: () => router.push("/pricing") });
      return;
    }

    const currentPlan = planTemplates;
    const expectedResultCount = Math.max(1, currentPlan.length);
    setActiveQueueTask(null);
    setIsGenerating(true);
    setProgress(8);
    setError("");
    setResultUrls([]);
    setResultPlan(currentPlan);
    setModuleResults(createClientModuleResults(currentPlan));
    const provisionalTask = taskQueue.startTask({
      expectedCount: expectedResultCount,
      inputThumbnails: taskInputThumbnails,
      progress: 8,
    });
    setActiveQueueTask(provisionalTask);
    let activeTaskId = provisionalTask.id;
    let latestUrls: string[] = [];
    try {
      const finalSettings = {
        ...settings,
        extraDescription: [settings.extraDescription, qualityMode === "advanced" ? "生成档位：高级模式，优先提升细节、质感和版式完成度。" : ""]
          .filter(Boolean)
          .join("\n"),
      };
      const res = await fetch("/api/product-set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_image_urls: productImages.map((item) => item.url),
          product_info: productInfo,
          product_profile: effectiveProductProfile,
          settings: finalSettings,
          mode,
          image_type: imageType,
          selected_template_ids: mode === "custom" ? activeSelectedTemplateIds : [],
          custom_templates: mode === "custom" ? activeCustomTemplates : [],
          module_overrides: moduleOverrides,
          ai_model: aiModel,
          aspect_ratio: aspectRatio,
          image_size: imageSize,
          gen_count: mode === "smart" ? genCount : currentPlan.length,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          await refreshAuth();
          taskQueue.removeTask(activeTaskId);
          setActiveQueueTask(null);
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
      const initialModules = readModuleResults(data.module_results);
      if (initialModules.length) setModuleResults(initialModules);
      if (typeof data.generation_id === "string" && data.generation_id) {
        const initialUrls = urlsFromModules(initialModules, currentPlan);
        latestUrls = initialUrls;
        const serverTask = taskQueue.replaceWithServerTask(activeTaskId, {
          id: data.generation_id,
          expectedCount: expectedResultCount,
          inputThumbnails: taskInputThumbnails,
          resultThumbnails: initialUrls,
          resultCount: initialUrls.length,
          status: data.status || "processing_tryon",
          progress: 12,
        });
        setActiveQueueTask(serverTask);
        activeTaskId = serverTask.id;
      }

      for (let attempts = 0; attempts < 900; attempts++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const poll = await fetch(`/api/product-set?generation_id=${encodeURIComponent(data.generation_id)}`);
        if (!poll.ok) continue;
        const state = await poll.json();
        const nextUrls = Array.isArray(state.result_urls)
          ? state.result_urls.filter((url: unknown): url is string => typeof url === "string" && url.length > 0)
          : [];
        const nextModules = readModuleResults(state.module_results);
        const hasAllResults = nextModules.length
          ? nextModules.every((item) => item.status === "completed" || item.status === "failed")
          : nextUrls.length >= expectedResultCount;
        const nextProgress = Number(state.progress);
        if (Number.isFinite(nextProgress)) {
          const rounded = Math.min(Math.max(Math.round(nextProgress), 0), 100);
          const runningProgress = !hasAllResults && rounded >= 100 ? 99 : rounded;
          setProgress(runningProgress);
          const runningTask = taskQueue.markRunning(activeTaskId, {
            expectedCount: expectedResultCount,
            inputThumbnails: taskInputThumbnails,
            resultThumbnails: latestUrls,
            resultCount: latestUrls.length,
            progress: runningProgress,
            status: state.status,
          });
          setActiveQueueTask(runningTask);
        }
        if (nextModules.length) {
          setModuleResults(nextModules);
          const moduleUrls = urlsFromModules(nextModules, currentPlan);
          if (moduleUrls.length) {
            latestUrls = moduleUrls;
            setResultUrls(moduleUrls);
          } else if (nextUrls.length) {
            latestUrls = nextUrls;
            setResultUrls(nextUrls);
          }
        } else if (nextUrls.length) {
          latestUrls = nextUrls;
          setResultUrls(nextUrls);
        }
        if (state.status === "completed") {
          if (!hasAllResults) continue;
          setProgress(100);
          const partialFailure = state.partial_failure && typeof state.partial_failure === "object"
            ? state.partial_failure as { message?: unknown }
            : null;
          const failedModuleCount = nextModules.filter((item) => item.status === "failed").length;
          const completedErrorSource = nextModules.find((item) => item.error)?.error || state.error || partialFailure?.message || "";
          const completedError = completedErrorSource ? summarizeGenerationError(completedErrorSource) : "";
          if (nextModules.length) {
            setModuleResults(nextModules);
            const moduleUrls = urlsFromModules(nextModules, currentPlan);
            const finalUrls = moduleUrls.length ? moduleUrls : nextUrls;
            const finalResultCount = finalUrls.filter(Boolean).length;
            latestUrls = finalUrls;
            setResultUrls(finalUrls);
            const completedTask = taskQueue.markCompleted(activeTaskId, {
              expectedCount: expectedResultCount,
              inputThumbnails: taskInputThumbnails,
              resultThumbnails: finalUrls,
              resultCount: finalResultCount,
              error: completedError,
            });
            setActiveQueueTask(completedTask);
            if (failedModuleCount > 0 || finalResultCount < expectedResultCount || completedError) {
              await refreshCredits();
              toast.warning(buildPartialFailureDetail({
                message: completedError || completedErrorSource,
                failedCount: failedModuleCount || expectedResultCount - finalResultCount || 1,
              }));
            } else {
              toast.success("商品套图生成完成");
            }
          } else {
            latestUrls = nextUrls;
            setResultUrls(nextUrls);
            const finalResultCount = nextUrls.filter(Boolean).length;
            const completedTask = taskQueue.markCompleted(activeTaskId, {
              expectedCount: expectedResultCount,
              inputThumbnails: taskInputThumbnails,
              resultThumbnails: nextUrls,
              resultCount: finalResultCount,
              error: completedError,
            });
            setActiveQueueTask(completedTask);
            if (finalResultCount < expectedResultCount || completedError) {
              await refreshCredits();
              toast.warning(buildPartialFailureDetail({
                message: completedError || completedErrorSource,
                failedCount: expectedResultCount - finalResultCount || 1,
              }));
            } else {
              toast.success("商品套图生成完成");
            }
          }
          setIsGenerating(false);
          return;
        }
        if (state.status === "failed") throw new Error(state.error || "生成失败");
      }
      if (latestUrls.length > 0) {
        setIsGenerating(false);
        const backgroundTask = taskQueue.markRunning(activeTaskId, {
          expectedCount: expectedResultCount,
          inputThumbnails: taskInputThumbnails,
          resultThumbnails: latestUrls,
          resultCount: latestUrls.length,
          progress: 99,
        });
        setActiveQueueTask(backgroundTask);
        toast.info("生成仍在后台继续，可稍后在历史记录查看完整结果");
        return;
      }
      throw new Error("生成超时");
    } catch (err: unknown) {
      const message = summarizeGenerationError(err instanceof Error ? err.message : "生成失败");
      setError(message);
      const failedTask = taskQueue.markFailed(activeTaskId, message, {
        expectedCount: expectedResultCount,
        inputThumbnails: taskInputThumbnails,
        resultThumbnails: latestUrls,
      });
      setActiveQueueTask(failedTask);
      await refreshCredits();
      toast.error(message);
      setIsGenerating(false);
    }
  }

  async function regenerateResult(index: number) {
    if (isGenerating || regeneratingIndex !== null) return toast.info("请等当前生成完成后再重生单张图片");
    const currentPlan = resultPlan.length ? resultPlan : planTemplates;
    const template = currentPlan[index];
    if (!template) return toast.error("未找到要重生的模块");
    if (!isAuthenticated && !(await refreshAuth())) {
      toast.error("请先登录");
      router.push("/login");
      return;
    }
    const singleCost = getCreditCost(aiModel, imageSize, template.aspectRatio || aspectRatio);
    if (credits !== null && credits < singleCost) {
      showInsufficientCreditsToast({ required: singleCost, balance: credits, onRecharge: () => router.push("/pricing") });
      return;
    }

    setRegeneratingIndex(index);
    setError("");
    try {
      const finalSettings = {
        ...settings,
        extraDescription: [settings.extraDescription, qualityMode === "advanced" ? "生成档位：高级模式，优先提升细节、质感和版式完成度。" : ""]
          .filter(Boolean)
          .join("\n"),
      };
      const res = await fetch("/api/product-set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_image_urls: productImages.map((item) => item.url),
          product_info: productInfo,
          product_profile: effectiveProductProfile,
          settings: finalSettings,
          mode,
          image_type: imageType,
          selected_template_ids: mode === "custom" ? activeSelectedTemplateIds : [],
          custom_templates: mode === "custom" ? activeCustomTemplates : [],
          module_overrides: moduleOverrides,
          regenerate_index: index,
          ai_model: aiModel,
          aspect_ratio: aspectRatio,
          image_size: imageSize,
          gen_count: mode === "smart" ? Math.max(genCount, currentPlan.length) : currentPlan.length,
        }),
      });
      const data = await res.json();
      if (res.status === 401) {
        await refreshAuth();
        router.push("/login");
        return;
      }
      if (!res.ok) throw new Error(data.error || "单张重生失败");
      if (data.credits_remaining !== undefined) {
        setCredits(data.credits_remaining);
        if (userId) setCachedProfileCredits(userId, data.credits_remaining);
      }

      for (let attempts = 0; attempts < 240; attempts++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const poll = await fetch(`/api/product-set?generation_id=${encodeURIComponent(data.generation_id)}`);
        if (!poll.ok) continue;
        const state = await poll.json();
        const nextUrl = Array.isArray(state.result_urls)
          ? state.result_urls.find((url: unknown): url is string => typeof url === "string" && url.length > 0)
          : "";
        const nextModules = readModuleResults(state.module_results);
        if (nextModules.length) {
          setModuleResults((prev) => mergeModuleResults(prev.length ? prev : createClientModuleResults(currentPlan), nextModules));
        }
        const moduleUrl = nextModules.find((item) => item.resultUrl)?.resultUrl;
        const failedModule = nextModules.find((item) => item.status === "failed");
        if (state.status === "completed" && failedModule && !moduleUrl && !nextUrl) {
          throw new Error(failedModule.error || "单张重生失败");
        }
        if (moduleUrl || nextUrl) {
          const finalUrl = (moduleUrl || nextUrl) as string;
          setResultPlan((prev) => prev.length ? prev : currentPlan);
          setResultUrls((prev) => {
            const next = [...prev];
            next[index] = finalUrl;
            return next;
          });
          if (state.status === "completed") {
            toast.success(`第 ${index + 1} 张已重生`);
            return;
          }
        }
        if (state.status === "failed") throw new Error(state.error || "单张重生失败");
      }
      toast.info("单张仍在后台生成，可稍后在历史记录查看");
    } catch (err: unknown) {
      const message = summarizeGenerationError(err instanceof Error ? err.message : "单张重生失败");
      await refreshCredits();
      toast.error(message);
    } finally {
      setRegeneratingIndex(null);
    }
  }

  function downloadResult(url: string, index: number) {
    const ext = url.toLowerCase().includes(".jpg") || url.toLowerCase().includes(".jpeg") ? "jpg" : "png";
    downloadImage(url, generateDownloadFilename("product-set", index, ext));
  }

  function handleRunningTask(item: TaskQueueItem) {
    setActiveQueueTask(item);
    const urls = safeTaskQueueUrls(item.resultThumbnails);
    const nextProgress = Number.isFinite(Number(item.progress)) ? Number(item.progress) : 8;
    setIsGenerating(true);
    setRegeneratingIndex(null);
    setProgress(Math.min(Math.max(Math.round(nextProgress), 1), 99));
    setResultUrls(urls);
    setModuleResults([]);
    setResultPlan([]);
    setError("");
  }

  async function handleCompletedTask(item: TaskQueueItem, session: TaskSelectionSession) {
    try {
      const detail = await fetchHistoryApplyDetail(item.id, "productSet", session.signal);
      if (!session.isCurrent()) return true;
      applyProductSetHistoryPayload(detail.payload, detail.resultUrls.length ? detail.resultUrls : safeTaskQueueUrls(item.resultThumbnails), {
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

  const displayedResultPlan = resultPlan.length ? resultPlan : planTemplates;
  const moduleResultUrls = urlsFromModules(moduleResults, displayedResultPlan);
  const taskExpectedResultCount = activeQueueTask
    ? clampTaskExpectedCount(activeQueueTask, 1, imageType === "details" ? 8 : 6, displayedResultPlan.length || outputCount || 1)
    : 0;
  const resultSlotCount = Math.max(displayedResultPlan.length, resultUrls.length, moduleResults.length, taskExpectedResultCount);
  const hasVisibleResults = resultUrls.length > 0 || moduleResultUrls.length > 0;
  const hasResultStage = hasVisibleResults || (!isGenerating && moduleResults.length > 0) || (activeQueueTask?.statusGroup === "completed" && resultSlotCount > 0);
  const shouldShowTaskPanel = Boolean(activeQueueTask) && activeQueueTask?.statusGroup !== "completed" && !hasVisibleResults && moduleResults.length === 0;
  const resultSlots = Array.from({ length: resultSlotCount }, (_, index) => {
    const template = displayedResultPlan[index];
    const moduleResult = findModuleResultForTemplate(moduleResults, template, index);
    return {
      module: moduleResult,
      url: getModuleResultUrl(moduleResult) || resultUrls[index],
      template,
    };
  });
  const visibleResultCount = resultSlots.filter((item) => item.url).length;
  const hasCompletedPartialResults = Boolean(activeQueueTask?.statusGroup === "completed" && visibleResultCount < resultSlotCount);
  const partialFailureMessage = buildPartialFailureDetail({
    message: activeQueueTask?.error || error || undefined,
    failedCount: resultSlotCount - visibleResultCount || 1,
  });
  const productSetPreviewPromptText = [
    settings.extraDescription,
    ...moduleOverrides.map((item) => item.extraDescription),
  ].map((item) => item?.trim() || "").filter(Boolean).join("\n\n");
  const productSetPreviewSession = useMemo(
    () => createProductSetPreviewSession({
      module: "productSet",
      urls: resultSlots.map((slot) => slot.url || ""),
      expectedCount: Math.max(resultSlotCount, 1),
      isGenerating,
      statusGroup: activeQueueTask?.statusGroup || (isGenerating ? "running" : undefined),
      taskId: activeQueueTask?.id,
      createdAt: activeQueueTask?.createdAt,
      references: (safeTaskQueueUrls(activeQueueTask?.inputThumbnails).length ? safeTaskQueueUrls(activeQueueTask?.inputThumbnails) : productImages.map((item) => item.url)).map((url, index) => ({
        url,
        label: productImages[index]?.name || `商品图 ${index + 1}`,
        role: "product" as const,
      })),
      promptText: productSetPreviewPromptText,
      metaItems: [
        { label: "生成模式", value: mode === "smart" ? "智能套图" : "自定义套图" },
        { label: "图片类型", value: imageType === "main" ? "主图辅图" : "详情页" },
        { label: "平台", value: settings.platform },
        { label: "语言", value: settings.language },
        { label: "风格", value: selectedStylePack.name },
        { label: "质检", value: qualityMode === "advanced" ? "高级模式" : "标准模式" },
        { label: "生成数量", value: resultSlotCount },
      ],
      titles: resultSlots.map((slot, index) => slot.template?.name || slot.module?.name || `商品套图 ${index + 1}`),
      subtitles: resultSlots.map((slot) => `${slot.template?.imageType === "details" ? "详情页模块" : "主图/辅图"} · ${getAspectRatioLabel(slot.template?.aspectRatio || slot.module?.aspectRatio || aspectRatio)}`),
      statuses: resultSlots.map((slot) => (slot.url ? "completed" : slot.module?.status || (hasCompletedPartialResults ? "failed" : isGenerating ? "running" : "queued")) as ImagePreviewResultStatus),
      errors: resultSlots.map((slot) => slot.module?.error || (!slot.url && hasCompletedPartialResults ? partialFailureMessage : null)),
      qualities: resultSlots.map((slot) => {
        if (slot.module?.qualityScore === undefined && !slot.module?.qualitySummary && !slot.module?.qualityIssues?.length) return null;
        return {
          score: slot.module.qualityScore,
          label: getProductSetModuleQualityLabel(slot.module.qualityScore).label,
          summary: slot.module.qualitySummary,
          issues: slot.module.qualityIssues || [],
        };
      }),
    }),
    [activeQueueTask, aspectRatio, hasCompletedPartialResults, imageType, isGenerating, mode, partialFailureMessage, productImages, productSetPreviewPromptText, qualityMode, resultSlotCount, resultSlots, selectedStylePack.name, settings.language, settings.platform]
  );

  return (
    <div className="studio-workbench studio-product-set-workbench min-h-[calc(100dvh-64px)] lg:h-[calc(100vh-64px)] flex flex-col lg:flex-row">
      <FeatureTabs active="productSet" />
      <ModuleTaskRail
        module="productSet"
        moduleLabel="商品套图"
        onContinue={confirmContinueCreate}
        onRunningTask={handleRunningTask}
        onCompletedTask={handleCompletedTask}
      />
      <aside className="studio-parameters w-full lg:w-[472px] border-b lg:border-b-0 lg:border-r flex flex-col overflow-visible lg:overflow-hidden">
        <div className="studio-parameters-scroll flex-1 overflow-visible lg:overflow-y-auto p-3 sm:p-5 space-y-4">
          <ModuleHeader title="商品视觉生成器" tooltip="上传 1-3 张商品多视角图，补充商品信息和数量后再分析生成主图或详情页方案。" />
          <ProductModeTabs imageType={imageType} onChange={changeImageType} />
          <WorkflowStepper currentStep={workflowStep} />

          <section
            {...productImageDrag.dragHandlers}
            className={`studio-stable-upload-boundary rounded-3xl border bg-white p-4 shadow-sm transition ${isDragging ? "border-zinc-200 ring-4 ring-zinc-200" : "border-slate-100"}`}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-black text-slate-950">商品图</h3>
                <p className="mt-1 text-xs text-slate-400">支持正面、侧面、背面或细节图，最多 3 张。</p>
              </div>
              <span className="inline-flex h-7 shrink-0 items-center rounded-full bg-[rgba(5,5,5,0.04)] px-2.5 text-[10px] font-bold text-[var(--codex-accent)]">{productImages.length}/3</span>
            </div>
            <input
              ref={productInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event: ChangeEvent<HTMLInputElement>) => event.target.files && processFiles(event.target.files)}
            />
            <StudioUploadTile
              title={productImages.length >= 3 ? "已达 3 张上限" : productImages.length ? "继续上传多视角商品图" : "上传 / 拖拽【商品图】"}
              description="支持正面、侧面、背面或细节图，最多 3 张。"
              imageUrl={null}
              imageAlt="商品图"
              isDragging={isDragging}
              loading={isUploading}
              onUploadClick={() => productInputRef.current?.click()}
              onLibraryClick={() => toast.info("资源库导入即将接入")}
              uploadLabel={productImages.length ? "继续上传" : "本地上传"}
              libraryLabel="从资源库导入"
              supportBadge="支持多图(最多3张)"
              footnote="款式图上传无遮挡、无码图；正面、侧面、背面或细节图越完整，套图方案越准。"
              examples={{
                label: "试一试",
                images: PRODUCT_SET_EXAMPLE_GROUPS.map((group) => ({
                  url: group.images[0],
                  title: group.name,
                  previewUrls: group.images,
                })),
                disabled: isUploading,
                onSelect: (image) => {
                  const group = PRODUCT_SET_EXAMPLE_GROUPS.find((item) => item.name === image.title && item.images[0] === image.url);
                  if (group) applyExampleGroup(group);
                },
              }}
            />

            {productImages.length > 0 && (
              <>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {productImages.map((item, index) => (
                  <div key={`${item.url}-${index}`} className="studio-checkerboard group relative aspect-square overflow-hidden rounded-xl border border-white bg-white shadow-sm">
                    <RawPreviewImage src={getImageVariantUrl(item.url, "thumb")} alt={item.name} className="h-full w-full object-contain p-1.5" />
                    <span className="absolute left-1 top-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">图{index + 1}</span>
                    <button type="button" aria-label="移除商品图" onClick={() => removeProductImage(index)} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-800/80 text-white opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
                <div className="mt-2 flex justify-end">
                  <button type="button" onClick={() => { setProductImages([]); setProductInfo(""); resetAnalysisPlan("idle"); }} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-bold text-slate-400 hover:bg-red-50 hover:text-red-500">
                    <Trash2 className="h-3.5 w-3.5" /> 清空
                  </button>
                </div>
              </>
            )}
          </section>

          <section className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-black text-slate-950">商品信息分析</h3>
                <p className="mt-1 text-xs text-slate-400">先把商品信息整理成结构化规划，再生成方案。</p>
              </div>
              <button
                type="button"
                onClick={() => analyzeProductInfo()}
                disabled={!canAnalyzeProduct}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 bg-[rgba(5,5,5,0.04)] px-3 text-xs font-black text-[var(--codex-accent)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isAnalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {isAnalyzing ? "正在分析" : hasAnalyzedProduct ? "重新帮我写" : "帮我写"}
              </button>
            </div>

            <ProductAnalysisNotice status={analysisStatus} />

            {productInfo && !showProductInfoEditor ? (
              <ProductBriefSummary fields={displayProductInfoFields} onEdit={() => setShowProductInfoEditor(true)} />
            ) : (
              <div>
                <textarea
                  value={productInfo}
                  onChange={(event) => {
                    const nextValue = event.target.value.slice(0, 2000);
                    setProductInfo(nextValue);
                    resetAnalysisPlan(nextValue.trim() ? "manual" : "idle", nextValue.trim() ? "商品信息已修改，请重新分析生成对应方案。" : "");
                  }}
                  aria-label="商品信息"
                  placeholder={`可选：写一句商品名称、卖点、目标平台或风格要求。
也可以不填，上传商品图并选择数量后，点击“帮我写”，系统会自动整理成完整商品规划。`}
                  className="min-h-40 w-full resize-none rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-zinc-900 focus:bg-white"
                />
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                  <span>{productInfo ? "建议保留模板字段，生成文案会更稳定。" : "不想写也可以，点“帮我写”让系统根据商品图整理。"}</span>
                  <span>{productInfo.length} / 2000</span>
                </div>
              </div>
            )}

            <CountSelector
              imageType={imageType}
              value={genCount}
              options={countOptions}
              onChange={changeGenerationCount}
              helper={hasAnalyzedProduct ? "如需修改数量，请重新分析，让系统按新数量重排方案。" : "先选择数量，系统会按这个数量输出对应规划。"}
            />

            <button
              type="button"
              onClick={() => analyzeProductInfo()}
              disabled={!canAnalyzeProduct}
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-black text-white shadow-lg shadow-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
              {isAnalyzing ? "正在分析商品" : hasAnalyzedProduct ? "重新帮我写商品信息" : "帮我写商品信息"}
            </button>

            {!hasAnalyzedProduct && (
              <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-500">
                分析后 系统会把上面的商品信息写入规划：目标平台、风格名称、视觉风格、统一场景、核心卖点、用户痛点、适用人群、产品参数和主题配色，并按你选择的数量生成计划。
              </div>
            )}

            {hasAnalyzedProduct && (
              <>
                <AnalysisSummaryCard
                  profile={effectiveProductProfile}
                  analysis={analysisDetail}
                  stylePack={selectedStylePack}
                  imageType={imageType}
                  outputCount={outputCount}
                  expanded={showAnalysisDetails}
                  onToggleExpanded={() => setShowAnalysisDetails((value) => !value)}
                  onEditProfile={() => setShowProfileEditor(true)}
                  onAdjust={() => setShowSettingsModal(true)}
                />
                {showAnalysisDetails && (
                  <>
                    <ProductProfileCard profile={effectiveProductProfile} analysisSource={analysisSource} onEdit={() => setShowProfileEditor(true)} />
                    <ProductVisualStrategyCard
                      profile={effectiveProductProfile}
                      analysis={analysisDetail}
                      stylePack={selectedStylePack}
                      imageType={imageType}
                      onAdjust={() => setShowSettingsModal(true)}
                    />
                  </>
                )}
              </>
            )}
          </section>

          <section className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-black text-slate-950">方案来源</h3>
                <p className="mt-1 text-xs leading-5 text-slate-400">智能模式需要分析；参考图模式可直接选预设或上传参考图。</p>
              </div>
              {outputCount > 0 && <span className="inline-flex h-8 shrink-0 items-center rounded-full bg-[rgba(5,5,5,0.04)] px-2.5 text-xs font-black text-[var(--codex-accent)]">{outputCount} {imageType === "main" ? "张" : "屏"}</span>}
            </div>

            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
              {([
                { value: "smart" as const, label: "智能模式", desc: "需要智能分析" },
                { value: "reference" as const, label: "参考图模式", desc: "上传 / 预设" },
              ]).map((tab) => {
                const active = tab.value === "smart" ? mode === "smart" : isReferenceMode;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-pressed={active}
                    onClick={() => changePlanMode(tab.value)}
                    className={`min-h-12 rounded-xl px-2 py-1.5 text-center transition ${
                      active ? "bg-white text-[var(--codex-accent)] shadow-sm" : "text-slate-500 hover:bg-white/60"
                    }`}
                  >
                    <span className="block truncate text-xs font-black">{tab.label}</span>
                    <span className="mt-0.5 block truncate text-[10px] font-bold opacity-70">{tab.desc}</span>
                  </button>
                );
              })}
            </div>

            {!isReferenceMode ? (
              <div className="mt-3 rounded-2xl border border-zinc-200 bg-[rgba(5,5,5,0.04)] p-3 text-xs leading-5 text-slate-500">
                {hasAnalyzedProduct ? (
                  <PlanRecommendationCard recommendation={planRecommendation} imageType={imageType} compact />
                ) : (
                  <p>智能模式会根据商品图、商品信息和你选择的 {genCount || "对应"} 个数量自动拆解方案。请先点击“帮我写商品信息”。</p>
                )}
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
                  {PLAN_SOURCE_TABS.filter((tab) => tab.value !== "smart").map((tab) => {
                    const active = planSourceTab === tab.value;
                    return (
                      <button
                        key={tab.value}
                        type="button"
                        role="tab"
                        aria-pressed={active}
                        onClick={() => changePlanSourceTab(tab.value)}
                        className={`min-h-11 rounded-xl px-2 py-1.5 text-center transition ${
                          active ? "bg-white text-[var(--codex-accent)] shadow-sm" : "text-slate-500 hover:bg-white/60"
                        }`}
                      >
                        <span className="block truncate text-xs font-black">{tab.value === "preset" ? "预设参考" : tab.value === "upload" ? "上传参考" : "收藏"}</span>
                        <span className="mt-0.5 block truncate text-[10px] font-bold opacity-70">{tab.description}</span>
                      </button>
                    );
                  })}
                </div>

                {planSourceTab === "preset" && (
                  <div className="grid grid-cols-2 items-stretch gap-2">
                    {visiblePresetPlans.filter((plan) => plan.id !== "smart").map((plan) => (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => applyPresetPlan(plan.id)}
                        className={`flex min-h-[92px] flex-col rounded-2xl border p-3 text-left transition ${
                          selectedPlanId === plan.id
                            ? "border-zinc-200 bg-[rgba(5,5,5,0.04)] text-[var(--codex-accent)]"
                            : "border-slate-100 bg-slate-50 text-slate-600 hover:hover:border-zinc-300"
                        }`}
                      >
                        <span className="flex min-h-5 items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-xs font-black">{plan.name}</span>
                          {plan.scenario === "womenswear" && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-600">女装</span>}
                        </span>
                        <span className="mt-1 block line-clamp-2 text-[11px] leading-4 opacity-75">{plan.description}</span>
                      </button>
                    ))}
                    {referenceStyleBrief && (
                      <div className="col-span-2 rounded-2xl border border-zinc-200 bg-[rgba(5,5,5,0.04)] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-black text-[var(--codex-accent)]">已选参考风格</p>
                            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--codex-accent)]">{referenceStyleBrief.replace(/[#*_`\[\]-]/g, " ").replace(/\s+/g, " ").trim()}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setReferenceStyleDraft(referenceStyleBrief);
                              setShowReferenceStyleModal(true);
                            }}
                            className="h-8 shrink-0 rounded-full bg-white px-3 text-[11px] font-black text-[var(--codex-accent)] shadow-sm"
                          >
                            编辑
                          </button>
                        </div>
                        <p className="mt-2 text-[11px] leading-4 text-[var(--codex-accent)]">这里只保存风格方向，不会立即拆模板。点击上面的“帮我写商品信息”时会传给智能分析。</p>
                      </div>
                    )}
                  </div>
                )}

                {planSourceTab === "upload" && (
                  <CustomTemplateSourcePanel
                    imageType={imageType}
                    genCount={genCount}
                    customDraft={customDraft}
                    activeCustomTemplates={activeCustomTemplates}
                    isUploadingCustomRef={isUploadingCustomRef}
                    customRefInputRef={customRefInputRef}
                    customModelRefInputRef={customModelRefInputRef}
                    customOtherRefInputRef={customOtherRefInputRef}
                    onCustomDraftChange={setCustomDraft}
                    onUploadCustomReference={uploadCustomReference}
                    onAddCustomTemplate={addCustomTemplate}
                    onRemoveCustomTemplate={(id) => {
                      setCustomTemplates((prev) => prev.filter((item) => item.id !== id));
                      resetOutput();
                    }}
                    onOpenLibrary={() => setShowTemplateModal(true)}
                  />
                )}

                {planSourceTab === "favorites" && (
                  <FavoritePlanPanel
                    embedded
                    plans={favoritePlans}
                    draftName={favoritePlanName}
                    defaultName={favoritePlanDefaultName}
                    currentPlanCount={outputCount}
                    showList
                    isLoading={isLoadingFavoritePlans}
                    isSaving={isSavingFavoritePlan}
                    onDraftNameChange={setFavoritePlanName}
                    onSave={saveCurrentPlanAsFavorite}
                    onApply={applyFavoritePlan}
                    onDelete={confirmRemoveFavoritePlan}
                  />
                )}

                <button type="button" onClick={() => setShowTemplateModal(true)} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-2xl border border-slate-100 bg-white text-xs font-black text-slate-600 hover:hover:border-zinc-300 hover:bg-[rgba(5,5,5,0.06)]">
                  <Layers3 className="h-3.5 w-3.5" /> 打开完整模板库
                </button>
                {outputCount > 0 ? (
                  <PlanRecommendationCard recommendation={planRecommendation} imageType={imageType} compact />
                ) : (
                  <div className="rounded-2xl border border-amber-100 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-700">
                    参考只是风格方向，不会立即拆解模板。请先选择预设风格或上传参考图，再点击“帮我写商品信息”开始分析。
                  </div>
                )}
              </div>
            )}
          </section>

          {outputCount > 0 && <section className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-black text-slate-950">生成计划</h3>
                <p className="mt-1 text-xs text-slate-400">{showFullPlan ? "完整模块可逐项编辑或移除。" : "先显示最关键的前 3 项，减少干扰。"}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowFullPlan((value) => !value)}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-[rgba(5,5,5,0.04)] px-2.5 text-xs font-black text-[var(--codex-accent)] hover:bg-[rgba(5,5,5,0.06)]"
              >
                {outputCount || 0} {imageType === "main" ? "张" : "屏"} · {showFullPlan ? "收起" : "查看全部"}
              </button>
            </div>

            <PlanList
              templates={planTemplates}
              productProfile={effectiveProductProfile}
              limit={showFullPlan ? undefined : 3}
              onEdit={setEditingModuleIndex}
              onRemove={removePlanModule}
            />

            <button type="button" onClick={() => setShowSettingsModal(true)} className="mt-3 flex w-full items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 text-left text-xs font-bold text-slate-600 hover:border-slate-300 hover:bg-white/75">
              <span className="flex min-w-0 items-center gap-2">
                <Settings2 className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="truncate">{settingsSummary}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
            </button>
          </section>}

          {outputCount > 0 && (
            <>
              <GenerationSettingsSummary
                aiModel={aiModel}
                imageSize={imageSize}
                qualityMode={qualityMode}
                expanded={showGenerationSettings}
                onToggle={() => setShowGenerationSettings((value) => !value)}
              />
              {showGenerationSettings && (
                <ModelConfigPanel
                  aiModel={aiModel}
                  imageType={imageType}
                  imageSize={imageSize}
                  qualityMode={qualityMode}
                  supportedSizes={supportedSizes}
                  onModelChange={(value) => { setAiModel(value); resetOutput(); }}
                  onSizeChange={(value) => { setImageSize(value); resetOutput(); }}
                  onQualityChange={(value) => { setQualityMode(value); resetOutput(); }}
                />
              )}
            </>
          )}
        </div>

        <div className="studio-runbar studio-runbar-v2 border-t border-white/70 bg-white/90 px-3 py-3 backdrop-blur-xl sm:px-5">
          <button
            type="button"
            onClick={generate}
            disabled={!canGenerate}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-black text-white shadow-[0_16px_36px_rgba(15,23,42,0.18)] transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            {outputCount > 0 ? `生成 ${Math.max(outputCount, 1)} ${outputUnit}` : mode === "smart" ? "请先分析生成方案" : "请先选择参考图方案"}
            {outputCount > 0 && <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{cost} 灵点</span>}
          </button>
          {requiresProductConfirmation && (
            <p className="mt-2 text-center text-[11px] font-bold text-amber-600">
              请先上传商品图、选择数量，并点击“帮我写商品信息”。
            </p>
          )}
          {mode === "custom" && outputCount <= 0 && (
            <p className="mt-2 text-center text-[11px] font-bold text-amber-600">
              请在参考图模式中选择预设，或上传参考图并添加参考。
            </p>
          )}
          {detailsResolutionWarning && !requiresProductConfirmation && (
            <p className="mt-2 text-center text-[11px] font-bold text-[var(--codex-accent)]">
              详情页含文字和细节，建议切到 2K 或 4K 再生成。
            </p>
          )}
        </div>
      </aside>

      <main className="studio-canvas relative min-h-[70dvh] flex-1 overflow-visible lg:overflow-hidden">
        <div className="relative overflow-y-visible p-4 pb-24 sm:p-6 lg:absolute lg:inset-0 lg:overflow-y-auto lg:p-8">
          {!isGenerating && !error && !hasResultStage && !shouldShowTaskPanel && (
            <div className="mx-auto flex min-h-[calc(100dvh-160px)] max-w-3xl items-center justify-center">
              <PreviewGuide
                imageSrc={getImageVariantUrl(productImages[0]?.url || PRODUCT_SET_EXAMPLE_GROUPS[0].images[0], "card")}
                imageAlt="商品套图示例"
                title="开始制作商品套图"
                subtitle="先分析商品信息，再按你选择的数量生成主图/详情页计划。"
                steps={[
                  { title: "上传商品图", desc: "最多 3 张，建议包含正面、侧面、背面或细节，方便 系统判断结构与卖点。" },
                  { title: "分析商品信息", desc: "系统会整理目标平台、风格、统一场景、卖点、痛点、人群、参数和配色。" },
                  { title: "生成套图计划", desc: `按 ${genCount || "选择的"} ${imageType === "main" ? "张主图" : "屏详情页"} 输出中文方案，再开始生成。` },
                ]}
              />
            </div>
          )}

          {(isGenerating || shouldShowTaskPanel) && !hasVisibleResults && moduleResults.length === 0 && (
            <div className="mx-auto max-w-3xl space-y-4">
              <LoadingStage
                genCount={activeQueueTask ? clampTaskExpectedCount(activeQueueTask, 1, imageType === "details" ? 8 : 6) : Math.max(outputCount, 1)}
                progress={activeQueueTask?.progress || progress}
                moduleName="商品套图"
                referenceImages={(safeTaskQueueUrls(activeQueueTask?.inputThumbnails).length ? safeTaskQueueUrls(activeQueueTask?.inputThumbnails) : productImages.map((item) => item.url)).map((url, index) => ({
                  label: `商品参考 ${index + 1}`,
                  url,
                }))}
                metaItems={[imageType === "main" ? "主图辅图" : "详情页", settings.platform, imageSize]}
              />
              {displayedResultPlan.length > 0 && (
                <ModuleProgressList templates={displayedResultPlan} moduleResults={moduleResults} resultUrls={resultUrls} isGenerating={isGenerating} />
              )}
            </div>
          )}

          {error && (
            <div className="studio-result-stage flex min-h-[360px] items-center justify-center px-4">
              <div className="max-w-md rounded-[28px] border border-red-100 bg-white p-6 text-center shadow-[0_18px_70px_rgba(15,23,42,0.08)]">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
                  <X className="h-7 w-7 text-red-400" />
                </div>
                <h2 className="text-base font-black text-slate-950">商品套图生成失败</h2>
                <p className="mt-2 text-sm leading-6 text-red-500">{summarizeGenerationError(error)}</p>
                <p className="mx-auto mt-3 max-w-sm rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs font-semibold leading-5 text-amber-700">
                  {FAILED_RETRY_NOTICE}
                </p>
                <div className="mt-5 flex justify-center gap-2">
                  <button type="button" onClick={generate} className="h-10 rounded-full bg-slate-950 px-5 text-sm font-bold text-white">重试</button>
                  <button type="button" onClick={() => { setError(""); setProgress(0); }} className="h-10 rounded-full border border-slate-200 bg-white px-5 text-sm font-bold text-slate-600">清空</button>
                </div>
              </div>
            </div>
          )}

          {hasResultStage && !error && (
            <section className="studio-result-stage animate-fade-in">
              <div className="mb-5 rounded-[28px] border border-white/80 bg-white/82 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-black text-slate-950">{isGenerating ? "商品套图生成中" : "商品套图结果"}</h2>
                    <p className="mt-1 text-xs text-slate-400">
                      {activeQueueTask?.time ? `${activeQueueTask.time} · ` : ""}
                      {mode === "smart" ? "智能套图" : "自定义套图"} · {imageType === "main" ? "主图辅图" : "详情页"} · {settings.platform} · 已出 {visibleResultCount}/{resultSlotCount}
                    </p>
                  </div>
                  <span className="inline-flex h-9 shrink-0 items-center justify-center rounded-full bg-[rgba(5,5,5,0.04)] px-3 text-xs font-black text-[var(--codex-accent)]">
                    {isGenerating ? `${progress}% 继续生成` : "已完成"}
                  </span>
                </div>
                {isGenerating && (
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-slate-700 to-slate-950 transition-[width]" style={{ width: `${Math.min(Math.max(progress, 0), 99)}%` }} />
                  </div>
                )}
                <ModuleProgressList templates={displayedResultPlan} moduleResults={moduleResults} resultUrls={resultUrls} isGenerating={isGenerating} compact />
              </div>
              <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {resultSlots.map(({ url, template, module }, index) => {
                  const slotFailed = module?.status === "failed" || (!url && hasCompletedPartialResults);
                  const slotFailureDetail = module?.error
                    ? buildPartialFailureDetail({ message: module.error, failedCount: 1 })
                    : partialFailureMessage;
                  return (
                    <article key={`${url || template?.id || "pending"}-${index}`} className="flex h-full flex-col overflow-hidden rounded-[24px] border border-white/80 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
                      {url ? (
                        <button type="button" onClick={() => setPreviewIndex(index)} className="group relative aspect-[3/4] w-full overflow-hidden bg-slate-100">
                          <RawPreviewImage src={getImageVariantUrl(url, "card")} alt={template?.name || `商品套图${index + 1}`} className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.02]" />
                          <span className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition group-hover:opacity-100">
                            <ZoomIn className="h-4 w-4" />
                          </span>
                        </button>
                      ) : slotFailed ? (
                        <div className="flex aspect-[3/4] w-full flex-col items-center justify-center bg-red-50 px-5 text-center">
                          <X className="h-7 w-7 text-red-400" />
                          <p className="mt-3 text-xs font-black text-red-500">该模块生成失败</p>
                          <p className="mt-1 max-w-56 text-[11px] leading-4 text-red-400">{slotFailureDetail}</p>
                          <button type="button" onClick={() => regenerateResult(index)} disabled={regeneratingIndex !== null || isGenerating} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-black text-red-500 shadow-sm disabled:opacity-50">
                            {regeneratingIndex === index ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            重生本张
                          </button>
                        </div>
                      ) : (
                        <div className="flex aspect-[3/4] w-full flex-col items-center justify-center bg-slate-50 text-center">
                          <Loader2 className="h-6 w-6 animate-spin text-[var(--codex-accent)]" />
                          <p className="mt-3 text-xs font-black text-slate-500">等待生成</p>
                          <p className="mt-1 max-w-32 text-[11px] leading-4 text-slate-400">该模块完成后会自动填入预览区</p>
                        </div>
                      )}
                      <div className="flex min-h-[94px] flex-1 p-3">
                        <div className="flex w-full items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-black text-slate-900">{template?.name || `结果 ${index + 1}`}</h3>
                            <p className="mt-1 text-[11px] font-bold text-slate-400">{url ? "已生成" : slotFailed ? "生成失败" : "生成中"} · {template?.imageType === "details" ? "详情页模块" : "主图/辅图"} · {getAspectRatioLabel(template?.aspectRatio || aspectRatio)}</p>
                            {module?.qualityScore !== undefined && (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <QualityBadge score={module.qualityScore} />
                                {module.qualityIssues?.slice(0, 1).map((issue, issueIndex) => (
                                  <span key={`${module.moduleKey}-issue-${issueIndex}`} className="line-clamp-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">
                                    {issue}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          {url && (
                            <div className="flex shrink-0 items-center gap-1">
                              <button type="button" onClick={() => regenerateResult(index)} disabled={regeneratingIndex !== null || isGenerating} className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 text-[var(--codex-accent)] hover:bg-[rgba(5,5,5,0.06)] disabled:cursor-not-allowed disabled:opacity-50" title="重生这一张">
                                {regeneratingIndex === index ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                              </button>
                              <button type="button" onClick={() => downloadResult(url, index)} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50" title="下载">
                                <Download className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              <StudioImagePreviewDialog
                open={previewIndex !== null}
                onClose={() => setPreviewIndex(null)}
                session={productSetPreviewSession}
                selectedIndex={previewIndex || 0}
                onSelectedIndexChange={setPreviewIndex}
                filenamePrefix="product-set"
                actions={PRODUCT_SET_PREVIEW_ACTIONS}
                onRegenerateOne={(_, index) => void regenerateResult(index)}
              />
            </section>
          )}
        </div>
      </main>

      <ClientPortal>
        {showSettingsModal && (
          <SettingsModal
            settings={settings}
            onSettingChange={updateSetting}
            onClose={() => setShowSettingsModal(false)}
          />
        )}

        {showProfileEditor && (
          <ProductProfileEditorModal
            profile={effectiveProductProfile}
            onClose={() => setShowProfileEditor(false)}
            onSave={(profile) => {
              saveProductProfile(profile);
              setShowProfileEditor(false);
            }}
          />
        )}

        {showReferenceStyleModal && (
          <ReferenceStyleModal
            value={referenceStyleDraft}
            onChange={setReferenceStyleDraft}
            onClose={() => setShowReferenceStyleModal(false)}
            onSave={saveReferenceStyleBrief}
          />
        )}

        {editingModuleIndex !== null && planTemplates[editingModuleIndex] && (
          <ModuleEditModal
            template={planTemplates[editingModuleIndex]}
            index={editingModuleIndex}
            override={moduleOverrides.find((item) => item.key === getProductSetModuleKey(planTemplates[editingModuleIndex], editingModuleIndex))}
            productProfile={effectiveProductProfile}
            onClose={() => setEditingModuleIndex(null)}
            onSave={(patch) => {
              upsertModuleOverride(editingModuleIndex, patch);
              setEditingModuleIndex(null);
            }}
            onRemove={() => {
              removePlanModule(editingModuleIndex);
              setEditingModuleIndex(null);
            }}
          />
        )}

        {showTemplateModal && (
          <TemplateLibraryModal
            imageType={imageType}
            genCount={genCount}
            templates={templates}
            selectedTemplateIds={activeSelectedTemplateIds}
            activeCustomTemplates={activeCustomTemplates}
            mode={mode}
            filter={templateFilter}
            query={templateQuery}
            customDraft={customDraft}
            showCustomBuilder={showCustomBuilder}
            isUploadingCustomRef={isUploadingCustomRef}
            customRefInputRef={customRefInputRef}
            customModelRefInputRef={customModelRefInputRef}
            customOtherRefInputRef={customOtherRefInputRef}
            onFilterChange={setTemplateFilter}
            onQueryChange={setTemplateQuery}
            onToggleTemplate={toggleTemplate}
            onClose={() => setShowTemplateModal(false)}
            onShowCustomBuilder={setShowCustomBuilder}
            onCustomDraftChange={setCustomDraft}
            onUploadCustomReference={uploadCustomReference}
            onAddCustomTemplate={addCustomTemplate}
            onRemoveCustomTemplate={(id) => {
              setCustomTemplates((prev) => prev.filter((item) => item.id !== id));
              resetOutput();
            }}
          />
        )}

        {lightboxSrc && (
          <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => setLightboxSrc(null)}>
            <button type="button" onClick={() => setLightboxSrc(null)} className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20">
              <X className="h-5 w-5" />
            </button>
            <RawPreviewImage src={lightboxSrc} alt="商品套图预览" className="max-h-[92vh] max-w-[94vw] rounded-2xl object-contain shadow-2xl" />
          </div>
        )}
      </ClientPortal>
    </div>
  );
}

function ProductModeTabs({ imageType, onChange }: { imageType: ProductSetImageType; onChange: (value: ProductSetImageType) => void }) {
  const options: Array<{ value: ProductSetImageType; title: string; desc: string }> = [
    { value: "main", title: "商品主图", desc: "先选张数，再分析" },
    { value: "details", title: "详情页", desc: "先选屏数，再分析" },
  ];

  return (
    <div className="rounded-[24px] border border-slate-100 bg-slate-50/80 p-1.5 shadow-sm">
      <div className="grid grid-cols-2 items-stretch gap-1.5">
        {options.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`flex h-14 items-center gap-2.5 rounded-[18px] border px-3 text-left transition-[border-color,background-color,color,box-shadow] ${
              imageType === item.value
                ? "border-zinc-200 bg-[rgba(5,5,5,0.04)] text-slate-950 shadow-sm"
                : "border-transparent bg-white/70 text-slate-600 hover:hover:border-zinc-300 hover:bg-white hover:text-[var(--codex-accent)]"
            }`}
          >
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition ${
              imageType === item.value
                ? "border-zinc-200 bg-white text-[var(--codex-accent)]"
                : "border-slate-100 bg-white text-slate-400"
            }`}>
              {item.value === "main" ? <ImagePlus className="h-4 w-4" /> : <Layers3 className="h-4 w-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black">{item.title}</span>
              <span className={`mt-0.5 block truncate text-[11px] ${imageType === item.value ? "text-[var(--codex-accent)]" : "text-slate-400"}`}>{item.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkflowStepper({ currentStep }: { currentStep: number }) {
  const steps = [
    { value: 1, title: "商品图", desc: "上传" },
    { value: 2, title: "信息", desc: "数量" },
    { value: 3, title: "分析", desc: "方案" },
    { value: 4, title: "生成", desc: "出图" },
  ];

  return (
    <div className="rounded-2xl border border-slate-100 bg-white px-3 py-3 shadow-sm">
      <div className="grid grid-cols-4 gap-1.5">
        {steps.map((step) => {
          const active = currentStep === step.value;
          const done = currentStep > step.value;
          return (
            <div
              key={step.value}
              className={`min-h-14 rounded-xl px-2 py-2 text-center transition ${
                active ? "bg-[rgba(5,5,5,0.04)] text-[var(--codex-accent)]" : done ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-400"
              }`}
            >
              <span className={`mx-auto flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${
                active ? "bg-[rgba(5,5,5,0.04)] text-white" : done ? "bg-emerald-500 text-white" : "bg-white text-slate-400"
              }`}>
                {done ? <Check className="h-3 w-3" /> : step.value}
              </span>
              <span className="mt-1 block truncate text-[11px] font-black">{step.title}</span>
              <span className="block truncate text-[10px] font-bold opacity-70">{step.desc}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CountSelector({
  imageType,
  value,
  options,
  onChange,
  helper,
}: {
  imageType: ProductSetImageType;
  value: number;
  options: number[];
  onChange: (value: number) => void;
  helper?: string;
}) {
  const unit = imageType === "main" ? "张" : "屏";
  return (
    <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-bold text-slate-700">{imageType === "main" ? "生成张数" : "详情页屏数"}</span>
        <span className="font-black text-[var(--codex-accent)]">{value > 0 ? `${value} ${unit}` : "未选择"}</span>
      </div>
      <StudioGenerationCountSelector
        value={value}
        onChange={onChange}
        counts={options}
        unit={unit}
        ariaLabel={imageType === "main" ? "生成张数" : "详情页屏数"}
      />
      {helper && <p className="mt-2 text-[11px] leading-5 text-slate-400">{helper}</p>}
    </div>
  );
}

function ProductBriefSummary({ fields, onEdit }: { fields: ProductInfoFields; onEdit: () => void }) {
  const chips = Array.from(new Set([
    ...splitBriefText(fields.audience),
    ...splitBriefText(fields.sellingPoints),
  ])).slice(0, 5);

  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black text-slate-400">商品信息</p>
          <h4 className="mt-1 truncate text-sm font-black text-slate-950">{fields.name || "待补充商品名"}</h4>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{fields.description || "已填写商品信息，点击编辑可继续补充卖点、材质和适用人群。"}</p>
        </div>
        <button type="button" onClick={onEdit} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-white px-2.5 text-[11px] font-black text-slate-600 shadow-sm hover:bg-[rgba(5,5,5,0.06)] hover:text-[var(--codex-accent)]">
          <Edit3 className="h-3.5 w-3.5" /> 编辑
        </button>
      </div>
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span key={chip} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500">{chip}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalysisSummaryCard({
  profile,
  analysis,
  stylePack,
  imageType,
  outputCount,
  expanded,
  onToggleExpanded,
  onEditProfile,
  onAdjust,
}: {
  profile: ProductSetProductProfile;
  analysis: ProductSetAnalysisDetail | null;
  stylePack: ProductSetStylePack;
  imageType: ProductSetImageType;
  outputCount: number;
  expanded: boolean;
  onToggleExpanded: () => void;
  onEditProfile: () => void;
  onAdjust: () => void;
}) {
  const qualityScore = analysis?.image_quality?.quality_score;
  const qualityLabel = typeof qualityScore === "number" && qualityScore > 0 ? `${qualityScore.toFixed(1)} / 10` : "已准备";
  const strategyName = analysis?.visual_director?.strategy_name || analysis?.generation_fit?.recommended_style || stylePack.name;
  const unit = imageType === "main" ? "张主图" : "屏详情页";
  const keywords = Array.from(new Set([
    profile.kind,
    profile.apparelType,
    ...profile.visualKeywords,
    ...(analysis?.product?.style_tags || []),
  ].filter(Boolean))).slice(0, 5);
  const missing = (analysis?.missing_info || []).filter((item) => item !== "no_missing").slice(0, 3);

  return (
    <div className="mt-3 rounded-2xl border border-zinc-200 bg-[rgba(5,5,5,0.04)] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-black text-[var(--codex-accent)]">
            <Activity className="h-3.5 w-3.5" /> 方案已生成
          </p>
          <h4 className="mt-1 truncate text-sm font-black text-slate-950">{profile.displayName}</h4>
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">
            {strategyName} · 计划生成 {outputCount} {unit} · 图片质量 {qualityLabel}
          </p>
        </div>
        <button type="button" onClick={onToggleExpanded} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-white px-2.5 text-[11px] font-black text-[var(--codex-accent)] shadow-sm hover:bg-[rgba(5,5,5,0.06)]">
          {expanded ? "收起细节" : "查看细节"}
          <ChevronRight className={`h-3.5 w-3.5 transition ${expanded ? "rotate-90" : ""}`} />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={onEditProfile} className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-white px-2 text-[11px] font-black text-slate-600 shadow-sm hover:bg-[rgba(5,5,5,0.06)] hover:text-[var(--codex-accent)]">
          <Edit3 className="h-3.5 w-3.5" /> 修改信息
        </button>
        <button type="button" onClick={onAdjust} className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-white px-2 text-[11px] font-black text-slate-600 shadow-sm hover:bg-[rgba(5,5,5,0.06)] hover:text-[var(--codex-accent)]">
          <Palette className="h-3.5 w-3.5" /> 调整风格
        </button>
      </div>

      {keywords.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {keywords.map((item) => (
            <span key={item} className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold text-slate-500">{item}</span>
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <p className="mt-2 text-[11px] font-bold leading-4 text-amber-600">建议补充：{missing.map(formatMissingInfo).join("、")}</p>
      )}
    </div>
  );
}

function ProductProfileCard({ profile, analysisSource, onEdit }: { profile: ProductSetProductProfile; analysisSource: ProductAnalysisSource; onEdit: () => void }) {
  const sourceLabel = analysisSource === "ai"
    ? "图片信息"
    : analysisSource === "fallback"
      ? "基础信息"
      : analysisSource === "running"
        ? "读取中"
        : analysisSource === "manual"
          ? "手动信息"
          : "待确认";

  return (
    <div className="mt-3 rounded-2xl border border-zinc-200 bg-[rgba(5,5,5,0.04)] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-black text-[var(--codex-accent)]">
            <Brush className="h-3.5 w-3.5" /> {sourceLabel}
          </p>
          <h4 className="mt-1 truncate text-sm font-black text-slate-950">{profile.displayName}</h4>
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{profile.modelBrief}</p>
        </div>
        <button type="button" onClick={onEdit} className={`inline-flex h-7 shrink-0 items-center rounded-full px-2 text-[10px] font-black transition ${profile.needsModel ? "bg-slate-100 text-slate-700 hover:bg-slate-200" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
          {profile.needsModel ? "建议模特" : "无需模特"} · 修改
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {Array.from(new Set([profile.kind, profile.apparelType, ...profile.visualKeywords.slice(0, 3)].filter(Boolean))).map((item, index) => (
          <span key={`${item}-${index}`} className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold text-slate-500">{item}</span>
        ))}
      </div>
    </div>
  );
}

function ProductVisualStrategyCard({
  profile,
  analysis,
  stylePack,
  imageType,
  onAdjust,
}: {
  profile: ProductSetProductProfile;
  analysis: ProductSetAnalysisDetail | null;
  stylePack: ProductSetStylePack;
  imageType: ProductSetImageType;
  onAdjust: () => void;
}) {
  const qualityScore = analysis?.image_quality?.quality_score;
  const qualityText = typeof qualityScore === "number" && qualityScore > 0 ? `${qualityScore.toFixed(1)} / 10` : "待评估";
  const strategyName = analysis?.visual_director?.strategy_name || "视觉策略";
  const globalStrategy = analysis?.visual_director?.global_strategy;
  const globalSummary = globalStrategy ? [
    globalStrategy.primary_color,
    globalStrategy.accent_color,
    globalStrategy.color_temperature,
    globalStrategy.typography,
  ].filter(Boolean).join(" · ") : "";
  const strategyReason = analysis?.visual_director?.style_strategy || globalSummary || analysis?.generation_fit?.recommended_style_reason || stylePack.description;
  const directorPlan = imageType === "main" ? analysis?.visual_director?.main_plan : analysis?.visual_director?.details_plan;
  const directorScripts = imageType === "main" ? analysis?.visual_director?.main_scripts : analysis?.visual_director?.details_scripts;
  const directions = [
    ...(directorScripts?.map((item) => item.title || item.module_key || "") || []),
    ...(directorPlan?.map((item) => item.purpose || item.module_key || "") || []),
    ...(analysis?.visual_director?.layout_principles || []),
    ...(analysis?.generation_fit?.recommended_output_set || []),
    ...(analysis?.product?.style_tags || []),
    ...(analysis?.product?.visible_details || []),
  ].filter(Boolean).slice(0, 5);
  const missing = (analysis?.missing_info || []).filter((item) => item !== "no_missing").slice(0, 4);

  return (
    <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-black text-zinc-700">
            <Palette className="h-3.5 w-3.5" /> 视觉策略
          </p>
          <h4 className="mt-1 truncate text-sm font-black text-slate-950">{strategyName} · {stylePack.name}</h4>
          <p className="mt-1 line-clamp-3 text-[11px] leading-4 text-slate-500">{strategyReason}</p>
        </div>
        <button type="button" onClick={onAdjust} className="inline-flex h-7 shrink-0 items-center rounded-full bg-white px-2 text-[10px] font-black text-zinc-700 shadow-sm hover:bg-zinc-100">
          调整风格
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 items-stretch gap-2">
        <div className="min-h-[58px] rounded-xl bg-white/75 px-2 py-2">
          <p className="text-[10px] font-black text-slate-400">图片质量</p>
          <p className="mt-1 text-xs font-black text-slate-800">{qualityText}</p>
        </div>
        <div className="min-h-[58px] rounded-xl bg-white/75 px-2 py-2">
          <p className="text-[10px] font-black text-slate-400">当前模式</p>
          <p className="mt-1 text-xs font-black text-slate-800">{imageType === "main" ? "商品主图" : "详情页"}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(directions.length ? directions : [profile.displayName, profile.modelStrategy, "智能匹配"]).map((item, index) => (
          <span key={`${item}-${index}`} className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold text-slate-500">{item}</span>
        ))}
      </div>
      {missing.length > 0 && (
        <p className="mt-2 text-[11px] font-bold leading-4 text-amber-600">
          建议补充：{missing.map(formatMissingInfo).join("、")}
        </p>
      )}
    </div>
  );
}

function ProductAnalysisNotice({ status }: { status: ReturnType<typeof getProductAnalysisStatus> }) {
  if (status.tone === "quiet") return null;
  const tone = status.tone === "running" ? "loading" : "warning";
  const title = status.tone === "running"
    ? "正在读取商品图"
    : status.tone === "warning"
      ? "商品信息需确认"
      : "商品读取未完成";

  return (
    <VisualAnalysisStatusCard
      status={{ tone, text: title, description: status.message || status.description }}
      className="mb-3"
    />
  );
}

function QualityBadge({ score }: { score?: number }) {
  const quality = getProductSetModuleQualityLabel(score);
  const className = quality.tone === "good"
    ? "bg-emerald-50 text-emerald-600"
    : quality.tone === "ok"
      ? "bg-sky-50 text-sky-600"
      : quality.tone === "warn"
        ? "bg-amber-50 text-amber-600"
        : "bg-slate-100 text-slate-400";
  return (
    <span className={`inline-flex h-6 items-center rounded-full px-2 text-[10px] font-black ${className}`}>
      {quality.label}{typeof score === "number" ? ` ${Math.round(score * 100)}` : ""}
    </span>
  );
}

function ModuleProgressList({
  templates,
  moduleResults,
  resultUrls,
  isGenerating,
  compact = false,
}: {
  templates: ProductSetResolvedTemplate[];
  moduleResults: ProductSetModuleResult[];
  resultUrls: string[];
  isGenerating: boolean;
  compact?: boolean;
}) {
  if (!templates.length) return null;
  return (
    <div className={`mt-4 grid gap-2 ${compact ? "sm:grid-cols-2 xl:grid-cols-3" : ""}`}>
      {templates.map((template, index) => {
        const moduleResult = moduleResults.find((item) => item.moduleKey === getProductSetModuleKey(template, index))
          || moduleResults.find((item) => Number(item.index) === index + 1)
          || moduleResults[index];
        const moduleUrl = typeof moduleResult?.resultUrl === "string" && moduleResult.resultUrl.length > 0 ? moduleResult.resultUrl : "";
        const done = moduleResult?.status === "completed" || Boolean(moduleUrl || resultUrls[index]);
        const failed = moduleResult?.status === "failed";
        const current = moduleResult?.status === "running" || (isGenerating && !done && resultUrls.filter(Boolean).length === index);
        const statusText = failed ? "失败" : done ? "已完成" : current ? `${moduleResult?.progress || "生成"}%` : "排队";
        return (
          <div key={`${template.source}-${template.id}-${index}`} className={`flex min-h-11 items-center gap-2 rounded-2xl border px-3 py-2 text-xs ${failed ? "border-red-100 bg-red-50 text-red-600" : done ? "border-emerald-100 bg-emerald-50 text-emerald-700" : current ? "border-zinc-200 bg-[rgba(5,5,5,0.04)] text-[var(--codex-accent)]" : "border-slate-100 bg-slate-50 text-slate-500"}`}>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-black shadow-sm">{done ? <Check className="h-3.5 w-3.5" /> : current ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : index + 1}</span>
            <span className="min-w-0 flex-1 truncate font-black">{template.name}</span>
            {done && moduleResult?.qualityScore !== undefined && <QualityBadge score={moduleResult.qualityScore} />}
            <span className="shrink-0 text-[10px] font-bold">{statusText}</span>
          </div>
        );
      })}
    </div>
  );
}

function ReferenceStyleModal({
  value,
  onChange,
  onClose,
  onSave,
}: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[135] flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-xl">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_30px_120px_rgba(15,23,42,0.28)]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black text-slate-950">参考风格说明</h2>
            <p className="mt-1 text-xs leading-5 text-slate-400">这里只保存风格方向，不会开始分析模板；点击下方“帮我写商品信息”时会一起传入智能分析。</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value.slice(0, 2000))}
            className="min-h-[40vh] w-full resize-none rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-800 outline-none focus:border-zinc-900 focus:bg-white sm:min-h-[520px]"
            placeholder="写入参考风格、目标平台、视觉风格、统一场景、配色和用户要求。"
          />
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
            <span>这段内容会作为风格参考传入分析，不会直接当作模板生成。</span>
            <span>{value.length} / 2000</span>
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" onClick={() => onChange(DEFAULT_REFERENCE_STYLE_BRIEF)} className="h-10 w-full rounded-full border border-slate-200 px-4 text-xs font-black text-slate-500 hover:bg-slate-50 sm:w-auto">
            恢复示例
          </button>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button type="button" onClick={onClose} className="h-10 w-full rounded-full border border-slate-200 px-5 text-xs font-black text-slate-500 hover:bg-slate-50 sm:w-auto">
              取消
            </button>
            <button type="button" onClick={onSave} className="h-10 w-full rounded-full bg-slate-950 px-6 text-xs font-black text-white hover:bg-slate-800 sm:w-auto">
              保存参考风格
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductProfileEditorModal({
  profile,
  onSave,
  onClose,
}: {
  profile: ProductSetProductProfile;
  onSave: (profile: ProductSetProductProfile) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ProductSetProductProfile>(profile);
  const kindOptions: { value: ProductSetProductKind; label: string }[] = [
    { value: "apparel", label: "服装" },
    { value: "footwear", label: "鞋靴" },
    { value: "bag", label: "箱包" },
    { value: "accessory", label: "配饰" },
    { value: "beauty", label: "美妆" },
    { value: "electronics", label: "数码电器" },
    { value: "home", label: "家居" },
    { value: "toy", label: "玩具" },
    { value: "food", label: "食品" },
    { value: "general", label: "通用商品" },
  ];
  const apparelOptions: { value: ProductSetApparelType; label: string }[] = [
    { value: "womenswear", label: "女装" },
    { value: "menswear", label: "男装" },
    { value: "kidswear", label: "童装" },
    { value: "outerwear", label: "外套/户外" },
    { value: "sportswear", label: "运动服" },
    { value: "intimate", label: "内衣" },
    { value: "swimwear", label: "泳装" },
    { value: "general", label: "通用服装" },
  ];
  const modelOptions: { value: ProductSetModelStrategy; label: string }[] = [
    { value: "none", label: "不用模特" },
    { value: "optional", label: "可选模特" },
    { value: "recommended", label: "建议模特" },
    { value: "required", label: "必须模特" },
  ];

  function setKind(kind: ProductSetProductKind) {
    const isApparel = kind === "apparel" || kind === "footwear";
    setDraft((prev) => ({
      ...prev,
      kind,
      isApparel,
      needsModel: isApparel ? prev.needsModel || prev.modelStrategy !== "none" : false,
      modelStrategy: isApparel ? (prev.modelStrategy === "none" ? "recommended" : prev.modelStrategy) : "none",
    }));
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-xl">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[32px] bg-white shadow-[0_30px_120px_rgba(15,23,42,0.28)]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black text-slate-950">修正商品识别</h2>
            <p className="mt-1 text-xs text-slate-400">识别结果会影响默认模板、是否使用模特和提示词安全边界。</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <div>
            <p className="mb-2 text-xs font-black text-slate-700">商品类型</p>
            <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-5">
              {kindOptions.map((item) => (
                <button key={item.value} type="button" onClick={() => setKind(item.value)} className={`h-10 truncate rounded-xl border px-2 text-xs font-black transition ${draft.kind === item.value ? "border-zinc-200 bg-[rgba(5,5,5,0.04)] text-[var(--codex-accent)]" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          {(draft.kind === "apparel" || draft.kind === "footwear" || draft.isApparel) && (
            <div>
              <p className="mb-2 text-xs font-black text-slate-700">服装细分</p>
              <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-4">
                {apparelOptions.map((item) => (
                  <button key={item.value} type="button" onClick={() => setDraft((prev) => ({ ...prev, apparelType: item.value, isApparel: true }))} className={`h-10 truncate rounded-xl border px-2 text-xs font-black transition ${draft.apparelType === item.value ? "border-zinc-200 bg-[rgba(5,5,5,0.04)] text-[var(--codex-accent)]" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="mb-2 text-xs font-black text-slate-700">模特策略</p>
            <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-4">
              {modelOptions.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, modelStrategy: item.value, needsModel: item.value === "recommended" || item.value === "required" }))}
                  className={`h-10 truncate rounded-xl border px-2 text-xs font-black transition ${draft.modelStrategy === item.value ? "border-zinc-200 bg-[rgba(5,5,5,0.04)] text-[var(--codex-accent)]" : "border-slate-200 bg-slate-50 text-slate-500"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={draft.modelBrief}
            onChange={(event) => setDraft((prev) => ({ ...prev, modelBrief: event.target.value.slice(0, 220) }))}
            className="min-h-28 w-full resize-none rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 text-sm leading-6 outline-none focus:border-zinc-900"
            placeholder="例如：成年女性模特，法式通勤场景，姿势自然，突出版型和垂感，不要夸张摆拍。"
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose} className="h-11 rounded-full bg-slate-100 px-8 text-sm font-black text-slate-600">取消</button>
          <button type="button" onClick={() => onSave(draft)} className="h-11 rounded-full bg-slate-950 px-8 text-sm font-black text-white">确认</button>
        </div>
      </div>
    </div>
  );
}

function ModuleEditModal({
  template,
  index,
  override,
  productProfile,
  onSave,
  onRemove,
  onClose,
}: {
  template: ProductSetResolvedTemplate;
  index: number;
  override?: ProductSetModuleOverride;
  productProfile: ProductSetProductProfile;
  onSave: (patch: Partial<ProductSetModuleOverride>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({
    name: override?.name || template.name,
    moduleRole: override?.moduleRole || template.moduleRole,
    contentScope: override?.contentScope || template.contentScope,
    layoutRules: override?.layoutRules || template.layoutRules,
    textRules: override?.textRules || template.textRules,
    avoidRules: override?.avoidRules || template.avoidRules,
    typeDescription: override?.typeDescription || template.typeDescriptionV2 || template.typeDescription,
    extraDescription: override?.extraDescription || "",
    aspectRatio: override?.aspectRatio || template.aspectRatio,
    subjectConsistency: override?.subjectConsistency ?? template.subjectConsistency,
    modelConsistency: override?.modelConsistency ?? Boolean(template.modelConsistency),
    intelligentCopy: override?.intelligentCopy ?? template.intelligentCopy,
    copyDensity: (override?.copyDensity || template.copyDensity || "standard") as ProductSetCopyDensity,
  });
  const usesModel = shouldUseModelForTemplate({ ...template, ...draft }, productProfile);

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-xl">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[32px] bg-white shadow-[0_30px_120px_rgba(15,23,42,0.28)]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black text-[var(--codex-accent)]">第 {index + 1} 张 · {template.imageType === "details" ? "详情页模块" : "主图/辅图模块"}</p>
            <h2 className="mt-1 text-lg font-black text-slate-950">编辑生成模块</h2>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="rounded-2xl border border-zinc-200 bg-[rgba(5,5,5,0.04)] px-3 py-3 text-xs leading-5 text-[var(--codex-accent)]">
            {getProductSetModuleReason(template, productProfile)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldInput label="模块名称" value={draft.name} maxLength={40} onChange={(value) => setDraft((prev) => ({ ...prev, name: value }))} />
            <FieldInput label="模块职责" value={draft.moduleRole} maxLength={160} onChange={(value) => setDraft((prev) => ({ ...prev, moduleRole: value }))} />
          </div>
          <FieldTextarea label="内容范围" value={draft.contentScope} maxLength={320} onChange={(value) => setDraft((prev) => ({ ...prev, contentScope: value }))} placeholder="例如：只讲面料与版型，不重复整套卖点；或只展示模特上身与搭配氛围。" />
          <div className="grid gap-3 sm:grid-cols-3">
            <FieldTextarea label="版式规则" value={draft.layoutRules} maxLength={320} onChange={(value) => setDraft((prev) => ({ ...prev, layoutRules: value }))} placeholder="例如：左文右图、细节宫格、单人半身海报。" />
            <FieldTextarea label="文字规则" value={draft.textRules} maxLength={260} onChange={(value) => setDraft((prev) => ({ ...prev, textRules: value }))} placeholder="例如：只保留 1 个标题和 3 个短标签。" />
            <FieldTextarea label="禁忌规则" value={draft.avoidRules} maxLength={320} onChange={(value) => setDraft((prev) => ({ ...prev, avoidRules: value }))} placeholder="例如：不要重复尺码图，不要堆满卖点。" />
          </div>
          <FieldTextarea label="模板描述" value={draft.typeDescription} maxLength={700} onChange={(value) => setDraft((prev) => ({ ...prev, typeDescription: value }))} placeholder="说明这张图最终要解决什么转化问题。" />
          <div>
            <p className="mb-2 text-xs font-black text-slate-700">生图比例</p>
            <div className="grid grid-cols-4 items-stretch gap-2">
              {CUSTOM_ASPECTS.map((value) => (
                <button key={value} type="button" onClick={() => setDraft((prev) => ({ ...prev, aspectRatio: value }))} className={`h-10 rounded-xl border text-xs font-black transition ${draft.aspectRatio === value ? "border-zinc-200 bg-[rgba(5,5,5,0.04)] text-[var(--codex-accent)]" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                  {getAspectRatioLabel(value)}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <ToggleButton active={draft.subjectConsistency} label="商品一致" onClick={() => setDraft((prev) => ({ ...prev, subjectConsistency: !prev.subjectConsistency }))} />
            <ToggleButton active={draft.modelConsistency} label="模特一致" onClick={() => setDraft((prev) => ({ ...prev, modelConsistency: !prev.modelConsistency }))} />
            <ToggleButton active={draft.intelligentCopy} label="智能文案" onClick={() => setDraft((prev) => ({ ...prev, intelligentCopy: !prev.intelligentCopy }))} />
            <select value={draft.copyDensity} onChange={(event) => setDraft((prev) => ({ ...prev, copyDensity: event.target.value as ProductSetCopyDensity }))} className="h-10 rounded-xl border border-slate-100 bg-slate-50 px-2 text-xs font-bold text-slate-600 outline-none">
              <option value="none">无文案</option>
              <option value="light">轻文案</option>
              <option value="standard">标准文案</option>
              <option value="rich">信息丰富</option>
            </select>
          </div>
          <div className={`rounded-2xl px-3 py-3 text-xs leading-5 ${usesModel ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-500"}`}>
            {usesModel ? "该模块会优先使用模特/上身场景。若不希望出现模特，可把模块职责改为白底、细节、尺码或关闭模特一致性。" : "该模块默认不使用模特，更适合白底、细节、尺寸、材质、包装或参数说明。"}
          </div>
          <FieldTextarea label="额外描述" value={draft.extraDescription} maxLength={700} onChange={(value) => setDraft((prev) => ({ ...prev, extraDescription: value }))} placeholder="只写这张图的特殊要求，例如：女装首屏海报不要底部缩略图；细节图只展示连帽、袖口、口袋三个局部。" />
        </div>
        <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" onClick={onRemove} className="h-11 shrink-0 rounded-full border border-red-100 bg-red-50 px-5 text-sm font-black text-red-500">移除本模块</button>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="h-11 rounded-full bg-slate-100 px-8 text-sm font-black text-slate-600">取消</button>
            <button type="button" onClick={() => onSave(draft)} className="h-11 rounded-full bg-slate-950 px-8 text-sm font-black text-white">保存</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldInput({ label, value, maxLength, onChange }: { label: string; value: string; maxLength: number; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-black text-slate-500">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value.slice(0, maxLength))} className="h-10 w-full rounded-xl border border-slate-100 bg-slate-50 px-3 text-xs outline-none focus:border-zinc-900" />
    </label>
  );
}

function FieldTextarea({ label, value, maxLength, onChange, placeholder }: { label: string; value: string; maxLength: number; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-black text-slate-500">{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value.slice(0, maxLength))} placeholder={placeholder} className="min-h-24 w-full resize-none rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-5 outline-none focus:border-zinc-900" />
    </label>
  );
}

function PlanRecommendationCard({
  recommendation,
  imageType,
  compact = false,
}: {
  recommendation: ReturnType<typeof buildProductSetPlanRecommendation>;
  imageType: ProductSetImageType;
  compact?: boolean;
}) {
  const riskClass = recommendation.riskLevel === "high"
    ? "border-amber-100 bg-amber-50 text-amber-700"
    : recommendation.riskLevel === "medium"
      ? "border-amber-100 bg-amber-50 text-amber-700"
      : "border-emerald-100 bg-emerald-50 text-emerald-700";
  const unit = imageType === "main" ? "张主图" : "屏详情页";

  return (
    <div className={`${compact ? "" : "mb-3"} rounded-2xl border border-zinc-200 bg-[rgba(5,5,5,0.04)] p-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black text-[var(--codex-accent)]">视觉总监方案</p>
          <h4 className="mt-1 truncate text-sm font-black text-slate-950">{recommendation.title}</h4>
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{recommendation.summary}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-black ${riskClass}`}>
          {recommendation.riskLevel === "high" ? "安全模板" : recommendation.riskLevel === "medium" ? "含模特" : "低风险"}
        </span>
      </div>
      <div className="mt-2 inline-flex rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-[var(--codex-accent)]">
        推荐生成 {recommendation.suggestedCount} {unit}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {recommendation.modules.slice(0, compact ? 4 : 6).map((module) => (
          <span key={module.key} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500">
            {module.usesModel ? "模特 · " : ""}{module.name}
          </span>
        ))}
        {compact && recommendation.modules.length > 4 && (
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-400">+{recommendation.modules.length - 4}</span>
        )}
      </div>
    </div>
  );
}

type ReferenceIntentOption = {
  label: string;
  role: string;
  description: string;
  scope: string;
};

const REFERENCE_INTENT_OPTIONS: Record<ProductSetImageType, ReferenceIntentOption[]> = {
  main: [
    { label: "自动识别", role: "主图参考风格", description: "参考图模式：自动识别参考图的构图、光影、场景和视觉风格，生成适合上架或投放的商品图。", scope: "" },
    { label: "上身展示", role: "模特上身展示", description: "参考模特姿态、镜头距离和上身效果，突出商品穿着表现。", scope: "突出商品上身效果、版型和穿搭氛围。" },
    { label: "卖点海报", role: "卖点海报", description: "参考海报式构图和视觉层级，生成更适合点击和投放的商品主图。", scope: "突出核心卖点、第一眼吸引力和商品辨识度。" },
    { label: "场景氛围", role: "场景氛围图", description: "参考场景、光影和情绪氛围，让商品图更有生活感。", scope: "突出使用场景、穿搭情绪和品牌调性。" },
  ],
  details: [
    { label: "自动拆屏", role: "详情页参考风格", description: "参考图模式：自动识别参考图的版式、信息层级和视觉风格，按所选屏数拆成详情页方案。", scope: "" },
    { label: "首屏海报", role: "详情页首屏海报", description: "参考首屏海报的构图、标题层级和氛围，生成详情页开场屏。", scope: "用于详情页开头，突出风格、商品定位和第一眼吸引力。" },
    { label: "卖点说明", role: "核心卖点说明", description: "参考信息展示方式，把商品卖点拆成清晰易懂的详情页模块。", scope: "用于展示核心卖点、功能利益点和购买理由。" },
    { label: "细节材质", role: "细节材质展示", description: "参考局部特写和细节排版，生成面料、工艺或结构说明屏。", scope: "用于展示面料质感、细节工艺、版型或功能结构。" },
  ],
};

function CustomTemplateSourcePanel({
  imageType,
  genCount,
  customDraft,
  activeCustomTemplates,
  isUploadingCustomRef,
  customRefInputRef,
  customModelRefInputRef,
  customOtherRefInputRef,
  onCustomDraftChange,
  onUploadCustomReference,
  onAddCustomTemplate,
  onRemoveCustomTemplate,
  onOpenLibrary,
}: {
  imageType: ProductSetImageType;
  genCount: number;
  customDraft: CustomDraft;
  activeCustomTemplates: ProductSetCustomTemplate[];
  isUploadingCustomRef: boolean;
  customRefInputRef: React.RefObject<HTMLInputElement | null>;
  customModelRefInputRef: React.RefObject<HTMLInputElement | null>;
  customOtherRefInputRef: React.RefObject<HTMLInputElement | null>;
  onCustomDraftChange: (updater: (value: CustomDraft) => CustomDraft) => void;
  onUploadCustomReference: (kind: "style" | "model" | "other", file?: File) => void;
  onAddCustomTemplate: () => void;
  onRemoveCustomTemplate: (id: string) => void;
  onOpenLibrary: () => void;
}) {
  const countLabel = genCount > 0
    ? `${genCount} ${imageType === "main" ? "张主图" : "屏详情页"}`
    : imageType === "main" ? "所选张数" : "所选屏数";
  return (
    <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-1.5 text-xs font-black text-slate-800">
            <Upload className="h-3.5 w-3.5 text-[var(--codex-accent)]" /> 上传参考图
          </p>
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-400">
            上传 1 张主参考图即可，系统会自动理解版式和风格，再按{countLabel}拆成方案。
          </p>
        </div>
        <button type="button" onClick={onOpenLibrary} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-white px-2.5 text-[11px] font-black text-[var(--codex-accent)] hover:bg-[rgba(5,5,5,0.06)]">
          模板库
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <ReferenceQuickStart
        imageType={imageType}
        genCount={genCount}
        customDraft={customDraft}
        isUploadingCustomRef={isUploadingCustomRef}
        customRefInputRef={customRefInputRef}
        customModelRefInputRef={customModelRefInputRef}
        customOtherRefInputRef={customOtherRefInputRef}
        onCustomDraftChange={onCustomDraftChange}
        onUploadCustomReference={onUploadCustomReference}
        onAddCustomTemplate={onAddCustomTemplate}
      />

      <div>
        <h4 className="text-xs font-black text-slate-700">已添加参考</h4>
        {activeCustomTemplates.length ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {activeCustomTemplates.map((template) => (
              <div key={template.id} className="flex min-h-12 items-center justify-between gap-2 rounded-2xl bg-white px-3 py-2 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-black text-slate-700">{template.name}</p>
                  <p className="mt-0.5 truncate text-[10px] font-bold text-slate-400">{template.moduleRole || template.typeDescription}</p>
                </div>
                <button type="button" onClick={() => onRemoveCustomTemplate(template.id)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 rounded-2xl bg-white px-3 py-4 text-xs leading-5 text-slate-400">还没有添加参考。上传主参考图后点添加，参考图会随商品图一起发送，只影响风格、版式、模特或氛围。</p>
        )}
      </div>
    </div>
  );
}

function ReferenceQuickStart({
  imageType,
  genCount,
  customDraft,
  isUploadingCustomRef,
  customRefInputRef,
  customModelRefInputRef,
  customOtherRefInputRef,
  onCustomDraftChange,
  onUploadCustomReference,
  onAddCustomTemplate,
}: {
  imageType: ProductSetImageType;
  genCount: number;
  customDraft: CustomDraft;
  isUploadingCustomRef: boolean;
  customRefInputRef: React.RefObject<HTMLInputElement | null>;
  customModelRefInputRef: React.RefObject<HTMLInputElement | null>;
  customOtherRefInputRef: React.RefObject<HTMLInputElement | null>;
  onCustomDraftChange: (updater: (value: CustomDraft) => CustomDraft) => void;
  onUploadCustomReference: (kind: "style" | "model" | "other", file?: File) => void;
  onAddCustomTemplate: () => void;
}) {
  const unit = imageType === "main" ? "张" : "屏";
  const intentOptions = REFERENCE_INTENT_OPTIONS[imageType];
  const activeIntent = intentOptions.find((option) => option.role === customDraft.moduleRole) || intentOptions[0];
  const referenceCount = customDraft.referenceImageUrls.length + customDraft.modelReferenceImageUrls.length + customDraft.otherReferenceImageUrls.length;
  const hasReferenceImage = referenceCount > 0;
  const hasCount = genCount > 0;
  const canAddReference = hasReferenceImage && hasCount;

  function chooseIntent(option: ReferenceIntentOption) {
    onCustomDraftChange((prev) => ({
      ...prev,
      moduleRole: option.role,
      typeDescription: option.description,
      contentScope: option.scope,
      name: prev.name && prev.name !== DEFAULT_DRAFT.name ? prev.name : (imageType === "details" ? "参考图详情方案" : "参考图主图方案"),
    }));
  }

  return (
    <div className="space-y-3">
      <input ref={customRefInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => onUploadCustomReference("style", event.target.files?.[0])} />
      <input ref={customModelRefInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => onUploadCustomReference("model", event.target.files?.[0])} />
      <input ref={customOtherRefInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => onUploadCustomReference("other", event.target.files?.[0])} />

      <div className="rounded-2xl bg-white p-2 shadow-sm">
        <ReferenceUploadButton label="主参考图" hint="风格 / 版式" url={customDraft.referenceImageUrls[0]} loading={isUploadingCustomRef} onClick={() => customRefInputRef.current?.click()} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <ReferenceUploadButton label="模特参考" hint="可选" url={customDraft.modelReferenceImageUrls[0]} loading={isUploadingCustomRef} onClick={() => customModelRefInputRef.current?.click()} />
        <ReferenceUploadButton label={`补充参考 ${customDraft.otherReferenceImageUrls.length}/3`} hint="可选" url={customDraft.otherReferenceImageUrls[0]} loading={isUploadingCustomRef} onClick={() => customOtherRefInputRef.current?.click()} />
      </div>

      <div className="rounded-2xl bg-white px-3 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[11px] font-black text-slate-500">参考重点</p>
          <span className="rounded-full bg-[rgba(5,5,5,0.04)] px-2 py-0.5 text-[10px] font-black text-[var(--codex-accent)]">{activeIntent.label}</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {intentOptions.map((option) => (
            <button
              key={option.role}
              type="button"
              onClick={() => chooseIntent(option)}
              className={`h-9 rounded-xl border px-2 text-[11px] font-black transition ${activeIntent.role === option.role ? "border-zinc-200 bg-[rgba(5,5,5,0.04)] text-[var(--codex-accent)]" : "border-slate-100 bg-slate-50 text-slate-500 hover:hover:border-zinc-300 hover:bg-[rgba(5,5,5,0.06)]"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <details className="group rounded-2xl border border-slate-100 bg-white px-3 py-2">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-black text-slate-600">
          <span className="inline-flex items-center gap-1.5"><Settings2 className="h-3.5 w-3.5 text-[var(--codex-accent)]" /> 高级设置</span>
          <ChevronRight className="h-3.5 w-3.5 transition group-open:rotate-90" />
        </summary>
        <div className="mt-3 space-y-3">
          <div>
            <p className="mb-2 text-[11px] font-black text-slate-500">画面比例</p>
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
              {CUSTOM_ASPECTS.map((value) => (
                <button key={value} type="button" onClick={() => onCustomDraftChange((prev) => ({ ...prev, aspectRatio: value }))} className={`h-8 rounded-lg border px-2 text-[11px] ${customDraft.aspectRatio === value ? "border-zinc-200 bg-[rgba(5,5,5,0.04)] text-[var(--codex-accent)]" : "border-slate-200 bg-white text-slate-500"}`}>{getAspectRatioLabel(value)}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 items-stretch gap-2">
            <ToggleButton active={customDraft.subjectConsistency} label="商品一致" onClick={() => onCustomDraftChange((prev) => ({ ...prev, subjectConsistency: !prev.subjectConsistency }))} />
            <ToggleButton active={customDraft.modelConsistency} label="模特一致" onClick={() => onCustomDraftChange((prev) => ({ ...prev, modelConsistency: !prev.modelConsistency }))} />
            <ToggleButton active={customDraft.intelligentCopy} label="智能文案" onClick={() => onCustomDraftChange((prev) => ({ ...prev, intelligentCopy: !prev.intelligentCopy }))} />
            <select value={customDraft.copyDensity} onChange={(event) => onCustomDraftChange((prev) => ({ ...prev, copyDensity: event.target.value as ProductSetCopyDensity }))} className="h-10 rounded-xl border border-slate-100 bg-slate-50 px-2 text-xs font-bold text-slate-600 outline-none">
              <option value="none">无文案</option>
              <option value="light">轻文案</option>
              <option value="standard">标准文案</option>
              <option value="rich">信息丰富</option>
            </select>
          </div>
          <textarea value={customDraft.extraDescription} onChange={(event) => onCustomDraftChange((prev) => ({ ...prev, extraDescription: event.target.value.slice(0, 600) }))} className="min-h-16 w-full resize-none rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-5 outline-none focus:border-zinc-900" placeholder="特殊要求（可选），例如不要文字、不要模特露脸、突出细节。" />
        </div>
      </details>

      <button
        type="button"
        onClick={onAddCustomTemplate}
        disabled={!canAddReference}
        className={`h-11 w-full rounded-xl text-xs font-black transition ${canAddReference ? "bg-slate-950 text-white hover:bg-[rgba(5,5,5,0.06)]" : "cursor-not-allowed bg-slate-200 text-slate-400"}`}
      >
        {!hasReferenceImage ? "请先上传主参考图" : !hasCount ? `请先选择${imageType === "main" ? "张数" : "屏数"}` : `添加参考图并生成 ${genCount} ${unit}方案`}
      </button>
    </div>
  );
}

function FavoritePlanPanel({
  embedded = false,
  plans,
  draftName,
  defaultName,
  currentPlanCount,
  showList,
  isLoading,
  isSaving,
  onDraftNameChange,
  onSave,
  onApply,
  onDelete,
  onToggleList,
}: {
  embedded?: boolean;
  plans: SavedProductSetPlan[];
  draftName: string;
  defaultName: string;
  currentPlanCount: number;
  showList: boolean;
  isLoading: boolean;
  isSaving: boolean;
  onDraftNameChange: (value: string) => void;
  onSave: () => void;
  onApply: (plan: SavedProductSetPlan) => void;
  onDelete: (id: string) => void;
  onToggleList?: () => void;
}) {
  const shouldShowList = embedded || showList;
  return (
    <div className={`${embedded ? "" : "mt-3"} rounded-2xl border border-slate-100 bg-slate-50 p-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-1.5 text-xs font-black text-slate-800">
            <Bookmark className="h-3.5 w-3.5 text-[var(--codex-accent)]" /> 我的收藏模板
          </p>
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-400">
            收藏当前视觉方案或自定义模板，下次换商品后直接套用。
          </p>
        </div>
        {!embedded && onToggleList && (
          <button
            type="button"
            onClick={onToggleList}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-white px-2.5 text-[11px] font-black text-[var(--codex-accent)] hover:bg-[rgba(5,5,5,0.06)]"
          >
            {plans.length} 套
            <ChevronRight className={`h-3.5 w-3.5 transition ${showList ? "rotate-90" : ""}`} />
          </button>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={draftName}
          onChange={(event) => onDraftNameChange(event.target.value.slice(0, 40))}
          placeholder={defaultName}
          className="h-10 min-w-0 flex-1 rounded-xl border border-slate-100 bg-white px-3 text-xs font-bold text-slate-700 outline-none transition focus:border-zinc-900"
        />
        <button
          type="button"
          onClick={onSave}
          disabled={currentPlanCount <= 0 || isSaving}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-slate-950 px-3 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          收藏
        </button>
      </div>

      {shouldShowList && (
        <div className="mt-3 space-y-2">
          {isLoading ? (
            <p className="rounded-2xl bg-white px-3 py-4 text-center text-xs text-slate-400">
              正在加载账号收藏方案...
            </p>
          ) : plans.length ? plans.map((plan) => (
            <div key={plan.id} className="rounded-2xl border border-white bg-white px-3 py-3 shadow-sm">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-black text-slate-800">{plan.name}</p>
                  <p className="mt-0.5 truncate text-[11px] font-bold text-slate-400">
                    {formatSavedPlanMeta(plan)} · {formatSavedPlanTime(plan.updatedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onApply(plan)}
                  className="h-8 shrink-0 rounded-full bg-[rgba(5,5,5,0.04)] px-3 text-[11px] font-black text-[var(--codex-accent)] hover:bg-[rgba(5,5,5,0.06)]"
                >
                  套用
                </button>
                <button
                  type="button"
                  aria-label="删除收藏方案"
                  onClick={() => onDelete(plan.id)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-500"
                  title="删除收藏方案"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {plan.planPreview.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {plan.planPreview.slice(0, 4).map((module, index) => (
                    <span key={`${plan.id}-${module.name}-${index}`} className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                      {module.usesModel ? "模特 · " : ""}{module.name}
                    </span>
                  ))}
                  {plan.planPreview.length > 4 && (
                    <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                      +{plan.planPreview.length - 4}
                    </span>
                  )}
                </div>
              )}
            </div>
          )) : (
            <p className="rounded-2xl bg-white px-3 py-4 text-center text-xs text-slate-400">
              暂无账号收藏方案。先调整好当前生成计划，再点收藏。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PlanList({
  templates,
  productProfile,
  limit,
  onEdit,
  onRemove,
}: {
  templates: ProductSetResolvedTemplate[];
  productProfile: ProductSetProductProfile;
  limit?: number;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  if (!templates.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-xs text-slate-400">
        还没有选择模板，打开模板库添加。
      </div>
    );
  }

  const visibleTemplates = typeof limit === "number" ? templates.slice(0, limit) : templates;
  const hiddenCount = templates.length - visibleTemplates.length;

  return (
    <div className="space-y-2">
      {visibleTemplates.map((template, index) => (
        <div key={`${template.source}-${template.id}-${index}`} className="flex min-h-[76px] items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-black text-[var(--codex-accent)] shadow-sm">{index + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-black text-slate-800">{template.name}</p>
            <p className="truncate text-[11px] text-slate-400">{template.imageType === "details" ? "详情页" : "主图/辅图"} · {getAspectRatioLabel(template.aspectRatio)} · {template.moduleRole}</p>
            <p className="mt-1 line-clamp-1 text-[10px] text-slate-400">{getProductSetModuleReason(template, productProfile)}</p>
          </div>
          {shouldUseModelForTemplate(template, productProfile) && (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600">模特</span>
          )}
          <button type="button" onClick={() => onEdit(index)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-[rgba(5,5,5,0.06)] hover:text-[var(--codex-accent)]" title="编辑模块">
            <Edit3 className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => onRemove(index)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-500" title="移除模块">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {hiddenCount > 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-3 py-2 text-center text-[11px] font-bold text-slate-400">
          已折叠 {hiddenCount} 个后续模块，点击右上角查看全部。
        </div>
      )}
    </div>
  );
}

function GenerationSettingsSummary({
  aiModel,
  imageSize,
  qualityMode,
  expanded,
  onToggle,
}: {
  aiModel: LingyaModel;
  imageSize: ImageSize;
  qualityMode: "standard" | "advanced";
  expanded: boolean;
  onToggle: () => void;
}) {
  const model = MODELS.find((item) => item.value === aiModel);
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between gap-3 rounded-3xl border border-slate-100 bg-white p-4 text-left shadow-sm hover:hover:border-zinc-300 hover:bg-[rgba(5,5,5,0.06)]"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-[var(--codex-accent)]">
          <Activity className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-black text-slate-950">生成设置</span>
          <span className="mt-1 block truncate text-xs font-bold text-slate-400">
            {model?.label || aiModel} · {imageSize} · {qualityMode === "advanced" ? "高级质检" : "标准质检"}
          </span>
        </span>
      </span>
      <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-slate-50 px-2.5 text-[11px] font-black text-slate-500">
        {expanded ? "收起" : "调整"}
        <ChevronRight className={`h-3.5 w-3.5 transition ${expanded ? "rotate-90" : ""}`} />
      </span>
    </button>
  );
}

function ModelConfigPanel({
  aiModel,
  imageType,
  imageSize,
  qualityMode,
  supportedSizes,
  onModelChange,
  onSizeChange,
  onQualityChange,
}: {
  aiModel: LingyaModel;
  imageType: ProductSetImageType;
  imageSize: ImageSize;
  qualityMode: "standard" | "advanced";
  supportedSizes: ImageSize[];
  onModelChange: (value: LingyaModel) => void;
  onSizeChange: (value: ImageSize) => void;
  onQualityChange: (value: "standard" | "advanced") => void;
}) {
  return (
    <section className="space-y-3">
      <div className="rounded-2xl border border-slate-100/80 bg-white/45 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-950">
          <Activity className="h-4 w-4 text-[var(--codex-accent)]" /> 生成模型
        </h3>
        <div className="grid grid-cols-2 items-stretch gap-2">
          {MODELS.map((model) => (
            <button
              key={model.value}
              type="button"
              onClick={() => onModelChange(model.value)}
              className={`min-h-[72px] rounded-2xl border px-3 py-2.5 text-left transition-[border-color,background-color,color,box-shadow] ${
                aiModel === model.value
                  ? "border-zinc-2000 bg-[rgba(5,5,5,0.04)] text-slate-950 shadow-sm"
                  : "border-slate-100 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <RawPreviewImage src={model.icon} alt="" className="h-4 w-4 shrink-0 object-contain" />
                <span className="min-w-0 truncate text-[11px] font-black">{model.label}</span>
                {model.badge && (
                  <span className="shrink-0 rounded-full bg-[rgba(5,5,5,0.04)] px-1.5 py-0.5 text-[9px] font-black text-[var(--codex-accent)]">
                    {model.badge}
                  </span>
                )}
              </div>
              <p className="mt-1 line-clamp-2 pl-5 text-[11px] font-semibold leading-tight text-slate-400" title={model.desc}>{model.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100/80 bg-white/45 p-4">
        <h3 className="mb-3 text-sm font-black text-slate-950">分辨率</h3>
        <div className="grid grid-cols-3 gap-2">
          {supportedSizes.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => onSizeChange(size)}
              className={`h-10 rounded-xl border px-2 text-xs font-bold transition-colors ${
                imageSize === size
                  ? "border-zinc-2000 bg-[rgba(5,5,5,0.04)] text-[var(--codex-accent)]"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              {size} · {getCreditCost(aiModel, size, "3:4")}灵点
            </button>
          ))}
        </div>
        {imageType === "details" && imageSize === "1K" && (
          <div className="mt-3 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-bold leading-4 text-amber-700">
            详情页有标题、标签和局部细节，1K 容易小字糊；推荐 2K 起步，质检和可读性会明显更好。
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-100/80 bg-white/45 p-4">
        <h3 className="mb-3 text-sm font-black text-slate-950">生成档位</h3>
        <div className="grid grid-cols-2 gap-2">
          {(["standard", "advanced"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onQualityChange(value)}
              className={`h-10 rounded-xl border px-3 text-xs font-bold transition-colors ${
                qualityMode === value
                  ? "border-zinc-2000 bg-[rgba(5,5,5,0.04)] text-[var(--codex-accent)]"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              {value === "standard" ? "标准模式" : "高级模式"}
            </button>
          ))}
        </div>
        <div className="mt-3 rounded-2xl border border-zinc-200 bg-[rgba(5,5,5,0.04)] px-3 py-3">
          <p className="text-xs font-black text-[var(--codex-accent)]">比例按模板自动</p>
          <p className="mt-1 text-[11px] leading-4 text-[var(--codex-accent)]">首屏海报、细节图、白底主图会分别使用各自模板比例，避免整套图被一个比例误导。</p>
        </div>
      </div>
    </section>
  );
}

function SettingsModal({
  settings,
  onSettingChange,
  onClose,
}: {
  settings: ProductSetSettings;
  onSettingChange: <K extends keyof ProductSetSettings>(key: K, value: ProductSetSettings[K]) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-xl">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[32px] bg-white shadow-[0_30px_120px_rgba(15,23,42,0.28)]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black text-slate-950">更多设置</h2>
            <p className="mt-1 text-xs text-slate-400">用于控制目标市场、图片文案和视觉风格；模型、比例与清晰度在左侧单独配置。</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <div className="space-y-6">
            <OptionGrid title="目标销售国家/地区" options={PRODUCT_SET_COUNTRIES} value={settings.country} onChange={(value) => onSettingChange("country", value)} />
            <OptionGrid title="图片文案语言" options={PRODUCT_SET_LANGUAGES} value={settings.language} onChange={(value) => onSettingChange("language", value)} />
            <OptionGrid title="目标平台" options={PRODUCT_SET_PLATFORMS} value={settings.platform} onChange={(value) => onSettingChange("platform", value)} />
            <div>
              <p className="mb-2 text-xs font-bold text-slate-700">主题色</p>
              <div className="grid grid-cols-2 items-stretch gap-2">
                {([
                  ["auto", "智能主题色"],
                  ["custom", "自定义颜色"],
                ] as [ProductSetThemeMode, string][]).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onSettingChange("themeMode", value)}
                    className={`flex h-11 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-black transition ${settings.themeMode === value ? "border-zinc-200 bg-[rgba(5,5,5,0.04)] text-[var(--codex-accent)]" : "border-slate-200 bg-slate-50 text-slate-500"}`}
                  >
                    <Palette className="h-4 w-4" /> {label}
                  </button>
                ))}
              </div>
              {settings.themeMode === "custom" && (
                <input
                  value={settings.themeColor}
                  onChange={(event) => onSettingChange("themeColor", event.target.value.slice(0, 80))}
                  placeholder="例如：奶油白 + 牛仔蓝 + 玫瑰粉"
                  className="mt-2 h-10 w-full rounded-xl border border-slate-100 bg-slate-50 px-3 text-xs outline-none focus:border-zinc-900"
                />
              )}
            </div>
            <div>
              <p className="mb-2 text-xs font-bold text-slate-700">字体风格</p>
              <div className="grid grid-cols-2 items-stretch gap-2 md:grid-cols-3">
                {(Object.keys(PRODUCT_SET_FONT_STYLE_LABELS) as ProductSetFontStyle[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onSettingChange("fontStyle", value)}
                    className={`h-10 rounded-xl border px-3 text-xs font-bold transition ${settings.fontStyle === value ? "border-zinc-200 bg-[rgba(5,5,5,0.04)] text-[var(--codex-accent)]" : "border-slate-200 bg-slate-50 text-slate-500"}`}
                  >
                    {PRODUCT_SET_FONT_STYLE_LABELS[value]}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              value={settings.extraDescription || ""}
              onChange={(event) => onSettingChange("extraDescription", event.target.value.slice(0, 600))}
              placeholder="额外描述：例如女装要偏法式通勤、不要夸张姿势、文案短句风格等。"
              className="min-h-28 w-full resize-none rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 text-sm leading-6 outline-none focus:border-zinc-900"
            />
          </div>
        </div>
        <div className="flex justify-end border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose} className="h-11 rounded-full bg-slate-950 px-8 text-sm font-black text-white">确认</button>
        </div>
      </div>
    </div>
  );
}

function TemplateLibraryModal({
  imageType,
  genCount,
  templates,
  selectedTemplateIds,
  activeCustomTemplates,
  filter,
  query,
  customDraft,
  showCustomBuilder,
  isUploadingCustomRef,
  customRefInputRef,
  customModelRefInputRef,
  customOtherRefInputRef,
  onFilterChange,
  onQueryChange,
  onToggleTemplate,
  onClose,
  onShowCustomBuilder,
  onCustomDraftChange,
  onUploadCustomReference,
  onAddCustomTemplate,
  onRemoveCustomTemplate,
}: {
  imageType: ProductSetImageType;
  genCount: number;
  templates: ProductSetTemplate[];
  selectedTemplateIds: number[];
  activeCustomTemplates: ProductSetCustomTemplate[];
  mode: ProductSetCreationMode;
  filter: TemplateFilter;
  query: string;
  customDraft: CustomDraft;
  showCustomBuilder: boolean;
  isUploadingCustomRef: boolean;
  customRefInputRef: React.RefObject<HTMLInputElement | null>;
  customModelRefInputRef: React.RefObject<HTMLInputElement | null>;
  customOtherRefInputRef: React.RefObject<HTMLInputElement | null>;
  onFilterChange: (value: TemplateFilter) => void;
  onQueryChange: (value: string) => void;
  onToggleTemplate: (id: number) => void;
  onClose: () => void;
  onShowCustomBuilder: (value: boolean) => void;
  onCustomDraftChange: (updater: (value: CustomDraft) => CustomDraft) => void;
  onUploadCustomReference: (kind: "style" | "model" | "other", file?: File) => void;
  onAddCustomTemplate: () => void;
  onRemoveCustomTemplate: (id: string) => void;
}) {
  const visibleTemplates = templates.filter((template) => {
    if (filter === "selected" && !selectedTemplateIds.includes(template.id)) return false;
    if (filter === "womenswear" && template.scenario !== "womenswear") return false;
    if (query.trim()) {
      const keyword = query.trim().toLowerCase();
      return `${template.name} ${template.typeDescriptionV2}`.toLowerCase().includes(keyword);
    }
    return true;
  });

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-xl">
      <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-[32px] bg-white shadow-[0_30px_120px_rgba(15,23,42,0.28)]">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black text-slate-950">参考模板库</h2>
            <p className="mt-1 text-xs text-slate-400">模板只控制用途、版式和视觉方向，最终商品会以你上传的图片为准。</p>
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
              <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索模板" className="h-10 w-40 rounded-full border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs outline-none focus:border-zinc-900 sm:w-52" />
            </div>
            <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-h-0 overflow-y-auto p-5">
            <div className="mb-4 flex flex-wrap gap-2">
              {([
                ["all", imageType === "details" ? "全部详情页模板" : "全部主图模板"],
                ["womenswear", "女装场景"],
                ["selected", `已选 ${selectedTemplateIds.length}`],
              ] as [TemplateFilter, string][]).map(([value, label]) => (
                <button key={value} type="button" onClick={() => onFilterChange(value)} className={`h-9 rounded-full px-3 text-xs font-black transition ${filter === value ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visibleTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  selected={selectedTemplateIds.includes(template.id)}
                  onToggle={() => onToggleTemplate(template.id)}
                />
              ))}
            </div>
          </div>
          <aside className="min-h-0 overflow-y-auto border-t border-slate-100 bg-slate-50 p-5 lg:border-l lg:border-t-0">
            <button
              type="button"
              onClick={() => onShowCustomBuilder(!showCustomBuilder)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-200 bg-white px-3 py-3 text-xs font-black text-[var(--codex-accent)] hover:bg-[rgba(5,5,5,0.06)]"
            >
              <Plus className="h-4 w-4" /> 上传参考图
            </button>

            {showCustomBuilder && (
              <div className="mt-3 space-y-3 rounded-2xl border border-slate-100 bg-white p-3">
                <div>
                  <p className="text-xs font-black text-slate-800">上传自己的参考</p>
                  <p className="mt-1 text-[11px] leading-4 text-slate-400">不需要写复杂规则，上传参考图后选择参考重点即可。</p>
                </div>
                <ReferenceQuickStart
                  imageType={imageType}
                  genCount={genCount}
                  customDraft={customDraft}
                  isUploadingCustomRef={isUploadingCustomRef}
                  customRefInputRef={customRefInputRef}
                  customModelRefInputRef={customModelRefInputRef}
                  customOtherRefInputRef={customOtherRefInputRef}
                  onCustomDraftChange={onCustomDraftChange}
                  onUploadCustomReference={onUploadCustomReference}
                  onAddCustomTemplate={onAddCustomTemplate}
                />
              </div>
            )}

            <div className="mt-5">
              <h3 className="text-xs font-black text-slate-700">自定义样式</h3>
              {activeCustomTemplates.length ? (
                <div className="mt-2 space-y-2">
                  {activeCustomTemplates.map((template) => (
                    <div key={template.id} className="flex min-h-10 items-center justify-between gap-2 rounded-2xl bg-white px-3 py-2 text-xs">
                      <span className="min-w-0 truncate font-bold text-slate-700">{template.name}</span>
                      <button type="button" onClick={() => onRemoveCustomTemplate(template.id)} className="text-slate-400 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 rounded-2xl bg-white px-3 py-4 text-xs leading-5 text-slate-400">可上传自己的参考模板图，配合文字描述生成专属套图风格。</p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function getAspectRatioLabel(value: string) {
  return value === "auto" ? "智能" : value;
}

function TemplateCard({ template, selected, onToggle }: { template: ProductSetTemplate; selected: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`group flex h-full flex-col overflow-hidden rounded-3xl border bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl ${
        selected ? "border-zinc-200 ring-2 ring-zinc-200" : "border-slate-100"
      }`}
    >
      <div className="relative aspect-[4/3] shrink-0 bg-slate-100">
        <RawPreviewImage src={getImageVariantUrl(template.coverImage, "card")} alt={template.name} className="h-full w-full object-cover" />
        <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2 py-1 text-[10px] font-black text-slate-600 shadow-sm">
          {getAspectRatioLabel(template.aspectRatio)}
        </span>
        <span className={`absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full shadow-sm ${selected ? "bg-[rgba(5,5,5,0.04)] text-white" : "bg-white/90 text-slate-400"}`}>
          {selected ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </span>
        {template.scenario === "womenswear" && <span className="absolute bottom-3 left-3 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600">女装</span>}
      </div>
      <div className="flex min-h-[126px] flex-1 flex-col p-3">
        <div className="flex min-h-6 items-start justify-between gap-2">
          <h3 className="min-w-0 line-clamp-1 text-sm font-black text-slate-900">{template.name}</h3>
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
            {template.imageType === "main" ? "主图" : "详情"}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{template.typeDescriptionV2}</p>
        <div className="mt-auto flex items-center gap-2 pt-3 text-[10px] font-bold text-slate-400">
          <Layers3 className="h-3.5 w-3.5" />
          {template.subjectConsistency ? "主体一致" : "版式独立"}
          <ChevronRight className="ml-auto h-3.5 w-3.5" />
        </div>
      </div>
    </button>
  );
}

function ToggleButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-10 items-center justify-between rounded-xl border px-3 text-xs font-black transition ${active ? "border-zinc-200 bg-[rgba(5,5,5,0.04)] text-[var(--codex-accent)]" : "border-slate-100 bg-slate-50 text-slate-500"}`}
    >
      <span className="min-w-0 truncate pr-2">{label}</span>
      <span className={`h-4 w-7 shrink-0 rounded-full p-0.5 transition ${active ? "bg-[rgba(5,5,5,0.04)]" : "bg-slate-300"}`}>
        <span className={`block h-3 w-3 rounded-full bg-white transition ${active ? "translate-x-3" : ""}`} />
      </span>
    </button>
  );
}

function ReferenceUploadButton({ label, hint, url, loading, onClick }: { label: string; hint?: string; url?: string; loading: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-[60px] w-full items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-2 py-2 text-left text-xs font-bold text-slate-600 hover:hover:border-zinc-300 hover:bg-[rgba(5,5,5,0.06)]">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg ${url ? "studio-checkerboard" : "bg-white"}`}>
        {url ? <RawPreviewImage src={getImageVariantUrl(url, "thumb")} alt={label} className="h-full w-full object-contain p-0.5" /> : loading ? <Loader2 className="h-4 w-4 animate-spin text-[var(--codex-accent)]" /> : <Upload className="h-4 w-4 text-slate-400" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        <span className="mt-0.5 block text-[10px] font-semibold text-slate-400">{url ? "已上传，可替换" : (hint || "上传 / 拖拽图片")}</span>
      </span>
    </button>
  );
}

function OptionGrid({ title, options, value, onChange }: { title: string; options: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <p className="mb-2 text-xs font-bold text-slate-700">{title}</p>
      <div className="grid grid-cols-2 items-stretch gap-2 md:grid-cols-4">
        {options.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onChange(item)}
            className={`h-10 truncate rounded-xl border px-3 text-xs font-bold transition ${
              value === item ? "border-zinc-200 bg-[rgba(5,5,5,0.04)] text-[var(--codex-accent)]" : "border-slate-200 bg-slate-50 text-slate-500 hover:hover:border-zinc-300"
            }`}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function formatSavedPlanMeta(plan: SavedProductSetPlan) {
  const modeLabel = plan.mode === "custom" ? "自定义方案" : "视觉方案";
  const imageTypeLabel = plan.imageType === "details" ? "详情页" : "主图";
  const unit = plan.imageType === "details" ? "屏" : "张";
  const count = plan.planPreview.length || plan.genCount;
  return `${modeLabel} · ${imageTypeLabel} · ${count}${unit}`;
}

function formatSavedPlanTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
