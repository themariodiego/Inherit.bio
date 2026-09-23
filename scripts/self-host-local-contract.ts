import { createPublicKey, verify, type JsonWebKey } from "node:crypto";

export const LOCAL = { project: "sequence", origin: "http://127.0.0.1:54321", app: "http://localhost:3000",
  mail: "http://127.0.0.1:54324", directory: ".inherit-local", signerPath: "../.inherit-local/auth-signing-keys.json" } as const;
export type SigningKey = JsonWebKey & { kid: string; alg: "ES256"; use: "sig" };
export function requireLocal(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`self_host_local:${code}`);
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

/** Deliberately narrower than TOML: only the checked repository profile. */
export function checkedConfig(text: string, prepared: boolean): string {
  requireLocal(!text.includes('"""') && !text.includes("'''"), "config_multiline");
  const parts = text.split(/^\s*\[([^\]\n]+)\]\s*(?:#.*)?$/m);
  const sections = new Map<string, string>([["", parts[0]]]);
  for (let i = 1; i < parts.length; i += 2) {
    requireLocal(!sections.has(parts[i]), "config_duplicate_section");
    sections.set(parts[i], parts[i + 1]);
  }
  const values = new Map<string, string>();
  for (const [section, body] of sections) for (const line of body.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const match = /^\s*([\w]+)\s*=\s*(.+?)\s*$/.exec(line);
    requireLocal(match, "config_syntax");
    const key = `${section}.${match[1]}`;
    requireLocal(!values.has(key), "config_duplicate_value");
    values.set(key, match[2]);
  }
  const required = { ".project_id": '"sequence"', "api.enabled": "true", "api.port": "54321",
    "api.tls.enabled": "false", "db.port": "54322", "db.shadow_port": "54320", "db.major_version": "17",
    "db.pooler.enabled": "false", "db.migrations.enabled": "true", "local_smtp.enabled": "true",
    "local_smtp.port": "54324", "studio.port": "54323", "studio.api_url": '"http://127.0.0.1"',
    "storage.enabled": "true", "storage.file_size_limit": '"50MiB"', "auth.enabled": "true",
    "auth.site_url": '"http://127.0.0.1:3000"', "auth.email.enable_confirmations": "true" };
  for (const [key, value] of Object.entries(required)) requireLocal(values.get(key) === value, "config_profile");
  for (const [key, value] of values) {
    if (/^(auth\.(external|third_party|web3)\.|auth\.email\.smtp\.)/.test(key) && key.endsWith(".enabled"))
      requireLocal(value === "false", "external_auth_or_mail");
    requireLocal(!key.startsWith("remotes."), "remote_config");
  }
  for (const key of ["api.external_url", "auth.external_url", "auth.jwt_issuer"])
    requireLocal(!values.has(key), "external_url_override");
  const placeholder = '# signing_keys_path = "./signing_keys.json"';
  const line = `signing_keys_path = "${LOCAL.signerPath}"`;
  if (prepared) requireLocal(values.get("auth.signing_keys_path") === `"${LOCAL.signerPath}"`, "signer_config");
  else {
    requireLocal(!values.has("auth.signing_keys_path") && text.split(placeholder).length === 2, "existing_signer");
    text = text.replace(placeholder, line);
  }
  return text;
}

export function checkedEnvironment(env: NodeJS.ProcessEnv, template = ""): void {
  const forbidden = ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "DOCKER_HOST", "DOCKER_CONTEXT", "NODE_OPTIONS",
    "INHERIT_TEST_JURISDICTION", "INHERIT_DISPOSABLE_LOCAL_E2E", "INHERIT_LOCAL_E2E_PROJECT"];
  requireLocal(forbidden.every(key => !env[key]), "environment_override");
  // The separately documented CLI start/dev commands inherit the shell too.
  // Refuse overrides here rather than merely stripping them in our children.
  for (const name of Object.keys(env)) requireLocal(env[name] === undefined
    || !/^(SUPABASE_|DOCKER_|INHERIT_|NEXT_PUBLIC_|PG(?:HOST|PORT|USER|PASSWORD|DATABASE|OPTIONS|SERVICE)$|S3_|OPENAI_API_KEY$|ANTHROPIC_API_KEY$|DEBUG$|PWDEBUG$)/.test(name),
  "ambient_configuration_override");
  for (const match of template.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm))
    requireLocal(env[match[1]] === undefined, "exported_app_configuration");
  if (env.CI) requireLocal(env.GITHUB_ACTIONS === "true" && env.RUNNER_ENVIRONMENT === "github-hosted", "ci_host");
}

export function checkedStatus(value: unknown, auth: SigningKey) {
  requireLocal(isRecord(value), "status_shape");
  requireLocal(value.API_URL === LOCAL.origin, "status_origin");
  requireLocal([value.INBUCKET_URL, value.MAILPIT_URL].some(v => v === LOCAL.mail)
    && [value.INBUCKET_URL, value.MAILPIT_URL].every(v => v === undefined || v === LOCAL.mail), "status_mail");
  let database: URL | undefined;
  try { database = new URL(String(value.DB_URL)); } catch { /* constant refusal below */ }
  requireLocal(database?.protocol === "postgresql:" && database.hostname === "127.0.0.1" && database.port === "54322"
    && database.username === "postgres" && database.password.length > 0 && database.pathname === "/postgres"
    && !database.search && !database.hash, "status_database");
  for (const [name, role] of [["ANON_KEY", "anon"], ["SERVICE_ROLE_KEY", "service_role"]]) {
    const token = value[name];
    requireLocal(typeof token === "string" && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token), "status_key");
    try {
      const [head, body, signature] = token.split(".");
      const header = JSON.parse(Buffer.from(head, "base64url").toString());
      const claims = JSON.parse(Buffer.from(body, "base64url").toString());
      requireLocal(header.alg === "ES256" && header.kid === auth.kid && claims.role === role
        && Number.isSafeInteger(claims.exp) && claims.exp > Date.now() / 1000
        && verify("sha256", Buffer.from(`${head}.${body}`), {
          key: createPublicKey({ key: auth, format: "jwk" }), dsaEncoding: "ieee-p1363",
        }, Buffer.from(signature, "base64url")), "status_key_binding");
    } catch { throw new Error("self_host_local:status_key_binding"); }
  }
  return { NEXT_PUBLIC_SUPABASE_URL: LOCAL.origin, ...Object.fromEntries([
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", value.ANON_KEY as string],
    ["SUPABASE_SERVICE_ROLE_KEY", value.SERVICE_ROLE_KEY as string], ["DATABASE_URL", value.DB_URL as string],
  ]) };
}

export type ContainerIdentity = { id: string; name: string; project: string; running: boolean; created: string };
export function checkedContainer(value: unknown, service: string, preparedAt: string): ContainerIdentity {
  requireLocal(isRecord(value), "container_shape");
  requireLocal(value.name === `/supabase_${service}_${LOCAL.project}` && value.project === LOCAL.project
    && value.running === true && typeof value.id === "string" && /^[0-9a-f]{64}$/.test(value.id)
    && typeof value.created === "string" && Number.isFinite(Date.parse(value.created))
    && Date.parse(value.created) >= Date.parse(preparedAt), "container_identity");
  return value as ContainerIdentity;
}

/** Preserve the template's comments, but emit only the reviewed local values. */
export function localEnvironmentFile(template: string, values: Record<string, string>): string {
  const omitted = new Set(["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "INHERIT_PREPARED_R2_ORIGIN", "INHERIT_PREPARED_R2_BUCKET"]);
  const seen = new Set<string>();
  const lines = template.split("\n").flatMap(line => {
    if (!line.trim() || line.trim().startsWith("#")) return [line];
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    requireLocal(match && !seen.has(match[1]), "template_shape");
    const name = match[1]; seen.add(name);
    if (omitted.has(name)) return [];
    const value = values[name];
    requireLocal(typeof value === "string" && !/[\r\n']/.test(value), "template_value");
    return [`${name}='${value}'`];
  });
  requireLocal(Object.keys(values).every(key => seen.has(key)), "template_missing_value");
  return lines.join("\n");
}
