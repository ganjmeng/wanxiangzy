import Link from "next/link";
import { FlaskConical, RefreshCw, Search, Settings2 } from "lucide-react";
import {
  AdminMetricCard,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
  AdminStatusBadge,
  AdminTable,
  formatDateTime,
  formatNumber,
  shortAdminCode,
} from "@/components/admin/AdminPrimitives";
import { AdminWorkerRunForm } from "@/components/admin/AdminWorkerRunForm";
import {
  getAdminAgentEvalOverview,
  type AdminAgentEvalCase,
  type AdminAgentEvalResult,
  type AdminAgentEvalRun,
} from "@/lib/admin/data";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminEvalsPage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const q = getSearchParam(params.q);
  const overview = await getAdminAgentEvalOverview({ q, limit: 80 });

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="Regression"
        title="回归评测"
        description="集中查看上线前回归、失败用例、处理服务配置和手动触发记录。用于发布门禁、坏反馈沉淀和提示词变更复测。"
        actions={
          <>
            <Link
              href="/admin/evals"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              刷新
            </Link>
            <Link
              href="/admin/workers"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <Settings2 className="h-3.5 w-3.5" />
              任务队列
            </Link>
          </>
        }
      />

      {!overview.available && (
        <AdminNotice>
          回归评测数据尚未初始化。完成评测数据初始化后，后台会展示真实运行记录。
        </AdminNotice>
      )}
      {!overview.processor.configured && (
        <AdminNotice tone="danger">
          回归评测处理服务配置未完成，后台手动触发会被拒绝。候选配置：{overview.processor.secretNames.join("、")}。
        </AdminNotice>
      )}
      {overview.warnings.length > 0 && (
        <AdminNotice tone="info">
          评测数据提示：{overview.warnings.slice(0, 3).join("；")}
        </AdminNotice>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <AdminMetricCard label="总运行" value={formatNumber(overview.metrics.totalRuns)} hint={formatDateTime(overview.metrics.latestRunAt)} />
        <AdminMetricCard label="近期待看" value={formatNumber(overview.metrics.recentRuns)} />
        <AdminMetricCard label="平均分" value={overview.metrics.avgScore} suffix="分" tone={overview.metrics.avgScore >= 90 ? "good" : overview.metrics.avgScore >= 70 ? "warning" : "danger"} />
        <AdminMetricCard label="通过率" value={overview.metrics.passRate} suffix="%" tone={overview.metrics.passRate >= 90 ? "good" : overview.metrics.passRate >= 70 ? "warning" : "danger"} />
        <AdminMetricCard label="失败运行" value={formatNumber(overview.metrics.failedRuns)} tone={overview.metrics.failedRuns > 0 ? "danger" : "good"} />
        <AdminMetricCard label="平均耗时" value={formatLatency(overview.metrics.averageLatencyMs)} />
      </div>

      <AdminSection title="筛选" description="按运行编号、用户、邮箱、状态、用例标题或失败原因快速定位回归问题。">
        <form action="/admin/evals" className="grid gap-3 p-4 sm:grid-cols-[minmax(260px,1fr)_auto]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              name="q"
              defaultValue={q}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold outline-none focus:border-slate-400"
              placeholder="搜索运行编号 / 用户 / 用例 / 失败原因"
            />
          </label>
          <button className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white">
            <Search className="h-4 w-4" />
            查询
          </button>
        </form>
      </AdminSection>

      <AdminSection title="手动触发回归评测" description="用于上线前回归、提示词改动后复测或坏反馈沉淀验证。触发记录会保留，方便追踪。">
        <AdminWorkerRunForm defaultTarget="agent-evals" defaultLimit={overview.processor.batchSize} defaultReason="回归评测验证" lockTarget />
      </AdminSection>

      <AdminSection title="处理服务配置" description="只展示配置是否可用和候选配置名，不展示明文密钥。">
        <div className="grid gap-3 p-4 md:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-black text-slate-500">触发入口</p>
            <code className="mt-2 block break-all text-xs font-bold text-slate-700">{overview.processor.endpoint}</code>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-black text-slate-500">默认批量</p>
            <p className="mt-2 font-mono text-xl font-black text-slate-950">{overview.processor.batchSize}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-black text-slate-500">配置状态</p>
            <div className="mt-2"><AdminStatusBadge status={overview.processor.configured ? "pass" : "failed"} /></div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-black text-slate-500">候选变量</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {overview.processor.secretNames.map((name) => (
                <code key={name} className="rounded bg-white px-1.5 py-1 text-[11px] font-bold text-slate-600">{name}</code>
              ))}
            </div>
          </div>
        </div>
      </AdminSection>

      <AdminSection title="最近评测运行" description="按创建时间倒序展示。分数低或样本为 0 的运行优先进入回归排查。">
        <AdminTable<AdminAgentEvalRun>
          rows={overview.runs}
          rowKey={(row) => row.id}
          empty="暂无评测运行记录"
          columns={[
            { key: "status", label: "状态", render: (row) => <AdminStatusBadge status={row.status} /> },
            {
              key: "run",
              label: "运行",
              render: (row) => (
                <div className="min-w-[220px]">
                  <p className="font-mono text-xs font-black text-slate-700">{row.id}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">{formatDateTime(row.createdAt)}</p>
                </div>
              ),
            },
            {
              key: "user",
              label: "用户",
              render: (row) => (
                <div className="min-w-[180px]">
                  <p className="truncate text-xs font-bold text-slate-700">{row.email || shortAdminCode(row.userId, "用户")}</p>
                  <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-400">{shortAdminCode(row.userId, "用户")}</p>
                </div>
              ),
            },
            { key: "score", label: "分数", render: (row) => <span className="font-mono text-sm font-black text-slate-950">{row.score}</span> },
            { key: "cases", label: "用例", render: (row) => <span className="font-mono text-xs font-bold text-slate-600">{row.passed}/{row.total}</span> },
            { key: "failed", label: "失败", render: (row) => <span className="font-mono text-xs font-bold text-red-600">{row.failed}</span> },
            { key: "latency", label: "耗时", render: (row) => <span className="font-mono text-xs font-bold text-slate-600">{formatLatency(row.latencyMs)}</span> },
          ]}
        />
      </AdminSection>

      <AdminSection title="失败用例" description="用于定位失败期望、实际结果和追踪记录。">
        <AdminTable<AdminAgentEvalResult>
          rows={overview.failures}
          rowKey={(row) => row.id}
          empty="暂无失败用例"
          columns={[
            {
              key: "case",
              label: "用例",
              render: (row) => (
                <div className="min-w-[260px]">
                  <p className="text-sm font-black text-slate-950">{row.title || row.caseId}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-400">{row.caseId}</p>
                </div>
              ),
            },
            { key: "actual", label: "实际结果", render: (row) => <span className="whitespace-nowrap text-xs font-bold text-slate-700">{row.action || "-"} / {row.module || "无模块"}</span> },
            { key: "confidence", label: "置信度", render: (row) => <span className="font-mono text-xs font-bold text-slate-600">{Math.round(row.confidence * 100)}%</span> },
            { key: "failure", label: "失败原因", render: (row) => <p className="max-w-[420px] text-xs leading-5 text-slate-600">{row.failures.slice(0, 3).join("；") || "-"}</p> },
            { key: "trace", label: "追踪", render: (row) => <span className="text-[11px] font-bold text-slate-500">{shortAdminCode(row.traceId, "记录")}</span> },
            { key: "time", label: "时间", render: (row) => <span className="whitespace-nowrap text-xs font-semibold text-slate-500">{formatDateTime(row.createdAt)}</span> },
          ]}
        />
      </AdminSection>

      <AdminSection title="内置基线用例" description="用于固定验证核心决策链路。坏反馈沉淀用例会在运行时追加，不污染基线定义。">
        <AdminTable<AdminAgentEvalCase>
          rows={overview.baselineCases}
          rowKey={(row) => row.id}
          empty="暂无基线用例"
          columns={[
            {
              key: "case",
              label: "用例",
              render: (row) => (
                <div className="min-w-[260px]">
                  <p className="text-sm font-black text-slate-950">{row.title}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-400">{row.id}</p>
                </div>
              ),
            },
            { key: "expected", label: "期望", render: (row) => <p className="max-w-[420px] text-xs font-semibold text-slate-600">{row.expected.join("；") || "-"}</p> },
            { key: "images", label: "图片", render: (row) => <span className="font-mono text-xs font-black text-slate-600">{row.imageCount}</span> },
          ]}
        />
      </AdminSection>

      <div className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm leading-6 text-zinc-700">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          上线建议：提示词、智能助手决策或安全策略改动后先在此页触发回归；若失败用例非 0，完成追踪和坏反馈沉淀后再发布生产版本。
        </p>
      </div>
    </div>
  );
}

function getSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function formatLatency(value: number) {
  if (!value) return "-";
  if (value >= 1000) return `${Math.round(value / 100) / 10}s`;
  return `${value}ms`;
}
