import crypto from "node:crypto";
import { bcryptVerify } from "hash-wasm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

const route = await import("./route");
const { newResetSession } = await import("@/lib/auth/reset-session");
const { AUTH_FORM_COOKIE, PKCE_COOKIE, RESET_CSRF_COOKIE, RESET_SESSION_COOKIE } = await import("@/lib/auth/auth-cookies");

/**
 * `POST /api/auth/reset-password` (register auth.reset-password-submit),
 * under the reset session (authContracts.reset-session-api-v1). The database
 * is a stub; every value is synthetic.
 */

const ORIGIN = "https://inherit.bio";
const PASSWORD = "a-synthetic-new-password";
const cookieValue = (setCookie: string) => setCookie.slice(setCookie.indexOf("=") + 1, setCookie.indexOf(";"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: "reset", error: null });
});
afterEach(() => vi.unstubAllEnvs());

function reset(body: unknown, options: { raw?: string; headers?: Record<string, string>; session?: ReturnType<typeof newResetSession>; extraCookies?: string } = {}) {
  const session = options.session ?? newResetSession();
  const secret = cookieValue(session.setCookies[0]!);
  const csrf = cookieValue(session.setCookies[1]!);
  return new Request(`${ORIGIN}/api/auth/reset-password`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-inherit-csrf": csrf,
      cookie: [`${RESET_SESSION_COOKIE}=${secret}`, `${RESET_CSRF_COOKIE}=${csrf}`, options.extraCookies].filter(Boolean).join("; "),
      ...options.headers,
    },
    body: options.raw ?? JSON.stringify(body),
  });
}

describe("POST /api/auth/reset-password (auth.reset-password-submit)", () => {
  it("exports POST alone", () => {
    expect(Object.keys(route).filter((name) => /^[A-Z]+$/.test(name))).toEqual(["POST"]);
  });

  it("stores only a bcrypt hash of the new password, in the one reset transaction, and answers 204", async () => {
    const session = newResetSession();
    const response = await route.POST(reset({ password: PASSWORD }, { session }));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledOnce();
    const [name, args] = mocks.rpc.mock.calls[0]! as [string, { p_session_hash: string; p_password_hash: string }];
    expect(name).toBe("reset_password_with_recovery_v1");
    expect(args.p_session_hash).toBe(session.sessionHash);
    expect(args.p_password_hash).toMatch(/^\$2a\$10\$[./A-Za-z0-9]{53}$/);
    expect(JSON.stringify(args)).not.toContain(PASSWORD);
    expect(await bcryptVerify({ password: PASSWORD, hash: args.p_password_hash })).toBe(true);
  });

  it("clears every auth cookie the browser holds, so the person signs in again", async () => {
    const response = await route.POST(reset({ password: PASSWORD }, {
      extraCookies: "sb-127-auth-token=base64-synthetic; sb-127-auth-token.1=chunk; sb-127-auth-token-code-verifier=v; " +
        "inherit_family_gate=g; inherit_embryo_gate=g; theme=dark",
    }));
    expect(response.status).toBe(204);
    const cleared = response.headers.getSetCookie().map((line) => ({ name: line.slice(0, line.indexOf("=")), line }));
    expect(cleared.map((cookie) => cookie.name).sort()).toEqual([
      AUTH_FORM_COOKIE, PKCE_COOKIE, RESET_CSRF_COOKIE, RESET_SESSION_COOKIE,
      "inherit_embryo_gate", "inherit_family_gate",
      "sb-127-auth-token", "sb-127-auth-token-code-verifier", "sb-127-auth-token.1",
    ].sort());
    for (const cookie of cleared) expect(cookie.line).toMatch(/; Max-Age=0(;|$)/);
    expect(cleared.map((cookie) => cookie.name)).not.toContain("theme");
  });

  it.each([
    ["another origin", { origin: "https://elsewhere.invalid" }],
    ["cross-site fetch metadata", { "sec-fetch-site": "cross-site" }],
    ["no CSRF value", { "x-inherit-csrf": "" }],
    ["another session's CSRF value", { "x-inherit-csrf": "0".repeat(64) }],
    ["no reset cookie", { cookie: "" }],
    ["form-encoded data", { "content-type": "application/x-www-form-urlencoded" }],
  ])("is resource-not-found-v1 with %s, before the body or the database", async (_label, headers) => {
    const response = await route.POST(reset({ password: PASSWORD }, { headers }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("refuses a CSRF value presented with another browser's session cookie", async () => {
    const mine = newResetSession();
    const theirs = newResetSession();
    const request = reset({ password: PASSWORD }, { session: theirs, headers: { "x-inherit-csrf": cookieValue(mine.setCookies[1]!) } });
    expect((await route.POST(request)).status).toBe(404);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "{"],
    ["an extra field", JSON.stringify({ password: PASSWORD, email: "someone@e2e.local" })],
    ["no password", JSON.stringify({})],
    ["a non-string password", JSON.stringify({ password: 123456789012 })],
  ])("is resource-not-found-v1 for %s (unknownMissingOrInvalid)", async (_label, raw) => {
    const response = await route.POST(reset(null, { raw }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each([
    ["11 characters", "a".repeat(11)],
    ["73 characters", "a".repeat(73)],
    ["73 bytes", `${"€".repeat(24)}a`],
  ])("is invalid-request-v1 password for %s, only after the session authorized it", async (_label, password) => {
    const response = await route.POST(reset({ password }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["password"] });
    expect(mocks.admin).not.toHaveBeenCalled();
    // Without the session, the same body is the opaque 404.
    const unauthorized = await route.POST(reset({ password }, { headers: { cookie: "" } }));
    expect(unauthorized.status).toBe(404);
  });

  it("is resource-not-found-v1 for a missing, expired, used or replaced session, and clears nothing", async () => {
    for (const error of [{ code: "42501", message: "not_found" }, { code: "22023", message: "auth reset invalid" }, { code: "XX000" }]) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error });
      const response = await route.POST(reset({ password: PASSWORD }));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    mocks.rpc.mockResolvedValueOnce({ data: "something-else", error: null });
    expect((await route.POST(reset({ password: PASSWORD }))).status).toBe(404);
  });
});
