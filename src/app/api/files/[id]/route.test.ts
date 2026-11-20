import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
// The one-time X-Inherit-CSRF gate is driven on this route by
// src/lib/security/session-csrf-routes.test.ts; here it admits every request.
// The one-time operation value and the order of refusals through the real
// gate are in ./route.operation-nonce.test.ts.
vi.mock("@/lib/security/session-csrf", async (importOriginal) =>
  (await import("@/lib/security/session-csrf.test-support")).admitEverySessionCsrf(await importOriginal()));
vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
import { DELETE } from "./route";
import { mintPersonOperationNonce } from "@/lib/person-operation-nonce-core";

const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), remove: vi.fn(), drain: vi.fn() }));
vi.mock("@/lib/account-deletion", async (load) => ({ ...await load<typeof import("@/lib/account-deletion")>(), getSensitiveAccountContext: mocks.context }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: (...args: unknown[]) => { const result = mocks.rpc(...args); return Object.assign(result, { abortSignal: () => result }); }, storage: { from: () => ({ remove: mocks.remove }) } }) }));
vi.mock("@/lib/genome/prepared-source/cleanup", () => ({ drainOwnPreparedCleanup: mocks.drain }));
const id = "81000000-0000-4000-8000-000000000001";
const token = "81000000-0000-4000-8000-000000000002";
// G8.5, 20 November 2026: the account and session are UUIDs, because the
// one-time value the request carries is bound to them.
const owner = "81000000-0000-4000-8000-0000000000a1";
const session = "81000000-0000-4000-8000-0000000000b1";
const original = { token, bucket: "genomes", name: "db-owned-object" };
const plan = { version: "own-prepared-file-cleanup-v1", original, cleanupId: null, preparedComplete: true };
/** The value the Files page renders for this account, session and file. */
const fresh = () => mintPersonOperationNonce({ accountId: owner, sessionId: session, operation: "file_delete", targetId: id });
const call = (origin = "http://localhost") => DELETE(new Request(`http://localhost/api/files/${id}`, { method: "DELETE",
  headers: { origin, "x-inherit-operation-nonce": fresh() } }), { params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ user: { id: owner }, sessionId: session });
  mocks.rpc.mockImplementation(async (name) => ({ data: name.startsWith("prepare") ? plan : null, error: null }));
  mocks.drain.mockResolvedValue({ completed: false, pending: true, processed: 1, failed: false, unresolved: false });
  mocks.remove.mockResolvedValue({ data: [], error: null });
});
describe("owner-authorized file deletion", () => {
  it("answers the register's file-delete-v1: 202 file_delete_pending while cleanup runs, then 204 with no body (G8.5, 24 October 2026)", async () => {
    const register = JSON.parse(readFileSync("docs/route-register.json", "utf8")) as {
      routes: { id: string; successResponseContract?: string }[]; responseContractBindings: { routes: Record<string, string[]> };
      responseContracts: Record<string, { pending: { status: number; body: { error: { const: string } } }; deleted: { status: number; body: string };
        headers: Record<string, string> }> };
    expect(register.routes.find(route => route.id === "api.file-delete")?.successResponseContract).toBe("file-delete-v1");
    expect(register.responseContractBindings.routes["api.file-delete"]).toContain("file-delete-v1");
    const contract = register.responseContracts["file-delete-v1"];
    mocks.rpc.mockResolvedValueOnce({ data: { ...plan, cleanupId: token, preparedComplete: false }, error: null });
    const pending = await call();
    expect([pending.status, await pending.json()]).toEqual([contract.pending.status, { error: contract.pending.body.error.const }]);
    const deleted = await call();
    expect([deleted.status, await deleted.text(), contract.deleted.body]).toEqual([contract.deleted.status, "", "empty"]);
    for (const response of [pending, deleted]) expect(response.headers.get("cache-control")).toBe(contract.headers["Cache-Control"]);
  });
  it("returns explicit pending without touching the original or finishing database deletion", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...plan, cleanupId: token, preparedComplete: false }, error: null });
    const response = await call(); expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ error: "file_delete_pending" });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("requires same-origin authentication before privileged access", async () => {
    expect((await call("https://example.invalid")).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.context.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("answers no session with authenticated-api-v1's JSON 401 and an unreadable file with resource-not-found-v1", async () => {
    mocks.context.mockResolvedValue(null);
    const signedOut = await call();
    expect([signedOut.status, await signedOut.json()]).toEqual([401, { error: "unauthenticated" }]);
    mocks.context.mockResolvedValue({ user: { id: owner }, sessionId: session });
    const malformed = await DELETE(new Request("http://localhost/api/files/not-a-file", { method: "DELETE", headers: { origin: "http://localhost" } }),
      { params: Promise.resolve({ id: "not-a-file" }) });
    expect([malformed.status, await malformed.json()]).toEqual([404, { error: "not_found" }]);
    expect(mocks.rpc).not.toHaveBeenCalled();
    // The database's own refusals: no such file of this account, and an auth session no longer live.
    for (const [message, status, error] of [["file_delete_not_found", 404, "not_found"], ["file_delete_unauthorized", 401, "unauthenticated"]] as const) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { message } });
      const refused = await call();
      expect([refused.status, await refused.json()]).toEqual([status, { error }]);
      expect(refused.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  // Owner decision of 19 November 2026 ("a cross-site file delete is refused
  // with the register's code"): authenticated-mutation-v1's 403, before the
  // account or the database is read.
  it("answers a cross-origin request with authenticated-mutation-v1's request_forbidden, reading nothing", async () => {
    for (const origin of ["https://example.invalid", "http://localhost.example.invalid"]) {
      const response = await call(origin);
      expect([response.status, response.headers.get("content-type"), await response.json()])
        .toEqual([403, "application/json", { error: "request_forbidden" }]);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each(["file_delete_not_found", "file_delete_processing", "file_delete_subject_unavailable", "file_delete_shared_graph"])("does not touch Storage on %s", async (message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });
    const response = await call();
    expect(response.status).toBe(message === "file_delete_not_found" ? 404 : 409);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ...plan, original: { token, bucket: "other", name: "wrong" } }, { ...plan, original: { token, bucket: "genomes", name: "ok", extra: true } }])("refuses malformed manifest %j", async (data) => {
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
    // G8.5, 20 November 2026: each request's first call is the door that
    // spends its one-time value; the retry carries a fresh one.
    const prepares = mocks.rpc.mock.calls.filter(([name]) => String(name).startsWith("prepare"));
    expect(prepares.map(([name]) => name)).toEqual(["prepare_own_prepared_file_cleanup_with_nonce_v1", "prepare_own_prepared_file_cleanup_with_nonce_v1"]);
    for (const [, args] of prepares) {
      expect(args).toEqual({ p_account_id: owner, p_session_id: session, p_file_id: id,
        p_nonce_hash: expect.stringMatching(/^[0-9a-f]{64}$/u), p_nonce_expires_at: expect.any(String) });
    }
    expect(prepares[0]![1].p_nonce_hash).not.toBe(prepares[1]![1].p_nonce_hash);
    expect(mocks.remove.mock.calls).toEqual([[['db-owned-object']], [['db-owned-object']]]);
    expect(mocks.rpc).toHaveBeenLastCalledWith("finish_genome_file_deletion_v1", { p_account_id: owner, p_session_id: session, p_file_id: id, p_token: token });
  });
  it("never reports success if final metadata cleanup fails", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: plan, error: null }).mockResolvedValueOnce({ error: { message: "constraint details" } });
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
