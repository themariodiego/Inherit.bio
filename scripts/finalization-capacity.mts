/**
 * Measures the actual finalization boundary: how long `validateSubjectStructure`
 * — the exact function `src/lib/uploads/subject-finalization.ts` runs inside a
 * request configured for 300 seconds — takes over a synthetic file of a given
 * size, and how much memory it holds while doing it.
 *
 * This measures the validation pass alone, on local bytes. A real finalization
 * additionally streams every range over HTTP with an authority recheck per
 * chunk, copies the object, and then reads the promoted copy a second time to
 * verify its hash. So the numbers here are a *floor* on the real cost, never a
 * budget: treat them as "this size cannot fit", not "this size will fit".
 *
 * Usage:
 *   node --conditions=react-server --import tsx scripts/finalization-capacity.mts \
 *     --file /path/fixture.vcf.gz --format VCF.GZ [--chunk 4000000] [--decoded-ceiling <bytes>]
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { INGEST_CHUNK_MAXIMUM_BYTES } from "../src/lib/genome/ingest-limits";
import { validateSubjectStructure } from "../src/lib/uploads/subject-structure";
import type { SubjectUploadFormat } from "../src/lib/uploads/subject-upload-contract";

/** The finalizer never sees one stream: it sees fixed ranges, in order. */
async function* rangedChunks(path: string, size: number, chunk: number, onChunk: () => void) {
  for (let start = 0; start < size; start += chunk) {
    const end = Math.min(size, start + chunk) - 1;
    onChunk();
    const stream = createReadStream(path, { start, end });
    for await (const bytes of stream) yield bytes as Uint8Array;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const value = (flag: string) => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };
  const file = value("--file");
  const format = (value("--format") ?? "VCF.GZ") as SubjectUploadFormat;
  const chunk = Number(value("--chunk") ?? INGEST_CHUNK_MAXIMUM_BYTES);
  if (!file) { console.error("usage: --file <path> [--format VCF|VCF.GZ|gVCF] [--chunk <bytes>]"); process.exit(2); }

  const { size } = await stat(file);
  const ceiling = Number(value("--decoded-ceiling") ?? Number.MAX_SAFE_INTEGER);
  let peakRss = 0, ranges = 0;
  const sample = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 50);
  const started = process.hrtime.bigint();
  let result: Awaited<ReturnType<typeof validateSubjectStructure>> | undefined;
  let refusal: string | undefined;
  try {
    result = await validateSubjectStructure(
      rangedChunks(file, size, chunk, () => { ranges += 1; }),
      { declaredFormat: format, expectedSize: size, expectedSha256: null, maximumDecodedBytes: ceiling },
    );
  } catch (error) {
    refusal = (error as { code?: string }).code ?? String(error);
  } finally {
    clearInterval(sample);
  }
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  peakRss = Math.max(peakRss, process.memoryUsage().rss);

  console.log(JSON.stringify({
    file, format, rawBytes: size, ranges, chunkBytes: chunk,
    decodedBytes: result?.decodedBytes ?? null,
    expansionRatio: result ? Number((result.decodedBytes / size).toFixed(2)) : null,
    refusal: refusal ?? null,
    seconds: Number(seconds.toFixed(3)),
    rawBytesPerSecond: Math.round(size / seconds),
    decodedBytesPerSecond: result ? Math.round(result.decodedBytes / seconds) : null,
    peakRssBytes: peakRss,
    // The one number this exists to produce: the largest stored size whose
    // validation pass alone would still fit inside the 300-second request.
    validationOnlyCeilingBytesAt300s: Math.round((size / seconds) * 300),
  }, null, 1));
}

await main();
