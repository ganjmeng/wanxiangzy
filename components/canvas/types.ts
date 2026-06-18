import type { CSSProperties, ReactNode } from "react";

export type CanvasNodeId = string;

export type CanvasPoint = {
  x: number;
  y: number;
};

export type CanvasSize = {
  width: number;
  height: number;
};

export type CanvasRect = CanvasPoint & CanvasSize;

export type CanvasViewport = CanvasPoint & {
  zoom: number;
};

export type CanvasActionSource = "pointer" | "keyboard" | "toolbar" | "wheel" | "api";

export type CanvasNodeChangeAction =
  | "create"
  | "move"
  | "resize"
  | "nudge"
  | "delete"
  | "duplicate"
  | "paste"
  | "custom";

export type CanvasSelectionAction =
  | "replace"
  | "add"
  | "toggle"
  | "clear"
  | "marquee"
  | "all";

export type CanvasViewportAction =
  | "pan"
  | "zoom"
  | "reset"
  | "fit";

export type CanvasChangeMeta = {
  action: CanvasNodeChangeAction;
  source: CanvasActionSource;
  affectedIds?: CanvasNodeId[];
  transient?: boolean;
};

export type CanvasSelectionMeta = {
  action: CanvasSelectionAction;
  source: CanvasActionSource;
};

export type CanvasViewportMeta = {
  action: CanvasViewportAction;
  source: CanvasActionSource;
};

export type CanvasCommandType =
  | "create"
  | "copy"
  | "paste"
  | "delete"
  | "duplicate"
  | "undo"
  | "redo"
  | "select-all"
  | "clear-selection"
  | "move"
  | "resize"
  | "nudge"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "fit";

export type CanvasCommand = {
  type: CanvasCommandType;
  source: CanvasActionSource;
  ids?: CanvasNodeId[];
  nodes?: CanvasNode[];
  viewport?: CanvasViewport;
  meta?: Record<string, unknown>;
};

export type CanvasNodeBase = CanvasRect & {
  id: CanvasNodeId;
  type: "text" | "shape" | "image";
  name?: string;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
  locked?: boolean;
  hidden?: boolean;
  className?: string;
  style?: CSSProperties;
  data?: Record<string, unknown>;
};

export type CanvasBoardTool =
  | "select"
  | "mark"
  | "focus"
  | "grid"
  | "draw"
  | "image"
  | "import"
  | "reference"
  | "prompt"
  | "text"
  | "frame"
  | "shape:rectangle"
  | "shape:line"
  | "shape:arrow"
  | "shape:ellipse"
  | "shape:polygon"
  | "shape:star";

export type CanvasDrawStyle = {
  stroke?: string;
  strokeWidth?: number;
};

export type CanvasTextNode = CanvasNodeBase & {
  type: "text";
  text: string;
  color?: string;
  backgroundColor?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: CSSProperties["fontWeight"];
  fontStyle?: CSSProperties["fontStyle"];
  lineHeight?: CSSProperties["lineHeight"];
  textAlign?: CSSProperties["textAlign"];
  padding?: number;
};

export type CanvasShapeKind =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "line"
  | "arrow"
  | "path"
  | "polygon"
  | "star"
  | "marker"
  | "frame";

export type CanvasShapeNode = CanvasNodeBase & {
  type: "shape";
  shape?: CanvasShapeKind;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  text?: string;
  textColor?: string;
};

export type CanvasImageNode = CanvasNodeBase & {
  type: "image";
  src: string;
  alt?: string;
  objectFit?: CSSProperties["objectFit"];
  backgroundColor?: string;
};

export type CanvasNode = CanvasTextNode | CanvasShapeNode | CanvasImageNode;

export type CanvasBoardProps = {
  nodes: CanvasNode[];
  selectedIds: CanvasNodeId[];
  viewport: CanvasViewport;
  onNodesChange: (nodes: CanvasNode[], meta: CanvasChangeMeta) => void;
  onSelectionChange: (selectedIds: CanvasNodeId[], meta: CanvasSelectionMeta) => void;
  onViewportChange: (viewport: CanvasViewport, meta: CanvasViewportMeta) => void;
  onCommand?: (command: CanvasCommand) => void;
  className?: string;
  style?: CSSProperties;
  minZoom?: number;
  maxZoom?: number;
  gridSize?: number;
  showGrid?: boolean;
  showControls?: boolean;
  backgroundColor?: string;
  readOnly?: boolean;
  ariaLabel?: string;
  activeTool?: CanvasBoardTool;
  drawStyle?: CanvasDrawStyle;
  onToolComplete?: (tool: CanvasBoardTool) => void;
  renderNode?: (node: CanvasNode, state: CanvasNodeRenderState) => ReactNode;
};

export type CanvasNodeRenderState = {
  selected: boolean;
  dragging: boolean;
  zoom: number;
};
