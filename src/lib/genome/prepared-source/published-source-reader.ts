import "server-only";
import { isDeepStrictEqual as equal } from "node:util";
import { z } from "zod";
import { canonicalBindingSchema } from "./canonical-schema";
import { assertPreparedMetadataBounds, validateCanonicalMaterializationReceipt } from "./canonical-manifest";
import { readCanonicalCoordinates, type CanonicalCoordinateCursor } from "./canonical-coordinate-reader";
import type { CanonicalCoordinate } from "./canonical-coordinate-index";
import { preparedArtifactReceiptSchema, type PreparedStoredArtifact } from "./storage-writer";
import { preparedStorageConfig } from "./storage-common";
import { createPreparedRangeFetch } from "./storage-reader";
import { createPreparedArtifactFetch } from "./storage-artifact-fetch";
import { readVerifiedPreparedArtifact } from "./verified-artifact-reader";

const uuid = z.uuid().regex(/^[0-9a-f-]+$/), hash = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.number().int().nonnegative().safe();
const stored = z.object({ receipt: preparedArtifactReceiptSchema, storageObjectId: uuid }).strict();
const summarySchema = z.object({ version: z.literal("own-prepared-summary-v1"), sourceBuild: z.enum(["GRCh37", "GRCh38"]),
  parserRevision: z.string().min(1).max(128), canonicalRevision: z.literal("prepared-canonical-v1"),
  sourceVariantCount: count, sourceObservedCount: count, sourceReferenceCount: count,
  variantCount: count.max(2147483647), observedCallCount: count, usableObservedCount: count,
  attempted: count, unmapped: count, rsidPointerCount: count }).strict().refine(s =>
  Number.isSafeInteger(s.sourceVariantCount + s.sourceObservedCount + s.sourceReferenceCount)
  && s.variantCount <= s.sourceVariantCount && s.observedCallCount <= s.sourceObservedCount
  && s.usableObservedCount <= s.observedCallCount && (s.variantCount > 0 || s.usableObservedCount > 0)
  && s.unmapped <= s.attempted && s.attempted <= s.sourceVariantCount + s.sourceObservedCount
  && s.rsidPointerCount <= s.sourceVariantCount + s.sourceObservedCount
  && (s.sourceBuild !== "GRCh38" || (s.attempted === 0 && s.unmapped === 0)));
const sourceSchema = z.object({ version: z.literal("own-prepared-source-v1"), backend: z.literal("prepared-object-v1"),
  manifestId: uuid, fileId: uuid, subjectId: uuid, sourceRevision: count.positive(), rawSha256: hash, decodedSha256: hash,
  preparedAt: z.iso.datetime({ offset: true }), root: stored, summary: summarySchema,
  memberCount: count.positive().max(4096), membershipSha256: hash }).strict();
export type OwnPreparedSource = z.infer<typeof sourceSchema>;
const memberSchema = z.object({ version: z.literal("own-prepared-member-v1"), manifestId: uuid, fileId: uuid,
  membershipSha256: hash, member: stored }).strict();
const rootSchema = z.object({ version: z.literal("prepared-genome-root-v1"), state: z.literal("provisional"),
  binding: canonicalBindingSchema, canonical: stored, rsid: stored, rsidPointerSha256: hash, summary: summarySchema }).strict();
export class PublishedSourceReadError extends Error {
  constructor(readonly code: "invalid_request" | "integrity_mismatch" | "unavailable" | "aborted") {
    super(code); this.name = "PublishedSourceReadError";
  }
}

/** Actual server transport; actor must come from the current authenticated
 * request. expectedManifestId must be the exact published source selected by
 * that operation. No browser-supplied receipts, object paths or backend choice.
 *
 * checkOperation is mandatory and must recheck the caller's exact report/purpose
 * or other registered read operation. Store authority alone is not an analytic
 * grant. The callback runs before source discovery, around every object read,
 * and before returning; the SQL member check independently resolves current
 * session/store/source/deletion authority. Both are required.
 *
 * Full immutable membership is checked at both page boundaries; selected objects use
 * indexed exact-member checks. No genome-wide data scan or per-file call cache.
 * This connects the reader to actual RPC/Storage endpoints but does not enable
 * dispatch or change legacy report readers. Report claim/completion binding must
 * be integrated before callers activate this backend. Returns full canonical
 * evidence/order; callers must preserve existing report collision semantics.
 */
export function createOwnPreparedCoordinateReader(rawActor: { accountId: string; sessionId: string }) {
  let actor: { accountId: string; sessionId: string }, origin: string, key: string;
  try { assertPreparedMetadataBounds(rawActor, 512); actor = z.object({ accountId: uuid, sessionId: uuid }).strict().parse(rawActor); }
  catch { throw new PublishedSourceReadError("invalid_request"); }
  try { ({ origin, key } = preparedStorageConfig()); }
  catch { throw new PublishedSourceReadError("unavailable"); }
  const readArtifact = createPreparedArtifactFetch(), fetchRange = createPreparedRangeFetch();
  return async (rawRequest: { fileId: string; expectedManifestId: string; loci: readonly CanonicalCoordinate[];
    cursor?: CanonicalCoordinateCursor | null }, options: {
    checkOperation: (signal: AbortSignal) => Promise<void>; signal?: AbortSignal;
  }) => {
    const deadline = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
    const timer = setTimeout(() => deadline.abort(), 30_000); timer.unref();
    const active = () => { if (signal.aborted) throw new PublishedSourceReadError("aborted"); };
    function requireValid(condition: unknown): asserts condition { if (!condition) throw new PublishedSourceReadError("integrity_mismatch"); }
    async function wait<T>(pending: Promise<T>): Promise<T> {
      if (signal.aborted) { void pending.catch(() => {}); active(); }
      let abort = () => {};
      const interrupted = new Promise<never>((_, reject) => {
        abort = () => reject(new PublishedSourceReadError("aborted")); signal.addEventListener("abort", abort, { once: true });
      });
      try { const result = await Promise.race([pending, interrupted]); active(); return result; }
      finally { signal.removeEventListener("abort", abort); }
    }
    async function operation(current = signal) { active(); await wait(options.checkOperation(current)); active(); }
    async function rpc(name: string, args: object): Promise<unknown> {
      active(); let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const cancel = () => { if (reader) void reader.cancel().catch(() => {}); else if (response?.body) void response.body.cancel().catch(() => {}); };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        const pending = fetch(`${origin}/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(args),
          headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json", "Accept-Encoding": "identity" },
          signal, cache: "no-store", redirect: "error" });
        void pending.then(late => { response = late; if (signal.aborted) cancel(); }, () => {});
        response = await wait(pending);
        if (!response.ok || !response.body || response.headers.has("content-range")
          || (response.headers.has("content-encoding") && response.headers.get("content-encoding") !== "identity"))
          throw new PublishedSourceReadError("unavailable");
        reader = response.body.getReader(); const bytes = new Uint8Array(16_384); let length = 0;
        for (;;) {
          const part = await wait(reader.read()); if (part.done) break;
          requireValid(part.value instanceof Uint8Array && part.value.length <= bytes.length - length);
          bytes.set(part.value, length); length += part.value.length;
        }
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
      } finally {
        signal.removeEventListener("abort", cancel); cancel(); if (reader) reader.releaseLock();
      }
    }
    try {
      active();
      // Own bounded request metadata before the first external callback.
      assertPreparedMetadataBounds(rawRequest, 16_384);
      const request = z.object({ fileId: uuid, expectedManifestId: uuid,
        loci: z.array(z.object({ chrom: count.positive().max(25), pos: count.positive() }).strict()).max(200),
        cursor: z.object({ version: z.literal("canonical-coordinate-cursor-v1"), manifestSha256: hash,
          querySha256: hash, blockSequence: count, recordOffset: count.max(1999) }).strict().nullable().optional(),
      }).strict().parse(rawRequest);
      if (typeof options.checkOperation !== "function") throw new PublishedSourceReadError("invalid_request");
      requireValid(new Set(request.loci.map(l => `${l.chrom}:${l.pos}`)).size === request.loci.length);
      await operation();
      const args = { p_account_id: actor.accountId, p_session_id: actor.sessionId, p_file_id: request.fileId,
        p_expected_manifest_id: request.expectedManifestId };
      const rawSource = await rpc("read_own_prepared_manifest_v1", args);
      assertPreparedMetadataBounds(rawSource, 16_384);
      const source = sourceSchema.parse(rawSource);
      requireValid(source.fileId === request.fileId && source.manifestId === request.expectedManifestId && source.root.receipt.byteCount <= 16_384);
      async function check(artifact: PreparedStoredArtifact, current: AbortSignal) {
        active(); await operation(current);
        const rawMember = await rpc("check_own_prepared_member_v1", { ...args, p_artifact_id: artifact.receipt.artifactId });
        assertPreparedMetadataBounds(rawMember, 16_384); const checked = memberSchema.parse(rawMember);
        requireValid(checked.manifestId === source.manifestId && checked.fileId === source.fileId
          && checked.membershipSha256 === source.membershipSha256 && equal(checked.member, artifact));
        await operation(current); active();
      }
      const rawRoot = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readVerifiedPreparedArtifact(source.root, { readArtifact, check, signal })));
      assertPreparedMetadataBounds(rawRoot, 16_384); const root = rootSchema.parse(rawRoot), b = root.binding.source;
      requireValid(equal(root.summary, source.summary) && b.fileId === source.fileId && b.subjectId === source.subjectId
        && b.sourceRevision === source.sourceRevision && b.rawSha256 === source.rawSha256 && b.decodedSha256 === source.decodedSha256
        && b.sourceBuild === source.summary.sourceBuild && b.parserRevision === source.summary.parserRevision);
      const roots = [root.canonical, root.rsid, source.root];
      requireValid(roots.every(a => a.receipt.jobId === source.root.receipt.jobId && a.receipt.attemptId === source.root.receipt.attemptId)
        && root.canonical.receipt.byteCount <= 4_000_000 && root.rsid.receipt.byteCount <= 4_000_000
        && roots.every((a, i) => a.receipt.sequence === root.canonical.receipt.sequence + i));
      for (const get of [(a: PreparedStoredArtifact) => a.receipt.artifactId, (a: PreparedStoredArtifact) => a.storageObjectId,
        (a: PreparedStoredArtifact) => a.receipt.objectKey]) requireValid(new Set(roots.map(get)).size === 3);
      // The rsID root is not read for a coordinate query, but its declared
      // identity must still be an exact published member of this source.
      await check(root.rsid, signal);
      const rawCanonical = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readVerifiedPreparedArtifact(root.canonical, { readArtifact, check, signal })));
      const expected = { binding: root.binding, jobId: source.root.receipt.jobId, attemptId: source.root.receipt.attemptId };
      const canonical = validateCanonicalMaterializationReceipt(rawCanonical, expected), s = source.summary, c = canonical.counts;
      requireValid(canonical.nextArtifactSequence <= root.canonical.receipt.sequence && source.memberCount >= canonical.artifactCount + 3
        && c.sourceVariantCount === s.sourceVariantCount && c.sourceObservedCount === s.sourceObservedCount && c.sourceReferenceCount === s.sourceReferenceCount
        && c.normalizedVariantCount === s.variantCount && c.normalizedObservedCount === s.observedCallCount && c.usableObservedCount === s.usableObservedCount
        && canonical.canonicalSummary.attempted === s.attempted && canonical.canonicalSummary.unmapped === s.unmapped);
      const result = await readCanonicalCoordinates({ manifest: canonical, expected, loci: request.loci, cursor: request.cursor }, {
        signal, fetchRange, check: ({ artifact }, current) => check(artifact ?? source.root, current),
      });
      // An unread final member may disappear during selected I/O. Recheck the
      // complete source at the page boundary, not only the selected root member.
      const finalSource = await rpc("read_own_prepared_manifest_v1", args);
      assertPreparedMetadataBounds(finalSource, 16_384);
      requireValid(equal(sourceSchema.parse(finalSource), source));
      await operation(); active();
      return { source, records: result.records, nextCursor: result.nextCursor };
    } catch (error) {
      if (signal.aborted) throw new PublishedSourceReadError("aborted");
      if (error instanceof PublishedSourceReadError) throw error;
      throw new PublishedSourceReadError("unavailable");
    } finally { clearTimeout(timer); deadline.abort(); }
  };
}
