import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createPreparedContainerPacker, validatePreparedContainerDescriptor, verifyPreparedContainerBytes,
  PREPARED_CONTAINER_MAX_BLOCKS, PREPARED_CONTAINER_MAX_BYTES, PREPARED_CONTAINER_TARGET_BYTES,
  type PreparedContainerDescriptor, type PreparedContainerSink } from "./containers";
import { encodePreparedBlock, decodePreparedBlock } from "./codec";
import { PREPARED_BLOCK_MAX_COMPRESSED_BYTES, type PreparedEvent } from "./schema";
import { syntheticSource } from "./fixtures";
import { streamVcf } from "../parsers/vcf";
import { syntheticLines } from "./fixtures";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function* chunks(bytes: Uint8Array) { yield bytes; }
async function block(sequence = 0) {
  const events: PreparedEvent[] = [];
  for await (const event of streamVcf(syntheticLines())) if (event.type !== "summary") events.push(event);
  return { ...(await encodePreparedBlock({ source: syntheticSource, sequence, events })), events };
}
function capture() {
  const written: { descriptor: PreparedContainerDescriptor; bytes: Uint8Array }[] = [];
  const sink = vi.fn<PreparedContainerSink>(async container => {
    written.push({ descriptor: structuredClone(container.descriptor), bytes: Uint8Array.from(container.bytes) });
    return structuredClone(container.descriptor);
  });
  return { written, sink };
}
async function container() {
  const out = capture(), packer = createPreparedContainerPacker({ source: syntheticSource, sink: out.sink });
  await packer.append(await block(0)); await packer.append(await block(1)); await packer.finish();
  return out.written[0];
}

// Tests byte-container boundaries independently of genotype decompression. These
// artificial bytes are not claimed to be valid codec data; range roundtrip tests
// below use actual encode/decode and parser events.
async function opaqueBlock(sequence: number, size: number) {
  const valid = await block(sequence), compressed = Buffer.alloc(size, sequence % 251);
  return { compressed, descriptor: { ...valid.descriptor, compressedBytes: size, compressedSha256: sha(compressed) } };
}

describe("bounded immutable prepared containers", () => {
  it("packs small blocks into one unchanged-byte container and decodes each exact range", async () => {
    const out = capture(), packer = createPreparedContainerPacker({ source: syntheticSource, sink: out.sink });
    const first = await block(0), second = await block(1);
    await packer.append(first); await packer.append(second);
    expect(out.written).toEqual([]); // Buffered acceptance is not durability.
    const aggregate = await packer.finish();
    expect(out.written).toHaveLength(1);
    const packed = out.written[0]; verifyPreparedContainerBytes(packed.bytes, packed.descriptor);
    expect(Buffer.from(packed.bytes)).toEqual(Buffer.concat([first.compressed, second.compressed]));
    expect(packed.descriptor.blocks.map(b => [b.offset, b.length])).toEqual([[0, first.compressed.length], [first.compressed.length, second.compressed.length]]);
    for (const range of validatePreparedContainerDescriptor(packed.descriptor, syntheticSource).blocks) {
      const decoded = await decodePreparedBlock(chunks(packed.bytes.subarray(range.offset, range.offset + range.length)), range.descriptor);
      expect(decoded.events).toEqual(first.events);
    }
    expect(aggregate).toEqual({ version: "prepared-containers-v1", state: "provisional", source: syntheticSource,
      containerCount: 1, blockCount: 2, byteCount: first.compressed.length + second.compressed.length });
    await expect(packer.append(await block(2))).rejects.toMatchObject({ code: "invalid_state" });
    await expect(packer.flush()).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("flushes before exceeding the target, and permits one valid-sized larger block", async () => {
    const out = capture(), packer = createPreparedContainerPacker({ source: syntheticSource, sink: out.sink });
    await packer.append(await opaqueBlock(0, 600_000));
    await packer.append(await opaqueBlock(1, 600_000));
    expect(out.written.map(c => c.bytes.length)).toEqual([600_000]);
    await packer.append(await opaqueBlock(2, PREPARED_BLOCK_MAX_COMPRESSED_BYTES));
    expect(out.written.map(c => c.bytes.length)).toEqual([600_000, 600_000, PREPARED_BLOCK_MAX_COMPRESSED_BYTES]);
    await packer.finish();
    expect(PREPARED_CONTAINER_MAX_BYTES).toBeGreaterThan(PREPARED_BLOCK_MAX_COMPRESSED_BYTES);
    expect(out.written.every(c => c.bytes.length <= PREPARED_CONTAINER_MAX_BYTES)).toBe(true);
  });

  it("caps small-block membership at 128 rather than accumulating an unbounded manifest", async () => {
    const out = capture(), packer = createPreparedContainerPacker({ source: syntheticSource, sink: out.sink });
    for (let i = 0; i <= PREPARED_CONTAINER_MAX_BLOCKS; i++) await packer.append(await block(i));
    expect(out.written).toHaveLength(1); expect(out.written[0].descriptor.blocks).toHaveLength(128);
    await packer.finish(); expect(out.written[1].descriptor.blocks).toHaveLength(1);
  });

  it("owns input bytes and descriptor fields before a caller reuses them", async () => {
    const out = capture(), packer = createPreparedContainerPacker({ source: syntheticSource, sink: out.sink });
    const value = await block(), expected = Buffer.from(value.compressed);
    await packer.append(value); value.compressed.fill(0); value.descriptor.source.sourceRevision = 2;
    await packer.finish(); expect(Buffer.from(out.written[0].bytes)).toEqual(expected);
    expect(out.written[0].descriptor.source.sourceRevision).toBe(1);
  });

  it("uses explicit flush as the run durability fence and has an honest empty finish", async () => {
    const out = capture(), packer = createPreparedContainerPacker({ source: syntheticSource, sink: out.sink, firstBlockSequence: 8 });
    expect(await packer.flush()).toBeNull(); await packer.append(await block(8));
    const receipt = await packer.flush(); expect(receipt?.blocks[0].descriptor.sequence).toBe(8);
    expect(await packer.flush()).toBeNull(); await packer.finish(); expect(out.sink).toHaveBeenCalledOnce();
    expect(await createPreparedContainerPacker({ source: syntheticSource, sink: out.sink }).finish())
      .toMatchObject({ containerCount: 0, blockCount: 0, byteCount: 0, state: "provisional" });
  });

  it.each(["duplicate", "gap", "backwards"])("refuses %s block sequence", async kind => {
    const out = capture(), packer = createPreparedContainerPacker({ source: syntheticSource, sink: out.sink, firstBlockSequence: 2 });
    await packer.append(await block(2));
    await expect(packer.append(await block(kind === "duplicate" ? 2 : kind === "gap" ? 4 : 1))).rejects.toMatchObject({ code: "sequence_mismatch" });
    await expect(packer.finish()).rejects.toMatchObject({ code: "invalid_state" }); expect(out.written).toEqual([]);
  });

  it.each(["source", "hash", "length", "oversize", "version"])("refuses invalid block %s before packing", async kind => {
    const out = capture(), packer = createPreparedContainerPacker({ source: syntheticSource, sink: out.sink });
    const value = await block();
    if (kind === "source") value.descriptor.source.rawSha256 = "c".repeat(64);
    if (kind === "hash") value.compressed[15] ^= 255;
    if (kind === "length") value.descriptor.compressedBytes++;
    if (kind === "oversize") value.descriptor.compressedBytes = PREPARED_CONTAINER_MAX_BYTES + 1;
    if (kind === "version") Reflect.set(value.descriptor, "version", "unknown");
    await expect(packer.append(value)).rejects.toThrow(); expect(out.written).toEqual([]);
  });

  it.each(["overlap", "gap", "sum", "length", "source", "order", "version", "extra", "oversize"])
  ("rejects malicious container %s metadata", async kind => {
    const packed = await container(), d = structuredClone(packed.descriptor);
    if (kind === "overlap") d.blocks[1].offset--;
    if (kind === "gap") d.blocks[1].offset++;
    if (kind === "sum") d.byteCount++;
    if (kind === "length") d.blocks[0].length--;
    if (kind === "source") d.blocks[1].descriptor.source.subjectId = syntheticSource.fileId;
    if (kind === "order") d.blocks[1].descriptor.sequence = 0;
    if (kind === "version") Reflect.set(d, "version", "unknown");
    if (kind === "extra") Reflect.set(d, "key", "caller-chosen-key");
    if (kind === "oversize") d.byteCount = PREPARED_CONTAINER_MAX_BYTES + 1;
    expect(() => validatePreparedContainerDescriptor(d)).toThrow();
  });

  it("rejects oversized membership before examining any supplied block", async () => {
    const packed = await container(); let examined = false;
    const blocks = Array(PREPARED_CONTAINER_MAX_BLOCKS + 1);
    Object.defineProperty(blocks, 0, { get() { examined = true; throw Error("Must not inspect"); } });
    expect(() => validatePreparedContainerDescriptor({ ...packed.descriptor, blocks }))
      .toThrow("invalid_container");
    expect(examined).toBe(false);
  });

  it("requires the expected source and validates whole-container and nested block hashes", async () => {
    const packed = await container();
    expect(() => validatePreparedContainerDescriptor(packed.descriptor, { ...syntheticSource, sourceRevision: 2 })).toThrow();
    const corrupt = Uint8Array.from(packed.bytes); corrupt[0] ^= 255;
    expect(() => verifyPreparedContainerBytes(corrupt, packed.descriptor)).toThrow();
    const wrongBlock = structuredClone(packed.descriptor); wrongBlock.blocks[1].descriptor.compressedSha256 = "f".repeat(64);
    expect(() => verifyPreparedContainerBytes(packed.bytes, wrongBlock)).toThrow();
  });

  it.each(["hash", "ranges", "source", "extra", "bytes"])("requires an exact immutable sink acknowledgement: %s", async kind => {
    const packer = createPreparedContainerPacker({ source: syntheticSource, sink: async c => {
      if (kind === "hash") c.descriptor.sha256 = "f".repeat(64);
      if (kind === "ranges") c.descriptor.blocks[0].offset++;
      if (kind === "source") c.descriptor.source.sourceRevision++;
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
    const out = capture(), packer = createPreparedContainerPacker({ source: syntheticSource, sink: async c => {
      entered(); await blocked; return out.sink(c);
    } });
    await packer.append(await block(0)); const flush = packer.flush(); await started;
    await expect(packer.append(await block(1))).rejects.toMatchObject({ code: "invalid_state" });
    expect(out.written).toHaveLength(0); release(); await flush;
    await packer.append(await block(1)); await packer.finish(); expect(out.written).toHaveLength(2);
  });

  it("aborts buffered acceptance without starting a sink write", async () => {
    const controller = new AbortController(), out = capture();
    const packer = createPreparedContainerPacker({ source: syntheticSource, signal: controller.signal, sink: out.sink });
    await packer.append(await block()); controller.abort();
    await expect(packer.finish()).rejects.toMatchObject({ code: "aborted" }); expect(out.sink).not.toHaveBeenCalled();
    expect(() => createPreparedContainerPacker({ source: syntheticSource, signal: controller.signal, sink: out.sink })).toThrow();
  });

  it("cancels pending sink I/O without hanging, while leaving uncertain writes caller-owned", async () => {
    const controller = new AbortController(); let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const packer = createPreparedContainerPacker({ source: syntheticSource, signal: controller.signal,
      sink: async (_c, signal) => { expect(signal).toBe(controller.signal); entered(); return new Promise(() => {}); } });
    await packer.append(await block()); const work = packer.flush(); await started; controller.abort();
    await expect(work).rejects.toMatchObject({ code: "aborted" });
  });

  it("observes synchronous-abort rejection and never starts another write", async () => {
    const controller = new AbortController(), sink = vi.fn<PreparedContainerSink>(() => {
      controller.abort(); return Promise.reject(new Error("synthetic sink rejection"));
    });
    const packer = createPreparedContainerPacker({ source: syntheticSource, sink, signal: controller.signal });
    await packer.append(await block()); await expect(packer.finish()).rejects.toMatchObject({ code: "aborted" });
    await new Promise(resolve => setImmediate(resolve)); expect(sink).toHaveBeenCalledOnce();
  });

  it("preserves a sink failure and closes rather than claiming buffered data durable", async () => {
    const failure = Error("synthetic sink failure");
    const packer = createPreparedContainerPacker({ source: syntheticSource, sink: async () => { throw failure; } });
    await packer.append(await block()); await expect(packer.flush()).rejects.toBe(failure);
    await expect(packer.finish()).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("allows selected range integrity without downloading other blocks", async () => {
    const packed = await container(), valid = validatePreparedContainerDescriptor(packed.descriptor, syntheticSource);
    const selected = valid.blocks[1], bytes = packed.bytes.subarray(selected.offset, selected.offset + selected.length);
    const decoded = await decodePreparedBlock(chunks(bytes), selected.descriptor);
    expect(decoded.sequence).toBe(1);
    expect(bytes.length).toBeLessThan(PREPARED_CONTAINER_TARGET_BYTES);
  });
});
