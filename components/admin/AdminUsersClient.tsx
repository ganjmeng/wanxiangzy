"use client";
import { AdminPageHeader } from "@/components/admin/AdminPrimitives";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";
import { Alert, Button, Card, Input, Space, Statistic, Table, Tag, Typography } from "@/components/ui/shadcn-compat";
import type { ColumnsType } from "@/components/ui/shadcn-compat";
import { AuditOutlined, SearchOutlined } from "@/components/ui/ant-icons-compat";
import { formatDateTime, formatNumber } from "@/components/admin/AdminPrimitives";
import type { AdminUserList, AdminUserListItem } from "@/lib/admin/data";

type AdminUsersClientProps = {
  users: AdminUserList;
  q: string;
  page: number;
  pageSize: number;
};

const USER_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export function AdminUsersClient({ users, q, page, pageSize }: AdminUsersClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const totalCredits = users.rows.reduce((sum, row) => sum + row.credits, 0);
  const totalUsed = users.rows.reduce((sum, row) => sum + row.totalCreditsUsed, 0);
  const paused = users.rows.filter((row) => row.accountStatus === "suspended" || !row.generateEnabled).length;

  const columns = useMemo<ColumnsType<AdminUserListItem>>(() => [
    {
      title: "用户",
      dataIndex: "email",
      width: 300,
      sorter: (a, b) => (a.email || "").localeCompare(b.email || ""),
      render: (_, row) => (
        <Space orientation="vertical" size={0} className="min-w-0">
          <Typography.Text strong className="block truncate">{row.email || "未记录邮箱"}</Typography.Text>
          <Link href={`/admin/users/${row.id}`}>查看详情</Link>
        </Space>
      ),
    },
    {
      title: "状态",
      width: 130,
      filters: [
        { text: "正常", value: "active" },
        { text: "观察", value: "restricted" },
        { text: "暂停", value: "suspended" },
      ],
      filterDropdownProps: { title: "仅筛选当前页" },
      onFilter: (value, row) => row.accountStatus === value,
      render: (_, row) => (
        <Space orientation="vertical" size={2}>
          <StatusTag status={row.accountStatus} />
          <Tag color={row.generateEnabled ? "green" : "red"}>{row.generateEnabled ? "可生成" : "已暂停"}</Tag>
        </Space>
      ),
    },
    { title: "余额", dataIndex: "credits", width: 100, sorter: (a, b) => a.credits - b.credits, render: (value) => <span className="tabular-nums">{formatNumber(value)}</span> },
    { title: "累计消耗", dataIndex: "totalCreditsUsed", width: 110, sorter: (a, b) => a.totalCreditsUsed - b.totalCreditsUsed, render: (value) => <span className="tabular-nums">{formatNumber(value)}</span> },
    { title: "生成", dataIndex: "generationCount", width: 90, sorter: (a, b) => a.generationCount - b.generationCount, render: (value) => <span className="tabular-nums">{formatNumber(value)}</span> },
    {
      title: "服务",
      dataIndex: "supportLevel",
      width: 100,
      filters: [
        { text: "标准", value: "standard" },
        { text: "优先", value: "priority" },
        { text: "观察", value: "watch" },
      ],
      filterDropdownProps: { title: "仅筛选当前页" },
      onFilter: (value, row) => row.supportLevel === value,
      render: supportLevelLabel,
    },
    { title: "最近生成", dataIndex: "latestGenerationAt", width: 130, render: formatDateTime },
    { title: "注册", dataIndex: "createdAt", width: 130, render: formatDateTime },
  ], []);

  return (
    <Space orientation="vertical" size={16} className="w-full">
      <AdminPageHeader
        eyebrow="用户管理"
        title="用户管理"
        description="查看用户余额、灵点消耗、生成活跃度和运营控制状态；详情页可编辑资料、调整灵点、暂停生成。表头筛选仅作用于当前页。"
        actions={
          <Link
            href="/admin/audit"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 text-sm font-semibold text-[var(--admin-fg)] shadow-sm transition-colors hover:border-[var(--admin-border-strong)] hover:text-[var(--admin-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-fg)] focus-visible:ring-offset-2"
          >
            <AuditOutlined aria-hidden="true" />
            查看审计
          </Link>
        }
      />

      {users.warnings.length > 0 && (
        <Alert type="warning" showIcon message="用户数据源提示" description={users.warnings.slice(0, 3).join("；")} />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric title="匹配用户" value={users.total} suffix={q ? `搜索：${q}` : "当前列表"} />
        <Metric title="当前页余额合计" value={totalCredits} suffix="仅统计当前页用户" />
        <Metric title="当前页消耗合计" value={totalUsed} suffix="仅统计当前页用户" />
        <Metric title="暂停生成" value={paused} suffix="当前页运营控制" tone={paused ? "warning" : "neutral"} />
      </div>

      <Card
        title="用户列表"
        extra={
          <form action="/admin/users">
            <Space>
              <input type="hidden" name="pageSize" value={pageSize} />
              <Input
                name="q"
                defaultValue={q}
                allowClear
                prefix={<SearchOutlined aria-hidden="true" />}
                placeholder="搜索用户邮箱"
                aria-label="搜索用户"
              />
              <Button htmlType="submit" type="primary">搜索</Button>
            </Space>
          </form>
        }
      >
        <Table<AdminUserListItem>
          size="small"
          rowKey="id"
          columns={columns}
          dataSource={users.rows}
          loading={isPending}
          scroll={{ x: 1120 }}
          pagination={{
            current: page,
            pageSize,
            total: users.total,
            showSizeChanger: true,
            pageSizeOptions: [...USER_PAGE_SIZE_OPTIONS],
            showTotal: (total, range) => `共 ${total} 位用户，当前 ${range[0]}-${range[1]}`,
            onChange: (nextPage, nextPageSize) => {
              const normalizedPageSize = normalizeUserPageSize(nextPageSize);
              const normalizedPage = normalizedPageSize === pageSize ? nextPage : 1;
              startTransition(() => router.push(buildUserListUrl(q, normalizedPage, normalizedPageSize)));
            },
          }}
          locale={{ emptyText: "暂无用户" }}
        />
      </Card>
    </Space>
  );
}

function normalizeUserPageSize(value: number) {
  return USER_PAGE_SIZE_OPTIONS.includes(value as (typeof USER_PAGE_SIZE_OPTIONS)[number]) ? value : 20;
}

function buildUserListUrl(q: string, page: number, pageSize: number) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return `/admin/users?${params.toString()}`;
}

function Metric({ title, value, suffix, tone = "neutral" }: { title: string; value: number; suffix: string; tone?: "neutral" | "warning" }) {
  return (
    <Card>
      <Statistic
        title={title}
        value={value}
        styles={{ content: { color: tone === "warning" ? "#d97706" : "#0f172a" } }}
      />
      <Typography.Text type="secondary">{suffix}</Typography.Text>
    </Card>
  );
}

function StatusTag({ status }: { status: string }) {
  if (status === "suspended") return <Tag color="red">暂停</Tag>;
  if (status === "restricted") return <Tag color="orange">观察</Tag>;
  return <Tag color="green">正常</Tag>;
}

function supportLevelLabel(value: string) {
  if (value === "priority") return <Tag color="blue">优先</Tag>;
  if (value === "watch") return <Tag color="orange">观察</Tag>;
  return <Tag>标准</Tag>;
}
