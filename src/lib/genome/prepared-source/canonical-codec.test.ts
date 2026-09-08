import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { streamVcf, type VcfParseEvent } from "../parsers/vcf";
import { canonicalizePreparedEvents } from "./canonical";
import { canonicalRecordSchema, type CanonicalBinding, type CanonicalRecord, type CanonicalSummary } from "./canonical-schema";
import { canonicalBlockDescriptorSchema, decodeCanonicalBlock, encodeCanonicalBlock, type CanonicalBlockDescriptor } from "./canonical-codec";
import { syntheticSource } from "./fixtures";
import type { PreparedMergeSummary } from "./merge";
import { PREPARED_BLOCK_MAX_COMPRESSED_BYTES, PREPARED_BLOCK_MAX_DECODED_BYTES, PREPARED_BLOCK_MAX_EVENTS,
  type PreparedEvent } from "./schema";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function* values<T>(items: T[]) { yield* items; }
async function* chunks(bytes: Uint8Array, size = 37) {
  for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size);
}
const row = (pos: number, gt = "0/1", alt = "C", id = `rs${pos}`) =>
  `1\t${pos}\t${id}\tA\t${alt}\t50\tPASS\t.\tGT:GQ:DP\t${gt}:50:30`;
async function corpus(build: "GRCh37" | "GRCh38" = "GRCh38", rows = [row(1), row(1), row(2, "0/0"), row(3, "./."),
  row(4).replace("PASS", "q10;é"), row(5, "0/1", "AC"), row(80)]) {
  const source = { ...syntheticSource, sourceBuild: build };
  const parserEvents = await Array.fromAsync(streamVcf(values(["##fileformat=VCFv4.2", `##reference=${build}`,
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC", ...rows])));
  const summary = parserEvents.at(-1) as Extract<VcfParseEvent, { type: "summary" }>;
  const rank = { observed: 0, reference: 1, variant: 2 };
  const events = parserEvents.filter((event): event is PreparedEvent => event.type !== "summary").sort((a, b) => {
    const x = a.type === "variant" ? a.record : a.call, y = b.type === "variant" ? b.record : b.call;
    return x.chrom - y.chrom || x.pos - y.pos || a.line - b.line || rank[a.type] - rank[b.type];
  });
  const merge: PreparedMergeSummary = { type: "merge-summary", version: "prepared-merge-v1", state: "provisional", source,
    inputRunSequences: [0], inputBlockCount: 1, eventCount: events.length, variantCount: summary.variantCount,
    observedCallCount: summary.observedCallCount, referenceCallCount: summary.referenceCallCount };
  const chainBytes = Buffer.from("chain 1 1 1000 + 0 10 1 1000 - 100 110 1\n10\n");
  const output = await Array.fromAsync(canonicalizePreparedEvents(values<PreparedEvent | PreparedMergeSummary>([...events, merge]), {
    source, expectedParserRevision: source.parserRevision, maximumUnmappedFraction: 0.9, expectedMergeSummary: merge,
    parserReceipt: { version: "prepared-runs-v1", state: "provisional", source, summary, runCount: 1, eventCount: events.length, blockCount: 1 },
    ...(build === "GRCh37" ? { liftover: { chainBytes, sha256: sha(chainBytes) } } : {}),
  }));
  return { binding: (output.at(-1) as CanonicalSummary).binding, sequence: 7,
    records: output.filter((value): value is CanonicalRecord => value.type === "canonical-record") };
}
type MutableWire = { version: string; state: string; binding: CanonicalBinding; sequence: number;
  records: { event: CanonicalRecord["event"]; normalization: { kind: string; changes?: Record<string, unknown>;
    firstSourceLine?: number; [key: string]: unknown } }[]; [key: string]: unknown };
function repack(decoded: Uint8Array, expected: CanonicalBlockDescriptor) {
  const compressed = gzipSync(decoded, { level: 6 });
  return { compressed, descriptor: { ...expected, decodedBytes: decoded.length, compressedBytes: compressed.length,
    compressedSha256: sha(compressed), decodedSha256: sha(decoded) } };
}
async function mutated(mutate: (wire: MutableWire) => void) {
  const encoded = await encodeCanonicalBlock(await corpus("GRCh37"));
  const body = JSON.parse(gunzipSync(encoded.compressed).toString()) as MutableWire;
  mutate(body); return repack(Buffer.from(JSON.stringify(body)), encoded.descriptor);
}

describe("canonical prepared block codec", () => {
  it.each(["GRCh38", "GRCh37"] as const)("round-trips actual %s canonical events, every disposition, quality and source provenance", async build => {
    const input = await corpus(build), encoded = await encodeCanonicalBlock(input);
    const decoded = await decodeCanonicalBlock(chunks(encoded.compressed, 1), encoded.descriptor);
    expect(decoded).toEqual({ ...input, state: "provisional" });
    expect(decoded.records.every(r => canonicalRecordSchema.safeParse(r).success)).toBe(true);
    const kinds = new Set(decoded.records.map(r => r.normalization.status));
    expect(kinds.has("duplicate")).toBe(true); expect(kinds.has("source_reference")).toBe(true);
    if (build === "GRCh37") {
      expect(kinds).toEqual(new Set(["normalized", "duplicate", "source_reference", "unsupported_alleles", "unmapped"]));
      expect(decoded.records[0]).toMatchObject({ event: { call: { pos: 1, genotype: "A/C", sourceGt: "0/1" } },
        normalization: { record: { pos: 900, ref: "T", alt: "G", genotype: "G/T" } } });
    }
    expect(decoded.records.some(r => r.event.type === "observed" && r.event.call.filter === "q10;é" && !r.event.call.usable)).toBe(true);
    expect(decoded.records.some(r => r.event.type === "observed" && r.event.call.genotype === "--")).toBe(true);
    expect(encoded.descriptor.version).toBe("prepared-canonical-block-v1");
    expect(canonicalBlockDescriptorSchema.safeParse(encoded.descriptor).success).toBe(true);
  });
  it("stores binding once and only changed normalized fields on wire", async () => {
    const input = await corpus("GRCh37"), encoded = await encodeCanonicalBlock(input);
    const wire = JSON.parse(gunzipSync(encoded.compressed).toString()) as MutableWire;
    expect(wire.records[0].normalization).toEqual({ kind: "delta", changes: { pos: 900, ref: "T", alt: "G", genotype: "G/T" } });
    expect(wire.records.every(r => !("binding" in r) && !("version" in r))).toBe(true);
    expect(wire.records.filter(r => r.event.type === "observed" && r.event.call.genotype === "--")[0].normalization.changes)
      .not.toHaveProperty("genotype");
    const same = await encodeCanonicalBlock(await corpus());
    const sameWire = JSON.parse(gunzipSync(same.compressed).toString()) as MutableWire;
    expect(sameWire.records[0].normalization).toEqual({ kind: "same-source" });
  });
  it("preserves the old-valid near-four-MB GRCh38 singleton without repeating normalized allele strings", async () => {
    const input = await corpus("GRCh38", [row(1, "0/1", "C".repeat(1_999_930), ".")]);
    expect(Buffer.byteLength(JSON.stringify(input.records))).toBeGreaterThan(PREPARED_BLOCK_MAX_DECODED_BYTES);
    const encoded = await encodeCanonicalBlock(input);
    expect(encoded.descriptor.decodedBytes).toBeLessThanOrEqual(PREPARED_BLOCK_MAX_DECODED_BYTES);
    expect(encoded.descriptor.decodedBytes).toBeGreaterThan(3_999_000);
    expect((await decodeCanonicalBlock(chunks(encoded.compressed), encoded.descriptor)).records).toEqual(input.records);
    const wire = JSON.parse(gunzipSync(encoded.compressed).toString()) as MutableWire;
    expect(wire.records[0].normalization).toEqual({ kind: "same-source" });
  });
  it("has no sorting or indexing side effects", async () => {
    const input = await corpus("GRCh37"); input.records.reverse();
    const encoded = await encodeCanonicalBlock(input);
    expect((await decodeCanonicalBlock(chunks(encoded.compressed), encoded.descriptor)).records).toEqual(input.records);
  });
  it("accepts exactly 2000 records and rejects empty or excess blocks before serialization", async () => {
    const input = await corpus();
    input.records = Array.from({ length: PREPARED_BLOCK_MAX_EVENTS }, () => input.records[0]);
    const encoded = await encodeCanonicalBlock(input);
    expect(encoded.descriptor.recordCount).toBe(2000);
    for (const records of [[], [...input.records, input.records[0]]]) {
      await expect(encodeCanonicalBlock({ ...input, records })).rejects.toMatchObject({ code: "invalid_block" });
    }
  });
  it("bounds source strings before serializing many large records, including UTF-8 byte size", async () => {
    const input = await corpus();
    const record = structuredClone(input.records[0]);
    if (record.event.type === "observed") record.event.call.filter = "é".repeat(1_100_000);
    input.records = [record, record];
    await expect(encodeCanonicalBlock(input)).rejects.toMatchObject({ code: "too_large" });
  });
  it("also bounds changed-field strings and escaped JSON envelope size", async () => {
    const input = await corpus("GRCh37");
    const record = structuredClone(input.records[0]);
    if (record.normalization.status === "normalized") record.normalization.record.alt = "C".repeat(3_000_000);
    input.records = [record, record];
    await expect(encodeCanonicalBlock(input)).rejects.toMatchObject({ code: "too_large" });
    if (record.event.type === "observed") record.event.call.filter = "\n".repeat(2_100_000);
    if (record.normalization.status === "normalized") record.normalization.record.alt = "G";
    input.records = [record];
    await expect(encodeCanonicalBlock(input)).rejects.toMatchObject({ code: "too_large" });
  });
  it.each(["unknown-version", "extra-top", "extra-row", "extra-disposition", "empty-delta", "extra-delta", "redundant-delta", "null-position",
    "reference-normalized", "duplicate-observed", "invent-no-call", "too-many"])("rejects malformed wire %s even with recomputed hashes", async mode => {
    const encoded = await mutated(wire => {
      switch (mode) {
        case "unknown-version": wire.version = "prepared-events-columnar-v1"; break;
        case "extra-top": wire.url = "https://untrusted.invalid"; break;
        case "extra-row": Object.assign(wire.records[0], { extra: true }); break;
        case "extra-disposition": wire.records[0].normalization.extra = true; break;
        case "empty-delta": wire.records[0].normalization = { kind: "delta", changes: {} }; break;
        case "extra-delta": wire.records[0].normalization.changes!.rsid = 99; break;
        case "redundant-delta": wire.records[0].normalization.changes!.chrom = 1; break;
        case "null-position": wire.records[0].normalization.changes!.pos = null; break;
        case "reference-normalized": wire.records.find(r => r.event.type === "reference")!.normalization = { kind: "same-source" }; break;
        case "duplicate-observed": wire.records[0].normalization = { kind: "duplicate", firstSourceLine: 1 }; break;
        case "invent-no-call": wire.records[0].normalization.changes!.genotype = "--"; break;
        case "too-many": wire.records = Array.from({ length: 2001 }, () => wire.records[0]); break;
      }
    });
    await expect(decodeCanonicalBlock(chunks(encoded.compressed), encoded.descriptor)).rejects.toMatchObject({ code: "invalid_block" });
  });
  it.each(["fileId", "subjectId", "sourceRevision", "rawSha256", "decodedSha256", "sourceBuild", "parserRevision", "liftoverSha256", "sequence", "count"])(
    "rejects expected %s misbinding", async field => {
      const encoded = await encodeCanonicalBlock(await corpus("GRCh37")), expected = structuredClone(encoded.descriptor);
      const changed = { fileId: "33333333-3333-4333-8333-333333333333", subjectId: "44444444-4444-4444-8444-444444444444",
        sourceRevision: 2, rawSha256: "c".repeat(64), decodedSha256: "d".repeat(64), sourceBuild: "GRCh38", parserRevision: "other" };
      if (field === "liftoverSha256") expected.binding.liftoverSha256 = "e".repeat(64);
      else if (field === "sequence") expected.sequence++;
      else if (field === "count") expected.recordCount++;
      else {
        Object.assign(expected.binding.source, { [field]: changed[field as keyof typeof changed] });
        if (field === "sourceBuild") expected.binding.liftoverSha256 = null;
      }
      await expect(decodeCanonicalBlock(chunks(encoded.compressed), expected)).rejects.toMatchObject({ code: "integrity_mismatch" });
    });
  it.each(["compressedSha256", "decodedSha256", "compressedBytes", "decodedBytes"] as const)("rejects wrong %s", async field => {
    const encoded = await encodeCanonicalBlock(await corpus()), expected = { ...encoded.descriptor };
    if (field.endsWith("Sha256")) Object.assign(expected, { [field]: "0".repeat(64) });
    else Object.assign(expected, { [field]: encoded.descriptor[field] as number + 1 });
    await expect(decodeCanonicalBlock(chunks(encoded.compressed), expected)).rejects.toMatchObject({ code: "integrity_mismatch" });
  });
  it("rejects invalid expected descriptors without pulling input", async () => {
    const encoded = await encodeCanonicalBlock(await corpus()); let reads = 0;
    async function* input() { reads++; yield encoded.compressed; }
    for (const expected of [{ ...encoded.descriptor, version: "prepared-events-columnar-v1" },
      { ...encoded.descriptor, compressedBytes: PREPARED_BLOCK_MAX_COMPRESSED_BYTES + 1 },
      { ...encoded.descriptor, target: "untrusted" }]) {
      await expect(decodeCanonicalBlock(input(), expected as CanonicalBlockDescriptor)).rejects.toMatchObject({ code: "invalid_block" });
    }
    expect(reads).toBe(0);
  });
  it("rejects invalid UTF-8, truncated gzip and corrupted bytes", async () => {
    const encoded = await encodeCanonicalBlock(await corpus());
    const invalid = repack(Buffer.from([0xff]), encoded.descriptor);
    await expect(decodeCanonicalBlock(chunks(invalid.compressed), invalid.descriptor)).rejects.toMatchObject({ code: "invalid_block" });
    await expect(decodeCanonicalBlock(chunks(encoded.compressed.subarray(0, -1)), encoded.descriptor)).rejects.toMatchObject({ code: "invalid_block" });
    const corrupted = Buffer.from(encoded.compressed); corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
    await expect(decodeCanonicalBlock(chunks(corrupted), encoded.descriptor)).rejects.toBeDefined();
  });
  it("refuses gzip expansion past the descriptor cap and closes the byte producer", async () => {
    const encoded = await encodeCanonicalBlock(await corpus()), bytes = Buffer.alloc(PREPARED_BLOCK_MAX_DECODED_BYTES + 1, 65);
    const compressed = gzipSync(bytes); let closed = false;
    async function* input() { try { yield compressed; } finally { closed = true; } }
    await expect(decodeCanonicalBlock(input(), { ...encoded.descriptor, compressedBytes: compressed.length,
      compressedSha256: sha(compressed), decodedBytes: PREPARED_BLOCK_MAX_DECODED_BYTES, decodedSha256: sha(bytes) }))
      .rejects.toMatchObject({ code: "too_large" });
    expect(closed).toBe(true);
  });
  it("refuses compressed excess before decompression", async () => {
    const encoded = await encodeCanonicalBlock(await corpus());
    await expect(decodeCanonicalBlock(chunks(Buffer.alloc(PREPARED_BLOCK_MAX_COMPRESSED_BYTES + 1), PREPARED_BLOCK_MAX_COMPRESSED_BYTES + 1), encoded.descriptor))
      .rejects.toMatchObject({ code: "too_large" });
  });
  it("returns nothing until actual EOF and refuses a late producer error", async () => {
    const encoded = await encodeCanonicalBlock(await corpus()), gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
    let settled = false;
    async function* input() { yield encoded.compressed; entered.resolve(); await gate.promise; }
    const result = decodeCanonicalBlock(input(), encoded.descriptor).finally(() => { settled = true; });
    await entered.promise; await new Promise(resolve => setTimeout(resolve, 0)); expect(settled).toBe(false);
    gate.resolve(); expect((await result).records).toHaveLength(encoded.descriptor.recordCount);
    async function* lateFailure() { yield encoded.compressed; throw new Error("upstream EOF integrity failure"); }
    await expect(decodeCanonicalBlock(lateFailure(), encoded.descriptor)).rejects.toMatchObject({ code: "invalid_block" });
  });
  it("handles pre-abort and abort during encode without an unobserved gzip rejection", async () => {
    const input = await corpus(), controller = new AbortController(); controller.abort();
    await expect(encodeCanonicalBlock(input, { signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    const active = new AbortController(), result = encodeCanonicalBlock(input, { signal: active.signal });
    active.abort(); await expect(result).rejects.toMatchObject({ code: "aborted" });
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  it("aborts pending stream I/O and requests producer cleanup", async () => {
    const encoded = await encodeCanonicalBlock(await corpus()), controller = new AbortController(), entered = Promise.withResolvers<void>();
    let closed = false;
    async function* input() {
      try {
        yield encoded.compressed.subarray(0, 10); entered.resolve();
        await new Promise<void>(resolve => controller.signal.addEventListener("abort", () => resolve(), { once: true }));
      } finally { closed = true; }
    }
    const result = decodeCanonicalBlock(input(), encoded.descriptor, { signal: controller.signal });
    await entered.promise; controller.abort(); await expect(result).rejects.toMatchObject({ code: "aborted" });
    await new Promise(resolve => setTimeout(resolve, 0)); expect(closed).toBe(true);
  });
});
