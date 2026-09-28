import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pause, resume and stop hand their writer the verified auth session, so the
 * writer can prove it is the account's own and live and record who acted
 * (20260930220000). Without one, nothing is written.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getClaims: vi.fn(),
  rpc: vi.fn(),
  person: vi.fn(),
  capability: vi.fn(),
  operation: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser, getClaims: mocks.getClaims } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/account-deletion", () => ({ isSameOrigin: () => true }));
vi.mock("@/lib/family/graph", () => ({ resolveFamilyPerson: mocks.person }));
vi.mock("@/lib/family/access", () => ({
  personCapability: mocks.capability,
  permits: (decision: { status: string }) => decision.status === "permitted",
}));
vi.mock("@/lib/family/grant-token", () => ({ readSharingOperation: mocks.operation }));

import { POST } from "./route";

const ACCOUNT = "5a500000-0000-4000-8000-000000000001";
const COUNTERPART = "5a500000-0000-4000-8000-000000000002";
const SESSION = "5a500000-0000-4000-8000-000000000011";

const post = (body: unknown) =>
  POST(
    new Request("https://inherit.test/api/family/p/sharing", {
      method: "POST",
      headers: { origin: "https://inherit.test", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ person: "p" }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: ACCOUNT } } });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: ACCOUNT, session_id: SESSION } } });
  mocks.person.mockResolvedValue({ counterpartAccountId: COUNTERPART });
  mocks.capability.mockResolvedValue({ status: "permitted" });
  mocks.operation.mockReturnValue({ accountId: ACCOUNT, counterpartAccountId: COUNTERPART });
  mocks.rpc.mockResolvedValue({ data: 1, error: null });
});

describe("POST /api/family/[person]/sharing", () => {
  it.each([
    ["pause", "pause_family_sharing_v2"],
    ["resume", "resume_family_sharing_v2"],
  ])("%s passes the verified session to the writer", async (operation, writer) => {
    expect((await post({ operation })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(writer, {
      p_account_id: ACCOUNT,
      p_session_id: SESSION,
      p_counterpart_account_id: COUNTERPART,
    });
  });

  it("stop passes the verified session to the writer", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ended_at: "2026-09-28T00:00:00Z", deleted_counts: {} }], error: null });
    expect((await post({ operation: "stop", nonce: "n".repeat(32) })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("stop_family_sharing_v2", {
      p_account_id: ACCOUNT,
      p_session_id: SESSION,
      p_counterpart_account_id: COUNTERPART,
    });
  });

  it.each([
    ["no verified claims", { data: { claims: undefined } }],
    ["claims for another account", { data: { claims: { sub: COUNTERPART, session_id: SESSION } } }],
    ["claims without a session", { data: { claims: { sub: ACCOUNT } } }],
  ])("answers 401 with %s and writes nothing", async (_label, claims) => {
    mocks.getClaims.mockResolvedValue(claims);
    expect((await post({ operation: "pause" })).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
