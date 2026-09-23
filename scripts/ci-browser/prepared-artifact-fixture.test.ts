import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPreparedArtifactFixture, PREPARED_FIXTURE_BUCKET, PREPARED_FIXTURE_ISSUER, PREPARED_FIXTURE_LIMITS,
  PREPARED_FIXTURE_ORIGIN, startPreparedArtifactFixture, type PreparedArtifactFixtureSnapshot } from "./prepared-artifact-fixture";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function setup(onChange?: (snapshot: PreparedArtifactFixtureSnapshot) => void) {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" }), kid = randomUUID();
  const publicJwk = { ...pair.publicKey.export({ format: "jwk" }), kid };
  const fixture = createPreparedArtifactFixture(publicJwk, onChange);
  const bytes = new TextEncoder().encode("synthetic prepared fixture payload");
  const claim = (payload = bytes): Record<string, unknown> => {
    const now = Math.floor(Date.now() / 1000);
    return { operation: "put", bucket: PREPARED_FIXTURE_BUCKET, objectKey: `prepared/${randomUUID()}`,
      byteCount: payload.length, sha256: digest(payload), expiresAt: new Date((now + 30) * 1000).toISOString(),
      iss: PREPARED_FIXTURE_ISSUER, aud: "inherit-prepared-object-v1", iat: now, nbf: now, exp: now + 30 };
  };
  const token = (value: object) => {
    const input = [JSON.stringify({ alg: "ES256", typ: "JWT", kid }), JSON.stringify(value)]
      .map(part => Buffer.from(part).toString("base64url")).join(".");
    return input + "." + sign("sha256", Buffer.from(input), { key: pair.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  };
  const request = (value: Record<string, unknown>, payload: Uint8Array | ReadableStream<Uint8Array> = bytes, auth = token(value)) => {
    const put = value.operation === "put";
    return new Request(`${PREPARED_FIXTURE_ORIGIN}/artifact`, { method: value.operation === "get" ? "GET" : "PUT",
      headers: { authorization: `Bearer ${auth}`, ...(put ? { "content-length": String(value.byteCount) } : {}) },
      ...(put ? { body: payload instanceof Uint8Array ? Uint8Array.from(payload).buffer : payload, duplex: "half" } : {}) } as RequestInit);
  };
  return { fixture, pair, publicJwk, bytes, claim, token, request };
}

describe("bounded synthetic prepared-artifact binding", () => {
  it.each([
    { bucket: "inherit-prepared-other" }, { iss: "https://external.invalid/auth/v1" }, { aud: "authenticated" },
    { objectKey: "prepared/../../payload" }, { exp: 1 }, { operation: "delete" },
  ])("executes production authorization before any binding access: %j", async change => {
    const f = setup();
    expect((await f.fixture.fetch(f.request({ ...f.claim(), ...change }))).status).toBe(404);
    expect(f.fixture.snapshot()).toMatchObject({ objects: 0, getReads: 0, receivedBytes: 0, putCommits: 0, rejected: 1 });
  });
  it("refuses invalid signatures, external targets, routes, private keys and address overrides", async () => {
    const f = setup();
    expect((await f.fixture.fetch(f.request(f.claim(), f.bytes, "invalid.signature.token"))).status).toBe(404);
    for (const url of ["https://external.invalid/artifact", `${PREPARED_FIXTURE_ORIGIN}/list`, `${PREPARED_FIXTURE_ORIGIN}/artifact?key=x`])
      expect((await f.fixture.fetch(new Request(url))).status).toBe(404);
    expect(f.fixture.snapshot()).toMatchObject({ requests: 4, objects: 0, receivedBytes: 0 });
    expect(() => createPreparedArtifactFixture({ ...f.publicJwk, d: "private" })).toThrow();
    await expect(startPreparedArtifactFixture({ publicJwk: f.publicJwk, key: Buffer.alloc(0), cert: Buffer.alloc(0),
      address: "0.0.0.0" as "127.0.0.1" })).rejects.toThrow("Fixture address refused");
  });
  it("checks hashes, immutable writes, exact versions/ranges and terminal empty-payload evidence", async () => {
    const states: PreparedArtifactFixtureSnapshot[] = [], f = setup(value => states.push(value));
    expect(f.fixture.snapshot().allPayloadsEmpty).toBe(false);
    expect((await f.fixture.fetch(f.request({ ...f.claim(), sha256: "0".repeat(64) }))).status).toBe(503);
    expect(f.fixture.snapshot().objects).toBe(0);
    const claim = f.claim(), write = await f.fixture.fetch(f.request(claim));
    expect(write.status).toBe(200);
    const receipt = await write.json();
    expect((await f.fixture.fetch(f.request(claim))).status).toBe(409);
    const readClaim = { ...claim, operation: "get", ...receipt };
    const read = await f.fixture.fetch(f.request(readClaim));
    expect(read.status).toBe(200); expect(new Uint8Array(await read.arrayBuffer())).toEqual(f.bytes);
    const range = await f.fixture.fetch(f.request({ ...readClaim, start: 2, end: 5 }));
    expect(range.status).toBe(206); expect(range.headers.get("content-range")).toBe(`bytes 2-5/${f.bytes.length}`);
    expect(new Uint8Array(await range.arrayBuffer())).toEqual(f.bytes.slice(2, 6));
    expect((await f.fixture.fetch(f.request({ ...readClaim, providerVersion: "f".repeat(32) }))).status).toBe(409);
    const removed = await f.fixture.fetch(f.request({ ...claim, operation: "tombstone" }));
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ disposition: "payload-tombstoned", byteCount: 0, sha256: digest(new Uint8Array()) });
    expect((await f.fixture.fetch(f.request(readClaim))).status).toBe(409);
    expect((await f.fixture.fetch(f.request(claim))).status).toBe(409);
    expect(f.fixture.snapshot()).toMatchObject({ objects: 1, payloadBytes: 0, payloadObjects: 0, tombstones: 1,
      putCommits: 1, tombstoneCommits: 1, activeRequests: 0, allPayloadsEmpty: true });
    expect(states.some(value => value.activeRequests > 0 && value.allPayloadsEmpty)).toBe(false);
    expect(states.at(-1)).toEqual(f.fixture.snapshot());
    expect(Object.values(f.fixture.snapshot()).every(value => typeof value === "number" || typeof value === "boolean")).toBe(true);
    await f.fixture.close(); expect(f.fixture.snapshot().allPayloadsEmpty).toBe(false);
  });
  it("lets a tombstone fence a valid PUT whose body is still arriving", async () => {
    let arrived!: () => void;
    const firstBytes = new Promise<void>(resolve => { arrived = resolve; });
    const f = setup(value => { if (value.receivedBytes > 0) arrived(); }), claim = f.claim();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; value.enqueue(f.bytes.slice(0, 4)); } });
    const pending = f.fixture.fetch(f.request(claim, body));
    await firstBytes;
    expect((await f.fixture.fetch(f.request({ ...claim, operation: "tombstone" }))).status).toBe(200);
    expect(f.fixture.snapshot()).toMatchObject({ activeRequests: 1, payloadBytes: 0, tombstones: 1, allPayloadsEmpty: false });
    controller.enqueue(f.bytes.slice(4)); controller.close();
    expect((await pending).status).toBe(409);
    expect((await f.fixture.fetch(f.request(claim))).status).toBe(409);
    expect(f.fixture.snapshot()).toMatchObject({ putCommits: 0, tombstones: 1, payloadBytes: 0 });
  });
  it("withholds terminal proof until an outstanding payload read reaches EOF or is cancelled", async () => {
    const f = setup(), claim = f.claim();
    const receipt = await (await f.fixture.fetch(f.request(claim))).json();
    const read = await f.fixture.fetch(f.request({ ...claim, operation: "get", ...receipt }));
    expect(f.fixture.snapshot().activeRequests).toBe(1);
    expect((await f.fixture.fetch(f.request({ ...claim, operation: "tombstone" }))).status).toBe(200);
    expect(f.fixture.snapshot()).toMatchObject({ activeRequests: 1, payloadBytes: 0, allPayloadsEmpty: false });
    await read.body!.cancel();
    expect(f.fixture.snapshot()).toMatchObject({ activeRequests: 0, allPayloadsEmpty: true });
    await f.fixture.close();
  });
  it("caps individual and cumulative bytes without retaining rejected payloads", async () => {
    const f = setup(), bytes = new Uint8Array(PREPARED_FIXTURE_LIMITS.objectBytes);
    expect((await f.fixture.fetch(f.request({ ...f.claim(), byteCount: bytes.length + 1 }))).status).toBe(413);
    for (let i = 0; i < 4; i++) expect((await f.fixture.fetch(f.request(f.claim(bytes), bytes))).status).toBe(200);
    expect((await f.fixture.fetch(f.request(f.claim()))).status).toBe(503);
    expect(f.fixture.snapshot()).toMatchObject({ objects: 4, payloadBytes: PREPARED_FIXTURE_LIMITS.totalBytes, putCommits: 4 });
    await f.fixture.close();
  });
  it("caps keys and requests and keeps separate instances isolated", async () => {
    const f = setup(), bytes = Uint8Array.of(1);
    for (let i = 0; i < PREPARED_FIXTURE_LIMITS.objects; i++)
      expect((await f.fixture.fetch(f.request(f.claim(bytes), bytes))).status).toBe(200);
    expect((await f.fixture.fetch(f.request(f.claim(bytes), bytes))).status).toBe(503);
    expect(setup().fixture.snapshot().objects).toBe(0);
    while (f.fixture.snapshot().requests < PREPARED_FIXTURE_LIMITS.requests)
      expect((await f.fixture.fetch(new Request(`${PREPARED_FIXTURE_ORIGIN}/refused`))).status).toBe(404);
    expect((await f.fixture.fetch(f.request(f.claim()))).status).toBe(503);
    expect(f.fixture.snapshot().objects).toBe(PREPARED_FIXTURE_LIMITS.objects);
    await f.fixture.close();
  });
  it("caps concurrent work and cancels pending fixture bodies when closed", async () => {
    const f = setup(), pending: Promise<Response>[] = [];
    for (let i = 0; i < PREPARED_FIXTURE_LIMITS.concurrent; i++)
      pending.push(f.fixture.fetch(f.request(f.claim(), new ReadableStream<Uint8Array>())));
    expect((await f.fixture.fetch(f.request(f.claim()))).status).toBe(503);
    await f.fixture.close();
    expect((await Promise.all(pending)).map(value => value.status)).toEqual(Array(8).fill(503));
    expect(f.fixture.snapshot()).toMatchObject({ objects: 0, activeRequests: 0, allPayloadsEmpty: false });
  });
  it.each(["timeout", "close"])("does not await a hostile stream cancellation on %s", async operation => {
    vi.useFakeTimers();
    let arrived!: () => void;
    const firstBytes = new Promise<void>(resolve => { arrived = resolve; });
    const f = setup(value => { if (value.receivedBytes > 0) arrived(); });
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    try {
      const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(f.bytes.slice(0, 4)); }, cancel });
      const pending = f.fixture.fetch(f.request(f.claim(), body));
      await firstBytes;
      if (operation === "timeout") await vi.advanceTimersByTimeAsync(10_000); else await f.fixture.close();
      expect((await pending).status).toBe(503);
      expect(cancel).toHaveBeenCalled();
      expect(f.fixture.snapshot()).toMatchObject({ objects: 0, activeRequests: 0, putCommits: 0, allPayloadsEmpty: false });
      await f.fixture.close();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("serves the actual gateway through TLS with a fixed Host and no control endpoint", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "prepared-artifact-fixture-"));
    const f = setup(); let server: Awaited<ReturnType<typeof startPreparedArtifactFixture>> | undefined;
    try {
      const keyPath = path.join(directory, "key.pem"), certPath = path.join(directory, "cert.pem");
      execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", keyPath,
        "-out", certPath, "-subj", "/CN=prepared.artifacts.test", "-addext", "subjectAltName=DNS:prepared.artifacts.test,IP:127.0.0.1"], { stdio: "ignore" });
      const cert = readFileSync(certPath);
      server = await startPreparedArtifactFixture({ publicJwk: f.publicJwk, key: readFileSync(keyPath), cert, address: "127.0.0.1" });
      const send = (claim: Record<string, unknown>, route = "/artifact", host = "prepared.artifacts.test:8140") => new Promise<{ status: number; body: string }>((resolve, reject) => {
        const put = claim.operation === "put";
        const req = https.request({ host: "127.0.0.1", port: 8140, servername: "prepared.artifacts.test", ca: cert, method: "PUT", path: route,
          headers: { host, authorization: `Bearer ${f.token(claim)}`, ...(put ? { "content-length": f.bytes.length } : {}) } }, response => {
          const chunks: Buffer[] = []; response.on("data", chunk => chunks.push(chunk));
          response.on("end", () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString("utf8") }));
        });
        req.on("error", reject); req.end(put ? f.bytes : undefined);
      });
      const claim = f.claim();
      expect((await send(claim)).status).toBe(200);
      expect((await send({ ...claim, operation: "tombstone" })).status).toBe(200);
      expect((await send(claim)).status).toBe(409);
      expect((await send(claim, "/snapshot")).status).toBe(404);
      expect((await send(claim, "/artifact", "external.invalid")).status).toBe(404);
      expect(server.snapshot()).toMatchObject({ requests: 5, objects: 1, payloadBytes: 0, tombstones: 1, allPayloadsEmpty: true });
    } finally { await server?.close(); await f.fixture.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
