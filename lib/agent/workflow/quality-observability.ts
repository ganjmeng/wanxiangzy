export type WorkflowQualityEvent = {
  id?: string;
  type?: string | null;
  message?: string | null;
  payload?: unknown;
  created_at?: string | null;
  workflow_id?: string | null;
  step_id?: string | null;
};

export type WorkflowQualitySummary = {
  totalChecks: number;
  passed: number;
  needsAttention: number;
  regenerateRequested: number;
  autoRetries: number;
  autoRetryRate: number;
  averageScore: number | null;
  sources: Record<string, number>;
  topIssues: Array<{ issue: string; count: number }>;
  latest: Array<{
    id?: string;
    workflowId?: string | null;
    stepId?: string | null;
    ok: boolean;
    score: number | null;
    shouldRegenerate: boolean;
    source: string;
    summary?: string;
    issues: string[];
    createdAt?: string | null;
  }>;
};

export function summarizeWorkflowQualityEvents(
  events: WorkflowQualityEvent[],
): WorkflowQualitySummary {
  const qualityEvents = events.filter((event) => event.type === "quality_checked");
  const retryEvents = events.filter(isQualityRetryEvent);
  const sources: Record<string, number> = {};
  const issueCounts: Record<string, number> = {};
  const scores: number[] = [];
  let passed = 0;
  let regenerateRequested = 0;

  const latest = qualityEvents.slice(0, 20).map((event) => {
    const payload = readPayload(event.payload);
    const score = readScore(payload.score);
    const ok = payload.ok !== false && payload.shouldRegenerate !== true;
    const shouldRegenerate = payload.shouldRegenerate === true;
    const source = readString(payload.source, "unknown");
    const issues = readStringArray(payload.issues).slice(0, 8);

    if (ok) passed += 1;
    if (shouldRegenerate) regenerateRequested += 1;
    if (score !== null) scores.push(score);
    increment(sources, source);
    for (const issue of issues) increment(issueCounts, normalizeIssue(issue));

    return {
      id: event.id,
      workflowId: event.workflow_id,
      stepId: event.step_id,
      ok,
      score,
      shouldRegenerate,
      source,
      summary: readOptionalString(payload.summary),
      issues,
      createdAt: event.created_at,
    };
  });

  for (const event of qualityEvents.slice(20)) {
    const payload = readPayload(event.payload);
    const score = readScore(payload.score);
    const ok = payload.ok !== false && payload.shouldRegenerate !== true;
    const shouldRegenerate = payload.shouldRegenerate === true;
    if (ok) passed += 1;
    if (shouldRegenerate) regenerateRequested += 1;
    if (score !== null) scores.push(score);
    increment(sources, readString(payload.source, "unknown"));
    for (const issue of readStringArray(payload.issues)) increment(issueCounts, normalizeIssue(issue));
  }

  const totalChecks = qualityEvents.length;
  const autoRetries = retryEvents.length;
  return {
    totalChecks,
    passed,
    needsAttention: Math.max(0, totalChecks - passed),
    regenerateRequested,
    autoRetries,
    autoRetryRate: totalChecks ? round(autoRetries / totalChecks) : 0,
    averageScore: scores.length ? round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
    sources,
    topIssues: Object.entries(issueCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([issue, count]) => ({ issue, count })),
    latest,
  };
}

export function buildWorkflowQualityRecommendations(summary: WorkflowQualitySummary) {
  const recommendations: string[] = [];

  if (summary.totalChecks === 0) {
    recommendations.push("No workflow quality checks have run yet. Generate at least one workflow output after deployment.");
    return recommendations;
  }
  if (summary.averageScore !== null && summary.averageScore < 0.68) {
    recommendations.push("Recent visual quality score is low. Inspect quality_checked events and provider image outputs.");
  }
  if (summary.totalChecks >= 5 && summary.autoRetryRate >= 0.35) {
    recommendations.push("Quality auto-retry rate is high. Review prompts, image role detection, and model/provider selection.");
  }
  if (summary.regenerateRequested >= 3) {
    recommendations.push("Multiple outputs requested regeneration. Check topIssues for recurring generation defects.");
  }
  if (!recommendations.length) {
    recommendations.push("Workflow visual quality checks look healthy.");
  }

  return recommendations;
}

function isQualityRetryEvent(event: WorkflowQualityEvent) {
  if (event.type !== "step_retried") return false;
  const payload = readPayload(event.payload);
  if (readScore(payload.score) !== null) return true;
  return readString(event.message, "").toLowerCase().includes("visual quality review");
}

function readPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function readScore(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return null;
  return round(Math.max(0, Math.min(1, numberValue > 1 ? numberValue / 100 : numberValue)));
}

function normalizeIssue(issue: string) {
  return issue.trim().replace(/\s+/g, " ").slice(0, 120);
}

function increment(record: Record<string, number>, key: string) {
  record[key] = (record[key] || 0) + 1;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

