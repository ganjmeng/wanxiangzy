import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-2xl border border-transparent bg-[var(--codex-glass-fill)] px-3 py-1.5 text-[15px] transition-[background-color,box-shadow,border-color] duration-150 outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/80 focus-visible:bg-background focus-visible:border-ring/40 focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 md:text-sm dark:bg-white/[0.06] dark:focus-visible:bg-white/[0.08] dark:disabled:bg-white/[0.04]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
