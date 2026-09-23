/** Synthetic binding for the real artifact gateway. No provider or outbound I/O.
 * Empty-payload evidence covers this process's map, never hosted R2 or media. */
import assert from "node:assert/strict";
import { createHash, createPublicKey, randomUUID } from "node:crypto";
import https from "node:https";
import { Readable } from "node:stream";
import gateway from "../../workers/prepared-artifacts/worker.mjs";

export const PREPARED_FIXTURE_ORIGIN = "https://prepared.artifacts.test:8140";
export const PREPARED_FIXTURE_BUCKET = "inherit-prepared-ci";
export const PREPARED_FIXTURE_ISSUER = "http://127.0.0.1:54321/auth/v1";
export const PREPARED_FIXTURE_LIMITS = Object.freeze({
  objectBytes: 8_388_608, totalBytes: 33_554_432, objects: 512, requests: 2048, concurrent: 8,
});
type Stored = { bytes: Uint8Array; version: string; etag: string; tombstone: boolean };
type PutOptions = { onlyIf?: Headers; sha256?: string; customMetadata?: { state?: string };
  httpMetadata?: { contentType?: string; cacheControl?: string } };
const hash = (algorithm: string, bytes: Uint8Array) => createHash(algorithm).update(bytes).digest("hex");
const objectKey = /^prepared\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type PreparedArtifactFixtureSnapshot = {
  requests: number; rejected: number; activeRequests: number; receivedBytes: number; objects: number; payloadBytes: number;
  payloadObjects: number; tombstones: number; putCommits: number; tombstoneCommits: number; getReads: number; allPayloadsEmpty: boolean;
};
export function createPreparedArtifactFixture(publicJwk: Record<string, unknown>,
  onChange?: (snapshot: PreparedArtifactFixtureSnapshot) => void) {
  assert(publicJwk && !Object.hasOwn(publicJwk, "d") && publicJwk.kty === "EC" && publicJwk.crv === "P-256"
    && typeof publicJwk.x === "string" && typeof publicJwk.y === "string" && typeof publicJwk.kid === "string"
    && objectKey.test(`prepared/${publicJwk.kid}`), "Synthetic public signing key required");
  const jwk = { kty: "EC", crv: "P-256", x: publicJwk.x, y: publicJwk.y, kid: publicJwk.kid };
  createPublicKey({ key: jwk, format: "jwk" });
  const values = new Map<string, Stored>();
  let requests = 0, rejected = 0, activeRequests = 0, receivedBytes = 0, payloadBytes = 0;
  let putCommits = 0, tombstoneCommits = 0, getReads = 0, closed = false;
  const snapshot = (): PreparedArtifactFixtureSnapshot => {
    const tombstones = [...values.values()].filter(value => value.tombstone).length;
    return { requests, rejected, activeRequests, receivedBytes, objects: values.size, payloadBytes,
      payloadObjects: values.size - tombstones, tombstones, putCommits, tombstoneCommits, getReads,
      allPayloadsEmpty: !closed && activeRequests === 0 && putCommits > 0 && payloadBytes === 0
        && values.size > 0 && tombstones === values.size };
  };
  const changed = () => onChange?.(snapshot());
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  const responseClosers = new Set<() => void>();
  const boundedBytes = async (body: Uint8Array | ReadableStream<Uint8Array>) => {
    const reader = (body instanceof Uint8Array ? new Response(Uint8Array.from(body).buffer).body! : body).getReader();
    readers.add(reader);
    let size = 0, timedOut = false;
    const chunks: Uint8Array[] = [];
    const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 10_000);
    try {
      for (;;) {
        const next = await reader.read();
        assert(!closed && !timedOut, "Fixture body unavailable");
        if (next.done) break;
        size += next.value.byteLength;
        receivedBytes += next.value.byteLength;
        changed();
        assert(size <= PREPARED_FIXTURE_LIMITS.objectBytes && receivedBytes <= PREPARED_FIXTURE_LIMITS.totalBytes,
          "Fixture byte allowance exhausted");
        chunks.push(Uint8Array.from(next.value));
      }
      return Uint8Array.from(Buffer.concat(chunks));
    } finally {
      clearTimeout(timer); readers.delete(reader);
      // Stream cancellation may invoke an untrusted pending cancel hook. The
      // closed/timedOut fences refuse commits without awaiting that hook.
      void reader.cancel().catch(() => {}); reader.releaseLock();
    }
  };
  const read = (key: string, range?: { offset: number; length: number }) => {
    assert(objectKey.test(key) && !closed, "Fixture object refused");
    const value = values.get(key); if (!value) return null;
    const bytes = range ? value.bytes.slice(range.offset, range.offset + range.length) : Uint8Array.from(value.bytes);
    return { version: value.version, etag: value.etag, httpEtag: `"${value.etag}"`, size: value.bytes.length,
      body: new Response(bytes.buffer).body!, arrayBuffer: async () => bytes.buffer };
  };
  const binding = {
    async head(key: string) {
      assert(objectKey.test(key) && !closed, "Fixture object refused");
      const value = values.get(key);
      return value ? { version: value.version, etag: value.etag, size: value.bytes.length } : null;
    },
    async get(key: string, options?: { range?: { offset: number; length: number } }) {
      getReads++; changed(); return read(key, options?.range);
    },
    async put(key: string, body: Uint8Array | ReadableStream<Uint8Array>, options: PutOptions) {
      assert(objectKey.test(key) && !closed, "Fixture object refused");
      const tombstone = options.customMetadata?.state === "tombstone";
      assert(tombstone ? body instanceof Uint8Array && body.length === 0 && !options.sha256 && !options.onlyIf
        : options.onlyIf?.get("If-None-Match") === "*" && /^[a-f0-9]{64}$/.test(options.sha256 ?? ""),
      "Fixture requires a conditional checked payload or empty marker");
      const bytes = await boundedBytes(body);
      if (!tombstone) assert(hash("sha256", bytes) === options.sha256, "Fixture checksum mismatch");
      // Check after EOF, with no await between condition and commit: a marker
      // written while a PUT body was arriving permanently wins this race.
      if (options.onlyIf && values.has(key)) return null;
      assert(values.has(key) || values.size < PREPARED_FIXTURE_LIMITS.objects, "Fixture object allowance exhausted");
      const previous = values.get(key);
      const nextBytes = payloadBytes - (previous?.bytes.length ?? 0) + bytes.length;
      assert(!closed && nextBytes <= PREPARED_FIXTURE_LIMITS.totalBytes, "Fixture payload allowance exhausted");
      previous?.bytes.fill(0);
      const value = { bytes, version: randomUUID().replaceAll("-", ""), etag: hash("md5", bytes), tombstone };
      values.set(key, value); payloadBytes = nextBytes;
      if (tombstone) tombstoneCommits++; else putCommits++;
      changed();
      return { version: value.version, etag: value.etag, size: value.bytes.length };
    },
  };
  const env = { ARTIFACTS: binding, SIGNING_PUBLIC_KEYS: JSON.stringify([jwk]),
    TOKEN_ISSUER: PREPARED_FIXTURE_ISSUER, BUCKET_NAME: PREPARED_FIXTURE_BUCKET };
  changed();
  return {
    async fetch(request: Request): Promise<Response> {
      requests = Math.min(requests + 1, PREPARED_FIXTURE_LIMITS.requests + 1);
      const refuse = (status: number) => { rejected++; changed(); return new Response(null, { status }); };
      if (closed || requests > PREPARED_FIXTURE_LIMITS.requests || activeRequests >= PREPARED_FIXTURE_LIMITS.concurrent) return refuse(503);
      const url = new URL(request.url);
      if (url.origin !== PREPARED_FIXTURE_ORIGIN || url.pathname !== "/artifact" || url.search || url.hash
        || !["GET", "PUT"].includes(request.method)) return refuse(404);
      const length = request.headers.get("content-length");
      if (length && (!/^\d+$/.test(length) || Number(length) > PREPARED_FIXTURE_LIMITS.objectBytes)) return refuse(413);
      activeRequests++;
      changed();
      let responseOwnsRequest = false;
      try {
        const response = await gateway.fetch(request, env);
        if (response.status >= 400) rejected++;
        if (request.method === "GET" && response.ok && response.body) {
          const reader = response.body.getReader(); readers.add(reader);
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true; readers.delete(reader); responseClosers.delete(finish);
            activeRequests--; changed();
          };
          responseClosers.add(finish); responseOwnsRequest = true;
          const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                const next = await reader.read();
                if (next.done) { controller.close(); finish(); } else controller.enqueue(next.value);
              } catch { controller.error(new Error("Fixture response unavailable")); finish(); }
            },
            cancel() { void reader.cancel().catch(() => {}); finish(); },
          });
          return new Response(body, { status: response.status, headers: response.headers });
        }
        return response;
      } finally { if (!responseOwnsRequest) { activeRequests--; changed(); } }
    },
    snapshot,
    async close() {
      closed = true;
      for (const reader of readers) void reader.cancel().catch(() => {});
      for (const finish of responseClosers) finish();
      for (const value of values.values()) value.bytes.fill(0);
      values.clear(); payloadBytes = 0;
      changed();
    },
  };
}

/** Fixed CI namespace listener. Loopback is only for standalone fixture tests;
 * no caller-supplied destination, proxy, provider, bucket or object path exists. */
export async function startPreparedArtifactFixture(options: {
  publicJwk: Record<string, unknown>; key: Buffer; cert: Buffer;
  address?: "203.0.114.11" | "127.0.0.1";
  onChange?: (snapshot: PreparedArtifactFixtureSnapshot) => void;
}) {
  assert(options.address === undefined || ["203.0.114.11", "127.0.0.1"].includes(options.address), "Fixture address refused");
  const fixture = createPreparedArtifactFixture(options.publicJwk, options.onChange);
  const server = https.createServer({ key: options.key, cert: options.cert, maxHeaderSize: 8192 }, async (incoming, outgoing) => {
    try {
      // Relative path only; absolute-form targets and foreign Host headers are
      // not forwarded anywhere, including when signed by the fixture's key.
      const admitted = incoming.headers.host === "prepared.artifacts.test:8140" && incoming.url === "/artifact";
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) if (typeof value === "string") headers.set(name, value);
      const request = new Request(`${PREPARED_FIXTURE_ORIGIN}/${admitted ? "artifact" : "refused"}`, { method: incoming.method, headers,
        ...(incoming.method === "PUT" ? { body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: "half" } : {}) } as RequestInit);
      const response = await fixture.fetch(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
        outgoing.once("close", () => body.destroy()); body.on("error", () => outgoing.destroy()); body.pipe(outgoing);
      }
      else outgoing.end();
    } catch { if (!outgoing.headersSent) outgoing.writeHead(503); outgoing.end(); }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 5000; server.maxRequestsPerSocket = 128;
  server.setTimeout(10_000, socket => socket.destroy());
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(8140, options.address ?? "203.0.114.11", resolve); });
  } catch (error) { await fixture.close(); throw error; }
  return { snapshot: fixture.snapshot,
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fixture.close(); } };
}
