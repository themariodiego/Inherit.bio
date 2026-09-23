import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { configureLocal, nativeLocalSetupIO, prepareLocal, type LocalSetupIO } from "./self-host-local";
import { checkedConfig, checkedEnvironment, checkedStatus, localEnvironmentFile, type SigningKey } from "./self-host-local-contract";
import { localConfigurationSql } from "./self-host-local-database";

const CONFIG = fs.readFileSync(path.resolve("supabase/config.toml"), "utf8");
const TEMPLATE = fs.readFileSync(path.resolve(".env.example"), "utf8");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
/** Simulated filesystem effect of the pinned CLI; never starts a process. */
function startedFixture(root: string) {
  fs.mkdirSync(path.join(root, "supabase/.branches"));
  fs.writeFileSync(path.join(root, "supabase/.branches/_current_branch"), "main");
}
function key(): SigningKey {
  return { ...generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "jwk" }),
    kid: randomUUID(), alg: "ES256", use: "sig", key_ops: ["sign", "verify"] };
}
function jwt(auth: SigningKey, role: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "ES256", kid: auth.kid })}.${encode({ role, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${body}.${sign("sha256", Buffer.from(body), { key: createPrivateKey({ key: auth, format: "jwk" }),
    dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "inherit-local-unit-"))); roots.push(root);
  fs.mkdirSync(path.join(root, "supabase/migrations"), { recursive: true });
  fs.writeFileSync(path.join(root, "supabase/config.toml"), CONFIG);
  fs.writeFileSync(path.join(root, "supabase/migrations/20260901000000_synthetic.sql"), "-- synthetic\n");
  fs.writeFileSync(path.join(root, ".env.example"), TEMPLATE);
  fs.mkdirSync(path.join(root, "docs")); fs.writeFileSync(path.join(root, "docs/self-hosting.md"), "Synthetic guide\n");
  const calls: { command: string; args: string[]; input?: string }[] = [];
  let alter: (command: string, args: string[], answer: string) => string = (_c, _a, answer) => answer;
  const io: LocalSetupIO = { fs, bytes: randomBytes, key, now: () => "2026-09-23T07:00:00.000Z", run(command, args, input) {
    calls.push({ command, args, input });
    let answer: string;
    if (command === "corepack" && args.at(-1) === "--version") answer = "2.116.0";
    else if (command === "git") answer = args[0] === "show" ? CONFIG.trimEnd() : "1".repeat(40);
    else if (command === "docker" && args[0] === "context") answer = '"unix:///synthetic/docker.sock"';
    else if (command === "docker" && args[1] === "ls") {
      if (args[0] === "volume") expect(args.at(-1)).toBe("{{.Name}}");
      answer = "";
    } else if (command === "docker" && args[0] === "inspect") {
      const name = args.at(-1)!;
      const index = ["db", "auth", "storage", "kong"].indexOf(name.split("_")[1]);
      answer = JSON.stringify({ id: String(index + 1).repeat(64), name: `/${name}`, project: "sequence", running: true,
        created: "2026-09-23T07:01:00.000Z" });
    } else if (command === "corepack" && args.includes("status")) {
      const [auth] = JSON.parse(fs.readFileSync(path.join(root, ".inherit-local/auth-signing-keys.json"), "utf8"));
      answer = JSON.stringify({ API_URL: "http://127.0.0.1:54321", INBUCKET_URL: "http://127.0.0.1:54324",
        DB_URL: "postgresql://postgres:synthetic@127.0.0.1:54322/postgres", ANON_KEY: jwt(auth, "anon"), SERVICE_ROLE_KEY: jwt(auth, "service_role") });
    } else if (command === "docker" && args[0] === "exec") answer = "local_setup_committed";
    else throw new Error("Unexpected synthetic command");
    return alter(command, args, answer);
  } };
  return { root, io, calls, alter: (fn: typeof alter) => { alter = fn; } };
}
const mutations = [
  (s: string) => s.replace('project_id = "sequence"', 'project_id = "other"'),
  (s: string) => s.replace("port = 54321", "port = 54320"),
  (s: string) => s.replace("port = 54322", "port = 54323"),
  (s: string) => s.replace('file_size_limit = "50MiB"', 'file_size_limit = "500MiB"'),
  (s: string) => s.replace('site_url = "http://127.0.0.1:3000"', 'site_url = "https://example.invalid"'),
  (s: string) => s.replace("enable_confirmations = true", "enable_confirmations = false"),
  (s: string) => s + "\n[api]\nport=54321\n",
  (s: string) => s.replace("port = 54321", "port = 54321\nport=54321"),
  (s: string) => s.replace('# signing_keys_path = "./signing_keys.json"', 'signing_keys_path = "./owned.json"'),
  (s: string) => s.replace('# external_url = ""', 'external_url = "https://example.invalid/auth/v1"'),
  (s: string) => s + '\n[remotes.example]\nproject_id="example"\n',
];

describe("fresh local profile", () => {
  it("changes exactly the one signing path in the current checked config", () => {
    const after = checkedConfig(CONFIG, false);
    expect(after).toBe(CONFIG.replace('# signing_keys_path = "./signing_keys.json"',
      'signing_keys_path = "../.inherit-local/auth-signing-keys.json"'));
    expect(checkedConfig(after, true)).toBe(after);
    for (const mutate of mutations) expect(() => checkedConfig(mutate(CONFIG), false)).toThrow();
    expect(() => checkedConfig(`x='''\n${CONFIG}\n'''`, false)).toThrow();
  });
  it("refuses hosted/remote/test overrides and accepts only the existing fresh CI host class", () => {
    for (const name of ["VERCEL", "DOCKER_HOST", "DOCKER_CONTEXT", "NODE_OPTIONS", "INHERIT_TEST_JURISDICTION", "INHERIT_DISPOSABLE_LOCAL_E2E"])
      expect(() => checkedEnvironment({ [name]: "synthetic" })).toThrow();
    expect(() => checkedEnvironment({ CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "self-hosted" })).toThrow();
    expect(() => checkedEnvironment({ CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted" })).not.toThrow();
    for (const name of ["SUPABASE_AUTH_JWT_SECRET", "DOCKER_CONFIG", "OPENAI_API_KEY", "S3_HOST", "PGHOST"])
      expect(() => checkedEnvironment({ [name]: "synthetic" }, TEMPLATE)).toThrow("ambient_configuration_override");
    for (const name of ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "RESEND_API_KEY", "INHERIT_PREPARED_WGS_ENABLED", "ALLOW_PRIVATE_LLM_ENDPOINTS"])
      for (const value of ["synthetic", ""]) expect(() => checkedEnvironment({ [name]: value }, TEMPLATE)).toThrow(/(?:exported_app_configuration|ambient_configuration_override)/);
  });
  it("fails on missing or unreviewed template values, without returning their contents", () => {
    expect(() => localEnvironmentFile("NEW_KEY=placeholder\n", {})).toThrow("template_value");
    expect(() => localEnvironmentFile("KEY=x\nKEY=x", { KEY: "safe" })).toThrow("template_shape");
    expect(() => localEnvironmentFile("KEY=x", { KEY: "first\nsecond" })).toThrow("template_value");
  });
});

describe("prepare with synthetic command adapters", () => {
  it("gives Auth exactly one signing key when using the native crypto generator", () => {
    const { root, io } = fixture();
    // Keep every command synthetic while exercising the actual native JWK output.
    io.key = nativeLocalSetupIO(root, {}).key;
    const generated = io.key();
    expect(generated.d).toBeTruthy();
    expect(generated.key_ops).toEqual(["sign", "verify"]);
    const message = prepareLocal(root, io);
    const directory = path.join(root, ".inherit-local");
    const providerText = fs.readFileSync(path.join(directory, "auth-signing-keys.json"), "utf8");
    const providerKeys: SigningKey[] = JSON.parse(providerText);
    const upload: SigningKey = JSON.parse(fs.readFileSync(path.join(directory, "upload-signing-key.json"), "utf8"));
    expect(providerKeys).toHaveLength(2);
    const [auth, uploadPublic] = providerKeys;
    expect(auth.d).toBeTruthy();
    expect(auth.key_ops).toEqual(["sign", "verify"]);
    expect(providerKeys.filter(key => Array.isArray(key.key_ops) && key.key_ops.includes("sign"))).toEqual([auth]);
    expect(uploadPublic.key_ops).toEqual(["verify"]);
    expect(uploadPublic.d).toBeUndefined();
    expect(upload.d).toBeTruthy();
    expect(uploadPublic).toMatchObject({ kid: upload.kid, x: upload.x, y: upload.y });
    expect(auth.kid).not.toBe(upload.kid); expect(auth.x).not.toBe(upload.x);
    expect(providerText).not.toContain(upload.d);
    expect(message).not.toContain(auth.d); expect(message).not.toContain(upload.d);
  });
  it("writes separate Auth/private and upload/verify keys with private file permissions and no credential output", () => {
    const { root, io, calls } = fixture(); const message = prepareLocal(root, io);
    const directory = path.join(root, ".inherit-local");
    const [auth, uploadPublic] = JSON.parse(fs.readFileSync(path.join(directory, "auth-signing-keys.json"), "utf8"));
    const upload = JSON.parse(fs.readFileSync(path.join(directory, "upload-signing-key.json"), "utf8"));
    expect(auth.d).toBeTruthy(); expect(upload.d).toBeTruthy(); expect(uploadPublic.d).toBeUndefined();
    expect(uploadPublic.key_ops).toEqual(["verify"]); expect(auth.kid).not.toBe(upload.kid);
    expect(createPublicKey(createPrivateKey({ key: upload, format: "jwk" })).export({ format: "jwk" })).toMatchObject({ x: uploadPublic.x, y: uploadPublic.y });
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    for (const filename of fs.readdirSync(directory)) expect(fs.statSync(path.join(directory, filename)).mode & 0o777).toBe(0o600);
    expect(message).not.toContain(auth.d); expect(message).not.toContain(upload.d);
    expect(calls.every(call => !call.args.some(arg => ["start", "stop", "reset", "rm", "restart"].includes(arg)))).toBe(true);
  });
  it.each([".env.local", ".env", ".inherit-local"])("refuses existing %s without altering it", name => {
    const { root, io } = fixture(); fs.writeFileSync(path.join(root, name), "synthetic-existing");
    expect(() => prepareLocal(root, io)).toThrow();
    expect(fs.readFileSync(path.join(root, name), "utf8")).toBe("synthetic-existing");
    expect(fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8")).toBe(CONFIG);
  });
  it.each(["container-label", "volume-label", "container-name", "volume-name"])("refuses an existing project found by %s", selector => {
    const f = fixture(); f.alter((_cmd, args, answer) => args[0] === selector.split("-")[0]
      && args[1] === "ls" && args.includes("--filter") === selector.endsWith("label") ? "supabase_db_sequence" : answer);
    expect(() => prepareLocal(f.root, f.io)).toThrow(/existing_project/);
    expect(fs.existsSync(path.join(f.root, ".inherit-local"))).toBe(false);
  });
  it("refuses remote Docker contexts, unknown CLI versions and symlink config", () => {
    for (const kind of ["remote", "version", "symlink"]) {
      const f = fixture();
      f.alter((_cmd, args, answer) => kind === "remote" && args[0] === "context" ? '"tcp://127.0.0.1:2375"'
        : kind === "version" && args.at(-1) === "--version" ? "2.115.0" : answer);
      if (kind === "symlink") { fs.renameSync(path.join(f.root, "supabase/config.toml"), path.join(f.root, "supabase/original"));
        fs.symlinkSync("original", path.join(f.root, "supabase/config.toml")); }
      expect(() => prepareLocal(f.root, f.io)).toThrow();
    }
  });
  it("refuses linked project state and uncommitted configuration before writing keys", () => {
    for (const kind of ["project-ref", "pooler-url", "config.toml", "uncommitted", "dangling-temp"]) {
      const f = fixture();
      if (kind === "uncommitted") fs.appendFileSync(path.join(f.root, "supabase/config.toml"), "\n# changed\n");
      else if (kind === "dangling-temp") fs.symlinkSync("missing", path.join(f.root, "supabase/.temp"));
      else { fs.mkdirSync(path.join(f.root, "supabase/.temp")); fs.writeFileSync(path.join(f.root, "supabase/.temp", kind), "synthetic"); }
      expect(() => prepareLocal(f.root, f.io)).toThrow(); expect(fs.existsSync(path.join(f.root, ".inherit-local"))).toBe(false);
    }
  });
});

describe("configure with synthetic command adapters", () => {
  it("binds fresh status to the Auth key and exact containers, writes SQL once over stdin and atomically publishes private .env.local", () => {
    const f = fixture(); prepareLocal(f.root, f.io); startedFixture(f.root); const message = configureLocal(f.root, f.io);
    const environment = fs.readFileSync(path.join(f.root, ".env.local"), "utf8");
    expect(fs.statSync(path.join(f.root, ".env.local")).mode & 0o777).toBe(0o600);
    expect(environment).toContain("NEXT_PUBLIC_APP_URL='http://localhost:3000'");
    expect(environment).toContain("INHERIT_PREPARED_WGS_ENABLED='false'");
    expect(environment).not.toMatch(/^(RESEND_|INHERIT_PREPARED_R2_)/m);
    const writes = f.calls.filter(call => call.args[0] === "exec"); expect(writes).toHaveLength(1);
    expect(writes[0].args[2]).toBe("1".repeat(64)); expect(writes[0].input).toContain("local_setup_committed");
    expect(JSON.stringify(writes[0].args)).not.toContain("INSERT");
    expect(message).not.toContain("synthetic");
    expect(() => configureLocal(f.root, f.io)).toThrow(); expect(f.calls.filter(call => call.args[0] === "exec")).toHaveLength(1);
  });
  it.each(["label", "old", "stopped", "origin", "mail", "database", "auth-key"])("refuses %s mismatch before any database write", kind => {
    const f = fixture(); prepareLocal(f.root, f.io); startedFixture(f.root);
    f.alter((_cmd, args, answer) => {
      if (args[0] === "inspect") {
        const value = JSON.parse(answer);
        if (kind === "label") value.project = "another";
        if (kind === "old") value.created = "2026-09-22T01:00:00Z";
        if (kind === "stopped") value.running = false;
        return JSON.stringify(value);
      }
      if (args.includes("status")) {
        const value = JSON.parse(answer);
        if (kind === "origin") value.API_URL = "https://example.invalid";
        if (kind === "mail") value.INBUCKET_URL = "http://127.0.0.1:54325";
        if (kind === "database") value.DB_URL = "postgresql://postgres:synthetic@example.invalid:54322/postgres";
        if (kind === "auth-key") value.ANON_KEY = jwt(key(), "anon");
        return JSON.stringify(value);
      }
      return answer;
    });
    expect(() => configureLocal(f.root, f.io)).toThrow();
    expect(f.calls.some(call => call.args[0] === "exec")).toBe(false);
  });
  it("retains an attempt fence and pending environment after uncertain SQL; never retries", () => {
    const f = fixture(); prepareLocal(f.root, f.io); startedFixture(f.root);
    f.alter((_cmd, args, answer) => args[0] === "exec" ? "" : answer);
    expect(() => configureLocal(f.root, f.io)).toThrow("outcome_uncertain");
    expect(fs.existsSync(path.join(f.root, ".env.local"))).toBe(false);
    expect(fs.existsSync(path.join(f.root, ".inherit-local/configure-attempt.json"))).toBe(true);
    expect(() => configureLocal(f.root, f.io)).toThrow("existing_file");
    expect(f.calls.filter(call => call.args[0] === "exec")).toHaveLength(1);
  });
  it("rejects checksum-consistent missing or broadened provider key operations before SQL", () => {
    for (const kind of ["legacy-auth", "verify-only-auth", "duplicate-sign", "upload-signer", "missing-upload-ops"]) {
      const f = fixture(); prepareLocal(f.root, f.io); startedFixture(f.root);
      const directory = path.join(f.root, ".inherit-local");
      const authPath = path.join(directory, "auth-signing-keys.json");
      const keys: SigningKey[] = JSON.parse(fs.readFileSync(authPath, "utf8"));
      if (kind === "legacy-auth") delete keys[0].key_ops;
      if (kind === "verify-only-auth") keys[0].key_ops = ["verify"];
      if (kind === "duplicate-sign") keys[0].key_ops = ["sign", "sign"];
      if (kind === "upload-signer") keys[1].key_ops = ["sign", "verify"];
      if (kind === "missing-upload-ops") delete keys[1].key_ops;
      const authText = JSON.stringify(keys); fs.writeFileSync(authPath, authText);
      const manifestPath = path.join(directory, "prepared.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.authFileSha256 = createHash("sha256").update(authText).digest("hex");
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      expect(() => configureLocal(f.root, f.io)).toThrow("key_operations");
      expect(f.calls.some(call => call.args[0] === "exec" || call.args.includes("status"))).toBe(false);
      expect(fs.existsSync(path.join(directory, "configure-attempt.json"))).toBe(false);
      expect(fs.existsSync(path.join(f.root, ".env.local"))).toBe(false);
    }
  });
  it("refuses drifted config, readable key files and private-directory symlinks", () => {
    for (const kind of ["config", "mode", "symlink"]) {
      const f = fixture(); prepareLocal(f.root, f.io); startedFixture(f.root);
      if (kind === "config") fs.appendFileSync(path.join(f.root, "supabase/config.toml"), "\n# drift\n");
      if (kind === "mode") fs.chmodSync(path.join(f.root, ".inherit-local/prepared.json"), 0o644);
      if (kind === "symlink") { fs.renameSync(path.join(f.root, ".inherit-local"), path.join(f.root, "saved")); fs.symlinkSync("saved", path.join(f.root, ".inherit-local")); }
      expect(() => configureLocal(f.root, f.io)).toThrow();
      expect(f.calls.some(call => call.args[0] === "exec")).toBe(false);
    }
  });
  it("does not clobber an environment file created concurrently with SQL", () => {
    const f = fixture(); prepareLocal(f.root, f.io); startedFixture(f.root);
    f.alter((_cmd, args, answer) => { if (args[0] === "exec") fs.writeFileSync(path.join(f.root, ".env.local"), "concurrent"); return answer; });
    expect(() => configureLocal(f.root, f.io)).toThrow();
    expect(fs.readFileSync(path.join(f.root, ".env.local"), "utf8")).toBe("concurrent");
  });
  it("database transaction locks and rejects existing users/config, schema drift and partial writes before committing", () => {
    const sql = localConfigurationSql(["20260901000000"]);
    expect(sql).toContain("auth.users,public.profiles,public.subjects,public.genome_files");
    expect(sql).toContain("IN ACCESS EXCLUSIVE MODE"); expect(sql).toContain("local_setup_not_empty");
    expect(sql).toContain("local_setup_migrations"); expect(sql).toContain("local_setup_postcondition");
    expect(sql).toContain("OR EXISTS(SELECT 1 FROM pg_trigger");
    expect(sql).not.toMatch(/ON CONFLICT|UPDATE |DELETE |TRUNCATE |set_config/);
    expect(sql.indexOf("local_setup_not_empty")).toBeLessThan(sql.indexOf("INSERT INTO"));
    expect(() => localConfigurationSql(["20260901000000'; DELETE"])).toThrow();
  });
  it("malformed status is refused without propagating secret-shaped values", () => {
    expect(() => checkedStatus({ API_URL: "synthetic-secret" }, key())).toThrow("status_origin");
  });
  it("accepts only the CLI-created main marker and refuses changed, extra or symlink branch state", () => {
    for (const kind of ["other", "extra", "symlink", "marker-symlink"]) {
      const f = fixture(); prepareLocal(f.root, f.io); startedFixture(f.root);
      const branches = path.join(f.root, "supabase/.branches");
      if (kind === "other") fs.writeFileSync(path.join(branches, "_current_branch"), "other");
      if (kind === "extra") fs.mkdirSync(path.join(branches, "main"));
      if (kind === "symlink") { fs.renameSync(branches, `${branches}-saved`); fs.symlinkSync(`${branches}-saved`, branches); }
      if (kind === "marker-symlink") {
        fs.unlinkSync(path.join(branches, "_current_branch")); fs.writeFileSync(path.join(f.root, "marker"), "main");
        fs.symlinkSync(path.join(f.root, "marker"), path.join(branches, "_current_branch"));
      }
      expect(() => configureLocal(f.root, f.io)).toThrow();
      expect(f.calls.some(call => call.args[0] === "exec")).toBe(false);
    }
  });
});
