import "server-only";
import { createHash } from "node:crypto";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, gzip } from "node:zlib";
import { promisify } from "node:util";
import { TextDecoder } from "node:util";
import { z } from "zod";
import { PREPARED_BLOCK_MAX_COMPRESSED_BYTES, PREPARED_BLOCK_MAX_DECODED_BYTES,
  PREPARED_BLOCK_MAX_EVENTS, preparedBlockDescriptorSchema, preparedBlockSchema,
  preparedEventSchema, preparedSourceBindingSchema, type PreparedBlockDescriptor,
  type PreparedColumns, type PreparedEvent, type PreparedSourceBinding } from "./schema";

export class PreparedBlockError extends Error {
  constructor(readonly code: "invalid_block" | "too_large" | "integrity_mismatch" | "aborted") {
    super(code); this.name = "PreparedBlockError";
  }
}
const compress = promisify(gzip);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const inputSchema = z.object({ source: preparedSourceBindingSchema,
  sequence: z.number().int().nonnegative().safe(),
  events: z.array(preparedEventSchema).min(1).max(PREPARED_BLOCK_MAX_EVENTS) }).strict();

function columnsOf(events: PreparedEvent[]): PreparedColumns {
  const columns: PreparedColumns = { kind: [], line: [], rsid: [], chrom: [], pos: [], ref: [], alt: [],
    genotype: [], sourceGt: [], filter: [], sampleFilter: [], genotypeQuality: [], depth: [], quality: [], usable: [] };
  for (const event of events) {
    const record = event.type === "variant" ? event.record : event.call;
    const observation = event.type === "observed" ? event.call : null;
    columns.kind.push(event.type); columns.line.push(event.line);
    columns.rsid.push("rsid" in record ? record.rsid : null);
    columns.chrom.push(record.chrom); columns.pos.push(record.pos); columns.ref.push(record.ref);
    columns.alt.push("alt" in record ? record.alt : null); columns.genotype.push(record.genotype);
    columns.sourceGt.push(observation?.sourceGt ?? null); columns.filter.push(observation?.filter ?? null);
    columns.sampleFilter.push(observation?.sampleFilter ?? null);
    columns.genotypeQuality.push(observation?.genotypeQuality ?? null); columns.depth.push(observation?.depth ?? null);
    columns.quality.push(observation?.quality ?? null); columns.usable.push(observation?.usable ?? null);
  }
  return columns;
}

function eventsOf(c: PreparedColumns): PreparedEvent[] {
  return c.kind.map((kind, i) => {
    const record = { rsid: c.rsid[i], chrom: c.chrom[i], pos: c.pos[i], ref: c.ref[i],
      alt: c.alt[i], genotype: c.genotype[i] };
    if (kind !== "observed" && [c.sourceGt[i], c.filter[i], c.sampleFilter[i], c.genotypeQuality[i],
      c.depth[i], c.quality[i], c.usable[i]].some(value => value !== null)) throw new PreparedBlockError("invalid_block");
    if (kind === "reference") {
      if (c.rsid[i] !== null || c.alt[i] !== null || c.ref[i] === null) throw new PreparedBlockError("invalid_block");
      return preparedEventSchema.parse({ type: kind, line: c.line[i], call: {
        chrom: c.chrom[i], pos: c.pos[i], ref: c.ref[i], genotype: c.genotype[i] } });
    }
    return preparedEventSchema.parse(kind === "variant" ? { type: kind, line: c.line[i], record }
      : { type: kind, line: c.line[i], call: { ...record, line: c.line[i], sourceGt: c.sourceGt[i],
        filter: c.filter[i], sampleFilter: c.sampleFilter[i], genotypeQuality: c.genotypeQuality[i],
        depth: c.depth[i], quality: c.quality[i], usable: c.usable[i] } });
  });
}

/** A bounded provisional parser-event block. No sorting, deduplication or
 * normalization is performed; event order and all supplied values survive. */
export async function encodePreparedBlock(input: { source: PreparedSourceBinding; sequence: number; events: PreparedEvent[] }) {
  try {
    if (!Array.isArray(input?.events) || input.events.length < 1 || input.events.length > PREPARED_BLOCK_MAX_EVENTS) {
      throw new PreparedBlockError("invalid_block");
    }
    const parsed = inputSchema.parse(input);
    // Bound string content before serializing. The schema keeps the object
    // shape/count bounded and never copies or interprets allele strings.
    let stringBytes = 0;
    for (const event of parsed.events) {
      const record = event.type === "variant" ? event.record : event.call;
      for (const value of Object.values(record)) if (typeof value === "string") {
        stringBytes += Buffer.byteLength(value);
        if (stringBytes > PREPARED_BLOCK_MAX_DECODED_BYTES) throw new PreparedBlockError("too_large");
      }
    }
    const body = { version: "prepared-events-columnar-v1" as const, state: "provisional" as const,
      source: parsed.source, sequence: parsed.sequence, columns: columnsOf(parsed.events) };
    const decoded = Buffer.from(JSON.stringify(body));
    if (decoded.length > PREPARED_BLOCK_MAX_DECODED_BYTES) throw new PreparedBlockError("too_large");
    const compressed = await compress(decoded, { level: 6 });
    const descriptor = preparedBlockDescriptorSchema.parse({ version: body.version, compression: "gzip",
      source: body.source, sequence: body.sequence, eventCount: parsed.events.length,
      compressedBytes: compressed.length, decodedBytes: decoded.length,
      compressedSha256: sha(compressed), decodedSha256: sha(decoded) });
    return { descriptor, compressed };
  } catch (error) {
    if (error instanceof PreparedBlockError) throw error;
    throw new PreparedBlockError("invalid_block");
  }
}

/** Expected descriptor must come from a separately authorized immutable manifest.
 * This function verifies integrity, not authorization. No events are released
 * until EOF, both hashes, byte counts, source binding and closed schema pass.
 * Stream buffering is bounded to one block; the caller must make its byte
 * producer abortable if its own awaited I/O can otherwise remain pending. */
export async function decodePreparedBlock(source: AsyncIterable<Uint8Array>, expected: PreparedBlockDescriptor,
  options: { signal?: AbortSignal } = {}) {
  let input: Readable | undefined, gunzip: ReturnType<typeof createGunzip> | undefined;
  try {
    const descriptor = preparedBlockDescriptorSchema.parse(expected);
    if (options.signal?.aborted) throw new PreparedBlockError("aborted");
    const compressedHash = createHash("sha256"), decodedHash = createHash("sha256");
    let compressedBytes = 0, decodedBytes = 0;
    const chunks: Buffer[] = [];
    input = Readable.from(source, { objectMode: false, highWaterMark: 16_384 });
    const countInput = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      compressedBytes += chunk.length;
      if (compressedBytes > descriptor.compressedBytes || compressedBytes > PREPARED_BLOCK_MAX_COMPRESSED_BYTES) {
        callback(new PreparedBlockError("too_large")); return;
      }
      compressedHash.update(chunk); callback(null, chunk);
    } });
    gunzip = createGunzip({ chunkSize: 16_384 });
    const collect = new Writable({ write(chunk: Buffer, _encoding, callback) {
      decodedBytes += chunk.length;
      if (decodedBytes > descriptor.decodedBytes || decodedBytes > PREPARED_BLOCK_MAX_DECODED_BYTES) {
        callback(new PreparedBlockError("too_large")); return;
      }
      decodedHash.update(chunk); chunks.push(chunk); callback();
    } });
    await pipeline(input, countInput, gunzip, collect, { signal: options.signal });
    if (compressedBytes !== descriptor.compressedBytes || decodedBytes !== descriptor.decodedBytes
      || compressedHash.digest("hex") !== descriptor.compressedSha256 || decodedHash.digest("hex") !== descriptor.decodedSha256) {
      throw new PreparedBlockError("integrity_mismatch");
    }
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, decodedBytes));
    const block = preparedBlockSchema.parse(JSON.parse(decoded));
    if (block.sequence !== descriptor.sequence || block.columns.kind.length !== descriptor.eventCount
      || JSON.stringify(block.source) !== JSON.stringify(descriptor.source)) throw new PreparedBlockError("integrity_mismatch");
    return { source: block.source, sequence: block.sequence, state: block.state, events: eventsOf(block.columns) };
  } catch (error) {
    if (options.signal?.aborted) throw new PreparedBlockError("aborted");
    if (error instanceof PreparedBlockError) throw error;
    throw new PreparedBlockError("invalid_block");
  } finally {
    input?.destroy(); gunzip?.destroy();
  }
}
