import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), terminal: vi.fn() }));
vi.mock("@/lib/embryo/terminal-mail", () => ({ drainEmbryoTerminalMail: mocks.terminal }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => ({ select: () => ({ eq: () => ({ lte: () => ({ gt: async () => ({ count: 0 }) }) }) }) }),
  }),
}));

describe("independent mail queues", () => {
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
});
