import type { SupabaseClient } from "@supabase/supabase-js";

import type { TaskQueueItem, TaskQueueSummary } from "@/lib/task-queue";
import { writeTaskQueueItem } from "@/lib/redis/task-queue-cache";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  type TaskQueueAiToolSourceRow,
  type TaskQueueGenerationSourceRow,
  type TaskQueueIndexRow,
  type TaskQueueIndexWrite,
  type TaskQueueCreativeRunSourceRow,
  applyStaleRunningFallback,
  emptyTaskQueueSummary,
  indexRowToTaskQueueItem,
  normalizeGenerationTaskQueueItem,
  normalizeAiToolTaskQueueItem,
  normalizeModule,
  normalizeCreativeRunTaskQueueItem,
  taskQueueItemToIndexWrite,
} from "@/lib/task-queue-index";
import { toLogMessage } from "@/lib/utils";

export const TASK_QUEUE_INDEX_COLUMNS = [
  "id",
  "user_id",
  "source_type",
  "source_id",
  "module",
  "title",
  "status",
  "status_group",
  "progress",
  "expected_count",
  "result_count",
  "input_thumbnails",
  "result_thumbnails",
  "error_message",
  "apply_url",
  "created_at",
  "updated_at",
  "completed_at",
].join(",");

const GENERATION_INDEX_SOURCE_COLUMNS = [
  "id",
  "user_id",
  "status",
  "error_message",
  "result_urls",
  "created_at",
  "updated_at",
  "completed_at",
  "processing_started_at",
  "job_payload",
  "clothing_urls",
  "model_face_url",
  "reference_url",
].join(",");

const CREATIVE_RUN_INDEX_SOURCE_COLUMNS = [
  "id",
  "user_id",
  "status",
  "intent",
  "summary",
  "input_images:input_payload",
  "error_message",
  "created_at",
  "updated_at",
  "completed_at",
  "final_outputs:output_payload",
].join(",");

const AI_TOOL_INDEX_SOURCE_COLUMNS = [
  "id",
  "user_id",
  "provider_task_id",
  "operation",
  "status",
  "source_url",
  "request_payload",
  "provider_payload",
  "response_payload",
  "output_persistence_status",
  "result_urls",
  "last_error",
  "created_at",
  "updated_at",
  "completed_at",
  "generation_id",
].join(",");

export type TaskQueueIndexLoadResult =
  | { ok: true; rows: TaskQueueItem[]; hasMore: boolean; nextCursor: string | null }
  | { ok: false; error: string };

export type TaskQueueSummaryLoadResult =
  | { ok: true; summary: TaskQueueSummary }
  | { ok: false; error: string };

export async function loadTaskQueueItemsFromIndex(
  supabase: SupabaseClient,
  params: {
    userId: string;
    module?: string;
    limit: number;
    cursor?: string | null;
    searchQuery?: string;
  },
): Promise<TaskQueueIndexLoadResult> {
  try {
    const module = params.module ? normalizeModule(params.module) : "";
    const queryLimit = params.searchQuery ? Math.min(Math.max(params.limit * 4, params.limit + 1), 100) : params.limit + 1;
    let query = supabase
      .from("task_queue_items")
      .select(TASK_QUEUE_INDEX_COLUMNS)
      .eq("user_id", params.userId)
      .order("created_at", { ascending: false })
      .limit(queryLimit);

    if (module) {
      query = query.eq("module", module);
    }
    if (params.cursor) {
      query = query.lt("created_at", params.cursor);
    }

    const { data, error } = await query;
    if (error) {
      return { ok: false, error: error.message || "task_queue_items query failed" };
    }

    const rawRows = (Array.isArray(data) ? data : []) as unknown as TaskQueueIndexRow[];
    let items = rawRows.map(indexRowToTaskQueueItem);
    if (params.searchQuery) {
      const search = params.searchQuery.trim().toLowerCase();
      items = items.filter((item) => matchesTaskSearch(item, search));
    }
    const rows = items.slice(0, params.limit);
    const hasMore = rawRows.length > params.limit || items.length > params.limit;
    return {
      ok: true,
      rows,
      hasMore,
      nextCursor: hasMore ? rows[rows.length - 1]?.createdAt || null : null,
    };
  } catch (error) {
    return { ok: false, error: toLogMessage(error) };
  }
}

export async function loadTaskQueueSummaryFromIndex(
  supabase: SupabaseClient,
  userId: string,
): Promise<TaskQueueSummaryLoadResult> {
  try {
    const [totalTaskNum, failedTaskNum, runningRowsResult] = await Promise.all([
      countIndexRows(
        supabase
          .from("task_queue_items")
          .select("id", { count: "planned", head: true })
          .eq("user_id", userId),
      ),
      countIndexRows(
        supabase
          .from("task_queue_items")
          .select("id", { count: "planned", head: true })
          .eq("user_id", userId)
          .eq("status_group", "failed"),
      ),
      supabase
        .from("task_queue_items")
        .select("source_id,module,title,status,status_group,progress,expected_count,result_count,input_thumbnails,result_thumbnails,error_message,apply_url,created_at,updated_at,completed_at,user_id,source_type")
        .eq("user_id", userId)
        .in("status_group", ["queued", "running"])
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    if (!totalTaskNum.ok) return { ok: false, error: totalTaskNum.error };
    if (!failedTaskNum.ok) return { ok: false, error: failedTaskNum.error };
    if (runningRowsResult.error) {
      return { ok: false, error: runningRowsResult.error.message || "task_queue_items running query failed" };
    }

    const runningRows = (Array.isArray(runningRowsResult.data) ? runningRowsResult.data : []) as TaskQueueIndexRow[];
    const runningItems = runningRows.map(indexRowToTaskQueueItem);
    const runningTaskNum = runningItems.filter(
      (item) => item.statusGroup === "queued" || item.statusGroup === "running",
    ).length;
    const failedCount = failedTaskNum.count;
    const summary = {
      ...emptyTaskQueueSummary(),
      totalTaskNum: totalTaskNum.count,
      failedTaskNum: failedCount,
      runningTaskNum,
      finishedTaskNum: Math.max(0, totalTaskNum.count - failedCount - runningTaskNum),
    };
    return { ok: true, summary };
  } catch (error) {
    return { ok: false, error: toLogMessage(error) };
  }
}

export async function syncGenerationTaskQueueById(generationId: string): Promise<void> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("generations")
    .select(GENERATION_INDEX_SOURCE_COLUMNS)
    .eq("id", generationId)
    .maybeSingle();

  if (error || !data) {
    console.warn("[task-queue-index] generation source unavailable:", error?.message || generationId);
    return;
  }

  const row = data as unknown as TaskQueueGenerationSourceRow;
  if (row.job_payload?.internalTask === true) {
    await supabase
      .from("task_queue_items")
      .delete()
      .eq("source_type", "generation")
      .eq("source_id", row.id);
    return;
  }
  const item = normalizeGenerationTaskQueueItem(row);
  await upsertTaskQueueIndexItem(
    taskQueueItemToIndexWrite(item, { userId: row.user_id, sourceType: "generation", sourceId: row.id }),
  );
}

export async function syncCreativeRunTaskQueueById(runId: string): Promise<void> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("creative_runs")
    .select(CREATIVE_RUN_INDEX_SOURCE_COLUMNS)
    .eq("id", runId)
    .maybeSingle();

  if (error || !data) {
    console.warn("[task-queue-index] creative run source unavailable:", error?.message || runId);
    return;
  }

  const row = data as unknown as TaskQueueCreativeRunSourceRow;
  const item = normalizeCreativeRunTaskQueueItem(row);
  await upsertTaskQueueIndexItem(
    taskQueueItemToIndexWrite(item, { userId: row.user_id, sourceType: "creative_run", sourceId: row.id }),
  );
}

/**
 * Projects the durable AI-tool task into the shared task-queue read model.
 * This is deliberately best-effort: a cache/index outage must never turn a
 * successfully submitted image job into an API failure.
 */
export async function syncAiToolTaskQueueById(aiToolTaskId: string): Promise<void> {
  try {
    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from("ai_tool_tasks")
      .select(AI_TOOL_INDEX_SOURCE_COLUMNS)
      .eq("id", aiToolTaskId)
      .maybeSingle();

    if (error || !data) {
      console.warn("[task-queue-index] AI tool source unavailable:", error?.message || aiToolTaskId);
      return;
    }

    const row = data as unknown as TaskQueueAiToolSourceRow;
    // A submitting row has no stable public task identifier yet. It is synced
    // immediately after the provider task is bound instead.
    if (!row.provider_task_id) return;

    // Generative tools already have a live generations row maintained by the
    // existing worker/DB trigger. Let that source own the rail entry so status
    // keeps advancing even after the browser closes.
    if (row.generation_id) {
      await supabase
        .from("task_queue_items")
        .delete()
        .eq("source_type", "ai_tool")
        .eq("source_id", row.id);
      return;
    }

    const item = normalizeAiToolTaskQueueItem(row);
    await upsertTaskQueueIndexItem(
      taskQueueItemToIndexWrite(item, {
        userId: row.user_id,
        sourceType: "ai_tool",
        sourceId: row.id,
      }),
    );
  } catch (error) {
    console.warn("[task-queue-index] AI tool sync unavailable:", toLogMessage(error));
  }
}

export async function upsertTaskQueueIndexItem(item: TaskQueueIndexWrite): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("task_queue_items")
    .upsert(item, { onConflict: "source_type,source_id" });

  if (error) {
    console.warn("[task-queue-index] upsert unavailable:", error.message);
    return;
  }

  await writeTaskQueueItem(item.user_id, applyStaleRunningFallback(indexRowToTaskQueueItem(item)));
}

async function countIndexRows(
  query: PromiseLike<{ count: number | null; error: { message?: string } | null }>,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const { count, error } = await query;
    if (error) {
      return { ok: false, error: error.message || "task_queue_items count failed" };
    }
    return { ok: true, count: count || 0 };
  } catch (error) {
    return { ok: false, error: toLogMessage(error) };
  }
}

function matchesTaskSearch(item: TaskQueueItem, search: string) {
  if (!search) {
    return true;
  }
  return (
    item.id.toLowerCase().includes(search) ||
    item.title.toLowerCase().includes(search) ||
    item.status.toLowerCase().includes(search)
  );
}
