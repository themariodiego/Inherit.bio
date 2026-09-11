import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { DYNAMIC_ENV_READS, GUIDE_FOREIGN_NAMES, GUIDE_OMITTED, RUNTIME_INJECTED, guideNames, moduleEnvReads,
  runEnvGate, templateKeys } from "./env-gate";

/**
 * The gate is only worth having if a planted defect fails it, so every check
 * is tested against a repository that is real except for the one thing the
 * test breaks. `src` is mirrored file by file as symlinks back to the real
 * modules, so the floor guards see the tree's true size and the scanner reads
 * the real reads, and only the module or the template line under test is
 * written out.
 *
 * The ledgers are compared in both directions and both directions are
 * planted: an unrecorded finding fails, and a recorded entry whose reason has
 * gone fails too — a runtime-injected variable the code stopped reading, a
 * runtime-injected variable the template started declaring, a dynamic read
 * site that is no longer dynamic, and a name the guide no longer writes.
 *
 * `docs/self-hosting.md` is planted the same way: it is copied for real and
 * only the line under test is changed, because a guide that has drifted from
 * the template is the defect this half of the gate exists to catch.
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
  /** Receives the real `docs/self-hosting.md` text and returns the planted one. */
  guide?: (source: string) => string;
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

  const guide = readFileSync(path.join(REPOSITORY_ROOT, "docs/self-hosting.md"), "utf8");
  mkdirSync(path.join(root, "docs"), { recursive: true });
  writeFileSync(path.join(root, "docs/self-hosting.md"), overrides.guide?.(guide) ?? guide);
  return root;
}

/** The real `src/lib/limits.ts`, for the tests that rewrite only part of it. */
const realLimits = () => readFileSync(path.join(REPOSITORY_ROOT, "src/lib/limits.ts"), "utf8");

/**
 * The drift this half of the gate is for: the guide still spells the name in
 * prose, so a reader-by-eye would swear it is documented, but it no longer
 * tells anyone to set anything.
 */
const unformattedInGuide = (name: string) => (source: string) =>
  source.split(`\`${name}\``).join(name);

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
    // Every key an operator is told to fill in is named in the guide they
    // follow, and the ten further names the guide writes as configuration are
    // the recorded ones: the two labels the Supabase CLI prints, the worker's
    // own project URL, and the seven nobody should ever set by hand.
    expect(result.guideDocumentedKeyCount).toBe(27);
    expect(result.guideNamedCount).toBe(37);
    expect(result.guideNamedCount).toBe(result.templateKeyCount + GUIDE_FOREIGN_NAMES.length);
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

  it("fails when a template key is not named in the self-hosting guide", () => {
    // The gap this half closes: eight variables were added to the template
    // while the guide never mentioned them. Without the upload signing key an
    // operator's uploads fail before a byte moves, and the guide is the only
    // document a self-hoster is told to follow.
    const root = plant({ guide: unformattedInGuide("INHERIT_UPLOAD_SIGNING_JWK") });
    expect(runEnvGate(root).failures).toContain(
      "undocumented in docs/self-hosting.md: not recorded in GUIDE_OMITTED in " +
        `${GATE}: INHERIT_UPLOAD_SIGNING_JWK`,
    );
  });

  it("fails when the guide stops telling an operator to set NEXT_PUBLIC_APP_URL", () => {
    // D-098 again, from the other side: the template line can survive while
    // the guide quietly stops mentioning the variable that decides where a
    // self-hoster's mail links, and the rights tokens in them, point.
    const root = plant({ guide: unformattedInGuide("NEXT_PUBLIC_APP_URL") });
    expect(runEnvGate(root).failures).toContain(
      "undocumented in docs/self-hosting.md: not recorded in GUIDE_OMITTED in " +
        `${GATE}: NEXT_PUBLIC_APP_URL`,
    );
  });

  it("fails when the guide tells an operator to set a variable the template does not declare", () => {
    const root = plant({
      guide: (source) => `${source}\nSet \`INHERIT_PLANTED_GUIDE_ONLY\` before starting.\n`,
    });
    // A variable only the guide knows about is undocumented in the file the
    // gate compares the code against, so it is invisible to every other check.
    expect(runEnvGate(root).failures).toContain(
      "undeclared name in docs/self-hosting.md: not recorded in GUIDE_FOREIGN_NAMES in " +
        `${GATE}: INHERIT_PLANTED_GUIDE_ONLY`,
    );
  });

  it("reads an assignment inside a fenced block as telling an operator to set it", () => {
    const root = plant({
      guide: (source) => `${source}\n\`\`\`bash\nINHERIT_PLANTED_FENCED=1 pnpm dev\n\`\`\`\n`,
    });
    expect(runEnvGate(root).failures).toContain(
      "undeclared name in docs/self-hosting.md: not recorded in GUIDE_FOREIGN_NAMES in " +
        `${GATE}: INHERIT_PLANTED_FENCED`,
    );
  });

  it("fails when a name recorded as foreign to the template has left the guide", () => {
    // The worker's own variable name is recorded because section 4 warns an
    // operator not to confuse the two. Take the warning away and the record of
    // it has to go too, or the ledger starts describing a guide that is gone.
    const root = plant({ guide: (source) => source.split("`SUPABASE_URL`").join("the project URL") });
    expect(runEnvGate(root).failures).toContain(
      "undeclared name in docs/self-hosting.md: recorded in GUIDE_FOREIGN_NAMES in " +
        `${GATE} but no longer present: SUPABASE_URL`,
    );
  });

  it("fails when the template starts declaring a name recorded as foreign to it", () => {
    const root = plant({ template: (source) => `${source}\nANON_KEY=printed-by-the-cli\n` });
    // The entry says the name is not one of this template's keys. The moment
    // the template declares it, the entry is a false statement about the file.
    expect(runEnvGate(root).failures).toContain(
      "undeclared name in docs/self-hosting.md: recorded in GUIDE_FOREIGN_NAMES in " +
        `${GATE} but no longer present: ANON_KEY`,
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
    // A guide that cannot be read is a guide that documents nothing, and the
    // comparison against it would otherwise be vacuously clean.
    expect(text).toContain("self-hosting guide: docs/self-hosting.md cannot be read");
    expect(text).toContain("docs/self-hosting.md is 0 characters, expected over 4000");
    expect(text).toContain("docs/self-hosting.md names 0 variables, expected over 20");
    expect(failures.length).toBeGreaterThanOrEqual(10);
  });
});

describe("the ledgers are exceptions, not silence", () => {
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

  it("gives every name the guide writes but the template does not declare a reason, once", () => {
    const names = GUIDE_FOREIGN_NAMES.map((entry) => entry.name);
    expect(names).toEqual([...new Set(names)]);
    for (const entry of GUIDE_FOREIGN_NAMES) {
      expect(entry.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(entry.reason.trim().length).toBeGreaterThan(80);
      expect(entry.reason.trim()).toMatch(/\.$/);
    }
  });

  it("records no guide omission, because the guide names every key in the template", () => {
    // The ledger is enforced in both directions all the same: an entry for a
    // key the guide does name fails as no longer present. It is empty because
    // nothing earned a place in it, not because omissions are tolerated.
    expect(GUIDE_OMITTED).toEqual([]);
    for (const entry of GUIDE_OMITTED) expect(entry.reason.trim().length).toBeGreaterThan(80);
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

  it("reads a guide's variable names from code, and prose never", () => {
    expect(guideNames("| `CRON_SECRET` | output of `openssl rand -hex 32` |")).toEqual(["CRON_SECRET"]);
    expect(guideNames("set `ALLOW_PRIVATE_LLM_ENDPOINTS=true` in `.env.local`")).toEqual([
      "ALLOW_PRIVATE_LLM_ENDPOINTS",
    ]);
    expect(guideNames("```bash\nNEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co \\\n```\n")).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
    // Prose that spells a name is not an instruction to set one.
    expect(guideNames("Set CRON_SECRET so Vercel Cron can call the jobs.")).toEqual([]);
    // A glob names nothing: this is exactly how the guide used to gesture at
    // three size caps it never actually named.
    expect(guideNames("Set `NEXT_PUBLIC_MAX_*_BYTES` accordingly.")).toEqual([]);
    // Placeholders and prose inside a code span are not variables either.
    expect(guideNames("`https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`")).toEqual([]);
    expect(guideNames("`pnpm e2e # Playwright: RLS proof, network audit`")).toEqual([]);
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
