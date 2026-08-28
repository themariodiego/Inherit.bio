import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toLines } from "./lines";
import { parseVcf } from "./vcf";

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

async function* fromString(text: string): AsyncIterable<string> {
  for (const line of text.split("\n")) yield line;
}

const HEADER =
  "##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1\n";

describe("parseVcf: fixture", () => {
  it("parses sample.vcf", async () => {
    const result = await parseVcf(toLines(createReadStream(fixture("sample.vcf"))));
    expect(result.build).toBe("GRCh38");
    expect(result.skipped).toBe(1); // the ./. row
    expect(result.records).toEqual([
      { rsid: 1, chrom: 1, pos: 100, ref: "A", alt: "G", genotype: "A/G" },
      // multiallelic 1/2: only GT-referenced alts, sorted genotype
      { rsid: 2, chrom: 1, pos: 200, ref: "C", alt: "T,G", genotype: "G/T" },
      { rsid: null, chrom: 1, pos: 300, ref: "G", alt: "A", genotype: "A/A" },
      // haploid GT 1 on Y
      { rsid: 6, chrom: 24, pos: 600, ref: "C", alt: "T", genotype: "T" },
      // rs5 (0/0) and rs7 (haploid 0) are reference rows: dropped, not counted
    ]);
  });

  it("parses sample.g.vcf, skipping reference blocks", async () => {
    const result = await parseVcf(
      toLines(createReadStream(fixture("sample.g.vcf")))
    );
    expect(result.build).toBe("GRCh37"); // contig ID=1 length pins build 37
    expect(result.skipped).toBe(1); // the ./. block row
    expect(result.records).toEqual([
      { rsid: 10, chrom: 1, pos: 300, ref: "G", alt: "A", genotype: "A/G" },
      // indel alt with trailing <NON_REF>, 1/1
      { rsid: 11, chrom: 1, pos: 500, ref: "C", alt: "CT", genotype: "CT/CT" },
    ]);
  });
});

describe("parseVcf: build detection", () => {
  it("reads ##reference for GRCh37 spellings", async () => {
    for (const ref of ["GRCh37", "hg19", "b37"]) {
      const r = await parseVcf(
        fromString(`##fileformat=VCFv4.2\n##reference=${ref}.fa\n`)
      );
      expect(r.build).toBe("GRCh37");
    }
  });

  it("reads chr-prefixed contig lengths", async () => {
    const r38 = await parseVcf(
      fromString("##contig=<ID=chr1,length=248956422,assembly=whoknows>\n")
    );
    expect(r38.build).toBe("GRCh38");
    const r37 = await parseVcf(
      fromString("##contig=<ID=chr1,length=249250621>\n")
    );
    expect(r37.build).toBe("GRCh37");
  });

  it("ignores non-chr1 contigs and returns unknown when undetectable", async () => {
    const r = await parseVcf(
      fromString("##contig=<ID=chr11,length=135086622>\n##reference=custom.fa\n")
    );
    expect(r.build).toBe("unknown");
  });
});

describe("parseVcf: rows", () => {
  it("reads GT from FORMAT position, not first field", async () => {
    const r = await parseVcf(
      fromString(HEADER + "1\t10\trs9\tA\tC\t.\t.\t.\tDP:GT\t30:0|1\n")
    );
    expect(r.records).toEqual([
      { rsid: 9, chrom: 1, pos: 10, ref: "A", alt: "C", genotype: "A/C" },
    ]);
  });

  it("counts missing GT sub-field and missing FORMAT GT as skipped", async () => {
    const r = await parseVcf(
      fromString(
        HEADER + "1\t10\t.\tA\tC\t.\t.\t.\tDP\t30\n1\t20\t.\tA\tC\t.\t.\t.\tGT\t.\n"
      )
    );
    expect(r.records).toHaveLength(0);
    expect(r.skipped).toBe(2);
  });

  it("skips scaffolds and rows without a sample column", async () => {
    const r = await parseVcf(
      fromString(
        HEADER +
          "chrUn_gl000220\t10\t.\tA\tC\t.\t.\t.\tGT\t0/1\n1\t10\t.\tA\tC\t.\t.\t.\n"
      )
    );
    expect(r.records).toHaveLength(0);
    expect(r.skipped).toBe(2);
  });

  it("drops <NON_REF>-only and hom-ref rows without counting them", async () => {
    const r = await parseVcf(
      fromString(
        HEADER +
          "1\t10\t.\tA\t<NON_REF>\t.\t.\t.\tGT\t0/0\n1\t20\t.\tA\tC\t.\t.\t.\tGT\t0/0\n"
      )
    );
    expect(r.records).toHaveLength(0);
    expect(r.skipped).toBe(0);
  });

  it("skips GT indexes past the ALT list as malformed", async () => {
    const r = await parseVcf(
      fromString(HEADER + "1\t10\t.\tA\tC\t.\t.\t.\tGT\t0/2\n")
    );
    expect(r.records).toHaveLength(0);
    expect(r.skipped).toBe(1);
  });
});
