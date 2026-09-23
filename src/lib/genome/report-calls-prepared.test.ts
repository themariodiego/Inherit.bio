import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "./load";
import type { ReportTemplate } from "./reports";
import { getSubjectReportCalls, loadReportCallRows, resolveReportCalls, type ReportCall } from "./report-calls";

const mocks = vi.hoisted(() => ({ filter: vi.fn(), page: vi.fn(), source: vi.fn(), close: vi.fn() }));
vi.mock("./own-analysis-access", () => ({ filterOwnAnalysisFiles: mocks.filter, loadOwnReportCallPage: mocks.page }));
vi.mock("./own-prepared-report-calls", () => ({ loadOwnReportCallSource: mocks.source,
  createOwnReportReadScope: () => ({ signal: new AbortController().signal, wait: (p: PromiseLike<unknown>) => Promise.resolve(p),
    consumeEvidence: vi.fn(), close: mocks.close }) }));

const variant = { rsid: 762551, chrom: 15, pos38: 74749576, ref: "A", alt: "C", gene: "CYP1A2", interpretations: {} };
const template: ReportTemplate = { slug: "fixture", title: "Fixture", summary: "Fixture", category: "basic-traits",
  evidence: "emerging", pgs_id: null, citations: [], variants: [variant] };
const call: ReportCall = { file_id: "prepared", rsid: variant.rsid, chrom: variant.chrom, pos: variant.pos38,
  ref: variant.ref, alt: variant.alt, genotype: "A/C", usable: true };
const file = (id: string, legacy = false) => ({ id, status: "annotated", build: "GRCh38",
  single_logical_sample_verified_at: legacy ? null : "2026-09-23T00:00:00Z",
  observed_call_sha256: null, observed_call_version: null });

function database(files = [file("prepared")], legacyCalls: ReportCall[] = []) {
  const tables: string[] = [];
  const db = { from: (table: string) => {
    tables.push(table);
    let start = 0, end = 0;
    let selected: string[] = [];
    const q = { select: () => q, eq: () => q, order: () => q,
      in: (key: string, values: string[]) => { if (key === "file_id") selected = values; return q; },
      range: (from: number, to: number) => { start = from; end = to; return q; },
      then: (resolve: (result: unknown) => void) => resolve({ data: (table === "genome_files" ? files
        : table === "user_variants" ? legacyCalls.filter(c => selected.includes(c.file_id)) : []).slice(start, end + 1), error: null }),
    };
    return q;
  } } as unknown as Db;
  return { db, tables };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.filter.mockImplementation(async (_db, _subject, _purpose, files) => files);
  mocks.page.mockResolvedValue({ data: [], error: null });
});

describe("ordinary report navigation across completed source backends", () => {
  it("returns the prepared genotype without a source URL or database fallback", async () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn().mockResolvedValue([call]);
    mocks.source.mockResolvedValue({ backend: "prepared-object-v1", read, confirm });
    const { db, tables } = database();
    const result = await getSubjectReportCalls(db, "subject", [template], { gateLegacy: true });
    expect(result.genotypes.get(762551)).toBe("A/C");
    expect(result.conflicts.size).toBe(0);
    expect(result.fileCount).toBe(1);
    expect(result.checkedFileIds).toEqual(["prepared"]);
    expect(mocks.source).toHaveBeenCalledWith(db, "prepared", "reports.polygenic", expect.any(Object), "subject");
    expect(read).toHaveBeenCalledWith([762551]);
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.filter.mock.invocationCallOrder[1]);
    expect(mocks.page).not.toHaveBeenCalled();
    expect(tables).toEqual(["genome_files"]);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it.each([
    { description: "a conflicting genotype", other: { genotype: "C/C" }, genotype: undefined, conflict: true },
    { description: "the same rsID at a wrong locus", other: { pos: 1 }, genotype: undefined, conflict: true },
    { description: "an observed no-call", other: { genotype: "--" }, genotype: "--", conflict: false },
    { description: "a failed-quality call", other: { usable: false }, genotype: "--", conflict: false },
  ])("preserves $description across prepared, database and legacy evidence", async ({ other, genotype, conflict }) => {
    mocks.source.mockImplementation(async (_db, id) => id === "prepared"
      ? { backend: "prepared-object-v1", read: async () => [call, { ...call, ...other }], confirm: async () => {} }
      : { backend: "database-v1", confirm: async () => {} });
    mocks.page.mockResolvedValue({ data: [{ ...call, file_id: "database" }], error: null });
    const { db } = database([file("prepared"), file("database"), file("legacy", true)], [{ ...call, file_id: "legacy" }]);
    const loaded = await loadReportCallRows(db, "subject", [762551], undefined, "reports.polygenic");
    const resolved = resolveReportCalls(loaded.calls, [template]);
    expect(loaded.calls).toHaveLength(4);
    expect(loaded.fileCount).toBe(3);
    expect(resolved.genotypes.get(762551)).toBe(genotype);
    expect(resolved.conflicts.has(762551)).toBe(conflict);
  });

  it("still exhausts database pages and sees conflicts after row 1000", async () => {
    mocks.source.mockResolvedValue({ backend: "database-v1", confirm: async () => {} });
    mocks.page.mockImplementation(async (_db, id, _purpose, _rsids, offset) => ({ data: offset === 0
      ? Array.from({ length: 1000 }, () => ({ ...call, file_id: id }))
      : [{ ...call, file_id: id, genotype: "C/C" }], error: null }));
    const { db } = database([file("database")]);
    const result = await getSubjectReportCalls(db, "subject", [template]);
    expect(mocks.page.mock.calls.map(args => args[4])).toEqual([0, 1000]);
    expect(result.calls).toHaveLength(1001);
    expect(result.conflicts.has(762551)).toBe(true);
    expect(result.genotypes.size).toBe(0);
  });

  it("drops all database chunks when a later chunk fails", async () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    mocks.source.mockResolvedValue({ backend: "database-v1", confirm });
    mocks.page.mockResolvedValueOnce({ data: [call], error: null }).mockResolvedValueOnce({ data: null, error: "denied" });
    const { db } = database();
    const result = await loadReportCallRows(db, "subject", Array.from({ length: 201 }, (_, i) => i + 1), undefined, "reports.monogenic");
    expect(mocks.page.mock.calls.map(args => args[3].length)).toEqual([200, 1]);
    expect(result).toEqual({ calls: [], fileCount: 0, checkedFileIds: [] });
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each(["source authorization", "prepared page read"])("never falls back after failed %s, preserving independent legacy evidence", async failure => {
    const denied = async () => { throw new Error("source_changed"); };
    mocks.source.mockImplementation(failure === "source authorization" ? denied : async () => ({
      backend: "prepared-object-v1", read: denied, confirm: vi.fn(),
    }));
    const legacyCall = { ...call, file_id: "legacy" };
    const { db } = database([file("prepared"), file("legacy", true)], [legacyCall]);
    const result = await loadReportCallRows(db, "subject", [762551], undefined, "reports.polygenic");
    expect(result).toEqual({ calls: [legacyCall], fileCount: 1, checkedFileIds: ["legacy"] });
    expect(mocks.page).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it.each(["grant replaced", "completed run replaced", "source changed"])("withholds earlier calls if the final receipt says %s", async reason => {
    mocks.source.mockResolvedValue({ backend: "prepared-object-v1", read: async () => [call],
      confirm: async () => { throw new Error(reason); } });
    const { db } = database();
    expect(await loadReportCallRows(db, "subject", [762551], undefined, "reports.polygenic"))
      .toEqual({ calls: [], fileCount: 0, checkedFileIds: [] });
    expect(mocks.filter).toHaveBeenCalledTimes(2);
  });

  it("withholds calls when the final live file filter rejects the source", async () => {
    const confirm = vi.fn();
    mocks.source.mockResolvedValue({ backend: "prepared-object-v1", read: async () => [call], confirm });
    mocks.filter.mockImplementationOnce(async (_db, _subject, _purpose, files) => files).mockResolvedValueOnce([]);
    const { db } = database();
    expect(await loadReportCallRows(db, "subject", [762551], undefined, "reports.polygenic"))
      .toEqual({ calls: [], fileCount: 0, checkedFileIds: [] });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("leaves Family legacy reads under the existing caller authority", async () => {
    const legacyCall = { ...call, file_id: "legacy" };
    const { db } = database([file("legacy", true)], [legacyCall]);
    const result = await getSubjectReportCalls(db, "relative", [template]);
    expect(result.genotypes.get(762551)).toBe("A/C");
    expect(mocks.source).not.toHaveBeenCalled();
    for (const args of mocks.filter.mock.calls) expect(args[4]).toEqual({ gateLegacy: false });
  });

  it("closes the finite read scope even when final authorization is unavailable", async () => {
    mocks.source.mockResolvedValue({ backend: "prepared-object-v1", read: async () => [call], confirm: vi.fn() });
    mocks.filter.mockImplementationOnce(async (_db, _subject, _purpose, files) => files)
      .mockRejectedValueOnce(new Error("unavailable"));
    const { db } = database();
    await expect(loadReportCallRows(db, "subject", [762551], undefined, "reports.polygenic")).rejects.toThrow("unavailable");
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
