/** Fresh local setup only. Never starts, resets, rotates or removes a stack. */
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkedConfig, checkedContainer, checkedEnvironment, checkedStatus, isRecord,
  LOCAL, localEnvironmentFile, requireLocal, type SigningKey } from "./self-host-local-contract";
import { localConfigurationSql } from "./self-host-local-database";

type Command = (command: "docker" | "corepack" | "git", args: string[], input?: string) => string;
export type LocalSetupIO = { fs: typeof fs; run: Command; key: () => SigningKey; bytes: typeof randomBytes; now: () => string };
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const PRIVATE = ["auth-signing-keys.json", "upload-signing-key.json", "prepared.json"];
const JSON_FORMAT = '{"id":{{json .Id}},"name":{{json .Name}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"running":{{json .State.Running}},"created":{{json .Created}}}';

export function nativeLocalSetupIO(root: string, env: Readonly<Record<string, string | undefined>>): LocalSetupIO {
  // Provider/config overrides, debug flags and credentials never reach children.
  const childEnv = Object.fromEntries(["PATH", "HOME", "TMPDIR", "COREPACK_HOME", "XDG_RUNTIME_DIR"]
    .flatMap(name => env[name] ? [[name, env[name]]] : []));
  return { fs, bytes: randomBytes, now: () => new Date().toISOString(), key: () => ({
    ...generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "jwk" }),
    // Auth selects its one signer by key_ops: https://github.com/supabase/auth/blob/v2.196.0/internal/conf/jwk.go
    kid: randomUUID(), alg: "ES256", use: "sig", key_ops: ["sign", "verify"],
  }), run: (command, args, input) => {
    try {
      // Node accepts an unset NODE_ENV; Next's global type requires one.
      // Keep the child environment restricted to the allowlist above.
      return execFileSync(command, args, { cwd: root, env: childEnv as NodeJS.ProcessEnv, input, encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"], timeout: 30_000, maxBuffer: 1_048_576 }).trim();
    } catch {
      const phase = command === "git" ? "source_read" : command === "corepack" ?
        (args.includes("status") ? "status" : "cli_version") : args[0] === "exec" ? "database_uncertain" : "docker_read";
      throw new Error(`self_host_local:${phase}_command_failed_no_retry`);
    }
  } };
}

function absent(io: LocalSetupIO, filename: string): void {
  try { io.fs.lstatSync(filename); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("self_host_local:existing_file");
}
function file(io: LocalSetupIO, filename: string, privateFile = false): string {
  const stat = io.fs.lstatSync(filename);
  requireLocal(stat.isFile() && !stat.isSymbolicLink(), "file_type");
  if (privateFile) requireLocal((stat.mode & 0o777) === 0o600 && stat.uid === process.getuid?.(), "private_file_mode");
  return io.fs.readFileSync(filename, "utf8");
}
function parse(text: string): unknown {
  try { return JSON.parse(text); } catch { throw new Error("self_host_local:invalid_json"); }
}
function writeNew(io: LocalSetupIO, filename: string, text: string): void {
  io.fs.writeFileSync(filename, text, { flag: "wx", mode: 0o600 });
}
function checkedRoot(root: string, io: LocalSetupIO, env: Readonly<Record<string, string | undefined>>, prepared: boolean) {
  checkedEnvironment(env, file(io, path.join(root, ".env.example")));
  requireLocal(path.isAbsolute(root) && io.fs.realpathSync(root) === root, "root_path");
  requireLocal(!io.fs.lstatSync(path.join(root, "supabase")).isSymbolicLink(), "config_directory");
  for (const name of [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"])
    absent(io, path.join(root, name));
  for (const name of [".temp/project-ref", ".temp/pooler-url", ".temp/config.toml"])
    absent(io, path.join(root, "supabase", name));
  const branches = path.join(root, "supabase/.branches");
  if (!prepared) absent(io, branches);
  else {
    // The pinned CLI's first start creates exactly this default marker.
    const branchStat = io.fs.lstatSync(branches);
    requireLocal(branchStat.isDirectory() && !branchStat.isSymbolicLink()
      && JSON.stringify(io.fs.readdirSync(branches)) === '["_current_branch"]'
      && file(io, path.join(branches, "_current_branch")) === "main", "local_branch_state");
  }
  const temp = path.join(root, "supabase/.temp");
  let tempStat: fs.Stats | undefined;
  try { tempStat = io.fs.lstatSync(temp); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (tempStat) requireLocal(tempStat.isDirectory() && !tempStat.isSymbolicLink(), "cli_temp_directory");
  requireLocal(io.run("corepack", ["pnpm", "exec", "supabase", "--version"]) === "2.116.0", "cli_version");
  const endpoint = parse(io.run("docker", ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"]));
  requireLocal(typeof endpoint === "string" && endpoint.startsWith("unix:///") && !endpoint.includes("\n"), "docker_endpoint");
}

export function prepareLocal(root: string, io: LocalSetupIO, env: Readonly<Record<string, string | undefined>> = {}) {
  checkedRoot(root, io, env, false);
  const configPath = path.join(root, "supabase/config.toml");
  const before = file(io, configPath); const configured = checkedConfig(before, false);
  requireLocal(before === io.run("git", ["show", "HEAD:supabase/config.toml"]) + "\n", "config_not_clean");
  const directory = path.join(root, LOCAL.directory); absent(io, directory);
  for (const kind of ["container", "volume"]) {
    const common = kind === "container" ? ["container", "ls", "--all"] : ["volume", "ls"];
    requireLocal(!io.run("docker", [...common, "--filter", `label=com.supabase.cli.project=${LOCAL.project}`,
      "--format", kind === "container" ? "{{.ID}}" : "{{.Name}}"]), "existing_project");
    const names = io.run("docker", [...common, "--format", kind === "container" ? "{{.Names}}" : "{{.Name}}"]);
    requireLocal(!names.split("\n").some(name => /^supabase_.*_sequence$/.test(name)), "existing_project_name");
  }
  const auth = io.key(); const upload = io.key();
  const publicUpload = { ...createPublicKey(createPrivateKey({ key: upload, format: "jwk" })).export({ format: "jwk" }),
    kid: upload.kid, alg: "ES256", use: "sig", key_ops: ["verify"] };
  requireLocal(auth.kid !== upload.kid && auth.x !== upload.x, "distinct_signers");
  io.fs.mkdirSync(directory, { mode: 0o700 });
  const authFile = JSON.stringify([auth, publicUpload]); const uploadFile = JSON.stringify(upload);
  writeNew(io, path.join(directory, PRIVATE[0]), authFile);
  writeNew(io, path.join(directory, PRIVATE[1]), uploadFile);
  const manifest = { version: 1, preparedAt: io.now(), configSha256: sha(configured),
    authKid: auth.kid, uploadKid: upload.kid, authFileSha256: sha(authFile), uploadFileSha256: sha(uploadFile) };
  writeNew(io, path.join(directory, PRIVATE[2]), JSON.stringify(manifest));
  requireLocal(file(io, configPath) === before, "config_changed");
  const pending = path.join(directory, "config.pending"); writeNew(io, pending, configured);
  io.fs.renameSync(pending, configPath);
  return "Prepared fresh local signing keys. Start the local stack once, then run configure.";
}

export function configureLocal(root: string, io: LocalSetupIO, env: Readonly<Record<string, string | undefined>> = {}) {
  checkedRoot(root, io, env, true);
  const directory = path.join(root, LOCAL.directory);
  const stat = io.fs.lstatSync(directory);
  requireLocal(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o700
    && stat.uid === process.getuid?.(), "private_directory");
  const manifest = parse(file(io, path.join(directory, PRIVATE[2]), true));
  requireLocal(isRecord(manifest) && manifest.version === 1 && typeof manifest.preparedAt === "string"
    && Number.isFinite(Date.parse(manifest.preparedAt)), "manifest");
  const config = checkedConfig(file(io, path.join(root, "supabase/config.toml")), true);
  requireLocal(sha(config) === manifest.configSha256, "config_changed");
  const authFile = file(io, path.join(directory, PRIVATE[0]), true);
  const uploadFile = file(io, path.join(directory, PRIVATE[1]), true);
  requireLocal(sha(authFile) === manifest.authFileSha256 && sha(uploadFile) === manifest.uploadFileSha256, "key_file_changed");
  const keys = parse(authFile); const upload = parse(uploadFile);
  requireLocal(Array.isArray(keys) && keys.length === 2 && isRecord(keys[0]) && isRecord(keys[1]) && isRecord(upload)
    && keys[0].kid === manifest.authKid && keys[1].kid === manifest.uploadKid && upload.kid === manifest.uploadKid
    && keys[0].kid !== keys[1].kid && typeof keys[0].d === "string" && keys[1].d === undefined,
  "key_files");
  requireLocal(Array.isArray(keys[0].key_ops) && keys[0].key_ops.length === 2
    && keys[0].key_ops.includes("sign") && keys[0].key_ops.includes("verify")
    && Array.isArray(keys[1].key_ops) && keys[1].key_ops.length === 1 && keys[1].key_ops[0] === "verify",
  "key_operations");
  const publicUpload = createPublicKey(createPrivateKey({ key: upload, format: "jwk" })).export({ format: "jwk" });
  requireLocal(["kty", "crv", "x", "y"].every(name => keys[1][name] === publicUpload[name]), "upload_key_binding");
  const output = path.join(root, ".env.local"); absent(io, output);
  const attempt = path.join(directory, "configure-attempt.json"); absent(io, attempt);
  const identities = ["db", "auth", "storage", "kong"].map(service => checkedContainer(
    parse(io.run("docker", ["inspect", "--format", JSON_FORMAT, `supabase_${service}_${LOCAL.project}`])), service, manifest.preparedAt as string));
  const status = checkedStatus(parse(io.run("corepack", ["pnpm", "exec", "supabase", "status", "-o", "json"])), keys[0] as SigningKey);
  const generated = Object.fromEntries(([ ["BYOK_ENCRYPTION_KEY", "base64"], ["JOBS_SECRET", "hex"],
    ["CRON_SECRET", "hex"] ] as const).map(([name, encoding]) => [name, io.bytes(32).toString(encoding)]));
  const environment = localEnvironmentFile(file(io, path.join(root, ".env.example")), { ...status,
    NEXT_PUBLIC_SITE_URL: LOCAL.app, NEXT_PUBLIC_APP_URL: LOCAL.app, INHERIT_UPLOAD_SIGNING_JWK: JSON.stringify(upload),
    INHERIT_CANONICAL_UPLOADS_PAUSED: "false", INHERIT_NORMALIZATION_DIRECT_DATABASE: "false", INHERIT_PREPARED_WGS_ENABLED: "false",
    ...generated, EMAIL_FROM: "Inherit <inherit@localhost>" });
  const versions = io.fs.readdirSync(path.join(root, "supabase/migrations")).map(name => {
    const match = /^(\d{14})_[\w-]+\.sql$/.exec(name); requireLocal(match, "migration_filename"); return match[1];
  });
  const sql = localConfigurationSql(versions);
  const revision = io.run("git", ["rev-parse", "HEAD"]); requireLocal(/^[0-9a-f]{40}$/.test(revision), "source_revision");
  const guideHash = sha(file(io, path.join(root, "docs/self-hosting.md")));
  // From this point an uncertain outcome must be reconciled, never retried.
  writeNew(io, path.join(directory, "environment.pending"), environment);
  writeNew(io, attempt, JSON.stringify({ attemptedAt: io.now(), databaseId: identities[0].id, querySha256: sha(sql) }));
  const result = io.run("docker", ["exec", "-i", identities[0].id, "psql", "-XAtq", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], sql);
  requireLocal(result === "local_setup_committed", "configuration_outcome_uncertain_no_retry");
  // link is an atomic no-replace publication; rename would overwrite a racer.
  io.fs.linkSync(path.join(directory, "environment.pending"), output);
  io.fs.unlinkSync(path.join(directory, "environment.pending"));
  writeNew(io, path.join(directory, "configured.json"), JSON.stringify({ version: 1, configuredAt: io.now(), configSha256: sha(config),
    guideSha256: guideHash, sourceRevision: revision, project: LOCAL.project, apiOrigin: LOCAL.origin, appOrigin: LOCAL.app,
    mailOrigin: LOCAL.mail, authKid: manifest.authKid, uploadKid: manifest.uploadKid }));
  return "Configured the fresh local stack. Environment saved in .env.local. No server was started.";
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    requireLocal(process.argv.length === 3, "usage_prepare_or_configure");
    const operation = process.argv[2]; requireLocal(operation === "prepare" || operation === "configure", "usage_prepare_or_configure");
    const root = fs.realpathSync(process.cwd()); const io = nativeLocalSetupIO(root, process.env);
    console.log(operation === "prepare" ? prepareLocal(root, io, process.env) : configureLocal(root, io, process.env));
  } catch (error) {
    const code = error instanceof Error && /^self_host_local:[a-z_]{1,64}$/.test(error.message) ? error.message : "self_host_local:stopped";
    console.error(`${code}. No automatic retry or cleanup was attempted. Check the guide's recovery instructions; keep private files private.`);
    process.exitCode = 1;
  }
}
