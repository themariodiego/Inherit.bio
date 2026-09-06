import { describe, expect, it } from "vitest";
import { getSubjectGenotypesByRsid, type Db } from "./load";
import { loadReportCallRows, resolveReportCalls } from "./report-calls";
import type { ReportTemplate } from "./reports";

const rows = [
  { rsid: 1, genotype: "A/G", file_id: "a" },
  { rsid: 1, genotype: "A/G", file_id: "b" },
  { rsid: 2, genotype: "A/A", file_id: "a" },
  { rsid: 2, genotype: "G/G", file_id: "b" },
];
function db(records: unknown[]): Db {
  return { from: (table: string) => {
    const q = { select: () => q, eq: () => q, in: () => q, order: () => q, range: () => q,
      then: (resolve: (value: unknown) => void) => resolve({ data: table === "genome_files"
        ? ["a", "b", "checked-only"].map((id) => ({ id, build: "GRCh38" })) : table === "user_variants" ? records : [], error: null }),
    }; return q;
  } } as unknown as Db;
}

describe("result sources are separate from checked inputs", () => {
  it("retains the exact multi-file conflict and agreement sets without changing legacy genotype semantics", async () => {
    const read = await getSubjectGenotypesByRsid(db(rows), "subject", [1, 2, 3]);
    expect([...read.genotypes]).toEqual([[1, "A/G"]]);
    expect([...read.conflicts]).toEqual([2]);
    expect(read.inputFileIds).toEqual(["a", "b"]);
    expect(read.checkedFileIds).toEqual(["a", "b", "checked-only"]);
    expect([...read.inputFilesByRsid.get(1)!]).toEqual(["a", "b"]);
    expect([...read.inputFilesByRsid.get(2)!]).toEqual(["a", "b"]);
    expect(read.inputFilesByRsid.has(3)).toBe(false);
  });
  it("preserves all checked files when every report position is absent", async () => {
    const read = await loadReportCallRows(db([]), "subject", [1]);
    expect(read.calls).toEqual([]);
    expect(read.checkedFileIds).toEqual(["a", "b", "checked-only"]);
  });
  it("retains mixed covered, conflicting and absent positions without calling checked-only files contributors", async () => {
    const calls = rows.map((row) => ({ ...row, chrom: 1, pos: row.rsid, ref: null, alt: null, usable: true }));
    const read = await loadReportCallRows(db(calls), "subject", [1, 2, 3]);
    const template = { variants: [1, 2, 3].map((rsid) => ({ rsid, chrom: 1, pos38: rsid, ref: "A", alt: "G" })) } as ReportTemplate;
    const result = resolveReportCalls(read.calls, [template]);
    expect(result.genotypes.get(1)).toBe("A/G");
    expect(result.conflicts.has(2)).toBe(true);
    expect(result.genotypes.has(3)).toBe(false);
    expect(read.calls.some((call) => call.file_id === "checked-only")).toBe(false);
    expect(read.checkedFileIds).toContain("checked-only");
  });
});
