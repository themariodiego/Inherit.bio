import { describe, expect, it } from "vitest";
import { createPrsCallLookup, type PrsCallEvidence } from "./prs-call-lookup";
import { computePrs, type PrsScore } from "./prs";

const call = (genotype: string, extra: Partial<PrsCallEvidence> = {}): PrsCallEvidence =>
  ({ chrom: 1, pos: 100, ref: "A", alt: "G", genotype, ...extra });
const score: PrsScore = { pgs_id: "synthetic", name: "Synthetic", trait: "Synthetic", n_variants: 1,
  citation: { pmid: null, doi: null, label: "Synthetic" }, source_url: "", license_note: "", ancestry_note: "",
  variants: [{ rsid: 1, chrom: 1, pos38: 100, effect_allele: "A", other_allele: "G", weight: 0.25, effect_af: null }] };

describe("order-independent PRS evidence reduction", () => {
  it.each(["--", "", "/", "A|G", "0/1", "A/-", "I/D", "N/N", " A/G"])(
    "withholds unsupported or no-call %j evidence in every order and stream", genotype => {
      const valid = call("A/G"), invalid = call(genotype);
      for (const rows of [[valid, invalid], [invalid, valid], [valid, invalid, valid]]) {
        expect(createPrsCallLookup(rows).size).toBe(0);
        expect(createPrsCallLookup(rows.slice(0, 1), rows.slice(1)).size).toBe(0);
      }
    });
  it.each([["A/A", "A/G"], ["A", "A/A"], ["C/T", "A/G"]])(
    "withholds conflicting %s versus %s across variants and observations", (a, b) => {
      for (const rows of [[call(a), call(b)], [call(b), call(a)]]) {
        expect(createPrsCallLookup(rows).size).toBe(0);
        expect(createPrsCallLookup([rows[0]], [rows[1]]).size).toBe(0);
      }
    });
  it("filtered evidence poisons the locus even with identical letters or a later valid row", () => {
    for (const rows of [[call("AG"), call("AG", { usable: false }), call("AG")],
      [call("AG", { usable: false }), call("AG")]]) expect(createPrsCallLookup(rows).size).toBe(0);
  });
  it("collapses slash/order/case and compact duplicate evidence once without changing dosage", () => {
    const rows = [call("A/G"), call("G/A"), call("AG"), call("ga")];
    const lookup = createPrsCallLookup(rows.slice(0, 2), rows.slice(2));
    expect([...lookup]).toEqual([["1:100", { genotype: "A/G", ref: "A", alt: "G" }]]);
    expect(createPrsCallLookup([...rows].reverse())).toEqual(lookup);
    expect(computePrs(lookup, score)).toEqual(computePrs(new Map([["1:100", call("A/G")]]), score));
    expect(computePrs(lookup, score)).toMatchObject({ matched: 1, coverage: 1, raw: 0.25 });
  });
  it.each(["A", "AA", "a/g", "/A//G/", "AAA"])("preserves existing computePrs arithmetic for %s", genotype => {
    expect(computePrs(createPrsCallLookup([call(genotype)]), score))
      .toEqual(computePrs(new Map([["1:100", call(genotype)]]), score));
  });
  it("requires unanimous metadata per field without using metadata to infer dosage", () => {
    const rows = [call("AG"), call("GA", { ref: "T" }), call("A/G")];
    expect(createPrsCallLookup(rows).get("1:100")).toEqual({ genotype: "A/G", ref: null, alt: "G" });
    expect(createPrsCallLookup([...rows].reverse())).toEqual(createPrsCallLookup(rows));
    expect(createPrsCallLookup([call("AG"), call("AG", { alt: null }), call("AG")]).get("1:100")?.alt).toBeNull();
  });
  it("isolates chromosome/position and gives deterministic locus order without mutating inputs", () => {
    const rows = [call("A/G", { chrom: 2 }), call("--"), call("A/A", { pos: 101 })];
    const before = structuredClone(rows), result = createPrsCallLookup(rows);
    expect([...result.keys()]).toEqual(["1:101", "2:100"]);
    expect(createPrsCallLookup([...rows].reverse())).toEqual(result); expect(rows).toEqual(before);
  });
});
