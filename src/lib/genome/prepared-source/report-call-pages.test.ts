import { afterEach, describe, expect, it, vi } from "vitest";
import { readOwnPreparedReportPages, type PreparedReportSelection } from "./report-call-pages";
import { createOwnPreparedCoordinateReader, type OwnPreparedSource } from "./published-source-reader";
import { fixture, row } from "./materialize-canonical.fixtures";
import type { CanonicalRecord } from "./canonical-schema";
import type { CanonicalCoordinateCursor } from "./canonical-coordinate-reader";

vi.mock("./published-source-reader", () => ({ createOwnPreparedCoordinateReader: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const actor = { accountId: id, sessionId: other };
const cursor = (offset: number): CanonicalCoordinateCursor => ({ version: "canonical-coordinate-cursor-v1",
  manifestSha256: "c".repeat(64), querySha256: "d".repeat(64), blockSequence: 0, recordOffset: offset });
// Synthetic page transport. Parser/canonical records are real runtime output;
// publication/authorization here are fixtures, not actual SQL/provider evidence.
async function setup(build: "GRCh37" | "GRCh38" = "GRCh38", rows = [row(1), row(1), row(2, "./.")], chain?: Uint8Array) {
  const f = await fixture(rows, build, chain), source: OwnPreparedSource = {
    version: "own-prepared-source-v1", backend: "prepared-object-v1", manifestId: id,
    fileId: f.binding.source.fileId, subjectId: f.binding.source.subjectId, sourceRevision: f.binding.source.sourceRevision,
    rawSha256: f.binding.source.rawSha256, decodedSha256: f.binding.source.decodedSha256,
    preparedAt: "2026-09-08T20:00:00Z", membershipSha256: "b".repeat(64), memberCount: 8,
    root: { storageObjectId: other, receipt: { version: "own-preparation-artifact-v1", artifactId: id,
      jobId: id, attemptId: other, sequence: 13, bucket: "genomes", objectKey: `prepared/${id}`,
      byteCount: 1000, sha256: "a".repeat(64), writeExpiresAt: "2026-09-08T19:00:00Z" } },
    summary: { version: "own-prepared-summary-v1", sourceBuild: build, parserRevision: f.binding.source.parserRevision,
      canonicalRevision: "prepared-canonical-v1", sourceVariantCount: 2, sourceObservedCount: 3,
      sourceReferenceCount: 0, variantCount: 1, observedCallCount: 3, usableObservedCount: 2,
      attempted: 0, unmapped: 0, rsidPointerCount: 5 },
  };
  const selection: PreparedReportSelection = { fileId: source.fileId, subjectId: source.subjectId,
    sourceRevision: source.sourceRevision, sourceSha256: source.rawSha256, normalizedAt: source.preparedAt,
    preparedSource: { version: "own-prepared-report-source-v1", backend: "prepared-object-v1", manifestId: id,
      membershipSha256: source.membershipSha256, rootArtifactId: id, rootSha256: source.root.receipt.sha256 } };
  const records = f.records.filter(r => r.normalization.status === "normalized");
  const read = vi.fn<ReturnType<typeof createOwnPreparedCoordinateReader>>().mockImplementation(async (_, options) => {
    await options.checkOperation(options.signal ?? new AbortController().signal);
    return { source, records, nextCursor: null };
  });
  vi.mocked(createOwnPreparedCoordinateReader).mockReturnValue(read);
  const checkOperation = vi.fn<(signal: AbortSignal) => Promise<void>>(async () => {});
  const loci = [...new Map(records.map(r => {
    const n = r.normalization; if (n.status !== "normalized") throw Error();
    return [`${n.record.chrom}:${n.record.pos}`, { chrom: n.record.chrom, pos: n.record.pos }];
  })).values()];
  return { source, selection, records, allRecords: f.records, read, checkOperation, loci,
    pages: () => readOwnPreparedReportPages(actor, selection, loci, { checkOperation }) };
}
afterEach(() => vi.clearAllMocks());

describe("prepared report projection and cursor iteration (mock page transport)", () => {
  it("retains original line/usability, repeated observations and no-calls without duplicating the canonical variant", async () => {
    const f = await setup(), pages = await Array.fromAsync(f.pages());
    expect(pages).toHaveLength(1); expect(pages[0].variants).toHaveLength(1);
    expect(pages[0].observations).toHaveLength(3);
    expect(pages[0].observations.at(-1)).toMatchObject({ call: { genotype: "--", usable: false } });
    expect(pages[0].observations.map(r => r.sourceLine)).toEqual(f.records.filter(r => r.event.type === "observed").map(r => r.event.line));
    expect(f.checkOperation).toHaveBeenCalled();
  });

  it("projects actual reverse-strand target alleles and coordinates, preserving original usability", async () => {
    const f = await setup("GRCh37", [row(1), row(2, "./.")], Buffer.from("chain 1 1 1000 + 0 10 1 1000 - 100 110 1\n10\n"));
    const [page] = await Array.fromAsync(f.pages());
    expect(page.variants[0].call).toMatchObject({ chrom: 1, pos: 900, ref: "T", alt: "G", genotype: "G/T" });
    expect(page.observations.find(r => r.call.pos === 899)?.call).toMatchObject({ genotype: "--", usable: false });
    expect(f.records[0].event).not.toMatchObject({ call: { pos: 900 } });
  });

  it("continues short and empty pages until null without using a row-count EOF heuristic", async () => {
    const f = await setup();
    f.read.mockResolvedValueOnce({ source: f.source, records: f.records.slice(0, 1), nextCursor: cursor(1) })
      .mockResolvedValueOnce({ source: f.source, records: [], nextCursor: cursor(2) })
      .mockResolvedValueOnce({ source: f.source, records: f.records.slice(1), nextCursor: null });
    const pages = await Array.fromAsync(f.pages());
    expect(pages).toHaveLength(3); expect(f.read.mock.calls.map(([request]) => request.cursor)).toEqual([null, cursor(1), cursor(2)]);
    expect(pages.flatMap(p => [...p.variants, ...p.observations])).toHaveLength(f.records.length);
  });

  it.each(["manifest", "root", "digest", "file", "subject", "revision", "raw", "time"])("refuses a changed captured %s source before yielding calls", async field => {
    const f = await setup();
    if (field === "manifest") f.source.manifestId = other;
    if (field === "root") f.source.root.receipt.artifactId = other;
    if (field === "digest") f.source.membershipSha256 = "f".repeat(64);
    if (field === "file") f.source.fileId = other;
    if (field === "subject") f.source.subjectId = id;
    if (field === "revision") f.source.sourceRevision++;
    if (field === "raw") f.source.rawSha256 = "f".repeat(64);
    if (field === "time") f.source.preparedAt = "2026-09-08T20:00:01Z";
    await expect(f.pages().next()).rejects.toMatchObject({ code: "integrity_mismatch" });
  });

  it("compares the complete source across pages, including decoded-source identity", async () => {
    const f = await setup();
    f.read.mockResolvedValueOnce({ source: f.source, records: [], nextCursor: cursor(1) })
      .mockResolvedValueOnce({ source: { ...f.source, decodedSha256: "f".repeat(64) }, records: [], nextCursor: null });
    const pages = f.pages(); await pages.next();
    await expect(pages.next()).rejects.toMatchObject({ code: "integrity_mismatch" });
  });

  it.each([cursor(1), cursor(0), { ...cursor(2), querySha256: "f".repeat(64) }])("refuses repeated/backward or changed-query cursors", async next => {
    const f = await setup();
    f.read.mockResolvedValueOnce({ source: f.source, records: [], nextCursor: cursor(1) })
      .mockResolvedValueOnce({ source: f.source, records: [], nextCursor: next });
    const pages = f.pages(); await pages.next(); await expect(pages.next()).rejects.toMatchObject({ code: "integrity_mismatch" });
  });

  it("does not convert a later permission refusal into a successful truncated result", async () => {
    const f = await setup();
    f.read.mockResolvedValueOnce({ source: f.source, records: f.records.slice(0, 1), nextCursor: cursor(1) })
      .mockRejectedValueOnce(Error("private provider detail"));
    await expect(Array.fromAsync(f.pages())).rejects.toMatchObject({ code: "unavailable", message: "unavailable" });
  });

  it("owns selection and loci before callbacks can mutate their caller objects", async () => {
    const f = await setup(), stream = f.pages();
    f.selection.preparedSource.manifestId = other; f.loci.length = 0;
    const pages = await Array.fromAsync(stream); expect(pages[0].variants).toHaveLength(1);
    expect(f.read.mock.calls[0][0].expectedManifestId).toBe(id);
  });

  it.each(["unselected", "duplicate", "oversized"])("refuses an unexpected %s page instead of treating it as coverage", async kind => {
    const f = await setup(); let records: CanonicalRecord[];
    if (kind === "unselected") {
      const record = structuredClone(f.records[0]); if (record.normalization.status === "normalized") record.normalization.record.pos = 999;
      records = [record];
    } else if (kind === "duplicate") records = f.allRecords.filter(r => r.normalization.status === "duplicate");
    else records = Array.from({ length: 1001 }, () => f.records[0]);
    expect(records.length).toBeGreaterThan(0); f.read.mockResolvedValue({ source: f.source, records, nextCursor: null });
    await expect(f.pages().next()).rejects.toMatchObject({ code: "integrity_mismatch" });
  });

  it("refuses pre-cancelled reads without calling the page reader", async () => {
    const f = await setup(), signal = AbortSignal.abort();
    const pages = readOwnPreparedReportPages(actor, f.selection, f.loci, { checkOperation: f.checkOperation, signal });
    await expect(pages.next()).rejects.toMatchObject({ code: "aborted" }); expect(f.read).not.toHaveBeenCalled();
  });
});
