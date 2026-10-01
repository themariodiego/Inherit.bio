import assert from "node:assert/strict";
import ts from "typescript";

export const EMBRYO_BROWSER_JOURNEYS = Object.freeze({
  "embryo-ingest": "embryo-ingest-journey.spec.ts",
  "embryo-mixed-qc": "embryo-mixed-qc-journey.spec.ts",
  "embryo-qc-seed": "embryo-qc-second-seed-journey.spec.ts",
  "future-person-keyless": "reviews-keyless-owner-notice-journey.spec.ts",
});
type FileCases = { project: string; file: string; cases: number };

/** The four real journeys need an empty split queue. Native partitions must put
 * them in separate fresh jobs; this never changes native case assignment. */
export function assertEmbryoJourneyPartition(rows: readonly FileCases[], full: boolean): void {
  const projects = ["embryo-ingest", "embryo-mixed-qc"];
  const chromiumJourneys: readonly string[] = [EMBRYO_BROWSER_JOURNEYS["embryo-qc-seed"], EMBRYO_BROWSER_JOURNEYS["future-person-keyless"]];
  const files: string[] = Object.values(EMBRYO_BROWSER_JOURNEYS);
  const journeys = rows.filter(row => projects.includes(row.project) || files.includes(row.file));
  for (const row of journeys) {
    const expectedProject = chromiumJourneys.includes(row.file) ? "chromium"
      : Object.entries(EMBRYO_BROWSER_JOURNEYS).find(([, file]) => file === row.file)?.[0];
    assert(row.project === expectedProject && row.cases === 1, "Each embryo file requires its exact project and single real journey");
  }
  assert((full ? journeys.length === files.length : journeys.length <= 1),
    "Each fresh native partition permits at most one embryo journey");
  if (full) assert.deepEqual(journeys.map(row => row.file).sort(), files.sort(),
    "All real embryo journeys must be inventoried and executed");
}

export function assertEmbryoCiShard(shard: number | null, env: Readonly<Record<string, string | undefined>>): void {
  assert(env.CI !== "true" || shard !== null,
    "The embryo journeys require separate fresh native CI partitions; unsharded CI is unsupported");
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
      && !bindings[0].typeOnly, "All embryo journeys must use the genuine state network audit");
    if (name === EMBRYO_BROWSER_JOURNEYS["future-person-keyless"]) {
      const required = [
        ["seedParticipantC", "./participant-c-journey", 1],
        ["withEmbryoJourney", "../scripts/ci-embryo-journey", 1],
        ["syntheticHistoricalTransfer", "./helpers/historical-embryo-transfer", 1],
        ["saveNativeMatchingDetails", "./helpers/keyless-positive-journey", 1],
        ["expectFullDocumentReceipts", "./helpers/keyless-positive-journey", 2],
        ["openSyntheticReviewPdf", "./helpers/keyless-review-journey", 4],
        ["sendSyntheticDeliveredCallback", "./helpers/keyless-positive-journey", 2],
      ] as const;
      const calls: Record<string, number> = {};
      let origins = 0;
      function visitPositive(node: ts.Node) {
        if (ts.isCallExpression(node)) {
          if (ts.isIdentifier(node.expression)) calls[node.expression.text] = (calls[node.expression.text] ?? 0) + 1;
          if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
            && node.expression.expression.text === "test" && node.expression.name.text === "use"
            && node.arguments.length === 1 && ts.isObjectLiteralExpression(node.arguments[0])
            && node.arguments[0].properties.length === 1) {
            const property = node.arguments[0].properties[0];
            if (ts.isPropertyAssignment(property) && property.name.getText(file) === "baseURL"
              && ts.isStringLiteral(property.initializer) && property.initializer.text === "http://localhost:3105") origins++;
          }
        }
        ts.forEachChild(node, visitPositive);
      }
      visitPositive(file);
      for (const [symbol, module, count] of required) {
        const imported = imports.some(statement => ts.isStringLiteral(statement.moduleSpecifier)
          && statement.moduleSpecifier.text === module && !statement.importClause?.isTypeOnly
          && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
          && statement.importClause.namedBindings.elements.some(binding => binding.name.text === symbol && !binding.propertyName && !binding.isTypeOnly));
        assert(imported && calls[symbol] === count, "Keyless notice journey requires its exact connected native producer, document and callback calls");
      }
      assert(origins === 1, "Keyless notice journey requires the exact isolated 3105 origin");
    }
    if (name === EMBRYO_BROWSER_JOURNEYS["embryo-qc-seed"]) {
      const exactImport = (original: string, module: string) => imports.some(statement => ts.isStringLiteral(statement.moduleSpecifier)
        && statement.moduleSpecifier.text === module && !statement.importClause?.isTypeOnly
        && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
        && statement.importClause.namedBindings.elements.some(binding => binding.name.text === original && !binding.propertyName && !binding.isTypeOnly));
      const calls: Record<string, ts.CallExpression[]> = {};
      let fixedOrigin = 0;
      function visitSeed(node: ts.Node) {
        if (ts.isCallExpression(node)) {
          if (ts.isIdentifier(node.expression)) (calls[node.expression.text] ??= []).push(node);
          if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
            && node.expression.expression.text === "test" && node.expression.name.text === "use"
            && node.arguments.length === 1 && ts.isObjectLiteralExpression(node.arguments[0])
            && node.arguments[0].properties.length === 1) {
            const property = node.arguments[0].properties[0];
            if (ts.isPropertyAssignment(property) && property.name.getText(file) === "baseURL"
              && ts.isStringLiteral(property.initializer) && property.initializer.text === "http://localhost:3105") fixedOrigin++;
          }
        }
        ts.forEachChild(node, visitSeed);
      }
      visitSeed(file);
      for (const [symbol, module] of [["seedParticipantC", "./participant-c-journey"],
        ["withEmbryoJourney", "../scripts/ci-embryo-journey"], ["provePublishedQcCrossSurface", "./helpers/embryo-qc-cross-surface"],
        ["saveQcSeedReceipt", "./helpers/embryo-qc-seed-receipt"]])
        assert(exactImport(symbol, module) && calls[symbol]?.length === 1, "Second QC seed requires its real closed producer and receipt calls");
      const receiptSeed = calls.saveQcSeedReceipt[0].arguments[0];
      const seedOptions = calls.seedParticipantC[0].arguments[0];
      assert(ts.isObjectLiteralExpression(seedOptions), "Second QC seed requires literal closed producer options");
      for (const [name, value] of [["qcSeed", "b"], ["ownerEmail", "qc-seed-b@e2e.local"],
        ["parentEmail", "qc-seed-b-parent@e2e.local"]]) {
        const properties = seedOptions.properties.filter(property => ts.isPropertyAssignment(property)
          && property.name.getText(file) === name);
        assert(properties.length === 1 && ts.isPropertyAssignment(properties[0])
          && ts.isStringLiteral(properties[0].initializer) && properties[0].initializer.text === value,
        "Second QC seed requires its exact committed-fixture selector and synthetic parent pair");
      }
      assert(fixedOrigin === 1 && ts.isStringLiteral(receiptSeed) && receiptSeed.text === "b",
        "Second QC seed requires the exact owned 3105 origin and seed identity");
    }
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
