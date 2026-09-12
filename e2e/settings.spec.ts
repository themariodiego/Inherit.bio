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
 * `/settings processing`, and the state exists because this run built it.
 *
 * The digest switch awaited a `profiles` write and stayed live throughout, so
 * a reader flipping it had no sign anything was happening and could flip it
 * again mid-request. `digest-toggle.tsx` now holds a `busy` flag and disables
 * the control, which is what every comparable control in the product already
 * did and what the register already said this route had.
 *
 * Held open the same way `e2e/auth-processing.spec.ts` holds its four: the
 * write is intercepted and not released until the assertion has run, so the
 * product sits in a state it defines rather than a simulated one.
 */
test("/settings processing: the digest switch is held while its write is in flight", async ({ page }) => {
  await signIn(page, USER.email, USER.password);

  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let intercepted = 0;
  await page.route("**/rest/v1/profiles*", async (route) => {
    if (route.request().method() === "GET") { await route.continue(); return; }
    intercepted += 1;
    await held;
    await route.continue();
  });

  try {
    await page.goto("/settings");
    const digest = page.getByRole("switch");
    await expect(digest).toBeEnabled();
    await digest.click();
    await expect(digest).toBeDisabled();
    expect(intercepted, "the state is held by a real in-flight write").toBeGreaterThan(0);
  } finally {
    release();
  }
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
 * THIS TEST USED TO PROVE A LIE, and the way it did it is worth keeping.
 *
 * It was titled "/settings/people jurisdiction-unavailable: its only render
 * refuses on jurisdiction", which `scripts/route-gate.ts` counted as one of
 * the proven (route, state) pairs. The assertions all passed. The page really
 * did render "Not available in this jurisdiction yet" — because it returned
 * `<CapabilityUnavailable>` unconditionally, with no jurisdiction guard on the
 * route at all. The feature had simply never been built, and every visitor was
 * told a legal review was missing.
 *
 * The old comment here reasoned that naming the state was fair because this is
 * the page's only render and there was "no other state for it to stand in
 * for". That is true and beside the point: a route with no jurisdiction guard
 * cannot be in the jurisdiction-unavailable state, however few other states it
 * has. What the title certified was that a false sentence renders.
 *
 * So the pair is gone from `docs/route-divergence.json` (74 proven -> 73) and
 * `jurisdiction-unavailable` is gone from the `account-management` profile.
 * This title deliberately names NO (route, state) pair: the page's real state
 * is "not written yet", the register has no such state, and inventing a proof
 * for one is what got us here.
 */
test("the People settings page says it is not built, and blames no jurisdiction", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/settings/people");

  await expect(page.locator("main h1")).toHaveText("People and relationships");
  const notice = page.getByRole("status");
  await expect(notice).toContainText("Not built yet");
  await expect(notice, "it says what the page will do once it exists")
    .toContainText("list the people you share with");
  await expect(notice, "and names what is NOT the reason")
    .toContainText("No law and nothing about you is holding it back");
  // The regression this guards: the jurisdiction sentence must not come back
  // on a route that has no jurisdiction guard to justify it.
  await expect(page.getByText("Not available in this jurisdiction yet")).toHaveCount(0);
  await expect(notice.getByRole("link", { name: "Go back" })).toHaveAttribute("href", "/settings");
});
