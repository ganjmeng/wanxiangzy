"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Card, Checkbox, Input, Progress, Select, Space, Statistic, Table, Tag, Tooltip, Typography } from "@/components/ui/shadcn-compat";
import type { ColumnsType } from "@/components/ui/shadcn-compat";
import { ApiOutlined, SearchOutlined } from "@/components/ui/lucide-icons-compat";
import { AdminImagePreview } from "@/components/admin/AdminImagePreview";
import { AdminTaskActions } from "@/components/admin/AdminTaskActions";
import type { AdminTaskList, AdminTaskListItem } from "@/lib/admin/data";
import type { TaskStatusGroup } from "@/lib/task-queue";

type AdminTasksClientProps = {
  tasks: AdminTaskList;
  q: string;
  status: string;
  module: string;
  stale: boolean;
  page: number;
  pageSize: number;
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
  { value: "workflow", label: "Agent 工作流" },
];

const TASK_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export function AdminTasksClient({ tasks, q, status, module, stale, page, pageSize }: AdminTasksClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [moduleValue, setModuleValue] = useState(module);
  const [statusValue, setStatusValue] = useState(status);
  const [staleOnly, setStaleOnly] = useState(stale);
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
      <div className="admin-page-hero">
        <div>
          <Typography.Text className="admin-page-eyebrow">Tasks</Typography.Text>
          <Typography.Title level={2} className="!mb-1 !mt-1">任务中心</Typography.Title>
          <Typography.Paragraph className="!mb-0 !text-slate-500">
            统一查看生成任务和工作流任务；支持长时间未完成任务重新处理、结束任务和退还灵点。
          </Typography.Paragraph>
        </div>
        <Link href="/api/jobs/process-generations">
          <Button icon={<ApiOutlined />}>处理入口</Button>
        </Link>
      </div>

      {taskWarnings.length > 0 && <Alert type="warning" showIcon message="任务数据提示" description={taskWarnings.slice(0, 3).join("；")} />}
      {tasks.source === "fallback" && (
        <Alert type="info" showIcon message="队列表暂不可用，已自动读取生成任务和工作流任务。" />
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric title="全部匹配" value={taskTotal} note={pageNote} />
        <Metric title="排队/运行" value={running} tone="warning" note="当前页" />
        <Metric title="失败" value={failed} tone="danger" note="当前页" />
        <Metric title="长时间未完成" value={staleCount} tone="warning" note="当前页" />
      </div>

      <Card
        title="任务列表"
        extra={
          <form action="/admin/generations">
            <Space wrap>
              <Input name="q" defaultValue={q} allowClear prefix={<SearchOutlined />} placeholder="搜索任务 / 用户 / 错误" />
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

const columns: ColumnsType<AdminTaskListItem> = [
  {
    title: "任务",
    width: 290,
    render: (_, row) => (
      <Space orientation="vertical" size={0}>
        <Space size={4}>
          <StatusTag status={row.status} group={row.statusGroup} />
          <Tag>{sourceTypeLabel(row.sourceType)}</Tag>
          <Tag>编号 {shortId(row.sourceId)}</Tag>
        </Space>
        <Link href={`/admin/generations/${row.sourceId}`} className="font-semibold">{row.title}</Link>
      </Space>
    ),
  },
  { title: "输入", width: 170, render: (_, row) => <TaskThumbnails urls={row.inputThumbnails} label="输入素材" /> },
  { title: "输出", width: 170, render: (_, row) => <TaskThumbnails urls={row.resultThumbnails} label="输出结果" empty="待生成" /> },
  { title: "模块", dataIndex: "moduleLabel", width: 130, filters: moduleOptions.filter((item) => item.value).map((item) => ({ text: item.label, value: item.label })), onFilter: (value, row) => row.moduleLabel === value },
  { title: "进度", dataIndex: "progress", width: 150, sorter: (a, b) => a.progress - b.progress, render: (value: number) => <Progress percent={value} size="small" /> },
  { title: "结果", width: 90, render: (_, row) => `${row.resultCount}/${row.expectedCount}` },
  { title: "模型", dataIndex: "model", width: 150, render: (value) => value || "-" },
  { title: "灵点", dataIndex: "credits", width: 80, sorter: (a, b) => (a.credits || 0) - (b.credits || 0), render: (value) => value ?? "-" },
  { title: "处理状态", dataIndex: "isStale", width: 150, filters: [{ text: "长时间未完成", value: true }], onFilter: (value, row) => row.isStale === value, render: (_, row) => row.isStale ? <Tag color="orange">{row.staleMinutes} 分钟无进展</Tag> : "正常" },
  { title: "创建", dataIndex: "createdAt", width: 130, render: formatDateTime },
  { title: "操作", width: 270, render: (_, row) => <AdminTaskActions id={row.sourceId} sourceType={row.sourceType} statusGroup={row.statusGroup} isStale={row.isStale} compact /> },
  { title: "错误", dataIndex: "errorMessage", width: 360, className: "admin-task-error-cell", render: renderTaskError },
];

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

function sourceTypeLabel(value: string) {
  if (value === "workflow") return "工作流任务";
  return "生成任务";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function shortId(value: string) {
  return value ? value.slice(0, 8) : "-";
}

function TaskThumbnails({ urls, label, empty = "无图片" }: { urls?: string[] | null; label: string; empty?: string }) {
  const clean = Array.isArray(urls) ? urls.filter(Boolean) : [];
  if (!clean.length) return <Typography.Text type="secondary" className="text-xs">{empty}</Typography.Text>;
  const visibleCount = clean.length > 4 ? 3 : Math.min(clean.length, 4);
  const visible = clean.slice(0, visibleCount);
  const remaining = clean.length - visible.length;
  return (
    <div className="admin-task-thumb-strip" aria-label={`${label} ${clean.length} 张`}>
      {visible.map((url, index) => (
        <AdminImagePreview
          key={`${url}-${index}`}
          urls={clean}
          initialIndex={index}
          label={`${label} ${index + 1}/${clean.length}`}
          triggerClassName="admin-task-thumb-trigger"
          imageClassName="h-full w-full object-cover"
        />
      ))}
      {remaining > 0 ? (
        <AdminImagePreview
          urls={clean}
          initialIndex={visible.length}
          label={`预览更多${label}`}
          countLabel={`+${remaining}`}
          triggerClassName="admin-task-thumb-more-trigger"
        />
      ) : null}
    </div>
  );
}

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
  const trimmed = value.trim();
  const apiPrefix = trimmed.match(/#?\d*:\s*API\s*错误\s*\d+/)?.[0] || trimmed.match(/API\s*错误\s*\d+/)?.[0] || "";
  const message = extractJsonMessage(trimmed) || trimmed.replace(/^#?\d*:\s*/, "");
  const summary = apiPrefix ? `${apiPrefix}：${message}` : message;
  return summary.length > 140 ? `${summary.slice(0, 140)}...` : summary;
}

function extractJsonMessage(value: string) {
  const match = value.match(/"message"\s*:\s*"([^"]+)"/);
  return match?.[1] || "";
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
