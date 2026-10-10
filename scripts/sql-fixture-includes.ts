import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type IncludeFailure = { file: string; line: number; code: "literal" | "missing" | "escape" | "cycle" | "untracked" };
export type IncludeEdge = { file: string; line: number; target: string };

/** psql resolves \ir against the containing file, including nested scripts.
 * https://www.postgresql.org/docs/current/app-psql.html#APP-PSQL-META-COMMAND-INCLUDE-RELATIVE */
export function relativeIncludes(source: string): { line: number; filename: string | null }[] {
  const out: { line: number; filename: string | null }[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source.startsWith("--", i)) { const end = source.indexOf("\n", i);i = end < 0 ? source.length : end;continue; }
    if (source.startsWith("/*", i)) {
      let depth = 1;i += 2;
      while (i < source.length && depth) {
        if (source.startsWith("/*", i)) { depth++;i += 2; }
        else if (source.startsWith("*/", i)) { depth--;i += 2; }
        else i++;
      }
      i--;continue;
    }
    const quote = source[i];
    if (quote === "'" || quote === '"') {
      const escaped = quote === "'" && /[eE]/.test(source[i - 1] ?? "") && !/[\w]/.test(source[i - 2] ?? "");
      for (i++; i < source.length; i++) {
        if (escaped && source[i] === "\\") i++;
        else if (source[i] === quote) {
          if (source[i + 1] === quote) i++;
          else break;
        }
      }
      continue;
    }
    if (quote === "$" && !/[\w$]/.test(source[i - 1] ?? "")) {
      const dollar = source.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
      if (dollar) { const end = source.indexOf(dollar, i + dollar.length);i = end < 0 ? source.length : end + dollar.length - 1;continue; }
    }
    if (quote !== "\\") continue;
    const command = source.slice(i).match(/^\\(?:ir|include_relative)(?=\s|$)/)?.[0];
    if (!command) continue;
    const line = source.slice(0, i).split("\n").length;
    const end = source.indexOf("\n", i);
    const argument = source.slice(i + command.length, end < 0 ? source.length : end).trim();
    const single = argument.match(/^'((?:''|[^'])*)'(?:\s+--.*)?$/);
    const plain = argument.match(/^([A-Za-z0-9_.\/-]+)(?:\s+--.*)?$/);
    const filename = single ? single[1].replace(/''/g, "'") : plain?.[1] ?? null;
    // Dynamic variables/shell expansion and C-like quoted substitutions are
    // not a statically provable source path and are never evaluated here.
    out.push({ line, filename: filename && !/[\x00-\x1f\\:$`~]/.test(filename) ? filename : null });
    i = end < 0 ? source.length : end;
  }
  return out;
}

export function trackedSourceFiles(root: string): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0").filter(Boolean).sort();
}

export function trackedSqlFiles(root: string): string[] {
  return trackedSourceFiles(root).filter(file => /\.(?:sql|inc)$/.test(file));
}

export function inspectSqlFixtureIncludes(root: string, files = trackedSqlFiles(root),
  trackedInventory = trackedSourceFiles(root)) {
  const boundary = realpathSync(root);
  // The complete tracked inventory is separate from entry roots: an include
  // may have another extension, but a merely local file cannot exist in CI.
  const tracked = new Set(trackedInventory.map(file => path.resolve(boundary, file)));
  const failures: IncludeFailure[] = [], edges: IncludeEdge[] = [];
  const visited = new Set<string>(), active = new Set<string>();
  const inside = (file: string) => { const relative = path.relative(boundary, file);return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
  function visit(file: string) {
    if (visited.has(file)) return;
    const identity = realpathSync(file);
    active.add(identity);
    for (const include of relativeIncludes(readFileSync(file, "utf8"))) {
      const where = { file: path.relative(boundary, file), line: include.line };
      if (include.filename === null) { failures.push({ ...where, code: "literal" });continue; }
      const target = path.resolve(path.dirname(file), include.filename);
      if (path.isAbsolute(include.filename) || !inside(target)) { failures.push({ ...where, code: "escape" });continue; }
      if (!existsSync(target) || !statSync(target).isFile()) { failures.push({ ...where, code: "missing" });continue; }
      const exact = realpathSync(target);
      if (!inside(exact)) { failures.push({ ...where, code: "escape" });continue; }
      if (!tracked.has(target) || !tracked.has(exact)) { failures.push({ ...where, code: "untracked" });continue; }
      edges.push({ ...where, target: path.relative(boundary, target) });
      if (active.has(exact)) failures.push({ ...where, code: "cycle" });
      else visit(target);
    }
    active.delete(identity);visited.add(file);
  }
  for (const name of files) {
    const file = path.resolve(boundary, name);
    if (!inside(file)) { failures.push({ file: name, line: 1, code: "escape" });continue; }
    if (!existsSync(file) || !statSync(file).isFile()) { failures.push({ file: name, line: 1, code: "missing" });continue; }
    const exact = realpathSync(file);
    if (!inside(exact)) { failures.push({ file: name, line: 1, code: "escape" });continue; }
    if (!tracked.has(file) || !tracked.has(exact)) { failures.push({ file: name, line: 1, code: "untracked" });continue; }
    visit(file);
  }
  return { files: visited.size, edges, failures };
}

export function assertSqlFixtureIncludes(root = process.cwd()): void {
  const result = inspectSqlFixtureIncludes(root);
  if (result.failures.length) throw new Error("SQL fixture include preflight failed:\n"
    + result.failures.map(row => `${row.file}:${row.line}: ${row.code}`).join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assertSqlFixtureIncludes();
  const result = inspectSqlFixtureIncludes(process.cwd());
  console.log(`SQL fixture includes passed: ${result.files} source files, ${result.edges.length} exact relative includes`);
}
