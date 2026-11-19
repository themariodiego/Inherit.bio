import { readFileSync } from "node:fs";
import { DEFAULT_COOKIE_OPTIONS } from "@supabase/ssr";
import { appendMutableCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import type { ResponseCookies } from "next/dist/server/web/spec-extension/cookies";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TIER2_EMBRYO_COOKIE_NAME } from "@/lib/embryos/tier2";
import { TIER2_COOKIE_NAME } from "@/lib/family/tier2";
import { SESSION_SCOPED_COOKIES, SIGN_OUT_COOKIES, signOutCookies, signOutResponse } from "./response";

const KEY = Buffer.alloc(32, 21).toString("base64");
const SESSION = "5c000000-0000-4000-8000-000000000001";
const SECRET = "S".repeat(43);
const EPOCH = new Date(0).toUTCString();

/** One `Set-Cookie` line as name, value and lower-cased attributes (a flag maps to ""). */
function parse(line: string) {
  const [pair, ...rest] = line.split(";").map((part) => part.trim());
  const at = pair!.indexOf("=");
  const attributes = new Map(rest.map((part) => {
    const split = part.indexOf("=");
    return split < 0 ? [part.toLowerCase(), ""] as const : [part.slice(0, split).toLowerCase(), part.slice(split + 1)] as const;
  }));
  return { name: pair!.slice(0, at), value: pair!.slice(at + 1), attributes };
}
const deletions = (response: Response) => response.headers.getSetCookie().map(parse);

/**
 * A deletion removes the cookie a setter made only when it names the same
 * cookie: the same name and path, no Domain on a host-only cookie, and Secure
 * where the setter was Secure (a `__Host-` deletion without it is refused).
 * It also repeats HttpOnly and SameSite, and it must expire now.
 */
function expectDeletes(set: string, deletion: ReturnType<typeof parse> | undefined, label: string) {
  const made = parse(set);
  expect(deletion, `${label}: ${made.name} is deleted`).toBeDefined();
  const { name, value, attributes } = deletion!;
  expect(name, label).toBe(made.name);
  expect(value, `${label}: emptied`).toBe("");
  expect(attributes.get("expires"), `${label}: expired`).toBe(EPOCH);
  expect(attributes.has("max-age"), `${label}: an expiry, not Max-Age`).toBe(false);
  expect(attributes.get("path"), `${label}: path`).toBe(made.attributes.get("path"));
  expect(attributes.has("domain") || made.attributes.has("domain"), `${label}: host-only`).toBe(false);
  expect(attributes.has("secure"), `${label}: Secure as set`).toBe(made.attributes.has("secure"));
  expect(attributes.has("httponly"), `${label}: HttpOnly as set`).toBe(made.attributes.has("httponly"));
  expect(attributes.get("samesite")?.toLowerCase(), `${label}: SameSite as set`).toBe(made.attributes.get("samesite")?.toLowerCase());
  if (made.name.startsWith("__Host-")) expect([attributes.has("secure"), attributes.get("path")], `${label}: __Host-`).toEqual([true, "/"]);
}

/** Each cookie the register's families name, as its own setter writes it in this environment. */
async function setters(): Promise<Record<string, string>> {
  const { mintAuthForm } = await import("@/lib/auth/auth-form");
  const { newPkceFlow } = await import("@/lib/auth/pkce-state");
  const { newResetSession } = await import("@/lib/auth/reset-session");
  const { mintRightsActivationCandidate } = await import("@/lib/embryos/rights-activation");
  const { ingestCookie } = await import("@/lib/embryos/ingest-session");
  const { evidenceCookie } = await import("@/lib/future-person/evidence-session");
  const { mintClaimForm, newClaimSession } = await import("@/lib/future-person/claim-session");
  const { downloadCookie } = await import("@/lib/future-person/review");
  const { createAccountExportCookie } = await import("@/lib/exports/account-export-session");
  const { tier2CookieAttributes, TIER2_COOKIE_NAME: family } = await import("@/lib/family/tier2");
  const { embryoGateCookie } = await import("@/lib/embryos/tier2");
  const { NextResponse } = await import("next/server");
  const later = new Date(Date.now() + 3_600_000);
  // The Family gate as api.family-acknowledge sets it, and the Embryo gate as api.embryo-acknowledge does.
  const tier2 = NextResponse.json(null);
  tier2.cookies.set({ name: family, value: "f".repeat(64), ...tier2CookieAttributes() });
  const embryo = NextResponse.json(null);
  embryo.cookies.set(embryoGateCookie(SESSION, SESSION));
  const reset = newResetSession().setCookies;
  const claim = newClaimSession().setCookies;
  return {
    family: tier2.headers.getSetCookie()[0]!,
    embryo: embryo.headers.getSetCookie()[0]!,
    authForm: mintAuthForm("auth-sign-up").setCookie,
    pkce: newPkceFlow("signup").setCookie,
    reset: reset[0]!,
    resetCsrf: reset[1]!,
    candidate: mintRightsActivationCandidate().setCookie,
    upload: ingestCookie(SESSION, SECRET, later),
    evidence: evidenceCookie(SECRET, later),
    claim: claim[0]!,
    claimForm: mintClaimForm().setCookie,
    download: downloadCookie(SECRET),
    // The export routes write this one inline, the same in all three (checked below).
    exportDownload: `__Host-inherit-download=${SECRET}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=60`,
    export: createAccountExportCookie({ accountId: SESSION, sessionId: SESSION }).header(SESSION),
  };
}

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("sign-out", () => {
  it("redirects to sign-in, as sign-out-v1 says, and deletes every session cookie it lists", () => {
    expect(SESSION_SCOPED_COOKIES).toEqual(["inherit_family_gate", "inherit_embryo_gate"]);
    const response = signOutResponse("https://example.test");
    expect(response.status).toBe(303);
    // G8.5 (2026-10-23): sign-out-v1 names auth.sign-in; this was "https://example.test/".
    expect(response.headers.get("location")).toBe("https://example.test/auth/sign-in");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const cleared = response.cookies.getAll().map((cookie) => [cookie.name, cookie.value, cookie.maxAge ?? cookie.expires]);
    // 2026-11-19 (G8.5 stage one): sign-out-v1.sessionEffect, not the two
    // Tier-2 gates alone; the gates still come first and still end here.
    expect(cleared.map(([name]) => name)).toEqual([TIER2_COOKIE_NAME, TIER2_EMBRYO_COOKIE_NAME,
      "inherit-auth-form", "inherit-pkce-verifier", "inherit-reset", "inherit-reset-csrf", "inherit-rights-candidate",
      "inherit-evidence", "inherit-claim", "inherit-claim-form", "inherit-download", "__Host-inherit-download",
      "__Host-inherit-export"]);
    for (const [, value, expiry] of cleared) {
      expect(value).toBe("");
      expect(expiry === 0 || (expiry instanceof Date && expiry.getTime() === 0)).toBe(true);
    }
  });

  it.each([["outside production", "test"], ["in production", "production"]])(
    "deletes each cookie with the attributes its own setter gave it, %s", async (_label, environment) => {
      vi.stubEnv("NODE_ENV", environment);
      vi.stubEnv("BYOK_ENCRYPTION_KEY", KEY);
      vi.resetModules();
      const { signOutResponse: respond } = await import("./response");
      const set = await setters();
      const request = new Request("https://example.test/auth/sign-out", { method: "POST",
        headers: { cookie: `${parse(set.upload).name}=${SECRET}` } });
      const deleted = new Map(deletions(respond("https://example.test", request)).map((line) => [line.name, line]));
      for (const [label, line] of Object.entries(set)) expectDeletes(line, deleted.get(parse(line).name), label);
      const names = new Set(Object.values(set).map((line) => parse(line).name));
      expect([...deleted.keys()].filter((name) => !names.has(name)), "nothing else is deleted").toEqual([]);
      if (environment === "production") {
        expect([...deleted.keys()].filter((name) => !name.startsWith("__Host-")).sort(), "only the Tier-2 gates carry no prefix")
          .toEqual(["inherit_embryo_gate", "inherit_family_gate"]);
      }
    });

  it("reads the export routes' download cookie as the shared deletion writes it", () => {
    for (const file of ["src/lib/exports/account-export-http.ts", "src/lib/exports/subject-export-http.ts",
      "src/lib/exports/claimant-export-http.ts"]) {
      expect(readFileSync(file, "utf8"), file).toContain("`__Host-inherit-download=${secret}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=");
    }
  });

  it("deletes the Supabase session cookies and every upload session cookie the request carries, and nothing else of it", () => {
    const upload = `inherit-ingest-${SESSION}`;
    const request = new Request("https://example.test/auth/sign-out", { method: "POST", headers: { cookie: [
      "sb-abcdefghijklmnop-auth-token=base64-x", "sb-abcdefghijklmnop-auth-token.0=a", "sb-abcdefghijklmnop-auth-token.1=b",
      "sb-127-auth-token-code-verifier=v", `${upload}=${SECRET}`, "inherit-ingest-not-a-session=x", `__Host-${upload}=${SECRET}`,
      "inherit-rights=R", "unrelated=1", "sb-other=1",
    ].join("; ") } });
    const requested = signOutCookies(request).slice(SIGN_OUT_COOKIES.length);
    expect(requested.map((cookie) => [cookie.name, cookie.family])).toEqual([
      ["sb-abcdefghijklmnop-auth-token", "auth"], ["sb-abcdefghijklmnop-auth-token.0", "auth"],
      ["sb-abcdefghijklmnop-auth-token.1", "auth"], ["sb-127-auth-token-code-verifier", "auth"], [upload, "upload"],
    ]);
    // @supabase/ssr sets them with its defaults; neither server client here passes cookieOptions.
    for (const file of ["src/lib/supabase/server.ts", "src/proxy.ts"]) expect(readFileSync(file, "utf8"), file).not.toContain("cookieOptions");
    const supabase = `sb-abcdefghijklmnop-auth-token=x; Path=${DEFAULT_COOKIE_OPTIONS.path}; SameSite=${DEFAULT_COOKIE_OPTIONS.sameSite}`
      + `${DEFAULT_COOKIE_OPTIONS.httpOnly ? "; HttpOnly" : ""}${DEFAULT_COOKIE_OPTIONS.secure ? "; Secure" : ""}`;
    const deleted = deletions(signOutResponse("https://example.test", request));
    expectDeletes(supabase, deleted.find((line) => line.name === "sb-abcdefghijklmnop-auth-token"), "supabase");
    expect(deleted.map((line) => line.name)).not.toContain("inherit-rights");
    expect(deleted.map((line) => line.name)).not.toContain("unrelated");
  });

  it("keeps every deletion when Next.js merges the auth client's own cookie writes into the response", () => {
    const request = new Request("https://example.test/auth/sign-out", { method: "POST",
      headers: { cookie: `sb-abcdefghijklmnop-auth-token=x; inherit-ingest-${SESSION}=${SECRET}` } });
    const response = signOutResponse("https://example.test", request);
    const before = deletions(response).map((line) => line.name);
    // The auth client's signOut removes its session through cookies(); the
    // route module then re-reads the handler's own Set-Cookie lines and puts
    // them back after those writes (app-route module, appendMutableCookies).
    const written = { [Symbol.for("next.mutated.cookies")]: [
      { name: "sb-abcdefghijklmnop-auth-token", value: "", path: "/", maxAge: 0, sameSite: "lax" },
    ] } as unknown as ResponseCookies;
    const headers = new Headers(response.headers);
    expect(appendMutableCookies(headers, written)).toBe(true);
    const merged = headers.getSetCookie().map(parse);
    expect(merged.map((line) => line.name).sort()).toEqual([...before].sort());
    for (const line of merged) {
      expect(line.value, line.name).toBe("");
      expect(line.attributes.get("expires"), `${line.name} still expires`).toBe(EPOCH);
    }
  });

  it("covers every cookie family sign-out-v1 and the route's policy name, except the two the owner must settle", () => {
    const register = JSON.parse(readFileSync("docs/route-register.json", "utf8")) as {
      responseContracts: Record<string, { sessionEffect?: string }>; routes: { id: string; policy?: { transaction?: string } }[];
    };
    const effect = register.responseContracts["sign-out-v1"]!.sessionEffect!;
    const transaction = register.routes.find((route) => route.id === "auth.sign-out")!.policy!.transaction!;
    const named = /clear-every-Inherit-(.+)-cookie-before-the-response/u.exec(effect)![1]!.replace("-and-", "-").split("-");
    const policy = /clear-the-host-only-(.+)-cookies-and-write/u.exec(transaction)![1]!.replace("-and-", "-")
      .replace("model-capability", "model_capability").split("-").map((family) => family.replace("_", "-"));
    expect(named).toEqual(["auth", "rights", "upload", "evidence", "claim", "download", "candidate"]);
    expect(policy).toEqual(["session", "upload", "evidence", "export", "download", "model-capability"]);
    const cleared = new Set<string>(SIGN_OUT_COOKIES.map((cookie) => cookie.family));
    // The policy's "session" cookies are the Supabase session's, read from the request (above).
    cleared.add("session");
    cleared.add("upload");
    const open = { rights: "kept: clearing it would strand a rights session whose mailed link is spent (owner decision)",
      "model-capability": "no such cookie exists in the code" };
    for (const family of new Set([...named, ...policy])) {
      expect(cleared.has(family) || Object.hasOwn(open, family), family).toBe(true);
      expect(cleared.has(family) && Object.hasOwn(open, family), family).toBe(false);
    }
    expect(SIGN_OUT_COOKIES.map((cookie) => cookie.name)).not.toContain("inherit-rights");
  });
});
