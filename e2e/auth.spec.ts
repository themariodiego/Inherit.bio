import { expect, test } from "@playwright/test";
import { adminClient, clearMailbox, latestEmailTo } from "./helpers";

// A2 — the real email flows: sign-up → verification email → verified
// session; password reset → new password works. Emails are captured by the
// local stack's Mailpit (production uses Resend SMTP; same templates).

const USER = { email: "authflow@e2e.local", password: "e2e-auth-pw-1" };

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
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
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
  await page.waitForURL(/\/dashboard/);

  // The new password signs in from a fresh context.
  await page.request.post("/auth/sign-out");
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(USER.email);
  await page.getByLabel("Password").fill(newPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
});
