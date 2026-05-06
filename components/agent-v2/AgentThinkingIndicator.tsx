"use client";

import type { FC } from "react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const DEFAULT_THINKING_STAGES = [
  "正在思考",
  "正在理解意图",
  "正在分析上下文",
  "正在选择处理方式",
  "正在整理回复",
];

function useThinkingLabel(label: string | undefined, fallback: string) {
  const [index, setIndex] = useState(0);
  const stages = label ? [label] : DEFAULT_THINKING_STAGES;

  useEffect(() => {
    if (label || stages.length <= 1) return;
    const timer = window.setInterval(() => {
      setIndex((value) => (value + 1) % stages.length);
    }, 1600);
    return () => window.clearInterval(timer);
  }, [label, stages.length]);

  if (label) return label;
  return stages[index] || fallback;
}

export const AgentThinkingOrb: FC<{ className?: string }> = ({ className }) => {
  return (
    <span
      aria-hidden
      className={cn("agent-thinking-orb relative inline-flex size-4 shrink-0", className)}
    >
      <span className="absolute inset-0 rounded-full bg-foreground/10" />
      <span className="agent-thinking-ring absolute inset-0 rounded-full border border-foreground/25" />
      <span className="agent-thinking-core absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground" />
    </span>
  );
};

export const AgentThinkingPill: FC<{
  label?: string;
  className?: string;
}> = ({ label = "正在思考...", className }) => {
  const displayLabel = useThinkingLabel(label === "正在思考..." ? undefined : label, "正在思考...");
  return (
    <div
      className={cn(
        "agent-thinking-pill-v2 inline-flex items-center gap-2 rounded-full border bg-background px-3.5 py-2 text-muted-foreground text-sm shadow-sm",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <AgentThinkingOrb />
      <span key={displayLabel} className="agent-thinking-label-v2 animate-in fade-in slide-in-from-bottom-1 duration-200">
        {displayLabel}
      </span>
    </div>
  );
};

export const AgentThinkingLine: FC<{
  label?: string;
  className?: string;
}> = ({ label = "正在思考", className }) => {
  const displayLabel = useThinkingLabel(label === "正在思考" ? undefined : label, "正在思考");
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 text-sm font-medium text-foreground",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <AgentThinkingOrb />
      <span key={displayLabel} className="agent-thinking-label-v2 animate-in fade-in slide-in-from-bottom-1 duration-200">
        {displayLabel}
      </span>
    </div>
  );
};
