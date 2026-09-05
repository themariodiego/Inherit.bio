import { beforeEach, describe, expect, it, vi } from "vitest";
import { drainEmbryoTerminalMail } from "./terminal-mail";
import type { createAdminClient } from "@/lib/supabase/admin";

const mocks = vi.hoisted(() => ({ decrypt: vi.fn(), hmac: vi.fn(), submit: vi.fn() }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: mocks.decrypt, hmacSecret: mocks.hmac }));
vi.mock("@/lib/email", () => ({ submitMail: mocks.submit }));

function fixture(completionError = false) {
  let claimed = false;
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_embryo_terminal_mail_v1") {
      if (claimed) return { data: [], error: null };
      claimed = true;
      return { data: [{ notice_id: "notice", claim_token: "claim", contact_ciphertext: "0102", idempotency_key: "fixed-key" }], error: null };
    }
    return { data: !completionError, error: completionError ? {} : null };
  });
  return { rpc, admin: { rpc } as unknown as ReturnType<typeof createAdminClient> };
}

describe("independent embryo terminal delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decrypt.mockReturnValue("recipient@example.test");
    mocks.hmac.mockReturnValue("a".repeat(64));
    mocks.submit.mockResolvedValue("provider-id");
  });

  it("sends only the fixed data-free template and acknowledges the exact claim", async () => {
    const { admin, rpc } = fixture();
    await expect(drainEmbryoTerminalMail(admin)).resolves.toEqual({ processed: 1, failed: 0 });
    expect(mocks.submit).toHaveBeenCalledWith("recipient@example.test", {
      id: "embryo-ingest-abandoned", payload: {},
    }, "fixed-key");
    expect(rpc).toHaveBeenCalledWith("complete_embryo_terminal_mail_v1", {
      p_notice_id: "notice", p_claim_token: "claim", p_accepted: true, p_provider_message_hmac: "a".repeat(64),
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("recipient@example.test");
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("provider-id");
  });

  it("records coded provider failure without logging plaintext or provider errors", async () => {
    mocks.submit.mockRejectedValue(new Error("sensitive provider content"));
    const log = vi.spyOn(console, "error");
    const { admin, rpc } = fixture();
    await expect(drainEmbryoTerminalMail(admin)).resolves.toEqual({ processed: 0, failed: 1 });
    expect(rpc).toHaveBeenCalledWith("complete_embryo_terminal_mail_v1", {
      p_notice_id: "notice", p_claim_token: "claim", p_accepted: false, p_provider_message_hmac: "",
    });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("does not overwrite an uncertain accepted ACK with a failure ACK", async () => {
    const { admin, rpc } = fixture(true);
    await expect(drainEmbryoTerminalMail(admin)).rejects.toThrow("terminal_mail_completion_failed");
    expect(rpc.mock.calls.filter(([name]) => name === "complete_embryo_terminal_mail_v1")).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith("complete_embryo_terminal_mail_v1", expect.objectContaining({ p_accepted: true }));
  });
});
