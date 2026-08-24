export type CanvasViewport = {
  x: number;
  y: number;
  scale: number;
};

export type CanvasNodeType = "text" | "image" | "panorama" | "video" | "audio" | "config" | "brief" | "task" | "brand-kit";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export type CanvasNodeMetadata = {
  status?: "idle" | "success" | "loading" | "error" | "needs_review" | "cancelled";
  prompt?: string;
  errorDetails?: string;
  generationId?: string;
  creativeRunId?: string;
  operation?: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  fontSize?: number;
  freeResize?: boolean;
  naturalWidth?: number;
  naturalHeight?: number;
};

export type CanvasNode = {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  content: string;
  assetId?: string;
  metadata?: CanvasNodeMetadata;
};

export type CanvasEdge = {
  id: string;
  from: string;
  to: string;
};

export type CanvasDocument = {
  version: 1;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: CanvasViewport;
  background: CanvasBackgroundMode;
};

export type CanvasProject = {
  id: string;
  title: string;
  document: CanvasDocument;
  coverUrl: string | null;
  nodeCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export const EMPTY_CANVAS_DOCUMENT: CanvasDocument = {
  version: 1,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, scale: 1 },
  background: "lines",
};

const MAX_NODES = 5000;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

export class CanvasContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasContractError";
  }
}

export function normalizeCanvasTitle(value: unknown) {
  const title = typeof value === "string" ? value.trim() : "";
  if (!title || title.length > 120) throw new CanvasContractError("画布名称需为 1-120 个字符");
  return title;
}

export function normalizeCanvasDocument(value: unknown): CanvasDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CanvasContractError("画布文档格式无效");
  }
  const input = value as Record<string, unknown>;
  const rawNodes = Array.isArray(input.nodes) ? input.nodes : [];
  const rawEdges = Array.isArray(input.edges) ? input.edges : [];
  if (rawNodes.length > MAX_NODES) throw new CanvasContractError(`画布最多支持 ${MAX_NODES} 个节点`);

  const nodes = rawNodes.map(normalizeCanvasNode);
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) throw new CanvasContractError("画布节点 ID 重复");
  const edges = rawEdges.map(normalizeCanvasEdge).filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const viewport = normalizeViewport(input.viewport);
  const background: CanvasBackgroundMode = input.background === "dots" || input.background === "blank" ? input.background : "lines";
  const document: CanvasDocument = { version: 1, nodes, edges, viewport, background };
  if (new TextEncoder().encode(JSON.stringify(document)).byteLength > MAX_DOCUMENT_BYTES) {
    throw new CanvasContractError("画布内容超过 2MB，请拆分为多个项目");
  }
  return document;
}

function normalizeCanvasNode(value: unknown, index: number): CanvasNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CanvasContractError("画布节点格式无效");
  const item = value as Record<string, unknown>;
  const type = normalizeNodeType(item.type);
  const id = boundedIdentifier(item.id, `node-${index + 1}`);
  const mediaNode = ["image", "panorama", "video", "audio"].includes(type);
  const width = boundedNumber(item.width, mediaNode ? 320 : 280, 120, 1600);
  const height = boundedNumber(item.height, type === "audio" ? 150 : mediaNode ? 240 : 180, 80, 1200);
  const title = boundedText(item.title, defaultNodeTitle(type), 120);
  const content = boundedText(item.content, "", mediaNode ? 1600 : 12_000);
  const assetId = typeof item.assetId === "string" && item.assetId.trim() ? item.assetId.trim().slice(0, 160) : undefined;
  const metadata = normalizeNodeMetadata(item.metadata);
  if (mediaNode && content && !/^https:\/\//i.test(content)) throw new CanvasContractError("媒体节点必须引用 HTTPS 素材");
  return {
    id,
    type,
    x: boundedNumber(item.x, 0, -100_000, 100_000),
    y: boundedNumber(item.y, 0, -100_000, 100_000),
    width,
    height,
    title,
    content,
    ...(assetId ? { assetId } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function normalizeNodeType(value: unknown): CanvasNodeType {
  return value === "image" || value === "panorama" || value === "video" || value === "audio" || value === "config" || value === "brief" || value === "task" || value === "brand-kit"
    ? value
    : "text";
}

function defaultNodeTitle(type: CanvasNodeType) {
  if (type === "image") return "图片素材";
  if (type === "panorama") return "全景图";
  if (type === "video") return "视频素材";
  if (type === "audio") return "音频素材";
  if (type === "config") return "生成配置";
  if (type === "brief") return "创作简报";
  if (type === "task") return "Agent 任务";
  if (type === "brand-kit") return "品牌规范";
  return "灵感便笺";
}

function normalizeNodeMetadata(value: unknown): CanvasNodeMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const status = ["idle", "success", "loading", "error", "needs_review", "cancelled"].includes(String(item.status))
    ? item.status as CanvasNodeMetadata["status"]
    : undefined;
  const text = (key: string, max: number) => typeof item[key] === "string" && item[key] ? String(item[key]).slice(0, max) : undefined;
  const number = (key: string) => Number.isFinite(Number(item[key])) ? Number(item[key]) : undefined;
  const metadata: CanvasNodeMetadata = {
    status,
    prompt: text("prompt", 4_000),
    errorDetails: text("errorDetails", 2_000),
    generationId: text("generationId", 160),
    creativeRunId: text("creativeRunId", 160),
    operation: text("operation", 80),
    model: text("model", 120),
    aspectRatio: text("aspectRatio", 24),
    imageSize: text("imageSize", 24),
    fontSize: number("fontSize"),
    freeResize: item.freeResize === true,
    naturalWidth: number("naturalWidth"),
    naturalHeight: number("naturalHeight"),
  };
  return Object.values(metadata).some((entry) => entry !== undefined && entry !== false) ? metadata : undefined;
}

function normalizeCanvasEdge(value: unknown, index: number): CanvasEdge {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CanvasContractError("画布连线格式无效");
  const item = value as Record<string, unknown>;
  return {
    id: boundedIdentifier(item.id, `edge-${index + 1}`),
    from: boundedIdentifier(item.from, ""),
    to: boundedIdentifier(item.to, ""),
  };
}

function normalizeViewport(value: unknown): CanvasViewport {
  const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    x: boundedNumber(item.x, 0, -100_000, 100_000),
    y: boundedNumber(item.y, 0, -100_000, 100_000),
    scale: boundedNumber(item.scale, 1, 0.1, 4),
  };
}

function boundedIdentifier(value: unknown, fallback: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  const selected = normalized || fallback;
  if (!selected || selected.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(selected)) {
    throw new CanvasContractError("画布对象 ID 无效");
  }
  return selected;
}

function boundedText(value: unknown, fallback: string, maxLength: number) {
  return (typeof value === "string" ? value : fallback).trim().slice(0, maxLength);
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
