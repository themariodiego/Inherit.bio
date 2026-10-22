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
 * `POST /api/auth/forgot-password` (register auth.forgot-password-submit).
 * The database and the auth service are stubs; every value is synthetic.
 */

const ORIGIN = "https://inherit.bio";
const EMAIL = "someone@e2e.local";
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
  mocks.fetch.mockResolvedValue(Response.json({}, { status: 200 }));
  mocks.floor.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function forgot(body: unknown, options: { raw?: string; headers?: Record<string, string>; form?: ReturnType<typeof mintAuthForm> } = {}) {
  const form = options.form ?? mintAuthForm("auth-forgot-password");
  return new Request(`${ORIGIN}/api/auth/forgot-password`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-real-ip": "198.51.100.4",
      "x-inherit-csrf": form.formToken,
      cookie: `${AUTH_FORM_COOKIE}=${cookieValue(form.setCookie)}`,
      ...options.headers,
    },
    body: options.raw ?? JSON.stringify(body),
  });
}

async function shape(response: Response) {
  return {
    status: response.status,
    body: await response.text(),
    headers: [...response.headers.keys()].sort(),
    cookieNames: response.headers.getSetCookie().map((line) => line.slice(0, line.indexOf("="))),
  };
}

describe("POST /api/auth/forgot-password (auth.forgot-password-submit)", () => {
  it("exports POST alone", () => {
    expect(Object.keys(route).filter((name) => /^[A-Z]+$/.test(name))).toEqual(["POST"]);
  });

  it("answers auth-opaque-request-v1 and asks the auth service for a PKCE recovery link", async () => {
    const response = await route.POST(forgot({ email: EMAIL }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "check_your_email" });
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.getSetCookie()).toEqual([expect.stringMatching(new RegExp(`^${PKCE_COOKIE}=[A-Za-z0-9_-]+; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax$`))]);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("admit_auth_public_request_v1", {
      p_route_id: "auth.forgot-password-submit",
      p_form_nonce_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_identifier_digests: { "1": expect.stringMatching(/^[0-9a-f]{64}$/) },
      p_network_digests: { "1": expect.stringMatching(/^[0-9a-f]{64}$/) },
    });
    const [target, init] = mocks.fetch.mock.calls[0]!;
    const url = new URL(String(target));
    expect(url.origin + url.pathname).toBe("http://127.0.0.1:54321/auth/v1/recover");
    // The return address carries a state and nothing else: no destination, no token.
    expect(url.searchParams.get("redirect_to")).toMatch(/^https:\/\/inherit\.bio\/auth\/callback\?state=[A-Za-z0-9_-]{43}$/);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      email: EMAIL, code_challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: "s256",
    });
    expect(mocks.floor).toHaveBeenCalledOnce();
  });

  it("normalizes existing, missing, disabled, limited and failed identities to one bounded answer", async () => {
    const answers: Awaited<ReturnType<typeof shape>>[] = [];
    answers.push(await shape(await route.POST(forgot({ email: EMAIL }))));
    mocks.fetch.mockResolvedValueOnce(Response.json({ error_code: "user_banned" }, { status: 400 }));
    answers.push(await shape(await route.POST(forgot({ email: EMAIL }))));
    mocks.fetch.mockResolvedValueOnce(Response.json({ error_code: "over_email_send_rate_limit" }, { status: 429 }));
    answers.push(await shape(await route.POST(forgot({ email: EMAIL }))));
    mocks.fetch.mockRejectedValueOnce(new Error("synthetic outage"));
    answers.push(await shape(await route.POST(forgot({ email: EMAIL }))));
    const calls = mocks.fetch.mock.calls.length;
    mocks.rpc.mockResolvedValueOnce({ data: "limited", error: null });
    answers.push(await shape(await route.POST(forgot({ email: EMAIL }))));
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    answers.push(await shape(await route.POST(forgot({ email: EMAIL }))));
    expect(mocks.fetch.mock.calls.length).toBe(calls);
    for (const answer of answers.slice(1)) expect(answer).toEqual(answers[0]);
    expect(answers[0]!.body).not.toContain(EMAIL);
    expect(mocks.floor).toHaveBeenCalledTimes(answers.length);
  });

  it.each([
    ["no token", { "x-inherit-csrf": "" }],
    ["another origin", { origin: "https://elsewhere.invalid" }],
    ["cross-site fetch metadata", { "sec-fetch-site": "none" }],
    ["no form cookie", { cookie: "" }],
  ])("is invalid-request-v1 csrf with %s, before the body or the database", async (_label, headers) => {
    const response = await route.POST(forgot({ email: EMAIL }, { headers }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["csrf"] });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("refuses a sign-up form token and a spent one", async () => {
    expect(await (await route.POST(forgot({ email: EMAIL }, { form: mintAuthForm("auth-sign-up") }))).json())
      .toEqual({ error: "invalid_request", issues: ["csrf"] });
    mocks.rpc.mockResolvedValueOnce({ data: "replayed", error: null });
    expect(await (await route.POST(forgot({ email: EMAIL }))).json()).toEqual({ error: "invalid_request", issues: ["csrf"] });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "[", ["body"]],
    ["an extra field", JSON.stringify({ email: EMAIL, password: "a-synthetic-password" }), ["body"]],
    ["no email", JSON.stringify({}), ["body"]],
    ["a bad address", JSON.stringify({ email: "nope@" }), ["email"]],
  ])("is invalid-request-v1 for %s", async (_label, raw, issues) => {
    const response = await route.POST(forgot(null, { raw }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
