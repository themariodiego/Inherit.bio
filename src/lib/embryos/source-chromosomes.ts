import register from "../../../docs/route-register.json";
import { chromToNumber } from "../genome/types";

// Source retention is separate from the autosomal analysis/model rules.
const stored = new Set<number>(register.policyContracts["embryo-source-and-output-v2"].storedChromosomes.map(name => {
  const chrom = chromToNumber(name);
  if (typeof chrom !== "number" || !Number.isInteger(chrom) || chrom < 1 || chrom > 24) {
    throw new Error("Invalid embryo source chromosome contract");
  }
  return chrom;
}));

export function isEmbryoSourceChromosome(chrom: number): boolean {
  return Number.isInteger(chrom) && stored.has(chrom);
}

/** Normalize aliases before applying the same source rule on both sides. */
export function embryoSourceChromosome(raw: string): number | null {
  const normalized = raw.replace(/^chr/i, "").toUpperCase();
  const chrom = normalized === "23" ? 23 : normalized === "24" ? 24 : chromToNumber(raw);
  return typeof chrom === "number" && isEmbryoSourceChromosome(chrom) ? chrom : null;
}
