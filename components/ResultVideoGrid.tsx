"use client";

import type { CSSProperties } from "react";
import { Download, Loader2, Play, XCircle } from "lucide-react";
import { StudioHomeHeroLoadingBackdrop } from "@/components/studio/StudioHomeHeroLoadingBackdrop";
import { downloadMedia, generateDownloadFilename } from "@/lib/utils";
import type { TaskStatusGroup } from "@/lib/task-queue";

type ResultVideoGridProps = {
  urls: string[];
  filenamePrefix: string;
  onOpen: (url: string, index: number) => void;
  aspectRatio?: string;
  expectedCount?: number;
  isGenerating?: boolean;
  inputThumbnails?: string[];
  createdAt?: string | null;
  statusGroup?: TaskStatusGroup;
  renderKey?: string;
};

export function ResultVideoGrid({
  urls,
  filenamePrefix,
  onOpen,
  aspectRatio,
  expectedCount,
  isGenerating,
  inputThumbnails = [],
  createdAt,
  statusGroup,
  renderKey = "video-result",
}: ResultVideoGridProps) {
  const count = Math.max(urls.length, expectedCount || 0, 1);
  const slots = Array.from({ length: count }, (_, index) => urls[index] || null);
  const completedSlotCount = slots.filter(Boolean).length;
  const running = getVideoGridRunningState(statusGroup, isGenerating, completedSlotCount >= count);
  const gridClassName = getVideoGridClass(count);

  return (
    <div className="studio-result-set w-full max-w-[min(1080px,100%)]">
      <p className="studio-result-disclaimer">
        视频生成可能需要更长时间，完成后可在当前模块、最近任务和作品库中播放。
      </p>
      {createdAt && <p className="studio-result-time">{formatTaskTimestamp(createdAt)}</p>}
      <div className="flex w-full items-start gap-3">
        {inputThumbnails.length > 0 && (
          <div className="studio-result-reference-list">
            {inputThumbnails.slice(0, 4).map((url, index) => (
              <div key={`${url}-${index}`} className="studio-result-reference-thumb">
                {isVideoUrl(url) ? (
                  <video src={url} muted playsInline preload="metadata" />
                ) : (
                  <img src={url} alt={`输入 ${index + 1}`} width={96} height={96} loading="lazy" decoding="async" />
                )}
                <span className="studio-result-reference-label">输入{index + 1}</span>
              </div>
            ))}
          </div>
        )}
        <div className={`grid min-w-0 flex-1 justify-items-start gap-3 sm:gap-4 ${gridClassName}`}>
          {slots.map((url, index) => (
            <VideoResultCard
              key={`${renderKey}-${index}`}
              url={url}
              index={index}
              running={running}
              aspectRatio={aspectRatio}
              filenamePrefix={filenamePrefix}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function getVideoGridClass(count: number) {
  if (count <= 1) return "max-w-[min(520px,100%)] grid-cols-1";
  if (count === 2) return "max-w-[min(760px,100%)] grid-cols-1 sm:grid-cols-2";
  return "max-w-[min(1040px,100%)] grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";
}

function getVideoGridRunningState(
  statusGroup: TaskStatusGroup | undefined,
  isGenerating: boolean | undefined,
  allExpectedResultsReady: boolean
) {
  if (allExpectedResultsReady || statusGroup === "completed" || statusGroup === "failed") return false;
  if (statusGroup === "running" || statusGroup === "queued") return true;
  return Boolean(isGenerating);
}

function VideoResultCard({
  url,
  index,
  running,
  aspectRatio,
  filenamePrefix,
  onOpen,
}: {
  url: string | null;
  index: number;
  running: boolean;
  aspectRatio?: string;
  filenamePrefix: string;
  onOpen: (url: string, index: number) => void;
}) {
  const layout = getVideoResultLayout(aspectRatio);

  if (!url) {
    return (
      <div className="studio-result-card w-full justify-self-start overflow-hidden bg-white" style={layout}>
        <div className="gen-card studio-result-pending-card flex h-full w-full flex-col items-center justify-center gap-2">
          <StudioHomeHeroLoadingBackdrop />
          <div className="relative z-[1] flex h-14 w-14 items-center justify-center">
            <div className="gen-ring absolute inset-0 rounded-full bg-zinc-300/40" />
            <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-white/16 bg-white/10 shadow-lg backdrop-blur-md">
              {running ? <Loader2 className="h-6 w-6 animate-spin text-white motion-reduce:animate-none" aria-hidden="true" /> : <XCircle className="h-6 w-6 text-white/70" aria-hidden="true" />}
            </div>
          </div>
          <p className="relative z-[1] text-xs font-semibold text-white/72">
            {running ? "视频生成中" : "等待生成"}
          </p>
          <p className="relative z-[1] text-[11px] font-medium text-white/42">预计 2-5 分钟</p>
        </div>
      </div>
    );
  }

  return (
    <div className="studio-result-card group relative w-full justify-self-start overflow-hidden bg-black" style={layout}>
      <div
        role="region"
        aria-label={`生成视频 ${index + 1} 预览`}
        className="relative block w-full bg-black text-left"
        style={{ aspectRatio: "inherit" }}
      >
        <button
          type="button"
          onClick={() => onOpen(url, index)}
          className="absolute inset-0 z-[1] cursor-zoom-in"
          aria-label={`播放生成视频 ${index + 1}`}
        >
          <span className="sr-only">播放生成视频 {index + 1}</span>
        </button>
        <video
          src={url}
          controls
          playsInline
          preload="metadata"
          className="relative h-full w-full bg-black object-contain"
          aria-label={`生成视频 ${index + 1}`}
        />
        <span className="pointer-events-none absolute left-3 top-3 z-[2] inline-flex items-center gap-1 rounded-full bg-black/66 px-2.5 py-1 text-[11px] font-black text-white shadow-sm backdrop-blur">
          <Play className="h-3 w-3" aria-hidden="true" />
          结果
        </span>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          downloadMedia(url, generateDownloadFilename(filenamePrefix, index, "mp4"));
        }}
        className="absolute right-3 top-3 z-[3] flex h-9 w-9 items-center justify-center rounded-full bg-white/92 text-slate-700 opacity-100 shadow-lg ring-1 ring-slate-200/70 backdrop-blur transition-[background-color,color,opacity] hover:bg-white hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/40 focus-visible:ring-offset-2 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
        aria-label={`下载生成视频 ${index + 1}`}
        title={`下载生成视频 ${index + 1}`}
      >
        <Download className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function getVideoResultLayout(aspectRatio?: string): CSSProperties {
  const normalized = typeof aspectRatio === "string" ? aspectRatio.trim() : "9:16";
  const [rawWidth, rawHeight] = normalized.split(":").map((value) => Number(value));
  const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 9;
  const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 16;
  const ratio = width / height;
  const maxWidth = ratio < 0.7
    ? 260
    : ratio < 0.9
      ? 300
      : ratio < 1.15
        ? 340
        : ratio < 1.6
          ? 520
          : 680;

  return {
    aspectRatio: `${width} / ${height}`,
    maxWidth: `min(${maxWidth}px, 100%)`,
  };
}

function isVideoUrl(url: string) {
  return /\.(mp4|mov|webm)(?:$|[?#])/i.test(url);
}

function formatTaskTimestamp(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
