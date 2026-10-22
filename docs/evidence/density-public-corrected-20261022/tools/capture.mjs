// Public and auth capture for the corrected density rules (owner decision
// 2026-10-22). For every public page in the route register, at both
// viewports, on one page load:
//   1. the frozen `ready`, a first-viewport PNG and the frozen `measure`
//      (scripts/density-baseline/measure.mjs, unchanged);
//   2. the corrected readings and the text-only floor PNG from the pinned
//      scripts/density-corrected-readings.mjs, after which the floor style is
//      removed again.
// Pixels for both PNGs are computed afterwards by the unchanged
// scripts/density-baseline/compute.mjs, once per manifest.
//
// Environment: DENSITY_ORIGIN (a running `next start`), DENSITY_OUT (a fresh
// directory), optional DENSITY_BROWSER_EXECUTABLE and DENSITY_ONLY.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("@playwright/test");
const { ready, measure } = await import(path.join(ROOT, "scripts/density-baseline/measure.mjs"));
const readingsFile = path.join(ROOT, "scripts/density-corrected-readings.mjs");
const { readCorrectedDensity, captureTextOnlyFloor, TEXT_ONLY_FLOOR_CSS } = await import(readingsFile);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const origin = process.env.DENSITY_ORIGIN;
const out = process.env.DENSITY_OUT;
if (!origin || !out || fs.existsSync(out)) throw new Error("DENSITY_ORIGIN and a fresh DENSITY_OUT are required");
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
  if (!p || (only && !only.has(p))) continue;
  paths.push([r.id, p]);
}
const viewports = [{ id: "390x844", width: 390, height: 844 }, { id: "1280x800", width: 1280, height: 800 }];
fs.mkdirSync(path.join(out, "screenshots"), { recursive: true });
fs.mkdirSync(path.join(out, "floor-screenshots"), { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.DENSITY_BROWSER_EXECUTABLE ? { executablePath: process.env.DENSITY_BROWSER_EXECUTABLE } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: "light",
  reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
const page = await context.newPage();
const captureEnvironment = { origin, browserName: "chromium", browserVersion: browser.version(),
  nodeVersion: process.versions.node, locale: "en-US", timezone: "UTC", theme: "light", devicePixelRatio: 1, serviceWorkers: "blocked" };
const manifest = { schemaVersion: 1, captureEnvironment, routeIds: {}, routes: {} };
const floorManifest = { schemaVersion: 1, captureEnvironment, routeIds: {}, routes: {} };
const readings = { moduleSha256: sha256(fs.readFileSync(readingsFile)), variantSha256: sha256(TEXT_ONLY_FLOOR_CSS), routes: {} };
for (const [id, p] of paths) {
  for (const target of [manifest, floorManifest]) { target.routes[p] ??= {}; target.routeIds[p] = id; }
  readings.routes[p] ??= {};
  for (const v of viewports) {
    await page.setViewportSize({ width: v.width, height: v.height });
    const response = await page.goto(`${origin}${p}`, { waitUntil: "domcontentloaded" });
    await ready(page);
    const file = `${(p === "/" ? "home" : p.slice(1).replaceAll("/", "-"))}__${v.id}.png`;
    await page.screenshot({ path: path.join(out, "screenshots", file), type: "png", fullPage: false, animations: "disabled", caret: "hide" });
    const raw = await measure(page, selectors);
    manifest.routes[p][v.id] = { ...raw, screenshotFile: file, httpStatus: response?.status() ?? null };
    readings.routes[p][v.id] = await readCorrectedDensity(page, selectors);
    fs.writeFileSync(path.join(out, "floor-screenshots", file), await captureTextOnlyFloor(page));
    // The same capture: the frozen DOM reading and exclusion rectangles of the product PNG.
    floorManifest.routes[p][v.id] = { ...raw, screenshotFile: file };
  }
}
await browser.close();
fs.writeFileSync(path.join(out, "capture-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync(path.join(out, "floor-manifest.json"), JSON.stringify(floorManifest, null, 2) + "\n");
fs.writeFileSync(path.join(out, "corrected-readings.json"), JSON.stringify(readings, null, 2) + "\n");
console.log(JSON.stringify({ routes: paths.length, captures: paths.length * 2 }));
