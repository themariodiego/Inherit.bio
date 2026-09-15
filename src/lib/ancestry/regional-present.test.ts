import { describe, expect, it } from "vitest";
import { regionalReporting, type RegionalAdmixtureResult, type RegionalProportions } from "@/lib/genome/regional-admixture";
import { presentRegionalShares, regionalChipShares, regionalReportingShapes } from "./regional-present";
import { regionalMapShapes } from "./regional-geometry";

function result(proportions: RegionalProportions): RegionalAdmixtureResult {
  return { proportions, markersUsed: 168, note: "Synthetic presentation test", reporting: regionalReporting(proportions),
    fit: { converged: true, iterations: 1 } };
}
const MIX = { AFR: 0.1, AMR: 0.009, CSA: 0.17, EAS: 0.08, EUR: 0.38, MID: 0.26, OCE: 0.001 };
const tenths = (share: number) => Math.round(share * 1000);

describe("seven-region presentation", () => {
  it("combines all three members before rounding and apportions the disclosure to the combined total", () => {
    const view = presentRegionalShares(result(MIX));
    expect(view.rows.map(row => row.code)).toEqual(["EUR-MID-CSA", "AFR", "EAS", "AMR", "OCE"]);
    expect(view.rows[0].share).toBe(0.81);
    expect(view.split.map(row => row.code)).toEqual(["EUR", "MID", "CSA"]);
    expect(view.split.reduce((sum, row) => sum + tenths(row.share), 0)).toBe(tenths(view.rows[0].share));
  });
  it("keeps seven separate rows when the stored decision is unmerged, including a share exactly at the trigger", () => {
    const view = presentRegionalShares(result({ AFR: 0.7, AMR: 0, CSA: 0.1, EAS: 0, EUR: 0.1, MID: 0.1, OCE: 0 }));
    expect(view.rows).toHaveLength(7); expect(view.split).toEqual([]);
  });
  it("preserves exact displayed totals across filtering and expansion on deterministic varied simplexes", () => {
    for (let seed = 1; seed <= 80; seed++) {
      const values = [3, 11, 19, 29, 37, 43, 53].map((n, i) => (n * seed + i * i) % 97);
      const total = values.reduce((sum, n) => sum + n, 0);
      const proportions = Object.fromEntries(Object.keys(MIX).map((key, i) => [key, values[i] / total])) as RegionalProportions;
      const view = presentRegionalShares(result(proportions));
      expect(view.rows.reduce((sum, row) => sum + tenths(row.share), 0)).toBe(1000);
      for (const filtered of [true, false]) {
        const visible = view.rows.filter(row => !filtered || row.wellSupported);
        const chips = regionalChipShares(view.rows, filtered);
        expect(visible.reduce((sum, row) => sum + tenths(row.share), 0) + tenths(chips.hidden) + tenths(chips.unassignable)).toBe(1000);
      }
      if (view.split.length) expect(view.split.reduce((sum, row) => sum + tenths(row.share), 0))
        .toBe(tenths(view.rows.find(row => row.code === "EUR-MID-CSA")!.share));
      for (const row of view.rows) { expect(row.range).toEqual({ unavailable: true }); expect(row.hatched).toBe(false); }
    }
  });
  it("fails invalid fitted values instead of inventing a share or silently renormalizing bad data", () => {
    for (const bad of [NaN, Infinity, -0.1, 1.1]) expect(() => presentRegionalShares(result({ ...MIX, AFR: bad }))).toThrow();
    expect(() => presentRegionalShares(result({ ...MIX, AFR: 0.2 }))).toThrow();
  });
  it("gives the combined interactive path exactly the three component geometries", () => {
    const original = regionalMapShapes(), combined = regionalReportingShapes(original, true);
    expect(combined.regions).toHaveLength(5);
    expect(combined.regions.find(shape => shape.code === "EUR-MID-CSA")!.d)
      .toBe(original.regions.filter(shape => ["EUR", "MID", "CSA"].includes(shape.code)).map(shape => shape.d).join(""));
    expect(regionalReportingShapes(original, false)).toBe(original);
    expect(original.regions).toHaveLength(7);
  });
});
