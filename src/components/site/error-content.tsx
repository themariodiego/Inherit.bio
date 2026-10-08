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
import { Terrain } from "@/components/site/terrain";

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
    <div className="quiet-column mx-auto max-w-2xl px-6 py-section">
      <div aria-hidden="true" className="quiet-band">
        <Terrain variant="band" seed={11} />
      </div>
      <h1 className="display">{ERROR_HEADING}</h1>
      <p className="body-lg mt-6 max-w-measure text-ink">{ERROR_LEAD}</p>
      <p className="mt-4 max-w-measure text-ink-muted">{ERROR_WITHHELD}</p>
      <p className="mt-4 max-w-measure text-ink-muted">{ERROR_NEXT}</p>
      <p className="mt-6">
        <Button type="button" variant="outline" onClick={reset}>
          {ERROR_RETRY_LABEL}
        </Button>
      </p>
      <ul className="quiet-links mt-8 border-t border-line pt-4">
        {ERROR_LINKS.map(link => (
          <li key={link.href}>
            <Link href={link.href} className="quiet-link">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
