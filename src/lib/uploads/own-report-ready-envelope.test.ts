import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getUser: vi.fn(), profile: vi.fn() }));
vi.mock("../supabase/server", () => ({ createClient: async () => ({ auth }) }));
vi.mock("../supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: auth.profile }) }) }) }) }));
import { ownReportReadyEnvelope } from "./own-report-ready-envelope";
import { decryptSecret } from "../crypto";
const account = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
beforeEach(() => {
  vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://inherit.bio");
  auth.profile.mockResolvedValue({ data: { mail_contact_revision: 1 }, error: null });
  auth.getUser.mockResolvedValue({ data: { user: { id: account, email: " Ready@e2e.local ", email_confirmed_at: "2026-09-07T08:00:00Z" } } });
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe("server-resolved own report-ready recipient", () => {
  it("normalizes and encrypts only the verified actor address with a fixed non-bearer destination", async () => {
    const envelope = await ownReportReadyEnvelope(account);
    expect(decryptSecret(Buffer.from(envelope.contactCiphertext, "hex"))).toBe("ready@e2e.local");
    expect(envelope.contactRevision).toBe(1);
    expect(auth.profile.mock.invocationCallOrder[0]).toBeLessThan(auth.getUser.mock.invocationCallOrder[0]);
    expect(envelope.dashboardUrl).toBe("https://inherit.bio/genome/me/reports");
    const replay = await ownReportReadyEnvelope(account);
    expect(replay.contactHmac).toBe(envelope.contactHmac);
    expect(replay.contactCiphertext).not.toBe(envelope.contactCiphertext);
  });
  it("rejects a changed actor instead of readdressing the event", async () => {
    await expect(ownReportReadyEnvelope("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).rejects.toThrow("unavailable");
  });
  it("refuses unverified account contact", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: account, email: "ready@e2e.local" } } });
    await expect(ownReportReadyEnvelope(account)).rejects.toThrow("unavailable");
  });
  it("refuses plaintext fallback when encryption is not configured", async () => {
    vi.stubEnv("BYOK_ENCRYPTION_KEY", "");
    await expect(ownReportReadyEnvelope(account)).rejects.toThrow();
  });
  it("refuses credential-bearing or non-web configured destinations", async () => {
    for (const origin of ["https://user:password@inherit.bio", "javascript:alert(1)", "https://inherit.bio/?token=secret"]) {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", origin);
      await expect(ownReportReadyEnvelope(account)).rejects.toThrow();
    }
  });
  it("refuses a missing or invalid server revision before fetching a contact", async () => {
    auth.profile.mockResolvedValue({ data: { mail_contact_revision: 0 }, error: null });
    await expect(ownReportReadyEnvelope(account)).rejects.toThrow("unavailable");
    expect(auth.getUser).not.toHaveBeenCalled();
  });

});
