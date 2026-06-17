"use client";

import { CloudOff, Download, FileUp, Plus, Search, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { cn } from "@/lib/utils";
import { CanvasDeleteProjectsDialog } from "./components/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "./components/canvas-project-card";
import type { CanvasExportFile } from "./export-types";
import { useCanvasStore } from "./stores/use-canvas-store";
import { useCanvasUiStore } from "./stores/use-canvas-ui-store";
import { exportCanvasProjects } from "./utils/canvas-export";
import { buildExampleProject } from "./utils/example-project";

type SortKey = "updated" | "nodes";

export default function CanvasPage() {
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);
    const seededRef = useRef(false);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const syncStatus = useCanvasStore((state) => state.syncStatus);
    const syncError = useCanvasStore((state) => state.syncError);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const syncProjects = useCanvasStore((state) => state.syncProjects);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const clearSelection = useCanvasUiStore((state) => state.removeSelectedProjectIds);

    const [keyword, setKeyword] = useState("");
    const [sort, setSort] = useState<SortKey>("updated");

    useEffect(() => {
        if (hydrated) void syncProjects();
    }, [hydrated, syncProjects]);

    useEffect(() => {
        if (!hydrated || seededRef.current || projects.length > 0) return;
        seededRef.current = true;
        const example = buildExampleProject();
        importProject({ ...example, title: example.title });
    }, [hydrated, projects.length, importProject]);

    const enterProject = (id: string) => {
        router.push(`/infinite-canvas/${id}`);
    };

    const createAndEnter = () => {
        enterProject(createProject(`未命名画布 ${projects.length + 1}`));
    };

    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            await Promise.all(
                data.projects.flatMap((project) =>
                    project.files.map(async (item) => {
                        const blob = zip.get(item.path);
                        if (!blob) return;
                        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
                        await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
                    }),
                ),
            );
            data.projects.forEach((item) => importProject(item.project));
            toast.success(`已导入 ${data.projects.length} 个画布`);
        } catch {
            toast.error("导入失败，请选择有效的画布压缩包");
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    const filtered = useMemo(() => {
        const normalized = keyword.trim().toLowerCase();
        const list = normalized ? projects.filter((project) => project.title.toLowerCase().includes(normalized)) : projects;
        return [...list].sort((a, b) => {
            if (sort === "nodes") return b.nodes.length - a.nodes.length;
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });
    }, [projects, keyword, sort]);

    const selectedProjects = projects.filter((project) => selectedIds.includes(project.id));

    return (
        <main className="min-h-[calc(100vh-64px)] bg-white text-slate-900">
            <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 px-6 py-8">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
                    <div className="min-w-0">
                        <h1 className="text-xl font-semibold tracking-tight text-slate-900">画布</h1>
                        <p className="mt-1 text-sm text-slate-500">
                            管理你的画布项目，本地即时保存{hydrated ? `，共 ${projects.length} 个` : ""}
                            <SyncStatusLabel status={syncStatus} error={syncError} />
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {selectedIds.length ? (
                            <>
                                <Button variant="outline" size="sm" disabled={!hydrated} onClick={() => void exportCanvasProjects(selectedProjects, `无限画布-${selectedIds.length}个项目`)}>
                                    <Download className="size-3.5" />
                                    导出 {selectedIds.length}
                                </Button>
                                <Button variant="outline" size="sm" disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>
                                    <Trash2 className="size-3.5" />
                                    删除 {selectedIds.length}
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => clearSelection(selectedIds)}>
                                    <X className="size-3.5" />
                                    取消
                                </Button>
                                <div className="mx-1 h-5 w-px bg-slate-200" />
                            </>
                        ) : null}
                        {projects.length ? (
                            <Button variant="outline" size="sm" disabled={!hydrated} onClick={() => setDeleteIds(projects.map((project) => project.id))}>
                                <Trash2 className="size-3.5" />
                                删除全部
                            </Button>
                        ) : null}
                        <Button variant="outline" size="sm" disabled={!hydrated} onClick={() => inputRef.current?.click()}>
                            <FileUp className="size-3.5" />
                            导入
                        </Button>
                        <Button size="sm" disabled={!hydrated} onClick={createAndEnter} className="bg-slate-900 text-white hover:bg-slate-800">
                            <Plus className="size-3.5" />
                            新建画布
                        </Button>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                        <input
                            value={keyword}
                            onChange={(event) => setKeyword(event.target.value)}
                            placeholder="搜索画布…"
                            className="h-8 w-56 rounded-md border border-slate-200 bg-white pl-8 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-1 focus:ring-slate-200"
                        />
                    </div>
                    <div className="flex items-center rounded-md border border-slate-200 bg-white p-0.5 text-xs text-slate-600">
                        {(["updated", "nodes"] as const).map((option) => (
                            <button
                                key={option}
                                type="button"
                                onClick={() => setSort(option)}
                                className={cn(
                                    "rounded px-2.5 py-1 transition",
                                    sort === option ? "bg-slate-900 text-white" : "hover:text-slate-900",
                                )}
                            >
                                {option === "updated" ? "最近修改" : "节点最多"}
                            </button>
                        ))}
                    </div>
                </div>

                {!hydrated ? (
                    <CanvasProjectSkeleton />
                ) : filtered.length ? (
                    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {filtered.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} />
                        ))}
                    </section>
                ) : (
                    <EmptyState
                        className="min-h-[420px] rounded-lg border border-dashed border-slate-200 bg-white"
                        icon={Plus}
                        title={keyword ? "没有匹配的画布" : "还没有画布"}
                        description={keyword ? "试试清除搜索条件，或者新建一个画布。" : "新建一个画布后，就可以独立保存节点、连线和画布外观。"}
                        action={
                            <Button onClick={createAndEnter} className="bg-slate-900 text-white hover:bg-slate-800">
                                <Plus className="size-4" />
                                新建画布
                            </Button>
                        }
                    />
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}

function SyncStatusLabel({ status, error }: { status: string; error: string | null }) {
    if (status === "syncing") return <span className="ml-2 text-slate-400">· 同步中…</span>;
    if (status === "synced") return <span className="ml-2 text-emerald-600">· 已同步</span>;
    if (status === "error") {
        return (
            <span className="ml-2 text-red-600" title={error || "同步失败"}>
                · 同步失败
            </span>
        );
    }
    return (
        <span className="ml-2 inline-flex items-center gap-1 text-slate-400" title={error || "本地模式"}>
            <CloudOff className="size-3" />
            本地模式
        </span>
    );
}

function CanvasProjectSkeleton() {
    return (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <div className="border-b border-slate-100 bg-slate-50/60 px-3 py-2">
                        <Skeleton className="h-3 w-32" />
                    </div>
                    <div className="aspect-[16/9] w-full">
                        <Skeleton className="h-full w-full rounded-none" />
                    </div>
                    <div className="space-y-2 p-3">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-1/3" />
                    </div>
                </div>
            ))}
        </section>
    );
}
