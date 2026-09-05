import { describe, expect, it } from "vitest";
import { countInputLines, emptyReadCounts, INPUT_PROVENANCE_VERSION, readInputSnapshot } from "./input-provenance";
import { parseArray, type ArrayKind } from "./parsers/array";
import { parseVcf } from "./parsers/vcf";

async function* lines(text: string) { yield* text.split("\n"); }
const header = "##reference=GRCh38\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE";
const row = "12\t111803962\trs671\tG\tA\t.\tPASS\t.\tGT\t0/0";

describe("input record counts use the parser's own row rules", () => {
  it.each(["array_myheritage", "array_ftdna"] as const)("shares exact malformed-quote tokenization for %s", async (kind) => {
    for (const text of ['rs1,1,100,"AG', 'rs1,1,100,AG"', 'rs1,1,100,"AG"']) {
      const counts = emptyReadCounts();
      const parsed = await parseArray(countInputLines(lines(text), kind, counts), kind);
      expect(counts.called).toBe(parsed.records.length);
      expect(counts.unsupported).toBe(parsed.skipped);
    }
  });
  it.each(["array_23andme", "array_ancestry", "array_myheritage", "array_ftdna"] as const)("preserves records and separates missing/unsupported rows for %s", async (kind: ArrayKind) => {
    const values = [["rs1", "1", "100", "A", "G"], ["rs2", "garbage", "100", "A", "G"], ["rs3", "1", "200", "0", "0"], ["rs4", "1", "300", "D", "I"]];
    const text = values.map((r) => kind === "array_ancestry" ? r.join("\t") : [r[0], r[1], r[2], r[3] + r[4]].join(kind === "array_23andme" ? "\t" : ",")).join("\n");
    const counts = emptyReadCounts();
    const observed = await parseArray(countInputLines(lines(text), kind, counts), kind);
    expect(observed).toEqual(await parseArray(lines(text), kind));
    expect(counts).toMatchObject({ called: observed.records.length, noCall: 1, unsupported: 2, singleSample: true, buildClaim: false });
  });
  it("separates literal calls, no-calls, failed filters and interval anchors", async () => {
    const text = [header, row, row.replace("0/0", "./."), row.replace("PASS", "LowQual"), row.replace("\tA\t", "\t<NON_REF>\t"), row.replace("GT\t", "GT:GT\t"), row.replace("12\t", "garbage\t")].join("\n");
    const counts = emptyReadCounts();
    const parsed = await parseVcf(countInputLines(lines(text), "vcf", counts));
    expect(parsed).toEqual(await parseVcf(lines(text)));
    expect(counts).toEqual({ called: 2, noCall: 1, failedFilter: 1, blocks: 1, unsupported: 2, singleSample: true, buildClaim: true });
  });
  it.each(["##contig=<ID=chr2,length=242193529>", "##reference=unrecognised"])("does not certify an unrecognised build header: %s", async (claim) => {
    const counts = emptyReadCounts();
    await parseVcf(countInputLines(lines(`${claim}\n${row}`), "vcf", counts));
    expect(counts.buildClaim).toBe(false);
    expect(counts.singleSample).toBe(false);
  });
  it("marks multi-sample and repeated headers as unsuitable for a one-sample read rate", async () => {
    for (const text of [`${header}\tOTHER\n${row}\t0/1`, `${header}\n${row}\n${header}\n${row}`, `${row}\n${header}\n${row}`]) {
      const counts = emptyReadCounts();
      await parseVcf(countInputLines(lines(text), "vcf", counts));
      expect(counts.singleSample).toBe(false);
    }
  });
});

describe("completion-bound provenance", () => {
  const digest = "a".repeat(64);
  const snapshot = { version: INPUT_PROVENANCE_VERSION, sourceSha256: digest, completedAt: "2026-09-06T00:00:00.000Z", sourceBuild: "GRCh38", buildBasis: "source-declared", targetBuild: "GRCh38", chainSha256: null, variantRowsMapped: 1, variantRowsUnmapped: 0, counts: emptyReadCounts() };
  it("accepts equivalent PostgREST timestamp syntax and the exact hash", () => {
    expect(readInputSnapshot(snapshot, "2026-09-06T00:00:00+00:00", "annotated", digest)).toEqual(snapshot);
  });
  it.each([null, {}, { ...snapshot, version: "old" }, { ...snapshot, counts: { called: 1 } }, { ...snapshot, sourceBuild: "GRCh37" }, { ...snapshot, completedAt: "bad" }])("keeps unknown/malformed historical facts unknown", (raw) => {
    expect(readInputSnapshot(raw, snapshot.completedAt, "annotated", digest)).toBeNull();
  });
  it("refuses stale hash, completion or processing state", () => {
    expect(readInputSnapshot(snapshot, snapshot.completedAt, "parsing", digest)).toBeNull();
    expect(readInputSnapshot(snapshot, snapshot.completedAt, "failed", digest)).toBeNull();
    expect(readInputSnapshot(snapshot, snapshot.completedAt, "annotated", "b".repeat(64))).toBeNull();
    expect(readInputSnapshot(snapshot, "2026-09-06T00:00:01Z", "annotated", digest)).toBeNull();
  });
});
