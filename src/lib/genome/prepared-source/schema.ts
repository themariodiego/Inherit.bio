import { z } from "zod";
import type { VcfParseEvent } from "../parsers/vcf";

// One bounded block, not a whole-file container. Extra room accommodates the
// source/column envelope around an existing near-four-MB long-allele singleton.
export const PREPARED_BLOCK_MAX_DECODED_BYTES = 4_016_384;
export const PREPARED_BLOCK_MAX_COMPRESSED_BYTES = PREPARED_BLOCK_MAX_DECODED_BYTES + 65_536;
export const PREPARED_BLOCK_MAX_EVENTS = 2_000;
const integer = z.number().int().nonnegative().safe();
const positive = integer.positive();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const build = z.enum(["GRCh37", "GRCh38", "unknown"]);
const text = z.string().max(PREPARED_BLOCK_MAX_DECODED_BYTES);
const chrom = positive.max(25);
const variant = z.object({ rsid: integer.nullable(), chrom, pos: positive,
  ref: text.nullable(), alt: text.nullable(), genotype: text }).strict();
const reference = z.object({ chrom, pos: positive, genotype: text, ref: text }).strict();
const observed = variant.extend({ line: positive, sourceGt: text.nullable(), filter: text.nullable(),
  sampleFilter: text.nullable(), genotypeQuality: z.number().finite().nonnegative().nullable(),
  depth: z.number().finite().nonnegative().nullable(), quality: z.enum(["pass", "unknown", "failed"]),
  usable: z.boolean() }).strict();

export const preparedEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("variant"), line: positive, record: variant }).strict(),
  z.object({ type: z.literal("reference"), line: positive, call: reference }).strict(),
  z.object({ type: z.literal("observed"), line: positive, call: observed }).strict(),
]).refine(event => event.type !== "observed" || event.call.line === event.line,
  "Observation and event source lines must match");
export type PreparedEvent = Exclude<VcfParseEvent, { type: "summary" }>;

// Storage integrity bindings only: this is not an authorization receipt.
export const preparedSourceBindingSchema = z.object({ fileId: z.uuid(), subjectId: z.uuid(),
  sourceRevision: positive, rawSha256: hash, decodedSha256: hash, sourceBuild: build,
  parserRevision: z.string().min(1).max(128) }).strict();
export type PreparedSourceBinding = z.infer<typeof preparedSourceBindingSchema>;
export const preparedParserSummarySchema = z.object({ type: z.literal("summary"), build,
  skipped: integer, variantCount: integer, referenceCallCount: integer, observedCallCount: integer,
  observedCallsValid: z.boolean() }).strict();

const column = <T extends z.ZodType>(item: T) => z.array(item).min(1).max(PREPARED_BLOCK_MAX_EVENTS);
export const preparedColumnsSchema = z.object({
  kind: column(z.enum(["variant", "reference", "observed"])), line: column(positive),
  rsid: column(integer.nullable()), chrom: column(chrom), pos: column(positive),
  ref: column(text.nullable()), alt: column(text.nullable()), genotype: column(text),
  sourceGt: column(text.nullable()), filter: column(text.nullable()), sampleFilter: column(text.nullable()),
  genotypeQuality: column(z.number().finite().nonnegative().nullable()),
  depth: column(z.number().finite().nonnegative().nullable()),
  quality: column(z.enum(["pass", "unknown", "failed"]).nullable()), usable: column(z.boolean().nullable()),
}).strict().refine(columns => Object.values(columns).every(values => values.length === columns.kind.length),
  "Column lengths must match");
export type PreparedColumns = z.infer<typeof preparedColumnsSchema>;
export const preparedBlockSchema = z.object({ version: z.literal("prepared-events-columnar-v1"),
  // Even valid blocks may contain observations invalidated by a later header.
  // Only a future writer's verified terminal summary can authorize publication.
  state: z.literal("provisional"), source: preparedSourceBindingSchema, sequence: integer,
  columns: preparedColumnsSchema }).strict();
export const preparedBlockDescriptorSchema = z.object({ version: z.literal("prepared-events-columnar-v1"),
  compression: z.literal("gzip"), source: preparedSourceBindingSchema, sequence: integer,
  eventCount: positive.max(PREPARED_BLOCK_MAX_EVENTS),
  compressedBytes: positive.max(PREPARED_BLOCK_MAX_COMPRESSED_BYTES),
  decodedBytes: positive.max(PREPARED_BLOCK_MAX_DECODED_BYTES), compressedSha256: hash, decodedSha256: hash,
}).strict();
export type PreparedBlockDescriptor = z.infer<typeof preparedBlockDescriptorSchema>;
