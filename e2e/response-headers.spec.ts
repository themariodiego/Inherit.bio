import { expect, test } from "@playwright/test";
import { createConfirmedUser, signIn } from "./helpers";

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

function expectSensitiveHeaders(headers: Record<string, string>, label: string) {
  for (const [name, value] of Object.entries(REQUIRED)) {
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
  expectSensitiveHeaders(res.headers(), "redirect");
});

test("signed-in product pages and API responses carry the sensitive header set", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  for (const path of ["/overview", "/genome/me", "/genome/me/reports", "/settings"]) {
    const res = await page.request.get(path);
    expect(res.ok(), path).toBe(true);
    expectSensitiveHeaders(res.headers(), path);
  }
  const api = await page.request.get("/api/export", { maxRedirects: 0 });
  // Whatever the export endpoint answers, its headers are the sensitive set.
  expectSensitiveHeaders(api.headers(), "/api/export");
});

test("public marketing pages are not forced into the no-store profile", async ({ page }) => {
  const res = await page.request.get("/");
  expect(res.ok()).toBe(true);
  expect(res.headers()["cdn-cache-control"]).toBeUndefined();
});
