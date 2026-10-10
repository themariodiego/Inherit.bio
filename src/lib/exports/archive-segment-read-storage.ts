import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";
import { ARCHIVE_BUCKET, validateArchiveSegment, type ArchiveAttempt, type StoredArchiveSegment } from "./archive-segments";
import { ArchiveSegmentReadError, type ArchiveSegmentObject } from "./archive-segment-reader";

const refused = (): never => { throw new ArchiveSegmentReadError("storage"); };
const etag = (value: unknown) => typeof value === "string" && /^(?:[0-9a-f]{32}(?:-[1-9][0-9]*)?|"[0-9a-f]{32}(?:-[1-9][0-9]*)?")$/u.test(value)
  ? value.replaceAll('"', "") : null;

/** Trusted configuration and exact durable descriptors only. This adapter
 * supplies the existing bounded reader; no bytes may bypass that reader's
 * EOF, digest and current-authority checks. No signed URL, range or adoption. */
export function createSupabaseArchiveReader(config: { origin: string; serviceRoleKey: string; fetch?: typeof fetch }) {
  let origin: URL;
  try { origin = new URL(config.origin); } catch { throw new ArchiveSegmentReadError("invalid_input"); }
  if (origin.origin !== config.origin || origin.username || origin.password
    || (origin.protocol !== "https:" && config.origin !== "http://127.0.0.1:54321")
    || typeof config.serviceRoleKey !== "string" || !config.serviceRoleKey)
    throw new ArchiveSegmentReadError("invalid_input");
  const transport = config.fetch ?? fetch;
  const configuredOrigin = origin.origin, serviceRoleKey = config.serviceRoleKey;
  return async (givenAttempt: ArchiveAttempt, givenSegment: StoredArchiveSegment, signal: AbortSignal): Promise<ArchiveSegmentObject> => {
    validateArchiveSegment(givenAttempt, givenSegment, true);
    const attempt = Object.freeze({ ...givenAttempt }), segment = Object.freeze({ ...givenSegment });
    validateArchiveSegment(attempt, segment, true);
    if (signal.aborted) return refused();
    const target = `${configuredOrigin}/storage/v1/object/${ARCHIVE_BUCKET}/${segment.objectKey}`;
    const infoTarget = `${configuredOrigin}/storage/v1/object/info/${ARCHIVE_BUCKET}/${segment.objectKey}`;
    let metadataRequests = 0, closed = false;
    let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = () => {
      closed = true;
      try { void (reader ? reader.cancel() : response?.body?.cancel())?.catch(() => {}); }
      catch { /* Cancellation does not prove physical erasure. */ }
    };
    signal.addEventListener("abort", cancel, { once: true });
    const request = async (url: string, init: RequestInit) => {
      if (closed || signal.aborted) return refused();
      const pending = transport(url, { ...init, signal, redirect: "error", cache: "no-store" });
      void pending.then(value => { if (closed || signal.aborted) {
        try { void value.body?.cancel().catch(() => {}); } catch { /* Late result stays closed. */ }
      } }, () => {});
      const value = await pending;
      if (closed || signal.aborted || value.redirected || value.status !== 200 || !value.body
        || (value.url && value.url !== url) || value.headers.has("content-range")
        || (value.headers.get("content-encoding") !== null && value.headers.get("content-encoding") !== "identity")) {
        try { void value.body?.cancel().catch(() => {}); } catch { /* Bounded outer reader owns the deadline. */ }
        return refused();
      }
      return value;
    };
    const client = createClient<Database>(configuredOrigin, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (input, init) => {
        if (String(input) !== infoTarget || init?.method !== "GET" || init.body != null
          || new Headers(init.headers).has("range") || ++metadataRequests > 2) return refused();
        const value = await request(infoTarget, init);
        let length = 0; const buffer = new Uint8Array(8192); const current = value.body!.getReader();
        const abort = () => { try { void current.cancel().catch(() => {}); } catch { /* No unbounded cleanup. */ } };
        signal.addEventListener("abort", abort, { once: true });
        try {
          for (;;) {
            if (signal.aborted || closed) return refused();
            const next = await current.read();
            if (next.done) break;
            if (!(next.value instanceof Uint8Array) || !next.value.byteLength || next.value.byteLength > buffer.length - length) return refused();
            buffer.set(next.value, length); length += next.value.byteLength;
          }
          if (signal.aborted || closed) return refused();
          return new Response(buffer.subarray(0, length), { status: 200, headers: { "content-type": "application/json" } });
        } finally { signal.removeEventListener("abort", abort); abort(); try { current.releaseLock(); } catch { /* Settling canceled read. */ } }
      } },
    });
    async function metadata() {
      const reply = await client.storage.from(ARCHIVE_BUCKET).info(segment.objectKey);
      const value = reply.data;
      if (signal.aborted || closed || reply.error || !value || value.id !== segment.objectId
        || value.name !== segment.objectKey || value.bucketId !== ARCHIVE_BUCKET
        || value.size !== segment.sizeBytes || value.contentType !== "application/octet-stream"
        || typeof value.version !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value.version) || !etag(value.etag)) return refused();
      return Object.freeze({ version: value.version, etag: etag(value.etag)! });
    }
    try {
      const before = await metadata();
      response = await request(target, { method: "GET", headers: {
        authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey,
        accept: "application/octet-stream", "accept-encoding": "identity", "if-match": `"${before.etag}"`,
      } });
      if (response.headers.get("content-type") !== "application/octet-stream"
        || response.headers.get("content-length") !== String(segment.sizeBytes)
        || etag(response.headers.get("etag")) !== before.etag) return refused();
      reader = response.body!.getReader();
      const body = new ReadableStream<Uint8Array>({ async pull(controller) {
        try {
          if (signal.aborted || closed) return refused();
          const next = await reader!.read();
          if (signal.aborted || closed) return refused();
          if (!next.done) { controller.enqueue(next.value); return; }
          const after = await metadata();
          if (after.version !== before.version || after.etag !== before.etag) return refused();
          closed = true; signal.removeEventListener("abort", cancel); reader!.releaseLock(); controller.close();
        } catch { cancel(); signal.removeEventListener("abort", cancel); controller.error(new ArchiveSegmentReadError("storage")); }
      }, cancel() { cancel(); signal.removeEventListener("abort", cancel); } }, { highWaterMark: 0 });
      return Object.freeze({ objectId: segment.objectId, objectKey: segment.objectKey, sizeBytes: segment.sizeBytes, body });
    } catch { cancel(); signal.removeEventListener("abort", cancel); return refused(); }
  };
}
