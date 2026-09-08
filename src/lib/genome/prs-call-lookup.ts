import type { PrsUserVariant } from "./prs";

export type PrsCallEvidence = PrsUserVariant & { chrom: number; pos: number; usable?: boolean };

// Match computePrs's existing character grammar, without adding dosage or
// strand inference. Multiplicity remains significant: A differs from A/A.
function comparisonKey(genotype: string): string | null {
  const upper = genotype.toUpperCase();
  if (/[^ACGT/]/.test(upper)) return null;
  const letters = upper.replaceAll("/", "");
  return letters ? [...letters].sort().join("") : null;
}

/** One PRS call per target locus, independent of input/store order. Missing,
 * unsupported, filtered or conflicting evidence permanently withholds a locus.
 * Identical allele counts contribute once; no reference call is inferred.
 * ref/alt are retained only by unanimity and do not affect PRS arithmetic. */
export function createPrsCallLookup(...sources: Iterable<PrsCallEvidence>[]): Map<string, PrsUserVariant> {
  const calls = new Map<string, PrsUserVariant>(), blocked = new Set<string>();
  for (const source of sources) for (const row of source) {
    const position = `${row.chrom}:${row.pos}`;
    if (blocked.has(position)) continue;
    const key = comparisonKey(row.genotype), prior = calls.get(position);
    if (row.usable === false || key === null || (prior && comparisonKey(prior.genotype) !== key)) {
      blocked.add(position); calls.delete(position); continue;
    }
    calls.set(position, { genotype: key.split("").join("/"),
      ref: prior && prior.ref !== row.ref ? null : row.ref,
      alt: prior && prior.alt !== row.alt ? null : row.alt });
  }
  // Stable locus order is useful to callers, though computePrs iterates scores.
  return new Map([...calls].sort(([a], [b]) => {
    const [ac, ap] = a.split(":").map(Number), [bc, bp] = b.split(":").map(Number);
    return ac - bc || ap - bp;
  }));
}
