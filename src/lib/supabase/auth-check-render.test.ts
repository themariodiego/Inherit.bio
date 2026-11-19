import { createRequire } from "node:module";
import { createServerClient } from "@supabase/ssr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { currentOwnUploadAccount } from "@/lib/uploads/own-upload-context";
import { AUTH_RECHECK_PAUSE_MS, AuthServiceUnavailableError, userAnswerFetch, userForPage, type UserAnswers } from "./auth-check";
import { createClient } from "./server";

/**
 * D-142, hosted runs 44607979037 and 44614403733: a report page answered 500
 * at the requested URL although every second sign-in question that reached
 * the auth service was answered 200.
 *
 * Next.js memoizes every GET a server component sends, for the whole render,
 * failed answers included (`next/dist/server/lib/dedupe-fetch.js`). In a
 * render `checkUser`'s second `GET /auth/v1/user` is the same request as its
 * first, so it was answered from that memo with the first failure and never
 * reached the service: the app layout and the report page's resolver threw
 * `AuthServiceUnavailableError` 250 ms after one failure. Reproduced against
 * `next build` + `next start` with one `GET /auth/v1/user` answered 500.
 *
 * These tests run Next's own memo, loaded from the installed `next` with
 * React's `cache` bound to one render (the scope React gives a render), under
 * the real `createClient` of `./server`, the real @supabase/ssr client and the
 * real readers of a report page, against a stubbed auth service.
 */

const URL_ = "http://127.0.0.1:54321";
const COOKIE = "sb-127-auth-token";
const USER_ID = "12345678-1234-4234-8234-000000000001";
const SESSION_ID = "12345678-1234-4234-8234-0000000000aa";

/** The browser's one session cookie, the same on every request as a real one is (hoisted for the mock below). */
const session = vi.hoisted(() => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const claims = { sub: "12345678-1234-4234-8234-000000000001", session_id: "12345678-1234-4234-8234-0000000000aa", exp };
  const token = `${part({ alg: "HS256" })}.${part(claims)}.c2lnbmF0dXJl`;
  return { cookie: "base64-" + Buffer.from(JSON.stringify({ access_token: token, refresh_token: "refresh-one", expires_at: exp,
    expires_in: 3600, token_type: "bearer", user: { id: claims.sub } })).toString("base64url") };
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "x-supabase-api-version": "2024-01-01" },
});
const user = () => json(200, { id: USER_ID, aud: "authenticated", role: "authenticated", email: "synthetic@example.test" });
const failure = () => json(500, { code: "unexpected_failure", msg: "Database error querying schema" });

/**
 * One render's cache scope, as React gives a server render one; null outside
 * a render (a route handler, a server action), where `cache` memoizes nothing.
 */
const render = vi.hoisted(() => {
  const state = { scope: null as Map<unknown, Map<unknown, unknown>> | null };
  const cache = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A): R => {
    if (!state.scope) return fn(...args);
    let byArgument = state.scope.get(fn);
    if (!byArgument) state.scope.set(fn, byArgument = new Map());
    if (!byArgument.has(args[0])) byArgument.set(args[0], fn(...args));
    return byArgument.get(args[0]) as R;
  };
  return { state, cache };
});

vi.mock("react", async (importOriginal) => ({ ...await importOriginal<typeof import("react")>(), cache: render.cache }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [{ name: "sb-127-auth-token", value: session.cookie }], set: () => { throw new Error("read-only in a render"); } }),
}));

/**
 * Next's own `createDedupeFetch`, loaded from the installed `next` with the
 * `react` it requires replaced by one whose `cache` is the render scope above.
 * Both module cache entries are put back at once, so nothing else in the
 * process sees the substitute.
 */
function nextRenderMemo(): (network: typeof fetch) => typeof fetch {
  const nodeRequire = createRequire(import.meta.url);
  const dedupePath = nodeRequire.resolve("next/dist/server/lib/dedupe-fetch.js");
  const reactPath = createRequire(dedupePath).resolve("react");
  const saved = { dedupe: nodeRequire.cache[dedupePath], react: nodeRequire.cache[reactPath] };
  nodeRequire.cache[reactPath] = { id: reactPath, filename: reactPath, loaded: true, exports: { cache: render.cache } } as NodeJS.Module;
  delete nodeRequire.cache[dedupePath];
  try {
    return (nodeRequire(dedupePath) as { createDedupeFetch: (network: typeof fetch) => typeof fetch }).createDedupeFetch;
  } finally {
    for (const [path, entry] of [[dedupePath, saved.dedupe], [reactPath, saved.react]] as const) {
      if (entry) nodeRequire.cache[path] = entry; else delete nodeRequire.cache[path];
    }
  }
}
const createDedupeFetch = nextRenderMemo();

/**
 * The auth service: answers `/user` from `answers` in order, then with the
 * user, each after 5 ms, as a real answer takes a moment; counts every question.
 */
function service(...answers: (() => Response)[]) {
  const asked: string[] = [];
  const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    asked.push(url.pathname);
    const answer = url.pathname === "/auth/v1/user" ? answers.shift() ?? user : null;
    await new Promise(resolve => setTimeout(resolve, 5));
    if (answer) return answer();
    expect(init?.method ?? "GET").toBe("GET");
    return json(200, []);
  });
  vi.stubGlobal("fetch", createDedupeFetch(network as unknown as typeof fetch));
  return { userQuestions: () => asked.filter(path => path === "/auth/v1/user").length, network };
}

/** Runs `body` as one server render: one cache scope, opened and closed around it. */
async function inOneRender<T>(body: () => Promise<T>): Promise<T> {
  render.state.scope = new Map();
  try { return await body(); } finally { render.state.scope = null; }
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  render.state.scope = null;
});

/** Lets the service's latency and the pause of `checkUser` pass under fake timers. */
async function settle<T>(pending: Promise<T>): Promise<PromiseSettledResult<T>> {
  const settled = Promise.allSettled([pending]);
  await vi.advanceTimersByTimeAsync(AUTH_RECHECK_PAUSE_MS * 4);
  return (await settled)[0];
}

describe("Next's own render memo, which run 3 and run 4 met", () => {
  it("answers a repeated GET /auth/v1/user in one render with the first failure, without asking the service", async () => {
    vi.useFakeTimers();
    const auth = service(failure);
    // The stock server client, with no fetch of its own: what every page used before.
    const stock = createServerClient(URL_, "anon", { cookies: { getAll: () => [{ name: COOKIE, value: session.cookie }], setAll: () => {} } });
    const outcome = await inOneRender(() => settle(userForPage(stock.auth)));
    expect(outcome.status === "rejected" && outcome.reason).toBeInstanceOf(AuthServiceUnavailableError);
    expect(auth.userQuestions()).toBe(1);
  });

  it("is left by a request that carries a signal, its documented opt-out", async () => {
    const auth = service(failure);
    const answers = await inOneRender(async () => {
      const first = await fetch(`${URL_}/auth/v1/user`, { headers: { authorization: "Bearer t" } });
      const again = await fetch(`${URL_}/auth/v1/user`, { headers: { authorization: "Bearer t" }, signal: new AbortController().signal });
      return [first.status, again.status];
    });
    expect(answers).toEqual([500, 200]);
    expect(auth.userQuestions()).toBe(2);
  });
});

describe("the server client of pages, in one render (createClient)", () => {
  it("asks the service the second question after one failure, and the page gets the user", async () => {
    vi.useFakeTimers();
    const auth = service(failure);
    const outcome = await inOneRender(async () => settle(userForPage((await createClient()).auth)));
    expect(outcome).toEqual({ status: "fulfilled", value: expect.objectContaining({ id: USER_ID }) });
    expect(auth.userQuestions()).toBe(2);
  });

  it("hands every later reader of the render the second answer, not the first failure", async () => {
    vi.useFakeTimers();
    const auth = service(failure);
    const read = await inOneRender(async () => {
      const layout = await settle(userForPage((await createClient()).auth));
      vi.useRealTimers();
      // What the layout renders next (`accountCsrfTokens`), and what a Family
      // report's loaders ask (`currentOwnUploadAccount`: getUser and getClaims).
      return { layout, csrf: await getSensitiveAccountContext(), loader: await currentOwnUploadAccount() };
    });
    expect(read.layout.status).toBe("fulfilled");
    expect(read.csrf).toEqual({ user: expect.objectContaining({ id: USER_ID }), sessionId: SESSION_ID });
    expect(read.loader).toEqual({ accountId: USER_ID, sessionId: SESSION_ID });
    expect(auth.userQuestions()).toBe(2);
  });

  it("shares one question among readers that ask at the same time, as Next's memo did", async () => {
    const auth = service();
    const read = await inOneRender(async () => Promise.all([
      userForPage((await createClient()).auth),
      getSensitiveAccountContext(),
      userForPage((await createClient()).auth),
      currentOwnUploadAccount(),
    ]));
    expect(read.map(Boolean)).toEqual([true, true, true, true]);
    expect(auth.userQuestions()).toBe(1);
  });

  it("shares the second question too, and throws the error surface when it fails as well", async () => {
    vi.useFakeTimers();
    const auth = service(failure, failure);
    const outcomes = await inOneRender(async () => {
      const readers = [userForPage((await createClient()).auth), userForPage((await createClient()).auth)];
      const settled = Promise.allSettled(readers);
      await vi.advanceTimersByTimeAsync(AUTH_RECHECK_PAUSE_MS * 4);
      return settled;
    });
    for (const outcome of outcomes) expect(outcome.status === "rejected" && outcome.reason).toBeInstanceOf(AuthServiceUnavailableError);
    expect(auth.userQuestions()).toBe(2);
  });

  it("keeps a refusal as the render's answer: no session, asked once", async () => {
    const auth = service(() => json(403, { code: "bad_jwt", msg: "invalid JWT" }));
    const read = await inOneRender(async () => [await userForPage((await createClient()).auth), await getSensitiveAccountContext()]);
    expect(read).toEqual([null, null]);
    expect(auth.userQuestions()).toBe(1);
  });

  it("outside a render asks once per reading and never twice, as route handlers and the CSRF gate always did", async () => {
    const auth = service(failure);
    expect(await getSensitiveAccountContext()).toBeNull();
    expect(auth.userQuestions()).toBe(1);
    expect(await getSensitiveAccountContext()).toEqual({ user: expect.objectContaining({ id: USER_ID }), sessionId: SESSION_ID });
    expect(auth.userQuestions()).toBe(2);
  });
});

describe("userAnswerFetch", () => {
  const answers = (): UserAnswers => new Map();

  it("passes every other request to the underlying fetch untouched", async () => {
    const ask = vi.fn(async () => json(200, []));
    const wrapped = userAnswerFetch(answers, ask as unknown as typeof fetch);
    const init = { method: "POST", headers: { apikey: "anon" }, body: "{}" };
    await wrapped(`${URL_}/rest/v1/rpc/x`, init);
    await wrapped(`${URL_}/rest/v1/profiles?select=id`);
    await wrapped(`${URL_}/auth/v1/token?grant_type=refresh_token`, init);
    expect(ask.mock.calls).toEqual([[`${URL_}/rest/v1/rpc/x`, init], [`${URL_}/rest/v1/profiles?select=id`, undefined],
      [`${URL_}/auth/v1/token?grant_type=refresh_token`, init]]);
  });

  it("sends each question with a signal, so Next's memo never answers it", async () => {
    const ask = vi.fn(async () => user());
    await userAnswerFetch(answers, ask as unknown as typeof fetch)(`${URL_}/auth/v1/user`, { method: "GET", headers: { authorization: "Bearer t" } });
    expect((ask.mock.calls[0] as unknown[])[1]).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it.each([
    ["no answer", () => { throw new TypeError("fetch failed"); }],
    ["429", () => json(429, { msg: "slow down" })],
    ["503", () => json(503, { msg: "unavailable" })],
    ["a 200 whose body is not JSON", () => new Response("<html>", { status: 200 })],
  ])("does not keep %s: the next question in the render goes to the service", async (_name, first) => {
    const map = new Map() as UserAnswers;
    const ask = vi.fn().mockImplementationOnce(async () => first()).mockImplementation(async () => user());
    const wrapped = userAnswerFetch(() => map, ask as unknown as typeof fetch);
    await wrapped(`${URL_}/auth/v1/user`, { headers: { authorization: "Bearer t" } }).catch(() => null);
    expect((await wrapped(`${URL_}/auth/v1/user`, { headers: { authorization: "Bearer t" } })).status).toBe(200);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("keeps a verdict for the render, per question: another token is another question", async () => {
    const map = new Map() as UserAnswers;
    const ask = vi.fn(async () => user());
    const wrapped = userAnswerFetch(() => map, ask as unknown as typeof fetch);
    for (const token of ["a", "a", "b", "a"]) {
      const answer = await wrapped(`${URL_}/auth/v1/user`, { headers: { authorization: `Bearer ${token}`, traceparent: Math.random().toString() } });
      expect(await answer.json()).toEqual(expect.objectContaining({ id: USER_ID }));
    }
    expect(ask).toHaveBeenCalledTimes(2);
  });
});
