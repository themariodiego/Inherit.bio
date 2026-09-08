import "server-only";
import { createHash } from "node:crypto";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isDeepStrictEqual, promisify, TextDecoder } from "node:util";
import { createGunzip, gzip } from "node:zlib";
import { z } from "zod";
import type { VariantRecord } from "../types";
import { canonicalBindingSchema, canonicalRecordSchema,
  type CanonicalBinding, type CanonicalRecord } from "./canonical-schema";
import { preparedEventSchema, PREPARED_BLOCK_MAX_COMPRESSED_BYTES,
  PREPARED_BLOCK_MAX_DECODED_BYTES, PREPARED_BLOCK_MAX_EVENTS } from "./schema";

const VERSION = "prepared-canonical-block-v1" as const;
const integer = z.number().int().nonnegative().safe();
const text = z.string().max(PREPARED_BLOCK_MAX_DECODED_BYTES);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
// rsID is immutable through canonical normalization, so it has no delta field.
const deltaSchema = z.object({ chrom: integer.positive().max(25).optional(), pos: integer.positive().optional(),
  ref: text.nullable().optional(), alt: text.nullable().optional(), genotype: text.optional() }).strict()
  .refine(value => Object.keys(value).length > 0 && Object.values(value).every(field => field !== undefined),
    "Delta must contain explicit changed fields");
type Delta = z.infer<typeof deltaSchema>;
const normalizationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("same-source") }).strict(),
  z.object({ kind: z.literal("delta"), changes: deltaSchema }).strict(),
  z.object({ kind: z.literal("duplicate"), firstSourceLine: integer.positive() }).strict(),
  z.object({ kind: z.literal("unmapped") }).strict(),
  z.object({ kind: z.literal("unsupported_alleles") }).strict(),
  z.object({ kind: z.literal("source_reference") }).strict(),
]);
const rowSchema = z.object({ event: preparedEventSchema, normalization: normalizationSchema }).strict();
type WireRow = z.infer<typeof rowSchema>;
const wireSchema = z.object({ version: z.literal(VERSION), state: z.literal("provisional"),
  binding: canonicalBindingSchema, sequence: integer,
  records: z.array(rowSchema).min(1).max(PREPARED_BLOCK_MAX_EVENTS) }).strict();
export const canonicalBlockDescriptorSchema = z.object({ version: z.literal(VERSION), compression: z.literal("gzip"),
  binding: canonicalBindingSchema, sequence: integer, recordCount: integer.positive().max(PREPARED_BLOCK_MAX_EVENTS),
  compressedBytes: integer.positive().max(PREPARED_BLOCK_MAX_COMPRESSED_BYTES),
  decodedBytes: integer.positive().max(PREPARED_BLOCK_MAX_DECODED_BYTES), compressedSha256: hash, decodedSha256: hash,
}).strict();
export type CanonicalBlockDescriptor = z.infer<typeof canonicalBlockDescriptorSchema>;
export class CanonicalBlockError extends Error {
  constructor(readonly code: "invalid_block" | "too_large" | "integrity_mismatch" | "aborted") {
    super(code); this.name = "CanonicalBlockError";
  }
}
const compress = promisify(gzip);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const inputSchema = z.object({ binding: canonicalBindingSchema, sequence: integer,
  records: z.array(z.unknown()).min(1).max(PREPARED_BLOCK_MAX_EVENTS) }).strict();
const coreKeys = ["chrom", "pos", "ref", "alt", "genotype"] as const;
function core(event: CanonicalRecord["event"]): VariantRecord {
  if (event.type === "reference") throw new CanonicalBlockError("invalid_block");
  const source = event.type === "variant" ? event.record : event.call;
  return { rsid: source.rsid, chrom: source.chrom, pos: source.pos,
    ref: source.ref, alt: source.alt, genotype: source.genotype };
}
function wireRow(record: CanonicalRecord): WireRow {
  const normalization = record.normalization;
  if (normalization.status !== "normalized") {
    return { event: record.event, normalization: normalization.status === "duplicate"
      ? { kind: "duplicate", firstSourceLine: normalization.firstSourceLine } : { kind: normalization.status } };
  }
  const original = core(record.event), changed: Delta = {};
  for (const key of coreKeys) {
    if (original[key] !== normalization.record[key]) Object.assign(changed, { [key]: normalization.record[key] });
  }
  return { event: record.event, normalization: Object.keys(changed).length
    ? { kind: "delta", changes: changed } : { kind: "same-source" } };
}
function recordOf(row: WireRow): CanonicalRecord {
  const n = row.normalization;
  let normalization: CanonicalRecord["normalization"];
  if (n.kind === "same-source" || n.kind === "delta") {
    const original = core(row.event);
    if (n.kind === "delta" && Object.entries(n.changes).some(([key, value]) => value === original[key as keyof Delta])) {
      throw new CanonicalBlockError("invalid_block"); // No ambiguous/redundant delta encoding.
    }
    normalization = { status: "normalized", record: n.kind === "delta" ? { ...original, ...n.changes } : original };
  } else normalization = n.kind === "duplicate" ? { status: "duplicate", firstSourceLine: n.firstSourceLine } : { status: n.kind };
  return canonicalRecordSchema.parse({ type: "canonical-record", version: "prepared-canonical-v1", event: row.event, normalization });
}
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw new CanonicalBlockError("aborted"); }
async function abortable<T>(started: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) { void started.catch(() => {}); throw new CanonicalBlockError("aborted"); }
  if (!signal) return started;
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new CanonicalBlockError("aborted"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([started, cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}

/** Lossless, bounded canonical records with their binding stored once. Unchanged
 * normalized alleles are references to original core fields on wire, not copied
 * strings. Dispositions/source evidence survive exactly; no sorting, target
 * coordinate index, semantic re-normalization or permission check is performed.
 * Every block remains provisional; only the full normalization terminal and a
 * separately authorized writer can publish it. */
export async function encodeCanonicalBlock(input: { binding: CanonicalBinding; sequence: number; records: CanonicalRecord[] },
  options: { signal?: AbortSignal } = {}) {
  try {
    checkAbort(options.signal);
    if (!Array.isArray(input?.records) || input.records.length < 1 || input.records.length > PREPARED_BLOCK_MAX_EVENTS) {
      throw new CanonicalBlockError("invalid_block");
    }
    const parsed = inputSchema.parse(input), records: WireRow[] = [];
    // Check bounded strings before JSON serialization, counting only actual wire
    // strings. The unchanged normalized copy must not count a second time.
    let stringBytes = 0;
    for (const raw of parsed.records) {
      const row = wireRow(canonicalRecordSchema.parse(raw));
      const original = row.event.type === "variant" ? row.event.record : row.event.call;
      for (const fields of [original, row.normalization.kind === "delta" ? row.normalization.changes : {}]) {
        for (const value of Object.values(fields)) if (typeof value === "string") {
          stringBytes += Buffer.byteLength(value);
          if (stringBytes > PREPARED_BLOCK_MAX_DECODED_BYTES) throw new CanonicalBlockError("too_large");
        }
      }
      records.push(row);
    }
    const body = { version: VERSION, state: "provisional" as const, binding: parsed.binding, sequence: parsed.sequence, records };
    const decoded = Buffer.from(JSON.stringify(body));
    if (decoded.length > PREPARED_BLOCK_MAX_DECODED_BYTES) throw new CanonicalBlockError("too_large");
    checkAbort(options.signal);
    const compressed = await abortable(compress(decoded, { level: 6 }), options.signal);
    checkAbort(options.signal);
    if (compressed.length > PREPARED_BLOCK_MAX_COMPRESSED_BYTES) throw new CanonicalBlockError("too_large");
    const descriptor = canonicalBlockDescriptorSchema.parse({ version: VERSION, compression: "gzip", binding: body.binding,
      sequence: body.sequence, recordCount: records.length, compressedBytes: compressed.length, decodedBytes: decoded.length,
      compressedSha256: sha(compressed), decodedSha256: sha(decoded) });
    return { descriptor, compressed };
  } catch (error) {
    if (options.signal?.aborted) throw new CanonicalBlockError("aborted");
    if (error instanceof CanonicalBlockError) throw error;
    throw new CanonicalBlockError("invalid_block");
  }
}

/** Expected descriptor must be independently authorized and immutable. Holds one
 * bounded compressed/decoded block; returns NO records until actual EOF, both
 * hashes/lengths, fatal UTF-8, exact binding/sequence/count and reconstructed
 * closed canonical records pass. Producer must honor signal for its own I/O.
 * A valid block alone does not establish global source or target ordering. */
export async function decodeCanonicalBlock(source: AsyncIterable<Uint8Array>, expected: CanonicalBlockDescriptor,
  options: { signal?: AbortSignal } = {}) {
  let input: Readable | undefined, gunzip: ReturnType<typeof createGunzip> | undefined;
  try {
    checkAbort(options.signal);
    const descriptor = canonicalBlockDescriptorSchema.parse(expected);
    const compressedHash = createHash("sha256"), decodedHash = createHash("sha256");
    let compressedBytes = 0, decodedBytes = 0;
    const chunks: Buffer[] = [];
    input = Readable.from(source, { objectMode: false, highWaterMark: 16_384 });
    const countInput = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      compressedBytes += chunk.length;
      if (compressedBytes > descriptor.compressedBytes || compressedBytes > PREPARED_BLOCK_MAX_COMPRESSED_BYTES) {
        callback(new CanonicalBlockError("too_large")); return;
      }
      compressedHash.update(chunk); callback(null, chunk);
    } });
    gunzip = createGunzip({ chunkSize: 16_384 });
    const collect = new Writable({ write(chunk: Buffer, _encoding, callback) {
      decodedBytes += chunk.length;
      if (decodedBytes > descriptor.decodedBytes || decodedBytes > PREPARED_BLOCK_MAX_DECODED_BYTES) {
        callback(new CanonicalBlockError("too_large")); return;
      }
      decodedHash.update(chunk); chunks.push(chunk); callback();
    } });
    await pipeline(input, countInput, gunzip, collect, { signal: options.signal });
    checkAbort(options.signal);
    if (compressedBytes !== descriptor.compressedBytes || decodedBytes !== descriptor.decodedBytes
      || compressedHash.digest("hex") !== descriptor.compressedSha256 || decodedHash.digest("hex") !== descriptor.decodedSha256) {
      throw new CanonicalBlockError("integrity_mismatch");
    }
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, decodedBytes));
    const raw = JSON.parse(decoded);
    if (!Array.isArray(raw?.records) || raw.records.length < 1 || raw.records.length > PREPARED_BLOCK_MAX_EVENTS) {
      throw new CanonicalBlockError("invalid_block");
    }
    const block = wireSchema.parse(raw);
    if (!isDeepStrictEqual(block.binding, descriptor.binding) || block.sequence !== descriptor.sequence
      || block.records.length !== descriptor.recordCount) throw new CanonicalBlockError("integrity_mismatch");
    const records = block.records.map(recordOf);
    checkAbort(options.signal);
    return { binding: block.binding, sequence: block.sequence, state: block.state, records };
  } catch (error) {
    if (options.signal?.aborted) throw new CanonicalBlockError("aborted");
    if (error instanceof CanonicalBlockError) throw error;
    throw new CanonicalBlockError("invalid_block");
  } finally { input?.destroy(); gunzip?.destroy(); }
}
