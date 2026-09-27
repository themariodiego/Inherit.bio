import "server-only";
import { createHash } from "node:crypto";
import {
  ARCHIVE_OPERATION_TIMEOUT_MS,
  validateArchiveSegment,
  type ArchiveAttempt,
  type StoredArchiveSegment,
} from "./archive-segments";

export type ArchiveSegmentObject = Readonly<{
  objectId: string;
  objectKey: string;
  sizeBytes: number;
  body: ReadableStream<Uint8Array>;
}>;
export type ArchiveSegmentReadOptions = Readonly<{
  /** These are DB-authorized snapshots, never client-supplied capabilities. */
  attempt: ArchiveAttempt;
  segment: StoredArchiveSegment;
  /** Pinned receipt from the authorized completed export, never a client token. */
  authorityReceipt: string;
  deadline: number;
  signal: AbortSignal;
  /** Must authorize this exact ready attempt, object and current viewer/session,
   * subject, grants and source revisions. Return the same authoritative receipt
   * on rechecks; a receipt is not a substitute for the live database check. */
  checkAuthority: (
    attempt: ArchiveAttempt, segment: StoredArchiveSegment, expectedReceipt: string, signal: AbortSignal,
  ) => Promise<string>;
  /** One exact immutable whole-object read. This interface accepts no URL,
   * signed URL or range. The future transport adapter must independently refuse
   * redirects and bind provider object identity; this pure core is not a wire proof. */
  readObject: (attempt: ArchiveAttempt, segment: StoredArchiveSegment, signal: AbortSignal) => Promise<ArchiveSegmentObject>;
}>;

type FailureCode = "invalid_input" | "authority" | "storage" | "integrity" | "aborted" | "deadline";
export class ArchiveSegmentReadError extends Error {
  constructor(readonly code: FailureCode) { super(code); this.name = "ArchiveSegmentReadError"; }
}
const fail = (code: FailureCode): never => { throw new ArchiveSegmentReadError(code); };
function closedRecord(value: unknown, keys?: string) {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const own = Reflect.ownKeys(value);
  return own.every(key => typeof key === "string") && (keys === undefined || own.sort().join(",") === keys)
    && Object.values(Object.getOwnPropertyDescriptors(value)).every(field => field.enumerable && "value" in field);
}

/** Returns at most one verified physical segment, never a streaming response.
 * No byte reaches the caller before EOF, live authority, length and SHA checks.
 * Hooks are trusted server adapters, not proof of a deployed authorization DB.
 * Cancellation is best effort and is never awaited: a hostile cancel hook or a
 * provider ignoring AbortSignal must not extend the deadline or release bytes. */
export async function readArchiveSegment(options: ArchiveSegmentReadOptions): Promise<Uint8Array> {
  let attempt: ArchiveAttempt, segment: StoredArchiveSegment;
  const started = Date.now();
  try {
    if (!closedRecord(options, "attempt,authorityReceipt,checkAuthority,deadline,readObject,segment,signal")
      || !closedRecord(options.attempt) || !closedRecord(options.segment)
      || typeof options.authorityReceipt !== "string" || !/^[a-f0-9]{64}$/.test(options.authorityReceipt)
      || !Number.isSafeInteger(options.deadline) || options.deadline <= started
      || !(options.signal instanceof AbortSignal) || typeof options.checkAuthority !== "function"
      || typeof options.readObject !== "function") fail("invalid_input");
    validateArchiveSegment(options.attempt, options.segment, true);
    attempt = Object.freeze({ ...options.attempt });
    segment = Object.freeze({ ...options.segment });
    validateArchiveSegment(attempt, segment, true);
  } catch { return fail("invalid_input"); }
  const { checkAuthority, readObject, signal: callerSignal, authorityReceipt } = options;
  const deadline = Math.min(options.deadline, started + ARCHIVE_OPERATION_TIMEOUT_MS);
  const controller = new AbortController();
  const signal = controller.signal;
  let timedOut = false, closed = false, completed = false;
  let body: ReadableStream<Uint8Array> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let bytes: Uint8Array | undefined;
  const cancel = () => {
    try { void (reader ? reader.cancel() : body?.cancel())?.catch(() => {}); }
    catch { /* Cancellation cannot establish provider erasure or completion. */ }
  };
  const abort = () => { controller.abort(); cancel(); };
  const timer = setTimeout(() => { timedOut = true; abort(); }, Math.max(0, deadline - Date.now()));
  timer.unref();
  callerSignal.addEventListener("abort", abort, { once: true });
  let rejectAbort = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new ArchiveSegmentReadError(timedOut || Date.now() >= deadline ? "deadline" : "aborted"));
    signal.addEventListener("abort", rejectAbort, { once: true });
  });
  void interrupted.catch(() => {});
  function active() {
    if (timedOut || Date.now() >= deadline) fail("deadline");
    if (callerSignal.aborted || signal.aborted || closed) fail("aborted");
  }
  async function operation<T>(code: "authority" | "storage", work: () => Promise<T>): Promise<T> {
    active();
    try {
      const pending = Promise.resolve().then(() => { active(); return work(); });
      const value = await Promise.race([pending, interrupted]);
      active(); return value;
    } catch { active(); return fail(code); }
  }
  async function authority(expected: string) {
    const receipt = await operation("authority", () => checkAuthority(attempt, segment, expected, signal));
    if (typeof receipt !== "string" || !/^[a-f0-9]{64}$/.test(receipt)
      || receipt !== expected) fail("authority");
    return receipt;
  }
  function cancelLate(value: unknown) {
    try {
      const held = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "body")?.value : undefined;
      if (held instanceof ReadableStream) void held.cancel().catch(() => {});
    } catch { /* An untrusted late result cannot extend the closed operation. */ }
  }
  try {
    if (callerSignal.aborted) abort();
    active();
    const receipt = await authority(authorityReceipt);
    const object = await operation("storage", () => {
      const pending = readObject(attempt, segment, signal);
      void pending.then(value => { if (closed || signal.aborted) cancelLate(value); }, () => {});
      return pending;
    });
    // Retain the body for cancellation even when its metadata is refused.
    const held = object && typeof object === "object" ? Object.getOwnPropertyDescriptor(object, "body")?.value : undefined;
    if (held instanceof ReadableStream) body = held;
    if (!closedRecord(object, "body,objectId,objectKey,sizeBytes")
      || object.objectId !== segment.objectId || object.objectKey !== segment.objectKey
      || object.sizeBytes !== segment.sizeBytes || !body) return fail("storage");
    await authority(receipt);
    reader = body.getReader();
    bytes = new Uint8Array(segment.sizeBytes);
    let length = 0;
    for (;;) {
      const next = await operation("storage", () => reader!.read());
      if (next.done) break;
      if (!(next.value instanceof Uint8Array) || !next.value.byteLength
        || next.value.byteLength > bytes.byteLength - length) fail("integrity");
      bytes.set(next.value, length); length += next.value.byteLength;
    }
    await authority(receipt);
    if (length !== segment.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== segment.sha256)
      fail("integrity");
    active(); completed = true;
    return bytes;
  } catch (error) {
    if (error instanceof ArchiveSegmentReadError) throw error;
    return fail("storage");
  } finally {
    closed = true; clearTimeout(timer);
    callerSignal.removeEventListener("abort", abort);
    signal.removeEventListener("abort", rejectAbort);
    if (!completed) { controller.abort(); cancel(); bytes?.fill(0); }
    try { reader?.releaseLock(); } catch { /* An aborted read can still be settling. */ }
  }
}
