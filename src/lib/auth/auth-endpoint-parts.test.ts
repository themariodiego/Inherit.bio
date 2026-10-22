import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mintAuthForm, readAuthForm, sha256Hex } from "./auth-form";
import { AUTH_FORM_COOKIE, PKCE_COOKIE, RESET_CSRF_COOKIE, RESET_SESSION_COOKIE } from "./auth-cookies";
import { parseAuthBody, passwordFits } from "./auth-request";
import { newPkceFlow, readPkceFlow } from "./pkce-state";
import { newResetSession, presentedResetCsrf, readResetSession, resetCsrf } from "./reset-session";

/**
 * The parts the three auth endpoints and the callback are built from: the
 * closed bodies, the form pair, the PKCE state cookie and the reset session.
 * Synthetic values only.
 */

const ORIGIN = "https://inherit.bio";
const cookieValue = (setCookie: string) => setCookie.slice(setCookie.indexOf("=") + 1, setCookie.indexOf(";"));

beforeEach(() => vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64")));
afterEach(() => vi.unstubAllEnvs());

describe("the closed auth bodies", () => {
  it("takes exactly the registered keys, normalizing the email", () => {
    expect(parseAuthBody({ email: "  Person@E2E.Local ", password: "a-synthetic-pass" }, ["email", "password"]))
      .toEqual({ ok: true, value: { email: "person@e2e.local", password: "a-synthetic-pass" } });
    expect(parseAuthBody({ email: "person@e2e.local" }, ["email"])).toEqual({ ok: true, value: { email: "person@e2e.local" } });
  });

  it.each([
    ["an extra field", { email: "person@e2e.local", password: "a-synthetic-pass", displayName: "Ada" }],
    ["a dropped register field", { email: "person@e2e.local", password: "a-synthetic-pass", dateOfBirth: "2000-01-01" }],
    ["a jurisdiction", { email: "person@e2e.local", password: "a-synthetic-pass", jurisdictionCode: "GB" }],
    ["a missing field", { email: "person@e2e.local" }],
    ["an array", ["person@e2e.local"]],
    ["null", null],
  ])("refuses %s as the whole body", (_label, body) => {
    expect(parseAuthBody(body, ["email", "password"])).toEqual({ ok: false, issues: ["body"] });
  });

  it("names each invalid field and never a value", () => {
    expect(parseAuthBody({ email: "not-an-address", password: "short" }, ["email", "password"]))
      .toEqual({ ok: false, issues: ["email", "password"] });
    expect(parseAuthBody({ email: `${"a".repeat(250)}@e2e.local` }, ["email"])).toEqual({ ok: false, issues: ["email"] });
    expect(parseAuthBody({ email: 7 }, ["email"])).toEqual({ ok: false, issues: ["email"] });
  });

  it("holds a password to 12 to 72 characters and at most 72 bytes (owner decision 2026-10-16)", () => {
    expect(passwordFits("a".repeat(11))).toBe(false);
    expect(passwordFits("a".repeat(12))).toBe(true);
    expect(passwordFits("a".repeat(72))).toBe(true);
    expect(passwordFits("a".repeat(73))).toBe(false);
    // 24 three-byte characters are 72 bytes; 25 are 75.
    expect(passwordFits("€".repeat(24))).toBe(true);
    expect(passwordFits("€".repeat(25))).toBe(false);
    // Characters, not UTF-16 units: 12 astral characters are 12 characters but 48 bytes.
    expect(passwordFits("😀".repeat(12))).toBe(true);
    expect(passwordFits("😀".repeat(19))).toBe(false);
    expect(passwordFits(12)).toBe(false);
  });
});

describe("the form pair", () => {
  function post(form: ReturnType<typeof mintAuthForm>, headers: Record<string, string> = {}) {
    return new Request(`${ORIGIN}/api/auth/sign-up`, {
      method: "POST",
      headers: {
        origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json",
        "x-inherit-csrf": form.formToken, cookie: `${AUTH_FORM_COOKIE}=${cookieValue(form.setCookie)}`, ...headers,
      },
      body: "{}",
    });
  }

  it("reads a fresh token for this form and this cookie, and gives the database only the nonce hash", () => {
    const form = mintAuthForm("auth-sign-up");
    const read = readAuthForm(post(form), "auth-sign-up");
    expect(read?.nonceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(form.setCookie).toMatch(/^inherit-auth-form=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=600; HttpOnly; SameSite=Strict$/);
  });

  it("keeps a browser's existing cookie and still mints a new token", () => {
    const first = mintAuthForm("auth-sign-up");
    const second = mintAuthForm("auth-sign-up", Date.now(), cookieValue(first.setCookie));
    expect(cookieValue(second.setCookie)).toBe(cookieValue(first.setCookie));
    expect(second.formToken).not.toBe(first.formToken);
  });

  it.each([
    ["another origin", { origin: "https://elsewhere.invalid" }],
    ["cross-site fetch metadata", { "sec-fetch-site": "cross-site" }],
    ["no token", { "x-inherit-csrf": "" }],
    ["no cookie", { cookie: "" }],
    ["another browser's cookie", { cookie: `${AUTH_FORM_COOKIE}=${"b".repeat(43)}` }],
    ["two cookies", { cookie: `${AUTH_FORM_COOKIE}=${"b".repeat(43)}; ${AUTH_FORM_COOKIE}=${"c".repeat(43)}` }],
    ["form-encoded data", { "content-type": "application/x-www-form-urlencoded" }],
  ])("refuses %s", (_label, headers) => {
    expect(readAuthForm(post(mintAuthForm("auth-sign-up"), headers), "auth-sign-up")).toBeNull();
  });

  it("refuses a token minted for the other form, and a stale one", () => {
    expect(readAuthForm(post(mintAuthForm("auth-forgot-password")), "auth-sign-up")).toBeNull();
    expect(readAuthForm(post(mintAuthForm("auth-sign-up", Date.now() - 11 * 60 * 1000)), "auth-sign-up")).toBeNull();
  });

  it("refuses a query string", () => {
    const form = mintAuthForm("auth-sign-up");
    const request = new Request(`${ORIGIN}/api/auth/sign-up?x=1`, { method: "POST", headers: post(form).headers, body: "{}" });
    expect(readAuthForm(request, "auth-sign-up")).toBeNull();
  });
});

describe("the PKCE state cookie (auth.callback policy.PKCE)", () => {
  const callback = (state: string, cookie: string) =>
    new Request(`${ORIGIN}/auth/callback?code=c&state=${state}`, { headers: { cookie: `${PKCE_COOKIE}=${cookie}` } });

  it("holds an S256 challenge of a verifier the browser never sees, and returns it for the matching state", () => {
    const flow = newPkceFlow("recovery");
    expect(flow.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(flow.setCookie).toMatch(/^inherit-pkce-verifier=[A-Za-z0-9_-]+; Path=\/; Max-Age=3600; HttpOnly; SameSite=Lax$/);
    const read = readPkceFlow(callback(flow.state, cookieValue(flow.setCookie)), flow.state);
    expect(read).toEqual({ verifier: expect.stringMatching(/^[A-Za-z0-9_-]{64}$/), flow: "recovery", next: "/auth/reset-password" });
    expect(crypto.createHash("sha256").update(read!.verifier).digest("base64url")).toBe(flow.codeChallenge);
    // The cookie holds neither the state nor the verifier in the clear.
    expect(cookieValue(flow.setCookie)).not.toContain(flow.state);
    expect(Buffer.from(cookieValue(flow.setCookie), "base64url").toString("latin1")).not.toContain(read!.verifier);
  });

  it("gives each flow its own fixed destination", () => {
    const flow = newPkceFlow("signup");
    expect(readPkceFlow(callback(flow.state, cookieValue(flow.setCookie)), flow.state)?.next).toBe("/overview");
  });

  it("refuses another state, another browser, a tampered or expired cookie", () => {
    const flow = newPkceFlow("signup");
    const other = newPkceFlow("signup");
    const value = cookieValue(flow.setCookie);
    expect(readPkceFlow(callback(other.state, value), other.state)).toBeNull();
    expect(readPkceFlow(callback(flow.state, cookieValue(other.setCookie)), flow.state)).toBeNull();
    expect(readPkceFlow(new Request(`${ORIGIN}/auth/callback`), flow.state)).toBeNull();
    const tampered = `${value.slice(0, 30)}${value[30] === "A" ? "B" : "A"}${value.slice(31)}`;
    expect(readPkceFlow(callback(flow.state, tampered), flow.state)).toBeNull();
    expect(readPkceFlow(callback(flow.state, value), flow.state, Date.now() + 61 * 60 * 1000)).toBeNull();
    expect(readPkceFlow(callback(flow.state, value), null)).toBeNull();
    expect(readPkceFlow(callback(flow.state, value), "short")).toBeNull();
  });

  it("refuses a cookie sealed under another deployment key", () => {
    const flow = newPkceFlow("recovery");
    vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
    expect(readPkceFlow(callback(flow.state, cookieValue(flow.setCookie)), flow.state)).toBeNull();
  });
});

describe("the reset session (authContracts.reset-session-api-v1)", () => {
  const reset = (secret: string) =>
    new Request(`${ORIGIN}/api/auth/reset-password`, { method: "POST", headers: { cookie: `${RESET_SESSION_COOKIE}=${secret}` } });

  it("sets a Strict session cookie whose hash only the database keeps, and a Lax CSRF bound to it", () => {
    const session = newResetSession();
    const [sessionCookie, csrfCookie] = session.setCookies;
    expect(sessionCookie).toMatch(/^inherit-reset=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=900; HttpOnly; SameSite=Strict$/);
    expect(csrfCookie).toMatch(/^inherit-reset-csrf=[0-9a-f]{64}; Path=\/; Max-Age=900; HttpOnly; SameSite=Lax$/);
    expect(sha256Hex(cookieValue(sessionCookie!))).toBe(session.sessionHash);
    expect(cookieValue(csrfCookie!)).toBe(resetCsrf(session.sessionHash));
    expect(RESET_CSRF_COOKIE).toBe("inherit-reset-csrf");
  });

  it("authorizes only the session cookie together with its own CSRF value", () => {
    const session = newResetSession();
    const secret = cookieValue(session.setCookies[0]!);
    const csrf = cookieValue(session.setCookies[1]!);
    const request = reset(secret);
    expect(readResetSession(request, csrf)).toEqual({ sessionHash: session.sessionHash });
    expect(readResetSession(request, resetCsrf(newResetSession().sessionHash))).toBeNull();
    expect(readResetSession(request, null)).toBeNull();
    expect(readResetSession(request, "not-hex")).toBeNull();
    expect(readResetSession(reset("short"), csrf)).toBeNull();
  });

  it("renders only a well-formed CSRF value", () => {
    expect(presentedResetCsrf("a".repeat(64))).toBe("a".repeat(64));
    expect(presentedResetCsrf("<script>")).toBe("");
    expect(presentedResetCsrf(undefined)).toBe("");
  });
});

describe("the opaque answer's time floor", () => {
  it("waits out the remainder of the floor, and no longer once it has passed", async () => {
    const { afterFloor, OPAQUE_RESPONSE_FLOOR_MS } = await import("./auth-response");
    expect(OPAQUE_RESPONSE_FLOOR_MS).toBe(1_000);
    vi.useFakeTimers();
    try {
      let done = false;
      const waiting = afterFloor(performance.now(), 1_000).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      await waiting;
      expect(done).toBe(true);
      let late = false;
      await afterFloor(performance.now() - 5_000, 1_000).then(() => { late = true; });
      expect(late).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
