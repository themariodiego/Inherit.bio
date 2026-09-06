import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { hmacSecret } from "@/lib/crypto";
import { ownConsentBody } from "./own-consent";
import { mintOwnConsentPresentation, readOwnConsentPresentation } from "./own-consent-token";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
afterAll(() => vi.unstubAllEnvs());
const NOW = 1_800_000_000_000;
const input = {
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  subjectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  accountRevision: 1, authSessionRevision: 2, jurisdictionRevision: 3, subjectBindingRevision: 4, accountBindingRevision: 1,
  artifactKey: "consent.upload-self" as const, artifactVersion: 1, artifactBodySha256: "a".repeat(64),
};
function seal(value: unknown, context = "own-upload-artifact-presentation-v1") {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${hmacSecret(payload, context)}`;
}

describe("own upload artifact presentation", () => {
  it("binds the exact account, session, subject, artifact and revisions for ten minutes", () => {
    const { token, claims, nonceHash } = mintOwnConsentPresentation(input, NOW);
    expect(readOwnConsentPresentation(token, NOW)).toEqual(claims);
    expect(claims).toMatchObject(input);
    expect(nonceHash).toBe(crypto.createHash("sha256").update(claims.nonce).digest("hex"));
    expect(readOwnConsentPresentation(token, NOW + 599_999)).toEqual(claims);
    expect(readOwnConsentPresentation(token, NOW + 600_000)).toBeNull();
    expect(readOwnConsentPresentation(token, NOW - 1)).toBeNull();
  });
  it("rejects tampering, foreign token contexts and malformed signatures without throwing", () => {
    const { token, claims } = mintOwnConsentPresentation(input, NOW);
    const [payload, signature] = token.split(".");
    const other = Buffer.from(JSON.stringify({ ...claims, subjectId: input.accountId })).toString("base64url");
    for (const invalid of [`${other}.${signature}`, `${payload}.é`, `${payload}.${"0".repeat(64)}`,
      token + ".extra", "", "x".repeat(4097), seal(claims, "artifact-presentation-v1")]) {
      expect(readOwnConsentPresentation(invalid, NOW)).toBeNull();
    }
  });
  it.each([
    ["sessionId", "not-a-session"], ["accountId", input.accountId.toUpperCase()],
    ["artifactKey", "consent.upload-other-adult"], ["artifactVersion", 0],
    ["accountRevision", -1], ["authSessionRevision", 1.5], ["jurisdictionRevision", Number.MAX_SAFE_INTEGER + 1],
    ["subjectBindingRevision", null], ["accountBindingRevision", 0], ["artifactBodySha256", "short"], ["nonce", "short"],
    ["issuedAt", NOW + 1], ["expiresAt", NOW + 600_001], ["unexpected", true],
  ])("rejects even correctly signed malformed %s", (key, value) => {
    const { claims } = mintOwnConsentPresentation(input, NOW);
    expect(readOwnConsentPresentation(seal({ ...claims, [key]: value }), NOW)).toBeNull();
  });
  it("accepts only the closed one-checkbox Tier-1 request, without identity overrides", () => {
    const body = { action: "sign-artifact", signatureClass: "tier1-self", subjectId: input.subjectId,
      artifactVersion: 1, artifactPresentationToken: "x".repeat(100), affirmed: true, statementKeys: ["own-adult-dna"] };
    expect(ownConsentBody.safeParse(body).success).toBe(true);
    for (const patch of [{ typedName: "Test User" }, { artifactKey: "consent.upload-self" },
      { signerId: input.accountId }, { affirmed: false }, { statementKeys: [] },
      { statementKeys: ["own-adult-dna", "sharing"] }]) {
      expect(ownConsentBody.safeParse({ ...body, ...patch }).success).toBe(false);
    }
  });
  it("binds the legal file body, its hash and the migration seed without a second copy", () => {
    const source = fs.readFileSync("content/legal/consent.upload-self/v1.md", "utf8");
    const body = source.split("</section>")[1].trim();
    const hash = crypto.createHash("sha256").update(body).digest("hex");
    expect(source).toContain(`body_sha256: ${hash}`);
    expect(body).toContain("I am 18 or older and this is my own DNA.");
    const migration = fs.readFileSync("supabase/migrations/20260906102710_own_upload_consent.sql", "utf8");
    expect(migration).toContain(`$artifact$${body}$artifact$`);
    expect(migration).toContain(hash);
    expect(body).not.toMatch(/criminal|typed name|typed date/i);
  });
});
