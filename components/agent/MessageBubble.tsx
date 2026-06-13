"use client";

import { motion } from "framer-motion";
import { Bot, User, Loader2, CheckCircle2, AlertCircle, Download, ZoomIn, RefreshCw, Copy, ChevronDown, Pencil, Check, X, ThumbsUp, ThumbsDown, Activity } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AspectRatio, ImageSize, LingyaModel } from "@/lib/api/lingya";
import type { AgentTaskBrief, ChatImage, ChatImageRole, GenerationParams, Message } from "@/lib/agent/types";
import type {
  WorkflowAssetRecord,
  WorkflowCostEstimate,
  WorkflowEventRecord,
  WorkflowInputImage,
  WorkflowRecord,
  WorkflowStatus,
  WorkflowStepRecord,
} from "@/lib/agent/workflow/types";
import { validateConfirmImageRoles } from "@/lib/agent/confirm-role-params";
import { renderMentionSegments } from "@/lib/agent/mention-parser";
import { RepairPromptPanel } from "@/components/RepairPromptPanel";
import type { RepairKind } from "@/lib/generation-repair";
import { downloadImage, generateDownloadFilename } from "@/lib/utils";
import { orderWorkflowSteps } from "@/lib/agent/workflow/order";

type Props = {
  message: Message;
  prevMessage?: Message;
  sessionImages: ChatImage[];
  onOpenImage: (url: string) => void;
  onRetry: (messageId: string) => void;
  onConfirm?: (messageId: string) => void;
  onConfirmWorkflow?: (messageId: string) => void;
  onCancelWorkflow?: (messageId: string) => void;
  onRetryWorkflowStep?: (messageId: string, stepId: string) => void;
  onSkipWorkflowStep?: (messageId: string, stepId: string) => void;
  onSelectWorkflowStepImage?: (messageId: string, stepId: string, selectedImageUrl: string) => void;
  onEditWorkflowStep?: (messageId: string, stepId: string, patch: { title?: string; params?: Record<string, unknown>; input?: Record<string, unknown> }) => void;
  onRepair?: (messageId: string, repairValue: string) => void;
  onUpdateConfirmParams?: (messageId: string, params: Partial<GenerationParams>) => void;
  onUpdateConfirmImageRole?: (messageId: string, imageIndex: number, role: ChatImageRole) => void;
  onUseAsReference?: (url: string) => void;
  onFeedback?: (messageId: string, rating: "good" | "bad", reason?: string, tags?: string[]) => void;
  onQuickAction?: (text: string) => void;
};

type WorkflowClientPayload = {
  workflow: WorkflowRecord;
  steps: WorkflowStepRecord[];
  events?: WorkflowEventRecord[];
  assets?: WorkflowAssetRecord[];
  costEstimate?: WorkflowCostEstimate;
};

const CONFIRM_MODEL_OPTIONS: Array<{ value: LingyaModel; label: string }> = [
  { value: "nano-banana-2", label: "Nano Banana" },
  { value: "gpt-image-2", label: "GPT Image" },
  { value: "nano-banana-pro", label: "Nano Pro" },
];

const CONFIRM_RATIO_OPTIONS: Array<{ value: AspectRatio; label: string }> = [
  { value: "auto", label: "智能" },
  { value: "3:4", label: "3:4" },
  { value: "4:5", label: "4:5" },
  { value: "1:1", label: "1:1" },
  { value: "9:16", label: "9:16" },
  { value: "4:3", label: "4:3" },
  { value: "16:9", label: "16:9" },
];

const CONFIRM_SIZE_OPTIONS: Array<{ value: ImageSize; label: string }> = [
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" },
];

const CONFIRM_ROLE_OPTIONS: Array<{ value: ChatImageRole; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "clothing", label: "服装" },
  { value: "reference", label: "参考" },
  { value: "face", label: "脸图" },
  { value: "background", label: "背景" },
  { value: "source", label: "原图" },
];

export function MessageBubble({ message, prevMessage, sessionImages, onOpenImage, onRetry, onConfirm, onConfirmWorkflow, onCancelWorkflow, onRetryWorkflowStep, onSkipWorkflowStep, onSelectWorkflowStepImage, onEditWorkflowStep, onRepair, onUpdateConfirmParams, onUpdateConfirmImageRole, onUseAsReference, onFeedback, onQuickAction }: Props) {
  const { role, content, images, generation, created_at } = message;
  const [copied, setCopied] = useState(false);

  if (role === "system") {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-center py-1">
        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] text-slate-400">{content}</span>
      </motion.div>
    );
  }

  const isUser = role === "user";
  const workflowPayload = !isUser ? getWorkflowPayload(message.params) : null;
  const rawAgentTimeline = !isUser ? readAgentTimeline(message.params) : [];
  const agentTimeline = !isUser ? normalizeAgentTimelineForMessage(rawAgentTimeline, workflowPayload, generation) : [];
  const hasActiveAgentTimeline = agentTimeline.some((item) => item.status === "running" || item.status === "error");
  const showAgentTimeline =
    agentTimeline.length > 0 &&
    hasActiveAgentTimeline &&
    !workflowPayload &&
    !generation;
  if (!isUser && !content && !generation && !workflowPayload && !showAgentTimeline) return null;

  // 消息分组：同角色连续消息隐藏头像
  const isGrouped = prevMessage && prevMessage.role === role;
  const confirmImages = prevMessage?.role === "user" && prevMessage.images?.length
    ? prevMessage.images
    : sessionImages;
  const traceId = !isUser ? getTraceId(message.params) : null;
  const feedback = !isUser ? getMessageFeedback(message.params) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""} ${isGrouped ? "mt-0.5" : "mt-3"}`}
    >
      {/* 头像（分组时隐藏） */}
      {isGrouped ? (
        <div className="w-7 shrink-0" />
      ) : (
        <div className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isUser ? "bg-slate-950 text-white" : "bg-gradient-to-br from-slate-700 to-slate-950 text-white shadow-sm shadow-slate-300/40"
        }`}>
          {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
        </div>
      )}

      <div className={`flex min-w-0 max-w-[88%] flex-col ${isUser ? "items-end sm:max-w-[75%]" : "items-start sm:max-w-[78%]"}`}>
        {/* 名称 + 时间（分组时只显示时间） */}
        {!isGrouped && (
          <div className={`mb-1 flex items-center gap-2 text-[11px] text-slate-400 ${isUser ? "flex-row-reverse" : ""}`}>
              <span className="font-medium">{isUser ? "你" : "工作流助手"}</span>
            <span className="text-slate-300">·</span>
            <span>{formatTime(created_at)}</span>
          </div>
        )}

        {/* 用户消息：图片在文字前 */}
        {isUser && images && images.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-1">
            {images.map((img, i) => (
              <button key={i} onClick={() => onOpenImage(img.url)}
                className="group relative h-12 w-12 overflow-hidden rounded-lg border border-[rgba(91,124,255,0.22)] shadow-sm transition-transform hover:scale-105">
                <img src={img.url} alt={`图${img.index}`} className="h-full w-full object-cover" />
                <span className="absolute bottom-0 left-0 right-0 bg-[rgba(91,124,255,0.1)] text-center text-[8px] font-bold leading-tight text-white">图{img.index}</span>
              </button>
            ))}
          </div>
        )}

        {/* 文本内容 */}
        {!isUser && showAgentTimeline && (
          <AgentRuntimeTimeline timeline={agentTimeline} compact={Boolean(content || workflowPayload || generation)} />
        )}

        {content && (
          <div className={`group/msg relative rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
            isUser
              ? "rounded-br-md bg-[rgba(91,124,255,0.1)] text-white"
              : "rounded-bl-md border border-slate-200/80 bg-white/95 text-slate-800 backdrop-blur"
          }`}>
            {isUser ? (
              <div className="whitespace-pre-wrap">
                {renderMentionSegments(content).map((seg, i) =>
                  seg.type === "mention" ? (
                    <span key={i} className="inline-flex items-center gap-0.5 rounded-md bg-white/20 px-1.5 py-0.5 font-bold text-white/90">{seg.value}</span>
                  ) : (
                    <span key={i}>{seg.value}</span>
                  )
                )}
              </div>
            ) : (
              <div className="prose-agent">
                <StreamingMarkdown content={content} done={message.streamingDone} />
              </div>
            )}

            {/* 消息操作栏 */}
            {!isUser && (
              <div className="mt-2 flex items-center gap-1 border-t border-slate-100 pt-1.5">
                <button
                  onClick={() => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                >
                  {copied ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  {copied ? "已复制" : "复制"}
                </button>
                {traceId && <AgentTracePanel traceId={traceId} />}
                {feedback && <FeedbackStatusPill feedback={feedback} />}
                {onFeedback && (
                  <div className="ml-auto flex items-center gap-0.5">
                    <button
                      onClick={() => onFeedback(message.id, "good", "结果符合预期", ["quick_positive"])}
                      className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors ${
                        feedback?.rating === "good" ? "bg-emerald-50 text-emerald-600" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      }`}
                      title="这次判断正确"
                    >
                      <ThumbsUp className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => onFeedback(message.id, "bad", "用户标记这次判断或结果不符合预期", ["quick_negative"])}
                      className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors ${
                        feedback?.rating === "bad" ? "bg-rose-50 text-rose-600" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      }`}
                      title="这次判断不对"
                    >
                      <ThumbsDown className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===== 确认生成卡片（等待用户确认） ===== */}
        {!isUser && content && onQuickAction && isAmbiguousClarifyMessage(content) && (
          <ClarifyQuickReplies onSelect={onQuickAction} />
        )}

        {workflowPayload && (
          <WorkflowExecutionCard
            payload={workflowPayload}
            onConfirm={() => onConfirmWorkflow?.(message.id)}
            onCancel={() => onCancelWorkflow?.(message.id)}
            onRetryStep={(stepId) => onRetryWorkflowStep?.(message.id, stepId)}
            onSkipStep={(stepId) => onSkipWorkflowStep?.(message.id, stepId)}
            onSelectImage={(stepId, url) => onSelectWorkflowStepImage?.(message.id, stepId, url)}
            onEditStep={(stepId, patch) => onEditWorkflowStep?.(message.id, stepId, patch)}
            onOpenImage={onOpenImage}
            onUseAsReference={onUseAsReference}
            onQuickAction={onQuickAction}
          />
        )}

        {generation && generation.status === "pending" && generation._confirmData && (
          <div className="mt-2 w-full max-w-xl rounded-2xl border border-amber-200 bg-gradient-to-br from-white via-amber-50/30 to-[var(--codex-accent-soft)]/30 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-900">方案确认</p>
                <p className="text-[11px] text-slate-500">确认前可修改参数、图片角色和最终提示词</p>
              </div>
              <div className="rounded-lg bg-amber-100 px-3 py-1.5 text-center">
                <p className="text-lg font-black text-amber-700">{generation.creditsUsed || 0}</p>
                <p className="text-[10px] text-amber-600">灵点</p>
              </div>
            </div>
            <ConfirmTaskTicket
              moduleName={generation.module || "图像生成"}
              images={confirmImages}
              params={generation._confirmData.params}
              jobPayload={generation._confirmData.jobPayload}
              credits={generation.creditsUsed || generation._confirmData.creditsCost}
            />
            <ConfirmParamsEditor
              messageId={message.id}
              params={readConfirmParams(generation._confirmData.params)}
              onChange={onUpdateConfirmParams}
            />
            <ConfirmPromptEditor
              messageId={message.id}
              prompt={readConfirmParams(generation._confirmData.params).prompt || ""}
              onChange={onUpdateConfirmParams}
            />
            <ConfirmImageRoleEditor
              messageId={message.id}
              images={confirmImages}
              onPreview={onOpenImage}
              onChange={onUpdateConfirmImageRole}
            />
            <ConfirmRoleIssues
              issues={validateConfirmImageRoles(generation._confirmData.module, generation._confirmData.params, confirmImages)}
            />
            <ConfirmIntentBrief
              moduleName={generation.module || "\u56fe\u50cf\u751f\u6210"}
              images={confirmImages}
              params={generation._confirmData.params}
              jobPayload={generation._confirmData.jobPayload}
              taskBrief={generation._confirmData.taskBrief}
            />
            <ConfirmTaskPlanV2
              moduleName={generation.module || "图像生成"}
              params={readConfirmParams(generation._confirmData.params)}
              credits={generation.creditsUsed || generation._confirmData.creditsCost}
            />
            <button
              onClick={() => {
                if (!generation._confirmData) return;
                if (!hasConfirmRoleErrors(generation._confirmData.module, generation._confirmData.params, confirmImages)) {
                  onConfirm?.(message.id);
                }
              }}
              disabled={!generation._confirmData || hasConfirmRoleErrors(generation._confirmData.module, generation._confirmData.params, confirmImages)}
              className={`sticky bottom-2 z-10 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white shadow-lg transition-opacity ${
                !generation._confirmData || hasConfirmRoleErrors(generation._confirmData.module, generation._confirmData.params, confirmImages)
                  ? "cursor-not-allowed bg-slate-300 shadow-none"
                  : "bg-gradient-to-r from-slate-700 to-slate-950 shadow-slate-300/40 hover:opacity-90"
              }`}
            >
              <Activity className="h-4 w-4" />
              确认生成
            </button>
          </div>
        )}

        {/* ===== 生成中卡片 ===== */}
        {generation && generation.status === "generating" && (
          <GenerationLoadingGrid
            count={getExpectedGenerationCount(generation)}
            progress={generation.progress}
            label={generation.module || "图像生成"}
          />
        )}

        {/* 生成完成 */}
        {generation && generation.status === "completed" && generation.resultUrls.length > 0 && (
          <div className="mt-1.5 w-full max-w-2xl overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-white via-emerald-50/35 to-[var(--codex-accent-soft)]/30 p-3 shadow-sm">
            <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm font-black text-slate-900">生成完成</span>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                    {generation.resultUrls.length} 张
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">可以下载、设为参考图，或基于当前结果继续创作。</p>
              </div>
              <div className="flex flex-wrap justify-end gap-1">
                {generation.creditsUsed ? <span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-100">消耗 {generation.creditsUsed} 灵点</span> : null}
                {generation.module && <span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-bold text-slate-500 ring-1 ring-slate-100">{generation.module}</span>}
              </div>
            </div>
            <ResultImageGrid
              urls={generation.resultUrls}
              onOpenImage={onOpenImage}
              onUseAsReference={onUseAsReference}
              onEditImage={(url) => {
                onUseAsReference?.(url);
                onQuickAction?.("基于这张图继续编辑，保持主体一致，按我的下一句要求调整。");
              }}
            />
            {/* 快捷操作按钮 */}
            {onRepair && generation._lastRunData && (
              <RepairPromptPanel
                kind={getGenerationRepairKind(generation._lastRunData.module)}
                priorityValues={getPriorityRepairValues(generation._lastRunData.module, generation._lastRunData.taskBrief?.risks || [])}
                onRepair={(repairValue) => onRepair(message.id, repairValue)}
                className="mt-2 shadow-sm"
              />
            )}
            <div className="mt-2 flex flex-wrap gap-1.5 rounded-xl border border-white/80 bg-white/70 p-2">
              <QuickAction icon={<RefreshCw className="h-3 w-3" />} label="重新生成" onClick={() => onRetry(message.id)} />
              <QuickAction
                icon={<Download className="h-3 w-3" />}
                label="全部下载"
                onClick={() => generation.resultUrls.forEach((url, i) => downloadImage(url, generateDownloadFilename("agent", i)))}
              />
              <QuickAction
                icon={<Activity className="h-3 w-3" />}
                label={generation.resultUrls.length > 1 ? "再生成一组" : "再生成一张"}
                variant="primary"
                onClick={() => onRetry(message.id)}
              />
              {generation.resultUrls[0] && onUseAsReference && (
                <QuickAction
                  icon={<ZoomIn className="h-3 w-3" />}
                  label="用作参考图"
                  onClick={() => onUseAsReference(generation.resultUrls[0])}
                />
              )}
            </div>
            <GenerationFollowupActions
              generation={generation}
              onUseAsReference={onUseAsReference}
              onQuickAction={onQuickAction}
            />
          </div>
        )}

        {/* 生成失败 */}
        {generation && generation.status === "failed" && (
          <div className="mt-1.5 w-full max-w-sm overflow-hidden rounded-xl border border-red-200 bg-gradient-to-br from-white to-red-50/50">
            <div className="px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-red-100">
                  <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-red-700">生成失败</p>
                  <p className="truncate text-[10px] text-red-500">{generation.error || "未知错误"}</p>
                </div>
              </div>
              <div className="mt-2 rounded-lg border border-red-100 bg-white/80 px-2.5 py-2 text-[11px] leading-relaxed text-slate-600">
                <p>不会自动再次扣费；点击重新生成会重新进入确认流程。</p>
                <p className="text-slate-400">如果已进入第三方生成队列，灵点以服务端记录为准。</p>
              </div>
              <FailureCreditNotice generation={generation} />
              <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
                <button onClick={() => onRetry(message.id)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-red-50 py-2 text-xs font-bold text-red-600 transition-colors hover:bg-red-100">
                  <RefreshCw className="h-3 w-3" /> 重新生成
                </button>
                {onQuickAction && (
                  <button
                    type="button"
                    onClick={() => onQuickAction(`这次生成失败了，请根据错误信息帮我修复方案并重新进入确认：${generation.error || "未知错误"}`)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white py-2 text-xs font-bold text-[var(--codex-accent)] ring-1 ring-[rgba(91,124,255,0.18)] transition-colors hover:bg-[rgba(91,124,255,0.12)]"
                  >
                    <Activity className="h-3 w-3" /> 修复方案
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 分组消息的时间（仅最后一条显示） */}
        {isGrouped && (
          <span className="mt-0.5 text-[10px] text-slate-300 opacity-0 transition-opacity group-hover:opacity-100">
            {formatTimeShort(created_at)}
          </span>
        )}
      </div>
    </motion.div>
  );
}

function GenerationLoadingGrid({
  count,
  progress,
  label,
  compact = false,
}: {
  count: number;
  progress?: number;
  label: string;
  compact?: boolean;
}) {
  const itemCount = Math.min(Math.max(Math.round(count) || 1, 1), 8);
  const safeProgress = Math.min(Math.max(Math.round(progress ?? 18), 5), 98);
  const stage = getGenerationStageText(safeProgress, itemCount, label);
  return (
    <div className={`${compact ? "mt-1.5" : "mt-1.5"} w-full ${compact ? "max-w-md" : "max-w-2xl"}`} aria-live="polite">
      <div className="mb-2 flex items-center gap-2 px-0.5">
        <ThinkingSignal />
        <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-[var(--codex-accent)]">{stage}</span>
        <span className="text-[11px] font-semibold tabular-nums text-slate-400">{safeProgress}%</span>
      </div>
      <div className={getResultGridClass(itemCount)}>
        {Array.from({ length: itemCount }).map((_, index) => (
          <div
            key={index}
            className={`gen-card relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-br from-slate-100 via-[var(--codex-accent-soft)] to-[var(--codex-accent-soft)] shadow-sm ${
              itemCount === 1 ? "min-h-[320px]" : compact ? "min-h-[150px]" : "min-h-[210px]"
            }`}
            style={{ aspectRatio: "3 / 4" }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/45 to-transparent"
              style={{ animation: "gen-shimmer 2s ease-in-out infinite", backgroundSize: "200% 100%" }} />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <div className="relative flex h-11 w-11 items-center justify-center">
                <div className="gen-ring absolute inset-0 rounded-full bg-[rgba(91,124,255,0.1)]" />
                <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-white/85 shadow-lg backdrop-blur-sm">
                  <Activity className="gen-icon h-5 w-5 text-[var(--codex-accent)]" />
                </div>
              </div>
              <span className="text-[11px] font-bold text-slate-500">{getLoadingTileLabel(index, itemCount, safeProgress)}</span>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/60">
              <div
                className="h-full rounded-r-full bg-gradient-to-r from-slate-700 to-slate-950 transition-all duration-700"
                style={{ width: `${safeProgress}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <GenerationAnimationStyles />
    </div>
  );
}

function WorkflowStepInlineLoading({ step, events }: { step: WorkflowStepRecord; events?: WorkflowEventRecord[] }) {
  const progress = getWorkflowStepProgress(step, events);
  const latestProgress = getLatestWorkflowStepProgressEvent(step.id, events);
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white/85 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <ThinkingSignal />
        <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-slate-600">
          {latestProgress?.message || getWorkflowStepLoadingLabel(step)}
        </span>
        <span className="text-[10px] font-semibold tabular-nums text-slate-400">{progress}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-slate-700 to-slate-950 transition-all duration-700"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function getWorkflowStepProgress(step: WorkflowStepRecord, events?: WorkflowEventRecord[]) {
  const latestProgress = getLatestWorkflowStepProgressEvent(step.id, events);
  const value = latestProgress ? Number(latestProgress.payload?.progress) : NaN;
  if (Number.isFinite(value)) return Math.min(Math.max(Math.round(value), 0), 99);
  return step.status === "queued" ? 1 : 8;
}

function getLatestWorkflowStepProgressEvent(stepId: string, events?: WorkflowEventRecord[]) {
  const list = events || [];
  for (let index = list.length - 1; index >= 0; index--) {
    const event = list[index];
    if (event.step_id === stepId && event.type === "step_progress") return event;
  }
  return null;
}

function getGenerationStageText(progress: number, count: number, label: string) {
  if (progress < 14) return "整理素材和生成参数...";
  if (progress < 32) return count > 1 ? `准备生成 ${count} 张图片...` : "准备生成图片...";
  if (progress < 72) return count > 1 ? `正在生成 ${count} 张图片...` : `${label}生成中...`;
  if (progress < 92) return "校验画面质量和结果地址...";
  return "整理结果...";
}

function getLoadingTileLabel(index: number, count: number, progress: number) {
  if (progress < 28) return count > 1 ? `等待第 ${index + 1} 张` : "等待生成";
  if (progress < 88) return count > 1 ? `第 ${index + 1} 张生成中` : "生成中";
  return count > 1 ? `第 ${index + 1} 张校验中` : "校验中";
}

function GenerationAnimationStyles() {
  return (
    <style jsx>{`
      @keyframes gen-shimmer {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
      }
      @keyframes gen-ring-pulse {
        0%, 100% { transform: scale(0.82); opacity: 0.35; }
        50% { transform: scale(1.18); opacity: 0.7; }
      }
      @keyframes gen-icon-float {
        0%, 100% { transform: translateY(0) rotate(0deg); }
        50% { transform: translateY(-2px) rotate(8deg); }
      }
      .gen-ring {
        animation: gen-ring-pulse 1.8s ease-in-out infinite;
      }
      .gen-icon {
        animation: gen-icon-float 1.9s ease-in-out infinite;
      }
    `}</style>
  );
}

function ResultImageGrid({
  urls,
  onOpenImage,
  onUseAsReference,
  onEditImage,
  fit = "cover",
}: {
  urls: string[];
  onOpenImage: (url: string) => void;
  onUseAsReference?: (url: string) => void;
  onEditImage?: (url: string) => void;
  fit?: "cover" | "contain";
}) {
  const safeUrls = urls.filter(Boolean);
  if (safeUrls.length === 0) return null;
  return (
    <div className={getResultGridClass(safeUrls.length)}>
      {safeUrls.map((url, index) => (
        <div
          key={`${url}-${index}`}
          onClick={() => onOpenImage(url)}
          className="group relative cursor-zoom-in overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
        >
          <span className="absolute left-2 top-2 z-10 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur">
            图 {index + 1}
          </span>
          <img
            src={url}
            alt={`结果 ${index + 1}`}
            className={getResultImageClass(safeUrls.length, fit)}
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/10 group-hover:opacity-100">
            <ZoomIn className="h-5 w-5 text-white drop-shadow" />
          </div>
          <ImageResultActions
            url={url}
            index={index}
            onUseAsReference={onUseAsReference}
            onEditImage={onEditImage}
          />
        </div>
      ))}
    </div>
  );
}

function WorkflowResultActions({
  urls,
  onUseAsReference,
  onQuickAction,
}: {
  urls: string[];
  onUseAsReference?: (url: string) => void;
  onQuickAction?: (text: string) => void;
}) {
  const safeUrls = urls.filter(Boolean);
  const firstUrl = safeUrls[0];
  if (safeUrls.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-100 bg-slate-50/70 p-2">
      <QuickAction
        icon={<Download className="h-3 w-3" />}
        label={safeUrls.length > 1 ? "全部下载" : "下载图片"}
        onClick={() => safeUrls.forEach((url, index) => downloadImage(url, generateDownloadFilename("workflow", index)))}
      />
      {firstUrl && onUseAsReference && (
        <QuickAction
          icon={<Activity className="h-3 w-3" />}
          label="设为参考图"
          onClick={() => onUseAsReference(firstUrl)}
        />
      )}
      {firstUrl && onQuickAction && (
        <QuickAction
          icon={<Pencil className="h-3 w-3" />}
          label="继续编辑"
          variant="primary"
          onClick={() => {
            onUseAsReference?.(firstUrl);
            onQuickAction("基于刚生成的结果继续优化，保持主体和风格一致，我会补充新的修改要求。");
          }}
        />
      )}
    </div>
  );
}

function WorkflowResultSection({
  payload,
  urls,
  onOpenImage,
  onUseAsReference,
  onQuickAction,
}: {
  payload: WorkflowClientPayload;
  urls: string[];
  onOpenImage: (url: string) => void;
  onUseAsReference?: (url: string) => void;
  onQuickAction?: (text: string) => void;
}) {
  const safeUrls = urls.filter(Boolean);
  const meta = getWorkflowResultMeta(payload, safeUrls.length);
  if (safeUrls.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-white via-emerald-50/35 to-[var(--codex-accent-soft)]/30 p-3 shadow-sm">
      <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <p className="text-sm font-black text-slate-900">{meta.title}</p>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
              {safeUrls.length} 张
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{meta.detail}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {meta.chips.map((chip) => (
            <span key={chip} className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-bold text-slate-500 ring-1 ring-slate-100">
              {chip}
            </span>
          ))}
        </div>
      </div>

      <WorkflowResultHealth payload={payload} />
      <WorkflowQualitySummary payload={payload} />

      <ResultImageGrid
        urls={safeUrls}
        onOpenImage={onOpenImage}
        onUseAsReference={onUseAsReference}
        fit={shouldContainWorkflowResults(payload) ? "contain" : "cover"}
        onEditImage={(imageUrl) => {
          onUseAsReference?.(imageUrl);
          onQuickAction?.("基于这张图继续编辑，保持主体一致，按我的下一句要求调整。");
        }}
      />
      <div className="mt-2">
        <WorkflowResultActions
          urls={safeUrls}
          onUseAsReference={onUseAsReference}
          onQuickAction={onQuickAction}
        />
      </div>
      <WorkflowFollowupActions
        payload={payload}
        urls={safeUrls}
        onUseAsReference={onUseAsReference}
        onQuickAction={onQuickAction}
      />
    </div>
  );
}

function WorkflowResultHealth({ payload }: { payload: WorkflowClientPayload }) {
  const { workflow, steps } = payload;
  const failedSteps = steps.filter((step) => step.status === "failed");
  const waitingSteps = steps.filter((step) => step.status === "waiting_user");
  const completed = steps.filter((step) => ["completed", "skipped"].includes(step.status)).length;
  if (workflow.status === "completed" && failedSteps.length === 0 && waitingSteps.length === 0) return null;

  const tone = failedSteps.length > 0
    ? "border-rose-100 bg-rose-50 text-rose-700"
    : waitingSteps.length > 0
      ? "border-amber-100 bg-amber-50 text-amber-700"
      : "border-slate-100 bg-slate-50 text-slate-600";
  const title = failedSteps.length > 0
    ? `${failedSteps.length} 个步骤需要修复`
    : waitingSteps.length > 0
      ? `${waitingSteps.length} 个步骤等待选择`
      : `已完成 ${completed}/${steps.length} 步`;
  const detail = failedSteps.length > 0
    ? failedSteps.map((step) => step.title || getWorkflowToolLabel(step.type)).slice(0, 3).join("、")
    : waitingSteps.length > 0
      ? waitingSteps.map((step) => step.title || getWorkflowToolLabel(step.type)).slice(0, 3).join("、")
      : "可先使用当前结果，也可以继续等待或重试剩余步骤。";

  return (
    <div className={`mb-2 flex items-start gap-2 rounded-xl border px-2.5 py-2 text-[11px] ${tone}`}>
      {failedSteps.length > 0 ? <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <div className="min-w-0">
        <p className="font-bold">{title}</p>
        <p className="mt-0.5 truncate opacity-80">{detail}</p>
      </div>
    </div>
  );
}

function WorkflowQualitySummary({ payload }: { payload: WorkflowClientPayload }) {
  const qualityItems = payload.steps
    .map((step) => ({ step, quality: step.quality }))
    .filter((item): item is { step: WorkflowStepRecord; quality: NonNullable<WorkflowStepRecord["quality"]> } => Boolean(item.quality));

  if (qualityItems.length === 0) return null;

  const normalizedScores = qualityItems.map((item) => normalizeQualityScore(item.quality.score));
  const averageScore = Math.round(
    (normalizedScores.reduce((sum, score) => sum + score, 0) / Math.max(1, normalizedScores.length)) * 100
  );
  const failedChecks = qualityItems.flatMap(({ step, quality }) =>
    (Array.isArray(quality.checks) ? quality.checks : [])
      .filter((check) => check.status !== "pass")
      .map((check) => ({ step, check }))
  );
  const failedCount = qualityItems.filter((item) => !item.quality.ok).length;
  const tone = failedCount > 0 || averageScore < 72
    ? "border-amber-100 bg-amber-50/80 text-amber-800"
    : "border-emerald-100 bg-emerald-50/75 text-emerald-800";
  const title = failedCount > 0
    ? `质量自检发现 ${failedCount} 个步骤需要注意`
    : `质量自检通过，综合 ${averageScore} 分`;

  return (
    <div className={`mb-2 rounded-xl border px-2.5 py-2 text-[11px] ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {failedCount > 0 ? <AlertCircle className="h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate font-bold">{title}</span>
        </div>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-black">
          {qualityItems.length} 项检查
        </span>
      </div>
      {failedChecks.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {failedChecks.slice(0, 4).map(({ step, check }, index) => (
            <div key={`${step.id}-${check.label}-${index}`} className="flex gap-1.5 leading-4">
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${check.status === "fail" ? "bg-rose-500" : "bg-amber-500"}`} />
              <span className="min-w-0">
                <span className="font-semibold">{step.title || getWorkflowToolLabel(step.type)}：</span>
                <span className="opacity-80">{check.label}，{check.detail}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function normalizeQualityScore(score: number) {
  if (!Number.isFinite(score)) return 0;
  const normalized = score > 1 ? score / 100 : score;
  return Math.max(0, Math.min(1, normalized));
}

function WorkflowFollowupActions({
  payload,
  urls,
  onUseAsReference,
  onQuickAction,
}: {
  payload: WorkflowClientPayload;
  urls: string[];
  onUseAsReference?: (url: string) => void;
  onQuickAction?: (text: string) => void;
}) {
  if (!onQuickAction) return null;
  const firstUrl = urls[0];
  const actions = getWorkflowFollowupActions(payload, urls.length);
  if (actions.length === 0) return null;

  const runAction = (prompt: string) => {
    if (firstUrl) onUseAsReference?.(firstUrl);
    onQuickAction(prompt);
  };

  return (
    <div className="mt-2 rounded-xl border border-white/80 bg-white/70 p-2">
      <p className="mb-1.5 text-[10px] font-bold text-slate-400">接下来可以</p>
      <div className="flex flex-wrap gap-1.5">
        {actions.map((action, index) => (
          <QuickAction
            key={action.label}
            icon={action.icon}
            label={action.label}
            variant={index === 0 ? "primary" : "default"}
            onClick={() => runAction(action.prompt)}
          />
        ))}
      </div>
    </div>
  );
}

function GenerationFollowupActions({
  generation,
  onUseAsReference,
  onQuickAction,
}: {
  generation: NonNullable<Message["generation"]>;
  onUseAsReference?: (url: string) => void;
  onQuickAction?: (text: string) => void;
}) {
  if (!onQuickAction || generation.resultUrls.length === 0) return null;
  const firstUrl = generation.resultUrls[0];
  const actions = getGenerationFollowupActions(generation);
  if (actions.length === 0) return null;

  const runAction = (prompt: string) => {
    onUseAsReference?.(firstUrl);
    onQuickAction(prompt);
  };

  return (
    <div className="mt-2 rounded-xl border border-white/80 bg-white/70 p-2">
      <p className="mb-1.5 text-[10px] font-bold text-slate-400">下一步</p>
      <div className="flex flex-wrap gap-1.5">
        {actions.map((action, index) => (
          <QuickAction
            key={action.label}
            icon={action.icon}
            label={action.label}
            variant={index === 0 ? "primary" : "default"}
            onClick={() => runAction(action.prompt)}
          />
        ))}
      </div>
    </div>
  );
}

function ImageResultActions({
  url,
  index,
  onUseAsReference,
  onEditImage,
}: {
  url: string;
  index: number;
  onUseAsReference?: (url: string) => void;
  onEditImage?: (url: string) => void;
}) {
  return (
    <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          downloadImage(url, generateDownloadFilename("agent", index));
        }}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-white/92 text-slate-700 shadow transition-colors hover:bg-white hover:text-[var(--codex-accent)]"
        title="下载"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
      {onEditImage && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onEditImage(url);
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/92 text-slate-700 shadow transition-colors hover:bg-white hover:text-[var(--codex-accent)]"
          title="继续编辑"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      {onUseAsReference && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onUseAsReference(url);
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/92 text-slate-700 shadow transition-colors hover:bg-white hover:text-[var(--codex-accent)]"
          title="设为参考图"
        >
          <Activity className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function getResultGridClass(count: number) {
  if (count <= 1) return "grid w-full max-w-xl grid-cols-1 gap-2";
  if (count === 2) return "grid w-full max-w-2xl grid-cols-2 gap-2";
  return "grid w-full max-w-2xl grid-cols-2 gap-2";
}

function getResultImageClass(count: number, fit: "cover" | "contain") {
  if (count <= 1) return "max-h-[620px] w-full object-contain";
  if (fit === "contain") return "aspect-[3/4] w-full bg-white object-contain p-1";
  return "aspect-[3/4] w-full object-cover";
}

function getExpectedGenerationCount(generation: NonNullable<Message["generation"]>) {
  const params = generation._lastRunData?.params || generation._confirmData?.params || {};
  return Math.min(Math.max(Number(params.count || params.genCount || params.gen_count || 1) || 1, 1), 4);
}

function getWorkflowExpectedImageCount(steps: WorkflowStepRecord[]) {
  const detailSectionCount = steps.filter((step) => step.type === "commerce_detail_section").length;
  if (detailSectionCount > 1) return Math.min(detailSectionCount, 8);
  const activeStep = steps.find((step) => ["running", "queued"].includes(step.status));
  const source = activeStep || steps.find((step) => ["pending", "ready"].includes(step.status)) || steps[0];
  if (!source) return 1;
  return readWorkflowStepParams(source.params).count;
}

function getWorkflowProgress(steps: WorkflowStepRecord[], events?: WorkflowEventRecord[]) {
  if (steps.length === 0) return 12;
  const done = steps.filter((step) => ["completed", "skipped"].includes(step.status)).length;
  const active = steps.find((step) => ["running", "queued"].includes(step.status));
  const running = active ? getWorkflowStepProgress(active, events) / 100 : 0;
  return Math.min(96, Math.max(1, Math.round(((done + running) / steps.length) * 100)));
}

function getActiveWorkflowLoadingLabel(steps: WorkflowStepRecord[], fallback: string) {
  const active = steps.find((step) => step.status === "running") || steps.find((step) => step.status === "queued");
  return active ? getWorkflowStepLoadingLabel(active) : fallback;
}

function getWorkflowStepLoadingLabel(step: WorkflowStepRecord) {
  const title = step.title || getWorkflowToolLabel(step.type);
  if (step.status === "queued") return `${title}等待执行...`;
  if (step.type === "commerce_detail_section") return `${title}生成详情页板块...`;
  if (step.type === "commerce_detail_stitch") return "拼接手机详情长图...";
  if (step.type === "pose_variation") return `${title}生成多姿势图...`;
  if (step.type === "tryon") return `${title}融合人物和服装...`;
  if (step.type === "face_swap") return `${title}替换面部五官...`;
  if (step.type === "garment_3d") return `${title}构建立体展示...`;
  if (step.type === "image_quality_check") return "检查结果质量...";
  return `${title}处理中...`;
}

function WorkflowLiveStatus({ payload }: { payload: WorkflowClientPayload }) {
  const { workflow, steps } = payload;
  const active = steps.find((step) => step.status === "running") || steps.find((step) => step.status === "queued") || steps.find((step) => step.status === "waiting_user");
  const completed = steps.filter((step) => ["completed", "skipped"].includes(step.status)).length;
  const latestEvent = getLatestWorkflowEvent(payload);
  const finalUrls = getWorkflowImageUrls(payload);
  const message = getWorkflowLiveStatusMessage(workflow.status, active, latestEvent, finalUrls.length);
  const tone = getWorkflowLiveStatusTone(workflow.status, active);

  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs ${tone}`}>
      <div className="mt-0.5">
        {["running", "queued", "confirmed"].includes(workflow.status) || active ? (
          <ThinkingSignal />
        ) : workflow.status === "completed" || workflow.status === "partially_completed" ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        ) : workflow.status === "failed" || workflow.status === "cancelled" ? (
          <AlertCircle className="h-3.5 w-3.5 text-rose-600" />
        ) : (
          <Activity className="h-3.5 w-3.5 text-[var(--codex-accent)]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-bold">{message.title}</p>
        <p className="mt-0.5 leading-relaxed opacity-80">{message.detail}</p>
      </div>
      {steps.length > 0 && (
        <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold ring-1 ring-black/5">
          {completed}/{steps.length}
        </span>
      )}
    </div>
  );
}

function WorkflowConfirmBrief({
  payload,
  totalCredits,
  onOpenImage,
  onQuickAction,
}: {
  payload: WorkflowClientPayload;
  totalCredits: number;
  onOpenImage: (url: string) => void;
  onQuickAction?: (text: string) => void;
}) {
  const { workflow, steps } = payload;
  const images = workflow.input_images || [];
  const expectedCount = getWorkflowExpectedImageCount(steps);
  const meta = getWorkflowResultMeta(payload, expectedCount);
  const primaryTools = Array.from(new Set(steps.map((step) => getWorkflowToolLabel(step.type)))).slice(0, 3);
  const adjustmentHints = getWorkflowAdjustmentHints(payload);
  const commerceBrief = getWorkflowCommerceBrief(payload);

  return (
    <div className="rounded-2xl border border-amber-100 bg-amber-50/45 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-black text-slate-800">确认前复核</p>
          <p className="mt-0.5 text-[11px] text-slate-500">确认后才会扣费；如需调整，展开下方步骤点“编辑”。</p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-amber-700 ring-1 ring-amber-100">
          预计 {totalCredits || 0} 灵点
        </span>
      </div>

      <div className="grid gap-2 text-[11px] sm:grid-cols-3">
        <ConfirmBriefCell label="输出" value={meta.title} detail={`${expectedCount} 张/项 · ${meta.chips[0] || "自动规划"}`} />
        <ConfirmBriefCell label="步骤" value={`${steps.length} 个执行步骤`} detail={primaryTools.join(" / ") || "自动选择工具"} />
        <ConfirmBriefCell label="图片" value={images.length > 0 ? `使用 ${images.length} 张附件` : "不使用附件"} detail={images.length > 0 ? "点击缩略图可预览" : "仅按文字生成"} />
      </div>

      <WorkflowExecutionOrder steps={steps} />

      {commerceBrief && <WorkflowCommerceBrief brief={commerceBrief} />}

      {images.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {images.slice(0, 8).map((image) => (
            <button
              key={`${image.index}-${image.url}`}
              type="button"
              onClick={() => onOpenImage(image.url)}
              className="group relative h-12 w-12 overflow-hidden rounded-xl border border-white bg-white shadow-sm transition-transform hover:scale-105"
              title={`图${image.index} ${getWorkflowInputRoleLabel(image.role)}`}
            >
              <img src={image.url} alt={`图${image.index}`} className="h-full w-full object-cover" />
              <span className="absolute bottom-0 left-0 right-0 bg-black/55 text-center text-[8px] font-bold leading-4 text-white">
                图{image.index}
              </span>
            </button>
          ))}
        </div>
      )}

      {onQuickAction && adjustmentHints.length > 0 && (
        <div className="mt-2 border-t border-amber-100 pt-2">
          <p className="mb-1.5 text-[10px] font-bold text-amber-700">确认前可快速补充</p>
          <div className="flex flex-wrap gap-1.5">
            {adjustmentHints.map((hint) => (
              <button
                key={hint}
                type="button"
                onClick={() => onQuickAction(hint)}
                className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600 ring-1 ring-amber-100 transition-colors hover:bg-amber-100/70 hover:text-amber-800"
              >
                {hint}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ConfirmBriefCell({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl bg-white/80 px-2.5 py-2 ring-1 ring-amber-100/80">
      <p className="text-[10px] font-bold text-amber-600">{label}</p>
      <p className="mt-0.5 truncate font-bold text-slate-800">{value}</p>
      <p className="mt-0.5 truncate text-slate-400">{detail}</p>
    </div>
  );
}

type WorkflowCommerceBriefData = {
  platform: string;
  sectionCount: number;
  outputMode: string;
  mobileWidth: string;
  hasStitch: boolean;
};

function WorkflowCommerceBrief({ brief }: { brief: WorkflowCommerceBriefData }) {
  return (
    <div className="mt-2 rounded-xl border border-amber-100 bg-white/75 px-2.5 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] font-black text-amber-700">详情页交付策略</span>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-100">
          {brief.platform}
        </span>
      </div>
      <div className="grid gap-1.5 text-[10px] sm:grid-cols-4">
        <CommerceBriefPill label="板块" value={brief.sectionCount > 0 ? `${brief.sectionCount} 个` : "自动规划"} />
        <CommerceBriefPill label="输出" value={brief.outputMode} />
        <CommerceBriefPill label="画布" value={brief.mobileWidth} />
        <CommerceBriefPill label="长图" value={brief.hasStitch ? "会拼接" : "先出板块"} />
      </div>
      <p className="mt-1.5 text-[10px] leading-4 text-slate-500">
        会优先按手机端阅读节奏拆板块，再根据平台气质调整卖点、留白和文案层级；如果你要 PDD、抖音、小红书或独立站风格，可以在确认前直接补充。
      </p>
    </div>
  );
}

function CommerceBriefPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1 ring-1 ring-slate-100">
      <p className="font-bold text-slate-400">{label}</p>
      <p className="mt-0.5 truncate font-black text-slate-700">{value}</p>
    </div>
  );
}

function WorkflowExecutionOrder({ steps }: { steps: WorkflowStepRecord[] }) {
  if (steps.length < 2) return null;
  return (
    <div className="mt-2 rounded-xl border border-amber-100 bg-white/70 px-2.5 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] font-black text-amber-700">执行顺序</span>
        <span className="text-[10px] text-slate-400">严格按依赖执行，不会跳步</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {steps.map((step, index) => (
          <div key={step.id} className="flex min-w-0 items-center gap-1.5">
            <span className="inline-flex max-w-[150px] items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-slate-700 ring-1 ring-amber-100">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white text-[9px] text-amber-700 ring-1 ring-amber-100">
                {index + 1}
              </span>
              <span className="truncate">{step.title || getWorkflowToolLabel(step.type)}</span>
            </span>
            {index < steps.length - 1 && <span className="text-amber-300">→</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function getWorkflowAdjustmentHints(payload: WorkflowClientPayload) {
  const { workflow, steps } = payload;
  const text = `${workflow.intent || ""} ${workflow.summary || ""} ${steps.map((step) => `${step.title} ${step.type}`).join(" ")}`;
  const hints: string[] = [];
  const add = (value: string) => {
    if (!hints.includes(value)) hints.push(value);
  };

  if (/pose|姿势|裂变/.test(text)) {
    add("改成每张单独出图，不要四宫格");
    add("保持人物身份、服装结构和身体比例稳定");
  }
  if (/tryon|换装|试穿|穿到/.test(text)) {
    add("请再次确认图1/图2的服装和人物关系");
  }
  if (/commerce|详情|电商|PDD|拼多多|淘宝|天猫|抖音|小红书|长图/.test(text)) {
    add("输出手机端长图，并按板块拆分生成");
    add("按目标平台调整风格和卖点排版");
  }
  if (workflow.input_images?.length) {
    add("先分析图片角色和关系，再执行生成");
  }

  return hints.slice(0, 4);
}

function getWorkflowCommerceBrief(payload: WorkflowClientPayload): WorkflowCommerceBriefData | null {
  const { workflow, steps } = payload;
  const commerceSteps = steps.filter(isCommerceDetailStep);
  const text = `${workflow.intent || ""}\n${workflow.summary || ""}\n${flattenStrings(steps).join("\n")}`;
  const hasCommerce = commerceSteps.length > 0 || /详情|长图|卖点|电商|淘宝|天猫|PDD|拼多多|抖音|小红书|独立站/i.test(text);
  if (!hasCommerce) return null;

  const firstParams = commerceSteps[0]?.params || {};
  const stitched = steps.some((step) => step.type === "commerce_detail_stitch");
  const explicitCount =
    getNumberParam(firstParams, ["sectionTotal", "sectionCount", "sections", "count"]) ||
    commerceSteps.filter((step) => step.type === "commerce_detail_section").length;
  const outputMode = getStringParam(firstParams, ["outputMode", "output_mode", "layout", "resultMode"]);
  const mobileWidth = getNumberParam(firstParams, ["mobileWidth", "mobile_width", "width"]);

  return {
    platform: getWorkflowPlatformLabel(payload),
    sectionCount: explicitCount || Math.max(commerceSteps.length, 0),
    outputMode: stitched || /拼接|长图/.test(text) ? "手机长图" : outputMode === "grid" ? "板块图集" : "分板块",
    mobileWidth: mobileWidth ? `${mobileWidth}px` : "移动端适配",
    hasStitch: stitched || /拼接|长图/.test(text),
  };
}

function WorkflowClarificationPanel({
  workflow,
  onQuickAction,
}: {
  workflow: WorkflowRecord;
  onQuickAction?: (text: string) => void;
}) {
  const question = workflow.error_message || workflow.summary || "我还缺少必要信息，暂时不能安全创建生成任务。";
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/55 p-3 text-xs text-amber-800">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="font-black">需要补充信息</p>
          <p className="mt-1 leading-relaxed">{question}</p>
          <p className="mt-1 text-[11px] text-amber-700/75">我不会在缺少关键素材或目标不明确时直接生成，避免误扣灵点和生成偏题。</p>
        </div>
      </div>
      {onQuickAction && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onQuickAction("我想先补充任务信息，请你问我最关键的 1-3 个问题，不要直接生成。")}
            className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-amber-700 ring-1 ring-amber-100 transition-colors hover:bg-amber-100/70"
          >
            让 Agent 追问
          </button>
          <button
            type="button"
            onClick={() => onQuickAction("先按聊天模式帮我分析这个需求还缺什么素材和说明，不创建生成任务。")}
            className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
          >
            只分析不生成
          </button>
        </div>
      )}
    </div>
  );
}

function getWorkflowLiveStatusMessage(
  status: WorkflowStatus | string,
  active: WorkflowStepRecord | undefined,
  latestEvent: WorkflowEventRecord | null,
  finalCount: number
) {
  if (status === "draft" || status === "planned" || status === "needs_confirmation") {
    return {
      title: "等待确认方案",
      detail: "确认后才会扣费并开始执行，当前可以继续调整参数、图片角色和提示词。",
    };
  }
  if (active) {
    return {
      title: getWorkflowStepLoadingLabel(active).replace(/\.\.\.$/, ""),
      detail: latestEvent?.step_id === active.id && latestEvent.message
        ? latestEvent.message
        : getWorkflowRuntimeStepDetail(active, latestEvent),
    };
  }
  if (status === "completed") {
    return {
      title: finalCount > 0 ? `已完成，整理出 ${finalCount} 张结果` : "工作流已完成",
      detail: "可以下载、设为参考图，或基于结果继续编辑。",
    };
  }
  if (status === "partially_completed") {
    return {
      title: finalCount > 0 ? `部分完成，已有 ${finalCount} 张可用结果` : "部分步骤已完成",
      detail: "可以先使用可用结果，也可以修复失败步骤后继续。",
    };
  }
  if (status === "failed") {
    return {
      title: "工作流需要修复",
      detail: latestEvent?.message || "可查看失败步骤，或点击“帮我修复”生成更稳的方案。",
    };
  }
  if (status === "cancelled") {
    return {
      title: "工作流已取消",
      detail: "可以保留当前方案，稍后重新确认执行。",
    };
  }
  return {
    title: "等待执行器处理",
    detail: latestEvent?.message || "任务已进入队列，正在等待后台执行。",
  };
}

function getWorkflowLiveStatusTone(status: WorkflowStatus | string, active: WorkflowStepRecord | undefined) {
  if (status === "failed" || status === "cancelled" || active?.status === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "completed" || status === "partially_completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "planned" || status === "needs_confirmation" || status === "draft") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-[rgba(91,124,255,0.22)] bg-[rgba(91,124,255,0.1)] text-[var(--codex-accent)]";
}

function WorkflowExecutionCard({
  payload,
  onConfirm,
  onCancel,
  onRetryStep,
  onSkipStep,
  onSelectImage,
  onEditStep,
  onOpenImage,
  onUseAsReference,
  onQuickAction,
}: {
  payload: WorkflowClientPayload;
  onConfirm?: () => void;
  onCancel?: () => void;
  onRetryStep?: (stepId: string) => void;
  onSkipStep?: (stepId: string) => void;
  onSelectImage?: (stepId: string, selectedImageUrl: string) => void;
  onEditStep?: (stepId: string, patch: { title?: string; params?: Record<string, unknown>; input?: Record<string, unknown> }) => void;
  onOpenImage: (url: string) => void;
  onUseAsReference?: (url: string) => void;
  onQuickAction?: (text: string) => void;
}) {
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const { workflow, steps } = payload;
  const status = workflow.status;
  const finalUrls = getWorkflowImageUrls(payload);
  const totalCredits = payload.costEstimate?.total || workflow.cost_estimate?.total || 0;
  const hasRunnableSteps = steps.length > 0;
  const canConfirm = (status === "needs_confirmation" || status === "planned") && hasRunnableSteps && !workflow.error_message;
  const isActive = ["confirmed", "queued", "running"].includes(status);
  const isTerminal = ["completed", "partially_completed", "failed", "cancelled"].includes(status);
  const canCancel = !isTerminal;
  const failedCount = steps.filter((step) => step.status === "failed").length;

  return (
    <div className="mt-2 w-full max-w-xl overflow-hidden rounded-2xl border border-[rgba(91,124,255,0.22)] bg-white/95 shadow-sm">
      <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm shadow-slate-300/40">
            {isActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold text-slate-800">智能视觉工作流</p>
              <WorkflowStatusBadge status={status} />
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {workflow.summary || workflow.intent || "按你的指令自动规划、执行和检查结果。"}
            </p>
          </div>
          {totalCredits > 0 && (
            <div className="rounded-lg bg-white px-3 py-1.5 text-center ring-1 ring-[rgba(91,124,255,0.18)]">
              <p className="text-base font-black text-[var(--codex-accent)]">{totalCredits}</p>
              <p className="text-[10px] font-semibold text-[var(--codex-accent)]">灵点</p>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3 p-4">
        <WorkflowLiveStatus payload={payload} />

        {!hasRunnableSteps && (
          <WorkflowClarificationPanel workflow={workflow} onQuickAction={onQuickAction} />
        )}

        {canConfirm && (
          <WorkflowConfirmBrief
            payload={payload}
            totalCredits={totalCredits}
            onOpenImage={onOpenImage}
            onQuickAction={onQuickAction}
          />
        )}

        {steps.length > 0 && (
          <WorkflowPlanPanel
            payload={payload}
            isActive={isActive}
            editingStepId={editingStepId}
            onToggleEdit={(stepId) => setEditingStepId((current) => current === stepId ? null : stepId)}
            onCancelEdit={() => setEditingStepId(null)}
            onRetryStep={onRetryStep}
            onSkipStep={onSkipStep}
            onSelectImage={onSelectImage}
            onEditStep={onEditStep}
            onOpenImage={onOpenImage}
            onUseAsReference={onUseAsReference}
            onQuickAction={onQuickAction}
          />
        )}

        {finalUrls.length > 0 && (
          <WorkflowResultSection
            payload={payload}
            urls={finalUrls}
            onOpenImage={onOpenImage}
            onUseAsReference={onUseAsReference}
            onQuickAction={onQuickAction}
          />
        )}

        {finalUrls.length === 0 && isActive && (
          <GenerationLoadingGrid
            count={getWorkflowExpectedImageCount(steps)}
            label={getActiveWorkflowLoadingLabel(steps, workflow.summary || "工作流生成中")}
            progress={getWorkflowProgress(steps, payload.events)}
          />
        )}

        {failedCount > 0 && onQuickAction && (
          <WorkflowFailureRecovery payload={payload} onQuickAction={onQuickAction} />
        )}

        <div className="flex flex-wrap items-center gap-2">
          {canConfirm && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={!onConfirm}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[rgba(91,124,255,0.1)] px-4 py-2 text-xs font-bold text-white shadow-sm shadow-slate-300/40 transition-colors hover:bg-[rgba(91,124,255,0.12)] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Activity className="h-3.5 w-3.5" />
              确认并开始
            </button>
          )}
          {canCancel && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            >
              取消
            </button>
          )}
          {isActive && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(91,124,255,0.1)] px-3 py-1.5 text-xs font-bold text-[var(--codex-accent)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在执行
            </span>
          )}
          {isTerminal && workflow.error_message && (
            <span className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600">
              {workflow.error_message}
            </span>
          )}
          {failedCount > 0 && onQuickAction && (
            <QuickAction
              icon={<Activity className="h-3 w-3" />}
              label="帮我修复"
              onClick={() => onQuickAction("帮我分析这次工作流失败原因，给我一个更稳的修复方案，并保留当前图片关系。")}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function WorkflowFailureRecovery({
  payload,
  onQuickAction,
}: {
  payload: WorkflowClientPayload;
  onQuickAction: (text: string) => void;
}) {
  const failedSteps = payload.steps.filter((step) => step.status === "failed");
  const finalUrls = getWorkflowImageUrls(payload);
  const primaryFailure = failedSteps[0];
  const actions = getWorkflowRecoveryActions(payload, finalUrls.length);
  if (failedSteps.length === 0 || actions.length === 0) return null;

  return (
    <div className="rounded-2xl border border-rose-100 bg-rose-50/45 p-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black text-slate-800">可修复执行方案</p>
          <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
            {primaryFailure?.title || "某个步骤"} 没跑通。可以保留已成功结果，只重规划失败部分，避免整条链路从头返工。
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => onQuickAction(action.prompt)}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-600 ring-1 ring-rose-100 transition-colors hover:bg-rose-100/70 hover:text-rose-700"
          >
            {action.icon}
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkflowPlanPanel({
  payload,
  isActive,
  editingStepId,
  onToggleEdit,
  onCancelEdit,
  onRetryStep,
  onSkipStep,
  onSelectImage,
  onEditStep,
  onOpenImage,
  onUseAsReference,
  onQuickAction,
}: {
  payload: WorkflowClientPayload;
  isActive: boolean;
  editingStepId: string | null;
  onToggleEdit: (stepId: string) => void;
  onCancelEdit: () => void;
  onRetryStep?: (stepId: string) => void;
  onSkipStep?: (stepId: string) => void;
  onSelectImage?: (stepId: string, selectedImageUrl: string) => void;
  onEditStep?: (stepId: string, patch: { title?: string; params?: Record<string, unknown>; input?: Record<string, unknown> }) => void;
  onOpenImage: (url: string) => void;
  onUseAsReference?: (url: string) => void;
  onQuickAction?: (text: string) => void;
}) {
  const { steps, workflow } = payload;
  const [open, setOpen] = useState(true);
  const [expandedStepIds, setExpandedStepIds] = useState<string[]>(() =>
    steps
      .filter((step) => ["running", "failed", "waiting_user"].includes(step.status))
      .map((step) => step.id)
  );
  const running = steps.some((step) => ["running", "queued"].includes(step.status)) || ["confirmed", "queued", "running"].includes(workflow.status);
  const completedCount = steps.filter((step) => ["completed", "skipped"].includes(step.status)).length;
  const failedCount = steps.filter((step) => step.status === "failed").length;
  const importantStepIds = steps
    .filter((step) => ["running", "failed", "waiting_user"].includes(step.status))
    .map((step) => step.id)
    .join("|");

  useEffect(() => {
    if (!importantStepIds) return;
    const ids = importantStepIds.split("|").filter(Boolean);
    setExpandedStepIds((current) => Array.from(new Set([...current, ...ids])));
  }, [importantStepIds]);

  const toggleStep = (stepId: string) => {
    setExpandedStepIds((current) =>
      current.includes(stepId) ? current.filter((id) => id !== stepId) : [...current, stepId]
    );
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          running ? "bg-slate-900 text-white" : failedCount > 0 ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"
        }`}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : failedCount > 0 ? <AlertCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-800">任务规划</p>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
              {steps.length} 步
            </span>
          </div>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">
              {getWorkflowPlanPanelSummary(workflow.status, completedCount, steps.length, failedCount, steps)}
            </p>
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-slate-100 px-3.5 py-3">
          <div className="space-y-1">
            {steps.map((step, index) => {
              const expanded = expandedStepIds.includes(step.id) || editingStepId === step.id;
              return (
                <WorkflowPlanStep
                  key={step.id}
                  payload={payload}
                  step={step}
                  index={index}
                  expanded={expanded}
                  isActive={isActive}
                  editing={editingStepId === step.id}
                  onToggle={() => toggleStep(step.id)}
                  onToggleEdit={() => onToggleEdit(step.id)}
                  onCancelEdit={onCancelEdit}
                  onRetryStep={onRetryStep}
                  onSkipStep={onSkipStep}
                  onSelectImage={onSelectImage}
                  onEditStep={onEditStep}
                  onOpenImage={onOpenImage}
                  onUseAsReference={onUseAsReference}
                  onQuickAction={onQuickAction}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowPlanStep({
  payload,
  step,
  index,
  expanded,
  isActive,
  editing,
  onToggle,
  onToggleEdit,
  onCancelEdit,
  onRetryStep,
  onSkipStep,
  onSelectImage,
  onEditStep,
  onOpenImage,
  onUseAsReference,
  onQuickAction,
}: {
  payload: WorkflowClientPayload;
  step: WorkflowStepRecord;
  index: number;
  expanded: boolean;
  isActive: boolean;
  editing: boolean;
  onToggle: () => void;
  onToggleEdit: () => void;
  onCancelEdit: () => void;
  onRetryStep?: (stepId: string) => void;
  onSkipStep?: (stepId: string) => void;
  onSelectImage?: (stepId: string, selectedImageUrl: string) => void;
  onEditStep?: (stepId: string, patch: { title?: string; params?: Record<string, unknown>; input?: Record<string, unknown> }) => void;
  onOpenImage: (url: string) => void;
  onUseAsReference?: (url: string) => void;
  onQuickAction?: (text: string) => void;
}) {
  const stepOutputUrls = getWorkflowStepOutputUrls(step);
  const selectableImages = getSelectableImagesForStep(payload, index);
  const canSelectImage = canSelectWorkflowStepImage(step) && selectableImages.length > 0;
  const dependencyText = getWorkflowStepDependencyText(payload.steps, step);
  const reasoningNotes = getWorkflowStepReasoning(payload, step, index);

  return (
    <div className="relative pl-7">
      {index < payload.steps.length - 1 && (
        <div className="absolute left-[11px] top-7 h-[calc(100%-14px)] w-px bg-slate-200" />
      )}
      <button
        type="button"
        onClick={onToggle}
        className="group flex w-full items-start gap-2 rounded-xl px-1.5 py-2 text-left transition-colors hover:bg-slate-50"
      >
        <div className={`absolute left-0 top-2.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ring-4 ring-white ${getWorkflowStepNodeTone(step.status)}`}>
          {getWorkflowStepNodeIcon(step.status, index)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">{step.title}</p>
            <StepStatusPill status={step.status} />
          </div>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">
            {getWorkflowToolLabel(step.type)}
            {step.error_message ? `：${step.error_message}` : ""}
          </p>
          {dependencyText && (
            <p className="mt-0.5 truncate text-[10px] font-medium text-amber-600">{dependencyText}</p>
          )}
        </div>
        <ChevronDown className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300 transition-transform group-hover:text-slate-500 ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="ml-1.5 rounded-xl border border-slate-100 bg-slate-50/70 p-2.5">
          {["queued", "running"].includes(step.status) && (
            <WorkflowStepInlineLoading step={step} events={payload.events} />
          )}
          <WorkflowStepInputSummary steps={payload.steps} step={step} />
          <WorkflowStepReasoningNote notes={reasoningNotes} />
          {stepOutputUrls.length > 0 && !canSelectImage && (
            <StepResultPreview
              step={step}
              urls={stepOutputUrls}
              onOpenImage={onOpenImage}
              onUseAsReference={onUseAsReference}
              onQuickAction={onQuickAction}
            />
          )}
          {canSelectImage && (
            <StepImageSelector
              step={step}
              images={selectableImages}
              onOpenImage={onOpenImage}
              onSelectImage={onSelectImage}
            />
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {!isActive && canEditWorkflowStep(step.status) && onEditStep && (
              <button
                type="button"
                onClick={onToggleEdit}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600 transition-colors hover:border-[rgba(91,124,255,0.3)] hover:bg-[rgba(91,124,255,0.12)] hover:text-[var(--codex-accent)]"
              >
                <Pencil className="h-3 w-3" />
                编辑
              </button>
            )}
            {!isActive && step.status === "failed" && onRetryStep && (
              <button
                type="button"
                onClick={() => onRetryStep(step.id)}
                className="inline-flex items-center gap-1 rounded-lg border border-[rgba(91,124,255,0.22)] bg-white px-2 py-1 text-[10px] font-bold text-[var(--codex-accent)] transition-colors hover:bg-[rgba(91,124,255,0.12)]"
              >
                <RefreshCw className="h-3 w-3" />
                重试
              </button>
            )}
            {!isActive && step.status === "completed" && onRetryStep && (
              <button
                type="button"
                onClick={() => onRetryStep(step.id)}
                className="inline-flex items-center gap-1 rounded-lg border border-[rgba(91,124,255,0.22)] bg-white px-2 py-1 text-[10px] font-bold text-[var(--codex-accent)] transition-colors hover:bg-[rgba(91,124,255,0.12)]"
              >
                <RefreshCw className="h-3 w-3" />
                重做这一步
              </button>
            )}
            {!isActive && !["completed", "running", "cancelled", "skipped"].includes(step.status) && onSkipStep && (
              <button
                type="button"
                onClick={() => onSkipStep(step.id)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-500 transition-colors hover:bg-slate-50"
              >
                跳过
              </button>
            )}
          </div>
          {editing && onEditStep && (
            <WorkflowStepEditor
              step={step}
              onCancel={onCancelEdit}
              onSave={(patch) => {
                onCancelEdit();
                onEditStep(step.id, patch);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function WorkflowStepInputSummary({ steps, step }: { steps: WorkflowStepRecord[]; step: WorkflowStepRecord }) {
  const inputRefs = getWorkflowStepInputRefs(steps, step);
  const outputSummary = getWorkflowStepOutputSummary(step);
  if (inputRefs.length === 0 && !outputSummary) return null;

  return (
    <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
      {inputRefs.length > 0 && (
        <div className="rounded-xl border border-slate-100 bg-white/80 px-2.5 py-2">
          <p className="text-[10px] font-black text-slate-500">输入来源</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {inputRefs.map((ref) => (
              <span
                key={ref}
                className="inline-flex max-w-full items-center rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600 ring-1 ring-slate-100"
              >
                <span className="truncate">{ref}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {outputSummary && (
        <div className="rounded-xl border border-slate-100 bg-white/80 px-2.5 py-2">
          <p className="text-[10px] font-black text-slate-500">输出形式</p>
          <p className="mt-1 text-[11px] font-bold leading-relaxed text-slate-700">{outputSummary}</p>
        </div>
      )}
    </div>
  );
}

function WorkflowStepReasoningNote({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="mt-1.5 rounded-xl border border-[rgba(91,124,255,0.22)] bg-white/85 px-2.5 py-2">
      <p className="text-[10px] font-black text-[var(--codex-accent)]">为什么这样安排</p>
      <ul className="mt-1 space-y-1 text-[10px] leading-4 text-slate-500">
        {notes.map((note) => (
          <li key={note} className="flex gap-1.5">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[rgba(91,124,255,0.1)]" />
            <span>{note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepImageSelector({
  step,
  images,
  onOpenImage,
  onSelectImage,
}: {
  step: WorkflowStepRecord;
  images: string[];
  onOpenImage: (url: string) => void;
  onSelectImage?: (stepId: string, selectedImageUrl: string) => void;
}) {
  const uniqueImages = Array.from(new Set(images)).filter(Boolean);
  const selected = step.output?.selectedImageUrl;
  if (uniqueImages.length <= 1 && !selected) return null;

  return (
    <div className="mt-2 rounded-lg border border-slate-100 bg-white/80 p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold text-slate-500">候选结果</span>
        {selected && <span className="text-[10px] font-bold text-emerald-600">已选择 1 张继续</span>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {uniqueImages.map((url, index) => {
          const isSelected = selected === url;
          return (
            <div key={`${step.id}-${url}`} className={`overflow-hidden rounded-lg border bg-slate-50 ${isSelected ? "border-emerald-300 ring-2 ring-emerald-100" : "border-slate-200"}`}>
              <button
                type="button"
                onClick={() => onOpenImage(url)}
                className="group relative block aspect-[3/4] w-full overflow-hidden bg-white"
              >
                <img src={url} alt={`候选结果 ${index + 1}`} className="h-full w-full object-cover" />
                <span className="absolute left-1 top-1 rounded bg-black/45 px-1.5 py-0.5 text-[9px] font-bold text-white">
                  {index + 1}
                </span>
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/10 group-hover:opacity-100">
                  <ZoomIn className="h-4 w-4 text-white drop-shadow" />
                </span>
              </button>
              {onSelectImage && (
                <button
                  type="button"
                  onClick={() => onSelectImage(step.id, url)}
                  disabled={isSelected || step.status === "running"}
                  className={`flex w-full items-center justify-center gap-1 px-1.5 py-1.5 text-[10px] font-bold transition-colors ${
                    isSelected
                      ? "cursor-default bg-emerald-50 text-emerald-600"
                      : "bg-white text-[var(--codex-accent)] hover:bg-[rgba(91,124,255,0.12)] disabled:cursor-not-allowed disabled:text-slate-300"
                  }`}
                >
                  {isSelected ? <CheckCircle2 className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                  {isSelected ? "已选" : "选这张继续"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepResultPreview({
  step,
  urls,
  onOpenImage,
  onUseAsReference,
  onQuickAction,
}: {
  step: WorkflowStepRecord;
  urls: string[];
  onOpenImage: (url: string) => void;
  onUseAsReference?: (url: string) => void;
  onQuickAction?: (text: string) => void;
}) {
  const safeUrls = Array.from(new Set(urls)).filter(Boolean);
  const firstUrl = safeUrls[0];
  if (safeUrls.length === 0) return null;

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-2.5 py-2">
        <div>
          <p className="text-[11px] font-bold text-slate-700">{getWorkflowStepResultTitle(step)}</p>
          <p className="text-[10px] text-slate-400">{safeUrls.length} 张结果，可继续作为下一轮参考</p>
        </div>
        <div className="flex flex-wrap gap-1">
          <QuickAction
            icon={<Download className="h-3 w-3" />}
            label={safeUrls.length > 1 ? "下载本步骤" : "下载"}
            onClick={() => safeUrls.forEach((url, index) => downloadImage(url, generateDownloadFilename(step.type || "step", index)))}
          />
          {firstUrl && onUseAsReference && (
            <QuickAction
              icon={<Activity className="h-3 w-3" />}
              label="设为参考"
              onClick={() => onUseAsReference(firstUrl)}
            />
          )}
          {firstUrl && onQuickAction && (
            <QuickAction
              icon={<Pencil className="h-3 w-3" />}
              label="继续改"
              variant="primary"
              onClick={() => {
                onUseAsReference?.(firstUrl);
                onQuickAction(`基于「${step.title || getWorkflowToolLabel(step.type)}」这一步的结果继续优化，我会补充新的修改要求。`);
              }}
            />
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-4">
        {safeUrls.slice(0, 8).map((url, index) => (
          <button
            key={`${step.id}-result-${url}-${index}`}
            type="button"
            onClick={() => onOpenImage(url)}
            className="group relative aspect-[3/4] overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm"
          >
            <img
              src={url}
              alt={`${getWorkflowStepResultTitle(step)} ${index + 1}`}
              className={`h-full w-full ${isCommerceDetailStep(step) ? "bg-white object-contain p-1" : "object-cover"}`}
            />
            <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-bold text-white">
              {index + 1}
            </span>
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/10 group-hover:opacity-100">
              <ZoomIn className="h-4 w-4 text-white drop-shadow" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkflowStepEditor({
  step,
  onCancel,
  onSave,
}: {
  step: WorkflowStepRecord;
  onCancel: () => void;
  onSave: (patch: { title?: string; params?: Record<string, unknown>; input?: Record<string, unknown> }) => void;
}) {
  const editable = readWorkflowStepParams(step.params);
  const [title, setTitle] = useState(step.title || "");
  const [prompt, setPrompt] = useState(editable.prompt || "");
  const [model, setModel] = useState<LearnedWorkflowModel>(editable.model);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(editable.aspectRatio);
  const [imageSize, setImageSize] = useState<ImageSize>(editable.imageSize);
  const [count, setCount] = useState(String(editable.count));

  const handleSave = () => {
    const nextCount = Math.min(Math.max(Number(count) || 1, 1), 8);
    onSave({
      title: title.trim() || step.title,
      params: {
        prompt,
        model,
        aiModel: model,
        aspectRatio,
        aspect_ratio: aspectRatio,
        imageSize,
        image_size: imageSize,
        count: nextCount,
        gen_count: nextCount,
      },
    });
  };

  return (
    <div className="mt-2 rounded-xl border border-[rgba(91,124,255,0.22)] bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-700">编辑步骤</p>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="关闭编辑"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <label className="mb-2 block">
        <span className="mb-1 block text-[10px] font-bold text-slate-400">步骤标题</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 outline-none transition-colors focus:border-[rgba(91,124,255,0.5)]"
        />
      </label>

      <div className="mb-2 grid grid-cols-2 gap-2">
        <ConfirmSelect
          label="模型"
          value={model}
          options={CONFIRM_MODEL_OPTIONS}
          onChange={(value) => setModel(value as LearnedWorkflowModel)}
        />
        <ConfirmSelect
          label="比例"
          value={aspectRatio}
          options={CONFIRM_RATIO_OPTIONS}
          onChange={(value) => setAspectRatio(value as AspectRatio)}
        />
        <ConfirmSelect
          label="分辨率"
          value={imageSize}
          options={CONFIRM_SIZE_OPTIONS}
          onChange={(value) => setImageSize(value as ImageSize)}
        />
        <label className="min-w-0">
          <span className="mb-1 block text-[10px] font-bold text-slate-400">数量</span>
          <input
            type="number"
            min={1}
            max={8}
            value={count}
            onChange={(event) => setCount(event.target.value)}
            className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 outline-none transition-colors focus:border-[rgba(91,124,255,0.5)]"
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-[10px] font-bold text-slate-400">最终提示词</span>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          className="min-h-24 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-700 outline-none transition-colors focus:border-[rgba(91,124,255,0.5)]"
          placeholder="修改这一步真正要发给模型的提示词"
        />
      </label>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSave}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[rgba(91,124,255,0.1)] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[rgba(91,124,255,0.12)]"
        >
          <Check className="h-3.5 w-3.5" />
          保存并重新排队
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-50"
        >
          取消
        </button>
      </div>
    </div>
  );
}

type LearnedWorkflowModel = LingyaModel;

function getSelectableImagesForStep(payload: WorkflowClientPayload, stepIndex: number) {
  const step = payload.steps[stepIndex];
  const direct = Array.isArray(step.output?.imageUrls) ? step.output.imageUrls : [];
  if (direct.length > 0) return direct;

  if (step.type === "select_image" || step.status === "waiting_user") {
    for (let i = stepIndex - 1; i >= 0; i--) {
      const urls = payload.steps[i].output?.imageUrls || [];
      if (urls.length > 0) return urls;
    }
  }

  return [];
}

function getWorkflowStepOutputUrls(step: WorkflowStepRecord) {
  const imageUrls = Array.isArray(step.output?.imageUrls) ? step.output.imageUrls : [];
  const selectedUrl = typeof step.output?.selectedImageUrl === "string" ? step.output.selectedImageUrl : "";
  const outputRecord = isPlainObject(step.output) ? step.output as Record<string, unknown> : {};
  const url = typeof outputRecord.url === "string" ? outputRecord.url : "";
  return Array.from(new Set([...imageUrls, selectedUrl, url])).filter(Boolean);
}

function getWorkflowStepResultTitle(step: WorkflowStepRecord) {
  if (step.type === "commerce_detail_section") return step.title || "详情页板块结果";
  if (step.type === "commerce_detail_stitch") return "详情长图结果";
  if (step.type === "pose_variation") return "姿势裂变结果";
  if (step.type === "tryon") return "换装融合结果";
  if (step.type === "face_swap") return "换脸结果";
  if (step.type === "image_quality_check") return "质量检查结果";
  return `${step.title || getWorkflowToolLabel(step.type)}结果`;
}

function getWorkflowResultMeta(payload: WorkflowClientPayload, count: number) {
  const { workflow, steps } = payload;
  const hasStitch = steps.some((step) => step.type === "commerce_detail_stitch");
  const sectionCount = steps.filter((step) => step.type === "commerce_detail_section").length;
  const hasCommerce = hasStitch || sectionCount > 0 || workflow.intent?.includes("详情") || workflow.summary?.includes("详情");
  const hasPose = steps.some((step) => step.type === "pose_variation");
  const hasTryon = steps.some((step) => step.type === "tryon");
  const hasFaceSwap = steps.some((step) => step.type === "face_swap");
  const has3d = steps.some((step) => step.type === "garment_3d" || step.type === "image_to_3d_asset");
  const statusLabel = getWorkflowStatusLabel(workflow.status);
  const platform = getWorkflowPlatformLabel(payload);

  if (hasCommerce) {
    return {
      title: hasStitch ? "详情页最终成品" : "详情页板块素材",
      detail: hasStitch
        ? "已按移动端浏览场景整理成可交付结果，可下载、继续编辑或设为下一轮参考。"
        : "已拆成多个详情页板块，可逐块查看、重做或继续拼成长图。",
      chips: [platform || "电商详情", hasStitch ? "长图/成品" : `${sectionCount || count} 个板块`, statusLabel].filter(Boolean),
    };
  }

  if (hasPose) {
    return {
      title: "姿势裂变结果",
      detail: count > 1 ? "已生成多张独立姿势图，适合挑选单张继续优化或作为详情页素材。" : "已生成姿势变化图，可继续扩展更多动作。",
      chips: ["多姿势", count > 1 ? "单张独立图" : "单图", statusLabel],
    };
  }

  if (hasTryon) {
    return {
      title: "换装融合结果",
      detail: "已完成服装与人物融合，可继续做姿势裂变、详情页或局部修复。",
      chips: ["换装", count > 1 ? `${count} 张候选` : "1 张结果", statusLabel],
    };
  }

  if (hasFaceSwap) {
    return {
    title: "换脸结果",
      detail: "已完成面部五官替换；结果会尽量保留原图肤色、发型、身体、服装、背景和光线。",
      chips: ["换脸", count > 1 ? `${count} 张候选` : "1 张结果", statusLabel],
    };
  }

  if (has3d) {
    return {
      title: "3D 展示结果",
      detail: "已生成适合商品展示的立体视觉结果，可继续做角度变化或详情页板块。",
      chips: ["3D 展示", `${count} 张`, statusLabel],
    };
  }

  return {
    title: "最终结果",
    detail: "结果已整理完成，可以下载、设为参考图，或基于当前结果继续修改。",
    chips: [`${count} 张结果`, statusLabel],
  };
}

function getWorkflowFollowupActions(payload: WorkflowClientPayload, count: number): Array<{ label: string; prompt: string; icon: React.ReactNode }> {
  const { workflow, steps } = payload;
  const hasStitch = steps.some((step) => step.type === "commerce_detail_stitch");
  const hasCommerceSection = steps.some((step) => step.type === "commerce_detail_section");
  const hasCommerce = hasStitch || hasCommerceSection || workflow.intent?.includes("详情") || workflow.summary?.includes("详情");
  const hasPose = steps.some((step) => step.type === "pose_variation");
  const hasTryon = steps.some((step) => step.type === "tryon");
  const has3d = steps.some((step) => step.type === "garment_3d" || step.type === "image_to_3d_asset");
  const failedCount = steps.filter((step) => step.status === "failed").length;

  if (failedCount > 0) {
    return [
      {
        label: "修复失败步骤",
        icon: <RefreshCw className="h-3 w-3" />,
        prompt: "帮我复盘这次工作流失败的步骤，保留已成功结果，重新规划一个更稳的修复方案。",
      },
      {
        label: "只用可用结果继续",
        icon: <Activity className="h-3 w-3" />,
        prompt: "只基于当前已经成功的结果继续，不再等待失败步骤，帮我整理下一步可执行方案。",
      },
    ];
  }

  if (hasCommerce) {
    return [
      hasStitch
        ? {
            label: "优化详情页",
            icon: <Pencil className="h-3 w-3" />,
            prompt: "基于这套详情页结果继续优化，重点提升移动端阅读节奏、卖点层级、字体留白和商业质感。",
          }
        : {
            label: "拼成长图",
            icon: <Activity className="h-3 w-3" />,
            prompt: "把当前详情页板块拼接成适合手机端浏览的长图，保持板块顺序、留白节奏和电商平台质感。",
          },
      {
        label: "调整卖点文案",
        icon: <Pencil className="h-3 w-3" />,
        prompt: "基于当前详情页结果，重新优化卖点文案和模块标题，让表达更适合电商转化，但不要改变商品主体。",
      },
      {
        label: "补充一个板块",
        icon: <Activity className="h-3 w-3" />,
        prompt: "在当前详情页基础上补充一个新的详情页板块，风格保持一致，请先问我想补充哪个卖点。",
      },
    ];
  }

  if (hasPose) {
    return [
      {
        label: "选图做详情页",
        icon: <Activity className="h-3 w-3" />,
        prompt: "从当前姿势裂变结果中挑选适合电商展示的图，继续规划一套详情页素材。",
      },
      {
        label: "继续裂变",
        icon: <RefreshCw className="h-3 w-3" />,
        prompt: `基于当前${count > 1 ? "这一组" : "这张"}姿势结果继续生成更多自然可信的姿势变化，每张独立出图，不要拼四宫格。`,
      },
      {
        label: "修手脸比例",
        icon: <Pencil className="h-3 w-3" />,
        prompt: "检查当前结果的人脸、手指、身体比例和服装结构，优先修复最影响商业质感的问题。",
      },
    ];
  }

  if (hasTryon) {
    return [
      {
        label: "继续姿势裂变",
        icon: <Activity className="h-3 w-3" />,
        prompt: "基于当前换装结果继续生成4张不同姿势的独立图片，保持人物身份、服装结构和材质准确。",
      },
      {
        label: "生成详情页",
        icon: <Pencil className="h-3 w-3" />,
        prompt: "基于当前换装结果生成一套适合电商平台的商品详情页素材，先自动规划所需板块。",
      },
      {
        label: "修复融合感",
        icon: <RefreshCw className="h-3 w-3" />,
        prompt: "检查当前换装结果的领口、肩线、腰线、袖口、面料和人物比例，帮我修复不自然的融合问题。",
      },
    ];
  }

  if (has3d) {
    return [
      {
        label: "换角度展示",
        icon: <RefreshCw className="h-3 w-3" />,
        prompt: "基于当前3D展示结果继续生成更多展示角度，保持商品结构和材质一致。",
      },
      {
        label: "做详情页板块",
        icon: <Pencil className="h-3 w-3" />,
        prompt: "把当前3D展示结果扩展成电商详情页里的一个高质感展示板块。",
      },
    ];
  }

  return [
    {
      label: "继续优化",
      icon: <Pencil className="h-3 w-3" />,
      prompt: "基于当前结果继续优化，保持主体一致，请先帮我指出最值得改的3个地方。",
    },
    {
      label: "生成更多版本",
      icon: <RefreshCw className="h-3 w-3" />,
      prompt: "基于当前结果继续生成更多版本，保持主体一致，风格可以有自然变化。",
    },
    {
      label: "做电商详情页",
      icon: <Activity className="h-3 w-3" />,
      prompt: "基于当前结果生成一套适合电商平台的详情页素材，先自动规划板块。",
    },
  ];
}

function getGenerationFollowupActions(generation: NonNullable<Message["generation"]>): Array<{ label: string; prompt: string; icon: React.ReactNode }> {
  const moduleText = `${generation.module || ""}\n${generation._lastRunData?.module || ""}`.toLowerCase();
  const count = generation.resultUrls.length;

  if (moduleText.includes("姿势") || moduleText.includes("pose")) {
    return [
      {
        label: "选图做详情页",
        icon: <Activity className="h-3 w-3" />,
        prompt: "基于当前姿势结果挑选适合电商展示的图，继续规划一套详情页素材。",
      },
      {
        label: "继续裂变",
        icon: <RefreshCw className="h-3 w-3" />,
        prompt: `基于当前${count > 1 ? "这一组" : "这张"}姿势结果继续生成更多自然可信的姿势变化，每张独立出图。`,
      },
    ];
  }

  if (moduleText.includes("换装") || moduleText.includes("tryon")) {
    return [
      {
        label: "继续姿势裂变",
        icon: <Activity className="h-3 w-3" />,
        prompt: "基于当前换装结果继续生成4张不同姿势的独立图片，保持人物身份、服装结构和材质准确。",
      },
      {
        label: "生成详情页",
        icon: <Pencil className="h-3 w-3" />,
        prompt: "基于当前换装结果生成一套适合电商平台的商品详情页素材，先自动规划所需板块。",
      },
    ];
  }

  if (moduleText.includes("详情") || moduleText.includes("detail")) {
    return [
      {
        label: "继续优化详情",
        icon: <Pencil className="h-3 w-3" />,
        prompt: "基于当前详情页结果继续优化，重点提升移动端阅读节奏、卖点层级、字体留白和商业质感。",
      },
      {
        label: "补充板块",
        icon: <Activity className="h-3 w-3" />,
        prompt: "在当前详情页基础上补充一个新的详情页板块，风格保持一致，请先问我想补充哪个卖点。",
      },
    ];
  }

  return [
    {
      label: "继续优化",
      icon: <Pencil className="h-3 w-3" />,
      prompt: "基于当前结果继续优化，保持主体一致，请先帮我指出最值得改的3个地方。",
    },
    {
      label: "做电商详情页",
      icon: <Activity className="h-3 w-3" />,
      prompt: "基于当前结果生成一套适合电商平台的详情页素材，先自动规划板块。",
    },
  ];
}

function shouldContainWorkflowResults(payload: WorkflowClientPayload) {
  return payload.steps.some(isCommerceDetailStep);
}

function isCommerceDetailStep(step: WorkflowStepRecord) {
  return step.type === "commerce_detail" || step.type === "commerce_detail_section" || step.type === "commerce_detail_stitch";
}

function getWorkflowPlatformLabel(payload: WorkflowClientPayload) {
  const text = flattenStrings([payload.workflow.intent || "", payload.workflow.summary || "", payload.steps]).join("\n").toLowerCase();
  if (text.includes("pdd") || text.includes("拼多多")) return "PDD";
  if (text.includes("抖音") || text.includes("douyin")) return "抖音";
  if (text.includes("小红书") || text.includes("xiaohongshu") || text.includes("rednote")) return "小红书";
  if (text.includes("淘宝") || text.includes("taobao") || text.includes("天猫") || text.includes("tmall")) return "淘宝/天猫";
  return "电商详情";
}

function getWorkflowRecoveryActions(payload: WorkflowClientPayload, finalCount: number): Array<{ label: string; prompt: string; icon: React.ReactNode }> {
  const failedSteps = payload.steps.filter((step) => step.status === "failed");
  const failedTitles = failedSteps.map((step) => step.title || getWorkflowToolLabel(step.type)).join("、") || "失败步骤";
  const hasCommerce = payload.steps.some(isCommerceDetailStep);
  const hasPose = payload.steps.some((step) => step.type === "pose_variation");
  const hasTryon = payload.steps.some((step) => step.type === "tryon");
  const hasFaceSwap = payload.steps.some((step) => step.type === "face_swap");

  const actions: Array<{ label: string; prompt: string; icon: React.ReactNode }> = [
    {
      label: "只修失败步骤",
      icon: <RefreshCw className="h-3 w-3" />,
      prompt: `请复盘这次工作流里「${failedTitles}」失败的原因，保留已成功结果和图片关系，只重新规划失败步骤的更稳方案。`,
    },
    {
      label: "降低难度重试",
      icon: <Activity className="h-3 w-3" />,
      prompt: `请把失败步骤「${failedTitles}」改成更稳的版本：减少一次性输出数量、降低构图复杂度、保留主体一致性，然后重新进入确认。`,
    },
  ];

  if (finalCount > 0) {
    actions.push({
      label: "用可用结果继续",
      icon: <CheckCircle2 className="h-3 w-3" />,
      prompt: "不用等失败步骤了，请基于当前已经成功的结果继续整理下一步方案，并告诉我哪些结果可以直接使用。",
    });
  }
  if (hasPose) {
    actions.push({
      label: "改成单图先跑",
      icon: <Pencil className="h-3 w-3" />,
      prompt: "请把姿势裂变改成先生成 1 张高质量独立图验证人物、服装和比例，确认后再扩展到多张。",
    });
  }
  if (hasTryon) {
    actions.push({
      label: "先稳换装底图",
      icon: <Pencil className="h-3 w-3" />,
      prompt: "请先只修换装底图，确保人物身份、服装结构、比例和材质稳定，后续再做姿势或详情页。",
    });
  }
  if (hasFaceSwap) {
    actions.push({
      label: "重新匹配脸图",
      icon: <Pencil className="h-3 w-3" />,
      prompt: "请重新检查换脸的原始模特图和目标脸图，只替换五官，不改变肤色、发型、身体、服装、背景和光线。",
    });
  }
  if (hasCommerce) {
    actions.push({
      label: "拆板块重做",
      icon: <Activity className="h-3 w-3" />,
      prompt: "请把详情页改成分板块生成，先确认平台、板块数量和长图拼接方式，避免一次性生成整张导致信息混乱。",
    });
  }

  return actions.slice(0, 4);
}

function getWorkflowInputRoleLabel(role: WorkflowInputImage["role"]) {
  if (role === "person") return "人物";
  if (role === "product") return "商品";
  if (role === "style") return "风格";
  if (role === "unknown") return "待判断";
  return getRoleLabel((role || "auto") as ChatImageRole);
}

function canEditWorkflowStep(status: string) {
  return ["pending", "ready", "failed", "completed", "skipped", "waiting_user"].includes(status);
}

function canSelectWorkflowStepImage(step: WorkflowStepRecord) {
  return step.type === "select_image" || step.status === "waiting_user" || Boolean(step.output?.selectedImageUrl);
}

function readWorkflowStepParams(params: Record<string, unknown>) {
        const model = String(params.model || params.aiModel || params.ai_model || "nano-banana-2") as LingyaModel;
  const aspectRatio = String(params.aspectRatio || params.aspect_ratio || "3:4") as AspectRatio;
  const imageSize = String(params.imageSize || params.image_size || "1K") as ImageSize;
  const count = Math.min(Math.max(Number(params.count || params.genCount || params.gen_count || 1), 1), 8);
  const prompt = typeof params.prompt === "string" ? params.prompt : "";
  return { model, aspectRatio, imageSize, count, prompt };
}

function WorkflowStatusBadge({ status }: { status: WorkflowStatus | string }) {
  const tone = getWorkflowStatusTone(status);
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${tone}`}>
      {getWorkflowStatusLabel(status)}
    </span>
  );
}

function getWorkflowPlanPanelSummary(status: WorkflowStatus | string, completedCount: number, totalCount: number, failedCount: number, steps: WorkflowStepRecord[] = []) {
  if (failedCount > 0) return `${completedCount}/${totalCount} 已完成，${failedCount} 个步骤需要处理`;
  if (status === "needs_confirmation" || status === "planned" || status === "draft") return "已拆解执行步骤，确认前不会扣费";
  if (status === "confirmed" || status === "queued") return "计划已确认，正在等待执行";
  if (status === "running") {
    const active = steps.find((step) => step.status === "running") || steps.find((step) => step.status === "queued");
    return active ? `正在执行：${active.title || getWorkflowToolLabel(active.type)}` : `${completedCount}/${totalCount} 已完成，剩余步骤处理中`;
  }
  if (status === "completed") return "所有步骤已完成";
  if (status === "partially_completed") return `${completedCount}/${totalCount} 已完成，可查看结果`;
  if (status === "cancelled") return "计划已取消";
  return `${completedCount}/${totalCount} 已完成`;
}

function getWorkflowStepDependencyText(steps: WorkflowStepRecord[], step: WorkflowStepRecord) {
  if (!step.depends_on?.length) return "";
  const labels = step.depends_on
    .map((dep) => {
      const index = steps.findIndex((item) => item.step_key === dep || item.id === dep);
      const depStep = steps[index];
      return depStep ? `第${index + 1}步「${depStep.title || getWorkflowToolLabel(depStep.type)}」` : dep;
    })
    .filter(Boolean);
  if (!labels.length) return "";
  return `依赖 ${labels.join("、")} 完成后执行`;
}

function getWorkflowStepInputRefs(steps: WorkflowStepRecord[], step: WorkflowStepRecord) {
  const refs: string[] = [];
  const raw = safeStringifyWorkflowValue(step.input);
  const addRef = (value: string) => {
    const normalized = value.trim();
    if (normalized && !refs.includes(normalized)) refs.push(normalized);
  };

  for (const match of raw.matchAll(/@?图\s*(\d+)/g)) {
    addRef(`图${match[1]}`);
  }

  for (const match of raw.matchAll(/\$([A-Za-z0-9_-]+)\.output\.(imageUrls|selectedImageUrl)(?:\[(\d+)])?/g)) {
    const key = match[1];
    const sourceIndex = steps.findIndex((item) => item.step_key === key || item.id === key);
    const sourceStep = steps[sourceIndex];
    if (sourceStep) {
      addRef(`第${sourceIndex + 1}步结果`);
    }
  }

  if (step.depends_on?.length) {
    for (const dep of step.depends_on) {
      const sourceIndex = steps.findIndex((item) => item.step_key === dep || item.id === dep);
      if (sourceIndex >= 0) addRef(`第${sourceIndex + 1}步结果`);
    }
  }

  return refs.slice(0, 5);
}

function getWorkflowStepOutputSummary(step: WorkflowStepRecord) {
  const params = step.params || {};
  const expectedOutput = (step as { expectedOutput?: { imageUrls?: boolean; selectedImageUrl?: boolean } }).expectedOutput;
  const count = getNumberParam(params, ["count", "gen_count", "imageCount", "image_count", "sectionTotal"]);
  const outputMode = getStringParam(params, ["outputMode", "output_mode", "layout", "resultMode"]);

  if (step.type === "tryon") return "换装底图，后续步骤会优先沿用这张结果";
  if (step.type === "face_swap") return "只替换面部五官，保留原图肤色、发型、身体和服装";
  if (step.type === "pose_variation") {
    const n = count || 4;
    if (["grid", "collage", "four_grid"].includes(outputMode)) return `${n} 个姿势拼成一张图`;
    if (["both", "separate_and_grid"].includes(outputMode)) return `${n} 张独立图 + 拼图预览`;
    return `${n} 张独立姿势图，不拼四宫格`;
  }
  if (step.type === "commerce_detail_section") return "详情页单个板块，适合手机端浏览";
  if (step.type === "commerce_detail_stitch") return "拼接为手机端长图，可用于电商详情页";
  if (step.type === "commerce_detail") return count ? `${count} 个详情页板块，可再拼成长图` : "详情页素材与版块方案";
  if (step.type === "garment_3d" || step.type === "image_to_3d_asset") return "3D 展示素材或 3D 资产";
  if (step.type === "image_to_video") return "视频素材，后续可接入视频生成";
  if (count && count > 1) return `${count} 张图片`;
  if (expectedOutput?.imageUrls || step.output?.imageUrls) return "图片结果";
  if (expectedOutput?.selectedImageUrl || step.output?.selectedImageUrl) return "选中的参考图";
  return "";
}

function getWorkflowStepReasoning(payload: WorkflowClientPayload, step: WorkflowStepRecord, index: number) {
  const notes: string[] = [];
  const add = (value: string) => {
    if (value && !notes.includes(value)) notes.push(value);
  };
  const text = `${payload.workflow.intent || ""}\n${payload.workflow.summary || ""}\n${step.title || ""}\n${step.type}`;
  const inputRefs = getWorkflowStepInputRefs(payload.steps, step);

  if (step.type === "tryon") {
    add("先做换装可以得到稳定底图，后续姿势、详情页或修复都会沿用它，避免先裂变再换装导致服装结构漂移。");
  } else if (step.type === "face_swap") {
    add("换脸步骤只使用目标脸图的五官身份，不会把肤色、发型、身体或服装一起替换。");
  } else if (step.type === "pose_variation") {
    if (step.depends_on?.length || inputRefs.some((ref) => ref.includes("步结果"))) {
      add("这一步会基于前序结果做姿势变化，顺序上不会跳过换装底图。");
    }
    add("默认按独立图片生成，便于挑选、下载、继续编辑或作为详情页素材。");
  } else if (step.type === "commerce_detail_section") {
    add("详情页拆成单板块生成，可以降低信息挤压，后面也更容易替换某个卖点模块。");
  } else if (step.type === "commerce_detail_stitch") {
    add("拼接步骤只整理已生成板块，不重新改变主体画面，适合输出手机端长图。");
  } else if (step.type === "commerce_detail") {
    add("先规划详情页结构和板块，再执行生成，能减少把所有内容塞进一张图的概率。");
  } else if (step.type === "select_image") {
    add("需要从上一批结果里确定主图或参考图，避免后续步骤拿错素材。");
  } else if (step.type === "image_quality_check") {
    add("质量检查会优先看主体一致性、手脸比例、服装结构和可交付性。");
  } else if (step.type === "garment_3d" || step.type === "image_to_3d_asset") {
    add("3D 类步骤会保留商品结构和材质信息，后续可接视频或详情页展示。");
  }

  if (index > 0 && inputRefs.length > 0) {
    add(`输入来源已绑定到 ${inputRefs.slice(0, 2).join("、")}，减少误用历史图片或拿错图的风险。`);
  }
  if (/PDD|拼多多|淘宝|天猫|抖音|小红书|独立站|详情|电商/i.test(text)) {
    add("会按目标平台调节画面节奏、卖点层级和移动端可读性。");
  }

  return notes.slice(0, 3);
}

function safeStringifyWorkflowValue(value: unknown) {
  try {
    return JSON.stringify(value || {});
  } catch {
    return "";
  }
}

function getNumberParam(params: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = params[key];
    const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}

function getStringParam(params: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function getWorkflowStepNodeTone(status: string) {
  if (status === "completed") return "bg-emerald-500 text-white";
  if (status === "failed") return "bg-red-500 text-white";
  if (status === "running" || status === "queued") return "bg-slate-900 text-white";
  if (status === "waiting_user") return "bg-amber-500 text-white";
  if (status === "skipped" || status === "cancelled") return "bg-slate-300 text-white";
  return "bg-white text-slate-500 ring-slate-100";
}

function getWorkflowStepNodeIcon(status: string, index: number) {
  if (status === "completed") return <Check className="h-3 w-3" />;
  if (status === "failed") return <X className="h-3 w-3" />;
  if (status === "running" || status === "queued") return <Loader2 className="h-3 w-3 animate-spin" />;
  return index + 1;
}

function StepStatusPill({ status }: { status: string }) {
  const done = status === "completed";
  const failed = status === "failed";
  const running = status === "running" || status === "queued";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
      done
        ? "bg-emerald-50 text-emerald-600"
        : failed
          ? "bg-red-50 text-red-600"
          : running
            ? "bg-[rgba(91,124,255,0.1)] text-[var(--codex-accent)]"
            : "bg-slate-100 text-slate-500"
    }`}>
      {done ? <CheckCircle2 className="h-3 w-3" /> : failed ? <AlertCircle className="h-3 w-3" /> : running ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      {getStepStatusLabel(status)}
    </span>
  );
}

type AgentTraceApiRecord = {
  id: string;
  action?: string;
  module?: string | null;
  confidence?: number;
  source?: string;
  trace?: {
    latencyMs?: number;
    events?: Array<{
      stage: string;
      status: string;
      summary: string;
      latencyMs?: number;
    }>;
    final?: {
      action: string;
      module: string | null;
      confidence: number;
      source: string;
    };
  };
};

function AgentTracePanel({ traceId }: { traceId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [record, setRecord] = useState<AgentTraceApiRecord | null>(null);

  useEffect(() => {
    if (!open || record || loading) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/agent/brain-traces/${traceId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setRecord(data.trace || null);
      })
      .catch(() => {
        if (!cancelled) setRecord(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, record, loading, traceId]);

  const events = record?.trace?.events || [];
  const finalTrace = record?.trace?.final;
  const latencyMs = record?.trace?.latencyMs;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        title="查看 Agent 理解和执行过程"
      >
        <Activity className="h-3 w-3" />
        过程
      </button>
      {open && (
        <div className="absolute left-0 top-7 z-20 w-72 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800">Agent 过程</span>
            <span className="text-[10px] text-slate-400">{latencyMs ? `${latencyMs}ms` : ""}</span>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              读取中...
            </div>
          ) : events.length ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  {events.length} 个阶段
                </span>
                {finalTrace && (
                  <>
                    <span className="rounded-full bg-[rgba(91,124,255,0.1)] px-2 py-0.5 text-[10px] font-bold text-[var(--codex-accent)]">
                      {Math.round(finalTrace.confidence * 100)}%
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                      {finalTrace.source}
                    </span>
                  </>
                )}
              </div>
              {events.slice(0, 8).map((event, index) => (
                <div key={`${event.stage}-${index}`} className="rounded-md bg-slate-50 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-bold text-slate-700">{formatTraceStage(event.stage)}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${getTraceStatusTone(event.status)}`}>{event.status}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-slate-500">{event.summary}</p>
                </div>
              ))}
              {record?.trace?.final && (
                <div className="rounded-md bg-[rgba(91,124,255,0.1)] p-2 text-[11px] text-[var(--codex-accent)]">
                  最终：{record.trace.final.action} / {record.trace.final.module || "none"} / {Math.round(record.trace.final.confidence * 100)}%
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-500">暂无 trace 数据。</p>
          )}
        </div>
      )}
    </div>
  );
}

type RuntimeTimelineItem = {
  label: string;
  status: "pending" | "running" | "done" | string;
  detail?: string;
};

function AgentRuntimeTimeline({ timeline, compact = false }: { timeline: RuntimeTimelineItem[]; compact?: boolean }) {
  const activeItem = timeline.find((item) => item.status === "running");
  const errorItem = timeline.find((item) => item.status === "error");
  const done = timeline.length > 0 && timeline.every((item) => item.status === "done");
  const [open, setOpen] = useState(false);
  const [pulseIndex, setPulseIndex] = useState(0);
  useEffect(() => {
    if (!activeItem) return;
    const timer = window.setInterval(() => setPulseIndex((value) => (value + 1) % 3), 520);
    return () => window.clearInterval(timer);
  }, [activeItem?.label]);
  if (!timeline.length) return null;
  const title = errorItem ? "需要处理" : activeItem ? `${activeItem.label}${".".repeat(pulseIndex + 1)}` : done ? (compact ? "查看处理过程" : "已完成") : "思考中";
  const summary = errorItem?.detail || activeItem?.detail || timeline[timeline.length - 1]?.detail || "Agent 正在处理。";
  const doneCount = timeline.filter((item) => item.status === "done").length;
  const buttonTone = activeItem
    ? "border-slate-200 bg-white/95 text-slate-700 hover:border-[rgba(91,124,255,0.3)] hover:bg-[rgba(91,124,255,0.12)]"
    : errorItem
      ? "border-rose-200 bg-rose-50/90 text-rose-700 hover:bg-rose-50"
    : done
      ? "border-slate-100 bg-white/70 text-slate-500 hover:border-slate-200 hover:bg-slate-50"
      : "border-slate-200 bg-white/95 text-slate-700 hover:border-[rgba(91,124,255,0.3)] hover:bg-[rgba(91,124,255,0.12)]";

  return (
    <div className={`${compact ? "mb-2" : "w-full max-w-md"} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex max-w-full items-center gap-2 rounded-2xl rounded-bl-md border px-3 py-2 text-left shadow-sm transition-colors ${buttonTone}`}
      >
        {activeItem ? <ThinkingSignal /> : errorItem ? <AlertCircle className="h-3.5 w-3.5" /> : done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Activity className="h-3.5 w-3.5" />}
        <span className="text-xs font-semibold">{title}</span>
        {(activeItem?.detail || errorItem?.detail) && <span className="hidden max-w-[220px] truncate text-[11px] text-slate-400 sm:inline">{activeItem?.detail || errorItem?.detail}</span>}
        {done && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">{doneCount}</span>}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-1.5 rounded-2xl rounded-bl-md border border-slate-200 bg-white/95 px-3 pb-3 pt-2 shadow-sm">
          <p className="mb-2 truncate text-[11px] text-slate-500">{summary}</p>
          <div className="space-y-2">
              {timeline.map((item, index) => (
                <div key={`${item.label}-${index}`} className={`flex gap-2 rounded-xl px-1.5 py-1 ${item.status === "running" ? "bg-[rgba(91,124,255,0.1)]" : item.status === "error" ? "bg-rose-50/80" : ""}`}>
                  <div className="flex w-5 shrink-0 flex-col items-center">
                    <div className={`flex h-5 w-5 items-center justify-center rounded-full ${getRuntimeTimelineNodeTone(item.status)}`}>
                      {item.status === "running" ? <ThinkingSignal /> : item.status === "done" ? <Check className="h-3 w-3" /> : item.status === "error" ? <X className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                    </div>
                  {index < timeline.length - 1 && <div className="mt-1 h-5 w-px bg-slate-200" />}
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <p className="text-[11px] font-semibold text-slate-700">{item.label}</p>
                  {item.detail && <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{item.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ThinkingSignal() {
  return (
    <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      <span className="absolute h-3 w-3 rounded-full bg-[rgba(91,124,255,0.1)] animate-ping" />
      <span className="h-2 w-2 rounded-full bg-[rgba(91,124,255,0.1)] shadow-[0_0_10px_rgba(124,58,237,0.55)]" />
    </span>
  );
}

function getWorkflowPayload(params: Record<string, unknown>): WorkflowClientPayload | null {
  const raw = params?.workflow;
  if (!isPlainObject(raw) || !isPlainObject(raw.workflow)) return null;
  return {
    workflow: raw.workflow as WorkflowRecord,
    steps: Array.isArray(raw.steps) ? orderWorkflowSteps(raw.steps as WorkflowStepRecord[]) : [],
    events: Array.isArray(raw.events) ? raw.events as WorkflowEventRecord[] : [],
    assets: Array.isArray(raw.assets) ? raw.assets as WorkflowAssetRecord[] : [],
    costEstimate: isPlainObject(raw.costEstimate) ? raw.costEstimate as WorkflowCostEstimate : undefined,
  };
}

function readAgentTimeline(params: Record<string, unknown> | undefined): RuntimeTimelineItem[] {
  if (!Array.isArray(params?.agentTimeline)) return [];
  return params.agentTimeline
    .filter(isPlainObject)
    .map((item) => ({
      label: typeof item.label === "string" ? item.label : "",
      status: typeof item.status === "string" ? item.status : "pending",
      detail: typeof item.detail === "string" ? item.detail : undefined,
    }))
    .filter((item) => item.label);
}

function normalizeAgentTimelineForMessage(
  timeline: RuntimeTimelineItem[],
  workflowPayload: WorkflowClientPayload | null,
  generation: Message["generation"] | null | undefined
): RuntimeTimelineItem[] {
  if (workflowPayload) {
    return buildWorkflowRuntimeTimeline(workflowPayload, timeline);
  }

  if (timeline.length === 0) return timeline;

  if (generation?.status === "pending") {
    return completeRuntimeTimeline(timeline, "已生成确认卡，等待确认后执行。");
  }
  if (generation?.status === "completed") {
    return completeRuntimeTimeline(timeline, "生成已完成。");
  }
  if (generation?.status === "failed") {
    return completeRuntimeTimeline(timeline, "生成已结束，可根据错误信息重试或修复。");
  }

  return timeline;
}

function buildWorkflowRuntimeTimeline(
  payload: WorkflowClientPayload,
  seedTimeline: RuntimeTimelineItem[]
): RuntimeTimelineItem[] {
  const { workflow, steps } = payload;
  const status = workflow.status;
  const latestEvent = getLatestWorkflowEvent(payload);
  const planned = status === "draft" || status === "planned" || status === "needs_confirmation";
  const terminal = ["completed", "partially_completed", "failed", "cancelled"].includes(status);
  const base: RuntimeTimelineItem[] = [
    {
      label: "理解需求",
      status: "done",
      detail: seedTimeline.find((item) => item.label === "理解意图")?.detail || "已识别用户目标和可用上下文",
    },
    {
      label: "规划任务",
      status: planned ? "running" : "done",
      detail: steps.length > 0 ? `已拆解为 ${steps.length} 个执行步骤` : "正在生成可执行方案",
    },
    {
      label: "确认方案",
      status: planned ? "running" : "done",
      detail: planned ? "等待你确认后才会扣费并执行" : "方案已确认，进入执行队列",
    },
  ];

  if (planned) return base;

  const stepItems = steps.map((step) => ({
    label: getWorkflowRuntimeStepLabel(step),
    status: mapWorkflowStepToRuntimeStatus(step.status),
    detail: getWorkflowRuntimeStepDetail(step, latestEvent),
  }));

  const resultStatus = getWorkflowResultRuntimeStatus(status, steps);
  return [
    ...base,
    ...stepItems,
    {
      label: "整理结果",
      status: resultStatus,
      detail: getWorkflowRuntimeResultDetail(status, payload),
    },
  ];
}

function getLatestWorkflowEvent(payload: WorkflowClientPayload): WorkflowEventRecord | null {
  const events = payload.events || [];
  return events.length > 0 ? events[events.length - 1] : null;
}

function getWorkflowRuntimeStepLabel(step: WorkflowStepRecord) {
  if (step.type === "commerce_detail_section") return step.title || "生成详情页板块";
  if (step.type === "commerce_detail_stitch") return "拼接详情长图";
  if (step.type === "pose_variation") return step.title || "生成姿势变化";
  if (step.type === "tryon") return step.title || "换装融合";
  if (step.type === "face_swap") return step.title || "换脸";
  if (step.type === "image_quality_check") return "质量检查";
  return step.title || getWorkflowToolLabel(step.type);
}

function mapWorkflowStepToRuntimeStatus(status: string): RuntimeTimelineItem["status"] {
  if (status === "completed" || status === "skipped") return "done";
  if (status === "running" || status === "queued" || status === "waiting_user") return "running";
  if (status === "failed" || status === "cancelled") return "error";
  return "pending";
}

function getWorkflowRuntimeStepDetail(step: WorkflowStepRecord, latestEvent: WorkflowEventRecord | null) {
  if (step.status === "queued") return "已入队，等待执行器处理";
  if (step.status === "running") {
    if (latestEvent?.step_id === step.id && latestEvent.message) return latestEvent.message;
    return getWorkflowStepLoadingLabel(step);
  }
  if (step.status === "waiting_user") return "需要你选择结果或补充信息后继续";
  if (step.status === "completed") {
    const urls = Array.isArray(step.output?.imageUrls) ? step.output?.imageUrls.length || 0 : 0;
    return urls > 0 ? `已产出 ${urls} 张结果图` : "步骤已完成";
  }
  if (step.status === "failed") return step.error_message || "步骤执行失败，可重试或修复";
  if (step.status === "skipped") return "此步骤已跳过";
  return "等待前置步骤完成";
}

function getWorkflowResultRuntimeStatus(status: WorkflowStatus | string, steps: WorkflowStepRecord[]): RuntimeTimelineItem["status"] {
  if (status === "completed" || status === "partially_completed") return "done";
  if (status === "failed" || status === "cancelled") return "error";
  if (steps.length > 0 && steps.every((step) => ["completed", "skipped"].includes(step.status))) return "running";
  return "pending";
}

function getWorkflowRuntimeResultDetail(status: WorkflowStatus | string, payload: WorkflowClientPayload) {
  const urls = getWorkflowImageUrls(payload);
  if (status === "completed") return urls.length > 0 ? `已整理 ${urls.length} 张最终结果` : "工作流已完成";
  if (status === "partially_completed") return urls.length > 0 ? `已整理 ${urls.length} 张可用结果，部分步骤未完成` : "部分步骤已完成";
  if (status === "failed") return payload.workflow.error_message || "工作流失败，可查看失败步骤并修复";
  if (status === "cancelled") return "工作流已取消";
  if (urls.length > 0) return `已收到 ${urls.length} 张结果，正在整理展示`;
  return "等待所有步骤完成后汇总结果";
}

function shouldCompleteTimelineForWorkflowStatus(status: string) {
  return ["draft", "planned", "needs_confirmation", "confirmed", "waiting_user", "queued", "completed", "partially_completed", "failed", "cancelled"].includes(status);
}

function getWorkflowTimelineDoneDetail(status: string) {
  if (status === "needs_confirmation" || status === "waiting_user" || status === "planned" || status === "draft") {
    return "计划已复核，正在等待你确认。";
  }
  if (status === "confirmed") return "计划已确认，等待进入执行队列。";
  if (status === "queued") return "计划已确认并入队，执行进度看下方步骤卡片。";
  if (status === "completed") return "工作流已完成。";
  if (status === "partially_completed") return "工作流已部分完成，可查看步骤结果。";
  if (status === "failed") return "工作流已结束，可查看失败步骤并重试。";
  if (status === "cancelled") return "工作流已取消。";
  return "计划已复核。";
}

function completeRuntimeTimeline(timeline: RuntimeTimelineItem[], finalDetail: string): RuntimeTimelineItem[] {
  return timeline.map((item, index) => ({
    ...item,
    status: "done",
    detail: index === timeline.length - 1 ? finalDetail : item.detail,
  }));
}

function getTraceId(params: Record<string, unknown> | undefined) {
  return typeof params?.traceId === "string" ? params.traceId : null;
}

function getRuntimeTimelineNodeTone(status: string) {
  if (status === "done") return "bg-emerald-500 text-white";
  if (status === "running") return "bg-slate-900 text-white";
  if (status === "error") return "bg-rose-500 text-white";
  return "bg-slate-100 text-slate-400";
}

function getMessageFeedback(params: Record<string, unknown> | undefined) {
  const raw = params?.feedback;
  if (!isPlainObject(raw)) return null;
  return {
    rating: raw.rating === "good" || raw.rating === "bad" ? raw.rating : null,
    status: typeof raw.status === "string" ? raw.status : "",
    learned: Boolean(raw.learned),
    error: typeof raw.error === "string" ? raw.error : "",
  };
}

function FeedbackStatusPill({ feedback }: { feedback: NonNullable<ReturnType<typeof getMessageFeedback>> }) {
  if (!feedback.status || feedback.status === "idle") return null;
  const text = feedback.status === "sending"
    ? "保存反馈中"
    : feedback.status === "failed"
      ? "反馈未保存"
      : feedback.learned
        ? "已学习"
        : "已记录";
  const tone = feedback.status === "failed"
    ? "bg-rose-50 text-rose-600"
    : feedback.status === "sending"
      ? "bg-slate-50 text-slate-500"
      : feedback.learned
        ? "bg-[rgba(91,124,255,0.1)] text-[var(--codex-accent)]"
        : "bg-emerald-50 text-emerald-600";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${tone}`}
      title={feedback.error || text}
    >
      {text}
    </span>
  );
}

function formatTraceStage(stage: string) {
  const labels: Record<string, string> = {
    image_understanding: "图片理解",
    dynamic_tool_selector: "工具选择",
    semantic_router: "语义路由",
    deterministic_safety_guard: "安全校验",
    workflow_critic: "计划复核",
  };
  return labels[stage] || stage;
}

function getTraceStatusTone(status: string) {
  if (status === "ok") return "bg-emerald-50 text-emerald-600";
  if (status === "warn" || status === "fallback") return "bg-amber-50 text-amber-600";
  if (status === "blocked" || status === "error") return "bg-rose-50 text-rose-600";
  return "bg-slate-100 text-slate-500";
}

function getWorkflowImageUrls(payload: WorkflowClientPayload) {
  const fromWorkflow = Array.isArray(payload.workflow.final_outputs?.imageUrls)
    ? payload.workflow.final_outputs.imageUrls
    : [];
  const fromAssets = (payload.assets || [])
    .filter((asset) => asset.kind === "image" && asset.role === "final")
    .map((asset) => asset.url);
  const finalUrls = Array.from(new Set([...fromWorkflow, ...fromAssets])).filter(Boolean);
  if (finalUrls.length > 0) return finalUrls;

  const fromSteps = payload.steps.flatMap((step) =>
    getWorkflowStepOutputUrls(step)
  );
  return Array.from(new Set(fromSteps)).filter(Boolean);
}

function getWorkflowStatusTone(status: WorkflowStatus | string) {
  if (status === "completed") return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  if (status === "partially_completed") return "bg-amber-50 text-amber-700 ring-amber-100";
  if (status === "failed" || status === "cancelled") return "bg-red-50 text-red-700 ring-red-100";
  if (status === "running" || status === "queued" || status === "confirmed") return "bg-[rgba(91,124,255,0.1)] text-[var(--codex-accent)] ring-[rgba(91,124,255,0.18)]";
  return "bg-slate-50 text-slate-600 ring-slate-100";
}

function getWorkflowStatusLabel(status: WorkflowStatus | string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    planned: "待确认",
    needs_confirmation: "待确认",
    confirmed: "已确认",
    queued: "排队中",
    running: "执行中",
    waiting_user: "等待选择",
    completed: "已完成",
    partially_completed: "部分完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return labels[status] || status;
}

function getStepStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "等待",
    ready: "就绪",
    queued: "排队",
    running: "执行",
    completed: "完成",
    failed: "失败",
    skipped: "跳过",
    waiting_user: "待选择",
    cancelled: "取消",
  };
  return labels[status] || status;
}

function getWorkflowToolLabel(type: string) {
  const labels: Record<string, string> = {
    text_to_image: "文生图",
    image_to_image: "图生图",
    tryon: "换装试穿",
  face_swap: "换脸",
    pose_variation: "姿势裂变",
    garment_3d: "3D 立体展示",
    commerce_detail: "电商详情页",
    commerce_creative: "商业创意图",
    background_replace: "背景替换",
    select_image: "结果选择",
    image_quality_check: "质量检查",
    prompt_repair: "提示词修复",
    image_to_video: "图生视频",
    image_to_3d_asset: "3D 资产",
  };
  return labels[type] || type;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function ConfirmImageRoleEditor({
  messageId,
  images,
  onPreview,
  onChange,
}: {
  messageId: string;
  images: ChatImage[];
  onPreview: (url: string) => void;
  onChange?: (messageId: string, imageIndex: number, role: ChatImageRole) => void;
}) {
  if (!onChange || images.length === 0) return null;

  return (
    <div className="mb-3 rounded-xl border border-[rgba(91,124,255,0.22)] bg-white/75 p-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-bold text-slate-600">图片角色</span>
        <span className="text-[10px] text-slate-400">确认前可修正图1/图2关系</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {images.map((img) => {
          const url = img.hostedUrl || img.url;
          return (
            <div key={`${img.index}-${url}`} className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/70 p-1.5">
              <button
                type="button"
                onClick={() => onPreview(url)}
                className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-white"
              >
                <img src={url} alt={`图${img.index}`} className="h-full w-full object-cover" />
                <span className="absolute bottom-0 left-0 right-0 bg-[rgba(91,124,255,0.1)] text-center text-[8px] font-bold leading-tight text-white">
                  图{img.index}
                </span>
              </button>
              <select
                value={img.role || "auto"}
                onChange={(event) => onChange(messageId, img.index, event.target.value as ChatImageRole)}
                className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 outline-none transition-colors focus:border-[rgba(91,124,255,0.5)]"
                title={`设置图${img.index}的图片角色`}
              >
                {CONFIRM_ROLE_OPTIONS.map((role) => (
                  <option key={role.value} value={role.value}>{role.label}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConfirmRoleIssues({ issues }: { issues: ReturnType<typeof validateConfirmImageRoles> }) {
  if (issues.length === 0) return null;
  return (
    <div className="mb-3 space-y-1.5">
      {issues.map((issue, index) => (
        <div
          key={`${issue.severity}-${index}`}
          className={`rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed ${
            issue.severity === "error"
              ? "border-red-200 bg-red-50 text-red-600"
              : "border-amber-200 bg-amber-50 text-amber-700"
          }`}
        >
          {issue.message}
        </div>
      ))}
    </div>
  );
}

function ConfirmTaskTicket({
  moduleName,
  images,
  params,
  jobPayload,
  credits,
}: {
  moduleName: string;
  images: ChatImage[];
  params: Record<string, unknown>;
  jobPayload?: Record<string, unknown>;
  credits: number;
}) {
  const normalized = readConfirmParams(params);
  const { used, unused } = splitUsedImages(images, params, jobPayload);
  const outputForm = getConfirmOutputForm(moduleName, params, jobPayload);
  const usedText = used.length > 0
    ? used.map((img) => `图${img.index} ${getRoleLabel(img.role || "auto")}`).join(" / ")
    : "不使用附件图";
  const unusedText = unused.length > 0 ? `不使用 ${unused.map((img) => `图${img.index}`).join("、")}` : "附件都会参与判断";

  return (
    <div className="mb-3 overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50/70 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <ConfirmChip label={moduleName} />
          <ConfirmChip label={outputForm} />
          <ConfirmChip label={`${normalized.count} 张`} />
          <ConfirmChip label={`${credits || 0} 灵点`} tone="amber" />
        </div>
      </div>
      <div className="grid gap-2 p-3 text-[11px] leading-relaxed text-slate-600 sm:grid-cols-2">
        <ConfirmTicketRow label="图片关系" value={usedText} />
        <ConfirmTicketRow label="未使用" value={unusedText} muted={unused.length === 0} />
        <ConfirmTicketRow label="规格" value={`${normalized.model} · ${normalized.aspectRatio} · ${normalized.imageSize}`} />
        <ConfirmTicketRow label="扣费" value="点击确认后才扣费；修改参数不扣费" tone="amber" />
      </div>
    </div>
  );
}

function ConfirmTicketRow({
  label,
  value,
  tone = "slate",
  muted = false,
}: {
  label: string;
  value: string;
  tone?: "slate" | "amber";
  muted?: boolean;
}) {
  return (
    <div className={`rounded-xl px-2.5 py-2 ring-1 ${
      tone === "amber"
        ? "bg-amber-50 text-amber-700 ring-amber-100"
        : "bg-white text-slate-600 ring-slate-100"
    }`}>
      <p className="text-[10px] font-bold text-slate-400">{label}</p>
      <p className={`mt-0.5 font-semibold ${muted ? "text-slate-400" : ""}`}>{value}</p>
    </div>
  );
}

function getConfirmOutputForm(
  moduleName: string,
  params: Record<string, unknown>,
  jobPayload?: Record<string, unknown>
) {
  const text = flattenStrings([moduleName, params, jobPayload || {}]).join("\n").toLowerCase();
  if (text.includes("详情页") || text.includes("detail")) return "详情页素材";
  if (text.includes("长图") || text.includes("拼接")) return "手机长图";
  if (text.includes("四宫格")) return "四宫格";
  if (text.includes("单独") || text.includes("独立")) return "多张单图";
  if (text.includes("3d")) return "3D 展示";
  if (text.includes("试穿") || text.includes("换装") || text.includes("tryon")) return "换装图";
  return "图片生成";
}

function hasConfirmRoleErrors(module: string, params: Record<string, unknown>, images: ChatImage[]) {
  return validateConfirmImageRoles(module, params, images).some((issue) => issue.severity === "error");
}

function ConfirmExecutionSummary({
  moduleName,
  images,
  params,
  jobPayload,
  credits,
}: {
  moduleName: string;
  images: ChatImage[];
  params?: Record<string, unknown>;
  jobPayload?: Record<string, unknown>;
  credits: number;
}) {
  const usedImages = images.length > 0
    ? images.map((img) => `图${img.index}=${getRoleLabel(img.role || "auto")}`).join("，")
    : "不使用附件图，仅按文字生成";

  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-white/80 p-3 text-[11px] leading-relaxed text-slate-600">
      <p className="mb-1 font-bold text-slate-800">执行前确认</p>
      <p>我识别到本次任务是：<span className="font-bold text-[var(--codex-accent)]">{moduleName}</span>。</p>
      <p>将使用：{usedImages}。</p>
      <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-amber-700">
        点击“确认生成”后才会扣除 {credits || 0} 灵点；如果只是调整参数或图片角色，不会扣费。
      </p>
    </div>
  );
}

function ConfirmExecutionSummaryV2({
  moduleName,
  images,
  params,
  jobPayload,
  credits,
}: {
  moduleName: string;
  images: ChatImage[];
  params: Record<string, unknown>;
  jobPayload?: Record<string, unknown>;
  credits: number;
}) {
  const { used, unused } = splitUsedImages(images, params, jobPayload);
  const usedText = used.length > 0
    ? used.map((img) => `图${img.index}=${getRoleLabel(img.role || "auto")}`).join("，")
    : "不使用附件图，仅按文字生成";
  const unusedText = unused.length > 0
    ? unused.map((img) => `图${img.index}`).join("、")
    : "无";

  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-white/80 p-3 text-[11px] leading-relaxed text-slate-600">
      <p className="mb-1 font-bold text-slate-800">执行前确认</p>
      <p>我识别到本次任务是：<span className="font-bold text-[var(--codex-accent)]">{moduleName}</span>。</p>
      <p>将使用：{usedText}。</p>
      <p>不会使用：{unusedText}。</p>
      <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-amber-700">
        点击“确认生成”后才会扣除 {credits || 0} 灵点；如果只是调整参数或图片角色，不会扣费。
      </p>
    </div>
  );
}

function splitUsedImages(
  images: ChatImage[],
  params: Record<string, unknown>,
  jobPayload?: Record<string, unknown>
): { used: ChatImage[]; unused: ChatImage[] } {
  if (images.length === 0) return { used: [], unused: [] };
  const haystack = flattenStrings([params, jobPayload || {}]).join("\n");
  const used = images.filter((img) => {
    const urls = [img.url, img.hostedUrl].filter(Boolean) as string[];
    return urls.some((url) => haystack.includes(url));
  });
  if (used.length === 0) return { used: images, unused: [] };
  return {
    used,
    unused: images.filter((img) => !used.some((usedImg) => usedImg.index === img.index)),
  };
}

function flattenStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(flattenStrings);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(flattenStrings);
  }
  return [];
}

function ConfirmIntentBrief({
  moduleName,
  images,
  params,
  jobPayload,
  taskBrief,
}: {
  moduleName: string;
  images: ChatImage[];
  params: Record<string, unknown>;
  jobPayload?: Record<string, unknown>;
  taskBrief?: AgentTaskBrief;
}) {
  const { used, unused } = splitUsedImages(images, params, jobPayload);
  const prompt = typeof params.prompt === "string" ? params.prompt : typeof jobPayload?.prompt === "string" ? jobPayload.prompt : "";
  const brief = taskBrief || buildIntentBrief(moduleName, prompt, used, unused, params);

  return (
    <div className="mb-3 rounded-xl border border-[rgba(91,124,255,0.22)] bg-gradient-to-br from-white to-[var(--codex-accent-soft)]/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-800">{"\u4efb\u52a1\u65b9\u6848"}</p>
        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-[var(--codex-accent)] ring-1 ring-[rgba(91,124,255,0.18)]">
          {brief.outputType}
        </span>
      </div>
      <div className="space-y-1.5 text-[11px] leading-relaxed text-slate-600">
        <p><span className="font-bold text-slate-700">{"\u76ee\u6807\uff1a"}</span>{brief.goal}</p>
        <p><span className="font-bold text-slate-700">{"\u56fe\u7247\uff1a"}</span>{brief.imageUsage}</p>
        <p><span className="font-bold text-slate-700">{"\u91cd\u70b9\uff1a"}</span>{brief.focus}</p>
        {brief.risks && brief.risks.length > 0 && (
          <div className="rounded-lg bg-rose-50 px-2 py-1 text-rose-700 ring-1 ring-rose-100">
            <p className="font-bold">{"\u98ce\u9669\u9884\u5224\uff1a"}</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
              {brief.risks.slice(0, 3).map((risk) => (
                <li key={risk}>{risk}</li>
              ))}
            </ul>
          </div>
        )}
        {brief.preflight && brief.preflight.length > 0 && (
          <PreflightChecks checks={brief.preflight} />
        )}
        <p className="rounded-lg bg-white/80 px-2 py-1 text-amber-700 ring-1 ring-amber-100">
          <span className="font-bold">{"\u786e\u8ba4\u524d\u68c0\u67e5\uff1a"}</span>{brief.check}
        </p>
        {brief.rationale && brief.rationale.length > 0 && (
          <DecisionRationale lines={brief.rationale} />
        )}
      </div>
    </div>
  );
}

function PreflightChecks({ checks }: { checks: NonNullable<AgentTaskBrief["preflight"]> }) {
  return (
    <div className="rounded-lg bg-white/85 px-2 py-1.5 ring-1 ring-slate-100">
      <p className="mb-1 font-bold text-slate-700">{"\u751f\u6210\u524d\u81ea\u68c0"}</p>
      <div className="grid gap-1 sm:grid-cols-2">
        {checks.slice(0, 5).map((check) => (
          <div key={`${check.label}-${check.detail}`} className="flex min-w-0 items-start gap-1.5 rounded-md bg-slate-50 px-2 py-1">
            {check.status === "pass" ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            ) : (
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            )}
            <p className="min-w-0 text-[10px] leading-4 text-slate-500">
              <span className="font-bold text-slate-700">{check.label}</span>
              {"\uff1a"}
              {check.detail}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionRationale({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-slate-100 bg-white/80">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-[11px] font-bold text-slate-500 transition-colors hover:bg-slate-50"
      >
        <span>{"\u51b3\u7b56\u4f9d\u636e"}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="space-y-1 border-t border-slate-100 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
          {lines.slice(0, 5).map((line) => (
            <li key={line} className="list-disc">{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function buildIntentBrief(
  moduleName: string,
  prompt: string,
  used: ChatImage[],
  unused: ChatImage[],
  params: Record<string, unknown>
) {
  const lower = `${moduleName}\n${prompt}`.toLowerCase();
  const count = Number(params.count || params.gen_count || 1);
  const outputType = getBriefOutputType(moduleName, lower, count);
  const goal = getBriefGoal(moduleName, lower);
  const imageUsage = used.length > 0
    ? used.map((img) => `\u56fe${img.index}\u4f5c\u4e3a${getRoleLabel(img.role || "auto")}`).join("\uff1b")
    : "\u4e0d\u4f7f\u7528\u53c2\u8003\u56fe\uff0c\u6309\u6587\u5b57\u76f4\u63a5\u751f\u6210";
  const unusedText = unused.length > 0 ? `\uff1b\u4e0d\u7528${unused.map((img) => `\u56fe${img.index}`).join("\u3001")}` : "";

  return {
    outputType,
    goal,
    imageUsage: `${imageUsage}${unusedText}`,
    focus: getBriefFocus(moduleName, lower),
    check: getBriefCheck(moduleName, lower),
    risks: getBriefRisks(moduleName, lower, used, params),
    rationale: [],
    preflight: [],
  };
}

function getBriefOutputType(moduleName: string, lower: string, count: number) {
  if (lower.includes("\u8be6\u60c5\u9875")) return "\u7535\u5546\u8be6\u60c5";
  if (lower.includes("banner")) return "Banner";
  if (lower.includes("\u4e3b\u56fe")) return "\u7535\u5546\u4e3b\u56fe";
  if (lower.includes("\u56db\u5bab\u683c")) return "\u56db\u5bab\u683c";
  if (count > 1) return `${count} \u5f20\u56fe`;
  return moduleName;
}

function getBriefGoal(moduleName: string, lower: string) {
  if (lower.includes("\u8be6\u60c5\u9875")) return "\u751f\u6210\u53ef\u7528\u4e8e\u6dd8\u5b9d/\u5929\u732b/\u4eac\u4e1c\u7684\u5546\u54c1\u8be6\u60c5\u9875\uff0c\u4e0d\u662f\u79cd\u8349\u6216\u8857\u62cd\u56fe\u3002";
  if (lower.includes("banner")) return "\u751f\u6210\u6a2a\u7248\u5546\u4e1a banner\uff0c\u517c\u987e\u4e3b\u4f53\u3001\u6807\u9898\u548c\u5356\u70b9\u5c42\u7ea7\u3002";
  if (lower.includes("\u4e3b\u56fe")) return "\u751f\u6210\u7535\u5546\u4e3b\u56fe\uff0c\u4e3b\u4f53\u6e05\u695a\uff0c\u5356\u70b9\u76f4\u89c2\u3002";
  if (moduleName.includes("姿") || lower.includes("pose")) return "\u57fa\u4e8e\u4e3b\u56fe\u505a\u59ff\u52bf\u53d8\u5316\uff0c\u4fdd\u6301\u4eba\u7269\u548c\u670d\u88c5\u7a33\u5b9a\u3002";
  if (moduleName.toLowerCase().includes("grass")) return "\u751f\u6210\u670d\u88c5\u79cd\u8349\u89c6\u89c9\uff0c\u4fdd\u6301\u670d\u88c5\u8fd8\u539f\u548c\u751f\u6d3b\u6c1b\u56f4\u3002";
  return "\u6309\u7528\u6237\u539f\u59cb\u8981\u6c42\u751f\u6210\u56fe\u50cf\uff0c\u53c2\u8003\u56fe\u53ea\u670d\u52a1\u4e8e\u8fd9\u4e2a\u76ee\u6807\u3002";
}

function getBriefFocus(moduleName: string, lower: string) {
  if (lower.includes("\u8be6\u60c5\u9875")) return "\u7248\u5f0f\u5206\u533a\u3001\u5546\u54c1\u4e3b\u4f53\u3001\u5356\u70b9\u6587\u6848\u3001\u7ec6\u8282/\u53c2\u6570\u5c42\u7ea7\u3002";
  if (moduleName.includes("姿") || lower.includes("pose")) return "\u4eba\u7269\u6bd4\u4f8b\u3001\u8138\u90e8\u4e00\u81f4\u3001\u670d\u88c5\u4e00\u81f4\u3001\u771f\u5b9e\u5173\u8282\u52a8\u4f5c\u3002";
  if (moduleName.toLowerCase().includes("tryon")) return "\u670d\u88c5\u8fd8\u539f\u3001\u7a7f\u7740\u5408\u8eab\u3001\u4eba\u8138\u8eab\u4efd\u3001\u81ea\u7136\u4f53\u6001\u3002";
  return "\u4e3b\u4f53\u4e0d\u8dd1\u504f\u3001\u98ce\u683c\u4e0d\u786c\u5957\u3001\u753b\u9762\u670d\u52a1\u4e8e\u6700\u7ec8\u7528\u9014\u3002";
}

function getBriefCheck(moduleName: string, lower: string) {
  if (lower.includes("\u8be6\u60c5\u9875")) return "\u5982\u679c\u8fd9\u91cc\u88ab\u8bc6\u522b\u6210\u79cd\u8349/\u8857\u62cd\uff0c\u5148\u6539\u6700\u7ec8\u63d0\u793a\u8bcd\u518d\u751f\u6210\u3002";
  if (moduleName.includes("姿") || lower.includes("pose")) return "\u5982\u679c\u9700\u8981\u6bcf\u4e2a\u59ff\u52bf\u5355\u72ec\u4e00\u5f20\uff0c\u5148\u5728\u6700\u7ec8\u63d0\u793a\u8bcd\u91cc\u5199\u660e\u3002";
  return "\u786e\u8ba4\u76ee\u6807\u3001\u56fe\u7247\u89d2\u8272\u548c\u6bd4\u4f8b\u6ca1\u95ee\u9898\u540e\u518d\u6263\u5206\u751f\u6210\u3002";
}

function getBriefRisks(moduleName: string, lower: string, used: ChatImage[], params: Record<string, unknown>): string[] {
  const risks: string[] = [];
  const count = Number(params.count || params.gen_count || 1);
  if (lower.includes("\u8be6\u60c5\u9875")) {
    risks.push("\u751f\u56fe\u6a21\u578b\u53ef\u80fd\u628a\u8be6\u60c5\u9875\u505a\u6210\u5355\u5f20\u6c1b\u56f4\u56fe\uff0c\u9700\u68c0\u67e5\u7248\u5f0f\u5206\u533a\u548c\u5356\u70b9\u5c42\u7ea7\u3002");
    risks.push("\u4e2d\u6587\u5c0f\u5b57\u53ef\u80fd\u4e0d\u7a33\u5b9a\uff0c\u91cd\u8981\u6587\u6848\u5efa\u8bae\u4fdd\u6301\u77ed\u53e5\u3002");
  }
  if (moduleName.includes("姿") || lower.includes("pose")) {
    risks.push("\u59ff\u52bf\u53d8\u5316\u5bb9\u6613\u5e26\u6765\u624b\u6307\u3001\u5173\u8282\u548c\u8eab\u4f53\u6bd4\u4f8b\u6f02\u79fb\u3002");
    risks.push("\u56db\u5bab\u683c\u548c\u591a\u5f20\u72ec\u7acb\u56fe\u9700\u660e\u786e\u533a\u5206\uff0c\u5426\u5219\u6a21\u578b\u53ef\u80fd\u8f93\u51fa\u9519\u5f62\u5f0f\u3002");
  }
  if (moduleName.toLowerCase().includes("tryon")) {
    risks.push("\u6362\u88c5\u4efb\u52a1\u5bb9\u6613\u6539\u53d8\u670d\u88c5\u7ed3\u6784\u3001logo\u6216\u9762\u6599\u7ec6\u8282\u3002");
  }
  if (used.length === 0 && lower.includes("\u53c2\u8003")) {
    risks.push("\u65b9\u6848\u63d0\u5230\u53c2\u8003\u56fe\uff0c\u4f46\u5f53\u524d\u672a\u68c0\u6d4b\u5230\u4f1a\u88ab\u4f7f\u7528\u7684\u56fe\u7247\u3002");
  }
  if (count > 1) {
    risks.push("\u591a\u5f20\u56fe\u7684\u89d2\u8272\u3001\u98ce\u683c\u548c\u4e3b\u4f53\u4e00\u81f4\u6027\u53ef\u80fd\u4f1a\u6709\u6ce2\u52a8\u3002");
  }
  return Array.from(new Set(risks)).slice(0, 4);
}

function ConfirmTaskPlan({
  moduleName,
  params,
  credits,
}: {
  moduleName: string;
  params: GenerationParams;
  credits: number;
}) {
  const steps = [
    "确认参数",
    "扣除灵点",
    "生成图片",
    "校验结果",
  ];

  return (
    <div className="mb-3 rounded-xl border border-[rgba(91,124,255,0.22)] bg-white/75 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <ConfirmChip label={moduleName} />
        <ConfirmChip label={params.model} />
        <ConfirmChip label={`${params.aspectRatio} · ${params.imageSize}`} />
        <ConfirmChip label={`${params.count} 张`} />
        <ConfirmChip label={`${credits} 灵点`} tone="amber" />
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {steps.map((step, index) => (
          <div key={step} className="relative rounded-lg bg-slate-50 px-2 py-2 text-center">
            {index < steps.length - 1 && (
              <div className="absolute left-[calc(50%+12px)] top-4 hidden h-px w-[calc(100%-20px)] bg-[rgba(91,124,255,0.1)] sm:block" />
            )}
            <div className="relative z-10 mx-auto mb-1 flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(91,124,255,0.1)] text-[10px] font-black text-[var(--codex-accent)]">
              {index + 1}
            </div>
            <p className="relative z-10 text-[10px] font-semibold text-slate-500">{step}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfirmTaskPlanV2({
  moduleName,
  params,
  credits,
}: {
  moduleName: string;
  params: GenerationParams;
  credits: number;
}) {
  const [open, setOpen] = useState(false);
  const steps = ["确认参数", "扣除灵点", "生成图片", "校验结果"];

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-[rgba(91,124,255,0.22)] bg-white/75">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[rgba(91,124,255,0.12)]"
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-slate-800">执行计划</p>
          <p className="truncate text-[11px] text-slate-400">
            {moduleName} · {params.model} · {params.aspectRatio} · {params.imageSize} · {params.count} 张 · {credits} 灵点
          </p>
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-[rgba(91,124,255,0.22)] p-3">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <ConfirmChip label={moduleName} />
            <ConfirmChip label={params.model} />
            <ConfirmChip label={`${params.aspectRatio} · ${params.imageSize}`} />
            <ConfirmChip label={`${params.count} 张`} />
            <ConfirmChip label={`${credits} 灵点`} tone="amber" />
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {steps.map((step, index) => (
              <div key={step} className="relative rounded-lg bg-slate-50 px-2 py-2 text-center">
                {index < steps.length - 1 && (
                  <div className="absolute left-[calc(50%+12px)] top-4 hidden h-px w-[calc(100%-20px)] bg-[rgba(91,124,255,0.1)] sm:block" />
                )}
                <div className="relative z-10 mx-auto mb-1 flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(91,124,255,0.1)] text-[10px] font-black text-[var(--codex-accent)]">
                  {index + 1}
                </div>
                <p className="relative z-10 text-[10px] font-semibold text-slate-500">{step}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] leading-relaxed text-slate-500">
            失败后系统不会自动再次发起扣费；如果服务端判定任务已失败且符合退款条件，会通过灵点事务退回。
          </p>
        </div>
      )}
    </div>
  );
}

function FailureCreditNotice({ generation }: { generation: NonNullable<Message["generation"]> }) {
  const hasServerJob = Boolean(generation.generationId);
  const credits = generation.creditsUsed || 0;

  return (
    <div className="mt-2 rounded-lg border border-red-100 bg-white/85 px-2.5 py-2 text-[11px] leading-relaxed text-slate-600">
      <p className="font-bold text-slate-700">灵点状态</p>
      {hasServerJob ? (
        <p>
          本任务已创建服务端记录。失败后服务端会调用退款事务，符合条件时退回
          <span className="font-bold text-red-600"> {credits} </span>
          灵点；最终以余额和灵点日志为准。
        </p>
      ) : (
        <p>
          本任务在正式创建生成记录前失败，通常不会产生扣费；重新生成会重新进入确认流程。
        </p>
      )}
    </div>
  );
}

function isAmbiguousClarifyMessage(content: string): boolean {
  return content.includes("\u6307\u4ee4\u8fd8\u6709\u70b9\u6a21\u7cca")
    || content.includes("\u8bf7\u76f4\u63a5\u56de\u590d\u4e00\u4e2a\u66f4\u660e\u786e\u7684\u65b9\u5411");
}

function ClarifyQuickReplies({ onSelect }: { onSelect: (text: string) => void }) {
  const replies = [
    "\u6309\u8fd9\u5f20\u56fe\u91cd\u65b0\u8bbe\u8ba1\u4e00\u5f20\u5546\u4e1a\u56fe",
    "\u751f\u6210\u6dd8\u5b9d\u8be6\u60c5\u9875",
    "\u4fdd\u7559\u4e3b\u4f53\uff0c\u53ea\u4fee\u590d\u6bd4\u4f8b/\u624b\u6307/\u6587\u5b57",
  ];

  return (
    <div className="mt-2 flex max-w-md flex-wrap gap-1.5">
      {replies.map((reply) => (
        <button
          key={reply}
          type="button"
          onClick={() => onSelect(reply)}
          className="rounded-full border border-[rgba(91,124,255,0.22)] bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-[var(--codex-accent)] shadow-sm transition-colors hover:border-[rgba(91,124,255,0.3)] hover:bg-[rgba(91,124,255,0.12)]"
        >
          {reply}
        </button>
      ))}
    </div>
  );
}

function getGenerationRepairKind(module: string): RepairKind {
  if (module === "grass") return "grass";
  if (module === "pose") return "pose";
  if (module === "model") return "model";
  if (module === "garment_3d") return "garment3d";
  if (module === "model_background") return "modelBackground";
  if (module === "material_enhancement" || module === "materialEnhancement") return "materialEnhancement";
  if (module === "tryon") return "tryon";
  return "general";
}

function getPriorityRepairValues(module: string, risks: string[]): string[] {
  const text = risks.join("\n");
  const values: string[] = [];
  if (text.includes("\u8be6\u60c5\u9875") || text.includes("\u5355\u5f20\u6c1b\u56f4\u56fe") || text.includes("\u7248\u5f0f")) values.push("layout_hierarchy");
  if (text.includes("\u4e2d\u6587") || text.includes("\u5c0f\u5b57") || text.includes("\u56fe\u6807") || text.includes("\u6587\u5b57")) values.push("text_clean", "logo_text");
  if (module === "material_enhancement" || module === "materialEnhancement") {
    if (text.includes("\u670d\u88c5") || text.includes("logo") || text.includes("\u4e3b\u4f53")) values.push("style_shape_restore");
    if (text.includes("\u7ec6\u8282") || text.includes("\u6750\u8d28") || text.includes("\u7eb9\u7406") || text.includes("\u9510\u5316")) values.push("detail_only", "natural_texture");
  } else if (text.includes("\u670d\u88c5") || text.includes("logo") || text.includes("\u4e3b\u4f53")) values.push(module === "general" ? "product_restore" : "garment_restore");
  if (text.includes("\u624b\u6307") || text.includes("\u5173\u8282") || text.includes("\u8eab\u4f53\u6bd4\u4f8b")) values.push("body_hands");
  if (text.includes("\u8138\u90e8") || text.includes("\u6362\u8138")) values.push("face_identity", "face_consistency");
  if (text.includes("\u591a\u5f20") || text.includes("\u4e00\u81f4")) values.push("intent_restore", "clothing_consistency", "face_consistency");
  return Array.from(new Set(values)).slice(0, 3);
}

function getRoleLabel(role: ChatImageRole): string {
  const item = CONFIRM_ROLE_OPTIONS.find((option) => option.value === role);
  return item?.label || "自动";
}

function ConfirmChip({ label, tone = "accent" }: { label: string; tone?: "accent" | "amber" }) {
  const cls = tone === "amber"
    ? "bg-amber-50 text-amber-700 ring-amber-100"
    : "bg-[rgba(91,124,255,0.1)] text-[var(--codex-accent)] ring-[rgba(91,124,255,0.18)]";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${cls}`}>
      {label}
    </span>
  );
}

function ConfirmParamsEditor({
  messageId,
  params,
  onChange,
}: {
  messageId: string;
  params: GenerationParams;
  onChange?: (messageId: string, params: Partial<GenerationParams>) => void;
}) {
  if (!onChange) return null;

  return (
    <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl border border-amber-100 bg-white/70 p-2">
      <ConfirmSelect
        label="模型"
        value={params.model}
        options={CONFIRM_MODEL_OPTIONS}
        onChange={(value) => onChange(messageId, { model: value as LingyaModel })}
      />
      <ConfirmSelect
        label="比例"
        value={params.aspectRatio}
        options={CONFIRM_RATIO_OPTIONS}
        onChange={(value) => onChange(messageId, { aspectRatio: value as AspectRatio })}
      />
      <ConfirmSelect
        label="分辨率"
        value={params.imageSize}
        options={CONFIRM_SIZE_OPTIONS}
        onChange={(value) => onChange(messageId, { imageSize: value as ImageSize })}
      />
      <ConfirmSelect
        label="数量"
        value={String(params.count)}
        options={[1, 2, 3, 4].map((value) => ({ value: String(value), label: `${value} 张` }))}
        onChange={(value) => onChange(messageId, { count: Number(value) })}
      />
    </div>
  );
}

function ConfirmPromptEditor({
  messageId,
  prompt,
  onChange,
}: {
  messageId: string;
  prompt: string;
  onChange?: (messageId: string, params: Partial<GenerationParams>) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!onChange || !prompt) return null;

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-[rgba(91,124,255,0.22)] bg-white/75">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[rgba(91,124,255,0.12)]"
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-slate-800">{"\u6700\u7ec8\u6267\u884c\u63d0\u793a\u8bcd"}</p>
          <p className="truncate text-[11px] text-slate-400">{prompt}</p>
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-[rgba(91,124,255,0.22)] p-3">
          <textarea
            value={prompt}
            onChange={(event) => onChange(messageId, { prompt: event.target.value })}
            className="min-h-28 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-700 outline-none transition-colors focus:border-[rgba(91,124,255,0.5)]"
            placeholder={"\u786e\u8ba4\u524d\u53ef\u4ee5\u76f4\u63a5\u6539\u6700\u7ec8\u6267\u884c\u63d0\u793a\u8bcd"}
          />
          <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
            {"\u8fd9\u91cc\u7684\u5185\u5bb9\u4f1a\u76f4\u63a5\u53d1\u7ed9\u751f\u56fe\u6a21\u578b\uff0c\u9002\u5408\u8865\u5145\u7248\u5f0f\u3001\u98ce\u683c\u3001\u6587\u6848\u548c\u7981\u6b62\u65b9\u5411\u3002"}
          </p>
        </div>
      )}
    </div>
  );
}

function ConfirmSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="min-w-0">
      <span className="mb-1 block text-[10px] font-bold text-slate-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 outline-none transition-colors focus:border-[rgba(91,124,255,0.5)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function readConfirmParams(params: Record<string, unknown>): GenerationParams {
  return {
      model: String(params.model || params.ai_model || "nano-banana-2") as LingyaModel,
    aspectRatio: String(params.aspectRatio || params.aspect_ratio || "3:4") as AspectRatio,
    imageSize: String(params.imageSize || params.image_size || "1K") as ImageSize,
    count: Math.min(Math.max(Number(params.count || params.gen_count || 1), 1), 4),
    prompt: typeof params.prompt === "string" ? params.prompt : "",
  };
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "刚刚";
  if (diffMins < 60) return `${diffMins} 分钟前`;
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const time = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (isToday) return time;
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

function formatTimeShort(ts: string): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * 流式 Markdown 渲染器
 * 服务器只发送干净的 reply 文本（无 JSON），所以可以安全地实时渲染。
 * 流式中显示闪烁光标表示还在生成。
 */
function StreamingMarkdown({ content, done }: { content: string; done?: boolean }) {
  if (!content) return null;

  return (
    <>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      {!done && <span className="inline-block h-4 w-0.5 animate-pulse bg-[rgba(91,124,255,0.1)] align-middle ml-0.5" />}
    </>
  );
}

function QuickAction({
  icon, label, onClick, variant = "default",
}: {
  icon: React.ReactNode; label: string; onClick: () => void; variant?: "default" | "primary";
}) {
  const base = "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all";
  const styles = variant === "primary"
    ? "bg-[rgba(91,124,255,0.1)] text-white shadow-sm hover:bg-[rgba(91,124,255,0.12)]"
    : "border border-slate-200 bg-white text-slate-600 hover:border-[rgba(91,124,255,0.3)] hover:text-[var(--codex-accent)]";
  return (
    <button onClick={onClick} className={`${base} ${styles}`}>
      {icon} {label}
    </button>
  );
}
