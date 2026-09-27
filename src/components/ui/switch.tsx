"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex h-11 w-14 shrink-0 items-center rounded-full px-1 outline-none before:absolute before:inset-x-0 before:inset-y-2 before:rounded-full before:border before:border-forest before:transition-colors data-[state=checked]:before:bg-primary data-[state=unchecked]:before:bg-ink-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none relative block size-5 rounded-full bg-paper transition-transform duration-200 ease-out data-[state=checked]:translate-x-6 data-[state=unchecked]:translate-x-0 motion-reduce:transition-none",
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
