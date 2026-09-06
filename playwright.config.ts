import { defineConfig, devices } from "@playwright/test";

// E2E runs against a production build served locally, backed by the local
// Supabase stack (pnpm supabase start) — real PostgREST, real storage, real
// auth emails captured by Mailpit. No mocks of the things under test.
//
// Two servers from one build (design w10 §6.2): the main suite runs under
// the TEST-LOCAL jurisdiction flag on PORT; the `jurisdiction-off` project
// runs the `*.nojurisdiction.spec.ts` specs against a second `next start`
// of the same build on OFF_PORT with the flag unset, so the refused branch
// of every jurisdiction guard is proven in a browser rather than claimed.
// Playwright starts the servers in order, so the second reuses the build.
// A third instance tests the operational upload pause against the same build;
// it retains the main jurisdiction setting and never replaces jurisdiction-off.
const PORT = 3100;
const OFF_PORT = 3101;
const PAUSED_PORT = 3102;
const NO_JURISDICTION = /\.nojurisdiction\.spec\.ts$/;

const SERVER_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
  SUPABASE_SERVICE_ROLE_KEY:
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
  BYOK_ENCRYPTION_KEY: "5vL1kK0jgWTTr0oQvIrnT2mWXBPY0R1JX0uKTdcm9Ug=",
  JOBS_SECRET: "e2e-jobs-secret",
  CRON_SECRET: "e2e-cron-secret",
  INHERIT_PAUSE_LEGACY_UPLOADS: "false",
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
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: NO_JURISDICTION },
    {
      name: "jurisdiction-off",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${OFF_PORT}` },
      testMatch: NO_JURISDICTION,
    },
  ],
  webServer: [
    {
      command: `corepack pnpm build && corepack pnpm start --port ${PORT}`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
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
      command: `corepack pnpm start --port ${OFF_PORT}`,
      port: OFF_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...SERVER_ENV,
        NEXT_PUBLIC_SITE_URL: `http://localhost:${OFF_PORT}`,
        NEXT_PUBLIC_APP_URL: `http://localhost:${OFF_PORT}`,
        INHERIT_TEST_JURISDICTION: "",
      },
    },
    {
      command: `corepack pnpm start --port ${PAUSED_PORT}`,
      port: PAUSED_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...SERVER_ENV,
        NEXT_PUBLIC_SITE_URL: `http://localhost:${PAUSED_PORT}`,
        NEXT_PUBLIC_APP_URL: `http://localhost:${PAUSED_PORT}`,
        INHERIT_TEST_JURISDICTION: "1",
        INHERIT_PAUSE_LEGACY_UPLOADS: "true",
      },
    },
  ],
});
