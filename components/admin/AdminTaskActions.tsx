"use client";

import { useRouter } from "next/navigation";
import { App, Button, Input, Space, Typography } from "@/components/ui/shadcn-compat";
import { CloseCircleOutlined, DollarCircleOutlined, RollbackOutlined, StopOutlined } from "@/components/ui/ant-icons-compat";
import type { ReactNode } from "react";
import { useState } from "react";
import type { TaskStatusGroup } from "@/lib/task-queue";

type AdminTaskAction = "retry" | "mark_failed_refund" | "mark_failed_no_refund" | "cancel_refund";

type AdminTaskActionsProps = {
  id: string;
  sourceType: "generation";
  statusGroup: TaskStatusGroup;
  isStale?: boolean;
  compact?: boolean;
  canOperate?: boolean;
};

const actionConfig: Record<AdminTaskAction, { label: string; icon: ReactNode; defaultReason: string; danger?: boolean }> = {
  retry: {
    label: "重新处理",
    icon: <RollbackOutlined aria-hidden="true" />,
    defaultReason: "任务长时间没有完成，运营重新发起处理",
  },
  mark_failed_refund: {
    label: "结束并退灵点",
    icon: <DollarCircleOutlined aria-hidden="true" />,
    defaultReason: "任务无法继续完成，运营结束任务并退还灵点",
    danger: true,
  },
  cancel_refund: {
    label: "取消并退灵点",
    icon: <StopOutlined aria-hidden="true" />,
    defaultReason: "用户或运营取消未完成任务，并退还未结算灵点",
    danger: true,
  },
  mark_failed_no_refund: {
    label: "结束不退款",
    icon: <CloseCircleOutlined aria-hidden="true" />,
    defaultReason: "任务已产生履约成本，运营结束任务但不退还灵点",
    danger: true,
  },
};

export function AdminTaskActions({ id, sourceType, statusGroup, isStale = false, compact = false, canOperate = false }: AdminTaskActionsProps) {
  const router = useRouter();
  const { message, modal } = App.useApp();
  const [loadingAction, setLoadingAction] = useState<AdminTaskAction | null>(null);
  const [lastOutcome, setLastOutcome] = useState("");
  const finished = statusGroup === "completed" || statusGroup === "failed";
  if (!canOperate) return <Typography.Text type="secondary" className="text-xs">只读</Typography.Text>;
  const availableActions: AdminTaskAction[] = finished
    ? []
    : isStale
      ? ["retry", "mark_failed_refund", "cancel_refund", "mark_failed_no_refund"]
      : ["retry", "mark_failed_refund", "cancel_refund"];

  async function submitAction(action: AdminTaskAction, reason: string) {
    const config = actionConfig[action];
    if (loadingAction) return;
    setLoadingAction(action);
    setLastOutcome("");
    try {
      const res = await fetch(`/api/admin/generations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          sourceType,
          reason: reason.trim() || config.defaultReason,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `操作失败 (${res.status})`);
      const outcome = typeof payload.message === "string" ? payload.message : `${config.label}已提交`;
      setLastOutcome(outcome);
      message.success(outcome);
      router.refresh();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "操作失败";
      setLastOutcome(reason);
      message.error(reason);
      throw error;
    } finally {
      setLoadingAction(null);
    }
  }

  function confirmAction(action: AdminTaskAction) {
    const config = actionConfig[action];
    let reason = config.defaultReason;
    modal.confirm({
      title: config.label,
      content: (
        <Space orientation="vertical" className="w-full">
          <Typography.Text type={config.danger ? "danger" : "secondary"}>
            该操作会影响用户任务或灵点，请填写用户能理解的处理原因。
          </Typography.Text>
          <Input.TextArea
            defaultValue={reason}
            minLength={4}
            maxLength={240}
            rows={3}
            onChange={(event) => {
              reason = event.target.value;
            }}
          />
        </Space>
      ),
      okText: "确认提交",
      okButtonProps: { danger: config.danger },
      async onOk() {
        if (reason.trim().length < 4) throw new Error("请填写至少 4 个字的原因");
        await submitAction(action, reason);
      },
    });
  }

  if (!availableActions.length) {
    return <Typography.Text type="secondary">已结束</Typography.Text>;
  }

  return (
    <Space orientation="vertical" size={4}>
      <Space wrap size={compact ? 4 : 8}>
        {availableActions.map((action) => {
          const config = actionConfig[action];
          return (
            <Button
              key={action}
              size="small"
              danger={config.danger}
              icon={config.icon}
              loading={loadingAction === action}
              disabled={Boolean(loadingAction)}
              onClick={() => confirmAction(action)}
            >
              {config.label}
            </Button>
          );
        })}
      </Space>
      {lastOutcome ? <Typography.Text type="secondary" className="text-xs">{lastOutcome}</Typography.Text> : null}
    </Space>
  );
}
