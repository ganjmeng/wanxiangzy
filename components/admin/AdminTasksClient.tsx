"use client";
import { AdminPageHeader } from "@/components/admin/AdminPrimitives";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useMemo, useState, useTransition } from "react";
import { Alert, Button, Card, Checkbox, Input, Progress, Select, Space, Statistic, Table, Tag, Tooltip, Typography } from "@/components/ui/shadcn-compat";
import type { ColumnsType } from "@/components/ui/shadcn-compat";
import { SearchOutlined } from "@/components/ui/ant-icons-compat";
import { AdminTaskActions } from "@/components/admin/AdminTaskActions";
import { AdminImagePreview } from "@/components/admin/AdminImagePreview";
import type { AdminTaskList, AdminTaskListItem } from "@/lib/admin/data";
import type { TaskStatusGroup } from "@/lib/task-queue";
import { summarizeGenerationError } from "@/lib/studio-generation-feedback";

type AdminTasksClientProps = {
  tasks: AdminTaskList;
  q: string;
  status: string;
  module: string;
  stale: boolean;
  page: number;
  pageSize: number;
  fetchError?: string | null;
  canOperate?: boolean;
};

const statusOptions = [
  { value: "", label: "全部状态" },
  { value: "queued", label: "排队中" },
  { value: "running", label: "运行中" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
];

const moduleOptions = [
  { value: "", label: "全部模块" },
  { value: "tryon", label: "服装上身" },
  { value: "pose", label: "姿势裂变" },
  { value: "model", label: "专属模特" },
  { value: "modelBackground", label: "模特换背景" },
  { value: "grass", label: "种草图" },
  { value: "productSet", label: "商品套图" },
  { value: "garment3d", label: "服装 3D" },
  { value: "faceSwap", label: "换脸" },
  { value: "imageTranslation", label: "图片翻译" },
  { value: "materialEnhancement", label: "材质增强" },
  { value: "productRetouch", label: "商品精修" },
  { value: "generalImage", label: "通用生图" },
  { value: "allCategoryProductImage", label: "全品类商品图" },
  { value: "outfitFusion", label: "搭配融图" },
  { value: "video", label: "AI 视频" },
];

const TASK_PAGE_SIZE_OPTIONS = [20, 50] as const;
const moduleColumnFilters = moduleOptions
  .filter((item) => item.value)
  .flatMap((item) => item.value === "generalImage"
    ? [{ text: "文生图", value: "文生图" }, { text: "图生图", value: "图生图" }]
    : [{ text: item.label, value: item.label }]);

export function AdminTasksClient({ tasks, q, status, module, stale, page, pageSize, fetchError, canOperate = false }: AdminTasksClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [moduleValue, setModuleValue] = useState(module);
  const [statusValue, setStatusValue] = useState(status);
  const [staleOnly, setStaleOnly] = useState(stale);

  const columns = useMemo<ColumnsType<AdminTaskListItem>>(() => [
    {
      title: "任务",
      width: 290,
      render: (_, row) => (
        <Space orientation="vertical" size={0} className="min-w-0">
          <Space size={4} wrap>
            <StatusTag status={row.status} group={row.statusGroup} />
            <Tag>{sourceTypeLabel(row.sourceType)}</Tag>
            <Tag>编号 {shortId(row.sourceId)}</Tag>
          </Space>
          <Link href={`/admin/generations/${row.sourceId}`} className="font-semibold">
            {row.title}
          </Link>
          {row.errorMessage ? (
            <div className="max-w-full pt-1">
              {renderTaskError(row.errorMessage)}
            </div>
          ) : null}
        </Space>
      ),
    },
    { title: "输入", width: 170, render: (_, row) => <TaskThumbnails urls={row.inputThumbnails} label="输入素材" /> },
    { title: "输出", width: 170, render: (_, row) => <TaskThumbnails urls={row.resultThumbnails} label="输出结果" empty="待生成" /> },
    { title: "模块", dataIndex: "moduleLabel", width: 130, filters: moduleColumnFilters, onFilter: (value, row) => row.moduleLabel === value },
    { title: "进度", dataIndex: "progress", width: 150, sorter: (a, b) => a.progress - b.progress, render: (value: number) => <Progress percent={value} size="small" /> },
    { title: "结果", width: 90, render: (_, row) => <span className="tabular-nums">{`${row.resultCount}/${row.expectedCount}`}</span> },
    { title: "模型", dataIndex: "model", width: 150, render: (value) => value || "-" },
    { title: "灵点", dataIndex: "credits", width: 80, sorter: (a, b) => (a.credits || 0) - (b.credits || 0), render: (value) => <span className="tabular-nums">{value ?? "-"}</span> },
    { title: "处理状态", dataIndex: "isStale", width: 150, filters: [{ text: "长时间未完成", value: true }], onFilter: (value, row) => row.isStale === value, render: (_, row) => row.isStale ? <Tag color="orange"><span className="tabular-nums">{row.staleMinutes}</span> 分钟无进展</Tag> : "正常" },
    { title: "创建", dataIndex: "createdAt", width: 130, render: formatDateTime },
    { title: "操作", width: 270, render: (_, row) => <AdminTaskActions id={row.sourceId} sourceType={row.sourceType} statusGroup={row.statusGroup} isStale={row.isStale} compact canOperate={canOperate} /> },
    { title: "错误", dataIndex: "errorMessage", width: 360, className: "admin-task-error-cell", render: renderTaskError },
  ], [canOperate]);
  const taskRows = Array.isArray(tasks.rows) ? tasks.rows : [];
  const taskWarnings = Array.isArray(tasks.warnings) ? tasks.warnings : [];
  const taskTotal = Number.isFinite(tasks.total) ? tasks.total : taskRows.length;
  const safePageSize = normalizeTaskPageSize(pageSize);
  const failed = taskRows.filter((row) => row.statusGroup === "failed").length;
  const running = taskRows.filter((row) => row.statusGroup === "running" || row.statusGroup === "queued").length;
  const staleCount = taskRows.filter((row) => row.isStale).length;
  const pageNote = taskTotal > 0 ? `当前页 ${taskRows.length} 条` : "暂无匹配任务";

  function handlePageChange(nextPage: number, nextPageSize: number) {
    const safeNextPageSize = normalizeTaskPageSize(nextPageSize);
    const safeNextPage = safeNextPageSize === safePageSize ? nextPage : 1;
    startTransition(() => {
      router.push(buildTaskListUrl({ q, status, module, stale, page: safeNextPage, pageSize: safeNextPageSize }));
    });
  }

  return (
    <Space orientation="vertical" size={16} className="w-full">
      {fetchError ? (
        <div className="rounded-lg border border-[var(--admin-danger-border)] bg-[var(--admin-danger-soft)] px-4 py-2.5 text-sm font-semibold text-[var(--admin-danger)]">
          {"任务数据加载失败："}{fetchError}
          <button type="button" onClick={() => window.location.reload()} className="ml-3 underline hover:no-underline">重试</button>
        </div>
      ) : null}
      <AdminPageHeader
        eyebrow="任务中心"
        title="任务中心"
        description="统一查看生成任务；支持长时间未完成任务重新处理、结束任务和退还灵点。"
      />

      {taskWarnings.length > 0 && <Alert type="warning" showIcon message="任务数据提示" description={taskWarnings.slice(0, 3).join("；")} />}
      {tasks.source === "fallback" && (
        <Alert type="info" showIcon message="队列表暂不可用，已自动读取生成任务。" />
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric title="全部匹配" value={taskTotal} note={pageNote} />
        <Metric title="排队/运行" value={running} tone="warning" note="当前页" />
        <Metric title="失败" value={failed} tone="danger" note="当前页" />
        <Metric title="长时间未完成" value={staleCount} tone="warning" note="当前页" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-black text-[var(--admin-muted)]">快捷筛选</span>
        <QuickFilter href="/admin/generations" label="全部" active={!status && !module} />
        <QuickFilter href="/admin/generations?status=failed" label="失败" active={status === "failed"} />
        <QuickFilter href="/admin/generations?status=queued" label="排队中" active={status === "queued"} />
        <QuickFilter href="/admin/generations?status=running" label="运行中" active={status === "running"} />
        <QuickFilter href="/admin/generations?status=failed&module=tryon" label="失败·服装上身" active={status === "failed" && module === "tryon"} />
        <QuickFilter href="/admin/generations?status=failed&module=pose" label="失败·姿势裂变" active={status === "failed" && module === "pose"} />
        <QuickFilter href="/admin/generations?stale=1" label="长时间未完成" active={Boolean(stale)} />
      </div>

      <Card
        title="任务列表"
        extra={
          <form action="/admin/generations">
            <Space wrap>
              <Input name="q" defaultValue={q} allowClear prefix={<SearchOutlined aria-hidden="true" />} placeholder="搜索任务 / 用户 / 错误" aria-label="搜索任务" />
              <Select className="!w-36" options={moduleOptions} value={moduleValue} onChange={setModuleValue} popupMatchSelectWidth={false} />
              <input type="hidden" name="module" value={moduleValue} />
              <Select className="!w-32" options={statusOptions} value={statusValue} onChange={setStatusValue} popupMatchSelectWidth={false} />
              <input type="hidden" name="status" value={statusValue} />
              <input type="hidden" name="page" value="1" />
              <input type="hidden" name="pageSize" value={safePageSize} />
              {staleOnly ? <input type="hidden" name="stale" value="1" /> : null}
              <Checkbox checked={staleOnly} onChange={(event) => setStaleOnly(event.target.checked)}>只看长时间未完成</Checkbox>
              <Button htmlType="submit" type="primary">筛选</Button>
            </Space>
          </form>
        }
      >
        <Table<AdminTaskListItem>
          size="small"
          rowKey={(row) => `${row.sourceType}:${row.sourceId}`}
          columns={columns}
          dataSource={taskRows}
          rowClassName="admin-task-row"
          loading={isPending}
          tableLayout="fixed"
          scroll={{ x: 2200 }}
          pagination={{
            current: page,
            pageSize: safePageSize,
            total: taskTotal,
            showSizeChanger: true,
            pageSizeOptions: [...TASK_PAGE_SIZE_OPTIONS],
            showTotal: (total, range) => `共 ${total} 条，当前 ${range[0]}-${range[1]}`,
            onChange: handlePageChange,
          }}
          locale={{ emptyText: "暂无任务" }}
        />
      </Card>
    </Space>
  );
}

function Metric({ title, value, tone = "neutral", note }: { title: string; value: number; tone?: "neutral" | "warning" | "danger"; note?: string }) {
  const color = tone === "danger" ? "#dc2626" : tone === "warning" ? "#d97706" : "#0f172a";
  return (
    <Card>
      <Statistic title={title} value={value} styles={{ content: { color } }} />
      {note ? <Typography.Text type="secondary" className="text-xs">{note}</Typography.Text> : null}
    </Card>
  );
}

function StatusTag({ status, group }: { status: string; group: TaskStatusGroup }) {
  const color = group === "completed" ? "green" : group === "failed" ? "red" : group === "running" ? "blue" : "orange";
  return <Tag color={color}>{statusLabel(status, group)}</Tag>;
}

function statusLabel(status: string, group: TaskStatusGroup) {
  if (group === "completed") return "已完成";
  if (group === "failed") return "失败";
  if (group === "running") return "运行中";
  if (group === "queued") return "排队中";
  return status;
}

function sourceTypeLabel(_value: string) {
  return "生成任务";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function shortId(value: string) {
  return value ? value.slice(0, 8) : "-";
}

const TaskThumbnails = memo(function TaskThumbnails({ urls, label, empty = "无图片" }: { urls?: string[] | null; label: string; empty?: string }) {
  const clean = Array.isArray(urls) ? urls : [];
  if (!clean.length) return <Typography.Text type="secondary" className="text-xs">{empty}</Typography.Text>;
  return <AdminImagePreview urls={clean} label={label} imageClassName="h-full w-full object-cover" strip />;
});

function renderTaskError(value: string | null | undefined) {
  if (!value) return <Typography.Text type="secondary">-</Typography.Text>;
  const summary = summarizeTaskError(value);
  return (
    <Tooltip
      placement="topLeft"
      title={<pre className="admin-task-error-tooltip">{value}</pre>}
    >
      <Typography.Text type="danger" className="admin-task-error-text">
        {summary}
      </Typography.Text>
    </Tooltip>
  );
}

function summarizeTaskError(value: string) {
  const slotPrefix = value.trim().match(/^#\d+\s*:\s*/)?.[0] || "";
  const summary = `${slotPrefix}${summarizeGenerationError(value.replace(/^#\d+\s*:\s*/, ""))}`;
  return summary.length > 140 ? `${summary.slice(0, 140)}…` : summary;
}

function normalizeTaskPageSize(value: number) {
  return TASK_PAGE_SIZE_OPTIONS.includes(value as (typeof TASK_PAGE_SIZE_OPTIONS)[number]) ? value : TASK_PAGE_SIZE_OPTIONS[0];
}

function buildTaskListUrl(args: { q: string; status: string; module: string; stale: boolean; page: number; pageSize: number }) {
  const params = new URLSearchParams();
  if (args.q) params.set("q", args.q);
  if (args.status) params.set("status", args.status);
  if (args.module) params.set("module", args.module);
  if (args.stale) params.set("stale", "1");
  params.set("page", String(args.page));
  params.set("pageSize", String(args.pageSize));
  return `/admin/generations?${params.toString()}`;
}

function QuickFilter({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-pressed={active}
      className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-black transition ${
        active
          ? "border-[var(--admin-fg)] bg-[var(--admin-fg)] text-white"
          : "border-[var(--admin-border)] bg-[var(--admin-surface)] text-[var(--admin-fg)] hover:border-[var(--admin-border-strong)]"
      }`}
    >
      {label}
    </Link>
  );
}
