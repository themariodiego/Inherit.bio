import "server-only";
import { isDeepStrictEqual } from "node:util";
import type { VcfParseEvent } from "../parsers/vcf";
import { encodePreparedBlock, PreparedBlockError } from "./codec";
import { preparedBlockDescriptorSchema, preparedEventSchema, preparedParserSummarySchema,
  preparedSourceBindingSchema, PREPARED_BLOCK_MAX_EVENTS, type PreparedBlockDescriptor, type PreparedEvent,
  type PreparedSourceBinding } from "./schema";

export const PREPARED_RUN_MAX_EVENTS = 32_000;
export const PREPARED_RUN_MAX_EVENT_BYTES = 8_388_608;
export const PREPARED_RUN_MAX_RECEIPT_BYTES = 4_000_000;
type Summary = Extract<VcfParseEvent, { type: "summary" }>;
export type PreparedRunReceipt = {
  version: "prepared-run-v1"; state: "provisional"; source: PreparedSourceBinding; sequence: number; eventCount: number;
  blocks: PreparedBlockDescriptor[];
};
export type PreparedRunSink = {
  writeBlock(block: { runSequence: number; descriptor: PreparedBlockDescriptor; compressed: Uint8Array },
    signal?: AbortSignal): Promise<unknown>;
  writeRun(receipt: PreparedRunReceipt, signal?: AbortSignal): Promise<unknown>;
};
export class PreparedRunError extends Error {
  constructor(readonly code: "invalid_event" | "invalid_summary" | "too_large" | "ack_mismatch" | "aborted") {
    super(code); this.name = "PreparedRunError";
  }
}
const rank = { observed: 0, reference: 1, variant: 2 } as const;
function compare(a: PreparedEvent, b: PreparedEvent) {
  const x = a.type === "variant" ? a.record : a.call;
  const y = b.type === "variant" ? b.record : b.call;
  return x.chrom - y.chrom || x.pos - y.pos || a.line - b.line || rank[a.type] - rank[b.type];
}
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw new PreparedRunError("aborted"); }
async function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    // The caller already started this operation while evaluating the argument.
    // Observe its rejection even when it synchronously cancelled our signal.
    void promise.catch(() => {});
    throw new PreparedRunError("aborted");
  }
  if (!signal) return promise;
  let abort: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(new PreparedRunError("aborted"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([promise, interrupted]); }
  finally { signal.removeEventListener("abort", abort); }
}

/** Create sorted, immutable-block runs, all PROVISIONAL. Neither supplied source
 * hashes nor storage durability/authorization are independently verified here.
 * A successful terminal receipt verifies parser counts/build, not publication.
 * Any error leaves acknowledged sink artifacts caller-owned for cleanup.
 * Memory: <=32,000 events / 8MiB event JSON per run, one codec block plus bounded
 * encoding scratch, and <=32,000 descriptors (receipt <=4MB). No whole-file manifest is retained.
 * Sink callbacks are awaited before another input event is pulled. Callers must
 * honor signal in their producer/sink I/O; cancellation cannot undo a remote write.
 */
export async function createPreparedRuns(events: AsyncIterable<VcfParseEvent>, options: {
  source: PreparedSourceBinding; sink: PreparedRunSink; signal?: AbortSignal;
}) {
  const source = preparedSourceBindingSchema.parse(options.source);
  const { sink, signal } = options;
  checkAbort(signal);
  let buffer: PreparedEvent[] = [], bufferedBytes = 0, runCount = 0, eventCount = 0, blockSequence = 0;
  let summary: Summary | undefined;
  const counts = { variant: 0, reference: 0, observed: 0 };
  const iterator = events[Symbol.asyncIterator]();
  let exhausted = false;

  async function flush() {
    if (!buffer.length) return;
    checkAbort(signal);
    buffer.sort(compare); // Stable sort retains original order for exact ties.
    const blocks: PreparedBlockDescriptor[] = [];
    async function emit(chunk: PreparedEvent[]): Promise<void> {
      checkAbort(signal);
      let block: Awaited<ReturnType<typeof encodePreparedBlock>>;
      try { block = await awaitWithAbort(encodePreparedBlock({ source, sequence: blockSequence, events: chunk }), signal); }
      catch (error) {
        if (error instanceof PreparedBlockError && error.code === "too_large" && chunk.length > 1) {
          const middle = Math.floor(chunk.length / 2);
          await emit(chunk.slice(0, middle)); await emit(chunk.slice(middle)); return;
        }
        throw error;
      }
      checkAbort(signal);
      const expected = structuredClone(block.descriptor);
      const ack = await awaitWithAbort(sink.writeBlock({ runSequence: runCount, ...block }, signal), signal);
      checkAbort(signal);
      const parsed = preparedBlockDescriptorSchema.safeParse(ack);
      if (!parsed.success || !isDeepStrictEqual(parsed.data, expected)) throw new PreparedRunError("ack_mismatch");
      blocks.push(expected);
      blockSequence++;
      if (!Number.isSafeInteger(blockSequence)) throw new PreparedRunError("too_large");
    }
    for (let offset = 0; offset < buffer.length; offset += PREPARED_BLOCK_MAX_EVENTS) {
      await emit(buffer.slice(offset, offset + PREPARED_BLOCK_MAX_EVENTS));
    }
    const receipt: PreparedRunReceipt = { version: "prepared-run-v1", state: "provisional", source: structuredClone(source),
      sequence: runCount, eventCount: buffer.length, blocks };
    if (Buffer.byteLength(JSON.stringify(receipt)) > PREPARED_RUN_MAX_RECEIPT_BYTES) throw new PreparedRunError("too_large");
    const ack = await awaitWithAbort(sink.writeRun(structuredClone(receipt), signal), signal);
    checkAbort(signal);
    if (!isDeepStrictEqual(ack, receipt)) throw new PreparedRunError("ack_mismatch");
    runCount++; buffer = []; bufferedBytes = 0;
  }

  try {
    while (true) {
      checkAbort(signal);
      const next = await awaitWithAbort(iterator.next(), signal);
      if (next.done) { exhausted = true; break; }
      if (summary) throw new PreparedRunError("invalid_summary");
      const raw = next.value;
      if (raw?.type === "summary") {
        const parsed = preparedParserSummarySchema.safeParse(raw);
        if (!parsed.success || !parsed.data.observedCallsValid || parsed.data.build !== source.sourceBuild
          || parsed.data.variantCount !== counts.variant || parsed.data.referenceCallCount !== counts.reference
          || parsed.data.observedCallCount !== counts.observed) throw new PreparedRunError("invalid_summary");
        summary = parsed.data;
        continue; // Verify actual EOF before acknowledging the last run/final receipt.
      }
      const parsed = preparedEventSchema.safeParse(raw);
      if (!parsed.success) throw new PreparedRunError("invalid_event");
      const event = parsed.data;
      const bytes = Buffer.byteLength(JSON.stringify(event));
      if (bytes > PREPARED_RUN_MAX_EVENT_BYTES) throw new PreparedRunError("too_large");
      if (buffer.length && bufferedBytes + bytes > PREPARED_RUN_MAX_EVENT_BYTES) await flush();
      buffer.push(event); bufferedBytes += bytes; counts[event.type]++; eventCount++;
      if (!Number.isSafeInteger(eventCount)) throw new PreparedRunError("too_large");
      if (buffer.length === PREPARED_RUN_MAX_EVENTS) await flush();
    }
    if (!summary) throw new PreparedRunError("invalid_summary");
    await flush(); checkAbort(signal);
    return { version: "prepared-runs-v1" as const, state: "provisional" as const, source, summary, runCount, eventCount, blockCount: blockSequence };
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
