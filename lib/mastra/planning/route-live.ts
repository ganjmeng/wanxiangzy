export type MastraRouteLiveEvent = {
  kind?: string | null;
  event?: string | null;
  type?: string | null;
  message?: string | null;
  module?: string | null;
  action?: string | null;
  confidence?: number | null;
  metadata?: unknown;
};

export function describeAgentLiveEvent(event: MastraRouteLiveEvent | null) {
  if (!event) return "实时监听中";

  if (event.kind === "workflow_event") {
    return (
      readString(event.message, "") ||
      agentEventTypeLabel(event.type) ||
      "工作流更新"
    );
  }

  if (event.kind === "brain_trace") {
    return (
      [event.action, event.module].filter(Boolean).join(" · ") ||
      "Agent 完成了一次判断"
    );
  }

  if (event.kind === "agent_metric") {
    return (
      describeMastraRouteLiveEvent(event) ||
      agentEventTypeLabel(event.event) ||
      "Agent 状态更新"
    );
  }

  return (
    readString(event.message, "") ||
    agentEventTypeLabel(event.type || event.event) ||
    "Agent 状态更新"
  );
}

export function describeMastraRouteLiveEvent(event: MastraRouteLiveEvent) {
  if (event.event !== "agent_chat_v2_routed") return "";

  const metadata = readMetadata(event.metadata);
  const effectiveRoute = readString(
    metadata.effectiveRoute,
    readString(event.action, ""),
  );
  const requestedRoute = readString(metadata.requestedRoute, "");
  const guarded = metadata.guarded === true;
  const confidence = readConfidence(event.confidence);
  const suffix = confidence === null ? "" : ` · ${Math.round(confidence * 100)}%`;

  if (guarded) {
    return `已留在聊天模式，避免误进工作流${suffix}`;
  }

  if (effectiveRoute === "workflow_agent") {
    return `已理解为可执行视觉任务，正在规划${suffix}`;
  }

  if (effectiveRoute === "direct_chat") {
    return requestedRoute === "workflow_agent"
      ? `已切回聊天确认需求${suffix}`
      : `进入自然对话模式${suffix}`;
  }

  return `Agent 路由完成${suffix}`;
}

export function agentEventTypeLabel(type?: string | null) {
  const labels: Record<string, string> = {
    mastra_workflow_planned: "已完成任务规划",
    mastra_workflow_planning_blocked: "需要补充信息",
    mastra_workflow_planning_failed: "规划失败",
    agent_chat_v2_stream_started: "正在回复",
    agent_chat_v2_routed: "Agent 已完成路由",
    scheduled_agent_eval: "Agent 评测已运行",
    workflow_created: "已创建工作流",
    workflow_confirmed: "已确认",
    credit_reserved: "已预占积分",
    workflow_queued: "已入队",
    step_queued: "步骤已就绪",
    step_started: "步骤开始执行",
    quality_checked: "已复盘生成质量",
    step_retried: "已自动修正并重试",
    step_completed: "步骤完成",
    workflow_completed: "任务完成",
    workflow_partially_completed: "任务部分完成",
    workflow_failed: "任务失败",
    workflow_cancelled: "任务已取消",
  };
  return type ? labels[type] || type : "";
}

function readMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readConfidence(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return null;
  return Math.max(0, Math.min(1, numberValue > 1 ? numberValue / 100 : numberValue));
}

