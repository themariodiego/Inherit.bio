import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { admitAptSupervisorVersion, admitClosedAptUnit, admitFreshAptRefresh, admitOwnedAptUnit, admitRestoredCache, aptArchiveNames, cacheKey, normalizeAptDownloads, publicationAptService, verifyAptMetadata, verifyArchive, verifyCache, type FontManifest } from "./ci-browser-font-cache.js";

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
const publicationRefresh = () => {
  if (realpathSync(root) !== root) throw new Error("canonical publication checkout required");
  const serviceRun = (program: string, args: string[], timeoutMs: number) => {
    const remaining = 210_000 - (Date.now() - start);
    if (remaining <= 0) throw new Error("font publication budget exhausted");
    return execFileSync(program, args, { cwd: root, encoding: "utf8", timeout: Math.min(timeoutMs, remaining),
      killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  };
  const version = admitAptSupervisorVersion(serviceRun("/usr/bin/systemd-run", ["--version"], 2_000));
  console.log(JSON.stringify({ fontAptSupervisorVersion: version }));
  const unit = `inherit-font-apt-${randomBytes(16).toString("hex")}.service`;
  const cgroup = path.join("/sys/fs/cgroup/system.slice", unit);
  const cgroupAbsent = () => {
    const parent = path.dirname(cgroup), stat = lstatSync(parent);
    if (!stat.isDirectory() || stat.uid !== 0 || stat.mode & 0o022 || realpathSync(parent) !== parent) throw new Error("unexpected publication cgroup parent");
    try { lstatSync(cgroup); return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return true; }
  };
  const observeClosed = (before = false) => {
    const original = serviceRun("/usr/bin/systemctl", ["show", "--property=LoadState", "--property=ActiveState", "--property=SubState", "--", unit], 2_000);
    const absent = cgroupAbsent();
    console.log(JSON.stringify({ fontAptUnit: unit, phase: before ? "before" : "after", original, cgroupAbsent: absent }));
    admitClosedAptUnit(original, absent, before);
  };
  observeClosed(true);
  const service = publicationAptService(root, unit, 210_000 - (Date.now() - start),
    [process.env.ImageOS ?? "", process.env.ImageVersion ?? "", process.env.GITHUB_ACTIONS ?? "", process.env.RUNNER_ENVIRONMENT ?? ""]);
  let refreshed: string;
  try {
    refreshed = serviceRun("/usr/bin/sudo", service.args, service.timeoutMs);
    process.stdout.write(refreshed);
    observeClosed();
    admitFreshAptRefresh(refreshed);
  }
  catch (error) {
    const emit = (original: unknown, target: NodeJS.WriteStream) => {
      if (typeof original === "string" || Buffer.isBuffer(original)) target.write(original);
    };
    if (error && typeof error === "object") {
      if ("stdout" in error) emit(error.stdout, process.stdout);
      if ("stderr" in error) emit(error.stderr, process.stderr);
    }
    // A broken client is not evidence that its root service stopped. Stop only
    // this fresh unit after verifying its exact transient ownership sentinel.
    try { observeClosed(); }
    catch {
      const original = serviceRun("/usr/bin/systemctl", ["show", "--property=Description", "--property=Transient",
        "--property=User", "--property=Group", "--property=Slice", "--", unit], 2_000);
      console.log(JSON.stringify({ fontAptUnit: unit, phase: "cleanup-owner", original }));
      admitOwnedAptUnit(original, unit);
      serviceRun("/usr/bin/sudo", ["--non-interactive", "--", "/usr/bin/systemctl", "stop", "--", unit], 5_000);
      observeClosed();
    }
    throw error;
  }
  return refreshed;
};
const authenticate = (refresh: () => string) => {
  platform();
  refresh();
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
    authenticate(publicationRefresh);
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
    authenticate(publicationRefresh);
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
