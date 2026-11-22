import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createConfirmedUser, signIn } from "./helpers";
import { mintedOperationNonce } from "./helpers/operation-nonce";
import { accountCsrf } from "./helpers/session-csrf";

// Every page or endpoint that can read user, subject, consent, chat, file or
// derived data must carry the no-store and anti-framing header set
// (route register `sensitiveResponseHeaders.authenticatedUserData`), on
// success responses and on the proxy's own redirects alike.

const USER = { email: "headers-user@e2e.local", password: "e2e-headers-pw" };

const REQUIRED: Record<string, string> = {
  "cache-control": "private, no-store",
  "cdn-cache-control": "no-store",
  "vercel-cdn-cache-control": "no-store",
  pragma: "no-cache",
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "content-security-policy": "frame-ancestors 'none'",
  "x-frame-options": "DENY",
};

function expectSensitiveHeaders(headers: Record<string, string>, label: string, overrides: Record<string, string> = {}) {
  for (const [name, value] of Object.entries({ ...REQUIRED, ...overrides })) {
    expect(headers[name], `${label}: ${name}`).toBe(value);
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

test("signed-out request to a protected page redirects with the sensitive header set", async ({
  page,
}) => {
  const res = await page.request.get("/overview", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers()["location"]).toMatch(/\/auth\/sign-in\?next=%2Foverview/);
  // authenticated-page-signin-redirect-v1 names no-referrer for this redirect,
  // which the proxy builds itself (register wholeRouteReferrerRuleOutsideApi).
  expectSensitiveHeaders(res.headers(), "redirect", { "referrer-policy": "no-referrer" });
});

test("signed-in product pages and API responses carry the sensitive header set", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  // genome.reports is bound to two contracts that name no-referrer
  // (owned-file-redirect-response-v1, resource-not-found-page-v1), so by the
  // whole-route rule every answer of the page carries it; the other three keep
  // same-origin.
  const referrer: Record<string, string> = { "/genome/me/reports": "no-referrer" };
  for (const path of ["/overview", "/genome/me", "/genome/me/reports", "/settings"]) {
    const res = await page.request.get(path);
    expect(res.ok(), path).toBe(true);
    expectSensitiveHeaders(res.headers(), path, path in referrer ? { "referrer-policy": referrer[path]! } : {});
  }
  const api = await page.request.get("/api/export", { maxRedirects: 0 });
  // Whatever the export endpoint answers, its headers are the sensitive set,
  // with the no-referrer of `sensitiveResponseHeaderBindings.downloadOrExport`
  // (D-138 (a)): the proxy sets it, and Next keeps the proxy's header.
  expectSensitiveHeaders(api.headers(), "/api/export", { "referrer-policy": "no-referrer" });
});

/** The Referer a same-origin request made by the page's own document carries, or null when it carries none. */
async function refererOfOwnRequest(page: Page): Promise<string | null> {
  const probe = `/robots.txt?referrer-probe=${randomUUID()}`;
  const sent = page.waitForRequest(request => request.url().endsWith(probe));
  await page.evaluate(async (url) => { await fetch(url).then(response => response.arrayBuffer()).catch(() => null); }, probe);
  return (await (await sent).allHeaders()).referer ?? null;
}

// Owner decision of 22 November 2026 ("Twenty signed-in pages keep
// `same-origin`; the not-found contract's header binds its own answer"): a
// page bound only through resourceAuthorizationBindings keeps same-origin on
// its document, and its not-found answer (resource-not-found-page-v1) sets
// no-referrer for itself, so a request that document makes carries no Referer.
test("a resource-authorized page keeps same-origin, and its not-found answer sends no referrer", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  const document = await page.goto("/genome/me/ancestry");
  expect(document?.status()).toBe(200);
  expectSensitiveHeaders(await document!.allHeaders(), "genome.ancestry document");
  expect(await page.locator('head meta[name="referrer"]').count(), "no referrer element on the document").toBe(0);
  expect(await refererOfOwnRequest(page), "the document's own request carries its address").toBe(new URL("/genome/me/ancestry", page.url()).href);

  for (const path of [`/genome/s-${randomUUID()}/ancestry`, `/genome/s-${randomUUID()}/data`, `/family/s-${randomUUID()}`]) {
    const missing = await page.goto(path);
    expect(missing?.status(), path).toBe(404);
    // The proxy set every header before the page chose this answer; the answer sets its own referrer policy.
    expectSensitiveHeaders(await missing!.allHeaders(), `${path} not-found`);
    await expect(page.locator('head meta[name="referrer"]'), path).toHaveAttribute("content", "no-referrer");
    expect(await refererOfOwnRequest(page), `${path}: the not-found document's own request carries no Referer`).toBeNull();
  }
});

// Owner decision of 22 November 2026 ("Change requests are refused without
// the browser's same-origin marker, before the account is read"): the two
// routes bound to policy.sameOriginRequired refuse a request that carries no
// Sec-Fetch-Site: same-origin (Playwright's request API sends none), or one
// from another Origin, with authenticated-mutation-v1's 403; the page's own
// request, which Chromium marks, reaches the route.
test("the routes bound to policy.sameOriginRequired refuse a request without the browser's same-origin marker", async ({ page }) => {
  const accountId = await createConfirmedUser(USER.email, USER.password);
  await signIn(page, USER.email, USER.password);
  const origin = new URL(page.url()).origin;
  const file = randomUUID();
  const refused = async (label: string, response: { status(): number; json(): Promise<unknown>; headers(): Record<string, string> },
    referrer: string) => {
    expect(response.status(), label).toBe(403);
    expect(await response.json(), label).toEqual({ error: "request_forbidden" });
    expectSensitiveHeaders(response.headers(), label, { "referrer-policy": referrer });
  };
  const upload = async (headers: Record<string, string>) => page.request.post("/api/uploads", {
    headers: { "content-type": "application/json", "x-inherit-csrf": await accountCsrf(page, "api.subject-upload-issue"), ...headers }, data: {} });
  const remove = async (headers: Record<string, string>) => page.request.delete(`/api/files/${file}`, {
    headers: { "x-inherit-csrf": await accountCsrf(page, "api.file-delete"),
      "x-inherit-operation-nonce": await mintedOperationNonce(page.context(), accountId, "file_delete", file), ...headers } });
  for (const [label, headers] of [["the right Origin, no marker", { origin }], ["neither header", {}],
    ["same-site", { origin, "sec-fetch-site": "same-site" }],
    ["another Origin with the marker", { origin: "https://foreign.example", "sec-fetch-site": "same-origin" }]] as const) {
    await refused(`POST /api/uploads ${label}`, await upload(headers), "no-referrer");
    await refused(`DELETE /api/files/[id] ${label}`, await remove(headers), "same-origin");
  }
  // The page's own requests pass the rule and get each route's own answer: an
  // invalid declaration, and a file this account does not have.
  const own = await page.evaluate(async ({ file, upload, remove, nonce }) => {
    const issued = await fetch("/api/uploads", { method: "POST", headers: { "content-type": "application/json", "X-Inherit-CSRF": upload },
      body: "{}" });
    const deleted = await fetch(`/api/files/${file}`, { method: "DELETE", headers: { "X-Inherit-CSRF": remove, "X-Inherit-Operation-Nonce": nonce } });
    return { issued: { status: issued.status, body: await issued.json() }, deleted: { status: deleted.status, body: await deleted.json() } };
  }, { file, upload: await accountCsrf(page, "api.subject-upload-issue"), remove: await accountCsrf(page, "api.file-delete"),
    nonce: await mintedOperationNonce(page.context(), accountId, "file_delete", file) });
  expect(own).toEqual({ issued: { status: 422, body: { error: "invalid_request" } }, deleted: { status: 404, body: { error: "not_found" } } });
});

test("public marketing pages are not forced into the no-store profile", async ({ page }) => {
  const res = await page.request.get("/");
  expect(res.ok()).toBe(true);
  expect(res.headers()["cdn-cache-control"]).toBeUndefined();
});
