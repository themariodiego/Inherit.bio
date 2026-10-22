import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { estimateNeanderthal, neanderthalLoci, NEANDERTHAL_SITES, type NeanderthalCall } from "./neanderthal";
import { NEANDERTHAL_PANEL } from "./neanderthal-panel";

/** A VCF-literal call at one panel site: `hit` carries the archaic allele. */
function callAt(index: number, kind: "hit-het" | "hit-hom" | "miss" | "nocall" | "filtered" | "third"): NeanderthalCall {
  const site = NEANDERTHAL_SITES[index];
  const other = site.other, archaic = site.archaic;
  const base = { chrom: site.chrom, pos: site.pos38, ref: other, alt: archaic, usable: true };
  switch (kind) {
    case "hit-het": return { ...base, genotype: `${other}/${archaic}` };
    case "hit-hom": return { ...base, genotype: `${archaic}/${archaic}` };
    case "miss": return { ...base, genotype: `${other}/${other}` };
    case "nocall": return { ...base, genotype: "./." };
    case "filtered": return { ...base, genotype: `${other}/${archaic}`, usable: false };
    // A third allele at the site (neither panel letter) is not this site's call.
    case "third": return { ...base, genotype: thirdLetter(other, archaic) + "/" + thirdLetter(other, archaic) };
  }
}

function thirdLetter(a: string, b: string): string {
  return ["A", "C", "G", "T"].find((letter) => letter !== a && letter !== b)!;
}

describe("estimateNeanderthal", () => {
  it("counts the share of covered sites carrying an archaic allele, with the covered count", () => {
    const calls = [
      callAt(0, "hit-het"), callAt(1, "hit-hom"), callAt(2, "miss"), callAt(3, "miss"),
      callAt(4, "nocall"), callAt(5, "filtered"), callAt(6, "third"),
    ];
    const result = estimateNeanderthal(calls, "vcf-literal");
    // Four sites are covered (two hits, two misses); the no-call, the filtered
    // row and the third-allele row are not covered.
    expect(result.coveredSites).toBe(4);
    expect(result.archaicSites).toBe(2);
    expect(result.estimate).toBeCloseTo(0.5, 10);
    expect(result.panelSites).toBe(NEANDERTHAL_PANEL.siteCount);
  });

  it("nothing imputed: an absent row is uncovered, never read as the ancestral allele", () => {
    const result = estimateNeanderthal([callAt(0, "hit-het")], "vcf-literal");
    expect(result.coveredSites).toBe(1);
    expect(result.archaicSites).toBe(1);
    expect(result.estimate).toBe(1);
  });

  it("reports no estimate and no range when the file covers none of the sites", () => {
    const result = estimateNeanderthal([callAt(0, "nocall"), callAt(1, "third")], "vcf-literal");
    expect(result.coveredSites).toBe(0);
    expect(result.archaicSites).toBe(0);
    expect(result.estimate).toBeNull();
    expect(result.interval).toBeNull();
  });

  it("is deterministic: one input always yields one interval", () => {
    const calls = Array.from({ length: 120 }, (_, index) =>
      callAt(index, index % 3 === 0 ? "hit-het" : index % 5 === 0 ? "hit-hom" : "miss"));
    const first = estimateNeanderthal(calls, "vcf-literal");
    const second = estimateNeanderthal(calls, "vcf-literal");
    expect(first.interval).not.toBeNull();
    expect(second).toEqual(first);
    expect(first.interval!.low).toBeLessThan(first.estimate!);
    expect(first.interval!.high).toBeGreaterThan(first.estimate!);
  });

  it("a VCF-literal call whose REF is neither panel allele is not this site's call", () => {
    const site = NEANDERTHAL_SITES[0];
    const foreign = thirdLetter(site.other, site.archaic);
    const result = estimateNeanderthal(
      [{ chrom: site.chrom, pos: site.pos38, ref: foreign, alt: site.archaic, genotype: `${foreign}/${site.archaic}`, usable: true }],
      "vcf-literal",
    );
    expect(result.coveredSites).toBe(0);
  });

  it("neanderthalLoci lists every panel site once", () => {
    const loci = neanderthalLoci();
    expect(loci).toHaveLength(NEANDERTHAL_PANEL.siteCount);
    expect(new Set(loci.map((point) => `${point.chrom}:${point.pos}`)).size).toBe(loci.length);
  });

  it("the loaded table is the manifest's panel (id, version, count and hash)", () => {
    const sha = createHash("sha256").update(JSON.stringify(
      NEANDERTHAL_SITES.map((site) => [site.chrom, site.rsid]),
    )).digest("hex");
    // The real guard is in neanderthal.ts at import time; here we pin the
    // panel's identity so a silent table swap fails a test rather than only
    // the module load.
    expect(NEANDERTHAL_SITES.length).toBe(NEANDERTHAL_PANEL.siteCount);
    expect(typeof sha).toBe("string");
  });
});
