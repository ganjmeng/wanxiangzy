import Link from "next/link";
import type { ReactNode } from "react";
import {
  AdminNotice,
  AdminPageHeader,
  AdminSection,
  AdminStatusBadge,
  AdminTable,
  ThumbnailStrip,
  formatDateTime,
  formatNumber,
  shortAdminCode,
} from "@/components/admin/AdminPrimitives";
import { AdminTaskActions } from "@/components/admin/AdminTaskActions";
import {
  getAdminTaskDetail,
  type AdminAuditLog,
  type AdminCreditLogItem,
  type AdminTaskDetail,
} from "@/lib/admin/data";
import { requireAdmin } from "@/lib/admin/auth";
import { hasAdminPermission } from "@/lib/admin/permissions";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminTaskDetailPage({ params }: PageProps) {
  const admin = await requireAdmin("tasks:read");
  const { id } = await params;
  const detail = await getAdminTaskDetail(id);
  const task = detail.task || detail.queueItem;
  const diagnostics = buildTaskDiagnostics(detail);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="任务详情"
        title={task?.title || "任务详情"}
        description="集中处理生成任务的状态、图片结果、灵点变动和操作记录，适合排查失败、卡住和补偿问题。"
        actions={
          <Link href="/admin/generations" className="inline-flex h-9 items-center rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 text-xs font-black text-[var(--admin-fg)] shadow-sm hover:bg-[var(--admin-surface-soft)]">
            返回任务列表
          </Link>
        }
      />

      {!task && <AdminNotice tone="danger">未找到该任务。</AdminNotice>}
      {detail.warnings.length > 0 && <AdminNotice>任务详情数据源提示：{detail.warnings.slice(0, 3).join("；")}</AdminNotice>}

      {task && (
        <AdminSection
          title="执行排障"
          description="这里优先展示任务真正执行时最关键的信息：报错原因、最终提示词、provider 状态和返回结果。"
        >
          <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="space-y-4">
              <DiagnosticPanel title="报错原因" tone={diagnostics.errors.length ? "danger" : "neutral"}>
                {diagnostics.errors.length ? (
                  <div className="space-y-2">
                    {diagnostics.errors.map((error, index) => (
                      <ReadableBlock key={`${error.label}-${index}`} label={error.label} value={error.value} tone="danger" />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-[var(--admin-muted)]">当前任务没有记录错误。</p>
                )}
              </DiagnosticPanel>

              <DiagnosticPanel title="返回结果">
                <div className="space-y-3">
                  <ResultUrlList urls={diagnostics.resultUrls} />
                  {diagnostics.providerInfo.length ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {diagnostics.providerInfo.map((item) => (
                        <DetailItem key={item.label} label={item.label} value={item.value} mono />
                      ))}
                    </div>
                  ) : null}
                  {diagnostics.resultMeta.length ? (
                    <div className="space-y-2">
                      {diagnostics.resultMeta.map((item, index) => (
                        <ReadableBlock key={`${item.label}-${index}`} label={item.label} value={item.value} />
                      ))}
                    </div>
                  ) : null}
                </div>
              </DiagnosticPanel>
            </div>

            <DiagnosticPanel title="最终执行提示词">
              {diagnostics.prompts.length ? (
                <div className="space-y-3">
                  {diagnostics.prompts.map((prompt, index) => (
                    <div key={`${prompt.label}-${index}`} className={`rounded-lg border bg-[var(--admin-surface)] ${prompt.isFinal ? "border-[var(--admin-border)]" : "border-[var(--admin-warning-border)]"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--admin-border)] px-3 py-2">
                        <span className="text-xs font-black text-[var(--admin-fg)]">
                          {prompt.label}
                          {!prompt.isFinal ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">未记录最终字段</span> : null}
                        </span>
                        <span className="font-mono text-[11px] font-bold text-[var(--admin-faint)]">{prompt.meta}</span>
                      </div>
                      {!prompt.isFinal ? (
                        <div className="border-b border-amber-100 bg-[var(--admin-warning-soft)] px-3 py-2 text-xs font-bold leading-5 text-amber-800">
                          这个任务没有保存 compiledPrompt/finalPrompt，下面只能显示请求侧提示词；新任务应展示最终发给模型的执行提示词。
                        </div>
                      ) : null}
                      <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-5 text-[var(--admin-fg)]">{prompt.value}</pre>
                      {prompt.original && prompt.original !== prompt.value ? (
                        <details className="border-t border-[var(--admin-border)] px-3 py-2">
                          <summary className="cursor-pointer text-xs font-black text-[var(--admin-muted)]">查看原始提示词</summary>
                          <pre className="mt-2 max-h-[260px] overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-[var(--admin-fg)]">{prompt.original}</pre>
                        </details>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm font-semibold text-[var(--admin-muted)]">该任务没有记录最终执行提示词；可在下方技术排查 JSON 中查看原始 payload。</p>
              )}
            </DiagnosticPanel>
          </div>
        </AdminSection>
      )}

      {task && (
        <AdminSection title="任务摘要">
          <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-5">
            <DetailItem label="任务编号" value={shortAdminCode(task.sourceId, "任务")} />
            <DetailItem label="用户" value={detail.userEmail || shortAdminCode(task.userId, "用户")} href={`/admin/users/${task.userId}`} />
            <DetailItem label="模块" value={task.moduleLabel} />
            <DetailItem label="处理状态" value={task.isStale ? `长时间未完成 ${task.staleMinutes} 分钟` : "正常推进"} />
            <div>
              <dt className="text-xs font-black uppercase tracking-[0.08em] text-[var(--admin-faint)]">状态</dt>
              <dd className="mt-1"><AdminStatusBadge status={task.status} group={task.statusGroup} /></dd>
            </div>
            <DetailItem label="时间" value={formatDateTime(task.createdAt)} />
            {task.queueReason ? <DetailItem label="等待原因" value={formatQueueReason(task.queueReason)} /> : null}
            {task.nextAttemptAt ? <DetailItem label="下次尝试" value={formatDateTime(task.nextAttemptAt)} /> : null}
            {task.capacityDeferCount ? <DetailItem label="容量退避次数" value={formatNumber(task.capacityDeferCount)} /> : null}
            {task.deliveryVersion ? <DetailItem label="投递版本" value={formatNumber(task.deliveryVersion)} /> : null}
          </div>
        </AdminSection>
      )}

      {task && (
        <AdminSection
          title="任务操作"
          description="重新处理不会再次扣灵点；退灵点类操作会复用已有灵点记录，避免重复补偿。"
        >
          <div className="p-4">
            <AdminTaskActions
              id={task.sourceId}
              sourceType={task.sourceType}
              statusGroup={task.statusGroup}
              isStale={task.isStale}
              canOperate={hasAdminPermission(admin.role, "tasks:operate")}
            />
          </div>
        </AdminSection>
      )}

      {task && (
        <AdminSection title="输入与结果">
          <div className="grid gap-6 p-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-[0.08em] text-[var(--admin-faint)]">输入</p>
              <ThumbnailStrip urls={task.inputThumbnails} />
            </div>
            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-[0.08em] text-[var(--admin-faint)]">结果</p>
              <ThumbnailStrip urls={task.resultThumbnails} />
            </div>
          </div>
        </AdminSection>
      )}

      <AdminSection title="开发信息" description="请求值来自任务入参；响应值包含任务状态、结果、结算信息和已脱敏的供应商路由记录。">
        <div className="grid gap-px bg-[var(--admin-border)] lg:grid-cols-2">
          <DeveloperValue label="请求值" value={detail.payload} />
          <DeveloperValue label="响应值" value={detail.response} />
        </div>
      </AdminSection>

      <AdminSection title="灵点流水">
        <AdminTable<AdminCreditLogItem>
          rows={detail.creditLogs}
          rowKey={(row) => row.id}
          empty="暂无关联灵点流水"
          columns={[
            { key: "amount", label: "变动", render: (row) => <span className={`font-mono text-sm font-black ${row.amount >= 0 ? "text-[var(--admin-success)]" : "text-[var(--admin-danger)]"}`}>{row.amount > 0 ? "+" : ""}{formatNumber(row.amount)}</span> },
            { key: "balance", label: "余额", render: (row) => <span className="font-mono text-sm font-bold text-[var(--admin-fg)]">{formatNumber(row.balance)}</span> },
            { key: "reason", label: "原因", render: (row) => <span className="text-sm font-semibold text-[var(--admin-fg)]">{row.reason}</span> },
            { key: "time", label: "时间", render: (row) => <span className="whitespace-nowrap text-xs font-semibold text-[var(--admin-muted)]">{formatDateTime(row.createdAt)}</span> },
          ]}
        />
      </AdminSection>

      <AdminSection title="审计记录">
        <AdminTable<AdminAuditLog>
          rows={detail.auditLogs}
          rowKey={(row) => row.id}
          empty="暂无关联审计记录"
          columns={[
            { key: "action", label: "动作", render: (row) => <span className="font-mono text-sm font-black text-[var(--admin-fg)]">{row.action}</span> },
            { key: "actor", label: "操作者", render: (row) => <span className="text-sm font-semibold text-[var(--admin-fg)]">{row.actorEmail || "-"}</span> },
            { key: "reason", label: "原因", render: (row) => <span className="text-sm font-semibold text-[var(--admin-fg)]">{row.reason || "-"}</span> },
            { key: "time", label: "时间", render: (row) => <span className="whitespace-nowrap text-xs font-semibold text-[var(--admin-muted)]">{formatDateTime(row.createdAt)}</span> },
          ]}
        />
      </AdminSection>
    </div>
  );
}

function formatQueueReason(reason: string) {
  if (reason === "provider_capacity") return "等待模型供应商容量";
  if (reason === "retryable_error") return "等待生成服务恢复";
  if (reason === "admin_retry") return "管理员已重新投递";
  return reason;
}

function DeveloperValue({ label, value }: { label: string; value: Record<string, unknown> }) {
  return (
    <div className="min-w-0 bg-[var(--admin-surface)]">
      <div className="border-b border-[var(--admin-border)] px-4 py-2 text-xs font-black text-[var(--admin-fg)]">{label}</div>
      <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words p-4 text-xs leading-5 text-[var(--admin-fg)]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

type DiagnosticLine = {
  label: string;
  value: string;
};

type PromptDiagnostic = DiagnosticLine & {
  meta: string;
  original: string;
  isFinal: boolean;
};

function buildTaskDiagnostics(detail: AdminTaskDetail) {
  const payload = detail.payload;
  const promptTrace = arrayOfRecords(payload.promptTrace);
  const prompts: PromptDiagnostic[] = promptTrace.map((item, index) => {
    const finalPrompt = pickString(item, FINAL_PROMPT_KEYS);
    const originalPrompt = pickString(item, ORIGINAL_PROMPT_KEYS);
    const promptKind = pickString(item, ["promptKind", "prompt_kind"]) || `prompt ${index + 1}`;
    const model = pickString(item, ["model", "aiModel", "ai_model"]) || "-";
    const isFinal = Boolean(finalPrompt);
    return {
      label: `${index + 1}. ${isFinal ? "最终执行" : "请求提示"}：${promptKind}`,
      meta: `model: ${model} · source: ${isFinal ? "compiledPrompt/finalPrompt" : "prompt/userPrompt fallback"}`,
      value: finalPrompt || originalPrompt || JSON.stringify(item, null, 2),
      original: originalPrompt,
      isFinal,
    };
  });

  if (!prompts.length) {
    const fallbackFinalPrompt = pickString(payload, FINAL_PROMPT_KEYS);
    const fallbackOriginalPrompt = pickString(payload, ORIGINAL_PROMPT_KEYS);
    const fallbackPrompt = fallbackFinalPrompt || fallbackOriginalPrompt;
    if (fallbackPrompt) {
      prompts.push({
        label: fallbackFinalPrompt ? "payload 最终执行提示词" : "payload 请求提示词",
        meta: `model: ${pickString(payload, ["aiModel", "ai_model", "model"]) || "-"} · source: ${fallbackFinalPrompt ? "compiledPrompt/finalPrompt" : "prompt/userPrompt fallback"}`,
        value: fallbackPrompt,
        original: fallbackOriginalPrompt,
        isFinal: Boolean(fallbackFinalPrompt),
      });
    }
  }

  const errors = uniqueDiagnosticLines([
    detail.errorMessage ? { label: "任务错误", value: detail.errorMessage } : null,
    ...collectStringMatches(payload, ERROR_KEYS, "payload"),
  ]);

  const asyncTask = isRecord(payload.asyncTask) ? payload.asyncTask : {};
  const providerInfo = [
    diagnosticFromRecord(asyncTask, "Provider Task ID", ["taskId", "task_id"]),
    diagnosticFromRecord(asyncTask, "Provider Request ID", ["requestId", "request_id"]),
    diagnosticFromRecord(asyncTask, "Provider 状态", ["status", "providerStatus", "provider_status"]),
    diagnosticFromRecord(payload, "模型", ["aiModel", "ai_model", "model"]),
    diagnosticFromRecord(payload, "模块", ["kind", "module"]),
  ].filter((item): item is DiagnosticLine => Boolean(item));

  const resultMeta = [
    isRecord(asyncTask.providerDetails)
      ? { label: "providerDetails", value: JSON.stringify(asyncTask.providerDetails, null, 2) }
      : null,
    ...collectStringMatches(payload, RESPONSE_KEYS, "payload"),
  ].filter((item): item is DiagnosticLine => Boolean(item));

  return {
    prompts: prompts.filter((item) => item.value.trim()).slice(0, 12),
    errors: errors.slice(0, 12),
    resultUrls: detail.resultUrls,
    providerInfo,
    resultMeta: uniqueDiagnosticLines(resultMeta).slice(0, 8),
  };
}

function DiagnosticPanel({ title, tone = "neutral", children }: { title: string; tone?: "neutral" | "danger"; children: ReactNode }) {
  return (
    <div className={`rounded-lg border ${tone === "danger" ? "border-[var(--admin-danger-border)] bg-[var(--admin-danger-soft)]/70" : "border-[var(--admin-border)] bg-[var(--admin-surface-soft)]/70"}`}>
      <div className={`border-b px-3 py-2 ${tone === "danger" ? "border-[var(--admin-danger-border)]" : "border-[var(--admin-border)]"}`}>
        <h3 className={`text-sm font-black ${tone === "danger" ? "text-red-800" : "text-[var(--admin-fg)]"}`}>{title}</h3>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function ReadableBlock({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "danger" }) {
  return (
    <div className={`rounded-lg border bg-[var(--admin-surface)] ${tone === "danger" ? "border-[var(--admin-danger-border)]" : "border-[var(--admin-border)]"}`}>
      <div className={`border-b px-3 py-2 text-xs font-black ${tone === "danger" ? "border-red-100 text-[var(--admin-danger)]" : "border-[var(--admin-border)] text-[var(--admin-fg)]"}`}>{label}</div>
      <pre className={`max-h-[260px] overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-5 ${tone === "danger" ? "text-red-800" : "text-[var(--admin-fg)]"}`}>{value}</pre>
    </div>
  );
}

function ResultUrlList({ urls }: { urls: string[] }) {
  if (!urls.length) return <p className="text-sm font-semibold text-[var(--admin-muted)]">暂无返回图片 URL。</p>;
  return (
    <div className="space-y-2">
      {urls.map((url, index) => (
        <div key={`${url}-${index}`} className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2">
          <div className="mb-1 text-xs font-black text-[var(--admin-muted)]">结果 {index + 1}</div>
          <a href={url} target="_blank" rel="noreferrer" className="break-all font-mono text-xs font-semibold text-[var(--admin-info)] hover:underline">
            {url}
          </a>
        </div>
      ))}
    </div>
  );
}

function DetailItem({ label, value, mono = false, href }: { label: string; value: string; mono?: boolean; href?: string }) {
  const content = href ? (
    <Link href={href} className="hover:underline">{value}</Link>
  ) : value;
  return (
    <div>
      <dt className="text-xs font-black uppercase tracking-[0.08em] text-[var(--admin-faint)]">{label}</dt>
      <dd className={`mt-1 break-all text-sm font-bold text-[var(--admin-fg)] ${mono ? "font-mono" : ""}`}>{content}</dd>
    </div>
  );
}

const FINAL_PROMPT_KEYS = [
  "compiledPrompt",
  "compiled_prompt",
  "finalPrompt",
  "final_prompt",
];

const ORIGINAL_PROMPT_KEYS = [
  "prompt",
  "userPrompt",
  "user_prompt",
  "promptText",
  "prompt_text",
];

const ERROR_KEYS = new Set([
  "error",
  "errorMessage",
  "error_message",
  "lastError",
  "last_error",
  "failReason",
  "fail_reason",
  "message",
]);

const RESPONSE_KEYS = new Set([
  "rawResponse",
  "raw_response",
  "response",
  "providerResponse",
  "provider_response",
  "output",
  "result",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function pickString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return "";
}

function diagnosticFromRecord(record: Record<string, unknown>, label: string, keys: string[]) {
  const value = pickString(record, keys);
  return value ? { label, value } : null;
}

function collectStringMatches(value: unknown, keys: Set<string>, prefix: string, depth = 0): DiagnosticLine[] {
  if (depth > 4) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectStringMatches(item, keys, `${prefix}.${index}`, depth + 1));
  }
  if (!isRecord(value)) return [];
  const lines: DiagnosticLine[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (keys.has(key)) {
      const text = stringifyDiagnosticValue(item);
      if (text) lines.push({ label: `${prefix}.${key}`, value: text });
      continue;
    }
    if (isRecord(item) || Array.isArray(item)) {
      lines.push(...collectStringMatches(item, keys, `${prefix}.${key}`, depth + 1));
    }
  }
  return lines;
}

function stringifyDiagnosticValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isRecord(value) || Array.isArray(value)) return JSON.stringify(value, null, 2);
  return "";
}

function uniqueDiagnosticLines(lines: Array<DiagnosticLine | null>) {
  const seen = new Set<string>();
  const unique: DiagnosticLine[] = [];
  for (const line of lines) {
    if (!line?.value.trim()) continue;
    const key = `${line.label}:${line.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(line);
  }
  return unique;
}
