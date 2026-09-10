import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { axeViolations, createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";

// A16 — axe accessibility checks over key surfaces in BOTH themes, plus
// design-token presence (Fraunces display, pill CTAs, attribution line).

const USER = { email: "a11y@e2e.local", password: "e2e-a11y-pw" };

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

/**
 * G2.7 asks that every new route render in both themes under unmodified
 * assertions. A hand-kept list cannot honour "every": this one held four
 * routes while the register carried 29 static public pages, so 25 — every
 * legal page among them — were never checked in either theme.
 *
 * Derived from the register instead, so a new public page is covered the day
 * it lands. Dynamic segments are skipped: they have no fetchable URL without
 * valid parameter values, and inventing one would test a 404 rather than a
 * page. Authenticated routes stay with the signed-in test below.
 */
function publicRoutes(): string[] {
  const register = JSON.parse(fs.readFileSync("docs/route-register.json", "utf8")) as {
    routes: { kind: string; auth: string; path: string }[];
  };
  const routes = register.routes
    .filter(route => route.kind === "page" && route.auth === "public" && !route.path.includes("["))
    .map(route => route.path)
    .sort();
  // A broken filter must fail loudly rather than quietly check four pages.
  if (routes.length < 20) throw new Error(`route register yielded only ${routes.length} public pages`);
  return routes;
}

const PUBLIC_ROUTES = publicRoutes();

for (const route of PUBLIC_ROUTES) {
  for (const theme of ["light", "dark"] as const) {
    test(`axe: ${route} (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      expect(await axeViolations(page, theme), `${route} (${theme})`).toEqual([]);
    });
  }
}

/**
 * G2.7's authenticated half, derived the same way as the public half above.
 *
 * It used to visit three URLs — `/dashboard`, `/settings`, `/uploads` — while
 * the register carries 25 kept authenticated pages, and two of those three are
 * registered redirects rather than pages, so the hand-kept list measured their
 * destinations by accident. The list comes from the register now, so a new
 * authenticated page is covered the day it lands.
 *
 * A dynamic segment is only skippable when nothing can fill it. Here the
 * signed-in account is itself the parameter: `subject` is `me`, `scope` is
 * `me`, and `slug` is a report this account's file actually covers. So the
 * genome surfaces are checked with real content rather than an empty state,
 * which is the version a person sees.
 */
const AUTHENTICATED_ACCOUNT = {
  email: `a11y-auth-${randomUUID()}@e2e.local`,
  password: "e2e-a11y-auth-pw",
};
const TINY_FIXTURE = "e2e/fixtures/tiny-grch38.vcf";

/**
 * The URL each registered authenticated page is visited at. A path listed here
 * with a query renders a populated state the bare path does not: the variant
 * browser answers nothing without a search, so checking it bare would check a
 * form rather than a results table.
 */
const VISIT: Record<string, string> = {
  "/overview": "/overview",
  "/files": "/files",
  "/files/upload": "/files/upload",
  "/settings": "/settings",
  "/settings/data": "/settings/data",
  "/settings/copilot": "/settings/copilot",
  "/settings/people": "/settings/people",
  "/settings/consents": "/settings/consents",
  "/family/invite": "/family/invite",
  "/family/health-picture": "/family/health-picture",
  "/embryos": "/embryos",
  "/embryos/upload": "/embryos/upload",
  "/embryos/request-data": "/embryos/request-data",
  "/embryos/compare": "/embryos/compare",
  "/genome/[subject]": "/genome/me",
  "/genome/[subject]/reports": "/genome/me/reports",
  "/genome/[subject]/reports/[slug]": "/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551",
  "/genome/[subject]/ancestry": "/genome/me/ancestry",
  "/genome/[subject]/data": "/genome/me/data",
  "/genome/[subject]/data/browser": "/genome/me/data/browser?q=rs762551",
  "/copilot/[scope]": "/copilot/me",
};

/**
 * The registered document pages, which are public but carry dynamic segments,
 * so the sweep above skips them for want of a URL. Their parameters are not
 * invented here: `consent.own-polygenic` is shipped by
 * `supabase/migrations/20260906135854_own_report_layer_language.sql` at
 * version 2 with version 1 superseded, so every one of these six URLs
 * resolves to a real document in any database the migrations built — the diff
 * routes included, which need two versions to be anything but a 404.
 *
 * They were audited by nothing until the coverage assertion below went
 * looking: the public sweep skips dynamic segments and the authenticated
 * sweep never saw them, so seventeen legal documents were checked by the
 * rendered legal gate for placeholder text and by no one for accessibility.
 */
const CONSENT_KEY = "consent.own-polygenic";
const DOCUMENTS: Record<string, string> = {
  "/legal/[artifact]": `/legal/${CONSENT_KEY}`,
  "/legal/[artifact]/versions/[version]": `/legal/${CONSENT_KEY}/versions/1`,
  "/legal/[artifact]/diff/[from]/[to]": `/legal/${CONSENT_KEY}/diff/1/2`,
  "/legal/consent/[key]": `/legal/consent/${CONSENT_KEY}`,
  "/legal/consent/[key]/v/[version]": `/legal/consent/${CONSENT_KEY}/v/1`,
  "/legal/consent/[key]/diff/[from]/[to]": `/legal/consent/${CONSENT_KEY}/diff/1/2`,
};

for (const [route, url] of Object.entries(DOCUMENTS)) {
  for (const theme of ["light", "dark"] as const) {
    test(`axe: ${route} (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      const response = await page.goto(url);
      // A 404 would make the audit meaningless, and quietly: an empty
      // not-found page has no violations.
      expect(response?.status(), `${url} resolves to a document`).toBe(200);
      await page.waitForLoadState("networkidle");
      expect(await axeViolations(page, theme), `${route} (${theme})`).toEqual([]);
    });
  }
}

/**
 * The registered pages audited by another spec instead, because reaching them
 * needs state this spec has no business building — a second confirmed account
 * and an accepted invitation, a granted portrait pair, an ingested cohort.
 *
 * They are audited at exactly the bar used here: `expectAxeClean` in
 * `e2e/helpers.ts` is the one definition of the audit, in both themes, zero
 * WCAG 2.1 A/AA violations of any impact. Four of those specs used to hold
 * their own copy of it filtered to `serious` and `critical`, which is not a
 * smaller version of the same check — a `moderate` violation is still a WCAG
 * failure — so the Family, Portrait and Embryo surfaces were held to a lower
 * bar than every marketing page, silently, because the bar lived in each spec.
 *
 * Listed rather than filtered out, and asserted to be exactly the set with no
 * entry in VISIT, so neither list can drift from the register: a new page
 * lands here loudly, and a page that gains a visit has to leave.
 */
const CHECKED_ELSEWHERE: Record<string, string> = {
  "/family": "e2e/family.spec.ts, the signed-in hub",
  "/withdraw/[token]": "e2e/family.spec.ts, the invitation it actually issued",
  "/family/[person]": "e2e/family.spec.ts, past the Tier-2 gate with a shared layer showing",
  "/family/[person]/permissions": "e2e/family.spec.ts, with both columns populated",
  "/family/portrait/[pairId]": "e2e/portrait.spec.ts, past the portrait gate",
  "/embryos/[embryoId]": "e2e/embryos.spec.ts",
};

type RegisteredPage = { kind: string; auth: string; path: string; disposition: unknown };

function registeredPages(): RegisteredPage[] {
  const register = JSON.parse(fs.readFileSync("docs/route-register.json", "utf8")) as {
    routes: RegisteredPage[];
  };
  return register.routes.filter(route => route.kind === "page" && route.disposition === "kept");
}

function authenticatedRoutes(): string[] {
  const routes = registeredPages()
    .filter(route => route.auth === "authenticated")
    .map(route => route.path)
    .sort();
  // A broken filter must fail loudly rather than quietly check three pages.
  if (routes.length < 20) throw new Error(`route register yielded only ${routes.length} authenticated pages`);
  return routes;
}

test("axe: every registered authenticated page, both themes", async ({ page }) => {
  test.setTimeout(600_000);
  const registered = authenticatedRoutes();
  const pages = registeredPages().map(route => route.path);
  expect(registered.filter(route => !(route in VISIT) && !(route in CHECKED_ELSEWHERE)).sort(),
    "every registered authenticated page is either visited here or named with the spec that audits it")
    .toEqual([]);
  // A stale entry in either list is as bad as a missing one: it claims a page
  // is covered that the register no longer carries.
  expect([...Object.keys(DOCUMENTS), ...Object.keys(VISIT), ...Object.keys(CHECKED_ELSEWHERE)]
    .filter(route => !pages.includes(route)).sort(),
    "no list names a page the register does not carry").toEqual([]);
  // No registered page may fall between the two sweeps. `/family` is
  // `public-or-authenticated`, so it matched neither filter and was audited by
  // neither: an auth value outside the two the sweeps know about was enough to
  // leave a page unchecked with nothing saying so.
  const audited = new Set([...PUBLIC_ROUTES, ...Object.keys(DOCUMENTS),
    ...Object.keys(VISIT), ...Object.keys(CHECKED_ELSEWHERE)]);
  expect(pages.filter(path => !audited.has(path)).sort(),
    "every registered kept page is audited somewhere, in both themes").toEqual([]);

  await createConfirmedUser(AUTHENTICATED_ACCOUNT.email, AUTHENTICATED_ACCOUNT.password);
  await signIn(page, AUTHENTICATED_ACCOUNT.email, AUTHENTICATED_ACCOUNT.password);
  // Real content, not an empty state: the genome surfaces are the ones whose
  // accessibility depends on rendered results.
  await uploadOwnFileWithChosenReports(page, path.join(process.cwd(), TINY_FIXTURE),
    { fileType: "vcf", purposes: ["reports.polygenic"] });

  for (const route of registered.filter(entry => entry in VISIT)) {
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(VISIT[route]);
      await page.waitForLoadState("networkidle");
      // Soft, so one run names every page that fails rather than the first.
      expect.soft(await axeViolations(page, theme), `${route} (${theme})`).toEqual([]);
    }
  }
});

test("skip link: first tabbable element, moves focus to main without navigating (both layouts)", async ({
  page,
}) => {
  // Marketing layout: the very first Tab press must land on the skip link…
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  // …and activating it must move focus to the main landmark (tabIndex={-1})
  // WITHOUT hash navigation: the URL keeps no #main fragment and no history
  // entry is pushed, so Back from a later page can never replay a stale
  // render (the app-router quirk this behavior guards against).
  const historyBefore = await page.evaluate(() => history.length);
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
  expect(new URL(page.url()).hash).toBe("");
  expect(await page.evaluate(() => history.length)).toBe(historyBefore);

  // Signed-in app layout: same contract.
  await signIn(page, USER.email, USER.password);
  await page.goto("/dashboard");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
  expect(new URL(page.url()).hash).toBe("");
});

test("design language: Fraunces display, pill CTAs, attribution, theme toggle", async ({
  page,
}) => {
  await page.goto("/");

  // Fraunces on the display headline (self-hosted via next/font).
  const h1Font = await page
    .locator("h1")
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(h1Font.toLowerCase()).toContain("fraunces");

  // Pill CTA: fully rounded primary button.
  const cta = page.getByRole("link", { name: "Start with your raw data" });
  const radius = await cta.evaluate((el) => getComputedStyle(el).borderRadius);
  expect(parseFloat(radius)).toBeGreaterThanOrEqual(999);

  // Attribution line present in the chrome.
  await expect(
    page
      .getByText("Inherit · an open-source project created by Plus Bio for the public good", {
        exact: false,
      })
      .first(),
  ).toBeVisible();

  // Numbered 01-04 process steps.
  for (const n of ["01", "02", "03", "04"]) {
    await expect(page.getByText(n, { exact: true })).toBeVisible();
  }

  // Theme toggle flips the class and persists paper/ink ground.
  await page.getByRole("button", { name: /toggle light and dark theme/i }).click();
  const isDark = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
  const bg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  expect(typeof isDark).toBe("boolean");
});
