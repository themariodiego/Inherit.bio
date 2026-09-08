import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "./load";
import { loadOwnStoredReportSnapshot } from "./own-stored-report";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn() }));
vi.mock("../uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
const account = "79410000-0000-4000-8000-000000000001", session = "79410000-0000-4000-8000-000000000002";
const subject = "79410000-0000-4000-8000-000000000003", file = "79410000-0000-4000-8000-000000000004";
const db = { rpc: mocks.rpc } as unknown as Db;
const options = { subjectId: subject, fileId: file, slug: "caffeine" };
const template = { slug: "caffeine", category: "basic-traits", title: "Captured caffeine title", summary: "Captured summary",
  evidence: "emerging", layer: "estimate", estimate_kind: "single_locus", pgs_id: null,
  variants: [{ rsid: 762551, gene: "CYP1A2", chrom: 15, pos38: 74749576, ref: "A", alt: "C", interpretations: { AC: "Captured", CC: "Captured" } }],
  citations: [{ pmid: "12345678", label: "Captured study" }] };
const report = { slug: "caffeine", covered: true, conflictingRsids: [] as number[],
  variants: [{ rsid: 762551, outcome: { status: "genotyped", genotype: "AC", interpretation: "Captured", strandFlipped: false } }],
  catalogSnapshot: { schemaVersion: 1, templateSha256: "b".repeat(64), template } };
const source = () => ({ fileId: file, subjectId: subject, purpose: "reports.polygenic", completedAt: "2026-09-07T12:00:00+00:00",
  receipt: "c".repeat(64), reports: [structuredClone(report)], source: { fileId: file, fileType: "vcf", processedAt: "2026-09-07T11:00:00+00:00", snapshot: null } });

const response = () => ({ source: source(), receipt: "f".repeat(64) });
beforeEach(() => { vi.resetAllMocks(); mocks.actor.mockResolvedValue({ accountId: account, sessionId: session });
  mocks.rpc.mockImplementation(async () => ({ data: response(), error: null })); });
describe("exact own saved report", () => {
  it("uses actual actor/session and exact file/slug, returning only captured metadata/outcomes", async () => {
    const capture = await loadOwnStoredReportSnapshot(db, options); const checked = await capture.confirm();
    expect(checked.authorized).toBe(true); expect(checked.reports[0].report).toEqual(report);
    expect(checked.sources[0].fileId).toBe(file);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "own_captured_report_v1", { p_account_id: account, p_session_id: session,
      p_subject_id: subject, p_file_id: file, p_slug: "caffeine", p_expected: null });
    expect(mocks.rpc).toHaveBeenLastCalledWith("own_captured_report_v1", expect.objectContaining({ p_expected: "f".repeat(64) }));
    expect(JSON.stringify(checked)).not.toMatch(/receipt|accountId|sessionId|bucket|source_sha256/);
  });
  it.each(["legacy", "bad", ""])("refuses malformed explicit source %s before any RPC", async fileId => {
    expect((await loadOwnStoredReportSnapshot(db, { ...options, fileId })).authorized).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["file", "subject", "slug", "catalog", "interpretation", "duplicate", "extra"])("refuses invalid captured %s without fallback", async kind => {
    const value = response();
    if (kind === "file") value.source.fileId = account;
    if (kind === "subject") value.source.subjectId = account;
    if (kind === "slug") value.source.reports[0].slug = "other";
    if (kind === "catalog") Reflect.deleteProperty(value.source.reports[0], "catalogSnapshot");
    if (kind === "interpretation") value.source.reports[0].variants[0].outcome.interpretation = "Invented";
    if (kind === "duplicate") value.source.reports.push(value.source.reports[0]);
    mocks.rpc.mockResolvedValue({ data: kind === "extra" ? { ...value, raw_score: 1 } : value, error: null });
    expect((await loadOwnStoredReportSnapshot(db, options)).authorized).toBe(false);
  });
  it.each(["withdrawal", "source", "catalog", "session"])("permanently refuses final %s change", async kind => {
    const capture = await loadOwnStoredReportSnapshot(db, options);
    const changed = response();
    if (kind === "source") changed.source.source.processedAt = "2026-09-07T13:00:00Z";
    if (kind === "catalog") changed.source.reports[0].catalogSnapshot.template.title = "Different catalog";
    if (kind === "session") mocks.actor.mockResolvedValue(null);
    mocks.rpc.mockResolvedValue({ data: kind === "withdrawal" ? null : changed, error: null });
    expect((await capture.confirm()).authorized).toBe(false);
    mocks.actor.mockResolvedValue({ accountId: account, sessionId: session }); mocks.rpc.mockResolvedValue({ data: response(), error: null });
    expect((await capture.confirm()).authorized).toBe(false);
  });
});
