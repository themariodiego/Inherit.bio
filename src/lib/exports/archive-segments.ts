import "server-only";
import { createHash, randomUUID } from "node:crypto";

/** Physical objects and download chunks share this boundary. This is decimal
 * bytes, as required by payloadBoundaryContract, not 4 MiB. */
export const ARCHIVE_SEGMENT_BYTES = 4_000_000;
export const ARCHIVE_METADATA_PAGE_SEGMENTS = 128;
export const ARCHIVE_OPERATION_TIMEOUT_MS = 30_000;
export const ARCHIVE_BUCKET = "exports";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
function exactRecord(value: unknown, keys: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.every(key => typeof key === "string") && (own as string[]).sort().join(",") === keys
    && own.every(key => { const descriptor = Object.getOwnPropertyDescriptor(value, key)!; return descriptor.enumerable && "value" in descriptor; });
}

export type ArchiveAttempt = Readonly<{
  version: "archive-segments-v1";
  exportId: string;
  principalHash: string;
  attemptId: string;
  bucket: typeof ARCHIVE_BUCKET;
}>;
export type ArchiveSegment = Readonly<{
  ordinal: number;
  offset: number;
  sizeBytes: number;
  sha256: string;
  objectKey: string;
}>;
export type ArchiveWriteAck = Readonly<{ objectId: string }>;
export type StoredArchiveSegment = ArchiveSegment & ArchiveWriteAck;
export type ArchiveMetadataPage = Readonly<{
  page: number;
  segments: readonly StoredArchiveSegment[];
}>;
export type StoredArchive = Readonly<{
  /** Byte completion only. The caller must independently prove ZIP EOF, exact
   * authorized membership and final live authority in its atomic ready CAS. */
  state: "bytes-complete";
  attempt: ArchiveAttempt;
  authorityReceipt: string;
  sizeBytes: number;
  sha256: string;
  segmentCount: number;
  pageCount: number;
  manifestSha256: string;
}>;
export type ArchiveSegmentationOptions = {
  exportId: string;
  principalHash: string;
  /** Captured by the exact database-authorized job claim, never client input.
   * Even the first fresh check must match; do not adopt changed queued scope. */
  authorityReceipt: string;
  /** Server-owned lease/deadline, not a client option. No extending it mid-run. */
  deadline: number;
  signal: AbortSignal;
  /** Must read the exact current origin/session/subject/contributor/source and
   * grant revisions. Source adapters must ALSO check before each member/read. */
  checkAuthority: (attempt: ArchiveAttempt, signal: AbortSignal) => Promise<string>;
  /** Durable INSERT-only attempt claim. Refuse an existing attempt, including
   * completed attempts. There is no recovery/adoption argument in this API. */
  beginAttempt: (attempt: ArchiveAttempt, signal: AbortSignal) => Promise<void>;
  /** Created only after authority + attempt claim. Emit chunks <=4,000,000 B;
   * use a bounded producer highWaterMark. A producer error must propagate. */
  source: (signal: AbortSignal) => ReadableStream<Uint8Array>;
  /** Durably reserve the exact key before any write. Keep every reservation,
   * including unacknowledged/late writes, in the attempt's cleanup inventory. */
  reserve: (attempt: ArchiveAttempt, segment: ArchiveSegment, signal: AbortSignal) => Promise<void>;
  /** Exactly one immutable whole-object attempt; no retry/upsert/adoption. */
  write: (attempt: ArchiveAttempt, segment: ArchiveSegment, bytes: Uint8Array, signal: AbortSignal) => Promise<ArchiveWriteAck>;
  acknowledge: (attempt: ArchiveAttempt, segment: StoredArchiveSegment, signal: AbortSignal) => Promise<void>;
  /** INSERT-only ordered pages. Never marks a job ready or sends mail. */
  appendPage: (attempt: ArchiveAttempt, page: ArchiveMetadataPage, signal: AbortSignal) => Promise<void>;
};

type FailureCode = "invalid_input" | "invalid_source" | "aborted" | "deadline" | "authority" | "metadata" | "storage";
export class ArchiveSegmentationError extends Error {
  constructor(readonly code: FailureCode, readonly cleanupRequired = false) {
    super(code); this.name = "ArchiveSegmentationError";
  }
}

/** Also used by manifest readers. Safe integer arithmetic, never bitwise/u32.
 * A partial segment can occur only at EOF; the streaming writer enforces that. */
export function archiveSegmentCoordinates(ordinal: number, sizeBytes: number) {
  const offset = ordinal * ARCHIVE_SEGMENT_BYTES;
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || !Number.isSafeInteger(sizeBytes)
    || sizeBytes < 1 || sizeBytes > ARCHIVE_SEGMENT_BYTES || !Number.isSafeInteger(offset)
    || !Number.isSafeInteger(offset + sizeBytes)) throw new ArchiveSegmentationError("invalid_input");
  return { ordinal, offset, sizeBytes };
}

/** Closed identity validation shared by the writer, manifest and byte reader.
 * It establishes shape/namespace only, never grants live authority. */
export function validateArchiveSegment(attempt: ArchiveAttempt, segment: ArchiveSegment | StoredArchiveSegment, requireObjectId = false): void {
  if (!exactRecord(attempt, "attemptId,bucket,exportId,principalHash,version")
    || attempt.version !== "archive-segments-v1" || attempt.bucket !== ARCHIVE_BUCKET
    || typeof attempt.exportId !== "string" || !UUID.test(attempt.exportId)
    || typeof attempt.attemptId !== "string" || !UUID.test(attempt.attemptId)
    || typeof attempt.principalHash !== "string" || !SHA256.test(attempt.principalHash)
    || !exactRecord(segment, requireObjectId
      ? "objectId,objectKey,offset,ordinal,sha256,sizeBytes" : "objectKey,offset,ordinal,sha256,sizeBytes"))
    throw new ArchiveSegmentationError("invalid_input");
  const coordinates = archiveSegmentCoordinates(segment.ordinal, segment.sizeBytes);
  if (segment.offset !== coordinates.offset || typeof segment.sha256 !== "string" || !SHA256.test(segment.sha256)
    || segment.objectKey !== `${attempt.principalHash}/${attempt.exportId}/${attempt.attemptId}-${segment.ordinal}.part`
    || (requireObjectId && (!("objectId" in segment) || typeof segment.objectId !== "string" || !UUID.test(segment.objectId))))
    throw new ArchiveSegmentationError("invalid_input");
}

/** The same manifest accounting used by the byte writer, with bounded pages.
 * Exercising this with virtual descriptors proves offsets/paging, not a large
 * archive transfer or a ZIP64 producer. There is deliberately no resume state. */
export class ArchiveManifestPages {
  private readonly hash = createHash("sha256");
  private page: StoredArchiveSegment[] = [];
  private count = 0;
  private pages = 0;
  private bytes = 0;
  private partial = false;
  private closed = false;
  private busy = false;
  private readonly attempt: ArchiveAttempt;
  constructor(attempt: ArchiveAttempt, private readonly append: (page: ArchiveMetadataPage) => Promise<void>) {
    this.attempt = Object.freeze({ ...attempt });
  }
  private async flush() {
    if (!this.page.length) return;
    await this.append(Object.freeze({ page: this.pages, segments: Object.freeze(this.page) }));
    this.pages += 1; this.page = [];
  }
  async push(segment: StoredArchiveSegment) {
    if (this.closed || this.busy) { this.closed = true; throw new ArchiveSegmentationError("metadata"); }
    this.busy = true;
    try {
      validateArchiveSegment(this.attempt, segment, true);
      if (this.partial || segment.ordinal !== this.count || segment.offset !== this.bytes)
        throw new ArchiveSegmentationError("metadata");
      const value = Object.freeze({ ...segment });
      this.hash.update(JSON.stringify([value.ordinal, value.offset, value.sizeBytes, value.sha256, value.objectKey, value.objectId]) + "\n");
      this.page.push(value); this.count += 1; this.bytes += value.sizeBytes;
      this.partial = value.sizeBytes < ARCHIVE_SEGMENT_BYTES;
      if (this.page.length === ARCHIVE_METADATA_PAGE_SEGMENTS) await this.flush();
    } catch (error) { this.closed = true; throw error; }
    finally { this.busy = false; }
  }
  async finish() {
    if (this.closed || this.busy || !this.count) throw new ArchiveSegmentationError("metadata");
    this.closed = true; await this.flush();
    return Object.freeze({ sizeBytes: this.bytes, segmentCount: this.count,
      pageCount: this.pages, manifestSha256: this.hash.digest("hex") });
  }
}

/** Streams a logical archive to bounded immutable objects. Memory is one owned
 * segment, one bounded input chunk and one metadata page, independent of total
 * size. Hooks are capabilities, not proof of a deployed authority/cleanup DB.
 * An abort/unknown write closes the attempt; no later ACK/page/write runs. The
 * durable reservation is deliberately NOT removed, even on an HTTP failure.
 */
export async function storeArchiveSegments(options: ArchiveSegmentationOptions): Promise<StoredArchive> {
  const deadline = options.deadline, authorityReceipt = options.authorityReceipt;
  if (!UUID.test(options.exportId) || !SHA256.test(options.principalHash)
    || typeof authorityReceipt !== "string" || !SHA256.test(authorityReceipt)
    || !Number.isSafeInteger(deadline) || deadline <= Date.now()
    || deadline - Date.now() > 86_400_000) throw new ArchiveSegmentationError("invalid_input");
  const attempt: ArchiveAttempt = Object.freeze({ version: "archive-segments-v1", exportId: options.exportId,
    principalHash: options.principalHash, attemptId: randomUUID(), bucket: ARCHIVE_BUCKET });
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const deadlineTimer = setTimeout(() => controller.abort(), deadline - Date.now());
  deadlineTimer.unref();
  let cleanupRequired = false, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let completed = false;
  const fail = (code: FailureCode): never => { throw new ArchiveSegmentationError(code, cleanupRequired); };
  function active() {
    if (Date.now() >= deadline) fail("deadline");
    if (signal.aborted) fail("aborted");
  }
  async function operation<T>(code: FailureCode, work: (current: AbortSignal) => Promise<T>): Promise<T> {
    active();
    const bound = new AbortController(), current = AbortSignal.any([signal, bound.signal]);
    const timer = setTimeout(() => bound.abort(), ARCHIVE_OPERATION_TIMEOUT_MS); timer.unref();
    let abort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new ArchiveSegmentationError(Date.now() >= deadline || bound.signal.aborted ? "deadline" : "aborted", cleanupRequired));
      current.addEventListener("abort", abort, { once: true });
    });
    try {
      if (current.aborted) abort();
      // The microtask checks again so a synchronous abort cannot admit work.
      const pending = Promise.resolve().then(() => { active(); if (current.aborted) fail("deadline"); return work(current); });
      const result = await Promise.race([pending, cancelled]);
      active(); if (current.aborted) fail("deadline");
      return result;
    } catch (error) {
      if (error instanceof ArchiveSegmentationError) throw new ArchiveSegmentationError(error.code, cleanupRequired || error.cleanupRequired);
      return fail(code);
    } finally {
      clearTimeout(timer); current.removeEventListener("abort", abort); bound.abort();
    }
  }
  const check = async () => {
    const receipt = await operation("authority", current => options.checkAuthority(attempt, current));
    if (typeof receipt !== "string" || !SHA256.test(receipt) || receipt !== authorityReceipt) fail("authority");
  };
  async function mutation(work: (current: AbortSignal) => Promise<void>) {
    await check(); await operation("metadata", work); await check();
  }
  const cancelReader = () => { try { void reader?.cancel().catch(() => {}); } catch { /* Never await an uncooperative producer. */ } };
  signal.addEventListener("abort", cancelReader, { once: true });
  try {
    await check();
    cleanupRequired = true; // A timed-out INSERT may still have committed.
    await operation("metadata", current => options.beginAttempt(attempt, current));
    await check();
    reader = options.source(signal).getReader();
    const totalHash = createHash("sha256");
    const metadata = new ArchiveManifestPages(attempt, page => mutation(current => options.appendPage(attempt, page, current)));
    let buffer = new Uint8Array(ARCHIVE_SEGMENT_BYTES), filled = 0;
    let sizeBytes = 0, segmentCount = 0;
    async function flushSegment() {
      if (!filled) return;
      const bytes = buffer.subarray(0, filled);
      const segment: ArchiveSegment = Object.freeze({ ...archiveSegmentCoordinates(segmentCount, filled),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        objectKey: `${attempt.principalHash}/${attempt.exportId}/${attempt.attemptId}-${segmentCount}.part` });
      await mutation(current => options.reserve(attempt, segment, current));
      await check();
      const ack = await operation("storage", current => options.write(attempt, segment, bytes, current));
      if (!exactRecord(ack, "objectId") || typeof ack.objectId !== "string" || !UUID.test(ack.objectId)) fail("storage");
      // A trusted writer still cannot alter the bytes behind the recorded hash.
      if (createHash("sha256").update(bytes).digest("hex") !== segment.sha256) fail("storage");
      await check();
      const stored = Object.freeze({ ...segment, objectId: ack.objectId });
      await mutation(current => options.acknowledge(attempt, stored, current));
      await metadata.push(stored); segmentCount += 1;
      buffer = new Uint8Array(ARCHIVE_SEGMENT_BYTES); filled = 0;
    }
    for (;;) {
      await check();
      const next = await operation("invalid_source", () => reader!.read());
      await check();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array) || !next.value.length || next.value.length > ARCHIVE_SEGMENT_BYTES) fail("invalid_source");
      let offset = 0;
      while (offset < next.value.length) {
        const count = Math.min(ARCHIVE_SEGMENT_BYTES - filled, next.value.length - offset);
        if (!Number.isSafeInteger(sizeBytes + count)) fail("invalid_source");
        const part = next.value.subarray(offset, offset + count);
        buffer.set(part, filled); totalHash.update(part);
        filled += count; sizeBytes += count; offset += count;
        if (filled === ARCHIVE_SEGMENT_BYTES) await flushSegment();
      }
    }
    if (!sizeBytes) fail("invalid_source"); // Even an empty ZIP has an end record.
    await flushSegment();
    const manifest = await metadata.finish();
    if (manifest.sizeBytes !== sizeBytes || manifest.segmentCount !== segmentCount) fail("metadata");
    await check(); active();
    const result: StoredArchive = Object.freeze({ state: "bytes-complete", attempt, authorityReceipt, sizeBytes,
      sha256: totalHash.digest("hex"), segmentCount, pageCount: manifest.pageCount, manifestSha256: manifest.manifestSha256 });
    completed = true;
    return result;
  } catch (error) {
    if (error instanceof ArchiveSegmentationError) throw new ArchiveSegmentationError(error.code, cleanupRequired || error.cleanupRequired);
    return fail("invalid_source");
  } finally {
    clearTimeout(deadlineTimer); signal.removeEventListener("abort", cancelReader);
    if (!completed) cancelReader();
    try { reader?.releaseLock(); } catch { /* Pending cancellation remains detached. */ }
    controller.abort();
  }
}
