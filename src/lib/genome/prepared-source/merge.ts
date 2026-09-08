import "server-only";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { decodePreparedBlock } from "./codec";
import { PREPARED_RUN_MAX_RECEIPT_BYTES,
  type PreparedRunReceipt } from "./runs";
import { preparedBlockDescriptorSchema, preparedSourceBindingSchema,
  type PreparedBlockDescriptor, type PreparedEvent, type PreparedSourceBinding } from "./schema";

export const PREPARED_MERGE_MAX_INPUTS = 8;
export const PREPARED_MERGE_MAX_BLOCKS_PER_RUN = 32_000;
const integer = z.number().int().nonnegative().safe();
const runSchema = z.object({ version: z.literal("prepared-run-v1"), state: z.literal("provisional"),
  source: preparedSourceBindingSchema, sequence: integer,
  eventCount: integer.positive(),
  blocks: z.array(preparedBlockDescriptorSchema).min(1).max(PREPARED_MERGE_MAX_BLOCKS_PER_RUN),
}).strict();
export type PreparedMergeSummary = {
  type: "merge-summary"; version: "prepared-merge-v1"; state: "provisional";
  source: PreparedSourceBinding; inputRunSequences: number[]; inputBlockCount: number;
  eventCount: number; variantCount: number; referenceCallCount: number; observedCallCount: number;
};
export class PreparedMergeError extends Error {
  constructor(readonly code: "invalid_receipt" | "out_of_order" | "count_mismatch" | "too_large" | "aborted") {
    super(code); this.name = "PreparedMergeError";
  }
}
const rank = { observed: 0, reference: 1, variant: 2 } as const;
type Key = [number, number, number, number];
function key(event: PreparedEvent): Key {
  const call = event.type === "variant" ? event.record : event.call;
  return [call.chrom, call.pos, event.line, rank[event.type]];
}
function compare(a: Key, b: Key) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw new PreparedMergeError("aborted"); }
async function abortable<T>(started: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    void started.catch(() => {}); throw new PreparedMergeError("aborted");
  }
  if (!signal) return started;
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new PreparedMergeError("aborted"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([started, cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}
function checkedRuns(input: readonly PreparedRunReceipt[], source: PreparedSourceBinding) {
  if (!Array.isArray(input) || input.length < 1 || input.length > PREPARED_MERGE_MAX_INPUTS) {
    throw new PreparedMergeError("invalid_receipt");
  }
  const sequences = new Set<number>(), blocks = new Set<number>(), hashes = new Set<string>();
  const runs = input.map(raw => {
    if (!Array.isArray(raw?.blocks) || raw.blocks.length < 1 || raw.blocks.length > PREPARED_MERGE_MAX_BLOCKS_PER_RUN) {
      throw new PreparedMergeError("invalid_receipt");
    }
    const parsed = runSchema.safeParse(raw);
    if (!parsed.success) throw new PreparedMergeError("invalid_receipt");
    const run = parsed.data;
    if (Buffer.byteLength(JSON.stringify(run)) > PREPARED_RUN_MAX_RECEIPT_BYTES
      || !isDeepStrictEqual(run.source, source) || sequences.has(run.sequence)) throw new PreparedMergeError("invalid_receipt");
    sequences.add(run.sequence);
    let count = 0;
    for (let i = 0; i < run.blocks.length; i++) {
      const block = run.blocks[i];
      if (!isDeepStrictEqual(block.source, source) || blocks.has(block.sequence) || hashes.has(block.compressedSha256)
        || (i > 0 && block.sequence !== run.blocks[i - 1].sequence + 1)) throw new PreparedMergeError("invalid_receipt");
      count += block.eventCount; blocks.add(block.sequence); hashes.add(block.compressedSha256);
    }
    if (count !== run.eventCount) throw new PreparedMergeError("invalid_receipt");
    return run;
  }).sort((a, b) => a.sequence - b.sequence);
  for (let i = 1; i < runs.length; i++) {
    if (runs[i].blocks[0].sequence <= runs[i - 1].blocks.at(-1)!.sequence) throw new PreparedMergeError("invalid_receipt");
  }
  return runs;
}

/** Merge at most eight sorted PROVISIONAL runs. Only the terminal merge-summary
 * proves this merge exhausted and verified every input; it is NOT a parser
 * summary, source-hash verification, authority check or publication receipt.
 * A later integrity/order failure invalidates all earlier emitted events.
 * Caller owns provisional artifacts and cleanup. Whole-source parser validity
 * and original hashes must be verified separately before any publication.
 *
 * At most one decoded block per input is held (plus one bounded codec operation
 * and <=8 bounded run receipts). Linear head selection; no all-file record map.
 * No next block is read while downstream is paused at yield. Byte producers
 * must honor signal for their own I/O; actual codec owns/cleans its stream.
 */
export async function* mergePreparedRuns(input: readonly PreparedRunReceipt[], options: {
  source: PreparedSourceBinding;
  readBlock: (descriptor: PreparedBlockDescriptor, signal?: AbortSignal) => AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>;
  signal?: AbortSignal;
}): AsyncGenerator<PreparedEvent | PreparedMergeSummary, void, unknown> {
  const { signal, readBlock } = options;
  checkAbort(signal);
  const parsedSource = preparedSourceBindingSchema.safeParse(options.source);
  if (!parsedSource.success) throw new PreparedMergeError("invalid_receipt");
  const source = parsedSource.data, runs = checkedRuns(input, source);
  const states = runs.map(run => ({ run, events: [] as PreparedEvent[], offset: 0, blockOffset: 0,
    eventCount: 0, previous: undefined as Key | undefined }));
  let eventCount = 0, inputBlockCount = 0;
  const counts = { variant: 0, reference: 0, observed: 0 };

  async function head(state: typeof states[number]): Promise<PreparedEvent | undefined> {
    if (state.offset < state.events.length) return state.events[state.offset];
    state.events = []; state.offset = 0; // Release the old block before loading another.
    if (state.blockOffset === state.run.blocks.length) {
      if (state.eventCount !== state.run.eventCount) throw new PreparedMergeError("count_mismatch");
      return undefined;
    }
    checkAbort(signal);
    const descriptor = state.run.blocks[state.blockOffset];
    const bytes = await abortable(Promise.resolve(readBlock(structuredClone(descriptor), signal)), signal);
    checkAbort(signal);
    const block = await abortable(decodePreparedBlock(bytes, descriptor, { signal }), signal);
    checkAbort(signal);
    for (const event of block.events) {
      const current = key(event);
      if (state.previous && compare(state.previous, current) > 0) throw new PreparedMergeError("out_of_order");
      state.previous = current;
    }
    state.eventCount += block.events.length;
    if (state.eventCount > state.run.eventCount) throw new PreparedMergeError("count_mismatch");
    state.blockOffset++; inputBlockCount++;
    state.events = block.events;
    return state.events[0];
  }

  while (true) {
    checkAbort(signal);
    let selected: typeof states[number] | undefined;
    let selectedEvent: PreparedEvent | undefined;
    for (const state of states) {
      const event = await head(state);
      if (event && (!selectedEvent || compare(key(event), key(selectedEvent)) < 0)) {
        selected = state; selectedEvent = event;
      }
    }
    if (!selected || !selectedEvent) break;
    selected.offset++; eventCount++; counts[selectedEvent.type]++;
    yield selectedEvent;
  }
  checkAbort(signal);
  if (eventCount !== runs.reduce((n, run) => n + run.eventCount, 0)
    || inputBlockCount !== runs.reduce((n, run) => n + run.blocks.length, 0)) throw new PreparedMergeError("count_mismatch");
  yield { type: "merge-summary", version: "prepared-merge-v1", state: "provisional", source,
    inputRunSequences: runs.map(run => run.sequence), inputBlockCount, eventCount,
    variantCount: counts.variant, referenceCallCount: counts.reference, observedCallCount: counts.observed };
}
