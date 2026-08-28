import { describe, expect, it } from "vitest";
import { AIMS, POPS, estimateAdmixture, type Pop } from "./admixture";

// Deterministic PRNG (mulberry32) so synthetic genotypes are stable.
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

/** Draw one diploid genotype: each allele copy picks a pop by `weights`, then ALT with that pop's AF. */
function drawGenotype(rnd: () => number, freqs: Record<Pop, number>, weights: Record<Pop, number>): string {
  const alleles: string[] = [];
  for (let copy = 0; copy < 2; copy++) {
    let u = rnd();
    let pop: Pop = POPS[POPS.length - 1];
    for (const p of POPS) {
      u -= weights[p] ?? 0;
      if (u < 0) {
        pop = p;
        break;
      }
    }
    alleles.push(rnd() < freqs[pop] ? "alt" : "ref");
  }
  return alleles.join("|");
}

/** Build a getGenotype over the real AIM panel from per-marker synthetic draws. */
function syntheticLookup(seed: number, weights: Partial<Record<Pop, number>>) {
  const rnd = mulberry32(seed);
  const w = { AFR: 0, AMR: 0, EAS: 0, EUR: 0, SAS: 0, ...weights };
  const byPos = new Map<string, string>();
  for (const m of AIMS) {
    const drawn = drawGenotype(rnd, m.freqs, w)
      .split("|")
      .map((a) => (a === "alt" ? m.alt : m.ref))
      .join("/");
    byPos.set(`${m.chrom}:${m.pos38}`, drawn);
  }
  return (chrom: number, pos: number) => byPos.get(`${chrom}:${pos}`) ?? null;
}

describe("aims.json panel", () => {
  it("has >=120 fully resolved biallelic SNP markers", () => {
    expect(AIMS.length).toBeGreaterThanOrEqual(120);
    for (const m of AIMS) {
      expect(m.rsid).toMatch(/^rs\d+$/);
      expect(m.chrom).toBeGreaterThanOrEqual(1);
      expect(m.chrom).toBeLessThanOrEqual(25);
      expect(m.pos38).toBeGreaterThan(0);
      expect(m.ref).toMatch(/^[ACGT]$/);
      expect(m.alt).toMatch(/^[ACGT]$/);
      expect(m.ref).not.toBe(m.alt);
      for (const p of POPS) {
        expect(m.freqs[p]).toBeGreaterThanOrEqual(0);
        expect(m.freqs[p]).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("estimateAdmixture", () => {
  it.each([["EUR"], ["AFR"], ["EAS"]] as const)(
    "recovers >=85%% weight for a synthetic single-population %s genome",
    (pop) => {
      const result = estimateAdmixture(syntheticLookup(42, { [pop]: 1 }));
      expect(result.markersUsed).toBe(AIMS.length);
      expect(result.proportions[pop]).toBeGreaterThanOrEqual(0.85);
      const sum = POPS.reduce((a, p) => a + result.proportions[p], 0);
      expect(sum).toBeCloseTo(1, 6);
    },
  );

  it("lands within +-15pp on a 50/50 EUR-EAS synthetic mix", () => {
    const result = estimateAdmixture(syntheticLookup(7, { EUR: 0.5, EAS: 0.5 }));
    expect(Math.abs(result.proportions.EUR - 0.5)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(result.proportions.EAS - 0.5)).toBeLessThanOrEqual(0.15);
  });

  it("markersUsed reflects missing genotypes and flags low confidence", () => {
    const full = syntheticLookup(1, { EUR: 1 });
    const kept = new Set(AIMS.slice(0, 20).map((m) => `${m.chrom}:${m.pos38}`));
    const sparse = estimateAdmixture((chrom, pos) =>
      kept.has(`${chrom}:${pos}`) ? full(chrom, pos) : null,
    );
    expect(sparse.markersUsed).toBe(20);
    expect(sparse.note).toMatch(/low confidence/i);

    const complete = estimateAdmixture(full);
    expect(complete.markersUsed).toBe(AIMS.length);
    expect(complete.note).not.toMatch(/low confidence/i);
  });

  it("returns uniform proportions when no genotypes are available", () => {
    const result = estimateAdmixture(() => null);
    expect(result.markersUsed).toBe(0);
    expect(result.note).toMatch(/low confidence/i);
    for (const p of POPS) expect(result.proportions[p]).toBeCloseTo(0.2, 3);
  });
});
