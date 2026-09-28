import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The invitation routes hand the database a keyed digest set and the quota
 * bucket keys, never a bare address digest, a raw address, an account id as a
 * bucket key (global-contact-refusal-bar-v1.barKeyring
 * and .quotaAuthority). The database enforces both; these cases pin what the
 * routes send and how they answer each database outcome.
 */

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  update: vi.fn(),
  account: vi.fn(),
  user: vi.fn(),
  capability: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => ({ update: (...args: unknown[]) => { mocks.update(...args); return chain; } }),
  }),
}));
const chain: Record<string, unknown> = {};
chain.eq = () => chain;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.user } }),
}));
vi.mock("@/lib/account-deletion", () => ({ getSensitiveAccountContext: mocks.account, isSameOrigin: () => true }));
vi.mock("@/lib/legal/jurisdictions", async (original) => ({
  ...(await original<typeof import("@/lib/legal/jurisdictions")>()),
  accountCapability: mocks.capability,
}));
vi.mock("@/lib/embryos/guards", async (original) => ({
  ...(await original<typeof import("@/lib/embryos/guards")>()),
  accountJurisdictionDenied: async () => null,
  csrfOperation: () => ({ nonce: "csrf-nonce-aaaaaaaaaaaaaaaa" }),
}));

const { POST: inviteCoParent } = await import("@/app/api/invitations/route");
const { POST: inviteAdult } = await import("@/app/api/subject-drafts/route");
const { legacyContactDigest } = await import("@/lib/hmac-keyring");

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DRAFT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const INVITED = "invited-person@example.invalid";
const KEY_2 = crypto.randomBytes(32).toString("base64");

beforeEach(() => {
  vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
  vi.stubEnv("INHERIT_HMAC_KEYRING", `2:${KEY_2}`);
  vi.clearAllMocks();
  mocks.account.mockResolvedValue({ user: { id: ACCOUNT, email: "owner@example.invalid" }, sessionId: "s" });
  mocks.user.mockResolvedValue({ data: { user: { id: ACCOUNT, email: "owner@example.invalid" } } });
  mocks.capability.mockResolvedValue({ status: "permitted" });
});
afterEach(() => vi.unstubAllEnvs());

const post = (path: string, body: unknown) => new Request(`https://inherit.bio${path}`, {
  method: "POST",
  headers: { origin: "https://inherit.bio", "content-type": "application/json" },
  body: JSON.stringify(body),
});
const coParent = () => post("/api/invitations", { targetCohortDraftId: DRAFT, contactEmail: INVITED });
const adult = () => post("/api/subject-drafts", {
  kind: "other_adult", adultFlow: "path-a-own-account", email: INVITED,
  adultAttestation: true, requestId: crypto.randomUUID(),
});

function sentArgs(): Record<string, unknown> {
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  return mocks.rpc.mock.calls[0]![1] as Record<string, unknown>;
}

function expectKeyedCall(args: Record<string, unknown>) {
  expect(args.p_contact_hmac).toBeNull();
  const set = args.p_contact_hmac_set as Record<string, string>;
  expect(Object.keys(set)).toEqual(["1", "2"]);
  expect(set["1"]).toBe(legacyContactDigest(INVITED));
  expect(set["2"]).toMatch(/^[0-9a-f]{64}$/);
  const quota = args.p_quota_keys as Record<string, Record<string, string>>;
  expect(Object.keys(quota)).toEqual(["1", "2"]);
  for (const revision of Object.values(quota)) {
    expect(Object.keys(revision)).toEqual(["authenticated-principal"]);
    expect(revision["authenticated-principal"]).toMatch(/^[0-9a-f]{64}$/);
  }
  const serialized = JSON.stringify(args);
  for (const plain of [INVITED, `|${ACCOUNT}`]) expect(serialized).not.toContain(plain);
}

describe("POST /api/invitations (co-parent)", () => {
  it("sends the address under every held revision with the account quota key", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ invitation_id: crypto.randomUUID(), expires_at: "x" }], error: null });
    const response = await inviteCoParent(coParent());
    expect(response.status).toBe(202);
    expect(mocks.rpc.mock.calls[0]![0]).toBe("create_embryo_draft_invitation_v1");
    expectKeyedCall(sentArgs());
  });

  it("answers an exhausted quota exactly as it answers an issued invitation", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ invitation_id: crypto.randomUUID(), expires_at: "x" }], error: null });
    const issued = await inviteCoParent(coParent());
    mocks.rpc.mockResolvedValue({ data: [{ invitation_id: null, expires_at: null }], error: null });
    const exhausted = await inviteCoParent(coParent());
    expect(exhausted.status).toBe(issued.status);
    expect(await exhausted.json()).toEqual(await issued.json());
  });

  it("keeps the idempotency key stable when a revision is added", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await inviteCoParent(coParent());
    vi.stubEnv("INHERIT_HMAC_KEYRING", `2:${KEY_2},3:${crypto.randomBytes(32).toString("base64")}`);
    await inviteCoParent(coParent());
    const [first, second] = mocks.rpc.mock.calls.map((call) => (call[1] as { p_idempotency_key: string }).p_idempotency_key);
    expect(first).toBe(second);
  });

  it.each([
    ["keyed digest set incomplete"], ["keyed digest set required"], ["rate limit keys required"],
  ])("answers 503 when the database refuses the keys (%s)", async (message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "55000", message } });
    expect((await inviteCoParent(coParent())).status).toBe(503);
  });
});

describe("POST /api/subject-drafts (adult invitation)", () => {
  it("sends the address under every held revision with the account quota key", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ invitation_id: crypto.randomUUID() }], error: null });
    const response = await inviteAdult(adult());
    expect(response.status).toBe(202);
    expect(mocks.rpc.mock.calls[0]![0]).toBe("create_adult_subject_invitation_v1");
    expectKeyedCall(sentArgs());
  });

  it("answers an exhausted quota exactly as it answers an issued invitation", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ invitation_id: crypto.randomUUID() }], error: null });
    const issued = await inviteAdult(adult());
    mocks.rpc.mockResolvedValue({ data: [{ invitation_id: null, subject_id: null }], error: null });
    const exhausted = await inviteAdult(adult());
    expect(exhausted.status).toBe(issued.status);
    expect(await exhausted.json()).toEqual(await issued.json());
  });

  it("answers 503 when the database refuses the keys", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "keyed digest set incomplete" } });
    expect((await inviteAdult(adult())).status).toBe(503);
  });

  it("fails closed on a malformed keyring instead of sending fewer revisions", async () => {
    vi.stubEnv("INHERIT_HMAC_KEYRING", "2:not-a-key");
    await expect(inviteAdult(adult())).rejects.toThrow(/INHERIT_HMAC_KEYRING/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/withdraw/session (adult confirm)", () => {
  it("sends the account address under every held revision and nothing bare", async () => {
    const { POST: respond } = await import("@/app/api/withdraw/session/route");
    const { mintPublicFormToken } = await import("./operation-token");
    const { newRightsSessionSecret, RIGHTS_COOKIE_NAME, rightsSessionHash } = await import("./rights-session");
    const secret = newRightsSessionSecret();
    const hash = rightsSessionHash(secret);
    mocks.account.mockResolvedValue({
      user: { id: ACCOUNT, email: "Invited-Person@Example.invalid", email_confirmed_at: "2026-09-01T00:00:00Z" },
      sessionId: "s",
    });
    mocks.rpc.mockResolvedValue({ data: "accepted", error: null });
    const response = await respond(new Request("https://inherit.bio/api/withdraw/session", {
      method: "POST",
      headers: {
        origin: "https://inherit.bio", "sec-fetch-site": "same-origin", "content-type": "application/json",
        cookie: `${RIGHTS_COOKIE_NAME}=${secret}`,
      },
      body: JSON.stringify({ operation: "confirm", nonce: mintPublicFormToken("adult-subject-respond", Date.now(), hash) }),
    }));
    expect(response.status).toBe(202);
    expect(mocks.rpc.mock.calls[0]![0]).toBe("respond_adult_subject_invitation_session_v1");
    const args = sentArgs();
    expect(args).not.toHaveProperty("p_account_email_hmac");
    const set = args.p_account_email_hmac_set as Record<string, string>;
    expect(Object.keys(set)).toEqual(["1", "2"]);
    expect(set["1"]).toBe(legacyContactDigest("invited-person@example.invalid"));
    expect(JSON.stringify(args).toLowerCase()).not.toContain("invited-person@example.invalid");
  });
});
