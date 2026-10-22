import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

// Separate source proposal. Never implements V2's historical version interface.
// Issuer, permanent policy, distributed coordinator and SQL ACK are unsupplied.
export const R2_CURRENT_CLEANUP_PAGE_LIMIT = 128;
const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const uuid = z.uuid().regex(/^[0-9a-f-]+$/u);
const providerId = z.string().min(1).max(256).regex(/^[A-Za-z0-9._-]+$/u);
const locatorSchema = z.object({
  provider: z.literal("archive-r2-current-object-v1"),
  bucket: z.string().regex(/^inherit-export-[a-z0-9-]{1,40}$/u),
  objectKey: z.string().regex(/^export\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u),
  byteCount: z.number().int().min(1).max(4_000_000), sha256: digest,
}).strict();
const writeIdentitySchema = z.object({
  purpose: z.literal("inherit-export-reservation-v1"), exportId: uuid, attemptId: uuid,
  ordinal: z.number().int().nonnegative().max(2_251_799_813),
  offset: z.number().int().nonnegative().safe(), byteCount: locatorSchema.shape.byteCount,
  sha256: digest, logicalKey: z.string().min(1).max(512), reservedAt: z.iso.datetime({ offset: true }),
  authorityReceipt: digest, locator: locatorSchema,
}).strict();
export const r2CurrentReservationSchema = z.object({
  version: z.literal("archive-r2-current-cleanup-reservation-v1"), exportId: uuid,
  attemptId: uuid, ordinal: writeIdentitySchema.shape.ordinal,
  authorityReceipt: digest, reservationSha256: digest, locator: locatorSchema,
  writeIdentity: writeIdentitySchema, writeBindingSha256: digest,
  // Derived ONLY from the opaque bucket/key, not an archive or identity digest.
  // Its permanent retention, like the marker/terminal fact, remains policy-held.
  allocationSha256: digest,
  cleanupNotBefore: z.iso.datetime({ offset: true }), claimExpiresAt: z.iso.datetime({ offset: true }),
}).strict().refine(v => v.writeIdentity.exportId === v.exportId && v.writeIdentity.attemptId === v.attemptId
  && v.writeIdentity.ordinal === v.ordinal && v.writeIdentity.offset === v.ordinal * 4_000_000
  && Number.isSafeInteger(v.writeIdentity.offset + v.writeIdentity.byteCount)
  && v.writeIdentity.byteCount === v.locator.byteCount && v.writeIdentity.sha256 === v.locator.sha256
  && v.writeIdentity.authorityReceipt === v.authorityReceipt && isDeepStrictEqual(v.writeIdentity.locator, v.locator)
  && /^[0-9a-f]{64}\//u.test(v.writeIdentity.logicalKey)
  && v.writeIdentity.logicalKey.slice(65) === `${v.exportId}/${v.attemptId}-${v.ordinal}.part`
  && v.allocationSha256 === r2AllocationDigest(v.locator.bucket, v.locator.objectKey));

export type R2CurrentReservation = z.infer<typeof r2CurrentReservationSchema>;
export function r2AllocationDigest(bucket: string, objectKey: string): string {
  return createHash("sha256").update(`inherit-export-r2-allocation-v1\n${bucket}\n${objectKey}`).digest("hex");
}
export function parseR2CurrentCleanupPage(value: unknown): readonly R2CurrentReservation[] {
  // Parser only. No SQL producer/claim/selector is supplied by this proposal.
  return z.array(r2CurrentReservationSchema).max(R2_CURRENT_CLEANUP_PAGE_LIMIT).parse(value);
}
const descriptorBase = z.object({ objectKey: locatorSchema.shape.objectKey, version: providerId,
  etag: providerId, byteCount: z.number().int().nonnegative().max(4_000_000), allocationSha256: digest });
const payloadSchema = descriptorBase.extend({ kind: z.literal("owned-payload"), writeBindingSha256: digest }).strict();
const markerSchema = descriptorBase.extend({ kind: z.literal("permanent-empty-fence"),
  byteCount: z.literal(0), writeBindingSha256: z.null() }).strict();
export const r2CurrentDescriptorSchema = z.discriminatedUnion("kind", [payloadSchema, markerSchema]);
export type R2CurrentDescriptor = z.infer<typeof r2CurrentDescriptorSchema>;
export type R2CurrentMarker = z.infer<typeof markerSchema>;
export type R2CurrentRead = Readonly<{ descriptor: unknown; body: ReadableStream<Uint8Array> }>;
export type R2CurrentEvidence = Readonly<{
  version: "archive-r2-current-object-evidence-v1";
  reservationSha256: string; allocationSha256: string; marker: Readonly<R2CurrentMarker>;
  disposition: "current-payload-tombstoned"; historyScope: "current-object-only";
}>;
export const r2CurrentUnavailable = () => new Error("archive_r2_current_cleanup_unavailable");

export type R2CurrentDisposalProvider = Readonly<{
  // Required trusted server capabilities, NOT implemented Boolean callbacks.
  // Readiness includes approved namespace/no marker expiry/delete, all-write
  // gateway exclusion and immutable issuer policy. No such proof is supplied.
  assertReady(binding: Readonly<R2CurrentReservation>, signal: AbortSignal): Promise<void>;
  // Must coordinate generation AND cleanup across processes/restarts. A normal
  // mutex or application row receipt alone cannot prove late R2 commit exclusion.
  serializeExactKey<T>(binding: Readonly<R2CurrentReservation>, signal: AbortSignal,
    work: () => Promise<T>): Promise<T>;
  headCurrent(binding: Readonly<R2CurrentReservation>, signal: AbortSignal): Promise<unknown | null>;
  readCurrent(binding: Readonly<R2CurrentReservation>, expected: Readonly<R2CurrentDescriptor>,
    signal: AbortSignal): Promise<R2CurrentRead>;
  replaceWithEmptyMarker(binding: Readonly<R2CurrentReservation>, observed: Readonly<R2CurrentDescriptor> | null,
    signal: AbortSignal): Promise<unknown>;
  // Deliberately no history listing, old-version GET or delete-version method.
}>;

// No current application selector or original V2 provider is changed.
export function approvedR2ArchiveCurrentDisposal(): R2CurrentDisposalProvider | null { return null; }

export async function fenceR2CurrentReservation(options: {
  reservation: unknown; provider: R2CurrentDisposalProvider;
  checkCurrent: (expected: Readonly<R2CurrentReservation>, signal: AbortSignal) => Promise<unknown>;
  signal: AbortSignal;
}): Promise<R2CurrentEvidence> {
  const selected = r2CurrentReservationSchema.parse(options.reservation);
  const locator = Object.freeze({ ...selected.locator });
  const reservation = Object.freeze({ ...selected, locator,
    writeIdentity: Object.freeze({ ...selected.writeIdentity, locator }) });
  const now = Date.now(), until = Date.parse(reservation.claimExpiresAt);
  if (Date.parse(reservation.cleanupNotBefore) > now || until <= now || until > now + 30_000) throw r2CurrentUnavailable();
  // The original 24h artifact/due clock is owned by the unsupplied current SQL
  // issuer/check. This module creates no deadline and never renews a reservation.
  const provider = Object.freeze({ ...options.provider });
  const checkCurrent = options.checkCurrent;
  const stop = new AbortController(), signal = AbortSignal.any([options.signal, stop.signal]);
  let closed = false;
  const owned = new Map<ReadableStream<Uint8Array>, ReadableStreamDefaultReader<Uint8Array> | null>();
  const cancelBody = (body: ReadableStream<Uint8Array>) => {
    try { void (owned.get(body)?.cancel() ?? body.cancel()).catch(() => {}); } catch { /* Never await cancellation. */ }
  };
  const cancelOwned = () => { for (const body of owned.keys()) cancelBody(body); };
  signal.addEventListener("abort", cancelOwned, { once: true });
  const own = (response: R2CurrentRead) => {
    if (!(response?.body instanceof ReadableStream)) throw r2CurrentUnavailable();
    if (!owned.has(response.body)) owned.set(response.body, null);
    if (closed || signal.aborted) cancelBody(response.body);
    return response;
  };
  const timer = setTimeout(() => stop.abort(), Math.max(0, Math.min(until - now, 30_000))); timer.unref?.();
  let interrupt = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    interrupt = () => reject(r2CurrentUnavailable()); signal.addEventListener("abort", interrupt, { once: true });
  }); void interrupted.catch(() => {});
  const active = () => { if (signal.aborted || Date.now() >= until) throw r2CurrentUnavailable(); };
  const bounded = async <T>(work: () => Promise<T>): Promise<T> => {
    active(); const value = await Promise.race([Promise.resolve().then(() => { active(); return work(); }), interrupted]);
    active(); return value;
  };
  async function current() {
    const actual = r2CurrentReservationSchema.parse(await bounded(() => checkCurrent(reservation, signal)));
    if (!isDeepStrictEqual(actual, reservation)) throw r2CurrentUnavailable();
  }
  async function operation<T>(work: () => Promise<T>): Promise<T> {
    await current(); await bounded(() => provider.assertReady(reservation, signal));
    const value = await bounded(work); await current(); return value;
  }
  function descriptor(value: unknown): R2CurrentDescriptor {
    const parsed = r2CurrentDescriptorSchema.parse(value);
    if (parsed.objectKey !== locator.objectKey || parsed.allocationSha256 !== reservation.allocationSha256
      || (parsed.kind === "owned-payload" && (parsed.writeBindingSha256 !== reservation.writeBindingSha256
        || parsed.byteCount !== locator.byteCount))) throw r2CurrentUnavailable();
    return parsed;
  }
  async function head(): Promise<R2CurrentDescriptor | null> {
    const value = await operation(() => provider.headCurrent(reservation, signal));
    return value === null ? null : descriptor(value);
  }
  async function verifyRead(expected: R2CurrentDescriptor): Promise<void> {
    const response = await operation(() => {
      const pending = provider.readCurrent(reservation, expected, signal).then(own);
      void pending.catch(() => {}); return pending;
    });
    if (!isDeepStrictEqual(descriptor(response.descriptor), expected)) throw r2CurrentUnavailable();
    const reader = response.body.getReader(); owned.set(response.body, reader);
    const abort = () => { try { void reader.cancel().catch(() => {}); } catch { /* no inferred ACK */ } };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const hash = createHash("sha256"); let bytes = 0;
      for (;;) {
        const item = await bounded(() => reader.read()); if (item.done) break;
        if (!(item.value instanceof Uint8Array) || !item.value.byteLength) throw r2CurrentUnavailable();
        bytes += item.value.byteLength;
        if (bytes > expected.byteCount || bytes > 4_000_000) throw r2CurrentUnavailable();
        hash.update(item.value);
      }
      if (bytes !== expected.byteCount || hash.digest("hex") !== (expected.kind === "owned-payload" ? locator.sha256 : EMPTY_SHA))
        throw r2CurrentUnavailable();
      await current();
    } finally {
      signal.removeEventListener("abort", abort); abort();
      try { reader.releaseLock(); } catch { /* closed reader */ } owned.delete(response.body);
    }
    if (!isDeepStrictEqual(await head(), expected)) throw r2CurrentUnavailable();
  }
  let executions = 0, produced: R2CurrentEvidence | undefined;
  try {
    await current(); await bounded(() => provider.assertReady(reservation, signal));
    const result = await bounded(() => provider.serializeExactKey(reservation, signal, async () => {
      if (++executions !== 1) throw r2CurrentUnavailable();
      const observed = await head();
      if (observed !== null) await verifyRead(observed); // full ownership before mutation
      let marker: R2CurrentMarker;
      if (observed?.kind === "permanent-empty-fence") marker = markerSchema.parse(observed);
      else {
        // Native R2 is conditional by current ETag/absence, not history/version CAS.
        // Sole-writer coordinator and real final-commit races remain prerequisites.
        if (!isDeepStrictEqual(await head(), observed)) throw r2CurrentUnavailable();
        marker = markerSchema.parse(descriptor(await operation(() => provider.replaceWithEmptyMarker(reservation, observed, signal))));
      }
      await verifyRead(marker); await verifyRead(marker); await current();
      produced = Object.freeze({ version: "archive-r2-current-object-evidence-v1" as const,
        reservationSha256: reservation.reservationSha256, allocationSha256: reservation.allocationSha256,
        marker: Object.freeze(marker), disposition: "current-payload-tombstoned" as const,
        historyScope: "current-object-only" as const });
      return produced;
    }));
    // A capability that skips/replays work cannot manufacture completion evidence.
    if (executions !== 1 || result !== produced || produced === undefined) throw r2CurrentUnavailable();
    await current();
    await bounded(() => provider.assertReady(reservation, signal));
    await current();
    return produced;
  } finally {
    closed = true; clearTimeout(timer); signal.removeEventListener("abort", interrupt);
    stop.abort(); cancelOwned(); signal.removeEventListener("abort", cancelOwned);
  }
}
