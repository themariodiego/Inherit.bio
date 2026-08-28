import { describe, expect, it } from "vitest";
import {
  genotypeKey,
  resolveTemplate,
  resolveVariant,
  type TemplateVariant,
} from "./reports";

const cyp1a2: TemplateVariant = {
  rsid: 762551,
  gene: "CYP1A2",
  chrom: 15,
  pos38: 74749576,
  ref: "A",
  alt: "C",
  interpretations: {
    AA: "fast metabolizer",
    AC: "intermediate",
    CC: "slow metabolizer",
  },
};

describe("genotypeKey", () => {
  it("sorts diploid genotypes", () => {
    expect(genotypeKey("G/A")).toBe("AG");
    expect(genotypeKey("A/G")).toBe("AG");
  });
  it("passes through haploid calls", () => {
    expect(genotypeKey("A")).toBe("A");
  });
  it("returns null for no-calls", () => {
    expect(genotypeKey("-/-")).toBeNull();
    expect(genotypeKey("--")).toBeNull();
  });
});

describe("resolveVariant", () => {
  it("matches direct genotypes", () => {
    expect(resolveVariant(cyp1a2, "C/A")).toMatchObject({
      status: "genotyped",
      genotype: "AC",
      interpretation: "intermediate",
      strandFlipped: false,
    });
  });
  it("reports not-covered when the file lacks the variant", () => {
    expect(resolveVariant(cyp1a2, undefined)).toEqual({
      status: "not-covered",
    });
  });
  it("reports no-call for --", () => {
    expect(resolveVariant(cyp1a2, "--")).toEqual({ status: "no-call" });
  });
  it("accepts a strand-flipped genotype for non-palindromic variants", () => {
    // complement of T/G is A/C -> 'AC'
    expect(resolveVariant(cyp1a2, "T/G")).toMatchObject({
      status: "genotyped",
      genotype: "AC",
      strandFlipped: true,
    });
  });
  it("refuses strand flips on palindromic variants", () => {
    const palindromic: TemplateVariant = {
      ...cyp1a2,
      ref: "A",
      alt: "T",
      interpretations: { AA: "x", AT: "y", TT: "z" },
    };
    // A/T genotype matches directly — fine.
    expect(resolveVariant(palindromic, "A/T").status).toBe("genotyped");
    // G/C cannot be resolved against an A/T variant at all.
    expect(resolveVariant(palindromic, "G/C").status).toBe("unrecognized");
  });
  it("resolves an opposite-strand homozygote via the complement", () => {
    // G/G on an A/C probe is C/C read from the minus strand.
    expect(resolveVariant(cyp1a2, "G/G")).toMatchObject({
      status: "genotyped",
      genotype: "CC",
      strandFlipped: true,
    });
  });
  it("flags unrecognized genotypes", () => {
    // A/G matches neither {A,C} nor its complement {T,G} as a pair.
    expect(resolveVariant(cyp1a2, "A/G")).toEqual({
      status: "unrecognized",
      genotype: "AG",
    });
  });
});

describe("indel variants (e.g. CFTR F508del)", () => {
  // ref=TCTT alt=T deletion; genotypes come out of the VCF parser as
  // 'T/TCTT' etc. and must resolve against sorted no-separator keys.
  const cftr: TemplateVariant = {
    rsid: 113993960,
    gene: "CFTR",
    chrom: 7,
    pos38: 117559591,
    ref: "TCTT",
    alt: "T",
    interpretations: {
      TCTTTCTT: "no F508del allele",
      TTCTT: "one F508del allele (carrier)",
      TT: "two F508del alleles",
    },
  };
  it("resolves a heterozygous carrier genotype", () => {
    expect(resolveVariant(cftr, "T/TCTT")).toMatchObject({
      status: "genotyped",
      genotype: "TTCTT",
      interpretation: "one F508del allele (carrier)",
    });
    // allele order in the genotype must not matter
    expect(resolveVariant(cftr, "TCTT/T")).toMatchObject({
      status: "genotyped",
      genotype: "TTCTT",
    });
  });
  it("resolves both homozygous genotypes", () => {
    expect(resolveVariant(cftr, "TCTT/TCTT").status).toBe("genotyped");
    expect(resolveVariant(cftr, "T/T")).toMatchObject({
      status: "genotyped",
      genotype: "TT",
    });
  });
});

describe("resolveTemplate", () => {
  it("computes covered from outcomes", () => {
    const template = {
      slug: "caffeine",
      category: "lifestyle-wellness",
      title: "t",
      summary: "s",
      evidence: "moderate" as const,
      variants: [cyp1a2],
      pgs_id: null,
      citations: [{ pmid: "16522833", label: "x" }],
    };
    expect(resolveTemplate(template, () => "A/A").covered).toBe(true);
    expect(resolveTemplate(template, () => undefined).covered).toBe(false);
  });
});
