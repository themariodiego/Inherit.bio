import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";
import { ARCHIVE_BUCKET, ARCHIVE_SEGMENT_BYTES, ArchiveSegmentationError, validateArchiveSegment,
  type ArchiveAttempt, type ArchiveSegment, type ArchiveWriteAck } from "./archive-segments";

/** Trusted server configuration only. No ambient environment, signed upload
 * URLs, bucket selection, caller paths, resumable or multipart protocol. */
export function createSupabaseArchiveWriter(config: {
  origin: string;
  serviceRoleKey: string;
  fetch?: typeof fetch;
}) {
  let origin: URL;
  try { origin = new URL(config.origin); }
  catch { throw new ArchiveSegmentationError("invalid_input"); }
  if (origin.origin !== config.origin || origin.username || origin.password
    || (origin.protocol !== "https:" && config.origin !== "http://127.0.0.1:54321")
    || typeof config.serviceRoleKey !== "string" || !config.serviceRoleKey) throw new ArchiveSegmentationError("invalid_input");
  const transport = config.fetch ?? fetch;
  return async (attempt: ArchiveAttempt, segment: ArchiveSegment, bytes: Uint8Array, signal: AbortSignal): Promise<ArchiveWriteAck> => {
    validateArchiveSegment(attempt, segment);
    const expectedKey = `${attempt.principalHash}/${attempt.exportId}/${attempt.attemptId}-${segment.ordinal}.part`;
    if (bytes.length !== segment.sizeBytes || bytes.length < 1 || bytes.length > ARCHIVE_SEGMENT_BYTES
      || createHash("sha256").update(bytes).digest("hex") !== segment.sha256 || signal.aborted)
      throw new ArchiveSegmentationError("storage", true);
    const target = `${config.origin}/storage/v1/object/${ARCHIVE_BUCKET}/${expectedKey}`;
    let admitted = false;
    const client = createClient<Database>(config.origin, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        if (admitted || signal.aborted || String(input) !== target || init?.method !== "POST"
          || init.body !== bytes || headers.get("x-upsert") !== "false"
          || headers.get("content-type") !== "application/octet-stream") throw new Error("archive_write_refused");
        admitted = true;
        let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        const close = () => {
          try { if (reader) void reader.cancel().catch(() => {}); else void response?.body?.cancel().catch(() => {}); }
          catch { /* Cancellation is not proof that a write did not land. */ }
        };
        signal.addEventListener("abort", close, { once: true });
        try {
          const pending = transport(input, { ...init, signal, redirect: "error", cache: "no-store" });
          void pending.then(value => { if (signal.aborted) { try { void value.body?.cancel().catch(() => {}); } catch { /* Late result. */ } } }, () => {});
          response = await pending;
          // The outer core races this complete operation against its fixed
          // deadline, including non-cooperative fetch/read/cancel promises.
          if (signal.aborted || response.redirected || response.status !== 200 || !response.body
            || (response.url && response.url !== target)) throw new Error("archive_write_uncertain");
          reader = response.body.getReader();
          const body = new Uint8Array(8192); let length = 0;
          for (;;) {
            if (signal.aborted) throw new Error("archive_write_uncertain");
            const next = await reader.read();
            if (next.done) break;
            if (!(next.value instanceof Uint8Array) || !next.value.length || next.value.length > body.length - length) throw new Error("archive_write_uncertain");
            body.set(next.value, length); length += next.value.length;
          }
          if (signal.aborted) throw new Error("archive_write_uncertain");
          const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.subarray(0, length)));
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("archive_write_uncertain");
          const ack = value as Record<string, unknown>;
          if (Object.keys(ack).some(key => key !== "Id" && key !== "Key")
            || typeof ack.Id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(ack.Id)
            || ack.Key !== `${ARCHIVE_BUCKET}/${expectedKey}`) throw new Error("archive_write_uncertain");
          return new Response(JSON.stringify(ack), { status: 200, headers: { "content-type": "application/json" } });
        } finally {
          signal.removeEventListener("abort", close); close();
          try { reader?.releaseLock(); } catch { /* An aborted reader may still be settling. */ }
        }
      } },
    });
    try {
      // Installed storage-js uses one POST, ArrayBufferView body, no retries.
      // Fail closed if that SDK behavior changes; the transport admits once.
      const { data, error } = await client.storage.from(ARCHIVE_BUCKET).upload(segment.objectKey, bytes, {
        upsert: false, contentType: "application/octet-stream", cacheControl: "0",
      });
      if (signal.aborted || error || !data || data.path !== expectedKey || data.fullPath !== `${ARCHIVE_BUCKET}/${expectedKey}`)
        throw new Error("archive_write_uncertain");
      return Object.freeze({ objectId: data.id });
    } catch { throw new ArchiveSegmentationError("storage", true); }
  };
}
