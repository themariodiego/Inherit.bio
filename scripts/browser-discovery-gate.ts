import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyNativeBrowserBalance } from "./ci-browser-balance";
import { assertEmbryoJourneyAudits, EMBRYO_BROWSER_JOURNEYS } from "./ci-browser-embryo-partitions";
import { trackedBrowserSpecs } from "./ci-browser-shards-io";
import { browserDiscoveryInventory, CI_BROWSER_SHARDS } from "./ci-browser-shards";

/** A listing process receives no provider keys, optional selectors or runtime
 * authority from the caller. --list loads tests without starting their fixtures. */
export function browserDiscoveryEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(["PATH", "HOME", "TMPDIR", "SystemRoot"]
    .filter(name => env[name] !== undefined).map(name => [name, env[name]]));
  return { ...inherited, CI: "true", INHERIT_DISPOSABLE_LOCAL_E2E: "true",
    INHERIT_LOCAL_E2E_PROJECT: "sequence", INHERIT_TEST_JURISDICTION: "1",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "EXAMPLE_SYNTHETIC_DISCOVERY_ANON_KEY",
    SUPABASE_SERVICE_ROLE_KEY: "EXAMPLE_SYNTHETIC_DISCOVERY_SERVICE_KEY",
    BYOK_ENCRYPTION_KEY: Buffer.from("EXAMPLE_DISCOVERY_KEY_0000000000", "utf8").toString("base64"),
    JOBS_SECRET: "EXAMPLE_SYNTHETIC_DISCOVERY_JOBS_SECRET", CRON_SECRET: "EXAMPLE_SYNTHETIC_DISCOVERY_CRON_SECRET",
    RESEND_API_KEY: "re_EXAMPLE_SYNTHETIC_DISCOVERY", RESEND_BASE_URL: "http://127.0.0.1:8124" };
}

export function browserDiscoveryArguments(cli: string, index: number | null): string[] {
  assert(index === null || (Number.isInteger(index) && index >= 1 && index <= CI_BROWSER_SHARDS),
    "Only complete discovery or a registered native partition is allowed");
  return [cli, "test", "--config=playwright.config.ts", "--list", "--reporter=json",
    ...(index === null ? [] : [`--shard=${index}/${CI_BROWSER_SHARDS}`])];
}

/** Mandatory local prepush preflight. No browser, app, SQL or hosted receipt. */
export function checkBrowserDiscovery(): { cases: number; files: number } {
  assertEmbryoJourneyAudits(Object.fromEntries(Object.values(EMBRYO_BROWSER_JOURNEYS)
    .map(file => [file, readFileSync(path.join("e2e", file), "utf8")])));
  const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
  const env = browserDiscoveryEnvironment(process.env);
  const discover = (index: number | null): unknown => {
    const result = spawnSync(process.execPath, browserDiscoveryArguments(cli, index), {
      env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 32_000_000, timeout: 60_000,
    });
    assert(!result.error && result.status === 0, "Browser discovery preflight failed");
    return JSON.parse(result.stdout);
  };
  const full = discover(null), inventory = browserDiscoveryInventory(full, trackedBrowserSpecs());
  const partitions = Array.from({ length: CI_BROWSER_SHARDS }, (_, index) => discover(index + 1));
  verifyNativeBrowserBalance(full, partitions);
  return { cases: inventory.cases.length, files: inventory.files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.length === 2, "Browser discovery preflight takes no selectors");
    const inventory = checkBrowserDiscovery();
    console.log(`Browser discovery only: ${inventory.cases} cases, ${inventory.files} ordinary files, six complete native partitions.`);
  } catch {
    // Playwright JSON embeds configuration; never copy it into logs/artifacts.
    console.error("Browser discovery preflight failed; private diagnostics suppressed.");
    process.exitCode = 1;
  }
}
