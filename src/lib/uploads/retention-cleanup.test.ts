import { beforeEach, describe, expect, it, vi } from "vitest";
import { drainOwnUploadCleanup } from "./retention-cleanup";
import type { createAdminClient } from "../supabase/admin";
const manifestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const key = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const finalKey = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const work = { manifestId, objects: [{ objectId: key, bucketId: "genomes", objectName: key, ordinal: 1 },
  { objectId: finalKey, bucketId: "genomes", objectName: finalKey, ordinal: 2 }] };
const rpc = vi.fn(), remove = vi.fn(), from = vi.fn();
const admin = { rpc, storage: { from } } as unknown as ReturnType<typeof createAdminClient>;
beforeEach(() => {
  vi.resetAllMocks(); from.mockReturnValue({ remove }); remove.mockResolvedValue({ error: null });
  let issued = false;
  rpc.mockImplementation(async name => {
    if (name === "claim_own_upload_purge_v1") { const data = issued ? null : work; issued = true; return { data, error: null }; }
    return { data: true, error: null };
  });
});
describe("database-selected upload retention drain", () => {
  it("rechecks one closed manifest then removes only its two exact keys and commits completion", async () => {
    expect(await drainOwnUploadCleanup(admin)).toEqual({ processed: 1, failed: 0 });
    expect(from).toHaveBeenCalledExactlyOnceWith("genomes");
    expect(remove).toHaveBeenCalledExactlyOnceWith([key, finalKey]);
    const claim = rpc.mock.calls[0][1].p_claim_token_hash; expect(claim).toMatch(/^[0-9a-f]{64}$/);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["claim_own_upload_purge_v1", "authorize_own_upload_purge_v1",
      "finish_own_upload_purge_v1", "claim_own_upload_purge_v1"]);
    expect(rpc).toHaveBeenCalledWith("finish_own_upload_purge_v1", { p_manifest_id: manifestId, p_claim_token_hash: claim });
  });
  it("does nothing when the database has no due work", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await drainOwnUploadCleanup(admin)).toEqual({ processed: 0, failed: 0 }); expect(remove).not.toHaveBeenCalled();
  });
  it.each(["claim_own_upload_purge_v1", "authorize_own_upload_purge_v1", "finish_own_upload_purge_v1"])("counts %s failures without exposing database errors", async failure => {
    const original = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (...args) => args[0] === failure ? { data: null, error: { message: "private detail" } } : original(...args));
    expect(await drainOwnUploadCleanup(admin)).toEqual({ processed: 0, failed: 1 });
    if (failure !== "finish_own_upload_purge_v1") expect(remove).not.toHaveBeenCalled();
  });
  it("leaves a retry on failed deletion and never finishes a metadata-only purge", async () => {
    remove.mockResolvedValue({ error: { message: "private provider detail" } });
    expect(await drainOwnUploadCleanup(admin)).toEqual({ processed: 0, failed: 1 });
    expect(rpc.mock.calls.some(([name]) => name === "finish_own_upload_purge_v1")).toBe(false);
    expect(rpc).toHaveBeenCalledWith("fail_own_upload_purge_v1", expect.objectContaining({ p_manifest_id: manifestId }));
  });
  it.each([{ ...work, extra: true }, { ...work, objects: [] }, { ...work, objects: [work.objects[0], work.objects[0]] },
    { ...work, objects: [{ ...work.objects[0], objectName: "prefix/" }] },
    { ...work, objects: [{ ...work.objects[0], bucketId: "legal-evidence" }] }])("refuses an open, repeated or out-of-scope manifest", async data => {
    rpc.mockResolvedValueOnce({ data, error: null });
    expect(await drainOwnUploadCleanup(admin)).toEqual({ processed: 0, failed: 1 }); expect(remove).not.toHaveBeenCalled();
  });
  it("bounds a run to five due uploads and uses a new claim for each", async () => {
    rpc.mockImplementation(async name => ({ data: name === "claim_own_upload_purge_v1" ? work : true, error: null }));
    expect(await drainOwnUploadCleanup(admin)).toEqual({ processed: 5, failed: 0 }); expect(remove).toHaveBeenCalledTimes(5);
    const tokens = rpc.mock.calls.filter(([name]) => name === "claim_own_upload_purge_v1").map(([, args]) => args.p_claim_token_hash);
    expect(new Set(tokens).size).toBe(5);
  });
});
