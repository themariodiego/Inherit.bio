import { expect, test } from "@playwright/test";
import { SIGN_IN_ERRORS, SIGN_IN_STATUS } from "../src/copy/sign-in";
import { adminClient, clearMailbox, latestEmailTo } from "./helpers";

// A2 — the real email flows: sign-up → verification email → verified
// session; password reset → new password works. Emails are captured by the
// local stack's Mailpit (production uses Resend SMTP; same templates).

const USER = {
  email: `authflow-${Date.now()}@e2e.local`,
  password: "e2e-auth-pw-1",
};

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const admin = adminClient();
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list?.users.find((u) => u.email === USER.email);
  if (existing) await admin.auth.admin.deleteUser(existing.id);
  await clearMailbox();
});

test("sign-up sends a verification email; the link yields a signed-in session", async ({
  page,
}) => {
  await page.goto("/auth/sign-up");
  await page.getByLabel("Email").fill(USER.email);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  const mail = await latestEmailTo(USER.email);
  expect(mail, "verification email must arrive").not.toBeNull();
  const link = /https?:\/\/[^\s"<>]+verify[^\s"<>]*/.exec(mail!.body)?.[0];
  expect(link, "verification link must be present").toBeTruthy();

  await page.goto(link!.replace(/&amp;/g, "&"));
  // G5.1a: the first sign-in answers where the person lives before any product
  // page, from a required selection with nothing chosen for them.
  await page.waitForURL(/\/settings\?next=/, { timeout: 30_000 });
  await expect(page.locator("main").getByText(USER.email, { exact: true })).toBeVisible();
  const country = page.getByLabel("Country you live in");
  await expect(country).toHaveValue("");
  await expect(country).toHaveAttribute("required", "");
  await country.selectOption("DE");
  await page.getByLabel("The country I chose is the country I live in.").check();
  await page.getByRole("button", { name: "Save country" }).click();
  await page.waitForURL(/\/(?:dashboard|overview)/, { timeout: 30_000 });
  await expect(page.getByText(USER.email)).toBeVisible();
});

test("password reset flow works end-to-end", async ({ page }) => {
  await clearMailbox();
  await page.goto("/auth/forgot-password");
  await page.getByLabel("Email").fill(USER.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  const mail = await latestEmailTo(USER.email);
  expect(mail).not.toBeNull();
  const link = /https?:\/\/[^\s"<>]+verify[^\s"<>]*/.exec(mail!.body)?.[0];
  expect(link).toBeTruthy();

  await page.goto(link!.replace(/&amp;/g, "&"));
  await page.waitForURL(/\/auth\/reset-password/, { timeout: 30_000 });
  const newPassword = "e2e-auth-pw-2";
  await page.getByLabel("New password").fill(newPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await page.waitForURL(/\/(?:dashboard|overview)/);

  // The new password signs in from a fresh context.
  await page.request.post("/auth/sign-out");
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(USER.email);
  await page.getByLabel("Password").fill(newPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(?:dashboard|overview)/);
});

test("a sign-up link opened in another browser confirms the email and says so", async ({
  page,
  browser,
}) => {
  const other = { email: `authflow-other-${Date.now()}@e2e.local`, password: "e2e-auth-pw-3" };
  await page.goto("/auth/sign-up");
  await page.getByLabel("Email").fill(other.email);
  await page.getByLabel("Password").fill(other.password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  const mail = await latestEmailTo(other.email);
  expect(mail, "verification email must arrive").not.toBeNull();
  const link = /https?:\/\/[^\s"<>]+verify[^\s"<>]*/.exec(mail!.body)?.[0]?.replace(/&amp;/g, "&");
  expect(link, "verification link must be present").toBeTruthy();

  // A second context holds no PKCE verifier for this flow, like a phone
  // opening the mail after signing up on a laptop. Supabase still confirms
  // the address, so the page says so instead of a bare sign-in form.
  const elsewhere = await browser.newContext();
  try {
    const phone = await elsewhere.newPage();
    await phone.goto(link!);
    await phone.waitForURL(/\/auth\/sign-in\?notice=email_confirmed/, { timeout: 30_000 });
    await expect(phone.locator("main").getByRole("status")).toHaveText(SIGN_IN_STATUS.email_confirmed);

    // The link is now used: `/verify` refuses it, even in the browser that
    // signed up, and the page says why instead of echoing Supabase's text.
    await page.goto(link!);
    await page.waitForURL(/\/auth\/sign-in\?error=link_expired#?$/, { timeout: 30_000 });
    await expect(page.locator("main").getByRole("alert")).toHaveText(SIGN_IN_ERRORS.link_expired);
    // `/verify` wrote its own error text into the fragment it redirected to;
    // the callback's empty fragment keeps that text out of the address bar.
    expect(new URL(page.url()).hash).toBe("");
    expect(page.url()).not.toContain("error_description");

    // The notice is true: the password chosen at sign-up now works.
    await phone.getByLabel("Email").fill(other.email);
    await phone.getByLabel("Password").fill(other.password);
    await phone.getByRole("button", { name: "Sign in", exact: true }).click();
    await phone.waitForURL(/\/settings\?next=/, { timeout: 30_000 });
  } finally {
    await elsewhere.close();
  }
});
