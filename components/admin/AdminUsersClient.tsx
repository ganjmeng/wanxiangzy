"use client";

import Link from "next/link";
import { Alert, Button, Card, Input, Space, Statistic, Table, Tag, Typography } from "@/components/ui/shadcn-compat";
import type { ColumnsType } from "@/components/ui/shadcn-compat";
import { AuditOutlined, SearchOutlined } from "@/components/ui/lucide-icons-compat";
import type { AdminUserList, AdminUserListItem } from "@/lib/admin/data";

type AdminUsersClientProps = {
  users: AdminUserList;
  q: string;
};

export function AdminUsersClient({ users, q }: AdminUsersClientProps) {
  const totalCredits = users.rows.reduce((sum, row) => sum + row.credits, 0);
  const totalUsed = users.rows.reduce((sum, row) => sum + row.totalCreditsUsed, 0);
  const paused = users.rows.filter((row) => row.accountStatus === "suspended" || !row.generateEnabled).length;

  return (
    <Space orientation="vertical" size={16} className="w-full">
      <div className="admin-page-hero">
        <div>
          <Typography.Text className="admin-page-eyebrow">Users</Typography.Text>
          <Typography.Title level={2} className="!mb-1 !mt-1">用户管理</Typography.Title>
          <Typography.Paragraph className="!mb-0 !text-slate-500">
            查看用户余额、灵点消耗、生成活跃度和运营控制状态；详情页可编辑资料、调整灵点、暂停生成。
          </Typography.Paragraph>
        </div>
        <Link href="/admin/audit">
          <Button icon={<AuditOutlined />}>查看审计</Button>
        </Link>
      </div>

      {users.warnings.length > 0 && (
        <Alert type="warning" showIcon message="用户数据源提示" description={users.warnings.slice(0, 3).join("；")} />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric title="匹配用户" value={users.total} suffix={q ? `搜索：${q}` : "当前列表"} />
        <Metric title="样本余额" value={totalCredits} suffix="当前页合计" />
        <Metric title="样本消耗" value={totalUsed} suffix="当前页合计" />
        <Metric title="暂停生成" value={paused} suffix="当前页运营控制" tone={paused ? "warning" : "neutral"} />
      </div>

      <Card
        title="用户列表"
        extra={
          <form action="/admin/users">
            <Space>
              <Input name="q" defaultValue={q} allowClear prefix={<SearchOutlined />} placeholder="搜索邮箱 / 用户昵称 / 编号" />
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
          scroll={{ x: 1120 }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          locale={{ emptyText: "暂无用户" }}
        />
      </Card>
    </Space>
  );
}

const columns: ColumnsType<AdminUserListItem> = [
  {
    title: "用户",
    dataIndex: "email",
    width: 300,
    sorter: (a, b) => (a.email || "").localeCompare(b.email || ""),
    render: (_, row) => (
      <Space orientation="vertical" size={0}>
        <Typography.Text strong>{row.email || "未记录邮箱"}</Typography.Text>
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
    onFilter: (value, row) => row.accountStatus === value,
    render: (_, row) => (
      <Space orientation="vertical" size={2}>
        <StatusTag status={row.accountStatus} />
        <Tag color={row.generateEnabled ? "green" : "red"}>{row.generateEnabled ? "可生成" : "已暂停"}</Tag>
      </Space>
    ),
  },
  { title: "余额", dataIndex: "credits", width: 100, sorter: (a, b) => a.credits - b.credits, render: formatNumber },
  { title: "累计消耗", dataIndex: "totalCreditsUsed", width: 110, sorter: (a, b) => a.totalCreditsUsed - b.totalCreditsUsed, render: formatNumber },
  { title: "生成", dataIndex: "generationCount", width: 90, sorter: (a, b) => a.generationCount - b.generationCount, render: formatNumber },
  { title: "工作流", dataIndex: "workflowCount", width: 90, sorter: (a, b) => a.workflowCount - b.workflowCount, render: formatNumber },
  {
    title: "服务",
    dataIndex: "supportLevel",
    width: 100,
    filters: [
      { text: "标准", value: "standard" },
      { text: "优先", value: "priority" },
      { text: "观察", value: "watch" },
    ],
    onFilter: (value, row) => row.supportLevel === value,
    render: supportLevelLabel,
  },
  { title: "最近生成", dataIndex: "latestGenerationAt", width: 130, render: formatDateTime },
  { title: "注册", dataIndex: "createdAt", width: 130, render: formatDateTime },
];

function Metric({ title, value, suffix, tone = "neutral" }: { title: string; value: number; suffix: string; tone?: "neutral" | "warning" }) {
  return (
    <Card>
      <Statistic title={title} value={value} styles={{ content: { color: tone === "warning" ? "#d97706" : "#0f172a" } }} />
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

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
