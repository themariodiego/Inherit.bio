import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
const r2 = vi.hoisted(() => vi.fn());
vi.mock("./r2-transport", () => ({ fetchPreparedR2: r2 }));
import { createPreparedArtifactWriter } from "./storage-writer";
import { createPreparedArtifactFetch } from "./storage-artifact-fetch";
import { createOwnPreparationArtifacts } from "../../uploads/own-preparation-artifacts";
import { PreparationMetrics } from "../../uploads/preparation-metrics";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); r2.mockReset(); });
it("counts the actual v2 writer and verified reader around a synthetic R2 transport without adding calls", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.invalid"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-placeholder");
  const bytes = Buffer.from("synthetic aggregate metrics"), sha256 = createHash("sha256").update(bytes).digest("hex");
  const claim = { jobId: "11111111-1111-4111-8111-111111111111", attemptId: "22222222-2222-4222-8222-222222222222", claimTokenHash: "a".repeat(64) };
  const receipt = { version: "own-preparation-artifact-v2" as const, provider: "r2" as const, bucket: "inherit-prepared-synthetic",
    artifactId: "33333333-3333-4333-8333-333333333333", jobId: claim.jobId, attemptId: claim.attemptId, sequence: 0,
    objectKey: "prepared/44444444-4444-4444-8444-444444444444", byteCount: bytes.length, sha256, writeExpiresAt: new Date(Date.now() + 20_000).toISOString() };
  const stored = { receipt, providerVersion: "1".repeat(32), etag: "2".repeat(32) }, order: string[] = [];
  const sink = vi.fn(); let time = 0;
  const metrics = new PreparationMetrics(sink, { now: () => time, cpu: () => null });
  const rpc = vi.fn(async (url: string) => {
    time += 2;
    if (url.endsWith("reserve_own_preparation_artifact_v1")) { order.push("reserve"); return Response.json(receipt); }
    if (url.endsWith("check_own_preparation_claim_v1")) { order.push("check"); return Response.json({ version: "own-preparation-claim-v1", ...claim }); }
    if (url.endsWith("ack_own_preparation_r2_artifact_v1")) { order.push("ack"); return Response.json(stored); }
    throw new Error("unexpected request");
  });
  vi.stubGlobal("fetch", rpc);
  r2.mockImplementation(async ({ operation }) => {
    order.push(operation); time += 3;
    return operation === "put" ? Response.json({ providerVersion: stored.providerVersion, etag: stored.etag, byteCount: bytes.length }) : new Response(bytes);
  });
  const artifacts = createOwnPreparationArtifacts({ ...claim, firstArtifactSequence: 0, signal: new AbortController().signal, metrics,
    check: async () => { order.push("authority"); time++; }, writeArtifact: createPreparedArtifactWriter(claim, metrics), readArtifact: createPreparedArtifactFetch(metrics) });
  const written = await artifacts.persist(bytes); expect(written).toEqual(stored);
  expect(await artifacts.read(written)).toEqual(Uint8Array.from(bytes)); metrics.finish("prepared");
  expect(order).toEqual(["authority", "reserve", "put", "check", "get", "ack", "authority", "authority", "get", "authority"]);
  expect(rpc).toHaveBeenCalledTimes(3); expect(r2).toHaveBeenCalledTimes(3);
  const operations = sink.mock.calls[0][0].phases.claim.operations;
  expect(operations.artifact_write).toMatchObject({ completed: 1, completedBytes: bytes.length, wallMs: 14 });
  expect(operations.artifact_read).toMatchObject({ completed: 1, completedBytes: bytes.length, wallMs: 5 });
  expect(operations.rpc).toMatchObject({ completed: 3, wallMs: 6 });
  expect(operations.provider_put).toMatchObject({ completed: 1, completedBytes: bytes.length, wallMs: 3 });
  expect(operations.provider_get).toMatchObject({ completed: 2, completedBytes: 2 * bytes.length, wallMs: 6 });
  for (const privateValue of [receipt.objectKey, receipt.sha256, stored.providerVersion, claim.claimTokenHash, bytes.toString()])
    expect(JSON.stringify(sink.mock.calls[0][0])).not.toContain(privateValue);
});
