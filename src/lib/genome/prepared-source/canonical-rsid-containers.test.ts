import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { encodeCanonicalRsidBlock, decodeCanonicalRsidBlock } from "./canonical-rsid-index";
import type { CanonicalBinding } from "./canonical-schema";
import { syntheticSource } from "./fixtures";
import { createCanonicalRsidContainerPacker, validateCanonicalRsidContainerDescriptor, verifyCanonicalRsidContainerBytes,
  CANONICAL_RSID_CONTAINER_MAX_BYTES, CANONICAL_RSID_CONTAINER_TARGET_BYTES,
  type CanonicalRsidContainerDescriptor, type CanonicalRsidContainerSink } from "./canonical-rsid-containers";

const binding: CanonicalBinding = { version: "prepared-canonical-v1", source: syntheticSource, targetBuild: "GRCh38", liftoverSha256: null };
const pointers = [{ rsid: 1, blockSequence: 2, recordOffset: 0 }, { rsid: 1, blockSequence: 2, recordOffset: 1 }, { rsid: 9, blockSequence: 7, recordOffset: 1999 }];
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function block(sequence = 0) { return encodeCanonicalRsidBlock({ binding, sequence, pointers }); }
async function* chunks(bytes: Uint8Array) { yield bytes; }
function capture() {
  const written: { descriptor: CanonicalRsidContainerDescriptor; bytes: Uint8Array }[] = [];
  const sink = vi.fn<CanonicalRsidContainerSink>(async item => { written.push(structuredClone(item)); return structuredClone(item.descriptor); });
  return { written, sink };
}
async function packed() {
  const out = capture(), packer = createCanonicalRsidContainerPacker({ binding, sink: out.sink });
  await packer.append(await block(0)); await packer.append(await block(1)); await packer.finish(); return out.written[0];
}
// Byte-boundary tests use deliberately opaque bytes. Only the separate real
// codec range tests establish valid gzip/pointers; no artificial byte fixture
// is represented as a complete index or publication proof.
async function opaque(sequence: number, length: number) {
  const b = await block(sequence), compressed = Buffer.alloc(length, sequence % 251);
  return { descriptor: { ...b.descriptor, compressedBytes: length, compressedSha256: sha(compressed) }, compressed };
}

describe("immutable rsID block containers", () => {
  it("packs exact encoded blocks and decodes every bounded range with its binding and repeated pointers intact", async () => {
    const out = capture(), packer = createCanonicalRsidContainerPacker({ binding, sink: out.sink });
    const a = await block(0), b = await block(1); await packer.append(a); await packer.append(b);
    expect(out.written).toHaveLength(0); const summary = await packer.finish();
    expect(out.written).toHaveLength(1); const item = out.written[0];
    expect(Buffer.from(item.bytes)).toEqual(Buffer.concat([a.compressed, b.compressed]));
    verifyCanonicalRsidContainerBytes(item.bytes, item.descriptor);
    for (const entry of validateCanonicalRsidContainerDescriptor(item.descriptor, binding).blocks) {
      expect((await decodeCanonicalRsidBlock(chunks(item.bytes.subarray(entry.offset, entry.offset + entry.length)), entry.descriptor)).pointers).toEqual(pointers);
    }
    expect(summary).toEqual({ version: "canonical-rsid-containers-v1", state: "provisional", binding,
      containerCount: 1, blockCount: 2, byteCount: item.bytes.length });
    await expect(packer.append(await block(2))).rejects.toMatchObject({ code: "invalid_state" });
  });
  it("supports empty completion without inventing an index container", async () => {
    const out = capture(), packer = createCanonicalRsidContainerPacker({ binding, sink: out.sink });
    expect(await packer.flush()).toBeNull(); expect(await packer.finish()).toMatchObject({ containerCount: 0, blockCount: 0, byteCount: 0 });
    expect(out.sink).not.toHaveBeenCalled();
  });
  it("flushes at 128 blocks and continues exact block sequences", async () => {
    const out = capture(), packer = createCanonicalRsidContainerPacker({ binding, sink: out.sink, firstBlockSequence: 11 });
    for (let i = 11; i < 140; i++) await packer.append(await block(i));
    expect(out.written).toHaveLength(1); expect(out.written[0].descriptor.blocks).toHaveLength(128);
    expect(await packer.finish()).toMatchObject({ containerCount: 2, blockCount: 129 });
    expect(out.written[1].descriptor.blocks[0].descriptor.sequence).toBe(139);
  });
  it("flushes before target overflow and stores a larger singleton without recompression", async () => {
    const out = capture(), packer = createCanonicalRsidContainerPacker({ binding, sink: out.sink });
    const a = await opaque(0, CANONICAL_RSID_CONTAINER_TARGET_BYTES - 1), b = await opaque(1, 2), c = await opaque(2, CANONICAL_RSID_CONTAINER_TARGET_BYTES + 1);
    await packer.append(a); await packer.append(b); expect(out.written).toHaveLength(1);
    await packer.append(c); await packer.finish(); expect(out.written.map(x => x.bytes.length)).toEqual([a.compressed.length, b.compressed.length, c.compressed.length]);
    for (const item of out.written) verifyCanonicalRsidContainerBytes(item.bytes, item.descriptor);
    expect(out.written.every(x => x.bytes.length <= CANONICAL_RSID_CONTAINER_MAX_BYTES)).toBe(true);
  });
  it.each(["binding", "sequence", "hash", "length", "version"])("refuses wrong %s before a sink write and closes the packer", async mode => {
    const out = capture(), packer = createCanonicalRsidContainerPacker({ binding, sink: out.sink }), b = await block();
    if (mode === "binding") b.descriptor.binding.source.rawSha256 = "c".repeat(64);
    if (mode === "sequence") b.descriptor.sequence++;
    if (mode === "hash") b.compressed[0] ^= 1;
    if (mode === "length") b.descriptor.compressedBytes++;
    if (mode === "version") Object.assign(b.descriptor, { version: "prepared-canonical-block-v1" });
    await expect(packer.append(b)).rejects.toThrow(); expect(out.sink).not.toHaveBeenCalled();
    await expect(packer.flush()).rejects.toMatchObject({ code: "invalid_state" });
  });
  it.each(["overlap", "gap", "size", "sequence", "binding", "version", "open", "cardinality"])("refuses malformed %s metadata", async mode => {
    const item = await packed(), d = structuredClone(item.descriptor);
    if (mode === "overlap") d.blocks[1].offset--;
    if (mode === "gap") d.blocks[1].offset++;
    if (mode === "size") d.byteCount++;
    if (mode === "sequence") d.blocks[1].descriptor.sequence++;
    if (mode === "binding") d.blocks[1].descriptor.binding.source.rawSha256 = "c".repeat(64);
    if (mode === "version") Object.assign(d, { version: "prepared-canonical-container-v1" });
    if (mode === "open") Object.assign(d, { extra: true });
    if (mode === "cardinality") d.blocks = Array.from({ length: 129 }, () => d.blocks[0]);
    expect(() => validateCanonicalRsidContainerDescriptor(d)).toThrow();
  });
  it("checks whole-object AND per-block SHA, rejecting altered/missing/extra bytes", async () => {
    const item = await packed(), changed = Uint8Array.from(item.bytes); changed[0] ^= 1;
    for (const bytes of [changed, item.bytes.subarray(1), Buffer.concat([item.bytes, Buffer.from([1])])]) {
      expect(() => verifyCanonicalRsidContainerBytes(bytes, item.descriptor)).toThrow();
    }
    const rewrittenWhole = { ...item.descriptor, sha256: sha(changed) };
    expect(() => verifyCanonicalRsidContainerBytes(changed, rewrittenWhole)).toThrow();
  });
  it.each(["changed", "open", "bytes", "reject"])("requires exact immutable sink acknowledgment: %s", async mode => {
    const sink: CanonicalRsidContainerSink = async item => {
      if (mode === "reject") throw Error("synthetic sink failed");
      if (mode === "bytes") item.bytes[0] ^= 1;
      return mode === "changed" ? { ...item.descriptor, sequence: 1 } : mode === "open" ? { ...item.descriptor, extra: true } : item.descriptor;
    };
    const packer = createCanonicalRsidContainerPacker({ binding, sink }); await packer.append(await block());
    await expect(packer.flush()).rejects.toThrow(); await expect(packer.finish()).rejects.toMatchObject({ code: "invalid_state" });
  });
  it("owns input bytes and metadata before a flushing await; concurrent calls refuse without cancelling active work", async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const out = capture(), a = await block(0), b = await block(1);
    const packer = createCanonicalRsidContainerPacker({ binding, sink: async item => { await gate; return out.sink(item); } });
    await packer.append(a); const expected = Uint8Array.from(a.compressed); a.compressed.fill(0); a.descriptor.binding.source.rawSha256 = "c".repeat(64);
    const flushing = packer.flush(); await expect(packer.append(b)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(packer.finish()).rejects.toMatchObject({ code: "invalid_state" }); release(); await flushing;
    expect(out.written[0].bytes).toEqual(expected); await packer.append(b); await packer.finish(); expect(out.written).toHaveLength(2);
  });
  it("handles abort before use and synchronous rejecting sink without unobserved rejection", async () => {
    const already = AbortSignal.abort(); expect(() => createCanonicalRsidContainerPacker({ binding, sink: capture().sink, signal: already })).toThrow();
    const controller = new AbortController(), packer = createCanonicalRsidContainerPacker({ binding, signal: controller.signal,
      sink() { controller.abort(); return Promise.reject(Error("synthetic rejection")); } });
    await packer.append(await block()); await expect(packer.flush()).rejects.toMatchObject({ code: "aborted" });
    await expect(packer.finish()).rejects.toMatchObject({ code: "aborted" }); await new Promise(resolve => setTimeout(resolve, 0));
  });
});
