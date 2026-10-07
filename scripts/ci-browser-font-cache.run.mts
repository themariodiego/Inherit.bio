import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { admitRestoredCache, aptArchiveNames, cacheKey, normalizeAptDownloads, verifyAptMetadata, verifyArchive, verifyCache, type FontManifest } from "./ci-browser-font-cache.js";

const start = Date.now();
const command = process.argv[2];
const root = path.resolve(import.meta.dirname, "..");
const manifestBytes = readFileSync(path.join(root, "data/ci/browser-font-packages.json"));
const manifest = JSON.parse(manifestBytes.toString()) as FontManifest;
const key = cacheKey(manifestBytes, readFileSync(path.join(root, "pnpm-lock.yaml")));
const runnerTemp = process.env.RUNNER_TEMP;
if (!runnerTemp || realpathSync(runnerTemp) !== path.resolve(runnerTemp)) throw new Error("a canonical RUNNER_TEMP is required");
const cache = path.join(runnerTemp, "inherit-font-debs");
const output = (name: string, value: string) => {
  if (!process.env.GITHUB_OUTPUT || /[\r\n]/.test(value)) throw new Error("invalid GitHub output destination/value");
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
};
const log = (status: string) => console.log(JSON.stringify({ fontCache: status, elapsedMs: Date.now() - start, packages: manifest.packages.length, key }));
const run = (program: string, args: string[], cwd = root) => {
  const remaining = 210_000 - (Date.now() - start);
  if (remaining <= 0) throw new Error("font cache command budget exhausted");
  return execFileSync(program, args, { cwd, encoding: "utf8", timeout: Math.min(180_000, remaining), maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
};
const platform = () => {
  const os = readFileSync("/etc/os-release", "utf8");
  const playwright = JSON.parse(readFileSync(path.join(root, "node_modules/@playwright/test/package.json"), "utf8")) as { version: string };
  if (process.platform !== "linux" || process.arch !== "x64" || !/^ID=ubuntu$/m.test(os) || !/^VERSION_ID="24\.04"$/m.test(os) || playwright.version !== manifest.playwrightVersion) throw new Error("font cache platform or Playwright version drift");
};
const authenticate = () => {
  platform();
  run("sudo", ["apt-get", "update", "--error-on=any"]);
  for (const p of manifest.packages) verifyAptMetadata(p, run("apt-cache", ["show", `${p.name}=${p.version}`]), run("apt-cache", ["policy", p.name]));
};

if (command === "prepare") {
  output("key", key);
  output("path", cache);
  log("prepared");
} else if (command === "warm") {
  // Everything before privileged copying can safely ignore a missing, damaged,
  // stale or unavailable cache. The original full installer follows every time.
  const admission = admitRestoredCache(cache, manifest, process.env.FONT_CACHE_EXACT_HIT, () => {
    authenticate();
    const names = aptArchiveNames(manifest, run("sudo", ["apt-get", "--print-uris", "--download-only", "--reinstall", "--yes", "install", ...manifest.packages.map((p) => `${p.name}=${p.version}`)]));
    const archives = "/var/cache/apt/archives";
    if (realpathSync(archives) !== archives || !lstatSync(archives).isDirectory() || lstatSync(archives).uid !== 0) throw new Error("unexpected APT archive directory");
    for (const p of manifest.packages) {
      const destination = path.join(archives, names.get(p.name)!);
      if (existsSync(destination)) verifyArchive(destination, p);
    }
    verifyCache(cache, manifest);
    return names;
  });
  if (!admission.ready) {
    console.log(JSON.stringify({ fontCache: "ignored-before-use", reason: admission.reason, elapsedMs: Date.now() - start }));
    process.exit(0);
  }
  const names = admission.value;
  for (const p of manifest.packages) {
    const destination = path.join("/var/cache/apt/archives", names.get(p.name)!);
    if (!existsSync(destination)) run("sudo", ["install", "--mode=0644", "--", path.join(cache, path.basename(p.filename)), destination]);
    // A copying failure or changed destination is fatal; it cannot be admitted
    // to the subsequent privileged installation as a mere cache miss.
    verifyArchive(destination, p);
  }
  log("verified-and-seeded");
} else if (command === "populate") {
  if (process.env.GITHUB_EVENT_NAME !== "push" || process.env.GITHUB_REF !== "refs/heads/main") throw new Error("font archive publication is restricted to main pushes");
  try {
    authenticate();
    if (existsSync(cache)) throw new Error("publication requires a fresh archive directory");
    mkdirSync(cache, { mode: 0o700 });
    run("apt-get", ["download", ...manifest.packages.map((p) => `${p.name}=${p.version}`)], cache);
    normalizeAptDownloads(cache, manifest);
    output("save-ready", "true");
    log("verified-for-main-publication");
  } catch (error) {
    output("save-ready", "false");
    console.log(JSON.stringify({ fontCache: "publication-skipped", reason: String(error), elapsedMs: Date.now() - start }));
  }
} else throw new Error("expected prepare, warm or populate");
