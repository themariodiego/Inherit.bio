import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchivePersistenceError, createArchivePersistence, type ArchiveWorkerRpc } from "./archive-persistence";
import { storeArchiveSegments, type ArchiveAttempt, type ArchiveMetadataPage,
  type ArchiveSegment, type StoredArchive } from "./archive-segments";

const EXPORT = "32000000-0000-4000-8000-000000000001";
const ATTEMPT = "32000000-0000-4000-8000-000000000002";
const OBJECT = "32000000-0000-4000-8000-000000000003";
const RECEIPT = "a".repeat(64), PRINCIPAL = "b".repeat(64), DIGEST = "c".repeat(64);
const attempt: ArchiveAttempt = { version: "archive-segments-v1", exportId: EXPORT, attemptId: ATTEMPT,
  principalHash: PRINCIPAL, bucket: "exports" };
const segment: ArchiveSegment = { ordinal: 0, offset: 0, sizeBytes: 3, sha256: DIGEST,
  objectKey: `${PRINCIPAL}/${EXPORT}/${ATTEMPT}-0.part` };
const page: ArchiveMetadataPage = { page: 0, segments: [{ ...segment, objectId: OBJECT }] };
const summary: StoredArchive = { state: "bytes-complete", attempt, authorityReceipt: RECEIPT,
  sizeBytes: 3, segmentCount: 1, pageCount: 1, sha256: DIGEST, manifestSha256: DIGEST };
type Args = Parameters<ArchiveWorkerRpc>[1];
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) };
};
function fixture() {
  const job = { exportId: EXPORT, principalHash: PRINCIPAL, authorityReceipt: RECEIPT,
    deadline: new Date(Date.now() + 600_000).toISOString() };
  const abort = new AbortController(), calls: Args[] = [], signals: AbortSignal[] = [];
  const reply = (args: Args): unknown => {
    const leaseExpiresAt = new Date(Date.now() + 300_000).toISOString();
    switch (args.p_operation) {
      case "preflight": return { authorityReceipt: RECEIPT, principalHash: PRINCIPAL, deadline: job.deadline };
      case "begin": return { attemptId: args.p_attempt_id, principalHash: PRINCIPAL, leaseExpiresAt };
      case "renew": return { authorityReceipt: RECEIPT, leaseExpiresAt };
      case "reserve": case "acknowledge": return { ordinal: args.p_payload!.ordinal, authorityReceipt: RECEIPT };
      case "page": return { page: args.p_payload!.page, authorityReceipt: RECEIPT };
      case "bytes-complete": return { state: "bytes-complete", authorityReceipt: RECEIPT,
        sizeBytes: args.p_payload!.sizeBytes, segmentCount: args.p_payload!.segmentCount, pageCount: args.p_payload!.pageCount };
    }
  };
  const respond = vi.fn(async (args: Args): Promise<{ data: unknown; error: unknown }> => ({ data: reply(args), error: null }));
  const retry = vi.fn((enabled: false) => {
    expect(enabled).toBe(false);
    return { abortSignal: (signal: AbortSignal) => { signals.push(signal); return respond(calls.at(-1)!); } };
  });
  const rpc = vi.fn<ArchiveWorkerRpc>((_name, args, options) => {
    expect(options).toEqual({ get: false, head: false }); calls.push(args); return { retry };
  });
  const bridge = createArchivePersistence(job, rpc);
  const begin = async () => { await bridge.checkAuthority(attempt, abort.signal); await bridge.beginAttempt(attempt, abort.signal); };
  return { job, abort, calls, signals, respond, reply, retry, rpc, bridge, begin };
}
afterEach(() => vi.useRealTimers());

describe("archive worker persistence boundary", () => {
  it("connects a real segmentation run to exact POST-only RPC transitions and records byte completion without ready publication", async () => {
    const f = fixture(), bytes = new Uint8Array([1, 2, 3]), hash = createHash("sha256").update(bytes).digest("hex");
    const result = await storeArchiveSegments({ ...f.bridge, ...f.bridge.job, signal: f.abort.signal,
      source: () => new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }),
      write: async () => ({ objectId: OBJECT }) });
    const complete = await f.bridge.recordBytesComplete(result, f.abort.signal);
    expect(complete).toEqual({ state: "bytes-complete", authorityReceipt: RECEIPT, sizeBytes: 3, segmentCount: 1, pageCount: 1 });
    expect(f.calls.slice(0, 3).map(c => c.p_operation)).toEqual(["preflight", "begin", "renew"]);
    expect(f.calls.filter(c => c.p_operation === "reserve")[0].p_payload).toMatchObject({ sizeBytes: 3, sha256: hash });
    expect(f.calls.at(-1)).toMatchObject({ p_operation: "bytes-complete", p_payload: {
      sizeBytes: 3, sha256: hash, segmentCount: 1, pageCount: 1, manifestSha256: result.manifestSha256 } });
    expect(f.calls.every(c => c.p_export_id === EXPORT && c.p_attempt_id === result.attempt.attemptId
      && c.p_authority_receipt === RECEIPT)).toBe(true);
    expect(f.retry).toHaveBeenCalledTimes(f.calls.length);
    const count = f.calls.length;
    await expect(f.bridge.recordBytesComplete(result, f.abort.signal)).rejects.toMatchObject({ code: "unavailable", cleanupRequired: true });
    expect(f.calls).toHaveLength(count);
  });

  it.each([
    { exportId: "not-a-uuid" }, { principalHash: "B".repeat(64) }, { authorityReceipt: "wrong" },
    { deadline: "never" }, { deadline: new Date(0).toISOString() },
    { deadline: new Date(Date.now() + 90_000_000).toISOString() }, { origin: { accountId: EXPORT } },
  ])("rejects malformed or caller-extended discovery before RPC (%j)", change => {
    const f = fixture();
    expect(() => createArchivePersistence({ ...f.job, ...change }, f.rpc)).toThrow("invalid_input");
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it.each(["authorityReceipt", "principalHash", "deadline"] as const)("refuses a changed preflight %s and never claims", async field => {
    const f = fixture();
    const changed = field === "deadline" ? new Date(Date.now() + 500_000).toISOString() : "d".repeat(64);
    f.respond.mockImplementation(async args => ({ data: { ...f.reply(args) as object, [field]: changed }, error: null }));
    await expect(f.bridge.checkAuthority(attempt, f.abort.signal)).rejects.toMatchObject({ code: "unavailable", cleanupRequired: false });
    await expect(f.bridge.beginAttempt(attempt, f.abort.signal)).rejects.toThrow("unavailable");
    expect(f.calls.map(c => c.p_operation)).toEqual(["preflight"]);
  });

  it("copies discovery so a caller cannot replace the receipt or extend its deadline", async () => {
    const f = fixture(), before = { ...f.job };
    f.job.authorityReceipt = "d".repeat(64); f.job.principalHash = "e".repeat(64);
    f.job.deadline = new Date(Date.now() + 900_000).toISOString();
    f.respond.mockResolvedValue({ data: { authorityReceipt: before.authorityReceipt, principalHash: before.principalHash,
      deadline: before.deadline }, error: null });
    expect(await f.bridge.checkAuthority(attempt, f.abort.signal)).toBe(RECEIPT);
    expect(f.bridge.job.deadline).toBe(Date.parse(before.deadline));
    expect(Object.isFrozen(f.bridge.job)).toBe(true);
  });

  it("pins the fresh attempt across every hook and refuses another attempt without an RPC", async () => {
    const f = fixture(); await f.begin(); const count = f.calls.length;
    await expect(f.bridge.reserve({ ...attempt, attemptId: OBJECT }, segment, f.abort.signal)).rejects.toThrow("invalid_input");
    expect(f.calls).toHaveLength(count);
  });

  it.each(["reserve", "acknowledge", "appendPage", "recordBytesComplete"] as const)("cannot call %s before begin", async method => {
    const f = fixture();
    const result = method === "reserve" ? f.bridge.reserve(attempt, segment, f.abort.signal)
      : method === "acknowledge" ? f.bridge.acknowledge(attempt, page.segments[0], f.abort.signal)
      : method === "appendPage" ? f.bridge.appendPage(attempt, page, f.abort.signal)
      : f.bridge.recordBytesComplete(summary, f.abort.signal);
    await expect(result).rejects.toMatchObject({ code: "unavailable", cleanupRequired: false });
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("refuses a duplicate begin without replaying the mutation", async () => {
    const f = fixture(); await f.begin();
    await expect(f.bridge.beginAttempt(attempt, f.abort.signal)).rejects.toMatchObject({ code: "unavailable", cleanupRequired: true });
    expect(f.calls.filter(c => c.p_operation === "begin")).toHaveLength(1);
  });

  it.each(["begin", "renew", "reserve", "acknowledge", "page", "bytes-complete"] as const)("closes after a malformed %s reply, retaining cleanup responsibility", async operation => {
    const f = fixture();
    if (operation !== "begin") await f.begin();
    f.respond.mockImplementation(async args => ({ data: args.p_operation === operation
      ? { ...f.reply(args) as object, unregistered: true } : f.reply(args), error: null }));
    const running = operation === "begin" ? f.bridge.beginAttempt(attempt, f.abort.signal)
      : operation === "renew" ? f.bridge.checkAuthority(attempt, f.abort.signal)
      : operation === "reserve" ? f.bridge.reserve(attempt, segment, f.abort.signal)
      : operation === "acknowledge" ? f.bridge.acknowledge(attempt, page.segments[0], f.abort.signal)
      : operation === "page" ? f.bridge.appendPage(attempt, page, f.abort.signal)
      : f.bridge.recordBytesComplete(summary, f.abort.signal);
    await expect(running).rejects.toMatchObject({ code: "unavailable", cleanupRequired: true });
    const count = f.calls.length;
    await expect(f.bridge.checkAuthority(attempt, f.abort.signal)).rejects.toThrow("unavailable");
    expect(f.calls).toHaveLength(count);
  });

  it("stops on a revoked receipt after beginning and does not adopt regranted authority", async () => {
    const f = fixture(); await f.begin();
    f.respond.mockResolvedValue({ data: { authorityReceipt: "d".repeat(64),
      leaseExpiresAt: new Date(Date.now() + 300_000).toISOString() }, error: null });
    await expect(f.bridge.checkAuthority(attempt, f.abort.signal)).rejects.toThrow("unavailable");
    f.respond.mockImplementation(async args => ({ data: f.reply(args), error: null }));
    await expect(f.bridge.reserve(attempt, segment, f.abort.signal)).rejects.toThrow("unavailable");
    expect(f.calls.at(-1)?.p_operation).toBe("renew");
  });

  it.each([0, 301_000, 900_000])("rejects expired or deadline-extending lease replies (%i)", async delta => {
    const f = fixture();
    f.respond.mockResolvedValue({ data: { attemptId: ATTEMPT, principalHash: PRINCIPAL,
      leaseExpiresAt: new Date(Date.now() + delta).toISOString() }, error: null });
    await expect(f.bridge.beginAttempt(attempt, f.abort.signal)).rejects.toThrow("unavailable");
  });

  it("refuses a changed segment namespace or extra field before a reservation RPC", async () => {
    const f = fixture(); await f.begin(); const count = f.calls.length;
    await expect(f.bridge.reserve(attempt, { ...segment, objectKey: "another-account/object" }, f.abort.signal)).rejects.toThrow("unavailable");
    expect(f.calls).toHaveLength(count);
  });

  it.each([
    { page: 0, segments: [] }, { page: 0, segments: Array(129).fill(page.segments[0]) },
    { page: 1, segments: page.segments }, { page: 0, segments: page.segments, more: true },
  ])("refuses invalid metadata pages before RPC (%j)", async selected => {
    const f = fixture(); await f.begin(); const count = f.calls.length;
    await expect(f.bridge.appendPage(attempt, selected, f.abort.signal)).rejects.toThrow("invalid_input");
    expect(f.calls).toHaveLength(count);
  });

  it("copies and freezes the exact page and descriptors before awaiting transport", async () => {
    const f = fixture(); await f.begin(); const wait = deferred<{ data: unknown; error: null }>();
    f.respond.mockReturnValue(wait.promise);
    const mutable = { page: 0, segments: [{ ...page.segments[0] }] };
    const running = f.bridge.appendPage(attempt, mutable, f.abort.signal);
    await vi.waitFor(() => expect(f.calls.at(-1)?.p_operation).toBe("page"));
    mutable.page = 4; mutable.segments[0].objectKey = "changed";
    expect(f.calls.at(-1)!.p_payload).toEqual(page);
    expect(Object.isFrozen(f.calls.at(-1)!.p_payload)).toBe(true);
    wait.resolve({ data: { page: 0, authorityReceipt: RECEIPT }, error: null }); await running;
  });

  it.each([{ sizeBytes: 4_000_001 }, { segmentCount: 2 }, { pageCount: 2 }, { state: "ready" }])("refuses contradictory completion (%j)", async changed => {
    const f = fixture(); await f.begin(); const count = f.calls.length;
    await expect(f.bridge.recordBytesComplete({ ...summary, ...changed } as StoredArchive, f.abort.signal)).rejects.toThrow("invalid_input");
    expect(f.calls).toHaveLength(count);
  });

  it("never repeats a timed-out begin even when a late success is returned", async () => {
    vi.useFakeTimers(); const f = fixture(), wait = deferred<{ data: unknown; error: null }>();
    f.respond.mockReturnValue(wait.promise);
    const running = f.bridge.beginAttempt(attempt, f.abort.signal);
    const rejected = expect(running).rejects.toMatchObject({ code: "deadline", cleanupRequired: true });
    await vi.advanceTimersByTimeAsync(30_000); await rejected;
    expect(f.signals[0].aborted).toBe(true);
    wait.resolve({ data: f.reply(f.calls[0]), error: null }); await Promise.resolve();
    await expect(f.bridge.beginAttempt(attempt, f.abort.signal)).rejects.toThrow("unavailable");
    expect(f.calls).toHaveLength(1);
  });

  it("stops at the existing lease even if a renewal transport ignores cancellation", async () => {
    vi.useFakeTimers(); const f = fixture(); await f.begin();
    await vi.advanceTimersByTimeAsync(295_000);
    f.respond.mockReturnValue(new Promise(() => {}));
    const rejected = expect(f.bridge.checkAuthority(attempt, f.abort.signal)).rejects.toMatchObject({ code: "deadline" });
    await vi.advanceTimersByTimeAsync(5_000); await rejected;
    expect(f.signals.at(-1)?.aborted).toBe(true);
  });

  it("an already aborted signal makes no RPC and an in-flight abort prevents continuation", async () => {
    const early = fixture(); early.abort.abort();
    await expect(early.bridge.checkAuthority(attempt, early.abort.signal)).rejects.toMatchObject({ code: "aborted", cleanupRequired: false });
    expect(early.rpc).not.toHaveBeenCalled();
    const f = fixture(); f.respond.mockReturnValue(new Promise(() => {}));
    const running = f.bridge.beginAttempt(attempt, f.abort.signal);
    const rejected = expect(running).rejects.toMatchObject({ code: "aborted", cleanupRequired: true });
    await vi.waitFor(() => expect(f.calls).toHaveLength(1)); f.abort.abort(); await rejected;
    await expect(f.bridge.reserve(attempt, segment, new AbortController().signal)).rejects.toThrow("unavailable");
    expect(f.calls).toHaveLength(1);
  });

  it("overlapping hooks abort the outstanding transport instead of racing two claims", async () => {
    const f = fixture(); f.respond.mockReturnValue(new Promise(() => {}));
    const first = f.bridge.beginAttempt(attempt, f.abort.signal);
    const rejected = expect(first).rejects.toMatchObject({ code: "aborted", cleanupRequired: true });
    await vi.waitFor(() => expect(f.calls).toHaveLength(1));
    await expect(f.bridge.beginAttempt(attempt, f.abort.signal)).rejects.toThrow("unavailable"); await rejected;
    expect(f.calls).toHaveLength(1); expect(f.signals[0].aborted).toBe(true);
  });

  it("sanitizes thrown provider details and error envelopes", async () => {
    for (const thrown of [false, true]) {
      const f = fixture();
      if (thrown) f.respond.mockRejectedValue(new Error("private-session-provider-detail"));
      else f.respond.mockResolvedValue({ data: null, error: { message: "private-session-provider-detail" } });
      await expect(f.bridge.beginAttempt(attempt, f.abort.signal)).rejects.toMatchObject({ message: "unavailable", cleanupRequired: true });
      expect(f.calls).toHaveLength(1);
    }
  });

  it("keeps cleanup responsibility when an injected typed error incorrectly clears it", async () => {
    const f = fixture(); await f.begin();
    f.respond.mockRejectedValue(new ArchivePersistenceError("unavailable", false));
    await expect(f.bridge.reserve(attempt, segment, f.abort.signal)).rejects.toMatchObject({ code: "unavailable", cleanupRequired: true });
    await expect(f.bridge.checkAuthority(attempt, f.abort.signal)).rejects.toMatchObject({ cleanupRequired: true });
    expect(f.calls.map(call => call.p_operation)).toEqual(["preflight", "begin", "reserve"]);
  });

  it("uses the installed SDK's one POST with fixed RPC arguments and no retry after a transient failure", async () => {
    const f = fixture();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://archive.invalid/rest/v1/rpc/export_archive_worker_v1");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ p_operation: "begin", p_export_id: EXPORT,
        p_attempt_id: ATTEMPT, p_authority_receipt: RECEIPT, p_payload: null });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ message: "private-provider-detail" }), { status: 503 });
    });
    const client = createClient("https://archive.invalid", "synthetic-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetcher } });
    const bridge = createArchivePersistence(f.job, client.rpc.bind(client));
    await expect(bridge.beginAttempt(attempt, f.abort.signal)).rejects.toMatchObject({ code: "unavailable", cleanupRequired: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
