import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

/**
 * `complete` on the two `/auth/*` routes that have it — and the measurement
 * is half the point, because the profile declares it on four.
 *
 * `/auth/sign-up` and `/auth/forgot-password` each replace their form with a
 * "Check your email" panel: a real, named, rendered outcome of the route.
 *
 * `/auth/sign-in` AND `/auth/reset-password` DO NOT. Both call
 * `router.push()` on success and never render an outcome of their own
 * (`sign-in/page.tsx:39`, `reset-password/page.tsx:30`), so the reader's next
 * screen belongs to another route. A page that navigates away has no complete
 * state to prove, and titling one would certify a render that does not exist —
 * the same mistake `/settings/people jurisdiction-unavailable` made. Those two
 * are proposed not-applicable in corrections item 10 rather than claimed here.
 *
 * Both tests assert what the sentence CLAIMS, not merely that it renders. The
 * repository's rule is that a title is a claim; the same standard should apply
 * to the product's own sentences.
 */

test("/auth/sign-up complete: the account is not usable yet, and the page says exactly that", async ({ page }) => {
  const email = `signup-complete-${randomUUID()}@e2e.local`;
  const password = "synthetic-sign-up-complete-password";

  await page.goto("/auth/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  // The address is echoed here, and that is safe: the reader just typed it.
  await expect(page.getByText(email, { exact: false })).toBeVisible();
  await expect(page.getByText("Open it to activate your account", { exact: false })).toBeVisible();
  // The outcome REPLACES the form rather than sitting beside it, so a second
  // submission of the same address is not one click away.
  await expect(page.getByRole("button", { name: "Sign up", exact: true })).toHaveCount(0);

  // The claim, checked rather than read: "activate" means the account cannot
  // be used yet. Signing in with the exact credentials just chosen is refused.
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/sign-in/);
});

test("/auth/forgot-password complete: the confirmation does not say whether the address has an account", async ({ page }) => {
  // Deliberately an address with no account. The page must answer the same way
  // it would for a real one, or the confirmation becomes an enumeration oracle.
  const unknown = `forgot-complete-no-such-account-${randomUUID()}@e2e.local`;

  await page.goto("/auth/forgot-password");
  await page.getByLabel("Email").fill(unknown);
  await page.getByRole("button", { name: "Send reset link", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByText(
    "If that address has an account, a password-reset link is on its way.", { exact: true },
  )).toBeVisible();
  // The property that sentence exists for: no account was found, and the page
  // says nothing either way. It does not echo the address back, unlike
  // sign-up, where echoing is safe because the reader is creating that account.
  await expect(page.getByText(unknown, { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send reset link", exact: true })).toHaveCount(0);
});
