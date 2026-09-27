import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCOUNT = "12345678-1234-4234-8234-000000000001";
const SESSION = "12345678-1234-4234-8234-0000000000a1";
const ORIGIN = "https://inherit.bio";
const HASH = "a".repeat(64);

const mocks = vi.hoisted(() => ({
  account: null as { user: { id: string }; sessionId: string } | null,
  rpc: [] as Array<[string, Record<string, unknown>]>,
  result: null as unknown,
  error: null as { code?: string; message?: string } | null,
  current: null as string | null,
  currentError: null as { message: string } | null,
  reads: 0,
}));

// Only the account context is replaced; `isSameOrigin` stays real.
vi.mock("@/lib/account-deletion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-deletion")>()),
  getSensitiveAccountContext: async () => mocks.account,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      mocks.rpc.push([name, args]);
      return { data: mocks.result, error: mocks.error };
    },
    // The account's current answer, read only when a paused country is chosen.
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            mocks.reads += 1;
            return { data: { jurisdiction_code: mocks.current }, error: mocks.currentError };
          },
        }),
      }),
    }),
  }),
}));

const { PUT } = await import("./route");

function put(body: unknown, headers: Record<string, string> = { origin: ORIGIN }): Promise<Response> {
  return PUT(new Request(`${ORIGIN}/api/settings/jurisdiction`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

const body = (overrides: Record<string, unknown> = {}) => ({
  code: "GB", attestationVersion: 1, attestationHash: HASH, affirmed: true, ...overrides,
});

beforeEach(() => {
  vi.unstubAllEnvs();
  // CI sets the acceptance flag for the whole job; each case states its own.
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
  mocks.account = { user: { id: ACCOUNT }, sessionId: SESSION };
  mocks.rpc = [];
  mocks.result = { jurisdiction: "GB", changed: true, revokedGrants: 0 };
  mocks.error = null;
  mocks.current = null;
  mocks.currentError = null;
  mocks.reads = 0;
});

describe("PUT /api/settings/jurisdiction", () => {
  it("records the declaration through the one writer and answers jurisdiction-write-v1 exactly", async () => {
    const response = await put(body());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "updated", jurisdiction: "GB", capabilityReevaluation: "complete" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toEqual([["declare_jurisdiction_v1", {
      p_account_id: ACCOUNT, p_session_id: SESSION, p_code: "GB",
      p_attestation_version: 1, p_attestation_sha256: HASH, p_test_jurisdiction: false,
    }]]);
  });

  it("normalises the code before validating it", async () => {
    await put(body({ code: " gb " }));
    expect(mocks.rpc[0]?.[1].p_code).toBe("GB");
  });

  it("never reports how many permissions ended", async () => {
    mocks.result = { jurisdiction: "GB", changed: true, revokedGrants: 3 };
    expect(Object.keys(await (await put(body())).json()).sort()).toEqual(["capabilityReevaluation", "jurisdiction", "status"]);
  });

  it("refuses a cross-site request before reading the account", async () => {
    mocks.account = null;
    const response = await put(body(), { origin: "https://evil.example" });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["origin"] });
    expect(mocks.rpc).toEqual([]);
  });

  it("refuses a signed-out request", async () => {
    mocks.account = null;
    expect((await put(body())).status).toBe(401);
    expect(mocks.rpc).toEqual([]);
  });

  it.each([
    ["an unknown field", body({ country: "GB" })],
    ["a missing attestation hash", { code: "GB", attestationVersion: 1, affirmed: true }],
    ["an unaffirmed attestation", body({ affirmed: false })],
    ["a non-hex hash", body({ attestationHash: "Z".repeat(64) })],
    ["a fractional version", body({ attestationVersion: 1.5 })],
    ["malformed JSON", "{"],
  ])("refuses %s as invalid-request-v1 without calling the writer", async (_label, value) => {
    const response = await put(value);
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("invalid_request");
    expect(mocks.rpc).toEqual([]);
  });

  it.each(["GBR", "ZZ", "GB-ENG", "TEST-LOCAL", "TEST-DENY", "XX", ""])("refuses %j outside the catalogue", async (code) => {
    const response = await put(body({ code }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["code"] });
    expect(mocks.rpc).toEqual([]);
  });

  it("accepts the block-only fixture's code only under the acceptance flag, and says so to the database", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
    mocks.result = { jurisdiction: "XX", changed: true, revokedGrants: 0 };
    const response = await put(body({ code: "xx" }));
    expect(response.status).toBe(200);
    expect(mocks.rpc[0]?.[1]).toMatchObject({ p_code: "XX", p_test_jurisdiction: true });
  });

  it("answers a stale attestation as invalid-request-v1", async () => {
    mocks.error = { code: "22023", message: "invalid_request" };
    const response = await put(body());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["attestation"] });
  });

  it("answers an ended session or deletion notice as an opaque 404", async () => {
    mocks.error = { code: "42501", message: "not_found" };
    expect((await put(body())).status).toBe(404);
  });

  it("refuses a writer result it does not recognise rather than forwarding it", async () => {
    mocks.result = { jurisdiction: "GB", changed: true, revokedGrants: 0, accountId: ACCOUNT };
    expect((await put(body())).status).toBe(404);
    mocks.result = { jurisdiction: "FR", changed: true, revokedGrants: 0 };
    expect((await put(body())).status).toBe(404);
  });
});

describe("places Inherit does not take new declarations from", () => {
  it.each(["CU", " ir ", "KP"])("never records %j, a country under a US embargo, on any deployment", async (code) => {
    mocks.current = code.trim().toUpperCase();
    const response = await put(body({ code }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["code"] });
    expect(mocks.rpc).toEqual([]);
    expect(mocks.reads).toBe(0);
  });

  it.each([
    ["a first declaration", null],
    ["a change from another country", "US"],
  ])("on the hosted deployment, refuses a paused country as %s, like an unknown code", async (_label, current) => {
    vi.stubEnv("VERCEL", "1");
    mocks.current = current;
    const response = await put(body({ code: "FR" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["code"] });
    expect(mocks.rpc).toEqual([]);
    expect(mocks.reads).toBe(1);
  });

  it("lets an account keep, and re-affirm, the paused country it already declared", async () => {
    vi.stubEnv("VERCEL", "1");
    mocks.current = "FR";
    mocks.result = { jurisdiction: "FR", changed: false, revokedGrants: 0 };
    const response = await put(body({ code: "fr" }));
    expect(response.status).toBe(200);
    expect(mocks.rpc[0]?.[1]).toMatchObject({ p_code: "FR" });
  });

  it("answers an opaque 404 when the current answer cannot be read, and writes nothing", async () => {
    vi.stubEnv("VERCEL", "1");
    mocks.currentError = { message: "unavailable" };
    expect((await put(body({ code: "FR" }))).status).toBe(404);
    expect(mocks.rpc).toEqual([]);
  });

  it("does not read the current answer for a country that is not paused", async () => {
    vi.stubEnv("VERCEL", "1");
    mocks.result = { jurisdiction: "US", changed: true, revokedGrants: 0 };
    expect((await put(body({ code: "US" }))).status).toBe(200);
    expect(mocks.reads).toBe(0);
  });

  it("off the hosted deployment, records a paused country without reading the current answer", async () => {
    mocks.result = { jurisdiction: "FR", changed: true, revokedGrants: 0 };
    expect((await put(body({ code: "FR" }))).status).toBe(200);
    expect(mocks.reads).toBe(0);
    expect(mocks.rpc[0]?.[1]).toMatchObject({ p_code: "FR" });
  });
});
