import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../genome/load";
import { computeOwnAncestryContent, CURRENT_OWN_ANCESTRY_PANEL } from "../uploads/own-ancestry-content";
import { computeOwnAncestryContentV3, SEVEN_OWN_ANCESTRY_PANEL } from "../uploads/own-ancestry-content-v3";
import { loadSharedAncestrySnapshot, prepareSharedAncestryGrant } from "./shared-ancestry-results";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), capability: vi.fn(), rpc: vi.fn() }));
vi.mock("../uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("./access", () => ({ familyCapability: mocks.capability }));
const viewer = "79110000-0000-4000-8000-000000000001", owner = "79110000-0000-4000-8000-000000000002";
const subjectId = "79110000-0000-4000-8000-000000000003", fileId = "79110000-0000-4000-8000-000000000004";
const otherFile = "79110000-0000-4000-8000-000000000005", sessionId = "79110000-0000-4000-8000-000000000006";
const options = { subjectId, counterpartAccountId: owner }, db = { rpc: mocks.rpc } as unknown as Db;
const input = { source: { fileId, subjectId, normalizedBuild: "GRCh38" as const, callEncoding: "vcf-literal" as const,
  sourceRevision: 1, sourceSha256: "a".repeat(64), normalizedAt: "2026-09-15T00:00:00Z" }, calls: [] };
const v2 = computeOwnAncestryContent({ ...input, panel: CURRENT_OWN_ANCESTRY_PANEL });
const v3 = computeOwnAncestryContentV3({ ...input, panel: SEVEN_OWN_ANCESTRY_PANEL });
const v1 = { ...v2, schemaVersion: 1, computationRevision: "own-ancestry-content-v1", lineages: ["mtdna", "ydna"].map(kind => ({
  kind, state: "unavailable", reason: "no_supplied_positions", observedPositions: 0 })) };
const source = { fileId, fileType: "vcf", processedAt: "2026-09-15T00:00:00Z", snapshot: null };
const canonical = () => ({ kind: "canonical", fileId, completedAt: "2026-09-15T01:00:00Z", content: v3, source });
const legacy = () => ({ kind: "legacy", fileId, source, rows: [{ kind: "admixture", file_id: fileId,
  result: { proportions: { EUR: 1 }, markersUsed: 168 }, model_id: "old", model_version: "saved", support_note: "Saved note", created_at: "2026-09-14T00:00:00Z" }] });
const page = () => ({ authority: "a".repeat(64), ownerAccountId: owner, subjectId, legacyOnly: false,
  sources: [canonical()] as unknown[], fileCount: 1, preparing: false, preparedUnavailable: false, nextAfter: null as string | null, pageReceipt: "b".repeat(64) });
const ok = (data: unknown) => ({ data, error: null });
beforeEach(() => {
  vi.resetAllMocks(); mocks.actor.mockResolvedValue({ accountId: viewer, sessionId });
  mocks.capability.mockResolvedValue({ status: "permitted" });
  mocks.rpc.mockImplementation(async name => ok(name.startsWith("confirm_") ? true : page()));
});
describe("separate Family ancestry captured authority", () => {
  it.each([v1, v2, v3])("preserves capture revision $schemaVersion and excludes private identity from display props", async content => {
    mocks.rpc.mockImplementation(async name => ok(name.startsWith("confirm_") ? true : { ...page(), sources: [{ ...canonical(), content }] }));
    const current = await (await loadSharedAncestrySnapshot(db, options)).confirm();
    expect(current.authorized).toBe(true); expect(current.rows).toHaveLength(3);
    expect(current.rows[0].result).toEqual(content.admixture.result);
    expect(current.rows[0].model_version).toBe(content.admixture.model_version);
    if (content.schemaVersion === 1) expect(current.rows.slice(1).every(row => row.result === null && row.model_id === null)).toBe(true);
    expect(JSON.stringify(current)).not.toMatch(/sourceSha256|sourceRevision|claim|ownerAccountId|pageReceipt|authority|callEncoding/);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["family_shared_ancestry_results_v1", "confirm_family_shared_ancestry_results_v1"]);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_account_id: viewer, p_session_id: sessionId, p_subject_id: subjectId });
  });
  it("preserves independently checked legacy rows under historical grants without canonical fallback", async () => {
    mocks.rpc.mockImplementation(async name => ok(name.startsWith("confirm_") ? true : { ...page(), legacyOnly: true, sources: [legacy()] }));
    const state = await (await loadSharedAncestrySnapshot(db, options)).confirm();
    expect(state).toMatchObject({ authorized: true, confirmationRequired: true, rows: legacy().rows });
    mocks.rpc.mockResolvedValue(ok({ ...page(), legacyOnly: true }));
    expect((await loadSharedAncestrySnapshot(db, options)).authorized).toBe(false);
  });
  it("keeps prepared-source refusal explicit without manufacturing figures or provenance", async () => {
    mocks.rpc.mockImplementation(async name => ok(name.startsWith("confirm_") ? true : { ...page(), sources: [], preparedUnavailable: true }));
    expect(await (await loadSharedAncestrySnapshot(db, options)).confirm()).toMatchObject({ authorized: true, rows: [], sources: [], preparedUnavailable: true });
  });
  it.each(["grant", "owner-purpose", "source", "completion", "pause"])("withholds every captured row when terminal %s confirmation fails", async () => {
    const captured = await loadSharedAncestrySnapshot(db, { ...options, retryDelayMs: 0 });
    mocks.rpc.mockResolvedValue(ok(false));
    expect(await captured.confirm()).toMatchObject({ authorized: false, rows: [], sources: [], fileCount: 0 });
    mocks.rpc.mockResolvedValue(ok(true)); expect((await captured.confirm()).authorized).toBe(false);
  });
  it("retries a contested confirmation once with a fresh capture and confirms the fresh pages", async () => {
    const fresh = { ...page(), pageReceipt: "d".repeat(64), sources: [{ ...canonical(), completedAt: "2026-09-15T03:00:00Z" }] };
    let reads = 0, confirms = 0;
    mocks.rpc.mockImplementation(async name => {
      if (name.startsWith("confirm_")) return ok(++confirms >= 2);
      return ok(++reads === 1 ? page() : fresh);
    });
    const captured = await loadSharedAncestrySnapshot(db, { ...options, retryDelayMs: 0 });
    const state = await captured.confirm();
    expect(state.authorized).toBe(true); expect(state.rows[0].created_at).toBe("2026-09-15T03:00:00Z");
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["family_shared_ancestry_results_v1", "confirm_family_shared_ancestry_results_v1",
      "family_shared_ancestry_results_v1", "confirm_family_shared_ancestry_results_v1"]);
    expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_expected: [{ afterFile: null, receipt: page().pageReceipt }] });
    expect(mocks.rpc.mock.calls[3][1]).toMatchObject({ p_expected: [{ afterFile: null, receipt: fresh.pageReceipt }] });
    // The fresh capture is what later confirmations check, not the stale first one.
    expect((await captured.confirm()).rows[0].created_at).toBe("2026-09-15T03:00:00Z");
    expect(mocks.rpc.mock.calls[4][1]).toMatchObject({ p_expected: [{ afterFile: null, receipt: fresh.pageReceipt }] });
  });
  it("denies after the one retry is also unconfirmed and stays closed", async () => {
    const captured = await loadSharedAncestrySnapshot(db, { ...options, retryDelayMs: 0 });
    mocks.rpc.mockImplementation(async name => ok(name.startsWith("confirm_") ? false : page()));
    expect(await captured.confirm()).toMatchObject({ authorized: false, rows: [], sources: [], fileCount: 0 });
    expect(mocks.rpc.mock.calls.map(([name]) => name).filter(name => name.startsWith("confirm_"))).toHaveLength(2);
    const calls = mocks.rpc.mock.calls.length;
    mocks.rpc.mockResolvedValue(ok(true)); expect((await captured.confirm()).authorized).toBe(false);
    expect(mocks.rpc.mock.calls).toHaveLength(calls);
  });
  it("does not retry when the fresh capture itself is refused", async () => {
    const captured = await loadSharedAncestrySnapshot(db, { ...options, retryDelayMs: 0 });
    mocks.rpc.mockImplementation(async name => ok(name.startsWith("confirm_") ? false : { ...page(), ownerAccountId: viewer }));
    expect((await captured.confirm()).authorized).toBe(false);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["family_shared_ancestry_results_v1", "confirm_family_shared_ancestry_results_v1", "family_shared_ancestry_results_v1"]);
  });
  it.each(["session", "jurisdiction"])("rechecks current %s before final RPC", async boundary => {
    const captured = await loadSharedAncestrySnapshot(db, options);
    if (boundary === "session") mocks.actor.mockResolvedValue({ accountId: viewer, sessionId: fileId });
    else mocks.capability.mockResolvedValue({ status: "unreviewed" });
    expect((await captured.confirm()).authorized).toBe(false); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("does no content read for an unreviewed jurisdiction", async () => {
    mocks.capability.mockResolvedValue({ status: "unreviewed" });
    expect((await loadSharedAncestrySnapshot(db, options)).authorized).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("checks all pages in one final operation and orders by completion rather than file ID", async () => {
    const first = { ...page(), nextAfter: fileId }, second = { ...page(), pageReceipt: "c".repeat(64), sources: [{ ...canonical(), fileId: otherFile,
      source: { ...source, fileId: otherFile }, completedAt: "2026-09-15T02:00:00Z", content: { ...v3, source: { ...v3.source, fileId: otherFile } } }] };
    mocks.rpc.mockImplementation(async (name, args) => ok(name.startsWith("confirm_") ? true : args.p_after_file ? second : first));
    const state = await (await loadSharedAncestrySnapshot(db, options)).confirm();
    expect(state.rows[0].file_id).toBe(otherFile); expect(state.fileCount).toBe(2);
    expect(mocks.rpc).toHaveBeenLastCalledWith("confirm_family_shared_ancestry_results_v1", expect.objectContaining({ p_expected: [
      { afterFile: null, receipt: first.pageReceipt }, { afterFile: fileId, receipt: second.pageReceipt }] }));
  });
  it.each(["owner", "subject", "file", "provenance", "version", "duplicate", "extra"])("refuses a %s mismatch", async mismatch => {
    const bad = page();
    if (mismatch === "owner") bad.ownerAccountId = viewer;
    if (mismatch === "subject") bad.subjectId = otherFile;
    if (mismatch === "file") bad.sources = [{ ...canonical(), fileId: otherFile }];
    if (mismatch === "provenance") bad.sources = [{ ...canonical(), source: { ...source, fileId: otherFile } }];
    if (mismatch === "version") bad.sources = [{ ...canonical(), content: { ...v3, computationRevision: "future" } }];
    if (mismatch === "duplicate") { bad.sources.push(canonical()); bad.fileCount = 2; }
    if (mismatch === "extra") bad.sources = [{ ...canonical(), rawCalls: [] }];
    mocks.rpc.mockResolvedValue(ok(bad)); expect((await loadSharedAncestrySnapshot(db, options)).authorized).toBe(false);
  });
  it("treats malformed quality facts as unavailable while preserving the authorized result", async () => {
    mocks.rpc.mockImplementation(async name => ok(name.startsWith("confirm_") ? true : { ...page(), sources: [{ ...canonical(), source: { ...source, snapshot: { called: -1 } } }] }));
    expect((await (await loadSharedAncestrySnapshot(db, options)).confirm()).sources[0].snapshot).toBeNull();
  });
  it("uses a source-free current permission capture for the ancestry-only link, and withdrawal removes it", async () => {
    mocks.rpc.mockImplementation(async name => ok(name.startsWith("confirm_") ? true : { ...page(), sources: [], fileCount: 0 }));
    const captured = await loadSharedAncestrySnapshot(db, { ...options, retryDelayMs: 0 }, "permission");
    expect((await captured.confirm()).authorized).toBe(true);
    expect(mocks.rpc.mock.calls.every(([, args]) => args.p_mode === "permission")).toBe(true);
    mocks.rpc.mockResolvedValue(ok(false)); expect((await captured.confirm()).authorized).toBe(false);
    mocks.rpc.mockResolvedValue(ok(page())); expect((await loadSharedAncestrySnapshot(db, options, "permission")).authorized).toBe(false);
  });
  it("captures fresh endpoint proof using the actual signing session", async () => {
    mocks.rpc.mockResolvedValue(ok({ receipt: "e".repeat(64), requiresConfirmation: true }));
    expect(await prepareSharedAncestryGrant(db, subjectId, owner)).toEqual({ receipt: "e".repeat(64), requiresConfirmation: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("family_ancestry_grant_presentation_v1", {
      p_account_id: viewer, p_session_id: sessionId, p_subject_id: subjectId, p_recipient_account_id: owner });
    mocks.rpc.mockResolvedValue(ok("e".repeat(64))); expect(await prepareSharedAncestryGrant(db, subjectId, owner)).toBeNull();
  });
});
