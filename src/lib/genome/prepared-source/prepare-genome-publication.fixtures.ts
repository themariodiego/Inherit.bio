import { createHash } from "node:crypto";
import { vi } from "vitest";
import { fixture, row, values, sink, jobId, attemptId } from "./materialize-canonical.fixtures";
import { materializeCanonicalMerge, type CanonicalContainerDirectory } from "./materialize-canonical";
import { createCanonicalRsidRuns, mergeCanonicalRsidRuns, type CanonicalRsidRunReceipt } from "./canonical-rsid-index";
import { materializeCanonicalRsidMerge, type CanonicalRsidMaterializationReceipt } from "./materialize-canonical-rsid";
import type { PreparedStoredArtifact } from "./storage-writer";

export async function publicationFixture(rows = [row(1), row(1), row(2, "0/0"), row(3, "./.")], build: "GRCh37" | "GRCh38" = "GRCh38", scratchGap = 0) {
  const f = await fixture(rows, build), out = sink();
  const canonical = await materializeCanonicalMerge(values(f.output), { ...f, ...out, jobId, attemptId });
  async function* blocks() {
    for (const ref of canonical.directories) {
      const page = JSON.parse(Buffer.from(out.objects.get(ref.artifact.receipt.objectKey)!).toString()) as CanonicalContainerDirectory;
      for (const container of page.containers) {
        const bytes = out.objects.get(container.artifact.receipt.objectKey)!;
        for (const range of container.descriptor.blocks) yield { descriptor: range.descriptor,
          bytes: values([bytes.subarray(range.offset, range.offset + range.length)]) };
      }
    }
  }
  const runs: CanonicalRsidRunReceipt[] = [], encoded = new Map<number, Uint8Array>();
  const scan = await createCanonicalRsidRuns(blocks(), { binding: f.binding, sink: {
    writeBlock: async block => { encoded.set(block.descriptor.sequence, block.compressed); return block.descriptor; },
    writeRun: async receipt => { runs.push(receipt); return receipt; },
  } });
  const stream = scan.pointerCount ? mergeCanonicalRsidRuns(runs, { binding: f.binding,
    readBlock: descriptor => values([encoded.get(descriptor.sequence)!]) }) : values([]);
  const expected = { binding: f.binding, jobId, attemptId, canonicalBlockCount: canonical.blockCount,
    canonicalRecordCount: canonical.recordCount, firstArtifactSequence: canonical.nextArtifactSequence + scratchGap };
  const scratch: PreparedStoredArtifact[] = [];
  for (let sequence = canonical.nextArtifactSequence; sequence < expected.firstArtifactSequence; sequence++) {
    const bytes = Buffer.from("synthetic intermediate");
    scratch.push(await out.writeArtifact({ descriptor: { kind: "container", sequence,
      byteCount: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }, bytes }));
  }
  const root = await materializeCanonicalRsidMerge(stream, { ...expected, expectedScan: scan, writeArtifact: out.writeArtifact });
  const readArtifact = vi.fn<(artifact: PreparedStoredArtifact, signal: AbortSignal) => AsyncIterable<Uint8Array>>(artifact => {
    const bytes = out.objects.get(artifact.receipt.objectKey); if (!bytes) throw new Error("synthetic unavailable");
    return values([bytes.subarray(0, 3), bytes.subarray(3)]);
  });
  const check = vi.fn<(root: CanonicalRsidMaterializationReceipt, artifact: PreparedStoredArtifact | null, signal: AbortSignal) => Promise<void>>(async () => {});
  return { ...f, ...out, canonical, root, expected, readArtifact, check, scratch };
}
