/**
 * Reviewed carrier assertions, read the one way the database allows
 * (docs/carrier-importer-design.md; migration
 * 20260929130000_carrier_assertions.sql).
 *
 * The rule itself lives in the database (`private.carrier_assertion_rule_v1`):
 * pathogenic or likely pathogenic, two review stars or more, no conflict, a
 * current release, and a condition a named reviewer activated whose ClinGen
 * link is Definitive or Strong. This module turns the rule's rows into the
 * plain rows `./carrier-pair` decides on, and reads one person's file against
 * them by EXACT ALLELE: the chromosome, the position and both spellings must
 * match. An rsID never matches anything here.
 *
 * What a file says at an asserted allele becomes one of three things:
 *   - a genotype written in the assertion's own letters ("ATCT/A" is one copy
 *     of a deletion), which the rule counts;
 *   - "--", a position the file holds but could not read;
 *   - nothing, when the file does not report the allele in a form this
 *     module can tie to the assertion. That is "not covered", never "no copy".
 *
 * An array file carries no reference letters, so it is read only at a
 * single-letter change, only when its letters are the assertion's two, and
 * never at an A/T or C/G change, where the strand cannot be told.
 */
import { z } from "zod";
import type { CarrierCondition, CarrierEvidence, CarrierRefVariant } from "./carrier-pair";

/** One row of the database rule, exactly as `carrier_assertions_v1` returns it. */
export const carrierAssertionRowSchema = z.object({
  assertion_id: z.number().int().positive().safe(),
  release_id: z.string().regex(/^(clinvar-\d{4}-\d{2}|synthetic-[a-z0-9-]+)$/),
  gene_validity_read_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  variation_id: z.number().int().positive().safe(),
  condition_id: z.string().regex(/^(MONDO:\d{7}|SYNTHETIC:\d{1,7})$/),
  condition_name: z.string().min(1).max(80),
  gene_symbol: z.string().regex(/^[A-Z0-9][A-Z0-9-]{0,19}$/),
  inheritance_mode: z.enum(["autosomal_recessive", "autosomal_dominant", "x_linked", "other", "unknown"]),
  penetrance_class: z.enum(["high", "moderate", "low", "unestablished"]),
  penetrance_citation: z.string().nullable(),
  variant_name: z.string().min(1).max(500),
  classification: z.enum(["Pathogenic", "Likely pathogenic", "Pathogenic/Likely pathogenic"]),
  review_status: z.enum(["practice guideline", "reviewed by expert panel",
    "criteria provided, multiple submitters, no conflicts"]),
  review_stars: z.number().int().min(2).max(4),
  last_evaluated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  chrom: z.number().int().min(1).max(22),
  pos: z.number().int().positive().safe(),
  ref: z.string().regex(/^[ACGT]+$/),
  alt: z.string().regex(/^[ACGT]+$/),
  equivalents: z.array(z.tuple([z.number().int().positive().safe(), z.string().regex(/^[ACGT]+$/),
    z.string().regex(/^[ACGT]+$/)])).max(64),
}).strict();
export type CarrierAssertionRow = z.infer<typeof carrierAssertionRowSchema>;

export interface CarrierReference {
  refVariants: CarrierRefVariant[];
  conditions: CarrierCondition[];
}

/** The rule's rows as the pair rule's plain rows: one per assertion, keyed by its id, never by rsID. */
export function carrierReference(rows: readonly CarrierAssertionRow[]): CarrierReference {
  const conditions = new Map<string, CarrierCondition>();
  const refVariants = rows.map((row): CarrierRefVariant => {
    if (!conditions.has(row.condition_id)) {
      conditions.set(row.condition_id, { conditionId: row.condition_id, conditionName: row.condition_name,
        geneSymbols: [row.gene_symbol], inheritanceMode: row.inheritance_mode });
    }
    const evidence: CarrierEvidence = {
      variantName: row.variant_name,
      reviewStatus: row.review_status,
      reviewStars: row.review_stars,
      lastEvaluated: row.last_evaluated,
      penetranceClass: row.penetrance_class,
      releaseId: row.release_id,
      geneValidityReadOn: row.gene_validity_read_on,
      variationId: row.variation_id,
    };
    return {
      rsid: row.assertion_id,
      geneSymbol: row.gene_symbol,
      alt: row.alt,
      clinvarSignificance: row.classification,
      key: { chrom: row.chrom, pos: row.pos, ref: row.ref, alt: row.alt,
        equivalents: row.equivalents.map(([pos, ref, alt]) => ({ pos, ref, alt })) },
      evidence,
      condition: conditions.get(row.condition_id),
    };
  });
  return { refVariants, conditions: [...conditions.values()] };
}

/** Parses the rule's rows; anything malformed is refused whole, never read in part. */
export function parseCarrierAssertionRows(data: unknown): CarrierAssertionRow[] | null {
  const parsed = z.array(carrierAssertionRowSchema).max(20_000).safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** Every (chromosome, position) the rule's alleles can be written at: the key and each other spelling. */
export function assertionLoci(refVariants: readonly CarrierRefVariant[]): { chrom: number; pos: number }[] {
  const loci = new Map<string, { chrom: number; pos: number }>();
  for (const variant of refVariants) {
    if (!variant.key) continue;
    for (const pos of [variant.key.pos, ...variant.key.equivalents.map((key) => key.pos)]) {
      loci.set(`${variant.key.chrom}:${pos}`, { chrom: variant.key.chrom, pos });
    }
  }
  return [...loci.values()].sort((left, right) => left.chrom - right.chrom || left.pos - right.pos);
}

/**
 * One call a file holds at a position, as the database returns it. `ref` and
 * `alt` are null for an array call, which carries no reference letters.
 * `usable` is present only for an observed VCF call and is false when the
 * call failed its own quality checks.
 */
export interface CarrierCall {
  chrom: number;
  pos: number;
  ref: string | null;
  alt: string | null;
  genotype: string;
  usable?: boolean;
  fileId?: string;
}

const COMPLEMENT: Record<string, string> = { A: "T", T: "A", C: "G", G: "C" };

/** A single-letter change whose two letters are complements: an array cannot tell its strand. */
function strandAmbiguous(ref: string, alt: string): boolean {
  return ref.length === 1 && alt.length === 1 && COMPLEMENT[ref] === alt;
}

type Reading = { kind: "genotype"; alleles: string[] } | { kind: "unreadable" };

/**
 * What one call says about one assertion, or null when the call does not
 * speak to it. Written in the assertion's own letters.
 */
function readCall(variant: CarrierRefVariant, call: CarrierCall): Reading | null {
  const key = variant.key!;
  if (call.chrom !== key.chrom) return null;
  const snv = key.ref.length === 1 && key.alt.length === 1;
  const alleles = call.genotype.split("/");
  const unreadable = call.genotype === "--" || call.usable === false || alleles.some((allele) => !/^[ACGT]+$/.test(allele));
  if (call.ref === null || call.alt === null) {
    // An array call: one letter per copy, no reference letters.
    if (!snv || call.pos !== key.pos || strandAmbiguous(key.ref, key.alt)) return null;
    if (unreadable) return { kind: "unreadable" };
    if (!alleles.every((allele) => allele === key.ref || allele === key.alt)) return null;
    return { kind: "genotype", alleles };
  }
  const spelling = [{ pos: key.pos, ref: key.ref, alt: key.alt }, ...key.equivalents]
    .find((candidate) => candidate.pos === call.pos && candidate.ref === call.ref && candidate.alt === call.alt);
  if (spelling) {
    if (unreadable) return { kind: "unreadable" };
    // The file's own letters, rewritten into the assertion's spelling.
    return { kind: "genotype", alleles: alleles.map((allele) =>
      allele === spelling.ref ? key.ref : allele === spelling.alt ? key.alt : allele) };
  }
  // Another change at the same single letter: the file read this position,
  // and says which letters it saw.
  if (snv && call.pos === key.pos && call.ref === key.ref && call.alt.length === 1) {
    if (unreadable) return { kind: "unreadable" };
    return { kind: "genotype", alleles };
  }
  return null;
}

/**
 * One person's readings at the rule's alleles, keyed as the pair rule keys
 * them. Calls that agree are one reading; calls that disagree are no reading
 * at all (not covered), as the report reader treats a disagreement; an
 * unreadable call with no readable one is "--".
 */
export function exactGenotypes(
  refVariants: readonly CarrierRefVariant[],
  calls: readonly CarrierCall[],
): { genotypes: Map<number, string>; inputFilesByKey: Map<number, Set<string>> } {
  const byLocus = new Map<string, CarrierCall[]>();
  for (const call of calls) {
    const locus = `${call.chrom}:${call.pos}`;
    const list = byLocus.get(locus);
    if (list) list.push(call);
    else byLocus.set(locus, [call]);
  }
  const genotypes = new Map<number, string>();
  const inputFilesByKey = new Map<number, Set<string>>();
  for (const variant of refVariants) {
    if (!variant.key) continue;
    const positions = [variant.key.pos, ...variant.key.equivalents.map((key) => key.pos)];
    const readings: Reading[] = [];
    const files = new Set<string>();
    for (const pos of positions) {
      for (const call of byLocus.get(`${variant.key.chrom}:${pos}`) ?? []) {
        const reading = readCall(variant, call);
        if (!reading) continue;
        readings.push(reading);
        if (call.fileId) files.add(call.fileId);
      }
    }
    if (!readings.length) continue;
    const readable = readings.filter((reading): reading is Extract<Reading, { kind: "genotype" }> => reading.kind === "genotype");
    const counts = new Set(readable.map((reading) => reading.alleles.filter((allele) => allele === variant.key!.alt).length
      + ":" + reading.alleles.length));
    if (counts.size > 1) continue;
    // Unreadable evidence wins over a readable call at the same allele.
    genotypes.set(variant.rsid, readable.length === readings.length ? readable[0].alleles.join("/") : "--");
    inputFilesByKey.set(variant.rsid, files);
  }
  return { genotypes, inputFilesByKey };
}
