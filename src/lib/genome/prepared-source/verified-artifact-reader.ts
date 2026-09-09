import { preparedStoredArtifactSchema } from "./artifact-identity";
import "server-only";
import { createHash } from "node:crypto";
import { type PreparedStoredArtifact } from "./storage-writer";

export type VerifiedArtifactReadOptions = {
  readArtifact: (artifact: PreparedStoredArtifact, signal: AbortSignal) => AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>;
  check: (artifact: PreparedStoredArtifact, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
};
export class VerifiedArtifactReadError extends Error {
  constructor(readonly code: "invalid_artifact" | "integrity_mismatch" | "unavailable" | "aborted") {
    super(code); this.name = "VerifiedArtifactReadError";
  }
}
const schema = preparedStoredArtifactSchema;
// This is a tiny JSON metadata envelope, never genetic content. Inspect data
// descriptors before schema access; bound enumerable width before own-key
// enumeration (JavaScript has no lazy hidden-own-key enumeration).
function preflight(value: unknown, depth = 0): void {
  if (depth > 2) throw new VerifiedArtifactReadError("invalid_artifact");
  if (typeof value === "string") { if (value.length > 128) throw new VerifiedArtifactReadError("invalid_artifact"); return; }
  if (typeof value === "number" && Number.isSafeInteger(value)) return;
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new VerifiedArtifactReadError("invalid_artifact");
  let count = 0;
  for (const key in value) if (Object.prototype.hasOwnProperty.call(value, key) && ++count > 16) throw new VerifiedArtifactReadError("invalid_artifact");
  const keys = Reflect.ownKeys(value);
  if (keys.length > 16) throw new VerifiedArtifactReadError("invalid_artifact");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor)) throw new VerifiedArtifactReadError("invalid_artifact");
    preflight(descriptor.value, depth + 1);
  }
}

/** Owned bounded bytes through full EOF/hash, with current checks on BOTH sides
 * of the read. A receipt is not permission: check must resolve exact registered
 * artifact membership and current claim/source authority. At most 8MiB, fixed
 * 30s operation maximum AND caller cancellation; no lease renewal or retries.
 * Producers must honor signal/own late I/O. Late acquired iterators are closed
 * best-effort; cleanup errors never replace the integrity/authority failure. */
export async function readVerifiedPreparedArtifact(rawArtifact: PreparedStoredArtifact,
  options: VerifiedArtifactReadOptions): Promise<Uint8Array> {
  const deadline = new AbortController(), signal = AbortSignal.any([options.signal, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(), 30_000); timer.unref();
  const active = () => { if (signal.aborted) throw new VerifiedArtifactReadError("aborted"); };
  let iterator: AsyncIterator<Uint8Array> | undefined, closed = false;
  function close() {
    if (!iterator || closed) return; closed = true;
    try { if (iterator.return) void Promise.resolve(iterator.return()).catch(() => {}); }
    catch { /* Never mask the original failure. */ }
  }
  const abort = () => close(); signal.addEventListener("abort", abort, { once: true });
  async function wait<T>(pending: Promise<T>): Promise<T> {
    if (signal.aborted) { void pending.catch(() => {}); active(); }
    let onAbort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new VerifiedArtifactReadError("aborted")); signal.addEventListener("abort", onAbort, { once: true });
    });
    try { const value = await Promise.race([pending, cancelled]); active(); return value; }
    finally { signal.removeEventListener("abort", onAbort); }
  }
  try {
    active(); preflight(rawArtifact);
    const parsed = schema.safeParse(rawArtifact);
    if (!parsed.success || parsed.data.receipt.byteCount > 8_388_608) throw new VerifiedArtifactReadError("invalid_artifact");
    const artifact = parsed.data;
    await wait(options.check(structuredClone(artifact), signal)); active();
    // First observer owns the iterator before any awaiting continuation can
    // abort. It also closes a stream delivered after a prior cancellation.
    const acquired = Promise.resolve(options.readArtifact(structuredClone(artifact), signal)).then(source => {
      iterator = source[Symbol.asyncIterator](); if (signal.aborted) close(); return iterator;
    });
    const current = await wait(acquired);
    const bytes = new Uint8Array(artifact.receipt.byteCount), digest = createHash("sha256"); let count = 0;
    for (;;) {
      active(); const next = await wait(Promise.resolve(current.next()));
      if (next.done) break;
      if (!(next.value instanceof Uint8Array) || next.value.byteLength > bytes.length - count) throw new VerifiedArtifactReadError("integrity_mismatch");
      bytes.set(next.value, count); digest.update(bytes.subarray(count, count + next.value.byteLength)); count += next.value.byteLength;
    }
    if (count !== bytes.length || digest.digest("hex") !== artifact.receipt.sha256) throw new VerifiedArtifactReadError("integrity_mismatch");
    await wait(options.check(structuredClone(artifact), signal)); active(); return bytes;
  } catch (error) {
    if (signal.aborted) throw new VerifiedArtifactReadError("aborted");
    if (error instanceof VerifiedArtifactReadError) throw error;
    throw new VerifiedArtifactReadError("unavailable");
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); close(); deadline.abort(); }
}
