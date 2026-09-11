"use client";

import { ErrorContent } from "@/components/site/error-content";
import "./globals.css";

/**
 * The last boundary: an error thrown by the root layout itself, which replaces
 * that layout entirely — so this file must render `<html>` and `<body>` of its
 * own, and cannot rely on the theme provider or the fonts the root layout sets
 * up.
 *
 * It therefore supplies the landmarks, like `src/app/error.tsx` does and unlike
 * the per-group boundaries. `color-scheme` is left to the stylesheet's own
 * `:root`, because the provider that would otherwise set a theme class is the
 * thing that failed.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-full">
        <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-paper px-6 py-12">
          <main
            id="main"
            tabIndex={-1}
            className="w-full max-w-prose rounded-2xl border border-line bg-card shadow-sm focus:outline-none"
          >
            <ErrorContent reset={reset} />
          </main>
        </div>
      </body>
    </html>
  );
}
