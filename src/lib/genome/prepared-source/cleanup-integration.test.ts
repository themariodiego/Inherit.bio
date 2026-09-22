import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createAdminClient } from "../../supabase/admin";
import { prepareAccountCleanup, prepareFileCleanup, drainPreparedScratch } from "./cleanup-integration";
import { drainOwnPreparedCleanup } from "./cleanup";
vi.mock("./cleanup", () => ({ drainOwnPreparedCleanup: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const original = { token: id, bucket: "genomes", name: "exact-original" };
const complete = { version: "own-prepared-file-cleanup-v1", original, cleanupId: null, preparedComplete: true };
const pending = { ...complete, cleanupId: id, preparedComplete: false };
const account = { version: "own-prepared-account-cleanup-v1", cleanupIds: [id], preparedComplete: false };
function fixture(...values: unknown[]) {
  const rpc = vi.fn(() => {
    const data = values.shift();
    return { abortSignal: async (signal: AbortSignal) => { signal.throwIfAborted(); return { data, error: null }; } };
  });
  return { rpc, admin: { rpc } as unknown as ReturnType<typeof createAdminClient> };
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(drainOwnPreparedCleanup).mockResolvedValue({ processed: 1, completed: true, pending: false, failed: false, unresolved: false }); });
afterEach(() => { vi.useRealTimers(); });
describe("prepared cleanup integration", () => {
  it("uses wrapped SQL even for legacy files and never contacts the prepared provider", async () => {
    const f = fixture(complete); expect(await prepareFileCleanup(f.admin, {})).toEqual({ error: null, original, complete: true });
    expect(f.rpc).toHaveBeenCalledWith("prepare_own_prepared_file_cleanup_v1", {}); expect(drainOwnPreparedCleanup).not.toHaveBeenCalled();
  });
  it("prepares a claimed stranded record through the claimed SQL twin and reconfirms through the same one", async () => {
    const args = { p_file_id: id, p_claim_token_hash: "c".repeat(64) };
    const f = fixture(pending, complete);
    expect(await prepareFileCleanup(f.admin, args, undefined, "prepare_own_prepared_file_cleanup_claimed_v1")).toEqual({ error: null, original, complete: true });
    expect(f.rpc.mock.calls).toEqual([["prepare_own_prepared_file_cleanup_claimed_v1", args], ["prepare_own_prepared_file_cleanup_claimed_v1", args]]);
    expect(drainOwnPreparedCleanup).toHaveBeenCalledTimes(1);
  });
  it("only current SQL confirmation lets a drained file advance to original deletion", async () => {
    const f = fixture(pending, complete); expect(await prepareFileCleanup(f.admin, {})).toMatchObject({ complete: true }); expect(f.rpc).toHaveBeenCalledTimes(2);
  });
  it("scratch-only completion leaves the broader file disposition pending", async () => {
    const f = fixture(pending, pending); expect(await prepareFileCleanup(f.admin, {})).toMatchObject({ complete: false }); expect(drainOwnPreparedCleanup).toHaveBeenCalledTimes(1);
  });
  it("refuses changed original identity on the terminal SQL read", async () => {
    const f = fixture(pending, { ...complete, original: { ...original, name: "other-source" } });
    await expect(prepareFileCleanup(f.admin, {})).rejects.toThrow("file_delete_failed");
  });
  it.each([{ ...complete, cleanupId: id }, { ...pending, cleanupId: null }, { ...complete, extra: true }])("refuses inconsistent or open file plans", async raw => {
    await expect(prepareFileCleanup(fixture(raw).admin, {})).rejects.toThrow(); expect(drainOwnPreparedCleanup).not.toHaveBeenCalled();
  });
  it("account cleanup drains one bounded page and rereads current authority before original deletion", async () => {
    const f = fixture(account, { ...account, cleanupIds: [], preparedComplete: true });
    expect(await prepareAccountCleanup(f.admin, id, "a".repeat(64), new AbortController().signal)).toBe(true);
    expect(drainOwnPreparedCleanup).toHaveBeenCalledTimes(1); expect(f.rpc).toHaveBeenCalledTimes(2);
  });
  it("never interprets a completed first account job as completion of the whole account", async () => {
    const f = fixture(account, account); expect(await prepareAccountCleanup(f.admin, id, "a".repeat(64), new AbortController().signal)).toBe(false);
  });
  it("account pending page stops without repeated provider execution", async () => {
    vi.mocked(drainOwnPreparedCleanup).mockResolvedValue({ processed: 16, completed: false, pending: true, failed: false, unresolved: false });
    const f = fixture(account); expect(await prepareAccountCleanup(f.admin, id, "a".repeat(64), new AbortController().signal)).toBe(false); expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("refuses duplicate account cleanup identities", async () => {
    await expect(prepareAccountCleanup(fixture({ ...account, cleanupIds: [id, id] }).admin, id, "a".repeat(64), new AbortController().signal)).rejects.toThrow();
  });
  it("does not enter SQL or provider work after cancellation", async () => {
    const controller = new AbortController(); controller.abort(); const f = fixture(complete);
    await expect(prepareFileCleanup(f.admin, {}, controller.signal)).rejects.toThrow(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("validates the bounded selector count before draining a global queue", async () => {
    expect(await drainPreparedScratch(fixture(6).admin, new AbortController().signal)).toEqual({ processed: 0, failed: 1, stop: "failed" }); expect(drainOwnPreparedCleanup).not.toHaveBeenCalled();
  });
});

describe("bounded scratch page drain", () => {
  const page = { processed: 16, completed: false, pending: true, failed: false, unresolved: false };
  const empty = { ...page, processed: 0, pending: false };
  it("drains 33 entries across three fresh pages, then observes no eligible claim", async () => {
    vi.mocked(drainOwnPreparedCleanup).mockResolvedValueOnce(page).mockResolvedValueOnce(page)
      .mockResolvedValueOnce({ ...page, processed: 1, completed: true, pending: false }).mockResolvedValueOnce(empty);
    const f = fixture(1), signal = new AbortController().signal;
    expect(await drainPreparedScratch(f.admin, signal)).toEqual({ processed: 33, failed: 0, stop: "idle" });
    expect(f.rpc).toHaveBeenCalledTimes(1); expect(drainOwnPreparedCleanup).toHaveBeenCalledTimes(4);
    expect(vi.mocked(drainOwnPreparedCleanup).mock.calls.every(([admin, options]) => admin === f.admin
      && options?.signal instanceof AbortSignal && options.cleanupId === undefined)).toBe(true);
  });
  it("keeps pages serial and passes one shared aggregate signal", async () => {
    let finish!: (value: typeof page) => void;
    vi.mocked(drainOwnPreparedCleanup).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(empty);
    const work = drainPreparedScratch(fixture(0).admin, new AbortController().signal);
    await vi.waitFor(() => expect(drainOwnPreparedCleanup).toHaveBeenCalledTimes(1));
    finish(page); await work;
    const calls = vi.mocked(drainOwnPreparedCleanup).mock.calls;
    expect(calls).toHaveLength(2); expect(calls[0][1]?.signal).toBe(calls[1][1]?.signal);
  });
  it.each(["failed", "unresolved"] as const)("stops after a partial %s page without retrying it", async mode => {
    vi.mocked(drainOwnPreparedCleanup).mockResolvedValueOnce(page).mockResolvedValueOnce({ ...page, processed: 3, [mode]: true });
    expect(await drainPreparedScratch(fixture(1).admin, new AbortController().signal)).toEqual({ processed: 19, failed: 1, stop: mode });
    expect(drainOwnPreparedCleanup).toHaveBeenCalledTimes(2);
  });
  it("stops after a thrown page while preserving earlier acknowledged progress", async () => {
    vi.mocked(drainOwnPreparedCleanup).mockResolvedValueOnce(page).mockRejectedValueOnce(new Error("private provider detail"));
    expect(await drainPreparedScratch(fixture(1).admin, new AbortController().signal)).toEqual({ processed: 16, failed: 1, stop: "failed" });
    expect(drainOwnPreparedCleanup).toHaveBeenCalledTimes(2);
  });
  it.each([true, false])("stops on zero-entry completion=%s without calling the queue empty", async completed => {
    vi.mocked(drainOwnPreparedCleanup).mockResolvedValue({ ...page, processed: 0, completed });
    expect(await drainPreparedScratch(fixture(1).admin, new AbortController().signal)).toEqual({ processed: 0, failed: 0, stop: "no_progress" });
    expect(drainOwnPreparedCleanup).toHaveBeenCalledTimes(1);
  });
  it("bounds continuously successful work to 256 pages without calling it complete", async () => {
    vi.mocked(drainOwnPreparedCleanup).mockResolvedValue(page);
    expect(await drainPreparedScratch(fixture(1).admin, new AbortController().signal)).toEqual({ processed: 4096, failed: 0, stop: "bounded" });
    expect(drainOwnPreparedCleanup).toHaveBeenCalledTimes(256);
  });
  it("cancels the active page at 150 seconds and never starts another", async () => {
    vi.useFakeTimers(); let active!: AbortSignal;
    vi.mocked(drainOwnPreparedCleanup).mockImplementationOnce(async (_admin, options) => {
      active = options!.signal!;
      await new Promise<void>(resolve => active.addEventListener("abort", () => resolve(), { once: true }));
      return { ...page, processed: 2, failed: true };
    });
    const work = drainPreparedScratch(fixture(1).admin, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(149_999); expect(active.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await work).toEqual({ processed: 2, failed: 1, stop: "bounded" });
    expect(active.aborted).toBe(true); expect(drainOwnPreparedCleanup).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps a shorter caller budget and refuses a page after external cancellation", async () => {
    const controller = new AbortController();
    vi.mocked(drainOwnPreparedCleanup).mockImplementationOnce(async (_admin, options) => {
      controller.abort(); expect(options!.signal!.aborted).toBe(true); return page;
    });
    expect(await drainPreparedScratch(fixture(1).admin, controller.signal)).toEqual({ processed: 16, failed: 0, stop: "cancelled" });
    expect(drainOwnPreparedCleanup).toHaveBeenCalledTimes(1);
  });
  it("does not select work for an already cancelled caller", async () => {
    const controller = new AbortController(); controller.abort(); const f = fixture(1);
    expect(await drainPreparedScratch(f.admin, controller.signal)).toEqual({ processed: 0, failed: 0, stop: "cancelled" });
    expect(f.rpc).not.toHaveBeenCalled(); expect(drainOwnPreparedCleanup).not.toHaveBeenCalled();
  });
});
