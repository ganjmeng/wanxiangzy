"use client";

import {
  memo,
  useCallback,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ElementType,
} from "react";
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  LoaderIcon,
  XCircleIcon,
} from "lucide-react";
import {
  useScrollLock,
  type ToolCallMessagePartComponent,
  type ToolCallMessagePartStatus,
} from "@assistant-ui/react";
import { WorkflowApprovalCard } from "@/components/agent-v2/WorkflowApprovalCard";
import { WorkflowStatusCard, type WorkflowStatusToolResult } from "@/components/agent-v2/WorkflowStatusCard";
import type { AgentV2WorkflowApprovalInput } from "@/lib/agent-v2/workflow-approval";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const ANIMATION_DURATION = 200;

export type ToolFallbackRootProps = Omit<
  ComponentProps<typeof Collapsible>,
  "open" | "onOpenChange"
> & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
};

function ToolFallbackRoot({
  className,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
  ...props
}: ToolFallbackRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) lockScroll();
      if (!isControlled) setUncontrolledOpen(open);
      controlledOnOpenChange?.(open);
    },
    [lockScroll, isControlled, controlledOnOpenChange],
  );

  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="tool-fallback-root"
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn(
        "aui-tool-fallback-root group/tool-fallback-root w-full rounded-2xl border border-border py-3",
        "my-2",
        className,
      )}
      style={{ "--animation-duration": `${ANIMATION_DURATION}ms` } as CSSProperties}
      {...props}
    >
      {children}
    </Collapsible>
  );
}

type ToolStatus = ToolCallMessagePartStatus["type"];

const statusIconMap: Record<ToolStatus, ElementType> = {
  running: LoaderIcon,
  complete: CheckIcon,
  incomplete: XCircleIcon,
  "requires-action": AlertCircleIcon,
};

function ToolFallbackTrigger({
  toolName,
  status,
  className,
  ...props
}: ComponentProps<typeof CollapsibleTrigger> & {
  toolName: string;
  status?: ToolCallMessagePartStatus;
}) {
  const statusType = status?.type ?? "complete";
  const isRunning = statusType === "running";
  const isCancelled = status?.type === "incomplete" && status.reason === "cancelled";
  const Icon = statusIconMap[statusType];
  const meta = getToolMeta(toolName);
  const label = isCancelled ? "已取消" : isRunning ? meta.runningTitle : meta.completeTitle;

  return (
    <CollapsibleTrigger
      data-slot="tool-fallback-trigger"
      className={cn(
        "aui-tool-fallback-trigger group/trigger flex w-full items-center gap-2 px-4 text-sm transition-colors",
        className,
      )}
      {...props}
    >
      <Icon
        data-slot="tool-fallback-trigger-icon"
        className={cn(
          "aui-tool-fallback-trigger-icon size-4 shrink-0",
          isCancelled && "text-muted-foreground",
          isRunning && "animate-spin",
        )}
      />
      <span
        data-slot="tool-fallback-trigger-label"
        className={cn(
          "aui-tool-fallback-trigger-label-wrapper relative inline-block grow text-start leading-none",
          isCancelled && "text-muted-foreground line-through",
        )}
      >
        <span>{label}</span>
        {isRunning ? (
          <span
            aria-hidden
            data-slot="tool-fallback-trigger-shimmer"
            className="aui-tool-fallback-trigger-shimmer shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none"
          >
            {label}
          </span>
        ) : null}
      </span>
      <ChevronDownIcon
        data-slot="tool-fallback-trigger-chevron"
        className={cn(
          "aui-tool-fallback-trigger-chevron size-4 shrink-0 transition-transform duration-[var(--animation-duration)] ease-out",
          "group-data-[state=closed]/trigger:-rotate-90 group-data-[state=open]/trigger:rotate-0",
        )}
      />
    </CollapsibleTrigger>
  );
}

function ToolFallbackContent({
  className,
  children,
  ...props
}: ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      data-slot="tool-fallback-content"
      className={cn(
        "aui-tool-fallback-content relative overflow-hidden text-sm outline-none",
        "group/collapsible-content ease-out",
        "data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down",
        "data-[state=closed]:fill-mode-forwards data-[state=closed]:pointer-events-none",
        "data-[state=open]:duration-[var(--animation-duration)] data-[state=closed]:duration-[var(--animation-duration)]",
        className,
      )}
      {...props}
    >
      <div className="mt-3 flex flex-col gap-2 border-t border-border/80 pt-2">
        {children}
      </div>
    </CollapsibleContent>
  );
}

function ToolFallbackArgs({
  argsText,
  className,
  ...props
}: ComponentProps<"div"> & {
  argsText?: string;
}) {
  if (!argsText) return null;

  return (
    <div data-slot="tool-fallback-args" className={cn("aui-tool-fallback-args px-4", className)} {...props}>
      <p className="mb-1 text-xs font-medium text-muted-foreground">调用参数</p>
      <pre className="aui-tool-fallback-args-value whitespace-pre-wrap text-xs text-muted-foreground">
        {argsText}
      </pre>
    </div>
  );
}

function ToolFallbackResult({
  result,
  className,
  ...props
}: ComponentProps<"div"> & {
  result?: unknown;
}) {
  if (result === undefined) return null;

  return (
    <div
      data-slot="tool-fallback-result"
      className={cn("aui-tool-fallback-result border-t border-dashed px-4 pt-2", className)}
      {...props}
    >
      <p className="aui-tool-fallback-result-header font-semibold">返回结果</p>
      <pre className="aui-tool-fallback-result-content whitespace-pre-wrap text-xs text-muted-foreground">
        {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
      </pre>
    </div>
  );
}

function ToolFallbackError({
  status,
  className,
  ...props
}: ComponentProps<"div"> & {
  status?: ToolCallMessagePartStatus;
}) {
  if (status?.type !== "incomplete") return null;

  const error = status.error;
  const errorText = error ? (typeof error === "string" ? error : JSON.stringify(error)) : null;
  if (!errorText) return null;

  const isCancelled = status.reason === "cancelled";

  return (
    <div data-slot="tool-fallback-error" className={cn("aui-tool-fallback-error px-4", className)} {...props}>
      <p className="aui-tool-fallback-error-header font-semibold text-muted-foreground">
        {isCancelled ? "取消原因" : "错误信息"}
      </p>
      <p className="aui-tool-fallback-error-reason text-muted-foreground">{errorText}</p>
    </div>
  );
}

const ToolFallbackImpl: ToolCallMessagePartComponent = ({
  toolName,
  args,
  argsText,
  result,
  status,
}) => {
  if (toolName === "createWorkflowApproval") {
    if (status?.type === "running") {
      return (
        <AgentToolStatusCard
          active
          title="正在规划任务"
          description="我在理解你的目标、图片关系和输出要求，然后生成可确认的执行计划。"
        />
      );
    }
    const approval = readWorkflowApproval(args, result);
    if (approval) return <WorkflowApprovalCard approval={approval} />;
    if (isWorkflowPlanningMessageResult(result)) return <WorkflowPlanningMessageCard result={result} />;
    if (isWorkflowToolErrorResult(result, status)) {
      return <WorkflowToolErrorCard message={readWorkflowToolErrorMessage(result, status)} />;
    }
  }

  if (toolName === "getWorkflowStatus" && status?.type === "running") {
    return <AgentToolStatusCard active title="正在查询进度" description="我在读取任务状态和已生成结果。" />;
  }
  if (toolName === "getWorkflowStatus" && isWorkflowStatusResult(result)) {
    return <WorkflowStatusCard result={result} />;
  }

  if (toolName === "cancelWorkflow" && status?.type === "running") {
    return <AgentToolStatusCard active title="正在取消任务" description="我在停止后续执行并处理积分释放。" />;
  }
  if (toolName === "cancelWorkflow" && isWorkflowCancelResult(result)) {
    return <WorkflowOperationCard result={result} />;
  }

  if (isQuietContextTool(toolName)) {
    const meta = getToolMeta(toolName);
    return (
      <AgentToolStatusCard
        active={status?.type === "running"}
        title={status?.type === "running" ? meta.runningTitle : meta.completeTitle}
        description={meta.description}
      />
    );
  }

  const isCancelled = status?.type === "incomplete" && status.reason === "cancelled";

  return (
    <ToolFallbackRoot className={cn(isCancelled && "border-muted-foreground/30 bg-muted/30")}>
      <ToolFallbackTrigger toolName={toolName} status={status} />
      <ToolFallbackContent>
        <ToolFallbackError status={status} />
        <ToolFallbackArgs argsText={argsText} className={cn(isCancelled && "opacity-60")} />
        {!isCancelled ? <ToolFallbackResult result={result} /> : null}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

function readWorkflowApproval(
  args: unknown,
  result: unknown,
): AgentV2WorkflowApprovalInput | null {
  if (isWorkflowApproval(args)) return args;
  if (isRecord(result) && isWorkflowApproval(result.approval)) return result.approval;
  return null;
}

function isWorkflowApproval(value: unknown): value is AgentV2WorkflowApprovalInput {
  return isRecord(value) && value.kind === "workflow_approval";
}

function isWorkflowStatusResult(value: unknown): value is WorkflowStatusToolResult {
  return isRecord(value) && value.kind === "workflow_status";
}

function isWorkflowPlanningMessageResult(value: unknown): value is {
  state: "needs_clarification" | "failed" | "waiting_approval";
  canExecute: false;
  message: string;
} {
  return (
    isRecord(value) &&
    typeof value.message === "string" &&
    value.canExecute === false &&
    (value.state === "needs_clarification" || value.state === "failed" || value.state === "waiting_approval")
  );
}

function isWorkflowCancelResult(value: unknown): value is {
  kind: "workflow_cancel";
  ok: boolean;
  message: string;
  workflowId?: string;
  status?: string;
  releasedCredits?: number;
} {
  return isRecord(value) && value.kind === "workflow_cancel";
}

function isWorkflowToolErrorResult(
  result: unknown,
  status?: ToolCallMessagePartStatus,
) {
  if (status?.type === "incomplete") return true;
  return isRecord(result) && result.error === true;
}

function readWorkflowToolErrorMessage(
  result: unknown,
  status?: ToolCallMessagePartStatus,
) {
  const statusError = status?.type === "incomplete" ? status.error : undefined;
  const raw = [
    typeof statusError === "string" ? statusError : statusError ? JSON.stringify(statusError) : "",
    isRecord(result) && typeof result.message === "string" ? result.message : "",
  ].join("\n");

  if (/Tool input validation failed|Too small|images\.\d+\.url/i.test(raw)) {
    return "图片还没有正确进入工作流。我会改用本次会话里真实上传的图片重新规划；如果仍然失败，请等缩略图上传完成后再发送。";
  }

  return "任务规划没有完成。我已经隐藏底层错误细节，请你稍后重试，或补充图片和目标后重新发送。";
}

function WorkflowToolErrorCard({ message }: { message: string }) {
  return (
    <div className="my-2 w-full max-w-2xl rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-sm shadow-sm dark:border-amber-500/30 dark:bg-amber-950/20">
      <div className="flex items-start gap-3">
        <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
        <div className="min-w-0">
          <p className="font-medium text-foreground">规划需要重新整理</p>
          <p className="mt-1 text-muted-foreground">{message}</p>
        </div>
      </div>
    </div>
  );
}

function WorkflowPlanningMessageCard({
  result,
}: {
  result: {
    state: "needs_clarification" | "failed" | "waiting_approval";
    canExecute: false;
    message: string;
  };
}) {
  const isFailed = result.state === "failed";
  return (
    <div
      className={cn(
        "w-full max-w-2xl rounded-2xl border bg-background p-4 text-sm shadow-sm",
        "my-2",
        isFailed ? "border-destructive/30" : "border-amber-200",
      )}
    >
      <div className="flex items-start gap-3">
        {isFailed ? (
          <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
        ) : (
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
        )}
        <div>
          <p className="font-medium text-foreground">{isFailed ? "规划失败" : "需要补充一个细节"}</p>
          <p className="mt-1 text-muted-foreground">{result.message}</p>
        </div>
      </div>
    </div>
  );
}

function WorkflowOperationCard({
  result,
}: {
  result: {
    kind: "workflow_cancel";
    ok: boolean;
    message: string;
    workflowId?: string;
    status?: string;
    releasedCredits?: number;
  };
}) {
  return (
    <div
      className={cn(
        "w-full max-w-2xl rounded-2xl border bg-background p-4 text-sm shadow-sm",
        "my-2",
        result.ok ? "border-emerald-200" : "border-destructive/30",
      )}
    >
      <div className="flex items-start gap-3">
        {result.ok ? (
          <CheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        ) : (
          <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
        )}
        <div>
          <p className="font-medium text-foreground">{result.ok ? "操作完成" : "操作未完成"}</p>
          <p className="mt-1 text-muted-foreground">{result.message}</p>
          {typeof result.releasedCredits === "number" && result.releasedCredits > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">已释放积分：{result.releasedCredits}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AgentToolStatusCard({
  title,
  description,
  active = false,
}: {
  title: string;
  description: string;
  active?: boolean;
}) {
  return (
    <div className="my-2 w-full max-w-2xl rounded-2xl border border-border bg-background p-3 text-sm shadow-sm">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
            active ? "bg-primary/10 text-primary" : "bg-emerald-100 text-emerald-700",
          )}
        >
          {active ? <LoaderIcon className="size-3.5 animate-spin" /> : <CheckIcon className="size-3.5" />}
        </span>
        <div className="min-w-0">
          <p className="font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

function isQuietContextTool(toolName: string) {
  return toolName === "describeAttachedImages" || toolName === "getUserContext" || toolName === "rememberPreference";
}

function getToolMeta(toolName: string) {
  const meta: Record<string, { runningTitle: string; completeTitle: string; description: string }> = {
    createWorkflowApproval: {
      runningTitle: "正在规划任务",
      completeTitle: "已完成任务规划",
      description: "生成前会先给你确认，不会自动扣积分。",
    },
    describeAttachedImages: {
      runningTitle: "正在理解图片",
      completeTitle: "已理解图片关系",
      description: "我会结合图片角色、人物、服装和参考关系来判断下一步。",
    },
    getUserContext: {
      runningTitle: "正在读取上下文",
      completeTitle: "已读取上下文",
      description: "我会把你的偏好、品牌记忆和近期任务一起考虑。",
    },
    rememberPreference: {
      runningTitle: "正在保存偏好",
      completeTitle: "已记住偏好",
      description: "之后类似任务会优先参考这条偏好。",
    },
    getWorkflowStatus: {
      runningTitle: "正在查询进度",
      completeTitle: "已读取任务进度",
      description: "我在查看工作流状态、步骤和结果图。",
    },
    cancelWorkflow: {
      runningTitle: "正在取消任务",
      completeTitle: "已处理取消请求",
      description: "我会停止后续执行并尽量释放未使用积分。",
    },
  };

  return meta[toolName] || {
    runningTitle: "正在调用工具",
    completeTitle: "已调用工具",
    description: toolName,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const ToolFallback = memo(ToolFallbackImpl) as unknown as ToolCallMessagePartComponent & {
  Root: typeof ToolFallbackRoot;
  Trigger: typeof ToolFallbackTrigger;
  Content: typeof ToolFallbackContent;
  Args: typeof ToolFallbackArgs;
  Result: typeof ToolFallbackResult;
  Error: typeof ToolFallbackError;
};

ToolFallback.displayName = "ToolFallback";
ToolFallback.Root = ToolFallbackRoot;
ToolFallback.Trigger = ToolFallbackTrigger;
ToolFallback.Content = ToolFallbackContent;
ToolFallback.Args = ToolFallbackArgs;
ToolFallback.Result = ToolFallbackResult;
ToolFallback.Error = ToolFallbackError;

export {
  ToolFallback,
  ToolFallbackRoot,
  ToolFallbackTrigger,
  ToolFallbackContent,
  ToolFallbackArgs,
  ToolFallbackResult,
  ToolFallbackError,
};
