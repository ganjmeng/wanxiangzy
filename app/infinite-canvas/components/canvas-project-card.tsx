"use client";

import { Check, Download, GitBranch, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCanvasStore, type CanvasProject } from "../stores/use-canvas-store";
import { useCanvasUiStore } from "../stores/use-canvas-ui-store";
import { exportCanvasProjects } from "../utils/canvas-export";
import { CanvasProjectThumbnail } from "./canvas-project-thumbnail";

function formatRelativeTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} 天前`;
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}

export function CanvasProjectCard({ project }: { project: CanvasProject }) {
    const router = useRouter();
    const renameProject = useCanvasStore((state) => state.renameProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const editingId = useCanvasUiStore((state) => state.editingProjectId);
    const editingTitle = useCanvasUiStore((state) => state.editingProjectTitle);
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const editing = editingId === project.id;
    const selected = selectedIds.includes(project.id);
    const open = () => router.push(`/infinite-canvas/${project.id}`);
    const saveTitle = () => {
        renameProject(project.id, editingTitle);
        stopEditing();
    };

    return (
        <div
            className={cn(
                "group relative flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white transition hover:border-slate-400",
                selected && "border-slate-900 ring-1 ring-slate-900",
            )}
        >
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-3 py-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500" onClick={(event) => event.stopPropagation()}>
                    <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => toggleSelected(project.id, event.target.checked)}
                        aria-label={`选择 ${project.title}`}
                        className="size-3.5 cursor-pointer rounded border-slate-300 accent-slate-900"
                    />
                    <span>{project.nodes.length} 节点 · {project.connections.length} 连线</span>
                </label>
                <div className="opacity-0 transition group-hover:opacity-100" onClick={(event) => event.stopPropagation()}>
                    <Button variant="ghost" size="icon-sm" onClick={() => void exportCanvasProjects([project], project.title || "无限画布")} aria-label="导出">
                        <Download className="size-3.5" />
                    </Button>
                </div>
            </div>
            <button type="button" onClick={() => !editing && open()} className="block w-full text-left focus:outline-none">
                <div className="aspect-[16/9] w-full overflow-hidden border-b border-slate-100 bg-slate-50">
                    <CanvasProjectThumbnail nodes={project.nodes} connections={project.connections} />
                </div>
                <div className="px-3 py-3">
                    {editing ? (
                        <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                            <input
                                autoFocus
                                value={editingTitle}
                                onChange={(event) => setEditingTitle(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") saveTitle();
                                    if (event.key === "Escape") stopEditing();
                                }}
                                className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-medium text-slate-900 outline-none focus:border-slate-900"
                            />
                            <button type="button" onClick={saveTitle} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="保存">
                                <Check className="size-4" />
                            </button>
                            <button type="button" onClick={stopEditing} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="取消">
                                <X className="size-4" />
                            </button>
                        </div>
                    ) : (
                        <div className="truncate text-sm font-medium text-slate-900">{project.title}</div>
                    )}
                    <div className="mt-1.5 flex items-center gap-1 text-xs text-slate-500">
                        <GitBranch className="size-3" />
                        <span>{formatRelativeTime(project.updatedAt)}</span>
                    </div>
                </div>
            </button>
            <div className="pointer-events-none absolute right-2 top-2 hidden opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 group-hover:flex" onClick={(event) => event.stopPropagation()}>
                {!editing && (
                    <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white/95 p-0.5 shadow-sm backdrop-blur">
                        <button type="button" onClick={() => startEditing(project.id, project.title)} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="重命名">
                            <Pencil className="size-3.5" />
                        </button>
                        <button type="button" onClick={() => setDeleteIds([project.id])} className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600" aria-label="删除">
                            <Trash2 className="size-3.5" />
                        </button>
                        <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="更多">
                            <MoreHorizontal className="size-3.5" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
