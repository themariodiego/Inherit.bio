import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { encodeCanonicalBlock } from "./canonical-codec";
import type { CanonicalBinding, CanonicalRecord } from "./canonical-schema";
import { createCanonicalRsidRuns, mergeCanonicalRsidRuns, decodeCanonicalRsidBlock,
  type CanonicalRsidRunReceipt, type CanonicalRsidBlockDescriptor, type CanonicalRsidPointer, type CanonicalRsidMergeSummary } from "./canonical-rsid-index";
import { verifyCanonicalRsidContainerBytes } from "./canonical-rsid-containers";
import { syntheticSource } from "./fixtures";
import type { PreparedStoredArtifact } from "./storage-writer";
import { materializeCanonicalRsidMerge, type CanonicalRsidContainerDirectory } from "./materialize-canonical-rsid";

const binding: CanonicalBinding = { version: "prepared-canonical-v1", source: syntheticSource, targetBuild: "GRCh38", liftoverSha256: null };
const jobId = "33333333-3333-4333-8333-333333333333", attemptId = "44444444-4444-4444-8444-444444444444";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
async function* values<T>(list: T[]) { yield* list; }
async function* bytes(b: Uint8Array) { yield b; }
type Input = CanonicalRsidPointer | CanonicalRsidMergeSummary;
type WriteArtifact = Parameters<typeof materializeCanonicalRsidMerge>[1]["writeArtifact"];
async function fixture(count = 7, withIds = true) {
  const blocks = new Map<number, Uint8Array>(), runs: CanonicalRsidRunReceipt[] = [];
  async function* canonical() {
    for (let sequence = 0; sequence < Math.ceil(count / 2000); sequence++) {
      const records: CanonicalRecord[] = Array.from({ length: Math.min(2000, count - sequence * 2000) }, (_, i) => ({
        type: "canonical-record", version: "prepared-canonical-v1", event: { type: "variant", line: sequence * 2000 + i + 1,
          record: { rsid: withIds ? count - sequence * 2000 - i : null, chrom: 1, pos: i + 1, ref: "A", alt: "C", genotype: "A/C" } }, normalization: { status: "unmapped" },
      }));
      const encoded = await encodeCanonicalBlock({ binding, sequence, records }); yield { descriptor: encoded.descriptor, bytes: bytes(encoded.compressed) };
    }
  }
  const scan = await createCanonicalRsidRuns(canonical(), { binding, sink: {
    async writeBlock(b) { blocks.set(b.descriptor.sequence, Uint8Array.from(b.compressed)); return structuredClone(b.descriptor); },
    async writeRun(r) { runs.push(structuredClone(r)); return structuredClone(r); },
  } });
  const output: Input[] = withIds ? await Array.fromAsync(mergeCanonicalRsidRuns(runs, { binding,
    readBlock: (d: CanonicalRsidBlockDescriptor) => bytes(blocks.get(d.sequence)!) })) : [];
  return { scan, output };
}
function writer() {
  const stored: { artifact: PreparedStoredArtifact; bytes: Uint8Array }[] = [];
  const writeArtifact = vi.fn<WriteArtifact>(async input => {
    const artifact: PreparedStoredArtifact = { receipt: { version: "own-preparation-artifact-v1", artifactId: randomUUID(), jobId, attemptId,
      sequence: input.descriptor.sequence, bucket: "genomes", objectKey: `prepared/${randomUUID()}`, byteCount: input.bytes.length,
      sha256: sha(input.bytes), writeExpiresAt: "2030-01-01T00:00:00.000Z" }, storageObjectId: randomUUID() };
    stored.push({ artifact: structuredClone(artifact), bytes: Uint8Array.from(input.bytes) }); return artifact;
  });
  return { stored, writeArtifact };
}
const options = (scan: Awaited<ReturnType<typeof fixture>>["scan"], writeArtifact: WriteArtifact) => ({
  binding, expectedScan: scan, canonicalBlockCount: scan.canonicalBlockCount, canonicalRecordCount: scan.canonicalRecordCount,
  jobId, attemptId, firstArtifactSequence: 7, writeArtifact,
});

describe("final canonical rsID materialization", () => {
  it("materializes real scan/merge pointers and bounded directories, then roundtrips exact index ranges", async () => {
    const { scan, output } = await fixture(4001), w = writer();
    const root = await materializeCanonicalRsidMerge(values(output), options(scan, w.writeArtifact));
    expect(root).toMatchObject({ version: "canonical-rsid-materialization-v1", state: "provisional", pointerCount: 4001,
      canonicalBlockCount: 3, canonicalRecordCount: 4001, blockCount: 3, containerCount: 1, firstArtifactSequence: 7, nextArtifactSequence: 9, artifactCount: 2 });
    expect(root.scanSummary).toEqual(scan); expect(root.mergeSummary).toEqual(output.at(-1));
    const actual: CanonicalRsidPointer[] = [];
    for (const ref of root.directories) {
      const directory = w.stored.find(s => s.artifact.receipt.artifactId === ref.artifact.receipt.artifactId)!;
      expect(directory.bytes.length).toBeLessThanOrEqual(1_048_576);
      const page = JSON.parse(Buffer.from(directory.bytes).toString()) as CanonicalRsidContainerDirectory;
      expect(page).toMatchObject({ version: "canonical-rsid-container-directory-v1", state: "provisional", binding, sequence: ref.sequence });
      for (const entry of page.containers) {
        const container = w.stored.find(s => s.artifact.receipt.artifactId === entry.artifact.receipt.artifactId)!;
        verifyCanonicalRsidContainerBytes(container.bytes, entry.descriptor);
        for (const range of entry.descriptor.blocks) actual.push(...(await decodeCanonicalRsidBlock(bytes(container.bytes.subarray(range.offset, range.offset + range.length)), range.descriptor)).pointers);
      }
      expect(ref).toMatchObject({ firstBlockSequence: 0, lastBlockSequence: 2, pointerCount: 4001, blockCount: 3, first: actual[0], last: actual.at(-1) });
    }
    expect(actual).toEqual(output.slice(0, -1)); expect(root.first).toEqual(actual[0]); expect(root.last).toEqual(actual.at(-1));
    expect(w.stored.map(s => s.artifact.receipt.sequence)).toEqual([7, 8]); expect(Buffer.byteLength(JSON.stringify(root))).toBeLessThan(4_000_000);
  });
  it("accepts a truly empty zero-ID index with separate valid canonical scan counts and no writes", async () => {
    const { scan } = await fixture(1, false), w = writer();
    expect(await materializeCanonicalRsidMerge(values([]), options(scan, w.writeArtifact))).toMatchObject({ pointerCount: 0, blockCount: 0,
      containerCount: 0, directories: [], mergeSummary: null, first: null, last: null, artifactCount: 0, firstArtifactSequence: 7, nextArtifactSequence: 7 });
    expect(w.writeArtifact).not.toHaveBeenCalled();
  });
  it.each(["missing", "duplicate-terminal", "trailing-pointer", "count", "binding", "run-sequences", "late-EOF"])("refuses %s without a completed root", async mode => {
    const { scan, output } = await fixture(), w = writer(), changed = structuredClone(output);
    if (mode === "missing") changed.pop();
    if (mode === "duplicate-terminal") changed.push(changed.at(-1)!);
    if (mode === "trailing-pointer") changed.push(changed[0]);
    const terminal = changed.at(-1) as CanonicalRsidMergeSummary;
    if (mode === "count") terminal.pointerCount++;
    if (mode === "binding") terminal.binding.source.rawSha256 = "c".repeat(64);
    if (mode === "run-sequences") terminal.inputRunSequences = [0, 0];
    async function* input() { yield* changed; if (mode === "late-EOF") throw Error("synthetic late read failure"); }
    await expect(materializeCanonicalRsidMerge(input(), options(scan, w.writeArtifact))).rejects.toThrow();
  });
  it.each(["same-pointer", "descending", "outside-blocks", "offset", "open"])("refuses invalid %s pointer", async mode => {
    const { scan, output } = await fixture(), w = writer(), changed = structuredClone(output);
    if (mode === "same-pointer") changed[1] = changed[0];
    if (mode === "descending") [changed[0], changed[1]] = [changed[1], changed[0]];
    if (mode === "outside-blocks") (changed[0] as CanonicalRsidPointer).blockSequence = scan.canonicalBlockCount;
    if (mode === "offset") (changed[0] as CanonicalRsidPointer).recordOffset = 2000;
    if (mode === "open") Object.assign(changed[0], { extra: true });
    await expect(materializeCanonicalRsidMerge(values(changed), options(scan, w.writeArtifact))).rejects.toThrow();
  });
  it.each(["canonical-count", "scan-count", "scan-binding", "zero-run", "zero-data"])("refuses inconsistent %s provenance before writes", async mode => {
    const { scan, output } = await fixture(1, false), w = writer(), opts = options(structuredClone(scan), w.writeArtifact);
    if (mode === "canonical-count") opts.canonicalRecordCount++;
    if (mode === "scan-count") opts.expectedScan.pointerCount = 1;
    if (mode === "scan-binding") opts.expectedScan.binding.source.rawSha256 = "c".repeat(64);
    if (mode === "zero-run") opts.expectedScan.runCount = 1;
    if (mode === "zero-data") output.push({ rsid: 1, blockSequence: 0, recordOffset: 0 });
    await expect(materializeCanonicalRsidMerge(values(output), opts)).rejects.toThrow(); expect(w.writeArtifact).not.toHaveBeenCalled();
  });
  it.each(["job", "attempt", "sequence", "hash", "size", "bytes", "extra", "artifact", "object", "key"])("requires exact %s artifact ACK and identities across directory/data writes", async mode => {
    const { scan, output } = await fixture(), w = writer(); let previous: PreparedStoredArtifact | undefined;
    const writeArtifact = vi.fn<WriteArtifact>(async input => {
      const result = await w.writeArtifact(input);
      if (mode === "job") result.receipt.jobId = randomUUID();
      if (mode === "attempt") result.receipt.attemptId = randomUUID();
      if (mode === "sequence") result.receipt.sequence++;
      if (mode === "hash") result.receipt.sha256 = "0".repeat(64);
      if (mode === "size") result.receipt.byteCount++;
      if (mode === "bytes") input.bytes[0] ^= 1;
      if (mode === "extra") Object.assign(result, { extra: true });
      if (previous) {
        if (mode === "artifact") result.receipt.artifactId = previous.receipt.artifactId;
        if (mode === "object") result.storageObjectId = previous.storageObjectId;
        if (mode === "key") result.receipt.objectKey = previous.receipt.objectKey;
      }
      previous = structuredClone(result); return result;
    });
    await expect(materializeCanonicalRsidMerge(values(output), options(scan, writeArtifact))).rejects.toMatchObject({ code: "ack_mismatch" });
  });
  it("respects the shared artifact cap and never resets index sequences to the artifact offset", async () => {
    const { scan, output } = await fixture(), w = writer();
    await expect(materializeCanonicalRsidMerge(values(output), { ...options(scan, w.writeArtifact), firstArtifactSequence: 4095 })).rejects.toMatchObject({ code: "too_large" });
    expect(w.writeArtifact).toHaveBeenCalledTimes(1); expect(w.stored[0].artifact.receipt.sequence).toBe(4095);
  });
  it("settles synchronous-abort rejections without masking the primary abort with cleanup", async () => {
    const { scan, output } = await fixture(), w = writer(), controller = new AbortController();
    const writeArtifact = vi.fn<WriteArtifact>(() => { controller.abort(); return Promise.reject(Error("synthetic writer rejected")); });
    await expect(materializeCanonicalRsidMerge(values(output), { ...options(scan, writeArtifact), signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    const abort = new AbortController(); let returned = false;
    const input = { [Symbol.asyncIterator]() { return { next() { abort.abort(); return Promise.reject(Error("synthetic source failure")); },
      return() { returned = true; throw Error("synthetic cleanup failure"); } }; } };
    await expect(materializeCanonicalRsidMerge(input, { ...options(scan, w.writeArtifact), signal: abort.signal })).rejects.toMatchObject({ code: "aborted" });
    expect(returned).toBe(true); await new Promise(resolve => setTimeout(resolve, 0));
  });
});
