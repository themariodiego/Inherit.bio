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

  it("refuses a signature of the digest's character length but another byte length, without throwing", () => {
    const wide = `abcdefghijklmnopqrstuvwxyz.${"é".repeat(64)}`;
    expect(() => readGrantPresentation(wide)).not.toThrow();
    expect(readGrantPresentation(wide)).toBeNull();
    expect(readSharingOperation(wide)).toBeNull();
    expect(readArtifactPresentation(wide)).toBeNull();
    expect(readCohortGrantPresentation(wide)).toBeNull();
    // A well-formed payload with the same malformed signature is refused too.
    const token = mintGrantPresentation(CLAIMS);
    const payload = token.slice(0, token.lastIndexOf("."));
    expect(readGrantPresentation(`${payload}.${"é".repeat(64)}`)).toBeNull();
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

const ARTIFACT = {
  accountId: CLAIMS.accountId,
  targetKind: "cohort_draft" as const,
  targetId: "33333333-3333-4333-8333-333333333333",
  artifactKey: "attestation.embryo-parentage",
  artifactVersion: 1,
  artifactBodySha256: "b".repeat(64),
  statementKeys: ["genetic-parent-of-these-embryos", "other-parent-named-truthfully", "false-statement-warning-read"],
};

const COHORT_GRANT = {
  accountId: CLAIMS.accountId,
  cohortId: "44444444-4444-4444-8444-444444444444",
  purpose: "embryo.analysis" as const,
  artifactKey: "consent.upload-embryo",
  artifactVersion: 1,
  artifactBodySha256: "c".repeat(64),
  participantSetRevision: 2,
};

/**
 * The embryo artifact presentation (E0 contract §5.3, §6.2, §6.5): the page
 * binds the signer, the target, the artifact's key, version and body hash
 * and the statement keys it showed; the route signs what was shown, never
 * what the body says.
 */
describe("artifact presentation token", () => {
  it("round-trips exactly the claims it was minted for, with a fresh nonce and a ten-minute expiry", () => {
    const token = mintArtifactPresentation(ARTIFACT, NOW);
    const claims = readArtifactPresentation(token, NOW);
    expect(claims).toMatchObject(ARTIFACT);
    expect(claims!.expiresAt).toBe(NOW + TEN_MINUTES);
    expect(claims!.nonce).toMatch(/^[A-Za-z0-9_-]{16,256}$/);
    expect(Object.keys(claims!).sort()).toEqual([...Object.keys(ARTIFACT), "nonce", "expiresAt"].sort());
    // The statement keys are copied, so neither side can change the other's list.
    expect(claims!.statementKeys).not.toBe(ARTIFACT.statementKeys);
  });

  it("accepts a cohort target, and refuses any other target kind even when correctly signed", () => {
    const cohort = { ...ARTIFACT, targetKind: "cohort" as const };
    expect(readArtifactPresentation(mintArtifactPresentation(cohort, NOW), NOW)).toMatchObject(cohort);
    const forged = { ...ARTIFACT, targetKind: "subject", nonce: newNonce(), expiresAt: NOW + 1000 };
    expect(readArtifactPresentation(sealAs(forged, "artifact-presentation-v1"), NOW)).toBeNull();
  });

  it("refuses statement keys that are not all strings, a stale token and a tampered one", () => {
    const context = "artifact-presentation-v1";
    const base = { ...ARTIFACT, nonce: newNonce(), expiresAt: NOW + 1000 };
    expect(readArtifactPresentation(sealAs(base, context), NOW)).not.toBeNull();
    expect(readArtifactPresentation(sealAs({ ...base, statementKeys: ["a", 1] }, context), NOW)).toBeNull();
    expect(readArtifactPresentation(sealAs({ ...base, statementKeys: "a" }, context), NOW)).toBeNull();
    expect(readArtifactPresentation(sealAs({ ...base, artifactVersion: "1" }, context), NOW)).toBeNull();
    expect(readArtifactPresentation(sealAs(null, context), NOW)).toBeNull();
    const token = mintArtifactPresentation(ARTIFACT, NOW);
    expect(readArtifactPresentation(token, NOW + TEN_MINUTES - 1)).not.toBeNull();
    expect(readArtifactPresentation(token, NOW + TEN_MINUTES)).toBeNull();
    const [payload, signature] = token.split(".");
    expect(readArtifactPresentation(`${payload}.${"0".repeat(signature.length)}`, NOW)).toBeNull();
    expect(readArtifactPresentation(payload, NOW)).toBeNull();
    expect(readArtifactPresentation("", NOW)).toBeNull();
  });

  it("mints a different nonce every time", () => {
    const first = readArtifactPresentation(mintArtifactPresentation(ARTIFACT, NOW), NOW)!;
    const second = readArtifactPresentation(mintArtifactPresentation(ARTIFACT, NOW), NOW)!;
    expect(first.nonce).not.toBe(second.nonce);
  });
});

/**
 * The cohort grant presentation (contract §5.3, §6.2): bound to the cohort
 * and the participant-set revision the page rendered, so a grant cannot be
 * signed against a cohort whose parents changed meanwhile.
 */
describe("cohort grant presentation token", () => {
  it("round-trips exactly the claims it was minted for", () => {
    const token = mintCohortGrantPresentation(COHORT_GRANT, NOW);
    const claims = readCohortGrantPresentation(token, NOW);
    expect(claims).toMatchObject(COHORT_GRANT);
    expect(claims!.expiresAt).toBe(NOW + TEN_MINUTES);
    expect(claims!.nonce).toMatch(/^[A-Za-z0-9_-]{16,256}$/);
    expect(Object.keys(claims!).sort()).toEqual([...Object.keys(COHORT_GRANT), "nonce", "expiresAt"].sort());
  });

  it("refuses any purpose but embryo.analysis, a non-numeric revision, a stale token and a tampered one", () => {
    const context = "cohort-grant-presentation-v1";
    const base = { ...COHORT_GRANT, nonce: newNonce(), expiresAt: NOW + 1000 };
    expect(readCohortGrantPresentation(sealAs(base, context), NOW)).not.toBeNull();
    expect(readCohortGrantPresentation(sealAs({ ...base, purpose: "reports.polygenic" }, context), NOW)).toBeNull();
    expect(readCohortGrantPresentation(sealAs({ ...base, participantSetRevision: "2" }, context), NOW)).toBeNull();
    expect(readCohortGrantPresentation(sealAs(null, context), NOW)).toBeNull();
    const token = mintCohortGrantPresentation(COHORT_GRANT, NOW);
    expect(readCohortGrantPresentation(token, NOW + TEN_MINUTES)).toBeNull();
    const [payload, signature] = token.split(".");
    expect(readCohortGrantPresentation(`${payload}.${"0".repeat(signature.length)}`, NOW)).toBeNull();
    expect(readCohortGrantPresentation("", NOW)).toBeNull();
  });

  it("keeps all four envelopes apart: no token reads under another context", () => {
    const grant = mintGrantPresentation(CLAIMS, NOW);
    const operation = mintSharingOperation({ accountId: CLAIMS.accountId, counterpartAccountId: CLAIMS.recipientAccountId, operation: "stop" }, NOW);
    const artifact = mintArtifactPresentation(ARTIFACT, NOW);
    const cohortGrant = mintCohortGrantPresentation(COHORT_GRANT, NOW);
    for (const token of [grant, operation, cohortGrant]) expect(readArtifactPresentation(token, NOW)).toBeNull();
    for (const token of [grant, operation, artifact]) expect(readCohortGrantPresentation(token, NOW)).toBeNull();
    for (const token of [artifact, cohortGrant]) {
      expect(readGrantPresentation(token, NOW)).toBeNull();
      expect(readSharingOperation(token, NOW)).toBeNull();
    }
  });
});
