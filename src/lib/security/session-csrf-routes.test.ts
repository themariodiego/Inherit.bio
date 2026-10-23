import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { csrfHeaderRequired as csrfHeaderRequiredOf } from "../../../scripts/form-contract-census";
import { SESSION_CSRF_ROUTES, mintSessionCsrf, verifySessionCsrf, type CsrfRoute, type CsrfSession } from "./session-csrf-core";

/**
 * Every route the one-time `X-Inherit-CSRF` token guards
 * (`SESSION_CSRF_ROUTES`), driven through its real route handler: a request
 * with no token, with a token already spent, with a token of another session
 * and with a token of another purpose is refused with the register's answer
 * (403 `request_forbidden` for an authenticated route, `authenticated-mutation-v1`;
 * 404 `not_found` for a purpose-session route, `token-api-v1` and
 * `token-candidate-api-v1`) before the handler runs, and the same request
 * with a fresh token reaches the handler and comes back carrying the next
 * token. The database's one spend (`public.consume_session_csrf_v1`) is
 * played by an in-memory double that keeps the same two rules: one spend per
 * hash, and an authenticated token only while its auth session is live.
 * `supabase/tests/session_csrf_tokens.sql` holds the real function to them.
 */

const KEY = Buffer.alloc(32, 11).toString("base64");
const ORIGIN = "https://inherit.test";
const ACCOUNT = "5a000000-0000-4000-8000-000000000001";
const SESSION = "5a000000-0000-4000-8000-000000000011";
const OTHER_SESSION = "5a000000-0000-4000-8000-000000000012";
const ID = "5a000000-0000-4000-8000-0000000000aa";
const RIGHTS_COOKIE_VALUE = "R".repeat(43);
const CANDIDATE_COOKIE_VALUE = "C".repeat(43);
const sha256 = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

const state = vi.hoisted(() => ({
  signedIn: true,
  spent: new Set<string>(),
  liveSessions: new Set<string>(),
  consumeCalls: [] as Record<string, unknown>[],
  consumeResults: [] as boolean[],
  /** Each time a handler reads the request body or reaches a database or auth client: the gate does neither. */
  touches: 0,
}));

/**
 * An inert query or RPC, so a handler that gets past the gate stops early: an
 * RPC chain resolves to a refusal, a table read to nothing found.
 */
function inert(kind: "rpc" | "read" = "rpc"): unknown {
  const result = kind === "rpc"
    ? { data: null, error: { code: "XX000", message: "inert test double" }, count: null, status: 500 }
    : { data: null, error: null, count: 0, status: 200 };
  const proxy: unknown = new Proxy(function () {}, {
    get: (_target, property) => property === "then"
      ? (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
      : () => proxy,
    apply: () => proxy,
  });
  return proxy;
}

/** The routes whose admitted response issues no successor: each ends the session the next token would be bound to. */
const NO_SUCCESSOR = new Set<CsrfRoute>(["auth.sign-out", "api.rights-activate"]);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name !== "consume_session_csrf_v1") { state.touches += 1; return inert(); }
      state.consumeCalls.push(args);
      const live = args.p_session_kind !== "authenticated" || state.liveSessions.has(`${args.p_account_id}|${args.p_session_id}`);
      const hash = String(args.p_token_hash);
      const fresh = live && !state.spent.has(hash);
      if (fresh) state.spent.add(hash);
      state.consumeResults.push(fresh);
      return Promise.resolve({ data: fresh, error: null });
    },
    from: () => { state.touches += 1; return inert("read"); },
    get storage() { state.touches += 1; return inert(); },
    get auth() { state.touches += 1; return inert(); },
  }),
}));

vi.mock("@/lib/account-deletion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-deletion")>()),
  getSensitiveAccountContext: vi.fn(async () => state.signedIn
    ? { user: { id: ACCOUNT, email: "csrf-routes@example.invalid", email_confirmed_at: "2026-10-01T00:00:00Z" }, sessionId: SESSION }
    : null),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => (state.touches += 1, {
    auth: {
      getUser: async () => ({ data: { user: state.signedIn ? { id: ACCOUNT, email: "csrf-routes@example.invalid" } : null }, error: null }),
      getClaims: async () => ({ data: state.signedIn ? { claims: { sub: ACCOUNT, session_id: SESSION } } : null, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signOut: async () => ({ error: null }),
    },
    from: () => inert("read"),
    rpc: () => inert(),
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined, delete: () => undefined, has: () => false }),
  headers: async () => new Headers(),
}));

type Kind = "authenticated" | "token" | "token-candidate";
interface Case {
  /** The route whose token the request carries. */
  route: CsrfRoute;
  label?: string;
  method: "POST" | "PUT" | "DELETE";
  path: string;
  load: () => Promise<Record<string, unknown>>;
  params?: Record<string, string>;
  body?: string | null;
}

const CASES: Case[] = [
  { route: "auth.sign-out", method: "POST", path: "/auth/sign-out", load: () => import("@/app/auth/sign-out/route"), body: null },
  { route: "api.account-delete", method: "POST", path: "/api/account/delete", load: () => import("@/app/api/account/delete/route") },
  { route: "api.account-delete-cancel", method: "POST", path: "/api/account/delete/cancel", load: () => import("@/app/api/account/delete/cancel/route") },
  { route: "api.chat", method: "POST", path: "/api/chat", load: () => import("@/app/api/chat/route") },
  { route: "api.browse-region", method: "POST", path: "/api/browse/region", load: () => import("@/app/api/browse/region/route") },
  { route: "api.file-process", method: "POST", path: `/api/files/${ID}/process`, params: { id: ID }, load: () => import("@/app/api/files/[id]/process/route"), body: null },
  { route: "api.file-upload-session", method: "POST", path: "/api/files/upload-session", load: () => import("@/app/api/files/upload-session/route") },
  { route: "api.subject-upload-issue", method: "POST", path: "/api/uploads", load: () => import("@/app/api/uploads/route") },
  { route: "api.subject-upload-complete", method: "POST", path: `/api/uploads/${ID}/complete`, params: { id: ID }, load: () => import("@/app/api/uploads/[id]/complete/route"), body: null },
  { route: "api.file-delete", method: "DELETE", path: `/api/files/${ID}`, params: { id: ID }, load: () => import("@/app/api/files/[id]/route"), body: null },
  { route: "api.file-finalize", method: "POST", path: `/api/files/${ID}/finalize`, params: { id: ID }, load: () => import("@/app/api/files/[id]/finalize/route"), body: null },
  { route: "api.llm-settings", method: "POST", path: "/api/llm/settings", load: () => import("@/app/api/llm/settings/route") },
  { route: "api.llm-settings", method: "DELETE", path: "/api/llm/settings", load: () => import("@/app/api/llm/settings/route"), body: null },
  { route: "api.subject-drafts", label: "api.subject-drafts (Path A)", method: "POST", path: "/api/subject-drafts", load: () => import("@/app/api/subject-drafts/route") },
  { route: "api.subject-transfer", method: "POST", path: `/api/subjects/${ID}/transfer`, params: { id: ID }, load: () => import("@/app/api/subjects/[id]/transfer/route") },
  { route: "api.subject-delete", method: "DELETE", path: `/api/subjects/${ID}`, params: { id: ID }, load: () => import("@/app/api/subjects/[id]/route"), body: null },
  { route: "api.subject-sharing", method: "POST", path: `/api/subjects/${ID}/sharing`, params: { id: ID }, load: () => import("@/app/api/subjects/[id]/sharing/route") },
  { route: "api.chromosomal-sex", method: "POST", path: "/api/chromosomal-sex", load: () => import("@/app/api/chromosomal-sex/route") },
  { route: "api.family-acknowledge", method: "POST", path: "/api/family/acknowledge", load: () => import("@/app/api/family/acknowledge/route") },
  { route: "api.family-sharing", method: "POST", path: "/api/family/s-person/sharing", params: { person: "s-person" }, load: () => import("@/app/api/family/[person]/sharing/route") },
  { route: "api.consents", label: "api.consents (the provider and adult grant bodies)", method: "POST", path: "/api/consents", load: () => import("@/app/api/consents/route") },
  { route: "api.consent-reaffirm", method: "POST", path: "/api/consents/reaffirm", load: () => import("@/app/api/consents/reaffirm/route") },
  { route: "api.consent-revoke", method: "POST", path: `/api/consents/${ID}/revoke`, params: { id: ID }, load: () => import("@/app/api/consents/[id]/revoke/route"), body: null },
  { route: "api.consents-revoke-all", method: "POST", path: "/api/consents/revoke-all", load: () => import("@/app/api/consents/revoke-all/route") },
  { route: "api.invitation-accept", method: "POST", path: "/api/invitations/accept", load: () => import("@/app/api/invitations/accept/route") },
  { route: "api.adult-subject-bind", method: "POST", path: "/api/subjects/bind/session", load: () => import("@/app/api/subjects/bind/session/route") },
  { route: "api.embryo-cohorts", method: "POST", path: "/api/embryo-cohorts", load: () => import("@/app/api/embryo-cohorts/route") },
  { route: "api.embryo-record-key-cards", method: "POST", path: `/api/embryo-cohorts/${ID}/record-key-cards`, params: { id: ID }, load: () => import("@/app/api/embryo-cohorts/[id]/record-key-cards/route") },
  { route: "api.embryo-disposition", method: "POST", path: `/api/embryos/${ID}/disposition`, params: { id: ID }, load: () => import("@/app/api/embryos/[id]/disposition/route") },
  { route: "api.cohort-restrict", method: "POST", path: `/api/cohorts/${ID}/restrict`, params: { id: ID }, load: () => import("@/app/api/cohorts/[id]/restrict/route"), body: null },
  { route: "api.cohort-restrict", label: "api.embryo-withdraw (policy.aliasOf api.cohort-restrict)", method: "POST", path: `/api/embryo-cohorts/${ID}/withdraw`, params: { id: ID }, load: () => import("@/app/api/embryo-cohorts/[id]/withdraw/route"), body: null },
  { route: "api.claimed-subject-correction", method: "POST", path: `/api/subjects/${ID}/corrections`, params: { id: ID }, load: () => import("@/app/api/subjects/[id]/corrections/route") },
  { route: "api.claimed-subject-analysis-stop", method: "DELETE", path: `/api/subjects/${ID}/analysis`, params: { id: ID }, load: () => import("@/app/api/subjects/[id]/analysis/route"), body: null },
  { route: "api.jurisdiction", method: "PUT", path: "/api/settings/jurisdiction", load: () => import("@/app/api/settings/jurisdiction/route") },
  { route: "api.withdraw", method: "POST", path: "/api/withdraw/session", load: () => import("@/app/api/withdraw/session/route") },
  { route: "api.consent-reaffirm-rights", method: "POST", path: "/api/consents/reaffirm/session", load: () => import("@/app/api/consents/reaffirm/session/route") },
  { route: "api.consent-grant-rights", method: "POST", path: "/api/consents/grant/session", load: () => import("@/app/api/consents/grant/session/route") },
  { route: "api.consent-revoke-rights", method: "POST", path: "/api/consents/revoke/session", load: () => import("@/app/api/consents/revoke/session/route") },
  { route: "api.rights-activate", method: "POST", path: "/api/rights/activate", load: () => import("@/app/api/rights/activate/route") },
];

const kindOf = (route: CsrfRoute): Kind => SESSION_CSRF_ROUTES[route];
const sessionFor = (kind: Kind): CsrfSession => kind === "authenticated"
  ? { kind, accountId: ACCOUNT, sessionId: SESSION }
  : kind === "token" ? { kind, sessionHash: sha256(RIGHTS_COOKIE_VALUE) } : { kind, sessionHash: sha256(CANDIDATE_COOKIE_VALUE) };
/** A token of the same kind of session, for the same account or cookie holder, but not this session. */
const otherSessionFor = (kind: Kind): CsrfSession => kind === "authenticated"
  ? { kind, accountId: ACCOUNT, sessionId: OTHER_SESSION }
  : { kind, sessionHash: sha256(kind === "token" ? CANDIDATE_COOKIE_VALUE : RIGHTS_COOKIE_VALUE) };
/** The same session's token for another route, or for this cookie under another purpose session. */
function otherPurposeToken(route: CsrfRoute): string {
  const kind = kindOf(route);
  if (kind === "authenticated") return mintSessionCsrf(sessionFor(kind), route === "api.chat" ? "api.jurisdiction" : "api.chat");
  if (kind === "token") return mintSessionCsrf(sessionFor(kind), route === "api.withdraw" ? "api.consent-revoke-rights" : "api.withdraw");
  return mintSessionCsrf({ kind: "token", sessionHash: sha256(CANDIDATE_COOKIE_VALUE) }, "api.withdraw");
}

function request(entry: Case, token: string | null): Request {
  const headers = new Headers({ origin: ORIGIN, "sec-fetch-site": "same-origin" });
  const kind = kindOf(entry.route);
  if (kind === "token") headers.set("cookie", `inherit-rights=${RIGHTS_COOKIE_VALUE}`);
  if (kind === "token-candidate") headers.set("cookie", `inherit-rights-candidate=${CANDIDATE_COOKIE_VALUE}`);
  const body = entry.body === null ? undefined : entry.body ?? "{}";
  if (body !== undefined) headers.set("content-type", "application/json");
  if (token !== null) headers.set("x-inherit-csrf", token);
  const sent = new Request(`${ORIGIN}${entry.path}`, { method: entry.method, headers, body });
  // Reading the body is the handler's work too: the gate reads headers only.
  for (const name of ["json", "text", "arrayBuffer", "formData", "blob", "bytes", "clone"] as const) {
    if (typeof sent[name] !== "function") continue;
    const read = (sent[name] as (...args: unknown[]) => unknown).bind(sent);
    Object.defineProperty(sent, name, { value: (...args: unknown[]) => { state.touches += 1; return read(...args); } });
  }
  const stream = Object.getOwnPropertyDescriptor(Request.prototype, "body")!.get!.bind(sent);
  Object.defineProperty(sent, "body", { get: () => { state.touches += 1; return stream(); } });
  return sent;
}

async function send(entry: Case, token: string | null): Promise<Response> {
  const loaded = await entry.load();
  const handler = loaded[entry.method] as (request: Request, context?: unknown) => Promise<Response>;
  expect(typeof handler, `${entry.path} exports ${entry.method}`).toBe("function");
  return handler(request(entry, token), { params: Promise.resolve(entry.params ?? {}) });
}

async function expectRefused(entry: Case, response: Response) {
  expect(response.headers.get("x-inherit-csrf"), "a refusal issues no successor").toBeNull();
  if (kindOf(entry.route) === "authenticated") {
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "request_forbidden" });
  } else {
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  }
}

/** The two branches that spend the token inside the handler, after reading their own request. */
const INLINE = new Set<CsrfRoute>(["api.consents", "api.subject-drafts"]);

/**
 * Sends `token` and requires the register's refusal before the handler ran:
 * no database or auth client reached at all, or, for an inline branch, no
 * more than the same request without a token reaches. A handler whose own
 * answer looks like the refusal still fails this.
 */
async function expectRefusedBeforeHandler(entry: Case, token: string | null) {
  state.touches = 0;
  await expectRefused(entry, await send(entry, token));
  const touches = state.touches;
  let baseline = 0;
  if (INLINE.has(entry.route)) {
    state.touches = 0;
    await expectRefused(entry, await send(entry, null));
    baseline = state.touches;
  }
  expect(touches, "the handler did not run").toBe(baseline);
}

beforeEach(() => {
  vi.stubEnv("BYOK_ENCRYPTION_KEY", KEY);
  state.signedIn = true;
  state.spent.clear();
  state.consumeCalls.length = 0;
  state.consumeResults.length = 0;
  state.touches = 0;
  state.liveSessions.clear();
  state.liveSessions.add(`${ACCOUNT}|${SESSION}`);
  state.liveSessions.add(`${ACCOUNT}|${OTHER_SESSION}`);
});
afterEach(() => vi.unstubAllEnvs());

describe("every bound route requires and spends its one-time X-Inherit-CSRF token", () => {
  it("drives every route the token guards, and only those", () => {
    expect([...new Set(CASES.map((entry) => entry.route))].sort()).toEqual(Object.keys(SESSION_CSRF_ROUTES).sort());
  });

  describe.each(CASES.map((entry) => [entry.label ?? `${entry.route} ${entry.method}`, entry] as const))("%s", (_name, entry) => {
    const session = () => sessionFor(kindOf(entry.route));

    it("refuses a request without the token before the handler runs", async () => {
      await expectRefusedBeforeHandler(entry, null);
      expect(state.consumeCalls).toHaveLength(0);
    });

    it("refuses a token that was already spent", async () => {
      const token = mintSessionCsrf(session(), entry.route);
      const first = await send(entry, token);
      if (!NO_SUCCESSOR.has(entry.route)) expect(first.headers.get("x-inherit-csrf"), "the first use is admitted").not.toBeNull();
      await expectRefusedBeforeHandler(entry, token);
      expect(state.consumeResults, "spent the first time, refused the second").toEqual([true, false]);
    });

    it("refuses a token of another session", async () => {
      await expectRefusedBeforeHandler(entry, mintSessionCsrf(otherSessionFor(kindOf(entry.route)), entry.route));
      expect(state.consumeCalls).toHaveLength(0);
    });

    it("refuses a token of another purpose", async () => {
      await expectRefusedBeforeHandler(entry, otherPurposeToken(entry.route));
      expect(state.consumeCalls).toHaveLength(0);
    });

    it("admits the same request with a fresh token, spends it once and issues the next one", async () => {
      const token = mintSessionCsrf(session(), entry.route);
      const response = await send(entry, token);
      const next = response.headers.get("x-inherit-csrf");
      // Sign-out and the activation each end the session a successor would be
      // bound to, so they issue none.
      if (NO_SUCCESSOR.has(entry.route)) {
        if (entry.route === "auth.sign-out") expect(response.status).toBe(303);
        expect(next).toBeNull();
      } else {
        expect(next).not.toBe(token);
        expect(verifySessionCsrf(next, session(), entry.route)).not.toBeNull();
      }
      expect(state.consumeCalls).toEqual([expect.objectContaining({
        p_route_id: entry.route, p_session_kind: kindOf(entry.route), p_token_hash: sha256(token),
      })]);
      expect(state.consumeResults).toEqual([true]);
    });
  });

  it("refuses an authenticated token once its auth session has ended", async () => {
    const entry = CASES.find((candidate) => candidate.route === "api.jurisdiction")!;
    const token = mintSessionCsrf(sessionFor("authenticated"), "api.jurisdiction");
    state.liveSessions.clear();
    await expectRefusedBeforeHandler(entry, token);
  });

  it("leaves a request with no session to its handler's own answer, spending nothing", async () => {
    state.signedIn = false;
    for (const entry of CASES.filter((candidate) => kindOf(candidate.route) === "authenticated")) {
      const response = await send(entry, null);
      expect(response.status, entry.path).not.toBe(403);
    }
    expect(state.consumeCalls).toHaveLength(0);
  });

  it("refuses a sign-out from any other origin, token or not", async () => {
    const entry = CASES.find((candidate) => candidate.route === "auth.sign-out")!;
    const loaded = await entry.load();
    const post = loaded.POST as (request: Request) => Promise<Response>;
    const token = mintSessionCsrf(sessionFor("authenticated"), "auth.sign-out");
    for (const origin of [null, "https://elsewhere.test", "http://inherit.test"]) {
      const headers = new Headers({ "x-inherit-csrf": token, "sec-fetch-site": "same-origin" });
      if (origin) headers.set("origin", origin);
      const response = await post(new Request(`${ORIGIN}/auth/sign-out`, { method: "POST", headers }));
      expect(response.status, String(origin)).toBe(403);
      expect(await response.json()).toEqual({ error: "request_forbidden" });
    }
    expect(state.consumeCalls).toHaveLength(0);
    const signedOut = await post(new Request(`${ORIGIN}/auth/sign-out`, { method: "POST",
      headers: { origin: ORIGIN, "x-inherit-csrf": token } }));
    expect(signedOut.status).toBe(303);
    expect(signedOut.headers.get("location")).toBe(`${ORIGIN}/auth/sign-in`);
  });

  it("wraps every whole route it guards, so the check cannot be skipped by a refactor of one handler", async () => {
    const { SESSION_CSRF_GUARD } = await import("./session-csrf");
    // api.consents and api.subject-drafts check the token inside the branches
    // they answer themselves; their other branches keep their own page's token.
    for (const entry of CASES.filter((candidate) => !INLINE.has(candidate.route))) {
      const loaded = await entry.load();
      expect((loaded[entry.method] as Record<symbol, unknown>)[SESSION_CSRF_GUARD], entry.path).toBe(entry.route);
    }
    for (const file of ["src/app/api/consents/route.ts", "src/app/api/subject-drafts/route.ts"]) {
      expect(readFileSync(file, "utf8")).toMatch(/(?:requireAccountCsrf|admitAccountCsrf)\(request, "api\.(?:consents|subject-drafts)"\)/u);
    }
  });
});

/**
 * The register's side. Every route `mutationSecurityBindings.csrfTransport`
 * binds is accounted for exactly once: guarded by the one-time session token
 * (`SESSION_CSRF_ROUTES`), an alias of one that is (`policy.aliasOf`), or one
 * of the routes whose X-Inherit-CSRF is still of its own design, each recorded
 * in `docs/register-contract-divergence.json#csrfOwnDesign` with the literal it
 * is read from.
 */
describe("every route the register binds to csrfTransport is accounted for", () => {
  type RegisterRoute = { id: string; auth?: string; methods?: string[]; policy?: { aliasOf?: string } };
  type OwnDesign = { routeId: string; file: string; literal: string; kind: string; value: string; oneTime: string; branch?: boolean };
  const register = JSON.parse(readFileSync("docs/route-register.json", "utf8")) as Parameters<typeof csrfHeaderRequiredOf>[2] & { routes: RegisterRoute[] };
  const own = (JSON.parse(readFileSync("docs/register-contract-divergence.json", "utf8")) as { csrfOwnDesign: OwnDesign[] }).csrfOwnDesign;
  const routes: RegisterRoute[] = register.routes;
  const bound = routes.filter(route => (route.methods ?? []).some(method => csrfHeaderRequiredOf(route as never, method, register)));

  it("guards each route of SESSION_CSRF_ROUTES as the register authenticates it", () => {
    for (const [route, kind] of Object.entries(SESSION_CSRF_ROUTES)) {
      const entry = routes.find(candidate => candidate.id === route);
      expect(entry?.auth, route).toBe(kind);
      expect(bound.map(candidate => candidate.id), route).toContain(route);
    }
  });

  it("accounts for every bound route once, in both directions", () => {
    const guarded = new Set(Object.keys(SESSION_CSRF_ROUTES));
    const aliases = bound.filter(route => route.policy?.aliasOf && guarded.has(route.policy.aliasOf)).map(route => route.id);
    const ownWhole = own.filter(row => !row.branch).map(row => row.routeId);
    expect(new Set(ownWhole).size, "one row per route").toBe(ownWhole.length);
    const accounted = [...guarded, ...aliases, ...ownWhole].sort();
    expect(accounted).toEqual(bound.map(route => route.id).sort());
    expect(aliases).toEqual(["api.embryo-withdraw"]);
    // A branch row names a route the session token guards for its other bodies.
    for (const row of own.filter(candidate => candidate.branch)) expect(guarded.has(row.routeId), row.routeId).toBe(true);
    expect(bound).toHaveLength(74);
    expect(ownWhole).toHaveLength(36);
  });

  it("anchors each own-design row to the code it describes", () => {
    for (const row of own) {
      expect(["digest-not-one-time", "operation-token", "derived-one-time", "none"], row.routeId).toContain(row.kind);
      expect(readFileSync(row.file, "utf8").includes(row.literal), `${row.routeId}: ${row.file}`).toBe(true);
      expect(row.value.length, row.routeId).toBeGreaterThan(20);
      expect(row.oneTime.length, row.routeId).toBeGreaterThan(5);
    }
  });
});
