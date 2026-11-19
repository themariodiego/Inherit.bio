import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const mocks = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn(), capability: vi.fn(), test: vi.fn() }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/family/access", () => ({ familyCapability: mocks.capability }));
vi.mock("@/lib/legal/jurisdictions", async (load) => ({
  ...await load<typeof import("@/lib/legal/jurisdictions")>(), isTestJurisdictionEnabled: mocks.test,
}));

const { POST } = await import("./route");
const { mintReaffirmPresentation } = await import("@/lib/consents/reaffirm-presentation");
type Offer = Parameters<typeof mintReaffirmPresentation>[0]["offer"];
afterAll(() => vi.unstubAllEnvs());

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PRIOR = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NEW = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ORIGIN = "http://localhost";

const OWN: Offer = {
  kind: "own-report", grantFunction: "grant_own_report_purpose_v1", priorGrantId: PRIOR, priorRevision: 1,
  priorArtifactVersion: 2, purpose: "reports.monogenic", direction: "self", pathBDirection: null, subjectId: OTHER,
  signerPrincipalId: OTHER, recipientPrincipalId: OTHER, recipientAccountId: ACCOUNT, relationshipId: null, pairId: null,
  relationshipOrPairRevision: 1, subjectBindingRevision: 1, jurisdictionRevision: 1, artifactKey: "consent.own-monogenic",
  artifactVersion: 3, artifactBodySha256: "a".repeat(64), statementKeys: ["make-this-result-for-me"],
  context: { principalId: OTHER }, endpointReceipt: null,
};
const FAMILY: Offer = { ...OWN, kind: "family", grantFunction: "grant_family_report_purpose_v1", direction: "subject_to_recipient",
  recipientAccountId: OTHER, artifactKey: "consent.share-with-adult", context: null, endpointReceipt: "b".repeat(64),
  statementKeys: ["one-purpose", "one-named-adult", "own-account", "pause-or-stop-any-time"] };
const PATH_B: Offer = { ...OWN, kind: "path-b", grantFunction: "grant_path_b_purpose_v1", pathBDirection: "self" };

function token(offer: Offer = OWN, account = ACCOUNT, session = SESSION) {
  return mintReaffirmPresentation({ accountId: account, sessionId: session, offer });
}
function bodyFor(offer: Offer = OWN, overrides: Record<string, unknown> = {}, minted = token(offer)) {
  return { priorConsentId: PRIOR, artifactVersion: offer.artifactVersion, artifactPresentationToken: minted.token,
    affirmed: true, statementKeys: [...offer.statementKeys], ...overrides };
}
function call(body: unknown, origin: string | null = ORIGIN) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin !== null) headers.set("origin", origin);
  return POST(new Request(`${ORIGIN}/api/consents/reaffirm`, { method: "POST", headers, body: JSON.stringify(body) }));
}
function receipt(offer: Offer = OWN) {
  return { recordKind: "purpose_grant", recordId: NEW, artifactKey: offer.artifactKey, artifactVersion: offer.artifactVersion,
    purposeKey: offer.purpose, signedAt: "2026-10-22T10:00:00.000Z" };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor.mockResolvedValue({ accountId: ACCOUNT, sessionId: SESSION });
  mocks.rpc.mockResolvedValue({ data: receipt(), error: null });
  mocks.capability.mockResolvedValue({ status: "permitted" });
  mocks.test.mockReturnValue(false);
});

describe("POST /api/consents/reaffirm", () => {
  it("re-runs the prior grant through the database with the token's exact offer and answers consent-recorded-v1", async () => {
    const minted = token();
    const response = await call(bodyFor(OWN, {}, minted));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(receipt());
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("reaffirm_purpose_grant_v1");
    expect(args).toEqual({ p_account_id: ACCOUNT, p_session_id: SESSION, p_prior_grant_id: PRIOR, p_offer: OWN,
      p_nonce: minted.claims.nonce, p_expires_at: new Date(minted.claims.expiresAt).toISOString(), p_test_jurisdiction: false });
    expect(mocks.capability).not.toHaveBeenCalled();
  });

  it("refuses a signed-out request and a foreign origin before anything else", async () => {
    mocks.actor.mockResolvedValueOnce(null);
    expect((await call(bodyFor())).status).toBe(401);
    expect((await call(bodyFor(), "https://elsewhere.example")).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses every forbidden field and a typed name with invalid-request-v1", async () => {
    for (const field of ["artifactKey", "purposeKey", "bodySha256", "signerId", "subjectId", "accountId", "jurisdiction", "approval"]) {
      const response = await call(bodyFor(OWN, { [field]: "x" }));
      expect(response.status, field).toBe(422);
    }
    const typed = await call(bodyFor(OWN, { typedName: "Synthetic Person" }));
    expect(typed.status).toBe(422);
    expect(await typed.json()).toEqual({ error: "invalid_request", issues: ["typedName"] });
    expect((await call(bodyFor(OWN, { affirmed: false }))).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers resource-not-found-v1 for a token of another account, session, prior row or version", async () => {
    expect((await call(bodyFor(OWN, {}, token(OWN, OTHER)))).status).toBe(404);
    expect((await call(bodyFor(OWN, {}, token(OWN, ACCOUNT, OTHER)))).status).toBe(404);
    expect((await call(bodyFor(OWN, { priorConsentId: NEW }))).status).toBe(404);
    expect((await call(bodyFor(OWN, { artifactVersion: 2 }))).status).toBe(404);
    const forged = token().token.replace(/.$/, c => (c === "0" ? "1" : "0"));
    expect((await call(bodyFor(OWN, { artifactPresentationToken: forged }))).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires exactly the published statements", async () => {
    const response = await call(bodyFor(OWN, { statementKeys: ["something-else"] }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["statementKeys"] });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("checks a family purpose as api.consents does, and answers not found when it is not permitted", async () => {
    mocks.rpc.mockResolvedValue({ data: receipt(FAMILY), error: null });
    expect((await call(bodyFor(FAMILY))).status).toBe(201);
    expect(mocks.capability).toHaveBeenCalledWith(ACCOUNT, [OTHER], "third_party_adult_analysis");
    mocks.rpc.mockClear();
    mocks.capability.mockResolvedValue({ status: "denied" });
    expect((await call(bodyFor(FAMILY))).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers a Path B grant only under TEST-LOCAL", async () => {
    expect((await call(bodyFor(PATH_B))).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.test.mockReturnValue(true);
    expect((await call(bodyFor(PATH_B))).status).toBe(201);
    expect(mocks.rpc.mock.calls[0][1].p_test_jurisdiction).toBe(true);
  });

  it("maps database refusals without leaking which check failed", async () => {
    for (const code of ["42501", "23505", "55000"]) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code } });
      expect((await call(bodyFor())).status, code).toBe(404);
    }
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "22023" } });
    expect((await call(bodyFor())).status).toBe(422);
    mocks.rpc.mockResolvedValueOnce({ data: { ...receipt(), artifactVersion: 2 }, error: null });
    expect((await call(bodyFor())).status).toBe(503);
    mocks.rpc.mockResolvedValueOnce({ data: { ...receipt(), extra: true }, error: null });
    expect((await call(bodyFor())).status).toBe(503);
  });
});
