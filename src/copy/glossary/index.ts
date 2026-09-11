import jargon from "../../../data/jargon.json";
import classes from "../../../data/glossary-citation-classes.json";

/**
 * The glossary the brief asks for in three places (lines 708, 825, 884), and
 * the definitions it holds were already written — they simply had no reader.
 *
 * `data/jargon.json` carries 110 terms, each with a one-to-25-word definition
 * that `scripts/readability-gate.ts` already enforces. Until now it was used
 * only to substitute placeholders before Flesch-Kincaid scoring, so every
 * definition existed and none of them was ever shown to anybody. Measured
 * 2026-09-11: **53 of those terms appear in the shipped copy** — `variant` in
 * twelve files, `coverage` in nine, `polygenic` in six — each one a word a
 * beginner may not know, on screen, with an explanation sitting unused in the
 * repository.
 *
 * So this module does not write a second glossary. It reads the one that
 * exists, which is the only way the two cannot drift: a term whose definition
 * changes for the readability gate changes here in the same commit, and there
 * is no second file for anyone to forget.
 */

export interface GlossaryEntry {
  term: string;
  definition: string;
  aliases: readonly string[];
  /**
   * `plain` renders to a reader now. `cited` does not, and will not until its
   * definition carries a resolvable citationId: brief line 2570 designates a
   * glossary definition as a surface that needs one, and a definition that
   * names a disease, describes clinical practice, or defines a quantity drawn
   * from data is exactly the kind that must not appear uncited.
   *
   * The split is the operator's decision of 2026-09-11 and the line is drawn
   * per term in `data/glossary-citation-classes.json`, with the reason
   * recorded beside every cited one.
   */
  citationClass: "plain" | "cited";
}

const CLASS_OF: ReadonlyMap<string, "plain" | "cited"> = new Map(
  (classes as { terms: { term: string; class: "plain" | "cited" }[] }).terms
    .map((entry) => [entry.term, entry.class] as const),
);

const ENTRIES: readonly GlossaryEntry[] = (jargon as {
  terms: { term: string; definition: string; aliases?: string[] }[];
}).terms.map((entry) => ({
  term: entry.term,
  definition: entry.definition,
  aliases: Object.freeze([...(entry.aliases ?? [])]),
  // An unclassified term reads as `cited`, so a term added to the register
  // without a decision stays invisible rather than shipping uncited by
  // omission. `glossary-classes.test.ts` fails on that case rather than
  // relying on this, but the default has to be the safe one either way.
  citationClass: CLASS_OF.get(entry.term) ?? "cited",
}));

/** Every term and alias, lowercased, to the entry that defines it. */
const BY_LOOKUP: ReadonlyMap<string, GlossaryEntry> = new Map(
  ENTRIES.flatMap((entry) =>
    [entry.term, ...entry.aliases].map((name) => [name.toLowerCase(), entry] as const),
  ),
);

export const glossaryEntries = (): readonly GlossaryEntry[] => ENTRIES;

/**
 * The entries a reader may actually be shown. Everything that renders a gloss
 * reads this rather than `glossaryEntries`, so a term can only reach a page by
 * being classified `plain` on purpose.
 */
export const renderableGlossaryEntries = (): readonly GlossaryEntry[] =>
  ENTRIES.filter((entry) => entry.citationClass === "plain");

/**
 * The entry for a term or any of its aliases, or null. Case-insensitive,
 * because copy writes "Variant" at the start of a sentence and "variant"
 * inside one, and a gloss that only matched the lowercase form would silently
 * explain a word in one place and not the next.
 */
export function glossaryEntry(name: string): GlossaryEntry | null {
  return BY_LOOKUP.get(name.trim().toLowerCase()) ?? null;
}
