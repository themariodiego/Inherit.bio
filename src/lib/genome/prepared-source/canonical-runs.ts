import "server-only";
import { isDeepStrictEqual } from "node:util";
import { encodeCanonicalBlock, CanonicalBlockError, canonicalBlockDescriptorSchema, type CanonicalBlockDescriptor } from "./canonical-codec";
import { canonicalBindingSchema, canonicalRecordSchema, canonicalSummarySchema,
  type CanonicalBinding, type CanonicalRecord, type CanonicalSummary } from "./canonical-schema";
import { PREPARED_BLOCK_MAX_EVENTS } from "./schema";

export const CANONICAL_RUN_MAX_RECORDS = 32_000;
export const CANONICAL_RUN_MAX_RECORD_BYTES = 8_388_608;
export const CANONICAL_RUN_MAX_RECEIPT_BYTES = 4_000_000;
export type CanonicalRunReceipt = {
  version: "canonical-run-v1"; state: "provisional"; binding: CanonicalBinding; sequence: number; recordCount: number;
  blocks: CanonicalBlockDescriptor[];
};
export type CanonicalRunSink = {
  writeBlock(block: { runSequence: number; descriptor: CanonicalBlockDescriptor; compressed: Uint8Array },
    signal?: AbortSignal): Promise<unknown>;
  writeRun(receipt: CanonicalRunReceipt, signal?: AbortSignal): Promise<unknown>;
};
export class CanonicalRunError extends Error {
  constructor(readonly code: "invalid_event" | "invalid_summary" | "too_large" | "ack_mismatch" | "aborted") {
    super(code); this.name = "CanonicalRunError";
  }
}
const rank = { observed: 0, reference: 1, variant: 2 } as const;
export type CanonicalOrderKey = [number, number, number, number, number, number, number];
export function canonicalRecordOrderKey(record: CanonicalRecord): CanonicalOrderKey {
  const source = record.event.type === "variant" ? record.event.record : record.event.call;
  const normalized = record.normalization.status === "normalized" ? record.normalization.record : null;
  return [normalized ? 0 : 1, normalized?.chrom ?? 0, normalized?.pos ?? 0,
    source.chrom, source.pos, record.event.line, rank[record.event.type]];
}
export function compareCanonicalRecords(a: CanonicalRecord, b: CanonicalRecord) {
  const x = a.normalization.status === "normalized" ? a.normalization.record : null;
  const y = b.normalization.status === "normalized" ? b.normalization.record : null;
  if (Boolean(x) !== Boolean(y)) return x ? -1 : 1;
  if (x && y && (x.chrom !== y.chrom || x.pos !== y.pos)) return x.chrom - y.chrom || x.pos - y.pos;
  const sa = a.event.type === "variant" ? a.event.record : a.event.call;
  const sb = b.event.type === "variant" ? b.event.record : b.event.call;
  return sa.chrom - sb.chrom || sa.pos - sb.pos || a.event.line - b.event.line || rank[a.event.type] - rank[b.event.type];
}
export function emptyCanonicalCounts() {
  return { sourceVariantCount: 0, sourceObservedCount: 0, sourceReferenceCount: 0,
    normalizedVariantCount: 0, normalizedObservedCount: 0, usableObservedCount: 0,
    duplicateCount: 0, unmappedCount: 0, unsupportedAlleleCount: 0 };
}
export type CanonicalRecordCounts = ReturnType<typeof emptyCanonicalCounts>;
export function countCanonicalRecord(counts: CanonicalRecordCounts, record: CanonicalRecord) {
  const event = record.event, normalization = record.normalization;
  if (event.type === "variant") counts.sourceVariantCount++;
  else if (event.type === "observed") counts.sourceObservedCount++;
  else counts.sourceReferenceCount++;
  if (normalization.status === "normalized") {
    if (event.type === "variant") counts.normalizedVariantCount++;
    else if (event.type === "observed") { counts.normalizedObservedCount++; if (event.call.usable) counts.usableObservedCount++; }
  } else if (normalization.status === "duplicate") counts.duplicateCount++;
  else if (normalization.status === "unmapped") counts.unmappedCount++;
  else if (normalization.status === "unsupported_alleles") counts.unsupportedAlleleCount++;
}
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw new CanonicalRunError("aborted"); }
async function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    // The caller already started this operation while evaluating the argument.
    // Observe its rejection even when it synchronously cancelled our signal.
    void promise.catch(() => {});
    throw new CanonicalRunError("aborted");
  }
  if (!signal) return promise;
  let abort: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(new CanonicalRunError("aborted"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([promise, interrupted]); }
  finally { signal.removeEventListener("abort", abort); }
}

/** Initial canonical runs, all PROVISIONAL. Sort normalized records by target
 * chromosome/position then original chromosome/position/line/event rank; retain
 * source-only records afterward in original key order. Exact ties are stable.
 * No deduplication or interpretation. The actual canonical terminal, logical
 * counts, exact binding and EOF are mandatory for the aggregate receipt.
 * Earlier sink artifacts remain provisional and caller-owned on any failure.
 *
 * Holds <=32,000 records / 8MiB conservative expanded JSON, one codec operation
 * and <=32,000 block descriptors (receipt <=4MB), never the whole source. Byte
 * flushing may hold one additional bounded input record. Callbacks are awaited.
 * writeBlock ACK may accept a buffered container; writeRun MUST flush it and
 * return only after durable exact block receipts. Neither ACK grants authority.
 * This initial writer never accepts a merge summary as a canonical terminal.
 */
export async function createCanonicalRuns(records: AsyncIterable<CanonicalRecord | CanonicalSummary>, options: {
  binding: CanonicalBinding; sink: CanonicalRunSink; signal?: AbortSignal;
}) {
  const binding = canonicalBindingSchema.parse(options.binding);
  const { sink, signal } = options;
  checkAbort(signal);
  let buffer: CanonicalRecord[] = [], bufferedBytes = 0, runCount = 0, recordCount = 0, blockSequence = 0;
  let summary: CanonicalSummary | undefined;
  const counts = emptyCanonicalCounts();
  const iterator = records[Symbol.asyncIterator]();
  let exhausted = false;

  async function flush() {
    if (!buffer.length) return;
    checkAbort(signal);
    buffer.sort(compareCanonicalRecords); // Stable sort retains original order for exact ties.
    const blocks: CanonicalBlockDescriptor[] = [];
    async function emit(chunk: CanonicalRecord[]): Promise<void> {
      checkAbort(signal);
      let block: Awaited<ReturnType<typeof encodeCanonicalBlock>>;
      try { block = await awaitWithAbort(encodeCanonicalBlock({ binding, sequence: blockSequence, records: chunk }, { signal }), signal); }
      catch (error) {
        if (error instanceof CanonicalBlockError && error.code === "too_large" && chunk.length > 1) {
          const middle = Math.floor(chunk.length / 2);
          await emit(chunk.slice(0, middle)); await emit(chunk.slice(middle)); return;
        }
        throw error;
      }
      checkAbort(signal);
      const expected = structuredClone(block.descriptor);
      const ack = await awaitWithAbort(sink.writeBlock({ runSequence: runCount, ...block }, signal), signal);
      checkAbort(signal);
      const parsed = canonicalBlockDescriptorSchema.safeParse(ack);
      if (!parsed.success || !isDeepStrictEqual(parsed.data, expected)) throw new CanonicalRunError("ack_mismatch");
      blocks.push(expected);
      blockSequence++;
      if (!Number.isSafeInteger(blockSequence)) throw new CanonicalRunError("too_large");
    }
    for (let offset = 0; offset < buffer.length; offset += PREPARED_BLOCK_MAX_EVENTS) {
      await emit(buffer.slice(offset, offset + PREPARED_BLOCK_MAX_EVENTS));
    }
    const receipt: CanonicalRunReceipt = { version: "canonical-run-v1", state: "provisional", binding: structuredClone(binding),
      sequence: runCount, recordCount: buffer.length, blocks };
    if (Buffer.byteLength(JSON.stringify(receipt)) > CANONICAL_RUN_MAX_RECEIPT_BYTES) throw new CanonicalRunError("too_large");
    const ack = await awaitWithAbort(sink.writeRun(structuredClone(receipt), signal), signal);
    checkAbort(signal);
    if (!isDeepStrictEqual(ack, receipt)) throw new CanonicalRunError("ack_mismatch");
    runCount++; buffer = []; bufferedBytes = 0;
  }

  try {
    while (true) {
      checkAbort(signal);
      const next = await awaitWithAbort(iterator.next(), signal);
      checkAbort(signal);
      if (next.done) { exhausted = true; break; }
      if (summary) throw new CanonicalRunError("invalid_summary");
      const raw = next.value;
      if (raw?.type === "canonical-summary") {
        if (!Array.isArray(raw.mergeSummary?.inputRunSequences) || raw.mergeSummary.inputRunSequences.length > 8) {
          throw new CanonicalRunError("invalid_summary");
        }
        const parsed = canonicalSummarySchema.safeParse(raw);
        if (!parsed.success || !isDeepStrictEqual(parsed.data.binding, binding)
          || parsed.data.eventCount !== recordCount
          || parsed.data.variantCount !== counts.normalizedVariantCount
          || parsed.data.observedCallCount !== counts.normalizedObservedCount
          || parsed.data.usableObservedCount !== counts.usableObservedCount
          || parsed.data.mergeSummary.variantCount !== counts.sourceVariantCount
          || parsed.data.mergeSummary.observedCallCount !== counts.sourceObservedCount
          || parsed.data.mergeSummary.referenceCallCount !== counts.sourceReferenceCount) throw new CanonicalRunError("invalid_summary");
        summary = parsed.data;
        continue; // Verify actual EOF before acknowledging the last run/final receipt.
      }
      const parsed = canonicalRecordSchema.safeParse(raw);
      if (!parsed.success) throw new CanonicalRunError("invalid_event");
      const event = parsed.data;
      let stringBytes = 0;
      const original = event.event.type === "variant" ? event.event.record : event.event.call;
      for (const fields of [original, event.normalization.status === "normalized" ? event.normalization.record : {}]) {
        for (const value of Object.values(fields)) if (typeof value === "string") {
          stringBytes += Buffer.byteLength(value);
          if (stringBytes > CANONICAL_RUN_MAX_RECORD_BYTES) throw new CanonicalRunError("too_large");
        }
      }
      const bytes = Buffer.byteLength(JSON.stringify(event));
      if (bytes > CANONICAL_RUN_MAX_RECORD_BYTES) throw new CanonicalRunError("too_large");
      if (buffer.length && bufferedBytes + bytes > CANONICAL_RUN_MAX_RECORD_BYTES) await flush();
      buffer.push(event); bufferedBytes += bytes; countCanonicalRecord(counts, event); recordCount++;
      if (!Number.isSafeInteger(recordCount)) throw new CanonicalRunError("too_large");
      if (buffer.length === CANONICAL_RUN_MAX_RECORDS) await flush();
    }
    if (!summary) throw new CanonicalRunError("invalid_summary");
    await flush(); checkAbort(signal);
    return { version: "canonical-runs-v1" as const, state: "provisional" as const, binding, canonicalSummary: summary, counts, runCount, recordCount, blockCount: blockSequence };
  } finally {
    if (!exhausted && iterator.return) {
      // A producer awaiting non-abortable I/O cannot hold our cancellation open.
      try {
        const closing = Promise.resolve(iterator.return());
        if (signal?.aborted) void closing.catch(() => {});
        else await awaitWithAbort(closing, signal);
      } catch { /* Best-effort close must not replace the original failure. */ }
    }
  }
}
