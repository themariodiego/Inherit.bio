import "server-only";

import { genotypeKey } from "@/lib/genome/reports";
import { getSubjectGenotypesByRsid, type Db } from "@/lib/genome/load";
import { readSubjectRuns, subjectRunsState, type StoredRohMeasure } from "./roh";

/**
 * Carrier pairs: the one home of the trigger rule (design §2.3; brief line
 * 346, §3 §8.4, §4 §5.3, X16.3; ADR 0017 §5). Pure functions over plain
 * rows, so the whole rule is decided in one place and proved without a
 * database.
 *
 * The question is narrow and the answer is narrow. Each person's file
 * reports a change in the same gene; a clinical classification exists for
 * each change; a registry says how changes in that gene are passed on. Only
 * when all of that lines up — each file reads one changed copy and one
 * unchanged copy of a change classed pathogenic or likely pathogenic, the
 * pattern is autosomal recessive, and every file of each person on its own
 * sits below the runs threshold, and each file covers the other's position
 * — does a probability exist, and it is the single Mendelian fraction 1 in
 * 4. Every other case renders no number at all and says which of the ten
 * named reasons applies. A failed trigger never drops a pair from the panel
 * (brief line 346).
 *
 * The trigger is gene-level, as the brief says: the two changes may sit at
 * the same position or at different positions in the gene, and the block
 * names each person's own variant and classification.
 *
 * **Nothing here is a relatedness quantity.** The two files are read one
 * classified position at a time for what each reports, which is what the
 * panel above says it does. No shared-DNA length, centimorgan count, IBD
 * segment, kinship coefficient or relationship label is computed or could
 * be: the runs measure each file carries is read on its own
 * (`subjectRunsBelowThreshold` takes one person's files), never against
 * the other person's (X15, brief line 348, acceptance 20).
 *
 * The only number this module produces is 1 in 4, which is arithmetic, not
 * a statistic: no frequency, penetrance, prevalence or threshold is read
 * from anywhere but the brief's own two runs numbers in ./roh.
 */

/** The one Mendelian fraction this module can produce (brief §3 §8.4). */
export const BOTH_CHANGED_COPIES_PROBABILITY = 0.25;

/** One reference-variant row, as the candidate set reads it. */
export interface CarrierRefVariant {
  rsid: number;
  geneSymbol: string | null;
  /** The changed letter the classification is about. */
  alt: string | null;
  /** Null means the position has no clinical classification: never a candidate. */
  clinvarSignificance: string | null;
}

/** One condition-registry row, joined through `gene_symbols` (X16.3). */
export interface CarrierCondition {
  conditionId: string;
  conditionName: string;
  geneSymbols: readonly string[];
  /** Null, `other` or `unknown` all mean Inherit has no recorded pattern. */
  inheritanceMode: string | null;
}

/** How each person's own file reads at the position, in words the panel prints. */
export type CarrierCopies = "one copy" | "two copies" | "copies not shown";

/**
 * The closed reason table (design §2.3; ADR 0017 §5-6): the design's six,
 * `sex-unknown` for an X-linked pattern, `two-copies` for a file that shows
 * two changed copies rather than one, `not-covered` for a file that does
 * not report the other person's position (never imputed, brief line 1349),
 * and the two runs answers told apart: `runs-above-threshold` for a file
 * Inherit measured and found above a threshold, `runs-unchecked` for a
 * person whose runs were not established at all.
 */
export const CARRIER_REASONS = [
  "dominant",
  "harmless",
  "unknown-meaning",
  "copies-unknown",
  "no-pattern",
  "sex-unknown",
  "two-copies",
  "not-covered",
  "runs-above-threshold",
  "runs-unchecked",
] as const;

export type CarrierReason = (typeof CARRIER_REASONS)[number];

export interface CarrierPerson {
  /** The subject whose rows were read: the counterpart's own self subject. */
  dataSubjectId: string;
  displayLabel: string;
  /** rsid → the letters that file reports. */
  genotypes: ReadonlyMap<number, string>;
  /** The stored runs measure of each of that person's own files; never compared with the other person's. */
  runs: readonly StoredRohMeasure[];
}

/** One person's own change in the gene: the variant the block names for them. */
export interface CarrierVariantReading {
  rsid: number;
  /** The classification exactly as the reference row records it. */
  classification: string;
  genotype: string;
  copies: CarrierCopies;
}

export interface CarrierMatchPerson {
  dataSubjectId: string;
  displayLabel: string;
  variant: CarrierVariantReading;
}

/** A position one person's file does not report: the other person's change. */
export interface UncoveredPosition {
  /** The person whose file does not cover it. */
  dataSubjectId: string;
  rsid: number;
}

interface CarrierMatchCommon {
  gene: string;
  conditionId: string | null;
  conditionName: string | null;
  a: CarrierMatchPerson;
  b: CarrierMatchPerson;
  /** True when each file reports the position the other person's reading names (always true of a probability). */
  positionsBothCovered: boolean;
}

export type CarrierMatch =
  | (CarrierMatchCommon & { kind: "probability"; probability: number })
  | (CarrierMatchCommon & {
      kind: "no-probability";
      reason: CarrierReason;
      /** For `not-covered`: the file and the position it does not report. */
      uncovered: UncoveredPosition | null;
    });

export interface CarrierPairInput {
  a: CarrierPerson;
  b: CarrierPerson;
  refVariants: readonly CarrierRefVariant[];
  conditions: readonly CarrierCondition[];
}

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The words of a classification label. The one writer stores ClinVar's list
 * joined with ", " and ClinVar itself joins with "/" ("Pathogenic/Likely
 * pathogenic"), so a label is split on `/`, `,`, `;` and `|`, trimmed and
 * lower-cased before any word is read (D-033).
 */
export function classificationTokens(label: string): string[] {
  return label
    .split(/[/,;|]/)
    .map((token) => normalise(token).replace(/\s+/g, " "))
    .filter((token) => token.length > 0);
}

const PATHOGENIC_TOKENS = new Set(["pathogenic", "likely pathogenic"]);
const HARMLESS_TOKENS = new Set(["benign", "likely benign"]);

/** Pathogenic only when every word of the label is pathogenic or likely pathogenic. */
export function isPathogenicClassification(significance: string): boolean {
  const tokens = classificationTokens(significance);
  return tokens.length > 0 && tokens.every((token) => PATHOGENIC_TOKENS.has(token));
}

/** Harmless only when every word of the label is benign or likely benign. */
export function isHarmlessClassification(significance: string): boolean {
  const tokens = classificationTokens(significance);
  return tokens.length > 0 && tokens.every((token) => HARMLESS_TOKENS.has(token));
}

/**
 * How many changed copies one file shows. `one copy` needs two readable
 * letters that differ, one of them the changed letter; `two copies` needs
 * both letters to be the changed one; anything a file cannot read as two
 * letters is `copies not shown`.
 */
export function copiesShown(genotype: string, alt: string | null): CarrierCopies | null {
  const changed = alt === null ? null : alt.trim().toUpperCase();
  // A change Inherit cannot name in one letter is never matched against a
  // genotype: it shows no result rather than guessing which letter changed.
  if (changed === null || changed.length !== 1) return null;
  const key = genotypeKey(genotype);
  // A no-call: the position is in the file and the file could not read it.
  if (key === null) return "copies not shown";
  // One letter carries the change but cannot say how many copies were read.
  if (key.length === 1) return key === changed ? "copies not shown" : null;
  if (key.length !== 2) return null;
  const [first, second] = [key[0], key[1]];
  if (first === changed && second === changed) return "two copies";
  if (first === changed || second === changed) return "one copy";
  // The file reads this position and shows no changed copy: this person does
  // not carry the change, so there is no pair to speak about.
  return null;
}

function conditionFor(
  gene: string,
  conditions: readonly CarrierCondition[],
): CarrierCondition | null {
  const wanted = normalise(gene);
  return (
    conditions.find((condition) =>
      condition.geneSymbols.some((symbol) => normalise(symbol) === wanted),
    ) ?? null
  );
}

/** A position is a candidate only with a classification and a gene name to print. */
function isClassified(
  variant: CarrierRefVariant,
): variant is CarrierRefVariant & { geneSymbol: string; clinvarSignificance: string } {
  return (
    variant.clinvarSignificance !== null &&
    variant.clinvarSignificance.trim() !== "" &&
    variant.geneSymbol !== null &&
    variant.geneSymbol.trim() !== ""
  );
}

/**
 * Which of a person's changes in one gene the block names, when their file
 * shows more than one. The order is the trigger's own: a pathogenic or
 * likely pathogenic change before one of unknown meaning before a harmless
 * one, and within a class two changed copies before one before a reading
 * the file cannot give — because two copies of any pathogenic change in
 * the gene means every child gets one, and 1 in 4 would then be false.
 * Ties fall to the lower rsid, so two requests answer alike.
 */
function readingRank(reading: CarrierVariantReading): number {
  const classRank = isPathogenicClassification(reading.classification)
    ? 0
    : isHarmlessClassification(reading.classification)
      ? 2
      : 1;
  const copiesRank =
    reading.copies === "two copies" ? 0 : reading.copies === "one copy" ? 1 : 2;
  return classRank * 3 + copiesRank;
}

/** The change this person's file shows in the gene, or null when it shows none. */
function carriedReading(
  person: CarrierPerson,
  variants: readonly CarrierRefVariant[],
): CarrierVariantReading | null {
  let chosen: CarrierVariantReading | null = null;
  for (const variant of variants) {
    if (!isClassified(variant)) continue;
    const genotype = person.genotypes.get(variant.rsid);
    if (genotype === undefined) continue;
    const copies = copiesShown(genotype, variant.alt);
    if (copies === null) continue;
    const reading: CarrierVariantReading = {
      rsid: variant.rsid,
      classification: variant.clinvarSignificance.trim(),
      genotype,
      copies,
    };
    if (
      chosen === null ||
      readingRank(reading) < readingRank(chosen) ||
      (readingRank(reading) === readingRank(chosen) && reading.rsid < chosen.rsid)
    ) {
      chosen = reading;
    }
  }
  return chosen;
}

/**
 * The position of the other person's reading that this person's file does
 * not report, if any: a probability over a position one file does not
 * cover would be an imputation (brief line 1349), so the arithmetic is
 * refused and the position named. B's gap at A's position is named first.
 */
export function uncoveredPosition(
  a: CarrierPerson,
  b: CarrierPerson,
  readingA: CarrierVariantReading,
  readingB: CarrierVariantReading,
): UncoveredPosition | null {
  if (!b.genotypes.has(readingA.rsid)) return { dataSubjectId: b.dataSubjectId, rsid: readingA.rsid };
  if (!a.genotypes.has(readingB.rsid)) return { dataSubjectId: a.dataSubjectId, rsid: readingB.rsid };
  return null;
}

function reasonFor(
  condition: CarrierCondition | null,
  a: CarrierPerson,
  b: CarrierPerson,
  readingA: CarrierVariantReading,
  readingB: CarrierVariantReading,
): CarrierReason | null {
  // A file that does not show how many copies it read cannot support any of
  // the questions below, so it is answered first.
  if (readingA.copies === "copies not shown" || readingB.copies === "copies not shown") {
    return "copies-unknown";
  }
  const classifications = [readingA.classification, readingB.classification];
  if (classifications.some(isHarmlessClassification)) return "harmless";
  if (!classifications.every(isPathogenicClassification)) return "unknown-meaning";

  const mode = condition === null ? null : normalise(condition.inheritanceMode ?? "");
  if (mode === "autosomal_dominant") return "dominant";
  // An X-linked pattern: the hundred-pregnancy split (brief line 346) needs
  // which parent carries the change on the X, and Inherit records no
  // person's chromosomal sex (`subject_demographics` has no writer; the
  // Y positions a file happens to hold are not a recorded fact about the
  // person). The panel says so rather than printing a fraction that does
  // not apply (ADR 0017 §6, D-031).
  if (mode === "x_linked") return "sex-unknown";
  if (mode !== "autosomal_recessive") return "no-pattern";

  // Two changed copies in either file: every child gets one from that
  // parent, so 1 in 4 is not the arithmetic. The panel names it rather than
  // dropping the pair (brief line 346, D-035).
  if (readingA.copies === "two copies" || readingB.copies === "two copies") return "two-copies";

  // Each file must report the other person's position; nothing is imputed.
  if (uncoveredPosition(a, b, readingA, readingB) !== null) return "not-covered";

  // Each person's files are asked on their own; the two are never compared.
  // A measured file above a threshold is the brief's refusal; a person whose
  // runs were never established is a different, weaker answer.
  const states = [subjectRunsState(a.runs), subjectRunsState(b.runs)];
  if (states.includes("above")) return "runs-above-threshold";
  if (states.includes("unchecked")) return "runs-unchecked";
  return null;
}

/**
 * Every gene both files report a classified change in, with the one
 * probability or the one named reason. Ordered by gene symbol, then by the
 * rsid each person's reading names, so two requests answer alike — and
 * ordered by nothing else: no match is ranked, scored or called worse.
 */
export function evaluateCarrierPairs(input: CarrierPairInput): CarrierMatch[] {
  const { a, b, refVariants, conditions } = input;

  // Classified positions, grouped by gene (X16.3: the registry joins through
  // gene symbols) and ordered by rsid within the gene.
  const byGene = new Map<string, { gene: string; variants: CarrierRefVariant[] }>();
  for (const variant of [...refVariants].sort((left, right) => left.rsid - right.rsid)) {
    if (!isClassified(variant)) continue;
    const gene = variant.geneSymbol.trim();
    const key = normalise(gene);
    const group = byGene.get(key);
    if (group) group.variants.push(variant);
    else byGene.set(key, { gene, variants: [variant] });
  }

  const matches: CarrierMatch[] = [];
  const groups = [...byGene.values()].sort((left, right) =>
    left.gene.localeCompare(right.gene, "en"),
  );
  for (const group of groups) {
    const readingA = carriedReading(a, group.variants);
    const readingB = carriedReading(b, group.variants);
    // One of the two files shows no change in this gene: nothing is shared.
    if (readingA === null || readingB === null) continue;
    // At least one file must actually show a changed copy. Two files that
    // both failed to read the gene's positions share nothing that could be
    // stated: a no-call is not a change.
    if (readingA.copies === "copies not shown" && readingB.copies === "copies not shown") continue;

    const condition = conditionFor(group.gene, conditions);
    const uncovered = uncoveredPosition(a, b, readingA, readingB);
    const common: CarrierMatchCommon = {
      gene: group.gene,
      conditionId: condition?.conditionId ?? null,
      conditionName: condition?.conditionName ?? null,
      a: { dataSubjectId: a.dataSubjectId, displayLabel: a.displayLabel, variant: readingA },
      b: { dataSubjectId: b.dataSubjectId, displayLabel: b.displayLabel, variant: readingB },
      positionsBothCovered: uncovered === null,
    };

    const reason = reasonFor(condition, a, b, readingA, readingB);
    matches.push(
      reason === null
        ? { ...common, kind: "probability", probability: BOTH_CHANGED_COPIES_PROBABILITY }
        : { ...common, kind: "no-probability", reason, uncovered: reason === "not-covered" ? uncovered : null },
    );
  }

  return matches;
}

/** How many matches carry a probability; the Overview line renders only above zero. */
export function countCarrierMatches(matches: readonly CarrierMatch[]): number {
  return matches.filter((match) => match.kind === "probability").length;
}

/**
 * The classified positions both files cover, counted for the empty-panel
 * sentence. It is a count of positions and nothing else: no coverage
 * fraction, no quality score, no comparison between the two people.
 */
export function countPositionsBothCover(
  a: ReadonlyMap<number, string>,
  b: ReadonlyMap<number, string>,
): number {
  let shared = 0;
  for (const rsid of a.keys()) if (b.has(rsid)) shared++;
  return shared;
}

// ---------------------------------------------------------------------------
// Reading the rows the rule decides on (design §5: computed server-side, at
// request time). The legacy classification reader is withheld regardless of
// existing database labels. No genotype or runs measure is read for an empty
// classified set, and the panel states that it has nothing to check yet.
// ---------------------------------------------------------------------------

/**
 * Reserved read budget for a future verified assertion reader, not a
 * scientific threshold. The current legacy reader always returns empty.
 */
export const MAX_CLASSIFIED_POSITIONS = 5_000;

export interface CarrierPairSummary {
  inputFileIds?: { a: string[]; b: string[] };
  checkedFileIds?: { a: string[]; b: string[] };
  inputFilesByGene?: Map<string, { a: string[]; b: string[] }>;
  runsInputFileIds?: { a: string[]; b: string[] };
  matches: CarrierMatch[];
  /** Classified positions in the reference set: zero is the production state today (D-034). */
  classifiedPositions: number;
  /** Classified positions both files cover: the count the empty sentence prints. */
  positionsBothCover: number;
  /**
   * What each file reported at the classified positions, exactly as the rule
   * read them (empty when nothing was read). Portrait reads them again for
   * the one-sided sentences of brief line 2238, so the same read serves both.
   */
  genotypes: { a: ReadonlyMap<number, string>; b: ReadonlyMap<number, string> };
}

const NO_GENOTYPES: CarrierPairSummary["genotypes"] = { a: new Map(), b: new Map() };

/**
 * No row in the legacy rsID reference table carries the allele/condition/
 * assertion provenance this rule needs. Neither seed labels nor old refresh
 * labels may activate personal carrier output. Keep the rule available for
 * verified fixtures, but withhold the production reader until the reviewed
 * clinical assertion importer exists.
 */
export async function readClassifiedVariants(supabase: Db): Promise<CarrierRefVariant[]> {
  void supabase;
  return [];
}

/** Every registry row that names a gene, read once per request. */
export async function readCarrierConditions(supabase: Db): Promise<CarrierCondition[]> {
  const { data } = await supabase
    .from("condition_registry")
    .select("condition_id, condition_name, gene_symbols, inheritance_mode")
    .order("condition_id");
  return (data ?? []).map((row) => ({
    conditionId: row.condition_id,
    conditionName: row.condition_name,
    geneSymbols: row.gene_symbols ?? [],
    inheritanceMode: row.inheritance_mode,
  }));
}

export interface CarrierPairPerson {
  dataSubjectId: string;
  displayLabel: string;
}

/**
 * The whole pipeline for one pair, at request time. Each person's stored
 * runs measures are read from that person's own files and asked about on
 * their own; the two are never compared, and no quantity crossing the two
 * people is produced anywhere in this function.
 */
export async function resolveCarrierPair(
  supabase: Db,
  a: CarrierPairPerson,
  b: CarrierPairPerson,
  refVariants: readonly CarrierRefVariant[],
  conditions: readonly CarrierCondition[],
): Promise<CarrierPairSummary> {
  const classifiedPositions = refVariants.length;
  if (classifiedPositions === 0) {
    return { matches: [], classifiedPositions, positionsBothCover: 0, genotypes: NO_GENOTYPES };
  }
  const rsids = refVariants.map((variant) => variant.rsid);
  const [readA, readB] = await Promise.all([
    getSubjectGenotypesByRsid(supabase, a.dataSubjectId, rsids),
    getSubjectGenotypesByRsid(supabase, b.dataSubjectId, rsids),
  ]);
  const genotypes = { a: readA.genotypes, b: readB.genotypes };
  const inputFileIds = { a: readA.inputFileIds, b: readB.inputFileIds };
  const checkedFileIds = { a: readA.checkedFileIds, b: readB.checkedFileIds };
  const inputFilesByGene = new Map<string, { a: string[]; b: string[] }>();
  for (const variant of refVariants) {
    if (!variant.geneSymbol) continue;
    const current = inputFilesByGene.get(variant.geneSymbol) ?? { a: [], b: [] };
    for (const side of ["a", "b"] as const) {
      const read = side === "a" ? readA : readB;
      current[side] = [...new Set([...current[side], ...(read.inputFilesByRsid.get(variant.rsid) ?? [])])].sort();
    }
    inputFilesByGene.set(variant.geneSymbol, current);
  }
  const positionsBothCover = countPositionsBothCover(readA.genotypes, readB.genotypes);
  if (positionsBothCover === 0) return { matches: [], classifiedPositions, positionsBothCover, genotypes, inputFileIds, checkedFileIds, inputFilesByGene };

  const runsInputsA = new Set<string>(), runsInputsB = new Set<string>();
  const [runsA, runsB] = await Promise.all([
    readSubjectRuns(supabase, a.dataSubjectId, runsInputsA),
    readSubjectRuns(supabase, b.dataSubjectId, runsInputsB),
  ]);

  return {
    matches: evaluateCarrierPairs({
      a: { ...a, genotypes: readA.genotypes, runs: runsA },
      b: { ...b, genotypes: readB.genotypes, runs: runsB },
      refVariants,
      conditions,
    }),
    classifiedPositions,
    positionsBothCover,
    genotypes,
    inputFileIds,
    checkedFileIds,
    inputFilesByGene,
    runsInputFileIds: { a: [...runsInputsA].sort(), b: [...runsInputsB].sort() },
  };
}
