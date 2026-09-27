import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ prepared: vi.fn() }));
vi.mock("./own-prepared-calls", async original => ({ ...await original<typeof import("./own-prepared-calls")>(), readOwnPreparedCopilotCalls: mocked.prepared }));
import { readOwnChatCalls } from "./own-chat-calls";
import { ownChatProjectionSchema, ownGenotypeResult, type OwnChatCall, type OwnChatProjection } from "./own-chat-content";
import { PreparedCopilotReadError } from "./own-prepared-calls";
import type { OwnCopilotAuthority } from "./own-provider-authority";
const accountId = "80000000-0000-4000-8000-000000000001", sessionId = "80000000-0000-4000-8000-000000000002", subjectId = "80000000-0000-4000-8000-000000000003";
const fileA = "80000000-0000-4000-8000-000000000005", fileB = "80000000-0000-4000-8000-000000000006", fileC = "80000000-0000-4000-8000-000000000007";
const authority = { accountId, sessionId, subjectId } as OwnCopilotAuthority;
const source = (id: string, prepared = false): OwnChatProjection["sources"][number] => ({ id, revision: 1,
  sha256: "a".repeat(64), decodedSha256: "b".repeat(64), objectId: "80000000-0000-4000-8000-000000000008",
  normalizedAt: "2026-09-15T10:00:00Z", build: "GRCh38", completed: [], ...(prepared ? {
    preparedSource: { version: "own-prepared-report-source-v1", backend: "prepared-object-v1",
      manifestId: "80000000-0000-4000-8000-000000000009", membershipSha256: "c".repeat(64),
      rootArtifactId: "80000000-0000-4000-8000-000000000010", rootSha256: "d".repeat(64) },
  } : {}) });
const call = (file_id: string, pos = 1): OwnChatCall => ({ file_id, rsid: 1, chrom: 1, pos, ref: "A", alt: "C", genotype: "A/C", usable: true });
function setup(sources = [source(fileA), source(fileB, true)]) {
  const projection: OwnChatProjection = { sources, legacySources: [], unavailableSources: [] };
  const check = vi.fn<(signal: AbortSignal) => Promise<void>>(async () => {});
  const readDatabasePage = vi.fn(async (offset: number) => offset === 0 ? [call(fileA)] : []);
  mocked.prepared.mockImplementation(async (_actor, selection, _rsids, options) => { options.consumeEvidence(1, 300); return [call(selection.fileId)]; });
  return { authority, projection, check, readDatabasePage };
}
beforeEach(() => { mocked.prepared.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe("complete own raw-call source union", () => {
  it("combines exact database and prepared sources while preserving cross-locus conflict", async () => {
    const f = setup(); mocked.prepared.mockImplementation(async (_actor, selection, _rsids, options) => {
      options.consumeEvidence(1, 300); return [call(selection.fileId, 8)];
    });
    const result = await readOwnChatCalls([1], f);
    expect(result).toEqual({ state: "available", calls: [call(fileA), call(fileB, 8)] });
    if (result.state === "available") expect(ownGenotypeResult(1, result.calls, null).status).toBe("conflict");
    expect(mocked.prepared.mock.calls[0].slice(0, 3)).toEqual([{ accountId, sessionId }, {
      fileId: fileB, subjectId, sourceRevision: 1, sourceSha256: "a".repeat(64), decodedSha256: "b".repeat(64),
      normalizedAt: "2026-09-15T10:00:00Z", preparedSource: f.projection.sources[1].preparedSource,
    }, [1]]);
    expect(f.check.mock.invocationCallOrder.at(-1)).toBeGreaterThan(mocked.prepared.mock.invocationCallOrder[0]);
  });

  it("preserves the exact database projection shape without adding optional nulls", () => {
    const f = setup([source(fileA)]);
    expect(JSON.stringify(ownChatProjectionSchema.parse(f.projection))).toBe(JSON.stringify(f.projection));
    expect(ownChatProjectionSchema.parse(f.projection).sources[0]).not.toHaveProperty("preparedSource");
  });

  it.each(["prepared-id", "unknown-id", "wrong-rsid"])("rejects %s from the database selector without prepared fallback", async mode => {
    const f = setup(), row = call(mode === "prepared-id" ? fileB : mode === "unknown-id" ? fileC : fileA);
    if (mode === "wrong-rsid") row.rsid = 2;
    f.readDatabasePage.mockResolvedValue([row]);
    await expect(readOwnChatCalls([1], f)).rejects.toMatchObject({ code: "unavailable" }); expect(mocked.prepared).not.toHaveBeenCalled();
  });

  it("does not read database rows for a prepared-only projection", async () => {
    const f = setup([source(fileB, true)]);
    expect(await readOwnChatCalls([1], f)).toEqual({ state: "available", calls: [call(fileB)] });
    expect(f.readDatabasePage).not.toHaveBeenCalled();
  });

  it.each(["records", "bytes"])("shares the %s budget across files including evidence omitted as exact duplicates", async dimension => {
    const f = setup([source(fileB, true), source(fileC, true)]);
    mocked.prepared.mockImplementation(async (_actor, _selection, _rsids, options) => {
      options.consumeEvidence(dimension === "records" ? 5001 : 1, dimension === "bytes" ? 1_000_001 : 300);
      return []; // Even omitted evidence must be charged before any final calls.
    });
    await expect(readOwnChatCalls([1], f)).rejects.toMatchObject({ code: "too_large" }); expect(mocked.prepared).toHaveBeenCalledTimes(2);
  });

  it("charges database and prepared evidence to the same budget", async () => {
    const f = setup(); mocked.prepared.mockImplementation(async (_actor, _selection, _rsids, options) => { options.consumeEvidence(10000, 300); return []; });
    await expect(readOwnChatCalls([1], f)).rejects.toMatchObject({ code: "too_large" });
  });

  it("stops before the next source when duplicate-heavy evidence exhausts the budget", async () => {
    const f = setup([source(fileB, true), source(fileC, true)]);
    mocked.prepared.mockImplementation(async (_actor, _selection, _rsids, options) => {
      options.consumeEvidence(10001, 300); return [];
    });
    await expect(readOwnChatCalls([1], f)).rejects.toMatchObject({ code: "too_large" });
    expect(mocked.prepared).toHaveBeenCalledTimes(1);
  });

  it("discards earlier database calls when selected prepared evidence is unavailable", async () => {
    const f = setup(); mocked.prepared.mockRejectedValue(new PreparedCopilotReadError("source_unavailable"));
    expect(await readOwnChatCalls([1], f)).toEqual({ state: "source_unavailable" });
    expect(f.check.mock.invocationCallOrder.at(-1)).toBeGreaterThan(mocked.prepared.mock.invocationCallOrder[0]);
  });

  it("requires a final check even when the captured projection already contains an unavailable source", async () => {
    const f = setup(); f.projection.unavailableSources.push({ id: fileC, reason: "source_unavailable" });
    expect(await readOwnChatCalls([1], f)).toEqual({ state: "source_unavailable" }); expect(f.check).toHaveBeenCalledTimes(2);
    expect(f.readDatabasePage).not.toHaveBeenCalled(); expect(mocked.prepared).not.toHaveBeenCalled();
    f.check.mockReset().mockResolvedValueOnce(undefined).mockRejectedValue(new Error("synthetic revoked"));
    await expect(readOwnChatCalls([1], f)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("refuses source-unavailable after a late whole-projection change", async () => {
    const f = setup(); mocked.prepared.mockImplementation(async () => {
      f.check.mockRejectedValue(new Error("synthetic changed")); throw new PreparedCopilotReadError("source_unavailable");
    });
    await expect(readOwnChatCalls([1], f)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("does not return earlier calls after a malformed prepared pointer fails", async () => {
    const f = setup(); mocked.prepared.mockRejectedValue(new PreparedCopilotReadError("integrity_mismatch"));
    await expect(readOwnChatCalls([1], f)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("uses one deadline across sequential sources rather than granting each a fresh period", async () => {
    const f = setup([source(fileB, true), source(fileC, true)]); vi.useFakeTimers();
    mocked.prepared.mockImplementationOnce(async (_actor, selection, _rsids, options) => {
      await new Promise(resolve => setTimeout(resolve, 25_000)); options.consumeEvidence(1, 300); return [call(selection.fileId)];
    }).mockImplementationOnce(() => new Promise(() => {}));
    const pending = readOwnChatCalls([1], f), assertion = expect(pending).rejects.toMatchObject({ code: "aborted" });
    await vi.advanceTimersByTimeAsync(25_000); expect(mocked.prepared).toHaveBeenCalledTimes(2);
    const firstSignal = mocked.prepared.mock.calls[0][3].signal, secondSignal = mocked.prepared.mock.calls[1][3].signal;
    expect(secondSignal).toBe(firstSignal); await vi.advanceTimersByTimeAsync(5_000); await assertion;
    expect(firstSignal.aborted).toBe(true);
  });

  it("cancels a stalled database page under the same whole-union deadline", async () => {
    const f = setup(); vi.useFakeTimers(); f.readDatabasePage.mockImplementation(() => new Promise(() => {}));
    const pending = readOwnChatCalls([1], f), assertion = expect(pending).rejects.toMatchObject({ code: "aborted" });
    await vi.advanceTimersByTimeAsync(30_000); await assertion; expect(mocked.prepared).not.toHaveBeenCalled();
  });
});
