"use client";

import { useEffect, useMemo, useState, type FC } from "react";
import { useAuiState } from "@assistant-ui/react";
import { CheckCircle2Icon, CircleIcon, WandSparklesIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/reasoning";
import { AgentThinkingLine } from "@/components/agent-v2/AgentThinkingIndicator";
import { cn } from "@/lib/utils";
import { describeAgentLiveEvent } from "@/lib/mastra/planning/route-live";

type LiveAgentEvent = {
  kind?: string;
  event?: string;
  type?: string;
  message?: string | null;
  module?: string | null;
  action?: string | null;
  confidence?: number | null;
  payload?: unknown;
  metadata?: unknown;
  created_at?: string;
};

export const AgentInlineActivity: FC = () => {
  const remoteId = useAuiState((state) => state.threadListItem.remoteId);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const lastMessageRole = useAuiState((state) => state.thread.messages.at(-1)?.role);
  const lastUserTurnKey = useAuiState((state) => {
    const messages = state.thread.messages;
    const index = messages.findLastIndex((message) => message.role === "user");
    if (index < 0) return "";
    const message = messages[index] as { id?: string };
    return message.id || `user-index:${index}`;
  });
  const [recentEvents, setRecentEvents] = useState<LiveAgentEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setRecentEvents([]);
    setOpen(false);
  }, [lastUserTurnKey]);

  useEffect(() => {
    if (!remoteId) {
      setRecentEvents([]);
      setConnected(false);
      setOpen(false);
      return;
    }

    const source = new EventSource(
      `/api/agent/events?conversationId=${encodeURIComponent(remoteId)}`,
    );
    const handleEvent = (event: MessageEvent<string>) => {
      const parsed = readLiveEvent(event);
      if (!parsed || !shouldDisplayLiveEvent(parsed)) return;
      setRecentEvents((items) => [parsed, ...items].slice(0, 10));
    };

    source.addEventListener("ready", () => setConnected(true));
    source.addEventListener("agent_metric", handleEvent);
    source.addEventListener("workflow_event", handleEvent);
    source.addEventListener("brain_trace", handleEvent);
    source.addEventListener("error", () => setConnected(false));

    return () => {
      source.close();
      setConnected(false);
    };
  }, [remoteId]);

  const shouldShowThinking = isRunning && lastMessageRole !== "assistant";
  const shouldShow = shouldShowThinking;
  const steps = useMemo(
    () => buildVisibleSteps(recentEvents, shouldShowThinking),
    [recentEvents, shouldShowThinking],
  );
  const previewText =
    steps.at(-1)?.description ||
    (connected ? "实时过程已连接" : "等待实时过程");
  const activitySubtitle = getActivitySubtitle(recentEvents[0]);
  const activityTitle = getActivityTitle(recentEvents, steps.length, shouldShowThinking);

  if (!shouldShow) return null;

  if (shouldShowThinking && !recentEvents.length) {
    return (
      <div className="mb-8 flex items-start gap-3 px-2">
        <ActivityAvatar />
        <div className="min-w-0 pt-0.5">
          <AgentThinkingLine />
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8 flex items-start gap-3 px-2">
      <ActivityAvatar />
      <div className="min-w-0 flex-1 pt-0.5">
        <ReasoningRoot
          variant="outline"
          open={open}
          onOpenChange={setOpen}
          className="mb-0 max-w-xl rounded-2xl"
        >
          <div className="flex items-center justify-between gap-3 pr-3">
            <ReasoningTrigger
              active={shouldShowThinking}
              label={activityTitle}
              className="max-w-none flex-1 px-4 py-3"
            />
            {recentEvents.length ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {recentEvents.length}
              </span>
            ) : null}
          </div>
          <ReasoningContent>
            <ReasoningText className="max-h-none ps-4">
              <div className="mb-2 text-xs text-muted-foreground">
                {activitySubtitle}
              </div>
              <LiveQualitySummary events={recentEvents} />
              <div className="space-y-1">
                {steps.map((step, index) => (
                  <div
                    key={`${step.title}-${index}`}
                    className="flex items-start gap-3 rounded-xl px-3 py-2.5 text-sm"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                        step.state === "running"
                          ? "bg-foreground text-background"
                          : step.state === "done"
                            ? "bg-emerald-500 text-white"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {step.state === "done" ? (
                        <CheckCircle2Icon className="size-3.5" />
                      ) : (
                        <CircleIcon className="size-2 fill-current" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium text-foreground">
                        {step.title}
                      </span>
                      <span className="mt-0.5 block text-muted-foreground text-xs leading-5">
                        {step.description}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </ReasoningText>
          </ReasoningContent>
        </ReasoningRoot>
      </div>
    </div>
  );
};

const ActivityAvatar: FC = () => {
  return (
    <Avatar size="sm" className="mt-1">
      <AvatarFallback className="bg-foreground text-background">
        <WandSparklesIcon className="size-3.5" />
      </AvatarFallback>
    </Avatar>
  );
};

type VisibleStep = {
  title: string;
  description: string;
  state: "done" | "running" | "pending";
};

function buildVisibleSteps(
  events: LiveAgentEvent[],
  running: boolean,
): VisibleStep[] {
  if (!events.length) {
    return [
      {
        title: "理解请求",
        description: "正在读取文字、图片和当前上下文。",
        state: "running",
      },
      {
        title: "推理下一步",
        description: "判断是直接回复，还是进入图片/工作流工具。",
        state: "pending",
      },
    ];
  }

  const ordered = [...events].reverse();
  return ordered.map((event, index) => ({
    title: eventTitle(event),
    description: describeAgentLiveEvent(event),
    state: index === ordered.length - 1 && running ? "running" : "done",
  }));
}

const LiveQualitySummary: FC<{ events: LiveAgentEvent[] }> = ({ events }) => {
  const summary = buildLiveQualitySummary(events);
  if (!summary.totalChecks && !summary.autoRetries) return null;

  return (
    <div className="mb-1 rounded-xl border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-foreground">生成质量复盘</div>
        <div className="rounded-full bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
          自动验证
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <QualityMetric label="检查" value={`${summary.totalChecks}`} />
        <QualityMetric
          label="均分"
          value={
            summary.averageScore === null
              ? "-"
              : `${Math.round(summary.averageScore * 100)}`
          }
        />
        <QualityMetric label="重试" value={`${summary.autoRetries}`} />
      </div>
      {summary.latestIssue ? (
        <div className="mt-2 truncate text-[11px] text-muted-foreground">
          最近问题：{summary.latestIssue}
        </div>
      ) : null}
    </div>
  );
};

const QualityMetric: FC<{ label: string; value: string }> = ({ label, value }) => {
  return (
    <div className="rounded-lg bg-background px-2 py-2 text-center">
      <div className="text-sm font-semibold text-foreground">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
};

function buildLiveQualitySummary(events: LiveAgentEvent[]) {
  const qualityEvents = events.filter(
    (event) => event.kind === "workflow_event" && event.type === "quality_checked",
  );
  const scores = qualityEvents
    .map((event) => readLiveNumber(readLivePayload(event).score))
    .filter((value): value is number => value !== null);
  const autoRetries = events.filter((event) => {
    if (event.kind !== "workflow_event" || event.type !== "step_retried") {
      return false;
    }
    const payload = readLivePayload(event);
    return (
      readLiveNumber(payload.score) !== null ||
      String(event.message || "").toLowerCase().includes("visual quality")
    );
  }).length;
  const latestIssue =
    qualityEvents
      .flatMap((event) => readLiveStringArray(readLivePayload(event).issues))
      .find(Boolean) || "";

  return {
    totalChecks: qualityEvents.length,
    autoRetries,
    averageScore: scores.length
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : null,
    latestIssue,
  };
}

function eventTitle(event: LiveAgentEvent) {
  if (event.kind === "brain_trace") return "推理摘要";
  if (event.kind === "workflow_event") {
    if (event.type === "quality_checked") return "质量验证";
    if (event.type === "step_retried") return "自动重试";
    return "工作流执行";
  }
  return "Agent 状态";
}

function getActivitySubtitle(event?: LiveAgentEvent) {
  if (!event) return "推理";
  const metadata = readLiveMetadata(event);
  const route = String(metadata.effectiveRoute || metadata.requestedRoute || "");
  if (route === "direct_chat") return "chat";
  if (route === "workflow_agent") return "workflow";
  if (event.kind === "brain_trace") return "reasoning";
  if (event.kind === "workflow_event") return "workflow";
  return "agent";
}

function getActivityTitle(
  events: LiveAgentEvent[],
  fallbackStepCount: number,
  running: boolean,
) {
  if (running) return "正在推理";
  if (events.some((event) => event.kind === "workflow_event")) {
    return `${events.length || fallbackStepCount} 个执行步骤`;
  }
  if (events.some((event) => event.kind === "brain_trace")) return "推理摘要";
  return `${events.length || fallbackStepCount} 个执行步骤`;
}

function shouldDisplayLiveEvent(event: LiveAgentEvent) {
  if (event.kind === "workflow_event" || event.kind === "brain_trace") return true;
  if (event.kind !== "agent_metric") return true;

  const eventName = String(event.event || event.type || "");
  if (eventName === "agent_chat_v2_stream_started") return false;
  if (eventName === "agent_chat_v2_routed") {
    const metadata = readLiveMetadata(event);
    const effectiveRoute = String(metadata.effectiveRoute || event.action || "");
    const requestedRoute = String(metadata.requestedRoute || "");
    return (
      effectiveRoute === "workflow_agent" ||
      requestedRoute === "workflow_agent" ||
      metadata.guarded === true
    );
  }

  return /workflow|quality|repair|retry|eval|health/i.test(eventName);
}

function readLiveEvent(event: MessageEvent<string>): LiveAgentEvent | null {
  try {
    return JSON.parse(event.data) as LiveAgentEvent;
  } catch {
    return null;
  }
}

function readLivePayload(event: LiveAgentEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? (event.payload as Record<string, unknown>)
    : {};
}

function readLiveMetadata(event: LiveAgentEvent): Record<string, unknown> {
  return event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
    ? (event.metadata as Record<string, unknown>)
    : {};
}

function readLiveNumber(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return null;
  return Math.max(0, Math.min(1, numberValue > 1 ? numberValue / 100 : numberValue));
}

function readLiveStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}
