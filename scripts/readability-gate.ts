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
]);
const FORBIDDEN_SHORT_TERMS = new Set([
  "allele",
  "call rate",
  "coverage fraction",
  "liftover status",
  "percentile",
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

function sourceLine(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function tagName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText();
}

function attributeValue(node: ts.JsxOpeningLikeElement, name: string): string | undefined {
  const attribute = node.attributes.properties.find(
    (item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText() === name,
  );
  if (!attribute?.initializer) return undefined;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression &&
    (ts.isStringLiteral(attribute.initializer.expression) ||
      ts.isNoSubstitutionTemplateLiteral(attribute.initializer.expression))
  ) {
    return attribute.initializer.expression.text;
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
    role === "status" ||
    role === "alert"
  );
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

export function vocabularyWords(value: string): string[] {
  return readabilityWords(value).map((word) => word.toLowerCase().replace(/[’']/g, ""));
}

export function collectReadabilityBlocks(repositoryRoot: string): CopyBlock[] {
  return [
    ...extractTsxBlocks(repositoryRoot),
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
    } else if (["heading", "button", "th", "label", "status"].includes(block.role)) {
      shortCount++;
      const lower = block.text.toLowerCase();
      for (const term of FORBIDDEN_SHORT_TERMS) {
        if (lower.includes(term)) {
          failures.push(`${block.path}:${block.line}: short ${block.role} must replace jargon '${term}' with plain words`);
        }
      }
      for (const word of vocabularyWords(block.text)) {
        if (!allowed.has(word) && word !== "fact") {
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
      `${result.shortCount} short-role, ${result.sentenceCount} sentence-capped`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void main();
}
