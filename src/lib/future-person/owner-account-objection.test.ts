import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ account: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/account-deletion", () => ({ getSensitiveAccountContext: mocks.account }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 21).toString("base64"));
const { mintOwnerAccountObjection, readOwnerAccountObjection, ownerAccountObjectionControls } = await import("./owner-account-objection");
const { decryptSecret, encryptSecret, hmacSecret } = await import("@/lib/crypto");
const account = { accountId: "61000000-0000-4000-8000-000000000031", authSessionId: "61000000-0000-4000-8000-000000000032" };
const notice = { noticeId: "61000000-0000-4000-8000-000000000033", noticeRevision: 2, noticeDeadline: new Date(Date.now() + 30 * 86400000).toISOString() };
function request(csrf: string, headers: Record<string, string> = {}) {
  return new Request("https://test.e2e.local/api/future-person/claim/session/objection", { method: "POST", headers: {
    origin: "https://test.e2e.local", "sec-fetch-site": "same-origin", "x-inherit-csrf": csrf, ...headers,
  } });
}
beforeEach(() => { mocks.account.mockReset(); mocks.rpc.mockReset(); mocks.account.mockResolvedValue({ user: { id: account.accountId }, sessionId: account.authSessionId }); });
afterAll(() => vi.unstubAllEnvs());
describe("independent current-owner account action", () => {
  it("issues a stateless encrypted ten-minute proof capped by the immutable notice period", () => {
    const now = Date.now(), proof = mintOwnerAccountObjection(account, { ...notice, noticeDeadline: new Date(now + 1000).toISOString() }, now);
    const parsed = readOwnerAccountObjection(request(proof.csrf), proof.nonce, account, now)!;
    expect(parsed.expiresAt).toBe(now + 1000); expect(parsed.noticeId).toBe(notice.noticeId); expect(parsed.noticeRevision).toBe(2);
    expect(parsed.nonce).toMatch(/^[A-Za-z0-9_-]{32}$/u); expect(proof.nonce).not.toContain(notice.noticeId);
    expect(readOwnerAccountObjection(request(proof.csrf), proof.nonce, account, now + 1000)).toBeNull();
    expect(() => mintOwnerAccountObjection(account, { ...notice, noticeDeadline: new Date(now).toISOString() }, now)).toThrow();
  });
  it("refuses changed Auth account/session, CSRF, origin, time, operation or forged fields", () => {
    const now = Date.now(), proof = mintOwnerAccountObjection(account, notice, now);
    expect(readOwnerAccountObjection(request(proof.csrf), proof.nonce, account, now)).not.toBeNull();
    expect(readOwnerAccountObjection(request(proof.csrf), proof.nonce, { ...account, accountId: notice.noticeId }, now)).toBeNull();
    expect(readOwnerAccountObjection(request(proof.csrf), proof.nonce, { ...account, authSessionId: notice.noticeId }, now)).toBeNull();
    for (const headers of [{ origin: "https://other.e2e.local" }, { "sec-fetch-site": "cross-site" }, { "x-inherit-csrf": "f".repeat(64) }] as Record<string, string>[])
      expect(readOwnerAccountObjection(request(proof.csrf, headers), proof.nonce, account, now)).toBeNull();
    expect(readOwnerAccountObjection(request(proof.csrf), proof.nonce, account, now + 600001)).toBeNull();
    const opened = JSON.parse(decryptSecret(Buffer.from(proof.nonce, "hex")));
    for (const changed of [{ ...opened, operation: "owner-link-objection" }, { ...opened, issuedAt: now + 1 },
      { ...opened, expiresAt: now + 600001 }, { ...opened, subjectId: notice.noticeId }]) {
      const nonce = encryptSecret(JSON.stringify(changed)).toString("hex"), csrf = hmacSecret(nonce, "owner-account-objection-csrf-v1");
      expect(readOwnerAccountObjection(request(csrf), nonce, account, now)).toBeNull();
    }
  });
  it("reads only through own Auth before minting controls and exposes no target/cipher/contact in the UI DTO", async () => {
    mocks.rpc.mockResolvedValue({ data: { items: [{ ...notice, safeNoticeSummary: "A claim to a record you hold is pending.",
      objectionArtifactBody: "Your objection pauses only this claim while a named person reviews it. Your record stays as it is.", allowedActionIds: ["object"] }], nextCursor: null }, error: null });
    const result = await ownerAccountObjectionControls(); expect(result?.unavailable).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith("future_person_owner_objection_controls_v1", { p_after: null });
    expect(Object.keys(result!.items[0]!).sort()).toEqual(["csrf", "deadline", "explanation", "nonce", "summary"]);
    expect(JSON.stringify(result)).not.toContain(notice.noticeId); expect(JSON.stringify(result)).not.toContain(account.accountId);
    expect(JSON.stringify(result)).not.toContain(account.authSessionId);
  });
  it("performs no selector for missing own Auth or malformed cursor, and refuses wider inventories", async () => {
    mocks.account.mockResolvedValue(null); expect(await ownerAccountObjectionControls()).toBeNull(); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.account.mockResolvedValue({ user: { id: account.accountId }, sessionId: account.authSessionId });
    expect((await ownerAccountObjectionControls("bad"))?.unavailable).toBe(true); expect(mocks.rpc).not.toHaveBeenCalled();
    for (const data of [{ items: [], nextCursor: null, claimant: "unexpected" }, { items: [{ ...notice, claimant: "unexpected" }], nextCursor: null }]) {
      mocks.rpc.mockResolvedValue({ data, error: null }); expect((await ownerAccountObjectionControls())?.unavailable).toBe(true);
    }
  });
});
