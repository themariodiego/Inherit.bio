import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mintOwnCopilotConsent, readOwnCopilotConsent } from "./own-consent";
const id = "77900000-0000-4000-8000-000000000001";
const input = { snapshot: { accountId: id, sessionId: id, subjectId: id,
  context: { accountRevision: 1, authSessionRevision: 1, jurisdictionRevision: 1, subjectBindingRevision: 1,
    accountBindingRevision: 1, uploadConsentId: id, subjectLifecycleRevision: 1, originatingSessionRevision: 1, principalId: id, principalRevision: 1 },
  settingsRevision: 1, recipientRevision: 1, providerClass: "cloud" as const, runtimeAttestationRevision: 1 as const, runtimeAttestationFingerprint: "a".repeat(64) },
  artifacts: [{ key: "consent.own-copilot-cloud", version: 1, body: "Synthetic permission", sha256: "b".repeat(64) }] };
beforeEach(() => vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 31).toString("base64")));
afterEach(() => vi.unstubAllEnvs());
it("binds exact actor session recipient revision and reviewed artifacts", () => {
  const token = mintOwnCopilotConsent(input, 1000);
  expect(readOwnCopilotConsent(token, 1001)).toMatchObject(input);
});
it("refuses tampered, future and expired presentations", () => {
  const token = mintOwnCopilotConsent(input, 1000);
  expect(readOwnCopilotConsent(`x${token}`, 1001)).toBeNull();
  expect(readOwnCopilotConsent(token, 999)).toBeNull(); expect(readOwnCopilotConsent(token, 541000)).toBeNull();
  expect(readOwnCopilotConsent(`${token}.extra`, 1001)).toBeNull();
});
it("mints independent nonces without modifying the consent snapshot", () => {
  const a = readOwnCopilotConsent(mintOwnCopilotConsent(input, 1000), 1001)!;
  const b = readOwnCopilotConsent(mintOwnCopilotConsent(input, 1000), 1001)!;
  expect(a.nonce).not.toBe(b.nonce); expect(a.snapshot).toEqual(b.snapshot);
});
