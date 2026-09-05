import { describe, expect, it, vi } from "vitest";
import { authorizeIngestHttpRequest, ingestAuthorization, ingestChunkEnvelope, ingestRequestOrigin, readIngestChunk } from "./ingest-http";
import { ingestCookieName } from "./ingest-session";
import { INGEST_CHUNK_MAXIMUM_BYTES } from "../genome/ingest-limits";

const SESSION = "a0000000-0000-4000-8000-000000000001";
const url = `https://inherit.example/api/embryo-ingest/${SESSION}/chunks/0`;
function request(headers: Record<string, string> = {}, body?: ReadableStream<Uint8Array>) {
  return new Request(url, { method: "PUT", headers: { origin: "https://inherit.example",
    "content-type": "application/octet-stream", "content-length": "4", ...headers },
  ...(body ? { body, duplex: "half" } : {}) });
}
const metadata = { status: "authorized", session: SESSION, cohortId: SESSION, uploadId: SESSION, ingestRevision: 1,
  expiresAt: "2026-09-06T12:00:00+00:00", challenge: "a".repeat(43), transportRevision: 1,
  build: null, format: null, sampleCount: 2, handles: [{ ordinal: 0, hash: "a".repeat(64) }, { ordinal: 1, hash: "b".repeat(64) }] };

describe("ingest HTTP boundary", () => {
  it("requires the exact stored origin, not a browser hint", () => {
    expect(ingestRequestOrigin(request())).toBe("https://inherit.example");
    for (const origin of ["null", "https://evil.example", "https://inherit.example/", "https://inherit.example:443"]) {
      expect(ingestRequestOrigin(request({ origin }))).toBeNull();
    }
    expect(ingestRequestOrigin(new Request(url, { headers: { "sec-fetch-site": "same-origin" } }))).toBeNull();
  });
  it("does not touch the body during envelope validation", () => {
    const req = request();
    const read = vi.spyOn(req, "arrayBuffer");
    expect(ingestChunkEnvelope(req, SESSION, "0")).toEqual({ sequence: 0, length: 4 });
    expect(req.bodyUsed).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
  it.each(["-1", "+1", "01", "1.0", "1e1", " 1", "50", "9007199254740992"])("rejects noncanonical/out-of-range sequence %s", (sequence) => {
    expect(() => ingestChunkEnvelope(request(), SESSION, sequence)).toThrow();
  });
  it.each<Record<string, string>>([
    { "content-type": "text/plain" }, { "content-type": "application/octet-stream; charset=utf-8" },
    { "content-encoding": "identity" }, { "content-length": "0" }, { "content-length": "+4" },
    { "content-length": "04" }, { "content-length": "4, 4" }, { "content-length": String(INGEST_CHUNK_MAXIMUM_BYTES + 1) },
  ])("rejects an unbounded or encoded envelope", (headers) => {
    expect(() => ingestChunkEnvelope(request(headers), SESSION, "0")).toThrow();
  });
  it("rejects query credentials and invalid session ids", () => {
    expect(() => ingestChunkEnvelope(new Request(`${url}?token=secret`, { method: "PUT" }), SESSION, "0")).toThrow();
    expect(() => ingestChunkEnvelope(request(), "invalid", "0")).toThrow();
  });
  it("counts stream bytes instead of trusting declared length", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(5)); }, cancel });
    await expect(readIngestChunk(request({}, stream), 4)).rejects.toThrow("too_large");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(["ab\n", "abcd"])("refuses truncated length or incomplete logical framing", async (text) => {
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
    await expect(readIngestChunk(request({}, stream), 4)).rejects.toThrow("invalid_chunk");
  });
  it("reads a complete bounded body and sanitizes unexpected stream errors", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("abc\n")); c.close(); } });
    expect(await readIngestChunk(request({}, stream), 4)).toEqual(new TextEncoder().encode("abc\n"));
    const failed = new ReadableStream<Uint8Array>({ start(c) { c.error(new Error("PRIVATE SOURCE")); } });
    await expect(readIngestChunk(request({}, failed), 4)).rejects.toThrow(/^invalid_chunk$/);
  });
  it("cancels a blocked body read when the request aborts", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const req = new Request(url, { method: "PUT", body: stream, signal: controller.signal, duplex: "half" } as RequestInit);
    const pending = readIngestChunk(req, 4);
    controller.abort();
    await expect(pending).rejects.toThrow("invalid_chunk");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("accepts only the closed, ordinal-complete internal authorization projection", () => {
    expect(ingestAuthorization.safeParse(metadata).success).toBe(true);
    for (const value of [
      { ...metadata, cookieValue: "a".repeat(43) }, { ...metadata, sampleCount: 3 },
      { ...metadata, handles: metadata.handles.toReversed() },
      { ...metadata, handles: [metadata.handles[0], { ordinal: 1, hash: "a".repeat(64) }] },
      { ...metadata, build: "unknown" }, { ...metadata, transportRevision: 0 },
    ]) expect(ingestAuthorization.safeParse(value).success).toBe(false);
    expect(ingestAuthorization.safeParse({ status: "failure_pending", cohortId: SESSION, ingestRevision: 1 }).success).toBe(true);
  });
});

describe("HTTP credential orchestration", () => {
  const account = { accountId: SESSION, authSessionId: SESSION };
  const env = { NODE_ENV: "test", INHERIT_TEST_JURISDICTION: "1" };
  const validRequest = () => request({ cookie: `${ingestCookieName(SESSION, false)}=${"a".repeat(43)}` });
  it("derives every trusted RPC argument from server context, route, origin and cookie", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: metadata, error: null });
    const req = validRequest();
    const result = await authorizeIngestHttpRequest(req, SESSION, account, rpc, env);
    expect(result.kind).toBe("authorized");
    expect(rpc).toHaveBeenCalledExactlyOnceWith({ p_account_id: SESSION, p_auth_session_id: SESSION,
      p_ingest_session_id: SESSION, p_origin: "https://inherit.example", p_test_jurisdiction: true,
      p_cookie_hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(req.bodyUsed).toBe(false);
  });
  it("denies before database access or body reads for missing auth, origin, jurisdiction or cookie", async () => {
    for (const [req, context, settings, status] of [
      [validRequest(), null, env, 401], [request({ origin: "https://evil.example" }), account, env, 403],
      [validRequest(), account, {}, 403], [request(), account, env, 404],
    ] as const) {
      const rpc = vi.fn();
      const result = await authorizeIngestHttpRequest(req, SESSION, context, rpc, settings);
      expect(result.kind).toBe("denied");
      if (result.kind === "denied") {
        expect(result.response.status).toBe(status);
        expect(result.response.headers.get("cache-control")).toBe("private, no-store");
      }
      expect(rpc).not.toHaveBeenCalled();
      expect(req.bodyUsed).toBe(false);
    }
  });
  it("keeps unwind authority distinct from an authorized request", async () => {
    const authority = { status: "failure_pending", cohortId: SESSION, ingestRevision: 1 };
    const result = await authorizeIngestHttpRequest(validRequest(), SESSION, account,
      vi.fn().mockResolvedValue({ data: authority, error: null }), env);
    expect(result).toEqual({ kind: "failure_pending", authority });
  });
  it("returns unavailable for transient contention or malformed/foreign metadata", async () => {
    for (const response of [
      { data: null, error: { code: "55P03" } }, { data: { ...metadata, unexpected: "PRIVATE" }, error: null },
      { data: { ...metadata, session: "b0000000-0000-4000-8000-000000000001" }, error: null },
    ]) {
      const result = await authorizeIngestHttpRequest(validRequest(), SESSION, account, vi.fn().mockResolvedValue(response), env);
      expect(result.kind).toBe("denied");
      if (result.kind === "denied") {
        expect(result.response.status).toBe(503);
        expect(await result.response.json()).toEqual({ error: "unavailable" });
      }
    }
  });
});
