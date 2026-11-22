"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * `next/link` that prefetches on intent, not on sight: nothing is fetched
 * when the link enters the viewport, and once the person points at it,
 * focuses it or touches it, it prefetches exactly as a default `<Link>` does.
 *
 * Why: a default `<Link>` prefetches every link that scrolls into view
 * (Next.js 16, "Prefetching" in `node_modules/next/dist/docs/01-app/
 * 02-guides/prefetching.md`), and in this product every prefetch passes the
 * proxy's sign-in check. A signed-in page's chrome alone made 21 prefetch
 * requests per page view, so 22 of the 25 `GET /auth/v1/user` calls a
 * report page cost were prefetches nobody followed (D-142, measured
 * 19 November 2026). This is the hover-triggered prefetch of that guide,
 * extended to keyboard focus and touch so no way of reaching a link is
 * slower than another.
 *
 * `prefetch` is not a prop: a link that must never fetch ahead of a click
 * (the sensitive-result reveal) uses `next/link` with `prefetch={false}`.
 */
export function IntentLink({ onMouseEnter, onFocus, onTouchStart, ...props }: Omit<ComponentProps<typeof Link>, "prefetch">) {
  const [intent, setIntent] = useState(false);
  return (
    <Link
      {...props}
      prefetch={intent ? null : false}
      onMouseEnter={(event) => { setIntent(true); onMouseEnter?.(event); }}
      onFocus={(event) => { setIntent(true); onFocus?.(event); }}
      onTouchStart={(event) => { setIntent(true); onTouchStart?.(event); }}
    />
  );
}
