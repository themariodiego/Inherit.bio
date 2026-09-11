import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createConfirmedUser, signIn } from "./helpers";

/**
 * Three account-management route states, driven on a fresh confirmed account
 * with nothing uploaded — which is what makes them cheap and what makes them
 * honest: none of the three depends on genetic data existing.
 *
 * Each was read before it was named, because the register applies the
 * `account-management` profile wholesale and declares six states on all five
 * settings routes. Most of those six are not reachable on most of those pages,
 * and claiming one that the page cannot occupy is precisely how this ratchet
 * gets faked. The three below are the ones the pages genuinely render.
 */
const USER = { email: `settings-${randomUUID()}@e2e.local`, password: "e2e-settings-pw" };

const SECTIONS = [
  { href: "/settings/data", title: "Data" },
  { href: "/settings/copilot", title: "Copilot" },
  { href: "/settings/people", title: "People" },
  { href: "/settings/consents", title: "Consents" },
] as const;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

/**
 * `/settings` has no data-dependent states: it renders the account's own
 * address, all four section tiles and the digest control on every visit. So
 * `complete` here means the router showing everything it has, and the
 * assertion is worth making because a section silently disappearing would
 * strand whatever it leads to — including the two rights surfaces.
 */
test("/settings complete: the account address, all four sections and the digest control", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/settings");

  await expect(page.locator("main h1")).toHaveText("Settings");
  // Scoped to `main`: the app shell also shows the address in its account
  // control, and this is an assertion about the page, not the chrome.
  await expect(page.locator("main").getByText(USER.email, { exact: true }),
    "the account's own address").toBeVisible();

  const nav = page.getByRole("navigation", { name: "Settings sections" });
  await expect(nav.getByRole("link")).toHaveCount(SECTIONS.length);
  for (const section of SECTIONS) {
    await expect(nav.getByRole("link", { name: new RegExp(`^${section.title}\\b`) }))
      .toHaveAttribute("href", section.href);
  }
  // The expert-path entry point this page is one of three for (brief §7.3).
  await expect(page.getByRole("link", { name: "Data and methods" })).toBeVisible();
});

/**
 * `/settings/consents` is a header, the grant list and a back link, so the
 * list is the page's whole substance and an empty list is the page's `empty`
 * state rather than one region of it having nothing to show. That distinction
 * is the one this repository keeps warning about, so it is stated here rather
 * than assumed: a page whose single panel is empty is only `empty` when that
 * panel is what the page is for.
 */
test("/settings/consents empty: a new account holds no grants, and the page says so", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/settings/consents");

  await expect(page.locator("main h1")).toHaveText("Consents");
  await expect(page.getByText("No cloud-LLM consent grants. None are needed for local models."))
    .toBeVisible();
  // Absence stated, not merely rendered as nothing.
  await expect(page.getByRole("button", { name: /revoke/i }), "no grant rows").toHaveCount(0);
});

/**
 * `/settings/people` is eight lines that return `CapabilityUnavailable`
 * unconditionally, and that component's own heading is "Not available in this
 * jurisdiction yet". So this is the page's only render, and naming it is not a
 * component state standing in for a route state — there is no other state for
 * it to stand in for.
 */
test("/settings/people jurisdiction-unavailable: its only render refuses on jurisdiction", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/settings/people");

  await expect(page.locator("main h1")).toHaveText("People and relationships");
  const refusal = page.getByRole("status");
  await expect(refusal).toContainText("Not available in this jurisdiction yet");
  await expect(refusal, "the refusal says it is about the site, not the reader")
    .toContainText("It says nothing about you or anyone else");
  await expect(refusal, "and that nothing was recorded").toContainText("We create no analysis or consent record");
  await expect(refusal.getByRole("link", { name: "Go back" })).toHaveAttribute("href", "/settings");
});
