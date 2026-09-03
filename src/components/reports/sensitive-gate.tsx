"use client";

// Opt-in gate for reports that can reveal serious health-risk information
// (e.g. APOE / Alzheimer's, cancer-risk loci). The header, summary, and
// citations stay visible; the result section is withheld SERVER-side — the
// page only builds and serializes it when the URL carries ?reveal=1 — so a
// gated response never contains the result, not even in the RSC flight
// payload. This component is just the gate's UI plus two device-memory
// conveniences:
//   - "Show my result" is a plain link to ?reveal=1; its click handler also
//     remembers the choice in localStorage, scoped per user AND category so
//     one account's choice never un-gates another account sharing the
//     browser.
//   - On a later gated visit, an effect reads that memory and, if the choice
//     was made before, router.replace()s to ?reveal=1 (a brief gate flash is
//     acceptable).
// Storage failures are never fatal: revealing works server-side regardless;
// only the memory is lost, so the gate simply reappears next time.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

const STORAGE_PREFIX = "inherit.sensitive-reveal.";

function storageKey(userId: string, category: string): string {
  return `${STORAGE_PREFIX}${userId}.${category}`;
}

export function SensitiveGate({
  userId,
  category,
  categoryLabel,
  revealHref,
  returnHref,
}: {
  userId: string;
  category: string;
  /** Human label for the fine print (e.g. "Cancer risk"). */
  categoryLabel: string;
  /** This report's URL with ?reveal=1, built by the page from its route id. */
  revealHref: string;
  /**
   * The "Not now" target: the subject-scoped report library URL with this
   * report's category section anchor, built by the page from its route id.
   */
  returnHref: string;
}) {
  const router = useRouter();

  // Remembered choice from an earlier visit: skip ahead to the revealed URL.
  // An absent or unreadable stored value always means: stay gated.
  useEffect(() => {
    try {
      if (
        window.localStorage.getItem(storageKey(userId, category)) ===
        "revealed"
      ) {
        router.replace(revealHref, { scroll: false });
      }
    } catch {
      // Storage unavailable (private mode, blocked site data) — stay gated.
    }
  }, [userId, category, revealHref, router]);

  const rememberChoice = () => {
    try {
      window.localStorage.setItem(storageKey(userId, category), "revealed");
      // Drop the pre-user-scoping key (device-global, so it leaked one
      // account's choice to others); it is never read any more.
      window.localStorage.removeItem(STORAGE_PREFIX + category);
    } catch {
      // The navigation itself still reveals; only the memory is lost.
    }
  };

  return (
    <section
      data-testid="sensitive-gate"
      aria-labelledby="sensitive-gate-title"
      className="rounded-2xl border border-line bg-card p-6"
    >
      <h2 id="sensitive-gate-title" className="font-medium">
        Before you look
      </h2>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-muted">
        This report may show a serious health risk. You cannot unlearn a result
        after you see it. It shows a link found across many people. It cannot
        diagnose you or say if you will be affected. You may choose not to
        know. Both choices are fair, and you can come back at any time.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button asChild data-testid="sensitive-gate-reveal">
          <Link
            href={revealHref}
            prefetch={false}
            scroll={false}
            onClick={rememberChoice}
          >
            Show my result
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={returnHref}>Not now</Link>
        </Button>
      </div>
      <p className="mt-4 text-xs text-ink-muted">
        Your choice applies to all {categoryLabel} reports and is remembered
        on this device only.
      </p>
    </section>
  );
}
