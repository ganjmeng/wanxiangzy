"use client";

import { CheckCircle2, ChevronLeft, ChevronRight, Search, Sparkles, X } from "lucide-react";
import { ClientPortal } from "@/components/ClientPortal";
import { cn } from "@/lib/utils";

export type ReferenceScenePickerTab = "recommended" | "exclusive" | "all";
export type ReferenceScenePickerViewFilter = "all" | "front" | "back";
export type ReferenceScenePickerBodyFilter = "all" | "whole" | "upper" | "lower";

export type ReferenceScenePickerItem = {
  id: string;
  url: string;
  label: string;
  childReferences?: ReferenceScenePickerItem[];
  matchReasons?: string[];
  clothCategories?: string[];
  viewTags?: string[];
  cropTags?: string[];
  sceneTags?: string[];
  styleTags?: string[];
};

export type ReferenceScenePickerTabOption<TValue extends string = ReferenceScenePickerTab> = {
  value: TValue;
  label: string;
};

export type ReferenceScenePickerProps<TItem extends ReferenceScenePickerItem = ReferenceScenePickerItem> = {
  open: boolean;
  title?: string;
  description?: string;
  tabs: Array<ReferenceScenePickerTabOption<ReferenceScenePickerTab>>;
  activeTab: ReferenceScenePickerTab;
  onTabChange: (tab: ReferenceScenePickerTab) => void;
  mainReferences: TItem[];
  activeReference: TItem | null;
  childReferences: TItem[];
  selectedCount: number;
  maxSelected: number;
  categoryLabels?: string[];
  viewFilter: ReferenceScenePickerViewFilter;
  onViewFilterChange: (value: ReferenceScenePickerViewFilter) => void;
  bodyFilter: ReferenceScenePickerBodyFilter;
  onBodyFilterChange: (value: ReferenceScenePickerBodyFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  isSelected: (url: string) => boolean;
  onActiveReferenceChange: (url: string) => void;
  onToggleReference: (item: TItem) => void;
  onClearSelected: () => void;
  onClose: () => void;
  onConfirm: () => void;
  onPreview?: (url: string, label: string) => void;
  className?: string;
};

export function ReferenceScenePicker<TItem extends ReferenceScenePickerItem = ReferenceScenePickerItem>({
  open,
  title = "选择风格场景",
  description = "先选主场景，再从姿势图中多选参考图",
  tabs,
  activeTab,
  onTabChange,
  mainReferences,
  activeReference,
  childReferences,
  selectedCount,
  maxSelected,
  categoryLabels = [],
  viewFilter,
  onViewFilterChange,
  bodyFilter,
  onBodyFilterChange,
  search,
  onSearchChange,
  isSelected,
  onActiveReferenceChange,
  onToggleReference,
  onClearSelected,
  onClose,
  onConfirm,
  onPreview,
  className,
}: ReferenceScenePickerProps<TItem>) {
  if (!open) return null;

  const showAllSceneLayout = activeTab === "all";
  const activeIndex = activeReference
    ? mainReferences.findIndex((item) => item.url === activeReference.url)
    : -1;
  const canMovePreview = showAllSceneLayout && mainReferences.length > 1 && activeIndex >= 0;

  const movePreview = (direction: -1 | 1) => {
    if (!canMovePreview) return;
    const nextIndex = (activeIndex + direction + mainReferences.length) % mainReferences.length;
    const next = mainReferences[nextIndex];
    if (next) onActiveReferenceChange(next.url);
  };

  return (
    <ClientPortal>
      <div
        className={cn(
          "fixed inset-0 z-[210] bg-slate-950/34 p-3 backdrop-blur-sm lg:bottom-3 lg:left-[calc(var(--studio-nav-rail-width)+var(--studio-task-rail-width)+var(--studio-sidebar-width)+20px)] lg:right-5 lg:top-6 lg:bg-transparent lg:p-0 lg:backdrop-blur-0",
          className
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.22)]">
          <header className="relative flex h-16 shrink-0 items-center justify-center border-b border-slate-100 px-12">
            <div className="min-w-0 text-center">
              <h3 className="truncate text-[13px] font-bold text-slate-950">{title}</h3>
              <p className="hidden truncate text-[10px] text-slate-400 sm:block">{description}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/30 focus-visible:ring-offset-2"
              aria-label="关闭场景选择"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="shrink-0 bg-slate-50 px-4 py-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {tabs.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => onTabChange(item.value)}
                      className={cn(
                        "h-8 rounded-full px-4 text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/30 focus-visible:ring-offset-2",
                        activeTab === item.value
                          ? "bg-zinc-100 text-zinc-900"
                          : "bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="h-7 rounded-full bg-zinc-100 px-3 text-[10px] font-bold text-zinc-900">
                    全部场景
                  </button>
                  <button type="button" className="h-7 rounded-full bg-white px-3 text-[10px] font-medium text-slate-500">
                    棚拍Look图
                  </button>
                  <button type="button" className="h-7 rounded-full bg-white px-3 text-[10px] font-medium text-slate-500">
                    实景拍摄
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                <select
                  value={viewFilter}
                  onChange={(event) => onViewFilterChange(event.target.value as ReferenceScenePickerViewFilter)}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-500 focus:border-[var(--codex-accent)] focus:outline-none"
                  aria-label="正背面筛选"
                >
                  <option value="all">正/背面</option>
                  <option value="front">正面</option>
                  <option value="back">背面</option>
                </select>
                <select
                  value={bodyFilter}
                  onChange={(event) => onBodyFilterChange(event.target.value as ReferenceScenePickerBodyFilter)}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-500 focus:border-[var(--codex-accent)] focus:outline-none"
                  aria-label="身体范围筛选"
                >
                  <option value="all">全/半身</option>
                  <option value="whole">全身</option>
                  <option value="upper">上半身</option>
                  <option value="lower">下半身</option>
                </select>
                {categoryLabels.slice(0, 2).map((category) => (
                  <span key={category} className="inline-flex h-8 max-w-[210px] items-center rounded-lg bg-white px-2.5 text-[11px] font-medium text-slate-600">
                    <span className="truncate">{category}</span>
                    <X className="ml-1 h-3 w-3 text-slate-400" />
                  </span>
                ))}
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(event) => onSearchChange(event.target.value)}
                    placeholder="按名称、场景搜索"
                    className="h-8 w-[min(260px,calc(100vw-96px))] rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-[11px] text-slate-600 outline-none transition focus:border-[var(--codex-accent)]"
                  />
                </label>
              </div>
            </div>
          </div>

          {showAllSceneLayout ? (
            <div className="grid min-h-0 flex-1 grid-cols-1 bg-white lg:grid-cols-[minmax(280px,34%)_minmax(0,1fr)]">
              <ScenePreviewPane
                activeReference={activeReference}
                total={mainReferences.length}
                activeIndex={activeIndex}
                selectedCount={selectedCount}
                maxSelected={maxSelected}
                onPreview={onPreview}
                onPrevious={() => movePreview(-1)}
                onNext={() => movePreview(1)}
                canMove={canMovePreview}
              />
              <div className="studio-scrollbar-hide min-h-0 overflow-y-auto px-4 py-4">
                {mainReferences.length ? (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {mainReferences.map((ref) => (
                      <SceneMainCard
                        key={ref.url}
                        item={ref}
                        active={activeReference?.url === ref.url}
                        selected={isSelected(ref.url)}
                        onClick={() => {
                          onActiveReferenceChange(ref.url);
                          onToggleReference(ref);
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <PickerEmptyState label="当前筛选没有可用场景" />
                )}
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col bg-white">
              <div className="shrink-0 border-b border-slate-100 px-4 py-3">
                <div className="studio-scrollbar-hide flex gap-3 overflow-x-auto pb-1">
                  {mainReferences.map((ref) => (
                    <button
                      key={ref.url}
                      type="button"
                      onClick={() => onActiveReferenceChange(ref.url)}
                      className={cn(
                        "w-[108px] shrink-0 overflow-hidden rounded-lg border bg-white text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/30 focus-visible:ring-offset-2",
                        activeReference?.url === ref.url
                          ? "border-[var(--codex-accent)] shadow-sm"
                          : "border-slate-200 hover:border-slate-300"
                      )}
                    >
                      <img src={ref.url} alt={ref.label || "主场景"} className="aspect-[3/4] w-full object-cover" />
                      <p className="line-clamp-2 px-2 py-1.5 text-center text-[11px] font-medium text-slate-700">{ref.label}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="studio-scrollbar-hide min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <h4 className="mb-4 text-center text-[13px] font-bold text-[var(--codex-accent)]">场景姿势图</h4>
                {childReferences.length ? (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {childReferences.map((ref) => (
                      <SceneChildCard
                        key={ref.url}
                        item={ref}
                        selected={isSelected(ref.url)}
                        onClick={() => onToggleReference(ref)}
                      />
                    ))}
                  </div>
                ) : (
                  <PickerEmptyState label="当前筛选没有可用场景姿势图" />
                )}
              </div>
            </div>
          )}

          <footer className="flex h-16 shrink-0 items-center justify-between gap-3 border-t border-slate-100 bg-white/92 px-4">
            {selectedCount > 0 ? (
              <div className="flex items-center gap-4">
                <span className="text-[11px] font-semibold text-[var(--codex-accent)]">已选 {selectedCount}/{maxSelected}</span>
                <button
                  type="button"
                  onClick={onClearSelected}
                  className="text-[11px] font-medium text-red-500 transition hover:text-red-600"
                >
                  全部删除
                </button>
              </div>
            ) : (
              <div />
            )}
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="h-10 min-w-[120px] rounded-lg border border-slate-200 bg-white px-5 text-[13px] font-bold text-slate-700 transition hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={!selectedCount}
                className="h-10 min-w-[120px] rounded-lg bg-[var(--codex-accent)] px-5 text-[13px] font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-slate-200"
              >
                确定
              </button>
            </div>
          </footer>
        </div>
      </div>
    </ClientPortal>
  );
}

function ScenePreviewPane({
  activeReference,
  total,
  activeIndex,
  selectedCount,
  maxSelected,
  onPreview,
  onPrevious,
  onNext,
  canMove,
}: {
  activeReference: ReferenceScenePickerItem | null;
  total: number;
  activeIndex: number;
  selectedCount: number;
  maxSelected: number;
  onPreview?: (url: string, label: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  canMove: boolean;
}) {
  return (
    <aside className="flex min-h-[320px] flex-col border-b border-slate-100 bg-slate-50 p-4 lg:min-h-0 lg:border-b-0 lg:border-r">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-slate-100">
        {activeReference ? (
          <>
            <button
              type="button"
              onClick={() => onPreview?.(activeReference.url, activeReference.label || "主场景")}
              className="block h-full w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/30 focus-visible:ring-offset-2"
              aria-label={`预览场景：${activeReference.label}`}
            >
              <img src={activeReference.url} alt={activeReference.label || "主场景"} className="h-full min-h-[320px] w-full object-cover lg:min-h-0" />
            </button>
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-slate-950/68 to-transparent p-3 text-white">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-bold">{activeReference.label}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {[...(activeReference.viewTags || []), ...(activeReference.cropTags || [])].slice(0, 4).map((tag) => (
                    <span key={tag} className="rounded bg-slate-950/48 px-1.5 py-0.5 text-[10px] font-medium">
                      {tag.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-slate-950/58 px-2 py-1 text-[11px] font-bold">
                {activeIndex >= 0 ? activeIndex + 1 : 0}/{total}
              </span>
            </div>
            {canMove && (
              <>
                <button
                  type="button"
                  onClick={onPrevious}
                  className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950/50 text-white transition hover:bg-slate-950/68"
                  aria-label="上一个场景"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={onNext}
                  className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950/50 text-white transition hover:bg-slate-950/68"
                  aria-label="下一个场景"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}
          </>
        ) : (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center text-slate-400">
            <Sparkles className="mb-2 h-6 w-6" />
            <p className="text-xs font-medium">暂未选择</p>
            <p className="mt-1 text-[11px] text-[var(--codex-accent)]">右侧选择场景后展示该场景 AI 生成图效果</p>
          </div>
        )}
      </div>

      <div className="mt-3 rounded-xl bg-white px-3 py-3">
        <p className="text-center text-xs text-slate-500">
          选择与服装<span className="font-semibold text-red-500">款式、长短</span>相匹配的场景效果最佳
        </p>
        <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
          <span>共 {total} 个风格场景</span>
          {selectedCount > 0 && (
            <span className="font-semibold text-[var(--codex-accent)]">已选 {selectedCount}/{maxSelected}</span>
          )}
        </div>
      </div>
    </aside>
  );
}

function SceneMainCard({
  item,
  active,
  selected,
  onClick,
}: {
  item: ReferenceScenePickerItem;
  active: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-white text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/30 focus-visible:ring-offset-2",
        active || selected ? "border-[var(--codex-accent)] shadow-sm" : "border-slate-200 hover:border-slate-300"
      )}
      aria-label={`选择风格场景：${item.label}`}
    >
      <img src={item.url} alt={item.label || "风格场景"} className="aspect-[3/4] w-full object-cover transition-transform group-hover:scale-[1.02]" />
      <span className={cn(
        "absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border-2 bg-white/92 shadow-sm",
        selected ? "border-[var(--codex-accent)] bg-[var(--codex-accent)]" : "border-white"
      )}>
        {selected && <CheckCircle2 className="h-4 w-4 text-white" />}
      </span>
      <p className="line-clamp-2 px-2 py-2 text-center text-[10px] font-medium leading-4 text-slate-700">{item.label}</p>
    </button>
  );
}

function SceneChildCard({
  item,
  selected,
  onClick,
}: {
  item: ReferenceScenePickerItem;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-xl border-2 bg-white text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/30 focus-visible:ring-offset-2",
        selected ? "border-[var(--codex-accent)] shadow-sm" : "border-transparent hover:border-slate-300"
      )}
      aria-label={`选择场景姿势图：${item.label}`}
    >
      <img src={item.url} alt={item.label || "场景姿势图"} className="aspect-[3/4] w-full object-cover transition-transform group-hover:scale-[1.02]" />
      <span className={cn(
        "absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border-2 bg-white/90 shadow-sm",
        selected ? "border-[var(--codex-accent)] bg-[var(--codex-accent)]" : "border-white"
      )}>
        {selected && <CheckCircle2 className="h-4 w-4 text-white" />}
      </span>
      <p className="line-clamp-2 px-2 py-2 text-center text-[10px] font-medium leading-4 text-slate-700">{item.label}</p>
    </button>
  );
}

function PickerEmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center py-20 text-center text-xs text-slate-400">
      <Sparkles className="mb-2 h-6 w-6" />
      {label}
    </div>
  );
}
