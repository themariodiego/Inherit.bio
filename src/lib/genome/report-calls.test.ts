import { describe, expect, it, vi } from "vitest";
import { loadReportCallRows, resolveReportCalls, type ReportCall } from "./report-calls";
import { OBSERVED_CALL_VERSION } from "./observed-calls";
import type { ReportTemplate } from "./reports";
import type { Db } from "./load";

const variant = { rsid: 671, chrom: 12, pos38: 111803962, ref: "G", alt: "A", gene: "ALDH2", interpretations: { GG: "Reference observation", AG: "Alternate observation" } };
const template: ReportTemplate = { slug: "fixture", title: "Fixture", summary: "Fixture", category: "basic-traits", evidence: "emerging", pgs_id: null, citations: [], variants: [variant] };
const call: ReportCall = { file_id: "file", rsid: 671, chrom: 12, pos: 111803962, ref: "G", alt: "A", genotype: "G/G", usable: true };

describe("report-only observed call resolution", () => {
  it("returns actual reference observations and deduplicates agreeing array/VCF rows", () => {
    const result = resolveReportCalls([call, { ...call, ref: null, alt: null }, call], [template, template]);
    expect([...result.genotypes]).toEqual([[671, "G/G"]]);
    expect(result.conflicts.size).toBe(0);
    expect(resolveReportCalls([], [template]).genotypes.size).toBe(0);
  });
  it.each([{ genotype: "A/G" }, { chrom: 1 }, { pos: 1 }, { ref: "C" }, { alt: "T" }])("refuses conflicting observations: %j", (other) => {
    const result = resolveReportCalls([call, { ...call, ...other }], [template]);
    expect(result.genotypes.size).toBe(0);
    expect([...result.conflicts]).toEqual([671]);
  });
  it("failed QC or no-call evidence cannot be hidden by a legacy usable row", () => {
    for (const other of [{ ...call, usable: false }, { ...call, genotype: "--" }]) {
      const result = resolveReportCalls([call, other], [template]);
      expect(result.genotypes.get(671)).toBe("--");
      expect(result.conflicts.size).toBe(0);
    }
  });
  it("requires matching completed extraction hash, version, source build and annotated files", async () => {
    const source = { ...call, source_sha256: "a".repeat(64), extraction_version: OBSERVED_CALL_VERSION, source_build: "GRCh38" };
    const file = { id: "file", build: "GRCh38", observed_call_sha256: source.source_sha256, observed_call_version: OBSERVED_CALL_VERSION };
    const queries: { table: string; eq: ReturnType<typeof vi.fn>; in: ReturnType<typeof vi.fn> }[] = [];
    let observed = [source];
    const db = { from: (table: string) => {
      const query = { table, select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => void) => resolve({ data: table === "genome_files" ? [file] : table === "report_observed_calls" ? observed : [], error: null }) };
      queries.push(query); return query;
    } } as unknown as Db;
    expect((await loadReportCallRows(db, "subject", [671], "owner")).calls).toHaveLength(1);
    expect(queries[0].eq.mock.calls).toContainEqual(["status", "annotated"]);
    for (const query of queries.slice(1)) {
      expect(query.eq.mock.calls).toContainEqual(["subject_id", "subject"]);
      expect(query.eq.mock.calls).toContainEqual(["user_id", "owner"]);
      expect(query.in.mock.calls).toContainEqual(["file_id", ["file"]]);
    }
    for (const changed of [{ source_sha256: "b".repeat(64) }, { extraction_version: "old" }, { source_build: "GRCh37" }]) {
      observed = [{ ...source, ...changed }];
      expect((await loadReportCallRows(db, "subject", [671])).calls).toEqual([]);
    }
  });
});
