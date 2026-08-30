import { expect, test } from "@playwright/test";
import path from "node:path";
import { createConfirmedUser, ingestFileAs, signIn } from "./helpers";

// Sensitive-report gate — reports in life-altering categories (cancer-risk,
// neurodegenerative, mental-health, plus templates recommending clinical
// confirmation) must NOT show the result section until the user explicitly
// opts in ("prefer not to know" is a first-class choice). The header,
// summary, citations, and the legal disclaimer stay visible either way.
// The opt-in is remembered per category in localStorage (device-local).

const USER = { email: "gate-user@e2e.local", password: "e2e-gate-pw" };

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

test("APOE report gates the result; 'Show my result' reveals it and is remembered on reload", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await ingestFileAs(
    page,
    USER.email,
    USER.password,
    path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"),
    "vcf",
  );

  await page.goto("/reports/apoe-e4-alzheimers-risk");

  // Gate is up: interstitial visible, result/variant sections not rendered.
  const gate = page.getByTestId("sensitive-gate");
  await expect(gate).toBeVisible();
  await expect(gate).toContainText("Before you look");
  await expect(gate).toContainText("remembered on this device");
  await expect(page.getByText("Your genotype")).toHaveCount(0);
  await expect(
    page.getByText(/Your file does not cover this variant/),
  ).toHaveCount(0);

  // Header, summary, sources, and disclaimer stay visible around the gate.
  await expect(
    page.getByRole("heading", { name: /Alzheimer's disease/ }),
  ).toBeVisible();
  await expect(page.getByText("Sources")).toBeVisible();
  await expect(page.getByTestId("report-disclaimer")).toBeVisible();

  // Click through the gate: results render (tiny fixture doesn't cover
  // APOE, so the honest not-covered text is the revealed result).
  await page.getByRole("button", { name: "Show my result" }).click();
  await expect(page.getByTestId("sensitive-gate")).toHaveCount(0);
  await expect(
    page.getByText(/Your file does not cover this variant/).first(),
  ).toBeVisible();

  // Support pathway appears with the result.
  const support = page.getByTestId("support-panel");
  await expect(support).toBeVisible();
  await expect(support).toContainText("If this result concerns you");
  await expect(
    support.getByRole("link", { name: /Find a genetic counselor/ }),
  ).toHaveAttribute("href", "https://findageneticcounselor.nsgc.org");
  await expect(
    support.getByRole("button", { name: /Print or save/ }),
  ).toBeVisible();

  // The choice is remembered per category on this device.
  await page.reload();
  await expect(
    page.getByText(/Your file does not cover this variant/).first(),
  ).toBeVisible();
  await expect(page.getByTestId("sensitive-gate")).toHaveCount(0);
});

test("'Not now' returns to the report library without revealing", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  // Fresh browser context per test → no remembered choice; use a different
  // sensitive category (cancer-risk) anyway to keep tests independent.
  await page.goto("/reports/breast-cancer-fgfr2-rs2981582");
  await expect(page.getByTestId("sensitive-gate")).toBeVisible();
  await expect(page.getByText("Your genotype")).toHaveCount(0);
  await page.getByRole("link", { name: "Not now" }).click();
  await page.waitForURL(/\/reports$/);
});

test("non-sensitive report shows its result directly, with no gate", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  // CYP1A2 rs762551 is a real 0/1 call in the tiny fixture (A/C), and
  // lifestyle-wellness is not a gated category. (rs671 is 0/0 there — the
  // parser drops reference calls, so ALDH2 resolves not-covered.)
  await page.goto("/reports/caffeine-metabolism-cyp1a2-rs762551");
  await expect(page.getByTestId("sensitive-gate")).toHaveCount(0);
  await expect(page.getByText("Your genotype")).toBeVisible();
  await expect(page.getByText("A/C")).toBeVisible();
});
