import Link from "next/link";
import {
  NOT_FOUND_HEADING,
  NOT_FOUND_LEAD,
  NOT_FOUND_LINKS,
  NOT_FOUND_NEXT,
  NOT_FOUND_WITHHELD,
} from "@/copy/not-found";
import { Terrain } from "@/components/site/terrain";

/**
 * The body of the not-found surface, with **no landmark of its own**.
 *
 * That is the whole reason this is a separate component, and it was found by a
 * test rather than by design. Next renders the nearest `not-found.tsx` boundary
 * inside the layouts above it, so a `notFound()` thrown in `(app)` or
 * `(marketing)` renders within a layout that already supplies the one `<main
 * id="main">`. A not-found page that brought its own produced **two `main`
 * landmarks and two elements with `id="main"`** on the same document — a
 * `landmark-one-main` failure, a duplicate id, and a skip link pointing at an
 * ambiguous target. The first version of this page did exactly that, and it
 * passed its own accessibility audit, because that audit visited an unmatched
 * URL, which renders under the bare root layout where there is no second
 * `<main>` to collide with.
 *
 * So the landmark belongs to whoever is rendering: `src/app/not-found.tsx`
 * supplies one because the root layout has no chrome, and the per-group
 * boundaries supply none because their layouts already did.
 */
export function NotFoundContent() {
  return (
    <div className="quiet-column mx-auto max-w-2xl px-6 py-block">
      <div aria-hidden="true" className="quiet-band">
        <Terrain variant="band" seed={11} />
      </div>
      <h1 className="display">{NOT_FOUND_HEADING}</h1>
      <p className="body-lg mt-6 max-w-measure text-ink">{NOT_FOUND_LEAD}</p>
      <p className="mt-4 max-w-measure text-ink-muted">{NOT_FOUND_WITHHELD}</p>
      <p className="mt-4 max-w-measure text-ink-muted">{NOT_FOUND_NEXT}</p>
      <ul className="quiet-links mt-8 border-t border-line pt-4">
        {NOT_FOUND_LINKS.map(link => (
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
