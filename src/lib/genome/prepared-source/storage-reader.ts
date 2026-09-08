import "server-only";
import { z } from "zod";
import { decodePreparedBlock } from "./codec";
import { PREPARED_CONTAINER_MAX_BYTES, validatePreparedContainerDescriptor, type PreparedContainerDescriptor } from "./containers";
import { PREPARED_BLOCK_MAX_COMPRESSED_BYTES } from "./schema";
import { preparedObjectKeySchema as objectKeySchema, preparedStorageConfig } from "./storage-common";

const sequenceSchema = z.number().int().nonnegative().safe();
export class PreparedStorageReadError extends Error {
  constructor(readonly code: "invalid_selection" | "unavailable" | "integrity_mismatch" | "aborted") {
    super(code); this.name = "PreparedStorageReadError";
  }
}
export type PreparedRangeRequest = { objectKey: string; start: number; end: number; signal: AbortSignal };
export type PreparedRangeFetch = (request: PreparedRangeRequest) => Promise<Response>;
export type PreparedStorageReadOptions = {
  check: (signal: AbortSignal) => Promise<void>; fetchRange: PreparedRangeFetch; signal?: AbortSignal;
};

/** Server configuration only. Object keys must be assigned by the database's
 * registered-artifact protocol, never accepted from an HTTP request. No signed
 * URLs, redirects, public bucket, response cache, or provider retry is used. */
export function createPreparedRangeFetch(): PreparedRangeFetch {
  let origin: string, key: string;
  try { ({ origin, key } = preparedStorageConfig()); }
  catch { throw new PreparedStorageReadError("unavailable"); }
  return async ({ objectKey, start, end, signal }) => {
    if (!objectKeySchema.safeParse(objectKey).success || !sequenceSchema.safeParse(start).success
      || !sequenceSchema.safeParse(end).success || end < start
      || end - start + 1 > PREPARED_BLOCK_MAX_COMPRESSED_BYTES) throw new PreparedStorageReadError("invalid_selection");
    return fetch(`${origin}/storage/v1/object/authenticated/genomes/${objectKey}`, {
      headers: { Authorization: `Bearer ${key}`, Range: `bytes=${start}-${end}`, "Accept-Encoding": "identity" },
      cache: "no-store", redirect: "error", signal,
    });
  };
}

function active(signal: AbortSignal) {
  if (signal.aborted) throw new PreparedStorageReadError("aborted");
}
async function wait<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => {}); active(signal); }
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new PreparedStorageReadError("aborted"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([promise, cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}

/** Read one independently compressed block, bounded by its validated descriptor.
 * The check closure must resolve CURRENT authority for the EXACT immutable
 * container/object/source selection, including object identity and job or reader
 * claim; successful integrity checks cannot establish that authority themselves.
 * It runs before any provider read and after EOF, hashing and schema validation.
 * Caller must additionally recheck before committing a report or releasing a
 * complete multi-block response. No events escape on a late refusal.
 *
 * This adapter currently reads provisional parser blocks, not canonical calls.
 * I/O and authority callbacks must honor signal; the 30-second deadline also
 * interrupts stalled callbacks. Late provider responses are cancelled. */
export async function readPreparedStorageBlock(selection: {
  objectKey: string; container: PreparedContainerDescriptor; blockSequence: number;
}, options: PreparedStorageReadOptions) {
  let container: PreparedContainerDescriptor, objectKey: string, blockSequence: number;
  try {
    objectKey = objectKeySchema.parse(selection.objectKey);
    blockSequence = sequenceSchema.parse(selection.blockSequence);
    container = validatePreparedContainerDescriptor(selection.container);
  } catch { throw new PreparedStorageReadError("invalid_selection"); }
  const block = container.blocks.find(entry => entry.descriptor.sequence === blockSequence);
  if (!block) throw new PreparedStorageReadError("invalid_selection");
  return readPreparedStorageRange({ objectKey, offset: block.offset, length: block.length, total: container.byteCount }, {
    ...options, decode: (bytes, signal) => decodePreparedBlock((async function* () { yield bytes; })(), block.descriptor, { signal }),
  });
}

/** Shared I/O for validated parser/canonical block selections. Only internal
 * server adapters may supply decode: it must verify the exact descriptor's
 * complete hash and schema before returning. A valid range or caller's hash
 * does not establish source authority. Nothing escapes before the final check. */
export async function readPreparedStorageRange<T>(selection: {
  objectKey: string; offset: number; length: number; total: number;
}, options: PreparedStorageReadOptions & { decode: (bytes: Uint8Array, signal: AbortSignal) => Promise<T> }): Promise<T> {
  let objectKey: string, offset: number, length: number, total: number;
  try {
    objectKey = objectKeySchema.parse(selection.objectKey);
    offset = sequenceSchema.parse(selection.offset);
    length = sequenceSchema.positive().max(PREPARED_BLOCK_MAX_COMPRESSED_BYTES).parse(selection.length);
    total = sequenceSchema.positive().max(PREPARED_CONTAINER_MAX_BYTES).parse(selection.total);
    if (offset >= total || length > total - offset) throw new Error();
  } catch { throw new PreparedStorageReadError("invalid_selection"); }
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 30_000);
  timer.unref();
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancelRead: (() => void) | undefined;
  try {
    active(signal);
    await wait(options.check(signal), signal); active(signal);
    const pending = options.fetchRange({ objectKey, start: offset, end: offset + length - 1, signal });
    // A non-cooperative transport can return after cancellation; do not leave
    // its body downloading after this operation has already been refused.
    void pending.then(late => {
      response = late;
      if (signal.aborted) void late.body?.cancel().catch(() => {});
    }, () => {});
    response = await wait(pending, signal); active(signal);
    if (response.status !== 206 || !response.body
      || response.headers.get("content-range") !== `bytes ${offset}-${offset + length - 1}/${total}`
      || (response.headers.has("content-length") && response.headers.get("content-length") !== String(length))
      || (response.headers.has("content-encoding") && response.headers.get("content-encoding") !== "identity")) {
      throw new PreparedStorageReadError("integrity_mismatch");
    }
    const bytes = new Uint8Array(length);
    let count = 0;
    reader = response.body.getReader();
    const ownedReader = reader;
    cancelRead = () => { void ownedReader.cancel().catch(() => {}); };
    signal.addEventListener("abort", cancelRead, { once: true });
    for (;;) {
      const part = await wait(reader.read(), signal); active(signal);
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || part.value.length > bytes.length - count) {
        throw new PreparedStorageReadError("integrity_mismatch");
      }
      bytes.set(part.value, count); count += part.value.length;
    }
    if (count !== bytes.length) throw new PreparedStorageReadError("integrity_mismatch");
    const decoded = await wait(options.decode(bytes, signal), signal); active(signal);
    await wait(options.check(signal), signal); active(signal);
    return decoded;
  } catch (error) {
    if (signal.aborted) throw new PreparedStorageReadError("aborted");
    if (error instanceof PreparedStorageReadError) throw error;
    // Provider errors can contain object paths or credentials. Keep them out of
    // the error returned to a job/report caller and its logs.
    throw new PreparedStorageReadError("unavailable");
  } finally {
    clearTimeout(timer);
    if (cancelRead) signal.removeEventListener("abort", cancelRead);
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    else if (response?.body) void response.body.cancel().catch(() => {});
  }
}
