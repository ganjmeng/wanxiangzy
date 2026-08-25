import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin/auth";
import { writeAdminAuditLog } from "@/lib/admin/audit";
import { getAdminTaskDetail } from "@/lib/admin/data";
import { getAdminClient } from "@/lib/supabase/admin";
import { syncGenerationTaskQueueById } from "@/lib/task-queue-store";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireAdminApi("tasks:read");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "无效任务 ID" }, { status: 400 });
  }

  const detail = await getAdminTaskDetail(id);
  if (!detail.task && !detail.queueItem) {
    return NextResponse.json({ error: "任务不存在", detail }, { status: 404 });
  }

  return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireAdminApi("tasks:operate");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "无效任务 ID" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({})) as {
    action?: unknown;
    sourceType?: unknown;
    reason?: unknown;
  };
  const action = normalizeTaskAction(body.action);
  const sourceType = body.sourceType === "generation" ? "generation" : "";
  const reason = typeof body.reason === "string" && body.reason.trim()
    ? body.reason.trim()
    : defaultReason(action);

  if (!action) return NextResponse.json({ error: "不支持的任务操作" }, { status: 400 });
  if (reason.length < 4 || reason.length > 240) {
    return NextResponse.json({ error: "操作原因需要 4-240 个字符" }, { status: 400 });
  }

  const result = sourceType === "generation"
    ? await operateGenerationTask(id, action, reason)
    : await operateAnyTask(id, action, reason);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await writeAdminAuditLog(auth.context, {
    action: `task.${action}`,
    resourceType: result.sourceType,
    resourceId: id,
    reason,
    metadata: result.metadata,
  });

  return NextResponse.json(
    {
      ok: true,
      sourceType: result.sourceType,
      action,
      metadata: result.metadata,
      message: typeof result.metadata.message === "string" ? result.metadata.message : "操作已受理",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

type TaskAction = "retry" | "mark_failed_refund" | "mark_failed_no_refund" | "cancel_refund";

type TaskOperationResult =
  | { ok: true; sourceType: "generation"; metadata: Record<string, unknown> }
  | { ok: false; status: number; error: string };

type GenerationOperationRow = {
  id: string;
  user_id: string;
  status: string | null;
  credits_cost: number | null;
  credits_used: number | null;
  result_urls: string[] | null;
  delivery_version: number | null;
  execution_lease_expires_at: string | null;
};

async function operateAnyTask(id: string, action: TaskAction, reason: string): Promise<TaskOperationResult> {
  return operateGenerationTask(id, action, reason, true);
}

async function operateGenerationTask(
  id: string,
  action: TaskAction,
  reason: string,
  missingAs404 = false,
): Promise<TaskOperationResult> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("generations")
    .select("id,user_id,status,credits_cost,credits_used,result_urls,delivery_version,execution_lease_expires_at")
    .eq("id", id)
    .maybeSingle();

  if (error) return { ok: false, status: 400, error: error.message };
  if (!data) return { ok: false, status: missingAs404 ? 404 : 404, error: "任务不存在" };

  const row = data as GenerationOperationRow;
  const status = String(row.status || "").toLowerCase();
  if (action === "retry") {
    if (isCompletedStatus(status)) {
      return { ok: false, status: 409, error: "已完成任务不能直接重新入队" };
    }
    if (status !== "queued" && !status.startsWith("processing") && status !== "running" && status !== "generating") {
      return { ok: false, status: 409, error: `当前状态 ${row.status || "unknown"} 不支持重新处理` };
    }
    const retry = await admin.rpc("admin_retry_generation", {
      p_generation_id: id,
      p_reason: reason,
    });
    if (retry.error) {
      const message = `${retry.error.code || ""} ${retry.error.message || ""}`.toLowerCase();
      const statusCode = message.includes("admin_retry_generation") || message.includes("could not find") ? 501 : 400;
      return { ok: false, status: statusCode, error: retry.error.message || "任务重新投递失败" };
    }
    const retried = Array.isArray(retry.data) ? retry.data[0] : retry.data;
    await syncGenerationTaskQueueById(id);
    const alreadyRunning = retried?.outcome === "already_running";
    return {
      ok: true,
      sourceType: "generation",
      metadata: {
        previousStatus: row.status,
        nextStatus: alreadyRunning ? row.status : "queued",
        accepted: true,
        deduplicated: alreadyRunning,
        deliveryVersion: retried?.delivery_version ?? row.delivery_version,
        message: alreadyRunning ? "任务仍在有效执行中，未重复投递" : "任务已生成新的投递版本并重新入队",
      },
    };
  }

  if (isCompletedStatus(status) || status === "failed") {
    return { ok: false, status: 409, error: "任务已结束，不能重复退款" };
  }

  const shouldRefund = action === "mark_failed_refund" || action === "cancel_refund";
  const settlement = await admin.rpc("admin_settle_generation", {
    p_generation_id: id,
    p_refund: shouldRefund,
    p_reason: reason,
  });
  if (settlement.error) {
    const message = `${settlement.error.code || ""} ${settlement.error.message || ""}`.toLowerCase();
    const statusCode = message.includes("admin_settle_generation") || message.includes("could not find") ? 501 : 400;
    return { ok: false, status: statusCode, error: settlement.error.message || "任务结算失败" };
  }
  const settled = Array.isArray(settlement.data) ? settlement.data[0] : settlement.data;
  await syncGenerationTaskQueueById(id);
  return {
    ok: true,
    sourceType: "generation",
    metadata: {
      previousStatus: row.status,
      nextStatus: "failed",
      operation: action,
      refunded: Number(settled?.refund_amount || 0),
      balance: settled?.balance,
      resultCount: Array.isArray(row.result_urls) ? row.result_urls.length : 0,
      message: shouldRefund ? "任务已结束，退款已原子结算" : "任务已结束，未执行退款",
    },
  };
}

function normalizeTaskAction(value: unknown): TaskAction | "" {
  if (value === "retry" || value === "mark_failed_refund" || value === "mark_failed_no_refund" || value === "cancel_refund") {
    return value;
  }
  return "";
}

function defaultReason(action: TaskAction | "") {
  if (action === "retry") return "管理员重新入队";
  if (action === "cancel_refund") return "管理员取消卡住任务";
  if (action === "mark_failed_no_refund") return "管理员标记失败不退款";
  return "管理员标记失败并退款";
}

function isCompletedStatus(status: string) {
  return status === "completed" || status === "success" || status === "succeeded" || status === "partially_completed";
}
