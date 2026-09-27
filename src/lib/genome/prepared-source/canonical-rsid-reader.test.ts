import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { publicationFixture } from "./prepare-genome-publication.fixtures";
import { row } from "./materialize-canonical.fixtures";
import { readCanonicalRsids, type CanonicalRsidReadSelection } from "./canonical-rsid-reader";
import type { PreparedRangeFetch } from "./storage-reader";
import { encodeCanonicalRsidBlock, type CanonicalRsidPointer } from "./canonical-rsid-index";
import type { CanonicalRsidContainerDescriptor } from "./canonical-rsid-containers";
import type { PreparedStoredArtifact } from "./storage-writer";

async function setup(rows?: string[], build: "GRCh37" | "GRCh38" = "GRCh38") {
  const f = await publicationFixture(rows, build, 2);
  const fetchRange = vi.fn<PreparedRangeFetch>(async ({ objectKey, start, end }) => {
    const bytes = f.objects.get(objectKey); if (!bytes) return new Response(null, { status: 404 });
    return new Response(Buffer.from(bytes.subarray(start, end + 1)), { status: 206,
      headers: { "content-range": `bytes ${start}-${end}/${bytes.length}`, "content-length": String(end - start + 1) } });
  });
  const check = vi.fn<(selection: CanonicalRsidReadSelection, signal: AbortSignal) => Promise<void>>(async () => {});
  return { ...f, rsid: f.root, fetchRange, check };
}

// Rewrite the small synthetic index with fully matching metadata and hashes.
// These cases test pointer semantics, beyond corruption detected by transport.
async function rewritePointers(f: Awaited<ReturnType<typeof setup>>, mutate: (pointers: CanonicalRsidPointer[]) => void) {
  const ref = f.rsid.directories[0], page = JSON.parse(Buffer.from(f.objects.get(ref.artifact.receipt.objectKey)!).toString());
  const item = page.containers[0] as { artifact: PreparedStoredArtifact; descriptor: CanonicalRsidContainerDescriptor };
  expect(page.containers).toHaveLength(1); expect(item.descriptor.blocks).toHaveLength(1);
  const body = JSON.parse(gunzipSync(f.objects.get(item.artifact.receipt.objectKey)!).toString());
  mutate(body.pointers);
  const encoded = await encodeCanonicalRsidBlock({ binding: f.binding, sequence: 0, pointers: body.pointers });
  const write = (artifact: PreparedStoredArtifact, bytes: Uint8Array) => {
    f.objects.set(artifact.receipt.objectKey, bytes); artifact.receipt.byteCount = bytes.length;
    artifact.receipt.sha256 = createHash("sha256").update(bytes).digest("hex");
  };
  write(item.artifact, encoded.compressed);
  item.descriptor = { ...item.descriptor, byteCount: encoded.compressed.length, sha256: item.artifact.receipt.sha256,
    blocks: [{ offset: 0, length: encoded.compressed.length, descriptor: encoded.descriptor }] };
  write(ref.artifact, Buffer.from(JSON.stringify(page)));
  ref.first = encoded.descriptor.first; ref.last = encoded.descriptor.last;
  f.rsid.first = ref.first; f.rsid.last = ref.last; f.rsid.byteCount = encoded.compressed.length;
}

describe("bounded canonical rsID evidence (synthetic artifacts)", () => {
  it("retains all loci, duplicate evidence, and no-calls for the requested rsID", async () => {
    const f = await setup([row(1), row(1), row(8).replace("rs8", "rs1"), row(9, "./.").replace("rs9", "rs1"), row(10)]);
    const result = await readCanonicalRsids({ ...f, rsids: [1] }, f);
    expect(result.records).toEqual(f.records.filter(r => r.event.type !== "reference"
      && (r.event.type === "variant" ? r.event.record.rsid : r.event.call.rsid) === 1));
    expect(new Set(result.records.filter(r => r.normalization.status === "normalized").map(r =>
      r.normalization.status === "normalized" && r.normalization.record.pos))).toEqual(new Set([1, 8, 9]));
    expect(result.records.some(r => r.normalization.status === "duplicate")).toBe(true);
    expect(result.nextCursor).toBeNull();
    expect(f.check.mock.calls[0][0].artifact).toBeNull(); expect(f.check.mock.calls.at(-1)![0].artifact).toBeNull();
  });

  it("returns selected unmapped evidence rather than absent coverage", async () => {
    const f = await setup([row(1), row(30)], "GRCh37");
    const result = await readCanonicalRsids({ ...f, rsids: [30] }, f);
    expect(result.records).toHaveLength(2);
    expect(result.records.every(r => r.normalization.status === "unmapped")).toBe(true);
  });

  it("drains repeated rsIDs across a 1000-record cursor boundary without loss", async () => {
    const f = await setup(Array.from({ length: 1001 }, () => row(1)));
    const records = [], seen = new Set<string>(); let cursor = null;
    do {
      const page = await readCanonicalRsids({ ...f, rsids: [1], cursor }, f);
      expect(page.records.length).toBeLessThanOrEqual(1000);
      if (page.nextCursor) { const key = JSON.stringify(page.nextCursor); expect(seen.has(key)).toBe(false); seen.add(key); }
      records.push(...page.records); cursor = page.nextCursor;
    } while (cursor);
    expect(records).toEqual(f.records); expect(seen.size).toBe(2);
  });

  it.each([{ rsids: [] }, { rsids: [999] }])("checks initial and final authority for no matches $rsids", async ({ rsids }) => {
    const f = await setup();
    expect(await readCanonicalRsids({ ...f, rsids }, f)).toEqual({ records: [], nextCursor: null });
    expect(f.check).toHaveBeenCalledTimes(2); expect(f.fetchRange).not.toHaveBeenCalled();
  });

  it.each([[1, 1], [0], Array.from({ length: 51 }, (_, i) => i + 1)].map(rsids => ({ rsids })))("rejects invalid query before I/O", async ({ rsids }) => {
    const f = await setup();
    await expect(readCanonicalRsids({ ...f, rsids }, f)).rejects.toMatchObject({ code: "invalid_request" });
    expect(f.fetchRange).not.toHaveBeenCalled();
  });

  it("suppresses accumulated evidence after final authority refusal", async () => {
    const f = await setup(); let roots = 0;
    f.check.mockImplementation(async ({ artifact }) => { if (!artifact && ++roots === 2) throw new Error("synthetic revoked"); });
    await expect(readCanonicalRsids({ ...f, rsids: [1] }, f)).rejects.toMatchObject({ code: "unavailable" });
    expect(f.fetchRange).toHaveBeenCalled();
  });

  it("cancels a stalled final authority check without returning partial evidence", async () => {
    const f = await setup(), entered = Promise.withResolvers<void>(), controller = new AbortController(); let roots = 0;
    f.check.mockImplementation(async ({ artifact }) => {
      if (!artifact && ++roots === 2) { entered.resolve(); return new Promise(() => {}); }
    });
    const pending = readCanonicalRsids({ ...f, rsids: [1] }, { ...f, signal: controller.signal });
    await entered.promise; controller.abort(); await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });

  it.each(["wrong-rsid", "outside-records", "repeated-pointer"])("refuses %s despite matching rewritten index hashes", async mode => {
    const f = await setup([row(1), row(2)]);
    await rewritePointers(f, pointers => {
      if (mode === "wrong-rsid") pointers[1].recordOffset = 2; // A real record, but its original rsID is 2.
      if (mode === "outside-records") pointers.at(-1)!.recordOffset = 1999; // Within codec bounds, outside actual canonical block.
      if (mode === "repeated-pointer") pointers[1] = { ...pointers[0] };
    });
    await expect(readCanonicalRsids({ ...f, rsids: [1, 2] }, f)).rejects.toMatchObject({ code: "integrity_mismatch" });
  });

  it.each(["rsid-directory", "rsid-data", "canonical-directory", "canonical-data"])("refuses corrupt %s instead of returning absence", async kind => {
    const f = await setup(), isRsid = kind.startsWith("rsid"), ref = (isRsid ? f.rsid : f.canonical).directories[0];
    const directory = JSON.parse(Buffer.from(f.objects.get(ref.artifact.receipt.objectKey)!).toString());
    const key = kind.endsWith("directory") ? ref.artifact.receipt.objectKey : directory.containers[0].artifact.receipt.objectKey;
    f.objects.get(key)![0] ^= 1;
    await expect(readCanonicalRsids({ ...f, rsids: [1] }, f)).rejects.toBeInstanceOf(Error);
  });

  it.each(["canonical-root", "rsid-root", "query", "offset", "block"])("refuses a cursor with changed %s", async mode => {
    const f = await setup(Array.from({ length: 501 }, () => row(1)));
    const first = await readCanonicalRsids({ ...f, rsids: [1] }, f), cursor = { ...first.nextCursor! };
    if (mode === "canonical-root") cursor.canonicalSha256 = "f".repeat(64);
    if (mode === "rsid-root") cursor.rsidSha256 = "f".repeat(64);
    if (mode === "query") cursor.querySha256 = "f".repeat(64);
    if (mode === "offset") cursor.pointerOffset = 1999;
    if (mode === "block") cursor.indexBlockSequence = f.rsid.blockCount;
    await expect(readCanonicalRsids({ ...f, rsids: [1], cursor }, f)).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("limits serialized page bytes and retains continuation for large allele evidence", async () => {
    const f = await setup(Array.from({ length: 250 }, () => row(1, "0/1", "C".repeat(5000))));
    expect(Buffer.byteLength(JSON.stringify(f.records))).toBeGreaterThan(2_000_000);
    const first = await readCanonicalRsids({ ...f, rsids: [1] }, f);
    expect(Buffer.byteLength(JSON.stringify(first.records))).toBeLessThanOrEqual(2_000_000);
    expect(first.records.length).toBeLessThan(1000); expect(first.nextCursor).not.toBeNull();
    const second = await readCanonicalRsids({ ...f, rsids: [1], cursor: first.nextCursor }, f);
    expect([...first.records, ...second.records]).toEqual(f.records); expect(second.nextCursor).toBeNull();
  });

  it("owns root and artifact metadata across authority callback mutation", async () => {
    const f = await setup();
    f.check.mockImplementation(async selection => {
      selection.canonical.binding.source.sourceRevision++; selection.rsid.binding.source.sourceRevision++;
      if (selection.artifact) selection.artifact.receipt.objectKey = "prepared/55555555-5555-4555-8555-555555555555";
    });
    expect((await readCanonicalRsids({ ...f, rsids: [1] }, f)).records).toEqual(f.records.filter(r => r.event.type !== "reference"
      && (r.event.type === "variant" ? r.event.record.rsid : r.event.call.rsid) === 1));
    expect(f.binding.source.sourceRevision).toBe(1);
  });

  it("enforces its finite deadline on a stalled authority callback", async () => {
    const f = await setup(); vi.useFakeTimers();
    try {
      f.check.mockImplementation(() => new Promise(() => {}));
      const pending = readCanonicalRsids({ ...f, rsids: [1] }, f);
      const assertion = expect(pending).rejects.toMatchObject({ code: "aborted" });
      await vi.advanceTimersByTimeAsync(30_000); await assertion; expect(f.fetchRange).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
