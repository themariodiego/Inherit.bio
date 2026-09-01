import { defineConfig, devices } from "@playwright/test";

// E2E runs against a production build served locally, backed by the local
// Supabase stack (pnpm supabase start) — real PostgREST, real storage, real
// auth emails captured by Mailpit. No mocks of the things under test.
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // suites share one DB; specs manage their own users
  workers: 1,
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `corepack pnpm build && corepack pnpm start --port ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
      SUPABASE_SERVICE_ROLE_KEY:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
      NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}`,
      BYOK_ENCRYPTION_KEY: "5vL1kK0jgWTTr0oQvIrnT2mWXBPY0R1JX0uKTdcm9Ug=",
      JOBS_SECRET: "e2e-jobs-secret",
      CRON_SECRET: "e2e-cron-secret",
      EMAIL_FROM: "Inherit <inherit@e2e.local>",
      // The durable mail worker submits to a mock Resend API started by
      // research.spec.ts (the SDK honors RESEND_BASE_URL). Auth emails flow
      // through the local stack's Mailpit.
      RESEND_API_KEY: "re_e2e_mock",
      RESEND_BASE_URL: "http://127.0.0.1:8124",
    },
  },
});
