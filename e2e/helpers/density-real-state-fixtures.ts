import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import { createConfirmedUser, signIn } from "../helpers";
import { latestEmailTo } from "../helpers";
import { DOCUMENTS } from "../accessibility-sweeps";
import { densityCapturePlan, type DensityStateCase } from "../../scripts/density-capture-plan";
import type { DensityRegister } from "../../scripts/density-current";
import type { DensityStateFixture } from "./density-current-capture";

/** Actual provider wiring, not a collection of images or state labels.
 * Other routes need their existing real journey wired at its native assertion
 * boundary. An absent provider keeps the complete capture in HOLD. */
export function realPublicAndAuthDensityFixtures(input: {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  observeState: (row: DensityStateCase, page: Page, fixtureSourceSha256: string) => Promise<unknown>;
}): DensityStateFixture[] {
  const origin = new URL(input.origin);
  assert(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)
    && origin.pathname === "/" && !origin.search && !origin.hash && !origin.username && !origin.password,
  "Existing disposable local app required");
  const sourcePath = "e2e/helpers/density-real-state-fixtures.ts";
  const sourceSha256 = createHash("sha256").update(fs.readFileSync(path.join(input.root, sourcePath))).digest("hex");
  const auth: Record<string, { path: string; submit: string; password?: string; reset?: boolean }> = {
    "auth.sign-in": { path: "/auth/sign-in", submit: "Sign in", password: "synthetic-not-a-real-account" },
    "auth.sign-up": { path: "/auth/sign-up", submit: "Sign up", password: "synthetic-not-a-real-account" },
    "auth.forgot-password": { path: "/auth/forgot-password", submit: "Send reset link" },
    "auth.reset-password": { path: "/auth/reset-password", submit: "Update password", reset: true },
  };
  const fixtures: DensityStateFixture[] = [];
  for (const row of densityCapturePlan(input.register, []).states) {
    const route = row.route;
    const documentPath = DOCUMENTS[route.path];
    const publicDocument = row.state === "complete" && route.auth === "public"
      && (route.stateProfile === "static-document" || route.stateProfile === "versioned-document"
        || route.stateProfile === "public-rights-flow")
      && (!route.path.includes("[") || documentPath);
    const embryoUnavailable = route.id === "marketing.embryo-analysis" && route.path === "/embryo-analysis"
      && route.auth === "public" && route.stateProfile === "public-embryo-analysis"
      && row.state === "jurisdiction-unavailable";
    const form = auth[route.id];
    const authForm = form && route.path === form.path && route.auth === "public"
      && route.stateProfile === "auth-density-flow"
      && ["initial-form", "processing", "complete"].includes(row.state);
    if (!publicDocument && !authForm && !embryoUnavailable) continue;
    fixtures.push({ routeId: route.id, state: row.state, sourcePath, sourceSha256,
      withState: async ({ viewport }, capture) => {
        const context = await input.browser.newContext({ baseURL: origin.origin,
          viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1,
          colorScheme: "light", reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
        const page = await context.newPage();
        let release: (() => void) | undefined;
        let continuation: Promise<void> | undefined;
        try {
          const address = `density-auth-${randomUUID()}@e2e.local`;
          if (form?.reset || (route.id === "auth.forgot-password" && row.state === "complete")) {
            const password = "synthetic-reset-processing-password";
            await createConfirmedUser(address, password);
            if (form?.reset) await signIn(page, address, password); // Existing real native session; no injected storage state.
          }
          if (authForm && row.state === "processing") {
            const held = new Promise<void>(resolve => { release = resolve; });
            let intercepted = 0;
            await page.route("**/auth/v1/**", async request => {
              intercepted += 1;
              // Only an actual intercepted request creates settlement work.
              // A failed navigation must not await a request that never began.
              continuation = (async () => {
                await held;
                try {
                  await request.continue();
                  const response = await request.request().response();
                  assert(response && await response.finished() === null,
                    "Original density auth response did not settle");
                } catch { throw new Error("Original density auth request did not settle"); }
              })();
              void continuation.catch(() => {});
              await continuation;
            }, { times: 1 });
            const response = await page.goto(form.path, { waitUntil: "domcontentloaded" });
            expect(response?.status()).toBe(200);
            if (form.reset) await page.getByLabel("New password").fill("synthetic-a-different-password");
            else {
              await page.getByLabel("Email").fill(address);
              if (form.password) await page.getByLabel("Password").fill(form.password);
            }
            const submit = page.locator("form").getByRole("button", { name: form.submit, exact: true });
            await expect(submit).toBeEnabled();
            await submit.click();
            const observe = async () => {
              const working = page.locator("form").getByRole("button", { name: "Working…", exact: true });
              await expect(working).toBeVisible(); await expect(working).toBeDisabled();
              await expect(page.locator("form").getByRole("alert")).toHaveCount(0);
              await expect(page.locator("form").getByRole("button", { name: form.submit, exact: true })).toHaveCount(0);
              await expect.poll(() => intercepted).toBe(1);
              return input.observeState(row, page, sourceSha256);
            };
            await observe();
            await capture({ page, observe }); // Both native/UI checks run again around the actual PNG.
          } else if (authForm && row.state === "complete") {
            // Only sign-up and forgot-password have an outcome on this page.
            // Keep the original sign-in/reset redirect waivers unchanged.
            assert(["auth.sign-up", "auth.forgot-password"].includes(route.id), "Actual on-page auth outcome required");
            const response = await page.goto(form.path, { waitUntil: "domcontentloaded" });
            expect(response?.status()).toBe(200);
            await page.getByLabel("Email").fill(address);
            if (form.password) await page.getByLabel("Password").fill(form.password);
            const originalReply = page.waitForResponse(reply => {
              const url = new URL(reply.url());
              return reply.request().method() === "POST"
                && url.pathname === (route.id === "auth.sign-up" ? "/auth/v1/signup" : "/auth/v1/recover");
            });
            await page.locator("form").getByRole("button", { name: form.submit, exact: true }).click();
            const reply = await originalReply;
            expect(reply.ok()).toBe(true); expect(await reply.finished()).toBeNull();
            const mail = await latestEmailTo(address);
            assert(mail && /https?:\/\/[^\s"<>]+verify[^\s"<>]*/u.test(mail.body), "Actual original auth mail required");
            const mailSha256 = createHash("sha256").update(mail.body).digest("hex");
            const observe = async () => {
              expect(new URL(page.url()).pathname).toBe(form.path);
              await expect(page.locator("main h1")).toHaveText("Check your email");
              if (route.id === "auth.sign-up") {
                await expect(page.locator("main")).toContainText(`We sent a verification link to ${address}. Open it to activate your account.`);
              } else await expect(page.locator("main")).toContainText("If that address has an account, a password-reset link is on its way.");
              await expect(page.locator("main form, main [role=alert]")).toHaveCount(0);
              assert(createHash("sha256").update(fs.readFileSync(path.join(input.root, sourcePath))).digest("hex") === sourceSha256,
                "Reviewed auth outcome source changed");
              const currentMail = await latestEmailTo(address);
              assert(currentMail && createHash("sha256").update(currentMail.body).digest("hex") === mailSha256,
                "Actual auth receipt mail changed");
              return input.observeState(row, page, sourceSha256);
            };
            await observe(); await capture({ page, observe }); await observe();
          } else {
            const navigation = form?.path ?? documentPath ?? route.path;
            const response = await page.goto(navigation, { waitUntil: "domcontentloaded" });
            expect(response?.status()).toBe(200);
            const observe = async () => {
              await expect(page.getByRole("main")).toHaveCount(1);
              await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
              if (embryoUnavailable) {
                await expect(page.getByRole("heading", { level: 1, exact: true,
                  name: "A bounded record, held for a future person." })).toBeVisible();
                await expect(page.getByRole("heading", { level: 2 })).toHaveText([
                  "Not available in any production jurisdiction yet", "If a child is born from this"]);
                for (const text of [
                  "Inherit can explain supported findings on non-sex chromosomes. It does not rank embryos, suggest which embryo to transfer, predict sex, or guess when data is missing.",
                  "Embryo tools need a review by a legal expert and a list of approved conditions. Neither is ready, so these tools stay off on the hosted service.",
                  "Embryo scores that add up many small effects are for research only. Inherit will not offer them as a service.",
                  "The record belongs to the future person. They retain rights to know, not know, correct, export, restrict analysis, and delete it.",
                ]) await expect(page.getByText(text, { exact: true })).toBeVisible();
                await expect(page.getByRole("link", { name: "Read the Future Person Charter", exact: true }))
                  .toHaveAttribute("href", "/legal/future-person");
                await expect(page.getByRole("link", { name: "Open Inherit", exact: true })).toHaveAttribute("href", "/overview");
                await expect(page.locator("main form, main [data-figure-kind], main [data-personal-preview]")).toHaveCount(0);
              }
              if (authForm) {
                expect(row.state).toBe("initial-form");
                const heading: Record<string, string> = { "auth.sign-in": "Welcome back", "auth.sign-up": "Create your account",
                  "auth.forgot-password": "Reset your password", "auth.reset-password": "Choose a new password" };
                await expect(page.locator("main h1")).toHaveText(heading[route.id]);
                const actual = page.locator("form");
                await expect(actual).toHaveCount(1);
                await expect(actual.getByRole("button", { name: form.submit, exact: true })).toBeEnabled();
                await expect(actual.getByRole("button", { name: "Working…", exact: true })).toHaveCount(0);
                await expect(actual.getByRole("alert")).toHaveCount(0);
                for (const field of await actual.locator("input").all()) await expect(field).toHaveValue("");
                await expect(page.getByRole("heading", { name: "Check your email", exact: true })).toHaveCount(0);
              }
              return input.observeState(row, page, sourceSha256);
            };
            await observe(); await capture({ page, observe });
          }
        } finally {
          // Continue the original request. No synthetic reply, abort, pending
          // flag, DOM replacement, retry or native status update is permitted.
          release?.();
          try { if (continuation) await continuation; } finally { await context.close(); }
        }
      } });
  }
  return fixtures;
}
