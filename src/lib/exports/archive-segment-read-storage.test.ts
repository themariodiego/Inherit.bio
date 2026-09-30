import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSupabaseArchiveReader } from "./archive-segment-read-storage";
import { readArchiveSegment } from "./archive-segment-reader";
import { type ArchiveAttempt, type StoredArchiveSegment } from "./archive-segments";

const origin = "https://example.supabase.co", key = "synthetic-storage-key", receipt = "e".repeat(64);
const payload = new TextEncoder().encode("complete synthetic export bytes");
const attempt: ArchiveAttempt = { version: "archive-segments-v1", bucket: "exports", principalHash: "a".repeat(64),
  exportId: "10000000-0000-4000-8000-000000000001", attemptId: "20000000-0000-4000-8000-000000000002" };
const segment: StoredArchiveSegment = { ordinal: 0, offset: 0, sizeBytes: payload.length,
  sha256: createHash("sha256").update(payload).digest("hex"), objectId: "30000000-0000-4000-8000-000000000003",
  objectKey: `${attempt.principalHash}/${attempt.exportId}/${attempt.attemptId}-0.part` };
const version = "40000000-0000-4000-8000-000000000004", entity = createHash("md5").update(payload).digest("hex");
const metadata = () => ({ id: segment.objectId, version, name: segment.objectKey, bucket_id: "exports",
  size: payload.length, content_type: "application/octet-stream", etag: entity });
const headers = () => ({ "content-type": "application/octet-stream", "content-length": String(payload.length), etag: `"${entity}"` });
function fixture(respond?: (url: string, init: RequestInit, nth: number) => Response | Promise<Response>) {
  let nth = 0; const controller = new AbortController();
  const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); nth++;
    return respond ? respond(url, init!, nth) : url.includes("/object/info/")
      ? new Response(JSON.stringify(metadata())) : new Response(payload, { headers: headers() });
  });
  const checkAuthority = vi.fn(async () => receipt);
  return { transport, controller, checkAuthority, options: { attempt, segment, authorityReceipt: receipt,
    signal: controller.signal, deadline: Date.now() + 60_000, checkAuthority,
    readObject: createSupabaseArchiveReader({ origin, serviceRoleKey: key, fetch: transport }) } };
}
afterEach(() => { vi.useRealTimers(); });

describe("exact Supabase archive byte transport", () => {
  it("uses the installed SDK for two exact identity proofs around one conditional whole-object GET", async () => {
    const f = fixture();
    expect(await readArchiveSegment(f.options)).toEqual(payload);
    expect(f.transport.mock.calls.map(call => String(call[0]))).toEqual([
      `${origin}/storage/v1/object/info/exports/${segment.objectKey}`,
      `${origin}/storage/v1/object/exports/${segment.objectKey}`,
      `${origin}/storage/v1/object/info/exports/${segment.objectKey}`,
    ]);
    for (const [, init] of f.transport.mock.calls) {
      expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
      expect(init!.signal).toBeInstanceOf(AbortSignal); expect(init!.body).toBeUndefined();
      const given = new Headers(init!.headers);
      expect(given.get("authorization")).toBe(`Bearer ${key}`); expect(given.has("range")).toBe(false);
    }
    const given = new Headers(f.transport.mock.calls[1][1]!.headers);
    expect(given.get("if-match")).toBe(`"${entity}"`); expect(given.get("accept-encoding")).toBe("identity");
    expect(f.checkAuthority).toHaveBeenCalledTimes(3);
  });

  it.each(["id", "name", "bucket_id", "size", "content_type", "version", "etag"])("refuses wrong initial metadata %s before downloading bytes", async field => {
    const f = fixture(() => new Response(JSON.stringify({ ...metadata(), [field]: field === "size" ? payload.length + 1 : "foreign" })));
    await expect(readArchiveSegment(f.options)).rejects.toMatchObject({ code: "storage" });
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it.each(["id", "version", "etag", "name", "size"])("refuses changed final %s without returning any bytes", async field => {
    const f = fixture((url, _init, nth) => url.includes("/object/info/") ? new Response(JSON.stringify({ ...metadata(),
      ...(nth === 3 ? { [field]: field === "size" ? payload.length + 1 : "50000000-0000-4000-8000-000000000005" } : {}) })) : new Response(payload, { headers: headers() }));
    let released = false;
    await expect(readArchiveSegment(f.options).then(bytes => { released = true; return bytes; })).rejects.toMatchObject({ code: "storage" });
    expect(released).toBe(false); expect(f.transport).toHaveBeenCalledTimes(3);
  });
  it.each([
    ["partial", { "content-range": `bytes 0-3/${payload.length}` }], ["compressed", { "content-encoding": "gzip" }],
    ["wrong length", { "content-length": String(payload.length + 1) }], ["wrong MIME", { "content-type": "text/plain" }],
    ["wrong ETag", { etag: '"00000000000000000000000000000000"' }],
  ])("refuses %s response headers and cancels the original body", async (_name, change) => {
    const cancel = vi.fn();
    const f = fixture(url => url.includes("/object/info/") ? new Response(JSON.stringify(metadata()))
      : new Response(new ReadableStream({ cancel }), { headers: { ...headers(), ...change } }));
    await expect(readArchiveSegment(f.options)).rejects.toMatchObject({ code: "storage" });
    expect(cancel).toHaveBeenCalledOnce(); expect(f.transport).toHaveBeenCalledTimes(2);
  });
  it.each([206, 304, 307, 404, 500])("refuses HTTP %i without a retry or a byte result", async status => {
    const f = fixture(url => url.includes("/object/info/") ? new Response(JSON.stringify(metadata()))
      : new Response(status === 304 ? null : payload, { status, headers: headers() }));
    await expect(readArchiveSegment(f.options)).rejects.toMatchObject({ code: "storage" });
    expect(f.transport).toHaveBeenCalledTimes(2);
  });
  it("refuses a redirect or foreign response URL, even with the right bytes", async () => {
    for (const field of ["redirected", "url"] as const) {
      const f = fixture(url => {
        const reply = url.includes("/object/info/") ? new Response(JSON.stringify(metadata())) : new Response(payload, { headers: headers() });
        Object.defineProperty(reply, field, { value: field === "url" ? "https://elsewhere.invalid/private" : true }); return reply;
      });
      await expect(readArchiveSegment(f.options)).rejects.toMatchObject({ code: "storage" }); expect(f.transport).toHaveBeenCalledOnce();
    }
  });
  it.each(["short", "wrong digest"])("refuses %s bytes despite matching headers/metadata", async kind => {
    const f = fixture(url => url.includes("/object/info/") ? new Response(JSON.stringify(metadata()))
      : new Response(kind === "short" ? payload.subarray(1) : new Uint8Array(payload.length), { headers: headers() }));
    await expect(readArchiveSegment(f.options)).rejects.toMatchObject({ code: "integrity" });
  });
  it.each([`"${entity}`, `${entity}"`, `W/"${entity}"`, "not-an-etag"])("refuses malformed or weak ETag %s", async invalid => {
    const f = fixture(() => new Response(JSON.stringify({ ...metadata(), etag: invalid })));
    await expect(readArchiveSegment(f.options)).rejects.toMatchObject({ code: "storage" }); expect(f.transport).toHaveBeenCalledOnce();
  });
  it("pins trusted configuration and the exact descriptor before awaiting the provider", async () => {
    const config = { origin, serviceRoleKey: key, fetch: fixture().transport };
    const reader = createSupabaseArchiveReader(config); config.origin = "https://other.invalid"; config.serviceRoleKey = "changed";
    const f = fixture(); f.options.readObject = reader;
    expect(await readArchiveSegment(f.options)).toEqual(payload);
    expect(config.fetch.mock.calls.every(call => String(call[0]).startsWith(origin))).toBe(true);
    expect(new Headers(config.fetch.mock.calls[1][1]!.headers).get("authorization")).toBe(`Bearer ${key}`);
  });
  it.each(["http://elsewhere.invalid", "https://example.supabase.co/extra", "https://name:secret@example.supabase.co"])("refuses configuration %s before any network access", invalid => {
    const transport = vi.fn();
    expect(() => createSupabaseArchiveReader({ origin: invalid, serviceRoleKey: key, fetch: transport })).toThrow("invalid_input");
    expect(transport).not.toHaveBeenCalled();
  });
  it("refuses current authority revoked after the provider reaches EOF", async () => {
    const f = fixture(); let calls = 0; f.checkAuthority.mockImplementation(async () => ++calls === 3 ? "f".repeat(64) : receipt);
    await expect(readArchiveSegment(f.options)).rejects.toMatchObject({ code: "authority" }); expect(f.transport).toHaveBeenCalledTimes(3);
  });
  it("bounds a noncooperative final metadata read without releasing its buffered bytes", async () => {
    vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}));
    const f = fixture((url, _init, nth) => nth === 3 ? new Response(new ReadableStream({ pull: () => new Promise<void>(() => {}), cancel }))
      : url.includes("/object/info/") ? new Response(JSON.stringify(metadata())) : new Response(payload, { headers: headers() }));
    const pending = expect(readArchiveSegment(f.options)).rejects.toMatchObject({ code: "deadline" });
    await vi.advanceTimersByTimeAsync(30_001); await pending; expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(["complete", "truncated"])("exercises native HTTP %s framing through an injected local provider", async kind => {
    const requests: string[] = []; const server = createServer((request, response) => {
      requests.push(request.url!);
      if (request.url!.includes("/object/info/")) { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(metadata())); }
      else { for (const [name, value] of Object.entries(headers())) response.setHeader(name, value); response.write(payload.subarray(0, 3));
        if (kind === "truncated") setImmediate(() => response.destroy()); else response.end(payload.subarray(3)); }
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address();
    if (!address || typeof address === "string") throw new Error("test provider unavailable");
    try {
      const f = fixture(async (url, init) => {
        const path = new URL(url).pathname; const value = await fetch(`http://127.0.0.1:${address.port}${path}`, init);
        // The injected provider substitutes its local origin; production still
        // validates the real response URL. This proves native framing/EOF only.
        return new Response(value.body, { status: value.status, headers: value.headers });
      });
      if (kind === "complete") expect(await readArchiveSegment(f.options)).toEqual(payload);
      else await expect(readArchiveSegment(f.options)).rejects.toMatchObject({ code: "storage" });
      expect(requests).toEqual(f.transport.mock.calls.map(call => new URL(String(call[0])).pathname)); expect(requests).toHaveLength(kind === "complete" ? 3 : 2);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
