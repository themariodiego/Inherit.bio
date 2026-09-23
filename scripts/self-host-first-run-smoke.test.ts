import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkConfigured, confirmationLink, requestFence, requireRemoteRunner, sampleGenotype } from "./self-host-first-run-smoke";

const APP = "http://localhost:3000";
const API = "http://127.0.0.1:54321";
const ID = "00000000-0000-4000-8000-000000000001";
const env = { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted" };
const configured = { version: 1, configuredAt: "2026-09-23T09:00:00Z", configSha256: "config", guideSha256: "guide",
  sourceRevision: "commit", project: "sequence", apiOrigin: API, appOrigin: APP, mailOrigin: "http://127.0.0.1:54324",
  authKid: "auth", uploadKid: "upload" };
const link = `${API}/auth/v1/verify?token=synthetic&type=signup&redirect_to=${encodeURIComponent(`${APP}/auth/callback?next=/overview`)}`;

describe("remote first-run smoke boundaries (no browser or provider execution)", () => {
  it("requires the pinned hosted Linux runner and rejects arguments or bypasses", () => {
    expect(() => requireRemoteRunner(env, "linux", "v22.17.0", [])).not.toThrow();
    for (const args of [[env, "darwin", "v22.17.0", []], [env, "linux", "v22.18.0", []],
      [{ ...env, RUNNER_ENVIRONMENT: "self-hosted" }, "linux", "v22.17.0", []],
      [env, "linux", "v22.17.0", ["--run"]], [{ ...env, INHERIT_TEST_JURISDICTION: "1" }, "linux", "v22.17.0", []]] as const)
      expect(() => requireRemoteRunner(args[0], args[1], args[2], [...args[3]])).toThrow();
  });
  it("binds the configured receipt to exact source, guide, config and origins", () => {
    expect(() => checkConfigured(configured, "commit", "config", "guide")).not.toThrow();
    for (const patch of [{ sourceRevision: "other" }, { configSha256: "other" }, { guideSha256: "other" },
      { apiOrigin: "https://example.invalid" }, { appOrigin: "http://localhost:3100" },
      { authKid: "upload" }, { serviceRoleKey: "must-never-be-accepted" }])
      expect(() => checkConfigured({ ...configured, ...patch }, "commit", "config", "guide")).toThrow();
  });
  it("accepts only the local confirmation destination without exposing the token", () => {
    expect(confirmationLink({ Text: `Confirm: ${link}` })).toBe(link);
    expect(confirmationLink({ HTML: `<a href="${link.replaceAll("&", "&amp;")}">Confirm</a>` })).toBe(link);
    for (const altered of [link.replace(API, "https://example.invalid"), link.replace("type=signup", "type=recovery"),
      link.replace(encodeURIComponent(`${APP}/auth/callback?next=/overview`), encodeURIComponent("https://example.invalid"))])
      expect(() => confirmationLink({ Text: altered })).toThrow();
  });
  it("permits the actual flow but prevents repeated issuance, finalization, storage or generation", () => {
    const fence = requestFence();
    fence.admit(`${APP}/overview?_rsc=read`, "GET");
    const signup = `${API}/auth/v1/signup?redirect_to=${encodeURIComponent(`${APP}/auth/callback?next=/overview`)}`;
    fence.admit(signup, "OPTIONS"); fence.admit(signup, "POST");
    fence.admit(`${API}/auth/v1/token?grant_type=pkce`, "OPTIONS");
    fence.admit(`${API}/auth/v1/user`, "OPTIONS"); fence.admit(`${API}/auth/v1/user`, "GET");
    fence.admit(`${API}/auth/v1/token?grant_type=pkce`, "POST");
    for (const [endpoint, count] of [[`${APP}/api/account/completion`, 1], [`${APP}/api/consents`, 4],
      [`${APP}/api/files/upload-session`, 1], [`${APP}/api/files/${ID}/finalize`, 1],
      [`${APP}/api/files/${ID}/process`, 2], [`${API}/storage/v1/object/genomes/${ID}`, 1]] as const) {
      for (let index = 0; index < count; index++) fence.admit(endpoint, "POST");
      expect(() => fence.admit(endpoint, "POST")).toThrow();
    }
  });
  it.each([
    ["https://example.invalid/collect", "GET"], [`${APP}/api/chat`, "POST"], [`${APP}/api/llm/settings`, "POST"],
    [`${APP}/api/jobs/mail`, "GET"], [`${APP}/api/cron/retention`, "GET"], [`${API}/auth/v1/admin/users`, "POST"],
    [`${API}/rest/v1/genome_files`, "GET"], [`${API}/storage/v1/object/genomes/${ID}`, "DELETE"],
    [`${API}/auth/v1/token?grant_type=password`, "POST"], [`${APP}/api/consents?extra=1`, "POST"],
    [`${API}/auth/v1/signup?redirect_to=https://example.invalid`, "OPTIONS"],
    [`${API}/auth/v1/token?grant_type=pkce&extra=1`, "OPTIONS"],
    ["http://EXAMPLE_USER:EXAMPLE_PASSWORD@localhost:3000/overview", "GET"],
  ])("refuses non-flow request %s %s", (url, method) => {
    expect(() => requestFence().admit(url, method)).toThrow();
  });
  it("derives the covered call from the exact committed synthetic sample and rejects altered bytes", () => {
    const bytes = readFileSync("data/samples/synthetic-pipeline-grch38.vcf.gz");
    expect(sampleGenotype(bytes)).toMatch(/^[ACGT]\/[ACGT]$/);
    const altered = Buffer.from(bytes); altered[altered.length - 1] ^= 1;
    expect(() => sampleGenotype(altered)).toThrow();
  });
});
