import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
const guide = readFileSync("docs/self-hosting.md", "utf8");
const localSection = guide.split("## 2. Fully local (recommended first run)")[1].split("## 3.")[0];
const localCommand = localSection.match(/```bash\n(corepack pnpm exec tsx[^\n]* scripts\/seed\.ts)\n```/)?.[1];
const exported = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:65432",
  SUPABASE_SERVICE_ROLE_KEY: "EXAMPLE_ONLY_EXPORTED_SEED_KEY",
};
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "inherit-seed-env-"));
  mkdirSync(path.join(directory, "scripts"));
  writeFileSync(path.join(directory, ".env.local"), [
    "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321",
    "SUPABASE_SERVICE_ROLE_KEY=EXAMPLE_ONLY_LOCAL_SEED_KEY",
  ].join("\n"), { mode: 0o600 });
  writeFileSync(path.join(directory, ".env"), "SEED_PROBE_AMBIENT=unexpected\n", { mode: 0o600 });
  writeFileSync(path.join(directory, ".env.production"), "SEED_PROBE_PRODUCTION=unexpected\n", { mode: 0o600 });
  // Never import the real seed module: this child only observes synthetic
  // values and prints booleans. It has no client, requests or database work.
  writeFileSync(path.join(directory, "scripts/seed.ts"), `
    const result: Record<string, boolean> = {
      localUrl: process.env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:54321",
      localKey: process.env["SUPABASE_SERVICE_ROLE_KEY"] === "EXAMPLE_ONLY_LOCAL_SEED_KEY",
      exportedUrl: process.env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:65432",
      exportedKey: process.env["SUPABASE_SERVICE_ROLE_KEY"] === "EXAMPLE_ONLY_EXPORTED_SEED_KEY",
      ambient: process.env.SEED_PROBE_AMBIENT !== undefined,
      production: process.env.SEED_PROBE_PRODUCTION !== undefined,
    };
    process.stdout.write(JSON.stringify(result));
  `);
});

afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

function probe(args: string[], environment: Record<string, string> = {}) {
  return spawnSync(process.execPath, [tsxCli, ...args], {
    cwd: directory,
    // Do not pass the test runner's ambient project settings or Node hooks.
    env: { PATH: path.dirname(process.execPath), TMPDIR: directory, TSX_DISABLE_CACHE: "1", ...environment },
    encoding: "utf8", timeout: 5_000, maxBuffer: 8_192,
  });
}

function result(child: ReturnType<typeof probe>) {
  expect(child.error).toBeUndefined();
  expect(child.signal).toBeNull();
  expect(child.status).toBe(0);
  expect(child.stderr).toBe("");
  expect(child.stdout).not.toContain("EXAMPLE_ONLY_LOCAL_SEED_KEY");
  expect(child.stdout).not.toContain("EXAMPLE_ONLY_EXPORTED_SEED_KEY");
  return JSON.parse(child.stdout) as Record<string, boolean>;
}

describe("the documented local seed environment boundary", () => {
  it("loads the selected file through the installed tsx CLI without ambient env files or value logging", () => {
    expect(localCommand).toBe("corepack pnpm exec tsx --env-file=.env.local scripts/seed.ts");
    expect(result(probe(localCommand!.split(" ").slice(4)))).toEqual({
      localUrl: true, localKey: true, exportedUrl: false, exportedKey: false, ambient: false, production: false,
    });
  });

  it("preserves exported project settings over the selected local file", () => {
    expect(result(probe(["--env-file=.env.local", "scripts/seed.ts"], exported))).toEqual({
      localUrl: false, localKey: false, exportedUrl: true, exportedKey: true, ambient: false, production: false,
    });
  });

  it("keeps the ordinary hosted and CI command independent of files in its working directory", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: { seed: string } };
    expect(manifest.scripts.seed).toBe("tsx scripts/seed.ts");
    const args = manifest.scripts.seed.split(" ").slice(1);
    expect(result(probe(args))).toEqual({
      localUrl: false, localKey: false, exportedUrl: false, exportedKey: false, ambient: false, production: false,
    });
    expect(result(probe(args, exported))).toEqual({
      localUrl: false, localKey: false, exportedUrl: true, exportedKey: true, ambient: false, production: false,
    });
  });

  it("refuses a missing explicit env file before running the probe", () => {
    rmSync(path.join(directory, ".env.local"));
    const child = probe(["--env-file=.env.local", "scripts/seed.ts"]);
    expect(child.error).toBeUndefined();
    expect(child.signal).toBeNull();
    expect(child.status).not.toBe(0);
    expect(child.stdout).toBe("");
    expect(child.stderr).toContain(".env.local");
    expect(child.stderr).not.toContain("EXAMPLE_ONLY_EXPORTED_SEED_KEY");
    expect(child.stderr).not.toContain("EXAMPLE_ONLY_LOCAL_SEED_KEY");
  });
});
