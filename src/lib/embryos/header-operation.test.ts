import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const { mintEmbryoOperation } = await import("./operation-token");
const { csrfOperation, headerOperation } = await import("./guards");

afterAll(() => {
  vi.unstubAllEnvs();
});

const EXPECTED = {
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  operation: "invitation_create" as const,
  targetKind: "cohort_draft" as const,
  targetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

const request = (headers: Record<string, string>) =>
  new Request("https://inherit.bio/api/invitations", { method: "POST", headers });

/**
 * G8.5 (the owner's principles of 19 November 2026): on api.invitations,
 * api.embryo-cohort-drafts and the two embryo bodies of api.consents, the
 * X-Inherit-CSRF header is the account session's one-time token, verified and
 * spent by the route's gate, and the one-time embryo operation token travels
 * in X-Inherit-Operation-Nonce. Each check needs its own value in its own
 * header; neither stands in for the other.
 */
describe("the embryo operation token in its own header", () => {
  it("reads the operation token from X-Inherit-Operation-Nonce and never from X-Inherit-CSRF", () => {
    const token = mintEmbryoOperation(EXPECTED);
    expect(headerOperation(request({ "x-inherit-operation-nonce": token }), EXPECTED)).toMatchObject(EXPECTED);
    expect(headerOperation(request({ "x-inherit-csrf": token }), EXPECTED)).toBeNull();
    expect(headerOperation(request({ "x-inherit-csrf": token, "x-inherit-operation-nonce": "" }), EXPECTED)).toBeNull();
  });

  it("keeps every binding of the token: another operation, target, account or session is refused", () => {
    const token = mintEmbryoOperation(EXPECTED);
    for (const changed of [{ operation: "cohort_draft_create" as const }, { targetId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
      { accountId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }, { sessionId: "ffffffff-ffff-4fff-8fff-ffffffffffff" }]) {
      expect(headerOperation(request({ "x-inherit-operation-nonce": token }), { ...EXPECTED, ...changed }), JSON.stringify(changed)).toBeNull();
    }
  });

  it("leaves csrfOperation, which api.embryo-ingest-complete still reads from X-Inherit-CSRF, unchanged", () => {
    const token = mintEmbryoOperation(EXPECTED);
    expect(csrfOperation(request({ "x-inherit-csrf": token }), EXPECTED)).toMatchObject(EXPECTED);
    expect(csrfOperation(request({ "x-inherit-operation-nonce": token }), EXPECTED)).toBeNull();
  });
});
