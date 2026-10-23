import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
// The one-time X-Inherit-CSRF gate is driven on this route by
// src/lib/security/session-csrf-routes.test.ts; here it admits every request.
vi.mock("@/lib/security/session-csrf", async (importOriginal) =>
  (await import("@/lib/security/session-csrf.test-support")).admitEverySessionCsrf(await importOriginal()));

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/account-deletion", async (load) => ({
  ...await load<typeof import("@/lib/account-deletion")>(), getSensitiveAccountContext: mocks.context,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

const { POST } = await import("./route");
const { mintAccountOperationNonce } = await import("@/lib/account-operation-nonce");
const { hashOperationNonce } = await import("@/lib/account-deletion");
afterAll(() => vi.unstubAllEnvs());

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ORIGIN = "http://localhost";
const CONFIRMATION = "consents.revoke-all.confirmation";

function nonceFor(overrides: Partial<{ accountId: string; sessionId: string; operation: "consents_revoke_all" | "account_delete" }> = {}) {
  return mintAccountOperationNonce({ accountId: ACCOUNT, sessionId: SESSION, operation: "consents_revoke_all", ...overrides });
}

function call(body: unknown, options: { origin?: string | null; contentType?: string | null } = {}) {
  const headers = new Headers();
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType !== null) headers.set("content-type", contentType);
  return POST(new Request(`${ORIGIN}/api/consents/revoke-all`, {
    method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
  mocks.rpc.mockResolvedValue({ data: 3, error: null });
});

describe("POST /api/consents/revoke-all", () => {
  it("revokes through the database with the live account, session and nonce hash, and answers lifecycle-accepted-v1", async () => {
    const nonce = nonceFor();
    const response = await call({ confirmation: CONFIRMATION, nonce });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("revoke_all_own_consents_v1");
    expect(Object.keys(args).sort()).toEqual(["p_account_id", "p_nonce_expires_at", "p_nonce_hash", "p_session_id"]);
    expect(args).toMatchObject({ p_account_id: ACCOUNT, p_session_id: SESSION, p_nonce_hash: hashOperationNonce(nonce) });
    expect(Date.parse(args.p_nonce_expires_at)).toBe(Number(nonce.split(".")[0]));
  });

  it("answers accepted when there was nothing left to revoke", async () => {
    mocks.rpc.mockResolvedValue({ data: 0, error: null });
    const response = await call({ confirmation: CONFIRMATION, nonce: nonceFor() });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted" });
  });

  it("refuses a signed-out request before anything else", async () => {
    mocks.context.mockResolvedValue(null);
    const response = await call({ confirmation: CONFIRMATION, nonce: nonceFor() });
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses another origin", async () => {
    const response = await call({ confirmation: CONFIRMATION, nonce: nonceFor() }, { origin: "https://elsewhere.example" });
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON", async () => {
    const response = await call({ confirmation: CONFIRMATION, nonce: nonceFor() }, { contentType: "text/plain" });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["content-type"] });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps the body closed: a wrong confirmation, a missing nonce or any extra field is invalid-request-v1", async () => {
    for (const [value, issues] of [
      [{ confirmation: "account.delete.confirmation", nonce: nonceFor() }, ["confirmation"]],
      [{ confirmation: CONFIRMATION }, ["nonce"]],
      [{ confirmation: CONFIRMATION, nonce: nonceFor(), grantId: OTHER }, ["body"]],
      [{ confirmation: CONFIRMATION, nonce: nonceFor(), purposeKey: "ancestry" }, ["body"]],
      ["not json", ["body"]],
      [[], ["body"]],
    ] as const) {
      const response = await call(value);
      expect(response.status, JSON.stringify(value)).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_request", issues });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a nonce minted for another account, session or operation", async () => {
    for (const nonce of [
      nonceFor({ accountId: OTHER }), nonceFor({ sessionId: OTHER }), nonceFor({ operation: "account_delete" }), "forged",
    ]) {
      const response = await call({ confirmation: CONFIRMATION, nonce });
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_request", issues: ["nonce"] });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps a replayed nonce to invalid-request-v1 and an undispatchable grant to resource-not-found-v1", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "invalid_operation_nonce" } });
    const replay = await call({ confirmation: CONFIRMATION, nonce: nonceFor() });
    expect(replay.status).toBe(422);
    expect(await replay.json()).toEqual({ error: "invalid_request", issues: ["nonce"] });

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "revoke-all embryo authority unavailable" } });
    const refused = await call({ confirmation: CONFIRMATION, nonce: nonceFor() });
    expect(refused.status).toBe(404);
    expect(await refused.json()).toEqual({ error: "not_found" });
  });

  it("answers unavailable for any other database failure or an unexpected result", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "boom" } });
    expect((await call({ confirmation: CONFIRMATION, nonce: nonceFor() })).status).toBe(503);
    mocks.rpc.mockResolvedValueOnce({ data: "3", error: null });
    expect((await call({ confirmation: CONFIRMATION, nonce: nonceFor() })).status).toBe(503);
  });
});
