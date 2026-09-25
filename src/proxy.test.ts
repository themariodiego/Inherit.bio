import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: null as { deletion_requested_at: string | null; jurisdiction_code: string | null } | null,
  selected: [] as string[],
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: () => ({
      select: (columns: string) => {
        mocks.selected.push(columns);
        return { eq: () => ({ maybeSingle: async () => ({ data: mocks.profile }) }) };
      },
    }),
  }),
}));

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");

const { proxy } = await import("./proxy");

const visit = (path: string) => proxy(new NextRequest(`https://inherit.bio${path}`));
const location = (response: Response) => {
  const value = response.headers.get("location");
  return value ? `${new URL(value).pathname}${new URL(value).search}` : null;
};

beforeEach(() => {
  mocks.user = { id: "12345678-1234-4234-8234-000000000001" };
  mocks.profile = { deletion_requested_at: null, jurisdiction_code: null };
  mocks.selected = [];
});

describe("the first-sign-in jurisdiction gate (G5.1a)", () => {
  it.each(["/overview", "/genome/me", "/family/", "/embryos", "/copilot", "/files", "/uploads", "/browse", "/ancestry"])(
    "sends an undeclared account from %s to the declaration, keeping where it was going",
    async (path) => {
      const response = await visit(path);
      expect(response.status).toBe(307);
      expect(location(response)).toBe(`/settings?next=${encodeURIComponent(path)}`);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    },
  );

  it("keeps the query string of the page asked for", async () => {
    expect(location(await visit("/genome/me/reports?layer=estimate"))).toBe(
      `/settings?next=${encodeURIComponent("/genome/me/reports?layer=estimate")}`,
    );
  });

  it.each(["/settings", "/settings/data", "/settings/consents"])("leaves %s open: the declaration and every right live there", async (path) => {
    const response = await visit(path);
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not redirect an endpoint; the server resolves an undeclared account as unreviewed", async () => {
    const response = await visit("/api/export");
    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("lets a declared account through", async () => {
    mocks.profile = { deletion_requested_at: null, jurisdiction_code: "GB" };
    expect((await visit("/overview")).headers.get("location")).toBeNull();
  });

  it("puts the deletion notice first", async () => {
    mocks.profile = { deletion_requested_at: "2026-09-25T00:00:00Z", jurisdiction_code: null };
    expect(location(await visit("/overview"))).toBe("/settings/data");
  });

  it("sends a signed-out visitor to sign in, not to the declaration", async () => {
    mocks.user = null;
    expect(location(await visit("/overview"))).toBe(`/auth/sign-in?next=${encodeURIComponent("/overview")}`);
  });

  it("reads the declaration in the same profile query as the deletion notice", async () => {
    await visit("/overview");
    expect(mocks.selected).toEqual(["deletion_requested_at, jurisdiction_code"]);
  });
});
