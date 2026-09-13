import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createConfirmedUser, signIn } from "./helpers";

/**
 * `empty` and `processing` on `/copilot/[scope]`.
 *
 * BOTH ARE REACHABLE FOR THE FIRST TIME TODAY. This route serves the
 * compatibility panel to an account whose subject has no canonical Copilot
 * scope yet, and that panel could not send a single message until the chat
 * route's body schema was fixed earlier in this run — `DefaultChatTransport`
 * posts `{ id, messages, trigger }` and the schema admitted `messages` alone.
 * `processing` in particular could not have been proven before: the panel
 * never reached a request in flight, only an immediate 400.
 *
 * WHICH RENDER IS `empty`. With no provider saved the route shows setup
 * instructions instead of a panel; that is a different thing and is not
 * claimed here. `empty` is the panel itself with no turns in it — the
 * conversation exists and has nothing in it yet, which is what `empty` means
 * everywhere else in this register.
 *
 * The endpoint is the synthetic cloud address `e2e/settings.spec.ts` uses and
 * explains: an IP literal, because `resolveModelEndpoint` skips DNS for one
 * and no hostname resolves in both environments this suite runs in. Nothing
 * connects to it — the consent gate refuses before any model step, which is
 * exactly what keeps `processing` honest here: the request under assertion is
 * a real one the product sent, and it is answered by the product's own gate.
 */

const SYNTHETIC_CLOUD_ENDPOINT = "https://203.0.114.10:8123/v1";

async function signInWithCloudProvider(page: Page): Promise<void> {
  const email = `copilot-scope-${randomUUID()}@e2e.local`;
  const password = "synthetic-copilot-scope-password";
  await createConfirmedUser(email, password);
  await signIn(page, email, password);

  await page.goto("/settings/copilot");
  await page.getByLabel("Provider", { exact: true }).click();
  await page.getByRole("option", { name: /OpenAI-compatible/ }).click();
  await page.getByLabel("Base URL").fill(SYNTHETIC_CLOUD_ENDPOINT);
  await page.getByLabel("Model", { exact: true }).fill("synthetic-model");
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect(page.getByText("Provider saved. Review the separate Copilot permission below.", { exact: true }))
    .toBeVisible();
}

test("/copilot/[scope] empty: the panel opens with no turns, says what it can be asked, and names where answers go", async ({ page }) => {
  await signInWithCloudProvider(page);
  await page.goto("/copilot/me");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ask about You");

  // No turns yet, and the panel says what it is for rather than sitting blank.
  await expect(page.getByText("Ask about your own genome. Try:", { exact: false })).toBeVisible();
  await expect(page.getByText("The copilot is informational — never a diagnosis", { exact: false }))
    .toBeVisible();

  // The empty conversation still names its recipient. This is the assertion
  // worth having: a cloud provider is configured, so the reader must be told
  // where their questions would go BEFORE they type one, not after.
  const indicator = page.getByTestId("data-flow-indicator");
  await expect(indicator).toContainText("Cloud mode");
  await expect(indicator).toContainText("203.0.114.10:8123");
  await expect(indicator.getByRole("link", { name: "revoke in Settings" }))
    .toHaveAttribute("href", "/settings/copilot");

  // Empty means empty: no answer, no refusal, no error sitting in the panel.
  // Scoped to `main`, and unscoped it is simply wrong: every Next.js page
  // carries a route announcer with `role="alert"`, so an unscoped query
  // resolves to one element on a page with no alert at all. This is the
  // second time that has cost a run; `e2e/auth-processing.spec.ts` records
  // the first.
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Thinking…", { exact: true })).toHaveCount(0);
});

test("/copilot/[scope] processing: the panel says Thinking while the question is in flight", async ({ page }) => {
  await signInWithCloudProvider(page);

  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let intercepted = 0;
  await page.route("**/api/chat**", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    intercepted += 1;
    await held;
    await route.continue();
  });

  try {
    await page.goto("/copilot/me");
    await page.getByLabel("Message the copilot").fill("What is my caffeine genotype?");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    await expect(page.getByText("Thinking…", { exact: true })).toBeVisible();
    // The reader's own turn is already on screen while they wait, so the
    // panel is not simply blank with a word under it.
    await expect(page.getByText("What is my caffeine genotype?", { exact: true })).toBeVisible();
    // Nothing has been answered, so nothing may be said about the answer.
    // Scoped for the route-announcer reason given above.
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Review what would be shared", exact: true }))
      .toHaveCount(0);
    expect(intercepted, "the state is held by a real in-flight question").toBeGreaterThan(0);
  } finally {
    release();
  }

  // Released: the product's own consent gate answers, which is what the
  // question was always going to meet. Asserted so the test says where it
  // left the reader rather than abandoning them mid-request.
  await expect(page.getByRole("button", { name: "Review what would be shared", exact: true }))
    .toBeVisible();
});
