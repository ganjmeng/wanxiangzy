"use client";

import {
  AlertCircle,
  Check,
  Clock3,
  ImageIcon,
  ImagePlus,
  Layers2,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType, type DragEvent } from "react";
import { cn } from "@/lib/utils";

export type CanvasAssistantMode = "generate" | "reference" | "edit";

export type CanvasAssistantAttachmentStatus = "ready" | "uploading" | "error";

export type CanvasAssistantAttachment = {
  id: string;
  name?: string;
  url?: string;
  previewUrl?: string;
  status?: CanvasAssistantAttachmentStatus;
  error?: string;
};

export type CanvasAssistantResultStatus = "completed" | "generating" | "failed";

export type CanvasAssistantResult = {
  id: string;
  title?: string;
  prompt?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  status?: CanvasAssistantResultStatus;
  error?: string;
  model?: string;
  quality?: string;
  createdAt?: string;
};

export type CanvasAssistantHistoryItem = {
  id: string;
  title?: string;
  prompt?: string;
  mode?: CanvasAssistantMode;
  imageUrls?: string[];
  status?: "completed" | "running" | "failed";
  createdAt?: string;
};

export type CanvasAssistantOption = {
  value: string;
  label: string;
  description?: string;
};

export type CanvasAssistantPanelProps = {
  className?: string;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onGenerate: () => void;
  mode?: CanvasAssistantMode;
  onModeChange?: (mode: CanvasAssistantMode) => void;
  model?: string;
  onModelChange?: (model: string) => void;
  quality?: string;
  onQualityChange?: (quality: string) => void;
  modelOptions?: CanvasAssistantOption[];
  qualityOptions?: CanvasAssistantOption[];
  attachments?: CanvasAssistantAttachment[];
  results?: CanvasAssistantResult[];
  history?: CanvasAssistantHistoryItem[];
  isGenerating?: boolean;
  progress?: number;
  error?: string | null;
  disabled?: boolean;
  maxPromptLength?: number;
  placeholder?: string;
  uploadAccept?: string;
  generateLabel?: string;
  onUploadAttachments?: (files: File[]) => void;
  onRemoveAttachment?: (attachmentId: string) => void;
  onPreviewAttachment?: (attachment: CanvasAssistantAttachment) => void;
  onInsertResult?: (result: CanvasAssistantResult) => void;
  onPreviewResult?: (result: CanvasAssistantResult) => void;
  onRetry?: () => void;
  onSelectHistory?: (item: CanvasAssistantHistoryItem) => void;
};

const MODE_OPTIONS: Array<{
  value: CanvasAssistantMode;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { value: "generate", label: "图片生成", description: "文字出图", icon: Sparkles },
  { value: "reference", label: "参考图", description: "多图对齐", icon: Layers2 },
  { value: "edit", label: "编辑", description: "局部调整", icon: PenLine },
];

const DEFAULT_MODEL_OPTIONS: CanvasAssistantOption[] = [
  { value: "gpt-image", label: "GPT Image", description: "通用" },
  { value: "seedream", label: "Seedream", description: "商品" },
  { value: "nano-banana", label: "Nano Banana", description: "轻量" },
];

const DEFAULT_QUALITY_OPTIONS: CanvasAssistantOption[] = [
  { value: "draft", label: "草图", description: "快" },
  { value: "standard", label: "标准", description: "推荐" },
  { value: "high", label: "高清", description: "细节" },
];

const STATUS_TEXT: Record<NonNullable<CanvasAssistantHistoryItem["status"]>, string> = {
  completed: "完成",
  running: "生成中",
  failed: "失败",
};

export function CanvasAssistantPanel({
  className,
  prompt,
  onPromptChange,
  onGenerate,
  mode = "generate",
  onModeChange,
  model = DEFAULT_MODEL_OPTIONS[0].value,
  onModelChange,
  quality = DEFAULT_QUALITY_OPTIONS[1].value,
  onQualityChange,
  modelOptions = DEFAULT_MODEL_OPTIONS,
  qualityOptions = DEFAULT_QUALITY_OPTIONS,
  attachments = [],
  results = [],
  history = [],
  isGenerating = false,
  progress,
  error,
  disabled = false,
  maxPromptLength = 800,
  placeholder = "描述你想生成或编辑的画面...",
  uploadAccept = "image/*",
  generateLabel = "生成",
  onUploadAttachments,
  onRemoveAttachment,
  onPreviewAttachment,
  onInsertResult,
  onPreviewResult,
  onRetry,
  onSelectHistory,
}: CanvasAssistantPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [dragging, setDragging] = useState(false);

  const hasPrompt = prompt.trim().length > 0;
  const hasReadyAttachment = attachments.some((item) => (item.status ?? "ready") === "ready");
  const hasAttachmentError = attachments.some((item) => item.status === "error");
  const overLimit = prompt.length > maxPromptLength;
  const canGenerate = !disabled && !isGenerating && !overLimit && !hasAttachmentError && (hasPrompt || hasReadyAttachment);
  const currentModel = useMemo(
    () => modelOptions.find((option) => option.value === model) ?? modelOptions[0],
    [model, modelOptions],
  );
  const currentQuality = useMemo(
    () => qualityOptions.find((option) => option.value === quality) ?? qualityOptions[0],
    [quality, qualityOptions],
  );
  const hasActivity = history.length > 0 || results.length > 0 || isGenerating || Boolean(error);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [prompt]);

  const handleFiles = (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length > 0) onUploadAttachments?.(imageFiles);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled || !onUploadAttachments) return;
    handleFiles(event.dataTransfer.files);
  };

  const handleGenerate = () => {
    if (canGenerate) onGenerate();
  };

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-slate-200/80 bg-white/92 text-slate-900 shadow-[-18px_0_44px_rgba(15,23,42,0.05)] backdrop-blur-xl lg:w-[392px]",
        className,
      )}
      aria-label="AI 工作流面板"
    >
      <header className="shrink-0 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black leading-5 text-slate-950">AI 工作流</p>
            <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-400">
              {currentModel?.label ?? model} · {currentQuality?.label ?? quality}
            </p>
          </div>
          <StatusPill isGenerating={isGenerating} hasError={Boolean(error)} />
        </div>
      </header>

      <div className="custom-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!hasActivity && <PanelEmptyState />}

        {history.length > 0 && (
          <section className="mb-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <h3 className="text-[11px] font-black uppercase text-slate-400">历史</h3>
              <span className="text-[11px] font-semibold text-slate-300">{history.length}</span>
            </div>
            <div className="space-y-2">
              {history.map((item) => (
                <HistoryRow key={item.id} item={item} onSelect={onSelectHistory} />
              ))}
            </div>
          </section>
        )}

        {error && (
          <ErrorNotice message={error} disabled={disabled || isGenerating} onRetry={onRetry} />
        )}

        {isGenerating && <GeneratingCard mode={mode} modelLabel={currentModel?.label ?? model} progress={progress} />}

        {results.length > 0 && (
          <section className="space-y-2">
            <div className="mb-2 flex items-center justify-between px-1">
              <h3 className="text-[11px] font-black uppercase text-slate-400">结果</h3>
              <span className="text-[11px] font-semibold text-slate-300">{results.length}</span>
            </div>
            {results.map((result) => (
              <ResultCard
                key={result.id}
                result={result}
                onInsert={onInsertResult}
                onPreview={onPreviewResult}
                disabled={disabled || isGenerating}
              />
            ))}
          </section>
        )}
      </div>

      <div
        className={cn(
          "shrink-0 border-t border-slate-100 bg-gradient-to-b from-white to-slate-50/90 px-3 pb-3 pt-2",
          dragging && "bg-violet-50/70",
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled && onUploadAttachments) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragging(false);
        }}
        onDrop={handleDrop}
      >
        {dragging && (
          <div className="mb-2 flex h-11 items-center justify-center rounded-xl border border-dashed border-violet-300 bg-white/80 text-xs font-black text-violet-600">
            松开以上传图片
          </div>
        )}

        <ModeSelector value={mode} disabled={disabled || isGenerating || !onModeChange} onChange={onModeChange} />

        <div className="mt-2 grid grid-cols-2 gap-2">
          <OptionChips
            label="模型"
            value={model}
            options={modelOptions}
            disabled={disabled || isGenerating || !onModelChange}
            onChange={onModelChange}
          />
          <OptionChips
            label="质量"
            value={quality}
            options={qualityOptions}
            disabled={disabled || isGenerating || !onQualityChange}
            onChange={onQualityChange}
          />
        </div>

        {attachments.length > 0 && (
          <AttachmentStrip
            attachments={attachments}
            disabled={disabled || isGenerating}
            onPreview={onPreviewAttachment}
            onRemove={onRemoveAttachment}
          />
        )}

        <div className="mt-2 rounded-2xl border border-slate-200/80 bg-white shadow-[0_10px_28px_rgba(15,23,42,0.05)] focus-within:border-violet-300 focus-within:shadow-[0_16px_36px_rgba(124,58,237,0.1)]">
          <input
            ref={inputRef}
            type="file"
            accept={uploadAccept}
            multiple
            className="hidden"
            onChange={(event) => {
              handleFiles(event.target.files ?? []);
              event.target.value = "";
            }}
          />
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleGenerate();
              }
            }}
            placeholder={placeholder}
            disabled={disabled || isGenerating}
            rows={3}
            className="custom-scroll block max-h-[132px] min-h-[86px] w-full resize-none bg-transparent px-3 pt-3 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="AI prompt"
          />
          <div className="flex items-center gap-2 border-t border-slate-100 px-2 py-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={disabled || isGenerating || !onUploadAttachments}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-violet-50 hover:text-violet-600 disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="上传附件"
              title="上传附件"
            >
              <ImagePlus className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "truncate text-[11px] font-semibold text-slate-400",
                  overLimit && "text-rose-500",
                  hasAttachmentError && "text-amber-600",
                )}
              >
                {hasAttachmentError ? "先处理失败附件" : `${prompt.length}/${maxPromptLength}`}
              </p>
            </div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className={cn(
                "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-xs font-black transition-all",
                canGenerate
                  ? "bg-slate-950 text-white shadow-lg shadow-slate-900/15 hover:bg-slate-800"
                  : "bg-slate-100 text-slate-300",
              )}
              aria-label={isGenerating ? "生成中" : generateLabel}
              title={canGenerate ? generateLabel : "输入提示词或上传图片"}
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              <span>{isGenerating ? "生成中" : generateLabel}</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function StatusPill({ isGenerating, hasError }: { isGenerating: boolean; hasError: boolean }) {
  if (isGenerating) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-black text-violet-600">
        <Loader2 className="h-3 w-3 animate-spin" />
        运行中
      </span>
    );
  }

  if (hasError) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-black text-rose-600">
        <AlertCircle className="h-3 w-3" />
        需处理
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-600">
      <Check className="h-3 w-3" />
      就绪
    </span>
  );
}

function PanelEmptyState() {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-6 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-violet-500 shadow-sm">
        <Wand2 className="h-5 w-5" />
      </div>
      <p className="text-sm font-black text-slate-800">暂无工作流</p>
      <p className="mt-1 max-w-[220px] text-xs leading-5 text-slate-400">输入指令或上传参考图开始。</p>
    </div>
  );
}

function ModeSelector({
  value,
  disabled,
  onChange,
}: {
  value: CanvasAssistantMode;
  disabled?: boolean;
  onChange?: (value: CanvasAssistantMode) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1" role="radiogroup" aria-label="选择生成模式">
      {MODE_OPTIONS.map((option) => {
        const Icon = option.icon;
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange?.(option.value)}
            className={cn(
              "flex min-h-[54px] min-w-0 flex-col items-center justify-center rounded-xl px-2 text-center transition-all",
              selected ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:bg-white/70 hover:text-slate-900",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <Icon className="mb-1 h-4 w-4" />
            <span className="block truncate text-xs font-black">{option.label}</span>
            <span className="block truncate text-[10px] font-semibold opacity-70">{option.description}</span>
          </button>
        );
      })}
    </div>
  );
}

function OptionChips({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: CanvasAssistantOption[];
  disabled?: boolean;
  onChange?: (value: string) => void;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase text-slate-400">{label}</span>
      </div>
      <div className="flex min-w-0 gap-1 overflow-x-auto pb-0.5 studio-scrollbar-hide">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange?.(option.value)}
              disabled={disabled}
              className={cn(
                "inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-black transition-colors",
                selected
                  ? "border-violet-200 bg-violet-50 text-violet-700"
                  : "border-slate-200 bg-white text-slate-500 hover:border-violet-200 hover:text-slate-800",
                disabled && "cursor-not-allowed opacity-60",
              )}
              title={option.description}
            >
              <span>{option.label}</span>
              {selected && <Check className="h-3 w-3" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AttachmentStrip({
  attachments,
  disabled,
  onPreview,
  onRemove,
}: {
  attachments: CanvasAssistantAttachment[];
  disabled?: boolean;
  onPreview?: (attachment: CanvasAssistantAttachment) => void;
  onRemove?: (attachmentId: string) => void;
}) {
  return (
    <div className="mt-2 rounded-2xl border border-violet-100 bg-violet-50/35 p-2">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <span className="text-[11px] font-black text-slate-600">附件</span>
        <span className="text-[11px] font-semibold text-violet-500">{attachments.length}</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 studio-scrollbar-hide">
        {attachments.map((attachment) => {
          const status = attachment.status ?? "ready";
          const imageUrl = attachment.previewUrl ?? attachment.url;
          return (
            <div key={attachment.id} className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-white bg-white shadow-sm">
              <button
                type="button"
                onClick={() => onPreview?.(attachment)}
                disabled={disabled || !imageUrl || !onPreview}
                className="flex h-full w-full items-center justify-center bg-slate-50 disabled:cursor-default"
                aria-label={`预览 ${attachment.name ?? "附件"}`}
                title={attachment.name}
              >
                {imageUrl ? (
                  <img src={imageUrl} alt={attachment.name ?? "附件"} className="h-full w-full object-cover" />
                ) : (
                  <ImageIcon className="h-5 w-5 text-slate-300" />
                )}
                {status === "uploading" && (
                  <span className="absolute inset-0 flex items-center justify-center bg-slate-950/45">
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                  </span>
                )}
                {status === "error" && (
                  <span className="absolute inset-0 flex items-center justify-center bg-rose-950/60">
                    <AlertCircle className="h-4 w-4 text-white" />
                  </span>
                )}
              </button>
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(attachment.id)}
                  disabled={disabled}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white/95 text-slate-400 opacity-0 shadow-sm transition-all hover:text-rose-500 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={`移除 ${attachment.name ?? "附件"}`}
                  title="移除"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              <span
                className={cn(
                  "absolute bottom-1 left-1 rounded-full px-1.5 py-0.5 text-[9px] font-black text-white shadow-sm",
                  status === "ready" && "bg-slate-900/80",
                  status === "uploading" && "bg-violet-600",
                  status === "error" && "bg-rose-600",
                )}
              >
                {status === "ready" ? "参考" : status === "uploading" ? "上传" : "失败"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistoryRow({
  item,
  onSelect,
}: {
  item: CanvasAssistantHistoryItem;
  onSelect?: (item: CanvasAssistantHistoryItem) => void;
}) {
  const status = item.status ?? "completed";
  const firstImage = item.imageUrls?.[0];
  return (
    <button
      type="button"
      onClick={() => onSelect?.(item)}
      disabled={!onSelect}
      className="flex w-full min-w-0 items-center gap-3 rounded-2xl border border-slate-200/70 bg-white p-2 text-left shadow-sm transition-all hover:border-violet-200 hover:shadow-md disabled:cursor-default"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-slate-300">
        {firstImage ? <img src={firstImage} alt="" className="h-full w-full object-cover" /> : <Clock3 className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-black text-slate-800">{item.title ?? item.prompt ?? "未命名工作流"}</span>
        <span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-400">
          {item.createdAt ?? MODE_OPTIONS.find((option) => option.value === item.mode)?.label ?? "AI 工作流"}
        </span>
      </span>
      <span
        className={cn(
          "rounded-full px-2 py-1 text-[10px] font-black",
          status === "completed" && "bg-emerald-50 text-emerald-600",
          status === "running" && "bg-violet-50 text-violet-600",
          status === "failed" && "bg-rose-50 text-rose-600",
        )}
      >
        {STATUS_TEXT[status]}
      </span>
    </button>
  );
}

function ErrorNotice({
  message,
  disabled,
  onRetry,
}: {
  message?: string | null;
  disabled?: boolean;
  onRetry?: () => void;
}) {
  if (!message && !onRetry) return null;

  return (
    <div className="mb-3 rounded-2xl border border-rose-100 bg-rose-50/80 p-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black text-rose-700">生成失败</p>
          {message && <p className="mt-1 line-clamp-2 text-xs leading-5 text-rose-600">{message}</p>}
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={disabled}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-white px-2.5 text-[11px] font-black text-rose-600 shadow-sm transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重试
          </button>
        )}
      </div>
    </div>
  );
}

function GeneratingCard({ mode, modelLabel, progress }: { mode: CanvasAssistantMode; modelLabel: string; progress?: number }) {
  const normalizedProgress = Number.isFinite(progress) ? Math.min(Math.max(Math.round(progress ?? 0), 0), 100) : null;
  return (
    <div className="mb-3 overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm">
      <div className="aspect-[4/3] animate-pulse bg-gradient-to-br from-violet-50 via-slate-50 to-sky-50" />
      <div className="p-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-black text-slate-800">正在生成</p>
            <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-400">
              {MODE_OPTIONS.find((option) => option.value === mode)?.label} · {modelLabel}
            </p>
          </div>
        </div>
        {normalizedProgress !== null && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${normalizedProgress}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

function ResultCard({
  result,
  disabled,
  onInsert,
  onPreview,
}: {
  result: CanvasAssistantResult;
  disabled?: boolean;
  onInsert?: (result: CanvasAssistantResult) => void;
  onPreview?: (result: CanvasAssistantResult) => void;
}) {
  const status = result.status ?? "completed";
  const imageUrl = result.thumbnailUrl ?? result.imageUrl;
  const canInsert = status === "completed" && Boolean(result.imageUrl ?? result.thumbnailUrl) && Boolean(onInsert);

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => onPreview?.(result)}
        disabled={!onPreview || !imageUrl}
        className="relative flex aspect-[4/3] w-full items-center justify-center bg-slate-100 disabled:cursor-default"
        aria-label={`预览 ${result.title ?? "结果"}`}
      >
        {imageUrl ? (
          <img src={imageUrl} alt={result.title ?? "生成结果"} className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="h-7 w-7 text-slate-300" />
        )}
        {status === "generating" && (
          <span className="absolute inset-0 flex items-center justify-center bg-slate-950/35">
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          </span>
        )}
        {status === "failed" && (
          <span className="absolute inset-0 flex flex-col items-center justify-center bg-rose-950/60 px-4 text-center text-xs font-black text-white">
            <AlertCircle className="mb-1 h-5 w-5" />
            {result.error ?? "生成失败"}
          </span>
        )}
      </button>
      <div className="p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black text-slate-900">{result.title ?? "生成结果"}</p>
            <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500">{result.prompt ?? "等待插入画布"}</p>
          </div>
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">
            {status === "completed" ? "完成" : status === "generating" ? "生成中" : "失败"}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-400">
            {[result.model, result.quality, result.createdAt].filter(Boolean).join(" · ") || "AI 结果"}
          </div>
          <button
            type="button"
            onClick={() => onInsert?.(result)}
            disabled={disabled || !canInsert}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-[11px] font-black transition-colors",
              canInsert && !disabled
                ? "bg-slate-950 text-white hover:bg-slate-800"
                : "bg-slate-100 text-slate-300",
            )}
            aria-label="插入画布"
            title="插入画布"
          >
            <Plus className="h-3.5 w-3.5" />
            插入画布
          </button>
        </div>
      </div>
    </article>
  );
}
