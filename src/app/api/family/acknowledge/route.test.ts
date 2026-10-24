import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registeredStatuses, type RegisterDocument } from "../../../../../scripts/form-contract-census";
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
const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), sameOrigin: vi.fn() }));
vi.mock("@/lib/account-deletion", async (load) => ({
  ...await load<typeof import("@/lib/account-deletion")>(), getSensitiveAccountContext: mocks.context, isSameOrigin: mocks.sameOrigin,
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
  mocks.sameOrigin.mockReturnValue(true);
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
      // invalid-request-v1 since 2026-10-24 (G8.5); it was a 400 { error: "invalid_request" }.
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_request", issues: ["operationNonce"] });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers a replayed nonce as an invalid request and another person's subject as the same 404 as before", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "invalid_operation_nonce" } });
    // 422 since 2026-10-24 (G8.5); it was 400.
    expect((await call(portrait, nonce())).status).toBe(422);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not_found" } });
    const foreign = await call(portrait, nonce());
    expect(foreign.status).toBe(404);
    // resource-not-found-v1's JSON body since 2026-10-24 (G8.5); it was plain text.
    expect(await foreign.json()).toEqual({ error: "not_found" });
  });

  it("refuses another origin, a body outside the closed ones and a request with no session with the register's bodies, before any write", async () => {
    mocks.sameOrigin.mockReturnValue(false);
    const crossSite = await call(portrait, nonce());
    expect([crossSite.status, await crossSite.json()]).toEqual([403, { error: "request_forbidden" }]);
    mocks.sameOrigin.mockReturnValue(true);
    for (const body of [{}, { ...portrait, affirmed: false }, { acknowledgement: "embryo-result-gate", affirmed: true }, { ...portrait, accountId: ACCOUNT }]) {
      const invalid = await call(body, nonce());
      expect([invalid.status, await invalid.json()]).toEqual([422, { error: "invalid_request", issues: ["body"] }]);
    }
    mocks.context.mockResolvedValue(null);
    const signedOut = await call(portrait, nonce());
    expect([signedOut.status, await signedOut.json()]).toEqual([401, { error: "unauthenticated" }]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps the result gate's acknowledgement as it was: a session cookie and no database write", async () => {
    const response = await call({ acknowledgement: "tier2-result-gate", affirmed: true }, null);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("the register describes every refusal this route answers (G8.5, 24 October 2026)", () => {
  const register = JSON.parse(readFileSync("docs/route-register.json", "utf8")) as RegisterDocument;
  const entry = register.routes.find(route => route.id === "api.family-acknowledge")!;
  /** The (status, error) pairs among `expected` the register lets this route answer, as its Embryo twin's test reads them. */
  const registered = (expected: (readonly [number, string])[]) => {
    const statuses = registeredStatuses(entry, "POST", register);
    const codes = JSON.stringify([register.authContracts, ...(register.responseContractBindings.routes[entry.id] ?? [])
      .map(name => register.responseContracts[name])]);
    return expected.filter(([status, code]) => statuses.includes(status) && codes.includes(`{"const":"${code}"}`));
  };

  it("answers each refusal with a status and error code the register gives api.family-acknowledge", async () => {
    const answers: Response[] = [];
    mocks.sameOrigin.mockReturnValue(false);
    answers.push(await call(portrait, nonce()));
    mocks.sameOrigin.mockReturnValue(true);
    answers.push(await call({}, null), await call(portrait, null));
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not_found" } });
    answers.push(await call(portrait, nonce()));
    mocks.context.mockResolvedValue(null);
    answers.push(await call(portrait, nonce()));
    const refusals = await Promise.all(answers.map(async response => [response.status, (await response.json()).error] as const));
    expect(refusals).toEqual(registered([[403, "request_forbidden"], [422, "invalid_request"], [422, "invalid_request"],
      [404, "not_found"], [401, "unauthenticated"]]));
  });
});
