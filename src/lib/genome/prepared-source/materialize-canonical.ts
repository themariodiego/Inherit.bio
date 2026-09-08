import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { encodeCanonicalBlock, CanonicalBlockError } from "./canonical-codec";
import { createCanonicalContainerPacker, type CanonicalContainerDescriptor } from "./canonical-containers";
import { createCanonicalCoordinateIndexBuilder, describeCanonicalCoordinateIndex,
  type CanonicalCoordinateIndex } from "./canonical-coordinate-index";
import { canonicalBindingSchema, canonicalRecordSchema, canonicalSummarySchema,
  type CanonicalBinding, type CanonicalRecord, type CanonicalSummary } from "./canonical-schema";
import { canonicalRecordOrderKey, countCanonicalRecord, emptyCanonicalCounts,
  CANONICAL_RUN_MAX_RECORD_BYTES, type CanonicalOrderKey } from "./canonical-runs";
import type { CanonicalMergeSummary } from "./canonical-merge";
import { preparedArtifactReceiptSchema, type PreparedArtifactDescriptor, type PreparedStoredArtifact } from "./storage-writer";

const integer = z.number().int().nonnegative().safe();
const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const countsSchema = z.object({ sourceVariantCount: integer, sourceObservedCount: integer, sourceReferenceCount: integer,
  normalizedVariantCount: integer, normalizedObservedCount: integer, usableObservedCount: integer,
  duplicateCount: integer, unmappedCount: integer, unsupportedAlleleCount: integer }).strict();
const mergeSchema = z.object({ type: z.literal("canonical-merge-summary"), version: z.literal("canonical-merge-summary-v1"),
  state: z.literal("provisional"), binding: canonicalBindingSchema, inputRunSequences: z.array(integer).min(1).max(8),
  inputBlockCount: integer.positive(), recordCount: integer.positive(), counts: countsSchema }).strict().refine(m =>
  m.inputRunSequences.every((n, i, all) => i === 0 || n > all[i - 1])
  && m.inputBlockCount >= m.inputRunSequences.length && m.inputBlockCount <= m.recordCount);
export const CANONICAL_DIRECTORY_MAX_BYTES = 1_048_576;
export const CANONICAL_MATERIALIZATION_MAX_RECEIPT_BYTES = 4_000_000;
const MAX_ARTIFACTS = 4096;
export type CanonicalStoredContainer = { artifact: PreparedStoredArtifact; descriptor: CanonicalContainerDescriptor };
export type CanonicalContainerDirectory = { version: "canonical-container-directory-v1"; state: "provisional";
  binding: CanonicalBinding; sequence: number; containers: CanonicalStoredContainer[] };
export type CanonicalDirectoryReference = { artifact: PreparedStoredArtifact; sequence: number;
  firstBlockSequence: number; lastBlockSequence: number; containerCount: number; blockCount: number };
export type CanonicalCoordinateReference = { artifact: PreparedStoredArtifact;
  envelope: ReturnType<typeof describeCanonicalCoordinateIndex> };
export class CanonicalMaterializationError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_summary" | "out_of_order" | "ack_mismatch" | "too_large" | "aborted") {
    super(code); this.name = "CanonicalMaterializationError";
  }
}
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function* chunk(bytes: Uint8Array) { yield bytes; }
function compare(a: CanonicalOrderKey, b: CanonicalOrderKey) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Materialize a final sorted merge into immutable data, coordinate pages and
 * paged container directories. Actual canonical and merge terminals remain
 * separate; the receipt requires exact counts AND real upstream EOF.
 *
 * This is PROVISIONAL: the subsequent rsID scan, publication transaction and
 * current authority checks are mandatory before any report can use it. The
 * supplied writer must be createPreparedArtifactWriter (or equivalent verified
 * create-only transport), bound to the SAME live job/attempt/source. Receipt
 * validation alone does not establish provider durability or permission.
 *
 * Holds <=2000 records / 8MiB expanded JSON, bounded codec/container buffers,
 * one <=1MiB directory and <=4MB root receipt metadata. No whole-genome calls or
 * block descriptors are retained. All writes are serial and awaited. On any
 * failure, all reserved objects remain job-owned for cleanup; no publication or
 * deletion is attempted here. Artifact sequence shares the job's 4096 cap.
 */
export async function materializeCanonicalMerge(records: AsyncIterable<CanonicalRecord | CanonicalMergeSummary>, options: {
  binding: CanonicalBinding; canonicalSummary: CanonicalSummary; jobId: string; attemptId: string;
  firstArtifactSequence?: number; signal?: AbortSignal;
  writeArtifact: (input: { descriptor: PreparedArtifactDescriptor; bytes: Uint8Array }, signal?: AbortSignal) => Promise<PreparedStoredArtifact>;
}) {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const active = () => { if (signal?.aborted) throw new CanonicalMaterializationError("aborted"); };
  active();
  // Bound variable-size metadata before schema cloning/serialization.
  if (!Array.isArray(options.canonicalSummary?.mergeSummary?.inputRunSequences)
    || options.canonicalSummary.mergeSummary.inputRunSequences.length > 8) throw new CanonicalMaterializationError("invalid_summary");
  const binding = canonicalBindingSchema.parse(options.binding), canonicalSummary = canonicalSummarySchema.parse(options.canonicalSummary);
  if (!isDeepStrictEqual(binding, canonicalSummary.binding)) throw new CanonicalMaterializationError("invalid_summary");
  const jobId = uuid.parse(options.jobId), attemptId = uuid.parse(options.attemptId);
  const firstArtifactSequence = z.number().int().min(0).max(MAX_ARTIFACTS - 1).parse(options.firstArtifactSequence ?? 0);
  let artifactSequence = firstArtifactSequence;
  const identities = new Set<string>();
  const directories: CanonicalDirectoryReference[] = [], coordinatePages: CanonicalCoordinateReference[] = [];
  let receiptBytes = Buffer.byteLength(JSON.stringify({ binding, canonicalSummary })) + 4096;
  function reserveMetadata(value: unknown) {
    receiptBytes += Buffer.byteLength(JSON.stringify(value)) + 1;
    if (receiptBytes > CANONICAL_MATERIALIZATION_MAX_RECEIPT_BYTES) throw new CanonicalMaterializationError("too_large");
  }
  async function wait<T>(pending: Promise<T>): Promise<T> {
    if (signal?.aborted) { void pending.catch(() => {}); active(); }
    if (!signal) return pending;
    let abort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new CanonicalMaterializationError("aborted")); signal.addEventListener("abort", abort, { once: true });
    });
    try { const value = await Promise.race([pending, cancelled]); active(); return value; }
    finally { signal.removeEventListener("abort", abort); }
  }
  async function write(bytes: Uint8Array): Promise<PreparedStoredArtifact> {
    active();
    if (artifactSequence >= MAX_ARTIFACTS) throw new CanonicalMaterializationError("too_large");
    const descriptor: PreparedArtifactDescriptor = { kind: "container", sequence: artifactSequence, byteCount: bytes.byteLength, sha256: sha(bytes) };
    const response = await wait(options.writeArtifact({ descriptor: { ...descriptor }, bytes }, signal));
    active();
    const parsed = z.object({ receipt: preparedArtifactReceiptSchema, storageObjectId: uuid }).strict().safeParse(response);
    if (!parsed.success) throw new CanonicalMaterializationError("ack_mismatch");
    const stored = parsed.data, receipt = stored.receipt;
    if (receipt.jobId !== jobId || receipt.attemptId !== attemptId || receipt.sequence !== artifactSequence
      || receipt.byteCount !== descriptor.byteCount || receipt.sha256 !== descriptor.sha256 || sha(bytes) !== descriptor.sha256) {
      throw new CanonicalMaterializationError("ack_mismatch");
    }
    for (const identity of [`artifact:${receipt.artifactId}`, `object:${stored.storageObjectId}`, `key:${receipt.objectKey}`]) {
      if (identities.has(identity)) throw new CanonicalMaterializationError("ack_mismatch");
      identities.add(identity);
    }
    artifactSequence++;
    return stored;
  }
  let directory: CanonicalStoredContainer[] = [], directoryBytes = 0;
  function directoryEnvelope(): CanonicalContainerDirectory {
    return { version: "canonical-container-directory-v1", state: "provisional", binding, sequence: directories.length, containers: directory };
  }
  async function flushDirectory() {
    if (!directory.length) return;
    const bytes = Buffer.from(JSON.stringify(directoryEnvelope()));
    if (bytes.length > CANONICAL_DIRECTORY_MAX_BYTES) throw new CanonicalMaterializationError("too_large");
    const artifact = await write(bytes);
    const reference: CanonicalDirectoryReference = { artifact, sequence: directories.length,
      firstBlockSequence: directory[0].descriptor.blocks[0].descriptor.sequence,
      lastBlockSequence: directory.at(-1)!.descriptor.blocks.at(-1)!.descriptor.sequence,
      containerCount: directory.length, blockCount: directory.reduce((n, c) => n + c.descriptor.blocks.length, 0) };
    reserveMetadata(reference); directories.push(reference); directory = []; directoryBytes = 0;
  }
  const packer = createCanonicalContainerPacker({ binding, signal, sink: async container => {
    const stored = { artifact: await write(container.bytes), descriptor: container.descriptor };
    const size = Buffer.byteLength(JSON.stringify(stored)) + 1;
    // 4KiB covers the bounded binding/envelope; verify actual serialization too.
    if (directory.length && (directory.length >= 128 || directoryBytes + size + 4096 > CANONICAL_DIRECTORY_MAX_BYTES)) await flushDirectory();
    if (size + 4096 > CANONICAL_DIRECTORY_MAX_BYTES) throw new CanonicalMaterializationError("too_large");
    directory.push(stored); directoryBytes += size;
    return container.descriptor;
  } });
  const index = createCanonicalCoordinateIndexBuilder({ binding, signal });
  async function writePage(page: CanonicalCoordinateIndex | null) {
    if (!page) return;
    const reference = { artifact: await write(Buffer.from(JSON.stringify(page))), envelope: describeCanonicalCoordinateIndex(page, binding) };
    reserveMetadata(reference); coordinatePages.push(reference);
  }
  let buffer: CanonicalRecord[] = [], bufferedBytes = 0, blockSequence = 0, recordCount = 0;
  let previous: CanonicalOrderKey | undefined, terminal: CanonicalMergeSummary | undefined;
  const counts = emptyCanonicalCounts();
  async function emit(part: CanonicalRecord[]): Promise<void> {
    active();
    let encoded: Awaited<ReturnType<typeof encodeCanonicalBlock>>;
    try { encoded = await wait(encodeCanonicalBlock({ binding, sequence: blockSequence, records: part }, { signal })); }
    catch (error) {
      if (error instanceof CanonicalBlockError && error.code === "too_large" && part.length > 1) {
        const middle = Math.floor(part.length / 2); await emit(part.slice(0, middle)); await emit(part.slice(middle)); return;
      }
      throw error;
    }
    await packer.append(encoded);
    await writePage(await index.append(chunk(encoded.compressed), encoded.descriptor));
    blockSequence++;
  }
  async function flushRecords() {
    if (!buffer.length) return;
    await emit(buffer); buffer = []; bufferedBytes = 0;
  }
  const iterator = records[Symbol.asyncIterator]();
  let exhausted = false;
  try {
    for (;;) {
      active();
      const next = await wait(iterator.next());
      if (next.done) { exhausted = true; break; }
      if (terminal) throw new CanonicalMaterializationError("invalid_summary");
      const raw = next.value;
      if (raw?.type === "canonical-merge-summary") {
        if (!Array.isArray(raw.inputRunSequences) || raw.inputRunSequences.length > 8) throw new CanonicalMaterializationError("invalid_summary");
        const parsed = mergeSchema.safeParse(raw);
        if (!parsed.success || !isDeepStrictEqual(parsed.data.binding, binding) || parsed.data.recordCount !== recordCount
          || !isDeepStrictEqual(parsed.data.counts, counts)) throw new CanonicalMaterializationError("invalid_summary");
        terminal = parsed.data; continue;
      }
      // Bound aggregate known string fields before the schema clones them.
      let stringBytes = 0;
      const original = raw?.event?.type === "variant" ? raw.event.record : raw?.event?.call;
      const normalized = raw?.normalization?.status === "normalized" ? raw.normalization.record : undefined;
      for (const fields of [original, normalized]) if (fields && typeof fields === "object") {
        for (const name of ["ref", "alt", "genotype", "sourceGt", "filter", "sampleFilter", "quality"] as const) {
          const value = Reflect.get(fields, name);
          if (typeof value === "string") stringBytes += Buffer.byteLength(value);
          if (stringBytes > CANONICAL_RUN_MAX_RECORD_BYTES) throw new CanonicalMaterializationError("too_large");
        }
      }
      const parsed = canonicalRecordSchema.safeParse(raw);
      if (!parsed.success) throw new CanonicalMaterializationError("invalid_input");
      const record = parsed.data, key = canonicalRecordOrderKey(record);
      if (previous && compare(previous, key) > 0) throw new CanonicalMaterializationError("out_of_order");
      previous = key;
      // Individual fields already bounded by canonicalRecordSchema.
      const bytes = Buffer.byteLength(JSON.stringify(record));
      if (bytes > CANONICAL_RUN_MAX_RECORD_BYTES) throw new CanonicalMaterializationError("too_large");
      if (buffer.length && bufferedBytes + bytes > CANONICAL_RUN_MAX_RECORD_BYTES) await flushRecords();
      buffer.push(record); bufferedBytes += bytes; countCanonicalRecord(counts, record); recordCount++;
      if (!Number.isSafeInteger(recordCount)) throw new CanonicalMaterializationError("too_large");
      if (buffer.length === 2000) await flushRecords();
    }
    // Canonical attempted/unmapped count unique source loci; disposition
    // counts count records. Preserve both receipts without equating those units.
    if (!terminal || canonicalSummary.eventCount !== recordCount
      || canonicalSummary.variantCount !== counts.normalizedVariantCount
      || canonicalSummary.observedCallCount !== counts.normalizedObservedCount
      || canonicalSummary.usableObservedCount !== counts.usableObservedCount
      || canonicalSummary.mergeSummary.variantCount !== counts.sourceVariantCount
      || canonicalSummary.mergeSummary.observedCallCount !== counts.sourceObservedCount
      || canonicalSummary.mergeSummary.referenceCallCount !== counts.sourceReferenceCount) throw new CanonicalMaterializationError("invalid_summary");
    await flushRecords();
    const containers = await packer.finish();
    await flushDirectory();
    const coordinates = index.finish(); await writePage(coordinates.page); active();
    if (coordinates.summary.blockCount !== blockSequence || coordinates.summary.recordCount !== recordCount
      || coordinates.summary.normalizedCount !== counts.normalizedObservedCount + counts.normalizedVariantCount
      || containers.blockCount !== blockSequence) throw new CanonicalMaterializationError("invalid_summary");
    const receipt = { version: "canonical-materialization-v1" as const, state: "provisional" as const,
      binding, jobId, attemptId, canonicalSummary, mergeSummary: terminal, counts, recordCount, blockCount: blockSequence,
      containerCount: containers.containerCount, byteCount: containers.byteCount, directories, coordinatePages,
      coordinateSummary: coordinates.summary, firstArtifactSequence, nextArtifactSequence: artifactSequence,
      artifactCount: artifactSequence - firstArtifactSequence };
    if (Buffer.byteLength(JSON.stringify(receipt)) > CANONICAL_MATERIALIZATION_MAX_RECEIPT_BYTES) throw new CanonicalMaterializationError("too_large");
    return receipt;
  } finally {
    controller.abort(); // Drop packer/index listeners and buffers on every exit.
    if (!exhausted && iterator.return) {
      try { const closing = Promise.resolve(iterator.return()); if (signal?.aborted) void closing.catch(() => {}); else await wait(closing); }
      catch { /* Preserve the original failure; reserved objects stay cleanup-owned. */ }
    }
  }
}

export type CanonicalMaterializationReceipt = Awaited<ReturnType<typeof materializeCanonicalMerge>>;
