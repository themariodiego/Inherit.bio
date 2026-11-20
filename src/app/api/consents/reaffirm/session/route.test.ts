import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
// The one-time X-Inherit-CSRF gate is driven on this route by
// src/lib/security/session-csrf-routes.test.ts; here it admits every request.
vi.mock("@/lib/security/session-csrf", async (importOriginal) =>
  (await import("@/lib/security/session-csrf.test-support")).admitEverySessionCsrf(await importOriginal()));

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

const { POST } = await import("./route");
const { mintConsentReaffirmRightsForm, mintReaffirmRightsPresentation } = await import("@/lib/consents/reaffirm-rights");
const { mintAdultSubjectControlForm } = await import("@/lib/uploads/adult-subject-control");
const { RIGHTS_COOKIE_NAME, newRightsSessionSecret, rightsSessionHash } = await import("@/lib/embryos/rights-session");
afterAll(() => vi.unstubAllEnvs());

const ORIGIN = "http://localhost";
const PERSON = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UPLOADER_PRINCIPAL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UPLOADER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GRANT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PRIOR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const RELATIONSHIP = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const SHA = "a".repeat(64);
const STATEMENTS = ["one-purpose", "one-named-adult", "own-account", "pause-or-stop-any-time"];

let secret: string;

function minted(sessionHash = rightsSessionHash(secret)) {
  return mintReaffirmRightsPresentation({
    sessionHash, priorGrantId: PRIOR, priorRevision: 1, principalId: PERSON, uploaderPrincipalId: UPLOADER_PRINCIPAL,
    uploaderAccountId: UPLOADER, relationshipId: RELATIONSHIP, relationshipRevision: 1, subjectBindingRevision: 2,
    purpose: "ancestry", artifactKey: "consent.share-with-adult", artifactVersion: 2, artifactBodySha256: SHA,
  });
}

function reaffirmBody(overrides: Record<string, unknown> = {}, presentation = minted()) {
  return {
    artifactVersion: 2, artifactPresentationToken: presentation.token, affirmed: true, statementKeys: STATEMENTS,
    typedName: "Synthetic Person", jurisdictionCode: "GB", jurisdictionAffirmed: true,
    nonce: mintConsentReaffirmRightsForm(rightsSessionHash(secret)), ...overrides,
  };
}

function call(body: unknown, options: { origin?: string | null; cookie?: string | null } = {}) {
  const headers = new Headers({ "content-type": "application/json", "sec-fetch-site": "same-origin" });
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const cookie = options.cookie === undefined ? `${RIGHTS_COOKIE_NAME}=${secret}` : options.cookie;
  if (cookie !== null) headers.set("cookie", cookie);
  return POST(new Request(`${ORIGIN}/api/consents/reaffirm/session`, { method: "POST", headers, body: JSON.stringify(body) }));
}

const RECEIPT = {
  recordKind: "purpose_grant", recordId: GRANT, artifactKey: "consent.share-with-adult", artifactVersion: 2,
  purposeKey: "ancestry", signedAt: "2026-10-22T12:00:00.000+00:00",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  secret = newRightsSessionSecret();
  mocks.rpc.mockResolvedValue({ data: RECEIPT, error: null });
});

describe("POST /api/consents/reaffirm/session (built closed)", () => {
  it("sends the session, both nonces, the twelve presented values and a ciphertext name, and answers consent-recorded-v1", async () => {
    const presentation = minted();
    const response = await call(reaffirmBody({}, presentation));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ...RECEIPT, signedAt: "2026-10-22T12:00:00.000Z" });
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("reaffirm_purpose_rights_v1");
    expect(args.p_session_hash).toBe(rightsSessionHash(secret));
    expect(Object.keys(args.p_presentation).sort()).toEqual(["artifactBodySha256", "artifactVersion", "nonce", "principalId",
      "priorGrantId", "priorRevision", "purpose", "relationshipId", "relationshipRevision", "subjectBindingRevision",
      "uploaderAccountId", "uploaderPrincipalId"]);
    expect(args.p_presentation.nonce).toBe(presentation.claims.nonce);
    expect(args.p_signing_name_ciphertext).toMatch(/^\\x[0-9a-f]+$/);
    expect(JSON.stringify(args)).not.toContain("Synthetic Person");
    expect(args.p_test_jurisdiction).toBe(true);
  });

  it("answers resource-not-found-v1 for every database refusal: the purpose has no issuer", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    const response = await call(reaffirmBody());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("answers not found outside TEST-LOCAL before anything else", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    expect((await call(reaffirmBody())).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses the attestation fields, any forbidden field, another session's form or presentation, and a bad name or country", async () => {
    const other = rightsSessionHash(newRightsSessionSecret());
    for (const body of [
      reaffirmBody({ jurisdictionAttestationVersion: 1 }), reaffirmBody({ jurisdictionAttestationHash: SHA }),
      reaffirmBody({ priorConsentId: PRIOR }), reaffirmBody({ subjectId: PERSON }), reaffirmBody({ recipientAccountId: UPLOADER }),
      reaffirmBody({ nonce: mintConsentReaffirmRightsForm(other) }),
      reaffirmBody({ nonce: mintAdultSubjectControlForm(rightsSessionHash(secret)) }),
      reaffirmBody({}, minted(other)), reaffirmBody({ artifactVersion: 1 }),
      reaffirmBody({ statementKeys: STATEMENTS.slice(1) }), reaffirmBody({ typedName: "x" }), reaffirmBody({ jurisdictionCode: "ZZ" }),
    ]) expect((await call(body)).status).toBe(404);
    expect((await call(reaffirmBody(), { origin: "https://elsewhere.example" })).status).toBe(404);
    expect((await call(reaffirmBody(), { cookie: `${RIGHTS_COOKIE_NAME}=${secret}; ${RIGHTS_COOKIE_NAME}=${secret}` })).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a receipt that does not match the presentation", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...RECEIPT, purposeKey: "reports.monogenic" }, error: null });
    expect((await call(reaffirmBody())).status).toBe(404);
  });
});
