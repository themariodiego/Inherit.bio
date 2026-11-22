import { type Page } from "@playwright/test";
import { expect, test } from "./audited-test";
import { randomUUID } from "node:crypto";
import { completeOwnUploadConsent, createConfirmedUser, signIn } from "./helpers";
import { allowCopilot } from "./fixtures/canonical-copilot-browser";
import { refusalFor } from "../src/copy/copilot/refusals";

/**
 * `empty` and `processing` on `/copilot/[scope]`, on the own chat.
 *
 * Until 24 October 2026 both were proven on the compatibility panel, which
 * this route served to an account whose subject had no canonical Copilot
 * scope. That panel is retired with its `api.chat` branch (G8.5): every self
 * subject is answered by the own chat, which renders a composer only once the
 * person has signed their own upload consent and allowed Copilot for the saved
 * model. Before that the page names the missing step instead
 * (`consent-required`, proven in e2e/copilot.spec.ts and the density
 * fixture). So each test here signs the upload consent and grants the
 * permission through the real screens first. No file is uploaded.
 *
 * WHICH RENDER IS `empty`. With no provider saved the route shows setup
 * instructions instead of a panel; that is a different thing and is not
 * claimed here. `empty` is the panel itself with no turns in it: the
 * conversation can start and has nothing in it yet, which is what `empty`
 * means everywhere else in this register.
 *
 * The endpoint is the synthetic cloud address `e2e/settings.spec.ts` uses and
 * explains: an IP literal, because `resolveModelEndpoint` skips DNS for one
 * and no hostname resolves in both environments this suite runs in. Nothing
 * connects to it. The question held in `processing` is one the intent gate
 * refuses, so the product answers it with its fixed refusal before any
 * provider step, and the request under assertion is still a real one the
 * product sent and answered.
 */

const SYNTHETIC_CLOUD_ENDPOINT = "https://203.0.114.10:8123/v1";
const SYNTHETIC_PROVIDER_KEY = "203.0.114.10:8123";
const GATED_QUESTION = "What dosage of vitamin D should I take?";
const THREAD_HINT = "Ask about your own file or a report you chose. Answers explain what was found, its sources, and what remains unknown.";

async function signInWithPermittedCloudProvider(page: Page): Promise<void> {
  const email = `copilot-scope-${randomUUID()}@e2e.local`;
  const password = "synthetic-copilot-scope-password";
  await createConfirmedUser(email, password);
  await signIn(page, email, password);
  await completeOwnUploadConsent(page);

  await page.goto("/settings/copilot");
  await page.getByLabel("Provider", { exact: true }).click();
  await page.getByRole("option", { name: /OpenAI-compatible/ }).click();
  await page.getByLabel("Base URL").fill(SYNTHETIC_CLOUD_ENDPOINT);
  await page.getByLabel("Model", { exact: true }).fill("synthetic-model");
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect(page.getByText("Provider saved. Review the separate Copilot permission below.", { exact: true }))
    .toBeVisible();
  await allowCopilot(page);
}

test("/copilot/[scope] empty: the panel opens with no turns, says what it can be asked, and names where answers go", async ({ page }) => {
  await signInWithPermittedCloudProvider(page);
  await page.goto("/copilot/me");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ask about You");

  // No turns yet, and the panel says what it is for rather than sitting blank.
  await expect(page.getByText(THREAD_HINT, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Message the copilot")).toBeEnabled();

  // The empty conversation still names its recipient. This is the assertion
  // worth having: a cloud provider is configured, so the reader must be told
  // where their questions would go BEFORE they type one, not after.
  const indicator = page.getByTestId("data-flow-indicator");
  await expect(indicator).toContainText("Cloud mode");
  await expect(indicator).toContainText(SYNTHETIC_PROVIDER_KEY);
  await expect(indicator.getByRole("link", { name: "Review or withdraw permission" }))
    .toHaveAttribute("href", "/settings/copilot");

  // Empty means empty: no answer, no refusal, no error sitting in the panel.
  // Scoped to `main`, and unscoped it is simply wrong: every Next.js page
  // carries a route announcer with `role="alert"`, so an unscoped query
  // resolves to one element on a page with no alert at all. This is the
  // second time that has cost a run; `e2e/auth-processing.spec.ts` records
  // the first.
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(page.locator('[data-role="user"], [data-role="assistant"]')).toHaveCount(0);
  await expect(page.getByText("Checking your question…", { exact: true })).toHaveCount(0);
});

test("/copilot/[scope] processing: the panel says it is checking while the question is in flight", async ({ page }) => {
  await signInWithPermittedCloudProvider(page);

  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let intercepted = 0;
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    intercepted += 1;
    await held;
    await route.continue();
  });

  try {
    await page.goto("/copilot/me");
    const composer = page.getByLabel("Message the copilot");
    await composer.fill(GATED_QUESTION);
    await page.getByRole("button", { name: "Send", exact: true }).click();

    await expect(page.getByText("Checking your question…", { exact: true })).toBeVisible();
    // The reader's question is still in front of them while they wait, and
    // nothing can be sent on top of it.
    await expect(composer).toHaveValue(GATED_QUESTION);
    await expect(composer).toBeDisabled();
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    // Nothing has been answered, so nothing may be said about the answer.
    // Scoped for the route-announcer reason given above.
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    await expect(page.locator('[data-role="assistant"]')).toHaveCount(0);
    await expect.poll(() => intercepted, { message: "the state is held by a real in-flight question" }).toBeGreaterThan(0);
  } finally {
    release();
  }

  // Released: the product's own intent gate answers, which is what the
  // question was always going to meet. Asserted so the test says where it
  // left the reader rather than abandoning them mid-request.
  await expect(page.locator('[data-role="assistant"]')).toContainText(refusalFor("treatment", "You"));
  await expect(page.locator('[data-role="user"]')).toHaveText(GATED_QUESTION);
  await expect(page.getByText("Checking your question…", { exact: true })).toHaveCount(0);
});
