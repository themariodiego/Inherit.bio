"use client";

import { ErrorContent } from "@/components/site/error-content";

/**
 * This group's layout already supplies the one `<main id="main">`, so this
 * boundary renders the body alone. Bringing another landmark here would put two
 * `main` elements and a duplicate `id` on the same document; see
 * `src/components/site/not-found-content.tsx` for where that was found.
 *
 * "Try again" is the boundary's `retry`, which fetches the segment from the
 * server again and re-renders it. `reset` only re-renders what the browser
 * already holds, which is the same thrown error when a server component
 * failed, such as a sign-in check that failed for a moment (D-142).
 */
export default function GroupError({ retry }: { error: Error & { digest?: string }; reset: () => void; retry: () => void }) {
  return <ErrorContent reset={retry} />;
}
