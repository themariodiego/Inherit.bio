import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PASSWORD_MAX_BYTES, PASSWORD_MAX_CHARACTERS, PASSWORD_MIN_CHARACTERS } from "./auth-request";

/**
 * The register and the three auth endpoints say the same thing (owner
 * decision 2026-10-16, "Auth endpoints: jurisdiction, date of birth, reset and
 * limits"). Each check reads the register and the code it describes, so a
 * change to either side alone fails here.
 */

const ROOT = path.resolve(__dirname, "../../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const register = JSON.parse(read("docs/route-register.json")) as {
  routes: { id: string; path: string; methods?: string[]; requestContract?: { closedBody?: Record<string, unknown> };
    policy?: Record<string, unknown>; notApplicableStates?: Record<string, string>; successResponseContract?: string }[];
  responseContracts: Record<string, Record<string, unknown>>;
  responseContractBindings: { routes: Record<string, string[]> };
  securityRateLimitContract: { bindings: { routes: string[] } };
};
const entry = (id: string) => register.routes.find((route) => route.id === id)!;
const MIGRATION = read("supabase/migrations/20261016151200_auth_public_endpoints.sql");

describe("the auth endpoints against docs/route-register.json", () => {
  it("serves exactly the registered closed bodies, with no jurisdiction, date of birth or display name", () => {
    expect(Object.keys(entry("auth.sign-up-submit").requestContract!.closedBody!)).toEqual(["email", "password"]);
    expect(Object.keys(entry("auth.forgot-password-submit").requestContract!.closedBody!)).toEqual(["email"]);
    expect(Object.keys(entry("auth.reset-password-submit").requestContract!.closedBody!)).toEqual(["password"]);
    expect(read("src/app/api/auth/sign-up/route.ts")).toContain('["email", "password"] as const');
    expect(read("src/app/api/auth/forgot-password/route.ts")).toContain('["email"] as const');
    expect(read("src/app/api/auth/reset-password/route.ts")).toContain('["password"] as const');
  });

  it("holds both password contracts to the bounds the code enforces", () => {
    const bound = `${PASSWORD_MIN_CHARACTERS}-through-${PASSWORD_MAX_CHARACTERS}-Unicode-characters-and-at-most-${PASSWORD_MAX_BYTES}-UTF-8-bytes`;
    expect(entry("auth.sign-up-submit").requestContract!.closedBody!.password).toBe(bound);
    expect(entry("auth.reset-password-submit").requestContract!.closedBody!.password).toBe(bound);
    expect([PASSWORD_MIN_CHARACTERS, PASSWORD_MAX_CHARACTERS, PASSWORD_MAX_BYTES]).toEqual([12, 72, 72]);
  });

  it("states the owner's limits, and the migration counts exactly those", () => {
    const limits = (id: string) => entry(id).policy!.rateLimits as Record<string, { windowSeconds: number; limit: number }>;
    expect(limits("auth.sign-up-submit")["normalized-identifier"]).toEqual({ windowSeconds: 3600, limit: 5 });
    expect(limits("auth.sign-up-submit")["source-network"]).toEqual({ windowSeconds: 3600, limit: 20 });
    expect(limits("auth.forgot-password-submit")["normalized-identifier"]).toEqual({ windowSeconds: 3600, limit: 3 });
    expect(limits("auth.forgot-password-submit")["source-network"]).toEqual({ windowSeconds: 3600, limit: 10 });
    expect(MIGRATION).toContain("v_identifier_limit := case p_route_id when 'auth.sign-up-submit' then 5 else 3 end;");
    expect(MIGRATION).toContain("v_network_limit := case p_route_id when 'auth.sign-up-submit' then 20 else 10 end;");
    expect(MIGRATION.match(/'windowSeconds', 3600/g)).toHaveLength(2);
    expect(register.securityRateLimitContract.bindings.routes).toEqual(
      expect.arrayContaining(["auth.sign-up-submit", "auth.forgot-password-submit"]));
    // A reset is limited by its one-use, 15-minute session instead.
    expect(MIGRATION).toContain("v_now + interval '15 minutes'");
    expect(entry("auth.reset-password-submit").policy!.rateLimits).toMatch(/^one-use-per-reset-session-with-the-15-minute/);
  });

  it("drops the under-18 branch from signup-v1 and keeps every bound response", () => {
    expect(register.responseContracts["signup-v1"]).not.toHaveProperty("under18");
    expect(Object.keys(entry("auth.sign-up-submit").policy!)).not.toEqual(expect.arrayContaining(["under18"]));
    expect(Object.keys(entry("auth.sign-up-submit").policy!)).not.toEqual(expect.arrayContaining(["ageCalculation"]));
    expect(JSON.stringify(entry("auth.sign-up-submit"))).not.toMatch(/"(under18|ageCalculation|jurisdiction[A-Za-z]*|dateOfBirth|displayName)":/);
    expect(register.responseContractBindings.routes["auth.sign-up-submit"]).toEqual(["invalid-request-v1", "signup-v1"]);
    expect(register.responseContractBindings.routes["auth.forgot-password-submit"]).toEqual(["invalid-request-v1", "auth-opaque-request-v1"]);
    expect(register.responseContractBindings.routes["auth.reset-password-submit"])
      .toEqual(["resource-not-found-v1", "invalid-request-v1", "password-reset-v1"]);
  });

  it("removes sign-up from the recorded attestation divergences, which no longer apply to it", () => {
    const ledger = JSON.parse(read("docs/route-divergence.json")) as { unhashableAttestationFields: { routeId: string }[] };
    expect(ledger.unhashableAttestationFields.map((row) => row.routeId)).not.toContain("auth.sign-up-submit");
    expect(ledger.unhashableAttestationFields).toHaveLength(4);
  });

  it("cites the reset page's success navigation at the line that makes it", () => {
    const note = entry("auth.reset-password").notApplicableStates!.complete!;
    const cited = /src\/components\/auth\/reset-password-form\.tsx:(\d+)/.exec(note);
    expect(cited).not.toBeNull();
    const line = read("src/components/auth/reset-password-form.tsx").split("\n")[Number(cited![1]) - 1]!;
    expect(line).toContain('router.push(route("auth.sign-in", { query: { notice: "password_changed" } }))');
    expect(note).not.toContain("/overview");
  });

  it("builds each endpoint at its registered path with POST alone", () => {
    for (const [id, file] of [
      ["auth.sign-up-submit", "src/app/api/auth/sign-up/route.ts"],
      ["auth.forgot-password-submit", "src/app/api/auth/forgot-password/route.ts"],
      ["auth.reset-password-submit", "src/app/api/auth/reset-password/route.ts"],
    ] as const) {
      expect(`src/app${entry(id).path}/route.ts`).toBe(file);
      expect(entry(id).methods).toEqual(["POST"]);
      expect([...read(file).matchAll(/^export async function ([A-Z]+)\(/gm)].map((match) => match[1])).toEqual(["POST"]);
    }
  });
});
