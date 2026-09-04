import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { narrow, sniff, sniffV2 } from "./sniff";

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

  it("detects MyHeritage csv via comment block with unquoted header", () => {
    // Some real exports: '#'-comment block naming the vendor, then a header
    // row identical to FTDNA's. Must not be classified as ftdna.
    const bytes = new TextEncoder().encode(
      "# MyHeritage DNA raw data.\n# For personal use only.\nRSID,CHROMOSOME,POSITION,RESULT\nrs1,1,100,AA\n"
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

describe("sniffV2", () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  it("answers the fixed V1 kind for every existing fixture through the wrapper", () => {
    const expected: Record<string, { kind: string; compressed: boolean }> = {
      "23andme.txt": { kind: "array_23andme", compressed: false },
      "ancestry.txt": { kind: "array_ancestry", compressed: false },
      "myheritage.csv": { kind: "array_myheritage", compressed: false },
      "ftdna.csv": { kind: "array_ftdna", compressed: false },
      "sample.vcf": { kind: "vcf", compressed: false },
      "sample.g.vcf": { kind: "gvcf", compressed: false },
      "sample.vcf.gz": { kind: "vcf", compressed: true },
      "tiny.bam": { kind: "bam", compressed: true },
      "tiny.cram": { kind: "cram", compressed: false },
    };
    for (const [name, answer] of Object.entries(expected)) {
      expect(narrow(sniffV2(fx(name))), name).toEqual(answer);
      expect(sniff(fx(name)), name).toEqual(answer);
    }
  });

  it("answers a null count when the #CHROM line is cut off by the head window or a truncated gzip member", () => {
    // Padding comments push the header across the 64 KiB decode window.
    const padding = "##contig=<ID=" + "x".repeat(60) + ">\n";
    let text = "##fileformat=VCFv4.2\n";
    while (text.length < 65536 - 40) text += padding;
    const straddling = text + "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tEmbryo_1\tEmbryo_2\tEmbryo_3\n1\t100\t.\tA\tG\t.\t.\t.\tGT\t0/1\t0/0\t1/1\n";
    expect(straddling.indexOf("#CHROM")).toBeLessThan(65536);
    expect(straddling.indexOf("Embryo_3")).toBeGreaterThan(65536);
    expect(sniffV2(encode(straddling))).toEqual({ kind: "vcf", compressed: false, sampleCount: null, sampleNames: [] });
    // A head handed over mid-line, and a gzip member cut inside the header line.
    const full = "##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tE1\tE2\tE3\n1\t1\t.\tA\tG\t.\t.\t.\tGT\t0/1\t0/0\t1/1\n";
    const cut = encode(full.slice(0, full.indexOf("E2") + 1));
    expect(sniffV2(cut)).toEqual({ kind: "vcf", compressed: false, sampleCount: null, sampleNames: [] });
    const gz = gzipSync(Buffer.from(full));
    // Whatever decompresses before the truncation point ends inside the header line.
    expect(sniffV2(gz.subarray(0, gz.length - 30)).sampleCount).toBeNull();
  });

  it("ignores trailing whitespace on the #CHROM line rather than counting an empty sample", () => {
    const trailingTab = encode("##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1\t\n");
    expect(sniffV2(trailingTab)).toEqual({ kind: "vcf", compressed: false, sampleCount: 1, sampleNames: ["S1"] });
    const trailingSpace = encode("##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1\tS2 \n");
    expect(sniffV2(trailingSpace)).toMatchObject({ kind: "vcf_multisample", sampleCount: 2, sampleNames: ["S1", "S2"] });
  });

  it("counts the sample columns of a VCF and names a multi-sample file", () => {
    const one = encode("##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1\n");
    expect(sniffV2(one)).toEqual({ kind: "vcf", compressed: false, sampleCount: 1, sampleNames: ["S1"] });
    const three = encode("##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tE1\tE2\tE3\n1\t100\t.\tA\tG\t.\t.\t.\tGT\t0/1\t0/0\t1/1\n");
    expect(sniffV2(three)).toEqual({ kind: "vcf_multisample", compressed: false, sampleCount: 3, sampleNames: ["E1", "E2", "E3"] });
    // The wrapper narrows a multi-sample file to `vcf`, as before.
    expect(sniff(three)).toEqual({ kind: "vcf", compressed: false });
    // A gzipped multi-sample file keeps the count.
    expect(sniffV2(gzipSync(Buffer.from(three)))).toMatchObject({ kind: "vcf_multisample", compressed: true, sampleCount: 3 });
  });

  it("answers a null count when the #CHROM line is beyond the head, and zero for a sites-only VCF", () => {
    const noHeader = encode("##fileformat=VCFv4.2\n##contig=<ID=1>\n");
    expect(sniffV2(noHeader)).toEqual({ kind: "vcf", compressed: false, sampleCount: null, sampleNames: [] });
    const sitesOnly = encode("##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n");
    expect(sniffV2(sitesOnly)).toEqual({ kind: "vcf", compressed: false, sampleCount: 0, sampleNames: [] });
  });

  it("names a PDF by its magic and the wrapper still answers null", () => {
    const pdf = encode("%PDF-1.7\n%âãÏÓ\n1 0 obj\n");
    expect(sniffV2(pdf)).toEqual({ kind: "pdf", compressed: false, sampleCount: null, sampleNames: [] });
    expect(sniff(pdf)).toEqual({ kind: null, compressed: false });
  });

  it("names a laboratory table under the header rule and the wrapper still answers null", () => {
    const table = encode("Embryo,SNP,Chromosome,Position,Call\nE1,rs1,1,100,AA\n");
    expect(sniffV2(table)).toEqual({ kind: "pgt_table", compressed: false, sampleCount: null, sampleNames: [] });
    expect(sniff(table)).toEqual({ kind: null, compressed: false });
    // Two fields only: not a table.
    expect(sniffV2(encode("Sample,Call\nE1,AA\n")).kind).toBeNull();
    // A leading comment block is skipped like the vendor rows do.
    expect(sniffV2(encode("# exported by a laboratory\nSpecimen\tMarker\tResult\n")).kind).toBe("pgt_table");
  });

  it("keeps the vendor detections ahead of the table rule", () => {
    expect(sniffV2(encode("RSID,CHROMOSOME,POSITION,RESULT\nrs1,1,100,AA\n")).kind).toBe("array_ftdna");
    expect(sniffV2(encode('"RSID","CHROMOSOME","POSITION","RESULT"\n')).kind).toBe("array_myheritage");
  });
});
