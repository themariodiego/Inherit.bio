import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseVcf, streamVcf, type VcfParseEvent } from "../parsers/vcf";
import { decodePreparedBlock, encodePreparedBlock } from "./codec";
import { PREPARED_BLOCK_MAX_COMPRESSED_BYTES, PREPARED_BLOCK_MAX_DECODED_BYTES,
  PREPARED_BLOCK_MAX_EVENTS, preparedParserSummarySchema, type PreparedBlockDescriptor, type PreparedEvent } from "./schema";
import { syntheticHeader, syntheticLines, syntheticRows, syntheticSource } from "./fixtures";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function* chunks(bytes: Uint8Array, size = 37) {
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}
async function events(rows?: string[]) {
  const all: VcfParseEvent[] = [];
  for await (const event of streamVcf(syntheticLines(rows))) all.push(event);
  return all;
}
const data = (all: VcfParseEvent[]) => all.filter((event): event is PreparedEvent => event.type !== "summary");
async function encoded() { return encodePreparedBlock({ source: syntheticSource, sequence: 7, events: data(await events()) }); }
function repack(bytes: Buffer, descriptor: PreparedBlockDescriptor) {
  const compressed = gzipSync(bytes);
  return { compressed, descriptor: { ...descriptor, compressedBytes: compressed.length,
    decodedBytes: bytes.length, compressedSha256: sha(compressed), decodedSha256: sha(bytes) } };
}
type WireBlock = { columns: Record<string, unknown[]>; [key: string]: unknown };
async function mutated(mutate: (body: WireBlock) => void) { // Test-only malformed wire mutation.
  const initial = await encoded(), body = JSON.parse(gunzipSync(initial.compressed).toString());
  mutate(body); return repack(Buffer.from(JSON.stringify(body)), initial.descriptor);
}

describe("provisional prepared block codec", () => {
  it("round-trips actual parser events and collector semantics without sorting or losing duplicates", async () => {
    const original = await events(), block = await encoded();
    const restored = await decodePreparedBlock(chunks(block.compressed, 1), block.descriptor);
    expect(restored).toEqual({ source: syntheticSource, sequence: 7, state: "provisional", events: data(original) });
    const collector = await parseVcf(syntheticLines());
    expect(restored.events.filter(e => e.type === "variant").map(e => e.record)).toEqual(collector.records);
    expect(restored.events.filter(e => e.type === "reference").map(e => e.call)).toEqual(collector.referenceCalls);
    expect(restored.events.filter(e => e.type === "observed").map(e => e.call)).toEqual(collector.observedCalls);
    expect(restored.events.filter(e => e.type === "variant" && e.record.pos === 12)).toHaveLength(3);
    expect(restored.events.some(e => e.type === "observed" && e.call.genotype === "--")).toBe(true);
    expect(restored.events.some(e => e.type === "observed" && e.call.filter === "q10;é" && !e.call.usable)).toBe(true);
    expect(restored.events.some(e => e.type !== "variant" && e.call.pos === 16)).toBe(false);
    expect(preparedParserSummarySchema.parse(original.at(-1))).toMatchObject({ observedCallsValid: true });
  });

  it("keeps late-header-invalidated observations provisional, never claiming source publication", async () => {
    const all = await events([...syntheticRows, syntheticHeader[2]]);
    const summary = preparedParserSummarySchema.parse(all.at(-1));
    expect(summary.observedCallsValid).toBe(false);
    const block = await encodePreparedBlock({ source: syntheticSource, sequence: 0, events: data(all) });
    const restored = await decodePreparedBlock(chunks(block.compressed), block.descriptor);
    expect(restored.state).toBe("provisional");
    expect(restored.events).toEqual(data(all));
    expect((await parseVcf(syntheticLines([...syntheticRows, syntheticHeader[2]]))).observedCalls).toEqual([]);
  });

  it("preserves the already supported near-four-MB long-allele singleton", async () => {
    const alt = "C".repeat(1_999_930);
    const all = data(await events([`1\t100000\t.\tA\t${alt}\t.\tPASS\t.\tGT\t0/1`]));
    const block = await encodePreparedBlock({ source: syntheticSource, sequence: 0, events: all });
    expect(block.descriptor.decodedBytes).toBeLessThanOrEqual(PREPARED_BLOCK_MAX_DECODED_BYTES);
    expect((await decodePreparedBlock(chunks(block.compressed), block.descriptor)).events).toEqual(all);
  });

  it("preserves nullable array-style variant fields without manufacturing reference metadata", async () => {
    const event: PreparedEvent = { type: "variant", line: 1,
      record: { rsid: null, chrom: 25, pos: 12, ref: null, alt: null, genotype: "--" } };
    const block = await encodePreparedBlock({ source: syntheticSource, sequence: 0, events: [event] });
    expect((await decodePreparedBlock(chunks(block.compressed), block.descriptor)).events).toEqual([event]);
  });

  it.each(["fileId", "subjectId", "sourceRevision", "rawSha256", "decodedSha256", "sourceBuild", "parserRevision"] as const)
  ("refuses changed expected source binding %s", async key => {
    const block = await encoded();
    const values = { fileId: syntheticSource.subjectId, subjectId: syntheticSource.fileId, sourceRevision: 2,
      rawSha256: "c".repeat(64), decodedSha256: "d".repeat(64), sourceBuild: "GRCh37", parserRevision: "changed" };
    const expected = { ...block.descriptor, source: { ...syntheticSource, [key]: values[key] } };
    await expect(decodePreparedBlock(chunks(block.compressed), expected as PreparedBlockDescriptor)).rejects.toMatchObject({ code: "integrity_mismatch" });
  });

  it.each(["compressedSha256", "decodedSha256", "sequence", "eventCount"] as const)
  ("refuses changed manifest %s", async key => {
    const block = await encoded();
    const expected = { ...block.descriptor, [key]: key.endsWith("Sha256") ? "f".repeat(64) : Number(block.descriptor[key]) + 1 };
    await expect(decodePreparedBlock(chunks(block.compressed), expected)).rejects.toMatchObject({ code: "integrity_mismatch" });
  });

  it.each([
    ["version", (b: WireBlock) => { b.version = "future-version"; }],
    ["publication", (b: WireBlock) => { b.state = "complete"; }],
    ["extra field", (b: WireBlock) => { b.secret = "not-a-block-field"; }],
    ["missing column entry", (b: WireBlock) => { b.columns.line.pop(); }],
    ["extra column", (b: WireBlock) => { b.columns.interpretation = ["invented"]; }],
    ["unknown kind", (b: WireBlock) => { b.columns.kind[0] = "summary"; }],
    ["missing observed quality", (b: WireBlock) => { b.columns.quality[0] = null; }],
    ["hidden variant metadata", (b: WireBlock) => { const i = b.columns.kind.indexOf("variant"); b.columns.usable[i] = true; }],
    ["hidden reference rsID", (b: WireBlock) => { const i = b.columns.kind.indexOf("reference"); b.columns.rsid[i] = 1; }],
  ])("refuses %s even with recomputed byte hashes", async (_label, mutate) => {
    const block = await mutated(mutate as (body: WireBlock) => void);
    await expect(decodePreparedBlock(chunks(block.compressed), block.descriptor)).rejects.toMatchObject({ code: "invalid_block" });
  });

  it.each(["truncated", "corrupted"])("refuses %s gzip without releasing a partial result", async kind => {
    const block = await encoded();
    const bytes = Buffer.from(block.compressed.subarray(0, kind === "truncated" ? -4 : undefined));
    if (kind === "corrupted") bytes[Math.floor(bytes.length / 2)] ^= 255;
    await expect(decodePreparedBlock(chunks(bytes), block.descriptor)).rejects.toMatchObject({ code: "invalid_block" });
  });

  it("refuses invalid UTF-8 rather than silently replacing bytes", async () => {
    const block = await encoded();
    const packed = repack(Buffer.from([0xc3, 0x28]), block.descriptor);
    await expect(decodePreparedBlock(chunks(packed.compressed), packed.descriptor)).rejects.toMatchObject({ code: "invalid_block" });
  });

  it("refuses mismatched compressed and decoded lengths", async () => {
    const block = await encoded();
    for (const key of ["compressedBytes", "decodedBytes"] as const) {
      await expect(decodePreparedBlock(chunks(block.compressed), { ...block.descriptor, [key]: block.descriptor[key] + 1 }))
        .rejects.toMatchObject({ code: "integrity_mismatch" });
      await expect(decodePreparedBlock(chunks(block.compressed), { ...block.descriptor, [key]: block.descriptor[key] - 1 }))
        .rejects.toMatchObject({ code: "too_large" });
    }
  });

  it("treats separately compressed blocks as independent identities", async () => {
    const all = data(await events());
    const first = await encodePreparedBlock({ source: syntheticSource, sequence: 0, events: all.slice(0, 3) });
    const second = await encodePreparedBlock({ source: syntheticSource, sequence: 1, events: all.slice(3) });
    const a = await decodePreparedBlock(chunks(first.compressed), first.descriptor);
    const b = await decodePreparedBlock(chunks(second.compressed), second.descriptor);
    expect([...a.events, ...b.events]).toEqual(all);
    await expect(decodePreparedBlock(chunks(second.compressed), first.descriptor)).rejects.toBeInstanceOf(Error);
  });

  it("rejects an over-limit descriptor before pulling input", async () => {
    const block = await encoded(); let pulled = false;
    async function* source() { pulled = true; yield block.compressed; }
    await expect(decodePreparedBlock(source(), { ...block.descriptor, decodedBytes: PREPARED_BLOCK_MAX_DECODED_BYTES + 1 })).rejects.toMatchObject({ code: "invalid_block" });
    expect(pulled).toBe(false);
  });

  it("bounds decoded gzip expansion before JSON parse", async () => {
    const initial = await encoded();
    const packed = repack(Buffer.alloc(PREPARED_BLOCK_MAX_DECODED_BYTES + 1, 32), initial.descriptor);
    packed.descriptor.decodedBytes = PREPARED_BLOCK_MAX_DECODED_BYTES;
    await expect(decodePreparedBlock(chunks(packed.compressed), packed.descriptor)).rejects.toMatchObject({ code: "too_large" });
  });

  it("closes the input iterator and stops pulls at the compressed bound", async () => {
    const initial = await encoded(); let pulled = 0, closed = false;
    async function* source() { try { while (true) { pulled++; yield Buffer.alloc(4096); } } finally { closed = true; } }
    await expect(decodePreparedBlock(source(), initial.descriptor)).rejects.toMatchObject({ code: "too_large" });
    await new Promise(resolve => setImmediate(resolve));
    expect(closed).toBe(true); expect(pulled).toBeLessThan(10);
  });

  it("refuses input failure and hides upstream diagnostic payloads", async () => {
    const block = await encoded(); let closed = false;
    async function* source() { try { yield block.compressed.subarray(0, 8); throw Error("private source information"); } finally { closed = true; } }
    await expect(decodePreparedBlock(source(), block.descriptor)).rejects.toMatchObject({ code: "invalid_block", message: "invalid_block" });
    expect(closed).toBe(true);
  });

  it("cancels a decode and closes its producer without exposing events", async () => {
    const block = await encoded(), controller = new AbortController(); let closed = false, pulls = 0;
    async function* source() { try {
      for (const byte of block.compressed) { pulls++; if (pulls === 5) controller.abort(); yield Uint8Array.of(byte); }
    } finally { closed = true; } }
    await expect(decodePreparedBlock(source(), block.descriptor, { signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    await new Promise(resolve => setImmediate(resolve));
    expect(closed).toBe(true); expect(pulls).toBeLessThan(block.compressed.length);
  });

  it("does not pull an already cancelled source", async () => {
    const block = await encoded(), controller = new AbortController(); controller.abort(); let pulled = false;
    async function* source() { pulled = true; yield block.compressed; }
    await expect(decodePreparedBlock(source(), block.descriptor, { signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    expect(pulled).toBe(false);
  });

  it("refuses unknown descriptor version and compression", async () => {
    const block = await encoded();
    for (const change of [{ version: "v2" }, { compression: "none" }, { compressedBytes: PREPARED_BLOCK_MAX_COMPRESSED_BYTES + 1 }]) {
      await expect(decodePreparedBlock(chunks(block.compressed), { ...block.descriptor, ...change } as PreparedBlockDescriptor)).rejects.toMatchObject({ code: "invalid_block" });
    }
  });

  it("refuses invalid, extra-field, mismatched-line, empty and oversized input blocks", async () => {
    const all = data(await events());
    const first = all[0]; expect(first.type).toBe("observed");
    const cases = [[], Array(PREPARED_BLOCK_MAX_EVENTS + 1).fill(first), [{ ...first, ignored: true }],
      [{ ...first, line: 999 }], [{ type: "variant", line: 1, record: { rsid: null, chrom: 1, pos: 2,
        ref: "A", alt: "C".repeat(PREPARED_BLOCK_MAX_DECODED_BYTES), genotype: "A/C" } }]];
    for (const input of cases) await expect(encodePreparedBlock({ source: syntheticSource, sequence: 0, events: input as PreparedEvent[] })).rejects.toBeInstanceOf(Error);
  });
});
