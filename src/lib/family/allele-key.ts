/**
 * Exact allele keys for carrier assertions (docs/carrier-importer-design.md,
 * point 3). A key is a chromosome, a 1-based position, the reference letters
 * and the changed letters, spelt the way a VCF spells them. A label applies
 * to exactly one key and never to every change at an rsID.
 *
 * Only simple, parsimonious changes are keyed: one letter for one letter, or
 * an insertion or deletion that shares exactly its first letter (the anchor)
 * with the other spelling. Anything else (a multi-letter substitution, a
 * complex change, a symbolic allele) has more than one reasonable spelling and
 * is not keyed at all, so it can never be matched by accident.
 *
 * Pure functions with no imports, so the importer (`scripts/`), the reader
 * (`./carrier-assertions`) and the database checks share one definition.
 */

export interface AlleleKey {
  chrom: number;
  pos: number;
  ref: string;
  alt: string;
}

export type AlleleShape = "snv" | "deletion" | "insertion";

const BASES = /^[ACGT]+$/;

/** The shape of a simple, parsimonious change, or null for anything else. */
export function alleleShape(ref: string, alt: string): AlleleShape | null {
  if (!BASES.test(ref) || !BASES.test(alt) || ref === alt) return null;
  if (ref.length === 1 && alt.length === 1) return "snv";
  if (alt.length === 1 && ref.length > 1 && ref[0] === alt) return "deletion";
  if (ref.length === 1 && alt.length > 1 && alt[0] === ref) return "insertion";
  return null;
}

/**
 * Whether a simple change is left-aligned. An insertion or deletion can move
 * one base to the left exactly when its anchor equals the last base it adds
 * or removes, so this needs only the change's own letters and no reference
 * sequence. A single-letter change is always left-aligned.
 */
export function isLeftAligned(ref: string, alt: string): boolean {
  const shape = alleleShape(ref, alt);
  if (shape === null) return false;
  if (shape === "snv") return true;
  const changed = shape === "deletion" ? ref.slice(1) : alt.slice(1);
  return ref[0] !== changed[changed.length - 1];
}

/** A stretch of reference sequence: `sequence[0]` is the base at `start` (1-based). */
export interface ReferenceWindow {
  start: number;
  sequence: string;
}

export class AlleleKeyError extends Error {}

function baseAt(window: ReferenceWindow, pos: number): string {
  const index = pos - window.start;
  if (index < 0 || index >= window.sequence.length) {
    throw new AlleleKeyError(`position ${pos} is outside the reference window`);
  }
  return window.sequence[index];
}

/**
 * Every other spelling of a left-aligned insertion or deletion inside a run
 * of repeated sequence: the same change written one, two or more bases to
 * the right. A file whose caller did not left-align writes one of these, and
 * it is the same change. The window must reach past the last spelling; a
 * change that runs off the window is an error, never a shorter answer.
 *
 * The reference letters at the key must equal the window's, so a key that
 * disagrees with the reference sequence is refused rather than shifted.
 */
export function rightShiftedKeys(key: AlleleKey, window: ReferenceWindow): AlleleKey[] {
  const shape = alleleShape(key.ref, key.alt);
  if (shape === null) throw new AlleleKeyError("not a simple change");
  for (let offset = 0; offset < key.ref.length; offset++) {
    if (baseAt(window, key.pos + offset) !== key.ref[offset]) {
      throw new AlleleKeyError(`reference letters disagree at ${key.chrom}:${key.pos}`);
    }
  }
  if (shape === "snv") return [];
  if (!isLeftAligned(key.ref, key.alt)) throw new AlleleKeyError("not left-aligned");
  const shifted: AlleleKey[] = [];
  if (shape === "deletion") {
    const length = key.ref.length - 1;
    let anchor = key.pos;
    // The deleted stretch is anchor+1 .. anchor+length; it moves right while
    // its first base equals the base just after it.
    while (baseAt(window, anchor + 1) === baseAt(window, anchor + length + 1)) {
      anchor += 1;
      let ref = "";
      for (let offset = 0; offset <= length; offset++) ref += baseAt(window, anchor + offset);
      shifted.push({ chrom: key.chrom, pos: anchor, ref, alt: ref[0] });
    }
    return shifted;
  }
  let inserted = key.alt.slice(1);
  let anchor = key.pos;
  // The inserted letters sit after the anchor; they move right while the
  // next reference base equals their first letter, rotating as they go.
  while (baseAt(window, anchor + 1) === inserted[0]) {
    anchor += 1;
    inserted = inserted.slice(1) + inserted[0];
    const base = baseAt(window, anchor);
    shifted.push({ chrom: key.chrom, pos: anchor, ref: base, alt: base + inserted });
  }
  return shifted;
}
