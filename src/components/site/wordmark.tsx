import Link from "next/link";
import { cn } from "@/lib/utils";

// The Sequence wordmark: Fraunces, two-tone (ink "Se" + forest "quence" tail
// underline dot motif kept typographic — no Plus Bio logo assets are used or
// recreated; Sequence is a sibling brand with its own mark.
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn("display text-2xl leading-none tracking-tight", className)}
      aria-label="Sequence home"
    >
      Se<span className="accent">quence</span>
      <span aria-hidden className="text-forest">
        .
      </span>
    </Link>
  );
}

export function Attribution({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-ink-muted", className)}>
      Sequence · an open-source project in collaboration with{" "}
      <a
        href="https://www.plus.bio"
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-ink"
      >
        Plus Bio
      </a>
    </p>
  );
}
