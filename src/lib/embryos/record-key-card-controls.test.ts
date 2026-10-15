import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readEmbryoOperation, verifyEmbryoOperation } from "./operation-token";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), open: vi.fn() }));
vi.mock("@/lib/account-deletion", () => ({ getSensitiveAccountContext: mocks.auth }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/future-person/claims-open", () => ({ futurePersonClaimsOpen: mocks.open }));
import { recordKeyCardControls } from "./record-key-card-controls";
const NOW = Date.parse("2026-10-10T00:00:00Z"), C = "50000000-0000-4000-8000-000000000001",
  A = "50000000-0000-4000-8000-000000000002", S = "50000000-0000-4000-8000-000000000003",
  OTHER = "50000000-0000-4000-8000-000000000004";
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("BYOK_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://synthetic.example.invalid");
  mocks.open.mockReturnValue(true); mocks.auth.mockResolvedValue({ user: { id: A }, sessionId: S });
  mocks.rpc.mockResolvedValue({ data: { items: [{ cohortId: C, cardCount: 2 }], nextCursor: null }, error: null });
});
afterEach(() => vi.unstubAllEnvs());
it("binds each form to its actual account, live session, print purpose and exact cohort after a read-only inventory", async () => {
  const result = await recordKeyCardControls(null, NOW), control = result!.items[0];
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("embryo_record_key_card_controls_v1", { p_account: A, p_session: S, p_after: null });
  expect(Object.keys(control).sort()).toEqual(["cardCount", "claimUrl", "cohortId", "nonce"]);
  expect(control.claimUrl).toBe("https://synthetic.example.invalid/future-person/claim");
  const expected = { accountId: A, sessionId: S, operation: "record_key_print" as const, targetKind: "cohort" as const, targetId: C };
  expect(verifyEmbryoOperation(control.nonce, expected, NOW)).not.toBeNull();
  for (const changed of [{ accountId: OTHER }, { sessionId: OTHER }, { targetId: OTHER },
    { operation: "embryo_disposition" as const }, { targetKind: "embryo" as const }])
    expect(verifyEmbryoOperation(control.nonce, { ...expected, ...changed }, NOW)).toBeNull();
  expect(readEmbryoOperation(control.nonce, NOW)!.expiresAt).toBe(NOW + 600_000);
  const again = await recordKeyCardControls(OTHER, NOW);
  expect(mocks.rpc).toHaveBeenLastCalledWith("embryo_record_key_card_controls_v1", { p_account: A, p_session: S, p_after: OTHER });
  expect(again!.items[0].nonce).not.toBe(control.nonce);
  expect(JSON.stringify(result)).not.toMatch(/record_key|key_hash|recipient_principal|basis_revision/u);
});
it("preserves a one-card transfer subset and an empty current inventory", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { items: [{ cohortId: C, cardCount: 1 }], nextCursor: OTHER }, error: null });
  expect(await recordKeyCardControls(null, NOW)).toMatchObject({ items: [{ cardCount: 1 }], nextCursor: OTHER, unavailable: false });
  mocks.rpc.mockResolvedValueOnce({ data: { items: [], nextCursor: null }, error: null });
  expect(await recordKeyCardControls()).toEqual({ items: [], nextCursor: null, unavailable: false });
});
it("stops production, missing Auth and malformed pagination before a trusted read", async () => {
  mocks.open.mockReturnValueOnce(false); expect(await recordKeyCardControls()).toBeNull();
  expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.auth.mockResolvedValueOnce(null); expect(await recordKeyCardControls()).toBeNull();
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(await recordKeyCardControls("bad")).toEqual({ items: [], nextCursor: null, unavailable: true });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(["extra", "extra-item", "duplicate", "oversize", "empty-rights", "too-many-cards", "fraction", "bad-cohort", "bad-cursor"])
  ("refuses %s without issuing any card control", async kind => {
    const row: Record<string, unknown> = { cohortId: C, cardCount: 2 };
    const value: Record<string, unknown> = { items: [row], nextCursor: null };
    if (kind === "extra") value.recordKeys = [];
    if (kind === "extra-item") row.key_hash = "protected";
    if (kind === "duplicate") value.items = [row, { ...row }];
    if (kind === "oversize") value.items = Array.from({ length: 65 }, () => ({ ...row }));
    if (kind === "empty-rights") row.cardCount = 0;
    if (kind === "too-many-cards") row.cardCount = 65;
    if (kind === "fraction") row.cardCount = 1.5;
    if (kind === "bad-cohort") row.cohortId = "bad";
    if (kind === "bad-cursor") value.nextCursor = "bad";
    mocks.rpc.mockResolvedValueOnce({ data: value, error: null });
    expect(await recordKeyCardControls()).toEqual({ items: [], nextCursor: null, unavailable: true });
  });
it("keeps source errors and throws out of the form and never returns partial controls", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "protected evidence" } });
  expect(await recordKeyCardControls()).toEqual({ items: [], nextCursor: null, unavailable: true });
  mocks.rpc.mockRejectedValueOnce(new Error("protected evidence"));
  expect(await recordKeyCardControls()).toEqual({ items: [], nextCursor: null, unavailable: true });
});
