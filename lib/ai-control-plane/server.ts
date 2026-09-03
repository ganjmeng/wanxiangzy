import { getAdminClient } from "@/lib/supabase/admin";
import {
  decryptProviderSecret,
  maskProviderSecret,
} from "@/lib/api/model-provider-secrets";
import {
  AI_CONTROL_PLANE_CONFIG_KEY,
  type AiControlPlaneConfig,
  type AiControlPlanePublicConfig,
  type AiProviderHealth,
  type AiProviderMetric,
  type AiModality,
} from "@/lib/ai-control-plane/types";
import {
  createDefaultAiControlPlaneConfig,
  validateAiControlPlaneConfig,
} from "@/lib/ai-control-plane/config";
import { getImageCreditCost, type PricedImageSize } from "@/lib/model-pricing";
import { isPricedImageModel } from "@/lib/image-model-catalog";
import { calculateVideoCreditCost, getVideoModelPrice, type VideoModelPrice, type VideoProviderName } from "@/lib/api/video-catalog";
import type { AiVideoAudioMode, AiVideoModelMode, AiVideoResolution } from "@/lib/ai-video";

type PublishedRow = {
  id: string;
  value: unknown;
  published_at: string | null;
  created_at: string;
};

let cached: { expiresAt: number; value: AiControlPlaneConfig | null; row: PublishedRow | null; source: "unified" | "legacy" | "missing" } | null = null;
const CONFIG_CACHE_MS = 5_000;

export function invalidateAiControlPlaneCache() {
  cached = null;
}

export async function getPublishedAiControlPlaneRawRow(): Promise<PublishedRow | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { data, error } = await getAdminClient()
    .from("admin_config_versions")
    .select("id,value,published_at,created_at")
    .eq("config_key", AI_CONTROL_PLANE_CONFIG_KEY)
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as PublishedRow;
}

export async function getAiControlPlaneConfig(options: { decryptSecrets?: boolean; allowLegacy?: boolean } = {}): Promise<AiControlPlaneConfig | null> {
  const loaded = await loadConfig(options.allowLegacy !== false);
  if (!loaded.value) return null;
  if (!options.decryptSecrets) return structuredClone(loaded.value);
  return {
    ...structuredClone(loaded.value),
    providers: loaded.value.providers.map((provider) => ({
      ...provider,
      apiKey: decryptProviderSecret(provider.apiKey),
    })),
  };
}

export async function getAiControlPlanePublicSnapshot(): Promise<{
  configKey: string;
  versionId?: string;
  publishedAt?: string | null;
  source: "unified" | "legacy" | "missing";
  config: AiControlPlanePublicConfig;
  issues: ReturnType<typeof validateAiControlPlaneConfig>["issues"];
}> {
  const loaded = await loadConfig(true);
  const sourceConfig = loaded.value || createDefaultAiControlPlaneConfig();
  const validated = validateAiControlPlaneConfig(sourceConfig);
  const config: AiControlPlanePublicConfig = {
    ...validated.config,
    providers: validated.config.providers.map(({ apiKey, ...provider }) => ({
      ...provider,
      apiKeyConfigured: Boolean(apiKey),
      apiKeyMasked: apiKey ? maskProviderSecret(apiKey) : "",
    })),
  };
  return {
    configKey: AI_CONTROL_PLANE_CONFIG_KEY,
    versionId: loaded.row?.id,
    publishedAt: loaded.row?.published_at ?? null,
    source: loaded.source,
    config,
    issues: validated.issues,
  };
}

export async function loadAiProviderHealth(deploymentIds: string[]): Promise<Map<string, AiProviderHealth>> {
  const ids = Array.from(new Set(deploymentIds.filter(Boolean)));
  const out = new Map<string, AiProviderHealth>();
  if (!ids.length || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return out;
  const { data, error } = await getAdminClient()
    .from("ai_provider_health")
    .select("deployment_id,circuit_state,consecutive_failures,sample_count,ewma_success_rate,ewma_latency_ms,opened_until,rate_limited_until")
    .in("deployment_id", ids);
  if (error) return out;
  for (const row of data || []) {
    out.set(String(row.deployment_id), {
      deploymentId: String(row.deployment_id),
      circuitState: row.circuit_state === "open" || row.circuit_state === "half_open" ? row.circuit_state : "closed",
      consecutiveFailures: finite(row.consecutive_failures),
      sampleCount: finite(row.sample_count),
      ewmaSuccessRate: finite(row.ewma_success_rate, 1),
      ewmaLatencyMs: finite(row.ewma_latency_ms),
      openedUntil: row.opened_until,
      rateLimitedUntil: row.rate_limited_until,
    });
  }
  return out;
}

export async function loadAiProviderMetrics(hours = 24): Promise<AiProviderMetric[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
  const boundedHours = Math.min(Math.max(Math.floor(hours), 1), 24 * 90);
  const since = new Date(Date.now() - boundedHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await getAdminClient().rpc("admin_ai_provider_metrics", { p_since: since });
  if (error) return [];
  return (data || []).map((row: Record<string, unknown>) => ({
    deploymentId: String(row.deployment_id || ""),
    modelId: String(row.model_id || ""),
    providerId: String(row.provider_id || ""),
    requestCount: finite(row.request_count),
    successCount: finite(row.success_count),
    failureCount: finite(row.failure_count),
    successRate: nullableNumber(row.success_rate),
    averageLatencyMs: nullableNumber(row.avg_latency_ms),
    p50LatencyMs: nullableNumber(row.p50_latency_ms),
    p95LatencyMs: nullableNumber(row.p95_latency_ms),
    estimatedCostUsd: finite(row.estimated_cost_usd),
    lastRequestAt: typeof row.last_request_at === "string" ? row.last_request_at : null,
  }));
}

/**
 * Server-authoritative image charging. Dynamic models must publish a positive
 * price for the selected size; they never inherit a cheaper legacy price.
 */
export async function getConfiguredImageCreditCost(modelId: string, size: PricedImageSize): Promise<number> {
  const config = await getAiControlPlaneConfig({ allowLegacy: true });
  const model = config?.models.find((item) => item.id === modelId && item.modality === "image" && item.enabled);
  const configured = model?.creditPrices?.[size];
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) return configured;
  if (isPricedImageModel(modelId)) return getImageCreditCost(modelId, size);
  if (!model) throw new Error(`模型 ${modelId} 未发布或已停用`);
  throw new Error(`模型 ${modelId} 未配置 ${size} 积分价格，已拒绝生成以避免错误扣费`);
}

/**
 * Public-safe video rate lookup. A published control-plane price wins; the
 * catalog rate is only a compatibility fallback for older deployments that
 * have not published video prices yet.
 */
export async function getConfiguredVideoCreditRate(
  provider: VideoProviderName,
  modelMode: AiVideoModelMode,
  resolution: AiVideoResolution,
): Promise<VideoModelPrice> {
  const config = await getAiControlPlaneConfig({ allowLegacy: true });
  const model = config?.models.find((item) => item.id === `video-${provider}` && item.modality === "video");
  const prices = model?.creditPrices || {};
  const prefix = `${modelMode}:${resolution}`;
  const minimum = prices[`${prefix}:minimum`];
  const perSecond = prices[`${prefix}:perSecond`];
  if (typeof minimum === "number" && Number.isFinite(minimum) && minimum > 0
    && typeof perSecond === "number" && Number.isFinite(perSecond) && perSecond > 0) {
    return { minimum, perSecond };
  }
  return getVideoModelPrice(provider, modelMode, resolution);
}

/** Server-authoritative video charging. A published control-plane price wins; legacy catalog rates only preserve existing deployments. */
export async function getConfiguredVideoCreditCost(input: {
  provider: VideoProviderName;
  modelMode: AiVideoModelMode;
  resolution: AiVideoResolution;
  duration?: number;
  genCount?: number;
  audioMode?: AiVideoAudioMode;
  generateAudio?: boolean;
}) {
  const price = await getConfiguredVideoCreditRate(input.provider, input.modelMode, input.resolution);
  return calculateVideoCreditCost({
    provider: input.provider,
    price,
    duration: input.duration,
    genCount: input.genCount,
    audioMode: input.audioMode,
  });
}

export async function getDefaultAiModelId(modality: AiModality): Promise<string> {
  const config = await getAiControlPlaneConfig({ allowLegacy: true });
  const enabled = config?.models.filter((item) => item.enabled && item.modality === modality) || [];
  const conventionalId = `${modality}-default`;
  return enabled.find((item) => item.id === conventionalId)?.id
    || enabled[0]?.id
    || conventionalId;
}

async function loadConfig(allowLegacy: boolean) {
  if (cached && cached.expiresAt > Date.now()) return cached;
  const row = await getPublishedAiControlPlaneRawRow();
  if (row) {
    const parsed = validateAiControlPlaneConfig(row.value);
    const value = parsed.issues.some((issue) => issue.severity === "error") ? null : parsed.config;
    cached = { expiresAt: Date.now() + CONFIG_CACHE_MS, value, row, source: value ? "unified" : "missing" };
    return cached;
  }
  const legacy = allowLegacy ? await buildLegacyControlPlaneConfig() : null;
  cached = { expiresAt: Date.now() + CONFIG_CACHE_MS, value: legacy, row: null, source: legacy ? "legacy" : "missing" };
  return cached;
}

async function buildLegacyControlPlaneConfig(): Promise<AiControlPlaneConfig | null> {
  try {
    const [llmModule, llmServer, videoModule, videoServer] = await Promise.all([
      import("@/lib/api/llm-provider-registry"),
      import("@/lib/api/llm-provider-registry.server"),
      import("@/lib/api/video-provider-registry"),
      import("@/lib/api/video-provider-registry.server"),
    ]);
    const [llmRaw, videoRaw] = await Promise.all([
      llmServer.getPublishedLlmProviderRawValue(),
      videoServer.getPublishedVideoProviderRawValue(),
    ]);
    if (!llmRaw && !videoRaw) return null;
    const config = createDefaultAiControlPlaneConfig();

    const llm = llmModule.parseLlmProviderOverrides(llmRaw);
    for (const kind of ["text", "vision"] as const) {
      const override = llm[kind];
      if (!override) continue;
      const providerId = `legacy-${kind}-${override.provider}`;
      config.providers.push({ id: providerId, name: `Legacy ${override.provider}`, baseUrl: override.baseUrl, apiKey: override.apiKey, enabled: override.enabled, timeoutMs: 120_000 });
      config.deployments.push({ id: `${providerId}-deployment`, modelId: `${kind}-default`, providerId, upstreamModel: override.upstreamModel, protocol: "openai-chat", enabled: override.enabled, priority: 10, weight: 100, maxConcurrency: 8, requestsPerMinute: 120, burst: 8, qualityScore: 0.8 });
    }

    const video = videoModule.parseVideoProviderOverrides(videoRaw);
    for (const [providerName, override] of Object.entries(video)) {
      if (!override) continue;
      const providerId = `legacy-video-${providerName}`;
      config.providers.push({ id: providerId, name: `Legacy ${providerName}`, baseUrl: override.baseUrl, apiKey: override.apiKey, enabled: override.enabled, timeoutMs: 20 * 60_000 });
      const modelId = `video-${providerName}`;
      if (!config.models.some((model) => model.id === modelId)) {
        config.models.push({ id: modelId, displayName: `${providerName} 视频`, modality: "video", enabled: true, userVisible: true, capabilities: videoCapabilities(providerName), defaultRoutingMode: "smart" });
      }
      config.deployments.push({ id: `${providerId}-deployment`, modelId, providerId, upstreamModel: providerName, protocol: "newapi-video", enabled: override.enabled, priority: 10, weight: 100, maxConcurrency: 2, requestsPerMinute: 30, burst: 2, asyncMode: true, capabilities: videoCapabilities(providerName), qualityScore: 0.8 });
    }
    config.models = config.models.map((model) => ({
      ...model,
      enabled: config.deployments.some((item) => item.modelId === model.id && item.enabled),
      ...(model.id === "video-minimax" ? { capabilities: videoCapabilities("minimax"), defaultRoutingMode: "smart" as const } : {}),
      ...(model.id === "video-seedance" ? { capabilities: videoCapabilities("seedance"), defaultRoutingMode: "smart" as const } : {}),
      ...(model.id === "video-seedance25" ? { capabilities: videoCapabilities("seedance25"), defaultRoutingMode: "smart" as const } : {}),
      ...(model.id === "video-wan" ? { capabilities: videoCapabilities("wan"), defaultRoutingMode: "smart" as const } : {}),
    }));
    return config;
  } catch {
    return null;
  }
}

function videoCapabilities(_providerName: string) {
  return ["image-to-video", "motion-control", "first-last-frame"];
}

function finite(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
