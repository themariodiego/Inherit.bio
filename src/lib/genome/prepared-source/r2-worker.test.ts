import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import worker from "../../../../workers/prepared-artifacts/worker.mjs";

function fixture() {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" }), kid = randomUUID();
  const values = new Map<string, { bytes: Uint8Array; version: string; etag: string }>();
  const read = (key: string, range?: { offset: number; length: number }) => {
    const v = values.get(key); if (!v) return null;
    const bytes = range ? v.bytes.slice(range.offset, range.offset + range.length) : v.bytes;
    return { version: v.version, etag: v.etag, httpEtag: `"${v.etag}"`, size: v.bytes.length,
      body: new Response(Uint8Array.from(bytes).buffer).body!, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
  };
  const put = vi.fn(async (key: string, body: Uint8Array | ReadableStream, options?: { onlyIf?: Headers; sha256?: string }) => {
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
    if (options?.sha256 && createHash("sha256").update(bytes).digest("hex") !== options.sha256) throw new Error();
    if (options?.onlyIf?.get("If-None-Match") === "*" && values.has(key)) return null;
    const v = { bytes, version: randomUUID().replaceAll("-", ""), etag: createHash("md5").update(bytes).digest("hex") };
    values.set(key, v); return { ...v, size: bytes.length };
  });
  const get = vi.fn(async (key: string, options?: { range?: { offset: number; length: number } }) => read(key, options?.range));
  const env = { SIGNING_PUBLIC_KEYS: JSON.stringify([{ ...pair.publicKey.export({ format: "jwk" }), kid }]),
    TOKEN_ISSUER: "https://example.supabase.co/auth/v1", BUCKET_NAME: "inherit-prepared-test", ARTIFACTS: { put, get, head: async (key: string) => read(key) } };
  const bytes = new TextEncoder().encode("synthetic-test-data"), now = Math.floor(Date.now() / 1000);
  const claim = { operation: "put", bucket: env.BUCKET_NAME, objectKey: `prepared/${randomUUID()}`, byteCount: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), expiresAt: new Date((now + 30) * 1000).toISOString(),
    iss: env.TOKEN_ISSUER, aud: "inherit-prepared-object-v1", iat: now, nbf: now, exp: now + 30 };
  const token = (c: object, header = { alg: "ES256", typ: "JWT", kid }) => {
    const input = Buffer.from(JSON.stringify(header)).toString("base64url") + "." + Buffer.from(JSON.stringify(c)).toString("base64url");
    return input + "." + sign("sha256", Buffer.from(input), { key: pair.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  };
  const request = (c: { operation?: string; [key: string]: unknown }, method = "PUT", body: Uint8Array | undefined = undefined, auth = token(c)) => {
    if (!body && c.operation === "put" && method !== "GET") body = bytes;
    return worker.fetch(
    new Request("https://gateway.example/artifact", { method,
      headers: { Authorization: `Bearer ${auth}`, ...(body ? { "Content-Length": String(body.length) } : {}) }, body: body && Uint8Array.from(body).buffer }), env); };
  return { claim, request, bytes, put, get, token, values };
}

describe("prepared R2 gateway", () => {
  it.each([
    { aud: "authenticated" }, { iss: "https://wrong.example" }, { operation: "delete" }, { bucket: "other" },
    { objectKey: "prepared/../../original" }, { byteCount: 8388609 }, { byteCount: 0 }, { sha256: "invalid" },
    { exp: 1 }, { exp: "over-max-ttl" }, { extra: true }, { start: 0 },
  ])("refuses malformed or cross-purpose capability before provider I/O: %j", async change => {
    const f = fixture();
    // "over-max-ttl" is resolved here, against this fixture's own iat. Written
    // as Date.now() + 31 in the table above it froze at collection time, while
    // iat and expiresAt come from a fresh clock when the body runs. One second
    // of drift and exp - iat falls back to 30, so the claim aged into validity
    // and the gateway correctly answered 200 — the assertion failed for a real
    // reason that had nothing to do with the gateway.
    const claim = { ...f.claim, ...change,
      ...(change.exp === "over-max-ttl" ? { exp: f.claim.iat + 31 } : {}) };
    expect((await f.request(claim)).status).toBe(404);
    expect(f.put).not.toHaveBeenCalled(); expect(f.get).not.toHaveBeenCalled();
  });
  it("requires exact signature and method", async () => {
    const f = fixture(), token = f.token(f.claim);
    expect((await f.request(f.claim, "PUT", f.bytes, token.slice(0, -5) + "AAAAA")).status).toBe(404);
    expect((await f.request(f.claim, "POST")).status).toBe(404); expect(f.put).not.toHaveBeenCalled();
  });
  it("writes only once, serves exact version/ranges, and fences replay with a zero-byte marker", async () => {
    const f = fixture(), response = await f.request(f.claim);
    expect(response.status).toBe(200); const receipt = await response.json();
    expect(f.put.mock.calls[0][2]?.onlyIf?.get("If-None-Match")).toBe("*");
    expect((await f.request(f.claim)).status).toBe(409);
    const readClaim = { ...f.claim, operation: "get", providerVersion: receipt.providerVersion, etag: receipt.etag };
    const read = await f.request(readClaim, "GET", undefined);
    expect(read.status).toBe(200); expect(new Uint8Array(await read.arrayBuffer())).toEqual(f.bytes);
    const ranged = await f.request({ ...readClaim, start: 2, end: 5 }, "GET", undefined);
    expect(ranged.status).toBe(206); expect(ranged.headers.get("content-range")).toBe(`bytes 2-5/${f.bytes.length}`);
    expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(f.bytes.slice(2, 6));
    const tombstone = await f.request({ ...f.claim, operation: "tombstone" }, "PUT", undefined);
    expect(tombstone.status).toBe(200);
    expect(await tombstone.json()).toMatchObject({ disposition: "payload-tombstoned", byteCount: 0,
      sha256: createHash("sha256").update("").digest("hex") });
    expect(f.values.get(f.claim.objectKey)?.bytes.length).toBe(0);
    expect((await f.request(f.claim)).status).toBe(409);
    expect((await f.request(readClaim, "GET", undefined)).status).toBe(409);
  });
  it("rejects checksum failure and inconsistent body length", async () => {
    const f = fixture(); expect((await f.request({ ...f.claim, sha256: "a".repeat(64) })).status).toBe(503);
    expect(f.values.size).toBe(0);
    expect((await f.request({ ...f.claim, byteCount: 1 })).status).toBe(400);
  });
});
