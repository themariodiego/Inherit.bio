import { beforeEach, describe, expect, it, vi } from "vitest";
import { drainInvitationTerminalMail } from "./invitation-terminal-mail";
import type { createAdminClient } from "@/lib/supabase/admin";

const mocks = vi.hoisted(() => ({ decrypt: vi.fn(), hmac: vi.fn(), submit: vi.fn() }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: mocks.decrypt, hmacSecret: mocks.hmac }));
vi.mock("@/lib/email", () => ({ submitMail: mocks.submit }));

function fixture(overrides: Record<string, unknown> = {}, authorize: boolean | boolean[] = true, complete = true) {
  let claimed = false;
  let authorizations = 0;
  const row = { outbox_id: "outbox", attempt_ordinal: 2, idempotency_key: "original-key",
    notice_kind: "invitation-refused", contact_ciphertext: "\\x0102", recipient_account_id: null, ...overrides };
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_invitation_terminal_mail_v1") {
      if (claimed) return { data: [], error: null };
      claimed = true;
      return { data: [row], error: null };
    }
    if (name === "authorize_invitation_terminal_mail_v1") return {
      data: Array.isArray(authorize) ? authorize[authorizations++] ?? false : authorize, error: null,
    };
    return { data: complete, error: complete ? null : {} };
  });
  const getUserById = vi.fn().mockResolvedValue({ data: { user: { email: "owner@example.test", email_confirmed_at: "2026-09-06" } }, error: null });
  const admin = { rpc, auth: { admin: { getUserById } } } as unknown as ReturnType<typeof createAdminClient>;
  return { admin, rpc, getUserById };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decrypt.mockReturnValue("recipient@example.test");
  mocks.hmac.mockReturnValue("a".repeat(64));
  mocks.submit.mockResolvedValue("provider-id");
});

describe("canonical invitation terminal delivery", () => {
  it("sends a closed data-free template to the decrypted recipient with the original key", async () => {
    const { admin, rpc, getUserById } = fixture();
    await expect(drainInvitationTerminalMail(admin)).resolves.toEqual({ processed: 1, failed: 0 });
    expect(mocks.decrypt).toHaveBeenCalledWith(Buffer.from("0102", "hex"));
    expect(getUserById).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledWith("recipient@example.test",
      { id: "invitation-terminal-notice", payload: { kind: "invitation-refused" } }, "original-key");
    expect(rpc).toHaveBeenCalledWith("complete_invitation_terminal_mail_v1", {
      p_outbox_id: "outbox", p_attempt_ordinal: 2, p_success: true, p_provider_message_hmac: "a".repeat(64),
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/recipient@example|provider-id/u);
  });

  it("resolves only the server-selected owner's current verified email after authorization", async () => {
    const { admin, rpc, getUserById } = fixture({ contact_ciphertext: null, recipient_account_id: "owner" });
    await expect(drainInvitationTerminalMail(admin)).resolves.toEqual({ processed: 1, failed: 0 });
    expect(getUserById).toHaveBeenCalledExactlyOnceWith("owner");
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(rpc.mock.invocationCallOrder[1]).toBeLessThan(getUserById.mock.invocationCallOrder[0]);
    expect(getUserById.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[2]);
    expect(rpc.mock.invocationCallOrder[2]).toBeLessThan(mocks.submit.mock.invocationCallOrder[0]);
    expect(mocks.submit.mock.calls[0][0]).toBe("owner@example.test");
  });

  it("does not send if account authority changes while the verified address is being resolved", async () => {
    const { admin, rpc, getUserById } = fixture({ contact_ciphertext: null, recipient_account_id: "owner" }, [true, false]);
    await expect(drainInvitationTerminalMail(admin)).resolves.toEqual({ processed: 0, failed: 1 });
    expect(getUserById).toHaveBeenCalledTimes(1);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(rpc.mock.calls.some(([name]) => name === "complete_invitation_terminal_mail_v1")).toBe(false);
  });

  it("does not read any recipient or call the provider after authority is lost", async () => {
    const { admin, getUserById } = fixture({}, false);
    await expect(drainInvitationTerminalMail(admin)).resolves.toEqual({ processed: 0, failed: 1 });
    expect(getUserById).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it.each(["missing", "unverified", "lookup-error"])("does not send an owner notice with %s recipient authority", async mode => {
    const { admin, getUserById, rpc } = fixture({ contact_ciphertext: null, recipient_account_id: "owner" });
    getUserById.mockResolvedValue(mode === "lookup-error" ? { data: { user: null }, error: {} } :
      { data: { user: mode === "missing" ? null : { email: "owner@example.test" } }, error: null });
    await expect(drainInvitationTerminalMail(admin)).resolves.toEqual({ processed: 0, failed: 1 });
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("complete_invitation_terminal_mail_v1",
      expect.objectContaining({ p_success: false, p_provider_message_hmac: "" }));
  });

  it.each([
    { notice_kind: "unregistered-template" }, { contact_ciphertext: null },
    { recipient_account_id: "owner" },
  ])("refuses malformed notice authority %j", async overrides => {
    const { admin } = fixture(overrides);
    await expect(drainInvitationTerminalMail(admin)).resolves.toEqual({ processed: 0, failed: 1 });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("does not log a provider error or put it into a receipt", async () => {
    mocks.submit.mockRejectedValue(new Error("recipient@example.test: sensitive provider response"));
    const log = vi.spyOn(console, "error");
    const { admin, rpc } = fixture();
    await expect(drainInvitationTerminalMail(admin)).resolves.toEqual({ processed: 0, failed: 1 });
    expect(log).not.toHaveBeenCalled();
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("sensitive");
    log.mockRestore();
  });

  it("never overwrites an uncertain accepted receipt with a failure acknowledgment", async () => {
    const { admin, rpc } = fixture({}, true, false);
    await expect(drainInvitationTerminalMail(admin)).rejects.toThrow("invitation_terminal_mail_completion_failed");
    const receipts = rpc.mock.calls.filter(([name]) => name === "complete_invitation_terminal_mail_v1");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toEqual(["complete_invitation_terminal_mail_v1",
      expect.objectContaining({ p_success: true, p_provider_message_hmac: "a".repeat(64) })]);
  });
});

// 20261119160000 (owner decision of 19 November 2026): the notice to another
// adult whose uploader withdrew is one more closed kind of the same queue,
// sent to its sealed contact exactly as a refused invitation's is.
describe("the uploader's withdrawal notice", () => {
  it("is sent as its own closed kind to the decrypted contact, and an unknown kind is never sent", async () => {
    const { admin } = fixture({ notice_kind: "upload-permission-withdrawn" });
    await expect(drainInvitationTerminalMail(admin)).resolves.toEqual({ processed: 1, failed: 0 });
    expect(mocks.submit).toHaveBeenCalledWith("recipient@example.test",
      { id: "invitation-terminal-notice", payload: { kind: "upload-permission-withdrawn" } }, "original-key");
    mocks.submit.mockClear();
    const unknown = fixture({ notice_kind: "upload-permission-ended" });
    await expect(drainInvitationTerminalMail(unknown.admin)).resolves.toEqual({ processed: 0, failed: 1 });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});

// 20261122100000: a record transfer's notices are five more closed kinds of the
// same queue, always addressed to an account; the address is read from that
// account only here, between the two authorizations, and never decrypted.
describe("the record transfer's notices", () => {
  it.each(["subject-transfer-new-owner", "subject-transfer-former-owner", "subject-transfer-access-revoked",
    "withdrawal-transfer-new-owner", "withdrawal-transfer-former-owner"])(
    "sends %s to the account's verified address, rechecked after the lookup", async kind => {
      const { admin, rpc, getUserById } = fixture({ notice_kind: kind, contact_ciphertext: null, recipient_account_id: "person" });
      await expect(drainInvitationTerminalMail(admin)).resolves.toEqual({ processed: 1, failed: 0 });
      expect(getUserById).toHaveBeenCalledExactlyOnceWith("person");
      expect(mocks.decrypt).not.toHaveBeenCalled();
      expect(mocks.submit).toHaveBeenCalledWith("owner@example.test",
        { id: "invitation-terminal-notice", payload: { kind } }, "original-key");
      expect(rpc.mock.calls.filter(([name]) => name === "authorize_invitation_terminal_mail_v1")).toHaveLength(2);
    });

  it("sends nothing when the account is no longer current after the lookup", async () => {
    const { admin } = fixture({ notice_kind: "withdrawal-transfer-new-owner", contact_ciphertext: null,
      recipient_account_id: "person" }, [true, false]);
    await expect(drainInvitationTerminalMail(admin)).resolves.toEqual({ processed: 0, failed: 1 });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});

// D-141 (20261120120000): the second notice and the re-notice to an adult who
// accepted through their own account are two more closed kinds of the same
// queue, always addressed to that account. The address is read from the
// account only here, between the two authorizations, and never decrypted.
describe("the second notice and the re-notice", () => {
  it.each(["adult-acceptance-second-notice", "adult-revocation-renotice"])(
    "sends %s to the account's verified address, rechecked after the lookup", async kind => {
      const { admin, rpc, getUserById } = fixture({ notice_kind: kind, contact_ciphertext: null, recipient_account_id: "person" });
      await expect(drainInvitationTerminalMail(admin)).resolves.toEqual({ processed: 1, failed: 0 });
      expect(getUserById).toHaveBeenCalledExactlyOnceWith("person");
      expect(mocks.decrypt).not.toHaveBeenCalled();
      expect(mocks.submit).toHaveBeenCalledWith("owner@example.test",
        { id: "invitation-terminal-notice", payload: { kind } }, "original-key");
      expect(rpc.mock.calls.filter(([name]) => name === "authorize_invitation_terminal_mail_v1")).toHaveLength(2);
      expect(getUserById.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[2]);
    });

  it.each(["adult-acceptance-second-notice", "adult-revocation-renotice"])(
    "sends nothing for %s when the database refuses it after the lookup (deleted, barred or transferred since)", async kind => {
      const { admin } = fixture({ notice_kind: kind, contact_ciphertext: null, recipient_account_id: "person" }, [true, false]);
      await expect(drainInvitationTerminalMail(admin)).resolves.toEqual({ processed: 0, failed: 1 });
      expect(mocks.submit).not.toHaveBeenCalled();
    });
});
