import assert from "node:assert/strict";
import path from "node:path";

type Environment = Readonly<Record<string, string | undefined>>;
const PROJECTS = {
  sequence: { projectId: "sequence", apiOrigin: "http://127.0.0.1:54321", dbPort: 54322,
    shadowPort: 54320, mailpitOrigin: "http://127.0.0.1:54324", dbContainer: "supabase_db_sequence",
    storageContainer: "supabase_storage_sequence" },
  "inherit-family-20260907": { projectId: "inherit-family-20260907", apiOrigin: "http://127.0.0.1:55321", dbPort: 55322,
    shadowPort: 55320, mailpitOrigin: "http://127.0.0.1:55324", dbContainer: "supabase_db_inherit-family-20260907",
    storageContainer: "supabase_storage_inherit-family-20260907" },
} as const;
export type LocalE2eProject = (typeof PROJECTS)[keyof typeof PROJECTS];

/** Closed test infrastructure choices, never application authority or an arbitrary host/container override. */
export function localE2eProject(env: Environment): LocalE2eProject {
  assert(!env.VERCEL && !env.VERCEL_ENV && !env.VERCEL_URL, "Local test targets cannot run in a hosted environment");
  const name = env.INHERIT_LOCAL_E2E_PROJECT ?? "sequence";
  assert(name === "sequence" || name === "inherit-family-20260907", "Unregistered local test project");
  const project = PROJECTS[name];
  assert(!env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL === project.apiOrigin,
    "Supabase origin must match the selected local test project");
  if (name === "sequence") {
    assert(env.INHERIT_LOCAL_E2E_WORKDIR === undefined, "Default project cannot take a workdir override");
  } else {
    assert(!env.CI, "Disposable Family target is local only; standard CI must remain unchanged");
    disposableProjectWorkdir(env);
  }
  return Object.freeze(project);
}

export function disposableProjectWorkdir(env: Environment): string {
  const directory = env.INHERIT_LOCAL_E2E_WORKDIR;
  assert(typeof directory === "string" && path.isAbsolute(directory)
    && path.resolve(directory) === directory && path.basename(directory) === "family-disposable-stack",
    "An exact absolute family-disposable-stack workdir is required");
  return directory;
}

/** Check the root-owned CLI config before status reads any project's bootstrap credentials. */
export function validateDisposableProjectConfig(text: string, project: LocalE2eProject): void {
  assert(project.projectId === "inherit-family-20260907", "Disposable config is only for the registered Family project");
  // This bounded configuration does not use TOML multiline strings. Reject
  // them so a quoted block cannot masquerade as the scalar sections below.
  assert(!text.includes('"""') && !text.includes("'''"), "Multiline TOML values are not supported by this test bootstrap");
  const sections = text.split(/^\s*\[([^\]\n]+)\]\s*(?:#.*)?$/m);
  const root = sections[0];
  const section = (name: string) => {
    const found: string[] = [];
    for (let i = 1; i < sections.length; i += 2) if (sections[i] === name) found.push(sections[i + 1]);
    assert(found.length === 1, "Missing or duplicate selected local config section");
    return found[0];
  };
  const scalar = (body: string, key: string) => {
    const matches = [...body.matchAll(new RegExp(`^\\s*${key}\\s*=\\s*([^#\\n]+?)[ \\t]*(?:#.*)?$`, "gm"))];
    assert(matches.length === 1, "Missing or duplicate selected local config scalar");
    return matches[0][1].trim();
  };
  assert(scalar(root, "project_id") === '"inherit-family-20260907"'
    && scalar(section("api"), "port") === "55321"
    && scalar(section("db"), "port") === "55322"
    && scalar(section("db"), "shadow_port") === "55320"
    && scalar(section("local_smtp"), "port") === "55324",
  "CLI configuration must match the exact disposable project and ports");
}

/** Only status from the already checked project may populate Family credentials.
 * Never include the status object, URL or credentials in an assertion message. */
export function disposableBootstrapKeys(status: unknown, project: LocalE2eProject) {
  assert(project.projectId === "inherit-family-20260907", "Expected the registered disposable project");
  assert(status && typeof status === "object" && !Array.isArray(status), "Invalid local CLI status");
  const env = status as Record<string, unknown>;
  let database: URL | undefined;
  try { if (typeof env.DB_URL === "string") database = new URL(env.DB_URL); } catch { /* closed refusal below */ }
  assert(env.API_URL === project.apiOrigin && database?.protocol === "postgresql:"
    && database.hostname === "127.0.0.1" && database.port === String(project.dbPort)
    && database.pathname === "/postgres", "CLI status does not match the selected local project");
  assert(typeof env.ANON_KEY === "string" && env.ANON_KEY.length > 0
    && typeof env.SERVICE_ROLE_KEY === "string" && env.SERVICE_ROLE_KEY.length > 0,
  "Selected local project bootstrap keys are unavailable");
  return { NEXT_PUBLIC_SUPABASE_URL: project.apiOrigin,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY };
}
