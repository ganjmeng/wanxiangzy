"use client";

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Download, Eye, Loader2, RotateCcw, WandSparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StudioHomeHeroLoadingBackdrop } from "@/components/studio/StudioHomeHeroLoadingBackdrop";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getImageVariantUrl } from "@/lib/image-variants";
import { buildSourceImageHref } from "@/lib/studio-image-preview";
import { downloadImage, generateDownloadFilename } from "@/lib/utils";
import type { TaskStatusGroup } from "@/lib/task-queue";

const FALLBACK_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 120'%3E%3Crect width='160' height='120' fill='%23f1f5f9'/%3E%3Ctext x='80' y='62' text-anchor='middle' dominant-baseline='middle' font-size='14' fill='%2394a3b8'%3E加载失败%3C/text%3E%3C/svg%3E";

type ResultImageGridProps = {
  urls: string[];
  filenamePrefix: string;
  onOpen: (url: string, index: number) => void;
  extension?: string;
  expectedCount?: number;
  isGenerating?: boolean;
  imageAltPrefix?: string;
  inputThumbnails?: string[];
  inputReferences?: ResultInputReference[];
  createdAt?: string | null;
  statusGroup?: TaskStatusGroup;
  variant?: "cards" | "task";
  renderKey?: string;
  markMissingAsFailed?: boolean;
  missingFailureLabel?: string;
  missingFailureDetail?: string;
  missingFailureActionLabel?: string;
  onMissingFailureAction?: (index: number) => void;
  missingFailureActionDisabled?: boolean;
  failureLabel?: string;
  failureDetail?: string;
};

export type ResultInputReference = {
  url: string;
  label: string;
};

function getGridClass(count: number) {
  if (count <= 1) return "max-w-[min(340px,100%)] grid-cols-1";
  if (count === 2) return "max-w-[min(700px,100%)] grid-cols-1 sm:grid-cols-2";
  if (count === 3) return "max-w-[min(1048px,100%)] grid-cols-1 sm:grid-cols-3";
  return "max-w-[min(1396px,100%)] grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";
}

function getTileStyle(): CSSProperties {
  return { aspectRatio: "3 / 4" };
}

function getResultGridRunningState(
  statusGroup: TaskStatusGroup | undefined,
  isGenerating: boolean | undefined,
  allExpectedResultsReady: boolean
) {
  if (allExpectedResultsReady || statusGroup === "completed" || statusGroup === "failed") return false;
  if (statusGroup === "running" || statusGroup === "queued") return true;
  return Boolean(isGenerating);
}

export function ResultImageGrid({
  urls,
  filenamePrefix,
  onOpen,
  extension = "png",
  expectedCount,
  isGenerating,
  imageAltPrefix = "生成结果",
  inputThumbnails = [],
  inputReferences = [],
  createdAt,
  statusGroup,
  variant = "cards",
  renderKey = "result",
  markMissingAsFailed = false,
  missingFailureLabel,
  missingFailureDetail,
  missingFailureActionLabel,
  onMissingFailureAction,
  missingFailureActionDisabled = false,
  failureLabel,
  failureDetail,
}: ResultImageGridProps) {
  const fallbackCreatedAt = useMemo(() => new Date().toISOString(), []);
  const count = Math.max(urls.length, expectedCount || 0, 1);
  const isSingle = count <= 1;
  const slots = Array.from({ length: count }, (_, index) => urls[index] || null);
  const completedSlotCount = slots.filter(Boolean).length;
  const allExpectedResultsReady = completedSlotCount >= count;
  const incomingReferenceItems = useMemo(
    () => buildReferenceItems(inputReferences, inputThumbnails),
    [inputReferences, inputThumbnails]
  );
  const activeTaskSet = variant === "task" && (Boolean(isGenerating) || urls.length > 0 || Boolean(statusGroup));
  const referenceSnapshotKey = useMemo(
    () => [
      createdAt || "",
      renderKey,
      urls.filter(Boolean).join("|"),
      expectedCount || "",
      statusGroup || "",
    ].join("::"),
    [createdAt, expectedCount, renderKey, statusGroup, urls]
  );
  const previousGeneratingRef = useRef(false);
  const [referenceSnapshot, setReferenceSnapshot] = useState<{ key: string; items: ResultInputReference[] } | null>(null);

  useEffect(() => {
    const startedRun = Boolean(isGenerating && !previousGeneratingRef.current);
    previousGeneratingRef.current = Boolean(isGenerating);

    if (!activeTaskSet) {
      setReferenceSnapshot(null);
      return;
    }

    setReferenceSnapshot((current) => {
      if (startedRun || !current || (!isGenerating && current.key !== referenceSnapshotKey)) {
        return { key: referenceSnapshotKey, items: incomingReferenceItems };
      }
      return current;
    });
  }, [activeTaskSet, incomingReferenceItems, isGenerating, referenceSnapshotKey]);

  if (variant === "task") {
    const running = getResultGridRunningState(statusGroup, isGenerating, allExpectedResultsReady);
    const failed = statusGroup === "failed";
    const calmPendingMotion = running && count >= 6;
    const referenceItems = (referenceSnapshot?.items.length ? referenceSnapshot.items : incomingReferenceItems).slice(0, 4);
    const timestamp = formatTaskTimestamp(createdAt) || formatTaskTimestamp(fallbackCreatedAt);

    return (
      <div className="studio-result-set w-full max-w-[min(1480px,100%)]">
        <p className="studio-result-disclaimer">
          因产品处于持续学习调优阶段，可能有不恰当的信息，请您谨慎甄别。
        </p>
        <p className="studio-result-time">{timestamp}</p>

        <div className="flex w-full items-start gap-3">
          {referenceItems.length > 0 && (
            <div className="studio-result-reference-list">
              {referenceItems.map(({ url: referenceUrl, label }, index) => (
                <div key={`${referenceUrl}-${label}-${index}`} className="studio-result-reference-thumb">
                  <img src={getImageVariantUrl(referenceUrl, "thumb")} alt={`${label} ${index + 1}`} width={96} height={96} loading="lazy" decoding="async" />
                  <span className="studio-result-reference-label">{label}</span>
                </div>
              ))}
            </div>
          )}

          <div className={`grid min-w-0 flex-1 gap-3 ${getGridClass(count)}`}>
            {slots.map((url, index) => {
              const missingFailed = (markMissingAsFailed || statusGroup === "completed") && !url && !running;
              return (
                <ResultCard
                  key={`${renderKey}-${index}`}
                  url={url}
                  index={index}
                  count={count}
                  failed={failed || missingFailed}
                  running={running}
                  calmPendingMotion={calmPendingMotion}
                  filenamePrefix={filenamePrefix}
                  extension={extension}
                  imageAltPrefix={imageAltPrefix}
                  onOpen={onOpen}
                  failureLabel={failed ? failureLabel : missingFailed ? missingFailureLabel : undefined}
                  failureDetail={failed ? failureDetail : missingFailed ? missingFailureDetail : undefined}
                  failureActionLabel={missingFailed ? missingFailureActionLabel : undefined}
                  onFailureAction={missingFailed && onMissingFailureAction ? () => onMissingFailureAction(index) : undefined}
                  failureActionDisabled={missingFailureActionDisabled}
                />
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const running = getResultGridRunningState(statusGroup, isGenerating, allExpectedResultsReady);

  return (
    <div className={`studio-result-card-grid mx-auto grid w-full gap-3 sm:gap-4 ${getGridClass(count)}`}>
      {slots.map((url, index) => {
        const missingFailed = (markMissingAsFailed || statusGroup === "completed") && !url && !running;
        return (
          <ResultCard
            key={`${renderKey}-${index}`}
            url={url}
            index={index}
            count={count}
            failed={statusGroup === "failed" || missingFailed}
            running={running}
            calmPendingMotion={Boolean(running && count >= 6)}
            filenamePrefix={filenamePrefix}
            extension={extension}
            imageAltPrefix={imageAltPrefix}
            onOpen={onOpen}
            isSingle={isSingle}
            failureLabel={statusGroup === "failed" ? failureLabel : missingFailed ? missingFailureLabel : undefined}
            failureDetail={statusGroup === "failed" ? failureDetail : missingFailed ? missingFailureDetail : undefined}
            failureActionLabel={missingFailed ? missingFailureActionLabel : undefined}
            onFailureAction={missingFailed && onMissingFailureAction ? () => onMissingFailureAction(index) : undefined}
            failureActionDisabled={missingFailureActionDisabled}
          />
        );
      })}
    </div>
  );
}

function buildReferenceItems(inputReferences: ResultInputReference[], inputThumbnails: string[]): ResultInputReference[] {
  const labeled = inputReferences
    .filter((item) => item.url)
    .map((item) => ({
      url: item.url,
      label: item.label || "参考图",
    }));
  if (labeled.length) return labeled;
  return inputThumbnails
    .filter(Boolean)
    .map((url, index) => ({ url, label: `参考图${index + 1}` }));
}

type ResultCardProps = {
  url: string | null;
  index: number;
  count: number;
  failed: boolean;
  running: boolean;
  calmPendingMotion?: boolean;
  filenamePrefix: string;
  extension: string;
  imageAltPrefix: string;
  onOpen: (url: string, index: number) => void;
  isSingle?: boolean;
  failureLabel?: string;
  failureDetail?: string;
  failureActionLabel?: string;
  onFailureAction?: () => void;
  failureActionDisabled?: boolean;
};

const ResultCard = memo(function ResultCard({
  url,
  index,
  count,
  failed,
  running,
  calmPendingMotion,
  filenamePrefix,
  extension,
  imageAltPrefix,
  onOpen,
  isSingle,
  failureLabel,
  failureDetail,
  failureActionLabel,
  onFailureAction,
  failureActionDisabled,
}: ResultCardProps) {
  const router = useRouter();
  const openPreview = () => {
    if (url) onOpen(url, index);
  };
  const downloadResult = () => {
    if (!url) return;
    downloadImage(url, generateDownloadFilename(filenamePrefix, index, extension));
  };
  const openImageRepair = () => {
    if (!url) return;
    router.push(buildSourceImageHref("/general-image/image-to-image", url));
  };
  const openAiVideo = () => {
    if (!url) return;
    router.push(buildSourceImageHref("/video", url));
  };

  return (
    <TooltipProvider>
      <div
        className={`studio-result-card group relative min-w-0 overflow-hidden bg-white transition-transform duration-200 hover:-translate-y-0.5 focus-within:outline-none focus-within:ring-2 focus-within:ring-zinc-950/40 focus-within:ring-offset-2 ${isSingle ? "mx-auto max-w-full" : ""}`}
      >
        {url ? (
          <button
            type="button"
            aria-label={`预览${imageAltPrefix} ${index + 1}`}
            title={`预览${imageAltPrefix} ${index + 1}`}
            className="absolute inset-0 z-[1] cursor-zoom-in"
            onClick={openPreview}
          >
            <span className="sr-only">预览{imageAltPrefix} {index + 1}</span>
          </button>
        ) : null}
        <div className="flex items-center justify-center" style={getTileStyle()}>
          {url ? (
            <StableResultImage
              src={getImageVariantUrl(url, count <= 1 ? "detail" : "card")}
              alt={`${imageAltPrefix} ${index + 1}`}
            />
          ) : (
            <PendingResultSlot
              failed={failed}
              running={running}
              calmMotion={calmPendingMotion}
              index={index}
              failureLabel={failureLabel}
              failureDetail={failureDetail}
              failureActionLabel={failureActionLabel}
              onFailureAction={onFailureAction}
              failureActionDisabled={failureActionDisabled}
            />
          )}
        </div>

        {url && (
          <div className="studio-result-focus-layer" aria-hidden={false}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="studio-result-focus-view"
              onClick={(event) => {
                event.stopPropagation();
                openPreview();
              }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              查看
            </Button>
            <div className="studio-result-focus-actions">
              <ResultFocusAction label="AI修图" onClick={openImageRepair} icon={<WandSparkles className="h-3.5 w-3.5" />} />
              <ResultFocusAction label="AI视频" onClick={openAiVideo} icon={<Clapperboard className="h-3.5 w-3.5" />} />
              <ResultFocusAction label="下载" onClick={downloadResult} icon={<Download className="h-3.5 w-3.5" />} />
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}, areResultCardPropsEqual);

function areResultCardPropsEqual(prev: ResultCardProps, next: ResultCardProps) {
  return (
    prev.url === next.url &&
    prev.index === next.index &&
    prev.count === next.count &&
    prev.failed === next.failed &&
    prev.running === next.running &&
    prev.calmPendingMotion === next.calmPendingMotion &&
    prev.filenamePrefix === next.filenamePrefix &&
    prev.extension === next.extension &&
    prev.imageAltPrefix === next.imageAltPrefix &&
    prev.onOpen === next.onOpen &&
    prev.isSingle === next.isSingle &&
    prev.failureLabel === next.failureLabel &&
    prev.failureDetail === next.failureDetail &&
    prev.failureActionLabel === next.failureActionLabel &&
    prev.onFailureAction === next.onFailureAction &&
    prev.failureActionDisabled === next.failureActionDisabled
  );
}

function ResultFocusAction({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="studio-result-focus-action"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      aria-label={label}
    >
      {icon}
      <span>{label}</span>
    </Button>
  );
}

function StableResultImage({ src, alt }: { src: string; alt: string }) {
  const [displaySrc, setDisplaySrc] = useState(src);
  const [failedSrc, setFailedSrc] = useState("");

  useEffect(() => {
    if (src === displaySrc || src === failedSrc) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) {
        setDisplaySrc(src);
        setFailedSrc("");
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setDisplaySrc(FALLBACK_IMAGE);
        setFailedSrc(src);
      }
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [displaySrc, failedSrc, src]);

  return (
    <img
      src={displaySrc}
      alt={alt}
      width={1200}
      height={1600}
      loading="lazy"
      decoding="async"
      className="h-full w-full object-cover"
      onError={() => {
        setDisplaySrc(FALLBACK_IMAGE);
        setFailedSrc(src);
      }}
    />
  );
}

function PendingResultSlot({
  failed = false,
  running = false,
  calmMotion = false,
  index,
  failureLabel,
  failureDetail,
  failureActionLabel,
  onFailureAction,
  failureActionDisabled,
}: {
  failed?: boolean;
  running?: boolean;
  calmMotion?: boolean;
  index: number;
  failureLabel?: string;
  failureDetail?: string;
  failureActionLabel?: string;
  onFailureAction?: () => void;
  failureActionDisabled?: boolean;
}) {
  return (
    <div className={`gen-card studio-result-pending-card flex h-full w-full flex-col items-center justify-center gap-2 ${failed ? "studio-result-pending-card-failed" : ""} ${calmMotion ? "studio-result-pending-card-calm" : ""}`}>
      {!failed && !calmMotion && <StudioHomeHeroLoadingBackdrop />}
      <div className="relative z-[1] flex h-14 w-14 items-center justify-center">
        <div className="gen-ring absolute inset-0 rounded-full bg-zinc-300/40" />
        <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-white/16 bg-white/10 shadow-lg backdrop-blur-md">
          {failed ? <XCircle className="h-6 w-6 text-red-200" aria-hidden="true" /> : <Loader2 className="h-6 w-6 animate-spin text-white motion-reduce:animate-none" aria-hidden="true" />}
        </div>
      </div>
      <p className="relative z-[1] text-xs font-semibold text-white/72">
        {failed ? failureLabel || "生成失败，可套用参数重试" : running ? "生成中，请稍候" : "等待生成"}
      </p>
      {failed && failureDetail && (
        <p className="studio-result-failure-detail relative z-[1] max-h-24 max-w-[82%] overflow-auto rounded-lg px-2.5 py-2 text-left text-[11px] font-medium leading-4">
          {failureDetail}
        </p>
      )}
      {failed && onFailureAction && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onFailureAction();
          }}
          disabled={failureActionDisabled}
          className="studio-result-failure-action relative z-[1]"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{failureActionLabel || "重试本张"}</span>
        </button>
      )}
      {!failed && running && (
        <p className="relative z-[1] text-[11px] font-medium text-white/42">第 {index + 1} 张生成中</p>
      )}
    </div>
  );
}

function formatTaskTimestamp(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
