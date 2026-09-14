import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";

/**
 * The post-change half of the density comparison (G2.5).
 *
 * `scripts/density-baseline/capture.mjs` measures the BASELINE's 22 paths
 * against a frozen checkout and an out-of-tree Supabase stub built from that
 * checkout. It cannot measure their successors: six are authenticated, five
 * carry a dynamic segment, and HEAD's authenticated pages read a far larger
 * surface through the service role than that stub serves. That was the
 * recorded blocker, and the answer here is not a second stub — it is the real
 * local stack this suite already builds, with the account built through the
 * real journey rather than inserted.
 *
 * IT IS NOT A TEST AND IT DOES NOT RUN WITH THE SUITE. A capture asserts
 * nothing about the product; it records what the product looks like. It lives
 * behind its own Playwright project, gated on INHERIT_DENSITY_CAPTURE, so the
 * default run never pays for 44 screenshots and nobody reads a density
 * measurement as a passing test.
 *
 * The measuring is not reimplemented. `ready` and `measure` are the same
 * functions the baseline capture calls, from the same module, because two
 * copies of the reading code would make the two halves of this comparison
 * incomparable by drift.
 */
const ROOT = path.resolve(__dirname, "..");

/**
 * Loaded at run time rather than imported at the top, and the reason is
 * mechanical: this file is TypeScript that Playwright compiles to CommonJS,
 * and a static import of the capture's `.mjs` module makes the whole spec load
 * as ESM, which this package is not. A dynamic import reaches the same module.
 * Copying the two functions here instead would defeat the point of extracting
 * them.
 */
async function measurement(): Promise<{
  ready: (page: unknown) => Promise<void>;
  measure: (page: unknown, selectors: Record<string, string>) => Promise<Record<string, unknown>>;
}> {
  return import("../scripts/density-baseline/measure.mjs");
}
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/density-baseline.json"), "utf8")) as {
  measurementSelectors: Record<string, string>;
  postChange: { measurementPaths: { baselineRoute: string; measurementPath: string; surface: string }[] };
};
const rows = contract.postChange.measurementPaths;
const selectors = contract.measurementSelectors;

const OUTPUT = process.env.DENSITY_POST_CHANGE_OUTPUT
  ?? path.join(ROOT, "test-results/density-post-change");
const VIEWPORTS = [
  { id: "390x844", width: 390, height: 844 },
  { id: "1280x800", width: 1280, height: 800 },
] as const;

const USER = {
  email: `density-post-${randomUUID()}@e2e.local`,
  password: "e2e-density-post-change-pw",
};
const SOURCE = path.join(ROOT, "e2e/fixtures/density-source-grch38.vcf");

/** The baseline's own key for a screenshot file, so the two sets pair by name. */
function fileKey(baselineRoute: string): string {
  if (baselineRoute === "/") return "home";
  return baselineRoute.replace(/^\//, "").replaceAll("/", "-");
}

test.describe.configure({ mode: "serial" });

test("post-change density capture: every successor surface at both viewports", async ({ page }) => {
  test.setTimeout(600_000);
  fs.mkdirSync(path.join(OUTPUT, "screenshots"), { recursive: true });
  const manifest = {
    schemaVersion: 1,
    captureEnvironment: {
      origin: test.info().project.use.baseURL ?? "",
      browserName: page.context().browser()?.browserType().name() ?? "chromium",
      browserVersion: page.context().browser()?.version() ?? "",
      nodeVersion: process.versions.node,
      locale: "en-US",
      timezone: "UTC",
      theme: "light",
      devicePixelRatio: 1,
      serviceWorkers: "blocked",
    },
    routes: {} as Record<string, Record<string, unknown>>,
  };

  const { ready, measure } = await measurement();
  const capture = async (row: (typeof rows)[number]) => {
    manifest.routes[row.measurementPath] ??= {};
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(row.measurementPath, { waitUntil: "domcontentloaded" });
      await ready(page);
      // The baseline refused a capture whose viewport or pixel ratio did not
      // match what it declared, because a screenshot at the wrong scale is not
      // a smaller page. The same refusal, not a softer one.
      const dimensions = await page.evaluate(() => ({
        width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      }));
      expect(dimensions, `viewport for ${row.measurementPath}`).toEqual({
        width: viewport.width, height: viewport.height, dpr: 1,
      });
      const screenshotFile = `${fileKey(row.baselineRoute)}__${viewport.id}.png`;
      await page.screenshot({
        path: path.join(OUTPUT, "screenshots", screenshotFile),
        type: "png", fullPage: false, animations: "disabled", caret: "hide",
      });
      manifest.routes[row.measurementPath][viewport.id] = {
        ...(await measure(page, selectors)),
        screenshotFile,
      };
    }
  };

  // Signed out first, exactly as the baseline ordered it: the public and auth
  // surfaces are what a visitor sees, and a signed-in header on them would be
  // a different page.
  for (const row of rows.filter((entry) => entry.surface !== "authenticated")) await capture(row);

  // Then the account, built through the real journey. The source is the union
  // of the ancestry panel and the report catalogue, so every authenticated
  // successor has what its predecessor was measured showing.
  await createConfirmedUser(USER.email, USER.password);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, USER.email, USER.password);
  await uploadOwnFileWithChosenReports(page, SOURCE, {
    fileType: "vcf",
    purposes: ["reports.monogenic", "reports.polygenic", "ancestry"],
  });

  for (const row of rows.filter((entry) => entry.surface === "authenticated")) await capture(row);

  const manifestPath = path.join(OUTPUT, "capture-manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  expect(Object.keys(manifest.routes), "one entry per declared measurement path")
    .toHaveLength(rows.length);
  const measurements = Object.values(manifest.routes)
    .reduce((total, viewports) => total + Object.keys(viewports).length, 0);
  expect(measurements, "both viewports for every path").toBe(rows.length * VIEWPORTS.length);
  console.log(JSON.stringify({ manifestPath, routeCount: rows.length, measurements }));
});
