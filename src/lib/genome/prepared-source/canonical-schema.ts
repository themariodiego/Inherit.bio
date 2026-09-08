import { z } from "zod";
import { preparedEventSchema, preparedParserSummarySchema, preparedSourceBindingSchema,
  PREPARED_BLOCK_MAX_DECODED_BYTES } from "./schema";

const integer = z.number().int().nonnegative().safe();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const text = z.string().max(PREPARED_BLOCK_MAX_DECODED_BYTES);
const variant = z.object({ rsid: integer.nullable(), chrom: integer.positive().max(25),
  pos: integer.positive(), ref: text.nullable(), alt: text.nullable(), genotype: text }).strict();

/** Integrity binding, NOT permission or a publication receipt. Store once in the
 * containing block/terminal envelope; a detached record has no source authority. */
export const canonicalBindingSchema = z.object({ version: z.literal("prepared-canonical-v1"),
  source: preparedSourceBindingSchema, targetBuild: z.literal("GRCh38"),
  liftoverSha256: hash.nullable() }).strict().refine(binding =>
  binding.source.sourceBuild === "GRCh38" ? binding.liftoverSha256 === null
    : binding.source.sourceBuild === "GRCh37" && binding.liftoverSha256 !== null,
"A known source build and its exact mapping identity are required");
export type CanonicalBinding = z.infer<typeof canonicalBindingSchema>;

export const canonicalRecordSchema = z.object({ type: z.literal("canonical-record"),
  version: z.literal("prepared-canonical-v1"), event: preparedEventSchema,
  normalization: z.discriminatedUnion("status", [
    z.object({ status: z.literal("normalized"), record: variant }).strict(),
    z.object({ status: z.literal("duplicate"), firstSourceLine: integer.positive() }).strict(),
    z.object({ status: z.literal("unmapped") }).strict(),
    z.object({ status: z.literal("unsupported_alleles") }).strict(),
    z.object({ status: z.literal("source_reference") }).strict(),
  ]) }).strict().refine(value => {
  const status = value.normalization.status;
  if (value.event.type === "reference") return status === "source_reference";
  if (status === "source_reference") return false;
  if (status === "normalized") {
    const original = value.event.type === "variant" ? value.event.record : value.event.call;
    if (value.normalization.record.rsid !== original.rsid
      || (original.genotype === "--") !== (value.normalization.record.genotype === "--")) return false;
  }
  return status !== "duplicate" || (value.event.type === "variant"
    && value.normalization.firstSourceLine <= value.event.line);
}, "Disposition must match original event provenance");
export type CanonicalRecord = z.infer<typeof canonicalRecordSchema>;

export const canonicalParserReceiptSchema = z.object({ version: z.literal("prepared-runs-v1"),
  state: z.literal("provisional"), source: preparedSourceBindingSchema,
  summary: preparedParserSummarySchema, runCount: integer, eventCount: integer, blockCount: integer,
}).strict().refine(value => value.summary.observedCallsValid && value.summary.build === value.source.sourceBuild
  && value.eventCount === value.summary.variantCount + value.summary.observedCallCount + value.summary.referenceCallCount
  && value.runCount >= 1 && value.blockCount >= value.runCount && value.blockCount <= value.eventCount,
"Parser receipt must describe a complete valid nonempty source");
export const canonicalMergeSummarySchema = z.object({ type: z.literal("merge-summary"),
  version: z.literal("prepared-merge-v1"), state: z.literal("provisional"),
  source: preparedSourceBindingSchema, inputRunSequences: z.array(integer).min(1).max(8),
  inputBlockCount: integer.positive(), eventCount: integer.positive(), variantCount: integer,
  referenceCallCount: integer, observedCallCount: integer,
}).strict().refine(value => value.inputRunSequences.every((sequence, index, all) =>
  index === 0 || sequence > all[index - 1]) && value.inputBlockCount >= value.inputRunSequences.length
  && value.inputBlockCount <= value.eventCount
  && value.eventCount === value.variantCount + value.observedCallCount + value.referenceCallCount,
"Merge counts and ordered unique input sequences must match");
export const canonicalSummarySchema = z.object({ type: z.literal("canonical-summary"),
  version: z.literal("prepared-canonical-v1"), state: z.literal("provisional"),
  binding: canonicalBindingSchema, parserReceipt: canonicalParserReceiptSchema,
  mergeSummary: canonicalMergeSummarySchema, eventCount: integer,
  variantCount: integer, observedCallCount: integer, usableObservedCount: integer,
  attempted: integer, unmapped: integer,
}).strict().refine(value => {
  const parser = value.parserReceipt, merge = value.mergeSummary;
  return JSON.stringify(value.binding.source) === JSON.stringify(parser.source)
    && JSON.stringify(parser.source) === JSON.stringify(merge.source)
    && value.eventCount === parser.eventCount && value.eventCount === merge.eventCount
    && parser.summary.variantCount === merge.variantCount
    && parser.summary.observedCallCount === merge.observedCallCount
    && parser.summary.referenceCallCount === merge.referenceCallCount
    && value.variantCount <= merge.variantCount && value.observedCallCount <= merge.observedCallCount
    && value.usableObservedCount <= value.observedCallCount && value.unmapped <= value.attempted
    && value.attempted <= merge.variantCount + merge.observedCallCount
    && (value.binding.source.sourceBuild !== "GRCh38" || (value.attempted === 0 && value.unmapped === 0))
    && (value.variantCount > 0 || value.usableObservedCount > 0);
}, "Canonical terminal counts and exact source receipts must agree");
export type CanonicalSummary = z.infer<typeof canonicalSummarySchema>;
