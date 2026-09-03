// Small, pure formatting helpers for Overview counts and durations. Every
// number the page renders passes through here so it always carries a unit
// noun and an explicit singular form (Intl.PluralRules, "en").

const plural = new Intl.PluralRules("en");

export function pluralise(n: number, singular: string, pluralForm: string): string {
  return plural.select(n) === "one" ? singular : pluralForm;
}

/** "1 file" / "3 files". */
export function countNoun(n: number, singular: string, pluralForm: string): string {
  return `${n} ${pluralise(n, singular, pluralForm)}`;
}

/**
 * A measured duration in seconds as plain words: "40 seconds", "1 minute",
 * "12 minutes", "2 hours". Rounds to the nearest unit; never "0 minutes".
 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return countNoun(Math.max(1, s), "second", "seconds");
  const minutes = Math.round(s / 60);
  if (minutes < 60) return countNoun(Math.max(1, minutes), "minute", "minutes");
  const hours = Math.round(minutes / 60);
  return countNoun(Math.max(1, hours), "hour", "hours");
}

/** First letter of a display label, for the identity disc. */
export function initialOf(label: string): string {
  const trimmed = label.trim();
  return trimmed.length > 0 ? [...trimmed][0].toUpperCase() : "?";
}
