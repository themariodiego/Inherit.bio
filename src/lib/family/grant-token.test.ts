import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const {
  SHARE_WITH_ADULT_ARTIFACT,
  mintGrantPresentation,
  mintSharingOperation,
  newNonce,
  readGrantPresentation,
  readSharingOperation,
} = await import("./grant-token");

afterAll(() => {
  vi.unstubAllEnvs();
});

const CLAIMS = {
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  dataSubjectId: "11111111-1111-4111-8111-111111111111",
  subjectBindingRevision: 1,
  recipientPrincipalId: "22222222-2222-4222-8222-222222222222",
  recipientAccountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  purpose: "reports.polygenic" as const,
  artifactKey: SHARE_WITH_ADULT_ARTIFACT,
  artifactVersion: 1,
  artifactBodySha256: "a".repeat(64),
  jurisdictionRevision: 1,
};

describe("directional grant presentation token", () => {
  it("round-trips exactly the endpoints it was minted for", () => {
    const claims = readGrantPresentation(mintGrantPresentation(CLAIMS));
    expect(claims).toMatchObject({ ...CLAIMS, direction: "subject_to_recipient" });
    expect(claims!.nonce).toMatch(/^[A-Za-z0-9_-]{16,256}$/);
    expect(claims!.nonce).not.toMatch(/\s/);
  });

  it("refuses a tampered payload, a foreign signature and a stale token", () => {
    const token = mintGrantPresentation(CLAIMS);
    const [payload, signature] = token.split(".");
    const swapped = Buffer.from(
      JSON.stringify({ ...CLAIMS, purpose: "raw.export", direction: "subject_to_recipient", nonce: newNonce(), expiresAt: Date.now() + 1000 }),
      "utf8",
    ).toString("base64url");
    expect(readGrantPresentation(`${swapped}.${signature}`)).toBeNull();
    expect(readGrantPresentation(`${payload}.${"0".repeat(signature.length)}`)).toBeNull();
    expect(readGrantPresentation(payload)).toBeNull();
    expect(readGrantPresentation("")).toBeNull();
    expect(readGrantPresentation(token, Date.now() + 11 * 60 * 1000)).toBeNull();
  });

  it("mints a different nonce every time, so no token is replayable as another", () => {
    const first = readGrantPresentation(mintGrantPresentation(CLAIMS))!;
    const second = readGrantPresentation(mintGrantPresentation(CLAIMS))!;
    expect(first.nonce).not.toBe(second.nonce);
  });

  it("keeps the sharing operation envelope separate from the grant envelope", () => {
    const operation = mintSharingOperation({
      accountId: CLAIMS.accountId,
      counterpartAccountId: CLAIMS.recipientAccountId,
      operation: "stop",
    });
    expect(readSharingOperation(operation)).toMatchObject({
      accountId: CLAIMS.accountId,
      counterpartAccountId: CLAIMS.recipientAccountId,
      operation: "stop",
    });
    // A grant token is not an operation nonce and the reverse, because the
    // two envelopes are signed under different contexts.
    expect(readSharingOperation(mintGrantPresentation(CLAIMS))).toBeNull();
    expect(readGrantPresentation(operation)).toBeNull();
  });
});
