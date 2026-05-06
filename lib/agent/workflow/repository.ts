import { getAdminClient } from "@/lib/supabase/admin";
import type {
  PlanValidationResult,
  QualityCheckResult,
  WorkflowAssetKind,
  WorkflowAssetRecord,
  WorkflowAssetRole,
  WorkflowCostEstimate,
  WorkflowEventRecord,
  WorkflowEventType,
  WorkflowInputImage,
  WorkflowMode,
  WorkflowPlan,
  WorkflowRecord,
  WorkflowStatus,
  WorkflowStepRecord,
  WorkflowStepResultOutput,
  WorkflowStepStatus,
} from "@/lib/agent/workflow/types";

type SupabaseAdmin = ReturnType<typeof getAdminClient>;

export type WorkflowBundle = {
  workflow: WorkflowRecord;
  steps: WorkflowStepRecord[];
  events: WorkflowEventRecord[];
  assets: WorkflowAssetRecord[];
};

export async function createWorkflowRecord(params: {
  userId: string;
  conversationId?: string | null;
  mode: WorkflowMode;
  inputImages: WorkflowInputImage[];
  plan: WorkflowPlan;
  validation: PlanValidationResult;
  costEstimate: WorkflowCostEstimate;
  idempotencyKey?: string | null;
}) {
  const supabase = getAdminClient();

  if (params.idempotencyKey) {
    const existing = await findWorkflowByIdempotencyKey(supabase, params.userId, params.idempotencyKey);
    if (existing) return getWorkflowBundle(existing.id, params.userId);
  }

  const { data: workflow, error } = await supabase
    .from("agent_workflows")
    .insert({
      user_id: params.userId,
      conversation_id: params.conversationId || null,
      status: params.validation.ok ? "needs_confirmation" : "planned",
      intent: params.plan.intent,
      summary: params.plan.summary,
      mode: params.mode,
      input_images: params.inputImages,
      cost_estimate: params.costEstimate,
      idempotency_key: params.idempotencyKey || null,
      error_message: params.validation.ok ? null : params.validation.clarificationQuestion || params.validation.errors[0]?.message || null,
    })
    .select("*")
    .single();

  if (error) throw new Error(`创建 workflow 失败: ${error.message}`);

  const workflowId = workflow.id as string;
  const planVersion = await insertPlanVersion(supabase, {
    workflowId,
    userId: params.userId,
    version: 1,
    source: "planner",
    plan: params.plan,
    validation: params.validation,
  });

  await supabase
    .from("agent_workflows")
    .update({ active_plan_version_id: planVersion.id })
    .eq("id", workflowId);

  if (params.validation.ok) {
    await insertWorkflowSteps(supabase, workflowId, params.plan);
  }

  await appendWorkflowEvent({
    workflowId,
    type: "workflow_created",
    message: "Workflow created from production planner",
    payload: { intent: params.plan.intent, validation: params.validation },
  });

  return getWorkflowBundle(workflowId, params.userId);
}

export async function getWorkflowBundle(workflowId: string, userId: string): Promise<WorkflowBundle> {
  const supabase = getAdminClient();
  const { data: workflow, error } = await supabase
    .from("agent_workflows")
    .select("*")
    .eq("id", workflowId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`读取 workflow 失败: ${error.message}`);
  if (!workflow) throw new Error("Workflow 不存在或无权限访问");

  const [steps, events, assets] = await Promise.all([
    supabase.from("agent_workflow_steps").select("*").eq("workflow_id", workflowId).order("created_at", { ascending: true }),
    supabase.from("agent_workflow_events").select("*").eq("workflow_id", workflowId).order("created_at", { ascending: true }),
    supabase.from("agent_assets").select("*").eq("workflow_id", workflowId).order("created_at", { ascending: true }),
  ]);

  if (steps.error) throw new Error(`读取 workflow steps 失败: ${steps.error.message}`);
  if (events.error) throw new Error(`读取 workflow events 失败: ${events.error.message}`);
  if (assets.error) throw new Error(`读取 workflow assets 失败: ${assets.error.message}`);

  return {
    workflow: workflow as WorkflowRecord,
    steps: (steps.data || []) as WorkflowStepRecord[],
    events: (events.data || []) as WorkflowEventRecord[],
    assets: (assets.data || []) as WorkflowAssetRecord[],
  };
}

export async function getLatestWorkflowBundle(params: {
  userId: string;
  conversationId?: string | null;
  statuses?: WorkflowStatus[];
}): Promise<WorkflowBundle | null> {
  const supabase = getAdminClient();
  let query = supabase
    .from("agent_workflows")
    .select("id")
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (params.conversationId) {
    query = query.eq("conversation_id", params.conversationId);
  }
  if (params.statuses?.length) {
    query = query.in("status", params.statuses);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`查询最近 workflow 失败: ${error.message}`);
  const workflowId = (data as { id?: string } | null)?.id;
  return workflowId ? getWorkflowBundle(workflowId, params.userId) : null;
}

export async function getWorkflowBundleForWorker(workflowId: string): Promise<WorkflowBundle | null> {
  const supabase = getAdminClient();
  const { data: workflow, error } = await supabase
    .from("agent_workflows")
    .select("*")
    .eq("id", workflowId)
    .maybeSingle();

  if (error) throw new Error(`读取 worker workflow 失败: ${error.message}`);
  if (!workflow) return null;
  return getWorkflowBundle(workflow.id, workflow.user_id);
}

export async function appendWorkflowEvent(params: {
  workflowId: string;
  stepId?: string | null;
  type: WorkflowEventType;
  message?: string;
  payload?: Record<string, unknown>;
}) {
  const { error } = await getAdminClient()
    .from("agent_workflow_events")
    .insert({
      workflow_id: params.workflowId,
      step_id: params.stepId || null,
      type: params.type,
      message: params.message || null,
      payload: params.payload || {},
    });
  if (error) throw new Error(`写入 workflow event 失败: ${error.message}`);
}

export async function setWorkflowStatus(
  workflowId: string,
  status: WorkflowStatus,
  updates: Partial<Pick<WorkflowRecord, "error_message" | "final_outputs" | "cost_settled">> = {}
) {
  const { error } = await getAdminClient()
    .from("agent_workflows")
    .update({ status, updated_at: new Date().toISOString(), ...updates })
    .eq("id", workflowId);
  if (error) throw new Error(`更新 workflow 状态失败: ${error.message}`);
}

export async function setStepStatus(
  stepId: string,
  status: WorkflowStepStatus,
  updates: {
    output?: WorkflowStepResultOutput | null;
    quality?: QualityCheckResult | null;
    errorMessage?: string | null;
    retryCount?: number;
  } = {}
) {
  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (status === "running") patch.started_at = new Date().toISOString();
  if (["completed", "failed", "skipped", "cancelled"].includes(status)) patch.completed_at = new Date().toISOString();
  if ("output" in updates) patch.output = updates.output;
  if ("quality" in updates) patch.quality = updates.quality;
  if ("errorMessage" in updates) patch.error_message = updates.errorMessage;
  if (typeof updates.retryCount === "number") patch.retry_count = updates.retryCount;

  const { error } = await getAdminClient()
    .from("agent_workflow_steps")
    .update(patch)
    .eq("id", stepId);
  if (error) throw new Error(`更新 step 状态失败: ${error.message}`);
}

export async function tryStartWorkflowStep(stepId: string): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from("agent_workflow_steps")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", stepId)
    .in("status", ["ready", "queued"])
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`start workflow step failed: ${error.message}`);
  return Boolean((data as { id?: string } | null)?.id);
}

export async function cancelWorkflowSteps(workflowId: string, reason = "Workflow cancelled by user") {
  const { error } = await getAdminClient()
    .from("agent_workflow_steps")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error_message: reason,
    })
    .eq("workflow_id", workflowId)
    .in("status", ["pending", "ready", "queued", "running", "waiting_user"]);

  if (error) throw new Error(`cancel workflow steps failed: ${error.message}`);
}

export async function updateStepDefinition(
  stepId: string,
  updates: {
    input?: Record<string, unknown>;
    params?: Record<string, unknown>;
    title?: string;
    status?: WorkflowStepStatus;
  }
) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.input) patch.input = updates.input;
  if (updates.params) patch.params = updates.params;
  if (updates.title) patch.title = updates.title;
  if (updates.status) patch.status = updates.status;
  const { error } = await getAdminClient()
    .from("agent_workflow_steps")
    .update(patch)
    .eq("id", stepId);
  if (error) throw new Error(`更新 step 定义失败: ${error.message}`);
}

export async function createWorkflowAssets(params: {
  userId: string;
  workflowId: string;
  stepId?: string | null;
  kind: WorkflowAssetKind;
  role: WorkflowAssetRole;
  urls: string[];
  provider?: string | null;
  model?: string | null;
  metadata?: Record<string, unknown>;
}) {
  if (!params.urls.length) return [];
  const rows = params.urls.map((url) => ({
    user_id: params.userId,
    workflow_id: params.workflowId,
    step_id: params.stepId || null,
    kind: params.kind,
    role: params.role,
    url,
    provider: params.provider || null,
    model: params.model || null,
    metadata: params.metadata || {},
  }));
  const { data, error } = await getAdminClient()
    .from("agent_assets")
    .insert(rows)
    .select("*");
  if (error) throw new Error(`保存 workflow assets 失败: ${error.message}`);
  return (data || []) as WorkflowAssetRecord[];
}

export async function reserveWorkflowCredits(params: {
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }> };
  userId: string;
  workflowId: string;
  amount: number;
}) {
  const { data, error } = await params.supabase.rpc("reserve_agent_workflow_credits", {
    p_user_id: params.userId,
    p_workflow_id: params.workflowId,
    p_amount: params.amount,
    p_reason: `Agent workflow reservation (${params.workflowId})`,
  });
  if (error) throw new Error(normalizeCreditRpcError(error.message, params.amount));
  const row = Array.isArray(data) ? data[0] : data;
  return Number((row as { credits_remaining?: number } | null)?.credits_remaining ?? 0);
}

export async function settleWorkflowCredits(userId: string, workflowId: string, amount: number) {
  const { error } = await getAdminClient().rpc("settle_agent_workflow_credits", {
    p_user_id: userId,
    p_workflow_id: workflowId,
    p_amount: amount,
  });
  if (error) throw new Error(`结算 workflow 积分失败: ${error.message}`);
}

export async function releaseWorkflowCredits(userId: string, workflowId: string, amount: number, reason: string) {
  const { error } = await getAdminClient().rpc("release_agent_workflow_credits", {
    p_user_id: userId,
    p_workflow_id: workflowId,
    p_amount: amount,
    p_reason: reason,
  });
  if (error) throw new Error(`释放 workflow 积分失败: ${error.message}`);
}

export async function claimNextAgentWorkflows(limit = 2, staleAfterMinutes = 10): Promise<string[]> {
  const { data, error } = await getAdminClient().rpc("claim_next_agent_workflows", {
    p_limit: limit,
    p_stale_after: `${Math.max(1, Math.floor(staleAfterMinutes))} minutes`,
  });
  if (error) throw new Error(`领取 agent workflow 失败: ${error.message}`);
  return Array.isArray(data) ? data.map((row) => String((row as { id: string }).id)).filter(Boolean) : [];
}

export async function claimAgentWorkflowById(workflowId: string): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from("agent_workflows")
    .update({ status: "running", updated_at: new Date().toISOString() })
    .eq("id", workflowId)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`claim agent workflow failed: ${error.message}`);
  return Boolean((data as { id?: string } | null)?.id);
}

async function insertPlanVersion(
  supabase: SupabaseAdmin,
  params: {
    workflowId: string;
    userId: string;
    version: number;
    source: string;
    plan: WorkflowPlan;
    validation: PlanValidationResult;
  }
) {
  const { data, error } = await supabase
    .from("agent_plan_versions")
    .insert({
      workflow_id: params.workflowId,
      user_id: params.userId,
      version: params.version,
      source: params.source,
      plan: params.plan,
      validation: params.validation,
    })
    .select("*")
    .single();
  if (error) throw new Error(`写入 plan version 失败: ${error.message}`);
  return data as { id: string };
}

async function insertWorkflowSteps(supabase: SupabaseAdmin, workflowId: string, plan: WorkflowPlan) {
  const rows = plan.steps.map((step) => ({
    workflow_id: workflowId,
    step_key: step.id,
    type: step.type,
    title: step.title,
    status: step.dependsOn.length ? "pending" : "ready",
    depends_on: step.dependsOn,
    input: step.input,
    params: step.params,
  }));
  if (!rows.length) return;
  const { error } = await supabase.from("agent_workflow_steps").insert(rows);
  if (error) throw new Error(`写入 workflow steps 失败: ${error.message}`);
}

async function findWorkflowByIdempotencyKey(supabase: SupabaseAdmin, userId: string, key: string) {
  const { data, error } = await supabase
    .from("agent_workflows")
    .select("id")
    .eq("user_id", userId)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (error) throw new Error(`查询幂等 workflow 失败: ${error.message}`);
  return data as { id: string } | null;
}

function normalizeCreditRpcError(message = "", required: number) {
  const insufficient = message.match(/INSUFFICIENT_CREDITS:(\d+)/);
  if (insufficient) {
    return `积分不足。需要 ${required}，余额 ${Number(insufficient[1])}`;
  }
  if (message.includes("reserve_agent_workflow_credits") || message.includes("Could not find the function")) {
    return "数据库缺少 workflow 积分预占函数，请先运行 supabase/agent-workflows.sql";
  }
  return message || "workflow 积分预占失败";
}
