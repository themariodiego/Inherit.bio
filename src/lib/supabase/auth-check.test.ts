import { createServerClient } from "@supabase/ssr";
import {
  AuthApiError,
  AuthRefreshDiscardedError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
  type User,
} from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSensitiveAccountContextFromClient } from "@/lib/account-deletion";
import {
  AUTH_RECHECK_PAUSE_MS,
  AuthServiceUnavailableError,
  checkUser,
  classifyUserAnswer,
  pageAuth,
  userForPage,
  type UserReader,
} from "./auth-check";

/**
 * Owner decision 2026-11-19, "A brief failure of the sign-in service is not
 * treated as signed out" (D-142). The classes come from @supabase/auth-js
 * 2.112.4 itself: the first block drives the real library, through the same
 * `createServerClient` the proxy uses, against a stubbed auth service, so a
 * change in how the library maps an answer fails here rather than in a person's
 * browser.
 */

const URL_ = "http://127.0.0.1:54321";
const COOKIE = "sb-127-auth-token";
const USER_ID = "12345678-1234-4234-8234-000000000001";
const SESSION_ID = "12345678-1234-4234-8234-0000000000aa";

function accessToken(expiresAt: number): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part({ sub: USER_ID, session_id: SESSION_ID, exp: expiresAt })}.signature`;
}

function sessionCookie(expiresInSeconds: number): string {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return "base64-" + Buffer.from(JSON.stringify({
    access_token: accessToken(expiresAt), refresh_token: "refresh-one", expires_at: expiresAt,
    expires_in: 3600, token_type: "bearer", user: { id: USER_ID },
  })).toString("base64url");
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "x-supabase-api-version": "2024-01-01" },
});
const html = (status: number) => new Response("<html><body>gateway</body></html>", { status, headers: { "content-type": "text/html" } });
const userBody = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "synthetic@example.test" };

type Written = { name: string; value: string; options?: { maxAge?: number } }[];

/**
 * A real server client over one request's cookies, whose auth service answers
 * `/user` with `answer` (and the refresh grant with `refresh`, when given).
 * Returns what `getUser()` answered, every cookie the client wrote through
 * `setAll`, and how many times the service was asked.
 */
async function realAnswer(
  answer: () => Response | Promise<Response>,
  { cookie = sessionCookie(3600), refresh }: { cookie?: string | null; refresh?: () => Response } = {},
) {
  const written: Written = [];
  let userCalls = 0;
  const client = createServerClient(URL_, "anon", {
    cookies: {
      getAll: () => (cookie === null ? [] : [{ name: COOKIE, value: cookie }]),
      setAll: (cookies) => { written.push(...cookies); },
    },
    global: {
      fetch: async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/token?grant_type=refresh_token")) return refresh!();
        userCalls += 1;
        return answer();
      },
    },
  });
  const result = await client.auth.getUser();
  return { result, written, userCalls };
}

const removals = (written: Written) => written.filter(cookie => cookie.value === "");

describe("each answer the installed auth client can give, classified", () => {
  it.each([
    ["a network failure", () => { throw new TypeError("fetch failed"); }, "AuthRetryableFetchError"],
    ["an aborted request", () => { throw new DOMException("aborted", "AbortError"); }, "AuthRetryableFetchError"],
    ["500 Database error finding users", () => json(500, { code: "unexpected_failure", msg: "Database error finding users" }), "AuthRetryableFetchError"],
    ["502 from a gateway, not JSON", () => html(502), "AuthRetryableFetchError"],
    ["503", () => json(503, { msg: "unavailable" }), "AuthRetryableFetchError"],
    ["504 from a gateway, not JSON", () => html(504), "AuthRetryableFetchError"],
    ["520", () => html(520), "AuthRetryableFetchError"],
    ["429 rate limited", () => json(429, { code: "over_request_rate_limit", msg: "slow down" }), "AuthApiError"],
    ["507, a 5xx outside the library's retryable list", () => json(507, { code: "unexpected_failure", msg: "x" }), "AuthApiError"],
    ["200 whose body cannot be read", () => new Response("not json", { status: 200 }), "AuthRetryableFetchError"],
  ])("%s is temporarily unavailable, and the client writes no cookie", async (_name, answer, errorName) => {
    const { result, written } = await realAnswer(answer);
    expect(result.error?.name).toBe(errorName);
    expect(classifyUserAnswer(result)).toEqual({ kind: "unavailable" });
    expect(written).toEqual([]);
  });

  it("session_not_found is no session, and the client itself clears the session cookie", async () => {
    const { result, written } = await realAnswer(() => json(403, { code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" }));
    expect(result.error?.name).toBe("AuthSessionMissingError");
    expect(classifyUserAnswer(result)).toEqual({ kind: "no-session" });
    expect(removals(written).map(cookie => cookie.name)).toContain(COOKIE);
  });

  it.each([
    ["403 bad_jwt", () => json(403, { code: "bad_jwt", msg: "invalid JWT" }), "AuthApiError"],
    ["401 no_authorization", () => json(401, { code: "no_authorization", msg: "no" }), "AuthApiError"],
    ["404 user_not_found", () => json(404, { code: "user_not_found", msg: "User from sub claim in JWT does not exist" }), "AuthApiError"],
  ])("%s is no session: the service refused the token or the user", async (_name, answer, errorName) => {
    const { result } = await realAnswer(answer);
    expect(result.error?.name).toBe(errorName);
    expect(classifyUserAnswer(result)).toEqual({ kind: "no-session" });
  });

  it.each([
    ["429 from a gateway, not JSON", () => html(429)],
    ["401 from a gateway, not JSON", () => html(401)],
  ])("%s cannot be classified (AuthUnknownError carries no status), so it reads as no session, as before", async (_name, answer) => {
    const { result } = await realAnswer(answer);
    expect(result.error?.name).toBe("AuthUnknownError");
    expect(classifyUserAnswer(result)).toEqual({ kind: "no-session" });
  });

  it("no session cookie is no session, and the service is never asked", async () => {
    const { result, userCalls } = await realAnswer(() => json(200, userBody), { cookie: null });
    expect(result.error?.name).toBe("AuthSessionMissingError");
    expect(classifyUserAnswer(result)).toEqual({ kind: "no-session" });
    expect(userCalls).toBe(0);
  });

  it("a confirmed user is a user", async () => {
    const { result } = await realAnswer(() => json(200, userBody));
    expect(classifyUserAnswer(result)).toEqual({ kind: "user", user: expect.objectContaining({ id: USER_ID }) });
  });

  it("a refresh that rotated the tokens before /user failed is temporary, with the new tokens written and nothing removed", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const { result, written } = await realAnswer(() => json(503, { msg: "unavailable" }), {
      cookie: sessionCookie(30),
      refresh: () => json(200, { access_token: accessToken(expiresAt), refresh_token: "refresh-two", expires_at: expiresAt,
        expires_in: 3600, token_type: "bearer", user: userBody }),
    });
    expect(classifyUserAnswer(result)).toEqual({ kind: "unavailable" });
    expect(written.some(cookie => cookie.name === COOKIE && cookie.value !== "")).toBe(true);
    expect(removals(written)).toEqual([]);
  });

  it("a refresh refused with 429 after the access token expired is temporary, but the client has already written removals", async () => {
    // auth-js treats any refresh failure but AuthRetryableFetchError as final
    // once the access token has expired (`_callRefreshToken` →
    // `_removeSession`). That is why the proxy forwards no removal on a
    // temporary answer: this one says nothing about the session.
    const { result, written } = await realAnswer(() => json(200, userBody), {
      cookie: sessionCookie(-60),
      refresh: () => json(429, { code: "over_request_rate_limit", msg: "slow down" }),
    });
    expect(result.error?.name).toBe("AuthApiError");
    expect(classifyUserAnswer(result)).toEqual({ kind: "unavailable" });
    expect(removals(written).map(cookie => cookie.name)).toContain(COOKIE);
  });
});

describe("the classification, error by error", () => {
  const user = { id: USER_ID } as User;
  it.each([
    [new AuthRetryableFetchError("fetch failed", 0), "unavailable"],
    [new AuthRetryableFetchError("Bad Gateway", 502), "unavailable"],
    [new AuthApiError("rate limited", 429, "over_request_rate_limit"), "unavailable"],
    [new AuthApiError("insufficient storage", 507, undefined), "unavailable"],
    [new AuthSessionMissingError(), "no-session"],
    [new AuthApiError("invalid JWT", 403, "bad_jwt"), "no-session"],
    [new AuthApiError("no", 401, "no_authorization"), "no-session"],
    [new AuthApiError("gone", 404, "user_not_found"), "no-session"],
    [new AuthApiError("bad", 400, "validation_failed"), "no-session"],
    [new AuthUnknownError("Unexpected token <", new SyntaxError("x")), "no-session"],
    [new AuthRefreshDiscardedError(), "no-session"],
  ] as const)("%s → %s", (error, kind) => {
    expect(classifyUserAnswer({ data: { user: null }, error })).toEqual({ kind });
  });

  it("never yields a user alongside an error, whatever the error", () => {
    for (const error of [new AuthRetryableFetchError("x", 503), new AuthSessionMissingError(), new AuthApiError("x", 403, "bad_jwt")]) {
      expect(classifyUserAnswer({ data: { user }, error }).kind).not.toBe("user");
    }
  });

  it("reads no user and no error as no session", () => {
    expect(classifyUserAnswer({ data: { user: null } })).toEqual({ kind: "no-session" });
    expect(classifyUserAnswer({ data: { user }, error: null })).toEqual({ kind: "user", user });
  });
});

describe("one more question after a short pause, and only on a temporary answer", () => {
  afterEach(() => { vi.useRealTimers(); });

  const user = { id: USER_ID } as User;
  const temporary = { data: { user: null }, error: new AuthRetryableFetchError("fetch failed", 0) };
  const missing = { data: { user: null }, error: new AuthSessionMissingError() };
  const confirmed = { data: { user }, error: null };
  const reader = (...answers: Awaited<ReturnType<UserReader["getUser"]>>[]) => {
    const getUser = vi.fn(async () => answers.shift() ?? temporary);
    return { getUser };
  };

  it("asks again once after the pause, and the second answer decides", async () => {
    vi.useFakeTimers();
    const auth = reader(temporary, confirmed);
    const pending = checkUser(auth);
    await vi.advanceTimersByTimeAsync(AUTH_RECHECK_PAUSE_MS - 1);
    expect(auth.getUser).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ kind: "user", user });
    expect(auth.getUser).toHaveBeenCalledTimes(2);
  });

  it("asks exactly twice when both answers are temporary", async () => {
    vi.useFakeTimers();
    const auth = reader(temporary, temporary, confirmed);
    const pending = checkUser(auth);
    await vi.advanceTimersByTimeAsync(AUTH_RECHECK_PAUSE_MS * 10);
    await expect(pending).resolves.toEqual({ kind: "unavailable" });
    expect(auth.getUser).toHaveBeenCalledTimes(2);
  });

  it("takes a no-session second answer as no session", async () => {
    vi.useFakeTimers();
    const auth = reader(temporary, missing);
    const pending = checkUser(auth);
    await vi.advanceTimersByTimeAsync(AUTH_RECHECK_PAUSE_MS);
    await expect(pending).resolves.toEqual({ kind: "no-session" });
  });

  it.each([["no session", missing, { kind: "no-session" }], ["a user", confirmed, { kind: "user", user }]] as const)(
    "never asks again after %s", async (_name, first, expected) => {
      const auth = reader(first, confirmed);
      await expect(checkUser(auth)).resolves.toEqual(expected);
      expect(auth.getUser).toHaveBeenCalledTimes(1);
    },
  );

  it("stops waiting when the request aborts, and does not ask again", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const auth = reader(temporary, confirmed);
    const pending = checkUser(auth, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toEqual({ kind: "unavailable" });
    expect(auth.getUser).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not wait at all for a request that has already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const auth = reader(temporary, confirmed);
    await expect(checkUser(auth, { signal: controller.signal })).resolves.toEqual({ kind: "unavailable" });
    expect(auth.getUser).toHaveBeenCalledTimes(1);
  });

  it("lets an exception from getUser through, as before", async () => {
    const failure = new Error("storage");
    await expect(checkUser({ getUser: async () => { throw failure; } })).rejects.toBe(failure);
  });
});

describe("the page-level reading", () => {
  afterEach(() => { vi.useRealTimers(); });
  const user = { id: USER_ID } as User;
  const temporary = { data: { user: null }, error: new AuthRetryableFetchError("fetch failed", 0) };

  it("throws AuthServiceUnavailableError after two temporary answers, and names nothing", async () => {
    vi.useFakeTimers();
    const getUser = vi.fn(async () => temporary);
    const pending = userForPage({ getUser });
    const settled = expect(pending).rejects.toBeInstanceOf(AuthServiceUnavailableError);
    await vi.advanceTimersByTimeAsync(AUTH_RECHECK_PAUSE_MS);
    await settled;
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(new AuthServiceUnavailableError().message).not.toMatch(/[0-9a-f]{8}-|@|token/i);
  });

  it("is null for no session and the user for a user", async () => {
    await expect(userForPage({ getUser: async () => ({ data: { user: null }, error: new AuthSessionMissingError() }) })).resolves.toBeNull();
    await expect(userForPage({ getUser: async () => ({ data: { user }, error: null }) })).resolves.toBe(user);
  });

  it("hands a shared resolver the checked answer, and every other member bound to the real client", async () => {
    vi.useFakeTimers();
    const target = {
      calls: 0,
      async getUser() { this.calls += 1; return this.calls === 1 ? temporary : { data: { user }, error: null }; },
      async getSession(this: { marker: string }) { return { data: { session: { access_token: accessToken(0) } }, marker: this.marker }; },
      marker: "the real client",
    };
    const auth = pageAuth(target);
    const session = await auth.getSession();
    expect(session.marker).toBe("the real client");
    const pending = getSensitiveAccountContextFromClient({ auth } as unknown as Parameters<typeof getSensitiveAccountContextFromClient>[0]);
    await vi.advanceTimersByTimeAsync(AUTH_RECHECK_PAUSE_MS);
    await expect(pending).resolves.toEqual({ user, sessionId: SESSION_ID });
    expect(target.calls).toBe(2);
  });

  it("makes the shared resolver throw on two temporary answers, and still read no session as null", async () => {
    vi.useFakeTimers();
    const getSession = async () => ({ data: { session: { access_token: accessToken(0) } } });
    const failing = pageAuth({ getUser: async () => temporary, getSession });
    const pending = getSensitiveAccountContextFromClient({ auth: failing } as unknown as Parameters<typeof getSensitiveAccountContextFromClient>[0]);
    const settled = expect(pending).rejects.toBeInstanceOf(AuthServiceUnavailableError);
    await vi.advanceTimersByTimeAsync(AUTH_RECHECK_PAUSE_MS);
    await settled;
    const signedOut = pageAuth({ getUser: async () => ({ data: { user: null }, error: new AuthSessionMissingError() }), getSession });
    await expect(getSensitiveAccountContextFromClient({ auth: signedOut } as unknown as Parameters<typeof getSensitiveAccountContextFromClient>[0]))
      .resolves.toBeNull();
  });
});
