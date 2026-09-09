import "server-only";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { buildFromHeader } from "../genome/parsers/vcf";
import { INGEST_CHUNK_MAXIMUM_BYTES } from "../genome/ingest-limits";

const integer = z.number().int().positive().safe();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
/** Exact original identity from the current job authority, never a request URL.
 * This schema validates integrity metadata; check() must prove live authority. */
export const ownPreparationOriginalSchema = z.object({
  fileId: z.uuid(), subjectId: z.uuid(), sourceRevision: integer,
  rawSha256: hash, decodedSha256: hash, bucket: z.literal("genomes"),
  objectId: z.uuid(), objectKey: z.uuid(), sizeBytes: integer,
  fileType: z.enum(["vcf", "gvcf"]), maximumDecodedBytes: integer,
}).strict();
export type OwnPreparationOriginal = z.infer<typeof ownPreparationOriginalSchema>;
export const ownPreparationScanSchema = z.object({
  version: z.literal("own-preparation-source-v1"), source: ownPreparationOriginalSchema,
  rawBytes: integer, decodedBytes: integer, rawSha256: hash, decodedSha256: hash,
  compressed: z.boolean(), lineCount: integer, build: z.enum(["GRCh37", "GRCh38"]),
}).strict();
export type OwnPreparationScan = z.infer<typeof ownPreparationScanSchema>;
export type OwnPreparationSourceOptions = {
  source: OwnPreparationOriginal;
  /** Must issue an authenticated, cache-bypassing exact Range request to the
   * captured original. No retry after uncertain I/O is performed here. */
  readRange: (source: OwnPreparationOriginal, start: number, end: number, signal: AbortSignal) => Promise<Response>;
  check: (source: OwnPreparationOriginal, signal: AbortSignal) => Promise<void>;
  /** Caller supplies the finite operation/claim deadline; this never renews it. */
  signal: AbortSignal;
};
export class OwnPreparationSourceError extends Error {
  constructor(readonly code: "invalid_source" | "integrity_mismatch" | "invalid_range" | "invalid_vcf"
    | "unsupported_build" | "too_large" | "aborted" | "source_unavailable") {
    super(code); this.name = "OwnPreparationSourceError";
  }
}
function fail(code: OwnPreparationSourceError["code"]): never { throw new OwnPreparationSourceError(code); }
const active = (signal: AbortSignal) => { if (signal.aborted) fail("aborted"); };
async function wait<T>(started: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void started.catch(() => {}); fail("aborted"); }
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new OwnPreparationSourceError("aborted"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { const result = await Promise.race([started, cancelled]); active(signal); return result; }
  finally { signal.removeEventListener("abort", abort); }
}

/** Fully drain one <=4MB request before exposing bytes to parser backpressure.
 * The 30s network lifetime ends before downstream encoding/provider writes. */
async function range(options: OwnPreparationSourceOptions, source: OwnPreparationOriginal, start: number, end: number) {
  const deadline = AbortSignal.timeout(30_000), signal = AbortSignal.any([options.signal, deadline]);
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let completed = false;
  const cancel = (value: Response) => { try { void value.body?.cancel().catch(() => {}); } catch { /* Already acquired. */ } };
  try {
    active(signal);
    await wait(Promise.resolve(options.check(structuredClone(source), signal)), signal);
    const pending = Promise.resolve(options.readRange(structuredClone(source), start, end, signal)).then(value => {
      response = value; if (signal.aborted) cancel(value); return value;
    });
    response = await wait(pending, signal);
    if (response.status !== 206 || response.headers.get("content-range") !== `bytes ${start}-${end}/${source.sizeBytes}`
      || (response.headers.has("content-length") && response.headers.get("content-length") !== String(end - start + 1))
      || (response.headers.has("content-encoding") && response.headers.get("content-encoding") !== "identity")
      || !response.body) fail("invalid_range");
    reader = response.body.getReader();
    const bytes = new Uint8Array(end - start + 1); let offset = 0;
    while (true) {
      const next = await wait(reader.read(), signal);
      if (next.done) break;
      if (!(next.value instanceof Uint8Array) || offset + next.value.length > bytes.length) fail("invalid_range");
      bytes.set(next.value, offset); offset += next.value.length;
    }
    if (offset !== bytes.length) fail("invalid_range");
    await wait(Promise.resolve(options.check(structuredClone(source), signal)), signal);
    active(signal); completed = true; return bytes;
  } catch (error) {
    if (error instanceof OwnPreparationSourceError) throw error;
    fail("source_unavailable");
  } finally {
    if (reader) { if (!completed) void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* Pending read cancelled. */ } }
    else if (response) cancel(response);
  }
}

type SourceEvent = { type: "line"; line: string } | { type: "source-summary"; receipt: OwnPreparationScan };
/** Two passes are deliberate: establish whole-file build/hash before binding
 * blocks, then replay and reverify EOF before the parser can emit its terminal.
 * At most the active range plus one prefetched range, zlib buffers and one bounded line; no whole-file call map. */
async function* sourceEvents(options: OwnPreparationSourceOptions): AsyncGenerator<SourceEvent> {
  const parsed = ownPreparationOriginalSchema.safeParse(options.source);
  if (!parsed.success) fail("invalid_source");
  const source = parsed.data, controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  options = { ...options, signal };
  active(signal);
  const rawHash = createHash("sha256"), decodedHash = createHash("sha256");
  let rawBytes = 0, decodedBytes = 0, lineCount = 0, headers = 0, markers = 0, sawData = false;
  const builds = new Set<string>();
  let first: Uint8Array | null = await range(options, source, 0, Math.min(source.sizeBytes, INGEST_CHUNK_MAXIMUM_BYTES) - 1);
  const compressed = first[0] === 0x1f && first[1] === 0x8b;
  async function* raw() {
    for (let start = 0; start < source.sizeBytes; start += INGEST_CHUNK_MAXIMUM_BYTES) {
      active(signal);
      const bytes: Uint8Array = start === 0 ? first! : await range(options, source, start,
        Math.min(source.sizeBytes, start + INGEST_CHUNK_MAXIMUM_BYTES) - 1);
      first = null; rawHash.update(bytes); rawBytes += bytes.length; yield bytes;
    }
  }
  const input = Readable.from(raw(), { objectMode: false, highWaterMark: 1 }), gunzip = compressed ? createGunzip() : null;
  const transferred = gunzip ? pipeline(input, gunzip, { signal }) : null;
  transferred?.catch(() => {});
  const stream = gunzip ?? input;
  const onAbort = () => { input.destroy(new OwnPreparationSourceError("aborted")); gunzip?.destroy(new OwnPreparationSourceError("aborted")); };
  signal.addEventListener("abort", onAbort, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true }); let carry = "";
  function inspect(rawLine: string) {
    active(signal); lineCount++;
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (Buffer.byteLength(line) > INGEST_CHUNK_MAXIMUM_BYTES) fail("too_large");
    const build = buildFromHeader(line); if (build) builds.add(build);
    if (line.startsWith("##fileformat=")) { if (++markers > 1 || headers || sawData) fail("invalid_vcf"); }
    if (line.startsWith("#CHROM")) {
      if (++headers !== 1 || sawData) fail("invalid_vcf");
      const columns = line.split("\t");
      if (columns.length !== 10 || !columns[9].trim()
        || columns.slice(0, 9).join("\t") !== "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT") fail("invalid_vcf");
    } else if (line && !line.startsWith("#")) {
      if (headers !== 1 || line.split("\t").length !== 10) fail("invalid_vcf");
      sawData = true;
    } else if (line.startsWith("#") && sawData) fail("invalid_vcf");
    return line;
  }
  try {
    active(signal);
    for await (const value of stream) {
      active(signal);
      const bytes = value as Buffer; decodedBytes += bytes.length;
      if (!Number.isSafeInteger(decodedBytes) || decodedBytes > source.maximumDecodedBytes) fail("too_large");
      decodedHash.update(bytes); carry += decoder.decode(bytes, { stream: true });
      let at: number;
      while ((at = carry.indexOf("\n")) >= 0) {
        yield { type: "line", line: inspect(carry.slice(0, at)) }; carry = carry.slice(at + 1);
      }
      if (Buffer.byteLength(carry) > INGEST_CHUNK_MAXIMUM_BYTES) fail("too_large");
    }
    carry += decoder.decode(); if (carry) yield { type: "line", line: inspect(carry) };
    if (transferred) await wait(transferred, signal);
    const rawSha256 = rawHash.digest("hex"), decodedSha256 = decodedHash.digest("hex");
    if (rawBytes !== source.sizeBytes || rawSha256 !== source.rawSha256 || decodedSha256 !== source.decodedSha256) fail("integrity_mismatch");
    if (headers !== 1 || markers !== 1 || !sawData) fail("invalid_vcf");
    if (builds.size !== 1 || !["GRCh37", "GRCh38"].includes([...builds][0])) fail("unsupported_build");
    await wait(Promise.resolve(options.check(structuredClone(source), signal)), signal);
    const receipt = ownPreparationScanSchema.parse({ version: "own-preparation-source-v1", source,
      rawBytes, decodedBytes, rawSha256, decodedSha256, compressed, lineCount, build: [...builds][0] });
    yield { type: "source-summary", receipt };
  } catch (error) {
    if (error instanceof OwnPreparationSourceError) throw error;
    if (signal.aborted) fail("aborted");
    fail("invalid_vcf");
  } finally {
    signal.removeEventListener("abort", onAbort); controller.abort(); input.destroy(); gunzip?.destroy();
    // The range reader owns late provider cancellation. Do not let a producer
    // that ignores signal keep this operation alive or mask its original error.
    if (transferred) void transferred.catch(() => {});
  }
}
export async function scanOwnPreparationSource(options: OwnPreparationSourceOptions): Promise<OwnPreparationScan> {
  let receipt: OwnPreparationScan | undefined;
  for await (const item of sourceEvents(options)) if (item.type === "source-summary") receipt = item.receipt;
  if (!receipt) fail("integrity_mismatch"); return receipt;
}
export async function* readOwnPreparationLines(options: OwnPreparationSourceOptions, expected: OwnPreparationScan): AsyncGenerator<string> {
  const scan = ownPreparationScanSchema.safeParse(expected);
  if (!scan.success || !isDeepStrictEqual(scan.data.source, options.source)) fail("invalid_source");
  let complete = false;
  for await (const item of sourceEvents(options)) {
    if (item.type === "line") yield item.line;
    else { if (!isDeepStrictEqual(item.receipt, scan.data)) fail("integrity_mismatch"); complete = true; }
  }
  if (!complete) fail("integrity_mismatch");
}
