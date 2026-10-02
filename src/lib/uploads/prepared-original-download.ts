import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { preparedStorageConfig } from "../genome/prepared-source/storage-common";

const uuid = z.uuid(), positive = z.number().int().positive().safe();
export const preparedOriginalDownloadSourceSchema = z.object({
  version: z.literal("prepared-original-download-v1"), fileId: uuid, manifestId: uuid,
  sourceRevision: positive, rawSha256: z.string().regex(/^[0-9a-f]{64}$/), bucket: z.literal("genomes"),
  objectId: uuid, objectKey: uuid, storageVersion: uuid, sizeBytes: positive,
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();
export type PreparedOriginalDownloadSource = z.infer<typeof preparedOriginalDownloadSourceSchema>;
export type OriginalByteSource = Pick<PreparedOriginalDownloadSource,
  "fileId" | "sourceRevision" | "rawSha256" | "bucket" | "objectId" | "objectKey" | "storageVersion" | "sizeBytes" | "expiresAt">;
export type OriginalRangeOptions<Source extends OriginalByteSource> = {
  source: Source;
  /** Current SQL authorization of this exact source, including manifest, known
   * physical identity, fixed retirement/session/consent deadline and lifecycle.
   * An earlier grant or the descriptor alone is never read permission. */
  check: (source: Source, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  /** Optional trusted transport seam; production defaults to the configured
   * service-authenticated original store. Never accept a URL from a request. */
  readRange?: (source: Source, start: number, end: number, signal: AbortSignal) => Promise<Response>;
};
export type PreparedOriginalDownloadOptions = OriginalRangeOptions<PreparedOriginalDownloadSource>;
export class PreparedOriginalDownloadError extends Error {
  constructor(readonly code: "invalid_source" | "integrity_mismatch" | "unavailable" | "aborted") {
    super(code); this.name = "PreparedOriginalDownloadError";
  }
}
const fail = (code: PreparedOriginalDownloadError["code"]): never => { throw new PreparedOriginalDownloadError(code); };
const RANGE_BYTES = 1_048_576;

/** Internal configured original-store transport. Permission, immutable physical
 * identity, ranges and complete EOF remain the checked stream's responsibility.
 * This never chooses archive delivery or accepts a caller URL. */
export function readConfiguredOriginalRange(source:OriginalByteSource,start:number,end:number,signal:AbortSignal):Promise<Response>{
  const config=preparedStorageConfig();
  return fetch(`${config.origin}/storage/v1/object/authenticated/genomes/${source.objectKey}`,{
    method:"GET",signal,cache:"no-store",redirect:"error",
    headers:{Authorization:`Bearer ${config.key}`,apikey:config.key,"Accept-Encoding":"identity",Range:`bytes=${start}-${end}`},
  });
}

/** Revocable streamed original bytes, never a transferable signed download URL.
 * One <=1MiB owned range at a time; no read-ahead across consumer backpressure.
 * Each response is fully drained and checked before release. Full original hash
 * is checked before the LAST range is released, with another current check at
 * actual iterator EOF. Earlier delivered bytes cannot be retracted after later
 * corruption/revocation; the download then errors and must not be called whole.
 * This returns the raw stored original (including gzip), never decoded calls.
 */
export async function* streamPreparedOriginalDownload(options: PreparedOriginalDownloadOptions): AsyncGenerator<Uint8Array> {
  yield* streamVerifiedOriginalRanges(options, preparedOriginalDownloadSourceSchema);
}

/** Shared complete-range transport. Its callers supply a fixed internal
 * source schema; ordinary sources never fabricate a prepared manifest. */
export async function* streamVerifiedOriginalRanges<Source extends OriginalByteSource>(
  options: OriginalRangeOptions<Source>, schema: z.ZodType<Source>,
): AsyncGenerator<Uint8Array> {
  let source: Source;
  try { source = schema.parse(options.source); }
  catch { return fail("invalid_source"); }
  const controller = new AbortController(), signal = AbortSignal.any([options.signal, controller.signal]);
  const remaining = Math.min(300_000, Date.parse(source.expiresAt) - Date.now());
  if (remaining <= 0) return fail("unavailable");
  const timer = setTimeout(() => controller.abort(), remaining); timer.unref();
  const active = (current = signal) => { if (current.aborted) fail("aborted"); if (Date.now() >= Date.parse(source.expiresAt)) fail("unavailable"); };
  async function wait<T>(pending: PromiseLike<T>, current: AbortSignal): Promise<T> {
    const started = Promise.resolve(pending);
    if (current.aborted) { void started.catch(() => {}); fail("aborted"); }
    let abort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new PreparedOriginalDownloadError("aborted"));
      current.addEventListener("abort", abort, { once: true });
    });
    try { const value = await Promise.race([started, cancelled]); active(current); return value; }
    finally { current.removeEventListener("abort", abort); }
  }
  async function check(current: AbortSignal) {
    active(current);
    const bound = new AbortController(), timeout = setTimeout(() => bound.abort(), 30_000); timeout.unref();
    const checkedSignal = AbortSignal.any([current, bound.signal]);
    try { await wait(options.check(structuredClone(source), checkedSignal), checkedSignal); active(current); }
    finally { clearTimeout(timeout); }
  }
  try {
    active();
    const readRange = options.readRange ?? readConfiguredOriginalRange;
    const hash = createHash("sha256");
    for (let start = 0; start < source.sizeBytes; start += RANGE_BYTES) {
      const end = Math.min(start + RANGE_BYTES, source.sizeBytes) - 1, count = end - start + 1;
      const request = new AbortController(), current = AbortSignal.any([signal, request.signal]);
      const requestTimer = setTimeout(() => request.abort(), 30_000); requestTimer.unref();
      let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let closed = false, completed = false;
      function close() {
        if (closed) return; closed = true;
        try {
          if (reader) void reader.cancel().catch(() => {});
          else if (response) void response.body?.cancel().catch(() => {});
        } catch { /* Preserve original error; cancellation cannot prove absence. */ }
      }
      current.addEventListener("abort", close, { once: true });
      let bytes: Uint8Array;
      try {
        await check(current);
        const pending = Promise.resolve(readRange(structuredClone(source), start, end, current));
        void pending.then(value => {
          response = value;
          if (closed || current.aborted) { try { void value.body?.cancel().catch(() => {}); } catch { /* Late response ownership. */ } }
        }, () => {});
        try { response = await wait(pending, current); } catch (error) { close(); throw error; }
        if (response.status !== 206 || response.redirected || !response.body
          || response.headers.get("content-range") !== `bytes ${start}-${end}/${source.sizeBytes}`
          || (response.headers.has("content-length") && response.headers.get("content-length") !== String(count))
          || (response.headers.has("content-encoding") && response.headers.get("content-encoding") !== "identity")) fail("integrity_mismatch");
        reader = response.body!.getReader(); bytes = new Uint8Array(count); let offset = 0;
        for (;;) {
          const next = await wait(reader.read(), current);
          if (next.done) break;
          if (!(next.value instanceof Uint8Array) || next.value.length > count - offset) fail("integrity_mismatch");
          bytes.set(next.value, offset); offset += next.value.length;
        }
        if (offset !== count) fail("integrity_mismatch");
        hash.update(bytes);
        if (end + 1 === source.sizeBytes && hash.digest("hex") !== source.rawSha256) fail("integrity_mismatch");
        await check(current); completed = true;
      } finally {
        clearTimeout(requestTimer); current.removeEventListener("abort", close);
        if (!completed) close();
        if (reader) { try { reader.releaseLock(); } catch { /* Cancelled pending read. */ } }
        request.abort();
      }
      active(); yield bytes;
    }
    // No more source bytes are emitted after this final authorization. It also
    // catches revocation while the consumer was paused after the last range.
    await check(signal); active();
  } catch (error) {
    if (signal.aborted) return fail("aborted");
    if (error instanceof PreparedOriginalDownloadError) throw error;
    return fail("unavailable");
  } finally { clearTimeout(timer); controller.abort(); }
}
