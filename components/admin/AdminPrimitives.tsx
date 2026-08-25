import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowUpRight, ImageIcon, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { AdminImagePreview } from "@/components/admin/AdminImagePreview";
import type { TaskStatusGroup } from "@/lib/task-queue";

/* ----------------------------------------------------------------------------
 * Token reference
 * Every color class below resolves to a CSS variable declared in
 * `app/globals.css` (consolidated from the former `app/styles/admin.css`).
 * The variables swap automatically when the user toggles the theme via the
 * top-bar <ThemeToggle />.
 * -------------------------------------------------------------------------- */
const adminTextPrimary = "text-[var(--admin-fg)]";
const adminTextMuted = "text-[var(--admin-muted)]";
const adminTextFaint = "text-[var(--admin-faint)]";
const adminTextLink = "text-[var(--admin-link)]";
const adminSurface = "bg-[var(--admin-surface)]";
const adminSurfaceSoft = "bg-[var(--admin-surface-soft)]";
const adminBorder = "border-[var(--admin-border)]";

/* ----------------------------------------------------------------------------
 * Tone helpers — keep status / metric / notice styling in one place so a
 * future tweak only changes these strings.
 * -------------------------------------------------------------------------- */
type Tone = "success" | "warning" | "danger" | "info" | "neutral";

function badgeToneClass(tone: Tone) {
  // Each variant reads from the matching --admin-{tone}-{border|soft|fg} trio
  // declared in globals.css. Border + bg are pre-mixed rgba so the same class
  // works on both light surface and dark surface tokens.
  switch (tone) {
    case "success":
      return "border-[var(--admin-success-border)] bg-[var(--admin-success-soft)] text-[var(--admin-success)]";
    case "warning":
      return "border-[var(--admin-warning-border)] bg-[var(--admin-warning-soft)] text-[var(--admin-warning)]";
    case "danger":
      return "border-[var(--admin-danger-border)] bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]";
    case "info":
      return "border-[var(--admin-info-border)] bg-[var(--admin-info-soft)] text-[var(--admin-info)]";
    default:
      return "border-[var(--admin-neutral-border)] bg-[var(--admin-neutral-soft)] text-[var(--admin-neutral)]";
  }
}

function metricBorderClass(tone: Tone) {
  switch (tone) {
    case "success":
      return "border-[var(--admin-success-border)]";
    case "warning":
      return "border-[var(--admin-warning-border)]";
    case "danger":
      return "border-[var(--admin-danger-border)]";
    default:
      return adminBorder;
  }
}

function metricToneFg(tone: Tone): string {
  switch (tone) {
    case "success":
      return "var(--admin-success)";
    case "warning":
      return "var(--admin-warning)";
    case "danger":
      return "var(--admin-danger)";
    default:
      return "var(--admin-fg)";
  }
}

/**
 * Canonical status → tone map. Single source of truth used by both
 * <AdminStatusBadge /> and any KPI / table cell that needs a status pill.
 */
function statusToTone(status: string, group?: TaskStatusGroup): Tone {
  const normalized = (group || status).toLowerCase();
  if (
    normalized === "completed" ||
    normalized === "success" ||
    normalized === "published" ||
    normalized === "pass" ||
    normalized === "approved" ||
    normalized === "active"
  ) {
    return "success";
  }
  if (
    normalized === "failed" ||
    normalized === "danger" ||
    normalized === "hide" ||
    normalized === "rejected" ||
    normalized === "suspended"
  ) {
    return "danger";
  }
  if (normalized === "running" || normalized.startsWith("processing")) {
    return "info";
  }
  if (
    normalized === "queued" ||
    normalized === "draft" ||
    normalized === "escalate" ||
    normalized === "pending" ||
    normalized === "restricted"
  ) {
    return "warning";
  }
  return "neutral";
}

/* ----------------------------------------------------------------------------
 * Components
 * -------------------------------------------------------------------------- */

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className={`text-xs font-black uppercase tracking-[0.14em] ${adminTextFaint}`}>{eyebrow}</p>}
        <h1 className={`mt-1 text-2xl font-black tracking-tight sm:text-3xl ${adminTextPrimary}`}>{title}</h1>
        {description && <p className={`mt-2 max-w-3xl text-sm leading-6 ${adminTextMuted}`}>{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function AdminSection({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={`rounded-lg border ${adminBorder} ${adminSurface} shadow-sm`}>
      <div className={`flex flex-col gap-3 border-b ${adminBorder} px-4 py-3 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <h2 className={`admin-section-title text-sm font-black ${adminTextPrimary}`}>{title}</h2>
          {description && <p className={`mt-1 text-xs leading-5 ${adminTextMuted}`}>{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function AdminMetricCard({
  label,
  value,
  hint,
  tone = "neutral",
  suffix,
  trend,
  icon,
  delta,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "good" | "warning" | "danger";
  suffix?: string;
  trend?: number[];
  icon?: ReactNode;
  delta?: {
    value: number;
    suffix?: string;
    hint?: string;
    tone?: "good" | "warning" | "danger" | "neutral";
  };
}) {
  const normalized: Tone =
    tone === "good" ? "success" : tone === "warning" ? "warning" : tone === "danger" ? "danger" : "neutral";
  const toneSoftClass: Record<Tone, string> = {
    success: "border-[var(--admin-success-border)] bg-[var(--admin-success-soft)] text-[var(--admin-success)]",
    warning: "border-[var(--admin-warning-border)] bg-[var(--admin-warning-soft)] text-[var(--admin-warning)]",
    danger: "border-[var(--admin-danger-border)] bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]",
    info: "border-[var(--admin-info-border)] bg-[var(--admin-info-soft)] text-[var(--admin-info)]",
    neutral: "border-[var(--admin-neutral-border)] bg-[var(--admin-neutral-soft)] text-[var(--admin-neutral)]",
  };
  return (
    <div className={`relative flex h-full flex-col gap-2 rounded-lg border ${adminSurface} p-4 shadow-sm ${metricBorderClass(normalized)}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon && (
            <span
              aria-hidden="true"
              className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${toneSoftClass[normalized]}`}
            >
              {icon}
            </span>
          )}
          <p className={`min-w-0 text-xs font-black uppercase tracking-[0.1em] ${adminTextFaint}`}>{label}</p>
        </div>
        {delta ? (
          <AdminDeltaIndicator {...delta} className="shrink-0" />
        ) : trend && trend.length > 1 ? (
          <AdminSparkline data={trend} tone={tone} className="shrink-0" />
        ) : null}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`text-2xl font-black tabular-nums ${adminTextPrimary}`}>{value}</span>
        {suffix && <span className={`text-xs font-bold ${adminTextMuted}`}>{suffix}</span>}
      </div>
      {hint && <p className={`mt-auto text-xs font-semibold ${adminTextMuted}`}>{hint}</p>}
    </div>
  );
}

/**
 * Vercel-style "vs prior period" delta pill. Replaces sparklines on KPI tiles.
 * Auto-tones: positive → good, negative → danger, zero → neutral. Caller can
 * override via `tone`.
 */
export function AdminDeltaIndicator({
  value,
  suffix = "%",
  tone,
  hint,
  className,
}: {
  value: number;
  suffix?: string;
  tone?: "good" | "warning" | "danger" | "neutral";
  hint?: string;
  className?: string;
}) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const resolvedTone: "good" | "warning" | "danger" | "neutral" = tone
    ?? (safeValue > 0 ? "good" : safeValue < 0 ? "danger" : "neutral");
  const toneClass: Record<typeof resolvedTone, string> = {
    good: "border-[var(--admin-success-border)] bg-[var(--admin-success-soft)] text-[var(--admin-success)]",
    warning: "border-[var(--admin-warning-border)] bg-[var(--admin-warning-soft)] text-[var(--admin-warning)]",
    danger: "border-[var(--admin-danger-border)] bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]",
    neutral: "border-[var(--admin-neutral-border)] bg-[var(--admin-neutral-soft)] text-[var(--admin-neutral)]",
  };
  const Icon = safeValue > 0 ? TrendingUp : safeValue < 0 ? TrendingDown : Minus;
  const sign = safeValue > 0 ? "+" : "";
  const display = `${sign}${Math.abs(safeValue).toFixed(1)}${suffix}`;
  const ariaLabel = hint ? `${display} ${hint}` : display;
  return (
    <span
      role="status"
      aria-label={ariaLabel}
      className={`inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-black tabular-nums leading-none ${toneClass[resolvedTone]} ${className ?? ""}`}
    >
      <Icon aria-hidden="true" className="h-3 w-3" />
      {display}
    </span>
  );
}

/**
 * Tiny inline SVG sparkline for KPI tiles. Pure render — no recharts dep.
 * Renders nothing for fewer than 2 data points.
 */
export function AdminSparkline({
  data,
  tone = "neutral",
  width = 88,
  height = 28,
  className,
}: {
  data: number[];
  tone?: "neutral" | "good" | "warning" | "danger";
  width?: number;
  height?: number;
  className?: string;
}) {
  if (data.length < 2) return null;
  const stroke = adminToneColor(tone);
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;
  const stepX = width / (data.length - 1);
  const pad = 3;
  const innerHeight = height - pad * 2;
  // Flat-data fallback: when all values are equal, draw a dashed line at 50%
  // height so the card still reads as "no variation" instead of a flat
  // bottom-of-svg line that looks broken.
  if (range <= 0) {
    const midY = height / 2;
    return (
      <svg
        aria-hidden="true"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={className}
      >
        <line
          x1={0}
          y1={midY}
          x2={width}
          y2={midY}
          stroke="var(--admin-faint)"
          strokeWidth={1}
          strokeDasharray="3 3"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  const points = data
    .map((value, index) => {
      const x = index * stepX;
      const y = pad + innerHeight - ((value - min) / range) * innerHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
    >
      <polygon
        points={areaPoints}
        fill={stroke}
        fillOpacity={0.12}
        stroke="none"
      />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AdminNotice({ children, tone = "warning" }: { children: ReactNode; tone?: "warning" | "danger" | "info" }) {
  const normalized: Tone = tone === "danger" ? "danger" : tone === "info" ? "info" : "warning";
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm leading-6 ${badgeToneClass(normalized)}`}>
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function AdminStatusBadge({ status, group }: { status: string; group?: TaskStatusGroup }) {
  const tone = statusToTone(status, group);
  return (
    <span className={`inline-flex h-6 items-center rounded-md border px-2 text-[11px] font-black leading-none ${badgeToneClass(tone)}`}>
      {formatStatusLabel(status, group)}
    </span>
  );
}

export function AdminTable<T>({
  rows,
  columns,
  empty,
  rowKey,
}: {
  rows: T[];
  columns: Array<{
    key: string;
    label: string;
    className?: string;
    render: (row: T) => ReactNode;
  }>;
  empty?: ReactNode;
  rowKey: (row: T, index: number) => string;
}) {
  if (!rows.length) {
    return (
      <div className="flex min-h-44 items-center justify-center px-4 py-8 text-center">
        <div>
          <div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-lg ${adminSurfaceSoft}`}>
            <ImageIcon aria-hidden="true" className={`h-5 w-5 ${adminTextFaint}`} />
          </div>
          <p className={`mt-3 text-sm font-bold ${adminTextPrimary}`}>{empty || "暂无数据"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className={`min-w-full divide-y ${adminBorder} text-left text-sm`}>
        <thead className={adminSurfaceSoft}>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`whitespace-nowrap px-4 py-2.5 text-xs font-black uppercase tracking-[0.08em] ${adminTextFaint} ${column.className || ""}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={`divide-y ${adminBorder} ${adminSurface}`}>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)} className="hover:bg-[var(--admin-surface-soft)]">
              {columns.map((column) => (
                <td key={column.key} className={`px-4 py-3 align-middle ${column.className || ""}`}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ThumbnailStrip({ urls }: { urls: string[] }) {
  const cleanUrls = urls.map((url) => url.trim()).filter(Boolean);
  const visibleCount = cleanUrls.length > 4 ? 3 : Math.min(cleanUrls.length, 4);
  const visible = cleanUrls.slice(0, visibleCount);
  if (!visible.length) return <span className={`text-xs font-semibold ${adminTextFaint}`}>无图片</span>;

  return (
    <div className="flex items-center -space-x-2">
      {visible.map((url, index) => (
        <AdminImagePreview
          key={`${url}-${index}`}
          urls={cleanUrls}
          initialIndex={index}
          label={`预览图片 ${index + 1}`}
        />
      ))}
      {cleanUrls.length > visible.length && (
        <AdminImagePreview
          urls={cleanUrls}
          initialIndex={visible.length}
          label="预览更多图片"
          countLabel={`+${cleanUrls.length - visible.length}`}
          triggerClassName={`flex h-9 w-9 items-center justify-center rounded-md border ${adminBorder} ${adminSurface} shadow-sm`}
        />
      )}
    </div>
  );
}

export function AdminExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-1 text-xs font-black ${adminTextLink} hover:text-[var(--admin-fg)]`}>
      {children}
      <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
    </Link>
  );
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function shortAdminCode(value: string | null | undefined, prefix = "编号") {
  if (!value) return "-";
  return prefix ? `${prefix} ${value.slice(0, 8)}` : value.slice(0, 8);
}

export function resourceTypeLabel(value: string | null | undefined) {
  if (value === "generation") return "生成任务";
  if (value === "reference") return "参考素材";
  if (value === "favorite-plan") return "收藏方案";
  if (value === "user") return "用户";
  if (value === "credit") return "灵点";
  return value || "对象";
}

export function operationTypeLabel(value: string | null | undefined) {
  if (value === "credit_adjustment") return "灵点补偿";
  if (value === "asset_moderation") return "内容处理";
  if (value === "generation_recovery") return "任务处理";
  return value || "后台操作";
}

/**
 * Public helper for any KPI tile / inline value that needs a tone-colored
 * foreground. Returned as `var(--admin-...)` so it inherits dark-mode.
 */
export function adminToneColor(tone: "neutral" | "good" | "warning" | "danger"): string {
  const normalized: Tone =
    tone === "good" ? "success" : tone === "warning" ? "warning" : tone === "danger" ? "danger" : "neutral";
  return metricToneFg(normalized);
}

/**
 * Public helper mirroring <Tag color="…"> from shadcn-compat — keeps the
 * tone vocabulary consistent across the admin area.
 */
export function adminToneClass(tone: Tone): string {
  return badgeToneClass(tone);
}

function formatStatusLabel(status: string, group?: TaskStatusGroup) {
  const label = group || status;
  if (label === "completed") return "已完成";
  if (label === "failed") return "失败";
  if (label === "running") return "运行中";
  if (label === "queued") return "排队中";
  if (label === "published") return "已发布";
  if (label === "draft") return "草稿";
  if (label === "archived") return "已归档";
  if (label === "pending") return "待处理";
  if (label === "approved") return "已通过";
  if (label === "rejected") return "已驳回";
  if (label === "active") return "正常";
  if (label === "restricted") return "观察";
  if (label === "suspended") return "暂停";
  if (label === "hide") return "下架";
  if (label === "pass") return "通过";
  if (label === "escalate") return "复核";
  return status || "-";
}
