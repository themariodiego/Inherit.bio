import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { materializeCanonicalMerge, type CanonicalContainerDirectory } from "./materialize-canonical";
import { readCanonicalCoordinates, type CanonicalCoordinateCursor, type CanonicalReadSelection } from "./canonical-coordinate-reader";
import { values, row, fixture, sink, jobId, attemptId } from "./materialize-canonical.fixtures";
import type { PreparedRangeFetch } from "./storage-reader";

async function setup(rows = [row(1), row(1), row(2, "0/0"), row(3, "./."), row(4, "0/1", "AC")], build: "GRCh37" | "GRCh38" = "GRCh38", reverse = false) {
  const f = await fixture(rows, build, reverse ? Buffer.from("chain 1 1 1000 + 0 10 1 1000 - 100 110 1\n10\n") : undefined), out = sink();
  const manifest = await materializeCanonicalMerge(values(f.output), { ...f, ...out, jobId, attemptId });
  const fetchRange = vi.fn<PreparedRangeFetch>(async ({ objectKey, start, end }) => {
    const bytes = out.objects.get(objectKey); if (!bytes) return new Response(null, { status: 404 });
    return new Response(Buffer.from(bytes.subarray(start, end + 1)), { status: 206,
      headers: { "content-range": `bytes ${start}-${end}/${bytes.length}`, "content-length": String(end - start + 1) } });
  });
  const check = vi.fn<(selection: CanonicalReadSelection, signal: AbortSignal) => Promise<void>>(async () => {});
  return { ...f, ...out, manifest, fetchRange, check, expected: { binding: f.binding, jobId, attemptId } };
}

describe("verified canonical coordinate reads", () => {
  it("reads the exact indexed range and returns normalized plus original evidence", async () => {
    const f = await setup(Array.from({ length: 1100 }, (_, i) => row(i + 1)));
    const result = await readCanonicalCoordinates({ ...f, loci: [{ chrom: 1, pos: 1050 }] }, f);
    expect(result.records).toEqual(f.records.filter(r => r.normalization.status === "normalized" && r.normalization.record.pos === 1050));
    expect(result.nextCursor).toBeNull(); expect(f.fetchRange).toHaveBeenCalledTimes(3);
    const dataRead = f.fetchRange.mock.calls.at(-1)![0]; expect(dataRead.start).toBeGreaterThan(0);
    const calls = f.check.mock.calls.map(([selection]) => selection.artifact?.receipt.objectKey ?? null);
    expect(calls[0]).toBeNull(); expect(calls.at(-1)).toBeNull();
    expect(calls.filter(key => key === dataRead.objectKey)).toHaveLength(2);
  });

  it("selects reverse-strand GRCh37 target coordinates without replacing original calls", async () => {
    const f = await setup([row(1), row(30)], "GRCh37", true);
    // Reverse chain maps source1→target900; original30 is unmapped.
    const result = await readCanonicalCoordinates({ ...f, loci: [{ chrom: 1, pos: 900 }] }, f);
    expect(result.records).toHaveLength(2);
    expect(result.records.every(r => r.normalization.status === "normalized" && r.normalization.record.pos === 900)).toBe(true);
    expect(result.records[0].event).toMatchObject({ type: "observed", call: { pos: 1, ref: "A", alt: "C", genotype: "A/C" } });
    expect(result.records[0].normalization).toMatchObject({ status: "normalized", record: { ref: "T", alt: "G", genotype: "G/T" } });
    const absent = await readCanonicalCoordinates({ ...f, loci: [{ chrom: 1, pos: 30 }] }, f);
    expect(absent.records).toEqual([]);
  });

  it("retains repeated observations and no-calls across a full1000-record cursor boundary", async () => {
    const f = await setup([...Array.from({ length: 1050 }, () => row(1)), row(2, "./.")]);
    const loci = [{ chrom: 1, pos: 1 }, { chrom: 1, pos: 2 }];
    const first = await readCanonicalCoordinates({ ...f, loci }, f);
    expect(first.records).toHaveLength(1000); expect(first.nextCursor).not.toBeNull();
    const second = await readCanonicalCoordinates({ ...f, loci, cursor: first.nextCursor }, f);
    expect(second.nextCursor).toBeNull();
    const expected = f.records.filter(r => r.normalization.status === "normalized");
    expect([...first.records, ...second.records]).toEqual(expected);
    expect(second.records.some(r => r.normalization.status === "normalized" && r.normalization.record.genotype === "--")).toBe(true);
  });

  it.each(["query", "manifest", "offset"])("refuses a cursor for another %s", async mode => {
    const f = await setup(Array.from({ length: 1001 }, () => row(1))), loci = [{ chrom: 1, pos: 1 }];
    const first = await readCanonicalCoordinates({ ...f, loci }, f);
    const cursor = structuredClone(first.nextCursor!) as CanonicalCoordinateCursor;
    if (mode === "query") cursor.querySha256 = "f".repeat(64);
    if (mode === "manifest") cursor.manifestSha256 = "f".repeat(64);
    if (mode === "offset") cursor.recordOffset = 1999; // No matching normalized record at this position.
    await expect(readCanonicalCoordinates({ ...f, loci, cursor }, f)).rejects.toMatchObject({ code: "invalid_request" });
  });

  it.each(["duplicate", "oversized", "invalid"])("refuses %s query input before provider I/O", async mode => {
    const f = await setup();
    const loci = mode === "duplicate" ? [{ chrom: 1, pos: 1 }, { chrom: 1, pos: 1 }]
      : mode === "oversized" ? Array.from({ length: 201 }, (_, i) => ({ chrom: 1, pos: i + 1 })) : [{ chrom: 0, pos: 1 }];
    await expect(readCanonicalCoordinates({ ...f, loci }, f)).rejects.toBeInstanceOf(Error);
    expect(f.fetchRange).not.toHaveBeenCalled();
  });

  it.each(["directory", "coordinate", "data"])("fails on corrupted %s bytes instead of returning missing coverage", async kind => {
    const f = await setup();
    const key = kind === "directory" ? f.manifest.directories[0].artifact.receipt.objectKey
      : kind === "coordinate" ? f.manifest.coordinatePages[0].artifact.receipt.objectKey
      : [...f.objects.keys()].find(key => key !== f.manifest.directories[0].artifact.receipt.objectKey
        && key !== f.manifest.coordinatePages[0].artifact.receipt.objectKey)!;
    f.objects.get(key)![0] ^= 1;
    await expect(readCanonicalCoordinates({ ...f, loci: [{ chrom: 1, pos: 1 }] }, f)).rejects.toBeInstanceOf(Error);
  });

  it("rejects a reused data artifact sequence across two otherwise valid directories", async () => {
    const f = await setup(Array.from({ length: 1100 }, (_, i) => row(i + 1)));
    const oldDirectory = JSON.parse(Buffer.from(f.objects.get(f.manifest.directories[0].artifact.receipt.objectKey)!).toString()) as CanonicalContainerDirectory;
    const original = oldDirectory.containers[0], originalBytes = f.objects.get(original.artifact.receipt.objectKey)!;
    const pageBytes = f.objects.get(f.manifest.coordinatePages[0].artifact.receipt.objectKey)!;
    const stored = [];
    const write = (bytes: Uint8Array, sequence: number) => f.writeArtifact({ descriptor: { kind: "container", sequence,
      byteCount: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }, bytes });
    for (const [sequence, range] of original.descriptor.blocks.entries()) {
      const bytes = originalBytes.subarray(range.offset, range.offset + range.length), artifact = await write(bytes, sequence);
      stored.push({ artifact, descriptor: { ...original.descriptor, sequence, byteCount: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"), blocks: [{ ...range, offset: 0 }] } });
    }
    // Deliberate structural corruption: different identities claim the same
    // global reservation sequence, while each page individually remains valid.
    stored[1].artifact.receipt.sequence = stored[0].artifact.receipt.sequence;
    const directories = [];
    for (const [sequence, container] of stored.entries()) {
      const bytes = Buffer.from(JSON.stringify({ version: "canonical-container-directory-v1", state: "provisional",
        binding: f.binding, sequence, containers: [container] }));
      directories.push({ artifact: await write(bytes, sequence + 2), sequence, firstBlockSequence: sequence,
        lastBlockSequence: sequence, containerCount: 1, blockCount: 1 });
    }
    const manifest = { ...f.manifest, directories, containerCount: 2, artifactCount: 5, nextArtifactSequence: 5,
      coordinatePages: [{ ...f.manifest.coordinatePages[0], artifact: await write(pageBytes, 4) }] };
    await expect(readCanonicalCoordinates({ ...f, manifest, loci: [{ chrom: 1, pos: 1 }, { chrom: 1, pos: 1050 }] }, f))
      .rejects.toMatchObject({ code: "integrity_mismatch" });
  });

  it("does not release accumulated calls after a final authority refusal", async () => {
    const f = await setup(); let roots = 0;
    f.check.mockImplementation(async selection => { if (selection.artifact === null && ++roots === 2) throw new Error("synthetic revoked"); });
    await expect(readCanonicalCoordinates({ ...f, loci: [{ chrom: 1, pos: 1 }] }, f)).rejects.toMatchObject({ code: "unavailable" });
    expect(f.fetchRange).toHaveBeenCalledTimes(3);
  });

  it("checks current authority even for an absent or empty query", async () => {
    const f = await setup();
    for (const loci of [[], [{ chrom: 25, pos: 900 }]]) {
      f.check.mockClear(); f.fetchRange.mockClear();
      expect(await readCanonicalCoordinates({ ...f, loci }, f)).toEqual({ records: [], nextCursor: null });
      expect(f.check).toHaveBeenCalledTimes(2); expect(f.fetchRange).not.toHaveBeenCalled();
    }
    f.check.mockRejectedValue(new Error("synthetic revoked"));
    await expect(readCanonicalCoordinates({ ...f, loci: [] }, f)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("owns manifest and object selections across callback mutation", async () => {
    const f = await setup();
    f.check.mockImplementation(async selection => {
      selection.manifest.binding.source.sourceRevision++;
      if (selection.artifact) selection.artifact.receipt.objectKey = "prepared/55555555-5555-4555-8555-555555555555";
    });
    const result = await readCanonicalCoordinates({ ...f, loci: [{ chrom: 1, pos: 1 }] }, f);
    expect(result.records).toHaveLength(3); expect(f.manifest.binding.source.sourceRevision).toBe(1);
  });

  it("cancels a stalled final check and suppresses the whole response", async () => {
    const f = await setup(), entered = Promise.withResolvers<void>(), controller = new AbortController(); let roots = 0;
    f.check.mockImplementation(async selection => {
      if (!selection.artifact && ++roots === 2) { entered.resolve(); return new Promise(() => {}); }
    });
    const pending = readCanonicalCoordinates({ ...f, loci: [{ chrom: 1, pos: 1 }] }, { ...f, signal: controller.signal });
    await entered.promise; controller.abort(); await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });
});
