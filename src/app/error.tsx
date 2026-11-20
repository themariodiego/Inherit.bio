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
 *
 * "Try again" is the boundary's `retry`, which fetches the segment from the
 * server again and re-renders it. `reset` only re-renders what the browser
 * already holds, which is the same thrown error when a server component
 * failed: the app layout's sign-in check, or the proxy's rewrite to
 * `/session-check-unavailable`, after the auth service failed for a moment
 * (D-142). `retry` asks for the URL the person is on, so it reaches the proxy.
 */
export default function RootError({ retry }: { error: Error & { digest?: string }; reset: () => void; retry: () => void }) {
  return (
    <div className="quiet-shell flex min-h-screen flex-col items-center justify-center gap-8 bg-paper px-6 py-12">
      <header>
        <Wordmark />
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="surface w-full max-w-2xl focus:outline-none"
      >
        <ErrorContent reset={retry} />
      </main>
      <footer className="text-center">
        <Attribution className="caption" />
      </footer>
    </div>
  );
}
