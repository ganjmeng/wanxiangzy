import type { ChangeEvent, ComponentType, ReactNode, TextareaHTMLAttributes } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type StudioChoiceOption<T extends string = string> = {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
};

export function StudioOptionGrid<T extends string>({
  options,
  value,
  onChange,
  columns = "auto",
  ariaLabel,
  className,
}: {
  options: readonly StudioChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  columns?: 2 | 3 | 4 | "auto";
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "studio-option-grid",
        columns !== "auto" && `studio-option-grid-${columns}`,
        className
      )}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn("studio-option-control", selected && "studio-option-control-selected")}
          >
            <span className="min-w-0">
              <span className="block truncate">{option.label}</span>
              {option.description && (
                <span className="mt-0.5 block truncate text-[10px] font-semibold opacity-65">
                  {option.description}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export type StudioModelOption<T extends string = string> = {
  value: T;
  label: string;
  desc: string;
  icon?: string;
  badge?: string;
  disabled?: boolean;
};

export function StudioModelSelector<T extends string>({
  models,
  value,
  onChange,
  getMeta,
  columns = 2,
  ariaLabel = "Generation model",
}: {
  models: readonly StudioModelOption<T>[];
  value: T;
  onChange: (value: T) => void;
  getMeta?: (model: StudioModelOption<T>) => ReactNode;
  columns?: 1 | 2;
  ariaLabel?: string;
}) {
  return (
    <div className={cn("studio-model-selector", columns === 1 && "studio-model-selector-1")} role="radiogroup" aria-label={ariaLabel}>
      {models.map((model) => {
        const selected = value === model.value;
        return (
          <button
            key={model.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={model.disabled}
            onClick={() => onChange(model.value)}
            className={cn("studio-model-option", selected && "studio-model-option-selected")}
          >
            <span className="studio-model-option-icon">
              {model.icon ? <img src={model.icon} alt="" /> : <ImageIcon className="h-4 w-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="studio-model-option-title">
                <span className="truncate">{model.label}</span>
                {model.badge && <span className="studio-model-option-badge">{model.badge}</span>}
              </span>
              <span className="studio-model-option-desc">{getMeta?.(model) ?? model.desc}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function StudioGenerationCountSelector({
  value,
  onChange,
  counts = [1, 2, 3, 4],
  unit = "张",
  ariaLabel = "生成数量",
}: {
  value: number;
  onChange: (value: number) => void;
  counts?: readonly number[];
  unit?: string;
  ariaLabel?: string;
}) {
  const columnCount: 2 | 3 | 4 | "auto" = counts.length === 4 ? 4 : counts.length === 3 ? 3 : counts.length === 2 ? 2 : "auto";

  return (
    <StudioOptionGrid
      options={counts.map((count) => ({
        value: String(count),
        label: `${count} ${unit}`,
      }))}
      value={String(value)}
      onChange={(nextValue) => onChange(Number(nextValue))}
      columns={columnCount}
      ariaLabel={ariaLabel}
    />
  );
}

export function StudioToggleRow({
  title,
  description,
  checked,
  onChange,
  meta,
  disabled,
  ariaLabel,
}: {
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  meta?: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-center justify-between gap-4 rounded-xl bg-slate-50/90 p-4 text-left transition",
        "hover:bg-slate-100/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/20 focus-visible:ring-offset-2",
        disabled && "cursor-not-allowed opacity-60 hover:bg-slate-50/90"
      )}
    >
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-black text-codex-ink">{title}</span>
          {meta && <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-codex-faint shadow-sm">{meta}</span>}
        </span>
        {description && <span className="mt-1 block text-[11px] font-semibold leading-5 text-codex-faint">{description}</span>}
      </span>
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-[var(--codex-accent)]" : "bg-slate-300"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          )}
        />
      </span>
    </button>
  );
}

export function StudioHiddenFileInput({
  inputRef,
  multiple,
  accept = "image/*",
  onFiles,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  multiple?: boolean;
  accept?: string;
  onFiles: (files: File[]) => void | Promise<void>;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      multiple={multiple}
      className="hidden"
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        const input = event.currentTarget;
        void Promise.resolve(onFiles(Array.from(input.files || []))).finally(() => {
          input.value = "";
        });
      }}
    />
  );
}

export type StudioPresetImage = {
  id: string;
  src: string;
  label?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
};

export function StudioPromptTextarea({
  title,
  badge,
  description,
  action,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  title?: ReactNode;
  badge?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="studio-prompt-control">
      {(title || badge) && (
        <div className="mb-3 flex min-w-0 items-center gap-2">
          {title && <h3 className="text-sm font-black text-codex-ink">{title}</h3>}
          {badge && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-codex-muted">{badge}</span>}
        </div>
      )}
      <div className="studio-prompt-field">
        <textarea
          {...props}
          className={cn("studio-prompt-textarea", action && "studio-prompt-textarea-with-action", className)}
        />
        {action ? <div className="studio-prompt-inline-action">{action}</div> : null}
      </div>
      {description && <p className="mt-2 text-[11px] leading-relaxed text-codex-faint">{description}</p>}
    </section>
  );
}
