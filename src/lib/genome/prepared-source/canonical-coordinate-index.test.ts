import { describe, expect, it } from "vitest";
import { encodeCanonicalBlock, type CanonicalBlockDescriptor } from "./canonical-codec";
import type { CanonicalBinding, CanonicalRecord } from "./canonical-schema";
import { syntheticSource } from "./fixtures";
import { buildCanonicalCoordinateEntry, createCanonicalCoordinateIndexBuilder, describeCanonicalCoordinateIndex,
  selectCanonicalCoordinateBlocks, validateCanonicalCoordinateIndex, type CanonicalCoordinateIndex } from "./canonical-coordinate-index";

const binding: CanonicalBinding = { version: "prepared-canonical-v1", source: { ...syntheticSource, sourceBuild: "GRCh37" },
  targetBuild: "GRCh38", liftoverSha256: "f".repeat(64) };
async function* chunks(bytes: Uint8Array) { yield bytes.subarray(0, 3); yield bytes.subarray(3); }
function normalized(sourcePos: number, targetPos = sourcePos, chrom = 1): CanonicalRecord {
  const record = { rsid: sourcePos, chrom: 1, pos: sourcePos, ref: "A", alt: "C", genotype: "A/C" };
  return { type: "canonical-record", version: "prepared-canonical-v1", event: { type: "variant", line: sourcePos + 3, record },
    normalization: { status: "normalized", record: { ...record, chrom, pos: targetPos } } };
}
function reference(pos: number): CanonicalRecord {
  return { type: "canonical-record", version: "prepared-canonical-v1",
    event: { type: "reference", line: pos + 3, call: { chrom: 1, pos, ref: "A", genotype: "A/A" } },
    normalization: { status: "source_reference" } };
}
function observed(pos: number, targetPos = pos): CanonicalRecord {
  const record = { rsid: pos, chrom: 1, pos, ref: "A", alt: "C", genotype: "--" };
  return { type: "canonical-record", version: "prepared-canonical-v1", event: { type: "observed", line: pos + 3,
    call: { ...record, line: pos + 3, sourceGt: "./.", filter: "q10", sampleFilter: null, genotypeQuality: 2,
      depth: 3, quality: "failed", usable: false } }, normalization: { status: "normalized", record: { ...record, pos: targetPos } } };
}
const encode = (sequence: number, records: CanonicalRecord[]) => encodeCanonicalBlock({ binding, sequence, records });
async function pageOf(records = [normalized(90, 10), normalized(80, 20)]) {
  const block = await encode(0, records), builder = createCanonicalCoordinateIndexBuilder({ binding });
  await builder.append(chunks(block.compressed), block.descriptor);
  return builder.finish().page!;
}
const copy = <T>(value: T): T => structuredClone(value);

describe("canonical coordinate index", () => {
  it("derives target coordinates from actual decoded bytes, not GRCh37 source positions", async () => {
    const page = await pageOf();
    expect(page.entries[0]).toMatchObject({ normalizedFirst: { chrom: 1, pos: 10 }, normalizedLast: { chrom: 1, pos: 20 }, normalizedCount: 2 });
    expect(selectCanonicalCoordinateBlocks(page, [{ chrom: 1, pos: 90 }], binding)).toEqual([]);
    expect(selectCanonicalCoordinateBlocks(page, [{ chrom: 1, pos: 10 }], binding)).toEqual([page.entries[0].descriptor]);
    expect(describeCanonicalCoordinateIndex(page)).toMatchObject({ blockCount: 1, recordCount: 2, normalizedCount: 2 });
  });
  it("keeps both boundary-collision blocks and observed no-calls without synthesizing coverage", async () => {
    const builder = createCanonicalCoordinateIndexBuilder({ binding });
    for (const [sequence, records] of [[normalized(1, 10), observed(2, 20)], [normalized(2, 20), normalized(3, 30)]].entries()) {
      const block = await encode(sequence, records); await builder.append(chunks(block.compressed), block.descriptor);
    }
    const { page, summary } = builder.finish();
    expect(selectCanonicalCoordinateBlocks(page, [{ chrom: 1, pos: 20 }]).map(d => d.sequence)).toEqual([0, 1]);
    expect(summary).toMatchObject({ recordCount: 4, normalizedCount: 4, blockCount: 2 });
    // Ranges are intentionally conservative: readers must exact-filter this gap.
    expect(selectCanonicalCoordinateBlocks(page, [{ chrom: 1, pos: 15 }])).toHaveLength(1);
  });
  it("retains normalized and source-only evidence while excluding the latter from lookup", async () => {
    const builder = createCanonicalCoordinateIndexBuilder({ binding });
    const duplicate = normalized(5); duplicate.normalization = { status: "duplicate", firstSourceLine: 7 };
    const unmapped = normalized(6); unmapped.normalization = { status: "unmapped" };
    const unsupported = normalized(7); unsupported.normalization = { status: "unsupported_alleles" };
    for (const [sequence, records] of [[normalized(9, 100), reference(4)], [duplicate, unmapped, unsupported]].entries()) {
      const block = await encode(sequence, records); await builder.append(chunks(block.compressed), block.descriptor);
    }
    const { page, summary } = builder.finish();
    expect(page!.entries[1]).toMatchObject({ normalizedCount: 0, normalizedFirst: null, normalizedLast: null });
    expect(summary).toMatchObject({ recordCount: 5, normalizedCount: 1, normalizedFirst: { chrom: 1, pos: 100 }, normalizedLast: { chrom: 1, pos: 100 } });
    expect(selectCanonicalCoordinateBlocks(page, [{ chrom: 1, pos: 5 }])).toEqual([]);
  });
  it("includes cross-chromosome ranges and rejects no valid endpoint", async () => {
    const page = await pageOf([normalized(1, 100, 1), normalized(2, 20, 2)]);
    for (const point of [{ chrom: 1, pos: 100 }, { chrom: 2, pos: 20 }]) expect(selectCanonicalCoordinateBlocks(page, [point])).toHaveLength(1);
    expect(selectCanonicalCoordinateBlocks(page, [{ chrom: 2, pos: 21 }])).toEqual([]);
  });
  it("counts all 2000 duplicate observations without dropping equal keys", async () => {
    const page = await pageOf(Array.from({ length: 2000 }, () => observed(10)));
    expect(page.entries[0]).toMatchObject({ normalizedCount: 2000, normalizedFirst: { chrom: 1, pos: 10 },
      normalizedLast: { chrom: 1, pos: 10 }, descriptor: { recordCount: 2000 } });
    expect(selectCanonicalCoordinateBlocks(page, [{ chrom: 1, pos: 10 }])).toHaveLength(1);
  });
  it("does not copy a long allele into directory metadata", async () => {
    const record = normalized(10);
    if (record.event.type !== "variant" || record.normalization.status !== "normalized") throw Error("fixture");
    record.event.record.alt = "C".repeat(100_000); record.normalization.record.alt = record.event.record.alt;
    const page = await pageOf([record]);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(3000);
    expect(page.entries[0].normalizedCount).toBe(1);
  });
  it("emits at 128 entries, keeps only a bounded next page and reports exact final coverage", async () => {
    const builder = createCanonicalCoordinateIndexBuilder({ binding, firstBlockSequence: 7 });
    let emitted: CanonicalCoordinateIndex | null = null;
    for (let i = 0; i < 129; i++) {
      const block = await encode(i + 7, [normalized(i + 1)]);
      const page = await builder.append(chunks(block.compressed), block.descriptor);
      if (i === 127) emitted = page; else expect(page).toBeNull();
    }
    expect(emitted).toMatchObject({ sequence: 0, firstBlockSequence: 7 });
    expect(emitted!.entries).toHaveLength(128);
    expect(Buffer.byteLength(JSON.stringify(emitted))).toBeLessThan(1_048_576);
    const completion = builder.finish();
    expect(completion.page).toMatchObject({ sequence: 1, firstBlockSequence: 135 });
    expect(completion.summary).toMatchObject({ version: "canonical-coordinate-index-summary-v1", state: "provisional",
      pageCount: 2, firstBlockSequence: 7, lastBlockSequence: 135, blockCount: 129, recordCount: 129, normalizedCount: 129 });
    expect(() => builder.finish()).toThrow("invalid_state");
  });
  it("allows empty finish without fabricating a block or a canonical completion", () => {
    const builder = createCanonicalCoordinateIndexBuilder({ binding });
    expect(builder.flush()).toBeNull();
    expect(builder.finish()).toMatchObject({ page: null, summary: { blockCount: 0, recordCount: 0, pageCount: 0,
      firstKey: null, lastKey: null, lastBlockSequence: null, normalizedFirst: null, normalizedLast: null } });
  });
  it("retains global ordering across explicit page flushes and protects captured keys from caller mutation", async () => {
    const builder = createCanonicalCoordinateIndexBuilder({ binding });
    const a = await encode(0, [normalized(1, 20)]); await builder.append(chunks(a.compressed), a.descriptor);
    const page = builder.flush()!; page.entries[0].lastKey[2] = 1;
    const b = await encode(1, [normalized(2, 10)]);
    await expect(builder.append(chunks(b.compressed), b.descriptor)).rejects.toThrow("out_of_order");
    expect(() => builder.finish()).toThrow("invalid_state");
  });
  it.each([
    [normalized(2), normalized(1)],
    [reference(1), normalized(2)],
    [reference(2), reference(1)],
    [normalized(2, 10), normalized(1, 10)],
    [normalized(1), observed(1)],
  ])("rejects actual noncanonical order within a verified block %#", async (...records) => {
    const block = await encode(0, records);
    await expect(buildCanonicalCoordinateEntry(chunks(block.compressed), block.descriptor)).rejects.toThrow("out_of_order");
  });
  it("rejects normalized data after a prior source-only block", async () => {
    const builder = createCanonicalCoordinateIndexBuilder({ binding });
    const a = await encode(0, [reference(1)]); await builder.append(chunks(a.compressed), a.descriptor); builder.flush();
    const b = await encode(1, [normalized(2)]);
    await expect(builder.append(chunks(b.compressed), b.descriptor)).rejects.toThrow("out_of_order");
  });
  it.each(["hash", "size", "binding", "sequence"])("refuses mismatched actual block %s before accepting an entry", async kind => {
    const block = await encode(0, [normalized(1)]), descriptor = copy(block.descriptor);
    if (kind === "hash") descriptor.compressedSha256 = "0".repeat(64);
    if (kind === "size") descriptor.compressedBytes++;
    if (kind === "binding") descriptor.binding.source.sourceRevision++;
    if (kind === "sequence") descriptor.sequence++;
    const builder = createCanonicalCoordinateIndexBuilder({ binding });
    await expect(builder.append(chunks(block.compressed), descriptor)).rejects.toThrow();
    expect(() => builder.finish()).toThrow("invalid_state");
  });
  it("waits for true byte EOF, clones descriptor before awaiting, and refuses overlapping calls without corrupting the first", async () => {
    const block = await encode(0, [normalized(1)]), expected = copy(block.descriptor);
    let end!: () => void; const gate = new Promise<void>(resolve => { end = resolve; });
    async function* delayed() { yield block.compressed; await gate; }
    const builder = createCanonicalCoordinateIndexBuilder({ binding });
    let settled = false; const pending = builder.append(delayed(), expected).then(page => { settled = true; return page; });
    expected.compressedSha256 = "0".repeat(64);
    await expect(builder.append(chunks(block.compressed), block.descriptor)).rejects.toThrow("invalid_state");
    expect(() => builder.finish()).toThrow("invalid_state"); expect(settled).toBe(false);
    end(); await pending; expect(builder.finish().page!.entries[0].descriptor).toEqual(block.descriptor);
  });
  it("rejects bytes arriving after the complete gzip rather than publishing an entry early", async () => {
    const block = await encode(0, [normalized(1)]);
    async function* extra() { yield block.compressed; yield Uint8Array.of(1); }
    await expect(buildCanonicalCoordinateEntry(extra(), block.descriptor)).rejects.toThrow();
  });
  it("propagates a late producer failure without emitting a successful page or summary", async () => {
    const block = await encode(0, [normalized(1)]);
    async function* failed() { yield block.compressed; throw Error("synthetic producer failure"); }
    const builder = createCanonicalCoordinateIndexBuilder({ binding });
    await expect(builder.append(failed(), block.descriptor)).rejects.toThrow();
    expect(() => builder.flush()).toThrow("invalid_state");
  });
  it("abort prevents publication and closes an acquired producer", async () => {
    const block = await encode(0, [normalized(1)]), controller = new AbortController(); let closed = false;
    async function* cancelled() { try { yield block.compressed; controller.abort(); } finally { closed = true; } }
    const builder = createCanonicalCoordinateIndexBuilder({ binding, signal: controller.signal });
    await expect(builder.append(cancelled(), block.descriptor)).rejects.toThrow("aborted");
    expect(closed).toBe(true); expect(() => builder.finish()).toThrow("aborted");
  });
  it("already-aborted construction refuses without reading input", () => {
    expect(() => createCanonicalCoordinateIndexBuilder({ binding, signal: AbortSignal.abort() })).toThrow("aborted");
  });
  it.each([
    (p: CanonicalCoordinateIndex) => { Reflect.set(p, "version", "future"); },
    (p: CanonicalCoordinateIndex) => { Reflect.set(p, "extra", true); },
    (p: CanonicalCoordinateIndex) => { p.entries[0].normalizedCount = 0; },
    (p: CanonicalCoordinateIndex) => { p.entries[0].normalizedCount = 3; },
    (p: CanonicalCoordinateIndex) => { p.entries[0].normalizedFirst = null; },
    (p: CanonicalCoordinateIndex) => { p.entries[0].normalizedLast = { chrom: 1, pos: 9 }; },
    (p: CanonicalCoordinateIndex) => { p.entries[0].normalizedLast = { chrom: 1, pos: 21 }; },
    (p: CanonicalCoordinateIndex) => { p.entries[0].descriptor.compressedSha256 = "wrong"; },
    (p: CanonicalCoordinateIndex) => { p.entries[0].descriptor.binding.source.rawSha256 = "c".repeat(64); },
    (p: CanonicalCoordinateIndex) => { p.firstBlockSequence = 1; },
  ])("refuses corrupt closed page metadata %#", async mutate => {
    const page = await pageOf(); mutate(page); expect(() => validateCanonicalCoordinateIndex(page, binding)).toThrow();
  });
  it("rejects a singleton normalized prefix with inconsistent end bound", async () => {
    const page = await pageOf([normalized(1, 10), reference(2)]); page.entries[0].normalizedLast!.pos = 20;
    expect(() => validateCanonicalCoordinateIndex(page)).toThrow("invalid_index");
  });
  it("rejects fabricated normalized bounds on source-only and inconsistent singleton keys", async () => {
    const page = await pageOf([reference(1)]);
    const fake = copy(page); fake.entries[0].normalizedFirst = { chrom: 1, pos: 1 };
    expect(() => validateCanonicalCoordinateIndex(fake)).toThrow("invalid_index");
    page.entries[0].lastKey[4]++;
    expect(() => validateCanonicalCoordinateIndex(page)).toThrow("invalid_index");
  });
  it("rejects reordered or repeated entry sequences and wrong expected source", async () => {
    const builder = createCanonicalCoordinateIndexBuilder({ binding });
    for (let i = 0; i < 2; i++) { const block = await encode(i, [normalized(i + 1)]); await builder.append(chunks(block.compressed), block.descriptor); }
    const page = builder.finish().page!;
    expect(() => validateCanonicalCoordinateIndex({ ...page, entries: [...page.entries].reverse() })).toThrow("sequence_mismatch");
    expect(() => validateCanonicalCoordinateIndex({ ...page, entries: [page.entries[0], page.entries[0]] })).toThrow("sequence_mismatch");
    const other = copy(binding); other.source.fileId = "33333333-3333-4333-8333-333333333333";
    expect(() => validateCanonicalCoordinateIndex(page, other)).toThrow("integrity_mismatch");
  });
  it("bounds cardinality before touching oversized entries and refuses huge/deep/unknown metadata before cloning", async () => {
    const entries = Array(129); Object.defineProperty(entries, 0, { get() { throw Error("must not inspect"); } });
    expect(() => validateCanonicalCoordinateIndex({ entries })).toThrow("invalid_index");
    const page = await pageOf();
    expect(() => validateCanonicalCoordinateIndex({ ...page, extra: "x".repeat(1_048_577) })).toThrow("invalid_index");
    let nested: unknown = null; for (let i = 0; i < 10; i++) nested = { nested };
    expect(() => validateCanonicalCoordinateIndex({ ...page, nested })).toThrow("too_large");
  });
  it("limits lookup inputs to at most 200 unique valid coordinates", async () => {
    const page = await pageOf();
    expect(selectCanonicalCoordinateBlocks(page, [])).toEqual([]);
    expect(selectCanonicalCoordinateBlocks(page, Array.from({ length: 200 }, (_, i) => ({ chrom: 1, pos: i + 1 })))).toHaveLength(1);
    for (const points of [Array.from({ length: 201 }, (_, i) => ({ chrom: 1, pos: i + 1 })),
      [{ chrom: 1, pos: 10 }, { chrom: 1, pos: 10 }], [{ chrom: 0, pos: 1 }], [{ chrom: 1, pos: 0 }], [{ chrom: 1, pos: 1.2 }]]) {
      expect(() => selectCanonicalCoordinateBlocks(page, points)).toThrow("invalid_query");
    }
  });
  it("refuses cross-entry source-only ordering even when individual entries are valid", async () => {
    const blocks = await Promise.all([encode(0, [reference(2)]), encode(1, [reference(1)])]);
    const entries = await Promise.all(blocks.map(b => buildCanonicalCoordinateEntry(chunks(b.compressed), b.descriptor)));
    expect(() => validateCanonicalCoordinateIndex({ version: "canonical-coordinate-index-v1", state: "provisional", binding,
      sequence: 0, firstBlockSequence: 0, entries })).toThrow("out_of_order");
  });
  it("keeps descriptor-only lookup detached from mutation of the original page", async () => {
    const page = await pageOf(), selected: CanonicalBlockDescriptor[] = selectCanonicalCoordinateBlocks(page, [{ chrom: 1, pos: 10 }]);
    selected[0].sequence = 9; expect(page.entries[0].descriptor.sequence).toBe(0);
  });
});
