import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mintCohortChatToken, readCohortChatToken } from "./cohort-chat-token";
import { mintFamilyChatToken, readFamilyChatToken } from "./family-chat-token";

const claims = { accountId: "80000000-0000-4000-8000-000000000001", sessionId: "80000000-0000-4000-8000-000000000002",
  cohortId: "c0000000-0000-4000-8000-000000000001", providerHash: "a".repeat(64), authorityHash: "b".repeat(64) };

describe("the cohort scope's context token", () => {
  // A fixed synthetic key for the HMAC under test; restored after each case.
  beforeEach(() => { vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64")); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("binds account, session, cohort, provider and the exact authority the page read under, with a fresh nonce", () => {
    const one = mintCohortChatToken(claims, 1000), two = mintCohortChatToken(claims, 1000);
    expect(readCohortChatToken(one, 1001)).toMatchObject({ ...claims, scope: "cohort", issuingRoute: "copilot.scope",
      issuedAt: 1000, expiresAt: 541000 });
    expect(one).not.toEqual(two);
  });

  it("refuses an altered cohort or authority, a future or expired token, and extended or oversized input", () => {
    const token = mintCohortChatToken(claims, 1000);
    const [payload, sig] = token.split(".");
    for (const change of [{ cohortId: "c0000000-0000-4000-8000-0000000000ff" }, { authorityHash: "c".repeat(64) }]) {
      const altered = { ...JSON.parse(Buffer.from(payload, "base64url").toString()), ...change };
      expect(readCohortChatToken(`${Buffer.from(JSON.stringify(altered)).toString("base64url")}.${sig}`, 1001)).toBeNull();
    }
    expect(readCohortChatToken(token, 999)).toBeNull();
    expect(readCohortChatToken(token, 541000)).toBeNull();
    expect(readCohortChatToken(`${token}.extra`, 1001)).toBeNull();
    expect(readCohortChatToken("a".repeat(12001), 1001)).toBeNull();
  });

  it("cannot be presented as a Family token, nor a Family token as this one", () => {
    const cohort = mintCohortChatToken(claims, 1000);
    const family = mintFamilyChatToken({ accountId: claims.accountId, sessionId: claims.sessionId,
      providerHash: "a".repeat(64), membersHash: "b".repeat(64) }, 1000);
    expect(readFamilyChatToken(cohort, 1001)).toBeNull();
    expect(readCohortChatToken(family, 1001)).toBeNull();
  });
});
