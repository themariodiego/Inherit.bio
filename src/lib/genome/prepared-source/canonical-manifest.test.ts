import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { streamVcf, type VcfParseEvent } from "../parsers/vcf";
import { canonicalizePreparedEvents } from "./canonical";
import { compareCanonicalRecords, countCanonicalRecord, emptyCanonicalCounts } from "./canonical-runs";
import { materializeCanonicalMerge, type CanonicalMaterializationReceipt } from "./materialize-canonical";
import type { CanonicalRecord, CanonicalSummary } from "./canonical-schema";
import type { CanonicalMergeSummary } from "./canonical-merge";
import type { PreparedEvent } from "./schema";
import type { PreparedMergeSummary } from "./merge";
import type { PreparedStoredArtifact } from "./storage-writer";
import { syntheticSource, syntheticHeader } from "./fixtures";
import { describeCanonicalCoordinateIndex, type CanonicalCoordinateIndex } from "./canonical-coordinate-index";
import { decodeCanonicalContainerDirectory, decodeCanonicalCoordinatePage, validateCanonicalMaterializationReceipt,
  type CanonicalContainerDirectory, type CanonicalManifestContext } from "./canonical-manifest";

const jobId = "33333333-3333-4333-8333-333333333333", attemptId = "44444444-4444-4444-8444-444444444444";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function* values<T>(items: T[]) { yield* items; }
const copy = <T>(value: T): T => structuredClone(value);
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
function stored(bytes: Uint8Array, sequence: number): PreparedStoredArtifact {
  return { receipt: { version: "own-preparation-artifact-v1", artifactId: randomUUID(), jobId, attemptId, sequence,
    bucket: "genomes", objectKey: `prepared/${randomUUID()}`, byteCount: bytes.length, sha256: sha(bytes),
    writeExpiresAt: "2026-09-08T20:00:00Z" }, storageObjectId: randomUUID() };
}
type Fixture = { root: CanonicalMaterializationReceipt; objects: Map<string, Uint8Array> };
let fixture: Fixture, split: Fixture;
const expected = (f: Fixture) => ({ binding: f.root.binding, jobId, attemptId });
function context(f: Fixture, firstContainer = 0): CanonicalManifestContext {
  return { ...expected(f), firstArtifactSequence: f.root.firstArtifactSequence, nextArtifactSequence: f.root.nextArtifactSequence,
    expectedFirstContainerSequence: firstContainer, forbiddenArtifacts: [...f.root.directories.map(d => d.artifact), ...f.root.coordinatePages.map(p => p.artifact)] };
}
const bytesFor = (f: Fixture, artifact: PreparedStoredArtifact) => f.objects.get(artifact.receipt.objectKey)!;
function replaceBytes<T extends { artifact: PreparedStoredArtifact }>(reference: T, bytes: Uint8Array): T {
  const changed = copy(reference); changed.artifact.receipt.sha256 = sha(bytes); changed.artifact.receipt.byteCount = bytes.length; return changed;
}
beforeAll(async () => {
  // Actual parser -> canonical reducer -> final target order -> materializer.
  // The in-memory registered ACKs test integrity, not provider durability.
  const rows = Array.from({ length: 1100 }, (_, i) => `1\t${i + 1}\trs${i + 1}\tA\tC\t50\tPASS\t.\tGT\t0/1`);
  const parsed = await Array.fromAsync(streamVcf(values([...syntheticHeader, ...rows])));
  const summary = parsed.at(-1) as Extract<VcfParseEvent, { type: "summary" }>;
  const events = parsed.filter((e): e is PreparedEvent => e.type !== "summary");
  const merge: PreparedMergeSummary = { type: "merge-summary", version: "prepared-merge-v1", state: "provisional", source: syntheticSource,
    inputRunSequences: [0], inputBlockCount: 2, eventCount: events.length, variantCount: summary.variantCount,
    observedCallCount: summary.observedCallCount, referenceCallCount: summary.referenceCallCount };
  const canonical = await Array.fromAsync(canonicalizePreparedEvents(values<PreparedEvent | PreparedMergeSummary>([...events, merge]), {
    source: syntheticSource, expectedParserRevision: syntheticSource.parserRevision, maximumUnmappedFraction: 0.05, expectedMergeSummary: merge,
    parserReceipt: { version: "prepared-runs-v1", state: "provisional", source: syntheticSource, summary, runCount: 1, blockCount: 2, eventCount: events.length },
  }));
  const canonicalSummary = canonical.at(-1) as CanonicalSummary;
  const records = canonical.filter((r): r is CanonicalRecord => r.type === "canonical-record").sort(compareCanonicalRecords);
  const counts = emptyCanonicalCounts(); records.forEach(r => countCanonicalRecord(counts, r));
  const terminal: CanonicalMergeSummary = { type: "canonical-merge-summary", version: "canonical-merge-summary-v1", state: "provisional",
    binding: canonicalSummary.binding, inputRunSequences: [0], inputBlockCount: 2, recordCount: records.length, counts };
  const objects = new Map<string, Uint8Array>();
  const root = await materializeCanonicalMerge(values<CanonicalRecord | CanonicalMergeSummary>([...records, terminal]), {
    binding: canonicalSummary.binding, canonicalSummary, jobId, attemptId, firstArtifactSequence: 7,
    writeArtifact: async ({ descriptor, bytes }) => { const artifact = stored(bytes, descriptor.sequence); objects.set(artifact.receipt.objectKey, Uint8Array.from(bytes)); return artifact; },
  });
  fixture = { root, objects };
  // Repack the same actual verified blocks into two small directory/page objects
  // to test cross-page invariants without a large fixture or fabricated calls.
  const originalDirectory = decodeCanonicalContainerDirectory(bytesFor(fixture, root.directories[0].artifact), root.directories[0], context(fixture));
  const originalPage = decodeCanonicalCoordinatePage(bytesFor(fixture, root.coordinatePages[0].artifact), root.coordinatePages[0], context(fixture));
  const source = originalDirectory.containers[0], data = bytesFor(fixture, source.artifact), splitRoot = copy(root), splitObjects = new Map<string, Uint8Array>();
  splitRoot.directories = []; splitRoot.coordinatePages = []; splitRoot.containerCount = source.descriptor.blocks.length;
  function save(bytes: Uint8Array, sequence: number) { const artifact = stored(bytes, sequence); splitObjects.set(artifact.receipt.objectKey, bytes); return artifact; }
  source.descriptor.blocks.forEach((block, i) => {
    const bytes = data.subarray(block.offset, block.offset + block.length), artifact = save(bytes, 7 + i * 3);
    const descriptor = { ...source.descriptor, sequence: i, byteCount: bytes.length, sha256: sha(bytes), blocks: [{ ...block, offset: 0 }] };
    const directory: CanonicalContainerDirectory = { version: "canonical-container-directory-v1", state: "provisional", binding: root.binding,
      sequence: i, containers: [{ artifact, descriptor }] };
    splitRoot.directories.push({ artifact: save(json(directory), 8 + i * 3), sequence: i, firstBlockSequence: i, lastBlockSequence: i, containerCount: 1, blockCount: 1 });
    const page: CanonicalCoordinateIndex = { ...originalPage, sequence: i, firstBlockSequence: i, entries: [originalPage.entries[i]] };
    splitRoot.coordinatePages.push({ artifact: save(json(page), 9 + i * 3), envelope: describeCanonicalCoordinateIndex(page) });
  });
  splitRoot.coordinateSummary.pageCount = splitRoot.coordinatePages.length;
  splitRoot.artifactCount = splitRoot.containerCount * 3; splitRoot.nextArtifactSequence = 7 + splitRoot.artifactCount;
  split = { root: splitRoot, objects: splitObjects };
});

describe("canonical provisional manifest integrity", () => {
  it("validates actual materialization and exact referenced bytes without granting publication", () => {
    const root = validateCanonicalMaterializationReceipt(fixture.root, expected(fixture));
    expect(root).toEqual(fixture.root); expect(root).not.toBe(fixture.root); expect(root.state).toBe("provisional");
    const directory = decodeCanonicalContainerDirectory(bytesFor(fixture, root.directories[0].artifact), root.directories[0], context(fixture));
    const page = decodeCanonicalCoordinatePage(bytesFor(fixture, root.coordinatePages[0].artifact), root.coordinatePages[0], context(fixture));
    expect(directory.containers.flatMap(c => c.descriptor.blocks.map(b => b.descriptor))).toEqual(page.entries.map(e => e.descriptor));
  });
  it("accepts contiguous multi-page coverage and exact per-directory first-container binding", () => {
    expect(validateCanonicalMaterializationReceipt(split.root, expected(split))).toEqual(split.root);
    split.root.directories.forEach((reference, i) => expect(decodeCanonicalContainerDirectory(bytesFor(split, reference.artifact), reference, context(split, i)).containers[0].descriptor.sequence).toBe(i));
    split.root.coordinatePages.forEach(reference => expect(decodeCanonicalCoordinatePage(bytesFor(split, reference.artifact), reference, context(split)).entries).toHaveLength(1));
  });
  it.each([
    (r: CanonicalMaterializationReceipt) => { Reflect.set(r, "state", "published"); },
    (r: CanonicalMaterializationReceipt) => { Reflect.set(r, "version", "future"); },
    (r: CanonicalMaterializationReceipt) => { Reflect.set(r, "extra", true); },
    (r: CanonicalMaterializationReceipt) => { r.jobId = randomUUID(); },
    (r: CanonicalMaterializationReceipt) => { r.attemptId = randomUUID(); },
    (r: CanonicalMaterializationReceipt) => { r.binding.source.sourceRevision++; },
    (r: CanonicalMaterializationReceipt) => { r.canonicalSummary.binding.source.sourceRevision++; },
    (r: CanonicalMaterializationReceipt) => { r.mergeSummary.binding.source.sourceRevision++; },
    (r: CanonicalMaterializationReceipt) => { r.counts.normalizedVariantCount--; },
    (r: CanonicalMaterializationReceipt) => { r.mergeSummary.counts.duplicateCount++; },
    (r: CanonicalMaterializationReceipt) => { r.mergeSummary.inputRunSequences = [0, 0]; },
    (r: CanonicalMaterializationReceipt) => { r.mergeSummary.inputBlockCount = 0; },
    (r: CanonicalMaterializationReceipt) => { r.recordCount++; },
    (r: CanonicalMaterializationReceipt) => { r.blockCount++; },
    (r: CanonicalMaterializationReceipt) => { r.containerCount++; },
    (r: CanonicalMaterializationReceipt) => { r.byteCount = 8_388_609; },
    (r: CanonicalMaterializationReceipt) => { r.artifactCount++; },
    (r: CanonicalMaterializationReceipt) => { r.nextArtifactSequence++; },
    (r: CanonicalMaterializationReceipt) => { r.firstArtifactSequence++; },
    (r: CanonicalMaterializationReceipt) => { r.directories[0].firstBlockSequence++; },
    (r: CanonicalMaterializationReceipt) => { r.directories[0].lastBlockSequence++; },
    (r: CanonicalMaterializationReceipt) => { r.coordinatePages[0].envelope.normalizedCount--; },
    (r: CanonicalMaterializationReceipt) => { r.coordinateSummary.normalizedLast!.pos++; },
    (r: CanonicalMaterializationReceipt) => { r.coordinateSummary.recordCount++; },
    (r: CanonicalMaterializationReceipt) => { r.coordinateSummary.lastKey![4]++; },
    (r: CanonicalMaterializationReceipt) => { r.directories[0].artifact.receipt.jobId = randomUUID(); },
    (r: CanonicalMaterializationReceipt) => { r.coordinatePages[0].artifact.receipt.attemptId = randomUUID(); },
    (r: CanonicalMaterializationReceipt) => { r.coordinatePages[0].artifact.receipt.sequence = 4095; },
    (r: CanonicalMaterializationReceipt) => { r.coordinatePages[0].artifact.receipt.objectKey = "../original"; },
    (r: CanonicalMaterializationReceipt) => { r.coordinatePages[0].artifact.receipt.sha256 = "bad"; },
    (r: CanonicalMaterializationReceipt) => { r.coordinatePages[0].artifact.receipt.byteCount = 1_048_577; },
  ])("refuses inconsistent or open root metadata %#", mutate => {
    const root = copy(fixture.root); mutate(root); expect(() => validateCanonicalMaterializationReceipt(root, expected(fixture))).toThrow();
  });
  it.each(["sequence", "artifactId", "objectKey", "storageObjectId"])("rejects root reference identity aliasing by %s", key => {
    const root = copy(fixture.root), a = root.directories[0].artifact, b = root.coordinatePages[0].artifact;
    if (key === "storageObjectId") Reflect.set(b, "storageObjectId", Reflect.get(a, "storageObjectId"));
    else Reflect.set(b.receipt, key, Reflect.get(a.receipt, key));
    expect(() => validateCanonicalMaterializationReceipt(root, expected(fixture))).toThrow("integrity_mismatch");
  });
  it("rejects directory gaps, repeated pages, changed order and plausible but wrong aggregate counts", () => {
    const variants = [copy(split.root), copy(split.root), copy(split.root), copy(split.root)];
    variants[0].directories[1].firstBlockSequence++;
    variants[1].coordinatePages[1] = copy(variants[1].coordinatePages[0]);
    variants[2].coordinatePages.reverse();
    variants[3].coordinatePages[1].envelope.recordCount++;
    for (const root of variants) expect(() => validateCanonicalMaterializationReceipt(root, expected(split))).toThrow();
  });
  it("rejects duplicate-variant counts consuming observed records despite otherwise balanced totals", () => {
    const root = copy(fixture.root);
    root.counts.duplicateCount++; root.counts.normalizedObservedCount--; root.counts.usableObservedCount--;
    root.mergeSummary.counts = copy(root.counts); root.canonicalSummary.observedCallCount--; root.canonicalSummary.usableObservedCount--;
    root.coordinatePages[0].envelope.normalizedCount--; root.coordinateSummary.normalizedCount--;
    expect(() => validateCanonicalMaterializationReceipt(root, expected(fixture))).toThrow("integrity_mismatch");
  });
  it("preflights oversized roots before accessing members or cloning arbitrary strings", () => {
    const directories = Array(4097); Object.defineProperty(directories, 0, { get() { throw Error("must not inspect"); } });
    expect(() => validateCanonicalMaterializationReceipt({ directories, coordinatePages: [] }, expected(fixture))).toThrow("invalid_manifest");
    expect(() => validateCanonicalMaterializationReceipt({ ...fixture.root, extra: "x".repeat(4_000_001) }, expected(fixture))).toThrow("invalid_manifest");
    const huge = { ...fixture.root, directories: Array(4096).fill(fixture.root.directories[0]), coordinatePages: Array(4096).fill(fixture.root.coordinatePages[0]) };
    expect(() => validateCanonicalMaterializationReceipt(huge, expected(fixture))).toThrow("too_large");
  });
  it.each(["top", "nested", "array", "expected", "context"])("refuses %s metadata accessors without executing them", location => {
    let invoked = false;
    const getter = { enumerable: true, get() { invoked = true; throw Error("must not execute"); } };
    const root = copy(fixture.root), exp = expected(fixture), ctx = context(fixture);
    if (location === "top") Object.defineProperty(root, "directories", getter);
    if (location === "nested") Object.defineProperty(root.directories[0].artifact.receipt, "sha256", getter);
    if (location === "array") Object.defineProperty(root.directories, 0, getter);
    if (location === "expected") Object.defineProperty(exp, "binding", getter);
    if (location === "context") {
      Object.defineProperty(ctx, "forbiddenArtifacts", getter);
      const ref = root.coordinatePages[0];
      expect(() => decodeCanonicalCoordinatePage(bytesFor(fixture, ref.artifact), ref, ctx)).toThrow("invalid_manifest");
    } else expect(() => validateCanonicalMaterializationReceipt(root, exp)).toThrow("invalid_manifest");
    expect(invoked).toBe(false);
  });
  it.each(["root", "expected"])("rejects hidden required %s binding getters before schema access", location => {
    const root = copy(fixture.root), exp = expected(fixture); let invoked = false;
    Object.defineProperty(location === "root" ? root : exp, "binding", {
      enumerable: false, get() { invoked = true; throw Error("must not execute"); },
    });
    expect(() => validateCanonicalMaterializationReceipt(root, exp)).toThrow("invalid_manifest");
    expect(invoked).toBe(false);
  });
  it("rejects non-JSON hidden data and symbol keys, and bounds enumerable width before inspecting hidden properties", () => {
    const hidden = copy(fixture.root); Object.defineProperty(hidden, "binding", { value: hidden.binding, enumerable: false });
    expect(() => validateCanonicalMaterializationReceipt(hidden, expected(fixture))).toThrow("invalid_manifest");
    const symbol = copy(fixture.root); Reflect.set(symbol, Symbol("unknown"), true);
    expect(() => validateCanonicalMaterializationReceipt(symbol, expected(fixture))).toThrow("invalid_manifest");
    const wide = copy(fixture.root); for (let i = 0; i < 33; i++) Reflect.set(wide, `extra${i}`, true);
    let invoked = false; Object.defineProperty(wide, "hidden", { get() { invoked = true; throw Error("must not execute"); } });
    expect(() => validateCanonicalMaterializationReceipt(wide, expected(fixture))).toThrow("invalid_manifest");
    expect(invoked).toBe(false);
  });
  it.each(["directory", "coordinate"])("rejects wrong hash, byte length, malformed UTF-8, trailing JSON and oversized %s bytes", kind => {
    const ref = kind === "directory" ? fixture.root.directories[0] : fixture.root.coordinatePages[0];
    const run = (bytes: Uint8Array, reference: typeof ref) => kind === "directory"
      ? decodeCanonicalContainerDirectory(bytes, reference as typeof fixture.root.directories[0], context(fixture))
      : decodeCanonicalCoordinatePage(bytes, reference as typeof fixture.root.coordinatePages[0], context(fixture));
    const original = bytesFor(fixture, ref.artifact), changed = Uint8Array.from(original); changed[0] ^= 1;
    expect(() => run(changed, ref)).toThrow("integrity_mismatch");
    expect(() => run(original.subarray(1), ref)).toThrow("integrity_mismatch");
    for (const bad of [Uint8Array.of(0xff), Buffer.concat([original, Buffer.from("{}")] ), Buffer.from("\ufeff{}")]) {
      expect(() => run(bad, replaceBytes(ref, bad))).toThrow("invalid_manifest");
    }
    expect(() => run(new Uint8Array(1_048_577), ref)).toThrow("too_large");
  });
  it.each([
    (d: CanonicalContainerDirectory) => { Reflect.set(d, "version", "future"); },
    (d: CanonicalContainerDirectory) => { Reflect.set(d, "extra", true); },
    (d: CanonicalContainerDirectory) => { d.sequence++; },
    (d: CanonicalContainerDirectory) => { d.binding.source.sourceRevision++; },
    (d: CanonicalContainerDirectory) => { d.containers[0].descriptor.binding.source.sourceRevision++; },
    (d: CanonicalContainerDirectory) => { d.containers[0].descriptor.sha256 = "0".repeat(64); },
    (d: CanonicalContainerDirectory) => { d.containers[0].descriptor.byteCount++; },
    (d: CanonicalContainerDirectory) => { d.containers[0].descriptor.sequence++; },
    (d: CanonicalContainerDirectory) => { d.containers[0].descriptor.blocks[0].offset++; },
    (d: CanonicalContainerDirectory) => { d.containers[0].descriptor.blocks[0].length++; },
    (d: CanonicalContainerDirectory) => { d.containers[0].descriptor.blocks[0].descriptor.sequence++; },
    (d: CanonicalContainerDirectory) => { d.containers[0].artifact.receipt.jobId = randomUUID(); },
    (d: CanonicalContainerDirectory) => { d.containers[0].artifact.receipt.attemptId = randomUUID(); },
    (d: CanonicalContainerDirectory) => { d.containers[0].artifact.receipt.sequence = 0; },
    (d: CanonicalContainerDirectory) => { d.containers[0].artifact.receipt.sequence = 4095; },
    (d: CanonicalContainerDirectory) => { d.containers[0].artifact.receipt.objectKey = `original/${randomUUID()}`; },
    (d: CanonicalContainerDirectory) => { d.containers.push(copy(d.containers[0])); },
  ])("rejects directory membership corruption even with a matching outer byte hash %#", mutate => {
    const ref = fixture.root.directories[0], raw = JSON.parse(Buffer.from(bytesFor(fixture, ref.artifact)).toString()) as CanonicalContainerDirectory;
    mutate(raw); const bytes = json(raw), changed = replaceBytes(ref, bytes);
    // Remove old expected self identity only; the changed reference is the one
    // selected by this synthetic integrity test, never a DB publication claim.
    const ctx = context(fixture); ctx.forbiddenArtifacts = fixture.root.coordinatePages.map(p => p.artifact);
    expect(() => decodeCanonicalContainerDirectory(bytes, changed, ctx)).toThrow();
  });
  it("rejects data aliasing any other root artifact even when the member sequence remains in range", () => {
    const ref = fixture.root.directories[0], raw = JSON.parse(Buffer.from(bytesFor(fixture, ref.artifact)).toString()) as CanonicalContainerDirectory;
    const forbidden = copy(fixture.root.coordinatePages[0].artifact);
    forbidden.receipt.sequence = raw.containers[0].artifact.receipt.sequence;
    const ctx = context(fixture); ctx.forbiddenArtifacts = [forbidden];
    expect(() => decodeCanonicalContainerDirectory(bytesFor(fixture, ref.artifact), ref, ctx)).toThrow("integrity_mismatch");
  });
  it("binds later directories to the caller's cumulative container count", () => {
    const ref = split.root.directories[1];
    expect(() => decodeCanonicalContainerDirectory(bytesFor(split, ref.artifact), ref, context(split, 0))).toThrow("integrity_mismatch");
  });
  it("rejects changed directory totals and full coordinate envelope despite valid bytes", () => {
    const d = copy(fixture.root.directories[0]); d.blockCount++;
    expect(() => decodeCanonicalContainerDirectory(bytesFor(fixture, d.artifact), d, context(fixture))).toThrow("integrity_mismatch");
    const p = copy(fixture.root.coordinatePages[0]); p.envelope.normalizedFirst!.pos++;
    expect(() => decodeCanonicalCoordinatePage(bytesFor(fixture, p.artifact), p, context(fixture))).toThrow("integrity_mismatch");
  });
  it("rejects altered coordinate entries with a freshly matching outer hash", () => {
    const ref = fixture.root.coordinatePages[0], page = JSON.parse(Buffer.from(bytesFor(fixture, ref.artifact)).toString()) as CanonicalCoordinateIndex;
    page.entries[0].normalizedCount--; const bytes = json(page);
    expect(() => decodeCanonicalCoordinatePage(bytes, replaceBytes(ref, bytes), context(fixture))).toThrow();
  });
  it("rejects more than 128 containers and entries before nested schema cloning", () => {
    const d = fixture.root.directories[0], raw = JSON.parse(Buffer.from(bytesFor(fixture, d.artifact)).toString()) as CanonicalContainerDirectory;
    raw.containers = Array(129).fill(raw.containers[0]); const bytes = json(raw);
    expect(() => decodeCanonicalContainerDirectory(bytes, replaceBytes(d, bytes), context(fixture))).toThrow();
    const p = fixture.root.coordinatePages[0], page = JSON.parse(Buffer.from(bytesFor(fixture, p.artifact)).toString()) as CanonicalCoordinateIndex;
    page.entries = Array(129).fill(page.entries[0]); const pageBytes = json(page);
    expect(() => decodeCanonicalCoordinatePage(pageBytes, replaceBytes(p, pageBytes), context(fixture))).toThrow();
  });
  it("does not treat a content hash as current source or job authority", () => {
    const ref = fixture.root.coordinatePages[0], ctx = context(fixture); ctx.binding = copy(ctx.binding); ctx.binding.source.sourceRevision++;
    expect(() => decodeCanonicalCoordinatePage(bytesFor(fixture, ref.artifact), ref, ctx)).toThrow();
    expect(() => decodeCanonicalCoordinatePage(bytesFor(fixture, ref.artifact), ref, { ...context(fixture), jobId: randomUUID() })).toThrow();
  });
});
