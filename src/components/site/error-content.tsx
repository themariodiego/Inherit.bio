"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  ERROR_HEADING,
  ERROR_LEAD,
  ERROR_LINKS,
  ERROR_NEXT,
  ERROR_RETRY_LABEL,
  ERROR_WITHHELD,
} from "@/copy/error-state";

/**
 * The body of the error surface, with **no landmark of its own** — for the
 * same reason `not-found-content.tsx` has none, and that reason was learned
 * the hard way there. Next renders the nearest boundary inside the layouts
 * above it, so a boundary in `(app)` or `(marketing)` sits within a layout that
 * already supplies the one `<main id="main">`. A version that brought its own
 * produced two `main` landmarks and two elements with `id="main"` on the same
 * document, and passed its own audit because that audit only ever exercised the
 * root-layout path.
 *
 * `reset` is the boundary's own retry. Nothing here renders the error object:
 * `error.message` and `error.digest` are deliberately never read, because an
 * error's text can carry identifiers, parameters or row contents, and this page
 * is reachable from every surface in the product including the genome ones.
 */
export function ErrorContent({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-prose space-y-4 px-6 py-12">
      <h1 className="font-display text-2xl text-ink">{ERROR_HEADING}</h1>
      <p className="text-sm text-ink">{ERROR_LEAD}</p>
      <p className="text-sm text-ink-muted">{ERROR_WITHHELD}</p>
      <p className="text-sm text-ink-muted">{ERROR_NEXT}</p>
      <p className="pt-1">
        <Button type="button" variant="outline" onClick={reset}>
          {ERROR_RETRY_LABEL}
        </Button>
      </p>
      <ul className="space-y-1 pt-2">
        {ERROR_LINKS.map(link => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="inline-flex min-h-11 items-center text-sm text-ink underline underline-offset-2"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
