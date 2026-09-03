import { expect, test, type Page } from "@playwright/test";
import { adminClient, createConfirmedUser, signIn } from "./helpers";

// Global search (brief §2 §1.3): one header button labelled "Search" with the
// visible shortcut hint, on every app page; ⌘K/Ctrl+K and the button open a
// native modal dialog labelled by its title; Escape closes it and focus
// returns to the button. Results are grouped People and embryos → Reports →
// Ancestry regions → Settings under <p> labels (never headings), at most
// eight per group; every subject-derived row carries the subject's chip; the
// dialog never shows a figure, a percent sign or a genotype pair. Arrow keys
// move focus between result links and Enter follows one.

const USER = { email: "search@e2e.local", password: "e2e-search-pw" };

const CAFFEINE = "/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551";
const DIALOG_TITLE = "Search Inherit";
const INPUT_LABEL = "Find a person, a report or a page";
const NO_RESULTS = "No results for this search. Try another word.";
const GROUP_ORDER = ["People and embryos", "Reports", "Ancestry regions", "Settings"];
const GENOTYPE_PAIR = /\b[ACGT]\/[ACGT]\b/;

let userId = "";

function searchButton(page: Page) {
  return page.getByRole("button", { name: "Search", exact: true });
}

function dialog(page: Page) {
  return page.getByRole("dialog", { name: DIALOG_TITLE });
}

function input(page: Page) {
  return dialog(page).getByLabel(INPUT_LABEL);
}

/** Open with the button and wait for the input to take focus. */
async function openWithButton(page: Page) {
  await searchButton(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
}

/** The dialog's rendered text carries no figure, no percent and no genotype pair. */
async function expectDestinationsOnly(page: Page) {
  const box = dialog(page);
  await expect(box.locator("[data-figure-kind]")).toHaveCount(0);
  await expect(box.getByRole("heading")).toHaveCount(0);
  const text = await box.innerText();
  expect(text).not.toContain("%");
  expect(text).not.toMatch(GENOTYPE_PAIR);
  // Groups render in the mandated order, never more than four, never Help.
  const labels = await box.locator('[data-slot="search-group-label"]').allTextContents();
  expect(labels.length).toBeLessThanOrEqual(4);
  expect(labels).not.toContain("Help");
  const positions = labels.map((label) => GROUP_ORDER.indexOf(label));
  expect(positions).not.toContain(-1);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  for (const group of await box.getByRole("group").all()) {
    expect(await group.getByRole("link").count()).toBeLessThanOrEqual(8);
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  userId = await createConfirmedUser(USER.email, USER.password);
});

test("the header button is on /overview and /genome/me; the shortcut and the button open the dialog; Escape closes it and returns focus to the button", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/overview");

  const button = searchButton(page);
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("aria-keyshortcuts", "Meta+K Control+K");
  // The button sits in the header, outside the account and app navigation.
  expect(await button.evaluate((el) => el.closest("header") !== null && el.closest("nav") === null)).toBe(true);
  const buttonBox = await button.boundingBox();
  expect(buttonBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  // The visible shortcut hint is a Mac or a Ctrl form, never absent.
  await expect(button.locator("kbd")).toHaveText(/^(⌘K|Ctrl K)$/);
  await expect(dialog(page)).toBeHidden();

  // Keyboard shortcut from the page body.
  await page.keyboard.press("ControlOrMeta+k");
  const box = dialog(page);
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute("aria-modal", "true");
  await expect(input(page)).toBeFocused();
  await expect(box.getByText("Results show here as you type.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
  await expect(button).toBeFocused();

  // The button.
  await openWithButton(page);
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
  await expect(button).toBeFocused();

  await page.goto("/genome/me");
  await expect(searchButton(page)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
});

test("typing caffeine lists the Reports group with the caffeine template link carrying the You chip, destinations only", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await openWithButton(page);
  await input(page).fill("caffeine");

  const reports = dialog(page).getByRole("group", { name: "Reports" });
  await expect(reports).toBeVisible();
  const link = reports.locator(`a[href="${CAFFEINE}"]`);
  await expect(link).toBeVisible();
  await expect(link).toContainText("Caffeine metabolism");
  await expect(link.locator('[data-slot="search-chip"]')).toHaveText("You");
  // The group label is a <p>, not a heading.
  const label = dialog(page).locator('[data-slot="search-group-label"]', { hasText: "Reports" });
  expect(await label.evaluate((el) => el.tagName.toLowerCase())).toBe("p");
  await expectDestinationsOnly(page);

  // Arrow keys move focus between result links; Enter follows the focused one.
  await page.keyboard.press("ArrowDown");
  const first = reports.getByRole("link").first();
  await expect(first).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(input(page)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(first).toBeFocused();
  // Two seed templates match "caffeine" (sleep · ADORA2A and metabolism ·
  // CYP1A2), so the first result is not necessarily the metabolism one:
  // follow the specific link, which is the behaviour a reader relies on.
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await page.waitForURL(`**${CAFFEINE}`);
  await expect(dialog(page)).toBeHidden();
});

test("typing settings lists the Settings group with /settings", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.keyboard.press("ControlOrMeta+k");
  await input(page).fill("settings");

  const settings = dialog(page).getByRole("group", { name: "Settings" });
  await expect(settings).toBeVisible();
  await expect(settings.locator('a[href="/settings"]')).toBeVisible();
  await expect(settings.locator('a[href="/settings"] [data-slot="search-chip"]')).toHaveCount(0);
  await expectDestinationsOnly(page);
});

test("typing the account's own display label lists People and embryos with the You chip; nonsense gives the no-results sentence", async ({
  page,
}) => {
  const admin = adminClient();
  const { data, error } = await admin
    .from("subjects")
    .select("display_label")
    .eq("subject_account_id", userId)
    .eq("subject_class", "self")
    .single();
  if (error || !data) throw new Error(`self subject: ${error?.message}`);
  const displayLabel = (data as { display_label: string }).display_label;
  expect(displayLabel.length).toBeGreaterThan(0);

  await signIn(page, USER.email, USER.password);
  await openWithButton(page);
  await input(page).fill(displayLabel);

  const people = dialog(page).getByRole("group", { name: "People and embryos" });
  await expect(people).toBeVisible();
  const link = people.locator('a[href="/genome/me"]');
  await expect(link).toBeVisible();
  await expect(link).toContainText(displayLabel);
  await expect(link.locator('[data-slot="search-chip"]')).toHaveText("You");
  await expectDestinationsOnly(page);

  await input(page).fill("zzqqxx");
  const status = dialog(page).getByRole("status");
  await expect(status).toHaveText(NO_RESULTS);
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(dialog(page).getByRole("group")).toHaveCount(0);
});

test("the endpoint answers 401 when signed out and destinations only when signed in", async ({ page }) => {
  const anonymous = await page.request.get("/api/search?q=caffeine", { maxRedirects: 0 });
  expect(anonymous.status()).toBe(401);

  await signIn(page, USER.email, USER.password);
  const res = await page.request.get("/api/search?q=caffeine");
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as {
    groups: { id: string; label: string; results: { label: string; href: string; chip?: string }[] }[];
  };
  expect(body.groups.length).toBeGreaterThan(0);
  expect(body.groups.length).toBeLessThanOrEqual(4);
  const ids = body.groups.map((group) => group.id);
  expect(ids).toEqual([...ids].sort((a, b) => ["people", "reports", "ancestry", "settings"].indexOf(a) - ["people", "reports", "ancestry", "settings"].indexOf(b)));
  for (const group of body.groups) {
    expect(group.results.length).toBeGreaterThan(0);
    expect(group.results.length).toBeLessThanOrEqual(8);
    for (const result of group.results) {
      expect(Object.keys(result).sort()).toEqual(result.chip === undefined ? ["href", "label"] : ["chip", "href", "label"]);
      expect(result.label).not.toContain("%");
      expect(result.label).not.toMatch(GENOTYPE_PAIR);
      expect(result.href).toMatch(/^\//);
    }
  }
  const reports = body.groups.find((group) => group.id === "reports");
  expect(reports?.results.find((result) => result.href === CAFFEINE)?.chip).toBe("You");
});
