import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { isValidElement } from "react";
import { AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_UNAVAILABLE_HEADER, AUTH_UNAVAILABLE_PATH } from "@/lib/supabase/auth-check";

type CookieWrite = { name: string; value: string; options: Record<string, unknown> };
const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: null as { deletion_requested_at: string | null; jurisdiction_code: string | null } | null,
  selected: [] as string[],
  sessionReads: 0,
  // Queued answers of getUser (each may first write cookies through setAll);
  // once empty, getUser answers `user` as before.
  answers: [] as { error?: unknown; writes?: CookieWrite[] }[],
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (cookies: CookieWrite[]) => void } }) => ({
    auth: {
      getUser: async () => {
        mocks.sessionReads += 1;
        const next = mocks.answers.shift();
        if (!next) return { data: { user: mocks.user } };
        if (next.writes) options.cookies.setAll(next.writes);
        return next.error ? { data: { user: null }, error: next.error } : { data: { user: mocks.user }, error: null };
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

const { proxy, SENSITIVE_RESPONSE_HEADERS, AUTH_CALLBACK_HEADERS } = await import("./proxy");

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
  mocks.answers = [];
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

/**
 * Owner decision 2026-11-19, "A brief failure of the sign-in service is not
 * treated as signed out" (D-142). A temporary answer is asked once more; if it
 * is temporary again, a protected page is rewritten to the route that throws
 * into the root error boundary (at the URL asked for) and an endpoint gets the
 * shared JSON 503. A real "no session" is answered exactly as before.
 */
describe("a sign-in check that fails for a moment (D-142)", () => {
  const temporary = () => ({ error: new AuthRetryableFetchError("fetch failed", 0) });
  const MARKER = `x-middleware-request-${AUTH_UNAVAILABLE_HEADER}`;
  const sessionCookie = "sb-127-auth-token";
  const strict = (response: Response, referrer = "same-origin") => {
    for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) {
      expect(response.headers.get(name), name).toBe(name === "Referrer-Policy" ? referrer : value);
    }
  };

  // The rewrite carries "the sensitive response headers every other answer of
  // the requested page carries" (pageAuthContract.authServiceUnavailable):
  // no-referrer on the two pages of the whole-route rule (family.portrait,
  // genome.reports), same-origin on the other two.
  it.each([["/overview", "same-origin"], ["/family/portrait/pair", "no-referrer"], ["/genome/me/reports", "no-referrer"], ["/settings", "same-origin"]])(
    "rewrites %s to the error surface after asking twice: no sign-in, no account read (Referrer-Policy %s)", async (path, referrer) => {
      mocks.answers = [temporary(), temporary()];
      const response = await visit(path);
      expect(mocks.sessionReads).toBe(2);
      expect(response.headers.get("location")).toBeNull();
      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-rewrite")).toBe(`https://inherit.bio${AUTH_UNAVAILABLE_PATH}`);
      expect(response.headers.get(MARKER), "only the proxy's own rewrite carries the marker").toBe("1");
      expect(mocks.selected, "no profile is read for an unconfirmed session").toEqual([]);
      strict(response, referrer);
    },
  );

  it("answers an endpoint with the shared JSON 503, revealing nothing, with the route's own referrer policy", async () => {
    mocks.answers = [temporary(), temporary()];
    const response = await visit("/api/search");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(mocks.selected).toEqual([]);
    strict(response);
    mocks.answers = [temporary(), temporary()];
    const bound = await visit("/api/export");
    expect(bound.status).toBe(503);
    strict(bound, "no-referrer");
  });

  it("lets the request through as signed in when the second answer confirms the user", async () => {
    mocks.profile = { deletion_requested_at: null, jurisdiction_code: "GB" };
    mocks.answers = [temporary(), {}];
    const response = await visit("/overview");
    expect(mocks.sessionReads).toBe(2);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(mocks.selected).toEqual(["deletion_requested_at, jurisdiction_code"]);
  });

  it("still applies the account's own checks after a recovered answer", async () => {
    mocks.answers = [temporary(), {}];
    expect(location(await visit("/overview"))).toBe(`/settings?next=${encodeURIComponent("/overview")}`);
  });

  it("sends a person with no session to sign-in exactly as before, asking once", async () => {
    mocks.user = null;
    mocks.answers = [{ error: new AuthSessionMissingError() }];
    const response = await visit("/family/portrait/pair");
    expect(mocks.sessionReads).toBe(1);
    expect(response.status).toBe(307);
    expect(location(response)).toBe(`/auth/sign-in?next=${encodeURIComponent("/family/portrait/pair")}`);
    // authenticated-page-signin-redirect-v1: private-no-store-no-referrer.
    strict(response, "no-referrer");
  });

  it("takes a no-session second answer as no session: sign-in, as before", async () => {
    mocks.user = null;
    mocks.answers = [temporary(), { error: new AuthSessionMissingError() }];
    expect(location(await visit("/overview"))).toBe(`/auth/sign-in?next=${encodeURIComponent("/overview")}`);
    expect(mocks.sessionReads).toBe(2);
  });

  it("forwards no cookie removal on a temporary answer, but keeps refreshed tokens", async () => {
    const removal = { name: sessionCookie, value: "", options: { path: "/", maxAge: 0, sameSite: "lax", httpOnly: false } };
    const refreshed = { name: sessionCookie, value: "base64-rotated", options: { path: "/", maxAge: 34560000, sameSite: "lax", httpOnly: false } };
    for (const path of ["/overview", "/api/search"]) {
      mocks.answers = [{ ...temporary(), writes: [removal] }, temporary()];
      const cleared = await visit(path);
      expect(cleared.headers.getSetCookie(), path).toEqual([]);
      mocks.answers = [{ ...temporary(), writes: [refreshed] }, temporary()];
      const rotated = await visit(path);
      expect(rotated.headers.getSetCookie(), path).toEqual([expect.stringMatching(/^sb-127-auth-token=base64-rotated;/)]);
      expect(rotated.headers.getSetCookie().join(), path).not.toMatch(/Max-Age=0/i);
    }
  });

  it("leaves a public page as it was: nothing there depends on the answer", async () => {
    mocks.answers = [temporary(), temporary()];
    const response = await visit("/about");
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("stops waiting when the browser has gone, without asking again", async () => {
    const controller = new AbortController();
    controller.abort();
    mocks.answers = [temporary(), {}];
    const response = await proxy(new NextRequest("https://inherit.bio/overview", { signal: controller.signal }));
    expect(mocks.sessionReads).toBe(1);
    expect(response.headers.get("x-middleware-rewrite")).toBe(`https://inherit.bio${AUTH_UNAVAILABLE_PATH}`);
  });

  it("strips the marker from a request that names the error route itself, and reads no session", async () => {
    const response = await proxy(new NextRequest(`https://inherit.bio${AUTH_UNAVAILABLE_PATH}`, {
      headers: { [AUTH_UNAVAILABLE_HEADER]: "1" },
    }));
    expect(mocks.sessionReads).toBe(0);
    expect(response.headers.get(MARKER)).toBeNull();
    expect(response.headers.get("x-middleware-override-headers") ?? "").not.toContain(AUTH_UNAVAILABLE_HEADER);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    strict(response);
  });
});

describe("documentary review response privacy", () => {
  const review = "/api/reviews/future-person/claims/12345678-1234-4234-8234-000000000002";
  const appealReview = "/api/reviews/appeals/12345678-1234-4234-8234-000000000002";
  const strict = (response: Response) => {
    for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) {
      expect(response.headers.get(name)).toBe(name === "Referrer-Policy" ? "no-referrer" : value);
    }
  };

  it.each([review, `${review}/verify-documents`, `${review}/release`,
    "/reviews/future-person/claims/12345678-1234-4234-8234-000000000002", appealReview,
    "/reviews/appeals/12345678-1234-4234-8234-000000000002"])(
    "keeps no-referrer on the review page and native API response for %s", async path => {
      const response = await visit(path);
      expect(response.status).toBe(200); strict(response);
      mocks.user = null;
      const signedOut = await visit(path);
      expect(signedOut.status).toBe(200); strict(signedOut);
    },
  );

  it.each([`${review}/verify-documents`, appealReview])("keeps all strict headers on a proxy-produced deletion-notice refusal for %s", async path => {
    mocks.profile = { deletion_requested_at: "2026-09-25T00:00:00Z", jurisdiction_code: "GB" };
    const response = await visit(path);
    expect(response.status).toBe(423);
    expect(await response.json()).toEqual({ error: "account_deletion_notice_period" }); strict(response);
  });

  it.each([`${review}/verify-documents`, appealReview])("keeps all strict headers on a declared location refusal for %s", async path => {
    mocks.profile = { deletion_requested_at: null, jurisdiction_code: "IR" };
    const declared = await visit(path);
    expect(declared.status).toBe(451);
    expect(await declared.json()).toEqual({ error: "not_available_in_jurisdiction" }); strict(declared);
  });

  it("keeps all strict headers on a connection location refusal before reading the session", async () => {
    mocks.sessionReads = 0;
    for (const path of [review, appealReview, "/reviews/future-person/claims/12345678-1234-4234-8234-000000000002",
      "/reviews/appeals/12345678-1234-4234-8234-000000000002"]) {
      const located = await proxy(new NextRequest(`https://inherit.bio${path}`, { headers: { "x-vercel-ip-country": "IR" } }));
      expect(located.status).toBe(451); strict(located);
    }
    expect(mocks.sessionReads).toBe(0);
  });

  it.each(["/api/reviews/appeals-extra/12345678-1234-4234-8234-000000000002",
    "/api/reviews/future-person/claims-extra/12345678-1234-4234-8234-000000000002"])(
    "preserves the complete original sensitive header set outside the exact namespaces: %s", async path => {
      const response = await visit(path);
      expect(response.status).toBe(200);
      for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) expect(response.headers.get(name)).toBe(value);
    },
  );

  // Until D-138 (a) this path was in the list above with same-origin. The
  // register binds api.export to downloadOrExport, whose Referrer-Policy is
  // no-referrer; every other header of the original set stays.
  it("gives /api/export no-referrer with every other header of the original set", async () => {
    const response = await visit("/api/export");
    expect(response.status).toBe(200); strict(response);
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

    it.each(["/api/export", "/api/subjects/12345678-1234-4234-8234-000000000004/export", "/api/account/delete", "/api/account/delete/cancel", "/api/consents/abc/revoke", "/api/settings/jurisdiction"])(
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

  it.each(["POST", "GET"])("lets the rights-session export %s through without reading an account", async (method) => {
    // api.third-party-subject-export: the rights session is its only principal.
    const response = await claimVisit(method, "/api/withdraw/session/export");
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

describe("the public auth forms and endpoints (auth.sign-up-submit, auth.forgot-password-submit, auth.reset-password-submit)", () => {
  const authVisit = (method: string, path: string, headers: Record<string, string> = {}) =>
    proxy(new NextRequest(`https://inherit.bio${path}`, { method, headers }));
  const forwardedToken = (response: Response) => response.headers.get("x-middleware-request-x-inherit-auth-form-token");

  it.each(["/auth/sign-up", "/auth/forgot-password"])("gives %s a fresh form pair and reads no account", async (path) => {
    vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    try {
      const first = await authVisit("GET", path);
      const second = await authVisit("GET", path);
      expect(mocks.sessionReads).toBe(0);
      expect(mocks.selected).toEqual([]);
      expect(first.headers.get("set-cookie")).toMatch(
        /^inherit-auth-form=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=600; HttpOnly; SameSite=Strict$/,
      );
      expect(forwardedToken(first)).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
      expect(forwardedToken(first)).not.toBe(forwardedToken(second));
      expect(first.headers.get("cache-control")).toBe("private, no-store");
      expect(first.headers.get("referrer-policy")).toBe("no-referrer");
      // A browser that holds the cookie keeps it when Next.js refreshes the page.
      const cookie = first.headers.get("set-cookie")!.split(";")[0]!;
      const refresh = await authVisit("GET", path, { cookie, rsc: "1" });
      expect(refresh.headers.get("set-cookie")!.split(";")[0]).toBe(cookie);
      expect(forwardedToken(refresh)).not.toBe(forwardedToken(first));
    } finally {
      vi.unstubAllEnvs();
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    }
  });

  it.each(["next-router-prefetch", "next-router-segment-prefetch"])(
    "sets no auth form cookie for a %s request from a browser that holds none", async (header) => {
      vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
      try {
        const prefetch = await authVisit("GET", "/auth/sign-up", { rsc: "1", [header]: "1" });
        expect(prefetch.headers.get("set-cookie")).toBeNull();
        expect(forwardedToken(prefetch)).toBeNull();
        expect(prefetch.headers.get("cache-control")).toBe("private, no-store");
        expect(mocks.sessionReads).toBe(0);
        const page = await authVisit("GET", "/auth/sign-up");
        const cookie = page.headers.get("set-cookie")!.split(";")[0]!;
        const held = await authVisit("GET", "/auth/sign-up", { cookie, rsc: "1", [header]: "1" });
        expect(held.headers.get("set-cookie")!.split(";")[0]).toBe(cookie);
        expect(forwardedToken(held)).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
      } finally {
        vi.unstubAllEnvs();
        vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
        vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
      }
    });

  it("never forwards a form token a client supplied itself", async () => {
    vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    try {
      const page = await authVisit("GET", "/auth/sign-up", { "x-inherit-auth-form-token": "forged.token" });
      expect(forwardedToken(page)).not.toBe("forged.token");
      const head = await authVisit("HEAD", "/auth/sign-up", { "x-inherit-auth-form-token": "forged.token" });
      expect(forwardedToken(head)).toBeNull();
      expect(head.headers.get("set-cookie")).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    }
  });

  it.each(["/api/auth/sign-up", "/api/auth/forgot-password", "/api/auth/reset-password"])(
    "lets %s through with the authOrRecovery profile, reading and refreshing no account", async (path) => {
      mocks.profile = { deletion_requested_at: "2026-09-25T00:00:00Z", jurisdiction_code: "CU" };
      const response = await authVisit("POST", path, { "content-type": "application/json" });
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("content-security-policy")).toMatch(/frame-ancestors 'none'/);
      expect(response.headers.get("content-security-policy")).toMatch(/script-src 'self' 'nonce-/);
      expect(mocks.sessionReads).toBe(0);
      expect(mocks.selected).toEqual([]);
    },
  );
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

describe("subject download response privacy (sensitiveResponseHeaderBindings.downloadOrExport)", () => {
  const subject = "12345678-1234-4234-8234-000000000004";
  const strict = (response: Response) => {
    for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) {
      expect(response.headers.get(name)).toBe(name === "Referrer-Policy" ? "no-referrer" : value);
    }
  };

  it.each([`/api/subjects/${subject}/download`, `/api/subjects/${subject}/export`, "/api/downloads/12345678-1234-4234-8234-000000000005/chunks/0"])(
    "keeps no-referrer with every other strict header on %s", async path => {
      const response = await visit(path);
      expect(response.status).toBe(200); strict(response);
    },
  );

  it.each([`/api/subjects/${subject}/download/extra`, `/api/subjects/${subject}/export/extra`, `/api/subjects/${subject}/sharing`, "/api/subjects"])(
    "leaves the ordinary sensitive policy outside the exact download shape: %s", async path => {
      const response = await visit(path);
      expect(response.status).toBe(200);
      for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) {
        expect(response.headers.get(name)).toBe(value);
      }
    },
  );

  it("keeps the one-record export open during the deletion notice period, as a right like the account export", async () => {
    mocks.profile = { deletion_requested_at: "2026-10-16T00:00:00Z", jurisdiction_code: "GB" };
    expect((await visit(`/api/subjects/${subject}/export`)).status).toBe(200);
    expect((await visit("/api/export")).status).toBe(200);
  });

  it("holds the subject download and api.subjects during the deletion notice period, like every non-rights route", async () => {
    mocks.profile = { deletion_requested_at: "2026-10-16T00:00:00Z", jurisdiction_code: "GB" };
    const download = await visit(`/api/subjects/${subject}/download`);
    expect(download.status).toBe(423);
    expect(await download.json()).toEqual({ error: "account_deletion_notice_period" });
    const drafts = await visit("/api/subjects");
    expect(drafts.status).toBe(423);
  });
});

/**
 * The route register binds these endpoints, for every response, to a profile
 * whose Referrer-Policy is no-referrer (`sensitiveResponseHeaderBindings`), and
 * their handlers set it. Next's response sender keeps the proxy's header over
 * the handler's, so the proxy must leave no-referrer too. Hosted run
 * 44567656560 caught the claimant DELETE answering with same-origin.
 */
describe("register no-referrer endpoints keep the strict policy (sensitiveResponseHeaderBindings)", () => {
  const strict = (response: Response) => {
    for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) {
      expect(response.headers.get(name), name).toBe(name === "Referrer-Policy" ? "no-referrer" : value);
    }
  };
  const call = (method: string, path: string) => proxy(new NextRequest(`https://inherit.bio${path}`, { method }));
  const ENDPOINTS: readonly (readonly [method: string, path: string])[] = [
    ["POST", "/api/future-person/claim"],
    ["DELETE", "/api/future-person/claim/session"],
    ["POST", "/api/future-person/claim/session/account"],
    ["DELETE", "/api/future-person/claim/session/analysis"],
    ["POST", "/api/future-person/claim/session/export"],
    ["GET", "/api/future-person/claim/session/export"],
    ["POST", "/api/future-person/claim/session/objection"],
    ["POST", "/api/future-person/claim/session/recovery-key"],
    ["POST", "/api/withdraw/session/export"],
    ["GET", "/api/withdraw/session/export"],
    ["POST", "/api/appeals/session/complete"],
    ["POST", "/api/appeals/session/documents"],
    // POST /api/rights/reissue left this list on 19 November 2026 (D-138 (e)):
    // its answers carry the authOrRecovery nonce policy, held below.
  ];

  it.each(ENDPOINTS)("%s %s keeps no-referrer with every other sensitive header, signed in or not", async (method, path) => {
    for (const user of [{ id: "12345678-1234-4234-8234-000000000001" }, null]) {
      mocks.user = user;
      const response = await call(method, path);
      expect(response.status).toBe(200); strict(response);
    }
  });

  it.each([["DELETE", "/api/future-person/claim/session"], ["POST", "/api/appeals/session/complete"]])(
    "keeps no-referrer on a proxy-produced deletion-notice refusal for %s %s", async (method, path) => {
      mocks.profile = { deletion_requested_at: "2026-09-25T00:00:00Z", jurisdiction_code: "GB" };
      const response = await call(method, path);
      expect(response.status).toBe(423);
      expect(await response.json()).toEqual({ error: "account_deletion_notice_period" }); strict(response);
    },
  );

  it.each(["/api/future-person/claim/sessions", "/api/future-person/claim/session/recovery-key/extra", "/api/withdraw/session/export/extra",
    "/api/rights/reissue/extra", "/api/appeals/session"])("leaves the original sensitive policy outside the exact endpoint: %s", async path => {
    const response = await call("POST", path);
    expect(response.status).toBe(200);
    for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) expect(response.headers.get(name), name).toBe(value);
  });

  /**
   * D-138 (a): ten endpoints the register binds, for every response, to a
   * no-referrer profile, whose own handlers answer with the same-origin of
   * `sensitiveJson` and its kin. The proxy's header is the one the browser
   * receives, so naming them in the proxy is the whole fix, as it was for
   * D-137. `FILE` is the id the register-driven check below puts in `[id]`.
   */
  const FILE = "12345678-1234-4234-8234-00000000000a";
  const SAME_ORIGIN_HANDLER_ENDPOINTS: readonly (readonly [method: string, path: string])[] = [
    ["POST", "/api/subjects/bind/session"], // api.adult-subject-bind
    ["POST", "/api/consents/grant/session"], // api.consent-grant-rights
    ["POST", "/api/consents/reaffirm/session"], // api.consent-reaffirm-rights
    ["POST", "/api/consents/revoke/session"], // api.consent-revoke-rights
    ["POST", "/api/rights/embryo-record-key-cards"], // api.embryo-record-key-cards-rights
    ["POST", "/api/export"], // api.export
    ["GET", "/api/export"],
    ["GET", `/api/files/${FILE}/download`], // api.file-download
    ["POST", "/api/invitations/accept"], // api.invitation-accept
    ["POST", "/api/rights/activate"], // api.rights-activate
    ["POST", "/api/withdraw/session"], // api.withdraw
  ];

  it.each(SAME_ORIGIN_HANDLER_ENDPOINTS)("%s %s keeps no-referrer with every other sensitive header, signed in or not (D-138 (a))",
    async (method, path) => {
      for (const user of [{ id: "12345678-1234-4234-8234-000000000001" }, null]) {
        mocks.user = user;
        const response = await call(method, path);
        expect(response.status).toBe(200); strict(response);
      }
    });

  // The seven that read the account on their way: the proxy's own refusals
  // to an account in its deletion notice or with an embargoed declaration.
  // api.export is a right and is never refused; api.rights-activate and
  // api.withdraw read no account.
  const ACCOUNT_READ = SAME_ORIGIN_HANDLER_ENDPOINTS.filter(([, path]) =>
    path !== "/api/export" && path !== "/api/rights/activate" && path !== "/api/withdraw/session");
  it.each(ACCOUNT_READ)("keeps no-referrer on the proxy's deletion-notice and declared-location refusals for %s %s (D-138 (a))",
    async (method, path) => {
      mocks.profile = { deletion_requested_at: "2026-09-25T00:00:00Z", jurisdiction_code: "GB" };
      const held = await call(method, path);
      expect(held.status).toBe(423);
      expect(await held.json()).toEqual({ error: "account_deletion_notice_period" }); strict(held);
      mocks.profile = { deletion_requested_at: null, jurisdiction_code: "IR" };
      const declared = await call(method, path);
      expect(declared.status).toBe(451);
      expect(await declared.json()).toEqual({ error: "not_available_in_jurisdiction" }); strict(declared);
    });

  it("keeps no-referrer on the export a right keeps during the deletion notice (D-138 (a))", async () => {
    mocks.profile = { deletion_requested_at: "2026-09-25T00:00:00Z", jurisdiction_code: "IR" };
    for (const method of ["GET", "POST"]) {
      const response = await call(method, "/api/export");
      expect(response.status).toBe(200); strict(response);
    }
  });

  it.each(SAME_ORIGIN_HANDLER_ENDPOINTS)("keeps no-referrer on a connection location refusal, before any session read, for %s %s (D-138 (a))",
    async (method, path) => {
      mocks.sessionReads = 0;
      const located = await proxy(new NextRequest(`https://inherit.bio${path}`, { method, headers: { "x-vercel-ip-country": "IR" } }));
      expect(located.status).toBe(451);
      expect(await located.json()).toEqual({ error: "not_available_in_location" }); strict(located);
      expect(mocks.sessionReads).toBe(0);
    });

  // `/api/files/[id]/process` and `/api/embryo-cohorts/[id]/record-key-cards`
  // left this list on 19 November 2026: the whole-route rule below gives them
  // no-referrer. Their neighbours `finalize` and `withdraw` stay outside.
  it.each(["/api/export/extra", "/api/exports", `/api/files/${FILE}`, `/api/files/${FILE}/download/extra`, `/api/files/${FILE}/finalize`,
    "/api/files//download", `/api/files/parent/${FILE}/download`, "/api/consents/grant", "/api/consents/revoke", `/api/consents/${FILE}/revoke`,
    "/api/consents/reaffirm", "/api/consents/revoke/session/extra", "/api/invitations", "/api/invitations/accept/extra", "/api/rights/activate/extra",
    "/api/rights/embryo-record-key-cards/extra", `/api/embryo-cohorts/${FILE}/withdraw`, "/api/subjects/bind",
    "/api/subjects/bind/session/extra", "/api/withdraw/sessions", "/api/withdraw/session/extra"])(
    "leaves the original sensitive policy outside the exact D-138 (a) endpoint: %s", async path => {
      for (const method of ["GET", "POST"]) {
        const response = await call(method, path);
        expect(response.status).toBe(200);
        for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) expect(response.headers.get(name), `${method} ${name}`).toBe(value);
      }
    });

  /**
   * Every endpoint the register binds to a no-referrer profile is honoured on
   * every registered method, with no exception. Until D-138 (a) the ten above
   * were listed here as an exception; a new binding the proxy does not honour
   * fails here.
   */
  it("honours every endpoint the register binds to a no-referrer profile, with no exception", async () => {
    type Route = { id: string; kind: string; path: string; methods?: string[]; parameterContract?: Record<string, { const?: string } | string> };
    const register = JSON.parse(readFileSync("docs/route-register.json", "utf8")) as {
      sensitiveResponseHeaders: Record<string, Record<string, string>>;
      sensitiveResponseHeaderBindings: Record<string, unknown>;
      routes: Route[];
    };
    const profiles = Object.entries(register.sensitiveResponseHeaders)
      .filter(([, headers]) => headers["Referrer-Policy"] === "no-referrer").map(([name]) => name);
    const bound = new Set(profiles.flatMap(name => register.sensitiveResponseHeaderBindings[name] as string[]));
    const endpoints = register.routes.filter(route => bound.has(route.id) && route.kind === "endpoint" && route.path.startsWith("/api/"));
    const honoured = new Set<string>(), exercised = new Set<string>();
    for (const route of endpoints) {
      const path = route.path.replace(/\[([^\]]+)\]/g, (_all, name: string) => {
        const contract = route.parameterContract?.[name];
        return typeof contract === "object" && contract.const !== undefined ? contract.const
          : name === "sequence" ? "0" : FILE;
      });
      for (const method of route.methods ?? ["GET"]) {
        const policy = (await call(method, path)).headers.get("referrer-policy");
        expect(policy, `${route.id} ${method} ${path}`).toBe("no-referrer");
        honoured.add(route.id);
        exercised.add(`${method} ${path}`);
      }
    }
    // Every endpoint fixed above is among the register's bindings, so these lists are the register's, not a copy of it.
    for (const [, path] of ENDPOINTS) expect(endpoints.some(route => path === route.path.replace("[token]", "session")), path).toBe(true);
    for (const [method, path] of SAME_ORIGIN_HANDLER_ENDPOINTS) expect(exercised.has(`${method} ${path}`), `${method} ${path}`).toBe(true);
    expect(honoured.size).toBe(endpoints.length);
  });
});

/**
 * D-138 (b) and (c), owner decision of 19 November 2026 ("the strictest
 * referrer setting applies to the whole route"): where the register names
 * no-referrer for any answer of an endpoint, through a profile binding or
 * through a response contract bound to the route, every answer of that
 * endpoint gets it, the proxy's own refusals included. The proxy's header is
 * the one the browser receives (Next keeps it over the handler's).
 */
describe("the strictest referrer setting applies to the whole route (D-138 (b) and (c))", () => {
  const strict = (response: Response) => {
    for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) {
      expect(response.headers.get(name), name).toBe(name === "Referrer-Policy" ? "no-referrer" : value);
    }
  };
  const original = (response: Response, label: string) => {
    for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) expect(response.headers.get(name), `${label} ${name}`).toBe(value);
  };
  // A browser's own request, with its same-origin marker: since 22 November
  // 2026 the proxy refuses a change request to a route bound to
  // policy.sameOriginRequired without it (POST /api/uploads here; that rule is
  // held below, in "policy.sameOriginRequired at the proxy").
  const call = (method: string, path: string) => proxy(new NextRequest(`https://inherit.bio${path}`,
    { method, headers: { origin: "https://inherit.bio", "sec-fetch-site": "same-origin" } }));
  const ID = "12345678-1234-4234-8234-00000000000b";

  /** Every registered method of the 24 endpoints the register names no-referrer for on some answers only. */
  const WHOLE_ROUTE: readonly (readonly [method: string, path: string])[] = [
    ["POST", "/api/chat"], // api.chat
    ["GET", `/api/chats/${ID}`], // api.chat-history
    ["POST", "/api/chromosomal-sex"], // api.chromosomal-sex
    ["POST", "/api/family/acknowledge"], // api.family-acknowledge
    ["POST", "/api/embryos/acknowledge"], // api.embryo-acknowledge
    ["POST", `/api/files/${ID}/process`], // api.file-process
    ["POST", "/api/files/upload-session"], // api.file-upload-session
    ["POST", "/api/uploads"], // api.subject-upload-issue
    ["POST", `/api/embryo-ingest/${ID}/configure`], // api.embryo-ingest-configure
    ["POST", `/api/embryo-ingest/${ID}/mapping`], // api.embryo-ingest-mapping
    ["PUT", `/api/embryo-ingest/${ID}/mapping`],
    ["POST", "/api/embryo-cohorts"], // api.embryo-cohorts (D-138 (b))
    ["POST", `/api/embryo-cohorts/${ID}/record-key-cards`], // api.embryo-record-key-cards (D-138 (b))
    ["POST", `/api/embryos/${ID}/disposition`], // api.embryo-disposition (D-138 (b))
    ["POST", "/api/future-person/claim/session/documents"], // api.future-person-claim-document-session
    ["GET", `/api/future-person/claim/session/corrections/${ID}/statement`], // api.future-person-own-correction-statement
    ["GET", "/api/appeals/session/decision"], // api.appeal-decision-notice
    ["GET", `/api/reviews/future-person/claim-objections/${ID}`], // api.future-person-claim-objection-review
    ["POST", `/api/reviews/future-person/claim-objections/${ID}`],
    ["GET", `/api/reviews/future-person/corrections/${ID}`], // api.future-person-correction-review
    ["POST", `/api/reviews/future-person/corrections/${ID}`],
    ["GET", "/api/jobs/annotation-refresh"], // jobs.annotation-refresh
    ["POST", "/api/jobs/annotation-refresh"],
    ["GET", "/api/jobs/mail"], // jobs.mail
    ["POST", "/api/jobs/mail"],
    ["POST", "/api/jobs/research-publish"], // jobs.research-publish
    ["GET", "/api/jobs/research-refresh"], // jobs.research-refresh
    ["POST", "/api/jobs/research-refresh"],
    ["POST", "/api/jobs/retention"], // jobs.retention
    ["GET", "/api/cron/retention"], // jobs.retention-cron
  ];

  it.each(WHOLE_ROUTE)("%s %s keeps no-referrer with every other sensitive header, signed in or not", async (method, path) => {
    for (const user of [{ id: "12345678-1234-4234-8234-000000000001" }, null]) {
      mocks.user = user;
      const response = await call(method, path);
      expect(response.status).toBe(200); strict(response);
    }
  });

  // The two under the claimant session read no account on their way, so the
  // proxy never refuses them for one.
  const ACCOUNT_READ = WHOLE_ROUTE.filter(([, path]) => !path.startsWith("/api/future-person/claim/session/"));
  it.each(ACCOUNT_READ)("keeps no-referrer on the proxy's deletion-notice and declared-location refusals for %s %s", async (method, path) => {
    mocks.profile = { deletion_requested_at: "2026-09-25T00:00:00Z", jurisdiction_code: "GB" };
    const held = await call(method, path);
    expect(held.status).toBe(423);
    expect(await held.json()).toEqual({ error: "account_deletion_notice_period" }); strict(held);
    mocks.profile = { deletion_requested_at: null, jurisdiction_code: "IR" };
    const declared = await call(method, path);
    expect(declared.status).toBe(451);
    expect(await declared.json()).toEqual({ error: "not_available_in_jurisdiction" }); strict(declared);
  });

  it.each(WHOLE_ROUTE)("keeps no-referrer on a connection location refusal, before any session read, for %s %s", async (method, path) => {
    mocks.sessionReads = 0;
    const located = await proxy(new NextRequest(`https://inherit.bio${path}`, { method, headers: { "x-vercel-ip-country": "IR" } }));
    expect(located.status).toBe(451);
    expect(await located.json()).toEqual({ error: "not_available_in_location" }); strict(located);
    expect(mocks.sessionReads).toBe(0);
  });

  // Each dynamic segment matches one segment, as the route does; a longer,
  // shorter or neighbouring path keeps the original policy.
  it.each(["/api/chat/extra", "/api/chats", "/api/chats/", `/api/chats/${ID}/extra`, "/api/chromosomal-sex/extra",
    "/api/family/acknowledge/extra", `/api/family/s-${ID}/sharing`, "/api/embryos/acknowledge/extra", `/api/embryos/${ID}/future-person-identity`,
    `/api/embryos/${ID}/disposition/extra`, `/api/embryos/parent/${ID}/disposition`, "/api/embryos//disposition",
    `/api/files/${ID}/process/extra`, `/api/files/parent/${ID}/process`, "/api/files//process", `/api/files/${ID}/finalize`,
    "/api/files/upload-session/extra", "/api/uploads/extra", `/api/uploads/${ID}/complete`,
    `/api/embryo-ingest/${ID}/configure/extra`, `/api/embryo-ingest/a/${ID}/mapping`, "/api/embryo-ingest//configure",
    `/api/embryo-ingest/${ID}/chunks/0`, `/api/embryo-ingest/${ID}/complete`, "/api/embryo-cohorts/extra", "/api/embryo-cohort-drafts",
    `/api/embryo-cohorts/${ID}/record-key-cards/extra`, `/api/embryo-cohorts/${ID}/withdraw`,
    "/api/future-person/claim/session/documents/extra", "/api/future-person/claim/session/complete",
    `/api/future-person/claim/session/corrections/${ID}`, `/api/future-person/claim/session/corrections/${ID}/statement/extra`,
    "/api/appeals/session/decision/extra", "/api/appeals/session", "/api/reviews/future-person/claim-objections",
    `/api/reviews/future-person/claim-objections/${ID}/extra`, `/api/reviews/future-person/corrections/${ID}/extra`,
    "/api/jobs", "/api/jobs/account-export", "/api/jobs/mail/extra", "/api/jobs/retention/extra", "/api/cron/retention/extra",
    "/api/consents", "/api/account/completion"])(
    "leaves the original sensitive policy outside the exact whole-route endpoint: %s", async path => {
      for (const method of ["GET", "POST"]) {
        const response = await call(method, path);
        expect(response.status).toBe(200); original(response, method);
      }
    });

  /**
   * Endpoints outside the register-derived set that the proxy upgrades
   * anyway, each for the namespace rule it has always had. Any other
   * upgrade fails the test below.
   */
  const NAMESPACE_REASONS: Readonly<Record<string, string>> = {
    "api.future-person-claim-release": "/api/reviews/future-person/claims/: reviewer IDs and documentary decisions",
    "api.claim-review-chunk-acknowledgement": "/api/downloads/: document download sessions",
    "api.claim-review-receipt": "/api/downloads/: document download sessions",
  };

  /**
   * D-138 (c)'s group of 14: their handlers send no-referrer, but the register
   * names it for none of their answers, so the decision does not cover them
   * and the browser keeps receiving the proxy's same-origin.
   */
  const HANDLER_ONLY = ["api.account-completion", "api.consents", "api.embryo-ingest-chunk", "api.embryo-ingest-complete", "api.evidence-chunk",
    "api.evidence-complete", "api.file-finalize", "api.future-person-claim-complete", "api.legal-evidence-review",
    "api.legal-evidence-upload-session", "api.llm-settings", "api.subject-upload-complete", "api.subjects", "jobs.account-export-test"];

  it("gives no-referrer to every /api/ endpoint the register names it for, by profile or bound contract, and to no other without a stated reason", async () => {
    type Route = { id: string; kind: string; path: string; methods?: string[]; parameterContract?: Record<string, { const?: string } | string> };
    const register = JSON.parse(readFileSync("docs/route-register.json", "utf8")) as {
      sensitiveResponseHeaders: Record<string, Record<string, string>>;
      sensitiveResponseHeaderBindings: Record<string, unknown>;
      responseContracts: Record<string, unknown>;
      responseContractBindings: {
        routes: Record<string, string[]>;
        allEndpoints: string[];
        policyContracts: Record<string, { endpoint?: string }>;
        resourceAuthorizationBindings: { endpoint?: string };
      };
      routes: Route[];
    };
    // A contract names no-referrer when one of its header statements, at any depth, says so.
    const namesNoReferrer = (value: unknown): boolean => value !== null && typeof value === "object" && Object.entries(value)
      .some(([key, inner]) => (key === "headers" && JSON.stringify(inner).includes("no-referrer")) || namesNoReferrer(inner));
    const contracts = new Set(Object.entries(register.responseContracts).filter(([, contract]) => namesNoReferrer(contract)).map(([id]) => id));
    // The bindings that name no route must name no such contract, or this test would not see whom they bind.
    const bindings = register.responseContractBindings;
    const unrouted = [...bindings.allEndpoints, ...Object.values(bindings.policyContracts).map(binding => binding.endpoint),
      bindings.resourceAuthorizationBindings.endpoint];
    expect(unrouted.filter(id => id !== undefined && contracts.has(id))).toEqual([]);
    const profiles = Object.entries(register.sensitiveResponseHeaders)
      .filter(([, headers]) => headers["Referrer-Policy"] === "no-referrer").map(([name]) => name);
    const reasons = (route: Route) => [
      ...profiles.filter(name => (register.sensitiveResponseHeaderBindings[name] as string[]).includes(route.id)).map(name => `profile:${name}`),
      ...(bindings.routes[route.id] ?? []).filter(id => contracts.has(id)).map(id => `contract:${id}`),
    ];
    const endpoints = register.routes.filter(route => route.kind === "endpoint" && route.path.startsWith("/api/"));
    const inSet = new Set(endpoints.filter(route => reasons(route).length > 0).map(route => route.id));
    const upgradedOutside = new Set<string>(), exercised = new Set<string>();
    for (const route of endpoints) {
      const path = route.path.replace(/\[([^\]]+)\]/g, (_all, name: string) => {
        const contract = route.parameterContract?.[name];
        return typeof contract === "object" && contract.const !== undefined ? contract.const
          : name === "sequence" ? "0" : name === "person" ? `s-${ID}` : ID;
      });
      for (const method of route.methods ?? ["GET"]) {
        for (const user of [{ id: "12345678-1234-4234-8234-000000000001" }, null]) {
          mocks.user = user;
          const policy = (await call(method, path)).headers.get("referrer-policy");
          const label = `${route.id} ${method} ${path} ${reasons(route).join(", ") || "none"}`;
          if (inSet.has(route.id)) expect(policy, label).toBe("no-referrer");
          else if (policy === "no-referrer") upgradedOutside.add(route.id);
          else expect(policy, label).toBe("same-origin");
        }
        exercised.add(`${method} ${path}`);
      }
    }
    expect([...upgradedOutside].sort()).toEqual(Object.keys(NAMESPACE_REASONS).sort());
    // The explicit list above is the register's: every entry is a derived endpoint, exercised on its method.
    for (const [method, path] of WHOLE_ROUTE) expect(exercised.has(`${method} ${path}`), `${method} ${path}`).toBe(true);
    expect(endpoints.filter(route => inSet.has(route.id) && WHOLE_ROUTE.some(([, path]) => path === route.path.replace(/\[[^\]]+\]/g, ID)))
      .flatMap(route => route.methods ?? ["GET"]).length).toBe(WHOLE_ROUTE.length);
    // The 14 stay outside the set and receive same-origin (asserted in the loop).
    for (const id of HANDLER_ONLY) {
      expect(endpoints.some(route => route.id === id), id).toBe(true);
      expect(inSet.has(id), id).toBe(false);
    }
  });
});

type RegisterRoute = {
  id: string; kind: string; path: string; auth?: string; methods?: string[];
  parameterContract?: Record<string, { const?: unknown; enum?: unknown[] } | string>;
};
type HeaderRegister = {
  sensitiveResponseHeaders: Record<string, Record<string, string>>;
  sensitiveResponseHeaderBindings: Record<string, unknown>;
  responseContracts: Record<string, unknown>;
  responseContractBindings: {
    routes: Record<string, string[]>;
    pageStates: Record<string, string>;
    resourceAuthorizationBindings: { page?: string; endpoint?: string };
  };
  resourceAuthorizationBindings: { failureContractBySurface: Record<string, string>; routes: Record<string, unknown> };
  pageAuthContract: { authenticatedSignedOut: { responseContract: string }; tokenInvalidOrExpired: string };
  routes: RegisterRoute[];
};
const headerRegister = (): HeaderRegister => JSON.parse(readFileSync("docs/route-register.json", "utf8")) as HeaderRegister;

/**
 * Pages and the endpoints outside `/api/`, 19 November 2026. The owner's
 * decision "the strictest referrer setting applies to the whole route",
 * carried from `/api/` to pages: where the register names no-referrer for any
 * answer of a page (a no-referrer profile in `sensitiveResponseHeaderBindings`,
 * or a contract bound to it in `responseContractBindings.routes`), every
 * answer of that page gets it, because the proxy cannot know which answer the
 * page will give. The sign-in redirect is the proxy's own answer and gets
 * no-referrer exactly (authenticated-page-signin-redirect-v1). Also D-138 (d)
 * (`/auth/callback` and `/withdraw/session`) and `/family` (family.index),
 * which received no sensitive header at all.
 */
describe("pages and the endpoints outside /api/: the register's referrer and header statements", () => {
  const register = headerRegister();
  const ID = "12345678-1234-4234-8234-00000000000c";
  const SIGNED_IN = { id: "12345678-1234-4234-8234-000000000001" };
  const DECLARED = { deletion_requested_at: null, jurisdiction_code: "GB" };
  const USER_DATA = new Set(["authenticated", "public-or-authenticated", "reviewer"]);
  const call = (method: string, path: string, headers: Record<string, string> = {}) =>
    proxy(new NextRequest(`https://inherit.bio${path}`, { method, headers }));
  const located = (method: string, path: string) => call(method, path, { "x-vercel-ip-country": "IR" });
  const temporary = () => ({ error: new AuthRetryableFetchError("fetch failed", 0) });
  /** Every header of the sensitive set, with the referrer policy given. */
  const sensitive = (response: Response, referrer: string, label: string) => {
    for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) {
      expect(response.headers.get(name), `${label}: ${name}`).toBe(name === "Referrer-Policy" ? referrer : value);
    }
  };
  const restoreEnv = () => {
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  };

  // The set, computed from the register as the /api/ test above computes it.
  const namesNoReferrer = (value: unknown): boolean => value !== null && typeof value === "object" && Object.entries(value)
    .some(([key, inner]) => (key === "headers" && JSON.stringify(inner).includes("no-referrer")) || namesNoReferrer(inner));
  const noReferrerContracts = new Set(Object.entries(register.responseContracts).filter(([, contract]) => namesNoReferrer(contract)).map(([id]) => id));
  const noReferrerProfiles = Object.entries(register.sensitiveResponseHeaders)
    .filter(([, headers]) => headers["Referrer-Policy"] === "no-referrer").map(([name]) => name);
  const reasons = (route: RegisterRoute) => [
    ...noReferrerProfiles.filter(name => (register.sensitiveResponseHeaderBindings[name] as string[]).includes(route.id)).map(name => `profile:${name}`),
    ...(register.responseContractBindings.routes[route.id] ?? []).filter(id => noReferrerContracts.has(id)).map(id => `contract:${id}`),
  ];
  const outsideApi = register.routes.filter(route => !route.path.startsWith("/api/"));
  const byId = (id: string) => register.routes.find(route => route.id === id)!;
  const wholeRoute = new Set(outsideApi.filter(route => reasons(route).length > 0).map(route => route.id));
  const concrete = (route: RegisterRoute) => route.path.replace(/\[([^\]]+)\]/g, (_all, name: string) => {
    const contract = route.parameterContract?.[name];
    if (typeof contract === "object") {
      if (typeof contract.const === "string") return contract.const;
      if (Array.isArray(contract.enum) && typeof contract.enum[0] === "string") return contract.enum[0];
    }
    return name === "subject" || name === "scope" ? "me" : name === "person" ? `s-${ID}` : ID;
  });

  /** The six pages of the rule behind sign-in, by register id, and the path each is driven on. */
  const PROTECTED: readonly (readonly [id: string, path: string])[] = [
    ["embryos.index", "/embryos"],
    ["embryos.compare", "/embryos/compare"],
    ["embryos.detail", `/embryos/${ID}`],
    ["copilot.scope", "/copilot/me"],
    ["genome.reports", "/genome/me/reports"],
    ["family.portrait", `/family/portrait/${ID}`],
  ];
  /** The pages of the rule a signed-out visitor is shown. */
  const PUBLIC: readonly (readonly [id: string, path: string])[] = [
    ["family.index", "/family"],
    ["rights.withdraw", "/withdraw/session"],
    ["auth.sign-in", "/auth/sign-in"],
    ["auth.sign-up", "/auth/sign-up"],
    ["auth.forgot-password", "/auth/forgot-password"],
    ["auth.reset-password", "/auth/reset-password"],
  ];
  /** The three endpoints outside /api/ the rule reaches. */
  const ENDPOINTS: readonly (readonly [id: string, method: string, path: string])[] = [
    ["auth.callback", "GET", "/auth/callback"],
    ["auth.sign-out", "POST", "/auth/sign-out"],
    ["rights.withdraw-request", "GET", "/withdraw/request"],
  ];
  /** Pages outside the set that the proxy upgrades for the namespace rule it has always had. */
  const NAMESPACE_PAGES: Readonly<Record<string, string>> = {
    "reviews.future-person-claim": "/reviews/future-person/claims/: reviewer IDs and documentary decisions",
    "reviews.appeal": "/reviews/appeals/: reviewer IDs and documentary decisions",
  };
  /**
   * Public pages outside the set with a proxy branch of their own: the
   * sensitive set with same-origin, and no-referrer on the GET that hands out
   * a form pair while their intake is open. Unchanged here.
   */
  const FORM_PAIR_PAGES: Readonly<Record<string, string>> = {
    "rights.future-person-claim": "/future-person/claim: claimPage",
    "rights.subject-access": "/legal/appeals: appealPage",
  };
  /**
   * The page-side bindings that name a no-referrer contract but no route, and
   * how each is met. The test below fails on any other, or it would not see
   * whom that binding binds.
   */
  const UNROUTED_PAGE_BINDINGS: Readonly<Record<string, string>> = {
    "pageAuthContract.authenticatedSignedOut.responseContract": "the sign-in redirect: the proxy builds it and gives it no-referrer exactly",
    "pageAuthContract.tokenInvalidOrExpired": "a token page's not-found: every token page is in the set (asserted)",
    "responseContractBindings.resourceAuthorizationBindings.page":
      "a resource-authorized page's not-found (resource-not-found-page-v1): that answer only, by the amended rule; RESOURCE_ONLY below",
    "resourceAuthorizationBindings.failureContractBySurface.page": "the same binding, stated in resourceAuthorizationBindings",
  };
  /**
   * The pages bound in `resourceAuthorizationBindings`, whose failure contract
   * for a page, resource-not-found-page-v1, names no-referrer, and about which
   * nothing else the register states does. Until 22 November 2026 this was
   * OPEN, for the owner. By the owner's decision of that day ("Twenty signed-in
   * pages keep `same-origin`; the not-found contract's header binds its own
   * answer") the register's `wholeRouteReferrerRuleOutsideApi` says a contract
   * bound through `resourceAuthorizationBindings` sets its headers on the
   * answer it describes only: their documents and the proxy's answers keep
   * same-origin (asserted below), and their not-found answer, which the
   * `(app)` group's not-found boundary renders, sets no-referrer for itself
   * (asserted in "holds the amended rule" below; in a browser by
   * `e2e/response-headers.spec.ts`).
   */
  const RESOURCE_ONLY = ["app.overview", "embryos.request-data", "embryos.upload", "family.health-picture", "family.invite", "family.permissions",
    "family.person", "files.index", "files.upload", "genome.ancestry", "genome.browser", "genome.carrier", "genome.data", "genome.report",
    "genome.subject", "settings.consents", "settings.copilot", "settings.data", "settings.index", "settings.people"];

  it.each(PROTECTED)("%s (%s): the page, its sign-in redirect and every answer the proxy gives itself carry no-referrer", async (id, path) => {
    mocks.user = SIGNED_IN; mocks.profile = DECLARED;
    const page = await call("GET", path);
    expect(page.status).toBe(200); expect(page.headers.get("location")).toBeNull();
    sensitive(page, "no-referrer", `${id} page`);
    mocks.profile = { deletion_requested_at: "2026-09-25T00:00:00Z", jurisdiction_code: "GB" };
    const held = await call("GET", path);
    expect(location(held)).toBe("/settings/data"); sensitive(held, "no-referrer", `${id} deletion notice`);
    mocks.profile = { deletion_requested_at: null, jurisdiction_code: "CU" };
    const embargoed = await call("GET", path);
    expect(location(embargoed)).toBe("/settings"); sensitive(embargoed, "no-referrer", `${id} declared embargo`);
    mocks.profile = { deletion_requested_at: null, jurisdiction_code: null };
    const undeclared = await call("GET", path);
    expect(location(undeclared)).toBe(`/settings?next=${encodeURIComponent(path)}`); sensitive(undeclared, "no-referrer", `${id} declaration`);
    mocks.answers = [temporary(), temporary()];
    const unavailable = await call("GET", path);
    expect(unavailable.headers.get("x-middleware-rewrite")).toBe(`https://inherit.bio${AUTH_UNAVAILABLE_PATH}`);
    sensitive(unavailable, "no-referrer", `${id} sign-in check unavailable`);
    mocks.user = null;
    const signIn = await call("GET", path);
    expect(signIn.status).toBe(307); expect(location(signIn)).toBe(`/auth/sign-in?next=${encodeURIComponent(path)}`);
    sensitive(signIn, "no-referrer", `${id} sign-in redirect`);
    mocks.sessionReads = 0;
    const refused = await located("GET", path);
    expect(refused.status).toBe(451); sensitive(refused, "no-referrer", `${id} location`);
    expect(mocks.sessionReads).toBe(0);
  });

  it.each(PUBLIC)("%s (%s): every answer carries no-referrer with the sensitive set, signed in or not", async (id, path) => {
    for (const user of [SIGNED_IN, null]) {
      mocks.user = user; mocks.profile = DECLARED;
      const page = await call("GET", path);
      expect(page.status).toBe(200); expect(page.headers.get("location")).toBeNull();
      sensitive(page, "no-referrer", `${id} ${user ? "signed in" : "signed out"}`);
    }
    // An account in its deletion notice with an embargoed declaration is not sent away from these pages.
    mocks.user = SIGNED_IN; mocks.profile = { deletion_requested_at: "2026-09-25T00:00:00Z", jurisdiction_code: "CU" };
    const held = await call("GET", path);
    expect(held.headers.get("location")).toBeNull(); sensitive(held, "no-referrer", `${id} held account`);
    mocks.answers = [temporary(), temporary()];
    const unavailable = await call("GET", path);
    expect(unavailable.headers.get("x-middleware-rewrite")).toBeNull(); sensitive(unavailable, "no-referrer", `${id} sign-in check unavailable`);
    const refused = await located("GET", path);
    expect(refused.status).toBe(451); sensitive(refused, "no-referrer", `${id} location`);
  });

  it.each(["/auth/sign-up", "/auth/forgot-password"])("%s: every branch of the form page carries no-referrer, not only the form pair", async path => {
    try {
      vi.stubEnv("BYOK_ENCRYPTION_KEY", "");
      const keyless = await call("GET", path);
      expect(keyless.headers.get("set-cookie"), "no sealing key: no pair").toBeNull(); sensitive(keyless, "no-referrer", "no sealing key");
      sensitive(await call("HEAD", path), "no-referrer", "HEAD");
      sensitive(await call("POST", path), "no-referrer", "POST");
      vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
      const pair = await call("GET", path);
      expect(pair.headers.get("set-cookie")).toMatch(/^inherit-auth-form=/); sensitive(pair, "no-referrer", "form pair");
      const prefetch = await call("GET", path, { rsc: "1", "next-router-prefetch": "1" });
      expect(prefetch.headers.get("set-cookie")).toBeNull(); sensitive(prefetch, "no-referrer", "prefetch with no cookie");
    } finally {
      restoreEnv();
    }
  });

  // authenticated-page-signin-redirect-v1 names no-referrer for the sign-in
  // redirect of every signed-in page; the page's own answers keep the policy
  // their own statements give them.
  it.each(["/overview", "/genome/me", `/genome/me/reports/${ID}`, "/family/invite", `/family/s-${ID}`, "/embryos/upload", "/embryos/request-data",
    "/files", "/settings", "/settings/data", "/dashboard", "/copilot"])(
    "%s: the sign-in redirect carries no-referrer, and the signed-in page and the proxy's redirects keep same-origin", async path => {
      mocks.user = null;
      const signIn = await call("GET", path);
      expect(signIn.status).toBe(307); expect(location(signIn)).toBe(`/auth/sign-in?next=${encodeURIComponent(path)}`);
      sensitive(signIn, "no-referrer", "sign-in redirect");
      mocks.user = SIGNED_IN; mocks.profile = DECLARED;
      const page = await call("GET", path);
      expect(page.headers.get("location")).toBeNull(); sensitive(page, "same-origin", "page");
      mocks.answers = [temporary(), temporary()];
      sensitive(await call("GET", path), "same-origin", "sign-in check unavailable");
      if (!path.startsWith("/settings")) {
        mocks.profile = { deletion_requested_at: "2026-09-25T00:00:00Z", jurisdiction_code: "GB" };
        sensitive(await call("GET", path), "same-origin", "deletion notice");
        mocks.profile = { deletion_requested_at: null, jurisdiction_code: null };
        const declare = await call("GET", path);
        expect(location(declare)).toBe(`/settings?next=${encodeURIComponent(path)}`); sensitive(declare, "same-origin", "declaration");
      }
    });

  it.each([`/embryos/compare/${ID}`, `/embryos/${ID}/extra`, "/copilot/me/extra", `/genome/me/reports/${ID}/extra`, "/family/portrait",
    `/family/portrait/${ID}/extra`, "/withdraw/session/extra", "/genome/me/reportsx"])(
    "leaves %s, outside the exact page shape, with the original sensitive policy", async path => {
      mocks.profile = DECLARED;
      const response = await call("GET", path);
      expect(response.status).toBe(200); sensitive(response, "same-origin", path);
    });

  it.each(["/familyx", "/family-hub", "/auth/sign-in/extra", "/auth/callback/extra", "/auth/sign-out/extra", "/auth", "/withdraw"])(
    "adds no header to %s, a public path outside every rule", async path => {
      for (const method of ["GET", "POST"]) {
        const response = await call(method, path);
        for (const name of Object.keys(SENSITIVE_RESPONSE_HEADERS)) expect(response.headers.get(name), `${method} ${name}`).toBeNull();
      }
    });

  it("auth.callback sends exactly the register's authCallback profile on every answer (D-138 (d))", async () => {
    expect(AUTH_CALLBACK_HEADERS).toEqual(register.sensitiveResponseHeaders.authCallback);
    const only = (response: Response, label: string) => {
      for (const [name, value] of Object.entries(AUTH_CALLBACK_HEADERS)) expect(response.headers.get(name), `${label}: ${name}`).toBe(value);
      for (const name of Object.keys(SENSITIVE_RESPONSE_HEADERS)) {
        if (!(name in AUTH_CALLBACK_HEADERS)) expect(response.headers.get(name), `${label}: ${name}`).toBeNull();
      }
    };
    const path = "/auth/callback?code=synthetic&state=synthetic";
    for (const user of [SIGNED_IN, null]) {
      mocks.user = user;
      const response = await call("GET", path);
      expect(response.status).toBe(200); expect(response.headers.get("x-middleware-next")).toBe("1");
      only(response, user ? "signed in" : "signed out");
    }
    mocks.answers = [temporary(), temporary()];
    only(await call("GET", path), "sign-in check unavailable");
    const refused = await located("GET", path);
    expect(refused.status).toBe(451); only(refused, "location");
  });

  it("auth.sign-out: every answer carries no-referrer (sign-out-v1); the proxy adds nothing else to the handler's answers", async () => {
    for (const user of [SIGNED_IN, null]) {
      mocks.user = user; mocks.profile = { deletion_requested_at: "2026-09-25T00:00:00Z", jurisdiction_code: "CU" };
      const response = await call("POST", "/auth/sign-out");
      expect(response.status).toBe(200); expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      for (const name of Object.keys(SENSITIVE_RESPONSE_HEADERS)) {
        if (name !== "Referrer-Policy") expect(response.headers.get(name), name).toBeNull();
      }
    }
    const refused = await located("POST", "/auth/sign-out");
    expect(refused.status).toBe(451); sensitive(refused, "no-referrer", "location");
  });

  it("rights.withdraw-request: the proxy adds only the handler's own no-referrer, on every method, and its location refusal carries it", async () => {
    for (const method of ["GET", "HEAD", "POST"]) {
      const response = await call(method, "/withdraw/request");
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("referrer-policy"), method).toBe("no-referrer");
      for (const name of Object.keys(SENSITIVE_RESPONSE_HEADERS)) {
        if (name !== "Referrer-Policy") expect(response.headers.get(name), `${method} ${name}`).toBeNull();
      }
    }
    expect(mocks.sessionReads).toBe(0);
    const refused = await located("GET", "/withdraw/request");
    expect(refused.status).toBe(451); sensitive(refused, "no-referrer", "location");
  });

  it("gives no-referrer to every answer of every route outside /api/ the register names it for, by profile or bound contract, and to no other page", async () => {
    // The page-side bindings that name no route are the ones accounted for.
    const unrouted: Record<string, string | undefined> = {
      ...Object.fromEntries(Object.entries(register.responseContractBindings.pageStates)
        .map(([state, id]) => [`responseContractBindings.pageStates.${state}`, id])),
      "responseContractBindings.resourceAuthorizationBindings.page": register.responseContractBindings.resourceAuthorizationBindings.page,
      "resourceAuthorizationBindings.failureContractBySurface.page": register.resourceAuthorizationBindings.failureContractBySurface.page,
      "pageAuthContract.authenticatedSignedOut.responseContract": register.pageAuthContract.authenticatedSignedOut.responseContract,
      "pageAuthContract.tokenInvalidOrExpired": register.pageAuthContract.tokenInvalidOrExpired,
    };
    expect(Object.entries(unrouted).filter(([, id]) => id !== undefined && noReferrerContracts.has(id)).map(([at]) => at).sort())
      .toEqual(Object.keys(UNROUTED_PAGE_BINDINGS).sort());
    for (const id of register.sensitiveResponseHeaderBindings.tokenPageOrEndpoint as string[]) {
      if (byId(id).kind === "page") expect(wholeRoute.has(id), `token page ${id}`).toBe(true);
    }
    for (const route of outsideApi) {
      const path = concrete(route);
      for (const method of route.methods ?? ["GET"]) {
        const label = `${route.id} ${method} ${path} ${reasons(route).join(", ") || "none"}`;
        mocks.user = SIGNED_IN; mocks.profile = DECLARED;
        const document = (await call(method, path)).headers.get("referrer-policy");
        mocks.user = null;
        const signedOut = await call(method, path);
        const refused = (await located(method, path)).headers.get("referrer-policy");
        if (wholeRoute.has(route.id)) {
          expect(document, `${label} signed in`).toBe("no-referrer");
          expect(signedOut.headers.get("referrer-policy"), `${label} signed out`).toBe("no-referrer");
          expect(refused, `${label} location`).toBe("no-referrer");
          continue;
        }
        if (FORM_PAIR_PAGES[route.id]) {
          expect(["same-origin", "no-referrer"], `${label} signed in`).toContain(document);
          expect(["same-origin", "no-referrer"], `${label} signed out`).toContain(signedOut.headers.get("referrer-policy"));
          expect(refused, `${label} location`).toBe("same-origin");
          continue;
        }
        const own = NAMESPACE_PAGES[route.id] ? "no-referrer" : USER_DATA.has(route.auth ?? "") ? "same-origin" : null;
        expect(document, `${label} signed in`).toBe(own);
        if (route.auth === "authenticated") {
          expect(signedOut.status, label).toBe(307);
          expect(location(signedOut), label).toBe(`/auth/sign-in?next=${encodeURIComponent(path)}`);
          expect(signedOut.headers.get("referrer-policy"), `${label} sign-in redirect`).toBe("no-referrer");
        } else {
          expect(signedOut.headers.get("referrer-policy"), `${label} signed out`).toBe(own);
        }
        expect(refused, `${label} location`).toBe(NAMESPACE_PAGES[route.id] ? "no-referrer" : "same-origin");
      }
    }
    // The explicit lists above are the register's, and each path is its route's path with the parameters filled in.
    expect([...PROTECTED, ...PUBLIC].map(([id]) => id).concat(ENDPOINTS.map(([id]) => id)).sort()).toEqual([...wholeRoute].sort());
    for (const [id, path] of [...PROTECTED, ...PUBLIC]) {
      expect(new RegExp(`^${byId(id).path.replace(/\[[^\]]+\]/g, "[^/]+")}$`).test(path), `${id} ${path}`).toBe(true);
    }
    for (const [id, method, path] of ENDPOINTS) expect(byId(id), id).toMatchObject({ kind: "endpoint", path, methods: [method] });
    for (const id of [...Object.keys(NAMESPACE_PAGES), ...Object.keys(FORM_PAIR_PAGES)]) expect(byId(id), id).toBeDefined();
    // The pages whose only no-referrer statement is the resource-authorization failure contract: their
    // documents and the proxy's answers keep same-origin (asserted above), as the amended rule says (below).
    expect(Object.keys(register.resourceAuthorizationBindings.routes)
      .filter(id => byId(id) !== undefined && byId(id).kind === "page" && !wholeRoute.has(id)).sort()).toEqual(RESOURCE_ONLY);
  });

  /** The `content` of every `<meta name="referrer">` in a rendered element tree. */
  const referrerMeta = (node: unknown): string[] => {
    if (Array.isArray(node)) return node.flatMap(referrerMeta);
    if (!isValidElement<{ name?: string; content?: string; children?: unknown }>(node)) return [];
    const own = node.type === "meta" && node.props.name === "referrer" ? [String(node.props.content)] : [];
    return [...own, ...referrerMeta(node.props.children)];
  };

  // Owner decision of 22 November 2026 ("Twenty signed-in pages keep `same-origin`; the not-found
  // contract's header binds its own answer"), as the register now states it.
  it("holds the amended rule: a contract bound through resourceAuthorizationBindings sets its headers on its own answer only", async () => {
    const rule = register.sensitiveResponseHeaderBindings.wholeRouteReferrerRuleOutsideApi as string;
    expect(rule).toContain("registered-2026-11-22-G8.5");
    expect(rule).toContain("a-response-contract-bound-to-a-page-through-resourceAuthorizationBindings");
    expect(rule).toContain("sets-its-headers-on-the-answer-it-describes, the-page's-not-found-answer, only, and-not-on-every-answer-of-the-page");
    // The binding the twenty pages have names one contract, which names no-referrer for the not-found answer.
    const contract = register.resourceAuthorizationBindings.failureContractBySurface.page;
    expect(register.responseContractBindings.resourceAuthorizationBindings.page).toBe(contract);
    expect(contract).toBe("resource-not-found-page-v1");
    expect(noReferrerContracts.has(contract)).toBe(true);
    expect(RESOURCE_ONLY).toHaveLength(20);
    // Each of them renders its not-found answer inside the (app) group, whose boundary is the nearest one,
    // and that boundary sets no-referrer for the document it renders.
    const { default: NotFound } = await import("@/app/(app)/not-found");
    expect(referrerMeta(NotFound())).toEqual(["no-referrer"]);
    for (const id of RESOURCE_ONLY) {
      const directory = `src/app/(app)${byId(id).path}`;
      expect(existsSync(`${directory}/page.tsx`), `${id}: ${directory}/page.tsx`).toBe(true);
      for (let at = directory; at !== "src/app/(app)"; at = dirname(at)) expect(existsSync(`${at}/not-found.tsx`), `${id}: ${at}`).toBe(false);
    }
  });

  /**
   * The routes outside /api/ that the test below does not hold to the
   * sensitive set, each an endpoint with its own headers.
   */
  const OWN_HEADERS: Readonly<Record<string, string>> = {
    "rights.withdraw-request": "the handler sends rights-interstitial-v1's headers, a stricter policy than the sensitive set (src/lib/embryos/rights-entry.test.ts); the proxy adds only no-referrer",
    "auth.callback": "its own authCallback profile, exactly (held above)",
    "auth.sign-out": "the handler's answers (sign-out-v1's 303, the CSRF gate's refusals) with the proxy's no-referrer; OPEN: the 303 carries no anti-framing header",
  };

  /**
   * `/family` received no sensitive header at all: the proxy tested
   * `startsWith("/family/")`. Every route outside /api/ that the register
   * calls authenticated, public-or-authenticated or reviewer, or binds to a
   * sensitive profile, carries the no-store and anti-framing set on every
   * answer the proxy gives, signed in or not, so a prefix test that misses a
   * registered route fails here.
   */
  it("carries the sensitive set on every answer of every page the register calls signed-in, public-or-signed-in or reviewer, or binds to a profile", async () => {
    const profileBound = new Set(Object.keys(register.sensitiveResponseHeaders)
      .flatMap(name => register.sensitiveResponseHeaderBindings[name] as string[]));
    const covered = outsideApi.filter(route => USER_DATA.has(route.auth ?? "") || profileBound.has(route.id));
    for (const route of covered) {
      if (OWN_HEADERS[route.id]) {
        expect(route.kind, route.id).toBe("endpoint");
        continue;
      }
      const path = concrete(route);
      for (const method of route.methods ?? ["GET"]) {
        for (const user of [SIGNED_IN, null]) {
          mocks.user = user; mocks.profile = DECLARED;
          const response = await call(method, path);
          const label = `${route.id} ${method} ${path} ${user ? "signed in" : "signed out"}`;
          for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) {
            if (name === "Referrer-Policy") expect(["same-origin", "no-referrer"], label).toContain(response.headers.get(name));
            else expect(response.headers.get(name), `${label}: ${name}`).toBe(value);
          }
        }
      }
    }
    for (const id of Object.keys(OWN_HEADERS)) expect(covered.some(route => route.id === id), id).toBe(true);
    expect(covered.filter(route => route.kind !== "endpoint").length).toBe(covered.length - Object.keys(OWN_HEADERS).length);
  });
});

/**
 * D-138 (e). api.rights-reissue is bound to `authOrRecovery`, and its handler
 * answers with that profile's per-response nonce policy (`authJson`). The
 * proxy's `frame-ancestors 'none'` replaced it, because Next keeps the
 * proxy's header. The proxy now gives every answer on that path the profile
 * itself, as it does for the three auth endpoints, its own refusals included.
 */
describe("api.rights-reissue keeps the authOrRecovery policy (D-138 (e))", () => {
  const register = headerRegister();
  const profileHeaders = register.sensitiveResponseHeaders.authOrRecovery!;
  const parts = profileHeaders["Content-Security-Policy"]!.split("{per-response-random-nonce}");
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const NONCE_POLICY = new RegExp(`^${escape(parts[0]!)}([A-Za-z0-9+/]{22}==)${parts.slice(1).map(escape).join("\\1")}$`);
  const call = (method: string, path: string, headers: Record<string, string> = {}) =>
    proxy(new NextRequest(`https://inherit.bio${path}`, { method, headers }));
  const temporary = () => ({ error: new AuthRetryableFetchError("fetch failed", 0) });
  const profile = (response: Response, label: string) => {
    expect(response.headers.get("content-security-policy"), `${label}: Content-Security-Policy`).toMatch(NONCE_POLICY);
    for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) {
      if (name !== "Content-Security-Policy") expect(response.headers.get(name), `${label}: ${name}`).toBe(name === "Referrer-Policy" ? "no-referrer" : value);
    }
    for (const [name, value] of Object.entries(profileHeaders)) {
      if (name === "Cache-Control") expect(response.headers.get(name), `${label}: ${name}`).toContain(value);
      else if (name !== "Content-Security-Policy") expect(response.headers.get(name), `${label}: ${name}`).toBe(value);
    }
  };
  const nonceOf = (response: Response) => NONCE_POLICY.exec(response.headers.get("content-security-policy") ?? "")?.[1];

  it("POST /api/rights/reissue: the profile, with a fresh nonce, on every answer, the proxy's own included", async () => {
    const answers: Response[] = [];
    for (const user of [{ id: "12345678-1234-4234-8234-000000000001" }, null]) {
      mocks.user = user;
      const response = await call("POST", "/api/rights/reissue");
      expect(response.status).toBe(200); profile(response, user ? "signed in" : "signed out");
      answers.push(response);
    }
    expect(nonceOf(answers[0]!)).not.toBe(nonceOf(answers[1]!));
    mocks.user = { id: "12345678-1234-4234-8234-000000000001" };
    mocks.profile = { deletion_requested_at: "2026-09-25T00:00:00Z", jurisdiction_code: "GB" };
    const held = await call("POST", "/api/rights/reissue");
    expect(held.status).toBe(423); profile(held, "deletion notice");
    mocks.profile = { deletion_requested_at: null, jurisdiction_code: "IR" };
    const declared = await call("POST", "/api/rights/reissue");
    expect(declared.status).toBe(451); profile(declared, "declared location");
    mocks.answers = [temporary(), temporary()];
    const unavailable = await call("POST", "/api/rights/reissue");
    expect(unavailable.status).toBe(503); profile(unavailable, "sign-in check unavailable");
    const located = await call("POST", "/api/rights/reissue", { "x-vercel-ip-country": "IR" });
    expect(located.status).toBe(451); profile(located, "connection location");
  });

  it("leaves the original sensitive policy on the paths beside it", async () => {
    for (const path of ["/api/rights/reissue/extra", "/api/rights", "/api/rights/reissues"]) {
      const response = await call("POST", path);
      for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) expect(response.headers.get(name), `${path} ${name}`).toBe(value);
    }
  });

  /**
   * api.future-person-claim is bound to authOrRecovery too, but neither its
   * handler nor the proxy sends the profile's nonce policy: the proxy's
   * `frame-ancestors 'none'` is the only one, and nothing is replaced.
   */
  const NO_NONCE_POLICY: Readonly<Record<string, string>> = {
    "api.future-person-claim": "OPEN: no nonce policy is built for it; frame-ancestors 'none' is its one policy",
  };

  it("gives every /api/ endpoint bound to authOrRecovery the profile's nonce policy, except the one stated", async () => {
    const bound = new Set(register.sensitiveResponseHeaderBindings.authOrRecovery as string[]);
    const endpoints = register.routes.filter(route => bound.has(route.id) && route.path.startsWith("/api/"));
    for (const route of endpoints) {
      expect(route.path, route.id).not.toMatch(/\[/);
      for (const method of route.methods ?? ["GET"]) {
        for (const user of [{ id: "12345678-1234-4234-8234-000000000001" }, null]) {
          mocks.user = user;
          const response = await call(method, route.path);
          const label = `${route.id} ${method} ${route.path}`;
          if (NO_NONCE_POLICY[route.id]) expect(response.headers.get("content-security-policy"), label).toBe("frame-ancestors 'none'");
          else profile(response, label);
        }
      }
    }
    for (const id of Object.keys(NO_NONCE_POLICY)) expect(endpoints.some(route => route.id === id), id).toBe(true);
    expect(endpoints.some(route => route.id === "api.rights-reissue")).toBe(true);
  });
});

/**
 * policy.sameOriginRequired at the proxy (owner decision of 22 November 2026,
 * "Change requests are refused without the browser's same-origin marker,
 * before the account is read"). The proxy reads the session and the profile
 * for every other /api/ request, so a request to a bound route and method
 * whose Sec-Fetch-Site is not same-origin, or whose Origin is another site's,
 * gets the route's registered refusal (authenticated-mutation-v1's 403
 * request_forbidden) before that read, whoever is signed in. The set is the
 * register's; the CSRF wrapper's half is in src/lib/security/same-origin.test.ts.
 */
describe("policy.sameOriginRequired at the proxy", () => {
  type Route = { id: string; kind: string; path: string; methods?: string[]; policy?: { sameOriginRequired?: string };
    parameterContract?: Record<string, { const?: string } | string> };
  const register = JSON.parse(readFileSync("docs/route-register.json", "utf8")) as { routes: Route[] };
  const ID = "12345678-1234-4234-8234-00000000000d";
  const ORIGIN = "https://inherit.bio";
  const SIGNED_IN = { id: "12345678-1234-4234-8234-000000000001" };
  const DECLARED = { deletion_requested_at: null, jurisdiction_code: "GB" };
  const NOTICE = { deletion_requested_at: "2026-09-25T00:00:00Z", jurisdiction_code: "GB" };
  const concrete = (route: Route) => route.path.replace(/\[([^\]]+)\]/g, (_all, name: string) => {
    const contract = route.parameterContract?.[name];
    return typeof contract === "object" && contract.const !== undefined ? contract.const
      : name === "sequence" ? "0" : name === "person" ? `s-${ID}` : ID;
  });
  const bound = register.routes.filter(route => route.policy?.sameOriginRequired !== undefined);
  const send = (method: string, path: string, headers: Record<string, string>) =>
    proxy(new NextRequest(`${ORIGIN}${path}`, { method, headers }));
  const REFUSED: Readonly<Record<string, Record<string, string>>> = {
    "the right Origin with no marker": { origin: ORIGIN },
    "neither header": {},
    "cross-site": { origin: "https://foreign.example", "sec-fetch-site": "cross-site" },
    "same-site": { origin: ORIGIN, "sec-fetch-site": "same-site" },
    "none": { origin: ORIGIN, "sec-fetch-site": "none" },
    "another Origin with the marker": { origin: "https://foreign.example", "sec-fetch-site": "same-origin" },
    "another Origin named by X-Forwarded-Host too": { origin: "https://foreign.example", "sec-fetch-site": "same-origin",
      "x-forwarded-host": "foreign.example" },
  };
  const ADMITTED: Readonly<Record<string, Record<string, string>>> = {
    "the browser's own request": { origin: ORIGIN, "sec-fetch-site": "same-origin" },
    "no Origin with the marker": { "sec-fetch-site": "same-origin" },
  };
  const cases = (variants: Readonly<Record<string, Record<string, string>>>) => bound.flatMap(route => (route.methods ?? ["GET"])
    .flatMap(method => Object.entries(variants).map(([label, headers]) => [route.id, method, concrete(route), label, headers] as const)));

  it("is bound to the two routes the register binds", () => {
    expect(bound.map(route => route.id).sort()).toEqual(["api.file-delete", "api.subject-upload-issue"]);
  });

  it.each(cases(REFUSED))("%s %s %s: refuses %s before reading any session, signed in, signed out or in the deletion notice",
    async (id, method, path, label, headers) => {
      for (const [user, profile] of [[SIGNED_IN, DECLARED], [null, null], [SIGNED_IN, NOTICE]] as const) {
        mocks.user = user; mocks.profile = profile; mocks.sessionReads = 0; mocks.selected = [];
        const response = await send(method, path, headers);
        const at = `${id} ${label} ${user ? "signed in" : "signed out"}`;
        expect(response.status, at).toBe(403);
        expect(await response.json(), at).toEqual({ error: "request_forbidden" });
        // The sensitive set, with the route's own referrer policy (api.subject-upload-issue's is no-referrer).
        for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) {
          if (name === "Referrer-Policy") expect(response.headers.get(name), at).toBe(path === "/api/uploads" ? "no-referrer" : "same-origin");
          else expect(response.headers.get(name), `${at}: ${name}`).toBe(value);
        }
        expect(mocks.sessionReads, `${at}: no session read`).toBe(0);
        expect(mocks.selected, `${at}: no profile read`).toEqual([]);
      }
    });

  it.each(cases(ADMITTED))("%s %s %s: lets %s through to the session check", async (id, method, path, label, headers) => {
    mocks.user = SIGNED_IN; mocks.profile = DECLARED;
    const response = await send(method, path, headers);
    expect(response.status, `${id} ${label}`).toBe(200);
    expect(mocks.sessionReads, `${id} ${label}`).toBe(1);
    // Past the rule the proxy's own checks apply as before.
    mocks.profile = NOTICE;
    expect((await send(method, path, headers)).status, `${id} ${label} deletion notice`).toBe(423);
  });

  it("refuses an embargoed connection with the location answer first, as it does everything", async () => {
    const response = await send("DELETE", `/api/files/${ID}`, { "x-vercel-ip-country": "IR" });
    expect(response.status).toBe(451);
    expect(mocks.sessionReads).toBe(0);
  });

  it("applies to the bound routes on their registered methods only, and to no other registered route", async () => {
    mocks.user = SIGNED_IN; mocks.profile = DECLARED;
    const methods = [...new Set(register.routes.flatMap(route => route.methods ?? ["GET"]))];
    const refusedAt: string[] = [];
    for (const route of register.routes.filter(candidate => candidate.path.startsWith("/api/"))) {
      for (const method of methods) {
        const response = await send(method, concrete(route), REFUSED["the right Origin with no marker"]!);
        if (response.status === 403) refusedAt.push(`${method} ${route.path}`);
        else expect(response.status, `${route.id} ${method}`).toBe(200);
      }
    }
    expect(refusedAt.sort()).toEqual(bound.flatMap(route => (route.methods ?? ["GET"]).map(method => `${method} ${route.path}`)).sort());
    // The static route beside api.file-delete's dynamic one is its own route.
    expect((await send("DELETE", "/api/files/upload-session", REFUSED["the right Origin with no marker"]!)).status).toBe(200);
  });
});
