import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { publicationFixture } from "./prepare-genome-publication.fixtures";
import { row, jobId, attemptId } from "./materialize-canonical.fixtures";
import { prepareGenomePublication, type PreparedGenomeRoot } from "./prepare-genome-publication";
import type { PreparedStoredArtifact } from "./storage-writer";

async function setup(rows?: string[], build: "GRCh37" | "GRCh38" = "GRCh38", scratchGap = 0) {
  const f = await publicationFixture(rows, build, scratchGap);
  f.writeArtifact.mockClear(); f.readArtifact.mockClear();
  const check = vi.fn<(artifact: PreparedStoredArtifact | null, signal: AbortSignal) => Promise<void>>(async () => {});
  const input = { canonical: f.canonical, rsid: f.root,
    expected: { binding: f.binding, jobId, attemptId, firstRsidArtifactSequence: f.root.firstArtifactSequence } };
  return { ...f, input, check };
}

describe("verified genome publication input", () => {
  it("assembles real canonical and rsID byte proofs into three exact registered roots and final membership", async () => {
    const f = await setup(), result = await prepareGenomePublication(f.input, f);
    expect(result.state).toBe("provisional");
    expect(f.readArtifact).toHaveBeenCalledTimes(f.canonical.artifactCount + f.root.artifactCount);
    expect(f.writeArtifact).toHaveBeenCalledTimes(3);
    expect(result.members).toHaveLength(f.canonical.artifactCount + f.root.artifactCount + 3);
    expect(result.payload.memberIds).toEqual(result.members.map(a => a.receipt.artifactId).sort());
    expect(result.payload.rootArtifactId).toBe(result.rootArtifact.receipt.artifactId);
    const read = (artifact: PreparedStoredArtifact) => JSON.parse(Buffer.from(f.objects.get(artifact.receipt.objectKey)!).toString());
    expect(read(result.canonicalRoot)).toEqual(f.canonical);
    expect(read(result.rsidRoot)).toEqual(f.root);
    const root = read(result.rootArtifact) as PreparedGenomeRoot;
    expect(root).toMatchObject({ state: "provisional", canonical: result.canonicalRoot, rsid: result.rsidRoot,
      binding: f.binding, summary: result.payload.summary });
    expect(root.rsidPointerSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.payload.summary).toMatchObject({ variantCount: f.canonical.counts.normalizedVariantCount,
      observedCallCount: f.canonical.counts.normalizedObservedCount, sourceVariantCount: f.canonical.counts.sourceVariantCount,
      rsidPointerCount: f.root.pointerCount, attempted: 0, unmapped: 0 });
    for (const artifact of [result.canonicalRoot, result.rsidRoot, result.rootArtifact]) {
      const bytes = f.objects.get(artifact.receipt.objectKey)!;
      expect(artifact.receipt.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
  });

  it("excludes registered scratch sequences between canonical and final rsID materialization", async () => {
    const f = await setup(undefined, "GRCh38", 4);
    const result = await prepareGenomePublication(f.input, f);
    expect(result.members).toHaveLength(f.canonical.artifactCount + f.root.artifactCount + 3);
    for (const artifact of f.scratch) {
      expect(result.payload.memberIds).not.toContain(artifact.receipt.artifactId);
      expect(f.objects.has(artifact.receipt.objectKey)).toBe(true);
    }
  });

  it.each(["overlap", "mismatch"])("refuses %s expected rsID sequence before reads or writes", async mode => {
    const f = await setup(undefined, "GRCh38", 4);
    f.input.expected.firstRsidArtifactSequence = mode === "overlap" ? f.canonical.nextArtifactSequence - 1 : f.root.firstArtifactSequence + 1;
    await expect(prepareGenomePublication(f.input, f)).rejects.toBeInstanceOf(Error);
    expect(f.readArtifact).not.toHaveBeenCalled(); expect(f.writeArtifact).not.toHaveBeenCalled();
  });

  it("supports unnamed variants with an explicit empty rsID root", async () => {
    const f = await setup([row(1).replace("rs1", ".")]);
    const result = await prepareGenomePublication(f.input, f);
    expect(result.payload.summary.rsidPointerCount).toBe(0);
    expect(result.members).toHaveLength(f.canonical.artifactCount + 3);
    expect(f.writeArtifact).toHaveBeenCalledTimes(3);
  });

  it("preserves GRCh37 unique source locus accounting independently of record dispositions", async () => {
    const f = await setup([row(1), row(1), row(20)], "GRCh37");
    const result = await prepareGenomePublication(f.input, f);
    expect(result.payload.summary).toMatchObject({ sourceBuild: "GRCh37", attempted: f.canonical.canonicalSummary.attempted,
      unmapped: f.canonical.canonicalSummary.unmapped });
    expect(result.payload.summary.attempted).toBe(2); expect(result.payload.summary.unmapped).toBe(1);
  });

  it.each(["canonical", "rsid"])("refuses corrupted %s members before creating any publication roots", async phase => {
    const f = await setup(), artifact = (phase === "canonical" ? f.canonical : f.root).directories[0].artifact;
    f.objects.get(artifact.receipt.objectKey)![0] ^= 1;
    await expect(prepareGenomePublication(f.input, f)).rejects.toBeInstanceOf(Error);
    expect(f.writeArtifact).not.toHaveBeenCalled();
  });

  it.each(["job", "attempt", "sequence", "hash", "object", "bytes"])("refuses an altered %s root acknowledgment without continuing publication", async mode => {
    const f = await setup(), actual = f.writeArtifact.getMockImplementation()!;
    f.writeArtifact.mockImplementation(async (input, signal) => {
      const ack = await actual(input, signal);
      if (mode === "job") ack.receipt.jobId = "99999999-9999-4999-8999-999999999999";
      if (mode === "attempt") ack.receipt.attemptId = "99999999-9999-4999-8999-999999999999";
      if (mode === "sequence") ack.receipt.sequence++;
      if (mode === "hash") ack.receipt.sha256 = "f".repeat(64);
      if (mode === "object") Reflect.set(ack, "storageObjectId", Reflect.get(f.canonical.directories[0].artifact, "storageObjectId"));
      if (mode === "bytes") input.bytes[0] ^= 1;
      return ack;
    });
    await expect(prepareGenomePublication(f.input, f)).rejects.toMatchObject({ code: "integrity_mismatch" });
    expect(f.writeArtifact).toHaveBeenCalledTimes(1);
  });

  it("keeps acknowledged partial roots cleanup-owned after a later writer failure", async () => {
    const f = await setup(), actual = f.writeArtifact.getMockImplementation()!, before = f.objects.size;
    f.writeArtifact.mockImplementationOnce(actual).mockRejectedValueOnce(new Error("synthetic provider failure"));
    await expect(prepareGenomePublication(f.input, f)).rejects.toMatchObject({ code: "unavailable" });
    expect(f.writeArtifact).toHaveBeenCalledTimes(2); expect(f.objects.size).toBe(before + 1);
  });

  it("suppresses the entire payload when final current authority is refused", async () => {
    const f = await setup();
    f.check.mockImplementation(async artifact => { if (artifact === null && f.writeArtifact.mock.calls.length === 3) throw new Error("synthetic revoked"); });
    await expect(prepareGenomePublication(f.input, f)).rejects.toMatchObject({ code: "unavailable" });
    expect(f.writeArtifact).toHaveBeenCalledTimes(3);
  });

  it("owns source inputs and callback artifact metadata before external calls", async () => {
    const f = await setup(), saved = structuredClone(f.input);
    f.check.mockImplementation(async artifact => {
      f.input.canonical.recordCount++; f.input.rsid.pointerCount++; f.input.expected.firstRsidArtifactSequence++;
      if (artifact) artifact.receipt.sha256 = "f".repeat(64);
    });
    const result = await prepareGenomePublication(f.input, f);
    expect(result.payload.summary.rsidPointerCount).toBe(saved.rsid.pointerCount);
    expect(result.canonicalRoot.receipt.sha256).toBe(createHash("sha256").update(JSON.stringify(saved.canonical)).digest("hex"));
  });

  it("cancels a stalled root writer and never returns a publication payload", async () => {
    const f = await setup(), controller = new AbortController(), entered = Promise.withResolvers<void>();
    f.writeArtifact.mockImplementation(async () => { entered.resolve(); return new Promise(() => {}); });
    const pending = prepareGenomePublication(f.input, { ...f, signal: controller.signal });
    await entered.promise; controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" }); expect(f.writeArtifact).toHaveBeenCalledTimes(1);
  });
});
