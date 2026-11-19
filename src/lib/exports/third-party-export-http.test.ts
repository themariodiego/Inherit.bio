import fs from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * api.third-party-subject-export (owner decision 2026-10-22): the subject and
 * cohort cases both answer resource-not-found-v1 until their producers
 * exist. Test doubles only: no database, no provider.
 */
const mocks = vi.hoisted(() => ({ database: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.database }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.database }));
vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 63).toString("base64"));
const { POST, GET } = await import("@/app/api/withdraw/session/export/route");
const { mintThirdPartyExportNonce, readThirdPartyExportNonce, thirdPartyExportCsrf, thirdPartyExportBody }
  = await import("./third-party-export-http");
const { RIGHTS_COOKIE_NAME, rightsSessionHash } = await import("@/lib/embryos/rights-session");
afterAll(() => vi.unstubAllEnvs());

const origin = "https://test.e2e.local";
const url = `${origin}/api/withdraw/session/export`;
const secret = Buffer.alloc(32, 7).toString("base64url"), session = rightsSessionHash(secret);
const other = rightsSessionHash(Buffer.alloc(32, 8).toString("base64url"));
const exportCookie = `__Host-inherit-export=88100000-0000-4000-8000-000000000001.${Buffer.alloc(32, 5).toString("base64url")}`;
function post(body: unknown, headers: Record<string, string> = {}, target = url) {
  return new Request(target, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { origin,
    "sec-fetch-site": "same-origin", "content-type": "application/json", "x-inherit-csrf": thirdPartyExportCsrf(session),
    cookie: `${RIGHTS_COOKIE_NAME}=${secret}`, ...headers } });
}
function get(cookie = `${RIGHTS_COOKIE_NAME}=${secret}; ${exportCookie}`, target = url) {
  return new Request(target, { headers: { cookie } });
}
async function expectNotFound(response: Response, label: string) {
  expect(response.status, label).toBe(404);
  expect(response.headers.get("cache-control"), label).toBe("private, no-store");
  expect(response.headers.get("referrer-policy"), label).toBe("no-referrer");
  expect(response.headers.get("set-cookie"), label).toBeNull();
  expect(await response.json(), label).toEqual({ error: "not_found" });
}
beforeEach(() => { vi.clearAllMocks(); });

describe("POST /api/withdraw/session/export", () => {
  it("answers resource-not-found-v1 to a fully valid create or open-ready, writing nothing", async () => {
    for (const operation of ["create", "open-ready"] as const) {
      const request = post({ operation, nonce: mintThirdPartyExportNonce(session, operation) });
      await expectNotFound(await POST(request), operation);
      expect(request.bodyUsed, operation).toBe(true);
    }
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it("is the same 404 for every invalid, stale or inapplicable request", async () => {
    const nonce = mintThirdPartyExportNonce(session, "create");
    const cases: [string, Request][] = [
      ["no rights session", post({ operation: "create", nonce }, { cookie: "" })],
      ["two rights sessions", post({ operation: "create", nonce }, { cookie: `${RIGHTS_COOKIE_NAME}=${secret}; ${RIGHTS_COOKIE_NAME}=${secret}` })],
      ["query", post({ operation: "create", nonce }, {}, `${url}?x=1`)],
      ["cross-site", post({ operation: "create", nonce }, { "sec-fetch-site": "cross-site" })],
      ["foreign origin", post({ operation: "create", nonce }, { origin: "https://elsewhere.example" })],
      ["not JSON", post({ operation: "create", nonce }, { "content-type": "text/plain" })],
      ["no CSRF", post({ operation: "create", nonce }, { "x-inherit-csrf": "" })],
      ["foreign CSRF", post({ operation: "create", nonce }, { "x-inherit-csrf": thirdPartyExportCsrf(other) })],
      ["unknown operation", post({ operation: "delete", nonce })],
      ["unknown field", post({ operation: "create", nonce, target: "cohort" })],
      ["malformed JSON", post("{")],
      ["nonce for the other operation", post({ operation: "open-ready", nonce })],
      ["nonce for another session", post({ operation: "create", nonce: mintThirdPartyExportNonce(other, "create") })],
      ["stale nonce", post({ operation: "create", nonce: mintThirdPartyExportNonce(session, "create", Date.now() - 11 * 60_000) })],
    ];
    for (const [label, request] of cases) await expectNotFound(await POST(request), label);
    expect(mocks.database).not.toHaveBeenCalled();
  });
});

describe("GET /api/withdraw/session/export", () => {
  it("polls only: the same 404 with or without the export cookie, and no write", async () => {
    for (const [label, request] of [
      ["with export cookie", get()],
      ["missing export cookie", get(`${RIGHTS_COOKIE_NAME}=${secret}`)],
      ["no rights session", get(exportCookie)],
      ["query", get(undefined, `${url}?poll=1`)],
    ] as const) await expectNotFound(await GET(request), label);
    expect(mocks.database).not.toHaveBeenCalled();
  });
});

describe("the rights-session-bound nonce and closed bodies", () => {
  it("binds the nonce to one session and one operation, ten minutes fresh", () => {
    const now = Date.now();
    const nonce = mintThirdPartyExportNonce(session, "create", now);
    expect(readThirdPartyExportNonce(nonce, session, "create", now)).toMatchObject({ nonce: expect.any(String) });
    expect(readThirdPartyExportNonce(nonce, other, "create", now)).toBeNull();
    expect(readThirdPartyExportNonce(nonce, session, "open-ready", now)).toBeNull();
    expect(readThirdPartyExportNonce(nonce, session, "create", now + 10 * 60_000)).toBeNull();
    expect(readThirdPartyExportNonce(`${nonce}x`, session, "create", now)).toBeNull();
    expect(readThirdPartyExportNonce("x".repeat(2049), session, "create", now)).toBeNull();
  });
  it("accepts exactly the two registered bodies", () => {
    expect(thirdPartyExportBody.safeParse({ operation: "create", nonce: "n" }).success).toBe(true);
    expect(thirdPartyExportBody.safeParse({ operation: "open-ready", nonce: "n" }).success).toBe(true);
    expect(thirdPartyExportBody.safeParse({ operation: "create" }).success).toBe(false);
    expect(thirdPartyExportBody.safeParse({ operation: "create", nonce: "n", subjectId: "x" }).success).toBe(false);
  });
  it("leaves the withdraw page refuse/delete only", () => {
    const page = fs.readFileSync("src/app/(marketing)/withdraw/session/page.tsx", "utf8");
    expect(page).not.toMatch(/third-party-export|ThirdPartyExport|withdraw\/session\/export/u);
  });
});
