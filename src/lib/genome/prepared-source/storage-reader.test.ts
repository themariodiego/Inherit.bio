import { afterEach, describe, expect, it, vi } from "vitest";
import { encodePreparedBlock } from "./codec";
import { createPreparedContainerPacker, type PreparedContainerDescriptor } from "./containers";
import { syntheticSource } from "./fixtures";
import { createPreparedRangeFetch, readPreparedStorageBlock, type PreparedRangeFetch } from "./storage-reader";

const key = "prepared/33333333-3333-4333-8333-333333333333";
async function fixture() {
  let container!: PreparedContainerDescriptor, bytes!: Uint8Array;
  const packer = createPreparedContainerPacker({ source: syntheticSource, sink: async value => {
    container = value.descriptor; bytes = Uint8Array.from(value.bytes); return value.descriptor;
  } });
  const events = [10, 20].map(pos => ({ type: "variant" as const, line: pos,
    record: { chrom: 1, pos, rsid: pos, ref: "A", alt: "C", genotype: "A/C" } }));
  for (let sequence = 0; sequence < 2; sequence++) await packer.append(await encodePreparedBlock({
    source: syntheticSource, sequence, events: [events[sequence]],
  }));
  await packer.finish();
  const selection = { objectKey: key, container, blockSequence: 1 };
  const block = container.blocks[1];
  const slice = Uint8Array.from(bytes.subarray(block.offset, block.offset + block.length));
  const response = (body: Uint8Array = slice, extra: HeadersInit = {}) => new Response(body as BodyInit, {
    status: 206, headers: { "content-range": `bytes ${block.offset}-${block.offset + block.length - 1}/${container.byteCount}`,
      "content-length": String(block.length), ...extra },
  });
  return { selection, block, slice, response, events };
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("authorized bounded prepared-object reads", () => {
  it("reads only the selected interior block, validates it, then rechecks authority", async () => {
    const f = await fixture(), order: string[] = [];
    const check = vi.fn(async () => { order.push("check"); });
    const fetchRange: PreparedRangeFetch = vi.fn(async request => {
      order.push("read");
      expect(request).toMatchObject({ objectKey: key, start: f.block.offset,
        end: f.block.offset + f.block.length - 1 });
      expect(request.signal.aborted).toBe(false); return f.response();
    });
    const result = await readPreparedStorageBlock(f.selection, { check, fetchRange });
    expect(result.events).toEqual([f.events[1]]);
    expect(order).toEqual(["check", "read", "check"]);
    expect(fetchRange).toHaveBeenCalledTimes(1);
  });
  it.each(["before", "after"])("releases no events when exact-source authority fails %s the provider read", async when => {
    const f = await fixture(); let calls = 0;
    const check = vi.fn(async () => { if (++calls === (when === "before" ? 1 : 2)) throw new Error("private authority detail"); });
    const fetchRange = vi.fn(async () => f.response());
    await expect(readPreparedStorageBlock(f.selection, { check, fetchRange })).rejects.toMatchObject({
      code: "unavailable", message: "unavailable",
    });
    expect(fetchRange).toHaveBeenCalledTimes(when === "before" ? 0 : 1);
  });
  it.each(["missing block", "path injection", "raw original key", "changed offsets", "changed source"])("refuses %s before I/O", async fault => {
    const f = await fixture();
    if (fault === "missing block") f.selection.blockSequence = 5;
    if (fault === "path injection") f.selection.objectKey = "../other?key=secret";
    if (fault === "raw original key") f.selection.objectKey = key.slice("prepared/".length);
    if (fault === "changed offsets") f.selection.container.blocks[1].offset++;
    if (fault === "changed source") f.selection.container.source.sourceRevision++;
    const check = vi.fn(async () => {}), fetchRange = vi.fn(async () => f.response());
    await expect(readPreparedStorageBlock(f.selection, { check, fetchRange })).rejects.toMatchObject({ code: "invalid_selection" });
    expect(check).not.toHaveBeenCalled(); expect(fetchRange).not.toHaveBeenCalled();
  });
  it.each(["full body", "wrong total", "wrong length", "encoded body", "short body", "long body", "wrong hash"])(
    "does not accept %s as a valid block", async fault => {
      const f = await fixture();
      const check = vi.fn(async () => {});
      const fetchRange = vi.fn(async () => {
        if (fault === "full body") return new Response(f.slice as BodyInit);
        if (fault === "wrong total") return f.response(f.slice, { "content-range": `bytes ${f.block.offset}-${f.block.offset + f.block.length - 1}/999` });
        if (fault === "wrong length") return f.response(f.slice, { "content-length": "999" });
        if (fault === "encoded body") return f.response(f.slice, { "content-encoding": "gzip" });
        if (fault === "short body") return f.response(f.slice.subarray(1));
        if (fault === "long body") return f.response(new Uint8Array(f.slice.length + 1));
        const corrupt = Uint8Array.from(f.slice); corrupt[12] ^= 1; return f.response(corrupt);
      });
      await expect(readPreparedStorageBlock(f.selection, { check, fetchRange })).rejects.toBeDefined();
      expect(check).toHaveBeenCalledTimes(1);
    });
  it("does not trust a complete expected byte count until actual stream EOF", async () => {
    const f = await fixture(); let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      if (++pulls === 1) controller.enqueue(f.slice);
      else controller.error(new Error("late provider failure with sensitive path"));
    } });
    const check = vi.fn(async () => {});
    await expect(readPreparedStorageBlock(f.selection, { check, fetchRange: async () => new Response(stream, {
      status: 206, headers: f.response().headers,
    }) })).rejects.toMatchObject({ code: "unavailable", message: "unavailable" });
    expect(check).toHaveBeenCalledTimes(1);
  });
  it("accepts bounded streaming bodies without a content-length header", async () => {
    const f = await fixture(); const response = f.response(); response.headers.delete("content-length");
    expect((await readPreparedStorageBlock(f.selection, { check: async () => {}, fetchRange: async () => response })).events)
      .toEqual([f.events[1]]);
  });
  it("cancels a stalled body on external abort and never performs a final authority check", async () => {
    const f = await fixture(), controller = new AbortController(), cancel = vi.fn();
    let started!: () => void; const bodyStarted = new Promise<void>(resolve => { started = resolve; });
    // Prevent stream construction from eagerly pulling before the adapter has
    // actually received the response and attached its cancellation handler.
    const stream = new ReadableStream<Uint8Array>({ pull() { started(); }, cancel }, { highWaterMark: 0 });
    const check = vi.fn(async () => {});
    const operation = readPreparedStorageBlock(f.selection, { check, signal: controller.signal,
      fetchRange: async () => new Response(stream, { status: 206, headers: f.response().headers }) });
    const rejected = expect(operation).rejects.toMatchObject({ code: "aborted" });
    await bodyStarted; controller.abort(); await rejected;
    expect(cancel).toHaveBeenCalledTimes(1); expect(check).toHaveBeenCalledTimes(1);
  });
  it("cancels a provider body arriving after the operation was aborted", async () => {
    const f = await fixture(), controller = new AbortController(), cancel = vi.fn();
    let finish!: (value: Response) => void, started!: () => void;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    const fetched = new Promise<void>(resolve => { started = resolve; });
    const operation = readPreparedStorageBlock(f.selection, { check: async () => {}, signal: controller.signal,
      fetchRange: () => { started(); return pending; } });
    const rejected = expect(operation).rejects.toMatchObject({ code: "aborted" });
    await fetched; controller.abort(); await rejected;
    finish(new Response(new ReadableStream({ cancel }), { status: 206 }));
    await Promise.resolve(); expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("stops waiting for a non-cooperative authority check at the deadline", async () => {
    const f = await fixture(); vi.useFakeTimers();
    const fetchRange = vi.fn(async () => f.response());
    const operation = readPreparedStorageBlock(f.selection, { check: () => new Promise(() => {}), fetchRange });
    const rejected = expect(operation).rejects.toMatchObject({ code: "aborted" });
    await vi.advanceTimersByTimeAsync(30_000); await rejected; expect(fetchRange).not.toHaveBeenCalled();
  });
  it("owns a resolved response when cancellation beats its await continuation", async () => {
    const f = await fixture(), controller = new AbortController(), cancel = vi.fn();
    let finish!: (value: Response) => void, started!: () => void;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    const fetched = new Promise<void>(resolve => { started = resolve; });
    const check = vi.fn(async () => {});
    const operation = readPreparedStorageBlock(f.selection, { check, signal: controller.signal,
      fetchRange: () => { started(); return pending; } });
    const rejected = expect(operation).rejects.toMatchObject({ code: "aborted" });
    await fetched;
    finish(new Response(new ReadableStream({ cancel }), { status: 206, headers: f.response().headers }));
    queueMicrotask(() => controller.abort());
    await rejected;
    expect(cancel).toHaveBeenCalledTimes(1); expect(check).toHaveBeenCalledTimes(1);
  });
  it("sanitizes a provider exception", async () => {
    const f = await fixture();
    await expect(readPreparedStorageBlock(f.selection, { check: async () => {}, fetchRange: async () => {
      throw new Error("credential and object key");
    } })).rejects.toMatchObject({ message: "unavailable", code: "unavailable" });
  });
});

describe("server-configured private Storage transport", () => {
  it("sends only an authenticated exact range with redirects and caches disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.invalid");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-placeholder");
    const provider = vi.fn(async () => new Response()); vi.stubGlobal("fetch", provider);
    const signal = new AbortController().signal;
    await createPreparedRangeFetch()({ objectKey: key, start: 5, end: 8, signal });
    expect(provider).toHaveBeenCalledExactlyOnceWith(`https://synthetic.invalid/storage/v1/object/authenticated/genomes/${key}`, {
      headers: { Authorization: "Bearer synthetic-placeholder", Range: "bytes=5-8", "Accept-Encoding": "identity" },
      cache: "no-store", redirect: "error", signal,
    });
  });
  it.each(["https://synthetic.invalid/path", "https://synthetic.invalid/?key=secret",
    "https://user:password@synthetic.invalid",
    "http://synthetic.invalid", "http://localhost:12345", "http://127.0.0.1.synthetic.invalid:54321"])(
    "refuses unexpected origin configuration", configured => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", configured); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-placeholder");
      expect(() => createPreparedRangeFetch()).toThrow("unavailable");
    });
  it.each(["http://127.0.0.1:54321", "http://127.0.0.1:55321"])("allows an explicit local Supabase origin", origin => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-placeholder");
    expect(createPreparedRangeFetch()).toBeTypeOf("function");
  });
});
