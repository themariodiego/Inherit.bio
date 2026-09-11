import Link from "next/link";
import { cn } from "@/lib/utils";

// The Inherit wordmark: Fraunces, two-tone (ink "In" + forest "herit" tail,
// underline dot motif kept typographic — no Plus Bio logo assets are used or
// recreated; Inherit carries its own mark within the shared design language.
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      // The wordmark is a link home on every layout, so it is a tap target
      // under brief line 553. `leading-none` made it exactly as tall as its
      // glyphs (24px at text-2xl, 20px at the sidebar's text-xl); min-h-11
      // gives it the control scale without touching the type. Free in the
      // marketing header and the app rail, where the row is already 44px
      // because of the controls beside it; in the auth layout and the footer
      // it adds the difference.
      className={cn(
        "display inline-flex min-h-11 items-center text-2xl leading-none tracking-tight",
        className,
      )}
      aria-label="Inherit home"
    >
      In<span className="accent">herit</span>
      <span aria-hidden className="text-forest">
        .
      </span>
    </Link>
  );
}

export function Attribution({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-ink-muted", className)}>
      Inherit · an open-source project created by{" "}
      <a
        href="https://www.plus.bio"
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-ink"
      >
        Plus Bio
      </a>{" "}
      for the public good
    </p>
  );
}
