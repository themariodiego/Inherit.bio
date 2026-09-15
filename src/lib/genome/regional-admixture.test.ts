import { describe, expect, it } from "vitest";
import { AIMS, estimateAdmixture } from "./admixture";
import { estimateRegionalAdmixture, fitRegionalMixtureDetailed, REGIONAL_AIMS, REGIONAL_CAVEAT,
  REGIONAL_POPS, regionalReporting, type RegionalProportions } from "./regional-admixture";
import { reportedRows } from "../../../scripts/ancestry-resolution/adaptive-reporting";

function shares(eur: number, mid: number, csa: number): RegionalProportions {
  return { AFR: 1 - eur - mid - csa, AMR: 0, CSA: csa, EAS: 0, EUR: eur, MID: mid, OCE: 0 };
}
describe("versioned seven-region ancestry", () => {
  it("preserves the exact marker identities and historical estimator", () => {
    expect(REGIONAL_AIMS.map(({ rsid, chrom, pos38, ref, alt }) => ({ rsid, chrom, pos38, ref, alt })))
      .toEqual(AIMS.map(({ rsid, chrom, pos38, ref, alt }) => ({ rsid, chrom, pos38, ref, alt })));
    expect(Object.keys(estimateAdmixture(() => null).proportions)).toEqual(["AFR", "AMR", "EAS", "EUR", "SAS"]);
  });
  it("has no shares or invented interval when no calls are usable", () => {
    const empty = estimateRegionalAdmixture(() => null);
    expect(empty).toMatchObject({ proportions: null, markersUsed: 0, fit: { iterations: 0, converged: false },
      reporting: { merged: false, caveat: REGIONAL_CAVEAT } });
    expect(empty).not.toHaveProperty("ranges");
    for (const genotype of ["--", "A", "./.", "0/1", "A/A/A", "I/D"]) {
      expect(estimateRegionalAdmixture(() => genotype).proportions).toBeNull();
    }
  });
  it.each([0.09999999, 0.1, 0.10000001])("uses unrounded strictly-above trigger at %s", mid => {
    const q = shares(0.7, mid, 0.05), result = regionalReporting(q);
    expect(result.merged).toBe(mid > 0.1);
    const measured = reportedRows(REGIONAL_POPS.map(pop => q[pop]), "accepted-all-three");
    expect(measured.some(row => row.members.length > 1)).toBe(result.merged);
    if (result.merged) expect(measured[0].members.map(k => REGIONAL_POPS[k])).toEqual(["EUR", "MID", "CSA"]);
  });
  it("requires two confused-region components and carries the unequal-resolution caveat", () => {
    expect(regionalReporting(shares(0.7, 0.05, 0.05)).merged).toBe(false);
    expect(regionalReporting(shares(0.3, 0.25, 0.2))).toMatchObject({ merged: true, caveat: REGIONAL_CAVEAT });
  });
  it("only counts literal or unambiguous complementary diploid marker calls", () => {
    const marker = REGIONAL_AIMS.find(m => m.ref === "C" && m.alt === "T")!;
    const from = (genotype: string) => estimateRegionalAdmixture((c, p) => c === marker.chrom && p === marker.pos38 ? genotype : null);
    expect(from("C/T").markersUsed).toBe(1);
    expect(from("G/A").proportions).toEqual(from("C/T").proportions);
    expect(from("C/A").markersUsed).toBe(0);
  });
  it("matches the analytical first update for two observed ALT copies", () => {
    // With equal prior group weights, one ALT copy gives posterior odds
    // 1:2:3:4:5:6:7. Two ALT copies give the same proportions, totaling 28 parts.
    const fit = fitRegionalMixtureDetailed([[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]], [2], { maxIterations: 1 });
    const expected = [1 / 28, 2 / 28, 3 / 28, 4 / 28, 5 / 28, 6 / 28, 7 / 28];
    fit.q.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 15));
    expect(fit).toMatchObject({ iterations: 1, converged: false });
  });
  it("returns deterministic full-precision fits and honest calculation-limit diagnostics", () => {
    const input = new Map(REGIONAL_AIMS.map((m, i) => [`${m.chrom}:${m.pos38}`, i % 3 === 0 ? `${m.alt}/${m.alt}` : `${m.ref}/${m.alt}`]));
    const read = (c: number, p: number) => input.get(`${c}:${p}`) ?? null;
    const result = estimateRegionalAdmixture(read);
    expect(estimateRegionalAdmixture(read)).toEqual(result);
    expect(result.markersUsed).toBe(168);
    expect(Object.values(result.proportions!).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(result.reporting).toEqual(regionalReporting(result.proportions));
    expect(result).not.toHaveProperty("ranges");
    const limited = fitRegionalMixtureDetailed([[0.01, 0.99, 0.2, 0.3, 0.4, 0.5, 0.6]], [2], { maxIterations: 1 });
    expect(limited).toMatchObject({ iterations: 1, converged: false });
    expect(() => fitRegionalMixtureDetailed([[0.5]], [2])).toThrow();
    expect(() => fitRegionalMixtureDetailed([REGIONAL_POPS.map(() => 0.5)], [3])).toThrow();
  });
});
