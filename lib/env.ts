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
];

// 模型/分析/存储供应商密钥已改为后台加密配置（lib/api/model-provider-secrets.ts），
// env 仅作本地开发回退，不再作为必检项（避免启动日志告警噪音）。
const FEATURE_REQUIRED_ENV: EnvContractEntry[] = [
  {
    name: "JOB_PROCESSOR_SECRET or CRON_SECRET",
    category: "feature-required",
    description: "Required by /api/jobs/process-generations.",
  },
  {
    name: "AGENT_WORKFLOW_PROCESSOR_SECRET or JOB_PROCESSOR_SECRET or CRON_SECRET",
    category: "feature-required",
    description: "Required by /api/jobs/process-agent-workflows.",
  },
  {
    name: "AGENT_EVAL_PROCESSOR_SECRET or JOB_PROCESSOR_SECRET or CRON_SECRET",
    category: "feature-required",
    description: "Required by /api/jobs/run-agent-evals.",
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
  { name: "UPSTASH_REDIS_REST_URL", category: "optional", description: "Distributed AI routing concurrency and RPM lease store." },
  { name: "UPSTASH_REDIS_REST_TOKEN", category: "optional", description: "Credential for the distributed AI routing capacity store." },
  { name: "LINGYA_BASE_URL", category: "optional", description: "Lingya API base URL override." },
  { name: "GPT_IMAGE_PROVIDER", category: "optional", description: "GPT-Image-2 provider: catrouter (default) or plato." },
  { name: "GPT_TRYON_PROMPT_TEMPLATE", category: "optional", description: "GPT-Image-2 try-on prompt template: banana (default) or legacy rollback." },
  { name: "ADMIN_SECRETS_ENCRYPTION_KEY", category: "optional", description: "AES-256-GCM key used to encrypt admin-configured provider API keys at rest." },
  { name: "AI_TOOLS_EXECUTION_MODE", category: "optional", description: "AI toolbox runtime mode: live, or mock outside production." },
  { name: "AI_TOOLS_PROVIDER_GATEWAY_URL", category: "optional", description: "HTTPS base URL for the operation-aware AI toolbox Provider Gateway." },
  { name: "AI_TOOLS_PROVIDER_GATEWAY_TOKEN", category: "optional", description: "Server-only Bearer token for the AI toolbox Provider Gateway." },
  { name: "AI_TOOLS_PROVIDER_OPERATIONS", category: "optional", description: "Explicit allowlist for external matting/upscale Gateway operations; generative tools use published model providers." },
  { name: "AI_TOOLS_PROVIDER_TIMEOUT_MS", category: "optional", description: "AI toolbox Provider request timeout, clamped by runtime to 1000-60000ms." },
  { name: "AI_TOOL_ASSET_REF_SECRET", category: "optional", description: "Independent HMAC secret for user-bound AI toolbox mask references." },
  { name: "AI_TOOL_MASK_REF_TTL_SECONDS", category: "optional", description: "Signed mask reference lifetime in seconds (300-86400)." },
  { name: "CATROUTER_BASE_URL", category: "optional", description: "CatRouter API base URL, default https://api.catrouter.net." },
  { name: "CATROUTER_API_KEY", category: "optional", description: "CatRouter API key for GPT-Image-2 and optional Banana native routing." },
  { name: "CATROUTER_GPT_IMAGE_MODEL", category: "optional", description: "CatRouter provider model id for gpt-image-2." },
  { name: "CATROUTER_NANO_BANANA_MODEL", category: "optional", description: "CatRouter provider model id for nano-banana-2." },
  { name: "CATROUTER_NANO_BANANA_PRO_MODEL", category: "optional", description: "CatRouter provider model id for nano-banana-pro." },
  { name: "PLATO_BASE_URL", category: "optional", description: "Plato API base URL override." },
  { name: "PLATO_API_KEY", category: "optional", description: "Plato GPT-Image-2 API key fallback." },
  { name: "PLATO_GPT_IMAGE_MODEL", category: "optional", description: "Plato provider model id for gpt-image-2." },
  { name: "NANO_BANANA_PROVIDER", category: "optional", description: "Nano Banana native image provider: yunwu (default), catrouter, or laozhang." },
  { name: "YUNWU_NATIVE_BASE_URL", category: "optional", description: "Yunwu Gemini native generateContent base URL, default https://yunwu.ai." },
  { name: "YUNWU_NATIVE_API_KEY", category: "optional", description: "Yunwu Gemini native generateContent API key; falls back to YUNWU_API_KEY." },
  { name: "YUNWU_NANO_BANANA_MODEL", category: "optional", description: "Yunwu provider model id for nano-banana-2." },
  { name: "YUNWU_NANO_BANANA_PRO_MODEL", category: "optional", description: "Yunwu provider model id for nano-banana-pro." },
  { name: "LAOZHANG_BASE_URL", category: "optional", description: "LaoZhang Gemini native generateContent base URL fallback." },
  { name: "LAOZHANG_API_KEY", category: "optional", description: "LaoZhang Gemini native generateContent API key fallback." },
  { name: "LAOZHANG_NANO_BANANA_MODEL", category: "optional", description: "LaoZhang provider model id for nano-banana-2." },
  { name: "LAOZHANG_NANO_BANANA_PRO_MODEL", category: "optional", description: "LaoZhang provider model id for nano-banana-pro." },
  { name: "HAPPYHORSE_BASE_URL", category: "optional", description: "Legacy HappyHorse video base URL; only used as a test/local fallback now that video generation is admin-configured (video.providers)." },
  { name: "YUNWU_API_KEY", category: "optional", description: "Shared Yunwu API key for image recognition and prompt analysis; legacy HappyHorse video fallback only." },
  { name: "YUNWU_API_BASE_URL", category: "optional", description: "Shared Yunwu OpenAI-compatible API base URL; legacy HappyHorse video fallback only." },
  { name: "YUNWU_TEXT_MODEL", category: "optional", description: "Yunwu text analysis model override." },
  { name: "YUNWU_VISION_MODEL", category: "optional", description: "Yunwu vision-capable image recognition model override." },
  { name: "TRYON_CLOTHING_ANALYZE_API_KEY", category: "optional", description: "Yunwu/OpenAI-compatible API key for try-on clothing recognition; falls back to LINGYA_API_KEY." },
  { name: "TRYON_CLOTHING_ANALYZE_BASE_URL", category: "optional", description: "Yunwu/OpenAI-compatible base URL for try-on clothing recognition." },
  { name: "TRYON_CLOTHING_ANALYZE_MODEL", category: "optional", description: "Vision-capable model for try-on clothing recognition, default gpt-5-nano." },
  { name: "TRYON_CLOTHING_ANALYZE_TIMEOUT_MS", category: "optional", description: "Timeout for try-on clothing recognition requests." },
  { name: "TRYON_REFERENCE_IMAGE_ALLOWED_HOSTS", category: "optional", description: "Comma-separated extra hosts allowed for managed try-on reference scene images." },
  { name: "ANALYZE_LLM_PROVIDER", category: "optional", description: "Prompt and image analysis provider: minimax, yunwu, xiaomi, or legacy lingya." },
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
  { name: "IMAGE_STORAGE_PROVIDER", category: "optional", description: "Image storage adapter: imgbb or aliyun-oss." },
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
  { name: "API_PLATFORM_TEST_ALLOWED_HOSTS", category: "optional", description: "Allowlist for the API platform test proxy." },
  { name: "GENERATION_JOB_BATCH_SIZE", category: "optional", description: "Generation processor batch size." },
  { name: "GENERATION_JOB_STALE_MINUTES", category: "optional", description: "Generation job stale timeout." },
  { name: "AGENT_WORKFLOW_BATCH_SIZE", category: "optional", description: "Agent workflow processor batch size." },
  { name: "AGENT_EVAL_MAX_USERS", category: "optional", description: "Maximum users evaluated per scheduled eval run." },
  { name: "AGENT_VISUAL_AUTO_REGENERATE_ENABLED", category: "optional", description: "Toggle automatic visual repair regeneration." },
  { name: "AGENT_WORKFLOW_SELF_REPAIR_ENABLED", category: "optional", description: "Toggle agent workflow self-repair." },
  { name: "AGENT_BRAIN_V2_ROLLOUT", category: "optional", description: "Agent brain v2 rollout toggle." },
  { name: "AGENT_BRAIN_V2_ROLLOUT_PERCENT", category: "optional", description: "Agent brain v2 percentage rollout." },
  { name: "FASHN_API_KEY", category: "optional", description: "Legacy FASHN provider token." },
  { name: "REPLICATE_API_TOKEN", category: "optional", description: "Legacy Replicate provider token." },
  { name: "WORKER_ENABLED", category: "optional", description: "Toggle the async generation worker (PM2-managed). Default true." },
  { name: "WORKER_DRY_RUN", category: "optional", description: "Worker logs would-be claims without mutating state. Default false." },
  { name: "WORKER_POLL_INTERVAL_MS", category: "optional", description: "Worker idle poll interval in milliseconds. Default 1000." },
  { name: "WORKER_IDLE_BACKOFF_MAX_MS", category: "optional", description: "Cap for adaptive exponential backoff when consecutive polls return no jobs, in milliseconds. Default 60000 (60s). Idle worker then issues ~60 RPCs/hr instead of ~3600." },
  { name: "WORKER_ERROR_BACKOFF_MS", category: "optional", description: "Initial backoff after a worker tick error in milliseconds. Default 5000." },
  { name: "WORKER_MAX_ERROR_BACKOFF_MS", category: "optional", description: "Cap for exponential backoff in milliseconds. Default 30000." },
  { name: "WORKER_BATCH_SIZE", category: "optional", description: "Worker claim batch size (1-10). Default 2." },
  { name: "WORKER_STALE_MINUTES", category: "optional", description: "Minutes before a processing row is reclaimable. Default 8. Must be > WORKER_MAX_INFLIGHT_TIMEOUT_MS / 60_000." },
  { name: "WORKER_SHUTDOWN_TIMEOUT_MS", category: "optional", description: "Worker graceful shutdown window in milliseconds. Default 30000." },
  { name: "WORKER_HEARTBEAT_INTERVAL_MS", category: "optional", description: "Worker heartbeat log cadence in milliseconds. Default 60000." },
  { name: "WORKER_MAX_INFLIGHT_TIMEOUT_MS", category: "optional", description: "Worker per-batch watchdog timeout in milliseconds. Default 420000 (7 minutes). Must be < WORKER_STALE_MINUTES * 60_000." },
  { name: "WORKER_MAX_CONSECUTIVE_ERRORS", category: "optional", description: "Worker exits after this many consecutive errors so PM2 can restart. Default 10." },
  { name: "WORKER_LOG_FORMAT", category: "optional", description: "Worker log format: text (default) or json." },
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
  const imageStorageProvider = (process.env.IMAGE_STORAGE_PROVIDER || "imgbb").trim().toLowerCase();
  const issues: EnvValidationIssue[] = [];

  for (const entry of PRODUCTION_REQUIRED_ENV) {
    if (!process.env[entry.name]) {
      issues.push({
        name: entry.name,
        category: entry.category,
        severity: isProduction ? "error" : "warning",
        message: isProduction
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

  const capacityMode = (process.env.AI_ROUTER_CAPACITY_MODE || "redis").trim().toLowerCase();
  if (capacityMode === "redis") {
    for (const name of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const) {
      if (!process.env[name]) {
        issues.push({
          name,
          category: "optional",
          severity: "warning",
          message: `${name} is required for distributed AI routing capacity protection; process-local fallback is not safe for multi-process production.`,
        });
      }
    }
  }

  if (options.log) logEnvIssues(issues);
  return issues;
}

function validateOssMirrorEnv(params: {
  issues: EnvValidationIssue[];
  isProduction: boolean;
  imageStorageProvider: string;
}) {
  if (!/^(1|true|yes)$/i.test((process.env.ALIYUN_OSS_MIRROR_ENABLED || "").trim())) return;

  const severity: EnvSeverity = params.isProduction ? "error" : "warning";
  const report = (name: string, message: string) => {
    params.issues.push({ name, category: "feature-required", severity, message });
  };

  if (params.imageStorageProvider !== "aliyun-oss") {
    report("IMAGE_STORAGE_PROVIDER", "ALIYUN_OSS_MIRROR_ENABLED requires IMAGE_STORAGE_PROVIDER=aliyun-oss.");
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
      "OSS mirror requires a 32-byte hex ADMIN_SECRETS_ENCRYPTION_KEY for encrypted source URLs.",
    );
  }
  const allowedHosts = (process.env.ALIYUN_OSS_MIRROR_ALLOWED_HOSTS || "")
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
      "ALIYUN_OSS_MIRROR_ALLOWED_HOSTS",
      "OSS mirror requires an explicit, valid provider hostname allowlist; a global wildcard is forbidden.",
    );
  }

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

  validateIntegerRange("ALIYUN_OSS_MIRROR_TTL_SECONDS", 300, 86_400, report);
  validateIntegerRange("ALIYUN_OSS_MIRROR_PREFLIGHT_TIMEOUT_MS", 1_000, 30_000, report);
  validateIntegerRange("ALIYUN_OSS_MIRROR_TRIGGER_TIMEOUT_MS", 1_000, 60_000, report);
  validateIntegerRange("ALIYUN_OSS_MIRROR_WAIT_TIMEOUT_MS", 10_000, 900_000, report);
  validateIntegerRange("ALIYUN_OSS_MIRROR_MAX_BYTES", 1_048_576, 536_870_912, report);
  validateIntegerRange("ALIYUN_OSS_MIRROR_MAX_ATTEMPTS", 1, 16, report);
  validateIntegerRange("ALIYUN_OSS_MIRROR_CONCURRENCY", 1, 64, report);
  validateIntegerRange("ALIYUN_OSS_MIRROR_WORKER_BATCH_SIZE", 1, 100, report);
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
