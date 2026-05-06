export type MastraRouteObservabilityEvent = {
  id?: string;
  event?: string | null;
  ok?: boolean | null;
  confidence?: number | null;
  action?: string | null;
  metadata?: unknown;
  created_at?: string | null;
};

export type MastraRouteObservabilitySummary = {
  total: number;
  guarded: number;
  guardedRate: number;
  averageConfidence: number | null;
  requestedRoutes: Record<string, number>;
  effectiveRoutes: Record<string, number>;
  sources: Record<string, number>;
  latest: Array<{
    id?: string;
    ok: boolean;
    requestedRoute: string;
    effectiveRoute: string;
    source: string;
    confidence: number | null;
    guarded: boolean;
    reason?: string;
    createdAt?: string | null;
  }>;
};

export function summarizeMastraRouteEvents(
  events: MastraRouteObservabilityEvent[],
): MastraRouteObservabilitySummary {
  const routeEvents = events.filter((event) => event.event === "agent_chat_v2_routed");
  const requestedRoutes: Record<string, number> = {};
  const effectiveRoutes: Record<string, number> = {};
  const sources: Record<string, number> = {};
  const confidences: number[] = [];
  let guarded = 0;

  const latest = routeEvents.slice(0, 20).map((event) => {
    const metadata = readMetadata(event.metadata);
    const requestedRoute = readString(metadata.requestedRoute, "unknown");
    const effectiveRoute = readString(
      metadata.effectiveRoute,
      readString(event.action, "unknown"),
    );
    const source = readString(metadata.source, "unknown");
    const confidence = readConfidence(event.confidence);
    const isGuarded = metadata.guarded === true;

    increment(requestedRoutes, requestedRoute);
    increment(effectiveRoutes, effectiveRoute);
    increment(sources, source);
    if (typeof confidence === "number") confidences.push(confidence);
    if (isGuarded) guarded += 1;

    return {
      id: event.id,
      ok: event.ok !== false,
      requestedRoute,
      effectiveRoute,
      source,
      confidence,
      guarded: isGuarded,
      reason: readOptionalString(metadata.reason),
      createdAt: event.created_at,
    };
  });

  for (const event of routeEvents.slice(20)) {
    const metadata = readMetadata(event.metadata);
    increment(requestedRoutes, readString(metadata.requestedRoute, "unknown"));
    increment(
      effectiveRoutes,
      readString(metadata.effectiveRoute, readString(event.action, "unknown")),
    );
    increment(sources, readString(metadata.source, "unknown"));
    const confidence = readConfidence(event.confidence);
    if (typeof confidence === "number") confidences.push(confidence);
    if (metadata.guarded === true) guarded += 1;
  }

  return {
    total: routeEvents.length,
    guarded,
    guardedRate: routeEvents.length ? guarded / routeEvents.length : 0,
    averageConfidence: confidences.length
      ? round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length)
      : null,
    requestedRoutes,
    effectiveRoutes,
    sources,
    latest,
  };
}

function readMetadata(value: unknown): Record<string, unknown> {
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

function readConfidence(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return null;
  return round(numberValue > 1 ? numberValue / 100 : numberValue);
}

function increment(record: Record<string, number>, key: string) {
  record[key] = (record[key] || 0) + 1;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
