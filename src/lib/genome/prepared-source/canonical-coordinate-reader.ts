import { preparedArtifactObjectIdentity } from "./artifact-identity";
import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { validateCanonicalMaterializationReceipt, decodeCanonicalContainerDirectory,
  decodeCanonicalCoordinatePage } from "./canonical-manifest";
import { selectCanonicalCoordinateBlocks, type CanonicalCoordinate } from "./canonical-coordinate-index";
import { readCanonicalStorageBlock } from "./canonical-storage-reader";
import { readPreparedStorageRange, type PreparedRangeFetch } from "./storage-reader";
import type { CanonicalMaterializationReceipt, CanonicalContainerDirectory } from "./materialize-canonical";
import type { CanonicalBinding, CanonicalRecord } from "./canonical-schema";
import type { PreparedStoredArtifact } from "./storage-writer";

export const CANONICAL_LOOKUP_MAX_RECORDS = 1000;
export const CANONICAL_LOOKUP_MAX_RECORD_BYTES = 8_388_608;
const integer = z.number().int().nonnegative().safe();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const locusSchema = z.object({ chrom: integer.positive().max(25), pos: integer.positive() }).strict();
const cursorSchema = z.object({ version: z.literal("canonical-coordinate-cursor-v1"), manifestSha256: hash,
  querySha256: hash, blockSequence: integer, recordOffset: integer.max(1999) }).strict();
export type CanonicalCoordinateCursor = z.infer<typeof cursorSchema>;
export type CanonicalReadSelection = { manifest: CanonicalMaterializationReceipt; artifact: PreparedStoredArtifact | null };
export class CanonicalCoordinateReadError extends Error {
  constructor(readonly code: "invalid_request" | "integrity_mismatch" | "unavailable" | "too_large" | "aborted") {
    super(code); this.name = "CanonicalCoordinateReadError";
  }
}
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function compare(a: CanonicalCoordinate, b: CanonicalCoordinate) { return a.chrom - b.chrom || a.pos - b.pos; }

/** Bounded coordinate page from an independently authorized immutable manifest.
 * check must re-resolve its exact root/source/job and, for each object, registered
 * object ID/key/digest membership with the caller's current operation authority.
 * Provisional manifests may be read ONLY under an actual live preparation claim;
 * application reports require a separately published backend/source receipt.
 * This helper never grants either authority or falls back to another backend.
 *
 * No record escapes until all selected reads on this page and a final exact-root
 * authority check finish. Missing/corrupt objects fail, including empty-result
 * queries after revocation. Hash-bound cursors are positions, not permissions.
 * They resume AFTER the last returned record, retaining collisions/repetitions.
 * Iterate until nextCursor is null, not merely until a page has <1000 records.
 *
 * Returns canonical order and FULL normalized+original evidence. Report adapters
 * must project normalized call fields and preserve existing calculation ordering;
 * this is not a ReportCall stream or source-line sort. Only normalized records
 * are selected; source-only evidence requires the full or rsID reader.
 * Holds one coordinate page, one container directory, one decoded block and at
 * most1000/8MiB result records, plus bounded root metadata. Every provider request
 * and the complete page share a finite30s deadline. No per-file call map/cache.
 */
export async function readCanonicalCoordinates(request: {
  manifest: CanonicalMaterializationReceipt; expected: { binding: CanonicalBinding; jobId: string; attemptId: string };
  loci: readonly CanonicalCoordinate[]; cursor?: CanonicalCoordinateCursor | null;
}, options: { check: (selection: CanonicalReadSelection, signal: AbortSignal) => Promise<void>;
  fetchRange: PreparedRangeFetch; signal?: AbortSignal }) {
  const deadline = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const timer = setTimeout(() => deadline.abort(), 30_000); timer.unref();
  const active = () => { if (signal.aborted) throw new CanonicalCoordinateReadError("aborted"); };
  async function wait<T>(pending: Promise<T>): Promise<T> {
    if (signal.aborted) { void pending.catch(() => {}); active(); }
    let abort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new CanonicalCoordinateReadError("aborted")); signal.addEventListener("abort", abort, { once: true });
    });
    try { const value = await Promise.race([pending, cancelled]); active(); return value; }
    finally { signal.removeEventListener("abort", abort); }
  }
  try {
    active();
    if (!Array.isArray(request.loci) || request.loci.length > 200) throw new CanonicalCoordinateReadError("invalid_request");
    const loci = z.array(locusSchema).max(200).parse(request.loci).sort(compare);
    if (loci.some((locus, i) => i > 0 && compare(locus, loci[i - 1]) === 0)) throw new CanonicalCoordinateReadError("invalid_request");
    const requested = new Set(loci.map(locus => `${locus.chrom}:${locus.pos}`));
    const manifest = validateCanonicalMaterializationReceipt(request.manifest, request.expected);
    const manifestSha256 = sha(JSON.stringify(manifest)), querySha256 = sha(JSON.stringify(loci));
    const cursor = request.cursor == null ? null : cursorSchema.parse(request.cursor);
    if (cursor && (cursor.manifestSha256 !== manifestSha256 || cursor.querySha256 !== querySha256 || cursor.blockSequence >= manifest.blockCount)) {
      throw new CanonicalCoordinateReadError("invalid_request");
    }
    // Never hand our mutable snapshot to caller callbacks. Metadata is bounded;
    // actual source authority must be checked independently of these copies.
    async function check(artifact: PreparedStoredArtifact | null, currentSignal = signal) {
      active();
      await wait(options.check({ manifest: structuredClone(manifest), artifact: artifact ? structuredClone(artifact) : null }, currentSignal));
      active();
    }
    await check(null);
    const context = { binding: manifest.binding, jobId: manifest.jobId, attemptId: manifest.attemptId,
      firstArtifactSequence: manifest.firstArtifactSequence, nextArtifactSequence: manifest.nextArtifactSequence,
      forbiddenArtifacts: [...manifest.directories.map(ref => ref.artifact), ...manifest.coordinatePages.map(ref => ref.artifact)] };
    const records: CanonicalRecord[] = [];
    let bytes = 0, last: CanonicalCoordinateCursor | null = null, cursorSeen = cursor === null;
    let directoryCache: { sequence: number; directory: CanonicalContainerDirectory } | undefined;
    const visitedDirectories = new Set<number>(), dataIdentities = new Set<string>();
    async function object<T>(artifact: PreparedStoredArtifact, decode: (bytes: Uint8Array) => T): Promise<T> {
      return readPreparedStorageRange({ objectKey: artifact.receipt.objectKey, offset: 0,
        length: artifact.receipt.byteCount, total: artifact.receipt.byteCount }, {
        signal, fetchRange: args => options.fetchRange({ ...args, artifact }), check: current => check(artifact, current), decode: async bytes => decode(bytes),
      });
    }
    const matches = (record: CanonicalRecord) => record.normalization.status === "normalized"
      && requested.has(`${record.normalization.record.chrom}:${record.normalization.record.pos}`);
    async function finish(nextCursor: CanonicalCoordinateCursor | null) {
      if (!cursorSeen) throw new CanonicalCoordinateReadError("invalid_request");
      await check(null); active();
      return { records, nextCursor };
    }
    for (const reference of manifest.coordinatePages) {
      if (cursor && reference.envelope.lastBlockSequence < cursor.blockSequence) continue;
      const { normalizedFirst, normalizedLast } = reference.envelope;
      if (!normalizedFirst || !normalizedLast || !loci.some(locus => compare(locus, normalizedFirst) >= 0 && compare(locus, normalizedLast) <= 0)) continue;
      const page = await object(reference.artifact, bytes => decodeCanonicalCoordinatePage(bytes, reference, context));
      const candidates = selectCanonicalCoordinateBlocks(page, loci, manifest.binding);
      for (const descriptor of candidates) {
        if (cursor && descriptor.sequence < cursor.blockSequence) continue;
        const directoryRef = manifest.directories.find(ref => descriptor.sequence >= ref.firstBlockSequence && descriptor.sequence <= ref.lastBlockSequence);
        if (!directoryRef) throw new CanonicalCoordinateReadError("integrity_mismatch");
        if (directoryCache?.sequence !== directoryRef.sequence) {
          const expectedFirstContainerSequence = manifest.directories.slice(0, directoryRef.sequence).reduce((n, ref) => n + ref.containerCount, 0);
          const directory = await object(directoryRef.artifact, bytes => decodeCanonicalContainerDirectory(bytes, directoryRef, {
            ...context, expectedFirstContainerSequence,
          }));
          if (!visitedDirectories.has(directoryRef.sequence)) {
            for (const container of directory.containers) for (const identity of [
              `artifact:${container.artifact.receipt.artifactId}`, `object:${preparedArtifactObjectIdentity(container.artifact)}`, `key:${container.artifact.receipt.objectKey}`,
              `sequence:${container.artifact.receipt.sequence}`,
            ]) {
              if (dataIdentities.has(identity)) throw new CanonicalCoordinateReadError("integrity_mismatch");
              dataIdentities.add(identity);
            }
            visitedDirectories.add(directoryRef.sequence);
          }
          directoryCache = { sequence: directoryRef.sequence, directory };
        }
        const container = directoryCache.directory.containers.find(c => c.descriptor.blocks.some(b => b.descriptor.sequence === descriptor.sequence));
        const range = container?.descriptor.blocks.find(b => b.descriptor.sequence === descriptor.sequence);
        if (!container || !range || !isDeepStrictEqual(range.descriptor, descriptor)) throw new CanonicalCoordinateReadError("integrity_mismatch");
        const decoded = await readCanonicalStorageBlock({ objectKey: container.artifact.receipt.objectKey,
          container: container.descriptor, blockSequence: descriptor.sequence }, {
          signal, fetchRange: args => options.fetchRange({ ...args, artifact: container.artifact }), check: current => check(container.artifact, current),
        });
        if (cursor && descriptor.sequence === cursor.blockSequence) {
          if (!decoded.records[cursor.recordOffset] || !matches(decoded.records[cursor.recordOffset])) throw new CanonicalCoordinateReadError("invalid_request");
          cursorSeen = true;
        }
        for (let offset = 0; offset < decoded.records.length; offset++) {
          if (cursor && descriptor.sequence === cursor.blockSequence && offset <= cursor.recordOffset) continue;
          const record = decoded.records[offset]; if (!matches(record)) continue;
          const size = Buffer.byteLength(JSON.stringify(record));
          if (size > CANONICAL_LOOKUP_MAX_RECORD_BYTES) throw new CanonicalCoordinateReadError("too_large");
          if (records.length && bytes + size > CANONICAL_LOOKUP_MAX_RECORD_BYTES) return await finish(last);
          records.push(record); bytes += size;
          last = { version: "canonical-coordinate-cursor-v1", manifestSha256, querySha256, blockSequence: descriptor.sequence, recordOffset: offset };
          if (records.length === CANONICAL_LOOKUP_MAX_RECORDS) return await finish(last);
        }
      }
    }
    return await finish(null);
  } catch (error) {
    if (signal.aborted) throw new CanonicalCoordinateReadError("aborted");
    if (error instanceof CanonicalCoordinateReadError) throw error;
    // Provider and authority failures never become empty coverage or log paths.
    throw new CanonicalCoordinateReadError("unavailable");
  } finally { clearTimeout(timer); deadline.abort(); }
}
