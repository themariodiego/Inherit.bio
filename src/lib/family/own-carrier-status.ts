/**
 * One person's own carrier status over the reviewed assertion rule
 * (`private.carrier_assertion_rule_v1`, read through
 * `public.carrier_assertions_v1`; docs/carrier-importer-design.md). Pure
 * functions over plain rows, so the whole reading is decided here and proved
 * without a database.
 *
 * The question is narrow. For each condition the rule admits, which of its
 * reviewed changes does this person's own file show, and at how many of the
 * condition's known positions could the file be read at all? The file is
 * read by EXACT ALLELE through `./carrier-assertions`, never by rsID.
 *
 *   - A finding is the change the file shows with the most changed copies:
 *     two copies before one, one before a reading that cannot say how many,
 *     ties to the lower assertion id, so two requests answer alike. It names
 *     the reviewed variant, its classification, review status and date.
 *   - `checkedPositions` counts the condition's distinct GRCh38 positions at
 *     which the file gives two readable letters. A position the file does not
 *     report, reports as unreadable ("--"), or reports differently in two
 *     files is not checked. It is never read as "no copy".
 *   - No finding is never a negative result: the page says so beside the
 *     count (brief §4, line 1331).
 *
 * Nothing here is a probability, a risk or a statement about a child. The
 * pair arithmetic stays in `./carrier-pair`; this module reads one person.
 */
import {
  carrierReference,
  exactGenotypes,
  type CarrierAssertionRow,
  type CarrierCall,
} from "./carrier-assertions";
import type { CarrierCopies, CarrierEvidence, CarrierRefVariant } from "./carrier-pair";

/** The change one file shows for one reviewed condition. */
export interface OwnCarrierFinding {
  assertionId: number;
  /** The classification exactly as the reviewed assertion records it. */
  classification: string;
  /** The letters the file shows, written in the assertion's own spelling. */
  genotype: string;
  copies: CarrierCopies;
  evidence: CarrierEvidence;
}

export interface OwnCarrierCondition {
  conditionId: string;
  conditionName: string;
  gene: string;
  inheritanceMode: string;
  penetranceClass: CarrierEvidence["penetranceClass"];
  releaseId: string;
  geneValidityReadOn: string;
  /** The condition's distinct GRCh38 positions in the rule: N in "checked at n of the N positions". */
  requiredPositions: number;
  /** Of those, the positions this file gives two readable letters at: n. */
  checkedPositions: number;
  finding: OwnCarrierFinding | null;
}

/** How the page describes a condition's coverage, as the embryo library coverage does. */
export type OwnCarrierCoverage = "covered" | "partial" | "not-covered";

export function ownCarrierCoverage(condition: Pick<OwnCarrierCondition, "checkedPositions" | "requiredPositions">): OwnCarrierCoverage {
  if (condition.checkedPositions === 0) return "not-covered";
  return condition.checkedPositions === condition.requiredPositions ? "covered" : "partial";
}

const ACGT = /^[ACGT]+$/;

/** Two readable letters at the position, in the assertion's own spelling. */
function readable(genotype: string | undefined): genotype is string {
  if (genotype === undefined || genotype === "--") return false;
  const alleles = genotype.split("/");
  return alleles.length === 2 && alleles.every((allele) => ACGT.test(allele));
}

/**
 * How many changed copies one reading shows, or null when it shows none.
 * Mirrors `exactCopiesShown` in `./carrier-pair`, except that an unreadable
 * reading ("--") is not a finding here: on one person's own page it is a
 * position the file could not read, and it counts as not checked.
 */
export function ownCopiesShown(genotype: string, alt: string): CarrierCopies | null {
  if (genotype === "--") return null;
  const alleles = genotype.split("/");
  if (alleles.some((allele) => !ACGT.test(allele))) return null;
  const changed = alleles.filter((allele) => allele === alt).length;
  if (alleles.length === 1) return changed === 1 ? "copies not shown" : null;
  if (alleles.length !== 2) return null;
  return changed === 2 ? "two copies" : changed === 1 ? "one copy" : null;
}

const COPIES_RANK: Record<CarrierCopies, number> = { "two copies": 0, "one copy": 1, "copies not shown": 2 };

/**
 * Every condition the rule admitted, with what this person's own file shows
 * for it. Ordered as the rule orders its rows (by gene), and by nothing else:
 * no condition is ranked, scored or called worse.
 */
export function ownCarrierStatus(rows: readonly CarrierAssertionRow[], calls: readonly CarrierCall[]): OwnCarrierCondition[] {
  const { refVariants } = carrierReference(rows);
  const { genotypes } = exactGenotypes(refVariants, calls);
  const byCondition = new Map<string, { row: CarrierAssertionRow; variants: CarrierRefVariant[] }>();
  rows.forEach((row, index) => {
    const variant = refVariants[index];
    const group = byCondition.get(row.condition_id);
    if (group) group.variants.push(variant);
    else byCondition.set(row.condition_id, { row, variants: [variant] });
  });
  return [...byCondition.values()].map(({ row, variants }) => {
    const required = new Set<string>();
    const checked = new Set<string>();
    let finding: OwnCarrierFinding | null = null;
    for (const variant of [...variants].sort((left, right) => left.rsid - right.rsid)) {
      const key = variant.key!;
      const locus = `${key.chrom}:${key.pos}`;
      required.add(locus);
      const genotype = genotypes.get(variant.rsid);
      if (readable(genotype)) checked.add(locus);
      if (genotype === undefined) continue;
      const copies = ownCopiesShown(genotype, key.alt);
      if (copies === null) continue;
      if (finding === null || COPIES_RANK[copies] < COPIES_RANK[finding.copies]) {
        finding = { assertionId: variant.rsid, classification: variant.clinvarSignificance!, genotype, copies,
          evidence: variant.evidence! };
      }
    }
    return {
      conditionId: row.condition_id,
      conditionName: row.condition_name,
      gene: row.gene_symbol,
      inheritanceMode: row.inheritance_mode,
      penetranceClass: row.penetrance_class,
      releaseId: row.release_id,
      geneValidityReadOn: row.gene_validity_read_on,
      requiredPositions: required.size,
      checkedPositions: checked.size,
      finding,
    };
  });
}

/** A synthetic test release or condition: never read outside the TEST-LOCAL acceptance build. */
export function isSyntheticAssertion(row: Pick<CarrierAssertionRow, "release_id" | "condition_id">): boolean {
  return row.release_id.startsWith("synthetic-") || row.condition_id.startsWith("SYNTHETIC:");
}

/**
 * The rule's rows a build may show. The database already refuses a synthetic
 * condition under a ClinVar release and the reverse; this refuses every
 * synthetic row outside the TEST-LOCAL acceptance build, so a
 * synthetic activation can never reach a production page.
 */
export function rowsForBuild(rows: readonly CarrierAssertionRow[], testLocal: boolean): CarrierAssertionRow[] {
  return testLocal ? [...rows] : rows.filter((row) => !isSyntheticAssertion(row));
}
