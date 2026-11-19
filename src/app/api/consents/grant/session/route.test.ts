import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

const { POST } = await import("./route");
const { mintAdultSubjectControlForm } = await import("@/lib/uploads/adult-subject-control");
const { mintGrantRightsPresentation } = await import("@/lib/uploads/grant-rights-presentation");
const { RIGHTS_COOKIE_NAME, newRightsSessionSecret, rightsSessionHash } = await import("@/lib/embryos/rights-session");
afterAll(() => vi.unstubAllEnvs());

const ORIGIN = "http://localhost";
const PERSON = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UPLOADER_PRINCIPAL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UPLOADER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GRANT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SHA = "a".repeat(64);
const STATEMENTS = ["one-purpose", "one-named-adult", "own-account", "pause-or-stop-any-time"];

let secret: string;

function presentation(overrides: Record<string, unknown> = {}, sessionHash = rightsSessionHash(secret)) {
  return mintGrantRightsPresentation({
    sessionHash, principalId: PERSON, uploaderPrincipalId: UPLOADER_PRINCIPAL, uploaderAccountId: UPLOADER,
    subjectBindingRevision: 2, relationshipId: null, relationshipRevision: null, purpose: "ancestry",
    artifactKey: "consent.share-with-adult", artifactVersion: 1, artifactBodySha256: SHA, ...overrides,
  } as Parameters<typeof mintGrantRightsPresentation>[0]).token;
}

function grantBody(overrides: Record<string, unknown> = {}) {
  return {
    purposeKey: "ancestry", artifactVersion: 1, artifactPresentationToken: presentation(), affirmed: true,
    statementKeys: STATEMENTS, typedName: "Synthetic Person", jurisdictionCode: "GB",
    jurisdictionAffirmed: true, nonce: mintAdultSubjectControlForm(rightsSessionHash(secret)), ...overrides,
  };
}

function call(body: unknown, options: { origin?: string | null; cookie?: string | null } = {}) {
  const headers = new Headers({ "content-type": "application/json", "sec-fetch-site": "same-origin" });
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const cookie = options.cookie === undefined ? `${RIGHTS_COOKIE_NAME}=${secret}` : options.cookie;
  if (cookie !== null) headers.set("cookie", cookie);
  return POST(new Request(`${ORIGIN}/api/consents/grant/session`, { method: "POST", headers, body: JSON.stringify(body) }));
}

const RECEIPT = {
  recordKind: "purpose_grant", recordId: GRANT, artifactKey: "consent.share-with-adult", artifactVersion: 1,
  purposeKey: "ancestry", signedAt: "2026-10-16T12:00:00.000+00:00",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  secret = newRightsSessionSecret();
  mocks.rpc.mockResolvedValue({ data: RECEIPT, error: null });
});

describe("POST /api/consents/grant/session", () => {
  it("records one purpose grant and answers consent-recorded-v1", async () => {
    const response = await call(grantBody());
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ...RECEIPT, signedAt: "2026-10-16T12:00:00.000Z" });
  });

  it("hands the database the session, the presentation's ten values and the person's own signature, nothing from the body that could retarget", async () => {
    await call(grantBody());
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("grant_purpose_rights_v1");
    expect(args.p_session_hash).toBe(rightsSessionHash(secret));
    expect(Object.keys(args.p_presentation).sort()).toEqual(["artifactBodySha256", "artifactVersion", "nonce", "principalId",
      "purpose", "relationshipId", "relationshipRevision", "subjectBindingRevision", "uploaderAccountId", "uploaderPrincipalId"]);
    expect(args.p_presentation).toMatchObject({ principalId: PERSON, uploaderAccountId: UPLOADER, purpose: "ancestry" });
    expect(args.p_statement_keys).toEqual(STATEMENTS);
    expect(args.p_signing_name_ciphertext).toMatch(/^\\x[0-9a-f]+$/);
    expect(args.p_signing_name_ciphertext).not.toContain(Buffer.from("Synthetic Person").toString("hex"));
    expect(Object.keys(args).sort()).toEqual(["p_jurisdiction_code", "p_nonce", "p_presentation", "p_session_hash",
      "p_signing_name_ciphertext", "p_statement_keys", "p_test_jurisdiction"]);
    expect(args).toMatchObject({ p_jurisdiction_code: "GB", p_test_jurisdiction: true });
  });

  it("is the same 404 outside the test jurisdiction", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    expect((await call(grantBody())).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses every forbidden field, mismatch and stale value with the same 404 and no database call", async () => {
    const cases: [string, unknown, { origin?: string | null; cookie?: string | null }?][] = [
      ["subjectId", grantBody({ subjectId: PERSON })],
      ["recipientAccountId", grantBody({ recipientAccountId: UPLOADER })],
      ["grants", grantBody({ grants: [] })],
      ["approval", grantBody({ approval: true })],
      ["family purpose", grantBody({ purposeKey: "family.portrait" })],
      ["purpose mismatch", grantBody({ purposeKey: "reports.monogenic" })],
      ["version mismatch", grantBody({ artifactVersion: 2 })],
      ["another session's presentation", grantBody({ artifactPresentationToken: presentation({}, rightsSessionHash(newRightsSessionSecret())) })],
      ["forged presentation", grantBody({ artifactPresentationToken: `${presentation().split(".")[0]}.${"0".repeat(64)}` })],
      ["statements", grantBody({ statementKeys: STATEMENTS.slice(0, 3) })],
      ["one-word name", grantBody({ typedName: "Synthetic" })],
      ["unknown country", grantBody({ jurisdictionCode: "QQ" })],
      ["attestation fields (recorded divergence: not served)", grantBody({ jurisdictionAttestationVersion: 2,
        jurisdictionAttestationHash: "c".repeat(64) })],
      ["not affirmed", grantBody({ affirmed: false })],
      ["jurisdiction not affirmed", grantBody({ jurisdictionAffirmed: false })],
      ["another origin", grantBody(), { origin: "https://elsewhere.example" }],
      ["no cookie", grantBody(), { cookie: null }],
    ];
    for (const [label, value, options] of cases) {
      const response = await call(value, options);
      expect(response.status, label).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers 404 for every database refusal and any receipt that does not match the presentation", async () => {
    for (const result of [
      { data: null, error: { code: "42501", message: "not_found" } },
      { data: null, error: { code: "23505", message: "operation nonce already used" } },
      { data: { ...RECEIPT, purposeKey: "reports.monogenic" }, error: null },
      { data: { ...RECEIPT, recipientAccountId: UPLOADER }, error: null },
    ]) {
      mocks.rpc.mockResolvedValueOnce(result);
      const response = await call(grantBody());
      expect(response.status).toBe(404);
    }
  });
});
