import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { densityCapturePlan, densityStateKey } from "./density-capture-plan";
import { assertUnansweredCopilotRows, copilotDensityRecipe, COPILOT_DENSITY_STATES, COPILOT_DENSITY_TABLES,
  DENSITY_COPILOT_ENDPOINT } from "./density-copilot-states";
import type { DensityRegister } from "./density-current";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const source = read("e2e/helpers/density-copilot-state-fixtures.ts");
const register = JSON.parse(read("docs/route-register.json")) as DensityRegister;
const owner = "11111111-1111-4111-8111-111111111111";
// Pure parser values only. These do not seed a native actor or establish
// permission, provider, conversation or screenshot evidence.
const emptyRows = (): Record<string, Record<string, unknown>[]> => ({
  ...Object.fromEntries(COPILOT_DENSITY_TABLES.map(name => [name, []])),
  profiles: [{ id: owner, copilot_settings_revision: 1 }],
  subjects: [{ id: "22222222-2222-4222-8222-222222222222", owner_account_id: owner,
    subject_account_id: owner, subject_class: "self", lifecycle: "active" }],
  subject_principals: [{ id: "33333333-3333-4333-8333-333333333333", account_id: owner,
    subject_id: "22222222-2222-4222-8222-222222222222", principal_kind: "account_subject", status: "active" }],
  llm_settings: [{ user_id: owner, provider: "openai_compatible", base_url: DENSITY_COPILOT_ENDPOINT,
    model: "synthetic-model", key_last4: null, copilot_recipient: { provider: "openai_compatible", model: "synthetic-model", providerClass: "cloud",
      origin: "https://203.0.114.10:8123", baseUrl: DENSITY_COPILOT_ENDPOINT, revision: 1 } }],
});

describe("real unanswered Copilot density states", () => {
  it("prepares exactly three registered own conversation states and no completed model answer", () => {
    const rows = densityCapturePlan(register, []).states.filter(row => copilotDensityRecipe(row));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map(row => densityStateKey(row.route.id, row.state)))).toEqual(new Set(
      Object.keys(COPILOT_DENSITY_STATES["copilot.scope"]).map(state => densityStateKey("copilot.scope", state))));
    for (const state of ["complete", "jurisdiction-unavailable", "partial-coverage", "not-covered"])
      expect(copilotDensityRecipe({ ...rows[0], state })).toBeNull();
  });
  it("rejects missing, extra, malformed or foreign full native actor rows", () => {
    expect(() => assertUnansweredCopilotRows(emptyRows(), owner)).not.toThrow();
    const missing = emptyRows(); delete missing.chats;
    expect(() => assertUnansweredCopilotRows(missing, owner)).toThrow();
    expect(() => assertUnansweredCopilotRows({ ...emptyRows(), unobserved: [] }, owner)).toThrow();
    for (const value of [null, [], { ...emptyRows(), chats: null }, { ...emptyRows(), chats: [null] }])
      expect(() => assertUnansweredCopilotRows(value, owner)).toThrow();
    const foreign = emptyRows(); foreign.profiles[0].id = "44444444-4444-4444-8444-444444444444";
    expect(() => assertUnansweredCopilotRows(foreign, owner)).toThrow();
    const nonself = emptyRows(); nonself.subjects[0].subject_class = "other_adult";
    expect(() => assertUnansweredCopilotRows(nonself, owner)).toThrow();
    const accessor = Object.defineProperty(emptyRows(), "chats", { get: () => [] });
    expect(() => assertUnansweredCopilotRows(accessor, owner)).toThrow();
  });
  it("refuses a source, key, consent, saved chat or context instead of calling it unanswered", () => {
    for (const name of ["llm_keys", "subject_consents", "consent_signatures", "consent_grants", "genome_files",
      "chats", "copilot_context_tokens", "purpose_grants"]) {
      const rows = emptyRows(); rows[name] = [{ id: "44444444-4444-4444-8444-444444444444" }];
      expect(() => assertUnansweredCopilotRows(rows, owner)).toThrow();
    }
    const wrongActor = emptyRows(); wrongActor.subject_principals[0].account_id = "44444444-4444-4444-8444-444444444444";
    expect(() => assertUnansweredCopilotRows(wrongActor, owner)).toThrow();
    for (const patch of [{ subject_id: "44444444-4444-4444-8444-444444444444" }, { principal_kind: "reviewer" }, { status: "revoked" }]) {
      const rows = emptyRows(); Object.assign(rows.subject_principals[0], patch);
      expect(() => assertUnansweredCopilotRows(rows, owner)).toThrow();
    }
  });
  it("requires the actual fixed key-free cloud recipient and positive current revision", () => {
    for (const patch of [{ providerClass: "local" }, { revision: 0 }, { revision: "1" }, { revision: 1.5 },
      { origin: "https://elsewhere.test" }, { baseUrl: "https://elsewhere.test/v1" },
      { provider: "anthropic" }, { model: "other-model" }, { revision: 2 }]) {
      const rows = emptyRows(); rows.llm_settings[0].copilot_recipient = { ...(rows.llm_settings[0].copilot_recipient as object), ...patch };
      expect(() => assertUnansweredCopilotRows(rows, owner)).toThrow();
    }
    const key = emptyRows(); key.llm_settings[0].key_last4 = "test";
    expect(() => assertUnansweredCopilotRows(key, owner)).toThrow();
    const otherModel = emptyRows(); otherModel.llm_settings[0].model = "other-model";
    expect(() => assertUnansweredCopilotRows(otherModel, owner)).toThrow();
  });
  it("uses real settings, native complete-count reads and the original consent refusal", () => {
    for (const text of ["await createConfirmedUser(", "await signIn(", 'pathname === "/api/llm/settings"',
      'select("*", { count: "exact" })', "expect(result.data!.length).toBe(result.count)",
      "assertUnansweredCopilotRows(rows, accountId)", "expect(response.status()).toBe(403)",
      'error: "consent_required", provider_key: DENSITY_COPILOT_PROVIDER', 'await page.goto("/copilot/me")'])
      expect(source).toContain(text);
    expect(source).not.toMatch(/\.fulfill\(|\.abort\(|\.setContent\(|\.addInitScript\(|\.listen\(|\.from\([^)]*\)\.(?:insert|update|upsert)\(/u);
    const route = read("src/app/api/chat/route.ts");
    expect(route.indexOf('error: "consent_required"')).toBeLessThan(route.indexOf("const result = streamText("));
    expect(source).toContain('expect(actual, "the consent refusal stores no conversation or permission").toEqual(original)');
  });
  it("holds exactly one original POST and awaits its real 403 before context disposal", () => {
    // 2026-10-23 (G8.5): the compatibility panel posts the registered body to /api/chat with no ?scope= query.
    expect(source).toContain('page.route("**/api/chat"');
    expect(source).not.toContain("/api/chat?scope=");
    expect(source).toContain('assert(++intercepted === 1, "Exactly one original chat POST required")');
    expect(source).toContain("await route.continue()"); expect(source).toContain("await response.finished() === null");
    expect(source.indexOf("if (release) { release(); if (continuation) await continuation; }")).toBeLessThan(source.indexOf("await context.close()"));
    expect(source).toContain('toHaveText("Ask about You")');
    expect(source).toContain('[data-role="assistant"], [data-figure-kind], [data-claim-block]');
    expect(source).toContain('getByRole("button", { name: "Send", exact: true })).toBeDisabled()');
    expect(source).toContain('getByRole("button", { name: "Review what would be shared", exact: true })).toBeVisible()');
  });
});
