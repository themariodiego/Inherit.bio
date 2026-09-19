import jargon from "../../../data/jargon.json";
import classes from "../../../data/glossary-citation-classes.json";
import glossaryCitations from "../../../data/glossary-citations.json";

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
   * The 2026-09-11 reading of the definition: `cited` when it names a disease
   * or a disease process, describes clinical practice, or defines a quantity
   * drawn from data; `plain` otherwise. The line is drawn per term in
   * `data/glossary-citation-classes.json`, with the reason beside every cited
   * one.
   *
   * Until 2026-09-19 a `cited` term rendered only once its definition carried
   * a resolvable citationId, because brief line 2570 listed glossary
   * definitions among the surfaces that need one. Owner decision 19
   * (2026-09-18, evening; confirmed 2026-09-19) took them off that list: a
   * definition is not a claim (corrections item 15), so the class no longer
   * decides what renders. It stays as the record of which definitions touch
   * disease, clinical practice or a quantity, the ones whose sources a
   * reviewer attached first.
   */
  citationClass: "plain" | "cited";
  /**
   * The register entry carrying this definition's evidence, or null.
   *
   * From 2026-09-12 to 2026-09-19 this is what let a `cited` term render at
   * all, so sourcing a definition changed what a reader saw. Since decision 19
   * every definition renders and the id is provenance: the evidence a
   * reviewer attached to a definition that touches disease, clinical practice
   * or a quantity, kept checkable by `glossary-classes.test.ts`.
   *
   * Resolved against `data/glossary-citations.json`, which is deliberately not
   * the corpus register: that file is the reviewed report seed, pinned at
   * exactly 71 claims and 19 citations, and it treats a citation no report
   * claim uses as an orphan.
   */
  citationId: string | null;
}

/** The register's ids, so an id naming nothing cannot let a definition through. */
const GLOSSARY_CITATION_IDS: ReadonlySet<string> = new Set(
  (glossaryCitations as { citations: { id: string }[] }).citations.map((citation) => citation.id),
);

const CLASS_OF: ReadonlyMap<string, "plain" | "cited"> = new Map(
  (classes as { terms: { term: string; class: "plain" | "cited" }[] }).terms
    .map((entry) => [entry.term, entry.class] as const),
);

const ENTRIES: readonly GlossaryEntry[] = (jargon as {
  terms: { term: string; definition: string; aliases?: string[]; citationId?: string }[];
}).terms.map((entry) => ({
  term: entry.term,
  definition: entry.definition,
  aliases: Object.freeze([...(entry.aliases ?? [])]),
  // An id that resolves to nothing reads as absent. A typo or a deleted source
  // must return a clinical definition to invisible, never promote one behind a
  // reference that leads nowhere.
  citationId: entry.citationId && GLOSSARY_CITATION_IDS.has(entry.citationId) ? entry.citationId : null,
  // An unclassified term reads as `cited`, so the record never claims a
  // reading nobody made. `glossary-classes.test.ts` fails on an unclassified
  // term rather than relying on this; since decision 19 the class does not
  // decide whether the term renders.
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
 * The entries a reader may be shown: every one of them.
 *
 * Owner decision 19 (2026-09-18, evening; confirmed as a selectable decision
 * on 2026-09-19): a definition is not a claim, so glossary definitions render
 * from `data/jargon.json` without a citation (corrections item 15). From
 * 2026-09-11 to 2026-09-19 this was the `plain` vocabulary plus any `cited`
 * term with a resolving citationId. The function stays as the one place the
 * gloss surface reads, so a rule that withholds a definition again would have
 * one line to change and one test to pass.
 */
export const renderableGlossaryEntries = (): readonly GlossaryEntry[] => ENTRIES;

/**
 * The entry for a term or any of its aliases, or null. Case-insensitive,
 * because copy writes "Variant" at the start of a sentence and "variant"
 * inside one, and a gloss that only matched the lowercase form would silently
 * explain a word in one place and not the next.
 */
export function glossaryEntry(name: string): GlossaryEntry | null {
  return BY_LOOKUP.get(name.trim().toLowerCase()) ?? null;
}
