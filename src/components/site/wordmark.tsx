import Link from "next/link";
import { cn } from "@/lib/utils";

// The Inherit wordmark: Fraunces, two-tone (ink "In" + forest "herit" tail,
// underline dot motif kept typographic — no Plus Bio logo assets are used or
// recreated; Inherit carries its own mark within the shared design language.
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn("display text-2xl leading-none tracking-tight", className)}
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
