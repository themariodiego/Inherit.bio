import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { streamPreparedOriginalDownload, type PreparedOriginalDownloadOptions } from "./prepared-original-download";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function fixture(length = 24) {
  const raw = Buffer.alloc(length, 37), check = vi.fn(async () => {}), controller = new AbortController();
  const options: PreparedOriginalDownloadOptions = { source: { version: "prepared-original-download-v1", fileId: randomUUID(),
    manifestId: randomUUID(), sourceRevision: 1, rawSha256: sha(raw), bucket: "genomes", objectId: randomUUID(),
    objectKey: randomUUID(), storageVersion: randomUUID(), sizeBytes: raw.length, expiresAt: new Date(Date.now() + 300_000).toISOString() },
    signal: controller.signal, check, readRange: vi.fn(async (_source, start, end) => new Response(Uint8Array.from(raw.subarray(start, end + 1)), {
      status: 206, headers: { "content-range": `bytes ${start}-${end}/${raw.length}`, "content-length": String(end - start + 1) },
    })) };
  return { raw, options, check, controller };
}
async function collect(stream: AsyncIterable<Uint8Array>) { const parts = []; for await (const bytes of stream) parts.push(bytes); return Buffer.concat(parts); }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("revocable prepared original byte stream", () => {
  it("hashes exact raw bytes through EOF and checks before/after each bounded range and EOF", async () => {
    const f = fixture(2_097_159);
    expect(await collect(streamPreparedOriginalDownload(f.options))).toEqual(f.raw);
    expect(vi.mocked(f.options.readRange!).mock.calls.map(([, a, b]) => [a, b])).toEqual([[0, 1_048_575], [1_048_576, 2_097_151], [2_097_152, 2_097_158]]);
    expect(f.check).toHaveBeenCalledTimes(7);
  });
  it("respects backpressure and early return without fetching the next range", async () => {
    const f = fixture(2_097_159), stream = streamPreparedOriginalDownload(f.options);
    await stream.next(); await Promise.resolve(); expect(f.options.readRange).toHaveBeenCalledTimes(1);
    await stream.return(undefined); expect(f.options.readRange).toHaveBeenCalledTimes(1);
    expect(f.controller.signal.aborted).toBe(false);
  });
  it("refuses revocation before fetching", async () => {
    const f = fixture(); f.check.mockRejectedValue(new Error("sensitive denied context"));
    await expect(collect(streamPreparedOriginalDownload(f.options))).rejects.toThrow(/^unavailable$/);
    expect(f.options.readRange).not.toHaveBeenCalled();
  });
  it("withholds fetched range if authorization changes before release", async () => {
    const f = fixture(); f.check.mockResolvedValueOnce().mockRejectedValueOnce(new Error("denied"));
    await expect(streamPreparedOriginalDownload(f.options).next()).rejects.toMatchObject({ code: "unavailable" });
  });
  it("refuses true EOF if withdrawal occurs while consumer holds the final chunk", async () => {
    const f = fixture(), stream = streamPreparedOriginalDownload(f.options); expect((await stream.next()).done).toBe(false);
    f.check.mockRejectedValue(new Error("withdrawn")); await expect(stream.next()).rejects.toThrow(/^unavailable$/);
  });
  it("pins owned identity against caller or callback mutation", async () => {
    const f = fixture(1_048_580), original = structuredClone(f.options.source);
    f.options.check = async supplied => { supplied.objectKey = randomUUID(); };
    const stream = streamPreparedOriginalDownload(f.options); await stream.next(); f.options.source.objectKey = randomUUID(); await stream.next(); await stream.next();
    expect(vi.mocked(f.options.readRange!).mock.calls.every(([source]) => source.objectKey === original.objectKey)).toBe(true);
  });
  it.each(["hash", "short", "long", "range", "length", "encoding", "status", "redirect"])("refuses %s corruption without releasing first range", async kind => {
    const f = fixture(); if (kind === "hash") f.options.source.rawSha256 = "f".repeat(64);
    f.options.readRange = async (_s, a, b) => {
      const response = new Response(kind === "short" ? f.raw.subarray(1) : kind === "long" ? Buffer.concat([f.raw, Buffer.from("x")]) : f.raw,
        { status: kind === "status" ? 200 : 206, headers: { "content-range": kind === "range" ? `bytes 1-${b}/${f.raw.length}` : `bytes ${a}-${b}/${f.raw.length}`,
          ...(kind === "length" ? { "content-length": "1" } : {}), ...(kind === "encoding" ? { "content-encoding": "gzip" } : {}) } });
      if (kind === "redirect") Object.defineProperty(response, "redirected", { value: true }); return response;
    };
    await expect(streamPreparedOriginalDownload(f.options).next()).rejects.toMatchObject({ code: "integrity_mismatch" });
  });
  it("does not accept an exact prefix before late provider EOF", async () => {
    const f = fixture(), cancel = vi.fn();
    f.options.readRange = async () => new Response(new ReadableStream({ start(c) { c.enqueue(f.raw); }, cancel }),
      { status: 206, headers: { "content-range": `bytes 0-${f.raw.length - 1}/${f.raw.length}` } });
    const stream = streamPreparedOriginalDownload(f.options), next = stream.next();
    const assertion = expect(next).rejects.toMatchObject({ code: "aborted" });
    await new Promise(r => setTimeout(r, 1)); f.controller.abort(); await assertion; expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("cancels an aborted fetch's late response and never performs post-read checks", async () => {
    const f = fixture(), cancel = vi.fn(); let resolve!: (r: Response) => void;
    f.options.readRange = () => new Promise(r => { resolve = r; });
    const assertion = expect(streamPreparedOriginalDownload(f.options).next()).rejects.toMatchObject({ code: "aborted" });
    await new Promise(r => setTimeout(r, 1)); f.controller.abort(); await assertion;
    resolve(new Response(new ReadableStream({ cancel }))); await new Promise(r => setTimeout(r, 1));
    expect(cancel).toHaveBeenCalledTimes(1); expect(f.check).toHaveBeenCalledTimes(1);
  });
  it("cancels a response when abort wins between resolution observer and continuation", async () => {
    const f = fixture(), cancel = vi.fn(); let resolve!: (r: Response) => void;
    const pending = new Promise<Response>(r => { resolve = r; });
    void pending.then(() => { queueMicrotask(() => f.controller.abort()); });
    f.options.readRange = () => pending;
    const assertion = expect(streamPreparedOriginalDownload(f.options).next()).rejects.toMatchObject({ code: "aborted" });
    await new Promise(r => setTimeout(r, 1)); resolve(new Response(new ReadableStream({ cancel })));
    await assertion; expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("bounds stalled network and final authorization to 30 seconds", async () => {
    vi.useFakeTimers(); const f = fixture(); f.options.readRange = () => new Promise(() => {});
    const first = expect(streamPreparedOriginalDownload(f.options).next()).rejects.toMatchObject({ code: "aborted" });
    await vi.advanceTimersByTimeAsync(30_001); await first;
    const g = fixture(), stream = streamPreparedOriginalDownload(g.options); await stream.next();
    g.check.mockImplementation(() => new Promise(() => {}));
    const last = expect(stream.next()).rejects.toMatchObject({ code: "aborted" });
    await vi.advanceTimersByTimeAsync(30_001); await last; expect(vi.getTimerCount()).toBe(0);
  });
  it("captured expiry stops a paused multi-range stream before another provider request", async () => {
    vi.useFakeTimers(); const f = fixture(1_048_580); f.options.source.expiresAt = new Date(Date.now() + 1000).toISOString();
    const stream = streamPreparedOriginalDownload(f.options); await stream.next(); await vi.advanceTimersByTimeAsync(1001);
    await expect(stream.next()).rejects.toMatchObject({ code: "aborted" }); expect(f.options.readRange).toHaveBeenCalledTimes(1);
  });
  it("uses only configured authenticated original path for production transport", async () => {
    const f = fixture(); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.example.invalid"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key");
    const fetcher = vi.fn(f.options.readRange); vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(url).toBe(`https://synthetic.example.invalid/storage/v1/object/authenticated/genomes/${f.options.source.objectKey}`);
      expect(init).toMatchObject({ redirect: "error", cache: "no-store", headers: { Range: "bytes=0-23", "Accept-Encoding": "identity" } });
      return fetcher(f.options.source, 0, 23, init.signal as AbortSignal);
    });
    delete f.options.readRange; expect(await collect(streamPreparedOriginalDownload(f.options))).toEqual(f.raw);
  });
  it.each(["unknown", "physical-version", "expired"])("refuses %s source before I/O", async kind => {
    const f = fixture();
    if (kind === "unknown") Object.assign(f.options.source, { extra: true });
    if (kind === "physical-version") f.options.source.storageVersion = "invalid";
    if (kind === "expired") f.options.source.expiresAt = new Date(Date.now() - 1).toISOString();
    await expect(streamPreparedOriginalDownload(f.options).next()).rejects.toThrow(); expect(f.options.readRange).not.toHaveBeenCalled();
  });
});
