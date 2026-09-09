import { preparedArtifactObjectIdentity } from "./artifact-identity";
import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual as equal } from "node:util";
import { validateCanonicalMaterializationReceipt, decodeCanonicalContainerDirectory, decodeCanonicalCoordinatePage } from "./canonical-manifest";
import { decodeCanonicalBlock } from "./canonical-codec";
import { canonicalRecordOrderKey, countCanonicalRecord, emptyCanonicalCounts, type CanonicalOrderKey } from "./canonical-runs";
import type { CanonicalCoordinate, CanonicalCoordinateEntry, CanonicalCoordinateIndex } from "./canonical-coordinate-index";
import type { CanonicalBinding, CanonicalSummary } from "./canonical-schema";
import type { CanonicalMaterializationReceipt } from "./materialize-canonical";
import type { PreparedStoredArtifact } from "./storage-writer";
import { readVerifiedPreparedArtifact } from "./verified-artifact-reader";

export const CANONICAL_VERIFICATION_DEADLINE_MS = 300_000;
const MAX_ARTIFACTS = 4096;
export type VerifiedCanonicalMaterialization = {
  version: "verified-canonical-materialization-v1"; state: "provisional"; binding: CanonicalBinding;
  jobId: string; attemptId: string; manifestSha256: string; artifactCount: number; blockCount: number;
  containerCount: number; recordCount: number; byteCount: number; counts: ReturnType<typeof emptyCanonicalCounts>;
  canonicalSummary: CanonicalSummary; artifacts: PreparedStoredArtifact[];
};
export type CanonicalVerificationOptions = {
  readArtifact: (artifact: PreparedStoredArtifact, signal: AbortSignal) => AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>;
  check: (manifest: CanonicalMaterializationReceipt, artifact: PreparedStoredArtifact | null, signal: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
};
export class CanonicalVerificationError extends Error {
  constructor(readonly code: "invalid_manifest" | "integrity_mismatch" | "unavailable" | "aborted") {
    super(code); this.name = "CanonicalVerificationError";
  }
}
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function requireValid(condition: unknown): asserts condition { if (!condition) throw new CanonicalVerificationError("integrity_mismatch"); }
function compare(a: CanonicalOrderKey, b: CanonicalOrderKey) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** FULL provisional byte/membership verification, NOT SQL publication or an
 * authorization token. The check callback must independently resolve the exact
 * current root/source/job/attempt and each registered artifact. A subsequent
 * publication transaction must still atomically recheck authority/membership.
 *
 * Reads every referenced directory, coordinate page and data container through
 * actual EOF. Counts every retained record and checks the actual normalized
 * bounds against the index (including source-only tails and boundary collisions).
 * Canonical attempted/unmapped counts are UNIQUE SOURCE LOCI, unlike disposition
 * counts; their existing source-normalization receipt is retained, not recomputed
 * from target order or mislabeled as record counts.
 *
 * Holds one directory, one coordinate page, one <=8MiB container and one decoded
 * codec block, plus bounded root/<=4096 membership metadata. No call/block map.
 * All provider reads are serial. Callbacks must honor signal and own any late
 * I/O. The verifier closes acquired/late iterators best-effort without allowing
 * cleanup failures to replace the original result; it never retries a read.
 * The complete pass has a finite 300s maximum (each artifact at most 30s);
 * current claim/consent deadlines can expire sooner and are never renewed.
 * manifestSha256 hashes validated JSON serialization, not a later combined
 * root Storage object; publication must bind that actual object hash separately.
 */
export async function verifyCanonicalMaterialization(rawManifest: unknown,
  expected: { binding: CanonicalBinding; jobId: string; attemptId: string },
  options: CanonicalVerificationOptions): Promise<VerifiedCanonicalMaterialization> {
  const deadline = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const timer = setTimeout(() => deadline.abort(), CANONICAL_VERIFICATION_DEADLINE_MS); timer.unref();
  const active = () => { if (signal.aborted) throw new CanonicalVerificationError("aborted"); };
  async function wait<T>(pending: Promise<T>): Promise<T> {
    if (signal.aborted) { void pending.catch(() => {}); active(); }
    let abort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new CanonicalVerificationError("aborted")); signal.addEventListener("abort", abort, { once: true });
    });
    try { const value = await Promise.race([pending, cancelled]); active(); return value; }
    finally { signal.removeEventListener("abort", abort); }
  }
  try {
    active();
    let manifest: CanonicalMaterializationReceipt;
    try { manifest = validateCanonicalMaterializationReceipt(rawManifest, expected); }
    catch { throw new CanonicalVerificationError("invalid_manifest"); }
    const manifestSha256 = sha(JSON.stringify(manifest));
    async function check(artifact: PreparedStoredArtifact | null) {
      active();
      await wait(options.check(structuredClone(manifest), artifact ? structuredClone(artifact) : null, signal));
      active();
    }
    const artifacts: PreparedStoredArtifact[] = [], identities = new Set<string>(), sequences = new Set<number>();
    function member(artifact: PreparedStoredArtifact) {
      requireValid(artifacts.length < MAX_ARTIFACTS && artifact.receipt.jobId === manifest.jobId && artifact.receipt.attemptId === manifest.attemptId
        && artifact.receipt.sequence >= manifest.firstArtifactSequence && artifact.receipt.sequence < manifest.nextArtifactSequence);
      for (const identity of [`artifact:${artifact.receipt.artifactId}`, `object:${preparedArtifactObjectIdentity(artifact)}`,
        `key:${artifact.receipt.objectKey}`, `sequence:${artifact.receipt.sequence}`]) {
        requireValid(!identities.has(identity)); identities.add(identity);
      }
      sequences.add(artifact.receipt.sequence); artifacts.push(artifact);
    }
    const forbiddenArtifacts = [...manifest.directories.map(d => d.artifact), ...manifest.coordinatePages.map(p => p.artifact)];
    forbiddenArtifacts.forEach(member);
    const context = { binding: manifest.binding, jobId: manifest.jobId, attemptId: manifest.attemptId,
      firstArtifactSequence: manifest.firstArtifactSequence, nextArtifactSequence: manifest.nextArtifactSequence, forbiddenArtifacts };
    await check(null);

    const read = (artifact: PreparedStoredArtifact) => readVerifiedPreparedArtifact(artifact, {
      signal, readArtifact: options.readArtifact,
      check: (current, currentSignal) => options.check(structuredClone(manifest), structuredClone(current), currentSignal),
    });

    let page: CanonicalCoordinateIndex | undefined, pageIndex = 0, entryIndex = 0;
    async function nextEntry(): Promise<CanonicalCoordinateEntry> {
      if (!page || entryIndex === page.entries.length) {
        page = undefined; entryIndex = 0;
        const reference = manifest.coordinatePages[pageIndex++]; requireValid(reference);
        const bytes = await read(reference.artifact);
        page = decodeCanonicalCoordinatePage(bytes, reference, context);
      }
      return page.entries[entryIndex++];
    }
    const counts = emptyCanonicalCounts();
    let blockCount = 0, containerCount = 0, recordCount = 0, byteCount = 0;
    let previousKey: CanonicalOrderKey | undefined;
    for (const reference of manifest.directories) {
      const directory = decodeCanonicalContainerDirectory(await read(reference.artifact), reference,
        { ...context, expectedFirstContainerSequence: containerCount });
      for (const stored of directory.containers) {
        member(stored.artifact);
        const bytes = await read(stored.artifact); byteCount += bytes.length; containerCount++;
        requireValid(stored.descriptor.byteCount === bytes.length && stored.descriptor.sha256 === sha(bytes));
        for (const range of stored.descriptor.blocks) {
          const entry = await nextEntry();
          requireValid(range.descriptor.sequence === blockCount && equal(range.descriptor, entry.descriptor));
          const slice = bytes.subarray(range.offset, range.offset + range.length);
          const decoded = await decodeCanonicalBlock((async function* () { yield slice; })(), range.descriptor, { signal });
          active();
          let normalizedFirst: CanonicalCoordinate | null = null, normalizedLast: CanonicalCoordinate | null = null, normalizedCount = 0;
          for (const record of decoded.records) {
            const key = canonicalRecordOrderKey(record);
            if (previousKey) requireValid(compare(previousKey, key) <= 0);
            previousKey = key; countCanonicalRecord(counts, record); recordCount++;
            if (record.normalization.status === "normalized") {
              const locus = { chrom: record.normalization.record.chrom, pos: record.normalization.record.pos };
              normalizedFirst ??= locus; normalizedLast = locus; normalizedCount++;
            }
          }
          requireValid(equal(entry, { descriptor: range.descriptor, normalizedFirst, normalizedLast, normalizedCount,
            firstKey: canonicalRecordOrderKey(decoded.records[0]), lastKey: canonicalRecordOrderKey(decoded.records.at(-1)!) }));
          blockCount++;
        }
      }
    }
    requireValid(pageIndex === manifest.coordinatePages.length && page && entryIndex === page.entries.length
      && blockCount === manifest.blockCount && containerCount === manifest.containerCount && recordCount === manifest.recordCount
      && byteCount === manifest.byteCount && equal(counts, manifest.counts) && artifacts.length === manifest.artifactCount);
    for (let sequence = manifest.firstArtifactSequence; sequence < manifest.nextArtifactSequence; sequence++) requireValid(sequences.has(sequence));
    artifacts.sort((a, b) => a.receipt.sequence - b.receipt.sequence);
    await check(null); active();
    return { version: "verified-canonical-materialization-v1", state: "provisional", binding: manifest.binding,
      jobId: manifest.jobId, attemptId: manifest.attemptId, manifestSha256, artifactCount: artifacts.length,
      blockCount, containerCount, recordCount, byteCount, counts, canonicalSummary: manifest.canonicalSummary, artifacts };
  } catch (error) {
    if (signal.aborted) throw new CanonicalVerificationError("aborted");
    if (error instanceof CanonicalVerificationError) throw error;
    // Callback/provider diagnostics can contain private URLs or identifiers.
    // Keep them out of public errors; callers retain their own safe diagnostics.
    throw new CanonicalVerificationError("unavailable");
  } finally { clearTimeout(timer); deadline.abort(); }
}
