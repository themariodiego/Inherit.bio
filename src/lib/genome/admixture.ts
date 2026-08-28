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

export interface AdmixtureResult {
  /** Mixture proportions on the simplex, rounded to 3 decimals, summing to 1. */
  proportions: Record<Pop, number>;
  /** Panel markers with a usable diploid genotype. */
  markersUsed: number;
  note: string;
}

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

/**
 * Supervised admixture estimate: maximizes sum over markers of
 * log P(genotype | q), where each allele copy is drawn from superpopulation k
 * with probability q_k and is then ALT with that population's (clamped)
 * ALT-allele frequency — i.e. HWE at the pooled frequency p = sum_k q_k p_k.
 * Solved by EM on the simplex from a uniform start.
 */
export function estimateAdmixture(
  getGenotype: (chrom: number, pos: number) => string | null,
): AdmixtureResult {
  interface Obs {
    dosage: number;
    freqs: number[]; // clamped ALT freq per pop, POPS order
  }
  const obs: Obs[] = [];
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

  const K = POPS.length;
  let q = new Array<number>(K).fill(1 / K);
  if (obs.length > 0) {
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
      const total = 2 * obs.length;
      let delta = 0;
      for (let k = 0; k < K; k++) {
        next[k] /= total;
        delta = Math.max(delta, Math.abs(next[k] - q[k]));
      }
      q = next;
      if (delta < 1e-7) break;
    }
  }

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

  return { proportions, markersUsed: obs.length, note };
}
