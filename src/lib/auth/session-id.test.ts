import { describe, expect, it } from "vitest";
import { verifiedAuthSessionId } from "./session-id";

const ACCOUNT = "5e550000-0000-4000-8000-000000000001";
const OTHER = "5e550000-0000-4000-8000-000000000002";
const SESSION = "5e550000-0000-4000-8000-000000000011";

const client = (claims: Record<string, unknown> | undefined | null) => ({
  auth: { getClaims: async () => ({ data: claims === null ? null : { claims } }) },
});

describe("verifiedAuthSessionId (20260930220000)", () => {
  it("returns the session of verified claims whose subject is the account", async () => {
    expect(await verifiedAuthSessionId(client({ sub: ACCOUNT, session_id: SESSION }), ACCOUNT)).toBe(SESSION);
  });

  it.each([
    ["no claims result", null],
    ["no claims", undefined],
    ["another account's claims", { sub: OTHER, session_id: SESSION }],
    ["claims without a session", { sub: ACCOUNT }],
    ["a session that is not a string", { sub: ACCOUNT, session_id: 7 }],
  ])("returns null for %s", async (_label, claims) => {
    expect(await verifiedAuthSessionId(client(claims as Record<string, unknown> | undefined | null), ACCOUNT)).toBeNull();
  });
});
