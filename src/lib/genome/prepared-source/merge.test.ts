import { describe, expect, it, vi } from "vitest";
import { encodePreparedBlock } from "./codec";
import { streamVcf } from "../parsers/vcf";
import { syntheticLines, syntheticRows, syntheticSource } from "./fixtures";
import { createPreparedRuns, type PreparedRunReceipt } from "./runs";
import type { PreparedBlockDescriptor, PreparedEvent } from "./schema";
import { mergePreparedRuns, type PreparedMergeSummary } from "./merge";

async function* values<T>(items: Iterable<T>) { yield* items; }
async function data(rows = syntheticRows) {
  const events: PreparedEvent[] = [];
  for await (const event of streamVcf(syntheticLines(rows))) if (event.type !== "summary") events.push(event);
  return events;
}
const rank = { observed: 0, reference: 1, variant: 2 };
function compare(a: PreparedEvent, b: PreparedEvent) {
  const x = a.type === "variant" ? a.record : a.call, y = b.type === "variant" ? b.record : b.call;
  return x.chrom - y.chrom || x.pos - y.pos || a.line - b.line || rank[a.type] - rank[b.type];
}
const row = (pos: number) => `1\t${pos}\trs${pos}\tA\tC\t.\tPASS\t.\tGT\t0/1`;
async function fixture(groups: PreparedEvent[][], blockSize = 3, sort = true) {
  const bytes = new Map<number, Uint8Array>(), runs: PreparedRunReceipt[] = [];
  let sequence = 0;
  for (const group of groups) {
    const events = sort ? group.toSorted(compare) : group;
    const blocks: PreparedBlockDescriptor[] = [];
    for (let i = 0; i < events.length; i += blockSize) {
      const encoded = await encodePreparedBlock({ source: syntheticSource, sequence: sequence++, events: events.slice(i, i + blockSize) });
      blocks.push(encoded.descriptor); bytes.set(encoded.descriptor.sequence, encoded.compressed);
    }
    runs.push({ version: "prepared-run-v1", state: "provisional", source: syntheticSource,
      sequence: runs.length, eventCount: events.length, blocks });
  }
  const readBlock = vi.fn(async (descriptor: PreparedBlockDescriptor) => {
    const block = bytes.get(descriptor.sequence);
    if (!block) throw new Error("synthetic missing block");
    return values([block]);
  });
  return { runs, bytes, readBlock };
}
async function collect(iterator: AsyncIterable<PreparedEvent | PreparedMergeSummary>) {
  const output: (PreparedEvent | PreparedMergeSummary)[] = [];
  for await (const event of iterator) output.push(event);
  return output;
}
function merge(f: Awaited<ReturnType<typeof fixture>>, signal?: AbortSignal) {
  return mergePreparedRuns(f.runs, { source: syntheticSource, readBlock: f.readBlock, signal });
}

describe("bounded provisional run merge", () => {
  it("merges interleaved actual parser calls, preserving all duplicates/reference/no-call/quality fields", async () => {
    const original = await data(), extra = await data([row(9), row(12), row(11)]);
    const f = await fixture([original, extra], 2);
    const output = await collect(mergePreparedRuns([...f.runs].reverse(), { source: syntheticSource, readBlock: f.readBlock }));
    expect(output.slice(0, -1)).toEqual([...original, ...extra].toSorted(compare));
    expect(output.at(-1)).toEqual({ type: "merge-summary", version: "prepared-merge-v1", state: "provisional",
      source: syntheticSource, inputRunSequences: [0, 1], inputBlockCount: f.bytes.size,
      eventCount: original.length + extra.length,
      variantCount: [...original, ...extra].filter(e => e.type === "variant").length,
      referenceCallCount: [...original, ...extra].filter(e => e.type === "reference").length,
      observedCallCount: [...original, ...extra].filter(e => e.type === "observed").length });
    expect(output.some(e => e.type === "observed" && e.call.genotype === "--")).toBe(true);
    expect(output.some(e => e.type === "reference")).toBe(true);
    expect(output.filter(e => e.type === "variant" && e.record.pos === 12)).toHaveLength(4);
    expect(output.at(-1)).not.toHaveProperty("observedCallsValid");
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])("accepts %i input runs", async count => {
    const groups = await Promise.all(Array.from({ length: count }, (_, i) => data([row(count - i)])));
    const f = await fixture(groups);
    const output = await collect(merge(f));
    expect(output.slice(0, -1)).toEqual(groups.flat().toSorted(compare));
    expect(output.at(-1)).toMatchObject({ eventCount: count * 2, inputRunSequences: Array.from({ length: count }, (_, i) => i) });
  });

  it("accepts a later-pass run larger than the initial 32k buffer without retaining all input events", async () => {
    const bytes = new Map<number, Uint8Array>(), initial: PreparedRunReceipt[] = [];
    async function* lines() {
      yield* syntheticLines([]);
      for (let i = 0; i < 17_000; i++) yield row(i + 1);
    }
    await createPreparedRuns(streamVcf(lines()), { source: syntheticSource, sink: {
      async writeBlock(block) { bytes.set(block.descriptor.sequence, block.compressed); return block.descriptor; },
      async writeRun(run) { initial.push(run); return run; },
    } });
    const combined: PreparedRunReceipt = { ...initial[0], eventCount: 34_000, blocks: initial.flatMap(r => r.blocks) };
    let count = 0, summary: PreparedMergeSummary | undefined;
    const readBlock = vi.fn(async (d: PreparedBlockDescriptor) => values([bytes.get(d.sequence)!]));
    for await (const event of mergePreparedRuns([combined], { source: syntheticSource, readBlock })) {
      if (event.type === "merge-summary") summary = event; else count++;
    }
    expect(count).toBe(34_000); expect(summary?.eventCount).toBe(count); expect(readBlock).toHaveBeenCalledTimes(17);
  });

  it.each(["none", "nine", "version", "state", "extra", "negative", "count", "empty-blocks", "block-extra", "duplicate-run", "duplicate-block", "source", "block-source", "reordered"])
  ("rejects %s receipt before any reads", async kind => {
    const f = await fixture([await data()], 2);
    let runs: unknown = structuredClone(f.runs);
    const changed = runs as PreparedRunReceipt[];
    if (kind === "none") runs = [];
    if (kind === "nine") runs = Array.from({ length: 9 }, () => changed[0]);
    if (kind === "version") Object.assign(changed[0], { version: "unsupported" });
    if (kind === "state") Object.assign(changed[0], { state: "published" });
    if (kind === "extra") Object.assign(changed[0], { extra: true });
    if (kind === "negative") changed[0].eventCount = -1;
    if (kind === "count") changed[0].eventCount++;
    if (kind === "empty-blocks") changed[0].blocks = [];
    if (kind === "block-extra") Object.assign(changed[0].blocks[0], { extra: true });
    if (kind === "duplicate-run") changed.push(structuredClone(changed[0]));
    if (kind === "duplicate-block") { changed[0].blocks.push(changed[0].blocks[0]); changed[0].eventCount += changed[0].blocks[0].eventCount; }
    if (kind === "source") changed[0].source.rawSha256 = "c".repeat(64);
    if (kind === "block-source") changed[0].blocks[0].source.sourceRevision++;
    if (kind === "reordered") changed[0].blocks.reverse();
    await expect(collect(mergePreparedRuns(runs as PreparedRunReceipt[], { source: syntheticSource, readBlock: f.readBlock })))
      .rejects.toMatchObject({ code: "invalid_receipt" });
    expect(f.readBlock).not.toHaveBeenCalled();
  });

  it("refuses oversized inline receipts and block count before reading", async () => {
    const f = await fixture([await data([row(1)])]);
    const block = f.runs[0].blocks[0];
    const many = Array.from({ length: 8_000 }, (_, i) => ({ ...block, sequence: i,
      compressedSha256: i.toString(16).padStart(64, "0") }));
    const run = { ...f.runs[0], blocks: many, eventCount: many.length * block.eventCount };
    expect(Buffer.byteLength(JSON.stringify(run))).toBeGreaterThan(4_000_000);
    await expect(collect(mergePreparedRuns([run], { source: syntheticSource, readBlock: f.readBlock })))
      .rejects.toMatchObject({ code: "invalid_receipt" });
    await expect(collect(mergePreparedRuns([{ ...run, blocks: Array(32_001).fill(block) }], { source: syntheticSource, readBlock: f.readBlock })))
      .rejects.toMatchObject({ code: "invalid_receipt" });
    expect(f.readBlock).not.toHaveBeenCalled();
  });

  it.each(["corrupt", "missing", "swapped", "count"])("fails a late %s block without a terminal receipt", async kind => {
    const f = await fixture([await data([row(1), row(2)])], 2);
    const second = f.runs[0].blocks[1], emitted: unknown[] = [];
    if (kind === "corrupt") { const bytes = Buffer.from(f.bytes.get(second.sequence)!); bytes[0] ^= 255; f.bytes.set(second.sequence, bytes); }
    if (kind === "missing") f.bytes.delete(second.sequence);
    if (kind === "swapped") f.bytes.set(second.sequence, f.bytes.get(0)!);
    if (kind === "count") { second.eventCount++; f.runs[0].eventCount++; }
    const work = (async () => { for await (const event of merge(f)) emitted.push(event); })();
    await expect(work).rejects.toThrow();
    expect(emitted).toHaveLength(2);
    expect(emitted).toEqual(await data([row(1)]));
  });

  it.each([1, 2])("rejects validly encoded out-of-order calls within/across block size%i", async blockSize => {
    const original = await data([row(2), row(1)]);
    const f = await fixture([original], blockSize, false), output: unknown[] = [];
    await expect((async () => { for await (const event of merge(f)) output.push(event); })()).rejects.toMatchObject({ code: "out_of_order" });
    expect(output.some(e => (e as { type: string }).type === "merge-summary")).toBe(false);
    expect(output.length).toBeGreaterThan(0);
  });

  it("rejects within-block order before emitting that block", async () => {
    const f = await fixture([await data([row(2), row(1)])], 4, false);
    await expect(merge(f).next()).rejects.toMatchObject({ code: "out_of_order" });
  });

  it("loads at most one block per input before yielding and respects downstream return", async () => {
    const f = await fixture([await data([row(1), row(3)]), await data([row(2), row(4)])], 1);
    const iterator = merge(f);
    expect((await iterator.next()).done).toBe(false);
    expect(f.readBlock).toHaveBeenCalledTimes(2);
    await new Promise<void>(r => setImmediate(r)); expect(f.readBlock).toHaveBeenCalledTimes(2);
    await iterator.return(); expect(f.readBlock).toHaveBeenCalledTimes(2);
  });

  it("does not allow a reader to mutate expected bindings", async () => {
    const f = await fixture([await data([row(1)])]);
    const output = await collect(mergePreparedRuns(f.runs, { source: syntheticSource, readBlock: async d => {
      d.source.rawSha256 = "c".repeat(64); d.eventCount++;
      return values([f.bytes.get(d.sequence)!]);
    } }));
    expect(output.at(-1)).toMatchObject({ source: syntheticSource, eventCount: 2 });
  });

  it("cancels before reading, during a pending reader, and after emitted data", async () => {
    const f = await fixture([await data([row(1), row(2)])], 2);
    const before = new AbortController(); before.abort();
    await expect(merge(f, before.signal).next()).rejects.toMatchObject({ code: "aborted" });
    expect(f.readBlock).not.toHaveBeenCalled();
    const pending = new AbortController();
    const iterator = mergePreparedRuns(f.runs, { source: syntheticSource, signal: pending.signal,
      readBlock: () => new Promise(() => {}) });
    const read = iterator.next(); pending.abort(); await expect(read).rejects.toMatchObject({ code: "aborted" });
    const later = new AbortController(), active = merge(f, later.signal);
    await active.next(); later.abort(); await expect(active.next()).rejects.toMatchObject({ code: "aborted" });
    expect(f.readBlock).toHaveBeenCalledTimes(1);
  });

  it("observes a reader rejection if it synchronously aborts", async () => {
    const f = await fixture([await data([row(1)])]), controller = new AbortController();
    const iterator = mergePreparedRuns(f.runs, { source: syntheticSource, signal: controller.signal, readBlock: () => {
      controller.abort(); return Promise.reject(new Error("synthetic reader failure"));
    } });
    await expect(iterator.next()).rejects.toMatchObject({ code: "aborted" });
    await new Promise<void>(r => setImmediate(r)); // Unhandled rejection would fail the Vitest run.
  });

  it("aborts pending byte input without masking it with iterator cleanup failure", async () => {
    const f = await fixture([await data([row(1)])]), controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>(r => { entered = r; });
    const returned = vi.fn(async () => { throw new Error("synthetic private cleanup payload"); });
    const stream: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({
      next: () => { entered(); return new Promise(() => {}); }, return: returned,
    }) };
    const read = mergePreparedRuns(f.runs, { source: syntheticSource, signal: controller.signal, readBlock: () => stream }).next();
    await started; controller.abort(); await expect(read).rejects.toMatchObject({ code: "aborted" });
    await new Promise<void>(r => setImmediate(r));
  });
});
