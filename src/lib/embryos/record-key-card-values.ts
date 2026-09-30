/** Pure card values shared by the server producer and browser receipt reader.
 * Origin generation remains in the server-only record-key-cards module. */
export const RECORD_KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RECORD_KEY_PATTERN = /^[0-9A-HJKMNP-TV-Z]{20}$/;

export function isRecordKey(value: string): boolean {
  return RECORD_KEY_PATTERN.test(value);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The parts of a calendar date written as `YYYY-MM-DD`, or null when it is not one. */
export function calendarDate(iso: string): { year: number; month: number; day: number } | null {
  const match = ISO_DATE_PATTERN.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? { year, month, day } : null;
}

/**
 * The closing date as the card prints it: "5 September 2028". The day has
 * no leading zero, the month is its English name and the year has four
 * digits. Rendered by hand rather than by a locale so every runtime prints
 * the same words. A value that is not a calendar date is a defect upstream
 * and throws rather than printing the wrong date on a card.
 */
export function closingDateWords(iso: string): string {
  const date = calendarDate(iso);
  if (!date) throw new RangeError("closing date is not a calendar date");
  return `${date.day} ${MONTHS[date.month - 1]} ${String(date.year).padStart(4, "0")}`;
}

