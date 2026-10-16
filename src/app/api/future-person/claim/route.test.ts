import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

const route = await import("./route");
const { CLAIM_CSRF_HEADER, CLAIM_FORM_COOKIE, CLAIM_SESSION_COOKIE, mintClaimForm } = await import(
  "@/lib/future-person/claim-session"
);

const ORIGIN = "https://inherit.bio";
const ADDRESS = "203.0.113.7";
const RECORD_KEY = "0123456789ABCDEFGHJK";
const RECOVERY_KEY = "MNPQRSTVWXYZ01234567";
const identity = { claimantName: "Ada Example", contactEmail: "claimant@e2e.local", affirmed: true };
const bodies = {
  "record-key": { mode: "record-key", recordKey: RECORD_KEY, claimantDateOfBirth: "2000-01-31", ...identity },
  "claimant-recovery-key": { mode: "claimant-recovery-key", recoveryKey: RECOVERY_KEY, claimantDateOfBirth: "2000-01-31", ...identity },
  "keyless-start": {
    mode: "keyless-start",
    childDateOfBirth: "2008-09-28",
    childPlaceOfBirth: "Leeds",
    parentNames: ["Parent One", "Parent Two"],
    ...identity,
  },
} as const;
type Mode = keyof typeof bodies;
const MODES = Object.keys(bodies) as Mode[];
/** Every plaintext value a claimant typed, and the address they came from. */
const PLAINTEXT = ["Ada Example", "claimant@e2e.local", RECORD_KEY, RECOVERY_KEY, "Leeds", "Parent One", "2000-01-31", "2008-09-28", ADDRESS];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  vi.stubEnv("INHERIT_HMAC_KEYRING", "");
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: "received", error: null });
});
afterEach(() => vi.unstubAllEnvs());

function cookieValue(setCookie: string): string {
  return setCookie.slice(setCookie.indexOf("=") + 1, setCookie.indexOf(";"));
}

function claim(body: unknown, options: { raw?: string; headers?: Record<string, string>; form?: ReturnType<typeof mintClaimForm> } = {}) {
  const form = options.form ?? mintClaimForm();
  return new Request(`${ORIGIN}/api/future-person/claim`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-real-ip": ADDRESS,
      [CLAIM_CSRF_HEADER]: form.formToken,
      cookie: `${CLAIM_FORM_COOKIE}=${cookieValue(form.setCookie)}`,
      ...options.headers,
    },
    body: options.raw ?? JSON.stringify(body),
  });
}

function rpcArgs(call = 0): Record<string, unknown> {
  expect(mocks.rpc.mock.calls[call]?.[0]).toBe("start_future_person_claim_v1");
  return mocks.rpc.mock.calls[call]![1] as Record<string, unknown>;
}

/** The status, the body and the header names: everything a caller can compare. */
async function shape(response: Response) {
  return {
    status: response.status,
    body: await response.text(),
    headers: [...response.headers.keys()].sort(),
    cookieNames: response.headers.getSetCookie().map((line) => line.slice(0, line.indexOf("="))),
  };
}

describe("POST /api/future-person/claim (api.future-person-claim)", () => {
  it("exports POST alone", () => {
    expect(Object.keys(route).filter((name) => /^[A-Z]+$/.test(name))).toEqual(["POST"]);
  });

  it("is the opaque 404 where claims are not open, and touches nothing", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    const response = await route.POST(claim(bodies["record-key"]));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each([
    ["no token", { headers: { [CLAIM_CSRF_HEADER]: "" } }],
    ["another origin", { headers: { origin: "https://elsewhere.invalid" } }],
    ["cross-site fetch metadata", { headers: { "sec-fetch-site": "cross-site" } }],
    ["no form cookie", { headers: { cookie: "" } }],
  ])("is the opaque 404 with %s, before reading the body", async (_label, options) => {
    const response = await route.POST(claim(bodies["record-key"], options));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("refuses a body over 8 KiB or not JSON as the whole body", async () => {
    for (const raw of ["{", `{"mode":"record-key","pad":"${"x".repeat(8 * 1024)}"}`, "ÿ"]) {
      const response = await route.POST(claim(null, { raw }));
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_request", issues: ["body"] });
    }
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("names the invalid fields and never echoes what was typed", async () => {
    const response = await route.POST(
      claim({ ...bodies["record-key"], claimantName: "Zyxwvut\u0001", recordKey: "not-a-key-value", claimantDateOfBirth: "2015-01-01" }),
    );
    expect(response.status).toBe(422);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "invalid_request", issues: ["claimantDateOfBirth", "claimantName", "recordKey"] });
    for (const typed of ["Zyxwvut", "not-a-key-value", "2015-01-01"]) expect(text).not.toContain(typed);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("answers every mode the same way: 202, one closed body, one claim session", async () => {
    const shapes = [];
    for (const mode of MODES) {
      const response = await route.POST(claim(bodies[mode]));
      expect(response.status).toBe(202);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      const [session, spentForm] = response.headers.getSetCookie();
      expect(session).toMatch(new RegExp(`^${CLAIM_SESSION_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=86400; HttpOnly; SameSite=Strict$`));
      expect(spentForm).toBe(`${CLAIM_FORM_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`);
      shapes.push(await shape(response));
    }
    expect(shapes[0]!.body).toBe('{"status":"received"}');
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
  });

  it("stores only the session hash, never the cookie secret", async () => {
    const response = await route.POST(claim(bodies["record-key"]));
    const secret = cookieValue(response.headers.getSetCookie()[0]!);
    const args = rpcArgs();
    expect(args.p_session_hash).toBe(crypto.createHash("sha256").update(secret).digest("hex"));
    expect(JSON.stringify(args)).not.toContain(secret);
  });

  it.each(MODES)("sends the %s start with no plaintext name, contact, key or address", async (mode) => {
    await route.POST(claim(bodies[mode]));
    const args = rpcArgs();
    const serialized = JSON.stringify(args);
    for (const plain of PLAINTEXT) {
      expect(serialized).not.toContain(plain);
      expect(serialized).not.toContain(Buffer.from(plain).toString("hex"));
    }
    expect(Object.keys(args).sort()).toEqual([
      "p_form_nonce_hash", "p_identifier_digests", "p_identity_ciphertext", "p_key_hash",
      "p_mode", "p_network_digests", "p_session_hash", "p_wrapped_data_key",
    ]);
    expect(args.p_mode).toBe(mode);
    expect(args.p_form_nonce_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_identity_ciphertext).toMatch(/^\\x[0-9a-f]+$/);
    expect(args.p_wrapped_data_key).toMatch(/^\\x[0-9a-f]+$/);
    for (const digests of [args.p_identifier_digests, args.p_network_digests]) {
      expect(digests).toEqual({ "1": expect.stringMatching(/^[0-9a-f]{64}$/) });
    }
    const key = mode === "record-key" ? RECORD_KEY : mode === "claimant-recovery-key" ? RECOVERY_KEY : null;
    expect(args.p_key_hash).toBe(key === null ? null : crypto.createHash("sha256").update(key).digest("hex"));
  });

  it("keys the network limit by network, and the identifier limit by what was claimed", async () => {
    await route.POST(claim(bodies["record-key"]));
    await route.POST(claim(bodies["claimant-recovery-key"]));
    await route.POST(claim(bodies["record-key"], { headers: { "x-real-ip": "198.51.100.9" } }));
    await route.POST(claim(bodies["record-key"], { headers: { "x-real-ip": "2001:db8:1:2:aaaa::1" } }));
    await route.POST(claim(bodies["record-key"], { headers: { "x-real-ip": "2001:db8:1:2:bbbb::9" } }));
    const [first, otherKey, otherNetwork, v6a, v6b] = [0, 1, 2, 3, 4].map((call) => rpcArgs(call));
    expect(otherKey!.p_network_digests).toEqual(first!.p_network_digests);
    expect(otherKey!.p_identifier_digests).not.toEqual(first!.p_identifier_digests);
    expect(otherNetwork!.p_network_digests).not.toEqual(first!.p_network_digests);
    expect(otherNetwork!.p_identifier_digests).toEqual(first!.p_identifier_digests);
    expect(v6b!.p_network_digests).toEqual(v6a!.p_network_digests);
  });

  it("keys a keyless start by its contact, so a new key does not reset it", async () => {
    await route.POST(claim(bodies["keyless-start"]));
    await route.POST(claim({ ...bodies["keyless-start"], childPlaceOfBirth: "York", contactEmail: "Claimant@E2E.local" }));
    expect(rpcArgs(1).p_identifier_digests).toEqual(rpcArgs(0).p_identifier_digests);
  });

  it("answers every refused start with the one shared 429, no cookie and no session", async () => {
    mocks.rpc.mockResolvedValue({ data: "capacity_limited", error: null });
    const shapes = [];
    for (const mode of MODES) {
      const response = await route.POST(claim(bodies[mode]));
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("900");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      shapes.push(await shape(response));
    }
    expect(shapes[0]!.body).toBe('{"error":"try_again_later"}');
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
  });

  it("gives a replayed form the opaque 404 and no second session", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "claim form already used" } });
    const response = await route.POST(claim(bodies["record-key"]));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each([
    ["a database error", { data: null, error: { code: "22023", message: "claim intake invalid" } }],
    ["an answer it does not know", { data: "accepted", error: null }],
  ])("is unavailable on %s, with no cookie", async (_label, result) => {
    mocks.rpc.mockResolvedValue(result);
    const response = await route.POST(claim(bodies["record-key"]));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
