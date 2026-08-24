"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  FileAudio,
  FileImage,
  FileVideo,
  Globe2,
  ImageIcon,
  LayoutTemplate,
  Loader2,
  Settings2,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useResourcePicker, type ResourceAsset } from "@/features/resource-library";
import { registerGeneratedResources, uploadLocalResources } from "@/features/resource-library/api";
import { uploadAudio } from "@/lib/utils";
import { downloadMediaFile } from "@/lib/media-download";
import { buildCanvasGenerationIdempotencyKey } from "@/lib/agent-generation-idempotency";
import {
  EMPTY_CANVAS_DOCUMENT,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeType,
  type CanvasProject,
  type CanvasViewport,
} from "@/lib/canvas-contract";
import type { CreativeRunClient } from "@/lib/creative-runs.server";
import type { AgentSkill } from "@/lib/creative-skills";
import { replaceLegacyCanvasBrand, SITE_NAME } from "@/lib/site-brand";
import {
  CanvasAgentPanel,
  CanvasBottomToolbar,
  CanvasTopBar,
  CanvasZoomControls,
  type CanvasPanelTab,
  type CanvasSaveState,
  type CanvasTool,
} from "./CanvasWorkbenchChrome";
import styles from "./infinite-canvas.module.css";
import { CanvasNodeContextMenu, CanvasNodeHoverTools, CanvasNodeToolDialog, type CanvasNodeTool } from "./CanvasNodeWorkbenchTools";

type PanState = { pointerId: number; clientX: number; clientY: number; origin: CanvasViewport } | null;
type SelectionState = { pointerId: number; startX: number; startY: number; x: number; y: number } | null;
type CanvasReference = Pick<ResourceAsset, "id" | "url" | "title" | "mediaType">;
type ReferenceRole = NonNullable<AgentSkill["referenceRoles"]>[number];
type CanvasGenerationPreferences = { aspectRatio: string; imageSize: string; count: number };

const NODE_DEFAULTS: Record<CanvasNodeType, { title: string; width: number; height: number }> = {
  text: { title: "文本", width: 320, height: 210 },
  image: { title: "图片节点", width: 360, height: 300 },
  panorama: { title: "全景图节点", width: 420, height: 220 },
  video: { title: "视频节点", width: 380, height: 260 },
  audio: { title: "音频节点", width: 340, height: 150 },
  config: { title: "生成配置", width: 300, height: 210 },
  brief: { title: "创作简报", width: 360, height: 260 },
  task: { title: "Agent 任务", width: 340, height: 220 },
  "brand-kit": { title: "品牌规范", width: 360, height: 260 },
};

export function InfiniteCanvasEditor({ projectId }: { projectId: string }) {
  const { openResourcePicker } = useResourcePicker();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const documentRef = useRef<CanvasDocument>(EMPTY_CANVAS_DOCUMENT);
  const titleRef = useRef("");
  const savingRef = useRef(false);
  const pastRef = useRef<CanvasDocument[]>([]);
  const futureRef = useRef<CanvasDocument[]>([]);
  const [project, setProject] = useState<CanvasProject | null>(null);
  const [document, setDocument] = useState<CanvasDocument>(EMPTY_CANVAS_DOCUMENT);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<CanvasSaveState>("saved");
  const [historyVersion, setHistoryVersion] = useState(0);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [interactionMode, setInteractionMode] = useState<CanvasTool>("pan");
  const [panState, setPanState] = useState<PanState>(null);
  const [selectionState, setSelectionState] = useState<SelectionState>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(true);
  const [agentTab, setAgentTab] = useState<CanvasPanelTab>("chat");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentSkills, setAgentSkills] = useState<AgentSkill[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [skillRoleAssignments, setSkillRoleAssignments] = useState<Record<string, CanvasReference[]>>({});
  const [runs, setRuns] = useState<CreativeRunClient[]>([]);
  const [generating, setGenerating] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ kind: "node" | "edge"; id: string; x: number; y: number } | null>(null);
  const [toolDialog, setToolDialog] = useState<{ nodeId: string; tool: CanvasNodeTool } | null>(null);
  const [toolPrompt, setToolPrompt] = useState("");
  const [toolBusy, setToolBusy] = useState(false);
  const [uploadTargetNodeId, setUploadTargetNodeId] = useState<string | null>(null);
  const [generationPreferences, setGenerationPreferences] = useState<CanvasGenerationPreferences>({ aspectRatio: "auto", imageSize: "1K", count: 1 });

  useEffect(() => { documentRef.current = document; }, [document]);
  useEffect(() => { titleRef.current = title; }, [title]);

  const loadRuns = useCallback(async () => {
    const response = await fetch("/api/creative-runs?limit=50", { cache: "no-store" });
    if (response.status === 401) return setRuns([]);
    const payload = await response.json().catch(() => ({})) as { runs?: CreativeRunClient[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "画布历史加载失败");
    setRuns((payload.runs || []).filter((run) => run.surface === "canvas" && run.projectId === projectId));
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`/api/canvas-projects/${encodeURIComponent(projectId)}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { project?: CanvasProject; error?: string };
        if (!response.ok || !payload.project) throw new Error(payload.error || "画布加载失败");
        return payload.project;
      }),
      fetch("/api/creative-skills?workspace=canvas", { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { skills?: AgentSkill[] };
        return response.ok && Array.isArray(payload.skills) ? payload.skills : [];
      }),
      loadRuns().catch(() => undefined),
    ]).then(([next, skills]) => {
      const nextTitle = replaceLegacyCanvasBrand(next.title);
      setProject(next);
      setDocument(next.document);
      setTitle(nextTitle);
      setAgentSkills(skills);
      setSaveState(nextTitle === next.title ? "saved" : "dirty");
      pastRef.current = [];
      futureRef.current = [];
      setHistoryVersion((value) => value + 1);
    }).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "画布加载失败");
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [loadRuns, projectId]);

  const commitDocument = useCallback((updater: (current: CanvasDocument) => CanvasDocument, recordHistory = true) => {
    setDocument((current) => {
      const next = updater(current);
      if (next === current) return current;
      if (recordHistory) {
        pastRef.current = [...pastRef.current.slice(-79), current];
        futureRef.current = [];
        setHistoryVersion((value) => value + 1);
      }
      documentRef.current = next;
      return next;
    });
    setSaveState("dirty");
  }, []);

  const updateNode = useCallback((nodeId: string, patch: Partial<CanvasNode>, recordHistory = false) => {
    commitDocument((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node) }), recordHistory);
  }, [commitDocument]);

  const undo = useCallback(() => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current.push(documentRef.current);
    documentRef.current = previous;
    setDocument(previous);
    setSelectedNodeIds(new Set());
    setSaveState("dirty");
    setHistoryVersion((value) => value + 1);
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(documentRef.current);
    documentRef.current = next;
    setDocument(next);
    setSelectedNodeIds(new Set());
    setSaveState("dirty");
    setHistoryVersion((value) => value + 1);
  }, []);

  const saveProject = useCallback(async () => {
    if (!project || savingRef.current || saveState === "saved") return;
    savingRef.current = true;
    setSaveState("saving");
    const capturedDocument = documentRef.current;
    const capturedTitle = replaceLegacyCanvasBrand(titleRef.current).trim() || `${SITE_NAME} 画布`;
    try {
      const response = await fetch(`/api/canvas-projects/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: project.revision, title: capturedTitle, document: capturedDocument }),
      });
      const payload = await response.json().catch(() => ({})) as { project?: CanvasProject; error?: string };
      if (!response.ok || !payload.project) throw new Error(payload.error || "画布保存失败");
      setProject(payload.project);
      if (titleRef.current !== capturedTitle) setTitle(capturedTitle);
      setSaveState(documentRef.current === capturedDocument && titleRef.current === capturedTitle ? "saved" : "dirty");
    } catch (error) {
      setSaveState("error");
      toast.error(error instanceof Error ? error.message : "画布保存失败");
    } finally {
      savingRef.current = false;
    }
  }, [project, saveState]);

  useEffect(() => {
    if (saveState !== "dirty") return;
    const timer = window.setTimeout(() => void saveProject(), 1100);
    return () => window.clearTimeout(timer);
  }, [document, saveProject, saveState, title]);

  const pendingGenerationKey = useMemo(() => document.nodes
    .filter((node) => node.metadata?.status === "loading" && node.metadata.generationId)
    .map((node) => `${node.id}:${node.metadata?.generationId}`)
    .sort()
    .join("|"), [document.nodes]);

  useEffect(() => {
    if (!pendingGenerationKey) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const pending = documentRef.current.nodes.filter((node) => node.metadata?.status === "loading" && node.metadata.generationId);
      await Promise.all(pending.map(async (node) => {
        try {
          const response = await fetch(`/api/general-image?generation_id=${encodeURIComponent(node.metadata?.generationId || "")}`, { cache: "no-store" });
          const payload = await response.json().catch(() => ({})) as { status?: string; status_group?: string; result_urls?: string[]; error?: string };
          if (cancelled) return;
          if (!response.ok) throw new Error(payload.error || "任务状态查询失败");
          if (payload.status_group === "completed" || payload.status === "completed") {
            const urls = Array.isArray(payload.result_urls) ? payload.result_urls.filter(Boolean) : [];
            updateNode(node.id, { content: urls[0] || node.content, metadata: { ...node.metadata, status: "success", errorDetails: undefined } });
            if (urls.length > 1) {
              const siblings = urls.slice(1).map((url, index): CanvasNode => ({ ...node, id: `image-${crypto.randomUUID()}`, x: node.x + (index + 1) * 36, y: node.y + (index + 1) * 36, content: url, metadata: { ...node.metadata, status: "success", errorDetails: undefined } }));
              commitDocument((current) => ({ ...current, nodes: [...current.nodes, ...siblings] }), false);
            }
          } else if (payload.status_group === "failed" || ["failed", "cancelled", "needs_review"].includes(payload.status || "")) {
            updateNode(node.id, { metadata: { ...node.metadata, status: payload.status === "cancelled" ? "cancelled" : payload.status === "needs_review" ? "needs_review" : "error", errorDetails: payload.error || "生成失败" } });
          }
        } catch (error) {
          if (!cancelled) updateNode(node.id, { metadata: { ...node.metadata, status: "error", errorDetails: error instanceof Error ? error.message : "任务恢复失败" } });
        }
      }));
    }, 2200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [commitDocument, pendingGenerationKey, updateNode]);

  const centerPosition = useCallback(() => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return { x: 160, y: 120 };
    return {
      x: (rect.width / 2 - documentRef.current.viewport.x) / documentRef.current.viewport.scale - 170,
      y: (rect.height / 2 - documentRef.current.viewport.y) / documentRef.current.viewport.scale - 120,
    };
  }, []);

  const addNode = useCallback((type: CanvasNodeType, content = "", title?: string) => {
    const defaults = NODE_DEFAULTS[type];
    const position = centerPosition();
    const node: CanvasNode = {
      id: `${type}-${crypto.randomUUID()}`,
      type,
      x: position.x + selectedNodeIds.size * 28,
      y: position.y + selectedNodeIds.size * 28,
      width: defaults.width,
      height: defaults.height,
      title: title || defaults.title,
      content: content || (type === "text" ? "双击开始记录创作想法、文案或结构。" : type === "config" ? "模型：智能\n比例：自动\n质量：高清" : ""),
    };
    commitDocument((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedNodeIds(new Set([node.id]));
    return node;
  }, [centerPosition, commitDocument, selectedNodeIds.size]);

  const appendAssetNodes = useCallback((assets: ResourceAsset[]) => {
    const base = centerPosition();
    const nodes = assets.map((asset, index): CanvasNode => ({
      id: `${asset.mediaType}-${crypto.randomUUID()}`,
      type: asset.mediaType === "video" ? "video" : "image",
      x: base.x + index * 34,
      y: base.y + index * 34,
      width: asset.mediaType === "video" ? 380 : 360,
      height: asset.mediaType === "video" ? 260 : 300,
      title: asset.title || (asset.mediaType === "video" ? "视频素材" : "图片素材"),
      content: asset.url,
      assetId: asset.id,
    }));
    if (!nodes.length) return;
    commitDocument((current) => ({ ...current, nodes: [...current.nodes, ...nodes] }));
    setSelectedNodeIds(new Set(nodes.map((node) => node.id)));
  }, [centerPosition, commitDocument]);

  const openAssets = useCallback(async () => {
    setAssetsOpen(true);
    try {
      const selected = await openResourcePicker({ title: "资产", role: "添加到画布", selectionMode: "multiple", maxCount: 12, mediaTypes: ["image", "video"] });
      if (selected?.length) appendAssetNodes(selected);
    } finally {
      setAssetsOpen(false);
    }
  }, [appendAssetNodes, openResourcePicker]);

  const handleUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).slice(0, 12);
    event.target.value = "";
    if (!files.length) return;
    const visualFiles = files.filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));
    const audioFiles = files.filter((file) => file.type.startsWith("audio/"));
    const toastId = toast.loading("正在上传素材…");
    try {
      if (visualFiles.length) {
        const result = await uploadLocalResources(visualFiles);
        if (uploadTargetNodeId && result.assets[0]) {
          const asset = result.assets[0];
          updateNode(uploadTargetNodeId, { type: asset.mediaType === "video" ? "video" : "image", content: asset.url, title: asset.title || "媒体素材", assetId: asset.id, metadata: { status: "success" } }, true);
        } else appendAssetNodes(result.assets);
        result.errors.forEach((error) => toast.error(error.message));
      }
      for (const file of audioFiles) {
        const uploaded = await uploadAudio(file);
        if (uploadTargetNodeId) updateNode(uploadTargetNodeId, { type: "audio", content: uploaded.url, title: file.name, metadata: { status: "success" } }, true);
        else addNode("audio", uploaded.url, file.name);
      }
      toast.success("素材已加入画布", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "素材上传失败", { id: toastId });
    } finally {
      setUploadTargetNodeId(null);
    }
  }, [addNode, appendAssetNodes, updateNode, uploadTargetNodeId]);

  const deleteNodes = useCallback((ids: Set<string>) => {
    if (!ids.size) return;
    commitDocument((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => !ids.has(node.id)),
      edges: current.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to)),
    }));
    setSelectedNodeIds((current) => new Set([...current].filter((id) => !ids.has(id))));
  }, [commitDocument]);

  const clearCanvas = useCallback(() => {
    if (!documentRef.current.nodes.length || !window.confirm("确认清空当前画布的全部节点与连线？")) return;
    commitDocument((current) => ({ ...current, nodes: [], edges: [] }));
    setSelectedNodeIds(new Set());
  }, [commitDocument]);

  const autoLayout = useCallback(() => {
    commitDocument((current) => {
      const columns = Math.max(1, Math.ceil(Math.sqrt(current.nodes.length)));
      return { ...current, nodes: current.nodes.map((node, index) => ({ ...node, x: 100 + (index % columns) * 440, y: 100 + Math.floor(index / columns) * 340 })) };
    });
    toast.success("画布布局已整理");
  }, [commitDocument]);

  const setScale = useCallback((scale: number) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    const current = documentRef.current.viewport;
    const nextScale = Math.min(2.4, Math.max(.25, scale));
    const worldX = (rect.width / 2 - current.x) / current.scale;
    const worldY = (rect.height / 2 - current.y) / current.scale;
    commitDocument((value) => ({ ...value, viewport: { scale: nextScale, x: rect.width / 2 - worldX * nextScale, y: rect.height / 2 - worldY * nextScale } }), false);
  }, [commitDocument]);

  const resetViewport = useCallback(() => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    const nodes = documentRef.current.nodes;
    if (!rect || !nodes.length) return commitDocument((value) => ({ ...value, viewport: { x: 80, y: 70, scale: 1 } }), false);
    const minX = Math.min(...nodes.map((node) => node.x));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxX = Math.max(...nodes.map((node) => node.x + node.width));
    const maxY = Math.max(...nodes.map((node) => node.y + node.height));
    const scale = Math.min(1.2, Math.max(.25, Math.min((rect.width - 180) / (maxX - minX), (rect.height - 180) / (maxY - minY))));
    commitDocument((value) => ({ ...value, viewport: { scale, x: (rect.width - (maxX - minX) * scale) / 2 - minX * scale, y: (rect.height - (maxY - minY) * scale) / 2 - minY * scale } }), false);
  }, [commitDocument]);

  const onSurfacePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button,input,textarea,select,a,[data-canvas-node],[data-canvas-chrome]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (interactionMode === "pan") {
      setPanState({ pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, origin: documentRef.current.viewport });
    } else {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      setSelectionState({ pointerId: event.pointerId, startX: x, startY: y, x, y });
      if (!event.shiftKey) setSelectedNodeIds(new Set());
    }
  };

  const onSurfacePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panState?.pointerId === event.pointerId) {
      const viewport = { ...panState.origin, x: panState.origin.x + event.clientX - panState.clientX, y: panState.origin.y + event.clientY - panState.clientY };
      setDocument((current) => ({ ...current, viewport }));
      documentRef.current = { ...documentRef.current, viewport };
    }
    if (selectionState?.pointerId === event.pointerId) {
      const rect = event.currentTarget.getBoundingClientRect();
      setSelectionState((current) => current ? { ...current, x: event.clientX - rect.left, y: event.clientY - rect.top } : null);
    }
  };

  const finishSurfaceGesture = () => {
    if (panState) {
      setPanState(null);
      setSaveState("dirty");
    }
    if (selectionState) {
      const viewport = documentRef.current.viewport;
      const left = (Math.min(selectionState.startX, selectionState.x) - viewport.x) / viewport.scale;
      const top = (Math.min(selectionState.startY, selectionState.y) - viewport.y) / viewport.scale;
      const right = (Math.max(selectionState.startX, selectionState.x) - viewport.x) / viewport.scale;
      const bottom = (Math.max(selectionState.startY, selectionState.y) - viewport.y) / viewport.scale;
      const hits = documentRef.current.nodes.filter((node) => node.x < right && node.x + node.width > left && node.y < bottom && node.y + node.height > top).map((node) => node.id);
      setSelectedNodeIds((current) => new Set([...current, ...hits]));
      setSelectionState(null);
    }
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const current = documentRef.current.viewport;
    const scale = Math.min(2.4, Math.max(.25, current.scale * Math.exp(-event.deltaY * .0012)));
    const worldX = (cursorX - current.x) / current.scale;
    const worldY = (cursorY - current.y) / current.scale;
    commitDocument((value) => ({ ...value, viewport: { scale, x: cursorX - worldX * scale, y: cursorY - worldY * scale } }), false);
  };

  const handleTool = (tool: string) => {
    if (tool === "assets") return void openAssets();
    if (tool === "upload") return uploadRef.current?.click();
    if (tool === "layout") return autoLayout();
    if (tool === "appearance") return;
    if (["text", "image", "panorama", "video", "audio", "config"].includes(tool)) addNode(tool as CanvasNodeType);
  };

  const connectNodes = useCallback((to: string) => {
    if (!connectingFrom || connectingFrom === to) return setConnectingFrom(null);
    commitDocument((current) => {
      if (current.edges.some((edge) => edge.from === connectingFrom && edge.to === to)) return current;
      const edge: CanvasEdge = { id: `edge-${crypto.randomUUID()}`, from: connectingFrom, to };
      return { ...current, edges: [...current.edges, edge] };
    });
    setConnectingFrom(null);
  }, [commitDocument, connectingFrom]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input,textarea,select,[contenteditable=true]")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        deleteNodes(selectedNodeIds);
      } else if (event.key === "Escape") {
        setSelectedNodeIds(new Set());
        setConnectingFrom(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteNodes, redo, selectedNodeIds, undo]);

  const activeSkill = agentSkills.find((skill) => skill.id === selectedSkillId);
  const selectedNode = document.nodes.find((node) => selectedNodeIds.has(node.id));
  const nodesById = useMemo(() => new Map(document.nodes.map((node) => [node.id, node])), [document.nodes]);

  const duplicateNode = useCallback((nodeId: string) => {
    const source = documentRef.current.nodes.find((node) => node.id === nodeId);
    if (!source) return;
    const copy: CanvasNode = { ...source, id: `${source.type}-${crypto.randomUUID()}`, x: source.x + 34, y: source.y + 34, title: `${source.title} 副本`, metadata: source.metadata ? { ...source.metadata, generationId: undefined, creativeRunId: undefined } : undefined };
    commitDocument((current) => ({ ...current, nodes: [...current.nodes, copy] }));
    setSelectedNodeIds(new Set([copy.id]));
  }, [commitDocument]);

  const openNodeTool = useCallback(async (node: CanvasNode, tool: CanvasNodeTool) => {
    if (tool === "download") {
      if (!node.content) return toast.info("当前节点没有可下载内容");
      try { await downloadMediaFile(node.content, node.title || `canvas-${node.type}`); } catch (error) { toast.error(error instanceof Error ? error.message : "下载失败"); }
      return;
    }
    if (tool === "save-asset") {
      if (!node.metadata?.generationId) return toast.success(node.assetId ? "该素材已在资源库中" : "上传素材已由资源库统一管理");
      try {
        const assets = await registerGeneratedResources({ generationId: node.metadata.generationId });
        const asset = assets.find((item) => item.url === node.content) || assets[0];
        if (asset) updateNode(node.id, { assetId: asset.id });
        toast.success("已加入我的素材");
      } catch (error) { toast.error(error instanceof Error ? error.message : "加入素材失败"); }
      return;
    }
    if (tool === "replace") {
      setUploadTargetNodeId(node.id);
      window.setTimeout(() => uploadRef.current?.click(), 0);
      return;
    }
    if (tool === "copy-prompt") {
      const value = node.metadata?.prompt || node.title;
      await navigator.clipboard.writeText(value);
      toast.success("提示词已复制");
      return;
    }
    if (tool === "font-down" || tool === "font-up") {
      const fontSize = Math.min(72, Math.max(12, (node.metadata?.fontSize || 16) + (tool === "font-up" ? 2 : -2)));
      updateNode(node.id, { metadata: { ...node.metadata, fontSize } }, true);
      return;
    }
    if (tool === "toggle-resize") {
      updateNode(node.id, { metadata: { ...node.metadata, freeResize: !node.metadata?.freeResize } }, true);
      toast.success(node.metadata?.freeResize ? "已锁定原始比例" : "已开启自由缩放");
      return;
    }
    const initialPrompt = tool === "edit" ? node.content : tool === "retry" ? node.metadata?.prompt || "" : tool === "generate-image" ? node.content : "";
    setToolPrompt(initialPrompt);
    setToolDialog({ nodeId: node.id, tool });
  }, [updateNode]);

  const confirmNodeTool = useCallback(async () => {
    if (!toolDialog || toolBusy || !project) return;
    const source = documentRef.current.nodes.find((node) => node.id === toolDialog.nodeId);
    if (!source) return setToolDialog(null);
    const tool = toolDialog.tool;
    if (tool === "edit") {
      updateNode(source.id, { content: toolPrompt }, true);
      setToolDialog(null);
      return;
    }
    setToolBusy(true);
    if (tool === "reverse-prompt") {
      try {
        const response = await fetch("/api/general-image/image-to-prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image_url: source.content }) });
        const payload = await response.json().catch(() => ({})) as { prompt?: string; error?: string };
        if (!response.ok || !payload.prompt) throw new Error(payload.error || "反推提示词失败");
        const node: CanvasNode = { id: `text-${crypto.randomUUID()}`, type: "text", x: source.x + source.width + 70, y: source.y, width: 360, height: 240, title: `${source.title} · 反推提示词`, content: payload.prompt, metadata: { status: "success", operation: tool, prompt: payload.prompt } };
        commitDocument((current) => ({ ...current, nodes: [...current.nodes, node], edges: [...current.edges, { id: `edge-${crypto.randomUUID()}`, from: source.id, to: node.id }] }));
        setSelectedNodeIds(new Set([node.id]));
        setToolDialog(null);
        toast.success("反推提示词已创建为文本节点");
      } catch (error) { toast.error(error instanceof Error ? error.message : "反推提示词失败"); }
      finally { setToolBusy(false); }
      return;
    }

    const outputNodeId = `image-${crypto.randomUUID()}`;
    const operationPrompt = buildNodeToolPrompt(tool, toolPrompt, source.metadata?.prompt || source.title);
    const sourceReference = ["image", "panorama"].includes(source.type) && source.content ? source.content : "";
    const count = tool === "layers" ? 3 : tool === "angle" ? Math.min(4, generationPreferences.count || 4) : tool === "split" ? splitOutputCount(toolPrompt) : generationPreferences.count;
    const placeholder: CanvasNode = { id: outputNodeId, type: "image", x: source.x + source.width + 70, y: source.y, width: 360, height: 300, title: `${source.title} · ${canvasToolLabel(tool)}`, content: "", metadata: { status: "loading", prompt: operationPrompt, operation: tool, model: "nano-banana-2", aspectRatio: generationPreferences.aspectRatio, imageSize: generationPreferences.imageSize } };
    commitDocument((current) => ({ ...current, nodes: [...current.nodes, placeholder], edges: [...current.edges, { id: `edge-${crypto.randomUUID()}`, from: source.id, to: placeholder.id }] }));
    setSelectedNodeIds(new Set([placeholder.id]));
    try {
      const clientRequestId = crypto.randomUUID();
      const runResponse = await fetch("/api/creative-runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: operationPrompt, mode: "image", surface: "canvas", projectId: project.id, clientRequestId, selectedSkillIds: [], skillRunMode: "quick", generationPreferences: { image: { ...generationPreferences, count } } }) });
      const runPayload = await runResponse.json().catch(() => ({})) as { run?: { id?: string }; error?: string };
      if (!runResponse.ok || !runPayload.run?.id) throw new Error(runPayload.error || "画布任务创建失败");
      const runId = runPayload.run.id;
      const response = await fetch("/api/general-image", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": buildCanvasGenerationIdempotencyKey(clientRequestId) },
        body: JSON.stringify({ mode: sourceReference ? "image-to-image" : "text-to-image", prompt: operationPrompt, user_prompt: toolPrompt || operationPrompt, reference_urls: sourceReference ? [sourceReference] : [], ai_model: "nano-banana-2", aspect_ratio: generationPreferences.aspectRatio, image_size: generationPreferences.imageSize, gen_count: count, creative_run_id: runId, creative_step_key: `canvas-${tool}`, creative_step_title: canvasToolLabel(tool), canvas_node_id: outputNodeId }),
      });
      const payload = await response.json().catch(() => ({})) as { generation_id?: string; error?: string };
      if (!response.ok || !payload.generation_id) throw new Error(payload.error || "图片处理任务提交失败");
      updateNode(outputNodeId, { metadata: { ...placeholder.metadata, generationId: payload.generation_id, creativeRunId: runId } });
      const urls = await pollCanvasGeneration(payload.generation_id);
      const results = urls.map((url, index): CanvasNode => index === 0
        ? { ...placeholder, content: url, metadata: { ...placeholder.metadata, generationId: payload.generation_id, creativeRunId: runId, status: "success" } }
        : { ...placeholder, id: `image-${crypto.randomUUID()}`, x: placeholder.x + index * 36, y: placeholder.y + index * 36, content: url, metadata: { ...placeholder.metadata, generationId: payload.generation_id, creativeRunId: runId, status: "success" } });
      commitDocument((current) => ({ ...current, nodes: [...current.nodes.filter((node) => node.id !== outputNodeId), ...results] }));
      setSelectedNodeIds(new Set(results.map((node) => node.id)));
      setToolDialog(null);
      await loadRuns();
      toast.success(`${canvasToolLabel(tool)}完成`);
    } catch (error) {
      updateNode(outputNodeId, { metadata: { ...placeholder.metadata, status: "error", errorDetails: error instanceof Error ? error.message : "图片处理失败" } });
      toast.error(error instanceof Error ? error.message : "图片处理失败");
      await loadRuns().catch(() => undefined);
    } finally { setToolBusy(false); }
  }, [commitDocument, generationPreferences, loadRuns, project, toolBusy, toolDialog, toolPrompt, updateNode]);

  const selectRoleAssets = async (role: ReferenceRole) => {
    const current = skillRoleAssignments[role.id] || [];
    const selected = await openResourcePicker({
      title: `选择${role.label}`,
      role: `${activeSkill?.name || "Canvas Skill"} · ${role.label}`,
      selectionMode: role.maxCount === 1 ? "single" : "multiple",
      maxCount: role.maxCount,
      existingCount: current.length,
      mediaTypes: role.mediaTypes || ["image"],
      excludedAssetIds: current.map((asset) => asset.id),
      excludedUrls: current.map((asset) => asset.url),
    });
    if (!selected?.length) return;
    setSkillRoleAssignments((value) => ({ ...value, [role.id]: [...(value[role.id] || []), ...selected.map(({ id, url, title, mediaType }) => ({ id, url, title, mediaType }))].slice(0, role.maxCount) }));
  };

  const assignSelectedToRole = async (role: ReferenceRole) => {
    if (!selectedNode || !["image", "panorama", "video"].includes(selectedNode.type) || !selectedNode.content) return toast.info("请先选中一个媒体节点");
    let resourceId = selectedNode.assetId;
    if (!resourceId && selectedNode.metadata?.generationId) {
      try {
        const assets = await registerGeneratedResources({ generationId: selectedNode.metadata.generationId });
        const asset = assets.find((item) => item.url === selectedNode.content) || assets[0];
        if (asset) {
          resourceId = asset.id;
          updateNode(selectedNode.id, { assetId: asset.id });
        }
      } catch (error) {
        return toast.error(error instanceof Error ? error.message : "素材登记失败");
      }
    }
    if (!resourceId) return toast.info("该节点需要先加入素材库，再用于 Skill 角色");
    setSkillRoleAssignments((value) => {
      const current = value[role.id] || [];
      if (current.some((asset) => asset.id === resourceId) || current.length >= role.maxCount) return value;
      return { ...value, [role.id]: [...current, { id: resourceId, url: selectedNode.content, title: selectedNode.title, mediaType: selectedNode.type === "video" ? "video" : "image" }] };
    });
  };

  const generateOnCanvas = async () => {
    const intent = agentPrompt.trim();
    if (!intent || generating || !project) return;
    const requiredMissing = activeSkill?.referenceRoles?.find((role) => role.required && !(skillRoleAssignments[role.id] || []).length);
    if (requiredMissing) return toast.error(`Skill「${activeSkill?.name}」缺少必填素材：${requiredMissing.label}`);
    setGenerating(true);
    const outputNodeId = `image-${crypto.randomUUID()}`;
    const base = centerPosition();
    const placeholder: CanvasNode = { id: outputNodeId, type: "image", x: base.x, y: base.y, width: 360, height: 300, title: intent.slice(0, 48), content: "", metadata: { status: "loading", prompt: intent, operation: "agent-generate", model: "nano-banana-2", aspectRatio: generationPreferences.aspectRatio, imageSize: generationPreferences.imageSize } };
    commitDocument((current) => ({ ...current, nodes: [...current.nodes, placeholder] }));
    setSelectedNodeIds(new Set([outputNodeId]));
    const roleAssets = Object.values(skillRoleAssignments).flat();
    const selectedReferences = documentRef.current.nodes
      .filter((node) => selectedNodeIds.has(node.id) && ["image", "panorama"].includes(node.type) && node.content)
      .map((node) => ({ id: node.id, url: node.content, title: node.title, mediaType: "image" as const }));
    const mentionedReferences = documentRef.current.nodes
      .filter((node) => intent.includes(`@${node.title}`) && ["image", "panorama"].includes(node.type) && node.content)
      .map((node) => ({ id: node.id, url: node.content, title: node.title, mediaType: "image" as const }));
    const references = Array.from(new Map([...roleAssets, ...selectedReferences, ...mentionedReferences].map((asset) => [asset.url, asset])).values());
    try {
      const clientRequestId = crypto.randomUUID();
      const runResponse = await fetch("/api/creative-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent,
          mode: "image",
          surface: "canvas",
          projectId: project.id,
          clientRequestId,
          selectedSkillIds: selectedSkillId ? [selectedSkillId] : [],
          skillRunMode: "professional",
          skillReferenceRoleAssetIds: Object.fromEntries(Object.entries(skillRoleAssignments).map(([key, assets]) => [key, assets.map((asset) => asset.id)])),
          generationPreferences: { image: { ...generationPreferences, quality: "smart" } },
        }),
      });
      const runPayload = await runResponse.json().catch(() => ({})) as { run?: { id?: string }; error?: string };
      if (!runResponse.ok || !runPayload.run?.id) throw new Error(runPayload.error || "画布 Agent Run 创建失败");
      const runId = runPayload.run.id;
      const generationResponse = await fetch("/api/general-image", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": buildCanvasGenerationIdempotencyKey(clientRequestId) },
        body: JSON.stringify({
          mode: references.length ? "image-to-image" : "text-to-image",
          prompt: intent,
          user_prompt: intent,
          reference_urls: references.map((asset) => asset.url),
          ai_model: "nano-banana-2",
          aspect_ratio: generationPreferences.aspectRatio,
          image_size: generationPreferences.imageSize,
          gen_count: generationPreferences.count,
          creative_run_id: runId,
          creative_step_key: "canvas-primary-image",
          creative_step_title: "画布 Agent 生成",
          canvas_node_id: outputNodeId,
        }),
      });
      const generation = await generationResponse.json().catch(() => ({})) as { generation_id?: string; error?: string };
      if (!generationResponse.ok || !generation.generation_id) throw new Error(generation.error || "画布生成提交失败");
      updateNode(outputNodeId, { metadata: { ...placeholder.metadata, generationId: generation.generation_id, creativeRunId: runId } });
      const urls = await pollCanvasGeneration(generation.generation_id);
      const nodes = urls.map((url, index): CanvasNode => ({ ...placeholder, id: index ? `image-${crypto.randomUUID()}` : outputNodeId, x: base.x + index * 36, y: base.y + index * 36, content: url, metadata: { ...placeholder.metadata, generationId: generation.generation_id, creativeRunId: runId, status: "success" } }));
      commitDocument((current) => ({ ...current, nodes: [...current.nodes.filter((node) => node.id !== outputNodeId), ...nodes] }));
      setSelectedNodeIds(new Set(nodes.map((node) => node.id)));
      setAgentPrompt("");
      setSkillRoleAssignments({});
      await loadRuns();
      toast.success("生成结果已加入画布");
    } catch (error) {
      updateNode(outputNodeId, { metadata: { ...placeholder.metadata, status: "error", errorDetails: error instanceof Error ? error.message : "画布生成失败" } });
      toast.error(error instanceof Error ? error.message : "画布生成失败");
      await loadRuns().catch(() => undefined);
    } finally {
      setGenerating(false);
    }
  };

  const quickAction = (value: string) => {
    if (value === "优化当前画布布局") autoLayout();
    else setAgentPrompt(value);
  };

  if (loading) return <div className={styles.editorLoading}><Loader2 className="animate-spin" />正在加载画布…</div>;
  if (!project) return <div className={styles.editorLoading}><LayoutTemplate />画布不存在或无权访问<Link href="/canvas">返回画布库</Link></div>;

  return (
    <main className={styles.editorPage}>
      <CanvasTopBar
        title={title}
        saveState={saveState}
        assetsOpen={assetsOpen}
        agentOpen={agentOpen}
        onTitleChange={(value) => { setTitle(replaceLegacyCanvasBrand(value)); setSaveState("dirty"); }}
        onOpenLibrary={() => { window.location.href = "/canvas"; }}
        onToggleAssets={() => void openAssets()}
        onToggleAgent={() => setAgentOpen((value) => !value)}
        onSave={() => void saveProject()}
      />
      <div className={styles.editorBody}>
        <div
          ref={surfaceRef}
          className={styles.canvasSurface}
          data-background={document.background}
          data-panning={Boolean(panState) || undefined}
          data-selecting={interactionMode === "select" || undefined}
          onPointerDown={onSurfacePointerDown}
          onPointerMove={onSurfacePointerMove}
          onPointerUp={finishSurfaceGesture}
          onPointerCancel={finishSurfaceGesture}
          onWheel={onWheel}
          onClick={() => setContextMenu(null)}
          onContextMenu={(event) => { if (!(event.target as HTMLElement).closest("[data-canvas-node],[data-canvas-edge]")) { event.preventDefault(); setContextMenu(null); } }}
        >
          <div className={styles.canvasWorld} style={{ transform: `translate(${document.viewport.x}px,${document.viewport.y}px) scale(${document.viewport.scale})` }}>
            <svg className={styles.edgeLayer} aria-hidden="true">
              {document.edges.map((edge) => {
                const from = nodesById.get(edge.from);
                const to = nodesById.get(edge.to);
                return from && to ? <path key={edge.id} data-canvas-edge d={edgePath(from, to)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setContextMenu({ kind: "edge", id: edge.id, x: event.clientX, y: event.clientY }); }} /> : null;
              })}
            </svg>
            {document.nodes.map((node) => (
              <CanvasNodeView
                key={node.id}
                node={node}
                selected={selectedNodeIds.has(node.id)}
                scale={document.viewport.scale}
                connecting={connectingFrom === node.id}
                onSelect={(additive) => setSelectedNodeIds((current) => additive ? new Set([...current, node.id]) : new Set([node.id]))}
                onChange={(patch, recordHistory) => updateNode(node.id, patch, recordHistory)}
                onDelete={() => deleteNodes(new Set([node.id]))}
                onStartConnection={() => setConnectingFrom(node.id)}
                onFinishConnection={() => connectNodes(node.id)}
                onTool={(tool) => void openNodeTool(node, tool)}
                onContextMenu={(x, y) => setContextMenu({ kind: "node", id: node.id, x, y })}
              />
            ))}
          </div>
          {selectionState ? <div className={styles.selectionRect} style={{ left: Math.min(selectionState.startX, selectionState.x), top: Math.min(selectionState.startY, selectionState.y), width: Math.abs(selectionState.x - selectionState.startX), height: Math.abs(selectionState.y - selectionState.startY) }} /> : null}
          {!document.nodes.length ? <div className={styles.emptyCanvasHint}><span><ImageIcon /></span><strong>空图片节点</strong><small>从下方工具栏添加节点，或让右侧 Agent 开始创作</small></div> : null}
          {minimapOpen ? <MiniMap nodes={document.nodes} /> : null}
          <CanvasZoomControls scale={document.viewport.scale} minimapOpen={minimapOpen} onScaleChange={setScale} onReset={resetViewport} onToggleMinimap={() => setMinimapOpen((value) => !value)} />
          <CanvasBottomToolbar
            interactionMode={interactionMode}
            canUndo={historyVersion >= 0 && pastRef.current.length > 0}
            canRedo={historyVersion >= 0 && futureRef.current.length > 0}
            hasSelection={selectedNodeIds.size > 0}
            background={document.background}
            onInteractionModeChange={setInteractionMode}
            onUndo={undo}
            onRedo={redo}
            onTool={handleTool}
            onDelete={() => deleteNodes(selectedNodeIds)}
            onClear={clearCanvas}
            onBackgroundChange={(background) => commitDocument((current) => ({ ...current, background }))}
          />
          <input ref={uploadRef} type="file" accept="image/*,video/*,audio/*" multiple hidden onChange={(event) => void handleUpload(event)} />
          {contextMenu ? <CanvasNodeContextMenu x={contextMenu.x} y={contextMenu.y} kind={contextMenu.kind} onDuplicate={contextMenu.kind === "node" ? () => duplicateNode(contextMenu.id) : undefined} onDelete={() => contextMenu.kind === "node" ? deleteNodes(new Set([contextMenu.id])) : commitDocument((current) => ({ ...current, edges: current.edges.filter((edge) => edge.id !== contextMenu.id) }))} onClose={() => setContextMenu(null)} /> : null}
          <CanvasNodeToolDialog node={toolDialog ? nodesById.get(toolDialog.nodeId) || null : null} tool={toolDialog?.tool || null} prompt={toolPrompt} busy={toolBusy} onPromptChange={setToolPrompt} onClose={() => { if (!toolBusy) setToolDialog(null); }} onConfirm={() => void confirmNodeTool()} />
        </div>
        <CanvasAgentPanel
          open={agentOpen}
          tab={agentTab}
          prompt={agentPrompt}
          generating={generating}
          runs={runs}
          skills={agentSkills}
          selectedSkillId={selectedSkillId}
          selectedNodeTitle={selectedNode?.title}
          nodes={document.nodes}
          nodeCount={document.nodes.length}
          generationPreferences={generationPreferences}
          skillWorkspace={activeSkill ? <CanvasSkillWorkspace skill={activeSkill} assignments={skillRoleAssignments} onSelectRole={selectRoleAssets} onAssignSelected={assignSelectedToRole} onRemove={(roleId, assetId) => setSkillRoleAssignments((value) => ({ ...value, [roleId]: (value[roleId] || []).filter((asset) => asset.id !== assetId) }))} /> : undefined}
          onClose={() => setAgentOpen(false)}
          onTabChange={setAgentTab}
          onPromptChange={setAgentPrompt}
          onSubmit={() => void generateOnCanvas()}
          onNewConversation={() => { setAgentPrompt(""); setSelectedSkillId(""); setSkillRoleAssignments({}); setAgentTab("chat"); }}
          onQuickAction={quickAction}
          onAddReference={() => void openAssets()}
          onSelectSkill={(id) => { setSelectedSkillId(id); setSkillRoleAssignments({}); }}
          onGenerationPreferencesChange={setGenerationPreferences}
        />
      </div>
    </main>
  );
}

function CanvasNodeView({ node, selected, scale, connecting, onSelect, onChange, onDelete, onStartConnection, onFinishConnection, onTool, onContextMenu }: {
  node: CanvasNode;
  selected: boolean;
  scale: number;
  connecting: boolean;
  onSelect: (additive: boolean) => void;
  onChange: (patch: Partial<CanvasNode>, recordHistory?: boolean) => void;
  onDelete: () => void;
  onStartConnection: () => void;
  onFinishConnection: () => void;
  onTool: (tool: CanvasNodeTool) => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const dragRef = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null);
  const resizeRef = useRef<{ pointerId: number; clientX: number; clientY: number; width: number; height: number } | null>(null);
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onChange({}, true);
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: node.x, y: node.y };
    onSelect(event.shiftKey);
  };
  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (state?.pointerId !== event.pointerId) return;
    onChange({ x: state.x + (event.clientX - state.clientX) / scale, y: state.y + (event.clientY - state.clientY) / scale });
  };
  const finishDrag = () => {
    dragRef.current = null;
  };
  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onChange({}, true);
    resizeRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, width: node.width, height: node.height };
  };
  const resize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = resizeRef.current;
    if (state?.pointerId !== event.pointerId) return;
    onChange({ width: Math.max(120, state.width + (event.clientX - state.clientX) / scale), height: Math.max(80, state.height + (event.clientY - state.clientY) / scale) });
  };
  const finishResize = () => {
    resizeRef.current = null;
  };
  return (
    <article data-canvas-node data-selected={selected || undefined} data-node-type={node.type} data-status={node.metadata?.status} className={styles.canvasNode} style={{ left: node.x, top: node.y, width: node.width, height: node.height }} onPointerDown={(event) => { event.stopPropagation(); onSelect(event.shiftKey); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onSelect(false); onContextMenu(event.clientX, event.clientY); }}>
      <CanvasNodeHoverTools node={node} onTool={onTool} />
      <div className={styles.nodeHeader} onPointerDown={startDrag} onPointerMove={drag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
        <span>{nodeIcon(node.type)}{node.title}</span><button type="button" aria-label="删除节点" onPointerDown={(event) => event.stopPropagation()} onClick={onDelete}><Trash2 /></button>
      </div>
      <button type="button" className={styles.nodeConnectIn} aria-label="连接到此节点" onPointerDown={(event) => event.stopPropagation()} onClick={onFinishConnection} />
      <NodeContent node={node} onChange={onChange} />
      <button type="button" className={styles.nodeConnectOut} data-active={connecting || undefined} aria-label="从此节点连线" onPointerDown={(event) => event.stopPropagation()} onClick={onStartConnection} />
      <button type="button" className={styles.resizeHandle} aria-label="调整节点尺寸" onPointerDown={startResize} onPointerMove={resize} onPointerUp={finishResize} onPointerCancel={finishResize} />
    </article>
  );
}

function NodeContent({ node, onChange }: { node: CanvasNode; onChange: (patch: Partial<CanvasNode>, recordHistory?: boolean) => void }) {
  if (node.metadata?.status === "loading" && !node.content) return <div className={styles.nodeMedia}><div className={styles.nodePlaceholder}><Loader2 className="animate-spin" /><strong>任务生成中</strong><small>可以离开页面，完成后会自动恢复</small></div></div>;
  if (["error", "cancelled", "needs_review"].includes(node.metadata?.status || "") && !node.content) return <div className={styles.nodeMedia}><div className={styles.nodePlaceholder} data-error><X /><strong>{node.metadata?.status === "needs_review" ? "任务需要检查" : "生成失败"}</strong><small>{node.metadata?.errorDetails || "请从节点工具栏重试"}</small></div></div>;
  if (["text", "config", "brief", "task", "brand-kit"].includes(node.type)) return <textarea value={node.content} aria-label={node.title} style={{ fontSize: node.metadata?.fontSize || undefined }} onPointerDown={(event) => event.stopPropagation()} onFocus={() => onChange({}, true)} onChange={(event) => onChange({ content: event.target.value })} />;
  if (!node.content) return <div className={styles.nodeMedia}><div className={styles.nodePlaceholder}><span>{nodeIcon(node.type)}</span><strong>{NODE_DEFAULTS[node.type].title}</strong><small>点击下方上传或资产工具添加内容</small></div></div>;
  if (node.type === "video") return <div className={styles.nodeMedia}><video src={node.content} controls playsInline onPointerDown={(event) => event.stopPropagation()} /></div>;
  if (node.type === "audio") return <div className={styles.nodeMedia}><audio src={node.content} controls onPointerDown={(event) => event.stopPropagation()} /></div>;
  return <div className={styles.nodeMedia}><Image src={node.content} alt={node.title} fill unoptimized sizes={`${Math.round(node.width)}px`} className="object-contain" draggable={false} /></div>;
}

function CanvasSkillWorkspace({ skill, assignments, onSelectRole, onAssignSelected, onRemove }: { skill: AgentSkill; assignments: Record<string, CanvasReference[]>; onSelectRole: (role: ReferenceRole) => void; onAssignSelected: (role: ReferenceRole) => void; onRemove: (roleId: string, assetId: string) => void }) {
  if (!skill.referenceRoles?.length) return null;
  return <section className={styles.skillWorkspace}><header><strong>Skill · {skill.name}</strong><span>专业模式</span></header><p>把素材放到明确角色中；素材不会在这里直接发起生成。</p>{skill.referenceRoles.map((role) => { const assets = assignments[role.id] || []; return <div key={role.id} className={styles.skillRole}><div><strong>{role.label} · {role.required ? "必填" : "可选"}</strong><span>{assets.length}/{role.maxCount}{role.description ? ` · ${role.description}` : ""}</span></div><div className={styles.skillRoleActions}><button type="button" onClick={() => onAssignSelected(role)}>使用选中节点</button><button type="button" onClick={() => void onSelectRole(role)}>资产库</button></div>{assets.length ? <div className={styles.skillAssets}>{assets.map((asset) => <span key={asset.id}>{asset.title || "素材"}<button type="button" aria-label={`移除${asset.title}`} onClick={() => onRemove(role.id, asset.id)}><X /></button></span>)}</div> : null}</div>; })}</section>;
}

function MiniMap({ nodes }: { nodes: CanvasNode[] }) {
  const bounds = useMemo(() => {
    if (!nodes.length) return { minX: 0, minY: 0, width: 1, height: 1 };
    const minX = Math.min(...nodes.map((node) => node.x));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxX = Math.max(...nodes.map((node) => node.x + node.width));
    const maxY = Math.max(...nodes.map((node) => node.y + node.height));
    return { minX, minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }, [nodes]);
  return <div className={styles.miniMap} data-canvas-chrome>{nodes.map((node) => <span key={node.id} style={{ left: `${((node.x - bounds.minX) / bounds.width) * 100}%`, top: `${((node.y - bounds.minY) / bounds.height) * 100}%`, width: `${Math.max(3, (node.width / bounds.width) * 100)}%`, height: `${Math.max(3, (node.height / bounds.height) * 100)}%` }} />)}</div>;
}

function nodeIcon(type: CanvasNodeType) {
  if (type === "image") return <FileImage />;
  if (type === "panorama") return <Globe2 />;
  if (type === "video") return <FileVideo />;
  if (type === "audio") return <FileAudio />;
  if (type === "config") return <Settings2 />;
  return <StickyNote />;
}

function edgePath(from: CanvasNode, to: CanvasNode) {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const bend = Math.max(80, Math.abs(x2 - x1) * .45);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

async function pollCanvasGeneration(generationId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 12 * 60_000) {
    await new Promise((resolve) => window.setTimeout(resolve, 1800));
    const response = await fetch(`/api/general-image?generation_id=${encodeURIComponent(generationId)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { status?: string; status_group?: string; result_urls?: string[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "任务状态查询失败");
    if (payload.status_group === "completed" || payload.status === "completed") {
      const urls = Array.isArray(payload.result_urls) ? payload.result_urls.filter(Boolean) : [];
      if (!urls.length) throw new Error("任务已完成，但没有返回可用结果");
      return urls;
    }
    if (payload.status_group === "failed" || ["failed", "cancelled", "needs_review"].includes(payload.status || "")) throw new Error(payload.error || "生成失败");
  }
  throw new Error("任务仍在后台执行，请稍后在历史中查看");
}

function splitOutputCount(value: string) {
  const match = value.match(/(\d)\s*[x×]\s*(\d)/i);
  return Math.min(4, Math.max(1, match ? Number(match[1]) * Number(match[2]) : 4));
}

function canvasToolLabel(tool: CanvasNodeTool) {
  const labels: Partial<Record<CanvasNodeTool, string>> = {
    mask: "局部编辑", crop: "裁剪重构", split: "智能切图", layers: "智能分层", "remove-bg": "消除背景", emotion: "表情参考", upscale: "画质放大", "super-resolve": "超分辨率", angle: "多角度生成", "generate-image": "文本生图", retry: "重新生成",
  };
  return labels[tool] || "节点编辑";
}

function buildNodeToolPrompt(tool: CanvasNodeTool, detail: string, sourcePrompt: string) {
  const extra = detail.trim();
  const operations: Partial<Record<CanvasNodeTool, string>> = {
    mask: "只修改用户指定的局部区域，未提及区域、主体身份、构图与画面风格必须保持不变。",
    crop: "按目标构图重新裁切画面，保持主体、材质、文字与关键细节完整，不新增无关内容。",
    split: `把画面按 ${extra || "2x2"} 网格拆分，依次输出可独立使用、边界清晰且无重复的分区。`,
    layers: "把画面拆解为主体、前景与背景三类可独立使用的视觉层，分别输出，边缘干净。",
    "remove-bg": "准确移除图片背景，完整保留主体轮廓、半透明细节与真实边缘，输出纯净浅色背景。",
    emotion: "只调整人物表情，保持人物身份、五官结构、发型、服装、姿势、背景、构图和光线不变。",
    upscale: "提升图片清晰度和分辨率，恢复材质与边缘细节，不改变原始内容和构图。",
    "super-resolve": "执行高质量超分辨率修复，去除压缩伪影，增强微细节，保持内容严格一致。",
    angle: "保持主体身份、材质、颜色与比例一致，从不同观察角度生成同一主体的完整视图。",
    "generate-image": "根据文本内容生成完整、高质量、可直接用于商业设计的图片。",
    retry: "重新执行原始生成要求，修正失败并输出完整、可用的高质量结果。",
  };
  return [operations[tool] || "按要求编辑图片。", extra, sourcePrompt ? `原始意图：${sourcePrompt}` : ""].filter(Boolean).join("\n").slice(0, 4000);
}
