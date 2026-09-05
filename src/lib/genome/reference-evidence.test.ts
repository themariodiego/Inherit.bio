import { describe, expect, it } from "vitest";
import { bindEnsemblFrequencies, type EnsemblVariation } from "./reference-evidence";

const locus = { rsid: 1, chrom: 1, pos38: 100, ref: "A", alt: "G" };
const variation: EnsemblVariation = {
  name: "rs1",
  clinical_significance: ["pathogenic"],
  mappings: [{ assembly_name: "GRCh38", seq_region_name: "1", start: 100, end: 100, strand: 1, allele_string: "A/G/T" }],
  populations: [
    { population: "gnomADg:ALL", allele: "A", frequency: 0.9 },
    { population: "gnomADg:ALL", allele: "T", frequency: 0.08 },
    { population: "gnomADg:ALL", allele: "G", frequency: 0.02 },
    { population: "gnomADg:AFR", allele: "G", frequency: 0.03 },
    { population: "gnomADg:AFR", allele: "A", frequency: 0.8 },
    { population: "gnomADe:ALL", allele: "G", frequency: 0.04 },
    { population: "gnomADe:EUR", allele: "G", frequency: 0.05 },
  ],
};
const withheld = { gnomad_af: null, gnomad_af_by_pop: null, frequency_binding: null };

describe("allele-bound reference frequency", () => {
  it("uses only the exact ALT and one dataset, independent of row order", () => {
    const result = bindEnsemblFrequencies(locus, variation);
    expect(result).toEqual({
      gnomad_af: 0.02,
      gnomad_af_by_pop: { AFR: 0.03 },
      frequency_binding: { schema: "allele-v1", source: "gnomADg", assembly: "GRCh38", chrom: 1, pos: 100, ref: "A", alt: "G" },
    });
    expect(result).not.toHaveProperty("clinvar_significance");
    expect(bindEnsemblFrequencies(locus, { ...variation, populations: [...variation.populations!].reverse() })).toEqual(result);
  });

  it("uses exome frequencies consistently when genome frequency is absent", () => {
    const result = bindEnsemblFrequencies(locus, { ...variation, populations: variation.populations!.filter((p) => p.population.startsWith("gnomADe:")) });
    expect(result.gnomad_af).toBe(0.04);
    expect(result.gnomad_af_by_pop).toEqual({ EUR: 0.05 });
    expect(result.frequency_binding?.source).toBe("gnomADe");
  });

  it.each([
    { ...locus, chrom: 2 }, { ...locus, pos38: 101 }, { ...locus, pos38: null },
    { ...locus, ref: "C" }, { ...locus, ref: null }, { ...locus, alt: null },
    { ...locus, alt: "A" }, { ...locus, alt: "G,T" }, { ...locus, alt: "GG" },
    { ...locus, alt: "<DEL>" }, { ...locus, rsid: 2 },
  ])("withholds incompatible stored locus/allele %j", (row) => {
    expect(bindEnsemblFrequencies(row, variation)).toEqual(withheld);
  });

  it.each([
    { assembly_name: "GRCh37" }, { strand: -1 }, { end: 101 },
    { allele_string: "T/G" }, { allele_string: "A/-" }, { seq_region_name: "2" },
  ])("withholds ambiguous or incompatible mapping %j", (change) => {
    expect(bindEnsemblFrequencies(locus, { ...variation, mappings: [{ ...variation.mappings![0], ...change }] })).toEqual(withheld);
  });

  it("withholds absent responses, placements and multiple placements", () => {
    expect(bindEnsemblFrequencies(locus, undefined)).toEqual(withheld);
    expect(bindEnsemblFrequencies(locus, { ...variation, mappings: [] })).toEqual(withheld);
    expect(bindEnsemblFrequencies(locus, { ...variation, mappings: [...variation.mappings!, { ...variation.mappings![0], start: 200 }] })).toEqual(withheld);
  });

  it.each([NaN, Infinity, -0.1, 1.1, 0.2])("withholds invalid/conflicting aggregate frequency %s", (frequency) => {
    expect(bindEnsemblFrequencies(locus, { ...variation, populations: [...variation.populations!, { population: "gnomADg:ALL", allele: "G", frequency }] })).toEqual(withheld);
  });

  it("withholds conflicting population cells without replacing them with another allele", () => {
    const result = bindEnsemblFrequencies(locus, { ...variation, populations: [...variation.populations!, { population: "gnomADg:AFR", allele: "G", frequency: 0.5 }] });
    expect(result.gnomad_af).toBe(0.02);
    expect(result.gnomad_af_by_pop).toBeNull();
  });

  it("keeps measured zero and never complements another allele's frequency", () => {
    expect(bindEnsemblFrequencies(locus, { ...variation, populations: [{ population: "gnomADg:ALL", allele: "G", frequency: 0 }] }).gnomad_af).toBe(0);
    expect(bindEnsemblFrequencies(locus, { ...variation, populations: [{ population: "gnomADg:ALL", allele: "A", frequency: 0.98 }] })).toEqual(withheld);
  });
});
