import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { streamVcf, type VcfParseEvent } from "../parsers/vcf";
import { canonicalizePreparedEvents } from "./canonical";
import { createCanonicalRuns, type CanonicalRunReceipt } from "./canonical-runs";
import { mergeCanonicalRuns, type CanonicalMergeSummary } from "./canonical-merge";
import { materializeCanonicalMerge, type CanonicalContainerDirectory } from "./materialize-canonical";
import { decodeCanonicalBlock } from "./canonical-codec";
import { createCanonicalRsidRuns, mergeCanonicalRsidRuns, type CanonicalRsidRunReceipt,
  type CanonicalRsidPointer } from "./canonical-rsid-index";
import { selectCanonicalCoordinateBlocks, type CanonicalCoordinateIndex } from "./canonical-coordinate-index";
import { verifyCanonicalContainerBytes } from "./canonical-containers";
import { syntheticSource, syntheticHeader } from "./fixtures";
import type { CanonicalRecord, CanonicalSummary } from "./canonical-schema";
import type { PreparedEvent } from "./schema";
import type { PreparedMergeSummary } from "./merge";
import type { PreparedStoredArtifact } from "./storage-writer";

async function* values<T>(items: T[]) { yield* items; }
const jobId = "33333333-3333-4333-8333-333333333333", attemptId = "44444444-4444-4444-8444-444444444444";
const row = (pos: number, gt = "0/1", alt = "C") => `1\t${pos}\trs${pos}\tA\t${alt}\t50\tPASS\t.\tGT:GQ:DP\t${gt}:50:30`;
async function fixture(rows = [row(1), row(1), row(2, "0/0"), row(3, "./."), row(4, "0/1", "AC")], build: "GRCh37" | "GRCh38" = "GRCh38") {
  const source = { ...syntheticSource, sourceBuild: build };
  const chainBytes = Buffer.from("chain 1 1 1000 + 0 10 1 1000 + 100 110 1\n10\n");
  const parsed = await Array.fromAsync(streamVcf(values([...syntheticHeader.map(line => line.replace("GRCh38", build)), ...rows])));
  const summary = parsed.at(-1) as Extract<VcfParseEvent, { type: "summary" }>;
  const rank = { observed: 0, reference: 1, variant: 2 };
  const events = parsed.filter((event): event is PreparedEvent => event.type !== "summary").sort((a, b) => {
    const x = a.type === "variant" ? a.record : a.call, y = b.type === "variant" ? b.record : b.call;
    return x.chrom - y.chrom || x.pos - y.pos || a.line - b.line || rank[a.type] - rank[b.type];
  });
  const merge: PreparedMergeSummary = { type: "merge-summary", version: "prepared-merge-v1", state: "provisional", source,
    inputRunSequences: [0], inputBlockCount: 1, eventCount: events.length, variantCount: summary.variantCount,
    observedCallCount: summary.observedCallCount, referenceCallCount: summary.referenceCallCount };
  const canonical = await Array.fromAsync(canonicalizePreparedEvents(values<PreparedEvent | PreparedMergeSummary>([...events, merge]), {
    source, expectedParserRevision: source.parserRevision, maximumUnmappedFraction: 0.5, expectedMergeSummary: merge,
    ...(build === "GRCh37" ? { liftover: { chainBytes, sha256: createHash("sha256").update(chainBytes).digest("hex") } } : {}),
    parserReceipt: { version: "prepared-runs-v1", state: "provisional", source, summary, runCount: 1, eventCount: events.length, blockCount: 1 },
  }));
  const canonicalSummary = canonical.at(-1) as CanonicalSummary, binding = canonicalSummary.binding;
  const blocks = new Map<number, Uint8Array>(), runs: CanonicalRunReceipt[] = [];
  await createCanonicalRuns(values(canonical), { binding, sink: {
    writeBlock: async block => { blocks.set(block.descriptor.sequence, block.compressed); return block.descriptor; },
    writeRun: async receipt => { runs.push(receipt); return receipt; },
  } });
  const output = await Array.fromAsync(mergeCanonicalRuns(runs, { binding, readBlock: descriptor => values([blocks.get(descriptor.sequence)!]) }));
  return { output, binding, canonicalSummary, records: output.filter((r): r is CanonicalRecord => r.type === "canonical-record") };
}
function sink() {
  const objects = new Map<string, Uint8Array>();
  const writeArtifact = vi.fn<Parameters<typeof materializeCanonicalMerge>[1]["writeArtifact"]>(async ({ descriptor, bytes }) => {
    const objectKey = `prepared/${randomUUID()}`;
    objects.set(objectKey, Uint8Array.from(bytes));
    return { receipt: { version: "own-preparation-artifact-v1", artifactId: randomUUID(), jobId, attemptId,
      sequence: descriptor.sequence, bucket: "genomes", objectKey, byteCount: bytes.length, sha256: descriptor.sha256,
      writeExpiresAt: "2026-09-08T20:00:00Z" }, storageObjectId: randomUUID() };
  });
  return { objects, writeArtifact };
}

// The in-memory sink verifies the composition/receipt boundary. It is not
// evidence of provider durability: the actual Storage primitive has its own
// separately recorded local integration proof.
describe("canonical materialization into registered objects", () => {
  it("roundtrips actual parser/canonical/merge output, preserves all evidence, and looks up a chosen coordinate", async () => {
    const f = await fixture(), out = sink();
    const result = await materializeCanonicalMerge(values(f.output), { ...f, ...out, jobId, attemptId, firstArtifactSequence: 7 });
    expect(result).toMatchObject({ state: "provisional", recordCount: f.records.length, blockCount: 1,
      containerCount: 1, artifactCount: 3, firstArtifactSequence: 7, nextArtifactSequence: 10 });
    expect(result.canonicalSummary).toEqual(f.canonicalSummary); expect(result.mergeSummary).toEqual(f.output.at(-1));
    expect(out.writeArtifact.mock.calls.map(([input]) => input.descriptor.sequence)).toEqual([7, 8, 9]);
    const directory = JSON.parse(Buffer.from(out.objects.get(result.directories[0].artifact.receipt.objectKey)!).toString()) as CanonicalContainerDirectory;
    const stored = directory.containers[0], bytes = out.objects.get(stored.artifact.receipt.objectKey)!;
    verifyCanonicalContainerBytes(bytes, stored.descriptor);
    const page = JSON.parse(Buffer.from(out.objects.get(result.coordinatePages[0].artifact.receipt.objectKey)!).toString()) as CanonicalCoordinateIndex;
    const selected = selectCanonicalCoordinateBlocks(page, [{ chrom: 1, pos: 2 }], f.binding);
    expect(selected).toHaveLength(1);
    const decoded = await decodeCanonicalBlock(values([bytes]), selected[0]);
    expect(decoded.records).toEqual(f.records);
    const matched = decoded.records.filter(r => r.normalization.status === "normalized" && r.normalization.record.pos === 2);
    expect(matched).toHaveLength(1); expect(matched[0].event).toMatchObject({ type: "observed", call: { genotype: "A/A" } });
    expect(decoded.records.some(r => r.normalization.status === "duplicate")).toBe(true);
    for (const [input] of out.writeArtifact.mock.calls) expect(createHash("sha256").update(input.bytes).digest("hex")).toBe(input.descriptor.sha256);
  });

  it.each(["C", "AC"])("preserves distinct source-locus and record-disposition counts for GRCh37 %s alleles", async alt => {
    const f = await fixture([row(1), row(30, "0/1", alt)], "GRCh37"), out = sink();
    const result = await materializeCanonicalMerge(values(f.output), { ...f, ...out, jobId, attemptId });
    expect(result.canonicalSummary).toMatchObject({ attempted: 2, unmapped: 1 });
    expect(result.counts.unmappedCount).toBe(alt === "C" ? 2 : 0);
    expect(result.counts.unsupportedAlleleCount).toBe(alt === "AC" ? 1 : 0);
    expect(result.mergeSummary).toEqual(f.output.at(-1));
  });

  it("splits at 2000 records and reads only the block overlapping the chosen locus", async () => {
    const f = await fixture(Array.from({ length: 1100 }, (_, i) => row(i + 1))), out = sink();
    const result = await materializeCanonicalMerge(values(f.output), { ...f, ...out, jobId, attemptId });
    expect(result.blockCount).toBe(2);
    const page = JSON.parse(Buffer.from(out.objects.get(result.coordinatePages[0].artifact.receipt.objectKey)!).toString());
    const blocks = selectCanonicalCoordinateBlocks(page, [{ chrom: 1, pos: 1050 }], f.binding);
    expect(blocks.map(d => d.sequence)).toEqual([1]);
    const directory = JSON.parse(Buffer.from(out.objects.get(result.directories[0].artifact.receipt.objectKey)!).toString()) as CanonicalContainerDirectory;
    const container = directory.containers[0], range = container.descriptor.blocks[1], bytes = out.objects.get(container.artifact.receipt.objectKey)!;
    expect((await decodeCanonicalBlock(values([bytes.subarray(range.offset, range.offset + range.length)]), blocks[0])).records).toHaveLength(200);
  });

  it("indexes original rsIDs from the materialized bytes and dereferences every retained pointer", async () => {
    const f = await fixture(), out = sink();
    const result = await materializeCanonicalMerge(values(f.output), { ...f, ...out, jobId, attemptId });
    const directory = JSON.parse(Buffer.from(out.objects.get(result.directories[0].artifact.receipt.objectKey)!).toString()) as CanonicalContainerDirectory;
    async function* canonicalBlocks() {
      for (const container of directory.containers) {
        const bytes = out.objects.get(container.artifact.receipt.objectKey)!;
        for (const range of container.descriptor.blocks) yield { descriptor: range.descriptor,
          bytes: values([bytes.subarray(range.offset, range.offset + range.length)]) };
      }
    }
    const runs: CanonicalRsidRunReceipt[] = [], encoded = new Map<number, Uint8Array>();
    const scan = await createCanonicalRsidRuns(canonicalBlocks(), { binding: f.binding, sink: {
      writeBlock: async block => { encoded.set(block.descriptor.sequence, block.compressed); return block.descriptor; },
      writeRun: async receipt => { runs.push(receipt); return receipt; },
    } });
    expect(scan.canonicalBlockCount).toBe(result.blockCount); expect(scan.canonicalRecordCount).toBe(result.recordCount);
    const merged = await Array.fromAsync(mergeCanonicalRsidRuns(runs, { binding: f.binding,
      readBlock: descriptor => values([encoded.get(descriptor.sequence)!]) }));
    const pointers = merged.filter((p): p is CanonicalRsidPointer => !("type" in p));
    const expected = f.records.flatMap((record, recordOffset) => {
      const event = record.event, rsid = event.type === "reference" ? null : (event.type === "variant" ? event.record : event.call).rsid;
      return rsid === null ? [] : [{ rsid, blockSequence: 0, recordOffset }];
    }).sort((a, b) => a.rsid - b.rsid || a.recordOffset - b.recordOffset);
    expect(pointers).toEqual(expected); expect(scan.pointerCount).toBe(expected.length);
    expect(merged.at(-1)).toMatchObject({ type: "rsid-merge-summary", pointerCount: expected.length });
    expect(pointers.some(p => f.records[p.recordOffset].normalization.status === "duplicate")).toBe(true);
    expect(pointers.some(p => f.records[p.recordOffset].event.type === "observed" &&
      f.records[p.recordOffset].normalization.status === "normalized" &&
      (f.records[p.recordOffset].event as Extract<PreparedEvent, { type: "observed" }>).call.genotype === "A/A")).toBe(true);
  });

  it.each(["missing", "extra", "count", "binding", "canonical-count", "wrong-terminal"])("refuses %s terminal before committing the final objects", async mode => {
    const f = await fixture(), out = sink(), output = structuredClone(f.output), canonicalSummary = structuredClone(f.canonicalSummary);
    if (mode === "missing") output.pop();
    if (mode === "extra") output.push(f.records[0]);
    if (mode === "count") (output.at(-1) as CanonicalMergeSummary).counts.duplicateCount++;
    if (mode === "binding") (output.at(-1) as CanonicalMergeSummary).binding.source.sourceRevision++;
    if (mode === "canonical-count") canonicalSummary.variantCount--;
    if (mode === "wrong-terminal") Object.assign(output.at(-1)!, canonicalSummary);
    await expect(materializeCanonicalMerge(values(output), { ...f, ...out, canonicalSummary, jobId, attemptId })).rejects.toBeInstanceOf(Error);
    expect(out.objects.size).toBe(0);
  });

  it("requires real EOF after the merge terminal, including a failed iterator", async () => {
    const f = await fixture(), out = sink();
    async function* broken() { yield* f.output; throw new Error("synthetic late source failure"); }
    await expect(materializeCanonicalMerge(broken(), { ...f, ...out, jobId, attemptId })).rejects.toThrow("synthetic late source failure");
    expect(out.objects.size).toBe(0);
  });

  it("rejects target disorder without silently sorting away a broken merge", async () => {
    const f = await fixture(), out = sink(), output = [...f.output];
    [output[0], output[2]] = [output[2], output[0]];
    await expect(materializeCanonicalMerge(values(output), { ...f, ...out, jobId, attemptId })).rejects.toMatchObject({ code: "out_of_order" });
  });

  it.each(["job", "attempt", "sequence", "hash", "bytes", "object", "mutation", "unknown-field"])("refuses %s writer acknowledgement", async mode => {
    const f = await fixture(), out = sink(), actual = out.writeArtifact.getMockImplementation()!;
    out.writeArtifact.mockImplementation(async (input, signal) => {
      const ack = await actual(input, signal);
      if (mode === "job") ack.receipt.jobId = randomUUID();
      if (mode === "attempt") ack.receipt.attemptId = randomUUID();
      if (mode === "sequence") ack.receipt.sequence++;
      if (mode === "hash") ack.receipt.sha256 = "f".repeat(64);
      if (mode === "bytes") ack.receipt.byteCount++;
      if (mode === "object") ack.storageObjectId = "invalid";
      if (mode === "mutation") input.bytes[0] ^= 1;
      if (mode === "unknown-field") Object.assign(ack, { public: true });
      return ack;
    });
    await expect(materializeCanonicalMerge(values(f.output), { ...f, ...out, jobId, attemptId })).rejects.toMatchObject({ code: "ack_mismatch" });
    expect(out.writeArtifact).toHaveBeenCalledTimes(1); // Uncertain object remains cleanup-owned.
  });

  it.each(["artifact", "object", "key"])("refuses reused %s identity across distinct writes", async mode => {
    const f = await fixture(), out = sink(), actual = out.writeArtifact.getMockImplementation()!;
    let first: PreparedStoredArtifact | undefined;
    out.writeArtifact.mockImplementation(async (input, signal) => {
      const ack = await actual(input, signal);
      if (first) {
        if (mode === "artifact") ack.receipt.artifactId = first.receipt.artifactId;
        if (mode === "object") ack.storageObjectId = first.storageObjectId;
        if (mode === "key") ack.receipt.objectKey = first.receipt.objectKey;
      } else first = structuredClone(ack);
      return ack;
    });
    await expect(materializeCanonicalMerge(values(f.output), { ...f, ...out, jobId, attemptId })).rejects.toMatchObject({ code: "ack_mismatch" });
    expect(out.writeArtifact).toHaveBeenCalledTimes(2);
  });

  it("stops at the job artifact limit before another reservation", async () => {
    const f = await fixture(), out = sink();
    await expect(materializeCanonicalMerge(values(f.output), { ...f, ...out, jobId, attemptId, firstArtifactSequence: 4095 })).rejects.toMatchObject({ code: "too_large" });
    expect(out.writeArtifact).toHaveBeenCalledTimes(1);
  });

  it("cancels a stalled writer without starting later writes or releasing a receipt", async () => {
    const f = await fixture(), out = sink(), controller = new AbortController(), entered = Promise.withResolvers<void>();
    out.writeArtifact.mockImplementation(async () => { entered.resolve(); return new Promise(() => {}); });
    const pending = materializeCanonicalMerge(values(f.output), { ...f, ...out, jobId, attemptId, signal: controller.signal });
    await entered.promise; controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" }); expect(out.writeArtifact).toHaveBeenCalledTimes(1);
  });

  it("cancels a stalled input and asks its iterator to close", async () => {
    const f = await fixture(), out = sink(), controller = new AbortController(), entered = Promise.withResolvers<void>();
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    const input = { [Symbol.asyncIterator]: () => ({ next: () => { entered.resolve(); return new Promise<IteratorResult<CanonicalRecord | CanonicalMergeSummary>>(() => {}); }, return: close }) };
    const pending = materializeCanonicalMerge(input, { ...f, ...out, jobId, attemptId, signal: controller.signal });
    await entered.promise; controller.abort(); await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(close).toHaveBeenCalledTimes(1); expect(out.writeArtifact).not.toHaveBeenCalled();
  });
});
