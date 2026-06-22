"use client";

import { useMemo } from "react";
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
import { Card, Col, Empty, Row, Table, Tag, type ColumnsType } from "@/components/ui/shadcn-compat";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { AdminBreakdownItem, AdminCostDailyItem, AdminCostReport, AdminOverview } from "@/lib/admin/data";

type AdminDashboardChartsProps = {
  overview: AdminOverview;
  report: AdminCostReport;
  days: number;
};

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

export function AdminDashboardCharts({ overview, report, days }: AdminDashboardChartsProps) {
  const taskStatusData = useMemo(
    () => [
      { status: "queued", type: "排队中", value: overview.taskHealth.queued },
      { status: "running", type: "运行中", value: overview.taskHealth.running },
      { status: "completed", type: "已完成", value: overview.taskHealth.completed },
      { status: "failed", type: "失败", value: overview.taskHealth.failed },
    ].filter((item) => item.value > 0),
    [overview.taskHealth],
  );
  const trendData = useMemo(() => buildTrendData(report.daily), [report.daily]);
  const moduleRank = useMemo(
    () => overview.moduleStats.slice(0, 10).map((item) => ({
      module: item.label,
      count: item.count,
    })),
    [overview.moduleStats],
  );
  const modelMargin = useMemo(
    () => report.models.slice(0, 10).map((item) => ({
      model: item.label,
      margin: Math.round(item.marginCredits * 10) / 10,
    })),
    [report.models],
  );

  return (
    <>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <Card title="每日趋势" extra={<span className="text-sm text-slate-500">近 {days} 天</span>}>
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
        <Col xs={24} xl={12}>
          <BreakdownCard title="模块分布" rows={overview.moduleStats} />
        </Col>
        <Col xs={24} xl={12}>
          <BreakdownCard title="模型分布" rows={overview.modelStats} />
        </Col>
      </Row>
    </>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: AdminBreakdownItem[] }) {
  const columns = useMemo<ColumnsType<AdminBreakdownItem>>(() => [
    { title: "名称", dataIndex: "label", render: (value: string) => <span className="block truncate">{value}</span> },
    { title: "数量", dataIndex: "count", render: (value) => <span className="tabular-nums">{formatNumber(value)}</span> },
    { title: "运行", dataIndex: "running", render: (value) => <Tag color="default">{formatNumber(value)}</Tag> },
    { title: "失败", dataIndex: "failed", render: (value) => <Tag color={value ? "red" : "default"}>{formatNumber(value)}</Tag> },
    { title: "灵点", dataIndex: "credits", render: (value) => <span className="tabular-nums">{formatNumber(value)}</span> },
  ], []);
  return (
    <Card title={title}>
      <Table<AdminBreakdownItem>
        size="small"
        rowKey="key"
        dataSource={rows}
        pagination={false}
        columns={columns}
        locale={{ emptyText: "暂无统计样本" }}
      />
    </Card>
  );
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
