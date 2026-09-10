import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { reportNameOf } from "../src/lib/genome/reports";
import { headingFailures, jargonTerms } from "../scripts/first-glance-rules";

/**
 * G3.5's browser half. The brief asks for the first-glance test in E2E, and
 * `scripts/first-glance-gate.ts` covers all 163 committed headings — but only
 * as strings. This proves the rule is about the heading the page renders.
 *
 * Two things are asserted, and the first is what makes the gate mean anything:
 * the rendered `h1` is exactly `reportNameOf(template.title)`, the string the
 * gate checked. Then the same `headingFailures` used by the gate runs against
 * the rendered text, so a page that built its heading some other way is caught
 * here rather than passing because the data was fine.
 *
 * `reportNameOf` was moved into `src/lib/genome/reports.ts` for this: it used
 * to be private to the report page, so the gate would have had to keep a
 * second copy and the two could drift apart silently.
 */
const RUN_ID = randomUUID();
const USER = { email: `first-glance-${RUN_ID}@e2e.local`, password: "e2e-first-glance-pw" };
const TINY_FIXTURE = "e2e/fixtures/tiny-grch38.vcf";
const SLUG = "caffeine-metabolism-cyp1a2-rs762551";

/** The committed title for the report under test, read rather than retyped. */
function committedTitle(slug: string): string {
  for (const name of fs.readdirSync("data/templates")) {
    if (!name.endsWith(".json")) continue;
    const templates = JSON.parse(
      fs.readFileSync(path.join("data/templates", name), "utf8")) as { slug: string; title: string }[];
    const found = templates.find(template => template.slug === slug);
    if (found) return found.title;
  }
  throw new Error(`No committed template for ${slug}`);
}

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

test("the rendered first heading is the string the gate checks, and passes the same rules", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, USER.email, USER.password);
  await uploadOwnFileWithChosenReports(page, path.join(process.cwd(), TINY_FIXTURE),
    { fileType: "vcf", purposes: ["reports.polygenic"] });

  await page.goto(`/genome/me/reports/${SLUG}`);
  const heading = page.locator("main h1");
  await expect(heading).toHaveCount(1);
  const rendered = (await heading.innerText()).trim();

  const title = committedTitle(SLUG);
  expect(rendered, "the page renders the name the gate checks, not the full title")
    .toBe(reportNameOf(title));
  expect(title, "this report's title carries a gene suffix, so the two differ and the check is real")
    .not.toBe(reportNameOf(title));

  // The gate's own rules, against what the browser showed.
  expect(headingFailures(`rendered ${SLUG}`, rendered, jargonTerms())).toEqual([]);
});
