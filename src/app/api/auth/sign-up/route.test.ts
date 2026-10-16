import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), admin: vi.fn(), fetch: vi.fn(), floor: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/auth/auth-response", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/auth-response")>()),
  afterFloor: mocks.floor,
}));

const route = await import("./route");
const { mintAuthForm } = await import("@/lib/auth/auth-form");
const { AUTH_FORM_COOKIE, PKCE_COOKIE } = await import("@/lib/auth/auth-cookies");

/**
 * `POST /api/auth/sign-up` (register auth.sign-up-submit). The database and
 * the auth service are stubs; every value is synthetic.
 */

const ORIGIN = "https://inherit.bio";
const ADDRESS = "203.0.113.9";
const EMAIL = "new-person@e2e.local";
const PASSWORD = "a-synthetic-sign-up-password";
const cookieValue = (setCookie: string) => setCookie.slice(setCookie.indexOf("=") + 1, setCookie.indexOf(";"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
  vi.stubEnv("INHERIT_HMAC_KEYRING", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: "admitted", error: null });
  mocks.fetch.mockResolvedValue(Response.json({ id: "synthetic-user" }, { status: 200 }));
  mocks.floor.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function signUp(body: unknown, options: { raw?: string; headers?: Record<string, string>; form?: ReturnType<typeof mintAuthForm> } = {}) {
  const form = options.form ?? mintAuthForm("auth-sign-up");
  return new Request(`${ORIGIN}/api/auth/sign-up`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-real-ip": ADDRESS,
      "x-inherit-csrf": form.formToken,
      cookie: `${AUTH_FORM_COOKIE}=${cookieValue(form.setCookie)}`,
      ...options.headers,
    },
    body: options.raw ?? JSON.stringify(body),
  });
}

/** Status, body and header names: everything a caller can compare. */
async function shape(response: Response) {
  return {
    status: response.status,
    body: await response.text(),
    headers: [...response.headers.keys()].sort(),
    cookieNames: response.headers.getSetCookie().map((line) => line.slice(0, line.indexOf("="))),
  };
}

function authCall(index = 0): { url: URL; body: Record<string, unknown> } {
  const [target, init] = mocks.fetch.mock.calls[index]!;
  return { url: new URL(String(target)), body: JSON.parse(String((init as RequestInit).body)) };
}

describe("POST /api/auth/sign-up (auth.sign-up-submit)", () => {
  it("exports POST alone", () => {
    expect(Object.keys(route).filter((name) => /^[A-Z]+$/.test(name))).toEqual(["POST"]);
  });

  it("answers signup-v1 after counting, with a PKCE state cookie and the authOrRecovery headers", async () => {
    const response = await route.POST(signUp({ email: ` ${EMAIL.toUpperCase()} `, password: PASSWORD }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "check_your_email" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.getSetCookie()).toEqual([expect.stringMatching(new RegExp(`^${PKCE_COOKIE}=[A-Za-z0-9_-]+; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax$`))]);
    expect(mocks.floor).toHaveBeenCalledOnce();

    // The database counts digests only, under the registered operation.
    expect(mocks.rpc).toHaveBeenCalledOnce();
    const [name, args] = mocks.rpc.mock.calls[0]!;
    expect(name).toBe("admit_auth_public_request_v1");
    expect(args).toEqual({
      p_route_id: "auth.sign-up-submit",
      p_form_nonce_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_identifier_digests: { "1": expect.stringMatching(/^[0-9a-f]{64}$/) },
      p_network_digests: { "1": expect.stringMatching(/^[0-9a-f]{64}$/) },
    });
    expect(JSON.stringify(args)).not.toContain(EMAIL);
    expect(JSON.stringify(args)).not.toContain(ADDRESS);

    // The auth service gets the normalized address, the S256 challenge and the state-bearing return address.
    const call = authCall();
    expect(call.url.origin + call.url.pathname).toBe("http://127.0.0.1:54321/auth/v1/signup");
    const redirectTo = call.url.searchParams.get("redirect_to")!;
    expect(redirectTo).toMatch(/^https:\/\/inherit\.bio\/auth\/callback\?next=\/overview&flow=signup&state=[A-Za-z0-9_-]{43}$/);
    expect(call.body).toEqual({
      email: EMAIL, password: PASSWORD, data: {}, code_challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: "s256",
    });
  });

  it("gives an existing, limited, or failed sign-up the identical answer, and calls nothing more when limited", async () => {
    const answers: Awaited<ReturnType<typeof shape>>[] = [];
    answers.push(await shape(await route.POST(signUp({ email: EMAIL, password: PASSWORD }))));
    mocks.fetch.mockResolvedValueOnce(Response.json({ code: 422, error_code: "user_already_exists", msg: "User already registered" }, { status: 422 }));
    answers.push(await shape(await route.POST(signUp({ email: EMAIL, password: PASSWORD }))));
    mocks.fetch.mockResolvedValueOnce(Response.json({ error_code: "over_email_send_rate_limit" }, { status: 429 }));
    answers.push(await shape(await route.POST(signUp({ email: EMAIL, password: PASSWORD }))));
    mocks.fetch.mockRejectedValueOnce(new Error("synthetic outage"));
    answers.push(await shape(await route.POST(signUp({ email: EMAIL, password: PASSWORD }))));
    const callsBeforeLimit = mocks.fetch.mock.calls.length;
    mocks.rpc.mockResolvedValueOnce({ data: "limited", error: null });
    answers.push(await shape(await route.POST(signUp({ email: EMAIL, password: PASSWORD }))));
    expect(mocks.fetch.mock.calls.length).toBe(callsBeforeLimit);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "55000", message: "rate limit keys required" } });
    answers.push(await shape(await route.POST(signUp({ email: EMAIL, password: PASSWORD }))));
    expect(mocks.fetch.mock.calls.length).toBe(callsBeforeLimit);
    for (const answer of answers.slice(1)) expect(answer).toEqual(answers[0]);
    expect(answers[0]!.body).toBe('{"status":"check_your_email"}');
    expect(mocks.floor).toHaveBeenCalledTimes(answers.length);
  });

  it.each([
    ["no token", { "x-inherit-csrf": "" }],
    ["another origin", { origin: "https://elsewhere.invalid" }],
    ["cross-site fetch metadata", { "sec-fetch-site": "cross-site" }],
    ["no form cookie", { cookie: "" }],
    ["form-encoded data", { "content-type": "application/x-www-form-urlencoded" }],
  ])("is invalid-request-v1 csrf with %s, before the body or the database", async (_label, headers) => {
    const response = await route.POST(signUp({ email: EMAIL, password: PASSWORD }, { headers }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["csrf"] });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("refuses a token for the forgot-password form", async () => {
    const response = await route.POST(signUp({ email: EMAIL, password: PASSWORD }, { form: mintAuthForm("auth-forgot-password") }));
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["csrf"] });
  });

  it("is a stale page when the database has already spent the form nonce", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: "replayed", error: null });
    const response = await route.POST(signUp({ email: EMAIL, password: PASSWORD }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["csrf"] });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "{", ["body"]],
    ["over 8 KiB", JSON.stringify({ email: EMAIL, password: PASSWORD, pad: "x".repeat(8 * 1024) }), ["body"]],
    ["a dropped field", JSON.stringify({ email: EMAIL, password: PASSWORD, jurisdictionCode: "GB" }), ["body"]],
    ["a display name", JSON.stringify({ email: EMAIL, password: PASSWORD, displayName: "Ada" }), ["body"]],
    ["a date of birth", JSON.stringify({ email: EMAIL, password: PASSWORD, dateOfBirth: "2010-01-01" }), ["body"]],
    ["a bad address", JSON.stringify({ email: "nope", password: PASSWORD }), ["email"]],
    ["an 11-character password", JSON.stringify({ email: EMAIL, password: "a".repeat(11) }), ["password"]],
    ["a 73-character password", JSON.stringify({ email: EMAIL, password: "a".repeat(73) }), ["password"]],
    ["a 73-byte password", JSON.stringify({ email: EMAIL, password: `${"€".repeat(24)}a` }), ["password"]],
  ])("is invalid-request-v1 for %s, before any count or auth-service call", async (_label, raw, issues) => {
    const response = await route.POST(signUp(null, { raw }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("names a password or address the auth service refuses on its own terms, and nothing else", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ error_code: "weak_password" }, { status: 422 }));
    expect(await (await route.POST(signUp({ email: EMAIL, password: PASSWORD }))).json())
      .toEqual({ error: "invalid_request", issues: ["password"] });
    mocks.fetch.mockResolvedValueOnce(Response.json({ error_code: "email_address_invalid" }, { status: 400 }));
    expect(await (await route.POST(signUp({ email: EMAIL, password: PASSWORD }))).json())
      .toEqual({ error: "invalid_request", issues: ["email"] });
  });

  it("never echoes what was typed", async () => {
    for (const body of [{ email: "nope", password: PASSWORD }, { email: EMAIL, password: PASSWORD }]) {
      const text = await (await route.POST(signUp(body))).text();
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain(EMAIL);
    }
  });
});
