import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mintFamilyChatToken, readFamilyChatToken } from "./family-chat-token";
import { mintOwnChatToken, readOwnChatToken } from "./own-chat-token";
import type { OwnCopilotAuthority } from "./own-provider-authority";

const authority: OwnCopilotAuthority = { accountId: "80000000-0000-4000-8000-000000000001", sessionId: "80000000-0000-4000-8000-000000000002",
  subjectId: "80000000-0000-4000-8000-000000000003", context: { accountRevision: 1, authSessionRevision: 1, jurisdictionRevision: 1,
    subjectBindingRevision: 1, accountBindingRevision: 1, uploadConsentId: "80000000-0000-4000-8000-000000000004", subjectLifecycleRevision: 1,
    originatingSessionRevision: 1, principalId: "80000000-0000-4000-8000-000000000005", principalRevision: 1 },
  settingsRevision: 1, providerClass: "local", runtimeAttestationRevision: 1, runtimeAttestationFingerprint: "a".repeat(64), recipientRevision: 1,
  copilotGrantId: "80000000-0000-4000-8000-000000000006", copilotGrantRevision: 1, providerGrantId: null, providerGrantRevision: null };

const claims = { accountId: "80000000-0000-4000-8000-000000000001", sessionId: "80000000-0000-4000-8000-000000000002",
  providerHash: "a".repeat(64), membersHash: "b".repeat(64) };

describe("the Family group scope's context token", () => {
  // A fixed synthetic key for the HMAC under test; restored after each case.
  beforeEach(() => { vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64")); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("binds account, session, provider and the exact group the page showed, with a fresh nonce", () => {
    const one = mintFamilyChatToken(claims, 1000), two = mintFamilyChatToken(claims, 1000);
    expect(readFamilyChatToken(one, 1001)).toMatchObject({ ...claims, scope: "family", issuingRoute: "copilot.scope",
      issuedAt: 1000, expiresAt: 541000 });
    expect(one).not.toEqual(two);
  });

  it("refuses altered claims, a future or expired token, and extended or oversized input", () => {
    const token = mintFamilyChatToken(claims, 1000);
    const [payload, sig] = token.split(".");
    const altered = JSON.parse(Buffer.from(payload, "base64url").toString());
    altered.membersHash = "c".repeat(64);
    expect(readFamilyChatToken(`${Buffer.from(JSON.stringify(altered)).toString("base64url")}.${sig}`, 1001)).toBeNull();
    expect(readFamilyChatToken(token, 999)).toBeNull();
    expect(readFamilyChatToken(token, 541000)).toBeNull();
    expect(readFamilyChatToken(`${token}.extra`, 1001)).toBeNull();
    expect(readFamilyChatToken("a".repeat(12001), 1001)).toBeNull();
  });

  it("cannot be presented as an own-scope token, nor an own-scope token as this one", () => {
    const family = mintFamilyChatToken(claims, 1000);
    const own = mintOwnChatToken({ authority, projectionHash: "d".repeat(64) }, 1000);
    expect(readOwnChatToken(family, 1001)).toBeNull();
    expect(readFamilyChatToken(own, 1001)).toBeNull();
  });
});
