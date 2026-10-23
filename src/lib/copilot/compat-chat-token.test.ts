import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

/**
 * The compatibility panel's context token (G8.5, 23 October 2026): minted by
 * /copilot/[scope] for one account, auth session and subject, under its own
 * MAC domain, for nine minutes. Every value is synthetic.
 */
vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
const { isCompatChatRequest, mintCompatChatToken, readCompatChatToken } = await import("./compat-chat-token");
const { readOwnChatToken } = await import("./own-chat-token");
const { hmacSecret } = await import("@/lib/crypto");

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUBJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = 1_800_000_000_000;
const claims = { accountId: ACCOUNT, sessionId: SESSION, subjectId: SUBJECT };

describe("the compatibility context token", () => {
  it("reads back exactly what it was minted for, from this route, for nine minutes", () => {
    const token = mintCompatChatToken(claims, NOW);
    expect(readCompatChatToken(token, NOW)).toMatchObject({ ...claims, issuingRoute: "copilot.scope", issuedAt: NOW, expiresAt: NOW + 540000 });
    expect(readCompatChatToken(token, NOW + 539999)).not.toBeNull();
    expect(readCompatChatToken(token, NOW + 540000)).toBeNull();
    expect(readCompatChatToken(token, NOW - 1)).toBeNull();
  });

  it("is a fresh token on every mint", () => {
    expect(mintCompatChatToken(claims, NOW)).not.toBe(mintCompatChatToken(claims, NOW));
  });

  it("refuses a changed payload, a changed signature, extra parts and non-strings", () => {
    const token = mintCompatChatToken(claims, NOW);
    const [payload, sig] = token.split(".");
    const other = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), subjectId: ACCOUNT }))
      .toString("base64url");
    for (const bad of [`${other}.${sig}`, `${payload}.${"0".repeat(64)}`, `${token}.extra`, "", null, 7, "a".repeat(12001)]) {
      expect(readCompatChatToken(bad, NOW)).toBeNull();
    }
  });

  it("refuses invalid claims at mint", () => {
    expect(() => mintCompatChatToken({ ...claims, subjectId: "me" }, NOW)).toThrow();
  });

  it("never reads as an own token, and the same claims signed in the own token's domain never read as this one", () => {
    const compat = mintCompatChatToken(claims, NOW);
    expect(readOwnChatToken(compat, NOW)).toBeNull();
    const [payload] = compat.split(".");
    expect(readCompatChatToken(`${payload}.${hmacSecret(payload, "own-copilot-context-v1")}`, NOW)).toBeNull();
    expect(readCompatChatToken(`${payload}.${hmacSecret(payload, "copilot-compat-context-v1")}`, NOW)).not.toBeNull();
  });

  it("recognises the panel's registered body by its token", () => {
    const token = mintCompatChatToken(claims);
    expect(isCompatChatRequest({ contextToken: token, message: "What does my file say about caffeine?" })).toBe(true);
    expect(isCompatChatRequest({ contextToken: "x".repeat(40), message: "x" })).toBe(false);
    expect(isCompatChatRequest({ chatId: SUBJECT, message: "x" })).toBe(false);
    expect(isCompatChatRequest({ id: "x", messages: [], trigger: "submit-message" })).toBe(false);
    expect(isCompatChatRequest(null)).toBe(false);
  });
});
