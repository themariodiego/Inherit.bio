import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// A pill of text. 13px is the product's type floor (brief §2), so the badge
// never goes below `text-xs` (0.8125rem). Colour carries no meaning here: an
// outline pill is a label, a tint pill is a quiet highlight, nothing more.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap leading-5 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-forest text-on-forest [a&]:hover:bg-forest-deep",
        secondary:
          "border-transparent bg-tint text-ink [a&]:hover:bg-surface-inset",
        destructive:
          "border-transparent bg-danger text-paper dark:text-ink [a&]:hover:bg-danger/90",
        outline:
          "border-line-strong text-ink [a&]:hover:bg-surface-inset",
        ghost: "border-transparent text-ink-muted [a&]:hover:bg-surface-inset",
        link: "border-transparent text-forest underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
