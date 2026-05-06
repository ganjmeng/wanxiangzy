import { NextRequest, NextResponse } from "next/server";
import { getAgentV2Config } from "@/lib/agent-v2/config";
import {
  buildWorkflowQualityRecommendations,
  summarizeWorkflowQualityEvents,
  type WorkflowQualitySummary,
} from "@/lib/agent/workflow/quality-observability";
import {
  buildWorkflowOpsRecommendations,
  readAgentWorkflowOpsSnapshot,
  type AgentWorkflowOpsSnapshot,
} from "@/lib/agent/workflow/ops";
import { getMastraAgentModelInfo } from "@/lib/mastra/model";
import { buildMastraRouteEvalCheck } from "@/lib/mastra/planning/route-health";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type HealthCheck = {
  name: string;
  ok: boolean;
  severity: "info" | "warning" | "critical";
  message: string;
  metadata?: Record<string, unknown>;
};

const REQUIRED_TABLES = [
  "agent_workflows",
  "agent_workflow_steps",
  "agent_workflow_events",
  "agent_assets",
  "agent_brain_traces",
  "agent_feedback",
  "agent_observability_events",
  "agent_knowledge_items",
  "agent_eval_runs",
  "agent_eval_results",
] as const;

export async function GET(request: NextRequest) {
  return handleHealth(request);
}

export async function POST(request: NextRequest) {
  return handleHealth(request);
}

async function handleHealth(request: NextRequest) {
  const authError = validateProcessorAuth(request);
  if (authError) return authError;

  const started = Date.now();
  const checks: HealthCheck[] = [];
  const config = getAgentV2Config();
  const modelInfo = getMastraAgentModelInfo();

  checks.push(...buildConfigChecks(config, modelInfo));

  let db:
    | {
        tables: Record<string, boolean>;
        workflowStatusCounts: Record<string, number>;
        workflowOps: AgentWorkflowOpsSnapshot;
        recentObservability: Awaited<ReturnType<typeof readRecentObservability>>;
        recentWorkflowQuality: Awaited<ReturnType<typeof readRecentWorkflowQuality>>;
        latestMastraRouteEval: Awaited<ReturnType<typeof readLatestMastraRouteEval>>;
      }
    | null = null;

  try {
    const supabase = getAdminClient();
    const [tables, workflowOps, recentObservability, recentWorkflowQuality, latestMastraRouteEval] = await Promise.all([
      checkRequiredTables(supabase),
      readAgentWorkflowOpsSnapshot(getStaleAfterMinutes(request)),
      readRecentObservability(supabase),
      readRecentWorkflowQuality(supabase),
      readLatestMastraRouteEval(supabase),
    ]);

    checks.push(...tables.checks);
    checks.push(buildQueueCheck(workflowOps));
    checks.push(buildObservabilityCheck(recentObservability));
    checks.push(buildWorkflowQualityCheck(recentWorkflowQuality));
    checks.push(buildMastraRouteEvalCheck(latestMastraRouteEval));

    db = {
      tables: tables.status,
      workflowStatusCounts: workflowOps.counts,
      workflowOps,
      recentObservability,
      recentWorkflowQuality,
      latestMastraRouteEval,
    };
  } catch (error) {
    checks.push({
      name: "supabase_admin",
      ok: false,
      severity: "critical",
      message: error instanceof Error ? error.message : "Supabase admin health check failed",
    });
  }

  const status = summarizeStatus(checks);
  return NextResponse.json({
    ok: status !== "unhealthy",
    status,
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    recommendations: buildHealthRecommendations(checks, db),
    runtime: {
      chatV2Enabled: config.chatV2Enabled,
      runtimeProvider: config.runtimeProvider,
      uiProvider: config.uiProvider,
      mastraTraceEnabled: config.mastraTraceEnabled,
      mastraEvalEnabled: config.mastraEvalEnabled,
      mastraMemoryEnabled: config.mastraMemoryEnabled,
      model: modelInfo,
      inlineWorkflowWake: process.env.AGENT_WORKFLOW_INLINE_WAKE !== "0",
    },
    providers: buildProviderSnapshot(),
    db,
    checks,
  });
}

function validateProcessorAuth(request: NextRequest) {
  const expectedSecret =
    process.env.AGENT_HEALTH_PROCESSOR_SECRET ||
    process.env.JOB_PROCESSOR_SECRET ||
    process.env.CRON_SECRET;

  if (!expectedSecret) {
    return NextResponse.json(
      { error: "AGENT_HEALTH_PROCESSOR_SECRET/JOB_PROCESSOR_SECRET/CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  const authorization = request.headers.get("authorization") || "";
  if (authorization !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function buildConfigChecks(
  config: ReturnType<typeof getAgentV2Config>,
  modelInfo: ReturnType<typeof getMastraAgentModelInfo>,
): HealthCheck[] {
  return [
    {
      name: "agent_v2_enabled",
      ok: config.chatV2Enabled,
      severity: "critical",
      message: config.chatV2Enabled ? "Agent v2 chat is enabled." : "AGENT_CHAT_V2_ENABLED is disabled.",
    },
    {
      name: "assistant_ui_enabled",
      ok: config.uiProvider === "assistant_ui",
      severity: "warning",
      message: config.uiProvider === "assistant_ui" ? "assistant-ui is active." : "Agent UI is not using assistant-ui.",
    },
    {
      name: "mastra_runtime",
      ok: config.runtimeProvider === "mastra",
      severity: "critical",
      message: config.runtimeProvider === "mastra" ? "Mastra runtime is active." : "Agent runtime is not Mastra.",
    },
    {
      name: "agent_model",
      ok: Boolean(modelInfo.modelId),
      severity: "critical",
      message: modelInfo.modelId ? `Agent model resolved: ${modelInfo.modelId}.` : "Agent model is missing.",
      metadata: modelInfo,
    },
    {
      name: "workflow_processor_secret",
      ok: Boolean(process.env.AGENT_WORKFLOW_PROCESSOR_SECRET || process.env.JOB_PROCESSOR_SECRET || process.env.CRON_SECRET),
      severity: "critical",
      message: "Workflow processor authorization secret check.",
    },
    {
      name: "eval_processor_secret",
      ok: Boolean(process.env.AGENT_EVAL_PROCESSOR_SECRET || process.env.JOB_PROCESSOR_SECRET || process.env.CRON_SECRET),
      severity: "warning",
      message: "Agent eval processor authorization secret check.",
    },
  ];
}

function buildProviderSnapshot() {
  return {
    xiaomi: {
      configured: Boolean(process.env.XIAOMI_MIMO_API_KEY),
      baseUrl: process.env.XIAOMI_MIMO_BASE_URL || null,
      textModel: process.env.XIAOMI_MIMO_TEXT_MODEL || process.env.XIAOMI_MIMO_MODEL || null,
      visionModel: process.env.XIAOMI_MIMO_VISION_MODEL || null,
    },
    lingya: {
      configured: Boolean(process.env.LINGYA_API_KEY),
      baseUrl: process.env.LINGYA_BASE_URL || null,
    },
    plato: {
      configured: Boolean(process.env.PLATO_API_KEY),
      baseUrl: process.env.PLATO_BASE_URL || null,
    },
    imageStorage: {
      imgbbConfigured: Boolean(process.env.IMGBB_API_KEY),
    },
  };
}

async function checkRequiredTables(supabase: ReturnType<typeof getAdminClient>) {
  const pairs = await Promise.all(
    REQUIRED_TABLES.map(async (table) => {
      const { error } = await supabase.from(table).select("id", { head: true, count: "exact" }).limit(1);
      return [table, !error, error?.message] as const;
    }),
  );

  const status = Object.fromEntries(pairs.map(([table, ok]) => [table, ok]));
  const checks = pairs.map(([table, ok, message]): HealthCheck => ({
    name: `table_${table}`,
    ok,
    severity: "critical",
    message: ok ? `${table} exists.` : `${table} is missing or unreadable: ${message || "unknown error"}`,
  }));

  return { status, checks };
}

async function readRecentObservability(supabase: ReturnType<typeof getAdminClient>) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("agent_observability_events")
    .select("id,event,route,ok,latency_ms,created_at")
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return {
      ok: false,
      error: error.message,
      total: 0,
      failures: 0,
      failureRate: 0,
      latencyP95: null as number | null,
      latest: [],
    };
  }

  const rows = data || [];
  const failures = rows.filter((row) => row.ok === false).length;
  const latencies = rows
    .map((row) => Number(row.latency_ms))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);

  return {
    ok: true,
    total: rows.length,
    failures,
    failureRate: rows.length ? failures / rows.length : 0,
    latencyP95: percentile(latencies, 0.95),
    latest: rows.slice(0, 10),
  };
}

async function readRecentWorkflowQuality(supabase: ReturnType<typeof getAdminClient>) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("agent_workflow_events")
    .select("id,type,message,payload,created_at,workflow_id,step_id")
    .in("type", ["quality_checked", "step_retried"])
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return {
      ok: false,
      error: error.message,
      summary: summarizeWorkflowQualityEvents([]),
    };
  }

  return {
    ok: true,
    error: null as string | null,
    summary: summarizeWorkflowQualityEvents(data || []),
  };
}

async function readLatestMastraRouteEval(supabase: ReturnType<typeof getAdminClient>) {
  const { data, error } = await supabase
    .from("agent_eval_runs")
    .select("id,total,passed,failed,score,summary,created_at")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    return {
      ok: false,
      error: error.message,
      run: null as null | {
        id: string;
        total: number;
        passed: number;
        failed: number;
        score: number;
        created_at: string;
        summary: unknown;
      },
    };
  }

  const run =
    (data || []).find((row) => {
      const summary = (row as { summary?: unknown }).summary;
      return Boolean(
        summary &&
          typeof summary === "object" &&
          (summary as { kind?: unknown }).kind === "mastra_route",
      );
    }) || null;

  return {
    ok: true,
    error: null as string | null,
    run,
  };
}

function buildQueueCheck(snapshot: AgentWorkflowOpsSnapshot): HealthCheck {
  const queued = snapshot.active.queued;
  const running = snapshot.active.running;
  const staleRunning = snapshot.active.staleRunning;
  const unhealthyCount = Object.values(snapshot.counts).some((value) => value < 0);

  if (unhealthyCount) {
    return {
      name: "workflow_queue",
      ok: false,
      severity: "critical",
      message: "Workflow queue counts could not be read.",
      metadata: snapshot,
    };
  }

  const overloaded = queued >= 20 || running >= 10 || staleRunning > 0;
  return {
    name: "workflow_queue",
    ok: !overloaded,
    severity: "warning",
    message: overloaded
      ? `Workflow queue may need repair: queued=${queued}, running=${running}, staleRunning=${staleRunning}.`
      : `Workflow queue looks normal: queued=${queued}, running=${running}.`,
    metadata: snapshot,
  };
}

function buildObservabilityCheck(stats: Awaited<ReturnType<typeof readRecentObservability>>): HealthCheck {
  if (!stats.ok) {
    return {
      name: "observability_recent",
      ok: false,
      severity: "critical",
      message: stats.error || "Recent observability events could not be read.",
    };
  }

  const highFailureRate = stats.total >= 10 && stats.failureRate >= 0.3;
  return {
    name: "observability_recent",
    ok: !highFailureRate,
    severity: "warning",
    message: highFailureRate
      ? `High recent Agent failure rate: ${Math.round(stats.failureRate * 100)}%.`
      : `Recent Agent events look normal: ${stats.total} events, ${stats.failures} failures.`,
    metadata: {
      total: stats.total,
      failures: stats.failures,
      failureRate: stats.failureRate,
      latencyP95: stats.latencyP95,
    },
  };
}

function buildWorkflowQualityCheck(stats: Awaited<ReturnType<typeof readRecentWorkflowQuality>>): HealthCheck {
  if (!stats.ok) {
    return {
      name: "workflow_quality",
      ok: false,
      severity: "warning",
      message: stats.error || "Recent workflow quality events could not be read.",
    };
  }

  const summary: WorkflowQualitySummary = stats.summary;
  const lowScore = summary.totalChecks >= 5 && summary.averageScore !== null && summary.averageScore < 0.68;
  const highRetryRate = summary.totalChecks >= 5 && summary.autoRetryRate >= 0.35;
  const unhealthy = lowScore || highRetryRate;
  return {
    name: "workflow_quality",
    ok: !unhealthy,
    severity: "warning",
    message: unhealthy
      ? `Workflow quality needs attention: score=${summary.averageScore ?? "n/a"}, autoRetryRate=${Math.round(summary.autoRetryRate * 100)}%.`
      : `Workflow quality looks normal: ${summary.totalChecks} checks, score=${summary.averageScore ?? "n/a"}.`,
    metadata: summary,
  };
}

function summarizeStatus(checks: HealthCheck[]) {
  if (checks.some((check) => !check.ok && check.severity === "critical")) return "unhealthy";
  if (checks.some((check) => !check.ok)) return "degraded";
  return "ok";
}

function buildHealthRecommendations(
  checks: HealthCheck[],
  db: {
    workflowOps: AgentWorkflowOpsSnapshot;
    recentObservability: Awaited<ReturnType<typeof readRecentObservability>>;
    recentWorkflowQuality: Awaited<ReturnType<typeof readRecentWorkflowQuality>>;
    latestMastraRouteEval: Awaited<ReturnType<typeof readLatestMastraRouteEval>>;
  } | null,
) {
  const recommendations: string[] = [];
  const failed = checks.filter((check) => !check.ok);

  for (const check of failed) {
    if (check.name.startsWith("table_")) {
      recommendations.push("Run supabase/agent-workflows.sql in Supabase SQL Editor, then rerun this health check.");
      break;
    }
  }
  if (failed.some((check) => check.name === "agent_v2_enabled" || check.name === "mastra_runtime")) {
    recommendations.push("Set AGENT_CHAT_V2_ENABLED=1 and AGENT_RUNTIME_PROVIDER=mastra in production.");
  }
  if (failed.some((check) => check.name === "workflow_processor_secret")) {
    recommendations.push("Configure JOB_PROCESSOR_SECRET or AGENT_WORKFLOW_PROCESSOR_SECRET before enabling EC2 timers.");
  }
  if (db) {
    recommendations.push(...buildWorkflowOpsRecommendations(db.workflowOps));
    recommendations.push(...buildWorkflowQualityRecommendations(db.recentWorkflowQuality.summary));
    if (db.recentObservability.ok && db.recentObservability.failureRate >= 0.3) {
      recommendations.push("Inspect recent agent_observability_events and provider logs before widening traffic.");
    }
    if (db.latestMastraRouteEval.ok && !db.latestMastraRouteEval.run) {
      recommendations.push("Run /api/jobs/run-agent-evals once after deployment to seed Mastra route eval health.");
    }
    if (db.latestMastraRouteEval.ok && db.latestMastraRouteEval.run && db.latestMastraRouteEval.run.failed > 0) {
      recommendations.push("Inspect agent_eval_results for mastra-route failures before enabling broader Agent traffic.");
    }
  }

  return Array.from(new Set(recommendations));
}

function getStaleAfterMinutes(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("staleAfterMinutes") || process.env.AGENT_WORKFLOW_STALE_AFTER_MINUTES;
  const parsed = Number(raw || 10);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(Math.max(Math.floor(parsed), 1), 120);
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1));
  return values[index];
}
