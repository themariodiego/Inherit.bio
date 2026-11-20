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
  rpcArgs: [] as unknown[],
  reads: [] as string[],
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => (mocks.reads.push(table),
    { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.rows[table] ?? null, error: null }) }) }) }),
  rpc: async (name: string, args: unknown) => { mocks.rpcCalls.push(name); mocks.rpcArgs.push(args); return mocks.rpc; },
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
  mocks.rpcArgs = [];
  mocks.reads = [];
});
afterEach(() => vi.unstubAllEnvs());

/**
 * `authenticated-mutation-v1` requires the exact origin and same-origin fetch
 * metadata on every authenticated mutation. The CSRF wrapper spends the
 * session token but reads neither header, so the handler checks them, as
 * api.consents-revoke-all and api.consent-reaffirm do, before it reads which
 * kind of consent the id names (G8.5, 19 November 2026).
 */
describe("api.consent-revoke's origin and fetch-metadata check", () => {
  const foreign = (headers: Record<string, string>) => POST(new Request(`http://localhost/api/consents/${GRANT}/revoke`, { method: "POST",
    headers: { ...headers, "x-inherit-operation-nonce": mintPersonOperationNonce({ accountId: ACCOUNT, sessionId: SESSION,
      operation: "consent_revoke", targetId: GRANT }) } }), { params: Promise.resolve({ id: GRANT }) });

  it.each([["a directional purpose grant", "purpose_grants"], ["a cloud-model provider grant", "consent_grants"]])(
    "refuses %s from another origin or without same-origin fetch metadata with 403 request_forbidden, reading and writing nothing",
    async (_label, table) => {
      mocks.rows = { [table]: table === "purpose_grants" ? { grant_id: GRANT, target_id: null, copilot_recipient_revision: null } : { id: GRANT } };
      mocks.rpc = { data: table === "purpose_grants" ? "2026-11-19T12:00:00.000Z" : true, error: null };
      const variants: Record<string, string>[] = [{ origin: "https://elsewhere.example", "sec-fetch-site": "cross-site" },
        { origin: "http://localhost.example" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, {}];
      for (const headers of variants) {
        expect(await answer(await foreign(headers)), JSON.stringify(headers)).toEqual([403, "application/json", { error: "request_forbidden" }]);
      }
      expect(mocks.reads).toEqual([]);
      expect(mocks.rpcCalls).toEqual([]);
    });

  it("still revokes from this origin with same-origin fetch metadata", async () => {
    mocks.rows = { consent_grants: { id: GRANT } };
    mocks.rpc = { data: true, error: null };
    const response = await foreign({ origin: "http://localhost", "sec-fetch-site": "same-origin" });
    expect([response.status, await response.json()]).toEqual([200, { revoked: true }]);
    expect(mocks.rpcCalls).toEqual(["revoke_cloud_model_consent_with_nonce_v1"]);
  });
});

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

/**
 * A non-parent uploader's own consent.upload-embryo signature (owner decision
 * of 19 November 2026, "A non-parent uploader's withdrawal for an embryo
 * upload stops analysis and deletes, as they signed"). The route resolves the
 * signature only for that artifact and purpose, spends the page's
 * consent_revoke nonce through `withdraw_embryo_uploader_consent_v1`, which
 * decides the phase and the actor itself, and answers lifecycle-accepted-v1.
 */
describe("api.consent-revoke for a non-parent uploader's embryo upload signature", () => {
  const SIGNATURE = { id: GRANT, artifact_key: "consent.upload-embryo", purpose: "embryo-upload-uploader-class" };
  const nonce = () => mintPersonOperationNonce({ accountId: ACCOUNT, sessionId: SESSION, operation: "consent_revoke", targetId: GRANT });
  const send = (code: string | null = nonce()) => POST(new Request(`http://localhost/api/consents/${GRANT}/revoke`, { method: "POST",
    headers: { origin: "http://localhost", "sec-fetch-site": "same-origin", ...(code === null ? {} : { "x-inherit-operation-nonce": code }) } }),
  { params: Promise.resolve({ id: GRANT }) });
  beforeEach(() => { mocks.rows = { consent_signatures: SIGNATURE }; });

  it("withdraws through the one door with the nonce's hash, and answers 202 accepted", async () => {
    const code = nonce();
    mocks.rpc = { data: { case: "cohort" }, error: null };
    const response = await send(code);
    expect([response.status, response.headers.get("cache-control"), await response.json()])
      .toEqual([202, "private, no-store", { status: "accepted" }]);
    expect(mocks.reads).toEqual(["purpose_grants", "consent_grants", "consent_signatures"]);
    expect(mocks.rpcCalls).toEqual(["withdraw_embryo_uploader_consent_v1"]);
    const { hashOperationNonce } = await import("@/lib/account-deletion");
    expect(mocks.rpcArgs).toEqual([{ p_account_id: ACCOUNT, p_session_id: SESSION, p_signature_id: GRANT,
      p_nonce_hash: hashOperationNonce(code), p_nonce_expires_at: new Date(Number(code.split(".")[0])).toISOString() }]);
    mocks.rpc = { data: { case: "draft" }, error: null };
    expect((await send()).status).toBe(202);
  });

  it("resolves no other signature: another artifact or purpose is not found, and nothing runs", async () => {
    for (const other of [{ ...SIGNATURE, artifact_key: "consent.upload-self" }, { ...SIGNATURE, purpose: "embryo-upload-parent-class" },
      { ...SIGNATURE, artifact_key: "consent.upload-other-adult", purpose: "other-adult-upload" }]) {
      mocks.rows = { consent_signatures: other };
      expect(await answer(await send()), JSON.stringify(other)).toEqual(NOT_FOUND);
    }
    mocks.rows = { consent_signatures: SIGNATURE, consent_grants: { id: GRANT } };
    expect(await answer(await send())).toEqual(NOT_FOUND);
    expect(mocks.rpcCalls).toEqual([]);
  });

  it("requires this account's own session and a nonce minted for this signature", async () => {
    expect(await answer(await send(null))).toEqual([400, "application/json", { error: "invalid_request" }]);
    expect(await answer(await send(mintPersonOperationNonce({ accountId: ACCOUNT, sessionId: SESSION, operation: "consent_revoke",
      targetId: "7c6e0000-0000-4000-8000-000000000099" })))).toEqual([400, "application/json", { error: "invalid_request" }]);
    mocks.account = { user: { id: "7c6e0000-0000-4000-8000-000000000041" }, sessionId: SESSION };
    expect(await answer(await send())).toEqual(UNAUTHENTICATED);
    expect(mocks.rpcCalls).toEqual([]);
  });

  it("answers the door's refusals with the JSON 404, a spent nonce with 400, and anything else with 503", async () => {
    for (const error of [{ code: "42501", message: "not_found" }, { code: "42501", message: "not the non-parent uploader" },
      { code: "55000", message: "already restricted" }, { code: "55000", message: "withdrawal_phase_changed" }]) {
      mocks.rpc = { data: null, error };
      expect(await answer(await send()), error.message).toEqual(NOT_FOUND);
    }
    mocks.rpc = { data: null, error: { code: "22023", message: "invalid_operation_nonce" } };
    expect(await answer(await send())).toEqual([400, "application/json", { error: "invalid_request" }]);
    mocks.rpc = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    expect(await answer(await send())).toEqual([503, "application/json", { error: "unavailable" }]);
  });
});
