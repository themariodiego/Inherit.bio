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

/**
 * D-017 SAID THE PANEL CANNOT TELL EUR FROM AMR. It can, and this measures it
 * rather than arguing about it.
 *
 * The defect recorded that a fixture drawn at EUR 0.6 / AFR 0.3 / EAS 0.1 came
 * back as AMR 0.652 / AFR 0.255 / EAS 0.088 / EUR 0.005, and concluded the
 * shipped panel could not separate those two references at 168 markers. Over
 * 200 seeds of the fixture the defect describes, drawn by the helper above,
 * that outcome does not occur once: AMR never exceeds EUR, and EUR never comes
 * near zero.
 *
 * What reproduces the recorded numbers is ONE CHARACTER of the draw. Taking
 * the ALT allele with probability `1 - freqs[pop]` instead of `freqs[pop]`
 * yields EUR 0.000 / AMR 0.588 / AFR 0.139 / EAS 0.273 - the same signature,
 * EUR collapsed and AMR holding the bulk. The defect's own area column says
 * "fixture generation" and its description then blames the panel; the area
 * column was right. Both draws are exercised below so the distinction is held
 * by code and cannot be re-read as a panel limit.
 *
 * The estimator and `aims.json` are byte-identical to what the defect
 * measured on 2026-09-03 (the one commit touching either since only added
 * RELIABLE_FRACTION), so this is not a fix that happened in between.
 */
describe("EUR against AMR on the shipped panel (D-017)", () => {
  const TRUTH = { EUR: 0.6, AFR: 0.3, EAS: 0.1 } as const;
  const SEEDS = 200;

  /** The inverted draw: ALT taken with the REF probability. */
  function invertedLookup(seed: number, weights: Partial<Record<Pop, number>>) {
    const rnd = mulberry32(seed);
    const w = { AFR: 0, AMR: 0, EAS: 0, EUR: 0, SAS: 0, ...weights };
    const byPos = new Map<string, string>();
    for (const m of AIMS) {
      const alleles: string[] = [];
      for (let copy = 0; copy < 2; copy++) {
        let u = rnd();
        let pop: Pop = POPS[POPS.length - 1];
        for (const p of POPS) {
          u -= w[p] ?? 0;
          if (u < 0) {
            pop = p;
            break;
          }
        }
        alleles.push(rnd() < 1 - m.freqs[pop] ? m.alt : m.ref);
      }
      byPos.set(`${m.chrom}:${m.pos38}`, alleles.join("/"));
    }
    return (chrom: number, pos: number) => byPos.get(`${chrom}:${pos}`) ?? null;
  }

  it("never puts more weight on AMR than on EUR for a EUR-majority draw", () => {
    let amrOverEur = 0;
    let eurBelowTenth = 0;
    const eur: number[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = estimateAdmixture(syntheticLookup(seed, TRUTH));
      eur.push(r.proportions.EUR);
      if (r.proportions.AMR > r.proportions.EUR) amrOverEur++;
      if (r.proportions.EUR < 0.1) eurBelowTenth++;
    }
    expect(amrOverEur, "AMR outweighs EUR on a EUR-majority draw").toBe(0);
    expect(eurBelowTenth, "EUR collapses the way D-017 recorded").toBe(0);
    // The truth is 0.6. The mean sits a little under it and the spread is
    // wide at this marker count, which is the real remaining work and is
    // pinned loosely so a genuine regression fails while noise does not.
    const mean = eur.reduce((a, b) => a + b, 0) / eur.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.65);
  });

  it("reproduces the recorded numbers only when the draw inverts REF and ALT", () => {
    const inverted = estimateAdmixture(invertedLookup(1, TRUTH));
    // The signature D-017 recorded: EUR gone, AMR holding the bulk.
    expect(inverted.proportions.EUR).toBeLessThan(0.05);
    expect(inverted.proportions.AMR).toBeGreaterThan(inverted.proportions.EUR);
    // And the correct draw at the same seed does neither.
    const correct = estimateAdmixture(syntheticLookup(1, TRUTH));
    expect(correct.proportions.EUR).toBeGreaterThan(0.3);
    expect(correct.proportions.EUR).toBeGreaterThan(correct.proportions.AMR);
  });
});
