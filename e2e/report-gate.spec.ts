import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createConfirmedUser, ingestFileAs, signIn } from "./helpers";

// Sensitive-report gate — reports in life-altering categories (cancer-risk,
// neurodegenerative, mental-health, plus templates recommending clinical
// confirmation) must NOT show the result section until the user explicitly
// opts in ("prefer not to know" is a first-class choice). The header,
// summary, sources, and the not-diagnostic line stay visible either way.
//
// Result content is pinned by the figure contract, not by prose: a genotype
// is a `[data-figure-kind="genotype"]` node inside `[data-claim-block]`, and
// a not-covered position renders the exact §2 §4.5 VCF string followed by
// "This is a limit of your file, not a result about you."
//
// The reveal is a SERVER-side decision carried by ?reveal=1: a gated
// response must not contain the result anywhere — rendered markup, inline
// scripts, or the RSC flight payload (this was a real leak: the result used
// to be serialized as the client gate's children). The opt-in is remembered
// per user AND category in localStorage (device-local, so it can't follow
// the user across devices, and user-scoped so it can't leak across accounts
// sharing a browser). Storage failures only lose the memory, never the
// ability to reveal.

const USER = { email: "gate-user@e2e.local", password: "e2e-gate-pw" };

const FGFR2_SLUG = "breast-cancer-fgfr2-rs2981582";

const GENOTYPE_NODE = '[data-figure-kind="genotype"]';
const NOT_COVERED_VCF_FIRST_SENTENCE = "Your file does not cover this variant.";
const LIMIT_OF_FILE = "This is a limit of your file, not a result about you.";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

test("APOE report gates the result; 'Show my result' reveals via ?reveal=1 and is remembered on later visits", async ({
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

  // The gated response itself (raw HTML, inline scripts included) carries no
  // result content at all.
  const gatedRes = await page.request.get("/genome/me/reports/apoe-e4-alzheimers-risk");
  expect(gatedRes.ok()).toBe(true);
  const gatedHtml = await gatedRes.text();
  expect(gatedHtml).not.toContain(GENOTYPE_NODE.slice(1, -1));
  expect(gatedHtml).not.toContain(NOT_COVERED_VCF_FIRST_SENTENCE);
  expect(gatedHtml).not.toContain(LIMIT_OF_FILE);

  await page.goto("/genome/me/reports/apoe-e4-alzheimers-risk");

  // Gate is up: interstitial visible, result/variant sections not rendered.
  const gate = page.getByTestId("sensitive-gate");
  await expect(gate).toBeVisible();
  await expect(gate).toContainText("Before you look");
  await expect(gate).toContainText(
    "applies to all Neurodegenerative reports",
  );
  await expect(gate).toContainText("remembered on this device");
  await expect(page.locator(GENOTYPE_NODE)).toHaveCount(0);
  await expect(page.getByText(NOT_COVERED_VCF_FIRST_SENTENCE)).toHaveCount(0);
  await expect(page.getByText(LIMIT_OF_FILE)).toHaveCount(0);

  // Header, summary, sources, and the not-diagnostic line stay visible
  // around the gate. The h1 is the report name (the title up to its gene
  // suffix; the seed apostrophe is U+0027 and is not normalised).
  await expect(
    page.getByRole("heading", { name: /Alzheimer's disease/ }),
  ).toBeVisible();
  await expect(page.locator("main h1")).toHaveText("Alzheimer's disease");
  await expect(
    page.getByRole("heading", { name: "Where this comes from" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Sources" })).toBeVisible();
  await expect(page.getByTestId("report-disclaimer")).toBeVisible();

  // Click through the gate: "Show my result" is a link to the same URL with
  // ?reveal=1, and the server then renders the results (tiny fixture doesn't
  // cover APOE, so the honest not-covered text is the revealed result).
  await page.getByRole("link", { name: "Show my result" }).click();
  await page.waitForURL(/reveal=1/);
  await expect(page.getByTestId("sensitive-gate")).toHaveCount(0);
  await expect(
    page.getByText(NOT_COVERED_VCF_FIRST_SENTENCE).first(),
  ).toBeVisible();
  await expect(page.getByText(LIMIT_OF_FILE).first()).toBeVisible();

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

  // The choice is remembered per user+category on this device: a later
  // visit WITHOUT ?reveal=1 reads storage and redirects itself to ?reveal=1
  // (a brief gate flash is fine).
  await page.goto("/genome/me/reports/apoe-e4-alzheimers-risk");
  await page.waitForURL(/reveal=1/);
  await expect(
    page.getByText(NOT_COVERED_VCF_FIRST_SENTENCE).first(),
  ).toBeVisible();
  await expect(page.getByText(LIMIT_OF_FILE).first()).toBeVisible();
  await expect(page.getByTestId("sensitive-gate")).toHaveCount(0);
});

test("'Not now' returns to the library at the report's category section", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  // Fresh browser context per test → no remembered choice; use a different
  // sensitive category (cancer-risk) anyway to keep tests independent.
  await page.goto(`/genome/me/reports/${FGFR2_SLUG}`);
  await expect(page.getByTestId("sensitive-gate")).toBeVisible();
  await expect(page.locator(GENOTYPE_NODE)).toHaveCount(0);
  // "Not now" lands on the user-facing category section (nine-category
  // taxonomy id), not the storage category slug, inside the report's own
  // layer group: the link names the report's own layer so the section is
  // in the open group whatever the list's default.
  await page.getByRole("link", { name: "Not now" }).click();
  await page.waitForURL(/\/genome\/me\/reports\?layer=estimate#cancer$/);
  await expect(page.locator("#cancer")).toBeVisible();
});

test("non-sensitive report shows its result directly, with no gate", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  // CYP1A2 rs762551 is a real 0/1 call in the tiny fixture (A/C), and
  // lifestyle-wellness is not a gated category. (rs671 is 0/0 there — the
  // parser drops reference calls, so ALDH2 resolves not-covered.)
  await page.goto("/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551");
  await expect(page.getByTestId("sensitive-gate")).toHaveCount(0);
  const genotype = page.locator(GENOTYPE_NODE);
  await expect(genotype).toHaveCount(1);
  await expect(genotype).toBeVisible();
  await expect(genotype.locator('[data-slot="figure-value"]')).toHaveText("A/C");
  await expect(page.getByText("A/C")).toBeVisible();
});

test("leak regression: gated response contains no genotype anywhere, ?reveal=1 serves it, and foreign storage keys don't un-gate", async ({
  page,
}, testInfo) => {
  await signIn(page, USER.email, USER.password);

  // A fixture that actually covers the FGFR2 variant (rs2981582, called
  // A/G), so the leak assertions are about a real genotype rather than a
  // not-covered message.
  const vcfPath = testInfo.outputPath("fgfr2-covered.vcf");
  fs.writeFileSync(
    vcfPath,
    [
      "##fileformat=VCFv4.2",
      "##reference=GRCh38",
      "##contig=<ID=chr10,length=133797422>",
      '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
      "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE1",
      "chr10\t121592803\trs2981582\tA\tG\t50\tPASS\t.\tGT\t0/1",
      "",
    ].join("\n"),
  );
  await ingestFileAs(page, USER.email, USER.password, vcfPath, "vcf");

  // Raw served HTML of the gated page (page.request shares the signed-in
  // context's cookies). The genotype and its label must appear nowhere —
  // not in rendered markup, not in inline __next_f/RSC payload scripts.
  const gatedRes = await page.request.get(`/genome/me/reports/${FGFR2_SLUG}`);
  expect(gatedRes.ok()).toBe(true);
  const gatedHtml = await gatedRes.text();
  expect(gatedHtml).not.toContain(GENOTYPE_NODE.slice(1, -1));
  expect(gatedHtml).not.toContain("A/G");
  expect(gatedHtml).not.toContain("One copy of the A risk allele");

  // The same URL with ?reveal=1 does serve the result.
  const revealedRes = await page.request.get(
    `/genome/me/reports/${FGFR2_SLUG}?reveal=1`,
  );
  expect(revealedRes.ok()).toBe(true);
  const revealedHtml = await revealedRes.text();
  expect(revealedHtml).toContain(GENOTYPE_NODE.slice(1, -1));
  expect(revealedHtml).toContain("A/G");
  expect(revealedHtml).toContain("One copy of the A risk allele");

  // Cross-account regression: a choice stored for ANOTHER user id — or under
  // the old un-scoped device-global key — must not un-gate this account.
  await page.goto(`/genome/me/reports/${FGFR2_SLUG}`);
  await page.evaluate(() => {
    window.localStorage.setItem(
      "inherit.sensitive-reveal.cancer-risk", // legacy device-global key
      "revealed",
    );
    window.localStorage.setItem(
      "inherit.sensitive-reveal.00000000-0000-4000-8000-000000000000.cancer-risk",
      "revealed",
    );
  });
  await page.reload();
  await expect(page.getByTestId("sensitive-gate")).toBeVisible();
  // Give a would-be auto-redirect time to fire, then confirm it didn't.
  await page.waitForTimeout(1000);
  expect(page.url()).not.toContain("reveal=1");
  await expect(page.getByTestId("sensitive-gate")).toBeVisible();

  // Clicking through reveals the real genotype in the page.
  await page.getByRole("link", { name: "Show my result" }).click();
  await page.waitForURL(/reveal=1/);
  await expect(page.locator(GENOTYPE_NODE)).toBeVisible();
  await expect(
    page.locator(GENOTYPE_NODE).locator('[data-slot="figure-value"]'),
  ).toHaveText("A/G");
  await expect(page.getByText("A/G")).toBeVisible();
});

test("blocked localStorage: gate still shows and reveal still works — only the memory is lost", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  // Simulate blocked site data from here on: any localStorage access throws
  // (applies to every subsequent navigation in this context).
  await page.context().addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("localStorage blocked by test");
      },
    });
  });

  await page.goto(`/genome/me/reports/${FGFR2_SLUG}`);
  await expect(page.getByTestId("sensitive-gate")).toBeVisible();

  // The reveal is server-side (?reveal=1), so it works without storage.
  await page.getByRole("link", { name: "Show my result" }).click();
  await page.waitForURL(/reveal=1/);
  await expect(page.locator(GENOTYPE_NODE)).toBeVisible();
  await expect(
    page.locator(GENOTYPE_NODE).locator('[data-slot="figure-value"]'),
  ).toHaveText("A/G");
  await expect(page.getByText("A/G")).toBeVisible();

  // No memory could be written: the next plain visit is gated again (and
  // stays gated — no redirect).
  await page.goto(`/genome/me/reports/${FGFR2_SLUG}`);
  await expect(page.getByTestId("sensitive-gate")).toBeVisible();
  await page.waitForTimeout(1000);
  expect(page.url()).not.toContain("reveal=1");
  await expect(page.getByTestId("sensitive-gate")).toBeVisible();
});
