import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFromHeaderLines } from "@/lib/genome/parsers/vcf";
import { configureBody, isPermittedEvidenceLine } from "./ingest-configure";
import { EmbryoTransportError } from "./ingest-lines";
import { EVIDENCE_MAXIMUM_LINES, embryoVcfBuildEvidence } from "./vcf-build-evidence";

/**
 * The browser half of the configure request. Its output must be exactly what
 * the route accepts (`configureBody` and `isPermittedEvidenceLine`), and it
 * must never carry a sample name, the column line or another meta line.
 * Every label marked SYNTHETIC or PRIVATE is invented here.
 */
const PAIR = fs.readFileSync("e2e/fixtures/embryo-pair-grch38.vcf");

describe("embryoVcfBuildEvidence", () => {
  it("reads participant-c's two-embryo file as two samples on GRCh38, with nothing the route refuses", async () => {
    const evidence = await embryoVcfBuildEvidence(new Blob([PAIR]));
    expect(evidence.sampleCount).toBe(2);
    expect(evidence.buildEvidence[0]).toBe("##fileformat=VCFv4.2");
    expect(evidence.buildEvidence.every(isPermittedEvidenceLine)).toBe(true);
    expect(buildFromHeaderLines(evidence.buildEvidence)).toBe("GRCh38");
    expect(configureBody.safeParse({ format: "vcf", ...evidence, nonce: "synthetic-nonce" }).success).toBe(true);
    const text = evidence.buildEvidence.join("\n");
    for (const withheld of ["SAMPLE1", "SAMPLE2", "#CHROM", "##source", "##FORMAT", "rs116422505"]) {
      expect(text).not.toContain(withheld);
    }
  });

  it("keeps the file format and references ahead of a contig list cut at the limit", async () => {
    const contigs = Array.from({ length: 200 }, (_, index) => `##contig=<ID=chrUn_${index},length=1000>`);
    const source = ["##fileformat=VCFv4.3", ...contigs, "##reference=GRCh37", "##SAMPLE=<ID=PRIVATE_LAB_NAME>",
      "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC_A\tSYNTHETIC_B\tSYNTHETIC_C",
      "1\t100\t.\tA\tG\t.\tPASS\t.\tGT\t0/1\t0/0\t1/1", ""].join("\n");
    const evidence = await embryoVcfBuildEvidence(new Blob([source]));
    expect(evidence.buildEvidence).toHaveLength(EVIDENCE_MAXIMUM_LINES);
    expect(evidence.buildEvidence.slice(0, 2)).toEqual(["##fileformat=VCFv4.3", "##reference=GRCh37"]);
    expect(evidence.sampleCount).toBe(3);
    expect(evidence.buildEvidence.join("\n")).not.toContain("PRIVATE_LAB_NAME");
  });

  it("drops an over-long meta line rather than sending part of it", async () => {
    const long = `##contig=<ID=chr1,length=248956422,description="${"x".repeat(600)}">`;
    const source = `##fileformat=VCFv4.2\n##reference=GRCh38\n${long}\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tA\tB\n`;
    const evidence = await embryoVcfBuildEvidence(new Blob([source]));
    expect(evidence.buildEvidence).toEqual(["##fileformat=VCFv4.2", "##reference=GRCh38"]);
  });

  it("refuses what is not a VCF: a PDF, a table, a file with no column line", async () => {
    const cases: [string, EmbryoTransportError["code"]][] = [
      ["%PDF-1.7 synthetic", "pdf_not_data"],
      ["rsid\tchromosome\tposition\n", "unrecognised_format"],
      ["##fileformat=VCFv4.2\n##reference=GRCh38\n", "empty_after_parse"],
      ["##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\n", "unrecognised_format"],
    ];
    for (const [source, code] of cases) {
      await expect(embryoVcfBuildEvidence(new Blob([source]))).rejects.toMatchObject({ code });
    }
  });
});
