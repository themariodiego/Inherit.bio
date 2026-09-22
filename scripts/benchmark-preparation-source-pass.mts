/** Synthetic in-memory pipeline comparison. No provider, database or hosted I/O.
 * Usage: node --conditions=react-server --import ./scripts/server-only-shim.mjs
 *   --import tsx scripts/benchmark-preparation-source-pass.mts --baseline <sha>
 * Only the baseline pipeline comes from that commit; all its dependencies are
 * current. Both variants receive identical bytes and deterministic receipts.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { runOwnPreparationPipeline, type OwnPreparationPipelineOptions } from "../src/lib/uploads/own-preparation-pipeline";
import type { PreparedStoredArtifact } from "../src/lib/genome/prepared-source/storage-writer";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), baseline = args[1];
if (args.length !== 2 || args[0] !== "--baseline" || !/^[0-9a-f]{40}$/.test(baseline ?? "")) {
  throw new Error("Provide --baseline with one full commit SHA");
}
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const id = (n: number) => `89220000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const records = 144_001;
let text = "##fileformat=VCFv4.2\n##reference=GRCh38\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS\n";
for (let pos = records; pos > 0; pos--) text += `1\t${pos}\trs${pos}\tA\tC\t.\tPASS\t.\tGT\t0/1\n`;
const decoded = Buffer.from(text), raw = gzipSync(decoded);
text = "";

async function measure(pipeline: typeof runOwnPreparationPipeline) {
  const objects = new Map<string, Uint8Array>();
  const artifacts: PreparedStoredArtifact[] = [];
  const sourceContainers = new Set<string>();
  let artifactReads = 0, readBytes = 0, sourceContainerReads = 0, sourceContainerReadBytes = 0;
  const phases: { phase: string; generation: number; seconds: number }[] = [];
  const signal = new AbortController().signal, jobId = id(1), attemptId = id(2);
  const started = performance.now(), cpu = process.cpuUsage();
  const options: OwnPreparationPipelineOptions = {
    jobId, attemptId, firstArtifactSequence: 0, signal, maximumUnmappedFraction: 0,
    original: { signal, source: { fileId: id(3), subjectId: id(4), sourceRevision: 1,
      rawSha256: sha(raw), decodedSha256: sha(decoded), bucket: "genomes", objectId: id(5), objectKey: id(6),
      sizeBytes: raw.length, fileType: "vcf", maximumDecodedBytes: decoded.length },
    check: async () => {}, readRange: async (_source, start, end) => new Response(Uint8Array.from(raw.subarray(start, end + 1)), {
      status: 206, headers: { "content-range": `bytes ${start}-${end}/${raw.length}` },
    }) },
    check: async () => {},
    checkpoint: async checkpoint => {
      phases.push({ phase: checkpoint.phase, generation: checkpoint.generation, seconds: (performance.now() - started) / 1000 });
      return structuredClone(checkpoint);
    },
    writeArtifact: async ({ descriptor, bytes }) => {
      if (descriptor.sha256 !== sha(bytes)) throw new Error("Synthetic write hash mismatch");
      const artifact: PreparedStoredArtifact = { receipt: { version: "own-preparation-artifact-v1", artifactId: id(100 + descriptor.sequence),
        jobId, attemptId, sequence: descriptor.sequence, bucket: "genomes", objectKey: `prepared/${id(20_000 + descriptor.sequence)}`,
        byteCount: bytes.length, sha256: sha(bytes), writeExpiresAt: "2026-09-22T02:00:00Z" }, storageObjectId: id(10_000 + descriptor.sequence) };
      // Source run envelopes name their exact container receipts. Count every
      // actual read of those containers, including intermediate merge passes.
      if (bytes[0] === 123) {
        const envelope = JSON.parse(new TextDecoder().decode(bytes));
        if (envelope.version === "own-preparation-run-v1" && envelope.kind === "source") {
          for (const container of envelope.containers) sourceContainers.add(container.receipt.artifactId);
        }
      }
      objects.set(artifact.receipt.artifactId, Uint8Array.from(bytes)); artifacts.push(artifact);
      return artifact;
    },
    readArtifact: async artifact => (async function* () {
      const bytes = objects.get(artifact.receipt.artifactId);
      if (!bytes) throw new Error("Synthetic artifact missing");
      artifactReads++; readBytes += bytes.length;
      if (sourceContainers.has(artifact.receipt.artifactId)) { sourceContainerReads++; sourceContainerReadBytes += bytes.length; }
      yield Uint8Array.from(bytes);
    })(),
  };
  const result = await pipeline(options), usage = process.cpuUsage(cpu);
  const seconds = (performance.now() - started) / 1000;
  if (result.parserReceipt.summary.variantCount !== records
    || result.canonicalRunsReceipt.canonicalSummary.variantCount !== records
    || result.scanReceipt.pointerCount !== records * 2) throw new Error("Synthetic record loss");
  return { seconds, cpuSeconds: (usage.user + usage.system) / 1e6,
    artifactReads, readBytes, sourceContainerReads, sourceContainerReadBytes,
    artifactCount: artifacts.length, artifactBytes: artifacts.reduce((n, a) => n + a.receipt.byteCount, 0),
    initialSourceRuns: result.parserReceipt.runCount,
    artifactsSha256: sha(JSON.stringify(artifacts)), resultSha256: sha(JSON.stringify(result)), phases };
}

const directory = await mkdtemp(join(tmpdir(), "inherit-source-pass-benchmark-"));
try {
  await symlink(join(root, "node_modules"), join(directory, "node_modules"), "dir");
  const relative = "src/lib/uploads/own-preparation-pipeline.ts";
  const original = execFileSync("git", ["show", `${baseline}:${relative}`], { cwd: root, encoding: "utf8" });
  const linked = original.replace(/from "(\.[^"]+)"/g, (_whole, specifier: string) =>
    `from ${JSON.stringify(pathToFileURL(resolve(dirname(join(root, relative)), specifier)).href)}`);
  await writeFile(join(directory, "pipeline.ts"), linked);
  const oldPipeline = (await import(pathToFileURL(join(directory, "pipeline.ts")).href)).runOwnPreparationPipeline as typeof runOwnPreparationPipeline;
  const results = [];
  for (let iteration = 0; iteration < 4; iteration++) {
    const modes = iteration % 2 ? ["candidate", "baseline"] as const : ["baseline", "candidate"] as const;
    for (const mode of modes) {
      const row = { iteration, mode, ...await measure(mode === "baseline" ? oldPipeline : runOwnPreparationPipeline) };
      results.push(row);
      process.stderr.write(`${iteration === 0 ? "warmup" : "pair " + iteration} ${mode}: ${row.seconds.toFixed(3)}s, ${row.sourceContainerReads} source-container reads\n`);
    }
  }
  const first = results[0];
  if (results.some(row => row.artifactsSha256 !== first.artifactsSha256 || row.resultSha256 !== first.resultSha256)) {
    throw new Error("Pipeline output mismatch");
  }
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), baselineCommit: baseline,
    node: process.version, platform: process.platform, arch: process.arch,
    warmupIterations: 1, measuredPairs: 3, records, storedBytes: raw.length, decodedBytes: decoded.length, results }, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
