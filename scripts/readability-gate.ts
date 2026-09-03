import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import fixtures from "./readability-fixtures.json";
import {
  fleschKincaidGrade,
  readabilitySentences,
  readabilityWords,
  wordCount,
} from "./readability";

const LONG_TAGS = new Set([
  "blockquote",
  "dd",
  "figcaption",
  "li",
  "p",
]);
const SHORT_TAGS = new Set(["button", "label", "th"]);
const COMPONENT_ROLES = new Map([
  ["Button", "button"],
  ["Label", "label"],
  ["TableHead", "th"],
  // `@react-email/components` paragraph; only the mail templates under
  // `src/emails/` render it, so its children are mail body copy.
  ["Text", "block"],
]);
const FORBIDDEN_SHORT_TERMS = new Set([
  "allele",
  "call rate",
  "coverage fraction",
  "liftover status",
  "percentile",
]);
const SHORT_ROLES = new Set(["heading", "button", "th", "label", "status"]);
const PLACEHOLDER = "fact";

/**
 * JSX props whose string value is user-visible copy on the rendered component
 * (beyond the four attribute names that have always been scanned). The role
 * comes from the prop name through `inferCopyRole`; `title` keeps its original
 * label role through the older attribute loop and is not repeated here.
 */
const COPY_PROP_NAMES = new Set([
  "heading",
  "label",
  "description",
  "summary",
  "note",
  "text",
  "children",
  // chart axis labels
  "axisLabel",
  "xLabel",
  "yLabel",
  "xAxisLabel",
  "yAxisLabel",
]);

/**
 * Role inference for copy that has no rendered element: the key or export
 * name it lives under decides. Rules are tested nearest key first.
 */
const COPY_ROLE_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/heading|title|^h1$/, "heading"],
  [/label|chip/, "label"],
  [/button|action|cta/, "button"],
  [/status|note|error|alert/, "status"],
];

const COPY_BINARY_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.CommaToken,
]);

interface VocabularyFile {
  schemaVersion: number;
  words: string[];
}

interface JargonFile {
  schemaVersion: number;
  terms: Array<{ term: string; aliases?: string[]; definition: string }>;
}

export interface CopyBlock {
  path: string;
  line: number;
  text: string;
  role: string;
  legal: boolean;
  legalSummary: boolean;
  sentenceCap: boolean;
}

type CopyEmitter = (node: ts.Node, text: string, hints: readonly string[]) => void;

function sourceLine(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function tagName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText();
}

/** A template literal with `${…}` slots, each slot replaced by the placeholder word. */
function templatePlaceholderText(node: ts.TemplateExpression): string {
  return (
    node.head.text +
    node.templateSpans.map((span) => `${PLACEHOLDER}${span.literal.text}`).join("")
  );
}

function literalText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return templatePlaceholderText(node);
  return undefined;
}

function attributeValue(node: ts.JsxOpeningLikeElement, name: string): string | undefined {
  const attribute = node.attributes.properties.find(
    (item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText() === name,
  );
  if (!attribute?.initializer) return undefined;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
    return literalText(attribute.initializer.expression);
  }
  return undefined;
}

function copyRole(node: ts.JsxOpeningLikeElement): string {
  const tag = tagName(node);
  if (/^h[1-6]$/.test(tag)) return "heading";
  return (
    COMPONENT_ROLES.get(tag) ??
    (SHORT_TAGS.has(tag)
      ? tag
      : attributeValue(node, "role") ?? (LONG_TAGS.has(tag) ? "block" : ""))
  );
}

function staticText(node: ts.Node, skipNestedCopyContainers = false): string {
  if (ts.isJsxText(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return templatePlaceholderText(node);
  if (ts.isJsxExpression(node)) {
    return node.expression ? staticText(node.expression, skipNestedCopyContainers) : "";
  }
  if (ts.isParenthesizedExpression(node)) {
    return staticText(node.expression, skipNestedCopyContainers);
  }
  if (ts.isConditionalExpression(node)) {
    return `${staticText(node.whenTrue, skipNestedCopyContainers)} ${staticText(node.whenFalse, skipNestedCopyContainers)}`;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return `${staticText(node.left, skipNestedCopyContainers)} ${staticText(node.right, skipNestedCopyContainers)}`;
  }
  if (ts.isJsxElement(node)) {
    if (skipNestedCopyContainers && copyRole(node.openingElement)) return "";
    return node.children.map((child) => staticText(child, true)).join(" ");
  }
  if (ts.isJsxFragment(node)) {
    return node.children.map((child) => staticText(child, skipNestedCopyContainers)).join(" ");
  }
  return "";
}

function cleanText(value: string): string {
  return value
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function isLegalPath(relativePath: string): boolean {
  return (
    relativePath.includes("/(marketing)/legal/") ||
    relativePath.includes("/(marketing)/terms/") ||
    relativePath.includes("/(marketing)/privacy/")
  );
}

function hasSentenceCap(relativePath: string, role: string): boolean {
  return (
    relativePath.includes("/auth/") ||
    relativePath.includes("/upload") ||
    relativePath.includes("reports/[slug]") && role === "heading" ||
    relativePath.includes("/copy/reports/") && role === "heading" ||
    role === "status" ||
    role === "alert"
  );
}

function nameSegments(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
}

/** The role of copy that is not rendered by a known element, from its key or export name. */
export function inferCopyRole(hints: readonly string[]): string {
  for (const hint of hints) {
    const segments = nameSegments(hint);
    for (const [pattern, role] of COPY_ROLE_RULES) {
      if (segments.some((segment) => pattern.test(segment))) return role;
    }
  }
  return "block";
}

function isClassList(value: string): boolean {
  const tokens = value.split(/\s+/);
  if (tokens.length < 2) return false;
  if (!tokens.every((token) => /^[!a-z0-9:/[\]%#().-]+$/.test(token))) return false;
  const utilityTokens = tokens.filter((token) => /[-:[]/.test(token)).length;
  return utilityTokens > tokens.length / 2;
}

/**
 * Strings that are tokens rather than copy: identifiers, keys, URLs, paths,
 * anchors, class lists, rsIDs, hashes, lone ALL-CAPS symbols, and anything
 * under two words unless it plays a short role (headings, labels, buttons,
 * table headers and statuses are read even when they are one word).
 */
export function isOpaqueCopy(text: string, role: string): boolean {
  const value = text.trim();
  if (!value) return true;
  if (/^(?:https?:\/\/|mailto:|www\.)/i.test(value)) return true;
  if (/^(?:\.{0,2}\/|#)/.test(value)) return true;
  if (/^rs\d+$/i.test(value)) return true;
  if (/^[a-f0-9]{32,}$/i.test(value)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return true;
  if (/^[A-Z][A-Z0-9_-]*$/.test(value)) return true;
  const bare = value.replace(/[.!?…]+$/, "");
  if (
    !/\s/.test(bare) &&
    (/[_.:@/\\]/.test(bare) || /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(bare) || /^[a-z][a-z0-9]*[A-Z]/.test(bare))
  ) {
    return true;
  }
  if (isClassList(value)) return true;
  const words = readabilityWords(value);
  if (words.length === 0 || words.every((word) => word.toLowerCase() === PLACEHOLDER)) return true;
  return words.length < 2 && !SHORT_ROLES.has(role);
}

function propertyName(name: ts.PropertyName, source: ts.SourceFile): string {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  return name.getText(source);
}

/**
 * Walks an expression or statement and hands every string literal,
 * no-substitution template literal and placeholder-filled template
 * expression to `emit`, with the chain of keys and names it sits under
 * (nearest first). Object keys, comparisons, element-access keys and type
 * positions are never treated as copy.
 */
function collectCopyLiterals(
  source: ts.SourceFile,
  node: ts.Node | undefined,
  hints: readonly string[],
  emit: CopyEmitter,
): void {
  if (!node) return;
  const recurse = (child: ts.Node | undefined, childHints: readonly string[] = hints) =>
    collectCopyLiterals(source, child, childHints, emit);
  const text = literalText(node);
  if (text !== undefined) {
    emit(node, text, hints);
    return;
  }
  if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        recurse(property.initializer, [propertyName(property.name, source), ...hints]);
      } else if (ts.isMethodDeclaration(property)) {
        recurse(property.body, [propertyName(property.name, source), ...hints]);
      } else if (ts.isSpreadAssignment(property)) {
        recurse(property.expression);
      }
    }
    return;
  }
  if (ts.isArrayLiteralExpression(node)) {
    node.elements.forEach((element) => recurse(element));
    return;
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    recurse(node.body);
    return;
  }
  if (ts.isFunctionDeclaration(node)) {
    recurse(node.body, [node.name?.text ?? "", ...hints]);
    return;
  }
  if (ts.isConditionalExpression(node)) {
    recurse(node.whenTrue);
    recurse(node.whenFalse);
    return;
  }
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSpreadElement(node) ||
    ts.isAwaitExpression(node)
  ) {
    recurse(node.expression);
    return;
  }
  if (ts.isBinaryExpression(node)) {
    if (COPY_BINARY_OPERATORS.has(node.operatorToken.kind)) {
      recurse(node.left);
      recurse(node.right);
    }
    return;
  }
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    node.arguments?.forEach((argument) => recurse(argument));
    return;
  }
  if (ts.isBlock(node)) {
    node.statements.forEach((statement) => recurse(statement));
    return;
  }
  if (ts.isReturnStatement(node) || ts.isExpressionStatement(node)) {
    recurse(node.expression);
    return;
  }
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      recurse(declaration.initializer, [declaration.name.getText(source), ...hints]);
    }
    return;
  }
  if (ts.isIfStatement(node)) {
    recurse(node.thenStatement);
    recurse(node.elseStatement);
    return;
  }
  if (ts.isSwitchStatement(node)) {
    for (const clause of node.caseBlock.clauses) clause.statements.forEach((statement) => recurse(statement));
    return;
  }
  if (
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  ) {
    recurse(node.statement);
    return;
  }
  if (ts.isTryStatement(node)) {
    recurse(node.tryBlock);
    recurse(node.catchClause?.block);
    recurse(node.finallyBlock);
  }
}

/** Template expressions reachable through parentheses, branches and `+`/`??`/`||`/`&&`. */
function reachableTemplates(node: ts.Node): ts.TemplateExpression[] {
  if (ts.isTemplateExpression(node)) return [node];
  if (ts.isParenthesizedExpression(node)) return reachableTemplates(node.expression);
  if (ts.isConditionalExpression(node)) {
    return [...reachableTemplates(node.whenTrue), ...reachableTemplates(node.whenFalse)];
  }
  if (ts.isBinaryExpression(node) && COPY_BINARY_OPERATORS.has(node.operatorToken.kind)) {
    return [...reachableTemplates(node.left), ...reachableTemplates(node.right)];
  }
  return [];
}

/** True when a JSX child sits inside an element that already yields its own block. */
function insideCopyContainer(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isJsxElement(current) && copyRole(current.openingElement)) return true;
    if (ts.isJsxElement(current) || ts.isJsxFragment(current) || ts.isJsxExpression(current)) {
      current = current.parent;
      continue;
    }
    return false;
  }
  return false;
}

export function extractTsxBlocksFromSource(relativePath: string, sourceText: string): CopyBlock[] {
  const blocks: CopyBlock[] = [];
  const source = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const legal = isLegalPath(relativePath);
  const pushCopy = (node: ts.Node, text: string, role: string) => {
    const clean = cleanText(text);
    if (!clean || isOpaqueCopy(clean, role)) return;
    blocks.push({
      path: relativePath,
      line: sourceLine(source, node),
      text: clean,
      role,
      legal,
      legalSummary: false,
      sentenceCap: hasSentenceCap(relativePath, role),
    });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const opening = node.openingElement;
      const role = copyRole(opening);
      if (role) {
        const text = cleanText(node.children.map((child) => staticText(child, true)).join(" "));
        if (text) {
          blocks.push({
            path: relativePath,
            line: sourceLine(source, node),
            text,
            role,
            legal,
            legalSummary: legal && attributeValue(opening, "data-legal-summary") !== undefined,
            sentenceCap: hasSentenceCap(relativePath, role),
          });
        }
      }
    }
    if (ts.isJsxOpeningLikeElement(node)) {
      for (const [attribute, role] of [
        ["aria-label", "label"],
        ["alt", "label"],
        ["placeholder", "label"],
        ["title", "label"],
      ] as const) {
        const text = cleanText(attributeValue(node, attribute) ?? "");
        if (text) {
          blocks.push({
            path: relativePath,
            line: sourceLine(source, node),
            text,
            role,
            legal,
            legalSummary: false,
            sentenceCap: hasSentenceCap(relativePath, role),
          });
        }
      }
      // Copy passed through component props: a literal (plain, template, or
      // template with placeholder slots) is scored under the prop's role; an
      // object or array literal is walked for values under copy-named keys.
      for (const property of node.attributes.properties) {
        if (!ts.isJsxAttribute(property) || !property.initializer) continue;
        const name = property.name.getText(source);
        if (!COPY_PROP_NAMES.has(name)) continue;
        const direct = attributeValue(node, name);
        if (direct !== undefined) {
          pushCopy(property, direct, inferCopyRole([name]));
          continue;
        }
        const expression = ts.isJsxExpression(property.initializer)
          ? property.initializer.expression
          : undefined;
        if (expression && (ts.isObjectLiteralExpression(expression) || ts.isArrayLiteralExpression(expression))) {
          collectCopyLiterals(source, expression, [name], (literal, text, hints) => {
            if (COPY_PROP_NAMES.has(hints[0]) || hints[0] === "title") {
              pushCopy(literal, text, inferCopyRole(hints));
            }
          });
        }
      }
    }
    // Runtime-assembled sentences in JSX children outside any copy container,
    // for example <span>{`${count} files ready`}</span>: scored with each slot
    // replaced by the placeholder word. Inside a container the parent block
    // already carries the same placeholder text.
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      !ts.isJsxAttribute(node.parent) &&
      !insideCopyContainer(node)
    ) {
      for (const template of reachableTemplates(node.expression)) {
        pushCopy(template, templatePlaceholderText(template), "block");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return blocks;
}

function extractTsxBlocks(repositoryRoot: string): CopyBlock[] {
  const blocks: CopyBlock[] = [];
  const sourceRoot = path.join(repositoryRoot, "src");
  const visitDirectory = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visitDirectory(absolute);
        continue;
      }
      if (!entry.name.endsWith(".tsx") || entry.name.endsWith(".test.tsx")) continue;
      const relativePath = path.relative(repositoryRoot, absolute);
      blocks.push(
        ...extractTsxBlocksFromSource(relativePath, fs.readFileSync(absolute, "utf8")),
      );
    }
  };
  visitDirectory(sourceRoot);
  return blocks;
}

/**
 * Copy-registry extraction for `src/copy/** /*.ts` (and any `.ts` module under
 * `src/emails/`): every top-level constant, object, array, `as const` tuple
 * and function body is walked for string literals, no-substitution template
 * literals and template expressions (each `${…}` slot becomes the placeholder
 * word). The role comes from the nearest key or the export name; opaque
 * tokens are dropped; each block points at the literal's own line.
 */
export function extractCopyRegistryBlocksFromSource(relativePath: string, sourceText: string): CopyBlock[] {
  const blocks: CopyBlock[] = [];
  const source = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const legal = isLegalPath(relativePath);
  const emit: CopyEmitter = (node, text, hints) => {
    const clean = cleanText(text);
    const role = inferCopyRole(hints);
    if (!clean || isOpaqueCopy(clean, role)) return;
    blocks.push({
      path: relativePath,
      line: sourceLine(source, node),
      text: clean,
      role,
      legal,
      legalSummary: false,
      sentenceCap: hasSentenceCap(relativePath, role),
    });
  };
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectCopyLiterals(source, declaration.initializer, [declaration.name.getText(source)], emit);
      }
    } else if (ts.isFunctionDeclaration(statement)) {
      collectCopyLiterals(source, statement, [], emit);
    } else if (ts.isExportAssignment(statement)) {
      collectCopyLiterals(source, statement.expression, ["default"], emit);
    }
  }
  return blocks;
}

const COPY_REGISTRY_ROOTS = ["src/copy", "src/emails"];

export function extractCopyRegistryBlocks(repositoryRoot: string): CopyBlock[] {
  const blocks: CopyBlock[] = [];
  const visitDirectory = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visitDirectory(absolute);
        continue;
      }
      if (
        !entry.name.endsWith(".ts") ||
        entry.name.endsWith(".test.ts") ||
        entry.name.endsWith(".d.ts")
      ) {
        continue;
      }
      const relativePath = path.relative(repositoryRoot, absolute);
      blocks.push(
        ...extractCopyRegistryBlocksFromSource(relativePath, fs.readFileSync(absolute, "utf8")),
      );
    }
  };
  for (const root of COPY_REGISTRY_ROOTS) {
    const directory = path.join(repositoryRoot, root);
    if (fs.existsSync(directory)) visitDirectory(directory);
  }
  return blocks;
}

function extractTemplateBlocks(repositoryRoot: string): CopyBlock[] {
  const blocks: CopyBlock[] = [];
  const directory = path.join(repositoryRoot, "data/templates");
  for (const filename of fs.readdirSync(directory).filter((name) => name.endsWith(".json"))) {
    const relativePath = `data/templates/${filename}`;
    const templates = JSON.parse(fs.readFileSync(path.join(directory, filename), "utf8")) as Array<{
      title: string;
      summary: string;
      variants: Array<{ interpretations: Record<string, string> }>;
    }>;
    templates.forEach((template, templateIndex) => {
      blocks.push({
        path: relativePath,
        line: templateIndex + 1,
        text: template.title,
        role: "heading",
        legal: false,
        legalSummary: false,
        sentenceCap: true,
      });
      blocks.push({
        path: relativePath,
        line: templateIndex + 1,
        text: template.summary,
        role: "block",
        legal: false,
        legalSummary: false,
        sentenceCap: false,
      });
      for (const variant of template.variants) {
        for (const interpretation of Object.values(variant.interpretations)) {
          blocks.push({
            path: relativePath,
            line: templateIndex + 1,
            text: interpretation,
            role: "block",
            legal: false,
            legalSummary: false,
            sentenceCap: false,
          });
        }
      }
    });
  }
  return blocks;
}

function extractProviderBlocks(repositoryRoot: string): CopyBlock[] {
  const relativePath = "data/providers/providers.json";
  const providers = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8"),
  ) as Array<{
    data_practices_note?: string;
    ships_to?: string;
    gating?: string;
    products?: Array<{ turnaround?: string }>;
  }>;
  const blocks: CopyBlock[] = [];
  providers.forEach((provider, index) => {
    for (const text of [
      provider.data_practices_note,
      provider.ships_to,
      provider.gating,
      ...(provider.products ?? []).map((product) => product.turnaround),
    ]) {
      if (!text) continue;
      blocks.push({
        path: relativePath,
        line: index + 1,
        text,
        role: wordCount(text) <= 14 ? "status" : "block",
        legal: false,
        legalSummary: false,
        sentenceCap: wordCount(text) <= 14,
      });
    }
  });
  return blocks;
}

function extractConsentArtifactBlocks(repositoryRoot: string): CopyBlock[] {
  const directory = path.join(repositoryRoot, "supabase/migrations");
  const blocks: CopyBlock[] = [];
  for (const filename of fs.readdirSync(directory).filter((name) => name.endsWith(".sql"))) {
    const relativePath = `supabase/migrations/${filename}`;
    const source = fs.readFileSync(path.join(directory, filename), "utf8");
    for (const match of source.matchAll(/insert into public\.consent_artifacts\s*\([\s\S]*?\)\s*select\s*([\s\S]*?)where not exists/gi)) {
      const values = [...match[1].matchAll(/'((?:''|[^'])*)'/g)]
        .map((item) => item[1].replace(/''/g, "'"))
        .filter((value) => wordCount(value) >= 8);
      const unique = [...new Set(values)];
      unique.slice(0, 2).forEach((text, index) => {
        blocks.push({
          path: relativePath,
          line: source.slice(0, match.index ?? 0).split("\n").length,
          text,
          role: "block",
          legal: true,
          legalSummary: index === 1,
          sentenceCap: index === 1,
        });
      });
    }
  }
  return blocks;
}

function replaceRegisteredTerms(text: string, jargon: JargonFile): string {
  let result = text;
  const terms = jargon.terms
    .flatMap((entry) => [entry.term, ...(entry.aliases ?? [])])
    .sort((left, right) => right.length - left.length);
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "gi"), "fact");
  }
  return result;
}

/**
 * Contractions read as their full words in the plain-vocabulary check, so a
 * mandated label such as "I don’t have one yet" is checked as "do not" and
 * the register never needs a non-word like "dont". Rules run in order; the
 * general `n’t` rule follows the three irregular negations.
 */
const CONTRACTION_EXPANSIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^can't$/, "cannot"],
  [/^won't$/, "will not"],
  [/^shan't$/, "shall not"],
  [/^([a-z]+)n't$/, "$1 not"],
  [/^i'm$/, "i am"],
  [/^let's$/, "let us"],
  [/^([a-z]+)'re$/, "$1 are"],
  [/^([a-z]+)'ve$/, "$1 have"],
  [/^([a-z]+)'ll$/, "$1 will"],
  [/^([a-z]+)'d$/, "$1 would"],
];

/**
 * The plain words a short string is checked against: contractions expand
 * (`don’t` → `do not`, `you’re` → `you are`); any other apostrophe, which is
 * a possessive, is dropped (`adult’s` → `adults`).
 */
export function vocabularyWords(value: string): string[] {
  return readabilityWords(value).flatMap((token) => {
    const word = token.toLowerCase().replace(/’/g, "'");
    for (const [pattern, expansion] of CONTRACTION_EXPANSIONS) {
      if (pattern.test(word)) return word.replace(pattern, expansion).split(" ");
    }
    return [word.replace(/'/g, "")];
  });
}

export function collectReadabilityBlocks(repositoryRoot: string): CopyBlock[] {
  return [
    ...extractTsxBlocks(repositoryRoot),
    ...extractCopyRegistryBlocks(repositoryRoot),
    ...extractTemplateBlocks(repositoryRoot),
    ...extractProviderBlocks(repositoryRoot),
    ...extractConsentArtifactBlocks(repositoryRoot),
  ];
}

function runSelfTest(repositoryRoot: string): string[] {
  const failures: string[] = [];
  const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
    devDependencies?: Record<string, string>;
  };
  if (packageJson.devDependencies?.[fixtures.package] !== fixtures.version) {
    failures.push(`${fixtures.package} must be pinned exactly to ${fixtures.version}`);
  }
  if (packageJson.devDependencies?.syllable !== "5.0.1") {
    failures.push("syllable must be pinned exactly to 5.0.1");
  }
  if (fixtures.cases.length < 10) failures.push("readability fixtures must contain at least ten cases");
  for (const fixture of fixtures.cases) {
    const difference = Math.abs(fleschKincaidGrade(fixture.text) - fixture.expectedGrade);
    if (difference > fixtures.tolerance) {
      failures.push(`${fixture.id}: scorer drift ${difference.toFixed(3)} exceeds ${fixtures.tolerance}`);
    }
  }
  return failures;
}

export function runReadabilityGate(repositoryRoot: string) {
  const vocabulary = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "data/plain-vocabulary.json"), "utf8"),
  ) as VocabularyFile;
  const jargon = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "data/jargon.json"), "utf8"),
  ) as JargonFile;
  const failures = runSelfTest(repositoryRoot);
  if (vocabulary.schemaVersion !== 1) failures.push("plain vocabulary schemaVersion must be 1");
  if (jargon.schemaVersion !== 1) failures.push("jargon schemaVersion must be 1");
  const sortedWords = [...new Set(vocabulary.words.map((word) => word.toLowerCase()))].sort();
  if (JSON.stringify(vocabulary.words) !== JSON.stringify(sortedWords)) {
    failures.push("plain vocabulary words must be lowercase, unique, and sorted");
  }
  const jargonTerms = jargon.terms.flatMap((entry) => [entry.term, ...(entry.aliases ?? [])]).map((term) => term.toLowerCase());
  if (new Set(jargonTerms).size !== jargonTerms.length) failures.push("jargon terms must be unique");
  if (jargonTerms.length < 200) failures.push("jargon register must contain at least 200 terms and aliases");
  for (const entry of jargon.terms) {
    if (!entry.term.trim() || wordCount(entry.definition) === 0 || wordCount(entry.definition) > 25) {
      failures.push(`${entry.term || "<empty>"}: jargon definition must contain 1–25 words`);
    }
  }

  const blocks = collectReadabilityBlocks(repositoryRoot);
  const allowed = new Set(vocabulary.words);
  let longCount = 0;
  let shortCount = 0;
  let sentenceCount = 0;
  const registryCount = blocks.filter((block) =>
    COPY_REGISTRY_ROOTS.some((root) => block.path.startsWith(`${root}/`) && block.path.endsWith(".ts")),
  ).length;
  for (const block of blocks) {
    const words = wordCount(block.text);
    if (words >= 15) {
      longCount++;
      const threshold = block.legalSummary ? 9 : block.legal ? 11 : 9;
      const grade = fleschKincaidGrade(replaceRegisteredTerms(block.text, jargon));
      if (grade > threshold + Number.EPSILON) {
        failures.push(
          `${block.path}:${block.line}: grade ${grade.toFixed(1)} exceeds ${threshold} (${block.text.slice(0, 90)})`,
        );
      }
      if (block.legalSummary && words > 150) {
        failures.push(`${block.path}:${block.line}: legal summary has ${words} words; maximum is 150`);
      }
    } else if (SHORT_ROLES.has(block.role)) {
      shortCount++;
      const lower = block.text.toLowerCase();
      for (const term of FORBIDDEN_SHORT_TERMS) {
        if (lower.includes(term)) {
          failures.push(`${block.path}:${block.line}: short ${block.role} must replace jargon '${term}' with plain words`);
        }
      }
      for (const word of vocabularyWords(block.text)) {
        if (!allowed.has(word) && word !== PLACEHOLDER) {
          failures.push(`${block.path}:${block.line}: short ${block.role} uses unregistered word '${word}' (${block.text})`);
        }
      }
    }
    if (block.sentenceCap) {
      sentenceCount++;
      for (const sentence of readabilitySentences(block.text)) {
        const count = wordCount(sentence);
        if (count > 25) {
          failures.push(`${block.path}:${block.line}: ${block.role} sentence has ${count} words; maximum is 25`);
        }
      }
    }
  }
  return {
    failures: [...new Set(failures)].sort(),
    blockCount: blocks.length,
    longCount,
    shortCount,
    sentenceCount,
    registryCount,
  };
}

async function main() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = runReadabilityGate(repositoryRoot);
  if (result.failures.length > 0) {
    console.error(`READABILITY GATE FAILED (${result.failures.length})`);
    for (const failure of result.failures.slice(0, 250)) console.error(`  - ${failure}`);
    if (result.failures.length > 250) {
      console.error(`  - ... ${result.failures.length - 250} additional findings`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `readability gate passed: ${result.blockCount} blocks, ${result.longCount} long, ` +
      `${result.shortCount} short-role, ${result.sentenceCount} sentence-capped, ` +
      `${result.registryCount} copy-registry`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void main();
}
