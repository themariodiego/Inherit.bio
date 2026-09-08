import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { materializeCanonicalMerge, type CanonicalContainerDirectory } from "./materialize-canonical";
import { fixture, sink, values, row, jobId, attemptId } from "./materialize-canonical.fixtures";
import { describeCanonicalCoordinateIndex, type CanonicalCoordinateIndex } from "./canonical-coordinate-index";
import { validateCanonicalMaterializationReceipt } from "./canonical-manifest";
import { verifyCanonicalMaterialization, type CanonicalVerificationOptions } from "./verify-canonical-materialization";
import { readVerifiedPreparedArtifact, type VerifiedArtifactReadOptions } from "./verified-artifact-reader";
import { decodeCanonicalBlock, encodeCanonicalBlock } from "./canonical-codec";
import type { PreparedStoredArtifact } from "./storage-writer";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const copy = <T>(value: T): T => structuredClone(value);
async function setup(rows?: string[], build: "GRCh37" | "GRCh38" = "GRCh38") {
  const f = await fixture(rows, build), out = sink();
  const manifest = await materializeCanonicalMerge(values(f.output), { ...f, ...out, jobId, attemptId, firstArtifactSequence: 7 });
  return { ...f, ...out, manifest, expected: { binding: f.binding, jobId, attemptId } };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
let baseline: Fixture, multiple: Fixture;
function fresh(base = baseline) { return { ...base, manifest: copy(base.manifest), expected: copy(base.expected),
  objects: new Map([...base.objects].map(([key, bytes]) => [key, Uint8Array.from(bytes)])) }; }
function readOptions(f: Fixture): CanonicalVerificationOptions {
  return { check: vi.fn(async () => {}), readArtifact: vi.fn(artifact => {
    const bytes = f.objects.get(artifact.receipt.objectKey); if (!bytes) throw Error("synthetic missing object");
    return values([bytes.subarray(0, 3), bytes.subarray(3)]);
  }) };
}
const run = (f: Fixture, options = readOptions(f)) => verifyCanonicalMaterialization(f.manifest, f.expected, options);
function updateObject(f: Fixture, artifact: PreparedStoredArtifact, bytes: Uint8Array) {
  f.objects.set(artifact.receipt.objectKey, bytes); artifact.receipt.byteCount = bytes.length; artifact.receipt.sha256 = sha(bytes);
}
function directory(f: Fixture, index = 0): CanonicalContainerDirectory {
  return JSON.parse(Buffer.from(f.objects.get(f.manifest.directories[index].artifact.receipt.objectKey)!).toString());
}
function page(f: Fixture, index = 0): CanonicalCoordinateIndex {
  return JSON.parse(Buffer.from(f.objects.get(f.manifest.coordinatePages[index].artifact.receipt.objectKey)!).toString());
}
function dataArtifact(f: Fixture) { return directory(f).containers[0].artifact; }
beforeAll(async () => {
  baseline = await setup(); multiple = await setup(Array.from({ length: 1100 }, (_, i) => row(i + 1)));
  const originalDirectory = directory(multiple), originalPage = page(multiple), stored = originalDirectory.containers[0];
  const sourceBytes = multiple.objects.get(stored.artifact.receipt.objectKey)!;
  multiple.manifest.directories = []; multiple.manifest.coordinatePages = []; multiple.objects.clear();
  function write(bytes: Uint8Array, sequence: number): PreparedStoredArtifact {
    const artifact = { receipt: { version: "own-preparation-artifact-v1" as const, artifactId: randomUUID(), jobId, attemptId,
      sequence, bucket: "genomes" as const, objectKey: `prepared/${randomUUID()}`, byteCount: bytes.length, sha256: sha(bytes),
      writeExpiresAt: "2026-09-08T20:00:00Z" }, storageObjectId: randomUUID() };
    multiple.objects.set(artifact.receipt.objectKey, bytes); return artifact;
  }
  stored.descriptor.blocks.forEach((block, i) => {
    const bytes = sourceBytes.subarray(block.offset, block.offset + block.length), artifact = write(bytes, 7 + i * 3);
    const descriptor = { ...stored.descriptor, sequence: i, byteCount: bytes.length, sha256: sha(bytes), blocks: [{ ...block, offset: 0 }] };
    const d: CanonicalContainerDirectory = { ...originalDirectory, sequence: i, containers: [{ artifact, descriptor }] };
    multiple.manifest.directories.push({ artifact: write(json(d), 8 + i * 3), sequence: i, firstBlockSequence: i, lastBlockSequence: i, containerCount: 1, blockCount: 1 });
    const p = { ...originalPage, sequence: i, firstBlockSequence: i, entries: [originalPage.entries[i]] };
    multiple.manifest.coordinatePages.push({ artifact: write(json(p), 9 + i * 3), envelope: describeCanonicalCoordinateIndex(p) });
  });
  multiple.manifest.containerCount = stored.descriptor.blocks.length;
  multiple.manifest.artifactCount = multiple.manifest.containerCount * 3;
  multiple.manifest.nextArtifactSequence = 7 + multiple.manifest.artifactCount;
  multiple.manifest.coordinateSummary.pageCount = multiple.manifest.coordinatePages.length;
});

describe("full canonical materialization verification", () => {
  it("checks every actual object with serial reads and pre/post authority, returning only provisional exact members", async () => {
    const f = fresh(), options = readOptions(f), result = await run(f, options);
    expect(result).toMatchObject({ version: "verified-canonical-materialization-v1", state: "provisional", binding: f.binding,
      jobId, attemptId, artifactCount: f.manifest.artifactCount, blockCount: f.manifest.blockCount,
      recordCount: f.records.length, byteCount: f.manifest.byteCount, counts: f.manifest.counts, canonicalSummary: f.canonicalSummary });
    expect(result.manifestSha256).toBe(sha(json(validateCanonicalMaterializationReceipt(f.manifest, f.expected))));
    expect(result.artifacts.map(a => a.receipt.sequence)).toEqual([7, 8, 9]);
    const reads = vi.mocked(options.readArtifact).mock.calls.map(([a]) => a.receipt.objectKey);
    expect(new Set(reads)).toEqual(new Set(f.objects.keys())); expect(reads).toHaveLength(f.objects.size);
    const checks = vi.mocked(options.check).mock.calls.map(([, a]) => a?.receipt.objectKey ?? null);
    expect(checks[0]).toBeNull(); expect(checks.at(-1)).toBeNull();
    for (const key of reads) expect(checks.filter(k => k === key)).toHaveLength(2);
    expect(result).not.toHaveProperty("records"); expect(result).not.toHaveProperty("publishedAt");
  });
  it("verifies all directories/pages rather than just a selected coordinate", async () => {
    const f = fresh(multiple), options = readOptions(f), result = await run(f, options);
    expect(result.artifacts.map(a => a.receipt.sequence)).toEqual([7, 8, 9, 10, 11, 12]);
    expect(result.blockCount).toBe(2); expect(result.recordCount).toBe(2200);
    expect(options.readArtifact).toHaveBeenCalledTimes(6);
  });
  it("retains GRCh37 unique unmapped loci separately from every unmapped record disposition", async () => {
    const f = await setup([row(1), row(30)], "GRCh37"), result = await run(f);
    expect(result.canonicalSummary).toMatchObject({ attempted: 2, unmapped: 1 });
    expect(result.counts.unmappedCount).toBe(2); expect(result.recordCount).toBe(4);
  });
  it("owns validated input before awaits and gives callbacks isolated copies", async () => {
    const f = fresh(), options = readOptions(f);
    options.check = vi.fn(async (manifest, artifact) => {
      manifest.counts.normalizedVariantCount = 0;
      if (artifact) artifact.receipt.sha256 = "f".repeat(64);
    });
    const pending = run(f, options); f.manifest.binding.source.sourceRevision++;
    const result = await pending; expect(result.binding.source.sourceRevision).toBe(baseline.binding.source.sourceRevision);
    expect(result.counts).toEqual(baseline.manifest.counts);
  });
  it.each(["directory", "coordinate", "data"])("refuses corrupt or absent %s objects", async kind => {
    for (const missing of [false, true]) {
      const f = fresh(), artifact = kind === "directory" ? f.manifest.directories[0].artifact
        : kind === "coordinate" ? f.manifest.coordinatePages[0].artifact : dataArtifact(f);
      if (missing) f.objects.delete(artifact.receipt.objectKey); else f.objects.get(artifact.receipt.objectKey)![0] ^= 1;
      await expect(run(f)).rejects.toBeInstanceOf(Error);
    }
  });
  it("rejects a plausible but false total data byte count after reading every object", async () => {
    const f = fresh(); f.manifest.byteCount++; expect(validateCanonicalMaterializationReceipt(f.manifest, f.expected)).toBeDefined();
    const options = readOptions(f); await expect(run(f, options)).rejects.toMatchObject({ code: "integrity_mismatch" });
    expect(options.readArtifact).toHaveBeenCalledTimes(f.objects.size);
  });
  it("rejects false coordinate bounds even when all page/root envelopes and byte hashes agree", async () => {
    const f = fresh(), p = page(f), entry = p.entries[0];
    entry.normalizedFirst!.pos = 2; entry.firstKey[2] = 2;
    const envelope = describeCanonicalCoordinateIndex(p);
    f.manifest.coordinatePages[0].envelope = envelope;
    f.manifest.coordinateSummary.normalizedFirst = envelope.normalizedFirst; f.manifest.coordinateSummary.firstKey = envelope.firstKey;
    updateObject(f, f.manifest.coordinatePages[0].artifact, json(p));
    expect(validateCanonicalMaterializationReceipt(f.manifest, f.expected)).toBeDefined();
    await expect(run(f)).rejects.toMatchObject({ code: "integrity_mismatch" });
  });
  it("counts actual usable observations independently of plausible root terminal counters", async () => {
    const f = fresh(); f.manifest.counts.usableObservedCount--; f.manifest.canonicalSummary.usableObservedCount--;
    f.manifest.mergeSummary.counts = copy(f.manifest.counts);
    expect(validateCanonicalMaterializationReceipt(f.manifest, f.expected)).toBeDefined();
    await expect(run(f)).rejects.toMatchObject({ code: "integrity_mismatch" });
  });
  it("rejects actual cross-block disorder despite valid codec bytes and consistent artifact hashes", async () => {
    const f = fresh(multiple), d = directory(f, 1), container = d.containers[0], range = container.descriptor.blocks[0];
    const decoded = await decodeCanonicalBlock(values([f.objects.get(container.artifact.receipt.objectKey)!]), range.descriptor);
    const first = decoded.records[0]; if (first.normalization.status !== "normalized") throw Error("fixture");
    first.normalization.record.pos = 1;
    const encoded = await encodeCanonicalBlock({ binding: f.binding, sequence: 1, records: decoded.records });
    const previousBytes = container.descriptor.byteCount;
    container.descriptor.blocks = [{ offset: 0, length: encoded.compressed.length, descriptor: encoded.descriptor }];
    container.descriptor.byteCount = encoded.compressed.length; container.descriptor.sha256 = sha(encoded.compressed);
    updateObject(f, container.artifact, encoded.compressed); updateObject(f, f.manifest.directories[1].artifact, json(d));
    const p = page(f, 1); p.entries[0].descriptor = encoded.descriptor;
    updateObject(f, f.manifest.coordinatePages[1].artifact, json(p));
    f.manifest.byteCount += encoded.compressed.length - previousBytes;
    expect(validateCanonicalMaterializationReceipt(f.manifest, f.expected)).toBeDefined();
    await expect(run(f)).rejects.toMatchObject({ code: "integrity_mismatch" });
  });
  it.each(["artifactId", "storageObjectId", "objectKey", "sequence"])("rejects cross-directory data %s aliasing with all outer hashes updated", async key => {
    const f = fresh(multiple), a = directory(f).containers[0].artifact, d = directory(f, 1), b = d.containers[0].artifact;
    if (key === "storageObjectId") b.storageObjectId = a.storageObjectId; else Reflect.set(b.receipt, key, Reflect.get(a.receipt, key));
    updateObject(f, f.manifest.directories[1].artifact, json(d));
    expect(validateCanonicalMaterializationReceipt(f.manifest, f.expected)).toBeDefined();
    await expect(run(f)).rejects.toMatchObject({ code: "integrity_mismatch" });
  });
  it("refuses an unaccounted artifact sequence/range before provider work", async () => {
    const f = fresh(), options = readOptions(f); f.manifest.nextArtifactSequence++; f.manifest.artifactCount++;
    await expect(run(f, options)).rejects.toMatchObject({ code: "invalid_manifest" }); expect(options.readArtifact).not.toHaveBeenCalled();
  });
  it("refuses data/index descriptor mismatch even when both metadata objects have valid hashes", async () => {
    const f = fresh(), p = page(f); p.entries[0].descriptor.decodedSha256 = "0".repeat(64);
    updateObject(f, f.manifest.coordinatePages[0].artifact, json(p));
    await expect(run(f)).rejects.toMatchObject({ code: "integrity_mismatch" });
  });
  it.each(["before", "after", "final"])("withholds the summary after authority denial %s reads", async phase => {
    const f = fresh(), options = readOptions(f); let rootChecks = 0, artifactChecks = 0;
    options.check = vi.fn(async (_, artifact) => {
      if (!artifact) { rootChecks++; if (phase === "final" && rootChecks === 2) throw Error("synthetic revoked"); }
      else { artifactChecks++; if (phase === "before" && artifactChecks === 1 || phase === "after" && artifactChecks === 2) throw Error("synthetic revoked"); }
    });
    await expect(run(f, options)).rejects.toMatchObject({ code: "unavailable", message: "unavailable" });
    expect(options.readArtifact).toHaveBeenCalledTimes(phase === "before" ? 0 : phase === "after" ? 1 : f.objects.size);
  });
  it("does not pull another object until the current object's post-read check finishes", async () => {
    const f = fresh(), options = readOptions(f); let release!: () => void, reached!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), atGate = new Promise<void>(resolve => { reached = resolve; });
    let artifactChecks = 0;
    options.check = vi.fn(async (_, artifact) => { if (artifact && ++artifactChecks === 2) { reached(); await gate; } });
    const pending = run(f, options); await atGate; expect(options.readArtifact).toHaveBeenCalledTimes(1);
    release(); await pending; expect(options.readArtifact).toHaveBeenCalledTimes(f.objects.size);
  });
  it("has a finite overall ceiling even when the final root check never cooperates", async () => {
    const f = fresh(), options = readOptions(f); let rootChecks = 0, final!: () => void;
    const finalStarted = new Promise<void>(resolve => { final = resolve; });
    options.check = vi.fn(async (_, artifact) => { if (!artifact && ++rootChecks === 2) { final(); await new Promise(() => {}); } });
    vi.useFakeTimers();
    try {
      const pending = run(f, options), rejected = expect(pending).rejects.toMatchObject({ code: "aborted" });
      await finalStarted; await vi.advanceTimersByTimeAsync(300_000); await rejected;
      expect(options.readArtifact).toHaveBeenCalledTimes(f.objects.size);
    } finally { vi.useRealTimers(); }
  });
});

function helperFixture() {
  const bytes = Buffer.from("Synthetic immutable artifact; no genetic content."), artifact = dataArtifact(baseline);
  artifact.receipt.byteCount = bytes.length; artifact.receipt.sha256 = sha(bytes);
  const controller = new AbortController(), options: VerifiedArtifactReadOptions = {
    signal: controller.signal, check: vi.fn(async () => {}), readArtifact: vi.fn(() => values([bytes])),
  };
  return { bytes, artifact, controller, options };
}
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function idleStream() {
  const started = deferred<void>(), next = vi.fn(() => { started.resolve(); return new Promise<IteratorResult<Uint8Array>>(() => {}); });
  const close = vi.fn(async (): Promise<IteratorResult<Uint8Array>> => ({ done: true, value: undefined }));
  return { started, next, close, source: { [Symbol.asyncIterator]: () => ({ next, return: close }) } };
}
describe("bounded verified whole-artifact reader", () => {
  it("owns artifact metadata and chunk bytes before callbacks or further pulls can mutate them", async () => {
    const f = helperFixture(), original = copy(f.artifact), chunk = Uint8Array.from(f.bytes);
    f.options.check = vi.fn(async artifact => { artifact.receipt.sha256 = "f".repeat(64); });
    f.options.readArtifact = vi.fn(artifact => {
      expect(artifact).toEqual(original); artifact.receipt.byteCount = 1;
      return (async function* () { yield chunk; chunk.fill(0); })();
    });
    const pending = readVerifiedPreparedArtifact(f.artifact, f.options); f.artifact.receipt.sha256 = "0".repeat(64);
    expect(await pending).toEqual(Uint8Array.from(f.bytes)); expect(f.options.check).toHaveBeenCalledTimes(2);
  });
  it.each(["short", "extra", "hash", "nonbytes", "late-failure"])("rejects %s output and never invokes the post-read check", async kind => {
    const f = helperFixture();
    f.options.readArtifact = () => (async function* () {
      if (kind === "short") { yield f.bytes.subarray(1); return; }
      if (kind === "hash") { yield Buffer.alloc(f.bytes.length); return; }
      if (kind === "nonbytes") { yield "not bytes" as unknown as Uint8Array; return; }
      yield f.bytes;
      if (kind === "extra") yield Uint8Array.of(1);
      if (kind === "late-failure") throw Error("synthetic private provider diagnostic");
    })();
    await expect(readVerifiedPreparedArtifact(f.artifact, f.options)).rejects.toBeInstanceOf(Error);
    expect(f.options.check).toHaveBeenCalledTimes(1);
  });
  it("waits beyond the complete expected prefix for actual EOF", async () => {
    const f = helperFixture(), end = deferred<void>(), emitted = deferred<void>(); let finished = false;
    f.options.readArtifact = () => (async function* () { yield f.bytes; emitted.resolve(); await end.promise; })();
    const pending = readVerifiedPreparedArtifact(f.artifact, f.options).then(result => { finished = true; return result; });
    await emitted.promise; expect(finished).toBe(false); expect(f.options.check).toHaveBeenCalledTimes(1);
    end.resolve(); await pending; expect(f.options.check).toHaveBeenCalledTimes(2);
  });
  it.each(["size", "key", "version", "hidden-getter"])("refuses malformed %s before callbacks or allocation", async kind => {
    const f = helperFixture(); let invoked = false;
    if (kind === "size") f.artifact.receipt.byteCount = 8_388_609;
    if (kind === "key") f.artifact.receipt.objectKey = "../original";
    if (kind === "version") Reflect.set(f.artifact.receipt, "version", "future");
    if (kind === "hidden-getter") Object.defineProperty(f.artifact, "receipt", { get() { invoked = true; throw Error("must not execute"); } });
    await expect(readVerifiedPreparedArtifact(f.artifact, f.options)).rejects.toMatchObject({ code: "invalid_artifact" });
    expect(invoked).toBe(false); expect(f.options.check).not.toHaveBeenCalled(); expect(f.options.readArtifact).not.toHaveBeenCalled();
  });
  it("cancels a stalled acquired iterator once and does not retry", async () => {
    const f = helperFixture(), stream = idleStream(); f.options.readArtifact = vi.fn(() => stream.source);
    const pending = readVerifiedPreparedArtifact(f.artifact, f.options), rejected = expect(pending).rejects.toMatchObject({ code: "aborted" });
    await stream.started.promise; f.controller.abort(); await rejected;
    expect(stream.close).toHaveBeenCalledTimes(1); expect(f.options.readArtifact).toHaveBeenCalledTimes(1); expect(f.options.check).toHaveBeenCalledTimes(1);
  });
  it("closes a stream arriving after cancellation without pulling it", async () => {
    const f = helperFixture(), stream = idleStream(), arrived = deferred<AsyncIterable<Uint8Array>>(), started = deferred<void>();
    f.options.readArtifact = () => { started.resolve(); return arrived.promise; };
    const pending = readVerifiedPreparedArtifact(f.artifact, f.options), rejected = expect(pending).rejects.toMatchObject({ code: "aborted" });
    await started.promise; f.controller.abort(); await rejected; arrived.resolve(stream.source);
    await Promise.resolve(); await Promise.resolve(); expect(stream.close).toHaveBeenCalledTimes(1); expect(stream.next).not.toHaveBeenCalled();
  });
  it("closes the resolved iterator if abort lands before the awaiting continuation", async () => {
    const f = helperFixture(), stream = idleStream(), arrived = deferred<AsyncIterable<Uint8Array>>(), started = deferred<void>();
    f.options.readArtifact = () => { started.resolve(); return arrived.promise; };
    const pending = readVerifiedPreparedArtifact(f.artifact, f.options), rejected = expect(pending).rejects.toMatchObject({ code: "aborted" });
    await started.promise; arrived.resolve(stream.source); queueMicrotask(() => f.controller.abort()); await rejected;
    expect(stream.close).toHaveBeenCalledTimes(1); expect(stream.next).not.toHaveBeenCalled();
  });
  it.each(["check", "read"])("observes a synchronously aborted %s rejection without leaking it", async stage => {
    const f = helperFixture();
    const fail = () => { f.controller.abort(); return Promise.reject(Error("synthetic private provider diagnostic")); };
    if (stage === "check") f.options.check = fail; else f.options.readArtifact = fail;
    await expect(readVerifiedPreparedArtifact(f.artifact, f.options)).rejects.toMatchObject({ code: "aborted", message: "aborted" });
    await new Promise(resolve => setImmediate(resolve));
  });
  it("never lets cleanup failure mask original integrity failure", async () => {
    const f = helperFixture(); let count = 0;
    f.options.readArtifact = () => ({ [Symbol.asyncIterator]: () => ({
      next: async () => ++count === 1 ? { done: false, value: Buffer.alloc(f.bytes.length) } : { done: true, value: undefined },
      return: () => { throw Error("synthetic cleanup error"); },
    }) });
    await expect(readVerifiedPreparedArtifact(f.artifact, f.options)).rejects.toMatchObject({ code: "integrity_mismatch" });
  });
  it.each(["check", "acquire", "body"])("stops a noncooperative %s after30s", async stage => {
    const f = helperFixture(), started = deferred<void>(), stream = idleStream();
    if (stage === "check") f.options.check = async () => { started.resolve(); await new Promise(() => {}); };
    if (stage === "acquire") f.options.readArtifact = () => { started.resolve(); return new Promise(() => {}); };
    if (stage === "body") f.options.readArtifact = () => { started.resolve(); return stream.source; };
    vi.useFakeTimers();
    try {
      const pending = readVerifiedPreparedArtifact(f.artifact, f.options), rejected = expect(pending).rejects.toMatchObject({ code: "aborted" });
      await started.promise; await vi.advanceTimersByTimeAsync(30_000); await rejected;
      if (stage === "body") expect(stream.close).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("refuses already cancelled work without callbacks", async () => {
    const f = helperFixture(); f.controller.abort();
    await expect(readVerifiedPreparedArtifact(f.artifact, f.options)).rejects.toMatchObject({ code: "aborted" });
    expect(f.options.readArtifact).not.toHaveBeenCalled(); expect(f.options.check).not.toHaveBeenCalled();
  });
});
