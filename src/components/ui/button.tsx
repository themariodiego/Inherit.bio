import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// The one action control. Every size is 44px tall (`--size-control`, brief
// §1.1): the variants differ in padding, type scale and icon size, never in
// whether a finger can hit them. Focus is the product's single ring
// (globals.css `:focus-visible`), so no variant adds a second one.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-sm font-medium whitespace-nowrap outline-none transition-colors disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-danger [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-forest text-on-forest hover:bg-forest-deep",
        destructive:
          "bg-danger text-paper hover:bg-danger/90 dark:text-ink",
        outline:
          "border border-line-strong bg-card text-ink hover:border-forest hover:bg-surface-inset",
        secondary:
          "bg-tint text-ink hover:bg-surface-inset",
        ghost:
          "text-ink hover:bg-surface-inset",
        link: "text-forest underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-5 py-2 has-[>svg]:px-4",
        xs: "h-11 gap-1 rounded-full px-3 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-11 gap-1.5 rounded-full px-4 has-[>svg]:px-3",
        lg: "h-11 rounded-full px-6 text-base has-[>svg]:px-5",
        icon: "size-11",
        "icon-xs": "size-11 rounded-full [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-11",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
