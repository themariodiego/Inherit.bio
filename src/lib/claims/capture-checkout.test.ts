import { execFileSync } from "node:child_process";
import { openSync, readFileSync } from "node:fs";
import { access, chmod, link, mkdir, mkdtemp, readFile, rename, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertEmailCaptureCheckout } from "./capture-emails";

vi.mock("node:fs", async original => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, openSync: vi.fn(actual.openSync), readFileSync: vi.fn(actual.readFileSync) };
});
vi.mock("node:fs/promises", async original => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

// Disposable repositories only: no test modifies the real source checkout.
async function checkout(project = "sequence", cliVersion = "2.116.0") {
  const directory = await mkdtemp(join(tmpdir(), "inherit-capture-checkout-"));
  const root = join(directory, "repo"), output = join(directory, "capture");
  await mkdir(join(root, "src/lib/claims"), { recursive: true });
  await writeFile(join(root, "src/lib/claims/email-fixtures.ts"), "export const fixture = 'synthetic';\n");
  await writeFile(join(root, "src/lib/claims/corpus.ts"), "export const policy = 'synthetic';\n");
  await mkdir(join(root, "supabase"));
  await writeFile(join(root, "supabase/config.toml"), `project_id = "${project}"\n`);
  await writeFile(join(root, "pnpm-lock.yaml"), `      supabase:\n        specifier: ^${cliVersion}\n        version: ${cliVersion}\n`);
  await writeFile(join(root, ".gitignore"), "node_modules/\n.next/\n*.local\n.env*\n/workers/requester-statement-archive/worker-configuration.d.ts\n/workers/requester-statement-archive/.wrangler/\nsupabase/.temp/\nsupabase/.branches/\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("add", ".");
  git("-c", "user.name=Capture Fixture", "-c", "user.email=capture@example.test", "commit", "--quiet", "-m", "Synthetic capture checkout");
  return { root, output, directory, git, commit: git("rev-parse", "HEAD") };
}

describe("complete capture checkout binding", () => {
  const runtimeOutput = "supabase/.temp/start-secrets/supabase_edge_runtime_sequence/env/docker.env";
  async function runtimeFile(root: string) {
    const file = join(root, runtimeOutput);
    await mkdir(join(file, ".."), { recursive: true, mode: 0o700 });
    await writeFile(file, "synthetic opaque runtime bytes, not renderer configuration", { mode: 0o600 });
    return file;
  }

  it("admits only the exact CLI runtime output without opening, reading or hashing its contents", async () => {
    const f = await checkout(), file = await runtimeFile(f.root);
    vi.mocked(openSync).mockClear();vi.mocked(readFileSync).mockClear();vi.mocked(readFile).mockClear();
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, f.output)).not.toThrow();
    for (const calls of [vi.mocked(openSync).mock.calls, vi.mocked(readFileSync).mock.calls, vi.mocked(readFile).mock.calls])
      expect(calls.some(call => String(call[0]) === file)).toBe(false);
  });

  it.each(["symlink", "hardlink", "world-readable", "writable", "empty", "oversize", "linked-parent"])("refuses %s runtime output metadata", async kind => {
    const f = await checkout(), file = await runtimeFile(f.root);
    if (kind === "symlink" || kind === "hardlink") {
      const target = join(f.directory, "synthetic-runtime");await writeFile(target, "synthetic", { mode: 0o600 });
      await unlink(file);
      if (kind === "symlink") await symlink(target, file);else await link(target, file);
    } else if (kind === "linked-parent") {
      const directory = join(file, "..");
      await rename(directory, join(f.directory, "env"));
      await symlink(join(f.directory, "env"), directory, "dir");
    } else if (kind === "empty" || kind === "oversize") await writeFile(file, kind === "empty" ? "" : "x".repeat(65_537), { mode: 0o600 });
    else await chmod(file, kind === "world-readable" ? 0o644 : 0o622);
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, f.output)).toThrow("unsafe-local-runtime-output");
  });

  it.each([["foreign", "2.116.0"], ["sequence", "2.117.0"]])("refuses runtime output outside the fixed project/CLI source context %s/%s", async (project, cliVersion) => {
    const f = await checkout(project, cliVersion);await runtimeFile(f.root);
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, f.output)).toThrow("unsafe-local-runtime-output");
  });

  it.each(["supabase/config.toml", "pnpm-lock.yaml"])("never follows a linked public context %s", async name => {
    const f = await checkout(), file = join(f.root, name), target = join(f.directory, "synthetic-context");
    await writeFile(target, await readFile(file));await unlink(file);await symlink(target, file);
    f.git("add", "--", name);
    f.git("-c", "user.name=Capture Fixture", "-c", "user.email=capture@example.test", "commit", "--quiet", "-m", "Synthetic linked context");
    await runtimeFile(f.root);
    expect(() => assertEmailCaptureCheckout(f.root, f.git("rev-parse", "HEAD"), f.output)).toThrow();
  });

  it("reports bounded escaped filenames while still refusing every unknown ignored input and hiding values", async () => {
    const f = await checkout();
    await writeFile(join(f.root, '.env.local'), "SYNTHETIC_VALUE_NEVER_REPORTED");
    await writeFile(join(f.root, 'line\nbreak.local'), "SYNTHETIC_VALUE_NEVER_REPORTED");
    let message = "";
    try { assertEmailCaptureCheckout(f.root, f.commit, f.output); } catch (error) { message = (error as Error).message; }
    expect(message).toContain("email-capture:untracked-ignored-inputs:");
    expect(message).not.toContain("SYNTHETIC_VALUE_NEVER_REPORTED");
    expect(message).not.toContain("\n");
    expect(JSON.parse(message.slice(message.indexOf("{")!))).toEqual({ count: 2, paths: [".env.local", "line\nbreak.local"], truncated: false });
  });

  it("bounds the refused filename diagnostic without allowing omitted or long paths", async () => {
    const f = await checkout();
    for (let index = 0; index < 20; index++) await writeFile(join(f.root, `${String(index).padStart(2, "0")}.local`), "synthetic");
    const folder = "00" + "a".repeat(148);await mkdir(join(f.root, folder));
    await writeFile(join(f.root, folder, "b".repeat(140) + ".local"), "synthetic");
    let message = "";
    try { assertEmailCaptureCheckout(f.root, f.commit, f.output); } catch (error) { message = (error as Error).message; }
    const diagnostic = JSON.parse(message.slice(message.indexOf("{")));
    expect(diagnostic.count).toBe(21);expect(diagnostic.paths).toHaveLength(16);expect(diagnostic.truncated).toBe(true);
    expect(diagnostic.paths.every((name: string) => name.length <= 256)).toBe(true);
    expect(diagnostic.paths).toContain("[path too long]");
  });
  it("allows a clean commit and only known ignored generated output", async () => {
    const f = await checkout();
    await mkdir(join(f.root, "node_modules/synthetic"), { recursive: true });
    await writeFile(join(f.root, "node_modules/synthetic/index.js"), "// synthetic installation\n");
    await mkdir(join(f.root, ".next"));
    await writeFile(join(f.root, ".next/build.txt"), "synthetic build\n");
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, f.output)).not.toThrow();
  });

  it("allows the exact requester archive type and cache outputs created before CI capture", async () => {
    const f = await checkout();
    const worker = join(f.root, "workers/requester-statement-archive");
    await mkdir(join(worker, ".wrangler/cache"), { recursive: true });
    await writeFile(join(worker, "worker-configuration.d.ts"), "// synthetic generated runtime types\n");
    await writeFile(join(worker, ".wrangler/cache/cf.json"), "{\"synthetic\":true}\n");
    expect(f.git("ls-files", "--others", "--ignored", "--exclude-standard").split("\n").sort()).toEqual([
      "workers/requester-statement-archive/.wrangler/cache/cf.json",
      "workers/requester-statement-archive/worker-configuration.d.ts",
    ]);
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, f.output)).not.toThrow();
  });

  it("allows only the two passive CLI markers from mandatory early local startup", async () => {
    const f = await checkout();
    await mkdir(join(f.root, "supabase/.temp"), { recursive: true });
    await mkdir(join(f.root, "supabase/.branches"), { recursive: true });
    await writeFile(join(f.root, "supabase/.temp/cli-latest"), "v2.120.0");
    await writeFile(join(f.root, "supabase/.branches/_current_branch"), "main");
    expect(f.git("ls-files", "--others", "--ignored", "--exclude-standard").split("\n").sort()).toEqual([
      "supabase/.branches/_current_branch", "supabase/.temp/cli-latest",
    ]);
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, f.output)).not.toThrow();
  });

  it.each([
    ["supabase/.temp/cli-latest", "untrusted-source"],
    ["supabase/.branches/_current_branch", "foreign-branch"],
    ["supabase/.temp/cli-latest", "v2.120.0\nsource"],
    ["supabase/.temp/cli-latest", "v" + "1".repeat(64)],
  ])("refuses non-inert or unbounded CLI marker %s", async (file, value) => {
    const f = await checkout();
    await mkdir(join(f.root, file, ".."), { recursive: true });
    await writeFile(join(f.root, file), value);
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, f.output)).toThrow("unsafe-cli-marker");
  });

  it.each(["symlink", "hardlink", "writable"])("refuses %s CLI marker ownership", async kind => {
    const f = await checkout(), file = join(f.root, "supabase/.temp/cli-latest");
    await mkdir(join(f.root, "supabase/.temp"), { recursive: true });
    if (kind === "symlink" || kind === "hardlink") {
      const target = join(f.directory, "synthetic-cli-version"); await writeFile(target, "v2.120.0");
      if (kind === "symlink") await symlink(target, file); else await link(target, file);
    } else { await writeFile(file, "v2.120.0"); await chmod(file, 0o666); }
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, f.output)).toThrow("unsafe-cli-marker");
  });

  it.each(["email-fixtures.ts", "corpus.ts"])("refuses an uncommitted %s change before receipt publication", async (file) => {
    const f = await checkout();
    await writeFile(join(f.root, "src/lib/claims", file), "export const changed = 'synthetic';\n");
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, f.output)).toThrow("uncommitted-renderer-inputs");
    await expect(access(join(f.output, "capture.json"))).rejects.toMatchObject({ code: "ENOENT" });
    f.git("add", ".");
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, f.output)).toThrow("uncommitted-renderer-inputs");
  });

  it("refuses a new presentation source outside all previous enumerated paths", async () => {
    const f = await checkout();
    await mkdir(join(f.root, "presentation"));
    await writeFile(join(f.root, "presentation/claim.ts"), "export const text = 'synthetic';\n");
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, f.output)).toThrow("uncommitted-renderer-inputs");
  });

  it.each(["src/lib/claims/source.local", ".env.local",
    "workers/requester-statement-archive/source.local",
    "workers/requester-statement-archive/.env.local",
    "workers/requester-statement-archive/worker-configuration.d.ts.local",
    "workers/requester-statement-archive/.wrangler.local",
    "workers/requester-statement-archive/.wrangler/source.local",
    "workers/requester-statement-archive/.wrangler/cache/.env.local",
    "supabase/.temp/project-ref", "supabase/.temp/pooler-url", "supabase/.temp/config.toml",
    "supabase/.temp/.env.local", "supabase/.temp/source.local", "supabase/.temp/cli-latest.local",
    "supabase/.branches/source.local", "supabase/.branches/_current_branch.local",
    "supabase/.temp/start-secrets/supabase_edge_runtime_foreign/env/docker.env",
    "supabase/.temp/start-secrets/supabase_edge_runtime_sequence/env/source.local",
    "supabase/.temp/start-secrets/supabase_edge_runtime_sequence/env/docker.env.local",
    "supabase/.temp/start-secrets/supabase_edge_runtime_sequence/multiline-env/multiline-env.sh",
    "supabase/.temp/start-secrets/supabase_edge_runtime_sequence/multiline-env/values/env-0",
  ])("refuses ignored untracked input %s", async (file) => {
    const f = await checkout();
    await mkdir(join(f.root, file, ".."), { recursive: true });
    await writeFile(join(f.root, file), "synthetic-input\n");
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, f.output)).toThrow("untracked-ignored-inputs");
  });

  it("refuses changed HEAD even when the new checkout is clean", async () => {
    const f = await checkout();
    f.git("-c", "user.name=Capture Fixture", "-c", "user.email=capture@example.test", "commit", "--quiet", "--allow-empty", "-m", "Synthetic later commit");
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, f.output)).toThrow("content-commit-changed");
  });

  it("refuses output within the checkout, including an external symlink into it", async () => {
    const f = await checkout();
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, join(f.root, "capture"))).toThrow("output-inside-checkout");
    const link = join(f.directory, "outside-link");
    await symlink(f.root, link, "dir");
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, join(link, "capture"))).toThrow("output-inside-checkout");
  });
});
