import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const proxy = process.env.INHERIT_LOCAL_BROWSER_STORAGE_PROXY;
if (process.env.VERCEL || process.env.CI || !proxy || !/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(proxy)
  || !process.env.INHERIT_UPLOAD_SIGNING_JWK) {
  throw new Error("Run through scripts/run-upload-browser.mts against the local Docker stack");
}

const servers = (Array.isArray(base.webServer) ? base.webServer : [base.webServer!]).map(server => ({
  ...server,
  reuseExistingServer: false, // Never reuse a server lacking this ephemeral signer.
  env: { ...server.env, INHERIT_UPLOAD_SIGNING_JWK: process.env.INHERIT_UPLOAD_SIGNING_JWK!,
    INHERIT_CANONICAL_UPLOADS_PAUSED: "false" },
}));

export default defineConfig({
  ...base,
  testMatch: ["own-upload-positive.spec.ts", "own-report-results.spec.ts", "own-file-controls.spec.ts", "report-library-recovery.spec.ts",
    "behavior-study-scope.spec.ts", "report-previews.spec.ts", "report-gate.spec.ts", "own-source-provenance.spec.ts", "own-upload-pause.spec.ts"],
  projects: [{ name: "chromium", use: base.projects![0].use }],
  use: {
    ...base.use,
    trace: "off", // Do not persist the one-use upload bearer in network traces.
    // Installed Playwright 1.62.1 passes this explicit Chromium rule through:
    // remove implicit localhost bypass, so the positive upload proves proxy use.
    proxy: { server: proxy, bypass: "<-loopback>" },
  },
  webServer: [...servers, {
    // Same build, signer, browser proxy and TEST-LOCAL jurisdiction. Keep the
    // second server's jurisdiction-off meaning independent of operational pause.
    ...servers[0],
    command: "corepack pnpm start --port 3102",
    port: 3102,
    timeout: 120_000,
    env: { ...servers[0].env, NEXT_PUBLIC_SITE_URL: "http://localhost:3102",
      NEXT_PUBLIC_APP_URL: "http://localhost:3102", INHERIT_CANONICAL_UPLOADS_PAUSED: "true" },
  }],
});
