import {
  AI_CONTROL_PLANE_SCHEMA_VERSION,
  type AiControlPlaneConfig,
  type AiControlPlaneIssue,
  type AiLogicalModel,
  type AiModelDeployment,
  type AiModality,
  type AiProviderEndpoint,
  type AiProviderProtocol,
  type AiRoutingPolicy,
} from "@/lib/ai-control-plane/types";

const MODALITIES: readonly AiModality[] = ["image", "text", "vision", "video", "audio", "embedding"];
const PROTOCOLS: readonly AiProviderProtocol[] = [
  "openai-image",
  "gemini-native",
  "kie-market",
  "openai-chat",
  "newapi-video",
];

export const DEFAULT_AI_ROUTING_POLICY: AiRoutingPolicy = {
  // One request per deployment, across at most two deployments. Durable job
  // retry resumes completed slots and supplies the outer transient-failure budget.
  maxAttempts: 2,
  // Leases are heartbeated throughout long jobs. A short TTL makes a crashed
  // Worker release scarce provider capacity within about a minute instead of
  // leaving ghost slots occupied for half an hour.
  leaseTtlSeconds: 60,
  retryBaseDelayMs: 800,
  retryMaxDelayMs: 8_000,
  circuitFailureThreshold: 5,
  circuitMinimumSamples: 5,
  circuitOpenSeconds: 60,
  halfOpenMaxRequests: 1,
  smartWeights: {
    reliability: 0.42,
    latency: 0.24,
    cost: 0.12,
    capacity: 0.14,
    quality: 0.08,
  },
};

/**
 * Safe capacity defaults used when a newly added deployment omits an
 * explicit limit. Provider endpoints and model codes are never defaulted.
 */
export const DEFAULT_DEPLOYMENT_MAX_CONCURRENCY = 24;
export const DEFAULT_DEPLOYMENT_REQUESTS_PER_MINUTE = 60;
export const DEFAULT_DEPLOYMENT_BURST = 24;

export function createDefaultAiControlPlaneConfig(): AiControlPlaneConfig {
  return {
    schemaVersion: AI_CONTROL_PLANE_SCHEMA_VERSION,
    models: [
      imageModel("nano-banana-2", "Nano Banana 2", { "1K": 4, "2K": 6, "4K": 8 }),
      imageModel("nano-banana-2-lite", "Nano Banana 2 Lite", { "1K": 3 }),
      imageModel("gpt-image-2", "GPT Image 2", { "1K": 3, "2K": 4, "4K": 5 }),
      imageModel("nano-banana-pro", "Nano Banana Pro", { "1K": 8, "2K": 10, "4K": 12 }),
      imageModel("qwen3", "Qwen3 Image", { "1K": 3, "2K": 5 }),
      imageModel("qwen3-pro", "Qwen3 Image Pro", { "1K": 5, "2K": 7 }),
      { ...imageModel("z-image", "Z-Image", { "1K": 3 }), capabilities: ["generation"] },
      baseModel("text-default", "默认文本模型", "text", false, false),
      baseModel("vision-default", "默认视觉模型", "vision", false, false),
      { ...baseModel("video-minimax", "MiniMax 视频", "video", false, false), capabilities: ["image-to-video", "motion-control", "first-last-frame"], defaultRoutingMode: "smart", creditPrices: { "pro:768p:minimum": 15, "pro:768p:perSecond": 3, "pro:2k:minimum": 20, "pro:2k:perSecond": 4 } },
      { ...baseModel("video-seedance", "Seedance 视频", "video", false, false), capabilities: ["image-to-video", "motion-control", "first-last-frame"], defaultRoutingMode: "smart", creditPrices: { "mini:720p:minimum": 20, "mini:720p:perSecond": 5, "fast:480p:minimum": 16, "fast:480p:perSecond": 4, "fast:720p:minimum": 24, "fast:720p:perSecond": 6, "pro:720p:minimum": 28, "pro:720p:perSecond": 7, "pro:1080p:minimum": 80, "pro:1080p:perSecond": 20 } },
      { ...baseModel("video-seedance25", "Seedance 2.5", "video", false, false), capabilities: ["image-to-video", "motion-control", "first-last-frame"], defaultRoutingMode: "smart", creditPrices: { "pro:480p:minimum": 20, "pro:480p:perSecond": 5, "pro:720p:minimum": 28, "pro:720p:perSecond": 7, "pro:1080p:minimum": 80, "pro:1080p:perSecond": 20 } },
      { ...baseModel("video-wan", "Wan 3.0", "video", false, false), capabilities: ["image-to-video", "motion-control", "first-last-frame"], defaultRoutingMode: "smart", creditPrices: { "pro:480p:minimum": 20, "pro:480p:perSecond": 5, "pro:720p:minimum": 28, "pro:720p:perSecond": 7, "pro:1080p:minimum": 80, "pro:1080p:perSecond": 20 } },
    ],
    // Provider endpoints and real upstream model codes are deployment data,
    // not source-code defaults. A new installation starts unconfigured and
    // must publish them through the unified model control plane.
    providers: [],
    deployments: [],
    policy: DEFAULT_AI_ROUTING_POLICY,
  };
}

export function validateAiControlPlaneConfig(value: unknown): {
  config: AiControlPlaneConfig;
  issues: AiControlPlaneIssue[];
} {
  const root = record(value);
  const issues: AiControlPlaneIssue[] = [];
  const models = array(root.models).map((item, index) => parseModel(item, index, issues)).filter(Boolean) as AiLogicalModel[];
  const providers = array(root.providers).map((item, index) => parseProvider(item, index, issues)).filter(Boolean) as AiProviderEndpoint[];
  const deployments = array(root.deployments).map((item, index) => parseDeployment(item, index, issues)).filter(Boolean) as AiModelDeployment[];
  const policy = parsePolicy(root.policy, issues);

  if (!models.length) issues.push(error("models", "至少需要一个逻辑模型"));
  if (!providers.length) issues.push(error("providers", "至少需要一个供应商端点"));

  checkUnique(models, "models", issues);
  checkUnique(providers, "providers", issues);
  checkUnique(deployments, "deployments", issues);
  const modelIds = new Set(models.map((item) => item.id));
  const providerIds = new Set(providers.map((item) => item.id));
  for (const [index, item] of deployments.entries()) {
    if (!modelIds.has(item.modelId)) issues.push(error(`deployments.${index}.modelId`, `逻辑模型 ${item.modelId} 不存在`));
    if (!providerIds.has(item.providerId)) issues.push(error(`deployments.${index}.providerId`, `供应商 ${item.providerId} 不存在`));
  }
  for (const [index, model] of models.entries()) {
    if (model.enabled && !deployments.some((item) => item.enabled && item.modelId === model.id)) {
      issues.push(error(`models.${index}`, `已启用模型 ${model.id} 至少需要一个已启用部署`));
    }
    if (model.modality === "image" && model.enabled && model.userVisible) {
      const prices = model.creditPrices || {};
      if (!["1K", "2K", "4K"].some((size) => typeof prices[size] === "number" && prices[size] > 0)) {
        issues.push(error(`models.${index}.creditPrices`, `用户可见图片模型 ${model.id} 至少需要配置一个正数积分价格`));
      }
    }
    for (const fallbackId of model.compatibleFallbackModelIds || []) {
      if (!modelIds.has(fallbackId)) issues.push(error(`models.${index}.compatibleFallbackModelIds`, `兼容模型 ${fallbackId} 不存在`));
      const target = models.find((item) => item.id === fallbackId);
      if (target && target.modality !== model.modality) issues.push(error(`models.${index}.compatibleFallbackModelIds`, "跨模型兜底必须保持相同模态"));
    }
  }
  for (const [index, deployment] of deployments.entries()) {
    const model = models.find((item) => item.id === deployment.modelId);
    if (!model) continue;
    const allowed = protocolsForModality(model.modality);
    if (!allowed.includes(deployment.protocol)) {
      issues.push(error(`deployments.${index}.protocol`, `${model.modality} 模型不支持 ${deployment.protocol} 协议`));
    }
  }

  return {
    config: {
      schemaVersion: AI_CONTROL_PLANE_SCHEMA_VERSION,
      models,
      providers,
      deployments,
      policy,
      updatedAt: text(root.updatedAt) || undefined,
      updatedFrom: text(root.updatedFrom) || undefined,
    },
    issues,
  };
}

function protocolsForModality(modality: AiModality): AiProviderProtocol[] {
  if (modality === "image") return ["openai-image", "gemini-native", "kie-market"];
  if (modality === "video") return ["newapi-video", "kie-market"];
  return ["openai-chat"];
}

function parseModel(value: unknown, index: number, issues: AiControlPlaneIssue[]): AiLogicalModel | null {
  const item = record(value);
  const path = `models.${index}`;
  const id = identifier(item.id);
  const displayName = text(item.displayName);
  const modality = MODALITIES.includes(item.modality as AiModality) ? item.modality as AiModality : null;
  if (!id) issues.push(error(`${path}.id`, "模型 ID 只能包含字母、数字、点、下划线和连字符"));
  if (!displayName) issues.push(error(`${path}.displayName`, "模型名称不能为空"));
  if (!modality) issues.push(error(`${path}.modality`, "模型模态不合法"));
  if (!id || !displayName || !modality) return null;
  return {
    id,
    displayName,
    modality,
    description: text(item.description) || undefined,
    enabled: item.enabled !== false,
    userVisible: item.userVisible !== false,
    capabilities: strings(item.capabilities),
    defaultRoutingMode: item.defaultRoutingMode === "smart" ? "smart" : "stable",
    creditPrices: numericRecord(item.creditPrices),
    compatibleFallbackModelIds: strings(item.compatibleFallbackModelIds).filter((candidate) => candidate !== id),
    presentation: parsePresentation(item.presentation, path, issues),
  };
}

function parseProvider(value: unknown, index: number, issues: AiControlPlaneIssue[]): AiProviderEndpoint | null {
  const item = record(value);
  const path = `providers.${index}`;
  const id = identifier(item.id);
  const name = text(item.name);
  const baseUrl = normalizeHttpUrl(text(item.baseUrl));
  if (!id) issues.push(error(`${path}.id`, "供应商 ID 不合法"));
  if (!name) issues.push(error(`${path}.name`, "供应商名称不能为空"));
  if (!baseUrl) issues.push(error(`${path}.baseUrl`, "Base URL 必须是 HTTPS（本地开发可使用 HTTP localhost）"));
  if (!id || !name || !baseUrl) return null;
  return {
    id,
    name,
    baseUrl,
    apiKey: text(item.apiKey) || undefined,
    enabled: item.enabled !== false,
    region: text(item.region) || undefined,
    timeoutMs: integer(item.timeoutMs, 120_000, 3_000, 45 * 60_000),
    capacityGroup: identifier(item.capacityGroup) || undefined,
    capacityMaxConcurrency: integer(item.capacityMaxConcurrency, DEFAULT_DEPLOYMENT_MAX_CONCURRENCY, 1, 10_000),
    capacityRequestsPerMinute: integer(item.capacityRequestsPerMinute, 0, 0, 1_000_000) || undefined,
    capacityBurst: integer(item.capacityBurst, 0, 0, 100_000) || undefined,
    notes: text(item.notes) || undefined,
  };
}

function parseDeployment(value: unknown, index: number, issues: AiControlPlaneIssue[]): AiModelDeployment | null {
  const item = record(value);
  const path = `deployments.${index}`;
  const id = identifier(item.id);
  const modelId = identifier(item.modelId);
  const providerId = identifier(item.providerId);
  const upstreamModel = text(item.upstreamModel);
  const protocol = PROTOCOLS.includes(item.protocol as AiProviderProtocol) ? item.protocol as AiProviderProtocol : null;
  if (!id) issues.push(error(`${path}.id`, "部署 ID 不合法"));
  if (!modelId) issues.push(error(`${path}.modelId`, "模型 ID 不合法"));
  if (!providerId) issues.push(error(`${path}.providerId`, "供应商 ID 不合法"));
  if (!upstreamModel) issues.push(error(`${path}.upstreamModel`, "上游模型名称不能为空"));
  if (!protocol) issues.push(error(`${path}.protocol`, "协议不受支持"));
  if (!id || !modelId || !providerId || !upstreamModel || !protocol) return null;
  return {
    id,
    modelId,
    providerId,
    upstreamModel,
    protocol,
    enabled: item.enabled !== false,
    priority: integer(item.priority, 100, 0, 10_000),
    weight: integer(item.weight, 100, 1, 10_000),
    maxConcurrency: integer(item.maxConcurrency, DEFAULT_DEPLOYMENT_MAX_CONCURRENCY, 1, 10_000),
    requestsPerMinute: integer(item.requestsPerMinute, 240, 1, 1_000_000),
    burst: integer(item.burst, 16, 1, 10_000),
    asyncMode: item.asyncMode === true,
    capabilities: strings(item.capabilities),
    cost: numericRecord(item.cost),
    qualityScore: number(item.qualityScore, 0.8, 0, 1),
    metadata: primitiveRecord(item.metadata),
    adapterConfig: parseAdapterConfig(item.adapterConfig, path, issues),
  };
}

function parsePresentation(value: unknown, modelPath: string, issues: AiControlPlaneIssue[]): AiLogicalModel["presentation"] {
  const item = record(value);
  const iconUrl = optionalHttpsUrl(item.iconUrl, `${modelPath}.presentation.iconUrl`, issues);
  const coverUrl = optionalHttpsUrl(item.coverUrl, `${modelPath}.presentation.coverUrl`, issues);
  const locales: NonNullable<AiLogicalModel["presentation"]>["locales"] = {};
  for (const [locale, raw] of Object.entries(record(item.locales)).slice(0, 30)) {
    if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)) {
      issues.push(error(`${modelPath}.presentation.locales.${locale}`, "语言代码不合法"));
      continue;
    }
    const localized = record(raw);
    const next = {
      title: boundedText(localized.title, 120),
      shortTitle: boundedText(localized.shortTitle, 60),
      description: boundedText(localized.description, 500),
      badge: boundedText(localized.badge, 40),
    };
    if (Object.values(next).some(Boolean)) locales[locale] = next;
  }
  const presentation = {
    shortTitle: boundedText(item.shortTitle, 60),
    badge: boundedText(item.badge, 40),
    iconUrl,
    coverUrl,
    group: boundedText(item.group, 60),
    tags: strings(item.tags).slice(0, 12),
    sortOrder: integer(item.sortOrder, 100, -10_000, 10_000),
    featured: item.featured === true,
    locales: Object.keys(locales).length ? locales : undefined,
  };
  return Object.values(presentation).some((entry) => entry !== undefined && entry !== false && (!(Array.isArray(entry)) || entry.length))
    ? presentation
    : undefined;
}

function parseAdapterConfig(value: unknown, deploymentPath: string, issues: AiControlPlaneIssue[]): AiModelDeployment["adapterConfig"] {
  const item = record(value);
  const generationPath = adapterPath(item.generationPath, `${deploymentPath}.adapterConfig.generationPath`, issues);
  const editPath = adapterPath(item.editPath, `${deploymentPath}.adapterConfig.editPath`, issues);
  const statusPath = adapterPath(item.statusPath, `${deploymentPath}.adapterConfig.statusPath`, issues);
  const staticParameters = primitiveRecord(item.staticParameters, 32);
  const authMode = ["bearer", "x-api-key", "x-goog-api-key"].includes(text(item.authMode))
    ? text(item.authMode) as "bearer" | "x-api-key" | "x-goog-api-key"
    : undefined;
  if (!generationPath && !editPath && !statusPath && !staticParameters && !authMode) return undefined;
  return { authMode, generationPath, editPath, statusPath, staticParameters };
}

function parsePolicy(value: unknown, issues: AiControlPlaneIssue[]): AiRoutingPolicy {
  const item = record(value);
  const weights = record(item.smartWeights);
  const policy: AiRoutingPolicy = {
    maxAttempts: integer(item.maxAttempts, DEFAULT_AI_ROUTING_POLICY.maxAttempts, 1, 2),
    // Clamp legacy published values as well as new drafts. Long-running jobs
    // rely on renewal, not on an oversized crash-recovery window.
    leaseTtlSeconds: integer(item.leaseTtlSeconds, DEFAULT_AI_ROUTING_POLICY.leaseTtlSeconds, 30, 120),
    retryBaseDelayMs: integer(item.retryBaseDelayMs, DEFAULT_AI_ROUTING_POLICY.retryBaseDelayMs, 0, 30_000),
    retryMaxDelayMs: integer(item.retryMaxDelayMs, DEFAULT_AI_ROUTING_POLICY.retryMaxDelayMs, 0, 120_000),
    circuitFailureThreshold: integer(item.circuitFailureThreshold, DEFAULT_AI_ROUTING_POLICY.circuitFailureThreshold, 1, 100),
    circuitMinimumSamples: integer(item.circuitMinimumSamples, DEFAULT_AI_ROUTING_POLICY.circuitMinimumSamples, 1, 10_000),
    circuitOpenSeconds: integer(item.circuitOpenSeconds, DEFAULT_AI_ROUTING_POLICY.circuitOpenSeconds, 5, 86_400),
    halfOpenMaxRequests: integer(item.halfOpenMaxRequests, DEFAULT_AI_ROUTING_POLICY.halfOpenMaxRequests, 1, 100),
    smartWeights: {
      reliability: number(weights.reliability, DEFAULT_AI_ROUTING_POLICY.smartWeights.reliability, 0, 1),
      latency: number(weights.latency, DEFAULT_AI_ROUTING_POLICY.smartWeights.latency, 0, 1),
      cost: number(weights.cost, DEFAULT_AI_ROUTING_POLICY.smartWeights.cost, 0, 1),
      capacity: number(weights.capacity, DEFAULT_AI_ROUTING_POLICY.smartWeights.capacity, 0, 1),
      quality: number(weights.quality, DEFAULT_AI_ROUTING_POLICY.smartWeights.quality, 0, 1),
    },
  };
  if (policy.retryMaxDelayMs < policy.retryBaseDelayMs) {
    issues.push(error("policy.retryMaxDelayMs", "最大退避时间不能小于基础退避时间"));
  }
  const total = Object.values(policy.smartWeights).reduce((sum, value) => sum + value, 0);
  if (total <= 0) issues.push(error("policy.smartWeights", "智能路由权重总和必须大于 0"));
  return policy;
}

function imageModel(id: string, displayName: string, creditPrices: Record<string, number>): AiLogicalModel {
  const assetBase = "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/model-covers";
  const presentation = id === "nano-banana-2"
    ? { shortTitle: "香蕉2", badge: "推荐", iconUrl: `${assetBase}/banana-2.png`, sortOrder: 10, featured: true }
    : id === "nano-banana-2-lite"
      ? { shortTitle: "香蕉2 Lite", badge: "快速", iconUrl: `${assetBase}/banana-2-lite-v2.png`, sortOrder: 15, featured: false }
    : id === "gpt-image-2"
      ? { shortTitle: "GPT Image 2", badge: "NEW", iconUrl: `${assetBase}/gpt-image-2.png`, sortOrder: 20, featured: false }
    : id === "nano-banana-pro"
      ? { shortTitle: "香蕉Pro", badge: "PRO", iconUrl: `${assetBase}/banana-pro.png`, sortOrder: 30, featured: false }
    : id === "qwen3"
      ? { shortTitle: "千问3", badge: "NEW", iconUrl: `${assetBase}/qwen-mascot-v2.png`, sortOrder: 40, featured: false }
    : id === "qwen3-pro"
      ? { shortTitle: "千问3 Pro", badge: "PRO", iconUrl: `${assetBase}/qwen-mascot-v2.png`, sortOrder: 50, featured: false }
      : { shortTitle: "Z-Image", badge: "NEW", iconUrl: `${assetBase}/z-image-mascot-v2.png`, sortOrder: 60, featured: false };
  return { ...baseModel(id, displayName, "image", true, false), capabilities: ["generation", "edit"], creditPrices, presentation };
}

function baseModel(id: string, displayName: string, modality: AiModality, userVisible: boolean, enabled = true): AiLogicalModel {
  return { id, displayName, modality, enabled, userVisible, capabilities: [], defaultRoutingMode: "stable" };
}

function checkUnique(items: Array<{ id: string }>, path: string, issues: AiControlPlaneIssue[]) {
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (seen.has(item.id)) issues.push(error(`${path}.${index}.id`, `ID ${item.id} 重复`));
    seen.add(item.id);
  }
}

function error(path: string, message: string): AiControlPlaneIssue {
  return { path, message, severity: "error" };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function identifier(value: unknown): string { const raw = text(value); return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(raw) ? raw : ""; }
function strings(value: unknown): string[] { return Array.from(new Set(array(value).map(text).filter(Boolean))).slice(0, 100); }
function integer(value: unknown, fallback: number, min: number, max: number): number { const parsed = Math.floor(Number(value)); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback; }
function number(value: unknown, fallback: number, min: number, max: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback; }
function numericRecord(value: unknown): Record<string, number> | undefined {
  const source = record(value); const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(source)) { const parsed = Number(raw); if (key && Number.isFinite(parsed) && parsed >= 0) out[key] = parsed; }
  return Object.keys(out).length ? out : undefined;
}
function primitiveRecord(value: unknown, maxEntries = 100): Record<string, string | number | boolean> | undefined {
  const source = record(value); const out: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(source).slice(0, maxEntries)) if (/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(key) && ["string", "number", "boolean"].includes(typeof raw)) out[key] = raw as string | number | boolean;
  return Object.keys(out).length ? out : undefined;
}
function boundedText(value: unknown, max: number): string | undefined { const result = text(value); return result ? result.slice(0, max) : undefined; }
function optionalHttpsUrl(value: unknown, path: string, issues: AiControlPlaneIssue[]): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const normalized = normalizeHttpUrl(raw);
  if (!normalized) issues.push(error(path, "展示图片必须使用 HTTPS URL（本地开发可使用 localhost）"));
  return normalized || undefined;
}
function adapterPath(value: unknown, path: string, issues: AiControlPlaneIssue[]): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  if (raw.length > 256 || !raw.startsWith("/") || raw.includes("://") || raw.includes("..") || /[?#]/.test(raw)) {
    issues.push(error(path, "适配器路径必须是安全的相对路径，可使用 {model} 或 {taskId} 占位符"));
    return undefined;
  }
  const placeholders = raw.match(/\{[^}]+\}/g) || [];
  if (placeholders.some((entry) => entry !== "{model}" && entry !== "{taskId}")) {
    issues.push(error(path, "适配器路径仅支持 {model}、{taskId} 占位符"));
    return undefined;
  }
  return raw;
}
function normalizeHttpUrl(value: string): string {
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return "";
    return value.replace(/\/+$/, "");
  } catch { return ""; }
}
