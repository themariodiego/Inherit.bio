import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { assertCiRuntime, checkedGateway, checkedAppEnvironment, checkedCiLauncherEnvironment, checkedPolicyCounters } from "./ci-browser-config";
const ci = { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", INHERIT_DISPOSABLE_LOCAL_E2E: "true" };
const gateway = { name: "/supabase_kong_sequence", project: "sequence", running: true,
  networks: { supabase_network_sequence: { IPAddress: "172.19.0.3" } } };
describe("isolated standard CI runtime boundaries", () => {
  it("requires a disposable Linux GitHub runner and closed fixture control", () => {
    expect(() => assertCiRuntime(ci, "linux")).not.toThrow();
    for (const env of [{}, { ...ci, RUNNER_ENVIRONMENT: "self-hosted" }, { ...ci, INHERIT_DISPOSABLE_LOCAL_E2E: "" },
      { ...ci, VERCEL: "1" }, { ...ci, CANONICAL_COPILOT_CONTROL_URL: "https://example.invalid" },
      { ...ci, INHERIT_LOCAL_E2E_PROJECT: "inherit-family-20260907" }]) expect(() => assertCiRuntime(env, "linux")).toThrow();
    expect(() => assertCiRuntime(ci, "darwin")).toThrow();
  });
  it("derives an address only from the exact live default project gateway and sole network", () => {
    expect(checkedGateway(gateway)).toEqual({ address: "172.19.0.3", network: "supabase_network_sequence" });
    for (const item of [null, { ...gateway, name: "/unrelated" }, { ...gateway, project: "other" }, { ...gateway, running: false },
      { ...gateway, networks: {} }, { ...gateway, networks: { arbitrary: { IPAddress: "172.19.0.3" } } },
      { ...gateway, networks: { ...gateway.networks, other: { IPAddress: "172.19.0.4" } } }]) expect(() => checkedGateway(item)).toThrow();
    for (const address of ["203.0.114.10", "127.0.0.1", "169.254.169.254", "::1", "172.19.0.3;other", "172.19.0.999"])
      expect(() => checkedGateway({ ...gateway, networks: { supabase_network_sequence: { IPAddress: address } } })).toThrow();
  });
  const app = (port: number) => ({ INHERIT_UPLOAD_SIGNING_JWK: "synthetic-signer", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "EXAMPLE_SYNTHETIC_PUBLIC", SUPABASE_SERVICE_ROLE_KEY: "EXAMPLE_SYNTHETIC_SERVICE", BYOK_ENCRYPTION_KEY: "EXAMPLE_SYNTHETIC",
    JOBS_SECRET: "EXAMPLE_SYNTHETIC", CRON_SECRET: "EXAMPLE_SYNTHETIC", EMAIL_FROM: "EXAMPLE_SYNTHETIC", RESEND_API_KEY: "EXAMPLE_SYNTHETIC",
    RESEND_BASE_URL: "http://127.0.0.1:8124", NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`, NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
    INHERIT_TEST_JURISDICTION: port === 3101 ? "" : "1", INHERIT_CANONICAL_UPLOADS_PAUSED: port === 3102 ? "true" : "false" });
  it("preserves all three variants and refuses provider destinations, bypasses, missing signers and arbitrary environments", () => {
    for (const port of [3100, 3101, 3102]) expect(checkedAppEnvironment(app(port), port)).toEqual(app(port));
    for (const env of [{ ...app(3100), NODE_OPTIONS: "--inspect" }, { ...app(3100), ALLOW_LOCAL_MODEL_ENDPOINTS: "1" },
      { ...app(3100), RESEND_BASE_URL: "https://api.resend.com" }, { ...app(3100), NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" },
      { ...app(3100), INHERIT_TEST_JURISDICTION: "" }, { ...app(3100), INHERIT_CANONICAL_UPLOADS_PAUSED: "true" },
      { ...app(3100), INHERIT_UPLOAD_SIGNING_JWK: "" }]) expect(() => checkedAppEnvironment(env, 3100)).toThrow();
    expect(() => checkedAppEnvironment(app(3100), 4000)).toThrow();
  });
  it("launches main, jurisdiction-off and paused servers with their actual distinct origins", () => {
    for (const port of [3100, 3101, 3102]) {
      const env = { ...ci, ...app(port), INHERIT_CI_BROWSER_RUNTIME: "ready" };
      expect(checkedCiLauncherEnvironment(env, port, "linux")).toEqual(app(port));
      expect(() => checkedCiLauncherEnvironment({ ...env, NEXT_PUBLIC_APP_URL: "http://localhost:3103" }, port, "linux")).toThrow();
      expect(() => checkedCiLauncherEnvironment({ ...env, INHERIT_CI_BROWSER_RUNTIME: "" }, port, "linux")).toThrow();
      expect(() => checkedCiLauncherEnvironment({ ...env, RUNNER_ENVIRONMENT: "self-hosted" }, port, "linux")).toThrow();
    }
  });
  it("requires actual firewall drop counters, not just failed network attempts", () => {
    const ipv4 = "Chain OUTPUT (policy DROP 3 packets, 180 bytes)\n1 60 DROP all -- * * 0.0.0.0/0 127.0.0.11\n";
    const ipv6 = "Chain OUTPUT (policy DROP 0 packets, 0 bytes)";
    expect(() => checkedPolicyCounters(ipv4, ipv6)).not.toThrow();
    expect(() => checkedPolicyCounters(ipv4.replace("3 packets", "0 packets"), ipv6)).toThrow();
    expect(() => checkedPolicyCounters(ipv4.replace("1 60 DROP", "0 0 DROP"), ipv6)).toThrow();
    expect(() => checkedPolicyCounters(ipv4, ipv6.replace("DROP", "ACCEPT"))).toThrow();
  });
  it("keeps all 64 reviewed output cases byte-identical", () => {
    const bytes = readFileSync("e2e/fixtures/copilot-output-cases.json");
    expect(JSON.parse(bytes.toString())).toHaveLength(64);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("075b57e3d6b89933a068db259f7962704397517c490070e913e5b8022356063f");
  });
});
