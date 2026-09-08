import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertLocalProviderEnvironment, chromiumStorageProxyArgs, localBrowserTarget, localBrowserUpstreamTimeout } from "./local-storage-browser-config";
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
  it("routes only the selected disposable API and refuses the preserved sequence gateway", () => {
    const family = { INHERIT_LOCAL_E2E_PROJECT: "inherit-family-20260907",
      INHERIT_LOCAL_E2E_WORKDIR: "/synthetic/work/family-disposable-stack" };
    expect(() => assertLocalProviderEnvironment(family, true, ["--config=family.config.ts"])).not.toThrow();
    expect(localBrowserTarget("http://127.0.0.1:55321/storage/v1/object/genomes/source", family).origin)
      .toBe("http://127.0.0.1:55321");
    expect(localBrowserTarget("http://localhost:3100/api/uploads", family).origin).toBe("http://localhost:3100");
    const withSyntheticCredentials = new URL("http://127.0.0.1:55321/storage/v1/");
    withSyntheticCredentials.username = "synthetic-user";
    withSyntheticCredentials.password = "synthetic-password";
    for (const target of ["http://127.0.0.1:54321/auth/v1/token", "http://localhost:55321/storage/v1/",
      "https://example.supabase.co/storage/v1/", withSyntheticCredentials.href]) {
      expect(() => localBrowserTarget(target, family)).toThrow();
    }
    expect(() => localBrowserTarget("http://127.0.0.1:55321/storage/v1/", {})).toThrow();
    expect(() => assertLocalProviderEnvironment({ ...family, ...disposable }, true, [])).toThrow();
  });
  it("uses the route budget only for exact same-origin local normalization POSTs", () => {
    const path = "/api/files/cccccccc-cccc-4ccc-8ccc-cccccccccccc/process";
    for (const origin of ["http://localhost:3100", "http://localhost:3101", "http://localhost:3102"]) {
      expect(localBrowserUpstreamTimeout(origin + path, "POST", origin)).toBe(300_000);
    }
    const origin = "http://localhost:3100";
    for (const altered of [path + "?mode=own", path + "?", path + "#fragment", path + "/",
      path.replace("process", "%70rocess"), path.replace("/files/", "/files%2f"),
      path.replace("/api/", "/ignored/../api/"), path.replace("4ccc", "not-a-uuid"), "/api/files"]) {
      expect(localBrowserUpstreamTimeout(origin + altered, "POST", origin)).toBe(60_000);
    }
    for (const method of ["GET", "PUT", "OPTIONS", "DELETE", "post", undefined]) {
      expect(localBrowserUpstreamTimeout(origin + path, method, origin)).toBe(60_000);
    }
    for (const otherOrigin of [undefined, "http://localhost:3101", "https://inherit.bio"]) {
      expect(localBrowserUpstreamTimeout(origin + path, "POST", otherOrigin)).toBe(60_000);
    }
    expect(localBrowserUpstreamTimeout("http://127.0.0.1:54321" + path, "POST", "http://127.0.0.1:54321")).toBe(60_000);
    expect(() => localBrowserUpstreamTimeout("https://inherit.bio" + path, "POST", "https://inherit.bio")).toThrow();
  });
  it("wires the upstream timeout selector and preserves the actual process route budget", () => {
    const route = readFileSync("src/app/api/files/[id]/process/route.ts", "utf8");
    expect(route).toMatch(/export const maxDuration = 300;/);
    const runner = readFileSync("scripts/run-upload-browser.mts", "utf8");
    expect(runner).toContain('const upstreamTimeout = localBrowserUpstreamTimeout(request.url ?? "", request.method, request.headers.origin);');
    expect(runner).toContain("upstream.setTimeout(upstreamTimeout, () => upstream.destroy());");
    expect(runner).toContain("if (upstreamTimeout === 300_000)");
    expect(runner).toContain("const deadline = setTimeout(() => { upstream.destroy(); response.destroy(); }, upstreamTimeout);");
    for (const event of ['upstream.once("error", clearDeadline)', 'upstream.once("close", clearDeadline)',
      'response.once("finish", clearDeadline)', 'response.once("close", clearDeadline)']) expect(runner).toContain(event);
    expect(runner).not.toContain("upstream.setTimeout(60_000");
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
