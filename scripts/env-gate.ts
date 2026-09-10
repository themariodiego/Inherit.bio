import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * G7.2, environment half: `.env.example` is the only thing a self-hoster is
 * told to fill in, so every variable the running code reads has to be in it,
 * and nothing in it may be a variable the code stopped reading.
 *
 * Until this gate existed that comparison was done by hand, once, and it was
 * wrong twice over. The 2026-09-10 measurement in `docs/acceptance-matrix.md`
 * counted variables by grepping `process.env.X` under `src/`, which reads only
 * the shape the code happens to use most. It found 20 reads and concluded that
 * the two template keys with no direct read among them — which are
 * `DATABASE_URL` and `INHERIT_NORMALIZATION_DIRECT_DATABASE` — were read only
 * by `scripts/secret-gate.ts`. Both are in fact also read by
 * `src/lib/uploads/normalization-database.ts`, through a parameter that
 * defaults to `process.env`, and so are twelve further variables no hand count
 * ever saw. A grep that misses fourteen of the thirty-four reads cannot tell a
 * documented variable from an undocumented one, so this gate reads all four
 * shapes the repository actually uses:
 *
 *  1. `process.env.KEY` — the plain member read.
 *  2. `process.env["KEY"]` — the computed read with a literal key.
 *  3. `env.KEY`, where `env` is a binding whose initialiser is `process.env`.
 *     Five modules take `env: Environment = process.env` as a parameter so that
 *     unit tests can inject a synthetic environment; the reads inside them are
 *     as real as any other, and `NEXT_PUBLIC_MAX_*`, the Vercel markers, the
 *     local-model policy and the database CA all live only in this shape.
 *  4. `process.env[expression]` / `env[expression]`, where the expression is
 *     not a literal. A same-file `const NAME = "KEY"` is resolved, because
 *     `src/lib/legal/jurisdictions.ts` reads its flag that way and the value
 *     is right there. Anything still unresolved is a hole in the scanner, and
 *     a hole that reads as "no variables here" is the failure mode this whole
 *     gate exists to prevent — so each one must be recorded in
 *     `DYNAMIC_ENV_READS` below with the keys it can produce, and each of
 *     those keys must appear as a string literal in that same module.
 *
 * Two ledgers, both compared in both directions, so that removing the reason
 * for an entry forces the entry out with it:
 *
 *  - `RUNTIME_INJECTED` is the set of variables that are read under `src/` and
 *    must *not* appear in `.env.example`, each with the reason. An
 *    undocumented variable that is not listed fails; a listed variable that
 *    the code stopped reading fails; and a listed variable that someone adds
 *    to the template fails too, because the entry says it does not belong
 *    there and the template now says it does.
 *  - `DYNAMIC_ENV_READS` is the set of unresolvable read sites, as above.
 *
 * Test modules under `src/` are scanned like any other. A `*.test.ts` that
 * reaches for `process.env` is reading the same process environment the
 * product reads, and exempting them would leave the largest, least-reviewed
 * part of the tree unscanned.
 *
 * This gate is deliberately static. It reads files; it starts no server, needs
 * no database and never reads a real `.env`, so it belongs in the static half
 * of CI alongside the other gates and costs milliseconds.
 */

const SOURCE = "src";
const TEMPLATE = ".env.example";
const GATE = "scripts/env-gate.ts";

/**
 * Read under `src/`, deliberately absent from `.env.example`. Every entry
 * names who sets the variable instead of the operator; a variable an operator
 * would have to set themselves does not belong here, it belongs in the
 * template.
 */
export interface RuntimeInjectedVariable {
  key: string;
  reason: string;
}

export const RUNTIME_INJECTED: readonly RuntimeInjectedVariable[] = [
  {
    key: "CI",
    reason:
      "Set by the CI runner itself. src/lib/uploads/normalization-database.ts reads it only to " +
      "refuse the disposable local test project on CI; a deployment never sets it.",
  },
  {
    key: "NODE_ENV",
    reason:
      "Set by Node and by `next build` / `next start`. Writing it into a deployment template " +
      "invites an operator to override the value the framework depends on.",
  },
  {
    key: "VERCEL",
    reason:
      "Injected by the Vercel build and runtime as the hosted marker. src/ reads it to refuse " +
      "local-only behaviour on a hosted deployment, so an operator setting it by hand would be " +
      "asserting a platform it is not running on.",
  },
  {
    key: "VERCEL_ENV",
    reason:
      "Injected by Vercel as production/preview/development. next.config.ts and the copilot " +
      "local-transport policy both branch on it; the same hand-set hazard as VERCEL.",
  },
  {
    key: "VERCEL_URL",
    reason:
      "Injected by Vercel as the deployment host. src/lib/uploads/normalization-database.ts reads " +
      "it only as a third hosted marker; NEXT_PUBLIC_SITE_URL and NEXT_PUBLIC_APP_URL are the " +
      "operator-set URLs and both are in the template.",
  },
  {
    key: "INHERIT_TEST_JURISDICTION",
    reason:
      "Acceptance-fixture flag that enables the TEST-LOCAL pseudo-jurisdiction. next.config.ts " +
      "throws at startup when it is 1 in a production deployment, so the template must never " +
      "suggest setting it; playwright.config.ts and .github/workflows/ci.yml set it for tests.",
  },
  {
    key: "INHERIT_LOCAL_E2E_PROJECT",
    reason:
      "Selects which local Supabase test stack the browser suite targets (scripts/local-e2e-project.ts " +
      "registers exactly two, and refuses to run at all under VERCEL/VERCEL_ENV/VERCEL_URL). Test " +
      "infrastructure, not deployment configuration.",
  },
];

/**
 * A `process.env[...]` or `env[...]` read whose key this scanner cannot
 * resolve, with the keys it does produce. The keys are folded into the read
 * set, so an entry here is a promise, and the promise is checked: each key
 * must appear as a string literal in the same module.
 */
export interface DynamicEnvRead {
  file: string;
  expression: string;
  keys: string[];
  reason: string;
}

export const DYNAMIC_ENV_READS: readonly DynamicEnvRead[] = [
  {
    file: "src/lib/limits.ts",
    expression: "process.env[name]",
    keys: ["NEXT_PUBLIC_MAX_ARRAY_BYTES", "NEXT_PUBLIC_MAX_VCF_BYTES", "NEXT_PUBLIC_MAX_BAM_BYTES"],
    reason:
      "envInt(name, fallback) takes the variable name as a parameter, so the key is only known at " +
      "each of the three call sites in the same module.",
  },
];

const SOURCE_EXTENSIONS = /\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/;

/** A shell-style environment variable name. */
const ENVIRONMENT_KEY = /^[A-Z][A-Z0-9_]*$/;

export interface EnvGateResult {
  failures: string[];
  scannedFileCount: number;
  readingFileCount: number;
  readKeyCount: number;
  directReadKeyCount: number;
  boundReadKeyCount: number;
  boundBindingCount: number;
  dynamicReadSiteCount: number;
  templateKeyCount: number;
  runtimeInjectedKeyCount: number;
}

/**
 * The keys `.env.example` declares. A declaration is an assignment at the
 * start of a line, commented out or not: `ALLOW_PRIVATE_LLM_ENDPOINTS` ships
 * commented out precisely because it is an opt-in, and the hand measurement
 * this gate replaces got it wrong by skipping comment lines. Prose that merely
 * names a variable is not a declaration — the template's own paragraph about
 * `INHERIT_PAUSE_LEGACY_UPLOADS` names a variable nothing under `src/` reads.
 */
export function templateKeys(source: string): string[] {
  const keys = new Set<string>();
  for (const line of source.split(/\r?\n/)) {
    const match = /^[ \t]*(?:#[ \t]*)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=/.exec(line);
    if (match && ENVIRONMENT_KEY.test(match[1])) keys.add(match[1]);
  }
  return [...keys].sort();
}

export interface ModuleEnvReads {
  /** Keys read as `process.env.KEY` or `process.env["KEY"]`. */
  direct: string[];
  /** Keys read through a binding whose initialiser is `process.env`. */
  bound: string[];
  /** The names bound to `process.env` in this module, in source order. */
  bindings: string[];
  /** Unresolvable computed reads, as they are written. */
  dynamic: string[];
}

const LITERAL = String.raw`"([^"\n]*)"|'([^'\n]*)'|` + "`([^`\\n$]*)`";
const IDENTIFIER = String.raw`[A-Za-z_$][A-Za-z0-9_$]*`;
/** Not preceded by a `.`, so `process.env.X` is never mistaken for `env.X`. */
const STANDALONE = String.raw`(?:^|[^.\w$])`;

/** Same-file `const NAME = "VALUE"`, the only indirection worth resolving. */
function stringConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>();
  const pattern = new RegExp(
    `${STANDALONE}(?:const|let|var)\\s+(${IDENTIFIER})\\s*(?::[^=;\\n]*)?=\\s*(?:${LITERAL})`,
    "g",
  );
  for (const match of source.matchAll(pattern)) {
    const value = match[2] ?? match[3] ?? match[4];
    if (value !== undefined) constants.set(match[1], value);
  }
  return constants;
}

/**
 * Every environment key this module reads, and every read it could not
 * resolve. The bound-binding half is a within-module heuristic: a name whose
 * initialiser is `process.env` anywhere in the module is treated as the
 * environment everywhere in it, and only `SHOUTING_CASE` properties are taken,
 * so a method call on an unrelated same-named value is not read as a variable.
 * The heuristic over-reports rather than under-reports, and over-reporting
 * fails loudly here instead of passing silently.
 */
export function moduleEnvReads(source: string): ModuleEnvReads {
  const direct = new Set<string>();
  const bound = new Set<string>();
  const dynamic: string[] = [];
  const constants = stringConstants(source);

  const resolve = (holder: string, raw: string, into: Set<string>) => {
    const literal = new RegExp(`^\\s*(?:${LITERAL})\\s*$`).exec(raw);
    const value = literal ? (literal[1] ?? literal[2] ?? literal[3]) : constants.get(raw.trim());
    if (value !== undefined && ENVIRONMENT_KEY.test(value)) into.add(value);
    else dynamic.push(`${holder}[${raw.trim()}]`);
  };

  for (const match of source.matchAll(new RegExp(`process\\.env\\.(${IDENTIFIER})`, "g"))) {
    direct.add(match[1]);
  }
  for (const match of source.matchAll(/process\.env\[([^\]\n]*)\]/g)) {
    resolve("process.env", match[1], direct);
  }

  // A binding, not a read: `= process.env` followed by `.` or `[` is case 1
  // or case 2 above and is already counted.
  const bindings: string[] = [];
  const bindingPattern = new RegExp(
    `${STANDALONE}(?:(?:const|let|var)\\s+)?(${IDENTIFIER})\\s*(?::[^=;()\\n]*)?=\\s*process\\.env(?![\\w$.[])`,
    "g",
  );
  for (const match of source.matchAll(bindingPattern)) {
    if (!bindings.includes(match[1])) bindings.push(match[1]);
  }

  for (const binding of bindings) {
    const escaped = binding.replace(/[$]/g, "\\$&");
    for (const match of source.matchAll(
      new RegExp(`${STANDALONE}${escaped}\\.([A-Z][A-Z0-9_]*)\\b`, "g"),
    )) {
      bound.add(match[1]);
    }
    for (const match of source.matchAll(
      new RegExp(`${STANDALONE}${escaped}\\[([^\\]\\n]*)\\]`, "g"),
    )) {
      resolve(binding, match[1], bound);
    }
  }

  return { direct: [...direct].sort(), bound: [...bound].sort(), bindings, dynamic };
}

function sourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (SOURCE_EXTENSIONS.test(entry.name)) found.push(full);
    }
  };
  walk(root);
  return found.sort();
}

/** Both directions at once: what is present, against what is recorded. */
function compareLedger(
  label: string,
  ledger: string,
  present: string[],
  recorded: string[],
  failures: string[],
): void {
  for (const entry of [...present].sort()) {
    if (!recorded.includes(entry)) failures.push(`${label}: not recorded in ${ledger}: ${entry}`);
  }
  for (const entry of [...recorded].sort()) {
    if (!present.includes(entry)) {
      failures.push(`${label}: recorded in ${ledger} but no longer present: ${entry}`);
    }
  }
}

export function runEnvGate(repositoryRoot: string): EnvGateResult {
  const failures: string[] = [];
  const relative = (full: string) => path.relative(repositoryRoot, full).split(path.sep).join("/");

  const files = sourceFiles(path.join(repositoryRoot, SOURCE));
  /** key -> the modules that read it, so a failure says where to look. */
  const readers = new Map<string, string[]>();
  const direct = new Set<string>();
  const bound = new Set<string>();
  const dynamicSites: string[] = [];
  let readingFileCount = 0;
  let boundBindingCount = 0;

  for (const file of files) {
    const reads = moduleEnvReads(readFileSync(file, "utf8"));
    const keys = [...new Set([...reads.direct, ...reads.bound])];
    if (keys.length > 0 || reads.dynamic.length > 0) readingFileCount += 1;
    boundBindingCount += reads.bindings.length;
    for (const key of reads.direct) direct.add(key);
    for (const key of reads.bound) bound.add(key);
    for (const key of keys) readers.set(key, [...(readers.get(key) ?? []), relative(file)]);
    for (const site of reads.dynamic) dynamicSites.push(`${relative(file)} ${site}`);
  }

  // 1. Every unresolvable read site is recorded, and every recorded site is
  // still there. A site the scanner cannot read is a variable it cannot see.
  compareLedger(
    "dynamic environment read",
    `DYNAMIC_ENV_READS in ${GATE}`,
    dynamicSites,
    DYNAMIC_ENV_READS.map((site) => `${site.file} ${site.expression}`),
    failures,
  );

  // A recorded site's keys are only worth folding in if the module really
  // names them, so each is checked against the module's own string literals.
  for (const site of DYNAMIC_ENV_READS) {
    let source: string | null = null;
    try {
      source = readFileSync(path.join(repositoryRoot, site.file), "utf8");
    } catch {
      failures.push(`dynamic environment read: ${GATE} records ${site.file}, which does not exist`);
      // A ledger entry pointing at nothing must not manufacture reads out of
      // its own key list; that would let the ledger stand in for the code.
      continue;
    }
    for (const key of site.keys) {
      if (!new RegExp(`["'\`]${key}["'\`]`).test(source)) {
        failures.push(
          `dynamic environment read: ${GATE} records ${key} for ${site.file} ${site.expression}, ` +
            `but no "${key}" literal appears in ${site.file}`,
        );
        continue;
      }
      readers.set(key, [...(readers.get(key) ?? []), site.file]);
    }
  }

  const readKeys = [...readers.keys()].sort();
  const declared = templateKeys(readFileSync(path.join(repositoryRoot, TEMPLATE), "utf8"));

  // 2. Every variable the code reads is in the template, unless the runtime,
  // the platform or the test harness sets it and the ledger says so.
  const undocumented = readKeys.filter((key) => !declared.includes(key));
  compareLedger(
    "undocumented environment variable",
    `RUNTIME_INJECTED in ${GATE}`,
    undocumented,
    RUNTIME_INJECTED.map((entry) => entry.key),
    failures,
  );

  // Both halves of an entry have to be real: a key with no reason is not a
  // documented exception, it is a silent one.
  for (const entry of RUNTIME_INJECTED) {
    if (entry.reason.trim().length < 40) {
      failures.push(
        `undocumented environment variable: ${GATE} exempts ${entry.key} without a stated reason`,
      );
    }
  }

  // 3. Nothing in the template is a variable the code stopped reading. A key
  // an operator is told to set that reaches nothing is a false instruction.
  for (const key of declared) {
    if (!readers.has(key)) {
      failures.push(
        `stale environment variable: ${TEMPLATE} declares ${key} but nothing under ${SOURCE}/ reads it`,
      );
    }
  }

  // Floor guards. A walker that silently found nothing must not read as a
  // clean product, so each input is required to be roughly the size it is.
  if (files.length < 400) {
    failures.push(`source walker found ${files.length} modules, expected over 400`);
  }
  if (readingFileCount < 20) {
    failures.push(`source walker found ${readingFileCount} modules reading the environment, expected over 20`);
  }
  if (direct.size < 15) {
    failures.push(`source walker found ${direct.size} directly read variables, expected over 15`);
  }
  if (bound.size < 10) {
    failures.push(`source walker found ${bound.size} variables read through a process.env binding, expected over 10`);
  }
  if (boundBindingCount < 4) {
    failures.push(`source walker found ${boundBindingCount} process.env bindings, expected over 4`);
  }
  if (readKeys.length < 30) {
    failures.push(`source walker found ${readKeys.length} environment variables, expected over 30`);
  }
  if (declared.length < 20) {
    failures.push(`${TEMPLATE} declares ${declared.length} variables, expected over 20`);
  }

  return {
    failures,
    scannedFileCount: files.length,
    readingFileCount,
    readKeyCount: readKeys.length,
    directReadKeyCount: direct.size,
    boundReadKeyCount: bound.size,
    boundBindingCount,
    dynamicReadSiteCount: dynamicSites.length,
    templateKeyCount: declared.length,
    runtimeInjectedKeyCount: RUNTIME_INJECTED.length,
  };
}

function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(scriptDirectory, "..");
  const result = runEnvGate(repositoryRoot);
  if (result.failures.length > 0) {
    console.error(`ENV GATE FAILED (${result.failures.length}):`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `env gate passed: ${result.readKeyCount} environment variables read across ` +
      `${result.readingFileCount} of ${result.scannedFileCount} modules under ${SOURCE}/ ` +
      `(${result.directReadKeyCount} read directly, ${result.boundReadKeyCount} through ` +
      `${result.boundBindingCount} process.env bindings, ${result.dynamicReadSiteCount} recorded ` +
      `dynamic read site${result.dynamicReadSiteCount === 1 ? "" : "s"}), ` +
      `${result.templateKeyCount} declared in ${TEMPLATE}, ` +
      `${result.runtimeInjectedKeyCount} recorded as runtime-injected`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
