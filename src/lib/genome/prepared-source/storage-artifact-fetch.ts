import { fetchPreparedR2 } from "./r2-transport";
import { preparedStoredArtifactSchema } from "./artifact-identity";
import "server-only";
import { preparedStorageConfig } from "./storage-common";
import { type PreparedStoredArtifact } from "./storage-writer";

export class PreparedArtifactFetchError extends Error {
  constructor(readonly code: "invalid_artifact" | "integrity_mismatch" | "unavailable" | "aborted") {
    super(code); this.name = "PreparedArtifactFetchError";
  }
}
const schema = preparedStoredArtifactSchema;
// Inspect bounded data properties before Zod clones this tiny metadata envelope.
function preflight(value: unknown, depth = 0): void {
  const invalid = () => { throw new PreparedArtifactFetchError("invalid_artifact"); };
  if (depth > 2) invalid();
  if (typeof value === "string") { if (value.length > 128) invalid(); return; }
  if (typeof value === "number" && Number.isSafeInteger(value)) return;
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  let count = 0;
  for (const key in value as object) if (Object.prototype.hasOwnProperty.call(value, key) && ++count > 16) invalid();
  const keys = Reflect.ownKeys(value as object);
  if (keys.length > 16) invalid();
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !property.enumerable || !("value" in property)) invalid();
    preflight(property.value, depth + 1);
  }
}

/** Transport only. The caller supplies a finite operation signal and must use
 * readVerifiedPreparedArtifact for actual length/hash/EOF and current authority.
 * The receipt's historical write lease is not a present read authorization.
 * One request, one iterator, no buffering, redirects, cache, or retries. */
export function createPreparedArtifactFetch():
  (artifact: PreparedStoredArtifact, signal: AbortSignal) => Promise<AsyncIterable<Uint8Array>> {
  let config: ReturnType<typeof preparedStorageConfig>;
  try { config = preparedStorageConfig(); }
  catch { throw new PreparedArtifactFetchError("unavailable"); }
  return async (rawArtifact, external) => {
    const controller = new AbortController();
    const signal = AbortSignal.any([external, controller.signal]);
    let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let closed = false, ended = false, reading = false, acquired = false;
    const active = () => { if (signal.aborted) throw new PreparedArtifactFetchError("aborted"); };
    function close() {
      if (closed) return; closed = true;
      signal.removeEventListener("abort", close);
      // Cancellation is best effort and cannot delay the caller's deadline or
      // expose provider errors. The observer below owns any late Response.
      try {
        if (reader) {
          void reader.cancel().catch(() => {});
          reader.releaseLock();
        } else if (response) void response.body?.cancel().catch(() => {});
      } catch { /* Preserve the original error. */ }
      controller.abort();
    }
    signal.addEventListener("abort", close, { once: true });
    async function wait<T>(pending: Promise<T>): Promise<T> {
      if (signal.aborted) { void pending.catch(() => {}); active(); }
      let onAbort = () => {};
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(new PreparedArtifactFetchError("aborted"));
        signal.addEventListener("abort", onAbort, { once: true });
      });
      try { const result = await Promise.race([pending, cancelled]); active(); return result; }
      finally { signal.removeEventListener("abort", onAbort); }
    }
    function failure(error: unknown): PreparedArtifactFetchError {
      if (external.aborted) return new PreparedArtifactFetchError("aborted");
      return error instanceof PreparedArtifactFetchError ? error : new PreparedArtifactFetchError("unavailable");
    }
    try {
      active(); preflight(rawArtifact);
      const parsed = schema.safeParse(rawArtifact);
      if (!parsed.success) throw new PreparedArtifactFetchError("invalid_artifact");
      const artifact = parsed.data;
      const pending = artifact.receipt.version === "own-preparation-artifact-v2"
        ? fetchPreparedR2({ receipt: artifact.receipt, stored: artifact, operation: "get", signal })
        : fetch(`${config.origin}/storage/v1/object/authenticated/genomes/${artifact.receipt.objectKey}`, {
        method: "GET", signal, cache: "no-store", redirect: "error",
        headers: { Authorization: `Bearer ${config.key}`, apikey: config.key, "Accept-Encoding": "identity" },
      });
      void pending.then(late => {
        response = late;
        if (closed || signal.aborted) { try { void late.body?.cancel().catch(() => {}); } catch { /* Best effort. */ } }
      }, () => {});
      response = await wait(pending);
      if (response.status !== 200 || response.redirected || !response.body ||
        response.headers.has("content-range") ||
        (response.headers.has("content-encoding") && response.headers.get("content-encoding") !== "identity") ||
        (response.headers.has("content-length") && response.headers.get("content-length") !== String(artifact.receipt.byteCount)))
        throw new PreparedArtifactFetchError("integrity_mismatch");
      reader = response.body.getReader(); active();
      // A custom iterator owns cancellation even before its first next(), unlike
      // a generator whose finally block has not started yet.
      const iterator: AsyncIterableIterator<Uint8Array> = {
        [Symbol.asyncIterator]() {
          if (acquired) { close(); throw new PreparedArtifactFetchError("unavailable"); }
          acquired = true; return this;
        },
        async next() {
          if (ended) return { done: true, value: undefined };
          try {
            active();
            if (reading) throw new PreparedArtifactFetchError("unavailable");
            reading = true;
            const next = await wait(reader!.read());
            if (next.done) { ended = true; close(); return { done: true, value: undefined }; }
            if (!(next.value instanceof Uint8Array)) throw new PreparedArtifactFetchError("integrity_mismatch");
            return { done: false, value: next.value };
          } catch (error) { const safe = failure(error); close(); throw safe; }
          finally { reading = false; }
        },
        async return() { ended = true; close(); return { done: true, value: undefined }; },
        async throw() { ended = true; close(); throw new PreparedArtifactFetchError("unavailable"); },
      };
      return iterator;
    } catch (error) { const safe = failure(error); close(); throw safe; }
  };
}
