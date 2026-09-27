import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: null as { deletion_requested_at: string | null; jurisdiction_code: string | null } | null,
  selected: [] as string[],
  sessionReads: 0,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => {
        mocks.sessionReads += 1;
        return { data: { user: mocks.user } };
      },
    },
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
  mocks.sessionReads = 0;
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

describe("places under a comprehensive US embargo", () => {
  const from = (path: string, country: string, region?: string) =>
    proxy(new NextRequest(`https://inherit.bio${path}`, {
      headers: {
        "x-vercel-ip-country": country,
        ...(region === undefined ? {} : { "x-vercel-ip-country-region": region }),
      },
    }));

  it.each([["IR", undefined], ["CU", undefined], ["KP", undefined], ["UA", "43"], ["UA", "40"], ["UA", "14"], ["UA", "09"]])(
    "refuses a page to a connection located in %s %s before reading any session",
    async (country, region) => {
      const response = await from("/", country, region);
      expect(response.status).toBe(451);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await response.text()).toContain("Inherit is not available here");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(mocks.sessionReads).toBe(0);
    },
  );

  it("refuses an endpoint with a machine-readable 451, rights included", async () => {
    const response = await from("/api/export", "IR");
    expect(response.status).toBe(451);
    expect(await response.json()).toEqual({ error: "not_available_in_location" });
  });

  it.each([["UA", "30"], ["UA", undefined], ["RU", "43"], ["GB", "ENG"]])("serves a connection located in %s %s", async (country, region) => {
    mocks.profile = { deletion_requested_at: null, jurisdiction_code: "GB" };
    const response = await from("/overview", country, region);
    expect(response.status).toBe(200);
    expect(mocks.sessionReads).toBe(1);
  });

  describe("an account that declared an embargoed country", () => {
    beforeEach(() => {
      mocks.profile = { deletion_requested_at: null, jurisdiction_code: "CU" };
    });

    it.each(["/overview", "/genome/me", "/family/", "/copilot/me"])("is sent from %s to Settings, which says why", async (path) => {
      const response = await visit(path);
      expect(location(response)).toBe("/settings");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    });

    it.each(["/settings", "/settings/data", "/settings/consents"])("keeps %s", async (path) => {
      expect((await visit(path)).headers.get("location")).toBeNull();
    });

    it.each(["/api/export", "/api/account/delete", "/api/account/delete/cancel", "/api/consents/abc/revoke", "/api/settings/jurisdiction"])(
      "keeps the right %s",
      async (path) => {
        expect((await visit(path)).status).toBe(200);
      },
    );

    it.each(["/api/chat", "/api/uploads", "/api/family/acknowledge", "/api/llm/settings"])("is refused %s", async (path) => {
      const response = await visit(path);
      expect(response.status).toBe(451);
      expect(await response.json()).toEqual({ error: "not_available_in_jurisdiction" });
    });
  });
});
