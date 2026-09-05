import { chromToNumber } from "./types";

export interface ReferenceLocus {
  rsid: number;
  chrom: number;
  pos38: number | null;
  ref: string | null;
  alt: string | null;
}

export interface EnsemblVariation {
  name?: string;
  clinical_significance?: string[];
  mappings?: {
    assembly_name: string;
    seq_region_name: string;
    start: number;
    end: number;
    strand: number;
    allele_string: string;
  }[];
  populations?: { population: string; allele: string; frequency: number }[];
}

/**
 * The variation endpoint's clinical_significance belongs to an rsID, not a
 * bound allele assertion. It must never populate clinvar_significance.
 * Population values are usable only for an exact, forward GRCh38 SNV mapping
 * and the stored ALT. Indels need normalization/reference validation first.
 */
export function bindEnsemblFrequencies(row: ReferenceLocus, variation: EnsemblVariation | undefined) {
  const empty = { gnomad_af: null, gnomad_af_by_pop: null, frequency_binding: null };
  if (!variation || variation.name !== `rs${row.rsid}` || !Number.isSafeInteger(row.rsid) || row.rsid <= 0 ||
      !Number.isInteger(row.chrom) || row.chrom < 1 || row.chrom > 25 ||
      !Number.isSafeInteger(row.pos38) || row.pos38 === null || row.pos38 <= 0 ||
      !row.ref || !row.alt || !/^[ACGT]$/.test(row.ref) || !/^[ACGT]$/.test(row.alt) ||
      row.ref === row.alt) return empty;

  const mappings = (variation.mappings ?? []).filter((m) => m.assembly_name === "GRCh38");
  // Multiple placements leave the population allele's locus ambiguous.
  if (mappings.length !== 1) return empty;
  const mapping = mappings[0];
  const alleles = mapping.allele_string?.split("/") ?? [];
  if (mapping.strand !== 1 || chromToNumber(mapping.seq_region_name) !== row.chrom ||
      mapping.start !== row.pos38 || mapping.end !== row.pos38 || alleles[0] !== row.ref ||
      !alleles.includes(row.alt) || alleles.some((a) => !/^[ACGT]$/.test(a))) return empty;

  const populations = (variation.populations ?? []).filter((p) => p.allele === row.alt);
  // Do not combine genome/exome denominators, and never take the first allele
  // or the minor-allele frequency as a substitute for this ALT's frequency.
  const source = populations.some((p) => p.population === "gnomADg:ALL") ? "gnomADg" : "gnomADe";
  const frequency = (population: string): number | null => {
    const values = populations.filter((p) => p.population === population).map((p) => p.frequency);
    if (!values.length || values.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1)) return null;
    return values.every((v) => v === values[0]) ? values[0] : null;
  };
  const af = frequency(`${source}:ALL`);
  if (af === null) return empty;
  const byPop: Record<string, number> = {};
  for (const p of populations) {
    const match = new RegExp(`^${source}:([A-Za-z0-9_]+)$`).exec(p.population);
    if (!match || match[1] === "ALL") continue;
    const value = frequency(p.population);
    if (value !== null) byPop[match[1]] = value;
  }
  return {
    gnomad_af: af,
    gnomad_af_by_pop: Object.keys(byPop).length ? byPop : null,
    frequency_binding: {
      schema: "allele-v1", source, assembly: "GRCh38", chrom: row.chrom,
      pos: row.pos38, ref: row.ref, alt: row.alt,
    },
  };
}
