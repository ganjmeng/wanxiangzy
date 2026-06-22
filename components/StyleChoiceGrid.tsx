"use client";

import { Check } from "lucide-react";

type StyleChoice<T extends string> = {
  value: T;
  label: string;
  desc: string;
  swatches?: string[];
  imageUrl?: string;
};

type StyleChoiceGridProps<T extends string> = {
  options: readonly StyleChoice<T>[];
  value: T;
  onChange: (value: T) => void;
};

export function StyleChoiceGrid<T extends string>({ options, value, onChange }: StyleChoiceGridProps<T>) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {options.map((style) => {
        const selected = value === style.value;
        const swatches = style.swatches?.length ? style.swatches : ["#f8fafc", "#e2e8f0", "#f4f4f4"];
        const moodBackground = `linear-gradient(135deg, ${swatches[0]} 0%, ${swatches[1] || swatches[0]} 48%, ${swatches[2] || swatches[1] || swatches[0]} 100%)`;

        return (
          <button
            key={style.value}
            type="button"
            onClick={() => onChange(style.value)}
            aria-pressed={selected}
            className={`group relative min-h-[92px] overflow-hidden rounded-[18px] border p-2.5 text-left transition-[background-color,border-color,box-shadow] duration-150 ${
              selected
                ? "border-zinc-300 bg-white shadow-[0_18px_42px_rgba(5,5,5,0.08)] ring-1 ring-zinc-200"
                : "border-slate-200/80 bg-white/78 hover:border-zinc-300 hover:bg-white hover:shadow-[0_14px_32px_rgba(15,23,42,0.06)]"
            }`}
          >
            {selected && (
              <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(5,5,5,0.04),transparent_38%),linear-gradient(135deg,rgba(255,255,255,0.74),rgba(250,245,255,0.66))]" />
            )}
            <div className="relative flex h-full items-stretch gap-2">
              {style.imageUrl ? (
                <span className="relative flex h-[64px] w-[52px] shrink-0 overflow-hidden rounded-2xl border border-white bg-slate-100 shadow-sm">
                  <img src={style.imageUrl} alt={style.label} className="h-full w-full object-cover" loading="lazy" />
                  <span className="absolute inset-0 bg-gradient-to-t from-slate-950/24 via-transparent to-white/8" />
                  <span className="absolute bottom-1.5 left-1.5 right-1.5 flex gap-0.5">
                    {swatches.slice(0, 3).map((swatch, swatchIndex) => (
                      <span
                        key={`${style.value}-${swatch}-${swatchIndex}`}
                        className="h-1 flex-1 rounded-full border border-white/70 shadow-sm"
                        style={{ backgroundColor: swatch }}
                      />
                    ))}
                  </span>
                </span>
              ) : (
                <span
                  className={`relative flex h-[64px] w-[52px] shrink-0 overflow-hidden rounded-2xl border shadow-inner ${
                    selected ? "border-white/90" : "border-white/70"
                  }`}
                  style={{ background: moodBackground }}
                >
                  <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.78),transparent_34%),linear-gradient(160deg,rgba(255,255,255,0.28),rgba(15,23,42,0.10))]" />
                  <span className="absolute bottom-1.5 left-1.5 right-1.5 flex gap-1">
                    {swatches.slice(0, 3).map((swatch, swatchIndex) => (
                      <span
                        key={`${style.value}-${swatch}-${swatchIndex}`}
                        className="h-1.5 flex-1 rounded-full border border-white/70 shadow-sm"
                        style={{ backgroundColor: swatch }}
                      />
                    ))}
                  </span>
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col justify-center pr-5">
                <span className="block break-words text-[12.5px] font-black leading-tight text-slate-950">{style.label}</span>
                <span className="mt-1 line-clamp-3 text-[10px] leading-snug text-slate-500">{style.desc}</span>
              </span>
              {selected && (
                <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(5,5,5,0.08)] text-white shadow-[0_8px_18px_rgba(5,5,5,0.18)]">
                  <Check className="h-3 w-3" aria-hidden="true" />
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
