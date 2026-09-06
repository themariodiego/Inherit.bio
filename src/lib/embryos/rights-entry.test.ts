import crypto from "node:crypto";
import vm from "node:vm";
import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { GET, HEAD } from "@/app/(marketing)/withdraw/request/route";
import { POST } from "@/app/api/rights/activate/route";
import { proxy } from "@/proxy";
import { invitationTokenHash } from "./rights-session";
import { mintRightsActivationCandidate } from "./rights-activation";
import { rightsInterstitialScript } from "./rights-interstitial";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), authClient: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.authClient }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
});
afterEach(() => vi.unstubAllEnvs());

function browserScript(fragment: string) {
  const events = new Map<string, () => unknown>();
  const button = { disabled: true, addEventListener: (name: string, fn: () => unknown) => events.set(name, fn) };
  const status = { textContent: "" };
  let hashReads = 0;
  let url = `/withdraw/request#${fragment}`;
  const order: string[] = [];
  const fetch = vi.fn().mockResolvedValue({ redirected: false, status: 404 });
  const context = {
    location: { get hash() { hashReads++; return url.includes("#") ? url.slice(url.indexOf("#")) : ""; }, origin: "https://inherit.bio", replace: vi.fn() },
    history: { replaceState: (_state: unknown, _title: string, path: string) => { url = path; order.push("clear"); } },
    addEventListener: (name: string, fn: () => unknown) => events.set(name, fn),
    setTimeout: (fn: () => unknown) => events.set("expire", fn),
    document: {
      addEventListener: (name: string, fn: () => unknown) => { order.push("listen"); events.set(name, fn); },
      getElementById: (id: string) => id === "activate" ? button : status,
    },
    fetch, URL, Date,
  };
  vm.runInNewContext(rightsInterstitialScript("served-form"), context);
  return {
    events, button, status, fetch, context, order,
    get url() { return url; }, get hashReads() { return hashReads; },
    navigateFragment(value: string) {
      url = `/withdraw/request#${value}`;
      events.get("hashchange")!();
    },
  };
}

describe("mailed rights entry", () => {
  it("serves only a generic non-cached document and candidate; HEAD issues nothing", async () => {
    const response = GET();
    const html = await response.text();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Strict");
    const scriptNonce = html.match(/<script nonce="([^"]+)"/u)?.[1];
    expect(scriptNonce).toBeTruthy();
    expect(response.headers.get("content-security-policy")).toContain(`script-src 'nonce-${scriptNonce}'`);
    expect(html.indexOf("history.replaceState")).toBeLessThan(html.indexOf("<body>"));
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/u);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(HEAD().headers.get("set-cookie")).toBeNull();
  });

  it("does not run account lookups in the proxy for entry or activation", async () => {
    for (const path of ["/withdraw/request", "/api/rights/activate"]) {
      const response = await proxy(new NextRequest(`https://inherit.bio${path}`));
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
    expect(mocks.authClient).not.toHaveBeenCalled();
  });

  it("reads the fragment once and clears it before deferred work; never auto-activates", async () => {
    const token = crypto.randomBytes(32).toString("base64url");
    const page = browserScript(token);
    expect(page.hashReads).toBe(1);
    expect(page.url).toBe("/withdraw/request");
    expect(page.order).toEqual(["clear", "listen"]);
    page.events.get("DOMContentLoaded")!();
    expect(page.fetch).not.toHaveBeenCalled();
    expect(page.button.disabled).toBe(false);
    expect(JSON.stringify(page.context)).not.toContain(token);
    await page.events.get("click")!();
    expect(page.fetch).toHaveBeenCalledTimes(1);
    expect(page.fetch.mock.calls[0][0]).toBe("/api/rights/activate");
    expect(JSON.parse(page.fetch.mock.calls[0][1].body)).toEqual({ token, nonce: "served-form" });
    expect(page.status.textContent).toContain("unavailable");
    await page.events.get("click")!();
    expect(page.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["", "short", "x".repeat(44), "x".repeat(100000), "<script>alert(1)</script>"])("does not submit a malformed fragment (%#)", (fragment) => {
    const page = browserScript(fragment);
    page.events.get("DOMContentLoaded")!();
    expect(page.url).toBe("/withdraw/request");
    expect(page.button.disabled).toBe(true);
    expect(page.fetch).not.toHaveBeenCalled();
  });

  it.each(["pagehide", "expire"])("discards the credential on %s", async (event) => {
    const page = browserScript(crypto.randomBytes(32).toString("base64url"));
    page.events.get("DOMContentLoaded")!();
    page.events.get(event)!();
    await page.events.get("click")!();
    expect(page.fetch).not.toHaveBeenCalled();
    expect(page.status.textContent).toContain("expired");
  });

  it("clears and reads a new same-tab fragment once without submitting on navigation", async () => {
    const page = browserScript("");
    page.events.get("DOMContentLoaded")!();
    const token = crypto.randomBytes(32).toString("base64url");
    page.navigateFragment(token);
    expect(page.url).toBe("/withdraw/request");
    expect(page.hashReads).toBe(2); // One read for each of the two navigations.
    expect(page.button.disabled).toBe(false);
    expect(page.fetch).not.toHaveBeenCalled();
    await page.events.get("click")!();
    expect(JSON.parse(page.fetch.mock.calls[0][1].body).token).toBe(token);
  });

  it("escapes script terminators in serialized form values", () => {
    expect(rightsInterstitialScript("</script>")).not.toContain("</script>");
  });
});

function request(token: string, nonce: string, cookie: string, overrides: Record<string, string> = {}) {
  return new Request("https://inherit.bio/api/rights/activate", {
    method: "POST", headers: { origin: "https://inherit.bio", "sec-fetch-site": "same-origin", "content-type": "application/json", cookie, ...overrides },
    body: JSON.stringify({ token, nonce }),
  });
}

describe("actual activation route candidate enforcement", () => {
  it("passes only hashes and the served nonce to the one-time RPC", async () => {
    const token = crypto.randomBytes(32).toString("base64url");
    const candidate = mintRightsActivationCandidate();
    mocks.rpc.mockResolvedValue({ data: [{ expires_at: new Date(Date.now() + 60000).toISOString() }], error: null });
    const response = await POST(request(token, candidate.formToken, candidate.setCookie.split(";")[0]));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/withdraw/session");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Strict");
    expect(await response.text()).toBe("");
    expect(mocks.rpc).toHaveBeenCalledWith("activate_rights_session_v1", {
      p_token_hash: invitationTokenHash(token), p_session_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      p_form_nonce: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/u),
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(token);
  });

  it.each(["missing-cookie", "wrong-cookie", "cross-origin", "same-site", "plain-text"])("rejects %s before any database call", async (mode) => {
    const candidate = mintRightsActivationCandidate();
    let cookie = candidate.setCookie.split(";")[0];
    const overrides: Record<string, string> = {};
    if (mode === "missing-cookie") cookie = "";
    if (mode === "wrong-cookie") cookie = mintRightsActivationCandidate().setCookie.split(";")[0];
    if (mode === "cross-origin") overrides.origin = "https://other.example";
    if (mode === "same-site") overrides["sec-fetch-site"] = "same-site";
    if (mode === "plain-text") overrides["content-type"] = "text/plain";
    const response = await POST(request(crypto.randomBytes(32).toString("base64url"), candidate.formToken, cookie, overrides));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
