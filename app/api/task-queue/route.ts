import { isRecord, withTimeout, toLogMessage } from "@/lib/utils";
import { NextResponse } from "next/server";
import { API_RATE_LIMITS, enforceApiRateLimit, rateLimitResponse } from "@/lib/api/rate-limit";
import { getReadAuthenticatedUser } from "@/lib/api/read-auth";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  GENERATION_FAILED_STATUS_FILTERS,
  GENERATION_PENDING_STATUS_FILTERS,
  GENERATION_RUNNING_STATUS_FILTERS,
  normalizeGenerationState,
} from "@/lib/api/generation-state";
import {
  getCachedTaskQueue,
  getCachedTaskSummary,
  warmTaskQueueCache,
  writeCachedTaskSummary,
} from "@/lib/redis/task-queue-cache";
import type { TaskQueueItem, TaskStatusGroup } from "@/lib/task-queue";
import { TASK_RESULT_THUMBNAIL_LIMIT, normalizeModule } from "@/lib/task-queue-index";
import { getTryOnInputReferenceUrls, TRYON_INPUT_REFERENCE_LIMIT } from "@/lib/tryon-input-references";
import {
  loadTaskQueueItemsFromIndex,
  loadTaskQueueSummaryFromIndex,
} from "@/lib/task-queue-store";

const QUEUE_COLUMNS = [
  "id",
  "status",
  "error_message",
  "result_urls",
  "created_at",
  "completed_at",
  "processing_started_at",
  "job_payload",
  "clothing_urls",
  "model_face_url",
  "reference_url",
].join(",");

const SUMMARY_GENERATION_COLUMNS = [
  "status",
  "result_urls",
  "created_at",
  "completed_at",
  "processing_started_at",
  "job_payload",
].join(",");

const SUMMARY_WORKFLOW_COLUMNS = [
  "status",
  "created_at",
  "updated_at",
].join(",");

type QueueRow = {
  id: string;
  status: string;
  error_message?: string | null;
  result_urls?: string[] | null;
  created_at: string;
  completed_at?: string | null;
  processing_started_at?: string | null;
  job_payload?: Record<string, unknown> | null;
  clothing_urls?: string[] | null;
  model_face_url?: string | null;
  reference_url?: string | null;
};

type WorkflowRow = {
  id: string;
  status: string;
  intent?: string | null;
  summary?: string | null;
  input_images?: unknown[] | null;
  final_outputs?: Record<string, unknown> | null;
  cost_reserved?: number | null;
  cost_settled?: number | null;
  error_message?: string | null;
  created_at: string;
  updated_at?: string | null;
};

type QueueSummaryData = {
  totalTaskNum: number;
  finishedTaskNum: number;
  finishedNeedReadTaskNum: number;
  runningTaskNum: number;
  failedTaskNum: number;
};

type TaskQueueCacheMode = "redis" | "supabase" | "legacy";

const EMPTY_SUMMARY: QueueSummaryData = {
  totalTaskNum: 0,
  finishedTaskNum: 0,
  finishedNeedReadTaskNum: 0,
  runningTaskNum: 0,
  failedTaskNum: 0,
};

const RUNNING_WORKFLOW_STATUSES = ["queued", "running"];
const FAILED_WORKFLOW_STATUSES = ["failed", "cancelled", "canceled"];
const RUNNING_TASK_STALE_MS = getRunningTaskStaleMs();
const AUTH_CLAIMS_TIMEOUT_MS = 1_500;
const AUTH_USER_FALLBACK_TIMEOUT_MS = 3_000;
const READ_RATE_LIMIT_TIMEOUT_MS = 1_500;
const SUMMARY_QUERY_TIMEOUT_MS = 8_000;
const QUEUE_QUERY_TIMEOUT_MS = 15_000;
const INDEX_QUEUE_QUERY_TIMEOUT_MS = 1_500;
const INDEX_SUMMARY_QUERY_TIMEOUT_MS = 1_000;
const LIGHTWEIGHT_MODULE_PRIMARY_TIMEOUT_MS = 2_500;
const LIGHTWEIGHT_MODULE_FALLBACK_TIMEOUT_MS = 2_500;
const LIGHTWEIGHT_QUEUE_RATE_LIMIT = 240;
const LIGHTWEIGHT_QUEUE_RATE_WINDOW_MS = 60_000;
const RUNNING_QUEUE_PIN_LIMIT = 80;
const LIGHTWEIGHT_LEGACY_SCAN_LIMIT = 96;
const lightweightQueueBuckets = new Map<string, { count: number; resetAt: number }>();

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const summaryOnly = searchParams.get("summary") === "1" || searchParams.get("mode") === "summary";
    const includeSummary = summaryOnly || searchParams.get("summary") !== "0";
    const moduleFilter = normalizeModuleFilter(searchParams.get("module"));
    const searchQuery = (searchParams.get("q") || searchParams.get("query") || "").trim().toLowerCase();
    const limit = clampNumber(searchParams.get("limit"), 8, 80, 32);
    const cursor = searchParams.get("cursor");
    const lightweightModuleQueue = !includeSummary && Boolean(moduleFilter) && !cursor && !searchQuery;
    const supabase = await createServerSupabase({ readonlyCookies: true });
    const user = await getQueueUser(supabase);
    if (!user) return queueJson(summaryOnly ? summaryPayload(EMPTY_SUMMARY) : detailPayload([], EMPTY_SUMMARY));
    const rateLimit = lightweightModuleQueue
      ? checkLightweightQueueRateLimit(user.id)
      : await safeEnforceReadRateLimit(user.id);
    if (rateLimit) return rateLimit;

    const cacheMode = getTaskQueueCacheMode();
    if (lightweightModuleQueue) {
      const result = await loadLightweightModuleQueue(supabase, user.id, moduleFilter, limit);
      return queueJson(detailPayload(result.rows, EMPTY_SUMMARY, result.hasMore, result.nextCursor));
    }

    if (cacheMode !== "legacy") {
      const indexedResponse = await loadIndexedTaskQueueResponse({
        supabase,
        userId: user.id,
        summaryOnly,
        includeSummary,
        moduleFilter,
        searchQuery,
        limit,
        cursor,
        cacheMode,
      });
      if (indexedResponse) return indexedResponse;
    }

    const summary = includeSummary ? await loadQueueSummary(supabase, user.id) : EMPTY_SUMMARY;
    if (summaryOnly) return queueJson(summaryPayload(summary));

    let generationsQuery = supabase
      .from("generations")
      .select(QUEUE_COLUMNS)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (moduleFilter) generationsQuery = generationsQuery.eq("job_payload->>kind", moduleFilter);
    if (cursor) generationsQuery = generationsQuery.lt("created_at", cursor);

    const queryLimit = limit + 1;
    const { data, error } = await withTimeout(
      generationsQuery.limit(queryLimit),
      QUEUE_QUERY_TIMEOUT_MS,
      "generations list timeout"
    );

    if (error) {
      logTaskQueueWarning("generations list unavailable", error.message);
      return queueJson(detailPayload([], summary));
    }

    const rawRows = (Array.isArray(data) ? data : []) as unknown as QueueRow[];
    const generationRows = rawRows
      .filter((row) => !isHiddenByAdmin(row))
      .map(normalizeQueueRow)
      .filter((row) => !moduleFilter || row.module === moduleFilter);
    const pinnedGenerationRows = cursor ? [] : await loadRunningGenerationRows(supabase, user.id, moduleFilter);
    const workflowRows = moduleFilter ? [] : await loadWorkflowRows(supabase, user.id, cursor, limit + 1);
    const pinnedWorkflowRows = cursor || moduleFilter ? [] : await loadRunningWorkflowRows(supabase, user.id);
    const filteredRows = mergeQueueRows([
      ...pinnedGenerationRows,
      ...generationRows,
      ...pinnedWorkflowRows,
      ...workflowRows,
    ])
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .filter((row) => matchesSearch(row, searchQuery));
    const rows = filteredRows.slice(0, limit);
    const hasMore = filteredRows.length > limit || rawRows.length >= queryLimit || workflowRows.length > limit;
    const nextCursor = rows.length ? rows[rows.length - 1]?.createdAt || null : null;

    return queueJson(detailPayload(rows, summary, hasMore, hasMore ? nextCursor : null));
  } catch (error) {
    console.error("[task-queue] error:", toLogMessage(error));
    if (isLightweightModuleQueueRequest(request)) {
      return queueJson(detailPayload([], EMPTY_SUMMARY));
    }
    return NextResponse.json({ error: "任务队列加载失败" }, { status: 500 });
  }
}

async function safeEnforceReadRateLimit(userId: string) {
  try {
    return await withTimeout(
      enforceApiRateLimit(userId, API_RATE_LIMITS.taskQueueRead),
      READ_RATE_LIMIT_TIMEOUT_MS,
      "rate limit timeout"
    );
  } catch (error) {
    logTaskQueueWarning("rate limit unavailable", toLogMessage(error));
    return null;
  }
}

async function getQueueUser(supabase: Awaited<ReturnType<typeof createServerSupabase>>) {
  return getReadAuthenticatedUser(supabase, {
    claimsTimeoutMs: AUTH_CLAIMS_TIMEOUT_MS,
    userFallbackTimeoutMs: AUTH_USER_FALLBACK_TIMEOUT_MS,
    onWarning: logTaskQueueWarning,
  });
}

function checkLightweightQueueRateLimit(userId: string) {
  const now = Date.now();
  const existing = lightweightQueueBuckets.get(userId);

  if (!existing || existing.resetAt <= now) {
    cleanupLightweightQueueBuckets(now);
    lightweightQueueBuckets.set(userId, { count: 1, resetAt: now + LIGHTWEIGHT_QUEUE_RATE_WINDOW_MS });
    return null;
  }

  if (existing.count >= LIGHTWEIGHT_QUEUE_RATE_LIMIT) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return rateLimitResponse(retryAfterSeconds, {
      label: "任务列表刷新",
      limit: LIGHTWEIGHT_QUEUE_RATE_LIMIT,
      windowMs: LIGHTWEIGHT_QUEUE_RATE_WINDOW_MS,
    });
  }

  existing.count += 1;
  return null;
}

function isLightweightModuleQueueRequest(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    return (
      searchParams.get("summary") === "0"
      && Boolean(normalizeModuleFilter(searchParams.get("module")))
      && !searchParams.get("cursor")
      && !(searchParams.get("q") || searchParams.get("query"))
    );
  } catch {
    return false;
  }
}

function cleanupLightweightQueueBuckets(now: number) {
  if (lightweightQueueBuckets.size < 1000) return;
  for (const [key, bucket] of lightweightQueueBuckets) {
    if (bucket.resetAt <= now) lightweightQueueBuckets.delete(key);
  }
}

async function loadIndexedTaskQueueResponse(args: {
  supabase: Awaited<ReturnType<typeof createServerSupabase>>;
  userId: string;
  summaryOnly: boolean;
  includeSummary: boolean;
  moduleFilter: string;
  searchQuery: string;
  limit: number;
  cursor: string | null;
  cacheMode: TaskQueueCacheMode;
}): Promise<NextResponse | null> {
  const moduleFilter = args.moduleFilter ? normalizeModule(args.moduleFilter) : "";
  let summary: QueueSummaryData = EMPTY_SUMMARY;
  let summaryLoaded = false;

  if (args.includeSummary) {
    if (args.cacheMode === "redis") {
      const cachedSummary = await getCachedTaskSummary(args.userId);
      if (cachedSummary.hit) {
        summary = cachedSummary.value;
        summaryLoaded = true;
      }
    }

    if (!summaryLoaded) {
      const loadedSummary = await withTimeout(
        loadTaskQueueSummaryFromIndex(args.supabase, args.userId),
        INDEX_SUMMARY_QUERY_TIMEOUT_MS,
        "task queue index summary timeout"
      ).catch((error) => ({ ok: false as const, error: toLogMessage(error) }));

      if (!loadedSummary.ok) {
        logTaskQueueWarning("task queue index summary unavailable", loadedSummary.error);
        return null;
      }

      summary = loadedSummary.summary;
      summaryLoaded = true;
      if (args.cacheMode === "redis") {
        await writeCachedTaskSummary(args.userId, summary);
      }
    }
  }

  if (args.summaryOnly) {
    return queueJson(summaryPayload(summary));
  }

  if (args.cacheMode === "redis" && moduleFilter && !args.cursor && !args.searchQuery) {
    const cachedRows = await getCachedTaskQueue(args.userId, moduleFilter, args.limit);
    if (cachedRows.hit) {
      const rows = cachedRows.value.slice(0, args.limit);
      return queueJson(
        detailPayload(
          rows,
          summary,
          cachedRows.value.length >= args.limit,
          rows.length ? rows[rows.length - 1]?.createdAt || null : null
        )
      );
    }
  }

  const loadedRows = await withTimeout(
    loadTaskQueueItemsFromIndex(args.supabase, {
      userId: args.userId,
      module: moduleFilter || undefined,
      limit: args.limit,
      cursor: args.cursor,
      searchQuery: args.searchQuery,
    }),
    INDEX_QUEUE_QUERY_TIMEOUT_MS,
    "task queue index list timeout"
  ).catch((error) => ({ ok: false as const, error: toLogMessage(error) }));

  if (!loadedRows.ok) {
    logTaskQueueWarning("task queue index list unavailable", loadedRows.error);
    return null;
  }

  if (args.cacheMode === "redis" && moduleFilter && !args.cursor && !args.searchQuery) {
    await warmTaskQueueCache(args.userId, moduleFilter, loadedRows.rows);
  }

  return queueJson(detailPayload(loadedRows.rows, summary, loadedRows.hasMore, loadedRows.nextCursor));
}

function getTaskQueueCacheMode(): TaskQueueCacheMode {
  const value = (process.env.TASK_QUEUE_CACHE_MODE || "redis").trim().toLowerCase();
  if (value === "legacy" || value === "supabase" || value === "redis") {
    return value;
  }
  return "redis";
}

async function loadQueueSummary(supabase: Awaited<ReturnType<typeof createServerSupabase>>, userId: string): Promise<QueueSummaryData> {
  const [
    generationTotal,
    generationFailed,
    generationRunningBuckets,
    workflowTotal,
    workflowFailed,
    workflowRunningBuckets,
  ] = await Promise.all([
    countRows(
      supabase
        .from("generations")
        .select("id", { count: "planned", head: true })
        .eq("user_id", userId),
      "generations total"
    ),
    countRows(
      supabase
        .from("generations")
        .select("id", { count: "planned", head: true })
        .eq("user_id", userId)
        .in("status", [...GENERATION_FAILED_STATUS_FILTERS]),
      "generations failed"
    ),
    loadRunningGenerationBuckets(supabase, userId),
    countRows(
      supabase
        .from("agent_workflows")
        .select("id", { count: "planned", head: true })
        .eq("user_id", userId),
      "workflows total",
      true
    ),
    countRows(
      supabase
        .from("agent_workflows")
        .select("id", { count: "planned", head: true })
        .eq("user_id", userId)
        .in("status", FAILED_WORKFLOW_STATUSES),
      "workflows failed",
      true
    ),
    loadRunningWorkflowBuckets(supabase, userId),
  ]);

  const totalTaskNum = generationTotal + workflowTotal;
  const runningTaskNum = generationRunningBuckets.running + workflowRunningBuckets.running;
  const failedTaskNum = generationFailed + generationRunningBuckets.failed + workflowFailed + workflowRunningBuckets.failed;
  const finishedTaskNum = Math.max(0, totalTaskNum - runningTaskNum - failedTaskNum);

  return {
    totalTaskNum,
    finishedTaskNum,
    finishedNeedReadTaskNum: 0,
    runningTaskNum,
    failedTaskNum,
  };
}

async function loadRunningGenerationBuckets(supabase: Awaited<ReturnType<typeof createServerSupabase>>, userId: string) {
  try {
    const { data, error } = await withTimeout(
      supabase
        .from("generations")
        .select(SUMMARY_GENERATION_COLUMNS)
        .eq("user_id", userId)
        .in("status", [...GENERATION_RUNNING_STATUS_FILTERS])
        .order("created_at", { ascending: false })
        .limit(RUNNING_QUEUE_PIN_LIMIT),
      SUMMARY_QUERY_TIMEOUT_MS,
      "generations running timeout"
    );

    if (error) {
      logTaskQueueWarning("generations running unavailable", error.message);
      return { running: 0, failed: 0 };
    }

    const rows = (Array.isArray(data) ? data : []) as unknown as QueueRow[];
    return rows.reduce((counts, row) => {
      const state = normalizeGenerationState({
        status: row.status,
        resultUrls: row.result_urls,
        payload: row.job_payload,
        completedAt: row.completed_at,
      });
      if (state.statusGroup !== "running") {
        if (state.status === "failed") counts.failed += 1;
        return counts;
      }
      counts.running += 1;
      return counts;
    }, { running: 0, failed: 0 });
  } catch (error) {
    logTaskQueueWarning("generations running unavailable", toLogMessage(error));
    return { running: 0, failed: 0 };
  }
}

async function loadRunningWorkflowBuckets(supabase: Awaited<ReturnType<typeof createServerSupabase>>, userId: string) {
  try {
    const { data, error } = await withTimeout(
      supabase
        .from("agent_workflows")
        .select(SUMMARY_WORKFLOW_COLUMNS)
        .eq("user_id", userId)
        .in("status", RUNNING_WORKFLOW_STATUSES)
        .order("created_at", { ascending: false })
        .limit(RUNNING_QUEUE_PIN_LIMIT),
      SUMMARY_QUERY_TIMEOUT_MS,
      "workflows running timeout"
    );

    if (error) {
      logTaskQueueWarning("workflows running unavailable", error.message);
      return { running: 0, failed: 0 };
    }

    const rows = (Array.isArray(data) ? data : []) as unknown as Pick<WorkflowRow, "status" | "created_at" | "updated_at">[];
    return rows.reduce((counts, row) => {
      if (!isRunningWorkflowStatus(row.status)) return counts;
      counts.running += 1;
      return counts;
    }, { running: 0, failed: 0 });
  } catch (error) {
    logTaskQueueWarning("workflows running unavailable", toLogMessage(error));
    return { running: 0, failed: 0 };
  }
}

async function countRows(
  query: PromiseLike<{ count: number | null; error: { message?: string } | null }>,
  label: string,
  optional = false
) {
  try {
    const { count, error } = await withTimeout(query, SUMMARY_QUERY_TIMEOUT_MS, `${label} timeout`);
    if (error) {
      logTaskQueueWarning(`${label} unavailable`, error.message);
      return 0;
    }
    return count || 0;
  } catch (error) {
    logTaskQueueWarning(`${label} unavailable`, toLogMessage(error));
    return 0;
  }
}

function summaryPayload(summary: QueueSummaryData) {
  return {
    data: summary,
    totalCount: summary.totalTaskNum,
    runningCount: summary.runningTaskNum,
    finishedCount: summary.finishedTaskNum + summary.failedTaskNum,
    failedCount: summary.failedTaskNum,
  };
}

function detailPayload(rows: TaskQueueItem[], summary: QueueSummaryData, hasMore = false, nextCursor: string | null = null) {
  return {
    ...summaryPayload(summary),
    rows,
    hasMore,
    nextCursor,
  };
}

function queueJson(body: unknown) {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

async function loadLightweightModuleQueue(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  userId: string,
  moduleFilter: string,
  limit: number
): Promise<{ rows: TaskQueueItem[]; hasMore: boolean; nextCursor: string | null }> {
  const recentQuery = supabase
    .from("generations")
    .select(QUEUE_COLUMNS)
    .eq("user_id", userId)
    .eq("job_payload->>kind", moduleFilter)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  const recentResult = await withTimeout(
    recentQuery,
    LIGHTWEIGHT_MODULE_PRIMARY_TIMEOUT_MS,
    "module queue recent timeout"
  ).catch((error) => ({ data: [], error: { message: toLogMessage(error) } }));
  if (recentResult.error) logTaskQueueWarning("module queue recent unavailable", recentResult.error.message);
  const recentRows = (Array.isArray(recentResult.data) ? recentResult.data : []) as unknown as QueueRow[];
  let rows = mergeQueueRows([
    ...recentRows.filter((row) => !isHiddenByAdmin(row)).map(normalizeQueueRow),
  ])
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);

  if (rows.length === 0) {
    rows = await loadLightweightInferredModuleQueue(supabase, userId, moduleFilter, limit);
  }

  const hasMore = recentRows.length > limit;
  return {
    rows,
    hasMore,
    nextCursor: hasMore ? rows[rows.length - 1]?.createdAt || null : null,
  };
}

async function loadLightweightInferredModuleQueue(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  userId: string,
  moduleFilter: string,
  limit: number
) {
  const scanLimit = Math.min(LIGHTWEIGHT_LEGACY_SCAN_LIMIT, Math.max(limit * 4, 48));
  const recentQuery = supabase
    .from("generations")
    .select(QUEUE_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(scanLimit);

  const recentResult = await withTimeout(
    recentQuery,
    LIGHTWEIGHT_MODULE_FALLBACK_TIMEOUT_MS,
    "module queue inferred recent timeout"
  ).catch((error) => ({ data: [], error: { message: toLogMessage(error) } }));
  if (recentResult.error) logTaskQueueWarning("module queue inferred recent unavailable", recentResult.error.message);

  const recentRows = (Array.isArray(recentResult.data) ? recentResult.data : []) as unknown as QueueRow[];
  return mergeQueueRows([
    ...recentRows.filter((row) => !isHiddenByAdmin(row)).map(normalizeQueueRow),
  ])
    .filter((row) => row.module === moduleFilter)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);
}

async function loadWorkflowRows(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  userId: string,
  cursor: string | null,
  limit: number
) {
  let query = supabase
    .from("agent_workflows")
    .select("id,status,intent,summary,input_images,final_outputs,cost_reserved,cost_settled,error_message,created_at,updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (cursor) query = query.lt("created_at", cursor);

  try {
    const { data, error } = await withTimeout(
      query.limit(limit),
      QUEUE_QUERY_TIMEOUT_MS,
      "workflow list timeout"
    );

    if (error) {
      logTaskQueueWarning("agent workflows unavailable", error.message);
      return [];
    }

    const workflows = (Array.isArray(data) ? data : []) as unknown as WorkflowRow[];
    return workflows.map(normalizeWorkflowRow);
  } catch (error) {
    logTaskQueueWarning("agent workflows unavailable", toLogMessage(error));
    return [];
  }
}

async function loadRunningGenerationRows(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  userId: string,
  moduleFilter: string
) {
  try {
    let query = supabase
      .from("generations")
      .select(QUEUE_COLUMNS)
      .eq("user_id", userId)
      .in("status", [...GENERATION_RUNNING_STATUS_FILTERS])
      .order("created_at", { ascending: false })
      .limit(RUNNING_QUEUE_PIN_LIMIT);
    if (moduleFilter) query = query.eq("job_payload->>kind", moduleFilter);

    const { data, error } = await withTimeout(
      query,
      QUEUE_QUERY_TIMEOUT_MS,
      "running generations list timeout"
    );

    if (error) {
      logTaskQueueWarning("running generations unavailable", error.message);
      return [];
    }

    return ((Array.isArray(data) ? data : []) as unknown as QueueRow[])
      .filter((row) => !isHiddenByAdmin(row))
      .map(normalizeQueueRow)
      .filter(isQueueItemRunning)
      .filter((row) => !moduleFilter || row.module === moduleFilter);
  } catch (error) {
    logTaskQueueWarning("running generations unavailable", toLogMessage(error));
    return [];
  }
}

async function loadRunningWorkflowRows(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  userId: string
) {
  try {
    const { data, error } = await withTimeout(
      supabase
        .from("agent_workflows")
        .select("id,status,intent,summary,input_images,final_outputs,cost_reserved,cost_settled,error_message,created_at,updated_at")
        .eq("user_id", userId)
        .in("status", RUNNING_WORKFLOW_STATUSES)
        .order("created_at", { ascending: false })
        .limit(RUNNING_QUEUE_PIN_LIMIT),
      QUEUE_QUERY_TIMEOUT_MS,
      "running workflows list timeout"
    );

    if (error) {
      logTaskQueueWarning("running workflows unavailable", error.message);
      return [];
    }

    return ((Array.isArray(data) ? data : []) as unknown as WorkflowRow[])
      .map(normalizeWorkflowRow)
      .filter(isQueueItemRunning);
  } catch (error) {
    logTaskQueueWarning("running workflows unavailable", toLogMessage(error));
    return [];
  }
}

function isHiddenByAdmin(row: QueueRow) {
  const payload = row.job_payload && typeof row.job_payload === "object" ? row.job_payload : {};
  const moderation = isRecord(payload.adminModeration) ? payload.adminModeration : null;
  return moderation?.action === "hide";
}

function normalizeQueueRow(row: QueueRow): TaskQueueItem {
  const payload = row.job_payload && typeof row.job_payload === "object" ? row.job_payload : {};
  const kind = normalizeModule(typeof payload.kind === "string" ? payload.kind : inferGenerationModule(row, payload));
  const state = normalizeGenerationState({
    status: row.status,
    resultUrls: row.result_urls,
    payload,
    completedAt: row.completed_at,
  });
  const completedAt = state.completedAt || row.completed_at;
  const staleRunning = state.statusGroup === "running" && isStaleRunningGeneration(row);
  const statusGroup = getGenerationStatusGroup(state.status, staleRunning, state.resultCount);
  const inputThumbnails = getInputThumbnails(row, payload);
  const resultThumbnails = Array.from(new Set(Array.isArray(row.result_urls) ? row.result_urls : []));
  const updatedAt = completedAt || row.processing_started_at || readAsyncTaskUpdatedAt(row.job_payload) || row.created_at;
  return {
    id: row.id,
    module: kind || "unknown",
    title: moduleLabel(kind),
    status: staleRunning && statusGroup === "running" ? "processing_delayed" : state.status,
    statusGroup,
    progress: state.progress,
    expectedCount: state.expectedCount,
    resultCount: state.resultCount,
    time: formatDuration(row.created_at, isTaskCompleteLike(statusGroup) ? completedAt || updatedAt : null),
    createdAt: row.created_at,
    updatedAt,
    completedAt,
    error: row.error_message || "",
    inputThumbnails,
    resultThumbnails,
    thumbnails: getDisplayThumbnails(resultThumbnails, inputThumbnails),
    applyUrl: getApplyUrl(kind, row.id),
  };
}

function normalizeWorkflowRow(row: WorkflowRow): TaskQueueItem {
  const statusGroup = getWorkflowStatusGroup(row);
  const staleRunning = isRunningWorkflowStatus(row.status) && isStaleRunningDate(row.updated_at || row.created_at);
  const inputThumbnails = getWorkflowInputThumbnails(row);
  const resultThumbnails = getWorkflowResultThumbnails(row);
  return {
    id: row.id,
    module: "workflow",
    title: row.summary || workflowLabel(row.intent || ""),
    status: staleRunning && statusGroup === "running" ? "processing_delayed" : row.status,
    statusGroup,
    time: formatDuration(row.created_at, isTaskCompleteLike(statusGroup) ? row.updated_at : null),
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    completedAt: row.updated_at,
    error: row.error_message || "",
    progress: statusGroup === "completed" ? 100 : statusGroup === "failed" ? 100 : 15,
    expectedCount: Math.max(1, resultThumbnails.length || inputThumbnails.length || 1),
    resultCount: resultThumbnails.length,
    inputThumbnails,
    resultThumbnails,
    thumbnails: getDisplayThumbnails(resultThumbnails, inputThumbnails),
    applyUrl: `/history?detail=${encodeURIComponent(row.id)}`,
  };
}

function inferGenerationModule(row: QueueRow, payload: Record<string, unknown>) {
  const clothingUrls = [
    ...stringArray(payload.clothingUrls),
    ...(Array.isArray(row.clothing_urls) ? row.clothing_urls : []),
  ].filter(Boolean);
  if (clothingUrls.length) return "tryon";
  if (stringArray(payload.productImageUrls).length) return "productSet";
  if (stringValue(payload.sourceUrl) && stringValue(payload.faceUrl)) return "faceSwap";
  if (stringValue(payload.sourceUrl) && ("backgroundSource" in payload || "backgroundText" in payload)) return "modelBackground";
  if (stringValue(payload.sourceUrl) && stringValue(payload.garmentUrl) && "enhancementLevel" in payload) return "materialEnhancement";
  if (stringValue(payload.mainImageUrl)) return "pose";
  if (stringValue(payload.garmentUrl) && ("templateId" in payload || "changeModel" in payload)) return "grass";
  if (stringValue(payload.garmentUrl)) return "garment3d";
  if (stringArray(payload.referenceUrls).length && "gender" in payload) return "model";
  if ("mode" in payload && "prompt" in payload) return "generalImage";
  return "";
}

function isRunningWorkflowStatus(status: string) {
  const normalized = status.toLowerCase();
  return normalized === "queued" || normalized === "running";
}

function getGenerationStatusGroup(status: string, staleRunning: boolean, resultCount: number): TaskStatusGroup {
  const normalized = status.toLowerCase();
  if (GENERATION_FAILED_STATUS_FILTERS.includes(normalized as typeof GENERATION_FAILED_STATUS_FILTERS[number])) return "failed";
  if (staleRunning && resultCount <= 0) return "running";
  if (GENERATION_PENDING_STATUS_FILTERS.includes(normalized as typeof GENERATION_PENDING_STATUS_FILTERS[number])) return "queued";
  if (GENERATION_RUNNING_STATUS_FILTERS.includes(normalized as typeof GENERATION_RUNNING_STATUS_FILTERS[number]) || normalized.startsWith("processing_")) {
    return "running";
  }
  return "completed";
}

function getWorkflowStatusGroup(row: WorkflowRow): TaskStatusGroup {
  const normalized = row.status.toLowerCase();
  if (FAILED_WORKFLOW_STATUSES.includes(normalized)) return "failed";
  if (isRunningWorkflowStatus(normalized) && isStaleRunningDate(row.updated_at || row.created_at)) return "running";
  if (isRunningWorkflowStatus(normalized) && !isStaleRunningDate(row.updated_at || row.created_at)) {
    return normalized === "queued" ? "queued" : "running";
  }
  return "completed";
}

function isTaskCompleteLike(statusGroup: TaskStatusGroup) {
  return statusGroup === "completed" || statusGroup === "failed";
}

function isStaleRunningGeneration(row: Pick<QueueRow, "created_at" | "processing_started_at" | "job_payload">) {
  return isStaleRunningDate(row.processing_started_at || readAsyncTaskUpdatedAt(row.job_payload) || row.created_at);
}

function isStaleRunningDate(value?: string | null) {
  const time = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) return true;
  return Date.now() - time > RUNNING_TASK_STALE_MS;
}

function readAsyncTaskUpdatedAt(payload: QueueRow["job_payload"]) {
  const asyncTask = payload && typeof payload === "object" && "asyncTask" in payload
    ? payload.asyncTask
    : null;
  if (!asyncTask || typeof asyncTask !== "object" || !("updatedAt" in asyncTask)) return null;
  return typeof asyncTask.updatedAt === "string" ? asyncTask.updatedAt : null;
}

function getRunningTaskStaleMs() {
  const value = Number(process.env.TASK_QUEUE_RUNNING_STALE_MS || process.env.IMAGE_TASK_TIMEOUT_MS || 60 * 60 * 1000);
  return Number.isFinite(value) ? Math.min(Math.max(value, 5 * 60 * 1000), 2 * 60 * 60 * 1000) : 60 * 60 * 1000;
}

function moduleLabel(kind: string) {
  if (kind === "tryon") return "服装上身";
  if (kind === "faceSwap") return "换脸";
  if (kind === "model") return "模特生成";
  if (kind === "pose") return "姿势裂变";
  if (kind === "grass") return "种草图";
  if (kind === "modelBackground") return "换模特背景";
  if (kind === "materialEnhancement") return "材质增强";
  if (kind === "garment3d") return "平铺转3D";
  if (kind === "productSet") return "商品套图";
  if (kind === "generalImage") return "创意生图";
  if (kind === "outfitFusion") return "搭配融图";
  return "AI任务";
}

function workflowLabel(intent: string) {
  if (intent.includes("tryon")) return "Agent Try-on";
  if (intent.includes("pose")) return "Agent Pose";
  if (intent.includes("detail")) return "Agent Detail Page";
  if (intent.includes("face")) return "Agent Face Swap";
  return "Agent Workflow";
}

function getInputThumbnails(row: QueueRow, payload: Record<string, unknown>) {
  if (payload.kind === "tryon") {
    return getTryOnInputReferenceUrls({
      clothingUrls: stringArray(payload.clothingUrls).length ? stringArray(payload.clothingUrls) : row.clothing_urls,
      clothingMode: stringValue(payload.clothingMode),
      clothingRoles: Array.isArray(payload.clothingRoles) ? payload.clothingRoles : undefined,
      referenceUrl: stringValue(payload.referenceUrl) || row.reference_url,
      referenceUrls: stringArray(payload.referenceUrls),
      modelFaceUrl: stringValue(payload.modelFaceUrl) || row.model_face_url,
      garmentDetailUrls: stringArray(payload.garmentDetailUrls),
    }).slice(0, TRYON_INPUT_REFERENCE_LIMIT);
  }
  return Array.from(new Set([
    ...stringArray(payload.clothingUrls),
    ...stringArray(payload.referenceUrls),
    ...stringArray(payload.productImageUrls),
    stringValue(payload.sourceUrl),
    stringValue(payload.faceUrl),
    stringValue(payload.mainImageUrl),
    ...stringArray(payload.garmentDetailUrls),
    stringValue(payload.garmentUrl),
    stringValue(payload.referenceUrl),
    stringValue(payload.modelFaceUrl),
    stringValue(row.model_face_url),
    stringValue(row.reference_url),
    ...(Array.isArray(row.clothing_urls) ? row.clothing_urls : []),
  ].filter(Boolean) as string[])).slice(0, 8);
}

function getWorkflowInputThumbnails(row: WorkflowRow) {
  return Array.isArray(row.input_images)
    ? row.input_images
        .map((image) => image && typeof image === "object" && "url" in image ? (image as { url?: unknown }).url : "")
        .filter((url): url is string => typeof url === "string" && url.length > 0)
    : [];
}

function getWorkflowResultThumbnails(row: WorkflowRow) {
  const final = row.final_outputs && typeof row.final_outputs === "object" ? row.final_outputs : {};
  return Array.from(new Set([
    ...stringArray(final.imageUrls),
    ...stringArray(final.resultUrls),
    ...stringArray(final.urls),
    stringValue(final.selectedImageUrl),
    stringValue(final.imageUrl),
  ].filter(Boolean) as string[])).slice(0, 8);
}

function getDisplayThumbnails(resultUrls: string[], inputUrls: string[]) {
  return Array.from(new Set([...resultUrls, ...inputUrls].filter(Boolean))).slice(0, TASK_RESULT_THUMBNAIL_LIMIT);
}

function getApplyUrl(kind: string, generationId: string) {
  const path = getModulePath(kind);
  if (!path) return `/history?detail=${encodeURIComponent(generationId)}`;
  return `${path}?apply=${encodeURIComponent(generationId)}`;
}

function getModulePath(kind: string) {
  if (kind === "tryon") return "/create";
  if (kind === "grass") return "/grass";
  if (kind === "modelBackground") return "/model-background";
  if (kind === "materialEnhancement") return "/material-enhancement";
  if (kind === "generalImage") return "/general-image";
  if (kind === "outfitFusion") return "/outfit-fusion";
  if (kind === "productSet") return "/product-set";
  if (kind === "garment3d") return "/garment-3d";
  if (kind === "faceSwap") return "/face-swap";
  if (kind === "model") return "/model";
  if (kind === "pose") return "/pose";
  return "";
}

function normalizeModuleFilter(value: string | null) {
  const normalized = (value || "").trim();
  if (!normalized || normalized === "all") return "";
  return normalized;
}

function matchesSearch(row: TaskQueueItem, query: string) {
  if (!query) return true;
  return row.id.toLowerCase().includes(query) ||
    row.title.toLowerCase().includes(query) ||
    row.status.toLowerCase().includes(query);
}

function mergeQueueRows(rows: TaskQueueItem[]) {
  const rowsById = new Map<string, TaskQueueItem>();
  for (const row of rows) {
    if (!rowsById.has(row.id)) rowsById.set(row.id, row);
  }
  return Array.from(rowsById.values());
}

function isQueueItemRunning(row: TaskQueueItem) {
  return row.statusGroup === "running" || row.statusGroup === "queued";
}

function logTaskQueueWarning(label: string, detail: unknown) {
  console.warn(`[task-queue] ${label}:`, toLogMessage(detail));
}

function clampNumber(value: string | null, min: number, max: number, fallback: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : "";
}

function formatDuration(start: string, end?: string | null) {
  const startMs = Date.parse(start);
  const endMs = end ? Date.parse(end) : Date.now();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "";
  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}:${String(rest).padStart(2, "0")}` : `0:${String(rest).padStart(2, "0")}`;
}
