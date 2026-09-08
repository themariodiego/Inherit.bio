import { describe, expect, it } from "vitest";
import { localE2eProject, disposableProjectWorkdir, validateDisposableProjectConfig, disposableBootstrapKeys } from "./local-e2e-project";

const family = { INHERIT_LOCAL_E2E_PROJECT: "inherit-family-20260907",
  INHERIT_LOCAL_E2E_WORKDIR: "/synthetic/work/family-disposable-stack" };
const config = `project_id = "inherit-family-20260907"
[api]
port = 55321
[db]
port = 55322
shadow_port = 55320
[local_smtp]
port = 55324
`;
const env = { API_URL: "http://127.0.0.1:55321", DB_URL: "postgresql://postgres:synthetic@127.0.0.1:55322/postgres",
  ANON_KEY: "synthetic-public-key", SERVICE_ROLE_KEY: "synthetic-service-key" };

// Explicitly synthetic userinfo exercises URL rejection without embedding a
// credential-bearing URL literal in repository or authored-history evidence.
function credentialedOrigin() {
  const target = new URL("http://127.0.0.1:55321");
  target.username = "synthetic-user";
  target.password = "synthetic-password";
  return target.href.replace(/\/$/, "");
}

describe("closed local E2E project selection", () => {
  it("preserves every default sequence endpoint/container and accepts the one explicit disposable target", () => {
    expect(localE2eProject({})).toEqual({ projectId: "sequence", apiOrigin: "http://127.0.0.1:54321", dbPort: 54322,
      shadowPort: 54320, mailpitOrigin: "http://127.0.0.1:54324", dbContainer: "supabase_db_sequence", storageContainer: "supabase_storage_sequence" });
    expect(localE2eProject(family)).toEqual({ projectId: "inherit-family-20260907", apiOrigin: "http://127.0.0.1:55321", dbPort: 55322,
      shadowPort: 55320, mailpitOrigin: "http://127.0.0.1:55324", dbContainer: "supabase_db_inherit-family-20260907",
      storageContainer: "supabase_storage_inherit-family-20260907" });
    expect(() => localE2eProject({ ...family, NEXT_PUBLIC_SUPABASE_URL: env.API_URL })).not.toThrow();
    expect(Object.isFrozen(localE2eProject(family))).toBe(true);
  });
  it("rejects unknown project/container names and incomplete or unbound workdirs", () => {
    for (const project of ["", "other", "supabase_db_sequence", "../sequence", "inherit-family-20260907;id", "INHERIT-FAMILY-20260907"]) {
      expect(() => localE2eProject({ ...family, INHERIT_LOCAL_E2E_PROJECT: project })).toThrow();
    }
    for (const directory of [undefined, "", "family-disposable-stack", "/tmp/sequence", "/tmp/../family-disposable-stack", "/tmp/family-disposable-stack/"]) {
      expect(() => localE2eProject({ ...family, INHERIT_LOCAL_E2E_WORKDIR: directory })).toThrow();
    }
    expect(() => localE2eProject({ INHERIT_LOCAL_E2E_WORKDIR: family.INHERIT_LOCAL_E2E_WORKDIR })).toThrow();
    expect(disposableProjectWorkdir(family)).toBe(family.INHERIT_LOCAL_E2E_WORKDIR);
  });
  it("rejects hosted execution, alternate API targets and Family selection in any CI", () => {
    for (const hosted of [{ VERCEL: "1" }, { VERCEL_ENV: "preview" }, { VERCEL_URL: "example.vercel.app" }]) {
      expect(() => localE2eProject(hosted)).toThrow();
      expect(() => localE2eProject({ ...family, ...hosted })).toThrow();
    }
    expect(() => localE2eProject({ ...family, CI: "true" })).toThrow();
    for (const origin of ["http://127.0.0.1:54321", "http://localhost:55321", "https://127.0.0.1:55321",
      "https://example.supabase.co", "http://127.0.0.1:55321/", credentialedOrigin(), "http://[::1]:55321"]) {
      expect(() => localE2eProject({ ...family, NEXT_PUBLIC_SUPABASE_URL: origin })).toThrow();
    }
    expect(() => localE2eProject({ NEXT_PUBLIC_SUPABASE_URL: env.API_URL })).toThrow();
  });
  it("checks all CLI config identity/ports before status can read bootstrap keys", () => {
    const target = localE2eProject(family);
    expect(() => validateDisposableProjectConfig(config, target)).not.toThrow();
    for (const changed of [config.replace('"inherit-family-20260907"', '"sequence"'), config.replace("55321", "54321"),
      config.replace("55322", "54322"), config.replace("55320", "54320"), config.replace("55324", "54324"),
      config + "\n[api]\nport=55321\n", config.replace("[api]", "[unknown]"),
      config.replace("port = 55321", "port = 55321\nport = 54321"), `text = '''\n${config}'''`]) {
      expect(() => validateDisposableProjectConfig(changed, target)).toThrow();
    }
    expect(() => validateDisposableProjectConfig(config, localE2eProject({}))).toThrow();
  });
  it("extracts only selected-project keys and refuses missing or mismatched status without leaking values", () => {
    const target = localE2eProject(family);
    expect(disposableBootstrapKeys(env, target)).toEqual({ NEXT_PUBLIC_SUPABASE_URL: env.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY });
    for (const changed of [null, [], {}, { ...env, API_URL: "http://127.0.0.1:54321" },
      { ...env, DB_URL: "postgresql://postgres:synthetic@127.0.0.1:54322/postgres" },
      { ...env, DB_URL: "postgresql://postgres:synthetic@evil.example:55322/postgres" },
      { ...env, DB_URL: "postgresql://postgres:synthetic@127.0.0.1:55322/another" },
      { ...env, DB_URL: "synthetic-secret-malformed-url" }, { ...env, ANON_KEY: "" }, { ...env, SERVICE_ROLE_KEY: undefined }]) {
      let failure: unknown;
      try { disposableBootstrapKeys(changed, target); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).not.toMatch(/synthetic|evil\.example|postgresql/);
    }
  });
});
