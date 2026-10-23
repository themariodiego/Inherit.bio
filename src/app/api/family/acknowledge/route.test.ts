import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
// The one-time X-Inherit-CSRF gate is driven on this route by
// src/lib/security/session-csrf-routes.test.ts; here it admits every request.
vi.mock("@/lib/security/session-csrf", async (importOriginal) =>
  (await import("@/lib/security/session-csrf.test-support")).admitEverySessionCsrf(await importOriginal()));

/**
 * `POST /api/family/acknowledge` (register api.family-acknowledge). Since
 * 20261023120000 (G5.6, owner decision of 23 October 2026) the Portrait
 * acknowledgement carries the one-time nonce the Portrait page rendered for
 * this account, session and subject, and records it with the stamp, so the
 * audit event names the person. The result-gate acknowledgement writes no
 * row and is unchanged.
 */
vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/account-deletion", async (load) => ({
  ...await load<typeof import("@/lib/account-deletion")>(), getSensitiveAccountContext: mocks.context, isSameOrigin: () => true,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

const { POST } = await import("./route");
const { mintPersonOperationNonce } = await import("@/lib/person-operation-nonce");
const { hashOperationNonce } = await import("@/lib/account-deletion");

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUBJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const nonce = (overrides: Partial<{ accountId: string; sessionId: string; targetId: string }> = {}) =>
  mintPersonOperationNonce({ accountId: ACCOUNT, sessionId: SESSION, operation: "portrait_acknowledge", targetId: SUBJECT, ...overrides });
const call = (body: unknown, operationNonce: string | null) => POST(new Request("https://inherit.test/api/family/acknowledge", {
  method: "POST", headers: { "content-type": "application/json", origin: "https://inherit.test",
    ...(operationNonce === null ? {} : { "x-inherit-operation-nonce": operationNonce }) }, body: JSON.stringify(body),
}));
const portrait = { acknowledgement: "portrait", subjectId: SUBJECT, affirmed: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
  mocks.rpc.mockResolvedValue({ data: "2026-10-23T09:00:00.000Z", error: null });
});

describe("POST /api/family/acknowledge", () => {
  it("stamps the Portrait acknowledgement through the door that records the page's nonce", async () => {
    const code = nonce();
    const response = await call(portrait, code);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ acknowledgement: "portrait", acknowledgedAt: "2026-10-23T09:00:00.000Z" });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("acknowledge_portrait_with_nonce_v1", { p_account_id: ACCOUNT, p_session_id: SESSION,
      p_subject_id: SUBJECT, p_nonce_hash: hashOperationNonce(code), p_nonce_expires_at: expect.any(String) });
  });

  it("refuses a Portrait acknowledgement without the nonce for this account, session and subject, before any write", async () => {
    for (const code of [null, "not-a-nonce", nonce({ accountId: OTHER }), nonce({ sessionId: OTHER }), nonce({ targetId: OTHER })]) {
      const response = await call(portrait, code);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers a replayed nonce as an invalid request and another person's subject as the same 404 as before", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "invalid_operation_nonce" } });
    expect((await call(portrait, nonce())).status).toBe(400);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not_found" } });
    expect((await call(portrait, nonce())).status).toBe(404);
  });

  it("keeps the result gate's acknowledgement as it was: a session cookie and no database write", async () => {
    const response = await call({ acknowledgement: "tier2-result-gate", affirmed: true }, null);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
