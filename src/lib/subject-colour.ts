/**
 * Subject identity colour (brief X2.4): one of the eight `--subject-N`
 * tokens in src/app/globals.css, chosen by a stable hash of the subject id
 * so a subject keeps its colour across sessions and devices. The self
 * subject always uses token 0. Colour never carries identity alone: the disc
 * also shows the initial as text, and the display name sits beside it.
 */

export const SUBJECT_COLOUR_COUNT = 8;

/** FNV-1a 32-bit over the UTF-16 code units of `value`. */
export function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function subjectColourIndex(subject: { id: string; subjectClass: string }): number {
  if (subject.subjectClass === "self") return 0;
  return stableHash(subject.id) % SUBJECT_COLOUR_COUNT;
}

/** The first letter of a display name, upper-cased; "?" for an empty name. */
export function subjectInitial(displayLabel: string): string {
  const first = displayLabel.trim().charAt(0);
  return first ? first.toLocaleUpperCase("en-GB") : "?";
}
