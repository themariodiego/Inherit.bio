import { describe, expect, it } from "vitest";
import { ANCESTRY_RANGE_UNAVAILABLE } from "@/lib/figures/contract";
import { percentOneDecimal } from "@/lib/figures/natural-frequency";
import { AIMS, POPS, estimateAdmixture, type Pop } from "@/lib/genome/admixture";
import {
  BAND_SMALL,
  OPACITY_FLOOR,
  UNASSIGNABLE,
  WELL_SUPPORTED_MIN,
  apportionShares,
  band,
  chipValues,
  fillOpacity,
  hatched,
  lowerBound,
  percentFromTenths,
  presentShares,
  regionAccessibleName,
  shareFromTenths,
  wellSupported,
} from "./present";
import { REGIONS } from "./regions";

// Deterministic PRNG (mulberry32), as src/lib/genome/admixture.test.ts uses.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random point on the simplex over `keys`, with a few coordinates forced to exactly 0. */
function continuousSimplex(rnd: () => number, keys: readonly string[]): Record<string, number> {
  const raw = keys.map(() => (rnd() < 0.15 ? 0 : -Math.log(1 - rnd())));
  const total = raw.reduce((sum, value) => sum + value, 0) || 1;
  const out: Record<string, number> = {};
  keys.forEach((key, index) => {
    out[key] = raw[index] / total;
  });
  if (Object.values(out).every((value) => value === 0)) out[keys[0]] = 1;
  return out;
}

/** The estimator's own rounding: 3 dp, sum repaired on the largest component (admixture.ts). */
function threeDecimalSimplex(rnd: () => number, keys: readonly string[]): Record<string, number> {
  const continuous = continuousSimplex(rnd, keys);
  const rounded = keys.map((key) => Math.round(continuous[key] * 1000) / 1000);
  const drift = 1 - rounded.reduce((sum, value) => sum + value, 0);
  const imax = rounded.indexOf(Math.max(...rounded));
  rounded[imax] = Math.round((rounded[imax] + drift) * 1000) / 1000;
  const out: Record<string, number> = {};
  keys.forEach((key, index) => {
    out[key] = rounded[index];
  });
  return out;
}

const KEYS = [...POPS, UNASSIGNABLE] as const;

describe("band", () => {
  it("is half-open at every boundary on the continuous share", () => {
    expect(band(0.0199)).toBe("possible but not established");
    expect(band(0.02)).toBe("a small part");
    expect(band(0.0999)).toBe("a small part");
    expect(band(0.1)).toBe("a noticeable part");
    expect(band(0.2999)).toBe("a noticeable part");
    expect(band(0.3)).toBe("a large part");
    expect(band(0)).toBe("possible but not established");
    expect(band(1)).toBe("a large part");
  });

  it("is never changed by display rounding", () => {
    expect(percentOneDecimal(0.2996)).toBe("30.0");
    expect(band(0.2996)).toBe("a noticeable part");
    expect(percentOneDecimal(0.0196)).toBe("2.0");
    expect(band(0.0196)).toBe("possible but not established");
  });
});

describe("lowerBound, fillOpacity, hatch and the toggle", () => {
  it("falls back to the point while no interval exists", () => {
    expect(lowerBound({ point: 0.3 })).toBe(0.3);
    expect(lowerBound({ point: 0.3, range: { low: 0.2, high: 0.4 } })).toBe(0.2);
  });

  it("uses the lower bound with a 0.15 floor, and a hairline at exactly 0", () => {
    expect(OPACITY_FLOOR).toBe(0.15);
    expect(fillOpacity(0.005)).toBe(0.15);
    expect(fillOpacity(0.15)).toBe(0.15);
    expect(fillOpacity(0.6)).toBe(0.6);
    expect(fillOpacity(1)).toBe(1);
    expect(fillOpacity(0)).toBeNull();
  });

  it("never hatches without an interval, and only for an interval wider than 0.10", () => {
    expect(hatched({ point: 0.5 })).toBe(false);
    expect(hatched({ point: 0.5, range: { low: 0.45, high: 0.55 } })).toBe(false);
    expect(hatched({ point: 0.5, range: { low: 0.4, high: 0.6 } })).toBe(true);
  });

  it("hides a region below 0.02 on its lower bound", () => {
    expect(WELL_SUPPORTED_MIN).toBe(BAND_SMALL);
    expect(wellSupported({ point: 0.0199 })).toBe(false);
    expect(wellSupported({ point: 0.02 })).toBe(true);
    expect(wellSupported({ point: 0.5, range: { low: 0.01, high: 0.9 } })).toBe(false);
  });
});

describe("apportionShares", () => {
  it("sums to exactly 100.0 over 1,000 seeded 3-dp simplex vectors, within 0.1 of naive rounding, zero staying 0.0", () => {
    const rnd = mulberry32(20260903);
    for (let i = 0; i < 1000; i++) {
      const shares = threeDecimalSimplex(rnd, KEYS);
      const tenths = apportionShares(shares);
      expect(Object.values(tenths).reduce((sum, value) => sum + value, 0)).toBe(1000);
      for (const key of KEYS) {
        expect(Number.isInteger(tenths[key])).toBe(true);
        expect(Math.abs(tenths[key] - Math.round(shares[key] * 1000))).toBeLessThanOrEqual(1);
        if (shares[key] === 0) expect(tenths[key]).toBe(0);
      }
      expect(apportionShares(shares)).toEqual(tenths);
    }
  });

  it("holds the same properties on continuous vectors, where naive rounding drifts", () => {
    const rnd = mulberry32(7);
    let drifted = 0;
    for (let i = 0; i < 1000; i++) {
      const shares = continuousSimplex(rnd, KEYS);
      const tenths = apportionShares(shares);
      const naive = KEYS.map((key) => Math.round(shares[key] * 1000));
      if (naive.reduce((sum, value) => sum + value, 0) !== 1000) drifted++;
      expect(Object.values(tenths).reduce((sum, value) => sum + value, 0)).toBe(1000);
      KEYS.forEach((key, index) => {
        expect(Math.abs(tenths[key] - naive[index])).toBeLessThanOrEqual(1);
        if (shares[key] === 0) expect(tenths[key]).toBe(0);
      });
    }
    expect(drifted).toBeGreaterThan(0);
  });

  it("gives leftover tenths to the largest remainders, ties in key order", () => {
    expect(apportionShares({ a: 1 / 3, b: 1 / 3, c: 1 / 3 })).toEqual({ a: 334, b: 333, c: 333 });
    expect(apportionShares({ a: 0.4994, b: 0.5006 })).toEqual({ a: 499, b: 501 });
    expect(apportionShares({ a: 0.4995, b: 0.5005 })).toEqual({ a: 500, b: 500 });
    expect(apportionShares({ a: 0.432, b: 0.568, u: 0 })).toEqual({ a: 432, b: 568, u: 0 });
  });

  it("rejects shares that do not sum to 1 or are negative", () => {
    expect(() => apportionShares({ a: 0.5, b: 0.4 })).toThrow(/sum to 1/);
    expect(() => apportionShares({ a: 1.2, b: -0.2 })).toThrow(/non-negative/);
  });
});

describe("presentShares and chipValues", () => {
  const seeded = (seed: number) => {
    const rnd = mulberry32(seed);
    const proportions = {} as Record<Pop, number>;
    const simplex = threeDecimalSimplex(rnd, POPS);
    for (const pop of POPS) proportions[pop] = simplex[pop];
    return { proportions };
  };

  it("apportions once over the five regions plus u, so a row's value is the same in both toggle states", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const presentation = presentShares(seeded(seed));
      const on = chipValues(presentation, true);
      const off = chipValues(presentation, false);
      expect(on.shownTenths + on.unassignableTenths + on.hiddenTenths).toBe(1000);
      expect(off.shownTenths + off.unassignableTenths + off.hiddenTenths).toBe(1000);
      expect(off.hiddenTenths).toBe(0);
      expect(on.unassignableTenths).toBe(off.unassignableTenths);
      expect(presentation.rows.map((row) => row.tenths)).toEqual(presentShares(seeded(seed)).rows.map((row) => row.tenths));
      const hiddenRows = presentation.rows.filter((row) => !row.wellSupported);
      expect(on.hiddenTenths).toBe(hiddenRows.reduce((sum, row) => sum + row.tenths, 0));
    }
  });

  it("reports u = 0.0 for every estimator output", () => {
    const uniform = estimateAdmixture(() => null);
    expect(presentShares(uniform).unassignable).toEqual({ point: 0, tenths: 0 });
    const rnd = mulberry32(99);
    for (let i = 0; i < 20; i++) {
      const byPos = new Map<string, string>();
      for (const m of AIMS) {
        const pick = () => (rnd() < m.freqs.EUR ? m.alt : m.ref);
        byPos.set(`${m.chrom}:${m.pos38}`, `${pick()}/${pick()}`);
      }
      const result = estimateAdmixture((chrom, pos) => byPos.get(`${chrom}:${pos}`) ?? null);
      const presentation = presentShares(result);
      expect(presentation.unassignable.point).toBe(0);
      expect(presentation.unassignable.tenths).toBe(0);
      expect(presentation.rows.reduce((sum, row) => sum + row.tenths, 0)).toBe(1000);
    }
  });

  it("orders rows by point descending, ties by sort order, and carries band, opacity and support per row", () => {
    const presentation = presentShares({ proportions: { AFR: 0.3, AMR: 0.0, EAS: 0.019, EUR: 0.662, SAS: 0.019 } });
    expect(presentation.rows.map((row) => row.pop)).toEqual(["EUR", "AFR", "EAS", "SAS", "AMR"]);
    const [eur, afr, eas, , amr] = presentation.rows;
    expect(eur.band).toBe("a large part");
    expect(eur.opacity).toBe(0.662);
    expect(eur.tenths).toBe(662);
    expect(percentFromTenths(eur.tenths)).toBe(66.2);
    expect(shareFromTenths(eur.tenths)).toBe(0.662);
    expect(afr.band).toBe("a large part");
    expect(eas.band).toBe("possible but not established");
    expect(eas.opacity).toBe(OPACITY_FLOOR);
    expect(eas.wellSupported).toBe(false);
    expect(amr.opacity).toBeNull();
    expect(amr.tenths).toBe(0);
    expect(amr.hatched).toBe(false);
    expect(presentation.rows.map((row) => row.region.code)).toEqual(
      ["EUR", "AFR", "EAS", "SAS", "AMR"].map((pop) => REGIONS.find((region) => region.superpop === pop)!.code),
    );
    const chips = chipValues(presentation, true);
    expect(chips).toEqual({ shownTenths: 962, unassignableTenths: 0, hiddenTenths: 38 });
  });

  it("uses the lower bound of a supplied interval for opacity, hatch and the toggle", () => {
    const presentation = presentShares(
      { proportions: { AFR: 0.3, AMR: 0.0, EAS: 0.019, EUR: 0.662, SAS: 0.019 } },
      { ranges: { EUR: { low: 0.5, high: 0.8 }, EAS: { low: 0.0, high: 0.05 } } },
    );
    const eur = presentation.rows.find((row) => row.pop === "EUR")!;
    const eas = presentation.rows.find((row) => row.pop === "EAS")!;
    expect(eur.lowerBound).toBe(0.5);
    expect(eur.opacity).toBe(0.5);
    expect(eur.hatched).toBe(true);
    expect(eas.lowerBound).toBe(0);
    expect(eas.opacity).toBeNull();
    expect(eas.tenths).toBe(19);
  });
});

describe("regionAccessibleName", () => {
  it("renders the A.8 form with whole numbers rounded half-up", () => {
    expect(regionAccessibleName("Europe", { point: 0.432 })).toBe(`Europe: 43% (${ANCESTRY_RANGE_UNAVAILABLE})`);
    expect(regionAccessibleName("Europe", { point: 0.432 })).toBe("Europe: 43% (no range yet)");
    expect(regionAccessibleName("Europe", { point: 0.435, range: { low: 0.385, high: 0.485 } })).toBe(
      "Europe: 44% (range 39% to 49%)",
    );
    expect(regionAccessibleName("South Asia", { point: 0.005 })).toBe("South Asia: 1% (no range yet)");
    expect(regionAccessibleName("South Asia", { point: 0 })).toBe("South Asia: 0% (no range yet)");
  });
});
