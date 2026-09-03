import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fixtures from "./readability-fixtures.json";
import {
  collectReadabilityBlocks,
  extractCopyRegistryBlocksFromSource,
  extractTsxBlocksFromSource,
  runReadabilityGate,
  vocabularyWords,
} from "./readability-gate";

describe("readability copy extraction", () => {
  it("scores nested copy containers separately instead of inventing a composite block", () => {
    const blocks = extractTsxBlocksFromSource(
      "src/example.tsx",
      `<div role="status"><h2>Invitation requested</h2><p>We will send an invitation if this address can receive one.</p></div>`,
    );

    expect(blocks.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: "heading", text: "Invitation requested" },
      { role: "block", text: "We will send an invitation if this address can receive one." },
    ]);
  });

  it("keeps inline markup inside the string block", () => {
    const blocks = extractTsxBlocksFromSource(
      "src/example.tsx",
      `<p>Your <strong>private</strong> data stays here.</p>`,
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("Your private data stays here.");
  });

  it("extracts visible text attributes independently", () => {
    const blocks = extractTsxBlocksFromSource(
      "src/example.tsx",
      `<img alt="A map of your results" title="Open the map" />`,
    );

    expect(blocks.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: "label", text: "A map of your results" },
      { role: "label", text: "Open the map" },
    ]);
  });

  it("keeps every displayed provider field within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const providerFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/providers/providers.json:"),
    );

    expect(providerFailures).toEqual([]);
  });

  it("keeps every lifestyle and wellness template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const lifestyleFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/lifestyle-wellness.json:"),
    );

    expect(lifestyleFailures).toEqual([]);
  });

  it("keeps every brain-health template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const brainHealthFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/brain-health.json:"),
    );

    expect(brainHealthFailures).toEqual([]);
  });

  it("keeps every gastrointestinal template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const gastrointestinalFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/gastrointestinal.json:"),
    );

    expect(gastrointestinalFailures).toEqual([]);
  });

  it("keeps every longevity template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const longevityFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/longevity.json:"),
    );

    expect(longevityFailures).toEqual([]);
  });

  it("keeps every mental-health template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const mentalHealthFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/mental-health.json:"),
    );

    expect(mentalHealthFailures).toEqual([]);
  });

  it("keeps every basic-traits template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const basicTraitsFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/basic-traits.json:"),
    );

    expect(basicTraitsFailures).toEqual([]);
  });

  it("keeps every addiction template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const addictionFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/addiction.json:"),
    );

    expect(addictionFailures).toEqual([]);
  });

  it("keeps every aesthetic-cosmetic template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const aestheticFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/aesthetic-cosmetic.json:"),
    );

    expect(aestheticFailures).toEqual([]);
  });

  it("keeps every heart-cardiovascular template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const heartFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/heart-cardiovascular.json:"),
    );

    expect(heartFailures).toEqual([]);
  });

  it("keeps the privacy policy within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const privacyFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("src/app/(marketing)/privacy/page.tsx:"),
    );

    expect(privacyFailures).toEqual([]);
  });

  it("keeps every environmental-sensitivity template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const environmentalFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/environmental-sensitivity.json:"),
    );

    expect(environmentalFailures).toEqual([]);
  });

  it("keeps every reproductive-family template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const reproductiveFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/reproductive-family.json:"),
    );

    expect(reproductiveFailures).toEqual([]);
  });

  it("keeps every metabolic-obesity template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const metabolicFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/metabolic-obesity.json:"),
    );

    expect(metabolicFailures).toEqual([]);
  });

  it("keeps every neurodegenerative template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const neurodegenerativeFailures = runReadabilityGate(repositoryRoot).failures.filter(
      (failure) => failure.startsWith("data/templates/neurodegenerative.json:"),
    );

    expect(neurodegenerativeFailures).toEqual([]);
  });

  it("keeps every autoimmune template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const autoimmuneFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/autoimmune.json:"),
    );

    expect(autoimmuneFailures).toEqual([]);
  });

  it("keeps the GINA explainer within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const ginaFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("src/app/(marketing)/legal/gina/page.tsx:"),
    );

    expect(ginaFailures).toEqual([]);
  });

  it("keeps the deceased-account policy within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const deceasedFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("src/app/(marketing)/legal/deceased/page.tsx:"),
    );

    expect(deceasedFailures).toEqual([]);
  });

  it("keeps the law-enforcement policy within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const lawEnforcementFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("src/app/(marketing)/legal/law-enforcement/page.tsx:"),
    );

    expect(lawEnforcementFailures).toEqual([]);
  });

  it("keeps the research-consent policy within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const researchConsentFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("src/app/(marketing)/legal/research-consent/page.tsx:"),
    );

    expect(researchConsentFailures).toEqual([]);
  });

  it("keeps the Copilot setup copy within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const copilotFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("src/app/(app)/copilot/[scope]/page.tsx:"),
    );

    expect(copilotFailures).toEqual([]);
  });

  it("keeps the appeals policy within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const appealsFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("src/app/(marketing)/legal/appeals/page.tsx:"),
    );

    expect(appealsFailures).toEqual([]);
  });

  it("keeps the Future Person Charter within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const futurePersonFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("src/app/(marketing)/legal/future-person/page.tsx:"),
    );

    expect(futurePersonFailures).toEqual([]);
  });

  it("keeps the GDPR status page within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const gdprFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("src/app/(marketing)/legal/gdpr/page.tsx:"),
    );

    expect(gdprFailures).toEqual([]);
  });

  it("keeps the incident-response policy within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const incidentFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("src/app/(marketing)/legal/incident-response/page.tsx:"),
    );

    expect(incidentFailures).toEqual([]);
  });

  it("keeps every cancer-risk template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const cancerRiskFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/cancer-risk.json:"),
    );

    expect(cancerRiskFailures).toEqual([]);
  });
});

// One deliberately dense sentence (21 words, no registered jargon) that no
// remediation should ever let through: it scores far above grade 9.
const DENSE_SENTENCE =
  "Comprehensive interpretation of these interconnected observations necessitates considerable methodological sophistication, " +
  "particularly regarding heterogeneous circumstances and idiosyncratic environmental contingencies encountered throughout adolescence.";

const REGISTRY_FIXTURE = [
  "export const SITE = {",
  '  heading: "Quokkafied results",',
  '  href: "https://example.com/results",',
  "  lede:",
  `    "${DENSE_SENTENCE}",`,
  "  more: (count: number) => `${count} more results to read`,",
  '  label: "I don’t have one yet",',
  "} as const;",
  "",
].join("\n");

const PAGE_FIXTURE = [
  "function Card({ description }: { description: string }) {",
  "  return <p>{description}</p>;",
  "}",
  "",
  "export default function Page({ count, name }: { count: number; name: string }) {",
  "  return (",
  "    <main>",
  "      <p>{`${count} reports to read first, all chosen for ${name}.`}</p>",
  "      <div>{`Sent to ${name} today`}</div>",
  '      <Card description="A short note about your file." />',
  `      <Card description="${DENSE_SENTENCE}" />`,
  '      <a href="https://example.com/help">Help</a>',
  "    </main>",
  "  );",
  "}",
  "",
].join("\n");

/**
 * A throwaway repository with the real scorer pins, vocabulary and jargon
 * register but only the fixture copy, so the gate's verdicts on it are
 * caused by the fixture strings alone.
 */
function createFixtureRepository(files: Record<string, string>): string {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "readability-gate-"));
  for (const directory of ["data/templates", "data/providers", "supabase/migrations"]) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  for (const file of ["package.json", "data/plain-vocabulary.json", "data/jargon.json"]) {
    fs.copyFileSync(path.join(repositoryRoot, file), path.join(root, file));
  }
  fs.writeFileSync(path.join(root, "data/providers/providers.json"), "[]\n");
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  return root;
}

describe("copy registry and runtime copy extraction", () => {
  let root = "";
  let failures: string[] = [];
  let blocks: ReturnType<typeof collectReadabilityBlocks> = [];

  beforeAll(() => {
    root = createFixtureRepository({
      "src/copy/site.ts": REGISTRY_FIXTURE,
      "src/app/page.tsx": PAGE_FIXTURE,
    });
    failures = runReadabilityGate(root).failures;
    blocks = collectReadabilityBlocks(root);
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("fails a heading key in an exported copy object that uses an unregistered word", () => {
    expect(failures).toContain(
      "src/copy/site.ts:2: short heading uses unregistered word 'quokkafied' (Quokkafied results)",
    );
  });

  it("fails a long block in a .ts copy file above grade 9 at the literal's own line", () => {
    expect(failures).toContainEqual(expect.stringMatching(/^src\/copy\/site\.ts:5: grade \d+\.\d exceeds 9 \(/));
  });

  it("scores template literals with each slot replaced by the placeholder word", () => {
    expect(blocks).toContainEqual(
      expect.objectContaining({
        path: "src/copy/site.ts",
        line: 6,
        role: "block",
        text: "fact more results to read",
      }),
    );
    expect(blocks).toContainEqual(
      expect.objectContaining({
        path: "src/app/page.tsx",
        line: 8,
        role: "block",
        text: "fact reports to read first, all chosen for fact.",
      }),
    );
    expect(blocks).toContainEqual(
      expect.objectContaining({
        path: "src/app/page.tsx",
        line: 9,
        role: "block",
        text: "Sent to fact today",
      }),
    );
  });

  it("ignores URL-only strings in the registry and in JSX", () => {
    expect(blocks.filter((block) => block.text.includes("example.com"))).toEqual([]);
    expect(failures.filter((failure) => failure.includes("example.com"))).toEqual([]);
  });

  it("scores a description prop string as a block", () => {
    expect(blocks).toContainEqual(
      expect.objectContaining({
        path: "src/app/page.tsx",
        line: 10,
        role: "block",
        text: "A short note about your file.",
      }),
    );
    expect(failures).toContainEqual(expect.stringMatching(/^src\/app\/page\.tsx:11: grade \d+\.\d exceeds 9 \(/));
  });

  it("infers roles from keys and export names and drops identifier values", () => {
    const registry = extractCopyRegistryBlocksFromSource(
      "src/copy/reports/headings.ts",
      [
        'export const REPORT_HEADINGS = ["What this is", "Your result"] as const;',
        'export const KIND_CHIPS = { self: "You", shared: "Shared with you" } as const;',
        'export const REPORT_HEADING_IDS = { "What this is": "what-this-is" };',
        'export const STATE = { emptyNote: "Nothing here yet.", steps: ["Checking the file"] };',
        'export function fileCount(n: number) { return n === 1 ? "1 file" : `${n} files`; }',
      ].join("\n"),
    );

    expect(registry.map(({ line, role, text, sentenceCap }) => ({ line, role, text, sentenceCap }))).toEqual([
      { line: 1, role: "heading", text: "What this is", sentenceCap: true },
      { line: 1, role: "heading", text: "Your result", sentenceCap: true },
      { line: 2, role: "label", text: "You", sentenceCap: false },
      { line: 2, role: "label", text: "Shared with you", sentenceCap: false },
      { line: 4, role: "status", text: "Nothing here yet.", sentenceCap: true },
      { line: 4, role: "block", text: "Checking the file", sentenceCap: false },
      { line: 5, role: "block", text: "1 file", sentenceCap: false },
      { line: 5, role: "block", text: "fact files", sentenceCap: false },
    ]);
  });

  it("scores a template literal in a scanned JSX attribute with the placeholder word", () => {
    const attributeBlocks = extractTsxBlocksFromSource(
      "src/example.tsx",
      "<Chart xLabel={`Age in ${unit}`} aria-label={`${title}, ${label}`} className={`p-4 ${extra}`} />",
    );

    expect(attributeBlocks.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: "label", text: "fact, fact" },
      { role: "label", text: "Age in fact" },
    ]);
  });

  it("expands contractions to their plain words and drops possessive apostrophes", () => {
    expect(vocabularyWords("I don’t have one yet")).toEqual(["i", "do", "not", "have", "one", "yet"]);
    expect(vocabularyWords("We can't and won't guess; it doesn't")).toEqual([
      "we", "cannot", "and", "will", "not", "guess", "it", "does", "not",
    ]);
    expect(vocabularyWords("We can’t and you’re")).toEqual(["we", "cannot", "and", "you", "are"]);
    expect(vocabularyWords("Show only what’s well supported")).toEqual(["show", "only", "what", "is", "well", "supported"]);
    expect(vocabularyWords("An adult’s file")).toEqual(["an", "adults", "file"]);
    expect(vocabularyWords("I’m sure they’ll, we’ve, let’s, she’d")).toEqual([
      "i", "am", "sure", "they", "will", "we", "have", "let", "us", "she", "would",
    ]);
    expect(vocabularyWords("Each adult’s reports")).toEqual(["each", "adults", "reports"]);
  });

  it("passes a short label whose only contraction expands to registered words", () => {
    expect(blocks).toContainEqual(
      expect.objectContaining({ path: "src/copy/site.ts", line: 7, role: "label", text: "I don’t have one yet" }),
    );
    expect(failures.filter((failure) => failure.startsWith("src/copy/site.ts:7:"))).toEqual([]);
    expect(failures.filter((failure) => failure.includes("'dont'"))).toEqual([]);
  });

  it("keeps the ten-case scorer self-test untouched", () => {
    expect(fixtures.cases).toHaveLength(10);
    expect(fixtures.tolerance).toBe(0.2);
    expect(failures.filter((failure) => /scorer drift|fixtures|pinned/.test(failure))).toEqual([]);
  });
});
