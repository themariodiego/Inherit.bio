import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnPreparationPipelineOptions } from "./own-preparation-pipeline";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), pipeline: vi.fn(), write: vi.fn(), read: vi.fn(), chain: vi.fn() }));
vi.mock("../supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("../genome/prepared-source/storage-common", async importOriginal => ({ ...await importOriginal<typeof import("../genome/prepared-source/storage-common")>(), preparedStorageConfig: () => ({ origin: "https://synthetic.example.invalid", key: "synthetic-worker-key" }) }));
vi.mock("../genome/prepared-source/storage-writer", () => ({ createPreparedArtifactWriter: () => mocks.write }));
vi.mock("../genome/prepared-source/storage-artifact-fetch", () => ({ createPreparedArtifactFetch: () => mocks.read }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.chain }));
vi.mock("./own-preparation-pipeline", () => ({ runOwnPreparationPipeline: mocks.pipeline }));
import { runNextOwnPreparation } from "./own-preparation-worker";
function fixture() {
  const now = Date.now(), jobId = randomUUID(), attemptId = randomUUID();
  const source = { fileId: randomUUID(), subjectId: randomUUID(), sourceRevision: 1,
    rawSha256: "a".repeat(64), decodedSha256: "b".repeat(64), bucket: "genomes", objectId: randomUUID(), objectKey: randomUUID(),
    sizeBytes: 100, fileType: "vcf", maximumDecodedBytes: 1000 };
  const claim = { version: "own-preparation-claim-v1", jobId, attemptId, claimExpiresAt: new Date(now + 300_000).toISOString(),
    jobDeadline: new Date(now + 900_000).toISOString(), source, authority: { bindingId: randomUUID() } };
  const actor = { accountId: randomUUID(), sessionId: randomUUID() };
  const artifact = { receipt: { version: "own-preparation-artifact-v2", provider: "r2", bucket: "inherit-prepared-synthetic",
    artifactId: randomUUID(), jobId, attemptId, sequence: 0, objectKey: `prepared/${randomUUID()}`,
    byteCount: 1, sha256: createHash("sha256").update("x").digest("hex"), writeExpiresAt: claim.claimExpiresAt },
    providerVersion: "1".repeat(32), etag: "2".repeat(32) };
  const summary = { version: "own-prepared-summary-v1", variantCount: 1 };
  const publication = { rootArtifact: artifact, members: [artifact], payload: { version: "own-prepared-publication-v1",
    rootArtifactId: artifact.receipt.artifactId, memberIds: [artifact.receipt.artifactId], summary } };
  const published = { version: "own-prepared-source-v1", backend: "prepared-object-v1", manifestId: randomUUID(),
    fileId: source.fileId, subjectId: source.subjectId, sourceRevision: 1, rawSha256: source.rawSha256,
    decodedSha256: source.decodedSha256, preparedAt: new Date(now).toISOString(), root: artifact, summary,
    memberCount: 1, membershipSha256: "c".repeat(64) };
  const checkpoint = { version: "own-preparation-checkpoint-receipt-v1", jobId, attemptId, revision: 0,
    nextArtifactSequence: 0, checkpoint: null };
  const overrides = new Map<string, (args: Record<string, unknown>, signal: AbortSignal) => unknown>();
  mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => ({ abortSignal: async (signal: AbortSignal) => {
    if (overrides.has(name)) return overrides.get(name)!(args, signal);
    let data: unknown;
    switch (name) {
      case "claim_next_own_preparation_work_v1": data = { claim, actor }; break;
      case "check_own_preparation_claim_v1": data = claim; break;
      case "renew_own_preparation_claim_v1": claim.claimExpiresAt = new Date(Math.min(Date.now() + 300_000, Date.parse(claim.jobDeadline))).toISOString(); data = claim; break;
      case "read_own_preparation_checkpoint_v1": data = checkpoint; break;
      case "check_own_preparation_artifact_v1": data = args.p_expected_artifact; break;
      case "write_own_preparation_checkpoint_v1": data = { ...checkpoint, revision: Number(args.p_expected_revision) + 1,
        checkpoint: args.p_checkpoint, nextArtifactSequence: (args.p_checkpoint as { nextArtifactSequence: number }).nextArtifactSequence }; break;
      case "publish_own_prepared_manifest_v1": data = published; break;
      default: throw new Error(`unexpected RPC ${name}`);
    }
    return { data: structuredClone(data), error: null };
  } }));
  mocks.pipeline.mockResolvedValue({ publication });
  return { source, claim, actor, artifact, publication, published, checkpoint, overrides };
}
const called = (name: string) => mocks.rpc.mock.calls.filter(([n]) => n === name);
beforeEach(() => { vi.resetAllMocks(); mocks.chain.mockResolvedValue(Buffer.from("synthetic chain")); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("actual preparation worker protocol adapter (transport and pipeline mocked)", () => {
  it("returns idle without creating transports or reading original when no claim exists", async () => {
    const f = fixture(); f.overrides.set("claim_next_own_preparation_work_v1", () => ({ data: null, error: null }));
    expect(await runNextOwnPreparation()).toEqual({ status: "idle" });
    expect(mocks.pipeline).not.toHaveBeenCalled(); expect(mocks.chain).not.toHaveBeenCalled();
  });
  it("binds actual actor, random claim, source, checkpoint, artifacts and exact terminal publication", async () => {
    const f = fixture();
    mocks.pipeline.mockImplementation(async (o: OwnPreparationPipelineOptions) => {
      expect(o.original.source).toEqual(f.source); expect(o.firstArtifactSequence).toBe(0);
      expect(o.writeArtifact).toBe(mocks.write); expect(o.readArtifact).toBe(mocks.read);
      await o.original.check(o.original.source, o.signal);
      await o.check(f.artifact as Parameters<typeof o.check>[0], o.signal);
      const checkpoint = { nextArtifactSequence: 1, phase: "source-scan" } as Parameters<typeof o.checkpoint>[0];
      expect(await o.checkpoint(checkpoint, o.signal)).toEqual(checkpoint);
      return { publication: f.publication };
    });
    const result = await runNextOwnPreparation({ expectedFileId: f.source.fileId });
    expect(result).toEqual({ status: "prepared", fileId: f.source.fileId, jobId: f.claim.jobId, manifestId: f.published.manifestId });
    expect(called("publish_own_prepared_manifest_v1")[0][1]).toMatchObject({ p_account_id: f.actor.accountId,
      p_session_id: f.actor.sessionId, p_payload: f.publication.payload });
    const token = called("claim_next_own_preparation_work_v1")[0][1].p_claim_token_hash;
    expect(token).toMatch(/^[0-9a-f]{64}$/); expect(JSON.stringify(result)).not.toContain(token);
    expect(called("write_own_preparation_checkpoint_v1")[0][1].p_expected_revision).toBe(0);
  });
  it("issues exact authenticated original ranges with no redirect/cache", async () => {
    const f = fixture(), fetcher = vi.fn().mockResolvedValue(new Response("x", { status: 206 })); vi.stubGlobal("fetch", fetcher);
    mocks.pipeline.mockImplementation(async (o: OwnPreparationPipelineOptions) => {
      await o.original.readRange(o.original.source, 0, 99, o.signal); return { publication: f.publication };
    });
    await runNextOwnPreparation();
    expect(fetcher).toHaveBeenCalledWith(`https://synthetic.example.invalid/storage/v1/object/authenticated/genomes/${f.source.objectKey}`,
      expect.objectContaining({ cache: "no-store", redirect: "error", headers: expect.objectContaining({ Range: "bytes=0-99", "Accept-Encoding": "identity" }) }));
  });
  it("refuses another queued file before processing", async () => {
    fixture(); await expect(runNextOwnPreparation({ expectedFileId: randomUUID() })).rejects.toMatchObject({ code: "integrity_mismatch" });
    expect(mocks.pipeline).not.toHaveBeenCalled(); expect(called("publish_own_prepared_manifest_v1")).toHaveLength(0);
  });
  it.each(["source", "authority", "attemptId"])("refuses changed current %s before publication", async field => {
    const f = fixture(); f.overrides.set("check_own_preparation_claim_v1", () => ({ error: null,
      data: { ...f.claim, [field]: field === "source" ? { ...f.source, sourceRevision: 2 } : field === "authority" ? {} : randomUUID() } }));
    await expect(runNextOwnPreparation()).rejects.toMatchObject({ code: "integrity_mismatch" });
    expect(called("publish_own_prepared_manifest_v1")).toHaveLength(0);
  });
  it("refuses an exact-artifact authority mismatch", async () => {
    const f = fixture(); f.overrides.set("check_own_preparation_artifact_v1", () => ({ error: null, data: { ...f.artifact, etag: "3".repeat(32) } }));
    mocks.pipeline.mockImplementation(async (o: OwnPreparationPipelineOptions) => { await o.check(f.artifact as Parameters<typeof o.check>[0], o.signal); });
    await expect(runNextOwnPreparation()).rejects.toMatchObject({ code: "integrity_mismatch" });
    expect(called("publish_own_prepared_manifest_v1")).toHaveLength(0);
  });
  it("refuses a stale or altered checkpoint acknowledgment", async () => {
    const f = fixture(); f.overrides.set("write_own_preparation_checkpoint_v1", () => ({ error: null, data: f.checkpoint }));
    mocks.pipeline.mockImplementation(async (o: OwnPreparationPipelineOptions) => { await o.checkpoint({ nextArtifactSequence: 1 } as Parameters<typeof o.checkpoint>[0], o.signal); });
    await expect(runNextOwnPreparation()).rejects.toMatchObject({ code: "integrity_mismatch" });
  });
  it("does not adopt previous process checkpoint or untracked artifact sequence", async () => {
    const f = fixture(); f.checkpoint.nextArtifactSequence = 1;
    await expect(runNextOwnPreparation()).rejects.toMatchObject({ code: "integrity_mismatch" }); expect(mocks.pipeline).not.toHaveBeenCalled();
  });
  it.each(["rawSha256", "root", "summary", "memberCount"])("refuses incorrect published %s", async field => {
    const f = fixture(); Object.assign(f.published, { [field]: field === "rawSha256" ? "d".repeat(64) : field === "root" ? { ...f.artifact, etag: "3".repeat(32) } : field === "summary" ? {} : 2 });
    await expect(runNextOwnPreparation()).rejects.toMatchObject({ code: "integrity_mismatch" });
    expect(called("publish_own_prepared_manifest_v1")).toHaveLength(1);
  });
  it("does not retry uncertain publication or leak provider diagnostics", async () => {
    const f = fixture(); f.overrides.set("publish_own_prepared_manifest_v1", () => { throw new Error("synthetic private provider detail"); });
    await expect(runNextOwnPreparation()).rejects.toThrow(/^unavailable$/);
    expect(called("publish_own_prepared_manifest_v1")).toHaveLength(1);
  });
  it("renews the same live attempt while work is running and settles renewal before publish", async () => {
    vi.useFakeTimers(); const f = fixture(); let release!: () => void;
    mocks.pipeline.mockImplementation(() => new Promise(resolve => { release = () => resolve({ publication: f.publication }); }));
    const work = runNextOwnPreparation(); await vi.advanceTimersByTimeAsync(120_001);
    expect(called("renew_own_preparation_claim_v1")).toHaveLength(1);
    release(); await expect(work).resolves.toMatchObject({ status: "prepared" });
    await vi.advanceTimersByTimeAsync(240_000); expect(called("renew_own_preparation_claim_v1")).toHaveLength(1);
  });
  it("aborts the pipeline when renewal is refused, without terminal publication", async () => {
    vi.useFakeTimers(); const f = fixture(); f.overrides.set("renew_own_preparation_claim_v1", () => ({ error: {}, data: null }));
    mocks.pipeline.mockImplementation((o: OwnPreparationPipelineOptions) => new Promise((_, reject) => o.signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true })));
    const assertion = expect(runNextOwnPreparation()).rejects.toMatchObject({ code: "aborted" });
    await vi.advanceTimersByTimeAsync(120_001); await assertion; expect(called("publish_own_prepared_manifest_v1")).toHaveLength(0);
  });
  it("bounds a stalled RPC to 30 seconds even if the mocked client ignores cancellation", async () => {
    vi.useFakeTimers(); const f = fixture(); f.overrides.set("claim_next_own_preparation_work_v1", () => new Promise(() => {}));
    const assertion = expect(runNextOwnPreparation()).rejects.toMatchObject({ code: "aborted" });
    await vi.advanceTimersByTimeAsync(30_001); await assertion;
  });
  it("refuses an expired claim and a job beyond the one-hour ceiling", async () => {
    const f = fixture(); f.claim.claimExpiresAt = new Date(Date.now() - 1).toISOString();
    await expect(runNextOwnPreparation()).rejects.toMatchObject({ code: "unavailable" });
    f.claim.jobDeadline = new Date(Date.now() + 3_700_000).toISOString();
    await expect(runNextOwnPreparation()).rejects.toMatchObject({ code: "integrity_mismatch" });
  });
  it("honors an already aborted invocation before any claim", async () => {
    fixture(); await expect(runNextOwnPreparation({ signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "aborted" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
