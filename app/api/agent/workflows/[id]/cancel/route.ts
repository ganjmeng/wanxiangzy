import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import {
  appendWorkflowEvent,
  cancelWorkflowSteps,
  getWorkflowBundle,
  releaseWorkflowCredits,
  setWorkflowStatus,
} from "@/lib/agent/workflow/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;
    const bundle = await getWorkflowBundle(id, auth.user.id);
    if (["completed", "failed", "cancelled"].includes(bundle.workflow.status)) {
      return NextResponse.json({ error: `当前状态 ${bundle.workflow.status} 不能取消` }, { status: 409 });
    }
    const releaseAmount = Math.max(0, Number(bundle.workflow.cost_reserved || 0) - Number(bundle.workflow.cost_settled || 0));
    if (releaseAmount > 0) {
      await releaseWorkflowCredits(auth.user.id, id, releaseAmount, `Agent workflow cancelled release (${id})`);
      await appendWorkflowEvent({ workflowId: id, type: "credit_released", message: `Released ${releaseAmount} credits`, payload: { releaseAmount } });
    }
    await cancelWorkflowSteps(id);
    await setWorkflowStatus(id, "cancelled");
    await appendWorkflowEvent({ workflowId: id, type: "workflow_cancelled", message: "Workflow cancelled by user" });
    const refreshed = await getWorkflowBundle(id, auth.user.id);
    return NextResponse.json({ ok: true, ...refreshed });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "取消 workflow 失败" },
      { status: 500 }
    );
  }
}
