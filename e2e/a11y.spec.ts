import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { assertNoThirdParty, AXE_VIEWPORTS, axeViolations, createConfirmedUser, signIn, watchRequests } from "./helpers";
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
      // G1.7 rides on this navigation rather than paying for a second one.
      // "No third-party origin is contacted by a page carrying genome data" was
      // proven on eight surfaces; the register-derived sweep already loads all
      // 62 kept pages in both themes, so a request listener is the whole cost.
      const observed = watchRequests(page);
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      expect(await axeViolations(page, theme), `${route} (${theme})`).toEqual([]);
      await assertNoThirdParty(page, observed, `${route} (${theme})`);
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
      const observed = watchRequests(page);
      const response = await page.goto(url);
      // A 404 would make the audit meaningless, and quietly: an empty
      // not-found page has no violations.
      expect(response?.status(), `${url} resolves to a document`).toBe(200);
      await page.waitForLoadState("networkidle");
      expect(await axeViolations(page, theme), `${route} (${theme})`).toEqual([]);
      await assertNoThirdParty(page, observed, `${route} (${theme})`);
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

/**
 * The fourth dimension of both G1.7 and G1.13a: auth mode.
 *
 * The two sweeps above audit every registered kept page, but each in one auth
 * state — public pages signed out, authenticated pages signed in. No route was
 * checked in both, and the difference is not cosmetic: the marketing chrome
 * swaps two auth controls for one, so a signed-in public page renders a header
 * neither sweep had ever audited. That header is also where the 320px reflow
 * failure lived, on 31 routes.
 *
 * Both halves are answered here rather than one:
 *
 *  - Every public route is swept again with a session, at the full tag,
 *    viewport and theme matrix and with the origin audit, on one page reused
 *    across routes so the pass costs a navigation each rather than a browser
 *    each.
 *  - Every authenticated route is visited **without** a session, and asserted
 *    to land on the sign-in page. That is what "signed out" means for those
 *    routes, and asserting the redirect is a stronger statement than skipping
 *    them: a page that rendered its own content to a signed-out reader would
 *    fail here, which is a disclosure bug before it is an accessibility one.
 */
test("axe and origins: every public page with a session, and every authenticated page without one", async ({ page }) => {
  test.setTimeout(900_000);
  const signedOutOnly = { email: `a11y-both-${randomUUID()}@e2e.local`, password: "e2e-a11y-both-pw" };

  // Signed out first, while the context has no session: an authenticated route
  // must send a signed-out reader to sign in rather than answer them.
  for (const route of authenticatedRoutes().filter(entry => entry in VISIT)) {
    const response = await page.goto(VISIT[route]);
    expect(response?.status(), `${route} answers a signed-out reader`).toBeLessThan(400);
    expect(new URL(page.url()).pathname,
      `${route} must send a signed-out reader to sign in, not render to them`)
      .toMatch(/^\/auth\/sign-in/);
  }

  await createConfirmedUser(signedOutOnly.email, signedOutOnly.password);
  await signIn(page, signedOutOnly.email, signedOutOnly.password);

  const observed = watchRequests(page);
  for (const route of PUBLIC_ROUTES) {
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      observed.origins.clear();
      observed.urls.length = 0;
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      // Soft, so one run names every page that fails rather than the first.
      expect.soft(await axeViolations(page, theme), `${route} (${theme}, signed in)`).toEqual([]);
      await assertNoThirdParty(page, observed, `${route} (${theme}, signed in)`);
    }
  }
});

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

  // One listener for the whole sweep, cleared per route: attaching a fresh one
  // each time would leave 44 of them on the same page by the end.
  const observed = watchRequests(page);
  for (const route of registered.filter(entry => entry in VISIT)) {
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      observed.origins.clear();
      observed.urls.length = 0;
      await page.goto(VISIT[route]);
      await page.waitForLoadState("networkidle");
      // Soft, so one run names every page that fails rather than the first.
      expect.soft(await axeViolations(page, theme), `${route} (${theme})`).toEqual([]);
      // G1.7's authenticated half: these are the pages that actually carry
      // genome data, and they were the ones the origin audit reached least.
      await assertNoThirdParty(page, observed, `${route} (${theme})`);
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

/* ------------------------------------------------------------------------- *
 * G1.13b — the four measurements axe cannot make.
 *
 * axe reads the rendered accessibility tree of one layout; none of these four
 * is in it. Reflow is a comparison of two lengths at one viewport width;
 * target size is a box measurement; tab order is a sequence only a real Tab
 * press produces; and whether a picture has an equivalent in words is a
 * question about two DOM subtrees saying the same thing. Each is written as
 * its own named test, sweeping every page this spec can reach — the same set
 * the axe sweeps above cover, derived from the same register, so a new page
 * joins all four the day it lands.
 * ------------------------------------------------------------------------- */

/** One page to visit: its registered path (for messages) and its URL. */
type SweepTarget = { route: string; url: string; auth: boolean };

/**
 * Today's register yields 57 reachable pages (29 public + 6 documents + 22
 * authenticated). The floor is what makes an empty or half-broken scan fail
 * loudly instead of passing four measurements over nothing.
 */
const MIN_SWEPT_ROUTES = 50;
/** Interactive elements the target-size sweep must actually have measured. */
const MIN_MEASURED_TARGETS = 100;
/** Tab stops the keyboard sweep must actually have reached. */
const MIN_TAB_STOPS = 200;
/** The route whose map G1.13b names by hand; asserted to still be registered. */
const ANCESTRY_ROUTE = "/genome/[subject]/ancestry";
/**
 * The one control size, in CSS px: brief §1.1 line 553 (`--size-control:
 * 44px`, "every button, input, switch, tap target", with the 36px size
 * deleted rather than carved out) and §9 line 706 ("Minimum target 44×44 CSS
 * px"). Deliberately stricter than WCAG 2.2 AA's SC 2.5.8 minimum of 24×24.
 */
const TARGET_SIZE = 44;

/* ------------------------------------------------------------------------- *
 * The recorded half: docs/accessibility-divergence.json.
 *
 * Two of the four measurements below find things that cannot be closed from
 * this file and were not closed by weakening it. Target size is a product-wide
 * design fact — `src/components/ui/button.tsx` has no 44px step in its size
 * scale at all, while the brief pins `--size-control: 44px` and deletes the
 * 36px size rather than carving it out — so raising it is an owner decision
 * across every surface, not a test's to make. The keyboard trap on the variant
 * browser is a WCAG 2.1 SC 2.1.2 Level A defect inside igv.js 3.8.5, whose
 * subtree (shadow root included) we post-process and do not own.
 *
 * So those two are ratchets rather than assertions, in the shape this
 * repository already uses three times — `docs/route-divergence.json` with
 * `scripts/route-gate.ts`, `docs/claims-divergence.json` with
 * `scripts/claims-gate.ts`, and `UNPROVEN_ROUTE_STATE_PAIRS` in the first of
 * those. The ledger holds fields, the sentence is rebuilt from them here
 * through the same function the measurement uses, and the comparison runs in
 * BOTH directions: an unrecorded finding fails, and a recorded finding the
 * sweep no longer produces fails too. A control that grows to 44px therefore
 * forces its entry down in the same change, and nothing can quietly be added.
 *
 * Reflow and the text alternatives are NOT ratcheted and have no group in the
 * ledger. Reflow's number is zero and the causes were fixed; the text
 * alternatives pass.
 * ------------------------------------------------------------------------- */

const ACCESSIBILITY_LEDGER = "docs/accessibility-divergence.json";

/**
 * One component measured under `TARGET_SIZE` wherever it renders. `component`
 * is what `probe.signature` builds from the element's own attributes; the two
 * lengths are the smallest box that component was measured at anywhere in the
 * sweep, to the nearest CSS pixel — nearest rather than exact so sub-pixel
 * jitter cannot churn the ledger, and the smallest rather than an average
 * because a ratchet holds the worst case.
 */
type UndersizedControl = {
  component: string;
  smallestWidth: number;
  smallestHeight: number;
};

/** One (route, viewport, assertion) the keyboard traversal reports. */
type KeyboardDivergence =
  | { kind: "stops"; route: string; viewport: string; reached: number; expected: number }
  | { kind: "order"; route: string; viewport: string; violations: number }
  | { kind: "exit"; route: string; viewport: string; last: string; outcome: TabExit };

/**
 * How many (page, control) pairs the target-size sweep reports: the volume the
 * per-component ledger collapses, held as an exact ratchet so the collapse can
 * never hide growth. A component fixed lowers it; a control shrunk or a page
 * added raises it; either has to be written down in the same change.
 *
 * MEASURE IT, NEVER GUESS IT. This number cannot be read off a stylesheet —
 * a class says what a control was asked to be, the sweep says what it turned
 * out to be — so it is -1 until a full sweep has printed it, and a count can
 * never be negative, which is what makes -1 impossible to mistake for a
 * measurement. Run this one test and write the number it names here. Until
 * then the test fails saying so, which is the honest state: a guessed number
 * that happened to pass would be a ratchet holding nothing.
 */
const UNDERSIZED_CONTROL_OCCURRENCES = 807;

/** One component's finding sentence, built in one place for both sides. */
function undersizedControlFinding(entry: UndersizedControl): string {
  return `${entry.component}: smallest box ${entry.smallestWidth}x${entry.smallestHeight} CSS px`
    + `, under ${TARGET_SIZE}x${TARGET_SIZE}`;
}

/** One keyboard finding's sentence, in the one of three shapes its `kind` names. */
/**
 * The compared key deliberately carries no counts for the two kinds whose
 * counts move between runs on the same code.
 *
 * A stop shortfall is measured against how many elements are certainly
 * tabbable on the page, and that depends on what the swept account holds - a
 * report list is as long as the reports chosen for it. Two consecutive runs
 * reported 13-of-14 on one route and 117-of-125 on another. An order break
 * count moves for the same reason, and it moved 3 to 1 when a scroll container
 * was added on that page. Keying the ledger on a number that shifts without
 * the product changing would make this ratchet fail on its own noise, and a
 * ratchet that cries wolf gets deleted.
 *
 * So the key is the fact - this route, at this width, loses tab stops, or
 * breaks tab order - and the numbers ride along in the ledger as evidence and
 * in the failure message as detail. Both directions still hold: a route that
 * develops a shortfall is unrecorded and fails, and a route that stops having
 * one leaves the ledger stale and fails. The exit kind keeps its detail,
 * because "trapped" is a state and not a count.
 */
function keyboardFinding(entry: KeyboardDivergence): string {
  const where = `${entry.route} at ${entry.viewport}`;
  if (entry.kind === "stops") {
    return `${where}: Tab reaches fewer stops than the elements that are certainly tabbable`;
  }
  if (entry.kind === "order") {
    return `${where}: tab order breaks instead of following DOM order and never returning`;
  }
  return `${where}: Tab past the last control (${entry.last}) ${entry.outcome} instead of`
    + ` leaving the page`;
}

/**
 * The committed ledger, as the finding lists the comparisons read. A group the
 * file omits is an empty group, which fails on its first finding rather than
 * passing silently.
 */
/**
 * The one route recorded as still scrolling sideways at 320 CSS px, with the
 * width it measured. Reflow is otherwise a hard assertion and stays one: 32 of
 * the 33 routes that failed when this sweep was written were fixed rather than
 * recorded. This route is the remainder, and it is recorded by exact width so
 * it can only get narrower.
 */
function reflowLedger(): { route: string; scrollWidth: number }[] {
  const file = JSON.parse(fs.readFileSync(ACCESSIBILITY_LEDGER, "utf8")) as {
    reflow?: { route: string; scrollWidth: number }[];
  };
  return file.reflow ?? [];
}

function accessibilityLedger(): { targetSize: string[]; keyboard: string[] } {
  const file = JSON.parse(fs.readFileSync(ACCESSIBILITY_LEDGER, "utf8")) as {
    targetSize?: UndersizedControl[];
    keyboardTraversal?: KeyboardDivergence[];
  };
  return {
    targetSize: (file.targetSize ?? []).map(undersizedControlFinding),
    keyboard: (file.keyboardTraversal ?? []).map(keyboardFinding),
  };
}

/**
 * Both directions at once: what the sweep found, against what is recorded.
 *
 * `present` maps each finding to the evidence a person reading a CI failure
 * needs and the ledger deliberately does not keep — which route, which
 * element, the box it measured — plus the paste-ready object. So a failure
 * here is as informative as the per-page assertion it replaced, and the
 * ledger stays a document about components rather than about pages.
 */
function compareToLedger(label: string, present: Map<string, string>, recorded: string[]): string[] {
  const failures: string[] = [];
  for (const finding of [...present.keys()].sort()) {
    if (!recorded.includes(finding)) {
      failures.push(`${label}: not recorded in ${ACCESSIBILITY_LEDGER}: ${finding}\n${present.get(finding)}`);
    }
  }
  for (const finding of [...recorded].sort()) {
    if (!present.has(finding)) {
      failures.push(`${label}: recorded in ${ACCESSIBILITY_LEDGER} but no longer present: ${finding}`
        + `\n    the measurement no longer produces it, so the entry comes down in the same change.`);
    }
  }
  return failures;
}

/** How a failure tells a person to record what it just measured. */
function howToRecord(group: string, entry: UndersizedControl | KeyboardDivergence): string {
  return `    to record it, paste this into "${group}" in ${ACCESSIBILITY_LEDGER} and write its`
    + ` why, closing and blocker by hand:\n      ${JSON.stringify(entry)}`;
}

function sweepTargets(): SweepTarget[] {
  // Public pages first, and measured signed OUT: `/auth/sign-in` redirects a
  // signed-in account to `/overview`, so a sweep that signed in first would
  // measure the overview twice and the sign-in form never.
  const targets: SweepTarget[] = [
    ...PUBLIC_ROUTES.map(route => ({ route, url: route, auth: false })),
    ...Object.entries(DOCUMENTS).map(([route, url]) => ({ route, url, auth: false })),
    ...authenticatedRoutes().filter(route => route in VISIT)
      .map(route => ({ route, url: VISIT[route], auth: true })),
  ];
  if (targets.length <= MIN_SWEPT_ROUTES) {
    throw new Error(`route register yielded only ${targets.length} reachable pages`);
  }
  return targets;
}

/**
 * The account the authenticated half of every G1.13b sweep runs as. Its file
 * is uploaded once for the whole group rather than once per test: the four
 * measurements want the populated genome surfaces — a report page with a
 * result on it has controls, a tab order and a width that an empty state does
 * not — and generating them four times would cost four times as much for the
 * same pages.
 */
const G113B_ACCOUNT = {
  email: `a11y-g113b-${randomUUID()}@e2e.local`,
  password: "e2e-a11y-g113b-pw",
};

/** Names an element inside the page; shared by the three in-page measurements. */
type ElementProbe = {
  /** How every failure message below names an element. */
  describe: (element: Element) => string;
  /** How a recorded finding names the component an element is an instance of. */
  signature: (element: Element) => string;
  /** Rendered at all — a box to measure and a box a pointer could reach. */
  rendered: (element: Element) => boolean;
  /** Everything a person can operate: `e2e/helpers.ts`'s list plus the widget roles. */
  interactive: string;
  /** Scratch space for one keyboard pass, reset before each. */
  tab: { elements: Element[]; names: string[]; violations: string[]; counted: Element[] };
};

declare global {
  interface Window {
    __g113b?: ElementProbe;
    /** The component a trapped traversal ended inside, for the escape check. */
    __g113bTrap?: Element;
  }
}

/**
 * Installed before any navigation, so the in-page measurements share one
 * definition of "interactive", "rendered" and "how an element is named" — an
 * `evaluate` callback runs in the browser and cannot close over this file's
 * functions, and three divergent copies of a selector is exactly how the axe
 * bar drifted between five specs before `helpers.ts` held it in one place.
 */
async function installProbes(page: Page) {
  await page.addInitScript(() => {
    window.__g113b = {
      interactive: 'a[href],button,input:not([type="hidden"]),select,textarea,summary,'
        + '[role="button"],[role="link"],[role="switch"],[role="checkbox"],[role="radio"],'
        + '[role="tab"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],'
        + '[role="option"],[contenteditable="true"],[tabindex]:not([tabindex="-1"])',
      describe(element: Element) {
        const slot = element.getAttribute("data-slot");
        const name = element.getAttribute("aria-label")
          ?? (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
        return element.tagName.toLowerCase()
          + (element.id ? `#${element.id}` : "")
          + (slot ? `[data-slot=${slot}]` : "")
          + (name ? ` "${name}"` : "");
      },
      /**
       * How a recorded finding names the COMPONENT an element is an instance
       * of, where `describe` above names the instance. Built from the
       * element's own attributes and nothing else: `data-slot` is what this
       * codebase already puts on a component root, `data-variant` and
       * `data-size` are what `src/components/ui/button.tsx` puts on the one
       * component carrying a size scale, and an element with none of them is
       * placed by the nearest ancestor that has a slot.
       *
       * Never the accessible name: "Save" and "Delete" are two labels on one
       * component, and grouping by label would be a per-instance ledger with
       * extra steps. Where the nearest slotted ancestor differs between pages
       * one logical control lands in two signatures rather than one — the
       * grouping errs toward more rows, never toward a row that swallows a
       * finding.
       */
      signature(element: Element) {
        let bits = "";
        for (const attribute of ["data-variant", "data-size", "role"]) {
          const value = element.getAttribute(attribute);
          if (value) bits += `[${attribute}=${value}]`;
        }
        // The one distinction the tag name loses: a checkbox, a range and a
        // text field are three components wearing one element.
        if (element instanceof HTMLInputElement) bits = `[type=${element.type}]${bits}`;
        const tag = element.tagName.toLowerCase();
        const own = element.getAttribute("data-slot");
        if (own) return `${tag}[data-slot=${own}]${bits}`;
        const host = element.closest("[data-slot]")?.getAttribute("data-slot");
        return host ? `${tag}${bits} inside [data-slot=${host}]` : `${tag}${bits}`;
      },
      rendered(element: Element) {
        if (element.getClientRects().length === 0) return false;
        const style = getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none";
      },
      tab: { elements: [], names: [], violations: [], counted: [] },
    };
  });
}

/**
 * One pass over every reachable page — one load each, `measure` called with
 * the loaded page — returning how many pages were actually measured so a
 * caller can fail on a sweep that swept nothing.
 */
async function sweepPages(
  page: Page,
  measure: (target: SweepTarget) => Promise<void>,
): Promise<number> {
  let signedIn = false;
  let visited = 0;
  for (const target of sweepTargets()) {
    if (target.auth && !signedIn) {
      await signIn(page, G113B_ACCOUNT.email, G113B_ACCOUNT.password);
      signedIn = true;
    }
    const response = await page.goto(target.url);
    // A 404 would make every measurement below meaningless, and quietly: a
    // not-found page reflows, has no undersized control and traps nobody.
    expect.soft(response?.status(), `${target.url} resolves to a page`).toBe(200);
    await page.waitForLoadState("networkidle");
    await measure(target);
    visited++;
  }
  return visited;
}

test.describe("G1.13b: the accessibility measurements axe cannot make", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(600_000);
    await createConfirmedUser(G113B_ACCOUNT.email, G113B_ACCOUNT.password);
    // `browser.newContext()` does not inherit the project's `use`, so the
    // baseURL is handed over explicitly; without it `signIn`'s relative
    // navigation has nothing to resolve against.
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const page = await context.newPage();
    try {
      await signIn(page, G113B_ACCOUNT.email, G113B_ACCOUNT.password);
      await uploadOwnFileWithChosenReports(page, path.join(process.cwd(), TINY_FIXTURE),
        { fileType: "vcf", purposes: ["reports.polygenic"] });
    } finally {
      await context.close();
    }
  });

  /**
   * WCAG 2.1 SC 1.4.10 Reflow, at the width the success criterion is written
   * in: 320 CSS px of viewport, which is a different measurement from 200%
   * zoom (that is SC 1.4.4 Resize Text) and is not satisfied by testing one
   * of them for the other. 320 is also the brief's support floor (line 1063).
   *
   * The rule is the document's own: `scrollWidth <= clientWidth`. Brief line
   * 1063 permits exactly one element to scroll horizontally at 320 — the
   * embryo chip strip — and that permission needs no exemption list here,
   * because an element inside its own horizontal scroller never widens the
   * document: the scroller clips it. A strip that did widen the document
   * would be scrolling the page rather than itself, which is the failure the
   * line forbids for everything.
   */
  test("reflow: no page scrolls horizontally at a 320 CSS px viewport", async ({ page }) => {
    test.setTimeout(900_000);
    await installProbes(page);
    await page.setViewportSize({ width: 320, height: 568 });
    const sweptRoutes: string[] = [];
    const visited = await sweepPages(page, async ({ route }) => {
      sweptRoutes.push(route);
      const overflow = await page.evaluate(() => {
        const probe = window.__g113b;
        if (!probe) throw new Error("element probe not installed");
        const root = document.documentElement;
        if (root.scrollWidth <= root.clientWidth) return null;
        const limit = root.clientWidth;
        const wide: Element[] = [];
        const caught: Element[] = [];
        for (const element of document.querySelectorAll("*")) {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          // Only right-hand overflow widens the document in a left-to-right
          // page; content pushed past the left edge is unreachable, but it is
          // not something the reader can scroll to.
          if (rect.right <= limit) continue;
          let clipped = false;
          for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
            // Any computed overflow-x but `visible` clips or scrolls its
            // child, so the child cannot be what widened the page.
            if (getComputedStyle(parent).overflowX !== "visible") { clipped = true; break; }
          }
          if (clipped) { caught.push(element); continue; }
          wide.push(element);
        }
        // The outermost element of each subtree: a too-wide child of a
        // too-wide row is the symptom, the row is the cause.
        const causes = wide.filter(element =>
          !wide.some(other => other !== element && other.contains(element)));
        // When every candidate sits inside something that scrolls, `causes` is
        // empty and the report says nothing useful — which is exactly what
        // happened on the variant browser. What actually carries width upward
        // is an element wider than itself that does not clip, so name those
        // too: overflow-x visible, content wider than the box. The outermost
        // one is where the width escapes.
        const leaking: Element[] = [];
        for (const element of document.querySelectorAll("*")) {
          if (element.scrollWidth <= element.clientWidth + 1) continue;
          if (getComputedStyle(element).overflowX !== "visible") continue;
          if (element.clientWidth === 0) continue;
          leaking.push(element);
        }
        const escapes = leaking.filter(element =>
          !leaking.some(other => other !== element && other.contains(element)));
        return {
          // What has a box past the edge and what was supposed to be clipping
          // it. When `widest` is empty this is the only thing that says why.
          escaped: caught.slice(0, 6).map(element => {
            let clipper: Element | null = element.parentElement;
            while (clipper && getComputedStyle(clipper).overflowX === "visible") {
              clipper = clipper.parentElement;
            }
            return `${probe.describe(element)} reaches ${Math.round(element.getBoundingClientRect().right)}px`
              + `, inside ${clipper ? probe.describe(clipper) : "(nothing)"}`
              + ` which is ${clipper ? Math.round(clipper.getBoundingClientRect().width) : 0}px wide`;
          }),
          leaks: escapes.slice(0, 6).map(element =>
            `${probe.describe(element)} holds ${element.scrollWidth}px in a ${element.clientWidth}px box`),
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
          // Empty when nothing has a box past the edge — a margin, a
          // pseudo-element or a fixed-width table can widen the document with
          // no element of its own to name — so the two lengths are reported
          // either way rather than a failure with nothing in it.
          widest: causes.slice(0, 5).map(element =>
            `${probe.describe(element)} → right edge at ${Math.round(element.getBoundingClientRect().right)}px`),
        };
      });
      // Soft, so one run names every page that fails rather than the first.
      // One route is recorded rather than asserted, and only one. The ledger
      // carries its measured width, so the page can get narrower and never
      // wider, and a second route joining it fails as an unrecorded finding
      // rather than sliding in under the first.
      const recorded = reflowLedger().find(known => known.route === route);
      if (recorded) {
        expect.soft(overflow?.scrollWidth ?? 0,
          `${route} is recorded at ${recorded.scrollWidth} CSS px; a wider page is a regression, `
          + `and one that reflows must leave ${ACCESSIBILITY_LEDGER}`)
          .toBe(recorded.scrollWidth);
        return;
      }
      expect.soft(overflow, `${route} must reflow at 320 CSS px, not scroll sideways`).toBeNull();
    });
    // Both directions: a recorded route that now reflows has to leave the
    // ledger, or this fails naming it.
    for (const known of reflowLedger()) {
      expect.soft(sweptRoutes, `${known.route} is recorded in ${ACCESSIBILITY_LEDGER} but was not swept`)
        .toContain(known.route);
    }
    expect(visited, "the 320px sweep visited every reachable page").toBeGreaterThan(MIN_SWEPT_ROUTES);
  });

  /**
   * Target size at 390×844, against TARGET_SIZE above.
   *
   * Because the bar is stricter, SC 2.5.8's *spacing* exception (a 24px target
   * with a 24px undisturbed circle around it) does not apply and is not
   * implemented. One exception is: **Inline** — "the target is in a sentence,
   * or its size is otherwise constrained by the line-height of non-target
   * text" — applied by rule below (an inline-level control whose block carries
   * words of its own outside it), never by naming ids.
   *
   * Three of SC 2.5.8's other exceptions — Equivalent, Essential, and User
   * agent control — cannot be decided from the DOM: no attribute says that a
   * second control does the same job, that the size is legally required, or
   * that the author never touched it. None is applied. A control that
   * genuinely needs one has to earn it in the brief rather than in a test.
   *
   * Not measured: a hit area enlarged by an absolutely positioned
   * pseudo-element. `getComputedStyle(element, "::after")` returns styles, not
   * a box, and no DOM API returns a pseudo-element's rectangle, so such a
   * control measures as its own box here and would be reported.
   *
   * Recorded, not asserted, against `targetSize` in the ledger, because the
   * finding is one design decision and not a list of bugs: the size scale in
   * `src/components/ui/button.tsx` has no 44px step, and adding one changes
   * the height of every control in the product. Nothing here is weakened to
   * accommodate that — the bar is still 44, every control is still measured,
   * every undersized one is still counted, and the comparison runs in both
   * directions so the recorded set can only shrink.
   */
  test("target size: every control is at least 44x44 CSS px at 390x844", async ({ page }) => {
    test.setTimeout(900_000);
    await installProbes(page);
    await page.setViewportSize({ width: 390, height: 844 });
    let measured = 0;
    /** Every undersized control, gathered by component rather than by page. */
    const components = new Map<string, {
      smallestWidth: number;
      smallestHeight: number;
      routes: Set<string>;
      occurrences: number;
      examples: string[];
    }>();
    let occurrences = 0;
    const visited = await sweepPages(page, async ({ route }) => {
      const result = await page.evaluate((minimum) => {
        const probe = window.__g113b;
        if (!probe) throw new Error("element probe not installed");
        const inlineDisplays = new Set(["inline", "contents", "ruby", "ruby-text"]);
        const interactive = probe.interactive;
        /** SC 2.5.8's Inline exception, as a rule rather than a list. */
        function inSentence(element: Element): boolean {
          // A flex or grid child is blockified by CSS, so its computed
          // display is never `inline`: a control laid out as a box beside a
          // paragraph is not "in a sentence", and this is what tells them
          // apart without naming either.
          if (getComputedStyle(element).display !== "inline") return false;
          let block: Element | null = element.parentElement;
          while (block && inlineDisplays.has(getComputedStyle(block).display)) block = block.parentElement;
          if (!block) return false;
          const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
          let outside = "";
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const parent = node.parentElement;
            if (!parent || element.contains(node)) continue;
            // Another control's own label is not the sentence this one sits
            // in: a row of links separated by dots is a row of targets.
            if (parent.closest(interactive)) continue;
            outside += node.nodeValue ?? "";
          }
          // Two adjacent letters: a word, not a separator or a bullet.
          return /[a-z]{2,}/i.test(outside);
        }
        const undersized: { component: string; element: string; width: number; height: number }[] = [];
        const round = (value: number) => Math.round(value * 10) / 10;
        let counted = 0;
        for (const element of document.querySelectorAll(probe.interactive)) {
          if (!probe.rendered(element)) continue;
          // An inactive control accepts no pointer action, so it is not a
          // target; it becomes one when it is enabled, in the state a test
          // that enables it measures.
          if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") continue;
          // Neither in the accessibility tree nor in the tab order: plumbing
          // driven by a control of its own — the sr-only file input behind
          // "Choose file" — and that control is measured on its own account.
          if (element.getAttribute("tabindex") === "-1" && element.closest('[aria-hidden="true"]')) continue;
          let rect = element.getBoundingClientRect();
          let state = "";
          // A control that is visually hidden until it takes focus (the skip
          // link) is measured in the state a person can see and hit. Skipping
          // it would measure nothing; measuring its parked 1×1 clipped box
          // would measure the wrong thing.
          if (rect.width <= 1 && rect.height <= 1
            && (element instanceof HTMLElement || element instanceof SVGElement)) {
            const previous = document.activeElement;
            element.focus();
            rect = element.getBoundingClientRect();
            state = " (focused)";
            element.blur();
            if (previous instanceof HTMLElement || previous instanceof SVGElement) previous.focus();
          }
          let { left, right, top, bottom } = rect;
          // A labelled control is activated by its label too, so the target
          // is the area of both — the checkbox plus the words that toggle it.
          // A 1×1 label is the sr-only kind, which is a name, not an area.
          const labelled = element instanceof HTMLInputElement || element instanceof HTMLSelectElement
            || element instanceof HTMLTextAreaElement || element instanceof HTMLButtonElement;
          if (labelled && element.labels) {
            for (const label of element.labels) {
              if (!probe.rendered(label)) continue;
              const box = label.getBoundingClientRect();
              if (box.width <= 1 || box.height <= 1) continue;
              left = Math.min(left, box.left); right = Math.max(right, box.right);
              top = Math.min(top, box.top); bottom = Math.max(bottom, box.bottom);
            }
          }
          counted++;
          const width = right - left;
          const height = bottom - top;
          if (width >= minimum && height >= minimum) continue;
          if (inSentence(element)) continue;
          undersized.push({
            component: probe.signature(element),
            element: `${probe.describe(element)}${state}`,
            width: round(width),
            height: round(height),
          });
        }
        return { counted, undersized };
      }, TARGET_SIZE);
      measured += result.counted;
      for (const finding of result.undersized) {
        occurrences++;
        const seen = components.get(finding.component) ?? {
          smallestWidth: Number.POSITIVE_INFINITY,
          smallestHeight: Number.POSITIVE_INFINITY,
          routes: new Set<string>(),
          occurrences: 0,
          examples: [],
        };
        seen.smallestWidth = Math.min(seen.smallestWidth, finding.width);
        seen.smallestHeight = Math.min(seen.smallestHeight, finding.height);
        seen.routes.add(route);
        seen.occurrences++;
        // Enough of the evidence to act on, not all of it: the same component
        // on the fiftieth page says nothing the first three did not.
        if (seen.examples.length < 3) {
          seen.examples.push(`      ${route} → ${finding.element} — ${finding.width}x${finding.height}`);
        }
        components.set(finding.component, seen);
      }
    });
    // Floors first: an empty or half-broken scan must fail as itself rather
    // than as a ledger full of findings that "no longer occur".
    expect(visited, "the target-size sweep visited every reachable page").toBeGreaterThan(MIN_SWEPT_ROUTES);
    expect(measured, "the target-size sweep measured controls rather than an empty selector")
      .toBeGreaterThan(MIN_MEASURED_TARGETS);

    const present = new Map<string, string>();
    for (const [component, seen] of components) {
      const entry: UndersizedControl = {
        component,
        smallestWidth: Math.round(seen.smallestWidth),
        smallestHeight: Math.round(seen.smallestHeight),
      };
      present.set(undersizedControlFinding(entry),
        `    undersized ${seen.occurrences} times on ${seen.routes.size} of the ${visited} swept routes`
        + `; first ${seen.examples.length}:\n${seen.examples.join("\n")}\n`
        + howToRecord("targetSize", entry));
    }
    const failures = compareToLedger("target size", present, accessibilityLedger().targetSize);
    if (UNDERSIZED_CONTROL_OCCURRENCES < 0) {
      failures.push(`target size: the sweep reports ${occurrences} undersized (page, control) pairs`
        + ` across ${components.size} components, and UNDERSIZED_CONTROL_OCCURRENCES in`
        + ` e2e/a11y.spec.ts has never been measured. Write ${occurrences} there — it is the`
        + ` volume the per-component ledger collapses, and it is a ratchet, not a ceiling.`);
    } else if (occurrences !== UNDERSIZED_CONTROL_OCCURRENCES) {
      failures.push(`target size: the sweep reports ${occurrences} undersized (page, control) pairs`
        + ` and UNDERSIZED_CONTROL_OCCURRENCES in e2e/a11y.spec.ts says`
        + ` ${UNDERSIZED_CONTROL_OCCURRENCES}. Fixing a control lowers that number in the same`
        + ` change; a rise means a control shrank or a page arrived carrying one.`);
    }
    expect(failures.join("\n\n"),
      `target size: the sweep and ${ACCESSIBILITY_LEDGER} must say the same thing, in both directions`)
      .toBe("");
  });

  /**
   * Keyboard traversal of every page: tab order equal to DOM order, and no
   * trap.
   *
   * Order is checked pair by pair against `compareDocumentPosition` rather
   * than against a list snapshotted before the first Tab. A snapshot goes
   * stale the moment focus itself changes the page — the ancestry map opens
   * its region panel on focus, and a tooltip with a focus equivalent adds a
   * node — and the property under test is a relation between consecutive
   * stops, not a fixed list.
   *
   * What cannot be measured here: Playwright cannot see the browser's own
   * chrome, so "Tab from the last control returns to the browser" is observed
   * as the two states that are visible from inside the document — focus
   * leaving it altogether (`document.activeElement` back to the body, which
   * is what a browser with chrome does as it hands focus to the address bar),
   * or the cycle restarting at the document's first tab stop, which is what a
   * headless browser with no chrome to hand focus to does instead. A trap
   * looks like neither: focus returns to something that is not the first stop,
   * or it never stops arriving somewhere new at all. Those are the failures.
   * A trap that wrapped the *entire* page would be indistinguishable from the
   * headless wrap and is the one case this cannot separate.
   *
   * Recorded, not asserted, against `keyboardTraversal` in the ledger. The
   * trap it finds is a WCAG 2.1 SC 2.1.2 Level A defect inside igv.js 3.8.5,
   * whose DOM `src/components/browse/genome-browser.tsx` post-processes and
   * does not own, so it cannot be closed from here — and a Level A failure is
   * exactly the kind of thing that has to be written down rather than left as
   * a red test everyone learns to scroll past. Nothing is softened: the same
   * three properties are measured on the same pages at the same two widths,
   * and a finding that is not in the ledger fails as loudly as it did before.
   */
  test("keyboard traversal: tab order is DOM order, and no page traps focus", async ({ page }) => {
    test.setTimeout(1_500_000);
    await installProbes(page);
    // 320 and 390 render the same chrome, so the phone tab order is measured
    // once; the desktop width is the one where `app-nav` shows its sidebar
    // instead of the bottom bar, which is a different order over the same DOM.
    const viewports = AXE_VIEWPORTS.filter(viewport => viewport.width !== 320);
    let stops = 0;
    // Traps that ship no working, advertised escape. Not a ledger: SC 2.1.2
    // has no honest interim for one, so it fails outright.
    const unescapable: string[] = [];
    let escapesProven = 0;
    const present = new Map<string, string>();
    const record = (entry: KeyboardDivergence, evidence: string) =>
      present.set(keyboardFinding(entry), `${evidence}\n${howToRecord("keyboardTraversal", entry)}`);
    const visited = await sweepPages(page, async ({ route }) => {
      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        // Resizing is not instant: traverse the layout the width produced.
        await page.waitForFunction(width => window.innerWidth === width, viewport.width);
        const pass = await tabThrough(page);
        stops += pass.stops;
        const at = { route, viewport: viewport.label };
        if (pass.violations.length > 0) {
          record({ kind: "order", ...at, violations: pass.violations.length },
            `    tab order must follow DOM order and never return; it did neither:\n`
            + pass.violations.map(violation => `      ${violation}`).join("\n"));
        }
        if (pass.exit !== "left-document" && pass.exit !== "wrapped") {
          record({ kind: "exit", ...at, last: pass.last, outcome: pass.exit },
            `    Tab past the last control (${pass.last}) must leave the page, not loop inside it;`
            + ` the traversal ended ${pass.exit} after ${pass.stops} stops`);
          // A trap is recorded above as the tab-order defect it is, and
          // separately required to be escapable here. The two are different
          // claims: the first is about Tab, the second is what SC 2.1.2
          // actually demands, and only the second has no acceptable interim.
          if (pass.exit === "trapped") {
            const unescaped = await escapeLeavesTheTrap(page);
            if (unescaped) unescapable.push(`  ${route} at ${viewport.label}\n${unescaped}`);
            else escapesProven++;
          }
        }
        if (pass.stops < pass.expected) {
          record({ kind: "stops", ...at, reached: pass.stops, expected: pass.expected },
            `    never reached: ${pass.unreached.slice(0, 12).join(", ") || "(none named)"}\n`
            + `    ${pass.expected - pass.stops} of this page's certainly-tabbable elements were never`
            + ` reached (${pass.stops} of ${pass.expected}); the traversal ended ${pass.exit} at`
            + ` ${pass.last}`);
        }
      }
    });
    // Floors first: an empty or half-broken scan must fail as itself rather
    // than as a ledger full of findings that "no longer occur".
    expect(visited, "the keyboard sweep visited every reachable page").toBeGreaterThan(MIN_SWEPT_ROUTES);
    expect(stops, "the keyboard sweep reached tab stops rather than nothing").toBeGreaterThan(MIN_TAB_STOPS);
    expect(unescapable.join("\n\n"),
      "WCAG 2.1 SC 2.1.2: focus that Tab cannot carry out of a component must be movable out by a"
      + " key the component's own description names")
      .toBe("");
    // A floor on the escape check itself. The ledger records a trap on the
    // variant browser, so this sweep must have exercised at least one escape;
    // zero would mean the check silently stopped running rather than that the
    // product stopped trapping — and the ledger comparison below would then
    // be the only thing left saying the trap exists.
    expect(escapesProven,
      "the escape check ran on the trap the ledger records, rather than on nothing")
      .toBeGreaterThan(0);
    expect(compareToLedger("keyboard traversal", present, accessibilityLedger().keyboard).join("\n\n"),
      `keyboard traversal: the sweep and ${ACCESSIBILITY_LEDGER} must say the same thing, in both directions`)
      .toBe("");
  });

  /**
   * The text alternatives: the interactive ancestry map and every chart.
   *
   * The brief asks for each to be "reachable as an equivalent list-and-text
   * route". The shipped design answers with something stricter than a route:
   * the map's table (`src/components/results/ancestry/region-list.tsx`) is on
   * the page beside it in zero activations, and the grey state's raw numbers
   * are one keyboard-operable `<summary>` away. This test holds that stronger
   * form — an equivalent inside the figure, referenced by it, or beside it in
   * its own container — because no separate list route exists in
   * `docs/route-register.json` to hold the literal one.
   *
   * "Reachable without a pointer" is measured, not assumed: an equivalent
   * behind a closed `<details>` is opened here by focusing its summary and
   * pressing Enter. That the summary is itself reachable by Tab is the
   * keyboard test above.
   */
  test("text alternatives: the ancestry map and every chart have an equivalent list and text", async ({ page }) => {
    test.setTimeout(900_000);
    await installProbes(page);
    expect(Object.keys(VISIT), "the ancestry route this test names is still the registered one")
      .toContain(ANCESTRY_ROUTE);
    let figures = 0;
    let mapSeen = false;
    const visited = await sweepPages(page, async ({ route }) => {
      const found = await page.evaluate(() => {
        const probe = window.__g113b;
        if (!probe) throw new Error("element probe not installed");
        const candidates = new Set<Element>();
        // `<figure>` is the container this design gives a chart, so it is the
        // rule rather than a list of known charts: a new one is measured the
        // day it renders.
        for (const figure of document.querySelectorAll("figure")) candidates.add(figure);
        for (const graphic of document.querySelectorAll("svg,canvas")) {
          if (graphic.closest('[aria-hidden="true"]')) continue;
          // A graphic announced as content is a picture of something; an
          // unnamed icon beside a word is not, and demanding a table of every
          // chevron would measure nothing.
          const named = graphic.hasAttribute("aria-label") || graphic.hasAttribute("aria-labelledby")
            || graphic.getAttribute("role") === "img" || graphic.querySelector(":scope > title") !== null;
          if (!named) continue;
          candidates.add(graphic.closest("figure") ?? graphic);
        }
        const findings: string[] = [];
        const disclosures: { index: number; name: string }[] = [];
        let checked = 0;
        for (const candidate of candidates) {
          if (!probe.rendered(candidate)) continue;
          checked++;
          const name = probe.describe(candidate);
          // The text half: a caption or an accessible name.
          if (!(candidate.querySelector("figcaption") !== null
            || candidate.hasAttribute("aria-label") || candidate.hasAttribute("aria-labelledby")
            || candidate.querySelector("svg[aria-label],svg[aria-labelledby],svg > title") !== null)) {
            findings.push(`${name}: no caption and no accessible name`);
          }
          // What the picture exposes to a reader: a part that is focusable,
          // named or given a role. The grey ancestry map exposes none — every
          // region is aria-hidden and nothing is focusable — so it is a
          // picture of nothing and has nothing for a list to restate.
          const parts = [...candidate.querySelectorAll(
            '[tabindex]:not([tabindex="-1"]),[role="button"],[role="img"],[role="graphics-symbol"],[aria-label]')]
            .filter(part => part.closest('[aria-hidden="true"]') === null)
            .filter(part => part.tagName.toLowerCase() !== "svg" && part.tagName.toLowerCase() !== "canvas");
          // Where an equivalent may live: inside the figure, on the far end of
          // its own aria-describedby/aria-details, or beside it in the
          // container that holds them both. Navigation is not an equivalent.
          const scope: Element[] = [candidate];
          if (candidate.parentElement) scope.push(candidate.parentElement);
          for (const attribute of ["aria-describedby", "aria-details"]) {
            for (const id of (candidate.getAttribute(attribute) ?? "").split(/\s+/).filter(Boolean)) {
              const target = document.getElementById(id);
              if (target) scope.push(target);
            }
          }
          let equivalent: Element | null = null;
          for (const region of scope) {
            for (const list of region.querySelectorAll("table,ul,ol,dl")) {
              if (list.closest('[aria-hidden="true"]') || list.closest("nav,header,footer")) continue;
              equivalent = list;
              break;
            }
            if (equivalent) break;
          }
          if (parts.length > 0 && !equivalent) {
            findings.push(`${name}: ${parts.length} parts of the picture are exposed`
              + ` (${probe.describe(parts[0])}…) and no list or table restates them`);
          }
          if (parts.length === 0 && !equivalent) {
            // The words BESIDE the picture, never its own caption: a caption
            // names a figure, and a figure that states nothing has to be
            // answered by a sentence that says so ("we could not read enough
            // of your file"), which is a different piece of text.
            let beside = "";
            const container = candidate.parentElement;
            if (container) {
              const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
              for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                if (candidate.contains(node)) continue;
                beside += node.nodeValue ?? "";
              }
            }
            if (!/[a-z]{2,}/i.test(beside)) findings.push(`${name}: no list, no table and no sentence beside it`);
          }
          if (equivalent) {
            const details = equivalent.closest("details");
            if (details && !details.open) {
              const summary = details.querySelector(":scope > summary");
              if (!summary) {
                findings.push(`${name}: its list is inside a closed <details> with no <summary>, so no keyboard opens it`);
              } else {
                summary.setAttribute("data-g113b-disclosure", String(disclosures.length));
                disclosures.push({ index: disclosures.length, name });
              }
            } else if (!probe.rendered(equivalent)) {
              findings.push(`${name}: ${probe.describe(equivalent)} is in the DOM but is not rendered`);
            }
          }
        }
        return { checked, findings, disclosures };
      });
      figures += found.checked;
      expect.soft(found.findings,
        `${route}: every chart needs an equivalent list and text`).toEqual([]);
      for (const disclosure of found.disclosures) {
        const summary = page.locator(`[data-g113b-disclosure="${disclosure.index}"]`);
        await summary.focus();
        await page.keyboard.press("Enter");
        expect.soft(
          await summary.evaluate(element =>
            element.parentElement instanceof HTMLDetailsElement && element.parentElement.open),
          `${route}: the list behind ${disclosure.name} opens without a pointer`).toBe(true);
      }
      if (route !== ANCESTRY_ROUTE) return;
      mapSeen = true;
      const map = page.locator('[data-slot="ancestry-map"]');
      const maps = await map.count();
      // Softly, and then out: a hard failure here would stop the sweep at
      // this page instead of reporting it with the rest.
      expect.soft(maps, "the ancestry page draws its map").toBe(1);
      if (maps !== 1) return;
      if (await map.getAttribute("data-mode") === "shown") {
        const drawn = await page.locator('[data-slot="ancestry-map"] path[data-region]').count();
        const focusable = await page.locator('[data-slot="ancestry-map"] path[data-region][tabindex="0"]').count();
        const rows = await page.locator('[data-slot="region-row"]:not([hidden])').count();
        await expect.soft(page.locator('[data-slot="region-table"]'),
          "the map's equivalent table is on the page, in no activations").toBeVisible();
        expect.soft(focusable, "every region drawn on the map is reachable without a pointer").toBe(drawn);
        expect.soft(rows, "every region drawn on the map has a row of its own in the table").toBe(drawn);
      } else {
        // A grey map states nothing — too few markers were read — so there is
        // nothing for a list to restate; what has to be there is the sentence
        // saying so, and (in the grey state) the raw numbers behind a summary,
        // which the sweep above opened from the keyboard.
        expect.soft(await page.locator('[data-slot="ancestry-map"] path[tabindex="0"]').count(),
          "a grey map states nothing, so it offers nothing to focus").toBe(0);
        await expect.soft(page.locator('[data-slot="grey-state"], [data-slot="nothing-read"]').first(),
          "a grey map says in words why it is grey").toBeVisible();
      }
    });
    expect(visited, "the text-alternative sweep visited every reachable page").toBeGreaterThan(MIN_SWEPT_ROUTES);
    // An empty scan is the silent way to pass this one: no figure found, no
    // alternative demanded. The ancestry map renders in every state, so the
    // sweep has seen at least it.
    expect(figures, "the sweep found charts to check rather than none").toBeGreaterThan(0);
    expect(mapSeen, "the sweep reached the ancestry map's own route").toBe(true);
  });
});

/** How one traversal ended, as seen from inside the document. */
type TabExit = "left-document" | "wrapped" | "trapped" | "exhausted";
type TabPass = { stops: number; expected: number; exit: TabExit; violations: string[]; last: string;
  unreached: string[] };

/**
 * A hang guard, not a measurement: a traversal ends by itself at the body or
 * at the first element it reaches twice, so this cap is only ever reached by a
 * page that keeps handing focus to something new. Reaching it is reported as
 * `exhausted`, which fails.
 */
const TAB_PRESS_CAP = 500;

async function tabThrough(page: Page): Promise<TabPass> {
  const expected = await page.evaluate(() => {
    const probe = window.__g113b;
    if (!probe) throw new Error("element probe not installed");
    probe.tab = { elements: [], names: [], violations: [], counted: [] };
    // A floor, not a census. Radio inputs are left out (exactly one of a group
    // is tabbable and which one depends on which is checked), so is anything
    // carrying tabindex="-1" (the roving chip strip parks its other chips
    // there), and so is every ARIA-role widget that is not natively focusable.
    // The count can only come out lower than the truth, which is what a "did
    // the traversal actually reach this page" assertion needs.
    let count = 0;
    for (const element of document.querySelectorAll(
      'a[href],button,input,select,textarea,summary,[tabindex="0"]')) {
      if (!probe.rendered(element)) continue;
      if (element.getAttribute("tabindex") === "-1") continue;
      if (element.matches(":disabled")) continue;
      if (element.matches('input[type="hidden"],input[type="radio"]')) continue;
      // Only the first summary of a <details> is a tab stop.
      if (element.tagName === "SUMMARY" && !(element.parentElement?.tagName === "DETAILS"
        && element.parentElement.firstElementChild === element)) continue;
      // A control inside a closed <details> is correctly not a tab stop: the
      // summary that opens it is one, and it is counted and reached. Chromium
      // still hands these descendants client rects, so `rendered` says yes and
      // the count came out eight too high on the report library, whose eight
      // category jump links live behind exactly such a disclosure. That read as
      // eight controls a keyboard could not reach; they are reachable, one Tab
      // and one Enter away. Counting them was the bug, not the page.
      const closed = element.closest("details:not([open])");
      if (closed && !(element.tagName === "SUMMARY" && element.parentElement === closed)) continue;
      count++;
      probe.tab.counted.push(element);
    }
    // Where the next Tab starts from. tabindex="-1" adds no tab stop, but
    // focusing the root resets Chromium's sequential-navigation starting
    // point, so the second pass over a page starts at the top rather than
    // continuing from wherever the first one ended.
    document.documentElement.tabIndex = -1;
    document.documentElement.focus();
    return count;
  });
  let exit: TabExit = "exhausted";
  for (let press = 0; press < TAB_PRESS_CAP; press++) {
    await page.keyboard.press("Tab");
    const step = await page.evaluate(() => {
      const probe = window.__g113b;
      if (!probe) throw new Error("element probe not installed");
      const log = probe.tab;
      const active = document.activeElement;
      // Nothing in the page holds focus any more: in a browser with chrome
      // this is the Tab that hands focus to the address bar.
      if (!active || active === document.body || active === document.documentElement) return "left-document";
      const seen = log.elements.indexOf(active);
      if (seen === 0) return "wrapped";
      if (seen > 0) {
        log.violations.push(`focus returned to ${log.names[seen]}`
          + ` (stop ${seen + 1} of ${log.elements.length}) instead of leaving the page`);
        return "trapped";
      }
      const name = probe.describe(active);
      const previous = log.elements[log.elements.length - 1];
      if (previous && previous.isConnected) {
        if (!(previous.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          log.violations.push(`${log.names[log.names.length - 1]} → ${name} moves backwards in the DOM`);
        }
      } else if (previous) {
        // A detached node answers `compareDocumentPosition` with an
        // implementation-specific order, so this is reported, not judged.
        log.violations.push(`${log.names[log.names.length - 1]} left the DOM while it held focus`);
      }
      log.elements.push(active);
      log.names.push(name);
      return "advancing";
    });
    if (step !== "advancing") { exit = step; break; }
  }
  const log = await page.evaluate(() => {
    const probe = window.__g113b;
    if (!probe) throw new Error("element probe not installed");
    return {
      stops: probe.tab.elements.length,
      violations: probe.tab.violations,
      last: probe.tab.names[probe.tab.names.length - 1] ?? "(no tab stop at all)",
      // A shortfall is only worth recording if it can be acted on, and "eight
      // stops missing" cannot. These are the counted elements Tab never landed
      // on, named, so the next person reads which controls a keyboard cannot
      // reach rather than how many.
      unreached: probe.tab.counted
        .filter(element => !probe.tab.elements.includes(element))
        .map(element => probe.describe(element)),
    };
  });
  return { ...log, expected, exit };
}

/**
 * WCAG 2.1 SC 2.1.2 in the half that the Tab traversal above cannot see.
 *
 * The criterion is not "Tab always leaves". It is that focus can be moved
 * away using only the keyboard, and that if the key is not an unmodified
 * arrow or Tab, the reader is told which key it is. So a page whose Tab order
 * loops inside a widget still conforms — but only if it ships a working
 * escape AND says so on the page. This checks both, on whatever page the
 * traversal ended trapped, and it is a plain failure rather than a ledger
 * entry: an unescapable trap is a Level A failure with no honest interim.
 *
 * "Told which key" is read from the accessible description of the component
 * focus is stuck in, because that is what a reader arriving by Tab actually
 * hears; a sentence rendered somewhere on the page that the component does
 * not reference would pass a text search and help nobody.
 */
async function escapeLeavesTheTrap(page: Page): Promise<string | null> {
  const trapped = await page.evaluate(() => {
    const probe = window.__g113b;
    if (!probe) throw new Error("element probe not installed");
    const active = document.activeElement;
    if (!active || active === document.body) return null;
    // The component, not the control: the region, dialog or application the
    // stuck control sits in, which is the thing SC 2.1.2 talks about.
    const region = active.closest('[role="region"],[role="application"],[role="dialog"],[role="group"]')
      ?? active;
    window.__g113bTrap = region;
    const described = (region.getAttribute("aria-describedby") ?? "")
      .split(/\s+/).filter(Boolean)
      .map(id => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    return { region: probe.describe(region), described };
  });
  if (!trapped) return null;
  // Named, not inferred from a key list: if the page advertises a different
  // key this reads it and presses that instead, so the check follows the
  // page's own statement rather than assuming Escape.
  const advertised = /\b(Escape|Esc)\b/i.test(trapped.described) ? "Escape" : null;
  if (!advertised) {
    return `    ${trapped.region} traps focus and its accessible description does not name a key`
      + ` that moves focus out of it. WCAG 2.1 SC 2.1.2 needs both: a working escape, and the`
      + ` reader told which key it is.\n      described as: ${trapped.described || "(nothing)"}`;
  }
  await page.keyboard.press(advertised);
  const left = await page.evaluate(() => {
    const probe = window.__g113b;
    const region = window.__g113bTrap;
    if (!probe || !region) throw new Error("trap probe not installed");
    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement) {
      return { out: true, where: "(left the page)" };
    }
    return {
      out: !region.contains(active),
      where: probe.describe(active),
      // Moving focus BACKWARDS out of the trap would satisfy the letter and
      // strand the reader before the widget they just left, so where it lands
      // is reported rather than only whether it left.
      forward: (region.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    };
  });
  if (!left.out) {
    return `    ${trapped.region} advertises ${advertised} as its escape and pressing it left focus`
      + ` inside the trap, at ${left.where}`;
  }
  if (left.forward === false) {
    return `    ${trapped.region} advertises ${advertised} as its escape and pressing it moved focus`
      + ` BACKWARDS, to ${left.where}, stranding the reader before the widget they left`;
  }
  return null;
}
