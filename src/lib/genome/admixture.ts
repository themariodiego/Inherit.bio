// Continental admixture estimator over an ancestry-informative-marker (AIM)
// panel: the union of the Kidd 55-AISNP panel (Kidd et al. 2014, FSI:Genetics)
// and the Seldin 128-AISNP panel (Kosoy et al. 2009, Hum Mutat), with 1000
// Genomes phase-3 superpopulation ALT-allele frequencies fetched from Ensembl.
// See data/ref/AIMS_PROVENANCE.md.

import aimsJson from "../../../data/ref/aims.json";

export type Pop = "AFR" | "AMR" | "EAS" | "EUR" | "SAS";
export const POPS: readonly Pop[] = ["AFR", "AMR", "EAS", "EUR", "SAS"];

export interface AimMarker {
  rsid: string;
  /** Numeric chromosome: 1-22, X=23, Y=24, MT=25. */
  chrom: number;
  /** GRCh38 position. */
  pos38: number;
  ref: string;
  alt: string;
  /** ALT-allele frequency per 1000 Genomes phase-3 superpopulation. */
  freqs: Record<Pop, number>;
}

export const AIMS: AimMarker[] = aimsJson as AimMarker[];

/**
 * Below this fraction of usable panel markers the EM estimate is noise. The
 * one home for the threshold Overview reads; the ancestry page states the same
 * value locally beside its empty-state copy.
 */
export const RELIABLE_FRACTION = 0.25;

export interface ShareRange {
  low: number;
  high: number;
}

export interface AdmixtureResult {
  /** Mixture proportions on the simplex, rounded to 3 decimals, summing to 1. */
  proportions: Record<Pop, number>;
  /** Panel markers with a usable diploid genotype. */
  markersUsed: number;
  note: string;
  /**
   * The interval around each proportion, for the populations that have one.
   * A population is ABSENT here rather than carrying a zero-width interval:
   * every resample put it at the same value, which is not a measurement of
   * spread and must not be printed as though it were one. The surface renders
   * such a row exactly as it renders a result with no intervals at all.
   *
   * The whole field is absent when the caller asked for no intervals, which
   * is how a stored result computed before 2026-09-14 also reads.
   */
  ranges?: Partial<Record<Pop, ShareRange>>;
}

/**
 * Resamples behind each interval. Measured 2026-09-14 over 6 truths x 40 seeds:
 * coverage 94.7% at 100, 94.6% at 200 and 94.8% at 400, with mean width 0.096
 * at all three. So the number buys stability in the tail quantiles and nothing
 * else, and 200 is where it stops paying: ~410 ms per file against ~212 ms at
 * 100 and ~803 ms at 400.
 */
export const RANGE_RESAMPLES = 200;

/**
 * The interval is a measurement of the PANEL's information, so it is not
 * computed at a marker count the panel itself calls unreliable. Below the
 * reliability floor the surface shows no map, and an interval there would be
 * a spread around a number nobody is shown.
 */
const MIN_RANGE_MARKERS = Math.ceil(RELIABLE_FRACTION * AIMS.length);

const CLAMP_LO = 0.001;
const CLAMP_HI = 0.999;
const COMPLEMENT: Record<string, string> = { A: "T", T: "A", C: "G", G: "C" };

/**
 * ALT-allele dosage (0/1/2) for one marker, or null when unusable.
 * Accepts "A/G" or "AG"; requires a diploid genotype whose alleles all match
 * ref/alt directly, or (for non-palindromic pairs) their complements.
 */
function altDosage(genotype: string, ref: string, alt: string): number | null {
  const alleles: string[] = [];
  for (const ch of genotype.toUpperCase()) {
    if (ch in COMPLEMENT) alleles.push(ch);
    else if (ch !== "/") return null; // "-", "I", "D", etc.
  }
  if (alleles.length !== 2) return null;
  if (alleles.every((a) => a === ref || a === alt)) {
    return alleles.filter((a) => a === alt).length;
  }
  if (COMPLEMENT[ref] === alt) return null; // palindromic: strand ambiguous
  const cr = COMPLEMENT[ref];
  const ca = COMPLEMENT[alt];
  if (alleles.every((a) => a === cr || a === ca)) {
    return alleles.filter((a) => a === ca).length;
  }
  return null;
}

/** One panel marker this file could read: its ALT dosage and the clamped reference frequencies. */
interface Observation {
  dosage: number;
  /** Clamped ALT frequency per pop, POPS order. */
  freqs: number[];
}

/** The panel markers this file supplied a usable diploid genotype for. */
function observe(getGenotype: (chrom: number, pos: number) => string | null): Observation[] {
  const obs: Observation[] = [];
  for (const m of AIMS) {
    const genotype = getGenotype(m.chrom, m.pos38);
    if (genotype === null) continue;
    const dosage = altDosage(genotype, m.ref, m.alt);
    if (dosage === null) continue;
    obs.push({
      dosage,
      freqs: POPS.map((p) => Math.min(CLAMP_HI, Math.max(CLAMP_LO, m.freqs[p]))),
    });
  }
  return obs;
}

/**
 * EM on the simplex from a uniform start: maximizes sum over markers of
 * log P(genotype | q), where each allele copy is drawn from superpopulation k
 * with probability q_k and is then ALT with that population's (clamped)
 * ALT-allele frequency — i.e. HWE at the pooled frequency p = sum_k q_k p_k.
 * Returns the unrounded mixture, POPS order.
 */
function fit(obs: readonly Observation[]): number[] {
  const K = POPS.length;
  let q = new Array<number>(K).fill(1 / K);
  if (obs.length === 0) return q;
  for (let iter = 0; iter < 1000; iter++) {
    const next = new Array<number>(K).fill(0);
    for (const { dosage, freqs } of obs) {
      let pAlt = 0;
      for (let k = 0; k < K; k++) pAlt += q[k] * freqs[k];
      const pRef = 1 - pAlt;
      for (let k = 0; k < K; k++) {
        // Expected pop-k origins among ALT copies and REF copies of this marker.
        next[k] += dosage * ((q[k] * freqs[k]) / pAlt);
        next[k] += (2 - dosage) * ((q[k] * (1 - freqs[k])) / pRef);
      }
    }
    // Analytically sum(next) = 2 * obs.length, but renormalizing by the
    // actual sum keeps floating-point drift from compounding across iterations.
    const total = next.reduce((a, b) => a + b, 0);
    let delta = 0;
    for (let k = 0; k < K; k++) {
      next[k] /= total;
      delta = Math.max(delta, Math.abs(next[k] - q[k]));
    }
    q = next;
    if (delta < 1e-7) break;
  }
  return q;
}

/**
 * mulberry32. THE SEED IS A CONSTANT AND THAT IS THE POINT: one file must
 * always produce one interval. A clock- or id-derived seed would move a
 * person's published range between two readings of the same result, which is
 * the kind of number this product must never print.
 */
const RESAMPLE_SEED = 0x1e40_5d17;
function resampleRandom(): () => number {
  let a = RESAMPLE_SEED >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The value at a percentile of an ascending column. */
function quantile(ascending: readonly number[], p: number): number {
  const index = Math.round(p * (ascending.length - 1));
  return ascending[Math.min(ascending.length - 1, Math.max(0, index))];
}

/**
 * The interval on each proportion: resample the markers this file supplied,
 * with replacement, re-fit, and PIVOT — low = 2q̂ − q*97.5, high = 2q̂ − q*2.5.
 *
 * THE PIVOT IS THE WHOLE METHOD, and the percentile interval it replaces was
 * measured and rejected. At 168 markers the estimator is biased inward: a
 * person who is entirely one population is estimated at 0.948, and the
 * percentile interval around 0.948 contained the true 1.000 in 0 of 30 seeds.
 * The pivotal form reflects the replicate spread THROUGH the point estimate,
 * which is what corrects the bias: the same measurement gave 95.7% coverage at
 * half the width (2026-09-14, `docs/ancestry-interval.md`).
 *
 * The bias is finite-sample, not structural — the same simulation at 32x the
 * panel returns 0.993 — so this interval describes how little a 168-marker
 * panel can pin down, which is exactly what it is for.
 */
function shareRanges(obs: readonly Observation[], point: readonly number[]): Partial<Record<Pop, ShareRange>> {
  const ranges: Partial<Record<Pop, ShareRange>> = {};
  if (obs.length < MIN_RANGE_MARKERS) return ranges;
  const random = resampleRandom();
  const replicates: number[][] = [];
  for (let b = 0; b < RANGE_RESAMPLES; b++) {
    const sample: Observation[] = new Array(obs.length);
    for (let i = 0; i < obs.length; i++) sample[i] = obs[Math.floor(random() * obs.length)];
    replicates.push(fit(sample));
  }
  POPS.forEach((pop, k) => {
    const column = replicates.map((replicate) => replicate[k]).sort((a, b) => a - b);
    const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
    const low = round(2 * point[k] - quantile(column, 0.975));
    const high = round(2 * point[k] - quantile(column, 0.025));
    // Zero width is not a measurement of spread. Left absent, the row renders
    // exactly as every row did before intervals existed.
    if (high > low) ranges[pop] = { low, high };
  });
  return ranges;
}

export interface AdmixtureOptions {
  /**
   * Whether to measure the interval on each proportion. ON BY DEFAULT, and
   * deliberately so: both paths that STORE a result take the default, and the
   * failure mode of the other default — a stored result quietly carrying no
   * interval — is one a reader would never see. This one fails loudly instead,
   * because it costs `RANGE_RESAMPLES` further fits (~0.4 s at the full
   * panel), so code that estimates in a loop turns it off and says why.
   */
  withRanges?: boolean;
}

/**
 * Supervised admixture estimate, with an interval on each proportion unless
 * the caller asks for none.
 */
export function estimateAdmixture(
  getGenotype: (chrom: number, pos: number) => string | null,
  options: AdmixtureOptions = {},
): AdmixtureResult {
  const obs = observe(getGenotype);
  const q = fit(obs);

  // Round to 3 decimals and repair the sum on the largest component.
  const rounded = q.map((v) => Math.round(v * 1000) / 1000);
  const drift = 1 - rounded.reduce((a, b) => a + b, 0);
  const imax = rounded.indexOf(Math.max(...rounded));
  rounded[imax] = Math.round((rounded[imax] + drift) * 1000) / 1000;

  const proportions = {} as Record<Pop, number>;
  POPS.forEach((p, k) => {
    proportions[p] = rounded[k];
  });

  const note =
    obs.length < 30
      ? `Low confidence: only ${obs.length} of ${AIMS.length} ancestry-informative markers had usable genotypes; proportions are unreliable.`
      : `Estimated from ${obs.length} of ${AIMS.length} ancestry-informative markers (Kidd 55 + Seldin 128 panels, 1000 Genomes phase-3 superpopulation frequencies).`;

  // The interval is taken around the UNROUNDED fit, so the 3-dp sum repair
  // above cannot move one population's interval off its own estimate.
  if (options.withRanges === false) return { proportions, markersUsed: obs.length, note };
  return { proportions, markersUsed: obs.length, note, ranges: shareRanges(obs, q) };
}
