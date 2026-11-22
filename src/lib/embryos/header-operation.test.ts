import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const { mintEmbryoOperation } = await import("./operation-token");
const guards = await import("./guards");
const { headerOperation } = guards;

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

  // 2026-11-19 (G8.5, the migration stage): api.embryo-ingest-complete reads
  // its ingest_complete_csrf operation token with headerOperation too, and
  // csrfOperation, which read it from X-Inherit-CSRF, is gone. This case
  // asserted that csrfOperation still read the token from X-Inherit-CSRF.
  it("reads no embryo operation token from X-Inherit-CSRF anywhere: csrfOperation is gone", () => {
    expect(Object.keys(guards)).not.toContain("csrfOperation");
    const complete = readFileSync("src/app/api/embryo-ingest/[session]/complete/route.ts", "utf8");
    expect(complete).toContain('headerOperation(request, { ...bound, operation: "ingest_complete_csrf" })');
    const ingest = { ...EXPECTED, operation: "ingest_complete_csrf" as const, targetKind: "ingest_session" as const };
    const token = mintEmbryoOperation(ingest);
    expect(headerOperation(request({ "x-inherit-operation-nonce": token }), ingest)).toMatchObject(ingest);
    expect(headerOperation(request({ "x-inherit-csrf": token }), ingest)).toBeNull();
  });
});
