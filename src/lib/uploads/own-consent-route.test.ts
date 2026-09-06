import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getClaims: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: mocks }) }));
import { ownUploadConsent } from "./own-consent-route";
import { mintOwnConsentPresentation } from "./own-consent-token";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
afterAll(() => vi.unstubAllEnvs());
const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const subjectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const receipt = { recordKind: "artifact_signature", recordId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  artifactKey: "consent.upload-self", artifactVersion: 1, signedAt: "2026-09-06T10:00:00+00:00" };
const input = { accountId, sessionId, subjectId, accountRevision: 2, authSessionRevision: 3,
  jurisdictionRevision: 4, subjectBindingRevision: 5, artifactKey: "consent.upload-self" as const,
  artifactVersion: 1, artifactBodySha256: "a".repeat(64) };
function requestCase(claims = input) {
  const { token, nonceHash } = mintOwnConsentPresentation(claims);
  const body = { action: "sign-artifact", signatureClass: "tier1-self", subjectId,
    artifactVersion: 1, artifactPresentationToken: token, affirmed: true, statementKeys: ["own-adult-dna"] };
  const headers = { origin: "https://inherit.bio", "sec-fetch-site": "same-origin", "x-inherit-csrf": token };
  return { body, headers, nonceHash };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: accountId } } });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: accountId, session_id: sessionId } } });
  mocks.rpc.mockResolvedValue({ data: receipt, error: null });
});
function send(body: unknown, headers: Record<string, string>) {
  return ownUploadConsent(new Request("https://inherit.bio/api/consents", { method: "POST", headers }), body);
}
describe("own-account consent signing route", () => {
  it("passes only verified session/artifact/revision values and the nonce digest to the atomic signer", async () => {
    const { body, headers, nonceHash } = requestCase();
    const res = await send(body, headers);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(receipt);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("sign_own_upload_artifact_v1", {
      p_account_id: accountId, p_session_id: sessionId, p_subject_id: subjectId,
      p_artifact_key: input.artifactKey, p_artifact_version: 1, p_artifact_body_sha256: input.artifactBodySha256,
      p_statement_keys: ["own-adult-dna"], p_account_revision: 2, p_auth_session_revision: 3,
      p_jurisdiction_revision: 4, p_subject_binding_revision: 5, p_nonce_hash: nonceHash,
    });
  });
  it.each(["origin", "sec-fetch-site", "x-inherit-csrf"])("requires the same-origin %s signal", async (name) => {
    const { body, headers } = requestCase();
    const modified: Record<string, string> = { ...headers }; delete modified[name];
    expect((await send(body, modified)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["accountId", "sessionId", "subjectId"] as const)("rejects a correctly signed foreign %s", async (key) => {
    const { body, headers } = requestCase({ ...input, [key]: receipt.recordId });
    expect((await send(body, headers)).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects a valid user's mismatched JWT subject", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: receipt.recordId, session_id: sessionId } } });
    const { body, headers } = requestCase();
    expect((await send(body, headers)).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses typed-name, signer overrides, extra keys and false affirmation before database access", async () => {
    const { body, headers } = requestCase();
    for (const patch of [{ signerId: accountId }, { typedName: "Test User" }, { affirmed: false }, { subjectKind: "self" }]) {
      expect((await send({ ...body, ...patch }, headers)).status).toBe(422);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["42501", "not_found", 404], ["23505", "duplicate", 404],
    ["55000", "adult_account_required", 409], ["55000", "consent_artifact_changed", 409],
    ["55000", "insurance_acknowledgement_required", 409], ["22023", "invalid_request", 422],
    ["XX000", "private details must not escape", 503],
  ])("normalizes database refusal %s/%s", async (code, message, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message } });
    const { body, headers } = requestCase(); const res = await send(body, headers);
    expect(res.status).toBe(status);
    expect(await res.text()).not.toContain("private details");
  });
  it.each([null, { ...receipt, token: "must not escape" }, { ...receipt, signedAt: "not-a-time" },
    { ...receipt, artifactKey: "consent.upload-other-adult" }])("refuses an open or inconsistent database receipt", async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    const { body, headers } = requestCase(); const res = await send(body, headers);
    expect(res.status).toBe(503); expect(await res.json()).toEqual({ error: "unavailable" });
  });
});
