import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), request: vi.fn(), calls: [] as string[] }));
vi.mock("@/lib/account-deletion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-deletion")>()),
  getSensitiveAccountContext: mocks.context,
}));
/** A client that records every method called, so a write cannot hide. */
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const chain: Record<string, unknown> = {};
    for (const name of ["from", "select", "eq", "in", "order", "limit", "insert", "upsert", "update", "delete", "rpc"]) {
      chain[name] = (...args: unknown[]) => { mocks.calls.push(`${name}(${JSON.stringify(args[0] ?? "")})`); return chain; };
    }
    chain.maybeSingle = () => { mocks.calls.push("maybeSingle"); return mocks.request(); };
    return chain;
  },
}));
vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
const { deletionControlState } = await import("./account-deletion-state");
const { verifyAccountOperationNonce } = await import("./account-operation-nonce");
afterAll(() => vi.unstubAllEnvs());

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.context.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
});

describe("what /settings/data renders for deletion (brief X1.5)", () => {
  it("renders a deletion nonce after a read and writes nothing", async () => {
    mocks.request.mockResolvedValue({ data: null, error: null });
    const state = await deletionControlState();
    expect(state?.status).toBe("active");
    expect(verifyAccountOperationNonce(state!.operationNonce, { accountId: ACCOUNT, sessionId: SESSION, operation: "account_delete" }))
      .not.toBeNull();
    expect(mocks.calls.filter((call) => /^(insert|upsert|update|delete|rpc)\(/u.test(call))).toEqual([]);
    expect(mocks.calls[0]).toBe('from("account_deletion_requests")');
  });

  it("during the notice period renders only a cancellation nonce", async () => {
    mocks.request.mockResolvedValue({ data: { id: "x", state: "notice_period", notice_ends_at: "2026-10-05T12:00:00.000Z" }, error: null });
    const state = await deletionControlState();
    expect(state).toMatchObject({ status: "notice_period", noticeEndsAt: "2026-10-05T12:00:00.000Z" });
    const binding = { accountId: ACCOUNT, sessionId: SESSION };
    expect(verifyAccountOperationNonce(state!.operationNonce, { ...binding, operation: "account_delete_cancel" })).not.toBeNull();
    expect(verifyAccountOperationNonce(state!.operationNonce, { ...binding, operation: "account_delete" })).toBeNull();
  });

  it("renders nothing without a live account, or when the read fails", async () => {
    mocks.context.mockResolvedValue(null);
    expect(await deletionControlState()).toBeNull();
    mocks.context.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
    mocks.request.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await deletionControlState()).toBeNull();
  });
});
