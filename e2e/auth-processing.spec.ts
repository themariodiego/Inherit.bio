import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createConfirmedUser, signIn } from "./helpers";

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
 * REQUEST rather than the flag. `page.route` intercepts the call to
 * `/auth/v1/*` and does not release it until the assertion has run, which
 * keeps the product in a state it defines rather than simulating one. Nothing
 * here sets `pending`, stubs the component or fakes a response: the request is
 * eventually continued and the page carries on as it would have.
 *
 * WHY THE CREDENTIALS DO NOT MATTER for three of the four. The pending control
 * renders while the request is in flight, before any answer exists, so a
 * rejected sign-in reaches the same state as an accepted one and leaves
 * nothing behind. Those three create no user and write no row.
 *
 * `/auth/reset-password` IS THE EXCEPTION, and finding out why was the point
 * of running this before believing it. Its form renders without a session, so
 * it looked like the same case — but `updateUser` refuses client-side when
 * there is no session and never issues a request at all, so `onSubmit`
 * resolves at once and the pending state is never entered. The route needs a
 * real signed-in account, which this file therefore creates for that one test.
 * The lesson is the general one: a page rendering is not a request being sent.
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
) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let intercepted = 0;

  await page.route("**/auth/v1/**", async (route) => {
    intercepted += 1;
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

    expect(intercepted, "the pending state is held by a real in-flight request").toBeGreaterThan(0);
  } finally {
    // Release only. `page.unroute` here raced the held handler and made its
    // `continue` throw "Route is already handled"; the context closes with the
    // test, so removing the handler buys nothing.
    release();
  }
}

test("/auth/sign-in processing: the submit control says Working and refuses a second submission", async ({ page }) => {
  await assertPendingControl(page, "/auth/sign-in", async (target) => {
    await target.getByLabel("Email").fill(`processing-${randomUUID()}@e2e.local`);
    await target.getByLabel("Password").fill("synthetic-not-a-real-account");
  }, "Sign in");
});

test("/auth/sign-up processing: the submit control says Working and refuses a second submission", async ({ page }) => {
  await assertPendingControl(page, "/auth/sign-up", async (target) => {
    await target.getByLabel("Email").fill(`processing-${randomUUID()}@e2e.local`);
    await target.getByLabel("Password").fill("synthetic-not-a-real-account");
  }, "Sign up");
});

test("/auth/forgot-password processing: the submit control says Working and refuses a second submission", async ({ page }) => {
  await assertPendingControl(page, "/auth/forgot-password", async (target) => {
    await target.getByLabel("Email").fill(`processing-${randomUUID()}@e2e.local`);
  }, "Send reset link");
});

test("/auth/reset-password processing: the submit control says Working and refuses a second submission", async ({ page }) => {
  // The one route that needs a session; see the header. Without it
  // `updateUser` refuses before sending anything and the state never opens.
  const email = `reset-processing-${randomUUID()}@e2e.local`;
  const password = "synthetic-reset-processing-password";
  await createConfirmedUser(email, password);
  await signIn(page, email, password);

  await assertPendingControl(page, "/auth/reset-password", async (target) => {
    await target.getByLabel("New password").fill("synthetic-a-different-password");
  }, "Update password");
});
