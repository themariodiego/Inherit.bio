import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A request without a session, or a job request without its credential, gets
 * the register's JSON 401, not plain text `Unauthorized` (G8.5, "where the
 * register is stricter, engineering codes to it", 19 November 2026). The
 * answer each route owes is read from the register: its `auth` mode, through
 * `contractDefaults`, names the auth contract, and that contract names the
 * 401. `authenticated-api-v1` and `machine-api-v1` both name
 * `{"error":"unauthenticated"}`. Each route is driven through its real
 * handler with no session; the one-time CSRF gate passes such a request to
 * the handler unchanged (`session-csrf-routes.test.ts`). Every value is
 * synthetic.
 */

const ORIGIN = "https://inherit.test";
const ID = "5b000000-0000-4000-8000-0000000000aa";
const WRONG = "Bearer not-the-job-secret";

/** An inert query or RPC: a handler that got past its sign-in check would stop on it. */
function inert(): unknown {
  const proxy: unknown = new Proxy(function () {}, {
    get: (_target, property) => property === "then"
      ? (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "inert test double" } }).then(resolve)
      : () => proxy,
    apply: () => proxy,
  });
  return proxy;
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => inert() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getClaims: async () => ({ data: null, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
    from: () => inert(),
    rpc: () => inert(),
  }),
}));
vi.mock("@/lib/account-deletion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-deletion")>()),
  getSensitiveAccountContext: async () => null,
}));
vi.mock("@/lib/security/session-csrf", async (importOriginal) =>
  (await import("@/lib/security/session-csrf.test-support")).admitEverySessionCsrf(await importOriginal()));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined, delete: () => undefined, has: () => false }),
  headers: async () => new Headers(),
}));

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
interface Case {
  id: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  load: () => Promise<Record<string, unknown>>;
  params?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
}

const json = (body: unknown) => body;
const CASES: Case[] = [
  { id: "api.embryo-cohort-drafts", method: "POST", path: "/api/embryo-cohort-drafts", load: () => import("@/app/api/embryo-cohort-drafts/route") },
  { id: "api.embryo-cohorts", method: "POST", path: "/api/embryo-cohorts", load: () => import("@/app/api/embryo-cohorts/route") },
  { id: "api.embryo-record-key-cards", method: "POST", path: `/api/embryo-cohorts/${ID}/record-key-cards`, params: { id: ID },
    load: () => import("@/app/api/embryo-cohorts/[id]/record-key-cards/route") },
  { id: "api.embryo-disposition", method: "POST", path: `/api/embryos/${ID}/disposition`, params: { id: ID },
    load: () => import("@/app/api/embryos/[id]/disposition/route") },
  { id: "api.cohort-restrict", method: "POST", path: `/api/cohorts/${ID}/restrict`, params: { id: ID }, load: () => import("@/app/api/cohorts/[id]/restrict/route") },
  { id: "api.consents-revoke-all", method: "POST", path: "/api/consents/revoke-all", load: () => import("@/app/api/consents/revoke-all/route") },
  { id: "api.consent-reaffirm", method: "POST", path: "/api/consents/reaffirm", load: () => import("@/app/api/consents/reaffirm/route") },
  { id: "api.subject-delete", method: "DELETE", path: `/api/subjects/${ID}`, params: { id: ID }, load: () => import("@/app/api/subjects/[id]/route") },
  { id: "api.subject-transfer", method: "POST", path: `/api/subjects/${ID}/transfer`, params: { id: ID }, load: () => import("@/app/api/subjects/[id]/transfer/route") },
  { id: "api.subject-sharing", method: "POST", path: `/api/subjects/${ID}/sharing`, params: { id: ID }, load: () => import("@/app/api/subjects/[id]/sharing/route") },
  { id: "api.adult-subject-bind", method: "POST", path: "/api/subjects/bind/session", load: () => import("@/app/api/subjects/bind/session/route") },
  { id: "api.invitations", method: "POST", path: "/api/invitations", load: () => import("@/app/api/invitations/route") },
  { id: "api.invitation-accept", method: "POST", path: "/api/invitations/accept", load: () => import("@/app/api/invitations/accept/route") },
  { id: "api.consents", method: "POST", path: "/api/consents", load: () => import("@/app/api/consents/route") },
  { id: "api.future-person-identity-profile", method: "PUT", path: `/api/embryos/${ID}/future-person-identity`, params: { id: ID },
    load: () => import("@/app/api/embryos/[id]/future-person-identity/route") },
  { id: "api.future-person-identity-profile", method: "DELETE", path: `/api/embryos/${ID}/future-person-identity`, params: { id: ID },
    load: () => import("@/app/api/embryos/[id]/future-person-identity/route") },
  { id: "api.account-delete-cancel", method: "POST", path: "/api/account/delete/cancel", load: () => import("@/app/api/account/delete/cancel/route"),
    body: json({ confirmation: "account.delete.cancel-confirmation", nonce: "n".repeat(32) }) },
  { id: "api.chat", method: "POST", path: "/api/chat", load: () => import("@/app/api/chat/route") },
  { id: "api.jurisdiction", method: "PUT", path: "/api/settings/jurisdiction", load: () => import("@/app/api/settings/jurisdiction/route") },
  { id: "api.subject-drafts", method: "POST", path: "/api/subject-drafts", load: () => import("@/app/api/subject-drafts/route") },
  { id: "api.family-sharing", method: "POST", path: `/api/family/s-${ID}/sharing`, params: { person: `s-${ID}` },
    load: () => import("@/app/api/family/[person]/sharing/route"), body: json({ operation: "pause", nonce: "n" }) },
  { id: "api.chromosomal-sex", method: "POST", path: "/api/chromosomal-sex", load: () => import("@/app/api/chromosomal-sex/route"),
    body: json({ subjectId: ID, chromosomalSex: null }) },
  // G8.5, 22 November 2026: the four that answered a plain-text "Unauthorized".
  { id: "api.export", method: "GET", path: "/api/export", load: () => import("@/app/api/export/route") },
  { id: "api.file-download", method: "GET", path: `/api/files/${ID}/download`, params: { id: ID },
    load: () => import("@/app/api/files/[id]/download/route") },
  { id: "api.file-process", method: "POST", path: `/api/files/${ID}/process`, params: { id: ID },
    load: () => import("@/app/api/files/[id]/process/route") },
  { id: "api.account-delete", method: "POST", path: "/api/account/delete", load: () => import("@/app/api/account/delete/route"),
    body: json({ confirmation: "account.delete.confirmation", nonce: "n".repeat(32) }) },
  // machine-api-v1: no credential, and a wrong one.
  ...(["GET", "POST"] as const).flatMap(method => [
    { id: "jobs.annotation-refresh", method, path: "/api/jobs/annotation-refresh", load: () => import("@/app/api/jobs/annotation-refresh/route") },
    { id: "jobs.mail", method, path: "/api/jobs/mail", load: () => import("@/app/api/jobs/mail/route") },
    { id: "jobs.research-refresh", method, path: "/api/jobs/research-refresh", load: () => import("@/app/api/jobs/research-refresh/route") },
  ]),
  { id: "jobs.retention", method: "POST", path: "/api/jobs/retention", load: () => import("@/app/api/jobs/retention/route") },
  { id: "jobs.research-publish", method: "POST", path: "/api/jobs/research-publish", load: () => import("@/app/api/jobs/research-publish/route") },
];

type Contract = { status: number; contentType: string; body: { error: { const: string } } };
const register = JSON.parse(readFileSync("docs/route-register.json", "utf8")) as {
  contractDefaults: Record<string, string>;
  authContracts: Record<string, Record<string, unknown>>;
  sensitiveResponseHeaders: Record<string, Record<string, string>>;
  sensitiveResponseHeaderBindings: Record<string, unknown>;
  routes: { id: string; kind: string; auth: string; methods?: string[] }[];
};

/** The 401 the register owes `id`: its auth mode, through contractDefaults, to the auth contract's own 401. */
function owed(id: string): { contract: string; answer: Contract } {
  const route = register.routes.find(candidate => candidate.id === id);
  if (!route) throw new Error(`${id} is not registered`);
  const contract = register.contractDefaults[`${route.kind}:${route.auth}`]?.replace(/^authContracts\./u, "");
  if (contract === "authenticated-api-v1") return { contract, answer: register.authContracts[contract]!.unauthenticated as Contract };
  if (contract === "machine-api-v1") return { contract, answer: register.authContracts[contract]!.missingInvalidExpiredOrWrongCredential as Contract };
  throw new Error(`${id}: ${contract} is not a contract this suite reads`);
}

function request(entry: Case, authorization?: string): Request {
  const headers = new Headers({ origin: ORIGIN, "sec-fetch-site": "same-origin", ...entry.headers });
  if (authorization) headers.set("authorization", authorization);
  const body = entry.method === "GET" || entry.method === "DELETE" || entry.id.startsWith("jobs.") ? undefined : JSON.stringify(entry.body ?? {});
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${ORIGIN}${entry.path}`, { method: entry.method, headers, body });
}

async function send(entry: Case, authorization?: string): Promise<Response> {
  const handler = (await entry.load())[entry.method] as Handler;
  return handler(request(entry, authorization), { params: Promise.resolve(entry.params ?? {}) });
}

async function expectOwed(entry: Case, response: Response) {
  const { answer } = owed(entry.id);
  const label = `${entry.id} ${entry.method}`;
  expect(response.status, label).toBe(answer.status);
  expect(response.headers.get("content-type"), label).toBe(answer.contentType);
  expect(await response.json(), label).toEqual({ error: answer.body.error.const });
  expect(response.headers.get("cache-control"), label).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options"), label).toBe("nosniff");
}

beforeEach(() => {
  // Two of these routes answer only where the test jurisdiction is on.
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 13).toString("base64"));
  vi.stubEnv("JOBS_SECRET", "synthetic-jobs-secret-value-0000000000");
  vi.stubEnv("CRON_SECRET", "synthetic-cron-secret-value-0000000000");
});
afterEach(() => vi.unstubAllEnvs());

describe("a request without a session or job credential gets the register's JSON 401", () => {
  it("reads authenticated-api-v1 and machine-api-v1 as naming JSON 401 unauthenticated", () => {
    expect(owed("api.chat")).toEqual({ contract: "authenticated-api-v1",
      answer: { status: 401, contentType: "application/json", body: { error: { const: "unauthenticated" } }, unknownFieldsRecursively: "forbidden" } });
    expect(owed("jobs.mail")).toEqual({ contract: "machine-api-v1",
      answer: { status: 401, contentType: "application/json", body: { error: { const: "unauthenticated" } }, unknownFieldsRecursively: "forbidden" } });
  });

  it.each(CASES.filter(entry => !entry.id.startsWith("jobs.")).map(entry => [`${entry.id} ${entry.method}`, entry] as const))(
    "%s answers a signed-out request with authenticated-api-v1's 401", async (_label, entry) => {
      expect(owed(entry.id).contract).toBe("authenticated-api-v1");
      await expectOwed(entry, await send(entry));
    });

  /**
   * G8.5, 22 November 2026: the four that answered a plain-text "Unauthorized"
   * answer the JSON 401 above, and at the route itself carry every header of
   * each sensitive profile the register binds them to (downloadOrExport for
   * api.export and api.file-download); the other two are bound to none.
   */
  const MOVED = ["api.export", "api.file-download", "api.file-process", "api.account-delete"];
  it.each(MOVED)("%s answers its 401 with every header of the profiles the register binds it to", async (id) => {
    const entry = CASES.find(candidate => candidate.id === id)!;
    const profiles = Object.entries(register.sensitiveResponseHeaderBindings)
      .filter(([name, ids]) => name in register.sensitiveResponseHeaders && Array.isArray(ids) && ids.includes(id)).map(([name]) => name);
    expect(profiles, id).toEqual(id === "api.export" || id === "api.file-download" ? ["downloadOrExport"] : []);
    const response = await send(entry);
    await expectOwed(entry, response.clone());
    for (const profile of profiles) {
      for (const [name, value] of Object.entries(register.sensitiveResponseHeaders[profile]!)) {
        expect(response.headers.get(name), `${id}: ${profile} ${name}`).toBe(value);
      }
    }
  });

  it("answers the embryo bodies of api.consents with the same 401 when the account context is gone", async () => {
    const { embryoConsent } = await import("@/lib/embryos/consents");
    const entry = CASES.find(candidate => candidate.id === "api.consents")!;
    await expectOwed(entry, await embryoConsent(request(entry), {}));
  });

  it.each(CASES.filter(entry => entry.id.startsWith("jobs.")).map(entry => [`${entry.id} ${entry.method}`, entry] as const))(
    "%s answers a missing or wrong job credential with machine-api-v1's 401", async (_label, entry) => {
      expect(owed(entry.id).contract).toBe("machine-api-v1");
      await expectOwed(entry, await send(entry));
      await expectOwed(entry, await send(entry, WRONG));
    });

  it("answers a research-refresh fixture sent with the cron secret, which only the operator secret may send, with the same 401", async () => {
    const { POST } = await import("@/app/api/jobs/research-refresh/route");
    const entry = CASES.find(candidate => candidate.id === "jobs.research-refresh" && candidate.method === "POST")!;
    const response = await POST(new Request(`${ORIGIN}${entry.path}`, { method: "POST",
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ fixture: { synthetic: true } }) }));
    await expectOwed(entry, response);
  });
});

/**
 * No route handler or library builds a plain-text 401. Until 22 November 2026
 * four were left here (api.account-delete, the legacy GET of api.export,
 * api.file-download and api.file-process); they answer the JSON 401 above
 * now (G8.5). The Files page shows a Process 401 with the words it showed
 * before (`processDetail`, `src/components/uploads/file-row-actions.tsx`);
 * the frozen account-deletion source names the change
 * (`scripts/tools/historical-account-authority.test.ts`). Adding one fails here.
 */
describe("plain-text 401s", () => {
  const LEFT: Readonly<Record<string, string>> = {};
  const files = (directory: string): string[] => readdirSync(directory).flatMap(name => {
    const full = path.join(directory, name);
    return statSync(full).isDirectory() ? files(full) : /\.tsx?$/u.test(name) && !/\.test\.tsx?$|test-support/u.test(name) ? [full] : [];
  });

  it("are built only by the routes listed, each for its stated reason", () => {
    const plain = /(?:new Response|failure)\(\s*["'`]Unauthorized["'`]/u;
    const found = [...files("src/app"), ...files("src/lib")].filter(file => plain.test(readFileSync(file, "utf8")));
    expect(found.map(file => file.split(path.sep).join("/")).sort()).toEqual(Object.keys(LEFT).sort());
  });
});
