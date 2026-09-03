import { describe, expect, it } from "vitest";
import {
  GENE_PADDING,
  LOCUS_HALF_WINDOW,
  formatLocus,
  locusAround,
  locusSpanning,
  parseLocusQuery,
} from "./locus";

describe("parseLocusQuery", () => {
  it("centres a window on a single position", () => {
    expect(parseLocusQuery("chr15:74749576")).toEqual({
      kind: "locus",
      locus: { chrom: 15, start: 74744576, end: 74754576 },
    });
    expect(LOCUS_HALF_WINDOW).toBe(5000);
  });

  it("accepts a range with or without the chr prefix, grouping commas and surrounding space", () => {
    expect(parseLocusQuery("chr20:1000000-1100000")).toEqual({
      kind: "locus",
      locus: { chrom: 20, start: 1000000, end: 1100000 },
    });
    expect(parseLocusQuery(" 15:74,749,000-74,750,000 ")).toEqual({
      kind: "locus",
      locus: { chrom: 15, start: 74749000, end: 74750000 },
    });
  });

  it("orders a reversed range and clamps the start at 1", () => {
    expect(parseLocusQuery("chr1:200-100")).toEqual({
      kind: "locus",
      locus: { chrom: 1, start: 100, end: 200 },
    });
    expect(parseLocusQuery("chr1:0-10")).toEqual({
      kind: "locus",
      locus: { chrom: 1, start: 1, end: 10 },
    });
    expect(parseLocusQuery("chr1:3000")).toEqual({
      kind: "locus",
      locus: { chrom: 1, start: 1, end: 3000 + LOCUS_HALF_WINDOW },
    });
  });

  it("maps X, Y and the mitochondrial names to the numeric chromosomes", () => {
    expect(parseLocusQuery("chrX:1-100")).toEqual({ kind: "locus", locus: { chrom: 23, start: 1, end: 100 } });
    expect(parseLocusQuery("y:1-100")).toEqual({ kind: "locus", locus: { chrom: 24, start: 1, end: 100 } });
    expect(parseLocusQuery("MT:1-100")).toEqual({ kind: "locus", locus: { chrom: 25, start: 1, end: 100 } });
    expect(parseLocusQuery("chrM:1-100")).toEqual({ kind: "locus", locus: { chrom: 25, start: 1, end: 100 } });
  });

  it("reports a locus-shaped query on an unknown chromosome, and rejects a space inside the name", () => {
    expect(parseLocusQuery("chr99:1-100")).toEqual({ kind: "unknown-chromosome" });
    expect(parseLocusQuery("chrT:1-100")).toEqual({ kind: "unknown-chromosome" });
    expect(parseLocusQuery("chr1X:1-100")).toEqual({ kind: "unknown-chromosome" });
    // The former pattern's character class contained a stray space and so
    // read "chr M" and "M T" as chromosome names.
    expect(parseLocusQuery("chr M:1-100")).toBeNull();
    expect(parseLocusQuery("M T:1-100")).toBeNull();
  });

  it("returns null for anything that is not locus-shaped", () => {
    for (const query of ["rs762551", "CYP1A2", "caffeine", "chr15", "chr15:", "chr15:12a", "", "15-100"]) {
      expect(parseLocusQuery(query), query).toBeNull();
    }
  });
});

describe("locus helpers", () => {
  it("builds the window around an rsID hit", () => {
    expect(locusAround(15, 74749576)).toEqual({ chrom: 15, start: 74744576, end: 74754576 });
    expect(locusAround(1, 10)).toEqual({ chrom: 1, start: 1, end: 5010 });
  });

  it("spans a gene's positions with padding, and has no span without positions", () => {
    expect(locusSpanning(15, [74749576, 74760000, 74755000])).toEqual({
      chrom: 15,
      start: 74749576 - GENE_PADDING,
      end: 74760000 + GENE_PADDING,
    });
    expect(locusSpanning(15, [])).toBeNull();
    expect(locusSpanning(2, [500])).toEqual({ chrom: 2, start: 1, end: 500 + GENE_PADDING });
  });

  it("formats without thousands grouping and with the chromosome name", () => {
    expect(formatLocus({ chrom: 15, start: 74744576, end: 74754576 })).toBe("chr15:74744576-74754576");
    expect(formatLocus({ chrom: 23, start: 1, end: 100 })).toBe("chrX:1-100");
    expect(formatLocus({ chrom: 25, start: 1, end: 100 })).toBe("chrMT:1-100");
  });
});
