import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAXIMUM_MAPPING_DECISIONS,
  PGT_DETECTION_MINIMUM_FIELDS,
  PGT_FIELDS,
  detectPgtHeader,
  isForbiddenHeaderCell,
  normaliseHeaderCell,
  planMapping,
  resolveHeaderCell,
  splitHeaderLine,
} from "./pgt-table";

/**
 * The laboratory-table header rule (brief A.6 lines 2188-2192; register
 * `genetic-file-ingest-v1.pgtTable`): exact equality after normalisation,
 * never a substring; at least three of the six fields; the mapping plan
 * needs zero decisions for a clean header, at most four otherwise, and
 * names neutral column indexes only; a sex, gender or karyotype header is
 * forbidden and never resolves.
 */

const SYNONYMS = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "data/ref/lab-tables/column-synonyms.json"), "utf8"),
) as { schemaVersion: number; fields: Record<string, string[]>; forbidden: string[] };

describe("the synonym table", () => {
  it("is schema 1, lower-case, alphanumeric, unique and names the brief's mandated synonyms", () => {
    expect(SYNONYMS.schemaVersion).toBe(1);
    expect(Object.keys(SYNONYMS.fields)).toEqual([...PGT_FIELDS]);
    const all = Object.values(SYNONYMS.fields).flat();
    for (const name of [...all, ...SYNONYMS.forbidden]) expect(name).toMatch(/^[a-z0-9]+$/);
    expect(new Set([...all, ...SYNONYMS.forbidden]).size).toBe(all.length + SYNONYMS.forbidden.length);
    // brief line 2188: chromosome→chrom, position→pos, snp/marker→rsid, call/result→genotype, specimen→sample.
    expect(resolveHeaderCell("chromosome")).toBe("chrom");
    expect(resolveHeaderCell("position")).toBe("pos");
    expect(resolveHeaderCell("snp")).toBe("rsid");
    expect(resolveHeaderCell("marker")).toBe("rsid");
    expect(resolveHeaderCell("call")).toBe("genotype");
    expect(resolveHeaderCell("result")).toBe("genotype");
    expect(resolveHeaderCell("specimen")).toBe("sample");
    for (const field of PGT_FIELDS) expect(resolveHeaderCell(field)).toBe(field);
  });
});

describe("normalisation and exact equality", () => {
  it("lower-cases and strips every non-alphanumeric character", () => {
    expect(normaliseHeaderCell(" Sample_ID ")).toBe("sampleid");
    expect(normaliseHeaderCell("RS ID")).toBe("rsid");
    expect(normaliseHeaderCell("Embryo #")).toBe("embryo");
    expect(normaliseHeaderCell("\"Chromosome\"")).toBe("chromosome");
  });

  it("never matches by substring or prefix", () => {
    expect(resolveHeaderCell("sample quality")).toBeNull();
    expect(resolveHeaderCell("genotype_call_confidence")).toBeNull();
    expect(resolveHeaderCell("chromosomes")).toBeNull();
    expect(resolveHeaderCell("rsids")).toBeNull();
    expect(resolveHeaderCell("positional")).toBeNull();
    expect(resolveHeaderCell("")).toBeNull();
  });

  it("names the forbidden sex, gender and karyotype headers and never resolves them", () => {
    for (const cell of ["Sex", "GENDER", "karyotype", "Embryo sex", "sex_chromosomes"]) {
      expect(isForbiddenHeaderCell(cell), cell).toBe(true);
      expect(resolveHeaderCell(cell), cell).toBeNull();
    }
    expect(isForbiddenHeaderCell("sample")).toBe(false);
  });
});

describe("detectPgtHeader", () => {
  it("splits on tab when present, otherwise comma, stripping quotes", () => {
    expect(splitHeaderLine("a\tb,c\td\r")).toEqual({ delimiter: "\t", cells: ["a", "b,c", "d"] });
    expect(splitHeaderLine('"Sample","SNP","Call"')).toEqual({ delimiter: ",", cells: ["Sample", "SNP", "Call"] });
  });

  it("classifies a table when at least three of the six fields resolve", () => {
    expect(PGT_DETECTION_MINIMUM_FIELDS).toBe(3);
    const header = detectPgtHeader("Embryo,SNP,Call");
    expect(header).not.toBeNull();
    expect(header!.resolved).toEqual(["embryo", "rsid", "genotype"]);
    expect(header!.columns.embryo).toEqual([0]);
    expect(header!.columnCount).toBe(3);
    expect(detectPgtHeader("Specimen\tChromosome\tPosition\tResult")!.resolved).toEqual(["sample", "chrom", "pos", "genotype"]);
  });

  it("refuses a header with fewer than three fields, or three columns of one field", () => {
    expect(detectPgtHeader("Sample,Call")).toBeNull();
    expect(detectPgtHeader("Sample,Call,Quality")).toBeNull();
    expect(detectPgtHeader("SNP,rsid,marker")).toBeNull();
    expect(detectPgtHeader("hello world")).toBeNull();
    expect(detectPgtHeader("")).toBeNull();
  });

  it("reports forbidden columns by index without resolving them", () => {
    const header = detectPgtHeader("Embryo,Sex,SNP,Genotype")!;
    expect(header.forbidden).toEqual([1]);
    expect(header.resolved).toEqual(["embryo", null, "rsid", "genotype"]);
  });
});

describe("planMapping", () => {
  it("needs zero decisions for each of four real-shaped headers", () => {
    const headers = [
      "Embryo,SNP,Genotype",
      "Sample ID\tChromosome\tPosition\tCall",
      '"Specimen","rsID","Chrom","Pos","Result"',
      "embryo_id,marker,chromosome,position,gt,quality",
    ];
    for (const line of headers) {
      const plan = planMapping(detectPgtHeader(line)!);
      expect(plan, line).not.toBeNull();
      expect(plan!.complete, line).toBe(true);
    }
    const plan = planMapping(detectPgtHeader('"Specimen","rsID","Chrom","Pos","Result"')!);
    expect(plan).toEqual({
      complete: true,
      identifier: { field: "sample", column: 0 },
      genotype: 4,
      locus: { kind: "rsid", column: 1 },
    });
    const byPosition = planMapping(detectPgtHeader("Sample ID\tChromosome\tPosition\tCall")!);
    expect(byPosition).toEqual({
      complete: true,
      identifier: { field: "sample", column: 0 },
      genotype: 3,
      locus: { kind: "chrom-pos", chrom: 1, pos: 2 },
    });
  });

  it("prefers the embryo column when both an embryo and a sample column resolve", () => {
    const plan = planMapping(detectPgtHeader("Sample,Embryo,SNP,Call")!);
    expect(plan).toMatchObject({ complete: true, identifier: { field: "embryo", column: 1 } });
  });

  it("asks at most four neutral decisions for an ambiguous header, naming indexes only", () => {
    // Two genotype columns, no identifier that resolves, a locus by position.
    const header = detectPgtHeader("Well,Chromosome,Position,Call,Result")!;
    const plan = planMapping(header);
    expect(plan).not.toBeNull();
    expect(plan!.complete).toBe(false);
    const { decisions } = plan as { complete: false; decisions: { field: string; candidates: readonly number[] }[] };
    expect(decisions.length).toBeLessThanOrEqual(MAXIMUM_MAPPING_DECISIONS);
    expect(decisions).toEqual([
      { field: "sample", candidates: [0] },
      { field: "genotype", candidates: [3, 4] },
    ]);
    for (const decision of decisions) {
      for (const candidate of decision.candidates) expect(Number.isInteger(candidate)).toBe(true);
    }
    expect(JSON.stringify(plan)).not.toMatch(/Well|Call|Result/);
  });

  it("returns null when a decision has no column left to choose", () => {
    // Three fields resolve (embryo, chrom, pos) but genotype is missing and every column is spoken for.
    expect(planMapping(detectPgtHeader("Embryo,Chromosome,Position")!)).toBeNull();
  });

  it("caps the plan at four decisions: the identifier, the genotype, the chromosome and the position", () => {
    expect(MAXIMUM_MAPPING_DECISIONS).toBe(4);
    // Every field duplicated: one decision each for the identifier, the genotype, chrom and pos.
    const four = detectPgtHeader("Embryo,Embryo,Call,Result,Chrom,Chromosome,Pos,Position")!;
    const plan = planMapping(four) as { complete: false; decisions: { field: string; candidates: readonly number[] }[] };
    expect(plan.complete).toBe(false);
    expect(plan.decisions.map((decision) => decision.field)).toEqual(["embryo", "genotype", "chrom", "pos"]);
    expect(plan.decisions.length).toBe(MAXIMUM_MAPPING_DECISIONS);
  });

  it("never offers a forbidden column as a candidate", () => {
    const header = detectPgtHeader("Embryo,Sex,SNP,Chromosome,Quality")!;
    expect(header.forbidden).toEqual([1]);
    const plan = planMapping(header) as { complete: false; decisions: { field: string; candidates: readonly number[] }[] };
    expect(plan.complete).toBe(false);
    expect(plan.decisions).toEqual([{ field: "genotype", candidates: [4] }]);
  });
});
