"use client";

import {
  Copy,
  Maximize2,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type {
  CanvasActionSource,
  CanvasBoardProps,
  CanvasBoardTool,
  CanvasChangeMeta,
  CanvasCommand,
  CanvasNode,
  CanvasNodeId,
  CanvasPoint,
  CanvasRect,
  CanvasSelectionMeta,
  CanvasShapeKind,
  CanvasTextNode,
  CanvasViewport,
  CanvasViewportMeta,
} from "./types";

const DEFAULT_MIN_ZOOM = 0.12;
const DEFAULT_MAX_ZOOM = 4;
const DEFAULT_GRID_SIZE = 32;
const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, zoom: 1 };
const DRAG_THRESHOLD = 3;
const MIN_RESIZE_SIZE = 24;
const MIN_CREATE_SIZE = 8;
const MARKER_SIZE = 28;

type ClientPointLike = {
  clientX: number;
  clientY: number;
};

type ResizeAnchor = "nw" | "ne" | "sw" | "se";
type CropFrameAnchor = ResizeAnchor | "n" | "e" | "s" | "w" | "move";

type PointerInteraction =
  | {
      kind: "pan";
      pointerId: number;
      startClient: CanvasPoint;
      startViewport: CanvasViewport;
      moved: boolean;
    }
  | {
      kind: "drag";
      pointerId: number;
      ids: CanvasNodeId[];
      startClient: CanvasPoint;
      startWorld: CanvasPoint;
      startNodes: CanvasNode[];
      startPositions: Record<CanvasNodeId, CanvasPoint>;
      latestNodes: CanvasNode[] | null;
      moved: boolean;
    }
  | {
      kind: "resize";
      pointerId: number;
      id: CanvasNodeId;
      anchor: ResizeAnchor;
      startClient: CanvasPoint;
      startWorld: CanvasPoint;
      startNode: CanvasNode;
      startNodes: CanvasNode[];
      latestNodes: CanvasNode[] | null;
      moved: boolean;
    }
  | {
      kind: "crop-frame";
      pointerId: number;
      id: CanvasNodeId;
      anchor: CropFrameAnchor;
      startClient: CanvasPoint;
      startWorld: CanvasPoint;
      startNode: CanvasNode;
      startNodes: CanvasNode[];
      startCropFrame: CanvasRect;
      latestNodes: CanvasNode[] | null;
      moved: boolean;
    }
  | {
      kind: "marquee";
      pointerId: number;
      additive: boolean;
      startClient: CanvasPoint;
      startWorld: CanvasPoint;
      currentWorld: CanvasPoint;
      startSelectedIds: CanvasNodeId[];
      moved: boolean;
    }
  | {
      kind: "create";
      pointerId: number;
      tool: CanvasBoardTool;
      startClient: CanvasPoint;
      startWorld: CanvasPoint;
      currentWorld: CanvasPoint;
      startNodes: CanvasNode[];
      latestNodes: CanvasNode[] | null;
      draftId: CanvasNodeId;
      moved: boolean;
    }
  | {
      kind: "draw";
      pointerId: number;
      startClient: CanvasPoint;
      startNodes: CanvasNode[];
      latestNodes: CanvasNode[] | null;
      draftId: CanvasNodeId;
      points: CanvasPoint[];
      moved: boolean;
    };

type MarqueeState = {
  startWorld: CanvasPoint;
  currentWorld: CanvasPoint;
};

export function CanvasBoard({
  nodes,
  selectedIds,
  viewport,
  onNodesChange,
  onSelectionChange,
  onViewportChange,
  onCommand,
  className,
  style,
  minZoom = DEFAULT_MIN_ZOOM,
  maxZoom = DEFAULT_MAX_ZOOM,
  gridSize = DEFAULT_GRID_SIZE,
  showGrid = true,
  showControls = true,
  backgroundColor = "#f4f4f4",
  readOnly = false,
  ariaLabel = "Infinite canvas",
  activeTool = "select",
  drawStyle,
  onToolComplete,
  renderNode,
}: CanvasBoardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<CanvasNode[]>(nodes);
  const selectedIdsRef = useRef<CanvasNodeId[]>(selectedIds);
  const viewportRef = useRef<CanvasViewport>(viewport);
  const activeToolRef = useRef<CanvasBoardTool>(activeTool);
  const drawStyleRef = useRef(drawStyle);
  const interactionRef = useRef<PointerInteraction | null>(null);
  const clipboardRef = useRef<CanvasNode[]>([]);
  const spacePanningRef = useRef(false);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [draggingIds, setDraggingIds] = useState<CanvasNodeId[]>([]);
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const [editingTextId, setEditingTextId] = useState<CanvasNodeId | null>(null);
  const [editingTextDraft, setEditingTextDraft] = useState("");

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    drawStyleRef.current = drawStyle;
  }, [drawStyle]);

  useEffect(() => {
    spacePanningRef.current = isSpacePanning;
  }, [isSpacePanning]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || shouldIgnoreNativeKeyboardTarget(event.target)) return;
      spacePanningRef.current = true;
      setIsSpacePanning(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      spacePanningRef.current = false;
      setIsSpacePanning(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const draggingIdSet = useMemo(() => new Set(draggingIds), [draggingIds]);
  const visibleNodes = useMemo(
    () => nodes.filter((node) => !node.hidden).sort(compareNodePaintOrder),
    [nodes],
  );
  const selectedBounds = useMemo(
    () => getNodesBounds(nodes.filter((node) => selectedIdSet.has(node.id) && !node.hidden)),
    [nodes, selectedIdSet],
  );

  const emitCommand = useCallback(
    (command: CanvasCommand) => {
      onCommand?.(command);
    },
    [onCommand],
  );

  const emitNodesChange = useCallback(
    (nextNodes: CanvasNode[], meta: CanvasChangeMeta) => {
      nodesRef.current = nextNodes;
      onNodesChange(nextNodes, meta);
    },
    [onNodesChange],
  );

  const emitSelectionChange = useCallback(
    (nextSelectedIds: CanvasNodeId[], meta: CanvasSelectionMeta) => {
      const normalizedIds = uniqueIds(nextSelectedIds);
      if (sameIds(selectedIdsRef.current, normalizedIds)) return;
      selectedIdsRef.current = normalizedIds;
      onSelectionChange(normalizedIds, meta);
    },
    [onSelectionChange],
  );

  const emitViewportChange = useCallback(
    (nextViewport: CanvasViewport, meta: CanvasViewportMeta) => {
      const normalizedViewport = normalizeViewport(nextViewport, minZoom, maxZoom);
      viewportRef.current = normalizedViewport;
      onViewportChange(normalizedViewport, meta);
    },
    [maxZoom, minZoom, onViewportChange],
  );

  const gridStyle = useMemo(() => {
    const normalizedViewport = normalizeViewport(viewport, minZoom, maxZoom);
    const minorSize = Math.max(gridSize * normalizedViewport.zoom, 4);
    const majorSize = minorSize * 5;
    const minorPosition = `${normalizedViewport.x}px ${normalizedViewport.y}px`;

    return {
      backgroundColor,
      backgroundImage: showGrid
        ? [
            "linear-gradient(to right, rgba(148, 163, 184, 0.18) 1px, transparent 1px)",
            "linear-gradient(to bottom, rgba(148, 163, 184, 0.18) 1px, transparent 1px)",
            "linear-gradient(to right, rgba(100, 116, 139, 0.24) 1px, transparent 1px)",
            "linear-gradient(to bottom, rgba(100, 116, 139, 0.24) 1px, transparent 1px)",
          ].join(", ")
        : "none",
      backgroundPosition: [minorPosition, minorPosition, minorPosition, minorPosition].join(", "),
      backgroundSize: [
        `${minorSize}px ${minorSize}px`,
        `${minorSize}px ${minorSize}px`,
        `${majorSize}px ${majorSize}px`,
        `${majorSize}px ${majorSize}px`,
      ].join(", "),
    };
  }, [backgroundColor, gridSize, maxZoom, minZoom, showGrid, viewport]);

  const marqueeScreenRect = useMemo(() => {
    if (!marquee) return null;
    return worldRectToScreenRect(normalizeRectFromPoints(marquee.startWorld, marquee.currentWorld), viewport);
  }, [marquee, viewport]);

  const focusBoard = useCallback(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const copySelectedNodes = useCallback(
    (source: CanvasActionSource) => {
      const ids = selectedIdsRef.current;
      const selectedNodes = nodesRef.current.filter((node) => ids.includes(node.id) && !node.hidden);
      clipboardRef.current = selectedNodes;
      emitCommand({ type: "copy", source, ids, nodes: selectedNodes });
    },
    [emitCommand],
  );

  const pasteNodes = useCallback(
    (source: CanvasActionSource) => {
      if (readOnly || clipboardRef.current.length === 0) return;

      const now = Date.now().toString(36);
      const pastedNodes = clipboardRef.current.map((node, index) =>
        cloneNode(node, `${node.id}-paste-${now}-${index}`, { x: 36, y: 36 }),
      );
      const nextNodes = [...nodesRef.current, ...pastedNodes];
      const pastedIds = pastedNodes.map((node) => node.id);

      emitNodesChange(nextNodes, {
        action: "paste",
        source,
        affectedIds: pastedIds,
      });
      emitSelectionChange(pastedIds, { action: "replace", source });
      emitCommand({ type: "paste", source, ids: pastedIds, nodes: pastedNodes });
    },
    [emitCommand, emitNodesChange, emitSelectionChange, readOnly],
  );

  const duplicateSelectedNodes = useCallback(
    (source: CanvasActionSource) => {
      if (readOnly) return;

      const ids = selectedIdsRef.current;
      const selectedNodes = nodesRef.current.filter(
        (node) => ids.includes(node.id) && !node.hidden && !node.locked,
      );
      if (selectedNodes.length === 0) return;

      const now = Date.now().toString(36);
      const duplicatedNodes = selectedNodes.map((node, index) =>
        cloneNode(node, `${node.id}-copy-${now}-${index}`, { x: 24, y: 24 }),
      );
      const duplicatedIds = duplicatedNodes.map((node) => node.id);
      const nextNodes = [...nodesRef.current, ...duplicatedNodes];

      clipboardRef.current = selectedNodes;
      emitNodesChange(nextNodes, {
        action: "duplicate",
        source,
        affectedIds: duplicatedIds,
      });
      emitSelectionChange(duplicatedIds, { action: "replace", source });
      emitCommand({ type: "duplicate", source, ids: duplicatedIds, nodes: duplicatedNodes });
    },
    [emitCommand, emitNodesChange, emitSelectionChange, readOnly],
  );

  const deleteSelectedNodes = useCallback(
    (source: CanvasActionSource) => {
      if (readOnly) return;

      const ids = selectedIdsRef.current;
      if (ids.length === 0) return;

      const deleteIdSet = new Set(ids);
      const deletedIds = nodesRef.current
        .filter((node) => deleteIdSet.has(node.id) && !node.locked)
        .map((node) => node.id);
      if (deletedIds.length === 0) return;

      const deletedIdSet = new Set(deletedIds);
      const nextNodes = nodesRef.current.filter((node) => !deletedIdSet.has(node.id));
      const nextSelectedIds = ids.filter((id) => !deletedIdSet.has(id));

      emitNodesChange(nextNodes, {
        action: "delete",
        source,
        affectedIds: deletedIds,
      });
      emitSelectionChange(nextSelectedIds, {
        action: nextSelectedIds.length > 0 ? "replace" : "clear",
        source,
      });
      emitCommand({ type: "delete", source, ids: deletedIds });
    },
    [emitCommand, emitNodesChange, emitSelectionChange, readOnly],
  );

  const selectAllNodes = useCallback(
    (source: CanvasActionSource) => {
      const ids = nodesRef.current.filter((node) => !node.hidden).map((node) => node.id);
      emitSelectionChange(ids, { action: "all", source });
      emitCommand({ type: "select-all", source, ids });
    },
    [emitCommand, emitSelectionChange],
  );

  const clearSelection = useCallback(
    (source: CanvasActionSource) => {
      emitSelectionChange([], { action: "clear", source });
      emitCommand({ type: "clear-selection", source });
    },
    [emitCommand, emitSelectionChange],
  );

  const startTextEdit = useCallback(
    (node: CanvasNode) => {
      if (readOnly || node.locked || node.type !== "text") return;
      setEditingTextId(node.id);
      setEditingTextDraft(node.text);
      emitSelectionChange([node.id], { action: "replace", source: "pointer" });
    },
    [emitSelectionChange, readOnly],
  );

  const commitTextEdit = useCallback(() => {
    if (!editingTextId) return;
    const nextNodes = nodesRef.current.map((node) =>
      node.id === editingTextId && node.type === "text"
        ? {
            ...node,
            text: editingTextDraft,
          }
        : node,
    );
    emitNodesChange(nextNodes, {
      action: "custom",
      source: "api",
      affectedIds: [editingTextId],
    });
    setEditingTextId(null);
    setEditingTextDraft("");
  }, [editingTextDraft, editingTextId, emitNodesChange]);

  const cancelTextEdit = useCallback(() => {
    setEditingTextId(null);
    setEditingTextDraft("");
  }, []);

  const nudgeSelectedNodes = useCallback(
    (dx: number, dy: number, source: CanvasActionSource) => {
      if (readOnly) return;

      const ids = selectedIdsRef.current;
      const movableIdSet = new Set(
        nodesRef.current
          .filter((node) => ids.includes(node.id) && !node.locked && !node.hidden)
          .map((node) => node.id),
      );
      if (movableIdSet.size === 0) return;

      const nextNodes = nodesRef.current.map((node) =>
        movableIdSet.has(node.id)
          ? {
              ...node,
              x: node.x + dx,
              y: node.y + dy,
            }
          : node,
      );
      const affectedIds = Array.from(movableIdSet);

      emitNodesChange(nextNodes, {
        action: "nudge",
        source,
        affectedIds,
      });
      emitCommand({
        type: "nudge",
        source,
        ids: affectedIds,
        meta: { dx, dy },
      });
    },
    [emitCommand, emitNodesChange, readOnly],
  );

  const zoomAtScreenPoint = useCallback(
    (screenPoint: CanvasPoint, nextZoom: number, source: CanvasActionSource) => {
      const currentViewport = viewportRef.current;
      const normalizedZoom = clamp(nextZoom, minZoom, maxZoom);
      const worldPoint = screenToWorld(screenPoint, currentViewport);
      const nextViewport = {
        x: screenPoint.x - worldPoint.x * normalizedZoom,
        y: screenPoint.y - worldPoint.y * normalizedZoom,
        zoom: normalizedZoom,
      };

      emitViewportChange(nextViewport, { action: "zoom", source });
      return nextViewport;
    },
    [emitViewportChange, maxZoom, minZoom],
  );

  const zoomFromCenter = useCallback(
    (factor: number, source: CanvasActionSource) => {
      const root = rootRef.current;
      if (!root) return null;
      const nextViewport = zoomAtScreenPoint(
        { x: root.clientWidth / 2, y: root.clientHeight / 2 },
        viewportRef.current.zoom * factor,
        source,
      );
      return nextViewport;
    },
    [zoomAtScreenPoint],
  );

  const resetZoom = useCallback(
    (source: CanvasActionSource) => {
      const nextViewport = DEFAULT_VIEWPORT;
      emitViewportChange(nextViewport, { action: "reset", source });
      emitCommand({ type: "zoom-reset", source, viewport: nextViewport });
    },
    [emitCommand, emitViewportChange],
  );

  const fitToSelectionOrNodes = useCallback(
    (source: CanvasActionSource) => {
      const root = rootRef.current;
      if (!root) return;

      const selectedSet = new Set(selectedIdsRef.current);
      const targetNodes = nodesRef.current.filter((node) =>
        selectedSet.size > 0 ? selectedSet.has(node.id) && !node.hidden : !node.hidden,
      );
      const bounds = getNodesBounds(targetNodes);

      if (!bounds) {
        resetZoom(source);
        return;
      }

      const padding = 72;
      const availableWidth = Math.max(root.clientWidth - padding * 2, 1);
      const availableHeight = Math.max(root.clientHeight - padding * 2, 1);
      const nextZoom = clamp(
        Math.min(availableWidth / Math.max(bounds.width, 1), availableHeight / Math.max(bounds.height, 1)),
        minZoom,
        maxZoom,
      );
      const nextViewport = {
        x: root.clientWidth / 2 - (bounds.x + bounds.width / 2) * nextZoom,
        y: root.clientHeight / 2 - (bounds.y + bounds.height / 2) * nextZoom,
        zoom: nextZoom,
      };

      emitViewportChange(nextViewport, { action: "fit", source });
      emitCommand({
        type: "fit",
        source,
        ids: targetNodes.map((node) => node.id),
        viewport: nextViewport,
      });
    },
    [emitCommand, emitViewportChange, maxZoom, minZoom, resetZoom],
  );

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      const root = rootRef.current;
      if (!root) return;

      if (event.ctrlKey || event.metaKey || event.altKey) {
        const point = getLocalPoint(event, root);
        const factor = Math.exp(-event.deltaY * 0.001);
        const nextViewport = zoomAtScreenPoint(point, viewportRef.current.zoom * factor, "wheel");
        emitCommand({
          type: factor > 1 ? "zoom-in" : "zoom-out",
          source: "wheel",
          viewport: nextViewport,
        });
        return;
      }

      const horizontalDelta = event.shiftKey ? event.deltaY : event.deltaX;
      const verticalDelta = event.shiftKey ? 0 : event.deltaY;
      emitViewportChange(
        {
          ...viewportRef.current,
          x: viewportRef.current.x - horizontalDelta,
          y: viewportRef.current.y - verticalDelta,
        },
        { action: "pan", source: "wheel" },
      );
    },
    [emitCommand, emitViewportChange, zoomAtScreenPoint],
  );

  const createImmediateToolNode = useCallback(
    (tool: CanvasBoardTool, point: CanvasPoint, targetId?: CanvasNodeId) => {
      if (readOnly) return false;
      const draftId = createCanvasNodeId(tool);
      const markerData = tool === "mark" ? getMarkerTargetData(nodesRef.current, point, targetId) : undefined;
      const nextNode = createNodeForCanvasTool(tool, point, point, {
        id: draftId,
        zIndex: nodesRef.current.length,
        markerNumber: getNextMarkerNumber(nodesRef.current),
        targetId,
        markerData,
        useDefaultSize: true,
      });
      if (!nextNode) return false;

      const nextNodes = [...nodesRef.current, nextNode];
      emitNodesChange(nextNodes, {
        action: "create",
        source: "pointer",
        affectedIds: [nextNode.id],
        transient: false,
      });
      emitSelectionChange([nextNode.id], { action: "replace", source: "pointer" });
      emitCommand({ type: "create", source: "pointer", ids: [nextNode.id], nodes: [nextNode] });
      onToolComplete?.(tool);
      return true;
    },
    [emitCommand, emitNodesChange, emitSelectionChange, onToolComplete, readOnly],
  );

  const beginCreateInteraction = useCallback(
    (event: ReactPointerEvent<HTMLElement>, tool: CanvasBoardTool, startClient: CanvasPoint, startWorld: CanvasPoint) => {
      if (readOnly) return false;
      interactionRef.current = {
        kind: "create",
        pointerId: event.pointerId,
        tool,
        startClient,
        startWorld,
        currentWorld: startWorld,
        startNodes: nodesRef.current,
        latestNodes: null,
        draftId: createCanvasNodeId(tool),
        moved: false,
      };
      return true;
    },
    [readOnly],
  );

  const beginDrawInteraction = useCallback(
    (event: ReactPointerEvent<HTMLElement>, startClient: CanvasPoint, startWorld: CanvasPoint) => {
      if (readOnly) return false;
      interactionRef.current = {
        kind: "draw",
        pointerId: event.pointerId,
        startClient,
        startNodes: nodesRef.current,
        latestNodes: null,
        draftId: createCanvasNodeId("draw"),
        points: [startWorld],
        moved: false,
      };
      return true;
    },
    [readOnly],
  );

  const handleBoardPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
      const root = rootRef.current;
      if (!root) return;

      focusBoard();
      event.preventDefault();
      root.setPointerCapture(event.pointerId);

      const startClient = { x: event.clientX, y: event.clientY };
      const startLocal = getLocalPoint(event, root);
      const shouldPan = event.button === 1 || event.button === 2 || event.altKey || spacePanningRef.current;

      if (shouldPan) {
        interactionRef.current = {
          kind: "pan",
          pointerId: event.pointerId,
          startClient,
          startViewport: viewportRef.current,
          moved: false,
        };
        setIsPanning(true);
        return;
      }

      if (event.button !== 0) return;

      const startWorld = screenToWorld(startLocal, viewportRef.current);
      const tool = activeToolRef.current;
      if (tool === "draw") {
        beginDrawInteraction(event, startClient, startWorld);
        return;
      }
      if (tool === "mark") {
        if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
        return;
      }
      if (isImmediateCanvasTool(tool)) {
        createImmediateToolNode(tool, startWorld);
        if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
        return;
      }
      if (isCanvasCreationTool(tool)) {
        beginCreateInteraction(event, tool, startClient, startWorld);
        return;
      }

      interactionRef.current = {
        kind: "marquee",
        pointerId: event.pointerId,
        additive: event.shiftKey || event.metaKey || event.ctrlKey,
        startClient,
        startWorld,
        currentWorld: startWorld,
        startSelectedIds: selectedIdsRef.current,
        moved: false,
      };
      setMarquee({ startWorld, currentWorld: startWorld });
    },
    [beginCreateInteraction, beginDrawInteraction, createImmediateToolNode, focusBoard],
  );

  const handleNodePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, node: CanvasNode) => {
      if (event.button !== 0 || node.hidden) return;
      const root = rootRef.current;
      if (!root) return;

      focusBoard();
      event.preventDefault();
      event.stopPropagation();
      root.setPointerCapture(event.pointerId);

      const startLocal = getLocalPoint(event, root);
      const startWorld = screenToWorld(startLocal, viewportRef.current);
      const tool = activeToolRef.current;
      const targetId = node.type === "image" ? node.id : undefined;
      if (tool === "draw") {
        beginDrawInteraction(event, { x: event.clientX, y: event.clientY }, startWorld);
        return;
      }
      if (tool === "mark") {
        if (targetId) createImmediateToolNode(tool, startWorld, targetId);
        if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
        return;
      }
      if (isImmediateCanvasTool(tool)) {
        createImmediateToolNode(tool, startWorld, targetId);
        if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
        return;
      }
      if (isCanvasCreationTool(tool)) {
        beginCreateInteraction(event, tool, { x: event.clientX, y: event.clientY }, startWorld);
        return;
      }

      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      const currentSelection = selectedIdsRef.current;
      const alreadySelected = currentSelection.includes(node.id);
      const groupedSelection = !additive ? getGroupedSelectionIds(nodesRef.current, node) : [node.id];
      const shouldUseGroupedSelection = groupedSelection.length > 1;
      let nextSelection = currentSelection;
      let selectionAction: CanvasSelectionMeta["action"] = "replace";

      if (additive) {
        selectionAction = alreadySelected ? "toggle" : "add";
        nextSelection = alreadySelected
          ? currentSelection.filter((id) => id !== node.id)
          : [...currentSelection, node.id];
      } else if (shouldUseGroupedSelection) {
        nextSelection = sameIdSet(currentSelection, groupedSelection) ? currentSelection : groupedSelection;
      } else if (!alreadySelected || currentSelection.length !== 1) {
        nextSelection = [node.id];
      }

      emitSelectionChange(nextSelection, { action: selectionAction, source: "pointer" });

      if (readOnly || node.locked || !nextSelection.includes(node.id)) return;

      const movableIds = nodesRef.current
        .filter((candidate) => nextSelection.includes(candidate.id) && !candidate.locked && !candidate.hidden)
        .map((candidate) => candidate.id);
      if (movableIds.length === 0) return;

      const startPositions = Object.fromEntries(
        nodesRef.current.map((candidate) => [candidate.id, { x: candidate.x, y: candidate.y }]),
      );

      interactionRef.current = {
        kind: "drag",
        pointerId: event.pointerId,
        ids: movableIds,
        startClient: { x: event.clientX, y: event.clientY },
        startWorld,
        startNodes: nodesRef.current,
        startPositions,
        latestNodes: null,
        moved: false,
      };
      setDraggingIds(movableIds);
    },
    [beginCreateInteraction, beginDrawInteraction, createImmediateToolNode, emitSelectionChange, focusBoard, readOnly],
  );

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, node: CanvasNode, anchor: ResizeAnchor) => {
      if (readOnly || node.locked || event.button !== 0) return;
      const root = rootRef.current;
      if (!root) return;

      focusBoard();
      event.preventDefault();
      event.stopPropagation();
      root.setPointerCapture(event.pointerId);
      emitSelectionChange([node.id], { action: "replace", source: "pointer" });

      const startLocal = getLocalPoint(event, root);
      interactionRef.current = {
        kind: "resize",
        pointerId: event.pointerId,
        id: node.id,
        anchor,
        startClient: { x: event.clientX, y: event.clientY },
        startWorld: screenToWorld(startLocal, viewportRef.current),
        startNode: node,
        startNodes: nodesRef.current,
        latestNodes: null,
        moved: false,
      };
      setDraggingIds([node.id]);
    },
    [emitSelectionChange, focusBoard, readOnly],
  );

  const handleCropFramePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, node: CanvasNode, anchor: CropFrameAnchor) => {
      if (readOnly || node.locked || node.type !== "image" || event.button !== 0) return;
      const root = rootRef.current;
      if (!root) return;

      focusBoard();
      event.preventDefault();
      event.stopPropagation();
      root.setPointerCapture(event.pointerId);
      emitSelectionChange([node.id], { action: "replace", source: "pointer" });

      const startLocal = getLocalPoint(event, root);
      interactionRef.current = {
        kind: "crop-frame",
        pointerId: event.pointerId,
        id: node.id,
        anchor,
        startClient: { x: event.clientX, y: event.clientY },
        startWorld: screenToWorld(startLocal, viewportRef.current),
        startNode: node,
        startNodes: nodesRef.current,
        startCropFrame: getCropFrameRect(node),
        latestNodes: null,
        moved: false,
      };
      setDraggingIds([node.id]);
    },
    [emitSelectionChange, focusBoard, readOnly],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const root = rootRef.current;
      const interaction = interactionRef.current;
      if (!root || !interaction || interaction.pointerId !== event.pointerId) return;

      event.preventDefault();
      const currentClient = { x: event.clientX, y: event.clientY };
      const moved = getDistance(interaction.startClient, currentClient) > DRAG_THRESHOLD;

      if (interaction.kind === "pan") {
        interaction.moved = interaction.moved || moved;
        emitViewportChange(
          {
            x: interaction.startViewport.x + currentClient.x - interaction.startClient.x,
            y: interaction.startViewport.y + currentClient.y - interaction.startClient.y,
            zoom: interaction.startViewport.zoom,
          },
          { action: "pan", source: "pointer" },
        );
        return;
      }

      const currentLocal = getLocalPoint(event, root);
      const currentWorld = screenToWorld(currentLocal, viewportRef.current);

      if (interaction.kind === "create") {
        interaction.moved = interaction.moved || moved;
        interaction.currentWorld = currentWorld;
        const draftNode = createNodeForCanvasTool(interaction.tool, interaction.startWorld, currentWorld, {
          id: interaction.draftId,
          zIndex: interaction.startNodes.length,
          markerNumber: getNextMarkerNumber(interaction.startNodes),
          useDefaultSize: false,
        });
        if (!draftNode) return;
        const nextNodes = [...interaction.startNodes, draftNode];
        interaction.latestNodes = nextNodes;
        emitNodesChange(nextNodes, {
          action: "create",
          source: "pointer",
          affectedIds: [interaction.draftId],
          transient: true,
        });
        emitSelectionChange([interaction.draftId], { action: "replace", source: "pointer" });
        return;
      }

      if (interaction.kind === "draw") {
        interaction.moved = interaction.moved || moved;
        if (!interaction.moved) return;
        const lastPoint = interaction.points.at(-1);
        if (!lastPoint || getDistance(lastPoint, currentWorld) > 1.5) {
          interaction.points = [...interaction.points, currentWorld];
        }
        const draftNode = createPathNode(interaction.points, interaction.draftId, interaction.startNodes.length, drawStyleRef.current);
        const nextNodes = [...interaction.startNodes, draftNode];
        interaction.latestNodes = nextNodes;
        emitNodesChange(nextNodes, {
          action: "create",
          source: "pointer",
          affectedIds: [interaction.draftId],
          transient: true,
        });
        emitSelectionChange([interaction.draftId], { action: "replace", source: "pointer" });
        return;
      }

      if (interaction.kind === "drag") {
        interaction.moved = interaction.moved || moved;
        const dx = currentWorld.x - interaction.startWorld.x;
        const dy = currentWorld.y - interaction.startWorld.y;
        const nextNodes = interaction.startNodes.map((node) => {
          const startPosition = interaction.startPositions[node.id];
          if (!interaction.ids.includes(node.id) || !startPosition) return node;
          return {
            ...node,
            x: startPosition.x + dx,
            y: startPosition.y + dy,
          };
        });

        interaction.latestNodes = nextNodes;
        emitNodesChange(nextNodes, {
          action: "move",
          source: "pointer",
          affectedIds: interaction.ids,
          transient: true,
        });
        return;
      }

      if (interaction.kind === "resize") {
        interaction.moved = interaction.moved || moved;
        const nextRect = resizeRectFromAnchor(
          interaction.startNode,
          interaction.anchor,
          currentWorld.x - interaction.startWorld.x,
          currentWorld.y - interaction.startWorld.y,
        );
        const nextNodes = interaction.startNodes.map((node) =>
          node.id === interaction.id
            ? {
                ...node,
                ...nextRect,
              }
            : node,
        );

        interaction.latestNodes = nextNodes;
        emitNodesChange(nextNodes, {
          action: "resize",
          source: "pointer",
          affectedIds: [interaction.id],
          transient: true,
        });
        return;
      }

      if (interaction.kind === "crop-frame") {
        interaction.moved = interaction.moved || moved;
        const dx = currentWorld.x - interaction.startWorld.x;
        const dy = currentWorld.y - interaction.startWorld.y;
        const nextCropFrame = interaction.anchor === "move"
          ? moveCropFrame(interaction.startCropFrame, dx, dy, interaction.startNode)
          : resizeCropFrameFromAnchor(interaction.startCropFrame, interaction.anchor, dx, dy, interaction.startNode);
        const nextNodes = interaction.startNodes.map((node) =>
          node.id === interaction.id ? updateImageCropFrame(node, nextCropFrame) : node,
        );

        interaction.latestNodes = nextNodes;
        emitNodesChange(nextNodes, {
          action: "custom",
          source: "pointer",
          affectedIds: [interaction.id],
          transient: true,
        });
        return;
      }

      interaction.moved = interaction.moved || moved;
      interaction.currentWorld = currentWorld;
      setMarquee({ startWorld: interaction.startWorld, currentWorld });

      const marqueeRect = normalizeRectFromPoints(interaction.startWorld, currentWorld);
      const hitIds = expandGroupedNodeIds(nodesRef.current, getIntersectingNodeIds(nodesRef.current, marqueeRect));
      const nextSelection = interaction.additive
        ? uniqueIds([...interaction.startSelectedIds, ...hitIds])
        : hitIds;

      emitSelectionChange(nextSelection, { action: "marquee", source: "pointer" });
    },
    [emitNodesChange, emitSelectionChange, emitViewportChange],
  );

  const finishPointerInteraction = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const root = rootRef.current;
      const interaction = interactionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) return;

      event.preventDefault();
      if (root?.hasPointerCapture(event.pointerId)) {
        root.releasePointerCapture(event.pointerId);
      }

      if (interaction.kind === "create") {
        const finalNode = createNodeForCanvasTool(interaction.tool, interaction.startWorld, interaction.currentWorld, {
          id: interaction.draftId,
          zIndex: interaction.startNodes.length,
          markerNumber: getNextMarkerNumber(interaction.startNodes),
          useDefaultSize: !interaction.moved,
        });
        if (finalNode) {
          const nextNodes = [...interaction.startNodes, finalNode];
          emitNodesChange(nextNodes, {
            action: "create",
            source: "pointer",
            affectedIds: [finalNode.id],
            transient: false,
          });
          emitSelectionChange([finalNode.id], { action: "replace", source: "pointer" });
          emitCommand({ type: "create", source: "pointer", ids: [finalNode.id], nodes: [finalNode] });
          onToolComplete?.(interaction.tool);
        }
      }

      if (interaction.kind === "draw") {
        if (interaction.moved && interaction.latestNodes) {
          emitNodesChange(interaction.latestNodes, {
            action: "create",
            source: "pointer",
            affectedIds: [interaction.draftId],
            transient: false,
          });
          emitSelectionChange([interaction.draftId], { action: "replace", source: "pointer" });
          const created = interaction.latestNodes.find((node) => node.id === interaction.draftId);
          emitCommand({ type: "create", source: "pointer", ids: [interaction.draftId], nodes: created ? [created] : undefined });
          onToolComplete?.("draw");
        }
      }

      if (interaction.kind === "drag") {
        if (interaction.moved && interaction.latestNodes) {
          emitNodesChange(interaction.latestNodes, {
            action: "move",
            source: "pointer",
            affectedIds: interaction.ids,
            transient: false,
          });
          emitCommand({ type: "move", source: "pointer", ids: interaction.ids });
        }
        setDraggingIds([]);
      }

      if (interaction.kind === "resize") {
        if (interaction.moved && interaction.latestNodes) {
          emitNodesChange(interaction.latestNodes, {
            action: "resize",
            source: "pointer",
            affectedIds: [interaction.id],
            transient: false,
          });
          emitCommand({ type: "resize", source: "pointer", ids: [interaction.id] });
        }
        setDraggingIds([]);
      }

      if (interaction.kind === "crop-frame") {
        if (interaction.moved && interaction.latestNodes) {
          emitNodesChange(interaction.latestNodes, {
            action: "custom",
            source: "pointer",
            affectedIds: [interaction.id],
            transient: false,
          });
          emitCommand({ type: "resize", source: "pointer", ids: [interaction.id], meta: { operation: "crop-frame" } });
        }
        setDraggingIds([]);
      }

      if (interaction.kind === "marquee") {
        if (!interaction.moved && !interaction.additive) {
          clearSelection("pointer");
        }
        setMarquee(null);
      }

      if (interaction.kind === "pan") {
        setIsPanning(false);
      }

      interactionRef.current = null;
    },
    [clearSelection, emitCommand, emitNodesChange, emitSelectionChange, onToolComplete],
  );

  const cancelPointerInteraction = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const interaction = interactionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) return;
      if (interaction.kind === "drag" || interaction.kind === "resize" || interaction.kind === "crop-frame") setDraggingIds([]);
      if (interaction.kind === "marquee") setMarquee(null);
      if (interaction.kind === "pan") setIsPanning(false);
      if ((interaction.kind === "create" || interaction.kind === "draw") && interaction.latestNodes) {
        emitNodesChange(interaction.startNodes, {
          action: "custom",
          source: "pointer",
          affectedIds: [interaction.draftId],
          transient: true,
        });
      }
      if (interaction.kind === "crop-frame" && interaction.latestNodes) {
        emitNodesChange(interaction.startNodes, {
          action: "custom",
          source: "pointer",
          affectedIds: [interaction.id],
          transient: true,
        });
      }
      interactionRef.current = null;
    },
    [emitNodesChange],
  );

  const handleKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (shouldIgnoreNativeKeyboardTarget(event.target)) return;

      const key = event.key.toLowerCase();
      const isMod = event.metaKey || event.ctrlKey;

      if (key === "delete" || key === "backspace") {
        event.preventDefault();
        deleteSelectedNodes("keyboard");
        return;
      }

      if (isMod && key === "a") {
        event.preventDefault();
        selectAllNodes("keyboard");
        return;
      }

      if (isMod && key === "c") {
        event.preventDefault();
        copySelectedNodes("keyboard");
        return;
      }

      if (isMod && key === "v") {
        event.preventDefault();
        pasteNodes("keyboard");
        return;
      }

      if (isMod && key === "d") {
        event.preventDefault();
        duplicateSelectedNodes("keyboard");
        return;
      }

      if (isMod && key === "z") {
        event.preventDefault();
        const type = event.shiftKey ? "redo" : "undo";
        emitCommand({ type, source: "keyboard" });
        return;
      }

      if (isMod && key === "y") {
        event.preventDefault();
        emitCommand({ type: "redo", source: "keyboard" });
        return;
      }

      if (key === "escape") {
        event.preventDefault();
        clearSelection("keyboard");
        return;
      }

      const nudgeDistance = event.shiftKey ? 10 : 1;
      const nudgeByKey: Record<string, CanvasPoint> = {
        arrowup: { x: 0, y: -nudgeDistance },
        arrowdown: { x: 0, y: nudgeDistance },
        arrowleft: { x: -nudgeDistance, y: 0 },
        arrowright: { x: nudgeDistance, y: 0 },
      };
      const nudge = nudgeByKey[key];
      if (nudge) {
        event.preventDefault();
        nudgeSelectedNodes(nudge.x, nudge.y, "keyboard");
      }
    },
    [
      clearSelection,
      copySelectedNodes,
      deleteSelectedNodes,
      duplicateSelectedNodes,
      emitCommand,
      nudgeSelectedNodes,
      pasteNodes,
      selectAllNodes,
    ],
  );

  const handleZoomOut = useCallback(() => {
    const nextViewport = zoomFromCenter(0.82, "toolbar");
    if (nextViewport) emitCommand({ type: "zoom-out", source: "toolbar", viewport: nextViewport });
  }, [emitCommand, zoomFromCenter]);

  const handleZoomIn = useCallback(() => {
    const nextViewport = zoomFromCenter(1.22, "toolbar");
    if (nextViewport) emitCommand({ type: "zoom-in", source: "toolbar", viewport: nextViewport });
  }, [emitCommand, zoomFromCenter]);

  const rootClassName = cx(
    "relative h-full min-h-[360px] w-full overflow-hidden rounded-lg border border-slate-200 bg-[#f4f4f4] text-slate-950 shadow-sm outline-none",
    getCanvasToolCursor(activeTool, isPanning, isSpacePanning),
    className,
  );

  return (
    <div
      ref={rootRef}
      className={rootClassName}
      style={style}
      tabIndex={0}
      role="application"
      aria-label={ariaLabel}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleKeyboard}
      onPointerDown={handleBoardPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerInteraction}
      onPointerCancel={cancelPointerInteraction}
      onWheel={handleWheel}
    >
      <div className="absolute inset-0" style={gridStyle} aria-hidden="true" />

      <div
        className="absolute left-0 top-0 z-10 pointer-events-none"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          transformOrigin: "0 0",
        }}
      >
        {visibleNodes.map((node) => (
          <CanvasNodeView
            key={node.id}
            node={node}
            selected={selectedIdSet.has(node.id)}
            dragging={draggingIdSet.has(node.id)}
            zoom={viewport.zoom}
            editing={editingTextId === node.id}
            editingDraft={editingTextId === node.id ? editingTextDraft : ""}
            renderNode={renderNode}
            onPointerDown={handleNodePointerDown}
            onResizePointerDown={handleResizePointerDown}
            onCropFramePointerDown={handleCropFramePointerDown}
            onStartTextEdit={startTextEdit}
            onTextDraftChange={setEditingTextDraft}
            onCommitTextEdit={commitTextEdit}
            onCancelTextEdit={cancelTextEdit}
          />
        ))}

        {selectedBounds && selectedIds.length > 1 && (
          <div
            className="pointer-events-none absolute border border-dashed border-violet-500"
            style={{
              left: selectedBounds.x,
              top: selectedBounds.y,
              width: selectedBounds.width,
              height: selectedBounds.height,
              borderWidth: `${1 / Math.max(viewport.zoom, 0.01)}px`,
              boxShadow: `0 0 0 ${3 / Math.max(viewport.zoom, 0.01)}px rgba(59, 130, 246, 0.12)`,
            }}
            aria-hidden="true"
          />
        )}
      </div>

      {marqueeScreenRect && (
        <div
          className="pointer-events-none absolute z-20 border border-violet-500 bg-violet-500/10"
          style={{
            left: marqueeScreenRect.x,
            top: marqueeScreenRect.y,
            width: marqueeScreenRect.width,
            height: marqueeScreenRect.height,
          }}
          aria-hidden="true"
        />
      )}

      {showControls && (
        <div
        className="absolute bottom-3 left-3 z-30 flex items-center gap-1 rounded-lg border border-slate-200/90 bg-white/90 p-1 shadow-lg shadow-slate-900/5 backdrop-blur"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <ToolbarButton title="Undo" onClick={() => emitCommand({ type: "undo", source: "toolbar" })}>
          <Undo2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton title="Redo" onClick={() => emitCommand({ type: "redo", source: "toolbar" })}>
          <Redo2 className="h-4 w-4" />
        </ToolbarButton>
        <div className="mx-1 h-5 w-px bg-slate-200" />
        <ToolbarButton
          title="Copy selected"
          disabled={selectedIds.length === 0}
          onClick={() => copySelectedNodes("toolbar")}
        >
          <Copy className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Delete selected"
          disabled={readOnly || selectedIds.length === 0}
          onClick={() => deleteSelectedNodes("toolbar")}
        >
          <Trash2 className="h-4 w-4" />
        </ToolbarButton>
        </div>
      )}

      {showControls && (
        <div
        className="absolute bottom-3 right-3 z-30 flex items-center gap-1 rounded-lg border border-slate-200/90 bg-white/90 p-1 shadow-lg shadow-slate-900/5 backdrop-blur"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <ToolbarButton title="缩小" onClick={handleZoomOut}>
          <ZoomOut className="h-4 w-4" />
        </ToolbarButton>
        <span className="min-w-[52px] px-1 text-center text-xs font-bold tabular-nums text-slate-600">
          {Math.round(viewport.zoom * 100)}%
        </span>
        <ToolbarButton title="放大" onClick={handleZoomIn}>
          <ZoomIn className="h-4 w-4" />
        </ToolbarButton>
        <div className="mx-1 h-5 w-px bg-slate-200" />
        <ToolbarButton title="适配选区或全部元素" onClick={() => fitToSelectionOrNodes("toolbar")}>
          <Maximize2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton title="重置视图" onClick={() => resetZoom("toolbar")}>
          <RotateCcw className="h-4 w-4" />
        </ToolbarButton>
        </div>
      )}
    </div>
  );
}

type CanvasNodeViewProps = {
  node: CanvasNode;
  selected: boolean;
  dragging: boolean;
  zoom: number;
  editing: boolean;
  editingDraft: string;
  renderNode?: CanvasBoardProps["renderNode"];
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, node: CanvasNode) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>, node: CanvasNode, anchor: ResizeAnchor) => void;
  onCropFramePointerDown: (event: ReactPointerEvent<HTMLElement>, node: CanvasNode, anchor: CropFrameAnchor) => void;
  onStartTextEdit: (node: CanvasNode) => void;
  onTextDraftChange: (value: string) => void;
  onCommitTextEdit: () => void;
  onCancelTextEdit: () => void;
};

function CanvasNodeView({
  node,
  selected,
  dragging,
  zoom,
  editing,
  editingDraft,
  renderNode,
  onPointerDown,
  onResizePointerDown,
  onCropFramePointerDown,
  onStartTextEdit,
  onTextDraftChange,
  onCommitTextEdit,
  onCancelTextEdit,
}: CanvasNodeViewProps) {
  const outlineWidth = 2 / Math.max(zoom, 0.01);
  const handleSize = 10 / Math.max(zoom, 0.01);
  const handleOffset = handleSize / -2;
  const nodeStyleBase = { ...(node.style || {}) };
  const imageFilter = node.type === "image" && typeof nodeStyleBase.filter === "string" ? nodeStyleBase.filter : undefined;
  delete nodeStyleBase.filter;
  const imageFrameMode = node.type === "image" && typeof node.data?.imageFrameMode === "string" ? node.data.imageFrameMode : null;
  const cropFrame = selected && node.type === "image" && imageFrameMode === "crop-preview" ? getCropFrameRect(node) : null;
  const outlineStyle = imageFrameMode === "expand" ? "dashed" : "solid";
  const nodeStyle = {
    ...nodeStyleBase,
    position: "absolute" as const,
    left: node.x,
    top: node.y,
    width: Math.max(node.width, 1),
    height: Math.max(node.height, 1),
    zIndex: node.zIndex ?? 1,
    opacity: node.opacity ?? 1,
    transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
    transformOrigin: "center",
    outline: selected ? `${outlineWidth}px ${outlineStyle} #3b82f6` : undefined,
    outlineOffset: selected ? `${2 / Math.max(zoom, 0.01)}px` : undefined,
    boxShadow: selected ? `0 0 0 ${5 / Math.max(zoom, 0.01)}px rgba(59, 130, 246, 0.10)` : undefined,
  };

  return (
    <div
      className={cx(
        "pointer-events-auto absolute touch-none select-none",
        node.locked ? "cursor-default" : dragging ? "cursor-grabbing" : "cursor-move",
        node.className,
      )}
      style={nodeStyle}
      role="button"
      aria-label={node.name ?? `${node.type} node`}
      aria-pressed={selected}
      data-canvas-node-id={node.id}
      onPointerDown={(event) => onPointerDown(event, node)}
      onDoubleClick={(event) => {
        if (node.type !== "text") return;
        event.preventDefault();
        event.stopPropagation();
        onStartTextEdit(node);
      }}
    >
      {editing && node.type === "text" ? (
        <textarea
          autoFocus
          value={editingDraft}
          onChange={(event) => onTextDraftChange(event.target.value)}
          onBlur={onCommitTextEdit}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancelTextEdit();
            }
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              onCommitTextEdit();
            }
          }}
          className="h-full w-full resize-none rounded-[inherit] border border-violet-300 bg-white/95 p-2 text-inherit outline-none ring-4 ring-violet-500/10"
          style={{
            color: node.color ?? "#0f172a",
            fontFamily: node.fontFamily,
            fontSize: node.fontSize ?? 16,
            fontStyle: node.fontStyle,
            fontWeight: node.fontWeight ?? 600,
            lineHeight: node.lineHeight ?? 1.35,
            textAlign: node.textAlign ?? "left",
          }}
        />
      ) : renderNode ? renderNode(node, { selected, dragging, zoom }) : renderDefaultNode(node, imageFilter)}
      {cropFrame && !node.locked && (
        <CropFrameEditor
          frame={cropFrame}
          zoom={zoom}
          onPointerDown={(event, anchor) => onCropFramePointerDown(event, node, anchor)}
        />
      )}
      {selected && !node.locked && imageFrameMode !== "crop-preview" && (
        <>
          {(["nw", "ne", "sw", "se"] as const).map((anchor) => (
            <button
              key={anchor}
              type="button"
              aria-label={`Resize ${anchor}`}
              data-canvas-resize-handle={anchor}
              className={cx(
                "absolute rounded-full border border-white bg-blue-500 shadow-[0_1px_5px_rgba(15,23,42,0.28)]",
                (anchor === "nw" || anchor === "se") && "cursor-nwse-resize",
                (anchor === "ne" || anchor === "sw") && "cursor-nesw-resize",
              )}
              style={{
                width: handleSize,
                height: handleSize,
                left: anchor === "nw" || anchor === "sw" ? handleOffset : undefined,
                right: anchor === "ne" || anchor === "se" ? handleOffset : undefined,
                top: anchor === "nw" || anchor === "ne" ? handleOffset : undefined,
                bottom: anchor === "sw" || anchor === "se" ? handleOffset : undefined,
                borderWidth: 1 / Math.max(zoom, 0.01),
              }}
              onPointerDown={(event) => onResizePointerDown(event, node, anchor)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function CropFrameEditor({
  frame,
  zoom,
  onPointerDown,
}: {
  frame: CanvasRect;
  zoom: number;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, anchor: CropFrameAnchor) => void;
}) {
  const handleSize = 9 / Math.max(zoom, 0.01);
  const handleOffset = handleSize / -2;
  const borderWidth = 1 / Math.max(zoom, 0.01);
  const handles: Array<{ anchor: CropFrameAnchor; className: string; style: Record<string, number | string | undefined> }> = [
    { anchor: "nw", className: "cursor-nwse-resize", style: { left: handleOffset, top: handleOffset } },
    { anchor: "n", className: "cursor-ns-resize", style: { left: frame.width / 2 + handleOffset, top: handleOffset } },
    { anchor: "ne", className: "cursor-nesw-resize", style: { right: handleOffset, top: handleOffset } },
    { anchor: "e", className: "cursor-ew-resize", style: { right: handleOffset, top: frame.height / 2 + handleOffset } },
    { anchor: "se", className: "cursor-nwse-resize", style: { right: handleOffset, bottom: handleOffset } },
    { anchor: "s", className: "cursor-ns-resize", style: { left: frame.width / 2 + handleOffset, bottom: handleOffset } },
    { anchor: "sw", className: "cursor-nesw-resize", style: { left: handleOffset, bottom: handleOffset } },
    { anchor: "w", className: "cursor-ew-resize", style: { left: handleOffset, top: frame.height / 2 + handleOffset } },
  ];

  return (
    <>
      <button
        type="button"
        aria-label="移动裁切框"
        className="absolute cursor-move bg-transparent"
        style={{
          left: frame.x,
          top: frame.y,
          width: frame.width,
          height: frame.height,
          boxShadow: `0 0 0 ${borderWidth}px rgba(255,255,255,0.78), 0 0 0 ${borderWidth * 2}px rgba(59,130,246,0.30)`,
        }}
        onPointerDown={(event) => onPointerDown(event, "move")}
      />
      <div
        className="pointer-events-none absolute"
        style={{
          left: frame.x,
          top: frame.y,
          width: frame.width,
          height: frame.height,
          border: `${borderWidth}px solid rgba(255,255,255,0.85)`,
        }}
      />
      {handles.map((handle) => (
        <button
          key={handle.anchor}
          type="button"
          aria-label={`调整裁切框 ${handle.anchor}`}
          className={`absolute rounded-full border border-neutral-300 bg-white shadow-sm ${handle.className}`}
          style={{
            ...handle.style,
            width: handleSize,
            height: handleSize,
            borderWidth,
          }}
          onPointerDown={(event) => onPointerDown(event, handle.anchor)}
        />
      ))}
    </>
  );
}

function renderDefaultNode(node: CanvasNode, imageFilter?: string) {
  if (node.type === "image") {
    const flipX = node.data?.flipX === true;
    const flipY = node.data?.flipY === true;
    const contentX = readDataNumber(node, "contentX", 0);
    const contentY = readDataNumber(node, "contentY", 0);
    const contentWidth = readDataNumber(node, "contentWidth", node.width);
    const contentHeight = readDataNumber(node, "contentHeight", node.height);
    const frameMode = typeof node.data?.imageFrameMode === "string" ? node.data.imageFrameMode : "normal";
    const cropX = clamp(readDataNumber(node, "cropFrameX", 0), 0, node.width);
    const cropY = clamp(readDataNumber(node, "cropFrameY", 0), 0, node.height);
    const cropWidth = clamp(readDataNumber(node, "cropFrameWidth", node.width), 1, node.width);
    const cropHeight = clamp(readDataNumber(node, "cropFrameHeight", node.height), 1, node.height);
    const cropRight = Math.max(node.width - cropX - cropWidth, 0);
    const cropBottom = Math.max(node.height - cropY - cropHeight, 0);
    const showCropPreview = frameMode === "crop-preview";
    const showExpandPreview = frameMode === "expand";
    return (
      <div
        className="relative h-full w-full overflow-hidden rounded-[inherit]"
        style={{
          backgroundColor: node.backgroundColor ?? "#ffffff",
        }}
      >
        <img
          src={node.src}
          alt={node.alt ?? node.name ?? ""}
          draggable={false}
          className="absolute rounded-[inherit]"
          style={{
            left: contentX,
            top: contentY,
            width: Math.max(contentWidth, 1),
            height: Math.max(contentHeight, 1),
            objectFit: node.objectFit ?? "cover",
            backgroundColor: node.backgroundColor ?? "#e2e8f0",
            filter: imageFilter,
            transform: flipX || flipY ? `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` : undefined,
            transformOrigin: "center",
          }}
        />
        {showExpandPreview && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.62) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.62) 1px, transparent 1px)",
              backgroundSize: "25% 25%",
              boxShadow: "inset 0 0 0 1px rgba(59,130,246,0.30)",
            }}
          />
        )}
        {showCropPreview && (
          <>
            <div className="pointer-events-none absolute bg-neutral-900/50" style={{ left: 0, top: 0, width: cropX, height: "100%" }} />
            <div className="pointer-events-none absolute bg-neutral-900/50" style={{ right: 0, top: 0, width: cropRight, height: "100%" }} />
            <div className="pointer-events-none absolute bg-neutral-900/35" style={{ left: cropX, top: 0, width: cropWidth, height: cropY }} />
            <div className="pointer-events-none absolute bg-neutral-900/35" style={{ left: cropX, bottom: 0, width: cropWidth, height: cropBottom }} />
            <div
              className="pointer-events-none absolute"
              style={{
                left: cropX,
                top: cropY,
                width: cropWidth,
                height: cropHeight,
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,0.55) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.55) 1px, transparent 1px)",
                backgroundSize: "33.333% 33.333%",
                boxShadow: "0 0 0 1px rgba(255,255,255,0.65)",
              }}
            />
            {[
              [cropX, cropY],
              [cropX + cropWidth / 2, cropY],
              [cropX + cropWidth, cropY],
              [cropX, cropY + cropHeight / 2],
              [cropX + cropWidth, cropY + cropHeight / 2],
              [cropX, cropY + cropHeight],
              [cropX + cropWidth / 2, cropY + cropHeight],
              [cropX + cropWidth, cropY + cropHeight],
            ].map(([left, top], index) => (
              <span
                key={index}
                className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-neutral-300 bg-white shadow-sm"
                style={{ left, top }}
              />
            ))}
          </>
        )}
      </div>
    );
  }

  if (node.type === "text") {
    return (
      <div
        className="flex h-full w-full whitespace-pre-wrap break-words rounded-[inherit]"
        style={{
          alignItems: "center",
          justifyContent: textAlignToJustify(node.textAlign),
          padding: node.padding ?? 8,
          color: node.color ?? "#0f172a",
          backgroundColor: node.backgroundColor ?? "rgba(255, 255, 255, 0.88)",
          fontFamily: node.fontFamily,
          fontSize: node.fontSize ?? 16,
          fontStyle: node.fontStyle,
          fontWeight: node.fontWeight ?? 600,
          lineHeight: node.lineHeight ?? 1.35,
          textAlign: node.textAlign ?? "left",
          boxShadow: "inset 0 0 0 1px rgba(15, 23, 42, 0.08)",
        }}
      >
        {node.text}
      </div>
    );
  }

  const shape = node.shape ?? "rectangle";
  const fill = node.fill ?? "#ffffff";
  const stroke = node.stroke ?? "rgba(15, 23, 42, 0.16)";
  const strokeWidth = node.strokeWidth ?? 1;

  if (shape === "marker") {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-full border-2 border-white bg-blue-500 text-xs font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.35)]">
        {node.text || "1"}
      </div>
    );
  }

  if (shape === "line" || shape === "arrow") {
    const line = readLineGeometry(node);
    const markerId = `arrow-${node.id}`;
    return (
      <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${Math.max(node.width, 1)} ${Math.max(node.height, 1)}`}>
        {shape === "arrow" && (
          <defs>
            <marker id={markerId} markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
            </marker>
          </defs>
        )}
        <line
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          markerEnd={shape === "arrow" ? `url(#${markerId})` : undefined}
        />
      </svg>
    );
  }

  if (shape === "path") {
    const points = readPathPoints(node);
    const d = pointsToPath(points);
    return (
      <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${Math.max(node.width, 1)} ${Math.max(node.height, 1)}`}>
        <path d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (shape === "polygon" || shape === "star") {
    const points = shape === "star" ? getStarPoints(node.width, node.height) : getPolygonPoints(node.width, node.height);
    return (
      <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${Math.max(node.width, 1)} ${Math.max(node.height, 1)}`}>
        <polygon points={points} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <div className="relative h-full w-full">
      {shape === "diamond" ? (
        <div
          className="absolute left-1/2 top-1/2 h-[70.7107%] w-[70.7107%] -translate-x-1/2 -translate-y-1/2 rotate-45"
          style={{
            background: fill,
            border: `${strokeWidth}px solid ${stroke}`,
            borderRadius: node.radius ?? 4,
          }}
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background: fill,
            border: `${strokeWidth}px solid ${stroke}`,
            borderRadius: shape === "ellipse" ? "9999px" : node.radius ?? 8,
          }}
        />
      )}
      {node.text && (
        <div
          className="absolute inset-0 flex items-center justify-center px-3 text-center text-sm font-bold"
          style={{ color: node.textColor ?? "#0f172a" }}
        >
          {node.text}
        </div>
      )}
    </div>
  );
}

function isImmediateCanvasTool(tool: CanvasBoardTool) {
  return tool === "text" || tool === "mark";
}

function isCanvasCreationTool(tool: CanvasBoardTool) {
  return tool === "frame" || tool.startsWith("shape:");
}

function getCanvasToolCursor(tool: CanvasBoardTool, isPanning: boolean, isSpacePanning: boolean) {
  if (isPanning) return "cursor-grabbing";
  if (isSpacePanning) return "cursor-grab";
  if (tool === "draw") return "cursor-crosshair";
  if (tool === "mark" || tool === "text" || isCanvasCreationTool(tool)) return "cursor-crosshair";
  return "cursor-default";
}

function createCanvasNodeId(tool: CanvasBoardTool) {
  return `canvas-${tool.replace(/[^a-z0-9]+/gi, "-")}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function getNextMarkerNumber(nodes: CanvasNode[]) {
  return nodes.filter((node) => node.type === "shape" && node.shape === "marker").length + 1;
}

function createNodeForCanvasTool(
  tool: CanvasBoardTool,
  start: CanvasPoint,
  current: CanvasPoint,
  options: {
    id: CanvasNodeId;
    zIndex: number;
    markerNumber?: number;
    targetId?: CanvasNodeId;
    markerData?: Record<string, unknown>;
    useDefaultSize?: boolean;
  },
): CanvasNode | null {
  if (tool === "text") {
    return {
      id: options.id,
      type: "text",
      name: "文本",
      text: "双击编辑",
      x: Math.round(start.x),
      y: Math.round(start.y),
      width: 260,
      height: 72,
      color: "#111111",
      backgroundColor: "transparent",
      fontFamily: "Inter, sans-serif",
      fontSize: 64,
      fontWeight: 700,
      lineHeight: 1.05,
      padding: 0,
      zIndex: options.zIndex,
    };
  }

  if (tool === "mark") {
    return {
      id: options.id,
      type: "shape",
      name: `标记 ${options.markerNumber ?? 1}`,
      shape: "marker",
      x: Math.round(start.x - MARKER_SIZE / 2),
      y: Math.round(start.y - MARKER_SIZE / 2),
      width: MARKER_SIZE,
      height: MARKER_SIZE,
      fill: "#2563eb",
      stroke: "#ffffff",
      strokeWidth: 2,
      radius: 999,
      text: String(options.markerNumber ?? 1),
      textColor: "#ffffff",
      zIndex: options.zIndex,
      data: options.targetId || options.markerData
        ? { ...(options.targetId ? { targetId: options.targetId } : {}), ...(options.markerData ?? {}) }
        : undefined,
    };
  }

  const shape = tool === "frame" ? "frame" : tool.replace("shape:", "");
  if (!isCanvasShapeKind(shape)) return null;

  const isLine = shape === "line" || shape === "arrow";
  const defaultSize = tool === "frame" ? { width: 645, height: 480 } : isLine ? { width: 260, height: 1 } : { width: 290, height: 244 };
  const end = options.useDefaultSize ? { x: start.x + defaultSize.width, y: start.y + defaultSize.height } : current;
  const rect = normalizeCreatedRect(start, end, isLine ? 1 : MIN_CREATE_SIZE);

  if (isLine) {
    const line = getLineGeometry(start, end, rect);
    return {
      id: options.id,
      type: "shape",
      name: shape === "arrow" ? "箭头" : "线条",
      shape,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(Math.round(rect.width), 1),
      height: Math.max(Math.round(rect.height), 1),
      fill: "transparent",
      stroke: "#111111",
      strokeWidth: 3,
      radius: 0,
      zIndex: options.zIndex,
      data: { line },
    };
  }

  const isFrame = shape === "frame";
  return {
    id: options.id,
    type: "shape",
    name: isFrame ? "画板" : shape === "ellipse" ? "椭圆" : shape === "polygon" ? "多边形" : shape === "star" ? "星形" : "矩形",
    shape,
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(Math.round(rect.width), MIN_CREATE_SIZE),
    height: Math.max(Math.round(rect.height), MIN_CREATE_SIZE),
    fill: isFrame ? "rgba(255,255,255,0.01)" : "#d9d9d9",
    stroke: isFrame ? "#3b82f6" : "#111111",
    strokeWidth: isFrame ? 2 : 1.5,
    radius: shape === "ellipse" ? 999 : 0,
    zIndex: options.zIndex,
  };
}

function createPathNode(points: CanvasPoint[], id: CanvasNodeId, zIndex: number, drawStyle?: { stroke?: string; strokeWidth?: number }): CanvasNode {
  const normalized = normalizePathPoints(points);
  return {
    id,
    type: "shape",
    name: "画笔",
    shape: "path",
    x: Math.round(normalized.rect.x),
    y: Math.round(normalized.rect.y),
    width: Math.max(Math.round(normalized.rect.width), 1),
    height: Math.max(Math.round(normalized.rect.height), 1),
    fill: "transparent",
    stroke: drawStyle?.stroke || "#111111",
    strokeWidth: drawStyle?.strokeWidth || 6,
    radius: 0,
    zIndex,
    data: { points: normalized.points },
  };
}

function normalizeCreatedRect(start: CanvasPoint, current: CanvasPoint, minSize: number): CanvasRect {
  const rect = normalizeRectFromPoints(start, current);
  return {
    x: rect.x,
    y: rect.y,
    width: Math.max(rect.width, minSize),
    height: Math.max(rect.height, minSize),
  };
}

function getLineGeometry(start: CanvasPoint, end: CanvasPoint, rect: CanvasRect) {
  return {
    x1: start.x <= end.x ? 0 : rect.width,
    y1: start.y <= end.y ? 0 : rect.height,
    x2: start.x <= end.x ? rect.width : 0,
    y2: start.y <= end.y ? rect.height : 0,
  };
}

function normalizePathPoints(points: CanvasPoint[]) {
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const padding = 8;
  const rect = {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(maxX - minX + padding * 2, 1),
    height: Math.max(maxY - minY + padding * 2, 1),
  };
  return {
    rect,
    points: points.map((point) => ({ x: point.x - rect.x, y: point.y - rect.y })),
  };
}

function isCanvasShapeKind(value: string): value is CanvasShapeKind {
  return ["rectangle", "ellipse", "diamond", "line", "arrow", "path", "polygon", "star", "marker", "frame"].includes(value);
}

function getMarkerTargetData(nodes: CanvasNode[], point: CanvasPoint, targetId?: CanvasNodeId) {
  if (!targetId) return undefined;
  const target = nodes.find((node) => node.id === targetId && node.type === "image" && !node.hidden);
  if (!target) return { targetId };
  const targetX = clamp((point.x - target.x) / Math.max(target.width, 1), 0, 1);
  const targetY = clamp((point.y - target.y) / Math.max(target.height, 1), 0, 1);
  return {
    targetId,
    targetX: Number(targetX.toFixed(4)),
    targetY: Number(targetY.toFixed(4)),
    tagLabel: guessMarkerLabel(targetX, targetY),
  };
}

function guessMarkerLabel(x: number, y: number) {
  if (y < 0.22 && x > 0.26 && x < 0.74) return "人脸";
  if (y < 0.46 && x > 0.2 && x < 0.8) return "上衣";
  if (y > 0.55 && x > 0.28 && x < 0.72) return "裤子";
  if (x > 0.66 && y > 0.42) return "手提包";
  if (x < 0.18 || x > 0.82 || y < 0.12 || y > 0.88) return "背景";
  return "物体";
}

function readPathPoints(node: CanvasNode) {
  const raw = node.data?.points;
  if (!Array.isArray(raw)) return [{ x: 0, y: 0 }, { x: node.width, y: node.height }];
  const points = raw
    .map((point) => {
      if (!point || typeof point !== "object") return null;
      const x = Number((point as { x?: unknown }).x);
      const y = Number((point as { y?: unknown }).y);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    })
    .filter((point): point is CanvasPoint => Boolean(point));
  return points.length >= 2 ? points : [{ x: 0, y: 0 }, { x: node.width, y: node.height }];
}

function readLineGeometry(node: CanvasNode) {
  const raw = node.data?.line;
  if (raw && typeof raw === "object") {
    const line = raw as { x1?: unknown; y1?: unknown; x2?: unknown; y2?: unknown };
    const x1 = Number(line.x1);
    const y1 = Number(line.y1);
    const x2 = Number(line.x2);
    const y2 = Number(line.y2);
    if ([x1, y1, x2, y2].every(Number.isFinite)) return { x1, y1, x2, y2 };
  }
  return { x1: 0, y1: 0, x2: node.width, y2: node.height };
}

function pointsToPath(points: CanvasPoint[]) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${formatSvgNumber(point.x)} ${formatSvgNumber(point.y)}`).join(" ");
}

function formatSvgNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function getPolygonPoints(width: number, height: number) {
  return `${width / 2},0 ${width},${height} 0,${height}`;
}

function getStarPoints(width: number, height: number) {
  const cx = width / 2;
  const cy = height / 2;
  const outer = Math.min(width, height) / 2;
  const inner = outer * 0.45;
  return Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    return `${formatSvgNumber(cx + Math.cos(angle) * radius)},${formatSvgNumber(cy + Math.sin(angle) * radius)}`;
  }).join(" ");
}

type ToolbarButtonProps = {
  children: ReactNode;
  title: string;
  disabled?: boolean;
  onClick: () => void;
};

function ToolbarButton({ children, title, disabled = false, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function cloneNode(node: CanvasNode, id: CanvasNodeId, offset: CanvasPoint): CanvasNode {
  return {
    ...node,
    id,
    x: node.x + offset.x,
    y: node.y + offset.y,
    name: node.name ? `${node.name} Copy` : node.name,
  } as CanvasNode;
}

function getCropFrameRect(node: CanvasNode): CanvasRect {
  return constrainCropFrame(
    {
      x: readDataNumber(node, "cropFrameX", 0),
      y: readDataNumber(node, "cropFrameY", 0),
      width: readDataNumber(node, "cropFrameWidth", node.width),
      height: readDataNumber(node, "cropFrameHeight", node.height),
    },
    node,
  );
}

function moveCropFrame(frame: CanvasRect, dx: number, dy: number, node: CanvasNode): CanvasRect {
  return constrainCropFrame(
    {
      ...frame,
      x: frame.x + dx,
      y: frame.y + dy,
    },
    node,
  );
}

function resizeCropFrameFromAnchor(
  frame: CanvasRect,
  anchor: CropFrameAnchor,
  dx: number,
  dy: number,
  node: CanvasNode,
): CanvasRect {
  let nextX = frame.x;
  let nextY = frame.y;
  let nextWidth = frame.width;
  let nextHeight = frame.height;

  if (anchor.includes("w")) {
    nextX = frame.x + dx;
    nextWidth = frame.width - dx;
  }
  if (anchor.includes("e")) {
    nextWidth = frame.width + dx;
  }
  if (anchor.includes("n")) {
    nextY = frame.y + dy;
    nextHeight = frame.height - dy;
  }
  if (anchor.includes("s")) {
    nextHeight = frame.height + dy;
  }

  return constrainCropFrame({ x: nextX, y: nextY, width: nextWidth, height: nextHeight }, node, anchor);
}

function constrainCropFrame(frame: CanvasRect, node: CanvasNode, anchor?: CropFrameAnchor): CanvasRect {
  const minWidth = Math.min(Math.max(node.width, 1), 96);
  const minHeight = Math.min(Math.max(node.height, 1), 96);
  let width = clamp(frame.width, minWidth, Math.max(node.width, minWidth));
  let height = clamp(frame.height, minHeight, Math.max(node.height, minHeight));
  let x = frame.x;
  let y = frame.y;

  if (frame.width < minWidth && anchor?.includes("w")) x = frame.x + frame.width - minWidth;
  if (frame.height < minHeight && anchor?.includes("n")) y = frame.y + frame.height - minHeight;

  x = clamp(x, 0, Math.max(node.width - width, 0));
  y = clamp(y, 0, Math.max(node.height - height, 0));
  width = clamp(width, minWidth, Math.max(node.width - x, minWidth));
  height = clamp(height, minHeight, Math.max(node.height - y, minHeight));

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function updateImageCropFrame(node: CanvasNode, frame: CanvasRect): CanvasNode {
  if (node.type !== "image") return node;
  return {
    ...node,
    data: {
      ...(node.data || {}),
      cropFrameX: frame.x,
      cropFrameY: frame.y,
      cropFrameWidth: frame.width,
      cropFrameHeight: frame.height,
      imageFrameMode: "crop-preview",
    },
  };
}

function resizeRectFromAnchor(node: CanvasNode, anchor: ResizeAnchor, dx: number, dy: number): CanvasRect {
  let x = node.x;
  let y = node.y;
  let width = node.width;
  let height = node.height;

  if (anchor.includes("e")) width = node.width + dx;
  if (anchor.includes("s")) height = node.height + dy;
  if (anchor.includes("w")) {
    width = node.width - dx;
    x = node.x + dx;
  }
  if (anchor.includes("n")) {
    height = node.height - dy;
    y = node.y + dy;
  }

  if (width < MIN_RESIZE_SIZE) {
    if (anchor.includes("w")) x -= MIN_RESIZE_SIZE - width;
    width = MIN_RESIZE_SIZE;
  }
  if (height < MIN_RESIZE_SIZE) {
    if (anchor.includes("n")) y -= MIN_RESIZE_SIZE - height;
    height = MIN_RESIZE_SIZE;
  }

  return { x, y, width, height };
}

function compareNodePaintOrder(a: CanvasNode, b: CanvasNode) {
  return (a.zIndex ?? 0) - (b.zIndex ?? 0);
}

function getLocalPoint(point: ClientPointLike, root: HTMLElement): CanvasPoint {
  const rect = root.getBoundingClientRect();
  return {
    x: point.clientX - rect.left,
    y: point.clientY - rect.top,
  };
}

function screenToWorld(point: CanvasPoint, viewport: CanvasViewport): CanvasPoint {
  const safeZoom = Math.max(viewport.zoom, 0.01);
  return {
    x: (point.x - viewport.x) / safeZoom,
    y: (point.y - viewport.y) / safeZoom,
  };
}

function worldRectToScreenRect(rect: CanvasRect, viewport: CanvasViewport): CanvasRect {
  return {
    x: rect.x * viewport.zoom + viewport.x,
    y: rect.y * viewport.zoom + viewport.y,
    width: rect.width * viewport.zoom,
    height: rect.height * viewport.zoom,
  };
}

function normalizeRectFromPoints(a: CanvasPoint, b: CanvasPoint): CanvasRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function getNodeRect(node: CanvasNode): CanvasRect {
  return {
    x: node.x,
    y: node.y,
    width: Math.max(node.width, 1),
    height: Math.max(node.height, 1),
  };
}

function getNodesBounds(nodes: CanvasNode[]): CanvasRect | null {
  const visibleNodes = nodes.filter((node) => !node.hidden);
  if (visibleNodes.length === 0) return null;

  const left = Math.min(...visibleNodes.map((node) => node.x));
  const top = Math.min(...visibleNodes.map((node) => node.y));
  const right = Math.max(...visibleNodes.map((node) => node.x + Math.max(node.width, 1)));
  const bottom = Math.max(...visibleNodes.map((node) => node.y + Math.max(node.height, 1)));

  return {
    x: left,
    y: top,
    width: Math.max(right - left, 1),
    height: Math.max(bottom - top, 1),
  };
}

function getIntersectingNodeIds(nodes: CanvasNode[], rect: CanvasRect): CanvasNodeId[] {
  return nodes
    .filter((node) => !node.hidden && rectsIntersect(getNodeRect(node), rect))
    .sort(compareNodePaintOrder)
    .map((node) => node.id);
}

function expandGroupedNodeIds(nodes: CanvasNode[], ids: CanvasNodeId[]) {
  if (!ids.length) return ids;

  const idSet = new Set(ids);
  const groupIds = new Set(
    nodes
      .filter((node) => idSet.has(node.id))
      .map((node) => readDataString(node, "groupId"))
      .filter((groupId): groupId is string => Boolean(groupId)),
  );
  if (!groupIds.size) return ids;

  return nodes
    .filter((node) => !node.hidden && (idSet.has(node.id) || groupIds.has(readDataString(node, "groupId") ?? "")))
    .sort(compareNodePaintOrder)
    .map((node) => node.id);
}

function rectsIntersect(a: CanvasRect, b: CanvasRect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function normalizeViewport(viewport: CanvasViewport, minZoom: number, maxZoom: number): CanvasViewport {
  return {
    x: Number.isFinite(viewport.x) ? viewport.x : DEFAULT_VIEWPORT.x,
    y: Number.isFinite(viewport.y) ? viewport.y : DEFAULT_VIEWPORT.y,
    zoom: clamp(Number.isFinite(viewport.zoom) ? viewport.zoom : DEFAULT_VIEWPORT.zoom, minZoom, maxZoom),
  };
}

function getDistance(a: CanvasPoint, b: CanvasPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function uniqueIds(ids: CanvasNodeId[]) {
  return Array.from(new Set(ids));
}

function getGroupedSelectionIds(nodes: CanvasNode[], node: CanvasNode) {
  const groupId = readDataString(node, "groupId");
  if (!groupId) return [node.id];
  const groupIds = nodes
    .filter((candidate) => !candidate.hidden && readDataString(candidate, "groupId") === groupId)
    .map((candidate) => candidate.id);
  return groupIds.length > 1 ? groupIds : [node.id];
}

function readDataString(node: CanvasNode, key: string) {
  const value = node.data?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function sameIdSet(a: CanvasNodeId[], b: CanvasNodeId[]) {
  if (a.length !== b.length) return false;
  const bIds = new Set(b);
  return a.every((id) => bIds.has(id));
}

function sameIds(a: CanvasNodeId[], b: CanvasNodeId[]) {
  if (a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
}

function shouldIgnoreNativeKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function readDataNumber(node: CanvasNode, key: string, fallback: number) {
  const value = node.data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function textAlignToJustify(textAlign: CanvasTextNode["textAlign"]) {
  if (textAlign === "center") return "center";
  if (textAlign === "right" || textAlign === "end") return "flex-end";
  return "flex-start";
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
