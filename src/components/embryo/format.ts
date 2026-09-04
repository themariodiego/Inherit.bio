/**
 * The one date format the Embryo surfaces print: "3 September 2026", the
 * form the Family tombstone already uses. Dates are UI chrome, never figures.
 */
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

export function formatDate(iso: string): string {
  return DATE.format(new Date(iso));
}
