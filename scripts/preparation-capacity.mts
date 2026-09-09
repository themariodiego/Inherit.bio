/**
 * Measures the preparation boundary: what `runOwnPreparationPipeline` — the
 * exact function the prepared worker runs after an original is finalized —
 * costs over a synthetic file of a given size, and which of its own ceilings
 * it approaches on the way.
 *
 * Finalization only proves a file is a single-sample VCF and promotes its
 * bytes. Preparation is what turns those bytes into the canonical source a
 * report reads, and it has ceilings finalization never touches: at most 4,096
 * artifacts per attempt, at most 8,388,608 bytes each, and at most 32,000
 * blocks in one run. A whole-genome file that finalizes and then cannot be
 * prepared is refused just as completely, one stage later, so the decoded
 * ceiling cannot move on finalization evidence alone.
 *
 * This drives the real pipeline with file-backed artifact storage and an
 * in-memory checkpoint, so the numbers are the pipeline's own, not a model of
 * it. What it does not measure: the database writes, storage round trips and
 * lease renewals the hosted worker adds around each artifact. Those make a
 * real run slower, never faster, so read every figure here as a floor.
 *
 * No real genome, person or customer file is involved; the input is the
 * deterministic fixture from `synthetic-wgs-fixture.mts`.
 *
 * Usage:
 *   node --conditions=react-server --import tsx scripts/preparation-capacity.mts \
 *     --file /tmp/fixture.vcf.gz [--spool /tmp/prepared] [--chunk 4000000]
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { INGEST_CHUNK_MAXIMUM_BYTES } from "../src/lib/genome/ingest-limits";
import type { PreparedStoredArtifact } from "../src/lib/genome/prepared-source/storage-writer";
import { runOwnPreparationPipeline, type OwnPreparationCheckpoint } from "../src/lib/uploads/own-preparation-pipeline";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Both hashes the scan checks, without ever holding the file in memory. */
async function hashes(path: string, compressed: boolean) {
  const raw = createHash("sha256"), decoded = createHash("sha256");
  let decodedBytes = 0;
  const source = createReadStream(path);
  source.on("data", chunk => raw.update(chunk as Buffer));
  const sink = async (stream: AsyncIterable<Buffer>) => {
    for await (const chunk of stream) { decoded.update(chunk); decodedBytes += chunk.length; }
  };
  await (compressed ? pipeline(source, createGunzip(), sink) : pipeline(source, sink));
  return { rawSha256: raw.digest("hex"), decodedSha256: decoded.digest("hex"), decodedBytes };
}

async function main() {
  const argv = process.argv.slice(2);
  const value = (flag: string) => { const at = argv.indexOf(flag); return at === -1 ? undefined : argv[at + 1]; };
  const file = value("--file");
  if (!file) { console.error("usage: --file <path> [--spool <dir>] [--chunk <bytes>]"); process.exit(2); }
  const chunk = Number(value("--chunk") ?? INGEST_CHUNK_MAXIMUM_BYTES);
  const spool = value("--spool") ?? join(process.env.TMPDIR ?? "/tmp", `preparation-capacity-${randomUUID()}`);
  const compressed = file.endsWith(".gz");

  const { size } = await stat(file);
  const scanned = await hashes(file, compressed);
  await mkdir(spool, { recursive: true });

  const jobId = randomUUID(), attemptId = randomUUID();
  const source = {
    fileId: randomUUID(), subjectId: randomUUID(), sourceRevision: 1,
    rawSha256: scanned.rawSha256, decodedSha256: scanned.decodedSha256,
    bucket: "genomes" as const, objectId: randomUUID(), objectKey: randomUUID(),
    sizeBytes: size, fileType: "vcf" as const, maximumDecodedBytes: scanned.decodedBytes,
  };

  let ranges = 0, artifactCount = 0, artifactBytes = 0, largestArtifact = 0, checkpoints = 0, reads = 0;
  let peakRss = 0;
  const phases: { phase: string; seconds: number }[] = [];
  const spooled = new Map<string, string>();
  const started = process.hrtime.bigint();
  const since = () => Number(process.hrtime.bigint() - started) / 1e9;
  const sample = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 50);

  const controller = new AbortController();
  const signal = controller.signal;
  let refusal: string | undefined;
  let result: Awaited<ReturnType<typeof runOwnPreparationPipeline>> | undefined;
  try {
    result = await runOwnPreparationPipeline({
      jobId, attemptId, firstArtifactSequence: 0, signal, maximumUnmappedFraction: 0,
      original: {
        source, signal,
        check: async () => {},
        readRange: async (_source, start, end) => {
          ranges += 1;
          const bytes = new Uint8Array(end - start + 1); let offset = 0;
          for await (const part of createReadStream(file, { start, end })) {
            bytes.set(part as Uint8Array, offset); offset += (part as Uint8Array).length;
          }
          return new Response(bytes.subarray(0, offset), { status: 206,
            headers: { "content-range": `bytes ${start}-${end}/${size}` } });
        },
      },
      check: async () => {},
      checkpoint: async (checkpoint: OwnPreparationCheckpoint) => {
        checkpoints += 1;
        if (phases.at(-1)?.phase !== checkpoint.phase) phases.push({ phase: checkpoint.phase, seconds: Number(since().toFixed(3)) });
        return structuredClone(checkpoint);
      },
      // Artifacts go to disk rather than a Map: at whole-genome scale holding
      // them would measure this harness's memory, not the pipeline's.
      writeArtifact: async ({ descriptor, bytes }) => {
        const artifactId = randomUUID(), path = join(spool, artifactId);
        await pipeline(async function* () { yield bytes; }(), createWriteStream(path));
        spooled.set(artifactId, path);
        artifactCount += 1; artifactBytes += bytes.length; largestArtifact = Math.max(largestArtifact, bytes.length);
        const artifact: PreparedStoredArtifact = { storageObjectId: randomUUID(), receipt: {
          version: "own-preparation-artifact-v1", artifactId, jobId, attemptId, sequence: descriptor.sequence,
          bucket: "genomes", objectKey: `prepared/${artifactId}`, byteCount: bytes.length, sha256: sha256(bytes),
          writeExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        } };
        return artifact;
      },
      readArtifact: async function* (artifact) {
        reads += 1;
        const path = spooled.get(artifact.receipt.artifactId);
        if (!path) throw new Error("artifact missing from spool");
        for await (const bytes of createReadStream(path)) yield bytes as Uint8Array;
      },
    });
  } catch (error) {
    refusal = (error as { code?: string }).code ?? String(error);
  } finally {
    clearInterval(sample);
  }
  const seconds = since();
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  if (!value("--keep")) await rm(spool, { recursive: true, force: true });

  console.log(JSON.stringify({
    file, compressed, rawBytes: size, decodedBytes: scanned.decodedBytes,
    chunkBytes: chunk, ranges, checkpoints, artifactReads: reads,
    phases, refusal: refusal ?? null,
    variantCount: result?.canonicalRunsReceipt.canonicalSummary.variantCount ?? null,
    observedCallCount: result?.canonicalRunsReceipt.canonicalSummary.observedCallCount ?? null,
    artifactCount, artifactBytes, largestArtifactBytes: largestArtifact,
    // The pipeline's own ceilings, as fractions of what this run used. A file
    // that reaches 1.0 on any of them cannot be prepared at all, whatever the
    // decoded ceiling says.
    artifactBudgetUsed: Number((artifactCount / 4096).toFixed(4)),
    artifactSizeBudgetUsed: Number((largestArtifact / 8_388_608).toFixed(4)),
    seconds: Number(seconds.toFixed(3)),
    decodedBytesPerSecond: Math.round(scanned.decodedBytes / seconds),
    peakRssBytes: peakRss,
  }, null, 1));
}

await main();
