import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), terminal: vi.fn(), invitationTerminal: vi.fn(), submit: vi.fn() }));
vi.mock("@/lib/embryo/terminal-mail", () => ({ drainEmbryoTerminalMail: mocks.terminal }));
vi.mock("@/lib/embryos/invitation-terminal-mail", () => ({ drainInvitationTerminalMail: mocks.invitationTerminal }));
vi.mock("@/lib/email", () => ({ submitMail: mocks.submit }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: () => "synthetic@example.test", hmacSecret: () => "provider-id-hash" }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => ({ select: () => ({ eq: () => ({ lte: () => ({ gt: async () => ({ count: 0 }) }) }) }) }),
  }),
}));

describe("independent mail queues", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("JOBS_SECRET", "test-job-secret");
    mocks.terminal.mockResolvedValue({ processed: 0, failed: 0 });
    mocks.invitationTerminal.mockResolvedValue({ processed: 0, failed: 0 });
    mocks.submit.mockResolvedValue("synthetic-provider-id");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("continues ordinary delivery when the independent terminal queue fails", async () => {
    vi.stubEnv("JOBS_SECRET", "test-job-secret");
    mocks.terminal.mockRejectedValue(new Error("terminal_mail_unavailable"));
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const response = await POST(new Request("http://localhost/api/jobs/mail", {
      method: "POST", headers: { authorization: "Bearer test-job-secret" },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 0, failed: 1, pending: 0 });
    expect(mocks.rpc).toHaveBeenCalledWith("claim_mail_outbox");
  });

  const row = {
    outbox_id: "synthetic-outbox", attempt_ordinal: 2,
    contact_ciphertext: "\\x00", template_id: "co-parent-invitation",
    template_payload: {}, delivery_token: "a".repeat(43), idempotency_key: "synthetic-mail-key",
  };
  function workerRequest() {
    return new Request("http://localhost/api/jobs/mail", {
      method: "POST", headers: { authorization: "Bearer test-job-secret" },
    });
  }
  function claimOnce(authorization: { data: boolean | null; error: unknown }, completionError: unknown = null) {
    let claimed = false;
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_mail_outbox") {
        const data = claimed ? [] : [row];
        claimed = true;
        return { data, error: null };
      }
      if (name === "authorize_mail_submission_v1") return authorization;
      if (name === "complete_mail_attempt") return { data: null, error: completionError };
      throw new Error(`Unexpected RPC ${name}`);
    });
  }

  it.each([
    { data: false, error: null },
    { data: null, error: { message: "authorization unavailable" } },
  ])("does not submit an invalidated or unverifiable claim: %j", async (authorization) => {
    claimOnce(authorization);
    const response = await POST(workerRequest());
    expect(await response.json()).toEqual({ processed: 0, failed: 1, pending: 0 });
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("authorize_mail_submission_v1", {
      p_outbox_id: row.outbox_id, p_attempt_ordinal: 2,
    });
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "complete_mail_attempt")).toEqual([]);
  });

  it("checks the exact claim before submitting and records provider acceptance", async () => {
    claimOnce({ data: true, error: null });
    const response = await POST(workerRequest());
    expect(await response.json()).toEqual({ processed: 1, failed: 0, pending: 0 });
    const authorizationIndex = mocks.rpc.mock.calls.findIndex(([name]) => name === "authorize_mail_submission_v1");
    expect(mocks.rpc.mock.invocationCallOrder[authorizationIndex]).toBeLessThan(mocks.submit.mock.invocationCallOrder[0]);
    expect(mocks.submit).toHaveBeenCalledWith("synthetic@example.test", {
      id: "co-parent-invitation", payload: { invitationUrl: expect.stringContaining(`/withdraw/request#${row.delivery_token}`) },
    }, row.idempotency_key);
    expect(mocks.rpc).toHaveBeenCalledWith("complete_mail_attempt", expect.objectContaining({
      p_success: true, p_outcome_code: "accepted", p_provider_message_id_hmac: "provider-id-hash",
    }));
  });

  it("does not overwrite provider acceptance with a failure after a lost database receipt", async () => {
    claimOnce({ data: true, error: null }, { message: "receipt unavailable" });
    const response = await POST(workerRequest());
    expect(await response.json()).toEqual({ processed: 0, failed: 1, pending: 0 });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    const receipts = mocks.rpc.mock.calls.filter(([name]) => name === "complete_mail_attempt");
    expect(receipts).toHaveLength(1);
    expect(receipts[0][1]).toMatchObject({ p_success: true, p_outcome_code: "accepted" });
  });

  it("records a failure when the provider rejects the request", async () => {
    claimOnce({ data: true, error: null });
    mocks.submit.mockRejectedValue(new Error("provider rejected"));
    const response = await POST(workerRequest());
    expect(await response.json()).toEqual({ processed: 0, failed: 1, pending: 0 });
    expect(mocks.rpc).toHaveBeenCalledWith("complete_mail_attempt", expect.objectContaining({
      p_success: false, p_outcome_code: "provider_or_payload_error",
    }));
  });
});
