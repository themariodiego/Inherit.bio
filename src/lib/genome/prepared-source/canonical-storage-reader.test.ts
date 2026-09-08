import { describe, expect, it, vi } from "vitest";
import { encodeCanonicalBlock } from "./canonical-codec";
import { createCanonicalContainerPacker, type CanonicalContainerDescriptor } from "./canonical-containers";
import { type CanonicalBinding, type CanonicalRecord } from "./canonical-schema";
import { readCanonicalStorageBlock } from "./canonical-storage-reader";
import { syntheticSource } from "./fixtures";
import { readPreparedStorageRange } from "./storage-reader";

async function fixture() {
  const binding: CanonicalBinding = { version: "prepared-canonical-v1", source: { ...syntheticSource, sourceBuild: "GRCh37" },
    targetBuild: "GRCh38", liftoverSha256: "a".repeat(64) };
  // Synthetic codec input, not a claim of a biologically verified mapping.
  const records: CanonicalRecord[] = [10, 20].map(pos => ({ type: "canonical-record", version: "prepared-canonical-v1",
    event: { type: "variant", line: pos, record: { chrom: 1, pos, rsid: pos, ref: "A", alt: "C", genotype: "A/C" } },
    normalization: { status: "normalized", record: { chrom: 2, pos: pos + 100, rsid: pos, ref: "T", alt: "G", genotype: "G/T" } } }));
  let container!: CanonicalContainerDescriptor, bytes!: Uint8Array;
  const packer = createCanonicalContainerPacker({ binding, sink: async value => {
    container = value.descriptor; bytes = Uint8Array.from(value.bytes); return value.descriptor;
  } });
  for (let sequence = 0; sequence < records.length; sequence++)
    await packer.append(await encodeCanonicalBlock({ binding, sequence, records: [records[sequence]] }));
  await packer.finish();
  const block = container.blocks[1];
  const selectedBytes = Uint8Array.from(bytes.subarray(block.offset, block.offset + block.length));
  const response = () => new Response(selectedBytes as BodyInit, { status: 206,
    headers: { "content-range": `bytes ${block.offset}-${block.offset + block.length - 1}/${container.byteCount}` } });
  const selection = { objectKey: "prepared/33333333-3333-4333-8333-333333333333", container, blockSequence: 1 };
  return { binding, records, block, response, selection, selectedBytes };
}

describe("canonical private Storage block reads", () => {
  it("reads only the selected canonical range and preserves both original and normalized records", async () => {
    const f = await fixture(), order: string[] = [];
    const result = await readCanonicalStorageBlock(f.selection, {
      check: async () => { order.push("authority"); }, fetchRange: async request => {
        order.push("range"); expect(request).toMatchObject({ objectKey: f.selection.objectKey,
          start: f.block.offset, end: f.block.offset + f.block.length - 1 }); return f.response();
      },
    });
    expect(result).toEqual({ state: "provisional", binding: f.binding, sequence: 1, records: [f.records[1]] });
    expect(order).toEqual(["authority", "range", "authority"]);
  });
  it.each(["binding", "offset", "missing block", "parser version", "original key"])("refuses %s before I/O", async fault => {
    const f = await fixture();
    if (fault === "binding") f.selection.container.binding.source.sourceRevision++;
    if (fault === "offset") f.selection.container.blocks[1].offset++;
    if (fault === "missing block") f.selection.blockSequence = 9;
    if (fault === "parser version") Object.assign(f.selection.container, { version: "prepared-container-v1" });
    if (fault === "original key") f.selection.objectKey = f.selection.objectKey.slice(9);
    const check = vi.fn(async () => {}), fetchRange = vi.fn(async () => f.response());
    await expect(readCanonicalStorageBlock(f.selection, { check, fetchRange })).rejects.toMatchObject({ code: "invalid_selection" });
    expect(check).not.toHaveBeenCalled(); expect(fetchRange).not.toHaveBeenCalled();
  });
  it("does not release a corrupt canonical block or run the final authority check", async () => {
    const f = await fixture(); f.selectedBytes[12] ^= 1;
    const check = vi.fn(async () => {});
    await expect(readCanonicalStorageBlock(f.selection, { check, fetchRange: async () => f.response() })).rejects.toBeDefined();
    expect(check).toHaveBeenCalledTimes(1);
  });
  it("refuses all decoded calls if authority is withdrawn during I/O", async () => {
    const f = await fixture(); let checks = 0;
    await expect(readCanonicalStorageBlock(f.selection, { check: async () => {
      if (++checks === 2) throw new Error("private claim refused");
    }, fetchRange: async () => f.response() })).rejects.toMatchObject({ code: "unavailable" });
    expect(checks).toBe(2);
  });
  it.each([{ offset: -1 }, { offset: Number.MAX_SAFE_INTEGER }, { length: 4_081_921 }, { total: 8_388_609 }, { offset: 2, length: 2 }])(
    "shared transport refuses invalid bounded range %j before I/O", async patch => {
      const check = vi.fn(async () => {}), fetchRange = vi.fn(async () => new Response()), decode = vi.fn(async () => []);
      await expect(readPreparedStorageRange({ objectKey: "prepared/33333333-3333-4333-8333-333333333333",
        offset: 0, length: 2, total: 3, ...patch }, { check, fetchRange, decode })).rejects.toMatchObject({ code: "invalid_selection" });
      expect(check).not.toHaveBeenCalled(); expect(fetchRange).not.toHaveBeenCalled(); expect(decode).not.toHaveBeenCalled();
    });
});
