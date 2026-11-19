import { type Page } from "@playwright/test";
import { expect, test } from "./audited-test";
import { randomUUID } from "node:crypto";
import { createConfirmedUser, latestEmailTo } from "./helpers";

/**
 * `processing` on the four `/auth/*` routes.
 *
 * WHY THIS FILE EXISTS AT ALL, because the measurement nearly went the other
 * way. Grouped by profile, `auth-flow · processing` read four pairs unproven
 * and none proven, which is the exact shape an over-declared state takes — the
 * shape that took `error` off nine profiles and `jurisdiction-unavailable` off
 * three routes. Reading the component settled it instead:
 * `src/components/auth/auth-form.tsx:63` disables the submit control and
 * renders "Working…" for as long as `onSubmit` has not resolved. The state is
 * built. It was only ever untested, and a title is what this repository counts
 * as a claim.
 *
 * HOW THE STATE IS HELD OPEN. It is genuinely transient — the pending flag is
 * cleared the moment the auth call returns — so the test holds the AUTH
 * REQUEST rather than the flag. `page.route` intercepts the form's one request
 * and does not release it until the assertion has run, which keeps the
 * product in a state it defines rather than simulating one. Nothing here sets
 * `pending`, stubs the component or fakes a response: the request is
 * eventually continued and the page carries on as it would have.
 *
 * WHICH REQUEST. Sign-in still calls the auth service's `/auth/v1/*` from the
 * browser. Sign-up, forgot-password and reset-password post to their own
 * endpoint, `/api/auth/*` (owner decision 2026-10-16), so for those three the
 * held request must be exactly that one POST, and the browser must make no
 * `/auth/v1/*` call at all: the endpoint is the only way the credentials
 * leave the page.
 *
 * WHY THE CREDENTIALS DO NOT MATTER for sign-in, sign-up and forgot-password.
 * The pending control renders while the request is in flight, before any
 * answer exists, so a rejected sign-in reaches the same state as an accepted
 * one. Sign-in and forgot-password create no user; the released sign-up
 * request creates one synthetic, unconfirmed account. Sign-up and
 * forgot-password also spend a form nonce and count a rate-limit bucket.
 *
 * `/auth/reset-password` IS THE EXCEPTION, and finding out why was the point
 * of running this before believing it. Its form renders without a session, so
 * it looks like the same case — but its endpoint answers only a reset session,
 * which only a real recovery link can issue. This file therefore creates a
 * real account for that one test and follows the real mailed link. The lesson
 * is the general one: a page rendering is not a request being sent.
 */

/**
 * Drives one form to its pending control and back. Returns nothing: the
 * assertions are the point, and they are made while the request is held.
 */
async function assertPendingControl(
  page: Page,
  path: string,
  fill: (page: Page) => Promise<void>,
  submitLabel: string,
  endpoint?: "/api/auth/sign-up" | "/api/auth/forgot-password" | "/api/auth/reset-password",
) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let intercepted = 0;
  const heldRequests: string[] = [];
  let directAuthCalls = 0;
  const observed = (request: import("@playwright/test").Request) => {
    if (new URL(request.url()).pathname.startsWith("/auth/v1/")) directAuthCalls += 1;
  };
  if (endpoint) page.on("request", observed);

  await page.route(endpoint ? `**${endpoint}` : "**/auth/v1/**", async (route) => {
    intercepted += 1;
    heldRequests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await held;
    await route.continue();
  });

  try {
    await page.goto(path);
    const submit = page.locator("form").getByRole("button", { name: submitLabel, exact: true });
    await expect(submit).toBeEnabled();
    await fill(page);
    await submit.click();

    // The control the reader sees while their credentials are in flight. Both
    // halves matter: the label tells them something is happening, and the
    // disabled state is what stops a second submission of the same form.
    const form = page.locator("form");
    const working = form.getByRole("button", { name: "Working…", exact: true });
    await expect(working).toBeVisible();
    await expect(working).toBeDisabled();
    // Scoped to the form on purpose: `/auth/sign-up` carries a "Sign in" LINK
    // to the other page, and an unscoped role query matched it. The claim is
    // that the form's own control changed, not that the words left the page.
    await expect(form.getByRole("button", { name: submitLabel, exact: true })).toHaveCount(0);

    // Nothing has been decided yet, so nothing may be said. An error message
    // rendered beside a pending control would be about the PREVIOUS attempt.
    //
    // Scoped to the form, and unscoped it is simply wrong: every Next.js page
    // carries a route announcer with `role="alert"`, so `page.getByRole("alert")`
    // resolves to one element on a page with no error at all. This assertion
    // failed on all four routes for that reason before it was scoped.
    await expect(form.getByRole("alert")).toHaveCount(0);

    // Polled rather than read once: the pending control renders before the
    // held request reaches this handler, so a single read of the count raced it.
    await expect.poll(() => intercepted, { message: "the pending state is held by a real in-flight request" }).toBeGreaterThan(0);
    if (endpoint) {
      // Exactly the endpoint's one POST, and no direct auth-service call.
      expect(heldRequests).toEqual([`POST ${endpoint}`]);
      expect(directAuthCalls, "the browser calls no /auth/v1/ endpoint itself").toBe(0);
    }
  } finally {
    if (endpoint) page.off("request", observed);
    // Release only. `page.unroute` here raced the held handler and made its
    // `continue` throw "Route is already handled"; the context closes with the
    // test, so removing the handler buys nothing.
    release();
  }
}

/** Initial forms are actual served UI, before any credentials or submission.
 * The existing audited test owns the real page and all network observations. */
async function assertInitialForm(page: Page, path: string, heading: string, labels: readonly string[], submitLabel: string) {
  let authCalls = 0;
  const observed = (request: import("@playwright/test").Request) => {
    if (new URL(request.url()).pathname.startsWith("/auth/v1/")) authCalls += 1;
  };
  page.on("request", observed);
  try {
    await page.goto(path);
    expect(new URL(page.url()).pathname).toBe(path);
    expect(new URL(page.url()).search).toBe("");
    await expect(page.locator("main h1")).toHaveText(heading);
    const form = page.locator("main form");
    await expect(form).toHaveCount(1);
    await expect(form.locator("input")).toHaveCount(labels.length);
    for (const label of labels) {
      const input = form.getByLabel(label, { exact: true });
      await expect(input).toBeVisible();
      await expect(input).toBeEnabled();
      await expect(input).toHaveValue("");
    }
    await expect(form.getByRole("button", { name: submitLabel, exact: true })).toBeVisible();
    await expect(form.getByRole("button", { name: submitLabel, exact: true })).toBeEnabled();
    await expect(form.getByRole("button", { name: "Working…", exact: true })).toHaveCount(0);
    await expect(form.getByRole("alert")).toHaveCount(0);
    expect(authCalls, "no submit or synthetic auth response supplies this state").toBe(0);
  } finally { page.off("request", observed); }
}

test("/auth/sign-in processing: the submit control says Working and refuses a second submission", async ({ page }) => {
  await test.step("/auth/sign-in initial-form: the actual served fields precede every submit", async () => {
    await assertInitialForm(page, "/auth/sign-in", "Welcome back", ["Email", "Password"], "Sign in");
  });
  await assertPendingControl(page, "/auth/sign-in", async (target) => {
    await target.getByLabel("Email").fill(`processing-${randomUUID()}@e2e.local`);
    await target.getByLabel("Password").fill("synthetic-not-a-real-account");
  }, "Sign in");
});

test("/auth/sign-up processing: the submit control says Working and refuses a second submission", async ({ page }) => {
  await test.step("/auth/sign-up initial-form: the actual served fields precede every submit", async () => {
    await assertInitialForm(page, "/auth/sign-up", "Create your account", ["Email", "Password"], "Sign up");
  });
  await assertPendingControl(page, "/auth/sign-up", async (target) => {
    await target.getByLabel("Email").fill(`processing-${randomUUID()}@e2e.local`);
    await target.getByLabel("Password").fill("synthetic-not-a-real-account");
  }, "Sign up", "/api/auth/sign-up");
});

test("/auth/forgot-password processing: the submit control says Working and refuses a second submission", async ({ page }) => {
  await test.step("/auth/forgot-password initial-form: the actual served fields precede every submit", async () => {
    await assertInitialForm(page, "/auth/forgot-password", "Reset your password", ["Email"], "Send reset link");
  });
  await assertPendingControl(page, "/auth/forgot-password", async (target) => {
    await target.getByLabel("Email").fill(`processing-${randomUUID()}@e2e.local`);
  }, "Send reset link", "/api/auth/forgot-password");
});

test("/auth/reset-password processing: the submit control says Working and refuses a second submission", async ({ page }) => {
  // The one route that needs a credential; see the header. Its endpoint
  // answers only a reset session, which only the real mailed recovery link
  // issues, so the test follows one.
  const email = `reset-processing-${randomUUID()}@e2e.local`;
  const password = "synthetic-reset-processing-password";
  await createConfirmedUser(email, password);
  await page.goto("/auth/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const mail = await latestEmailTo(email);
  const link = mail && /https?:\/\/[^\s"<>]+verify[^\s"<>]*/.exec(mail.body)?.[0];
  expect(link, "the real recovery mail must arrive").toBeTruthy();
  await page.goto(link!.replace(/&amp;/g, "&"));
  await page.waitForURL(/\/auth\/reset-password$/, { timeout: 30_000 });

  await test.step("/auth/reset-password initial-form: the reader with a reset session sees empty new-password input", async () => {
    await assertInitialForm(page, "/auth/reset-password", "Choose a new password", ["New password"], "Update password");
  });
  await assertPendingControl(page, "/auth/reset-password", async (target) => {
    await target.getByLabel("New password").fill("synthetic-a-different-password");
  }, "Update password", "/api/auth/reset-password");
});

test("auth forms without JavaScript exclude credentials from native submission", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const page = await context.newPage();
  let authRequests = 0;
  context.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/auth/v1/") || pathname.startsWith("/api/auth/")) authRequests += 1;
  });
  try {
    // The existing sign-in useSearchParams/Suspense subtree is client-only
    // on the built route. It has no initial credential form to submit.
    await page.goto("/auth/sign-in");
    await expect(page.locator("main form")).toHaveCount(0);
    await expect(page.locator("main input[name]")).toHaveCount(0);
    expect(new URL(page.url()).search).toBe("");
    for (const path of ["/auth/sign-up", "/auth/forgot-password", "/auth/reset-password"]) {
      await page.goto(path);
      const form = page.locator("form");
      await expect(form.locator("fieldset")).toHaveAttribute("disabled", "");
      await expect(form.getByRole("button")).toBeDisabled();
      for (const input of await form.locator("input").all()) await expect(input).toBeDisabled();
      await expect(form.getByText("Turn on JavaScript in your browser to use this form.", { exact: true })).toBeVisible();
      // Populate the DOM as autofill could, then exercise the browser's real
      // native entry-list/submission algorithm, with application JS disabled.
      await form.evaluate((node) => {
        for (const input of node.querySelectorAll("input")) {
          input.value = input.type === "email" ? "no-js-synthetic@e2e.local" : "synthetic-no-js-password";
        }
      });
      expect(await form.evaluate((node) => [...new FormData(node as HTMLFormElement).keys()])).toEqual([]);
      const submitted = page.waitForRequest((request) => request.isNavigationRequest());
      const navigation = page.waitForNavigation({ waitUntil: "load" });
      await form.evaluate((node) => (node as HTMLFormElement).requestSubmit());
      const request = await submitted;
      expect(request.method()).toBe("GET");
      expect(new URL(request.url()).pathname).toBe(path);
      expect(new URL(request.url()).search).toBe("");
      expect(request.postData()).toBeNull();
      const response = await navigation;
      expect(response).not.toBeNull();
      expect(response!.request()).toBe(request);
    }
    expect(authRequests).toBe(0);
  } finally {
    await context.close();
  }
});

test("/auth/forgot-password keeps credentials closed until hydration and then uses the original pending auth request", async ({ page }) => {
  let releaseScripts!: () => void;
  let releaseAuth!: () => void;
  const scriptsHeld = new Promise<void>((resolve) => { releaseScripts = resolve; });
  const authHeld = new Promise<void>((resolve) => { releaseAuth = resolve; });
  let scriptRequests = 0;
  let authRequests = 0;
  const heldRequests: string[] = [];
  let directAuthCalls = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/auth/v1/")) directAuthCalls += 1;
  });
  await page.route(/\/_next\/static\/.*\.js(?:\?.*)?$/u, async (route) => {
    scriptRequests += 1;
    await scriptsHeld;
    await route.continue();
  });
  // The page's own endpoint (owner decision 2026-10-16), not the auth service.
  await page.route("**/api/auth/forgot-password", async (route) => {
    authRequests += 1;
    heldRequests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await authHeld;
    await route.continue();
  });
  try {
    // Waiting for commit permits the server-rendered form to be inspected
    // while deferred client scripts are genuinely held at the network edge.
    await page.goto("/auth/forgot-password", { waitUntil: "commit" });
    const form = page.locator("form");
    const submit = form.getByRole("button", { name: "Send reset link", exact: true });
    await expect(form.locator("fieldset")).toHaveAttribute("disabled", "");
    await expect(form.getByLabel("Email")).toBeDisabled();
    await expect(submit).toBeDisabled();
    expect(await form.evaluate((node) => [...new FormData(node as HTMLFormElement).keys()])).toEqual([]);
    await expect.poll(() => scriptRequests).toBeGreaterThan(0);
    expect(authRequests).toBe(0);
    expect(new URL(page.url()).search).toBe("");

    releaseScripts();
    await expect(submit).toBeEnabled();
    await expect(form.getByLabel("Email")).toBeEnabled();
    await form.getByLabel("Email").fill(`hydration-${randomUUID()}@e2e.local`);
    await submit.click();
    const working = form.getByRole("button", { name: "Working…", exact: true });
    await expect(working).toBeVisible();
    await expect(working).toBeDisabled();
    await expect(form.getByRole("alert")).toHaveCount(0);
    await expect.poll(() => authRequests).toBeGreaterThan(0);
    expect(heldRequests).toEqual(["POST /api/auth/forgot-password"]);
    expect(directAuthCalls, "the browser calls no /auth/v1/ endpoint itself").toBe(0);
    expect(new URL(page.url()).pathname).toBe("/auth/forgot-password");
    expect(new URL(page.url()).search).toBe("");
  } finally {
    releaseScripts();
    releaseAuth();
  }
});
