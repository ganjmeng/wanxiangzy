"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType, type DragEvent, type RefObject } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Bot,
  Box,
  Brush,
  ChevronDown,
  ChevronRight,
  Check,
  Circle,
  CornerUpRight,
  Copy,
  Crop,
  Download,
  Eraser,
  Eye,
  FileDown,
  FileImage,
  FileStack,
  FlipHorizontal2,
  Grid3X3,
  History,
  ImageIcon,
  ImagePlus,
  Layers3,
  Loader2,
  MapPin,
  Maximize2,
  MessageSquarePlus,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Move,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Pin,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Scan,
  Shapes,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Settings2,
  Send,
  StopCircle,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Type,
  Undo2,
  Upload,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { CanvasAssistantPanel, type CanvasAssistantAttachment, type CanvasAssistantMode, type CanvasAssistantResult } from "@/components/canvas/CanvasAssistantPanel";
import { CanvasBoard } from "@/components/canvas/CanvasBoard";
import type { CanvasBoardTool, CanvasCommand, CanvasNode as BoardNode, CanvasNodeId, CanvasPoint, CanvasSelectionMeta, CanvasShapeKind, CanvasViewport as BoardViewport } from "@/components/canvas/types";
import { StudioSegmentedControl } from "@/components/studio/StudioSegmentedControl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  createCanvasDocument,
  createNode,
  bringForward,
  deserialize,
  duplicateNodes,
  exportToSvg,
  sendBackward,
  serialize,
  type CanvasDocument,
  type CanvasNode,
} from "@/lib/canvas";
import { createClient, getCachedProfileCredits, setCachedProfileCredits } from "@/lib/supabase/client";
import { getCreditCost, getSupportedImageSizes, type AspectRatio, type ImageSize, type LingyaModel } from "@/lib/api/lingya";
import { getImageVariantUrl } from "@/lib/image-variants";
import { MAX_FILE_SIZE, MAX_FILE_SIZE_MB, uploadImage } from "@/lib/utils";

const STORAGE_KEY = "vastwear.canvas.document.v4";
const TOOLBAR_STORAGE_KEY = "vastwear.canvas.imageToolbar.v1";
const TOOLBAR_LABELS_STORAGE_KEY = "vastwear.canvas.imageToolbar.showLabels.v1";
const GENERATION_SETTINGS_STORAGE_KEY = "vastwear.canvas.generationSettings.v1";
const BRAND_GUIDE_STORAGE_KEY = "vastwear.canvas.guides.brandKit.v1";
const MINIMAP_GUIDE_STORAGE_KEY = "vastwear.canvas.guides.minimap.v1";
const HISTORY_LIMIT = 80;
const DEFAULT_ASPECT_RATIO: AspectRatio = "1:1";
const DEFAULT_IMAGE_SIZE: ImageSize = "1K";
const DEFAULT_MODEL: LingyaModel = "gpt-image-2";
const DRAW_COLOR_SWATCHES = ["#111111", "#2563eb", "#ef4444", "#f59e0b", "#22c55e", "#8b5cf6", "#ffffff"];
const OBJECT_COLOR_SWATCHES = ["#111111", "#ffffff", "#d9d9d9", "#f4f4f5", "#2563eb", "#ef4444", "#f59e0b", "#22c55e", "#8b5cf6", "#ec4899"];
const MARKER_LABEL_SUGGESTIONS = ["人脸", "发型", "上衣", "裤子", "手提包", "Logo", "背景", "文案", "物体"];

type LovartImageToolKey =
  | "upscale"
  | "remove-bg"
  | "eraser"
  | "edit-elements"
  | "edit-text"
  | "multi-angles"
  | "move-object"
  | "mockup"
  | "expand"
  | "adjust"
  | "crop"
  | "vector"
  | "flip";

type LovartImageToolConfig = {
  key: LovartImageToolKey;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  badge?: string;
  defaultPinned: boolean;
  dot?: boolean;
  right?: string;
};

const LOVART_IMAGE_TOOLS: LovartImageToolConfig[] = [
  { key: "upscale", label: "放大", badge: "HD", defaultPinned: true },
  { key: "remove-bg", label: "去背景", icon: Scan, defaultPinned: true },
  { key: "eraser", label: "橡皮工具", icon: Eraser, defaultPinned: true },
  { key: "edit-elements", label: "编辑元素", icon: Layers3, defaultPinned: true },
  { key: "edit-text", label: "编辑文字", icon: Type, defaultPinned: true },
  { key: "multi-angles", label: "多角度", icon: Shapes, defaultPinned: true },
  { key: "move-object", label: "移动对象", icon: Move, defaultPinned: true, dot: true },
  { key: "mockup", label: "样机", icon: Square, defaultPinned: false },
  { key: "expand", label: "扩图", icon: Maximize2, defaultPinned: false, dot: true },
  { key: "adjust", label: "调整", icon: Settings2, defaultPinned: false },
  { key: "crop", label: "裁剪", icon: Crop, defaultPinned: false },
  { key: "vector", label: "矢量", icon: Grid3X3, defaultPinned: false, dot: true, right: "9" },
  { key: "flip", label: "翻转与旋转", icon: FlipHorizontal2, defaultPinned: false },
];

const DEFAULT_VISIBLE_IMAGE_TOOL_KEYS = LOVART_IMAGE_TOOLS
  .filter((tool) => tool.defaultPinned)
  .map((tool) => tool.key);

type CanvasPlacementTool =
  | "text"
  | "frame"
  | "shape:rectangle"
  | "shape:line"
  | "shape:arrow"
  | "shape:ellipse"
  | "shape:polygon"
  | "shape:star";

type CanvasTool = CanvasBoardTool;

type LovartImagePanel = "expand" | "crop" | "adjust" | "flip" | "multi-angle" | null;
type LovartLeftPanel = "layers" | "files" | null;
type LovartGenerationSettings = {
  qualityLevel: string;
  width: number;
  height: number;
  sizePreset: string;
  imageCount: number;
};

type LovartSkillAction = {
  label: string;
  icon: LovartIcon;
  mode: CanvasAssistantMode;
  prompt: string;
};

type ImageAdjustValues = {
  light: number;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
};

const CANVAS_BACKGROUND_SWATCHES = ["#ffffff", "#f4f4f4", "#f7f3ff", "#eff6ff", "#ecfeff", "#111827"];

const RATIO_PRESETS = [
  { label: "原始比例", value: "original", ratio: null },
  { label: "1:1", value: "1:1", ratio: 1 },
  { label: "3:4", value: "3:4", ratio: 3 / 4 },
  { label: "2:3", value: "2:3", ratio: 2 / 3 },
  { label: "9:16", value: "9:16", ratio: 9 / 16 },
  { label: "4:3", value: "4:3", ratio: 4 / 3 },
  { label: "3:2", value: "3:2", ratio: 3 / 2 },
  { label: "16:9", value: "16:9", ratio: 16 / 9 },
  { label: "4:5", value: "4:5", ratio: 4 / 5 },
  { label: "5:4", value: "5:4", ratio: 5 / 4 },
];

const LOVART_PLATFORM_RATIO_GROUPS = ["Instagram", "Facebook", "TikTok", "YouTube"];

const DEFAULT_ADJUST_VALUES: ImageAdjustValues = {
  light: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
};

const DEFAULT_LOVART_GENERATION_SETTINGS: LovartGenerationSettings = {
  qualityLevel: "Medium",
  width: 1024,
  height: 1024,
  sizePreset: "1:1",
  imageCount: 1,
};
const ADJUST_VALUE_KEYS = Object.keys(DEFAULT_ADJUST_VALUES) as Array<keyof ImageAdjustValues>;

const MODEL_OPTIONS = [
  { value: "gpt-image-2", label: "GPT Image 2", description: "稳定" },
  { value: "nano-banana-2", label: "Nano Banana 2", description: "快速" },
  { value: "nano-banana-pro", label: "Nano Banana Pro", description: "精修" },
  { value: "doubao-seedream-4-5-251128", label: "Seedream 4.5", description: "商品" },
];

const QUALITY_OPTIONS = [
  { value: "1K", label: "1K", description: "草稿" },
  { value: "2K", label: "2K", description: "标准" },
  { value: "4K", label: "4K", description: "高清" },
];

const LOVART_SIZE_PRESET_DIMENSIONS: Record<string, { width: number; height: number; quality: ImageSize }> = {
  "1:1": { width: 1024, height: 1024, quality: "1K" },
  "3:2": { width: 1536, height: 1024, quality: "1K" },
  "2:3": { width: 1024, height: 1536, quality: "1K" },
  "1:1(2k)": { width: 2048, height: 2048, quality: "2K" },
  "16:9(2k)": { width: 2048, height: 1152, quality: "2K" },
  "16:9(4k)": { width: 4096, height: 2304, quality: "4K" },
  "9:16(4k)": { width: 2304, height: 4096, quality: "4K" },
  auto: { width: 1024, height: 1024, quality: "1K" },
};

type CanvasHistoryEntry = {
  document: CanvasDocument;
  selectedIds: CanvasNodeId[];
};

type CanvasAssetItem = {
  id: string;
  name: string;
  url: string;
  previewUrl: string;
  width?: number;
  height?: number;
};

type UploadAssetsOptions = {
  insertToCanvas?: boolean;
  attachToPrompt?: boolean;
  insertAt?: CanvasPoint;
};

type GenerateImageOptions = {
  promptOverride?: string;
  attachmentsOverride?: CanvasAssistantAttachment[];
  modeOverride?: CanvasAssistantMode;
};

function createInitialDocument() {
  const heroImage = "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/exclusive-model-01.png";
  const productImage = "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/tryon/top-green-jacket-front.png";
  return createCanvasDocument({
    id: "vastwear-canvas",
    name: "万能画布",
    viewport: { x: 420, y: 180, width: 1440, height: 900, zoom: 0.8 },
    gridSize: 16,
    background: "#f8fafc",
    assets: [
      { id: "asset-hero", type: "image", src: heroImage, name: "模特参考", width: 900, height: 1200 },
      { id: "asset-product", type: "image", src: productImage, name: "商品参考", width: 900, height: 1200 },
    ],
    nodes: [
      createNode({ id: "cover-card", type: "rect", name: "首屏画板", x: -160, y: -120, width: 430, height: 520, fill: "#ffffff", stroke: "#e2e8f0", strokeWidth: 1, radius: 28 }),
      createNode({ id: "title", type: "text", name: "标题", x: -112, y: -72, width: 240, height: 74, text: "服装视觉概念板", fill: "#0f172a", fontSize: 28, zIndex: 1 }),
      createNode({ id: "subtitle", type: "text", name: "说明", x: -112, y: 6, width: 260, height: 72, text: "拖入素材、用 AI 生成图片，直接在无限画布中编排方案。", fill: "#64748b", fontSize: 15, zIndex: 2 }),
      createNode({ id: "product-img", type: "image", name: "商品", assetId: "asset-product", x: -110, y: 118, width: 150, height: 210, radius: 18, zIndex: 3 }),
      createNode({ id: "model-img", type: "image", name: "模特", assetId: "asset-hero", x: 62, y: 84, width: 160, height: 270, radius: 22, zIndex: 4 }),
      createNode({ id: "note", type: "rect", name: "备注", x: -110, y: 362, width: 330, height: 58, fill: "#f5f3ff", stroke: "#ddd6fe", strokeWidth: 1, radius: 18, zIndex: 5 }),
      createNode({ id: "note-text", type: "text", name: "备注文字", x: -86, y: 376, width: 280, height: 28, text: "选中元素可拖拽，滚轮移动，Ctrl/⌘ + 滚轮缩放。", fill: "#6d28d9", fontSize: 13, zIndex: 6 }),
    ],
  });
}

function createLovartInitialDocument() {
  const heroImage = "/references/reference-grey-tank-denim-culottes.jpg";
  const resultImage = "/home-showcase/model-grey-tank-denim.jpg";

  return createCanvasDocument({
    id: "vastwear-canvas",
    name: "未命名",
    viewport: { x: 318, y: 285, width: 1440, height: 900, zoom: 0.58 },
    gridSize: 16,
    background: "#f4f4f4",
    assets: [
      {
        id: "asset-hero",
        type: "image",
        src: heroImage,
        name: "louis-vuitton-monogram-flared-jeans--FTPF02EFY610_PM1.Worn view",
        width: 1080,
        height: 1350,
      },
      {
        id: "asset-result",
        type: "image",
        src: resultImage,
        name: "Generated variation",
        width: 1080,
        height: 1350,
      },
    ],
    nodes: [
      createNode({
        id: "source-image",
        type: "image",
        name: "louis-vuitton-monogram-flared-jeans--FTPF02EFY610_PM1.Worn view",
        assetId: "asset-hero",
        x: -520,
        y: -360,
        width: 650,
        height: 650,
        radius: 0,
        zIndex: 1,
      }),
      createNode({
        id: "result-image",
        type: "image",
        name: "Generated variation",
        assetId: "asset-result",
        x: 180,
        y: -360,
        width: 650,
        height: 650,
        radius: 0,
        zIndex: 2,
      }),
    ],
  });
}

function normalizeBoardShapeKind(value: string): CanvasShapeKind {
  if (["rectangle", "ellipse", "diamond", "line", "arrow", "path", "polygon", "star", "marker", "frame"].includes(value)) {
    return value as CanvasShapeKind;
  }
  return "rectangle";
}

function documentToBoardNodes(document: CanvasDocument): BoardNode[] {
  const assetById = new Map(document.assets.map((asset) => [asset.id, asset]));
  return document.nodes
    .filter((node) => node.visible)
    .map((node) => {
      const base = {
        id: node.id,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        name: node.name,
        rotation: node.rotation,
        opacity: node.opacity,
        zIndex: node.zIndex,
        locked: node.locked,
        hidden: !node.visible,
      };

      if (node.type === "image") {
        return {
          ...base,
          type: "image",
          src: node.src || (node.assetId ? assetById.get(node.assetId)?.src : "") || "",
          alt: node.alt || node.name,
          objectFit: "contain",
          backgroundColor: "#ffffff",
          style: { borderRadius: node.radius || 18, filter: node.filter },
          data: { ...node.data, assetId: node.assetId, flipX: node.flipX, flipY: node.flipY, cropRatio: node.cropRatio },
        } satisfies BoardNode;
      }

      if (node.type === "text") {
        return {
          ...base,
          type: "text",
          text: node.text || "",
          color: node.fill,
          backgroundColor: "transparent",
          fontFamily: node.fontFamily,
          fontSize: node.fontSize,
          fontWeight: 800,
        lineHeight: 1.25,
        padding: 0,
        data: node.data,
      } satisfies BoardNode;
    }

    const shapeKind = typeof node.shapeKind === "string" ? node.shapeKind : node.type === "ellipse" ? "ellipse" : "rectangle";
    return {
      ...base,
      type: "shape",
      shape: normalizeBoardShapeKind(shapeKind),
      fill: node.fill,
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
      radius: node.radius,
      text: node.text,
      data: node.data,
      style: { borderRadius: node.type === "ellipse" ? 999 : node.radius || 12 },
    } satisfies BoardNode;
    });
}

function boardNodesToDocumentNodes(boardNodes: BoardNode[], previous: CanvasDocument): CanvasNode[] {
  const previousById = new Map(previous.nodes.map((node) => [node.id, node]));
  const assetBySrc = new Map(previous.assets.map((asset) => [asset.src, asset]));

  return boardNodes.map((node, index) => {
    const existing = previousById.get(node.id);
    if (node.type === "image") {
      const asset = assetBySrc.get(node.src);
      return createNode({
        id: node.id,
        type: "image",
        name: node.name,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        zIndex: node.zIndex ?? index,
        rotation: node.rotation,
        opacity: node.opacity,
        locked: node.locked,
        visible: !node.hidden,
        radius: readRadius(node.style?.borderRadius, existing?.radius ?? 18),
        assetId: typeof node.data?.assetId === "string" ? node.data.assetId : asset?.id,
        src: asset ? undefined : node.src,
        alt: node.alt,
        filter: typeof node.style?.filter === "string" ? node.style.filter : existing?.filter,
        flipX: node.data?.flipX === true,
        flipY: node.data?.flipY === true,
        cropRatio: typeof node.data?.cropRatio === "string" ? node.data.cropRatio : existing?.cropRatio,
        data: node.data,
      });
    }

    if (node.type === "text") {
      return createNode({
        id: node.id,
        type: "text",
        name: node.name,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        zIndex: node.zIndex ?? index,
        rotation: node.rotation,
        opacity: node.opacity,
        locked: node.locked,
        visible: !node.hidden,
        text: node.text,
        fill: node.color,
        fontFamily: node.fontFamily,
        fontSize: node.fontSize,
        data: node.data,
      });
    }

    return createNode({
      id: node.id,
      type: node.shape === "ellipse" ? "ellipse" : "rect",
      shapeKind: node.shape,
      name: node.name,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      zIndex: node.zIndex ?? index,
      rotation: node.rotation,
      opacity: node.opacity,
      locked: node.locked,
      visible: !node.hidden,
      fill: node.fill,
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
      radius: node.radius,
      text: node.text,
      data: node.data,
    });
  });
}

function documentToBoardViewport(document: CanvasDocument): BoardViewport {
  return {
    x: document.viewport.x,
    y: document.viewport.y,
    zoom: document.viewport.zoom,
  };
}

function shouldIgnoreCanvasShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

export default function CanvasPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const assetInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const quickEditInputRef = useRef<HTMLTextAreaElement>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const documentRef = useRef<CanvasDocument | null>(null);
  const selectedIdsRef = useRef<CanvasNodeId[]>([]);
  const insertedResultUrlsRef = useRef<Set<string>>(new Set());
  const transientBeforeRef = useRef<CanvasHistoryEntry | null>(null);
  const adjustBeforeRef = useRef<CanvasHistoryEntry | null>(null);

  const [document, setDocument] = useState<CanvasDocument>(() => createLovartInitialDocument());
  const [selectedIds, setSelectedIds] = useState<CanvasNodeId[]>(["source-image"]);
  const [history, setHistory] = useState<CanvasHistoryEntry[]>([]);
  const [future, setFuture] = useState<CanvasHistoryEntry[]>([]);
  const [prompt, setPrompt] = useState("");
  const [assistantMode, setAssistantMode] = useState<CanvasAssistantMode>("generate");
  const [aiModel, setAiModel] = useState<LingyaModel>(DEFAULT_MODEL);
  const [imageSize, setImageSize] = useState<ImageSize>(DEFAULT_IMAGE_SIZE);
  const [attachments, setAttachments] = useState<CanvasAssistantAttachment[]>([]);
  const [results, setResults] = useState<CanvasAssistantResult[]>([]);
  const [assetLibrary, setAssetLibrary] = useState<CanvasAssetItem[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [isCanvasAssetDragOver, setIsCanvasAssetDragOver] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [quickEditPrompt, setQuickEditPrompt] = useState("");
  const [quickEditOpen, setQuickEditOpen] = useState(false);
  const [activeCanvasTool, setActiveCanvasTool] = useState<CanvasTool>("select");
  const [drawStyle, setDrawStyle] = useState({ stroke: "#111111", strokeWidth: 6 });
  const [activeOperation, setActiveOperation] = useState<string | null>(null);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [fontMenuOpen, setFontMenuOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [replaceTargetId, setReplaceTargetId] = useState<CanvasNodeId | null>(null);
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);
  const [leftPanel, setLeftPanel] = useState<LovartLeftPanel>(null);
  const [activeImagePanel, setActiveImagePanel] = useState<LovartImagePanel>(null);
  const [toolbarNamesOpen, setToolbarNamesOpen] = useState(false);
  const [showToolNames, setShowToolNames] = useState(true);
  const [toolbarPreferencesLoaded, setToolbarPreferencesLoaded] = useState(false);
  const [visibleImageToolKeys, setVisibleImageToolKeys] = useState<LovartImageToolKey[]>(DEFAULT_VISIBLE_IMAGE_TOOL_KEYS);
  const [brandGuideOpen, setBrandGuideOpen] = useState(true);
  const [minimapGuideOpen, setMinimapGuideOpen] = useState(true);
  const [guidePreferencesLoaded, setGuidePreferencesLoaded] = useState(false);
  const [canvasColorOpen, setCanvasColorOpen] = useState(false);
  const [adjustValues, setAdjustValues] = useState<ImageAdjustValues>(DEFAULT_ADJUST_VALUES);
  const [generationSettings, setGenerationSettings] = useState<LovartGenerationSettings>(DEFAULT_LOVART_GENERATION_SETTINGS);
  const [generationSettingsLoaded, setGenerationSettingsLoaded] = useState(false);

  const boardNodes = useMemo(() => documentToBoardNodes(document), [document]);
  const viewport = useMemo(() => documentToBoardViewport(document), [document]);
  const selectedNodes = useMemo(() => document.nodes.filter((node) => selectedIds.includes(node.id)), [document.nodes, selectedIds]);
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const selectedImageNodes = useMemo(() => selectedNodes.filter((node) => node.type === "image"), [selectedNodes]);
  const primaryImageNode = selectedImageNodes[0] ?? null;
  const singleImageNode = selectedNode?.type === "image" ? selectedNode : null;
  const selectedMarkerNode = selectedNode?.shapeKind === "marker" ? selectedNode : null;
  const hasGroupedSelection = useMemo(
    () => selectedNodes.some((node) => Boolean(readNodeDataString(node.data, "groupId"))),
    [selectedNodes],
  );
  const selectedMarkerTargetImageNode = useMemo(
    () => findMarkerTargetImage(selectedMarkerNode, document),
    [document, selectedMarkerNode],
  );
  const selectedImageUrl = primaryImageNode ? getImageSource(primaryImageNode, document) : "";
  const singleImageUrl = singleImageNode ? getImageSource(singleImageNode, document) : "";
  const selectionScreenRect = useMemo(() => {
    const bounds = getDocumentBounds(selectedNodes);
    if (!bounds) return null;
    return {
      x: bounds.x * document.viewport.zoom + document.viewport.x,
      y: bounds.y * document.viewport.zoom + document.viewport.y,
      width: bounds.width * document.viewport.zoom,
      height: bounds.height * document.viewport.zoom,
    };
  }, [document.viewport.x, document.viewport.y, document.viewport.zoom, selectedNodes]);
  const selectedMarkerPromptRect = useMemo(() => {
    const node = selectedMarkerTargetImageNode;
    if (!node) return selectionScreenRect;
    return {
      x: node.x * document.viewport.zoom + document.viewport.x,
      y: node.y * document.viewport.zoom + document.viewport.y,
      width: node.width * document.viewport.zoom,
      height: node.height * document.viewport.zoom,
    };
  }, [document.viewport.x, document.viewport.y, document.viewport.zoom, selectedMarkerTargetImageNode, selectionScreenRect]);
  const resultScreenRect = useMemo(() => {
    const resultNode = document.nodes.find((node) => node.id === "result-image");
    if (!resultNode) return null;
    return {
      x: resultNode.x * document.viewport.zoom + document.viewport.x,
      y: resultNode.y * document.viewport.zoom + document.viewport.y,
      width: resultNode.width * document.viewport.zoom,
      height: resultNode.height * document.viewport.zoom,
    };
  }, [document.nodes, document.viewport.x, document.viewport.y, document.viewport.zoom]);
  const generationCount = clampLovartImageCount(generationSettings.imageCount);
  const generationAspectRatio = resolveLovartAspectRatio(generationSettings.sizePreset);
  const requestedImageSize = resolveLovartImageSize(generationSettings.sizePreset, imageSize);
  const supportedSizes = getSupportedImageSizes(aiModel, generationAspectRatio);
  const effectiveImageSize = supportedSizes.includes(requestedImageSize) ? requestedImageSize : supportedSizes[0] ?? DEFAULT_IMAGE_SIZE;
  const cost = getCreditCost(aiModel, effectiveImageSize, generationAspectRatio) * generationCount;

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TOOLBAR_STORAGE_KEY);
      if (raw) {
        const normalized = normalizeVisibleImageToolKeys(JSON.parse(raw));
        if (normalized.length > 0) setVisibleImageToolKeys(normalized);
      }
      const labelsRaw = window.localStorage.getItem(TOOLBAR_LABELS_STORAGE_KEY);
      if (labelsRaw === "0") setShowToolNames(false);
      if (labelsRaw === "1") setShowToolNames(true);
    } catch {
      // Keep the default toolbar if the saved preference is not readable.
    } finally {
      setToolbarPreferencesLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!toolbarPreferencesLoaded) return;
    window.localStorage.setItem(TOOLBAR_STORAGE_KEY, JSON.stringify(visibleImageToolKeys));
    window.localStorage.setItem(TOOLBAR_LABELS_STORAGE_KEY, showToolNames ? "1" : "0");
  }, [showToolNames, toolbarPreferencesLoaded, visibleImageToolKeys]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(GENERATION_SETTINGS_STORAGE_KEY);
      if (raw) setGenerationSettings(normalizeLovartGenerationSettings(JSON.parse(raw)));
    } catch {
      // Ignore invalid saved generation settings.
    } finally {
      setGenerationSettingsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!generationSettingsLoaded) return;
    window.localStorage.setItem(GENERATION_SETTINGS_STORAGE_KEY, JSON.stringify(generationSettings));
  }, [generationSettings, generationSettingsLoaded]);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(BRAND_GUIDE_STORAGE_KEY) === "dismissed") {
        setBrandGuideOpen(false);
      }
      if (window.localStorage.getItem(MINIMAP_GUIDE_STORAGE_KEY) === "dismissed") {
        setMinimapGuideOpen(false);
      }
    } catch {
      // Guides are optional; keep first-run defaults when storage is unavailable.
    } finally {
      setGuidePreferencesLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!selectedMarkerNode) return;
    setQuickEditOpen(false);
    setQuickEditPrompt(readStoredMarkerPrompt(selectedMarkerNode));
    window.setTimeout(() => quickEditInputRef.current?.focus(), 0);
  }, [selectedMarkerNode?.id]);

  useEffect(() => {
    if (activeImagePanel !== "adjust") return;
    if (adjustBeforeRef.current) return;
    setAdjustValues(readStoredAdjustValues(singleImageNode ?? primaryImageNode));
  }, [activeImagePanel, singleImageNode?.id, primaryImageNode?.id]);

  useEffect(() => {
    const handleGlobalCanvasKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || shouldIgnoreCanvasShortcutTarget(event.target)) return;
      const isModifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (event.key === "Escape") {
        event.preventDefault();
        const shouldClearSelection =
          !quickEditOpen &&
          !shapeMenuOpen &&
          !fontMenuOpen &&
          !activeImagePanel &&
          activeCanvasTool === "select" &&
          selectedIdsRef.current.length > 0;
        setQuickEditOpen(false);
        setShapeMenuOpen(false);
        setFontMenuOpen(false);
        if (activeImagePanel) closeImageOperationPanel();
        setActiveCanvasTool("select");
        if (shouldClearSelection) {
          handleSelectionChange([], { action: "clear", source: "keyboard" });
        }
        return;
      }

      if ((event.key === "Backspace" || event.key === "Delete") && activeCanvasTool === "select" && selectedIdsRef.current.length > 0) {
        event.preventDefault();
        deleteSelected();
        return;
      }

      if (isModifier && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }

      if (isModifier && key === "y") {
        event.preventDefault();
        redo();
        return;
      }

      if (isModifier && key === "a") {
        event.preventDefault();
        const currentDocument = documentRef.current || document;
        handleSelectionChange(
          currentDocument.nodes.filter((node) => node.visible !== false).map((node) => node.id),
          { action: "all", source: "keyboard" }
        );
        setActiveCanvasTool("select");
        setShapeMenuOpen(false);
        setFontMenuOpen(false);
        setQuickEditOpen(false);
        if (activeImagePanel) closeImageOperationPanel();
        return;
      }

      if (isModifier && key === "d") {
        event.preventDefault();
        duplicateSelected();
        return;
      }

      if (isModifier && key === "g") {
        event.preventDefault();
        if (event.shiftKey) ungroupSelectedNodes();
        else groupSelectedNodes();
        return;
      }

      if (event.key === "Tab" && selectedIdsRef.current.length === 1) {
        const currentDocument = documentRef.current || document;
        const selected = currentDocument.nodes.find((node) => node.id === selectedIdsRef.current[0]);
        if (selected?.type === "image") {
          event.preventDefault();
          editSelectedImage();
        }
        return;
      }

      if (isModifier || event.altKey) return;

      const shortcutTool: CanvasTool | null =
        key === "v" ? "select" :
        key === "p" ? "draw" :
        key === "m" ? "mark" :
        key === "f" ? "frame" :
        key === "r" ? "shape:rectangle" :
        key === "o" ? "shape:ellipse" :
        key === "l" ? (event.shiftKey ? "shape:arrow" : "shape:line") :
        key === "t" ? "text" :
        null;

      if (!shortcutTool) return;
      event.preventDefault();
      setActiveCanvasTool(shortcutTool);
      if (shortcutTool !== "select") setSelectedIds([]);
      setShapeMenuOpen(false);
      setFontMenuOpen(false);
      setQuickEditOpen(false);
      if (activeImagePanel) closeImageOperationPanel();
    };

    window.addEventListener("keydown", handleGlobalCanvasKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalCanvasKeyDown);
  });

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setIsAuthenticated(true);
        setUserId(data.user.id);
        getCachedProfileCredits(data.user.id).then(setCredits);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setIsAuthenticated(true);
        setUserId(session.user.id);
        getCachedProfileCredits(session.user.id).then(setCredits);
      } else {
        setIsAuthenticated(false);
        setUserId(null);
        setCredits(null);
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!supportedSizes.includes(imageSize)) setImageSize(supportedSizes[0] || DEFAULT_IMAGE_SIZE);
  }, [imageSize, supportedSizes]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const savedDocument = deserialize(stored, createLovartInitialDocument());
        const isSeedDocument =
          savedDocument.nodes.length === 2 &&
          savedDocument.nodes.some((node) => node.id === "source-image") &&
          savedDocument.nodes.some((node) => node.id === "result-image");
        const nextDocument =
          isSeedDocument && (savedDocument.viewport.x !== 318 || savedDocument.viewport.y !== 285 || savedDocument.viewport.zoom !== 0.58)
            ? createLovartInitialDocument()
            : savedDocument;
        setDocument(nextDocument);
        setAssetLibrary(documentAssetsToLibrary(nextDocument));
      } else {
        setAssetLibrary(documentAssetsToLibrary(document));
      }
    } catch {
      setAssetLibrary(documentAssetsToLibrary(document));
    } finally {
      setHydrated(true);
    }
    // Only hydrate once from local storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      window.localStorage.setItem(STORAGE_KEY, serialize(document));
    }, 280);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [document, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const flushDocument = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      try {
        const currentDocument = documentRef.current;
        if (currentDocument) window.localStorage.setItem(STORAGE_KEY, serialize(currentDocument));
      } catch {
        // Canvas persistence is best-effort; editing should never be blocked by storage.
      }
    };

    const handleVisibilityChange = () => {
      if (window.document.visibilityState === "hidden") flushDocument();
    };

    window.addEventListener("beforeunload", flushDocument);
    window.document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", flushDocument);
      window.document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [hydrated]);

  function commit(
    nextDocument: CanvasDocument,
    nextSelectedIds = selectedIdsRef.current,
    historyEntry: CanvasHistoryEntry = {
      document: documentRef.current || document,
      selectedIds: selectedIdsRef.current,
    }
  ) {
    setHistory((prev) => [...prev.slice(-HISTORY_LIMIT + 1), historyEntry]);
    setFuture([]);
    setDocument(nextDocument);
    setSelectedIds(nextSelectedIds);
    setAssetLibrary(documentAssetsToLibrary(nextDocument));
  }

  function updateDocumentWithoutHistory(nextDocument: CanvasDocument, nextSelectedIds = selectedIdsRef.current) {
    setDocument(nextDocument);
    setSelectedIds(nextSelectedIds);
    setAssetLibrary(documentAssetsToLibrary(nextDocument));
  }

  function undo() {
    setHistory((prev) => {
      const entry = prev[prev.length - 1];
      if (!entry) return prev;
      setFuture((items) => [{ document, selectedIds }, ...items].slice(0, HISTORY_LIMIT));
      setDocument(entry.document);
      setSelectedIds(entry.selectedIds);
      setAssetLibrary(documentAssetsToLibrary(entry.document));
      return prev.slice(0, -1);
    });
  }

  function redo() {
    setFuture((prev) => {
      const entry = prev[0];
      if (!entry) return prev;
      setHistory((items) => [...items.slice(-HISTORY_LIMIT + 1), { document, selectedIds }]);
      setDocument(entry.document);
      setSelectedIds(entry.selectedIds);
      setAssetLibrary(documentAssetsToLibrary(entry.document));
      return prev.slice(1);
    });
  }

  function handleNodesChange(nextNodes: BoardNode[], meta: { transient?: boolean }) {
    const sourceDocument = documentRef.current || document;
    const nextDocument = syncMarkerTargetData(createCanvasDocument({
      ...sourceDocument,
      nodes: boardNodesToDocumentNodes(nextNodes, sourceDocument),
    }), new Set(selectedIdsRef.current));
    if (meta.transient) {
      if (!transientBeforeRef.current) {
        transientBeforeRef.current = {
          document: sourceDocument,
          selectedIds: selectedIdsRef.current,
        };
      }
      setDocument(nextDocument);
      return;
    }
    const historyEntry = transientBeforeRef.current || undefined;
    transientBeforeRef.current = null;
    commit(nextDocument, selectedIdsRef.current, historyEntry);
  }

  function handleViewportChange(nextViewport: BoardViewport) {
    setDocument((prev) => createCanvasDocument({
      ...prev,
      viewport: {
        ...prev.viewport,
        x: nextViewport.x,
        y: nextViewport.y,
        zoom: nextViewport.zoom,
      },
    }));
  }

  function handleCommand(command: CanvasCommand) {
    if (command.type === "undo") {
      undo();
      return;
    }
    if (command.type === "redo") {
      redo();
      return;
    }
  }

  function handleSelectionChange(nextSelectedIds: CanvasNodeId[], _meta: CanvasSelectionMeta) {
    const currentSelectedIds = selectedIdsRef.current;
    const selectionUnchanged =
      nextSelectedIds.length === currentSelectedIds.length &&
      nextSelectedIds.every((id) => currentSelectedIds.includes(id));
    const keepImagePanel =
      selectionUnchanged &&
      activeImagePanel &&
      nextSelectedIds.length === 1 &&
      selectedNode?.type === "image" &&
      nextSelectedIds[0] === selectedNode.id;
    const keepCropPreview = activeImagePanel === "crop" && keepImagePanel;

    if (activeImagePanel === "adjust" && !keepImagePanel) {
      commitPendingAdjust();
    }

    if (activeImagePanel === "crop" && !keepCropPreview) {
      updateDocumentWithoutHistory(cancelCropPreviewsInDocument(documentRef.current || document), nextSelectedIds);
    } else {
      setSelectedIds(nextSelectedIds);
    }

    if (!selectionUnchanged) {
      setQuickEditOpen(false);
      setFontMenuOpen(false);
      setShapeMenuOpen(false);
    }
    if (!keepImagePanel) setActiveImagePanel(null);
  }

  function selectNodeFromSidebar(id: CanvasNodeId) {
    const sourceDocument = documentRef.current || document;
    const nextSelectedIds = getDocumentSelectionIdsForNode(sourceDocument, id);
    setActiveCanvasTool("select");
    handleSelectionChange(nextSelectedIds, { action: "replace", source: "toolbar" });
  }

  function addTextNode() {
    const node = createNode({
      id: createId("text"),
      type: "text",
      name: "文字",
      text: "双击这里改文案",
      x: 40,
      y: 40,
      width: 260,
      height: 56,
      fill: "#111827",
      fontSize: 24,
      zIndex: document.nodes.length,
    });
    commit(createCanvasDocument({ ...document, nodes: [...document.nodes, node] }), [node.id]);
  }

  function addShapeNode() {
    const node = createNode({
      id: createId("shape"),
      type: "rect",
      name: "形状",
      x: 80,
      y: 120,
      width: 220,
      height: 140,
      fill: "#ede9fe",
      stroke: "#a78bfa",
      strokeWidth: 1,
      radius: 24,
      zIndex: document.nodes.length,
    });
    commit(createCanvasDocument({ ...document, nodes: [...document.nodes, node] }), [node.id]);
  }

  function updateSelectedNode(patch: Partial<CanvasNode>) {
    const nodeId = selectedNode?.id;
    if (!nodeId) return;
    const sourceDocument = documentRef.current || document;
    const nextNodes = sourceDocument.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node));
    commit(createCanvasDocument({ ...sourceDocument, nodes: nextNodes }), [nodeId]);
  }

  function groupSelectedNodes() {
    if (selectedIds.length < 2) return;
    const sourceDocument = documentRef.current || document;
    const selectedSet = new Set(selectedIds);
    const groupId = createId("group");
    const nextNodes = sourceDocument.nodes.map((node) => (
      selectedSet.has(node.id) && !node.locked
        ? { ...node, data: { ...(node.data ?? {}), groupId } }
        : node
    ));
    commit(createCanvasDocument({ ...sourceDocument, nodes: nextNodes }), selectedIds);
    toast.success("已编组");
  }

  function ungroupSelectedNodes() {
    const currentSelectedIds = selectedIdsRef.current.length ? selectedIdsRef.current : selectedIds;
    if (!currentSelectedIds.length) return;

    const sourceDocument = documentRef.current || document;
    const selectedSet = new Set(currentSelectedIds);
    const selectedGroupIds = new Set(
      sourceDocument.nodes
        .filter((node) => selectedSet.has(node.id))
        .map((node) => readNodeDataString(node.data, "groupId"))
        .filter((groupId): groupId is string => Boolean(groupId)),
    );
    let changed = false;
    const nextNodes = sourceDocument.nodes.map((node) => {
      const groupId = readNodeDataString(node.data, "groupId");
      const shouldUngroup = selectedSet.has(node.id) || (groupId ? selectedGroupIds.has(groupId) : false);
      if (!shouldUngroup || node.locked || !groupId) return node;
      changed = true;
      return {
        ...node,
        data: removeNodeGroupData(node.data),
      };
    });

    if (!changed) return;
    commit(createCanvasDocument({ ...sourceDocument, nodes: nextNodes }), currentSelectedIds);
    toast.success("已取消编组");
  }

  function mergeSelectedNodes() {
    if (selectedIds.length < 2) return;
    const sourceDocument = documentRef.current || document;
    const selectedSet = new Set(selectedIds);
    const selected = sourceDocument.nodes.filter((node) => selectedSet.has(node.id));
    const bounds = getDocumentBounds(selected);
    if (!bounds) return;

    const groupId = createId("group");
    const frameId = createId("merge");
    const frame = createNode({
      id: frameId,
      type: "rect",
      name: "合并画板",
      shapeKind: "frame",
      x: bounds.x - 12,
      y: bounds.y - 12,
      width: bounds.width + 24,
      height: bounds.height + 24,
      fill: "rgba(255,255,255,0.01)",
      stroke: "#3b82f6",
      strokeWidth: 1,
      radius: 0,
      zIndex: Math.max(0, ...sourceDocument.nodes.map((node) => node.zIndex)) + 1,
      data: { mergedFrom: selectedIds, groupId },
    });
    const nextNodes = sourceDocument.nodes.map((node) => (
      selectedSet.has(node.id) && !node.locked
        ? { ...node, data: { ...(node.data ?? {}), groupId, mergedFrameId: frameId } }
        : node
    ));
    commit(createCanvasDocument({ ...sourceDocument, nodes: [...nextNodes, frame] }), [frameId, ...selectedIds]);
    toast.success("已合并为画板");
  }

  function alignSelectedNodes(alignment: "left" | "center" | "right" | "top" | "middle" | "bottom") {
    if (selectedIds.length < 2) return;
    const sourceDocument = documentRef.current || document;
    const selectedSet = new Set(selectedIds);
    const selected = sourceDocument.nodes.filter((node) => selectedSet.has(node.id) && !node.locked);
    const bounds = getDocumentBounds(selected);
    if (!bounds) return;

    const nextNodes = sourceDocument.nodes.map((node) => {
      if (!selectedSet.has(node.id) || node.locked) return node;
      if (alignment === "left") return { ...node, x: bounds.x };
      if (alignment === "center") return { ...node, x: bounds.x + bounds.width / 2 - node.width / 2 };
      if (alignment === "right") return { ...node, x: bounds.x + bounds.width - node.width };
      if (alignment === "top") return { ...node, y: bounds.y };
      if (alignment === "middle") return { ...node, y: bounds.y + bounds.height / 2 - node.height / 2 };
      return { ...node, y: bounds.y + bounds.height - node.height };
    });
    commit(createCanvasDocument({ ...sourceDocument, nodes: nextNodes }), selectedIds);
  }

  function distributeSelectedNodes(axis: "horizontal" | "vertical") {
    if (selectedIds.length < 3) return;
    const sourceDocument = documentRef.current || document;
    const selectedSet = new Set(selectedIds);
    const selected = sourceDocument.nodes
      .filter((node) => selectedSet.has(node.id) && !node.locked)
      .sort((a, b) => axis === "horizontal" ? a.x - b.x : a.y - b.y);
    if (selected.length < 3) return;

    const first = selected[0];
    const last = selected[selected.length - 1];
    const start = axis === "horizontal" ? first.x : first.y;
    const end = axis === "horizontal" ? last.x + last.width : last.y + last.height;
    const totalSize = selected.reduce((sum, node) => sum + (axis === "horizontal" ? node.width : node.height), 0);
    const gap = (end - start - totalSize) / (selected.length - 1);
    let cursor = start;
    const positions = new Map<CanvasNodeId, number>();
    for (const node of selected) {
      positions.set(node.id, cursor);
      cursor += (axis === "horizontal" ? node.width : node.height) + gap;
    }

    const nextNodes = sourceDocument.nodes.map((node) => {
      const position = positions.get(node.id);
      if (position === undefined) return node;
      return axis === "horizontal" ? { ...node, x: position } : { ...node, y: position };
    });
    commit(createCanvasDocument({ ...sourceDocument, nodes: nextNodes }), selectedIds);
  }

  function addImageNodes(items: CanvasAssetItem[], options: { select?: boolean; toastMessage?: string } = {}) {
    if (!items.length) return [];

    const sourceDocument = documentRef.current || document;
    const sizes = items.map((item) => getInsertedImageSize(item));
    const origin = getSmartImageInsertionOrigin(sourceDocument, selectedIdsRef.current, sizes, items.length);
    const columns = Math.min(2, items.length);
    const maxWidth = Math.max(...sizes.map((size) => size.width));
    const maxHeight = Math.max(...sizes.map((size) => size.height));
    const existingAssetIds = new Set(sourceDocument.assets.map((asset) => asset.id));
    const nextAssets = [...sourceDocument.assets];

    const insertedNodes = items.map((item, index) => {
      const assetId = `asset-${item.id}`;
      if (!existingAssetIds.has(assetId)) {
        existingAssetIds.add(assetId);
        nextAssets.push({
          id: assetId,
          type: "image" as const,
          src: item.url,
          name: item.name,
          width: item.width,
          height: item.height,
        });
      }

      const size = sizes[index];
      const col = index % columns;
      const row = Math.floor(index / columns);
      return createNode({
        id: createId("image"),
        type: "image",
        name: item.name,
        assetId,
        x: origin.x + col * (maxWidth + 28),
        y: origin.y + row * (maxHeight + 28),
        width: size.width,
        height: size.height,
        radius: 22,
        zIndex: sourceDocument.nodes.length + index,
      });
    });

    commit(
      createCanvasDocument({
        ...sourceDocument,
        assets: nextAssets,
        nodes: [...sourceDocument.nodes, ...insertedNodes],
      }),
      options.select === false ? selectedIdsRef.current : insertedNodes.map((node) => node.id),
    );
    if (options.toastMessage) toast.success(options.toastMessage);
    return insertedNodes;
  }

  function addImageNode(asset: CanvasAssetItem) {
    return addImageNodes([asset], { toastMessage: "已插入画布" })[0] || null;
  }

  function insertResult(result: CanvasAssistantResult) {
    const url = result.imageUrl || result.thumbnailUrl;
    if (!url) return;
    addImageNodes([{
      id: result.id,
      name: result.title || "AI 结果",
      url,
      previewUrl: result.thumbnailUrl || result.imageUrl || url,
    }], { toastMessage: "已插入画布" });
  }

  function insertGeneratedResults(resultsToInsert: CanvasAssistantResult[], options: { auto?: boolean } = {}) {
    const items = resultsToInsert.flatMap((result) => {
      const url = result.imageUrl || result.thumbnailUrl;
      if (!url) return [];
      if (options.auto && insertedResultUrlsRef.current.has(url)) return [];
      insertedResultUrlsRef.current.add(url);
      return [{
        id: result.id,
        name: result.title || "AI 结果",
        url,
        previewUrl: result.thumbnailUrl || result.imageUrl || url,
      }];
    });

    if (!items.length) return;
    addImageNodes(items, {
      toastMessage: options.auto ? `生成完成，已放入画布 ${items.length} 张` : `已插入 ${items.length} 张结果图`,
    });
  }

  function getImageReferenceAttachments(nodes: CanvasNode[], sourceDocument: CanvasDocument, fallbackName = "画布参考图") {
    return nodes.flatMap((node, index): CanvasAssistantAttachment[] => {
      const url = getImageSource(node, sourceDocument);
      if (!url) return [];
      return [{
        id: `ref-${node.id}-${Date.now()}-${index}`,
        name: node.name || fallbackName,
        url,
        previewUrl: getImageVariantUrl(url, "thumb"),
        status: "ready",
      }];
    });
  }

  function mergeAttachments(items: CanvasAssistantAttachment[], existing: CanvasAssistantAttachment[]) {
    return [...items, ...existing.filter((item) => !items.some((next) => next.url && next.url === item.url))].slice(0, 12);
  }

  async function handleUploadAssets(files: File[], options: UploadAssetsOptions = { attachToPrompt: true }) {
    const shouldAttachToPrompt = options.attachToPrompt !== false;
    const selected = files.filter((file) => file.type.startsWith("image/"));
    if (!selected.length) return toast.error("请选择图片文件");
    const oversized = selected.find((file) => file.size > MAX_FILE_SIZE);
    if (oversized) return toast.error(`${oversized.name} 超过 ${MAX_FILE_SIZE_MB}MB`);

    setIsUploadingAsset(true);
    const pendingAttachments = selected.map((file, index) => ({
      id: `upload-${Date.now()}-${index}`,
      name: file.name,
      status: "uploading" as const,
    }));
    if (shouldAttachToPrompt) {
      setAttachments((prev) => [...pendingAttachments, ...prev].slice(0, 12));
    }
    try {
      const uploaded = await Promise.all(selected.map((file) => uploadImage(file)));
      const uploadedAssets = uploaded.map((item, index) => ({
        id: createId("upload"),
        name: selected[index].name || `上传图片 ${index + 1}`,
        url: item.url,
        previewUrl: item.display_url || item.url,
        width: item.width,
        height: item.height,
      }));
      const nextAssets = uploadedAssets.map((item) => ({
        id: `asset-${item.id}`,
        type: "image" as const,
        src: item.url,
        name: item.name,
        width: item.width,
        height: item.height,
      }));
      if (options.insertToCanvas) {
        const sourceDocument = documentRef.current || document;
        const center = options.insertAt || getCanvasCenterWorld(sourceDocument);
        const insertedNodes = uploadedAssets.map((item, index) => {
          const size = getInsertedImageSize(item);
          return createNode({
            id: createId("image"),
            type: "image",
            name: item.name,
            assetId: `asset-${item.id}`,
            x: center.x - size.width / 2 + index * 34,
            y: center.y - size.height / 2 + index * 34,
            width: size.width,
            height: size.height,
            radius: 22,
            zIndex: sourceDocument.nodes.length + index,
          });
        });
        commit(
          createCanvasDocument({
            ...sourceDocument,
            assets: [...nextAssets, ...sourceDocument.assets],
            nodes: [...sourceDocument.nodes, ...insertedNodes],
          }),
          insertedNodes.map((node) => node.id),
        );
      } else {
        setDocument((prev) => createCanvasDocument({ ...prev, assets: [...nextAssets, ...prev.assets] }));
      }
      setAssetLibrary((prev) => [...uploadedAssets, ...prev].slice(0, 36));
      if (shouldAttachToPrompt) {
        setAttachments((prev) => [
          ...uploadedAssets.map((item) => ({ id: item.id, name: item.name, url: item.url, previewUrl: item.previewUrl, status: "ready" as const })),
          ...prev.filter((item) => !pendingAttachments.some((pending) => pending.id === item.id)),
        ].slice(0, 12));
      }
      toast.success(options.insertToCanvas ? `已添加 ${uploadedAssets.length} 张图片到画布` : `已上传 ${uploadedAssets.length} 张参考图`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "上传失败";
      if (shouldAttachToPrompt) {
        setAttachments((prev) => prev.map((item) => pendingAttachments.some((pending) => pending.id === item.id) ? { ...item, status: "error", error: message } : item));
      }
      toast.error(message);
    } finally {
      setIsUploadingAsset(false);
    }
  }

  function hasCanvasFileDrag(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types || []).includes("Files");
  }

  function getCanvasDropWorldPoint(event: DragEvent<HTMLElement>): CanvasPoint {
    const sourceDocument = documentRef.current || document;
    const rect = event.currentTarget.getBoundingClientRect();
    const zoom = Math.max(sourceDocument.viewport.zoom, 0.01);
    return {
      x: (event.clientX - rect.left - sourceDocument.viewport.x) / zoom,
      y: (event.clientY - rect.top - sourceDocument.viewport.y) / zoom,
    };
  }

  function handleCanvasDragEnter(event: DragEvent<HTMLElement>) {
    if (!hasCanvasFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsCanvasAssetDragOver(true);
  }

  function handleCanvasDragOver(event: DragEvent<HTMLElement>) {
    if (!hasCanvasFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsCanvasAssetDragOver(true);
  }

  function handleCanvasDragLeave(event: DragEvent<HTMLElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsCanvasAssetDragOver(false);
  }

  function handleCanvasDrop(event: DragEvent<HTMLElement>) {
    if (!hasCanvasFileDrag(event)) return;
    event.preventDefault();
    setIsCanvasAssetDragOver(false);

    const imageFiles = Array.from(event.dataTransfer.files || []).filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return toast.error("请拖入图片文件");

    void handleUploadAssets(imageFiles, {
      insertToCanvas: true,
      attachToPrompt: false,
      insertAt: getCanvasDropWorldPoint(event),
    });
  }

  async function generateImage(options: GenerateImageOptions = {}) {
    if (isGenerating) {
      toast.message("正在生成中，请稍等");
      return;
    }
    const effectivePrompt = options.promptOverride ?? prompt;
    const effectiveAttachments = options.attachmentsOverride ?? attachments;
    const effectiveMode = options.modeOverride ?? assistantMode;

    if (!isAuthenticated) {
      toast.error("请先登录");
      router.push("/login?next=%2Fcanvas");
      return;
    }
    if (!effectivePrompt.trim() && !effectiveAttachments.some((item) => item.url)) return toast.error("请输入设计需求或上传参考图");
    if (credits !== null && credits < cost) return toast.error(`积分不足，需要 ${cost}，余额 ${credits}`);

    setIsGenerating(true);
    setGenerationError(null);
    setProgress(8);
    insertedResultUrlsRef.current = new Set();
    try {
      const referenceUrls = effectiveAttachments.map((item) => item.url).filter((url): url is string => Boolean(url));
      const res = await fetch("/api/general-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: effectiveMode === "generate" && referenceUrls.length === 0 ? "text-to-image" : "image-to-image",
          prompt: effectivePrompt.trim() || "基于参考图生成适合电商视觉画布的商品图片",
          reference_urls: referenceUrls,
          ai_model: aiModel,
          aspect_ratio: generationAspectRatio,
          image_size: effectiveImageSize,
          gen_count: generationCount,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
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

      const maxPollAttempts = Math.max(150, generationCount * 90);
      for (let attempts = 0; attempts < maxPollAttempts; attempts++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const poll = await fetch(`/api/general-image?generation_id=${encodeURIComponent(data.generation_id)}`);
        if (!poll.ok) continue;
        const state = await poll.json();
        const nextProgress = Number(state.progress);
        if (Number.isFinite(nextProgress)) setProgress(Math.min(Math.max(Math.round(nextProgress), 0), 100));
        const urls = Array.isArray(state.result_urls)
          ? state.result_urls.filter((url: unknown): url is string => typeof url === "string" && url.length > 0)
          : [];
        const nextResults = urls.map((url: string, index: number) => createAssistantResult(url, effectivePrompt, aiModel, effectiveImageSize, index));
        if (urls.length) {
          setResults(nextResults);
        }
        if (state.status === "completed") {
          setProgress(100);
          setIsGenerating(false);
          if (!urls.length) throw new Error("生成完成但没有返回图片");
          insertGeneratedResults(nextResults, { auto: true });
          return;
        }
        if (state.status === "failed") throw new Error(state.error || "生成失败");
      }
      throw new Error("生成超时");
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败";
      setGenerationError(message);
      toast.error(message);
      setIsGenerating(false);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  }

  function addSelectedImagesAsReferences(mode: CanvasAssistantMode = "reference") {
    const items = getImageReferenceAttachments(selectedImageNodes, document, "画布参考图");

    if (!items.length) return toast.error("请先选中画布里的图片");
    setAttachments((prev) => mergeAttachments(items, prev));
    setAssistantMode(mode);
    setPanelOpen(true);
    toast.success(mode === "edit" ? "已进入图片编辑模式" : "已作为参考图加入 AI 面板");
  }

  function editSelectedImage() {
    addSelectedImagesAsReferences("edit");
    setQuickEditPrompt("");
    setQuickEditOpen(true);
    window.setTimeout(() => quickEditInputRef.current?.focus(), 0);
  }

  function activateLovartTool(label: string, mode: CanvasAssistantMode = "edit") {
    setActiveOperation(label);
    setAssistantMode(mode);
    if (selectedImageNodes.length > 0) {
      addSelectedImagesAsReferences(mode);
    }
    if (!prompt.trim()) {
      setPrompt(`${label}：保持商品主体、构图和质感一致，输出可直接用于电商视觉的高清结果。`);
    }
    window.setTimeout(() => setActiveOperation(null), 2200);
    toast.success(`${label} 前端流程已就绪，等待接入阿里云接口`);
  }

  function openImagePanel(panel: NonNullable<LovartImagePanel>, label: string, mode: CanvasAssistantMode = "edit") {
    if (!selectedImageNodes.length) {
      toast.error("请先选择一张图片");
      return;
    }
    if (activeImagePanel === "adjust" && panel !== "adjust") {
      commitPendingAdjust();
    }
    if (panel === "adjust") {
      setAdjustValues(readStoredAdjustValues(singleImageNode ?? primaryImageNode));
    }
    if (panel === "crop") {
      previewSelectedImageCrop(singleImageNode?.cropRatio || "original");
    } else if (activeImagePanel === "crop") {
      updateDocumentWithoutHistory(cancelCropPreviewsInDocument(documentRef.current || document));
    }
    setActiveImagePanel(panel);
    setActiveOperation(label);
    setAssistantMode(mode);
    if (mode !== "edit") addSelectedImagesAsReferences(mode);
    window.setTimeout(() => setActiveOperation(null), 900);
  }

  function closeImageOperationPanel() {
    if (activeImagePanel === "crop") {
      updateDocumentWithoutHistory(cancelCropPreviewsInDocument(documentRef.current || document));
    }
    if (activeImagePanel === "adjust") {
      commitPendingAdjust();
    }
    setActiveImagePanel(null);
  }

  function openPromptComposer() {
    setPanelOpen(true);
    setActiveCanvasTool("select");
    setShapeMenuOpen(false);
    setQuickEditOpen(false);
    setFontMenuOpen(false);
    if (activeImagePanel) closeImageOperationPanel();
    window.setTimeout(() => promptInputRef.current?.focus(), 0);
  }

  function resetComposerConversation() {
    setPrompt("");
    setAttachments([]);
    setResults([]);
    setGenerationError(null);
    setProgress(0);
    setAssistantMode("generate");
    setQuickEditOpen(false);
    setActiveOperation(null);
    setPanelOpen(true);
    window.setTimeout(() => promptInputRef.current?.focus(), 0);
  }

  function shareCanvas() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (!url || typeof navigator === "undefined" || !navigator.clipboard) {
      toast.success("分享入口已准备");
      return;
    }
    void navigator.clipboard
      .writeText(url)
      .then(() => toast.success("画板链接已复制"))
      .catch(() => toast.success("分享入口已准备"));
  }

  function openGeneratedLibrary() {
    setLeftPanel("files");
    if (!results.length) toast.message("还没有生成文件，生成后会出现在这里。");
  }

  function applySkillPrompt(skill: LovartSkillAction) {
    setAssistantMode(skill.mode);
    setPrompt(skill.prompt);
    setGenerationError(null);
    setPanelOpen(true);
    window.setTimeout(() => promptInputRef.current?.focus(), 0);
  }

  function applyImageRatio(ratioValue: string) {
    const preset = previewSelectedImageCrop(ratioValue);
    if (!preset) return;
    toast.success(`已套用 ${preset.label}`);
  }

  function previewSelectedImageCrop(ratioValue: string) {
    const preset = RATIO_PRESETS.find((item) => item.value === ratioValue) || RATIO_PRESETS[0];
    const sourceDocument = documentRef.current || document;
    const selectedSet = new Set(selectedIdsRef.current);
    let changed = false;
    const nextNodes = sourceDocument.nodes.map((node) => {
      if (!selectedSet.has(node.id) || node.type !== "image" || node.locked) return node;
      changed = true;
      return applyCropPreviewToImageNode(node, preset.value, preset.ratio);
    });
    if (!changed) return null;
    updateDocumentWithoutHistory(createCanvasDocument({ ...sourceDocument, nodes: nextNodes }));
    return preset;
  }

  function expandSelectedImages(scale: number, ratioValue: string) {
    if (!selectedImageNodes.length) return;
    const preset = RATIO_PRESETS.find((item) => item.value === ratioValue);
    updateSelectedNodes((node) => {
      if (node.type !== "image") return node;
      return applyExpandedFrameToImageNode(node, Math.max(scale, 1), preset?.value ?? "original", preset?.ratio ?? null);
    });
    setActiveOperation("扩图");
    window.setTimeout(() => setActiveOperation(null), 1400);
    toast.success("扩图参数已应用到画布，接口接入后可直接生成");
  }

  function commitImageCrop() {
    if (!selectedImageNodes.length) return;
    const sourceDocument = documentRef.current || document;
    const selectedSet = new Set(selectedIdsRef.current);
    const baselineDocument = cancelCropPreviewsInDocument(sourceDocument);
    const nextNodes = sourceDocument.nodes.map((node) => {
      if (node.type !== "image") return node;
      if (selectedSet.has(node.id)) return commitCropPreviewToImageNode(node);
      return cancelCropPreviewToImageNode(node);
    });
    commit(createCanvasDocument({ ...sourceDocument, nodes: nextNodes }), selectedIdsRef.current, {
      document: baselineDocument,
      selectedIds: selectedIdsRef.current,
    });
    setActiveImagePanel(null);
    toast.success("裁切已应用");
  }

  function writeAdjustValuesToSelectedImages(nextValues: ImageAdjustValues, historyMode: "transient" | "commit") {
    setAdjustValues(nextValues);
    const currentSelectedIds = selectedIdsRef.current.length ? selectedIdsRef.current : selectedIds;
    if (!currentSelectedIds.length) return;
    const sourceDocument = documentRef.current || document;
    const selectedSet = new Set(currentSelectedIds);
    const filter = isDefaultAdjustValues(nextValues) ? undefined : buildImageFilter(nextValues);
    let changed = false;
    const nextDocument = createCanvasDocument({
      ...sourceDocument,
      nodes: sourceDocument.nodes.map((node) => {
        if (!selectedSet.has(node.id) || node.type !== "image" || node.locked) return node;
        const nextData = writeStoredAdjustValues(node.data, nextValues);
        if (node.filter === filter && shallowRecordEqual(node.data, nextData)) return node;
        changed = true;
        return { ...node, filter, data: nextData };
      }),
    });
    if (!changed && !adjustBeforeRef.current) return;

    if (historyMode === "transient") {
      if (!adjustBeforeRef.current) {
        adjustBeforeRef.current = {
          document: sourceDocument,
          selectedIds: currentSelectedIds,
        };
      }
      updateDocumentWithoutHistory(nextDocument, currentSelectedIds);
      return;
    }

    const historyEntry = adjustBeforeRef.current || {
      document: sourceDocument,
      selectedIds: currentSelectedIds,
    };
    adjustBeforeRef.current = null;
    commit(nextDocument, currentSelectedIds, historyEntry);
  }

  function applyAdjustValues(nextValues: ImageAdjustValues) {
    writeAdjustValuesToSelectedImages(nextValues, "transient");
  }

  function commitAdjustValues(nextValues: ImageAdjustValues = adjustValues) {
    writeAdjustValuesToSelectedImages(nextValues, "commit");
  }

  function commitPendingAdjust() {
    const historyEntry = adjustBeforeRef.current;
    if (!historyEntry) return;
    adjustBeforeRef.current = null;
    commit(documentRef.current || document, historyEntry.selectedIds, historyEntry);
  }

  function resetAdjustValues() {
    writeAdjustValuesToSelectedImages(DEFAULT_ADJUST_VALUES, "commit");
  }

  function rotateSelectedImages(delta: number) {
    updateSelectedNodes((node) => (node.type === "image" ? { ...node, rotation: Math.round((node.rotation || 0) + delta) } : node));
  }

  function setSelectedImageRotation(angle: number) {
    const normalizedAngle = Number.isFinite(angle) ? Math.round(angle) : 0;
    updateSelectedNodes((node) => (node.type === "image" ? { ...node, rotation: normalizedAngle } : node));
  }

  function flipSelectedImages(axis: "x" | "y") {
    updateSelectedNodes((node) => {
      if (node.type !== "image") return node;
      return axis === "x" ? { ...node, flipX: !node.flipX } : { ...node, flipY: !node.flipY };
    });
  }

  function applyCanvasBackground(background: string) {
    const sourceDocument = documentRef.current || document;
    commit(createCanvasDocument({ ...sourceDocument, background }), selectedIds);
    setCanvasColorOpen(false);
  }

  function jumpViewportTo(worldX: number, worldY: number) {
    const root = window.document.querySelector("[data-canvas-stage='true']");
    const rect = root?.getBoundingClientRect();
    const width = rect?.width || 1200;
    const height = rect?.height || 780;
    handleViewportChange({
      zoom: document.viewport.zoom,
      x: width / 2 - worldX * document.viewport.zoom,
      y: height / 2 - worldY * document.viewport.zoom,
    });
  }

  function runQuickEdit() {
    const text = quickEditPrompt.trim();
    if (!text) {
      quickEditInputRef.current?.focus();
      return;
    }
    const references = getImageReferenceAttachments(selectedImageNodes, document, "编辑参考图");
    if (!references.length) return toast.error("请先选中一张图片");
    const nextAttachments = mergeAttachments(references, attachments);
    setAttachments(nextAttachments);
    setPrompt(text);
    setAssistantMode("edit");
    setPanelOpen(true);
    setQuickEditOpen(false);
    void generateImage({
      promptOverride: text,
      attachmentsOverride: nextAttachments,
      modeOverride: "edit",
    });
  }

  function runMarkerQuickEdit(text: string) {
    const marker = selectedMarkerNode;
    const draft = text.trim();
    if (!marker || !draft) {
      quickEditInputRef.current?.focus();
      return;
    }

    const targetImage = selectedMarkerTargetImageNode || findMarkerTargetImage(marker, document);
    const markerLabel = getMarkerLabel(marker);
    const nextPrompt = `标记 ${marker.text || "1"}（${markerLabel}）：${draft}`;
    let nextAttachments = attachments;
    if (targetImage) {
      const url = getImageSource(targetImage, document);
      if (url) {
        const item: CanvasAssistantAttachment = {
          id: `marker-ref-${targetImage.id}-${Date.now()}`,
          name: targetImage.name || "标记图片",
          url,
          previewUrl: getImageVariantUrl(url, "thumb"),
          status: "ready",
        };
        nextAttachments = mergeAttachments([item], attachments);
        setAttachments(nextAttachments);
      }
    }

    updateSelectedNodes((node) => {
      if (node.id !== marker.id) return node;
      return {
        ...node,
        data: {
          ...(node.data || {}),
          markerPrompt: draft,
        },
      };
    });
    setPrompt(nextPrompt);
    setAssistantMode("edit");
    setPanelOpen(true);
    void generateImage({
      promptOverride: nextPrompt,
      attachmentsOverride: nextAttachments,
      modeOverride: "edit",
    });
  }

  function updateSelectedMarkerLabel(label: string) {
    const marker = selectedMarkerNode;
    if (!marker) return;
    updateSelectedNodes((node) => {
      if (node.id !== marker.id) return node;
      const trimmed = label.trim();
      return {
        ...node,
        name: trimmed ? `标记 ${node.text || ""} ${trimmed}` : node.name,
        data: {
          ...(node.data || {}),
          tagLabel: label,
        },
      };
    });
  }

  function previewSelectedImage() {
    const targetNode = singleImageNode || primaryImageNode;
    const targetUrl = singleImageUrl || selectedImageUrl;
    if (!targetNode || !targetUrl) return toast.error("请先选中一张图片");
    setPreviewImage({ url: targetUrl, name: targetNode.name || "画布图片" });
  }

  function downloadSelectedImage() {
    const targetNode = singleImageNode || primaryImageNode;
    const targetUrl = singleImageUrl || selectedImageUrl;
    if (!targetNode || !targetUrl) return toast.error("请先选中一张图片");
    const filename = `${targetNode.name || "canvas-image"}.jpg`;
    window.open(`/api/download-image?url=${encodeURIComponent(targetUrl)}&filename=${encodeURIComponent(filename)}`, "_blank", "noopener,noreferrer");
  }

  function downloadResultImage(result: CanvasAssistantResult) {
    const url = result.imageUrl || result.thumbnailUrl;
    if (!url) return toast.error("结果图还没有生成完成");
    const filename = `${result.title || "canvas-result"}.jpg`;
    window.open(`/api/download-image?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`, "_blank", "noopener,noreferrer");
  }

  function startReplaceSelectedImage() {
    const targetNode = singleImageNode || primaryImageNode;
    if (!targetNode) return toast.error("请先选中一张图片");
    setReplaceTargetId(targetNode.id);
    replaceInputRef.current?.click();
  }

  async function replaceImageNode(file?: File) {
    const targetId = replaceTargetId || singleImageNode?.id || primaryImageNode?.id;
    setReplaceTargetId(null);
    if (!targetId || !file) return;
    if (!file.type.startsWith("image/")) return toast.error("请选择图片文件");
    if (file.size > MAX_FILE_SIZE) return toast.error(`${file.name} 超过 ${MAX_FILE_SIZE_MB}MB`);

    setIsUploadingAsset(true);
    try {
      const uploaded = await uploadImage(file);
      const assetId = `asset-${createId("replace")}`;
      const nextAsset = {
        id: assetId,
        type: "image" as const,
        src: uploaded.url,
        name: file.name || "替换图片",
        width: uploaded.width,
        height: uploaded.height,
      };
      const nextDocument = createCanvasDocument({
        ...document,
        assets: [nextAsset, ...document.assets],
        nodes: document.nodes.map((node) =>
          node.id === targetId && node.type === "image"
            ? {
                ...node,
                assetId,
                src: undefined,
                alt: file.name || node.alt,
                name: node.name || file.name,
              }
            : node,
        ),
      });
      commit(nextDocument, [targetId]);
      toast.success("图片已替换");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "替换失败");
    } finally {
      setIsUploadingAsset(false);
    }
  }

  function moveSelectedLayer(direction: "forward" | "backward" | "front" | "back") {
    if (!selectedIds.length) return;
    if (direction === "forward") {
      commit(bringForward(document, selectedIds), selectedIds);
      return;
    }
    if (direction === "backward") {
      commit(sendBackward(document, selectedIds), selectedIds);
      return;
    }

    const selectedSet = new Set(selectedIds);
    const ordered = [...document.nodes].sort((a, b) => a.zIndex - b.zIndex);
    const picked = ordered.filter((node) => selectedSet.has(node.id));
    const rest = ordered.filter((node) => !selectedSet.has(node.id));
    const nodes = direction === "front" ? [...rest, ...picked] : [...picked, ...rest];
    commit(createCanvasDocument({ ...document, nodes }), selectedIds);
  }

  function resizeSelectedImages(ratio: number) {
    if (!selectedImageNodes.length) return;
    const selectedSet = new Set(selectedImageNodes.map((node) => node.id));
    const nextDocument = createCanvasDocument({
      ...document,
      nodes: document.nodes.map((node) => {
        if (!selectedSet.has(node.id) || node.type !== "image" || node.locked) return node;
        const width = node.width;
        const height = Math.max(48, width / ratio);
        return {
          ...node,
          y: node.y + (node.height - height) / 2,
          height,
        };
      }),
    });
    commit(nextDocument, selectedIds);
  }

  function updateSelectedNodes(updater: (node: CanvasNode) => CanvasNode) {
    const currentSelectedIds = selectedIdsRef.current.length ? selectedIdsRef.current : selectedIds;
    if (!currentSelectedIds.length) return;
    const sourceDocument = documentRef.current || document;
    const selectedSet = new Set(currentSelectedIds);
    const nextDocument = createCanvasDocument({
      ...sourceDocument,
      nodes: sourceDocument.nodes.map((node) => (selectedSet.has(node.id) && !node.locked ? updater(node) : node)),
    });
    commit(nextDocument, currentSelectedIds);
  }

  function applySelectedFill(fill: string) {
    updateSelectedNodes((node) => ({
      ...node,
      fill,
    }));
  }

  function applySelectedRadius(radius: number) {
    updateSelectedNodes((node) => ({
      ...node,
      radius,
    }));
  }

  function applySelectedOpacity(opacity: number) {
    updateSelectedNodes((node) => ({
      ...node,
      opacity,
    }));
  }

  function deleteSelected() {
    if (!selectedIds.length) return;
    const nextDocument = createCanvasDocument({
      ...document,
      nodes: document.nodes.filter((node) => !selectedIds.includes(node.id) || node.locked),
    });
    commit(nextDocument, []);
  }

  function duplicateSelected() {
    if (!selectedIds.length) return;
    const duplicated = rekeyDuplicatedGroupData(duplicateNodes(document, selectedIds), document);
    const newIds = duplicated.nodes.filter((node) => !document.nodes.some((old) => old.id === node.id)).map((node) => node.id);
    commit(duplicated, newIds);
  }

  function fitCanvas() {
    const root = window.document.querySelector("[data-canvas-stage='true']");
    const rect = root?.getBoundingClientRect();
    const bounds = getDocumentBounds(document.nodes);
    const viewportWidth = rect?.width || 1200;
    const viewportHeight = rect?.height || 780;
    if (!bounds) return;

    const padding = 160;
    const zoom = Math.min(
      Math.max(
        Math.min(
          (viewportWidth - padding) / Math.max(bounds.width, 1),
          (viewportHeight - padding) / Math.max(bounds.height, 1)
        ),
        0.18
      ),
      1.4
    );
    setDocument((prev) => createCanvasDocument({
      ...prev,
      viewport: {
        ...prev.viewport,
        x: viewportWidth / 2 - (bounds.x + bounds.width / 2) * zoom,
        y: viewportHeight / 2 - (bounds.y + bounds.height / 2) * zoom,
        zoom,
      },
    }));
  }

  function exportSvgFile() {
    const svg = exportToSvg(document, { padding: 24, background: "#f8fafc" });
    downloadTextFile(svg, `${document.name || "canvas"}.svg`, "image/svg+xml");
  }

  function exportJsonFile() {
    downloadTextFile(serialize(document), `${document.name || "canvas"}.json`, "application/json");
  }

  function importJsonFile(file?: File) {
    if (!file) return;
    file.text().then((text) => {
      const next = deserialize(text, document);
      commit(next, []);
      toast.success("画布已导入");
    }).catch(() => toast.error("导入失败"));
  }

  function rememberDismissedGuide(key: string) {
    try {
      window.localStorage.setItem(key, "dismissed");
    } catch {
      // Guide persistence should never block canvas work.
    }
  }

  function dismissBrandGuide() {
    setBrandGuideOpen(false);
    rememberDismissedGuide(BRAND_GUIDE_STORAGE_KEY);
  }

  function dismissMinimapGuide() {
    setMinimapGuideOpen(false);
    rememberDismissedGuide(MINIMAP_GUIDE_STORAGE_KEY);
  }

  const panelResults = isGenerating && !results.length
    ? [{ id: "generating", status: "generating" as const, title: `正在生成 ${generationCount} 张`, prompt, model: aiModel, quality: imageSize }]
    : results;

  const operationLabel = activeOperation || (isGenerating ? "生成中" : null);
  const showSelectionChrome = activeCanvasTool === "select";

  return (
      <div className="relative h-dvh min-h-[720px] overflow-hidden bg-[#f4f4f4] text-[#171717]">
        <input ref={assetInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { handleUploadAssets(Array.from(event.target.files || []), { insertToCanvas: true, attachToPrompt: false }); event.currentTarget.value = ""; }} />
        <input ref={attachmentInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { handleUploadAssets(Array.from(event.target.files || []), { attachToPrompt: true }); event.currentTarget.value = ""; }} />
        <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { importJsonFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        <input ref={replaceInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { replaceImageNode(event.target.files?.[0]); event.currentTarget.value = ""; }} />

        <LovartDocumentBar
          title={document.name || "未命名"}
          credits={credits}
          chatOpen={panelOpen}
          onToggleChat={() => {
            if (panelOpen) setPanelOpen(false);
            else openPromptComposer();
          }}
          onShare={shareCanvas}
          onExport={exportJsonFile}
        />

        <section
          data-canvas-stage="true"
          className={`absolute inset-y-0 left-0 overflow-hidden transition-[right] duration-200 ${panelOpen ? "right-[360px]" : "right-0"}`}
          onDragEnter={handleCanvasDragEnter}
          onDragOver={handleCanvasDragOver}
          onDragLeave={handleCanvasDragLeave}
          onDrop={handleCanvasDrop}
        >
          <LovartBrandGuide
            open={guidePreferencesLoaded && brandGuideOpen}
            onClose={dismissBrandGuide}
            onAttach={() => {
              dismissBrandGuide();
              toast.success("品牌套件入口已预留，后续可接入品牌规则");
            }}
          />

          <LovartLeftSidebar
            panel={leftPanel}
            document={document}
            selectedIds={selectedIds}
            historyCount={history.length}
            futureCount={future.length}
            results={results}
            onClose={() => setLeftPanel(null)}
            onUndo={undo}
            onRedo={redo}
            onSelectNode={selectNodeFromSidebar}
            onInsertResult={insertResult}
            onPreviewResult={(result) => {
              const url = result.imageUrl || result.thumbnailUrl;
              if (url) setPreviewImage({ url, name: result.title || "AI 结果" });
            }}
            onDownloadResult={downloadResultImage}
          />

          <CanvasBoard
            nodes={boardNodes}
            selectedIds={selectedIds}
            viewport={viewport}
            onNodesChange={handleNodesChange}
            onSelectionChange={handleSelectionChange}
            onViewportChange={handleViewportChange}
            onCommand={handleCommand}
            className="h-full min-h-0 rounded-none border-0 bg-[#f4f4f4] shadow-none"
            backgroundColor={document.background || "#f4f4f4"}
            gridSize={32}
            showGrid={false}
            showControls={false}
            minZoom={0.08}
            maxZoom={5}
            ariaLabel="VastWear Lovart-style canvas"
            activeTool={activeCanvasTool}
            drawStyle={drawStyle}
            onToolComplete={(tool) => {
              if (tool === "draw") return;
              setActiveCanvasTool("select");
              setShapeMenuOpen(false);
            }}
          />

          {isCanvasAssetDragOver && (
            <div className="pointer-events-none absolute inset-0 z-[85] flex items-center justify-center bg-neutral-950/10 backdrop-blur-[1px]">
              <div className="flex items-center gap-3 rounded-2xl border border-white/70 bg-white/92 px-5 py-4 text-sm font-semibold text-neutral-900 shadow-[0_18px_52px_rgba(15,23,42,0.18)]">
                <Upload className="h-5 w-5 text-blue-500" />
                松开导入到画布
              </div>
            </div>
          )}

          {showSelectionChrome && selectedNodes.length > 0 && selectionScreenRect && (
            <LovartSelectionMeta selectedNodes={selectedNodes} rect={selectionScreenRect} />
          )}

          {showSelectionChrome && selectedNodes.length === 1 && selectedNode && selectedNode.type !== "image" && selectedNode.shapeKind !== "marker" && selectionScreenRect && (
            <LovartObjectPropertyBar
              node={selectedNode}
              rect={selectionScreenRect}
              fontMenuOpen={fontMenuOpen}
              onToggleFontMenu={() => setFontMenuOpen((value) => !value)}
              onUpdate={updateSelectedNode}
              onDownload={exportSvgFile}
              panelOpen={panelOpen}
            />
          )}

          {showSelectionChrome && selectedNodes.length > 1 && selectionScreenRect && (
            <LovartMultiSelectionToolbar
              selectedNodes={selectedNodes}
              rect={selectionScreenRect}
              hasGroup={hasGroupedSelection}
              onGroup={groupSelectedNodes}
              onUngroup={ungroupSelectedNodes}
              onMerge={mergeSelectedNodes}
              onAlign={alignSelectedNodes}
              onDistribute={distributeSelectedNodes}
              onDuplicate={duplicateSelected}
              onLayerForward={() => moveSelectedLayer("forward")}
              onLayerBackward={() => moveSelectedLayer("backward")}
              onLayerFront={() => moveSelectedLayer("front")}
              onLayerBack={() => moveSelectedLayer("back")}
              onDownload={exportSvgFile}
              onDelete={deleteSelected}
              panelOpen={panelOpen}
            />
          )}

          {showSelectionChrome && selectedNodes.length === 1 && singleImageNode && selectionScreenRect && (
            <LovartContextToolbar
              rect={selectionScreenRect}
              panelOpen={panelOpen}
              onQuickEdit={editSelectedImage}
              showToolNames={showToolNames}
              visibleToolKeys={visibleImageToolKeys}
              onUpscale={() => openImagePanel("expand", "放大")}
              onRemoveBg={() => activateLovartTool("去背景")}
              onEraser={() => activateLovartTool("橡皮工具")}
              onEditElements={() => activateLovartTool("编辑元素")}
              onEditText={() => activateLovartTool("编辑文字")}
              onMultiAngles={() => openImagePanel("multi-angle", "多角度", "reference")}
              onMoveObject={() => activateLovartTool("移动对象")}
              onMockup={() => activateLovartTool("样机")}
              onExpand={() => openImagePanel("expand", "扩图")}
              onAdjust={() => openImagePanel("adjust", "调整")}
              onCrop={() => openImagePanel("crop", "裁剪")}
              onVector={() => activateLovartTool("矢量")}
              onFlip={() => openImagePanel("flip", "翻转与旋转")}
              onCustomizeToolbar={() => setToolbarNamesOpen(true)}
              onDownload={downloadSelectedImage}
            />
          )}

          {showSelectionChrome && (
          <LovartImageOperationPanel
            panel={activeImagePanel}
            rect={selectionScreenRect}
            selectedNode={selectedNodes.length === 1 ? singleImageNode : null}
            panelOpen={panelOpen}
            cost={cost}
            adjustValues={adjustValues}
            onClose={closeImageOperationPanel}
            onExpand={expandSelectedImages}
            onCrop={applyImageRatio}
            onCommitCrop={commitImageCrop}
            onAdjustChange={applyAdjustValues}
            onAdjustCommit={commitAdjustValues}
            onResetAdjust={resetAdjustValues}
            onRotate={rotateSelectedImages}
            onSetRotation={setSelectedImageRotation}
            onFlip={flipSelectedImages}
            onDownload={downloadSelectedImage}
            onGenerate={(label) => activateLovartTool(label)}
          />
          )}

          {showSelectionChrome && quickEditOpen && selectedNodes.length === 1 && singleImageNode && selectionScreenRect && (
            <LovartQuickEditBar
              rect={selectionScreenRect}
              panelOpen={panelOpen}
              value={quickEditPrompt}
              cost={cost}
              inputRef={quickEditInputRef}
              onChange={setQuickEditPrompt}
              onRun={runQuickEdit}
            />
          )}

          {showSelectionChrome && selectedNodes.length === 1 && selectedMarkerNode && selectedMarkerPromptRect && (
            <LovartMarkerPromptBar
              rect={selectedMarkerPromptRect}
              panelOpen={panelOpen}
              marker={selectedMarkerNode}
              value={quickEditPrompt}
              cost={cost}
              inputRef={quickEditInputRef}
              onChange={setQuickEditPrompt}
              onLabelChange={updateSelectedMarkerLabel}
              onRun={runMarkerQuickEdit}
            />
          )}

          {operationLabel && resultScreenRect && <LovartOperationPill rect={resultScreenRect} label={operationLabel} />}

          {activeCanvasTool === "draw" && (
            <LovartDrawOptionsBar
              panelOpen={panelOpen}
              stroke={drawStyle.stroke}
              strokeWidth={drawStyle.strokeWidth}
              onStrokeChange={(stroke) => setDrawStyle((value) => ({ ...value, stroke }))}
              onStrokeWidthChange={(strokeWidth) => setDrawStyle((value) => ({ ...value, strokeWidth }))}
            />
          )}

          <LovartBottomDock
            activeTool={activeCanvasTool}
            panelOpen={panelOpen}
            onToolChange={(tool) => {
              setActiveCanvasTool(tool);
              if (tool !== "select") setSelectedIds([]);
              setShapeMenuOpen(false);
              setQuickEditOpen(false);
              setFontMenuOpen(false);
              if (activeImagePanel) closeImageOperationPanel();
            }}
            shapeMenuOpen={shapeMenuOpen}
            onSelectShapeTool={(tool) => {
              setActiveCanvasTool(tool);
              setSelectedIds([]);
              setShapeMenuOpen(false);
              setQuickEditOpen(false);
              setFontMenuOpen(false);
              if (activeImagePanel) closeImageOperationPanel();
            }}
            onAddText={() => {
              setActiveCanvasTool("text");
              setSelectedIds([]);
              setQuickEditOpen(false);
              setFontMenuOpen(false);
              if (activeImagePanel) closeImageOperationPanel();
            }}
            onAddShape={() => {
              setActiveCanvasTool("shape:rectangle");
              setSelectedIds([]);
              setShapeMenuOpen(true);
              setQuickEditOpen(false);
              setFontMenuOpen(false);
              if (activeImagePanel) closeImageOperationPanel();
            }}
            onUpload={() => assetInputRef.current?.click()}
            onImport={() => importInputRef.current?.click()}
            onReferenceUpload={() => attachmentInputRef.current?.click()}
            onOpenPrompt={openPromptComposer}
          />

          <LovartStatusBar
            zoom={document.viewport.zoom}
            leftPanel={leftPanel}
            canvasBackground={document.background || "#f4f4f4"}
            canvasColorOpen={canvasColorOpen}
            onUndo={undo}
            onRedo={redo}
            onFit={fitCanvas}
            onToggleLayers={() => setLeftPanel((value) => (value === "layers" ? null : "layers"))}
            onToggleFiles={() => setLeftPanel((value) => (value === "files" ? null : "files"))}
            onCanvasColorOpenChange={setCanvasColorOpen}
            onCanvasBackgroundChange={applyCanvasBackground}
            canUndo={history.length > 0}
            canRedo={future.length > 0}
          />

          <LovartMiniMap
            document={document}
            viewport={document.viewport}
            panelOpen={panelOpen}
            leftPanelOpen={Boolean(leftPanel)}
            guideOpen={guidePreferencesLoaded && minimapGuideOpen}
            onJump={jumpViewportTo}
            onDismissGuide={dismissMinimapGuide}
          />
        </section>

        {toolbarNamesOpen && (
          <CustomizeToolbarModal
            showToolNames={showToolNames}
            visibleToolKeys={visibleImageToolKeys}
            onShowToolNamesChange={setShowToolNames}
            onVisibleToolKeysChange={setVisibleImageToolKeys}
            onClose={() => setToolbarNamesOpen(false)}
          />
        )}

        {panelOpen ? (
          <LovartChatPanel
            prompt={prompt}
            mode={assistantMode}
            model={aiModel}
            quality={effectiveImageSize}
            credits={credits}
            attachments={attachments}
            results={panelResults}
            isGenerating={isGenerating}
            error={generationError}
            cost={cost}
            generationSettings={generationSettings}
            modelOptions={MODEL_OPTIONS}
            qualityOptions={QUALITY_OPTIONS.filter((option) => supportedSizes.includes(option.value as ImageSize))}
            canGenerate={!isUploadingAsset && !isGenerating && (prompt.trim().length > 0 || attachments.some((item) => (item.status ?? "ready") === "ready"))}
            onPromptChange={setPrompt}
            onModeChange={setAssistantMode}
            onModelChange={(value) => setAiModel(value as LingyaModel)}
            onQualityChange={(value) => setImageSize(value as ImageSize)}
            onGenerationSettingsChange={setGenerationSettings}
            onGenerate={generateImage}
            onUpload={() => attachmentInputRef.current?.click()}
            onRemoveAttachment={removeAttachment}
            onClose={() => setPanelOpen(false)}
            onNewChat={resetComposerConversation}
            onShare={shareCanvas}
            onOpenLibrary={openGeneratedLibrary}
            onSkillSelect={applySkillPrompt}
            inputRef={promptInputRef}
            onPreviewResult={(result) => {
              const url = result.imageUrl || result.thumbnailUrl;
              if (url) setPreviewImage({ url, name: result.title || "AI 结果" });
            }}
            onInsertResult={insertResult}
          />
        ) : (
          <button
            type="button"
            onClick={openPromptComposer}
            className="absolute right-4 top-4 z-50 inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-bold shadow-lg"
          >
            <Bot className="h-4 w-4" />
            AI 面板
          </button>
        )}

        {previewImage && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onClick={() => setPreviewImage(null)}>
            <div className="relative max-h-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex h-12 items-center justify-between border-b border-slate-100 px-4">
                <p className="truncate text-sm font-bold text-slate-900">{previewImage.name}</p>
                <button type="button" onClick={() => setPreviewImage(null)} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="关闭预览">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex max-h-[78vh] max-w-[88vw] items-center justify-center bg-slate-100">
                <img src={previewImage.url} alt={previewImage.name} className="max-h-[78vh] max-w-[88vw] object-contain" />
              </div>
            </div>
          </div>
        )}
      </div>
  );

}

type LovartIcon = ComponentType<{ className?: string }>;

function LovartDocumentBar({
  title,
  credits,
  chatOpen,
  onToggleChat,
  onShare,
  onExport,
}: {
  title: string;
  credits: number | null;
  chatOpen: boolean;
  onToggleChat: () => void;
  onShare: () => void;
  onExport: () => void;
}) {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-40 flex h-12 items-center justify-between px-3">
      <div className="pointer-events-auto flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#202020] text-white shadow-sm">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <button type="button" className="inline-flex items-center gap-1.5 rounded-full px-1.5 py-1 text-sm font-semibold text-neutral-900 hover:bg-white">
          <span className="max-w-[180px] truncate">{title}</span>
          <ChevronDown className="h-3.5 w-3.5 text-neutral-500" />
        </button>
      </div>

      <div className="pointer-events-auto flex items-center gap-2 text-xs text-neutral-600">
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-semibold">
          <Zap className="h-3 w-3" />
          {credits === null ? "--" : credits}
        </span>
        <button type="button" onClick={onToggleChat} className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-neutral-600 shadow-sm hover:text-neutral-950" aria-label={chatOpen ? "收起聊天" : "打开聊天"}>
          {chatOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </button>
        <button type="button" onClick={onShare} className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-neutral-600 shadow-sm hover:text-neutral-950" aria-label="分享">
          <Share2 className="h-4 w-4" />
        </button>
        <button type="button" onClick={onExport} className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-neutral-600 shadow-sm hover:text-neutral-950" aria-label="导出">
          <Download className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

function LovartSelectionMeta({ selectedNodes, rect }: { selectedNodes: CanvasNode[]; rect: { x: number; y: number; width: number; height: number } }) {
  const node = selectedNodes[0];
  const title = selectedNodes.length === 1 ? node?.name || "未命名" : `${selectedNodes.length} 个对象`;
  const size = node ? `${Math.round(node.width)} x ${Math.round(node.height)}` : "";
  const Icon = getSelectionMetaIcon(selectedNodes);

  return (
    <div
      className="pointer-events-none absolute z-40 flex items-center justify-between text-[12px] font-medium text-blue-500"
      style={{
        left: rect.x,
        top: Math.max(52, rect.y - 21),
        width: Math.max(rect.width, 260),
      }}
    >
      <span className="min-w-0 truncate">
        <Icon className="mr-1 inline h-3 w-3" />
        {title}
      </span>
      <span className="ml-4 shrink-0 tabular-nums">{size}</span>
    </div>
  );
}

function getSelectionMetaIcon(selectedNodes: CanvasNode[]) {
  if (selectedNodes.length !== 1) return Layers3;
  const node = selectedNodes[0];
  if (!node) return MousePointer2;
  if (node.type === "image") return ImagePlus;
  if (node.type === "text") return Type;
  if (node.shapeKind === "marker") return MapPin;
  if (node.shapeKind === "path") return Pencil;
  if (node.shapeKind === "frame") return Grid3X3;
  return Square;
}

function getLovartCanvasWidth(panelOpen: boolean) {
  if (typeof window === "undefined") return 1440 - (panelOpen ? 360 : 0);
  return Math.max(window.innerWidth - (panelOpen ? 360 : 0), 320);
}

function clampLovartOverlayLeft(desiredLeft: number, width: number, panelOpen: boolean, padding = 16) {
  const maxLeft = Math.max(padding, getLovartCanvasWidth(panelOpen) - width - padding);
  return Math.min(maxLeft, Math.max(padding, desiredLeft));
}

function LovartBrandGuide({
  open,
  onClose,
  onAttach,
}: {
  open: boolean;
  onClose: () => void;
  onAttach: () => void;
}) {
  if (!open) return null;
  return (
    <div className="pointer-events-none absolute left-3 top-12 z-[70]">
      <div className="pointer-events-auto relative w-56 rounded-xl bg-neutral-950 p-3 text-white shadow-[0_18px_42px_rgba(0,0,0,0.28)]">
        <span className="absolute -top-2 left-12 h-4 w-4 rotate-45 bg-neutral-950" />
        <p className="relative text-xs font-medium leading-5">为此项目应用品牌套件，让未来的生成内容遵循相同的品牌规则。</p>
        <div className="relative mt-3 flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-xs font-bold">1</span>
          <Button type="button" size="sm" variant="secondary" className="h-7 rounded-md px-3 text-xs" onClick={onClose}>跳过</Button>
          <Button type="button" size="sm" className="h-7 rounded-md bg-white px-3 text-xs text-neutral-950 hover:bg-neutral-100" onClick={onAttach}>关联品牌套件</Button>
        </div>
      </div>
    </div>
  );
}

function LovartLeftSidebar({
  panel,
  document,
  selectedIds,
  historyCount,
  futureCount,
  results,
  onClose,
  onUndo,
  onRedo,
  onSelectNode,
  onInsertResult,
  onPreviewResult,
  onDownloadResult,
}: {
  panel: LovartLeftPanel;
  document: CanvasDocument;
  selectedIds: CanvasNodeId[];
  historyCount: number;
  futureCount: number;
  results: CanvasAssistantResult[];
  onClose: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelectNode: (id: CanvasNodeId) => void;
  onInsertResult: (result: CanvasAssistantResult) => void;
  onPreviewResult: (result: CanvasAssistantResult) => void;
  onDownloadResult: (result: CanvasAssistantResult) => void;
}) {
  if (!panel) return null;
  const sortedNodes = [...document.nodes].sort((a, b) => b.zIndex - a.zIndex);
  return (
    <aside className="absolute inset-y-0 left-0 z-[45] w-64 border-r border-neutral-200 bg-white/96 shadow-[12px_0_28px_rgba(0,0,0,0.06)] backdrop-blur" onPointerDown={(event) => event.stopPropagation()}>
      <div className="flex h-12 items-center justify-between px-4">
        <h2 className="text-sm font-semibold text-neutral-950">{panel === "layers" ? "图层" : "已生成文件列表"}</h2>
        <button type="button" onClick={onClose} className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-neutral-100" aria-label="关闭侧边栏">
          <X className="h-4 w-4" />
        </button>
      </div>

      {panel === "layers" ? (
        <div className="flex h-[calc(100%-48px)] flex-col">
          <div className="border-y border-neutral-100 px-4 py-4">
            <div className="mb-2 flex items-center justify-between text-sm font-semibold">
              <span>历史记录</span>
              <ChevronDown className="h-4 w-4 text-neutral-400" />
            </div>
            <div className="rounded-xl bg-neutral-50 p-3 text-xs text-neutral-500">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-neutral-400" />
                <span className="font-medium text-neutral-700">
                  {historyCount > 0 ? `${historyCount} 个可撤销步骤` : "暂无历史记录"}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg bg-white text-xs" disabled={historyCount === 0} onClick={onUndo}>
                  撤销
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg bg-white text-xs" disabled={futureCount === 0} onClick={onRedo}>
                  重做
                </Button>
              </div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {sortedNodes.map((node) => {
              const groupId = readNodeDataString(node.data, "groupId");
              const isSelected = selectedIds.includes(node.id);

              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onSelectNode(node.id)}
                  aria-pressed={isSelected}
                  className={`flex h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-medium ${isSelected ? "bg-neutral-100 text-neutral-950" : "text-neutral-600 hover:bg-neutral-50"}`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-neutral-200 bg-neutral-50">
                    {node.type === "text" ? <Type className="h-3.5 w-3.5" /> : node.type === "image" ? <img src={getImageSource(node, document)} alt="" className="h-full w-full rounded object-cover" /> : <Square className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{node.name || node.id}</span>
                  {groupId ? <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500">编组</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="h-[calc(100%-48px)] overflow-y-auto p-3">
          {results.length ? (
            <div className="space-y-2">
              {results.map((result) => {
                const url = result.thumbnailUrl || result.imageUrl;
                return (
                  <div key={result.id} className="flex items-center gap-2 rounded-xl p-2 hover:bg-neutral-50">
                    <button type="button" onClick={() => onPreviewResult(result)} className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-neutral-100">
                      {url ? <img src={url} alt={result.title} className="h-full w-full object-cover" /> : <Loader2 className="m-4 h-4 w-4 animate-spin text-neutral-400" />}
                    </button>
                    <button type="button" onClick={() => onInsertResult(result)} className="min-w-0 flex-1 text-left">
                      <p className="truncate text-xs font-semibold text-neutral-900">{result.title}</p>
                      <p className="truncate text-[11px] text-neutral-400">{result.status === "completed" ? "已完成" : "生成中"}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDownloadResult(result)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-950"
                      aria-label="下载生成结果"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
              <p className="py-4 text-center text-xs text-neutral-400">到底了</p>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-xs text-neutral-400">
              <FileStack className="mb-3 h-9 w-9 opacity-30" />
              还没有生成文件
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function LovartContextToolbar({
  rect,
  panelOpen,
  onQuickEdit,
  showToolNames,
  visibleToolKeys,
  onUpscale,
  onRemoveBg,
  onEraser,
  onEditElements,
  onEditText,
  onMultiAngles,
  onMoveObject,
  onMockup,
  onExpand,
  onAdjust,
  onCrop,
  onVector,
  onFlip,
  onCustomizeToolbar,
  onDownload,
}: {
  rect: { x: number; y: number; width: number; height: number };
  panelOpen: boolean;
  onQuickEdit: () => void;
  showToolNames: boolean;
  visibleToolKeys: LovartImageToolKey[];
  onUpscale: () => void;
  onRemoveBg: () => void;
  onEraser: () => void;
  onEditElements: () => void;
  onEditText: () => void;
  onMultiAngles: () => void;
  onMoveObject: () => void;
  onMockup: () => void;
  onExpand: () => void;
  onAdjust: () => void;
  onCrop: () => void;
  onVector: () => void;
  onFlip: () => void;
  onCustomizeToolbar: () => void;
  onDownload: () => void;
}) {
  const top = Math.max(56, rect.y - 62);
  const actionByKey: Record<LovartImageToolKey, () => void> = {
    upscale: onUpscale,
    "remove-bg": onRemoveBg,
    eraser: onEraser,
    "edit-elements": onEditElements,
    "edit-text": onEditText,
    "multi-angles": onMultiAngles,
    "move-object": onMoveObject,
    mockup: onMockup,
    expand: onExpand,
    adjust: onAdjust,
    crop: onCrop,
    vector: onVector,
    flip: onFlip,
  };
  const visibleToolSet = new Set(visibleToolKeys);
  const pinnedTools = LOVART_IMAGE_TOOLS.filter((tool) => visibleToolSet.has(tool.key));
  const overflowTools = LOVART_IMAGE_TOOLS.filter((tool) => !visibleToolSet.has(tool.key));
  const overflowHasDot = overflowTools.some((tool) => tool.dot);
  const toolbarWidth = Math.min(
    showToolNames ? 960 : 680,
    132 + pinnedTools.length * (showToolNames ? 96 : 44) + 90,
  );
  const left = clampLovartOverlayLeft(rect.x + rect.width / 2 - toolbarWidth / 2, toolbarWidth, panelOpen, 12);
  return (
    <div
      className="absolute z-50 flex max-w-[calc(100%-24px)] items-center overflow-x-auto rounded-[13px] border border-neutral-200 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.10)]"
      style={{
        left,
        top,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <LovartToolbarButton icon={Sparkles} label="快捷编辑" hint="Tab" showLabel={showToolNames} onClick={onQuickEdit} />
      <div className="h-8 w-px bg-neutral-200" />
      {pinnedTools.map((tool) => (
        <LovartToolbarButton
          key={tool.key}
          icon={tool.icon}
          label={tool.label}
          badge={tool.badge}
          showLabel={showToolNames}
          dot={tool.dot}
          onClick={actionByKey[tool.key]}
        />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="relative inline-flex h-9 w-10 items-center justify-center text-neutral-700 hover:bg-neutral-100" aria-label="更多工具">
            <MoreHorizontal className="h-4.5 w-4.5" />
            {overflowHasDot && <span className="absolute right-1.5 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} className="w-44 rounded-2xl p-2">
          {overflowTools.map((tool) => (
            <LovartDropdownToolItem
              key={tool.key}
              icon={tool.icon}
              badge={tool.badge}
              label={tool.label}
              onSelect={actionByKey[tool.key]}
              right={tool.right}
              hasDot={tool.dot}
            />
          ))}
          {overflowTools.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={onCustomizeToolbar} className="cursor-pointer rounded-lg">
            <span className="flex flex-1 items-center justify-between">
              自定义工具栏
              <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="h-8 w-px bg-neutral-200" />
      <button type="button" onClick={onDownload} className="inline-flex h-9 w-10 items-center justify-center rounded-r-[12px] text-neutral-700 hover:bg-neutral-100" aria-label="下载">
        <Download className="h-4 w-4" />
      </button>
    </div>
  );
}

function LovartDropdownToolItem({
  icon: Icon,
  badge,
  label,
  right,
  hasDot,
  onSelect,
}: {
  icon?: LovartIcon;
  badge?: string;
  label: string;
  right?: string;
  hasDot?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="relative cursor-pointer rounded-lg">
      {badge ? (
        <span className="mr-2 rounded border border-neutral-400 px-0.5 text-[9px] font-black leading-3">{badge}</span>
      ) : Icon ? (
        <Icon className="mr-2 h-4 w-4 text-neutral-700" />
      ) : null}
      <span className="flex-1">{label}</span>
      {right && <span className="text-xs text-neutral-400">+{right}</span>}
      {hasDot && <span className="absolute left-6 top-1.5 h-1.5 w-1.5 rounded-full bg-red-500" />}
    </DropdownMenuItem>
  );
}

function LovartToolbarButton({
  icon: Icon,
  label,
  badge,
  hint,
  dot,
  showLabel = true,
  onClick,
  interactive = true,
}: {
  icon?: LovartIcon;
  label: string;
  badge?: string;
  hint?: string;
  dot?: boolean;
  showLabel?: boolean;
  onClick?: () => void;
  interactive?: boolean;
}) {
  return (
    <button
      type="button"
      onPointerDown={(event) => {
        if (!interactive) return;
        event.preventDefault();
        event.stopPropagation();
        onClick?.();
      }}
      onClick={(event) => {
        if (interactive && event.detail === 0) onClick?.();
      }}
      className={`relative inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 text-sm font-medium text-neutral-800 ${interactive ? "hover:bg-neutral-100" : "cursor-default"}`}
      title={label}
      tabIndex={interactive ? 0 : -1}
      aria-hidden={!interactive}
    >
      {badge ? <span className="rounded border border-neutral-400 px-0.5 text-[9px] font-black leading-3">{badge}</span> : Icon ? <Icon className="h-4 w-4" /> : null}
      {showLabel && <span>{label}</span>}
      {hint && showLabel && <span className="text-xs text-neutral-400">{hint}</span>}
      {dot && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />}
    </button>
  );
}

function LovartMultiSelectionToolbar({
  selectedNodes,
  rect,
  panelOpen,
  hasGroup,
  onGroup,
  onUngroup,
  onMerge,
  onAlign,
  onDistribute,
  onDuplicate,
  onLayerForward,
  onLayerBackward,
  onLayerFront,
  onLayerBack,
  onDownload,
  onDelete,
}: {
  selectedNodes: CanvasNode[];
  rect: { x: number; y: number; width: number; height: number };
  panelOpen: boolean;
  hasGroup: boolean;
  onGroup: () => void;
  onUngroup: () => void;
  onMerge: () => void;
  onAlign: (alignment: "left" | "center" | "right" | "top" | "middle" | "bottom") => void;
  onDistribute: (axis: "horizontal" | "vertical") => void;
  onDuplicate: () => void;
  onLayerForward: () => void;
  onLayerBackward: () => void;
  onLayerFront: () => void;
  onLayerBack: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const top = Math.max(42, rect.y - 54);
  const toolbarWidth = 444;
  const left = clampLovartOverlayLeft(rect.x + rect.width / 2 - toolbarWidth / 2, toolbarWidth, panelOpen, 12);
  const canDistribute = selectedNodes.length >= 3;

  return (
    <div
      className="absolute z-50 flex items-center rounded-[13px] border border-neutral-200 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.10)]"
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" onClick={hasGroup ? onUngroup : onGroup} className="inline-flex h-10 items-center gap-2 border-r border-neutral-200 px-4 text-sm hover:bg-neutral-50">
        <Layers3 className="h-4 w-4" />
        {hasGroup ? "取消编组" : "编组"}
      </button>
      <button type="button" onClick={onMerge} className="inline-flex h-10 items-center gap-2 border-r border-neutral-200 px-4 text-sm hover:bg-neutral-50">
        <Copy className="h-4 w-4" />
        合并
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="inline-flex h-10 items-center gap-2 border-r border-neutral-200 px-3 text-sm hover:bg-neutral-50" aria-label="对齐选区">
            <Move className="h-4 w-4" />
            <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" sideOffset={8} className="w-44 rounded-2xl p-2">
          <DropdownMenuItem onSelect={() => onAlign("left")} className="cursor-pointer rounded-lg">左对齐</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAlign("center")} className="cursor-pointer rounded-lg">水平居中</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAlign("right")} className="cursor-pointer rounded-lg">右对齐</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onAlign("top")} className="cursor-pointer rounded-lg">顶端对齐</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAlign("middle")} className="cursor-pointer rounded-lg">垂直居中</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAlign("bottom")} className="cursor-pointer rounded-lg">底端对齐</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="inline-flex h-10 items-center gap-2 border-r border-neutral-200 px-3 text-sm hover:bg-neutral-50" aria-label="分布选区">
            <Grid3X3 className="h-4 w-4" />
            <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" sideOffset={8} className="w-48 rounded-2xl p-2">
          <DropdownMenuItem disabled={!canDistribute} onSelect={() => onDistribute("horizontal")} className="cursor-pointer rounded-lg">水平分布</DropdownMenuItem>
          <DropdownMenuItem disabled={!canDistribute} onSelect={() => onDistribute("vertical")} className="cursor-pointer rounded-lg">垂直分布</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="inline-flex h-10 items-center gap-2 border-r border-neutral-200 px-3 text-sm hover:bg-neutral-50" aria-label="图层顺序">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} className="w-44 rounded-2xl p-2">
          <DropdownMenuItem onSelect={onLayerFront} className="cursor-pointer rounded-lg">置于顶层</DropdownMenuItem>
          <DropdownMenuItem onSelect={onLayerForward} className="cursor-pointer rounded-lg">上移一层</DropdownMenuItem>
          <DropdownMenuItem onSelect={onLayerBackward} className="cursor-pointer rounded-lg">下移一层</DropdownMenuItem>
          <DropdownMenuItem onSelect={onLayerBack} className="cursor-pointer rounded-lg">置于底层</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button type="button" onClick={onDuplicate} className="inline-flex h-10 w-11 items-center justify-center border-r border-neutral-200 hover:bg-neutral-50" aria-label="复制选区">
        <Copy className="h-4 w-4" />
      </button>
      <button type="button" onClick={onDownload} className="inline-flex h-10 w-11 items-center justify-center border-r border-neutral-200 hover:bg-neutral-50" aria-label="下载">
        <Download className="h-4 w-4" />
      </button>
      <button type="button" onClick={onDelete} className="inline-flex h-10 w-11 items-center justify-center rounded-r-[12px] text-red-500 hover:bg-red-50" aria-label="删除选区">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function LovartObjectPropertyBar({
  node,
  rect,
  panelOpen,
  fontMenuOpen,
  onToggleFontMenu,
  onUpdate,
  onDownload,
}: {
  node: CanvasNode;
  rect: { x: number; y: number; width: number; height: number };
  panelOpen: boolean;
  fontMenuOpen: boolean;
  onToggleFontMenu: () => void;
  onUpdate: (patch: Partial<CanvasNode>) => void;
  onDownload: () => void;
}) {
  const top = Math.max(42, rect.y - 54);
  const shapeKind = node.shapeKind || "rectangle";
  const isFrame = shapeKind === "frame" || node.name === "Frame";
  const isStrokeObject = shapeKind === "path" || shapeKind === "line" || shapeKind === "arrow";
  const toolbarWidth = node.type === "text" ? 556 : isFrame ? 504 : isStrokeObject ? 360 : 504;
  const left = clampLovartOverlayLeft(rect.x + rect.width / 2 - toolbarWidth / 2, toolbarWidth, panelOpen, 12);

  function setNumberField(field: "width" | "height" | "fontSize" | "strokeWidth", value: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    onUpdate({ [field]: Math.round(parsed) } as Partial<CanvasNode>);
  }

  if (node.type === "text") {
    return (
      <div
        className="absolute z-50"
        style={{ left, top }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {fontMenuOpen && (
          <div className="absolute bottom-12 left-20 w-60 rounded-2xl border border-neutral-200 bg-white p-3 shadow-[0_16px_42px_rgba(0,0,0,0.16)]">
            <div className="mb-2 flex h-9 items-center rounded-lg bg-neutral-100 px-3 text-sm text-neutral-400">
              搜索字体
            </div>
            <button type="button" className="mb-2 flex h-8 w-full items-center justify-between text-left text-sm">
              全部字体
              <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
            </button>
            {["ABeeZee", "ADLaM Display", "AR One Sans", "Abel", "Abhaya Libre Medium", "Abhaya Libre SemiBold", "Abhaya Libre ExtraBold"].map((font) => (
              <button
                key={font}
                type="button"
                onClick={() => onUpdate({ fontFamily: `${font}, sans-serif` })}
                className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-lg hover:bg-neutral-100"
                style={{ fontFamily: `${font}, sans-serif` }}
              >
                {font}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center rounded-[13px] border border-neutral-200 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.10)]">
          <LovartColorSwatchPopover label="文字颜色" value={node.fill || "#111111"} onChange={(fill) => onUpdate({ fill })} />
          <button type="button" onClick={onToggleFontMenu} className="inline-flex h-10 w-28 items-center justify-center gap-2 border-r border-neutral-200 text-sm">
            {node.fontFamily?.split(",")[0] || "Inter"}
            <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
          </button>
          <button type="button" className="inline-flex h-10 w-24 items-center justify-center gap-2 border-r border-neutral-200 text-sm">
            常规
            <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
          </button>
          <input
            value={Math.round(node.fontSize || 80)}
            onChange={(event) => setNumberField("fontSize", event.target.value)}
            className="h-10 w-16 border-r border-neutral-200 bg-transparent text-center text-sm outline-none"
            aria-label="字号"
          />
          <button type="button" className="inline-flex h-10 w-12 items-center justify-center border-r border-neutral-200" aria-label="对齐">
            <Layers3 className="h-4 w-4" />
          </button>
          <button type="button" className="inline-flex h-10 w-12 items-center justify-center border-r border-neutral-200" aria-label="文字设置">
            <SlidersHorizontal className="h-4 w-4" />
          </button>
          <button type="button" onClick={onDownload} className="inline-flex h-10 w-12 items-center justify-center" aria-label="下载">
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (isStrokeObject) {
    return (
      <div
        className="absolute z-50 flex items-center rounded-[13px] border border-neutral-200 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.10)]"
        style={{ left, top }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <LovartColorSwatchPopover label="线条颜色" value={node.stroke || "#111827"} variant="stroke" onChange={(stroke) => onUpdate({ stroke })} />
        <label className="flex h-10 w-24 items-center gap-2 border-r border-neutral-200 px-3 text-sm text-neutral-500">
          <Layers3 className="h-4 w-4 text-neutral-700" />
          <input
            value={Math.round(node.strokeWidth || 3)}
            onChange={(event) => setNumberField("strokeWidth", event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-neutral-950 outline-none"
            aria-label="线条粗细"
          />
          Px
        </label>
        <DimensionInput label="W" value={node.width} onChange={(value) => setNumberField("width", value)} />
        <DimensionInput label="H" value={node.height} onChange={(value) => setNumberField("height", value)} />
        <button type="button" onClick={onDownload} className="inline-flex h-10 w-12 items-center justify-center" aria-label="下载">
          <Download className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (isFrame) {
    return (
      <div
        className="absolute z-50 flex items-center rounded-[13px] border border-neutral-200 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.10)]"
        style={{ left, top }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="inline-flex h-10 items-center gap-2 border-r border-neutral-200 px-4 text-sm">
          <Grid3X3 className="h-4 w-4" />
          自动布局
        </button>
        <button type="button" className="inline-flex h-10 items-center gap-2 border-r border-neutral-200 px-4 text-sm">
          自定义
          <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
        </button>
        <DimensionInput label="W" value={node.width} onChange={(value) => setNumberField("width", value)} />
        <DimensionInput label="H" value={node.height} onChange={(value) => setNumberField("height", value)} />
        <button type="button" className="inline-flex h-10 w-12 items-center justify-center border-r border-neutral-200" aria-label="锁定比例">
          ↔
        </button>
        <button type="button" onClick={onDownload} className="inline-flex h-10 w-12 items-center justify-center" aria-label="下载">
          <Download className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="absolute z-50 flex items-center rounded-[13px] border border-neutral-200 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.10)]"
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <LovartColorSwatchPopover label="填充色" value={node.fill || "#d9d9d9"} onChange={(fill) => onUpdate({ fill })} />
      <LovartColorSwatchPopover label="描边色" value={node.stroke || "#111111"} variant="stroke" onChange={(stroke) => onUpdate({ stroke, strokeWidth: node.strokeWidth || 1 })} />
      <button type="button" onClick={() => onUpdate({ radius: node.radius ? 0 : 18 })} className="inline-flex h-10 w-12 items-center justify-center border-r border-neutral-200" aria-label="圆角">
        <CornerUpRight className="h-4 w-4" />
      </button>
      <DimensionInput label="W" value={node.width} onChange={(value) => setNumberField("width", value)} />
      <DimensionInput label="H" value={node.height} onChange={(value) => setNumberField("height", value)} />
      <button type="button" className="inline-flex h-10 w-12 items-center justify-center border-r border-neutral-200" aria-label="锁定比例">
        ↔
      </button>
      <button type="button" onClick={onDownload} className="inline-flex h-10 w-12 items-center justify-center" aria-label="下载">
        <Download className="h-4 w-4" />
      </button>
    </div>
  );
}

function DimensionInput({ label, value, onChange }: { label: string; value: number; onChange: (value: string) => void }) {
  return (
    <label className="flex h-10 w-24 items-center gap-2 border-r border-neutral-200 px-3 text-sm text-neutral-500">
      {label}
      <input
        value={Math.round(value)}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-neutral-950 outline-none"
      />
    </label>
  );
}

function LovartColorSwatchPopover({
  label,
  value,
  variant = "fill",
  onChange,
}: {
  label: string;
  value: string;
  variant?: "fill" | "stroke";
  onChange: (value: string) => void;
}) {
  const normalizedValue = value || (variant === "stroke" ? "#111111" : "#d9d9d9");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex h-10 w-12 items-center justify-center border-r border-neutral-200 hover:bg-neutral-50" aria-label={label}>
          {variant === "stroke" ? (
            <span className="h-5 w-5 rounded-full border-[4px] bg-white" style={{ borderColor: normalizedValue }} />
          ) : (
            <span className="h-5 w-5 rounded-full border border-neutral-300" style={{ backgroundColor: normalizedValue }} />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" sideOffset={10} className="w-52 rounded-2xl p-3" onPointerDown={(event) => event.stopPropagation()}>
        <div className="mb-2 text-xs font-semibold text-neutral-500">{label}</div>
        <div className="grid grid-cols-5 gap-1.5">
          {OBJECT_COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              className={`h-7 w-7 rounded-full border ${
                normalizedValue.toLowerCase() === color.toLowerCase() ? "border-neutral-950 ring-2 ring-neutral-950/10" : "border-neutral-200"
              }`}
              style={{ backgroundColor: color }}
              aria-label={`${label} ${color}`}
              onClick={() => onChange(color)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LovartMenuItem({ icon: Icon, label, right, onClick }: { icon: LovartIcon; label: string; right?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-9 w-full items-center justify-between rounded-lg px-2 text-left hover:bg-neutral-50">
      <span className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-neutral-700" />
        {label}
      </span>
      {right && <span className="text-xs text-neutral-400">⚡ {right}</span>}
    </button>
  );
}

function LovartQuickEditBar({
  rect,
  panelOpen,
  value,
  cost,
  inputRef,
  onChange,
  onRun,
}: {
  rect: { x: number; y: number; width: number; height: number };
  panelOpen: boolean;
  value: string;
  cost: number;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onRun: () => void;
}) {
  const width = 430;
  return (
    <div
      className="absolute z-40 w-[430px] rounded-xl border border-neutral-200 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.08)]"
      style={{
        left: clampLovartOverlayLeft(rect.x + 24, width, panelOpen, 24),
        top: rect.y + rect.height + 12,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <textarea
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="描述这次局部编辑，例如：换成红色手提包、清理背景杂物"
        className="min-h-16 w-full resize-none rounded-t-xl px-4 py-3 text-sm outline-none placeholder:text-neutral-400"
      />
      <div className="flex items-center justify-end border-t border-neutral-100 px-2 py-2">
        <button type="button" onClick={onRun} disabled={!value.trim()} className="inline-flex h-8 items-center gap-1 rounded-lg bg-neutral-950 px-3 text-xs font-bold text-white disabled:bg-neutral-100 disabled:text-neutral-300">
          执行
          <span className="text-[11px] opacity-70">+{cost}</span>
        </button>
      </div>
    </div>
  );
}

function LovartMarkerPromptBar({
  rect,
  panelOpen,
  marker,
  value,
  cost,
  inputRef,
  onChange,
  onLabelChange,
  onRun,
}: {
  rect: { x: number; y: number; width: number; height: number };
  panelOpen: boolean;
  marker: CanvasNode;
  value: string;
  cost: number;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onLabelChange: (value: string) => void;
  onRun: (value: string) => void;
}) {
  const markerLabel = typeof marker.data?.tagLabel === "string" ? marker.data.tagLabel : getMarkerLabel(marker);
  const markerNumber = marker.text || "1";
  const width = 480;
  return (
    <div
      className="absolute z-50 w-[480px] rounded-xl border border-neutral-200 bg-white shadow-[0_16px_42px_rgba(0,0,0,0.12)]"
      style={{
        left: clampLovartOverlayLeft(rect.x + rect.width / 2 - width / 2, width, panelOpen, 24),
        top: rect.y + rect.height + 14,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex min-h-20 items-start gap-2 px-3 py-3">
        <label className="mt-1 inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 text-sm font-medium text-neutral-800">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-black text-white">{markerNumber}</span>
          <input
            value={markerLabel}
            onChange={(event) => onLabelChange(event.target.value)}
            className="h-6 w-24 bg-transparent text-sm outline-none"
            aria-label="标记名称"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="-mr-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label="选择标记名称">
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="z-[80] w-36 rounded-xl">
              {MARKER_LABEL_SUGGESTIONS.map((label) => (
                <DropdownMenuItem key={label} onSelect={() => onLabelChange(label)} className="cursor-pointer rounded-lg">
                  <span className="flex-1">{label}</span>
                  {label === markerLabel && <Check className="h-3.5 w-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </label>
        <textarea
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={`描述要如何修改 ${markerLabel || "这个标记区域"}`}
          className="min-h-14 flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-neutral-400"
        />
      </div>
      <div className="flex items-center justify-end border-t border-neutral-100 px-2 py-2">
        <button type="button" onClick={() => onRun(value)} disabled={!value.trim()} className="inline-flex h-8 items-center gap-1 rounded-lg bg-neutral-950 px-3 text-xs font-bold text-white disabled:bg-neutral-100 disabled:text-neutral-300">
          执行
          <span className="text-[11px] opacity-70">+{cost}</span>
        </button>
      </div>
    </div>
  );
}

function LovartImageOperationPanel({
  panel,
  rect,
  selectedNode,
  panelOpen,
  cost,
  adjustValues,
  onClose,
  onExpand,
  onCrop,
  onCommitCrop,
  onAdjustChange,
  onAdjustCommit,
  onResetAdjust,
  onRotate,
  onSetRotation,
  onFlip,
  onDownload,
  onGenerate,
}: {
  panel: LovartImagePanel;
  rect: { x: number; y: number; width: number; height: number } | null;
  selectedNode: CanvasNode | null;
  panelOpen: boolean;
  cost: number;
  adjustValues: ImageAdjustValues;
  onClose: () => void;
  onExpand: (scale: number, ratioValue: string) => void;
  onCrop: (ratioValue: string) => void;
  onCommitCrop: () => void;
  onAdjustChange: (values: ImageAdjustValues) => void;
  onAdjustCommit: (values?: ImageAdjustValues) => void;
  onResetAdjust: () => void;
  onRotate: (delta: number) => void;
  onSetRotation: (angle: number) => void;
  onFlip: (axis: "x" | "y") => void;
  onDownload: () => void;
  onGenerate: (label: string) => void;
}) {
  const [scale, setScale] = useState(1);
  const [ratio, setRatio] = useState("original");
  useEffect(() => {
    if (!panel || !selectedNode) return;
    if (panel === "expand") {
      setScale(1);
      setRatio(selectedNode.cropRatio || "original");
    }
    if (panel === "crop") {
      setRatio(selectedNode.cropRatio || "original");
    }
  }, [panel, selectedNode?.id, selectedNode?.cropRatio]);

  const activeCropRatio = selectedNode?.cropRatio || "original";
  if (!panel || !rect || !selectedNode) return null;

  const cropWidth = Math.round(readNodeDataNumber(selectedNode.data || {}, "cropFrameWidth", selectedNode.width));
  const cropHeight = Math.round(readNodeDataNumber(selectedNode.data || {}, "cropFrameHeight", selectedNode.height));
  const panelWidth = panel === "adjust" ? 278 : 260;
  const preferredLeft = rect.x + rect.width + 10;
  const left = clampLovartOverlayLeft(preferredLeft, panelWidth, panelOpen, 14);
  const top = Math.max(64, rect.y + 2);
  const flipWidth = 382;
  const flipLeft = clampLovartOverlayLeft(rect.x + rect.width / 2 - flipWidth / 2, flipWidth, panelOpen, 24);
  const angle = Math.round(selectedNode.rotation || 0);
  const panelTitle: Record<NonNullable<LovartImagePanel>, string> = {
    expand: "扩图",
    crop: "裁剪",
    adjust: "调整",
    flip: "翻转与旋转",
    "multi-angle": "多角度",
  };

  if (panel === "flip") {
    return (
      <div
        className="absolute z-[70] inline-flex h-11 items-center overflow-hidden rounded-xl border border-neutral-200 bg-white text-sm text-neutral-900 shadow-[0_12px_32px_rgba(0,0,0,0.12)]"
        style={{
          left: flipLeft,
          top: Math.max(16, rect.y - 62),
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex h-full items-center gap-2 border-r border-neutral-200 px-3 font-medium">
          <FlipHorizontal2 className="h-4 w-4" />
          翻转与旋转
        </div>
        <label className="flex h-full items-center gap-1 border-r border-neutral-200 px-3">
          <RotateCw className="h-4 w-4 text-neutral-500" />
          <input
            value={angle}
            onChange={(event) => onSetRotation(Number(event.target.value))}
            className="h-8 w-12 bg-transparent text-right outline-none"
            inputMode="numeric"
          />
          <span className="text-neutral-500">&deg;</span>
        </label>
        <LovartPanelIconButton label="向左旋转" icon={RotateCcw} onClick={() => onRotate(-15)} />
        <LovartPanelIconButton label="向右旋转" icon={RotateCw} onClick={() => onRotate(15)} />
        <LovartPanelIconButton label="水平翻转" icon={FlipHorizontal2} onClick={() => onFlip("x")} />
        <LovartPanelIconButton label="垂直翻转" icon={FlipHorizontal2} iconClassName="rotate-90" onClick={() => onFlip("y")} />
        <LovartPanelIconButton label="下载" icon={Download} onClick={onDownload} />
      </div>
    );
  }

  return (
    <div
      className={`${panel === "adjust" ? "w-[278px]" : "w-[260px]"} absolute z-[60] rounded-xl border border-neutral-200 bg-white p-3 text-sm text-neutral-900 shadow-[0_18px_48px_rgba(0,0,0,0.12)]`}
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">{panelTitle[panel]}</h3>
        <div className="flex items-center gap-1">
          {panel === "adjust" && (
            <>
              <LovartPanelIconButton label="重置" icon={RotateCcw} compact onClick={onResetAdjust} />
              <LovartPanelIconButton label="自动调整" icon={Wand2} compact onClick={() => onGenerate("自动调整")} />
            </>
          )}
              <LovartPanelIconButton label="关闭" icon={X} compact onClick={onClose} />
        </div>
      </div>

      {panel === "expand" && (
        <div className="space-y-3">
          <label className="block space-y-2">
            <span className="text-xs font-medium text-neutral-500">缩放比例</span>
            <Select value={String(scale)} onValueChange={(value) => setScale(Number(value))}>
              <SelectTrigger className="h-9 w-full rounded-lg border-neutral-100 bg-neutral-100 px-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[90] rounded-xl">
                <SelectItem value="1">1x</SelectItem>
                <SelectItem value="1.25">1.25x</SelectItem>
                <SelectItem value="1.5">1.5x</SelectItem>
                <SelectItem value="2">2x</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <div className="flex items-center gap-2">
            <span className="w-16 text-xs font-medium text-neutral-500">预设</span>
            <Select value="general">
              <SelectTrigger className="h-9 flex-1 rounded-lg border-neutral-100 bg-neutral-100 px-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[90] rounded-xl">
                <SelectItem value="general">通用</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <LovartRatioList value={ratio} onChange={setRatio} />
          <div className="flex gap-2 pt-1">
           <Button type="button" variant="outline" className="h-9 flex-1 rounded-lg" onClick={onClose}>取消</Button>
            <Button type="button" className="h-9 flex-1 rounded-lg bg-neutral-900 hover:bg-neutral-800" onClick={() => onExpand(scale, ratio)}>生成 +{cost}</Button>
          </div>
        </div>
      )}

      {panel === "crop" && (
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <label className="flex h-9 items-center gap-1 rounded-lg bg-neutral-100 px-2 text-xs text-neutral-500">
              W
              <input readOnly value={cropWidth} className="min-w-0 flex-1 bg-transparent text-neutral-800 outline-none" />
            </label>
            <Scan className="h-4 w-4 text-blue-500" />
            <label className="flex h-9 items-center gap-1 rounded-lg bg-neutral-100 px-2 text-xs text-neutral-500">
              H
              <input readOnly value={cropHeight} className="min-w-0 flex-1 bg-transparent text-neutral-800 outline-none" />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-xs font-medium text-neutral-500">预设</span>
            <Select value="general">
              <SelectTrigger className="h-9 flex-1 rounded-lg border-neutral-100 bg-white px-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[90] rounded-xl">
                <SelectItem value="general">通用</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <LovartRatioList value={activeCropRatio} onChange={onCrop} showPlatformGroups />
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="h-9 flex-1 rounded-lg" onClick={onClose}>取消</Button>
            <Button type="button" className="h-9 flex-1 rounded-lg bg-neutral-900 hover:bg-neutral-800" onClick={onCommitCrop}>完成</Button>
          </div>
        </div>
      )}

      {panel === "adjust" && (
        <div className="space-y-3">
          <Tabs defaultValue="light" className="block">
            <TabsList className="grid h-8 w-full grid-cols-4 rounded-lg bg-neutral-100 p-1">
              {[
                { value: "light", icon: Circle, label: "光影" },
                { value: "color", icon: Brush, label: "色彩" },
                { value: "detail", icon: SlidersHorizontal, label: "细节" },
                { value: "scene", icon: Box, label: "场景" },
              ].map(({ value, icon: Icon, label }) => (
                <TabsTrigger key={value} value={value} aria-label={label} className="h-6 rounded-md px-0 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  <Icon className="h-4 w-4" />
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <ScrollArea className="h-[335px]">
            <div className="space-y-3 pr-3">
              <LovartAdjustSlider label="光线" value={adjustValues.light} onChange={(value) => onAdjustChange({ ...adjustValues, light: value })} onCommit={(value) => onAdjustCommit({ ...adjustValues, light: value })} />
              <LovartAdjustSlider label="曝光" value={adjustValues.exposure} onChange={(value) => onAdjustChange({ ...adjustValues, exposure: value })} onCommit={(value) => onAdjustCommit({ ...adjustValues, exposure: value })} />
              <LovartAdjustSlider label="对比度" value={adjustValues.contrast} onChange={(value) => onAdjustChange({ ...adjustValues, contrast: value })} onCommit={(value) => onAdjustCommit({ ...adjustValues, contrast: value })} />
              <LovartAdjustSlider label="高光" value={adjustValues.highlights} onChange={(value) => onAdjustChange({ ...adjustValues, highlights: value })} onCommit={(value) => onAdjustCommit({ ...adjustValues, highlights: value })} />
              <LovartAdjustSlider label="阴影" value={adjustValues.shadows} onChange={(value) => onAdjustChange({ ...adjustValues, shadows: value })} onCommit={(value) => onAdjustCommit({ ...adjustValues, shadows: value })} />
              <LovartAdjustSlider label="白色" value={adjustValues.whites} onChange={(value) => onAdjustChange({ ...adjustValues, whites: value })} onCommit={(value) => onAdjustCommit({ ...adjustValues, whites: value })} />
              <LovartAdjustSlider label="黑色" value={adjustValues.blacks} onChange={(value) => onAdjustChange({ ...adjustValues, blacks: value })} onCommit={(value) => onAdjustCommit({ ...adjustValues, blacks: value })} />
            </div>
          </ScrollArea>
        </div>
      )}

      {panel === "multi-angle" && (
        <div className="space-y-4">
          <div className="rounded-xl bg-neutral-50 p-3">
            <div className="mx-auto flex h-36 w-36 items-center justify-center rounded-xl border border-blue-400 bg-gradient-to-br from-blue-50 to-white">
              <div className="relative h-24 w-24 rounded-full border border-blue-200">
                {["B", "R", "L", "T"].map((item, index) => (
                  <span key={item} className="absolute text-[10px] font-bold text-blue-500" style={{
                    left: index === 1 ? "auto" : index === 2 ? 0 : "50%",
                    right: index === 1 ? 0 : "auto",
                    top: index === 0 ? "auto" : index === 3 ? 0 : "50%",
                    bottom: index === 0 ? 0 : "auto",
                  }}>
                    {item}
                  </span>
                ))}
                <Box className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-blue-500" />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span>旋转</span>
              <span className="text-neutral-500">26</span>
            </div>
            <Slider value={[26]} min={-45} max={45} />
            <div className="flex items-center justify-between text-xs">
              <span>倾斜</span>
              <span className="text-neutral-500">33</span>
            </div>
            <Slider value={[33]} min={-45} max={45} />
          </div>
            <Button type="button" className="w-full" onClick={() => onGenerate("多角度")}>
            立即应用 +{Math.max(2, cost)}
          </Button>
        </div>
      )}
    </div>
  );
}

function LovartRatioList({
  value,
  onChange,
  showPlatformGroups,
}: {
  value: string;
  onChange: (value: string) => void;
  showPlatformGroups?: boolean;
}) {
  return (
    <div className="max-h-[300px] overflow-y-auto py-1">
      {RATIO_PRESETS.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className="flex h-8 w-full items-center gap-3 rounded-lg px-2 text-left text-sm hover:bg-neutral-50"
        >
          <span className="flex w-4 items-center justify-center">
            {value === item.value && <Check className="h-3.5 w-3.5" />}
          </span>
          <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-neutral-300">
            {item.value !== "original" && <span className="block h-2.5 w-2 rounded-sm border border-neutral-400" />}
          </span>
          <span>{item.label}</span>
        </button>
      ))}
      {showPlatformGroups && (
        <div className="mt-2 border-t border-neutral-100 pt-2">
          {LOVART_PLATFORM_RATIO_GROUPS.map((label) => (
            <button
              key={label}
              type="button"
              className="flex h-8 w-full items-center justify-between rounded-lg px-2 text-left text-sm hover:bg-neutral-50"
            >
              <span>{label}</span>
              <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LovartAdjustSlider({
  label,
  value,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const position = `${((value + 100) / 200) * 100}%`;
  const activeTrackStyle = value >= 0
    ? { left: "50%", width: `calc(${position} - 50%)` }
    : { left: position, width: `calc(50% - ${position})` };
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm text-neutral-800">{label}</span>
        <span className="w-8 text-right text-sm tabular-nums text-neutral-500">{value}</span>
      </div>
      <div className="relative h-5">
        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-neutral-200" />
        <div className="absolute top-1/2 h-px -translate-y-1/2 bg-neutral-400" style={activeTrackStyle} />
        <span
          className="pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-800 shadow-sm"
          style={{ left: position }}
        />
        <input
          type="range"
          min={-100}
          max={100}
          step={1}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          onPointerUp={(event) => onCommit(Number(event.currentTarget.value))}
          onKeyUp={(event) => {
            if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
              onCommit(Number(event.currentTarget.value));
            }
          }}
          onBlur={(event) => onCommit(Number(event.currentTarget.value))}
          className="absolute inset-0 h-5 w-full cursor-pointer opacity-0"
        />
      </div>
    </label>
  );
}

function LovartPanelIconButton({
  label,
  icon: Icon,
  compact,
  iconClassName,
  onClick,
}: {
  label: string;
  icon: LovartIcon;
  compact?: boolean;
  iconClassName?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center border-neutral-200 text-neutral-700 hover:bg-neutral-100 ${compact ? "h-7 w-7 rounded-md" : "h-11 w-11 border-r"}`}
      aria-label={label}
      title={label}
    >
      <Icon className={`h-4 w-4 ${iconClassName || ""}`} />
    </button>
  );
}

function LovartOperationPill({ rect, label }: { rect: { x: number; y: number; width: number; height: number }; label: string }) {
  return (
    <div
      className="pointer-events-none absolute z-40 -translate-x-1/2 rounded-full bg-neutral-800/55 px-4 py-1.5 text-sm font-medium text-white backdrop-blur"
      style={{ left: rect.x + rect.width / 2, top: rect.y + rect.height - 44 }}
    >
      {label}
    </div>
  );
}

function LovartBottomDock({
  activeTool,
  panelOpen,
  onToolChange,
  shapeMenuOpen,
  onSelectShapeTool,
  onAddText,
  onAddShape,
  onUpload,
  onImport,
  onReferenceUpload,
  onOpenPrompt,
}: {
  activeTool: CanvasTool;
  panelOpen: boolean;
  onToolChange: (tool: CanvasTool) => void;
  shapeMenuOpen: boolean;
  onSelectShapeTool: (tool: CanvasPlacementTool) => void;
  onAddText: () => void;
  onAddShape: () => void;
  onUpload: () => void;
  onImport: () => void;
  onReferenceUpload: () => void;
  onOpenPrompt: () => void;
}) {
  const center = panelOpen ? "calc((100% - 360px) / 2)" : "50%";
  const showShapeMenu = shapeMenuOpen;
  return (
    <div className="absolute bottom-4 z-50 -translate-x-1/2" style={{ left: center }} onPointerDown={(event) => event.stopPropagation()}>
      {showShapeMenu && (
        <div className="absolute bottom-14 left-1/2 w-40 -translate-x-1/2 rounded-xl border border-neutral-200 bg-white p-2 text-sm shadow-[0_16px_42px_rgba(0,0,0,0.16)]">
          <LovartShapeMenuItem icon={Square} label="矩形" shortcut="R" onClick={() => onSelectShapeTool("shape:rectangle")} />
          <LovartShapeMenuItem icon={Minus} label="直线" shortcut="L" onClick={() => onSelectShapeTool("shape:line")} />
          <LovartShapeMenuItem icon={CornerUpRight} label="箭头" shortcut="Shift L" onClick={() => onSelectShapeTool("shape:arrow")} />
          <LovartShapeMenuItem icon={Circle} label="椭圆" shortcut="O" onClick={() => onSelectShapeTool("shape:ellipse")} />
          <LovartShapeMenuItem icon={Shapes} label="多边形" onClick={() => onSelectShapeTool("shape:polygon")} />
          <LovartShapeMenuItem icon={Star} label="星形" onClick={() => onSelectShapeTool("shape:star")} />
        </div>
      )}
      <TooltipProvider delayDuration={350}>
        <div className="flex items-center gap-1 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-[0_12px_34px_rgba(0,0,0,0.16)]">
          <LovartDockButton active={activeTool === "select"} icon={MousePointer2} label="选择工具" onClick={() => onToolChange("select")} />
          <LovartDockButton active={activeTool === "mark"} icon={MapPin} label="标记工具" onClick={() => onToolChange("mark")} />
          <LovartDockButton active={activeTool === "image"} icon={ImagePlus} label="上传图片" onClick={onUpload} />
          <LovartDockButton active={activeTool === "frame"} icon={Grid3X3} label="画板工具" onClick={() => onToolChange("frame")} />
          <LovartDockButton active={activeTool.startsWith("shape:")} icon={Square} label="形状工具" onClick={onAddShape} />
          <LovartDockButton active={activeTool === "draw"} icon={Pencil} label="画笔工具" onClick={() => onToolChange("draw")} />
          <LovartDockButton active={activeTool === "text"} icon={Type} label="文字工具" onClick={onAddText} />
          <div className="h-6 w-px bg-neutral-200" />
          <LovartDockButton icon={FileImage} label="参考图" onClick={onReferenceUpload} />
          <LovartDockButton icon={Upload} label="导入" onClick={onImport} />
          <LovartDockButton icon={MessageSquarePlus} label="提示词" onClick={onOpenPrompt} hasDot />
        </div>
      </TooltipProvider>
    </div>
  );
}

function LovartShapeMenuItem({ icon: Icon, label, shortcut, onClick }: { icon: LovartIcon; label: string; shortcut?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      onClick={(event) => {
        if (event.detail === 0) onClick();
      }}
      className="flex h-8 w-full items-center justify-between rounded-lg px-2 text-left hover:bg-neutral-100"
    >
      <span className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        {label}
      </span>
      {shortcut && <span className="text-xs text-neutral-400">{shortcut}</span>}
    </button>
  );
}

function LovartDrawOptionsBar({
  panelOpen,
  stroke,
  strokeWidth,
  onStrokeChange,
  onStrokeWidthChange,
}: {
  panelOpen: boolean;
  stroke: string;
  strokeWidth: number;
  onStrokeChange: (value: string) => void;
  onStrokeWidthChange: (value: number) => void;
}) {
  const center = panelOpen ? "calc((100% - 360px) / 2)" : "50%";
  return (
    <div
      className="absolute bottom-[66px] z-50 flex -translate-x-1/2 items-center rounded-[13px] border border-neutral-200 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.10)]"
      style={{ left: center }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex h-10 w-12 items-center justify-center border-r border-neutral-200" aria-label="Draw color">
            <span className="h-5 w-5 rounded-full border border-neutral-300" style={{ backgroundColor: stroke }} />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="center" sideOffset={10} className="w-44 rounded-2xl p-2" onPointerDown={(event) => event.stopPropagation()}>
          <div className="grid grid-cols-7 gap-1">
            {DRAW_COLOR_SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                className={`h-6 w-6 rounded-full border ${
                  stroke.toLowerCase() === color.toLowerCase() ? "border-neutral-950 ring-2 ring-neutral-950/10" : "border-neutral-200"
                }`}
                style={{ backgroundColor: color }}
                aria-label={`Set draw color ${color}`}
                onClick={() => onStrokeChange(color)}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex h-10 items-center gap-2 px-4 text-sm" aria-label="Draw stroke width">
            <Layers3 className="h-4 w-4" />
            {strokeWidth}
            <span className="text-neutral-400">Px</span>
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="center" sideOffset={10} className="w-56 rounded-2xl p-3" onPointerDown={(event) => event.stopPropagation()}>
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stroke }} />
            <Slider
              value={[strokeWidth]}
              min={1}
              max={32}
              step={1}
              onValueChange={(value) => onStrokeWidthChange(value[0] ?? strokeWidth)}
              className="flex-1"
            />
            <span className="w-8 text-right text-xs font-medium text-neutral-500">{strokeWidth}</span>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function LovartDockButton({ icon: Icon, label, active, hasDot, onClick }: { icon: LovartIcon; label: string; active?: boolean; hasDot?: boolean; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onClick();
          }}
          onClick={(event) => {
            if (event.detail === 0) onClick();
          }}
          className={`relative inline-flex h-9 w-9 items-center justify-center rounded-xl transition ${active ? "bg-neutral-950 text-white" : "text-neutral-700 hover:bg-neutral-100"}`}
          aria-label={label}
          aria-pressed={active ?? undefined}
        >
          <Icon className="h-4.5 w-4.5" />
          {hasDot && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function LovartStatusBar({
  zoom,
  leftPanel,
  canvasBackground,
  canvasColorOpen,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onFit,
  onToggleLayers,
  onToggleFiles,
  onCanvasColorOpenChange,
  onCanvasBackgroundChange,
}: {
  zoom: number;
  leftPanel: LovartLeftPanel;
  canvasBackground: string;
  canvasColorOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFit: () => void;
  onToggleLayers: () => void;
  onToggleFiles: () => void;
  onCanvasColorOpenChange: (open: boolean) => void;
  onCanvasBackgroundChange: (color: string) => void;
}) {
  return (
    <div className="absolute bottom-4 left-4 z-40 flex items-center gap-2 rounded-full bg-white/75 px-2 py-1 text-xs font-medium text-neutral-500 shadow-sm backdrop-blur" onPointerDown={(event) => event.stopPropagation()}>
      <Popover open={canvasColorOpen} onOpenChange={onCanvasColorOpenChange}>
        <PopoverTrigger asChild>
          <button type="button" className="h-5 w-5 rounded-full border border-neutral-400" style={{ backgroundColor: canvasBackground }} aria-label="画布背景色" />
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={10} className="w-64 rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-950">画布背景色</span>
            <Palette className="h-4 w-4 text-neutral-400" />
          </div>
          <div className="grid grid-cols-6 gap-2">
            {CANVAS_BACKGROUND_SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => onCanvasBackgroundChange(color)}
                className={`h-8 w-8 rounded-full border ${canvasBackground === color ? "border-neutral-950 ring-2 ring-neutral-950/10" : "border-neutral-200"}`}
                style={{ backgroundColor: color }}
                aria-label={`背景 ${color}`}
              />
            ))}
          </div>
          <div className="mt-3 rounded-lg bg-neutral-50 px-2 py-1.5 font-mono text-xs text-neutral-500">{canvasBackground}</div>
        </PopoverContent>
      </Popover>
      <button type="button" onClick={onToggleLayers} className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${leftPanel === "layers" ? "bg-neutral-950 text-white" : "hover:bg-white"}`} aria-label="图层">
        <Layers3 className="h-4 w-4" />
      </button>
      <button type="button" onClick={onToggleFiles} className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${leftPanel === "files" ? "bg-neutral-950 text-white" : "hover:bg-white"}`} aria-label="已生成文件">
        <FileStack className="h-4 w-4" />
      </button>
      <button type="button" onClick={onUndo} disabled={!canUndo} className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-white disabled:opacity-30" aria-label="撤销"><Undo2 className="h-4 w-4" /></button>
      <button type="button" onClick={onRedo} disabled={!canRedo} className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-white disabled:opacity-30" aria-label="重做"><Redo2 className="h-4 w-4" /></button>
      <button type="button" onClick={onFit} className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-white" aria-label="适配画布" title="适配画布">
        <Maximize2 className="h-4 w-4" />
      </button>
      <span className="ml-1 tabular-nums">{Math.round(zoom * 100)}%</span>
    </div>
  );
}

function LovartMiniMap({
  document,
  viewport,
  panelOpen,
  leftPanelOpen,
  guideOpen,
  onJump,
  onDismissGuide,
}: {
  document: CanvasDocument;
  viewport: CanvasDocument["viewport"];
  panelOpen: boolean;
  leftPanelOpen: boolean;
  guideOpen: boolean;
  onJump: (x: number, y: number) => void;
  onDismissGuide: () => void;
}) {
  const bounds = getDocumentBounds(document.nodes) || { x: -600, y: -400, width: 1200, height: 800 };
  const mapWidth = 178;
  const mapHeight = 110;
  const padding = 24;
  const scale = Math.min(mapWidth / (bounds.width + padding * 2), mapHeight / (bounds.height + padding * 2));
  const originX = bounds.x - padding;
  const originY = bounds.y - padding;
  const bottomOffset = panelOpen ? 12 : 12;

  function toMapX(x: number) {
    return (x - originX) * scale;
  }

  function toMapY(y: number) {
    return (y - originY) * scale;
  }

  return (
    <div
      className={`absolute bottom-12 z-40 transition-[left] duration-200 ${leftPanelOpen ? "left-[276px]" : "left-6"}`}
      style={{ marginBottom: bottomOffset }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="relative block h-[124px] w-[202px] overflow-hidden rounded-2xl border border-neutral-200 bg-white/82 p-3 shadow-sm backdrop-blur"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = (event.clientX - rect.left - 12) / scale + originX;
          const y = (event.clientY - rect.top - 12) / scale + originY;
          onJump(x, y);
        }}
        aria-label="画布小地图"
      >
        <div className="relative h-[110px] w-[178px]">
          {document.nodes.filter((node) => node.visible).map((node) => (
            <span
              key={node.id}
              className={`absolute rounded-sm ${node.type === "image" ? "bg-neutral-300" : node.type === "text" ? "bg-neutral-500" : "bg-neutral-200"}`}
              style={{
                left: toMapX(node.x),
                top: toMapY(node.y),
                width: Math.max(4, node.width * scale),
                height: Math.max(4, node.height * scale),
              }}
            />
          ))}
          <span
            className="absolute rounded-sm border border-blue-500 bg-blue-500/10"
            style={{
              left: toMapX((-viewport.x) / viewport.zoom),
              top: toMapY((-viewport.y) / viewport.zoom),
              width: Math.max(14, (viewport.width / viewport.zoom) * scale),
              height: Math.max(14, (viewport.height / viewport.zoom) * scale),
            }}
          />
        </div>
      </button>
      {guideOpen && (
        <div className="absolute bottom-0 left-0 translate-y-[calc(100%+10px)] rounded-xl bg-neutral-950 p-3 text-xs font-medium leading-5 text-white shadow-xl">
          <p className="w-44">使用小地图来快速定位画布元素。</p>
          <Button type="button" size="sm" variant="secondary" className="mt-2 h-7 rounded-md px-3 text-xs" onClick={onDismissGuide}>知道了</Button>
        </div>
      )}
    </div>
  );
}

type LovartComposerTool = "Agent" | "Image Gen" | "Video Gen";

const LOVART_COMPOSER_TOOL_LABELS: Record<LovartComposerTool, string> = {
  Agent: "助手",
  "Image Gen": "图像",
  "Video Gen": "视频",
};

const LOVART_SKILL_ACTIONS: LovartSkillAction[] = [
  {
    label: "商品图生成",
    icon: Sparkles,
    mode: "generate",
    prompt: "生成一张高级电商商品视觉图，主体清晰，背景干净，适合上架和投放。",
  },
  {
    label: "一键换背景",
    icon: ImagePlus,
    mode: "edit",
    prompt: "为当前商品图更换一个干净高级的商业背景，保持商品主体、比例和光影关系稳定。",
  },
  {
    label: "智能抠图",
    icon: Scan,
    mode: "edit",
    prompt: "抠出商品主体并保留边缘细节，输出适合继续排版和设计的透明背景素材。",
  },
  {
    label: "多角度生成",
    icon: Shapes,
    mode: "reference",
    prompt: "基于当前商品参考图生成多个稳定角度，保持材质、颜色、结构和品牌质感一致。",
  },
  {
    label: "详情页套图",
    icon: Grid3X3,
    mode: "generate",
    prompt: "根据当前商品生成一组中文电商详情页视觉方案，包含卖点、场景、细节和尺码建议。",
  },
  {
    label: "AI 视觉助手",
    icon: Bot,
    mode: "edit",
    prompt: "分析当前画布并给出下一步可执行的商品视觉优化建议。",
  },
];

const LOVART_MODEL_MENU = [
  { value: "nano-banana-pro", label: "Nano Banana Pro", meta: "1.4× 积分", enabled: true },
  { value: "nano-banana-2", label: "Nano Banana 2", meta: "1.4× 积分", enabled: true },
  { value: "gpt-image-2", label: "GPT Image 2", meta: "", enabled: true },
  { value: "gpt-image-1.5", label: "GPT Image 1.5", meta: "即将支持", enabled: false },
  { value: "luma-uni-1", label: "Luma Uni-1", meta: "即将支持", enabled: false },
  { value: "luma-uni-1-max", label: "Luma Uni-1 Max", meta: "即将支持", enabled: false },
  { value: "flux-2-pro", label: "Flux 2 Pro", meta: "即将支持", enabled: false },
  { value: "flux-2-max", label: "Flux 2 Max", meta: "即将支持", enabled: false },
];

function LovartChatPanel({
  prompt,
  mode,
  model,
  quality,
  credits,
  attachments,
  results,
  isGenerating,
  error,
  cost,
  generationSettings,
  modelOptions,
  qualityOptions,
  canGenerate,
  onPromptChange,
  onModeChange,
  onModelChange,
  onQualityChange,
  onGenerationSettingsChange,
  onGenerate,
  onUpload,
  onRemoveAttachment,
  onClose,
  onNewChat,
  onShare,
  onOpenLibrary,
  onSkillSelect,
  inputRef,
  onPreviewResult,
  onInsertResult,
}: {
  prompt: string;
  mode: CanvasAssistantMode;
  model: string;
  quality: string;
  credits: number | null;
  attachments: CanvasAssistantAttachment[];
  results: CanvasAssistantResult[];
  isGenerating: boolean;
  error: string | null;
  cost: number;
  generationSettings: LovartGenerationSettings;
  modelOptions: Array<{ value: string; label: string; description?: string }>;
  qualityOptions: Array<{ value: string; label: string; description?: string }>;
  canGenerate: boolean;
  onPromptChange: (value: string) => void;
  onModeChange: (mode: CanvasAssistantMode) => void;
  onModelChange: (value: string) => void;
  onQualityChange: (value: string) => void;
  onGenerationSettingsChange: (settings: LovartGenerationSettings) => void;
  onGenerate: () => void;
  onUpload: () => void;
  onRemoveAttachment: (id: string) => void;
  onClose: () => void;
  onNewChat: () => void;
  onShare: () => void;
  onOpenLibrary: () => void;
  onSkillSelect: (skill: LovartSkillAction) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onPreviewResult: (result: CanvasAssistantResult) => void;
  onInsertResult: (result: CanvasAssistantResult) => void;
}) {
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composerTool, setComposerTool] = useState<LovartComposerTool>(mode === "edit" ? "Agent" : "Image Gen");
  const [qualityLevel, setQualityLevel] = useState(generationSettings.qualityLevel);
  const [width, setWidth] = useState(generationSettings.width);
  const [height, setHeight] = useState(generationSettings.height);
  const [sizePreset, setSizePreset] = useState(generationSettings.sizePreset);
  const [imageCount, setImageCount] = useState(generationSettings.imageCount);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setQualityLevel(generationSettings.qualityLevel);
    setWidth(generationSettings.width);
    setHeight(generationSettings.height);
    setSizePreset(generationSettings.sizePreset);
    setImageCount(generationSettings.imageCount);
  }, [generationSettings]);

  useEffect(() => {
    if (!isGenerating) {
      setElapsed(0);
      return;
    }

    const timer = window.setInterval(() => {
      setElapsed((value) => Math.min(value + 1, 120));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isGenerating]);

  useEffect(() => {
    onGenerationSettingsChange({ qualityLevel, width, height, sizePreset, imageCount: clampLovartImageCount(imageCount) });
  }, [height, imageCount, onGenerationSettingsChange, qualityLevel, sizePreset, width]);

  const promptText = prompt.trim();
  const hasConversation = Boolean(promptText || attachments.length || results.length || isGenerating || error);
  const isExecuting = isGenerating;
  const title = promptText ? getLovartPromptTitle(promptText) : "新对话";
  const selectedModel = LOVART_MODEL_MENU.find((item) => item.value === model);
  const fallbackModel = modelOptions.find((item) => item.value === model);
  const modelLabel = selectedModel?.label || fallbackModel?.label || "GPT Image 2";
  const assistantCopy = getLovartAssistantCopy(promptText);
  const settingsSummary = `${formatLovartQualityLevel(qualityLevel)} · ${formatLovartSizePreset(sizePreset)} · ${clampLovartImageCount(imageCount)} 张`;

  function toggleToolMenu() {
    setToolMenuOpen((value) => !value);
    setModelMenuOpen(false);
    setSettingsOpen(false);
  }

  function toggleModelMenu() {
    setModelMenuOpen((value) => !value);
    setToolMenuOpen(false);
    setSettingsOpen(false);
  }

  function toggleSettingsMenu() {
    setSettingsOpen((value) => !value);
    setToolMenuOpen(false);
    setModelMenuOpen(false);
  }

  function selectComposerTool(nextTool: LovartComposerTool) {
    setComposerTool(nextTool);
    setToolMenuOpen(false);
    setModelMenuOpen(false);
    setSettingsOpen(false);
    if (nextTool === "Agent") onModeChange("edit");
    if (nextTool === "Image Gen") onModeChange("generate");
    if (nextTool === "Video Gen") toast.message("视频生成入口已预留，后续接入阿里云视频 API。");
  }

  function selectModel(value: string) {
    const item = LOVART_MODEL_MENU.find((entry) => entry.value === value);
    if (item && !item.enabled) {
      toast.message(`${item.label} 入口已预留，后续接入对应模型。`);
      return;
    }
    onModelChange(value);
    setModelMenuOpen(false);
    setToolMenuOpen(false);
    setSettingsOpen(false);
  }

  function selectSizePreset(value: string) {
    setSizePreset(value);
    const preset = LOVART_SIZE_PRESET_DIMENSIONS[value];
    if (preset) {
      setWidth(preset.width);
      setHeight(preset.height);
      onQualityChange(preset.quality);
      return;
    }
    const normalized = value.toLowerCase();
    if (normalized.includes("4k")) onQualityChange("4K");
    else if (normalized.includes("2k")) onQualityChange("2K");
    else onQualityChange("1K");
  }

  return (
    <aside className="absolute inset-y-0 right-0 z-40 flex w-[360px] flex-col border-l border-neutral-200 bg-white text-neutral-950">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-neutral-100 px-4">
        <h2 className="truncate text-[13px] font-semibold">{title}</h2>
        <div className="flex items-center gap-1 text-neutral-400">
          <button type="button" onClick={onNewChat} className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-neutral-100" aria-label="新建对话">
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onShare} className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-neutral-100" aria-label="分享">
            <Share2 className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onClose} className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-neutral-100" aria-label="收起">
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {hasConversation ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
          <div className="mb-6 flex justify-end">
            <div className="max-w-[292px] rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-right shadow-sm">
              {attachments[0] && (
                <span className="mb-1 ml-auto flex max-w-[160px] items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-1 text-left text-xs text-neutral-700">
                  <FileImage className="h-3.5 w-3.5 text-neutral-400" />
                  <span className="truncate">{getLovartAttachmentLabel(attachments[0])}</span>
                </span>
              )}
              <p className="text-sm font-semibold leading-5 text-neutral-950">{promptText || "帮我生成一张商品视觉图"}</p>
            </div>
          </div>

          <p className="mb-2 text-xs font-medium text-neutral-400">2026年5月11日</p>
          <p className="text-[13px] font-semibold leading-6 text-neutral-950">{assistantCopy}</p>

          <div className="mt-4 flex items-center gap-2 text-neutral-400">
            <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-neutral-100" aria-label="赞">
              <ThumbsUp className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-neutral-100" aria-label="踩">
              <ThumbsDown className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-4 flex items-center gap-2 text-[13px] font-semibold text-neutral-500">
            <Box className="h-4 w-4 text-neutral-400" />
            <span>{modelLabel}</span>
          </div>

          {results.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {results.map((result) => {
                const url = result.thumbnailUrl || result.imageUrl;
                return (
                  <button key={result.id} type="button" onClick={() => onPreviewResult(result)} className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 text-left">
                    {url ? <img src={url} alt={result.title || "结果图"} className="aspect-square w-full object-cover" /> : <div className="flex aspect-square items-center justify-center text-xs text-neutral-400">{formatCanvasResultStatus(result.status)}</div>}
                    <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                      <span className="truncate text-xs font-medium">{result.title || "AI 结果"}</span>
                      <span onClick={(event) => { event.stopPropagation(); onInsertResult(result); }} className="rounded-full bg-neutral-950 px-2 py-0.5 text-[10px] font-bold text-white">加入</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : isGenerating ? (
            <div className="mt-2">
              <p className="mb-2 text-sm font-semibold text-neutral-500">执行中</p>
              <div className="h-[276px] w-[220px] rounded-[4px] bg-[radial-gradient(circle_at_25%_20%,#f7f5ef,transparent_38%),linear-gradient(135deg,#f1eee8,#f8f8f7_55%,#ece9e1)] shadow-inner" />
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm leading-6 text-neutral-600">
              参数已准备好。点击右下角发送后，系统会按当前模型、比例和数量创建任务；结果会自动进入画布和已生成文件列表。
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-5">
          <div className="text-center">
            <p className="mb-5 text-sm font-semibold text-neutral-600">试试这些 VastWear 技能</p>
            <div className="flex flex-wrap justify-center gap-2">
              {LOVART_SKILL_ACTIONS.map((skill) => (
                <LovartSkillChip key={skill.label} icon={skill.icon} label={skill.label} onClick={() => onSkillSelect(skill)} />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="shrink-0 px-3 pb-3">
        {isExecuting && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-full bg-white px-2 py-1 text-[13px] text-neutral-600 shadow-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-white">
                <Sparkles className="h-3 w-3" />
              </span>
              <span className="truncate">正在使用 {modelLabel} 生成...</span>
            </span>
            <span className="shrink-0 font-semibold text-neutral-950">{formatLovartElapsed(isGenerating ? elapsed : 9)} / 2 m</span>
          </div>
        )}

        <div className="relative rounded-[22px] border border-neutral-200 bg-white p-2 shadow-[0_10px_34px_rgba(0,0,0,0.08)]">
          {toolMenuOpen && <LovartToolMenu current={composerTool} onSelect={selectComposerTool} />}
          {modelMenuOpen && <LovartModelMenu current={model} onSelect={selectModel} />}
          {settingsOpen && (
            <LovartSettingsPopover
              qualityLevel={qualityLevel}
              width={width}
              height={height}
              sizePreset={sizePreset}
              imageCount={imageCount}
              quality={quality}
              qualityOptions={qualityOptions}
              onQualityLevelChange={setQualityLevel}
              onWidthChange={setWidth}
              onHeightChange={setHeight}
              onSizePresetChange={selectSizePreset}
              onQualityChange={onQualityChange}
              onImageCountChange={setImageCount}
            />
          )}

          {attachments.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((item) => (
                <span key={item.id} className="inline-flex max-w-[178px] items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs">
                  <FileImage className="h-3 w-3 text-neutral-400" />
                  <span className="truncate">{getLovartAttachmentLabel(item)}</span>
                  <button type="button" onClick={() => onRemoveAttachment(item.id)} className="text-neutral-400 hover:text-neutral-900" aria-label="删除附件">
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <button type="button" onClick={onUpload} className="mb-2 flex h-14 w-14 flex-col items-center justify-center rounded-2xl bg-neutral-100 text-[11px] font-medium text-neutral-400 hover:bg-neutral-200">
              <ImageIcon className="mb-1 h-4 w-4" />
              参考图
            </button>
          )}

          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder={'描述你的创作需求，也可以输入 "@" 引用'}
            className="min-h-16 w-full resize-none rounded-2xl px-1 py-1 text-sm leading-5 outline-none placeholder:text-neutral-400"
          />
          {error && <p className="px-1 pb-1 text-xs font-semibold text-red-500">{error}</p>}

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-1">
              <button type="button" onClick={onUpload} className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-neutral-100" aria-label="上传参考图">
                <Plus className="h-4 w-4" />
              </button>
              <button type="button" onClick={onOpenLibrary} className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-neutral-100" aria-label="资料库">
                <BookOpen className="h-4 w-4" />
              </button>
              <button type="button" onClick={toggleToolMenu} className="inline-flex h-8 items-center gap-1 rounded-full border border-neutral-200 bg-white px-2.5 text-sm font-medium shadow-sm hover:bg-neutral-50" aria-label="选择生成模式">
                <ImagePlus className="h-4 w-4" />
                {LOVART_COMPOSER_TOOL_LABELS[composerTool]}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={toggleSettingsMenu} className="inline-flex h-8 max-w-[132px] items-center gap-1 rounded-full border border-neutral-200 bg-white px-2.5 text-xs font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50" aria-label="生成设置">
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{settingsSummary}</span>
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button type="button" onClick={toggleModelMenu} className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200" aria-label="选择模型">
                <Bot className="h-4 w-4" />
              </button>
              <span className="inline-flex h-8 items-center gap-1 rounded-full bg-neutral-100 px-2 text-xs font-semibold text-neutral-500">
                <Zap className="h-3.5 w-3.5" />
                {cost}
              </span>
              <button
                type="button"
                onClick={isGenerating ? () => toast.message("停止生成入口已预留。") : onGenerate}
                disabled={!isGenerating && !canGenerate}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-neutral-950 text-white disabled:bg-neutral-100 disabled:text-neutral-300"
                aria-label={isGenerating ? "停止生成" : `生成，消耗 ${cost} 积分`}
              >
                {isGenerating ? <StopCircle className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
        <div className="mt-1 px-2 text-right text-[11px] font-medium text-neutral-400">
          积分 {credits === null ? "--" : credits}
        </div>
      </div>
    </aside>
  );
}

function LovartToolMenu({
  current,
  onSelect,
}: {
  current: LovartComposerTool;
  onSelect: (tool: LovartComposerTool) => void;
}) {
  const tools: Array<{ value: LovartComposerTool; icon: LovartIcon }> = [
    { value: "Agent", icon: Bot },
    { value: "Image Gen", icon: ImagePlus },
    { value: "Video Gen", icon: FileImage },
  ];

  return (
    <div className="absolute bottom-[58px] left-3 z-50 w-44 rounded-xl border border-neutral-200 bg-white p-1.5 text-sm shadow-[0_14px_40px_rgba(0,0,0,0.16)]">
      {tools.map((tool) => (
        <button key={tool.value} type="button" onClick={() => onSelect(tool.value)} className="flex h-9 w-full items-center justify-between rounded-lg px-2 text-left hover:bg-neutral-100">
          <span className="flex items-center gap-2">
            <tool.icon className="h-4 w-4 text-neutral-600" />
            {LOVART_COMPOSER_TOOL_LABELS[tool.value]}
          </span>
          {current === tool.value && <Check className="h-4 w-4 text-neutral-950" />}
        </button>
      ))}
    </div>
  );
}

function LovartModelMenu({
  current,
  onSelect,
}: {
  current: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="absolute bottom-[54px] right-4 z-50 max-h-[270px] w-64 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1.5 text-sm shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
      {LOVART_MODEL_MENU.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => onSelect(item.value)}
          className={`flex h-9 w-full items-center justify-between gap-2 rounded-lg px-2 text-left ${item.enabled ? "hover:bg-neutral-100" : "text-neutral-400"}`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Bot className="h-4 w-4 shrink-0 text-neutral-500" />
            <span className="truncate">{item.label}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {item.meta && <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-500">{item.meta}</span>}
            {current === item.value && <Check className="h-4 w-4 text-neutral-950" />}
          </span>
        </button>
      ))}
    </div>
  );
}

function LovartSettingsPopover({
  qualityLevel,
  width,
  height,
  sizePreset,
  imageCount,
  quality,
  qualityOptions,
  onQualityLevelChange,
  onWidthChange,
  onHeightChange,
  onSizePresetChange,
  onQualityChange,
  onImageCountChange,
}: {
  qualityLevel: string;
  width: number;
  height: number;
  sizePreset: string;
  imageCount: number;
  quality: string;
  qualityOptions: Array<{ value: string; label: string; description?: string }>;
  onQualityLevelChange: (value: string) => void;
  onWidthChange: (value: number) => void;
  onHeightChange: (value: number) => void;
  onSizePresetChange: (value: string) => void;
  onQualityChange: (value: string) => void;
  onImageCountChange: (value: number) => void;
}) {
  const sizeOptions = ["1:1", "3:2", "2:3", "1:1(2k)", "16:9(2k)", "16:9(4k)", "9:16(4k)", "auto"];
  const qualityLevelOptions = [
    { value: "Auto", label: "自动" },
    { value: "High", label: "高" },
    { value: "Medium", label: "中" },
    { value: "Low", label: "低" },
  ] as const;

  return (
    <div className="absolute bottom-[58px] left-3 z-50 w-[304px] rounded-2xl border border-neutral-200 bg-white p-3 shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
      <p className="mb-2 text-xs font-semibold text-neutral-600">质量</p>
      <div className="mb-4">
        <StudioSegmentedControl
          value={qualityLevel}
          options={qualityLevelOptions}
          onChange={onQualityLevelChange}
          ariaLabel="画布生成质量"
          columns={4}
        />
      </div>

      <p className="mb-2 text-xs font-semibold text-neutral-600">尺寸</p>
      <div className="mb-4 flex items-center gap-2">
        <label className="flex h-10 flex-1 items-center gap-2 rounded-lg bg-neutral-100 px-3 text-sm text-neutral-500">
          W
          <input value={width} onChange={(event) => onWidthChange(Number(event.target.value) || 0)} className="min-w-0 flex-1 bg-transparent font-semibold text-neutral-700 outline-none" />
        </label>
        <span className="text-neutral-400">↔</span>
        <label className="flex h-10 flex-1 items-center gap-2 rounded-lg bg-neutral-100 px-3 text-sm text-neutral-500">
          H
          <input value={height} onChange={(event) => onHeightChange(Number(event.target.value) || 0)} className="min-w-0 flex-1 bg-transparent font-semibold text-neutral-700 outline-none" />
        </label>
      </div>

      <p className="mb-2 text-xs font-semibold text-neutral-600">比例</p>
      <div className="mb-4 grid grid-cols-4 gap-2">
        {sizeOptions.map((item) => (
          <button key={item} type="button" onClick={() => onSizePresetChange(item)} className={`h-[72px] rounded-lg border text-xs font-medium ${sizePreset === item ? "border-neutral-400 bg-neutral-100" : "border-neutral-200 bg-white hover:bg-neutral-50"}`}>
            <span className="mx-auto mb-2 block h-5 w-5 rounded-sm border border-neutral-400" />
            {item === "auto" ? "自动" : item.replace("(2k)", " 2K").replace("(4k)", " 4K")}
          </button>
        ))}
      </div>

      <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold text-neutral-600">图片质量</p>
        <div className="flex gap-1">
          {qualityOptions.map((item) => (
            <button key={item.value} type="button" onClick={() => onQualityChange(item.value)} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${quality === item.value ? "bg-neutral-950 text-white" : "bg-neutral-100 text-neutral-500"}`}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {Array.from({ length: 10 }, (_, index) => index + 1).map((item) => (
          <button key={item} type="button" onClick={() => onImageCountChange(item)} className={`h-8 rounded-lg border text-xs font-semibold ${imageCount === item ? "border-neutral-400 bg-neutral-100" : "border-neutral-200 bg-white hover:bg-neutral-50"}`}>
            {item} 张
          </button>
        ))}
      </div>
    </div>
  );
}

function getLovartPromptTitle(prompt: string) {
  return prompt.length > 18 ? `${prompt.slice(0, 18)}...` : prompt;
}

function getLovartAssistantCopy(prompt: string) {
  if (/脸|face/i.test(prompt)) {
    return "我来帮你更换模特的脸部。我会保持模特的姿势、服装和整体构图不变，只替换脸部特征。输出会优先保持商品展示稳定。";
  }
  if (/背景|background/i.test(prompt)) {
    return "我会基于当前图片生成新的背景方案，同时保留商品主体、比例和光影关系，方便后续接入正式生成接口。";
  }
  return "我会根据当前画布、参考图和你的描述生成商品视觉任务，并把参数、模型与输出数量整理成可接入后端的结构。";
}

function getLovartAttachmentLabel(item: CanvasAssistantAttachment) {
  return item.name || "参考图";
}

function formatCanvasResultStatus(status: CanvasAssistantResult["status"]) {
  if (status === "generating") return "生成中";
  if (status === "failed") return "失败";
  return "已完成";
}

function formatLovartElapsed(seconds: number) {
  const value = Math.max(0, seconds);
  const minutes = Math.floor(value / 60).toString().padStart(2, "0");
  const remaining = (value % 60).toString().padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function clampLovartImageCount(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.floor(value), 1), 10);
}

function formatLovartQualityLevel(value: string) {
  const map: Record<string, string> = {
    Auto: "自动",
    High: "高",
    Medium: "中",
    Low: "低",
  };
  return map[value] || value;
}

function formatLovartSizePreset(value: string) {
  if (value === "auto") return "自动";
  return value.replace("(2k)", " 2K").replace("(4k)", " 4K");
}

function resolveLovartAspectRatio(value: string): AspectRatio {
  const normalized = value.replace(/\((?:2|4)k\)/i, "") as AspectRatio;
  if (["auto", "1:1", "9:16", "16:9", "4:3", "3:4", "2:3", "3:2", "4:5", "5:4", "21:9"].includes(normalized)) {
    return normalized;
  }
  return DEFAULT_ASPECT_RATIO;
}

function resolveLovartImageSize(value: string, fallback: ImageSize): ImageSize {
  return LOVART_SIZE_PRESET_DIMENSIONS[value]?.quality ?? fallback;
}

function LovartSkillChip({ icon: Icon, label, onClick }: { icon: LovartIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 shadow-sm hover:border-neutral-300 hover:bg-neutral-50">
      <Icon className="h-3.5 w-3.5 text-violet-500" />
      {label}
    </button>
  );
}

function CustomizeToolbarModal({
  showToolNames,
  visibleToolKeys,
  onShowToolNamesChange,
  onVisibleToolKeysChange,
  onClose,
}: {
  showToolNames: boolean;
  visibleToolKeys: LovartImageToolKey[];
  onShowToolNamesChange: (value: boolean) => void;
  onVisibleToolKeysChange: (keys: LovartImageToolKey[]) => void;
  onClose: () => void;
}) {
  const [draftKeys, setDraftKeys] = useState<LovartImageToolKey[]>(visibleToolKeys);
  const [draftShowToolNames, setDraftShowToolNames] = useState(showToolNames);

  useEffect(() => {
    setDraftKeys(visibleToolKeys);
    setDraftShowToolNames(showToolNames);
  }, [showToolNames, visibleToolKeys]);

  const draftKeySet = useMemo(() => new Set(draftKeys), [draftKeys]);
  const previewTools = LOVART_IMAGE_TOOLS.filter((tool) => draftKeySet.has(tool.key));

  function toggleTool(key: LovartImageToolKey) {
    setDraftKeys((current) => (
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    ));
  }

  function resetTools() {
    setDraftKeys(DEFAULT_VISIBLE_IMAGE_TOOL_KEYS);
    setDraftShowToolNames(true);
  }

  function saveTools() {
    onVisibleToolKeysChange(draftKeys);
    onShowToolNamesChange(draftShowToolNames);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[720px] rounded-3xl p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <DialogHeader className="text-left">
            <DialogTitle>自定义工具栏</DialogTitle>
            <DialogDescription>选择你想在编辑栏中使用的工具。</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <button type="button" onClick={resetTools} className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-neutral-100" aria-label="重置">
              <Undo2 className="h-4 w-4" />
            </button>
            <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-neutral-100" aria-label="关闭">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mb-6 overflow-hidden rounded-xl bg-[linear-gradient(135deg,#e7f4fb,#f5edf9_48%,#eef5e8)] p-7">
          <div className="flex max-w-full items-center overflow-hidden rounded-2xl bg-white/85 p-2 shadow-sm">
            <LovartToolbarButton icon={Sparkles} label="快捷编辑" hint="Tab" showLabel={draftShowToolNames} interactive={false} />
            {previewTools.map((tool) => (
              <div key={tool.key} className="relative">
                <LovartToolbarButton icon={tool.icon} badge={tool.badge} label={tool.label} showLabel={draftShowToolNames} interactive={false} />
                <button
                  type="button"
                  onClick={() => toggleTool(tool.key)}
                  className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] text-neutral-400 shadow hover:text-neutral-900"
                  aria-label={`移除 ${tool.label}`}
                >
                  ×
                </button>
              </div>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="inline-flex h-9 w-10 items-center justify-center text-neutral-700 hover:bg-neutral-100" aria-label="更多工具预览">
                  <MoreHorizontal className="h-4.5 w-4.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} className="w-40 rounded-2xl p-2">
                {LOVART_IMAGE_TOOLS.filter((tool) => !draftKeySet.has(tool.key)).map((tool) => (
                  <DropdownMenuItem key={tool.key} onSelect={() => toggleTool(tool.key)} className="cursor-pointer rounded-lg">
                    {tool.icon ? <tool.icon className="mr-2 h-4 w-4" /> : <span className="mr-2 rounded border border-neutral-400 px-0.5 text-[9px] font-black leading-3">{tool.badge}</span>}
                    {tool.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {LOVART_IMAGE_TOOLS.map((tool) => {
            const pinned = draftKeySet.has(tool.key);
            return (
            <button
              key={tool.key}
              type="button"
              aria-pressed={pinned}
              onClick={() => toggleTool(tool.key)}
              className={`flex h-10 items-center justify-between rounded-lg border px-3 text-left text-sm font-medium transition ${
                pinned ? "border-neutral-300 bg-neutral-50 text-neutral-950" : "border-neutral-200 hover:bg-neutral-50"
              }`}
            >
              <span className="flex items-center gap-2">
                {tool.icon ? <tool.icon className="h-4 w-4" /> : <span className="rounded border border-neutral-400 px-0.5 text-[9px] font-black leading-3">{tool.badge}</span>}
                {tool.label}
              </span>
              <Pin className={`h-3.5 w-3.5 ${pinned ? "fill-neutral-800 text-neutral-800" : "text-neutral-400"}`} />
            </button>
            );
          })}
        </div>

        <DialogFooter className="mt-8 flex-row items-center justify-between sm:justify-between">
          <label className="inline-flex items-center gap-3 text-sm font-medium">
            <Switch checked={draftShowToolNames} onCheckedChange={setDraftShowToolNames} />
            显示工具名称
          </label>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="button" onClick={saveTools}>保存</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function documentAssetsToLibrary(document: CanvasDocument): CanvasAssetItem[] {
  return document.assets.map((asset) => ({
    id: asset.id.replace(/^asset-/, ""),
    name: asset.name || "素材",
    url: asset.src,
    previewUrl: asset.src,
    width: asset.width,
    height: asset.height,
  }));
}

function getImageSource(node: CanvasNode, document: CanvasDocument) {
  if (node.type !== "image") return "";
  if (node.src) return node.src;
  return node.assetId ? document.assets.find((asset) => asset.id === node.assetId)?.src || "" : "";
}

type ImageContentBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function getImageContentBox(node: CanvasNode): ImageContentBox {
  const data = node.data || {};
  return {
    x: readNodeDataNumber(data, "contentX", 0),
    y: readNodeDataNumber(data, "contentY", 0),
    width: readNodeDataNumber(data, "contentWidth", node.width),
    height: readNodeDataNumber(data, "contentHeight", node.height),
  };
}

function readNodeDataNumber(data: Record<string, unknown>, key: string, fallback: number) {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readNodeDataString(data: Record<string, unknown> | undefined, key: string) {
  const value = data?.[key];
  return typeof value === "string" && value.trim() ? value : "";
}

function getDocumentSelectionIdsForNode(document: CanvasDocument, id: CanvasNodeId) {
  const node = document.nodes.find((candidate) => candidate.id === id);
  if (!node) return [id];

  const groupId = readNodeDataString(node.data, "groupId");
  if (!groupId) return [id];

  const groupIds = document.nodes
    .filter((candidate) => readNodeDataString(candidate.data, "groupId") === groupId)
    .map((candidate) => candidate.id);

  return groupIds.length > 1 ? groupIds : [id];
}

function removeNodeGroupData(data: Record<string, unknown> | undefined) {
  if (!data) return undefined;
  const nextData = { ...data };
  delete nextData.groupId;
  delete nextData.mergedFrameId;
  delete nextData.mergedFrom;
  return Object.keys(nextData).length ? nextData : undefined;
}

function removeNodeMergeData(data: Record<string, unknown> | undefined) {
  if (!data) return {};
  const nextData = { ...data };
  delete nextData.mergedFrameId;
  delete nextData.mergedFrom;
  return nextData;
}

function rekeyDuplicatedGroupData(nextDocument: CanvasDocument, previousDocument: CanvasDocument) {
  const previousIds = new Set(previousDocument.nodes.map((node) => node.id));
  const groupIdMap = new Map<string, string>();

  return createCanvasDocument({
    ...nextDocument,
    nodes: nextDocument.nodes.map((node) => {
      if (previousIds.has(node.id)) return node;

      const groupId = readNodeDataString(node.data, "groupId");
      if (!groupId) return node;

      let nextGroupId = groupIdMap.get(groupId);
      if (!nextGroupId) {
        nextGroupId = createId("group");
        groupIdMap.set(groupId, nextGroupId);
      }

      return {
        ...node,
        data: { ...removeNodeMergeData(node.data), groupId: nextGroupId },
      };
    }),
  });
}

function readStoredMarkerPrompt(node: CanvasNode | null | undefined) {
  const value = node?.data?.markerPrompt;
  return typeof value === "string" ? value : "";
}

function readStoredAdjustValues(node: CanvasNode | null | undefined): ImageAdjustValues {
  const raw = node?.data?.adjustValues;
  if (!isPlainRecord(raw)) return { ...DEFAULT_ADJUST_VALUES };
  return ADJUST_VALUE_KEYS.reduce<ImageAdjustValues>((values, key) => {
    values[key] = readAdjustValue(raw[key], DEFAULT_ADJUST_VALUES[key]);
    return values;
  }, { ...DEFAULT_ADJUST_VALUES });
}

function writeStoredAdjustValues(data: Record<string, unknown> | undefined, values: ImageAdjustValues) {
  const next: Record<string, unknown> = { ...(data || {}) };
  if (isDefaultAdjustValues(values)) {
    delete next.adjustValues;
  } else {
    next.adjustValues = { ...values };
  }
  return Object.keys(next).length ? next : undefined;
}

function readAdjustValue(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(-100, Math.min(100, Math.round(parsed)));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shallowRecordEqual(left: Record<string, unknown> | undefined, right: Record<string, unknown> | undefined) {
  if (left === right) return true;
  const leftKeys = Object.keys(left || {});
  const rightKeys = Object.keys(right || {});
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => {
    const leftValue = left?.[key];
    const rightValue = right?.[key];
    if (key === "adjustValues") return adjustValueRecordsEqual(leftValue, rightValue);
    return Object.is(leftValue, rightValue);
  });
}

function adjustValueRecordsEqual(left: unknown, right: unknown) {
  if (!isPlainRecord(left) || !isPlainRecord(right)) return left === right;
  return ADJUST_VALUE_KEYS.every((key) => readAdjustValue(left[key], DEFAULT_ADJUST_VALUES[key]) === readAdjustValue(right[key], DEFAULT_ADJUST_VALUES[key]));
}

function applyExpandedFrameToImageNode(node: CanvasNode, scale: number, ratioValue: string, ratio: number | null): CanvasNode {
  const content = getImageContentBox(node);
  const centerX = node.x + content.x + content.width / 2;
  const centerY = node.y + content.y + content.height / 2;
  const safeScale = Math.max(1, Number.isFinite(scale) ? scale : 1);
  let nextWidth = content.width;
  let nextHeight = content.height;

  if (ratio && ratio > 0) {
    nextHeight = nextWidth / ratio;
    if (nextHeight < content.height) {
      nextHeight = content.height;
      nextWidth = nextHeight * ratio;
    }
  }

  nextWidth = Math.max(96, Math.round(nextWidth * safeScale));
  nextHeight = Math.max(96, Math.round(nextHeight * safeScale));

  const nextX = centerX - nextWidth / 2;
  const nextY = centerY - nextHeight / 2;

  return preserveImageContentInFrame(node, {
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight,
  }, "expand", ratioValue);
}

function applyCropPreviewToImageNode(node: CanvasNode, ratioValue: string, ratio: number | null): CanvasNode {
  const content = getImageContentBox(node);
  const contentWorldX = node.x + content.x;
  const contentWorldY = node.y + content.y;
  const existingData = node.data || {};
  const previewStarted = existingData.imageFrameMode === "crop-preview";
  const originalFrame = previewStarted
    ? {
        x: readNodeDataNumber(existingData, "cropOriginalFrameX", node.x),
        y: readNodeDataNumber(existingData, "cropOriginalFrameY", node.y),
        width: readNodeDataNumber(existingData, "cropOriginalFrameWidth", node.width),
        height: readNodeDataNumber(existingData, "cropOriginalFrameHeight", node.height),
        cropRatio: typeof existingData.cropOriginalRatio === "string" ? existingData.cropOriginalRatio : node.cropRatio || "original",
      }
    : {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        cropRatio: node.cropRatio || "original",
      };
  let cropWidth = content.width;
  let cropHeight = content.height;

  if (ratio && ratio > 0) {
    const currentRatio = content.width / Math.max(content.height, 1);
    if (currentRatio > ratio) {
      cropWidth = content.height * ratio;
    } else {
      cropHeight = content.width / ratio;
    }
  }

  cropWidth = Math.max(96, Math.min(content.width, Math.round(cropWidth)));
  cropHeight = Math.max(96, Math.min(content.height, Math.round(cropHeight)));

  return {
    ...node,
    x: contentWorldX,
    y: contentWorldY,
    width: content.width,
    height: content.height,
    cropRatio: ratioValue,
    data: {
      ...existingData,
      contentX: 0,
      contentY: 0,
      contentWidth: content.width,
      contentHeight: content.height,
      cropOriginalFrameX: originalFrame.x,
      cropOriginalFrameY: originalFrame.y,
      cropOriginalFrameWidth: originalFrame.width,
      cropOriginalFrameHeight: originalFrame.height,
      cropOriginalRatio: originalFrame.cropRatio,
      cropFrameX: Math.round((content.width - cropWidth) / 2),
      cropFrameY: Math.round((content.height - cropHeight) / 2),
      cropFrameWidth: cropWidth,
      cropFrameHeight: cropHeight,
      imageFrameMode: "crop-preview",
    },
  };
}

function cancelCropPreviewToImageNode(node: CanvasNode): CanvasNode {
  if (node.data?.imageFrameMode !== "crop-preview") return node;
  const originalFrame = {
    x: readNodeDataNumber(node.data, "cropOriginalFrameX", node.x),
    y: readNodeDataNumber(node.data, "cropOriginalFrameY", node.y),
    width: readNodeDataNumber(node.data, "cropOriginalFrameWidth", node.width),
    height: readNodeDataNumber(node.data, "cropOriginalFrameHeight", node.height),
  };
  const originalRatio = typeof node.data.cropOriginalRatio === "string" ? node.data.cropOriginalRatio : node.cropRatio || "original";
  return preserveImageContentInFrame(node, originalFrame, "normal", originalRatio);
}

function commitCropPreviewToImageNode(node: CanvasNode): CanvasNode {
  if (node.data?.imageFrameMode !== "crop-preview") return node;
  const cropX = readNodeDataNumber(node.data, "cropFrameX", 0);
  const cropY = readNodeDataNumber(node.data, "cropFrameY", 0);
  const cropWidth = readNodeDataNumber(node.data, "cropFrameWidth", node.width);
  const cropHeight = readNodeDataNumber(node.data, "cropFrameHeight", node.height);
  return preserveImageContentInFrame(node, {
    x: node.x + cropX,
    y: node.y + cropY,
    width: cropWidth,
    height: cropHeight,
  }, "normal", node.cropRatio || "custom");
}

function cancelCropPreviewsInDocument(document: CanvasDocument): CanvasDocument {
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (node.type !== "image" || node.data?.imageFrameMode !== "crop-preview") return node;
    changed = true;
    return cancelCropPreviewToImageNode(node);
  });
  return changed ? createCanvasDocument({ ...document, nodes }) : document;
}

function preserveImageContentInFrame(
  node: CanvasNode,
  frame: { x: number; y: number; width: number; height: number },
  mode: "normal" | "expand" | "crop-preview",
  cropRatio: string,
): CanvasNode {
  const content = getImageContentBox(node);
  const contentWorldX = node.x + content.x;
  const contentWorldY = node.y + content.y;
  const data: Record<string, unknown> = {
    ...(node.data || {}),
    contentX: contentWorldX - frame.x,
    contentY: contentWorldY - frame.y,
    contentWidth: content.width,
    contentHeight: content.height,
    imageFrameMode: mode,
  };
  if (mode !== "crop-preview") {
    delete data.cropFrameX;
    delete data.cropFrameY;
    delete data.cropFrameWidth;
    delete data.cropFrameHeight;
    delete data.cropOriginalFrameX;
    delete data.cropOriginalFrameY;
    delete data.cropOriginalFrameWidth;
    delete data.cropOriginalFrameHeight;
    delete data.cropOriginalRatio;
  }
  return {
    ...node,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    cropRatio,
    data,
  };
}

function findMarkerTargetImage(marker: CanvasNode | null, document: CanvasDocument) {
  if (!marker) return null;
  const targetId = typeof marker.data?.targetId === "string" ? marker.data.targetId : "";
  const explicitTarget = document.nodes.find((node) => node.id === targetId && node.type === "image");
  if (explicitTarget) return explicitTarget;

  const centerX = marker.x + marker.width / 2;
  const centerY = marker.y + marker.height / 2;
  return document.nodes
    .filter((node) =>
      node.type === "image" &&
      node.visible &&
      centerX >= node.x &&
      centerX <= node.x + node.width &&
      centerY >= node.y &&
      centerY <= node.y + node.height
    )
    .sort((a, b) => b.zIndex - a.zIndex)[0] || null;
}

function getMarkerLabel(marker: CanvasNode) {
  const data = marker.data || {};
  const value = data.tagLabel || data.label || data.objectName;
  return typeof value === "string" && value.trim() ? value.trim() : "object";
}

function syncMarkerTargetData(document: CanvasDocument, selectedIds: Set<CanvasNodeId>) {
  const imageNodes = new Map(document.nodes.filter((node) => node.type === "image").map((node) => [node.id, node]));
  let changed = false;

  const nodes = document.nodes.map((node) => {
    if (node.shapeKind !== "marker") return node;

    const targetId = readNodeDataString(node.data, "targetId");
    const target = targetId ? imageNodes.get(targetId) : null;
    if (!target) return node;

    const storedX = readNodeDataRatio(node.data, "targetX");
    const storedY = readNodeDataRatio(node.data, "targetY");
    const currentLabel = readNodeDataString(node.data, "tagLabel");

    if (!selectedIds.has(node.id) && storedX !== null && storedY !== null) {
      const nextX = roundCanvasCoord(target.x + target.width * storedX - node.width / 2);
      const nextY = roundCanvasCoord(target.y + target.height * storedY - node.height / 2);
      if (node.x === nextX && node.y === nextY && currentLabel) return node;

      changed = true;
      return {
        ...node,
        x: nextX,
        y: nextY,
        data: {
          ...(node.data || {}),
          targetId,
          targetX: storedX,
          targetY: storedY,
          tagLabel: currentLabel || inferMarkerLabelFromRatio(storedX, storedY),
        },
      };
    }

    const targetX = roundMarkerRatio((node.x + node.width / 2 - target.x) / Math.max(target.width, 1));
    const targetY = roundMarkerRatio((node.y + node.height / 2 - target.y) / Math.max(target.height, 1));
    const currentX = typeof node.data?.targetX === "number" ? node.data.targetX : null;
    const currentY = typeof node.data?.targetY === "number" ? node.data.targetY : null;

    if (currentX === targetX && currentY === targetY && currentLabel) return node;

    changed = true;
    return {
      ...node,
      data: {
        ...(node.data || {}),
        targetId,
        targetX,
        targetY,
        tagLabel: currentLabel || inferMarkerLabelFromRatio(targetX, targetY),
      },
    };
  });

  return changed ? createCanvasDocument({ ...document, nodes }) : document;
}

function readNodeDataRatio(data: Record<string, unknown> | undefined, key: string) {
  const value = data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? roundMarkerRatio(value) : null;
}

function roundMarkerRatio(value: number) {
  return Number(Math.min(1, Math.max(0, value)).toFixed(4));
}

function roundCanvasCoord(value: number) {
  return Math.round(value * 100) / 100;
}

function inferMarkerLabelFromRatio(x: number, y: number) {
  if (y < 0.24) return "人脸";
  if (y < 0.48) return "上衣";
  if (x > 0.62 && y > 0.48) return "手提包";
  if (y > 0.52) return "裤子";
  return "物体";
}

function getCanvasCenterWorld(document: CanvasDocument) {
  const stage = window.document.querySelector("[data-canvas-stage='true']");
  const rect = stage?.getBoundingClientRect();
  const width = rect?.width || document.viewport.width || 1200;
  const height = rect?.height || document.viewport.height || 780;
  const zoom = Math.max(document.viewport.zoom, 0.01);
  return {
    x: (width / 2 - document.viewport.x) / zoom,
    y: (height / 2 - document.viewport.y) / zoom,
  };
}

function getSmartImageInsertionOrigin(
  document: CanvasDocument,
  selectedIds: CanvasNodeId[],
  sizes: Array<{ width: number; height: number }>,
  count: number,
) {
  const selectedSet = new Set(selectedIds);
  const selectedBounds = getDocumentBounds(document.nodes.filter((node) => selectedSet.has(node.id)));
  const columns = Math.min(2, Math.max(1, count));
  const maxWidth = Math.max(240, ...sizes.map((size) => size.width));
  const maxHeight = Math.max(240, ...sizes.map((size) => size.height));

  if (selectedBounds) {
    const availableRight = getDocumentBounds(document.nodes)?.x ?? selectedBounds.x;
    return {
      x: Math.max(availableRight, selectedBounds.x + selectedBounds.width + 56),
      y: selectedBounds.y,
    };
  }

  const center = getCanvasCenterWorld(document);
  return {
    x: Math.round(center.x - (columns * maxWidth + (columns - 1) * 28) / 2),
    y: Math.round(center.y - maxHeight / 2),
  };
}

function getInsertedImageSize(asset: Pick<CanvasAssetItem, "width" | "height">) {
  const ratio = asset.width && asset.height ? asset.width / asset.height : 4 / 5;
  const normalizedRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 4 / 5;
  let width = normalizedRatio >= 1 ? 320 : 250;
  let height = width / normalizedRatio;
  if (height > 380) {
    height = 380;
    width = height * normalizedRatio;
  }
  return {
    width: Math.round(Math.max(96, width)),
    height: Math.round(Math.max(96, height)),
  };
}

function getDocumentBounds(nodes: CanvasNode[]) {
  const visible = nodes.filter((node) => node.visible);
  if (!visible.length) return null;
  const left = Math.min(...visible.map((node) => node.x));
  const top = Math.min(...visible.map((node) => node.y));
  const right = Math.max(...visible.map((node) => node.x + node.width));
  const bottom = Math.max(...visible.map((node) => node.y + node.height));
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function buildImageFilter(values: ImageAdjustValues) {
  const brightness = clampFilterValue(100 + values.light * 0.35 + values.exposure * 0.25 + values.whites * 0.12 - values.blacks * 0.08, 30, 180);
  const contrast = clampFilterValue(100 + values.contrast * 0.45 + values.highlights * 0.08 - values.shadows * 0.08, 30, 190);
  const saturate = clampFilterValue(100 + values.highlights * 0.08 + values.shadows * 0.05, 40, 180);
  return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturate}%)`;
}

function isDefaultAdjustValues(values: ImageAdjustValues) {
  return Object.keys(DEFAULT_ADJUST_VALUES).every((key) => {
    const field = key as keyof ImageAdjustValues;
    return values[field] === DEFAULT_ADJUST_VALUES[field];
  });
}

function clampFilterValue(value: number, min: number, max: number) {
  return Math.round(Math.min(max, Math.max(min, value)));
}

function createAssistantResult(url: string, prompt: string, model: string, quality: string, index: number): CanvasAssistantResult {
  return {
    id: `result-${Date.now()}-${index}`,
    title: `AI 生成 ${index + 1}`,
    prompt,
    imageUrl: url,
    thumbnailUrl: getImageVariantUrl(url, "card"),
    status: "completed",
    model,
    quality,
    createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
  };
}

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readRadius(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeVisibleImageToolKeys(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_VISIBLE_IMAGE_TOOL_KEYS;
  const supported = new Set(LOVART_IMAGE_TOOLS.map((tool) => tool.key));
  const normalized = value.filter((item): item is LovartImageToolKey => typeof item === "string" && supported.has(item as LovartImageToolKey));
  return Array.from(new Set(normalized));
}

function normalizeLovartGenerationSettings(value: unknown): LovartGenerationSettings {
  if (!value || typeof value !== "object") return DEFAULT_LOVART_GENERATION_SETTINGS;
  const source = value as Partial<LovartGenerationSettings>;
  const qualityLevel = typeof source.qualityLevel === "string" ? source.qualityLevel : DEFAULT_LOVART_GENERATION_SETTINGS.qualityLevel;
  const width = Number.isFinite(source.width) ? Number(source.width) : DEFAULT_LOVART_GENERATION_SETTINGS.width;
  const height = Number.isFinite(source.height) ? Number(source.height) : DEFAULT_LOVART_GENERATION_SETTINGS.height;
  const sizePreset = typeof source.sizePreset === "string" ? source.sizePreset : DEFAULT_LOVART_GENERATION_SETTINGS.sizePreset;
  return {
    qualityLevel,
    width: Math.min(Math.max(Math.round(width), 256), 4096),
    height: Math.min(Math.max(Math.round(height), 256), 4096),
    sizePreset,
    imageCount: clampLovartImageCount(Number(source.imageCount ?? DEFAULT_LOVART_GENERATION_SETTINGS.imageCount)),
  };
}

function downloadTextFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
