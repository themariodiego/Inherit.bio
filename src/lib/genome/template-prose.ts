/**
 * Prose rules for report templates (brief §4 §2.4 and G3.5), shared by
 * scripts/validate-templates.ts and its tests. Pure functions over text.
 *
 * Naked relative figure (§2.4): a `%`, `x`, `×` or `-fold` token within 40
 * characters of "lower", "higher", "reduction", "increase", "less likely",
 * "more likely" or "times" in the same text. Template prose is plain text
 * with no <RelativeFigure> ancestor, so every such adjacency is a finding.
 * Inherit also treats any numeric multiplier as a ratio wherever it stands
 * ("about 1.4 times the odds", "1.3x the odds", "1.7-fold"), because §2.4
 * bans the odds ratio itself, not only its symbols next to a comparison word.
 *
 * First-glance title (G3.5): at most 12 words, no term or alias from
 * data/jargon.json, and no bare numeric figure. Identifiers that contain
 * digits (rs2981582, 8q24, F508del, HLA-DQ2.5) are labels, not figures.
 */

export const RELATIVE_ANCHORS = [
  "lower",
  "higher",
  "reduction",
  "increase",
  "less likely",
  "more likely",
  "times",
] as const;

export const ADJACENCY_WINDOW = 40;

export const TITLE_WORD_LIMIT = 12;

export interface ProseFinding {
  rule: "naked-relative" | "worded-ratio" | "title-words" | "title-jargon" | "title-figure";
  detail: string;
}

interface Span {
  start: number;
  end: number;
  text: string;
}

function spans(text: string, pattern: RegExp): Span[] {
  const found: Span[] = [];
  for (const match of text.matchAll(pattern)) {
    found.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
  }
  return found;
}

/** `%` anywhere; `x`/`×` only when a digit precedes them; `-fold` as a suffix. */
const RELATIVE_SYMBOL = /\d\s*[x×](?![a-z])|%|-fold\b/gi;
const ANCHOR = new RegExp(
  `\\b(?:${RELATIVE_ANCHORS.map((a) => a.replace(" ", "\\s+")).join("|")})\\b`,
  "gi",
);
/** A numeric multiplier is a ratio wherever it stands: "1.4x the odds", "2× more", "about 5 to 7 times", "1.7-fold". */
const WORDED_RATIO = /\b\d+(?:\.\d+)?(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?\s*(?:[x×](?![a-z])|times\b|-?fold\b)/gi;

export function nakedRelativeFindings(text: string): ProseFinding[] {
  const findings: ProseFinding[] = [];
  const tokens = spans(text, RELATIVE_SYMBOL);
  const anchors = spans(text, ANCHOR);
  for (const token of tokens) {
    const near = anchors.find(
      (anchor) => anchor.start <= token.end + ADJACENCY_WINDOW && token.start <= anchor.end + ADJACENCY_WINDOW,
    );
    if (near) {
      const from = Math.max(0, Math.min(token.start, near.start) - 20);
      const to = Math.min(text.length, Math.max(token.end, near.end) + 20);
      findings.push({
        rule: "naked-relative",
        detail: `"${token.text.trim()}" within ${ADJACENCY_WINDOW} characters of "${near.text}": …${text.slice(from, to)}…`,
      });
    }
  }
  for (const ratio of spans(text, WORDED_RATIO)) {
    const from = Math.max(0, ratio.start - 20);
    const to = Math.min(text.length, ratio.end + 30);
    findings.push({ rule: "worded-ratio", detail: `"${ratio.text}": …${text.slice(from, to)}…` });
  }
  return findings;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function jargonMatches(text: string, terms: readonly string[]): string[] {
  const hits: string[] = [];
  for (const term of terms) {
    const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(term)}(?![A-Za-z0-9])`, "i");
    if (pattern.test(text)) hits.push(term);
  }
  return hits;
}

/**
 * A figure is a number that carries a quantity: a decimal, a percentage, a
 * multiplier, or an integer followed by a quantity word. An integer inside a
 * name ("Type 1 diabetes", "codon 72", "HLA-DRB1*15:01") is not a figure.
 */
const BARE_FIGURE =
  /(?<![A-Za-z0-9.:*/-])\d+(?:(?:[.,]\d+)|\s*(?:%|x|×)|\s+(?:times|fold|in|per|out of|higher|lower|more|less|greater|fewer|years?|months?|days?|kg|mg|cm|copies|people))(?![A-Za-z0-9.:*/-])/i;

export function titleFindings(title: string, jargonTerms: readonly string[]): ProseFinding[] {
  const findings: ProseFinding[] = [];
  const words = title.trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
  if (words.length > TITLE_WORD_LIMIT) {
    findings.push({ rule: "title-words", detail: `${words.length} words; the limit is ${TITLE_WORD_LIMIT}` });
  }
  const jargon = jargonMatches(title, jargonTerms);
  if (jargon.length > 0) {
    findings.push({ rule: "title-jargon", detail: `uses registered jargon: ${jargon.join(", ")}` });
  }
  if (BARE_FIGURE.test(title)) {
    findings.push({ rule: "title-figure", detail: "contains a bare numeric figure" });
  }
  return findings;
}

/** Every term and alias in data/jargon.json, lower-cased. */
export function jargonTermList(jargon: { terms: { term: string; aliases?: string[] }[] }): string[] {
  return jargon.terms.flatMap((entry) => [entry.term, ...(entry.aliases ?? [])]).map((t) => t.toLowerCase());
}
