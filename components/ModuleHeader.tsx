"use client";

import { useRef, useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { ClientPortal } from "@/components/ClientPortal";

type ModuleHeaderProps = {
  title: string;
  tooltip: string;
  actions?: ReactNode;
};

export function ModuleHeader({ title, tooltip, actions }: ModuleHeaderProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<{ top: number; left: number } | null>(null);

  const showTooltip = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 288;
    const left = Math.max(12, Math.min(rect.left - 24, window.innerWidth - width - 12));
    const top = Math.min(rect.bottom + 8, window.innerHeight - 96);
    setTooltipStyle({ top, left });
  };

  return (
    <div className="studio-module-heading">
      <div className="studio-module-heading-main">
        <h1 className="studio-module-heading-title">{title}</h1>
        <button
          ref={buttonRef}
          type="button"
          aria-label={`${title}说明`}
          onMouseEnter={showTooltip}
          onMouseLeave={() => setTooltipStyle(null)}
          onFocus={showTooltip}
          onBlur={() => setTooltipStyle(null)}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--codex-glass-fill)] text-[var(--codex-faint)] shadow-sm transition-colors hover:bg-[var(--codex-glass-fill-strong)] hover:text-[var(--codex-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--codex-accent)]/30"
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
        {tooltipStyle && (
          <ClientPortal>
            <div
              className="pointer-events-none fixed z-[320] w-72 rounded-2xl border border-[var(--codex-border)] bg-popover/90 px-3.5 py-2.5 text-left text-[13px] font-normal leading-relaxed text-[var(--codex-ink)] shadow-[var(--codex-shadow-apple-lg)] backdrop-blur-xl backdrop-saturate-150 animate-fade-in"
              style={{ top: tooltipStyle.top, left: tooltipStyle.left }}
            >
            {tooltip}
            </div>
          </ClientPortal>
        )}
      </div>
      {actions ? <div className="studio-module-heading-actions">{actions}</div> : null}
    </div>
  );
}
