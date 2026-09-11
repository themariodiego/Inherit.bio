"use client";

import { Attribution, Wordmark } from "@/components/site/wordmark";
import { ErrorContent } from "@/components/site/error-content";

/**
 * The error boundary for anything that throws outside a route group, which
 * renders under the root layout — and the root layout carries no chrome, so
 * this boundary supplies the landmarks itself. The `(app)` and `(marketing)`
 * boundaries render `ErrorContent` alone, because their layouts already provide
 * the one `<main>`.
 *
 * The `error` argument is accepted and deliberately never rendered: its message
 * and digest can carry identifiers, parameters or row contents, and the
 * register asks this state to be "public-safe".
 */
export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-paper px-6 py-12">
      <header>
        <Wordmark />
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="w-full max-w-prose rounded-2xl border border-line bg-card shadow-sm focus:outline-none"
      >
        <ErrorContent reset={reset} />
      </main>
      <footer className="space-y-2 text-center">
        <Attribution />
      </footer>
    </div>
  );
}
