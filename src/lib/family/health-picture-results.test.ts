import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../genome/load";
import { loadHealthPictureSnapshot, prepareHealthPictureGrant } from "./health-picture-results";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), capability: vi.fn(), rpc: vi.fn() }));
vi.mock("../uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("./access", () => ({ familyCapability: mocks.capability }));
const id = (n: number) => `79310000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const account = id(1), session = id(2), self = id(3), other = id(4), otherAccount = id(5), file = id(10);
const db = { rpc: mocks.rpc } as unknown as Db;
const options = { selfSubjectId: self, counterparts: [{ subjectId: other, accountId: otherAccount }], purposes: ["reports.polygenic"] as const };
const template = { slug: "caffeine", category: "basic-traits", title: "Captured title", summary: "Captured summary", evidence: "emerging",
  layer: "estimate", estimate_kind: "single_locus", pgs_id: null, variants: [{ rsid: 762551, gene: "CYP1A2", chrom: 15,
    pos38: 74749576, ref: "A", alt: "C", interpretations: { AC: "Captured interpretation" } }], citations: [{ pmid: "12345678", label: "Captured study" }] };
const report = { slug: "caffeine", covered: true, conflictingRsids: [], variants: [{ rsid: 762551,
  outcome: { status: "genotyped", genotype: "AC", interpretation: "Captured interpretation", strandFlipped: false } }],
  catalogSnapshot: { schemaVersion: 1, templateSha256: "a".repeat(64), template } };
function page(subjectId = self, purpose = "reports.polygenic") {
  const fileId = subjectId === self ? file : id(11);
  return { subjectId, purpose, kind: subjectId === self ? "own" : "shared", access: "canonical", legacyFileIds: [] as string[],
    hasPreparedSource: true, sources: [{ fileId, subjectId, purpose, completedAt: "2026-09-07T12:00:00+00:00",
      receipt: "b".repeat(64), reports: [structuredClone(report)], source: { fileId, fileType: "vcf",
        processedAt: "2026-09-07T11:00:00+00:00", snapshot: null } }], nextAfter: null as string | null,
    jointReceipt: "c".repeat(64), pageReceipt: "d".repeat(64) };
}
const ok = (data: unknown) => ({ data, error: null });
beforeEach(() => {
  vi.resetAllMocks(); mocks.actor.mockResolvedValue({ accountId: account, sessionId: session }); mocks.capability.mockResolvedValue({ status: "permitted" });
  mocks.rpc.mockImplementation(async (name, args) => ok(name === "confirm_health_picture_results_v1" ? true : page(args.p_subject_id, args.p_purpose)));
});
describe("Health Picture saved-report capture", () => {
  it("returns exact captured reports for both adults with one terminal transaction and no private receipts", async () => {
    const snapshot = await loadHealthPictureSnapshot(db, options); const result = await snapshot.confirm();
    expect(result.authorized).toBe(true); expect(result.columns).toHaveLength(2);
    expect(result.columns[0].reports[0].report).toEqual(report);
    expect(result.columns[0].reports[0].completedAt).toBe("2026-09-07T12:00:00.000Z");
    expect(mocks.rpc).toHaveBeenLastCalledWith("confirm_health_picture_results_v1", { p_account_id: account, p_session_id: session,
      p_self_subject_id: self, p_counterparts: options.counterparts, p_purposes: options.purposes, p_expected: [
        { subjectId: self, purpose: "reports.polygenic", afterFile: null, receipt: "d".repeat(64) },
        { subjectId: other, purpose: "reports.polygenic", afterFile: null, receipt: "d".repeat(64) },
      ] });
    expect(JSON.stringify(result)).not.toMatch(/Receipt|receipt|sessionId|accountId|sha256|bucket/);
    expect(mocks.capability).toHaveBeenCalledWith(account, [otherAccount], "family_heritability");
  });
  it("keeps empty own purpose and not-shared B distinct without losing another saved layer", async () => {
    mocks.rpc.mockImplementation(async (name, args) => {
      if (name.startsWith("confirm")) return ok(true);
      const p = page(args.p_subject_id, args.p_purpose);
      if (args.p_purpose === "reports.monogenic") { p.sources = []; p.access = args.p_subject_id === self ? "canonical" : "not-shared"; }
      return ok(p);
    });
    const result = await (await loadHealthPictureSnapshot(db, { ...options, purposes: ["reports.monogenic", "reports.polygenic"] })).confirm();
    expect(result.authorized).toBe(true);
    expect(result.columns[0].access[0]).toEqual({ purpose: "reports.monogenic", kind: "canonical", hasPreparedSource: true, hasCompletedSource: false });
    expect(result.columns[1].access[0].kind).toBe("not-shared");
    expect(result.columns.every(c => c.reports.length === 1)).toBe(true);
    expect(mocks.rpc.mock.calls.at(-1)?.[1].p_expected).toHaveLength(4);
  });
  it("retains exact legacy IDs under historical joint permission without hiding own reports", async () => {
    mocks.rpc.mockImplementation(async (name, args) => {
      if (name.startsWith("confirm")) return ok(true);
      const p = page(args.p_subject_id); if (args.p_subject_id === other) { p.access = "legacy-only"; p.sources = []; p.hasPreparedSource = false; p.legacyFileIds = [id(20)]; } return ok(p);
    });
    const result = await (await loadHealthPictureSnapshot(db, options)).confirm();
    expect(result.columns[0].reports).toHaveLength(1); expect(result.columns[1].reports).toHaveLength(0);
    expect(result.columns[1].legacyFileIds).toEqual([id(20)]); expect(result.columns[1].access[0].kind).toBe("legacy-only");
  });
  it("confirms all counterpart columns and every page in sorted order, including empty pages", async () => {
    mocks.rpc.mockImplementation(async (name, args) => {
      if (name.startsWith("confirm")) return ok(true);
      const p = page(args.p_subject_id);
      if (args.p_subject_id === self && args.p_after_file === null) p.nextAfter = file;
      if (args.p_after_file !== null || args.p_subject_id === id(6)) p.sources = [];
      return ok(p);
    });
    const snapshot = await loadHealthPictureSnapshot(db, { ...options, counterparts: [{ subjectId: id(6), accountId: id(7) }, ...options.counterparts] });
    expect((await snapshot.confirm()).authorized).toBe(true);
    expect(mocks.rpc.mock.calls.at(-1)?.[1].p_expected.map((e: { subjectId: string; afterFile: string | null }) => [e.subjectId, e.afterFile]))
      .toEqual([[self, null], [self, file], [other, null], [id(6), null]]);
  });
  it.each(["joint", "source", "layer", "session", "capability"])("permanently closes after final %s refusal", async reason => {
    const snapshot = await loadHealthPictureSnapshot(db, options);
    if (reason === "session") mocks.actor.mockResolvedValue({ accountId: account, sessionId: id(99) });
    else if (reason === "capability") mocks.capability.mockResolvedValue({ status: "unreviewed" });
    else mocks.rpc.mockResolvedValue(ok(false));
    expect(await snapshot.confirm()).toEqual({ authorized: false, columns: [] });
    mocks.actor.mockResolvedValue({ accountId: account, sessionId: session }); mocks.capability.mockResolvedValue({ status: "permitted" }); mocks.rpc.mockResolvedValue(ok(true));
    expect((await snapshot.confirm()).authorized).toBe(false);
  });
  it.each(["foreign-subject", "legacy-modern", "not-shared", "wrong-kind", "receipt", "duplicate", "interpretation", "extra-field"])("denies malformed %s without fallback", async kind => {
    mocks.rpc.mockImplementation(async (_name, args) => {
      const p = page(args.p_subject_id);
      if (kind === "foreign-subject") p.sources[0].subjectId = id(100);
      if (kind === "legacy-modern") p.legacyFileIds = [p.sources[0].fileId];
      if (kind === "not-shared") p.access = "not-shared";
      if (kind === "wrong-kind") p.kind = "shared";
      if (kind === "receipt" && args.p_subject_id === other) p.jointReceipt = "e".repeat(64);
      if (kind === "duplicate") p.sources.push(p.sources[0]);
      if (kind === "interpretation") p.sources[0].reports[0].variants[0].outcome.interpretation = "Invented";
      return ok(kind === "extra-field" ? { ...p, genotype: "AC" } : p);
    });
    expect((await loadHealthPictureSnapshot(db, options)).state.authorized).toBe(false);
  });
  it("keeps missing scientific metadata unavailable without current-catalog substitution", async () => {
    mocks.rpc.mockImplementation(async (name, args) => {
      if (name.startsWith("confirm")) return ok(true);
      const p = page(args.p_subject_id); const r = p.sources[0].reports[0];
      Reflect.deleteProperty(r, "catalogSnapshot"); return ok(p);
    });
    const result = await (await loadHealthPictureSnapshot(db, options)).confirm();
    expect(result.columns[0].reports).toEqual([]); expect(result.columns[0].unavailableReports).toEqual([{ fileId: file, purpose: "reports.polygenic", slug: "caffeine" }]);
    expect(result.columns[0].access[0].hasCompletedSource).toBe(true);
  });
  it.each([{ counterparts: [] }, { counterparts: [{ subjectId: self, accountId: otherAccount }] }, { counterparts: [{ subjectId: other, accountId: account }] }])("denies invalid counterpart scope before reads", async ({ counterparts }) => {
    expect((await loadHealthPictureSnapshot(db, { ...options, counterparts })).state.authorized).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("mints only a DB-owned joint endpoint receipt under both capabilities", async () => {
    mocks.rpc.mockResolvedValue(ok("a".repeat(64)));
    expect(await prepareHealthPictureGrant(db, self, otherAccount)).toBe("a".repeat(64));
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("health_picture_grant_presentation_v1", { p_account_id: account,
      p_session_id: session, p_subject_id: self, p_recipient_account_id: otherAccount });
    mocks.capability.mockResolvedValue({ status: "unreviewed" }); expect(await prepareHealthPictureGrant(db, self, otherAccount)).toBeNull();
  });
});
