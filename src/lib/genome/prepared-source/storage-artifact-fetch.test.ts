import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreparedArtifactFetch } from "./storage-artifact-fetch";
import type { PreparedStoredArtifact } from "./storage-writer";
import { readVerifiedPreparedArtifact } from "./verified-artifact-reader";

const bytes = new TextEncoder().encode("synthetic prepared root");
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
function artifact(): PreparedStoredArtifact {
  return { receipt: { version: "own-preparation-artifact-v1",
    artifactId: "11111111-1111-4111-8111-111111111111", jobId: "22222222-2222-4222-8222-222222222222",
    attemptId: "33333333-3333-4333-8333-333333333333", sequence: 0, bucket: "genomes",
    objectKey: "prepared/44444444-4444-4444-8444-444444444444", byteCount: bytes.length, sha256: sha(bytes),
    writeExpiresAt: "2020-01-01T00:00:00Z" }, storageObjectId: "55555555-5555-4555-8555-555555555555" };
}
function streaming(chunks: Uint8Array[] = [bytes], headers: HeadersInit = {}, status = 200) {
  const cancel = vi.fn(); let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { if (offset < chunks.length) controller.enqueue(chunks[offset++]); else controller.close(); }, cancel,
  }, { highWaterMark: 0 });
  return { response: new Response(body, { status, headers }), cancel };
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-local-fixture");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("authenticated full prepared-artifact transport", () => {
  it("uses trusted authenticated full GET and verifies actual EOF/hash with authority on both sides", async () => {
    const f = streaming([bytes.subarray(0, 4), bytes.subarray(4)], { "content-length": String(bytes.length) });
    const fetch = vi.fn(async () => f.response); vi.stubGlobal("fetch", fetch);
    const check = vi.fn(async () => {}), signal = AbortSignal.timeout(1_000);
    const result = await readVerifiedPreparedArtifact(artifact(), { readArtifact: createPreparedArtifactFetch(), check, signal });
    expect(result).toEqual(bytes); expect(check).toHaveBeenCalledTimes(2); expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:55321/storage/v1/object/authenticated/genomes/" + artifact().receipt.objectKey);
    expect(options).toMatchObject({ method: "GET", cache: "no-store", redirect: "error",
      headers: { Authorization: "Bearer synthetic-local-fixture", apikey: "synthetic-local-fixture", "Accept-Encoding": "identity" } });
    expect(new Headers(options.headers).has("Range")).toBe(false);
    expect(options.signal?.aborted).toBe(true); expect(signal.aborted).toBe(false);
  });
  it("accepts chunked identity responses and leaves actual length/hash validation to the verified reader", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streaming([bytes], { "content-encoding": "identity" }).response));
    await expect(readVerifiedPreparedArtifact(artifact(), { readArtifact: createPreparedArtifactFetch(),
      check: async () => {}, signal: AbortSignal.timeout(1_000) })).resolves.toEqual(bytes);
  });
  it.each(["short", "long", "wrong hash"])("the verified reader refuses %s actual bytes despite acceptable headers", async kind => {
    const actual = kind === "short" ? bytes.subarray(1) : kind === "long" ? new Uint8Array(bytes.length + 1) : new Uint8Array(bytes.length);
    vi.stubGlobal("fetch", vi.fn(async () => streaming([actual]).response));
    const check = vi.fn(async () => {});
    await expect(readVerifiedPreparedArtifact(artifact(), { readArtifact: createPreparedArtifactFetch(), check,
      signal: AbortSignal.timeout(1_000) })).rejects.toMatchObject({ code: "integrity_mismatch" });
    expect(check).toHaveBeenCalledTimes(1);
  });
  it.each(["extra key", "wrong bucket", "URL key", "traversal", "original key", "wrong object ID", "zero bytes", "too many bytes",
    "huge string", "wide receipt", "getter", "nested"])("refuses %s before fetch", async kind => {
    const raw = artifact(), getter = vi.fn(() => "private");
    if (kind === "extra key") Object.assign(raw, { url: "https://elsewhere.example.test" });
    if (kind === "wrong bucket") Object.assign(raw.receipt, { bucket: "other" });
    if (kind === "URL key") raw.receipt.objectKey = "https://elsewhere.example.test/object";
    if (kind === "traversal") raw.receipt.objectKey = "prepared/../original";
    if (kind === "original key") raw.receipt.objectKey = raw.receipt.objectKey.slice(9);
    if (kind === "wrong object ID") raw.storageObjectId = "invalid";
    if (kind === "zero bytes") raw.receipt.byteCount = 0;
    if (kind === "too many bytes") raw.receipt.byteCount = 8_388_609;
    if (kind === "huge string") raw.receipt.sha256 = "a".repeat(10_000);
    if (kind === "wide receipt") for (let i = 0; i < 20; i++) Object.assign(raw.receipt, { [String(i)]: i });
    if (kind === "getter") Object.defineProperty(raw, "receipt", { enumerable: true, get: getter });
    if (kind === "nested") Object.assign(raw.receipt, { extra: { nested: {} } });
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(createPreparedArtifactFetch()(raw, AbortSignal.timeout(1_000))).rejects.toMatchObject({ code: "invalid_artifact" });
    expect(fetch).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled();
  });
  it.each(["missing key", "missing URL", "insecure remote", "URL credentials", "URL query"])("refuses invalid trusted configuration: %s", kind => {
    if (kind === "missing key") vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    if (kind === "missing URL") vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    if (kind === "insecure remote") vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://remote.example.test");
    if (kind === "URL credentials") vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://user@remote.example.test");
    if (kind === "URL query") vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://remote.example.test?key=private");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(() => createPreparedArtifactFetch()).toThrow("unavailable"); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["partial", "error", "range", "gzip", "length", "noncanonical length", "empty encoding"])("cancels rejected %s responses without consuming provider error content", async kind => {
    const headers: Record<string, string> = {};
    if (kind === "range") headers["content-range"] = `bytes 0-${bytes.length - 1}/${bytes.length}`;
    if (kind === "gzip") headers["content-encoding"] = "gzip";
    if (kind === "length") headers["content-length"] = String(bytes.length + 1);
    if (kind === "noncanonical length") headers["content-length"] = "0" + bytes.length;
    if (kind === "empty encoding") headers["content-encoding"] = "";
    const f = streaming([bytes], headers, kind === "partial" ? 206 : kind === "error" ? 503 : 200);
    vi.stubGlobal("fetch", vi.fn(async () => f.response));
    await expect(createPreparedArtifactFetch()(artifact(), AbortSignal.timeout(1_000))).rejects.toMatchObject({
      code: "integrity_mismatch", message: "integrity_mismatch" });
    expect(f.cancel).toHaveBeenCalledTimes(1);
  });
  it("refuses a missing response body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null)));
    await expect(createPreparedArtifactFetch()(artifact(), AbortSignal.timeout(1_000))).rejects.toMatchObject({ code: "integrity_mismatch" });
  });
  it("owns the receipt before the provider callback can mutate caller metadata", async () => {
    const raw = artifact();
    vi.stubGlobal("fetch", vi.fn(async () => {
      raw.receipt.byteCount++; return streaming([bytes], { "content-length": String(bytes.length) }).response;
    }));
    const stream = await createPreparedArtifactFetch()(raw, AbortSignal.timeout(1_000));
    const iterator = stream[Symbol.asyncIterator](); expect((await iterator.next()).value).toEqual(bytes); await iterator.return?.();
  });
  it.each(["before first next", "after first chunk"])("consumer stop %s cancels body and request without aborting its caller", async when => {
    const f = streaming([bytes, bytes]); let requestSignal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => { requestSignal = init.signal!; return f.response; }));
    const signal = AbortSignal.timeout(1_000), stream = await createPreparedArtifactFetch()(artifact(), signal);
    const iterator = stream[Symbol.asyncIterator]();
    if (when === "after first chunk") await iterator.next();
    await iterator.return?.(); expect(f.cancel).toHaveBeenCalledTimes(1); expect(requestSignal.aborted).toBe(true);
    expect(signal.aborted).toBe(false); expect(await iterator.next()).toMatchObject({ done: true });
  });
  it("cancels an acquired but never iterated response on caller abort", async () => {
    const f = streaming(), controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => f.response));
    await createPreparedArtifactFetch()(artifact(), controller.signal); controller.abort();
    expect(f.cancel).toHaveBeenCalledTimes(1);
  });
  it("does not fetch with an already aborted signal", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(createPreparedArtifactFetch()(artifact(), AbortSignal.abort())).rejects.toMatchObject({ code: "aborted" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("cancels a late response when fetch ignores cancellation", async () => {
    const f = streaming(), controller = new AbortController(); let resolve!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(accept => { resolve = accept; })));
    const pending = createPreparedArtifactFetch()(artifact(), controller.signal); controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    resolve(f.response); await Promise.resolve(); expect(f.cancel).toHaveBeenCalledTimes(1);
  });
  it("observes synchronous abort plus rejecting fetch without exposing its error", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(() => { controller.abort(); return Promise.reject(new Error("private provider payload")); }));
    await expect(createPreparedArtifactFetch()(artifact(), controller.signal)).rejects.toMatchObject({ code: "aborted", message: "aborted" });
    await Promise.resolve();
  });
  it("hides fetch and body errors and never retries", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("private provider payload")); vi.stubGlobal("fetch", fetch);
    await expect(createPreparedArtifactFetch()(artifact(), AbortSignal.timeout(1_000))).rejects.toMatchObject({ message: "unavailable" });
    fetch.mockResolvedValueOnce(new Response(new ReadableStream({ pull() { throw new Error("private stream payload"); } })));
    const stream = await createPreparedArtifactFetch()(artifact(), AbortSignal.timeout(1_000));
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: "unavailable", message: "unavailable" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("aborts a stalled read and observes rejecting provider cancellation", async () => {
    const controller = new AbortController(), cancel = vi.fn(async () => { throw new Error("private cancel payload"); });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel }))));
    const stream = await createPreparedArtifactFetch()(artifact(), controller.signal), iterator = stream[Symbol.asyncIterator]();
    const read = iterator.next(); controller.abort();
    await expect(read).rejects.toMatchObject({ code: "aborted" }); expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("refuses concurrent reads and closes the single owned body", async () => {
    const cancel = vi.fn(); vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel }))));
    const stream = await createPreparedArtifactFetch()(artifact(), AbortSignal.timeout(1_000)), iterator = stream[Symbol.asyncIterator]();
    const first = iterator.next();
    await expect(iterator.next()).rejects.toMatchObject({ code: "unavailable" });
    await expect(first).rejects.toMatchObject({ code: "aborted" }); expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("refuses two iterator owners", async () => {
    const f = streaming(); vi.stubGlobal("fetch", vi.fn(async () => f.response));
    const stream = await createPreparedArtifactFetch()(artifact(), AbortSignal.timeout(1_000)); stream[Symbol.asyncIterator]();
    expect(() => stream[Symbol.asyncIterator]()).toThrow("unavailable"); expect(f.cancel).toHaveBeenCalledTimes(1);
  });
});
