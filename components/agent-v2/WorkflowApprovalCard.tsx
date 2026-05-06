"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2Icon,
  Clock3Icon,
  Loader2Icon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkflowStatusCard } from "@/components/agent-v2/WorkflowStatusCard";
import type { AgentV2WorkflowApprovalInput } from "@/lib/agent-v2/workflow-approval";
import {
  buildWorkflowStatusResultFromBundle,
  isWorkflowTerminalStatus,
  type WorkflowStatusBundleResponse,
  type WorkflowStatusToolResult,
} from "@/lib/agent-v2/workflow-status";
import { cn } from "@/lib/utils";

type WorkflowApprovalCardProps = {
  approval: AgentV2WorkflowApprovalInput;
};

export function WorkflowApprovalCard({ approval }: WorkflowApprovalCardProps) {
  const [state, setState] = useState<"idle" | "confirming" | "queued" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<WorkflowStatusToolResult | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<"idle" | "refreshing" | "cancelling">("idle");
  const [actionError, setActionError] = useState<string | null>(null);

  const workflowId = approval.workflowId;
  const steps = Array.isArray(approval.steps) ? approval.steps : [];
  const risks = Array.isArray(approval.risks) ? approval.risks : [];
  const inputImageCount = Array.isArray(approval.inputImages) ? approval.inputImages.length : 0;
  const liveWorkflowStatus = liveStatus?.workflow?.status;
  const shouldPoll = Boolean(workflowId && state === "queued" && !isWorkflowTerminalStatus(liveWorkflowStatus));
  const statusPreview = useMemo(() => {
    if (!approval.workflowId || !approval.workflowStatus) return null;
    return buildWorkflowStatusResultFromBundle({
      workflow: {
        id: approval.workflowId,
        user_id: "",
        conversation_id: null,
        status: approval.workflowStatus,
        intent: approval.plan?.intent || approval.module,
        summary: approval.goal,
        mode: "agent",
        input_images: approval.inputImages || [],
        final_outputs: null,
        cost_estimate: approval.costEstimate || null,
        cost_reserved: 0,
        cost_settled: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      steps: approval.workflowSteps || [],
      assets: [],
      events: [],
    });
  }, [approval]);

  const refreshWorkflow = useCallback(async (signal?: AbortSignal) => {
    if (!workflowId) return null;
    const res = await fetch(`/api/agent/workflows/${workflowId}`, { cache: "no-store", signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.workflow) {
      throw new Error(data.error || `读取任务进度失败 (${res.status})`);
    }
    const nextStatus = buildWorkflowStatusResultFromBundle(data as WorkflowStatusBundleResponse);
    setLiveStatus(nextStatus);
    setPollError(null);
    return nextStatus;
  }, [workflowId]);

  useEffect(() => {
    if (!shouldPoll) return;

    let disposed = false;
    let inFlight: AbortController | null = null;
    const tick = async () => {
      if (disposed) return;
      inFlight?.abort();
      inFlight = new AbortController();
      try {
        await refreshWorkflow(inFlight.signal);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!disposed) setPollError(err instanceof Error ? err.message : "读取任务进度失败");
      }
    };

    void tick();
    const timer = window.setInterval(tick, 2500);
    return () => {
      disposed = true;
      inFlight?.abort();
      window.clearInterval(timer);
    };
  }, [refreshWorkflow, shouldPoll]);

  async function confirmWorkflow() {
    if (!workflowId || state === "confirming" || state === "queued") return;
    setState("confirming");
    setError(null);
    try {
      const res = await fetch(`/api/agent/workflows/${workflowId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoRun: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `确认失败 (${res.status})`);
      if (data.workflow) {
        setLiveStatus(buildWorkflowStatusResultFromBundle(data as WorkflowStatusBundleResponse));
      }
      setState("queued");
    } catch (err) {
      setError(err instanceof Error ? err.message : "确认失败");
      setState("error");
    }
  }

  async function handleManualRefresh() {
    if (!workflowId || actionState !== "idle") return;
    setActionState("refreshing");
    setActionError(null);
    try {
      await refreshWorkflow();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "刷新任务进度失败");
    } finally {
      setActionState("idle");
    }
  }

  async function handleCancelWorkflow() {
    if (!workflowId || actionState !== "idle") return;
    setActionState("cancelling");
    setActionError(null);
    try {
      const res = await fetch(`/api/agent/workflows/${workflowId}/cancel`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `取消任务失败 (${res.status})`);
      if (data.workflow) {
        setLiveStatus(buildWorkflowStatusResultFromBundle(data as WorkflowStatusBundleResponse));
      } else {
        await refreshWorkflow();
      }
      setPollError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "取消任务失败");
    } finally {
      setActionState("idle");
    }
  }

  if (state === "queued" && (liveStatus || statusPreview)) {
    return (
      <div className="my-3 w-full max-w-2xl space-y-2">
        <WorkflowStatusCard
          result={liveStatus || statusPreview!}
          onRefresh={handleManualRefresh}
          onCancel={handleCancelWorkflow}
          isRefreshing={actionState === "refreshing"}
          isCancelling={actionState === "cancelling"}
          actionError={actionError}
        />
        {pollError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {pollError}，稍后会继续刷新。
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="my-3 w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
      <div className="border-b border-border/80 px-4 py-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <SparklesIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground">
                {approval.title || "生成任务确认"}
              </p>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {approval.moduleLabel || "视觉任务"}
              </span>
            </div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {approval.goal || "我已经整理好执行计划，确认后开始生成。"}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        <div className="grid gap-2 sm:grid-cols-4">
          <InfoPill label="置信度" value={`${Math.round((approval.confidence || 0) * 100)}%`} />
          <InfoPill
            label="预计积分"
            value={approval.estimatedCredits === null ? "待估算" : `${approval.estimatedCredits ?? 0}`}
          />
          <InfoPill label="参考图" value={inputImageCount ? `${inputImageCount} 张` : "无"} />
          <InfoPill label="状态" value={state === "queued" ? "已入队" : "待确认"} />
        </div>

        {steps.length > 0 ? (
          <section>
            <div className="mb-2 text-xs font-medium text-muted-foreground">执行计划</div>
            <div className="space-y-2">
              {steps.map((step, index) => (
                <div key={`${step.title}-${index}`} className="flex gap-3 rounded-xl bg-muted/55 p-3">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <CheckCircle2Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{step.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-sm leading-6 text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {risks.length > 0 ? (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
              <ShieldCheckIcon className="size-3.5" />
              生成前检查点
            </div>
            <ul className="space-y-1 text-sm leading-6">
              {risks.map((risk) => (
                <li key={risk}>{risk}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {state === "queued" ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <Clock3Icon className="size-4 shrink-0" />
            已确认并进入队列。我会按工作流执行，后续可以直接问“进度怎么样”。
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-border/80 pt-3">
          <Button
            type="button"
            disabled={!workflowId || state === "confirming" || state === "queued"}
            onClick={confirmWorkflow}
            className={cn(state === "queued" && "bg-emerald-600 text-white hover:bg-emerald-600")}
          >
            {state === "confirming" ? (
              <>
                <Loader2Icon className="size-4 animate-spin" />
                确认中
              </>
            ) : state === "queued" ? (
              "已入队"
            ) : (
              "确认并开始生成"
            )}
          </Button>
          <span className="text-xs leading-5 text-muted-foreground">
            {workflowId ? approval.reason : "当前预览还没有生成工作流 ID。"}
          </span>
        </div>
      </div>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}
