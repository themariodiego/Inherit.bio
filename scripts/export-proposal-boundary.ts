import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { z } from "zod";

const ACTIVE = "docs/export-member-plan.json";
const PROPOSAL = "docs/proposals/requester-statement-export-member-plan.json";
const PROVENANCE = "docs/proposals/requester-statement-export-member-plan.provenance.json";
const CONSUMER = "src/lib/export/member-plan.ts";
const digest = (raw: Uint8Array) => createHash("sha256").update(raw).digest("hex");
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const provenanceSchema = z.object({
  version: z.literal("requester-statement-export-proposal-provenance-v1"),
  status: z.literal("unbound-source-only"),
  active: z.object({ file: z.literal(ACTIVE), bytes: z.number().int().positive(), sha256: sha,
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/) }).strict(),
  proposal: z.object({ file: z.literal(PROPOSAL), bytes: z.number().int().positive(), sha256: sha,
    sourceManifestSha256: sha }).strict(),
  approvedComputedImports: z.array(z.object({ file: z.string().startsWith("src/"), sourceSha256: sha,
    expression: z.string().min(1) }).strict()),
}).strict();

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).sort().flatMap(name => {
    const file = path.join(directory, name);
    const stat = lstatSync(file);
    assert(!stat.isSymbolicLink(), "Proposal boundary does not follow source symlinks");
    if (stat.isDirectory()) return sourceFiles(file);
    return /\.(?:[cm]?[jt]s|[jt]sx)$/.test(name) && !/\.test\.[^.]+$/.test(name) ? [file] : [];
  });
}

function unwrapped(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
    ? unwrapped(node.expression) : node;
}

function literal(node: ts.Expression): string | undefined {
  node = unwrapped(node);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literal(node.left), right = literal(node.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

function resolved(root: string, file: string, reference: string): string | undefined {
  if (reference.startsWith("@/")) return path.resolve(root, "src", reference.slice(2));
  if (reference.startsWith(".")) return path.resolve(path.dirname(file), reference);
  if (path.isAbsolute(reference)) return path.resolve(reference);
  return undefined;
}

/** Static source and whole-byte provenance boundary. It never imports application
 * code or proves a database, provider or arbitrary computed filesystem access. */
export function verifyExportProposalBoundary(root: string): { productionSources: number; computedImports: number } {
  root = path.resolve(root);
  const provenance = provenanceSchema.parse(JSON.parse(readFileSync(path.join(root, PROVENANCE), "utf8")));
  for (const artifact of [provenance.active, provenance.proposal]) {
    const raw = readFileSync(path.join(root, artifact.file));
    assert(raw.length === artifact.bytes && digest(raw) === artifact.sha256,
      `Export artifact provenance differs: ${artifact.file}`);
  }
  const proposalRoot = path.join(root, "docs", "proposals");
  const rejectsProposal = (file: string, reference: string): void => {
    const target = resolved(root, file, reference);
    const portable = reference.replaceAll("\\", "/");
    assert(!(target === proposalRoot || target?.startsWith(proposalRoot + path.sep)
      || /(?:^|\/)docs\/proposals(?:\/|$)/.test(portable)), "Application reaches the unbound export proposal");
  };
  let computedImports = 0;
  const files = sourceFiles(path.join(root, "src"));
  let consumerChecked = false;
  for (const file of files) {
    const raw = readFileSync(file);
    const source = ts.createSourceFile(file, raw.toString("utf8"), ts.ScriptTarget.Latest, true,
      /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const relative = path.relative(root, file).split(path.sep).join("/");
    const verifyLoad = (argument: ts.Expression, expression: ts.Node): void => {
      const reference = literal(argument);
      if (reference !== undefined) { rejectsProposal(file, reference); return; }
      const allowed = provenance.approvedComputedImports.some(entry => entry.file === relative
        && entry.sourceSha256 === digest(raw) && entry.expression === expression.getText(source));
      assert(allowed, `Unreviewed computed application import: ${relative}`);
      computedImports++;
    };
    const inspectFilesystemArgument = (argument: ts.Node): void => {
      if (ts.isExpression(argument)) {
        const value = literal(argument);
        if (value !== undefined) rejectsProposal(file, value);
      }
      ts.forEachChild(argument, inspectFilesystemArgument);
    };
    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
        && ts.isStringLiteralLike(node.moduleSpecifier)) rejectsProposal(file, node.moduleSpecifier.text);
      if (ts.isCallExpression(node)) {
        const name = ts.isIdentifier(node.expression) ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : "";
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword || name === "require") {
          assert(node.arguments.length === 1, "Application imports must have one bounded source argument");
          verifyLoad(node.arguments[0], node);
        }
        if (["readFile", "readFileSync", "createReadStream", "open"].includes(name) && node.arguments[0])
          inspectFilesystemArgument(node.arguments[0]);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (relative === CONSUMER) {
      const imports = source.statements.filter(ts.isImportDeclaration).filter(node => node.moduleSpecifier
        && ts.isStringLiteralLike(node.moduleSpecifier)
        && resolved(root, file, node.moduleSpecifier.text) === path.join(root, ACTIVE));
      assert(imports.length === 1 && imports[0].importClause?.name, "Current plan needs its fixed default import");
      const currentName = imports[0].importClause.name.text;
      const declarations = source.statements.filter(ts.isVariableStatement)
        .flatMap(node => [...node.declarationList.declarations])
        .filter(node => ts.isIdentifier(node.name) && node.name.text === "exportMemberPlan");
      assert(declarations.length === 1 && declarations[0].initializer, "Current plan needs one fixed binding");
      const initializer = unwrapped(declarations[0].initializer);
      assert(ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression)
        && initializer.expression.text === "parseExportMemberPlan" && initializer.arguments.length === 1
        && ts.isIdentifier(initializer.arguments[0]) && initializer.arguments[0].text === currentName,
      "A flag or alternate source must not select the active export plan");
      consumerChecked = true;
    }
  }
  assert(consumerChecked, "Current export consumer is missing");
  return { productionSources: files.length, computedImports };
}
