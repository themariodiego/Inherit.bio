import "server-only";

import { genotypeKey } from "@/lib/genome/reports";
import { getSubjectCallsAtLoci, getSubjectGenotypesByRsid, type Db } from "@/lib/genome/load";
import { assertionLoci, carrierReference, exactGenotypes, parseCarrierAssertionRows } from "./carrier-assertions";
import { readSubjectRuns, subjectRunsState, type StoredRohMeasure } from "./roh";
import { xLinkedRoles, type DeclaredChromosomalSex } from "./chromosomal-sex";
import { autosomalCross, xLinkedCross, type MendelCross } from "./mendel";

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
 * Every number this module produces is counted from equally likely gametes
 * in ./mendel, which is arithmetic, not a statistic: no frequency,
 * penetrance, prevalence or threshold is read from anywhere but the brief's
 * own two runs numbers in ./roh.
 */

/** The one Mendelian fraction this module can produce (brief §3 §8.4). */
export const BOTH_CHANGED_COPIES_PROBABILITY = 0.25;

/**
 * What the reviewed assertion behind a reading says, printed beside the
 * finding as the brief requires (line 1335): the variant, its ClinVar review
 * status and the date ClinVar last evaluated it.
 */
export interface CarrierEvidence {
  variantName: string;
  reviewStatus: string;
  reviewStars: number;
  /** ISO date, or null where ClinVar records none. */
  lastEvaluated: string | null;
  /** `unestablished` renders the brief's exact not-established label (line 1332). */
  penetranceClass: "high" | "moderate" | "low" | "unestablished";
  releaseId: string;
  /** The date of the ClinGen snapshot the release was imported with. */
  geneValidityReadOn: string;
  variationId: number;
}

/** An exact allele key and the other spellings of the same insertion or deletion. */
export interface CarrierAlleleKey {
  chrom: number;
  pos: number;
  ref: string;
  alt: string;
  equivalents: readonly { pos: number; ref: string; alt: string }[];
}

/**
 * One reference row, as the candidate set reads it.
 *
 * `rsid` is the key the rule groups and reads by. The synthetic rule tests
 * key by rsID; the production reader (`./carrier-assertions`) keys every row
 * by its assertion id and sets `key`, so a file is read by exact allele and
 * an rsID never selects anything (docs/carrier-importer-design.md, point 3).
 */
export interface CarrierRefVariant {
  rsid: number;
  geneSymbol: string | null;
  /** The changed letters the classification is about. */
  alt: string | null;
  /** Null means the position has no clinical classification: never a candidate. */
  clinvarSignificance: string | null;
  /** Present on every production row: the exact allele, read against the assertion's own letters. */
  key?: CarrierAlleleKey;
  /** Present on every production row: what the reviewed assertion says. */
  evidence?: CarrierEvidence;
  /** Present on every production row: the reviewed condition the assertion belongs to. */
  condition?: CarrierCondition;
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
 * three for an X-linked pattern the rule cannot split, `two-copies` for a
 * file that shows two changed copies rather than one, `not-covered` for a
 * file that does not report the other person's position (never imputed,
 * brief line 1349), and the two runs answers told apart:
 * `runs-above-threshold` for a file Inherit measured and found above a
 * threshold, `runs-unchecked` for a person whose runs were not established
 * at all.
 *
 * The three X-linked reasons are kept apart because they are three
 * different facts about the pair and the reader can act on each
 * differently (D-031): `sex-unknown` means at least one of the two has
 * declared nothing, and declaring would change the answer;
 * `sex-pattern-unsupported` means both have declared and the split Inherit
 * computes is not derived for what they declared, which no further
 * declaration fixes; `sex-reading-conflict` means a file reads a change on
 * the X in a way that does not fit the chromosomal sex recorded for that
 * person, which is a fact about the file, not about the person.
 */
export const CARRIER_REASONS = [
  "dominant",
  "harmless",
  "unknown-meaning",
  "copies-unknown",
  "no-pattern",
  "sex-unknown",
  "sex-pattern-unsupported",
  "sex-reading-conflict",
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
  /**
   * What this person declared about their own chromosomes, or null where
   * they declared nothing. Never derived from their file (D-031): the rule
   * reads the declaration or refuses.
   */
  chromosomalSex: DeclaredChromosomalSex;
}

/** One person's own change in the gene: the variant the block names for them. */
export interface CarrierVariantReading {
  rsid: number;
  /** The classification exactly as the reference row records it. */
  classification: string;
  genotype: string;
  copies: CarrierCopies;
  /** The reviewed assertion behind the reading, where the row came from one. */
  evidence?: CarrierEvidence;
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
  | (CarrierMatchCommon & {
      kind: "probability";
      /**
       * The one recessive fraction, kept for the health picture's own
       * sentence. It is present only on an autosomal-recessive cross: an
       * X-linked split has no single number, and a `probability` that
       * pretended otherwise is exactly the mistake `cross` exists to stop.
       */
      probability: number | null;
      /** The arithmetic this match follows, chosen by the rule (D-031). */
      cross: MendelCross;
    })
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

/**
 * The same count for an exact allele. The reader has already rewritten the
 * file's letters into the assertion's own spelling, so each copy is one
 * allele of the genotype, whatever its length: "ATCT/A" is one copy of the
 * deletion `ATCT>A`. An allele that is neither spelling is a copy that is
 * not this change.
 */
export function exactCopiesShown(genotype: string, key: Pick<CarrierAlleleKey, "ref" | "alt">): CarrierCopies | null {
  if (genotype === "--") return "copies not shown";
  const alleles = genotype.split("/");
  if (alleles.some((allele) => !/^[ACGT]+$/.test(allele))) return "copies not shown";
  const changed = alleles.filter((allele) => allele === key.alt).length;
  if (alleles.length === 1) return changed === 1 ? "copies not shown" : null;
  if (alleles.length !== 2) return null;
  return changed === 2 ? "two copies" : changed === 1 ? "one copy" : null;
}

/** How many changed copies a file shows at one reference row: by exact allele where the row has one. */
export function copiesShownFor(variant: CarrierRefVariant, genotype: string): CarrierCopies | null {
  return variant.key ? exactCopiesShown(genotype, variant.key) : copiesShown(genotype, variant.alt);
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
    const copies = copiesShownFor(variant, genotype);
    if (copies === null) continue;
    const reading: CarrierVariantReading = {
      rsid: variant.rsid,
      classification: variant.clinvarSignificance.trim(),
      genotype,
      copies,
      ...(variant.evidence ? { evidence: variant.evidence } : {}),
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

/**
 * The X-linked cross for a pair both of whom declared a chromosomal sex, or
 * the reason there is none (D-031).
 *
 * The father's side is the delicate half. An XY person has one X, so a file
 * that reports a changed copy at an X-linked position under the usual diploid
 * convention shows it as `two copies` — that is one changed X, hemizygous,
 * and `FatherCopies = 1`. A file that reports `one copy` for the same person
 * is claiming a heterozygous call on a chromosome they have one of. Inherit
 * does not pick a winner between the declaration and the file: it names the
 * disagreement and prints no number (`sex-reading-conflict`).
 *
 * The mother's side has no such ambiguity: an XX person's `one copy` is one
 * changed X of two and `two copies` is both.
 */
function xLinkedCrossFor(
  a: CarrierPerson,
  b: CarrierPerson,
  readingA: CarrierVariantReading,
  readingB: CarrierVariantReading,
): { cross: MendelCross } | { reason: CarrierReason } {
  const roles = xLinkedRoles(a, b);
  if ("refusal" in roles) return { reason: roles.refusal };
  const readingOf = (dataSubjectId: string) =>
    dataSubjectId === a.dataSubjectId ? readingA : readingB;
  const motherReading = readingOf(roles.mother);
  const fatherReading = readingOf(roles.father);
  if (fatherReading.copies !== "two copies") return { reason: "sex-reading-conflict" };
  return { cross: xLinkedCross(motherReading.copies === "two copies" ? 2 : 1, 1) };
}

/**
 * The cross a pair earns, or the one reason it does not. A cross rather than
 * a bare `null` so the rule, not a component, decides which arithmetic a
 * match follows.
 */
function crossFor(
  condition: CarrierCondition | null,
  a: CarrierPerson,
  b: CarrierPerson,
  readingA: CarrierVariantReading,
  readingB: CarrierVariantReading,
): { cross: MendelCross } | { reason: CarrierReason } {
  // A file that does not show how many copies it read cannot support any of
  // the questions below, so it is answered first.
  if (readingA.copies === "copies not shown" || readingB.copies === "copies not shown") {
    return { reason: "copies-unknown" };
  }
  const classifications = [readingA.classification, readingB.classification];
  if (classifications.some(isHarmlessClassification)) return { reason: "harmless" };
  if (!classifications.every(isPathogenicClassification)) return { reason: "unknown-meaning" };

  const mode = condition === null ? null : normalise(condition.inheritanceMode ?? "");
  if (mode === "autosomal_dominant") return { reason: "dominant" };
  if (mode !== "x_linked" && mode !== "autosomal_recessive") return { reason: "no-pattern" };

  // An X-linked pattern: the hundred-pregnancy split (brief line 346) needs
  // which parent carries the change on the X. Since D-031 that is answerable
  // when both people have declared their own chromosomal sex, and only then.
  // Nothing is read from the Y positions a file happens to hold: those are a
  // fact about a file, not a declaration by a person.
  //
  // `two-copies` is an autosomal-recessive refusal and is not applied here.
  // An XX parent with both X copies changed is arithmetic the cross already
  // handles, and an XY parent's hemizygous call is the normal case, not a
  // reason to withhold.
  const chosen =
    mode === "x_linked"
      ? xLinkedCrossFor(a, b, readingA, readingB)
      : // Two changed copies in either file: every child gets one from that
        // parent, so 1 in 4 is not the arithmetic. The panel names it rather
        // than dropping the pair (brief line 346, D-035).
        readingA.copies === "two copies" || readingB.copies === "two copies"
        ? { reason: "two-copies" as CarrierReason }
        : { cross: autosomalCross("autosomal_recessive", 1, 1) };
  if ("reason" in chosen) return chosen;

  // Each file must report the other person's position; nothing is imputed.
  if (uncoveredPosition(a, b, readingA, readingB) !== null) return { reason: "not-covered" };

  // Each person's files are asked on their own; the two are never compared.
  // A measured file above a threshold is the brief's refusal; a person whose
  // runs were never established is a different, weaker answer.
  const states = [subjectRunsState(a.runs), subjectRunsState(b.runs)];
  if (states.includes("above")) return { reason: "runs-above-threshold" };
  if (states.includes("unchecked")) return { reason: "runs-unchecked" };
  return chosen;
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

    const chosen = crossFor(condition, a, b, readingA, readingB);
    matches.push(
      "cross" in chosen
        ? {
            ...common,
            kind: "probability",
            probability:
              chosen.cross.pattern === "autosomal_recessive"
                ? BOTH_CHANGED_COPIES_PROBABILITY
                : null,
            cross: chosen.cross,
          }
        : {
            ...common,
            kind: "no-probability",
            reason: chosen.reason,
            uncovered: chosen.reason === "not-covered" ? uncovered : null,
          },
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
// request time). The rows come only from the reviewed assertion rule in the
// database (`./carrier-assertions`); legacy rsID labels in `ref_variants` and
// `condition_registry` are never read for a carrier result. No genotype or
// runs measure is read for an empty classified set, and the panel states
// that it has nothing to check yet.
// ---------------------------------------------------------------------------

/**
 * The read budget for the reviewed assertion rule, not a scientific
 * threshold: more rows than this and nothing is read at all. The pinned
 * 2026-09 starter list holds 2,850.
 */
export const MAX_CLASSIFIED_POSITIONS = 20_000;

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

type AssertionsRpc = (name: "carrier_assertions_v1") => PromiseLike<{ data: unknown; error: unknown }>;

/**
 * The reviewed assertions the database rule admits, as reference rows keyed
 * by assertion id and exact allele. Anything the rule refuses never arrives;
 * a malformed or oversized answer, or a failed read, is read as nothing at
 * all, which every surface states as "cannot check yet", never as negative.
 */
export async function readClassifiedVariants(supabase: Db): Promise<CarrierRefVariant[]> {
  try {
    const response = await (supabase.rpc.bind(supabase) as unknown as AssertionsRpc)("carrier_assertions_v1");
    const rows = response.error ? null : parseCarrierAssertionRows(response.data);
    if (!rows || rows.length > MAX_CLASSIFIED_POSITIONS) return [];
    return carrierReference(rows).refVariants;
  } catch {
    return [];
  }
}

/**
 * The conditions of the rows the rule admitted: each reviewed, active and
 * carrying its stored inheritance mode. Taken from the same rows, so a
 * condition and its assertions are always one read.
 */
export async function readCarrierConditions(
  supabase: Db,
  refVariants: readonly CarrierRefVariant[] = [],
): Promise<CarrierCondition[]> {
  void supabase;
  const conditions = new Map<string, CarrierCondition>();
  for (const variant of refVariants) {
    const condition = variant.condition;
    if (condition && !conditions.has(condition.conditionId)) conditions.set(condition.conditionId, condition);
  }
  return [...conditions.values()];
}

export interface CarrierPairPerson {
  dataSubjectId: string;
  displayLabel: string;
  /** Read once by the caller through `./chromosomal-sex`, under the pair's own authority. */
  chromosomalSex: DeclaredChromosomalSex;
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
  legacyFileIds?: { a: readonly string[]; b: readonly string[] },
): Promise<CarrierPairSummary> {
  const classifiedPositions = refVariants.length;
  if (classifiedPositions === 0) {
    return { matches: [], classifiedPositions, positionsBothCover: 0, genotypes: NO_GENOTYPES };
  }
  // Reviewed rows are read by exact allele at their own loci; only the
  // rule tests' synthetic rows, which carry no key, are read by rsID.
  const exact = refVariants.every((variant) => variant.key !== undefined);
  const read = async (subjectId: string, files?: readonly string[]) => {
    if (!exact) return getSubjectGenotypesByRsid(supabase, subjectId, refVariants.map((variant) => variant.rsid), files);
    const calls = await getSubjectCallsAtLoci(supabase, subjectId, assertionLoci(refVariants), files);
    const readings = exactGenotypes(refVariants, calls.calls);
    return { genotypes: readings.genotypes, inputFileIds: calls.inputFileIds, checkedFileIds: calls.checkedFileIds,
      inputFilesByRsid: readings.inputFilesByKey };
  };
  const [readA, readB] = await Promise.all([
    read(a.dataSubjectId, legacyFileIds?.a),
    read(b.dataSubjectId, legacyFileIds?.b),
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
    readSubjectRuns(supabase, a.dataSubjectId, runsInputsA, legacyFileIds?.a),
    readSubjectRuns(supabase, b.dataSubjectId, runsInputsB, legacyFileIds?.b),
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
