import { describe, expect, it, vi } from "vitest";
import { encodeCanonicalBlock, type CanonicalBlockDescriptor } from "./canonical-codec";
import type { CanonicalBinding, CanonicalRecord } from "./canonical-schema";
import { mergeCanonicalRuns, type CanonicalMergeSummary } from "./canonical-merge";
import { compareCanonicalRecords, type CanonicalRunReceipt } from "./canonical-runs";
import { syntheticSource } from "./fixtures";

const binding: CanonicalBinding = { version: "prepared-canonical-v1", source: { ...syntheticSource, sourceBuild: "GRCh37" },
  targetBuild: "GRCh38", liftoverSha256: "f".repeat(64) };
function record(sourcePos: number, targetPos: number, line = sourcePos + 3): CanonicalRecord {
  const original = { rsid: sourcePos, chrom: 1, pos: sourcePos, ref: "A", alt: "C", genotype: "A/C" };
  return { type: "canonical-record", version: "prepared-canonical-v1", event: { type: "variant", line, record: original },
    normalization: { status: "normalized", record: { ...original, pos: targetPos } } };
}
function observed(sourcePos: number, targetPos: number, filter = "PASS"): CanonicalRecord {
  const original = record(sourcePos, targetPos), call = original.event.type === "variant" ? original.event.record : null;
  if (!call) throw new Error("fixture");
  return { ...original, event: { type: "observed", line: original.event.line, call: { ...call, line: original.event.line,
    sourceGt: "0/1", filter, sampleFilter: null, genotypeQuality: null, depth: null, quality: "unknown", usable: false } } };
}
async function* chunks(bytes: Uint8Array) { yield bytes; }
async function setup(groups: CanonicalRecord[][][]) {
  const runs: CanonicalRunReceipt[] = [], bytes = new Map<number, Uint8Array>(); let sequence = 0;
  for (const group of groups) {
    const blocks: CanonicalBlockDescriptor[] = [];
    for (const records of group) {
      const block = await encodeCanonicalBlock({ binding, sequence: sequence++, records });
      blocks.push(block.descriptor); bytes.set(block.descriptor.sequence, block.compressed);
    }
    runs.push({ version: "canonical-run-v1", state: "provisional", binding, sequence: runs.length,
      recordCount: group.flat().length, blocks });
  }
  const readBlock = vi.fn((descriptor: CanonicalBlockDescriptor) => chunks(bytes.get(descriptor.sequence)!));
  return { runs, bytes, readBlock };
}
async function collect(f: Awaited<ReturnType<typeof setup>>, runs = f.runs) {
  return Array.fromAsync(mergeCanonicalRuns(runs, { binding, readBlock: f.readBlock }));
}

describe("canonical target-order merge", () => {
  it("orders targets then original coordinates, retaining collisions, duplicates and every source-only disposition", async () => {
    const duplicate = record(2, 30, 10); duplicate.normalization = { status: "duplicate", firstSourceLine: 5 };
    const unmapped = observed(4, 10); unmapped.normalization = { status: "unmapped" };
    const unsupported = record(5, 1); unsupported.normalization = { status: "unsupported_alleles" };
    const reference: CanonicalRecord = { type: "canonical-record", version: "prepared-canonical-v1",
      event: { type: "reference", line: 9, call: { chrom: 1, pos: 6, ref: "A", genotype: "A/A" } },
      normalization: { status: "source_reference" } };
    const a = [record(3, 10), record(1, 30), duplicate, reference].sort(compareCanonicalRecords);
    const b = [observed(3, 10), record(2, 10), unmapped, unsupported].sort(compareCanonicalRecords);
    const f = await setup([[a.slice(0, 2), a.slice(2)], [b.slice(0, 2), b.slice(2)]]);
    const output = await collect(f), summary = output.at(-1) as CanonicalMergeSummary;
    expect(output.slice(0, -1)).toEqual([...a, ...b].sort(compareCanonicalRecords));
    expect(summary).toMatchObject({ type: "canonical-merge-summary", version: "canonical-merge-summary-v1", state: "provisional",
      binding, inputRunSequences: [0, 1], inputBlockCount: 4, recordCount: 8,
      counts: { sourceVariantCount: 5, sourceObservedCount: 2, sourceReferenceCount: 1,
        normalizedVariantCount: 3, normalizedObservedCount: 1, duplicateCount: 1, unmappedCount: 1, unsupportedAlleleCount: 1 } });
    expect(output.some(r => (r.type as string) === "canonical-summary")).toBe(false);
  });
  it("uses input run sequence for stable equal keys even when receipt arguments are reversed", async () => {
    const first = observed(1, 10, "first"), second = observed(1, 10, "second");
    const f = await setup([[[first]], [[second]]]);
    expect((await collect(f, [...f.runs].reverse())).slice(0, -1)).toEqual([first, second]);
  });
  it("supports a later merge pass without fabricating a canonical terminal", async () => {
    const records = [record(1, 90), record(2, 30), record(3, 60), record(4, 10)];
    const first = await setup(records.map(r => [[r]]));
    const left = await collect(first, first.runs.slice(0, 2)), right = await collect(first, first.runs.slice(2));
    expect(left.at(-1)?.type).toBe("canonical-merge-summary"); expect(right.at(-1)?.type).toBe("canonical-merge-summary");
    // Test-only durable adapter materializes each verified merged run. It retains
    // each merge receipt separately, never passes it as an initial canonical summary.
    const next = await setup([[left.slice(0, -1) as CanonicalRecord[]], [right.slice(0, -1) as CanonicalRecord[]]]);
    expect((await collect(next)).slice(0, -1)).toEqual([...records].sort(compareCanonicalRecords));
  });
  it("keeps <=one decoded block per input and does not prefetch while consumer is paused", async () => {
    const f = await setup([[[record(1, 1)], [record(3, 3)]], [[record(2, 2)], [record(4, 4)]]]);
    const iterator = mergeCanonicalRuns(f.runs, { binding, readBlock: f.readBlock });
    expect((await iterator.next()).value).toEqual(record(1, 1)); expect(f.readBlock).toHaveBeenCalledTimes(2);
    await new Promise(resolve => setTimeout(resolve, 0)); expect(f.readBlock).toHaveBeenCalledTimes(2);
    expect((await iterator.next()).value).toEqual(record(2, 2)); expect(f.readBlock).toHaveBeenCalledTimes(3);
    await iterator.return(); expect(f.readBlock).toHaveBeenCalledTimes(3);
  });
  it("handles all eight inputs", async () => {
    const records = Array.from({ length: 8 }, (_, i) => record(i + 1, 8 - i));
    const f = await setup(records.map(r => [[r]]));
    expect((await collect(f)).slice(0, -1)).toEqual([...records].sort(compareCanonicalRecords));
  });
  it.each(["empty", "nine", "duplicate-run", "duplicate-block", "duplicate-hash", "gap", "overlap", "count", "binding", "version", "extra", "too-many-blocks"])(
    "rejects %s receipt before reading bytes", async mode => {
      const f = await setup([[[record(1, 1)], [record(2, 2)]], [[record(3, 3)]]]);
      let runs = structuredClone(f.runs);
      switch (mode) {
        case "empty": runs = []; break;
        case "nine": runs = Array.from({ length: 9 }, () => runs[0]); break;
        case "duplicate-run": runs[1].sequence = runs[0].sequence; break;
        case "duplicate-block": runs[1].blocks[0] = structuredClone(runs[0].blocks[0]); break;
        case "duplicate-hash": runs[1].blocks[0].compressedSha256 = runs[0].blocks[0].compressedSha256; break;
        case "gap": runs[0].blocks[1].sequence++; break;
        case "overlap": [runs[0].sequence, runs[1].sequence] = [runs[1].sequence, runs[0].sequence]; break;
        case "count": runs[0].recordCount++; break;
        case "binding": runs[0].binding.source.rawSha256 = "a".repeat(63) + "f"; break;
        case "version": Object.assign(runs[0], { version: "future" }); break;
        case "extra": Object.assign(runs[0], { extra: true }); break;
        case "too-many-blocks": runs[0].blocks = Array.from({ length: 32001 }, () => runs[0].blocks[0]); break;
      }
      await expect(collect(f, runs)).rejects.toMatchObject({ code: "invalid_receipt" }); expect(f.readBlock).not.toHaveBeenCalled();
    });
  it.each(["within-block", "between-blocks", "source-before-normalized"])("refuses %s ordering even when block hashes are valid", async mode => {
    const source = record(1, 1); source.normalization = { status: "unmapped" };
    const group = mode === "within-block" ? [[record(2, 2), record(1, 1)]] : mode === "between-blocks"
      ? [[record(2, 2)], [record(1, 1)]] : [[source, record(1, 1)]];
    const f = await setup([group]);
    await expect(collect(f)).rejects.toMatchObject({ code: "out_of_order" });
  });
  it("rejects a structurally valid receipt over four MB before any object read", async () => {
    const f = await setup([[[record(1, 1)]]]), run = structuredClone(f.runs[0]);
    run.blocks = Array.from({ length: 8000 }, (_, sequence) => ({ ...run.blocks[0], sequence,
      compressedSha256: sequence.toString(16).padStart(64, "0") }));
    run.recordCount = run.blocks.length;
    expect(Buffer.byteLength(JSON.stringify(run))).toBeGreaterThan(4_000_000);
    await expect(collect(f, [run])).rejects.toMatchObject({ code: "invalid_receipt" });
    expect(f.readBlock).not.toHaveBeenCalled();
  });
  it("refuses late block hash failure without a merge terminal", async () => {
    const f = await setup([[[record(1, 1)], [record(2, 2)]]]); f.runs[0].blocks[1].decodedSha256 = "0".repeat(64);
    const emitted: unknown[] = [];
    await expect((async () => { for await (const r of mergeCanonicalRuns(f.runs, { binding, readBlock: f.readBlock })) emitted.push(r); })())
      .rejects.toMatchObject({ code: "integrity_mismatch" });
    expect(emitted).toEqual([record(1, 1)]);
  });
  it("requires actual byte EOF and rejects missing objects", async () => {
    const f = await setup([[[record(1, 1)]]]);
    async function* errorAfterBytes(d: CanonicalBlockDescriptor) { yield f.bytes.get(d.sequence)!; throw new Error("EOF failure"); }
    await expect(Array.fromAsync(mergeCanonicalRuns(f.runs, { binding, readBlock: errorAfterBytes }))).rejects.toMatchObject({ code: "invalid_block" });
    await expect(Array.fromAsync(mergeCanonicalRuns(f.runs, { binding, readBlock: async () => { throw new Error("object missing"); } })))
      .rejects.toThrow("object missing");
  });
  it("preserves a long-allele record through a decoded block", async () => {
    const r = record(1, 1);
    if (r.event.type === "variant" && r.normalization.status === "normalized") {
      r.event.record.alt = "C".repeat(1_999_930); r.event.record.genotype = `A/${r.event.record.alt}`;
      r.normalization.record = { ...r.event.record };
    }
    const f = await setup([[[r]]]); expect((await collect(f))[0]).toEqual(r);
  });
  it("aborts before reads and observes synchronous readBlock abort/rejection", async () => {
    const f = await setup([[[record(1, 1)]]]), early = new AbortController(); early.abort();
    await expect(Array.fromAsync(mergeCanonicalRuns(f.runs, { binding, readBlock: f.readBlock, signal: early.signal })))
      .rejects.toMatchObject({ code: "aborted" }); expect(f.readBlock).not.toHaveBeenCalled();
    const active = new AbortController();
    await expect(Array.fromAsync(mergeCanonicalRuns(f.runs, { binding, signal: active.signal, readBlock: () => {
      active.abort(); return Promise.reject(new Error("started rejection"));
    } }))).rejects.toMatchObject({ code: "aborted" });
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  it("propagates signal into the decoder and closes a pending byte stream", async () => {
    const f = await setup([[[record(1, 1)]]]), controller = new AbortController(), entered = Promise.withResolvers<void>(); let closed = false;
    async function* readBlock(d: CanonicalBlockDescriptor, signal?: AbortSignal) {
      expect(signal).toBe(controller.signal);
      try { yield f.bytes.get(d.sequence)!.subarray(0, 10); entered.resolve();
        await new Promise<void>(resolve => signal!.addEventListener("abort", () => resolve(), { once: true }));
      } finally { closed = true; }
    }
    const result = Array.fromAsync(mergeCanonicalRuns(f.runs, { binding, signal: controller.signal, readBlock }));
    await entered.promise; controller.abort(); await expect(result).rejects.toMatchObject({ code: "aborted" });
    await new Promise(resolve => setTimeout(resolve, 0)); expect(closed).toBe(true);
  });
});
