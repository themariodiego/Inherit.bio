import { randomUUID } from "node:crypto";
import { expect, test } from "./audited-test";
import { createConfirmedUser, signIn } from "./helpers";
import { COPY_IDS, FAMILY_SCOPE_LABEL } from "../src/copy/copilot/group-scopes";
import { HUB_TILES } from "../src/copy/family/index";
import { grantAnalysis, seedPublishedCohort } from "./cohort-copilot-seed";

/**
 * The Copilot group scopes on a deployment that cannot run a local model:
 * this suite's main app, which runs under TEST-LOCAL and attests no same-host
 * model. That is the transport case the register writes down
 * (`copilot-transport-availability-v1`,
 * `true-non-self.hostedCloudRemoteOrUnverified`): the Family Overview box and
 * the Family hub's Copilot tile open `/copilot/family`, and it renders the
 * closed unavailable page with no context, composer, history or group data.
 * The Family scope is built on every deployment since 2026-09-28 (PR #260);
 * the hosted case itself, with the TEST-LOCAL flag unset, is
 * `e2e/copilot-group-scopes.nojurisdiction.spec.ts`. The cohort scope is
 * designed but not built, so the Embryos box stays on its hub and an
 * unreadable cohort segment is the same 404 as an unknown one.
 *
 * The local-model journey itself is `e2e/copilot-family.spec.ts`, on the one
 * app variant that attests a same-host model.
 */

const USER = { email: `copilot-groups-${randomUUID()}@e2e.local`, password: "e2e-copilot-groups-pw" };

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

test("the Family Copilot box opens the Family group scope, which says plainly why it cannot run here and reads nothing", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/overview");
  // Overview gives each box's label the DOM id `box-{id with dots as dashes}-label`.
  const box = page.locator('[data-overview-box] a[aria-labelledby="box-family-copilot-label"]');
  await expect(box).toHaveAttribute("href", "/copilot/family");
  // The embryo cohort scope is not built: its box keeps landing on the hub.
  await expect(page.locator('[data-overview-box] a[aria-labelledby="box-embryos-copilot-label"]'))
    .toHaveAttribute("href", "/embryos");

  const context = page.waitForResponse(response => new URL(response.url()).pathname === "/copilot/family");
  await box.click();
  expect((await context).status()).toBe(200);
  const unavailable = page.locator('[data-slot="copilot-local-unavailable"]');
  await expect(unavailable).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(COPY_IDS["copilot.transport.local-unavailable.heading"]);
  await expect(unavailable.getByText(COPY_IDS["copilot.transport.local-unavailable.reason"], { exact: true })).toBeVisible();
  await expect(unavailable.getByText(COPY_IDS["copilot.transport.local-unavailable.requirement"], { exact: true })).toBeVisible();
  await expect(unavailable.getByRole("link", { name: COPY_IDS["actions.back"], exact: true })).toHaveAttribute("href", "/overview");

  // The closed projection: no composer, no conversation, no group, no model.
  await expect(page.getByLabel("Message the copilot")).toHaveCount(0);
  await expect(page.getByTestId("data-flow-indicator")).toHaveCount(0);
  await expect(page.getByText(`Ask about ${FAMILY_SCOPE_LABEL}`)).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toContain("family-context");
  expect(html).not.toMatch(/contextToken/);

  await page.getByRole("link", { name: COPY_IDS["actions.back"], exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
});

test("the Family hub's Copilot tile opens the Family scope too, which says plainly why it cannot run here", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/family");
  const tile = page.locator('[data-tile="copilot"]');
  const link = tile.getByRole("link", { name: HUB_TILES.find((entry) => entry.id === "copilot")!.label, exact: true });
  await expect(link).toHaveAttribute("href", "/copilot/family");
  await expect(tile.locator('[data-slot="tile-blocked"]')).toHaveCount(0);
  await link.click();
  await expect(page).toHaveURL(/\/copilot\/family$/);
  await expect(page.locator('[data-slot="copilot-local-unavailable"]')).toBeVisible();
  await expect(page.getByLabel("Message the copilot")).toHaveCount(0);
});

test("a chat request for the Family scope is refused here before any read, with the registered body", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/overview");
  // No page on this deployment mints a Family context, so a forged one is
  // not even recognised as Family; the own scope then refuses it as well.
  const response = await page.request.post("/api/chat", { headers: { origin: new URL(page.url()).origin },
    data: { contextToken: "forged-family-context-token-value", message: "What did they share?" } });
  expect([403, 404]).toContain(response.status());
  expect(await response.text()).not.toContain("What did they share?");
});

test("the cohort and report scopes answer 404 for a cohort or report this account cannot read, like any unknown scope", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  for (const segment of [`c-${randomUUID()}`, `r-${randomUUID()}`, "families", `c-${randomUUID().toUpperCase()}`]) {
    const response = await page.goto(`/copilot/${segment}`);
    expect(response?.status(), segment).toBe(404);
    await expect(page.locator('[data-slot="copilot-local-unavailable"]')).toHaveCount(0);
  }
});

/**
 * The cohort scope is built under TEST-LOCAL (2026-09-28). An account with a
 * readable cohort gets the Embryos box and hub tile opening that cohort's
 * scope, and on this variant, which attests no same-host model, that page is
 * the registered unavailable page: nothing else about the cohort is read.
 */
test("with a readable cohort, the Embryos Copilot box and tile open its scope, which says plainly why it cannot run here", async ({ page }) => {
  const parent = { email: `copilot-groups-cohort-${randomUUID()}@e2e.local`, password: "e2e-copilot-groups-pw" };
  const accountId = await createConfirmedUser(parent.email, parent.password);
  const { cohortId } = await seedPublishedCohort({ owner: accountId, parents: [accountId],
    embryos: [{ ordinal: 0, status: "qc_pass", callRate: 0.98 }] });
  await grantAnalysis(accountId, cohortId);
  await signIn(page, parent.email, parent.password);
  await page.goto("/overview");
  const box = page.locator('[data-overview-box] a[aria-labelledby="box-embryos-copilot-label"]');
  await expect(box).toHaveAttribute("href", `/copilot/c-${cohortId}`);
  await page.goto("/embryos");
  await expect(page.locator('[data-tile="copilot"] a')).toHaveAttribute("href", `/copilot/c-${cohortId}`);
  await page.locator('[data-tile="copilot"] a').click();
  await expect(page).toHaveURL(new RegExp(`/copilot/c-${cohortId}$`));
  await expect(page.locator('[data-slot="copilot-local-unavailable"]')).toBeVisible();
  await expect(page.getByLabel("Message the copilot")).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toMatch(/contextToken|0\.98|Embryo 1/);
});
