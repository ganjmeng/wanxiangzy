import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { appendWorkflowEvent, getWorkflowBundle, setWorkflowStatus } from "@/lib/agent/workflow/repository";
import { wakeAgentWorkflow } from "@/lib/agent/workflow/runtime";

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
    if (!["confirmed", "queued", "running"].includes(bundle.workflow.status)) {
      return NextResponse.json({ error: `当前状态 ${bundle.workflow.status} 不能入队执行` }, { status: 409 });
    }
    if (bundle.workflow.status !== "queued" && bundle.workflow.status !== "running") {
      await setWorkflowStatus(id, "queued");
      await appendWorkflowEvent({ workflowId: id, type: "workflow_queued", message: "Workflow queued by user" });
    }
    const wakeStarted = bundle.workflow.status === "running" ? false : wakeAgentWorkflow(id);
    const refreshed = await getWorkflowBundle(id, auth.user.id);
    return NextResponse.json({ ok: true, wakeStarted, ...refreshed });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "执行 workflow 失败" },
      { status: 500 }
    );
  }
}
