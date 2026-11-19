import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The one-time X-Inherit-CSRF gate is driven on this route by
// src/lib/security/session-csrf-routes.test.ts; here it admits every request.
vi.mock("@/lib/security/session-csrf", async (importOriginal) =>
  (await import("@/lib/security/session-csrf.test-support")).admitEverySessionCsrf(await importOriginal()));

/**
 * The sign-in and not-found refusals of `POST /api/consents/[id]/revoke`
 * (api.consent-revoke) are the register's: `authenticated-api-v1`'s JSON 401
 * `unauthenticated` and `resource-not-found-v1`'s JSON 404 `not_found`, where
 * the route answered plain text. The route-specific answers (400
 * `invalid_request`, 503 `consent_unavailable`) are not this suite's. Only the
 * account context and the database are doubles; the nonce's MAC is real.
 * Every value is synthetic.
 */
const ACCOUNT = "7c6e0000-0000-4000-8000-000000000001";
const SESSION = "7c6e0000-0000-4000-8000-000000000011";
const GRANT = "7c6e0000-0000-4000-8000-000000000031";
const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  account: null as { user: { id: string }; sessionId: string } | null,
  rows: {} as Record<string, unknown>,
  rpc: { data: null as unknown, error: null as { code?: string; message?: string } | null },
  rpcCalls: [] as string[],
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.rows[table] ?? null, error: null }) }) }) }),
  rpc: async (name: string) => { mocks.rpcCalls.push(name); return mocks.rpc; },
}) }));
vi.mock("@/lib/account-deletion", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/account-deletion")>(), getSensitiveAccountContext: async () => mocks.account }));

const { POST } = await import("./route");
const { mintPersonOperationNonce } = await import("@/lib/person-operation-nonce");

const revoke = () => POST(new Request(`http://localhost/api/consents/${GRANT}/revoke`, { method: "POST", headers: {
  origin: "http://localhost", "sec-fetch-site": "same-origin",
  "x-inherit-operation-nonce": mintPersonOperationNonce({ accountId: ACCOUNT, sessionId: SESSION, operation: "consent_revoke", targetId: GRANT }),
} }), { params: Promise.resolve({ id: GRANT }) });
const answer = async (response: Response) => [response.status, response.headers.get("content-type"), await response.json()];
const UNAUTHENTICATED = [401, "application/json", { error: "unauthenticated" }];
const NOT_FOUND = [404, "application/json", { error: "not_found" }];

beforeEach(() => {
  vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 31).toString("base64"));
  mocks.user = { id: ACCOUNT };
  mocks.account = { user: { id: ACCOUNT }, sessionId: SESSION };
  mocks.rows = {};
  mocks.rpc = { data: null, error: null };
  mocks.rpcCalls = [];
});
afterEach(() => vi.unstubAllEnvs());

describe("api.consent-revoke's sign-in and not-found refusals", () => {
  it("answers a request with no session with the JSON 401, reading nothing", async () => {
    mocks.user = null;
    expect(await answer(await revoke())).toEqual(UNAUTHENTICATED);
    expect(mocks.rpcCalls).toEqual([]);
  });

  it("answers an id that names no consent, or two, with the JSON 404", async () => {
    expect(await answer(await revoke())).toEqual(NOT_FOUND);
    mocks.rows = { purpose_grants: { grant_id: GRANT, target_id: null, copilot_recipient_revision: null }, consent_grants: { id: GRANT } };
    expect(await answer(await revoke())).toEqual(NOT_FOUND);
    expect(mocks.rpcCalls).toEqual([]);
  });

  it.each([["a directional purpose grant", "purpose_grants"], ["a cloud-model provider grant", "consent_grants"]])(
    "answers %s whose account session is not this user's with the JSON 401, before the writer", async (_label, table) => {
      mocks.rows = { [table]: table === "purpose_grants" ? { grant_id: GRANT, target_id: null, copilot_recipient_revision: null } : { id: GRANT } };
      for (const account of [null, { user: { id: "7c6e0000-0000-4000-8000-000000000041" }, sessionId: SESSION }]) {
        mocks.account = account;
        expect(await answer(await revoke())).toEqual(UNAUTHENTICATED);
      }
      expect(mocks.rpcCalls).toEqual([]);
    });

  it("answers a directional revocation the writer refuses, and a provider grant it does not revoke, with the JSON 404", async () => {
    mocks.rows = { purpose_grants: { grant_id: GRANT, target_id: null, copilot_recipient_revision: null } };
    mocks.rpc = { data: null, error: { code: "42501", message: "not_found" } };
    expect(await answer(await revoke())).toEqual(NOT_FOUND);
    mocks.rpc = { data: null, error: null };
    expect(await answer(await revoke())).toEqual(NOT_FOUND);
    mocks.rows = { consent_grants: { id: GRANT } };
    mocks.rpc = { data: false, error: null };
    expect(await answer(await revoke())).toEqual(NOT_FOUND);
    expect(mocks.rpcCalls).toEqual(["revoke_directional_purpose_with_nonce_v1", "revoke_directional_purpose_with_nonce_v1",
      "revoke_cloud_model_consent_with_nonce_v1"]);
  });

  it("still revokes a directional grant with its receipt", async () => {
    mocks.rows = { purpose_grants: { grant_id: GRANT, target_id: null, copilot_recipient_revision: null } };
    mocks.rpc = { data: "2026-11-19T12:00:00.000Z", error: null };
    const response = await revoke();
    expect([response.status, await response.json()]).toEqual([200, { revoked: true, effectiveAt: "2026-11-19T12:00:00.000Z" }]);
  });
});
