import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createAdminClient } from "../../supabase/admin";
import { drainOwnOriginalRetirement } from "./original-retention";
vi.mock("./storage-common", async original => ({ ...await original<typeof import("./storage-common")>(), preparedStorageConfig: () => ({ origin: "http://127.0.0.1:55321", key: "synthetic-placeholder" }) }));
const fileId = "11111111-1111-4111-8111-111111111111", objectId = "22222222-2222-4222-8222-222222222222";
const objectKey = "33333333-3333-4333-8333-333333333333", storageVersion = "44444444-4444-4444-8444-444444444444";
const makeClaim = () => ({ version: "own-original-retirement-v1", fileId, manifestId: fileId, objectId, objectKey, storageVersion,
  bucket: "genomes", byteCount: 8, sha256: "a".repeat(64), expiresAt: new Date(Date.now()-1000).toISOString(), claimExpiresAt: new Date(Date.now()+29000).toISOString() });
const object = { id: objectId, name: objectKey, version: storageVersion, bucket_id: "genomes", metadata: { size: 8 } };
function fixture(values: Record<string, unknown> = {}) {
  const claim = makeClaim(); const replies: Record<string, unknown> = { claim_own_original_retirement_v1: claim, check_own_original_retirement_v1: claim, finish_own_original_retirement_v1: true, ...values };
  const rpc = vi.fn((name: string) => ({ abortSignal: async () => ({ data: structuredClone(replies[name]), error: null }) }));
  return { rpc, admin: { rpc } as unknown as ReturnType<typeof createAdminClient> };
}
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => Response.json([object]))); });
afterEach(() => { vi.unstubAllGlobals(); });
describe("original retirement executor", () => {
  it("requires exact known-version nonempty provider acknowledgement before SQL retirement", async () => {
    const f = fixture(); expect(await drainOwnOriginalRetirement(f.admin, new AbortController().signal)).toEqual({ processed: 1, failed: 0 });
    expect(fetch).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:55321/storage/v1/object/genomes", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ prefixes: [objectKey] }), signal: expect.any(AbortSignal), redirect: "error" }));
    expect(f.rpc.mock.calls.map(c => c[0])).toEqual(["claim_own_original_retirement_v1", "check_own_original_retirement_v1", "finish_own_original_retirement_v1"]);
  });
  it.each([[], [{ ...object, id: fileId }], [{ ...object, version: fileId }], [{ ...object, name: fileId }], [{ ...object, metadata: { size: 7 } }], [object, object]].map(value => ({ value })))("refuses missing or mismatched provider evidence %j", async ({ value }) => {
    vi.mocked(fetch).mockResolvedValue(Response.json(value)); const f = fixture();
    expect(await drainOwnOriginalRetirement(f.admin, new AbortController().signal)).toEqual({ processed: 0, failed: 1 });
    expect(f.rpc).not.toHaveBeenCalledWith("finish_own_original_retirement_v1", expect.anything());
  });
  it("performs no provider action without due work", async () => {
    const f = fixture({ claim_own_original_retirement_v1: null }); expect(await drainOwnOriginalRetirement(f.admin, new AbortController().signal)).toEqual({ processed: 0, failed: 0 }); expect(fetch).not.toHaveBeenCalled();
  });
  it("refuses changed current database identity", async () => {
    const f = fixture({ check_own_original_retirement_v1: { ...makeClaim(), objectKey: fileId } });
    expect((await drainOwnOriginalRetirement(f.admin, new AbortController().signal)).failed).toBe(1); expect(fetch).not.toHaveBeenCalled();
  });
  it("does not retry an unknown provider response or claim completion", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("private provider detail"));const f = fixture();
    expect((await drainOwnOriginalRetirement(f.admin, new AbortController().signal)).failed).toBe(1);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("requires a confirmed database finish", async () => {
    const f = fixture({ finish_own_original_retirement_v1: false }); expect((await drainOwnOriginalRetirement(f.admin, new AbortController().signal)).failed).toBe(1);
  });
  it("does not delete after caller cancellation", async () => {
    const controller = new AbortController();controller.abort();const f = fixture();expect((await drainOwnOriginalRetirement(f.admin, controller.signal)).failed).toBe(1);expect(fetch).not.toHaveBeenCalled();
  });
  it("cancels an owned response that arrives after abort without parsing or finishing", async () => {
    let deliver!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { deliver = resolve; }));
    const controller = new AbortController(), f = fixture(); const operation = drainOwnOriginalRetirement(f.admin, controller.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); controller.abort();
    expect(await operation).toEqual({ processed: 0, failed: 1 });
    const cancelled = vi.fn(); deliver(new Response(new ReadableStream({ cancel: cancelled })));
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1));
    expect(f.rpc.mock.calls.map(c => c[0])).not.toContain("finish_own_original_retirement_v1");
  });
  it("aborts a stalled body and does not await stalled provider cancellation", async () => {
    const cancelled = vi.fn(() => new Promise<void>(() => {}));
    vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({ pull() {}, cancel: cancelled })));
    const controller = new AbortController(), f = fixture(); const operation = drainOwnOriginalRetirement(f.admin, controller.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); controller.abort();
    expect(await operation).toEqual({ processed: 0, failed: 1 });
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

});
