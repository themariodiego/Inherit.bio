import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registeredStatuses, type RegisterDocument } from "../../../../../scripts/form-contract-census";

/**
 * `POST /api/embryos/acknowledge` (register api.embryo-acknowledge), the
 * registered route that replaced the server action `acknowledgeEmbryoGate`
 * (owner decision of 23 October 2026, G8.5). It is held to its Family twin's
 * checks: the same Origin rule, a closed body, the signed-in account and its
 * auth session, and the session cookie the Embryo pages read. Only the
 * account context is mocked; the Origin check and the cookie are the real
 * ones.
 */
vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
const mocks = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@/lib/account-deletion", async (load) => ({
  ...await load<typeof import("@/lib/account-deletion")>(), getSensitiveAccountContext: mocks.context,
}));
// The one-time X-Inherit-CSRF gate passes through here; it is tested on this
// route, through the same handler, in src/lib/security/session-csrf-routes.test.ts.
vi.mock("@/lib/security/session-csrf", async (importOriginal) =>
  (await import("@/lib/security/session-csrf.test-support")).admitEverySessionCsrf(await importOriginal()));

const { POST } = await import("./route");
const { TIER2_EMBRYO_COOKIE_NAME, acknowledgedBy, tier2Digest } = await import("@/lib/embryos/tier2");
const { TIER2_COOKIE_NAME, tier2Digest: familyDigest } = await import("@/lib/family/tier2");

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_SESSION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GATE = { acknowledgement: "embryo-result-gate", affirmed: true };

const register = JSON.parse(readFileSync("docs/route-register.json", "utf8")) as {
  routes: { id: string; path: string; methods?: string[]; requestContract?: { closedBody?: Record<string, unknown> }; successResponseContract?: string }[];
  responseContracts: Record<string, { status?: number; body?: Record<string, unknown> }>;
  responseContractBindings: { routes: Record<string, string[]> };
};

function call(body: unknown, headers: Record<string, string> = { origin: "https://inherit.test" }) {
  return POST(new Request("https://inherit.test/api/embryos/acknowledge", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
});

describe("POST /api/embryos/acknowledge", () => {
  it("sets the Embryo gate's session cookie and answers which acknowledgement was recorded", async () => {
    const response = await call(GATE);
    expect(response.status).toBe(200);
    const answer = await response.json() as { acknowledgement: string; acknowledgedAt: string };
    expect(Object.keys(answer).sort()).toEqual(["acknowledgedAt", "acknowledgement"]);
    expect(answer.acknowledgement).toBe("embryo-result-gate");
    expect(new Date(answer.acknowledgedAt).toISOString()).toBe(answer.acknowledgedAt);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");

    const cookie = response.headers.get("set-cookie")!;
    expect(cookie.startsWith(`${TIER2_EMBRYO_COOKIE_NAME}=${tier2Digest(ACCOUNT, SESSION)};`)).toBe(true);
    const attributes = cookie.split(";").slice(1).map(part => part.trim().toLowerCase());
    expect(attributes.sort()).toEqual(["httponly", "path=/", "samesite=lax", "secure"]);
    expect(cookie).not.toMatch(/max-age|expires/i);
  });

  it("writes a cookie that verifies for this session only and never opens the Family gate", async () => {
    const cookie = (await call(GATE)).headers.get("set-cookie")!;
    const value = cookie.split(";")[0].split("=")[1];
    expect(acknowledgedBy(value, ACCOUNT, SESSION)).toBe(true);
    expect(acknowledgedBy(value, ACCOUNT, OTHER_SESSION)).toBe(false);
    expect(acknowledgedBy(value, ACCOUNT, null)).toBe(false);
    expect(TIER2_EMBRYO_COOKIE_NAME).not.toBe(TIER2_COOKIE_NAME);
    expect(value).not.toBe(familyDigest(ACCOUNT, SESSION));
  });

  it("refuses a cross-site request, and one carrying neither Origin nor Sec-Fetch-Site, before reading the account", async () => {
    const refused: Record<string, string>[] = [{ origin: "https://elsewhere.test" }, {}, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }];
    for (const headers of refused) {
      const response = await call(GATE, headers);
      // authenticated-mutation-v1's refusal since 2026-10-24 (G8.5); it was a 400 invalid_request.
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "request_forbidden" });
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(mocks.context).not.toHaveBeenCalled();
    expect((await call(GATE, { "sec-fetch-site": "same-origin" })).status).toBe(200);
  });

  it("refuses any body but the closed one, including the Family gate's, with no cookie", async () => {
    for (const body of [{}, null, { acknowledgement: "tier2-result-gate", affirmed: true }, { ...GATE, affirmed: false },
      { acknowledgement: "embryo-result-gate" }, { ...GATE, accountId: ACCOUNT }, { ...GATE, cohortId: ACCOUNT }]) {
      const response = await call(body);
      // invalid-request-v1 since 2026-10-24 (G8.5); it was a 400.
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_request", issues: ["body"] });
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it("refuses a request with no signed-in account and session, with no cookie", async () => {
    mocks.context.mockResolvedValue(null);
    const response = await call(GATE);
    expect(response.status).toBe(401);
    // authenticated-api-v1's JSON body since 2026-10-24 (G8.5); it was plain text.
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("the register describes the route that answers", () => {
  const entry = register.routes.find(route => route.id === "api.embryo-acknowledge")!;

  it("registers the path, method, closed body and success contract this handler implements", () => {
    expect(entry.path).toBe("/api/embryos/acknowledge");
    expect(entry.methods).toEqual(["POST"]);
    expect(entry.requestContract?.closedBody).toEqual({ acknowledgement: { const: GATE.acknowledgement }, affirmed: { const: true } });
    expect(entry.successResponseContract).toBe("embryo-acknowledged-v1");
    expect(register.responseContractBindings.routes["api.embryo-acknowledge"]).toContain("embryo-acknowledged-v1");
  });

  it("answers the registered success status and body keys", async () => {
    const contract = register.responseContracts["embryo-acknowledged-v1"];
    const response = await call(GATE);
    expect(response.status).toBe(contract.status);
    expect(Object.keys(await response.json()).sort()).toEqual(Object.keys(contract.body ?? {}).sort());
  });

  it("refuses only with statuses and error codes the register gives this route (G8.5, 24 October 2026)", async () => {
    const answers = [await call(GATE, { origin: "https://elsewhere.test" }), await call({ ...GATE, affirmed: false })];
    mocks.context.mockResolvedValue(null);
    answers.push(await call(GATE));
    const refusals = await Promise.all(answers.map(async response => [response.status, (await response.json()).error] as const));
    expect(refusals).toEqual(registeredRefusals(entry, [[403, "request_forbidden"], [422, "invalid_request"], [401, "unauthenticated"]]));
  });
});

/**
 * The (status, error) pairs among `expected` that the register lets this
 * route answer: its bound response contracts, and the auth contracts every
 * authenticated mutation carries. A pair the register does not give is left
 * out, so the comparison above fails on it.
 */
function registeredRefusals(entry: { id: string }, expected: (readonly [number, string])[]): (readonly [number, string])[] {
  const document = register as unknown as RegisterDocument;
  const statuses = registeredStatuses(document.routes.find(route => route.id === entry.id)!, "POST", document);
  const codes = JSON.stringify([document.authContracts, ...(document.responseContractBindings.routes[entry.id] ?? [])
    .map(name => document.responseContracts[name])]);
  return expected.filter(([status, code]) => statuses.includes(status) && codes.includes(`{"const":"${code}"}`));
}
