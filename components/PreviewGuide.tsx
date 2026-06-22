import Image from "next/image";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PreviewGuideStep = {
  title: string;
  desc: string;
  imageSrc?: string;
  imageAlt?: string;
  imageFit?: "cover" | "contain";
  badge?: string;
};

type PreviewGuideProps = {
  title: string;
  subtitle: string;
  steps: PreviewGuideStep[];
  imageSrc?: string;
  imageAlt?: string;
  icon?: ReactNode;
  actions?: ReactNode;
};

export function PreviewGuide({
  title,
  subtitle,
  steps,
  imageSrc,
  imageAlt = "",
  icon,
  actions,
}: PreviewGuideProps) {
  const stepGridClass = steps.length >= 4
    ? "sm:grid-cols-2 lg:grid-cols-4"
    : steps.length === 2
      ? "sm:grid-cols-2"
    : "sm:grid-cols-3";
  const visualGridWidthClass = steps.length >= 4
    ? ""
    : steps.length === 2
      ? "mx-auto max-w-[720px]"
      : "mx-auto max-w-[900px]";
  const connectorVisibilityClass = steps.length >= 4 ? "lg:flex" : "sm:flex";

  return (
    <div className="relative mx-auto w-full max-w-[1080px] px-1 py-2 text-center sm:px-3">
      <div className="pointer-events-none absolute inset-x-10 top-16 h-40 rounded-full bg-[radial-gradient(circle,rgba(5,5,5,0.04),transparent_68%)] blur-3xl" />
      <div className="relative">
        <h3 className="text-[24px] font-black tracking-normal text-slate-950 sm:text-[34px]" style={{ textWrap: "balance" }}>{title}</h3>
        <p className="mx-auto mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500 sm:text-[15px]">{subtitle}</p>

        <div className="mt-8 overflow-hidden rounded-[30px] border border-white/80 bg-white/95 px-4 py-7 text-left shadow-[0_28px_90px_rgba(5,5,5,0.08),0_8px_26px_rgba(15,23,42,0.06)] ring-1 ring-slate-950/[0.03] backdrop-blur sm:px-7 sm:py-8">
          <div className={`grid grid-cols-1 gap-5 sm:gap-6 ${stepGridClass} ${visualGridWidthClass}`}>
            {steps.map((step, index) => {
              const hasImage = Boolean(step.imageSrc || imageSrc);
              const isContain = step.imageFit === "contain";

              return (
                <div key={step.title} className="group relative min-w-0">
                  <div className="relative overflow-hidden rounded-[22px] bg-gradient-to-br from-white via-slate-100 to-slate-200 p-px shadow-[0_18px_42px_rgba(15,23,42,0.08)] transition-[transform,box-shadow] duration-300 group-hover:-translate-y-0.5 group-hover:shadow-[0_24px_54px_rgba(5,5,5,0.12)]">
                    <div
                      className={cn(
                        "relative aspect-[4/5] overflow-hidden rounded-[21px]",
                        isContain
                          ? "bg-[linear-gradient(135deg,#ffffff_0%,#fafafa_55%,#fafafa_100%)]"
                          : "bg-slate-100"
                      )}
                    >
                      {hasImage ? (
                        <Image
                          src={step.imageSrc || imageSrc || ""}
                          alt={step.imageAlt || imageAlt || step.title}
                          fill
                          sizes="(max-width: 640px) 86vw, (max-width: 1024px) 42vw, 250px"
                          className={cn(
                            "transition duration-500 group-hover:scale-[1.025]",
                            isContain ? "object-contain p-5 sm:p-6" : "object-cover object-top"
                          )}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#fafafa,#fafafa)] text-[var(--codex-accent)]">
                          {icon || <span className="text-4xl font-black text-slate-300">{index + 1}</span>}
                        </div>
                      )}
                      <span className="absolute left-3 top-3 inline-flex h-7 items-center rounded-full border border-white/80 bg-white/92 px-2.5 text-[11px] font-black leading-none text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.12)] backdrop-blur">
                        {step.badge || `步骤 ${index + 1}`}
                      </span>
                    </div>
                  </div>
                  {index < steps.length - 1 ? (
                    <div className={cn(
                      "pointer-events-none absolute right-[-27px] top-[38%] z-10 hidden h-9 w-9 items-center justify-center rounded-full border-[3px] border-white bg-[var(--codex-accent)] text-white shadow-[0_16px_34px_rgba(5,5,5,0.18)]",
                      connectorVisibilityClass
                    )}>
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </div>
                  ) : null}
                  <div className="mt-3 flex items-center justify-center gap-2 text-center">
                    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 px-2 text-[11px] font-black text-slate-500">
                      {index + 1}
                    </span>
                    <p className="min-w-0 truncate text-[14px] font-black text-slate-950 sm:text-[15px]">{step.title}</p>
                  </div>
                  {step.desc ? (
                    <p className="mx-auto mt-1.5 max-w-[220px] text-center text-[11px] font-semibold leading-5 text-slate-500">
                      {step.desc}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          {actions && <div className="mt-7 flex flex-wrap justify-center gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
