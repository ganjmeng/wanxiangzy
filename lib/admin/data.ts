import { CREDIT_COSTS, DEFAULT_LINGYA_MODEL, type ImageSize, type LingyaModel } from "@/lib/api/lingya";
import { getPublishedLlmProviderRawValue } from "@/lib/api/llm-provider-registry.server";
import { getPublishedVideoProviderRawValue } from "@/lib/api/video-provider-registry.server";
import { getAiControlPlanePublicSnapshot } from "@/lib/ai-control-plane/server";
import { getAdminClient } from "@/lib/supabase/admin";
import type { TaskStatusGroup } from "@/lib/task-queue";
import { normalizeModule } from "@/lib/task-queue-index";
import { withTimeout, isRecord } from "@/lib/utils";
import { getGenerationBullMqHealth } from "@/lib/queue/generation-queue-health.server";
import { getWorkerHeartbeats, type WorkerHeartbeat } from "@/lib/queue/worker-heartbeat.server";
import {
  DEFAULT_WORKER_RUNTIME_CONFIG,
  getWorkerRuntimeAlerts,
  getWorkerRuntimeDrift,
  WORKER_RUNTIME_CONFIG_KEY,
  parseWorkerRuntimeConfig,
  type WorkerRuntimeAlertStatus,
  type WorkerRuntimeConfig,
} from "@/lib/queue/worker-runtime-config";
import type {
  AdminAssetLifecycleAction,
  AdminAssetLifecycleItem,
  AdminAssetLifecycleOverview,
  AdminAssetLifecyclePolicy,
  AdminAssetLifecycleStage,
  AdminAssetList,
  AdminAssetListItem,
  AdminAssetStorageProvider,
  AdminModerationCase,
  AdminModerationList,
} from "./assets";
import {
  BILLING_ORDERS_TABLE,
  BILLING_PRICES_TABLE,
  BILLING_PRODUCTS_TABLE,
  BILLING_SUBSCRIPTIONS_TABLE,
  BILLING_WEBHOOK_EVENTS_TABLE,
  type AdminBillingConfigStatus,
  type AdminBillingOrder,
  type AdminBillingOverview,
  type AdminBillingPrice,
  type AdminBillingProduct,
  type AdminBillingSubscription,
  type AdminBillingWebhookEvent,
} from "./billing";
import type { AdminBreakdownItem, AdminMetric } from "./shared";

export type {
  AdminAssetLifecycleAction,
  AdminAssetLifecycleItem,
  AdminAssetLifecycleOverview,
  AdminAssetLifecyclePolicy,
  AdminAssetLifecycleStage,
  AdminAssetList,
  AdminAssetListItem,
  AdminAssetStorageProvider,
  AdminModerationCase,
  AdminModerationList,
} from "./assets";
export type {
  AdminBillingConfigStatus,
  AdminBillingOrder,
  AdminBillingOverview,
  AdminBillingPrice,
  AdminBillingProduct,
  AdminBillingSubscription,
  AdminBillingWebhookEvent,
} from "./billing";
export type { AdminBreakdownItem, AdminMetric } from "./shared";

export type AdminOverview = {
  metrics: AdminMetric[];
  periodHealth: {
    total: number;
    completed: number;
    failed: number;
    failureRate: number;
    creditsSpent: number;
    creditsRefunded: number;
    newUsers: number;
  };
  taskHealth: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
  };
  generationHealth: {
    total: number;
    today: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    failureRate: number;
  };
  pendingApprovals: number;
  dailyStats: Array<{
    date: string;
    tasks: number;
    completed: number;
    failed: number;
    creditsSpent: number;
    creditsRefunded: number;
    newUsers: number;
  }>;
  creditHealth: {
    sampledBalance: number;
    sampledConsumed: number;
    recentSpend: number;
    recentRefund: number;
  };
  moduleStats: AdminBreakdownItem[];
  modelStats: AdminBreakdownItem[];
  recentTasks: AdminTaskListItem[];
  warnings: string[];
};

export type AdminUserListItem = {
  id: string;
  email: string;
  displayName: string | null;
  credits: number;
  totalCreditsUsed: number;
  accountStatus: AdminUserAccountStatus;
  generateEnabled: boolean;
  supportLevel: AdminUserSupportLevel;
  controlReason: string | null;
  controlNote: string | null;
  controlExpiresAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  generationCount: number;
  latestGenerationAt: string | null;
};

export type AdminUserAccountStatus = "active" | "restricted" | "suspended";

export type AdminUserSupportLevel = "standard" | "priority" | "watch";

export type AdminUserControl = {
  userId: string;
  status: AdminUserAccountStatus;
  generateEnabled: boolean;
  supportLevel: AdminUserSupportLevel;
  reason: string | null;
  note: string | null;
  expiresAt: string | null;
  updatedByEmail: string | null;
  updatedAt: string | null;
};

export type AdminUserList = {
  rows: AdminUserListItem[];
  total: number;
  warnings: string[];
};

type AdminPeriodAggregate = {
  total: number;
  completed: number;
  failed: number;
  creditsSpent: number;
  creditsRefunded: number;
  newUsers: number;
};

type AdminBillingSummary = {
  activeProducts: number;
  activePrices: number;
  paidOrders: number;
  netRevenue: number;
  activeSubscriptions: number;
  webhookIssues: number;
};

export type AdminTaskListItem = {
  id: string;
  sourceId: string;
  sourceType: "generation";
  userId: string;
  module: string;
  moduleLabel: string;
  title: string;
  status: string;
  statusGroup: TaskStatusGroup;
  progress: number;
  expectedCount: number;
  resultCount: number;
  inputThumbnails: string[];
  resultThumbnails: string[];
  errorMessage: string | null;
  applyUrl: string;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  model?: string | null;
  imageSize?: string | null;
  credits?: number | null;
  queueReason?: string | null;
  nextAttemptAt?: string | null;
  capacityDeferCount?: number;
  deliveryVersion?: number;
  isStale: boolean;
  staleMinutes: number;
};

export type AdminTaskList = {
  rows: AdminTaskListItem[];
  total: number;
  source: "task_queue_items" | "fallback";
  warnings: string[];
};

export type AdminAuditLog = {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
};

export type AdminAuditList = {
  rows: AdminAuditLog[];
  available: boolean;
  warnings: string[];
};

export type AdminProviderCatalog = {
  defaultModel: LingyaModel;
  providerPublish: {
    llm: boolean;
    model: boolean;
    video: boolean;
  };
  modelProviders: Array<{
    model: LingyaModel;
    enabled: boolean;
    baseUrl: string;
    upstreamModel: string;
    apiKeyConfigured: boolean;
    source: "admin" | "env";
    costs: Record<ImageSize, number>;
    notes: string;
  }>;
  modules: Array<{
    key: string;
    label: string;
    route: string;
    adminHref: string;
    risk: "low" | "medium" | "high";
  }>;
};

export type AdminCreditLogItem = {
  id: string;
  userId: string;
  email: string | null;
  amount: number;
  balance: number;
  reason: string;
  generationId: string | null;
  createdAt: string | null;
};

export type AdminCreditList = {
  rows: AdminCreditLogItem[];
  total: number;
  metrics: {
    debits: number;
    credits: number;
    net: number;
    affectedUsers: number;
  };
  warnings: string[];
};

export type AdminOperationRequest = {
  id: string;
  requestType: string;
  status: string;
  requestedBy: string | null;
  requestedByEmail: string | null;
  requestedByRole: string | null;
  approvedBy: string | null;
  approvedByEmail: string | null;
  approvedByRole: string | null;
  targetType: string;
  targetId: string;
  reason: string;
  riskLevel: "low" | "medium" | "high";
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
  approvedAt: string | null;
};

export type AdminOperationRequestList = {
  rows: AdminOperationRequest[];
  available: boolean;
  warnings: string[];
};

export type AdminMemberListItem = {
  userId: string;
  email: string | null;
  role: string;
  status: string;
  enabled: boolean;
  displayName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AdminMemberList = {
  rows: AdminMemberListItem[];
  available: boolean;
  warnings: string[];
};

export type AdminConfigVersion = {
  id: string;
  configKey: string;
  status: string;
  value: Record<string, unknown>;
  createdBy: string | null;
  publishedAt: string | null;
  createdAt: string | null;
};

export type AdminSettingsOverview = {
  configVersions: AdminConfigVersion[];
  available: boolean;
  runtime: Array<{
    key: string;
    label: string;
    configured: boolean;
    scope: string;
  }>;
  warnings: string[];
};

export type AdminPromptExperimentStatus = "draft" | "running" | "paused" | "completed";

export type AdminPromptExperimentVariant = {
  key: string;
  label: string;
  weight: number;
  template: string;
  notes: string | null;
};

export type AdminPromptExperiment = {
  id: string;
  name: string;
  module: string;
  moduleLabel: string;
  status: AdminPromptExperimentStatus;
  traffic: number;
  primaryMetric: string;
  guardrails: string[];
  variants: AdminPromptExperimentVariant[];
  owner: string | null;
  notes: string | null;
  startedAt: string | null;
  endedAt: string | null;
  versionId: string;
  versionStatus: string;
  versionCreatedAt: string | null;
  versionPublishedAt: string | null;
};

export type AdminPromptExperimentOverview = {
  available: boolean;
  configKey: "prompt.experiments";
  activeVersion: AdminConfigVersion | null;
  draftVersions: AdminConfigVersion[];
  archivedVersions: AdminConfigVersion[];
  experiments: AdminPromptExperiment[];
  metrics: {
    total: number;
    running: number;
    draft: number;
    paused: number;
    completed: number;
    coveredModules: number;
    variants: number;
    averageTraffic: number;
  };
  warnings: string[];
  exampleValue: Record<string, unknown>;
};

export type AdminUserDetail = {
  profile: AdminUserListItem | null;
  creditLogs: AdminCreditLogItem[];
  tasks: AdminTaskListItem[];
  assets: AdminAssetListItem[];
  warnings: string[];
};

export type AdminTaskDetail = {
  id: string;
  sourceType: "generation";
  task: AdminTaskListItem | null;
  userEmail: string | null;
  payload: Record<string, unknown>;
  response: Record<string, unknown>;
  resultUrls: string[];
  errorMessage: string | null;
  queueItem: AdminTaskListItem | null;
  creditLogs: AdminCreditLogItem[];
  auditLogs: AdminAuditLog[];
  warnings: string[];
};

export type AdminWorkerProcessor = {
  key: "generations";
  label: string;
  endpoint: string;
  configured: boolean;
  batchSize: number;
  secretNames: string[];
  statusHint: string;
};

export type AdminWorkerOverview = {
  runtime: {
    desired: WorkerRuntimeConfig;
    actual: {
      onlineInstances: number;
      workerConcurrency: number;
      imageBatchConcurrency: number;
      relayConcurrency: number;
      activeCapacity: number;
      mode: string;
      drift: boolean;
      driftReasons: string[];
    };
    bullmq: {
      configured: boolean;
      reachable: boolean;
      latencyMs: number | null;
      workers: number;
      paused: boolean | null;
      counts: Record<string, number>;
      error: string | null;
    };
    outbox: Record<string, number>;
    alerts: WorkerRuntimeAlertStatus;
    instances: WorkerHeartbeat[];
    configVersion: { id: string; publishedAt: string | null } | null;
  };
  processors: AdminWorkerProcessor[];
  queue: {
    sampled: number;
    source: "bullmq" | "task_queue_sample";
    queued: number;
    running: number;
    completed: number;
    failed: number;
    stale: number;
    staleMinutes: number;
  };
  staleTasks: AdminTaskListItem[];
  recentRuns: AdminAuditLog[];
  warnings: string[];
};

type CountQuery = PromiseLike<unknown>;
type SupabaseQuery = PromiseLike<unknown>;

const QUERY_TIMEOUT_MS = 15_000;
const SHORT_QUERY_TIMEOUT_MS = 8_000;
const PROFILE_COLUMNS = "id,email,display_name,credits,total_credits_used,created_at,updated_at";
const PROFILE_COLUMNS_FALLBACK = "id,email,display_name,credits,created_at,updated_at";
const ADMIN_STALE_TASK_MINUTES = 20;
const ADMIN_USER_CONTROL_COLUMNS = [
  "user_id",
  "status",
  "generate_enabled",
  "support_level",
  "reason",
  "note",
  "expires_at",
  "updated_by_email",
  "updated_at",
].join(",");
const TASK_QUEUE_COLUMNS = [
  "id",
  "user_id",
  "source_type",
  "source_id",
  "module",
  "title",
  "status",
  "status_group",
  "progress",
  "expected_count",
  "result_count",
  "input_thumbnails",
  "result_thumbnails",
  "error_message",
  "apply_url",
  "created_at",
  "updated_at",
  "completed_at",
].join(",");
const ADMIN_TASK_PREVIEW_LIMIT = 4;
const GENERATION_COLUMNS = [
  "id",
  "user_id",
  "status",
  "error_message",
  "result_urls",
  "created_at",
  "updated_at",
  "completed_at",
  "processing_started_at",
  "job_payload",
  "clothing_urls",
  "model_face_url",
  "reference_url",
  "credits_used",
  "credits_cost",
  "ai_model",
  "image_size",
  "queue_reason",
  "available_at",
  "capacity_defer_count",
  "delivery_version",
].join(",");
const CREDIT_LOG_COLUMNS = "id,user_id,amount,balance,reason,generation_id,created_at";
const ADMIN_MEMBER_COLUMNS = "user_id,email,role,status,enabled,display_name,created_at,updated_at";
const ADMIN_CONFIG_COLUMNS = "id,config_key,value,status,created_by,published_at,created_at";
const MODERATION_CASE_COLUMNS = "id,source_type,source_id,action,status,reason,metadata,created_by,created_at,resolved_at";
const OPERATION_REQUEST_COLUMNS = [
  "id",
  "request_type",
  "status",
  "requested_by",
  "requested_by_email",
  "requested_by_role",
  "approved_by",
  "approved_by_email",
  "approved_by_role",
  "target_type",
  "target_id",
  "reason",
  "risk_level",
  "payload",
  "result",
  "created_at",
  "updated_at",
  "approved_at",
].join(",");
export const PROMPT_EXPERIMENT_CONFIG_KEY = "prompt.experiments" as const;
export const DEFAULT_PROMPT_EXPERIMENT_CONFIG = {
  schemaVersion: 1,
  assignment: {
    stickyKey: "user_id",
    method: "hash_bucket",
  },
  experiments: [
    {
      id: "pose-prompt-v2",
      name: "姿势裂变 Prompt V2",
      module: "pose",
      status: "draft",
      traffic: 10,
      primaryMetric: "success_rate",
      guardrails: ["agent_eval_score >= 90", "failed_case_count = 0", "refund_rate <= control"],
      variants: [
        {
          key: "control",
          label: "线上模板",
          weight: 50,
          template: "保持当前生产提示词，不改变人物身份、服装结构和画幅。",
          notes: "对照组",
        },
        {
          key: "variant-a",
          label: "姿势多样性增强",
          weight: 50,
          template: "在保持人物身份、服装结构和画幅不变的前提下，生成更明显区分的自然站姿、半身转体和轻微动态姿势。",
          notes: "实验组",
        },
      ],
      owner: "ops",
      notes: "发布前需要先通过回归评测。",
      startedAt: null,
      endedAt: null,
    },
  ],
};

// 运营总览进程内缓存：后台数据所有管理员共享同一份，30 秒窗口内直接命中，
// 避免每个页面访问都触发 15+ 条数据库查询（多实例部署时各实例独立缓存，可接受）。
const ADMIN_OVERVIEW_CACHE_TTL_MS = 60_000;
const adminOverviewCache = new Map<number, { expiresAt: number; value: AdminOverview }>();

export async function getAdminOverview(args: { days?: number } = {}): Promise<AdminOverview> {
  const cacheDays = clampLimit(args.days, 1, 90, 7);
  const cached = adminOverviewCache.get(cacheDays);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await fetchAdminOverview({ days: cacheDays });
  adminOverviewCache.set(cacheDays, { expiresAt: Date.now() + ADMIN_OVERVIEW_CACHE_TTL_MS, value });
  return value;
}

async function fetchAdminOverview(args: { days?: number } = {}): Promise<AdminOverview> {
  const admin = getAdminClient();
  const warnings: string[] = [];
  const now = Date.now();
  const todayIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  // The dashboard's operating KPIs are all scoped to this selected window.
  // Current queue health remains un-windowed because operators need the live
  // backlog regardless of the chart range.
  const days = clampLimit(args.days, 1, 90, 7);
  const windowStart = new Date(now - days * 24 * 60 * 60 * 1000);
  windowStart.setUTCHours(0, 0, 0, 0);
  const windowStartIso = windowStart.toISOString();
  // Some signals (task queue health) remain un-windowed counts — operators
  // need to see today's backlog regardless of the chart window.

  const [
    totalUsers,
    newUsers,
    periodNewUsers,
    generationTotal,
    generationToday,
    generationPeriodTotal,
    generationPeriodCompleted,
    generationPeriodFailed,
    generationQueued,
    generationRunning,
    generationCompleted,
    generationFailed,
    taskQueued,
    taskRunning,
    taskCompleted,
    taskFailed,
    creditHealth,
    periodAggregate,
    recentGenerationRows,
    recentTasks,
    dailyStats,
    pendingApprovals,
  ] = await Promise.all([
    countRows(admin.from("profiles").select("id", { count: "planned", head: true }), "profiles total", warnings),
    countRows(admin.from("profiles").select("id", { count: "planned", head: true }).gte("created_at", todayIso), "profiles today", warnings),
    countRows(admin.from("profiles").select("id", { count: "planned", head: true }).gte("created_at", windowStartIso), "profiles period", warnings),
    countRows(admin.from("generations").select("id", { count: "planned", head: true }), "generations total", warnings),
    countRows(admin.from("generations").select("id", { count: "planned", head: true }).gte("created_at", todayIso), "generations today", warnings),
    countRows(admin.from("generations").select("id", { count: "planned", head: true }).gte("created_at", windowStartIso), "generations period", warnings),
    countRows(admin.from("generations").select("id", { count: "planned", head: true }).gte("created_at", windowStartIso).eq("status", "completed"), "generations period completed", warnings),
    countRows(admin.from("generations").select("id", { count: "planned", head: true }).gte("created_at", windowStartIso).eq("status", "failed"), "generations period failed", warnings),
    countRows(admin.from("generations").select("id", { count: "planned", head: true }).eq("status", "queued"), "generations queued", warnings),
    countRows(admin.from("generations").select("id", { count: "planned", head: true }).in("status", ["processing_tryon", "processing_face_swap", "running", "generating"]), "generations running", warnings),
    countRows(admin.from("generations").select("id", { count: "planned", head: true }).eq("status", "completed"), "generations completed", warnings),
    countRows(admin.from("generations").select("id", { count: "planned", head: true }).eq("status", "failed"), "generations failed", warnings),
    countOptionalRows(admin.from("task_queue_items").select("id", { count: "planned", head: true }).eq("status_group", "queued"), "task queue queued", warnings),
    countOptionalRows(admin.from("task_queue_items").select("id", { count: "planned", head: true }).eq("status_group", "running"), "task queue running", warnings),
    countOptionalRows(admin.from("task_queue_items").select("id", { count: "planned", head: true }).eq("status_group", "completed"), "task queue completed", warnings),
    countOptionalRows(admin.from("task_queue_items").select("id", { count: "planned", head: true }).eq("status_group", "failed"), "task queue failed", warnings),
    loadCreditHealth(windowStartIso, warnings),
    loadAdminPeriodAggregate(windowStartIso, warnings),
    loadRecentGenerationRows(warnings, { sinceIso: windowStartIso }),
    listAdminTasks({ limit: 8, diversifyBy: "module", estimatedCount: true }),
    loadDailyStats(days, warnings),
    countPendingOperationRequests().catch(() => 0),
  ]);

  const aggregate = aggregateGenerations(recentGenerationRows);
  // Phase 0 fallback: if generations aggregation returned fewer than 2 distinct
  // modules (likely RLS / parsing miss), source moduleStats from task_queue_items
  // which has a direct `module` column.
  let moduleStats = aggregate.moduleStats;
  let modelStats = aggregate.modelStats;
  if (moduleStats.length < 2) {
    const fallback = await loadTaskQueueModuleStats(warnings, { sinceIso: windowStartIso });
    if (fallback && fallback.moduleStats.length) {
      moduleStats = fallback.moduleStats;
      if (!modelStats.length && fallback.modelStats.length) {
        modelStats = fallback.modelStats;
      }
    }
  }
  // If the user picked a short window (1d / 7d) and both sources are sparse,
  // widen to 30 days as a last-ditch effort so the TopList surfaces *some*
  // data. We always prefer the windowed result when it has any rows.
  if (moduleStats.length === 0 && days <= 7) {
    const wideSinceIso = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    const wideFallback = await loadTaskQueueModuleStats(warnings, { sinceIso: wideSinceIso });
    if (wideFallback && wideFallback.moduleStats.length) {
      moduleStats = wideFallback.moduleStats;
    }
  }
  // The queue projection is the canonical task view. Fall back as a complete
  // set only when the optional projection cannot be queried; mixing individual
  // statuses from two sources produces an internally inconsistent dashboard.
  const taskQueueCounts = [taskQueued, taskRunning, taskCompleted, taskFailed];
  const taskHealth = taskQueueCounts.every((value) => value !== null)
    ? {
        queued: taskQueued as number,
        running: taskRunning as number,
        completed: taskCompleted as number,
        failed: taskFailed as number,
      }
    : {
        queued: generationQueued,
        running: generationRunning,
        completed: generationCompleted,
        failed: generationFailed,
      };
  const generationFailureRate = generationTotal > 0 ? generationFailed / generationTotal : 0;
  const period = periodAggregate || {
    total: generationPeriodTotal,
    completed: generationPeriodCompleted,
    failed: generationPeriodFailed,
    creditsSpent: creditHealth.recentSpend,
    creditsRefunded: creditHealth.recentRefund,
    newUsers: periodNewUsers,
  } satisfies AdminPeriodAggregate;
  const periodSettled = period.completed + period.failed;
  const periodFailureRate = periodSettled > 0 ? period.failed / periodSettled : 0;

  return {
    pendingApprovals,
    dailyStats,
    periodHealth: {
      total: period.total,
      completed: period.completed,
      failed: period.failed,
      failureRate: periodFailureRate,
      creditsSpent: period.creditsSpent,
      creditsRefunded: period.creditsRefunded,
      newUsers: period.newUsers,
    },
    metrics: [
      { label: "用户总数", value: totalUsers, hint: `24h 新增 ${newUsers}`, tone: "neutral" },
      { label: "周期生成", value: period.total, hint: `今日 ${generationToday}`, tone: "good" },
      { label: "运行中任务", value: taskHealth.queued + taskHealth.running, hint: `${taskHealth.failed} 个失败需排查`, tone: taskHealth.failed > 0 ? "warning" : "neutral" },
      { label: "失败率", value: Math.round(periodFailureRate * 1000) / 10, hint: `近 ${days} 天`, tone: periodFailureRate > 0.08 ? "danger" : periodFailureRate > 0.03 ? "warning" : "good" },
      { label: "样本灵点余额", value: creditHealth.sampledBalance, hint: `近 ${days} 天消耗 ${creditHealth.recentSpend}`, tone: "neutral" },
    ],
    taskHealth,
    generationHealth: {
      total: generationTotal,
      today: generationToday,
      queued: generationQueued,
      running: generationRunning,
      completed: generationCompleted,
      failed: generationFailed,
      failureRate: generationFailureRate,
    },
    creditHealth,
    moduleStats,
    modelStats,
    recentTasks: recentTasks.rows,
    warnings: uniqueStrings([...warnings, ...recentTasks.warnings]),
  };
}

export async function listAdminUsers(args: { q?: string; page?: number; pageSize?: number; limit?: number } = {}): Promise<AdminUserList> {
  const admin = getAdminClient();
  const warnings: string[] = [];
  const page = clampLimit(args.page, 1, 10_000, 1);
  const pageSize = clampLimit(args.pageSize ?? args.limit, 10, 100, 30);
  const offset = (page - 1) * pageSize;
  const q = (args.q || "").trim();

  let query = admin
    .from("profiles")
    .select(PROFILE_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (q) {
    query = query.ilike("email", `%${q}%`);
  }

  let result = await runQuery<Record<string, unknown>[]>(query, "profiles list", warnings);
  if (!result.data && result.error && result.error.toLowerCase().includes("total_credits_used")) {
    let fallbackQuery = admin
      .from("profiles")
      .select(PROFILE_COLUMNS_FALLBACK, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (q) fallbackQuery = fallbackQuery.ilike("email", `%${q}%`);
    result = await runQuery<Record<string, unknown>[]>(fallbackQuery, "profiles list fallback", warnings);
  }

  const profiles = Array.isArray(result.data) ? result.data : [];
  const userIds = profiles.map((row) => stringValue(row.id)).filter(Boolean);
  const [generationStats, controls] = await Promise.all([
    loadUserGenerationStats(userIds, warnings),
    loadUserControlMap(userIds, warnings),
  ]);

  return {
    rows: profiles.map((row) => {
      const profile = mapProfileRow(row);
      const generation = generationStats.get(profile.id) || { count: 0, latestAt: null };
      return applyUserControl({
        ...profile,
        generationCount: generation.count,
        latestGenerationAt: generation.latestAt,
      }, controls.get(profile.id));
    }),
    total: result.count ?? profiles.length,
    warnings: uniqueStrings(warnings),
  };
}

function mapProfileRow(row: Record<string, unknown>): AdminUserListItem {
  return {
    id: stringValue(row.id),
    email: stringValue(row.email),
    displayName: nullableString(row.display_name),
    credits: numberValue(row.credits),
    totalCreditsUsed: numberValue(row.total_credits_used),
    accountStatus: "active",
    generateEnabled: true,
    supportLevel: "standard",
    controlReason: null,
    controlNote: null,
    controlExpiresAt: null,
    createdAt: nullableString(row.created_at),
    updatedAt: nullableString(row.updated_at),
    generationCount: 0,
    latestGenerationAt: null,
  };
}

export async function listAdminTasks(args: {
  q?: string;
  module?: string;
  status?: string;
  sourceType?: "generation" | "all";
  stale?: boolean;
  page?: number;
  pageSize?: number;
  limit?: number;
  hydratePreviews?: boolean;
  diversifyBy?: "module" | "none";
  estimatedCount?: boolean;
} = {}): Promise<AdminTaskList> {
  const admin = getAdminClient();
  const warnings: string[] = [];
  const page = clampLimit(args.page, 1, 10_000, 1);
  const pageSize = clampLimit(args.pageSize ?? args.limit, 10, 200, 40);
  const offset = (page - 1) * pageSize;
  const status = normalizeStatusFilter(args.status);
  const moduleFilter = normalizeModuleFilter(args.module);
  const sourceType = args.sourceType && args.sourceType !== "all" ? args.sourceType : "";
  const q = (args.q || "").trim().toLowerCase();
  const needsClientFilter = Boolean(q || args.stale);
  const clientFilterLimit = Math.min(1000, Math.max(page * pageSize * (q ? 3 : 2), pageSize));

  let query = admin
    .from("task_queue_items")
    .select(TASK_QUEUE_COLUMNS, { count: args.estimatedCount ? "planned" : "exact" })
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status_group", status);
  if (moduleFilter) query = query.eq("module", moduleFilter);
  if (sourceType) query = query.eq("source_type", sourceType);
  query = needsClientFilter ? query.limit(clientFilterLimit) : query.range(offset, offset + pageSize - 1);

  const indexed = await runQuery<Record<string, unknown>[]>(query, "task queue list", warnings, true);
  if (indexed.data) {
    let rows = indexed.data.map(mapTaskQueueRow);
    if (args.hydratePreviews !== false) {
      rows = await hydrateTaskPreviewThumbnails(rows, warnings);
    }
    if (q) rows = rows.filter((row) => matchesTaskSearch(row, q));
    if (args.stale) rows = rows.filter((row) => row.isStale);
    if (args.diversifyBy === "module") {
      rows = diversifyRowsByModule(rows, pageSize);
    }
    return {
      rows: needsClientFilter ? rows.slice(offset, offset + pageSize) : rows,
      total: needsClientFilter ? rows.length : indexed.count ?? rows.length,
      source: "task_queue_items",
      warnings: uniqueStrings(warnings),
    };
  }

  const fallback = await loadFallbackTasks({ page, pageSize, status, module: moduleFilter, sourceType, q, stale: Boolean(args.stale) }, warnings);
  return {
    rows: fallback.rows,
    total: fallback.total,
    source: "fallback",
    warnings: uniqueStrings(warnings),
  };
}

export async function listAdminAuditLogs(args: {
  limit?: number;
  action?: string;
  q?: string;
  since?: string;
} = {}): Promise<AdminAuditList> {
  const warnings: string[] = [];
  const limit = clampLimit(args.limit, 10, 100, 50);
  let query = getAdminClient()
    .from("admin_audit_logs")
    .select("id,actor_user_id,actor_email,actor_role,action,resource_type,resource_id,reason,metadata,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (args.action && typeof args.action === "string") {
    query = query.eq("action", args.action);
  }
  if (args.q && typeof args.q === "string") {
    query = query.ilike("actor_email", `%${args.q.trim()}%`);
  }
  if (args.since && typeof args.since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.since)) {
    query = query.gte("created_at", `${args.since}T00:00:00.000Z`);
  }

  const result = await runQuery<Record<string, unknown>[]>(
    query,
    "admin audit logs",
    warnings,
    true,
  );

  if (!result.data) {
    return { rows: [], available: false, warnings: uniqueStrings(warnings) };
  }

  return {
    rows: result.data.map(mapAuditRow),
    available: true,
    warnings: uniqueStrings(warnings),
  };
}

export async function listAdminCreditLogs(args: { q?: string; limit?: number; since?: string } = {}): Promise<AdminCreditList> {
  const warnings: string[] = [];
  const limit = clampLimit(args.limit, 10, 200, 80);
  const q = (args.q || "").trim().toLowerCase();
  let query = getAdminClient()
    .from("credit_logs")
    .select(CREDIT_LOG_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(q ? Math.min(limit * 4, 300) : limit);
  if (args.since && /^\d{4}-\d{2}-\d{2}$/.test(args.since)) {
    query = query.gte("created_at", `${args.since}T00:00:00.000Z`);
  }
  const result = await runQuery<Record<string, unknown>[]>(
    query,
    "credit logs",
    warnings,
    true,
  );

  const rows = result.data || [];
  const profileEmails = await loadProfileEmails(rows.map((row) => stringValue(row.user_id)), warnings);
  let mapped = rows.map((row) => {
    const userId = stringValue(row.user_id);
    return {
      id: stringValue(row.id),
      userId,
      email: profileEmails.get(userId) || null,
      amount: numberValue(row.amount),
      balance: numberValue(row.balance),
      reason: stringValue(row.reason),
      generationId: nullableString(row.generation_id),
      createdAt: nullableString(row.created_at),
    };
  });

  if (q) {
    mapped = mapped.filter((row) => [
      row.id,
      row.userId,
      row.email || "",
      row.reason,
      row.generationId || "",
    ].some((value) => value.toLowerCase().includes(q)));
  }

  const visible = mapped.slice(0, limit);
  const debits = visible.filter((row) => row.amount < 0).reduce((sum, row) => sum + Math.abs(row.amount), 0);
  const credits = visible.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0);
  return {
    rows: visible,
    total: result.count ?? mapped.length,
    metrics: {
      debits,
      credits,
      net: credits - debits,
      affectedUsers: new Set(visible.map((row) => row.userId).filter(Boolean)).size,
    },
    warnings: uniqueStrings(warnings),
  };
}

export async function listAdminBillingOverview(): Promise<AdminBillingOverview> {
  const warnings: string[] = [];
  const admin = getAdminClient();

  const [
    productsResult,
    pricesResult,
    ordersResult,
    subscriptionsResult,
    webhookEventsResult,
  ] = await Promise.all([
    runQuery<Record<string, unknown>[]>(
      admin.from(BILLING_PRODUCTS_TABLE).select("*", { count: "exact" }).limit(100),
      "billing products",
      warnings,
      true,
    ),
    runQuery<Record<string, unknown>[]>(
      admin.from(BILLING_PRICES_TABLE).select("*", { count: "exact" }).limit(120),
      "billing prices",
      warnings,
      true,
    ),
    runQuery<Record<string, unknown>[]>(
      admin.from(BILLING_ORDERS_TABLE).select("*", { count: "exact" }).limit(120),
      "billing orders",
      warnings,
      true,
    ),
    runQuery<Record<string, unknown>[]>(
      admin.from(BILLING_SUBSCRIPTIONS_TABLE).select("*", { count: "exact" }).limit(120),
      "billing subscriptions",
      warnings,
      true,
    ),
    runQuery<Record<string, unknown>[]>(
      admin.from(BILLING_WEBHOOK_EVENTS_TABLE).select("*", { count: "exact" }).limit(120),
      "billing webhook events",
      warnings,
      true,
    ),
  ]);

  const products = (productsResult.data || [])
    .map(mapBillingProduct)
    .sort((a, b) => compareDateDesc(a.updatedAt || a.createdAt, b.updatedAt || b.createdAt));
  const productNames = new Map(products.map((product) => [product.stripeProductId, product.name]));
  const prices = (pricesResult.data || [])
    .map((row) => mapBillingPrice(row, productNames))
    .sort((a, b) => compareDateDesc(a.createdAt, b.createdAt));

  const orderEmails = await loadProfileEmails(
    (ordersResult.data || []).map((row) => pickString(row, ["user_id", "userId"])),
    warnings,
  );
  const subscriptionEmails = await loadProfileEmails(
    (subscriptionsResult.data || []).map((row) => pickString(row, ["user_id", "userId"])),
    warnings,
  );
  const orders = (ordersResult.data || [])
    .map((row) => mapBillingOrder(row, orderEmails))
    .sort((a, b) => compareDateDesc(a.createdAt, b.createdAt));
  const subscriptions = (subscriptionsResult.data || [])
    .map((row) => mapBillingSubscription(row, subscriptionEmails))
    .sort((a, b) => compareDateDesc(a.updatedAt || a.createdAt, b.updatedAt || b.createdAt));
  const webhookEvents = (webhookEventsResult.data || [])
    .map(mapBillingWebhookEvent)
    .sort((a, b) => compareDateDesc(a.createdAt, b.createdAt));
  const billingSummary = await loadAdminBillingSummary(warnings);

  const tableStatuses = [
    billingTableStatus(BILLING_PRODUCTS_TABLE, "Products table", productsResult),
    billingTableStatus(BILLING_PRICES_TABLE, "Prices table", pricesResult),
    billingTableStatus(BILLING_ORDERS_TABLE, "Orders table", ordersResult),
    billingTableStatus(BILLING_SUBSCRIPTIONS_TABLE, "Subscriptions table", subscriptionsResult),
    billingTableStatus(BILLING_WEBHOOK_EVENTS_TABLE, "Webhook events table", webhookEventsResult),
  ];
  const configStatus = [
    billingEnvStatus("STRIPE_SECRET_KEY", "Stripe secret key", process.env.STRIPE_SECRET_KEY),
    billingEnvStatus(
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      "Stripe publishable key",
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLISHABLE_KEY,
    ),
    billingEnvStatus("STRIPE_WEBHOOK_SECRET", "Stripe webhook secret", process.env.STRIPE_WEBHOOK_SECRET),
    ...tableStatuses,
  ];
  const available = tableStatuses.some((item) => item.configured);
  const missingConfigCount = configStatus.filter((item) => !item.configured).length;
  const activeSubscriptions = subscriptions.filter((row) => row.status === "active" || row.status === "trialing").length;
  const failedWebhookEvents = webhookEvents.filter((row) => {
    const status = row.status.toLowerCase();
    return status === "failed" || status === "error" || status === "retrying";
  }).length;
  const sampleRevenue = orders
    .filter((row) => ["paid", "succeeded", "complete", "completed"].includes(row.status.toLowerCase()))
    .reduce((sum, row) => sum + Math.max(0, row.amountTotal - row.refundedAmount), 0);
  const summaryHint = billingSummary ? "PostgreSQL 全量汇总" : "最近加载样本";

  return {
    available,
    summarySource: billingSummary ? "rpc" : "sample",
    metrics: [
      { label: "启用商品", value: billingSummary?.activeProducts ?? products.filter((row) => row.active).length, hint: summaryHint, tone: "neutral" },
      { label: "启用价格", value: billingSummary?.activePrices ?? prices.filter((row) => row.active).length, hint: summaryHint, tone: "neutral" },
      { label: "净收入", value: toMajorCurrency(billingSummary?.netRevenue ?? sampleRevenue), hint: `${summaryHint} · 已支付订单减退款`, tone: (billingSummary?.netRevenue ?? sampleRevenue) > 0 ? "good" : "neutral" },
      { label: "活跃订阅", value: billingSummary?.activeSubscriptions ?? activeSubscriptions, hint: summaryHint, tone: (billingSummary?.activeSubscriptions ?? activeSubscriptions) > 0 ? "good" : "neutral" },
      { label: "Webhook 异常", value: billingSummary?.webhookIssues ?? failedWebhookEvents, hint: summaryHint, tone: (billingSummary?.webhookIssues ?? failedWebhookEvents) > 0 ? "warning" : "good" },
      { label: "缺失配置", value: missingConfigCount, hint: "环境变量和 Billing 表", tone: missingConfigCount > 0 ? "warning" : "good" },
    ],
    products,
    prices,
    orders,
    subscriptions,
    webhookEvents,
    configStatus,
    warnings: uniqueStrings(warnings),
  };
}

export async function listAdminAssets(args: { q?: string; module?: string; limit?: number } = {}): Promise<AdminAssetList> {
  const warnings: string[] = [];
  const limit = clampLimit(args.limit, 12, 120, 60);
  const q = (args.q || "").trim().toLowerCase();
  const moduleFilter = normalizeModuleFilter(args.module);

  let generationQuery = getAdminClient()
    .from("generations")
    .select(GENERATION_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(q || moduleFilter ? Math.min(limit * 4, 300) : limit);
  if (moduleFilter) generationQuery = generationQuery.eq("job_payload->>kind", moduleFilter);

  const [generationResult, referenceAssets, favoritePlanAssets] = await Promise.all([
    runQuery<Record<string, unknown>[]>(
      generationQuery,
      "asset generations",
      warnings,
      true,
    ),
    moduleFilter ? Promise.resolve([]) : loadReferenceAssets(Math.min(20, limit), warnings),
    moduleFilter ? Promise.resolve([]) : loadFavoritePlanAssets(Math.min(20, limit), warnings),
  ]);

  let rows = (generationResult.data || [])
    .map(mapGenerationAssetRow)
    .filter((row) => row.urls.length > 0 || row.inputUrls.length > 0);

  if (!moduleFilter) {
    rows.push(...referenceAssets);
    rows.push(...favoritePlanAssets);
  }

  if (q) rows = rows.filter((row) => matchesAssetSearch(row, q));
  rows = rows.sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
  const visibleRows = rows.slice(0, limit);
  const moderationMap = await loadLatestModerationForAssets(visibleRows, warnings);

  return {
    rows: visibleRows.map((row) => ({
      ...row,
      moderationCase: moderationMap.get(assetModerationKey(row.sourceType, row.id)) || null,
    })),
    total: generationResult.count ?? rows.length,
    warnings: uniqueStrings(warnings),
  };
}

export async function getAdminAssetLifecycleOverview(args: {
  q?: string;
  module?: string;
  limit?: number;
} = {}): Promise<AdminAssetLifecycleOverview> {
  const limit = clampLimit(args.limit, 20, 160, 100);
  const assets = await listAdminAssets({ q: args.q, module: args.module, limit });
  const rows = assets.rows.map(mapAssetLifecycleItem);

  return {
    generatedAt: new Date().toISOString(),
    rows,
    policies: ASSET_LIFECYCLE_POLICIES,
    metrics: rows.reduce((metrics, row) => {
      metrics.sampledAssets += 1;
      metrics.sampledUrls += row.urlCount + row.inputCount;
      if (row.providers.includes("aliyun-oss")) metrics.ossUrls += countProviderUrls(row, "aliyun-oss");
      if (row.providers.includes("imgbb")) metrics.imgbbUrls += countProviderUrls(row, "imgbb");
      if (row.providers.includes("external")) metrics.externalUrls += countProviderUrls(row, "external");
      if (row.providers.includes("data-url")) metrics.dataUrls += countProviderUrls(row, "data-url");
      if (row.providers.includes("unknown")) metrics.unknownUrls += countProviderUrls(row, "unknown");
      if (row.stage === "migrate") metrics.migrationCandidates += 1;
      if (row.stage === "archive") metrics.archiveCandidates += 1;
      if (row.stage === "protected") metrics.protectedAssets += 1;
      if (row.stage === "review") metrics.reviewCandidates += 1;
      if (row.moderationAction === "hide") metrics.hiddenAssets += 1;
      return metrics;
    }, createAssetLifecycleMetrics()),
    warnings: assets.warnings,
  };
}

export async function listAdminModerationCases(args: { q?: string; limit?: number } = {}): Promise<AdminModerationList> {
  const warnings: string[] = [];
  const limit = clampLimit(args.limit, 10, 120, 60);
  const q = (args.q || "").trim().toLowerCase();
  const result = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("moderation_cases")
      .select(MODERATION_CASE_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(q ? Math.min(limit * 4, 300) : limit),
    "moderation cases",
    warnings,
    true,
  );

  if (!result.data) {
    return { rows: [], available: false, warnings: uniqueStrings(warnings) };
  }

  let rows = result.data.map(mapModerationCase);
  if (q) rows = rows.filter((row) => matchesModerationSearch(row, q));

  return {
    rows: rows.slice(0, limit),
    available: true,
    warnings: uniqueStrings(warnings),
  };
}

export async function countPendingOperationRequests(): Promise<number> {
  const result = await runQuery<{ count?: number | null } | null>(
    getAdminClient()
      .from("admin_operation_requests")
      .select("id", { count: "planned", head: true })
      .eq("status", "pending"),
    "pending operation requests count",
    [],
    true,
  );
  return Number(result.data?.count || 0);
}

export async function listAdminOperationRequests(args: {
  q?: string;
  status?: string;
  limit?: number;
} = {}): Promise<AdminOperationRequestList> {
  const warnings: string[] = [];
  const limit = clampLimit(args.limit, 10, 120, 60);
  const q = (args.q || "").trim().toLowerCase();
  const status = normalizeOperationRequestStatus(args.status);
  let query = getAdminClient()
    .from("admin_operation_requests")
    .select(OPERATION_REQUEST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(q ? Math.min(limit * 4, 300) : limit);
  if (status) query = query.eq("status", status);

  const result = await runQuery<Record<string, unknown>[]>(
    query,
    "operation requests",
    warnings,
    true,
  );

  if (!result.data) {
    return { rows: [], available: false, warnings: uniqueStrings(warnings) };
  }

  let rows = result.data.map(mapOperationRequest);
  if (q) rows = rows.filter((row) => matchesOperationRequestSearch(row, q));
  // 未指定状态时待审批置顶，避免被最新已处理的单子淹没
  if (!status) {
    rows = rows.sort((a, b) => {
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (b.status === "pending" && a.status !== "pending") return 1;
      return Date.parse(b.createdAt || "") - Date.parse(a.createdAt || "");
    });
  }

  return {
    rows: rows.slice(0, limit),
    available: true,
    warnings: uniqueStrings(warnings),
  };
}

export async function listAdminMembers(args: { limit?: number; q?: string } = {}): Promise<AdminMemberList> {
  const warnings: string[] = [];
  const limit = clampLimit(args.limit, 10, 500, 50);
  const q = (args.q || "").trim().toLowerCase();
  let query = getAdminClient()
    .from("admin_members")
    .select(ADMIN_MEMBER_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (q) query = query.ilike("email", `%${q}%`);
  const result = await runQuery<Record<string, unknown>[]>(
    query,
    "admin members",
    warnings,
    true,
  );

  if (!result.data) {
    return { rows: [], available: false, warnings: uniqueStrings(warnings) };
  }

  return {
    rows: result.data.map((row) => ({
      userId: stringValue(row.user_id),
      email: nullableString(row.email),
      role: stringValue(row.role) || "viewer",
      status: stringValue(row.status) || (row.enabled === false ? "disabled" : "active"),
      enabled: row.enabled !== false,
      displayName: nullableString(row.display_name),
      createdAt: nullableString(row.created_at),
      updatedAt: nullableString(row.updated_at),
    })),
    available: true,
    warnings: uniqueStrings(warnings),
  };
}

export async function getAdminSettingsOverview(): Promise<AdminSettingsOverview> {
  const warnings: string[] = [];
  const result = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("admin_config_versions")
      .select(ADMIN_CONFIG_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(50),
    "admin config versions",
    warnings,
    true,
  );

  return {
    configVersions: (result.data || []).map((row) => ({
      id: stringValue(row.id),
      configKey: stringValue(row.config_key),
      status: stringValue(row.status) || "draft",
      value: isRecord(row.value) ? row.value : {},
      createdBy: nullableString(row.created_by),
      publishedAt: nullableString(row.published_at),
      createdAt: nullableString(row.created_at),
    })),
    available: Boolean(result.data),
    runtime: getRuntimeSettingHealth(),
    warnings: uniqueStrings(warnings),
  };
}

export async function getAdminPromptExperimentOverview(): Promise<AdminPromptExperimentOverview> {
  const warnings: string[] = [];
  const result = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("admin_config_versions")
      .select(ADMIN_CONFIG_COLUMNS)
      .eq("config_key", PROMPT_EXPERIMENT_CONFIG_KEY)
      .order("created_at", { ascending: false })
      .limit(80),
    "prompt experiment config versions",
    warnings,
    true,
  );

  if (!result.data) {
    return {
      available: false,
      configKey: PROMPT_EXPERIMENT_CONFIG_KEY,
      activeVersion: null,
      draftVersions: [],
      archivedVersions: [],
      experiments: [],
      metrics: emptyPromptExperimentMetrics(),
      warnings: uniqueStrings([
        ...warnings,
        result.error
          ? `admin_config_versions: ${result.error}`
          : "admin_config_versions table is not ready. Run supabase/admin-console.sql first.",
      ]),
      exampleValue: DEFAULT_PROMPT_EXPERIMENT_CONFIG,
    };
  }

  const versions = result.data.map(mapConfigVersion);
  const activeVersion = versions.find((item) => item.status === "published") || null;
  const sourceVersions = activeVersion ? [activeVersion] : versions.filter((item) => item.status !== "archived").slice(0, 1);
  const experiments = sourceVersions.flatMap((version) => parsePromptExperiments(version, warnings));
  const coveredModules = new Set(experiments.map((item) => item.module).filter(Boolean));
  const totalTraffic = experiments.reduce((sum, item) => sum + item.traffic, 0);

  return {
    available: true,
    configKey: PROMPT_EXPERIMENT_CONFIG_KEY,
    activeVersion,
    draftVersions: versions.filter((item) => item.status === "draft"),
    archivedVersions: versions.filter((item) => item.status === "archived"),
    experiments,
    metrics: {
      total: experiments.length,
      running: experiments.filter((item) => item.status === "running").length,
      draft: experiments.filter((item) => item.status === "draft").length,
      paused: experiments.filter((item) => item.status === "paused").length,
      completed: experiments.filter((item) => item.status === "completed").length,
      coveredModules: coveredModules.size,
      variants: experiments.reduce((sum, item) => sum + item.variants.length, 0),
      averageTraffic: experiments.length ? Math.round(totalTraffic / experiments.length) : 0,
    },
    warnings: uniqueStrings(warnings),
    exampleValue: DEFAULT_PROMPT_EXPERIMENT_CONFIG,
  };
}

export async function getAdminUserDetail(userId: string): Promise<AdminUserDetail> {
  const warnings: string[] = [];
  const profileResult = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", userId)
      .limit(1),
    "user detail profile",
    warnings,
  );
  let profileRows = profileResult.data || [];
  if (!profileRows.length && profileResult.error?.toLowerCase().includes("total_credits_used")) {
    const fallback = await runQuery<Record<string, unknown>[]>(
      getAdminClient()
        .from("profiles")
        .select(PROFILE_COLUMNS_FALLBACK)
        .eq("id", userId)
        .limit(1),
      "user detail profile fallback",
      warnings,
      true,
    );
    profileRows = fallback.data || [];
  }

  const baseProfile = profileRows[0] ? mapProfileRow(profileRows[0]) : null;
  const [creditLogs, tasks, assets, controls] = await Promise.all([
    listAdminCreditLogs({ q: userId, limit: 30 }),
    loadUserTasks(userId, warnings),
    loadUserAssets(userId, warnings),
    loadUserControlMap([userId], warnings),
  ]);
  const profile = baseProfile ? applyUserControl(baseProfile, controls.get(userId)) : null;

  return {
    profile,
    creditLogs: creditLogs.rows,
    tasks,
    assets,
    warnings: uniqueStrings([...warnings, ...creditLogs.warnings]),
  };
}

export async function getAdminTaskDetail(id: string): Promise<AdminTaskDetail> {
  const warnings: string[] = [];
  const [queueItem, generation] = await Promise.all([
    loadQueueItemBySourceId(id, warnings),
    loadGenerationDetail(id, warnings),
  ]);

  if (generation.row) {
    const task = mapGenerationRow(generation.row);
    const [creditLogs, auditLogs, emails, routeAttempts] = await Promise.all([
      loadCreditLogsByGeneration(id, warnings),
      loadAuditLogsByResource(id, warnings),
      task.userId ? loadProfileEmails([task.userId], warnings) : Promise.resolve(new Map<string, string>()),
      loadRouteAttemptsByGeneration(id, warnings),
    ]);
    return {
      id,
      sourceType: "generation",
      task,
      userEmail: task.userId ? emails.get(task.userId) || null : null,
      payload: isRecord(generation.row.job_payload) ? generation.row.job_payload : {},
      response: buildGenerationAdminResponse(generation.row, routeAttempts),
      resultUrls: arrayOfStrings(generation.row.result_urls),
      errorMessage: nullableString(generation.row.error_message),
      queueItem,
      creditLogs,
      auditLogs,
      warnings: uniqueStrings([...warnings, ...generation.warnings]),
    };
  }

  return {
    id,
    sourceType: queueItem?.sourceType || "generation",
    task: queueItem,
    userEmail: queueItem?.userId
      ? (await loadProfileEmails([queueItem.userId], warnings)).get(queueItem.userId) || null
      : null,
    payload: {},
    response: buildQueueAdminResponse(queueItem),
    resultUrls: queueItem?.resultThumbnails || [],
    errorMessage: queueItem?.errorMessage || null,
    queueItem,
    creditLogs: [],
    auditLogs: await loadAuditLogsByResource(id, warnings),
    warnings: uniqueStrings(warnings),
  };
}

export async function getAdminWorkerOverview(): Promise<AdminWorkerOverview> {
  const warnings: string[] = [];
  const staleMinutes = clampLimit(process.env.GENERATION_JOB_STALE_MINUTES, 5, 180, 20);
  const admin = getAdminClient();
  const [bullmqHealth, heartbeats, outboxResult, workerConfigResult] = await Promise.all([
    getGenerationBullMqHealth(),
    getWorkerHeartbeats().catch(() => []),
    admin.rpc("get_generation_queue_health"),
    admin
      .from("admin_config_versions")
      .select("id,value,published_at")
      .eq("config_key", WORKER_RUNTIME_CONFIG_KEY)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (outboxResult.error) warnings.push(`Outbox health: ${outboxResult.error.message}`);
  if (workerConfigResult.error) warnings.push(`Worker config: ${workerConfigResult.error.message}`);
  const outboxHealth = normalizeWorkerOutboxHealth(outboxResult.data);
  const desired = workerConfigResult.data?.value
    ? parseWorkerRuntimeConfig(workerConfigResult.data.value)
    : { ...DEFAULT_WORKER_RUNTIME_CONFIG };
  const runtimeWorkerConcurrency = readIntegerEnv("BULLMQ_WORKER_CONCURRENCY", desired.workerConcurrency, 1, 64);
  const runtimeImageBatchConcurrency = readIntegerEnv("GENERATION_IMAGE_BATCH_CONCURRENCY", desired.imageBatchConcurrency, 1, 8);
  const runtimeRelayConcurrency = readIntegerEnv("BULLMQ_RELAY_CONCURRENCY", desired.relayConcurrency, 1, 128);
  const driftReasons = getWorkerRuntimeDrift({
    desired,
    onlineInstances: bullmqHealth.reachable ? bullmqHealth.workers : null,
    workerConcurrency: runtimeWorkerConcurrency,
    imageBatchConcurrency: runtimeImageBatchConcurrency,
    relayConcurrency: runtimeRelayConcurrency,
  });
  const drift = driftReasons.length > 0;
  if (drift) warnings.push(`Worker 运行配置漂移：${driftReasons.join("；")}`);
  if (!bullmqHealth.reachable && bullmqHealth.configured) warnings.push("BullMQ Redis 当前不可达");
  if (bullmqHealth.workers > 0 && heartbeats.length === 0) warnings.push("BullMQ 检测到 Worker，但应用心跳尚未出现；旧版本 Worker 或心跳连接可能异常");
  const result = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("task_queue_items")
      .select(TASK_QUEUE_COLUMNS)
      .order("updated_at", { ascending: false })
      .limit(300),
    "worker task queue sample",
    warnings,
    true,
  );

  let rows = (result.data || []).map(mapTaskQueueRow);
  if (!result.data) {
    const fallback = await listAdminTasks({ limit: 120 });
    rows = fallback.rows;
    warnings.push(...fallback.warnings);
  }

  const useBullMqCounts = bullmqHealth.reachable;
  const queue = {
    sampled: rows.length,
    source: useBullMqCounts ? "bullmq" as const : "task_queue_sample" as const,
    queued: useBullMqCounts
      ? (bullmqHealth.counts.waiting || 0) + (bullmqHealth.counts.delayed || 0) + (bullmqHealth.counts.waitingChildren || 0)
      : rows.filter((row) => row.statusGroup === "queued").length,
    running: useBullMqCounts ? bullmqHealth.counts.active || 0 : rows.filter((row) => row.statusGroup === "running").length,
    completed: useBullMqCounts ? bullmqHealth.counts.completed || 0 : rows.filter((row) => row.statusGroup === "completed").length,
    failed: useBullMqCounts ? bullmqHealth.counts.failed || 0 : rows.filter((row) => row.statusGroup === "failed").length,
    stale: 0,
    staleMinutes,
  };
  const staleTasks = rows
    .filter((row) => row.statusGroup === "running" && isTaskStale(row, staleMinutes))
    .slice(0, 30);
  queue.stale = staleTasks.length;
  const runtimeAlerts = getWorkerRuntimeAlerts({
    desired,
    waiting: useBullMqCounts ? bullmqHealth.counts.waiting : null,
    oldestPendingSeconds: outboxResult.error ? null : outboxHealth.oldest_pending_age_seconds ?? 0,
  });
  if (runtimeAlerts.breached) warnings.push(...runtimeAlerts.reasons);

  const auditResult = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("admin_audit_logs")
      .select("id,actor_user_id,actor_email,actor_role,action,resource_type,resource_id,reason,metadata,created_at")
      .like("action", "worker.run%")
      .order("created_at", { ascending: false })
      .limit(20),
    "worker audit runs",
    warnings,
    true,
  );

  return {
    runtime: {
      desired,
      actual: {
        onlineInstances: bullmqHealth.workers,
        workerConcurrency: runtimeWorkerConcurrency,
        imageBatchConcurrency: runtimeImageBatchConcurrency,
        relayConcurrency: runtimeRelayConcurrency,
        activeCapacity: bullmqHealth.workers * runtimeWorkerConcurrency,
        mode: process.env.GENERATION_QUEUE_MODE?.trim().toLowerCase() || (process.env.NODE_ENV === "production" ? "bullmq" : "inline"),
        drift,
        driftReasons,
      },
      bullmq: bullmqHealth,
      outbox: outboxHealth,
      alerts: runtimeAlerts,
      instances: heartbeats,
      configVersion: workerConfigResult.data
        ? { id: String(workerConfigResult.data.id), publishedAt: workerConfigResult.data.published_at || null }
        : null,
    },
    processors: getWorkerProcessors(),
    queue,
    staleTasks,
    recentRuns: (auditResult.data || []).map(mapAuditRow),
    warnings: uniqueStrings(warnings),
  };
}

function normalizeWorkerOutboxHealth(value: unknown): Record<string, number> {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object" || Array.isArray(row)) return {};
  return Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, item]) => [key, Number(item) || 0]));
}

function readIntegerEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] || fallback);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}



export async function getAdminProviderCatalog(): Promise<AdminProviderCatalog> {
  const [llmRaw, videoRaw, controlPlane] = await Promise.all([
    getPublishedLlmProviderRawValue().catch(() => null),
    getPublishedVideoProviderRawValue().catch(() => null),
    getAiControlPlanePublicSnapshot().catch(() => null),
  ]);

  const MODEL_NOTES: Record<LingyaModel, string> = {
    "nano-banana-2": "默认主力模型，适合批量生产和姿势裂变。",
    "nano-banana-2-lite": "更快的 1K 模型，适合低延迟批量任务。",
    "gpt-image-2": "适合稳定编辑类任务。",
    "nano-banana-pro": "高质量模型，建议用于品牌大片和复杂参考图。",
  };

  return {
    defaultModel: DEFAULT_LINGYA_MODEL,
    providerPublish: {
      llm: Boolean(llmRaw),
      model: controlPlane?.source === "unified",
      video: Boolean(videoRaw),
    },
    modelProviders: (["nano-banana-2", "nano-banana-2-lite", "gpt-image-2", "nano-banana-pro"] as const).map((model) => {
      const deployment = controlPlane?.config.deployments.find((item) => item.modelId === model && item.enabled);
      const provider = deployment
        ? controlPlane?.config.providers.find((item) => item.id === deployment.providerId && item.enabled)
        : undefined;
      return {
        model,
        enabled: Boolean(deployment && provider),
        baseUrl: provider?.baseUrl || "",
        upstreamModel: deployment?.upstreamModel || "",
        apiKeyConfigured: provider?.apiKeyConfigured === true,
        source: "admin" as const,
        costs: CREDIT_COSTS[model],
        notes: MODEL_NOTES[model],
      };
    }),
    modules: [
      { key: "tryon", label: "服装上身", route: "/create", adminHref: "/admin/tryon", risk: "medium" },
      { key: "pose", label: "姿势裂变", route: "/pose", adminHref: "/admin/generations?module=pose", risk: "medium" },
      { key: "model", label: "专属模特", route: "/model", adminHref: "/admin/generations?module=model", risk: "medium" },
      { key: "modelBackground", label: "模特换背景", route: "/model-background", adminHref: "/admin/generations?module=model-background", risk: "medium" },
      { key: "grass", label: "种草图", route: "/grass", adminHref: "/admin/generations?module=grass", risk: "low" },
      { key: "productSet", label: "商品套图", route: "/product-set", adminHref: "/admin/generations?module=product-set", risk: "medium" },
      { key: "garment3d", label: "服装 3D", route: "/garment-3d", adminHref: "/admin/generations?module=garment-3d", risk: "low" },
      { key: "faceSwap", label: "换脸", route: "/face-swap", adminHref: "/admin/generations?module=face-swap", risk: "high" },
    ],
  };
}

async function loadProfileEmails(userIds: string[], warnings: string[]) {
  const uniqueIds = uniqueStrings(userIds).slice(0, 300);
  const emails = new Map<string, string>();
  if (!uniqueIds.length) return emails;

  const result = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("profiles")
      .select("id,email")
      .in("id", uniqueIds),
    "profile email lookup",
    warnings,
    true,
  );

  for (const row of result.data || []) {
    const id = stringValue(row.id);
    const email = stringValue(row.email);
    if (id && email) emails.set(id, email);
  }
  return emails;
}

async function loadUserTasks(userId: string, warnings: string[]) {
  const generations = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("generations")
      .select(GENERATION_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(40),
    "user detail generations",
    warnings,
    true,
  );

  return (generations.data || []).map(mapGenerationRow)
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))
    .slice(0, 40);
}

async function loadUserAssets(userId: string, warnings: string[]) {
  const result = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("generations")
      .select(GENERATION_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(40),
    "user detail assets",
    warnings,
    true,
  );

  return (result.data || [])
    .map(mapGenerationAssetRow)
    .filter((row) => row.urls.length > 0 || row.inputUrls.length > 0)
    .slice(0, 24);
}

async function loadQueueItemBySourceId(id: string, warnings: string[]) {
  const result = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("task_queue_items")
      .select(TASK_QUEUE_COLUMNS)
      .eq("source_id", id)
      .limit(1),
    "task detail queue item",
    warnings,
    true,
  );
  return result.data?.[0] ? mapTaskQueueRow(result.data[0]) : null;
}

async function loadGenerationDetail(id: string, warnings: string[]) {
  const localWarnings: string[] = [];
  const result = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("generations")
      .select(GENERATION_COLUMNS)
      .eq("id", id)
      .limit(1),
    "task detail generation",
    localWarnings,
    true,
  );
  warnings.push(...localWarnings);
  return { row: result.data?.[0] || null, warnings: localWarnings };
}

async function loadRouteAttemptsByGeneration(id: string, warnings: string[]) {
  const result = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("ai_route_attempts")
      .select([
        "request_id",
        "deployment_id",
        "provider_id",
        "upstream_model",
        "routing_mode",
        "attempt_no",
        "status",
        "selection_reason",
        "queue_latency_ms",
        "provider_latency_ms",
        "total_latency_ms",
        "output_units",
        "output_width",
        "output_height",
        "estimated_cost_usd",
        "metadata",
        "error_category",
        "error_code",
        "error_message",
        "http_status",
        "created_at",
        "completed_at",
      ].join(","))
      .eq("generation_id", id)
      .order("created_at", { ascending: true })
      .limit(50),
    "task detail route attempts",
    warnings,
    true,
  );
  return result.data || [];
}

async function loadCreditLogsByGeneration(generationId: string, warnings: string[]) {
  const result = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("credit_logs")
      .select(CREDIT_LOG_COLUMNS)
      .eq("generation_id", generationId)
      .order("created_at", { ascending: false })
      .limit(20),
    "task detail credit logs",
    warnings,
    true,
  );
  const rows = result.data || [];
  const emails = await loadProfileEmails(rows.map((row) => stringValue(row.user_id)), warnings);
  return rows.map((row) => {
    const userId = stringValue(row.user_id);
    return {
      id: stringValue(row.id),
      userId,
      email: emails.get(userId) || null,
      amount: numberValue(row.amount),
      balance: numberValue(row.balance),
      reason: stringValue(row.reason),
      generationId: nullableString(row.generation_id),
      createdAt: nullableString(row.created_at),
    };
  });
}

async function loadAuditLogsByResource(resourceId: string, warnings: string[]) {
  const result = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("admin_audit_logs")
      .select("id,actor_user_id,actor_email,actor_role,action,resource_type,resource_id,reason,metadata,created_at")
      .eq("resource_id", resourceId)
      .order("created_at", { ascending: false })
      .limit(20),
    "task detail audit logs",
    warnings,
    true,
  );
  return (result.data || []).map((row) => ({
    id: stringValue(row.id),
    actorUserId: nullableString(row.actor_user_id),
    actorEmail: nullableString(row.actor_email),
    actorRole: nullableString(row.actor_role),
    action: stringValue(row.action),
    resourceType: stringValue(row.resource_type),
    resourceId: nullableString(row.resource_id),
    reason: nullableString(row.reason),
    metadata: isRecord(row.metadata) ? row.metadata : {},
    createdAt: nullableString(row.created_at),
  }));
}

async function loadReferenceAssets(limit: number, warnings: string[]): Promise<AdminAssetListItem[]> {
  const result = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("reference_images")
      .select("id,user_id,url,label,category,is_preset,created_at")
      .order("created_at", { ascending: false })
      .limit(limit),
    "reference assets",
    warnings,
    true,
  );

  return (result.data || []).map((row) => {
    const id = stringValue(row.id);
    const category = stringValue(row.category) || "reference";
    return {
      id,
      userId: stringValue(row.user_id),
      sourceType: "reference" as const,
      module: category,
      moduleLabel: `参考图:${category}`,
      title: stringValue(row.label) || "参考图",
      status: row.is_preset === true ? "preset" : "user",
      urls: [stringValue(row.url)].filter(Boolean),
      inputUrls: [],
      createdAt: nullableString(row.created_at),
      updatedAt: nullableString(row.created_at),
      detailUrl: "/admin/assets",
    };
  });
}

async function loadFavoritePlanAssets(limit: number, warnings: string[]): Promise<AdminAssetListItem[]> {
  const result = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("product_set_favorite_plans")
      .select("id,user_id,name,mode,image_type,plan_preview,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit),
    "favorite plan assets",
    warnings,
    true,
  );

  return (result.data || []).map((row) => {
    const id = stringValue(row.id);
    return {
      id,
      userId: stringValue(row.user_id),
      sourceType: "favorite-plan" as const,
      module: "productSet",
      moduleLabel: "商品套图方案",
      title: stringValue(row.name) || "收藏方案",
      status: stringValue(row.mode) || "smart",
      urls: extractUrls(row.plan_preview).slice(0, 4),
      inputUrls: [],
      createdAt: nullableString(row.created_at),
      updatedAt: nullableString(row.updated_at),
      detailUrl: "/admin/assets",
    };
  });
}

function mapGenerationAssetRow(row: Record<string, unknown>): AdminAssetListItem {
  const payload = isRecord(row.job_payload) ? row.job_payload : {};
  const module = normalizeModuleFilter(stringValue(payload.kind) || stringValue(payload.module) || inferModuleFromPayload(payload)) || "tryon";
  const id = stringValue(row.id);
  return {
    id,
    userId: stringValue(row.user_id),
    sourceType: "generation",
    module,
    moduleLabel: moduleLabel(module),
    title: `${moduleLabel(module)} ${id.slice(0, 8)}`,
    status: stringValue(row.status) || "unknown",
    urls: arrayOfStrings(row.result_urls),
    inputUrls: inferInputThumbnails(row, payload),
    createdAt: nullableString(row.created_at),
    updatedAt: nullableString(row.updated_at) || nullableString(row.completed_at),
    detailUrl: `/admin/generations?q=${encodeURIComponent(id)}`,
  };
}

function matchesAssetSearch(row: AdminAssetListItem, q: string) {
  return [
    row.id,
    row.userId,
    row.sourceType,
    row.module,
    row.moduleLabel,
    row.title,
    row.status,
  ].some((value) => value.toLowerCase().includes(q));
}

const ASSET_LIFECYCLE_POLICIES: AdminAssetLifecyclePolicy[] = [
  {
    id: "favorite-protection",
    title: "收藏与参考素材保留",
    description: "用户收藏方案、参考图和可复用素材默认进入保护池，迁移和删除前必须先确认引用影响。",
    stage: "protected",
    action: "retain",
    threshold: "reference/favorite-plan",
  },
  {
    id: "external-storage-migration",
    title: "外部 URL 迁移到 OSS",
    description: "ImgBB、第三方域名和未知来源 URL 进入迁移候选，优先复制到当前 OSS 前缀并回写引用。",
    stage: "migrate",
    action: "migrate_to_oss",
    threshold: "provider != aliyun-oss",
  },
  {
    id: "temporary-input-review",
    title: "临时输入图复核",
    description: "超过 30 天仍被任务引用的输入图进入复核池，确认是否需要长期保留或转入归档前缀。",
    stage: "review",
    action: "review_temp_inputs",
    threshold: "input age > 30d",
  },
  {
    id: "generated-result-archive",
    title: "历史生成结果归档",
    description: "超过 180 天的非收藏生成结果进入归档候选，后续由异步 worker 做软归档或冷存储迁移。",
    stage: "archive",
    action: "archive_generated_result",
    threshold: "generation age > 180d",
  },
  {
    id: "moderation-freeze",
    title: "审核下架冻结",
    description: "审核标记为下架的素材优先冻结展示，并阻止再次进入用户作品库或公开分享链路。",
    stage: "archive",
    action: "freeze_and_hide",
    threshold: "moderation = hide",
  },
];

function mapAssetLifecycleItem(row: AdminAssetListItem): AdminAssetLifecycleItem {
  const allUrls = uniqueStrings([...row.urls, ...row.inputUrls]);
  const providers = uniqueStrings(allUrls.map(classifyAssetUrl)) as AdminAssetStorageProvider[];
  const ageDays = getAssetAgeDays(row.updatedAt || row.createdAt);
  const moderationAction = row.moderationCase?.action || null;
  const reasons: string[] = [];
  let stage: AdminAssetLifecycleStage = "retained";
  let riskLevel: AdminAssetLifecycleItem["riskLevel"] = "low";
  let recommendedAction: AdminAssetLifecycleAction = "retain";

  if (row.sourceType === "reference" || row.sourceType === "favorite-plan") {
    stage = "protected";
    reasons.push("用户参考图或收藏方案仍有业务引用，默认保护。");
  }

  if (providers.some((provider) => provider !== "aliyun-oss" && provider !== "data-url")) {
    stage = "migrate";
    riskLevel = "medium";
    recommendedAction = "migrate_to_oss";
    reasons.push("存在 ImgBB、第三方或未知来源 URL，建议迁移到 OSS。");
  }

  if (row.inputUrls.length > 0 && ageDays > 30 && stage !== "migrate") {
    stage = "review";
    riskLevel = "medium";
    recommendedAction = "review_temp_inputs";
    reasons.push("输入图超过 30 天仍被引用，需要确认长期保留策略。");
  }

  if (row.sourceType === "generation" && ageDays > 180 && stage !== "migrate" && stage !== "review") {
    stage = "archive";
    riskLevel = "medium";
    recommendedAction = "archive_generated_result";
    reasons.push("生成结果超过 180 天，可进入归档候选。");
  }

  if (moderationAction === "hide") {
    stage = "archive";
    riskLevel = "high";
    recommendedAction = "freeze_and_hide";
    reasons.push("审核已标记下架，应优先冻结展示。");
  }

  if (!reasons.length) {
    reasons.push("当前 URL 来源和引用状态正常，继续保留。");
  }

  return {
    ...row,
    providers: providers.length ? providers : ["unknown"],
    urlCount: row.urls.length,
    inputCount: row.inputUrls.length,
    ageDays,
    stage,
    riskLevel,
    reasons,
    recommendedAction,
    moderationAction,
  };
}

function createAssetLifecycleMetrics(): AdminAssetLifecycleOverview["metrics"] {
  return {
    sampledAssets: 0,
    sampledUrls: 0,
    ossUrls: 0,
    imgbbUrls: 0,
    externalUrls: 0,
    dataUrls: 0,
    unknownUrls: 0,
    migrationCandidates: 0,
    archiveCandidates: 0,
    protectedAssets: 0,
    reviewCandidates: 0,
    hiddenAssets: 0,
  };
}

function countProviderUrls(row: AdminAssetLifecycleItem, provider: AdminAssetStorageProvider) {
  return [...row.urls, ...row.inputUrls].filter((url) => classifyAssetUrl(url) === provider).length;
}

function classifyAssetUrl(url: string): AdminAssetStorageProvider {
  if (!url) return "unknown";
  if (url.startsWith("data:image/")) return "data-url";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const configuredHost = getConfiguredOssHost();
    if (
      host.includes("aliyuncs.com") ||
      host.includes("oss-") ||
      (configuredHost && host === configuredHost)
    ) {
      return "aliyun-oss";
    }
    if (host.includes("ibb.co") || host.includes("imgbb.com")) return "imgbb";
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return "external";
    return "unknown";
  } catch {
    return "unknown";
  }
}

function getConfiguredOssHost() {
  const candidates = [
    process.env.ALIYUN_OSS_PUBLIC_BASE_URL,
    process.env.ALIYUN_OSS_ENDPOINT,
    process.env.ALIYUN_OSS_BUCKET,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return new URL(String(candidate)).hostname.toLowerCase();
    } catch {
      const normalized = String(candidate).trim().toLowerCase();
      if (normalized.includes(".")) return normalized;
    }
  }
  return "";
}

function getAssetAgeDays(value: string | null | undefined) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

async function loadLatestModerationForAssets(rows: AdminAssetListItem[], warnings: string[]) {
  const ids = uniqueStrings(rows.map((row) => row.id));
  const map = new Map<string, AdminModerationCase>();
  if (!ids.length) return map;

  const result = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("moderation_cases")
      .select(MODERATION_CASE_COLUMNS)
      .in("source_id", ids)
      .order("created_at", { ascending: false })
      .limit(Math.min(ids.length * 3, 500)),
    "asset moderation cases",
    warnings,
    true,
  );

  for (const row of result.data || []) {
    const item = mapModerationCase(row);
    const key = assetModerationKey(item.sourceType, item.sourceId);
    if (!map.has(key)) map.set(key, item);
  }

  return map;
}

function assetModerationKey(sourceType: string, id: string) {
  return `${sourceType}:${id}`;
}

function matchesModerationSearch(row: AdminModerationCase, q: string) {
  return [
    row.id,
    row.sourceType,
    row.sourceId,
    row.action,
    row.status,
    row.reason || "",
  ].some((value) => value.toLowerCase().includes(q));
}

function matchesOperationRequestSearch(row: AdminOperationRequest, q: string) {
  return [
    row.id,
    row.requestType,
    row.status,
    row.targetType,
    row.targetId,
    row.reason,
    row.requestedByEmail || "",
    row.requestedBy || "",
    JSON.stringify(row.payload),
  ].some((value) => value.toLowerCase().includes(q));
}

function normalizeOperationRequestStatus(value?: string) {
  const normalized = (value || "").trim().toLowerCase();
  return normalized === "pending" ||
    normalized === "approved" ||
    normalized === "rejected" ||
    normalized === "cancelled" ||
    normalized === "failed"
    ? normalized
    : "";
}

function getRuntimeSettingHealth(): AdminSettingsOverview["runtime"] {
  return [
    { key: "NEXT_PUBLIC_SUPABASE_URL", label: "用户数据服务", configured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL), scope: "登录与数据" },
    { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", label: "前台访问密钥", configured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY), scope: "登录与数据" },
    { key: "SUPABASE_SERVICE_ROLE_KEY", label: "后台管理密钥", configured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY), scope: "后台" },
    { key: "ADMIN_BOOTSTRAP_EMAILS", label: "初始管理员邮箱", configured: Boolean(process.env.ADMIN_BOOTSTRAP_EMAILS || process.env.ADMIN_EMAILS), scope: "后台" },
    { key: "TASK_QUEUE_CACHE_MODE", label: "任务缓存模式", configured: Boolean(process.env.TASK_QUEUE_CACHE_MODE), scope: "任务队列" },
    { key: "REDIS_URL", label: "BullMQ / 分布式容量 Redis", configured: Boolean(process.env.REDIS_URL), scope: "任务队列" },
    { key: "IMAGE_STORAGE_PROVIDER", label: "图片存储服务", configured: Boolean(process.env.IMAGE_STORAGE_PROVIDER), scope: "存储" },
    { key: "ALIYUN_OSS_BUCKET", label: "对象存储空间", configured: Boolean(process.env.ALIYUN_OSS_BUCKET), scope: "存储" },
    { key: "ADMIN_SECRETS_ENCRYPTION_KEY", label: "后台供应商密钥加密", configured: Boolean(process.env.ADMIN_SECRETS_ENCRYPTION_KEY), scope: "统一模型控制面" },
  ];
}

function getWorkerProcessors(): AdminWorkerProcessor[] {
  return [
    {
      key: "generations",
      label: "BullMQ 生成 Worker",
      endpoint: process.env.BULLMQ_QUEUE_NAME || "generation-jobs",
      batchSize: readIntegerEnv("BULLMQ_WORKER_CONCURRENCY", 16, 1, 64),
      configured: process.env.GENERATION_QUEUE_MODE === "bullmq" && Boolean(process.env.REDIS_URL),
      secretNames: ["REDIS_URL"],
      statusHint: "由 PM2 Worker 自动消费；恢复操作只处理事务 Outbox，不直接执行业务任务。",
    },
  ];
}

function isTaskStale(row: AdminTaskListItem, staleMinutes: number) {
  const timestamp = Date.parse(row.updatedAt || row.createdAt || "");
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp > staleMinutes * 60 * 1000;
}

function aggregateGenerations(rows: Record<string, unknown>[]) {
  const moduleMap = new Map<string, AdminBreakdownItem>();
  const modelMap = new Map<string, AdminBreakdownItem>();

  for (const row of rows) {
    const payload = isRecord(row.job_payload) ? row.job_payload : {};
    const module = normalizeModuleFilter(stringValue(payload.kind) || stringValue(payload.module) || inferModuleFromPayload(payload));
    const model = stringValue(row.ai_model) || stringValue(payload.aiModel) || "unknown";
    const statusGroup = normalizeTaskStatusGroup(stringValue(row.status), arrayOfStrings(row.result_urls).length);
    const credits = readGenerationBillingCredits(row, statusGroup);

    bumpBreakdown(moduleMap, module || "unknown", moduleLabel(module || "unknown"), statusGroup, credits);
    bumpBreakdown(modelMap, model, model, statusGroup, credits);
  }

  return {
    moduleStats: Array.from(moduleMap.values()).sort((a, b) => b.count - a.count).slice(0, 8),
    modelStats: Array.from(modelMap.values()).sort((a, b) => b.count - a.count).slice(0, 8),
  };
}

function bumpBreakdown(
  map: Map<string, AdminBreakdownItem>,
  key: string,
  label: string,
  statusGroup: TaskStatusGroup,
  credits: number,
) {
  const item = map.get(key) || { key, label, count: 0, failed: 0, running: 0, credits: 0 };
  item.count += 1;
  item.credits += credits;
  if (statusGroup === "failed") item.failed += 1;
  if (statusGroup === "queued" || statusGroup === "running") item.running += 1;
  map.set(key, item);
}

async function loadCreditHealth(sinceIso: string, warnings: string[]) {
  const [profiles, logs] = await Promise.all([
    runQuery<Record<string, unknown>[]>(
      getAdminClient()
        .from("profiles")
        .select("credits,total_credits_used")
        .order("updated_at", { ascending: false })
        .limit(300),
      "credit profile sample",
      warnings,
      true,
    ),
    runQuery<Record<string, unknown>[]>(
      getAdminClient()
        .from("credit_logs")
        .select("amount,balance,reason,created_at")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(300),
      "credit logs sample",
      warnings,
      true,
    ),
  ]);

  const profileRows = profiles.data || [];
  const logRows = logs.data || [];
  return {
    sampledBalance: profileRows.reduce((sum, row) => sum + numberValue(row.credits), 0),
    sampledConsumed: profileRows.reduce((sum, row) => sum + numberValue(row.total_credits_used), 0),
    recentSpend: Math.abs(logRows.filter((row) => numberValue(row.amount) < 0).reduce((sum, row) => sum + numberValue(row.amount), 0)),
    recentRefund: logRows
      .filter((row) => numberValue(row.amount) > 0 && isRefundCreditReason(stringValue(row.reason)))
      .reduce((sum, row) => sum + numberValue(row.amount), 0),
  };
}

function isRefundCreditReason(reason: string) {
  return /退款|退回|refund|failed/i.test(reason);
}

async function loadAdminPeriodAggregate(sinceIso: string, warnings: string[]): Promise<AdminPeriodAggregate | null> {
  try {
    const response = await withTimeout(
      getAdminClient().rpc("get_admin_dashboard_period", { p_since: sinceIso }),
      SHORT_QUERY_TIMEOUT_MS,
      "admin dashboard period aggregate timeout",
    ) as { data?: unknown; error?: { message?: string } | null };
    if (response.error) {
      const message = response.error.message || "dashboard aggregate RPC unavailable";
      warnings.push(message.toLowerCase().includes("does not exist") || message.toLowerCase().includes("could not find function")
        ? "运营指标聚合 RPC 尚未部署，当前使用兼容回退数据"
        : `运营指标聚合失败：${message}`);
      return null;
    }
    const row = Array.isArray(response.data) ? response.data[0] : response.data;
    if (!isRecord(row)) return null;
    return {
      total: numberValue(row.total_generations),
      completed: numberValue(row.completed_generations),
      failed: numberValue(row.failed_generations),
      creditsSpent: numberValue(row.credits_spent),
      creditsRefunded: numberValue(row.credits_refunded),
      newUsers: numberValue(row.new_users),
    };
  } catch (error) {
    warnings.push(`运营指标聚合失败：${toMessage(error)}`);
    return null;
  }
}

async function loadAdminBillingSummary(warnings: string[]): Promise<AdminBillingSummary | null> {
  try {
    const response = await withTimeout(
      getAdminClient().rpc("get_admin_billing_summary"),
      SHORT_QUERY_TIMEOUT_MS,
      "admin billing summary timeout",
    ) as { data?: unknown; error?: { message?: string } | null };
    if (response.error) {
      const message = response.error.message || "billing summary RPC unavailable";
      warnings.push(message.toLowerCase().includes("does not exist") || message.toLowerCase().includes("could not find function")
        ? "Billing 全量汇总 RPC 尚未部署，当前使用样本回退"
        : `Billing 全量汇总失败：${message}`);
      return null;
    }
    const row = Array.isArray(response.data) ? response.data[0] : response.data;
    if (!isRecord(row)) return null;
    return {
      activeProducts: numberValue(row.active_products),
      activePrices: numberValue(row.active_prices),
      paidOrders: numberValue(row.paid_orders),
      netRevenue: numberValue(row.net_revenue),
      activeSubscriptions: numberValue(row.active_subscriptions),
      webhookIssues: numberValue(row.webhook_issues),
    };
  } catch (error) {
    warnings.push(`Billing 全量汇总失败：${toMessage(error)}`);
    return null;
  }
}

async function loadDailyStats(
  days: number,
  warnings: string[]
): Promise<AdminOverview["dailyStats"]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  since.setUTCHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();
  const [generations, creditLogs, profiles] = await Promise.all([
    runQuery<Record<string, unknown>[]>(
      getAdminClient()
        .from("generations")
        .select("created_at,status,credits_cost")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: true })
        .limit(4000),
      "daily generation stats",
      warnings,
      true,
    ),
    runQuery<Record<string, unknown>[]>(
      getAdminClient()
        .from("credit_logs")
        .select("amount,created_at")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: true })
        .limit(4000),
      "daily credit stats",
      warnings,
      true,
    ),
    runQuery<Record<string, unknown>[]>(
      getAdminClient()
        .from("profiles")
        .select("created_at")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: true })
        .limit(4000),
      "daily new user stats",
      warnings,
      true,
    ),
  ]);

  const byDate = new Map<string, AdminOverview["dailyStats"][number]>();
  const dayKeyOf = (value: string | null | undefined) => (value || "").slice(0, 10);
  for (const row of generations.data || []) {
    const key = dayKeyOf(stringValue(row.created_at));
    if (!key) continue;
    const entry = byDate.get(key) || { date: key, tasks: 0, completed: 0, failed: 0, creditsSpent: 0, creditsRefunded: 0, newUsers: 0 };
    entry.tasks += 1;
    const status = String(row.status || "").toLowerCase();
    if (status === "completed") entry.completed += 1;
    if (status === "failed") entry.failed += 1;
    const cost = numberValue(row.credits_cost);
    if (status === "completed" && cost > 0) entry.creditsSpent += cost;
    byDate.set(key, entry);
  }
  for (const row of creditLogs.data || []) {
    const key = dayKeyOf(stringValue(row.created_at));
    if (!key) continue;
    const entry = byDate.get(key) || { date: key, tasks: 0, completed: 0, failed: 0, creditsSpent: 0, creditsRefunded: 0, newUsers: 0 };
    const amount = numberValue(row.amount);
    if (amount > 0) entry.creditsRefunded += amount;
    byDate.set(key, entry);
  }
  for (const row of profiles.data || []) {
    const key = dayKeyOf(stringValue(row.created_at));
    if (!key) continue;
    const entry = byDate.get(key) || { date: key, tasks: 0, completed: 0, failed: 0, creditsSpent: 0, creditsRefunded: 0, newUsers: 0 };
    entry.newUsers += 1;
    byDate.set(key, entry);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

async function loadRecentGenerationRows(
  warnings: string[],
  options: { sinceIso?: string; limit?: number } = {}
) {
  const sinceIso = options.sinceIso || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const limit = options.limit ?? 200;
  const result = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("generations")
      .select("status,result_urls,job_payload,credits_used,credits_cost,ai_model,image_size,created_at")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(limit),
    "recent generations aggregate",
    warnings,
    true,
  );
  return result.data || [];
}

/**
 * Round-robin picker: takes the input rows already ordered by `created_at DESC`
 * and yields one row per distinct `module` until the requested limit is met.
 * This keeps the dashboard's "recent tasks" preview varied instead of being
 * dominated by a single high-volume module (e.g. 服装上身).
 */
function diversifyRowsByModule<T extends { module: string }>(rows: T[], limit: number): T[] {
  if (!rows.length || limit <= 0) return [];
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.module || "unknown";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }
  // Round-robin: pick index 0 from each bucket, then index 1, etc.
  const picked: T[] = [];
  const iterators = Array.from(buckets.values()).map((bucket) => bucket[Symbol.iterator]());
  while (picked.length < limit) {
    let progressed = false;
    for (const it of iterators) {
      const next = it.next();
      if (next.done) continue;
      picked.push(next.value);
      progressed = true;
      if (picked.length >= limit) break;
    }
    if (!progressed) break;
  }
  return picked;
}

/**
 * Defensive fallback for moduleStats / modelStats: when the primary
 * `generations.job_payload.kind` aggregator returns 0 rows (RLS, parsing
 * miss, or genuinely empty data window), surface the same shape from
 * `task_queue_items.module` so the dashboard never shows a hard "暂无模块统计"
 * empty state. Returns null when the fallback also has no data, so callers
 * can keep the original empty state if both sources are empty.
 */
async function loadTaskQueueModuleStats(
  warnings: string[],
  options: { sinceIso?: string; limit?: number } = {}
): Promise<{
  moduleStats: AdminBreakdownItem[];
  modelStats: AdminBreakdownItem[];
} | null> {
  const sinceIso = options.sinceIso || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const limit = options.limit ?? 1500;
  const result = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("task_queue_items")
      .select("module,status_group,source_type")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(limit),
    "task queue module fallback",
    warnings,
    true,
  );
  const rows = result.data || [];
  if (!rows.length) return null;

  const moduleMap = new Map<string, AdminBreakdownItem>();
  for (const row of rows) {
    const moduleKey = stringValue(row.module) || "unknown";
    const statusGroup = normalizeTaskStatusGroup(stringValue(row.status_group));
    bumpBreakdown(moduleMap, moduleKey, moduleLabel(moduleKey), statusGroup, 0);
  }

  const moduleStats = Array.from(moduleMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  if (!moduleStats.length) return null;
  // task_queue_items doesn't carry model info; leave modelStats empty so the
  // primary `report.models` (from generations + credit_logs) is the only source.
  return { moduleStats, modelStats: [] };
}

async function loadUserGenerationStats(userIds: string[], warnings: string[]) {
  const stats = new Map<string, { count: number; latestAt: string | null }>();
  if (!userIds.length) return stats;

  const result = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("generations")
      .select("user_id,created_at")
      .in("user_id", userIds)
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(userIds.length * 80, 240), 1200)),
    "user generation stats",
    warnings,
    true,
  );

  for (const row of result.data || []) {
    const userId = stringValue(row.user_id);
    if (!userId) continue;
    const current = stats.get(userId) || { count: 0, latestAt: null };
    current.count += 1;
    const createdAt = nullableString(row.created_at);
    if (createdAt && (!current.latestAt || Date.parse(createdAt) > Date.parse(current.latestAt))) {
      current.latestAt = createdAt;
    }
    stats.set(userId, current);
  }

  return stats;
}

async function loadUserControlMap(userIds: string[], warnings: string[]) {
  const controls = new Map<string, AdminUserControl>();
  if (!userIds.length) return controls;

  const result = await runQuery<Record<string, unknown>[]>(
    getAdminClient()
      .from("admin_user_controls")
      .select(ADMIN_USER_CONTROL_COLUMNS)
      .in("user_id", userIds),
    "admin user controls",
    warnings,
    true,
  );

  for (const row of result.data || []) {
    const control = mapUserControlRow(row);
    if (control.userId) controls.set(control.userId, control);
  }

  return controls;
}

function mapUserControlRow(row: Record<string, unknown>): AdminUserControl {
  return {
    userId: stringValue(row.user_id),
    status: normalizeUserAccountStatus(row.status),
    generateEnabled: row.generate_enabled !== false,
    supportLevel: normalizeUserSupportLevel(row.support_level),
    reason: nullableString(row.reason),
    note: nullableString(row.note),
    expiresAt: nullableString(row.expires_at),
    updatedByEmail: nullableString(row.updated_by_email),
    updatedAt: nullableString(row.updated_at),
  };
}

function applyUserControl(profile: AdminUserListItem, control: AdminUserControl | undefined): AdminUserListItem {
  if (!control) return profile;
  return {
    ...profile,
    accountStatus: control.status,
    generateEnabled: control.generateEnabled,
    supportLevel: control.supportLevel,
    controlReason: control.reason,
    controlNote: control.note,
    controlExpiresAt: control.expiresAt,
  };
}

function normalizeUserAccountStatus(value: unknown): AdminUserAccountStatus {
  return value === "restricted" || value === "suspended" ? value : "active";
}

function normalizeUserSupportLevel(value: unknown): AdminUserSupportLevel {
  return value === "priority" || value === "watch" ? value : "standard";
}

async function loadFallbackTasks(
  args: { page: number; pageSize: number; status: TaskStatusGroup | ""; module: string; sourceType: string; q: string; stale: boolean },
  warnings: string[],
) {
  const rows: AdminTaskListItem[] = [];
  const offset = (args.page - 1) * args.pageSize;
  const fetchLimit = Math.min(1000, Math.max(args.page * args.pageSize * 2, args.pageSize));
  const loadGenerations = !args.sourceType || args.sourceType === "generation";

  if (loadGenerations) {
    let query = getAdminClient()
      .from("generations")
      .select(GENERATION_COLUMNS, { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(fetchLimit);
    if (args.module) query = query.eq("job_payload->>kind", args.module);
    const generationResult = await runQuery<Record<string, unknown>[]>(query, "fallback generations", warnings, true);
    rows.push(...(generationResult.data || []).map(mapGenerationRow));
  }

  let filtered = rows;
  if (args.status) filtered = filtered.filter((row) => row.statusGroup === args.status);
  if (args.q) filtered = filtered.filter((row) => matchesTaskSearch(row, args.q));
  if (args.stale) filtered = filtered.filter((row) => row.isStale);
  filtered = filtered.sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));

  return {
    rows: filtered.slice(offset, offset + args.pageSize),
    total: filtered.length,
  };
}

function mapTaskQueueRow(row: Record<string, unknown>): AdminTaskListItem {
  const sourceType = "generation" as const;
  const module = normalizeModuleFilter(stringValue(row.module)) || "unknown";
  const resultCount = Math.max(0, numberValue(row.result_count));
  const statusGroup = normalizeTaskStatusGroup(stringValue(row.status_group) || stringValue(row.status), resultCount);
  const createdAt = nullableString(row.created_at);
  const updatedAt = nullableString(row.updated_at);
  const applyUrl = stringValue(row.apply_url);
  const generalImageMode = inferAdminGeneralImageMode(module, applyUrl, arrayOfStrings(row.input_thumbnails));
  const resolvedModuleLabel = generalImageMode === "image-to-image" ? "图生图" : generalImageMode === "text-to-image" ? "文生图" : moduleLabel(module);
  return {
    id: stringValue(row.id) || stringValue(row.source_id),
    sourceId: stringValue(row.source_id),
    sourceType,
    userId: stringValue(row.user_id),
    module,
    moduleLabel: resolvedModuleLabel,
    title: module === "generalImage" ? resolvedModuleLabel : stringValue(row.title) || resolvedModuleLabel,
    status: stringValue(row.status) || stringValue(row.status_group),
    statusGroup,
    progress: clampProgress(row.progress),
    expectedCount: Math.max(1, numberValue(row.expected_count) || 1),
    resultCount,
    inputThumbnails: generalImageMode === "text-to-image" ? [] : arrayOfStrings(row.input_thumbnails),
    resultThumbnails: arrayOfStrings(row.result_thumbnails),
    errorMessage: nullableString(row.error_message),
    applyUrl,
    createdAt,
    updatedAt,
    completedAt: nullableString(row.completed_at),
    ...staleTaskMeta(statusGroup, createdAt, updatedAt, resultCount),
  };
}

async function hydrateTaskPreviewThumbnails(rows: AdminTaskListItem[], warnings: string[]) {
  const needsResultHydration = rows.filter(
    (row) => row.resultCount > row.resultThumbnails.length && row.resultThumbnails.length < ADMIN_TASK_PREVIEW_LIMIT,
  );
  const needsInputHydration = rows.filter(
    (row) => row.sourceType === "generation" && row.inputThumbnails.length === 0,
  );
  if (!needsResultHydration.length && !needsInputHydration.length) return rows;

  const generationIds = uniqueStrings([
    ...needsResultHydration.filter((row) => row.sourceType === "generation").map((row) => row.sourceId),
    ...needsInputHydration.map((row) => row.sourceId),
  ]);
  const resultUrlsById = new Map<string, string[]>();
  const inputUrlsById = new Map<string, string[]>();

  if (generationIds.length) {
    const result = await runQuery<Record<string, unknown>[]>(
      getAdminClient()
        .from("generations")
        .select("id,result_urls,job_payload,clothing_urls,model_face_url,reference_url")
        .in("id", generationIds),
      "task preview generation thumbnails",
      warnings,
      true,
    );
    for (const row of result.data || []) {
      resultUrlsById.set(stringValue(row.id), arrayOfStrings(row.result_urls).slice(0, ADMIN_TASK_PREVIEW_LIMIT));
      const payload = isRecord(row.job_payload) ? row.job_payload : {};
      inputUrlsById.set(stringValue(row.id), inferInputThumbnails(row, payload).slice(0, ADMIN_TASK_PREVIEW_LIMIT));
    }
  }

  if (!resultUrlsById.size && !inputUrlsById.size) return rows;
  return rows.map((row) => {
    const hydratedResults = resultUrlsById.get(row.sourceId) || [];
    const hydratedInputs = inputUrlsById.get(row.sourceId) || [];
    return {
      ...row,
      inputThumbnails: uniqueStrings([...row.inputThumbnails, ...hydratedInputs]).slice(0, ADMIN_TASK_PREVIEW_LIMIT),
      resultThumbnails: uniqueStrings([...row.resultThumbnails, ...hydratedResults]).slice(0, ADMIN_TASK_PREVIEW_LIMIT),
    };
  });
}

function mapGenerationRow(row: Record<string, unknown>): AdminTaskListItem {
  const payload = isRecord(row.job_payload) ? row.job_payload : {};
  const resultUrls = arrayOfStrings(row.result_urls);
  const module = normalizeModuleFilter(stringValue(payload.kind) || stringValue(payload.module) || inferModuleFromPayload(payload)) || "tryon";
  const status = stringValue(row.status) || "queued";
  const statusGroup = normalizeTaskStatusGroup(status, resultUrls.length);
  const createdAt = nullableString(row.created_at);
  const updatedAt = nullableString(row.updated_at) || nullableString(row.processing_started_at);
  const inputThumbnails = inferInputThumbnails(row, payload);
  const generalImageMode = inferAdminGeneralImageMode(module, stringValue(payload.mode), inputThumbnails);
  const resolvedModuleLabel = generalImageMode === "image-to-image" ? "图生图" : generalImageMode === "text-to-image" ? "文生图" : moduleLabel(module);
  return {
    id: stringValue(row.id),
    sourceId: stringValue(row.id),
    sourceType: "generation",
    userId: stringValue(row.user_id),
    module,
    moduleLabel: resolvedModuleLabel,
    title: resolvedModuleLabel,
    status,
    statusGroup,
    progress: statusGroup === "completed" ? 100 : statusGroup === "failed" ? 0 : clampProgress(payload.progress || readAsyncTask(payload).progress || 12),
    expectedCount: inferExpectedCount(payload, resultUrls.length),
    resultCount: resultUrls.length,
    inputThumbnails: generalImageMode === "text-to-image" ? [] : inputThumbnails,
    resultThumbnails: resultUrls.slice(0, ADMIN_TASK_PREVIEW_LIMIT),
    errorMessage: nullableString(row.error_message),
    applyUrl: `${moduleRoute(module)}?apply=${encodeURIComponent(stringValue(row.id))}`,
    createdAt,
    updatedAt,
    completedAt: nullableString(row.completed_at),
    model: nullableString(row.ai_model) || nullableString(payload.aiModel),
    imageSize: nullableString(row.image_size) || nullableString(payload.imageSize),
    credits: readGenerationBillingCredits(row, statusGroup),
    queueReason: nullableString(row.queue_reason),
    nextAttemptAt: nullableString(row.available_at),
    capacityDeferCount: Math.max(0, numberValue(row.capacity_defer_count)),
    deliveryVersion: Math.max(0, numberValue(row.delivery_version)),
    ...staleTaskMeta(statusGroup, createdAt, updatedAt, resultUrls.length),
  };
}

function mapAuditRow(row: Record<string, unknown>): AdminAuditLog {
  return {
    id: stringValue(row.id),
    actorUserId: nullableString(row.actor_user_id),
    actorEmail: nullableString(row.actor_email),
    actorRole: nullableString(row.actor_role),
    action: stringValue(row.action),
    resourceType: stringValue(row.resource_type),
    resourceId: nullableString(row.resource_id),
    reason: nullableString(row.reason),
    metadata: isRecord(row.metadata) ? row.metadata : {},
    createdAt: nullableString(row.created_at),
  };
}

function mapConfigVersion(row: Record<string, unknown>): AdminConfigVersion {
  return {
    id: stringValue(row.id),
    configKey: stringValue(row.config_key),
    status: stringValue(row.status) || "draft",
    value: isRecord(row.value) ? row.value : {},
    createdBy: nullableString(row.created_by),
    publishedAt: nullableString(row.published_at),
    createdAt: nullableString(row.created_at),
  };
}

function parsePromptExperiments(version: AdminConfigVersion, warnings: string[]): AdminPromptExperiment[] {
  const rawExperiments = Array.isArray(version.value.experiments) ? version.value.experiments : [];
  if (!rawExperiments.length && Object.keys(version.value).length > 0) {
    warnings.push(`${PROMPT_EXPERIMENT_CONFIG_KEY}: no experiments array found in version ${version.id}`);
  }

  return rawExperiments
    .map((value, index) => mapPromptExperiment(value, version, index, warnings))
    .filter((item): item is AdminPromptExperiment => Boolean(item));
}

function mapPromptExperiment(
  value: unknown,
  version: AdminConfigVersion,
  index: number,
  warnings: string[],
): AdminPromptExperiment | null {
  if (!isRecord(value)) {
    warnings.push(`${PROMPT_EXPERIMENT_CONFIG_KEY}: experiment ${index + 1} is not an object`);
    return null;
  }

  const id = stringValue(value.id) || `experiment-${index + 1}`;
  const module = normalizeModuleFilter(stringValue(value.module)) || "generalImage";
  const status = normalizePromptExperimentStatus(stringValue(value.status));
  const variants = Array.isArray(value.variants)
    ? value.variants.map((variant, variantIndex) => mapPromptVariant(variant, variantIndex)).filter((item): item is AdminPromptExperimentVariant => Boolean(item))
    : [];
  const traffic = clampLimit(value.traffic, 0, 100, 0);

  if (variants.length < 2) {
    warnings.push(`${id}: at least two variants are recommended for A/B testing`);
  }
  const weightTotal = variants.reduce((sum, variant) => sum + variant.weight, 0);
  if (variants.length >= 2 && weightTotal !== 100) {
    warnings.push(`${id}: variant weights sum to ${weightTotal}, expected 100`);
  }

  return {
    id,
    name: stringValue(value.name) || id,
    module,
    moduleLabel: moduleLabel(module),
    status,
    traffic,
    primaryMetric: stringValue(value.primaryMetric) || "success_rate",
    guardrails: arrayOfStrings(value.guardrails),
    variants,
    owner: nullableString(value.owner),
    notes: nullableString(value.notes),
    startedAt: nullableString(value.startedAt),
    endedAt: nullableString(value.endedAt),
    versionId: version.id,
    versionStatus: version.status,
    versionCreatedAt: version.createdAt,
    versionPublishedAt: version.publishedAt,
  };
}

function mapPromptVariant(value: unknown, index: number): AdminPromptExperimentVariant | null {
  if (!isRecord(value)) return null;
  const key = stringValue(value.key) || `variant-${index + 1}`;
  return {
    key,
    label: stringValue(value.label) || key,
    weight: clampLimit(value.weight, 0, 100, index === 0 ? 50 : 0),
    template: stringValue(value.template),
    notes: nullableString(value.notes),
  };
}

function normalizePromptExperimentStatus(value: string): AdminPromptExperimentStatus {
  return value === "running" || value === "paused" || value === "completed" || value === "draft"
    ? value
    : "draft";
}

function emptyPromptExperimentMetrics(): AdminPromptExperimentOverview["metrics"] {
  return {
    total: 0,
    running: 0,
    draft: 0,
    paused: 0,
    completed: 0,
    coveredModules: 0,
    variants: 0,
    averageTraffic: 0,
  };
}

function mapModerationCase(row: Record<string, unknown>): AdminModerationCase {
  return {
    id: stringValue(row.id),
    sourceType: stringValue(row.source_type),
    sourceId: stringValue(row.source_id),
    action: stringValue(row.action),
    status: stringValue(row.status) || "open",
    reason: nullableString(row.reason),
    metadata: isRecord(row.metadata) ? row.metadata : {},
    createdBy: nullableString(row.created_by),
    createdAt: nullableString(row.created_at),
    resolvedAt: nullableString(row.resolved_at),
  };
}

function mapOperationRequest(row: Record<string, unknown>): AdminOperationRequest {
  const risk = stringValue(row.risk_level);
  return {
    id: stringValue(row.id),
    requestType: stringValue(row.request_type),
    status: stringValue(row.status) || "pending",
    requestedBy: nullableString(row.requested_by),
    requestedByEmail: nullableString(row.requested_by_email),
    requestedByRole: nullableString(row.requested_by_role),
    approvedBy: nullableString(row.approved_by),
    approvedByEmail: nullableString(row.approved_by_email),
    approvedByRole: nullableString(row.approved_by_role),
    targetType: stringValue(row.target_type),
    targetId: stringValue(row.target_id),
    reason: stringValue(row.reason),
    riskLevel: risk === "high" || risk === "low" ? risk : "medium",
    payload: isRecord(row.payload) ? row.payload : {},
    result: isRecord(row.result) ? row.result : {},
    createdAt: nullableString(row.created_at),
    updatedAt: nullableString(row.updated_at),
    approvedAt: nullableString(row.approved_at),
  };
}

function mapBillingProduct(row: Record<string, unknown>): AdminBillingProduct {
  const stripeProductId =
    pickString(row, ["stripe_product_id", "stripeProductId", "product_id", "productId", "stripe_id", "stripeId"]) ||
    stringValue(row.id);
  const id = stringValue(row.id) || stripeProductId;

  return {
    id,
    stripeProductId,
    name: pickString(row, ["name", "product_name", "productName", "title"]) || stripeProductId || "Unknown product",
    description: pickNullableString(row, ["description", "product_description", "productDescription"]),
    tierKey: pickNullableString(row, ["tier_key", "tierKey"]),
    creditAmount: pickNumber(row, ["credit_amount", "creditAmount", "credits"]),
    bonusCredits: pickNumber(row, ["bonus_credits", "bonusCredits", "bonus"]),
    active: booleanValue(pickValue(row, ["active", "is_active", "enabled"]), true),
    metadata: isRecord(row.metadata) ? row.metadata : {},
    createdAt: pickNullableString(row, ["created_at", "createdAt", "stripe_created_at"]),
    updatedAt: pickNullableString(row, ["updated_at", "updatedAt", "synced_at", "syncedAt"]),
  };
}

function mapBillingPrice(row: Record<string, unknown>, productNames: Map<string, string>): AdminBillingPrice {
  const metadata = isRecord(row.metadata) ? row.metadata : {};
  const stripePriceId =
    pickString(row, ["stripe_price_id", "stripePriceId", "price_id", "priceId", "stripe_id", "stripeId"]) ||
    stringValue(row.id);
  const stripeProductId = pickString(row, ["stripe_product_id", "stripeProductId", "product_id", "productId"]);
  const recurringInterval = pickNullableString(row, ["recurring_interval", "recurringInterval", "interval", "billing_interval", "billingInterval"]);

  return {
    id: stringValue(row.id) || stripePriceId,
    stripePriceId,
    stripeProductId,
    productName: productNames.get(stripeProductId) || pickNullableString(row, ["product_name", "productName"]),
    nickname: pickNullableString(row, ["nickname", "name", "label"]),
    currency: normalizeCurrency(pickString(row, ["currency"]) || "usd"),
    unitAmount: pickNumber(row, ["unit_amount", "unitAmount", "amount", "amount_total", "amountTotal"]),
    recurringInterval,
    recurringIntervalCount: pickNumber(row, ["recurring_interval_count", "recurringIntervalCount", "interval_count", "intervalCount"]) || (recurringInterval ? 1 : 0),
    type: pickString(row, ["type", "price_type", "priceType"]) || (recurringInterval ? "recurring" : "one_time"),
    active: booleanValue(pickValue(row, ["active", "is_active", "enabled"]), true),
    credits: pickNumber(row, ["credits", "credit_amount", "creditAmount", "credits_granted", "creditsGranted"]) || numberValue(metadata.credits),
    createdAt: pickNullableString(row, ["created_at", "createdAt", "stripe_created_at"]),
  };
}

function mapBillingOrder(row: Record<string, unknown>, emails: Map<string, string>): AdminBillingOrder {
  const userId = pickNullableString(row, ["user_id", "userId"]);

  return {
    id: stringValue(row.id) || pickString(row, ["stripe_checkout_session_id", "stripeCheckoutSessionId", "checkout_session_id", "checkoutSessionId"]),
    userId,
    email: pickNullableString(row, ["email", "user_email", "userEmail", "customer_email", "customerEmail"]) || (userId ? emails.get(userId) || null : null),
    stripeCustomerId: pickNullableString(row, ["stripe_customer_id", "stripeCustomerId", "customer_id", "customerId"]),
    stripeCheckoutSessionId: pickNullableString(row, ["stripe_checkout_session_id", "stripeCheckoutSessionId", "checkout_session_id", "checkoutSessionId"]),
    stripePaymentIntentId: pickNullableString(row, ["stripe_payment_intent_id", "stripePaymentIntentId", "payment_intent_id", "paymentIntentId"]),
    amountTotal: pickNumber(row, ["amount_total", "amountTotal", "amount_paid", "amountPaid", "amount"]),
    currency: normalizeCurrency(pickString(row, ["currency"]) || "usd"),
    status: pickString(row, ["status", "payment_status", "paymentStatus"]) || "unknown",
    refundedAmount: pickNumber(row, ["refunded_amount", "refundedAmount", "amount_refunded", "amountRefunded"]),
    creditsGranted: pickNumber(row, ["credits_granted", "creditsGranted", "credits", "credit_amount", "creditAmount"]),
    createdAt: pickNullableString(row, ["created_at", "createdAt", "paid_at", "paidAt"]),
    updatedAt: pickNullableString(row, ["updated_at", "updatedAt", "synced_at", "syncedAt"]),
  };
}

function mapBillingSubscription(row: Record<string, unknown>, emails: Map<string, string>): AdminBillingSubscription {
  const userId = pickNullableString(row, ["user_id", "userId"]);
  const stripeSubscriptionId =
    pickString(row, ["stripe_subscription_id", "stripeSubscriptionId", "subscription_id", "subscriptionId", "stripe_id", "stripeId"]) ||
    stringValue(row.id);

  return {
    id: stringValue(row.id) || stripeSubscriptionId,
    userId,
    email: pickNullableString(row, ["email", "user_email", "userEmail", "customer_email", "customerEmail"]) || (userId ? emails.get(userId) || null : null),
    stripeCustomerId: pickNullableString(row, ["stripe_customer_id", "stripeCustomerId", "customer_id", "customerId"]),
    stripeSubscriptionId,
    stripePriceId: pickNullableString(row, ["stripe_price_id", "stripePriceId", "price_id", "priceId"]),
    status: pickString(row, ["status", "subscription_status", "subscriptionStatus"]) || "unknown",
    currentPeriodStart: pickNullableString(row, ["current_period_start", "currentPeriodStart"]),
    currentPeriodEnd: pickNullableString(row, ["current_period_end", "currentPeriodEnd"]),
    cancelAtPeriodEnd: booleanValue(pickValue(row, ["cancel_at_period_end", "cancelAtPeriodEnd"]), false),
    canceledAt: pickNullableString(row, ["canceled_at", "canceledAt", "cancelled_at", "cancelledAt"]),
    createdAt: pickNullableString(row, ["created_at", "createdAt"]),
    updatedAt: pickNullableString(row, ["updated_at", "updatedAt", "synced_at", "syncedAt"]),
  };
}

function mapBillingWebhookEvent(row: Record<string, unknown>): AdminBillingWebhookEvent {
  const stripeEventId =
    pickString(row, ["stripe_event_id", "stripeEventId", "event_id", "eventId", "stripe_id", "stripeId"]) ||
    stringValue(row.id);

  return {
    id: stringValue(row.id) || stripeEventId,
    stripeEventId,
    type: pickString(row, ["type", "event_type", "eventType"]) || "unknown",
    status: pickString(row, ["status", "processing_status", "processingStatus"]) || "received",
    attempts: pickNumber(row, ["attempts", "retry_count", "retryCount", "delivery_attempts", "deliveryAttempts"]),
    errorMessage: pickNullableString(row, ["error_message", "errorMessage", "last_error", "lastError"]),
    createdAt: pickNullableString(row, ["created_at", "createdAt", "received_at", "receivedAt"]),
    processedAt: pickNullableString(row, ["processed_at", "processedAt"]),
  };
}

function billingEnvStatus(key: string, label: string, value: unknown): AdminBillingConfigStatus {
  const configured = typeof value === "string" ? value.trim().length > 0 : Boolean(value);
  return {
    key,
    label,
    configured,
    scope: "env",
    statusHint: configured ? "configured" : "missing",
  };
}

function billingTableStatus(
  key: string,
  label: string,
  result: { data: unknown; count: number | null; error: string | null },
): AdminBillingConfigStatus {
  const configured = Array.isArray(result.data);
  const rowCount = Array.isArray(result.data) ? result.count ?? result.data.length : 0;
  return {
    key,
    label,
    configured,
    scope: "table",
    statusHint: configured ? `${rowCount} rows visible` : result.error || "not installed",
  };
}

function pickValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function pickString(row: Record<string, unknown>, keys: string[]) {
  return stringValue(pickValue(row, keys));
}

function pickNullableString(row: Record<string, unknown>, keys: string[]) {
  return nullableString(pickValue(row, keys));
}

function pickNumber(row: Record<string, unknown>, keys: string[]) {
  return numberValue(pickValue(row, keys));
}

function booleanValue(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "active", "enabled"].includes(normalized)) return true;
    if (["false", "0", "no", "inactive", "disabled"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeCurrency(value: string) {
  return value.trim().toUpperCase() || "USD";
}

function compareDateDesc(a: string | null | undefined, b: string | null | undefined) {
  const left = Date.parse(a || "");
  const right = Date.parse(b || "");
  return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
}

function toMajorCurrency(value: number) {
  return Math.round((value / 100) * 100) / 100;
}

async function countRows(query: CountQuery, label: string, warnings: string[], optional = false) {
  try {
    const response = await withTimeout(query, SHORT_QUERY_TIMEOUT_MS, `${label} timeout`) as {
      count?: number | null;
      error?: { message?: string; code?: string } | null;
    };
    const { count = null, error = null } = response;
    if (error) {
      if (!optional || !isMissingTableError(error)) warnings.push(`${label}: ${error.message || "query failed"}`);
      return 0;
    }
    return count || 0;
  } catch (error) {
    if (!optional) warnings.push(`${label}: ${toMessage(error)}`);
    return 0;
  }
}

async function countOptionalRows(query: CountQuery, label: string, warnings: string[]): Promise<number | null> {
  try {
    const response = await withTimeout(query, SHORT_QUERY_TIMEOUT_MS, `${label} timeout`) as {
      count?: number | null;
      error?: { message?: string; code?: string } | null;
    };
    const { count = null, error = null } = response;
    if (error) {
      if (!isMissingTableError(error)) warnings.push(`${label}: ${error.message || "query failed"}`);
      return null;
    }
    return count || 0;
  } catch (error) {
    warnings.push(`${label}: ${toMessage(error)}`);
    return null;
  }
}

async function runQuery<T>(
  query: SupabaseQuery,
  label: string,
  warnings: string[],
  optional = false,
): Promise<{ data: T | null; count: number | null; error: string | null }> {
  try {
    const response = await withTimeout(query, QUERY_TIMEOUT_MS, `${label} timeout`) as {
      data?: T | null;
      error?: { message?: string; code?: string } | null;
      count?: number | null;
    };
    const { data = null, error = null, count = null } = response;
    if (error) {
      if (!optional || !isMissingTableError(error)) warnings.push(`${label}: ${error.message || "query failed"}`);
      return { data: null, count: count ?? null, error: error.message || "query failed" };
    }
    return { data, count: count ?? null, error: null };
  } catch (error) {
    if (!optional) warnings.push(`${label}: ${toMessage(error)}`);
    return { data: null, count: null, error: toMessage(error) };
  }
}

function normalizeStatusFilter(value?: string): TaskStatusGroup | "" {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "queued" || normalized === "running" || normalized === "completed" || normalized === "failed") {
    return normalized;
  }
  return "";
}

function normalizeModuleFilter(value?: string) {
  const normalized = (value || "").trim();
  if (!normalized || normalized === "all") return "";
  return normalizeModule(normalized);
}

function normalizeTaskStatusGroup(status: string, resultCount = 0): TaskStatusGroup {
  const normalized = status.toLowerCase();
  if (normalized === "failed" || normalized === "timeout" || normalized === "cancelled" || normalized === "canceled") return "failed";
  if (normalized === "completed" || normalized === "success" || normalized === "succeeded" || resultCount > 0) return "completed";
  if (normalized === "queued" || normalized === "planned" || normalized === "needs_confirmation" || normalized === "confirmed" || normalized === "waiting_user") return "queued";
  if (normalized.startsWith("processing") || normalized === "running" || normalized === "generating" || normalized === "in_progress") return "running";
  return "queued";
}

export function moduleLabel(module: string) {
  const labels: Record<string, string> = {
    tryon: "服装上身",
    model: "专属模特",
    face: "换脸",
    faceSwap: "换脸",
    grass: "种草图",
    productSet: "商品套图",
    productRetouch: "商品精修",
    modelBackground: "模特换背景",
    garment3d: "服装 3D",
    generalImage: "通用生图",
    pose: "姿势裂变",
    imageTranslation: "图片翻译",
    materialEnhancement: "材质增强",
    allCategoryProductImage: "全品类商品图",
    outfitFusion: "搭配融图",
    video: "AI 视频",
    image: "图生图",
    unknown: "未知任务",
  };
  return labels[module] || module || "未知任务";
}

export function moduleRoute(module: string) {
  const routes: Record<string, string> = {
    tryon: "/create",
    model: "/model",
    face: "/face-swap",
    faceSwap: "/face-swap",
    grass: "/grass",
    productSet: "/product-set",
    productRetouch: "/product-retouch",
    modelBackground: "/model-background",
    garment3d: "/garment-3d",
    generalImage: "/general-image",
    pose: "/pose",
    imageTranslation: "/image-translation",
    materialEnhancement: "/material-enhancement",
    allCategoryProductImage: "/all-category-product-image",
    outfitFusion: "/outfit-fusion",
    video: "/video",
  };
  return routes[module] || "/history";
}

function inferModuleFromPayload(payload: Record<string, unknown>) {
  if (payload.poseMode || payload.mainImageUrl || payload.poseReferenceUrls) return "pose";
  if (payload.productImageUrls || payload.productSetMode) return "productSet";
  if (payload.productRetouchSources || payload.productRetouchMode || payload.batchId) return "productRetouch";
  if (payload.backgroundMode || payload.backgroundReferenceUrl) return "modelBackground";
  if (payload.garmentUrl && (payload.templateId || payload.changeModel)) return "grass";
  if (payload.garmentUrl) return "garment3d";
  if (payload.sourceUrl && payload.faceUrl) return "faceSwap";
  if (payload.referenceUrls && payload.gender) return "model";
  if (payload.mode && payload.prompt) return "generalImage";
  if (payload.clothingUrls || payload.clothingUrl) return "tryon";
  return "tryon";
}

function inferExpectedCount(payload: Record<string, unknown>, resultCount: number) {
  return Math.max(
    1,
    numberValue(payload.imageCount) ||
      numberValue(payload.genCount) ||
      numberValue(payload.count) ||
      numberValue(payload.n) ||
      resultCount ||
      1,
  );
}

function readGenerationBillingCredits(row: Record<string, unknown>, statusGroup: TaskStatusGroup) {
  const used = Math.max(0, numberValue(row.credits_used));
  const reserved = Math.max(0, numberValue(row.credits_cost));
  if (statusGroup === "failed") return 0;
  if (statusGroup === "completed") return used || reserved;
  return reserved;
}

function buildGenerationAdminResponse(row: Record<string, unknown>, routeAttempts: Array<Record<string, unknown>>) {
  const payload = isRecord(row.job_payload) ? row.job_payload : {};
  return {
    status: stringValue(row.status),
    errorMessage: nullableString(row.error_message),
    resultUrls: arrayOfStrings(row.result_urls),
    completedAt: nullableString(row.completed_at),
    updatedAt: nullableString(row.updated_at),
    queueReason: nullableString(row.queue_reason),
    nextAttemptAt: nullableString(row.available_at),
    capacityDeferCount: Math.max(0, numberValue(row.capacity_defer_count)),
    deliveryVersion: Math.max(0, numberValue(row.delivery_version)),
    asyncTask: isRecord(payload.asyncTask) ? payload.asyncTask : null,
    partialFailure: isRecord(payload.partialFailure) ? payload.partialFailure : null,
    routeAttempts,
  };
}

function buildQueueAdminResponse(queueItem: AdminTaskListItem | null) {
  if (!queueItem) return {};
  return {
    status: queueItem.status,
    errorMessage: queueItem.errorMessage,
    resultUrls: queueItem.resultThumbnails,
    completedAt: queueItem.completedAt,
    updatedAt: queueItem.updatedAt,
  };
}

function inferInputThumbnails(row: Record<string, unknown>, payload: Record<string, unknown>) {
  return uniqueStrings([
    ...arrayOfStrings(payload.clothingUrls),
    ...arrayOfStrings(payload.referenceUrls),
    ...arrayOfStrings(payload.productImageUrls),
    ...arrayOfStrings(payload.poseReferenceUrls),
    ...arrayOfStrings(payload.sceneImages),
    ...arrayOfStrings(payload.inputUrls),
    ...arrayOfStrings(row.clothing_urls),
    stringValue(payload.clothingUrl),
    stringValue(payload.referenceUrl),
    stringValue(payload.modelFaceUrl),
    stringValue(payload.sourceUrl),
    stringValue(payload.faceUrl),
    stringValue(payload.mainImageUrl),
    stringValue(payload.garmentUrl),
    stringValue(payload.backgroundReferenceUrl),
    stringValue(row.model_face_url),
    stringValue(row.reference_url),
  ]).slice(0, 6);
}

function inferAdminGeneralImageMode(module: string, modeOrApplyUrl: string, inputThumbnails: string[]) {
  if (module !== "generalImage") return null;
  const value = modeOrApplyUrl.toLowerCase();
  if (value.includes("image-to-image")) return "image-to-image" as const;
  if (value.includes("text-to-image")) return "text-to-image" as const;
  return inputThumbnails.length > 0 ? "image-to-image" as const : "text-to-image" as const;
}

function readAsyncTask(payload: Record<string, unknown>) {
  const asyncTask = isRecord(payload.asyncTask) ? payload.asyncTask : {};
  return {
    progress: numberValue(asyncTask.progress),
    status: stringValue(asyncTask.status),
  };
}

function extractUrls(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return isUrl(value) ? [value] : [];
  if (Array.isArray(value)) return uniqueStrings(value.flatMap(extractUrls));
  if (!isRecord(value)) return [];
  return uniqueStrings([
    stringValue(value.url),
    stringValue(value.imageUrl),
    stringValue(value.outputUrl),
    stringValue(value.resultUrl),
    stringValue(value.selectedImageUrl),
    ...arrayOfStrings(value.urls),
    ...arrayOfStrings(value.images),
    ...arrayOfStrings(value.imageUrls),
    ...arrayOfStrings(value.resultUrls),
    ...arrayOfStrings(value.outputUrls),
  ]);
}

function matchesTaskSearch(row: AdminTaskListItem, q: string) {
  return [
    row.id,
    row.sourceId,
    row.userId,
    row.module,
    row.moduleLabel,
    row.title,
    row.status,
    row.errorMessage || "",
  ].some((value) => value.toLowerCase().includes(q));
}

function clampLimit(value: unknown, min: number, max: number, fallback: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function clampProgress(value: unknown) {
  const progress = numberValue(value);
  if (progress <= 0) return 0;
  if (progress >= 100) return 100;
  return Math.round(progress);
}

function staleTaskMeta(statusGroup: TaskStatusGroup, createdAt: string | null, updatedAt: string | null, resultCount: number) {
  const base = updatedAt || createdAt;
  const time = base ? Date.parse(base) : NaN;
  const staleMinutes = Number.isFinite(time) ? Math.max(0, Math.floor((Date.now() - time) / 60000)) : 0;
  const running = statusGroup === "queued" || statusGroup === "running";
  return {
    isStale: running && resultCount <= 0 && staleMinutes >= ADMIN_STALE_TASK_MINUTES,
    staleMinutes,
  };
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown): string | null {
  const str = stringValue(value);
  return str || null;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function isUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:image/");
}

function isMissingTableError(error: { code?: string; message?: string }) {
  const message = `${error.code || ""} ${error.message || ""}`.toLowerCase();
  return (
    message.includes("42p01") ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("pgrst")
  );
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
