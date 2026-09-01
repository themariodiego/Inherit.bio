import { expect, test } from "@playwright/test";
import { createConfirmedUser, ingestFileAs, signIn } from "./helpers";
import path from "node:path";

// A15 — legal pages complete; placeholder-grep gate passes (run separately as
// pnpm gate:legal); disclaimers verified present on report SURFACES by E2E
// (not only in ToS). Also checks the eight required legal sections exist and
// the Plus Bio separate-service disclosure is present and accurate.

const REQUIRED = [
  { route: "/privacy", must: [/children/i, /genetic data/i, /change of control|change-of-control/i, /deletion/i, /export/i] },
  { route: "/terms", must: [/18|eighteen/i, /not medical advice|informational/i, /export/i, /AGPL/i] },
  { route: "/legal/research-consent", must: [/consent/i] },
  { route: "/legal/law-enforcement", must: [/law enforcement/i, /transparency/i, /0\b/] },
  { route: "/legal/deceased", must: [/deceased|next of kin|next-of-kin/i, /death certificate/i] },
  { route: "/legal/gina", must: [/GINA/i, /life insurance/i, /disability/i, /long[- ]term[- ]care/i] },
  { route: "/about", must: [/Plus Bio/i, /separate|independent/i, /no.*(personal|health|genetic).*data.*flow|data.*(does not|never).*flow/i] },
];

const PLACEHOLDERS = /\bTODO\b|\bTBD\b|\bFIXME\b|lorem ipsum|\bN\/A\b|\[[^\]]*specify[^\]]*\]|\bPLACEHOLDER\b/i;

for (const { route, must } of REQUIRED) {
  test(`legal page ${route} is complete, on-topic, and placeholder-free`, async ({
    page,
  }) => {
    const res = await page.goto(route);
    expect(res?.status(), `${route} must render`).toBeLessThan(400);
    const body = await page.locator("main, body").first().innerText();
    for (const re of must) {
      expect(body, `${route} must contain ${re}`).toMatch(re);
    }
    expect(body, `${route} must not contain placeholders`).not.toMatch(
      PLACEHOLDERS,
    );
    expect(body.length, `${route} must have substantial content`).toBeGreaterThan(
      800,
    );
  });
}

test("Plus Bio disclosure is accurate (created by, legally separate, no data flow)", async ({
  page,
}) => {
  await page.goto("/about");
  const body = (await page.locator("main").innerText()).toLowerCase();
  expect(body).toContain("plus bio");
  // The relationship must state both halves: created by Plus Bio AND legally
  // separate — creation without separation or vice versa misstates it.
  expect(body).toMatch(/created by plus bio/);
  expect(body).toMatch(/legally separate/);
  expect(body).toMatch(/public good/);
  expect(body).toMatch(/no.*data.*flow|data.*(does not|never|doesn't).*(flow|pass|move)/);
});

test("the creation attribution renders in the site chrome", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText(/created by plus bio for the public good/i).first(),
  ).toBeVisible();
});

test("disclaimers appear on the report SURFACE, not only in ToS", async ({
  page,
}) => {
  const user = { email: "legal-report@e2e.local", password: "e2e-legal-pw" };
  await createConfirmedUser(user.email, user.password);
  await signIn(page, user.email, user.password);
  await ingestFileAs(
    page,
    user.email,
    user.password,
    path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"),
    "vcf",
  );

  await page.goto("/genome/me/reports");
  const firstReport = page.locator('a[href^="/genome/me/reports/"]').first();
  await firstReport.click();
  await expect(page.getByTestId("report-disclaimer")).toBeVisible();
  await expect(page.getByTestId("report-disclaimer")).toContainText(
    /informational, not medical advice/i,
  );
});
