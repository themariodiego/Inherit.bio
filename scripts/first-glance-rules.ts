// The G3.5 rules, in one place so the gate and the browser proof cannot
// disagree. `scripts/first-glance-gate.ts` runs them over every committed
// heading; `e2e/first-glance.spec.ts` runs the same functions over the heading
// the page actually rendered. Two copies of this would let one pass while the
// other described a different string.
import fs from "node:fs";
import path from "node:path";
import { reportNameOf } from "../src/lib/genome/reports";

const TEMPLATE_DIRECTORY = "data/templates";
export const MAX_WORDS = 12;

type JargonEntry = { term: string; aliases?: string[]; definition: string };

/**
 * Terms and aliases together, longest first so a report names the longest
 * match rather than a fragment of it. The brief keeps this list and
 * `data/plain-vocabulary.json` separate on purpose: adding a word to the
 * vocabulary never removes its jargon restriction, and ADR 0012 records that
 * the register stays above the 200-entry floor at 203 terms and aliases.
 */
export function jargonTerms(): string[] {
  const entries = JSON.parse(fs.readFileSync("data/jargon.json", "utf8")).terms as JargonEntry[];
  const all = entries.flatMap(entry => [entry.term, ...(entry.aliases ?? [])]);
  return [...new Set(all.map(term => term.toLowerCase()))].sort((a, b) => b.length - a.length);
}

/**
 * A numeric figure is a quantity making a claim, not any character that
 * happens to be a digit. The distinction is the whole difficulty here, and
 * getting it wrong is not a small matter: a rule that flags every digit
 * reports "Type 1 diabetes", "TP53 codon 72 (Pro72Arg)", "Omega-3/6 fatty acid
 * conversion" and "Clopidogrel, the *2 position" — twelve headings, every one
 * a name or an allele designation, not one of them a figure. A gate that cries
 * wolf on a disease name gets switched off.
 *
 * So a figure is a number that carries magnitude: a decimal, a number bound to
 * a percent, per-mille or multiplier sign, a natural-frequency "N in M", or a
 * number followed by a unit word. A bare integer inside a name is not one.
 */
const FIGURE_PATTERNS: [RegExp, string][] = [
  [/(?<![A-Za-z0-9.])\d+\.\d+/, "a decimal figure"],
  [/(?<![A-Za-z0-9])\d[\d,]*\s?(?:%|‰|×)/, "a figure with a percent or multiplier sign"],
  [/(?<![A-Za-z0-9])\d[\d,]*\s?x(?![A-Za-z0-9])/i, "a figure with a multiplier"],
  [/(?<![A-Za-z0-9])\d[\d,]*\s+in\s+\d[\d,]*(?![A-Za-z0-9])/i, "a natural-frequency figure"],
  [/(?<![A-Za-z0-9])\d[\d,]*\s?(?:fold|times|years?|months?|weeks?|days?|hours?|mg|kg|ml|cm|mm)(?![A-Za-z0-9])/i,
    "a figure with a unit"],
];

function words(heading: string): string[] {
  return heading.trim().split(/\s+/).filter(word => word.length > 0);
}

export function headingFailures(source: string, heading: string, jargon: readonly string[]): string[] {
  const failures: string[] = [];
  const count = words(heading).length;
  if (count > MAX_WORDS) {
    failures.push(`${source}: ${count} words, over ${MAX_WORDS} — "${heading}"`);
  }
  const lower = heading.toLowerCase();
  for (const term of jargon) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(lower)) {
      failures.push(`${source}: jargon term "${term}" — "${heading}"`);
      break; // One report per heading; the longest match names the problem.
    }
  }
  for (const [pattern, label] of FIGURE_PATTERNS) {
    const match = pattern.exec(heading);
    if (match) {
      // Deliberately a failure rather than a check of the surrounding block.
      // The brief requires the unit and the comparison baseline beside the
      // figure, and this gate reads strings, not layout. No heading carries
      // one today, so a new one should stop and be decided rather than be
      // waved through by a rule that cannot see the block.
      failures.push(`${source}: ${label} "${match[0].trim()}" in a heading — `
        + `G3.5 needs its unit and comparison baseline in the same visual block — "${heading}"`);
      break;
    }
  }
  return failures;
}

/**
 * Result surfaces whose heading is a copy constant. Not every `<h1>` in the
 * app: Settings, My files and the domain landings are not result pages, and
 * G3.5 is a rule about the page that shows someone a finding.
 */
const COPY_HEADINGS: readonly [string, string][] = [
  ["src/copy/ancestry.ts", "H1"],
  ["src/copy/family/portrait.ts", "PORTRAIT_H1"],
  ["src/copy/family/health-picture.ts", "HEALTH_PICTURE_H1"],
  ["src/copy/embryos/compare.ts", "COMPARE_H1"],
  ["src/copy/genome/data.ts", "DATA_H1"],
  ["src/copy/genome/data.ts", "BROWSER_H1"],
];

/** Every result heading the product commits, with where it came from. */
export function resultHeadings(): { source: string; heading: string }[] {
  const headings: { source: string; heading: string }[] = [];
  for (const name of fs.readdirSync(TEMPLATE_DIRECTORY).sort()) {
    if (!name.endsWith(".json")) continue;
    const templates = JSON.parse(
      fs.readFileSync(path.join(TEMPLATE_DIRECTORY, name), "utf8")) as { slug: string; title: string }[];
    for (const template of templates) {
      // Generated end-to-end fixtures are not product copy.
      if (template.slug.startsWith("auto-e2e-")) continue;
      headings.push({ source: `${name}:${template.slug}`, heading: reportNameOf(template.title) });
    }
  }
  // Result surfaces that name their heading in copy rather than in a template.
  // Read from source, never retyped, so renaming one fails here instead of
  // drifting. The report catalogue alone is not "every result page": these six
  // were outside the gate until a check of `<h1>` across `src/app/(app)` found
  // them, which is why the list is declared rather than inferred — a surface
  // that renders a result has to be named here to be covered.
  for (const [file, constant] of COPY_HEADINGS) {
    const source = fs.readFileSync(file, "utf8");
    const found = new RegExp(`export const ${constant} = "([^"]+)"`).exec(source);
    if (!found) throw new Error(`${file} no longer exports ${constant} for the first-glance gate to check`);
    headings.push({ source: `${file}:${constant}`, heading: found[1]! });
  }
  return headings;
}

