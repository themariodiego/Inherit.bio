/** Seven-region reference fit. Historical five-region analyses keep admixture.ts. */
import table from "../../../data/ref/aims-seven-region.json";

export const REGIONAL_POPS = ["AFR", "AMR", "CSA", "EAS", "EUR", "MID", "OCE"] as const;
export type RegionalPop = (typeof REGIONAL_POPS)[number];
export type RegionalProportions = Record<RegionalPop, number>;
export interface RegionalMarker {
  rsid: string; chrom: number; pos38: number; ref: string; alt: string;
  freqs: RegionalProportions;
}
export const REGIONAL_AIMS: readonly RegionalMarker[] = Object.freeze(table.map(marker =>
  Object.freeze({ ...marker, freqs: Object.freeze({ ...marker.freqs }) })));
// Held-out fits still moved by 0.23 percentage points after 10,000 steps;
// all evaluated residuals settled within this bound. See reference provenance.
export const REGIONAL_FIT_LIMIT = 50_000;
export const REGIONAL_FIT_TOLERANCE = 1e-7;
export const REGIONAL_MERGE_THRESHOLD = 0.10;
export const REGIONAL_CONFUSABLE = ["EUR", "MID", "CSA"] as const;
export const REGIONAL_REPORTING_POLICY = "merge-eur-mid-csa-v1";
export const REGIONAL_CAVEAT = "This panel cannot tell real mixed ancestry from its own errors between these regions. These shares may reflect either. It combines both, so people with mixed ancestry lose separate region detail more often.";
export const REGIONAL_RANGE_NOTE = "These shares describe broad matches to reference groups. This seven-region model has no tested range yet. The groups do not cover all people or places.";
export const REGIONAL_UNSETTLED_NOTE = "The fit reached its calculation limit, so these shares may still change with more fitting steps.";
export const REGIONAL_EMPTY_NOTE = "No usable ancestry markers were read. No region shares were computed.";

export function regionalReporting(proportions: RegionalProportions | null) {
  return { policy: REGIONAL_REPORTING_POLICY, threshold: REGIONAL_MERGE_THRESHOLD,
    merged: proportions !== null && REGIONAL_CONFUSABLE.filter(pop => proportions[pop] > REGIONAL_MERGE_THRESHOLD).length >= 2,
    caveat: REGIONAL_CAVEAT } as const;
}

export interface RegionalFit { q: number[]; converged: boolean; iterations: number }
/** Same bounded EM fit used by the held-out measurement; no marker imputation. */
export function fitRegionalMixtureDetailed(frequencies: readonly (readonly number[])[], dosages: readonly number[],
  options: { maxIterations?: number } = {}): RegionalFit {
  const K = REGIONAL_POPS.length;
  const limit = options.maxIterations ?? REGIONAL_FIT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50_000
    || frequencies.length !== dosages.length || frequencies.length === 0
    || dosages.some(d => d !== 0 && d !== 1 && d !== 2)
    || frequencies.some(row => row.length !== K || row.some(f => !Number.isFinite(f) || f < 0 || f > 1))) {
    throw new Error("Invalid regional ancestry observations");
  }
  const rows = frequencies.map(row => row.map(f => Math.max(0.001, Math.min(0.999, f))));
  let q = new Array<number>(K).fill(1 / K);
  for (let iteration = 1; iteration <= limit; iteration++) {
    const next = new Array<number>(K).fill(0);
    for (let m = 0; m < rows.length; m++) {
      const fr = rows[m];
      let pa = 0;
      for (let k = 0; k < K; k++) pa += q[k] * fr[k];
      const pr = 1 - pa;
      for (let k = 0; k < K; k++) next[k] += dosages[m] * ((q[k] * fr[k]) / pa)
        + (2 - dosages[m]) * ((q[k] * (1 - fr[k])) / pr);
    }
    const total = next.reduce((a, b) => a + b, 0);
    let delta = 0;
    for (let k = 0; k < K; k++) { next[k] /= total; delta = Math.max(delta, Math.abs(next[k] - q[k])); }
    q = next;
    if (delta < REGIONAL_FIT_TOLERANCE) return { q, converged: true, iterations: iteration };
  }
  return { q, converged: false, iterations: limit };
}
export function fitRegionalMixture(frequencies: readonly (readonly number[])[], dosages: readonly number[]): number[] {
  return fitRegionalMixtureDetailed(frequencies, dosages).q;
}

const COMPLEMENT: Record<string, string> = { A: "T", T: "A", C: "G", G: "C" };
/** Literal diploid calls, or unambiguous opposite-strand array calls. */
function dosage(genotype: string, marker: RegionalMarker): number | null {
  if (!/^[ACGT](?:\/?[ACGT])$/i.test(genotype)) return null;
  const alleles = genotype.toUpperCase().replace("/", "").split("");
  if (alleles.every(a => a === marker.ref || a === marker.alt)) return alleles.filter(a => a === marker.alt).length;
  if (COMPLEMENT[marker.ref] === marker.alt) return null;
  if (alleles.every(a => a === COMPLEMENT[marker.ref] || a === COMPLEMENT[marker.alt])) {
    return alleles.filter(a => a === COMPLEMENT[marker.alt]).length;
  }
  return null;
}

export interface RegionalAdmixtureResult {
  /** Full precision, before presentation rounding; absent data has no invented simplex. */
  proportions: RegionalProportions | null;
  markersUsed: number;
  note: string;
  reporting: ReturnType<typeof regionalReporting>;
  fit: Omit<RegionalFit, "q">;
}
export function estimateRegionalAdmixture(getGenotype: (chrom: number, pos: number) => string | null): RegionalAdmixtureResult {
  const frequencies: number[][] = [], dosages: number[] = [];
  for (const marker of REGIONAL_AIMS) {
    const genotype = getGenotype(marker.chrom, marker.pos38);
    const d = genotype === null ? null : dosage(genotype, marker);
    if (d === null) continue;
    frequencies.push(REGIONAL_POPS.map(pop => marker.freqs[pop])); dosages.push(d);
  }
  if (dosages.length === 0) return { proportions: null, markersUsed: 0, note: REGIONAL_EMPTY_NOTE,
    reporting: regionalReporting(null), fit: { converged: false, iterations: 0 } };
  const { q, converged, iterations } = fitRegionalMixtureDetailed(frequencies, dosages);
  const proportions = Object.fromEntries(REGIONAL_POPS.map((pop, k) => [pop, q[k]])) as RegionalProportions;
  return { proportions, markersUsed: dosages.length,
    note: converged ? REGIONAL_RANGE_NOTE : `${REGIONAL_RANGE_NOTE} ${REGIONAL_UNSETTLED_NOTE}`,
    reporting: regionalReporting(proportions), fit: { converged, iterations } };
}
