import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual as equal } from "node:util";
import { validateCanonicalMaterializationReceipt, decodeCanonicalContainerDirectory, decodeCanonicalCoordinatePage } from "./canonical-manifest";
import { decodeCanonicalBlock } from "./canonical-codec";
import { canonicalRecordOrderKey, countCanonicalRecord, emptyCanonicalCounts, type CanonicalOrderKey } from "./canonical-runs";
import type { CanonicalCoordinate, CanonicalCoordinateEntry, CanonicalCoordinateIndex } from "./canonical-coordinate-index";
import type { CanonicalBinding, CanonicalRecord } from "./canonical-schema";
import type { CanonicalMaterializationReceipt } from "./materialize-canonical";
import { preparedArtifactObjectIdentity, type PreparedStoredArtifact } from "./artifact-identity";
import { readVerifiedPreparedArtifact } from "./verified-artifact-reader";

export const PREPARED_EXPORT_DEADLINE_MS = 300_000;
const MAX_ARTIFACTS = 4096;
export type PreparedExportReadOptions = {
  readArtifact: (artifact: PreparedStoredArtifact, signal: AbortSignal) => AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>;
  check: (manifest: CanonicalMaterializationReceipt, artifact: PreparedStoredArtifact | null, signal: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
};
export class PreparedExportReadError extends Error {
  constructor(readonly code: "invalid_manifest" | "integrity_mismatch" | "unavailable" | "aborted") {
    super(code); this.name = "PreparedExportReadError";
  }
}
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function requireValid(condition: unknown): asserts condition { if (!condition) throw new PreparedExportReadError("integrity_mismatch"); }
function compare(a: CanonicalOrderKey, b: CanonicalOrderKey) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Complete bounded canonical export. Each block is authenticated, fully decoded
 * and current-operation checked before release. All original records and
 * dispositions are retained, including duplicates, unmapped/no-call evidence.
 * End-of-stream is successful only after the full manifest/index/count fence.
 * A late failure requires the caller to abort its archive; already delivered
 * blocks cannot be recalled. No complete-source array is allocated.
 *
 * Uses the same full directory/index/byte verification as publication, with
 * one <=8MiB container and one decoded block plus <=4096 identities. The caller
 * must resolve the CURRENT exact published source and export operation at every
 * check; this helper does not turn a stored descriptor into authority.
 */
export async function* streamPreparedExportRecords(rawManifest: unknown,
  expected: { binding: CanonicalBinding; jobId: string; attemptId: string },
  options: PreparedExportReadOptions): AsyncGenerator<CanonicalRecord[], void, unknown> {
  const deadline = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const timer = setTimeout(() => deadline.abort(), PREPARED_EXPORT_DEADLINE_MS); timer.unref();
  const active = () => { if (signal.aborted) throw new PreparedExportReadError("aborted"); };
  async function wait<T>(pending: Promise<T>): Promise<T> {
    if (signal.aborted) { void pending.catch(() => {}); active(); }
    let abort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new PreparedExportReadError("aborted")); signal.addEventListener("abort", abort, { once: true });
    });
    try { const value = await Promise.race([pending, cancelled]); active(); return value; }
    finally { signal.removeEventListener("abort", abort); }
  }
  try {
    active();
    let manifest: CanonicalMaterializationReceipt;
    try { manifest = validateCanonicalMaterializationReceipt(rawManifest, expected); }
    catch { throw new PreparedExportReadError("invalid_manifest"); }
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
          await check(null); active();
          yield decoded.records;
          // Consumer suspension is inside the same finite export lifetime.
          active();
        }
      }
    }
    requireValid(pageIndex === manifest.coordinatePages.length && page && entryIndex === page.entries.length
      && blockCount === manifest.blockCount && containerCount === manifest.containerCount && recordCount === manifest.recordCount
      && byteCount === manifest.byteCount && equal(counts, manifest.counts) && artifacts.length === manifest.artifactCount);
    for (let sequence = manifest.firstArtifactSequence; sequence < manifest.nextArtifactSequence; sequence++) requireValid(sequences.has(sequence));
    artifacts.sort((a, b) => a.receipt.sequence - b.receipt.sequence);
    await check(null); active();

  } catch (error) {
    if (signal.aborted) throw new PreparedExportReadError("aborted");
    if (error instanceof PreparedExportReadError) throw error;
    // Callback/provider diagnostics can contain private URLs or identifiers.
    // Keep them out of public errors; callers retain their own safe diagnostics.
    throw new PreparedExportReadError("unavailable");
  } finally { clearTimeout(timer); deadline.abort(); }
}
