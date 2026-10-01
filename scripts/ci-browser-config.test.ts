import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { assertCiRuntime, checkedGateway, checkedAppEnvironment, checkedCiLauncherEnvironment, checkedPolicyCounters, LOCAL_MODEL_ENV, PREPARED_APP_ENV, EMBRYO_APP_ENV } from "./ci-browser-config";
const ci = { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", INHERIT_DISPOSABLE_LOCAL_E2E: "true" };
const gateway = { name: "/supabase_kong_sequence", project: "sequence", running: true,
  networks: { supabase_network_sequence: { IPAddress: "172.19.0.3" } } };
const syntheticWebhookSecret = `whsec_${randomBytes(32).toString("base64")}`;
const expectedVariantVerifier = syntheticWebhookSecret;
const refusedOtherVariantVerifier = syntheticWebhookSecret;
function expectAppIdentity(actual: Record<string, string>, expected: Record<string, string>) {
  expect(actual.RESEND_WEBHOOK_SECRET === expected.RESEND_WEBHOOK_SECRET).toBe(true);
  const withoutVerifier = (env: Record<string, string>) => Object.fromEntries(Object.entries(env).filter(([name]) => name !== "RESEND_WEBHOOK_SECRET"));
  expect(withoutVerifier(actual)).toEqual(withoutVerifier(expected));
}
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
    INHERIT_TEST_JURISDICTION: port === 3101 ? "" : "1", INHERIT_CANONICAL_UPLOADS_PAUSED: port === 3102 ? "true" : "false",
    ...(port === 3103 ? LOCAL_MODEL_ENV : {}),
    ...(port === 3105 ? {...EMBRYO_APP_ENV,RESEND_WEBHOOK_SECRET:expectedVariantVerifier} : {}), ...(port === 3104 ? PREPARED_APP_ENV : {}) });
  it("preserves all five variants and refuses provider destinations, bypasses, missing signers and arbitrary environments", () => {
    for (const port of [3100, 3101, 3102, 3103, 3104, 3105]) expectAppIdentity(checkedAppEnvironment(app(port), port), app(port));
    for (const env of [{ ...app(3100), NODE_OPTIONS: "--inspect" }, { ...app(3100), ALLOW_LOCAL_MODEL_ENDPOINTS: "1" },
      { ...app(3100), RESEND_BASE_URL: "https://api.resend.com" }, { ...app(3100), NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" },
      { ...app(3100), INHERIT_TEST_JURISDICTION: "" }, { ...app(3100), INHERIT_CANONICAL_UPLOADS_PAUSED: "true" },
      { ...app(3100), INHERIT_UPLOAD_SIGNING_JWK: "" }]) expect(() => checkedAppEnvironment(env, 3100)).toThrow();
    expect(() => checkedAppEnvironment(app(3100), 4000)).toThrow();
    // The local-model attestation is the fourth variant's alone, fixed to the
    // synthetic loopback origin: another variant may not carry it, and the
    // fourth may neither drop it nor widen it to any other origin.
    for (const port of [3101, 3102]) expect(() => checkedAppEnvironment({ ...app(port), ...LOCAL_MODEL_ENV }, port)).toThrow();
    const withoutFlag = Object.fromEntries(Object.entries(app(3103)).filter(([name]) => name !== "ALLOW_LOCAL_MODEL_ENDPOINTS"));
    expect(() => checkedAppEnvironment(withoutFlag, 3103)).toThrow();
    for (const env of [{ ...app(3103), INHERIT_LOCAL_MODEL_ORIGINS: JSON.stringify(["http://10.0.0.5:11434"]) },
      { ...app(3103), INHERIT_LOCAL_MODEL_ORIGINS: JSON.stringify(["http://127.0.0.1:8127", "http://127.0.0.1:11434"]) },
      { ...app(3103), INHERIT_LOCAL_MODEL_HOST_ATTESTATION: "other" }, { ...app(3103), INHERIT_DEPLOYMENT_KIND: "vercel" },
      { ...app(3103), ALLOW_LOCAL_MODEL_ENDPOINTS: "0" }]) expect(() => checkedAppEnvironment(env, 3103)).toThrow();
    expect(() => checkedAppEnvironment(app(3103), 3100)).toThrow();
  });
  it("launches main, jurisdiction-off, paused and local-model servers with their actual distinct origins", () => {
    for (const port of [3100, 3101, 3102, 3103, 3104, 3105]) {
      const env = { ...ci, ...app(port), INHERIT_CI_BROWSER_RUNTIME: "ready" };
      expectAppIdentity(checkedCiLauncherEnvironment(env, port, "linux"), app(port));
      expect(() => checkedCiLauncherEnvironment({ ...env, NEXT_PUBLIC_APP_URL: "http://localhost:3109" }, port, "linux")).toThrow();
      expect(() => checkedCiLauncherEnvironment({ ...env, INHERIT_CI_BROWSER_RUNTIME: "" }, port, "linux")).toThrow();
      expect(() => checkedCiLauncherEnvironment({ ...env, RUNNER_ENVIRONMENT: "self-hosted" }, port, "linux")).toThrow();
    }
  });
  it("keeps the prepared gate exclusive and cannot mix it with local-model authority", () => {
    for (const port of [3100, 3101, 3102, 3103])
      expect(() => checkedAppEnvironment({ ...app(port), ...PREPARED_APP_ENV }, port)).toThrow();
    expect(() => checkedAppEnvironment({ ...app(3104), ...LOCAL_MODEL_ENV }, 3104)).toThrow();
    for (const value of [undefined, "", "false", "1"])
      expect(() => checkedAppEnvironment({ ...app(3104), INHERIT_PREPARED_WGS_ENABLED: value }, 3104)).toThrow();
  });
  it("pins every prepared artifact field to the isolated gateway on the prepared variant alone", () => {
    expect(PREPARED_APP_ENV).toEqual({ INHERIT_PREPARED_WGS_ENABLED: "true",
      INHERIT_PREPARED_R2_ORIGIN: "https://prepared.artifacts.test:8140", INHERIT_PREPARED_R2_BUCKET: "inherit-prepared-ci" });
    for (const name of Object.keys(PREPARED_APP_ENV)) {
      const omitted = Object.fromEntries(Object.entries(app(3104)).filter(([key]) => key !== name));
      expect(() => checkedAppEnvironment(omitted, 3104)).toThrow();
      for (const port of [3100, 3101, 3102, 3103])
        expect(() => checkedAppEnvironment({ ...app(port), [name]: PREPARED_APP_ENV[name as keyof typeof PREPARED_APP_ENV] }, port)).toThrow();
    }
    for (const origin of ["", "http://prepared.artifacts.test:8140", "https://prepared.artifacts.test:8141",
      "https://prepared.artifacts.test:8140/", "https://model.copilot.test:8140", "https://203.0.114.11:8140",
      "https://prepared.artifacts.test:8140?redirect=1", "https://example.invalid:8140"])
      expect(() => checkedAppEnvironment({ ...app(3104), INHERIT_PREPARED_R2_ORIGIN: origin }, 3104)).toThrow();
    for (const bucket of ["", "genomes", "inherit-prepared-other", "inherit-prepared-ci/"])
      expect(() => checkedAppEnvironment({ ...app(3104), INHERIT_PREPARED_R2_BUCKET: bucket }, 3104)).toThrow();
  });
  it("admits the exact embryo gateway only on its fixed app variant", () => {
    expect(checkedAppEnvironment(app(3105), 3105)).toEqual(app(3105));
    for (const name of Object.keys(EMBRYO_APP_ENV)) {
      expect(() => checkedAppEnvironment(Object.fromEntries(Object.entries(app(3105)).filter(([key]) => key !== name)), 3105)).toThrow();
      expect(() => checkedAppEnvironment({ ...app(3105), [name]: "changed" }, 3105)).toThrow();
      for (const port of [3100, 3101, 3102, 3103, 3104])
        expect(() => checkedAppEnvironment({ ...app(port), [name]: EMBRYO_APP_ENV[name as keyof typeof EMBRYO_APP_ENV] }, port)).toThrow();
    }
    for (const origin of ["http://embryo.fragments.test:8141", "https://embryo.fragments.test:8140", "https://embryo.fragments.test:8141/", "https://example.invalid:8141"])
      expect(() => checkedAppEnvironment({ ...app(3105), INHERIT_EMBRYO_R2_ORIGIN: origin }, 3105)).toThrow();
  });
  it("keeps the ephemeral webhook verifier exclusive to the isolated TEST-LOCAL variant",()=>{
    expect(expectedVariantVerifier===refusedOtherVariantVerifier).toBe(true);
    expect(checkedAppEnvironment(app(3105),3105).RESEND_WEBHOOK_SECRET===syntheticWebhookSecret).toBe(true);
    const omitted=Object.fromEntries(Object.entries(app(3105)).filter(([name])=>name!=="RESEND_WEBHOOK_SECRET"));
    expect(()=>checkedAppEnvironment(omitted,3105)).toThrow();
    for(const malformedWebhookVerifier of ["","whsec_not-a-key","whsec_"+"x".repeat(200)])
      expect(()=>checkedAppEnvironment({...app(3105),RESEND_WEBHOOK_SECRET:malformedWebhookVerifier},3105)).toThrow();
    for(const port of [3100,3101,3102,3103,3104])
      expect(()=>checkedAppEnvironment({...app(port),RESEND_WEBHOOK_SECRET:refusedOtherVariantVerifier},port)).toThrow();
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
