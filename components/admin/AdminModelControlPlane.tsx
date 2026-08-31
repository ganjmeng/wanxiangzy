"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Boxes,
  CheckCircle2,
  CircuitBoard,
  Gauge,
  History,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  TestTube2,
  Trash2,
  UploadCloud,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { RawPreviewImage } from "@/components/studio/RawPreviewImage";
import {
  AdminMetricCard,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
  AdminStatusBadge,
} from "@/components/admin/AdminPrimitives";
import type {
  AiControlPlaneIssue,
  AiControlPlanePublicConfig,
  AiLogicalModel,
  AiModelPresentation,
  AiModelDeployment,
  AiModality,
  AiProviderMetric,
  AiProviderProtocol,
  AiRoutingPolicy,
} from "@/lib/ai-control-plane/types";
import { AI_PROTOCOL_ADAPTERS } from "@/lib/ai-control-plane/adapters";
import {
  DEFAULT_DEPLOYMENT_BURST,
  DEFAULT_DEPLOYMENT_MAX_CONCURRENCY,
  DEFAULT_DEPLOYMENT_REQUESTS_PER_MINUTE,
} from "@/lib/ai-control-plane/config";

type DraftProvider = AiControlPlanePublicConfig["providers"][number] & { apiKey?: string };
type DraftConfig = Omit<AiControlPlanePublicConfig, "providers"> & { providers: DraftProvider[] };
type Health = {
  deploymentId: string;
  circuitState: "closed" | "open" | "half_open";
  consecutiveFailures: number;
  sampleCount: number;
  ewmaSuccessRate: number;
  ewmaLatencyMs: number;
  openedUntil?: string | null;
  rateLimitedUntil?: string | null;
};
type Version = { id: string; status: string; created_by?: string | null; published_at?: string | null; created_at: string };
type Snapshot = {
  configKey: string;
  versionId?: string;
  publishedAt?: string | null;
  source: "unified" | "legacy" | "missing";
  config: DraftConfig;
  issues: AiControlPlaneIssue[];
  health: Record<string, Health>;
  metrics: AiProviderMetric[];
  inFlight: Record<string, number>;
  capacityBackend?: { requestedMode: "redis" | "local"; activeMode: "redis" | "local"; distributed: boolean; configured?: boolean; failClosed?: boolean };
  generationQueue?: {
    mode: string;
    redisConfigured: boolean;
    bullmqConfigured: boolean;
    bullmq: {
      configured: boolean;
      reachable: boolean;
      latencyMs: number | null;
      workers: number;
      paused: boolean | null;
      counts: {
        waiting: number;
        active: number;
        delayed: number;
        failed: number;
      };
    };
    outbox: null | {
      pendingCount: number;
      publishingCount: number;
      publishedCount: number;
      deadCount: number;
      oldestPendingAgeSeconds: number;
    };
    outboxError?: boolean;
    ossMirror?: {
      configured: boolean;
      reachable: boolean;
      latencyMs: number | null;
      counts: {
        pending: number;
        processing: number;
        completed: number;
        failed: number;
        staleProcessing: number;
      };
      oldestPendingAgeSeconds: number;
      oldestProcessingAgeSeconds: number;
      lastRecoveredAt: string | null;
      lastCompletedAt: string | null;
      error: string | null;
    };
    mediaValidation?: null | {
      pendingCount: number;
      processingCount: number;
      completedCount: number;
      deadCount: number;
      staleProcessingCount: number;
      uploadedWithoutJobCount: number;
      oldestPendingAgeSeconds: number;
    };
    mediaValidationError?: boolean;
    mediaAssets?: null | {
      pendingCount: number;
      uploadedCount: number;
      verifiedCount: number;
      quarantinedCount: number;
      deletedCount: number;
      cleanupReadyCount: number;
      expiredLeaseCount: number;
      oldestPendingAgeSeconds: number;
      oldestCleanupReadyAgeSeconds: number;
    };
    mediaAssetsError?: boolean;
  };
  versions: Version[];
};

const TABS = [
  ["overview", "运行总览", Activity],
  ["models", "模型目录", Boxes],
  ["providers", "供应商", ServerCog],
  ["routing", "路由与容量", SlidersHorizontal],
  ["metrics", "调用指标", Gauge],
  ["versions", "版本与回滚", History],
] as const;
type TabKey = (typeof TABS)[number][0];

const MODALITIES: Array<{ value: AiModality; label: string }> = [
  { value: "image", label: "图片" },
  { value: "text", label: "文本" },
  { value: "vision", label: "视觉" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
  { value: "embedding", label: "向量" },
];
const PROTOCOLS: Array<{ value: AiProviderProtocol; label: string }> = Object.values(AI_PROTOCOL_ADAPTERS).map((adapter) => ({ value: adapter.id, label: adapter.label }));

export function AdminModelControlPlane({ canManage = false }: { canManage?: boolean }) {
  const { confirm, confirmDialog } = useConfirm();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<DraftConfig | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [issues, setIssues] = useState<AiControlPlaneIssue[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/model-control?hours=24", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `加载失败 (${response.status})`);
      setSnapshot(payload);
      setDraft(payload.config);
      setIssues(payload.issues || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模型控制台加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(() => {
    if (!snapshot || !draft) return false;
    return JSON.stringify(stripTransient(draft)) !== JSON.stringify(stripTransient(snapshot.config));
  }, [draft, snapshot]);

  async function submit(action: "validate" | "save-draft" | "publish") {
    if (!canManage || !draft) return;
    setSaving(action);
    try {
      const response = await fetch("/api/admin/model-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, config: toServerConfig(draft) }),
      });
      const payload = await response.json().catch(() => ({}));
      setIssues(payload.issues || []);
      if (!response.ok) throw new Error(payload.error || firstError(payload.issues) || `${action} 失败`);
      if (action === "validate") {
        toast.success("配置校验通过，可保存草稿或发布");
        return;
      }
      toast.success(action === "publish" ? "统一模型配置已发布" : "草稿已保存");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setSaving(null);
    }
  }

  function publish() {
    if (!canManage) return;
    void confirm({
      title: "确认发布统一模型配置？",
      content: "发布后新任务会立即使用新的模型、供应商池和路由策略。现有运行中任务不切换通道。",
      okText: "确认发布",
      onOk: () => submit("publish"),
    });
  }

  async function rollback(version: Version) {
    if (!canManage) return;
    void confirm({
      title: "确认回滚模型配置？",
      content: `系统会复制 ${formatTime(version.published_at || version.created_at)} 的配置并发布为新版本，历史记录不会被覆盖。`,
      okText: "确认回滚",
      onOk: async () => {
        setSaving(`rollback:${version.id}`);
        try {
          const response = await fetch("/api/admin/model-control", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "rollback", versionId: version.id }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || "回滚失败");
          toast.success("已发布回滚版本");
          await load();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "回滚失败");
        } finally {
          setSaving(null);
        }
      },
    });
  }

  async function testProvider(provider: DraftProvider) {
    if (!canManage || !draft) return;
    const deployment = draft.deployments.find((item) => item.providerId === provider.id && item.enabled)
      || draft.deployments.find((item) => item.providerId === provider.id);
    const protocol = deployment?.protocol || "openai-chat";
    setTestingProvider(provider.id);
    try {
      const response = await fetch("/api/admin/model-control/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: provider.id,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          protocol,
          upstreamModel: deployment?.upstreamModel,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "连接测试失败");
      toast.success(payload.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "连接测试失败");
    } finally {
      setTestingProvider(null);
    }
  }

  if (loading || !draft || !snapshot) {
    return <div className="flex min-h-[420px] items-center justify-center text-sm font-bold text-[var(--admin-muted)]"><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />正在加载模型控制平面…</div>;
  }

  const successful = snapshot.metrics.reduce((sum, item) => sum + item.successCount, 0);
  const attempts = snapshot.metrics.reduce((sum, item) => sum + item.requestCount, 0);
  const p95Values = snapshot.metrics.map((item) => item.p95LatencyMs).filter((value): value is number => value !== null);
  const openCircuits = Object.values(snapshot.health).filter((item) => item.circuitState === "open").length;
  const queueHealth = snapshot.generationQueue?.outbox;
  const bullmqHealth = snapshot.generationQueue?.bullmq;
  const ossMirrorHealth = snapshot.generationQueue?.ossMirror;
  const ossMirrorEnabled = ossMirrorHealth?.configured ?? false;
  const mediaValidationHealth = snapshot.generationQueue?.mediaValidation;
  const mediaAssetHealth = snapshot.generationQueue?.mediaAssets;

  return (
    <>
      {confirmDialog}
      <AdminPageHeader
        eyebrow="AI CONTROL PLANE"
        title="统一模型控制台"
        description="集中管理图片、文本、视觉、视频等逻辑模型，以及多供应商池、容量保护、智能路由、故障兜底和调用质量。"
        actions={(
          <>
            <button type="button" onClick={() => void load()} className={secondaryButton}><RefreshCw className="h-4 w-4" />刷新</button>
            {canManage && <>
              <button type="button" onClick={() => void submit("validate")} disabled={Boolean(saving)} className={secondaryButton}>{saving === "validate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}校验</button>
              <button type="button" onClick={() => void submit("save-draft")} disabled={Boolean(saving)} className={secondaryButton}><Save className="h-4 w-4" />保存草稿</button>
              <button type="button" onClick={publish} disabled={Boolean(saving)} className={primaryButton}>{saving === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}发布</button>
            </>}
          </>
        )}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <AdminStatusBadge status={snapshot.versionId ? "published" : "draft"} />
        <span className="text-xs font-bold text-[var(--admin-muted)]">来源：{snapshot.source === "unified" ? "统一配置" : snapshot.source === "legacy" ? "旧配置兼容层（建议发布迁移）" : "初始化模板"}</span>
        <span className="text-xs font-bold text-[var(--admin-muted)]">版本：{snapshot.versionId?.slice(0, 8) || "未发布"}</span>
        {dirty && <span className="rounded-md border border-[var(--admin-warning-border)] bg-[var(--admin-warning-soft)] px-2 py-1 text-xs font-black text-[var(--admin-warning)]">有未保存修改</span>}
      </div>

      {issues.length > 0 && (
        <AdminNotice tone={issues.some((item) => item.severity === "error") ? "warning" : "info"}>
          <div className="space-y-1">
            <p className="font-black">发布校验发现 {issues.length} 项：</p>
            {issues.slice(0, 6).map((issue, index) => <p key={`${issue.path}-${index}`}><code>{issue.path}</code> — {issue.message}</p>)}
          </div>
        </AdminNotice>
      )}

      {!canManage && (
        <AdminNotice tone="info">
          当前角色为只读访问。你可以查看模型、供应商、容量、指标和版本记录；配置变更、连接测试与回滚需要平台治理权限。
        </AdminNotice>
      )}

      {!snapshot.capacityBackend?.distributed && (
        <AdminNotice tone="warning">
          {snapshot.capacityBackend?.requestedMode === "local"
            ? <>当前容量保护为本地进程模式，仅适合隔离开发测试，无法跨 Web 与 Worker 统一计算并发/RPM。</>
            : <>Redis 容量后端未就绪，供应商调用将 fail-closed 并留在 BullMQ 队列重试。请检查服务端 <code>REDIS_URL</code> 和 Redis 连通性。</>}
        </AdminNotice>
      )}

      <div className="mb-4 mt-4 overflow-x-auto rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-1" role="tablist" aria-label="模型控制台分区">
        <div className="flex min-w-max gap-1">
          {TABS.map(([key, label, Icon]) => (
            <button key={key} type="button" role="tab" aria-selected={activeTab === key} onClick={() => setActiveTab(key)} className={`inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-black transition-colors motion-reduce:transition-none ${activeTab === key ? "bg-[var(--admin-fg)] text-[var(--admin-surface)]" : "text-[var(--admin-muted)] hover:bg-[var(--admin-surface-soft)] hover:text-[var(--admin-fg)]"}`}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "overview" && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <AdminMetricCard label="24h 调用" value={attempts} hint={`${draft.models.filter((item) => item.enabled).length} 个启用模型`} icon={<Zap className="h-4 w-4" />} />
            <AdminMetricCard label="成功率" value={attempts ? `${((successful / attempts) * 100).toFixed(2)}%` : "—"} tone={attempts && successful / attempts < 0.95 ? "warning" : "good"} hint="按供应商尝试统计" icon={<CheckCircle2 className="h-4 w-4" />} />
            <AdminMetricCard label="P95 耗时" value={p95Values.length ? formatDuration(Math.max(...p95Values)) : "—"} hint="24 小时最慢部署 P95" icon={<Gauge className="h-4 w-4" />} />
            <AdminMetricCard label="已熔断通道" value={openCircuits} tone={openCircuits ? "danger" : "good"} hint={`${draft.deployments.filter((item) => item.enabled).length} 个启用部署`} icon={<CircuitBoard className="h-4 w-4" />} />
          </div>
          <AdminSection title="BullMQ 与 Outbox 健康" description="这里只展示配置状态和聚合计数，不返回或记录 Redis 地址与凭据。">
            <div className="grid gap-3 border-b border-[var(--admin-border)] p-4 sm:grid-cols-2 xl:grid-cols-5">
              <AdminMetricCard
                label="BullMQ 可达性"
                value={bullmqHealth?.reachable ? "可达" : "不可达"}
                tone={bullmqHealth?.reachable ? "good" : "danger"}
                hint={`延迟：${bullmqHealth?.latencyMs == null ? "—" : `${bullmqHealth.latencyMs}ms`}；Worker：${bullmqHealth?.workers ?? 0}`}
                icon={<ServerCog className="h-4 w-4" />}
              />
              <AdminMetricCard label="BullMQ 等待" value={bullmqHealth?.counts.waiting ?? "—"} tone={(bullmqHealth?.counts.waiting || 0) > 0 ? "warning" : "good"} hint="waiting" icon={<Boxes className="h-4 w-4" />} />
              <AdminMetricCard label="BullMQ 执行中" value={bullmqHealth?.counts.active ?? "—"} hint={`active；${bullmqHealth?.workers ?? 0} 个 Worker`} icon={<Activity className="h-4 w-4" />} />
              <AdminMetricCard label="BullMQ 延迟" value={bullmqHealth?.counts.delayed ?? "—"} hint="delayed" icon={<Gauge className="h-4 w-4" />} />
              <AdminMetricCard label="BullMQ 失败" value={bullmqHealth?.counts.failed ?? "—"} tone={(bullmqHealth?.counts.failed || 0) > 0 ? "danger" : "good"} hint={bullmqHealth?.paused ? "队列已暂停" : "failed"} icon={<CircuitBoard className="h-4 w-4" />} />
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
              <AdminMetricCard
                label="Redis / BullMQ"
                value={snapshot.generationQueue?.bullmqConfigured ? "已配置" : "未就绪"}
                tone={snapshot.generationQueue?.bullmqConfigured ? "good" : "danger"}
                hint={`模式：${snapshot.generationQueue?.mode || "未知"}；Redis：${snapshot.generationQueue?.redisConfigured ? "已配置" : "缺失"}`}
                icon={<ServerCog className="h-4 w-4" />}
              />
              <AdminMetricCard label="待发布" value={queueHealth?.pendingCount ?? "—"} tone={(queueHealth?.pendingCount || 0) > 0 ? "warning" : "good"} hint="事务 Outbox pending" icon={<Boxes className="h-4 w-4" />} />
              <AdminMetricCard label="发布中" value={queueHealth?.publishingCount ?? "—"} hint="持有发布租约" icon={<Activity className="h-4 w-4" />} />
              <AdminMetricCard label="死信" value={queueHealth?.deadCount ?? "—"} tone={(queueHealth?.deadCount || 0) > 0 ? "danger" : "good"} hint={`累计已发布 ${queueHealth?.publishedCount ?? "—"}`} icon={<CircuitBoard className="h-4 w-4" />} />
              <AdminMetricCard label="最老待发布" value={queueHealth ? formatDuration(queueHealth.oldestPendingAgeSeconds * 1000) : "—"} tone={(queueHealth?.oldestPendingAgeSeconds || 0) > 60 ? "warning" : "good"} hint="持续增长表示 Relay 堵塞" icon={<Gauge className="h-4 w-4" />} />
            </div>
            {snapshot.generationQueue?.outboxError && (
              <p className="border-t border-[var(--admin-border)] px-4 py-3 text-xs font-bold text-[var(--admin-warning)]">Outbox 健康 RPC 不可用，请确认 BullMQ migration 已应用。</p>
            )}
          </AdminSection>
          <AdminSection title="OSS 镜像 Outbox 健康" description="生成结果回源到阿里云 OSS 镜像队列的状态；不会返回密钥、地址或 Object Key。">
            <div className="grid gap-3 border-b border-[var(--admin-border)] p-4 sm:grid-cols-2 xl:grid-cols-5">
              <AdminMetricCard
                label="OSS 镜像可用"
                value={ossMirrorEnabled ? (ossMirrorHealth?.reachable ? "可达" : "不可达") : "未启用"}
                tone={!ossMirrorEnabled ? "neutral" : ossMirrorHealth?.reachable ? "good" : "danger"}
                hint={!ossMirrorEnabled
                  ? "需要 ALIYUN_OSS_MIRROR_ENABLED=true 才会启用"
                  : `延迟：${ossMirrorHealth?.latencyMs == null ? "—" : `${ossMirrorHealth.latencyMs}ms`}`}
                icon={<ServerCog className="h-4 w-4" />}
              />
              <AdminMetricCard
                label="OSS 待发布"
                value={ossMirrorHealth?.counts.pending ?? "—"}
                tone={(ossMirrorHealth?.counts.pending || 0) > 0 ? "warning" : "good"}
                hint="镜像队列 pending"
                icon={<Boxes className="h-4 w-4" />}
              />
              <AdminMetricCard
                label="OSS 处理中"
                value={ossMirrorHealth?.counts.processing ?? "—"}
                hint={`持有租约 ${ossMirrorHealth?.counts.processing ?? 0}`}
                icon={<Activity className="h-4 w-4" />}
              />
              <AdminMetricCard
                label="OSS 过期租约"
                value={ossMirrorHealth?.counts.staleProcessing ?? "—"}
                tone={(ossMirrorHealth?.counts.staleProcessing || 0) > 0 ? "danger" : "good"}
                hint="lease 已超时，等待恢复回收"
                icon={<CircuitBoard className="h-4 w-4" />}
              />
              <AdminMetricCard
                label="OSS 失败"
                value={ossMirrorHealth?.counts.failed ?? "—"}
                tone={(ossMirrorHealth?.counts.failed || 0) > 0 ? "danger" : "good"}
                hint={`累计完成 ${ossMirrorHealth?.counts.completed ?? "—"}`}
                icon={<ShieldCheck className="h-4 w-4" />}
              />
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              <AdminMetricCard
                label="最老待发布"
                value={ossMirrorHealth ? formatDuration((ossMirrorHealth.oldestPendingAgeSeconds || 0) * 1000) : "—"}
                tone={(ossMirrorHealth?.oldestPendingAgeSeconds || 0) > 60 ? "warning" : "good"}
                hint="增长表示 Worker/RPC 堵塞"
                icon={<Gauge className="h-4 w-4" />}
              />
              <AdminMetricCard
                label="最近完成"
                value={formatRelativeTime(ossMirrorHealth?.lastCompletedAt)}
                hint="镜像写 OSS 时间"
                icon={<History className="h-4 w-4" />}
              />
              <AdminMetricCard
                label="最近恢复"
                value={formatRelativeTime(ossMirrorHealth?.lastRecoveredAt)}
                hint="过期租约回收时间"
                icon={<RefreshCw className="h-4 w-4" />}
              />
            </div>
            {ossMirrorHealth?.error && (
              <p className="border-t border-[var(--admin-border)] px-4 py-3 text-xs font-bold text-[var(--admin-warning)]">OSS 镜像健康 RPC 异常：{ossMirrorHealth.error}</p>
            )}
          </AdminSection>
          <AdminSection title="媒体安全验证与资产生命周期" description="上排是视频安全验证流水线，下排是私有媒体资产账本；仅展示聚合计数与等待时长，不返回 Bucket、Object Key 或签名 URL。">
            <div className="grid gap-3 border-b border-[var(--admin-border)] p-4 sm:grid-cols-2 xl:grid-cols-5">
              <AdminMetricCard
                label="待安全验证"
                value={mediaValidationHealth?.pendingCount ?? "—"}
                tone={(mediaValidationHealth?.pendingCount || 0) > 0 ? "warning" : "good"}
                hint={`最老 ${mediaValidationHealth ? formatDuration(mediaValidationHealth.oldestPendingAgeSeconds * 1000) : "—"}`}
                icon={<ShieldCheck className="h-4 w-4" />}
              />
              <AdminMetricCard
                label="验证处理中"
                value={mediaValidationHealth?.processingCount ?? "—"}
                tone={(mediaValidationHealth?.staleProcessingCount || 0) > 0 ? "danger" : "neutral"}
                hint={`过期租约 ${mediaValidationHealth?.staleProcessingCount ?? "—"}`}
                icon={<Activity className="h-4 w-4" />}
              />
              <AdminMetricCard
                label="验证死信"
                value={mediaValidationHealth?.deadCount ?? "—"}
                tone={(mediaValidationHealth?.deadCount || 0) > 0 ? "danger" : "good"}
                hint={`累计完成 ${mediaValidationHealth?.completedCount ?? "—"}`}
                icon={<CircuitBoard className="h-4 w-4" />}
              />
              <AdminMetricCard
                label="缺失验证任务"
                value={mediaValidationHealth?.uploadedWithoutJobCount ?? "—"}
                tone={(mediaValidationHealth?.uploadedWithoutJobCount || 0) > 0 ? "danger" : "good"}
                hint="uploaded_without_job"
                icon={<Boxes className="h-4 w-4" />}
              />
              <AdminMetricCard
                label="最老待验证"
                value={mediaValidationHealth ? formatDuration(mediaValidationHealth.oldestPendingAgeSeconds * 1000) : "—"}
                tone={(mediaValidationHealth?.oldestPendingAgeSeconds || 0) > 120 ? "warning" : "good"}
                hint="持续增长表示验证 Worker 堵塞"
                icon={<Gauge className="h-4 w-4" />}
              />
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
              <AdminMetricCard
                label="资产待上传"
                value={mediaAssetHealth?.pendingCount ?? "—"}
                tone={(mediaAssetHealth?.oldestPendingAgeSeconds || 0) > 600 ? "warning" : "neutral"}
                hint={`最老 ${mediaAssetHealth ? formatDuration(mediaAssetHealth.oldestPendingAgeSeconds * 1000) : "—"}`}
                icon={<UploadCloud className="h-4 w-4" />}
              />
              <AdminMetricCard
                label="待完整验证"
                value={mediaAssetHealth?.uploadedCount ?? "—"}
                tone={(mediaAssetHealth?.uploadedCount || 0) > 0 ? "warning" : "good"}
                hint={`已验证 ${mediaAssetHealth?.verifiedCount ?? "—"}`}
                icon={<ShieldCheck className="h-4 w-4" />}
              />
              <AdminMetricCard
                label="已隔离资产"
                value={mediaAssetHealth?.quarantinedCount ?? "—"}
                tone={(mediaAssetHealth?.quarantinedCount || 0) > 0 ? "danger" : "good"}
                hint={`累计删除 ${mediaAssetHealth?.deletedCount ?? "—"}`}
                icon={<CircuitBoard className="h-4 w-4" />}
              />
              <AdminMetricCard
                label="待清理资产"
                value={mediaAssetHealth?.cleanupReadyCount ?? "—"}
                tone={(mediaAssetHealth?.cleanupReadyCount || 0) > 0 ? "warning" : "good"}
                hint={`最老 ${mediaAssetHealth ? formatDuration(mediaAssetHealth.oldestCleanupReadyAgeSeconds * 1000) : "—"}`}
                icon={<Trash2 className="h-4 w-4" />}
              />
              <AdminMetricCard
                label="资产过期租约"
                value={mediaAssetHealth?.expiredLeaseCount ?? "—"}
                tone={(mediaAssetHealth?.expiredLeaseCount || 0) > 0 ? "danger" : "good"}
                hint="上传或清理租约等待恢复"
                icon={<RefreshCw className="h-4 w-4" />}
              />
            </div>
            {(snapshot.generationQueue?.mediaValidationError || snapshot.generationQueue?.mediaAssetsError) && (
              <p className="border-t border-[var(--admin-border)] px-4 py-3 text-xs font-bold text-[var(--admin-warning)]">媒体健康 RPC 不可用，请确认媒体资产 migration 已应用并检查数据库连通性。</p>
            )}
          </AdminSection>
          <AdminSection title="路由工作方式" description="优先级、同级池与自动兜底分层执行，不会相互冲突。">
            <div className="grid gap-3 p-4 lg:grid-cols-4">
              {[
                ["1", "候选过滤", "按模态、能力、启用状态、熔断和限流冷却筛选。"],
                ["2", "优先级分层", "数字越小越优先；同数字组成一个供应商池。"],
                ["3", "池内分配", "稳定模式按权重分流；智能模式综合成功率、延迟、成本与容量。"],
                ["4", "跨层兜底", "仅对可重试错误切换下一供应商，参数错误不会盲目重试。"],
              ].map(([step, title, description]) => (
                <div key={step} className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-soft)] p-3">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[var(--admin-fg)] text-xs font-black text-[var(--admin-surface)]">{step}</span>
                  <p className="mt-3 text-sm font-black text-[var(--admin-fg)]">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--admin-muted)]">{description}</p>
                </div>
              ))}
            </div>
          </AdminSection>
        </div>
      )}

      {activeTab === "models" && (canManage ? <ModelsEditor config={draft} onChange={setDraft} /> : <ReadOnlyConfigurationPanel tab="models" config={draft} health={snapshot.health} inFlight={snapshot.inFlight} />)}
      {activeTab === "providers" && (canManage ? <ProvidersEditor config={draft} onChange={setDraft} testingProvider={testingProvider} onTest={testProvider} /> : <ReadOnlyConfigurationPanel tab="providers" config={draft} health={snapshot.health} inFlight={snapshot.inFlight} />)}
      {activeTab === "routing" && (canManage ? <RoutingEditor config={draft} onChange={setDraft} health={snapshot.health} inFlight={snapshot.inFlight} /> : <ReadOnlyConfigurationPanel tab="routing" config={draft} health={snapshot.health} inFlight={snapshot.inFlight} />)}
      {activeTab === "metrics" && <MetricsPanel config={draft} metrics={snapshot.metrics} health={snapshot.health} />}
      {activeTab === "versions" && <VersionsPanel versions={snapshot.versions} currentId={snapshot.versionId} saving={saving} onRollback={rollback} canManage={canManage} />}
    </>
  );
}

function ModelsEditor({ config, onChange }: { config: DraftConfig; onChange: (value: DraftConfig) => void }) {
  function add() {
    const id = nextId("model", config.models.map((item) => item.id));
    onChange({ ...config, models: [...config.models, { id, displayName: "新模型", modality: "image", enabled: false, userVisible: false, capabilities: ["generation"], defaultRoutingMode: "stable", creditPrices: { "1K": 4, "2K": 6, "4K": 8 }, presentation: { sortOrder: 100, featured: false, tags: [] } }] });
  }
  function update(index: number, patch: Partial<AiLogicalModel>) {
    const previousId = config.models[index].id;
    const nextId = patch.id ?? previousId;
    onChange({
      ...config,
      models: config.models.map((item, itemIndex) => {
        const next = itemIndex === index ? { ...item, ...patch } : item;
        return nextId !== previousId && next.compatibleFallbackModelIds?.includes(previousId)
          ? { ...next, compatibleFallbackModelIds: next.compatibleFallbackModelIds.map((id) => id === previousId ? nextId : id) }
          : next;
      }),
      deployments: nextId === previousId
        ? config.deployments
        : config.deployments.map((item) => item.modelId === previousId ? { ...item, modelId: nextId } : item),
    });
  }
  function remove(index: number) {
    const id = config.models[index].id;
    if (config.deployments.some((item) => item.modelId === id)) return toast.error("请先删除引用该模型的部署");
    onChange({ ...config, models: config.models.filter((_, itemIndex) => itemIndex !== index) });
  }
  return (
    <AdminSection title="逻辑模型目录" description="用户选择的是逻辑模型；供应商和精确上游模型名称由部署映射决定。" actions={<button type="button" onClick={add} className={secondaryButton}><Plus className="h-4 w-4" />新增模型</button>}>
      <div className="grid gap-3 p-4 xl:grid-cols-2">
        {config.models.map((model, index) => (
          <article key={`${model.id}-${index}`} className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="flex items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-xs font-black text-[var(--admin-fg)]"><input type="checkbox" checked={model.enabled} onChange={(event) => update(index, { enabled: event.target.checked })} />启用</label>
              <button type="button" onClick={() => remove(index)} className={iconButton} aria-label={`删除 ${model.displayName}`}><Trash2 className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="模型 ID"><input className={inputClass} value={model.id} onChange={(event) => update(index, { id: event.target.value.trim() })} /></Field>
              <Field label="显示名称"><input className={inputClass} value={model.displayName} onChange={(event) => update(index, { displayName: event.target.value })} /></Field>
              <Field label="模态"><select className={inputClass} value={model.modality} onChange={(event) => update(index, { modality: event.target.value as AiModality })}>{MODALITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
              <Field label="默认路由"><select className={inputClass} value={model.defaultRoutingMode} onChange={(event) => update(index, { defaultRoutingMode: event.target.value === "smart" ? "smart" : "stable" })}><option value="stable">稳定路由</option><option value="smart">智能路由</option></select></Field>
            </div>
            <Field label="能力标签（逗号分隔）"><input className={inputClass} value={model.capabilities.join(", ")} onChange={(event) => update(index, { capabilities: csv(event.target.value) })} placeholder="generation, edit, vision" /></Field>
            <Field label="说明（展示给用户）"><textarea className={`${inputClass} min-h-20 resize-y`} value={model.description || ""} onChange={(event) => update(index, { description: event.target.value })} placeholder="适合电商精修、文字渲染等" /></Field>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="前端短标题"><input className={inputClass} value={model.presentation?.shortTitle || ""} onChange={(event) => update(index, { presentation: { ...(model.presentation || {}), shortTitle: event.target.value } })} placeholder="香蕉 2" /></Field>
              <Field label="徽标文案"><input className={inputClass} value={model.presentation?.badge || ""} onChange={(event) => update(index, { presentation: { ...(model.presentation || {}), badge: event.target.value } })} placeholder="推荐 / PRO / NEW" /></Field>
              <Field label="图标 URL"><input className={inputClass} value={model.presentation?.iconUrl || ""} onChange={(event) => update(index, { presentation: { ...(model.presentation || {}), iconUrl: event.target.value } })} placeholder="https://.../model-icon.png" /></Field>
              <Field label="封面 URL"><input className={inputClass} value={model.presentation?.coverUrl || ""} onChange={(event) => update(index, { presentation: { ...(model.presentation || {}), coverUrl: event.target.value } })} placeholder="https://.../model-cover.webp" /></Field>
              <Field label="展示分组"><input className={inputClass} value={model.presentation?.group || ""} onChange={(event) => update(index, { presentation: { ...(model.presentation || {}), group: event.target.value } })} placeholder="通用绘图 / 商业精修" /></Field>
              <Field label="标签（逗号分隔）"><input className={inputClass} value={(model.presentation?.tags || []).join(", ")} onChange={(event) => update(index, { presentation: { ...(model.presentation || {}), tags: csv(event.target.value) } })} placeholder="快速, 文字准确, 4K" /></Field>
            </div>
            {(model.presentation?.iconUrl || model.presentation?.coverUrl) && (
              <div className="mt-3 flex items-center gap-3 rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface-soft)] p-2">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)]"><RawPreviewImage src={model.presentation.iconUrl || model.presentation.coverUrl || ""} alt="模型图片预览" eager disableFade draggable={false} /></div>
                <div className="min-w-0"><p className="truncate text-xs font-black text-[var(--admin-fg)]">{model.presentation?.shortTitle || model.displayName}</p><p className="mt-1 truncate text-[11px] font-bold text-[var(--admin-muted)]">{model.presentation?.badge || model.description || "前端模型卡片预览"}</p></div>
              </div>
            )}
            {model.modality === "image" && (
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {(["1K", "2K", "4K"] as const).map((size) => (
                  <CompactField key={size} label={`${size} 积分（留空表示不支持）`}>
                    <input
                      className={inputClass}
                      type="number"
                      min={0}
                      step={1}
                      value={model.creditPrices?.[size] ?? ""}
                      onChange={(event) => {
                        const prices = { ...(model.creditPrices || {}) };
                        const value = event.target.value === "" ? undefined : Number(event.target.value);
                        if (value === undefined) delete prices[size]; else prices[size] = value;
                        update(index, { creditPrices: prices });
                      }}
                    />
                  </CompactField>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-5">
              <label className="inline-flex items-center gap-2 text-xs font-bold text-[var(--admin-muted)]"><input type="checkbox" checked={model.userVisible} onChange={(event) => update(index, { userVisible: event.target.checked })} />用户可见</label>
              <label className="inline-flex items-center gap-2 text-xs font-bold text-[var(--admin-muted)]"><input type="checkbox" checked={model.presentation?.featured === true} onChange={(event) => update(index, { presentation: { ...(model.presentation || {}), featured: event.target.checked } })} />推荐置顶</label>
              <label className="inline-flex items-center gap-2 text-xs font-bold text-[var(--admin-muted)]">排序 <input className="h-8 w-20 rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2" type="number" value={model.presentation?.sortOrder ?? 100} onChange={(event) => update(index, { presentation: { ...(model.presentation || {}), sortOrder: Number(event.target.value) } })} /></label>
              <span className="text-xs font-bold text-[var(--admin-muted)]">部署 {config.deployments.filter((item) => item.modelId === model.id).length} 个</span>
            </div>
            <ModelLocalizationEditor model={model} onChange={(presentation) => update(index, { presentation })} />
          </article>
        ))}
      </div>
    </AdminSection>
  );
}

function ModelLocalizationEditor({ model, onChange }: { model: AiLogicalModel; onChange: (value: AiModelPresentation) => void }) {
  const [localeCode, setLocaleCode] = useState("zh-CN");
  const locales = model.presentation?.locales || {};
  const updateLocale = (locale: string, patch: Partial<NonNullable<AiModelPresentation["locales"]>[string]>) => {
    onChange({
      ...(model.presentation || {}),
      locales: { ...locales, [locale]: { ...locales[locale], ...patch } },
    });
  };
  const addLocale = () => {
    const code = localeCode.trim();
    if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(code)) return toast.error("请输入合法语言代码，例如 zh-CN、en、ja");
    if (locales[code]) return toast.error("该语言已存在");
    onChange({ ...(model.presentation || {}), locales: { ...locales, [code]: {} } });
  };
  return (
    <details className="mt-3 rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface-soft)] px-3 py-2">
      <summary className="cursor-pointer text-[11px] font-black text-[var(--admin-muted)]">多语言展示覆盖（可选）</summary>
      <div className="mt-3 flex gap-2">
        <input className={compactInput} value={localeCode} onChange={(event) => setLocaleCode(event.target.value)} aria-label="语言代码" placeholder="zh-CN" />
        <button type="button" onClick={addLocale} className={secondaryButton}><Plus className="h-4 w-4" />添加语言</button>
      </div>
      <div className="mt-3 space-y-2">
        {Object.entries(locales).map(([locale, value]) => (
          <div key={locale} className="grid gap-2 rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] p-2 sm:grid-cols-[80px_1fr_1fr_1.5fr_1fr_32px]">
            <code className="self-center text-[11px] font-black">{locale}</code>
            <input className={compactInput} value={value.title || ""} onChange={(event) => updateLocale(locale, { title: event.target.value })} placeholder="标题" aria-label={`${locale} 标题`} />
            <input className={compactInput} value={value.shortTitle || ""} onChange={(event) => updateLocale(locale, { shortTitle: event.target.value })} placeholder="短标题" aria-label={`${locale} 短标题`} />
            <input className={compactInput} value={value.description || ""} onChange={(event) => updateLocale(locale, { description: event.target.value })} placeholder="描述" aria-label={`${locale} 描述`} />
            <input className={compactInput} value={value.badge || ""} onChange={(event) => updateLocale(locale, { badge: event.target.value })} placeholder="徽标" aria-label={`${locale} 徽标`} />
            <button type="button" className={iconButton} aria-label={`删除 ${locale}`} onClick={() => { const next = { ...locales }; delete next[locale]; onChange({ ...(model.presentation || {}), locales: next }); }}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </details>
  );
}

function ProvidersEditor({ config, onChange, testingProvider, onTest }: { config: DraftConfig; onChange: (value: DraftConfig) => void; testingProvider: string | null; onTest: (provider: DraftProvider) => void }) {
  function add() { const id = nextId("provider", config.providers.map((item) => item.id)); onChange({ ...config, providers: [...config.providers, { id, name: "新供应商", baseUrl: "https://", enabled: false, timeoutMs: 120_000, apiKeyConfigured: false, apiKeyMasked: "" }] }); }
  function update(index: number, patch: Partial<DraftProvider>) {
    const previousId = config.providers[index].id;
    const nextId = patch.id ?? previousId;
    onChange({
      ...config,
      providers: config.providers.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
      deployments: nextId === previousId
        ? config.deployments
        : config.deployments.map((item) => item.providerId === previousId ? { ...item, providerId: nextId } : item),
    });
  }
  function remove(index: number) { const id = config.providers[index].id; if (config.deployments.some((item) => item.providerId === id)) return toast.error("请先删除引用该供应商的部署"); onChange({ ...config, providers: config.providers.filter((_, itemIndex) => itemIndex !== index) }); }
  return (
    <AdminSection title="供应商连接" description="密钥仅提交到服务端加密保存；页面刷新后只返回配置状态和脱敏值。" actions={<button type="button" onClick={add} className={secondaryButton}><Plus className="h-4 w-4" />新增供应商</button>}>
      <div className="grid gap-3 p-4 xl:grid-cols-2">
        {config.providers.map((provider, index) => (
          <article key={`${provider.id}-${index}`} className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="flex items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-xs font-black text-[var(--admin-fg)]"><input type="checkbox" checked={provider.enabled} onChange={(event) => update(index, { enabled: event.target.checked })} />启用</label>
              <div className="flex gap-1"><button type="button" onClick={() => void onTest(provider)} disabled={testingProvider === provider.id} className={iconButton} aria-label={`测试 ${provider.name}`}>{testingProvider === provider.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}</button><button type="button" onClick={() => remove(index)} className={iconButton} aria-label={`删除 ${provider.name}`}><Trash2 className="h-4 w-4" /></button></div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="供应商 ID"><input className={inputClass} value={provider.id} onChange={(event) => update(index, { id: event.target.value.trim() })} /></Field>
              <Field label="名称"><input className={inputClass} value={provider.name} onChange={(event) => update(index, { name: event.target.value })} /></Field>
            </div>
            <Field label="Base URL"><input className={inputClass} value={provider.baseUrl} onChange={(event) => update(index, { baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="区域"><input className={inputClass} value={provider.region || ""} onChange={(event) => update(index, { region: event.target.value })} placeholder="hk / global" /></Field>
              <Field label="超时（毫秒）"><input className={inputClass} type="number" min={3000} max={2700000} value={provider.timeoutMs} onChange={(event) => update(index, { timeoutMs: Number(event.target.value) })} /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="供应商账户容量组"><input className={inputClass} value={provider.capacityGroup || ""} onChange={(event) => update(index, { capacityGroup: event.target.value.trim() || undefined })} placeholder="默认使用供应商 ID" /></Field>
              <Field label="账户最大并发"><input className={inputClass} type="number" min={1} max={10000} value={provider.capacityMaxConcurrency || ""} onChange={(event) => update(index, { capacityMaxConcurrency: Number(event.target.value) || undefined })} placeholder="默认 24" /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="账户 RPM + burst"><div className="flex gap-2"><input className={inputClass} type="number" min={1} max={1000000} value={provider.capacityRequestsPerMinute || ""} onChange={(event) => update(index, { capacityRequestsPerMinute: Number(event.target.value) || undefined })} placeholder="跟随部署" /><input className={inputClass} type="number" min={0} max={100000} value={provider.capacityBurst ?? ""} onChange={(event) => update(index, { capacityBurst: Number(event.target.value) || undefined })} placeholder="burst" /></div></Field>
              <div className="flex items-end text-[11px] font-bold leading-5 text-[var(--admin-muted)]">同一账户的多个模型共享此容量组；留空时按各部署额度运行。</div>
            </div>
            <Field label="API Key"><input type="password" autoComplete="new-password" className={inputClass} value={provider.apiKey || ""} onChange={(event) => update(index, { apiKey: event.target.value })} placeholder={provider.apiKeyConfigured ? `${provider.apiKeyMasked}（留空保持不变）` : "输入 API Key 或 env:ENV_NAME"} /></Field>
          </article>
        ))}
      </div>
    </AdminSection>
  );
}

function RoutingEditor({ config, onChange, health, inFlight }: { config: DraftConfig; onChange: (value: DraftConfig) => void; health: Record<string, Health>; inFlight: Record<string, number> }) {
  function add() {
    const modelId = config.models[0]?.id || ""; const providerId = config.providers[0]?.id || "";
    const imageDeployment = config.models.find((model) => model.id === modelId)?.modality === "image";
    const item: AiModelDeployment = { id: nextId("deployment", config.deployments.map((entry) => entry.id)), modelId, providerId, upstreamModel: modelId, protocol: imageDeployment ? "openai-image" : "openai-chat", enabled: false, priority: 100, weight: 100, maxConcurrency: imageDeployment ? DEFAULT_DEPLOYMENT_MAX_CONCURRENCY : 8, requestsPerMinute: imageDeployment ? DEFAULT_DEPLOYMENT_REQUESTS_PER_MINUTE : 120, burst: imageDeployment ? DEFAULT_DEPLOYMENT_BURST : 8, qualityScore: 0.8 };
    onChange({ ...config, deployments: [...config.deployments, item] });
  }
  function update(index: number, patch: Partial<AiModelDeployment>) { onChange({ ...config, deployments: config.deployments.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }); }
  function move(index: number, direction: -1 | 1) {
    const current = config.deployments[index];
    const ordered = config.deployments.map((item, originalIndex) => ({ item, originalIndex })).filter((entry) => entry.item.modelId === current.modelId).sort((a, b) => a.item.priority - b.item.priority || a.originalIndex - b.originalIndex);
    const position = ordered.findIndex((entry) => entry.originalIndex === index); const target = ordered[position + direction]; if (!target) return;
    const targetPriority = target.item.priority; const currentPriority = current.priority;
    onChange({ ...config, deployments: config.deployments.map((item, itemIndex) => itemIndex === index ? { ...item, priority: targetPriority } : itemIndex === target.originalIndex ? { ...item, priority: currentPriority } : item) });
  }
  return (
    <div className="space-y-4">
      <AdminSection title="供应商部署与池优先级" description="相同模型 + 相同优先级 = 同级供应商池；权重控制池内份额，容量和 RPM 是硬保护。" actions={<button type="button" onClick={add} className={secondaryButton}><Plus className="h-4 w-4" />新增部署</button>}>
        <div className="space-y-3 p-4">
          {config.deployments.map((deployment, index) => {
            const state = health[deployment.id]; const model = config.models.find((item) => item.id === deployment.modelId); const provider = config.providers.find((item) => item.id === deployment.providerId);
            const adapter = AI_PROTOCOL_ADAPTERS[deployment.protocol];
            const allowedProtocols = PROTOCOLS.filter((item) => !model || AI_PROTOCOL_ADAPTERS[item.value].modalities.includes(model.modality));
            return (
              <article key={`${deployment.id}-${index}`} className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
                  <div className="flex min-w-[180px] items-center gap-2 xl:w-[210px]">
                    <label className="inline-flex items-center gap-2 text-xs font-black text-[var(--admin-fg)]"><input type="checkbox" checked={deployment.enabled} onChange={(event) => update(index, { enabled: event.target.checked })} />启用</label>
                    <AdminStatusBadge status={state?.circuitState === "open" ? "failed" : state?.circuitState === "half_open" ? "pending" : "completed"} />
                  </div>
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-8">
                    <CompactField label="模型"><select className={compactInput} value={deployment.modelId} onChange={(event) => update(index, { modelId: event.target.value })}>{config.models.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></CompactField>
                    <CompactField label="供应商"><select className={compactInput} value={deployment.providerId} onChange={(event) => update(index, { providerId: event.target.value })}>{config.providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></CompactField>
                    <CompactField label="精确上游模型"><input className={compactInput} value={deployment.upstreamModel} onChange={(event) => update(index, { upstreamModel: event.target.value })} /></CompactField>
                    <CompactField label="协议适配器"><select className={compactInput} value={deployment.protocol} onChange={(event) => update(index, { protocol: event.target.value as AiProviderProtocol, adapterConfig: undefined })}>{allowedProtocols.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></CompactField>
                    <CompactField label="优先级"><input className={compactInput} type="number" min={0} value={deployment.priority} onChange={(event) => update(index, { priority: Number(event.target.value) })} /></CompactField>
                    <CompactField label="池内权重"><input className={compactInput} type="number" min={1} value={deployment.weight} onChange={(event) => update(index, { weight: Number(event.target.value) })} /></CompactField>
                    <CompactField label="最大并发"><input className={compactInput} type="number" min={1} value={deployment.maxConcurrency} onChange={(event) => update(index, { maxConcurrency: Number(event.target.value) })} /></CompactField>
                    <CompactField label="RPM + burst"><div className="flex gap-1"><input className={compactInput} type="number" min={1} value={deployment.requestsPerMinute} onChange={(event) => update(index, { requestsPerMinute: Number(event.target.value) })} /><input className={`${compactInput} !w-16`} type="number" min={1} value={deployment.burst} onChange={(event) => update(index, { burst: Number(event.target.value) })} /></div></CompactField>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" className={iconButton} onClick={() => move(index, -1)} aria-label="上移优先级"><ArrowUp className="h-4 w-4" /></button>
                    <button type="button" className={iconButton} onClick={() => move(index, 1)} aria-label="下移优先级"><ArrowDown className="h-4 w-4" /></button>
                    <button type="button" className={iconButton} onClick={() => onChange({ ...config, deployments: config.deployments.filter((_, itemIndex) => itemIndex !== index) })} aria-label="删除部署"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-[var(--admin-muted)]">
                  <span>{model?.displayName || deployment.modelId} → {provider?.name || deployment.providerId}</span><span>运行中 {inFlight[deployment.id] || 0}/{deployment.maxConcurrency}</span><span>成功 EWMA {state ? `${(state.ewmaSuccessRate * 100).toFixed(1)}%` : "暂无样本"}</span><span>延迟 EWMA {state?.ewmaLatencyMs ? formatDuration(state.ewmaLatencyMs) : "暂无样本"}</span>
                </div>
                <details className="mt-3 rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface-soft)] px-3 py-2">
                  <summary className="cursor-pointer text-[11px] font-black text-[var(--admin-muted)]">高级部署参数</summary>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
                    <CompactField label="部署 ID"><input className={compactInput} value={deployment.id} onChange={(event) => update(index, { id: event.target.value.trim() })} /></CompactField>
                    <CompactField label="质量分 0-1"><input className={compactInput} type="number" min={0} max={1} step={0.01} value={deployment.qualityScore ?? 0.8} onChange={(event) => update(index, { qualityScore: Number(event.target.value) })} /></CompactField>
                    <CompactField label="单次成本 USD"><input className={compactInput} type="number" min={0} step={0.000001} value={deployment.cost?.perRequestUsd ?? ""} onChange={(event) => update(index, { cost: { ...(deployment.cost || {}), perRequestUsd: optionalNumber(event.target.value) } })} /></CompactField>
                    <CompactField label="单图成本 USD"><input className={compactInput} type="number" min={0} step={0.000001} value={deployment.cost?.perImageUsd ?? ""} onChange={(event) => update(index, { cost: { ...(deployment.cost || {}), perImageUsd: optionalNumber(event.target.value) } })} /></CompactField>
                    <CompactField label="能力覆盖（逗号）"><input className={compactInput} value={(deployment.capabilities || []).join(", ")} onChange={(event) => update(index, { capabilities: csv(event.target.value) })} placeholder="generation, edit" /></CompactField>
                    <div className="flex flex-col justify-end gap-2 pb-1 text-[11px] font-bold text-[var(--admin-muted)]">
                      <label className="inline-flex items-center gap-2"><input type="checkbox" checked={deployment.asyncMode === true} onChange={(event) => update(index, { asyncMode: event.target.checked })} />异步任务协议</label>
                      {deployment.protocol === "openai-image" && <label className="inline-flex items-center gap-2"><input type="checkbox" checked={deployment.metadata?.imageEditEndpoint !== false} onChange={(event) => update(index, { metadata: { ...(deployment.metadata || {}), imageEditEndpoint: event.target.checked } })} />有参考图时使用 /images/edits</label>}
                    </div>
                  </div>
                  <div className="mt-3 rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
                    <div className="grid gap-2 text-[11px] font-bold text-[var(--admin-muted)] sm:grid-cols-2">
                      <p><span className="font-black text-[var(--admin-fg)]">标准请求：</span>{adapter.requestShape}</p>
                      <p><span className="font-black text-[var(--admin-fg)]">归一响应：</span>{adapter.responseShape}</p>
                    </div>
                    <p className="mt-2 text-[11px] leading-5 text-[var(--admin-muted)]">路由层只处理标准任务，协议适配器负责请求转换、鉴权和响应归一。这里仅允许安全的相对路径与静态参数；不执行任意脚本。</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <CompactField label={`鉴权方式（默认 ${adapter.defaultAuthMode}）`}><select className={compactInput} value={deployment.adapterConfig?.authMode || ""} onChange={(event) => update(index, { adapterConfig: { ...(deployment.adapterConfig || {}), authMode: (event.target.value || undefined) as NonNullable<AiModelDeployment["adapterConfig"]>["authMode"] } })}><option value="">跟随适配器</option><option value="bearer">Authorization: Bearer</option><option value="x-api-key">x-api-key</option><option value="x-goog-api-key">x-goog-api-key</option></select></CompactField>
                      <CompactField label={`生成路径（默认 ${adapter.defaultPaths.generation}）`}><input className={compactInput} value={deployment.adapterConfig?.generationPath || ""} onChange={(event) => update(index, { adapterConfig: { ...(deployment.adapterConfig || {}), generationPath: event.target.value || undefined } })} placeholder={adapter.defaultPaths.generation} /></CompactField>
                      {adapter.defaultPaths.edit && <CompactField label={`编辑路径（默认 ${adapter.defaultPaths.edit}）`}><input className={compactInput} value={deployment.adapterConfig?.editPath || ""} onChange={(event) => update(index, { adapterConfig: { ...(deployment.adapterConfig || {}), editPath: event.target.value || undefined } })} placeholder={adapter.defaultPaths.edit} /></CompactField>}
                      {adapter.defaultPaths.status && <CompactField label={`状态路径（默认 ${adapter.defaultPaths.status}）`}><input className={compactInput} value={deployment.adapterConfig?.statusPath || ""} onChange={(event) => update(index, { adapterConfig: { ...(deployment.adapterConfig || {}), statusPath: event.target.value || undefined } })} placeholder={adapter.defaultPaths.status} /></CompactField>}
                    </div>
                    <AdapterStaticParametersEditor value={deployment.adapterConfig?.staticParameters || {}} onChange={(staticParameters) => update(index, { adapterConfig: { ...(deployment.adapterConfig || {}), staticParameters } })} />
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      </AdminSection>
      <PolicyEditor policy={config.policy} onChange={(policy) => onChange({ ...config, policy })} />
    </div>
  );
}

function AdapterStaticParametersEditor({ value, onChange }: { value: Record<string, string | number | boolean>; onChange: (value: Record<string, string | number | boolean>) => void }) {
  const entries = Object.entries(value);
  const updateEntry = (oldKey: string, nextKey: string, nextValue: string | number | boolean) => {
    const next = { ...value };
    delete next[oldKey];
    if (nextKey) next[nextKey] = nextValue;
    onChange(next);
  };
  const add = () => {
    let index = entries.length + 1;
    while (Object.prototype.hasOwnProperty.call(value, `parameter_${index}`)) index += 1;
    onChange({ ...value, [`parameter_${index}`]: "" });
  };
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3"><p className="text-[11px] font-black text-[var(--admin-fg)]">供应商静态参数</p><button type="button" className={secondaryButton} onClick={add}><Plus className="h-4 w-4" />添加参数</button></div>
      <div className="mt-2 space-y-2">
        {entries.map(([key, entryValue]) => (
          <div key={key} className="grid gap-2 sm:grid-cols-[1fr_120px_1fr_32px]">
            <input className={compactInput} value={key} onChange={(event) => updateEntry(key, event.target.value.trim(), entryValue)} aria-label="参数名" placeholder="参数名" />
            <select className={compactInput} value={typeof entryValue} onChange={(event) => {
              const type = event.target.value;
              updateEntry(key, key, type === "number" ? Number(entryValue) || 0 : type === "boolean" ? Boolean(entryValue) : String(entryValue));
            }} aria-label={`${key} 类型`}><option value="string">文本</option><option value="number">数字</option><option value="boolean">布尔</option></select>
            {typeof entryValue === "boolean" ? <select className={compactInput} value={String(entryValue)} onChange={(event) => updateEntry(key, key, event.target.value === "true")} aria-label={`${key} 值`}><option value="true">true</option><option value="false">false</option></select> : <input className={compactInput} type={typeof entryValue === "number" ? "number" : "text"} value={entryValue} onChange={(event) => updateEntry(key, key, typeof entryValue === "number" ? Number(event.target.value) : event.target.value)} aria-label={`${key} 值`} />}
            <button type="button" className={iconButton} aria-label={`删除参数 ${key}`} onClick={() => { const next = { ...value }; delete next[key]; onChange(next); }}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PolicyEditor({ policy, onChange }: { policy: AiRoutingPolicy; onChange: (value: AiRoutingPolicy) => void }) {
  const fields: Array<[keyof Omit<AiRoutingPolicy, "smartWeights">, string, number, number]> = [
    ["maxAttempts", "最大供应商尝试", 1, 2], ["leaseTtlSeconds", "容量租约（秒）", 30, 120], ["retryBaseDelayMs", "基础退避（ms）", 0, 30000], ["retryMaxDelayMs", "最大退避（ms）", 0, 120000], ["circuitFailureThreshold", "连续失败阈值", 1, 100], ["circuitMinimumSamples", "最小熔断样本", 1, 10000], ["circuitOpenSeconds", "熔断时长（秒）", 5, 86400], ["halfOpenMaxRequests", "半开探测并发", 1, 100],
  ];
  return (
    <AdminSection title="全局可靠性策略" description="这些值是系统保护上限；单个模型仍由部署优先级和容量决定实际路由。">
      <div className="grid gap-4 p-4 xl:grid-cols-[1fr_1fr]">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{fields.map(([key, label, min, max]) => <CompactField key={key} label={label}><input className={inputClass} type="number" min={min} max={max} value={policy[key]} onChange={(event) => onChange({ ...policy, [key]: Number(event.target.value) })} /></CompactField>)}</div>
        <div><p className="mb-2 text-xs font-black text-[var(--admin-fg)]">智能路由评分权重</p><div className="grid gap-2 sm:grid-cols-5">{Object.entries(policy.smartWeights).map(([key, value]) => <CompactField key={key} label={weightLabel(key)}><input className={inputClass} type="number" min={0} max={1} step={0.01} value={value} onChange={(event) => onChange({ ...policy, smartWeights: { ...policy.smartWeights, [key]: Number(event.target.value) } })} /></CompactField>)}</div></div>
      </div>
    </AdminSection>
  );
}

function MetricsPanel({ config, metrics, health }: { config: DraftConfig; metrics: AiProviderMetric[]; health: Record<string, Health> }) {
  return <AdminSection title="24 小时供应商指标" description="每一行对应一个模型部署；不记录提示词、API Key 或完整供应商响应。"><div className="overflow-x-auto"><table className="w-full min-w-[980px] border-collapse text-left text-xs"><thead className="bg-[var(--admin-surface-soft)] text-[var(--admin-muted)]"><tr>{["模型 / 供应商", "状态", "调用", "成功率", "平均", "P50", "P95", "估算成本", "最近调用"].map((label) => <th key={label} className="border-b border-[var(--admin-border)] px-3 py-2 font-black">{label}</th>)}</tr></thead><tbody>{metrics.length ? metrics.map((metric) => { const deployment = config.deployments.find((item) => item.id === metric.deploymentId); const model = config.models.find((item) => item.id === metric.modelId); const provider = config.providers.find((item) => item.id === metric.providerId); const state = health[metric.deploymentId]; return <tr key={metric.deploymentId} className="border-b border-[var(--admin-border)] hover:bg-[var(--admin-surface-soft)]"><td className="px-3 py-3"><p className="font-black text-[var(--admin-fg)]">{model?.displayName || metric.modelId}</p><p className="mt-1 font-mono text-[11px] text-[var(--admin-muted)]">{provider?.name || metric.providerId} · {deployment?.upstreamModel}</p></td><td className="px-3 py-3"><AdminStatusBadge status={state?.circuitState === "open" ? "failed" : state?.circuitState === "half_open" ? "pending" : "completed"} /></td><td className="px-3 py-3 font-black tabular-nums">{metric.requestCount}</td><td className="px-3 py-3 font-black tabular-nums">{metric.successRate === null ? "—" : `${(metric.successRate * 100).toFixed(2)}%`}</td><td className="px-3 py-3 tabular-nums">{formatDuration(metric.averageLatencyMs)}</td><td className="px-3 py-3 tabular-nums">{formatDuration(metric.p50LatencyMs)}</td><td className="px-3 py-3 tabular-nums">{formatDuration(metric.p95LatencyMs)}</td><td className="px-3 py-3 tabular-nums">${metric.estimatedCostUsd.toFixed(4)}</td><td className="px-3 py-3">{formatTime(metric.lastRequestAt)}</td></tr>; }) : <tr><td colSpan={9} className="px-4 py-16 text-center text-sm font-bold text-[var(--admin-muted)]">暂无调用样本。发布配置并完成生成后会自动出现。</td></tr>}</tbody></table></div></AdminSection>;
}

function ReadOnlyConfigurationPanel({ tab, config, health, inFlight }: { tab: "models" | "providers" | "routing"; config: DraftConfig; health: Record<string, Health>; inFlight: Record<string, number> }) {
  if (tab === "models") {
    return <AdminSection title="模型目录" description="当前环境中的逻辑模型与可见性配置。"><div className="divide-y divide-[var(--admin-border)]">{config.models.map((model) => <div key={model.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-black text-[var(--admin-fg)]">{model.displayName}</p><p className="mt-1 font-mono text-[11px] text-[var(--admin-muted)]">{model.id} · {model.modality}</p></div><div className="flex items-center gap-2"><AdminStatusBadge status={model.enabled ? "completed" : "disabled"} /><span className="text-xs font-bold text-[var(--admin-muted)]">{model.userVisible ? "前台可见" : "仅后台"}</span></div></div>)}</div></AdminSection>;
  }
  if (tab === "providers") {
    return <AdminSection title="供应商池" description="仅展示连接标识与当前容量状态，不显示密钥。"><div className="divide-y divide-[var(--admin-border)]">{config.providers.map((provider) => { const deployments = config.deployments.filter((item) => item.providerId === provider.id); const active = deployments.filter((item) => item.enabled).length; const activeRequests = deployments.reduce((sum, item) => sum + (inFlight[item.id] || 0), 0); const protocols = Array.from(new Set(deployments.map((item) => item.protocol))); return <div key={provider.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-black text-[var(--admin-fg)]">{provider.name}</p><p className="mt-1 font-mono text-[11px] text-[var(--admin-muted)]">{provider.id} · {protocols.join(", ") || "未配置协议"}</p></div><div className="flex flex-wrap items-center gap-2 text-xs font-bold text-[var(--admin-muted)]"><span>{active}/{deployments.length} 部署启用</span><span>执行中 {activeRequests}</span></div></div>; })}</div></AdminSection>;
  }
  return <AdminSection title="路由与容量" description="展示每个部署的启用状态、优先级、容量上限与熔断状态。"><div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-left text-xs"><thead className="bg-[var(--admin-surface-soft)] text-[var(--admin-muted)]"><tr>{["部署", "模型 / 供应商", "优先级", "并发", "RPM", "当前执行", "熔断"].map((label) => <th key={label} className="border-b border-[var(--admin-border)] px-3 py-2 font-black">{label}</th>)}</tr></thead><tbody>{config.deployments.map((deployment) => { const model = config.models.find((item) => item.id === deployment.modelId); const provider = config.providers.find((item) => item.id === deployment.providerId); const state = health[deployment.id]; return <tr key={deployment.id} className="border-b border-[var(--admin-border)]"><td className="px-3 py-3 font-mono">{deployment.id}</td><td className="px-3 py-3"><p className="font-black">{model?.displayName || deployment.modelId}</p><p className="mt-1 text-[11px] text-[var(--admin-muted)]">{provider?.name || deployment.providerId}</p></td><td className="px-3 py-3 tabular-nums">{deployment.priority}</td><td className="px-3 py-3 tabular-nums">{deployment.maxConcurrency}</td><td className="px-3 py-3 tabular-nums">{deployment.requestsPerMinute}</td><td className="px-3 py-3 tabular-nums">{inFlight[deployment.id] || 0}</td><td className="px-3 py-3"><AdminStatusBadge status={state?.circuitState === "open" ? "failed" : state?.circuitState === "half_open" ? "pending" : "completed"} /></td></tr>; })}</tbody></table></div></AdminSection>;
}

function VersionsPanel({ versions, currentId, saving, onRollback, canManage }: { versions: Version[]; currentId?: string; saving: string | null; onRollback: (version: Version) => void; canManage: boolean }) {
  return <AdminSection title="配置版本与回滚" description="回滚不会覆盖历史，而是把目标快照重新发布成一个新版本。"><div className="divide-y divide-[var(--admin-border)]">{versions.map((version) => <div key={version.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><code className="font-black text-[var(--admin-fg)]">{version.id.slice(0, 12)}</code><AdminStatusBadge status={version.id === currentId ? "published" : version.status} /></div><p className="mt-1 text-xs font-bold text-[var(--admin-muted)]">创建 {formatTime(version.created_at)}{version.published_at ? ` · 发布 ${formatTime(version.published_at)}` : ""}</p></div>{canManage && <button type="button" disabled={version.id === currentId || Boolean(saving)} onClick={() => void onRollback(version)} className={secondaryButton}>{saving === `rollback:${version.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}回滚到此版本</button>}</div>)}</div></AdminSection>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="mt-3 block space-y-1"><span className="text-[11px] font-black text-[var(--admin-muted)]">{label}</span>{children}</label>; }
function CompactField({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block min-w-0 space-y-1"><span className="block truncate text-[10px] font-black text-[var(--admin-muted)]">{label}</span>{children}</label>; }
function toServerConfig(config: DraftConfig) { return { ...config, providers: config.providers.map(({ apiKeyConfigured: _configured, apiKeyMasked: _masked, ...provider }) => provider) }; }
function stripTransient(config: DraftConfig) { return { ...config, providers: config.providers.map(({ apiKey: _key, ...provider }) => provider) }; }
function nextId(prefix: string, ids: string[]) { let index = ids.length + 1; while (ids.includes(`${prefix}-${index}`)) index += 1; return `${prefix}-${index}`; }
function csv(value: string) { return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean))); }
function optionalNumber(value: string) { const parsed = Number(value); return value === "" || !Number.isFinite(parsed) ? undefined : parsed; }
function firstError(value: unknown) { return Array.isArray(value) ? value.find((item) => item?.severity === "error")?.message : ""; }
function formatDuration(value: number | null | undefined) { if (!value) return "—"; return value >= 60_000 ? `${(value / 60_000).toFixed(1)} min` : value >= 1_000 ? `${(value / 1_000).toFixed(1)} s` : `${Math.round(value)} ms`; }
function formatTime(value?: string | null) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date); }
function formatRelativeTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const sign = diffMs >= 0 ? "后" : "前";
  let label: string;
  if (absMs < minute) label = `${Math.round(absMs / 1000)} 秒`;
  else if (absMs < hour) label = `${Math.round(absMs / minute)} 分钟`;
  else if (absMs < day) label = `${Math.round(absMs / hour)} 小时`;
  else label = `${Math.round(absMs / day)} 天`;
  return `${label}${sign}`;
}
function weightLabel(value: string) { return ({ reliability: "成功率", latency: "速度", cost: "成本", capacity: "容量", quality: "质量" } as Record<string, string>)[value] || value; }

const inputClass = "h-9 w-full rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 text-xs font-bold text-[var(--admin-fg)] outline-none transition focus:border-[var(--admin-border-strong)] focus:ring-2 focus:ring-[var(--admin-focus-ring)] motion-reduce:transition-none";
const compactInput = `${inputClass} min-w-0`;
const secondaryButton = "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 text-xs font-black text-[var(--admin-fg)] transition-colors hover:bg-[var(--admin-surface-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";
const primaryButton = "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md bg-[var(--admin-fg)] px-3 text-xs font-black text-[var(--admin-surface)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";
const iconButton = "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] text-[var(--admin-muted)] transition-colors hover:bg-[var(--admin-surface-soft)] hover:text-[var(--admin-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";
