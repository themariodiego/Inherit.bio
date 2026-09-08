import "server-only";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { decodeCanonicalBlock, canonicalBlockDescriptorSchema, type CanonicalBlockDescriptor } from "./canonical-codec";
import { CANONICAL_RUN_MAX_RECEIPT_BYTES, canonicalRecordOrderKey, compareCanonicalRecords,
  emptyCanonicalCounts, countCanonicalRecord, type CanonicalRecordCounts, type CanonicalOrderKey,
  type CanonicalRunReceipt } from "./canonical-runs";
import { canonicalBindingSchema, type CanonicalBinding, type CanonicalRecord } from "./canonical-schema";

export const CANONICAL_MERGE_MAX_INPUTS = 8;
export const CANONICAL_MERGE_MAX_BLOCKS_PER_RUN = 32_000;
const integer = z.number().int().nonnegative().safe();
const runSchema = z.object({ version: z.literal("canonical-run-v1"), state: z.literal("provisional"),
  binding: canonicalBindingSchema, sequence: integer,
  recordCount: integer.positive(),
  blocks: z.array(canonicalBlockDescriptorSchema).min(1).max(CANONICAL_MERGE_MAX_BLOCKS_PER_RUN),
}).strict();
export type CanonicalMergeSummary = {
  type: "canonical-merge-summary"; version: "canonical-merge-summary-v1"; state: "provisional";
  binding: CanonicalBinding; inputRunSequences: number[]; inputBlockCount: number;
  recordCount: number; counts: CanonicalRecordCounts;
};
export class CanonicalMergeError extends Error {
  constructor(readonly code: "invalid_receipt" | "out_of_order" | "count_mismatch" | "too_large" | "aborted") {
    super(code); this.name = "CanonicalMergeError";
  }
}
type Key = CanonicalOrderKey;
const key = canonicalRecordOrderKey;
function compare(a: Key, b: Key) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw new CanonicalMergeError("aborted"); }
async function abortable<T>(started: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    void started.catch(() => {}); throw new CanonicalMergeError("aborted");
  }
  if (!signal) return started;
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new CanonicalMergeError("aborted"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([started, cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}
function checkedRuns(input: readonly CanonicalRunReceipt[], binding: CanonicalBinding) {
  if (!Array.isArray(input) || input.length < 1 || input.length > CANONICAL_MERGE_MAX_INPUTS) {
    throw new CanonicalMergeError("invalid_receipt");
  }
  const sequences = new Set<number>(), blocks = new Set<number>(), hashes = new Set<string>();
  const runs = input.map(raw => {
    if (!Array.isArray(raw?.blocks) || raw.blocks.length < 1 || raw.blocks.length > CANONICAL_MERGE_MAX_BLOCKS_PER_RUN) {
      throw new CanonicalMergeError("invalid_receipt");
    }
    const parsed = runSchema.safeParse(raw);
    if (!parsed.success) throw new CanonicalMergeError("invalid_receipt");
    const run = parsed.data;
    if (Buffer.byteLength(JSON.stringify(run)) > CANONICAL_RUN_MAX_RECEIPT_BYTES
      || !isDeepStrictEqual(run.binding, binding) || sequences.has(run.sequence)) throw new CanonicalMergeError("invalid_receipt");
    sequences.add(run.sequence);
    let count = 0;
    for (let i = 0; i < run.blocks.length; i++) {
      const block = run.blocks[i];
      if (!isDeepStrictEqual(block.binding, binding) || blocks.has(block.sequence) || hashes.has(block.compressedSha256)
        || (i > 0 && block.sequence !== run.blocks[i - 1].sequence + 1)) throw new CanonicalMergeError("invalid_receipt");
      count += block.recordCount; blocks.add(block.sequence); hashes.add(block.compressedSha256);
    }
    if (!Number.isSafeInteger(count) || count !== run.recordCount) throw new CanonicalMergeError("invalid_receipt");
    return run;
  }).sort((a, b) => a.sequence - b.sequence);
  for (let i = 1; i < runs.length; i++) {
    if (runs[i].blocks[0].sequence <= runs[i - 1].blocks.at(-1)!.sequence) throw new CanonicalMergeError("invalid_receipt");
  }
  return runs;
}

/** Merge at most eight sorted PROVISIONAL runs. Only the terminal merge-summary
 * proves this merge exhausted and verified every input; it is NOT a canonical
 * terminal, original-hash verification, authority check or publication receipt.
 * A later integrity/order failure invalidates all earlier emitted records.
 * Caller owns provisional artifacts and cleanup. Whole-source canonical validity
 * and original hashes must be verified separately before any publication.
 *
 * At most one decoded block per input is held (plus one bounded codec operation
 * and <=8 bounded run receipts). Linear head selection; no all-file record map.
 * Normalized target keys precede source-only keys; exact ties use ascending input
 * run sequence. No records are dropped. A later pass must preserve this summary
 * separately, never disguise it as canonical-summary for the initial writer.
 * No next block is read while downstream is paused at yield. Byte producers
 * must honor signal for their own I/O; actual codec owns/cleans its stream.
 */
export async function* mergeCanonicalRuns(input: readonly CanonicalRunReceipt[], options: {
  binding: CanonicalBinding;
  readBlock: (descriptor: CanonicalBlockDescriptor, signal?: AbortSignal) => AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>;
  signal?: AbortSignal;
}): AsyncGenerator<CanonicalRecord | CanonicalMergeSummary, void, unknown> {
  const { signal, readBlock } = options;
  checkAbort(signal);
  const parsedBinding = canonicalBindingSchema.safeParse(options.binding);
  if (!parsedBinding.success) throw new CanonicalMergeError("invalid_receipt");
  const binding = parsedBinding.data, runs = checkedRuns(input, binding);
  const states = runs.map(run => ({ run, records: [] as CanonicalRecord[], offset: 0, blockOffset: 0,
    recordCount: 0, previous: undefined as Key | undefined }));
  let recordCount = 0, inputBlockCount = 0;
  const counts = emptyCanonicalCounts();

  async function head(state: typeof states[number]): Promise<CanonicalRecord | undefined> {
    if (state.offset < state.records.length) return state.records[state.offset];
    state.records = []; state.offset = 0; // Release the old block before loading another.
    if (state.blockOffset === state.run.blocks.length) {
      if (state.recordCount !== state.run.recordCount) throw new CanonicalMergeError("count_mismatch");
      return undefined;
    }
    checkAbort(signal);
    const descriptor = state.run.blocks[state.blockOffset];
    const bytes = await abortable(Promise.resolve(readBlock(structuredClone(descriptor), signal)), signal);
    checkAbort(signal);
    const block = await abortable(decodeCanonicalBlock(bytes, descriptor, { signal }), signal);
    checkAbort(signal);
    for (const event of block.records) {
      const current = key(event);
      if (state.previous && compare(state.previous, current) > 0) throw new CanonicalMergeError("out_of_order");
      state.previous = current;
    }
    state.recordCount += block.records.length;
    if (state.recordCount > state.run.recordCount) throw new CanonicalMergeError("count_mismatch");
    state.blockOffset++; inputBlockCount++;
    state.records = block.records;
    return state.records[0];
  }

  while (true) {
    checkAbort(signal);
    let selected: typeof states[number] | undefined;
    let selectedEvent: CanonicalRecord | undefined;
    for (const state of states) {
      const event = await head(state);
      if (event && (!selectedEvent || compareCanonicalRecords(event, selectedEvent) < 0)) {
        selected = state; selectedEvent = event;
      }
    }
    if (!selected || !selectedEvent) break;
    selected.offset++; recordCount++; countCanonicalRecord(counts, selectedEvent);
    if (!Number.isSafeInteger(recordCount)) throw new CanonicalMergeError("too_large");
    yield selectedEvent;
  }
  checkAbort(signal);
  if (recordCount !== runs.reduce((n, run) => n + run.recordCount, 0)
    || inputBlockCount !== runs.reduce((n, run) => n + run.blocks.length, 0)) throw new CanonicalMergeError("count_mismatch");
  yield { type: "canonical-merge-summary", version: "canonical-merge-summary-v1", state: "provisional", binding,
    inputRunSequences: runs.map(run => run.sequence), inputBlockCount, recordCount,
    counts };
}
