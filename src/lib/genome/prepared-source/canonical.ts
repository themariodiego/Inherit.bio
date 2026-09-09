import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { buildLiftover, liftSingleBaseVariant } from "../liftover";
import type { VariantRecord } from "../types";
import type { PreparedMergeSummary } from "./merge";
import { PREPARED_RUN_MAX_EVENT_BYTES } from "./runs";
import { preparedEventSchema, preparedSourceBindingSchema, type PreparedEvent,
  type PreparedSourceBinding } from "./schema";
import { canonicalBindingSchema, canonicalMergeSummarySchema, canonicalParserReceiptSchema, canonicalRecordSchema,
  type CanonicalRecord, type CanonicalSummary } from "./canonical-schema";

export class PreparedCanonicalError extends Error {
  constructor(readonly code: "invalid_receipt" | "invalid_event" | "out_of_order" | "position_conflict"
    | "invalid_summary" | "liftover_loss" | "empty_after_parse" | "aborted") {
    super(code); this.name = "PreparedCanonicalError";
  }
}
function fail(code: PreparedCanonicalError["code"]): never { throw new PreparedCanonicalError(code); }
const rank = { observed: 0, reference: 1, variant: 2 } as const;
type Key = [number, number, number, number];
function key(event: PreparedEvent): Key {
  const record = event.type === "variant" ? event.record : event.call;
  return [record.chrom, record.pos, event.line, rank[event.type]];
}
function compare(a: Key, b: Key) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) fail("aborted"); }
async function abortable<T>(started: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) { void started.catch(() => {}); return fail("aborted"); }
  if (!signal) return started;
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new PreparedCanonicalError("aborted"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([started, cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}
function core(record: VariantRecord): VariantRecord {
  return { rsid: record.rsid, chrom: record.chrom, pos: record.pos,
    ref: record.ref, alt: record.alt, genotype: record.genotype };
}

export type CanonicalOptions = {
  source: PreparedSourceBinding;
  /** Trusted caller's pinned current parser revision, never a request override. */
  expectedParserRevision: string;
  parserReceipt: unknown;
  expectedMergeSummary: unknown;
  maximumUnmappedFraction: number;
  /** Trusted reference input + pinned hash, not an uploaded/request-supplied mapper. */
  liftover?: { chainBytes: Uint8Array; sha256: string };
  signal?: AbortSignal;
};

/** Normalize source-coordinate/line/type sorted, verified merge events. ALL
 * records remain provisional until terminal summary AND actual EOF. Any failure
 * invalidates every emitted record; caller owns artifact cleanup/publication.
 * Receipts bind integrity only: no actor/store/purpose authorization is done here.
 * Source hashes and merge completeness must have been verified by the upstream
 * pipeline, not inferred from caller-provided strings.
 *
 * Holds one input event, its bounded output and the first variant at the current
 * SOURCE position, plus the existing reference-chain index (no all-call map).
 * Observed/reference duplicates stream through, even when a later variant fails.
 * Output is source-sorted, NOT target-sorted after liftover; mapped collisions
 * stay distinct. References are source evidence only, matching current normalizer
 * exclusion; only normalized dispositions may supply GRCh38 reader calls.
 * Yield backpressure prevents reading another event until the consumer resumes.
 */
export async function* canonicalizePreparedEvents(
  events: AsyncIterable<PreparedEvent | PreparedMergeSummary>, options: CanonicalOptions,
): AsyncGenerator<CanonicalRecord | CanonicalSummary, void, unknown> {
  const { signal } = options;
  checkAbort(signal);
  const parsedSource = preparedSourceBindingSchema.safeParse(options.source);
  const parser = canonicalParserReceiptSchema.safeParse(options.parserReceipt);
  // Guard array cardinality before Zod clones a potentially unbounded receipt.
  const rawMerge = options.expectedMergeSummary as Partial<PreparedMergeSummary> | null;
  if (!rawMerge || !Array.isArray(rawMerge.inputRunSequences) || rawMerge.inputRunSequences.length > 8) fail("invalid_receipt");
  const merged = canonicalMergeSummarySchema.safeParse(rawMerge);
  if (!parsedSource.success || !parser.success || !merged.success) fail("invalid_receipt");
  const source = parsedSource.data, parserReceipt = parser.data, expectedMerge = merged.data;
  const summary = parserReceipt.summary;
  if (source.sourceBuild === "unknown" || source.parserRevision !== options.expectedParserRevision
    || !Number.isFinite(options.maximumUnmappedFraction) || options.maximumUnmappedFraction < 0 || options.maximumUnmappedFraction > 1
    || !isDeepStrictEqual(source, parserReceipt.source) || !isDeepStrictEqual(source, expectedMerge.source)
    || summary.build !== source.sourceBuild || !summary.observedCallsValid
    || parserReceipt.eventCount !== summary.variantCount + summary.observedCallCount + summary.referenceCallCount
    || parserReceipt.eventCount !== expectedMerge.eventCount || parserReceipt.runCount < 1
    || parserReceipt.blockCount < parserReceipt.runCount || parserReceipt.blockCount > parserReceipt.eventCount
    || expectedMerge.inputBlockCount < expectedMerge.inputRunSequences.length
    || expectedMerge.inputBlockCount > expectedMerge.eventCount
    || summary.variantCount !== expectedMerge.variantCount || summary.observedCallCount !== expectedMerge.observedCallCount
    || summary.referenceCallCount !== expectedMerge.referenceCallCount) fail("invalid_receipt");
  if (source.sourceBuild === "GRCh37") {
    if (!options.liftover || !/^[0-9a-f]{64}$/.test(options.liftover.sha256)
      || createHash("sha256").update(options.liftover.chainBytes).digest("hex") !== options.liftover.sha256) fail("invalid_receipt");
  } else if (options.liftover !== undefined) fail("invalid_receipt");
  const binding = canonicalBindingSchema.parse({ version: "prepared-canonical-v1", source,
    targetBuild: "GRCh38", liftoverSha256: options.liftover?.sha256 ?? null });
  const lift = options.liftover ? buildLiftover(options.liftover.chainBytes) : undefined;
  const iterator = events[Symbol.asyncIterator]();
  let exhausted = false, terminal = false, previous: Key | undefined;
  let position: { chrom: number; pos: number; counted: boolean; variant?: VariantRecord; line?: number } | undefined;
  let eventCount = 0, variantCount = 0, observedCallCount = 0, usableObservedCount = 0, attempted = 0, unmapped = 0;
  const counts = { variant: 0, observed: 0, reference: 0 };
  try {
    while (true) {
      checkAbort(signal);
      const next = await abortable(Promise.resolve(iterator.next()), signal);
      checkAbort(signal);
      if (next.done) { exhausted = true; break; }
      if (terminal) fail("invalid_summary");
      if (next.value?.type === "merge-summary") {
        const value = next.value;
        if (!Array.isArray(value.inputRunSequences) || value.inputRunSequences.length > 8) fail("invalid_summary");
        const parsed = canonicalMergeSummarySchema.safeParse(value);
        if (!parsed.success || !isDeepStrictEqual(parsed.data, expectedMerge)
          || eventCount !== expectedMerge.eventCount || counts.variant !== summary.variantCount
          || counts.observed !== summary.observedCallCount || counts.reference !== summary.referenceCallCount) fail("invalid_summary");
        terminal = true; continue; // Actual EOF is part of the receipt, not merely the terminal tag.
      }
      const parsed = preparedEventSchema.safeParse(next.value);
      if (!parsed.success) fail("invalid_event");
      const event = parsed.data;
      if (Buffer.byteLength(JSON.stringify(event)) > PREPARED_RUN_MAX_EVENT_BYTES) fail("invalid_event");
      const current = key(event);
      if (previous && compare(previous, current) > 0) fail("out_of_order");
      previous = current;
      if (!position || position.chrom !== current[0] || position.pos !== current[1]) {
        position = { chrom: current[0], pos: current[1], counted: false };
      }
      counts[event.type]++; eventCount++;
      if (eventCount > expectedMerge.eventCount || !Number.isSafeInteger(eventCount)) fail("invalid_summary");
      let normalization: CanonicalRecord["normalization"];
      if (event.type === "reference") normalization = { status: "source_reference" };
      else {
        if (!position.counted) {
          position.counted = true;
          if (lift && position.chrom <= 22) {
            attempted++; if (!lift(position.chrom, position.pos)) unmapped++;
          }
        }
        if (event.type === "variant" && position.variant) {
          if (!isDeepStrictEqual(position.variant, event.record)) fail("position_conflict");
          normalization = { status: "duplicate", firstSourceLine: position.line! };
        } else {
          const original = event.type === "variant" ? event.record : event.call;
          if (event.type === "variant") { position.variant = structuredClone(event.record); position.line = event.line; }
          const noCall = event.type === "observed" && original.genotype === "--";
          const toMap = core(original);
          if (noCall) toMap.genotype = `${original.ref}/${original.ref}`;
          const mapped = lift ? liftSingleBaseVariant(toMap, lift) : core(original);
          if (!mapped) {
            // Helper checks allele support before point mapping; preserve that order.
            const supported = liftSingleBaseVariant(toMap, (chrom, pos) => ({ chrom, pos, strand: 1 }));
            normalization = { status: supported ? "unmapped" : "unsupported_alleles" };
          } else {
            if (noCall) mapped.genotype = "--";
            normalization = { status: "normalized", record: mapped };
            if (event.type === "variant") variantCount++;
            else { observedCallCount++; if (event.call.usable) usableObservedCount++; }
          }
        }
      }
      const output = canonicalRecordSchema.safeParse({ type: "canonical-record", version: "prepared-canonical-v1", event, normalization });
      if (!output.success) fail("invalid_event");
      yield output.data;
    }
    if (!terminal) fail("invalid_summary");
    if (attempted && unmapped / attempted > options.maximumUnmappedFraction) fail("liftover_loss");
    if (!variantCount && !usableObservedCount) fail("empty_after_parse");
    checkAbort(signal);
    yield { type: "canonical-summary", version: "prepared-canonical-v1", state: "provisional", binding,
      parserReceipt, mergeSummary: expectedMerge, eventCount, variantCount, observedCallCount, usableObservedCount, attempted, unmapped };
  } finally {
    if (!exhausted && iterator.return) {
      try {
        const closing = Promise.resolve(iterator.return());
        if (signal?.aborted) void closing.catch(() => {});
        else await abortable(closing, signal);
      } catch { /* Producer cleanup cannot mask the original failure. */ }
    }
  }
}
