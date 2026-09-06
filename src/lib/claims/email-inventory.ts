import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { EMAIL_RENDERERS, type EmailFixture, type PublicDigestTemplate } from "./email-fixtures";

export interface EmailEntrypoint { path: string; exportName: string }
const compositionOnly = "src/emails/base.tsx";

/** AST discovery is independent of the fixtures. New runtime exports cannot disappear. */
export function discoverEmailExports(files: readonly { path: string; source: string }[]): EmailEntrypoint[] {
  const result: EmailEntrypoint[] = [];
  if (new Set(files.map((f) => f.path)).size !== files.length) throw new Error("email-capture:duplicate-source-file");
  for (const file of files) {
    if (file.path === compositionOnly) continue;
    if (!/^src\/emails\/[a-z0-9/-]+\.tsx?$/.test(file.path)) throw new Error("email-capture:invalid-entrypoint-path");
    const tree = ts.createSourceFile(file.path, file.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const statement of tree.statements) {
      if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) throw new Error(`email-capture:unclassified-export:${file.path}`);
      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
      if (!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue;
      if (modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) throw new Error(`email-capture:unclassified-export:${file.path}`);
      if (ts.isFunctionDeclaration(statement) && statement.name) result.push({ path: file.path, exportName: statement.name.text });
      else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name)) throw new Error(`email-capture:unclassified-export:${file.path}`);
          result.push({ path: file.path, exportName: declaration.name.text });
        }
      } else throw new Error(`email-capture:unclassified-export:${file.path}`);
    }
  }
  return result.sort((a, b) => `${a.path}:${a.exportName}`.localeCompare(`${b.path}:${b.exportName}`));
}

export function readEmailInventory(projectRoot: string): EmailEntrypoint[] {
  const files: { path: string; source: string }[] = [];
  const visit = (relative: string) => {
    for (const entry of readdirSync(join(projectRoot, relative), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("email-capture:symlinked-source");
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (/\.tsx?$/.test(path) && !/\.(?:test|spec)\.tsx?$/.test(path)) files.push({ path, source: readFileSync(join(projectRoot, path), "utf8") });
    }
  };
  visit("src/emails");
  if (!files.some((f) => f.path === compositionOnly)) throw new Error("email-capture:missing-shared-layout");
  return discoverEmailExports(files);
}

export function assertEmailFixtureCoverage(discovered: readonly EmailEntrypoint[], fixtures: readonly EmailFixture[]): void {
  const key = (e: EmailEntrypoint) => `${e.path}:${e.exportName}`;
  const expected = Object.values(EMAIL_RENDERERS).map(([file, exportName]) => key({ path: `src/emails/${file}`, exportName })).sort();
  if (JSON.stringify(discovered.map(key).sort()) !== JSON.stringify(expected)) throw new Error("email-capture:uncovered-production-export");
  if (!fixtures.length || new Set(fixtures.map((f) => f.id)).size !== fixtures.length) throw new Error("email-capture:invalid-fixture-inventory");
  const covered = new Set<string>();
  const mailIds = new Set<string>();
  for (const f of fixtures) {
    const mapping = EMAIL_RENDERERS[f.mail.id];
    if (!mapping || f.entrypoint !== `src/emails/${mapping[0]}` || f.exportName !== mapping[1]) throw new Error("email-capture:fixture-export-mismatch");
    covered.add(`${f.entrypoint}:${f.exportName}`); mailIds.add(f.mail.id);
  }
  if (JSON.stringify([...covered].sort()) !== JSON.stringify(expected) || mailIds.size !== Object.keys(EMAIL_RENDERERS).length) throw new Error("email-capture:missing-fixture");
}

export function readPublicDigestCatalog(projectRoot: string): PublicDigestTemplate[] {
  return readdirSync(join(projectRoot, "data/templates")).filter((file) => file.endsWith(".json")).sort().flatMap((file) => {
    const rows: unknown = JSON.parse(readFileSync(join(projectRoot, "data/templates", file), "utf8"));
    if (!Array.isArray(rows)) throw new Error("email-capture:invalid-public-catalog");
    return rows.map((row: unknown) => {
      if (!row || typeof row !== "object" || !["slug", "title", "summary"].every((key) => typeof (row as Record<string, unknown>)[key] === "string")) throw new Error("email-capture:invalid-public-catalog");
      const { slug, title, summary } = row as PublicDigestTemplate;
      return { slug, title, summary };
    });
  });
}
