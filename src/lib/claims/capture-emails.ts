import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
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
  // Ignore only known installation/build/test outputs, never arbitrary ignored
  // source or config files. In particular, ignored .env files are not attested.
  const generated = ["node_modules/**", "worker/node_modules/**", ".next/**", "out/**", "build/**", "coverage/**", "test-results/**", "playwright-report/**", "next-env.d.ts", "tsconfig.tsbuildinfo"];
  if (git(["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", ".", ...generated.map((path) => `:(top,exclude)${path}`)])) {
    throw new Error("email-capture:untracked-ignored-inputs");
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
