import "server-only";
import { z } from "zod";
import { r2CurrentDescriptorSchema, r2CurrentReservationSchema, r2CurrentUnavailable,
  type R2CurrentDescriptor, type R2CurrentDisposalProvider, type R2CurrentRead,
  type R2CurrentReservation } from "./archive-r2-current-fence";

// Structural port for documented R2 binding methods only. No SDK/env selection,
// historical version API, DELETE, LIST, multipart or copy is admitted.
export type R2CurrentBucketPort = Readonly<{
  head(key: string): Promise<unknown | null>;
  get(key: string, options: Readonly<{ onlyIf: Headers }>): Promise<unknown | null>;
  put(key: string, body: Uint8Array, options: Readonly<{ onlyIf: Headers;
    customMetadata: Readonly<Record<string, string>>;
    httpMetadata: Readonly<{ cacheControl: "no-store" }> }>): Promise<unknown | null>;
}>;
const native = z.object({ key: z.string(), version: z.string(), etag: z.string(), size: z.number(),
  customMetadata: z.record(z.string(), z.string()) }).passthrough();
const payloadMetadata = z.object({ state: z.literal("owned-payload"), allocationSha256: z.string(),
  writeBindingSha256: z.string() }).strict();
const markerMetadata = z.object({ state: z.literal("permanent-empty-fence"), allocationSha256: z.string() }).strict();

export function createR2CurrentDisposalBinding(options: {
  bucketName: string; bucket: R2CurrentBucketPort;
  assertReady: R2CurrentDisposalProvider["assertReady"];
  serializeExactKey: R2CurrentDisposalProvider["serializeExactKey"];
}): R2CurrentDisposalProvider {
  const bucketName = z.string().regex(/^inherit-export-[a-z0-9-]{1,40}$/u).parse(options.bucketName);
  const head = options.bucket.head.bind(options.bucket), get = options.bucket.get.bind(options.bucket),
    put = options.bucket.put.bind(options.bucket), ready = options.assertReady, serialize = options.serializeExactKey;
  const active = (binding: Readonly<R2CurrentReservation>, signal: AbortSignal) => {
    r2CurrentReservationSchema.parse(binding);
    const now = Date.now(), until = Date.parse(binding.claimExpiresAt);
    if (signal.aborted || now >= until || until > now + 30_000
      || Date.parse(binding.cleanupNotBefore) > now || binding.locator.bucket !== bucketName)
      throw r2CurrentUnavailable();
  };
  async function before(binding: Readonly<R2CurrentReservation>, signal: AbortSignal) {
    active(binding, signal); await ready(binding, signal); active(binding, signal);
  }
  function describe(value: unknown, binding: Readonly<R2CurrentReservation>): R2CurrentDescriptor {
    const raw = native.parse(value);
    const metadata = raw.customMetadata.state === "owned-payload"
      ? payloadMetadata.parse(raw.customMetadata) : markerMetadata.parse(raw.customMetadata);
    const parsed = r2CurrentDescriptorSchema.parse({ objectKey: raw.key, version: raw.version, etag: raw.etag,
      byteCount: raw.size, allocationSha256: metadata.allocationSha256, kind: metadata.state,
      writeBindingSha256: metadata.state === "owned-payload" ? metadata.writeBindingSha256 : null });
    if (parsed.objectKey !== binding.locator.objectKey || parsed.allocationSha256 !== binding.allocationSha256
      || (parsed.kind === "owned-payload" && (parsed.writeBindingSha256 !== binding.writeBindingSha256
        || parsed.byteCount !== binding.locator.byteCount))) throw r2CurrentUnavailable();
    return parsed;
  }
  return Object.freeze({
    assertReady: ready, serializeExactKey: serialize,
    async headCurrent(binding: Readonly<R2CurrentReservation>, signal: AbortSignal) {
      await before(binding, signal); const value = await head(binding.locator.objectKey);
      active(binding, signal); await before(binding, signal);
      return value === null ? null : describe(value, binding);
    },
    async readCurrent(binding: Readonly<R2CurrentReservation>, expected: Readonly<R2CurrentDescriptor>, signal: AbortSignal): Promise<R2CurrentRead> {
      const selected = r2CurrentDescriptorSchema.parse(expected);
      if (selected.objectKey !== binding.locator.objectKey || selected.allocationSha256 !== binding.allocationSha256
        || (selected.kind === "owned-payload" && (selected.writeBindingSha256 !== binding.writeBindingSha256
          || selected.byteCount !== binding.locator.byteCount)))
        throw r2CurrentUnavailable();
      await before(binding, signal);
      const pending = get(binding.locator.objectKey, { onlyIf: new Headers({ "If-Match": `"${selected.etag}"` }) });
      // Attach stream ownership at native resolution, before strict descriptor or
      // post-readiness/currentness checks; late results are cancelled as well.
      const owned = pending.then(value => {
        const body = value !== null && typeof value === "object" && "body" in value ? value.body : undefined;
        if (!(body instanceof ReadableStream)) throw r2CurrentUnavailable();
        const cancel = () => { try { void body.cancel().catch(() => {}); } catch { /* no waiting */ } };
        if (signal.aborted) cancel(); else signal.addEventListener("abort", cancel, { once: true });
        return { value, body };
      }); void owned.catch(() => {});
      const result = await owned;
      try {
        const descriptor = describe(result.value, binding);
        active(binding, signal); await before(binding, signal);
        return { descriptor, body: result.body };
      } catch (error) { try { void result.body.cancel().catch(() => {}); } catch { /* no waiting */ } throw error; }
    },
    async replaceWithEmptyMarker(binding: Readonly<R2CurrentReservation>, observed: Readonly<R2CurrentDescriptor> | null, signal: AbortSignal) {
      const selected = observed === null ? null : r2CurrentDescriptorSchema.parse(observed);
      if (selected !== null && (selected.objectKey !== binding.locator.objectKey
        || selected.allocationSha256 !== binding.allocationSha256 || selected.kind !== "owned-payload"
        || selected.writeBindingSha256 !== binding.writeBindingSha256 || selected.byteCount !== binding.locator.byteCount))
        throw r2CurrentUnavailable();
      await before(binding, signal);
      const onlyIf = selected === null ? new Headers({ "If-None-Match": "*" })
        : new Headers({ "If-Match": `"${selected.etag}"` });
      const value = await put(binding.locator.objectKey, new Uint8Array(), { onlyIf,
        customMetadata: { state: "permanent-empty-fence", allocationSha256: binding.allocationSha256 },
        httpMetadata: { cacheControl: "no-store" } });
      active(binding, signal); await before(binding, signal);
      if (value === null) throw r2CurrentUnavailable(); // no retry/adoption after CAS failure
      const descriptor = describe(value, binding);
      if (descriptor.kind !== "permanent-empty-fence") throw r2CurrentUnavailable();
      return descriptor;
    },
  });
}
