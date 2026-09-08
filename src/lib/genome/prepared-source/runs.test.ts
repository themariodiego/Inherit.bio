import { describe, expect, it, vi } from "vitest";
import { streamVcf, type VcfParseEvent } from "../parsers/vcf";
import { decodePreparedBlock } from "./codec";
import { syntheticHeader, syntheticLines, syntheticRows, syntheticSource } from "./fixtures";
import { type PreparedEvent, type PreparedBlockDescriptor } from "./schema";
import { createPreparedRuns, PREPARED_RUN_MAX_EVENTS, PREPARED_RUN_MAX_EVENT_BYTES,
  PREPARED_RUN_MAX_RECEIPT_BYTES, type PreparedRunReceipt, type PreparedRunSink } from "./runs";

async function* values<T>(items: Iterable<T>) { yield* items; }
async function parsed(rows = syntheticRows) {
  const events: VcfParseEvent[] = [];
  for await (const event of streamVcf(syntheticLines(rows))) events.push(event);
  return events;
}
function capture() {
  const blocks: { runSequence: number; descriptor: PreparedBlockDescriptor; events: PreparedEvent[] }[] = [];
  const runs: PreparedRunReceipt[] = [];
  const sink: PreparedRunSink = {
    async writeBlock(block) {
      const decoded = await decodePreparedBlock(values([block.compressed]), block.descriptor);
      blocks.push({ runSequence: block.runSequence, descriptor: structuredClone(block.descriptor), events: decoded.events });
      return structuredClone(block.descriptor);
    },
    async writeRun(receipt) { runs.push(structuredClone(receipt)); return structuredClone(receipt); },
  };
  return { blocks, runs, sink };
}
function row(pos: number, alt = "C", chrom = 1) { return `${chrom}\t${pos}\trs${pos}\tA\t${alt}\t.\tPASS\t.\tGT\t0/1`; }
const order = { observed: 0, reference: 1, variant: 2 };
function key(event: PreparedEvent) {
  const call = event.type === "variant" ? event.record : event.call;
  return [call.chrom, call.pos, event.line, order[event.type]];
}
function sorted(events: PreparedEvent[]) {
  return events.toSorted((a, b) => { const x = key(a), y = key(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
}
const terminal = (events: PreparedEvent[]): VcfParseEvent => ({ type: "summary", build: "GRCh38", skipped: 0,
  variantCount: events.filter(e => e.type === "variant").length,
  referenceCallCount: events.filter(e => e.type === "reference").length,
  observedCallCount: events.filter(e => e.type === "observed").length, observedCallsValid: true });

describe("bounded provisional prepared runs", () => {
  it("sorts actual unsorted parser calls and preserves every field, no-calls, duplicates and conflicts", async () => {
    const original = await parsed([...syntheticRows, row(3, "G", 2)]), out = capture();
    const receipt = await createPreparedRuns(values(original), { source: syntheticSource, sink: out.sink });
    const data = original.filter((e): e is PreparedEvent => e.type !== "summary");
    expect(out.blocks.flatMap(b => b.events)).toEqual(sorted(data));
    expect(receipt).toEqual({ version: "prepared-runs-v1", state: "provisional", source: syntheticSource, summary: original.at(-1),
      runCount: 1, eventCount: data.length, blockCount: 1 });
    expect(out.runs[0].state).toBe("provisional");
    expect(out.runs[0].version).toBe("prepared-run-v1");
    expect(data.some(e => e.type === "observed" && e.call.genotype === "--")).toBe(true);
    expect(data.filter(e => e.type === "variant" && e.record.pos === 12)).toHaveLength(3);
    expect(data.some(e => e.type === "reference")).toBe(true);
  });

  it("bounds runs by event count, produces multiple <=2000-event blocks, and never returns a file manifest", async () => {
    const out = capture();
    async function* lines() {
      yield* syntheticHeader;
      for (let i = 0; i < 17_000; i++) yield row(17_000 - i);
    }
    const receipt = await createPreparedRuns(streamVcf(lines()), { source: syntheticSource, sink: out.sink });
    expect(receipt.eventCount).toBe(34_000);
    expect(out.runs.map(r => r.eventCount)).toEqual([PREPARED_RUN_MAX_EVENTS, 2_000]);
    expect(out.runs[0].blocks).toHaveLength(16);
    for (const run of out.runs) {
      const events = out.blocks.filter(b => b.runSequence === run.sequence).flatMap(b => b.events);
      expect(events).toEqual(sorted(events));
      expect(Buffer.byteLength(JSON.stringify(run))).toBeLessThanOrEqual(PREPARED_RUN_MAX_RECEIPT_BYTES);
      expect(run.blocks.every(b => b.eventCount <= 2000)).toBe(true);
    }
    expect(out.blocks.map(b => b.descriptor.sequence)).toEqual(out.blocks.map((_, i) => i));
    expect(receipt).not.toHaveProperty("runs"); expect(receipt).not.toHaveProperty("blocks");
  });

  it("flushes on the byte bound and splits large sorted runs into codec-sized blocks", async () => {
    const out = capture();
    const rows = Array.from({ length: 300 }, (_, i) => row(1000 - i, "C".repeat(20_000)));
    await createPreparedRuns(streamVcf(syntheticLines(rows)), { source: syntheticSource, sink: out.sink });
    expect(out.runs.length).toBeGreaterThan(1);
    expect(out.runs.every(r => r.eventCount < PREPARED_RUN_MAX_EVENTS)).toBe(true);
    for (const run of out.runs) {
      const events = out.blocks.filter(b => b.runSequence === run.sequence).flatMap(b => b.events);
      expect(events.reduce((n, e) => n + Buffer.byteLength(JSON.stringify(e)), 0)).toBeLessThanOrEqual(PREPARED_RUN_MAX_EVENT_BYTES);
      expect(events).toEqual(sorted(events));
    }
    expect(out.blocks.length).toBeGreaterThan(out.runs.length);
  });

  it("preserves a supported near-four-MB long allele singleton", async () => {
    const original = await parsed([row(12, "C".repeat(1_999_930))]), out = capture();
    const receipt = await createPreparedRuns(values(original), { source: syntheticSource, sink: out.sink });
    expect(out.blocks.flatMap(b => b.events)).toEqual(original.slice(0, -1));
    expect(receipt.eventCount).toBe(1); // no-rsid would also remain a literal source variant
  });

  it("accepts empty valid input only with an exact terminal summary", async () => {
    const out = capture();
    expect(await createPreparedRuns(streamVcf(syntheticLines([])), { source: syntheticSource, sink: out.sink }))
      .toMatchObject({ runCount: 0, eventCount: 0, blockCount: 0 });
    expect(out.runs).toEqual([]);
  });

  it.each(["variantCount", "observedCallCount", "referenceCallCount", "build", "observedCallsValid", "extra", "skipped"])
  ("rejects invalid terminal %s without a final receipt", async field => {
    const all = await parsed(), out = capture();
    const bad = { ...all.at(-1), [field]: field === "build" ? "GRCh37" : field === "observedCallsValid" ? false : field === "skipped" ? -1 : 999 };
    await expect(createPreparedRuns(values([...all.slice(0, -1), bad as VcfParseEvent]), { source: syntheticSource, sink: out.sink }))
      .rejects.toMatchObject({ code: "invalid_summary" });
    expect(out.runs).toEqual([]);
  });

  it.each(["missing", "duplicate", "data-after"])("rejects %s terminal sequence", async kind => {
    const all = await parsed(), out = capture();
    const input = kind === "missing" ? all.slice(0, -1) : [...all, kind === "duplicate" ? all.at(-1)! : all[0]];
    await expect(createPreparedRuns(values(input), { source: syntheticSource, sink: out.sink })).rejects.toMatchObject({ code: "invalid_summary" });
  });

  it("rejects an actual late repeated header after provisional runs have been acknowledged", async () => {
    const out = capture();
    async function* lines() {
      yield* syntheticHeader;
      for (let i = 0; i < 16_001; i++) yield row(i + 1);
      yield syntheticHeader[2];
    }
    await expect(createPreparedRuns(streamVcf(lines()), { source: syntheticSource, sink: out.sink })).rejects.toMatchObject({ code: "invalid_summary" });
    expect(out.runs).toHaveLength(1); expect(out.runs[0].state).toBe("provisional");
  });

  it("propagates a late input/hash failure instead of returning completion", async () => {
    const out = capture();
    async function* broken() { yield* await parsed(); throw new Error("synthetic integrity failure"); }
    await expect(createPreparedRuns(broken(), { source: syntheticSource, sink: out.sink })).rejects.toThrow("synthetic integrity failure");
    expect(out.runs).toEqual([]);
  });

  it.each(["block-error", "block-extra", "block-hash", "block-count", "block-source", "run-extra", "run-version", "run-error"])
  ("rejects sink %s and never pulls more input", async kind => {
    const out = capture(); let pulled = 0;
    const event = (await parsed([row(1)]))[0] as PreparedEvent;
    async function* input() {
      for (let i = 0; i < PREPARED_RUN_MAX_EVENTS + 1; i++) { pulled++; yield event; }
      yield terminal(Array.from({ length: PREPARED_RUN_MAX_EVENTS + 1 }, () => event));
    }
    const sink: PreparedRunSink = { ...out.sink,
      async writeBlock(block) {
        if (kind === "block-error") throw new Error("synthetic sink failure");
        if (kind === "block-extra") return { ...block.descriptor, extra: true };
        if (kind === "block-hash") return { ...block.descriptor, compressedSha256: "c".repeat(64) };
        if (kind === "block-count") return { ...block.descriptor, eventCount: 1 };
        if (kind === "block-source") return { ...block.descriptor, source: { ...block.descriptor.source, sourceRevision: 2 } };
        return block.descriptor;
      },
      async writeRun(run) {
        if (kind === "run-error") throw new Error("synthetic sink failure");
        if (kind === "run-version") return { ...run, version: "unsupported" };
        return { ...run, extra: true };
      },
    };
    await expect(createPreparedRuns(input(), { source: syntheticSource, sink })).rejects.toThrow();
    expect(pulled).toBe(PREPARED_RUN_MAX_EVENTS);
  });

  it("does not read ahead while block or run acknowledgement is pending", async () => {
    let releaseBlock!: () => void, releaseRun!: () => void, started!: () => void, runStarted!: () => void;
    const blocked = new Promise<void>(r => { releaseBlock = r; }), runBlocked = new Promise<void>(r => { releaseRun = r; });
    const entered = new Promise<void>(r => { started = r; }), runEntered = new Promise<void>(r => { runStarted = r; });
    let pulled = 0;
    const event = (await parsed([row(1)]))[0] as PreparedEvent;
    async function* input() { for (let i = 0; i < PREPARED_RUN_MAX_EVENTS; i++) { pulled++; yield event; } yield terminal(Array.from({ length: pulled }, () => event)); }
    const work = createPreparedRuns(input(), { source: syntheticSource, sink: {
      async writeBlock(b) { started(); await blocked; return b.descriptor; },
      async writeRun(r) { runStarted(); await runBlocked; return r; },
    } });
    await entered; expect(pulled).toBe(PREPARED_RUN_MAX_EVENTS);
    releaseBlock(); await runEntered; expect(pulled).toBe(PREPARED_RUN_MAX_EVENTS);
    releaseRun(); expect(await work).toMatchObject({ runCount: 1 });
  });

  it("aborts before input and while a sink or producer is pending", async () => {
    const already = new AbortController(); already.abort();
    const next = vi.fn();
    await expect(createPreparedRuns({ [Symbol.asyncIterator]: () => ({ next }) }, { source: syntheticSource, sink: capture().sink, signal: already.signal }))
      .rejects.toMatchObject({ code: "aborted" }); expect(next).not.toHaveBeenCalled();
    const producerAbort = new AbortController(), closed = vi.fn(async () => ({ done: true as const, value: undefined }));
    const pending = createPreparedRuns({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}), return: closed }) },
      { source: syntheticSource, sink: capture().sink, signal: producerAbort.signal });
    producerAbort.abort(); await expect(pending).rejects.toMatchObject({ code: "aborted" }); expect(closed).toHaveBeenCalledOnce();
    const sinkAbort = new AbortController();
    const work = createPreparedRuns(streamVcf(syntheticLines([row(1)])), { source: syntheticSource, signal: sinkAbort.signal, sink: {
      async writeBlock(_block, signal) { expect(signal).toBe(sinkAbort.signal); sinkAbort.abort(); return new Promise(() => {}); },
      writeRun: vi.fn(),
    } });
    await expect(work).rejects.toMatchObject({ code: "aborted" });
  });


  it("observes rejection when a started sink synchronously aborts and cleanup throws", async () => {
    const controller = new AbortController();
    const events = await parsed(); let index = 0;
    const close = vi.fn(() => { throw new Error("synthetic private cleanup payload"); });
    const input: AsyncIterable<VcfParseEvent> = { [Symbol.asyncIterator]: () => ({
      next: async () => index < events.length ? { done: false as const, value: events[index++] } : { done: true as const, value: undefined },
      return: close,
    }) };
    const writeRun = vi.fn();
    // Sink runs after EOF here; separately prove producer-close failure below.
    await expect(createPreparedRuns(input, { source: syntheticSource, signal: controller.signal, sink: {
      writeBlock() { controller.abort(); return Promise.reject(new Error("synthetic rejected sink")); }, writeRun,
    } })).rejects.toMatchObject({ code: "aborted", message: "aborted" });
    await new Promise<void>(resolve => setImmediate(resolve)); // Vitest reports unhandled rejections as a suite failure.
    expect(writeRun).not.toHaveBeenCalled();
    const producerAbort = new AbortController();
    const badProducer: AsyncIterable<VcfParseEvent> = { [Symbol.asyncIterator]: () => ({
      next() { producerAbort.abort(); return Promise.reject(new Error("synthetic rejected producer")); }, return: close,
    }) };
    await expect(createPreparedRuns(badProducer, { source: syntheticSource, signal: producerAbort.signal, sink: capture().sink }))
      .rejects.toMatchObject({ code: "aborted", message: "aborted" });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps an input error when asynchronous iterator cleanup also fails", async () => {
    const input: AsyncIterable<VcfParseEvent> = { [Symbol.asyncIterator]: () => ({
      next: async () => { throw new Error("synthetic source failure"); },
      return: async () => { throw new Error("synthetic private cleanup payload"); },
    }) };
    await expect(createPreparedRuns(input, { source: syntheticSource, sink: capture().sink })).rejects.toThrow("synthetic source failure");
  });

  it("rejects malformed events and a codec-oversized singleton without dropping fields", async () => {
    const original = (await parsed([row(1)]))[0] as PreparedEvent;
    await expect(createPreparedRuns(values([{ ...original, extra: true } as unknown as VcfParseEvent]), { source: syntheticSource, sink: capture().sink }))
      .rejects.toMatchObject({ code: "invalid_event" });
    const oversized: PreparedEvent = { type: "variant", line: 1, record: { rsid: null, chrom: 1, pos: 1,
      ref: "A", alt: "C".repeat(3_000_000), genotype: "C".repeat(3_000_000) } };
    await expect(createPreparedRuns(values([oversized, terminal([oversized])]), { source: syntheticSource, sink: capture().sink }))
      .rejects.toMatchObject({ code: "too_large" });
  });
});
