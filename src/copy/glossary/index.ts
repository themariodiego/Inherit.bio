import jargon from "../../../data/jargon.json";

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
}

const ENTRIES: readonly GlossaryEntry[] = (jargon as {
  terms: { term: string; definition: string; aliases?: string[] }[];
}).terms.map((entry) => ({
  term: entry.term,
  definition: entry.definition,
  aliases: Object.freeze([...(entry.aliases ?? [])]),
}));

/** Every term and alias, lowercased, to the entry that defines it. */
const BY_LOOKUP: ReadonlyMap<string, GlossaryEntry> = new Map(
  ENTRIES.flatMap((entry) =>
    [entry.term, ...entry.aliases].map((name) => [name.toLowerCase(), entry] as const),
  ),
);

export const glossaryEntries = (): readonly GlossaryEntry[] => ENTRIES;

/**
 * The entry for a term or any of its aliases, or null. Case-insensitive,
 * because copy writes "Variant" at the start of a sentence and "variant"
 * inside one, and a gloss that only matched the lowercase form would silently
 * explain a word in one place and not the next.
 */
export function glossaryEntry(name: string): GlossaryEntry | null {
  return BY_LOOKUP.get(name.trim().toLowerCase()) ?? null;
}
