import assert from "node:assert/strict";
import ts from "typescript";

export const EMBRYO_BROWSER_JOURNEYS = Object.freeze({
  "embryo-ingest": "embryo-ingest-journey.spec.ts",
  "embryo-mixed-qc": "embryo-mixed-qc-journey.spec.ts",
});
type FileCases = { project: string; file: string; cases: number };

/** Both real journeys need an empty split queue. Native partitions must put
 * them in separate fresh jobs; this never changes native case assignment. */
export function assertEmbryoJourneyPartition(rows: readonly FileCases[], full: boolean): void {
  const projects = Object.keys(EMBRYO_BROWSER_JOURNEYS);
  const files: string[] = Object.values(EMBRYO_BROWSER_JOURNEYS);
  const journeys = rows.filter(row => projects.includes(row.project) || files.includes(row.file));
  for (const row of journeys) {
    assert(EMBRYO_BROWSER_JOURNEYS[row.project as keyof typeof EMBRYO_BROWSER_JOURNEYS] === row.file
      && row.cases === 1, "Each embryo project requires its exact single real journey");
  }
  assert((full ? journeys.length === 2 : journeys.length <= 1),
    "Each fresh native partition permits at most one embryo journey");
  if (full) assert.deepEqual(journeys.map(row => row.project).sort(), projects.sort(),
    "Both real embryo journeys must be inventoried and executed");
}

export function assertEmbryoCiShard(shard: number | null, env: Readonly<Record<string, string | undefined>>): void {
  assert(env.CI !== "true" || shard !== null,
    "The two embryo journeys require separate fresh native CI partitions; unsharded CI is unsupported");
}

/** The real publication journeys must retain the permanent context audit.
 * AST imports reject commented lookalikes, aliases and plain Playwright test.
 * This is source preflight, never evidence that a browser actually executed. */
export function assertEmbryoJourneyAudits(sources: Readonly<Record<string, string>>): void {
  const names = Object.values(EMBRYO_BROWSER_JOURNEYS).sort();
  assert.deepEqual(Object.keys(sources).sort(), names, "Exact embryo audit source inventory required");
  for (const name of names) {
    const file = ts.createSourceFile(name, sources[name], ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const imports = file.statements.filter(ts.isImportDeclaration);
    const bindings = imports.flatMap(statement => {
      const named = statement.importClause?.namedBindings;
      return named && ts.isNamedImports(named) ? named.elements.filter(binding => binding.name.text === "test")
        .map(binding => ({ module: ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : "",
          original: binding.propertyName?.text ?? binding.name.text, typeOnly: statement.importClause?.isTypeOnly || binding.isTypeOnly })) : [];
    });
    assert(bindings.length === 1 && bindings[0].module === "./audited-test" && bindings[0].original === "test"
      && !bindings[0].typeOnly, "Both embryo journeys must use the genuine state network audit");
    if (name === EMBRYO_BROWSER_JOURNEYS["embryo-ingest"]) {
      const bound = imports.some(statement => ts.isStringLiteral(statement.moduleSpecifier)
        && statement.moduleSpecifier.text === "./helpers/embryo-published-audits"
        && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
        && statement.importClause.namedBindings.elements.some(binding => binding.name.text === "auditPublishedEmbryoSurfaces"
          && !binding.propertyName && !binding.isTypeOnly && !statement.importClause?.isTypeOnly));
      let calls = 0;
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
          && node.expression.text === "auditPublishedEmbryoSurfaces") calls++;
        ts.forEachChild(node, visit);
      }
      visit(file);
      assert(bound && calls === 1, "The real all-pass case must call its exact populated surface audit");
    }
  }
}
