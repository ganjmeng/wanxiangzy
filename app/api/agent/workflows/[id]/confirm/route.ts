import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { appendWorkflowEvent, getWorkflowBundle, reserveWorkflowCredits, setWorkflowStatus } from "@/lib/agent/workflow/repository";
import { wakeAgentWorkflow } from "@/lib/agent/workflow/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const bundle = await getWorkflowBundle(id, auth.user.id);
    if (!["needs_confirmation", "planned", "confirmed"].includes(bundle.workflow.status)) {
      return NextResponse.json({ error: `当前状态 ${bundle.workflow.status} 不能确认` }, { status: 409 });
    }
    const amount = Number(bundle.workflow.cost_estimate?.reserve || bundle.workflow.cost_estimate?.total || 0);
    const creditsRemaining = await reserveWorkflowCredits({
      supabase: auth.supabase,
      userId: auth.user.id,
      workflowId: id,
      amount,
    });

    const nextStatus = body.autoRun === false ? "confirmed" : "queued";
    await setWorkflowStatus(id, nextStatus);
    await appendWorkflowEvent({
      workflowId: id,
      type: "workflow_confirmed",
      message: "Workflow confirmed by user",
      payload: { autoRun: body.autoRun !== false },
    });
    await appendWorkflowEvent({
      workflowId: id,
      type: "credit_reserved",
      message: `Reserved ${amount} credits`,
      payload: { amount, creditsRemaining },
    });
    if (nextStatus === "queued") {
      await appendWorkflowEvent({ workflowId: id, type: "workflow_queued", message: "Workflow queued after confirmation" });
    }
    const wakeStarted = nextStatus === "queued" ? wakeAgentWorkflow(id) : false;

    const refreshed = await getWorkflowBundle(id, auth.user.id);
    return NextResponse.json({ ok: true, creditsRemaining, wakeStarted, ...refreshed });
  } catch (err) {
    console.error("[agent-workflows/confirm] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "确认 workflow 失败" },
      { status: 500 }
    );
  }
}
