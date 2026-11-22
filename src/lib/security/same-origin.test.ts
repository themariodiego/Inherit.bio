import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_CSRF_ROUTES, mintSessionCsrf, type CsrfRoute } from "./session-csrf-core";

/**
 * `policy.sameOriginRequired`, strictly (owner decision of 22 November 2026,
 * "Change requests are refused without the browser's same-origin marker,
 * before the account is read"). The set of bound routes is read from the
 * register and held equal to the one the code enforces; the rule is driven
 * through the CSRF wrapper of every account route and through the real
 * handlers of the bound ones. The proxy's half is in `src/proxy.test.ts`.
 * Every value is synthetic.
 */

const KEY = Buffer.alloc(32, 14).toString("base64");
const ORIGIN = "https://inherit.test";
const ACCOUNT = "5c000000-0000-4000-8000-000000000001";
const SESSION = "5c000000-0000-4000-8000-000000000011";
const FILE = "5c000000-0000-4000-8000-0000000000aa";

const state = vi.hoisted(() => ({
  /** Each read of the account context, through the shared reader or a route's own client. */
  contextReads: 0,
  /** Each admin client the request reaches: the token spend and every database call. */
  adminReads: 0,
  /** Each read of the request body. */
  bodyReads: 0,
}));

vi.mock("@/lib/account-deletion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-deletion")>()),
  getSensitiveAccountContext: vi.fn(async () => {
    state.contextReads += 1;
    return { user: { id: ACCOUNT, email: "same-origin@example.invalid" }, sessionId: SESSION };
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    state.contextReads += 1;
    return {
      auth: {
        getUser: async () => ({ data: { user: { id: ACCOUNT } }, error: null }),
        getClaims: async () => ({ data: { claims: { sub: ACCOUNT, session_id: SESSION } }, error: null }),
        getSession: async () => ({ data: { session: null }, error: null }),
      },
    };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    state.adminReads += 1;
    return { rpc: async () => ({ data: true, error: null }) };
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined, delete: () => undefined, has: () => false }),
  headers: async () => new Headers(),
}));

type RegisterRoute = { id: string; kind: string; path: string; methods?: string[]; policy?: { sameOriginRequired?: string } };
const register = JSON.parse(readFileSync("docs/route-register.json", "utf8")) as { routes: RegisterRoute[] };
const BOUND = register.routes.filter(route => route.policy?.sameOriginRequired !== undefined);
/** A registered path with every dynamic segment filled with one synthetic segment. */
const concrete = (path: string) => path.replace(/\[[^\]]+\]/g, FILE);

/** The request headers of each case, by what the browser would or would not send. */
const VARIANTS = {
  good: { origin: ORIGIN, "sec-fetch-site": "same-origin" },
  noOriginWithMarker: { "sec-fetch-site": "same-origin" },
  missingMarker: { origin: ORIGIN },
  neither: {},
  crossSite: { origin: "https://foreign.example", "sec-fetch-site": "cross-site" },
  sameSite: { origin: ORIGIN, "sec-fetch-site": "same-site" },
  none: { origin: ORIGIN, "sec-fetch-site": "none" },
  wrongOriginWithMarker: { origin: "https://foreign.example", "sec-fetch-site": "same-origin" },
  otherSchemeWithMarker: { origin: "http://inherit.test", "sec-fetch-site": "same-origin" },
  forwardedHostWithMarker: { origin: "https://foreign.example", "sec-fetch-site": "same-origin", "x-forwarded-host": "foreign.example" },
} as const satisfies Record<string, Record<string, string>>;
type Variant = keyof typeof VARIANTS;
const ADMITTED: readonly Variant[] = ["good", "noOriginWithMarker"];
const REFUSED = (Object.keys(VARIANTS) as Variant[]).filter(name => !ADMITTED.includes(name));

function request(method: string, path: string, variant: Variant, extra: Record<string, string> = {}): Request {
  const headers = new Headers({ ...VARIANTS[variant], ...extra });
  const body = method === "POST" ? "{}" : undefined;
  if (body !== undefined) headers.set("content-type", "application/json");
  const sent = new Request(`${ORIGIN}${path}`, { method, headers, body });
  for (const name of ["json", "text", "arrayBuffer", "formData", "blob", "bytes", "clone"] as const) {
    if (typeof sent[name] !== "function") continue;
    const read = (sent[name] as (...args: unknown[]) => unknown).bind(sent);
    Object.defineProperty(sent, name, { value: (...args: unknown[]) => { state.bodyReads += 1; return read(...args); } });
  }
  const stream = Object.getOwnPropertyDescriptor(Request.prototype, "body")!.get!.bind(sent);
  Object.defineProperty(sent, "body", { get: () => { state.bodyReads += 1; return stream(); } });
  return sent;
}

const token = (route: CsrfRoute) => mintSessionCsrf({ kind: "authenticated", accountId: ACCOUNT, sessionId: SESSION }, route);

async function expectRegisteredRefusal(response: Response, label: string) {
  expect(response.status, label).toBe(403);
  expect(response.headers.get("content-type"), label).toBe("application/json");
  expect(await response.json(), label).toEqual({ error: "request_forbidden" });
  expect(response.headers.get("cache-control"), label).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options"), label).toBe("nosniff");
  expect(response.headers.get("x-inherit-csrf"), `${label}: no successor`).toBeNull();
}

beforeEach(() => {
  vi.stubEnv("BYOK_ENCRYPTION_KEY", KEY);
  state.contextReads = 0;
  state.adminReads = 0;
  state.bodyReads = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("the routes bound to policy.sameOriginRequired", () => {
  it("are exactly the register's, with its methods, and the code's matcher picks out no other registered route", async () => {
    const { SAME_ORIGIN_REQUIRED_ROUTES, sameOriginRequiredRoute } = await import("./same-origin");
    expect(BOUND.map(route => route.id).sort()).toEqual(["api.file-delete", "api.subject-upload-issue"]);
    expect(Object.keys(SAME_ORIGIN_REQUIRED_ROUTES).sort()).toEqual(BOUND.map(route => route.id).sort());
    for (const route of BOUND) expect([...SAME_ORIGIN_REQUIRED_ROUTES[route.id]!.methods], route.id).toEqual(route.methods);
    // Every registered endpoint, on every method it lists (and on the bound methods too), with its path filled in.
    const methods = [...new Set(register.routes.flatMap(route => route.methods ?? ["GET"]))];
    for (const route of register.routes.filter(candidate => candidate.kind === "endpoint")) {
      for (const method of methods) {
        const bound = route.policy?.sameOriginRequired !== undefined && (route.methods ?? ["GET"]).includes(method);
        expect(sameOriginRequiredRoute(method, concrete(route.path)), `${route.id} ${method} ${route.path}`).toBe(bound ? route.id : null);
      }
    }
  });

  it("are bound to the strict rule the register states, refused before the account context is read", () => {
    for (const route of BOUND) expect(route.policy!.sameOriginRequired, route.id).toMatch(/^sec-fetch-site-must-equal-same-origin-or-the-request-is-refused-before-/u);
  });
});

describe("the strict rule (isStrictSameOrigin)", () => {
  it.each([
    ["the browser's same-origin request", VARIANTS.good, true],
    ["no Origin with the marker", VARIANTS.noOriginWithMarker, true],
    ["the right Origin with no marker", VARIANTS.missingMarker, false],
    ["neither header", VARIANTS.neither, false],
    ["cross-site", VARIANTS.crossSite, false],
    ["same-site", VARIANTS.sameSite, false],
    ["none (a typed address or bookmark)", VARIANTS.none, false],
    ["another Origin with the marker", VARIANTS.wrongOriginWithMarker, false],
    ["another scheme of the same host with the marker", VARIANTS.otherSchemeWithMarker, false],
    ["another Origin named by X-Forwarded-Host too", VARIANTS.forwardedHostWithMarker, false],
    ["the marker in another case", { origin: ORIGIN, "sec-fetch-site": "Same-Origin" }, false],
    ["the marker sent twice", { origin: ORIGIN, "sec-fetch-site": "same-origin, same-origin" }, false],
    ["an opaque Origin", { origin: "null", "sec-fetch-site": "same-origin" }, false],
    ["an empty Origin", { origin: "", "sec-fetch-site": "same-origin" }, false],
    ["the Origin with a trailing slash", { origin: `${ORIGIN}/`, "sec-fetch-site": "same-origin" }, false],
    ["the Origin with another port", { origin: `${ORIGIN}:8443`, "sec-fetch-site": "same-origin" }, false],
  ] as const)("%s: %s", async (_label, headers, admitted) => {
    const { isStrictSameOrigin } = await import("./same-origin");
    expect(isStrictSameOrigin(new Request(`${ORIGIN}/api/uploads`, { method: "POST", headers }))).toBe(admitted);
  });

  it("takes the site's own origin from the request's own URL, never from a forwarded header", async () => {
    const { isStrictSameOrigin } = await import("./same-origin");
    const forwarded = { "x-forwarded-host": "foreign.example", "x-forwarded-proto": "http", host: "foreign.example" };
    expect(isStrictSameOrigin(new Request("http://localhost:3100/api/uploads", { method: "POST",
      headers: { origin: "http://localhost:3100", "sec-fetch-site": "same-origin", ...forwarded } }))).toBe(true);
    expect(isStrictSameOrigin(new Request("http://localhost:3100/api/uploads", { method: "POST",
      headers: { origin: "http://foreign.example", "sec-fetch-site": "same-origin", ...forwarded } }))).toBe(false);
    // localhost and 127.0.0.1 are two origins to a browser, and to the rule.
    expect(isStrictSameOrigin(new Request("http://localhost:3100/api/uploads", { method: "POST",
      headers: { origin: "http://127.0.0.1:3100", "sec-fetch-site": "same-origin" } }))).toBe(false);
  });
});

describe("the CSRF wrapper applies the rule to the bound routes, and to no other", () => {
  const ACCOUNT_ROUTES = (Object.entries(SESSION_CSRF_ROUTES) as [CsrfRoute, string][])
    .filter(([, kind]) => kind === "authenticated").map(([route]) => route);

  it.each(ACCOUNT_ROUTES)("%s", async (route) => {
    const { withAccountCsrf } = await import("./session-csrf");
    const bound = BOUND.some(candidate => candidate.id === route);
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const wrapped = withAccountCsrf(route, handler);
    const response = await wrapped(request("POST", "/api/route", "missingMarker", { "x-inherit-csrf": token(route) }));
    if (bound) {
      await expectRegisteredRefusal(response, route);
      expect(state.contextReads, "the account context was never read").toBe(0);
      expect(state.adminReads, "no token was spent").toBe(0);
      expect(handler).not.toHaveBeenCalled();
    } else {
      // Not bound: the session is read and the token spent, as before.
      expect(response.status, route).toBe(204);
      expect(state.contextReads, route).toBe(1);
    }
  });

  it("covers both bound routes among the wrapped account routes", () => {
    for (const route of BOUND) expect(ACCOUNT_ROUTES, route.id).toContain(route.id);
  });
});

describe("the bound routes' own handlers, through the real wrapper", () => {
  const ROUTES = [
    { id: "api.file-delete", method: "DELETE", path: `/api/files/${FILE}`, params: { id: FILE },
      load: () => import("@/app/api/files/[id]/route") },
    { id: "api.subject-upload-issue", method: "POST", path: "/api/uploads", params: {},
      load: () => import("@/app/api/uploads/route") },
  ] as const;

  it("drives every bound route", () => {
    expect(ROUTES.map(route => route.id).sort()).toEqual(BOUND.map(route => route.id).sort());
    for (const route of ROUTES) expect(route.path).toBe(concrete(BOUND.find(candidate => candidate.id === route.id)!.path));
  });

  describe.each(ROUTES.map(route => [route.id, route] as const))("%s", (_id, route) => {
    const send = async (variant: Variant) => {
      const loaded = await route.load() as unknown as Record<string, (request: Request, context: unknown) => Promise<Response>>;
      const handler = loaded[route.method]!;
      return handler(request(route.method, route.path, variant, { "x-inherit-csrf": token(route.id) }),
        { params: Promise.resolve(route.params) });
    };

    it.each(REFUSED)("refuses %s with the registered answer before any account, token or body is read", async (variant) => {
      await expectRegisteredRefusal(await send(variant), `${route.id} ${variant}`);
      expect(state.contextReads, "the account context reader was not called").toBe(0);
      expect(state.adminReads, "no token was spent and nothing was asked of the database").toBe(0);
      expect(state.bodyReads, "the body was not read").toBe(0);
    });

    // Past the rule the route goes on as before: the wrapper reads the session
    // and spends the token, and the handler gives its own answer.
    it.each(ADMITTED)("lets %s through to the session read and the token spend", async (variant) => {
      await send(variant);
      expect(state.contextReads, `${variant}: the account context was read`).toBeGreaterThan(0);
      expect(state.adminReads, `${variant}: the token was spent`).toBeGreaterThan(0);
    });
  });
});
