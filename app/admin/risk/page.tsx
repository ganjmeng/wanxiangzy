import Link from "next/link";
import { Search } from "lucide-react";
import {
  AdminMetricCard,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
  AdminTable,
  formatDateTime,
  formatNumber,
  shortAdminCode,
} from "@/components/admin/AdminPrimitives";
import {
  getAdminRiskOverview,
  type AdminRiskLevel,
  type AdminRiskPolicy,
  type AdminRiskUserItem,
} from "@/lib/admin/data";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const levelOptions = [
  { value: "", label: "全部风险" },
  { value: "critical", label: "严重" },
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" },
];

const dayOptions = [7, 14, 30, 90];

export default async function AdminRiskPage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const q = getSearchParam(params.q);
  const level = getSearchParam(params.level);
  const days = Number(getSearchParam(params.days) || 30);
  const risk = await getAdminRiskOverview({ q, level, days, limit: 100 });

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="Risk"
        title="智能风控评分"
        description="基于近期开通数据、任务失败、退款/补偿、审核下架和客服工单生成可解释风险分；V1 只做识别和复核建议，不自动封禁或扣减权益。"
      />

      {risk.warnings.length > 0 && (
        <AdminNotice tone="info">风控数据源提示：{risk.warnings.slice(0, 3).join("；")}</AdminNotice>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <AdminMetricCard label="采样用户" value={formatNumber(risk.metrics.sampledUsers)} hint={`近 ${risk.days} 天信号`} />
        <AdminMetricCard label="严重风险" value={formatNumber(risk.metrics.criticalUsers)} tone={risk.metrics.criticalUsers ? "danger" : "good"} />
        <AdminMetricCard label="高风险" value={formatNumber(risk.metrics.highUsers)} tone={risk.metrics.highUsers ? "warning" : "good"} />
        <AdminMetricCard label="退款补偿" value={formatNumber(risk.metrics.refundCredits)} hint="风险样本内灵点" tone={risk.metrics.refundCredits ? "warning" : "neutral"} />
        <AdminMetricCard label="平均分" value={formatNumber(risk.metrics.averageScore)} hint="0-100" />
      </div>

      <AdminSection
        title="筛选"
        description="支持按用户、邮箱、风险等级和时间窗口筛选；同一口径已接入导出与保存视图。"
        actions={
          <form action="/admin/risk" className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                name="q"
                defaultValue={q}
                placeholder="搜索用户 / 邮箱 / 信号"
                className="h-9 w-60 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-sm font-semibold outline-none focus:border-slate-400"
              />
            </div>
            <select name="level" defaultValue={level} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700">
              {levelOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select name="days" defaultValue={String(risk.days)} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700">
              {dayOptions.map((item) => <option key={item} value={item}>近 {item} 天</option>)}
            </select>
            <button className="h-9 rounded-lg bg-slate-950 px-3 text-xs font-black text-white" type="submit">
              筛选
            </button>
          </form>
        }
      >
        <div className="grid gap-3 p-4 text-xs font-semibold text-slate-600 md:grid-cols-4">
          <RiskCounter label="失败任务" value={risk.metrics.failedGenerations} />
          <RiskCounter label="审核命中" value={risk.metrics.moderationHits} />
          <RiskCounter label="紧急工单" value={risk.metrics.urgentSupportTickets} />
          <RiskCounter label="评分策略" value={risk.policies.length} />
        </div>
      </AdminSection>

      <AdminSection title="评分策略" description="策略以可解释信号为主，后续可升级为配置版本、灰度权重和自动拦截门禁。">
        <AdminTable<AdminRiskPolicy>
          rows={risk.policies}
          rowKey={(row) => row.id}
          empty="暂无策略"
          columns={[
            {
              key: "policy",
              label: "策略",
              render: (row) => (
                <div className="min-w-[280px]">
                  <RiskBadge level={row.level} />
                  <p className="mt-1 text-sm font-black text-slate-950">{row.title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-500">{row.description}</p>
                </div>
              ),
            },
            { key: "score", label: "分值", render: (row) => <span className="font-mono text-sm font-black text-slate-700">+{row.score}</span> },
          ]}
        />
      </AdminSection>

      <AdminSection title="用户风险队列" description="按评分从高到低排列；处理前先进入用户详情核对任务、灵点、审核、客服和审计链路。">
        <AdminTable<AdminRiskUserItem>
          rows={risk.rows}
          rowKey={(row) => row.userId}
          empty="暂无风险样本"
          columns={[
            {
              key: "user",
              label: "用户",
              render: (row) => (
                <div className="min-w-[260px]">
                  <div className="flex items-center gap-2">
                    <RiskBadge level={row.level} />
                    <span className="rounded-md bg-slate-100 px-1.5 py-1 font-mono text-[10px] font-black text-slate-500">{row.score}/100</span>
                  </div>
                  <Link href={row.detailUrl} className="mt-1 block truncate text-sm font-black text-slate-950 hover:text-slate-700">
                    {row.email || row.displayName || shortAdminCode(row.userId, "用户")}
                  </Link>
                  <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-400">{shortAdminCode(row.userId, "用户")}</p>
                </div>
              ),
            },
            {
              key: "signals",
              label: "信号",
              render: (row) => (
                <div className="min-w-[260px] space-y-1">
                  {row.signals.length ? row.signals.slice(0, 3).map((signal) => (
                    <p key={signal.key} className="text-xs font-semibold leading-5 text-slate-600">
                      <span className="font-black text-slate-950">+{signal.score}</span> {signal.label}
                    </p>
                  )) : <span className="text-xs font-semibold text-slate-400">无命中信号</span>}
                </div>
              ),
            },
            {
              key: "stats",
              label: "近况",
              render: (row) => (
                <div className="grid min-w-[240px] grid-cols-2 gap-1 text-xs font-bold text-slate-600">
                  <span>生成 {formatNumber(row.generationCount)}</span>
                  <span>失败 {formatNumber(row.failedGenerations)}</span>
                  <span>补偿 {formatNumber(row.refundCredits)}</span>
                  <span>审核 {formatNumber(row.moderationHits)}</span>
                </div>
              ),
            },
            { key: "credits", label: "灵点", render: (row) => <span className="text-sm font-black text-slate-700">{formatNumber(row.credits)}</span> },
            { key: "support", label: "工单", render: (row) => <span className="text-sm font-bold text-slate-700">{formatNumber(row.supportTickets)} 个，紧急 {formatNumber(row.urgentSupportTickets)} 个</span> },
            { key: "action", label: "建议", render: (row) => <p className="max-w-[280px] text-xs leading-5 text-slate-600">{row.recommendedAction}</p> },
            { key: "time", label: "最后活动", render: (row) => <span className="whitespace-nowrap text-xs font-semibold text-slate-500">{formatDateTime(row.latestActivityAt)}</span> },
          ]}
        />
      </AdminSection>
    </div>
  );
}

function RiskCounter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="text-slate-500">{label}</span>
      <span className="ml-2 font-mono font-black text-slate-950">{formatNumber(value)}</span>
    </div>
  );
}

function RiskBadge({ level }: { level: AdminRiskLevel }) {
  const className = level === "critical"
    ? "border-red-200 bg-red-50 text-red-700"
    : level === "high"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : level === "medium"
        ? "border-zinc-200 bg-zinc-50 text-zinc-700"
        : "border-emerald-200 bg-emerald-50 text-emerald-700";
  const label = level === "critical" ? "严重" : level === "high" ? "高" : level === "medium" ? "中" : "低";
  return <span className={`inline-flex h-6 items-center rounded-md border px-2 text-[11px] font-black ${className}`}>{label}</span>;
}

function getSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}
