import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { canonicalBlockDescriptorSchema, type CanonicalBlockDescriptor } from "./canonical-codec";
import { canonicalBindingSchema, type CanonicalBinding } from "./canonical-schema";

export const CANONICAL_CONTAINER_TARGET_BYTES = 1_048_576;
export const CANONICAL_CONTAINER_MAX_BYTES = 8_388_608;
export const CANONICAL_CONTAINER_MAX_BLOCKS = 128;
const integer = z.number().int().nonnegative().safe();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const containerSchema = z.object({ version: z.literal("prepared-canonical-container-v1"), state: z.literal("provisional"),
  binding: canonicalBindingSchema, sequence: integer,
  byteCount: integer.positive().max(CANONICAL_CONTAINER_MAX_BYTES), sha256: hash,
  blocks: z.array(z.object({ offset: integer.max(CANONICAL_CONTAINER_MAX_BYTES),
    length: integer.positive().max(CANONICAL_CONTAINER_MAX_BYTES), descriptor: canonicalBlockDescriptorSchema }).strict())
    .min(1).max(CANONICAL_CONTAINER_MAX_BLOCKS),
}).strict();
export type CanonicalContainerDescriptor = z.infer<typeof containerSchema>;
export type CanonicalContainerSink = (container: { descriptor: CanonicalContainerDescriptor; bytes: Uint8Array },
  signal?: AbortSignal) => Promise<unknown>;
export class CanonicalContainerError extends Error {
  constructor(readonly code: "invalid_container" | "integrity_mismatch" | "sequence_mismatch" | "too_large" |
    "ack_mismatch" | "invalid_state" | "aborted") {
    super(code); this.name = "CanonicalContainerError";
  }
}
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Validates metadata for whole-object OR range-only reads. Expected metadata
 * must come from an independently authorized immutable manifest. No URL/key or
 * caller-supplied hash establishes authority. Offsets are zero-based byte ranges. */
export function validateCanonicalContainerDescriptor(raw: unknown, expectedBinding?: CanonicalBinding): CanonicalContainerDescriptor {
  const blocks = raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? Reflect.get(raw, "blocks") : undefined;
  if (!Array.isArray(blocks) || blocks.length < 1 || blocks.length > CANONICAL_CONTAINER_MAX_BLOCKS) {
    throw new CanonicalContainerError("invalid_container");
  }
  const parsed = containerSchema.safeParse(raw);
  if (!parsed.success) throw new CanonicalContainerError("invalid_container");
  const container = parsed.data;
  if (expectedBinding && !isDeepStrictEqual(container.binding, canonicalBindingSchema.parse(expectedBinding))) {
    throw new CanonicalContainerError("integrity_mismatch");
  }
  let end = 0, previous: number | undefined;
  for (const entry of container.blocks) {
    if (entry.offset !== end || entry.length !== entry.descriptor.compressedBytes
      || entry.offset + entry.length > container.byteCount
      || !isDeepStrictEqual(entry.descriptor.binding, container.binding)) throw new CanonicalContainerError("invalid_container");
    if (previous !== undefined && entry.descriptor.sequence !== previous + 1) throw new CanonicalContainerError("sequence_mismatch");
    previous = entry.descriptor.sequence; end += entry.length;
  }
  if (end !== container.byteCount) throw new CanonicalContainerError("invalid_container");
  return container;
}

/** Optional full-object integrity check. Range readers instead validate this
 * descriptor, fetch exactly offset/length and call decodeCanonicalBlock with the
 * nested block descriptor; they need not download the entire container. */
export function verifyCanonicalContainerBytes(bytes: Uint8Array, expected: CanonicalContainerDescriptor): void {
  const descriptor = validateCanonicalContainerDescriptor(expected);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== descriptor.byteCount || sha(bytes) !== descriptor.sha256) {
    throw new CanonicalContainerError("integrity_mismatch");
  }
  for (const block of descriptor.blocks) {
    if (sha(bytes.subarray(block.offset, block.offset + block.length)) !== block.descriptor.compressedSha256) {
      throw new CanonicalContainerError("integrity_mismatch");
    }
  }
}

async function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) { void promise.catch(() => {}); throw new CanonicalContainerError("aborted"); }
  if (!signal) return promise;
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new CanonicalContainerError("aborted")); signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([promise, cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}

/** Canonical blocks stay distinct from parser-event blocks and retain their
 * source plus normalized evidence. No target sorting or index is added here.
 * No compression or interpretation: copies independently encoded block bytes.
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
export function createCanonicalContainerPacker(options: { binding: CanonicalBinding; sink: CanonicalContainerSink;
  firstBlockSequence?: number; signal?: AbortSignal }) {
  const binding = canonicalBindingSchema.parse(options.binding);
  let nextBlock = integer.parse(options.firstBlockSequence ?? 0);
  const { signal, sink } = options;
  let state: "open" | "finished" | "failed" = "open", busy = false;
  let chunks: Buffer[] = [], ranges: CanonicalContainerDescriptor["blocks"] = [], bufferedBytes = 0;
  let containerCount = 0, blockCount = 0, byteCount = 0;
  const clear = () => { chunks = []; ranges = []; bufferedBytes = 0; };
  const aborted = () => { state = "failed"; clear(); };
  const detach = () => signal?.removeEventListener("abort", aborted);
  const check = () => {
    if (signal?.aborted) throw new CanonicalContainerError("aborted");
    if (state !== "open") throw new CanonicalContainerError("invalid_state");
  };
  check(); signal?.addEventListener("abort", aborted, { once: true });

  async function serial<T>(operation: () => Promise<T>): Promise<T> {
    // Do not retain/queue inputs supplied by a concurrent caller.
    if (busy) throw new CanonicalContainerError("invalid_state");
    check(); busy = true;
    try { return await operation(); }
    catch (error) { state = "failed"; clear(); detach(); throw error; }
    finally { busy = false; }
  }
  async function flushBuffered(): Promise<CanonicalContainerDescriptor | null> {
    check(); if (!ranges.length) return null;
    const bytes = Buffer.concat(chunks, bufferedBytes);
    const expected = validateCanonicalContainerDescriptor({ version: "prepared-canonical-container-v1", state: "provisional",
      binding, sequence: containerCount, byteCount: bufferedBytes, sha256: sha(bytes), blocks: ranges });
    const ack = await awaitWithAbort(sink({ descriptor: structuredClone(expected), bytes }, signal), signal);
    check();
    let parsed: CanonicalContainerDescriptor;
    try { parsed = validateCanonicalContainerDescriptor(ack, binding); }
    catch { throw new CanonicalContainerError("ack_mismatch"); }
    if (!isDeepStrictEqual(parsed, expected) || sha(bytes) !== expected.sha256) throw new CanonicalContainerError("ack_mismatch");
    containerCount++; clear();
    return structuredClone(expected);
  }
  return {
    append(block: { descriptor: CanonicalBlockDescriptor; compressed: Uint8Array }): Promise<void> {
      return serial(async () => {
        const parsed = canonicalBlockDescriptorSchema.safeParse(block?.descriptor);
        const compressed = block?.compressed;
        if (!parsed.success || !(compressed instanceof Uint8Array)) throw new CanonicalContainerError("invalid_container");
        const descriptor = parsed.data;
        if (!isDeepStrictEqual(descriptor.binding, binding)) throw new CanonicalContainerError("integrity_mismatch");
        if (descriptor.sequence !== nextBlock) throw new CanonicalContainerError("sequence_mismatch");
        if (compressed.byteLength !== descriptor.compressedBytes) throw new CanonicalContainerError("integrity_mismatch");
        const owned = Buffer.from(compressed);
        if (sha(owned) !== descriptor.compressedSha256) throw new CanonicalContainerError("integrity_mismatch");
        if (descriptor.compressedBytes > CANONICAL_CONTAINER_MAX_BYTES
          || !Number.isSafeInteger(nextBlock + 1) || !Number.isSafeInteger(byteCount + descriptor.compressedBytes)) {
          throw new CanonicalContainerError("too_large");
        }
        // Own the validated bytes before any await; callers may reuse their
        // input buffers as soon as append resolves (or while a flush awaits).
        if (ranges.length && (bufferedBytes + owned.length > CANONICAL_CONTAINER_TARGET_BYTES
          || ranges.length === CANONICAL_CONTAINER_MAX_BLOCKS)) await flushBuffered();
        check();
        ranges.push({ offset: bufferedBytes, length: owned.length, descriptor }); chunks.push(owned);
        bufferedBytes += owned.length; nextBlock++; blockCount++; byteCount += owned.length;
        if (bufferedBytes >= CANONICAL_CONTAINER_TARGET_BYTES || ranges.length === CANONICAL_CONTAINER_MAX_BLOCKS) await flushBuffered();
      });
    },
    flush(): Promise<CanonicalContainerDescriptor | null> { return serial(flushBuffered); },
    finish() {
      return serial(async () => {
        await flushBuffered(); check(); state = "finished"; detach();
        return { version: "prepared-canonical-containers-v1" as const, state: "provisional" as const,
          binding: structuredClone(binding), containerCount, blockCount, byteCount };
      });
    },
  };
}
