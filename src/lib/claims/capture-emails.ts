import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import ts from "typescript";
import { mailSubject, renderMail } from "../email";
import { auditClaimCorpus, type CorpusAudit, type CorpusInput, type ObservedSurface, type RequiredSurface } from "./corpus";
import { emailFixtures } from "./email-fixtures";
import { assertEmailFixtureCoverage, readEmailInventory, readPublicDigestCatalog } from "./email-inventory";

export const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export interface EmailCaptureOptions {
  /** Must not exist; its existing real parent must be outside the checkout. */
  outputDirectory: string;
  registry: CorpusInput["registry"];
  resolveSeed: CorpusInput["resolveSeed"];
  resolveComputed: CorpusInput["resolveComputed"];
}

/** Only passive, bounded CLI output; never linked-project or environment data. */
function assertPassiveLocalCliMarkers(root: string): void {
  for (const [name, content] of [
    ["supabase/.temp/cli-latest", /^v\d{1,3}\.\d{1,3}\.\d{1,3}$/u],
    ["supabase/.branches/_current_branch", /^main$/u],
  ] as const) {
    const file = join(root, name);
    let named: ReturnType<typeof lstatSync>;
    try { named = lstatSync(file); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const parent = dirname(file), owner = process.getuid?.();
    const directory = lstatSync(parent);
    if (realpathSync(parent) !== parent || !directory.isDirectory() || directory.isSymbolicLink()
      || directory.uid !== owner || !named.isFile() || named.isSymbolicLink() || named.uid !== owner
      || named.nlink !== 1 || named.size < 1 || named.size > 32 || (named.mode & 0o022) !== 0) {
      throw new Error("email-capture:unsafe-cli-marker");
    }
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = fstatSync(fd);
      if (opened.dev !== named.dev || opened.ino !== named.ino || opened.size !== named.size
        || opened.uid !== owner || opened.nlink !== 1 || opened.mode !== named.mode) throw new Error("email-capture:unsafe-cli-marker");
      const buffer = Buffer.alloc(33);
      let length = 0;
      while (length < buffer.length) {
        const count = readSync(fd, buffer, length, buffer.length - length, length);
        if (count === 0) break;
        length += count;
      }
      const raw = buffer.subarray(0, length), after = fstatSync(fd), current = lstatSync(file);
      if (raw.length !== named.size || !content.test(raw.toString("utf8"))
        || [after, current].some(value => value.dev !== named.dev || value.ino !== named.ino
          || value.size !== named.size || value.uid !== owner || value.nlink !== 1 || value.mode !== named.mode
          || value.mtimeMs !== named.mtimeMs || value.ctimeMs !== named.ctimeMs)) throw new Error("email-capture:unsafe-cli-marker");
    } finally { closeSync(fd); }
  }
}

// CLI 2.116's public writeDockerEnvFile writes this exact Edge Runtime output.
// It is not a renderer input. Inspect metadata only: never open/read/hash its
// secret-bearing contents or admit sibling files or multiline-env artifacts.
const localEdgeRuntimeOutput = "supabase/.temp/start-secrets/supabase_edge_runtime_sequence/env/docker.env";
function assertLocalEdgeRuntimeOutput(root: string): void {
  const file = join(root, localEdgeRuntimeOutput), owner = process.getuid?.();
  let named: ReturnType<typeof lstatSync>;
  try { named = lstatSync(file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!named.isFile() || named.isSymbolicLink() || named.uid !== owner || named.nlink !== 1
    || (named.mode & 0o777) !== 0o600 || named.size < 1 || named.size > 65_536) {
    throw new Error("email-capture:unsafe-local-runtime-output");
  }
  let directory = dirname(file);
  while (directory !== root) {
    const stat = lstatSync(directory);
    if (realpathSync(directory) !== directory || !stat.isDirectory() || stat.isSymbolicLink()
      || stat.uid !== owner || (stat.mode & 0o022) !== 0) {
      throw new Error("email-capture:unsafe-local-runtime-output");
    }
    directory = dirname(directory);
  }
  const publicText = (name: string): string => {
    const fd = openSync(join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { return readFileSync(fd, "utf8"); } finally { closeSync(fd); }
  };
  const config = publicText("supabase/config.toml");
  const lock = publicText("pnpm-lock.yaml");
  if ((config.match(/^project_id\s*=\s*"sequence"\s*$/gmu)?.length ?? 0) !== 1
    || !/^      supabase:\n        specifier: \^2\.116\.0\n        version: 2\.116\.0\n/mu.test(lock)) {
    throw new Error("email-capture:unsafe-local-runtime-output");
  }
}

/** No growing list of source paths: every tracked or untracked input is bound. */
export function assertEmailCaptureCheckout(projectRoot: string, contentCommitSha: string, outputDirectory: string): void {
  const root = realpathSync(projectRoot);
  const outputParent = realpathSync(dirname(resolve(outputDirectory)));
  const parentRelation = relative(root, outputParent);
  if (!parentRelation || (!isAbsolute(parentRelation) && parentRelation !== ".." && !parentRelation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))) {
    throw new Error("email-capture:output-inside-checkout");
  }
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  // Includes unstaged changes, the index, deletions and all nonignored new files.
  if (git(["status", "--porcelain", "--untracked-files=all"]).trim()) throw new Error("email-capture:uncommitted-renderer-inputs");
  assertPassiveLocalCliMarkers(root);
  assertLocalEdgeRuntimeOutput(root);
  // Ignore only known installation/build/test outputs, never arbitrary ignored
  // source or config files. In particular, ignored .env files are not attested.
  const generated = ["node_modules/**", "worker/node_modules/**", ".next/**", "out/**", "build/**", "coverage/**", "test-results/**", "playwright-report/**", "next-env.d.ts", "tsconfig.tsbuildinfo",
    // The closed requester archive configuration generates these before unit
    // capture in CI. Other ignored files under workers remain unbound inputs.
    "workers/requester-statement-archive/worker-configuration.d.ts",
    "workers/requester-statement-archive/.wrangler/cache/cf.json",
    // The mandatory early local startup writes only these passive CLI
    // markers. Linked-project/config/env inputs remain refused below.
    "supabase/.temp/cli-latest",
    "supabase/.branches/_current_branch",
    localEdgeRuntimeOutput,
  ];
  const ignored = git(["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", ".", ...generated.map((path) => `:(top,exclude)${path}`)]);
  if (ignored) {
    const paths = ignored.split("\0").filter(Boolean);
    // Bounded escaped filenames only, never ignored-file contents. Refusal
    // remains strict even when this diagnostic cannot show every path.
    const diagnostic = { count: paths.length, paths: paths.slice(0, 16).map(name => name.length <= 256 ? name : "[path too long]"),
      truncated: paths.length > 16 || paths.some(name => name.length > 256) };
    throw new Error(`email-capture:untracked-ignored-inputs:${JSON.stringify(diagnostic)}`);
  }
  if (git(["rev-parse", "HEAD"]).trim() !== contentCommitSha) throw new Error("email-capture:content-commit-changed");
}
export interface EmailCaptureReceipt {
  fixtureId: string;
  entrypoint: string;
  exportName: string;
  input: { path: string; sha256: string };
  html: { path: string; sha256: string };
  subject: { path: string; sha256: string };
  observations: { path: string; sha256: string };
}
export interface EmailCaptureResult {
  contract: "email-renderer-capture-v1";
  contentCommitSha: string;
  collector: { path: string; sha256: string };
  requiredSurfaces: RequiredSurface[];
  observations: ObservedSurface[];
  receipts: EmailCaptureReceipt[];
  audit: CorpusAudit;
}

/**
 * Actual production template capture, never a sender. Renders the code-owned,
 * synthetic fixtures through renderMail/mailSubject; no recipients or keys exist.
 * HTML bytes are retained before loading exactly those bytes in network-disabled
 * Chromium. The subject is separately retained and rendered as plain text, never
 * inserted as HTML. Every artifact is written exclusively, with a byte digest.
 *
 * The audit is intentionally the full four-channel boundary: email-only captures
 * cannot pass it. Missing regions/claims stay failures. This does not establish
 * canonical source support or automatically annotate production templates.
 */
export async function captureEmailClaims(options: EmailCaptureOptions): Promise<EmailCaptureResult> {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const contentCommitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(contentCommitSha)) throw new Error("email-capture:invalid-content-commit");
  const assertSourcesUnchanged = () => assertEmailCaptureCheckout(projectRoot, contentCommitSha, options.outputDirectory);
  assertSourcesUnchanged();
  // Compile the actual source function, not its host-runner serialization: tsx
  // may add external keepNames helpers that do not exist in the browser realm.
  const collectorSource = await readFile(join(projectRoot, "src/lib/claims/collect-dom.ts"), "utf8");
  const collectorTree = ts.createSourceFile("collect-dom.ts", collectorSource, ts.ScriptTarget.Latest, true);
  const declarations = collectorTree.statements.filter(ts.isFunctionDeclaration).filter((f) => f.name?.text === "collectDomSurface");
  if (declarations.length !== 1) throw new Error("email-capture:invalid-collector-export");
  const collectorExpression = ts.transpileModule(`(${declarations[0].getText(collectorTree).replace(/^export\s+/, "")})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText.trim().replace(/;$/, "");
  const fixtures = emailFixtures(readPublicDigestCatalog(projectRoot));
  assertEmailFixtureCoverage(readEmailInventory(projectRoot), fixtures);
  // Required surfaces come from fixtures BEFORE any rendering succeeds.
  const requiredSurfaces: RequiredSurface[] = fixtures.flatMap((f) => [f.required, {
    surface: `${f.required.surface}#envelope=subject`, channel: "email", requiresClaimWrapping: false, requiredClaimRegions: [],
  }]);
  await mkdir(options.outputDirectory, { recursive: false });
  const observations: ObservedSurface[] = [], receipts: EmailCaptureReceipt[] = [];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block" });
  let requestAttempted = false;
  await context.route("**/*", async (route) => { requestAttempted = true; await route.abort(); });
  const artifact = async (path: string, content: string) => {
    await writeFile(join(options.outputDirectory, path), content, { encoding: "utf8", flag: "wx" });
    const retained = await readFile(join(options.outputDirectory, path));
    if (!retained.equals(Buffer.from(content, "utf8"))) throw new Error("email-capture:artifact-byte-mismatch");
    return { path, sha256: sha256(retained) };
  };
  try {
    const collector = await artifact("collector.js", collectorExpression);
    for (const fixture of fixtures) {
      const input = await artifact(`${fixture.id}.input.json`, JSON.stringify({ source: "synthetic-fixture-with-public-catalog", fixture }, null, 2));
      const html = await artifact(`${fixture.id}.html`, await renderMail(fixture.mail));
      const subject = await artifact(`${fixture.id}.subject.txt`, mailSubject(fixture.mail));
      const page = await context.newPage();
      let bodyObservation: ObservedSurface, subjectObservation: ObservedSurface;
      try {
        const retainedHtml = await readFile(join(options.outputDirectory, html.path));
        if (sha256(retainedHtml) !== html.sha256) throw new Error("email-capture:artifact-byte-mismatch");
        await page.setContent(retainedHtml.toString("utf8"), { waitUntil: "load" });
        bodyObservation = await page.evaluate<ObservedSurface>(`${collectorExpression}(${JSON.stringify({ surface: fixture.required.surface, channel: "email", contentCommitSha, payloadSha256: html.sha256 })})`);
        await page.setContent("<!doctype html><html><body></body></html>");
        const retainedSubject = await readFile(join(options.outputDirectory, subject.path));
        if (sha256(retainedSubject) !== subject.sha256) throw new Error("email-capture:artifact-byte-mismatch");
        await page.evaluate((value) => { document.body.textContent = value; }, retainedSubject.toString("utf8"));
        subjectObservation = await page.evaluate<ObservedSurface>(`${collectorExpression}(${JSON.stringify({ surface: `${fixture.required.surface}#envelope=subject`, channel: "email", contentCommitSha, payloadSha256: subject.sha256 })})`);
        if (requestAttempted) throw new Error("email-capture:unexpected-network-request");
      } finally { await page.close(); }
      const pair = [bodyObservation, subjectObservation];
      const observationArtifact = await artifact(`${fixture.id}.observations.json`, JSON.stringify(pair, null, 2));
      observations.push(...pair);
      receipts.push({ fixtureId: fixture.id, entrypoint: fixture.entrypoint, exportName: fixture.exportName, input, html, subject, observations: observationArtifact });
    }
    const audit = auditClaimCorpus({ contentCommitSha, requiredSurfaces, observations,
      registry: options.registry, resolveSeed: options.resolveSeed, resolveComputed: options.resolveComputed });
    assertSourcesUnchanged();
    const result: EmailCaptureResult = { contract: "email-renderer-capture-v1", contentCommitSha, collector, requiredSurfaces, observations, receipts, audit };
    await artifact("capture.json", JSON.stringify(result, null, 2));
    return result;
  } finally { await context.close(); await browser.close(); }
}
