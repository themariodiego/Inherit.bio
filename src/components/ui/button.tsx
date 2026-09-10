import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // Every size is 44px tall, which is `--size-control` (brief line 553:
      // "every button, input, switch, tap target"). Line 706 deletes the 36px
      // size rather than carving it out, because "a second size that violates
      // the touch minimum is not worth its complexity" -- so the variants that
      // remain differ in padding, type scale and icon size, never in whether a
      // finger can hit them. `h-11`/`size-11` is Tailwind's 44px step; the
      // token is declared in globals.css so the scale is readable in one place
      // and a future component can use it directly.
      //
      // Not a change to the frozen visual identity: `tokens.test.ts` pins the
      // colours and the Fraunces/Inter pairing and no size at all, and
      // `--size-control` did not previously exist. What this does move is the
      // rendered height of every surface, which the G2.5/X6.x first-viewport
      // budgets measure -- so those are measured after this, not assumed.
      size: {
        default: "h-11 px-4 py-2 has-[>svg]:px-3",
        xs: "h-11 gap-1 rounded-full px-3 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-11 gap-1.5 rounded-full px-3.5 has-[>svg]:px-3",
        lg: "h-11 rounded-full px-6 has-[>svg]:px-4",
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
