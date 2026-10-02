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

const { proxy, SENSITIVE_RESPONSE_HEADERS } = await import("./proxy");

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

describe("Future Person documentary review response privacy", () => {
  const review = "/api/reviews/future-person/claims/12345678-1234-4234-8234-000000000002";
  const strict = (response: Response) => {
    for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) {
      expect(response.headers.get(name)).toBe(name === "Referrer-Policy" ? "no-referrer" : value);
    }
  };

  it.each([review, `${review}/verify-documents`, `${review}/release`,
    "/reviews/future-person/claims/12345678-1234-4234-8234-000000000002"])(
    "keeps no-referrer on the review page and native API response for %s", async path => {
      const response = await visit(path);
      expect(response.status).toBe(200); strict(response);
      mocks.user = null;
      const signedOut = await visit(path);
      expect(signedOut.status).toBe(200); strict(signedOut);
    },
  );

  it("keeps all strict headers on a proxy-produced deletion-notice refusal", async () => {
    mocks.profile = { deletion_requested_at: "2026-09-25T00:00:00Z", jurisdiction_code: "GB" };
    const response = await visit(`${review}/verify-documents`);
    expect(response.status).toBe(423);
    expect(await response.json()).toEqual({ error: "account_deletion_notice_period" }); strict(response);
  });

  it("keeps all strict headers on both declared and connection location refusals", async () => {
    mocks.profile = { deletion_requested_at: null, jurisdiction_code: "IR" };
    const declared = await visit(`${review}/verify-documents`);
    expect(declared.status).toBe(451);
    expect(await declared.json()).toEqual({ error: "not_available_in_jurisdiction" }); strict(declared);
    mocks.sessionReads = 0;
    for (const path of [review, "/reviews/future-person/claims/12345678-1234-4234-8234-000000000002"]) {
      const located = await proxy(new NextRequest(`https://inherit.bio${path}`, { headers: { "x-vercel-ip-country": "IR" } }));
      expect(located.status).toBe(451); strict(located);
    }
    expect(mocks.sessionReads).toBe(0);
  });

  it.each(["/api/export", "/api/reviews/appeals/12345678-1234-4234-8234-000000000002",
    "/api/reviews/future-person/claims-extra/12345678-1234-4234-8234-000000000002"])(
    "preserves the complete original sensitive header set outside the exact namespaces: %s", async path => {
      const response = await visit(path);
      expect(response.status).toBe(200);
      for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) expect(response.headers.get(name)).toBe(value);
    },
  );
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

describe("the public Future Person claim (rights.future-person-claim)", () => {
  const claimVisit = (method: string, path: string, headers: Record<string, string> = {}) =>
    proxy(new NextRequest(`https://inherit.bio${path}`, { method, headers }));
  const forwardedToken = (response: Response) => response.headers.get("x-middleware-request-x-inherit-claim-form-token");
  const openClaims = () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
    vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  };
  const closeClaims = () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
  };

  it("gives the page a fresh form pair while claims are open, and reads no account", async () => {
    openClaims();
    try {
      const first = await claimVisit("GET", "/future-person/claim");
      const second = await claimVisit("GET", "/future-person/claim");
      expect(mocks.sessionReads).toBe(0);
      expect(mocks.selected).toEqual([]);
      expect(first.headers.get("set-cookie")).toMatch(
        /^inherit-claim-form=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=600; HttpOnly; SameSite=Strict$/,
      );
      expect(forwardedToken(first)).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
      expect(forwardedToken(first)).not.toBe(forwardedToken(second));
      expect(first.headers.get("set-cookie")).not.toBe(second.headers.get("set-cookie"));
      expect(first.headers.get("cache-control")).toBe("private, no-store");
      expect(first.headers.get("referrer-policy")).toBe("no-referrer");
    } finally {
      closeClaims();
    }
  });

  it("keeps the browser's form cookie when Next.js prefetches the page it is showing", async () => {
    openClaims();
    try {
      const first = await claimVisit("GET", "/future-person/claim");
      const cookie = first.headers.get("set-cookie")!.split(";")[0]!;
      const prefetch = await claimVisit("GET", "/future-person/claim", {
        cookie,
        rsc: "1",
        "next-router-prefetch": "1",
      });
      expect(prefetch.headers.get("set-cookie")!.split(";")[0]).toBe(cookie);
      expect(forwardedToken(prefetch)).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
      expect(forwardedToken(prefetch)).not.toBe(forwardedToken(first));
      expect(mocks.sessionReads).toBe(0);
    } finally {
      closeClaims();
    }
  });

  it("sets no cookie and forwards no token where claims are not open", async () => {
    closeClaims();
    const response = await claimVisit("GET", "/future-person/claim");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(forwardedToken(response)).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.sessionReads).toBe(0);
  });

  it("never forwards a token a client supplied itself", async () => {
    closeClaims();
    const closed = await claimVisit("GET", "/future-person/claim", { "x-inherit-claim-form-token": "forged.token" });
    expect(forwardedToken(closed)).toBeNull();
    openClaims();
    try {
      const open = await claimVisit("GET", "/future-person/claim", { "x-inherit-claim-form-token": "forged.token" });
      expect(forwardedToken(open)).not.toBe("forged.token");
      const head = await claimVisit("HEAD", "/future-person/claim", { "x-inherit-claim-form-token": "forged.token" });
      expect(forwardedToken(head)).toBeNull();
      expect(head.headers.get("set-cookie")).toBeNull();
    } finally {
      closeClaims();
    }
  });

  it.each([
    "/api/future-person/claim/session/documents",
    "/api/evidence/44444444-4444-4444-8444-444444444444/chunks/0",
    "/api/evidence/44444444-4444-4444-8444-444444444444/complete",
  ])("lets the documents step %s through without reading an account", async (path) => {
    const response = await claimVisit(path.includes("/chunks/") ? "PUT" : "POST", path);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.sessionReads).toBe(0);
    expect(mocks.selected).toEqual([]);
  });

  it("lets the claim start through without reading an account", async () => {
    openClaims();
    try {
      const response = await claimVisit("POST", "/api/future-person/claim", { "content-type": "application/json" });
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(mocks.sessionReads).toBe(0);
      expect(mocks.selected).toEqual([]);
    } finally {
      closeClaims();
    }
  });
});

describe("legal-evidence review-download response privacy", () => {
  const download = "/api/legal-evidence/12345678-1234-4234-8234-000000000003/review-download";
  const strict = (response: Response) => {
    for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) {
      expect(response.headers.get(name)).toBe(name === "Referrer-Policy" ? "no-referrer" : value);
    }
  };

  it.each([download, "/api/legal-evidence/not-a-canonical-id/review-download"])(
    "keeps all strict headers before the handler's signed-in or signed-out response: %s", async path => {
      const signedIn = await visit(path);
      expect(signedIn.status).toBe(200); strict(signedIn);
      expect(signedIn.headers.get("x-middleware-next")).toBe("1");
      mocks.user = null;
      const signedOut = await visit(path);
      expect(signedOut.status).toBe(200); strict(signedOut);
      expect(signedOut.headers.get("x-middleware-next")).toBe("1");
    },
  );

  it("keeps all strict headers when the proxy itself refuses for account deletion", async () => {
    mocks.profile = { deletion_requested_at: "2026-09-25T00:00:00Z", jurisdiction_code: "GB" };
    const response = await visit(download);
    expect(response.status).toBe(423);
    expect(await response.json()).toEqual({ error: "account_deletion_notice_period" }); strict(response);
  });

  it("keeps all strict headers on declared and connection location refusals", async () => {
    mocks.profile = { deletion_requested_at: null, jurisdiction_code: "IR" };
    const declared = await visit(download);
    expect(declared.status).toBe(451);
    expect(await declared.json()).toEqual({ error: "not_available_in_jurisdiction" }); strict(declared);
    mocks.sessionReads = 0;
    const located = await proxy(new NextRequest(`https://inherit.bio${download}`, {
      headers: { "x-vercel-ip-country": "IR" },
    }));
    expect(located.status).toBe(451);
    expect(await located.json()).toEqual({ error: "not_available_in_location" }); strict(located);
    expect(mocks.sessionReads).toBe(0);
  });

  it.each([
    "/api/legal-evidence-extra/12345678-1234-4234-8234-000000000003/review-download",
    "/api/legal-evidence/12345678-1234-4234-8234-000000000003/download",
    `${download}-extra`,
    `${download}/chunks/0`,
    "/api/legal-evidence//review-download",
    "/api/legal-evidence/parent/child/review-download",
  ])("preserves the complete original sensitive policy outside the exact route shape: %s", async path => {
    const response = await visit(path);
    expect(response.status).toBe(200);
    for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
  });
});
