/**
 * The single rule both lineage readers use to turn a stored genotype into the
 * one base a haploid marker can be read at. It is pinned here rather than in
 * either caller, because the whole point of it existing is that the legacy
 * process route and the canonical ancestry builder cannot drift apart and
 * give one file two haplogroups.
 */
import { describe, expect, it } from "vitest";
import { lineageBaseFromGenotype } from "./haplogroups";

describe("lineageBaseFromGenotype", () => {
  it("reads a haploid call, which is what the VCF parser writes for GT 1", () => {
    for (const base of ["A", "C", "G", "T"]) expect(lineageBaseFromGenotype(base)).toBe(base);
  });

  it("reads a call whose every allele agrees, at any ploidy", () => {
    // Pipelines encode these chromosomes both ways. A genotype in which every
    // observed copy is the same base names that base whatever its arity, so
    // the rule is agreement rather than a diploid special case.
    expect(lineageBaseFromGenotype("A/A")).toBe("A");
    expect(lineageBaseFromGenotype("T/T/T")).toBe("T");
  });

  it("refuses a heterozygous call instead of taking an allele from it", () => {
    // THE POINT OF THE FUNCTION. On a haploid chromosome a heterozygous call
    // means something upstream went wrong — a nuclear mitochondrial insertion,
    // heteroplasmy, a pseudoautosomal misalignment. The line this replaced took
    // the first allele, which turns that into a confident branch.
    expect(lineageBaseFromGenotype("A/G")).toBeNull();
    expect(lineageBaseFromGenotype("G/A")).toBeNull();
    expect(lineageBaseFromGenotype("A/A/G")).toBeNull();
  });

  it("refuses everything that is not a called base, and never throws", () => {
    for (const genotype of ["--", "./.", ".", "", "N", "A/", "/A", "AA", "A|G", "-", "0/0", "<NON_REF>"]) {
      expect(lineageBaseFromGenotype(genotype)).toBeNull();
    }
    expect(lineageBaseFromGenotype(null)).toBeNull();
    expect(lineageBaseFromGenotype(undefined)).toBeNull();
  });

  it("returns a base only for bases, never a deletion the tree may define", () => {
    // mtDNA B's 8281 carries der "-", which this can never return: a deletion
    // is not a base and must not be matched by one.
    expect(lineageBaseFromGenotype("-")).toBeNull();
    expect(lineageBaseFromGenotype("-/-")).toBeNull();
  });
});
