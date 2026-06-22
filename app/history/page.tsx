"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Clock, XCircle, Loader2, Coins, X, RotateCcw, Copy, Maximize2, Eye, ImageIcon, ZoomIn, ZoomOut, Plus, Play } from "lucide-react";
import { downloadImage, generateDownloadFilename } from "@/lib/utils";
import { getImageVariantUrl } from "@/lib/image-variants";
import { getApplyPath, type HistoryJobPayload } from "@/lib/history-apply";
import { inferMediaExtension, isLikelyVideoUrl } from "@/lib/media";
import { buildTryOnPrompt } from "@/lib/api/lingya";
import { ClientPortal } from "@/components/ClientPortal";
import {
  buildHistoryFilterUrl,
  buildHistoryDetailUrl,
  getHistoryFailureRecoveryCopy,
  getHistoryFiltersFromSearch,
  getHistoryFilterStateCopy,
  normalizeHistoryStatusFilter,
  type HistoryFailureRecoveryCopy,
  type HistoryModuleFilter,
  type HistoryStatusFilter,
} from "@/lib/history-page-state";
import { isRunningStatus } from "@/lib/generation-status";
import { AUTO_DESIGN_PLATFORMS, SCENE_MODE_LABELS } from "@/lib/tryon-scene";
import { TRYON_CLOTHING_ROLE_LABELS } from "@/lib/tryon-upload-rules";
import {
  getGarment3dDisplayStyleLabel,
  getModelShootStyleLabel,
  getPoseSeriesStyleLabel,
} from "@/lib/module-style-presets";
import { BACKGROUND_SOURCE_LABELS, MODEL_BACKGROUND_MODE_LABELS, normalizeModelBackgroundSourceUrls } from "@/lib/model-background";
import { getMaterialEnhancementLevelLabel } from "@/lib/material-enhancement";
import { getOutfitFusionDisplayPrompt } from "@/lib/outfit-fusion";
import { getFaceSwapModeLabel, getFaceSwapModeNote, normalizeFaceSwapMode } from "@/lib/face-swap";
import { RawPreviewImage } from "@/components/studio/RawPreviewImage";

const HISTORY_PAGE_SIZE = 12;

const MODULE_FILTERS: { value: HistoryModuleFilter; label: string }[] = [
  { value: "all", label: "全部模块" },
  { value: "tryon", label: "服装上身" },
  { value: "grass", label: "服装种草" },
  { value: "productSet", label: "商品套图" },
  { value: "modelBackground", label: "模特换背景" },
  { value: "materialEnhancement", label: "材质增强" },
  { value: "generalImage", label: "通用生图" },
  { value: "outfitFusion", label: "搭配融图" },
  { value: "pose", label: "姿势裂变" },
  { value: "model", label: "专属模特" },
  { value: "garment3d", label: "服装 3D" },
  { value: "faceSwap", label: "换脸" },
  { value: "videoImageToVideo", label: "图生视频" },
  { value: "videoMotion", label: "动作模仿" },
  { value: "videoFirstLastFrame", label: "首尾帧" },
];

const STATUS_FILTERS: { value: HistoryStatusFilter; label: string }[] = [
  { value: "all", label: "全部状态" },
  { value: "completed", label: "已完成" },
  { value: "processing", label: "处理中" },
  { value: "pending", label: "排队中" },
  { value: "failed", label: "失败" },
];

type HistoryRow = {
  id: string;
  status: string;
  error_message?: string | null;
  credits_cost?: number | null;
  credits_used?: number | null;
  ai_model?: string | null;
  image_size?: string | null;
  result_urls?: string[];
  created_at: string;
  completed_at?: string | null;
  clothing_urls?: string[];
  model_face_url?: string | null;
  reference_url?: string | null;
  job_payload?: HistoryJobPayload | Record<string, unknown>;
};

type HistoryListPayload = {
  rows?: HistoryRow[];
  hasMore?: boolean;
  nextCursor?: string | null;
  error?: string;
};

function getInitialHistoryFilters() {
  if (typeof window === "undefined") {
    return { moduleFilter: "all" as HistoryModuleFilter, statusFilter: "all" as HistoryStatusFilter };
  }

  return getHistoryFiltersFromSearch(window.location.search);
}

function getInitialHistoryDetailId() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("detail") || "";
}

function replaceHistoryFilterUrl(moduleFilter: HistoryModuleFilter, statusFilter: HistoryStatusFilter) {
  if (typeof window === "undefined") return;

  window.history.replaceState(window.history.state, "", buildHistoryFilterUrl(window.location.href, moduleFilter, statusFilter));
}

function replaceHistoryDetailUrl(detailId: string | null) {
  if (typeof window === "undefined") return;

  window.history.replaceState(window.history.state, "", buildHistoryDetailUrl(window.location.href, detailId));
}

async function requestHistoryDetail(id: string) {
  const res = await fetch(`/api/history?id=${encodeURIComponent(id)}`, {
    method: "GET",
    cache: "no-store",
  });
  const payload = await res.json().catch(() => ({})) as { row?: HistoryRow; error?: string };

  if (!res.ok || !payload.row) {
    throw new Error(payload.error || `参数加载失败 (${res.status})`);
  }

  return payload.row;
}

export default function HistoryPage() {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "noauth" | "error" | "empty" | "ready">("loading");
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [errMsg, setErrMsg] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<HistoryRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailResultIndex, setDetailResultIndex] = useState(0);
  const [detailZoom, setDetailZoom] = useState(100);
  const [initialFilters] = useState(getInitialHistoryFilters);
  const [initialDetailId] = useState(getInitialHistoryDetailId);
  const [pendingDetailId, setPendingDetailId] = useState(initialDetailId);
  const [moduleFilter, setModuleFilter] = useState<HistoryModuleFilter>(initialFilters.moduleFilter);
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>(initialFilters.statusFilter);
  const [reloadToken, setReloadToken] = useState(0);
  const filterState = useMemo(
    () => getHistoryFilterStateCopy(moduleFilter, statusFilter),
    [moduleFilter, statusFilter]
  );

  useEffect(() => {
    replaceHistoryFilterUrl(moduleFilter, statusFilter);
  }, [moduleFilter, statusFilter, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setErrMsg("");
    setRows([]);
    setHasMore(false);
    setNextCursor(null);

    (async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000);
        const payload = await requestHistoryPage({
          moduleFilter,
          statusFilter,
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));

        if (cancelled) return;
        const data = payload.rows || [];
        setRows(data);
        setHasMore(Boolean(payload.hasMore));
        setNextCursor(payload.nextCursor || null);
        setState(data.length ? "ready" : "empty");
      } catch (e: unknown) {
        if (cancelled) return;
        if (e instanceof HistoryAuthError) {
          setState("noauth");
          return;
        }
        const isAbortError = e instanceof DOMException && e.name === "AbortError";
        setErrMsg(isAbortError ? "历史记录加载超时，请稍后重试" : e instanceof Error ? e.message : "未知错误");
        setState("error");
      }
    })();

    return () => { cancelled = true; };
  }, [moduleFilter, statusFilter]);

  const loadMore = async () => {
    if (!hasMore || !nextCursor || loadingMore) return;

    setLoadingMore(true);
    try {
      const payload = await requestHistoryPage({
        cursor: nextCursor,
        moduleFilter,
        statusFilter,
      });
      const incomingRows = payload.rows || [];
      setRows((current) => {
        const seen = new Set(current.map((row) => row.id));
        return [
          ...current,
          ...incomingRows.filter((row) => !seen.has(row.id)),
        ];
      });
      setHasMore(Boolean(payload.hasMore));
      setNextCursor(payload.nextCursor || null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "历史记录加载失败");
    } finally {
      setLoadingMore(false);
    }
  };

  const fmt = (d: string) => {
    try { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(d)); }
    catch { return d; }
  };

  const getPayload = (row: HistoryRow) => getRowPayload(row);
  const detailPayload = detailRow ? getPayload(detailRow) : undefined;
  const detailPrompt = detailPayload ? getPromptText(detailPayload) : "";
  const detailImages = detailPayload ? getInputImages(detailPayload) : [];
  const detailResults = detailRow?.result_urls || [];
  const detailRowId = detailRow?.id || "";
  const detailRowStatus = detailRow?.status || "";
  const detailResultCount = detailResults.length;
  const selectedResultIndex = detailResults.length ? Math.min(detailResultIndex, detailResults.length - 1) : 0;
  const selectedResultUrl = detailResults[selectedResultIndex];
  const detailFailureCopy = detailRow ? getHistoryFailureRecoveryCopy({
    status: detailRow.status,
    errorMessage: detailRow.error_message,
    hasApplyParams: Boolean(detailPayload?.kind),
  }) : null;
  const filteredRows = useMemo(() => rows.filter((row) => {
    const payload = getRowPayload(row);
    const moduleMatch = moduleFilter === "all" || payload?.kind === moduleFilter;
    const normalizedStatus = normalizeHistoryStatusFilter(row.status);
    const statusMatch = statusFilter === "all" || normalizedStatus === statusFilter;
    return moduleMatch && statusMatch;
  }), [rows, moduleFilter, statusFilter]);

  const handleModuleFilterChange = (value: HistoryModuleFilter) => {
    setModuleFilter(value);
  };

  const handleStatusFilterChange = (value: HistoryStatusFilter) => {
    setStatusFilter(value);
  };

  const clearFilters = () => {
    setModuleFilter("all");
    setStatusFilter("all");
  };

  const fetchHistoryDetail = async (row: HistoryRow) => {
    if (getPayload(row)?.kind) return row;

    const payload = await requestHistoryDetail(row.id);
    setRows((current) => current.map((item) => (
      item.id === payload.id ? { ...item, ...payload } : item
    )));
    return payload;
  };

  useEffect(() => {
    if (!pendingDetailId || state === "loading" || state === "noauth") return;

    let cancelled = false;
    setDetailLoading(true);
    setDetailResultIndex(0);
    setDetailZoom(100);

    requestHistoryDetail(pendingDetailId)
      .then((row) => {
        if (cancelled) return;
        setDetailRow(row);
        setRows((current) => current.map((item) => (
          item.id === row.id ? { ...item, ...row } : item
        )));
      })
      .catch((error) => {
        if (!cancelled) {
          replaceHistoryDetailUrl(null);
          toast.error(error instanceof Error ? error.message : "参数加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPendingDetailId("");
          setDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pendingDetailId, state]);

  const openDetail = async (row: HistoryRow, initialResultIndex = 0) => {
    replaceHistoryDetailUrl(row.id);
    setDetailLoading(true);
    try {
      setDetailResultIndex(initialResultIndex);
      setDetailZoom(100);
      setDetailRow(await fetchHistoryDetail(row));
    } catch (error) {
      replaceHistoryDetailUrl(null);
      toast.error(error instanceof Error ? error.message : "参数加载失败");
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setDetailRow(null);
    replaceHistoryDetailUrl(null);
  };

  useEffect(() => {
    if (!detailRowId) return;
    const running = isRunningStatus(detailRowStatus);
    if (!running) return;

    let cancelled = false;
    const pollDetail = async () => {
      try {
        const res = await fetch(`/api/history?id=${encodeURIComponent(detailRowId)}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = await res.json().catch(() => ({})) as { row?: HistoryRow };
        if (!res.ok || !payload.row || cancelled) return;
        const nextRow: HistoryRow = payload.row;

        const previousCount = detailResultCount;
        const nextCount = nextRow.result_urls?.length || 0;
        if (nextCount > previousCount && selectedResultIndex >= Math.max(previousCount - 1, 0)) {
          setDetailResultIndex(nextCount - 1);
          setDetailZoom(100);
        }

        setDetailRow((current) => current?.id === nextRow.id ? { ...current, ...nextRow } : current);
        setRows((current) => current.map((item) => (
          item.id === nextRow.id ? { ...item, ...nextRow } : item
        )));
      } catch {
        // Keep the current preview usable if a transient poll fails.
      }
    };

    const timer = window.setInterval(pollDetail, 8_000);
    pollDetail();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [detailRowId, detailRowStatus, detailResultCount, selectedResultIndex]);

  const applyHistoryRow = async (row: HistoryRow) => {
    setDetailLoading(true);
    try {
      const fullRow = await fetchHistoryDetail(row);
      const payload = getPayload(fullRow);
      if (!payload?.kind) {
        toast.error("这条作品暂无可套用参数");
        return;
      }
      router.push(getApplyPath(payload.kind, fullRow.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "参数加载失败");
    } finally {
      setDetailLoading(false);
    }
  };

  const retryHistoryLoad = () => {
    setReloadToken((current) => current + 1);
  };

  const openCreate = () => {
    router.push("/create");
  };

  const openLogin = () => {
    router.push("/login");
  };

  if (state === "loading") return (
    <HistoryLoadingSkeleton />
  );

  if (state === "noauth") return (
    <div className="studio-empty-stage flex min-h-[calc(100dvh-64px)] items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-[30px] border border-white/80 bg-white/75 p-8 text-center shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur-2xl">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-lg shadow-slate-300/40">
          <ImageIcon className="h-7 w-7 text-slate-500" />
        </div>
        <h1 className="text-2xl font-black text-slate-950">登录后查看作品资产</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">你的生成结果、输入图片、提示词参数和套用记录都会保存在这里。</p>
        <button type="button" onClick={openLogin} className="gradient-brand mt-6 inline-flex h-11 items-center justify-center rounded-full px-6 text-sm font-black text-white shadow-xl shadow-slate-300/40">去登录</button>
      </div>
    </div>
  );

  if (state === "error") return (
    <div className="studio-empty-stage flex min-h-[calc(100dvh-64px)] items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg rounded-[30px] border border-white/80 bg-white/75 p-8 text-center shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur-2xl">
        <XCircle className="mx-auto mb-4 h-12 w-12 text-red-300" />
        <h1 className="text-xl font-black text-slate-950">作品加载失败</h1>
        <p className="mx-auto mt-3 max-w-sm rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold leading-6 text-red-600">
          {filterState.summary}
        </p>
        <p className="mt-3 text-sm leading-6 text-red-500">{errMsg}</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          重试会按当前 URL 中的 module/status 筛选重新加载。
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <button type="button" onClick={retryHistoryLoad} className="h-11 rounded-full border border-slate-200 bg-white px-6 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50">重试</button>
          {filterState.isFiltered && (
            <button onClick={clearFilters} className="h-11 rounded-full border border-slate-200 bg-slate-50 px-6 text-sm font-bold text-slate-600 hover:bg-white">
              清除筛选
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (state === "empty") return (
    <div className="studio-empty-stage flex min-h-[calc(100dvh-64px)] items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg rounded-[30px] border border-white/80 bg-white/75 p-8 text-center shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur-2xl">
        <Clock className="mx-auto mb-4 h-12 w-12 text-slate-300" />
        <h1 className="text-2xl font-black text-slate-950">{filterState.emptyTitle}</h1>
        <p className="mx-auto mt-3 max-w-sm rounded-2xl bg-white/80 px-4 py-3 text-sm font-bold leading-6 text-slate-700">
          {filterState.summary}
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-500">{filterState.emptyMessage}</p>
        {filterState.isFiltered ? (
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <button onClick={clearFilters} className="gradient-brand inline-flex h-11 items-center justify-center gap-2 rounded-full px-6 text-sm font-black text-white shadow-xl shadow-slate-300/40">
              <X className="h-4 w-4" />
              {filterState.emptyActionLabel}
            </button>
            <button type="button" onClick={openCreate} className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-6 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50">
              <Plus className="h-4 w-4" />
              开始创作
            </button>
          </div>
        ) : (
          <button type="button" onClick={openCreate} className="gradient-brand mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-full px-6 text-sm font-black text-white shadow-xl shadow-slate-300/40">
            <Plus className="h-4 w-4" />
            开始创作
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="studio-workbench history-workbench min-h-[calc(100dvh-64px)] px-4 py-6 sm:py-8">
      <HistorySkeletonStyles />
      <div className="mx-auto mb-6 flex max-w-7xl flex-col gap-4 rounded-[28px] border border-white/80 bg-white/72 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur-2xl sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black text-slate-600">
            <ImageIcon className="h-3.5 w-3.5" />
            Asset Library
          </p>
          <h1 className="mt-3 text-3xl font-black text-slate-950">作品资产</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">已加载 {rows.length} 条作品，当前显示 {filteredRows.length} 条。{filterState.activeDescription} 可查看大图、下载结果、复制提示词并套用完整参数。</p>
        </div>
        <button type="button" onClick={openCreate} className="gradient-brand inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-5 text-sm font-black text-white shadow-xl shadow-slate-300/40 sm:w-auto">
          <Plus className="h-4 w-4" />
          新创作
        </button>
      </div>

      <div className="mx-auto mb-4 max-w-7xl rounded-[16px] border border-white/80 bg-white/68 p-2 shadow-[0_14px_44px_rgba(15,23,42,0.06)] backdrop-blur-2xl sm:p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {MODULE_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => handleModuleFilterChange(item.value)}
                className={`h-8 flex-shrink-0 rounded-full px-3 text-xs font-black transition ${
                  moduleFilter === item.value
                    ? "gradient-brand text-white shadow-lg shadow-slate-200"
                    : "border border-slate-200 bg-white/76 text-slate-600 hover:bg-white"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {STATUS_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => handleStatusFilterChange(item.value)}
                className={`h-8 flex-shrink-0 rounded-full px-3 text-xs font-bold transition ${
                  statusFilter === item.value
                    ? "border border-slate-300 bg-slate-100 text-slate-700"
                    : "border border-slate-200 bg-white/76 text-slate-500 hover:bg-white"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 border-t border-white/70 pt-3 text-xs leading-5 text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-bold text-slate-700">{filterState.summary}</span>
          <span>打开详情会保留当前筛选；点击套用会带 apply 参数回到对应创作模块。</span>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 lg:grid-cols-2">
        {filteredRows.map((g: HistoryRow) => {
          const payload = getPayload(g);
          const resultUrls = g.result_urls || [];
          const coverUrl = resultUrls[0];
          const moduleLabel = payload?.kind ? formatKind(payload.kind) : "生成作品";
          const status = formatStatus(g.status);
          const credits = g.credits_cost || g.credits_used || "-";
          const failureCopy = getHistoryFailureRecoveryCopy({
            status: g.status,
            errorMessage: g.error_message,
            hasApplyParams: Boolean(payload?.kind),
          });
          const inputSummary = getHistoryInputSummary(payload);
          const outputSummary = getHistoryOutputSummary(g, payload);
          const reuseLabel = failureCopy?.applyLabel || getHistoryReuseLabel(payload);

          return (
            <article key={g.id} className="group overflow-hidden rounded-[16px] border border-white/80 bg-white/78 shadow-[0_18px_54px_rgba(15,23,42,0.08)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:shadow-[0_24px_76px_rgba(15,23,42,0.12)]">
              <div className="flex flex-col sm:flex-row">
                <button
                  type="button"
                  onClick={() => openDetail(g)}
                  aria-label={`查看${moduleLabel}详情`}
                  className="relative aspect-[4/5] overflow-hidden bg-slate-100 sm:w-44 sm:flex-shrink-0 sm:aspect-[3/4] md:w-52"
                >
                  {coverUrl ? (
                    <HistoryMediaPreview url={coverUrl} variant="card" className="transition duration-300 group-hover:scale-[1.03]" alt="历史作品封面" />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-300">
                      <ImageIcon className="h-9 w-9" />
                      <span className="text-xs text-gray-400">暂无结果</span>
                    </div>
                  )}
                  <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-medium ${getStatusClasses(g.status)}`}>
                    {status}
                  </span>
                  {resultUrls.length > 1 && (
                    <span className="absolute bottom-3 left-3 rounded-full border border-white/70 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-gray-700 shadow-sm backdrop-blur">
                      {resultUrls.length} 个结果
                    </span>
                  )}
                </button>

                <div className="flex min-w-0 flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold text-gray-950">{moduleLabel}</h2>
                      <p className="mt-0.5 text-xs text-gray-400">{fmt(g.created_at)}</p>
                    </div>
                    <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                      <Coins className="h-3.5 w-3.5" />
                      {credits}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
                    <div className="min-w-0">
                      <p className="text-[10px] text-gray-400">模型</p>
                      <p className="mt-0.5 truncate font-medium text-gray-800">{g.ai_model || payload?.aiModel || "-"}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] text-gray-400">尺寸</p>
                      <p className="mt-0.5 truncate font-medium text-gray-800">{g.image_size || getPayloadDisplaySize(payload) || "-"}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] text-gray-400">结果</p>
                      <p className="mt-0.5 truncate font-medium text-gray-800">{resultUrls.length || 0} 个</p>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 text-xs">
                    <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2">
                      <p className="text-[10px] font-bold text-slate-400">输入摘要</p>
                      <p className="mt-0.5 line-clamp-2 font-medium leading-5 text-slate-700">{inputSummary}</p>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-white/78 px-3 py-2">
                      <p className="text-[10px] font-bold text-slate-400">输出摘要</p>
                      <p className="mt-0.5 line-clamp-2 font-medium leading-5 text-slate-700">{outputSummary}</p>
                    </div>
                  </div>

                  {resultUrls.length > 1 && (
                    <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
                      {resultUrls.slice(0, 5).map((url, index) => (
                        <button
                          type="button"
                          key={`${url}-${index}`}
                          onClick={() => openDetail(g, index)}
                          aria-label={`查看第 ${index + 1} 张结果`}
                          className="h-12 w-10 flex-shrink-0 overflow-hidden rounded-md border bg-gray-50"
                        >
                          <HistoryMediaPreview url={url} variant="thumb" alt={`结果 ${index + 1}`} />
                        </button>
                      ))}
                      {resultUrls.length > 5 && (
                        <button
                          type="button"
                          onClick={() => openDetail(g, 5)}
                          aria-label={`查看剩余 ${resultUrls.length - 5} 张结果`}
                          className="h-12 w-10 flex-shrink-0 rounded-md border bg-gray-50 text-[10px] font-medium text-gray-500"
                        >
                          +{resultUrls.length - 5}
                        </button>
                      )}
                    </div>
                  )}

                  {failureCopy ? (
                    <HistoryFailureNotice copy={failureCopy} />
                  ) : g.error_message && (
                    <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{g.error_message}</p>
                  )}

                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                    <button
                      onClick={() => openDetail(g)}
                      disabled={detailLoading}
                      className="gradient-brand inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      查看作品
                    </button>
                    <button
                      onClick={() => applyHistoryRow(g)}
                      disabled={detailLoading}
                      className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {reuseLabel}
                    </button>
                    <button
                      onClick={() => coverUrl && downloadHistoryResult(g, coverUrl, 0)}
                      disabled={!coverUrl}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      下载
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
        {filteredRows.length === 0 && !loadingMore && (
          <div className="col-span-full rounded-[28px] border border-white/80 bg-white/70 p-8 text-center shadow-[0_18px_54px_rgba(15,23,42,0.07)] backdrop-blur-2xl">
            <ImageIcon className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <h2 className="text-base font-black text-slate-950">没有匹配的作品</h2>
            <p className="mx-auto mt-3 max-w-md rounded-2xl bg-white/75 px-4 py-3 text-sm font-bold leading-6 text-slate-700">
              {filterState.summary}
            </p>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">{filterState.noMatchMessage}</p>
            {filterState.isFiltered && (
              <button onClick={clearFilters} className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-5 text-sm font-bold text-slate-600 hover:bg-white">
                <X className="h-4 w-4" />
                清除筛选
              </button>
            )}
          </div>
        )}
        {loadingMore && Array.from({ length: 2 }).map((_, index) => (
          <HistoryCardSkeleton key={`loading-more-${index}`} />
        ))}
      </div>

      <div className="mt-8 flex justify-center">
        {hasMore ? (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-full border bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
            {loadingMore ? "加载中..." : "加载更多"}
          </button>
        ) : (
          <p className="text-xs text-gray-400">已加载全部历史作品</p>
        )}
      </div>
      {detailLoading && (
        <ClientPortal>
          <DetailLoadingSkeleton />
        </ClientPortal>
      )}
      {detailRow && (
        <ClientPortal>
          <div
            className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/30 p-3 backdrop-blur-xl sm:p-6"
            onClick={closeDetail}
          >
          <div
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-white/70 bg-white/85 shadow-[0_28px_90px_rgba(15,23,42,0.28)] backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/70 bg-white/70 px-4 py-3 backdrop-blur-xl sm:px-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-sm">{formatKind(detailPayload?.kind)}</h3>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">{formatStatus(detailRow.status)}</span>
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5">{fmt(detailRow.created_at)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(detailPrompt);
                    toast.success("提示词已复制");
                  }}
                  disabled={!detailPrompt}
                  className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/75 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm backdrop-blur hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Copy className="w-3.5 h-3.5" />
                  复制提示词
                </button>
                <button
                  type="button"
                  onClick={() => selectedResultUrl && downloadHistoryResult(detailRow, selectedResultUrl, selectedResultIndex)}
                  disabled={!selectedResultUrl}
                  className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/75 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm backdrop-blur hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  下载
                </button>
                {detailPayload && (
                  <button
                    type="button"
                    onClick={() => {
                      router.push(getApplyPath(detailPayload.kind, detailRow.id));
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full gradient-brand px-3 py-1.5 text-xs font-medium text-white"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {detailFailureCopy?.applyLabel || getHistoryReuseLabel(detailPayload)}
                  </button>
                )}
                <button type="button" onClick={closeDetail} className="rounded-full p-1.5 hover:bg-white/80" aria-label="关闭">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 overflow-y-auto bg-white/35 lg:grid-cols-[minmax(0,1.15fr)_380px] lg:overflow-hidden">
              <section className="flex min-h-[440px] flex-col gap-4 bg-[#eef0f3] p-3 sm:p-5">
                <div className="relative flex min-h-[330px] flex-1 items-center justify-center overflow-hidden rounded-[22px] bg-[#eef0f3]">
                  {selectedResultUrl ? (
                    <button
                      type="button"
                      onClick={() => setLightboxSrc(selectedResultUrl)}
                      className="group flex h-full w-full items-center justify-center p-2 sm:p-4"
                    >
                      <HistoryMediaPreview
                        url={selectedResultUrl}
                        variant="preview"
                        className="max-h-[62vh] w-full object-contain transition-transform duration-200"
                        style={{ transform: `scale(${detailZoom / 100})` }}
                        alt={`生成结果 ${selectedResultIndex + 1}`}
                        controls
                      />
                      <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/80 px-2.5 py-1 text-[11px] text-gray-700 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100">
                        <Maximize2 className="w-3 h-3" />
                        放大
                      </span>
                    </button>
                  ) : (
                    <div className="max-w-sm px-5 text-center text-sm text-gray-500">
                      {detailFailureCopy ? (
                        <>
                          <p className="font-bold text-red-600">{detailFailureCopy.title}</p>
                          <p className="mt-2 text-xs leading-5 text-gray-500">{detailFailureCopy.recoveryHint}</p>
                        </>
                      ) : normalizeHistoryStatusFilter(detailRow.status) === "completed" ? "暂无结果图片" : formatStatus(detailRow.status)}
                    </div>
                  )}
                  {detailResults.length > 0 && (
                    <div className="absolute left-3 top-3 rounded-full border border-white/70 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-gray-700 shadow-sm backdrop-blur">
                      {selectedResultIndex + 1} / {detailResults.length}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                    <ZoomOut className="h-4 w-4" />
                    <input
                      type="range"
                      min="70"
                      max="150"
                      step="5"
                      value={detailZoom}
                      onChange={(event) => setDetailZoom(Number(event.target.value))}
                      className="h-2 w-full min-w-48 cursor-pointer accent-slate-700 sm:w-64"
                      aria-label="缩放生成结果"
                    />
                    <ZoomIn className="h-4 w-4" />
                    <span className="w-10 text-right tabular-nums text-gray-700">{detailZoom}%</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDetailZoom(100)}
                    className="rounded-full border border-gray-200/80 bg-white/50 px-3 py-1.5 text-xs font-medium text-gray-600 backdrop-blur hover:bg-white/80"
                  >
                    重置
                  </button>
                </div>

                {detailResults.length > 0 && (
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {detailResults.map((url, index) => (
                      <button
                        type="button"
                        key={`${url}-${index}`}
                        onClick={() => {
                          setDetailResultIndex(index);
                          setDetailZoom(100);
                        }}
                        className={`h-20 w-16 flex-shrink-0 overflow-hidden rounded-xl border-2 bg-white shadow-sm transition ${
                          selectedResultIndex === index ? "border-slate-900 ring-2 ring-slate-200" : "border-white/80 opacity-75 hover:opacity-100"
                        }`}
                      >
                        <HistoryMediaPreview url={url} variant="thumb" alt={`结果缩略图 ${index + 1}`} />
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <aside className="space-y-5 overflow-y-auto border-l border-white/70 bg-white/75 p-4 backdrop-blur-xl sm:p-5 lg:max-h-[calc(92vh-57px)]">
                <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Reuse Center</p>
                  <h4 className="mt-1 text-sm font-black text-slate-950">复用这个作品</h4>
                  <p className="mt-1 text-xs leading-5 text-slate-500">复制提示词、套用完整参数或下载当前预览结果。</p>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(detailPrompt);
                        toast.success("提示词已复制");
                      }}
                      disabled={!detailPrompt}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/80 bg-white/85 px-3 text-xs font-bold text-slate-700 shadow-sm hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Copy className="h-3.5 w-3.5" /> 复制提示词
                    </button>
                    {detailPayload && (
                      <button
                        type="button"
                        onClick={() => router.push(getApplyPath(detailPayload.kind, detailRow.id))}
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-slate-950 px-3 text-xs font-bold text-white shadow-sm hover:bg-slate-800"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> {detailFailureCopy?.applyLabel || getHistoryReuseLabel(detailPayload)}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => selectedResultUrl && downloadHistoryResult(detailRow, selectedResultUrl, selectedResultIndex)}
                      disabled={!selectedResultUrl}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/80 bg-white/85 px-3 text-xs font-bold text-slate-700 shadow-sm hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" /> 下载结果
                    </button>
                  </div>
                </section>

                <section>
                  <h4 className="mb-2 text-xs font-bold text-gray-900">生成信息</h4>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    {getParameterItems(detailRow).map((item) => (
                      <div key={item.label} className="min-w-0 border-b border-gray-100 pb-2">
                        <p className="text-[10px] text-gray-400">{item.label}</p>
                        <p className="mt-0.5 break-words text-xs font-medium text-gray-800">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </section>

                {detailFailureCopy && (
                  <section>
                    <HistoryFailureNotice copy={detailFailureCopy} />
                  </section>
                )}

                {detailImages.length > 0 && (
                  <section>
                    <h4 className="mb-2 text-xs font-bold text-gray-900">输入图片</h4>
                    <div className="grid grid-cols-3 gap-2">
                      {detailImages.map((image, index) => (
                        <button
                          type="button"
                          key={`${image.label}-${index}`}
                          onClick={() => setLightboxSrc(image.url)}
                          className="group min-w-0 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                        >
                          <div className="relative h-24 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 shadow-sm transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md">
                            <HistoryMediaPreview
                              url={image.url}
                              variant="thumb"
                              className="transition duration-300 group-hover:scale-110 group-focus-visible:scale-110"
                              alt={image.label}
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/0 transition duration-200 group-hover:bg-slate-950/18 group-focus-visible:bg-slate-950/18">
                              <span className="flex h-8 w-8 scale-90 items-center justify-center rounded-full border border-white/70 bg-white/85 text-gray-700 opacity-0 shadow-sm backdrop-blur transition duration-200 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100">
                                <ZoomIn className="h-4 w-4" />
                              </span>
                            </div>
                          </div>
                          <p className="mt-1 truncate text-[10px] text-gray-500">{image.label}</p>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {detailPrompt && (
                  <section>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h4 className="text-xs font-bold text-gray-900">提示词 / 用户输入</h4>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(detailPrompt);
                          toast.success("提示词已复制");
                        }}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] text-gray-500 hover:text-[var(--codex-accent)]"
                      >
                        <Copy className="w-3 h-3" />
                        复制
                      </button>
                    </div>
                    <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">{detailPrompt}</pre>
                  </section>
                )}

                {detailPayload && (
                  <div className="sticky bottom-0 -mx-4 -mb-4 border-t bg-white/95 p-4 backdrop-blur sm:-mx-5 sm:-mb-5 sm:p-5 lg:hidden">
                    <button
                      onClick={() => {
                        router.push(getApplyPath(detailPayload.kind, detailRow.id));
                      }}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-full gradient-brand px-4 py-2 text-xs font-medium text-white"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {detailFailureCopy?.applyLabel || "套用参数"}
                    </button>
                  </div>
                )}
              </aside>
            </div>
          </div>
          </div>
        </ClientPortal>
      )}
      {lightboxSrc && (
        <ClientPortal>
          <div
            className="fixed inset-0 z-[180] flex cursor-zoom-out items-center justify-center bg-slate-950/35 p-5 backdrop-blur-xl"
            onClick={() => setLightboxSrc(null)}
          >
          <div className="flex max-h-full max-w-full items-center justify-center rounded-[28px] border border-white/70 bg-white/75 p-4 shadow-[0_28px_90px_rgba(15,23,42,0.32)] backdrop-blur-2xl">
            <HistoryMediaPreview
              url={lightboxSrc}
              variant="preview"
              className="max-h-[86vh] max-w-full rounded-[20px] object-contain shadow-2xl"
              alt="历史记录大图预览"
              controls
            />
          </div>
          <button
            type="button"
            onClick={() => setLightboxSrc(null)}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/85 bg-white/90 text-slate-700 shadow-[0_12px_34px_rgba(15,23,42,0.22)] backdrop-blur transition-colors hover:bg-white hover:text-slate-950 sm:right-6 sm:top-6"
            aria-label="关闭历史记录大图预览"
          >
            <X className="w-5 h-5" />
          </button>
          </div>
        </ClientPortal>
      )}
    </div>
  );
}

function HistoryLoadingSkeleton() {
  return (
    <div className="studio-workbench history-workbench min-h-[calc(100dvh-64px)] px-4 py-6 sm:py-8">
      <HistorySkeletonStyles />
      <div className="mx-auto mb-6 flex max-w-7xl flex-col gap-4 rounded-[28px] border border-white/80 bg-white/72 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur-2xl sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-3">
          <SkeletonBlock className="h-3 w-16 rounded-full" />
          <SkeletonBlock className="h-8 w-36 rounded-xl" />
          <SkeletonBlock className="h-4 w-44 rounded-full" />
        </div>
        <SkeletonBlock className="h-10 w-full rounded-full sm:w-28" />
      </div>
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <HistoryCardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}

function HistoryCardSkeleton() {
  return (
    <article className="history-skeleton-card overflow-hidden rounded-2xl border border-white/80 bg-white/85 shadow-sm">
      <div className="flex flex-col sm:flex-row">
        <SkeletonBlock className="aspect-[4/5] rounded-none sm:w-44 sm:flex-shrink-0 sm:aspect-[3/4] md:w-52" />
        <div className="flex flex-1 flex-col p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <SkeletonBlock className="h-5 w-24 rounded-full" />
              <SkeletonBlock className="h-3 w-20 rounded-full" />
            </div>
            <SkeletonBlock className="h-7 w-14 rounded-full" />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <SkeletonBlock className="h-3 w-8 rounded-full" />
              <SkeletonBlock className="h-4 w-16 rounded-full" />
            </div>
            <div className="space-y-2">
              <SkeletonBlock className="h-3 w-8 rounded-full" />
              <SkeletonBlock className="h-4 w-12 rounded-full" />
            </div>
            <div className="space-y-2">
              <SkeletonBlock className="h-3 w-8 rounded-full" />
              <SkeletonBlock className="h-4 w-10 rounded-full" />
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            <SkeletonBlock className="h-8 w-24 rounded-full" />
            <SkeletonBlock className="h-8 w-16 rounded-full" />
            <SkeletonBlock className="h-8 w-16 rounded-full" />
          </div>
        </div>
      </div>
    </article>
  );
}

function DetailLoadingSkeleton() {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/25 p-3 backdrop-blur-xl sm:p-6">
      <div className="grid max-h-[86vh] w-full max-w-5xl overflow-hidden rounded-[28px] border border-white/75 bg-white/85 shadow-[0_28px_90px_rgba(15,23,42,0.28)] backdrop-blur-2xl lg:grid-cols-[minmax(0,1.2fr)_340px]">
        <div className="bg-[#eef0f3] p-5">
          <div className="mb-4 flex items-center justify-between">
            <SkeletonBlock className="h-4 w-20 rounded-full" />
            <SkeletonBlock className="h-8 w-24 rounded-full" />
          </div>
          <SkeletonBlock className="h-[52vh] min-h-72 rounded-[24px]" />
          <div className="mt-4 flex items-center gap-3">
            <SkeletonBlock className="h-2 flex-1 rounded-full" />
            <SkeletonBlock className="h-8 w-16 rounded-full" />
          </div>
        </div>
        <div className="space-y-5 bg-white/75 p-5">
          <div className="space-y-3">
            <SkeletonBlock className="h-4 w-20 rounded-full" />
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="space-y-2 border-b border-gray-100 pb-2">
                  <SkeletonBlock className="h-3 w-12 rounded-full" />
                  <SkeletonBlock className="h-4 w-16 rounded-full" />
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <SkeletonBlock className="h-4 w-20 rounded-full" />
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <SkeletonBlock key={index} className="h-24 rounded-xl" />
              ))}
            </div>
          </div>
          <SkeletonBlock className="h-32 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`history-skeleton ${className}`} />;
}

function HistoryFailureNotice({ copy }: { copy: HistoryFailureRecoveryCopy }) {
  return (
    <div className="mt-3 rounded-xl border border-red-100 bg-red-50/80 px-3 py-2 text-xs leading-5 text-red-700">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-bold">{copy.title}</p>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold text-red-500">
          {copy.applyLabel}
        </span>
      </div>
      <dl className="mt-2 space-y-1.5">
        <div>
          <dt className="text-[10px] font-black uppercase text-red-400">{copy.reasonLabel}</dt>
          <dd className="mt-0.5 font-medium text-red-700">{copy.reason}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-black uppercase text-red-400">{copy.recoveryLabel}</dt>
          <dd className="mt-0.5 text-red-600">{copy.recoveryHint}</dd>
        </div>
      </dl>
    </div>
  );
}

function HistoryMediaPreview({
  url,
  variant,
  className = "",
  alt,
  style,
  controls = false,
}: {
  url: string;
  variant: "card" | "thumb" | "preview";
  className?: string;
  alt: string;
  style?: CSSProperties;
  controls?: boolean;
}) {
  const isVideo = isLikelyVideoUrl(url);
  const mediaClass = `${variant === "preview" ? "max-h-full max-w-full object-contain" : "h-full w-full object-cover"} ${className}`.trim();

  if (isVideo) {
    return (
      <span className={`relative block overflow-hidden bg-black ${variant === "preview" ? "max-h-full max-w-full" : "h-full w-full"}`}>
        <video
          src={url}
          className={mediaClass}
          style={style}
          controls={controls}
          muted={!controls}
          playsInline
          preload="metadata"
          onClick={(event) => {
            if (controls) event.stopPropagation();
          }}
        />
        {!controls && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/10 text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/58 shadow-sm backdrop-blur">
              <Play className="h-3.5 w-3.5 fill-current" />
            </span>
          </span>
        )}
      </span>
    );
  }

  return <RawPreviewImage src={getImageVariantUrl(url, variant)} className={mediaClass} style={style} alt={alt} />;
}

function HistorySkeletonStyles() {
  return (
    <style>{`
      .history-skeleton {
        position: relative;
        overflow: hidden;
        background: linear-gradient(110deg, #eef1f5 8%, #f8fafc 18%, #e7ebf1 33%);
        background-size: 220% 100%;
        animation: history-skeleton-sweep 1.35s ease-in-out infinite;
      }

      .history-skeleton::after {
        content: "";
        position: absolute;
        inset: 0;
        transform: translateX(-120%);
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.72), transparent);
        animation: history-skeleton-glow 1.6s ease-in-out infinite;
      }

      .history-skeleton-card {
        animation: history-skeleton-float 2.8s ease-in-out infinite;
      }

      .history-skeleton-card:nth-child(2n) {
        animation-delay: 0.16s;
      }

      .history-skeleton-card:nth-child(3n) {
        animation-delay: 0.28s;
      }

      @keyframes history-skeleton-sweep {
        0% { background-position: 120% 0; }
        100% { background-position: -120% 0; }
      }

      @keyframes history-skeleton-glow {
        0% { transform: translateX(-120%); }
        55%, 100% { transform: translateX(120%); }
      }

      @keyframes history-skeleton-float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-3px); }
      }

      @media (prefers-reduced-motion: reduce) {
        .history-skeleton,
        .history-skeleton::after,
        .history-skeleton-card {
          animation: none;
        }
      }
    `}</style>
  );
}

function formatKind(kind?: HistoryJobPayload["kind"]) {
  if (kind === "tryon") return "服装上身";
  if (kind === "grass") return "服装种草图";
  if (kind === "productSet") return "商品套图";
  if (kind === "modelBackground") return "模特换背景";
  if (kind === "materialEnhancement") return "材质增强";
  if (kind === "generalImage") return "通用生图";
  if (kind === "outfitFusion") return "搭配融图";
  if (kind === "garment3d") return "服装转3D";
  if (kind === "faceSwap") return "换脸";
  if (kind === "model") return "专属模特";
  if (kind === "pose") return "姿势裂变";
  if (kind === "videoImageToVideo") return "图生视频";
  if (kind === "videoMotion") return "动作模仿";
  if (kind === "videoFirstLastFrame") return "首尾帧";
  return "未知模块";
}

function formatStatus(status: string) {
  const normalizedStatus = normalizeHistoryStatusFilter(status);
  if (normalizedStatus === "completed") return "已完成";
  if (normalizedStatus === "failed") return "失败";
  if (normalizedStatus === "processing") return "处理中";
  if (normalizedStatus === "pending") return "排队中";
  return status;
}

function formatGrassSceneMode(mode?: string) {
  if (mode === "custom_prompt") return "用户自定义";
  if (mode === "upload_reference") return "上传参考图";
  if (mode === "system_reference") return "系统参考图";
  return "-";
}

function formatGrassSceneBackgroundMode(mode?: string) {
  if (mode === "similar_style") return "AI 重构相似场景";
  if (mode === "reference_scene" || !mode) return "沿用参考场景";
  return "-";
}

function getStatusClasses(status: string) {
  const normalizedStatus = normalizeHistoryStatusFilter(status);
  if (normalizedStatus === "completed") return "bg-[var(--codex-success)]/10 text-[var(--codex-success)]";
  if (normalizedStatus === "failed") return "bg-[var(--codex-danger)]/10 text-[var(--codex-danger)]";
  if (normalizedStatus === "processing") return "bg-[var(--codex-warning)]/10 text-[var(--codex-warning)]";
  if (normalizedStatus === "pending") return "bg-[var(--codex-accent)]/10 text-[var(--codex-accent)]";
  return "bg-[var(--codex-glass-fill)] text-[var(--codex-faint)]";
}

class HistoryAuthError extends Error {}

async function requestHistoryPage({
  cursor,
  moduleFilter,
  statusFilter,
  signal,
}: {
  cursor?: string | null;
  moduleFilter?: HistoryModuleFilter;
  statusFilter?: HistoryStatusFilter;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE) });
  if (cursor) params.set("cursor", cursor);
  if (moduleFilter && moduleFilter !== "all") params.set("module", moduleFilter);
  if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);

  const res = await fetch(`/api/history?${params.toString()}`, {
    method: "GET",
    signal,
    cache: "no-store",
  });

  if (res.status === 401) {
    throw new HistoryAuthError("请先登录");
  }

  const payload = await res.json().catch(() => ({})) as HistoryListPayload;

  if (!res.ok) {
    throw new Error(payload.error || `历史记录加载失败 (${res.status})`);
  }

  return payload;
}

function downloadHistoryResult(row: HistoryRow, url: string, index: number) {
  const ext = inferMediaExtension(url, isLikelyVideoUrl(url) ? "mp4" : "png");
  const dateStr = row.created_at
    ? new Date(row.created_at).toISOString().slice(0, 10).replace(/-/g, "")
    : "";
  const filename = dateStr
    ? `vastweargen-history-${dateStr}-${String(index + 1).padStart(2, "0")}.${ext}`
    : generateDownloadFilename("history", index, ext);

  downloadImage(url, filename);
}

function getRowPayload(row: HistoryRow) {
  const payload = row.job_payload;
  if (!payload || typeof payload !== "object") return undefined;

  const kind = (payload as { kind?: unknown }).kind;
  if (kind === "tryon" || kind === "grass" || kind === "productSet" || kind === "modelBackground" || kind === "materialEnhancement" || kind === "generalImage" || kind === "outfitFusion" || kind === "garment3d" || kind === "model" || kind === "pose" || kind === "faceSwap" || kind === "videoImageToVideo" || kind === "videoMotion" || kind === "videoFirstLastFrame") {
    return payload as HistoryJobPayload;
  }

  return undefined;
}

function getPromptText(payload: HistoryJobPayload) {
  if (payload.kind === "tryon") {
    if (payload.rawPrompt?.trim()) return payload.rawPrompt;

    return buildTryOnPrompt({
      model: payload.aiModel,
      clothingCount: payload.clothingUrls.length || 1,
      clothingMode: payload.clothingMode,
      clothingRoles: payload.clothingRoles,
      clothingAnalysis: payload.clothingAnalysis,
      garmentAudience: payload.garmentAudience,
      ageGroup: payload.ageGroup,
      aspectRatio: payload.aspectRatio,
      hasModelFace: !!payload.modelFaceUrl,
      hasReference: !!payload.referenceUrl,
      referenceAnalysis: payload.referenceAnalyses?.[0] || null,
      style: payload.style || undefined,
    }).prompt;
  }
  if (payload.kind === "productSet") {
    return payload.productInfo?.trim() || payload.prompt || "";
  }
  if (payload.kind === "outfitFusion") {
    return getOutfitFusionDisplayPrompt(payload.userPrompt || payload.prompt);
  }
  if (payload.kind === "videoMotion") {
    return payload.prompt || "";
  }
  if (payload.kind === "videoFirstLastFrame") {
    return payload.prompt || "";
  }
  return payload.prompt || "";
}

function getHistoryInputSummary(payload?: HistoryJobPayload) {
  if (!payload) return "打开详情后可加载完整输入参数";

  if (payload.kind === "tryon") {
    const mode = payload.clothingMode === "multi" ? "多件上身" : "单件上身";
    const modelFace = payload.modelFaceUrl ? "模特脸" : "无模特脸";
    const referenceCount = getTryonReferenceUrls(payload).length;
    const reference = referenceCount ? `${referenceCount} 张参考图` : "无参考图";
    return `${mode} · ${payload.clothingUrls.length} 张服装 · ${modelFace} · ${reference}`;
  }
  if (payload.kind === "grass") {
    const sceneControl = payload.sceneMode === "custom_prompt"
      ? "提示词场景"
      : formatGrassSceneBackgroundMode(payload.sceneBackgroundMode);
    return `服装图 · ${formatGrassSceneMode(payload.sceneMode)} · ${payload.changeModel ? "改变模特" : "保持模特"} · ${sceneControl}`;
  }
  if (payload.kind === "productSet") {
    return `${payload.productImageUrls.length} 张商品图 · ${payload.mode === "custom" ? "自定义套图" : "智能套图"}`;
  }
  if (payload.kind === "modelBackground") {
    const sourceCount = normalizeModelBackgroundSourceUrls(payload.sourceUrls, payload.sourceUrl).length || 1;
    return `${sourceCount} 张原图 · ${MODEL_BACKGROUND_MODE_LABELS[payload.mode]} · ${BACKGROUND_SOURCE_LABELS[payload.backgroundSource]}`;
  }
  if (payload.kind === "materialEnhancement") {
    return `原图 + 高清服装图 · ${payload.garmentType || "服装"} · ${getMaterialEnhancementLevelLabel(payload.enhancementLevel)}`;
  }
  if (payload.kind === "generalImage" || payload.kind === "outfitFusion") {
    return `${payload.kind === "outfitFusion" ? "搭配融图" : payload.mode === "text-to-image" ? "文生图" : "图生图"} · ${payload.referenceUrls.length} 张参考图`;
  }
  if (payload.kind === "model") {
    return `${payload.gender === "male" ? "男模" : "女模"} · ${payload.referenceUrls.length} 张人物参考 · ${getModelShootStyleLabel(payload.modelStyle)}`;
  }
  if (payload.kind === "pose") {
    const referenceCount = getPoseReferenceUrls(payload).length;
    return referenceCount
      ? `主图 · 参考图模式 · ${referenceCount} 张姿势参考`
      : `主图 · ${getPoseSeriesStyleLabel(payload.poseStyle)}`;
  }
  if (payload.kind === "videoImageToVideo") {
    return `输入图 · ${payload.templateTitle || "自定义动作"} · ${getVideoModeLabel(payload.modelMode)} · ${payload.resolution} · ${payload.aspectRatio || "9:16"} · ${payload.duration || 5}秒 · ${getVideoAudioLabel(payload)}`;
  }
  if (payload.kind === "videoMotion") {
    return `模特图 + 参考视频 · ${payload.templateTitle || "动作模仿"} · ${getVideoModeLabel(payload.modelMode)} · ${payload.resolution} · ${payload.aspectRatio || "9:16"} · ${payload.duration || 5}秒 · ${getVideoAudioLabel(payload)}`;
  }
  if (payload.kind === "videoFirstLastFrame") {
    return `首帧 + 尾帧 · ${getVideoModeLabel(payload.modelMode)} · ${payload.resolution} · ${payload.aspectRatio || "9:16"} · ${payload.duration || 5}秒 · ${getVideoAudioLabel(payload)}`;
  }
  if (payload.kind === "garment3d") {
    return `服装图 · ${payload.outputMode === "reference" ? "参考图模式" : "提示词模式"} · ${getGarment3dDisplayStyleLabel(payload.displayStyle)}`;
  }
  if (payload.kind === "faceSwap") {
    return `原始模特图 · 目标脸图 · ${getFaceSwapModeLabel(payload.faceSwapMode)}`;
  }
  return "已保存输入参数";
}

function getTryonReferenceUrls(payload: Extract<HistoryJobPayload, { kind: "tryon" }>) {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const value of [...(Array.isArray(payload.referenceUrls) ? payload.referenceUrls : []), payload.referenceUrl]) {
    if (typeof value !== "string" || !value.trim() || seen.has(value.trim())) continue;
    seen.add(value.trim());
    urls.push(value.trim());
  }
  return urls;
}

function getPoseReferenceUrls(payload: Extract<HistoryJobPayload, { kind: "pose" }>) {
  return uniqueUrlList(payload.poseReferenceUrls);
}

function getPoseGarmentAngleUrls(payload: Extract<HistoryJobPayload, { kind: "pose" }>) {
  const angleUrls = Array.isArray(payload.garmentAngleReferences)
    ? payload.garmentAngleReferences
        .map((item) => item && typeof item === "object" ? item.url : "")
        .filter((url): url is string => typeof url === "string" && url.trim().length > 0)
    : [];
  return uniqueUrlList(angleUrls.length ? angleUrls : payload.garmentDetailUrls);
}

function uniqueUrlList(value: unknown) {
  const seen = new Set<string>();
  const urls: string[] = [];
  if (!Array.isArray(value)) return urls;
  for (const item of value) {
    const url = typeof item === "string" ? item.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function getHistoryOutputSummary(row: HistoryRow, payload?: HistoryJobPayload) {
  const resultCount = row.result_urls?.length || 0;
  const model = payload?.aiModel || row.ai_model || "模型未记录";
  const size = getPayloadDisplaySize(payload) || row.image_size || "尺寸未记录";
  const status = formatStatus(row.status);
  const unit = payload?.kind === "videoImageToVideo" || payload?.kind === "videoMotion" || payload?.kind === "videoFirstLastFrame" ? "个视频" : "张结果";
  return `${status} · ${resultCount} ${unit} · ${model} · ${size}`;
}

function getPayloadDisplaySize(payload?: HistoryJobPayload) {
  if (!payload) return "";
  if (payload.kind === "videoImageToVideo" || payload.kind === "videoMotion" || payload.kind === "videoFirstLastFrame") {
    return `${payload.resolution} · ${payload.aspectRatio || "9:16"} · ${payload.duration || 5}秒`;
  }
  return "imageSize" in payload ? payload.imageSize : "";
}

function getVideoModeLabel(mode?: string) {
  return mode === "fast" ? "快速模式" : "高清模式";
}

function getVideoAudioLabel(payload: Extract<HistoryJobPayload, { kind: "videoImageToVideo" | "videoMotion" | "videoFirstLastFrame" }>) {
  if (payload.audioMode === "off" || payload.generateAudio === false) return "静音";
  if (payload.audioMode === "custom" || payload.audioUrl) return "上传音频";
  return "智能音效";
}

function getHistoryReuseLabel(payload?: HistoryJobPayload) {
  if (!payload?.kind) return "套用参数";
  return `复用到${formatKind(payload.kind)}`;
}

function getInputImages(payload: HistoryJobPayload) {
  if (payload.kind === "tryon") {
    const referenceUrls = getTryonReferenceUrls(payload);
    return [
      ...payload.clothingUrls.map((url, index) => ({
        label: payload.clothingRoles?.[index] ? TRYON_CLOTHING_ROLE_LABELS[payload.clothingRoles[index]] : `服装图${index + 1}`,
        url,
      })),
      ...referenceUrls.map((url, index) => ({ label: referenceUrls.length > 1 ? `参考图${index + 1}` : "参考图", url })),
      ...(payload.modelFaceUrl ? [{ label: "模特脸", url: payload.modelFaceUrl }] : []),
    ];
  }
  if (payload.kind === "garment3d") {
    return [
      { label: "服装图", url: payload.garmentUrl },
      ...(payload.referenceUrl ? [{ label: "3D参考图", url: payload.referenceUrl }] : []),
    ];
  }
  if (payload.kind === "grass") {
    return [
      { label: "服装图", url: payload.garmentUrl },
      ...(payload.referenceUrl ? [{ label: "种草参考图", url: payload.referenceUrl }] : []),
    ];
  }
  if (payload.kind === "productSet") {
    return payload.productImageUrls.map((url, index) => ({ label: `商品图${index + 1}`, url }));
  }
  if (payload.kind === "modelBackground") {
    return [
      ...normalizeModelBackgroundSourceUrls(payload.sourceUrls, payload.sourceUrl).map((url, index) => ({ label: `原图${index + 1}`, url })),
      ...(payload.modelReferenceUrl ? [{ label: "模特参考", url: payload.modelReferenceUrl }] : []),
      ...(payload.backgroundReferenceUrl ? [{ label: "背景参考", url: payload.backgroundReferenceUrl }] : []),
    ];
  }
  if (payload.kind === "materialEnhancement") {
    return [
      { label: "原图", url: payload.sourceUrl },
      { label: "高清服装图", url: payload.garmentUrl },
    ];
  }
  if (payload.kind === "generalImage" || payload.kind === "outfitFusion") {
    const labelPrefix = payload.kind === "outfitFusion" ? "输入图" : "参考图";
    return payload.referenceUrls.map((url, index) => ({ label: `${labelPrefix}${index + 1}`, url }));
  }
  if (payload.kind === "model") {
    return [
      ...payload.referenceUrls.map((url, index) => ({ label: `人物图${index + 1}`, url })),
      ...(payload.hairReferenceUrl ? [{ label: "发型参考", url: payload.hairReferenceUrl }] : []),
      ...(payload.hairColorReferenceUrl ? [{ label: "发色参考", url: payload.hairColorReferenceUrl }] : []),
    ];
  }
  if (payload.kind === "pose") {
    return [
      { label: "主图", url: payload.mainImageUrl },
      ...getPoseReferenceUrls(payload).map((url, index) => ({ label: `姿势参考图${index + 1}`, url })),
      ...getPoseGarmentAngleUrls(payload).map((url, index) => ({ label: `服装角度图${index + 1}`, url })),
    ];
  }
  if (payload.kind === "videoImageToVideo") {
    return [{ label: "输入图", url: payload.imageUrl }];
  }
  if (payload.kind === "videoMotion") {
    return [
      { label: "模特图", url: payload.modelImageUrl },
      { label: "参考视频", url: payload.referenceVideoUrl },
    ];
  }
  if (payload.kind === "videoFirstLastFrame") {
    return [
      { label: "首帧", url: payload.firstFrameUrl },
      { label: "尾帧", url: payload.lastFrameUrl },
    ];
  }
  if (payload.kind === "faceSwap") {
    return [
      { label: "原始模特图", url: payload.sourceUrl },
      { label: "目标脸图", url: payload.faceUrl },
    ];
  }
  return [];
}

function getParameterItems(row: HistoryRow) {
  const payload = getRowPayload(row);
  const common = [
    { label: "模块", value: formatKind(payload?.kind) },
    { label: "状态", value: formatStatus(row.status) },
    { label: "模型", value: String(payload?.aiModel || row.ai_model || "-") },
    { label: "尺寸", value: String(getPayloadDisplaySize(payload) || row.image_size || "-") },
    { label: "灵点", value: String(row.credits_cost || row.credits_used || "-") },
  ];
  if (!payload) return common;

  if (payload.kind === "tryon") {
    return [
      ...common,
      { label: "比例", value: payload.aspectRatio },
      { label: "生成张数", value: String(payload.genCount) },
      { label: "上身模式", value: payload.clothingMode === "multi" ? "多件上身" : "单件上身" },
      { label: "服装角色", value: payload.clothingRoles?.map((role) => TRYON_CLOTHING_ROLE_LABELS[role]).join("、") || "-" },
      { label: "服装数量", value: String(payload.clothingUrls.length) },
      { label: "模特脸", value: payload.modelFaceUrl ? "已使用" : "未使用" },
      { label: "参考图", value: `${getTryonReferenceUrls(payload).length} 张` },
      { label: "场景模式", value: payload.sceneMode ? SCENE_MODE_LABELS[payload.sceneMode] : "-" },
      { label: "自动设计", value: payload.autoDesign ? AUTO_DESIGN_PLATFORMS.find((item) => item.value === payload.autoDesign?.platform)?.label || "已使用" : "未使用" },
    ];
  }
  if (payload.kind === "garment3d") {
    return [
      ...common,
      { label: "比例", value: payload.aspectRatio },
      { label: "生成张数", value: String(payload.genCount) },
      { label: "服装类型", value: payload.garmentType || "-" },
      { label: "输出模式", value: payload.outputMode === "reference" ? "参考图模式" : "提示词模式" },
      { label: "展示质感", value: getGarment3dDisplayStyleLabel(payload.displayStyle) },
      { label: "3D参考图", value: payload.referenceUrl ? "已使用" : "未使用" },
    ];
  }
  if (payload.kind === "model") {
    return [
      ...common,
      { label: "比例", value: payload.aspectRatio },
      { label: "生成张数", value: String(payload.genCount) },
      { label: "性别", value: payload.gender === "male" ? "男" : "女" },
      { label: "模特风格", value: getModelShootStyleLabel(payload.modelStyle) },
      { label: "人物参考", value: String(payload.referenceUrls.length) },
      { label: "发型", value: payload.hairStyle || "-" },
      { label: "发色", value: payload.hairColor || "-" },
      { label: "发型参考", value: payload.hairReferenceUrl ? "已使用" : "未使用" },
      { label: "发色参考", value: payload.hairColorReferenceUrl ? "已使用" : "未使用" },
    ];
  }
  if (payload.kind === "grass") {
    return [
      ...common,
      { label: "比例", value: payload.aspectRatio },
      { label: "生成张数", value: String(payload.genCount) },
      { label: "模板", value: payload.templateId },
      { label: "场景模式", value: formatGrassSceneMode(payload.sceneMode) },
      { label: "场景控制", value: payload.sceneMode === "custom_prompt" ? "提示词场景" : formatGrassSceneBackgroundMode(payload.sceneBackgroundMode) },
      { label: "种草参考图", value: payload.referenceUrl ? "已使用" : "未使用" },
      { label: "模特控制", value: payload.changeModel ? "改变模特" : "保持模特" },
    ];
  }
  if (payload.kind === "productSet") {
    return [
      ...common,
      { label: "比例", value: payload.aspectRatio },
      { label: "生成张数", value: String(payload.genCount) },
      { label: "创作模式", value: payload.mode === "custom" ? "自定义套图" : "智能套图" },
      { label: "生图类型", value: payload.imageType === "details" ? "详情页图" : "主图/辅图" },
      { label: "商品图", value: `${payload.productImageUrls.length} 张` },
      { label: "目标平台", value: payload.settings?.platform || "-" },
      { label: "目标地区", value: payload.settings?.country || "-" },
      { label: "文案语言", value: payload.settings?.language || "-" },
      { label: "模板数量", value: String(payload.selectedTemplateIds?.length || payload.customTemplates?.length || payload.genCount) },
    ];
  }
  if (payload.kind === "modelBackground") {
    const sourceCount = normalizeModelBackgroundSourceUrls(payload.sourceUrls, payload.sourceUrl).length || 1;
    return [
      ...common,
      { label: "比例", value: payload.aspectRatio },
      { label: "原图数量", value: `${sourceCount} 张` },
      { label: "生成张数", value: sourceCount > 1 ? `${sourceCount} × ${payload.genCount} = ${sourceCount * payload.genCount}` : String(payload.genCount) },
      { label: "操作模式", value: MODEL_BACKGROUND_MODE_LABELS[payload.mode] },
      { label: "背景来源", value: BACKGROUND_SOURCE_LABELS[payload.backgroundSource] },
      { label: "背景模板", value: payload.templateId },
      { label: "模特参考", value: payload.modelReferenceUrl ? "已使用" : "未使用" },
      { label: "背景参考", value: payload.backgroundReferenceUrl ? "已使用" : "未使用" },
    ];
  }
  if (payload.kind === "materialEnhancement") {
    return [
      ...common,
      { label: "比例", value: payload.aspectRatio },
      { label: "生成张数", value: String(payload.genCount) },
      { label: "服装类型", value: payload.garmentType || "-" },
      { label: "增强方式", value: getMaterialEnhancementLevelLabel(payload.enhancementLevel) },
      { label: "高清服装图", value: payload.garmentUrl ? "已使用" : "未使用" },
    ];
  }
  if (payload.kind === "generalImage" || payload.kind === "outfitFusion") {
    return [
      ...common,
      { label: "模式", value: payload.kind === "outfitFusion" ? "搭配融图" : payload.mode === "text-to-image" ? "文生图" : "图生图" },
      { label: "比例", value: payload.aspectRatio },
      { label: "生成张数", value: String(payload.genCount) },
      { label: payload.kind === "outfitFusion" ? "输入素材" : "参考图", value: `${payload.referenceUrls.length} 张` },
    ];
  }
  if (payload.kind === "pose") {
    const referenceCount = getPoseReferenceUrls(payload).length;
    const referenceCopies = Math.max(1, Math.floor(Number(payload.poseReferenceCopies || 1)));
    const poseCount = payload.genCount || payload.poseCount || (referenceCount ? referenceCount * referenceCopies : 1);
    return [
      ...common,
      { label: "比例", value: payload.aspectRatio || "智能" },
      { label: "生成张数", value: String(poseCount) },
      { label: "创作模式", value: referenceCount ? "参考图模式" : "自由模式" },
      ...(referenceCount ? [
        { label: "姿势参考", value: `${referenceCount} 张` },
        { label: "每张数量", value: String(referenceCopies) },
      ] : []),
      { label: "拍摄风格", value: getPoseSeriesStyleLabel(payload.poseStyle) },
    ];
  }
  if (payload.kind === "videoImageToVideo") {
    return [
      ...common,
      { label: "生成模式", value: getVideoModeLabel(payload.modelMode) },
      { label: "比例", value: payload.aspectRatio || "9:16" },
      { label: "视频时长", value: `${payload.duration || 5}秒` },
      { label: "生成数量", value: String(payload.genCount || 1) },
      { label: "分辨率", value: payload.resolution },
      { label: "音效", value: getVideoAudioLabel(payload) },
      { label: "音频控制", value: payload.audioPrompt || "-" },
      { label: "动作模板", value: payload.templateTitle || "-" },
    ];
  }
  if (payload.kind === "videoMotion") {
    return [
      ...common,
      { label: "生成模式", value: getVideoModeLabel(payload.modelMode) },
      { label: "比例", value: payload.aspectRatio || "9:16" },
      { label: "视频时长", value: `${payload.duration || 5}秒` },
      { label: "生成数量", value: String(payload.genCount || 1) },
      { label: "分辨率", value: payload.resolution },
      { label: "音效", value: getVideoAudioLabel(payload) },
      { label: "音频控制", value: payload.audioPrompt || "-" },
      { label: "视频模型", value: "HappyHorse" },
      { label: "动作模板", value: payload.templateTitle || "-" },
      { label: "参考视频", value: payload.referenceVideoUrl ? "已使用" : "未使用" },
    ];
  }
  if (payload.kind === "videoFirstLastFrame") {
    return [
      ...common,
      { label: "生成模式", value: getVideoModeLabel(payload.modelMode) },
      { label: "比例", value: payload.aspectRatio || "9:16" },
      { label: "视频时长", value: `${payload.duration || 5}秒` },
      { label: "生成数量", value: String(payload.genCount || 1) },
      { label: "分辨率", value: payload.resolution },
      { label: "音效", value: getVideoAudioLabel(payload) },
      { label: "音频控制", value: payload.audioPrompt || "-" },
      { label: "首帧", value: payload.firstFrameUrl ? "已使用" : "未使用" },
      { label: "尾帧", value: payload.lastFrameUrl ? "已使用" : "未使用" },
    ];
  }
  if (payload.kind === "faceSwap") {
    const faceSwapMode = normalizeFaceSwapMode(payload.faceSwapMode);
    return [
      ...common,
      { label: "比例", value: payload.aspectRatio },
      { label: "生成张数", value: String(payload.genCount) },
      { label: "换脸范围", value: getFaceSwapModeLabel(faceSwapMode) },
      { label: "原始模特图", value: payload.sourceUrl ? "已使用" : "未使用" },
      { label: "目标脸图", value: payload.faceUrl ? "已使用" : "未使用" },
      { label: "规则", value: getFaceSwapModeNote(faceSwapMode) },
    ];
  }
  return common;
}
