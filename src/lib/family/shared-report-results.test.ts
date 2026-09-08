import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../genome/load";
import { confirmSharedReportReadiness, loadSharedReportReadiness, loadSharedReportSnapshot, prepareSharedReportGrant } from "./shared-report-results";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), capability: vi.fn(), rpc: vi.fn() }));
vi.mock("../uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("./access", () => ({ familyCapability: mocks.capability }));
const viewer = "79010000-0000-4000-8000-000000000001", owner = "79010000-0000-4000-8000-000000000002";
const subject = "79010000-0000-4000-8000-000000000003", file = "79010000-0000-4000-8000-000000000004";
const otherFile = "79010000-0000-4000-8000-000000000005", session = "79010000-0000-4000-8000-000000000006";
const db = { rpc: mocks.rpc } as unknown as Db;
const options = { subjectId: subject, counterpartAccountId: owner, purposes: ["reports.polygenic"] as const };
const template = { slug: "caffeine", category: "basic-traits", title: "Captured caffeine title", summary: "Captured summary",
  evidence: "emerging", layer: "estimate", estimate_kind: "single_locus", pgs_id: null,
  variants: [{ rsid: 762551, gene: "CYP1A2", chrom: 15, pos38: 74749576, ref: "A", alt: "C", interpretations: { AC: "Captured", CC: "Captured" } }],
  citations: [{ pmid: "12345678", label: "Captured study" }] };
const report = { slug: "caffeine", covered: true, conflictingRsids: [] as number[],
  variants: [{ rsid: 762551, outcome: { status: "genotyped", genotype: "AC", interpretation: "Captured", strandFlipped: false } }],
  catalogSnapshot: { schemaVersion: 1, templateSha256: "b".repeat(64), template } };
const source = () => ({ fileId: file, subjectId: subject, purpose: "reports.polygenic", completedAt: "2026-09-07T12:00:00+00:00",
  receipt: "c".repeat(64), reports: [structuredClone(report)], source: { fileId: file, fileType: "vcf", processedAt: "2026-09-07T11:00:00+00:00", snapshot: null } });
const page = () => ({ pageReceipt: "f".repeat(64), authority: "a".repeat(64), ownerAccountId: owner, subjectId: subject, purpose: "reports.polygenic",
  legacyOnly: false, nextAfter: null as string | null, sources: [source()] });
const ok = (data: unknown) => ({ data, error: null });
beforeEach(() => {
  vi.resetAllMocks(); mocks.actor.mockResolvedValue({ accountId: viewer, sessionId: session });
  mocks.capability.mockResolvedValue({ status: "permitted" }); mocks.rpc.mockImplementation(async name => name === "confirm_family_shared_report_results_v1" ? ok(true) : ok(page()));
});
describe("recipient-bound captured reports", () => {
  it("uses the viewer session and exact subject, preserves captured evidence and strips authority", async () => {
    const snapshot = await loadSharedReportSnapshot(db, options); const checked = await snapshot.confirm();
    expect(checked.authorized).toBe(true); expect(checked.reports[0].report).toEqual(report);
    expect(checked.reports[0].completedAt).toBe("2026-09-07T12:00:00.000Z");
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenLastCalledWith("confirm_family_shared_report_results_v1", {
      p_account_id: viewer, p_session_id: session, p_subject_id: subject, p_mode: "content",
      p_expected: [{ purpose: "reports.polygenic", afterFile: null, receipt: "f".repeat(64) }],
    });
    expect(mocks.capability).toHaveBeenCalledWith(viewer, [owner], "third_party_adult_analysis");
    expect(JSON.stringify(checked)).not.toMatch(/receipt|grantId|ownerAccountId|sourceSha256|bucket_path/);
  });
  it("distinguishes authorized empty from withdrawal and never reopens a denied capture", async () => {
    const empty = { ...page(), sources: [] }; mocks.rpc.mockResolvedValue(ok(empty));
    const snapshot = await loadSharedReportSnapshot(db, options);
    expect(snapshot.authorized).toBe(true); expect(snapshot.reports).toEqual([]);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect((await snapshot.confirm()).authorized).toBe(false);
    mocks.rpc.mockResolvedValue(ok(empty)); expect((await snapshot.confirm()).authorized).toBe(false);
  });
  it.each(["authority", "receipt", "completedAt", "content", "legacyOnly", "source"])("refuses changed %s before serialization", async key => {
    const snapshot = await loadSharedReportSnapshot(db, options), changed = page();
    if (key === "authority") changed.authority = "d".repeat(64);
    if (key === "receipt") changed.sources[0].receipt = "d".repeat(64);
    if (key === "completedAt") changed.sources[0].completedAt = "2026-09-08T12:00:00+00:00";
    if (key === "content") changed.sources[0].reports[0].variants[0].outcome.interpretation = "Different";
    if (key === "legacyOnly") { changed.legacyOnly = true; changed.sources = []; }
    if (key === "source") changed.sources = [];
    mocks.rpc.mockResolvedValue(ok(changed)); expect(await snapshot.confirm()).toMatchObject({ authorized: false, reports: [], sources: [] });
  });
  it("keeps historical proof explicitly legacy-only without reading a legacy source", async () => {
    mocks.rpc.mockImplementation(async name => ok(name === "confirm_family_shared_report_results_v1" ? true : { ...page(), legacyOnly: true, sources: [] }));
    expect(await (await loadSharedReportSnapshot(db, options)).confirm()).toMatchObject({ authorized: true,
      access: [{ purpose: "reports.polygenic", kind: "legacy-only" }], reports: [] });
  });
  it("reports uncaptured scientific metadata as unavailable without borrowing current templates", async () => {
    const data = page(); delete (data.sources[0].reports[0] as Partial<typeof report>).catalogSnapshot;
    mocks.rpc.mockImplementation(async name => ok(name === "confirm_family_shared_report_results_v1" ? true : data));
    expect(await (await loadSharedReportSnapshot(db, options)).confirm()).toMatchObject({ authorized: true, reports: [],
      unavailableReports: [{ fileId: file, purpose: "reports.polygenic", slug: "caffeine" }] });
  });
  it("keeps uncovered and conflict outcomes exactly as captured", async () => {
    const data = page(); data.sources[0].reports[0].covered = false;
    data.sources[0].reports[0].conflictingRsids = [762551];
    data.sources[0].reports[0].variants = [{ rsid: 762551, outcome: { status: "not-covered" } }] as unknown as typeof report.variants;
    mocks.rpc.mockResolvedValue(ok(data));
    const result = await loadSharedReportSnapshot(db, options);
    expect(result.reports[0].report).toEqual(data.sources[0].reports[0]);
  });
  it("preserves separate disagreeing sources instead of combining their calls", async () => {
    const data = page(), second = source(); second.fileId = otherFile; second.source.fileId = otherFile;
    second.reports[0].variants[0].outcome.genotype = "CC"; data.sources.push(second);
    mocks.rpc.mockResolvedValue(ok(data)); const result = await loadSharedReportSnapshot(db, options);
    expect(result.reports.map(r => [r.fileId, r.report.variants[0].outcome])).toEqual([
      [file, report.variants[0].outcome], [otherFile, second.reports[0].variants[0].outcome],
    ]);
  });
  it.each(["subject", "owner", "purpose", "variant", "interpretation", "extra", "duplicate", "rpc"])("denies malformed %s without fallback", async key => {
    const data = page();
    if (key === "subject") data.sources[0].subjectId = otherFile;
    if (key === "owner") data.ownerAccountId = viewer;
    if (key === "purpose") data.purpose = "reports.monogenic";
    if (key === "interpretation") data.sources[0].reports[0].variants[0].outcome.interpretation = "Uncaptured";
    if (key === "variant") data.sources[0].reports[0].variants[0].rsid = 1;
    if (key === "extra") Object.assign(data.sources[0], { raw_score: 42 });
    if (key === "duplicate") data.sources.push(source());
    mocks.rpc.mockResolvedValue({ data, error: key === "rpc" ? {} : null });
    expect((await loadSharedReportSnapshot(db, options)).authorized).toBe(false);
  });
  it("pages by checked cursor and refuses a changed authority between pages", async () => {
    mocks.rpc.mockResolvedValueOnce(ok({ ...page(), nextAfter: file }))
      .mockResolvedValueOnce(ok({ ...page(), authority: "d".repeat(64), sources: [] }));
    expect((await loadSharedReportSnapshot(db, options)).authorized).toBe(false);
    expect(mocks.rpc.mock.calls[1][1].p_after_file).toBe(file);
  });
  it.each(["session", "jurisdiction"])("checks current %s after reads and on confirmation", async key => {
    const snapshot = await loadSharedReportSnapshot(db, options);
    if (key === "session") mocks.actor.mockResolvedValue(null); else mocks.capability.mockResolvedValue({ status: "prohibited" });
    expect((await snapshot.confirm()).authorized).toBe(false);
  });
  it("does not query genetic content when jurisdiction is unreviewed", async () => {
    mocks.capability.mockResolvedValue({ status: "unreviewed" });
    expect((await loadSharedReportSnapshot(db, options)).authorized).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses a strictly metadata-only readiness mode before the Tier-2 gate", async () => {
    mocks.rpc.mockImplementation(async name => ok(name === "confirm_family_shared_report_results_v1" ? true : { ...page(), sources: [{ fileId: file, receipt: "c".repeat(64), hasReports: true }] }));
    const result = await loadSharedReportReadiness(db, options); expect(await result.confirm()).toEqual({ authorized: true,
      access: [{ purpose: "reports.polygenic", kind: "canonical" }], hasReports: true });
    expect(mocks.rpc.mock.calls.every(([, args]) => args.p_mode === "readiness")).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/genotype|template|snapshot|source|caffeine|receipt/);
    mocks.rpc.mockResolvedValue(ok(page())); expect((await loadSharedReportReadiness(db, options)).authorized).toBe(false);
  });
  it("captures grant endpoints using the actual signing session and refuses unavailable proof", async () => {
    mocks.rpc.mockResolvedValue(ok("a".repeat(64))); expect(await prepareSharedReportGrant(db, subject, owner)).toBe("a".repeat(64));
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("family_report_grant_presentation_v1", {
      p_account_id: viewer, p_session_id: session, p_subject_id: subject, p_recipient_account_id: owner,
    });
    mocks.rpc.mockResolvedValue(ok(null)); expect(await prepareSharedReportGrant(db, subject, owner)).toBeNull();
  });
  it("confirms multiple adults in one last RPC and closes all cards on refusal", async () => {
    const secondSubject = otherFile, secondOwner = session;
    mocks.rpc.mockImplementation(async (name, args) => ok(name.startsWith("confirm_") ? true : {
      ...page(), subjectId: args.p_subject_id, ownerAccountId: args.p_subject_id === secondSubject ? secondOwner : owner,
      sources: [{ fileId: file, receipt: "c".repeat(64), hasReports: true }],
    }));
    const first = await loadSharedReportReadiness(db, options);
    const second = await loadSharedReportReadiness(db, { ...options, subjectId: secondSubject, counterpartAccountId: secondOwner });
    mocks.rpc.mockClear();
    expect((await confirmSharedReportReadiness([first, second])).map(s => s.hasReports)).toEqual([true, true]);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("confirm_family_shared_readiness_v1", {
      p_account_id: viewer, p_session_id: session, p_checks: [subject, secondSubject].map(subjectId => ({ subjectId,
        expected: [{ purpose: "reports.polygenic", afterFile: null, receipt: "f".repeat(64) }] })),
    });
    mocks.rpc.mockResolvedValue(ok(false));
    expect((await confirmSharedReportReadiness([first, second])).every(s => !s.authorized)).toBe(true);
    mocks.rpc.mockClear(); expect((await first.confirm()).authorized).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled();
  });

});
