import assert from "node:assert/strict";
import { isIP } from "node:net";
import { localE2eProject } from "./local-e2e-project";
import { assertLocalProviderEnvironment } from "./local-storage-browser-config";

type Environment = Readonly<Record<string, string | undefined>>;
export const CI_RUNTIME_IMAGE = "inherit-ci-browser:local";
export const CI_RUNTIME_CONTAINER = "inherit-ci-browser-runtime";
export const CI_RUNTIME_LABEL = "inherit.ci-browser-runtime";
export const CI_CONTROL_URL = "http://127.0.0.1:8130";
export function assertCiRuntime(env: Environment, platform = process.platform) {
  assertLocalProviderEnvironment(env, true, []);
  assertCiJob(env, platform);
}
function assertCiJob(env: Environment, platform: NodeJS.Platform) {
  localE2eProject(env);
  assert(!env.DEBUG && !env.PWDEBUG, "Credential-bearing debug output must remain disabled");
  assert(platform === "linux" && env.CI === "true" && env.GITHUB_ACTIONS === "true"
    && env.RUNNER_ENVIRONMENT === "github-hosted" && env.INHERIT_DISPOSABLE_LOCAL_E2E === "true",
  "Isolated CI runtime requires the disposable Linux GitHub-hosted job");
  assert((env.INHERIT_LOCAL_E2E_PROJECT ?? "sequence") === "sequence", "CI requires its fresh default project");
  assert(!env.CANONICAL_COPILOT_CONTROL_URL || env.CANONICAL_COPILOT_CONTROL_URL === CI_CONTROL_URL,
    "CI model fixture control cannot be overridden");
}
export function checkedGateway(value: unknown): { address: string; network: string } {
  assert(value && typeof value === "object", "Missing local gateway identity");
  const item = value as { name?: string; project?: string; running?: boolean; networks?: Record<string, { IPAddress?: string }> };
  assert(item.name === "/supabase_kong_sequence" && item.project === "sequence" && item.running === true,
    "Exact running local gateway required");
  const entries = Object.entries(item.networks ?? {});
  assert(entries.length === 1 && entries[0][0] === "supabase_network_sequence", "Exact default local network required");
  const address = entries[0][1].IPAddress ?? "";
  assert(isIP(address) === 4 && (/^172\.(1[6-9]|2\d|3[01])\./.test(address)
    || address.startsWith("10.") || address.startsWith("192.168.")), "Gateway must be a Docker private IPv4 address");
  return { address, network: entries[0][0] };
}
export const APP_ENV_NAMES = ["INHERIT_UPLOAD_SIGNING_JWK", "INHERIT_CANONICAL_UPLOADS_PAUSED", "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "BYOK_ENCRYPTION_KEY", "JOBS_SECRET", "CRON_SECRET",
  "EMAIL_FROM", "RESEND_API_KEY", "RESEND_BASE_URL", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_APP_URL", "INHERIT_TEST_JURISDICTION"] as const;
export function checkedAppEnvironment(value: unknown, port: number): Record<string, string> {
  assert([3100, 3101, 3102].includes(port), "Unregistered app port");
  assert(value && typeof value === "object" && !Array.isArray(value), "Missing app configuration");
  const env = value as Record<string, string>;
  assert(Object.keys(env).every(key => (APP_ENV_NAMES as readonly string[]).includes(key))
    && Object.values(env).every(item => typeof item === "string"), "Unregistered app configuration");
  for (const name of APP_ENV_NAMES) assert(typeof env[name] === "string", "Incomplete app configuration");
  assert(env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:54321"
    && env.RESEND_BASE_URL === "http://127.0.0.1:8124"
    && env.NEXT_PUBLIC_APP_URL === `http://localhost:${port}` && env.NEXT_PUBLIC_SITE_URL === `http://localhost:${port}`
    && env.INHERIT_TEST_JURISDICTION === (port === 3101 ? "" : "1")
    && env.INHERIT_CANONICAL_UPLOADS_PAUSED === (port === 3102 ? "true" : "false"), "App scope differs from its fixed CI variant");
  for (const name of ["INHERIT_UPLOAD_SIGNING_JWK", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"])
    assert(env[name].length > 0, "Required ephemeral app configuration missing");
  return { ...env };
}

/** Unlike job bootstrap, each server has its own exact app origin. Validate the
 * shared job identity first, then the actual scoped values without normalization. */
export function checkedCiLauncherEnvironment(env: Environment, port: number, platform = process.platform) {
  assertCiJob(env, platform);
  assert(env.INHERIT_CI_BROWSER_RUNTIME === "ready", "Runtime preflight must pass first");
  return checkedAppEnvironment(Object.fromEntries(APP_ENV_NAMES.map(name => [name, env[name]])), port);
}

/** Counter evidence distinguishes a firewall rejection from a closed port or
 * DNS NXDOMAIN. The controlled probe sends no request to an external provider. */
export function checkedPolicyCounters(ipv4: string, ipv6: string) {
  const dropped = ipv4.match(/^Chain OUTPUT \(policy DROP (\d+) packets,/m)?.[1];
  assert(dropped && Number(dropped) > 0 && /^Chain OUTPUT \(policy DROP /m.test(ipv6), "Egress DROP policy evidence missing");
  const resolver = ipv4.split("\n").find(line => /\b127\.0\.0\.11(?:\/32)?\s*$/.test(line))?.trim().split(/\s+/);
  assert(resolver && Number(resolver[0]) > 0 && resolver[2] === "DROP", "Embedded DNS packets were not demonstrably dropped");
}
