"use client";

// Opt-in gate for reports that can reveal serious health-risk information
// (e.g. APOE / Alzheimer's, cancer-risk loci). The header, summary, and
// citations stay visible; only the result/genotype section is wrapped.
// The choice to reveal is remembered per CATEGORY in localStorage — this is
// device-local by design (no server round-trip, nothing leaves the browser).
// An absent or unreadable stored value always means: show the gate.

import Link from "next/link";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

const STORAGE_PREFIX = "inherit.sensitive-reveal.";

function subscribe(onStoreChange: () => void): () => void {
  // Re-reads the stored choice when another tab changes it.
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function storedChoice(category: string): boolean {
  try {
    return (
      window.localStorage.getItem(STORAGE_PREFIX + category) === "revealed"
    );
  } catch {
    return false;
  }
}

function rememberChoice(category: string) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + category, "revealed");
  } catch {
    // Storage unavailable (private mode, blocked site data) — the reveal
    // still works for this page view via component state; the gate simply
    // reappears next time.
  }
}

export function SensitiveGate({
  category,
  children,
}: {
  category: string;
  children: ReactNode;
}) {
  // localStorage is browser-only; the server snapshot is always "not
  // revealed", so server and client first paint the same markup (gate shown)
  // and no result ever flashes before the stored choice is known.
  const stored = useSyncExternalStore(
    subscribe,
    () => storedChoice(category),
    () => false,
  );
  const [clickedThrough, setClickedThrough] = useState(false);
  const revealed = stored || clickedThrough;
  const reveal = () => {
    rememberChoice(category);
    setClickedThrough(true);
  };

  if (revealed) return <>{children}</>;

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
        This report can reveal serious health-risk information, and once
        you&apos;ve seen a result it can&apos;t be unlearned. What it can tell
        you is a statistical association observed across many people; what it
        can&apos;t do is diagnose anything or say whether you personally will
        ever be affected. Some people prefer not to know — both choices are
        reasonable, and you can come back any time.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button data-testid="sensitive-gate-reveal" onClick={reveal}>
          Show my result
        </Button>
        <Button asChild variant="outline">
          <Link href="/reports">Not now</Link>
        </Button>
      </div>
      <p className="mt-4 text-xs text-ink-muted">
        Your choice is remembered on this device only.
      </p>
    </section>
  );
}
