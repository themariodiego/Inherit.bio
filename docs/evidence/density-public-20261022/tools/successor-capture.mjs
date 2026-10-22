// Public and auth successor capture for an engineering density measurement.
// It mirrors scripts/density-baseline/capture.mjs: the same browser launch,
// context (light, DPR 1, en-US, UTC, reduced motion, service workers blocked),
// `ready`, first-viewport PNG and `measure`, imported unchanged from
// scripts/density-baseline/measure.mjs. Pixels are computed afterwards by the
// unchanged scripts/density-baseline/compute.mjs pointed at this manifest.
//
// Environment:
//   DENSITY_ORIGIN               a running `next start` of the tree under test
//   DENSITY_OUT                  a fresh output directory
//   DENSITY_BROWSER_EXECUTABLE   optional; Playwright's chromium by default
//   DENSITY_ONLY                 optional comma-separated concrete paths
//   DENSITY_EXPERIMENT_CSS       DIAGNOSTIC ONLY: a style injected after
//                                `ready`, used to measure the text-only floor.
//                                A capture taken with it is not a measurement
//                                of the product.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("@playwright/test");
const { ready, measure } = await import(path.join(ROOT, "scripts/density-baseline/measure.mjs"));
const origin = process.env.DENSITY_ORIGIN;
const out = process.env.DENSITY_OUT;
if (!origin || !out) throw new Error("DENSITY_ORIGIN and DENSITY_OUT are required");
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/density-baseline.json"), "utf8"));
const register = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/route-register.json"), "utf8"));
const selectors = contract.measurementSelectors;
// The concrete documents e2e/accessibility-sweeps.ts DOCUMENTS uses.
const DOCUMENTS = {
  "/legal/[artifact]": "/legal/consent.own-polygenic",
  "/legal/[artifact]/versions/[version]": "/legal/consent.own-polygenic/versions/1",
  "/legal/[artifact]/diff/[from]/[to]": "/legal/consent.own-polygenic/diff/1/2",
  "/legal/consent/[key]": "/legal/consent/consent.own-polygenic",
  "/legal/consent/[key]/v/[version]": "/legal/consent/consent.own-polygenic/v/1",
  "/legal/consent/[key]/diff/[from]/[to]": "/legal/consent/consent.own-polygenic/diff/1/2",
};
const only = process.env.DENSITY_ONLY ? new Set(process.env.DENSITY_ONLY.split(",")) : null;
const paths = [];
for (const r of register.routes) {
  if (r.kind !== "page" || r.auth !== "public") continue;
  const p = r.path.includes("[") ? DOCUMENTS[r.path] : r.path;
  if (!p) continue;
  if (only && !only.has(p)) continue;
  paths.push([r.id, p]);
}
const viewports = [{ id: "390x844", width: 390, height: 844 }, { id: "1280x800", width: 1280, height: 800 }];
fs.mkdirSync(path.join(out, "screenshots"), { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.DENSITY_BROWSER_EXECUTABLE ? { executablePath: process.env.DENSITY_BROWSER_EXECUTABLE } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: "light",
  reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
const page = await context.newPage();
const manifest = { schemaVersion: 1, captureEnvironment: { origin, browserName: "chromium", browserVersion: browser.version(),
  nodeVersion: process.versions.node, locale: "en-US", timezone: "UTC", theme: "light", devicePixelRatio: 1, serviceWorkers: "blocked" },
  routeIds: {}, routes: {} };
for (const [id, p] of paths) {
  manifest.routes[p] ??= {}; manifest.routeIds[p] = id;
  for (const v of viewports) {
    await page.setViewportSize({ width: v.width, height: v.height });
    const res = await page.goto(`${origin}${p}`, { waitUntil: "domcontentloaded" });
    await ready(page);
    if (process.env.DENSITY_EXPERIMENT_CSS) {
      await page.addStyleTag({ content: process.env.DENSITY_EXPERIMENT_CSS });
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    }
    const file = `${(p === "/" ? "home" : p.slice(1).replaceAll("/", "-"))}__${v.id}.png`;
    await page.screenshot({ path: path.join(out, "screenshots", file), type: "png", fullPage: false, animations: "disabled", caret: "hide" });
    manifest.routes[p][v.id] = { ...(await measure(page, selectors)), screenshotFile: file, httpStatus: res?.status() ?? null };
  }
}
await browser.close();
fs.writeFileSync(path.join(out, "capture-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ routes: paths.length, captures: paths.length * 2 }));
