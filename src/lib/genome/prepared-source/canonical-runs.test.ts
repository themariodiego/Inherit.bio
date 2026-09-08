import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { streamVcf, type VcfParseEvent } from "../parsers/vcf";
import { canonicalizePreparedEvents } from "./canonical";
import { decodeCanonicalBlock } from "./canonical-codec";
import type { CanonicalRecord, CanonicalSummary } from "./canonical-schema";
import { createCanonicalRuns, compareCanonicalRecords, CANONICAL_RUN_MAX_RECORD_BYTES,
  type CanonicalRunSink, type CanonicalRunReceipt } from "./canonical-runs";
import { syntheticSource } from "./fixtures";
import type { PreparedMergeSummary } from "./merge";
import type { PreparedEvent } from "./schema";

async function* values<T>(items: T[]) { yield* items; }
const row = (pos: number, gt = "0/1", alt = "C", id = `rs${pos}`) =>
  `1\t${pos}\t${id}\tA\t${alt}\t50\tPASS\t.\tGT:GQ:DP\t${gt}:50:30`;
async function fixture(rows = [row(1), row(1), row(2, "0/0"), row(3, "./."), row(11), row(30), row(4, "0/1", "AC")],
  build: "GRCh37" | "GRCh38" = "GRCh37") {
  const source = { ...syntheticSource, sourceBuild: build };
  const input = await Array.fromAsync(streamVcf(values(["##fileformat=VCFv4.2", `##reference=${build}`,
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC", ...rows])));
  const summary = input.at(-1) as Extract<VcfParseEvent, { type: "summary" }>;
  const rank = { observed: 0, reference: 1, variant: 2 };
  const events = input.filter((e): e is PreparedEvent => e.type !== "summary").sort((a, b) => {
    const x = a.type === "variant" ? a.record : a.call, y = b.type === "variant" ? b.record : b.call;
    return x.chrom - y.chrom || x.pos - y.pos || a.line - b.line || rank[a.type] - rank[b.type];
  });
  const merge: PreparedMergeSummary = { type: "merge-summary", version: "prepared-merge-v1", state: "provisional", source,
    inputRunSequences: [0], inputBlockCount: 1, eventCount: events.length, variantCount: summary.variantCount,
    observedCallCount: summary.observedCallCount, referenceCallCount: summary.referenceCallCount };
  const chainBytes = Buffer.from("chain 1 1 1000 + 0 10 1 1000 - 100 110 1\n10\n\nchain 1 1 1000 + 10 20 1 1000 + 899 909 2\n10\n");
  const output = await Array.fromAsync(canonicalizePreparedEvents(values<PreparedEvent | PreparedMergeSummary>([...events, merge]), {
    source, expectedParserRevision: source.parserRevision, maximumUnmappedFraction: 0.5, expectedMergeSummary: merge,
    parserReceipt: { version: "prepared-runs-v1", state: "provisional", source, summary, runCount: 1, eventCount: events.length, blockCount: 1 },
    ...(build === "GRCh37" ? { liftover: { chainBytes, sha256: createHash("sha256").update(chainBytes).digest("hex") } } : {}),
  }));
  const terminal = output.at(-1) as CanonicalSummary;
  return { output, terminal, binding: terminal.binding,
    records: output.filter((r): r is CanonicalRecord => r.type === "canonical-record") };
}
function sink() {
  const runs: CanonicalRunReceipt[] = [], blocks: CanonicalRecord[][] = [];
  const callbacks: CanonicalRunSink = {
    writeBlock: vi.fn(async ({ descriptor, compressed }) => {
      blocks.push((await decodeCanonicalBlock(values([compressed]), descriptor)).records); return descriptor;
    }),
    writeRun: vi.fn(async receipt => { runs.push(receipt); return receipt; }),
  };
  return { callbacks, runs, blocks };
}

describe("initial canonical runs", () => {
  it("reorders actual GRCh37 targets, keeps collisions and all source evidence, and binds the real terminal", async () => {
    const f = await fixture(), target = sink();
    const receipt = await createCanonicalRuns(values(f.output), { binding: f.binding, sink: target.callbacks });
    expect(target.blocks.flat()).toEqual([...f.records].sort(compareCanonicalRecords));
    expect(receipt.canonicalSummary).toEqual(f.terminal);
    expect(receipt).toMatchObject({ version: "canonical-runs-v1", state: "provisional", recordCount: f.records.length, runCount: 1 });
    expect(receipt.counts).toMatchObject({ duplicateCount: 1, unmappedCount: 2, unsupportedAlleleCount: 1 });
    const normalized = target.blocks.flat().filter(r => r.normalization.status === "normalized");
    expect(normalized[0].normalization).toMatchObject({ record: { pos: 898 } });
    expect(normalized.filter(r => r.normalization.status === "normalized" && r.normalization.record.pos === 900)).toHaveLength(5);
    expect(target.runs[0]).toMatchObject({ version: "canonical-run-v1", binding: f.binding });
  });
  it("splits at 32000 records without losing the terminal or original reference records", async () => {
    const f = await fixture([row(1), ...Array.from({ length: 32000 }, (_, i) => row(i + 2, "0/0", "C", "."))], "GRCh38"), target = sink();
    const receipt = await createCanonicalRuns(values(f.output), { binding: f.binding, sink: target.callbacks });
    expect(target.runs.map(r => r.recordCount)).toEqual([32000, 2]);
    expect(receipt.recordCount).toBe(32002);
    expect(target.runs.flatMap(r => r.blocks).map(d => d.sequence)).toEqual(Array.from({ length: receipt.blockCount }, (_, i) => i));
    expect(target.runs.flatMap(r => r.blocks).every(d => d.recordCount <= 2000)).toBe(true);
  });
  it("flushes by conservative bytes and preserves a near-four-MB long-allele singleton", async () => {
    const f = await fixture([row(1, "0/1", "C".repeat(1_999_930), "."), row(2, "0/1", "G".repeat(1_999_930), ".")], "GRCh38"), target = sink();
    expect(Buffer.byteLength(JSON.stringify(f.records[0]))).toBeLessThan(CANONICAL_RUN_MAX_RECORD_BYTES);
    const result = await createCanonicalRuns(values(f.output), { binding: f.binding, sink: target.callbacks });
    expect(result.runCount).toBe(2); expect(target.blocks.flat()).toEqual(f.records);
  });
  it("splits codec byte-limited blocks within one run", async () => {
    const f = await fixture(Array.from({ length: 1100 }, (_, i) => row(i + 1).replace("PASS", "q".repeat(3900))), "GRCh38"), target = sink();
    const result = await createCanonicalRuns(values(f.output), { binding: f.binding, sink: target.callbacks });
    expect(result.runCount).toBe(1); expect(result.blockCount).toBeGreaterThan(2);
    expect(target.blocks.flat()).toEqual([...f.records].sort(compareCanonicalRecords));
  });
  it.each(["missing", "extra", "binding", "variant", "observed", "usable", "source", "version"])("refuses %s terminal without final run acknowledgement", async mode => {
    const f = await fixture(), target = sink(), output = structuredClone(f.output), terminal = output.at(-1) as CanonicalSummary;
    if (mode === "missing") output.pop();
    if (mode === "extra") output.push(f.records[0]);
    if (mode === "binding") terminal.binding.source.rawSha256 = "f".repeat(64);
    if (mode === "variant") terminal.variantCount--;
    if (mode === "observed") terminal.observedCallCount--;
    if (mode === "usable") terminal.usableObservedCount--;
    if (mode === "source") {
      terminal.mergeSummary.variantCount--; terminal.mergeSummary.observedCallCount++;
      terminal.parserReceipt.summary.variantCount--; terminal.parserReceipt.summary.observedCallCount++;
    }
    if (mode === "version") Object.assign(terminal, { version: "future" });
    await expect(createCanonicalRuns(values(output), { binding: f.binding, sink: target.callbacks })).rejects.toMatchObject({ code: "invalid_summary" });
    expect(target.runs).toEqual([]);
  });
  it("does not accept a merge summary as a canonical terminal", async () => {
    const f = await fixture(), target = sink();
    const invalid = [...f.records, { type: "canonical-merge-summary", version: "canonical-merge-summary-v1" }];
    await expect(createCanonicalRuns(values(invalid as typeof f.output), { binding: f.binding, sink: target.callbacks }))
      .rejects.toMatchObject({ code: "invalid_event" });
  });
  it.each(["block", "run"])("requires an exact %s acknowledgement", async kind => {
    const f = await fixture(), target = sink();
    if (kind === "block") target.callbacks.writeBlock = async ({ descriptor }) => ({ ...descriptor, decodedSha256: "f".repeat(64) });
    else target.callbacks.writeRun = async receipt => ({ ...receipt, recordCount: receipt.recordCount + 1 });
    await expect(createCanonicalRuns(values(f.output), { binding: f.binding, sink: target.callbacks })).rejects.toMatchObject({ code: "ack_mismatch" });
  });
  it("holds a byte-flush boundary until block and durable run acknowledgements finish", async () => {
    const f = await fixture([row(1, "0/1", "C".repeat(1_999_930), "."), row(2, "0/1", "G".repeat(1_999_930), ".")], "GRCh38");
    const entered = Promise.withResolvers<void>(), blockGate = Promise.withResolvers<void>(), runEntered = Promise.withResolvers<void>(), runGate = Promise.withResolvers<void>();
    let reads = 0;
    async function* input() { for (const event of f.output) { reads++; yield event; } }
    const result = createCanonicalRuns(input(), { binding: f.binding, sink: {
      writeBlock: async ({ descriptor }) => { entered.resolve(); await blockGate.promise; return descriptor; },
      writeRun: async receipt => { runEntered.resolve(); await runGate.promise; return receipt; },
    } });
    await entered.promise; expect(reads).toBe(2); blockGate.resolve();
    await runEntered.promise; expect(reads).toBe(2); runGate.resolve();
    expect((await result).recordCount).toBe(2);
  });
  it("requires EOF after terminal and propagates late integrity failure", async () => {
    const f = await fixture(), target = sink(), failure = new Error("source hash mismatch");
    async function* input() { yield* f.output; throw failure; }
    await expect(createCanonicalRuns(input(), { binding: f.binding, sink: target.callbacks })).rejects.toBe(failure);
    expect(target.runs).toEqual([]);
  });
  it("observes sync-aborted sink rejection and preserves it over cleanup errors", async () => {
    const f = await fixture([row(1, "0/1", "C".repeat(1_999_930), "."), row(2, "0/1", "G".repeat(1_999_930), ".")], "GRCh38");
    const controller = new AbortController(); let i = 0, closed = false;
    const input = { [Symbol.asyncIterator]: () => ({ next: async () => i < f.output.length
      ? { value: f.output[i++], done: false as const } : { value: undefined, done: true as const },
    return: () => { closed = true; throw new Error("cleanup"); } }) };
    await expect(createCanonicalRuns(input, { binding: f.binding, signal: controller.signal, sink: {
      writeBlock: () => { controller.abort(); return Promise.reject(new Error("sink failure")); }, writeRun: async r => r,
    } })).rejects.toMatchObject({ code: "aborted" });
    expect(closed).toBe(true); expect(i).toBe(2);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  it("cancels a pending source read and requests cleanup without blocking on it", async () => {
    const f = await fixture(), controller = new AbortController(), gate = Promise.withResolvers<IteratorResult<CanonicalRecord>>();
    const closing = vi.fn(() => new Promise<IteratorResult<CanonicalRecord>>(() => {}));
    const input = { [Symbol.asyncIterator]: () => ({ next: () => gate.promise, return: closing }) };
    const result = createCanonicalRuns(input, { binding: f.binding, signal: controller.signal, sink: sink().callbacks });
    controller.abort(); await expect(result).rejects.toMatchObject({ code: "aborted" });
    expect(closing).toHaveBeenCalledOnce(); gate.reject(new Error("late rejection"));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
});
