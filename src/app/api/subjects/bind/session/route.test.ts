import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), context: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/account-deletion", async (load) => ({
  ...await load<typeof import("@/lib/account-deletion")>(), getSensitiveAccountContext: mocks.context,
}));

const { POST } = await import("./route");
const { mintAdultSubjectControlForm } = await import("@/lib/uploads/adult-subject-control");
const { mintConsentReaffirmRightsForm } = await import("@/lib/consents/reaffirm-rights");
const { RIGHTS_COOKIE_NAME, newRightsSessionSecret, rightsSessionHash } = await import("@/lib/embryos/rights-session");
afterAll(() => vi.unstubAllEnvs());

const ORIGIN = "http://localhost";
const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUBJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BOUND = { status: "account_bound", subjectId: SUBJECT, next: "review_purposes_and_optionally_transfer_ownership" };

let secret: string;
function call(body: unknown, options: { origin?: string | null; cookie?: string | null } = {}) {
  const headers = new Headers({ "content-type": "application/json", "sec-fetch-site": "same-origin" });
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const cookie = options.cookie === undefined ? `${RIGHTS_COOKIE_NAME}=${secret}` : options.cookie;
  if (cookie !== null) headers.set("cookie", cookie);
  return POST(new Request(`${ORIGIN}/api/subjects/bind/session`, { method: "POST", headers, body: JSON.stringify(body) }));
}
const form = () => mintAdultSubjectControlForm(rightsSessionHash(secret));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  secret = newRightsSessionSecret();
  mocks.context.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
  mocks.rpc.mockResolvedValue({ data: BOUND, error: null });
});

describe("POST /api/subjects/bind/session (built closed)", () => {
  it("binds through the database with the session, its nonce and the signed-in account, and answers adult-subject-bound-v1", async () => {
    const response = await call({ nonce: form() });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(BOUND);
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("bind_adult_subject_account_v1");
    expect(Object.keys(args).sort()).toEqual(["p_account_id", "p_auth_session_id", "p_nonce", "p_session_hash", "p_test_jurisdiction"]);
    expect(args).toMatchObject({ p_session_hash: rightsSessionHash(secret), p_account_id: ACCOUNT, p_auth_session_id: SESSION,
      p_test_jurisdiction: true });
  });

  it("answers resource-not-found-v1 for every database refusal: the session purpose has no issuer", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    const response = await call({ nonce: form() });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("answers not found outside TEST-LOCAL, and 401 when signed out", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    expect((await call({ nonce: form() })).status).toBe(404);
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
    mocks.context.mockResolvedValue(null);
    expect((await call({ nonce: form() })).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses every forbidden field, another form, another session, a foreign origin and two rights cookies", async () => {
    for (const field of ["subjectId", "accountId", "ownerId", "principalId", "contactEmail", "jurisdictionCode",
      "transferOwnership", "objectPath"]) {
      expect((await call({ nonce: form(), [field]: "x" })).status, field).toBe(404);
    }
    expect((await call({ nonce: mintConsentReaffirmRightsForm(rightsSessionHash(secret)) })).status).toBe(404);
    expect((await call({ nonce: mintAdultSubjectControlForm(rightsSessionHash(newRightsSessionSecret())) })).status).toBe(404);
    expect((await call({ nonce: form() }, { origin: "https://elsewhere.example" })).status).toBe(404);
    expect((await call({ nonce: form() }, { cookie: `${RIGHTS_COOKIE_NAME}=${secret}; ${RIGHTS_COOKIE_NAME}=${secret}` })).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a body the closed shape does not allow", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...BOUND, ownerId: ACCOUNT }, error: null });
    expect((await call({ nonce: form() })).status).toBe(404);
  });
});
