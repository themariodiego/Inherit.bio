import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmbryoFixtureSigner, createEmbryoFragmentGateway, EMBRYO_FIXTURE_BUCKET, EMBRYO_FIXTURE_ORIGIN,
  EMBRYO_FIXTURE_SUPABASE_URL,
} from "../../../scripts/ci-browser/embryo-fragment-fixture";
import type { EmbryoFragmentRpc } from "./fragment-storage";
import {
  completeEmbryoUnwind, drainEmbryoUnwindStorage, listEmbryoUnwindWork, type EmbryoDisposalReceipt,
} from "./unwind-storage";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const unwindId = randomUUID();
let gateway: ReturnType<typeof createEmbryoFragmentGateway>;
let storageRows: Array<Record<string, unknown>> | "fail" | "empty";
let calls: string[];

beforeEach(() => {
  const signer = createEmbryoFixtureSigner();
  gateway = createEmbryoFragmentGateway(signer.publicJwk);
  calls = [];
  vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK", JSON.stringify(signer.privateJwk));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", EMBRYO_FIXTURE_SUPABASE_URL);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-placeholder");
  vi.stubEnv("INHERIT_EMBRYO_R2_ORIGIN", EMBRYO_FIXTURE_ORIGIN);
  vi.stubEnv("INHERIT_EMBRYO_R2_BUCKET", EMBRYO_FIXTURE_BUCKET);
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    calls.push(`${request.method} ${url.origin}${url.pathname}`);
    if (url.origin === EMBRYO_FIXTURE_ORIGIN) return gateway.fetch(request);
    if (url.origin === EMBRYO_FIXTURE_SUPABASE_URL && url.pathname === "/storage/v1/object/genomes"
      && request.method === "DELETE") {
      if (storageRows === "fail") return new Response(null, { status: 500 });
      return Response.json(storageRows === "empty" ? [] : storageRows);
    }
    throw new Error("unexpected request");
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const soon = () => new Date(Date.now() + 50_000).toISOString();
function r2(ordinal: number): EmbryoDisposalReceipt {
  return { version: "embryo-ingest-object-disposal-v1", unwindId, ordinal, backend: "r2", operation: "tombstone",
    bucket: EMBRYO_FIXTURE_BUCKET, objectKey: `embryo/${randomUUID()}`, byteCount: 80, sha256: sha(`fragment-${ordinal}`),
    claimExpiresAt: soon() };
}
function supabase(ordinal: number): EmbryoDisposalReceipt {
  return { version: "embryo-ingest-object-disposal-v1", unwindId, ordinal, backend: "supabase", operation: "delete",
    bucket: "genomes", objectKey: `${randomUUID()}/${randomUUID()}/${randomUUID()}/${randomUUID()}.vcf`, byteCount: 80,
    sha256: sha(`fragment-${ordinal}`), storageObjectId: randomUUID(), storageVersion: randomUUID(), claimExpiresAt: soon() };
}
/** SQL's side: answers the claim, records each finish, then confirms. */
function sql(claim: unknown, finish?: (args: Record<string, unknown>) => { data: unknown; error: unknown }) {
  const log: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rpc: EmbryoFragmentRpc = (name, args) => ({
    abortSignal: () => {
      log.push({ name, args });
      if (name === "claim_embryo_ingest_object_disposals_v1") return Promise.resolve({ data: claim, error: null });
      if (name === "finish_embryo_ingest_object_disposal_v1") return Promise.resolve(finish ? finish(args) : {
        data: { status: "disposed", unwindId, ordinal: args.p_ordinal,
          state: (args.p_expected as EmbryoDisposalReceipt).backend === "r2" ? "tombstoned" : "deleted" }, error: null });
      return Promise.resolve({ data: { status: "storage_confirmed" }, error: null });
    },
  });
  return { rpc, log };
}

describe("drainEmbryoUnwindStorage", () => {
  it("places a verified empty marker at every claimed R2 key and records its exact identity", async () => {
    const receipts = [r2(1), r2(2)];
    await gateway.binding.put(receipts[0].objectKey, new TextEncoder().encode("x".repeat(80)), {});
    const s = sql({ status: "claimed", unwindId, objects: receipts });
    const result = await drainEmbryoUnwindStorage({ rpc: s.rpc, unwindId, signal: new AbortController().signal });
    expect(result).toEqual({ status: "storage_confirmed", disposed: 2, failed: 0 });
    for (const receipt of receipts) expect(gateway.values.get(receipt.objectKey)?.bytes.length).toBe(0);
    const finishes = s.log.filter(entry => entry.name === "finish_embryo_ingest_object_disposal_v1");
    expect(finishes.map(entry => entry.args.p_evidence)).toEqual(receipts.map(receipt => ({
      version: "embryo-ingest-object-tombstone-evidence-v1", provider: "r2", disposition: "payload-tombstoned",
      bucket: EMBRYO_FIXTURE_BUCKET, objectKey: receipt.objectKey,
      providerVersion: gateway.values.get(receipt.objectKey)!.version,
      etag: "d41d8cd98f00b204e9800998ecf8427e", byteCount: 0, sha256: sha("") })));
    expect(finishes.map(entry => entry.args.p_expected)).toEqual(receipts);
    const token = s.log[0].args.p_claim_token_hash;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(finishes.every(entry => entry.args.p_claim_token_hash === token)).toBe(true);
    expect(s.log.at(-1)?.name).toBe("confirm_embryo_ingest_unwind_storage_v1");
  });

  it("deletes a Supabase object and reports the Storage API's exact row", async () => {
    const receipt = supabase(3) as Extract<EmbryoDisposalReceipt, { backend: "supabase" }>;
    storageRows = [{ id: receipt.storageObjectId, name: receipt.objectKey, bucket_id: "genomes",
      version: receipt.storageVersion, metadata: { size: 80, mimetype: "text/plain" } }];
    const s = sql({ status: "claimed", unwindId, objects: [receipt] });
    expect(await drainEmbryoUnwindStorage({ rpc: s.rpc, unwindId, signal: new AbortController().signal }))
      .toEqual({ status: "storage_confirmed", disposed: 1, failed: 0 });
    expect(s.log.find(entry => entry.name === "finish_embryo_ingest_object_disposal_v1")?.args.p_evidence).toEqual({
      version: "embryo-ingest-object-delete-evidence-v1", provider: "supabase", disposition: "object-deleted",
      objectId: receipt.storageObjectId, bucket: "genomes", objectKey: receipt.objectKey,
      storageVersion: receipt.storageVersion, byteCount: 80 });
  });

  it.each([
    ["an empty result", () => "empty" as const],
    ["a failed request", () => "fail" as const],
    ["another version", (r: Extract<EmbryoDisposalReceipt, { backend: "supabase" }>) => [{ id: r.storageObjectId,
      name: r.objectKey, bucket_id: "genomes", version: randomUUID(), metadata: { size: 80 } }]],
    ["two rows", (r: Extract<EmbryoDisposalReceipt, { backend: "supabase" }>) => [0, 1].map(() => ({ id: r.storageObjectId,
      name: r.objectKey, bucket_id: "genomes", version: r.storageVersion, metadata: { size: 80 } }))],
  ])("records nothing for %s, leaving the object unresolved", async (_label, rows) => {
    const receipt = supabase(4) as Extract<EmbryoDisposalReceipt, { backend: "supabase" }>;
    storageRows = rows(receipt);
    const s = sql({ status: "claimed", unwindId, objects: [receipt] });
    expect(await drainEmbryoUnwindStorage({ rpc: s.rpc, unwindId, signal: new AbortController().signal }))
      .toEqual({ status: "storage_confirmed", disposed: 0, failed: 1 });
    expect(s.log.some(entry => entry.name === "finish_embryo_ingest_object_disposal_v1")).toBe(false);
  });

  it("moves no bytes when SQL claims nothing, or answers outside the contract", async () => {
    for (const claim of [{ status: "draining", fenceAt: soon() }, { status: "idle" },
      { status: "claimed", unwindId, objects: [{ ...r2(1), objectKey: "prepared/x" }] }]) {
      const s = sql(claim);
      const result = await drainEmbryoUnwindStorage({ rpc: s.rpc, unwindId, signal: new AbortController().signal })
        .catch(() => "refused");
      expect(result === "refused" || (result as { disposed: number }).disposed === 0).toBe(true);
      expect(s.log.every(entry => entry.name === "claim_embryo_ingest_object_disposals_v1")).toBe(true);
    }
    expect(calls).toEqual([]);
  });

  it("counts a refused finish as a failure and keeps going", async () => {
    const receipts = [r2(1), r2(2)];
    const s = sql({ status: "claimed", unwindId, objects: receipts }, args => args.p_ordinal === 1
      ? { data: null, error: { code: "42501" } }
      : { data: { status: "disposed", unwindId, ordinal: 2, state: "tombstoned" }, error: null });
    expect(await drainEmbryoUnwindStorage({ rpc: s.rpc, unwindId, signal: new AbortController().signal }))
      .toEqual({ status: "storage_confirmed", disposed: 1, failed: 1 });
  });
});

/** SQL's side of one call, recording what it was asked. */
function answer(data: unknown, error: unknown = null) {
  const log: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rpc: EmbryoFragmentRpc = (name, args) => ({
    abortSignal: () => { log.push({ name, args }); return Promise.resolve({ data, error }); },
  });
  return { rpc, log };
}

describe("completeEmbryoUnwind", () => {
  it.each(["complete", "storage_pending", "planned"] as const)("reports SQL's %s answer", async status => {
    const s = answer({ status, completedAt: new Date().toISOString(), notices: 2 });
    expect(await completeEmbryoUnwind({ rpc: s.rpc, unwindId, signal: new AbortController().signal }))
      .toEqual({ status });
    expect(s.log).toEqual([{ name: "complete_embryo_ingest_unwind_v1", args: { p_unwind_id: unwindId } }]);
    expect(calls).toEqual([]);
  });

  it("refuses an answer outside the contract, and a database error", async () => {
    for (const s of [answer({ status: "storage_confirmed" }), answer(null, { code: "55000" })]) {
      await expect(completeEmbryoUnwind({ rpc: s.rpc, unwindId, signal: new AbortController().signal }))
        .rejects.toThrow();
    }
  });
});

describe("listEmbryoUnwindWork", () => {
  it("returns the listed unwinds and clamps the limit", async () => {
    const work = [{ unwindId, purpose: "published", state: "storage_pending" },
      { unwindId: randomUUID(), purpose: "abandoned", state: "storage_confirmed" },
      { unwindId: randomUUID(), purpose: "source", state: "storage_pending" }];
    const s = answer(work);
    expect(await listEmbryoUnwindWork({ rpc: s.rpc, limit: 500, signal: new AbortController().signal }))
      .toEqual(work);
    expect(s.log[0].args).toEqual({ p_limit: 100 });
  });

  it("refuses a completed unwind, an unknown purpose or an extra field", async () => {
    for (const row of [{ unwindId, purpose: "abandoned", state: "complete" },
      { unwindId, purpose: "restriction", state: "storage_pending" },
      { unwindId, purpose: "published", state: "storage_pending", cohortId: randomUUID() }]) {
      await expect(listEmbryoUnwindWork({ rpc: answer([row]).rpc, signal: new AbortController().signal }))
        .rejects.toThrow();
    }
  });
});
