import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { computePrs, type PrsScore, type PrsUserVariant } from "./prs";

const DATA_DIR = fileURLToPath(new URL("../../../data/prs", import.meta.url));
const SEED_IDS = ["PGS000011", "PGS000115", "PGS004602"] as const;

function loadSeed(id: string): PrsScore {
  return JSON.parse(readFileSync(path.join(DATA_DIR, `${id}.json`), "utf8")) as PrsScore;
}

function score(overrides: Partial<PrsScore> = {}): PrsScore {
  return {
    pgs_id: "PGSTEST",
    name: "test",
    trait: "test trait",
    n_variants: 3,
    citation: { pmid: null, doi: null, label: "test" },
    source_url: "",
    license_note: "",
    ancestry_note: "",
    variants: [
      { rsid: 1, chrom: 1, pos38: 100, effect_allele: "A", other_allele: "G", weight: 1.0, effect_af: 0.5 },
      { rsid: 2, chrom: 2, pos38: 200, effect_allele: "T", other_allele: "C", weight: 0.5, effect_af: 0.2 },
      // Palindromic A/T pair: must always be skipped.
      { rsid: 3, chrom: 3, pos38: 300, effect_allele: "A", other_allele: "T", weight: 0.4, effect_af: 0.3 },
    ],
    ...overrides,
  };
}

function user(entries: Record<string, string>): Map<string, PrsUserVariant> {
  const m = new Map<string, PrsUserVariant>();
  for (const [key, genotype] of Object.entries(entries)) {
    m.set(key, { genotype, ref: null, alt: null });
  }
  return m;
}

describe("computePrs dosage counting", () => {
  it("counts effect-allele dosage 0, 1 and 2", () => {
    for (const [gt, dosage] of [["G/G", 0], ["A/G", 1], ["A/A", 2]] as const) {
      const r = computePrs(user({ "1:100": gt }), score());
      expect(r.raw).toBeCloseTo(dosage * 1.0, 10);
      expect(r.matched).toBe(1);
    }
  });

  it("matches on the complemented strand for unambiguous pairs", () => {
    // Score is A/G; chip reports opposite strand T/C. T is complement of effect A.
    const r = computePrs(user({ "1:100": "T/C" }), score());
    expect(r.matched).toBe(1);
    expect(r.raw).toBeCloseTo(1.0, 10);
  });

  it("skips palindromic A/T variants even when letters match", () => {
    const r = computePrs(user({ "3:300": "A/A" }), score());
    expect(r.matched).toBe(0);
    expect(r.raw).toBe(0);
  });

  it("treats mismatching alleles and no-calls as uncovered", () => {
    // A/C matches neither {A,G} nor its complement {T,C} in full.
    const r = computePrs(user({ "1:100": "A/C", "2:200": "--" }), score());
    expect(r.matched).toBe(0);
    expect(r.raw).toBe(0);
    expect(r.coverage).toBe(0);
  });

  it("excludes missing variants from raw but reflects them in coverage", () => {
    const r = computePrs(user({ "1:100": "A/A" }), score());
    expect(r.raw).toBeCloseTo(2.0, 10);
    expect(r.matched).toBe(1);
    expect(r.coverage).toBeCloseTo(1 / 3, 10);
  });

  it("covers both non-palindromic variants at most", () => {
    const r = computePrs(user({ "1:100": "A/A", "2:200": "T/C", "3:300": "A/T" }), score());
    expect(r.matched).toBe(2);
    expect(r.coverage).toBeCloseTo(2 / 3, 10);
    expect(r.raw).toBeCloseTo(2 * 1.0 + 1 * 0.5, 10);
  });
});

describe("computePrs percentile", () => {
  it("is ~50 when the score equals the HWE-expected mean, and monotonic in dosage", () => {
    // mean = 2*0.5*1.0 + 2*0.2*0.5 = 1.2; dosages below/at-ish/above straddle it.
    const results = [
      user({ "1:100": "G/G", "2:200": "C/C" }), // raw 0
      user({ "1:100": "A/G", "2:200": "C/C" }), // raw 1.0
      user({ "1:100": "A/G", "2:200": "T/C" }), // raw 1.5
      user({ "1:100": "A/A", "2:200": "T/T" }), // raw 3.0
    ].map((u) => computePrs(u, score()));
    const pcts = results.map((r) => {
      expect(r.percentile).not.toBeNull();
      return r.percentile as number;
    });
    for (let i = 1; i < pcts.length; i++) expect(pcts[i]).toBeGreaterThan(pcts[i - 1]);
    expect(pcts[0]).toBeLessThan(50);
    expect(pcts[3]).toBeGreaterThan(50);

    // Symmetric case: raw exactly at the mean -> z=0, percentile 50.
    const sym = score({
      variants: [
        { rsid: 1, chrom: 1, pos38: 100, effect_allele: "A", other_allele: "G", weight: 1, effect_af: 0.5 },
        { rsid: 2, chrom: 2, pos38: 200, effect_allele: "T", other_allele: "C", weight: 1, effect_af: 0.5 },
      ],
    });
    const r = computePrs(user({ "1:100": "A/G", "2:200": "T/C" }), sym);
    expect(r.zscore).toBeCloseTo(0, 10);
    expect(r.percentile).toBeCloseTo(50, 6);
  });

  it("is null when under 50% of the weight mass has allele frequencies", () => {
    const s = score({
      variants: [
        { rsid: 1, chrom: 1, pos38: 100, effect_allele: "A", other_allele: "G", weight: 1.0, effect_af: null },
        { rsid: 2, chrom: 2, pos38: 200, effect_allele: "T", other_allele: "C", weight: 0.5, effect_af: 0.2 },
      ],
    });
    const r = computePrs(user({ "1:100": "A/A", "2:200": "T/T" }), s);
    expect(r.percentile).toBeNull();
    expect(r.zscore).toBeNull();
    expect(r.raw).toBeCloseTo(2 * 1.0 + 2 * 0.5, 10); // raw still computed
  });

  it("is null when nothing matched", () => {
    const r = computePrs(user({}), score());
    expect(r.percentile).toBeNull();
    expect(r.zscore).toBeNull();
    expect(r.matched).toBe(0);
  });
});

describe("committed PRS seeds", () => {
  for (const id of SEED_IDS) {
    it(`${id} is well-formed`, () => {
      const s = loadSeed(id);
      expect(s.pgs_id).toBe(id);
      expect(s.n_variants).toBe(s.variants.length);
      expect(s.trait.length).toBeGreaterThan(0);
      expect(s.citation.label.length).toBeGreaterThan(0);
      expect(s.ancestry_note.length).toBeGreaterThan(0);
      expect(s.license_note.length).toBeGreaterThan(0);
      for (const v of s.variants) {
        expect(Number.isFinite(v.weight)).toBe(true);
        expect(Number.isInteger(v.pos38) && v.pos38 > 0).toBe(true);
        expect(v.chrom).toBeGreaterThanOrEqual(1);
        expect(v.chrom).toBeLessThanOrEqual(25);
        expect(v.effect_allele).toMatch(/^[ACGT]+$/);
        expect(v.other_allele).toMatch(/^[ACGT]+$/);
        if (v.effect_af !== null) {
          expect(v.effect_af).toBeGreaterThan(0);
          expect(v.effect_af).toBeLessThan(1);
        }
      }
    });

    it(`${id} scores a synthetic homozygous-effect user`, () => {
      const s = loadSeed(id);
      const u = new Map<string, PrsUserVariant>();
      for (const v of s.variants) {
        u.set(`${v.chrom}:${v.pos38}`, {
          genotype: `${v.effect_allele}/${v.effect_allele}`,
          ref: null,
          alt: null,
        });
      }
      const r = computePrs(u, s);
      // Everything matches except strand-ambiguous palindromic variants.
      expect(r.matched).toBeGreaterThan(0.5 * s.variants.length);
      expect(r.coverage).toBeGreaterThan(0.5);
      expect(r.coverage).toBeLessThanOrEqual(1);
      expect(Number.isFinite(r.raw)).toBe(true);
      if (r.percentile !== null) {
        expect(r.percentile).toBeGreaterThanOrEqual(0);
        expect(r.percentile).toBeLessThanOrEqual(100);
      }
    });
  }
});
