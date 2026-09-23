import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publicationFixture } from "../genome/prepared-source/prepare-genome-publication.fixtures";
import { row } from "../genome/prepared-source/materialize-canonical.fixtures";
import type { OwnPreparedSource } from "../genome/prepared-source/published-source-reader";
import type { CanonicalRsidCursor } from "../genome/prepared-source/canonical-rsid-reader";
import { readOwnPreparedCopilotCalls, type PreparedCopilotSelection } from "./own-prepared-calls";

const mocked = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../genome/prepared-source/published-source-reader", async original => ({
  ...await original<typeof import("../genome/prepared-source/published-source-reader")>(),
  createOwnPreparedRsidReader: vi.fn(() => mocked.read),
}));
const actor = { accountId: "11111111-1111-4111-8111-111111111111", sessionId: "22222222-2222-4222-8222-222222222222" };
const manifestId = "88888888-8888-4888-8888-888888888888";
const cursor = (offset: number): CanonicalRsidCursor => ({ version: "canonical-rsid-cursor-v1", canonicalSha256: "a".repeat(64),
  rsidSha256: "b".repeat(64), querySha256: createHash("sha256").update("[1]").digest("hex"), indexBlockSequence: 0, pointerOffset: offset });
async function setup(rows = [row(1)], build: "GRCh37" | "GRCh38" = "GRCh38") {
  const f = await publicationFixture(rows, build), sourceBinding = f.binding.source;
  // The adapter fixture pins a synthetic descriptor. Actual published/member
  // serialization and transport are exercised in published-source-reader.test.
  const root = f.canonical.directories[0].artifact;
  const source: OwnPreparedSource = { version: "own-prepared-source-v1", backend: "prepared-object-v1", manifestId,
    fileId: sourceBinding.fileId, subjectId: sourceBinding.subjectId, sourceRevision: 1,
    rawSha256: sourceBinding.rawSha256, decodedSha256: sourceBinding.decodedSha256, preparedAt: "2026-09-08T19:00:00Z",
    root, summary: { version: "own-prepared-summary-v1", sourceBuild: build, parserRevision: sourceBinding.parserRevision,
      canonicalRevision: "prepared-canonical-v1", sourceVariantCount: f.canonical.counts.sourceVariantCount,
      sourceObservedCount: f.canonical.counts.sourceObservedCount, sourceReferenceCount: f.canonical.counts.sourceReferenceCount,
      variantCount: f.canonical.counts.normalizedVariantCount, observedCallCount: f.canonical.counts.normalizedObservedCount,
      usableObservedCount: f.canonical.counts.usableObservedCount, attempted: f.canonical.canonicalSummary.attempted,
      unmapped: f.canonical.canonicalSummary.unmapped, rsidPointerCount: f.root.pointerCount },
    memberCount: f.canonical.artifactCount + f.root.artifactCount + 3, membershipSha256: "d".repeat(64) };
  const selection: PreparedCopilotSelection = { fileId: source.fileId, subjectId: source.subjectId, sourceRevision: 1,
    sourceSha256: source.rawSha256, decodedSha256: source.decodedSha256, normalizedAt: source.preparedAt,
    preparedSource: { version: "own-prepared-report-source-v1", backend: "prepared-object-v1", manifestId,
      membershipSha256: source.membershipSha256, rootArtifactId: root.receipt.artifactId, rootSha256: root.receipt.sha256 } };
  const checkOperation = vi.fn<(signal: AbortSignal) => Promise<void>>(async () => {});
  mocked.read.mockResolvedValue({ source, records: f.records, nextCursor: null });
  return { ...f, source, selection, checkOperation };
}
beforeEach(() => { mocked.read.mockReset(); });

describe("own prepared Copilot adapter (synthetic source reader)", () => {
  it("charges the shared budget for original duplicate evidence before projecting calls", async () => {
    const f = await setup([row(1), row(1)]), consumeEvidence = vi.fn();
    const calls = await readOwnPreparedCopilotCalls(actor, f.selection, [1], { ...f, consumeEvidence });
    expect(calls).toHaveLength(3); expect(f.records).toHaveLength(4);
    expect(consumeEvidence).toHaveBeenCalledExactlyOnceWith(4, Buffer.byteLength(JSON.stringify(f.records)));
  });

  it("keeps conflicting loci and observed no-calls while proving each discarded duplicate", async () => {
    const f = await setup([row(1), row(1), row(8).replace("rs8", "rs1"), row(9, "./.").replace("rs9", "rs1")]);
    const calls = await readOwnPreparedCopilotCalls(actor, f.selection, [1], f);
    expect(calls).toHaveLength(6);
    expect(new Set(calls.map(c => c.pos))).toEqual(new Set([1, 8, 9]));
    expect(calls.find(c => c.pos === 9)).toMatchObject({ genotype: "--", usable: false });
    expect(calls.every(c => c.file_id === f.source.fileId && c.rsid === 1)).toBe(true);
    expect(f.checkOperation).toHaveBeenCalledTimes(2);
  });

  it("drains a short page and an empty continuation before resolving", async () => {
    const f = await setup();
    mocked.read.mockResolvedValueOnce({ source: f.source, records: [f.records[0]], nextCursor: cursor(0) })
      .mockResolvedValueOnce({ source: f.source, records: [], nextCursor: cursor(1) })
      .mockResolvedValueOnce({ source: f.source, records: [f.records[1]], nextCursor: null });
    expect(await readOwnPreparedCopilotCalls(actor, f.selection, [1], f)).toHaveLength(2);
    expect(mocked.read).toHaveBeenCalledTimes(3);
  });

  it.each(["sourceSha256", "decodedSha256", "subjectId", "sourceRevision", "normalizedAt", "manifestId", "membershipSha256", "rootArtifactId", "rootSha256"])
    ("refuses changed pinned %s", async field => {
      const f = await setup(), bad = structuredClone(f.selection);
      if (field in bad.preparedSource) Reflect.set(bad.preparedSource, field, field.endsWith("Id") ? actor.accountId : "f".repeat(64));
      else Reflect.set(bad, field, field === "sourceRevision" ? 2 : field === "subjectId" ? actor.accountId
        : field === "normalizedAt" ? "2026-09-08T19:01:00Z" : "f".repeat(64));
      await expect(readOwnPreparedCopilotCalls(actor, bad, [1], f)).rejects.toMatchObject({ code: "integrity_mismatch" });
    });

  it("does not release earlier calls when the source changes between pages", async () => {
    const f = await setup(), changed = structuredClone(f.source); changed.summary.parserRevision = "synthetic-changed";
    mocked.read.mockResolvedValueOnce({ source: f.source, records: [f.records[0]], nextCursor: cursor(0) })
      .mockResolvedValueOnce({ source: changed, records: [f.records[1]], nextCursor: null });
    await expect(readOwnPreparedCopilotCalls(actor, f.selection, [1], f)).rejects.toMatchObject({ code: "integrity_mismatch" });
  });

  it("refuses selected unmapped evidence instead of returning absent coverage", async () => {
    const f = await setup([row(1), row(30)], "GRCh37");
    mocked.read.mockResolvedValue({ source: f.source, records: f.records.filter(r => r.normalization.status === "unmapped"), nextCursor: null });
    await expect(readOwnPreparedCopilotCalls(actor, f.selection, [30], f)).rejects.toMatchObject({ code: "source_unavailable" });
  });

  it("refuses a duplicate whose claimed original is absent from the drained evidence", async () => {
    const f = await setup([row(1), row(1)]);
    mocked.read.mockResolvedValue({ source: f.source, records: f.records.filter(r => r.normalization.status === "duplicate"), nextCursor: null });
    await expect(readOwnPreparedCopilotCalls(actor, f.selection, [1], f)).rejects.toMatchObject({ code: "integrity_mismatch" });
  });

  it.each(["stalled", "different-root", "different-query"])("rejects %s pagination", async mode => {
    const f = await setup(), next = cursor(mode === "stalled" ? 0 : 1);
    if (mode === "different-root") next.rsidSha256 = "f".repeat(64);
    if (mode === "different-query") next.querySha256 = "f".repeat(64);
    mocked.read.mockResolvedValueOnce({ source: f.source, records: [], nextCursor: cursor(0) })
      .mockResolvedValueOnce({ source: f.source, records: [], nextCursor: next });
    await expect(readOwnPreparedCopilotCalls(actor, f.selection, [1], f)).rejects.toMatchObject({ code: "integrity_mismatch" });
  });

  it("bounds empty advancing pages even when the transport keeps replying", async () => {
    const f = await setup(); let index = 0;
    mocked.read.mockImplementation(async () => ({ source: f.source, records: [], nextCursor: cursor(index++) }));
    await expect(readOwnPreparedCopilotCalls(actor, f.selection, [1], f)).rejects.toMatchObject({ code: "too_large" });
    expect(mocked.read).toHaveBeenCalledTimes(11);
  });

  it("refuses an oversized page", async () => {
    const f = await setup(); mocked.read.mockResolvedValue({ source: f.source, records: Array(1001).fill(f.records[0]), nextCursor: null });
    await expect(readOwnPreparedCopilotCalls(actor, f.selection, [1], f)).rejects.toMatchObject({ code: "integrity_mismatch" });
  });

  it("enforces aggregate evidence bytes across individually valid pages", async () => {
    const f = await setup(), record = structuredClone(f.records[0]);
    // Long valid string evidence exercises the byte bound independently of row count.
    if (record.event.type === "observed") record.event.call.genotype = "A".repeat(16000);
    if (record.normalization.status === "normalized") record.normalization.record.genotype = "A".repeat(16000);
    let index = 0;
    mocked.read.mockImplementation(async () => ({ source: f.source, records: Array(30).fill(record), nextCursor: cursor(index++) }));
    await expect(readOwnPreparedCopilotCalls(actor, f.selection, [1], f)).rejects.toMatchObject({ code: "too_large" });
    expect(mocked.read.mock.calls.length).toBeLessThan(5);
  });

  it("suppresses all calls after a late projection refusal", async () => {
    const f = await setup(); f.checkOperation.mockResolvedValueOnce(undefined).mockRejectedValue(new Error("synthetic revoked"));
    await expect(readOwnPreparedCopilotCalls(actor, f.selection, [1], f)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("cancels a stalled final projection check and closes its operation scope", async () => {
    const f = await setup(), entered = Promise.withResolvers<void>(), controller = new AbortController(); let current: AbortSignal | undefined;
    f.checkOperation.mockResolvedValueOnce(undefined).mockImplementation(async signal => { current = signal; entered.resolve(); return new Promise(() => {}); });
    const pending = readOwnPreparedCopilotCalls(actor, f.selection, [1], { ...f, signal: controller.signal });
    await entered.promise; controller.abort(); await expect(pending).rejects.toMatchObject({ code: "aborted" }); expect(current?.aborted).toBe(true);
  });

  it("enforces the whole-operation deadline even if a page never settles", async () => {
    const f = await setup(); vi.useFakeTimers();
    try {
      mocked.read.mockImplementation(() => new Promise(() => {}));
      const pending = readOwnPreparedCopilotCalls(actor, f.selection, [1], f);
      const assertion = expect(pending).rejects.toMatchObject({ code: "aborted" });
      await vi.advanceTimersByTimeAsync(30_000); await assertion;
    } finally { vi.useRealTimers(); }
  });
});
