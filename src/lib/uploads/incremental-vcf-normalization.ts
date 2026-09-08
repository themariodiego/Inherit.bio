import { INGEST_CHUNK_MAXIMUM_BYTES } from "../genome/ingest-limits";
import { streamVcf } from "../genome/parsers/vcf";
import type { ObservedCall } from "../genome/observed-calls";
import type { Build, VariantRecord } from "../genome/types";
import { liftSingleBaseVariant } from "../genome/liftover";

export type PositionEntry = { source_chrom: number; source_pos: number;
  variant: VariantRecord | null; mapped: boolean | null };
export type PositionReceipt = { acceptedVariantOrdinals: number[]; attempted: number; unmapped: number };
type PendingPosition = { line: number; chrom: number; pos: number;
  variant?: VariantRecord; observed?: ObservedCall };
type Lift = Parameters<typeof liftSingleBaseVariant>[1];
export class IncrementalVcfError extends Error {
  constructor(readonly code: "unavailable" | "unrecognised_format" | "upload_integrity_mismatch" |
    "empty_after_parse" | "liftover_loss") { super(code); }
}
type Options = {
  build: Exclude<Build, "unknown">;
  lift?: Lift;
  maximumUnmappedFraction: number;
  register: (sequence: number, entries: PositionEntry[]) => Promise<PositionReceipt>;
  stage: (kind: "variants" | "observed", sequence: number, rows: unknown[]) => Promise<void>;
};

const BATCH_TARGET_BYTES = 1_000_000;
// A singleton source variant that fits the existing stage object can require a
// slightly larger registration envelope. This is metadata headroom only; the
// old stage/genetic payload limit and all file/decoded limits remain unchanged.
const REGISTRATION_MAXIMUM_BYTES = INGEST_CHUNK_MAXIMUM_BYTES + 1024;

/** PostgreSQL JSONB text uses a space after commas/colons and expands numeric
 * exponents. Compact JSON.stringify length alone undercounts the SQL limit. */
export function normalizationJsonbByteLength(value: unknown): number {
  if (value === null || value === undefined) return 4;
  if (typeof value === "string" || typeof value === "boolean") return Buffer.byteLength(JSON.stringify(value));
  if (typeof value === "number") {
    const encoded = JSON.stringify(value);
    const exponent = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/.exec(encoded);
    if (!exponent) return encoded.length;
    const digits = exponent[2].length + (exponent[3]?.length ?? 0);
    const point = exponent[2].length + Number(exponent[4]);
    return exponent[1].length + (point <= 0 ? 2 - point + digits : point >= digits ? point : digits + 1);
  }
  if (Array.isArray(value)) return 2 + value.reduce((sum, item) => sum + normalizationJsonbByteLength(item), 0)
    + Math.max(0, value.length - 1) * 2;
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    return 2 + entries.reduce((sum, [key, item]) => sum + Buffer.byteLength(JSON.stringify(key)) + 2 + normalizationJsonbByteLength(item), 0)
      + Math.max(0, entries.length - 1) * 2;
  }
  throw new IncrementalVcfError("unavailable");
}

/** All batches stay unpublished until the caller verifies the terminal summary,
 * complete byte hashes and current authority. Pending source positions target
 * one MB and at most one thousand rows; one individually valid large row can
 * exceed that target, bounded by the existing four-MB genetic stage payload.
 * The exact-claim database index owns cross-batch duplicate/conflict checks. */
export async function prepareIncrementalVcf(lines: AsyncIterable<string>, options: Options) {
  if (options.build === "GRCh37" && !options.lift) throw new IncrementalVcfError("unavailable");
  let current: PendingPosition | undefined;
  let batch: PendingPosition[] = [];
  let batchBytes = 0;
  let sequence = 0, variantSequence = 0, observedSequence = 0;
  let variantCount = 0, observedCallCount = 0, usableObserved = 0;
  let attempted = 0, unmapped = 0, summarySeen = false;

  async function flush() {
    if (!batch.length) return;
    const entries = batch.map(row => ({ source_chrom: row.chrom, source_pos: row.pos,
      variant: row.variant ?? null,
      mapped: options.build === "GRCh37" && row.chrom >= 1 && row.chrom <= 22
        ? Boolean(options.lift!(row.chrom, row.pos)) : null }));
    if (normalizationJsonbByteLength(entries) > REGISTRATION_MAXIMUM_BYTES) throw new IncrementalVcfError("unrecognised_format");
    const receipt = await options.register(sequence++, entries);
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || Object.keys(receipt).length !== 3
      || Object.keys(receipt).some(key => !["acceptedVariantOrdinals", "attempted", "unmapped"].includes(key))) {
      throw new IncrementalVcfError("unavailable");
    }
    const accepted = receipt.acceptedVariantOrdinals;
    if (!Array.isArray(accepted) || accepted.some((ordinal, index) =>
      !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= batch.length || !batch[ordinal].variant
      || (index > 0 && ordinal <= accepted[index - 1]))
      || !Number.isSafeInteger(receipt.attempted) || !Number.isSafeInteger(receipt.unmapped)
      || receipt.attempted < attempted || receipt.attempted > attempted + batch.length
      || receipt.unmapped < unmapped || receipt.unmapped > receipt.attempted
      || receipt.unmapped - unmapped > receipt.attempted - attempted
      || (options.build === "GRCh38" && (receipt.attempted !== 0 || receipt.unmapped !== 0))) {
      throw new IncrementalVcfError("unavailable");
    }
    attempted = receipt.attempted; unmapped = receipt.unmapped;
    const variants = accepted.flatMap(ordinal => {
      const source = batch[ordinal].variant!;
      const mapped = options.lift ? liftSingleBaseVariant(source, options.lift) : source;
      return mapped ? [mapped] : [];
    });
    const observed = batch.flatMap(row => {
      const source = row.observed;
      if (!source) return [];
      const normalized = options.lift ? liftSingleBaseVariant({ ...source,
        genotype: source.genotype === "--" ? `${source.ref}/${source.ref}` : source.genotype }, options.lift)
        : { ...source };
      if (!normalized) return [];
      if (source.genotype === "--") normalized.genotype = "--";
      if (source.usable) usableObserved++;
      return [{ source_line: source.line, source_chrom: source.chrom, source_pos: source.pos,
        source_ref: source.ref, source_alt: source.alt, source_gt: source.sourceGt,
        rsid: source.rsid, chrom: normalized.chrom, pos: normalized.pos, ref: normalized.ref, alt: normalized.alt,
        genotype: normalized.genotype, site_filter: source.filter, sample_filter: source.sampleFilter,
        genotype_quality: source.genotypeQuality, read_depth: source.depth, quality_state: source.quality,
        usable: source.usable }];
    });
    async function stageRows(kind: "variants" | "observed", rows: unknown[]) {
      let pending: unknown[] = [], bytes = 0;
      const nextSequence = () => kind === "variants" ? variantSequence : observedSequence;
      const payloadBytes = (rowBytes: number, count: number) =>
        normalizationJsonbByteLength({ kind, sequence: nextSequence(), rows: [] }) + rowBytes + Math.max(0, count - 1) * 2;
      async function send() {
        if (!pending.length) return;
        await options.stage(kind, nextSequence(), pending);
        if (kind === "variants") { variantSequence++; variantCount += pending.length; }
        else { observedSequence++; observedCallCount += pending.length; }
        pending = []; bytes = 0;
      }
      for (const row of rows) {
        const size = normalizationJsonbByteLength(row);
        if (payloadBytes(size, 1) > INGEST_CHUNK_MAXIMUM_BYTES) throw new IncrementalVcfError("unrecognised_format");
        if (pending.length && (pending.length === 1000 || payloadBytes(bytes + size, pending.length + 1) > BATCH_TARGET_BYTES)) await send();
        // A sequence crossing a decimal boundary changes the envelope size.
        if (payloadBytes(size, 1) > INGEST_CHUNK_MAXIMUM_BYTES) throw new IncrementalVcfError("unrecognised_format");
        pending.push(row); bytes += size;
      }
      await send();
    }
    await stageRows("variants", variants);
    await stageRows("observed", observed);
    batch = []; batchBytes = 0;
  }
  async function finishLine() {
    if (!current) return;
    const row = current; current = undefined;
    const size = normalizationJsonbByteLength(row);
    if (batch.length && batchBytes + size > BATCH_TARGET_BYTES) await flush();
    batch.push(row); batchBytes += size;
    if (batch.length === 1000 || batchBytes >= BATCH_TARGET_BYTES) await flush();
  }

  for await (const event of streamVcf(lines)) {
    if (event.type === "summary") {
      await finishLine();
      if (event.build !== options.build) throw new IncrementalVcfError("upload_integrity_mismatch");
      if (!event.observedCallsValid) throw new IncrementalVcfError("unrecognised_format");
      summarySeen = true;
      continue;
    }
    if (event.type === "reference") continue;
    const source = event.type === "variant" ? event.record : event.call;
    if (current && current.line !== event.line) await finishLine();
    current ??= { line: event.line, chrom: source.chrom, pos: source.pos };
    if (event.type === "variant") current.variant = event.record;
    else current.observed = event.call;
  }
  if (!summarySeen) throw new IncrementalVcfError("unavailable");
  await flush();
  if (attempted && unmapped / attempted > options.maximumUnmappedFraction) throw new IncrementalVcfError("liftover_loss");
  if (!variantCount && !usableObserved) throw new IncrementalVcfError("empty_after_parse");
  return { variantCount, observedCallCount, attempted, unmapped };
}
