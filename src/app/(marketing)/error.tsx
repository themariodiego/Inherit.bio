"use client";

import { ErrorContent } from "@/components/site/error-content";

/**
 * This group's layout already supplies the one `<main id="main">`, so this
 * boundary renders the body alone. Bringing another landmark here would put two
 * `main` elements and a duplicate `id` on the same document; see
 * `src/components/site/not-found-content.tsx` for where that was found.
 */
export default function GroupError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorContent reset={reset} />;
}
