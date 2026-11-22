import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mintSessionCsrf, verifySessionCsrf } from "./session-csrf-core";

/**
 * The route-side helper (`session-csrf.ts`) on its own: what it does around a
 * handler, with the database's spend as a double. Every real route is driven
 * through it in `session-csrf-routes.test.ts`.
 */

const KEY = Buffer.alloc(32, 12).toString("base64");
const ACCOUNT = "5b000000-0000-4000-8000-000000000001";
const SESSION = "5b000000-0000-4000-8000-000000000011";
const ORIGIN = "https://inherit.test";

const state = vi.hoisted(() => ({
  context: null as null | { user: { id: string }; sessionId: string },
  answer: { data: true as unknown, error: null as unknown },
  /** The answer of public.consume_session_csrf_v2, when a test sets one; otherwise `answer`. */
  v2: null as null | { data: unknown; error: unknown },
  calls: [] as Record<string, unknown>[],
  names: [] as string[],
}));
vi.mock("@/lib/account-deletion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-deletion")>()),
  getSensitiveAccountContext: vi.fn(async () => state.context),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
    state.calls.push(args); state.names.push(name);
    return name === "consume_session_csrf_v2" && state.v2 ? state.v2 : state.answer;
  } }),
}));

const signedIn = { user: { id: ACCOUNT }, sessionId: SESSION };
const accountSession = { kind: "authenticated" as const, accountId: ACCOUNT, sessionId: SESSION };
const post = (token?: string, origin: string | null = ORIGIN) => {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  if (token) headers.set("x-inherit-csrf", token);
  return new Request(`${ORIGIN}/api/settings/jurisdiction`, { method: "PUT", headers });
};

beforeEach(() => {
  vi.stubEnv("BYOK_ENCRYPTION_KEY", KEY);
  state.context = signedIn;
  state.answer = { data: true, error: null };
  state.v2 = null;
  state.calls.length = 0;
  state.names.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("withAccountCsrf", () => {
  it("runs the handler once for a spent-now token and returns its answer with the next token", async () => {
    const { withAccountCsrf } = await import("./session-csrf");
    const handler = vi.fn(async () => Response.json({ status: "updated" }));
    const route = withAccountCsrf("api.jurisdiction", handler);
    const response = await route(post(mintSessionCsrf(accountSession, "api.jurisdiction")));
    expect(handler).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({ status: "updated" });
    expect(verifySessionCsrf(response.headers.get("x-inherit-csrf"), accountSession, "api.jurisdiction")).not.toBeNull();
    expect(state.calls).toEqual([expect.objectContaining({ p_route_id: "api.jurisdiction", p_session_kind: "authenticated",
      p_account_id: ACCOUNT, p_session_id: SESSION })]);
  });

  it("refuses without running the handler when the database does not spend the token, or fails", async () => {
    const { withAccountCsrf } = await import("./session-csrf");
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const route = withAccountCsrf("api.jurisdiction", handler);
    for (const answer of [{ data: false, error: null }, { data: null, error: { code: "42883" } }, { data: "true", error: null }]) {
      state.answer = answer;
      const response = await route(post(mintSessionCsrf(accountSession, "api.jurisdiction")));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "request_forbidden" });
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("leaves a signed-out request to the handler and spends nothing", async () => {
    const { withAccountCsrf } = await import("./session-csrf");
    state.context = null;
    const route = withAccountCsrf("api.jurisdiction", async () => new Response("Unauthorized", { status: 401 }));
    const response = await route(post());
    expect(response.status).toBe(401);
    expect(response.headers.get("x-inherit-csrf")).toBeNull();
    expect(state.calls).toEqual([]);
  });

  it("checks the exact origin before any token is spent, when asked to", async () => {
    const { withAccountCsrf } = await import("./session-csrf");
    const route = withAccountCsrf("auth.sign-out", async () => new Response(null, { status: 303 }),
      { exactOrigin: true, rotate: false });
    const token = mintSessionCsrf(accountSession, "auth.sign-out");
    for (const origin of [null, "https://other.test"]) expect((await route(post(token, origin))).status).toBe(403);
    state.context = null;
    expect((await route(post(undefined, "https://other.test"))).status, "even with no session").toBe(403);
    expect(state.calls).toEqual([]);
    state.context = signedIn;
    const response = await route(post(token));
    expect(response.status).toBe(303);
    expect(response.headers.get("x-inherit-csrf"), "rotate: false").toBeNull();
  });

  // G8.5, 20 November 2026: api.file-delete's policy.sameOriginRequired put
  // the origin refusal before the account context is read, with the route's
  // own isSameOrigin, when the route asked (`originFirst`). Owner decision of
  // 22 November 2026 ("Change requests are refused without the browser's
  // same-origin marker, before the account is read"): the strict rule, on
  // every route the register binds, by the route's id (`./same-origin`); the
  // option is gone. Every bound route and variant is in ./same-origin.test.ts.
  it("refuses what the strict rule refuses before reading the session, on a bound route, and only there", async () => {
    const accountDeletion = await import("@/lib/account-deletion");
    const read = vi.mocked(accountDeletion.getSensitiveAccountContext);
    const { withAccountCsrf } = await import("./session-csrf");
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const route = withAccountCsrf("api.file-delete", handler);
    const token = mintSessionCsrf(accountSession, "api.file-delete");
    read.mockClear();
    for (const origin of ["https://other.test", "http://inherit.test"]) expect((await route(post(token, origin))).status).toBe(403);
    expect((await route(post(token, null))).status, "no Origin and no Sec-Fetch-Site").toBe(403);
    expect((await route(post(token))).status, "the right Origin and no Sec-Fetch-Site").toBe(403);
    expect(read, "the session was never read").not.toHaveBeenCalled();
    expect(state.calls, "no token was spent").toEqual([]);
    expect(handler).not.toHaveBeenCalled();
    // No Origin with Sec-Fetch-Site same-origin passes to the token check, as before.
    const noOrigin = post(token, null);
    noOrigin.headers.set("sec-fetch-site", "same-origin");
    expect((await route(noOrigin)).status).toBe(204);
    // The browser's own request: the right Origin and the marker.
    const browser = post(mintSessionCsrf(accountSession, "api.file-delete"));
    browser.headers.set("sec-fetch-site", "same-origin");
    expect((await route(browser)).status).toBe(204);
    // A route the register does not bind reads the session first, as before, whatever the headers say.
    read.mockClear();
    const unbound = withAccountCsrf("api.jurisdiction", handler);
    expect((await unbound(post(mintSessionCsrf(accountSession, "api.jurisdiction"), "https://other.test"))).status).toBe(204);
    expect(read).toHaveBeenCalled();
  });

  it("copies a response whose headers cannot be changed before setting the next token", async () => {
    const { withAccountCsrf } = await import("./session-csrf");
    const route = withAccountCsrf("api.jurisdiction", async () => Response.redirect(`${ORIGIN}/settings`, 303));
    const response = await route(post(mintSessionCsrf(accountSession, "api.jurisdiction")));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/settings`);
    expect(response.headers.get("x-inherit-csrf")).not.toBeNull();
  });

  it("is bound to one session kind", async () => {
    const { withAccountCsrf, withPurposeCsrf, readRightsCsrfSession } = await import("./session-csrf");
    expect(() => withAccountCsrf("api.withdraw", async () => new Response())).toThrow("not an authenticated route");
    expect(() => withPurposeCsrf("api.jurisdiction", readRightsCsrfSession, async () => new Response())).toThrow("not a purpose-session route");
  });
});

describe("requireAccountCsrf", () => {
  it("refuses a branch with no session to bind, as well as a bad token", async () => {
    const { requireAccountCsrf } = await import("./session-csrf");
    state.context = null;
    const unbound = await requireAccountCsrf(post(), "api.consents");
    expect(unbound).toBeInstanceOf(Response);
    expect((unbound as Response).status).toBe(403);
    state.context = signedIn;
    expect(await requireAccountCsrf(post("nope"), "api.consents")).toBeInstanceOf(Response);
    const admitted = await requireAccountCsrf(post(mintSessionCsrf(accountSession, "api.consents")), "api.consents");
    expect(admitted).not.toBeInstanceOf(Response);
  });
});

/**
 * G8.5, the migration stage: the five later kinds are spent by
 * public.consume_session_csrf_v2 with the values its live-row check needs;
 * the three earlier ones stay on v1 exactly as before.
 */
describe("the five later kinds' spend", () => {
  const HASH = "e".repeat(64);
  const INGEST = "5b000000-0000-4000-8000-0000000000a1";
  const reviewer = { kind: "reviewer" as const, accountId: ACCOUNT, sessionId: SESSION };

  it("spends a reviewer token through v2 with the account and its auth session, and an account token through v1", async () => {
    const { withAccountCsrf, withReviewerCsrf } = await import("./session-csrf");
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    expect((await withReviewerCsrf("api.appeal-review", handler)(post(mintSessionCsrf(reviewer, "api.appeal-review")))).status).toBe(204);
    expect((await withAccountCsrf("api.jurisdiction", handler)(post(mintSessionCsrf(accountSession, "api.jurisdiction")))).status).toBe(204);
    expect(state.names).toEqual(["consume_session_csrf_v2", "consume_session_csrf_v1"]);
    expect(state.calls[0]).toEqual(expect.objectContaining({ p_route_id: "api.appeal-review", p_session_kind: "reviewer",
      p_account_id: ACCOUNT, p_session_id: SESSION, p_cookie_hash: null, p_purpose_session_id: null }));
    // A reviewer's token never stands in for an account's, nor the reverse.
    state.calls.length = 0;
    expect((await withReviewerCsrf("api.appeal-review", handler)(post(mintSessionCsrf(accountSession, "api.jurisdiction")))).status).toBe(404);
    expect((await withAccountCsrf("api.jurisdiction", handler)(post(mintSessionCsrf(reviewer, "api.appeal-review")))).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it("spends an upload session's token with the cookie hash and the session id the path names", async () => {
    const { withPurposeCsrf } = await import("./session-csrf");
    const read = vi.fn(async (_request: Request, context: { params: Promise<{ session: string }> }) =>
      ({ kind: "upload-session" as const, sessionHash: HASH, sessionId: (await context.params).session }));
    const route = withPurposeCsrf("api.embryo-ingest-complete", read, async () => new Response(null, { status: 204 }));
    const token = mintSessionCsrf({ kind: "upload-session", sessionHash: HASH, sessionId: INGEST }, "api.embryo-ingest-complete");
    const response = await route(post(token), { params: Promise.resolve({ session: INGEST }) });
    expect(response.status).toBe(204);
    expect(read).toHaveBeenCalledOnce();
    expect(state.calls).toEqual([expect.objectContaining({ p_session_kind: "upload-session", p_account_id: null, p_session_id: null,
      p_cookie_hash: HASH, p_purpose_session_id: INGEST })]);
    // The same token presented for another session the path names is refused before any spend.
    state.calls.length = 0;
    const other = await route(post(token), { params: Promise.resolve({ session: "5b000000-0000-4000-8000-0000000000a2" }) });
    expect(other.status).toBe(404);
    expect(state.calls).toEqual([]);
  });

  it("falls back to v1 under the kind whose rule it shares only while v2 is absent, and refuses on any other error", async () => {
    const { withPurposeCsrf, withReviewerCsrf } = await import("./session-csrf");
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const claim = withPurposeCsrf("api.future-person-claim-complete", () => ({ kind: "claim-session" as const, sessionHash: HASH }), handler);
    state.v2 = { data: null, error: { code: "PGRST202" } };
    expect((await claim(post(mintSessionCsrf({ kind: "claim-session", sessionHash: HASH }, "api.future-person-claim-complete")))).status).toBe(204);
    expect(state.names).toEqual(["consume_session_csrf_v2", "consume_session_csrf_v1"]);
    expect(state.calls[1]).toEqual(expect.objectContaining({ p_session_kind: "token", p_account_id: null, p_session_id: null }));
    state.calls.length = 0; state.names.length = 0;
    expect((await withReviewerCsrf("api.appeal-review", handler)(post(mintSessionCsrf(reviewer, "api.appeal-review")))).status).toBe(204);
    expect(state.calls[1]).toEqual(expect.objectContaining({ p_session_kind: "authenticated", p_account_id: ACCOUNT, p_session_id: SESSION }));
    handler.mockClear(); state.calls.length = 0; state.names.length = 0;
    for (const error of [{ code: "42501" }, { code: "22023" }, { code: "XX000" }]) {
      state.v2 = { data: null, error };
      const response = await claim(post(mintSessionCsrf({ kind: "claim-session", sessionHash: HASH }, "api.future-person-claim-complete")));
      expect(response.status, error.code).toBe(404);
    }
    state.v2 = { data: false, error: null };
    expect((await claim(post(mintSessionCsrf({ kind: "claim-session", sessionHash: HASH }, "api.future-person-claim-complete")))).status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
    expect(state.names.every(name => name === "consume_session_csrf_v2")).toBe(true);
  });

  it("verifies a chunk stream's value on every chunk and never spends or rotates it (principle 3)", async () => {
    const { withPurposeCsrf } = await import("./session-csrf");
    const evidence = { kind: "evidence-session" as const, sessionHash: HASH, sessionId: INGEST };
    const route = withPurposeCsrf("api.evidence-chunk", () => evidence, async () => new Response(null, { status: 204 }));
    const value = mintSessionCsrf(evidence, "api.evidence-chunk");
    for (let chunk = 0; chunk < 3; chunk++) {
      const response = await route(post(value));
      expect(response.status).toBe(204);
      expect(response.headers.get("x-inherit-csrf")).toBeNull();
    }
    expect(state.calls).toEqual([]);
    expect((await route(post(mintSessionCsrf(evidence, "api.evidence-complete")))).status).toBe(404);
    expect((await route(post(mintSessionCsrf({ ...evidence, sessionId: "5b000000-0000-4000-8000-0000000000a2" }, "api.evidence-chunk")))).status).toBe(404);
    expect((await route(post())).status).toBe(404);
  });

  it("mints the successor for the session a rotating answer names, and issues none where the answer ends the session", async () => {
    const { answerForRotatedSession, withPurposeCsrf } = await import("./session-csrf");
    const claim = { kind: "claim-session" as const, sessionHash: HASH };
    const rotated = { kind: "claim-session" as const, sessionHash: "f".repeat(64) };
    const route = withPurposeCsrf("api.future-person-claim-document-session", () => claim,
      async () => answerForRotatedSession(new Response(null, { status: 201 }), rotated));
    const response = await route(post(mintSessionCsrf(claim, "api.future-person-claim-document-session")));
    const next = response.headers.get("x-inherit-csrf");
    expect(verifySessionCsrf(next, rotated, "api.future-person-claim-document-session")).not.toBeNull();
    expect(verifySessionCsrf(next, claim, "api.future-person-claim-document-session")).toBeNull();
    const reset = { kind: "reset-session" as const, sessionHash: HASH };
    let status = 204;
    const submit = withPurposeCsrf("auth.reset-password-submit", () => reset, async () => new Response(null, { status }),
      { rotate: (answer) => answer.status !== 204 });
    expect((await submit(post(mintSessionCsrf(reset, "auth.reset-password-submit")))).headers.get("x-inherit-csrf")).toBeNull();
    status = 422;
    const refused = await submit(post(mintSessionCsrf(reset, "auth.reset-password-submit")));
    expect(verifySessionCsrf(refused.headers.get("x-inherit-csrf"), reset, "auth.reset-password-submit")).not.toBeNull();
  });
});

describe("the claim-objection address, which takes either kind of session", () => {
  const RIGHTS = "R".repeat(43);
  const rights = { kind: "token" as const, sessionHash: crypto.createHash("sha256").update(RIGHTS, "utf8").digest("hex") };
  const withRights = (token?: string) => {
    const request = post(token);
    const headers = new Headers(request.headers);
    headers.set("cookie", `inherit-rights=${RIGHTS}`);
    return new Request(request.url, { method: "PUT", headers });
  };

  it("spends a rights token for the rights session first, an account token for the signed-in account second, and tells the handler which", async () => {
    const { withRightsOrAccountCsrf } = await import("./session-csrf");
    const seen: (string | null)[] = [];
    const route = withRightsOrAccountCsrf("api.future-person-claim-objection", async (_request, session) => {
      seen.push(session?.kind ?? null); return new Response(null, { status: 202 });
    });
    expect((await route(withRights(mintSessionCsrf(rights, "api.future-person-claim-objection")))).status).toBe(202);
    expect((await route(withRights(mintSessionCsrf(accountSession, "api.future-person-claim-objection")))).status).toBe(202);
    expect((await route(post(mintSessionCsrf(accountSession, "api.future-person-claim-objection")))).status).toBe(202);
    expect(seen).toEqual(["token", "authenticated", "authenticated"]);
    expect(state.calls.map(call => call.p_session_kind)).toEqual(["token", "authenticated", "authenticated"]);
  });

  it("refuses a missing, foreign or other-route token with the route's 404, and leaves a request with neither session to the handler", async () => {
    const { withRightsOrAccountCsrf } = await import("./session-csrf");
    const handler = vi.fn(async () => new Response(null, { status: 202 }));
    const route = withRightsOrAccountCsrf("api.future-person-claim-objection", handler);
    for (const request of [withRights(), withRights(mintSessionCsrf(rights, "api.withdraw")), post(),
      post(mintSessionCsrf(accountSession, "api.jurisdiction"))]) {
      const response = await route(request);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    expect(handler).not.toHaveBeenCalled();
    state.context = null;
    expect((await route(post())).status).toBe(202);
    expect(handler).toHaveBeenCalledWith(expect.any(Request), null);
    expect(state.calls).toEqual([]);
    expect(() => withRightsOrAccountCsrf("api.withdraw", handler)).toThrow("does not take a rights or an account session");
  });
});

/**
 * Owner decision of 22 November 2026, "G8.5: the reviewer chunk-acknowledgement
 * address accepts either kind of session".
 */
describe("the reviewer chunk-acknowledgement address, which takes either kind of session", () => {
  const ROUTE = "api.claim-review-chunk-acknowledgement" as const;
  const reviewerSession = { kind: "reviewer" as const, accountId: ACCOUNT, sessionId: SESSION };

  it("spends a reviewer token for the reviewer first and an account token for the account second, and tells the handler which", async () => {
    const { withReviewerOrAccountCsrf } = await import("./session-csrf");
    const seen: (string | null)[] = [];
    const route = withReviewerOrAccountCsrf(ROUTE, async (_request, session) => {
      seen.push(session?.kind ?? null); return new Response(null, { status: 204 });
    });
    const reviewerAnswer = await route(post(mintSessionCsrf(reviewerSession, ROUTE)));
    const accountAnswer = await route(post(mintSessionCsrf(accountSession, ROUTE)));
    expect([reviewerAnswer.status, accountAnswer.status]).toEqual([204, 204]);
    expect(seen).toEqual(["reviewer", "authenticated"]);
    expect(state.calls.map(call => call.p_session_kind)).toEqual(["reviewer", "authenticated"]);
    expect(state.names).toEqual(["consume_session_csrf_v2", "consume_session_csrf_v1"]);
    // Each answer's successor is minted for the kind it spent, so each chain stays its own.
    expect(verifySessionCsrf(reviewerAnswer.headers.get("x-inherit-csrf"), reviewerSession, ROUTE)).not.toBeNull();
    expect(verifySessionCsrf(accountAnswer.headers.get("x-inherit-csrf"), accountSession, ROUTE)).not.toBeNull();
    expect(verifySessionCsrf(accountAnswer.headers.get("x-inherit-csrf"), reviewerSession, ROUTE)).toBeNull();
  });

  it("refuses a missing, foreign, other-route or other-kind token with the route's 404, and leaves a signed-out request to the handler", async () => {
    const { withReviewerOrAccountCsrf } = await import("./session-csrf");
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const route = withReviewerOrAccountCsrf(ROUTE, handler);
    const foreign = "5b000000-0000-4000-8000-000000000012";
    for (const token of [undefined, "0".repeat(64),
      mintSessionCsrf({ ...reviewerSession, sessionId: foreign }, ROUTE), mintSessionCsrf({ ...accountSession, sessionId: foreign }, ROUTE),
      mintSessionCsrf(reviewerSession, "api.claim-review-receipt"), mintSessionCsrf(accountSession, "api.export"),
      mintSessionCsrf(accountSession, "api.future-person-claim-objection")]) {
      const response = await route(post(token));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    expect(handler).not.toHaveBeenCalled();
    expect(state.calls).toEqual([]);
    state.context = null;
    expect((await route(post())).status).toBe(204);
    expect(handler).toHaveBeenCalledWith(expect.any(Request), null);
    expect(state.calls).toEqual([]);
    expect(() => withReviewerOrAccountCsrf("api.appeal-review", handler)).toThrow("does not take a reviewer or an account session");
    expect(() => withReviewerOrAccountCsrf("api.future-person-claim-objection", handler)).toThrow("does not take a reviewer or an account session");
  });
});

describe("the rendered tokens", () => {
  it("mints one token per shell route for the live session, and none for a signed-out request", async () => {
    const { SHELL_CSRF_ROUTES, accountCsrfTokens } = await import("./session-csrf");
    const tokens = await accountCsrfTokens();
    expect(Object.keys(tokens).sort()).toEqual([...SHELL_CSRF_ROUTES].sort());
    for (const route of SHELL_CSRF_ROUTES) expect(verifySessionCsrf(tokens[route], accountSession, route)).not.toBeNull();
    expect(state.calls, "rendering stores nothing").toEqual([]);
    state.context = null;
    expect(await accountCsrfTokens()).toEqual({});
  });
});
