"use client";

import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  List,
  Progress,
  Row,
  Segmented,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  type ColumnsType,
} from "@/components/ui/shadcn-compat";
import {
  AlertOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  FireOutlined,
  ReloadOutlined,
} from "@/components/ui/lucide-icons-compat";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { AdminBreakdownItem, AdminCostDailyItem, AdminCostReport, AdminOverview, AdminTaskListItem } from "@/lib/admin/data";

type AdminDashboardClientProps = {
  overview: AdminOverview;
  report: AdminCostReport;
  days: number;
};

const dayOptions = [
  { label: "今天", value: 1 },
  { label: "近 7 天", value: 7 },
  { label: "近 14 天", value: 14 },
  { label: "近 30 天", value: 30 },
];

const dashboardTrendConfig = {
  tasks: { label: "任务", color: "hsl(var(--chart-1))" },
  failed: { label: "失败", color: "hsl(var(--chart-4))" },
  netCredits: { label: "净收入", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig;

const taskStatusConfig = {
  queued: { label: "排队中", color: "hsl(var(--chart-3))" },
  running: { label: "运行中", color: "hsl(var(--chart-1))" },
  completed: { label: "已完成", color: "hsl(var(--chart-2))" },
  failed: { label: "失败", color: "hsl(var(--chart-4))" },
} satisfies ChartConfig;

const moduleRankConfig = {
  count: { label: "数量", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

const modelMarginConfig = {
  margin: { label: "毛利代理", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig;

export function AdminDashboardClient({ overview, report, days }: AdminDashboardClientProps) {
  const failureRate = overview.generationHealth.failureRate;
  const fulfillmentCredits = report.metrics.generationSettledCredits + report.metrics.workflowSettledCredits;
  const taskStatusData = [
    { status: "queued", type: "排队中", value: overview.taskHealth.queued },
    { status: "running", type: "运行中", value: overview.taskHealth.running },
    { status: "completed", type: "已完成", value: overview.taskHealth.completed },
    { status: "failed", type: "失败", value: overview.taskHealth.failed },
  ].filter((item) => item.value > 0);
  const trendData = buildTrendData(report.daily);
  const moduleRank = overview.moduleStats.slice(0, 10).map((item) => ({
    module: item.label,
    count: item.count,
  }));
  const modelMargin = report.models.slice(0, 10).map((item) => ({
    model: item.label,
    margin: Math.round(item.marginCredits * 10) / 10,
  }));

  return (
    <Space orientation="vertical" size={16} className="w-full">
      <div className="admin-page-hero">
        <div>
          <Typography.Text className="admin-page-eyebrow">Console</Typography.Text>
          <Typography.Title level={2} className="!mb-1 !mt-1">
            运营总览
          </Typography.Title>
          <Typography.Paragraph className="!mb-0 !text-slate-500">
            生成任务、收入灵点、模型成本、队列健康和异常处理统一看板。
          </Typography.Paragraph>
        </div>
        <Space wrap>
          <Segmented
            value={days}
            options={dayOptions}
            onChange={(value) => {
              window.location.href = value === 7 ? "/admin" : `/admin?days=${value}`;
            }}
          />
          <Link href="/admin">
            <Button icon={<ReloadOutlined />}>刷新</Button>
          </Link>
        </Space>
      </div>

      {overview.warnings.length > 0 && (
        <Alert type="warning" showIcon message="部分数据源暂不可用" description={overview.warnings.slice(0, 3).join("；")} />
      )}
      {report.warnings.length > 0 && (
        <Alert type="info" showIcon message="报表数据源提示" description={report.warnings.slice(0, 3).join("；")} />
      )}

      <Row gutter={[12, 12]}>
        <KpiCard title="生成任务" value={overview.generationHealth.total} suffix={`今日 ${overview.generationHealth.today}`} icon={<BarChartOutlined />} />
        <KpiCard title="成功率" value={100 - failureRate} precision={1} suffix="%" tone={failureRate > 20 ? "danger" : "good"} icon={<CheckCircleOutlined />} />
        <KpiCard title="失败率" value={failureRate} precision={1} suffix="%" tone={failureRate > 15 ? "danger" : failureRate > 5 ? "warning" : "good"} icon={<AlertOutlined />} />
        <KpiCard title="净收入灵点" value={report.metrics.netCredits} tone="good" icon={<DollarOutlined />} />
        <KpiCard title="退款补偿" value={report.metrics.refundCredits} tone={report.metrics.refundCredits > 0 ? "warning" : "neutral"} icon={<FireOutlined />} />
        <KpiCard title="履约成本" value={fulfillmentCredits} icon={<ClockCircleOutlined />} />
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <Card title="每日趋势" extra={<Typography.Text type="secondary">近 {days} 天</Typography.Text>}>
            {trendData.length ? (
              <ChartContainer config={dashboardTrendConfig} className="h-[300px] w-full">
                <LineChart accessibilityLayer data={trendData} margin={{ left: 8, right: 16, top: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} tickMargin={8} width={42} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Line type="monotone" dataKey="tasks" stroke="var(--color-tasks)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="failed" stroke="var(--color-failed)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="netCredits" stroke="var(--color-netCredits)" strokeWidth={2} dot={false} />
                </LineChart>
              </ChartContainer>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无趋势数据" />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card title="任务状态">
            {taskStatusData.length ? (
              <ChartContainer config={taskStatusConfig} className="h-[300px] w-full">
                <PieChart accessibilityLayer>
                  <ChartTooltip content={<ChartTooltipContent nameKey="type" hideLabel />} />
                  <Pie data={taskStatusData} dataKey="value" nameKey="type" innerRadius={70} outerRadius={108} paddingAngle={2}>
                    {taskStatusData.map((item) => (
                      <Cell key={item.status} fill={`var(--color-${item.status})`} />
                    ))}
                  </Pie>
                  <ChartLegend content={<ChartLegendContent nameKey="status" />} />
                </PieChart>
              </ChartContainer>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务状态" />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card title="模块排行">
            {moduleRank.length ? (
              <ChartContainer config={moduleRankConfig} className="h-[320px] w-full">
                <BarChart accessibilityLayer data={moduleRank} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} />
                  <YAxis dataKey="module" type="category" tickLine={false} axisLine={false} tickMargin={8} width={112} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={4} />
                </BarChart>
              </ChartContainer>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无模块统计" />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title="模型毛利代理">
            {modelMargin.length ? (
              <ChartContainer config={modelMarginConfig} className="h-[320px] w-full">
                <BarChart accessibilityLayer data={modelMargin} margin={{ left: 8, right: 16 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="model" tickLine={false} axisLine={false} tickMargin={8} minTickGap={18} />
                  <YAxis tickLine={false} axisLine={false} tickMargin={8} width={42} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="margin" fill="var(--color-margin)" radius={4} />
                </BarChart>
              </ChartContainer>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无模型统计" />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card title="最近任务" extra={<Link href="/admin/generations">进入任务中心</Link>}>
            <Table<AdminTaskListItem>
              size="small"
              rowKey="id"
              columns={taskColumns}
              dataSource={overview.recentTasks}
              pagination={false}
              scroll={{ x: 920 }}
              locale={{ emptyText: "暂无最近任务" }}
            />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="异常入口">
            <List
              dataSource={[
                { label: "失败任务", value: overview.taskHealth.failed, href: "/admin/generations?status=failed", tone: "red" },
                { label: "排队任务", value: overview.taskHealth.queued, href: "/admin/generations?status=queued", tone: "orange" },
                { label: "运行任务", value: overview.taskHealth.running, href: "/admin/generations?status=running", tone: "blue" },
                { label: "失败锁定灵点", value: report.metrics.failedReservedCredits, href: "/admin/reports", tone: "volcano" },
              ]}
              renderItem={(item) => (
                <List.Item actions={[<Link key="open" href={item.href}>查看</Link>]}>
                  <List.Item.Meta
                    avatar={<Tag color={item.tone}>{formatNumber(item.value)}</Tag>}
                    title={item.label}
                    description="点击进入已保留筛选条件的处理队列"
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <BreakdownCard title="模块分布" rows={overview.moduleStats} />
        </Col>
        <Col xs={24} xl={12}>
          <BreakdownCard title="模型分布" rows={overview.modelStats} />
        </Col>
      </Row>
    </Space>
  );
}

function KpiCard({
  title,
  value,
  suffix,
  precision,
  tone = "neutral",
  icon,
}: {
  title: string;
  value: number;
  suffix?: string;
  precision?: number;
  tone?: "neutral" | "good" | "warning" | "danger";
  icon: React.ReactNode;
}) {
  const color = tone === "good" ? "#16a34a" : tone === "warning" ? "#d97706" : tone === "danger" ? "#dc2626" : "#0f172a";
  return (
    <Col xs={24} sm={12} xl={4}>
      <Card className="admin-kpi-card">
        <Space align="start" className="w-full justify-between">
          <Statistic title={title} value={value} precision={precision} styles={{ content: { color } }} />
          <span className="admin-kpi-icon">{icon}</span>
        </Space>
        {suffix && <Typography.Text type="secondary">{suffix}</Typography.Text>}
      </Card>
    </Col>
  );
}

const taskColumns: ColumnsType<AdminTaskListItem> = [
  {
    title: "任务",
    dataIndex: "title",
    width: 260,
    render: (_, row) => (
      <Space orientation="vertical" size={0}>
        <Space size={6}>
          <StatusTag status={row.statusGroup} label={row.status} />
          <Typography.Text type="secondary">{row.sourceType}</Typography.Text>
        </Space>
        <Link href={`/admin/generations/${row.sourceId}`} className="font-semibold">
          {row.title}
        </Link>
        <Typography.Text type="secondary" className="text-xs">
          任务编号 {row.sourceId.slice(0, 8)}
        </Typography.Text>
      </Space>
    ),
  },
  { title: "模块", dataIndex: "moduleLabel", width: 120 },
  {
    title: "进度",
    dataIndex: "progress",
    width: 130,
    render: (value: number) => <Progress percent={value} size="small" />,
  },
  {
    title: "时间",
    dataIndex: "createdAt",
    width: 140,
    render: (value: string | null) => formatDate(value),
  },
];

function BreakdownCard({ title, rows }: { title: string; rows: AdminBreakdownItem[] }) {
  return (
    <Card title={title}>
      <Table<AdminBreakdownItem>
        size="small"
        rowKey="key"
        dataSource={rows}
        pagination={false}
        columns={[
          { title: "名称", dataIndex: "label" },
          { title: "数量", dataIndex: "count", render: formatNumber },
          { title: "运行", dataIndex: "running", render: (value) => <Tag color="blue">{formatNumber(value)}</Tag> },
          { title: "失败", dataIndex: "failed", render: (value) => <Tag color={value ? "red" : "default"}>{formatNumber(value)}</Tag> },
          { title: "灵点", dataIndex: "credits", render: formatNumber },
        ]}
        locale={{ emptyText: "暂无统计样本" }}
      />
    </Card>
  );
}

function StatusTag({ status, label }: { status: string; label: string }) {
  const color = status === "completed" ? "green" : status === "failed" ? "red" : status === "running" ? "blue" : "orange";
  return <Tag color={color}>{label}</Tag>;
}

function buildTrendData(rows: AdminCostDailyItem[]) {
  return rows.map((row) => ({
    date: row.date,
    tasks: row.tasks,
    failed: row.failed,
    netCredits: Math.round(row.grossCredits - row.refundCredits),
  }));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value * 10) / 10);
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
