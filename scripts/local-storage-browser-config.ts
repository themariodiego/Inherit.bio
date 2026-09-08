import assert from "node:assert/strict";
import { localE2eProject } from "./local-e2e-project";

export const LOCAL_STORAGE_ORIGIN = localE2eProject(process.env).apiOrigin;
export const LOCAL_BROWSER_ORIGINS = [LOCAL_STORAGE_ORIGIN,
  "http://localhost:3100", "http://localhost:3101", "http://localhost:3102"] as const;

/** These are test-runner boundaries, never application authorization switches. */
export function assertLocalProviderEnvironment(env: Readonly<Record<string, string | undefined>>, fullSuite: boolean, selectors: string[]) {
  const project = localE2eProject(env);
  assert(!env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK,
    "Loopback proxying must remain enabled");
  assert(!env.DEBUG && !env.PWDEBUG, "Credential-bearing browser/provider debug output must remain disabled");
  assert(!env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL === project.apiOrigin,
    "Only the exact local Supabase API is supported");
  for (const name of ["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_APP_URL"]) {
    assert(!env[name] || env[name] === "http://localhost:3100", "Only the exact main local app origin is supported");
  }
  if (env.CI) {
    assert(env.GITHUB_ACTIONS === "true" && env.RUNNER_ENVIRONMENT === "github-hosted"
      && env.INHERIT_DISPOSABLE_LOCAL_E2E === "true", "CI bootstrap requires the explicitly disposable GitHub-hosted job");
    assert(fullSuite && selectors.length === 0, "CI must run the full standard browser suite without selectors");
  }
}

export function localBrowserTarget(value: string, env: Readonly<Record<string, string | undefined>> = process.env): URL {
  const target = new URL(value);
  const origins = [localE2eProject(env).apiOrigin, ...LOCAL_BROWSER_ORIGINS.slice(1)];
  assert(origins.some(origin => origin === target.origin)
    && !target.username && !target.password, "Local test proxy destination refused");
  return target;
}

/** Chromium flags apply to every browser context, including browser.newContext.
 * They do not populate Playwright's context proxy option, so APIRequest and
 * route.fetch keep their normal local HTTP transport instead of using CONNECT.
 * Chromium's explicit loopback rule is verified by the transport smoke script.
 */
export function chromiumStorageProxyArgs(proxy: string): string[] {
  const parsed = new URL(proxy);
  assert(parsed.protocol === "http:" && parsed.hostname === "127.0.0.1" && parsed.port
    && parsed.pathname === "/" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash,
    "An exact loopback proxy URL is required");
  return [`--proxy-server=${parsed.origin}`, "--proxy-bypass-list=<-loopback>"];
}
