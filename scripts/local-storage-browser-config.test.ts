import { describe, expect, it } from "vitest";
import { assertLocalProviderEnvironment, chromiumStorageProxyArgs, localBrowserTarget } from "./local-storage-browser-config";
import { verifyE2EReport } from "./e2e-report-contract";

describe("local provider runner safety boundaries", () => {
  const disposable = { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", INHERIT_DISPOSABLE_LOCAL_E2E: "true" };
  it("permits ordinary local and exact disposable full CI while refusing hosted/shared/narrowed/debug execution", () => {
    expect(() => assertLocalProviderEnvironment({}, false, [])).not.toThrow();
    expect(() => assertLocalProviderEnvironment(disposable, true, [])).not.toThrow();
    for (const env of [{ VERCEL: "1" }, { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" },
      { NEXT_PUBLIC_SITE_URL: "https://inherit.bio" }, { CI: "true" }, { ...disposable, RUNNER_ENVIRONMENT: "self-hosted" },
      { ...disposable, INHERIT_DISPOSABLE_LOCAL_E2E: "" }, { DEBUG: "pw:api" }, { PWDEBUG: "1" },
      { PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK: "1" }]) {
      expect(() => assertLocalProviderEnvironment(env, true, [])).toThrow();
    }
    expect(() => assertLocalProviderEnvironment(disposable, false, [])).toThrow();
    expect(() => assertLocalProviderEnvironment(disposable, true, ["--grep=upload"])).toThrow();
  });
  it("refuses arbitrary proxy destinations, credentials and alternate gateway hosts", () => {
    for (const target of ["http://127.0.0.1:54321/auth/v1/token", "http://localhost:3100/api/files",
      "http://localhost:3101/api/export", "http://localhost:3102/files/upload"]) expect(localBrowserTarget(target).href).toBe(target);
    for (const target of ["https://inherit.bio", "http://localhost:54321/storage/v1/", "http://127.0.0.1:3100/",
      "http://localhost:3103/", "http://name:password@localhost:3100/", "http://localhost.evil.test:3100/",
      "http://169.254.169.254/", "http://[::1]:3100/", "https://localhost:3100/", "/api/files"]) {
      expect(() => localBrowserTarget(target)).toThrow();
    }
  });
  it("configures only Chromium CLI proxy flags, with forced loopback and no APIRequest proxy option", () => {
    expect(chromiumStorageProxyArgs("http://127.0.0.1:45678")).toEqual([
      "--proxy-server=http://127.0.0.1:45678", "--proxy-bypass-list=<-loopback>",
    ]);
    for (const proxy of ["https://127.0.0.1:45678", "http://localhost:45678", "http://127.0.0.1",
      "http://user:pass@127.0.0.1:45678", "http://127.0.0.1:45678/path", "http://127.0.0.1:45678/?token=bad"]) {
      expect(() => chromiumStorageProxyArgs(proxy)).toThrow();
    }
  });
});

describe("no-skip/no-retry fresh-report gate", () => {
  const report = (status: string, retry = 0) => ({ suites: [{ suites: [{ specs: [{ tests: [{ results: [{ status, retry }] }] }] }] }] });
  it("accepts nested passing evidence and rejects empty, skipped, retried, failed or interrupted results", () => {
    expect(verifyE2EReport(report("passed"))).toBe(1);
    expect(() => verifyE2EReport({ suites: [] })).toThrow();
    for (const status of ["skipped", "failed", "interrupted", "timedOut"]) expect(() => verifyE2EReport(report(status))).toThrow();
    expect(() => verifyE2EReport(report("passed", 1))).toThrow();
  });
});
