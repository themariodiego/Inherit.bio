import { describe, expect, it } from "vitest";
import type { CarrierAssertionRow, CarrierCall } from "./carrier-assertions";
import { isSyntheticAssertion, ownCarrierCoverage, ownCarrierStatus, ownCopiesShown, rowsForBuild } from "./own-carrier-status";

/**
 * One person's own carrier status over the reviewed rule's rows
 * (`carrier_assertions_v1`). The rows are synthetic and shaped exactly as the
 * service door returns them: two conditions, the first with a single-letter
 * change and a left-aligned deletion that has one other spelling, the second
 * with one single-letter change.
 */
const row = (overrides: Partial<CarrierAssertionRow>): CarrierAssertionRow => ({
  assertion_id: 11,
  release_id: "synthetic-unit-own-carrier",
  gene_validity_read_on: "2026-09-28",
  variation_id: 881101,
  condition_id: "SYNTHETIC:8811",
  condition_name: "Synthetic recessive condition one",
  gene_symbol: "SYNOWNA",
  inheritance_mode: "autosomal_recessive",
  penetrance_class: "unestablished",
  penetrance_citation: null,
  variant_name: "Synthetic change one",
  classification: "Pathogenic",
  review_status: "reviewed by expert panel",
  review_stars: 3,
  last_evaluated: "2024-01-01",
  chrom: 1,
  pos: 21_000_000,
  ref: "A",
  alt: "G",
  equivalents: [],
  ...overrides,
});
const SNV = row({});
const DELETION = row({ assertion_id: 12, variation_id: 881102, variant_name: "Synthetic deletion one",
  classification: "Likely pathogenic", review_status: "criteria provided, multiple submitters, no conflicts", review_stars: 2,
  last_evaluated: null, pos: 30_000_000, ref: "ATCT", alt: "A", equivalents: [[30_000_001, "TCTT", "T"]] });
const OTHER = row({ assertion_id: 21, variation_id: 881201, condition_id: "SYNTHETIC:8812", condition_name: "Synthetic recessive condition two",
  gene_symbol: "SYNOWNB", variant_name: "Synthetic change two", pos: 8_000_000, ref: "C", alt: "T" });
const ROWS = [SNV, DELETION, OTHER];

const vcf = (pos: number, ref: string, alt: string, genotype: string, extra: Partial<CarrierCall> = {}): CarrierCall =>
  ({ chrom: 1, pos, ref, alt, genotype, fileId: "file-a", ...extra });

describe("ownCopiesShown", () => {
  it("counts changed copies in the assertion's own spelling, and never reads an unreadable call as a finding", () => {
    expect(ownCopiesShown("A/G", "G")).toBe("one copy");
    expect(ownCopiesShown("G/G", "G")).toBe("two copies");
    expect(ownCopiesShown("A/A", "G")).toBeNull();
    expect(ownCopiesShown("ATCT/A", "A")).toBe("one copy");
    expect(ownCopiesShown("G", "G")).toBe("copies not shown");
    expect(ownCopiesShown("--", "G")).toBeNull();
    expect(ownCopiesShown("A/N", "G")).toBeNull();
  });
});

describe("ownCarrierStatus", () => {
  it("names one copy of a reviewed change with its evidence, and counts every distinct position the file reads", () => {
    const [one, two] = ownCarrierStatus(ROWS, [vcf(21_000_000, "A", "G", "A/G"), vcf(30_000_000, "ATCT", "A", "ATCT/ATCT"),
      vcf(8_000_000, "C", "T", "C/C")]);
    expect(one).toMatchObject({ conditionId: "SYNTHETIC:8811", conditionName: "Synthetic recessive condition one", gene: "SYNOWNA",
      requiredPositions: 2, checkedPositions: 2, penetranceClass: "unestablished", releaseId: "synthetic-unit-own-carrier",
      geneValidityReadOn: "2026-09-28" });
    expect(one.finding).toMatchObject({ assertionId: 11, classification: "Pathogenic", genotype: "A/G", copies: "one copy" });
    expect(one.finding!.evidence).toMatchObject({ variantName: "Synthetic change one", reviewStatus: "reviewed by expert panel",
      lastEvaluated: "2024-01-01", releaseId: "synthetic-unit-own-carrier", variationId: 881101 });
    expect(ownCarrierCoverage(one)).toBe("covered");
    // Read and unchanged is not a finding, and it is not "no copy" either: the
    // page says "not a negative result" beside the count.
    expect(two).toMatchObject({ conditionId: "SYNTHETIC:8812", requiredPositions: 1, checkedPositions: 1, finding: null });
  });

  it("prefers two changed copies to one, and reads a deletion written in its other spelling", () => {
    const [one] = ownCarrierStatus(ROWS, [vcf(21_000_000, "A", "G", "A/G"), vcf(30_000_001, "TCTT", "T", "T/T")]);
    expect(one.finding).toMatchObject({ assertionId: 12, copies: "two copies", genotype: "A/A",
      classification: "Likely pathogenic" });
    expect(one.checkedPositions).toBe(2);
  });

  it("breaks a tie by the lower assertion id, so two requests answer alike", () => {
    const [one] = ownCarrierStatus(ROWS, [vcf(30_000_000, "ATCT", "A", "ATCT/A"), vcf(21_000_000, "A", "G", "A/G")]);
    expect(one.finding?.assertionId).toBe(11);
  });

  it("counts a position the file does not report, cannot read or reports two ways as not checked, never as no copy", () => {
    const missing = ownCarrierStatus(ROWS, [vcf(21_000_000, "A", "G", "A/A")]);
    expect(missing[0]).toMatchObject({ requiredPositions: 2, checkedPositions: 1, finding: null });
    expect(ownCarrierCoverage(missing[0])).toBe("partial");
    expect(missing[1]).toMatchObject({ requiredPositions: 1, checkedPositions: 0, finding: null });
    expect(ownCarrierCoverage(missing[1])).toBe("not-covered");

    const unreadable = ownCarrierStatus([SNV], [vcf(21_000_000, "A", "G", "--")]);
    expect(unreadable[0]).toMatchObject({ checkedPositions: 0, finding: null });
    const failed = ownCarrierStatus([SNV], [vcf(21_000_000, "A", "G", "A/G", { usable: false })]);
    expect(failed[0]).toMatchObject({ checkedPositions: 0, finding: null });

    const disagree = ownCarrierStatus([SNV], [vcf(21_000_000, "A", "G", "A/G"), vcf(21_000_000, "A", "G", "A/A", { fileId: "file-b" })]);
    expect(disagree[0]).toMatchObject({ checkedPositions: 0, finding: null });
  });

  it("never matches by rsID or by a different change at the same letter", () => {
    const other = ownCarrierStatus([SNV], [vcf(21_000_000, "A", "T", "A/T")]);
    expect(other[0]).toMatchObject({ checkedPositions: 1, finding: null });
    const elsewhere = ownCarrierStatus([SNV], [{ chrom: 2, pos: 21_000_000, ref: "A", alt: "G", genotype: "A/G", fileId: "file-a" }]);
    expect(elsewhere[0]).toMatchObject({ checkedPositions: 0, finding: null });
  });

  it("returns nothing for an empty rule, which the page states as unavailable rather than negative", () => {
    expect(ownCarrierStatus([], [vcf(21_000_000, "A", "G", "A/G")])).toEqual([]);
  });
});

describe("rowsForBuild", () => {
  const clinvar = row({ release_id: "clinvar-2026-09", condition_id: "MONDO:0009061", assertion_id: 99 });

  it("refuses every synthetic row outside the TEST-LOCAL acceptance build, and keeps reviewed ClinVar rows", () => {
    expect(rowsForBuild([SNV, OTHER, clinvar], false)).toEqual([clinvar]);
    expect(rowsForBuild([SNV, OTHER, clinvar], true)).toEqual([SNV, OTHER, clinvar]);
    expect(rowsForBuild([SNV, OTHER], false)).toEqual([]);
  });

  it("calls a row synthetic by its release or its condition", () => {
    expect(isSyntheticAssertion({ release_id: "synthetic-x", condition_id: "MONDO:0009061" })).toBe(true);
    expect(isSyntheticAssertion({ release_id: "clinvar-2026-09", condition_id: "SYNTHETIC:1" })).toBe(true);
    expect(isSyntheticAssertion({ release_id: "clinvar-2026-09", condition_id: "MONDO:0009061" })).toBe(false);
  });
});
