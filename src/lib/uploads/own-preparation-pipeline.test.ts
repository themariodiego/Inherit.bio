import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { runOwnPreparationPipeline, type OwnPreparationPipelineOptions, type OwnPreparationCheckpoint } from "./own-preparation-pipeline";
import type { PreparedStoredArtifact } from "../genome/prepared-source/storage-writer";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const header = "##fileformat=VCFv4.2\n##reference=GRCh38\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS\n";
const rows = ["15\t74749576\trs762551\tC\tA\t.\tPASS\t.\tGT\t0/1",
  "1\t10\trs10\tA\tC\t.\tPASS\t.\tGT\t0/0", "1\t11\trs11\tA\tC\t.\tLowQual\t.\tGT\t./."];
function setup(text = header + rows.join("\n") + "\n", gzip = false) {
  const decoded = Buffer.from(text), raw = gzip ? gzipSync(decoded) : decoded;
  const objects = new Map<string, Uint8Array>(), artifacts: PreparedStoredArtifact[] = [];
  const signal = new AbortController().signal, jobId = randomUUID(), attemptId = randomUUID();
  const options: OwnPreparationPipelineOptions = {
    jobId, attemptId, firstArtifactSequence: 0, signal, maximumUnmappedFraction: 0,
    original: { signal, source: { fileId: randomUUID(), subjectId: randomUUID(), sourceRevision: 1,
      rawSha256: sha(raw), decodedSha256: sha(decoded), bucket: "genomes", objectId: randomUUID(), objectKey: randomUUID(),
      sizeBytes: raw.length, fileType: "vcf", maximumDecodedBytes: decoded.length },
    check: vi.fn(async () => {}), readRange: vi.fn(async (_source, start, end) => new Response(Uint8Array.from(raw.subarray(start, end + 1)), {
      status: 206, headers: { "content-range": `bytes ${start}-${end}/${raw.length}` },
    })) },
    check: vi.fn(async () => {}), checkpoint: vi.fn(async checkpoint => structuredClone(checkpoint)),
    writeArtifact: vi.fn(async ({ descriptor, bytes }) => {
      expect(descriptor.sha256).toBe(sha(bytes));
      const artifact: PreparedStoredArtifact = { receipt: { version: "own-preparation-artifact-v1", artifactId: randomUUID(),
        jobId, attemptId, sequence: descriptor.sequence, bucket: "genomes", objectKey: `prepared/${randomUUID()}`,
        byteCount: bytes.length, sha256: sha(bytes), writeExpiresAt: "2026-09-09T02:00:00Z" }, storageObjectId: randomUUID() };
      objects.set(artifact.receipt.artifactId, Uint8Array.from(bytes)); artifacts.push(artifact); return artifact;
    }),
    readArtifact: vi.fn(async artifact => (async function* () { yield Uint8Array.from(objects.get(artifact.receipt.artifactId)!); })()),
  };
  return { options, objects, artifacts };
}
describe("own preparation bounded pipeline", () => {
  it("runs actual canonical and rsID publication preflight entirely through R2 v2 identities", async () => {
    const f = setup();
    f.options.writeArtifact = vi.fn(async ({ descriptor, bytes }) => {
      const artifact: PreparedStoredArtifact = { receipt: { version: "own-preparation-artifact-v2", provider: "r2",
        artifactId: randomUUID(), jobId: f.options.jobId, attemptId: f.options.attemptId, sequence: descriptor.sequence,
        bucket: "inherit-prepared-synthetic", objectKey: `prepared/${randomUUID()}`, byteCount: bytes.length,
        sha256: sha(bytes), writeExpiresAt: "2026-09-09T02:00:00Z" },
        providerVersion: randomUUID().replaceAll("-", ""), etag: "a".repeat(32) };
      f.objects.set(artifact.receipt.artifactId, Uint8Array.from(bytes)); f.artifacts.push(artifact); return artifact;
    });
    const result = await runOwnPreparationPipeline(f.options);
    expect(result.publication.members.length).toBeGreaterThan(3);
    expect(result.publication.members.every(a => a.receipt.version === "own-preparation-artifact-v2"
      && "providerVersion" in a && !("storageObjectId" in a))).toBe(true);
    expect(result.canonicalRunsReceipt.canonicalSummary.variantCount).toBe(1);
  });
  it.each(["source-runs", "canonical-runs", "canonical-materialization", "rsid-runs"] as const)(
    "resumes same-attempt %s from actual durable objects without replaying original", async phase => {
      const f = setup(); let captured: OwnPreparationCheckpoint | undefined;
      f.options.checkpoint = async checkpoint => {
        if (checkpoint.phase === phase) { captured = structuredClone(checkpoint); throw new Error("worker_yield"); }
        return checkpoint;
      };
      await expect(runOwnPreparationPipeline(f.options)).rejects.toThrow("worker_yield");
      expect(captured).toBeDefined();
      const readsBefore = vi.mocked(f.options.original.readRange).mock.calls.length;
      f.options.resume = captured; f.options.firstArtifactSequence = captured!.nextArtifactSequence;
      f.options.checkpoint = async checkpoint => checkpoint;
      const result = await runOwnPreparationPipeline(f.options);
      expect(result.canonicalRunsReceipt.canonicalSummary.variantCount).toBe(1);
      expect(vi.mocked(f.options.original.readRange).mock.calls).toHaveLength(readsBefore);
      expect(result.nextArtifactSequence).toBe(f.artifacts.length);
    });
  it("refuses resumed checkpoint with an untracked later write rather than reusing sequence", async () => {
    const f = setup(); let captured: OwnPreparationCheckpoint | undefined;
    f.options.checkpoint = async checkpoint => { captured = checkpoint; throw new Error("worker_yield"); };
    await expect(runOwnPreparationPipeline(f.options)).rejects.toThrow("worker_yield");
    f.options.resume = captured; f.options.firstArtifactSequence = 1;
    await expect(runOwnPreparationPipeline(f.options)).rejects.toMatchObject({ code: "integrity_mismatch" });
    expect(f.options.writeArtifact).not.toHaveBeenCalled();
  });

  it("performs actual multi-pass sorting beyond eight initial runs without losing collision evidence", async () => {
    // Ten real 32k-event initial runs; this is a bounded synthetic engine
    // regression, not a provider throughput or ordinary-WGS capacity claim.
    let text = header;
    for (let i = 144_000; i >= 0; i--) text += `1\t${i + 1}\trs${i + 1}\tA\tC\t.\tPASS\t.\tGT\t0/1\n`;
    const f = setup(text, true), result = await runOwnPreparationPipeline(f.options);
    expect(result.parserReceipt.runCount).toBe(10);
    expect(result.parserReceipt.eventCount).toBe(288_002);
    expect(result.canonicalRunsReceipt.canonicalSummary.variantCount).toBe(144_001);
    const checkpoints = vi.mocked(f.options.checkpoint).mock.calls.map(([c]) => c);
    expect(checkpoints.some(c => c.phase === "source-merge" && c.generation === 1)).toBe(true);
    expect(checkpoints.some(c => c.phase === "canonical-merge" && c.generation === 1)).toBe(true);
    expect(result.scanReceipt.pointerCount).toBe(288_002);
    // Packing collapses hundreds of codec-block emissions to bounded objects.
    expect(f.artifacts.length).toBeLessThan(result.parserReceipt.blockCount);
  }, 60_000);

  it.each([false, true])("uses actual parser, lossless canonical/rsID materializers and full publication preflight gzip=%s", async gzip => {
    const f = setup(undefined, gzip), result = await runOwnPreparationPipeline(f.options);
    expect(result.state).toBe("provisional");
    expect(result.parserReceipt.summary).toMatchObject({ variantCount: 1, referenceCallCount: 1, observedCallCount: 3 });
    expect(result.canonicalRunsReceipt.canonicalSummary).toMatchObject({ variantCount: 1, observedCallCount: 3, usableObservedCount: 2 });
    expect(result.scanReceipt.pointerCount).toBe(4);
    expect(result.publication.members.length).toBeGreaterThan(3);
    const ids = new Set(result.publication.members.map(a => a.receipt.artifactId));
    expect(result.scratchArtifacts.every(a => !ids.has(a.receipt.artifactId))).toBe(true);
    expect(result.scratchArtifacts.length + ids.size).toBe(f.artifacts.length);
    expect(result.nextArtifactSequence).toBe(f.artifacts.length);
    expect(f.artifacts.map(a => a.receipt.sequence)).toEqual(f.artifacts.map((_, i) => i));
    expect(vi.mocked(f.options.checkpoint).mock.calls.at(-1)?.[0].phase).toBe("publication-preflight");
    // A receipt does not expose a SQL publishing side effect or generated report.
    expect(result).not.toHaveProperty("published");
  });
  it("preserves same-position duplicate evidence and reference/no-call observations", async () => {
    const f = setup(header + [rows[0], rows[0], ...rows.slice(1)].join("\n") + "\n");
    const result = await runOwnPreparationPipeline(f.options);
    expect(result.parserReceipt.summary.variantCount).toBe(2);
    expect(result.canonicalRunsReceipt.canonicalSummary.variantCount).toBe(1);
    expect(result.canonicalRunsReceipt.canonicalSummary.observedCallCount).toBe(4);
    expect(result.scanReceipt.pointerCount).toBe(6);
  });
  it("rejects conflicting duplicate variants and leaves every partial write provisional", async () => {
    const f = setup(header + [rows[0], rows[0].replace("0/1", "1/1")].join("\n") + "\n");
    await expect(runOwnPreparationPipeline(f.options)).rejects.toMatchObject({ code: "position_conflict" });
    expect(f.artifacts.length).toBeGreaterThan(0);
    expect(vi.mocked(f.options.checkpoint).mock.calls.some(([c]) => c.phase === "publication-preflight")).toBe(false);
  });
  it("handles a genuinely empty rsID index without inventing a pointer", async () => {
    const f = setup(header + rows[0].replace("rs762551", ".") + "\n");
    const result = await runOwnPreparationPipeline(f.options);
    expect(result.scanReceipt.pointerCount).toBe(0);
    expect(result.publication.members.length).toBeGreaterThan(0);
  });
  it("refuses changed checkpoint ACK before producing blocks", async () => {
    const f = setup(); f.options.checkpoint = async checkpoint => ({ ...checkpoint, nextArtifactSequence: checkpoint.nextArtifactSequence + 1 });
    await expect(runOwnPreparationPipeline(f.options)).rejects.toMatchObject({ code: "integrity_mismatch" });
    expect(f.options.writeArtifact).not.toHaveBeenCalled();
  });
  it("refuses a provider ACK from another attempt and never retries", async () => {
    const f = setup(), original = f.options.writeArtifact;
    f.options.writeArtifact = vi.fn(async (input, signal) => { const ack = await original(input, signal); ack.receipt.attemptId = randomUUID(); return ack; });
    await expect(runOwnPreparationPipeline(f.options)).rejects.toMatchObject({ code: "integrity_mismatch" });
    expect(f.options.writeArtifact).toHaveBeenCalledTimes(1);
  });
  it("detects actual stored scratch corruption before interpreting it", async () => {
    const f = setup(); f.options.readArtifact = async artifact => (async function* () {
      const bytes = Uint8Array.from(f.objects.get(artifact.receipt.artifactId)!); bytes[bytes.length - 1] ^= 1; yield bytes;
    })();
    await expect(runOwnPreparationPipeline(f.options)).rejects.toMatchObject({ code: "integrity_mismatch" });
  });
  it("preserves a nonzero authoritative next artifact sequence", async () => {
    const f = setup(); f.options.firstArtifactSequence = 12;
    const result = await runOwnPreparationPipeline(f.options);
    expect(f.artifacts[0].receipt.sequence).toBe(12);
    expect(result.nextArtifactSequence).toBe(12 + f.artifacts.length);
  });
  it("refuses exhausted registered artifact budget without retry or truncating calls", async () => {
    const f = setup(); f.options.firstArtifactSequence = 4095;
    await expect(runOwnPreparationPipeline(f.options)).rejects.toMatchObject({ code: "too_large" });
    expect(f.artifacts).toHaveLength(1);
    expect(vi.mocked(f.options.checkpoint).mock.calls.some(([c]) => c.phase === "publication-preflight")).toBe(false);
  });
  it("does not continue after authority withdrawal at a durable phase boundary", async () => {
    const f = setup(); f.options.checkpoint = async checkpoint => {
      if (checkpoint.phase === "source-runs") throw new Error("withheld"); return checkpoint;
    };
    await expect(runOwnPreparationPipeline(f.options)).rejects.toThrow("withheld");
  });
});
