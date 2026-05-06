type LatestMastraRouteEvalState = {
  ok: boolean;
  error: string | null;
  run: null | {
    id: string;
    total: number;
    passed: number;
    failed: number;
    score: number;
    created_at: string;
    summary: unknown;
  };
};

export type AgentHealthCheck = {
  name: string;
  ok: boolean;
  severity: "info" | "warning" | "critical";
  message: string;
  metadata?: Record<string, unknown>;
};

export function buildMastraRouteEvalCheck(
  evalState: LatestMastraRouteEvalState,
): AgentHealthCheck {
  if (!evalState.ok) {
    return {
      name: "mastra_route_eval",
      ok: false,
      severity: "warning",
      message: evalState.error || "Latest Mastra route eval could not be read.",
    };
  }

  if (!evalState.run) {
    return {
      name: "mastra_route_eval",
      ok: false,
      severity: "warning",
      message: "No Mastra route eval run found yet. Run /api/jobs/run-agent-evals after deployment.",
    };
  }

  const run = evalState.run;
  const ok = run.failed === 0 && run.score >= 90;
  return {
    name: "mastra_route_eval",
    ok,
    severity: "warning",
    message: ok
      ? `Latest Mastra route eval passed: score=${run.score}, failed=${run.failed}.`
      : `Latest Mastra route eval needs attention: score=${run.score}, failed=${run.failed}.`,
    metadata: {
      runId: run.id,
      total: run.total,
      passed: run.passed,
      failed: run.failed,
      score: run.score,
      createdAt: run.created_at,
    },
  };
}
