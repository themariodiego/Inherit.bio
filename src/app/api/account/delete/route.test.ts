import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), context: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/account-deletion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-deletion")>()),
  getSensitiveAccountContext: mocks.context,
}));
vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const deleteRoute = await import("./route");
const cancelRoute = await import("./cancel/route");
const { mintAccountOperationNonce } = await import("@/lib/account-operation-nonce");
afterAll(() => vi.unstubAllEnvs());

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function post(path: string, body: unknown) {
  return new Request(`https://inherit.bio${path}`, {
    method: "POST",
    headers: { origin: "https://inherit.bio", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const sha256 = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ user: { id: ACCOUNT, email: "someone@e2e.local" }, sessionId: SESSION });
});

describe("account deletion takes its nonce from the page, never from a GET (brief X1.5)", () => {
  it("serves both operations by POST alone: there is no GET that could issue a nonce", () => {
    expect(Object.keys(deleteRoute).filter((name) => /^[A-Z]+$/u.test(name))).toEqual(["POST"]);
    expect(Object.keys(cancelRoute).filter((name) => /^[A-Z]+$/u.test(name))).toEqual(["POST"]);
  });

  it("spends a rendered nonce through v2, passing only its hash and expiry", async () => {
    const nonce = mintAccountOperationNonce({ accountId: ACCOUNT, sessionId: SESSION, operation: "account_delete" });
    mocks.rpc.mockResolvedValue({ data: [{ deletion_id: OTHER, status: "notice_period", notice_ends_at: "2026-10-05T12:00:00.000Z" }], error: null });
    const response = await deleteRoute.POST(post("/api/account/delete", { confirmation: "account.delete.confirmation", nonce }));
    expect(response.status).toBe(202);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("request_account_deletion_v2");
    expect(args).toMatchObject({ p_account_id: ACCOUNT, p_session_id: SESSION, p_nonce_hash: sha256(nonce),
      p_nonce_expires_at: new Date(Number(nonce.split(".")[0])).toISOString() });
    expect(JSON.stringify(args)).not.toContain(nonce.split(".")[2]);
  });

  it("refuses a nonce minted for another session or the other operation before touching the database", async () => {
    for (const nonce of [
      mintAccountOperationNonce({ accountId: ACCOUNT, sessionId: OTHER, operation: "account_delete" }),
      mintAccountOperationNonce({ accountId: OTHER, sessionId: SESSION, operation: "account_delete" }),
      mintAccountOperationNonce({ accountId: ACCOUNT, sessionId: SESSION, operation: "account_delete_cancel" }),
      `${Date.now() + 60_000}.${"A".repeat(43)}.${"0".repeat(64)}`,
    ]) {
      const response = await deleteRoute.POST(post("/api/account/delete", { confirmation: "account.delete.confirmation", nonce }));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "invalid_operation_nonce" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("cancels only with a cancellation nonce for this session", async () => {
    const wrong = mintAccountOperationNonce({ accountId: ACCOUNT, sessionId: SESSION, operation: "account_delete" });
    const refused = await cancelRoute.POST(post("/api/account/delete/cancel", { confirmation: "account.delete.cancel-confirmation", nonce: wrong }));
    expect(refused.status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();

    const nonce = mintAccountOperationNonce({ accountId: ACCOUNT, sessionId: SESSION, operation: "account_delete_cancel" });
    mocks.rpc.mockResolvedValue({ data: [{ status: "active", cancelled_at: "2026-09-29T12:00:00.000Z" }], error: null });
    const response = await cancelRoute.POST(post("/api/account/delete/cancel", { confirmation: "account.delete.cancel-confirmation", nonce }));
    expect(response.status).toBe(200);
    expect(mocks.rpc.mock.calls[0][0]).toBe("cancel_account_deletion_v2");
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_nonce_hash: sha256(nonce) });
  });

  it("passes the database's replay refusal through as an expired confirmation", async () => {
    const nonce = mintAccountOperationNonce({ accountId: ACCOUNT, sessionId: SESSION, operation: "account_delete" });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "invalid_operation_nonce" } });
    const response = await deleteRoute.POST(post("/api/account/delete", { confirmation: "account.delete.confirmation", nonce }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "invalid_operation_nonce" });
  });
});
