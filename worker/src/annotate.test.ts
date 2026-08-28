import { describe, expect, it } from "vitest";
import {
  annotateLines,
  chromToNumber,
  parseVcfLine,
  type Queryable,
} from "./annotate";

describe("chromToNumber", () => {
  it("maps names to numeric chroms (X=23, Y=24, MT=25)", () => {
    expect(chromToNumber("chr1")).toBe(1);
    expect(chromToNumber("22")).toBe(22);
    expect(chromToNumber("X")).toBe(23);
    expect(chromToNumber("chrY")).toBe(24);
    expect(chromToNumber("MT")).toBe(25);
    expect(chromToNumber("chrM")).toBe(25);
  });

  it("returns null for scaffolds and junk", () => {
    expect(chromToNumber("GL000220.1")).toBeNull();
    expect(chromToNumber("chr23")).toBeNull();
    expect(chromToNumber("")).toBeNull();
  });
});

describe("parseVcfLine", () => {
  it("skips headers and blank lines", () => {
    expect(parseVcfLine("##fileformat=VCFv4.2")).toBeNull();
    expect(parseVcfLine("#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO")).toBeNull();
    expect(parseVcfLine("")).toBeNull();
  });

  it("parses a full data line with genotype from FORMAT/sample", () => {
    const v = parseVcfLine("chr7\t117559590\trs113993960\tCTT\tC\t99\tPASS\t.\tGT:DP\t1/1:30");
    expect(v).toEqual({
      chrom: 7,
      pos: 117559590,
      rsid: 113993960,
      ref: "CTT",
      alt: "C",
      genotype: "1/1",
    });
  });

  it("handles missing rsid, missing sample columns, and X chrom", () => {
    const v = parseVcfLine("chrX\t5000\t.\tT\tC\t.\tPASS\t.");
    expect(v).toEqual({ chrom: 23, pos: 5000, rsid: null, ref: "T", alt: "C", genotype: null });
  });

  it("returns null for scaffolds, short lines, and bad positions", () => {
    expect(parseVcfLine("GL000220.1\t999\trs9\tA\tT\t.\tPASS\t.")).toBeNull();
    expect(parseVcfLine("chr1\t100\trs1\tA\tG")).toBeNull();
    expect(parseVcfLine("chr1\tabc\trs1\tA\tG\t.\tPASS\t.")).toBeNull();
  });
});

interface RefFixture {
  rsid: string;
  chrom: number;
  pos38: number;
  ref: string | null;
  alt: string | null;
  gene_symbol: string | null;
  clinvar_significance: string | null;
}

function mockDb(fixtures: RefFixture[]) {
  const calls: { chroms: number[]; positions: number[] }[] = [];
  const db: Queryable = {
    query: async (_text: string, values?: unknown[]) => {
      const [chroms, positions] = values as [number[], number[]];
      calls.push({ chroms, positions });
      const rows = fixtures.filter((f) =>
        chroms.some((c, i) => c === f.chrom && positions[i] === f.pos38),
      );
      return { rows };
    },
  };
  return { db, calls };
}

const VCF = [
  "##fileformat=VCFv4.2",
  "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE",
  "chr1\t100\trs1\tA\tG\t50\tPASS\t.\tGT:DP\t0/1:30",
  "chr7\t117559590\trs113993960\tCTT\tC\t99\tPASS\t.\tGT\t1/1",
  "chrX\t5000\t.\tT\tC\t.\tPASS\t.",
  "GL000220.1\t999\trs9\tA\tT\t.\tPASS\t.",
].join("\n");

const FIXTURES: RefFixture[] = [
  {
    rsid: "113993960",
    chrom: 7,
    pos38: 117559590,
    ref: "CTT",
    alt: "C",
    gene_symbol: "CFTR",
    clinvar_significance: "Pathogenic",
  },
  {
    rsid: "1",
    chrom: 1,
    pos38: 100,
    ref: "A",
    alt: "G",
    gene_symbol: null,
    clinvar_significance: null,
  },
];

describe("annotateLines", () => {
  it("joins parsed variants against ref_variants and summarizes clinvar hits", async () => {
    const { db } = mockDb(FIXTURES);
    const result = await annotateLines(VCF.split("\n"), db);
    // 3 parseable variants (scaffold line skipped), 2 match ref_variants.
    expect(result.total).toBe(3);
    expect(result.annotated).toBe(2);
    expect(result.clinvar_hits).toEqual([
      {
        rsid: 113993960,
        gene: "CFTR",
        significance: "Pathogenic",
        chrom: 7,
        pos: 117559590,
        ref: "CTT",
        alt: "C",
        genotype: "1/1",
      },
    ]);
  });

  it("dedupes positions per query but counts every matching input variant", async () => {
    const { db, calls } = mockDb(FIXTURES);
    const lines = [
      "chr7\t117559590\trs113993960\tCTT\tC\t99\tPASS\t.",
      "chr7\t117559590\t.\tCTT\tCT\t99\tPASS\t.",
    ];
    const result = await annotateLines(lines, db);
    expect(calls).toHaveLength(1);
    expect(calls[0].chroms).toEqual([7]);
    expect(calls[0].positions).toEqual([117559590]);
    expect(result.total).toBe(2);
    expect(result.annotated).toBe(2);
    expect(result.clinvar_hits).toHaveLength(2);
  });

  it("does not surface conflicting-interpretation rows as clinvar hits", async () => {
    const { db } = mockDb([
      {
        rsid: "42",
        chrom: 2,
        pos38: 200,
        ref: "G",
        alt: "T",
        gene_symbol: "GENE2",
        clinvar_significance: "Conflicting_interpretations_of_pathogenicity",
      },
    ]);
    const result = await annotateLines(["2\t200\trs42\tG\tT\t.\tPASS\t."], db);
    expect(result.annotated).toBe(1);
    expect(result.clinvar_hits).toEqual([]);
  });
});
