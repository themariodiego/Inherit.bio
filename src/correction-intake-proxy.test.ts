import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
const account = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => { account.read(); throw new Error("unexpected_account_read"); } }));
import { proxy, SENSITIVE_RESPONSE_HEADERS } from "./proxy";
const path = "/api/future-person/claim/session/corrections";
function strict(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("cdn-cache-control")).toBe("no-store");
  expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(response.headers.get("content-security-policy")).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/u);
}
// SOURCE ONLY / UNRUN. Actual Next response headers; no browser/native proof.
describe("correction proxy preserves accountless authority and exact headers", () => {
  it("forwards the exact correction path without an account read and uses fresh CSP on each response", async () => {
    account.read.mockClear();
    const first = await proxy(new NextRequest(`https://synthetic.invalid${path}`, { method: "POST" }));
    const second = await proxy(new NextRequest(`https://synthetic.invalid${path}`, { method: "POST" }));
    strict(first); strict(second); expect(first.headers.get("content-security-policy")).not.toBe(second.headers.get("content-security-policy"));
    expect(account.read).not.toHaveBeenCalled(); expect(first.headers.get("x-middleware-next")).toBe("1");
  });
  it("preserves the strict policy on the genuine location refusal", async () => {
    account.read.mockClear();
    const response = await proxy(new NextRequest(`https://synthetic.invalid${path}`, { method: "POST", headers: { "x-vercel-ip-country": "IR" } }));
    expect(response.status).toBe(451); strict(response); expect(account.read).not.toHaveBeenCalled();
  });
  it("keeps original sensitive headers for a neighboring rights route", async () => {
    const response = await proxy(new NextRequest(`https://synthetic.invalid${path}/extra`, { method: "POST" }));
    for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) expect(response.headers.get(name)).toBe(value);
    expect(account.read).not.toHaveBeenCalled();
  });
});
