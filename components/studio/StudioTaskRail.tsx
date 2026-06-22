"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Grid2X2,
  History,
  ImageIcon,
  Layers3,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { getImageVariantUrl } from "@/lib/image-variants";
import { isLikelyVideoUrl } from "@/lib/media";
import { cn } from "@/lib/utils";
import type { TaskDisplayMode, TaskQueueItem, TaskQueuePayload, TaskQueueSummary } from "@/lib/task-queue";
import { isTaskRunning, TASK_DISPLAY_MODE_KEY } from "@/lib/task-queue";
import {
  EMPTY_TASK_QUEUE_SUMMARY,
  TASK_QUEUE_CONTINUE_ID,
  TASK_QUEUE_PAGE_SIZE,
  TASK_QUEUE_RECENT_LIMIT,
  getEmptyTaskQueueModuleState,
  useTaskQueueStore,
} from "@/lib/task-queue-client-store";
import { useTaskSelectionSession, type TaskSelectionSession } from "@/components/studio/useTaskSelectionSession";

type StudioTaskRailProps = {
  module: string;
  moduleLabel?: string;
  onContinue?: () => void;
  onSelectTask?: (item: TaskQueueItem, session: TaskSelectionSession) => void | Promise<void>;
  className?: string;
};

type TaskQueueLoadResult = {
  rowCount: number;
  hasMore: boolean;
} | null;

const TASK_QUEUE_FETCH_TIMEOUT_MS = 12_000;
const TASK_RAIL_RUNNING_POLL_MS = 20_000;
const TASK_RAIL_IDLE_POLL_MS = 180_000;
const TASK_RAIL_IDLE_CACHE_GRACE_MS = 120_000;
const TASK_RAIL_MIN_LOAD_GAP_MS = 15_000;

export function StudioTaskRail({
  module,
  moduleLabel = "当前模块",
  onContinue,
  onSelectTask,
  className,
}: StudioTaskRailProps) {
  const moduleState = useTaskQueueStore((state) => state.modules[module]);
  const hydrateModule = useTaskQueueStore((state) => state.hydrateModule);
  const applyServerRows = useTaskQueueStore((state) => state.applyServerRows);
  const setModuleLoadingFailed = useTaskQueueStore((state) => state.setModuleLoadingFailed);
  const setSelectedTask = useTaskQueueStore((state) => state.setSelectedTask);
  const clearSelectedTask = useTaskQueueStore((state) => state.clearSelectedTask);
  const { rows, summary, hasLoaded, loadError, selectedId, lastLoadedAt, refreshVersion } =
    moduleState || getEmptyTaskQueueModuleState();
  const [expanded, setExpanded] = useState(false);
  const [moduleOnly, setModuleOnly] = useState(true);
  const [displayMode, setDisplayMode] = useState<TaskDisplayMode>("flat");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const loadInFlightRef = useRef(false);
  const lastLoadStartedAtRef = useRef(0);
  const autoSelectSignatureRef = useRef("");
  const runningSelectionRef = useRef<string | null>(null);
  const localSelectionRef = useRef<string | null>(null);
  const initialSelectionSettledRef = useRef(false);
  const handledRefreshVersionRef = useRef(0);
  const {
    pendingId: applyingId,
    begin: beginSelection,
    cancel: cancelSelection,
  } = useTaskSelectionSession();

  const hasRunningTask = rows.some(isTaskRunning);
  const queueSnapshotRef = useRef({
    rows,
    hasLoaded,
    expanded,
    moduleOnly,
    query,
    nextCursor,
    lastLoadedAt,
  });
  queueSnapshotRef.current = {
    rows,
    hasLoaded,
    expanded,
    moduleOnly,
    query,
    nextCursor,
    lastLoadedAt,
  };

  const loadQueue = useCallback(async (options?: { append?: boolean; force?: boolean }): Promise<TaskQueueLoadResult> => {
    const snapshot = queueSnapshotRef.current;
    const append = Boolean(options?.append);
    const force = Boolean(options?.force);
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return null;
    if (loadInFlightRef.current) return null;
    if (append && !snapshot.nextCursor) return null;
    const now = Date.now();
    if (!append && !force && snapshot.hasLoaded && now - lastLoadStartedAtRef.current < TASK_RAIL_MIN_LOAD_GAP_MS) return null;
    lastLoadStartedAtRef.current = now;
    loadInFlightRef.current = true;
    if (!snapshot.hasLoaded || append || force) setLoading(true);
    try {
      const isExpanded = snapshot.expanded;
      const isModuleOnly = snapshot.moduleOnly;
      const searchQuery = snapshot.query.trim();
      const params = new URLSearchParams();
      params.set("limit", isExpanded ? String(TASK_QUEUE_PAGE_SIZE) : String(TASK_QUEUE_RECENT_LIMIT));
      if (!isExpanded) params.set("summary", "0");
      if (append && snapshot.nextCursor) params.set("cursor", snapshot.nextCursor);
      if (!isExpanded || isModuleOnly) params.set("module", module);
      if (isExpanded && searchQuery) params.set("q", searchQuery);

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), TASK_QUEUE_FETCH_TIMEOUT_MS);
      const res = await fetch(`/api/task-queue?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      }).finally(() => window.clearTimeout(timeout));
      const payload = await res.json().catch(() => ({})) as TaskQueuePayload;
      if (!res.ok) throw new Error("task queue request failed");

      const nextRows = Array.isArray(payload.rows) ? payload.rows : [];
      const currentRows = queueSnapshotRef.current.rows;
      const keepCurrentRowsOnEmpty = !append && !isExpanded && isModuleOnly && !searchQuery && nextRows.length === 0;
      if (!(keepCurrentRowsOnEmpty && currentRows.length > 0)) {
        applyServerRows(module, nextRows, normalizeSummary(payload), {
          append,
          preserveLocal: !append && !isExpanded && isModuleOnly && !searchQuery,
        });
      } else {
        setModuleLoadingFailed(module, false);
      }
      setHasMore(Boolean(payload.hasMore));
      const resolvedNextCursor = typeof payload.nextCursor === "string" && payload.nextCursor ? payload.nextCursor : null;
      queueSnapshotRef.current = { ...queueSnapshotRef.current, nextCursor: resolvedNextCursor };
      setNextCursor(resolvedNextCursor);

      const nextSummary = normalizeSummary(payload);
      if (keepCurrentRowsOnEmpty && currentRows.length > 0) {
        applyServerRows(module, currentRows, nextSummary, {
          append: false,
          preserveLocal: true,
        });
      }
      return { rowCount: nextRows.length, hasMore: Boolean(payload.hasMore) };
    } catch (error) {
      console.warn("[task-rail] queue load failed:", error instanceof Error ? error.message : error);
      setModuleLoadingFailed(module, true);
      return null;
    } finally {
      loadInFlightRef.current = false;
      setLoading(false);
    }
  }, [applyServerRows, module, setModuleLoadingFailed]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TASK_DISPLAY_MODE_KEY);
      if (saved === "flat" || saved === "grouped") setDisplayMode(saved);
    } catch {
      // Local storage can be unavailable in private contexts.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(TASK_DISPLAY_MODE_KEY, displayMode);
    } catch {
      // Best-effort preference persistence.
    }
  }, [displayMode]);

  useEffect(() => {
    setPage(1);
    setHasMore(false);
    queueSnapshotRef.current = { ...queueSnapshotRef.current, nextCursor: null };
    setNextCursor(null);
  }, [displayMode, expanded, moduleOnly, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadQueue({ force: expanded });
    }, query.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [expanded, loadQueue, module, moduleOnly, query]);

  useEffect(() => {
    handledRefreshVersionRef.current = 0;
    localSelectionRef.current = null;
    initialSelectionSettledRef.current = false;
    hydrateModule(module);
  }, [hydrateModule, module]);

  useEffect(() => {
    if (refreshVersion <= handledRefreshVersionRef.current) return;
    handledRefreshVersionRef.current = refreshVersion;
    void loadQueue({ force: true });
  }, [loadQueue, refreshVersion]);

  useEffect(() => {
    const pollMs = hasRunningTask ? TASK_RAIL_RUNNING_POLL_MS : TASK_RAIL_IDLE_POLL_MS;
    const snapshot = queueSnapshotRef.current;
    const cacheIsFreshEnough = Date.now() - snapshot.lastLoadedAt < TASK_RAIL_IDLE_CACHE_GRACE_MS;
    if (!snapshot.hasLoaded || !cacheIsFreshEnough) {
      void loadQueue();
    }
    const timer = window.setInterval(() => {
      void loadQueue();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [hasRunningTask, loadQueue]);

  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === "hidden") return;
      loadQueue();
    };
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [loadQueue]);

  const recentRows = useMemo(
    () => rows.filter((item) => item.module === module).slice(0, TASK_QUEUE_RECENT_LIMIT),
    [rows, module]
  );

  const expandedRows = useMemo(() => rows.slice(), [rows]);
  const totalPages = Math.max(1, Math.ceil(expandedRows.length / TASK_QUEUE_PAGE_SIZE));
  const pagedRows = expandedRows.slice((page - 1) * TASK_QUEUE_PAGE_SIZE, page * TASK_QUEUE_PAGE_SIZE);
  const visibleRows = expanded ? pagedRows : recentRows;
  const initialLoading = !hasLoaded && rows.length === 0;
  const loadedCount = expandedRows.length;
  const canGoPreviousPage = page > 1;
  const canGoNextLoadedPage = page < totalPages;
  const canGoNextPage = canGoNextLoadedPage || hasMore;

  useEffect(() => {
    if (initialSelectionSettledRef.current) return;
    if (selectedId === TASK_QUEUE_CONTINUE_ID) {
      initialSelectionSettledRef.current = true;
      return;
    }
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("apply")) {
      initialSelectionSettledRef.current = true;
      return;
    }
    if (!hasLoaded && rows.length === 0) return;

    initialSelectionSettledRef.current = true;
    if (localSelectionRef.current === selectedId) return;
    autoSelectSignatureRef.current = "";
    runningSelectionRef.current = null;
    clearSelectedTask(module);
    onContinue?.();
  }, [clearSelectedTask, hasLoaded, module, onContinue, rows.length, selectedId]);

  useEffect(() => {
    if (!onSelectTask || selectedId === TASK_QUEUE_CONTINUE_ID) {
      autoSelectSignatureRef.current = "";
      runningSelectionRef.current = null;
      return;
    }
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("apply")) return;
    const selected = rows.find((item) => item.id === selectedId);
    if (!selected) return;

    const running = isTaskRunning(selected);
    const shouldNotifyCompletion = runningSelectionRef.current === selected.id && !running;
    const signature = getTaskSelectionSignature(selected);
    if (running || !shouldNotifyCompletion) return;
    if (signature === autoSelectSignatureRef.current) return;

    autoSelectSignatureRef.current = signature;
    runningSelectionRef.current = null;

    const session = beginSelection(selected.id, "completion");
    void Promise.resolve(onSelectTask(selected, session))
      .catch((error) => {
        if (!session.isCurrent()) return;
        console.error("Task auto selection failed", error);
        toast.error(error instanceof Error ? error.message : "任务套用失败，请手动重试");
      })
      .finally(session.finish);
  }, [beginSelection, rows, onSelectTask, selectedId]);

  const handleSelect = (item: TaskQueueItem) => {
    localSelectionRef.current = item.id;
    autoSelectSignatureRef.current = getTaskSelectionSignature(item);
    runningSelectionRef.current = isTaskRunning(item) ? item.id : null;
    setSelectedTask(module, item.id);
    if (!onSelectTask) return;

    const session = beginSelection(item.id, "manual");
    void Promise.resolve(onSelectTask(item, session))
      .catch((error) => {
        if (!session.isCurrent()) return;
        console.error("Task selection failed", error);
        toast.error(error instanceof Error ? error.message : "任务套用失败，请重试");
      })
      .finally(session.finish);
  };

  const handleContinue = () => {
    cancelSelection();
    autoSelectSignatureRef.current = "";
    runningSelectionRef.current = null;
    localSelectionRef.current = null;
    clearSelectedTask(module);
    onContinue?.();
  };

  const handleNextPage = async () => {
    if (canGoNextLoadedPage) {
      setPage((value) => Math.min(totalPages, value + 1));
      return;
    }
    if (!hasMore || loading) return;
    const result = await loadQueue({ append: true, force: true });
    if (result?.rowCount) {
      setPage((value) => value + 1);
    }
  };

  return (
    <aside
      className={cn(
        "studio-task-rail",
        expanded && "studio-task-rail-expanded",
        initialLoading && "studio-task-rail-loading",
        className
      )}
      aria-label="任务列表"
      aria-busy={initialLoading || loading}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div
          className={cn(
            "flex items-center justify-between border-b border-slate-100 py-3",
            expanded ? "gap-2 px-3" : "gap-0.5 px-1.5"
          )}
        >
          <div className={cn("min-w-0 flex-1", !expanded && "flex justify-center")}>
            <div className={cn("flex items-center font-black text-slate-900", expanded ? "gap-1.5 text-sm" : "justify-center text-center text-[12px] leading-4")}>
              {expanded && <History className="h-4 w-4 text-zinc-900" />}
              <span className="whitespace-nowrap">{expanded ? "全部任务" : "最近任务"}</span>
            </div>
            {expanded && (
              <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-400">
                {moduleOnly ? moduleLabel : "全部模块"} · {summary.totalTaskNum} 个任务
              </p>
            )}
          </div>
          {expanded && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              aria-label="收起全部任务"
              title="收起全部任务"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {expanded ? (
          <div className="space-y-3 border-b border-slate-100 px-3 py-3">
            <label className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-500">
              <Search className="h-3.5 w-3.5" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-0 flex-1 bg-transparent font-semibold text-slate-700 outline-none placeholder:text-slate-300"
                placeholder="搜索任务号"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <SegmentButton active={moduleOnly} onClick={() => setModuleOnly(true)}>
                {moduleLabel}
              </SegmentButton>
              <SegmentButton active={!moduleOnly} onClick={() => setModuleOnly(false)}>
                全部模块
              </SegmentButton>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <SegmentButton active={displayMode === "flat"} onClick={() => setDisplayMode("flat")} icon={<Grid2X2 className="h-3.5 w-3.5" />}>
                平铺图片
              </SegmentButton>
              <SegmentButton active={displayMode === "grouped"} onClick={() => setDisplayMode("grouped")} icon={<Layers3 className="h-3.5 w-3.5" />}>
                任务拼图
              </SegmentButton>
            </div>
          </div>
        ) : null}

        <div className={cn("min-h-0 flex-1 overflow-y-auto custom-scroll", expanded ? "space-y-2 px-3 py-3" : "space-y-2 px-2 py-2")}>
          {initialLoading ? (
            <>
              {!expanded && <ContinueCard selected={selectedId === TASK_QUEUE_CONTINUE_ID} onClick={handleContinue} />}
              <TaskRailSkeleton compact={!expanded} />
            </>
          ) : visibleRows.length ? (
            <>
              {!expanded && <ContinueCard selected={selectedId === TASK_QUEUE_CONTINUE_ID} onClick={handleContinue} />}
              {visibleRows.map((item) => (
                <TaskCard
                  key={item.id}
                  item={item}
                  compact={!expanded}
                  selected={selectedId === item.id}
                  applying={applyingId === item.id}
                  displayMode={displayMode}
                  onClick={() => handleSelect(item)}
                />
              ))}
            </>
          ) : (
            <>
              {!expanded && <ContinueCard selected={selectedId === TASK_QUEUE_CONTINUE_ID} onClick={handleContinue} />}
              <TaskRailEmpty compact={!expanded} moduleLabel={moduleLabel} failed={loadError} onRetry={() => void loadQueue()} />
            </>
          )}
        </div>

        <div className="border-t border-slate-100 px-3 py-3">
          {expanded ? (
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => void loadQueue({ force: true })}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                刷新
              </button>
              {totalPages > 1 || hasMore ? (
                <div className="flex min-w-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={!canGoPreviousPage}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    className="inline-flex h-8 items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-black text-slate-500 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label="上一页"
                    title="上一页"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    上一页
                  </button>
                  <span className="min-w-14 text-center text-[11px] font-black text-slate-600">
                    {page}/{totalPages}{hasMore ? "+" : ""}
                  </span>
                  <button
                    type="button"
                    disabled={loading || !canGoNextPage}
                    onClick={handleNextPage}
                    className="inline-flex h-8 items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-black text-slate-500 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label={canGoNextLoadedPage ? "下一页" : "加载更多"}
                    title={canGoNextLoadedPage ? "下一页" : "加载更多"}
                  >
                    {loading && !canGoNextLoadedPage ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        {canGoNextLoadedPage ? "下一页" : "加载更多"}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <span className="truncate text-xs font-black text-slate-500">已加载 {loadedCount} 条</span>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex h-9 w-full items-center justify-center gap-0.5 whitespace-nowrap rounded-lg px-1 text-[12px] font-black text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              全部任务
              <ChevronRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

function ContinueCard({ selected, disabled = false, onClick }: { selected: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group relative flex h-[68px] w-full items-center justify-center rounded border bg-white px-1 text-center text-[12px] font-medium leading-4 text-slate-600 transition hover:border-zinc-300 hover:bg-zinc-50",
        disabled && "cursor-not-allowed opacity-55",
        selected ? "border-zinc-950 bg-zinc-100 shadow-[0_0_0_1px_rgba(5,5,5,0.10)]" : "border-slate-100"
      )}
    >
      <span className="max-w-[3.5em] whitespace-normal break-keep">继续创建</span>
      {selected && <span className="absolute -right-2 top-2 h-[54px] w-1 rounded-full bg-zinc-950" />}
    </button>
  );
}

function SegmentButton({
  active,
  disabled = false,
  onClick,
  children,
  icon,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-lg border px-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-55",
        active
          ? "border-zinc-950 bg-zinc-100 text-zinc-900"
          : "border-slate-100 bg-slate-50 text-slate-500 hover:border-slate-200 hover:text-slate-800"
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

function TaskCard({
  item,
  compact,
  selected,
  applying,
  disabled = false,
  displayMode,
  onClick,
}: {
  item: TaskQueueItem;
  compact: boolean;
  selected: boolean;
  applying: boolean;
  disabled?: boolean;
  displayMode: TaskDisplayMode;
  onClick: () => void;
}) {
  const running = isTaskRunning(item);
  const failed = item.statusGroup === "failed";
  const resultThumbnails = safeTaskUrls(item.resultThumbnails);
  const inputThumbnails = safeTaskUrls(item.inputThumbnails);
  const thumbnails = safeTaskUrls(item.thumbnails);
  const cover = running
    ? inputThumbnails[0] || ""
    : resultThumbnails[0] || inputThumbnails[0] || thumbnails[0] || "";
  const progress = clampProgress(item.progress);

  if (compact) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "studio-task-card group relative flex h-[68px] w-full items-center justify-center rounded border bg-white p-1 text-left transition hover:border-zinc-300 hover:bg-zinc-50",
          running && "border-zinc-200 bg-zinc-50",
          applying ? "cursor-wait" : disabled && "cursor-not-allowed opacity-55",
          selected ? "border-zinc-950 bg-zinc-100 shadow-[0_0_0_1px_rgba(5,5,5,0.10)]" : "border-slate-100"
        )}
        title={item.title || item.id}
      >
        <TaskThumb url={cover} running={running} failed={failed} applying={applying} compact className="h-full w-full" />
        {selected && <span className="absolute -right-2 top-2 h-[54px] w-1 rounded-full bg-zinc-950" />}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "studio-task-card studio-task-card-expanded group w-full rounded-lg border bg-white p-2 text-left transition hover:border-zinc-300 hover:bg-zinc-50",
        applying ? "cursor-wait" : disabled && "cursor-not-allowed opacity-55",
        selected ? "border-zinc-950 ring-2 ring-zinc-200" : "border-slate-100",
        failed && "border-red-200 bg-red-50/60"
      )}
    >
      <div className="flex items-start gap-3">
        <TaskThumb url={cover} running={running} failed={failed} applying={applying} className="h-16 w-12 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-slate-900">{item.title}</p>
              <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-400">{item.id}</p>
            </div>
            {applying ? (
              <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-[rgba(91,124,255,0.10)] px-2 text-[10px] font-black text-[var(--codex-accent)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                套用中
              </span>
            ) : (
              <StatusPill item={item} />
            )}
          </div>
          <p className="mt-1 line-clamp-1 text-xs font-semibold text-slate-500">
            {failed ? item.error || "任务失败，可套用参数重试" : getTaskMeta(item, progress)}
          </p>
          <TaskPreviewStrip item={item} displayMode={displayMode} />
        </div>
      </div>
    </button>
  );
}

function TaskThumb({
  url,
  running,
  failed,
  applying,
  compact = false,
  className,
}: {
  url: string;
  running: boolean;
  failed: boolean;
  applying: boolean;
  compact?: boolean;
  className?: string;
}) {
  const isVideo = isLikelyVideoUrl(url);
  const displayUrl = isVideo ? url : getImageVariantUrl(url, "thumb");

  return (
    <span className={cn(
      "relative block overflow-hidden",
      compact ? "rounded bg-white" : "studio-task-thumb-frame rounded-lg",
      className
    )}>
      {displayUrl ? (
        isVideo ? (
          <video
            src={displayUrl}
            muted
            playsInline
            preload="metadata"
            className="relative z-[1] h-full w-full object-cover"
          />
        ) : (
          <img
            src={displayUrl}
            alt=""
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            className="relative z-[1] h-full w-full object-cover"
          />
        )
      ) : (
        <span className="relative z-[1] flex h-full w-full items-center justify-center text-slate-300">
          <ImageIcon className="h-4 w-4" />
        </span>
      )}
      {running && (
        <span className="absolute inset-x-1 bottom-1 z-[2] flex items-center justify-center gap-1 rounded bg-zinc-950/90 px-1.5 py-0.5 text-[9px] font-black leading-none text-white shadow-sm">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/90" />
          <span className="truncate">生成中</span>
        </span>
      )}
      {applying && !running && (
        <span className="absolute inset-0 z-[2] flex items-center justify-center gap-1 bg-white/70 text-[10px] font-semibold text-zinc-900 backdrop-blur-[1px]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {compact && <span>套用中</span>}
        </span>
      )}
      {failed && <span className="absolute inset-x-0 bottom-0 z-[2] h-1 bg-red-400" />}
    </span>
  );
}

function TaskPreviewStrip({ item, displayMode }: { item: TaskQueueItem; displayMode: TaskDisplayMode }) {
  const running = isTaskRunning(item);
  const resultUrls = safeTaskUrls(item.resultThumbnails).slice(0, 4);
  const inputUrls = safeTaskUrls(item.inputThumbnails).slice(0, 2);
  const expectedCount = Math.max(1, Math.min(item.expectedCount || 1, 4));

  if (displayMode === "grouped") {
    const runningSlots: Array<{ url: string; kind: "input" | "result" }> =
      inputUrls.map((url) => ({ url, kind: "input" }));
    while (running && runningSlots.length < Math.max(inputUrls.length, expectedCount)) {
      runningSlots.push({ url: "", kind: "result" as const });
    }
    const slots = [
      ...inputUrls.map((url) => ({ url, kind: "input" as const })),
      ...resultUrls.map((url) => ({ url, kind: "result" as const })),
    ];
    const visibleSlots = running ? runningSlots : slots;
    return (
      <div className="mt-2 flex gap-1 overflow-hidden">
        {visibleSlots.slice(0, 6).map((slot, index) => (
          <span
            key={`${slot.url || slot.kind}-${index}`}
            className={cn(
              "relative h-9 w-9 shrink-0 overflow-hidden rounded-md border",
              slot.kind === "input" ? "border-slate-200" : "border-zinc-200"
            )}
          >
            {slot.url ? (
              <TaskStripImage url={slot.url} />
            ) : (
              <span className="studio-task-placeholder-thumb block h-full w-full" />
            )}
          </span>
        ))}
      </div>
    );
  }

  const slots = running
    ? inputUrls.length
      ? inputUrls
      : Array.from({ length: expectedCount }, () => "")
    : resultUrls.length
      ? resultUrls
      : inputUrls;
  return (
    <div className="mt-2 grid grid-cols-4 gap-1">
      {slots.slice(0, 4).map((url, index) => (
        <span key={`${url || "pending"}-${index}`} className="aspect-square w-full overflow-hidden rounded-md border border-slate-100 bg-slate-50">
          {url ? <TaskStripImage url={url} /> : <span className="studio-task-placeholder-thumb block h-full w-full" />}
        </span>
      ))}
    </div>
  );
}

function TaskStripImage({ url }: { url: string }) {
  if (isLikelyVideoUrl(url)) {
    return (
      <video
        src={url}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
      />
    );
  }

  return (
    <img
      src={getImageVariantUrl(url, "thumb")}
      alt=""
      loading="lazy"
      decoding="async"
      fetchPriority="low"
      className="h-full w-full object-cover"
    />
  );
}

function StatusPill({ item }: { item: TaskQueueItem }) {
  const progress = clampProgress(item.progress);
  const className = item.statusGroup === "failed"
    ? "bg-red-50 text-red-600"
    : item.statusGroup === "completed"
      ? "bg-emerald-50 text-emerald-600"
      : "bg-[rgba(91,124,255,0.10)] text-[var(--codex-accent)]";
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-black", className)}>
      {isTaskRunning(item) && <Loader2 className="h-3 w-3 animate-spin" />}
      {statusText(item, progress)}
    </span>
  );
}

function TaskRailSkeleton({ compact }: { compact: boolean }) {
  const items = compact ? 4 : 3;
  return (
    <div className={cn("studio-task-rail-skeleton", compact ? "space-y-2" : "space-y-3")}>
      {Array.from({ length: items }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "overflow-hidden rounded-lg border border-white/70 bg-white/72 shadow-sm",
            compact ? "h-[68px] p-1" : "h-[88px] p-3"
          )}
        >
          <div className={cn("studio-skeleton-shimmer h-full rounded-md", !compact && "max-w-full")} />
        </div>
      ))}
    </div>
  );
}

function TaskRailEmpty({
  compact = false,
  moduleLabel = "当前模块",
  failed = false,
  onRetry,
}: {
  compact?: boolean;
  moduleLabel?: string;
  failed?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div
      className={cn(
        "studio-task-rail-empty flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-200 bg-white/70 text-center text-xs font-semibold text-codex-faint",
        compact ? "min-h-[92px] px-1 py-3" : "min-h-32 px-4 py-5"
      )}
    >
      {failed ? <RefreshCw className="mb-2 h-5 w-5 text-amber-500" /> : <Clock3 className="mb-2 h-5 w-5 text-[var(--codex-accent)]" />}
      <span>{failed ? (compact ? "重试" : "任务加载失败") : compact ? "暂无" : `${moduleLabel}暂无任务`}</span>
      {!compact && (
        <span className="mt-1 text-[11px] font-medium text-slate-400">
          {failed ? "网络或接口暂时不可用，可以手动刷新。" : "生成后会自动出现在这里"}
        </span>
      )}
      {failed && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "mt-2 inline-flex items-center justify-center rounded-lg border border-amber-200 bg-amber-50 font-black text-amber-700 transition hover:bg-amber-100",
            compact ? "h-7 px-2 text-[11px]" : "h-8 px-3 text-xs"
          )}
        >
          刷新
        </button>
      ) : null}
    </div>
  );
}

function statusText(item: TaskQueueItem, progress: number) {
  if (item.statusGroup === "queued") return "排队中";
  if (item.status === "processing_delayed") return "后台处理中";
  if (item.statusGroup === "running") return progress > 0 ? `${progress}%` : "生成中";
  if (item.statusGroup === "failed") return "失败";
  return "已完成";
}

function getTaskMeta(item: TaskQueueItem, progress: number) {
  if (isTaskRunning(item)) {
    const pieces = [item.status === "processing_delayed" ? "生成时间较长" : item.expectedCount > 4 ? "多图任务耗时较长" : "预计几分钟"];
    if (progress > 0) pieces.unshift(`${progress}%`);
    return pieces.join(" · ");
  }
  if (item.resultCount > 0) return `${item.resultCount}/${item.expectedCount} 张 · ${item.time || "已完成"}`;
  return item.time || item.status;
}

function normalizeSummary(payload: TaskQueuePayload): TaskQueueSummary {
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  return {
    totalTaskNum: firstFiniteNumber(data.totalTaskNum, payload.totalTaskNum, payload.totalCount, 0),
    finishedTaskNum: firstFiniteNumber(data.finishedTaskNum, payload.finishedTaskNum, 0),
    finishedNeedReadTaskNum: firstFiniteNumber(data.finishedNeedReadTaskNum, payload.finishedNeedReadTaskNum, 0),
    runningTaskNum: firstFiniteNumber(data.runningTaskNum, payload.runningTaskNum, payload.runningCount, 0),
    failedTaskNum: firstFiniteNumber(data.failedTaskNum, payload.failedTaskNum, payload.failedCount, 0),
  };
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) return Math.round(num);
  }
  return 0;
}

function clampProgress(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.min(Math.max(Math.round(num), 0), 100);
}

function getTaskSelectionSignature(item: TaskQueueItem) {
  return [
    item.id,
    item.status,
    item.statusGroup,
    item.progress,
    item.updatedAt || "",
    item.resultCount,
    item.expectedCount,
    item.error || "",
    safeTaskUrls(item.resultThumbnails).join("|"),
  ].join("::");
}

function safeTaskUrls(value: unknown) {
  return Array.isArray(value) ? value.filter((url): url is string => typeof url === "string" && url.trim().length > 0) : [];
}
