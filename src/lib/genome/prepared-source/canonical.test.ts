import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildLiftover } from "../liftover";
import { streamVcf, type VcfParseEvent } from "../parsers/vcf";
import { prepareIncrementalVcf, type PositionEntry } from "../../uploads/incremental-vcf-normalization";
import { canonicalizePreparedEvents, type CanonicalOptions } from "./canonical";
import { canonicalBindingSchema, canonicalRecordSchema, canonicalSummarySchema,
  type CanonicalRecord, type CanonicalSummary } from "./canonical-schema";
import { syntheticSource } from "./fixtures";
import { createPreparedRuns, type PreparedRunReceipt } from "./runs";
import { mergePreparedRuns, type PreparedMergeSummary } from "./merge";
import type { PreparedEvent } from "./schema";

const header = (build = "GRCh38") => ["##fileformat=VCFv4.2", `##reference=${build}`,
  "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC"];
const row = (pos: number, gt = "0/1", chrom = "1", alt = "C", id = `rs${pos}`) =>
  `${chrom}\t${pos}\t${id}\tA\t${alt}\t50\tPASS\t.\tGT:GQ:DP\t${gt}:50:30`;
async function* lines(rows: string[], build = "GRCh38") { yield* header(build); yield* rows; }
async function* values<T>(items: T[]) { yield* items; }
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
// Two distinct source segments collide at target 101..120; third segment is
// negative-strand. X maps separately. All are actual buildLiftover chain inputs.
const chainBytes = Buffer.from([
  "chain 1 1 1000 + 0 20 1 1000 + 100 120 1", "20", "",
  "chain 1 1 1000 + 20 40 1 1000 + 100 120 2", "20", "",
  "chain 1 1 1000 + 40 60 1 1000 - 100 120 3", "20", "",
  "chain 1 X 1000 + 0 60 X 1000 + 100 160 4", "60", "",
].join("\n"));
const liftover = { chainBytes, sha256: sha(chainBytes) };
async function setup(rows: string[], build: "GRCh37" | "GRCh38" = "GRCh38") {
  const source = { ...syntheticSource, sourceBuild: build };
  const parsed: VcfParseEvent[] = [];
  for await (const event of streamVcf(lines(rows, build))) parsed.push(event);
  const events = parsed.filter((e): e is PreparedEvent => e.type !== "summary");
  const rank = { observed: 0, reference: 1, variant: 2 };
  events.sort((a, b) => {
    const x = a.type === "variant" ? a.record : a.call, y = b.type === "variant" ? b.record : b.call;
    return x.chrom - y.chrom || x.pos - y.pos || a.line - b.line || rank[a.type] - rank[b.type];
  });
  const summary = parsed.at(-1) as Extract<VcfParseEvent, { type: "summary" }>;
  const parserReceipt = { version: "prepared-runs-v1", state: "provisional", source, summary,
    runCount: 1, eventCount: events.length, blockCount: 1 };
  const merge: PreparedMergeSummary = { type: "merge-summary", version: "prepared-merge-v1", state: "provisional",
    source, inputRunSequences: [0], inputBlockCount: 1, eventCount: events.length,
    variantCount: summary.variantCount, referenceCallCount: summary.referenceCallCount, observedCallCount: summary.observedCallCount };
  const options: CanonicalOptions = { source, expectedParserRevision: source.parserRevision, parserReceipt,
    expectedMergeSummary: merge, maximumUnmappedFraction: 0.5, ...(build === "GRCh37" ? { liftover } : {}) };
  return { events, merge, options, input: () => values<PreparedEvent | PreparedMergeSummary>([...events, merge]) };
}
async function collect(input: AsyncIterable<PreparedEvent | PreparedMergeSummary>, options: CanonicalOptions) {
  const output = await Array.fromAsync(canonicalizePreparedEvents(input, options));
  return { records: output.filter((r): r is CanonicalRecord => r.type === "canonical-record"),
    summary: output.at(-1) as CanonicalSummary };
}
// Faithful model of 20260908125714 registration: JSONB-equal variants at each
// source position, first non-null variant, unique autosomal mapping counters.
// This is a parity oracle for the current normalizer, not a SQL execution claim.
async function legacy(rows: string[], build: "GRCh37" | "GRCh38") {
  const positions = new Map<string, PositionEntry>();
  let attempted = 0, unmapped = 0;
  const staged = { variants: [] as unknown[], observed: [] as unknown[] };
  const result = await prepareIncrementalVcf(lines(rows, build), { build,
    ...(build === "GRCh37" ? { lift: buildLiftover(chainBytes) } : {}), maximumUnmappedFraction: 0.5,
    register: async (_, entries) => {
      const acceptedVariantOrdinals: number[] = [];
      entries.forEach((entry, ordinal) => {
        const key = `${entry.source_chrom}:${entry.source_pos}`, prior = positions.get(key);
        if (prior && (prior.mapped !== entry.mapped || (prior.variant && entry.variant
          && JSON.stringify(prior.variant) !== JSON.stringify(entry.variant)))) throw new Error("position_conflict");
        if (!prior) {
          positions.set(key, structuredClone(entry));
          if (entry.mapped !== null) { attempted++; if (!entry.mapped) unmapped++; }
        }
        if (entry.variant && !prior?.variant) {
          acceptedVariantOrdinals.push(ordinal);
          positions.get(key)!.variant = entry.variant;
        }
      });
      return { acceptedVariantOrdinals, attempted, unmapped };
    }, stage: async (kind, _, entries) => { staged[kind].push(...entries); } });
  return { result, staged };
}
function normalized(records: CanonicalRecord[], kind: "variant" | "observed") {
  return records.flatMap(value => {
    if (value.event.type !== kind || value.normalization.status !== "normalized") return [];
    const mapped = value.normalization.record;
    if (value.event.type === "variant") return [mapped];
    const source = value.event.call;
    return [{ source_line: source.line, source_chrom: source.chrom, source_pos: source.pos,
      source_ref: source.ref, source_alt: source.alt, source_gt: source.sourceGt, ...mapped,
      site_filter: source.filter, sample_filter: source.sampleFilter, genotype_quality: source.genotypeQuality,
      read_depth: source.depth, quality_state: source.quality, usable: source.usable }];
  });
}
const sorted = (items: unknown[]) => items.map(value => JSON.stringify(value)).sort();

describe("canonical prepared source reducer", () => {
  it.each(["GRCh38", "GRCh37"] as const)("matches current incremental normalization for %s while retaining all source evidence", async build => {
    const rows = [row(45), row(1), row(2, "0/0"), row(3, "./."), row(1), row(21),
      row(22, "0/1", "1", "AC"), row(70), row(4).replace("PASS", "q10"),
      row(5).replace("50:30", "5:2"), row(6, "0/0", "1", "C", "."),
      row(7, "0/0", "1", "<NON_REF>"), row(8, "0/1", "X")];
    const fixture = await setup(rows, build), old = await legacy(rows, build);
    const current = await collect(fixture.input(), fixture.options);
    expect(current.records.map(r => r.event)).toEqual(fixture.events);
    expect(sorted(normalized(current.records, "variant"))).toEqual(sorted(old.staged.variants));
    expect(sorted(normalized(current.records, "observed"))).toEqual(sorted(old.staged.observed));
    expect(current.summary).toMatchObject(old.result);
    expect(canonicalSummarySchema.safeParse(current.summary).success).toBe(true);
    expect(current.records.filter(r => r.normalization.status === "duplicate")).toHaveLength(1);
    expect(current.records.filter(r => r.event.type === "reference").every(r => r.normalization.status === "source_reference")).toBe(true);
    if (build === "GRCh37") {
      expect(normalized(current.records, "variant").filter(r => r.pos === 101)).toHaveLength(2);
      expect(current.records.find(r => r.event.type === "variant" && r.event.record.pos === 22)?.normalization.status).toBe("unsupported_alleles");
      expect(current.summary.binding.liftoverSha256).toBe(liftover.sha256);
    }
  });

  it("keeps a near-cap long allele unchanged in GRCh38 without whole-file buffering", async () => {
    const fixture = await setup([row(1, "0/1", "1", "C".repeat(1_999_930), ".")]);
    const current = await collect(fixture.input(), fixture.options);
    expect(current.summary.variantCount).toBe(1);
    expect(normalized(current.records, "variant")[0].alt).toHaveLength(1_999_930);
  });
  it("maps no-calls and reverse alleles without changing source GT or quality", async () => {
    const fixture = await setup([row(41, "./."), row(42, "0/0"), row(43)], "GRCh37");
    const current = await collect(fixture.input(), fixture.options);
    expect(normalized(current.records, "observed")).toMatchObject([
      { source_gt: "./.", source_pos: 41, pos: 900, genotype: "--", usable: false },
      { source_gt: "0/0", source_pos: 42, pos: 899, ref: "T", alt: "G", genotype: "T/T" },
      { source_gt: "0/1", source_pos: 43, pos: 898, genotype: "G/T" }]);
  });
  it("pins the actual repository chain and preserves the existing caffeine mapping with original coordinates", async () => {
    const fixture = await setup(["15\t75041917\trs762551\tC\tA\t50\tPASS\t.\tGT:GQ:DP\t0/1:50:30"], "GRCh37");
    const bytes = readFileSync("data/ref/chain/GRCh37_to_GRCh38.chain.gz");
    const pinned = "351de3cd4a01d9fcffd38881981767b697090d2eba876740891b96d5c546b100";
    expect(sha(bytes)).toBe(pinned);
    fixture.options.liftover = { chainBytes: bytes, sha256: pinned };
    const output = await collect(fixture.input(), fixture.options);
    expect(output.summary.binding).toMatchObject({ source: { sourceBuild: "GRCh37" }, targetBuild: "GRCh38", liftoverSha256: pinned });
    expect(normalized(output.records, "observed")).toMatchObject([
      { source_chrom: 15, source_pos: 75041917, source_ref: "C", source_alt: "A", source_gt: "0/1",
        chrom: 15, pos: 74749576, ref: "C", alt: "A", genotype: "A/C" }]);
  });
  it("counts a position once even when reference observations precede its first variant", async () => {
    const fixture = await setup([row(1, "0/0"), row(1), row(1)], "GRCh37");
    const current = await collect(fixture.input(), fixture.options);
    expect(current.summary).toMatchObject({ attempted: 1, unmapped: 0, variantCount: 1, observedCallCount: 3 });
  });
  it("refuses a conflicting duplicate after already yielding provisional observations", async () => {
    const rows = [row(1), row(2), row(1, "1/1")], fixture = await setup(rows);
    const output: unknown[] = [];
    await expect((async () => { for await (const event of canonicalizePreparedEvents(fixture.input(), fixture.options)) output.push(event); })())
      .rejects.toMatchObject({ code: "position_conflict" });
    expect(output.length).toBeGreaterThan(0);
    expect(output.some(e => (e as { type: string }).type === "canonical-summary")).toBe(false);
    await expect(legacy(rows, "GRCh38")).rejects.toThrow("position_conflict");
  });
  it("detects cross-run duplicate conflict through real parser, blocks and merge", async () => {
    const rows = [row(1), ...Array.from({ length: 16000 }, (_, i) => row(i + 2)), row(1, "1/1")];
    const source = syntheticSource, blocks = new Map<number, Uint8Array>(), runs: PreparedRunReceipt[] = [];
    const parserReceipt = await createPreparedRuns(streamVcf(lines(rows)), { source, sink: {
      writeBlock: async ({ descriptor, compressed }) => { blocks.set(descriptor.sequence, compressed); return descriptor; },
      writeRun: async receipt => { runs.push(receipt); return receipt; },
    } });
    expect(runs).toHaveLength(2);
    const readBlock = async function* (d: { sequence: number }) { yield blocks.get(d.sequence)!; };
    // A bounded fixture can collect the expected receipt; production supplies
    // the verified final merge receipt from its immutable run graph.
    const merged = await Array.fromAsync(mergePreparedRuns(runs, { source, readBlock }));
    await expect(collect(mergePreparedRuns(runs, { source, readBlock }), { source,
      expectedParserRevision: source.parserRevision, parserReceipt, expectedMergeSummary: merged.at(-1), maximumUnmappedFraction: 0.1 }))
      .rejects.toMatchObject({ code: "position_conflict" });
  });
  it.each(["order", "missing", "extra", "counts", "version", "binding"])("refuses late %s failure without a canonical terminal", async mode => {
    const fixture = await setup([row(1), row(2)]);
    const events: Array<PreparedEvent | PreparedMergeSummary> = [...fixture.events, structuredClone(fixture.merge)];
    if (mode === "order") [events[0], events[1]] = [events[1], events[0]];
    if (mode === "missing") events.pop();
    if (mode === "extra") events.push(fixture.events[0]);
    if (mode === "counts") (events.at(-1) as PreparedMergeSummary).eventCount++;
    if (mode === "version") Object.assign(events.at(-1)!, { version: "prepared-merge-v2" });
    if (mode === "binding") (events.at(-1) as PreparedMergeSummary).source.rawSha256 = "f".repeat(64);
    await expect(collect(values(events), fixture.options)).rejects.toBeDefined();
  });
  it.each(["parser-version", "parser-source", "parser-invalid", "unknown-build", "merge-version", "chain-hash", "extra-chain"])(
    "refuses %s receipt before source consumption", async mode => {
      const fixture = await setup([row(1)], mode === "chain-hash" ? "GRCh37" : "GRCh38");
      if (mode === "parser-version") fixture.options.expectedParserRevision = "changed";
      if (mode === "parser-source") (fixture.options.parserReceipt as { source: { rawSha256: string } }).source = { ...fixture.options.source, rawSha256: "f".repeat(64) };
      if (mode === "parser-invalid") (fixture.options.parserReceipt as { summary: { observedCallsValid: boolean } }).summary.observedCallsValid = false;
      if (mode === "unknown-build") fixture.options.source = { ...fixture.options.source, sourceBuild: "unknown" };
      if (mode === "merge-version") Object.assign(fixture.options.expectedMergeSummary!, { version: "future" });
      if (mode === "chain-hash") fixture.options.liftover = { chainBytes, sha256: "0".repeat(64) };
      if (mode === "extra-chain") fixture.options.liftover = liftover;
      let read = false;
      async function* input() { read = true; yield* fixture.events; yield fixture.merge; }
      await expect(collect(input(), fixture.options)).rejects.toMatchObject({ code: "invalid_receipt" });
      expect(read).toBe(false);
    });
  it.each(["duplicate-header", "changed-build"])("rejects actual parser late %s invalidation", async mode => {
    const fixture = await setup([row(1), mode === "duplicate-header" ? header()[2] : "##reference=GRCh37"]);
    await expect(collect(fixture.input(), fixture.options)).rejects.toMatchObject({ code: "invalid_receipt" });
  });
  it.each(["empty", "loss"])("keeps %s refusal identical to current normalizer", async mode => {
    const rows = mode === "empty" ? [row(1, "./.")] : [row(1), row(70), row(71)];
    const fixture = await setup(rows, "GRCh37");
    const code = mode === "empty" ? "empty_after_parse" : "liftover_loss";
    await expect(collect(fixture.input(), fixture.options)).rejects.toMatchObject({ code });
    await expect(legacy(rows, "GRCh37")).rejects.toMatchObject({ code });
  });
  it("does not count source-only reference positions as attempted mapping", async () => {
    const fixture = await setup([row(1), row(70, "0/0", "1", "C", ".")], "GRCh37");
    expect((await collect(fixture.input(), fixture.options)).summary).toMatchObject({ attempted: 1, unmapped: 0 });
  });
  it("uses yield backpressure and closes on consumer cancellation without prefetch", async () => {
    const fixture = await setup([row(1), row(2)]); let reads = 0, closed = false;
    async function* input() { try { for (const event of fixture.events) { reads++; yield event; } yield fixture.merge; } finally { closed = true; } }
    const iterator = canonicalizePreparedEvents(input(), fixture.options);
    await iterator.next(); expect(reads).toBe(1);
    await iterator.return(); expect(reads).toBe(1); expect(closed).toBe(true);
  });
  it("does not let downstream mutation change the duplicate comparison", async () => {
    const fixture = await setup([row(1), row(1)]), iterator = canonicalizePreparedEvents(fixture.input(), fixture.options);
    await iterator.next(); const first = (await iterator.next()).value as CanonicalRecord;
    if (first.event.type === "variant") first.event.record.genotype = "bad";
    const rest = await Array.fromAsync(iterator);
    expect(rest.some(e => e.type === "canonical-record" && e.normalization.status === "duplicate")).toBe(true);
  });
  it("observes a started rejection when producer aborts synchronously; cleanup cannot mask abort", async () => {
    const fixture = await setup([row(1)]), controller = new AbortController();
    const input = { [Symbol.asyncIterator]: () => ({ next: () => {
      controller.abort(); return Promise.reject(new Error("producer rejection"));
    }, return: () => { throw new Error("cleanup"); } }) };
    await expect(collect(input, { ...fixture.options, signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  it("cancels pending input without waiting for uncooperative producer cleanup", async () => {
    const fixture = await setup([row(1)]), controller = new AbortController(), pending = Promise.withResolvers<IteratorResult<PreparedEvent>>();
    const closing = vi.fn(() => new Promise<IteratorResult<PreparedEvent>>(() => {}));
    const input = { [Symbol.asyncIterator]: () => ({ next: () => pending.promise, return: closing }) };
    const result = collect(input, { ...fixture.options, signal: controller.signal });
    controller.abort(); await expect(result).rejects.toMatchObject({ code: "aborted" });
    expect(closing).toHaveBeenCalledOnce(); pending.reject(new Error("late rejection"));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  it("propagates EOF integrity failure and suppresses cleanup failure", async () => {
    const fixture = await setup([row(1)]), failure = new Error("raw hash mismatch");
    let index = 0;
    const input = { [Symbol.asyncIterator]: () => ({ next: async () => {
      const value = [...fixture.events, fixture.merge][index++];
      if (value) return { value, done: false as const }; throw failure;
    }, return: async () => { throw new Error("cleanup"); } }) };
    await expect(collect(input, fixture.options)).rejects.toBe(failure);
  });
  it("closed representations refuse unknown fields, wrong versions and source reference reinterpretation", async () => {
    const fixture = await setup([row(1), row(2, "0/0")]);
    const output = await collect(fixture.input(), fixture.options);
    expect(canonicalRecordSchema.safeParse({ ...output.records[0], url: "https://untrusted.invalid" }).success).toBe(false);
    expect(canonicalRecordSchema.safeParse({ ...output.records[0], version: "future" }).success).toBe(false);
    const reference = output.records.find(r => r.event.type === "reference")!;
    expect(canonicalRecordSchema.safeParse({ ...reference, normalization: output.records[0].normalization }).success).toBe(false);
    expect(canonicalBindingSchema.safeParse({ ...output.summary.binding, source: { ...fixture.options.source, sourceBuild: "GRCh37" } }).success).toBe(false);
    const changed = structuredClone(output.records[0]);
    if (changed.normalization.status === "normalized") changed.normalization.record.rsid = 999;
    expect(canonicalRecordSchema.safeParse(changed).success).toBe(false);
    const terminal = structuredClone(output.summary);
    terminal.parserReceipt.source.fileId = "33333333-3333-4333-8333-333333333333";
    expect(canonicalSummarySchema.safeParse(terminal).success).toBe(false);
    expect(canonicalSummarySchema.safeParse({ ...output.summary, variantCount: 100 }).success).toBe(false);
  });
});
