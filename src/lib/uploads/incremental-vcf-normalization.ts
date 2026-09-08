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

/** All batches stay unpublished until the caller verifies the terminal summary,
 * complete byte hashes and current authority. Only one thousand source lines,
 * their mapped rows and the parser's current line are retained in memory.
 * The exact-claim database index owns cross-batch duplicate/conflict checks. */
export async function prepareIncrementalVcf(lines: AsyncIterable<string>, options: Options) {
  if (options.build === "GRCh37" && !options.lift) throw new IncrementalVcfError("unavailable");
  let current: PendingPosition | undefined;
  let batch: PendingPosition[] = [];
  let sequence = 0, variantSequence = 0, observedSequence = 0;
  let variantCount = 0, observedCallCount = 0, usableObserved = 0;
  let attempted = 0, unmapped = 0, summarySeen = false;

  async function flush() {
    if (!batch.length) return;
    const entries = batch.map(row => ({ source_chrom: row.chrom, source_pos: row.pos,
      variant: row.variant ?? null,
      mapped: options.build === "GRCh37" && row.chrom >= 1 && row.chrom <= 22
        ? Boolean(options.lift!(row.chrom, row.pos)) : null }));
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
    if (variants.length) { await options.stage("variants", variantSequence++, variants); variantCount += variants.length; }
    if (observed.length) { await options.stage("observed", observedSequence++, observed); observedCallCount += observed.length; }
    batch = [];
  }
  async function finishLine() {
    if (!current) return;
    batch.push(current); current = undefined;
    if (batch.length === 1000) await flush();
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
