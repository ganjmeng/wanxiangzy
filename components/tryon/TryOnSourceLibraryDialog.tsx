"use client";

import { FolderOpen, Loader2, RefreshCw, X } from "lucide-react";
import { ClientPortal } from "@/components/ClientPortal";
import { getImageVariantUrl } from "@/lib/image-variants";
import type { TryOnSourceLibraryItem } from "@/lib/tryon-source-library";

type TryOnSourceLibraryDialogProps = {
  open: boolean;
  targetLabel: string;
  items: TryOnSourceLibraryItem[];
  isLoading: boolean;
  error: string;
  onClose: () => void;
  onRefresh: () => void;
  onSelect: (item: TryOnSourceLibraryItem) => void;
};

export function TryOnSourceLibraryDialog({
  open,
  targetLabel,
  items,
  isLoading,
  error,
  onClose,
  onRefresh,
  onSelect,
}: TryOnSourceLibraryDialogProps) {
  if (!open) return null;

  return (
    <ClientPortal>
      <div
        className="fixed inset-0 z-[210] flex min-h-dvh w-dvw items-center justify-center bg-slate-950/38 p-4 backdrop-blur-xl sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tryon-source-library-title"
        onClick={onClose}
      >
        <div
          className="flex max-h-[86dvh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-white/80 bg-white/[0.96] shadow-[0_32px_100px_rgba(15,23,42,0.22)] backdrop-blur-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--codex-accent)]">作品库</p>
              <h3 id="tryon-source-library-title" className="mt-1 text-base font-bold text-slate-950">
                选择{targetLabel}
              </h3>
              <p className="mt-1 text-xs text-slate-500">从已完成作品中复用图片作为服装输入。</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={onRefresh}
                disabled={isLoading}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:border-zinc-300 hover:text-zinc-900 disabled:opacity-50"
                aria-label="刷新作品库"
                title="刷新作品库"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:border-zinc-300 hover:text-zinc-900"
                aria-label="关闭作品库"
                title="关闭作品库"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="min-h-[320px] overflow-y-auto px-5 py-4">
            {error ? (
              <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-red-100 bg-red-50/40 px-5 text-center">
                <p className="text-sm font-semibold text-red-600">{error}</p>
                <button
                  type="button"
                  onClick={onRefresh}
                  className="mt-4 rounded-full border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
                >
                  重新加载
                </button>
              </div>
            ) : isLoading ? (
              <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-slate-400">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-sm">正在加载作品库</p>
              </div>
            ) : items.length === 0 ? (
              <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-5 text-center">
                <FolderOpen className="h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-700">暂无可复用作品</p>
                <p className="mt-1 text-xs text-slate-400">生成完成的图片会出现在这里。</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item)}
                    className="group overflow-hidden rounded-2xl border border-slate-100 bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:ring-offset-2"
                    aria-label={`选择作品库图片：${item.label}`}
                  >
                    <div className="studio-checkerboard aspect-[4/5] overflow-hidden">
                      <img src={getImageVariantUrl(item.url, "card")} alt={`作品库图片：${item.label}`} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                    </div>
                    <div className="px-3 py-2">
                      <p className="truncate text-xs font-bold text-slate-800">{item.label}</p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-400">{item.moduleLabel}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </ClientPortal>
  );
}
