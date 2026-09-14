import { createRequire } from "node:module";
import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const require = createRequire(path.join(repositoryRoot, "package.json"));
const { chromium } = require("@playwright/test");
const { ready, measure } = await import("./measure.mjs");

const origin = process.env.DENSITY_ORIGIN || "http://127.0.0.1:3100";
const outputDirectory =
  process.env.DENSITY_SCREENSHOT_DIRECTORY ||
  "/private/tmp/inherit-density-baseline/screenshots";
const manifestPath =
  process.env.DENSITY_CAPTURE_MANIFEST ||
  "/private/tmp/inherit-density-baseline/capture-manifest.json";
const browserExecutable =
  process.env.DENSITY_BROWSER_EXECUTABLE ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const contractPath =
  process.env.DENSITY_CONTRACT_DOCUMENT ||
  path.join(repositoryRoot, "docs/density-baseline.json");
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const selectors = contract.measurementSelectors;
if (
  !selectors?.requiredAccuracy ||
  !selectors?.primaryClaim ||
  !selectors?.primaryContent ||
  !selectors?.topLevelSection ||
  !selectors?.pixelExclusions
) {
  throw new Error(`Incomplete density selectors: ${contractPath}`);
}

const fileKeyForRoute = (route) => {
  if (route === "/") return "home";
  return route.replace(/^\//, "").replaceAll("/", "-");
};
const baselineCases = contract.routes.map((route) => [
  route.measurementPath,
  fileKeyForRoute(route.measurementPath),
  route.surface,
]);
const publicCases = baselineCases
  .filter(([, , surface]) => surface !== "authenticated")
  .map(([route, fileKey]) => [route, fileKey]);
const authenticatedCases = baselineCases
  .filter(([, , surface]) => surface === "authenticated")
  .map(([route, fileKey]) => [route, fileKey]);

const viewports = [
  { id: "390x844", width: 390, height: 844 },
  { id: "1280x800", width: 1280, height: 800 },
];


async function captureCases(page, cases, manifest) {
  for (const [route, fileKey] of cases) {
    manifest.routes[route] ??= {};
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded" });
      await ready(page);
      const dimensions = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      }));
      if (
        dimensions.width !== viewport.width ||
        dimensions.height !== viewport.height ||
        dimensions.dpr !== 1
      ) {
        throw new Error(
          `Invalid viewport for ${route}: ${JSON.stringify(dimensions)}`,
        );
      }
      const screenshotFile = `${fileKey}__${viewport.id}.png`;
      const screenshotPath = path.join(outputDirectory, screenshotFile);
      await page.screenshot({
        path: screenshotPath,
        type: "png",
        fullPage: false,
        animations: "disabled",
        caret: "hide",
      });
      manifest.routes[route][viewport.id] = {
        ...(await measure(page, selectors)),
        screenshotFile,
      };
    }
  }
}

await mkdir(outputDirectory, { recursive: true });
await mkdir(path.dirname(manifestPath), { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable,
});
const browserVersion = browser.version();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  reducedMotion: "reduce",
  locale: "en-US",
  timezoneId: "UTC",
  serviceWorkers: "block",
});
const page = await context.newPage();
const manifest = {
  schemaVersion: 1,
  captureEnvironment: {
    origin,
    browserName: "Google Chrome",
    browserVersion,
    nodeVersion: process.versions.node,
    locale: "en-US",
    timezone: "UTC",
    theme: "light",
    devicePixelRatio: 1,
    serviceWorkers: "blocked",
  },
  routes: {},
};

try {
  await captureCases(page, publicCases, manifest);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${origin}/auth/sign-in?next=%2Fdashboard`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByLabel("Email").fill("density-fixture@inherit.test");
  await page.getByLabel("Password").fill("synthetic-density-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
  await ready(page);

  await captureCases(page, authenticatedCases, manifest);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    JSON.stringify({
      manifestPath,
      screenshotDirectory: outputDirectory,
      routeCount: Object.keys(manifest.routes).length,
      measurementCount: Object.values(manifest.routes).reduce(
        (sum, route) => sum + Object.keys(route).length,
        0,
      ),
    }),
  );
} finally {
  await context.close();
  await browser.close();
}
