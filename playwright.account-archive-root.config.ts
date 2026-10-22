import { defineConfig, devices } from "@playwright/test";
import { localE2eProject } from "./scripts/local-e2e-project";
import { assertLocalProviderEnvironment, chromiumStorageProxyArgs } from "./scripts/local-storage-browser-config";

// Root owns a separately admitted private TEST app/provider. This config starts
// nothing and changes no standard project, fixture, environment or default flag.
assertLocalProviderEnvironment(process.env, false, []);
localE2eProject(process.env);
if (process.env.INHERIT_TEST_JURISDICTION !== "1" || process.env.INHERIT_TEST_ACCOUNT_ARCHIVE_R2 !== "1"
  || !process.env.INHERIT_LOCAL_BROWSER_STORAGE_PROXY || !process.env.INHERIT_UPLOAD_SIGNING_JWK)
  throw new Error("root_account_archive_fixture_unavailable");

export default defineConfig({
  testDir: "./scripts/account-archive-root", testMatch: "complete.spec.ts", fullyParallel: false,
  workers: 1, retries: 0, timeout: 300_000, expect: { timeout: 5000 },
  outputDir: "test-results/account-archive-root-browser",
  reporter: [["list"], ["json", { outputFile: "test-results/account-archive-root-results.json" }]],
  use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3100", trace: "off",
    launchOptions: { args: chromiumStorageProxyArgs(process.env.INHERIT_LOCAL_BROWSER_STORAGE_PROXY) } },
});
