import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

const { POST } = await import("./route");
const { mintAdultSubjectControlForm } = await import("@/lib/uploads/adult-subject-control");
const { RIGHTS_COOKIE_NAME, newRightsSessionSecret, rightsSessionHash } = await import("@/lib/embryos/rights-session");
const { mintPublicFormToken } = await import("@/lib/embryos/operation-token");
afterAll(() => vi.unstubAllEnvs());

const ORIGIN = "http://localhost";
const SUBJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let secret: string;

function call(options: {
  body?: unknown; origin?: string | null; site?: string | null; cookie?: string | null; url?: string; contentType?: string;
} = {}) {
  const headers = new Headers({ "content-type": options.contentType ?? "application/json" });
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const site = options.site === undefined ? "same-origin" : options.site;
  if (site !== null) headers.set("sec-fetch-site", site);
  const cookie = options.cookie === undefined ? `${RIGHTS_COOKIE_NAME}=${secret}` : options.cookie;
  if (cookie !== null) headers.set("cookie", cookie);
  const body = options.body ?? { purposeKey: "ancestry", nonce: mintAdultSubjectControlForm(rightsSessionHash(secret)) };
  return POST(new Request(options.url ?? `${ORIGIN}/api/consents/revoke/session`, {
    method: "POST", headers, body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  secret = newRightsSessionSecret();
  mocks.rpc.mockResolvedValue({ data: "accepted", error: null });
});

describe("POST /api/consents/revoke/session", () => {
  it("revokes one purpose through the session and answers lifecycle-accepted-v1", async () => {
    const response = await call();
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("revoke_purpose_rights_v1");
    expect(Object.keys(args).sort()).toEqual(["p_nonce", "p_purpose", "p_session_hash", "p_test_jurisdiction"]);
    expect(args).toMatchObject({ p_session_hash: rightsSessionHash(secret), p_purpose: "ancestry", p_test_jurisdiction: true });
  });

  it("takes each of the four individual purposes and nothing else", async () => {
    for (const purposeKey of ["reports.monogenic", "reports.polygenic", "ancestry", "copilot.local"]) {
      const response = await call({ body: { purposeKey, nonce: mintAdultSubjectControlForm(rightsSessionHash(secret)) } });
      expect(response.status).toBe(202);
    }
    for (const purposeKey of ["family.portrait", "family.heritability", "export.share-link", "copilot.cloud", "raw.export"]) {
      const response = await call({ body: { purposeKey, nonce: mintAdultSubjectControlForm(rightsSessionHash(secret)) } });
      expect(response.status, purposeKey).toBe(404);
    }
    expect(mocks.rpc).toHaveBeenCalledTimes(4);
  });

  it("is the same 404 outside the test jurisdiction", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    const response = await call();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses every forbidden field, missing signal and foreign form with the same 404 and no database call", async () => {
    const nonce = () => mintAdultSubjectControlForm(rightsSessionHash(secret));
    const cases = [
      { body: { purposeKey: "ancestry", nonce: nonce(), subjectId: SUBJECT } },
      { body: { purposeKey: "ancestry", nonce: nonce(), grantId: SUBJECT } },
      { body: { purposeKey: "ancestry", nonce: nonce(), recipientAccountId: SUBJECT } },
      { body: { purposeKey: "ancestry", nonce: nonce(), jurisdiction: "GB" } },
      { body: { purposeKey: "ancestry" } },
      { body: { purposeKey: "ancestry", nonce: mintAdultSubjectControlForm(rightsSessionHash(newRightsSessionSecret())) } },
      { body: { purposeKey: "ancestry", nonce: mintPublicFormToken("adult-subject-respond", Date.now(), rightsSessionHash(secret)) } },
      { origin: "https://elsewhere.example" }, { origin: null }, { site: "cross-site" }, { cookie: null },
      { cookie: `${RIGHTS_COOKIE_NAME}=${secret}; ${RIGHTS_COOKIE_NAME}=${secret}` },
      { url: `${ORIGIN}/api/consents/revoke/session?subject=${SUBJECT}` }, { contentType: "text/plain" },
    ];
    for (const options of cases) {
      const response = await call(options);
      expect(response.status, JSON.stringify(options)).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers 404 for every database refusal", async () => {
    for (const result of [
      { data: null, error: { code: "42501", message: "not_found" } },
      { data: null, error: { code: "23505", message: "operation nonce already used" } },
      { data: "unavailable", error: null },
    ]) {
      mocks.rpc.mockResolvedValueOnce(result);
      const response = await call();
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
  });
});
