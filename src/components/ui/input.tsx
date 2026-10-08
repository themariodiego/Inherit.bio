import * as React from "react"

import { cn } from "@/lib/utils"

// 44px tall (`--size-control`), the small radius, a `--line-strong` outline
// because a form edge carries information (brief §1.4), card ground so the
// field reads as a place to write. Focus is the one global ring.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-sm border border-line-strong bg-card px-3.5 py-1 text-base text-ink outline-none selection:bg-tint selection:text-ink file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink placeholder:text-ink-muted hover:border-forest focus-visible:border-forest disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-danger",
        className
      )}
      {...props}
    />
  )
}

export { Input }
