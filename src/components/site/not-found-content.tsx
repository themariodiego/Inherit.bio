import Link from "next/link";
import {
  NOT_FOUND_HEADING,
  NOT_FOUND_LEAD,
  NOT_FOUND_LINKS,
  NOT_FOUND_NEXT,
  NOT_FOUND_WITHHELD,
} from "@/copy/not-found";

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
    <div className="mx-auto max-w-prose space-y-4 px-6 py-12">
      <h1 className="font-display text-2xl text-ink">{NOT_FOUND_HEADING}</h1>
      <p className="text-sm text-ink">{NOT_FOUND_LEAD}</p>
      <p className="text-sm text-ink-muted">{NOT_FOUND_WITHHELD}</p>
      <p className="text-sm text-ink-muted">{NOT_FOUND_NEXT}</p>
      <ul className="space-y-1 pt-2">
        {NOT_FOUND_LINKS.map(link => (
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
