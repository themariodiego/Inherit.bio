import { createHash, randomUUID, sign, type KeyObject } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import prepared from "../../../workers/prepared-artifacts/worker.mjs";
import {
  createEmbryoFixtureSigner, createEmbryoFragmentGateway, EMBRYO_FIXTURE_BUCKET, EMBRYO_FIXTURE_ISSUER,
} from "../../../scripts/ci-browser/embryo-fragment-fixture";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const signer = createEmbryoFixtureSigner(), gateway = createEmbryoFragmentGateway(signer.publicJwk);
  const put = vi.spyOn(gateway.binding, "put"), get = vi.spyOn(gateway.binding, "get");
  const bytes = new TextEncoder().encode("##fileformat=VCFv4.2 synthetic embryo fragment\n");
  const now = Math.floor(Date.now() / 1000);
  const claim: Record<string, unknown> = { operation: "put", bucket: EMBRYO_FIXTURE_BUCKET,
    objectKey: `embryo/${randomUUID()}`, byteCount: bytes.length, sha256: sha(bytes),
    expiresAt: new Date((now + 30) * 1000).toISOString(),
    iss: EMBRYO_FIXTURE_ISSUER, aud: "inherit-embryo-fragment-v1", iat: now, nbf: now, exp: now + 30 };
  const token = (c: object, key: KeyObject = signer.privateKey, kid = signer.kid) => {
    const input = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT", kid })).toString("base64url") + "."
      + Buffer.from(JSON.stringify(c)).toString("base64url");
    return input + "." + sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  };
  const request = (c: Record<string, unknown>, options: { method?: string; body?: Uint8Array; auth?: string; path?: string } = {}) => {
    const method = options.method ?? (c.operation === "get" ? "GET" : "PUT");
    const body = options.body ?? (c.operation === "put" && method === "PUT" ? bytes : undefined);
    return gateway.fetch(new Request(`https://embryo.fragments.test${options.path ?? "/fragment"}`, { method,
      headers: { Authorization: `Bearer ${options.auth ?? token(c)}`, ...(body ? { "Content-Length": String(body.length) } : {}) },
      body: body && Uint8Array.from(body).buffer }));
  };
  return { gateway, signer, claim, bytes, token, request, put, get };
}

describe("embryo fragment gateway", () => {
  it.each([
    ["the prepared-object audience", { aud: "inherit-prepared-object-v1" }],
    ["an Auth audience", { aud: "authenticated" }],
    ["another issuer", { iss: "https://wrong.example/auth/v1" }],
    ["a delete operation", { operation: "delete" }],
    ["a list operation", { operation: "list" }],
    ["another bucket", { bucket: "inherit-embryo-other" }],
    ["a prepared-object key", { objectKey: `prepared/${randomUUID()}` }],
    ["a traversal key", { objectKey: "embryo/../prepared/x" }],
    ["a Supabase namespace name", { objectKey: `${randomUUID()}/${randomUUID()}/${randomUUID()}/${randomUUID()}.vcf` }],
    ["a size above the largest fragment", { byteCount: 4_004_097 }],
    ["an empty object", { byteCount: 0 }],
    ["a malformed hash", { sha256: "abc" }],
    ["an expired capability", { exp: 1 }],
    ["a lifetime above thirty seconds", { exp: "over" }],
    ["an extra claim", { account: randomUUID() }],
    ["a range claim", { start: 0, end: 1 }],
    ["a provider version on a write", { providerVersion: "1".repeat(32), etag: "2".repeat(32) }],
    ["a window already closed", { expiresAt: new Date(Date.now() - 1000).toISOString() }],
  ] as Array<[string, Record<string, unknown>]>)("refuses %s before any provider I/O", async (_label, change) => {
    const f = fixture();
    const claim = { ...f.claim, ...change, ...(change.exp === "over" ? { exp: (f.claim.iat as number) + 31 } : {}) };
    expect((await f.request(claim)).status).toBe(404);
    expect(f.put).not.toHaveBeenCalled(); expect(f.get).not.toHaveBeenCalled();
  });

  it("refuses a read without the exact provider identity, a bad signature, a wrong method and a wrong path", async () => {
    const f = fixture();
    expect((await f.request({ ...f.claim, operation: "get" })).status).toBe(404);
    expect((await f.request(f.claim, { auth: f.token(f.claim).slice(0, -4) + "AAAA" })).status).toBe(404);
    expect((await f.request(f.claim, { auth: f.token(f.claim, createEmbryoFixtureSigner().privateKey) })).status).toBe(404);
    expect((await f.request(f.claim, { method: "POST" })).status).toBe(404);
    expect((await f.request(f.claim, { path: "/artifact" })).status).toBe(404);
    expect(f.put).not.toHaveBeenCalled();
  });

  it("refuses everything when its own bucket name is outside the embryo namespace", async () => {
    const f = fixture();
    f.gateway.env.BUCKET_NAME = "inherit-prepared-production";
    expect((await f.request({ ...f.claim, bucket: "inherit-prepared-production" })).status).toBe(404);
    expect(f.put).not.toHaveBeenCalled();
  });

  it("writes once, create-only, with the provider checking the hash", async () => {
    const f = fixture();
    const response = await f.request(f.claim);
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(receipt).toMatchObject({ byteCount: f.bytes.length, created: true });
    expect(receipt.providerVersion).toMatch(/^[0-9a-f]{32}$/);
    expect(f.put.mock.calls[0][2]?.onlyIf?.get("If-None-Match")).toBe("*");
    expect(f.put.mock.calls[0][2]?.sha256).toBe(f.claim.sha256);
    // A lost response is recoverable: the same bytes report the same object.
    const replay = await f.request(f.claim);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ ...receipt, created: false });
    expect(f.put).toHaveBeenCalledTimes(1);
  });

  it("refuses a body whose hash differs from the capability", async () => {
    const f = fixture();
    const other = new TextEncoder().encode("x".repeat(f.bytes.length));
    expect((await f.request(f.claim, { body: other })).status).toBe(503);
    expect(f.gateway.values.size).toBe(0);
  });

  it("reveals nothing about other content at the key", async () => {
    const f = fixture();
    expect((await f.request(f.claim)).status).toBe(200);
    const other = new TextEncoder().encode("y".repeat(f.bytes.length));
    const response = await f.request({ ...f.claim, sha256: sha(other) }, { body: other });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "already_exists" });
  });

  it("reads only the exact version, and an empty marker fences every later write", async () => {
    const f = fixture();
    const receipt = await (await f.request(f.claim)).json();
    const read = { ...f.claim, operation: "get", providerVersion: receipt.providerVersion, etag: receipt.etag };
    const response = await f.request(read);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-inherit-object-version")).toBe(receipt.providerVersion);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(f.bytes);
    expect((await f.request({ ...read, etag: "0".repeat(32) })).status).toBe(409);
    const tombstone = await f.request({ ...f.claim, operation: "tombstone" });
    expect(tombstone.status).toBe(200);
    expect(await tombstone.json()).toMatchObject({ disposition: "payload-tombstoned", byteCount: 0, sha256: sha("") });
    expect(f.gateway.values.get(f.claim.objectKey as string)?.bytes.length).toBe(0);
    expect((await f.request(read)).status).toBe(409);
    const late = await f.request(f.claim);
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({ error: "already_exists" });
  });

  it("an in-flight write that loses to a marker does not commit", async () => {
    const f = fixture();
    f.gateway.onBeforeCommit(async key => {
      f.gateway.onBeforeCommit(undefined);
      await f.gateway.binding.put(key, new Uint8Array(), { customMetadata: { state: "tombstone" } });
    });
    const response = await f.request(f.claim);
    expect(response.status).toBe(409);
    expect(f.gateway.values.get(f.claim.objectKey as string)?.bytes.length).toBe(0);
  });

  it("a marker at a key that was never written still fences it", async () => {
    const f = fixture();
    expect((await f.request({ ...f.claim, operation: "tombstone" })).status).toBe(200);
    expect((await f.request(f.claim)).status).toBe(409);
  });

  it("the prepared-object gateway refuses an embryo capability and key", async () => {
    const f = fixture();
    const env = { ARTIFACTS: f.gateway.binding, BUCKET_NAME: EMBRYO_FIXTURE_BUCKET, TOKEN_ISSUER: EMBRYO_FIXTURE_ISSUER,
      SIGNING_PUBLIC_KEYS: JSON.stringify([f.signer.publicJwk]) };
    const response = await prepared.fetch(new Request("https://prepared.example/artifact", { method: "PUT",
      headers: { Authorization: `Bearer ${f.token(f.claim)}`, "Content-Length": String(f.bytes.length) },
      body: Uint8Array.from(f.bytes).buffer }), env);
    expect(response.status).toBe(404);
    expect(f.put).not.toHaveBeenCalled();
  });
});
