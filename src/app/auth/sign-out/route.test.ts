import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sign-out handler once its one-time token is admitted: what it asks the
 * auth client and what it answers. The token itself, and the exact Origin, are
 * tested on this route in src/lib/security/session-csrf-routes.test.ts.
 */

const signOut = vi.hoisted(() => vi.fn<(options?: { scope?: string }) => Promise<{ error: null }>>(async () => ({ error: null })));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { signOut } }) }));
vi.mock("@/lib/security/session-csrf", async (importOriginal) =>
  (await import("@/lib/security/session-csrf.test-support")).admitEverySessionCsrf(await importOriginal()));

const { POST } = await import("./route");
const SESSION = "5d000000-0000-4000-8000-000000000001";

beforeEach(() => signOut.mockClear());

describe("POST /auth/sign-out", () => {
  it("ends the current auth session only, as policy.scope current-session-only says", async () => {
    const response = await POST(new Request("https://inherit.test/auth/sign-out", { method: "POST" }));
    expect(response.status).toBe(303);
    // The installed auth client's default is { scope: "global" }: every session of the account.
    expect(signOut.mock.calls).toEqual([[{ scope: "local" }]]);
  });

  it("deletes the request's session cookies in the same answer", async () => {
    const response = await POST(new Request("https://inherit.test/auth/sign-out", { method: "POST",
      headers: { cookie: `sb-abcdefghijklmnop-auth-token=x; inherit-ingest-${SESSION}=${"S".repeat(43)}; inherit-rights=${"R".repeat(43)}` } }));
    const deleted = response.headers.getSetCookie().map((line) => line.slice(0, line.indexOf("=")));
    expect(deleted).toEqual(expect.arrayContaining(["inherit_family_gate", "inherit_embryo_gate", "sb-abcdefghijklmnop-auth-token",
      `inherit-ingest-${SESSION}`, "inherit-claim", "inherit-evidence", "inherit-download", "inherit-rights-candidate"]));
    expect(deleted, "the rights session is the owner's decision").not.toContain("inherit-rights");
    expect(response.headers.get("location")).toBe("https://inherit.test/auth/sign-in");
  });
});
