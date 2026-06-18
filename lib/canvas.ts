export const CANVAS_DOCUMENT_VERSION = 1;

export type CanvasNodeType = "rect" | "ellipse" | "image" | "text";

export type Point = {
  x: number;
  y: number;
};

export type Size = {
  width: number;
  height: number;
};

export type Rect = Point & Size;

export type Viewport = Rect & {
  zoom: number;
};

export type CanvasAsset = {
  id: string;
  type: "image";
  src: string;
  name?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  alt?: string;
};

export type CanvasNode = Rect & {
  id: string;
  type: CanvasNodeType;
  zIndex: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  visible: boolean;
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
  name?: string;
  assetId?: string;
  src?: string;
  alt?: string;
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  filter?: string;
  flipX?: boolean;
  flipY?: boolean;
  cropRatio?: string;
  shapeKind?: string;
  data?: Record<string, unknown>;
};

export type CanvasDocument = {
  version: typeof CANVAS_DOCUMENT_VERSION;
  id: string;
  name: string;
  viewport: Viewport;
  gridSize: number;
  background: string;
  nodes: CanvasNode[];
  assets: CanvasAsset[];
};

export type CreateCanvasDocumentInput = {
  id?: string;
  name?: string;
  viewport?: Partial<Viewport>;
  gridSize?: number;
  background?: string;
  nodes?: readonly CanvasNode[];
  assets?: readonly CanvasAsset[];
};

export type CreateCanvasNodeInput = {
  id: string;
  type?: CanvasNodeType;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  zIndex?: number;
  rotation?: number;
  opacity?: number;
  locked?: boolean;
  visible?: boolean;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  assetId?: string;
  src?: string;
  alt?: string;
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  filter?: string;
  flipX?: boolean;
  flipY?: boolean;
  cropRatio?: string;
  shapeKind?: string;
  data?: Record<string, unknown>;
};

export type DuplicateNodesOptions = {
  offset?: Partial<Point>;
  idFactory?: (node: CanvasNode, copyIndex: number) => string;
};

export type MoveDelta = Partial<Point> & {
  dx?: number;
  dy?: number;
};

export type ResizeAnchor = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";

export type ResizeNodeOptions = {
  anchor?: ResizeAnchor;
  minWidth?: number;
  minHeight?: number;
};

export type FitViewportOptions = {
  padding?: number;
  minZoom?: number;
  maxZoom?: number;
  fallback?: Viewport;
};

export type ExportSvgOptions = {
  nodeIds?: readonly string[];
  padding?: number;
  includeHidden?: boolean;
  background?: string;
  width?: number;
  height?: number;
};

const DEFAULT_VIEWPORT: Viewport = {
  x: 0,
  y: 0,
  width: 1440,
  height: 900,
  zoom: 1,
};

const DEFAULT_GRID_SIZE = 8;
const DEFAULT_NODE_WIDTH = 240;
const DEFAULT_NODE_HEIGHT = 160;
const DEFAULT_NODE_FILL = "#ffffff";
const DEFAULT_TEXT_FILL = "#111827";
const DEFAULT_FONT_FAMILY = "Inter, sans-serif";
const DEFAULT_FONT_SIZE = 16;
const DEFAULT_DUPLICATE_OFFSET: Point = { x: 24, y: 24 };
const MIN_NODE_SIZE = 1;
const MIN_VIEWPORT_SIZE = 1;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 64;

export function createCanvasDocument(input: CreateCanvasDocumentInput = {}): CanvasDocument {
  return {
    version: CANVAS_DOCUMENT_VERSION,
    id: stringOr(input.id, "canvas-document"),
    name: stringOr(input.name, "Untitled canvas"),
    viewport: normalizeViewport(input.viewport),
    gridSize: positiveNumberOr(input.gridSize, DEFAULT_GRID_SIZE),
    background: stringOr(input.background, "transparent"),
    assets: normalizeAssets(input.assets ?? []),
    nodes: normalizeZOrder(input.nodes ?? []),
  };
}

export function createNode(input: CreateCanvasNodeInput): CanvasNode {
  const type = isCanvasNodeType(input.type) ? input.type : "rect";
  const fill = stringOr(input.fill, type === "text" ? DEFAULT_TEXT_FILL : DEFAULT_NODE_FILL);
  const node: CanvasNode = {
    id: stringOr(input.id, "node"),
    type,
    x: numberOr(input.x, 0),
    y: numberOr(input.y, 0),
    width: positiveNumberOr(input.width, DEFAULT_NODE_WIDTH, MIN_NODE_SIZE),
    height: positiveNumberOr(input.height, DEFAULT_NODE_HEIGHT, MIN_NODE_SIZE),
    zIndex: integerOr(input.zIndex, 0),
    rotation: numberOr(input.rotation, 0),
    opacity: clamp(numberOr(input.opacity, 1), 0, 1),
    locked: input.locked === true,
    visible: input.visible !== false,
    fill,
    stroke: stringOr(input.stroke, "transparent"),
    strokeWidth: Math.max(0, numberOr(input.strokeWidth, 0)),
    radius: Math.max(0, numberOr(input.radius, 0)),
  };

  assignOptionalString(node, "name", input.name);
  assignOptionalString(node, "filter", input.filter);
  assignOptionalString(node, "cropRatio", input.cropRatio);
  assignOptionalString(node, "shapeKind", input.shapeKind);
  if (input.data && typeof input.data === "object" && !Array.isArray(input.data)) {
    node.data = { ...input.data };
  }
  if (input.flipX === true) node.flipX = true;
  if (input.flipY === true) node.flipY = true;

  if (type === "image") {
    assignOptionalString(node, "assetId", input.assetId);
    assignOptionalString(node, "src", input.src);
    assignOptionalString(node, "alt", input.alt);
  }

  if (type === "text") {
    node.text = typeof input.text === "string" ? input.text : "";
    node.fontFamily = stringOr(input.fontFamily, DEFAULT_FONT_FAMILY);
    node.fontSize = positiveNumberOr(input.fontSize, DEFAULT_FONT_SIZE, MIN_NODE_SIZE);
  } else if (typeof input.text === "string") {
    node.text = input.text;
  }

  return node;
}

export function duplicateNodes(
  document: CanvasDocument,
  nodeIds: readonly string[],
  options: DuplicateNodesOptions = {}
): CanvasDocument {
  const selectedIds = new Set(nodeIds);
  if (selectedIds.size === 0) return document;

  const offset = normalizePoint(options.offset, DEFAULT_DUPLICATE_OFFSET);
  const orderedNodes = getOrderedNodes(document.nodes);
  const usedIds = new Set(document.nodes.map((node) => node.id));
  const copies: CanvasNode[] = [];

  for (const source of orderedNodes) {
    if (!selectedIds.has(source.id)) continue;

    const requestedId = options.idFactory?.(source, copies.length);
    const id = requestedId && !usedIds.has(requestedId) ? requestedId : getNextCopyId(source.id, usedIds);
    usedIds.add(id);
    copies.push({
      ...source,
      id,
      name: source.name ? `${source.name} copy` : undefined,
      x: source.x + offset.x,
      y: source.y + offset.y,
      zIndex: document.nodes.length + copies.length,
    });
  }

  if (copies.length === 0) return document;
  return withNodes(document, [...document.nodes, ...copies]);
}

export function deleteNodes(document: CanvasDocument, nodeIds: readonly string[]): CanvasDocument {
  const selectedIds = new Set(nodeIds);
  if (selectedIds.size === 0) return document;

  const nodes = document.nodes.filter((node) => !selectedIds.has(node.id));
  if (nodes.length === document.nodes.length) return document;
  return withNodes(document, nodes);
}

export function moveNodes(document: CanvasDocument, nodeIds: readonly string[], delta: MoveDelta): CanvasDocument {
  const selectedIds = new Set(nodeIds);
  if (selectedIds.size === 0) return document;

  const dx = numberOr(delta.dx, numberOr(delta.x, 0));
  const dy = numberOr(delta.dy, numberOr(delta.y, 0));
  if (dx === 0 && dy === 0) return document;

  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (!selectedIds.has(node.id) || node.locked) return node;
    changed = true;
    return {
      ...node,
      x: node.x + dx,
      y: node.y + dy,
    };
  });

  return changed ? withNodes(document, nodes) : document;
}

export function resizeNode(
  document: CanvasDocument,
  nodeId: string,
  size: Partial<Size>,
  options: ResizeNodeOptions = {}
): CanvasDocument {
  const anchor = options.anchor ?? "top-left";
  const minWidth = positiveNumberOr(options.minWidth, MIN_NODE_SIZE, MIN_NODE_SIZE);
  const minHeight = positiveNumberOr(options.minHeight, MIN_NODE_SIZE, MIN_NODE_SIZE);
  let changed = false;

  const nodes = document.nodes.map((node) => {
    if (node.id !== nodeId || node.locked) return node;

    const width = Math.max(minWidth, positiveNumberOr(size.width, node.width, MIN_NODE_SIZE));
    const height = Math.max(minHeight, positiveNumberOr(size.height, node.height, MIN_NODE_SIZE));
    if (width === node.width && height === node.height) return node;

    changed = true;
    const offset = getResizeOffset(node, { width, height }, anchor);
    return {
      ...node,
      x: node.x + offset.x,
      y: node.y + offset.y,
      width,
      height,
    };
  });

  return changed ? withNodes(document, nodes) : document;
}

export function bringForward(document: CanvasDocument, nodeIds: readonly string[]): CanvasDocument {
  const selectedIds = new Set(nodeIds);
  if (selectedIds.size === 0) return document;

  const orderedNodes = getOrderedNodes(document.nodes);
  let changed = false;

  for (let index = orderedNodes.length - 2; index >= 0; index -= 1) {
    const node = orderedNodes[index];
    const nextNode = orderedNodes[index + 1];
    if (!node || !nextNode) continue;
    if (selectedIds.has(node.id) && !node.locked && !selectedIds.has(nextNode.id)) {
      orderedNodes[index] = nextNode;
      orderedNodes[index + 1] = node;
      changed = true;
    }
  }

  return changed ? withNodes(document, orderedNodes) : document;
}

export function sendBackward(document: CanvasDocument, nodeIds: readonly string[]): CanvasDocument {
  const selectedIds = new Set(nodeIds);
  if (selectedIds.size === 0) return document;

  const orderedNodes = getOrderedNodes(document.nodes);
  let changed = false;

  for (let index = 1; index < orderedNodes.length; index += 1) {
    const previousNode = orderedNodes[index - 1];
    const node = orderedNodes[index];
    if (!previousNode || !node) continue;
    if (selectedIds.has(node.id) && !node.locked && !selectedIds.has(previousNode.id)) {
      orderedNodes[index - 1] = node;
      orderedNodes[index] = previousNode;
      changed = true;
    }
  }

  return changed ? withNodes(document, orderedNodes) : document;
}

export function serialize(document: CanvasDocument): string {
  return JSON.stringify(createCanvasDocument(document));
}

export function deserialize(serialized: string | unknown, fallback: CanvasDocument = createCanvasDocument()): CanvasDocument {
  const parsed = typeof serialized === "string" ? parseJson(serialized) : serialized;
  if (!isRecord(parsed)) return fallback;

  return createCanvasDocument({
    id: optionalString(parsed.id),
    name: optionalString(parsed.name),
    viewport: isRecord(parsed.viewport) ? deserializeViewport(parsed.viewport) : undefined,
    gridSize: optionalNumber(parsed.gridSize),
    background: optionalString(parsed.background),
    assets: deserializeAssets(parsed.assets),
    nodes: deserializeNodes(parsed.nodes),
  });
}

export function exportToSvg(document: CanvasDocument, options: ExportSvgOptions = {}): string {
  const nodes = getExportNodes(document, options);
  const padding = Math.max(0, numberOr(options.padding, 0));
  const bounds = getNodesBounds(nodes) ?? { x: 0, y: 0, width: 1, height: 1 };
  const viewBox = {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: Math.max(1, bounds.width + padding * 2),
    height: Math.max(1, bounds.height + padding * 2),
  };
  const width = positiveNumberOr(options.width, viewBox.width, MIN_VIEWPORT_SIZE);
  const height = positiveNumberOr(options.height, viewBox.height, MIN_VIEWPORT_SIZE);
  const background = options.background ?? document.background;
  const assetById = new Map(document.assets.map((asset) => [asset.id, asset]));
  const children: string[] = [];

  if (background && background !== "transparent") {
    children.push(
      `<rect x="${formatNumber(viewBox.x)}" y="${formatNumber(viewBox.y)}" width="${formatNumber(
        viewBox.width
      )}" height="${formatNumber(viewBox.height)}" fill="${escapeXml(background)}" />`
    );
  }

  for (const node of nodes) {
    const rendered = renderSvgNode(node, assetById);
    if (rendered) children.push(rendered);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(width)}" height="${formatNumber(
    height
  )}" viewBox="${formatNumber(viewBox.x)} ${formatNumber(viewBox.y)} ${formatNumber(
    viewBox.width
  )} ${formatNumber(viewBox.height)}" role="img">${children.join("")}</svg>`;
}

export function fitViewportToNodes(
  nodes: readonly CanvasNode[],
  viewportSize: Partial<Size> = {},
  options: FitViewportOptions = {}
): Viewport {
  const width = positiveNumberOr(viewportSize.width, options.fallback?.width ?? DEFAULT_VIEWPORT.width, MIN_VIEWPORT_SIZE);
  const height = positiveNumberOr(
    viewportSize.height,
    options.fallback?.height ?? DEFAULT_VIEWPORT.height,
    MIN_VIEWPORT_SIZE
  );
  const bounds = getNodesBounds(nodes);
  if (!bounds) {
    return {
      ...(options.fallback ?? DEFAULT_VIEWPORT),
      width,
      height,
    };
  }

  const padding = Math.max(0, numberOr(options.padding, 0));
  const paddedWidth = Math.max(1, bounds.width + padding * 2);
  const paddedHeight = Math.max(1, bounds.height + padding * 2);
  const minZoom = positiveNumberOr(options.minZoom, MIN_ZOOM, MIN_ZOOM);
  const maxZoom = Math.max(minZoom, positiveNumberOr(options.maxZoom, MAX_ZOOM, minZoom));
  const zoom = clamp(Math.min(width / paddedWidth, height / paddedHeight), minZoom, maxZoom);
  const worldWidth = width / zoom;
  const worldHeight = height / zoom;

  return {
    x: bounds.x + bounds.width / 2 - worldWidth / 2,
    y: bounds.y + bounds.height / 2 - worldHeight / 2,
    width,
    height,
    zoom,
  };
}

export function snapToGrid(value: number, gridSize?: number): number;
export function snapToGrid(value: Point, gridSize?: number): Point;
export function snapToGrid(value: number | Point, gridSize = DEFAULT_GRID_SIZE): number | Point {
  const grid = positiveNumberOr(gridSize, 0);
  if (grid <= 0) return value;

  if (typeof value === "number") {
    return snapNumber(value, grid);
  }

  return {
    x: snapNumber(value.x, grid),
    y: snapNumber(value.y, grid),
  };
}

function normalizeViewport(input?: Partial<Viewport>): Viewport {
  return {
    x: numberOr(input?.x, DEFAULT_VIEWPORT.x),
    y: numberOr(input?.y, DEFAULT_VIEWPORT.y),
    width: positiveNumberOr(input?.width, DEFAULT_VIEWPORT.width, MIN_VIEWPORT_SIZE),
    height: positiveNumberOr(input?.height, DEFAULT_VIEWPORT.height, MIN_VIEWPORT_SIZE),
    zoom: clamp(positiveNumberOr(input?.zoom, DEFAULT_VIEWPORT.zoom, MIN_ZOOM), MIN_ZOOM, MAX_ZOOM),
  };
}

function normalizePoint(input: Partial<Point> | undefined, fallback: Point): Point {
  return {
    x: numberOr(input?.x, fallback.x),
    y: numberOr(input?.y, fallback.y),
  };
}

function normalizeAssets(assets: readonly CanvasAsset[]): CanvasAsset[] {
  const usedIds = new Set<string>();
  const normalized: CanvasAsset[] = [];

  for (const asset of assets) {
    const id = stringOr(asset.id, "");
    const src = stringOr(asset.src, "");
    if (!id || !src || usedIds.has(id)) continue;
    usedIds.add(id);

    const next: CanvasAsset = {
      id,
      type: "image",
      src,
    };
    assignOptionalString(next, "name", asset.name);
    assignOptionalString(next, "mimeType", asset.mimeType);
    assignOptionalString(next, "alt", asset.alt);
    assignOptionalPositiveNumber(next, "width", asset.width);
    assignOptionalPositiveNumber(next, "height", asset.height);
    normalized.push(next);
  }

  return normalized;
}

function normalizeZOrder(nodes: readonly CanvasNode[]): CanvasNode[] {
  const usedIds = new Set<string>();

  return nodes
    .map((node, index) => ({ node: createNode(node), index }))
    .filter(({ node }) => {
      if (usedIds.has(node.id)) return false;
      usedIds.add(node.id);
      return true;
    })
    .sort((a, b) => a.node.zIndex - b.node.zIndex || a.index - b.index)
    .map(({ node }, zIndex) => ({
      ...node,
      zIndex,
    }));
}

function getOrderedNodes(nodes: readonly CanvasNode[]): CanvasNode[] {
  return [...nodes].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
}

function withNodes(document: CanvasDocument, nodes: readonly CanvasNode[]): CanvasDocument {
  return {
    ...document,
    nodes: normalizeInCurrentOrder(nodes),
  };
}

function normalizeInCurrentOrder(nodes: readonly CanvasNode[]): CanvasNode[] {
  const usedIds = new Set<string>();
  const normalized: CanvasNode[] = [];

  for (const node of nodes) {
    const next = createNode(node);
    if (usedIds.has(next.id)) continue;
    usedIds.add(next.id);
    normalized.push({
      ...next,
      zIndex: normalized.length,
    });
  }

  return normalized;
}

function getResizeOffset(node: CanvasNode, size: Size, anchor: ResizeAnchor): Point {
  const dx = node.width - size.width;
  const dy = node.height - size.height;

  switch (anchor) {
    case "top-right":
      return { x: dx, y: 0 };
    case "bottom-left":
      return { x: 0, y: dy };
    case "bottom-right":
      return { x: dx, y: dy };
    case "center":
      return { x: dx / 2, y: dy / 2 };
    case "top-left":
    default:
      return { x: 0, y: 0 };
  }
}

function getNextCopyId(baseId: string, usedIds: Set<string>): string {
  let index = 1;
  let candidate = `${baseId}-copy`;
  while (usedIds.has(candidate)) {
    index += 1;
    candidate = `${baseId}-copy-${index}`;
  }
  return candidate;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function deserializeViewport(value: Record<string, unknown>): Partial<Viewport> {
  return {
    x: optionalNumber(value.x),
    y: optionalNumber(value.y),
    width: optionalNumber(value.width),
    height: optionalNumber(value.height),
    zoom: optionalNumber(value.zoom),
  };
}

function deserializeAssets(value: unknown): CanvasAsset[] {
  if (!Array.isArray(value)) return [];

  const assets: CanvasAsset[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = optionalString(item.id);
    const src = optionalString(item.src);
    if (!id || !src || item.type !== "image") continue;

    const asset: CanvasAsset = {
      id,
      type: "image",
      src,
    };
    assignOptionalString(asset, "name", optionalString(item.name));
    assignOptionalString(asset, "mimeType", optionalString(item.mimeType));
    assignOptionalString(asset, "alt", optionalString(item.alt));
    assignOptionalPositiveNumber(asset, "width", optionalNumber(item.width));
    assignOptionalPositiveNumber(asset, "height", optionalNumber(item.height));
    assets.push(asset);
  }

  return assets;
}

function deserializeNodes(value: unknown): CanvasNode[] {
  if (!Array.isArray(value)) return [];

  const nodes: CanvasNode[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = optionalString(item.id);
    if (!id || !isCanvasNodeType(item.type)) continue;

    nodes.push(
      createNode({
        id,
        type: item.type,
        name: optionalString(item.name),
        x: optionalNumber(item.x),
        y: optionalNumber(item.y),
        width: optionalNumber(item.width),
        height: optionalNumber(item.height),
        zIndex: optionalNumber(item.zIndex),
        rotation: optionalNumber(item.rotation),
        opacity: optionalNumber(item.opacity),
        locked: item.locked === true,
        visible: item.visible !== false,
        fill: optionalString(item.fill),
        stroke: optionalString(item.stroke),
        strokeWidth: optionalNumber(item.strokeWidth),
        radius: optionalNumber(item.radius),
        assetId: optionalString(item.assetId),
        src: optionalString(item.src),
        alt: optionalString(item.alt),
        text: typeof item.text === "string" ? item.text : undefined,
        fontFamily: optionalString(item.fontFamily),
        fontSize: optionalNumber(item.fontSize),
        filter: optionalString(item.filter),
        flipX: item.flipX === true,
        flipY: item.flipY === true,
        cropRatio: optionalString(item.cropRatio),
        shapeKind: optionalString(item.shapeKind),
        data: isRecord(item.data) ? { ...item.data } : undefined,
      })
    );
  }

  return nodes;
}

function getExportNodes(document: CanvasDocument, options: ExportSvgOptions): CanvasNode[] {
  const selectedIds = options.nodeIds ? new Set(options.nodeIds) : null;
  const assetById = new Map(document.assets.map((asset) => [asset.id, asset]));

  return getOrderedNodes(document.nodes).filter((node) => {
    if (selectedIds && !selectedIds.has(node.id)) return false;
    if (!options.includeHidden && !node.visible) return false;
    if (node.type === "image" && !getImageSource(node, assetById)) return false;
    return true;
  });
}

function renderSvgNode(node: CanvasNode, assetById: Map<string, CanvasAsset>): string | null {
  const common = `${svgAttr("id", node.id)}${svgAttr("opacity", formatNumber(node.opacity))}${svgTransformAttr(node)}`;

  if (node.type === "image") {
    const src = getImageSource(node, assetById);
    if (!src) return null;
    const content = getImageExportContentBox(node);
    const clipId = `clip-${safeSvgId(node.id)}`;
    const imageTransform = svgImageFlipTransform(node, content);
    const style = node.filter ? svgAttr("style", `filter: ${node.filter}`) : "";

    return `<g${common}><clipPath id="${clipId}"><rect x="${formatNumber(node.x)}" y="${formatNumber(
      node.y
    )}" width="${formatNumber(node.width)}" height="${formatNumber(node.height)}" /></clipPath><image${svgAttr(
      "href",
      src
    )} x="${formatNumber(content.x)}" y="${formatNumber(content.y)}" width="${formatNumber(
      content.width
    )}" height="${formatNumber(content.height)}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${clipId})"${imageTransform}${style} /></g>`;
  }

  if (node.type === "ellipse") {
    return `<ellipse${common} cx="${formatNumber(node.x + node.width / 2)}" cy="${formatNumber(
      node.y + node.height / 2
    )}" rx="${formatNumber(node.width / 2)}" ry="${formatNumber(node.height / 2)}" fill="${escapeXml(
      node.fill
    )}" stroke="${escapeXml(node.stroke)}" stroke-width="${formatNumber(node.strokeWidth)}" />`;
  }

  if (node.type === "text") {
    return `<text${common} x="${formatNumber(node.x)}" y="${formatNumber(node.y)}" width="${formatNumber(
      node.width
    )}" height="${formatNumber(node.height)}" fill="${escapeXml(node.fill)}" font-family="${escapeXml(
      node.fontFamily ?? DEFAULT_FONT_FAMILY
    )}" font-size="${formatNumber(node.fontSize ?? DEFAULT_FONT_SIZE)}" dominant-baseline="text-before-edge" xml:space="preserve">${escapeXml(
      node.text ?? ""
    )}</text>`;
  }

  const shapeKind = getExportShapeKind(node);
  if (shapeKind === "path") {
    return renderSvgPathNode(node, common);
  }

  if (shapeKind === "line" || shapeKind === "arrow") {
    return renderSvgLineNode(node, common, shapeKind === "arrow");
  }

  if (shapeKind === "marker") {
    return renderSvgMarkerNode(node, common);
  }

  if (shapeKind === "diamond" || shapeKind === "polygon" || shapeKind === "star") {
    return `<polygon${common} points="${renderPolygonPoints(node, shapeKind)}" fill="${escapeXml(node.fill)}" stroke="${escapeXml(
      node.stroke
    )}" stroke-width="${formatNumber(node.strokeWidth)}" />`;
  }

  return `<rect${common} x="${formatNumber(node.x)}" y="${formatNumber(node.y)}" width="${formatNumber(
    node.width
  )}" height="${formatNumber(node.height)}" rx="${formatNumber(node.radius)}" fill="${escapeXml(
    node.fill
  )}" stroke="${escapeXml(node.stroke)}" stroke-width="${formatNumber(node.strokeWidth)}" />`;
}

function getImageSource(node: CanvasNode, assetById: Map<string, CanvasAsset>): string {
  return node.src ?? (node.assetId ? assetById.get(node.assetId)?.src : undefined) ?? "";
}

function getImageExportContentBox(node: CanvasNode): Rect {
  const data = isRecord(node.data) ? node.data : {};
  return {
    x: node.x + numberOr(data.contentX, 0),
    y: node.y + numberOr(data.contentY, 0),
    width: positiveNumberOr(data.contentWidth, node.width, MIN_NODE_SIZE),
    height: positiveNumberOr(data.contentHeight, node.height, MIN_NODE_SIZE),
  };
}

function svgImageFlipTransform(node: CanvasNode, content: Rect): string {
  if (!node.flipX && !node.flipY) return "";

  const centerX = content.x + content.width / 2;
  const centerY = content.y + content.height / 2;
  return svgAttr(
    "transform",
    `translate(${formatNumber(centerX)} ${formatNumber(centerY)}) scale(${node.flipX ? -1 : 1} ${
      node.flipY ? -1 : 1
    }) translate(${formatNumber(-centerX)} ${formatNumber(-centerY)})`
  );
}

function getExportShapeKind(node: CanvasNode): string {
  if (node.type === "ellipse") return "ellipse";
  return node.shapeKind || "rectangle";
}

function renderSvgPathNode(node: CanvasNode, common: string): string {
  const points = readRelativePoints(node).map((point) => `${formatNumber(node.x + point.x)},${formatNumber(node.y + point.y)}`);
  return `<polyline${common} points="${points.join(" ")}" fill="none" stroke="${escapeXml(node.stroke)}" stroke-width="${formatNumber(
    node.strokeWidth
  )}" stroke-linecap="round" stroke-linejoin="round" />`;
}

function renderSvgLineNode(node: CanvasNode, common: string, isArrow: boolean): string {
  const line = readLineData(node);
  const x1 = node.x + line.x1;
  const y1 = node.y + line.y1;
  const x2 = node.x + line.x2;
  const y2 = node.y + line.y2;
  const markerId = `arrow-${safeSvgId(node.id)}`;
  const marker = isArrow
    ? `<defs><marker id="${markerId}" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 9 4.5 L 0 9 z" fill="${escapeXml(
        node.stroke
      )}" /></marker></defs>`
    : "";
  const markerAttr = isArrow ? svgAttr("marker-end", `url(#${markerId})`) : "";
  return `<g${common}>${marker}<line x1="${formatNumber(x1)}" y1="${formatNumber(y1)}" x2="${formatNumber(x2)}" y2="${formatNumber(
    y2
  )}" stroke="${escapeXml(node.stroke)}" stroke-width="${formatNumber(node.strokeWidth)}" stroke-linecap="round"${markerAttr} /></g>`;
}

function renderSvgMarkerNode(node: CanvasNode, common: string): string {
  const centerX = node.x + node.width / 2;
  const centerY = node.y + node.height / 2;
  const radius = Math.max(4, Math.min(node.width, node.height) / 2);
  const textColor = optionalString(node.data?.textColor) ?? "#ffffff";
  return `<g${common}><circle cx="${formatNumber(centerX)}" cy="${formatNumber(centerY)}" r="${formatNumber(radius)}" fill="${escapeXml(
    node.fill
  )}" stroke="${escapeXml(node.stroke)}" stroke-width="${formatNumber(node.strokeWidth)}" /><text x="${formatNumber(centerX)}" y="${formatNumber(
    centerY
  )}" fill="${escapeXml(textColor)}" font-family="${escapeXml(
    DEFAULT_FONT_FAMILY
  )}" font-size="${formatNumber(Math.max(10, radius))}" font-weight="700" text-anchor="middle" dominant-baseline="central">${escapeXml(
    node.text || "1"
  )}</text></g>`;
}

function renderPolygonPoints(node: CanvasNode, shapeKind: string): string {
  if (shapeKind === "diamond") {
    return [
      { x: node.x + node.width / 2, y: node.y },
      { x: node.x + node.width, y: node.y + node.height / 2 },
      { x: node.x + node.width / 2, y: node.y + node.height },
      { x: node.x, y: node.y + node.height / 2 },
    ].map(formatPoint).join(" ");
  }

  if (shapeKind === "star") {
    const centerX = node.x + node.width / 2;
    const centerY = node.y + node.height / 2;
    const outerRadius = Math.min(node.width, node.height) / 2;
    const innerRadius = outerRadius * 0.46;
    return Array.from({ length: 10 }, (_, index) => {
      const angle = -Math.PI / 2 + index * (Math.PI / 5);
      const radius = index % 2 === 0 ? outerRadius : innerRadius;
      return formatPoint({
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      });
    }).join(" ");
  }

  return [
    { x: node.x + node.width / 2, y: node.y },
    { x: node.x + node.width, y: node.y + node.height },
    { x: node.x, y: node.y + node.height },
  ].map(formatPoint).join(" ");
}

function formatPoint(point: Point): string {
  return `${formatNumber(point.x)},${formatNumber(point.y)}`;
}

function readLineData(node: CanvasNode) {
  const line = isRecord(node.data?.line) ? node.data.line : {};
  return {
    x1: numberOr(line.x1, 0),
    y1: numberOr(line.y1, 0),
    x2: numberOr(line.x2, node.width),
    y2: numberOr(line.y2, node.height),
  };
}

function readRelativePoints(node: CanvasNode): Point[] {
  const raw = node.data?.points;
  if (!Array.isArray(raw) || raw.length === 0) {
    return [{ x: 0, y: node.height / 2 }, { x: node.width, y: node.height / 2 }];
  }

  const points = raw.flatMap((point) => {
    if (!isRecord(point)) return [];
    return [{ x: numberOr(point.x, 0), y: numberOr(point.y, 0) }];
  });
  return points.length >= 2 ? points : [{ x: 0, y: node.height / 2 }, { x: node.width, y: node.height / 2 }];
}

function getNodesBounds(nodes: readonly CanvasNode[]): Rect | null {
  if (nodes.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const bounds = getNodeBounds(node);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function getNodeBounds(node: CanvasNode): Rect {
  if (node.rotation === 0) {
    return {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    };
  }

  const centerX = node.x + node.width / 2;
  const centerY = node.y + node.height / 2;
  const radians = (node.rotation * Math.PI) / 180;
  const corners = [
    rotatePoint({ x: node.x, y: node.y }, { x: centerX, y: centerY }, radians),
    rotatePoint({ x: node.x + node.width, y: node.y }, { x: centerX, y: centerY }, radians),
    rotatePoint({ x: node.x + node.width, y: node.y + node.height }, { x: centerX, y: centerY }, radians),
    rotatePoint({ x: node.x, y: node.y + node.height }, { x: centerX, y: centerY }, radians),
  ];

  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function rotatePoint(point: Point, center: Point, radians: number): Point {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function svgTransformAttr(node: CanvasNode): string {
  if (node.rotation === 0) return "";
  return svgAttr(
    "transform",
    `rotate(${formatNumber(node.rotation)} ${formatNumber(node.x + node.width / 2)} ${formatNumber(
      node.y + node.height / 2
    )})`
  );
}

function svgAttr(name: string, value: string): string {
  return ` ${name}="${escapeXml(value)}"`;
}

function safeSvgId(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "node";
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatNumber(value: number): string {
  const normalized = Math.abs(value) < 0.000001 ? 0 : value;
  if (Number.isInteger(normalized)) return String(normalized);
  return String(Number(normalized.toFixed(4)));
}

function snapNumber(value: number, gridSize: number): number {
  const snapped = Math.round(numberOr(value, 0) / gridSize) * gridSize;
  return Object.is(snapped, -0) ? 0 : snapped;
}

function isCanvasNodeType(value: unknown): value is CanvasNodeType {
  return value === "rect" || value === "ellipse" || value === "image" || value === "text";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringOr(value: unknown, fallback: string): string {
  return optionalString(value) ?? fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return optionalNumber(value) ?? fallback;
}

function integerOr(value: unknown, fallback: number): number {
  const number = numberOr(value, fallback);
  return Number.isInteger(number) ? number : Math.round(number);
}

function positiveNumberOr(value: unknown, fallback: number, minimum = Number.MIN_VALUE): number {
  const number = numberOr(value, fallback);
  return number > 0 ? Math.max(minimum, number) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function assignOptionalString<T extends object, K extends keyof T>(target: T, key: K, value: unknown): void {
  const text = optionalString(value);
  if (text) {
    target[key] = text as T[K];
  }
}

function assignOptionalPositiveNumber<T extends object, K extends keyof T>(target: T, key: K, value: unknown): void {
  const number = optionalNumber(value);
  if (number && number > 0) {
    target[key] = number as T[K];
  }
}
