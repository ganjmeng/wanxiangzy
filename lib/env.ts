type EnvCategory = "production-required" | "feature-required" | "optional";
type EnvSeverity = "error" | "warning";

export type EnvContractEntry = {
  name: string;
  category: EnvCategory;
  description: string;
};

export type EnvValidationIssue = {
  name: string;
  category: EnvCategory;
  severity: EnvSeverity;
  message: string;
};

export type ProcessorSecretCandidate = {
  name: string;
  value?: string;
};

export type ProcessorSecretValidation =
  | { ok: true; secrets: string[] }
  | { ok: false; message: string };

const PRODUCTION_REQUIRED_ENV: EnvContractEntry[] = [
  {
    name: "NEXT_PUBLIC_APP_URL",
    category: "production-required",
    description: "Canonical public app origin. Required in production for generated public asset URLs.",
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    category: "production-required",
    description: "Supabase project URL used by browser and server clients.",
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    category: "production-required",
    description: "Supabase anon key used by browser and server clients.",
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    category: "production-required",
    description: "Supabase service role key for privileged server-side operations.",
  },
  {
    name: "REDIS_URL",
    category: "production-required",
    description: "Standard redis:// or rediss:// endpoint shared by BullMQ and distributed AI capacity protection.",
  },
  {
    name: "GENERATION_QUEUE_MODE",
    category: "production-required",
    description: "Durable generation queue mode. Production must use bullmq; legacy direct processing is not supported.",
  },
  {
    name: "AI_ROUTER_CAPACITY_MODE",
    category: "production-required",
    description: "Distributed provider capacity mode. Production must use redis for multi-instance bulkhead enforcement.",
  },
];

// 模型/分析/存储供应商密钥已改为后台加密配置（lib/api/model-provider-secrets.ts），
// env 仅作本地开发回退，不再作为必检项（避免启动日志告警噪音）。
const FEATURE_REQUIRED_ENV: EnvContractEntry[] = [
  {
    name: "JOB_PROCESSOR_SECRET or CRON_SECRET",
    category: "feature-required",
    description: "Required by /api/jobs/process-generations.",
  },
];

const ALIYUN_OSS_REQUIRED_ENV: EnvContractEntry[] = [
  {
    name: "ALIYUN_OSS_ACCESS_KEY_ID",
    category: "feature-required",
    description: "Required when IMAGE_STORAGE_PROVIDER=aliyun-oss.",
  },
  {
    name: "ALIYUN_OSS_ACCESS_KEY_SECRET",
    category: "feature-required",
    description: "Required when IMAGE_STORAGE_PROVIDER=aliyun-oss.",
  },
  {
    name: "ALIYUN_OSS_BUCKET",
    category: "feature-required",
    description: "Required when IMAGE_STORAGE_PROVIDER=aliyun-oss.",
  },
  {
    name: "ALIYUN_OSS_REGION",
    category: "feature-required",
    description: "Required when IMAGE_STORAGE_PROVIDER=aliyun-oss.",
  },
  {
    name: "ALIYUN_OSS_PUBLIC_BASE_URL",
    category: "feature-required",
    description: "Required when IMAGE_STORAGE_PROVIDER=aliyun-oss.",
  },
];

const OPTIONAL_ENV: EnvContractEntry[] = [
  { name: "AI_ROUTER_CAPACITY_MODE", category: "optional", description: "AI provider capacity guard: redis for distributed pooling (recommended in production), local for development only." },
  { name: "LINGYA_BASE_URL", category: "optional", description: "Lingya API base URL override." },
  { name: "GPT_TRYON_PROMPT_TEMPLATE", category: "optional", description: "GPT-Image-2 try-on prompt template: banana (default) or legacy rollback." },
  { name: "ADMIN_SECRETS_ENCRYPTION_KEY", category: "optional", description: "AES-256-GCM key used to encrypt admin-configured provider API keys at rest." },
  { name: "AI_TOOLS_EXECUTION_MODE", category: "optional", description: "AI toolbox runtime mode: live, or mock outside production." },
  { name: "AI_TOOLS_PROVIDER_GATEWAY_URL", category: "optional", description: "HTTPS base URL for the operation-aware AI toolbox Provider Gateway." },
  { name: "AI_TOOLS_PROVIDER_GATEWAY_TOKEN", category: "optional", description: "Server-only Bearer token for the AI toolbox Provider Gateway." },
  { name: "AI_TOOLS_PROVIDER_OPERATIONS", category: "optional", description: "Explicit allowlist for external matting/upscale Gateway operations; generative tools use published model providers." },
  { name: "AI_TOOLS_PROVIDER_TIMEOUT_MS", category: "optional", description: "AI toolbox Provider request timeout, clamped by runtime to 1000-60000ms." },
  { name: "AI_TOOL_ASSET_REF_SECRET", category: "optional", description: "Independent HMAC secret for user-bound AI toolbox mask references." },
  { name: "AI_TOOL_MASK_REF_TTL_SECONDS", category: "optional", description: "Signed mask reference lifetime in seconds (300-86400)." },
  { name: "HAPPYHORSE_BASE_URL", category: "optional", description: "Legacy HappyHorse video base URL; only used as a test/local fallback now that video generation is admin-configured (video.providers)." },
  { name: "YUNWU_API_KEY", category: "optional", description: "Shared Yunwu API key for image recognition and prompt analysis; legacy HappyHorse video fallback only." },
  { name: "YUNWU_API_BASE_URL", category: "optional", description: "Shared Yunwu OpenAI-compatible API base URL; legacy HappyHorse video fallback only." },
  { name: "YUNWU_TEXT_MODEL", category: "optional", description: "Yunwu text analysis model override." },
  { name: "YUNWU_VISION_MODEL", category: "optional", description: "Yunwu vision-capable image recognition model override." },
  { name: "TRYON_CLOTHING_ANALYZE_API_KEY", category: "optional", description: "Deprecated compatibility variable; production try-on vision routing is configured in Admin Portal." },
  { name: "TRYON_CLOTHING_ANALYZE_BASE_URL", category: "optional", description: "Deprecated compatibility variable; production try-on vision routing is configured in Admin Portal." },
  { name: "TRYON_CLOTHING_ANALYZE_MODEL", category: "optional", description: "Deprecated compatibility variable; production try-on vision routing is configured in Admin Portal." },
  { name: "TRYON_CLOTHING_ANALYZE_TIMEOUT_MS", category: "optional", description: "Deprecated compatibility variable; provider timeouts are controlled by the published model deployment." },
  { name: "TRYON_REFERENCE_IMAGE_ALLOWED_HOSTS", category: "optional", description: "Comma-separated extra hosts allowed for managed try-on reference scene images." },
  { name: "ANALYZE_LLM_PROVIDER", category: "optional", description: "Deprecated compatibility variable; prompt and image analysis routing is configured in Admin Portal." },
  { name: "MINIMAX_BASE_URL", category: "optional", description: "MiniMax OpenAI-compatible base URL, default https://api.minimaxi.com." },
  { name: "MINIMAX_MODEL", category: "optional", description: "Default MiniMax model override." },
  { name: "MINIMAX_VISION_MODEL", category: "optional", description: "MiniMax vision model override, default MiniMax-M3." },
  { name: "MINIMAX_TEXT_MODEL", category: "optional", description: "MiniMax text model override, default MiniMax-M3." },
  { name: "MINIMAX_VIDEO_API_KEY", category: "optional", description: "MiniMax H3 video API key; used by scripts/seed-provider-configs to seed video.providers and as a local test fallback." },
  { name: "VIDEO_API_KEY", category: "optional", description: "Shared api.new.bi credential for control-plane image fallback and NewAPI video deployments." },
  { name: "MINIMAX_VIDEO_BASE_URL", category: "optional", description: "MiniMax H3 video base URL (new-api gateway), default https://api.new.bi." },
  { name: "MINIMAX_VIDEO_MODEL", category: "optional", description: "MiniMax H3 upstream model, default minimax-h3." },
  { name: "LINGYA_TEXT_MODEL", category: "optional", description: "Lingya text model override." },
  { name: "LINGYA_VISION_MODEL", category: "optional", description: "Lingya vision model override." },
  { name: "XIAOMI_MIMO_BASE_URL", category: "optional", description: "Xiaomi OpenAI-compatible base URL override." },
  { name: "XIAOMI_MIMO_MODEL", category: "optional", description: "Default Xiaomi model override." },
  { name: "XIAOMI_MIMO_TEXT_MODEL", category: "optional", description: "Xiaomi text model override." },
  { name: "XIAOMI_MIMO_VISION_MODEL", category: "optional", description: "Xiaomi vision model override." },
  { name: "IMAGE_STORAGE_PROVIDER", category: "optional", description: "Image storage adapter. Production uses aliyun-oss exclusively." },
  { name: "NEXT_PUBLIC_ALIYUN_OSS_IMAGE_HOSTS", category: "optional", description: "Comma-separated public OSS image hosts that can use x-oss-process thumbnails." },
  { name: "ALIYUN_OSS_PREFIX", category: "optional", description: "Fallback object key prefix when IMAGE_STORAGE_PROVIDER=aliyun-oss." },
  { name: "ALIYUN_OSS_SITE_ASSET_PREFIX", category: "optional", description: "OSS prefix for permanent site assets." },
  { name: "ALIYUN_OSS_UPLOAD_PREFIX", category: "optional", description: "OSS prefix for short-lived user uploads." },
  { name: "ALIYUN_OSS_GENERATED_PREFIX", category: "optional", description: "OSS prefix for medium-lived generated results." },
  { name: "ALIYUN_OSS_FAVORITE_PREFIX", category: "optional", description: "OSS prefix for permanent user favorites." },
  { name: "ALIYUN_OSS_TEMP_PREFIX", category: "optional", description: "OSS prefix for temporary scratch images." },
  { name: "RESOURCE_LIBRARY_UPLOAD_TOKEN_SECRET", category: "optional", description: "Optional HMAC secret for short-lived resource-library upload receipts; defaults to the OSS access key secret." },
  { name: "ALIYUN_OSS_ENDPOINT", category: "optional", description: "OSS upload endpoint override, without protocol." },
  { name: "ALIYUN_OSS_SECURITY_TOKEN", category: "optional", description: "Optional STS security token for temporary OSS credentials." },
  { name: "ALIYUN_OSS_REMOTE_TRANSFER_MODE", category: "optional", description: "Durable provider URL transfer mode: disabled, stream (EC2/FC worker), or mirror." },
  { name: "ALIYUN_OSS_REMOTE_ALLOWED_HOSTS", category: "optional", description: "Explicit provider image hostname allowlist for durable remote transfers." },
  { name: "ALIYUN_OSS_REMOTE_STREAM_TIMEOUT_MS", category: "optional", description: "Total timeout for each bounded remote-to-OSS stream upload (10000-600000ms)." },
  { name: "ALIYUN_OSS_REMOTE_CONCURRENCY", category: "optional", description: "Per-process global remote transfer network concurrency (1-64)." },
  { name: "ALIYUN_OSS_REMOTE_WORKER_BATCH_SIZE", category: "optional", description: "Durable remote transfer claim batch size (1-100)." },
  { name: "ALIYUN_OSS_MIRROR_ENABLED", category: "optional", description: "Use OSS mirror back-to-origin for generated provider URLs without downloading image bodies to EC2." },
  { name: "ALIYUN_OSS_MIRROR_SIGNING_SECRET", category: "optional", description: "Server-only HMAC key for expiring OSS mirror object capabilities." },
  { name: "ALIYUN_OSS_MIRROR_ALLOWED_HOSTS", category: "optional", description: "Required comma-separated provider image host allowlist; supports explicit *.example.com patterns." },
  { name: "ALIYUN_OSS_MIRROR_RESOLVER_BASE_URL", category: "optional", description: "Public HTTPS OSS mirror resolver base URL; defaults to NEXT_PUBLIC_APP_URL/api/oss-mirror-source/." },
  { name: "ALIYUN_OSS_MIRROR_PREFIX", category: "optional", description: "Object key prefix governed by the persistent OSS mirror rule." },
  { name: "ALIYUN_OSS_MIRROR_TTL_SECONDS", category: "optional", description: "Lifetime of private provider URL mappings (300-86400 seconds)." },
  { name: "ALIYUN_OSS_MIRROR_PREFLIGHT_TIMEOUT_MS", category: "optional", description: "Timeout for the bounded 64-byte provider validation probe (1000-30000ms)." },
  { name: "ALIYUN_OSS_MIRROR_TRIGGER_TIMEOUT_MS", category: "optional", description: "Timeout for the one-byte OSS Range trigger (1000-60000ms)." },
  { name: "ALIYUN_OSS_MIRROR_WAIT_TIMEOUT_MS", category: "optional", description: "Maximum synchronous wait for verified mirror publication (10000-900000ms)." },
  { name: "ALIYUN_OSS_MIRROR_MAX_BYTES", category: "optional", description: "Maximum mirrored result object size (1MiB-512MiB)." },
  { name: "ALIYUN_OSS_MIRROR_MAX_ATTEMPTS", category: "optional", description: "Maximum durable OSS mirror attempts (1-16)." },
  { name: "ALIYUN_OSS_MIRROR_CONCURRENCY", category: "optional", description: "Per-process global mirror network concurrency (1-64)." },
  { name: "DOWNLOAD_IMAGE_ALLOWED_HOSTS", category: "optional", description: "Extra hosts allowed by /api/download-image." },
  { name: "REMOTE_IMAGE_ALLOWED_HOSTS", category: "optional", description: "Explicit provider/reference hosts allowed by server-side remote image fetches." },
  { name: "API_PLATFORM_TEST_ALLOWED_HOSTS", category: "optional", description: "Allowlist for the API platform test proxy." },
  { name: "GENERATION_JOB_BATCH_SIZE", category: "optional", description: "Generation processor batch size." },
  { name: "GENERATION_JOB_STALE_MINUTES", category: "optional", description: "Generation job stale timeout." },
  { name: "GENERATION_AUTO_REGENERATE_ENABLED", category: "optional", description: "Toggle automatic visual repair regeneration." },
  { name: "FASHN_API_KEY", category: "optional", description: "Legacy FASHN provider token." },
  { name: "REPLICATE_API_TOKEN", category: "optional", description: "Legacy Replicate provider token." },
];

const WEAK_PROCESSOR_SECRETS = new Set([
  "change-me",
  "changeme",
  "secret",
  "password",
  "your-secret",
  "your-job-processor-secret",
  "your-cron-secret",
]);

const MIN_PRODUCTION_PROCESSOR_SECRET_LENGTH = 32;
const AI_TOOL_LIVE_OPERATIONS = new Set([
  "matting",
  "upscale",
]);

let validated = false;

export function getEnvContract(): EnvContractEntry[] {
  return [...PRODUCTION_REQUIRED_ENV, ...FEATURE_REQUIRED_ENV, ...ALIYUN_OSS_REQUIRED_ENV, ...OPTIONAL_ENV];
}

export function validateEnv(options: { log?: boolean; nodeEnv?: string } = {}): EnvValidationIssue[] {
  const nodeEnv = options.nodeEnv || process.env.NODE_ENV;
  const isProduction = nodeEnv === "production";
  const imageStorageProvider = (process.env.IMAGE_STORAGE_PROVIDER || "aliyun-oss").trim().toLowerCase();
  const issues: EnvValidationIssue[] = [];

  if (imageStorageProvider !== "aliyun-oss" && isProduction) {
    issues.push({
      name: "IMAGE_STORAGE_PROVIDER",
      category: "optional",
      severity: "error",
      message: "IMAGE_STORAGE_PROVIDER must be aliyun-oss in production.",
    });
  }

  for (const entry of PRODUCTION_REQUIRED_ENV) {
    const value = process.env[entry.name]?.trim();
    const invalidRedisUrl = entry.name === "REDIS_URL" && Boolean(value) && !isStandardRedisUrl(value);
    const invalidGenerationQueueMode = entry.name === "GENERATION_QUEUE_MODE" && value !== undefined && value.toLowerCase() !== "bullmq";
    const invalidCapacityMode = entry.name === "AI_ROUTER_CAPACITY_MODE" && value !== undefined && value.toLowerCase() !== "redis";
    if (!value || invalidRedisUrl || invalidGenerationQueueMode || invalidCapacityMode) {
      issues.push({
        name: entry.name,
        category: entry.category,
        severity: isProduction ? "error" : "warning",
        message: invalidRedisUrl
          ? "REDIS_URL must be a valid redis:// or rediss:// endpoint."
          : invalidGenerationQueueMode
            ? "GENERATION_QUEUE_MODE must be bullmq in production."
            : invalidCapacityMode
              ? "AI_ROUTER_CAPACITY_MODE must be redis in production."
          : isProduction
            ? `${entry.name} is required in production.`
            : `${entry.name} is not set; this is required before production deploys.`,
      });
    }
  }

  // 模型/分析/存储供应商密钥已改后台加密配置，不再做启动期缺失告警；
  // 此处只保留后台处理器密钥的强制校验。
  for (const entry of FEATURE_REQUIRED_ENV) {
    if (entry.name.includes(" or ")) continue;
    if (!process.env[entry.name]) {
      issues.push({
        name: entry.name,
        category: entry.category,
        severity: "warning",
        message: `${entry.name} is not set; related features will fail when used.`,
      });
    }
  }

  if (imageStorageProvider === "aliyun-oss") {
    for (const entry of ALIYUN_OSS_REQUIRED_ENV) {
      if (!process.env[entry.name]) {
        issues.push({
          name: entry.name,
          category: entry.category,
          severity: "warning",
          message: `${entry.name} is required when IMAGE_STORAGE_PROVIDER=aliyun-oss.`,
        });
      }
    }
  }

  validateOssMirrorEnv({ issues, isProduction, imageStorageProvider });

  validateAiToolEnv({ issues, isProduction });

  if (options.log) logEnvIssues(issues);
  return issues;
}

function isStandardRedisUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "redis:" || url.protocol === "rediss:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function validateOssMirrorEnv(params: {
  issues: EnvValidationIssue[];
  isProduction: boolean;
  imageStorageProvider: string;
}) {
  const severity: EnvSeverity = params.isProduction ? "error" : "warning";
  const report = (name: string, message: string) => {
    params.issues.push({ name, category: "feature-required", severity, message });
  };
  const configuredMode = (process.env.ALIYUN_OSS_REMOTE_TRANSFER_MODE || "").trim().toLowerCase();
  if (configuredMode && !["disabled", "mirror", "stream"].includes(configuredMode)) {
    report("ALIYUN_OSS_REMOTE_TRANSFER_MODE", "ALIYUN_OSS_REMOTE_TRANSFER_MODE must be disabled, mirror, or stream.");
    return;
  }
  const mode = configuredMode || (
    /^(1|true|yes)$/i.test((process.env.ALIYUN_OSS_MIRROR_ENABLED || "").trim()) ? "mirror" : "disabled"
  );
  if (mode === "disabled") return;

  if (params.imageStorageProvider !== "aliyun-oss") {
    report("IMAGE_STORAGE_PROVIDER", "OSS remote transfer requires IMAGE_STORAGE_PROVIDER=aliyun-oss.");
  }
  if (!isStrongRuntimeSecret(process.env.ALIYUN_OSS_MIRROR_SIGNING_SECRET)) {
    report(
      "ALIYUN_OSS_MIRROR_SIGNING_SECRET",
      "ALIYUN_OSS_MIRROR_SIGNING_SECRET must contain at least 32 non-placeholder characters.",
    );
  }
  if (!/^(?:hex:)?[a-f0-9]{64}$/i.test((process.env.ADMIN_SECRETS_ENCRYPTION_KEY || "").trim())) {
    report(
      "ADMIN_SECRETS_ENCRYPTION_KEY",
      "OSS remote transfer requires a 32-byte hex ADMIN_SECRETS_ENCRYPTION_KEY for encrypted source URLs.",
    );
  }
  const allowedHostsName = mode === "stream" || process.env.ALIYUN_OSS_REMOTE_ALLOWED_HOSTS !== undefined
    ? "ALIYUN_OSS_REMOTE_ALLOWED_HOSTS"
    : "ALIYUN_OSS_MIRROR_ALLOWED_HOSTS";
  const allowedHosts = (
    process.env.ALIYUN_OSS_REMOTE_ALLOWED_HOSTS || process.env.ALIYUN_OSS_MIRROR_ALLOWED_HOSTS || ""
  )
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (!allowedHosts.length || allowedHosts.some((host) => (
    host === "*"
    || host.includes(":")
    || host.includes("/")
    || !/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)
  ))) {
    report(
      allowedHostsName,
      "OSS remote transfer requires an explicit, valid provider hostname allowlist; a global wildcard is forbidden.",
    );
  }

  if (mode === "mirror") {
    const resolverUrl = process.env.ALIYUN_OSS_MIRROR_RESOLVER_BASE_URL
      || (process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/api/oss-mirror-source/`
        : undefined);
    if (!isValidConfiguredUrl(resolverUrl, true)) {
      report(
        "ALIYUN_OSS_MIRROR_RESOLVER_BASE_URL",
        "OSS mirror requires a public HTTPS resolver URL (or a public HTTPS NEXT_PUBLIC_APP_URL).",
      );
    }
  }

  validateIntegerRange("ALIYUN_OSS_MIRROR_TTL_SECONDS", 300, 86_400, report);
  validateIntegerRange("ALIYUN_OSS_MIRROR_PREFLIGHT_TIMEOUT_MS", 1_000, 30_000, report);
  validateIntegerRange("ALIYUN_OSS_MIRROR_TRIGGER_TIMEOUT_MS", 1_000, 60_000, report);
  validateIntegerRange("ALIYUN_OSS_MIRROR_WAIT_TIMEOUT_MS", 10_000, 900_000, report);
  validateIntegerRange("ALIYUN_OSS_MIRROR_MAX_BYTES", 1_048_576, 536_870_912, report);
  validateIntegerRange("ALIYUN_OSS_MIRROR_MAX_ATTEMPTS", 1, 16, report);
  validateIntegerRange("ALIYUN_OSS_MIRROR_CONCURRENCY", 1, 64, report);
  validateIntegerRange("ALIYUN_OSS_MIRROR_WORKER_BATCH_SIZE", 1, 100, report);
  validateIntegerRange("ALIYUN_OSS_REMOTE_STREAM_TIMEOUT_MS", 10_000, 600_000, report);
  validateIntegerRange("ALIYUN_OSS_REMOTE_CONCURRENCY", 1, 64, report);
  validateIntegerRange("ALIYUN_OSS_REMOTE_WORKER_BATCH_SIZE", 1, 100, report);
}

function validateIntegerRange(
  name: string,
  min: number,
  max: number,
  report: (name: string, message: string) => void,
) {
  const value = process.env[name]?.trim();
  if (value && (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)) {
    report(name, `${name} must be an integer from ${min} to ${max}.`);
  }
}

function validateAiToolEnv(params: {
  issues: EnvValidationIssue[];
  isProduction: boolean;
}) {
  const configuredMode = process.env.AI_TOOLS_EXECUTION_MODE?.trim().toLowerCase();
  if (!configuredMode) return;

  const severity: EnvSeverity = params.isProduction ? "error" : "warning";
  const report = (name: string, message: string) => {
    params.issues.push({
      name,
      category: "feature-required",
      severity,
      message,
    });
  };

  if (configuredMode !== "live" && configuredMode !== "mock") {
    report("AI_TOOLS_EXECUTION_MODE", "AI_TOOLS_EXECUTION_MODE must be live or mock.");
    return;
  }
  if (configuredMode === "mock") {
    if (params.isProduction) {
      report("AI_TOOLS_EXECUTION_MODE", "AI_TOOLS_EXECUTION_MODE=mock is forbidden in production.");
    }
    return;
  }

  const configuredOperations = process.env.AI_TOOLS_PROVIDER_OPERATIONS;
  if (configuredOperations === undefined) {
    report(
      "AI_TOOLS_PROVIDER_OPERATIONS",
      "Set an explicit AI_TOOLS_PROVIDER_OPERATIONS allowlist in live mode; use an empty value to keep every remote operation disabled.",
    );
    return;
  }

  const operations = [...new Set(
    configuredOperations.split(",").map((value) => value.trim()).filter(Boolean),
  )];
  const invalidOperations = operations.filter((operation) => !AI_TOOL_LIVE_OPERATIONS.has(operation));
  if (invalidOperations.length) {
    report(
      "AI_TOOLS_PROVIDER_OPERATIONS",
      `AI_TOOLS_PROVIDER_OPERATIONS contains unsupported operations: ${invalidOperations.join(", ")}.`,
    );
  }
  if (!isStrongRuntimeSecret(process.env.AI_TOOL_ASSET_REF_SECRET)) {
    report(
      "AI_TOOL_ASSET_REF_SECRET",
      "AI_TOOL_ASSET_REF_SECRET must contain at least 32 non-placeholder characters in live mode.",
    );
  }
  if (!isStrongRuntimeSecret(process.env.RESOURCE_LIBRARY_UPLOAD_TOKEN_SECRET)) {
    report(
      "RESOURCE_LIBRARY_UPLOAD_TOKEN_SECRET",
      "RESOURCE_LIBRARY_UPLOAD_TOKEN_SECRET must contain at least 32 non-placeholder characters in live mode.",
    );
  }

  const maskTtl = process.env.AI_TOOL_MASK_REF_TTL_SECONDS?.trim();
  if (maskTtl && (!/^\d+$/.test(maskTtl) || Number(maskTtl) < 300 || Number(maskTtl) > 86_400)) {
    report("AI_TOOL_MASK_REF_TTL_SECONDS", "AI_TOOL_MASK_REF_TTL_SECONDS must be an integer from 300 to 86400.");
  }

  if (!operations.length || invalidOperations.length) return;

  if (!isValidConfiguredUrl(process.env.AI_TOOLS_PROVIDER_GATEWAY_URL, params.isProduction)) {
    report(
      "AI_TOOLS_PROVIDER_GATEWAY_URL",
      "A credential-free HTTPS AI_TOOLS_PROVIDER_GATEWAY_URL is required when live operations are enabled.",
    );
  }
  if (!isStrongRuntimeSecret(process.env.AI_TOOLS_PROVIDER_GATEWAY_TOKEN)) {
    report(
      "AI_TOOLS_PROVIDER_GATEWAY_TOKEN",
      "AI_TOOLS_PROVIDER_GATEWAY_TOKEN must contain at least 32 non-placeholder characters when live operations are enabled.",
    );
  }
  const timeout = process.env.AI_TOOLS_PROVIDER_TIMEOUT_MS?.trim();
  if (timeout && (!/^\d+$/.test(timeout) || Number(timeout) < 1_000 || Number(timeout) > 60_000)) {
    report("AI_TOOLS_PROVIDER_TIMEOUT_MS", "AI_TOOLS_PROVIDER_TIMEOUT_MS must be an integer from 1000 to 60000.");
  }
}

function isValidConfiguredUrl(value: string | undefined, isProduction: boolean) {
  if (!value?.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    if (parsed.username || parsed.password || !parsed.hostname) return false;
    if (parsed.protocol === "https:") return true;
    return !isProduction
      && parsed.protocol === "http:"
      && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1");
  } catch {
    return false;
  }
}

function isStrongRuntimeSecret(value: string | undefined) {
  const normalized = value?.trim() || "";
  return normalized.length >= MIN_PRODUCTION_PROCESSOR_SECRET_LENGTH
    && !WEAK_PROCESSOR_SECRETS.has(normalized.toLowerCase())
    && !normalized.toLowerCase().includes("replace-with");
}

export function validateEnvOnce(): EnvValidationIssue[] {
  if (validated) return [];
  validated = true;
  return validateEnv({ log: true });
}

export function getConfiguredPublicBaseUrl(options: {
  allowNonProductionFallbacks?: boolean;
  nodeEnv?: string;
} = {}): string | undefined {
  const nodeEnv = options.nodeEnv || process.env.NODE_ENV;
  const appUrl = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_APP_URL);
  if (appUrl) return appUrl;

  if (nodeEnv === "production" || options.allowNonProductionFallbacks === false) {
    return undefined;
  }

  return normalizePublicBaseUrl(
    process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.PUBLIC_SITE_URL ||
      process.env.SITE_URL ||
      process.env.APP_URL ||
      process.env.URL
  );
}

export function requirePublicBaseUrlForRuntime(context: string): string | undefined {
  const publicBaseUrl = getConfiguredPublicBaseUrl();
  if (publicBaseUrl) return publicBaseUrl;

  if (process.env.NODE_ENV === "production") {
    throw new Error(`${context} requires NEXT_PUBLIC_APP_URL in production.`);
  }

  return undefined;
}

export function normalizePublicBaseUrl(value?: string | null): string | undefined {
  if (!value) return undefined;

  const raw = value.startsWith("http://") || value.startsWith("https://")
    ? value
    : `https://${value}`;

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export function getConfiguredProcessorSecrets(
  candidates: ProcessorSecretCandidate[],
  label: string,
  options: { nodeEnv?: string } = {}
): ProcessorSecretValidation {
  const nodeEnv = options.nodeEnv || process.env.NODE_ENV;
  const configured = candidates
    .map((candidate) => ({
      name: candidate.name,
      value: candidate.value?.trim() || "",
    }))
    .filter((candidate) => candidate.value.length > 0);

  if (configured.length === 0) {
    return {
      ok: false,
      message: `${label} requires one of: ${candidates.map((candidate) => candidate.name).join(", ")}`,
    };
  }

  const weakReasons = configured
    .map((candidate) => getWeakProductionProcessorSecretReason(candidate.name, candidate.value, nodeEnv))
    .filter((reason): reason is string => Boolean(reason));

  const validSecrets = configured
    .filter((candidate) => !getWeakProductionProcessorSecretReason(candidate.name, candidate.value, nodeEnv))
    .map((candidate) => candidate.value);

  if (validSecrets.length > 0) {
    return { ok: true, secrets: Array.from(new Set(validSecrets)) };
  }

  return {
    ok: false,
    message: weakReasons.length > 0
      ? `${label} has an unsafe production secret: ${weakReasons.join("; ")}`
      : `${label} is not configured.`,
  };
}

function getWeakProductionProcessorSecretReason(
  name: string,
  value: string,
  nodeEnv: string | undefined
): string | undefined {
  if (nodeEnv !== "production") return undefined;

  const normalized = value.trim().toLowerCase();
  if (WEAK_PROCESSOR_SECRETS.has(normalized)) {
    return `${name} uses placeholder value "${value}"`;
  }

  if (value.length < MIN_PRODUCTION_PROCESSOR_SECRET_LENGTH) {
    return `${name} must be at least ${MIN_PRODUCTION_PROCESSOR_SECRET_LENGTH} characters`;
  }

  return undefined;
}

function logEnvIssues(issues: EnvValidationIssue[]): void {
  if (issues.length === 0) return;

  console.warn(`[env] ${issues.map((issue) => issue.message).join(" ")}`);
}

if (process.env.NODE_ENV !== "test") {
  validateEnvOnce();
}
