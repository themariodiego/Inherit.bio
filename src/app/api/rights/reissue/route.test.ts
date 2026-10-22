import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), admin: vi.fn(), floor: vi.fn(), open: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/rights/reissue-gate", () => ({ rightsReissueOpen: mocks.open }));
vi.mock("@/lib/auth/auth-response", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/auth-response")>()),
  afterFloor: mocks.floor,
}));

const route = await import("./route");
const { mintAuthForm, sha256Hex } = await import("@/lib/auth/auth-form");
const { AUTH_FORM_COOKIE } = await import("@/lib/auth/auth-cookies");
const { readPublicFormToken } = await import("@/lib/embryos/operation-token");
const { contactDigestSet } = await import("@/lib/hmac-keyring");
const gate = await vi.importActual<typeof import("@/lib/rights/reissue-gate")>("@/lib/rights/reissue-gate");

/**
 * `POST /api/rights/reissue` (register api.rights-reissue). Closed under the
 * owner's 2026-10-22 rule for unapproved mail text; the cases behind the
 * door run with the gate stubbed open, to prove the form and body handling
 * is ready. The database is a stub; every value is synthetic.
 */

const ORIGIN = "https://inherit.bio";
const EMAIL = "someone@e2e.local";
const cookieValue = (setCookie: string) => setCookie.slice(setCookie.indexOf("=") + 1, setCookie.indexOf(";"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
  vi.stubEnv("INHERIT_HMAC_KEYRING", "");
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: "received", error: null });
  mocks.floor.mockResolvedValue(undefined);
  mocks.open.mockReturnValue(false);
});
afterEach(() => vi.unstubAllEnvs());

function reissue(body: unknown, options: { headers?: Record<string, string>; form?: ReturnType<typeof mintAuthForm> } = {}) {
  const form = options.form ?? mintAuthForm("rights-reissue");
  return new Request(`${ORIGIN}/api/rights/reissue`, {
    method: "POST",
    headers: {
      origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", "x-real-ip": "198.51.100.4",
      "x-inherit-csrf": form.formToken, cookie: `${AUTH_FORM_COOKIE}=${cookieValue(form.setCookie)}`, ...options.headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/rights/reissue", () => {
  it("is closed: the gate is shut, and every request answers resource-not-found-v1 with nothing read or written", async () => {
    expect(gate.rightsReissueOpen()).toBe(false);
    mocks.open.mockImplementation(gate.rightsReissueOpen);
    const response = await route.POST(reissue({ email: EMAIL }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.floor).not.toHaveBeenCalled();
  });

  describe("behind the door (gate stubbed open)", () => {
    beforeEach(() => mocks.open.mockReturnValue(true));

    it("counts and looks up in the database with digests only, and answers opaque-public-acceptance-v1", async () => {
      const form = mintAuthForm("rights-reissue");
      const response = await route.POST(reissue({ email: ` ${EMAIL.toUpperCase()} ` }, { form }));
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ status: "received" });
      expect(mocks.floor).toHaveBeenCalledTimes(1);
      const [name, args] = mocks.rpc.mock.calls[0];
      expect(name).toBe("request_rights_reissue_v1");
      expect(Object.keys(args).sort()).toEqual(["p_contact_digests", "p_form_nonce_hash", "p_global_digests",
        "p_identifier_digests", "p_network_digests", "p_test_jurisdiction"]);
      const claims = readPublicFormToken(form.formToken, "rights-reissue", Date.now(), sha256Hex(cookieValue(form.setCookie)));
      expect(args.p_form_nonce_hash).toBe(sha256Hex(claims!.nonce));
      expect(args.p_contact_digests).toEqual(contactDigestSet(EMAIL));
      expect(JSON.stringify(args)).not.toContain(EMAIL);
      expect(args.p_test_jurisdiction).toBe(true);
    });

    it("answers match, no match, limited and failure identically", async () => {
      const bodies = [];
      for (const outcome of [{ data: "received", error: null }, { data: null, error: { code: "55000" } }]) {
        mocks.rpc.mockResolvedValueOnce(outcome);
        const response = await route.POST(reissue({ email: EMAIL }));
        bodies.push([response.status, await response.text(), response.headers.get("cache-control")]);
      }
      mocks.rpc.mockRejectedValueOnce(new Error("offline"));
      const failed = await route.POST(reissue({ email: EMAIL }));
      bodies.push([failed.status, await failed.text(), failed.headers.get("cache-control")]);
      expect(new Set(bodies.map(b => JSON.stringify(b))).size).toBe(1);
    });

    it("refuses a missing signal, another form, a replayed nonce and a bad body with invalid-request-v1", async () => {
      expect((await route.POST(reissue({ email: EMAIL }, { headers: { "x-inherit-csrf": "" } }))).status).toBe(422);
      expect((await route.POST(reissue({ email: EMAIL }, { headers: { origin: "https://elsewhere.example" } }))).status).toBe(422);
      expect((await route.POST(reissue({ email: EMAIL }, { headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(422);
      expect((await route.POST(reissue({ email: EMAIL }, { form: mintAuthForm("auth-forgot-password") }))).status).toBe(422);
      expect(mocks.rpc).not.toHaveBeenCalled();
      mocks.rpc.mockResolvedValueOnce({ data: "replayed", error: null });
      const replayed = await route.POST(reissue({ email: EMAIL }));
      expect(replayed.status).toBe(422);
      expect(await replayed.json()).toEqual({ error: "invalid_request", issues: ["csrf"] });
      mocks.rpc.mockClear();
      for (const body of [{ email: "not-an-address" }, { email: EMAIL, purpose: "adult-subject-control" }, { subjectId: "x" }]) {
        expect((await route.POST(reissue(body))).status).toBe(422);
      }
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it("answers resource-not-found-v1 outside TEST-LOCAL", async () => {
      vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
      expect((await route.POST(reissue({ email: EMAIL }))).status).toBe(404);
      expect(mocks.rpc).not.toHaveBeenCalled();
    });
  });
});
