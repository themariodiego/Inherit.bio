import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { preparedBlockDescriptorSchema, preparedSourceBindingSchema,
  type PreparedBlockDescriptor, type PreparedSourceBinding } from "./schema";

export const PREPARED_CONTAINER_TARGET_BYTES = 1_048_576;
export const PREPARED_CONTAINER_MAX_BYTES = 8_388_608;
export const PREPARED_CONTAINER_MAX_BLOCKS = 128;
const integer = z.number().int().nonnegative().safe();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const containerSchema = z.object({ version: z.literal("prepared-container-v1"), state: z.literal("provisional"),
  source: preparedSourceBindingSchema, sequence: integer,
  byteCount: integer.positive().max(PREPARED_CONTAINER_MAX_BYTES), sha256: hash,
  blocks: z.array(z.object({ offset: integer.max(PREPARED_CONTAINER_MAX_BYTES),
    length: integer.positive().max(PREPARED_CONTAINER_MAX_BYTES), descriptor: preparedBlockDescriptorSchema }).strict())
    .min(1).max(PREPARED_CONTAINER_MAX_BLOCKS),
}).strict();
export type PreparedContainerDescriptor = z.infer<typeof containerSchema>;
export type PreparedContainerSink = (container: { descriptor: PreparedContainerDescriptor; bytes: Uint8Array },
  signal?: AbortSignal) => Promise<unknown>;
export class PreparedContainerError extends Error {
  constructor(readonly code: "invalid_container" | "integrity_mismatch" | "sequence_mismatch" | "too_large" |
    "ack_mismatch" | "invalid_state" | "aborted") {
    super(code); this.name = "PreparedContainerError";
  }
}
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Validates metadata for whole-object OR range-only reads. Expected metadata
 * must come from an independently authorized immutable manifest. No URL/key or
 * caller-supplied hash establishes authority. Offsets are zero-based byte ranges. */
export function validatePreparedContainerDescriptor(raw: unknown, expectedSource?: PreparedSourceBinding): PreparedContainerDescriptor {
  const blocks = raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? Reflect.get(raw, "blocks") : undefined;
  if (!Array.isArray(blocks) || blocks.length < 1 || blocks.length > PREPARED_CONTAINER_MAX_BLOCKS) {
    throw new PreparedContainerError("invalid_container");
  }
  const parsed = containerSchema.safeParse(raw);
  if (!parsed.success) throw new PreparedContainerError("invalid_container");
  const container = parsed.data;
  if (expectedSource && !isDeepStrictEqual(container.source, preparedSourceBindingSchema.parse(expectedSource))) {
    throw new PreparedContainerError("integrity_mismatch");
  }
  let end = 0, previous: number | undefined;
  for (const entry of container.blocks) {
    if (entry.offset !== end || entry.length !== entry.descriptor.compressedBytes
      || entry.offset + entry.length > container.byteCount
      || !isDeepStrictEqual(entry.descriptor.source, container.source)) throw new PreparedContainerError("invalid_container");
    if (previous !== undefined && entry.descriptor.sequence !== previous + 1) throw new PreparedContainerError("sequence_mismatch");
    previous = entry.descriptor.sequence; end += entry.length;
  }
  if (end !== container.byteCount) throw new PreparedContainerError("invalid_container");
  return container;
}

/** Optional full-object integrity check. Range readers instead validate this
 * descriptor, fetch exactly offset/length and call decodePreparedBlock with the
 * nested block descriptor; they need not download the entire container. */
export function verifyPreparedContainerBytes(bytes: Uint8Array, expected: PreparedContainerDescriptor): void {
  const descriptor = validatePreparedContainerDescriptor(expected);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== descriptor.byteCount || sha(bytes) !== descriptor.sha256) {
    throw new PreparedContainerError("integrity_mismatch");
  }
  for (const block of descriptor.blocks) {
    if (sha(bytes.subarray(block.offset, block.offset + block.length)) !== block.descriptor.compressedSha256) {
      throw new PreparedContainerError("integrity_mismatch");
    }
  }
}

async function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) { void promise.catch(() => {}); throw new PreparedContainerError("aborted"); }
  if (!signal) return promise;
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new PreparedContainerError("aborted")); signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([promise, cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}

/** No compression or interpretation: copies independently encoded block bytes.
 * append() is BUFFER ACCEPTANCE, not durable acknowledgement. A run adapter must
 * await flush() before acknowledging writeRun; call finish() only after actual
 * upstream EOF/validation. This packer cannot prove that the caller saw EOF.
 * All containers stay provisional. A sink must implement real immutable writes
 * and return the exact descriptor; this function does not verify provider storage.
 *
 * One <=8MiB container, <=128 descriptors and one pending block are retained.
 * flush briefly owns a concatenated copy as well. Calls must be awaited serially;
 * concurrent calls are refused, never queued, without cancelling the active
 * valid operation. On that operation's failure/abort, buffered bytes are
 * discarded and the packer closes. Any already-started remote write remains
 * caller-owned for cleanup, including uncertain acknowledgement. Honor signal
 * in sink I/O; cancellation cannot revoke a previously submitted write.
 */
export function createPreparedContainerPacker(options: { source: PreparedSourceBinding; sink: PreparedContainerSink;
  firstBlockSequence?: number; signal?: AbortSignal }) {
  const source = preparedSourceBindingSchema.parse(options.source);
  let nextBlock = integer.parse(options.firstBlockSequence ?? 0);
  const { signal, sink } = options;
  let state: "open" | "finished" | "failed" = "open", busy = false;
  let chunks: Buffer[] = [], ranges: PreparedContainerDescriptor["blocks"] = [], bufferedBytes = 0;
  let containerCount = 0, blockCount = 0, byteCount = 0;
  const clear = () => { chunks = []; ranges = []; bufferedBytes = 0; };
  const aborted = () => { state = "failed"; clear(); };
  const detach = () => signal?.removeEventListener("abort", aborted);
  const check = () => {
    if (signal?.aborted) throw new PreparedContainerError("aborted");
    if (state !== "open") throw new PreparedContainerError("invalid_state");
  };
  check(); signal?.addEventListener("abort", aborted, { once: true });

  async function serial<T>(operation: () => Promise<T>): Promise<T> {
    // Do not retain/queue inputs supplied by a concurrent caller.
    if (busy) throw new PreparedContainerError("invalid_state");
    check(); busy = true;
    try { return await operation(); }
    catch (error) { state = "failed"; clear(); detach(); throw error; }
    finally { busy = false; }
  }
  async function flushBuffered(): Promise<PreparedContainerDescriptor | null> {
    check(); if (!ranges.length) return null;
    const bytes = Buffer.concat(chunks, bufferedBytes);
    const expected = validatePreparedContainerDescriptor({ version: "prepared-container-v1", state: "provisional",
      source, sequence: containerCount, byteCount: bufferedBytes, sha256: sha(bytes), blocks: ranges });
    const ack = await awaitWithAbort(sink({ descriptor: structuredClone(expected), bytes }, signal), signal);
    check();
    let parsed: PreparedContainerDescriptor;
    try { parsed = validatePreparedContainerDescriptor(ack, source); }
    catch { throw new PreparedContainerError("ack_mismatch"); }
    if (!isDeepStrictEqual(parsed, expected) || sha(bytes) !== expected.sha256) throw new PreparedContainerError("ack_mismatch");
    containerCount++; clear();
    return structuredClone(expected);
  }
  return {
    append(block: { descriptor: PreparedBlockDescriptor; compressed: Uint8Array }): Promise<void> {
      return serial(async () => {
        const parsed = preparedBlockDescriptorSchema.safeParse(block?.descriptor);
        const compressed = block?.compressed;
        if (!parsed.success || !(compressed instanceof Uint8Array)) throw new PreparedContainerError("invalid_container");
        const descriptor = parsed.data;
        if (!isDeepStrictEqual(descriptor.source, source)) throw new PreparedContainerError("integrity_mismatch");
        if (descriptor.sequence !== nextBlock) throw new PreparedContainerError("sequence_mismatch");
        if (compressed.byteLength !== descriptor.compressedBytes) throw new PreparedContainerError("integrity_mismatch");
        const owned = Buffer.from(compressed);
        if (sha(owned) !== descriptor.compressedSha256) throw new PreparedContainerError("integrity_mismatch");
        if (descriptor.compressedBytes > PREPARED_CONTAINER_MAX_BYTES
          || !Number.isSafeInteger(nextBlock + 1) || !Number.isSafeInteger(byteCount + descriptor.compressedBytes)) {
          throw new PreparedContainerError("too_large");
        }
        // Own the validated bytes before any await; callers may reuse their
        // input buffers as soon as append resolves (or while a flush awaits).
        if (ranges.length && (bufferedBytes + owned.length > PREPARED_CONTAINER_TARGET_BYTES
          || ranges.length === PREPARED_CONTAINER_MAX_BLOCKS)) await flushBuffered();
        check();
        ranges.push({ offset: bufferedBytes, length: owned.length, descriptor }); chunks.push(owned);
        bufferedBytes += owned.length; nextBlock++; blockCount++; byteCount += owned.length;
        if (bufferedBytes >= PREPARED_CONTAINER_TARGET_BYTES || ranges.length === PREPARED_CONTAINER_MAX_BLOCKS) await flushBuffered();
      });
    },
    flush(): Promise<PreparedContainerDescriptor | null> { return serial(flushBuffered); },
    finish() {
      return serial(async () => {
        await flushBuffered(); check(); state = "finished"; detach();
        return { version: "prepared-containers-v1" as const, state: "provisional" as const,
          source: structuredClone(source), containerCount, blockCount, byteCount };
      });
    },
  };
}
