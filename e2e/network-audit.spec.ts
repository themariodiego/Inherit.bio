import { uploadOwnFilePrepared } from "./own-report-helpers";
import { expect, test } from "@playwright/test";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertNoThirdParty, createConfirmedUser, signIn, watchRequests } from "./helpers";

// A14 — the network audit as an E2E test over REAL rendered pages: the set
// of request origins on landing, dashboard, and a report page must be
// exactly the first-party allowlist. Fonts are self-hosted via next/font,
// so not even Google Fonts appears at runtime. Also asserts no Meta pixel
// (window.fbq) and no known tracker hosts. This is the CI gate version of
// the incumbent's failure mode (a Meta pixel visible only in the live DOM).

const USER = { email: `netaudit-${randomUUID()}@e2e.local`, password: "e2e-netaudit-pw" };

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

test("landing page contacts no third-party origin", async ({ page }) => {
  const observed = watchRequests(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await assertNoThirdParty(page, observed, "landing");
});

test("providers page contacts no third-party origin", async ({ page }) => {
  const observed = watchRequests(page);
  await page.goto("/providers");
  await page.waitForLoadState("networkidle");
  await assertNoThirdParty(page, observed, "providers");
});

test("dashboard contacts no third-party origin", async ({ page }) => {
  const observed = watchRequests(page);
  await signIn(page, USER.email, USER.password);
  await page.waitForLoadState("networkidle");
  await assertNoThirdParty(page, observed, "dashboard");
});

test("a report page contacts no third-party origin", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/genome/me/reports");
  await page.waitForLoadState("networkidle");
  const firstReport = page.locator('a[href^="/genome/me/reports/"]').first();
  const observed = watchRequests(page);
  if ((await firstReport.count()) > 0) {
    await firstReport.click();
    await page.waitForLoadState("networkidle");
  }
  await assertNoThirdParty(page, observed, "report");
});

// The browse page embeds igv.js, which by default phones home to igv.org
// (its genome registry and url_mappings.tsv). The page claims "no external
// genome service is contacted" — this test is the CI enforcement of that
// claim: it renders the real igv browser over a processed file and asserts
// the origin set stays first-party.
test("browse page with the embedded genome browser contacts no third-party origin", async ({
  page,
}) => {
  const user = {
    email: `netaudit-browse-${randomUUID()}@e2e.local`,
    password: "e2e-netaudit-browse-pw",
  };
  await createConfirmedUser(user.email, user.password);
  await signIn(page, user.email, user.password);
  await uploadOwnFilePrepared(page, path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"), { fileType: "vcf" });

  const observed = watchRequests(page);
  // rs762551 is a non-ref call in the tiny fixture, so the search returns a
  // table hit and mounts igv at its locus.
  await page.goto("/genome/me/data/browser?q=rs762551");
  await expect(page.getByTestId("genome-browser")).toBeVisible();
  // igv has finished initializing (reference + track loads, and any
  // phone-home attempts) once its canvas exists.
  await expect(
    page.getByTestId("genome-browser").locator("canvas").first(),
  ).toBeVisible({ timeout: 60_000 });
  await page.waitForLoadState("networkidle");
  await assertNoThirdParty(page, observed, "browse");
});

test("legal pages contact no third-party origin", async ({ page }) => {
  const observed = watchRequests(page);
  for (const route of ["/privacy", "/terms", "/about"]) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
  }
  await assertNoThirdParty(page, observed, "legal");
});
