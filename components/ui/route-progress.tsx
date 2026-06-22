"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Top-of-page progress bar that lights up while Next.js is
 * resolving a new route (RSC + client navigation + form-driven GET).
 *
 * - Listens to pathname + searchParams changes and shows the bar until
 *   the next paint finishes.
 * - Falls back to a 10s safety timeout so the bar never sticks on screen.
 * - Honors `prefers-reduced-motion` via `motion-safe:` on every transition.
 * - `aria-live="polite"` + visually hidden status for SR users.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);
  const [progress, setProgress] = useState(0);
  const startedAtRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const safetyRef = useRef<number | null>(null);
  const lastRouteRef = useRef<string>("");

  useEffect(() => {
    const routeKey = `${pathname}?${searchParams.toString()}`;
    if (routeKey === lastRouteRef.current) return;
    lastRouteRef.current = routeKey;

    setActive(true);
    setProgress(8);
    startedAtRef.current = performance.now();

    // Animate to ~85% over 600ms then ease out
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const elapsed = performance.now() - startedAtRef.current;
      const next = Math.min(85, 8 + elapsed * 0.0013);
      setProgress(next);
      if (next < 85) {
        rafRef.current = window.requestAnimationFrame(tick);
      }
    };
    rafRef.current = window.requestAnimationFrame(tick);

    // requestAnimationFrame fires after the next paint, so by the time
    // the new route's RSC has streamed in, the bar can finish.
    const finishHandle = window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (cancelled) return;
        setProgress(100);
        window.setTimeout(() => {
          if (cancelled) return;
          setActive(false);
        }, 180);
      }, 120);
    });

    safetyRef.current = window.setTimeout(() => {
      if (cancelled) return;
      setProgress(100);
      window.setTimeout(() => {
        if (cancelled) return;
        setActive(false);
      }, 180);
    }, 10_000);

    return () => {
      cancelled = true;
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      if (safetyRef.current !== null) window.clearTimeout(safetyRef.current);
      window.cancelAnimationFrame(finishHandle);
    };
  }, [pathname, searchParams]);

  return (
    <>
      <div
        aria-hidden="true"
        className="route-progress pointer-events-none fixed inset-x-0 top-0 z-[10000] h-0.5 overflow-hidden"
      >
        <div
          className={cn(
            "h-full motion-safe:transition-[width,opacity] motion-safe:duration-200",
            active ? "opacity-100" : "opacity-0",
          )}
          style={{
            width: `${progress}%`,
            background: "linear-gradient(90deg, #06101d 0%, #4b5263 50%, #06101d 100%)",
            boxShadow: "none",
          }}
        />
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {active ? "页面加载中" : ""}
      </span>
    </>
  );
}

function cn(...args: Array<string | false | null | undefined>) {
  return args.filter(Boolean).join(" ");
}
