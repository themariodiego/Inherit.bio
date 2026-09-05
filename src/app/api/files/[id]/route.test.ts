import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "./route";

const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/account-deletion", async (load) => ({ ...await load<typeof import("@/lib/account-deletion")>(), getSensitiveAccountContext: mocks.context }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, storage: { from: () => ({ remove: mocks.remove }) } }) }));
const id = "81000000-0000-4000-8000-000000000001";
const token = "81000000-0000-4000-8000-000000000002";
const call = (origin = "http://localhost") => DELETE(new Request(`http://localhost/api/files/${id}`, { method: "DELETE", headers: { origin } }), { params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ user: { id: "owner" }, sessionId: "session" });
  mocks.rpc.mockImplementation(async (name) => ({ data: name.startsWith("prepare") ? { token, bucket: "genomes", name: "db-owned-object" } : null, error: null }));
  mocks.remove.mockResolvedValue({ data: [], error: null });
});
describe("owner-authorized file deletion", () => {
  it("requires same-origin authentication before privileged access", async () => {
    expect((await call("https://example.invalid")).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.context.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["file_delete_not_found", "file_delete_processing", "file_delete_subject_unavailable", "file_delete_shared_graph"])("does not touch Storage on %s", async (message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });
    const response = await call();
    expect(response.status).toBe(message === "file_delete_not_found" ? 404 : 409);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each([null, {}, { token, bucket: "other", name: "wrong" }, { token, bucket: "genomes", name: "ok", extra: true }])("refuses malformed manifest %j", async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect((await call()).status).toBe(503);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("keeps database metadata on Storage failure and retries the same exact target", async () => {
    mocks.remove.mockResolvedValueOnce({ error: { message: "private storage failure" } });
    const failed = await call();
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "file_delete_failed" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect((await call()).status).toBe(204);
    expect(mocks.remove.mock.calls).toEqual([[['db-owned-object']], [['db-owned-object']]]);
    expect(mocks.rpc).toHaveBeenLastCalledWith("finish_genome_file_deletion_v1", { p_account_id: "owner", p_session_id: "session", p_file_id: id, p_token: token });
  });
  it("never reports success if final metadata cleanup fails", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { token, bucket: "genomes", name: "db-owned-object" }, error: null }).mockResolvedValueOnce({ error: { message: "constraint details" } });
    expect((await call()).status).toBe(503);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
  it("does not finish after a malformed Storage acknowledgement", async () => {
    mocks.remove.mockResolvedValue({ data: null, error: null });
    expect((await call()).status).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("catches transport failures without exposing internal details", async () => {
    mocks.remove.mockRejectedValue(new Error("private details"));
    const response = await call();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "file_delete_failed" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
