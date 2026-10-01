import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { assertNoThirdParty, axeViolations, createConfirmedUser, signIn, watchRequests } from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { PUBLIC_ROUTES, TINY_FIXTURE, VISIT, DOCUMENTS, CHECKED_ELSEWHERE, registeredPages, authenticatedRoutes } from "./accessibility-sweeps";

const AUTHENTICATED_ACCOUNT = {
  email: `a11y-auth-${randomUUID()}@e2e.local`,
  password: "e2e-a11y-auth-pw",
};

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
