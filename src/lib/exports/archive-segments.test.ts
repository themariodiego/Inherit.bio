import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARCHIVE_SEGMENT_BYTES as SIZE, ArchiveManifestPages, ArchiveSegmentationError, archiveSegmentCoordinates,
  storeArchiveSegments, type ArchiveAttempt, type ArchiveSegmentationOptions,
  type StoredArchiveSegment } from "./archive-segments";
import { createSupabaseArchiveWriter } from "./archive-segment-storage";

const EXPORT = "32000000-0000-4000-8000-000000000001";
const OBJECT = "32000000-0000-4000-8000-000000000002";
const ATTEMPT: ArchiveAttempt = { version: "archive-segments-v1", exportId: EXPORT, principalHash: "a".repeat(64), attemptId: OBJECT, bucket: "exports" };
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function fixture(chunks: Uint8Array[] = [new Uint8Array([1, 2, 3])]) {
  const abort = new AbortController(), events: string[] = [], writes: Uint8Array[] = [];
  let index = 0;
  const cancel = vi.fn();
  const source = vi.fn(() => new ReadableStream<Uint8Array>({
    pull(controller) { events.push("read"); if (index === chunks.length) controller.close(); else controller.enqueue(chunks[index++]); },
    cancel,
  }, { highWaterMark: 0 }));
  const options: ArchiveSegmentationOptions = {
    exportId: EXPORT, principalHash: "a".repeat(64), authorityReceipt: "f".repeat(64), deadline: Date.now() + 120_000, signal: abort.signal,
    checkAuthority: vi.fn(async () => { events.push("authority"); return "f".repeat(64); }),
    beginAttempt: vi.fn(async () => { events.push("begin"); }), source,
    reserve: vi.fn(async () => { events.push("reserve"); }),
    write: vi.fn(async (_attempt, _segment, bytes) => { events.push("write"); writes.push(bytes.slice()); return { objectId: OBJECT }; }),
    acknowledge: vi.fn(async () => { events.push("ack"); }),
    appendPage: vi.fn(async () => { events.push("page"); }),
  };
  return { options, abort, events, writes, source, cancel };
}
afterEach(() => vi.useRealTimers());

describe("immutable logical archive segmentation", () => {
  it("reassembles exact bytes across arbitrary input splits, hashes every object and total, and records ordered pages", async () => {
    const a = new Uint8Array(SIZE - 2).fill(11), b = new Uint8Array([12, 13, 14, 15, 16]);
    const f = fixture([a, b]);
    const result = await storeArchiveSegments(f.options);
    const expected = Buffer.concat([a, b]);
    expect(Buffer.concat(f.writes).equals(expected)).toBe(true);
    expect(f.writes.map(value => value.length)).toEqual([SIZE, 3]);
    expect(result).toMatchObject({ state: "bytes-complete", sizeBytes: SIZE + 3, sha256: hash(expected), segmentCount: 2, pageCount: 1 });
    const page = vi.mocked(f.options.appendPage).mock.calls[0][1];
    expect(page.segments.map(({ ordinal, offset, sizeBytes, sha256 }) => ({ ordinal, offset, sizeBytes, sha256 }))).toEqual([
      { ordinal: 0, offset: 0, sizeBytes: SIZE, sha256: hash(f.writes[0]) },
      { ordinal: 1, offset: SIZE, sizeBytes: 3, sha256: hash(f.writes[1]) },
    ]);
    const serialized = page.segments.map(s => JSON.stringify([s.ordinal, s.offset, s.sizeBytes, s.sha256, s.objectKey, s.objectId]) + "\n").join("");
    expect(result.manifestSha256).toBe(hash(Buffer.from(serialized)));
    expect(Object.isFrozen(page)).toBe(true); expect(Object.isFrozen(page.segments)).toBe(true);
    expect(f.events.slice(0, 5)).toEqual(["authority", "begin", "authority", "authority", "read"]);
    for (const event of ["reserve", "write", "ack", "page"]) {
      for (let i = 0; i < f.events.length; i++) if (f.events[i] === event) {
        expect(f.events[i - 1]).toBe("authority"); expect(f.events[i + 1]).toBe("authority");
      }
    }
    expect(f.events.at(-1)).toBe("authority");
  });

  it("does not read ahead across a pending object write or create a spurious empty tail", async () => {
    const f = fixture([new Uint8Array(SIZE), new Uint8Array([9])]), pending = deferred<{ objectId: string }>();
    f.options.write = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ objectId: OBJECT });
    const running = storeArchiveSegments(f.options);
    await vi.waitFor(() => expect(f.options.write).toHaveBeenCalledTimes(1));
    expect(f.events.filter(value => value === "read")).toHaveLength(1);
    expect(f.options.acknowledge).not.toHaveBeenCalled();
    pending.resolve({ objectId: OBJECT }); await running;
    const exact = fixture([new Uint8Array(SIZE)]);
    expect((await storeArchiveSegments(exact.options)).segmentCount).toBe(1);
    expect(exact.options.write).toHaveBeenCalledTimes(1);
  });

  it("uses a new attempt namespace every time and never adopts an existing claim", async () => {
    const a = fixture(), b = fixture();
    const first = await storeArchiveSegments(a.options), second = await storeArchiveSegments(b.options);
    expect(first.attempt.attemptId).not.toBe(second.attempt.attemptId);
    const c = fixture(); c.options.beginAttempt = vi.fn().mockRejectedValue(new Error("already claimed"));
    await expect(storeArchiveSegments(c.options)).rejects.toMatchObject({ code: "metadata", cleanupRequired: true });
    expect(c.source).not.toHaveBeenCalled(); expect(c.options.write).not.toHaveBeenCalled();
  });

  it.each(["reserve", "acknowledge", "appendPage"] as const)("retains cleanup inventory and refuses completion after %s failure", async name => {
    const f = fixture(); f.options[name] = vi.fn().mockRejectedValue(new Error("private details"));
    await expect(storeArchiveSegments(f.options)).rejects.toMatchObject({ message: "metadata", cleanupRequired: true });
    if (name === "reserve") expect(f.options.write).not.toHaveBeenCalled();
    if (name !== "appendPage") expect(f.options.appendPage).not.toHaveBeenCalled();
  });

  it("refuses before acquiring a source on lost authority, and after an ACK before metadata commit", async () => {
    const early = fixture(); early.options.checkAuthority = vi.fn().mockRejectedValue(new Error("revoked"));
    await expect(storeArchiveSegments(early.options)).rejects.toMatchObject({ code: "authority", cleanupRequired: false });
    expect(early.source).not.toHaveBeenCalled(); expect(early.options.beginAttempt).not.toHaveBeenCalled();
    const late = fixture(); let revoked = false;
    late.options.checkAuthority = vi.fn(async () => { if (revoked) throw new Error("revoked"); return "f".repeat(64); });
    late.options.write = vi.fn(async () => { revoked = true; return { objectId: OBJECT }; });
    await expect(storeArchiveSegments(late.options)).rejects.toMatchObject({ code: "authority", cleanupRequired: true });
    expect(late.options.reserve).toHaveBeenCalledOnce(); expect(late.options.acknowledge).not.toHaveBeenCalled();
  });

  it("stops before object write when authority changes after reservation and keeps the reservation for cleanup", async () => {
    const f = fixture(); let revoked = false;
    f.options.reserve = vi.fn(async () => { revoked = true; });
    f.options.checkAuthority = vi.fn(async () => { if (revoked) throw new ArchiveSegmentationError("authority"); return "f".repeat(64); });
    await expect(storeArchiveSegments(f.options)).rejects.toMatchObject({ code: "authority", cleanupRequired: true });
    expect(f.options.write).not.toHaveBeenCalled(); expect(f.options.appendPage).not.toHaveBeenCalled();
  });

  it("does not turn producer failure after a stored full segment into successful EOF", async () => {
    const f = fixture(); let reads = 0;
    f.options.source = () => new ReadableStream({ pull(controller) {
      if (reads++ === 0) controller.enqueue(new Uint8Array(SIZE)); else controller.error(new Error("private filename"));
    } }, { highWaterMark: 0 });
    await expect(storeArchiveSegments(f.options)).rejects.toMatchObject({ code: "invalid_source", message: "invalid_source", cleanupRequired: true });
    expect(f.options.write).toHaveBeenCalledOnce(); expect(f.options.acknowledge).toHaveBeenCalledOnce();
    expect(f.options.appendPage).not.toHaveBeenCalled();
  });

  it("requires final authority after the last metadata page, without representing that page as ready", async () => {
    const f = fixture(); let revoked = false;
    f.options.appendPage = vi.fn(async () => { revoked = true; });
    f.options.checkAuthority = vi.fn(async () => { if (revoked) throw new Error("revoked"); return "f".repeat(64); });
    await expect(storeArchiveSegments(f.options)).rejects.toMatchObject({ code: "authority", cleanupRequired: true });
    expect(f.options.acknowledge).toHaveBeenCalledOnce(); expect(f.options.appendPage).toHaveBeenCalledOnce();
  });

  it("pins the authorized job receipt from the first check and refuses a regrant or source change", async () => {
    const f = fixture(); let receipt = "f".repeat(64);
    f.options.checkAuthority = vi.fn(async () => receipt);
    f.options.reserve = vi.fn(async () => { receipt = "e".repeat(64); });
    await expect(storeArchiveSegments(f.options)).rejects.toMatchObject({ code: "authority", cleanupRequired: true });
    expect(f.options.write).not.toHaveBeenCalled();
    const invalid = fixture(); invalid.options.checkAuthority = vi.fn().mockResolvedValue("not-a-bound-receipt");
    await expect(storeArchiveSegments(invalid.options)).rejects.toMatchObject({ code: "authority", cleanupRequired: false });
    expect(invalid.options.beginAttempt).not.toHaveBeenCalled();
    const changed = fixture(); changed.options.checkAuthority = vi.fn().mockResolvedValue("e".repeat(64));
    await expect(storeArchiveSegments(changed.options)).rejects.toMatchObject({ code: "authority", cleanupRequired: false });
    expect(changed.options.beginAttempt).not.toHaveBeenCalled(); expect(changed.source).not.toHaveBeenCalled();
    const valid = fixture(); expect((await storeArchiveSegments(valid.options)).authorityReceipt).toBe("f".repeat(64));
  });

  it("never loses cleanup responsibility through a typed hook error after a write", async () => {
    const f = fixture(); f.options.acknowledge = vi.fn().mockRejectedValue(new ArchiveSegmentationError("metadata"));
    await expect(storeArchiveSegments(f.options)).rejects.toMatchObject({ code: "metadata", cleanupRequired: true });
    expect(f.options.write).toHaveBeenCalledOnce();
    const early = fixture(); early.options.checkAuthority = vi.fn().mockRejectedValue(new ArchiveSegmentationError("authority"));
    await expect(storeArchiveSegments(early.options)).rejects.toMatchObject({ code: "authority", cleanupRequired: false });
  });

  it.each([{ chunks: [] }, { chunks: [new Uint8Array()] }, { chunks: [new Uint8Array(SIZE + 1)] }])("rejects empty or oversized producer chunks without publishing completion", async ({ chunks }) => {
    const f = fixture(chunks);
    await expect(storeArchiveSegments(f.options)).rejects.toMatchObject({ code: "invalid_source" });
    expect(f.options.appendPage).not.toHaveBeenCalled(); expect(f.options.write).not.toHaveBeenCalled();
  });

  it("does not accept corrupt write bytes or a malformed provider identity", async () => {
    for (const corrupt of [true, false]) {
      const f = fixture();
      f.options.write = vi.fn(async (_a, _s, bytes) => { if (corrupt) bytes[0] ^= 1; return { objectId: corrupt ? OBJECT : "unknown" }; });
      await expect(storeArchiveSegments(f.options)).rejects.toMatchObject({ code: "storage", cleanupRequired: true });
      expect(f.options.acknowledge).not.toHaveBeenCalled();
    }
  });

  it("closes the fence on a non-cooperative write timeout; late ACK cannot resume", async () => {
    vi.useFakeTimers(); const f = fixture(), pending = deferred<{ objectId: string }>();
    f.options.write = vi.fn(() => pending.promise);
    const running = storeArchiveSegments(f.options);
    const rejected = expect(running).rejects.toMatchObject({ code: "deadline", cleanupRequired: true });
    await vi.advanceTimersByTimeAsync(30_001); await rejected;
    expect(f.options.write).toHaveBeenCalledOnce(); expect(f.options.reserve).toHaveBeenCalledOnce();
    pending.resolve({ objectId: OBJECT }); await Promise.resolve();
    expect(f.options.acknowledge).not.toHaveBeenCalled(); expect(f.options.appendPage).not.toHaveBeenCalled();
  });

  it("bounds a stalled read and does not await an uncooperative cancel", async () => {
    vi.useFakeTimers(); const f = fixture(); const cancel = vi.fn(() => new Promise<void>(() => {}));
    f.options.source = () => new ReadableStream({ pull: () => new Promise<void>(() => {}), cancel }, { highWaterMark: 0 });
    const running = storeArchiveSegments(f.options), rejected = expect(running).rejects.toMatchObject({ code: "deadline" });
    await vi.advanceTimersByTimeAsync(30_001); await rejected;
    expect(cancel).toHaveBeenCalledOnce(); expect(f.options.write).not.toHaveBeenCalled();
  });

  it("honors caller cancellation and overall lease deadline without further mutations", async () => {
    vi.useFakeTimers();
    for (const external of [true, false]) {
      const f = fixture(), pending = deferred<{ objectId: string }>(); f.options.write = vi.fn(() => pending.promise);
      f.options.deadline = Date.now() + 1000;
      const running = storeArchiveSegments(f.options), rejected = expect(running).rejects.toMatchObject({ code: external ? "aborted" : "deadline" });
      await vi.advanceTimersByTimeAsync(1); if (external) f.abort.abort(); else await vi.advanceTimersByTimeAsync(1000);
      await rejected; pending.resolve({ objectId: OBJECT }); await Promise.resolve();
      expect(f.options.acknowledge).not.toHaveBeenCalled();
    }
  });
});

describe("paged manifest accounting (virtual descriptors, not a 4 GiB archive run)", () => {
  const descriptor = (ordinal: number, length = SIZE): StoredArchiveSegment => ({ ...archiveSegmentCoordinates(ordinal, length),
    sha256: "b".repeat(64), objectKey: `${"a".repeat(64)}/${EXPORT}/${OBJECT}-${ordinal}.part`, objectId: OBJECT });
  it("crosses 2^32 without wraparound, flushes bounded pages, preserves order and tail size", async () => {
    const pages: number[][] = []; const manifest = new ArchiveManifestPages(ATTEMPT, async page => {
      expect(page.segments.length).toBeLessThanOrEqual(128); expect(page.page).toBe(pages.length);
      pages.push(page.segments.map(segment => segment.ordinal));
    });
    for (let i = 0; i < 1074; i++) await manifest.push(descriptor(i));
    await manifest.push(descriptor(1074, 17));
    const result = await manifest.finish();
    expect(result).toMatchObject({ sizeBytes: 4_296_000_017, segmentCount: 1075, pageCount: 9 });
    expect(pages.flat()).toEqual(Array.from({ length: 1075 }, (_, i) => i));
    expect(archiveSegmentCoordinates(1074, 17)).toEqual({ ordinal: 1074, offset: 4_296_000_000, sizeBytes: 17 });
    await expect(manifest.push(descriptor(1075))).rejects.toMatchObject({ code: "metadata" });
    await expect(manifest.finish()).rejects.toMatchObject({ code: "metadata" });
  });
  it("rejects gaps, wrong offsets, data after a tail and unsafe integer extents", async () => {
    for (const bad of [{ ...descriptor(0), offset: 1 }, descriptor(1)]) {
      const manifest = new ArchiveManifestPages(ATTEMPT, async () => {});
      await expect(manifest.push(bad)).rejects.toMatchObject({ code: bad.offset === 1 ? "invalid_input" : "metadata" });
      await expect(manifest.push(descriptor(0))).rejects.toMatchObject({ code: "metadata" });
    }
    const tail = new ArchiveManifestPages(ATTEMPT, async () => {}); await tail.push(descriptor(0, 1));
    await expect(tail.push(descriptor(1))).rejects.toMatchObject({ code: "metadata" });
    expect(() => archiveSegmentCoordinates(Number.MAX_SAFE_INTEGER, 1)).toThrow("invalid_input");
    expect(() => archiveSegmentCoordinates(-1, 1)).toThrow("invalid_input");
    expect(() => archiveSegmentCoordinates(0, SIZE + 1)).toThrow("invalid_input");
  });
});

describe("actual Supabase SDK whole-object transport with injected fetch only", () => {
  const origin = "https://example.supabase.co", key = "synthetic-key-never-log";
  function sdkFixture(response: (url: string, init: RequestInit) => Promise<Response>) {
    const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => response(String(input), init!));
    const f = fixture(); f.options.write = createSupabaseArchiveWriter({ origin, serviceRoleKey: key, fetch: transport });
    return { ...f, transport };
  }
  const success = async (url: string) => new Response(JSON.stringify({ Id: OBJECT, Key: url.split("/object/")[1] }), { status: 200 });
  it("makes exactly one POST per reservation with immutable raw body and strict origin/path, no multipart or redirects", async () => {
    const f = sdkFixture(async (url, init) => {
      expect(url.startsWith(`${origin}/storage/v1/object/exports/${"a".repeat(64)}/${EXPORT}/`)).toBe(true);
      expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
      const headers = new Headers(init.headers);
      expect(headers.get("x-upsert")).toBe("false"); expect(headers.get("content-type")).toBe("application/octet-stream");
      expect(init.body).toBeInstanceOf(Uint8Array); expect(init.body).not.toBeInstanceOf(FormData);
      return success(url);
    });
    await storeArchiveSegments(f.options); expect(f.transport).toHaveBeenCalledOnce();
    expect(f.options.acknowledge).toHaveBeenCalledOnce();
  });
  it.each([409, 500, 307, 201, 204])("does not retry or ACK HTTP %s", async status => {
    const f = sdkFixture(async () => new Response(status === 204 ? null : key, { status, headers: { location: "https://elsewhere.test" } }));
    await expect(storeArchiveSegments(f.options)).rejects.toMatchObject({ message: "storage", cleanupRequired: true });
    expect(f.transport).toHaveBeenCalledOnce(); expect(f.options.acknowledge).not.toHaveBeenCalled();
  });
  it.each(["wrong-key", "oversized", "invalid-json", "extra-field", "empty-chunk"])("refuses uncertain %s acknowledgement", async kind => {
    const f = sdkFixture(async url => {
      if (kind === "oversized") return new Response("x".repeat(8193));
      if (kind === "invalid-json") return new Response("{");
      if (kind === "empty-chunk") return new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array()); } }));
      return new Response(JSON.stringify({ Id: OBJECT, Key: kind === "wrong-key" ? "exports/wrong" : url.split("/object/")[1],
        ...(kind === "extra-field" ? { extra: true } : {}) }));
    });
    await expect(storeArchiveSegments(f.options)).rejects.toMatchObject({ code: "storage" });
    expect(f.options.acknowledge).not.toHaveBeenCalled(); expect(f.transport).toHaveBeenCalledOnce();
  });
  it("detaches a stalled response body and never logs provider errors or credentials", async () => {
    vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}));
    const f = sdkFixture(async () => new Response(new ReadableStream({ pull: () => new Promise<void>(() => {}), cancel })));
    const result = storeArchiveSegments(f.options), rejected = expect(result).rejects.toMatchObject({ message: "deadline" });
    await vi.advanceTimersByTimeAsync(30_001); await rejected;
    expect(cancel).toHaveBeenCalled(); expect(f.options.acknowledge).not.toHaveBeenCalled();
  });
  it("refuses caller path drift before any network attempt", async () => {
    const transport = vi.fn(); const writer = createSupabaseArchiveWriter({ origin, serviceRoleKey: key, fetch: transport });
    const attempt: ArchiveAttempt = { version: "archive-segments-v1", exportId: EXPORT, principalHash: "a".repeat(64), attemptId: OBJECT, bucket: "exports" };
    await expect(writer(attempt, { ordinal: 0, offset: 0, sizeBytes: 1, sha256: hash(new Uint8Array([1])), objectKey: "../genomes/original" }, new Uint8Array([1]), new AbortController().signal)).rejects.toMatchObject({ code: "invalid_input" });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(["version", "attempt-id", "export-id", "offset", "ordinal", "extra", "hidden-extra", "symbol-extra", "accessor"])("refuses malformed %s before POST", async kind => {
    const transport = vi.fn(); const writer = createSupabaseArchiveWriter({ origin, serviceRoleKey: key, fetch: transport });
    const attempt = { ...ATTEMPT }, segment = { ordinal: 0, offset: 0, sizeBytes: 1, sha256: hash(new Uint8Array([1])),
      objectKey: `${ATTEMPT.principalHash}/${EXPORT}/${OBJECT}-0.part` };
    if (kind === "version") Object.assign(attempt, { version: "other" });
    if (kind === "attempt-id") attempt.attemptId = "-".repeat(36);
    if (kind === "export-id") attempt.exportId = "-".repeat(36);
    if (kind === "offset") segment.offset = 1;
    if (kind === "ordinal") segment.ordinal = 0.5;
    if (kind === "extra") Object.assign(segment, { extra: true });
    if (kind === "hidden-extra") Object.defineProperty(segment, "extra", { value: true });
    if (kind === "symbol-extra") Object.assign(segment, { [Symbol("extra")]: true });
    const getter = vi.fn(() => 0);
    if (kind === "accessor") Object.defineProperty(segment, "offset", { get: getter, enumerable: true });
    await expect(writer(attempt, segment, new Uint8Array([1]), new AbortController().signal)).rejects.toMatchObject({ code: "invalid_input" });
    expect(transport).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled();
  });

  it("cancels a late HTTP response after timeout without accepting its ACK or retrying", async () => {
    vi.useFakeTimers(); const pending = deferred<Response>(), cancel = vi.fn();
    const f = sdkFixture(() => pending.promise);
    const running = storeArchiveSegments(f.options), rejected = expect(running).rejects.toMatchObject({ code: "deadline", cleanupRequired: true });
    await vi.advanceTimersByTimeAsync(30_001); await rejected;
    pending.resolve(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(1);
    expect(cancel).toHaveBeenCalled(); expect(f.transport).toHaveBeenCalledOnce(); expect(f.options.acknowledge).not.toHaveBeenCalled();
  });
});
