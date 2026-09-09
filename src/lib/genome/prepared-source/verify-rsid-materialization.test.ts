import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { row } from "./materialize-canonical.fixtures";
import { publicationFixture as setup } from "./prepare-genome-publication.fixtures";
import { verifyCanonicalRsidMaterialization, validateCanonicalRsidMaterialization } from "./verify-rsid-materialization";
import type { PreparedStoredArtifact } from "./storage-writer";

describe("full final rsID byte verification", () => {
  it("verifies every real materialized member and exact pointer-stream digest", async () => {
    const f = await setup(Array.from({ length: 1100 }, (_, i) => row(i + 1)));
    const verified = await verifyCanonicalRsidMaterialization(f.root, f.expected, f);
    const pointers = f.records.flatMap((record, i) => {
      const event = record.event, rsid = event.type === "reference" ? null : (event.type === "variant" ? event.record : event.call).rsid;
      return rsid === null ? [] : [{ rsid, blockSequence: Math.floor(i / 2000), recordOffset: i % 2000 }];
    }).sort((a, b) => a.rsid - b.rsid || a.blockSequence - b.blockSequence || a.recordOffset - b.recordOffset);
    const digest = createHash("sha256"); for (const pointer of pointers) digest.update(`${pointer.rsid}:${pointer.blockSequence}:${pointer.recordOffset}\n`);
    expect(verified).toMatchObject({ state: "provisional", pointerCount: pointers.length,
      canonicalBlockCount: f.canonical.blockCount, canonicalRecordCount: f.canonical.recordCount,
      blockCount: f.root.blockCount, containerCount: f.root.containerCount, byteCount: f.root.byteCount,
      pointerSha256: digest.digest("hex") });
    expect(verified.artifacts.map(a => a.receipt.sequence)).toEqual(Array.from({ length: f.root.artifactCount }, (_, i) => f.root.firstArtifactSequence + i));
    expect(f.readArtifact).toHaveBeenCalledTimes(f.root.artifactCount);
    expect(f.check.mock.calls.filter(([, artifact]) => artifact === null)).toHaveLength(2);
  });

  it("accepts zero-ID sources without invented index members or reads", async () => {
    const f = await setup([row(1).replace("rs1", ".")]);
    const verified = await verifyCanonicalRsidMaterialization(f.root, f.expected, f);
    expect(verified).toMatchObject({ pointerCount: 0, artifactCount: 0, blockCount: 0, containerCount: 0, byteCount: 0, artifacts: [],
      pointerSha256: createHash("sha256").digest("hex") });
    expect(f.readArtifact).not.toHaveBeenCalled(); expect(f.check).toHaveBeenCalledTimes(2);
  });

  it.each(["binding", "canonical-count", "scan-count", "sequence", "bounds", "member-count", "extra-field"])("refuses altered %s root metadata before I/O", async mode => {
    const f = await setup(), root = structuredClone(f.root);
    if (mode === "binding") root.binding.source.sourceRevision++;
    if (mode === "canonical-count") root.canonicalRecordCount++;
    if (mode === "scan-count") root.scanSummary.pointerCount++;
    if (mode === "sequence") root.directories[0].firstBlockSequence++;
    if (mode === "bounds") root.directories[0].first.rsid++;
    if (mode === "member-count") root.artifactCount++;
    if (mode === "extra-field") Object.assign(root, { publish: true });
    await expect(verifyCanonicalRsidMaterialization(root, f.expected, f)).rejects.toBeInstanceOf(Error);
    expect(f.readArtifact).not.toHaveBeenCalled();
  });

  it("checks actual data byte totals, not only plausible root limits", async () => {
    const f = await setup(), root = { ...f.root, byteCount: f.root.byteCount + 1 };
    expect(validateCanonicalRsidMaterialization(root, f.expected).byteCount).toBe(root.byteCount);
    await expect(verifyCanonicalRsidMaterialization(root, f.expected, f)).rejects.toMatchObject({ code: "integrity_mismatch" });
    expect(f.readArtifact).toHaveBeenCalledTimes(root.artifactCount);
  });

  it.each(["directory", "data"])("refuses corrupted %s bytes", async role => {
    const f = await setup();
    const directoryKey = f.root.directories[0].artifact.receipt.objectKey;
    const key = role === "directory" ? directoryKey : (JSON.parse(Buffer.from(f.objects.get(directoryKey)!).toString()).containers[0].artifact as PreparedStoredArtifact).receipt.objectKey;
    f.objects.get(key)![0] ^= 1;
    await expect(verifyCanonicalRsidMaterialization(f.root, f.expected, f)).rejects.toBeInstanceOf(Error);
  });

  it("rejects a directory whose hash matches but whose data object identity is reused", async () => {
    const f = await setup(), root = structuredClone(f.root), ref = root.directories[0];
    const page = JSON.parse(Buffer.from(f.objects.get(ref.artifact.receipt.objectKey)!).toString());
    Reflect.set(page.containers[0].artifact, "storageObjectId", Reflect.get(ref.artifact, "storageObjectId"));
    const bytes = Buffer.from(JSON.stringify(page));
    ref.artifact.receipt.byteCount = bytes.length; ref.artifact.receipt.sha256 = createHash("sha256").update(bytes).digest("hex");
    f.objects.set(ref.artifact.receipt.objectKey, bytes);
    await expect(verifyCanonicalRsidMaterialization(root, f.expected, f)).rejects.toMatchObject({ code: "integrity_mismatch" });
    expect(f.readArtifact).toHaveBeenCalledTimes(1);
  });

  it("requires full EOF beyond the exact expected prefix", async () => {
    const f = await setup(), actual = f.readArtifact.getMockImplementation()!;
    f.readArtifact.mockImplementation((artifact, signal) => (async function* () {
      yield* actual(artifact, signal); yield new Uint8Array([1]);
    })());
    await expect(verifyCanonicalRsidMaterialization(f.root, f.expected, f)).rejects.toBeInstanceOf(Error);
    expect(f.readArtifact).toHaveBeenCalledTimes(1);
  });

  it("suppresses verified membership after final authority refusal", async () => {
    const f = await setup(); let rootChecks = 0;
    f.check.mockImplementation(async (_root, artifact) => { if (!artifact && ++rootChecks === 2) throw new Error("synthetic revoked"); });
    await expect(verifyCanonicalRsidMaterialization(f.root, f.expected, f)).rejects.toMatchObject({ code: "unavailable" });
    expect(f.readArtifact).toHaveBeenCalledTimes(f.root.artifactCount);
  });

  it("owns all callback metadata so mutations cannot change the proof", async () => {
    const f = await setup();
    f.check.mockImplementation(async (root, artifact) => {
      root.pointerCount++; if (artifact) artifact.receipt.sha256 = "f".repeat(64);
    });
    expect((await verifyCanonicalRsidMaterialization(f.root, f.expected, f)).pointerCount).toBe(f.root.pointerCount);
  });

  it("cancels a stalled final check without returning a verified root", async () => {
    const f = await setup(), controller = new AbortController(), entered = Promise.withResolvers<void>(); let roots = 0;
    f.check.mockImplementation(async (_root, artifact) => {
      if (!artifact && ++roots === 2) { entered.resolve(); return new Promise(() => {}); }
    });
    const pending = verifyCanonicalRsidMaterialization(f.root, f.expected, { ...f, signal: controller.signal });
    await entered.promise; controller.abort(); await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });
});
