import { INGEST_CHUNK_MAXIMUM_BYTES } from "../genome/ingest-limits";
import { arrayFields, arrayRow, type ArrayKind } from "../genome/parsers/array";
import { liftSingleBaseVariant } from "../genome/liftover";
import type { VariantRecord } from "../genome/types";
import { normalizationJsonbByteLength, type PositionEntry, type PositionReceipt } from "./incremental-vcf-normalization";

export class IncrementalArrayError extends Error {
  constructor(readonly code: "unavailable" | "unrecognised_format" | "upload_integrity_mismatch" |
    "empty_after_parse" | "liftover_loss") { super(code); }
}
type Options = {
  kind: ArrayKind; build: "GRCh37" | "GRCh38";
  lift?: Parameters<typeof liftSingleBaseVariant>[1];
  maximumUnmappedFraction: number;
  register: (sequence: number, entries: PositionEntry[]) => Promise<PositionReceipt>;
  stage: (kind: "variants" | "observed", sequence: number, rows: unknown[]) => Promise<void>;
};
const TARGET_BYTES = 1_000_000;

/** Literal array calls only. The exact-claim native position index owns every
 * cross-batch duplicate/conflict; memory holds at most one bounded batch.
 * Nothing here invents reference alleles, VCF quality or a covered no-call. */
export async function prepareIncrementalArray(lines: AsyncIterable<string>, options: Options) {
  if (!Number.isFinite(options.maximumUnmappedFraction) || options.maximumUnmappedFraction < 0
    || options.maximumUnmappedFraction > 1 || (options.build === "GRCh37" && !options.lift)) {
    throw new IncrementalArrayError("unavailable");
  }
  let batch: VariantRecord[] = [], bytes = 0, sequence = 0, variantSequence = 0;
  let variantCount = 0, attempted = 0, unmapped = 0;
  const builds = new Set<string>();
  async function flush() {
    if (!batch.length) return;
    const entries: PositionEntry[] = batch.map(variant => ({ source_chrom: variant.chrom,
      source_pos: variant.pos, variant,
      mapped: options.build === "GRCh37" && variant.chrom >= 1 && variant.chrom <= 22
        ? Boolean(options.lift!(variant.chrom, variant.pos)) : null }));
    if (normalizationJsonbByteLength(entries) > INGEST_CHUNK_MAXIMUM_BYTES + 1024) {
      throw new IncrementalArrayError("unrecognised_format");
    }
    const receipt = await options.register(sequence++, entries);
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || Object.keys(receipt).length !== 3
      || Object.keys(receipt).some(key => !["acceptedVariantOrdinals", "attempted", "unmapped"].includes(key))) {
      throw new IncrementalArrayError("unavailable");
    }
    const accepted = receipt.acceptedVariantOrdinals;
    if (!Array.isArray(accepted) || accepted.some((ordinal, index) =>
      !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= batch.length
      || (index > 0 && ordinal <= accepted[index - 1]))
      || !Number.isSafeInteger(receipt.attempted) || !Number.isSafeInteger(receipt.unmapped)
      || receipt.attempted < attempted || receipt.attempted > attempted + batch.length
      || receipt.unmapped < unmapped || receipt.unmapped > receipt.attempted
      || receipt.unmapped - unmapped > receipt.attempted - attempted
      || (options.build === "GRCh38" && (receipt.attempted !== 0 || receipt.unmapped !== 0))) {
      throw new IncrementalArrayError("unavailable");
    }
    attempted = receipt.attempted; unmapped = receipt.unmapped;
    const rows = accepted.flatMap(ordinal => {
      const record = batch[ordinal];
      const mapped = options.build === "GRCh37" ? liftSingleBaseVariant(record, options.lift!) : record;
      return mapped ? [mapped] : [];
    });
    let pending: VariantRecord[] = [], pendingBytes = 0;
    const envelope = (size: number, count: number) => normalizationJsonbByteLength({ kind: "variants",
      sequence: variantSequence, rows: [] }) + size + Math.max(0, count - 1) * 2;
    async function send() {
      if (!pending.length) return;
      await options.stage("variants", variantSequence++, pending);
      variantCount += pending.length; pending = []; pendingBytes = 0;
    }
    for (const record of rows) {
      const size = normalizationJsonbByteLength(record);
      if (envelope(size, 1) > INGEST_CHUNK_MAXIMUM_BYTES) throw new IncrementalArrayError("unrecognised_format");
      if (pending.length && (pending.length === 1000 || envelope(pendingBytes + size, pending.length + 1) > TARGET_BYTES)) await send();
      if (envelope(size, 1) > INGEST_CHUNK_MAXIMUM_BYTES) throw new IncrementalArrayError("unrecognised_format");
      pending.push(record); pendingBytes += size;
    }
    await send(); batch = []; bytes = 0;
  }
  for await (const raw of lines) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line) continue;
    if (line.startsWith("#")) {
      for (const match of line.matchAll(/(build\s*|GRCh|hg)(\d+)/gi)) {
        const number = match[1].toLowerCase() === "hg" && match[2] === "19" ? "37" : match[2];
        builds.add(number === "38" ? "GRCh38" : number === "37" ? "GRCh37" : "unknown");
      }
      continue;
    }
    const fields = arrayFields(line, options.kind);
    if (fields[0]?.toLowerCase() === "rsid") continue;
    const record = arrayRow(fields, options.kind);
    // Same literal parser policy as parseArray: unsupported readings/no-calls
    // supply no variant and do not become observed-quality evidence.
    if (typeof record === "string") continue;
    const size = normalizationJsonbByteLength(record);
    if (batch.length && bytes + size > TARGET_BYTES) await flush();
    batch.push(record); bytes += size;
    if (batch.length === 1000 || bytes >= TARGET_BYTES) await flush();
  }
  const build = builds.size === 0 ? "GRCh37" : builds.size === 1 ? [...builds][0] : "unknown";
  if (build !== options.build) throw new IncrementalArrayError("upload_integrity_mismatch");
  await flush();
  if (attempted && unmapped / attempted > options.maximumUnmappedFraction) throw new IncrementalArrayError("liftover_loss");
  if (!variantCount) throw new IncrementalArrayError("empty_after_parse");
  return { variantCount, observedCallCount: 0, attempted, unmapped };
}
