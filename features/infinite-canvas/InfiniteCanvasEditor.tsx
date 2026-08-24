"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  ImagePlus,
  LayoutTemplate,
  Loader2,
  LocateFixed,
  Minus,
  Plus,
  Save,
  Sparkles,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useResourcePicker, type ResourceAsset } from "@/features/resource-library";
import {
  EMPTY_CANVAS_DOCUMENT,
  type CanvasDocument,
  type CanvasNode,
  type CanvasProject,
  type CanvasViewport,
} from "@/lib/canvas-contract";
import type { AgentSkill } from "@/lib/creative-skills";
import styles from "./infinite-canvas.module.css";

type SaveState = "saved" | "dirty" | "saving" | "error";
type PanState = { pointerId: number; clientX: number; clientY: number; origin: CanvasViewport } | null;
type CanvasSkillReference = Pick<ResourceAsset, "id" | "url" | "title" | "mediaType">;

export function InfiniteCanvasEditor({ projectId }: { projectId: string }) {
  const { openResourcePicker } = useResourcePicker();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const documentRef = useRef<CanvasDocument>(EMPTY_CANVAS_DOCUMENT);
  const titleRef = useRef("");
  const savingRef = useRef(false);
  const [project, setProject] = useState<CanvasProject | null>(null);
  const [document, setDocument] = useState<CanvasDocument>(EMPTY_CANVAS_DOCUMENT);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [panState, setPanState] = useState<PanState>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentSkills, setAgentSkills] = useState<AgentSkill[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [skillRoleAssignments, setSkillRoleAssignments] = useState<Record<string, CanvasSkillReference[]>>({});
  const [generating, setGenerating] = useState(false);

  useEffect(() => { documentRef.current = document; }, [document]);
  useEffect(() => { titleRef.current = title; }, [title]);

  useEffect(() => {
    if (!agentOpen) return;
    const controller = new AbortController();
    fetch("/api/creative-skills?workspace=canvas", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { skills?: AgentSkill[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Canvas Skill 加载失败");
        setAgentSkills(Array.isArray(payload.skills) ? payload.skills : []);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        toast.error(error instanceof Error ? error.message : "Canvas Skill 加载失败");
      });
    return () => controller.abort();
  }, [agentOpen]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/canvas-projects/${encodeURIComponent(projectId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { project?: CanvasProject; error?: string };
        if (!response.ok || !payload.project) throw new Error(payload.error || "画布加载失败");
        return payload.project;
      })
      .then((next) => {
        setProject(next);
        setDocument(next.document);
        setTitle(next.title);
        setSaveState("saved");
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        toast.error(error instanceof Error ? error.message : "画布加载失败");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [projectId]);

  const markDocument = useCallback((updater: (current: CanvasDocument) => CanvasDocument) => {
    setDocument((current) => updater(current));
    setSaveState("dirty");
  }, []);

  const saveProject = useCallback(async () => {
    if (!project || savingRef.current || saveState === "saved") return;
    savingRef.current = true;
    setSaveState("saving");
    const capturedDocument = documentRef.current;
    const capturedTitle = titleRef.current;
    try {
      const response = await fetch(`/api/canvas-projects/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: project.revision, title: capturedTitle, document: capturedDocument }),
      });
      const payload = await response.json().catch(() => ({})) as { project?: CanvasProject; error?: string };
      if (!response.ok || !payload.project) throw new Error(payload.error || "画布保存失败");
      setProject((current) => current ? { ...current, revision: payload.project!.revision, updatedAt: payload.project!.updatedAt } : payload.project!);
      const unchanged = documentRef.current === capturedDocument && titleRef.current === capturedTitle;
      setSaveState(unchanged ? "saved" : "dirty");
    } catch (error) {
      setSaveState("error");
      toast.error(error instanceof Error ? error.message : "画布保存失败");
    } finally {
      savingRef.current = false;
    }
  }, [project, saveState]);

  useEffect(() => {
    if (saveState !== "dirty") return;
    const timer = window.setTimeout(() => void saveProject(), 1200);
    return () => window.clearTimeout(timer);
  }, [document, saveProject, saveState, title]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saveState === "dirty" || saveState === "saving") event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [saveState]);

  const centerPosition = useCallback(() => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return { x: 120, y: 100 };
    return {
      x: (rect.width / 2 - document.viewport.x) / document.viewport.scale - 140,
      y: (rect.height / 2 - document.viewport.y) / document.viewport.scale - 90,
    };
  }, [document.viewport]);

  const addTextNode = () => {
    const position = centerPosition();
    const node: CanvasNode = {
      id: `text-${crypto.randomUUID()}`,
      type: "text",
      ...position,
      width: 300,
      height: 190,
      title: "灵感便笺",
      content: "在这里记录创作方向、商品卖点或待验证的提示词。",
    };
    markDocument((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedNodeId(node.id);
  };

  const addAssets = async () => {
    const selected = await openResourcePicker({
      title: "添加到画布",
      role: "画布图片节点",
      selectionMode: "multiple",
      maxCount: 12,
      mediaTypes: ["image"],
    });
    if (!selected?.length) return;
    appendAssetNodes(selected);
  };

  const appendAssetNodes = (assets: ResourceAsset[]) => {
    const base = centerPosition();
    const nodes = assets.map((asset, index): CanvasNode => ({
      id: `image-${crypto.randomUUID()}`,
      type: "image",
      x: base.x + index * 36,
      y: base.y + index * 36,
      width: 320,
      height: 250,
      title: asset.title || "图片素材",
      content: asset.url,
      assetId: asset.id,
    }));
    markDocument((current) => ({ ...current, nodes: [...current.nodes, ...nodes] }));
    setSelectedNodeId(nodes.at(-1)?.id || null);
  };

  const updateNode = useCallback((nodeId: string, patch: Partial<CanvasNode>) => {
    markDocument((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } as CanvasNode : node),
    }));
  }, [markDocument]);

  const deleteNode = useCallback((nodeId: string) => {
    markDocument((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      edges: current.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
    }));
    setSelectedNodeId((current) => current === nodeId ? null : current);
  }, [markDocument]);

  const onSurfacePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button,input,textarea,a,[data-canvas-node]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedNodeId(null);
    setPanState({ pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, origin: document.viewport });
  };

  const onSurfacePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panState || panState.pointerId !== event.pointerId) return;
    const next = {
      ...panState.origin,
      x: panState.origin.x + event.clientX - panState.clientX,
      y: panState.origin.y + event.clientY - panState.clientY,
    };
    setDocument((current) => ({ ...current, viewport: next }));
  };

  const finishPan = () => {
    if (!panState) return;
    setPanState(null);
    setSaveState("dirty");
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const current = document.viewport;
    const scale = Math.min(2.4, Math.max(.25, current.scale * Math.exp(-event.deltaY * .0012)));
    const worldX = (cursorX - current.x) / current.scale;
    const worldY = (cursorY - current.y) / current.scale;
    markDocument((value) => ({
      ...value,
      viewport: { scale, x: cursorX - worldX * scale, y: cursorY - worldY * scale },
    }));
  };

  const zoomBy = (factor: number) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    const current = document.viewport;
    const scale = Math.min(2.4, Math.max(.25, current.scale * factor));
    const worldX = (rect.width / 2 - current.x) / current.scale;
    const worldY = (rect.height / 2 - current.y) / current.scale;
    markDocument((value) => ({ ...value, viewport: { scale, x: rect.width / 2 - worldX * scale, y: rect.height / 2 - worldY * scale } }));
  };

  const resetViewport = () => markDocument((current) => ({ ...current, viewport: { x: 80, y: 60, scale: 1 } }));

  const generateOnCanvas = async () => {
    const intent = agentPrompt.trim();
    if (!intent || generating || !project) return;
    setGenerating(true);
    const nodeId = `image-${crypto.randomUUID()}`;
    const selectedSkill = agentSkills.find((skill) => skill.id === selectedSkillId);
    const selectedImageNode = selectedNode?.type === "image" && selectedNode.content ? selectedNode : null;
    const primaryRole = selectedSkill?.referenceRoles?.find((role) => role.required) || selectedSkill?.referenceRoles?.[0];
    const assignments = Object.fromEntries(Object.entries(skillRoleAssignments).map(([roleId, assets]) => [roleId, [...assets]]));
    if (primaryRole && selectedImageNode && !(assignments[primaryRole.id] || []).length) {
      assignments[primaryRole.id] = [{ id: selectedImageNode.id, url: selectedImageNode.content, title: selectedImageNode.title, mediaType: "image" }];
    }
    const missingRole = selectedSkill?.referenceRoles?.find((role) => role.required && !(assignments[role.id] || []).length);
    const assignedAssets = Object.values(assignments).flat();
    if (!selectedSkill && selectedImageNode) assignedAssets.push({ id: selectedImageNode.id, url: selectedImageNode.content, title: selectedImageNode.title, mediaType: "image" });
    const referenceAssets = Array.from(new Map(assignedAssets.map((asset) => [asset.id, asset])).values());
    if (missingRole) {
      toast.error(`Skill「${selectedSkill?.name}」缺少必填素材：${missingRole.label}`);
      setGenerating(false);
      return;
    }
    if (selectedSkill?.requiresReference && !referenceAssets.length) {
      toast.error(`Skill「${selectedSkill.name}」需要先添加参考素材`);
      setGenerating(false);
      return;
    }
    const roleAssetIds = Object.fromEntries(Object.entries(assignments).map(([roleId, assets]) => [roleId, assets.map((asset) => asset.id)]));
    try {
      const clientRequestId = crypto.randomUUID();
      const runResponse = await fetch("/api/creative-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent, mode: "image", surface: "canvas", projectId: project.id, clientRequestId,
          selectedSkillIds: selectedSkillId ? [selectedSkillId] : [],
          skillRunMode: "professional",
          skillReferenceRoleAssetIds: roleAssetIds,
          generationPreferences: {
            image: { aspectRatio: "auto", imageSize: "1K", quality: "smart", count: 1, customWidth: "", customHeight: "" },
            video: { aspectRatio: "auto", resolution: "720p", count: 1, seconds: 5, generateAudio: true, watermark: false, referenceMode: "reference" },
            audio: { voice: "智能匹配", format: "mp3", speed: 1 },
          },
        }),
      });
      const runPayload = await runResponse.json().catch(() => ({})) as { run?: { id?: string }; error?: string };
      if (!runResponse.ok || !runPayload.run?.id) throw new Error(runPayload.error || "画布 Agent Run 创建失败");
      const generationResponse = await fetch("/api/general-image", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `canvas:${clientRequestId}` },
        body: JSON.stringify({
          mode: referenceAssets.length ? "image-to-image" : "text-to-image",
          prompt: intent,
          user_prompt: intent,
          reference_urls: referenceAssets.map((asset) => asset.url),
          ai_model: "nano-banana-2",
          aspect_ratio: "auto",
          image_size: "1K",
          gen_count: 1,
          creative_run_id: runPayload.run.id,
          creative_step_key: "canvas-primary-image",
          creative_step_title: "画布 Agent 生成",
          canvas_node_id: nodeId,
        }),
      });
      const generation = await generationResponse.json().catch(() => ({})) as { generation_id?: string; error?: string };
      if (!generationResponse.ok || !generation.generation_id) throw new Error(generation.error || "画布生成提交失败");
      const urls = await pollCanvasGeneration(generation.generation_id);
      const position = centerPosition();
      const nodes = urls.map((url, index): CanvasNode => ({
        id: index === 0 ? nodeId : `image-${crypto.randomUUID()}`,
        type: "image",
        x: position.x + index * 40,
        y: position.y + index * 40,
        width: 340,
        height: 270,
        title: intent.slice(0, 48),
        content: url,
      }));
      markDocument((current) => ({ ...current, nodes: [...current.nodes, ...nodes] }));
      setSelectedNodeId(nodes[0]?.id || null);
      setAgentPrompt("");
      setSkillRoleAssignments({});
      setAgentOpen(false);
      toast.success("生成结果已加入画布");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "画布生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const selectedNode = useMemo(() => document.nodes.find((node) => node.id === selectedNodeId) || null, [document.nodes, selectedNodeId]);
  const activeCanvasSkill = agentSkills.find((skill) => skill.id === selectedSkillId);

  const selectCanvasRoleAssets = async (role: NonNullable<AgentSkill["referenceRoles"]>[number]) => {
    const current = skillRoleAssignments[role.id] || [];
    if (current.length >= role.maxCount) return toast.info(`${role.label}最多添加 ${role.maxCount} 项`);
    const selected = await openResourcePicker({
      title: `选择${role.label}`,
      role: `${activeCanvasSkill?.name || "Canvas Skill"} · ${role.label}`,
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

  const assignSelectedCanvasNode = (role: NonNullable<AgentSkill["referenceRoles"]>[number]) => {
    if (!selectedNode || selectedNode.type !== "image" || !selectedNode.content) return toast.info("请先在画布中选中一张图片");
    setSkillRoleAssignments((value) => {
      const current = value[role.id] || [];
      if (current.some((asset) => asset.id === selectedNode.id)) return value;
      if (current.length >= role.maxCount) return value;
      return { ...value, [role.id]: [...current, { id: selectedNode.id, url: selectedNode.content, title: selectedNode.title, mediaType: "image" }] };
    });
  };

  if (loading) return <div className={styles.editorLoading}><Loader2 className="animate-spin" aria-hidden="true" />正在加载画布…</div>;
  if (!project) return <div className={styles.editorLoading}><LayoutTemplate aria-hidden="true" />画布不存在或无权访问<Link href="/canvas">返回画布库</Link></div>;

  return (
    <main className={styles.editorPage}>
      <header className={styles.editorTopbar}>
        <div className={styles.editorBreadcrumb}>
          <Link href="/canvas" aria-label="返回画布库"><ArrowLeft aria-hidden="true" /></Link>
          <LayoutTemplate aria-hidden="true" />
          <ChevronRight aria-hidden="true" />
          <input value={title} maxLength={120} aria-label="画布名称" onChange={(event) => { setTitle(event.target.value); setSaveState("dirty"); }} />
        </div>
        <div className={styles.editorActions}>
          <span className={styles.saveStatus} data-error={saveState === "error" || undefined}>
            {saveState === "saving" ? <Loader2 className="animate-spin" aria-hidden="true" /> : saveState === "saved" ? <Check aria-hidden="true" /> : <Save aria-hidden="true" />}
            {saveState === "saving" ? "保存中" : saveState === "saved" ? "已保存" : saveState === "error" ? "保存失败" : "未保存"}
          </span>
          <Button variant="outline" onClick={() => void saveProject()} disabled={saveState === "saved" || saveState === "saving"}><Save aria-hidden="true" />保存</Button>
          <Button onClick={() => setAgentOpen((open) => !open)}><Sparkles aria-hidden="true" />Agent 生成</Button>
        </div>
      </header>

      <div className={styles.editorBody}>
        <aside className={styles.canvasToolbar} aria-label="画布工具">
          <button type="button" onClick={addTextNode}><StickyNote aria-hidden="true" /><span>便笺</span></button>
          <button type="button" onClick={() => void addAssets()}><ImagePlus aria-hidden="true" /><span>素材</span></button>
          <button type="button" data-active={agentOpen || undefined} onClick={() => setAgentOpen((open) => !open)}><Bot aria-hidden="true" /><span>Agent</span></button>
        </aside>

        <div
          ref={surfaceRef}
          className={styles.canvasSurface}
          data-panning={Boolean(panState) || undefined}
          onPointerDown={onSurfacePointerDown}
          onPointerMove={onSurfacePointerMove}
          onPointerUp={finishPan}
          onPointerCancel={finishPan}
          onWheel={onWheel}
        >
          <div className={styles.canvasWorld} style={{ transform: `translate(${document.viewport.x}px, ${document.viewport.y}px) scale(${document.viewport.scale})` }}>
            {document.nodes.map((node) => (
              <CanvasNodeView
                key={node.id}
                node={node}
                selected={selectedNodeId === node.id}
                scale={document.viewport.scale}
                onSelect={() => setSelectedNodeId(node.id)}
                onChange={(patch) => updateNode(node.id, patch)}
                onDelete={() => deleteNode(node.id)}
              />
            ))}
          </div>

          {!document.nodes.length ? (
            <div className={styles.canvasWelcome}>
              <span><LayoutTemplate aria-hidden="true" /></span>
              <strong>这是一张可以持续生长的画布</strong>
              <p>添加便笺或素材，也可以让 Agent 直接生成一个视觉节点。</p>
              <div><Button variant="outline" onClick={addTextNode}><StickyNote aria-hidden="true" />添加便笺</Button><Button onClick={() => setAgentOpen(true)}><Sparkles aria-hidden="true" />Agent 生成</Button></div>
            </div>
          ) : null}

          <div className={styles.zoomDock}>
            <button type="button" aria-label="缩小" onClick={() => zoomBy(.85)}><Minus aria-hidden="true" /></button>
            <span>{Math.round(document.viewport.scale * 100)}%</span>
            <button type="button" aria-label="放大" onClick={() => zoomBy(1.15)}><Plus aria-hidden="true" /></button>
            <button type="button" aria-label="复位画布" onClick={resetViewport}><LocateFixed aria-hidden="true" /></button>
          </div>
        </div>

        {agentOpen ? (
          <aside className={styles.agentPanel}>
            <header><div><span><Sparkles aria-hidden="true" />Canvas Agent</span><p>结果会直接成为画布节点</p></div><button type="button" aria-label="关闭 Agent" onClick={() => setAgentOpen(false)}><X aria-hidden="true" /></button></header>
            <div className={styles.agentPanelBody}>
              <div className={styles.agentContext}><Bot aria-hidden="true" /><div><strong>已读取当前画布</strong><span>{document.nodes.length} 个节点 · {document.nodes.filter((node) => node.type === "image").length} 张图片</span></div></div>
              {selectedNode ? <div className={styles.agentSelection}><span>当前选中</span><strong>{selectedNode.title}</strong></div> : null}
              {activeCanvasSkill?.referenceRoles?.length ? <section className={styles.canvasSkillRoles}><header><strong>{activeCanvasSkill.name}</strong><span>参考素材角色</span></header>{activeCanvasSkill.referenceRoles.map((role) => { const assets = skillRoleAssignments[role.id] || []; return <div key={role.id} className={styles.canvasSkillRole}><div><strong>{role.label} · {role.required ? "必填" : "可选"}</strong><span>{assets.length}/{role.maxCount}{role.description ? ` · ${role.description}` : ""}</span></div><div className={styles.canvasSkillRoleActions}><button type="button" onClick={() => assignSelectedCanvasNode(role)}>使用选中图</button><button type="button" onClick={() => void selectCanvasRoleAssets(role)}>资源库</button></div>{assets.length ? <div className={styles.canvasSkillRoleAssets}>{assets.map((asset) => <span key={asset.id}>{asset.title}<button type="button" aria-label={`移除${asset.title}`} onClick={() => setSkillRoleAssignments((value) => ({ ...value, [role.id]: (value[role.id] || []).filter((item) => item.id !== asset.id) }))}><X aria-hidden="true" /></button></span>)}</div> : null}</div>; })}</section> : null}
            </div>
            <div className={styles.agentComposer}>
              <label className={styles.agentSkillPicker}>
                <span>创作 Skill</span>
                <select value={selectedSkillId} onChange={(event) => { setSelectedSkillId(event.target.value); setSkillRoleAssignments({}); }}>
                  <option value="">不使用 Skill</option>
                  {agentSkills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
                </select>
              </label>
              <textarea value={agentPrompt} onChange={(event) => setAgentPrompt(event.target.value)} placeholder="描述要在画布中生成的画面…" maxLength={4000} />
              <Button onClick={() => void generateOnCanvas()} disabled={!agentPrompt.trim() || generating}>{generating ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}{generating ? "生成中" : "生成并加入画布"}</Button>
            </div>
          </aside>
        ) : null}
      </div>
    </main>
  );
}

function CanvasNodeView({
  node,
  selected,
  scale,
  onSelect,
  onChange,
  onDelete,
}: {
  node: CanvasNode;
  selected: boolean;
  scale: number;
  onSelect: () => void;
  onChange: (patch: Partial<CanvasNode>) => void;
  onDelete: () => void;
}) {
  const dragRef = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null);
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: node.x, y: node.y };
    onSelect();
  };
  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    onChange({ x: state.x + (event.clientX - state.clientX) / scale, y: state.y + (event.clientY - state.clientY) / scale });
  };
  const finish = () => { dragRef.current = null; };

  return (
    <article
      data-canvas-node
      data-selected={selected || undefined}
      data-node-type={node.type}
      className={styles.canvasNode}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      onPointerDown={(event) => { event.stopPropagation(); onSelect(); }}
    >
      <div className={styles.nodeHeader} onPointerDown={startDrag} onPointerMove={drag} onPointerUp={finish} onPointerCancel={finish}>
        <span>{node.type === "image" ? <ImagePlus aria-hidden="true" /> : <StickyNote aria-hidden="true" />}{node.title}</span>
        <button type="button" aria-label="删除节点" onPointerDown={(event) => event.stopPropagation()} onClick={onDelete}><Trash2 aria-hidden="true" /></button>
      </div>
      {node.type === "image" ? (
        <div className={styles.nodeImage}><Image src={node.content} alt={node.title} fill sizes={`${Math.round(node.width)}px`} className="object-contain" draggable={false} /></div>
      ) : (
        <textarea value={node.content} aria-label={node.title} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => onChange({ content: event.target.value })} />
      )}
    </article>
  );
}

async function pollCanvasGeneration(generationId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 12 * 60_000) {
    await new Promise((resolve) => window.setTimeout(resolve, 1800));
    const response = await fetch(`/api/general-image?generation_id=${encodeURIComponent(generationId)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { status?: string; status_group?: string; result_urls?: string[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "任务状态查询失败");
    if (payload.status_group === "completed" || payload.status === "completed") return Array.isArray(payload.result_urls) ? payload.result_urls : [];
    if (payload.status_group === "failed" || ["failed", "cancelled", "needs_review"].includes(payload.status || "")) throw new Error(payload.error || "生成失败");
  }
  throw new Error("任务仍在后台执行，请稍后回到画布查看");
}
