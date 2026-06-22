"use client";

import { cn } from "@/lib/utils";

type ChartDatum = Record<string, any>;

type ChartProps = {
  data?: ChartDatum[];
  xField?: string;
  yField?: string;
  angleField?: string;
  colorField?: string;
  height?: number;
  className?: string;
};

const colors = ["#0f172a", "#16a34a", "#d97706", "#dc2626", "#0891b2", "#7c3aed", "#475569", "#f97316"];

function numberValue(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function maxValue(rows: ChartDatum[], field?: string) {
  return Math.max(1, ...rows.map((row) => numberValue(field ? row[field] : 0)));
}

export function Column({ data = [], xField = "label", yField = "value", height = 280, className }: ChartProps) {
  const max = maxValue(data, yField);
  return (
    <div className={cn("flex items-end gap-2 rounded-md bg-slate-50 p-4", className)} style={{ height }}>
      {data.map((row, index) => {
        const value = numberValue(row[yField]);
        return (
          <div key={`${row[xField]}-${index}`} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <div className="w-full rounded-t bg-primary" style={{ height: `${Math.max(4, (value / max) * (height - 92))}px`, backgroundColor: colors[index % colors.length] }} title={`${row[xField]}: ${value}`} />
            <span className="max-w-full truncate text-[11px] text-slate-500">{row[xField]}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Bar({ data = [], xField = "value", yField = "label", height = 280, className }: ChartProps) {
  const max = maxValue(data, xField);
  return (
    <div className={cn("space-y-3 rounded-md bg-slate-50 p-4", className)} style={{ minHeight: height }}>
      {data.map((row, index) => {
        const value = numberValue(row[xField]);
        return (
          <div key={`${row[yField]}-${index}`} className="grid grid-cols-[minmax(80px,160px)_1fr_56px] items-center gap-3 text-xs">
            <span className="truncate text-slate-600">{row[yField]}</span>
            <span className="h-3 overflow-hidden rounded-full bg-slate-200">
              <span className="block h-full rounded-full" style={{ width: `${(value / max) * 100}%`, backgroundColor: colors[index % colors.length] }} />
            </span>
            <span className="text-right font-medium text-slate-700">{value}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Line({ data = [], xField = "date", yField = "value", colorField = "metric", height = 280, className }: ChartProps & { point?: boolean; smooth?: boolean; legend?: unknown; axis?: unknown }) {
  const groups = Array.from(new Set(data.map((row) => String(row[colorField] ?? "value"))));
  const labels = Array.from(new Set(data.map((row) => String(row[xField]))));
  const max = maxValue(data, yField);
  const width = Math.max(420, labels.length * 48);

  return (
    <div className={cn("overflow-auto rounded-md bg-slate-50 p-4", className)} style={{ height }}>
      <svg width={width} height={height - 54} role="img" aria-label="line chart">
        {groups.map((group, groupIndex) => {
          const rows = labels.map((label) => data.find((row) => String(row[xField]) === label && String(row[colorField] ?? "value") === group));
          const points = rows.map((row, index) => {
            const x = 24 + (labels.length <= 1 ? 0 : (index / (labels.length - 1)) * (width - 56));
            const y = 18 + (1 - numberValue(row?.[yField]) / max) * (height - 100);
            return `${x},${y}`;
          }).join(" ");
          return <polyline key={group} fill="none" stroke={colors[groupIndex % colors.length]} strokeWidth="2.5" points={points} />;
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
        {groups.map((group, index) => (
          <span key={group} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
            {group}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Pie({ data = [], angleField = "value", colorField = "type", height = 280, className }: ChartProps & { innerRadius?: number; legend?: unknown; label?: unknown }) {
  const total = data.reduce((sum, row) => sum + numberValue(row[angleField]), 0) || 1;
  return (
    <div className={cn("grid items-center gap-4 rounded-md bg-slate-50 p-4 sm:grid-cols-[160px_1fr]", className)} style={{ minHeight: height }}>
      <div className="relative mx-auto h-36 w-36 rounded-full" style={{
        background: `conic-gradient(${data.map((row, index) => {
          const start = data.slice(0, index).reduce((sum, item) => sum + numberValue(item[angleField]), 0) / total * 100;
          const end = start + numberValue(row[angleField]) / total * 100;
          return `${colors[index % colors.length]} ${start}% ${end}%`;
        }).join(", ")})`,
      }}>
        <div className="absolute inset-10 rounded-full bg-slate-50" />
      </div>
      <div className="space-y-2 text-sm">
        {data.map((row, index) => (
          <div key={`${row[colorField]}-${index}`} className="flex items-center justify-between gap-3">
            <span className="inline-flex min-w-0 items-center gap-2 truncate text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
              {row[colorField]}
            </span>
            <span className="font-medium">{numberValue(row[angleField])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
