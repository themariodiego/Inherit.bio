import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmbryoFragmentGateway, createEmbryoFixtureSigner, EMBRYO_FIXTURE_BUCKET, EMBRYO_FIXTURE_ORIGIN, EMBRYO_FIXTURE_SUPABASE_URL }
  from "../../../scripts/ci-browser/embryo-fragment-fixture";
import { writeEmbryoFragment } from "@/lib/embryos/fragment-storage";
import type { EmbryoFragmentRpc } from "@/lib/embryos/fragment-storage";
import { drainClaimantSource } from "./erasure-storage";

const id = randomUUID(), sha = (s: string) => createHash("sha256").update(s).digest("hex");
const makeReceipt = () => ({ version: "future-person-source-disposal-v1", manifestId: id, ordinal: 1,
  bucket: EMBRYO_FIXTURE_BUCKET, objectKey: `embryo/${randomUUID()}`, byteCount: 8, sha256: sha("payload!"),
  claimExpiresAt: new Date(Date.now() + 50_000).toISOString() });
let gateway: ReturnType<typeof createEmbryoFragmentGateway>;
beforeEach(async () => {
  const signer = await createEmbryoFixtureSigner(); gateway = createEmbryoFragmentGateway(signer.publicJwk);
  vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK", JSON.stringify(signer.privateJwk));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", EMBRYO_FIXTURE_SUPABASE_URL);
  vi.stubEnv("INHERIT_EMBRYO_R2_ORIGIN", EMBRYO_FIXTURE_ORIGIN); vi.stubEnv("INHERIT_EMBRYO_R2_BUCKET", EMBRYO_FIXTURE_BUCKET);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => gateway.fetch(new Request(url, init))));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function rpcFor(objects: unknown[], options: { claimId?: string; ack?: unknown; proof?: unknown; refusedAck?: boolean } = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const rpc: EmbryoFragmentRpc = (_name, args) => ({ abortSignal: async () => {
    calls.push(args);
    if (args.p_operation === "claim") return { data: { status: "claimed", manifestId: options.claimId ?? id, objects }, error: null };
    if (args.p_operation === "acknowledge") return { data: options.ack ?? { status: "tombstone_acknowledged", manifestId: id, ordinal: 1 },
      error: options.refusedAck ? { code: "42501" } : null };
    return { data: options.proof ?? { status: "source_tombstoned" }, error: null };
  } });
  return { rpc, calls };
}
const run = (rpc: EmbryoFragmentRpc) => drainClaimantSource({ rpc, manifestId: id, signal: new AbortController().signal });
describe("claimant source disposal prerequisite", () => {
  it("verifies an empty gateway marker and returns it with the exact unchanged sealed receipt", async () => {
    const r = makeReceipt(); await gateway.binding.put(r.objectKey, new TextEncoder().encode("payload!"), {});
    const f = rpcFor([r]); expect(await run(f.rpc)).toEqual({ status: "source_tombstoned", disposed: 1, failed: 0 });
    expect(gateway.values.get(r.objectKey)?.bytes.byteLength).toBe(0);
    expect(f.calls.map(c => c.p_operation)).toEqual(["claim", "acknowledge", "proof"]);
    expect(f.calls[1].p_expected).toEqual(r);
    expect(f.calls[1].p_evidence).toEqual({ disposition: "payload-tombstoned", bucket: r.bucket, objectKey: r.objectKey,
      providerVersion: gateway.values.get(r.objectKey)?.version, etag: "d41d8cd98f00b204e9800998ecf8427e", byteCount: 0, sha256: sha("") });
    expect(f.calls[0].p_claim_token_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(f.calls.every(c => c.p_claim_token_hash === f.calls[0].p_claim_token_hash)).toBe(true);
    expect(gateway.values.get(r.objectKey)?.tombstone).toBe(true);
  });
  it("a permanent marker refuses a late create-only write while its original capability is still live", async () => {
    const r = makeReceipt(); const f = rpcFor([r]); await run(f.rpc);
    const noAck: EmbryoFragmentRpc = vi.fn(() => { throw new Error("a refused late write cannot reach SQL ACK"); });
    await expect(writeEmbryoFragment({ rpc: noAck, signal: new AbortController().signal,
      target: { version: "embryo-ingest-write-target-v1", backend: "r2", sessionId: randomUUID(),
        sequence: 0, ordinal: 0, byteCount: r.byteCount, sha256: r.sha256, writeExpiresAt: r.claimExpiresAt,
        bucket: r.bucket, objectKey: r.objectKey }, bytes: new TextEncoder().encode("payload!") })).rejects.toMatchObject({ code: "conflict" });
    expect(noAck).not.toHaveBeenCalled(); expect(gateway.values.get(r.objectKey)?.tombstone).toBe(true);
    expect(gateway.values.get(r.objectKey)?.bytes.byteLength).toBe(0);
  });
  it.each(["crossed", "expired", "extra", "duplicate", "invalid-key"])("refuses %s inventory before any provider action", async kind => {
    const r = makeReceipt(); let rows: unknown[] = [r];
    if (kind === "crossed") rows = [{ ...r, manifestId: randomUUID() }];
    if (kind === "expired") rows = [{ ...r, claimExpiresAt: new Date(Date.now() - 1).toISOString() }];
    if (kind === "extra") rows = [{ ...r, subjectId: randomUUID() }];
    if (kind === "duplicate") rows = [r, r];
    if (kind === "invalid-key") rows = [{ ...r, objectKey: "another-subject" }];
    const f = rpcFor(rows); await expect(run(f.rpc)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(1);
  });
  it("refuses a crossed outer manifest before provider contact", async () => {
    const f = rpcFor([], { claimId: randomUUID() }); await expect(run(f.rpc)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it("leaves a lost SQL ACK pending despite the gateway's successful tombstone", async () => {
    const f = rpcFor([makeReceipt()], { refusedAck: true, proof: { status: "source_pending" } });
    expect(await run(f.rpc)).toEqual({ status: "source_pending", disposed: 0, failed: 1 });
    expect(f.calls.filter(c => c.p_operation === "acknowledge")).toHaveLength(1);
  });
  it("refuses completion contradicted by a failed ACK", async () => {
    await expect(run(rpcFor([makeReceipt()], { refusedAck: true }).rpc)).rejects.toThrow();
  });
  it.each([{ status: "complete" }, { status: "source_tombstoned", deletedSubjectId: id }])("never adopts a broader or extra completion receipt %j", async proof => {
    await expect(run(rpcFor([], { proof }).rpc)).rejects.toThrow();
  });
  it("handles an empty resumable source page without provider contact", async () => {
    expect(await run(rpcFor([]).rpc)).toEqual({ status: "source_tombstoned", disposed: 0, failed: 0 }); expect(fetch).not.toHaveBeenCalled();
  });
});
