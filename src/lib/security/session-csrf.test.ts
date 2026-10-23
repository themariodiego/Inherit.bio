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
  calls: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/account-deletion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-deletion")>()),
  getSensitiveAccountContext: vi.fn(async () => state.context),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: async (_name: string, args: Record<string, unknown>) => { state.calls.push(args); return state.answer; } }),
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
  state.calls.length = 0;
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
