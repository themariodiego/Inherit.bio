import { NotFoundContent } from "@/components/site/not-found-content";

/**
 * This group's layout already supplies the one `<main id="main">`, so this
 * boundary renders the body alone. Bringing another landmark here produced two
 * `main` elements and a duplicate `id` on the same document; see
 * `src/components/site/not-found-content.tsx`.
 */
export default function NotFound() {
  return <NotFoundContent />;
}
