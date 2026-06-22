import Link from "next/link";
import type { ReactNode } from "react";
import { Beaker, GitCompare, RefreshCw, ShieldCheck } from "lucide-react";
import {
  AdminMetricCard,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
  AdminStatusBadge,
  AdminTable,
  formatDateTime,
  formatNumber,
} from "@/components/admin/AdminPrimitives";
import { AdminConfigActions } from "@/components/admin/AdminConfigActions";
import { AdminPromptExperimentForm } from "@/components/admin/AdminPromptExperimentForm";
import {
  DEFAULT_PROMPT_EXPERIMENT_CONFIG,
  getAdminPromptExperimentOverview,
  type AdminConfigVersion,
  type AdminPromptExperiment,
  type AdminPromptExperimentVariant,
} from "@/lib/admin/data";

export const dynamic = "force-dynamic";

export default async function AdminPromptsPage() {
  const overview = await getAdminPromptExperimentOverview();
  const defaultValue = JSON.stringify(overview.activeVersion?.value || DEFAULT_PROMPT_EXPERIMENT_CONFIG, null, 2);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="Prompt Ops"
        title="Prompt 模板与 A/B 实验"
        description="用配置版本管理模块提示词、实验分流、指标门禁和回滚。V1 先落地可审计的 prompt.experiments 管理面，运行时代码消费与自动门禁可继续扩展。"
        actions={
          <Link
            href="/admin/prompts"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Link>
        }
      />

      {!overview.available && (
        <AdminNotice>
          admin_config_versions 表尚未安装。执行 supabase/admin-console.sql 后，可创建 prompt.experiments 版本并进行发布/归档。
        </AdminNotice>
      )}
      {overview.warnings.length > 0 && (
        <AdminNotice tone="info">
          Prompt 配置提示：{overview.warnings.slice(0, 4).join("；")}
        </AdminNotice>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <AdminMetricCard label="实验数" value={formatNumber(overview.metrics.total)} />
        <AdminMetricCard label="运行中" value={formatNumber(overview.metrics.running)} tone={overview.metrics.running > 0 ? "good" : "neutral"} />
        <AdminMetricCard label="草稿" value={formatNumber(overview.metrics.draft)} />
        <AdminMetricCard label="暂停" value={formatNumber(overview.metrics.paused)} tone={overview.metrics.paused > 0 ? "warning" : "neutral"} />
        <AdminMetricCard label="覆盖模块" value={formatNumber(overview.metrics.coveredModules)} />
        <AdminMetricCard label="平均流量" value={overview.metrics.averageTraffic} suffix="%" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.85fr)]">
        <AdminSection title="当前发布版本" description="同一时间只允许一个 published 版本；发布新版本会归档旧发布版本。">
          <div className="grid gap-3 p-4 md:grid-cols-3">
            <InfoTile label="配置键" value={overview.configKey} mono />
            <InfoTile label="发布版本" value={overview.activeVersion?.id || "未发布"} mono />
            <InfoTile label="发布时间" value={formatDateTime(overview.activeVersion?.publishedAt)} />
          </div>
        </AdminSection>

        <AdminSection title="上线门禁" description="发布前建议先确认回归评测和关键指标。">
          <div className="space-y-2 p-4">
            {["回归评测分数 >= 90", "失败用例 = 0", "实验流量 <= 30%", "变体权重合计 = 100", "可一键归档回滚"].map((item) => (
              <div key={item} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                {item}
              </div>
            ))}
          </div>
        </AdminSection>
      </div>

      <AdminSection title="创建 Prompt 实验配置版本" description="只写入 prompt.experiments，不影响其他系统配置。发布动作会写审计并归档旧发布版本。">
        <AdminPromptExperimentForm defaultValue={defaultValue} />
      </AdminSection>

      <AdminSection title="实验列表" description="展示当前发布版本中的实验。没有 published 时，会展示最新非归档版本作为待发布预览。">
        <AdminTable<AdminPromptExperiment>
          rows={overview.experiments}
          rowKey={(row) => `${row.versionId}-${row.id}`}
          empty="暂无 prompt 实验"
          columns={[
            {
              key: "experiment",
              label: "实验",
              render: (row) => (
                <div className="min-w-[260px]">
                  <div className="flex items-center gap-2">
                    <AdminStatusBadge status={row.status} />
                    <span className="font-mono text-[11px] font-bold text-slate-400">{row.id}</span>
                  </div>
                  <p className="mt-1 text-sm font-black text-slate-950">{row.name}</p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-500">{row.notes || "无备注"}</p>
                </div>
              ),
            },
            { key: "module", label: "模块", render: (row) => <span className="whitespace-nowrap text-sm font-black text-slate-700">{row.moduleLabel}</span> },
            { key: "traffic", label: "流量", render: (row) => <span className="font-mono text-sm font-black text-slate-950">{row.traffic}%</span> },
            { key: "metric", label: "主指标", render: (row) => <span className="font-mono text-xs font-bold text-slate-600">{row.primaryMetric}</span> },
            { key: "variants", label: "变体", render: (row) => <VariantSummary variants={row.variants} /> },
            { key: "guardrails", label: "门禁", render: (row) => <p className="max-w-[300px] text-xs leading-5 text-slate-600">{row.guardrails.join("；") || "-"}</p> },
          ]}
        />
      </AdminSection>

      <AdminSection title="Prompt 版本" description="所有版本都来自 admin_config_versions，可发布、归档和回滚。">
        <AdminTable<AdminConfigVersion>
          rows={[...(overview.activeVersion ? [overview.activeVersion] : []), ...overview.draftVersions, ...overview.archivedVersions.slice(0, 20)]}
          rowKey={(row) => row.id}
          empty="暂无 prompt 配置版本"
          columns={[
            { key: "status", label: "状态", render: (row) => <AdminStatusBadge status={row.status} /> },
            { key: "id", label: "版本", render: (row) => <code className="text-xs font-black text-slate-700">{row.id}</code> },
            { key: "value", label: "内容", render: (row) => <code className="line-clamp-2 max-w-[520px] text-xs text-slate-600">{JSON.stringify(row.value)}</code> },
            { key: "published", label: "发布", render: (row) => <span className="whitespace-nowrap text-xs font-semibold text-slate-500">{formatDateTime(row.publishedAt)}</span> },
            { key: "created", label: "创建", render: (row) => <span className="whitespace-nowrap text-xs font-semibold text-slate-500">{formatDateTime(row.createdAt)}</span> },
            { key: "actions", label: "操作", render: (row) => <AdminConfigActions id={row.id} status={row.status} endpointBase="/api/admin/prompts/configs" /> },
          ]}
        />
      </AdminSection>

      <div className="grid gap-3 md:grid-cols-2">
        <GuidanceCard icon={<Beaker className="h-4 w-4" />} title="实验分流" text="默认按 user_id hash bucket 做 sticky assignment，避免同一用户在实验期间反复看到不同模板。" />
        <GuidanceCard icon={<GitCompare className="h-4 w-4" />} title="Prompt diff" text="当前版本表可对比 JSON；后续可加逐字段 diff 和低成本试运行结果截图。" />
      </div>
    </div>
  );
}

function InfoTile({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-black text-slate-500">{label}</p>
      <p className={`mt-2 break-all text-sm font-black text-slate-950 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function VariantSummary({ variants }: { variants: AdminPromptExperimentVariant[] }) {
  return (
    <div className="flex max-w-[360px] flex-wrap gap-1">
      {variants.map((variant) => (
        <span key={variant.key} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-700">
          {variant.label}: {variant.weight}%
        </span>
      ))}
    </div>
  );
}

function GuidanceCard({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-zinc-800">
      <div className="flex items-center gap-2 text-sm font-black">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-sm leading-6">{text}</p>
    </section>
  );
}
