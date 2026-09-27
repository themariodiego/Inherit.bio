import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicationFixture } from "./prepared-source/prepare-genome-publication.fixtures";
import { row } from "./prepared-source/materialize-canonical.fixtures";
import { canonicalRecordRsid } from "./prepared-source/canonical-rsid-reader";
import type { OwnPreparedSource } from "./prepared-source/published-source-reader";
import type { Db } from "./load";
import { createOwnReportReadScope, loadOwnReportCallSource, type OwnReportReadScope } from "./own-prepared-report-calls";

const mocked = vi.hoisted(() => ({ read: vi.fn(), actor: vi.fn(), rpc: vi.fn(), signal: vi.fn() }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocked.actor }));
vi.mock("./prepared-source/published-source-reader", async original => ({
  ...await original<typeof import("./prepared-source/published-source-reader")>(), createOwnPreparedRsidReader: vi.fn(() => mocked.read),
}));
const actor = { accountId: "11111111-1111-4111-8111-111111111111", sessionId: "22222222-2222-4222-8222-222222222222" };
const manifestId = "88888888-8888-4888-8888-888888888888", purpose = "reports.polygenic";
const scopes: OwnReportReadScope[] = [];
function scope() { const value = createOwnReportReadScope(); scopes.push(value); return value; }
const db = { rpc: (...args: unknown[]) => {
  const pending = Promise.resolve().then(() => mocked.rpc(...args));
  return { abortSignal: (signal: AbortSignal) => { mocked.signal(signal); return pending; } };
} } as unknown as Db;
async function setup(rows = [row(1)]) {
  const f = await publicationFixture(rows), binding = f.binding.source, root = f.canonical.directories[0].artifact;
  const source: OwnPreparedSource = { version: "own-prepared-source-v1", backend: "prepared-object-v1", manifestId,
    fileId: binding.fileId, subjectId: binding.subjectId, sourceRevision: 1, rawSha256: binding.rawSha256,
    decodedSha256: binding.decodedSha256, preparedAt: "2026-09-08T19:00:00Z", root,
    summary: { version: "own-prepared-summary-v1", sourceBuild: "GRCh38", parserRevision: binding.parserRevision,
      canonicalRevision: "prepared-canonical-v1", sourceVariantCount: f.canonical.counts.sourceVariantCount,
      sourceObservedCount: f.canonical.counts.sourceObservedCount, sourceReferenceCount: f.canonical.counts.sourceReferenceCount,
      variantCount: f.canonical.counts.normalizedVariantCount, observedCallCount: f.canonical.counts.normalizedObservedCount,
      usableObservedCount: f.canonical.counts.usableObservedCount, attempted: f.canonical.canonicalSummary.attempted,
      unmapped: f.canonical.canonicalSummary.unmapped, rsidPointerCount: f.root.pointerCount },
    memberCount: f.canonical.artifactCount + f.root.artifactCount + 3, membershipSha256: "d".repeat(64) };
  const selected = { backend: "prepared-object-v1" as const, receipt: "a".repeat(64), selection: {
    fileId: source.fileId, subjectId: source.subjectId, sourceRevision: 1, sourceSha256: source.rawSha256,
    decodedSha256: source.decodedSha256, normalizedAt: source.preparedAt,
    preparedSource: { version: "own-prepared-report-source-v1" as const, backend: "prepared-object-v1" as const,
      manifestId, membershipSha256: source.membershipSha256, rootArtifactId: root.receipt.artifactId, rootSha256: root.receipt.sha256 },
  } };
  mocked.rpc.mockResolvedValue({ data: selected, error: null });
  mocked.read.mockImplementation(async (request: { rsids: number[] }) => ({ source,
    records: f.records.filter(record => request.rsids.includes(canonicalRecordRsid(record)!)), nextCursor: null }));
  const load = (budget = scope()) => loadOwnReportCallSource(db, source.fileId, purpose, budget, source.subjectId);
  return { ...f, source, selected, load };
}
beforeEach(() => { vi.resetAllMocks(); mocked.actor.mockResolvedValue(actor); });
afterEach(() => { for (const value of scopes.splice(0)) value.close(); vi.useRealTimers(); });

describe("prepared calls under completed report authority", () => {
  it("binds the completed source and preserves wrong loci, no-calls and proven duplicates", async () => {
    const f = await setup([row(1), row(1), row(8).replace("rs8", "rs1"), row(9, "./.").replace("rs9", "rs1")]);
    const budget = scope(), selected = await f.load(budget);
    expect(selected.backend).toBe("prepared-object-v1");
    if (selected.backend !== "prepared-object-v1") throw new Error();
    const calls = await selected.read([1]);
    expect(calls).toHaveLength(6); expect(new Set(calls.map(c => c.pos))).toEqual(new Set([1, 8, 9]));
    expect(calls.find(c => c.pos === 9)).toMatchObject({ genotype: "--", usable: false });
    expect(calls.every(c => c.file_id === f.source.fileId && c.rsid === 1)).toBe(true);
    expect(mocked.rpc.mock.calls[0]).toEqual(["own_report_call_source_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId, p_file_id: f.source.fileId,
      p_purpose: purpose, p_expected: null,
    }]);
    expect(mocked.rpc.mock.calls.slice(1).every(([, args]) => args.p_expected === f.selected.receipt)).toBe(true);
    expect(mocked.signal.mock.calls.every(([signal]) => signal === budget.signal)).toBe(true);
    await selected.confirm();
  });

  it("selects the database backend without opening object storage", async () => {
    const f = await setup(), selection = { ...f.selected.selection };
    Reflect.deleteProperty(selection, "preparedSource");
    mocked.rpc.mockResolvedValue({ data: { ...f.selected, backend: "database-v1", selection }, error: null });
    const selected = await f.load(); expect(selected.backend).toBe("database-v1");
    expect("read" in selected).toBe(false); await selected.confirm(); expect(mocked.read).not.toHaveBeenCalled();
  });

  it.each(["denied", "error", "extra-field", "foreign-file", "foreign-subject", "missing-prepared", "database-with-prepared"])
    ("refuses %s rather than dispatching to a fallback", async failure => {
      const f = await setup(), answer: Record<string, unknown> = structuredClone(f.selected);
      if (failure === "extra-field") answer.unexpected = true;
      if (failure === "foreign-file") {
        const otherFile = "99999999-9999-4999-8999-999999999999";
        expect(otherFile).not.toBe(f.source.fileId); (answer.selection as Record<string, unknown>).fileId = otherFile;
      }
      if (failure === "foreign-subject") (answer.selection as Record<string, unknown>).subjectId = actor.accountId;
      if (failure === "missing-prepared") delete (answer.selection as Record<string, unknown>).preparedSource;
      if (failure === "database-with-prepared") answer.backend = "database-v1";
      mocked.rpc.mockResolvedValue({ data: failure === "denied" ? null : answer, error: failure === "error" ? {} : null });
      await expect(f.load()).rejects.toThrow(); expect(mocked.read).not.toHaveBeenCalled();
    });

  it.each(["revocation", "regrant", "new-result", "source-revision", "member-set"])
    ("withholds calls when %s changes during object I/O", async change => {
      const f = await setup(), selected = await f.load();
      if (selected.backend !== "prepared-object-v1") throw new Error();
      mocked.read.mockImplementation(async () => {
        const next = structuredClone(f.selected);
        if (change === "regrant" || change === "new-result") next.receipt = "f".repeat(64);
        if (change === "source-revision") next.selection.sourceRevision++;
        if (change === "member-set") next.selection.preparedSource.membershipSha256 = "f".repeat(64);
        mocked.rpc.mockResolvedValue({ data: change === "revocation" ? null : next, error: null });
        return { source: f.source, records: f.records, nextCursor: null };
      });
      await expect(selected.read([1])).rejects.toThrow();
    });

  it.each([null, { ...actor, sessionId: "33333333-3333-4333-8333-333333333333" }])
    ("refuses a lost or replaced current session", async next => {
      const f = await setup(), selected = await f.load(); mocked.actor.mockResolvedValue(next);
      await expect(selected.confirm()).rejects.toThrow(); expect(mocked.read).not.toHaveBeenCalled();
    });

  it("chunks more than fifty rsIDs under the same exact source and final fence", async () => {
    const f = await setup(Array.from({ length: 51 }, (_, index) => row(index + 1))), selected = await f.load();
    if (selected.backend !== "prepared-object-v1") throw new Error();
    const calls = await selected.read(Array.from({ length: 51 }, (_, index) => index + 1));
    expect(calls).toHaveLength(102); expect(mocked.read.mock.calls.map(([request]) => request.rsids.length)).toEqual([50, 1]);
    expect(new Set(calls.map(c => c.rsid)).size).toBe(51);
  });

  it("discards earlier chunks when a later cursor does not progress", async () => {
    const f = await setup(), selected = await f.load();
    if (selected.backend !== "prepared-object-v1") throw new Error();
    mocked.read.mockImplementation(async (request: { rsids: number[] }) => ({ source: f.source,
      records: request.rsids.includes(1) ? f.records : [], nextCursor: request.rsids.includes(1) ? null : {
        version: "canonical-rsid-cursor-v1", canonicalSha256: "a".repeat(64), rsidSha256: "b".repeat(64),
        querySha256: createHash("sha256").update(JSON.stringify(request.rsids)).digest("hex"), indexBlockSequence: 0, pointerOffset: 0,
      } }));
    await expect(selected.read(Array.from({ length: 51 }, (_, index) => index + 1))).rejects.toThrow();
    expect(mocked.read).toHaveBeenCalledTimes(3);
  });

  it.each(["records", "bytes"])("enforces shared %s budget across distinct files", async bound => {
    const f = await setup([row(1), row(1)]), budget = scope(), first = await f.load(budget);
    const otherId = "99999999-9999-4999-8999-999999999999";
    const otherSelection = structuredClone(f.selected); otherSelection.selection.fileId = otherId; otherSelection.receipt = "b".repeat(64);
    mocked.rpc.mockImplementation(async (_name, args: { p_file_id: string }) => ({
      data: args.p_file_id === otherId ? otherSelection : f.selected, error: null,
    }));
    mocked.read.mockImplementation(async (request: { fileId: string }) => ({
      source: { ...f.source, fileId: request.fileId }, records: f.records, nextCursor: null,
    }));
    const second = await loadOwnReportCallSource(db, otherId, purpose, budget, f.source.subjectId);
    if (first.backend !== "prepared-object-v1" || second.backend !== "prepared-object-v1") throw new Error();
    const bytes = Buffer.byteLength(JSON.stringify(f.records));
    budget.consumeEvidence(bound === "records" ? 9993 : 0, bound === "bytes" ? 2_000_000 - bytes - 1 : 0);
    expect(await first.read([1])).toHaveLength(3);
    await expect(second.read([1])).rejects.toMatchObject({ code: "too_large" });
    await expect(first.confirm()).rejects.toMatchObject({ code: "too_large" });
    expect(budget.signal.aborted).toBe(true);
  });

  it("expires a stalled authority request at the whole-read deadline", async () => {
    const f = await setup(); vi.useFakeTimers(); const budget = scope();
    mocked.rpc.mockImplementation(() => new Promise(() => {}));
    const pending = f.load(budget), assertion = expect(pending).rejects.toMatchObject({ code: "aborted" });
    await vi.advanceTimersByTimeAsync(30_000); await assertion; expect(budget.signal.aborted).toBe(true);
  });

  it("rechecks exact completed authority at the caller's final fence", async () => {
    const f = await setup(), selected = await f.load();
    if (selected.backend !== "prepared-object-v1") throw new Error();
    await selected.read([1]); mocked.rpc.mockResolvedValue({ data: null, error: null });
    await expect(selected.confirm()).rejects.toThrow();
  });
});
