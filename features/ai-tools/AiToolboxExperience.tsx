"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ImageIcon,
  Lock,
  LockOpen,
  RefreshCw,
  Settings2,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { ModuleHeader } from "@/components/ModuleHeader";
import { PreviewGuide } from "@/components/PreviewGuide";
import { MultiImageUploadV2 } from "@/components/studio/MultiImageUploadV2";
import { AspectRatioSelector } from "@/components/studio/AspectRatioSelector";
import { ErrorStage } from "@/components/studio/ErrorStage";
import { GenerationCountField } from "@/components/studio/GenerationCountField";
import { LoadingStage } from "@/components/studio/LoadingStage";
import { PromptTextarea } from "@/components/studio/PromptTextarea";
import { RawPreviewImage } from "@/components/studio/RawPreviewImage";
import { ResolutionSelector } from "@/components/studio/ResolutionSelector";
import { StudioChoiceGroup } from "@/components/studio/StudioChoiceGroup";
import { StudioControlPanel } from "@/components/studio/StudioControlPanel";
import { StudioBatchDownloadButton, StudioSingleDownloadButton } from "@/components/studio/StudioMediaDownloadButton";
import { StudioMediaLightbox } from "@/components/studio/StudioMediaLightbox";
import { StudioModelSelector } from "@/components/studio/StudioModelSelector";
import { ModuleTaskRail } from "@/components/studio/ModuleTaskRail";
import { StudioPageShell } from "@/components/studio/StudioPageShell";
import { StudioResultViewport, type StudioResultStatus } from "@/components/studio/StudioResultViewport";
import { StudioRunBar } from "@/components/studio/StudioRunBar";
import { StudioSection } from "@/components/studio/StudioSection";
import { StudioUploadSection } from "@/components/studio/StudioUploadSection";
import { StudioUploadTile } from "@/components/studio/StudioUploadTile";
import { useStudioAuth } from "@/components/studio/useStudioAuth";
import type { TaskSelectionSession } from "@/components/studio/useTaskSelectionSession";
import {
  createImageEditorSession,
  exportImageEditorMask,
  exportImageEditorOperationMask,
  hasImageEditorToolStrokes,
  hasVisibleMaskContent,
  STUDIO_EDITOR_MAX_EDGE,
  STUDIO_EDITOR_MAX_PIXELS,
  type StudioImageDimensions,
  type StudioImageEditorSession,
} from "@/components/studio/image-editor/StudioImageEditor";
import { StudioMaskEditorDialog } from "@/components/studio/image-editor/StudioMaskEditorDialog";
import {
  StudioFrameEditor,
  type StudioFrameTransform,
} from "@/components/studio/image-editor/StudioFrameEditor";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { assetUrls, useResourcePicker } from "@/features/resource-library";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { MAX_FILE_SIZE, MAX_FILE_SIZE_MB, uploadImage } from "@/lib/utils";
import { DEFAULT_LINGYA_MODEL, getCreditCost, type LingyaModel } from "@/lib/api/lingya";
import { useStudioImageModelOptions } from "@/lib/studio-models";
import { isAiToolGenerativeModel, type AiToolOutput } from "@/lib/ai-tools/types";
import type { TaskQueueItem } from "@/lib/task-queue";
import {
  dimensionsForAiToolAspect,
  dimensionsForAiToolOutpaintAspect,
  resolveAiToolOutpaintSourceScale,
  getAiToolTargetDimensionError,
  isAiToolReferenceFresh,
  isAiToolBatchCancelled,
  requestJsonWithRateLimitRetry,
  throwIfAiToolBatchCancelled,
  waitForAiToolBatchDelay,
} from "./ai-tool-execution";
import type { AiToolUiConfig } from "./tool-ui-config";
import { assetInputProof, assetReferenceProof, getUploadOwnershipProof } from "./asset-input-proofs";
import styles from "./ai-tools.module.css";

type SourceAsset = {
  id: string;
  name: string;
  previewUrl: string;
  remoteUrl: string | null;
  width: number | null;
  height: number | null;
  assetId: string | null;
  registrationToken: string | null;
  originalFile: File | null;
  status: "uploading" | "ready" | "error";
  error?: string;
};

type CapabilityState = {
  status: "loading" | "live" | "mock" | "disabled" | "error";
  label: string;
  reason?: string;
};

type ToolResponse = {
  task_id?: string;
  request_id?: string;
  status?: string;
  stage?: string;
  progress?: number;
  result_urls?: string[];
  outputs?: AiToolOutput[];
  execution_mode?: string;
  provider?: string;
  error?: string | { code?: string; message?: string; retryable?: boolean } | null;
  task_error?: { code?: string; message?: string; retryable?: boolean } | null;
  message?: string;
  mask?: {
    url?: string;
    ref?: string;
    width?: number;
    height?: number;
    content_type?: string;
    expires_at?: string;
  };
  task_context?: {
    operation?: string;
    source_url?: string;
    source_asset_id?: string | null;
    source_width?: number | null;
    source_height?: number | null;
  };
};

type ToolResult = {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  primary: AiToolOutput;
  outputs: AiToolOutput[];
};

type SelectionBase = {
  foreground: AiToolOutput;
  alpha: AiToolOutput;
};

type MaskReference = {
  url: string;
  expiresAt: string;
};

const ACCEPTED_IMAGES = ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";
const ASPECT_OPTIONS = [
  { value: "2:3" },
  { value: "3:4" },
  { value: "9:16" },
  { value: "1:1" },
  { value: "3:2" },
  { value: "4:3" },
  { value: "16:9" },
  { value: "custom", label: "自定义" },
] as const;

const DIMENSION_MODE_OPTIONS = [
  { value: "original", label: "原图比例" },
  { value: "free", label: "自由比例" },
  { value: "platform", label: "预设尺寸" },
] as const;

const PLATFORM_SIZE_OPTIONS = [
  { value: "taobao", label: "淘宝 / 天猫", width: 1024, height: 1024 },
  { value: "jd", label: "京东", width: 1024, height: 1024 },
  { value: "douyin", label: "抖音小店", width: 1024, height: 1024 },
  { value: "tiktok", label: "TikTok Shop", width: 1024, height: 1024 },
  { value: "amazon", label: "亚马逊", width: 1600, height: 1600 },
  { value: "ebay", label: "eBay", width: 1600, height: 1600 },
  { value: "temu", label: "Temu", width: 1200, height: 1200 },
  { value: "shopify", label: "Shopify", width: 2048, height: 2048 },
  { value: "shein", label: "SHEIN", width: 1340, height: 1785 },
  { value: "aliexpress", label: "速卖通", width: 1200, height: 1200 },
  { value: "shopee", label: "Shopee", width: 1080, height: 1080 },
  { value: "lazada", label: "Lazada", width: 1080, height: 1080 },
] as const;

const MATTING_PREVIEW_BACKGROUNDS = [
  { value: "transparent", label: "透明" },
  { value: "#ffffff", label: "白色" },
  { value: "#d8d8d8", label: "浅灰" },
  { value: "#595b5b", label: "深灰" },
] as const;

export function AiToolboxExperience({ config }: { config: AiToolUiConfig }) {
  const { openResourcePicker } = useResourcePicker();
  const { authChecked, isAuthenticated, refreshAuth } = useStudioAuth();
  const modelOptions = useStudioImageModelOptions().filter((option) => isAiToolGenerativeModel(option.value));
  const inputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const sourceAssetsRef = useRef<SourceAsset[]>([]);
  const referenceAssetRef = useRef<SourceAsset | null>(null);
  const batchAbortControllerRef = useRef<AbortController | null>(null);
  const selectionAbortControllerRef = useRef<AbortController | null>(null);
  const sourceUploadInFlightRef = useRef(false);
  const referenceUploadInFlightRef = useRef(false);
  const inputMutationLockedRef = useRef(false);
  const automaticSelectionStartedRef = useRef(new Set<string>());
  const taskRestoreControllerRef = useRef<AbortController | null>(null);
  const restoredTaskIdRef = useRef<string | null>(null);

  const [sources, setSources] = useState<SourceAsset[]>([]);
  const [reference, setReference] = useState<SourceAsset | null>(null);
  const [referenceEditorOpen, setReferenceEditorOpen] = useState(false);
  const [referenceEditorSession, setReferenceEditorSession] = useState(() => createImageEditorSession());
  const [referenceDimensions, setReferenceDimensions] = useState<StudioImageDimensions | null>(null);
  const [referenceMaskReference, setReferenceMaskReference] = useState<MaskReference | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isReferenceDragging, setIsReferenceDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isReferenceUploading, setIsReferenceUploading] = useState(false);
  const [mode, setMode] = useState(config.defaultMode);
  const [aspectRatio, setAspectRatio] = useState("auto");
  const [dimensionMode, setDimensionMode] = useState<"original" | "free" | "platform">("original");
  const [dimensionsLocked, setDimensionsLocked] = useState(false);
  const [platformSize, setPlatformSize] = useState("taobao");
  const [targetWidth, setTargetWidth] = useState(800);
  const [targetHeight, setTargetHeight] = useState(800);
  const [outputCount, setOutputCount] = useState(config.defaultOutputCount ?? 1);
  const [aiModel, setAiModel] = useState<LingyaModel>(DEFAULT_LINGYA_MODEL);
  const [referenceMode, setReferenceMode] = useState(config.defaultReferenceMode ?? "flat");
  const [upscale, setUpscale] = useState<"2x" | "4x">("2x");
  const [limbTarget, setLimbTarget] = useState<"hands" | "feet" | "both">("both");
  const [mattingPreviewBackground, setMattingPreviewBackground] = useState("transparent");
  const [isMattingComparing, setIsMattingComparing] = useState(false);
  const [isUpscaleComparing, setIsUpscaleComparing] = useState(false);
  const [resizeBackground, setResizeBackground] = useState("#ffffff");
  const [instruction, setInstruction] = useState("");
  const [editorSessions, setEditorSessions] = useState<Record<string, StudioImageEditorSession>>({});
  const [maskEditorSourceId, setMaskEditorSourceId] = useState<string | null>(null);
  const [mattingEditorSessions, setMattingEditorSessions] = useState<Record<string, StudioImageEditorSession>>({});
  const [mattingRefineResultId, setMattingRefineResultId] = useState<string | null>(null);
  const [sourceDimensions, setSourceDimensions] = useState<Record<string, StudioImageDimensions>>({});
  const [cropPositions, setCropPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [frameTransforms, setFrameTransforms] = useState<Record<string, StudioFrameTransform>>({});
  const [frameDetailOpen, setFrameDetailOpen] = useState(false);
  const [maskRemoteUrls, setMaskRemoteUrls] = useState<Record<string, MaskReference>>({});
  const [selectionBases, setSelectionBases] = useState<Record<string, SelectionBase>>({});
  const [activeSelectionAction, setActiveSelectionAction] = useState<"smart" | "auto" | null>(null);
  const [isMaskSaving, setIsMaskSaving] = useState(false);
  const [capability, setCapability] = useState<CapabilityState>({ status: "loading", label: "正在检查服务" });
  const [selectionCapability, setSelectionCapability] = useState<CapabilityState>({ status: "loading", label: "正在检查自动选区" });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [serverProgress, setServerProgress] = useState<number | null>(null);
  const [stageText, setStageText] = useState("");
  const [results, setResults] = useState<ToolResult[]>([]);
  const [resultIndex, setResultIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [partialError, setPartialError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  inputMutationLockedRef.current = isGenerating || isBatchRunning;
  sourceAssetsRef.current = sources;
  referenceAssetRef.current = reference;
  const selectedSourceIndex = Math.max(0, sources.findIndex((source) => source.id === selectedSourceId));
  const selectedSource = sources[selectedSourceIndex] ?? null;
  const maskEditorSource = sources.find((source) => source.id === maskEditorSourceId) || null;
  const selectedSourceDimensions = selectedSource
    ? sourceDimensions[selectedSource.id]
      || (selectedSource.width && selectedSource.height
        ? { width: selectedSource.width, height: selectedSource.height }
        : null)
    : null;
  const isFrameTargetReady = targetWidth > 0 && targetHeight > 0;
  const isUpscale4xUnavailable = config.slug === "upscale" && sources.some((source) => (
    Boolean(source.width && source.width > 1280)
    || Boolean(source.height && source.height > 1280)
  ));
  const resultUrls = results.map((result) => result.primary.url);
  const resolvedReferenceTitle = config.slug === "clothing-repair" && mode === "detail"
    ? "参考细节图"
    : config.referenceTitle || "参考商品图";
  const resolvedReferenceDescription = config.slug === "clothing-repair" && mode === "detail"
    ? "可修复 Logo、印花、拉链、纽扣等细节瑕疵；请标记需要参考的局部区域。"
    : config.referenceDescription;
  const requiresReferenceMask = shouldRequireReferenceMask(config.slug, mode, referenceMode);
  const usesGenerativeModel = config.operation === "outpaint"
    || config.operation === "erase"
    || config.operation === "repair-limbs"
    || config.operation === "repair-garment"
    || config.operation === "repair-footwear";
  const estimatedCredits = usesGenerativeModel
    ? getCreditCost(aiModel, "2K") * Math.max(1, sources.length) * (config.showGenerationCount ? outputCount : 1)
    : 0;
  const isDirty = Boolean(sources.length || reference || instruction.trim() || results.length);
  const { unsavedDialog } = useUnsavedChangesGuard(isDirty);

  useEffect(() => () => {
    batchAbortControllerRef.current?.abort();
    selectionAbortControllerRef.current?.abort();
    taskRestoreControllerRef.current?.abort();
    for (const asset of sourceAssetsRef.current) revokePreview(asset.previewUrl);
    if (referenceAssetRef.current) revokePreview(referenceAssetRef.current.previewUrl);
  }, []);

  useEffect(() => {
    if (!sources.length) {
      if (selectedSourceId) setSelectedSourceId(null);
      return;
    }
    if (!selectedSourceId || !sources.some((source) => source.id === selectedSourceId)) {
      setSelectedSourceId(sources[0].id);
    }
  }, [selectedSourceId, sources]);

  useEffect(() => {
    if (maskEditorSourceId && !sources.some((source) => source.id === maskEditorSourceId)) {
      setMaskEditorSourceId(null);
    }
  }, [maskEditorSourceId, sources]);

  useEffect(() => {
    setFrameDetailOpen(false);
  }, [config.slug, selectedSourceId]);

  useEffect(() => {
    setFrameTransforms({});
    setCropPositions({});
    setFrameDetailOpen(false);
  }, [targetHeight, targetWidth]);

  useEffect(() => {
    if ((config.slug !== "outpaint" && config.slug !== "resize") || aspectRatio !== "auto") return;
    const active = sources.find((source) => source.id === selectedSourceId) || sources[0];
    if (!active?.width || !active.height) return;
    const next = dimensionsForAiToolOutpaintAspect("auto", active.width, active.height);
    setTargetWidth(next.width);
    setTargetHeight(next.height);
  }, [aspectRatio, config.slug, selectedSourceId, sources]);

  useEffect(() => {
    if (isUpscale4xUnavailable && upscale === "4x") setUpscale("2x");
  }, [isUpscale4xUnavailable, upscale]);

  useEffect(() => {
    if (mattingRefineResultId && !results.some((result) => result.id === mattingRefineResultId)) {
      setMattingRefineResultId(null);
    }
  }, [mattingRefineResultId, results]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ai-tools/capabilities", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(readError(payload, "能力清单加载失败"));
        return payload;
      })
      .then((payload) => {
        setCapability(parseCapability(payload, config.operation, config.providerLabel));
        setSelectionCapability(parseCapability(payload, "matting", "阿里云分割"));
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        const unavailable = {
          status: "error",
          label: "服务状态未知",
          reason: cause instanceof Error ? cause.message : "暂时无法读取服务状态",
        } as const;
        setCapability(unavailable);
        setSelectionCapability(unavailable);
      });
    return () => controller.abort();
  }, [config.operation, config.providerLabel]);

  const handleEditorSessionChange = useCallback((sourceId: string, session: StudioImageEditorSession) => {
    setEditorSessions((current) => ({ ...current, [sourceId]: session }));
    setMaskRemoteUrls((current) => {
      const next = { ...current };
      delete next[sourceId];
      return next;
    });
  }, []);

  const handleSourceDimensions = useCallback((sourceId: string, dimensions: StudioImageDimensions) => {
    setSourceDimensions((current) => {
      const existing = current[sourceId];
      if (existing?.width === dimensions.width && existing.height === dimensions.height) return current;
      return { ...current, [sourceId]: dimensions };
    });
  }, []);

  const resetReferenceSelection = useCallback(() => {
    setReferenceEditorOpen(false);
    setReferenceEditorSession(createImageEditorSession());
    setReferenceDimensions(null);
    setReferenceMaskReference(null);
  }, []);

  const addLocalFiles = async (files: File[]) => {
    if (inputMutationLockedRef.current) {
      toast.info("当前任务正在处理，完成或取消后再修改输入");
      return;
    }
    if (sourceUploadInFlightRef.current) {
      toast.info("当前批次正在上传，请稍候再添加图片");
      return;
    }
    const remaining = Math.max(0, config.maxImages - sourceAssetsRef.current.length);
    const validFiles = validateFiles(files, remaining);
    if (!validFiles.length) return;
    sourceUploadInFlightRef.current = true;
    const nextAssets = validFiles.map(createLocalAsset);
    const reservedSources = [...sourceAssetsRef.current, ...nextAssets].slice(0, config.maxImages);
    sourceAssetsRef.current = reservedSources;
    setSources(reservedSources);
    setSelectedSourceId(nextAssets[0].id);
    setResults([]);
    setError(null);
    setIsUploading(true);

    const uploads = await settleWithConcurrency(nextAssets.map((asset, index) => async () => {
      const upload = await uploadImage(validFiles[index]);
      const proof = getUploadOwnershipProof(upload);
      if (!proof.assetId && !proof.registrationToken) {
        throw new Error("图片已上传，但未取得安全使用凭证，请重试");
      }
      return {
        asset,
        remoteUrl: upload.url,
        width: upload.width > 0 ? upload.width : null,
        height: upload.height > 0 ? upload.height : null,
        ...proof,
      };
    }), 3);
    uploads.forEach((upload, index) => {
      if (upload.status === "fulfilled") revokePreview(nextAssets[index].previewUrl);
    });
    setSourceDimensions((current) => {
      const next = { ...current };
      uploads.forEach((upload) => {
        if (upload.status !== "fulfilled" || !upload.value.width || !upload.value.height) return;
        next[upload.value.asset.id] = { width: upload.value.width, height: upload.value.height };
      });
      return next;
    });
    setSources((current) => current.map((asset) => {
      const index = nextAssets.findIndex((item) => item.id === asset.id);
      if (index === -1) return asset;
      const upload = uploads[index];
      return upload.status === "fulfilled"
        ? {
          ...asset,
          previewUrl: upload.value.remoteUrl,
          remoteUrl: upload.value.remoteUrl,
          width: upload.value.width,
          height: upload.value.height,
          assetId: upload.value.assetId,
          registrationToken: upload.value.registrationToken,
          originalFile: null,
          status: "ready",
        }
        : { ...asset, status: "error", error: errorMessage(upload.reason, "上传失败") };
    }));
    if (config.requiresMask) {
      const firstReady = uploads.find((upload) => upload.status === "fulfilled");
      if (firstReady?.status === "fulfilled") setMaskEditorSourceId(firstReady.value.asset.id);
    }
    setIsUploading(false);
    sourceUploadInFlightRef.current = false;

    const failures = uploads.filter((item) => item.status === "rejected").length;
    if (failures) toast.error(`${failures} 张图片上传失败，请移除后重试`);
    else toast.success(`${nextAssets.length} 张图片已上传`);
  };

  const retryFailedSourceUploads = async () => {
    if (inputMutationLockedRef.current) return;
    if (sourceUploadInFlightRef.current) return;
    const failedAssets = sourceAssetsRef.current.filter((asset) => asset.status === "error" && asset.originalFile);
    if (!failedAssets.length) return;
    sourceUploadInFlightRef.current = true;
    setIsUploading(true);
    setSources((current) => current.map((asset) => failedAssets.some((failed) => failed.id === asset.id)
      ? { ...asset, status: "uploading", error: undefined }
      : asset));
    try {
      const uploads = await settleWithConcurrency(failedAssets.map((asset) => async () => {
        const upload = await uploadImage(asset.originalFile!);
        const proof = getUploadOwnershipProof(upload);
        if (!proof.assetId && !proof.registrationToken) {
          throw new Error("图片已上传，但未取得安全使用凭证，请重试");
        }
        return {
          asset,
          remoteUrl: upload.url,
          width: upload.width > 0 ? upload.width : null,
          height: upload.height > 0 ? upload.height : null,
          ...proof,
        };
      }), 3);
      setSourceDimensions((current) => {
        const next = { ...current };
        for (const upload of uploads) {
          if (upload.status === "fulfilled" && upload.value.width && upload.value.height) {
            next[upload.value.asset.id] = { width: upload.value.width, height: upload.value.height };
          }
        }
        return next;
      });
      setSources((current) => current.map((asset) => {
        const index = failedAssets.findIndex((item) => item.id === asset.id);
        if (index < 0) return asset;
        const upload = uploads[index];
        if (upload.status === "rejected") {
          return { ...asset, status: "error", error: errorMessage(upload.reason, "上传失败") };
        }
        revokePreview(asset.previewUrl);
        return {
          ...asset,
          previewUrl: upload.value.remoteUrl,
          remoteUrl: upload.value.remoteUrl,
          width: upload.value.width,
          height: upload.value.height,
          assetId: upload.value.assetId,
          registrationToken: upload.value.registrationToken,
          originalFile: null,
          status: "ready",
          error: undefined,
        };
      }));
      const firstReady = uploads.find((upload) => upload.status === "fulfilled");
      if (config.requiresMask && firstReady?.status === "fulfilled") {
        setMaskEditorSourceId(firstReady.value.asset.id);
      }
      const failures = uploads.filter((upload) => upload.status === "rejected").length;
      if (failures) toast.error(`${failures} 张图片重试失败`);
      else toast.success(`${uploads.length} 张图片已重新上传`);
    } finally {
      sourceUploadInFlightRef.current = false;
      setIsUploading(false);
    }
  };

  const addReferenceFile = async (files: File[]) => {
    if (inputMutationLockedRef.current) {
      toast.info("当前任务正在处理，完成或取消后再修改参考图");
      return;
    }
    if (referenceUploadInFlightRef.current) {
      toast.info("参考图正在上传，请稍候");
      return;
    }
    const [file] = validateFiles(files, 1);
    if (!file) return;
    referenceUploadInFlightRef.current = true;
    if (reference) revokePreview(reference.previewUrl);
    resetReferenceSelection();
    const asset = createLocalAsset(file);
    setReference(asset);
    setIsReferenceUploading(true);
    setResults([]);
    try {
      const upload = await uploadImage(file);
      const proof = getUploadOwnershipProof(upload);
      if (!proof.assetId && !proof.registrationToken) {
        throw new Error("参考图已上传，但未取得安全使用凭证，请重试");
      }
      revokePreview(asset.previewUrl);
      setReference((current) => current?.id === asset.id
        ? {
          ...current,
          previewUrl: upload.url,
          remoteUrl: upload.url,
          width: upload.width > 0 ? upload.width : null,
          height: upload.height > 0 ? upload.height : null,
          assetId: proof.assetId,
          registrationToken: proof.registrationToken,
          originalFile: null,
          status: "ready",
        }
        : current);
      if (requiresReferenceMask) setReferenceEditorOpen(true);
    } catch (cause) {
      setReference((current) => current?.id === asset.id
        ? { ...current, status: "error", error: errorMessage(cause, "参考图上传失败") }
        : current);
      toast.error(errorMessage(cause, "参考图上传失败"));
    } finally {
      setIsReferenceUploading(false);
      referenceUploadInFlightRef.current = false;
    }
  };

  const addSourcesFromLibrary = async () => {
    if (inputMutationLockedRef.current) {
      toast.info("当前任务正在处理，完成或取消后再修改输入");
      return;
    }
    const selected = await openResourcePicker({
      title: config.uploadTitle,
      role: "source",
      selectionMode: config.maxImages === 1 ? "single" : "multiple",
      maxCount: config.maxImages,
      existingCount: sources.length,
      excludedUrls: sources.map((source) => source.remoteUrl || source.previewUrl),
      mediaTypes: ["image"],
      moduleKey: "toolbox",
    });
    if (inputMutationLockedRef.current) {
      toast.info("任务已开始，本次资源选择未应用");
      return;
    }
    const urls = assetUrls(selected);
    if (!urls.length) return;
    const mapped = (selected || []).map((asset) => ({
      id: `resource-${asset.id}`,
      name: asset.title || asset.originalFilename || "资源图片",
      previewUrl: asset.previewUrl || asset.url,
      remoteUrl: asset.url,
      width: asset.width,
      height: asset.height,
      assetId: asset.id,
      registrationToken: null,
      originalFile: null,
      status: "ready" as const,
    }));
    setSources((current) => [...current, ...mapped].slice(0, config.maxImages));
    setSelectedSourceId(mapped[0].id);
    if (config.requiresMask) setMaskEditorSourceId(mapped[0].id);
    setResults([]);
  };

  const addReferenceFromLibrary = async () => {
    if (inputMutationLockedRef.current) {
      toast.info("当前任务正在处理，完成或取消后再修改参考图");
      return;
    }
    const selected = await openResourcePicker({
      title: config.referenceTitle || "参考商品图",
      role: "reference",
      selectionMode: "single",
      maxCount: 1,
      mediaTypes: ["image"],
      moduleKey: "toolbox",
    });
    if (inputMutationLockedRef.current) {
      toast.info("任务已开始，本次参考图选择未应用");
      return;
    }
    const [asset] = selected || [];
    if (!asset) return;
    if (reference) revokePreview(reference.previewUrl);
    resetReferenceSelection();
    setReference({
      id: `resource-${asset.id}`,
      name: asset.title || asset.originalFilename || "参考商品图",
      previewUrl: asset.previewUrl || asset.url,
      remoteUrl: asset.url,
      width: asset.width,
      height: asset.height,
      assetId: asset.id,
      registrationToken: null,
      originalFile: null,
      status: "ready",
    });
    if (requiresReferenceMask) setReferenceEditorOpen(true);
    setResults([]);
  };

  const removeSource = (index: number) => {
    const target = sources[index];
    if (!target) return;
    revokePreview(target.previewUrl);
    const nextSources = sources.filter((_, itemIndex) => itemIndex !== index);
    setSources(nextSources);
    if (selectedSourceId === target.id) {
      setSelectedSourceId(nextSources[Math.min(index, Math.max(0, nextSources.length - 1))]?.id || null);
    }
    if (maskEditorSourceId === target.id) setMaskEditorSourceId(null);
    setEditorSessions((current) => {
      const next = { ...current };
      delete next[target.id];
      return next;
    });
    setSourceDimensions((current) => {
      const next = { ...current };
      delete next[target.id];
      return next;
    });
    setCropPositions((current) => {
      const next = { ...current };
      delete next[target.id];
      return next;
    });
    setFrameTransforms((current) => {
      const next = { ...current };
      delete next[target.id];
      return next;
    });
    setSelectionBases((current) => {
      const next = { ...current };
      delete next[target.id];
      return next;
    });
    setMaskRemoteUrls((current) => {
      const next = { ...current };
      delete next[target.id];
      return next;
    });
    setResults([]);
  };

  const clearSources = () => {
    selectionAbortControllerRef.current?.abort();
    selectionAbortControllerRef.current = null;
    for (const source of sources) revokePreview(source.previewUrl);
    setSources([]);
    setEditorSessions({});
    setSourceDimensions({});
    setCropPositions({});
    setFrameTransforms({});
    setFrameDetailOpen(false);
    setMaskRemoteUrls({});
    setSelectionBases({});
    setSelectedSourceId(null);
    setMaskEditorSourceId(null);
    setResults([]);
    setError(null);
  };

  const resetTask = () => {
    taskRestoreControllerRef.current?.abort();
    taskRestoreControllerRef.current = null;
    restoredTaskIdRef.current = null;
    removeAiToolTaskFromLocation();
    clearSources();
    if (reference) revokePreview(reference.previewUrl);
    setReference(null);
    resetReferenceSelection();
    setMode(config.defaultMode);
    setAspectRatio("auto");
    setDimensionMode("original");
    setDimensionsLocked(false);
    setPlatformSize("taobao");
    setTargetWidth(800);
    setTargetHeight(800);
    setOutputCount(config.defaultOutputCount ?? 1);
    setReferenceMode(config.defaultReferenceMode ?? "flat");
    setLimbTarget("both");
    setResizeBackground("#ffffff");
    setMattingPreviewBackground("transparent");
    setIsMattingComparing(false);
    setIsUpscaleComparing(false);
    setInstruction("");
    setResults([]);
    setPartialError(null);
  };

  const restoreAiToolTask = useCallback(async (
    taskId: string,
    signal: AbortSignal,
    isCurrent: () => boolean,
    fallbackSourceUrl?: string,
  ) => {
    if (!taskId) return false;
    setError(null);
    setPartialError(null);
    setIsGenerating(true);
    setStageText("正在恢复 AI 工具任务");
    try {
      const first = await requestJsonWithRateLimitRetry<ToolResponse>(
        (requestSignal) => fetch(`/api/ai-tools?task_id=${encodeURIComponent(taskId)}`, {
          cache: "no-store",
          signal: requestSignal,
        }),
        {
          signal,
          onRateLimit: (seconds) => setStageText(`状态服务繁忙，${seconds} 秒后继续恢复`),
        },
      );
      if (!first.response.ok) {
        throw new Error(readToolResponseError(first.data, `读取任务失败 (${first.response.status})`));
      }
      let data = first.data;
      if (data.status === "queued" || data.status === "processing") {
        data = await pollToolTask(taskId, signal, (state) => {
          if (!isCurrent()) return;
          if (typeof state.progress === "number") setServerProgress(state.progress);
          if (state.stage) setStageText(stageLabel(state.stage));
        }, (seconds) => {
          if (isCurrent()) setStageText(`状态服务繁忙，${seconds} 秒后继续检查`);
        });
      }
      if (data.status === "failed") throw new Error(readToolResponseError(data, "图片处理失败"));
      if (!isCurrent()) return true;

      const context = data.task_context;
      if (context?.operation && context.operation !== config.operation) {
        throw new Error("任务类型与当前工具不匹配");
      }
      const sourceUrl = context?.source_url || fallbackSourceUrl;
      if (!sourceUrl) throw new Error("任务缺少可恢复的原图信息");
      const width = positiveIntegerOrNull(context?.source_width);
      const height = positiveIntegerOrNull(context?.source_height);
      const source: SourceAsset = {
        id: `history-${taskId}`,
        name: `${config.title}原图`,
        previewUrl: sourceUrl,
        remoteUrl: sourceUrl,
        width,
        height,
        assetId: context?.source_asset_id || null,
        registrationToken: null,
        originalFile: null,
        status: "ready",
      };
      const restoredResults = extractToolResults(data, source, 1);
      if (!restoredResults.length) throw new Error("任务尚未返回可展示结果");

      setSources([source]);
      setSelectedSourceId(source.id);
      if (width && height) setSourceDimensions({ [source.id]: { width, height } });
      else setSourceDimensions({});
      setResults(restoredResults);
      setResultIndex(0);
      setError(null);
      setPartialError(null);
      restoredTaskIdRef.current = taskId;
      replaceAiToolTaskInLocation(taskId);
      return true;
    } catch (cause) {
      if (signal.aborted || !isCurrent()) return true;
      const message = errorMessage(cause, "任务恢复失败");
      setError(message);
      setPartialError(null);
      return true;
    } finally {
      if (isCurrent()) {
        setIsGenerating(false);
        setServerProgress(null);
        setStageText("");
      }
    }
  }, [config.operation, config.title]);

  const handleTaskRailSelect = useCallback((item: TaskQueueItem, session: TaskSelectionSession) => {
    const taskId = getAiToolTaskId(item.applyUrl);
    if (!taskId) return false;
    return restoreAiToolTask(taskId, session.signal, session.isCurrent, item.inputThumbnails[0]);
  }, [restoreAiToolTask]);

  useEffect(() => {
    const taskId = getAiToolTaskId(typeof window === "undefined" ? "" : window.location.href);
    if (!taskId || restoredTaskIdRef.current === taskId) return;
    const controller = new AbortController();
    taskRestoreControllerRef.current?.abort();
    taskRestoreControllerRef.current = controller;
    void restoreAiToolTask(taskId, controller.signal, () => !controller.signal.aborted);
    return () => controller.abort();
  }, [restoreAiToolTask]);

  const runDisabledReason = getRunDisabledReason({
    authChecked,
    isAuthenticated,
    sources,
    reference,
    editorSessions,
    sourceDimensions,
    maskRemoteUrls,
    selectionBases,
    referenceEditorSession,
    referenceDimensions,
    referenceMaskReference,
    requiresReferenceMask,
    config,
    capability,
    targetWidth,
    targetHeight,
    upscale,
    isUploading: isUploading || isReferenceUploading || isMaskSaving,
  });

  const handleAutomaticSelection = useCallback(async (
    action: "smart" | "auto" | "add" | "subtract",
    draftSession: StudioImageEditorSession,
  ) => {
    if ((action !== "smart" && action !== "auto") || !maskEditorSource?.remoteUrl) return draftSession;
    const controller = new AbortController();
    selectionAbortControllerRef.current?.abort();
    selectionAbortControllerRef.current = controller;
    setActiveSelectionAction(action);
    try {
      const submission = await submitAiToolRequest({
        request_id: createRequestId("matting-selection", 1),
        operation: "matting",
        source_url: maskEditorSource.remoteUrl,
        ...assetInputProof(maskEditorSource, "source"),
        reference_urls: [],
        options: {
          subject: action === "smart" ? "clothing" : "auto",
          background: "transparent",
          edge_refinement: "fine",
          output_format: "png",
        },
      }, controller.signal, (seconds) => {
        toast.info(`自动选区服务繁忙，${seconds} 秒后继续`);
      });
      let { data } = submission;
      if (!submission.response.ok) {
        throw new Error(readToolResponseError(data, "自动选区失败"));
      }
      if (data.status === "queued" || data.status === "processing") {
        if (!data.task_id) throw new Error("自动选区服务未返回任务标识");
        data = await pollToolTask(data.task_id, controller.signal, () => undefined, () => undefined);
      }
      const foreground = data.outputs?.find((output) => output.role === "result");
      const alpha = data.outputs?.find((output) => output.role === "alpha")
        || data.outputs?.find((output) => output.role === "mask");
      if (!foreground || !alpha) throw new Error("自动选区服务未返回完整蒙版");
      setSelectionBases((current) => ({
        ...current,
        [maskEditorSource.id]: { foreground, alpha },
      }));
      setMaskRemoteUrls((current) => {
        const next = { ...current };
        delete next[maskEditorSource.id];
        return next;
      });
      toast.success("自动选区已生成，可继续手动调整");
      return draftSession;
    } catch (cause) {
      if (controller.signal.aborted) return draftSession;
      toast.error(errorMessage(cause, "自动选区失败"));
      return draftSession;
    } finally {
      if (selectionAbortControllerRef.current === controller) selectionAbortControllerRef.current = null;
      setActiveSelectionAction(null);
    }
  }, [maskEditorSource]);

  useEffect(() => {
    if (config.slug !== "clothing-repair"
      || selectionCapability.status !== "live" && selectionCapability.status !== "mock"
      || !maskEditorSource
      || maskEditorSource.status !== "ready"
      || selectionBases[maskEditorSource.id]
      || automaticSelectionStartedRef.current.has(maskEditorSource.id)) return;
    automaticSelectionStartedRef.current.add(maskEditorSource.id);
    const session = editorSessions[maskEditorSource.id] || createImageEditorSession();
    void handleAutomaticSelection("smart", session);
  }, [
    config.slug,
    editorSessions,
    handleAutomaticSelection,
    maskEditorSource,
    selectionBases,
    selectionCapability.status,
  ]);

  const handleConfirmMaskEditor = async (session: StudioImageEditorSession) => {
    if (!maskEditorSource?.remoteUrl) return;
    const sourceUrl = maskEditorSource.remoteUrl;
    const dimensions = sourceDimensions[maskEditorSource.id]
      || (maskEditorSource.width && maskEditorSource.height
        ? { width: maskEditorSource.width, height: maskEditorSource.height }
        : null);
    const selectionBase = selectionBases[maskEditorSource.id];
    if (!selectionBase) {
      handleEditorSessionChange(maskEditorSource.id, session);
      setMaskEditorSourceId(null);
      return;
    }
    if (!dimensions) {
      toast.error("自动选区尺寸尚未准备完成");
      return;
    }

    setIsMaskSaving(true);
    try {
      let currentBase = selectionBase.alpha;
      let latest: ToolResponse | null = null;
      const operations = ([
        ["brush", "add"],
        ["eraser", "subtract"],
      ] as const).filter(([tool]) => hasImageEditorToolStrokes(session.present, tool));
      if (!operations.length) {
        latest = await submitMattingCompose({
          request_id: createRequestId("selection-compose", 1),
          source_url: sourceUrl,
          ...assetInputProof(maskEditorSource, "source"),
          base_mask_url: currentBase.url,
          base_mask_kind: currentBase.role === "alpha" ? "alpha" : "mask",
        });
      } else {
        for (let index = 0; index < operations.length; index += 1) {
          const [tool, operation] = operations[index];
          const maskFile = await exportImageEditorOperationMask(
            session.present,
            tool,
            dimensions,
            maskEditorSource.name,
          );
          const editMask = await uploadAiToolMask(maskFile, dimensions);
          latest = await submitMattingCompose({
            request_id: createRequestId("selection-compose", index + 1),
            source_url: sourceUrl,
            ...assetInputProof(maskEditorSource, "source"),
            base_mask_url: currentBase.url,
            base_mask_kind: currentBase.role === "alpha" ? "alpha" : "mask",
            edit_mask_url: editMask.url,
            edit_operation: operation,
          });
          const nextBase = latest.outputs?.find((output) => output.role === "alpha")
            || latest.outputs?.find((output) => output.role === "mask");
          if (!nextBase) throw new Error("选区合成服务未返回透明度蒙版");
          currentBase = nextBase;
        }
      }
      const maskReference = readMaskReference(latest);
      if (!maskReference) throw new Error("选区合成服务未返回安全蒙版引用");
      const latestForeground = latest?.outputs?.find((output) => output.role === "result");
      const latestAlpha = latest?.outputs?.find((output) => output.role === "alpha")
        || latest?.outputs?.find((output) => output.role === "mask");
      setEditorSessions((current) => ({ ...current, [maskEditorSource.id]: session }));
      setMaskRemoteUrls((current) => ({ ...current, [maskEditorSource.id]: maskReference }));
      if (latestForeground && latestAlpha) {
        setSelectionBases((current) => ({
          ...current,
          [maskEditorSource.id]: { foreground: latestForeground, alpha: latestAlpha },
        }));
      }
      setMaskEditorSourceId(null);
      toast.success("选区已保存");
    } catch (cause) {
      toast.error(errorMessage(cause, "选区保存失败"));
    } finally {
      setIsMaskSaving(false);
    }
  };

  const handleRun = async () => {
    if (runDisabledReason) {
      if (authChecked && !isAuthenticated) {
        const refreshed = await refreshAuth();
        if (!refreshed) toast.error("请先登录后再使用 AI 工具箱");
      } else toast.info(runDisabledReason);
      return;
    }

    const controller = new AbortController();
    batchAbortControllerRef.current?.abort();
    batchAbortControllerRef.current = controller;
    setIsGenerating(true);
    setIsBatchRunning(true);
    setError(null);
    setPartialError(null);
    setResults([]);
    setServerProgress(null);
    const completed: ToolResult[] = [];
    const failures: string[] = [];

    try {
      let referenceMaskUrl = isAiToolReferenceFresh(referenceMaskReference || undefined)
        ? referenceMaskReference?.url
        : undefined;
      if (requiresReferenceMask && !referenceMaskUrl) {
        if (!reference || !referenceDimensions) {
          throw new Error("参考图选区尚未准备完成");
        }
        const maskFile = await exportImageEditorMask(
          referenceEditorSession.present,
          referenceDimensions,
          reference.name,
        );
        throwIfAiToolBatchCancelled(controller.signal);
        const uploadedReferenceMask = await uploadAiToolMask(
          maskFile,
          referenceDimensions,
          controller.signal,
          (seconds) => setStageText(`参考图蒙版上传服务繁忙，${seconds} 秒后自动继续`),
        );
        referenceMaskUrl = uploadedReferenceMask.url;
        setReferenceMaskReference(uploadedReferenceMask);
      }
      const variantsPerSource = config.showGenerationCount ? outputCount : 1;
      const totalTasks = sources.length * variantsPerSource;
      let taskNumber = 0;
      for (let index = 0; index < sources.length; index += 1) {
        throwIfAiToolBatchCancelled(controller.signal);
        const source = sources[index];
        if (!source.remoteUrl) continue;
        const cachedMask = maskRemoteUrls[source.id];
        let maskUrl = isAiToolReferenceFresh(cachedMask) ? cachedMask.url : undefined;
        const editorSession = editorSessions[source.id];
        const dimensions = sourceDimensions[source.id]
          || (source.width && source.height ? { width: source.width, height: source.height } : null);
        try {
          if (config.requiresMask && !maskUrl) {
            const selectionBase = selectionBases[source.id];
            if (selectionBase) {
              const refreshed = await submitMattingCompose({
                request_id: createRequestId("selection-refresh", index + 1),
                source_url: source.remoteUrl,
                ...assetInputProof(source, "source"),
                base_mask_url: selectionBase.alpha.url,
                base_mask_kind: selectionBase.alpha.role === "alpha" ? "alpha" : "mask",
              });
              const refreshedMask = readMaskReference(refreshed);
              const refreshedForeground = refreshed.outputs?.find((output) => output.role === "result");
              const refreshedAlpha = refreshed.outputs?.find((output) => output.role === "alpha")
                || refreshed.outputs?.find((output) => output.role === "mask");
              if (!refreshedMask || !refreshedForeground || !refreshedAlpha) {
                throw new Error("自动选区引用刷新失败，请重新编辑选区");
              }
              maskUrl = refreshedMask.url;
              setMaskRemoteUrls((current) => ({ ...current, [source.id]: refreshedMask }));
              setSelectionBases((current) => ({
                ...current,
                [source.id]: { foreground: refreshedForeground, alpha: refreshedAlpha },
              }));
            } else {
              if (!editorSession || !dimensions) throw new Error("编辑蒙版尚未准备完成");
              const maskFile = await exportImageEditorMask(editorSession.present, dimensions, source.name);
              throwIfAiToolBatchCancelled(controller.signal);
              const upload = await uploadAiToolMask(maskFile, dimensions, controller.signal, (seconds) => {
                setStageText(`蒙版上传服务繁忙，${seconds} 秒后自动继续`);
              });
              maskUrl = upload.url;
              setMaskRemoteUrls((current) => ({ ...current, [source.id]: upload }));
            }
          }
        } catch (cause) {
          if (isAiToolBatchCancelled(cause, controller.signal)) throw cause;
          failures.push(`${source.name}：${errorMessage(cause, "蒙版准备失败")}`);
          setPartialError(`${completed.length} 个结果已完成，${failures.length} 个失败。${failures[0]}`);
          continue;
        }

        for (let variant = 0; variant < variantsPerSource; variant += 1) {
          throwIfAiToolBatchCancelled(controller.signal);
          taskNumber += 1;
          setStageText(totalTasks > 1 ? `正在处理第 ${taskNumber} / ${totalTasks} 个任务` : "正在提交处理任务");
          try {
            const submission = await submitAiToolRequest({
              request_id: createRequestId(config.operation, taskNumber),
              operation: config.operation,
              source_url: source.remoteUrl,
              ...assetInputProof(source, "source"),
            mask_url: maskUrl,
              reference_urls: reference?.remoteUrl ? [reference.remoteUrl] : [],
              ...(referenceMaskUrl ? { reference_mask_url: referenceMaskUrl } : {}),
              ...(reference ? assetReferenceProof(reference) : {}),
              options: buildToolOptions({
                config,
                mode,
                targetWidth,
                targetHeight,
                cropPosition: cropPositions[source.id] || { x: 0.5, y: 0.5 },
                frameTransform: frameTransforms[source.id],
                sourceDimensions: dimensions || undefined,
                resizeBackground,
                upscale,
                instruction,
                referenceMode,
                limbTarget,
                aiModel,
              }),
            }, controller.signal, (seconds) => {
              setStageText(`服务繁忙，${seconds} 秒后自动继续第 ${taskNumber} / ${totalTasks} 个任务`);
            });
            const { response } = submission;
            let { data } = submission;
            if (!response.ok) throw new Error(readToolResponseError(data, `处理请求失败 (${response.status})`));
            if (typeof data.progress === "number") setServerProgress(data.progress);
            if (data.stage) setStageText(stageLabel(data.stage));
            if (data.status === "queued" || data.status === "processing") {
              if (!data.task_id) throw new Error("服务未返回任务标识");
              data = await pollToolTask(data.task_id, controller.signal, (state) => {
                if (typeof state.progress === "number") setServerProgress(state.progress);
                if (state.stage) setStageText(stageLabel(state.stage));
              }, (seconds) => {
                setStageText(`状态服务繁忙，${seconds} 秒后继续检查第 ${taskNumber} / ${totalTasks} 个任务`);
              });
            }
            const taskResults = extractToolResults(data, source, taskNumber);
            if (!taskResults.length) throw new Error(readToolResponseError(data, "服务未返回处理结果"));
            completed.push(...taskResults);
            setResults([...completed]);
            setResultIndex(0);
          } catch (cause) {
            if (isAiToolBatchCancelled(cause, controller.signal)) throw cause;
            const suffix = variantsPerSource > 1 ? `（结果 ${variant + 1}）` : "";
            failures.push(`${source.name}${suffix}：${errorMessage(cause, "处理失败")}`);
            setPartialError(`${completed.length} 个结果已完成，${failures.length} 个失败。${failures[0]}`);
          }
        }
      }

      setResults(completed);
      setResultIndex(0);
      if (failures.length && completed.length) {
        const summary = `${completed.length} 个结果已完成，${failures.length} 个失败`;
        setPartialError(`${summary}。${failures[0]}`);
        toast.warning(summary);
      } else if (failures.length) {
        throw new Error(failures[0]);
      } else {
        toast.success(`${config.title}处理完成`);
      }
    } catch (cause) {
      if (isAiToolBatchCancelled(cause, controller.signal)) {
        const message = completed.length
          ? `批量处理已取消，已保留 ${completed.length} 个完成结果`
          : "批量处理已取消";
        setResults([...completed]);
        setPartialError(message);
        setError(null);
        toast.info(message);
      } else if (completed.length) {
        setResults([...completed]);
        setPartialError(`${completed.length} 个结果已完成；后续任务中断：${errorMessage(cause, "处理失败")}`);
      } else {
        setError(errorMessage(cause, `${config.title}处理失败`));
      }
    } finally {
      if (batchAbortControllerRef.current === controller) batchAbortControllerRef.current = null;
      setIsBatchRunning(false);
      setIsGenerating(false);
      setServerProgress(null);
      setStageText("");
    }
  };

  const handleCancelBatch = () => {
    if (!batchAbortControllerRef.current) return;
    setStageText("正在取消后续任务，已完成结果会保留");
    batchAbortControllerRef.current.abort();
  };

  const handleApplyMattingRefinement = async (confirmedSession?: StudioImageEditorSession) => {
    const result = results.find((item) => item.id === mattingRefineResultId);
    const base = result?.outputs.find((output) => output.role === "alpha")
      || result?.outputs.find((output) => output.role === "mask");
    const session = confirmedSession || (result ? mattingEditorSessions[result.id] : null);
    const source = result ? sources.find((item) => item.id === result.sourceId) : null;
    const dimensions = result
      ? sourceDimensions[result.sourceId]
        || (source?.width && source.height ? { width: source.width, height: source.height } : null)
        || base?.dimensions
        || result.primary.dimensions
      : null;
    if (!result || !base || !session || !source || !dimensions) {
      toast.error("抠图细化数据尚未准备完成");
      return;
    }
    const operations = ([
      ["brush", "add"],
      ["eraser", "subtract"],
    ] as const).filter(([tool]) => hasImageEditorToolStrokes(session.present, tool));
    if (!operations.length) {
      toast.info("请先用绿色补回或红色移除需要修正的边缘");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setStageText("正在合成全分辨率抠图");
    try {
      let currentBase = base;
      let latestOutputs = result.outputs;
      for (let index = 0; index < operations.length; index += 1) {
        const [tool, operation] = operations[index];
        setStageText(operations.length > 1
          ? `正在应用边缘调整 ${index + 1} / ${operations.length}`
          : "正在应用边缘调整");
        const maskFile = await exportImageEditorOperationMask(
          session.present,
          tool,
          dimensions,
          result.sourceName,
        );
        const editMask = await uploadAiToolMask(maskFile, dimensions);
        const composed = await submitMattingCompose({
          request_id: createRequestId("matting-compose", index + 1),
          source_url: result.sourceUrl,
          base_mask_url: currentBase.url,
          base_mask_kind: currentBase.role === "alpha" ? "alpha" : "mask",
          edit_mask_url: editMask.url,
          edit_operation: operation,
          ...assetInputProof(source, "source"),
        });
        const nextPrimary = composed.outputs?.find((output) => output.role === "result");
        const nextBase = composed.outputs?.find((output) => output.role === "alpha");
        if (!nextPrimary || !nextBase) throw new Error("边缘合成服务未返回完整结果");
        latestOutputs = composed.outputs || [];
        currentBase = nextBase;
      }
      const primary = latestOutputs.find((output) => output.role === "result");
      if (!primary) throw new Error("边缘合成服务未返回抠图结果");
      setResults((current) => current.map((item) => item.id === result.id
        ? { ...item, primary, outputs: latestOutputs }
        : item));
      setMattingEditorSessions((current) => ({
        ...current,
        [result.id]: createImageEditorSession(),
      }));
      setMattingRefineResultId(null);
      toast.success("抠图边缘已更新");
    } catch (cause) {
      const message = errorMessage(cause, "抠图边缘细化失败");
      setPartialError(message);
      toast.error(message);
    } finally {
      setIsGenerating(false);
      setStageText("");
    }
  };

  const resultStatus: StudioResultStatus = error && !resultUrls.length
    ? "error"
    : resultUrls.length
      ? "results"
      : isGenerating
        ? "loading"
        : sources.length
        ? "results"
        : "empty";

  const activePreviewUrls = resultUrls.length ? resultUrls : sources.map((source) => source.previewUrl);
  const activePreviewIndex = Math.min(resultUrls.length ? resultIndex : selectedSourceIndex, Math.max(0, activePreviewUrls.length - 1));
  const activePreviewUrl = activePreviewUrls[activePreviewIndex] || "";
  const activeResult = resultUrls.length ? results[activePreviewIndex] || null : null;
  const activeMattingBase = activeResult?.outputs.find((output) => output.role === "alpha")
    || activeResult?.outputs.find((output) => output.role === "mask")
    || null;
  const activeResultSource = activeResult
    ? sources.find((source) => source.id === activeResult.sourceId) || null
    : null;
  const activeResultDimensions = activeResult
    ? sourceDimensions[activeResult.sourceId]
      || (activeResultSource?.width && activeResultSource.height
        ? { width: activeResultSource.width, height: activeResultSource.height }
        : activeMattingBase?.dimensions || activeResult.primary.dimensions)
    : null;
  const displayedPreviewUrl = activeResult && (
    (config.slug === "matting" && isMattingComparing)
    || (config.slug === "upscale" && isUpscaleComparing)
  ) ? activeResult.sourceUrl : activePreviewUrl;

  return (
    <>
      <StudioPageShell
        activeFeature={config.featureKey}
        className={styles.toolboxShell}
        taskRail={(
          <ModuleTaskRail
            module="toolbox"
            taskScope={config.operation}
            moduleLabel={config.title}
            onContinue={resetTask}
            onCompletedTask={handleTaskRailSelect}
          />
        )}
        header={(
          <ModuleHeader
            title={config.title}
            tooltip={config.tooltip}
            actions={(
              <div className="flex items-center gap-2">
                <span className={styles.providerBadge}>{config.providerLabel}</span>
                <Button type="button" size="sm" variant="outline" onClick={resetTask} disabled={!isDirty || isGenerating}>
                  <RefreshCw aria-hidden="true" />新建任务
                </Button>
              </div>
            )}
          />
        )}
        controlPanel={(
          <StudioControlPanel>
            <StudioUploadSection
              title={config.uploadTitle}
              inputRef={inputRef}
              multiple={config.maxImages > 1}
              accept={ACCEPTED_IMAGES}
              disabled={isGenerating || isBatchRunning}
              isDragging={isDragging}
              setDragging={setIsDragging}
              onFiles={addLocalFiles}
            >
              {(openFileDialog) => (
                <div className="space-y-3">
                  <MultiImageUploadV2
                  urls={sources.map((source) => source.previewUrl)}
                  maxCount={config.maxImages}
                  title={config.uploadTitle}
                  emptyHint={config.uploadHint}
                  loading={isUploading}
                  disabled={isGenerating}
                  isDragging={isDragging}
                  showExamples={false}
                  summary={sources.length ? `${sources.length} 张图片 · ${sources.filter((source) => source.status === "ready").length} 张已就绪` : undefined}
                  imageRequirement={config.uploadRequirement}
                  tips={[
                    { label: "图片要求", text: config.uploadRequirement },
                    { label: "处理方式", text: config.shortDescription },
                  ]}
                  tipsAction={config.requiresMask && selectedSource?.status === "ready" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setMaskEditorSourceId(selectedSource.id)}
                      disabled={isGenerating}
                    >
                      <Settings2 aria-hidden="true" />编辑选区
                    </Button>
                  ) : undefined}
                  onUploadClick={openFileDialog}
                  onLibraryClick={addSourcesFromLibrary}
                  onPreview={(_, index) => setSelectedSourceId(sources[index]?.id || null)}
                  onRemove={(_, index) => removeSource(index)}
                  onMove={(fromIndex, toIndex) => setSources((current) => moveItem(current, fromIndex, toIndex))}
                  onClear={clearSources}
                  />
                  {sources.some((source) => source.status === "error") ? (
                    <div className={styles.capabilityNotice} role="alert">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        {sources.filter((source) => source.status === "error").length} 张上传失败：
                        {sources.find((source) => source.status === "error")?.error || "请重试"}
                      </span>
                      <Button type="button" size="sm" variant="outline" disabled={isUploading} onClick={() => { void retryFailedSourceUploads(); }}>
                        重试失败项
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </StudioUploadSection>

            {config.requiresReference ? (
              <StudioUploadSection
                title={resolvedReferenceTitle}
                inputRef={referenceInputRef}
                accept={ACCEPTED_IMAGES}
                disabled={isGenerating || isBatchRunning}
                isDragging={isReferenceDragging}
                setDragging={setIsReferenceDragging}
                onFiles={addReferenceFile}
              >
                {(openFileDialog, dragContext) => (
                  <div className="space-y-3">
                    {config.referenceModeOptions?.length
                      && !(config.slug === "clothing-repair" && mode === "detail") ? (
                      <StudioChoiceGroup
                        options={config.referenceModeOptions}
                        value={referenceMode}
                        onChange={(value) => {
                          if (value !== referenceMode && reference) {
                            revokePreview(reference.previewUrl);
                            setReference(null);
                            resetReferenceSelection();
                          }
                          setReferenceMode(value);
                          setResults([]);
                        }}
                        variant="segmented"
                        columns={2}
                        ariaLabel={config.referenceModeTitle || "参考图类型"}
                        descriptionMode="wrap"
                      />
                    ) : null}
                    <StudioUploadTile
                      title={resolvedReferenceTitle}
                      description={resolvedReferenceDescription}
                      imageUrl={reference?.previewUrl}
                      fileName={reference?.name}
                      imageAlt={resolvedReferenceTitle}
                      loading={isReferenceUploading}
                      disabled={isGenerating}
                      isDragging={isReferenceDragging}
                      onUploadClick={openFileDialog}
                      onLibraryClick={addReferenceFromLibrary}
                      onPreview={() => reference && setLightbox({ src: reference.previewUrl, alt: reference.name })}
                      onRemove={() => {
                        if (reference) revokePreview(reference.previewUrl);
                        setReference(null);
                        resetReferenceSelection();
                        setResults([]);
                      }}
                      onDropFile={(file) => file && addReferenceFile([file])}
                      dragContext={dragContext}
                      tips={[{ label: "参考角色", text: resolvedReferenceDescription || "用于锁定真实商品细节" }]}
                      actions={reference?.status === "ready" && requiresReferenceMask ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setReferenceEditorOpen(true)}
                          disabled={isGenerating || isBatchRunning}
                        >
                          <Settings2 aria-hidden="true" />编辑选区
                        </Button>
                      ) : undefined}
                    />
                    {reference?.status === "error" ? (
                      <div className={styles.capabilityNotice} role="alert">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 flex-1">{reference.error || "参考图上传失败"}</span>
                        {reference.originalFile ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isReferenceUploading}
                            onClick={() => { void addReferenceFile([reference.originalFile!]); }}
                          >
                            重新上传
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )}
              </StudioUploadSection>
            ) : null}

            {config.modeOptions?.length ? (
              <StudioSection
                title={config.modeTitle || "处理模式"}
                description={config.modeDescription}
                icon={<Settings2 className="h-4 w-4" />}
              >
                <StudioChoiceGroup
                  options={config.modeOptions}
                  value={mode}
                  onChange={(value) => {
                    if (config.slug === "clothing-repair" && value !== mode && reference) {
                      revokePreview(reference.previewUrl);
                      setReference(null);
                      resetReferenceSelection();
                    }
                    setMode(value);
                    setResults([]);
                  }}
                  variant="segmented"
                  columns={config.modeOptions.length <= 4 ? Math.max(2, config.modeOptions.length) as 2 | 3 | 4 : "auto"}
                  ariaLabel={config.modeTitle || "处理模式"}
                  descriptionMode="wrap"
                />
              </StudioSection>
            ) : null}

            {config.slug === "upscale" ? (
              <StudioSection title="生成配置" description="2× 更稳定，4× 适合小尺寸原图。" icon={<Sparkles className="h-4 w-4" />}>
                <ResolutionSelector
                  title="放大倍数"
                  value={upscale}
                  onChange={setUpscale}
                  options={[
                    { value: "2x", label: "2倍放大" },
                    {
                      value: "4x",
                      label: "4倍放大",
                      description: "宽高均不超过 1280px",
                      disabled: isUpscale4xUnavailable,
                    },
                  ]}
                  ariaLabel="放大倍数"
                />
              </StudioSection>
            ) : null}

            {config.showAspectRatio ? (
              <StudioSection title="生成尺寸" description="选择预设比例，或输入精确画布宽高。" icon={<WandSparkles className="h-4 w-4" />}>
                <StudioChoiceGroup
                  options={DIMENSION_MODE_OPTIONS}
                  value={dimensionMode}
                  onChange={(value) => {
                    setDimensionMode(value);
                    if (value === "original") {
                      setAspectRatio("auto");
                      const source = selectedSourceDimensions;
                      if (source) {
                        const next = dimensionsForAiToolOutpaintAspect("auto", source.width, source.height);
                        setTargetWidth(next.width);
                        setTargetHeight(next.height);
                      }
                    } else if (value === "free") {
                      setAspectRatio("custom");
                    } else {
                      const preset = PLATFORM_SIZE_OPTIONS.find((item) => item.value === platformSize)
                        || PLATFORM_SIZE_OPTIONS[0];
                      setAspectRatio("custom");
                      setTargetWidth(preset.width);
                      setTargetHeight(preset.height);
                    }
                  }}
                  variant="segmented"
                  columns={3}
                  ariaLabel="尺寸模式"
                />
                {dimensionMode === "platform" ? (
                  <div className="mt-3">
                    <Select value={platformSize} onValueChange={(value) => {
                      const preset = PLATFORM_SIZE_OPTIONS.find((item) => item.value === value);
                      if (!preset) return;
                      setPlatformSize(value);
                      setTargetWidth(preset.width);
                      setTargetHeight(preset.height);
                    }}>
                      <SelectTrigger aria-label="平台尺寸">
                        <SelectValue placeholder="选择平台尺寸" />
                      </SelectTrigger>
                      <SelectContent>
                        {PLATFORM_SIZE_OPTIONS.map((preset) => (
                          <SelectItem key={preset.value} value={preset.value}>
                            {preset.label} · {preset.width} × {preset.height}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <AspectRatioSelector
                  className="mt-4"
                  title="画布比例"
                  options={ASPECT_OPTIONS}
                  value={aspectRatio}
                  onChange={(value) => {
                    setDimensionMode(value === "auto" ? "original" : "free");
                    setAspectRatio(value);
                    const outpaintMinimum = sources.reduce(
                      (minimum, source) => ({
                        width: Math.max(minimum.width, source.width || 0),
                        height: Math.max(minimum.height, source.height || 0),
                      }),
                      { width: 0, height: 0 },
                    );
                    const size = (config.slug === "outpaint" || config.slug === "resize")
                      && outpaintMinimum.width > 0 && outpaintMinimum.height > 0
                      ? dimensionsForAiToolOutpaintAspect(value, outpaintMinimum.width, outpaintMinimum.height)
                      : dimensionsForAiToolAspect(value, targetWidth, targetHeight);
                    setTargetWidth(size.width);
                    setTargetHeight(size.height);
                  }}
                  ariaLabel="目标画布比例"
                />
                {config.showDimensions ? (
                  <div className="mt-4">
                    <h3 className="studio-aspect-ratio-selector-title mb-2">
                      <span aria-hidden="true" className="studio-aspect-ratio-selector-title-mark" />
                      <span className="studio-aspect-ratio-selector-title-text">画布尺寸</span>
                    </h3>
                    <div className={`${styles.parameterGrid} ${styles.parameterGridWithLock}`}>
                      <label className={styles.dimensionField}>
                        <span>宽</span>
                        <span className={styles.dimensionInput}>
                          <input type="number" min="1" max="5120" step="1" value={targetWidth} onChange={(event) => {
                            const nextWidth = clampDimension(event.target.value);
                            const ratio = targetWidth > 0 ? targetHeight / targetWidth : 1;
                            setTargetWidth(nextWidth);
                            if (dimensionsLocked) setTargetHeight(clampDimension(String(nextWidth * ratio)));
                            setDimensionMode("free");
                            setAspectRatio("custom");
                          }} />
                          <em>px</em>
                        </span>
                      </label>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className={styles.dimensionLock}
                        aria-label={dimensionsLocked ? "解除宽高比例锁定" : "锁定当前宽高比例"}
                        aria-pressed={dimensionsLocked}
                        onClick={() => setDimensionsLocked((current) => !current)}
                      >
                        {dimensionsLocked ? <Lock aria-hidden="true" /> : <LockOpen aria-hidden="true" />}
                      </Button>
                      <label className={styles.dimensionField}>
                        <span>高</span>
                        <span className={styles.dimensionInput}>
                          <input type="number" min="1" max="5120" step="1" value={targetHeight} onChange={(event) => {
                            const nextHeight = clampDimension(event.target.value);
                            const ratio = targetHeight > 0 ? targetWidth / targetHeight : 1;
                            setTargetHeight(nextHeight);
                            if (dimensionsLocked) setTargetWidth(clampDimension(String(nextHeight * ratio)));
                            setDimensionMode("free");
                            setAspectRatio("custom");
                          }} />
                          <em>px</em>
                        </span>
                      </label>
                    </div>
                  </div>
                ) : null}
              </StudioSection>
            ) : null}

            {config.showGenerationCount ? (
              <GenerationCountField
                title="生成数量"
                label="每张参考图生成"
                value={outputCount}
                onChange={setOutputCount}
                counts={config.slug === "outpaint" ? [1, 2, 4, 6, 8] : [1, 2, 4]}
                summary={`共 ${Math.max(1, sources.length) * outputCount} 张`}
                unit="张"
                ariaLabel="每张参考图生成数量"
              />
            ) : null}

            {usesGenerativeModel ? (
              <StudioModelSelector
                models={modelOptions}
                value={aiModel}
                onChange={setAiModel}
                title="生成模型"
                ariaLabel="选择 AI 工具生成模型"
              />
            ) : null}

            {config.showPrompt ? (
              <PromptTextarea
                title="补充要求"
                badge="可选"
                description="仅描述需要修改的区域；未选区会保持原图像素。"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="例如：移除衣架并自然补全墙面纹理"
                rows={3}
                maxLength={600}
                showWordLibrary={false}
                showSaveAction={false}
                onClear={() => setInstruction("")}
                disabled={isGenerating}
              />
            ) : null}

            {capability.status === "disabled" || capability.status === "error" ? (
              <div className={styles.capabilityNotice} role="status">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span><strong>{capability.label}</strong><br />{capability.reason || "配置 Provider 后本页会自动启用，无需改前端。"}</span>
              </div>
            ) : null}
          </StudioControlPanel>
        )}
        runBar={(
          <StudioRunBar
            summary={(
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{sources.length} 张输入</span>
                {config.showGenerationCount ? <span>× {outputCount} 个结果</span> : null}
                {usesGenerativeModel ? <span>· 预计 {estimatedCredits} 灵点</span> : null}
                <span>· {capability.label}</span>
              </span>
            )}
            estimateLabel={config.estimate}
            disabled={Boolean(runDisabledReason) || isGenerating}
            disabledReason={runDisabledReason}
            primaryLabel={capability.status === "disabled" || capability.status === "error" ? "服务待配置" : config.primaryAction}
            isLoading={isGenerating}
            onPrimaryAction={handleRun}
            secondaryActions={isBatchRunning ? (
              <Button type="button" variant="outline" onClick={handleCancelBatch}>
                取消批量处理
              </Button>
            ) : undefined}
          />
        )}
        canvas={(
          <StudioResultViewport
            status={resultStatus}
            emptyState={(
              <div className="studio-empty-stage flex min-h-[320px] items-center justify-center px-4 py-6 lg:h-full">
                <PreviewGuide
                  title={config.shortDescription}
                  subtitle="上传图片后在这里预览、标记并检查处理结果"
                  icon={<ImageIcon className="h-9 w-9" />}
                  steps={[...config.guide]}
                />
              </div>
            )}
            loadingState={(
              <LoadingStage
                genCount={Math.max(1, sources.length * outputCount)}
                progress={serverProgress ?? 0}
                moduleName={config.title}
                statusText={stageText || "服务正在处理图片"}
                aspectRatio={aspectRatio}
                referenceImages={sources.slice(0, 4).map((source) => ({ url: source.previewUrl, label: source.name }))}
                estimatedTime={config.estimate}
              />
            )}
            errorState={(
              <ErrorStage
                error={error || `${config.title}处理失败`}
                onRetry={handleRun}
                isGenerating={isGenerating}
                retryDisabled={Boolean(runDisabledReason) || isGenerating}
                notice={capability.status === "disabled" ? capability.reason : undefined}
              />
            )}
            results={(
              (config.slug === "outpaint" || config.slug === "resize")
                && selectedSource
                && selectedSourceDimensions
                && !resultUrls.length ? (
                  selectedSource.status === "ready" && selectedSource.remoteUrl && isFrameTargetReady ? (
                    <div className="flex h-full min-h-0 flex-col gap-3">
                      {frameDetailOpen ? (
                        <div className="flex items-center justify-between gap-3 px-1">
                          <Button type="button" size="sm" variant="ghost" onClick={() => setFrameDetailOpen(false)}>
                            <ArrowLeft aria-hidden="true" />返回
                          </Button>
                          <div className="min-w-0 text-center">
                            <strong className="block text-sm text-slate-950">调整详情</strong>
                            <span className="block truncate text-xs text-slate-500">
                              {config.slug === "outpaint"
                                ? "可对图片、画布大小进行调整"
                                : "可对画布大小、比例进行调整，高亮区域为图片生成范围"}
                            </span>
                          </div>
                          <Button type="button" size="sm" onClick={() => setFrameDetailOpen(false)}>确认</Button>
                        </div>
                      ) : null}
                      <StudioFrameEditor
                        key={`${selectedSource.id}:${selectedSource.remoteUrl}:frame`}
                        sourceId={selectedSource.id}
                        sourceUrl={selectedSource.remoteUrl}
                        sourceName={selectedSource.name}
                        sourceDimensions={selectedSourceDimensions}
                        targetDimensions={{ width: targetWidth, height: targetHeight }}
                        editorMode={config.slug}
                        fitMode="cover"
                        anchor={config.slug === "outpaint" && (mode === "center" || mode === "top" || mode === "bottom" || mode === "left" || mode === "right") ? mode : "center"}
                        cropPosition={cropPositions[selectedSource.id] || { x: 0.5, y: 0.5 }}
                        transform={frameTransforms[selectedSource.id]}
                        view={frameDetailOpen ? "detail" : "preview"}
                        backgroundColor={resizeBackground}
                        disabled={isGenerating}
                        onRequestViewChange={(view) => setFrameDetailOpen(view === "detail")}
                        onTransformChange={(transform) => {
                          setFrameTransforms((current) => ({ ...current, [selectedSource.id]: transform }));
                          setResults([]);
                        }}
                        onCropPositionChange={(position) => {
                          setCropPositions((current) => ({ ...current, [selectedSource.id]: position }));
                          setResults([]);
                        }}
                      />
                    </div>
                  ) : (
                    <div className={styles.canonicalPending} role="status">
                      <RefreshCw className="h-5 w-5 animate-spin" aria-hidden="true" />
                      <strong>正在准备画布原图</strong>
                      <span>完成方向校正与尺寸确认后，即可预览画布和裁切位置。</span>
                    </div>
                  )
              ) : (
                <div className={styles.readyStage}>
                  <div className={styles.previewHeader}>
                    <strong>{resultUrls.length ? `${config.title}结果` : "原图预览"}</strong>
                    <span>{isBatchRunning && stageText
                      ? stageText
                      : activePreviewUrls.length > 1
                        ? `${activePreviewIndex + 1} / ${activePreviewUrls.length}`
                        : config.shortDescription}</span>
                  </div>
                  {partialError ? (
                    <div className={`${styles.capabilityNotice} mb-2`} role="status">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{partialError}</span>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className={styles.previewCanvas}
                    data-checkerboard={config.slug === "matting"
                      && resultUrls.length
                      && !isMattingComparing
                      && mattingPreviewBackground === "transparent" ? "true" : undefined}
                    style={config.slug === "matting"
                      && resultUrls.length
                      && !isMattingComparing
                      && mattingPreviewBackground !== "transparent"
                      ? { background: mattingPreviewBackground }
                      : undefined}
                    onClick={() => displayedPreviewUrl && setLightbox({ src: displayedPreviewUrl, alt: resultUrls.length ? `${config.title}结果` : "原图" })}
                    aria-label="放大预览图片"
                  >
                    {displayedPreviewUrl ? (
                      <RawPreviewImage src={displayedPreviewUrl} alt={resultUrls.length ? `${config.title}结果` : "原图"} eager className={styles.previewImage} />
                    ) : null}
                  </button>
                  {activePreviewUrls.length > 1 ? (
                    <div className={styles.thumbnailStrip} aria-label="图片列表">
                      {activePreviewUrls.map((url, index) => (
                        <button
                          key={`${url}-${index}`}
                          type="button"
                          className={styles.thumbnailButton}
                          data-active={activePreviewIndex === index ? "true" : undefined}
                          onClick={() => resultUrls.length
                            ? setResultIndex(index)
                            : setSelectedSourceId(sources[index]?.id || null)}
                          aria-label={`查看第 ${index + 1} 张图片`}
                        >
                          <RawPreviewImage src={url} alt="" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {resultUrls.length ? (
                    <div className={styles.resultActions}>
                      {config.slug === "matting" && activeResult ? (
                        <>
                          <div className={styles.mattingBackgroundControl} role="group" aria-label="结果背景颜色">
                            <span>背景颜色</span>
                            <label className={styles.customColorSwatch} title="自定义背景颜色">
                              <input
                                type="color"
                                value={mattingPreviewBackground === "transparent" ? "#ffffff" : mattingPreviewBackground}
                                onChange={(event) => setMattingPreviewBackground(event.target.value)}
                                aria-label="自定义背景颜色"
                              />
                            </label>
                            {MATTING_PREVIEW_BACKGROUNDS.map((background) => (
                              <button
                                key={background.value}
                                type="button"
                                className={styles.backgroundSwatch}
                                data-active={mattingPreviewBackground === background.value ? "true" : undefined}
                                data-checkerboard={background.value === "transparent" ? "true" : undefined}
                                style={background.value === "transparent" ? undefined : { background: background.value }}
                                aria-label={`${background.label}背景`}
                                aria-pressed={mattingPreviewBackground === background.value}
                                onClick={() => setMattingPreviewBackground(background.value)}
                              />
                            ))}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            onPointerDown={() => setIsMattingComparing(true)}
                            onPointerUp={() => setIsMattingComparing(false)}
                            onPointerCancel={() => setIsMattingComparing(false)}
                            onPointerLeave={() => setIsMattingComparing(false)}
                            onKeyDown={(event) => {
                              if (event.key === " " || event.key === "Enter") setIsMattingComparing(true);
                            }}
                            onKeyUp={() => setIsMattingComparing(false)}
                            onBlur={() => setIsMattingComparing(false)}
                          >
                            按住对比
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={!activeMattingBase}
                            title={activeMattingBase ? undefined : "当前结果未返回可编辑蒙版"}
                            onClick={() => {
                              if (!activeMattingBase) return;
                              setMattingEditorSessions((current) => current[activeResult.id]
                                ? current
                                : { ...current, [activeResult.id]: createImageEditorSession() });
                              setMattingRefineResultId(activeResult.id);
                            }}
                          >
                            <WandSparkles aria-hidden="true" />编辑抠图
                          </Button>
                        </>
                      ) : null}
                      {config.slug === "upscale" && activeResult ? (
                        <Button
                          type="button"
                          variant="outline"
                          onPointerDown={() => setIsUpscaleComparing(true)}
                          onPointerUp={() => setIsUpscaleComparing(false)}
                          onPointerCancel={() => setIsUpscaleComparing(false)}
                          onPointerLeave={() => setIsUpscaleComparing(false)}
                          onKeyDown={(event) => {
                            if (event.key === " " || event.key === "Enter") setIsUpscaleComparing(true);
                          }}
                          onKeyUp={() => setIsUpscaleComparing(false)}
                          onBlur={() => setIsUpscaleComparing(false)}
                        >
                          按住对比
                        </Button>
                      ) : null}
                      <Button type="button" variant="outline" onClick={() => {
                        setResults([]);
                        setError(null);
                      }}>
                        <RefreshCw aria-hidden="true" />{config.slug === "matting" ? "再次创作" : "继续调整"}
                      </Button>
                      <StudioSingleDownloadButton
                        url={activePreviewUrl}
                        filename={`pixel-diffusion-${config.slug}-${activePreviewIndex + 1}.png`}
                        errorFallback="图片下载失败"
                        label="下载当前结果"
                        variant="default"
                      />
                      {resultUrls.length > 1 ? (
                        <StudioMediaDownloadButtonFallback urls={resultUrls} filename={`pixel-diffusion-${config.slug}`} />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            )}
          />
        )}
      />

      {reference?.status === "ready" && reference.remoteUrl && requiresReferenceMask ? (
        <StudioMaskEditorDialog
          key={`${reference.id}:${reference.remoteUrl}:reference-mask`}
          open={referenceEditorOpen}
          sourceId={`reference:${reference.id}`}
          sourceUrl={reference.remoteUrl}
          sourceName={reference.name}
          session={referenceEditorSession}
          disabled={isGenerating || isMaskSaving}
          toolbarVariant="shoe"
          intent="inpaint"
          instruction={config.slug === "clothing-repair" && mode === "detail"
            ? "请涂抹需要参考的局部区域"
            : config.slug === "clothing-repair"
              ? "请涂抹模特图中需要参考的服饰区域"
              : "请涂抹参考图中需要参考的鞋靴区域"}
          onImageDimensions={setReferenceDimensions}
          onCancel={() => setReferenceEditorOpen(false)}
          onConfirm={(session) => {
            setReferenceEditorSession(session);
            setReferenceMaskReference(null);
            setReferenceEditorOpen(false);
            toast.success("参考选区已保存");
          }}
        />
      ) : null}

      {maskEditorSource?.status === "ready" && maskEditorSource.remoteUrl ? (
        <StudioMaskEditorDialog
          key={`${maskEditorSource.id}:${maskEditorSource.remoteUrl}`}
          open={Boolean(maskEditorSourceId)}
          sourceId={maskEditorSource.id}
          sourceUrl={maskEditorSource.remoteUrl}
          sourceName={maskEditorSource.name}
          session={editorSessions[maskEditorSource.id] || createImageEditorSession()}
          disabled={isGenerating || isMaskSaving || activeSelectionAction !== null}
          instruction={config.slug === "erase"
            ? "请在图片中涂抹需要消除的区域"
            : config.slug === "clothing-repair"
              ? "请涂抹款式或细节有错误的区域"
              : config.slug === "shoe-repair"
                ? "请涂抹鞋靴需要修复的区域"
                : `请标记需要${config.title}的区域`}
          toolbarVariant={config.slug === "clothing-repair"
            ? "clothing"
            : config.slug === "shoe-repair" || config.slug === "hand-foot-repair"
              ? "shoe"
              : "erase"}
          quickSelection={config.slug === "hand-foot-repair" ? {
            label: "快捷选择",
            value: limbTarget,
            options: [
              { value: "hands", label: "仅修手" },
              { value: "feet", label: "仅修脚" },
              { value: "both", label: "修手脚" },
            ],
            onChange: (value) => setLimbTarget(value as "hands" | "feet" | "both"),
          } : undefined}
          intent={selectionBases[maskEditorSource.id] ? "matting" : "inpaint"}
          baseForegroundUrl={selectionBases[maskEditorSource.id]?.foreground.url}
          hasBaseSelection={Boolean(selectionBases[maskEditorSource.id])}
          activeSelectionAction={activeSelectionAction}
          onSelectionAction={config.slug === "clothing-repair"
            && (selectionCapability.status === "live" || selectionCapability.status === "mock")
            ? handleAutomaticSelection
            : undefined}
          selectionActionUnavailableReason={config.slug === "clothing-repair"
            ? selectionCapability.reason || "自动选区服务尚未就绪，可继续手动涂抹"
            : undefined}
          onImageDimensions={(dimensions) => handleSourceDimensions(maskEditorSource.id, dimensions)}
          onCancel={() => {
            selectionAbortControllerRef.current?.abort();
            if (!maskRemoteUrls[maskEditorSource.id]) {
              setSelectionBases((current) => {
                const next = { ...current };
                delete next[maskEditorSource.id];
                return next;
              });
            }
            setMaskEditorSourceId(null);
          }}
          onConfirm={(session) => {
            void handleConfirmMaskEditor(session);
          }}
        />
      ) : null}

      {config.slug === "matting"
        && activeResult
        && activeMattingBase
        && activeResultDimensions
        && mattingRefineResultId === activeResult.id ? (
          <StudioMaskEditorDialog
            key={`${activeResult.id}:${activeResult.primary.url}:matting-dialog`}
            open
            sourceId={activeResult.id}
            sourceUrl={activeResult.sourceUrl}
            sourceName={activeResult.sourceName}
            intent="matting"
            toolbarVariant="matting"
            baseForegroundUrl={activeResult.primary.url}
            session={mattingEditorSessions[activeResult.id] || createImageEditorSession()}
            disabled={isGenerating}
            instruction="补回缺失主体或移除多余背景，确定后将更新当前抠图结果。"
            onCancel={() => setMattingRefineResultId(null)}
            onConfirm={(session) => {
              setMattingEditorSessions((current) => ({ ...current, [activeResult.id]: session }));
              void handleApplyMattingRefinement(session);
            }}
          />
        ) : null}

      <StudioMediaLightbox
        src={lightbox?.src || null}
        alt={lightbox?.alt || config.title}
        onClose={() => setLightbox(null)}
      />
      {unsavedDialog}
    </>
  );
}

function StudioMediaDownloadButtonFallback({ urls, filename }: { urls: string[]; filename: string }) {
  return (
    <StudioBatchDownloadButton
      urls={urls}
      filename={filename}
      resultLabel="处理结果"
      label={`下载全部 ${urls.length} 张`}
      variant="outline"
    />
  );
}

function createLocalAsset(file: File): SourceAsset {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    name: file.name,
    previewUrl: URL.createObjectURL(file),
    remoteUrl: null,
    width: null,
    height: null,
    assetId: null,
    registrationToken: null,
    originalFile: file,
    status: "uploading",
  };
}

function isSupportedAiToolImage(file: File) {
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type.toLowerCase())) return true;
  return !file.type && /\.(?:jpe?g|png|webp)$/i.test(file.name);
}

function shouldRequireReferenceMask(slug: AiToolUiConfig["slug"], mode: string, referenceMode: string) {
  if (slug === "shoe-repair") return true;
  if (slug !== "clothing-repair") return false;
  return mode === "detail" || referenceMode === "model";
}

function validateFiles(files: File[], remaining: number) {
  if (remaining <= 0) {
    toast.info("已达到本工具的单次上传上限");
    return [];
  }
  const valid = files.filter((file) => {
    if (!isSupportedAiToolImage(file)) {
      toast.error(`${file.name} 不是支持的图片格式`);
      return false;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(`${file.name} 超过 ${MAX_FILE_SIZE_MB}MB`);
      return false;
    }
    return true;
  });
  if (valid.length > remaining) toast.info(`本次仅添加前 ${remaining} 张图片`);
  return valid.slice(0, remaining);
}

function revokePreview(url: string) {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}

function moveItem<T>(items: T[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

async function settleWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<Array<PromiseSettledResult<T>>> {
  const results = new Array<PromiseSettledResult<T>>(tasks.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: "fulfilled", value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(tasks.length, Math.max(1, Math.floor(concurrency))) },
    worker,
  ));
  return results;
}

function clampDimension(raw: string) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 1;
  return Math.min(5120, Math.max(1, Math.round(value)));
}

function buildToolOptions(input: {
  config: AiToolUiConfig;
  mode: string;
  targetWidth: number;
  targetHeight: number;
  cropPosition: { x: number; y: number };
  frameTransform?: StudioFrameTransform;
  sourceDimensions?: StudioImageDimensions;
  resizeBackground: string;
  upscale: "2x" | "4x";
  instruction: string;
  referenceMode: string;
  limbTarget: "hands" | "feet" | "both";
  aiModel: LingyaModel;
}) {
  const { config } = input;
  if (config.slug === "matting") {
    return {
      subject: input.mode,
      background: "transparent",
      edge_refinement: "fine",
      output_format: "png",
    };
  }
  if (config.slug === "upscale") {
    return {
      scale: input.upscale === "4x" ? 4 : 2,
      denoise: "low",
      face_enhance: input.mode === "portrait",
      preserve_text: true,
      allow_non_ai_fallback: false,
      output_format: "png",
    };
  }
  if (config.slug === "outpaint") {
    const sourceScale = input.sourceDimensions
      ? resolveAiToolOutpaintSourceScale({
          sourceWidth: input.sourceDimensions.width,
          sourceHeight: input.sourceDimensions.height,
          targetWidth: input.targetWidth,
          targetHeight: input.targetHeight,
          sourceRect: input.frameTransform?.kind === "outpaint"
            ? input.frameTransform.sourceRect
            : undefined,
        })
      : 1;
    return {
      model: input.aiModel,
      target_width: input.targetWidth,
      target_height: input.targetHeight,
      anchor: input.mode,
      position_x: input.cropPosition.x,
      position_y: input.cropPosition.y,
      source_scale: sourceScale,
      mask_feather: 8,
      output_format: "png",
    };
  }
  if (config.slug === "resize") {
    const crop = input.frameTransform?.kind === "resize" ? input.frameTransform.cropRect : null;
    return {
      width: input.targetWidth,
      height: input.targetHeight,
      fit: "cover",
      position_x: input.cropPosition.x,
      position_y: input.cropPosition.y,
      ...(crop ? {
        crop_x: crop.x,
        crop_y: crop.y,
        crop_width: crop.width,
        crop_height: crop.height,
      } : {}),
      output_format: "png",
      quality: 96,
      without_enlargement: false,
    };
  }
  const common = {
    model: input.aiModel,
    instruction: input.instruction.trim() || undefined,
    mask_feather: 8,
    output_format: "png",
  };
  if (config.slug === "hand-foot-repair") {
    return { ...common, preserve_identity: true, target: input.limbTarget };
  }
  if (config.slug === "clothing-repair") {
    const repairMode = input.mode === "detail" ? "detail" : "style";
    const referenceType = input.referenceMode === "model" ? "model" : "flat";
    return { ...common, preserve_logo: true, repair_mode: repairMode, reference_type: referenceType };
  }
  if (config.slug === "shoe-repair") {
    return { ...common, preserve_logo: true };
  }
  return { ...common, quality: input.mode === "fast" ? "fast" : "standard" };
}

function getRunDisabledReason(input: {
  authChecked: boolean;
  isAuthenticated: boolean;
  sources: SourceAsset[];
  reference: SourceAsset | null;
  editorSessions: Record<string, StudioImageEditorSession>;
  sourceDimensions: Record<string, StudioImageDimensions>;
  maskRemoteUrls: Record<string, MaskReference>;
  selectionBases: Record<string, SelectionBase>;
  referenceEditorSession: StudioImageEditorSession;
  referenceDimensions: StudioImageDimensions | null;
  referenceMaskReference: MaskReference | null;
  requiresReferenceMask: boolean;
  config: AiToolUiConfig;
  capability: CapabilityState;
  targetWidth: number;
  targetHeight: number;
  upscale: "2x" | "4x";
  isUploading: boolean;
}) {
  if (!input.authChecked) return "正在检查登录状态";
  if (!input.isAuthenticated) return "请先登录后使用";
  if (!input.sources.length) return "请先上传图片";
  if (input.isUploading || input.sources.some((source) => source.status === "uploading")) return "图片正在上传";
  if (input.sources.some((source) => source.status === "error" || !source.remoteUrl)) return "请移除上传失败的图片";
  if (input.capability.status === "live" && input.sources.some((source) => !source.assetId && !source.registrationToken)) {
    return "原图缺少安全使用凭证，请重新上传";
  }
  if (input.config.showDimensions) {
    const targetDimensionError = input.config.slug === "resize"
      ? getResizeTargetDimensionError(input.targetWidth, input.targetHeight)
      : getAiToolTargetDimensionError(input.targetWidth, input.targetHeight);
    if (targetDimensionError) return targetDimensionError;
  }
  if (input.config.slug === "upscale" && input.sources.some((source) => (
    Boolean(source.width && source.width > 2560)
    || Boolean(source.height && source.height > 2560)
  ))) return "图片超清仅支持宽高不超过 2560px 的原图";
  if (input.config.slug === "upscale" && input.upscale === "4x" && input.sources.some((source) => (
    Boolean(source.width && source.width > 1280)
    || Boolean(source.height && source.height > 1280)
  ))) return "4倍放大仅支持宽高不超过 1280px 的原图";
  if (input.config.requiresReference && (!input.reference || input.reference.status !== "ready" || !input.reference.remoteUrl)) return "请上传参考商品图";
  if (input.capability.status === "live" && input.config.requiresReference
    && input.reference && !input.reference.assetId && !input.reference.registrationToken) {
    return "参考图缺少安全使用凭证，请重新上传";
  }
  if (input.requiresReferenceMask && !input.referenceDimensions) return "正在读取参考图尺寸";
  if (input.requiresReferenceMask && input.referenceDimensions && (
    input.referenceDimensions.width > STUDIO_EDITOR_MAX_EDGE
      || input.referenceDimensions.height > STUDIO_EDITOR_MAX_EDGE
      || input.referenceDimensions.width * input.referenceDimensions.height > STUDIO_EDITOR_MAX_PIXELS
  )) return "参考图需小于 8192px 且不超过 3200 万像素";
  if (input.requiresReferenceMask
    && !isAiToolReferenceFresh(input.referenceMaskReference || undefined)
    && !hasVisibleMaskContent(input.referenceEditorSession.present)) {
    return "请标记参考商品图中需要参考的区域";
  }
  if (input.config.requiresMask && input.sources.some((source) => {
    const dimensions = input.sourceDimensions[source.id];
    return !dimensions || dimensions.width <= 0 || dimensions.height <= 0;
  })) return "正在读取规范化原图尺寸";
  if (input.config.requiresMask && input.sources.some((source) => {
    const dimensions = input.sourceDimensions[source.id];
    return dimensions.width > STUDIO_EDITOR_MAX_EDGE
      || dimensions.height > STUDIO_EDITOR_MAX_EDGE
      || dimensions.width * dimensions.height > STUDIO_EDITOR_MAX_PIXELS;
  })) return "局部编辑原图需小于 8192px 且不超过 3200 万像素";
  if (input.config.requiresMask && input.sources.some((source) => {
    if (isAiToolReferenceFresh(input.maskRemoteUrls[source.id]) || input.selectionBases[source.id]) return false;
    const session = input.editorSessions[source.id];
    return !session || !hasVisibleMaskContent(session.present);
  })) return "请逐张标记需要修改的区域";
  if (input.capability.status === "loading") return "正在检查服务状态";
  if (input.capability.status === "disabled" || input.capability.status === "error") return input.capability.reason || "服务尚未配置";
  return undefined;
}

function getResizeTargetDimensionError(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return "输出宽高不能小于 1px";
  }
  if (width > 5_120 || height > 5_120 || width * height > 32_000_000) {
    return "输出尺寸单边不能超过 5120px，且总像素不能超过 3200 万";
  }
  return undefined;
}

function parseCapability(payload: unknown, operation: string, providerLabel: string): CapabilityState {
  const record = asRecord(payload);
  const capabilities = asRecord(record?.capabilities);
  const tools = Array.isArray(record?.tools) ? record?.tools : [];
  const entry = asRecord(capabilities?.[operation])
    || tools.map(asRecord).find((item) => item?.slug === operation || item?.operation === operation)
    || asRecord(record?.[operation]);
  const mode = String(entry?.mode || entry?.execution_mode || entry?.status || "disabled").toLowerCase();
  const availabilityFlag = entry?.available ?? entry?.enabled;
  const available = availabilityFlag === true
    || (availabilityFlag === undefined && (mode === "live" || mode === "mock" || mode === "ready"));
  const providerStatus = asRecord(entry?.provider_status);
  const reason = readString(providerStatus?.message)
    || readString(providerStatus?.reason)
    || readString(entry?.reason)
    || readString(entry?.message);
  if (mode === "mock" && available) return { status: "mock", label: `${providerLabel} · 演示模式`, reason };
  if (available) return { status: "live", label: `${providerLabel} · 已就绪`, reason };
  return {
    status: "disabled",
    label: `${providerLabel} · 待配置`,
    reason: reason || "Provider 未配置；取得权限并设置服务端环境变量后会自动启用。",
  };
}

async function pollToolTask(
  taskId: string,
  signal: AbortSignal,
  onTick: (state: ToolResponse) => void,
  onRateLimit: (seconds: number) => void,
) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await waitForAiToolBatchDelay(2000, signal);
    const { response, data } = await requestJsonWithRateLimitRetry<ToolResponse>(
      (requestSignal) => fetch(`/api/ai-tools?task_id=${encodeURIComponent(taskId)}`, {
        cache: "no-store",
        signal: requestSignal,
      }),
      { signal, onRateLimit },
    );
    if (!response.ok) throw new Error(readToolResponseError(data, `读取任务失败 (${response.status})`));
    onTick(data);
    if (data.status === "completed") return data;
    if (data.status === "failed") throw new Error(readToolResponseError(data, "图片处理失败"));
  }
  throw new Error("处理时间过长，请稍后在生成记录中查看");
}

async function submitAiToolRequest(
  payload: Record<string, unknown>,
  signal: AbortSignal,
  onRateLimit: (seconds: number) => void,
) {
  const body = JSON.stringify(payload);
  return requestJsonWithRateLimitRetry<ToolResponse>((requestSignal) => fetch("/api/ai-tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: requestSignal,
    }), { signal, onRateLimit });
}

function readMaskReference(payload: ToolResponse | null | undefined): MaskReference | null {
  const url = payload?.mask?.url?.trim();
  const expiresAt = payload?.mask?.expires_at?.trim();
  if (!url || !expiresAt || !Number.isFinite(Date.parse(expiresAt))) return null;
  return { url, expiresAt };
}

async function uploadAiToolMask(
  file: File,
  dimensions: StudioImageDimensions,
  signal?: AbortSignal,
  onRateLimit?: (seconds: number) => void,
) {
  const form = new FormData();
  form.append("mask", file);
  form.append("source_width", String(dimensions.width));
  form.append("source_height", String(dimensions.height));
  const controller = signal || new AbortController().signal;
  const { response, data: payload } = await requestJsonWithRateLimitRetry<unknown>(
    (requestSignal) => fetch("/api/ai-tools/masks", {
      method: "POST",
      body: form,
      signal: requestSignal,
    }),
    { signal: controller, onRateLimit },
  );
  const record = asRecord(payload);
  const mask = asRecord(record?.mask);
  const url = readString(mask?.url);
  const expiresAt = readString(mask?.expires_at);
  if (!response.ok || !url || !expiresAt || !Number.isFinite(Date.parse(expiresAt))) {
    throw new Error(readError(payload, "蒙版上传失败"));
  }
  return { url, expiresAt };
}

async function submitMattingCompose(payload: {
  request_id: string;
  source_url: string;
  source_ref?: string;
  source_asset_id?: string;
  base_mask_url: string;
  base_mask_kind: "mask" | "alpha";
  edit_mask_url?: string;
  edit_operation?: "add" | "subtract";
}) {
  const response = await fetch("/api/ai-tools/matting/compose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({})) as ToolResponse;
  if (!response.ok) throw new Error(readToolResponseError(data, "抠图边缘合成失败"));
  return data;
}

function extractToolResults(response: ToolResponse, source: SourceAsset, taskNumber: number): ToolResult[] {
  const outputs = response.outputs?.filter((output) => Boolean(output.url)) || [];
  const primaryOutputs = outputs.filter((output) => output.role === "result");
  const fallbackOutputs: AiToolOutput[] = primaryOutputs.length || !Array.isArray(response.result_urls)
    ? []
    : [...new Set(response.result_urls.filter(Boolean))].map((url) => ({
      url,
      role: "result",
      kind: "image",
      mime_type: null,
      dimensions: null,
    }));
  return [...primaryOutputs, ...fallbackOutputs].map((primary, index) => ({
    id: `${response.task_id || response.request_id || `task-${taskNumber}`}:${index}`,
    sourceId: source.id,
    sourceName: source.name,
    sourceUrl: source.remoteUrl || source.previewUrl,
    primary,
    outputs: outputs.length ? outputs : fallbackOutputs,
  }));
}

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    queued: "任务已排队",
    preparing: "正在准备输入图片",
    submitting: "正在提交图像服务",
    processing: "图像服务处理中",
    postprocessing: "正在校验并转存结果",
  };
  return labels[stage.toLowerCase()] || stage;
}

function createRequestId(slug: string, index: number) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `${slug}-${index}-${random}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveIntegerOrNull(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function getAiToolTaskId(href: string) {
  if (!href) return "";
  try {
    const base = typeof window === "undefined" ? "https://task.local" : window.location.origin;
    return new URL(href, base).searchParams.get("task")?.trim() || "";
  } catch {
    return "";
  }
}

function replaceAiToolTaskInLocation(taskId: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("task", taskId);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function removeAiToolTaskFromLocation() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("task")) return;
  url.searchParams.delete("task");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function readError(value: unknown, fallback: string) {
  const record = asRecord(value);
  return readString(record?.error) || readString(record?.message) || fallback;
}

function readToolResponseError(value: ToolResponse, fallback: string) {
  if (typeof value.error === "string" && value.error.trim()) return value.error.trim();
  const nested = value.error && typeof value.error === "object" ? value.error.message : undefined;
  return readString(nested) || readString(value.task_error?.message) || readString(value.message) || fallback;
}

function errorMessage(value: unknown, fallback: string) {
  return value instanceof Error && value.message ? value.message : fallback;
}
