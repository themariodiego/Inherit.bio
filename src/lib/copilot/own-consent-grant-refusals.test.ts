import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The own-Copilot grant body of api.consents refuses another origin, fetch
 * metadata other than same-origin, or a CSRF header other than the page's
 * presentation, with `authenticated-mutation-v1`'s 403 `request_forbidden`,
 * and a missing account with `authenticated-api-v1`'s 401 `unauthenticated`,
 * before any database call (G8.5, 19 November 2026; the revoke branch moved
 * the same way on 19 November). Only the account context and the database are
 * doubles; the presentation's MAC is real. Every value is synthetic.
 */
const mocks = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor,
  ownUploadJson: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock("./own-provider-authority", async (importOriginal) => ({
  ...await importOriginal<typeof import("./own-provider-authority")>(), ownCopilotRpc: mocks.rpc }));
const { mintOwnCopilotConsent, ownCopilotConsent } = await import("./own-consent");

const ID = "7c6f0000-0000-4000-8000-000000000001";
const snapshot = { accountId: ID, sessionId: ID, subjectId: ID,
  context: { accountRevision: 1, authSessionRevision: 1, jurisdictionRevision: 1, subjectBindingRevision: 1,
    accountBindingRevision: 1, uploadConsentId: ID, subjectLifecycleRevision: 1, originatingSessionRevision: 1, principalId: ID, principalRevision: 1 },
  settingsRevision: 1, recipientRevision: 1, providerClass: "cloud" as const, runtimeAttestationRevision: 1 as const,
  runtimeAttestationFingerprint: "a".repeat(64) };
const artifacts = [{ key: "consent.own-copilot-cloud", version: 1, body: "Synthetic permission", sha256: "b".repeat(64) }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 37).toString("base64"));
  mocks.actor.mockResolvedValue({ accountId: ID, sessionId: ID });
});
afterEach(() => vi.unstubAllEnvs());

function grant(headers: Record<string, string>, token: string) {
  const payload = { action: "grant-purpose", subjectId: ID, purposeKey: "copilot.cloud", artifactVersion: 1,
    artifactPresentationToken: token, affirmed: true, statementKeys: ["model-named", "data-classes-named", "raw-file-excluded", "revocable"] };
  return ownCopilotConsent(new Request("http://localhost/api/consents", { method: "POST", headers }), payload);
}

describe("the own-Copilot grant's refusals are the register's", () => {
  it("answers another origin, other fetch metadata or another CSRF value with 403 request_forbidden, reading nothing", async () => {
    const token = mintOwnCopilotConsent({ snapshot, artifacts });
    for (const headers of [
      { origin: "https://elsewhere.example", "sec-fetch-site": "cross-site", "x-inherit-csrf": token },
      { origin: "http://localhost", "sec-fetch-site": "same-site", "x-inherit-csrf": token },
      { origin: "http://localhost", "sec-fetch-site": "same-origin", "x-inherit-csrf": `${token}x` },
    ]) {
      const response = await grant(headers, token);
      expect([response.status, await response.json()]).toEqual([403, { error: "request_forbidden" }]);
    }
    expect(mocks.actor).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers a request with no account with 401 unauthenticated, before any database call", async () => {
    mocks.actor.mockResolvedValue(null);
    const token = mintOwnCopilotConsent({ snapshot, artifacts });
    const response = await grant({ origin: "http://localhost", "sec-fetch-site": "same-origin", "x-inherit-csrf": token }, token);
    expect([response.status, await response.json()]).toEqual([401, { error: "unauthenticated" }]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
