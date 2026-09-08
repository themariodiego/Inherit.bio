import "server-only";
import { createHash } from "node:crypto";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isDeepStrictEqual, promisify, TextDecoder } from "node:util";
import { createGunzip, gzip } from "node:zlib";
import { z } from "zod";
import { canonicalBindingSchema, type CanonicalBinding } from "./canonical-schema";
import { canonicalBlockDescriptorSchema, decodeCanonicalBlock, type CanonicalBlockDescriptor } from "./canonical-codec";

export const RSID_RUN_MAX_POINTERS = 32_000;
export const RSID_RUN_MAX_BYTES = 8_388_608;
export const RSID_RECEIPT_MAX_BYTES = 4_000_000;
export const RSID_BLOCK_MAX_POINTERS = 2_000;
export const RSID_BLOCK_MAX_BYTES = 4_000_000;
const MAX_COMPRESSED = RSID_BLOCK_MAX_BYTES + 65_536;
const MAX_RUN_BLOCKS = 32_000;
const VERSION = "canonical-rsid-block-v1" as const;
const integer = z.number().int().nonnegative().safe();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const canonicalRsidPointerSchema = z.object({ rsid: integer, blockSequence: integer,
  recordOffset: integer.max(1_999) }).strict();
export type CanonicalRsidPointer = z.infer<typeof canonicalRsidPointerSchema>;
export const canonicalRsidBlockDescriptorSchema = z.object({ version: z.literal(VERSION), compression: z.literal("gzip"),
  binding: canonicalBindingSchema, sequence: integer, pointerCount: integer.positive().max(RSID_BLOCK_MAX_POINTERS),
  compressedBytes: integer.positive().max(MAX_COMPRESSED), decodedBytes: integer.positive().max(RSID_BLOCK_MAX_BYTES),
  compressedSha256: hash, decodedSha256: hash, first: canonicalRsidPointerSchema, last: canonicalRsidPointerSchema,
}).strict();
export type CanonicalRsidBlockDescriptor = z.infer<typeof canonicalRsidBlockDescriptorSchema>;
const wireSchema = z.object({ version: z.literal(VERSION), state: z.literal("provisional"), binding: canonicalBindingSchema,
  sequence: integer, pointers: z.array(canonicalRsidPointerSchema).min(1).max(RSID_BLOCK_MAX_POINTERS) }).strict();
const runSchema = z.object({ version: z.literal("canonical-rsid-run-v1"), state: z.literal("provisional"),
  binding: canonicalBindingSchema, sequence: integer, pointerCount: integer.positive(),
  blocks: z.array(canonicalRsidBlockDescriptorSchema).min(1).max(MAX_RUN_BLOCKS) }).strict();
export type CanonicalRsidRunReceipt = z.infer<typeof runSchema>;
export type CanonicalRsidMergeSummary = { type: "rsid-merge-summary"; version: "canonical-rsid-merge-v1";
  state: "provisional"; binding: CanonicalBinding; inputRunSequences: number[]; inputBlockCount: number; pointerCount: number };
export class CanonicalRsidIndexError extends Error {
  constructor(readonly code: "invalid_receipt" | "invalid_block" | "integrity_mismatch" | "out_of_order"
    | "too_large" | "ack_mismatch" | "aborted") { super(code); this.name = "CanonicalRsidIndexError"; }
}
function fail(code: CanonicalRsidIndexError["code"]): never { throw new CanonicalRsidIndexError(code); }
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const compress = promisify(gzip);
export const compareCanonicalRsidPointers = (a: CanonicalRsidPointer, b: CanonicalRsidPointer) =>
  a.rsid - b.rsid || a.blockSequence - b.blockSequence || a.recordOffset - b.recordOffset;
function active(signal?: AbortSignal) { if (signal?.aborted) fail("aborted"); }
function add(a: number, b: number) { const total = a + b; if (!Number.isSafeInteger(total)) fail("too_large"); return total; }
async function wait<T>(started: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) { void started.catch(() => {}); fail("aborted"); }
  if (!signal) return started;
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new CanonicalRsidIndexError("aborted")); signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([started, cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}
function sorted(pointers: CanonicalRsidPointer[]) {
  for (let i = 1; i < pointers.length; i++) if (compareCanonicalRsidPointers(pointers[i - 1], pointers[i]) > 0) fail("out_of_order");
}

/** Pointer blocks contain no inferred calls. Bounds enable candidate selection;
 * the actual canonical record, disposition and authority must be checked later. */
export async function encodeCanonicalRsidBlock(input: { binding: CanonicalBinding; sequence: number; pointers: CanonicalRsidPointer[] },
  options: { signal?: AbortSignal } = {}) {
  try {
    active(options.signal);
    if (!Array.isArray(input?.pointers) || input.pointers.length < 1 || input.pointers.length > RSID_BLOCK_MAX_POINTERS) fail("invalid_block");
    const body = wireSchema.parse({ version: VERSION, state: "provisional", ...input }); sorted(body.pointers);
    const decoded = Buffer.from(JSON.stringify(body)); if (decoded.length > RSID_BLOCK_MAX_BYTES) fail("too_large");
    const compressed = await wait(compress(decoded, { level: 6 }), options.signal); active(options.signal);
    if (compressed.length > MAX_COMPRESSED) fail("too_large");
    const descriptor = canonicalRsidBlockDescriptorSchema.parse({ version: VERSION, compression: "gzip", binding: body.binding,
      sequence: body.sequence, pointerCount: body.pointers.length, compressedBytes: compressed.length, decodedBytes: decoded.length,
      compressedSha256: sha(compressed), decodedSha256: sha(decoded), first: body.pointers[0], last: body.pointers.at(-1)! });
    return { descriptor, compressed };
  } catch (error) { if (options.signal?.aborted) fail("aborted"); if (error instanceof CanonicalRsidIndexError) throw error; return fail("invalid_block"); }
}

/** Returns nothing until full compressed EOF, lengths/hashes, fatal UTF-8,
 * closed schema, binding, count, ordering and tuple bounds all verify. */
export async function decodeCanonicalRsidBlock(source: AsyncIterable<Uint8Array>, expected: CanonicalRsidBlockDescriptor,
  options: { signal?: AbortSignal } = {}) {
  let input: Readable | undefined, gunzip: ReturnType<typeof createGunzip> | undefined;
  try {
    active(options.signal); const descriptor = canonicalRsidBlockDescriptorSchema.parse(expected);
    const compressedHash = createHash("sha256"), decodedHash = createHash("sha256");
    let compressedBytes = 0, decodedBytes = 0; const chunks: Buffer[] = [];
    input = Readable.from(source, { objectMode: false, highWaterMark: 16_384 });
    const count = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      compressedBytes += chunk.length;
      if (compressedBytes > descriptor.compressedBytes || compressedBytes > MAX_COMPRESSED) { callback(new CanonicalRsidIndexError("too_large")); return; }
      compressedHash.update(chunk); callback(null, chunk);
    } });
    gunzip = createGunzip({ chunkSize: 16_384 });
    const output = new Writable({ write(chunk: Buffer, _encoding, callback) {
      decodedBytes += chunk.length;
      if (decodedBytes > descriptor.decodedBytes || decodedBytes > RSID_BLOCK_MAX_BYTES) { callback(new CanonicalRsidIndexError("too_large")); return; }
      decodedHash.update(chunk); chunks.push(chunk); callback();
    } });
    await pipeline(input, count, gunzip, output, { signal: options.signal }); active(options.signal);
    if (compressedBytes !== descriptor.compressedBytes || decodedBytes !== descriptor.decodedBytes
      || compressedHash.digest("hex") !== descriptor.compressedSha256 || decodedHash.digest("hex") !== descriptor.decodedSha256) fail("integrity_mismatch");
    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, decodedBytes)));
    if (!Array.isArray(raw?.pointers) || raw.pointers.length < 1 || raw.pointers.length > RSID_BLOCK_MAX_POINTERS) fail("invalid_block");
    const body = wireSchema.parse(raw); sorted(body.pointers);
    if (!isDeepStrictEqual(body.binding, descriptor.binding) || body.sequence !== descriptor.sequence || body.pointers.length !== descriptor.pointerCount
      || !isDeepStrictEqual(body.pointers[0], descriptor.first) || !isDeepStrictEqual(body.pointers.at(-1), descriptor.last)) fail("integrity_mismatch");
    active(options.signal); return body;
  } catch (error) { if (options.signal?.aborted) fail("aborted"); if (error instanceof CanonicalRsidIndexError) throw error; return fail("invalid_block"); }
  finally { input?.destroy(); gunzip?.destroy(); }
}

type Encoded = Awaited<ReturnType<typeof encodeCanonicalRsidBlock>>;
export type CanonicalRsidRunSink = {
  writeBlock(block: Encoded & { runSequence: number }, signal?: AbortSignal): Promise<unknown>;
  writeRun(receipt: CanonicalRsidRunReceipt, signal?: AbortSignal): Promise<unknown>;
};
/** Fully verify each canonical block before extracting original non-null rsIDs.
 * Reference events have no rsID; observed reference calls retain theirs. No
 * normalization disposition/quality filtering, deduplication or genotype copying.
 * Holds one canonical block + <=32k/8MiB pointer run + one encoded index block.
 * Awaited callbacks provide backpressure. Supplied source hashes are bindings,
 * not independent original-file proof. The returned scan counts certify ONLY
 * the consumed contiguous block stream/EOF: caller must compare them with the
 * separate canonical terminal and authorized manifest before publication.
 * Zero indexed rsIDs produces zero runs. All sink artifacts remain provisional
 * on any failure, and caller owns cleanup/settling an interrupted remote sink. */
export async function createCanonicalRsidRuns(blocks: AsyncIterable<{ descriptor: CanonicalBlockDescriptor; bytes: AsyncIterable<Uint8Array> }>, options: {
  binding: CanonicalBinding; sink: CanonicalRsidRunSink; signal?: AbortSignal; firstRunSequence?: number;
  firstBlockSequence?: number; firstCanonicalBlockSequence?: number;
}) {
  const binding = canonicalBindingSchema.parse(options.binding), { signal, sink } = options; active(signal);
  let runSequence = integer.parse(options.firstRunSequence ?? 0), blockSequence = integer.parse(options.firstBlockSequence ?? 0);
  let canonicalSequence = integer.parse(options.firstCanonicalBlockSequence ?? 0), canonicalBlockCount = 0, canonicalRecordCount = 0;
  let pointerCount = 0, runCount = 0, indexBlockCount = 0, bufferedBytes = 0;
  let buffer: CanonicalRsidPointer[] = [];
  async function flush() {
    if (!buffer.length) return;
    buffer.sort(compareCanonicalRsidPointers); const descriptors: CanonicalRsidBlockDescriptor[] = [];
    for (let offset = 0; offset < buffer.length; offset += RSID_BLOCK_MAX_POINTERS) {
      const block = await wait(encodeCanonicalRsidBlock({ binding, sequence: blockSequence, pointers: buffer.slice(offset, offset + RSID_BLOCK_MAX_POINTERS) }, { signal }), signal);
      active(signal); const expected = structuredClone(block.descriptor);
      const ack = await wait(sink.writeBlock({ ...block, runSequence }, signal), signal); active(signal);
      const parsed = canonicalRsidBlockDescriptorSchema.safeParse(ack);
      if (!parsed.success || !isDeepStrictEqual(expected, parsed.data)) fail("ack_mismatch");
      descriptors.push(expected); blockSequence = add(blockSequence, 1); indexBlockCount = add(indexBlockCount, 1);
    }
    const receipt = runSchema.parse({ version: "canonical-rsid-run-v1", state: "provisional", binding, sequence: runSequence,
      pointerCount: buffer.length, blocks: descriptors });
    if (Buffer.byteLength(JSON.stringify(receipt)) > RSID_RECEIPT_MAX_BYTES) fail("too_large");
    const expected = structuredClone(receipt), ack = await wait(sink.writeRun(receipt, signal), signal); active(signal);
    const parsed = checkedRun(ack, binding);
    if (!isDeepStrictEqual(parsed, expected)) fail("ack_mismatch");
    runSequence = add(runSequence, 1); runCount = add(runCount, 1); buffer = []; bufferedBytes = 0;
  }
  const iterator = blocks[Symbol.asyncIterator](); let exhausted = false;
  try {
    for (;;) {
      active(signal); const step = await wait(iterator.next(), signal); active(signal);
      if (step.done) { exhausted = true; break; }
      const descriptor = canonicalBlockDescriptorSchema.parse(step.value.descriptor);
      if (!isDeepStrictEqual(descriptor.binding, binding) || descriptor.sequence !== canonicalSequence) fail("invalid_receipt");
      const block = await wait(decodeCanonicalBlock(step.value.bytes, descriptor, { signal }), signal); active(signal);
      canonicalSequence = add(canonicalSequence, 1); canonicalBlockCount = add(canonicalBlockCount, 1); canonicalRecordCount = add(canonicalRecordCount, block.records.length);
      for (let recordOffset = 0; recordOffset < block.records.length; recordOffset++) {
        const event = block.records[recordOffset].event;
        const rsid = event.type === "reference" ? null : (event.type === "variant" ? event.record : event.call).rsid;
        if (rsid === null) continue;
        const pointer = { rsid, blockSequence: descriptor.sequence, recordOffset }, bytes = Buffer.byteLength(JSON.stringify(pointer));
        if (buffer.length === RSID_RUN_MAX_POINTERS || bufferedBytes + bytes > RSID_RUN_MAX_BYTES) await flush();
        buffer.push(pointer); bufferedBytes += bytes; pointerCount = add(pointerCount, 1);
      }
    }
    await flush(); active(signal);
    return { version: "canonical-rsid-scan-v1" as const, state: "provisional" as const, binding,
      canonicalBlockCount, canonicalRecordCount, pointerCount, runCount, indexBlockCount };
  } finally {
    if (!exhausted && iterator.return) { try { await wait(Promise.resolve(iterator.return()), signal); } catch { /* Preserve original failure. */ } }
  }
}

// Bound encoded JSON size, depth, object width and scalar lengths BEFORE Zod
// clones receipt trees. Only JSON-shaped metadata is accepted, never callbacks.
function preflightReceipt(raw: unknown) {
  let size = 0, visits = 0;
  function bytes(count: number) { size += count; if (size > RSID_RECEIPT_MAX_BYTES) fail("too_large"); }
  function visit(value: unknown, depth: number): void {
    if (++visits > 2_000_000 || depth > 8) fail("too_large");
    if (value === null) { bytes(4); return; }
    if (typeof value === "string") {
      if (value.length > 128) fail("invalid_receipt"); bytes(Buffer.byteLength(JSON.stringify(value))); return;
    }
    if (typeof value === "number" && Number.isFinite(value)) { bytes(String(value).length); return; }
    if (typeof value === "boolean") { bytes(value ? 4 : 5); return; }
    if (Array.isArray(value)) {
      if (value.length > MAX_RUN_BLOCKS) fail("too_large");
      bytes(2 + Math.max(0, value.length - 1)); for (const item of value) visit(item, depth + 1); return;
    }
    if (typeof value !== "object" || !value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("invalid_receipt");
    bytes(2); let count = 0;
    for (const key in value) if (Object.prototype.hasOwnProperty.call(value, key)) {
      if (++count > 20) fail("invalid_receipt"); if (count > 1) bytes(1);
      visit(key, depth + 1); bytes(1);
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property || !("value" in property)) fail("invalid_receipt");
      visit(property.value, depth + 1);
    }
  }
  visit(raw, 0);
}

function checkedRun(raw: unknown, binding: CanonicalBinding): CanonicalRsidRunReceipt {
  preflightReceipt(raw);
  const shape = raw as Partial<CanonicalRsidRunReceipt> | null;
  if (!shape || !Array.isArray(shape.blocks) || shape.blocks.length < 1 || shape.blocks.length > MAX_RUN_BLOCKS) fail("invalid_receipt");
  const parsed = runSchema.safeParse(raw); if (!parsed.success) fail("invalid_receipt"); const run = parsed.data;
  if (Buffer.byteLength(JSON.stringify(run)) > RSID_RECEIPT_MAX_BYTES || !isDeepStrictEqual(run.binding, binding)) fail("invalid_receipt");
  let count = 0;
  for (let i = 0; i < run.blocks.length; i++) {
    const block = run.blocks[i]; count = add(count, block.pointerCount);
    if (!isDeepStrictEqual(block.binding, binding) || compareCanonicalRsidPointers(block.first, block.last) > 0
      || (i > 0 && block.sequence !== run.blocks[i - 1].sequence + 1)) fail("invalid_receipt");
  }
  if (count !== run.pointerCount) fail("invalid_receipt"); return run;
}
/** At most eight runs / one decoded block per run. Larger merged runs may exceed
 * 32k pointers, but their inline descriptor receipts remain <=4MB. No fabricated
 * parser/canonical summary: only this merge's terminal certifies all inputs.
 * Earlier pointers remain provisional if a later block/count/order/EOF fails. */
export async function* mergeCanonicalRsidRuns(input: readonly CanonicalRsidRunReceipt[], options: {
  binding: CanonicalBinding; signal?: AbortSignal;
  readBlock: (descriptor: CanonicalRsidBlockDescriptor, signal?: AbortSignal) => AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>;
}): AsyncGenerator<CanonicalRsidPointer | CanonicalRsidMergeSummary, void, unknown> {
  const { signal } = options; active(signal); const binding = canonicalBindingSchema.parse(options.binding);
  if (!Array.isArray(input) || input.length < 1 || input.length > 8) fail("invalid_receipt");
  const runs = input.map(raw => checkedRun(raw, binding)).sort((a, b) => a.sequence - b.sequence);
  const sequences = new Set<number>(), hashes = new Set<string>();
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (i > 0 && (run.sequence === runs[i - 1].sequence || run.blocks[0].sequence <= runs[i - 1].blocks.at(-1)!.sequence)) fail("invalid_receipt");
    for (const block of run.blocks) {
      if (sequences.has(block.sequence) || hashes.has(block.compressedSha256)) fail("invalid_receipt");
      sequences.add(block.sequence); hashes.add(block.compressedSha256);
    }
  }
  const states = runs.map(run => ({ run, pointers: [] as CanonicalRsidPointer[], offset: 0, blockOffset: 0, count: 0, previous: undefined as CanonicalRsidPointer | undefined }));
  let pointerCount = 0, inputBlockCount = 0;
  async function head(state: typeof states[number]) {
    if (state.offset < state.pointers.length) return state.pointers[state.offset];
    state.pointers = []; state.offset = 0;
    if (state.blockOffset === state.run.blocks.length) { if (state.count !== state.run.pointerCount) fail("invalid_receipt"); return undefined; }
    active(signal); const descriptor = state.run.blocks[state.blockOffset];
    const bytes = await wait(Promise.resolve(options.readBlock(structuredClone(descriptor), signal)), signal); active(signal);
    const block = await wait(decodeCanonicalRsidBlock(bytes, descriptor, { signal }), signal); active(signal);
    if (state.previous && compareCanonicalRsidPointers(state.previous, block.pointers[0]) > 0) fail("out_of_order");
    state.previous = block.pointers.at(-1)!; state.count = add(state.count, block.pointers.length);
    state.blockOffset++; inputBlockCount = add(inputBlockCount, 1); state.pointers = block.pointers;
    return state.pointers[0];
  }
  for (;;) {
    active(signal); let selected: typeof states[number] | undefined, pointer: CanonicalRsidPointer | undefined;
    for (const state of states) { const candidate = await head(state); if (candidate && (!pointer || compareCanonicalRsidPointers(candidate, pointer) < 0)) { selected = state; pointer = candidate; } }
    if (!selected || !pointer) break;
    selected.offset++; pointerCount = add(pointerCount, 1); yield { ...pointer };
  }
  active(signal); yield { type: "rsid-merge-summary", version: "canonical-rsid-merge-v1", state: "provisional", binding,
    inputRunSequences: runs.map(run => run.sequence), inputBlockCount, pointerCount };
}
