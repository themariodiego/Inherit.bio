import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { runOwnPreparationPipeline, type OwnPreparationPipelineOptions, type OwnPreparationCheckpoint } from "./own-preparation-pipeline";
import { createOwnPreparationArtifacts } from "./own-preparation-artifacts";
import { decodePreparedBlock, encodePreparedBlock } from "../genome/prepared-source/codec";
import type { PreparedRunReceipt } from "../genome/prepared-source/runs";
import type { PreparedStoredArtifact } from "../genome/prepared-source/storage-writer";
import { PreparationMetrics, type PreparationMetricsEvent } from "./preparation-metrics";
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

/** Repack an actually parsed same-attempt source into separate containers.
 * Tiny cases use one event each to expose redundant reads without a large file. */
async function sourceContainersFixture(text?: string, eventsPerContainer = 1) {
  const f = setup(text); let saved: OwnPreparationCheckpoint | undefined;
  f.options.checkpoint = async checkpoint => {
    if (checkpoint.phase === "source-runs") { saved = structuredClone(checkpoint); throw new Error("source_ready"); }
    return checkpoint;
  };
  await expect(runOwnPreparationPipeline(f.options)).rejects.toThrow("source_ready");
  const checkpoint = saved!, old = checkpoint.resume.sourceRuns[0];
  expect(checkpoint.resume.sourceRuns).toHaveLength(1);
  const envelope = JSON.parse(Buffer.from(f.objects.get(old.artifact.receipt.artifactId)!).toString()) as {
    run: PreparedRunReceipt; containers: PreparedStoredArtifact[]; locations: { container: number; offset: number; length: number }[];
  };
  const events = [];
  for (const [index, descriptor] of envelope.run.blocks.entries()) {
    const location = envelope.locations[index], bytes = f.objects.get(envelope.containers[location.container].receipt.artifactId)!;
    const block = await decodePreparedBlock((async function* () { yield bytes.subarray(location.offset, location.offset + location.length); })(), descriptor);
    events.push(...block.events);
  }
  const artifacts = createOwnPreparationArtifacts({ ...f.options, firstArtifactSequence: f.artifacts.length });
  const containers: PreparedStoredArtifact[] = [], blocks = [], locations = [];
  for (let offset = 0; offset < events.length; offset += eventsPerContainer) {
    const sequence = blocks.length;
    const encoded = await encodePreparedBlock({ source: envelope.run.source, sequence, events: events.slice(offset, offset + eventsPerContainer) });
    containers.push(await artifacts.persist(encoded.compressed)); blocks.push(encoded.descriptor);
    locations.push({ sequence, container: sequence, offset: 0, length: encoded.compressed.length });
  }
  const run = { ...envelope.run, blocks };
  const artifact = await artifacts.persist(Buffer.from(JSON.stringify({ version: "own-preparation-run-v1", kind: "source", run, containers, locations })));
  const handle = { ...old, artifact, firstBlockSequence: 0, blockCount: blocks.length };
  checkpoint.resume.sourceRuns = [handle]; checkpoint.outputs = [handle];
  checkpoint.resume.parserReceipt!.blockCount = blocks.length; checkpoint.terminal = checkpoint.resume.parserReceipt;
  checkpoint.nextArtifactSequence = artifacts.nextSequence;
  f.options.resume = checkpoint; f.options.firstArtifactSequence = artifacts.nextSequence;
  f.options.checkpoint = vi.fn(async value => structuredClone(value)); vi.mocked(f.options.readArtifact).mockClear();
  return { ...f, containers, checkpoint };
}

describe("own preparation bounded pipeline", () => {
  it("keeps real synthetic pipeline bytes, authority order and checkpoints identical with optional metrics", async () => {
    const baseline = setup(), measured = setup();
    Object.assign(measured.options, { jobId: baseline.options.jobId, attemptId: baseline.options.attemptId });
    measured.options.original.source = structuredClone(baseline.options.original.source);
    const sink = vi.fn(); let time = 0;
    measured.options.metrics = new PreparationMetrics(sink, { now: () => time, cpu: () => ({ user: time * 2, system: time }) });
    function deterministic(f: ReturnType<typeof setup>) {
      const order: unknown[] = [], id = (sequence: number, prefix: string) => `${prefix}-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
      f.options.writeArtifact = vi.fn(async ({ descriptor, bytes }) => {
        order.push(["write", descriptor.sequence]); time += 3;
        const artifact: PreparedStoredArtifact = { receipt: { version: "own-preparation-artifact-v1", artifactId: id(descriptor.sequence, "11111111"),
          jobId: f.options.jobId, attemptId: f.options.attemptId, sequence: descriptor.sequence, bucket: "genomes",
          objectKey: `prepared/${id(descriptor.sequence, "22222222")}`, byteCount: bytes.length, sha256: sha(bytes), writeExpiresAt: "2026-09-09T02:00:00Z" },
          storageObjectId: id(descriptor.sequence, "33333333") };
        f.objects.set(artifact.receipt.artifactId, Uint8Array.from(bytes)); f.artifacts.push(artifact); return artifact;
      });
      const read = f.options.readArtifact, range = f.options.original.readRange;
      f.options.readArtifact = vi.fn(async (artifact, signal) => { order.push(["read", artifact.receipt.sequence]); time += 5; return read(artifact, signal); });
      f.options.original.readRange = vi.fn(async (source, start, end, signal) => { order.push(["source", start, end]); time += 7; return range(source, start, end, signal); });
      f.options.check = vi.fn(async artifact => { order.push(["authority", artifact?.receipt.sequence ?? null]); time++; });
      f.options.original.check = vi.fn(async () => { order.push(["source-authority"]); time++; });
      f.options.checkpoint = vi.fn(async checkpoint => { order.push(["checkpoint", checkpoint.phase]); time++; return structuredClone(checkpoint); });
      return order;
    }
    const baselineOrder = deterministic(baseline), measuredOrder = deterministic(measured);
    const before = await runOwnPreparationPipeline(baseline.options); time = 0;
    const after = await runOwnPreparationPipeline(measured.options); measured.options.metrics.finish("prepared");
    expect(after).toEqual(before); expect(measured.objects).toEqual(baseline.objects); expect(measuredOrder).toEqual(baselineOrder);
    const event = sink.mock.calls[0][0] as PreparationMetricsEvent, phases = Object.values(event.phases);
    expect(event).toMatchObject({ activePhase: "publication_preflight", lastCompletedCheckpoint: "publication-preflight", dropped: 0,
      completedCheckpoints: vi.mocked(measured.options.checkpoint).mock.calls.length });
    const reads = vi.mocked(measured.options.readArtifact).mock.calls.map(([artifact]) => artifact.receipt.byteCount);
    expect(phases.reduce((sum, phase) => sum + phase.operations.artifact_read.completed, 0)).toBe(reads.length);
    expect(phases.reduce((sum, phase) => sum + phase.operations.artifact_read.completedBytes, 0)).toBe(reads.reduce((a, b) => a + b, 0));
    expect(phases.reduce((sum, phase) => sum + phase.operations.artifact_write.completed, 0)).toBe(measured.artifacts.length);
    expect(phases.reduce((sum, phase) => sum + phase.operations.artifact_write.completedBytes, 0)).toBe([...measured.objects.values()].reduce((sum, bytes) => sum + bytes.length, 0));
    expect(event.phases.publication_preflight.operations.artifact_read.completed).toBeGreaterThan(0);
    expect(event.phases.source_scan.operations.source_get).toMatchObject({ completed: 1, completedBytes: measured.options.original.source.sizeBytes, wallMs: 7 });
    expect(event.phases.source_runs.operations.source_get.completed).toBe(1);
    expect(event.phases.rsid_runs.entered).toBe(true); expect(event.phases.publication.entered).toBe(false);
    for (const privateValue of [baseline.options.jobId, baseline.options.original.source.rawSha256, ...measured.objects.keys()]) expect(JSON.stringify(event)).not.toContain(privateValue);
  });
  it.each(["checkpoint", "read", "abort"])("keeps the last acknowledged checkpoint separate from active rsID work after %s failure", async mode => {
    const f = setup(), sink = vi.fn(), controller = new AbortController();
    f.options.signal = controller.signal; f.options.original.signal = controller.signal;
    f.options.metrics = new PreparationMetrics(sink);
    let materialized = false; const read = f.options.readArtifact;
    f.options.checkpoint = vi.fn(async checkpoint => {
      if (checkpoint.phase === "canonical-materialization") {
        if (mode === "checkpoint") return { ...checkpoint, generation: checkpoint.generation + 1 };
        materialized = true;
      }
      return structuredClone(checkpoint);
    });
    f.options.readArtifact = vi.fn(async (artifact, signal) => {
      if (materialized) { if (mode === "abort") controller.abort(); throw new Error("synthetic private read detail"); }
      return read(artifact, signal);
    });
    await expect(runOwnPreparationPipeline(f.options)).rejects.toMatchObject({ code: mode === "checkpoint" ? "integrity_mismatch" : mode === "abort" ? "aborted" : "unavailable" });
    f.options.metrics.finish(mode === "abort" ? "aborted" : "failed");
    const event = sink.mock.calls[0][0] as PreparationMetricsEvent;
    expect(event.lastCompletedCheckpoint).toBe(mode === "checkpoint" ? "canonical-runs" : "canonical-materialization");
    expect(event.activePhase).toBe(mode === "checkpoint" ? "canonical_materialization" : "rsid_runs");
    expect(event.phases[event.activePhase].completed).toBe(false); expect(event.phases.publication_preflight.entered).toBe(false);
    if (mode !== "checkpoint") expect(event.phases.rsid_runs.operations.artifact_read).toMatchObject({ started: 1, failed: 1, completed: 0, completedBytes: 0 });
    expect(JSON.stringify(event)).not.toContain("synthetic private read detail");
  });
  it("uses the detected GRCh38 build when the worker has a configured GRCh37 chain", async () => {
    const f = setup();
    const chainBytes = Buffer.from("chain 1 chr1 1000 + 0 10 chr1 1000 + 899 909 1\n10\n");
    f.options.liftover = { chainBytes, sha256: sha(chainBytes) };
    const result = await runOwnPreparationPipeline(f.options);
    expect(result.canonicalRunsReceipt.binding.source.sourceBuild).toBe("GRCh38");
    expect(result.canonicalRunsReceipt.binding.liftoverSha256).toBeNull();
    expect(result.canonicalRunsReceipt.canonicalSummary).toMatchObject({
      variantCount: 1, observedCallCount: 3, attempted: 0, unmapped: 0,
    });
    expect(vi.mocked(f.options.checkpoint).mock.calls.at(-1)?.[0].phase).toBe("publication-preflight");
  });
  it("keeps a verified configured chain bound to detected GRCh37 publication", async () => {
    const f = setup(header.replace("GRCh38", "GRCh37") + "1\t1\trs1\tA\tC\t.\tPASS\t.\tGT\t0/1\n");
    const chainBytes = Buffer.from("chain 1 chr1 1000 + 0 10 chr1 1000 + 899 909 1\n10\n");
    f.options.liftover = { chainBytes, sha256: sha(chainBytes) };
    const result = await runOwnPreparationPipeline(f.options);
    expect(result.canonicalRunsReceipt.binding.source.sourceBuild).toBe("GRCh37");
    expect(result.canonicalRunsReceipt.binding.liftoverSha256).toBe(sha(chainBytes));
    expect(result.canonicalRunsReceipt.canonicalSummary).toMatchObject({
      variantCount: 1, observedCallCount: 1, attempted: 1, unmapped: 0,
    });
    expect(vi.mocked(f.options.checkpoint).mock.calls.at(-1)?.[0].phase).toBe("publication-preflight");
  });
  it.each(["missing", "wrong-hash"])("refuses a %s GRCh37 chain before publication", async kind => {
    const f = setup(header.replace("GRCh38", "GRCh37") + "1\t1\trs1\tA\tC\t.\tPASS\t.\tGT\t0/1\n");
    if (kind === "wrong-hash") f.options.liftover = { chainBytes: Buffer.from("invalid"), sha256: "a".repeat(64) };
    const result = runOwnPreparationPipeline(f.options);
    if (kind === "missing") await expect(result).rejects.toThrow();
    else await expect(result).rejects.toMatchObject({ code: "invalid_receipt" });
    expect(vi.mocked(f.options.checkpoint).mock.calls.some(([c]) => c.phase === "publication-preflight")).toBe(false);
  });
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

  it("reads each final source container once and checkpoints only complete canonical state", async () => {
    const f = await sourceContainersFixture(), result = await runOwnPreparationPipeline(f.options);
    expect(f.containers.length).toBeGreaterThan(1);
    for (const container of f.containers) expect(vi.mocked(f.options.readArtifact).mock.calls.filter(([artifact]) =>
      artifact.receipt.artifactId === container.receipt.artifactId)).toHaveLength(1);
    const checkpoints = vi.mocked(f.options.checkpoint).mock.calls.map(([value]) => value);
    const source = checkpoints.find(value => value.phase === "source-merge")!;
    expect(source.resume.canonicalRunsReceipt).toEqual(result.canonicalRunsReceipt);
    expect(source.resume.canonicalRuns.length).toBe(result.canonicalRunsReceipt.runCount);
    expect(source.terminal).toEqual({ parserReceipt: result.parserReceipt, mergeSummary: result.canonicalRunsReceipt.canonicalSummary.mergeSummary });
    expect(checkpoints.slice(0, 2).map(value => value.phase)).toEqual(["source-merge", "canonical-runs"]);
    expect(checkpoints[1].nextArtifactSequence).toBe(source.nextArtifactSequence);
    expect(result.canonicalRunsReceipt.canonicalSummary).toMatchObject({ variantCount: 1, observedCallCount: 3 });
  });

  it("resumes a completed source-merge checkpoint without rereading source or rewriting canonical runs", async () => {
    const f = await sourceContainersFixture(); let saved: OwnPreparationCheckpoint | undefined;
    f.options.checkpoint = async checkpoint => {
      if (checkpoint.phase === "source-merge") { saved = structuredClone(checkpoint); throw new Error("worker_yield"); }
      return checkpoint;
    };
    await expect(runOwnPreparationPipeline(f.options)).rejects.toThrow("worker_yield");
    expect(saved!.resume.canonicalRunsReceipt).not.toBeNull(); expect(saved!.resume.canonicalRuns).not.toHaveLength(0);
    const written = f.artifacts.length, reads = vi.mocked(f.options.readArtifact).mock.calls.length;
    f.options.resume = saved; f.options.firstArtifactSequence = saved!.nextArtifactSequence;
    f.options.checkpoint = vi.fn(async checkpoint => checkpoint);
    const result = await runOwnPreparationPipeline(f.options);
    expect(result.canonicalRunsReceipt).toEqual(saved!.resume.canonicalRunsReceipt);
    const sourceIds = new Set(f.containers.map(value => value.receipt.artifactId));
    expect(vi.mocked(f.options.readArtifact).mock.calls.slice(reads).some(([value]) => sourceIds.has(value.receipt.artifactId))).toBe(false);
    for (const artifact of f.artifacts.slice(written)) {
      const bytes = Buffer.from(f.objects.get(artifact.receipt.artifactId)!);
      if (bytes[0] === 123) expect(JSON.parse(bytes.toString())).not.toMatchObject({ version: "own-preparation-run-v1", kind: "canonical" });
    }
    expect(result.nextArtifactSequence).toBe(f.artifacts.length);
  });

  it.each(["hash", "EOF", "abort"])("refuses a late source %s failure without a completed phase checkpoint", async mode => {
    const f = await sourceContainersFixture(), read = f.options.readArtifact, last = f.containers.at(-1)!.receipt.artifactId;
    const controller = new AbortController(); f.options.signal = controller.signal; f.options.original.signal = controller.signal;
    f.options.readArtifact = vi.fn(async (artifact, signal) => {
      if (artifact.receipt.artifactId !== last) return read(artifact, signal);
      return (async function* () {
        const bytes = Uint8Array.from(f.objects.get(last)!);
        if (mode === "hash") bytes[bytes.length - 1] ^= 1;
        yield bytes;
        if (mode === "abort") controller.abort();
        if (mode === "EOF") throw new Error("late provider EOF failure");
      })();
    });
    await expect(runOwnPreparationPipeline(f.options)).rejects.toMatchObject({ code: mode === "hash" ? "integrity_mismatch" : mode === "abort" ? "aborted" : "unavailable" });
    expect(f.options.checkpoint).not.toHaveBeenCalled();
    expect(vi.mocked(f.options.readArtifact).mock.calls.filter(([artifact]) => artifact.receipt.artifactId === last)).toHaveLength(1);
  });

  it("treats parser-derived counts as expectations until the actual source terminal agrees", async () => {
    const f = await sourceContainersFixture(), parser = f.checkpoint.resume.parserReceipt!;
    parser.summary.variantCount--; parser.summary.referenceCallCount++;
    await expect(runOwnPreparationPipeline(f.options)).rejects.toMatchObject({ code: "invalid_summary" });
    expect(f.options.checkpoint).not.toHaveBeenCalled();
  });

  it("keeps acknowledged canonical scratch provisional when a later source container is corrupt", async () => {
    const text = header + Array.from({ length: 15_999 }, (_, i) => `1\t${i + 1}\trs${i + 1}\tA\tC\t.\tPASS\t.\tGT\t0/1\n`).join("");
    const f = await sourceContainersFixture(text, 2000), read = f.options.readArtifact;
    const last = f.containers.at(-1)!.receipt.artifactId, firstCanonicalSequence = f.options.firstArtifactSequence;
    let canonicalAcknowledgedBeforeFailure = false;
    f.options.readArtifact = vi.fn(async (artifact, signal) => {
      if (artifact.receipt.artifactId !== last) return read(artifact, signal);
      canonicalAcknowledgedBeforeFailure = f.artifacts.some(value => {
        if (value.receipt.sequence < firstCanonicalSequence) return false;
        const bytes = Buffer.from(f.objects.get(value.receipt.artifactId)!);
        return bytes[0] === 123 && JSON.parse(bytes.toString()).kind === "canonical";
      });
      return (async function* () {
        const bytes = Uint8Array.from(f.objects.get(last)!); bytes[bytes.length - 1] ^= 1; yield bytes;
      })();
    });
    await expect(runOwnPreparationPipeline(f.options)).rejects.toMatchObject({ code: "integrity_mismatch" });
    expect(canonicalAcknowledgedBeforeFailure).toBe(true);
    expect(f.options.checkpoint).not.toHaveBeenCalled();
    expect(f.options.original.source).toEqual(f.checkpoint.sourceScan.source);
    expect(f.artifacts.every(value => value.receipt.jobId === f.options.jobId && value.receipt.attemptId === f.options.attemptId)).toBe(true);
    for (const artifact of f.artifacts.filter(value => value.receipt.sequence >= firstCanonicalSequence)) {
      const bytes = Buffer.from(f.objects.get(artifact.receipt.artifactId)!);
      if (bytes[0] === 123) expect(JSON.parse(bytes.toString())).toMatchObject({
        version: "own-preparation-run-v1", kind: "canonical", run: { state: "provisional" },
      });
    }
  // Real codec/parser regression under concurrent CI load, not a timing gate.
  }, 60_000);

  it("does not checkpoint source completion when the final canonical write fails", async () => {
    const f = await sourceContainersFixture();
    f.options.writeArtifact = vi.fn(async () => { throw new Error("provider refused canonical write"); });
    await expect(runOwnPreparationPipeline(f.options)).rejects.toMatchObject({ code: "unavailable" });
    expect(f.options.writeArtifact).toHaveBeenCalledTimes(1); expect(f.options.checkpoint).not.toHaveBeenCalled();
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
  // Shared CI runners exceed 60s while executing the full suite. This is an
  // engine correctness regression, not a wall-clock capacity acceptance test.
  }, 180_000);

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
