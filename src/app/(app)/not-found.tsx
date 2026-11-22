import { NotFoundContent } from "@/components/site/not-found-content";

/**
 * This group's layout already supplies the one `<main id="main">`, so this
 * boundary renders the body alone. Bringing another landmark here produced two
 * `main` elements and a duplicate `id` on the same document; see
 * `src/components/site/not-found-content.tsx`.
 *
 * `resource-not-found-page-v1` names `no-referrer` for this answer, and the
 * register binds it to every resource-authorized page of this group
 * (`resourceAuthorizationBindings`). By the owner's decision of 22 November
 * 2026 ("Twenty signed-in pages keep `same-origin`; the not-found contract's
 * header binds its own answer") the policy belongs to this answer only, not to
 * the page's other answers. The proxy sets every header before the page
 * decides to answer not-found, and a page cannot change a response header, so
 * the proxy's `same-origin` stays on the response and this element sets the
 * document's own policy to `no-referrer` (React places it in the head). The
 * pages the register already gives `no-referrer` on every answer are
 * unaffected.
 */
export default function NotFound() {
  return (
    <>
      <meta name="referrer" content="no-referrer" />
      <NotFoundContent />
    </>
  );
}
