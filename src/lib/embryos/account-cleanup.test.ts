import { beforeEach, describe, expect, it, vi } from "vitest";
import { drainAccountEmbryoCleanup } from "./account-cleanup";
import type { EmbryoFragmentRpc } from "./fragment-storage";
const mocks = vi.hoisted(() => ({ drain: vi.fn(), complete: vi.fn() }));
vi.mock("./unwind-storage", () => ({ drainEmbryoUnwindStorage: mocks.drain, completeEmbryoUnwind: mocks.complete }));
const deletionId = "76000000-0000-4000-8000-000000000001";
const unwindId = "76000000-0000-4000-8000-000000000002";
const row = { unwindId, purpose: "source", state: "storage_pending" };
function fixture(answers: unknown[], error: unknown = null) {
  const calls = vi.fn(() => ({ abortSignal: async () => ({ data: answers.shift(), error }) }));
  const input = { rpc: calls as EmbryoFragmentRpc, deletionId, claimToken: "a".repeat(64), signal: new AbortController().signal };
  return { calls, input };
}
describe("account-owned embryo storage boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.drain.mockResolvedValue({ status: "storage_confirmed", failed: 0, disposed: 1 });
    mocks.complete.mockResolvedValue({ status: "complete" }); });
  it("uses only the exact deletion and claim, with no provider work for an empty page", async () => {
    const f = fixture([[]]); expect(await drainAccountEmbryoCleanup(f.input)).toBe(true);
    expect(f.calls.mock.calls).toEqual([["account_embryo_unwinds_v1", { p_deletion_id: deletionId, p_claim_token_hash: "a".repeat(64) }]]);
    expect(mocks.drain).not.toHaveBeenCalled(); expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("requires exact object disposal, completion and an empty reread", async () => {
    const f = fixture([[row], []]); expect(await drainAccountEmbryoCleanup(f.input)).toBe(true);
    expect(mocks.drain).toHaveBeenCalledWith(expect.objectContaining({ rpc: f.input.rpc, unwindId }));
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ rpc: f.input.rpc, unwindId }));
    expect(f.calls).toHaveBeenCalledTimes(2);
  });
  it("never treats one completed unwind as the whole account", async () => {
    const f = fixture([[row], [{ ...row, unwindId: "76000000-0000-4000-8000-000000000003" }]]);
    expect(await drainAccountEmbryoCleanup(f.input)).toBe(false); expect(mocks.drain).toHaveBeenCalledTimes(1);
  });
  it("does not dispose again after SQL has verified Storage", async () => {
    const f = fixture([[{ ...row, state: "storage_confirmed" }], []]); expect(await drainAccountEmbryoCleanup(f.input)).toBe(true);
    expect(mocks.drain).not.toHaveBeenCalled(); expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
  it.each([{ status: "storage_pending", failed: 0 }, { status: "storage_confirmed", failed: 1 }, { status: "not_due", failed: 0 }])(
    "blocks completion for unresolved or failed provider work %j", async answer => {
      mocks.drain.mockResolvedValue(answer); const f = fixture([[row]]);
      expect(await drainAccountEmbryoCleanup(f.input)).toBe(false); expect(mocks.complete).not.toHaveBeenCalled();
    });
  it.each(["planned", "storage_pending"])("blocks account completion when unwind stays %s", async status => {
    mocks.complete.mockResolvedValue({ status }); const f = fixture([[row]]);
    expect(await drainAccountEmbryoCleanup(f.input)).toBe(false); expect(f.calls).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, [{ ...row, extra: "crossed" }], [row, row], [{ ...row, purpose: "other" }], Array(101).fill(row)])(
    "refuses malformed, duplicate or excessive selectors %j", async answer => {
      const f = fixture([answer]); await expect(drainAccountEmbryoCleanup(f.input)).rejects.toThrow();
      expect(mocks.drain).not.toHaveBeenCalled(); expect(mocks.complete).not.toHaveBeenCalled();
    });
  it("refuses an unavailable account claim", async () => {
    const f = fixture([[]], { code: "42501" }); await expect(drainAccountEmbryoCleanup(f.input)).rejects.toThrow("embryo_cleanup_unavailable");
    expect(mocks.drain).not.toHaveBeenCalled();
  });
  it("refuses cancellation before any target read", async () => {
    const f = fixture([[]]); f.input.signal = AbortSignal.abort();
    await expect(drainAccountEmbryoCleanup(f.input)).rejects.toThrow(); expect(f.calls).not.toHaveBeenCalled();
  });
});
