import "server-only";
import { z } from "zod";
import {
  ARCHIVE_OPERATION_TIMEOUT_MS, ARCHIVE_METADATA_PAGE_SEGMENTS, ARCHIVE_SEGMENT_BYTES,
  validateArchiveSegment, type ArchiveAttempt, type ArchiveSegment,
  type ArchiveMetadataPage, type StoredArchiveSegment, type StoredArchive,
} from "./archive-segments";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.number().int().nonnegative().safe();
const timestamp = z.string().datetime({ offset: true }).transform(value => Date.parse(value));
const jobSchema = z.object({ exportId: uuid, principalHash: hash, authorityReceipt: hash, deadline: timestamp }).strict();
const attemptSchema = z.object({ version: z.literal("archive-segments-v1"), exportId: uuid,
  principalHash: hash, attemptId: uuid, bucket: z.literal("exports") }).strict();
const preflightSchema = z.object({ authorityReceipt: hash, principalHash: hash, deadline: timestamp }).strict();
const beginSchema = z.object({ attemptId: uuid, principalHash: hash, leaseExpiresAt: timestamp }).strict();
const checkSchema = z.object({ authorityReceipt: hash, leaseExpiresAt: timestamp }).strict();
const segmentReplySchema = z.object({ ordinal: integer, authorityReceipt: hash }).strict();
const pageReplySchema = z.object({ page: integer, authorityReceipt: hash }).strict();
const completionSchema = z.object({ state: z.literal("bytes-complete"), authorityReceipt: hash,
  sizeBytes: integer.positive(), segmentCount: integer.positive(), pageCount: integer.positive() }).strict();
const summarySchema = completionSchema.extend({ attempt: attemptSchema, sha256: hash, manifestSha256: hash }).strict();

type WorkerOperation = "preflight" | "begin" | "renew" | "reserve" | "acknowledge" | "page" | "bytes-complete";
type WorkerArgs = { p_operation: WorkerOperation; p_export_id: string; p_attempt_id: string;
  p_authority_receipt: string; p_payload: Record<string, unknown> | null };
/** Compatible with the installed service client's bound rpc method. The
 * explicit POST and disabled retries preserve uncertain mutation outcomes. */
export type ArchiveWorkerRpc = (name: "export_archive_worker_v1", args: WorkerArgs,
  options: { get: false; head: false }) => {
    retry(enabled: false): { abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }> };
  };
type ErrorCode = "invalid_input" | "unavailable" | "aborted" | "deadline";
export class ArchivePersistenceError extends Error {
  constructor(readonly code: ErrorCode, readonly cleanupRequired: boolean) {
    super(code); this.name = "ArchivePersistenceError";
  }
}

/** Bridge for one discovered DB job and one fresh core attempt. Discovery is
 * never authority: preflight/begin and every later SQL operation recompute the
 * stored origin's current graph. This bridge selects no content and cannot mark
 * an archive ready. Its SQL migration still needs real database verification.
 */
export function createArchivePersistence(discoveredJob: unknown, rpc: ArchiveWorkerRpc) {
  const parsed = jobSchema.safeParse(discoveredJob);
  if (!parsed.success || typeof rpc !== "function" || !Number.isSafeInteger(parsed.data.deadline)
    || parsed.data.deadline <= Date.now() || parsed.data.deadline > Date.now() + 86_400_000)
    throw new ArchivePersistenceError("invalid_input", false);
  const job = Object.freeze(parsed.data);
  let attempt: ArchiveAttempt | undefined, begun = false, busy = false, closed = false;
  let cleanupRequired = false, leaseDeadline = job.deadline;
  const stopped = new AbortController();
  function fail(code: ErrorCode): never {
    closed = true; stopped.abort(); throw new ArchivePersistenceError(code, cleanupRequired);
  }
  function identity(value: ArchiveAttempt) {
    const selected = attemptSchema.safeParse(value);
    if (!selected.success || selected.data.exportId !== job.exportId || selected.data.principalHash !== job.principalHash
      || (attempt && selected.data.attemptId !== attempt.attemptId)) fail("invalid_input");
    attempt ??= Object.freeze(selected.data);
    return attempt;
  }
  async function exclusive<T>(value: ArchiveAttempt, signal: AbortSignal, work: (current: ArchiveAttempt) => Promise<T>) {
    if (closed || busy) return fail("unavailable");
    if (!(signal instanceof AbortSignal)) return fail("invalid_input");
    if (signal.aborted) return fail("aborted");
    if (Date.now() >= Math.min(job.deadline, leaseDeadline)) return fail("deadline");
    busy = true;
    try { return await work(identity(value)); }
    catch (error) {
      if (error instanceof ArchivePersistenceError) {
        cleanupRequired ||= error.cleanupRequired;
        return fail(error.code);
      }
      return fail("unavailable");
    } finally { busy = false; }
  }
  async function call<T>(operation: WorkerOperation, current: ArchiveAttempt, payload: Record<string, unknown> | null,
    signal: AbortSignal, schema: z.ZodType<T>): Promise<T> {
    const deadline = Math.min(job.deadline, leaseDeadline, Date.now() + ARCHIVE_OPERATION_TIMEOUT_MS);
    const timeout = new AbortController();
    const combined = AbortSignal.any([signal, stopped.signal, timeout.signal]);
    const timer = setTimeout(() => timeout.abort(), Math.max(0, deadline - Date.now()));
    timer.unref();
    let interrupt = () => {};
    const interrupted = new Promise<never>((_, reject) => {
      interrupt = () => reject(new ArchivePersistenceError(
        Date.now() >= deadline || timeout.signal.aborted ? "deadline" : "aborted", cleanupRequired));
      combined.addEventListener("abort", interrupt, { once: true });
    });
    void interrupted.catch(() => {});
    const active = () => {
      if (Date.now() >= deadline || timeout.signal.aborted) fail("deadline");
      if (combined.aborted || closed) fail("aborted");
    };
    try {
      active();
      const pending = Promise.resolve().then(() => {
        active();
        return rpc("export_archive_worker_v1", { p_operation: operation, p_export_id: job.exportId,
          p_attempt_id: current.attemptId, p_authority_receipt: job.authorityReceipt, p_payload: payload },
        { get: false, head: false }).retry(false).abortSignal(combined);
      });
      const response = await Promise.race([pending, interrupted]);
      active();
      if (!response || response.error !== null) fail("unavailable");
      const result = schema.safeParse(response.data);
      if (!result.success) fail("unavailable");
      return result.data;
    } catch (error) {
      closed = true; stopped.abort();
      if (error instanceof ArchivePersistenceError) {
        cleanupRequired ||= error.cleanupRequired;
        throw new ArchivePersistenceError(error.code, cleanupRequired);
      }
      throw new ArchivePersistenceError("unavailable", cleanupRequired);
    } finally {
      clearTimeout(timer); combined.removeEventListener("abort", interrupt); timeout.abort();
    }
  }
  function receipt(value: string) {
    if (value !== job.authorityReceipt) fail("unavailable");
  }
  function lease(value: number) {
    const now = Date.now();
    if (!Number.isSafeInteger(value) || value <= now || value > Math.min(job.deadline, now + 300_000)) fail("unavailable");
    leaseDeadline = value;
  }
  async function renew(current: ArchiveAttempt, signal: AbortSignal) {
    const result = await call("renew", current, null, signal, checkSchema);
    receipt(result.authorityReceipt); lease(result.leaseExpiresAt);
    return result.authorityReceipt;
  }
  function writing() { if (!begun) fail("unavailable"); }
  return Object.freeze({
    job,
    checkAuthority: (value: ArchiveAttempt, signal: AbortSignal) => exclusive(value, signal, async current => {
      if (begun) return renew(current, signal);
      const result = await call("preflight", current, null, signal, preflightSchema);
      receipt(result.authorityReceipt);
      if (result.principalHash !== job.principalHash || result.deadline !== job.deadline) fail("unavailable");
      return result.authorityReceipt;
    }),
    beginAttempt: (value: ArchiveAttempt, signal: AbortSignal) => exclusive(value, signal, async current => {
      if (begun) fail("unavailable");
      // The POST may commit even if no response is observed. Never retry it.
      cleanupRequired = true;
      const result = await call("begin", current, null, signal, beginSchema);
      if (result.attemptId !== current.attemptId || result.principalHash !== job.principalHash) fail("unavailable");
      lease(result.leaseExpiresAt); begun = true;
    }),
    reserve: (value: ArchiveAttempt, segment: ArchiveSegment, signal: AbortSignal) => exclusive(value, signal, async current => {
      writing(); validateArchiveSegment(current, segment);
      const selected = Object.freeze({ ...segment });
      const result = await call("reserve", current, selected, signal, segmentReplySchema);
      receipt(result.authorityReceipt); if (result.ordinal !== selected.ordinal) fail("unavailable");
    }),
    acknowledge: (value: ArchiveAttempt, segment: StoredArchiveSegment, signal: AbortSignal) => exclusive(value, signal, async current => {
      writing(); validateArchiveSegment(current, segment, true);
      const selected = Object.freeze({ ...segment });
      const result = await call("acknowledge", current, selected, signal, segmentReplySchema);
      receipt(result.authorityReceipt); if (result.ordinal !== selected.ordinal) fail("unavailable");
    }),
    appendPage: (value: ArchiveAttempt, page: ArchiveMetadataPage, signal: AbortSignal) => exclusive(value, signal, async current => {
      writing();
      if (!page || Object.keys(page).sort().join(",") !== "page,segments" || !Number.isSafeInteger(page.page)
        || page.page < 0 || !Array.isArray(page.segments) || page.segments.length < 1
        || page.segments.length > ARCHIVE_METADATA_PAGE_SEGMENTS) fail("invalid_input");
      const pageNumber = page.page;
      const selected = page.segments.map((segment, index) => {
        validateArchiveSegment(current, segment, true);
        if (segment.ordinal !== pageNumber * ARCHIVE_METADATA_PAGE_SEGMENTS + index) fail("invalid_input");
        return Object.freeze({ ...segment });
      });
      const result = await call("page", current, Object.freeze({ page: pageNumber, segments: Object.freeze(selected) }), signal, pageReplySchema);
      receipt(result.authorityReceipt); if (result.page !== pageNumber) fail("unavailable");
    }),
    recordBytesComplete: (summary: StoredArchive, signal: AbortSignal) => exclusive(summary?.attempt, signal, async current => {
      writing();
      const parsedSummary = summarySchema.safeParse(summary);
      if (!parsedSummary.success) fail("invalid_input");
      const selected = parsedSummary.data;
      receipt(selected.authorityReceipt);
      if (selected.segmentCount !== Math.ceil(selected.sizeBytes / ARCHIVE_SEGMENT_BYTES)
        || selected.pageCount !== Math.ceil(selected.segmentCount / ARCHIVE_METADATA_PAGE_SEGMENTS)) fail("invalid_input");
      await renew(current, signal);
      const payload = { sizeBytes: selected.sizeBytes, segmentCount: selected.segmentCount,
        pageCount: selected.pageCount, sha256: selected.sha256, manifestSha256: selected.manifestSha256 };
      const result = await call("bytes-complete", current, payload, signal, completionSchema);
      receipt(result.authorityReceipt);
      if (result.sizeBytes !== selected.sizeBytes || result.segmentCount !== selected.segmentCount
        || result.pageCount !== selected.pageCount) fail("unavailable");
      closed = true; stopped.abort();
      return Object.freeze(result);
    }),
  });
}
