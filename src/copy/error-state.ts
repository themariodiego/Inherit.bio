/**
 * The error surface. Plain English, grade ≤ 9, second person, typographic
 * apostrophes (U+2019).
 *
 * The register's one definition of this state is
 * `stateProfiles["public-embryo-analysis"].stateProjection.error` —
 * "show-the-public-safe-retry-and-rights-navigation-state" — and that is what
 * this copy is built from: public-safe (it reveals nothing of the failure),
 * retry (the boundary's own `reset()`), and rights navigation (the same three
 * links the not-found surface offers).
 *
 * "Public-safe" is the load-bearing word. An error's text can carry query
 * parameters, identifiers, row contents or file names, so the detail is
 * withheld and the page says that it is withholding and why, rather than
 * showing a bare framework message that says nothing at all. Nothing here
 * reassures the reader that their data is intact: a render error says nothing
 * about what did or did not persist, and inventing that comfort would be the
 * missing-data reassurance this product forbids.
 */
export { NOT_FOUND_LINKS as ERROR_LINKS } from "./not-found";

/** First heading: plain, short, and true whatever failed underneath. */
export const ERROR_HEADING = "This page did not load";

/** Whose fault it is, which is the first thing a reader wants to know. */
export const ERROR_LEAD =
  "Inherit could not finish building this page. This is a fault in Inherit, not something you did, and not a problem with your file.";

/** Why no detail is shown — stated, rather than left as a blank framework page. */
export const ERROR_WITHHELD =
  "The technical detail is not shown here, because the text of an error can carry parts of your data.";

/** What to do next. Deliberately promises nothing about what was saved. */
export const ERROR_NEXT =
  "You can try loading it again. If it keeps failing, the links below still work.";

/** The retry control, which calls the boundary’s own reset. */
export const ERROR_RETRY_LABEL = "Try again";
