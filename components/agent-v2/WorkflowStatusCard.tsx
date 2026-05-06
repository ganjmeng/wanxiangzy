"use client";

import {
  CheckCircle2Icon,
  CircleIcon,
  Clock3Icon,
  Loader2Icon,
  RefreshCwIcon,
  XCircleIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  isWorkflowCancellableStatus,
  type WorkflowStatusToolResult,
} from "@/lib/agent-v2/workflow-status";

export type { WorkflowStatusToolResult };

type WorkflowStatusCardProps = {
  result: WorkflowStatusToolResult;
  onRefresh?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
  isRefreshing?: boolean;
  isCancelling?: boolean;
  actionError?: string | null;
};

export function WorkflowStatusCard({
  result,
  onRefresh,
  onCancel,
  isRefreshing = false,
  isCancelling = false,
  actionError,
}: WorkflowStatusCardProps) {
  if (!result.found || !result.workflow) {
    return (
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-background p-4 text-sm text-muted-foreground shadow-sm">
        {result.message}
      </div>
    );
  }

  const progress = result.progress;
  const total = progress?.total || 0;
  const completed = progress?.completed || 0;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const outputs = result.outputs || [];
  const events = result.events || [];
  const canCancel = Boolean(onCancel && isWorkflowCancellableStatus(result.workflow.status));

  return (
    <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
      <div className="border-b border-border/80 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">任务状态</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{result.message}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium",
                statusTone(result.workflow.status),
              )}
            >
              {statusLabel(result.workflow.status)}
            </span>
            {onRefresh ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isRefreshing || isCancelling}
                onClick={onRefresh}
                className="h-7 gap-1.5 px-2 text-xs"
              >
                {isRefreshing ? <Loader2Icon className="size-3.5 animate-spin" /> : <RefreshCwIcon className="size-3.5" />}
                刷新
              </Button>
            ) : null}
            {canCancel ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isRefreshing || isCancelling}
                onClick={onCancel}
                className="h-7 gap-1.5 border-destructive/30 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {isCancelling ? <Loader2Icon className="size-3.5 animate-spin" /> : <XCircleIcon className="size-3.5" />}
                取消
              </Button>
            ) : null}
          </div>
        </div>

        {total > 0 ? (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>
                {completed}/{total} 步完成
              </span>
              <span>{percent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        ) : null}

        {actionError ? (
          <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {actionError}
          </div>
        ) : null}
      </div>

      {outputs.length > 0 ? (
        <div className="border-b border-border/80 p-4">
          <p className="mb-3 text-sm font-medium text-foreground">已生成结果</p>
          <div className={cn("grid gap-3", outputGridClass(outputs.length))}>
            {outputs.slice(0, 6).map((asset) => (
              <a
                key={asset.url}
                href={asset.url}
                target="_blank"
                rel="noreferrer"
                className="group relative overflow-hidden rounded-xl border border-border bg-muted"
              >
                <span className="absolute left-2 top-2 z-10 rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-medium text-foreground shadow-sm backdrop-blur">
                  {assetRoleLabel(asset.role)}
                </span>
                {asset.kind === "video" ? (
                  <video src={asset.url} className="aspect-[3/4] w-full object-cover" muted playsInline controls />
                ) : (
                  <img
                    src={asset.url}
                    alt="生成结果"
                    className="aspect-[3/4] w-full object-cover transition group-hover:scale-[1.01]"
                  />
                )}
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {events.length > 0 ? (
        <div className="border-b border-border/80 p-4">
          <p className="mb-3 text-sm font-medium text-foreground">最近进展</p>
          <div className="space-y-2">
            {events.slice(-5).map((event) => (
              <div key={event.id} className="flex gap-3 text-xs">
                <Clock3Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-foreground">{event.message || event.type}</p>
                  <p className="mt-0.5 text-muted-foreground">
                    {eventTypeLabel(event.type)} · {formatEventTime(event.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {result.steps?.length ? (
        <div className="p-4">
          <p className="mb-3 text-sm font-medium text-foreground">执行步骤</p>
          <div className="space-y-3">
            {result.steps.map((step) => {
              const Icon = stepIcon(step.status);
              return (
                <div key={step.id} className="flex gap-3 text-sm">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", stepIconTone(step.status))} />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{step.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {step.type} · {statusLabel(step.status)}
                    </p>
                    {step.quality ? (
                      <StepQualitySummary quality={step.quality} />
                    ) : null}
                    {step.errorMessage ? (
                      <p className="mt-1 text-xs text-destructive">{step.errorMessage}</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type StepQualitySummaryProps = {
  quality: NonNullable<NonNullable<WorkflowStatusToolResult["steps"]>[number]["quality"]>;
};

function StepQualitySummary({ quality }: StepQualitySummaryProps) {
  const problem = quality.checks.find((check) => check.status === "fail") ||
    quality.checks.find((check) => check.status === "warn") ||
    null;

  return (
    <div className="mt-2 rounded-xl border bg-muted/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-medium",
            quality.ok
              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
              : "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
          )}
        >
          质量 {Math.round(quality.score * 100)}
        </span>
        <span className="text-muted-foreground">
          {quality.ok ? "已通过复盘" : "已复盘，需要关注"}
        </span>
      </div>
      {problem ? (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {problem.detail}
        </p>
      ) : null}
    </div>
  );
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    needs_confirmation: "待确认",
    confirmed: "已确认",
    queued: "排队中",
    running: "生成中",
    completed: "已完成",
    partially_completed: "部分完成",
    failed: "失败",
    cancelled: "已取消",
    planned: "已规划",
    ready: "待执行",
    pending: "等待中",
    skipped: "已跳过",
  };
  return labels[status] || status;
}

function outputGridClass(count: number) {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-2";
  if (count === 3) return "grid-cols-3";
  return "grid-cols-2";
}

function assetRoleLabel(role: string) {
  if (role === "final") return "最终";
  if (role === "intermediate") return "过程";
  return role;
}

function statusTone(status: string) {
  if (status === "completed") return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  if (status === "failed") return "bg-red-50 text-red-700 ring-1 ring-red-200";
  if (status === "cancelled") return "bg-muted text-muted-foreground ring-1 ring-border";
  if (status === "running" || status === "queued" || status === "confirmed") {
    return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
  }
  return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
}

function stepIcon(status: string) {
  if (status === "completed") return CheckCircle2Icon;
  if (status === "failed" || status === "cancelled") return XCircleIcon;
  if (status === "running" || status === "queued") return Clock3Icon;
  return CircleIcon;
}

function stepIconTone(status: string) {
  if (status === "completed") return "text-emerald-600";
  if (status === "failed" || status === "cancelled") return "text-destructive";
  if (status === "running" || status === "queued") return "text-blue-600";
  return "text-muted-foreground";
}

function eventTypeLabel(type: string) {
  if (type === "quality_checked") return "已复盘生成质量";
  const labels: Record<string, string> = {
    workflow_created: "已创建",
    workflow_confirmed: "已确认",
    credit_reserved: "已预占积分",
    workflow_queued: "已入队",
    step_queued: "步骤就绪",
    step_started: "步骤开始",
    step_completed: "步骤完成",
    step_failed: "步骤失败",
    step_retried: "已自动重试",
    workflow_completed: "任务完成",
    workflow_partially_completed: "部分完成",
    workflow_failed: "任务失败",
    workflow_cancelled: "已取消",
    credit_released: "已释放积分",
  };
  return labels[type] || type;
}

function formatEventTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}
