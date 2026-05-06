import { getAdminClient } from "@/lib/supabase/admin";
import { runAgentBrainV2 } from "@/lib/agent/brain";
import { BRAIN_EVAL_CASES, evaluateBrainDecision, type BrainEvalCase } from "@/lib/agent/brain/eval-cases";
import { getAgentFeatureFlags } from "@/lib/agent/brain/feature-flags";
import { getAgentUserPreferences } from "@/lib/agent/brain/preferences";
import { getAgentKnowledgeContext } from "@/lib/agent/brain/knowledge";
import { runMastraRouteEvalSuite, type MastraRouteEvalRunResult } from "@/lib/mastra/planning/route-evals";

export type BrainEvalRunResult = {
  runId: string;
  total: number;
  passed: number;
  failed: number;
  score: number;
  results: Array<{
    caseId: string;
    title: string;
    ok: boolean;
    failures: string[];
    action: string;
    module: string | null;
    confidence: number;
    traceId: string;
  }>;
};

export async function runBrainEvalSuite(params: {
  userId: string;
  includeFeedbackCases?: boolean;
  maxFeedbackCases?: number;
}): Promise<BrainEvalRunResult> {
  const started = Date.now();
  const runId = crypto.randomUUID();
  const cases = [
    ...BRAIN_EVAL_CASES,
    ...(params.includeFeedbackCases ? await loadFeedbackEvalCases(params.userId, params.maxFeedbackCases || 20) : []),
  ];
  const flags = getAgentFeatureFlags(params.userId);
  const preferences = flags.memory ? await getAgentUserPreferences(params.userId) : {};
  const projectKnowledge = flags.memory ? await getAgentKnowledgeContext({ userId: params.userId, limit: 10 }) : [];
  const results: BrainEvalRunResult["results"] = [];

  for (const testCase of cases) {
    const decision = await runAgentBrainV2({
      ...testCase.request,
      userId: params.userId,
      userPreferences: preferences,
      projectKnowledge,
      featureFlags: flags,
    });
    const evaluated = evaluateBrainDecision(decision, testCase);
    results.push({
      caseId: testCase.id,
      title: testCase.title,
      ok: evaluated.ok,
      failures: evaluated.failures,
      action: decision.action,
      module: decision.module,
      confidence: decision.confidence,
      traceId: decision.trace.id,
    });
  }

  const passed = results.filter((item) => item.ok).length;
  const output: BrainEvalRunResult = {
    runId,
    total: results.length,
    passed,
    failed: results.length - passed,
    score: results.length ? Math.round((passed / results.length) * 100) : 0,
    results,
  };
  await persistEvalRun({
    userId: params.userId,
    runId,
    output,
    latencyMs: Date.now() - started,
  });
  return output;
}

export async function runScheduledBrainEvals(params: {
  maxUsers?: number;
  includeFeedbackCases?: boolean;
}) {
  const userIds = await loadRecentEvalUserIds(params.maxUsers || 20);
  const results: Array<BrainEvalRunResult & {
    userId: string;
    ok: boolean;
    error?: string;
    mastraRoute?: MastraRouteEvalRunResult;
  }> = [];
  for (const userId of userIds) {
    try {
      const result = await runBrainEvalSuite({
        userId,
        includeFeedbackCases: params.includeFeedbackCases !== false,
        maxFeedbackCases: 30,
      });
      const mastraRoute = await runMastraRouteEvalSuite({ userId });
      results.push({
        ...result,
        userId,
        ok: result.failed === 0 && mastraRoute.failed === 0,
        mastraRoute,
      });
    } catch (err) {
      results.push({
        userId,
        ok: false,
        error: err instanceof Error ? err.message : "eval failed",
        runId: crypto.randomUUID(),
        total: 0,
        passed: 0,
        failed: 0,
        score: 0,
        results: [],
      });
    }
  }
  return {
    ok: results.every((result) => result.ok),
    users: userIds.length,
    results,
  };
}

async function loadRecentEvalUserIds(maxUsers: number) {
  const supabase = getAdminClient();
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const [feedback, traces] = await Promise.all([
    supabase
      .from("agent_feedback")
      .select("user_id,created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(maxUsers * 4),
    supabase
      .from("agent_brain_traces")
      .select("user_id,created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(maxUsers * 4),
  ]);
  if (feedback.error) console.warn("[agent-eval] feedback user query skipped:", feedback.error.message);
  if (traces.error) console.warn("[agent-eval] trace user query skipped:", traces.error.message);
  return Array.from(new Set([
    ...((feedback.data || []) as Array<{ user_id?: string }>).map((row) => row.user_id),
    ...((traces.data || []) as Array<{ user_id?: string }>).map((row) => row.user_id),
  ].filter((id): id is string => typeof id === "string" && id.length > 0))).slice(0, maxUsers);
}

async function loadFeedbackEvalCases(userId: string, limit: number): Promise<BrainEvalCase[]> {
  try {
    const { data, error } = await getAdminClient()
      .from("agent_feedback")
      .select("id,eval_case")
      .eq("user_id", userId)
      .eq("rating", "bad")
      .not("eval_case", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map((row) => normalizeFeedbackEvalCase(row)).filter((item): item is BrainEvalCase => Boolean(item));
  } catch (err) {
    console.warn("[agent-eval] feedback cases skipped:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

function normalizeFeedbackEvalCase(row: { id?: string; eval_case?: unknown }): BrainEvalCase | null {
  if (!row.eval_case || typeof row.eval_case !== "object") return null;
  const record = row.eval_case as Record<string, unknown>;
  const request = record.request && typeof record.request === "object" ? record.request as BrainEvalCase["request"] : null;
  if (!request?.userText) return null;
  const observed = record.observed && typeof record.observed === "object" ? record.observed as Record<string, unknown> : {};
  return {
    id: `feedback-${row.id || record.id || crypto.randomUUID()}`,
    title: typeof record.title === "string" ? record.title : "反馈回归用例",
    request: {
      ...request,
      images: Array.isArray(request.images) ? request.images : [],
      intentMode: request.intentMode || "smart",
    },
    expect: {
      action: observed.action === "chat" ? "generate" : undefined,
      module: typeof observed.module === "string" && observed.module === "grass" ? "general" : undefined,
    },
  };
}

async function persistEvalRun(params: {
  userId: string;
  runId: string;
  output: BrainEvalRunResult;
  latencyMs: number;
}) {
  try {
    const supabase = getAdminClient();
    await supabase.from("agent_eval_runs").insert({
      id: params.runId,
      user_id: params.userId,
      total: params.output.total,
      passed: params.output.passed,
      failed: params.output.failed,
      score: params.output.score,
      latency_ms: params.latencyMs,
      summary: params.output,
    });
    if (params.output.results.length) {
      await supabase.from("agent_eval_results").insert(params.output.results.map((result) => ({
        run_id: params.runId,
        user_id: params.userId,
        case_id: result.caseId,
        title: result.title,
        ok: result.ok,
        failures: result.failures,
        action: result.action,
        module: result.module,
        confidence: result.confidence,
        trace_id: result.traceId,
      })));
    }
  } catch (err) {
    console.warn("[agent-eval] persist skipped:", err instanceof Error ? err.message : String(err));
  }
}
