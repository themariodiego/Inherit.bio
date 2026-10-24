import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The own-Copilot case of api.consent-revoke (G8.5, 24 October 2026; owner
 * decision of 23 October, item 1: the code moves to the register). The
 * register requires X-Inherit-Operation-Nonce-from-the-consent-page on every
 * revocation, so the withdrawal carries the nonce /settings/copilot rendered
 * for this account, session and grant, and the door that records it
 * (revoke_own_copilot_with_nonce_v1, 20261025200000) runs the unchanged
 * writer. Only the account context and the database are doubles; the nonce's
 * MAC and the authority schema are the real ones. Every value is synthetic.
 */
const mocks = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor,
  ownUploadJson: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock("./own-provider-authority", async (importOriginal) => ({
  ...await importOriginal<typeof import("./own-provider-authority")>(), ownCopilotRpc: mocks.rpc }));
const { revokeOwnCopilotConsent } = await import("./own-consent");
const { mintPersonOperationNonce } = await import("@/lib/person-operation-nonce");
const { hashOperationNonce } = await import("@/lib/account-deletion");

const ACCOUNT = "7c6e0000-0000-4000-8000-000000000001";
const SESSION = "7c6e0000-0000-4000-8000-000000000011";
const SUBJECT = "7c6e0000-0000-4000-8000-000000000021";
const GRANT = "7c6e0000-0000-4000-8000-000000000031";
const OTHER = "7c6e0000-0000-4000-8000-000000000041";
const authority = { accountId: ACCOUNT, sessionId: SESSION, subjectId: SUBJECT,
  context: { accountRevision: 1, authSessionRevision: 1, jurisdictionRevision: 1, subjectBindingRevision: 1, accountBindingRevision: 1,
    uploadConsentId: GRANT, subjectLifecycleRevision: 1, originatingSessionRevision: 1, principalId: GRANT, principalRevision: 1 },
  settingsRevision: 1, providerClass: "local", runtimeAttestationRevision: 1, runtimeAttestationFingerprint: "a".repeat(64),
  recipientRevision: 1, copilotGrantId: GRANT, copilotGrantRevision: 1, providerGrantId: null, providerGrantRevision: null };
const nonce = (overrides: Partial<{ accountId: string; sessionId: string; targetId: string }> = {}) =>
  mintPersonOperationNonce({ accountId: ACCOUNT, sessionId: SESSION, operation: "consent_revoke", targetId: GRANT, ...overrides });
const withdraw = (code: string | null) => revokeOwnCopilotConsent(new Request(`http://localhost/api/consents/${GRANT}/revoke`, {
  method: "POST", headers: { origin: "http://localhost", "sec-fetch-site": "same-origin",
    ...(code === null ? {} : { "x-inherit-operation-nonce": code }) } }), GRANT, SUBJECT);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 29).toString("base64"));
  mocks.actor.mockResolvedValue({ accountId: ACCOUNT, sessionId: SESSION });
  mocks.rpc.mockImplementation(async (name: string) => name === "own_copilot_authority_v1"
    ? { data: authority, error: null } : { data: true, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("the own-Copilot withdrawal reads the page's nonce", () => {
  it("withdraws through the door that records the nonce, with the authority it read", async () => {
    const code = nonce();
    const response = await withdraw(code);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith("revoke_own_copilot_with_nonce_v1", { p_account_id: ACCOUNT, p_session_id: SESSION,
      p_subject_id: SUBJECT, p_expected: authority, p_nonce_hash: hashOperationNonce(code), p_nonce_expires_at: expect.any(String) });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain("revoke_own_copilot_v1");
  });

  it("refuses a withdrawal without the nonce for this account, session and grant, before any database call", async () => {
    for (const code of [null, "not-a-nonce", nonce({ accountId: OTHER }), nonce({ sessionId: OTHER }), nonce({ targetId: OTHER }),
      mintPersonOperationNonce({ accountId: ACCOUNT, sessionId: SESSION, operation: "provider_setting_delete", targetId: GRANT })]) {
      const response = await withdraw(code);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers a replayed nonce as an invalid request, and withdraws nothing", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "own_copilot_authority_v1"
      ? { data: authority, error: null } : { data: null, error: { code: "22023", message: "invalid_operation_nonce" } });
    const response = await withdraw(nonce());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("still answers another grant as not found, without spending the nonce", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...authority, copilotGrantId: OTHER }, error: null });
    expect((await withdraw(nonce())).status).toBe(404);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0][0]).toBe("own_copilot_authority_v1");
  });
});
