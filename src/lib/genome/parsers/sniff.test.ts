import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sniff } from "./sniff";

const fx = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

describe("sniff", () => {
  it("detects 23andMe txt", () => {
    expect(sniff(fx("23andme.txt"))).toEqual({
      kind: "array_23andme",
      compressed: false,
    });
  });

  it("detects AncestryDNA txt", () => {
    expect(sniff(fx("ancestry.txt"))).toEqual({
      kind: "array_ancestry",
      compressed: false,
    });
  });

  it("detects MyHeritage csv via ##fileformat header", () => {
    expect(sniff(fx("myheritage.csv"))).toEqual({
      kind: "array_myheritage",
      compressed: false,
    });
  });

  it("detects MyHeritage csv via quoted column header alone", () => {
    const bytes = new TextEncoder().encode(
      '"RSID","CHROMOSOME","POSITION","RESULT"\n"rs1","1","100","AA"\n'
    );
    expect(sniff(bytes).kind).toBe("array_myheritage");
  });

  it("detects FamilyTreeDNA csv (unquoted header)", () => {
    expect(sniff(fx("ftdna.csv"))).toEqual({
      kind: "array_ftdna",
      compressed: false,
    });
  });

  it("detects VCF", () => {
    expect(sniff(fx("sample.vcf"))).toEqual({
      kind: "vcf",
      compressed: false,
    });
  });

  it("detects gVCF via <NON_REF>", () => {
    expect(sniff(fx("sample.g.vcf"))).toEqual({
      kind: "gvcf",
      compressed: false,
    });
  });

  it("detects gzipped VCF as compressed", () => {
    expect(sniff(fx("sample.vcf.gz"))).toEqual({
      kind: "vcf",
      compressed: true,
    });
  });

  it("detects BAM (magic inside gzip/bgzf)", () => {
    expect(sniff(fx("tiny.bam"))).toEqual({ kind: "bam", compressed: true });
  });

  it("detects CRAM (raw magic)", () => {
    expect(sniff(fx("tiny.cram"))).toEqual({
      kind: "cram",
      compressed: false,
    });
  });

  it("handles a truncated gzip member", () => {
    const gz = gzipSync(Buffer.from("##fileformat=VCFv4.2\n#CHROM\tPOS\n"));
    expect(sniff(gz.subarray(0, gz.length - 5))).toEqual({
      kind: "vcf",
      compressed: true,
    });
  });

  it("returns null kind for unknown content", () => {
    expect(sniff(new TextEncoder().encode("hello world\nnot genomic\n"))).toEqual(
      { kind: null, compressed: false }
    );
    expect(sniff(new Uint8Array(0))).toEqual({ kind: null, compressed: false });
  });
});
