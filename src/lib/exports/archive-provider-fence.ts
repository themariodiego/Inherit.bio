import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

// Source proposal only. No adapter is approved or installed by this module.
// In particular Supabase info/remove is NOT an implementation of this contract.
const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const uuid = z.uuid().regex(/^[0-9a-f-]+$/u);
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const providerId = z.string().min(1).max(256).regex(/^[A-Za-z0-9._-]+$/u);
const locatorSchema = z.object({
  provider: z.literal("archive-permanent-fence-v1"),
  bucket: z.string().regex(/^inherit-export-[a-z0-9-]{1,40}$/u),
  objectKey: z.string().regex(/^export\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u),
  byteCount: z.number().int().min(1).max(4_000_000), sha256: digest,
}).strict();
// Stable before the first provider write. ACK/object/version fields are NOT
// part of this issuer identity; the complete cleanup fingerprint still is.
const writeIdentitySchema = z.object({
  purpose: z.literal("inherit-export-reservation-v1"), exportId: uuid,
  attemptId: uuid, ordinal: z.number().int().nonnegative().max(2_251_799_813),
  offset: z.number().int().nonnegative().safe(), byteCount: locatorSchema.shape.byteCount,
  sha256: digest, logicalKey: z.string().min(1).max(512), reservedAt: z.iso.datetime({ offset: true }),
  authorityReceipt: digest, locator: locatorSchema,
}).strict();
const reservationSchema = z.object({
  version: z.literal("archive-cleanup-reservation-v1"), exportId: uuid,
  attemptId: uuid, ordinal: z.number().int().nonnegative().max(2_251_799_813),
  authorityReceipt: digest, reservationSha256: digest, locator: locatorSchema,
  writeIdentity: writeIdentitySchema, writeBindingSha256: digest,
  cleanupNotBefore: z.iso.datetime({ offset: true }),
  claimExpiresAt: z.iso.datetime({ offset: true }),
}).strict().refine(v => v.writeIdentity.exportId === v.exportId && v.writeIdentity.attemptId === v.attemptId
  && v.writeIdentity.ordinal === v.ordinal && v.writeIdentity.offset === v.ordinal * 4_000_000
  && v.writeIdentity.byteCount === v.locator.byteCount && v.writeIdentity.sha256 === v.locator.sha256
  && v.writeIdentity.authorityReceipt === v.authorityReceipt && isDeepStrictEqual(v.writeIdentity.locator, v.locator)
  && /^[0-9a-f]{64}\//u.test(v.writeIdentity.logicalKey)
  && v.writeIdentity.logicalKey.slice(65) === `${v.exportId}/${v.attemptId}-${v.ordinal}.part`);
const markerSchema = z.object({ objectKey: locatorSchema.shape.objectKey,
  version: providerId, etag: providerId, byteCount: z.literal(0), sha256: z.literal(EMPTY_SHA),
  kind: z.literal("permanent-empty-fence"), expiresAt: z.null(),
}).strict();
const versionSchema = z.object({ objectKey: locatorSchema.shape.objectKey,
  version: providerId, deleteMarker: z.boolean(), byteCount: z.number().int().nonnegative().safe(),
}).strict();
const pageSchema = z.object({ versions: z.array(versionSchema).max(128),
  nextCursor: z.string().min(1).max(4096).nullable(),
}).strict();
export type ArchiveCleanupReservation = z.infer<typeof reservationSchema>;
type Marker = z.infer<typeof markerSchema>;
export type ArchiveProviderBinding = Readonly<ArchiveCleanupReservation>;
const ownedVersionSchema = versionSchema.extend({
  etag: providerId, kind: z.enum(["verified-owned-payload", "permanent-empty-fence"]),
  writeBindingSha256: digest.nullable(), verifiedSha256: digest,
}).strict();
const inspectionPageSchema = z.object({ expected: reservationSchema,
  currentVersion: providerId.nullable(), currentEtag: providerId.nullable(),
  versions: z.array(ownedVersionSchema).max(128), nextCursor: pageSchema.shape.nextCursor,
}).strict();
type OwnershipObservation = Readonly<{currentVersion: string | null; currentEtag: string | null;
  versions: readonly Readonly<z.infer<typeof ownedVersionSchema>>[]}>;

/** Trusted server-owned provider capability, not a caller Boolean. A real
 * implementation must prove conditional CREATE at final commit, atomic marker
 * replacement, complete version listing, exact version deletion and a permanent
 * no-expiry/no-delete marker policy. No SDK bucket/key selection or URL escapes.
 * serializeExactKey must coordinate across processes/restarts, not an in-memory
 * mutex. It does not replace the provider's conditional commit guarantee. */
export type ArchivePermanentFenceProvider = Readonly<{
  assertReady(signal: AbortSignal): Promise<void>;
  serializeExactKey<T>(binding: ArchiveProviderBinding, signal: AbortSignal,
    work: () => Promise<T>): Promise<T>;
  // Non-mutating COMPLETE history inspection. Real adapter must independently
  // read every payload version to EOF/count/hash and verify its issuer binding.
  // Unknown/foreign/history without binding refuses BEFORE any replacement.
  inspectExactKeyBeforeMutation(binding: ArchiveProviderBinding, after: string | null,
    signal: AbortSignal): Promise<unknown>;
  // Atomically replaces a committed payload, or creates the marker at an empty
  // reserved key. Reuses an existing permanent marker without changing version.
  // No payload identity/hash/custom metadata survives on the provider marker.
  // Atomic CAS to the inspected current version/ETag (or absent key). It MUST
  // refuse changed/unknown history without overwriting it. Matching bytes alone
  // are not ownership. No full identity/hash is retained on the empty marker.
  ensurePermanentMarker(binding: ArchiveProviderBinding, observed: OwnershipObservation, signal: AbortSignal): Promise<unknown>;
  readExactMarker(binding: ArchiveProviderBinding, marker: Readonly<Marker>, signal: AbortSignal): Promise<{
    descriptor: unknown; body: ReadableStream<Uint8Array>;
  }>;
  listExactKeyVersions(binding: ArchiveProviderBinding, after: string | null,
    signal: AbortSignal): Promise<unknown>;
  // Version ID, not unversioned DELETE. Never deletes or expires the marker.
  deleteExactVersion(binding: ArchiveProviderBinding, version: string, signal: AbortSignal): Promise<unknown>;
}>;

export type ArchiveCleanupEvidence = Readonly<{
  version: "archive-permanent-fence-evidence-v1";
  reservationSha256: string;
  marker: Readonly<Marker>;
  completeListingSha256: string;
  deletedVersionCount: number;
  disposition: "payload-tombstoned";
}>;
const unavailable = () => new Error("archive_cleanup_unavailable");

/** One SQL-selected reservation, including an uncertain first write. The real
 * SQL claim is rechecked around every provider operation and at final ACK.
 * A 30s claim/operation remains operational authority only: it never alters the
 * original 24h artifact deadline. A caller timeout leaves every key inventoried.
 * This algorithm grants no generation, READY, download, mail or graph deletion. */
export async function fenceArchiveReservation(options: {
  reservation: unknown; provider: ArchivePermanentFenceProvider;
  checkCurrent: (expected: Readonly<ArchiveCleanupReservation>, signal: AbortSignal) => Promise<unknown>;
  signal: AbortSignal;
}): Promise<ArchiveCleanupEvidence> {
  const selected = reservationSchema.parse(options.reservation);
  const locator = Object.freeze({ ...selected.locator });
  const reservation = Object.freeze({ ...selected, locator,
    writeIdentity: Object.freeze({ ...selected.writeIdentity, locator }) });
  const now = Date.now(), until = Date.parse(reservation.claimExpiresAt);
  if (Date.parse(reservation.cleanupNotBefore) > now || until <= now || until > now + 30_000)
    throw unavailable();
  const provider = Object.freeze({ ...options.provider });
  const stop = new AbortController(), signal = AbortSignal.any([options.signal, stop.signal]);
  let closed = false;
  const ownedBodies = new Map<ReadableStream<Uint8Array>, ReadableStreamDefaultReader<Uint8Array> | null>();
  const cancelBody = (body: ReadableStream<Uint8Array>) => {
    try { void (ownedBodies.get(body)?.cancel() ?? body.cancel()).catch(() => {}); } catch { /* Never await cancellation. */ }
  };
  const cancelOwned = () => { for (const body of ownedBodies.keys()) cancelBody(body); };
  signal.addEventListener("abort", cancelOwned, { once: true });
  const ownMarkerResponse = (value: {descriptor: unknown; body: ReadableStream<Uint8Array>}) => {
    if (!(value?.body instanceof ReadableStream)) throw unavailable();
    if (!ownedBodies.has(value.body)) ownedBodies.set(value.body, null);
    if (closed || signal.aborted) cancelBody(value.body);
    return value;
  };
  const timer = setTimeout(() => stop.abort(), Math.max(0, Math.min(until - now, 30_000)));
  timer.unref();
  let interrupt = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    interrupt = () => reject(unavailable()); signal.addEventListener("abort", interrupt, { once: true });
  });
  void interrupted.catch(() => {});
  const active = () => { if (signal.aborted || Date.now() >= until) throw unavailable(); };
  const bounded = async <T>(work: () => Promise<T>): Promise<T> => {
    active(); const value = await Promise.race([Promise.resolve().then(() => { active(); return work(); }), interrupted]);
    active(); return value;
  };
  async function current() {
    const actual = reservationSchema.parse(await bounded(() => options.checkCurrent(reservation, signal)));
    if (!isDeepStrictEqual(actual, reservation)) throw unavailable();
  }
  async function operation<T>(work: () => Promise<T>): Promise<T> {
    await current(); await bounded(() => provider.assertReady(signal));
    const value = await bounded(work); await current(); return value;
  }
  async function verifyMarker(marker: Marker) {
    const response = await operation(() => {
      const pending = provider.readExactMarker(reservation, marker, signal).then(ownMarkerResponse);
      // Ownership is attached before operation's post-current check. This also
      // disposes a response resolving after the bounded caller has closed.
      void pending.catch(() => {}); return pending;
    });
    if (!isDeepStrictEqual(markerSchema.parse(response.descriptor), marker)) throw unavailable();
    const reader = response.body.getReader();
    ownedBodies.set(response.body, reader);
    const abort = () => { try { void reader.cancel().catch(() => {}); } catch { /* no inferred ACK */ } };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const hash = createHash("sha256"); let bytes = 0;
      for (;;) {
        const item = await bounded(() => reader.read());
        if (item.done) break;
        if (!(item.value instanceof Uint8Array) || !item.value.byteLength) throw unavailable();
        bytes += item.value.byteLength; hash.update(item.value);
        if (bytes !== 0) throw unavailable();
      }
      if (bytes !== 0 || hash.digest("hex") !== EMPTY_SHA) throw unavailable();
      await current();
    } finally { signal.removeEventListener("abort", abort); abort(); try { reader.releaseLock(); } catch { /* settling read */ }
      ownedBodies.delete(response.body); }
  }
  async function inspectOwnership(): Promise<OwnershipObservation> {
    let cursor: string | null = null, version: string | null | undefined, etag: string | null | undefined;
    const cursors = new Set<string>(), seen = new Set<string>();
    const found: z.infer<typeof ownedVersionSchema>[] = [];
    do {
      const page = inspectionPageSchema.parse(await operation(() => provider.inspectExactKeyBeforeMutation(reservation, cursor, signal)));
      if (!isDeepStrictEqual(page.expected, reservation) || (page.currentVersion === null) !== (page.currentEtag === null)) throw unavailable();
      if (version === undefined) { version = page.currentVersion; etag = page.currentEtag; }
      else if (version !== page.currentVersion || etag !== page.currentEtag) throw unavailable();
      for (const value of page.versions) {
        if (value.objectKey !== locator.objectKey || value.deleteMarker || seen.has(value.version) || found.length >= 128) throw unavailable();
        if (value.kind === "verified-owned-payload"
          ? value.writeBindingSha256 !== reservation.writeBindingSha256 || value.byteCount !== locator.byteCount || value.verifiedSha256 !== locator.sha256
          : value.writeBindingSha256 !== null || value.byteCount !== 0 || value.verifiedSha256 !== EMPTY_SHA) throw unavailable();
        seen.add(value.version); found.push(Object.freeze({...value}));
      }
      cursor = page.nextCursor;
      if (cursor !== null) { if (!page.versions.length || cursors.has(cursor)) throw unavailable(); cursors.add(cursor); }
    } while (cursor !== null);
    if (version === null ? found.length !== 0 : found.filter(v => v.version === version && v.etag === etag).length !== 1) throw unavailable();
    // An empty fence can be attributed only by the independently enforced
    // unique, never-reused opaque issuer namespace. This callback is not proof.
    return Object.freeze({currentVersion: version!, currentEtag: etag!, versions: Object.freeze(found)});
  }
  async function versions(): Promise<z.infer<typeof versionSchema>[]> {
    let cursor: string | null = null;
    const cursors = new Set<string>(), seen = new Set<string>();
    const found: z.infer<typeof versionSchema>[] = [];
    do {
      const page = pageSchema.parse(await operation(() => provider.listExactKeyVersions(reservation, cursor, signal)));
      for (const value of page.versions) {
        if (value.objectKey !== reservation.locator.objectKey || seen.has(value.version)) throw unavailable();
        // Fresh one-write reservation + one permanent marker. Unexpected extra
        // history refuses intact, not truncated. 128 is the existing page bound.
        if (found.length >= 128) throw unavailable();
        seen.add(value.version); found.push(Object.freeze({ ...value }));
      }
      cursor = page.nextCursor;
      if (cursor !== null) {
        if (!page.versions.length || cursors.has(cursor)) throw unavailable();
        cursors.add(cursor);
      }
    } while (cursor !== null);
    return found;
  }
  try {
    await current(); await bounded(() => provider.assertReady(signal));
    return await bounded(() => provider.serializeExactKey(reservation, signal, async () => {
      const observed = await inspectOwnership();
      const marker = markerSchema.parse(await operation(() => provider.ensurePermanentMarker(reservation, observed, signal)));
      if (marker.objectKey !== reservation.locator.objectKey) throw unavailable();
      await verifyMarker(marker);
      const before = await versions();
      if (before.filter(v => v.version === marker.version && !v.deleteMarker && v.byteCount === 0).length !== 1)
        throw unavailable();
      if (before.some(v => v.version !== marker.version && !observed.versions.some(old => old.version === v.version
        && old.objectKey === v.objectKey && old.byteCount === v.byteCount && old.deleteMarker === v.deleteMarker))) throw unavailable();
      let deletedVersionCount = 0;
      for (const value of before) {
        if (value.version === marker.version) continue;
        const ack = z.object({ objectKey: locatorSchema.shape.objectKey, version: providerId,
          deleted: z.literal(true) }).strict().parse(await operation(() =>
          provider.deleteExactVersion(reservation, value.version, signal)));
        if (ack.objectKey !== value.objectKey || ack.version !== value.version) throw unavailable();
        deletedVersionCount++;
      }
      const after = await versions();
      if (after.length !== 1 || after[0].version !== marker.version || after[0].deleteMarker || after[0].byteCount !== 0)
        throw unavailable();
      await verifyMarker(marker); await current();
      return Object.freeze({ version: "archive-permanent-fence-evidence-v1" as const,
        reservationSha256: reservation.reservationSha256, marker: Object.freeze(marker),
        completeListingSha256: createHash("sha256").update(JSON.stringify(after)).digest("hex"),
        deletedVersionCount, disposition: "payload-tombstoned" as const });
    }));
  } finally { closed = true; clearTimeout(timer); signal.removeEventListener("abort", interrupt); stop.abort(); cancelOwned();
    signal.removeEventListener("abort", cancelOwned); }
}
