// Polygenic score (PRS) engine. Scores are seeded from PGS Catalog
// harmonized (hmPOS_GRCh38) scoring files committed under data/prs/.

export interface PrsVariant {
  /** Numeric part of the rsID (rs12345 -> 12345); null when unknown. */
  rsid: number | null;
  /** Numeric chromosome: 1-22, X=23, Y=24, MT=25. */
  chrom: number;
  /** GRCh38 position. */
  pos38: number;
  effect_allele: string;
  other_allele: string;
  weight: number;
  /** Effect-allele frequency from the scoring file or a reference panel; null when unknown. */
  effect_af: number | null;
}

export interface PrsScore {
  pgs_id: string;
  name: string;
  trait: string;
  n_variants: number;
  citation: { pmid: number | null; doi: string | null; label: string };
  source_url: string;
  license_note: string;
  ancestry_note: string;
  variants: PrsVariant[];
}

export interface PrsUserVariant {
  /** Normalized genotype: diploid "A/G", haploid "A", or "--" for a no-call. */
  genotype: string;
  ref: string | null;
  alt: string | null;
}

export interface PrsResult {
  /** Sum of (effect-allele dosage x weight) over matched variants. */
  raw: number;
  /** matched / score.variants.length. */
  coverage: number;
  /** Number of score variants with a usable genotype. */
  matched: number;
  /** Estimated population percentile (0-100); see computePrs docstring. Null when not computable. */
  percentile: number | null;
  zscore: number | null;
}

const COMPLEMENT: Record<string, string> = { A: "T", T: "A", C: "G", G: "C" };

function isPalindromic(a: string, b: string): boolean {
  return COMPLEMENT[a] === b;
}

/** Abramowitz & Stegun 7.1.26 erf approximation (|error| < 1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Effect-allele dosage for one score variant, or null when unusable.
 *
 * Matching is strand-unambiguous only:
 * - Palindromic effect/other pairs (A/T, C/G) are always skipped — the two
 *   strands are indistinguishable, so the dosage cannot be determined safely.
 * - Otherwise the genotype letters must all belong to {effect, other} on the
 *   reported strand, or all to the complemented pair (chip reported the
 *   opposite strand); anything else (mismatching alleles, no-call, indel
 *   pseudo-genotypes) is unusable.
 */
function effectDosage(genotype: string, effect: string, other: string): number | null {
  const e = effect.toUpperCase();
  const o = other.toUpperCase();
  if (!(e in COMPLEMENT) || !(o in COMPLEMENT) || e === o) return null;
  if (isPalindromic(e, o)) return null;

  const alleles: string[] = [];
  for (const ch of genotype.toUpperCase()) {
    if (ch in COMPLEMENT) alleles.push(ch);
    else if (ch !== "/") return null; // "-", "I", "D", etc.
  }
  if (alleles.length === 0) return null;

  if (alleles.every((a) => a === e || a === o)) {
    return alleles.filter((a) => a === e).length;
  }
  const ce = COMPLEMENT[e];
  const co = COMPLEMENT[o];
  if (alleles.every((a) => a === ce || a === co)) {
    return alleles.filter((a) => a === ce).length;
  }
  return null;
}

/**
 * Compute a polygenic score for one user against one PGS Catalog score.
 *
 * `userVariants` is keyed "chrom:pos38" (numeric chromosome, GRCh38 position).
 *
 * raw is the plain weighted allele count over matched variants; missing or
 * unusable variants are excluded from raw and reflected only in coverage.
 *
 * percentile/zscore are a POPULATION-REFERENCE APPROXIMATION, not a personal
 * clinical percentile: the reference distribution is the analytic
 * N(mean = sum 2*p*w, var = sum 2*p*(1-p)*w^2) implied by Hardy-Weinberg
 * equilibrium and the effect-allele frequencies (p) shipped with the score,
 * computed over the matched variants that have a known effect_af (raw is
 * restricted to the same subset for the comparison, so partial coverage
 * yields a percentile of the partial score, not the full one). Those
 * frequencies come from the score's source cohort — see ancestry_note — so
 * the percentile inherits that cohort's ancestry composition and is only a
 * rough guide for anyone else. Both are null when the variants entering the
 * reference carry less than 50% of the score's total weight mass (sum of
 * |weight|), or when the reference variance is zero.
 */
export function computePrs(
  userVariants: Map<string, PrsUserVariant>,
  score: PrsScore,
): PrsResult {
  let raw = 0;
  let matched = 0;
  let rawAf = 0;
  let mean = 0;
  let variance = 0;
  let afWeightMass = 0;
  let totalWeightMass = 0;

  for (const v of score.variants) {
    totalWeightMass += Math.abs(v.weight);
    const user = userVariants.get(`${v.chrom}:${v.pos38}`);
    if (!user) continue;
    const dosage = effectDosage(user.genotype, v.effect_allele, v.other_allele);
    if (dosage === null) continue;
    matched++;
    raw += dosage * v.weight;
    if (v.effect_af !== null) {
      const p = v.effect_af;
      rawAf += dosage * v.weight;
      mean += 2 * p * v.weight;
      variance += 2 * p * (1 - p) * v.weight * v.weight;
      afWeightMass += Math.abs(v.weight);
    }
  }

  const coverage = score.variants.length === 0 ? 0 : matched / score.variants.length;

  let percentile: number | null = null;
  let zscore: number | null = null;
  if (variance > 0 && totalWeightMass > 0 && afWeightMass / totalWeightMass >= 0.5) {
    zscore = (rawAf - mean) / Math.sqrt(variance);
    percentile = 100 * normalCdf(zscore);
  }

  return { raw, coverage, matched, percentile, zscore };
}
