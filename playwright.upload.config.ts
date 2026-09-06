import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const proxy = process.env.INHERIT_LOCAL_BROWSER_STORAGE_PROXY;
if (process.env.VERCEL || process.env.CI || !proxy || !/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(proxy)
  || !process.env.INHERIT_UPLOAD_SIGNING_JWK) {
  throw new Error("Run through scripts/run-upload-browser.mts against the local Docker stack");
}

export default defineConfig({
  ...base,
  testMatch: ["own-upload-positive.spec.ts", "own-report-results.spec.ts", "own-file-controls.spec.ts", "report-library-recovery.spec.ts",
    "behavior-study-scope.spec.ts", "report-previews.spec.ts", "report-gate.spec.ts", "own-source-provenance.spec.ts", "own-upload-pause.spec.ts"],
  projects: [{ name: "chromium", use: base.projects![0].use }],
  // Actual-provider launch args, no traces and all three exact servers come
  // from the standard config. This file remains a clearly labeled local subset.
});
