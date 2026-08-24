"use client";

import JSZip from "jszip";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Download, FileUp, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useStudioAuth } from "@/components/studio/useStudioAuth";
import type { CanvasDocument, CanvasProject } from "@/lib/canvas-contract";
import { replaceLegacyCanvasBrand, SITE_NAME } from "@/lib/site-brand";

/** Pixel Diffusion canvas library, adapted to the host canvas project API. */
export function CanvasLibrary() {
  const { authChecked, isAuthenticated } = useStudioAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState("");
  const [editingTitle, setEditingTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [working, setWorking] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/canvas-projects", { cache: "no-store" });
      if (response.status === 401) { setProjects([]); return; }
      const payload = await response.json().catch(() => ({})) as { projects?: CanvasProject[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "画布列表加载失败");
      setProjects(Array.isArray(payload.projects) ? payload.projects.map((project) => ({ ...project, title: replaceLegacyCanvasBrand(project.title) })) : []);
    } catch (error) { toast.error(error instanceof Error ? error.message : "画布列表加载失败"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    if (!isAuthenticated) { setLoading(false); return; }
    void loadProjects();
  }, [authChecked, isAuthenticated, loadProjects]);

  const createProject = async (title = `${SITE_NAME} 画布 ${projects.length + 1}`, document?: CanvasDocument) => {
    if (!isAuthenticated) { window.location.href = `/login?next=${encodeURIComponent("/canvas")}`; return null; }
    setCreating(true);
    try {
      const response = await fetch("/api/canvas-projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, ...(document ? { document } : {}) }) });
      const payload = await response.json().catch(() => ({})) as { project?: CanvasProject; error?: string };
      if (!response.ok || !payload.project) throw new Error(payload.error || "画布创建失败");
      return payload.project;
    } catch (error) { toast.error(error instanceof Error ? error.message : "画布创建失败"); return null; }
    finally { setCreating(false); }
  };

  const createAndEnter = async () => {
    const project = await createProject();
    if (project) window.location.href = `/canvas/${project.id}`;
  };

  const renameProject = async (project: CanvasProject) => {
    const title = editingTitle.trim();
    if (!title || title === project.title) { setEditingId(""); return; }
    try {
      const response = await fetch(`/api/canvas-projects/${encodeURIComponent(project.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, revision: project.revision }) });
      const payload = await response.json().catch(() => ({})) as { project?: CanvasProject; error?: string };
      if (!response.ok || !payload.project) throw new Error(payload.error || "画布重命名失败");
      setProjects((items) => items.map((item) => item.id === project.id ? payload.project! : item));
      setEditingId("");
    } catch (error) { toast.error(error instanceof Error ? error.message : "画布重命名失败"); }
  };

  const deleteProjects = async (ids: string[]) => {
    if (!ids.length || !window.confirm(`确认删除 ${ids.length} 个画布？此操作无法撤销。`)) return;
    setWorking(true);
    try {
      for (const id of ids) {
        const response = await fetch(`/api/canvas-projects/${encodeURIComponent(id)}`, { method: "DELETE" });
        const payload = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(payload.error || "画布删除失败");
      }
      setProjects((items) => items.filter((item) => !ids.includes(item.id)));
      setSelectedIds((items) => items.filter((id) => !ids.includes(id)));
      toast.success(ids.length > 1 ? `已删除 ${ids.length} 个画布` : "画布已删除");
    } catch (error) { toast.error(error instanceof Error ? error.message : "画布删除失败"); }
    finally { setWorking(false); }
  };

  const exportSelected = async () => {
    const selected = projects.filter((project) => selectedIds.includes(project.id));
    if (!selected.length) return;
    setWorking(true);
    try {
      const zip = new JSZip();
      zip.file("projects.json", JSON.stringify({ app: "pixel-diffusion-canvas", version: 1, projects: selected.map(({ id: _id, ...project }) => project) }, null, 2));
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `canvas-projects-${new Date().toISOString().slice(0, 10)}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch { toast.error("画布导出失败"); }
    finally { setWorking(false); }
  };

  const importCanvas = async (file?: File) => {
    if (!file) return;
    setWorking(true);
    try {
      const zip = await JSZip.loadAsync(file);
      const entry = zip.file("projects.json");
      if (!entry) throw new Error("缺少 projects.json");
      const payload = JSON.parse(await entry.async("string")) as { projects?: Array<{ title?: string; document?: CanvasDocument }> };
      if (!Array.isArray(payload.projects) || !payload.projects.length) throw new Error("画布包为空");
      for (const item of payload.projects.slice(0, 20)) await createProject(item.title || "导入画布", item.document);
      await loadProjects();
      toast.success(`已导入 ${Math.min(payload.projects.length, 20)} 个画布`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "导入失败，请选择有效的画布压缩包"); }
    finally { setWorking(false); if (inputRef.current) inputRef.current.value = ""; }
  };

  return (
    <main className="min-h-[calc(100vh-64px)] overflow-auto bg-white text-stone-950 dark:bg-[#111316] dark:text-stone-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-2 py-2 sm:gap-6 sm:px-6 sm:py-8">
        <header className="flex flex-wrap items-end justify-between gap-2.5 border-b border-stone-200 pb-3 sm:gap-4 sm:pb-5 dark:border-stone-800">
          <div><p className="text-xs text-stone-500">画布库</p><h1 className="mt-1 text-xl font-semibold sm:mt-2 sm:text-2xl">我的画布</h1></div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedIds.length ? <><ActionButton disabled={working} onClick={() => void exportSelected()}><Download className="size-4" />导出选中</ActionButton><ActionButton disabled={working} onClick={() => void deleteProjects(selectedIds)}>删除选中</ActionButton></> : null}
            {projects.length ? <ActionButton disabled={working} onClick={() => void deleteProjects(projects.map((project) => project.id))}>删除当前页</ActionButton> : null}
            <ActionButton disabled={working} onClick={() => inputRef.current?.click()}><FileUp className="size-4" />导入画布</ActionButton>
            <button type="button" disabled={creating || working} className="inline-flex h-9 items-center gap-2 rounded-md bg-stone-950 px-3.5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white" onClick={() => void createAndEnter()}>{creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}新建画布</button>
          </div>
        </header>

        {loading ? <CanvasState><Loader2 className="size-5 animate-spin" /><span>正在加载画布...</span></CanvasState> : projects.length ? (
          <section className="grid gap-2 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3" aria-label="我的画布">
            {projects.map((project) => <ProjectCard key={project.id} project={project} selected={selectedIds.includes(project.id)} editing={editingId === project.id} editingTitle={editingTitle} onSelect={(checked) => setSelectedIds((ids) => checked ? [...new Set([...ids, project.id])] : ids.filter((id) => id !== project.id))} onStartEdit={() => { setEditingId(project.id); setEditingTitle(project.title); }} onEditTitle={setEditingTitle} onSave={() => void renameProject(project)} onCancel={() => setEditingId("")} onDelete={() => void deleteProjects([project.id])} />)}
          </section>
        ) : <CanvasState><h2 className="text-lg font-medium sm:text-xl">还没有画布</h2><p className="mt-1.5 text-xs text-stone-500 sm:mt-3 sm:text-sm">新建一个画布后，就可以独立保存节点、连线和画布外观。</p><button type="button" className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-stone-950 px-3 text-xs font-medium text-white dark:bg-stone-100 dark:text-stone-950 sm:mt-5" onClick={() => void createAndEnter()}><Plus className="size-4" />新建画布</button></CanvasState>}
      </div>
      <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
    </main>
  );
}

function ActionButton({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} className="inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-[#181b20] dark:text-stone-200 dark:hover:bg-[#242930]" onClick={onClick}>{children}</button>;
}

function CanvasState({ children }: { children: React.ReactNode }) {
  return <section className="flex min-h-24 flex-col items-center justify-center gap-2 border-y border-stone-200 px-3 py-5 text-center text-sm text-stone-500 sm:min-h-56 sm:py-8 dark:border-stone-800">{children}</section>;
}

function ProjectCard({ project, selected, editing, editingTitle, onSelect, onStartEdit, onEditTitle, onSave, onCancel, onDelete }: { project: CanvasProject; selected: boolean; editing: boolean; editingTitle: string; onSelect: (checked: boolean) => void; onStartEdit: () => void; onEditTitle: (value: string) => void; onSave: () => void; onCancel: () => void; onDelete: () => void }) {
  return <article className="group flex min-h-0 cursor-pointer flex-col justify-between rounded-lg border border-stone-200 bg-white p-2.5 text-stone-950 transition hover:border-stone-300 hover:bg-stone-50/60 sm:min-h-44 sm:p-5 dark:border-stone-800 dark:bg-[#181b20] dark:text-stone-100 dark:hover:border-stone-700 dark:hover:bg-[#1d2127]" onClick={() => { if (!editing) window.location.href = `/canvas/${project.id}`; }}><div className="flex items-start gap-3"><input type="checkbox" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelect(event.target.checked)} className="mt-1 size-4 accent-stone-950 dark:accent-stone-100" aria-label={`选择 ${project.title}`} />{editing ? <input value={editingTitle} onClick={(event) => event.stopPropagation()} onChange={(event) => onEditTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSave(); if (event.key === "Escape") onCancel(); }} autoFocus className="h-9 min-w-0 flex-1 rounded-md border border-stone-300 bg-transparent px-2 text-sm outline-none focus:border-stone-500 dark:border-stone-700" /> : <Link href={`/canvas/${project.id}`} className="min-w-0" onClick={(event) => event.stopPropagation()}><h2 className="truncate text-base font-semibold sm:text-xl">{project.title}</h2><p className="mt-1.5 text-xs leading-5 text-stone-600 sm:mt-3 sm:text-sm sm:leading-6 dark:text-stone-400">{project.nodeCount} 个节点 · {project.document.edges.length} 条连线</p></Link>}</div><div className="mt-2 flex items-end justify-between gap-3 sm:mt-8"><p className="text-xs text-stone-500 dark:text-stone-400">更新于 {formatDate(project.updatedAt)}</p><div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>{editing ? <><IconButton label="保存名称" onClick={onSave}><Check className="size-4" /></IconButton><IconButton label="取消重命名" onClick={onCancel}><X className="size-4" /></IconButton></> : <><IconButton label="重命名" onClick={onStartEdit}><Pencil className="size-4" /></IconButton><IconButton label="删除" onClick={onDelete}><Trash2 className="size-4" /></IconButton></>}</div></div></article>;
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className="grid size-8 place-items-center rounded-full text-stone-500 transition hover:bg-stone-200/70 hover:text-stone-950 dark:hover:bg-stone-700 dark:hover:text-white" aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "刚刚" : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
