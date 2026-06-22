import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full rounded-2xl border border-transparent bg-[var(--codex-glass-fill)] px-3 py-2.5 text-[15px] transition-[background-color,box-shadow,border-color] duration-150 outline-none placeholder:text-muted-foreground/80 focus-visible:bg-background focus-visible:border-ring/40 focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 md:text-sm dark:bg-white/[0.06] dark:focus-visible:bg-white/[0.08]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
