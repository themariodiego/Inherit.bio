import "server-only";

import { genotypeKey } from "@/lib/genome/reports";
import {
  getSubjectGenotypesByRsid,
  getSubjectProcessedFiles,
  type Db,
} from "@/lib/genome/load";
import { belowRohThreshold, measureSubjectRuns, type RohMeasure } from "./roh";

/**
 * Carrier pairs: the one home of the trigger rule (design §2.3; brief
 * §3 §8.4, §4 §5.3, X16.3). Pure functions over plain rows, so the whole
 * rule is decided in one place and proved without a database.
 *
 * The question is narrow and the answer is narrow. Two people's files both
 * report a change at the same position; a clinical classification exists for
 * that position; a registry says how the change is passed on. Only when all
 * of that lines up — both files read one changed copy and one unchanged
 * copy, the classification is pathogenic or likely pathogenic, the pattern
 * is autosomal recessive, and each file on its own sits below the runs
 * threshold — does a probability exist, and it is the single Mendelian
 * fraction 1 in 4. Every other case renders no number at all and says which
 * of the named reasons applies.
 *
 * **Nothing here is a relatedness quantity.** The two files are compared at
 * one position at a time for identity of the letters they report, which is
 * what the panel above says it does. No shared-DNA length, centimorgan
 * count, IBD segment, kinship coefficient or relationship label is computed
 * or could be: the runs measure each file carries is read on its own
 * (`belowRohThreshold` takes one measure), never against the other
 * (X15, brief line 348, acceptance 20).
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

export const CARRIER_REASONS = [
  "dominant",
  "harmless",
  "unknown-meaning",
  "copies-unknown",
  "no-pattern",
  "sex-unknown",
  "runs-unchecked",
] as const;

export type CarrierReason = (typeof CARRIER_REASONS)[number];

export interface CarrierPerson {
  /** The subject whose rows were read: the counterpart's own self subject. */
  dataSubjectId: string;
  displayLabel: string;
  /** rsid → the letters that file reports. */
  genotypes: ReadonlyMap<number, string>;
  /** That file's own runs measure; never compared with the other person's. */
  runs: RohMeasure;
}

interface CarrierMatchCommon {
  rsid: number;
  gene: string;
  conditionId: string | null;
  conditionName: string | null;
  /** The classification exactly as the reference row records it. */
  classification: string;
  a: { dataSubjectId: string; displayLabel: string; genotype: string; copies: CarrierCopies };
  b: { dataSubjectId: string; displayLabel: string; genotype: string; copies: CarrierCopies };
}

export type CarrierMatch =
  | (CarrierMatchCommon & { kind: "probability"; probability: number })
  | (CarrierMatchCommon & { kind: "no-probability"; reason: CarrierReason });

export interface CarrierPairInput {
  a: CarrierPerson;
  b: CarrierPerson;
  refVariants: readonly CarrierRefVariant[];
  conditions: readonly CarrierCondition[];
}

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

/** Pathogenic and likely pathogenic, case-insensitively, and nothing else. */
export function isPathogenicClassification(significance: string): boolean {
  const value = normalise(significance);
  return value === "pathogenic" || value === "likely pathogenic";
}

export function isHarmlessClassification(significance: string): boolean {
  const value = normalise(significance);
  return value === "benign" || value === "likely benign";
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

function reasonFor(
  classification: string,
  condition: CarrierCondition | null,
  a: CarrierPerson,
  b: CarrierPerson,
  copiesA: CarrierCopies,
  copiesB: CarrierCopies,
): CarrierReason | null {
  // A file that does not show how many copies it read cannot support any of
  // the questions below, so it is answered first.
  if (copiesA === "copies not shown" || copiesB === "copies not shown") return "copies-unknown";
  if (isHarmlessClassification(classification)) return "harmless";
  if (!isPathogenicClassification(classification)) return "unknown-meaning";

  const mode = condition === null ? null : normalise(condition.inheritanceMode ?? "");
  if (mode === "autosomal_dominant") return "dominant";
  // An X-linked pattern needs each person's chromosomal sex, which nothing in
  // Inherit records, and the hundred-pregnancy split it would render belongs
  // to Portrait. The panel says so rather than printing a fraction that does
  // not apply (design §2.3, deviation recorded).
  if (mode === "x_linked") return "sex-unknown";
  if (mode !== "autosomal_recessive") return "no-pattern";

  // Each file is asked on its own; the two measures are never compared.
  if (!belowRohThreshold(a.runs) || !belowRohThreshold(b.runs)) return "runs-unchecked";
  return null;
}

/**
 * Every position both files report a change at, with the one probability or
 * the one named reason. Ordered by rsid so two requests answer alike, and
 * ordered by nothing else: no match is ranked, scored or called worse.
 */
export function evaluateCarrierPairs(input: CarrierPairInput): CarrierMatch[] {
  const { a, b, refVariants, conditions } = input;
  const matches: CarrierMatch[] = [];

  for (const variant of [...refVariants].sort((left, right) => left.rsid - right.rsid)) {
    // A position with no clinical classification is not a candidate at all.
    if (variant.clinvarSignificance === null || variant.clinvarSignificance.trim() === "") continue;
    const gene = variant.geneSymbol?.trim();
    // Without a gene name the panel could not name what the two files share.
    if (!gene) continue;

    const genotypeA = a.genotypes.get(variant.rsid);
    const genotypeB = b.genotypes.get(variant.rsid);
    if (genotypeA === undefined || genotypeB === undefined) continue;

    const copiesA = copiesShown(genotypeA, variant.alt);
    const copiesB = copiesShown(genotypeB, variant.alt);
    // One of the two files shows no changed copy here: nothing is shared.
    if (copiesA === null || copiesB === null) continue;
    // Two changed copies is a finding about that person, not a carrier pair.
    // It belongs on their own report, behind their own layer permission, and
    // the closed reason table has no sentence that would be true here.
    if (copiesA === "two copies" || copiesB === "two copies") continue;
    // At least one file must actually show one changed copy. Two files that
    // both failed to read the position share nothing that could be stated.
    if (copiesA !== "one copy" && copiesB !== "one copy") continue;

    const condition = conditionFor(gene, conditions);
    const common: CarrierMatchCommon = {
      rsid: variant.rsid,
      gene,
      conditionId: condition?.conditionId ?? null,
      conditionName: condition?.conditionName ?? null,
      classification: variant.clinvarSignificance.trim(),
      a: {
        dataSubjectId: a.dataSubjectId,
        displayLabel: a.displayLabel,
        genotype: genotypeA,
        copies: copiesA,
      },
      b: {
        dataSubjectId: b.dataSubjectId,
        displayLabel: b.displayLabel,
        genotype: genotypeB,
        copies: copiesB,
      },
    };

    const reason = reasonFor(common.classification, condition, a, b, copiesA, copiesB);
    matches.push(
      reason === null
        ? { ...common, kind: "probability", probability: BOTH_CHANGED_COPIES_PROBABILITY }
        : { ...common, kind: "no-probability", reason },
    );
  }

  return matches;
}

/** How many matches carry a probability; the Overview line renders only above zero. */
export function countCarrierMatches(matches: readonly CarrierMatch[]): number {
  return matches.filter((match) => match.kind === "probability").length;
}

/**
 * The positions both files cover, counted for the empty-panel sentence. It
 * is a count of positions and nothing else: no coverage fraction, no
 * quality score, no comparison between the two people.
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
// request time). The reads are ordered so the common state costs one query:
// today every `ref_variants.clinvar_significance` is null, so the classified
// set is empty, no genotype is read, no runs are measured and the panel
// states that it found nothing.
// ---------------------------------------------------------------------------

/**
 * A read budget for the classified positions, not a scientific threshold.
 * The seed writes no classification at all, so this read returns nothing on
 * a real deployment; the budget exists so one page load cannot pull an
 * unbounded table.
 */
export const MAX_CLASSIFIED_POSITIONS = 5_000;

export interface CarrierPairSummary {
  matches: CarrierMatch[];
  /** Classified positions both files cover: the count the empty sentence prints. */
  positionsBothCover: number;
}

/** Every classified reference position, paged to the read budget. */
export async function readClassifiedVariants(supabase: Db): Promise<CarrierRefVariant[]> {
  const PAGE = 1_000;
  const rows: CarrierRefVariant[] = [];
  for (let from = 0; from < MAX_CLASSIFIED_POSITIONS; from += PAGE) {
    const { data } = await supabase
      .from("ref_variants")
      .select("rsid, gene_symbol, alt, clinvar_significance")
      .not("clinvar_significance", "is", null)
      .not("gene_symbol", "is", null)
      .order("rsid")
      .range(from, from + PAGE - 1);
    const page = data ?? [];
    for (const row of page) {
      rows.push({
        rsid: row.rsid,
        geneSymbol: row.gene_symbol,
        alt: row.alt,
        clinvarSignificance: row.clinvar_significance,
      });
    }
    if (page.length < PAGE) break;
  }
  return rows;
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
 * The whole pipeline for one pair, at request time. Each person's runs are
 * measured from that person's own files and asked about on their own; the
 * two measures are never compared, and no quantity crossing the two people
 * is produced anywhere in this function.
 */
export async function resolveCarrierPair(
  supabase: Db,
  a: CarrierPairPerson,
  b: CarrierPairPerson,
  refVariants: readonly CarrierRefVariant[],
  conditions: readonly CarrierCondition[],
): Promise<CarrierPairSummary> {
  if (refVariants.length === 0) return { matches: [], positionsBothCover: 0 };
  const rsids = refVariants.map((variant) => variant.rsid);
  const [readA, readB] = await Promise.all([
    getSubjectGenotypesByRsid(supabase, a.dataSubjectId, rsids),
    getSubjectGenotypesByRsid(supabase, b.dataSubjectId, rsids),
  ]);
  const positionsBothCover = countPositionsBothCover(readA.genotypes, readB.genotypes);
  if (positionsBothCover === 0) return { matches: [], positionsBothCover: 0 };

  const [filesA, filesB] = await Promise.all([
    getSubjectProcessedFiles(supabase, a.dataSubjectId),
    getSubjectProcessedFiles(supabase, b.dataSubjectId),
  ]);
  const [runsA, runsB] = await Promise.all([
    measureSubjectRuns(supabase, a.dataSubjectId, filesA.map((file) => file.id)),
    measureSubjectRuns(supabase, b.dataSubjectId, filesB.map((file) => file.id)),
  ]);

  return {
    matches: evaluateCarrierPairs({
      a: { ...a, genotypes: readA.genotypes, runs: runsA },
      b: { ...b, genotypes: readB.genotypes, runs: runsB },
      refVariants,
      conditions,
    }),
    positionsBothCover,
  };
}
