import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { CONFIRMATION_LEVELS } from "./evidence";
import { CONFIRMATION_BLOCK, COUNSELLOR_NO_ROUTE } from "./strings";
import { readabilitySentences, wordCount } from "../../../scripts/readability";
import { collectReadabilityBlocks, runReadabilityGate } from "../../../scripts/readability-gate";
import { fileURLToPath } from "node:url";
import type { EvidenceLevel } from "@/lib/genome/taxonomy";

/** Source preflight only; the real async page is separately exercised in E2E. */
function assertActualConfirmation(source: string) {
  const file = ts.createSourceFile("report.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imported = file.statements.some(node => ts.isImportDeclaration(node)
    && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "@/copy/reports/evidence"
    && !node.importClause?.isTypeOnly && node.importClause?.namedBindings
    && ts.isNamedImports(node.importClause.namedBindings)
    && node.importClause.namedBindings.elements.some(row => row.name.text === "CONFIRMATION_LEVELS"
      && !row.propertyName && !row.isTypeOnly));
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "CONFIRMATION_LEVELS") calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert(imported && calls.length === 1, "One actual imported confirmation policy must control the block");
  const call = calls[0], access = call.expression as ts.PropertyAccessExpression;
  assert(access.name.text === "has" && call.arguments.length === 1
    && ts.isPropertyAccessExpression(call.arguments[0]) && ts.isIdentifier(call.arguments[0].expression)
    && call.arguments[0].expression.text === "template" && call.arguments[0].name.text === "evidence",
  "Only the actual template evidence controls confirmation");
  assert(ts.isConditionalExpression(call.parent) && call.parent.condition === call
    && call.parent.whenFalse.kind === ts.SyntaxKind.NullKeyword, "The real closed policy controls both branches");
  let positive = call.parent.whenTrue;
  while (ts.isParenthesizedExpression(positive)) positive = positive.expression;
  assert(ts.isJsxElement(positive) && positive.openingElement.tagName.getText(file) === "div");
  const attrs = positive.openingElement.attributes.properties;
  assert(attrs.length === 2 && attrs.every(ts.isJsxAttribute)
    && attrs[0].name.getText(file) === "data-confirmation-block"
    && attrs[0].initializer && ts.isStringLiteral(attrs[0].initializer) && attrs[0].initializer.text === "true"
    && attrs[1].name.getText(file) === "className"
    && attrs[1].initializer && ts.isStringLiteral(attrs[1].initializer) && attrs[1].initializer.text === "space-y-1",
  "The exact visible block cannot be hidden or replaced with a control");
  const children = positive.children.filter(node => !ts.isJsxText(node) || node.text.trim());
  assert(children.length === 2 && children.every(ts.isJsxElement), "Both full companion paragraphs are required");
  for (const [index, paragraph] of children.entries()) {
    assert(paragraph.openingElement.tagName.getText(file) === "p");
    const body = paragraph.children.filter(node => !ts.isJsxText(node) || node.text.trim());
    assert(body.length === 1 && ts.isJsxExpression(body[0]) && body[0].expression
      && ts.isIdentifier(body[0].expression)
      && body[0].expression.text === ["CONFIRMATION_BLOCK", "COUNSELLOR_NO_ROUTE"][index],
    "The exact complete strings and reading order must stay");
    const attributes = paragraph.openingElement.attributes.properties;
    assert(index === 0 ? attributes.length === 1 && ts.isJsxSpreadAttribute(attributes[0])
      && ts.isIdentifier(attributes[0].expression) && attributes[0].expression.text === "REQUIRED_ACCURACY"
      : attributes.length === 0, "Required accuracy metadata and visible paragraph attributes must stay");
  }
  let ancestor: ts.Node | undefined = positive;
  while (ancestor && !ts.isJsxAttribute(ancestor)) {
    if (ts.isJsxElement(ancestor)) assert(!["details", "dialog", "button"].includes(ancestor.openingElement.tagName.getText(file)));
    ancestor = ancestor.parent;
  }
  assert(ancestor && ts.isJsxAttribute(ancestor) && ancestor.name.getText(file) === "howSureWeAre",
    "Confirmation stays in the original non-collapsible How sure we are slot");
}

describe("owner-approved Emerging confirmation policy", () => {
  const real = () => readFileSync(new URL("../../app/(app)/genome/[subject]/reports/[slug]/page.tsx", import.meta.url), "utf8");

  it("includes exactly the three approved levels and no unknown or unpublished level", () => {
    expect([...CONFIRMATION_LEVELS]).toEqual(["clinical", "established", "emerging"]);
    for (const level of ["preliminary", "insufficient", "Emerging", "emerging ", "unknown"]) {
      expect(CONFIRMATION_LEVELS.has(level as EvidenceLevel)).toBe(false);
    }
  });

  it("keeps both complete exact paragraphs readable without deleting clinical qualification", () => {
    expect(CONFIRMATION_BLOCK).toBe("This is a reading of a file you uploaded, not a clinical test. Before acting on it, ask a doctor or genetic counsellor to confirm it in an accredited laboratory.");
    expect(COUNSELLOR_NO_ROUTE).toBe("We don’t have a counsellor to point you to where you are. Your doctor can refer you.");
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const blocks = collectReadabilityBlocks(root).filter(block => block.path === "src/copy/reports/strings.ts");
    for (const text of [CONFIRMATION_BLOCK, COUNSELLOR_NO_ROUTE]) {
      expect(blocks.filter(block => block.text === text)).toHaveLength(1);
      for (const sentence of readabilitySentences(text)) expect(wordCount(sentence)).toBeLessThanOrEqual(32);
    }
    // Score the unchanged text with the actual G1.10 registered-term policy.
    expect(runReadabilityGate(root).failures.filter(failure => failure.startsWith("src/copy/reports/strings.ts:"))).toEqual([]);
  });

  it("binds the unchanged actual async renderer to both full visible paragraphs", () => {
    expect(() => assertActualConfirmation(real())).not.toThrow();
  });

  it("refuses planted wrong-level, disconnected, absent, hidden and substituted disclosures", () => {
    const changes = [
      (s: string) => s.replace("  CONFIRMATION_LEVELS,\n", ""),
      (s: string) => s.replace("CONFIRMATION_LEVELS.has(template.evidence)", "true"),
      (s: string) => s.replace("CONFIRMATION_LEVELS.has(template.evidence)", "CONFIRMATION_LEVELS.has(template.layer)"),
      (s: string) => s.replace("CONFIRMATION_LEVELS.has(template.evidence)", "CONFIRMATION_LEVELS.has(template.evidence) && false"),
      (s: string) => s.replace('<p>{COUNSELLOR_NO_ROUTE}</p>', ""),
      (s: string) => s.replace('<p {...REQUIRED_ACCURACY}>{CONFIRMATION_BLOCK}</p>', ""),
      (s: string) => s.replace('data-confirmation-block="true" className="space-y-1"', 'data-confirmation-block="true" className="space-y-1 hidden"'),
      (s: string) => s.replace('data-confirmation-block="true" className="space-y-1"', 'data-confirmation-block="true" className="space-y-1" hidden'),
      (s: string) => s.replace('<p>{COUNSELLOR_NO_ROUTE}</p>', '<p>{NOT_DIAGNOSTIC}</p>'),
      (s: string) => s.replace("howSureWeAre={", "whatThisIs={"),
    ];
    for (const change of changes) {
      const source = real(), altered = change(source); expect(altered).not.toBe(source);
      expect(() => assertActualConfirmation(altered)).toThrow();
    }
  });
});
