import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret } from "./crypto";
import { enqueueAccountMail } from "./mail-outbox";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc }),
}));

const candidate = {
  accountId: "72000000-0000-0000-0000-000000000001",
  email: "  MAIL-CLOCK@example.invalid ",
  mail: {
    id: "report-ready" as const,
    payload: { reportCount: 1, dashboardUrl: "https://example.invalid/reports" },
  },
  purpose: "report.ready",
  targetKind: "genome_file",
  targetId: "72000000-0000-0000-0000-000000000002",
  semanticKey: "report-ready:fixture",
};

describe("account mail deadline ownership", () => {
  beforeEach(() => {
    vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    rpc.mockReset().mockResolvedValue({ data: "queued-id", error: null });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([-86_400_000, -25, 0, 25, 86_400_000])(
    "omits the default deadline with application clock skew %i ms",
    async (skew) => {
      vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 5) + skew);
      await expect(enqueueAccountMail(candidate)).resolves.toBe("queued-id");
      expect(rpc).toHaveBeenCalledWith("enqueue_account_mail", expect.any(Object));
      const args = rpc.mock.calls[0][1];
      expect(args).not.toHaveProperty("p_expires_at");
      expect(Object.keys(args).sort()).toEqual([
        "p_account_id", "p_contact_ciphertext", "p_contact_hmac",
        "p_idempotency_key", "p_purpose", "p_target_id", "p_target_kind",
        "p_template_id", "p_template_payload",
      ]);
      expect(args.p_template_payload).toEqual(candidate.mail.payload);
      expect(args.p_contact_hmac).toMatch(/^[0-9a-f]{64}$/);
      expect(decryptSecret(Buffer.from(args.p_contact_ciphertext.slice(2), "hex")))
        .toBe("mail-clock@example.invalid");
    },
  );

  it.each(["2020-01-01T00:00:00.000Z", "2026-09-06T10:20:30.123Z", "2100-01-01T00:00:00.000Z"])(
    "passes explicit deadline %s unchanged for strict database validation",
    async (deadline) => {
      vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 5) + 25);
      await enqueueAccountMail({ ...candidate, expiresAt: new Date(deadline) });
      expect(rpc.mock.calls[0][1].p_expires_at).toBe(deadline);
    },
  );

  it("keeps semantic idempotency stable across clocks and an explicit deadline", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    await enqueueAccountMail(candidate);
    clock.mockReturnValue(Date.UTC(2100, 0, 1));
    await enqueueAccountMail({ ...candidate, expiresAt: new Date("2026-09-06T00:00:00Z") });
    expect(rpc.mock.calls[0][1].p_idempotency_key)
      .toBe(rpc.mock.calls[1][1].p_idempotency_key);
  });

  it("returns only the existing coded failure without logging database details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: "private-database-detail" } });
    await expect(enqueueAccountMail(candidate)).rejects.toThrow(/^mail_enqueue_failed$/);
    expect(log).not.toHaveBeenCalled();
  });
});
