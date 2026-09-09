import { beforeEach, describe, expect, it, vi } from "vitest";
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
describe("prepared cleanup integration", () => {
  it("uses wrapped SQL even for legacy files and never contacts the prepared provider", async () => {
    const f = fixture(complete); expect(await prepareFileCleanup(f.admin, {})).toEqual({ error: null, original, complete: true });
    expect(f.rpc).toHaveBeenCalledWith("prepare_own_prepared_file_cleanup_v1", {}); expect(drainOwnPreparedCleanup).not.toHaveBeenCalled();
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
    expect(await drainPreparedScratch(fixture(6).admin, new AbortController().signal)).toEqual({ processed: 0, failed: 1 }); expect(drainOwnPreparedCleanup).not.toHaveBeenCalled();
  });
});
