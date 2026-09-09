import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { streamVcf, type VcfParseEvent } from "../parsers/vcf";
import { canonicalizePreparedEvents } from "./canonical";
import { encodeCanonicalBlock } from "./canonical-codec";
import type { CanonicalBinding, CanonicalRecord, CanonicalSummary } from "./canonical-schema";
import { syntheticSource } from "./fixtures";
import type { PreparedMergeSummary } from "./merge";
import type { PreparedEvent } from "./schema";
import { createCanonicalRsidRuns, encodeCanonicalRsidBlock, decodeCanonicalRsidBlock, mergeCanonicalRsidRuns,
  compareCanonicalRsidPointers, type CanonicalRsidPointer, type CanonicalRsidRunReceipt,
  type CanonicalRsidBlockDescriptor, type CanonicalRsidRunSink } from "./canonical-rsid-index";
const binding: CanonicalBinding = { version: "prepared-canonical-v1", source: syntheticSource, targetBuild: "GRCh38", liftoverSha256: null };
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
async function* values<T>(items: T[]) { yield* items; }
async function* chunks(bytes: Uint8Array, size = 101) { for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size); }
const p = (rsid: number, blockSequence = 0, recordOffset = 0): CanonicalRsidPointer => ({ rsid, blockSequence, recordOffset });
const record = (rsid: number | null, line = 1): CanonicalRecord => ({ type: "canonical-record", version: "prepared-canonical-v1",
  event: { type: "variant", line, record: { rsid, chrom: 1, pos: line, ref: "A", alt: "C", genotype: "A/C" } }, normalization: { status: "unmapped" } });
function sinkStore() {
  const blocks = new Map<number, { descriptor: CanonicalRsidBlockDescriptor; compressed: Uint8Array }>();
  const runs: CanonicalRsidRunReceipt[] = [];
  const sink: CanonicalRsidRunSink = {
    async writeBlock(block) { blocks.set(block.descriptor.sequence, structuredClone(block)); return structuredClone(block.descriptor); },
    async writeRun(run) { runs.push(structuredClone(run)); return structuredClone(run); },
  };
  return { blocks, runs, sink, readBlock: (d: CanonicalRsidBlockDescriptor) => chunks(blocks.get(d.sequence)!.compressed) };
}
async function encodedRuns(groups: CanonicalRsidPointer[][][]) {
  const store = sinkStore(); let sequence = 0;
  for (let runSequence = 0; runSequence < groups.length; runSequence++) {
    const blocks: CanonicalRsidBlockDescriptor[] = [];
    for (const pointers of groups[runSequence]) {
      const encoded = await encodeCanonicalRsidBlock({ binding, sequence: sequence++, pointers });
      blocks.push(encoded.descriptor); await store.sink.writeBlock({ ...encoded, runSequence });
    }
    await store.sink.writeRun({ version: "canonical-rsid-run-v1", state: "provisional", binding,
      sequence: runSequence, pointerCount: blocks.reduce((a, b) => a + b.pointerCount, 0), blocks });
  }
  return store;
}
async function corpus() {
  const source = { ...syntheticSource, sourceBuild: "GRCh37" as const };
  const row = (pos: number, gt = "0/1", alt = "C", rsid = "rs8") => `1\t${pos}\t${rsid}\tA\t${alt}\t.\tPASS\t.\tGT\t${gt}`;
  const all = await Array.fromAsync(streamVcf(values(["##fileformat=VCFv4.2", "##reference=GRCh37",
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC",
    row(1), row(1), row(2, "0/0"), row(3, "./."), row(4, "0/1", "AC"), row(80), row(81, "0/1", "C", ".")])));
  const summary = all.at(-1) as Extract<VcfParseEvent, { type: "summary" }>;
  const rank = { observed: 0, reference: 1, variant: 2 };
  const events = all.filter((e): e is PreparedEvent => e.type !== "summary").sort((a, b) => {
    const x = a.type === "variant" ? a.record : a.call, y = b.type === "variant" ? b.record : b.call;
    return x.chrom - y.chrom || x.pos - y.pos || a.line - b.line || rank[a.type] - rank[b.type];
  });
  const merge: PreparedMergeSummary = { type: "merge-summary", version: "prepared-merge-v1", state: "provisional", source,
    inputRunSequences: [0], inputBlockCount: 1, eventCount: events.length, variantCount: summary.variantCount,
    observedCallCount: summary.observedCallCount, referenceCallCount: summary.referenceCallCount };
  const chainBytes = Buffer.from("chain 1 1 1000 + 0 10 1 1000 - 100 110 1\n10\n");
  const canonical = await Array.fromAsync(canonicalizePreparedEvents(values<PreparedEvent | PreparedMergeSummary>([...events, merge]), {
    source, expectedParserRevision: source.parserRevision, maximumUnmappedFraction: 0.9, expectedMergeSummary: merge,
    parserReceipt: { version: "prepared-runs-v1", state: "provisional", source, summary, runCount: 1, eventCount: events.length, blockCount: 1 },
    liftover: { chainBytes, sha256: sha(chainBytes) },
  }));
  return { binding: (canonical.at(-1) as CanonicalSummary).binding, records: canonical.filter((r): r is CanonicalRecord => r.type === "canonical-record") };
}

describe("canonical rsID pointer runs", () => {
  it("preserves original IDs across actual canonical dispositions, collisions and source-only evidence", async () => {
    const input = await corpus(), encoded = await encodeCanonicalBlock({ ...input, sequence: 0 }), store = sinkStore();
    const scan = await createCanonicalRsidRuns(values([{ descriptor: encoded.descriptor, bytes: chunks(encoded.compressed, 1) }]), { binding: input.binding, sink: store.sink });
    const expected = input.records.flatMap((r, offset) => {
      const event = r.event, rsid = event.type === "reference" ? null : (event.type === "variant" ? event.record : event.call).rsid;
      return rsid === null ? [] : [p(rsid, 0, offset)];
    }).sort(compareCanonicalRsidPointers);
    const output = await Array.fromAsync(mergeCanonicalRsidRuns(store.runs, { binding: input.binding, readBlock: store.readBlock }));
    expect(output.slice(0, -1)).toEqual(expected);
    expect(scan).toMatchObject({ canonicalBlockCount: 1, canonicalRecordCount: input.records.length, pointerCount: expected.length, runCount: 1 });
    expect(new Set(input.records.map(r => r.normalization.status))).toEqual(new Set(["normalized", "duplicate", "unmapped", "unsupported_alleles", "source_reference"]));
    for (const genotype of ["--", "A/A"]) expect(expected.some(pointer => { const r = input.records[pointer.recordOffset]; return r.event.type === "observed" && r.event.call.genotype === genotype; })).toBe(true);
    expect(input.records.filter(r => r.event.type === "reference").every(r => !expected.some(p => input.records[p.recordOffset] === r))).toBe(true);
  });
  it("returns zero runs for a verified source with no rsIDs", async () => {
    const encoded = await encodeCanonicalBlock({ binding, sequence: 0, records: [record(null)] }), store = sinkStore();
    expect(await createCanonicalRsidRuns(values([{ descriptor: encoded.descriptor, bytes: chunks(encoded.compressed) }]), { binding, sink: store.sink }))
      .toMatchObject({ canonicalBlockCount: 1, canonicalRecordCount: 1, pointerCount: 0, runCount: 0, indexBlockCount: 0 });
    expect(store.blocks.size).toBe(0);
  });
  it("splits 32002 pointers into bounded runs and blocks with exact acknowledgements", async () => {
    const store = sinkStore(); let pulls = 0;
    async function* input() {
      for (let sequence = 0; sequence < 18; sequence++) {
        pulls++; const encoded = await encodeCanonicalBlock({ binding, sequence,
          records: Array.from({ length: sequence < 16 ? 2000 : 1 }, (_, i) => record(sequence < 16 ? 32002 - sequence * 2000 - i : 18 - sequence)) });
        yield { descriptor: encoded.descriptor, bytes: chunks(encoded.compressed) };
      }
    }
    const scan = await createCanonicalRsidRuns(input(), { binding, sink: { ...store.sink,
      async writeRun(run) { const before = pulls; await Promise.resolve(); expect(pulls).toBe(before); return store.sink.writeRun(run); },
    } });
    expect(scan.pointerCount).toBe(32002); expect(store.runs.map(r => r.pointerCount)).toEqual([32000, 2]);
    expect([...store.blocks.values()].every(b => b.descriptor.pointerCount <= 2000)).toBe(true);
    const merged = await Array.fromAsync(mergeCanonicalRsidRuns(store.runs, { binding, readBlock: store.readBlock }));
    expect(merged.slice(0, -1).map(p => (p as CanonicalRsidPointer).rsid)).toEqual(Array.from({ length: 32002 }, (_, i) => i + 1));
    expect(merged.at(-1)).toMatchObject({ pointerCount: 32002, inputBlockCount: 17 });
  });
  it.each(["hash", "sequence", "binding", "EOF"])("refuses a late canonical %s failure", async mode => {
    const first = await encodeCanonicalBlock({ binding, sequence: 0, records: [record(1)] });
    const second = await encodeCanonicalBlock({ binding, sequence: 1, records: [record(2)] }), store = sinkStore();
    const bad = structuredClone(second.descriptor);
    if (mode === "hash") bad.compressedSha256 = "0".repeat(64);
    if (mode === "sequence") bad.sequence = 2;
    if (mode === "binding") bad.binding.source.fileId = "33333333-3333-4333-8333-333333333333";
    async function* bytes() { yield second.compressed; if (mode === "EOF") throw Error("late input failure"); }
    await expect(createCanonicalRsidRuns(values([{ descriptor: first.descriptor, bytes: chunks(first.compressed) }, { descriptor: bad, bytes: bytes() }]), { binding, sink: store.sink })).rejects.toThrow();
    expect(store.runs).toHaveLength(0);
  });
  it.each(["block", "run"])("refuses altered or open %s acknowledgment", async kind => {
    const encoded = await encodeCanonicalBlock({ binding, sequence: 0, records: [record(1)] }), store = sinkStore();
    const sink = { ...store.sink, ...(kind === "block" ? { writeBlock: async (b: Parameters<CanonicalRsidRunSink["writeBlock"]>[0]) => ({ ...b.descriptor, unexpected: true }) }
      : { writeRun: async (r: CanonicalRsidRunReceipt) => ({ ...r, pointerCount: 2 }) }) };
    await expect(createCanonicalRsidRuns(values([{ descriptor: encoded.descriptor, bytes: chunks(encoded.compressed) }]), { binding, sink })).rejects.toThrow();
  });
  it("observes rejected promises on synchronous abort and preserves abort over cleanup failure", async () => {
    const controller = new AbortController(), encoded = await encodeCanonicalBlock({ binding, sequence: 0, records: [record(1)] });
    let returned = false;
    const input = { [Symbol.asyncIterator]() { let i = 0; return {
      async next() { if (i++) { controller.abort(); throw Error("input interrupted"); } return { done: false as const, value: { descriptor: encoded.descriptor, bytes: chunks(encoded.compressed) } }; },
      async return() { returned = true; throw Error("private cleanup text"); },
    }; } };
    await expect(createCanonicalRsidRuns(input, { binding, sink: sinkStore().sink, signal: controller.signal })).rejects.toMatchObject({ code: "aborted" }); expect(returned).toBe(true);
    const abort = new AbortController(), store = sinkStore();
    await expect(createCanonicalRsidRuns(values([{ descriptor: encoded.descriptor, bytes: chunks(encoded.compressed) }]), { binding, signal: abort.signal,
      sink: { ...store.sink, writeBlock() { abort.abort(); return Promise.reject(Error("private sink text")); } } })).rejects.toMatchObject({ code: "aborted" });
    await new Promise(resolve => setTimeout(resolve, 0));
  });
});

describe("rsID index gzip codec and merge", () => {
  it.each([1, 2, 8])("merges %i inputs with repeated IDs/ties and terminal counts", async count => {
    const store = await encodedRuns(Array.from({ length: count }, (_, i) => [[p(1), p(i + 2, i, 1)]]));
    const output = await Array.fromAsync(mergeCanonicalRsidRuns(store.runs, { binding, readBlock: store.readBlock }));
    expect(output.slice(0, -1)).toEqual(Array.from({ length: count }, (_, i) => [p(1), p(i + 2, i, 1)]).flat().sort(compareCanonicalRsidPointers));
    expect(output.at(-1)).toMatchObject({ type: "rsid-merge-summary", pointerCount: count * 2, inputBlockCount: count });
  });
  it.each(["nine", "duplicate-run", "duplicate-block", "count", "gap", "binding", "open"])("refuses %s receipts before reads", async mode => {
    const store = await encodedRuns([[[p(1)], [p(2)]], [[p(3)]]]), runs = structuredClone(store.runs), read = vi.fn(store.readBlock);
    if (mode === "nine") runs.push(...Array.from({ length: 7 }, () => runs[0]));
    if (mode === "duplicate-run") runs[1].sequence = runs[0].sequence;
    if (mode === "duplicate-block") runs[1].blocks[0] = runs[0].blocks[0];
    if (mode === "count") runs[0].pointerCount++;
    if (mode === "gap") runs[0].blocks[1].sequence++;
    if (mode === "binding") runs[1].binding.source.rawSha256 = "c".repeat(64);
    if (mode === "open") Object.assign(runs[0], { unexpected: true });
    await expect(Array.fromAsync(mergeCanonicalRsidRuns(runs, { binding, readBlock: read }))).rejects.toThrow(); expect(read).not.toHaveBeenCalled();
  });
  it.each(["valid-large", "nested-string", "nested-width"])("bounds %s metadata before a reader can run", async mode => {
    const store = await encodedRuns([[[p(1)]]]), run = structuredClone(store.runs[0]);
    if (mode === "valid-large") {
      run.blocks = Array.from({ length: 8000 }, (_, sequence) => ({ ...run.blocks[0], sequence })); run.pointerCount = 8000;
    }
    if (mode === "nested-string") run.blocks[0].binding.source.parserRevision = "x".repeat(4_000_001);
    if (mode === "nested-width") Object.assign(run.blocks[0].binding.source, Object.fromEntries(Array.from({ length: 100 }, (_, i) => ["extra" + i, 1])));
    const read = vi.fn(store.readBlock);
    await expect(Array.fromAsync(mergeCanonicalRsidRuns([run], { binding, readBlock: read }))).rejects.toMatchObject({ code: mode === "valid-large" ? "too_large" : "invalid_receipt" });
    expect(read).not.toHaveBeenCalled();
  });
  it("accepts a later-pass run exceeding initial 32k buffering without losing ties", async () => {
    const store = await encodedRuns([Array.from({ length: 17 }, () => Array.from({ length: 2000 }, () => p(1)))]);
    const output = await Array.fromAsync(mergeCanonicalRsidRuns(store.runs, { binding, readBlock: store.readBlock }));
    expect(output.length).toBe(34001); expect(output.at(-1)).toMatchObject({ pointerCount: 34000, inputBlockCount: 17 });
  });
  it("observes a reader rejection that synchronously aborts", async () => {
    const store = await encodedRuns([[[p(1)]]]), controller = new AbortController();
    await expect(Array.fromAsync(mergeCanonicalRsidRuns(store.runs, { binding, signal: controller.signal,
      readBlock() { controller.abort(); return Promise.reject(Error("private reader text")); },
    }))).rejects.toMatchObject({ code: "aborted" });
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  it("detects late cross-block disorder without a false terminal", async () => {
    const store = await encodedRuns([[[p(5)], [p(1)]]]), iterator = mergeCanonicalRsidRuns(store.runs, { binding, readBlock: store.readBlock });
    expect((await iterator.next()).value).toEqual(p(5)); await expect(iterator.next()).rejects.toMatchObject({ code: "out_of_order" });
  });
  it("respects downstream backpressure", async () => {
    const store = await encodedRuns([[[p(1), p(2)], [p(3)]]]), read = vi.fn(store.readBlock);
    const iterator = mergeCanonicalRsidRuns(store.runs, { binding, readBlock: read });
    await iterator.next(); expect(read).toHaveBeenCalledTimes(1); await Promise.resolve(); expect(read).toHaveBeenCalledTimes(1);
    await iterator.next(); expect(read).toHaveBeenCalledTimes(1); await iterator.return();
  });
  it.each(["hash", "truncated", "trailing", "late-error", "bounds", "sequence", "binding"])("refuses %s before returning decoded pointers", async mode => {
    const block = await encodeCanonicalRsidBlock({ binding, sequence: 0, pointers: [p(1)] });
    let bytes = block.compressed; const descriptor = structuredClone(block.descriptor);
    if (mode === "hash") descriptor.decodedSha256 = "0".repeat(64);
    if (mode === "truncated") bytes = bytes.subarray(0, bytes.length - 1);
    if (mode === "trailing") bytes = Buffer.concat([bytes, Buffer.from([1])]);
    if (mode === "bounds") descriptor.last.rsid = 2;
    if (mode === "sequence") descriptor.sequence++;
    if (mode === "binding") descriptor.binding.source.rawSha256 = "d".repeat(64);
    async function* input() { yield bytes; if (mode === "late-error") throw Error("late source failure"); }
    await expect(decodeCanonicalRsidBlock(input(), descriptor)).rejects.toThrow();
  });
  it("rejects rehashed malformed/order-invalid wire bodies and >2000 pointers", async () => {
    const block = await encodeCanonicalRsidBlock({ binding, sequence: 0, pointers: [p(1), p(2)] });
    for (const mutate of [(raw: { pointers: CanonicalRsidPointer[] }) => raw.pointers.reverse(), (raw: object) => Object.assign(raw, { unexpected: 1 })]) {
      const raw = JSON.parse(gunzipSync(block.compressed).toString()); mutate(raw);
      const decoded = Buffer.from(JSON.stringify(raw)), compressed = gzipSync(decoded), descriptor = { ...block.descriptor,
        decodedBytes: decoded.length, compressedBytes: compressed.length, decodedSha256: sha(decoded), compressedSha256: sha(compressed) };
      await expect(decodeCanonicalRsidBlock(chunks(compressed), descriptor)).rejects.toThrow();
    }
    await expect(encodeCanonicalRsidBlock({ binding, sequence: 0, pointers: Array.from({ length: 2001 }, () => p(1)) })).rejects.toThrow();
  });
  it("aborts a stalled byte source before returning pointers", async () => {
    const block = await encodeCanonicalRsidBlock({ binding, sequence: 0, pointers: [p(1)] }), controller = new AbortController();
    let release!: () => void; const stalled = new Promise<void>(resolve => { release = resolve; });
    async function* input() { yield block.compressed; await stalled; }
    const decoding = decodeCanonicalRsidBlock(input(), block.descriptor, { signal: controller.signal });
    controller.abort(); await expect(decoding).rejects.toMatchObject({ code: "aborted" }); release();
  });
});
