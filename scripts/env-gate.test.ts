import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { DYNAMIC_ENV_READS, RUNTIME_INJECTED, moduleEnvReads, runEnvGate, templateKeys } from "./env-gate";

/**
 * The gate is only worth having if a planted defect fails it, so every check
 * is tested against a repository that is real except for the one thing the
 * test breaks. `src` is mirrored file by file as symlinks back to the real
 * modules, so the floor guards see the tree's true size and the scanner reads
 * the real reads, and only the module or the template line under test is
 * written out.
 *
 * Both ledgers are compared in both directions and both directions are
 * planted: an unrecorded finding fails, and a recorded entry whose reason has
 * gone fails too — a runtime-injected variable the code stopped reading, a
 * runtime-injected variable the template started declaring, and a dynamic read
 * site that is no longer dynamic.
 */
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATE = "scripts/env-gate.ts";
const temporaryRoots: string[] = [];

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

interface Overrides {
  /** Repository-relative path -> content, for modules rewritten or added. */
  modules?: Record<string, string>;
  /** Receives the real `.env.example` text and returns the planted one. */
  template?: (source: string) => string;
}

/**
 * A repository whose `src` is the real one, module for module, except where a
 * test says otherwise. Directories are made for real and files are symlinked:
 * the gate's walker reads directory entries, and a symlink to a directory is
 * not one, so a whole-directory symlink would hide the tree it points at.
 */
function plant(overrides: Overrides): string {
  const root = mkdtempSync(path.join(tmpdir(), "env-gate-"));
  temporaryRoots.push(root);
  const modules = overrides.modules ?? {};

  const walk = (relativeDirectory: string) => {
    mkdirSync(path.join(root, relativeDirectory), { recursive: true });
    for (const entry of readdirSync(path.join(REPOSITORY_ROOT, relativeDirectory), {
      withFileTypes: true,
    })) {
      const relative = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(relative);
        continue;
      }
      if (relative in modules) continue;
      symlinkSync(path.join(REPOSITORY_ROOT, relative), path.join(root, relative));
    }
  };
  walk("src");

  for (const [relative, content] of Object.entries(modules)) {
    mkdirSync(path.join(root, path.posix.dirname(relative)), { recursive: true });
    writeFileSync(path.join(root, relative), content);
  }

  const template = readFileSync(path.join(REPOSITORY_ROOT, ".env.example"), "utf8");
  writeFileSync(path.join(root, ".env.example"), overrides.template?.(template) ?? template);
  return root;
}

/** The real `src/lib/limits.ts`, for the tests that rewrite only part of it. */
const realLimits = () => readFileSync(path.join(REPOSITORY_ROOT, "src/lib/limits.ts"), "utf8");

const withoutTemplateLine = (key: string) => (source: string) =>
  source
    .split("\n")
    .filter((line) => !new RegExp(`^[ \\t]*(?:#[ \\t]*)?${key}[ \\t]*=`).test(line))
    .join("\n");

describe("the env gate holds .env.example to what the code reads", () => {
  it("passes on this repository, having actually read every module and every shape", () => {
    const result = runEnvGate(REPOSITORY_ROOT);
    expect(result.failures).toEqual([]);
    expect(result.scannedFileCount).toBeGreaterThan(700);
    expect(result.readingFileCount).toBeGreaterThan(30);
    // The measurement this gate replaces counted 20 variables by grepping
    // `process.env.X`. That is exactly the direct half; the rest are only
    // visible through a binding or a recorded dynamic site.
    expect(result.directReadKeyCount).toBe(20);
    expect(result.boundReadKeyCount).toBe(15);
    expect(result.boundBindingCount).toBe(5);
    expect(result.dynamicReadSiteCount).toBe(1);
    expect(result.readKeyCount).toBe(34);
    expect(result.templateKeyCount).toBe(27);
    expect(result.runtimeInjectedKeyCount).toBe(7);
  });

  it("fails when a module reads a variable the template does not declare", () => {
    const root = plant({
      modules: { "src/planted-direct.ts": "export const value = process.env.INHERIT_PLANTED_DIRECT;\n" },
    });
    expect(runEnvGate(root).failures).toContain(
      `undocumented environment variable: not recorded in RUNTIME_INJECTED in ${GATE}: INHERIT_PLANTED_DIRECT`,
    );
  });

  it("fails when the undeclared read is written as a computed literal", () => {
    const root = plant({
      modules: { "src/planted-literal.ts": `export const value = process.env["INHERIT_PLANTED_LITERAL"];\n` },
    });
    expect(runEnvGate(root).failures).toContain(
      `undocumented environment variable: not recorded in RUNTIME_INJECTED in ${GATE}: INHERIT_PLANTED_LITERAL`,
    );
  });

  it("fails when the undeclared read is through a parameter defaulting to process.env", () => {
    const root = plant({
      modules: {
        "src/planted-bound.ts":
          "type Environment = Readonly<Record<string, string | undefined>>;\n" +
          "export function planted(env: Environment = process.env) {\n" +
          "  return env.INHERIT_PLANTED_BOUND;\n" +
          "}\n",
      },
    });
    // This is the shape the hand measurement missed entirely, and the shape
    // ten of this repository's thirty-four variables are read in.
    expect(runEnvGate(root).failures).toContain(
      `undocumented environment variable: not recorded in RUNTIME_INJECTED in ${GATE}: INHERIT_PLANTED_BOUND`,
    );
  });

  it("resolves a same-file constant rather than calling the read dynamic", () => {
    const root = plant({
      modules: {
        "src/planted-constant.ts":
          `const PLANTED_KEY = "INHERIT_PLANTED_CONSTANT";\n` +
          "export const value = process.env[PLANTED_KEY];\n",
      },
    });
    const { failures } = runEnvGate(root);
    expect(failures).toContain(
      `undocumented environment variable: not recorded in RUNTIME_INJECTED in ${GATE}: INHERIT_PLANTED_CONSTANT`,
    );
    expect(failures.join("\n")).not.toContain("src/planted-constant.ts process.env[PLANTED_KEY]");
  });

  it("fails when a read the scanner cannot resolve is not recorded", () => {
    const root = plant({
      modules: {
        "src/planted-dynamic.ts":
          "export function planted(name: string) {\n  return process.env[name];\n}\n",
      },
    });
    // An unreadable read site is a variable the gate cannot see, so it is a
    // failure rather than an absence.
    expect(runEnvGate(root).failures).toContain(
      `dynamic environment read: not recorded in DYNAMIC_ENV_READS in ${GATE}: ` +
        "src/planted-dynamic.ts process.env[name]",
    );
  });

  it("fails when a recorded dynamic read site is no longer dynamic", () => {
    const root = plant({
      modules: {
        "src/lib/limits.ts":
          `/** Keys: "NEXT_PUBLIC_MAX_ARRAY_BYTES", "NEXT_PUBLIC_MAX_VCF_BYTES", "NEXT_PUBLIC_MAX_BAM_BYTES". */\n` +
          "export const LIMITS = {\n" +
          "  arrayMaxBytes: Number(process.env.NEXT_PUBLIC_MAX_ARRAY_BYTES ?? 0),\n" +
          "  vcfMaxBytes: Number(process.env.NEXT_PUBLIC_MAX_VCF_BYTES ?? 0),\n" +
          "  bamMaxBytes: Number(process.env.NEXT_PUBLIC_MAX_BAM_BYTES ?? 0),\n" +
          "} as const;\n" +
          "export function formatBytes(n: number): string {\n  return `${n} B`;\n}\n",
      },
    });
    const { failures } = runEnvGate(root);
    expect(failures).toContain(
      `dynamic environment read: recorded in DYNAMIC_ENV_READS in ${GATE} but no longer present: ` +
        "src/lib/limits.ts process.env[name]",
    );
    // The three keys are still read, so the ledger entry going stale is the
    // only complaint: the gate is not simply reporting the file changed.
    expect(failures.join("\n")).not.toContain("stale environment variable");
    expect(failures).toHaveLength(1);
  });

  it("fails when a recorded dynamic site no longer names one of the keys it promises", () => {
    const root = plant({
      modules: {
        "src/lib/limits.ts": realLimits().replace(
          /\n\s*\/\*\* Tier 2[^\n]*\n\s*bamMaxBytes:[^\n]*\n/,
          "\n",
        ),
      },
    });
    const { failures } = runEnvGate(root);
    expect(failures).toContain(
      `dynamic environment read: ${GATE} records NEXT_PUBLIC_MAX_BAM_BYTES for ` +
        `src/lib/limits.ts process.env[name], but no "NEXT_PUBLIC_MAX_BAM_BYTES" literal appears ` +
        "in src/lib/limits.ts",
    );
    // And the promise being broken takes the key out of the read set, so the
    // template line for it is now a false instruction.
    expect(failures).toContain(
      ".env.example declares NEXT_PUBLIC_MAX_BAM_BYTES but nothing under src/ reads it".replace(
        /^/,
        "stale environment variable: ",
      ),
    );
  });

  it("fails when a documented variable is dropped from the template", () => {
    // D-098: NEXT_PUBLIC_APP_URL builds every link inside outbound mail and
    // falls back to the hosted deployment, so losing its line again would send
    // a self-hoster's rights tokens to a site they do not run.
    const root = plant({ template: withoutTemplateLine("NEXT_PUBLIC_APP_URL") });
    expect(runEnvGate(root).failures).toContain(
      `undocumented environment variable: not recorded in RUNTIME_INJECTED in ${GATE}: NEXT_PUBLIC_APP_URL`,
    );
  });

  it("fails when the template starts declaring a variable recorded as runtime-injected", () => {
    const root = plant({ template: (source) => `${source}\nNODE_ENV=production\n` });
    expect(runEnvGate(root).failures).toContain(
      `undocumented environment variable: recorded in RUNTIME_INJECTED in ${GATE} but no longer ` +
        "present: NODE_ENV",
    );
  });

  it("fails when nothing reads a variable recorded as runtime-injected any more", () => {
    const root = plant({
      modules: {
        "src/lib/uploads/normalization-database.ts": readFileSync(
          path.join(REPOSITORY_ROOT, "src/lib/uploads/normalization-database.ts"),
          "utf8",
        ).replace("const localProject = env.INHERIT_LOCAL_E2E_PROJECT;", `const localProject = "sequence";`),
      },
    });
    // The exemption exists because the test harness sets this variable. Take
    // the read away and the reason is gone, so the entry has to go with it.
    expect(runEnvGate(root).failures).toContain(
      `undocumented environment variable: recorded in RUNTIME_INJECTED in ${GATE} but no longer ` +
        "present: INHERIT_LOCAL_E2E_PROJECT",
    );
  });

  it("fails when the template declares a variable nothing reads", () => {
    const root = plant({ template: (source) => `${source}\nINHERIT_PLANTED_STALE=\n` });
    expect(runEnvGate(root).failures).toContain(
      "stale environment variable: .env.example declares INHERIT_PLANTED_STALE but nothing under src/ reads it",
    );
  });

  it("fails loudly rather than passing when the walker finds nothing", () => {
    const root = mkdtempSync(path.join(tmpdir(), "env-gate-empty-"));
    temporaryRoots.push(root);
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, ".env.example"), "# nothing here\n");
    const { failures } = runEnvGate(root);
    // An empty scan reports nothing wrong with the product, which is exactly
    // the failure mode the floor guards exist to catch.
    const text = failures.join("\n");
    expect(text).toContain("source walker found 0 modules, expected over 400");
    expect(text).toContain("source walker found 0 modules reading the environment, expected over 20");
    expect(text).toContain("source walker found 0 directly read variables, expected over 15");
    expect(text).toContain("source walker found 0 variables read through a process.env binding, expected over 10");
    expect(text).toContain("source walker found 0 process.env bindings, expected over 4");
    expect(text).toContain("source walker found 0 environment variables, expected over 30");
    expect(text).toContain(".env.example declares 0 variables, expected over 20");
    expect(failures.length).toBeGreaterThanOrEqual(7);
  });
});

describe("the two ledgers are exceptions, not silence", () => {
  it("gives every runtime-injected variable a name and a stated reason, once", () => {
    const keys = RUNTIME_INJECTED.map((entry) => entry.key);
    expect(keys).toEqual([...new Set(keys)]);
    for (const entry of RUNTIME_INJECTED) {
      expect(entry.key).toMatch(/^[A-Z][A-Z0-9_]*$/);
      // The gate itself fails an entry under 40 characters of reason; this
      // holds the committed ledger well clear of that line.
      expect(entry.reason.trim().length).toBeGreaterThan(80);
      expect(entry.reason.trim()).toMatch(/\.$/);
    }
  });

  it("gives every dynamic read site a module, an expression, keys and a reason", () => {
    const sites = DYNAMIC_ENV_READS.map((site) => `${site.file} ${site.expression}`);
    expect(sites).toEqual([...new Set(sites)]);
    for (const site of DYNAMIC_ENV_READS) {
      expect(site.file.startsWith("src/")).toBe(true);
      expect(site.expression).toMatch(/\[.+\]$/);
      expect(site.keys.length).toBeGreaterThan(0);
      for (const key of site.keys) expect(key).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(site.reason.trim().length).toBeGreaterThan(80);
    }
  });
});

describe("the detectors the gate is built from", () => {
  it("reads a declaration whether or not it is commented out, and prose never", () => {
    expect(templateKeys("RESEND_API_KEY=re_YOUR_KEY\n")).toEqual(["RESEND_API_KEY"]);
    // The opt-in that the hand measurement missed by skipping comment lines.
    expect(templateKeys("# ALLOW_PRIVATE_LLM_ENDPOINTS=true\n")).toEqual(["ALLOW_PRIVATE_LLM_ENDPOINTS"]);
    expect(templateKeys("  #JOBS_SECRET=GENERATE-ME\n")).toEqual(["JOBS_SECRET"]);
    // Prose that names a variable is not a declaration of it.
    expect(templateKeys("# Separate from INHERIT_PAUSE_LEGACY_UPLOADS.\n")).toEqual([]);
    expect(templateKeys("# * No analytics keys: EMAIL_FROM is set below.\n")).toEqual([]);
    expect(templateKeys('EMAIL_FROM="Inherit <onboarding@resend.dev>"\n')).toEqual(["EMAIL_FROM"]);
  });

  it("reads every shape a module reads the environment in", () => {
    expect(moduleEnvReads("process.env.NEXT_PUBLIC_SITE_URL").direct).toEqual(["NEXT_PUBLIC_SITE_URL"]);
    expect(moduleEnvReads(`process.env["CRON_SECRET"]`).direct).toEqual(["CRON_SECRET"]);
    expect(moduleEnvReads("process.env['CRON_SECRET']").direct).toEqual(["CRON_SECRET"]);
    const bound = moduleEnvReads("function f(env: Environment = process.env) { return env.VERCEL_URL; }");
    expect(bound.bindings).toEqual(["env"]);
    expect(bound.bound).toEqual(["VERCEL_URL"]);
    expect(bound.direct).toEqual([]);
    const assigned = moduleEnvReads("const environment = process.env;\nconst v = environment.JOBS_SECRET;");
    expect(assigned.bound).toEqual(["JOBS_SECRET"]);
  });

  it("does not mistake process.env.X for a read through a binding named env", () => {
    const reads = moduleEnvReads(
      "function f(env: Environment = process.env) { return process.env.NODE_ENV + env.CI; }",
    );
    expect(reads.direct).toEqual(["NODE_ENV"]);
    expect(reads.bound).toEqual(["CI"]);
  });

  it("takes only shouting-case properties off a binding, so a method call is not a variable", () => {
    const reads = moduleEnvReads(
      "const env = process.env;\nconst a = env.toString();\nconst b = env.someSetting;\nconst c = env.REAL_KEY;",
    );
    expect(reads.bound).toEqual(["REAL_KEY"]);
  });

  it("reports a computed read it cannot resolve instead of returning nothing", () => {
    const reads = moduleEnvReads("function f(name: string) { return process.env[name]; }");
    expect(reads.direct).toEqual([]);
    expect(reads.dynamic).toEqual(["process.env[name]"]);
    const resolved = moduleEnvReads(`const K = "SOME_KEY";\nconst v = process.env[K];`);
    expect(resolved.direct).toEqual(["SOME_KEY"]);
    expect(resolved.dynamic).toEqual([]);
    // A constant that does not name a variable is still unresolved.
    const notAKey = moduleEnvReads(`const K = "lower case";\nconst v = process.env[K];`);
    expect(notAKey.direct).toEqual([]);
    expect(notAKey.dynamic).toEqual(["process.env[K]"]);
  });

  it("finds no environment reads in a module that has none", () => {
    const reads = moduleEnvReads("export const two = 1 + 1;\n");
    expect(reads).toEqual({ direct: [], bound: [], bindings: [], dynamic: [] });
  });
});
