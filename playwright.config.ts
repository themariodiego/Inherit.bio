import { localE2eProject } from "./scripts/local-e2e-project";
import { defineConfig, devices } from "@playwright/test";
import { chromiumStorageProxyArgs } from "./scripts/local-storage-browser-config";

// E2E runs against a production build served locally, backed by the local
// Supabase stack (pnpm supabase start) — real PostgREST, real storage, real
// auth emails captured by Mailpit. No mocks of the things under test.
//
// Three servers from one build (design w10 §6.2): the main suite runs under
// the TEST-LOCAL jurisdiction flag on PORT; the `jurisdiction-off` project
// runs the `*.nojurisdiction.spec.ts` specs against a second `next start`
// of the same build on OFF_PORT with the flag unset, so the refused branch
// of every jurisdiction guard is proven in a browser rather than claimed.
// The independent pause server uses TEST-LOCAL with issuance paused.
// Playwright starts the servers in order, so the latter two reuse the build.
const PORT = 3100;
const OFF_PORT = 3101;
const PAUSE_PORT = 3102;
const isolatedCi = process.env.CI && process.env.INHERIT_CI_BROWSER_RUNTIME === "ready";
if (process.env.CI && !process.argv.includes("--list") && !isolatedCi) {
  throw new Error("Standard CI must pass isolated runtime preflight through pnpm e2e");
}
const ciServer = (port: number) => `corepack pnpm exec tsx scripts/ci-browser/server.mts host ${port}`;
const providerProxy = process.env.INHERIT_LOCAL_BROWSER_STORAGE_PROXY;
const signer = process.env.INHERIT_UPLOAD_SIGNING_JWK;
// Discovery does not start a provider or build. Executing tests must use pnpm e2e.
if (!process.argv.includes("--list") && (!providerProxy || !signer)) {
  throw new Error("Run pnpm e2e through the real local Storage provider bootstrap");
}
const NO_JURISDICTION = /\.nojurisdiction\.spec\.ts$/;
/**
 * The density capture (G2.5). It is not a test — it records what the product
 * looks like — so it is excluded from every default project and runs only when
 * asked, behind its own project. Left in the default suite it would cost 44
 * screenshots on every push and would report a measurement as a passing test.
 */
const DENSITY = /\.density\.spec\.ts$/;
const densityCapture = process.env.INHERIT_DENSITY_CAPTURE === "1";

const localProject = localE2eProject(process.env);
const SERVER_ENV = {
  INHERIT_UPLOAD_SIGNING_JWK: signer ?? "",
  INHERIT_CANONICAL_UPLOADS_PAUSED: "false",
  NEXT_PUBLIC_SUPABASE_URL: localProject.apiOrigin,
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? (localProject.projectId === "sequence" ?
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0" : ""),
  SUPABASE_SERVICE_ROLE_KEY:
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? (localProject.projectId === "sequence" ?
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU" : ""),
  BYOK_ENCRYPTION_KEY: "5vL1kK0jgWTTr0oQvIrnT2mWXBPY0R1JX0uKTdcm9Ug=",
  JOBS_SECRET: "e2e-jobs-secret",
  CRON_SECRET: "e2e-cron-secret",
  EMAIL_FROM: "Inherit <inherit@e2e.local>",
  // The durable mail worker submits to a mock Resend API started by
  // research.spec.ts (the SDK honors RESEND_BASE_URL). Auth emails flow
  // through the local stack's Mailpit.
  RESEND_API_KEY: "re_e2e_mock",
  RESEND_BASE_URL: "http://127.0.0.1:8124",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // suites share one DB; specs manage their own users
  workers: 1,
  timeout: 120_000,
  retries: 0,
  reporter: process.env.CI
    ? [["list"], ["github"], ["json", { outputFile: "test-results/results.json" }]]
    : [["list"], ["json", { outputFile: "test-results/results.json" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off", // Upload/presentation bearers must never enter persisted traces.
    launchOptions: providerProxy ? { args: chromiumStorageProxyArgs(providerProxy) } : {},
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: [NO_JURISDICTION, DENSITY] },
    {
      name: "jurisdiction-off",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${OFF_PORT}` },
      testMatch: NO_JURISDICTION,
    },
    // Every setting the baseline capture fixed, fixed the same way. Ink
    // coverage is a pixel measurement: a different scale factor, colour scheme
    // or locale changes it, and a comparison across that difference measures
    // the browser rather than the page.
    ...(densityCapture
      ? [{
          name: "density",
          testMatch: DENSITY,
          use: {
            ...devices["Desktop Chrome"],
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 1,
            colorScheme: "light" as const,
            // `reducedMotion` reaches the context rather than `use` directly.
            contextOptions: { reducedMotion: "reduce" as const },
            locale: "en-US",
            timezoneId: "UTC",
            serviceWorkers: "block" as const,
          },
        }]
      : []),
  ],
  // Every local server keeps idle connections for 65 s: the CI launcher passes
  // the same flag (scripts/ci-browser/server.mts) because Playwright's request
  // client never closes an idle socket itself and a server-side close racing a
  // dispatch is the "socket hang up" recorded three times in G1.5.
  webServer: [
    {
      command: isolatedCi ? ciServer(PORT) : `corepack pnpm build && corepack pnpm start --port ${PORT} --keepAliveTimeout 65000`,
      ...(isolatedCi ? { url: `http://localhost:${PORT}/auth/sign-in` } : { port: PORT }),
      reuseExistingServer: false, // Exact build and ephemeral signer; never reuse an unrelated local server.
      timeout: 300_000,
      env: {
        ...SERVER_ENV,
        NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}`,
        NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
        INHERIT_TEST_JURISDICTION: "1",
      },
    },
    {
      // The same build, the flag unset: an empty value is not "1", so the
      // resolver reads every account's real (unset) jurisdiction.
      command: isolatedCi ? ciServer(OFF_PORT) : `corepack pnpm start --port ${OFF_PORT} --keepAliveTimeout 65000`,
      ...(isolatedCi ? { url: `http://localhost:${OFF_PORT}/auth/sign-in` } : { port: OFF_PORT }),
      reuseExistingServer: false, // Exact build and ephemeral signer; never reuse an unrelated local server.
      timeout: 120_000,
      env: {
        ...SERVER_ENV,
        NEXT_PUBLIC_SITE_URL: `http://localhost:${OFF_PORT}`,
        NEXT_PUBLIC_APP_URL: `http://localhost:${OFF_PORT}`,
        INHERIT_TEST_JURISDICTION: "",
      },
    },
    {
      command: isolatedCi ? ciServer(PAUSE_PORT) : `corepack pnpm start --port ${PAUSE_PORT} --keepAliveTimeout 65000`,
      ...(isolatedCi ? { url: `http://localhost:${PAUSE_PORT}/auth/sign-in` } : { port: PAUSE_PORT }),
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...SERVER_ENV,
        NEXT_PUBLIC_SITE_URL: `http://localhost:${PAUSE_PORT}`,
        NEXT_PUBLIC_APP_URL: `http://localhost:${PAUSE_PORT}`,
        INHERIT_TEST_JURISDICTION: "1",
        INHERIT_CANONICAL_UPLOADS_PAUSED: "true",
      },
    },
  ],
});
