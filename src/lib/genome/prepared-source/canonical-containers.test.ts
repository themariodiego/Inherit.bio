import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createCanonicalContainerPacker, validateCanonicalContainerDescriptor, verifyCanonicalContainerBytes,
  CANONICAL_CONTAINER_MAX_BLOCKS, CANONICAL_CONTAINER_MAX_BYTES, CANONICAL_CONTAINER_TARGET_BYTES,
  type CanonicalContainerDescriptor, type CanonicalContainerSink } from "./canonical-containers";
import { encodeCanonicalBlock, decodeCanonicalBlock } from "./canonical-codec";
import { PREPARED_BLOCK_MAX_COMPRESSED_BYTES } from "./schema";
import type { CanonicalBinding, CanonicalRecord } from "./canonical-schema";
import { syntheticSource } from "./fixtures";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function* chunks(bytes: Uint8Array) { yield bytes; }
const binding: CanonicalBinding = { version: "prepared-canonical-v1", source: { ...syntheticSource, sourceBuild: "GRCh37" },
  targetBuild: "GRCh38", liftoverSha256: "f".repeat(64) };
function records(): CanonicalRecord[] {
  // Explicit source and normalized fields model a reverse mapping; containers
  // preserve them rather than rerunning or inventing an interpretation.
  const source = { rsid: 1, chrom: 1, pos: 1, ref: "A", alt: "C", genotype: "A/C" };
  return [
    { type: "canonical-record", version: "prepared-canonical-v1", event: { type: "observed", line: 4,
      call: { ...source, line: 4, sourceGt: "0/1", filter: "PASS", sampleFilter: null, genotypeQuality: 50,
        depth: 30, quality: "pass", usable: true } },
    normalization: { status: "normalized", record: { ...source, pos: 900, ref: "T", alt: "G", genotype: "G/T" } } },
    { type: "canonical-record", version: "prepared-canonical-v1", event: { type: "variant", line: 4, record: source },
      normalization: { status: "normalized", record: { ...source, pos: 900, ref: "T", alt: "G", genotype: "G/T" } } },
    { type: "canonical-record", version: "prepared-canonical-v1", event: { type: "variant", line: 5, record: source },
      normalization: { status: "duplicate", firstSourceLine: 4 } },
    { type: "canonical-record", version: "prepared-canonical-v1", event: { type: "reference", line: 6,
      call: { chrom: 1, pos: 2, ref: "A", genotype: "A/A" } }, normalization: { status: "source_reference" } },
  ];
}
async function block(sequence = 0) {
  const original = records();
  return { ...(await encodeCanonicalBlock({ binding, sequence, records: original })), records: original };
}
function capture() {
  const written: { descriptor: CanonicalContainerDescriptor; bytes: Uint8Array }[] = [];
  const sink = vi.fn<CanonicalContainerSink>(async container => {
    written.push({ descriptor: structuredClone(container.descriptor), bytes: Uint8Array.from(container.bytes) });
    return structuredClone(container.descriptor);
  });
  return { written, sink };
}
async function container() {
  const out = capture(), packer = createCanonicalContainerPacker({ binding, sink: out.sink });
  await packer.append(await block(0)); await packer.append(await block(1)); await packer.finish();
  return out.written[0];
}

// Tests byte-container boundaries independently of genotype decompression. These
// artificial bytes are not claimed to be valid codec data; range roundtrip tests
// below use actual canonical encode/decode and explicit provenance records.
async function opaqueBlock(sequence: number, size: number) {
  const valid = await block(sequence), compressed = Buffer.alloc(size, sequence % 251);
  return { compressed, descriptor: { ...valid.descriptor, compressedBytes: size, compressedSha256: sha(compressed) } };
}

describe("bounded immutable canonical containers", () => {
  it("packs small blocks into one unchanged-byte container and decodes each exact range", async () => {
    const out = capture(), packer = createCanonicalContainerPacker({ binding, sink: out.sink });
    const first = await block(0), second = await block(1);
    await packer.append(first); await packer.append(second);
    expect(out.written).toEqual([]); // Buffered acceptance is not durability.
    const aggregate = await packer.finish();
    expect(out.written).toHaveLength(1);
    const packed = out.written[0]; verifyCanonicalContainerBytes(packed.bytes, packed.descriptor);
    expect(Buffer.from(packed.bytes)).toEqual(Buffer.concat([first.compressed, second.compressed]));
    expect(packed.descriptor.blocks.map(b => [b.offset, b.length])).toEqual([[0, first.compressed.length], [first.compressed.length, second.compressed.length]]);
    for (const range of validateCanonicalContainerDescriptor(packed.descriptor, binding).blocks) {
      const decoded = await decodeCanonicalBlock(chunks(packed.bytes.subarray(range.offset, range.offset + range.length)), range.descriptor);
      expect(decoded.records).toEqual(first.records);
    }
    expect(aggregate).toEqual({ version: "prepared-canonical-containers-v1", state: "provisional", binding,
      containerCount: 1, blockCount: 2, byteCount: first.compressed.length + second.compressed.length });
    await expect(packer.append(await block(2))).rejects.toMatchObject({ code: "invalid_state" });
    await expect(packer.flush()).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("packs caller-split near-four-MB canonical blocks without recompression or repeated normalized alleles", async () => {
    const longBinding: CanonicalBinding = { ...binding, source: { ...binding.source, sourceBuild: "GRCh38" }, liftoverSha256: null };
    const original = [0, 1].map(i => {
      const call = { rsid: null, chrom: 1, pos: i + 1, ref: "A", alt: "C".repeat(1_999_930), genotype: `A/${"C".repeat(1_999_930)}` };
      return { type: "canonical-record" as const, version: "prepared-canonical-v1" as const,
        event: { type: "variant" as const, line: i + 4, record: call },
        normalization: { status: "normalized" as const, record: { ...call } } };
    });
    await expect(encodeCanonicalBlock({ binding: longBinding, sequence: 0, records: original })).rejects.toMatchObject({ code: "too_large" });
    const out = capture(), packer = createCanonicalContainerPacker({ binding: longBinding, sink: out.sink });
    const encoded = await Promise.all(original.map((record, sequence) => encodeCanonicalBlock({ binding: longBinding, sequence, records: [record] })));
    for (const block of encoded) await packer.append(block);
    expect(out.written).toEqual([]); const result = await packer.finish();
    expect(result).toMatchObject({ containerCount: 1, blockCount: 2 });
    const packed = out.written[0]; verifyCanonicalContainerBytes(packed.bytes, packed.descriptor);
    for (const [index, range] of packed.descriptor.blocks.entries()) {
      const bytes = packed.bytes.subarray(range.offset, range.offset + range.length);
      expect(Buffer.from(bytes)).toEqual(encoded[index].compressed);
      expect((await decodeCanonicalBlock(chunks(bytes), range.descriptor)).records).toEqual([original[index]]);
    }
  });

  it("flushes before exceeding the target, and permits one valid-sized larger block", async () => {
    const out = capture(), packer = createCanonicalContainerPacker({ binding, sink: out.sink });
    await packer.append(await opaqueBlock(0, 600_000));
    await packer.append(await opaqueBlock(1, 600_000));
    expect(out.written.map(c => c.bytes.length)).toEqual([600_000]);
    await packer.append(await opaqueBlock(2, PREPARED_BLOCK_MAX_COMPRESSED_BYTES));
    expect(out.written.map(c => c.bytes.length)).toEqual([600_000, 600_000, PREPARED_BLOCK_MAX_COMPRESSED_BYTES]);
    await packer.finish();
    expect(CANONICAL_CONTAINER_MAX_BYTES).toBeGreaterThan(PREPARED_BLOCK_MAX_COMPRESSED_BYTES);
    expect(out.written.every(c => c.bytes.length <= CANONICAL_CONTAINER_MAX_BYTES)).toBe(true);
  });

  it("caps small-block membership at 128 rather than accumulating an unbounded manifest", async () => {
    const out = capture(), packer = createCanonicalContainerPacker({ binding, sink: out.sink });
    for (let i = 0; i <= CANONICAL_CONTAINER_MAX_BLOCKS; i++) await packer.append(await block(i));
    expect(out.written).toHaveLength(1); expect(out.written[0].descriptor.blocks).toHaveLength(128);
    await packer.finish(); expect(out.written[1].descriptor.blocks).toHaveLength(1);
  });

  it("owns input bytes and descriptor fields before a caller reuses them", async () => {
    const out = capture(), packer = createCanonicalContainerPacker({ binding, sink: out.sink });
    const value = await block(), expected = Buffer.from(value.compressed);
    await packer.append(value); value.compressed.fill(0); value.descriptor.binding.source.sourceRevision = 2;
    await packer.finish(); expect(Buffer.from(out.written[0].bytes)).toEqual(expected);
    expect(out.written[0].descriptor.binding.source.sourceRevision).toBe(1);
  });

  it("copies the one pending block before awaiting an earlier container flush", async () => {
    const entered = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>(), out = capture();
    const packer = createCanonicalContainerPacker({ binding, sink: async value => {
      entered.resolve(); await gate.promise; return out.sink(value);
    } });
    await packer.append(await opaqueBlock(0, 600_000));
    const next = await opaqueBlock(1, 600_000), expected = Uint8Array.from(next.compressed);
    const pending = packer.append(next); await entered.promise;
    next.compressed.fill(0); next.descriptor.binding.source.sourceRevision++;
    gate.resolve(); await pending; await packer.finish();
    expect(out.written[1].bytes).toEqual(expected);
    expect(out.written[1].descriptor.binding.source.sourceRevision).toBe(1);
  });

  it("streams many small blocks with only bounded containers and aggregate counts returned", async () => {
    let writes = 0, verifiedBlocks = 0, nextSequence = 0;
    const packer = createCanonicalContainerPacker({ binding, sink: async value => {
      verifyCanonicalContainerBytes(value.bytes, value.descriptor);
      expect(value.descriptor.sequence).toBe(writes++);
      expect(value.descriptor.blocks.length).toBeLessThanOrEqual(128);
      for (const entry of value.descriptor.blocks) expect(entry.descriptor.sequence).toBe(nextSequence++);
      verifiedBlocks += value.descriptor.blocks.length;
      return value.descriptor; // Discard bytes and per-container metadata here.
    } });
    for (let sequence = 0; sequence < 400; sequence++) await packer.append(await block(sequence));
    expect(writes).toBe(3);
    expect(await packer.finish()).toEqual({ version: "prepared-canonical-containers-v1", state: "provisional", binding,
      containerCount: 4, blockCount: 400, byteCount: expect.any(Number) });
    expect(verifiedBlocks).toBe(400);
  });

  it("uses explicit flush as the run durability fence and has an honest empty finish", async () => {
    const out = capture(), packer = createCanonicalContainerPacker({ binding, sink: out.sink, firstBlockSequence: 8 });
    expect(await packer.flush()).toBeNull(); await packer.append(await block(8));
    const receipt = await packer.flush(); expect(receipt?.blocks[0].descriptor.sequence).toBe(8);
    expect(await packer.flush()).toBeNull(); await packer.finish(); expect(out.sink).toHaveBeenCalledOnce();
    expect(await createCanonicalContainerPacker({ binding, sink: out.sink }).finish())
      .toMatchObject({ containerCount: 0, blockCount: 0, byteCount: 0, state: "provisional" });
  });

  it.each(["duplicate", "gap", "backwards"])("refuses %s block sequence", async kind => {
    const out = capture(), packer = createCanonicalContainerPacker({ binding, sink: out.sink, firstBlockSequence: 2 });
    await packer.append(await block(2));
    await expect(packer.append(await block(kind === "duplicate" ? 2 : kind === "gap" ? 4 : 1))).rejects.toMatchObject({ code: "sequence_mismatch" });
    await expect(packer.finish()).rejects.toMatchObject({ code: "invalid_state" }); expect(out.written).toEqual([]);
  });

  it.each(["source", "hash", "length", "oversize", "version"])("refuses invalid block %s before packing", async kind => {
    const out = capture(), packer = createCanonicalContainerPacker({ binding, sink: out.sink });
    const value = await block();
    if (kind === "source") value.descriptor.binding.source.rawSha256 = "c".repeat(64);
    if (kind === "hash") value.compressed[15] ^= 255;
    if (kind === "length") value.descriptor.compressedBytes++;
    if (kind === "oversize") value.descriptor.compressedBytes = CANONICAL_CONTAINER_MAX_BYTES + 1;
    if (kind === "version") Reflect.set(value.descriptor, "version", "prepared-events-columnar-v1");
    await expect(packer.append(value)).rejects.toThrow(); expect(out.written).toEqual([]);
  });

  it.each(["overlap", "gap", "sum", "length", "source", "order", "version", "extra", "oversize"])
  ("rejects malicious container %s metadata", async kind => {
    const packed = await container(), d = structuredClone(packed.descriptor);
    if (kind === "overlap") d.blocks[1].offset--;
    if (kind === "gap") d.blocks[1].offset++;
    if (kind === "sum") d.byteCount++;
    if (kind === "length") d.blocks[0].length--;
    if (kind === "source") d.blocks[1].descriptor.binding.source.subjectId = syntheticSource.fileId;
    if (kind === "order") d.blocks[1].descriptor.sequence = 0;
    if (kind === "version") Reflect.set(d, "version", "unknown");
    if (kind === "extra") Reflect.set(d, "key", "caller-chosen-key");
    if (kind === "oversize") d.byteCount = CANONICAL_CONTAINER_MAX_BYTES + 1;
    expect(() => validateCanonicalContainerDescriptor(d)).toThrow();
  });

  it("rejects oversized membership before examining any supplied block", async () => {
    const packed = await container(); let examined = false;
    const blocks = Array(CANONICAL_CONTAINER_MAX_BLOCKS + 1);
    Object.defineProperty(blocks, 0, { get() { examined = true; throw Error("Must not inspect"); } });
    expect(() => validateCanonicalContainerDescriptor({ ...packed.descriptor, blocks }))
      .toThrow("invalid_container");
    expect(examined).toBe(false);
  });

  it("requires the expected source and validates whole-container and nested block hashes", async () => {
    const packed = await container();
    expect(() => validateCanonicalContainerDescriptor(packed.descriptor, { ...binding, source: { ...binding.source, sourceRevision: 2 } })).toThrow();
    const corrupt = Uint8Array.from(packed.bytes); corrupt[0] ^= 255;
    expect(() => verifyCanonicalContainerBytes(corrupt, packed.descriptor)).toThrow();
    const wrongBlock = structuredClone(packed.descriptor); wrongBlock.blocks[1].descriptor.compressedSha256 = "f".repeat(64);
    expect(() => verifyCanonicalContainerBytes(packed.bytes, wrongBlock)).toThrow();
    expect(() => validateCanonicalContainerDescriptor(packed.descriptor, { ...binding, liftoverSha256: "a".repeat(64) })).toThrow("integrity_mismatch");
    const wrongMapping = structuredClone(packed.descriptor);
    wrongMapping.blocks[0].descriptor.binding.liftoverSha256 = "a".repeat(64);
    expect(() => validateCanonicalContainerDescriptor(wrongMapping)).toThrow("invalid_container");
  });

  it.each(["hash", "ranges", "source", "extra", "bytes"])("requires an exact immutable sink acknowledgement: %s", async kind => {
    const packer = createCanonicalContainerPacker({ binding, sink: async c => {
      if (kind === "hash") c.descriptor.sha256 = "f".repeat(64);
      if (kind === "ranges") c.descriptor.blocks[0].offset++;
      if (kind === "source") c.descriptor.binding.source.sourceRevision++;
      if (kind === "extra") Reflect.set(c.descriptor, "url", "https://example.invalid");
      if (kind === "bytes") c.bytes[0] ^= 255;
      return c.descriptor;
    } });
    await packer.append(await block());
    await expect(packer.flush()).rejects.toMatchObject({ code: "ack_mismatch" });
    await expect(packer.finish()).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("awaits sink backpressure, refuses concurrent calls, then resumes in sequence", async () => {
    let release!: () => void, entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const out = capture(), packer = createCanonicalContainerPacker({ binding, sink: async c => {
      entered(); await blocked; return out.sink(c);
    } });
    await packer.append(await block(0)); const flush = packer.flush(); await started;
    await expect(packer.append(await block(1))).rejects.toMatchObject({ code: "invalid_state" });
    expect(out.written).toHaveLength(0); release(); await flush;
    await packer.append(await block(1)); await packer.finish(); expect(out.written).toHaveLength(2);
  });

  it("aborts buffered acceptance without starting a sink write", async () => {
    const controller = new AbortController(), out = capture();
    const packer = createCanonicalContainerPacker({ binding, signal: controller.signal, sink: out.sink });
    await packer.append(await block()); controller.abort();
    await expect(packer.finish()).rejects.toMatchObject({ code: "aborted" }); expect(out.sink).not.toHaveBeenCalled();
    expect(() => createCanonicalContainerPacker({ binding, signal: controller.signal, sink: out.sink })).toThrow();
  });

  it("cancels pending sink I/O without hanging, while leaving uncertain writes caller-owned", async () => {
    const controller = new AbortController(); let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const packer = createCanonicalContainerPacker({ binding, signal: controller.signal,
      sink: async (_c, signal) => { expect(signal).toBe(controller.signal); entered(); return new Promise(() => {}); } });
    await packer.append(await block()); const work = packer.flush(); await started; controller.abort();
    await expect(work).rejects.toMatchObject({ code: "aborted" });
  });

  it("observes synchronous-abort rejection and never starts another write", async () => {
    const controller = new AbortController(), sink = vi.fn<CanonicalContainerSink>(() => {
      controller.abort(); return Promise.reject(new Error("synthetic sink rejection"));
    });
    const packer = createCanonicalContainerPacker({ binding, sink, signal: controller.signal });
    await packer.append(await block()); await expect(packer.finish()).rejects.toMatchObject({ code: "aborted" });
    await new Promise(resolve => setImmediate(resolve)); expect(sink).toHaveBeenCalledOnce();
  });

  it("preserves a sink failure and closes rather than claiming buffered data durable", async () => {
    const failure = Error("synthetic sink failure");
    const packer = createCanonicalContainerPacker({ binding, sink: async () => { throw failure; } });
    await packer.append(await block()); await expect(packer.flush()).rejects.toBe(failure);
    await expect(packer.finish()).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("allows selected range integrity without downloading other blocks", async () => {
    const packed = await container(), valid = validateCanonicalContainerDescriptor(packed.descriptor, binding);
    const selected = valid.blocks[1], bytes = packed.bytes.subarray(selected.offset, selected.offset + selected.length);
    const decoded = await decodeCanonicalBlock(chunks(bytes), selected.descriptor);
    expect(decoded.sequence).toBe(1);
    expect(bytes.length).toBeLessThan(CANONICAL_CONTAINER_TARGET_BYTES);
  });
});
