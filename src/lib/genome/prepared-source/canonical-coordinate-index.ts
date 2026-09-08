import "server-only";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { canonicalBlockDescriptorSchema, decodeCanonicalBlock, type CanonicalBlockDescriptor } from "./canonical-codec";
import { canonicalBindingSchema, type CanonicalBinding } from "./canonical-schema";
import { canonicalRecordOrderKey, compareCanonicalRecords, type CanonicalOrderKey } from "./canonical-runs";

export const CANONICAL_COORDINATE_PAGE_MAX_ENTRIES = 128;
export const CANONICAL_COORDINATE_PAGE_MAX_BYTES = 1_048_576;
export const CANONICAL_COORDINATE_MAX_QUERIES = 200;
const integer = z.number().int().nonnegative().safe();
const coordinateSchema = z.object({ chrom: integer.min(1).max(25), pos: integer.positive() }).strict();
export type CanonicalCoordinate = z.infer<typeof coordinateSchema>;
const orderKeySchema = z.tuple([integer.max(1), integer.max(25), integer, integer.min(1).max(25), integer.positive(),
  integer.positive(), integer.max(2)]).refine(key => key[0] === 0 ? key[1] > 0 && key[2] > 0 && key[6] !== 1
  : key[1] === 0 && key[2] === 0, "Invalid normalized/source-only key");
function compareKey(a: CanonicalOrderKey, b: CanonicalOrderKey) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
function compareCoordinate(a: CanonicalCoordinate, b: CanonicalCoordinate) { return a.chrom - b.chrom || a.pos - b.pos; }
const coordinateOf = (key: CanonicalOrderKey): CanonicalCoordinate => ({ chrom: key[1], pos: key[2] });
const entrySchema = z.object({ descriptor: canonicalBlockDescriptorSchema,
  normalizedFirst: coordinateSchema.nullable(), normalizedLast: coordinateSchema.nullable(), normalizedCount: integer.max(2000),
  firstKey: orderKeySchema, lastKey: orderKeySchema }).strict().refine(entry => {
  if (entry.normalizedCount > entry.descriptor.recordCount || compareKey(entry.firstKey, entry.lastKey) > 0) return false;
  if (entry.descriptor.recordCount === 1 && compareKey(entry.firstKey, entry.lastKey) !== 0) return false;
  if (entry.normalizedCount === 0) return entry.normalizedFirst === null && entry.normalizedLast === null
    && entry.firstKey[0] === 1 && entry.lastKey[0] === 1;
  if (!entry.normalizedFirst || !entry.normalizedLast || entry.firstKey[0] !== 0
    || compareCoordinate(entry.normalizedFirst, entry.normalizedLast) > 0
    || compareCoordinate(entry.normalizedFirst, coordinateOf(entry.firstKey)) !== 0) return false;
  if (entry.normalizedCount === 1 && compareCoordinate(entry.normalizedFirst, entry.normalizedLast) !== 0) return false;
  return entry.normalizedCount === entry.descriptor.recordCount
    ? entry.lastKey[0] === 0 && compareCoordinate(entry.normalizedLast, coordinateOf(entry.lastKey)) === 0
    : entry.lastKey[0] === 1;
}, "Bounds/counts must describe the normalized prefix and source-only tail");
export type CanonicalCoordinateEntry = z.infer<typeof entrySchema>;
export const canonicalCoordinateIndexSchema = z.object({ version: z.literal("canonical-coordinate-index-v1"),
  state: z.literal("provisional"), binding: canonicalBindingSchema, sequence: integer, firstBlockSequence: integer,
  entries: z.array(entrySchema).min(1).max(CANONICAL_COORDINATE_PAGE_MAX_ENTRIES) }).strict();
export type CanonicalCoordinateIndex = z.infer<typeof canonicalCoordinateIndexSchema>;
export type CanonicalCoordinateIndexSummary = {
  version: "canonical-coordinate-index-summary-v1"; state: "provisional"; binding: CanonicalBinding;
  pageCount: number; firstBlockSequence: number; lastBlockSequence: number | null; blockCount: number;
  recordCount: number; normalizedCount: number; normalizedFirst: CanonicalCoordinate | null;
  normalizedLast: CanonicalCoordinate | null; firstKey: CanonicalOrderKey | null; lastKey: CanonicalOrderKey | null;
};
export type CanonicalCoordinateIndexCompletion = { page: CanonicalCoordinateIndex | null; summary: CanonicalCoordinateIndexSummary };
export class CanonicalCoordinateIndexError extends Error {
  constructor(readonly code: "invalid_index" | "invalid_query" | "integrity_mismatch" | "out_of_order"
    | "sequence_mismatch" | "too_large" | "invalid_state" | "aborted") {
    super(code); this.name = "CanonicalCoordinateIndexError";
  }
}

/** Size/cardinality preflight BEFORE Zod clones. Every valid schema string is
 * <=128 chars; object width/depth and aggregate visits are also bounded. Only
 * small individual strings are serialized, never an unchecked whole directory. */
function preflight(raw: unknown) {
  const entries = raw && typeof raw === "object" && !Array.isArray(raw) ? Reflect.get(raw, "entries") : undefined;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > CANONICAL_COORDINATE_PAGE_MAX_ENTRIES) {
    throw new CanonicalCoordinateIndexError("invalid_index");
  }
  let size = 0, visits = 0;
  const add = (bytes: number) => {
    size += bytes; if (size > CANONICAL_COORDINATE_PAGE_MAX_BYTES) throw new CanonicalCoordinateIndexError("too_large");
  };
  function visit(value: unknown, depth: number): void {
    if (++visits > 20_000 || depth > 8) throw new CanonicalCoordinateIndexError("too_large");
    if (value === null) { add(4); return; }
    if (typeof value === "string") {
      if (value.length > 128) throw new CanonicalCoordinateIndexError("invalid_index");
      add(Buffer.byteLength(JSON.stringify(value))); return;
    }
    if (typeof value === "number" && Number.isFinite(value)) { add(String(value).length); return; }
    if (typeof value === "boolean") { add(value ? 4 : 5); return; }
    if (Array.isArray(value)) {
      if (value.length > 128) throw new CanonicalCoordinateIndexError("too_large");
      add(2 + Math.max(0, value.length - 1)); for (const member of value) visit(member, depth + 1); return;
    }
    if (typeof value !== "object" || !value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      throw new CanonicalCoordinateIndexError("invalid_index");
    }
    add(2); let count = 0;
    for (const key in value) if (Object.prototype.hasOwnProperty.call(value, key)) {
      if (++count > 20) throw new CanonicalCoordinateIndexError("invalid_index");
      if (count > 1) add(1); visit(key, depth + 1); add(1); visit(Reflect.get(value, key), depth + 1);
    }
  }
  visit(raw, 0);
}

/** Metadata consistency only, not permission or independent proof that bounds
 * match bytes. Read-time pages must come from an authorized immutable manifest.
 * Only the builder below derives trusted bounds by actually decoding blocks. */
export function validateCanonicalCoordinateIndex(raw: unknown, expectedBinding?: CanonicalBinding): CanonicalCoordinateIndex {
  preflight(raw);
  const parsed = canonicalCoordinateIndexSchema.safeParse(raw);
  if (!parsed.success) throw new CanonicalCoordinateIndexError("invalid_index");
  const page = parsed.data;
  if (expectedBinding && !isDeepStrictEqual(page.binding, canonicalBindingSchema.parse(expectedBinding))) {
    throw new CanonicalCoordinateIndexError("integrity_mismatch");
  }
  let previous: CanonicalCoordinateEntry | undefined;
  for (const [index, entry] of page.entries.entries()) {
    if (!isDeepStrictEqual(entry.descriptor.binding, page.binding)) throw new CanonicalCoordinateIndexError("integrity_mismatch");
    if (entry.descriptor.sequence !== page.firstBlockSequence + index) throw new CanonicalCoordinateIndexError("sequence_mismatch");
    if (previous && compareKey(previous.lastKey, entry.firstKey) > 0) throw new CanonicalCoordinateIndexError("out_of_order");
    previous = entry;
  }
  return page;
}

export async function buildCanonicalCoordinateEntry(bytes: AsyncIterable<Uint8Array>, expected: CanonicalBlockDescriptor,
  options: { signal?: AbortSignal } = {}): Promise<CanonicalCoordinateEntry> {
  const descriptor = canonicalBlockDescriptorSchema.parse(expected);
  const block = await decodeCanonicalBlock(bytes, descriptor, options);
  let normalizedFirst: CanonicalCoordinate | null = null, normalizedLast: CanonicalCoordinate | null = null, normalizedCount = 0;
  for (let index = 0; index < block.records.length; index++) {
    const record = block.records[index];
    if (index && compareCanonicalRecords(block.records[index - 1], record) > 0) throw new CanonicalCoordinateIndexError("out_of_order");
    if (record.normalization.status === "normalized") {
      const value = { chrom: record.normalization.record.chrom, pos: record.normalization.record.pos };
      normalizedFirst ??= value; normalizedLast = value; normalizedCount++;
    }
  }
  if (options.signal?.aborted) throw new CanonicalCoordinateIndexError("aborted");
  return entrySchema.parse({ descriptor, normalizedFirst, normalizedLast, normalizedCount,
    firstKey: canonicalRecordOrderKey(block.records[0]), lastKey: canonicalRecordOrderKey(block.records.at(-1)!) });
}

/** Small envelope suitable for a manifest page reference. Hash/object identity
 * of the serialized page must be supplied by the actual immutable writer. */
export function describeCanonicalCoordinateIndex(raw: unknown, expectedBinding?: CanonicalBinding) {
  const page = validateCanonicalCoordinateIndex(raw, expectedBinding), entries = page.entries;
  const normalized = entries.filter(entry => entry.normalizedCount > 0);
  return { sequence: page.sequence, firstBlockSequence: page.firstBlockSequence, lastBlockSequence: entries.at(-1)!.descriptor.sequence,
    blockCount: entries.length, recordCount: entries.reduce((n, e) => n + e.descriptor.recordCount, 0),
    normalizedCount: entries.reduce((n, e) => n + e.normalizedCount, 0), normalizedFirst: normalized[0]?.normalizedFirst ?? null,
    normalizedLast: normalized.at(-1)?.normalizedLast ?? null, firstKey: entries[0].firstKey, lastKey: entries.at(-1)!.lastKey };
}

/** Returns descriptor REFERENCES only, with possible range false positives.
 * Inclusive endpoints keep every collision crossing a block boundary. Caller
 * must read verified blocks, exact-filter normalized records and recheck current
 * authority before releasing calls. Source-only evidence never creates a range. */
export function selectCanonicalCoordinateBlocks(raw: unknown, requested: readonly CanonicalCoordinate[], expectedBinding?: CanonicalBinding) {
  if (!Array.isArray(requested) || requested.length > CANONICAL_COORDINATE_MAX_QUERIES) throw new CanonicalCoordinateIndexError("invalid_query");
  const seen = new Set<string>();
  const coordinates = requested.map(raw => {
    const parsed = coordinateSchema.safeParse(raw);
    if (!parsed.success) throw new CanonicalCoordinateIndexError("invalid_query");
    const key = `${parsed.data.chrom}:${parsed.data.pos}`;
    if (seen.has(key)) throw new CanonicalCoordinateIndexError("invalid_query"); seen.add(key); return parsed.data;
  });
  const page = validateCanonicalCoordinateIndex(raw, expectedBinding);
  return page.entries.filter(entry => entry.normalizedFirst && entry.normalizedLast && coordinates.some(coordinate =>
    compareCoordinate(coordinate, entry.normalizedFirst!) >= 0 && compareCoordinate(coordinate, entry.normalizedLast!) <= 0))
    .map(entry => entry.descriptor);
}

/** One decoded block and one <=128-entry/1MiB metadata page. Calls are serial;
 * append derives each entry from bytes, never caller-authored bounds. Returned
 * pages are NOT durable ACKs: persist them before pulling more upstream blocks.
 * Failure/abort closes this builder and invalidates all provisional pages.
 * finish proves only this directory's coverage, never canonical source EOF or
 * authorization; compare its counts with the actual normalization terminal. */
export function createCanonicalCoordinateIndexBuilder(options: { binding: CanonicalBinding; firstBlockSequence?: number; signal?: AbortSignal }) {
  const binding = canonicalBindingSchema.parse(options.binding), firstBlockSequence = integer.parse(options.firstBlockSequence ?? 0);
  const { signal } = options;
  let nextBlock = firstBlockSequence, pageCount = 0, recordCount = 0, normalizedCount = 0, busy = false, closed = false;
  let entries: CanonicalCoordinateEntry[] = [], firstKey: CanonicalOrderKey | null = null, lastKey: CanonicalOrderKey | null = null;
  let normalizedFirst: CanonicalCoordinate | null = null, normalizedLast: CanonicalCoordinate | null = null;
  function check() {
    if (signal?.aborted) throw new CanonicalCoordinateIndexError("aborted");
    if (closed || busy) throw new CanonicalCoordinateIndexError("invalid_state");
  }
  function pageOf(values: CanonicalCoordinateEntry[]) {
    return validateCanonicalCoordinateIndex({ version: "canonical-coordinate-index-v1", state: "provisional", binding,
      sequence: pageCount, firstBlockSequence: values[0].descriptor.sequence, entries: values }, binding);
  }
  function emit(): CanonicalCoordinateIndex | null {
    if (!entries.length) return null;
    const page = pageOf(entries); entries = []; pageCount++; return page;
  }
  check();
  return {
    async append(bytes: AsyncIterable<Uint8Array>, rawDescriptor: CanonicalBlockDescriptor): Promise<CanonicalCoordinateIndex | null> {
      check(); busy = true;
      try {
        const descriptor = canonicalBlockDescriptorSchema.parse(rawDescriptor);
        if (!isDeepStrictEqual(descriptor.binding, binding)) throw new CanonicalCoordinateIndexError("integrity_mismatch");
        if (descriptor.sequence !== nextBlock) throw new CanonicalCoordinateIndexError("sequence_mismatch");
        const entry = await buildCanonicalCoordinateEntry(bytes, descriptor, { signal });
        if (signal?.aborted) throw new CanonicalCoordinateIndexError("aborted");
        if (lastKey && compareKey(lastKey, entry.firstKey) > 0) throw new CanonicalCoordinateIndexError("out_of_order");
        if (!Number.isSafeInteger(nextBlock + 1) || !Number.isSafeInteger(recordCount + descriptor.recordCount)) throw new CanonicalCoordinateIndexError("too_large");
        let page: CanonicalCoordinateIndex | null = null;
        if (entries.length) {
          try { pageOf([...entries, entry]); }
          catch (error) { if (!(error instanceof CanonicalCoordinateIndexError) || error.code !== "too_large") throw error; page = emit(); }
        }
        entries.push(entry); firstKey ??= entry.firstKey; lastKey = entry.lastKey;
        normalizedFirst ??= entry.normalizedFirst; if (entry.normalizedLast) normalizedLast = entry.normalizedLast;
        nextBlock++; recordCount += descriptor.recordCount; normalizedCount += entry.normalizedCount;
        if (entries.length === CANONICAL_COORDINATE_PAGE_MAX_ENTRIES) page = emit();
        return page;
      } catch (error) { closed = true; entries = []; throw error; }
      finally { busy = false; }
    },
    flush() { check(); return emit(); },
    finish(): CanonicalCoordinateIndexCompletion {
      check(); const page = emit(); closed = true;
      return { page, summary: { version: "canonical-coordinate-index-summary-v1" as const, state: "provisional" as const,
        binding, pageCount, firstBlockSequence, lastBlockSequence: nextBlock === firstBlockSequence ? null : nextBlock - 1,
        blockCount: nextBlock - firstBlockSequence, recordCount, normalizedCount, normalizedFirst, normalizedLast, firstKey, lastKey } };
    },
  };
}
