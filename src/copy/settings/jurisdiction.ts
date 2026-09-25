/**
 * The one home of the "where you live" declaration's words (G5.1a, ADR 0032).
 *
 * Three things have to be true of this copy:
 *
 *   1. The answer is the person's, never Inherit's guess. The body says so
 *      before the control, because the only honest reason to ask is that
 *      nothing else may be used to find out.
 *   2. It changes Family and embryo features, not the person's own results.
 *      A reader who fears that a wrong answer costs them their reports should
 *      learn otherwise before choosing.
 *   3. Changing it ends permissions. That consequence is stated before the
 *      save, not discovered on the consents page afterwards.
 *
 * The attestation itself is the published legal text (`attestation.jurisdiction`
 * in `content/legal`); the confirmation line below repeats its one statement.
 */

export const JURISDICTION_HEADING = "Where you live";

export const JURISDICTION_BODY =
  "Some Inherit features depend on the law where you live. Choose the country you live in. Inherit never guesses it from your connection, your browser or your time zone.";

export const JURISDICTION_OWN_RESULTS =
  "Your own DNA results do not depend on this answer.";

/** Shown only while nothing is declared, above the form the first sign-in lands on. */
export const JURISDICTION_REQUIRED =
  "Answer this once before you use Inherit. You can change it here later.";

export const JURISDICTION_SELECT_LABEL = "Country you live in";

/** The empty first option: the selection starts with no country chosen. */
export const JURISDICTION_PLACEHOLDER = "Choose a country";

/** The attestation's one statement, affirmed by the checkbox. */
export const JURISDICTION_AFFIRM = "The country I chose is the country I live in.";

export const JURISDICTION_READ_ATTESTATION = "Read what you are confirming";

export const JURISDICTION_SAVE = "Save country";

export const JURISDICTION_CHANGE_WARNING =
  "Changing your country ends the Family and embryo permissions you gave under your old answer. You are asked again before any of them is used.";

export function jurisdictionCurrent(countryName: string): string {
  return `You told Inherit you live in ${countryName}.`;
}

export const JURISDICTION_SAVED = "Saved.";

export const JURISDICTION_SAVE_FAILED =
  "That did not save. Nothing changed. Try again.";
