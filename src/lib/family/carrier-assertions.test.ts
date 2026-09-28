import { describe, expect, it } from "vitest";
import {
  assertionLoci,
  carrierReference,
  exactGenotypes,
  parseCarrierAssertionRows,
  type CarrierAssertionRow,
  type CarrierCall,
} from "./carrier-assertions";
import {
  copiesShownFor,
  evaluateCarrierPairs,
  exactCopiesShown,
  readCarrierConditions,
  readClassifiedVariants,
  type CarrierPerson,
} from "./carrier-pair";
import { evaluateOneSided } from "./portrait";
import { measureRunsOfHomozygosity, rohColumns, storedRohMeasure } from "./roh";

/**
 * Exact-allele reading of reviewed carrier assertions
 * (docs/carrier-importer-design.md, point 3). The rows are shaped exactly as
 * `carrier_assertions_v1` returns them; the keys are CFTR's F508del
 * (a deletion ClinVar keys at 7:117559590 ATCT>A, with its right-shifted
 * spelling 7:117559591 TCTT>T) and G542X (a single-letter change,
 * 7:117587778 G>T), and one A/T single-letter change no array can read.
 */
const row = (overrides: Partial<CarrierAssertionRow>): CarrierAssertionRow => ({
  assertion_id: 1,
  release_id: "clinvar-2026-09",
  gene_validity_read_on: "2026-09-28",
  variation_id: 7105,
  condition_id: "MONDO:0009061",
  condition_name: "Cystic fibrosis",
  gene_symbol: "CFTR",
  inheritance_mode: "autosomal_recessive",
  penetrance_class: "unestablished",
  penetrance_citation: null,
  variant_name: "NM_000492.3(CFTR):c.1521_1523del (p.Phe508del)",
  classification: "Pathogenic",
  review_status: "practice guideline",
  review_stars: 4,
  last_evaluated: "2004-03-03",
  chrom: 7,
  pos: 117_559_590,
  ref: "ATCT",
  alt: "A",
  equivalents: [[117_559_591, "TCTT", "T"]],
  ...overrides,
});
const F508 = row({});
const G542X = row({ assertion_id: 2, variation_id: 7115, variant_name: "NM_000492.4(CFTR):c.1624G>T (p.Gly542Ter)",
  pos: 117_587_778, ref: "G", alt: "T", equivalents: [] });
const AMBIGUOUS = row({ assertion_id: 3, variation_id: 900, variant_name: "synthetic A>T", pos: 117_600_000,
  ref: "A", alt: "T", equivalents: [] });
const reference = carrierReference([F508, G542X, AMBIGUOUS]);

const vcf = (pos: number, ref: string, alt: string, genotype: string, extra: Partial<CarrierCall> = {}): CarrierCall =>
  ({ chrom: 7, pos, ref, alt, genotype, fileId: "file-a", ...extra });
const array = (pos: number, genotype: string): CarrierCall => ({ chrom: 7, pos, ref: null, alt: null, genotype, fileId: "file-a" });

describe("the rule's rows", () => {
  it("keys every row by its assertion id, never by rsID, and carries its evidence and condition", () => {
    const [f508] = reference.refVariants;
    expect(f508).toMatchObject({
      rsid: 1,
      geneSymbol: "CFTR",
      alt: "A",
      clinvarSignificance: "Pathogenic",
      key: { chrom: 7, pos: 117_559_590, ref: "ATCT", alt: "A", equivalents: [{ pos: 117_559_591, ref: "TCTT", alt: "T" }] },
      evidence: { variantName: "NM_000492.3(CFTR):c.1521_1523del (p.Phe508del)", reviewStatus: "practice guideline",
        reviewStars: 4, lastEvaluated: "2004-03-03", penetranceClass: "unestablished", releaseId: "clinvar-2026-09",
        geneValidityReadOn: "2026-09-28", variationId: 7105 },
      condition: { conditionId: "MONDO:0009061", conditionName: "Cystic fibrosis", geneSymbols: ["CFTR"],
        inheritanceMode: "autosomal_recessive" },
    });
    expect(reference.conditions).toHaveLength(1);
    expect(assertionLoci(reference.refVariants)).toEqual([
      { chrom: 7, pos: 117_559_590 }, { chrom: 7, pos: 117_559_591 }, { chrom: 7, pos: 117_587_778 }, { chrom: 7, pos: 117_600_000 },
    ]);
  });

  it("refuses the whole answer when any row falls short of the bar or is malformed", () => {
    expect(parseCarrierAssertionRows([F508, G542X])).toHaveLength(2);
    // The database never returns these; if it ever did, nothing is read.
    expect(parseCarrierAssertionRows([F508, { ...G542X, review_stars: 1, review_status: "criteria provided, single submitter" }])).toBeNull();
    expect(parseCarrierAssertionRows([{ ...F508, classification: "Uncertain significance" }])).toBeNull();
    expect(parseCarrierAssertionRows([{ ...F508, chrom: 23 }])).toBeNull();
    expect(parseCarrierAssertionRows([{ ...F508, extra: true }])).toBeNull();
    expect(parseCarrierAssertionRows("not rows")).toBeNull();
  });
});

describe("reading one file by exact allele", () => {
  it("reads a VCF deletion written as ClinVar keys it, and in its right-shifted spelling", () => {
    expect(exactGenotypes(reference.refVariants, [vcf(117_559_590, "ATCT", "A", "A/ATCT")]).genotypes.get(1)).toBe("A/ATCT");
    expect(exactGenotypes(reference.refVariants, [vcf(117_559_591, "TCTT", "T", "T/TCTT")]).genotypes.get(1)).toBe("A/ATCT");
    expect(exactGenotypes(reference.refVariants, [vcf(117_559_591, "TCTT", "T", "T/T")]).genotypes.get(1)).toBe("A/A");
  });

  it("never reads a different change at the same position as the asserted one", () => {
    // A different deletion that starts at the same base is another change.
    expect(exactGenotypes(reference.refVariants, [vcf(117_559_590, "ATC", "A", "A/ATC")]).genotypes.has(1)).toBe(false);
    // A deletion at the right-shifted position with the wrong letters.
    expect(exactGenotypes(reference.refVariants, [vcf(117_559_591, "TCTTT", "T", "T/TCTTT")]).genotypes.has(1)).toBe(false);
  });

  it("reads a single-letter change, and another letter at the same position as no copy of it", () => {
    expect(exactGenotypes(reference.refVariants, [vcf(117_587_778, "G", "T", "G/T")]).genotypes.get(2)).toBe("G/T");
    expect(exactGenotypes(reference.refVariants, [vcf(117_587_778, "G", "A", "A/G")]).genotypes.get(2)).toBe("A/G");
    expect(exactCopiesShown("A/G", { ref: "G", alt: "T" })).toBeNull();
    // A reference letter that disagrees with the assertion's is not this position's reading.
    expect(exactGenotypes(reference.refVariants, [vcf(117_587_778, "C", "T", "C/T")]).genotypes.has(2)).toBe(false);
  });

  it("reads an array only at a single-letter change, only in the assertion's two letters, never at an A/T change", () => {
    expect(exactGenotypes(reference.refVariants, [array(117_587_778, "G/T")]).genotypes.get(2)).toBe("G/T");
    expect(exactGenotypes(reference.refVariants, [array(117_587_778, "G/G")]).genotypes.get(2)).toBe("G/G");
    // Letters outside the pair could be the other strand: not read.
    expect(exactGenotypes(reference.refVariants, [array(117_587_778, "A/C")]).genotypes.has(2)).toBe(false);
    // An A>T change reads the same on both strands: never read from an array.
    expect(exactGenotypes(reference.refVariants, [array(117_600_000, "A/T")]).genotypes.has(3)).toBe(false);
    // An array cannot read an insertion or deletion by position.
    expect(exactGenotypes(reference.refVariants, [array(117_559_590, "A/A")]).genotypes.has(1)).toBe(false);
  });

  it("reads a no-call or a failed call as unreadable, and unreadable evidence wins over a readable call", () => {
    expect(exactGenotypes(reference.refVariants, [array(117_587_778, "--")]).genotypes.get(2)).toBe("--");
    expect(exactGenotypes(reference.refVariants, [vcf(117_587_778, "G", "T", "G/T"),
      vcf(117_587_778, "G", "T", "G/T", { usable: false })]).genotypes.get(2)).toBe("--");
    expect(copiesShownFor(reference.refVariants[1], "--")).toBe("copies not shown");
  });

  it("reads two calls that disagree as not covered, never as either one", () => {
    expect(exactGenotypes(reference.refVariants, [vcf(117_587_778, "G", "T", "G/T"), vcf(117_587_778, "G", "T", "G/G", { fileId: "file-b" })])
      .genotypes.has(2)).toBe(false);
    const agreeing = exactGenotypes(reference.refVariants, [vcf(117_587_778, "G", "T", "G/T"),
      vcf(117_587_778, "G", "T", "G/T", { usable: true, fileId: "file-b" })]);
    expect(agreeing.genotypes.get(2)).toBe("G/T");
    expect([...agreeing.inputFilesByKey.get(2)!]).toEqual(["file-a", "file-b"]);
  });

  it("counts copies of the asserted allele, whatever its length", () => {
    expect(exactCopiesShown("A/ATCT", { ref: "ATCT", alt: "A" })).toBe("one copy");
    expect(exactCopiesShown("A/A", { ref: "ATCT", alt: "A" })).toBe("two copies");
    expect(exactCopiesShown("ATCT/ATCT", { ref: "ATCT", alt: "A" })).toBeNull();
    expect(exactCopiesShown("A", { ref: "ATCT", alt: "A" })).toBe("copies not shown");
  });
});

describe("the pair rule over reviewed assertions", () => {
  const below = storedRohMeasure(rohColumns(measureRunsOfHomozygosity([
    { chrom: 1, pos: 1_000, genotype: "A/A" }, { chrom: 1, pos: 2_000, genotype: "A/A" },
    { chrom: 1, pos: 60_000_000, genotype: "A/G" }, { chrom: 2, pos: 1_000, genotype: "C/T" },
    { chrom: 2, pos: 90_000_000, genotype: "C/T" },
  ]), "2026-09-28T00:00:00.000Z"));
  const person = (id: string, calls: CarrierCall[]): CarrierPerson => ({
    dataSubjectId: id, displayLabel: id, chromosomalSex: null, runs: [below],
    genotypes: exactGenotypes(reference.refVariants, calls).genotypes,
  });

  it("gives the one recessive fraction for two carriers of reviewed changes, and names both with their evidence", () => {
    const matches = evaluateCarrierPairs({
      a: person("a", [vcf(117_559_591, "TCTT", "T", "T/TCTT"), vcf(117_587_778, "G", "T", "G/G")]),
      b: person("b", [vcf(117_587_778, "G", "T", "G/T"), vcf(117_559_590, "ATCT", "A", "ATCT/ATCT")]),
      refVariants: reference.refVariants,
      conditions: reference.conditions,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ kind: "probability", probability: 0.25, gene: "CFTR", conditionName: "Cystic fibrosis",
      a: { variant: { rsid: 1, copies: "one copy", evidence: { variationId: 7105 } } },
      b: { variant: { rsid: 2, copies: "one copy", evidence: { variationId: 7115 } } } });
  });

  it("refuses by name where one file does not report the other's allele", () => {
    const [match] = evaluateCarrierPairs({
      a: person("a", [vcf(117_559_590, "ATCT", "A", "A/ATCT")]),
      b: person("b", [vcf(117_587_778, "G", "T", "G/T")]),
      refVariants: reference.refVariants,
      conditions: reference.conditions,
    });
    expect(match).toMatchObject({ kind: "no-probability", reason: "not-covered", uncovered: { dataSubjectId: "b", rsid: 1 } });
  });
});

describe("the one-sided Portrait reading over reviewed rows", () => {
  const one = (dataSubjectId: string, genotypes: [number, string][]) =>
    ({ dataSubjectId, displayLabel: dataSubjectId, genotypes: new Map(genotypes) });

  it("counts a reviewed deletion by its exact allele and carries the assertion's evidence, so no rsID is ever printed", () => {
    const [reading] = evaluateOneSided({ a: one("a", [[1, "A/ATCT"]]), b: one("b", []),
      refVariants: reference.refVariants, conditions: reference.conditions, matches: [] });
    expect(reading).toMatchObject({ kind: "not-covered", gene: "CFTR", uncoveredRsid: 1,
      carrier: { dataSubjectId: "a", variant: { rsid: 1, copies: "one copy",
        evidence: { variantName: F508.variant_name, reviewStatus: "practice guideline", releaseId: "clinvar-2026-09" } } } });
  });

  it("reads the other file's own letters at the deletion as no second copy, and its deletion as a change", () => {
    const [covered] = evaluateOneSided({ a: one("a", [[1, "A/ATCT"]]), b: one("b", [[1, "ATCT/ATCT"]]),
      refVariants: reference.refVariants, conditions: reference.conditions, matches: [] });
    expect(covered).toMatchObject({ kind: "no-second-copy", uncoveredRsid: null });
    // Both files show the deletion: not one-sided, whatever the pair rule says.
    expect(evaluateOneSided({ a: one("a", [[1, "A/ATCT"]]), b: one("b", [[1, "A/ATCT"]]),
      refVariants: reference.refVariants, conditions: reference.conditions, matches: [] })).toEqual([]);
  });
});

describe("the production reader", () => {
  it("reads only the reviewed rule, never the legacy reference tables, and reads nothing on any failure", async () => {
    const calls: string[] = [];
    const client = (data: unknown, error: unknown = null) => ({
      from: () => { throw new Error("Legacy reference labels must not be queried for clinical assertions"); },
      rpc: async (name: string) => { calls.push(name); return { data, error }; },
    }) as unknown as Parameters<typeof readClassifiedVariants>[0];
    const rows = await readClassifiedVariants(client([F508, G542X]));
    expect(rows.map((variant) => variant.rsid)).toEqual([1, 2]);
    expect(calls).toEqual(["carrier_assertions_v1"]);
    expect(await readCarrierConditions(client(null), rows)).toEqual(reference.conditions);
    expect(await readClassifiedVariants(client(null, { code: "42501" }))).toEqual([]);
    expect(await readClassifiedVariants(client([{ ...F508, review_stars: 1 }]))).toEqual([]);
    expect(await readClassifiedVariants(client(Array.from({ length: 20_001 }, (_, index) => ({ ...F508, assertion_id: index + 1 }))))).toEqual([]);
    expect(await readCarrierConditions(client(null))).toEqual([]);
  });
});
