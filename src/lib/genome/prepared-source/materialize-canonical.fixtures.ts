import { createHash, randomUUID } from "node:crypto";
import { vi } from "vitest";
import { streamVcf, type VcfParseEvent } from "../parsers/vcf";
import { canonicalizePreparedEvents } from "./canonical";
import { createCanonicalRuns, type CanonicalRunReceipt } from "./canonical-runs";
import { mergeCanonicalRuns } from "./canonical-merge";
import type { materializeCanonicalMerge } from "./materialize-canonical";
import { syntheticSource, syntheticHeader } from "./fixtures";
import type { CanonicalRecord, CanonicalSummary } from "./canonical-schema";
import type { PreparedEvent } from "./schema";
import type { PreparedMergeSummary } from "./merge";

// Synthetic parser-to-materialization setup shared by focused integration tests.
export async function* values<T>(items: T[]) { yield* items; }
export const jobId = "33333333-3333-4333-8333-333333333333", attemptId = "44444444-4444-4444-8444-444444444444";
export const row = (pos: number, gt = "0/1", alt = "C") => `1\t${pos}\trs${pos}\tA\t${alt}\t50\tPASS\t.\tGT:GQ:DP\t${gt}:50:30`;
export async function fixture(rows = [row(1), row(1), row(2, "0/0"), row(3, "./."), row(4, "0/1", "AC")], build: "GRCh37" | "GRCh38" = "GRCh38", suppliedChain?: Uint8Array) {
  const source = { ...syntheticSource, sourceBuild: build };
  const chainBytes = suppliedChain ?? Buffer.from("chain 1 1 1000 + 0 10 1 1000 + 100 110 1\n10\n");
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
export function sink() {
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
