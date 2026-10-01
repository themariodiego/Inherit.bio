import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn(), gate: vi.fn() }));
vi.mock("@/lib/uploads/other-adult-upload-server", () => ({ currentPathBAccount: mocks.actor, heldUploadRpc: mocks.rpc }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/family/tier2", () => ({ acknowledged: mocks.gate }));
import { listPathBReportMetadata, loadPathBReportSnapshot } from "./path-b-report-reader";

const accountId = "11111111-1111-4111-8111-111111111111", sessionId = "22222222-2222-4222-8222-222222222222";
const subjectId = "33333333-3333-4333-8333-333333333333", fileId = "44444444-4444-4444-8444-444444444444";
function fixture(direction: "self" | "uploader" = "self") {
  const metadata = { subjectId, label: "Synthetic adult", direction, purposes: ["reports.monogenic"], receipt: "a".repeat(64) };
  const template = { slug: "saved-observation", category: "basic-traits", title: "Saved observation", summary: "Synthetic saved observation.",
    evidence: "emerging", layer: "variant_call", estimate_kind: null, pgs_id: null, citations: [],
    variants: [{ rsid: 123, chrom: 1, pos38: 100000, ref: "A", alt: "G", gene: "SYNTHETIC", interpretations: { AG: "Captured explanation." } }] };
  const report = { slug: template.slug, covered: true, conflictingRsids: [],
    variants: [{ rsid: 123, outcome: { status: "genotyped", genotype: "AG", interpretation: "Captured explanation.", strandFlipped: false } }],
    catalogSnapshot: { schemaVersion: 1, templateSha256: "b".repeat(64), template } };
  const capture = { metadata, receipt: "c".repeat(64), sources: [{ subjectId, fileId, purpose: "reports.monogenic",
    completedAt: "2026-09-30T12:00:00+00:00", receipt: "d".repeat(64), reports: [report],
    source: { fileId, fileType: "vcf", processedAt: "2026-09-30T11:59:00+00:00", snapshot: null } }] };
  mocks.rpc.mockImplementation(async (_db, name) => ({ error: null, data:
    name === "path_b_report_metadata_v1" ? [metadata] : name === "capture_path_b_report_results_v1" ? capture : true }));
  return { metadata, capture, report };
}
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  mocks.actor.mockResolvedValue({ accountId, sessionId }); mocks.gate.mockResolvedValue(true); });
afterEach(() => vi.unstubAllEnvs());

describe("saved Path B reading boundary", () => {
  it("is closed outside TEST-LOCAL, without resolving a reader or calling a service door", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "0");
    expect(await listPathBReportMetadata()).toEqual([]);
    expect((await loadPathBReportSnapshot(subjectId)).authorized).toBe(false);
    expect(mocks.actor).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("withholds uploader genetic capture before the actual session gate", async () => {
    fixture("uploader"); mocks.gate.mockResolvedValue(false);
    expect((await loadPathBReportSnapshot(subjectId)).authorized).toBe(false);
    expect(mocks.rpc.mock.calls.map(call => call[1])).toEqual(["path_b_report_metadata_v1"]);
  });
  it("reuses the exact captured catalog, only the selected layer, and a final locked session confirmation", async () => {
    const f = fixture(); const saved = await loadPathBReportSnapshot(subjectId);
    expect(saved.authorized).toBe(true); expect(saved.reports[0].report).toEqual(f.report);
    expect(saved.access).toEqual([{ purpose: "reports.monogenic", kind: "canonical" }]);
    expect(mocks.rpc.mock.calls.at(-1)?.slice(1)).toEqual(["confirm_path_b_report_results_v1", {
      p_account_id: accountId, p_session_id: sessionId, p_subject_id: subjectId, p_test_jurisdiction: true, p_receipt: f.capture.receipt }]);
    expect((await saved.confirm()).authorized).toBe(true);
  });
  it.each(["foreign-subject", "foreign-source", "foreign-layer", "changed-catalog", "missing-catalog", "duplicate-source", "changed-metadata"])(
    "refuses %s before serialization", async attack => {
      const f = fixture(); const source = f.capture.sources[0];
      if (attack === "foreign-subject") source.subjectId = accountId;
      if (attack === "foreign-source") source.source.fileId = accountId;
      if (attack === "foreign-layer") source.purpose = "reports.polygenic";
      if (attack === "changed-catalog") source.reports[0].variants[0].outcome.interpretation = "Invented interpretation.";
      if (attack === "missing-catalog") Reflect.deleteProperty(source.reports[0], "catalogSnapshot");
      if (attack === "duplicate-source") f.capture.sources.push(structuredClone(source));
      if (attack === "changed-metadata") f.capture.metadata = { ...f.metadata, receipt: "f".repeat(64) };
      expect((await loadPathBReportSnapshot(subjectId)).authorized).toBe(false);
      expect(mocks.rpc.mock.calls.some(call => call[1] === "confirm_path_b_report_results_v1")).toBe(false);
    });
  it("withholds a formerly valid capture after the actual auth session rotates", async () => {
    fixture(); const saved = await loadPathBReportSnapshot(subjectId); expect(saved.authorized).toBe(true);
    mocks.actor.mockResolvedValue({ accountId, sessionId: fileId }); mocks.rpc.mockClear();
    expect((await saved.confirm()).authorized).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("withholds a formerly valid capture after its current source/grant digest no longer confirms", async () => {
    fixture(); const saved = await loadPathBReportSnapshot(subjectId); expect(saved.authorized).toBe(true);
    mocks.rpc.mockResolvedValue({ error: null, data: false });
    expect((await saved.confirm()).authorized).toBe(false);
  });
  it("rechecks the uploader session gate before the last confirm, even after a valid initial capture", async () => {
    fixture("uploader"); const saved = await loadPathBReportSnapshot(subjectId); expect(saved.authorized).toBe(true);
    mocks.gate.mockResolvedValue(false); mocks.rpc.mockClear();
    expect((await saved.confirm()).authorized).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
