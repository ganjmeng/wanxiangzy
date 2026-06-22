"use client";

import { Clock3, ImageIcon, Loader2 } from "lucide-react";
import { getImageVariantUrl } from "@/lib/image-variants";
import { StudioHomeHeroLoadingBackdrop } from "@/components/studio/StudioHomeHeroLoadingBackdrop";

export type StudioLoaderReferenceImage = {
  url?: string | null;
  label: string;
};

export type StudioGenerationLoaderProps = {
  count: number;
  progress: number;
  moduleName?: string;
  statusText?: string;
  aspectRatio?: string;
  referenceImages?: StudioLoaderReferenceImage[];
  estimatedTime?: string;
  metaItems?: string[];
};

function getProgressLabel(progress: number): string {
  if (progress < 15) return "准备素材关系...";
  if (progress < 50) return "渲染服装视觉...";
  if (progress < 90) return "整理生成结果...";
  return "即将完成...";
}

export function StudioGenerationLoader({
  count,
  progress,
  moduleName = "图像生成",
  statusText,
  aspectRatio = "3/4",
  referenceImages = [],
  estimatedTime = "预计 1-2 分钟",
  metaItems = [],
}: StudioGenerationLoaderProps) {
  const safeCount = Math.max(1, Math.min(count, 4));
  const displayProgress = Math.round(Math.max(0, Math.min(progress, 100)));
  const gridClass = safeCount > 1 ? "grid-cols-2 max-w-[460px]" : "grid-cols-1 max-w-[330px]";
  const label = statusText || getProgressLabel(displayProgress);
  const visibleRefs = referenceImages.filter((item) => item.url).slice(0, 4);
  const mergedMeta = [estimatedTime, `${safeCount} 张结果`, ...metaItems].filter(Boolean);

  return (
    <div className="studio-loading-stage flex min-h-[280px] items-center justify-center p-5 sm:min-h-[380px] sm:p-8 lg:h-full">
      <div className="w-full max-w-5xl">
        <div className="mx-auto mb-5 flex max-w-[720px] flex-col gap-3 rounded-[24px] border border-white/62 bg-white/58 p-3 shadow-[0_18px_54px_rgba(14,18,38,0.12)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-black tracking-[-0.01em] text-codex-ink">{moduleName}生成中</p>
            <p className="mt-1 text-xs font-semibold text-codex-muted">{label}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {mergedMeta.map((item) => (
              <span key={item} className="inline-flex items-center gap-1 rounded-full border border-white/72 bg-white/76 px-2.5 py-1 text-[11px] font-bold text-codex-muted">
                {item === estimatedTime && <Clock3 className="h-3 w-3 text-[var(--codex-accent)]" />}
                {item}
              </span>
            ))}
          </div>
        </div>

        {visibleRefs.length > 0 && (
          <div className="mx-auto mb-5 flex max-w-[720px] flex-wrap justify-center gap-2">
            {visibleRefs.map((item) => (
              <span key={`${item.label}-${item.url}`} className="flex h-16 min-w-[132px] items-center gap-2 rounded-2xl border border-white/68 bg-white/62 p-2 shadow-sm backdrop-blur">
                <span className="flex h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white">
                  <img src={getImageVariantUrl(item.url || "", "thumb")} alt="" className="h-full w-full object-cover" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-black text-codex-ink">{item.label}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-codex-faint">
                    <ImageIcon className="h-3 w-3" />
                    参考图
                  </span>
                </span>
              </span>
            ))}
          </div>
        )}

        <div className={`mx-auto grid ${gridClass} gap-3 sm:gap-4`}>
          {Array.from({ length: safeCount }).map((_, index) => (
            <div key={index} className="gen-card relative overflow-hidden rounded-[28px]" style={{ aspectRatio }}>
              <StudioHomeHeroLoadingBackdrop />
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2">
                <div className="relative flex h-14 w-14 items-center justify-center">
                  <div className="gen-ring absolute inset-0 rounded-full bg-white/20" />
                  <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-white/16 bg-white/10 shadow-lg backdrop-blur-md">
                    <Loader2 className="h-6 w-6 animate-spin text-white" />
                  </div>
                </div>
                <span className="text-2xl font-black tabular-nums text-white">{displayProgress}%</span>
                <p className="text-xs font-semibold text-white/58">{safeCount > 1 ? `第 ${index + 1} 张生成中` : label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className={`mx-auto mt-4 flex items-center gap-3 px-1 ${safeCount > 1 ? "max-w-[460px]" : "max-w-[330px]"}`}>
          <span className="shrink-0 text-[11px] font-bold text-codex-muted">{moduleName}</span>
          <div className="studio-loader-progress h-1.5 flex-1 overflow-hidden rounded-full bg-white/45">
            <div
              className="h-full rounded-full bg-zinc-900 transition-all duration-700"
              style={{ width: `${Math.max(displayProgress, 5)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
