import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const {
  SHARE_WITH_ADULT_ARTIFACT,
  mintArtifactPresentation,
  mintCohortGrantPresentation,
  mintGrantPresentation,
  mintSharingOperation,
  newNonce,
  readArtifactPresentation,
  readCohortGrantPresentation,
  readGrantPresentation,
  readSharingOperation,
} = await import("./grant-token");
const { hmacSecret } = await import("@/lib/crypto");

afterAll(() => {
  vi.unstubAllEnvs();
});

/** The module's own envelope, so a forged payload can be signed correctly and still refused on its content. */
function sealAs(claims: unknown, context: string): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${hmacSecret(payload, context)}`;
}

const NOW = 1_800_000_000_000;
const TEN_MINUTES = 10 * 60 * 1000;

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
