import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: mocks.send }; } }));
import { submitMail } from "@/lib/email";
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("RESEND_API_KEY", "synthetic-provider-test-key");
  vi.stubEnv("EMAIL_FROM", "Inherit <synthetic@example.test>");
  mocks.send.mockResolvedValue({ data: { id: "synthetic-provider-message" }, error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe("minimal information provider envelope", () => {
  it("uses the existing fixed correspondence contact and exact attempt key without adding authority or private content", async () => {
    expect(await submitMail("recipient@example.test", { id: "future-person-more-information", payload: {} }, "exact-attempt-key"))
      .toBe("synthetic-provider-message");
    expect(mocks.send).toHaveBeenCalledOnce();
    const [message, attempt] = mocks.send.mock.calls[0]!;
    expect(Object.keys(message).sort()).toEqual(["from", "html", "replyTo", "subject", "to"]);
    expect(message.replyTo).toBe("privacy@inherit.bio");
    expect(message.to).toBe("recipient@example.test"); expect(attempt).toEqual({ idempotencyKey: "exact-attempt-key" });
    expect(message.html).not.toMatch(/recipient@example\.test|privacy@inherit\.bio|wrapped|ciphertext|candidate|review_reason|dateOfBirth|\/withdraw\/request/iu);
    expect(message.html).toContain("closing date stays the same");
    expect(message.html).toContain("This message gives no access to a record.");
  });
  it("leaves every ordinary provider envelope unchanged", async () => {
    await submitMail("recipient@example.test", { id: "report-ready", payload: { reportCount: 1,
      dashboardUrl: "https://example.test/overview" } }, "ordinary-attempt-key");
    expect(Object.keys(mocks.send.mock.calls[0]![0]).sort()).toEqual(["from", "html", "subject", "to"]);
    expect(mocks.send.mock.calls[0]![1]).toEqual({ idempotencyKey: "ordinary-attempt-key" });
  });
  it("reports only the coded rejection when the provider rejects or omits its receipt", async () => {
    for (const response of [{ data: null, error: { message: "Synthetic private provider details" } }, { data: {}, error: null }]) {
      mocks.send.mockResolvedValue(response);
      await expect(submitMail("recipient@example.test", { id: "future-person-more-information", payload: {} }, "exact-attempt-key"))
        .rejects.toThrow("mail_provider_rejected");
    }
  });
});
