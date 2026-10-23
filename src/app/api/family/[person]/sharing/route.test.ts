import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/family/[person]/sharing` (register api.family-sharing). Since
 * 20261023120000 (G5.6, owner decision of 23 October 2026) each operation
 * records its one-time nonce in the database before the sharing function
 * runs, so the legal audit names who acted and a replay writes nothing:
 * pause and resume carry a person operation nonce minted for this route and
 * this counterpart, and the stop's own nonce is recorded too.
 */
vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
const mocks = vi.hoisted(() => ({ context: vi.fn(), person: vi.fn(), capability: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/account-deletion", async (load) => ({
  ...await load<typeof import("@/lib/account-deletion")>(), getSensitiveAccountContext: mocks.context, isSameOrigin: () => true,
}));
vi.mock("@/lib/family/graph", () => ({ resolveFamilyPerson: mocks.person }));
vi.mock("@/lib/family/access", () => ({
  personCapability: mocks.capability,
  permits: (decision: { status: string }) => decision.status === "permitted",
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

const { POST } = await import("./route");
const { mintPersonOperationNonce } = await import("@/lib/person-operation-nonce");
const { mintSharingOperation } = await import("@/lib/family/grant-token");
const { hashOperationNonce } = await import("@/lib/account-deletion");

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COUNTERPART = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const SEGMENT = "s-cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const code = (operation: "family_sharing_pause" | "family_sharing_resume", overrides: Partial<{ sessionId: string; targetId: string }> = {}) =>
  mintPersonOperationNonce({ accountId: ACCOUNT, sessionId: SESSION, operation, targetId: COUNTERPART, ...overrides });
const call = (body: unknown) => POST(new Request(`https://inherit.test/api/family/${SEGMENT}/sharing`, {
  method: "POST", headers: { "content-type": "application/json", origin: "https://inherit.test" }, body: JSON.stringify(body),
}), { params: Promise.resolve({ person: SEGMENT }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
  mocks.person.mockResolvedValue({ counterpartAccountId: COUNTERPART, handle: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" } });
  mocks.capability.mockResolvedValue({ status: "permitted" });
  mocks.rpc.mockImplementation(async (name: string) => name === "stop_family_sharing_with_nonce_v1"
    ? { data: [{ ended_at: "2026-10-23T09:00:00.000Z", deleted_counts: { portrait_results: 1 } }], error: null }
    : { data: 1, error: null });
});

describe("POST /api/family/[person]/sharing", () => {
  it.each([["pause", "family_sharing_pause"], ["resume", "family_sharing_resume"]] as const)(
    "%ss through the door that records the page's nonce for this counterpart", async (operation, kind) => {
      const nonce = code(kind);
      const response = await call({ operation, nonce });
      expect(response.status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(`${operation}_family_sharing_with_nonce_v1`, { p_account_id: ACCOUNT,
        p_session_id: SESSION, p_counterpart_account_id: COUNTERPART, p_nonce_hash: hashOperationNonce(nonce), p_nonce_expires_at: expect.any(String) });
    });

  it.each([
    ["no nonce", () => ({ operation: "pause" })],
    ["the resume's nonce", () => ({ operation: "pause", nonce: code("family_sharing_resume") })],
    ["another counterpart's nonce", () => ({ operation: "pause", nonce: code("family_sharing_pause", { targetId: OTHER }) })],
    ["another session's nonce", () => ({ operation: "resume", nonce: code("family_sharing_resume", { sessionId: OTHER }) })],
  ])("refuses a pause or resume with %s before any write", async (_label, body) => {
    expect((await call(body())).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("records the stop's own nonce with the stop", async () => {
    const nonce = mintSharingOperation({ accountId: ACCOUNT, counterpartAccountId: COUNTERPART, operation: "stop" });
    const response = await call({ operation: "stop", nonce });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("stop_family_sharing_with_nonce_v1", { p_account_id: ACCOUNT, p_session_id: SESSION,
      p_counterpart_account_id: COUNTERPART, p_nonce_hash: hashOperationNonce(nonce), p_nonce_expires_at: expect.any(String) });
  });

  it("refuses a stop for another counterpart before any write", async () => {
    const nonce = mintSharingOperation({ accountId: ACCOUNT, counterpartAccountId: OTHER, operation: "stop" });
    expect((await call({ operation: "stop", nonce })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("still rechecks the jurisdiction before a resume", async () => {
    mocks.capability.mockResolvedValue({ status: "unavailable" });
    expect((await call({ operation: "resume", nonce: code("family_sharing_resume") })).status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
