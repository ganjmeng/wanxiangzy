"use client";

import { X } from "lucide-react";
import { RepairPromptPanel } from "@/components/RepairPromptPanel";
import type { RepairKind } from "@/lib/generation-repair";

type ErrorStageProps = {
  error: string;
  onRetry: () => void;
  onRepair: (repairValue: string) => void;
  isGenerating: boolean;
  retryDisabled?: boolean;
  retryLabel?: string;
  repairKind: RepairKind;
};

export function ErrorStage({
  error,
  onRetry,
  onRepair,
  isGenerating,
  retryDisabled = false,
  retryLabel = "重试",
  repairKind,
}: ErrorStageProps) {
  return (
    <div className="studio-result-stage min-h-[260px] sm:min-h-[360px] lg:h-full flex items-center justify-center animate-fade-in px-4">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <X className="h-8 w-8 text-red-500" />
        </div>
        <p className="mb-1 font-semibold text-red-600">生成失败</p>
        <p className="mx-auto mb-4 max-w-sm text-sm text-codex-muted">{error}</p>
        <RepairPromptPanel kind={repairKind} onRepair={onRepair} disabled={isGenerating} className="mb-3 max-w-md mx-auto" />
        <button
          type="button"
          onClick={onRetry}
          disabled={retryDisabled}
          className="mac-button px-5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-55"
        >
          {retryLabel}
        </button>
      </div>
    </div>
  );
}
