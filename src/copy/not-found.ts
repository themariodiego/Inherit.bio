/**
 * The not-found surface. Plain English, grade ≤ 9, second person,
 * typographic apostrophes (U+2019).
 *
 * This page is not only what a mistyped URL reaches. Brief line 477 makes a
 * 404 a **privacy mechanism**: after revocation, `GET` on `/family/[person]`,
 * `/family/health-picture`, `/family/portrait/[pairId]`, `/api/export` and the
 * Copilot history endpoint must return 404 from every account that previously
 * had access. So the same page is shown to someone whose access was withdrawn
 * a moment ago, and it must read the same for them as for a typo.
 *
 * That is why nothing here distinguishes "no such page" from "not yours any
 * more". A sentence like "this genome was deleted" or "you no longer have
 * access to this person" would confirm that a record exists and who it belongs
 * to, which is exactly what the 404 is there to withhold. The page says that it
 * is withholding, and why, rather than pretending there is nothing to say —
 * the same move `src/copy/reports/strings.ts` makes for a position a file
 * cannot read.
 *
 * It also carries no session-dependent content for the same reason: a page
 * that looked different to a signed-in reader would leak by its shape.
 */

/** First heading: plain, short, and true for every reason this page renders. */
export const NOT_FOUND_HEADING = "This page isn’t available";

/** The three reasons, named together so none of them is confirmed. */
export const NOT_FOUND_LEAD =
  "The link may be wrong, it may be out of date, or it may no longer be open to you.";

/** Why Inherit will not say which — stated, not hidden behind a generic error. */
export const NOT_FOUND_WITHHELD =
  "Inherit does not say which of those it is. Saying so could tell you something about another person’s data.";

/** What a reader can actually do next. */
export const NOT_FOUND_NEXT =
  "If someone sent you this link, ask them to check it. If it came from an email, it may have expired.";

/**
 * The links a lost or newly refused reader needs, in the order they need them.
 *
 * Two things about the labels, both found by checking rather than by writing
 * what sounded right. `/privacy` is the route; `/legal/privacy` does not
 * exist, so a page about a dead link would have shipped one of its own. And
 * the middle label is not "Your data rights", because `rights` is not in
 * `data/plain-vocabulary.json` and the readability gate refuses it in a short
 * label — correctly, for a product written for beginners. "What you can ask
 * for" is the same promise in registered words, and it is honest: the page it
 * points at carries a "Your rights and response time" section.
 */
export const NOT_FOUND_LINKS = [
  { href: "/", label: "Go to the home page" },
  { href: "/legal/gdpr", label: "What you can ask for" },
  { href: "/privacy", label: "Privacy policy" },
] as const;
