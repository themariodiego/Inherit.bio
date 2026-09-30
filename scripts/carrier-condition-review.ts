import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CarrierPanel } from "@/components/family/carrier-panel";
import type { HealthPictureColumn } from "@/components/family/health-picture-table";
import { CarrierPairCard, OneSidedCard } from "@/components/family/portrait/portrait-card";
import { UNNAMED_PERSON_LABEL } from "@/copy/family/index";
import { carrierNoProbabilitySentence } from "@/copy/family/health-picture";
import { NO_CLASSIFIED_POSITIONS, NO_POSITIONS_BOTH_COVER, noCarrierMatches } from "@/copy/family/portrait";
import { STATE_D } from "@/copy/overview";
import type { CarrierEvidence, CarrierMatch, CarrierReason, CarrierVariantReading } from "@/lib/family/carrier-pair";
import { autosomalCross } from "@/lib/family/mendel";
import type { OneSidedReading } from "@/lib/family/portrait";

/**
 * The owner's review note for one carrier condition
 * (`docs/carrier-condition-reviews/<GENE>.md`), which the activation through
 * `review_carrier_condition_v1` records as its reference.
 *
 * Everything in a note above its sign-off section is built here from the
 * pinned data (`data/ref/carrier/`) and from the real components, rendered
 * the way a person reads them. `carrier-condition-review.test.ts` builds each
 * note again and compares, so a note cannot describe counts, sources or
 * wording the product no longer has.
 */

// ---------------------------------------------------------------------------
// Rendering what a person reads
// ---------------------------------------------------------------------------

/** One reviewed assertion, with the fields a card prints. */
export interface ReviewExample {
  gene: string;
  variantName: string;
  classification: string;
  reviewStatus: string;
  reviewStars: number;
  lastEvaluated: string | null;
  variationId: number;
  /** How many reviewed changes the gene has: the "known" count. */
  known: number;
}

export const REVIEW_RELEASE = { releaseId: "clinvar-2026-09", geneValidityReadOn: "2026-09-28" } as const;

/** Numbers that differ from person to person are rendered as sentinels and printed as placeholders. */
const SENTINELS: readonly [number, string][] = [
  [9_999_991, "{how many of these changes both files cover}"],
  [9_999_992, "{how many reviewed positions both files cover}"],
];

const VIEWER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SELF = "11111111-1111-4111-8111-111111111111";
const COUNTERPART = "22222222-2222-4222-8222-222222222222";

function column(subjectId: string, accountId: string, label: string): HealthPictureColumn {
  return {
    subject: { id: subjectId, displayLabel: label, subjectClass: "self", routeSegment: `s-${subjectId}`,
      subjectAccountId: accountId, ownerAccountId: accountId },
    dataSubjectId: subjectId,
    displayLabel: label,
    files: null,
  };
}

/** The viewer and the other adult, as the Family pages chip them when the other has no name of their own. */
const PEOPLE: readonly [HealthPictureColumn, HealthPictureColumn] = [
  column(SELF, VIEWER, "You"),
  column(COUNTERPART, OTHER, UNNAMED_PERSON_LABEL),
];

const BLOCK_TAGS = "p|li|h1|h2|h3|h4|h5|h6|figcaption|summary|tr|dt|dd|section|article|ul|ol|div|figure|table|caption";
const CELL = "\u0001";

function decode(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function placeholders(text: string): string {
  let out = text;
  for (const [sentinel, placeholder] of SENTINELS) out = out.split(String(sentinel)).join(placeholder);
  return out;
}

/**
 * Rendered markup as a reader meets it: one line per block, in document
 * order. Decorative elements (`aria-hidden`) are left out. A tag beside a
 * name is printed in [brackets], a table row as cells split by `|`, and text
 * only a screen reader reads as `(read aloud only: …)`.
 */
export function textBlocks(html: string): string[] {
  let markup = html;
  // No rendered component nests one aria-hidden element inside another of
  // the same name, so the first matching close ends it.
  markup = markup.replace(/<(\w+)[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, "");
  markup = markup.replace(/<span[^>]*class="[^"]*\bsr-only\b[^"]*"[^>]*>([\s\S]*?)<\/span>/g, " (read aloud only: $1) ");
  markup = markup.replace(/<span[^>]*data-slot="subject-kind"[^>]*>([\s\S]*?)<\/span>/g, " [$1] ");
  markup = markup.replace(/<span[^>]*data-slot="carrier-person"[^>]*>/g, "\n");
  markup = markup.replace(/<t[dh]\b[^>]*>/g, CELL);
  markup = markup.replace(new RegExp(`<\\/?(?:${BLOCK_TAGS})\\b[^>]*>`, "g"), "\n");
  markup = markup.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, " ");
  return placeholders(decode(markup)).split("\n")
    .map((line) => line.includes(CELL)
      ? line.split(CELL).map((cell) => cell.replace(/\s+/g, " ").trim()).filter(Boolean).join(" | ")
      : line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

function evidence(example: ReviewExample): CarrierEvidence {
  return {
    variantName: example.variantName, reviewStatus: example.reviewStatus, reviewStars: example.reviewStars,
    lastEvaluated: example.lastEvaluated, penetranceClass: "unestablished", releaseId: REVIEW_RELEASE.releaseId,
    geneValidityReadOn: REVIEW_RELEASE.geneValidityReadOn, variationId: example.variationId,
  };
}

function reading(example: ReviewExample, copies: CarrierVariantReading["copies"], rsid = 1): CarrierVariantReading {
  return { rsid, classification: example.classification, genotype: "", copies, evidence: evidence(example) };
}

function pairMatch(example: ReviewExample, overrides: Partial<CarrierMatch> = {}): CarrierMatch {
  return {
    kind: "probability", probability: 0.25, cross: autosomalCross("autosomal_recessive", 1, 1), gene: example.gene,
    conditionId: "review", conditionName: "review", positionsBothCovered: true,
    a: { dataSubjectId: SELF, displayLabel: "You", variant: reading(example, "one copy") },
    b: { dataSubjectId: COUNTERPART, displayLabel: UNNAMED_PERSON_LABEL, variant: reading(example, "one copy") },
    ...overrides,
  } as CarrierMatch;
}

function portraitPair(example: ReviewExample, match: CarrierMatch): string[] {
  return textBlocks(renderToStaticMarkup(h(CarrierPairCard, {
    match, conditionMode: "autosomal_recessive", coverage: { known: example.known, covered: SENTINELS[0][0] },
    id: "review", people: PEOPLE, viewerAccountId: VIEWER,
  })));
}

function portraitOneSided(example: ReviewExample, kind: OneSidedReading["kind"]): string[] {
  const one: OneSidedReading = {
    kind, gene: example.gene, conditionId: "review", conditionName: "review",
    carrier: { dataSubjectId: SELF, displayLabel: "You", variant: reading(example, "one copy") },
    other: { dataSubjectId: COUNTERPART, displayLabel: UNNAMED_PERSON_LABEL },
    uncoveredRsid: kind === "not-covered" ? 1 : null,
    coverage: { known: example.known, covered: SENTINELS[0][0] },
  };
  return textBlocks(renderToStaticMarkup(h(OneSidedCard, { reading: one, people: PEOPLE, viewerAccountId: VIEWER })));
}

function healthPicture(example: ReviewExample, matches: readonly CarrierMatch[]): string[] {
  return textBlocks(renderToStaticMarkup(h(CarrierPanel, {
    groups: [{ key: "review", people: PEOPLE, matches, classifiedPositions: example.known,
      positionsBothCover: SENTINELS[1][0] }],
    viewerAccountId: VIEWER,
  })));
}

/** The refusals a reviewed recessive change can meet, and when each one shows. */
export const REVIEW_REFUSALS: readonly { reason: CarrierReason; heading: string; when: string }[] = [
  { reason: "two-copies", heading: "one file shows two copies",
    when: "One file shows two copies of a reviewed change and the other shows one." },
  { reason: "copies-unknown", heading: "one file cannot show how many copies",
    when: "One file reads the change but cannot show how many copies, such as a single-letter reading or a no-call." },
  { reason: "runs-above-threshold", heading: "one file is above the runs limit",
    when: "Both carry one copy, and one file has more long runs of matching letters than Inherit's limit." },
  { reason: "runs-unchecked", heading: "one file's runs could not be measured",
    when: "Both carry one copy, and one file's runs of matching letters were never measured." },
  { reason: "not-covered", heading: "one file does not cover the other's change",
    when: "Each file shows one copy of a different reviewed change in the gene, and one file does not report the other's position. The example uses the second most-reported change for the other adult." },
];

export interface ReviewScenarios {
  portraitBothCarry: string[];
  portraitNoSecondCopy: string[];
  portraitNotCovered: string[];
  portraitRefused: Record<string, string[]>;
  healthPictureBothCarry: string[];
  healthPictureNone: string[];
  /** The sentence that replaces the chance in a refused health picture block, by reason. */
  healthPictureRefused: Record<string, string>;
  portraitNone: { unavailable: string; noSharedPosition: string; noMatch: string };
  overviewLine: string;
}

/**
 * `second` is another reviewed change in the same gene: the other adult's
 * change where the two carry different ones.
 */
export function reviewScenarios(example: ReviewExample, second: ReviewExample): ReviewScenarios {
  const refused = (reason: CarrierReason) => reason === "not-covered"
    ? pairMatch(example, {
      kind: "no-probability", reason, positionsBothCovered: false, uncovered: { dataSubjectId: COUNTERPART, rsid: 1 },
      b: { dataSubjectId: COUNTERPART, displayLabel: UNNAMED_PERSON_LABEL, variant: reading(second, "one copy", 2) },
    } as Partial<CarrierMatch>)
    : pairMatch(example, {
      kind: "no-probability", reason, uncovered: null,
      a: { dataSubjectId: SELF, displayLabel: "You",
        variant: reading(example, reason === "two-copies" ? "two copies" : reason === "copies-unknown" ? "copies not shown" : "one copy") },
    } as Partial<CarrierMatch>);
  return {
    portraitBothCarry: portraitPair(example, pairMatch(example)),
    portraitNoSecondCopy: portraitOneSided(example, "no-second-copy"),
    portraitNotCovered: portraitOneSided(example, "not-covered"),
    portraitRefused: Object.fromEntries(REVIEW_REFUSALS.map(({ reason }) => [reason, portraitPair(example, refused(reason))])),
    healthPictureBothCarry: healthPicture(example, [pairMatch(example)]),
    healthPictureNone: healthPicture(example, []),
    healthPictureRefused: Object.fromEntries(REVIEW_REFUSALS.map(({ reason }) =>
      [reason, carrierNoProbabilitySentence(example.gene, reason)])),
    portraitNone: {
      unavailable: NO_CLASSIFIED_POSITIONS,
      noSharedPosition: NO_POSITIONS_BOTH_COVER,
      noMatch: placeholders(noCarrierMatches(SENTINELS[1][0])),
    },
    overviewLine: `${STATE_D.carrierMatches(1)} ${STATE_D.carrierMeaning}`,
  };
}

// ---------------------------------------------------------------------------
// The note
// ---------------------------------------------------------------------------

/** A row of `data/ref/carrier/conditions.json`. */
export interface ReviewCondition {
  conditionId: string;
  displayName: string;
  gene: string;
  inheritanceMode: string;
  acmgTable: string;
  clingen: { diseaseLabel: string; classification: string; moi: string; classifiedOn: string; gcep: string; url: string };
}

/** A row of `data/ref/carrier/clinvar-assertions.json`, by column name. */
export interface ReviewAssertion {
  variationId: number;
  name: string;
  classification: string;
  reviewStatus: string;
  stars: number;
  lastEvaluated: string | null;
  grch38: [number, number, string, string];
  grch38Equivalents: unknown[];
}

/** The ranking source: ClinVar's submitter count for one assertion, from the pinned release. */
export interface ReviewRanked {
  variationId: number;
  submitters: number;
}

export interface ReviewInput {
  condition: ReviewCondition;
  /** This condition's assertions only. */
  assertions: readonly ReviewAssertion[];
  /** The manifest's counts for this condition. */
  counts: { grch38Rows: number; imported: number; excluded: Record<string, number> };
  /** The ten most-submitted assertions, already ranked. */
  topTen: readonly ReviewRanked[];
  sources: { clinvarSha256: string; clingenSha256: string; clingenFileCreated: string };
}

export const SIGN_OFF_HEADING = "## Owner sign-off";

export function reviewNotePath(gene: string): string {
  return `docs/carrier-condition-reviews/${gene}.md`;
}

const STAR_LABELS: Record<number, string> = {
  4: "Four stars: practice guideline",
  3: "Three stars: reviewed by expert panel",
  2: "Two stars: criteria provided, multiple submitters, no conflicts",
};

/** In the order the importer tests them; a record is counted once, under the first test it fails. */
const EXCLUSION_LABELS: readonly [string, string][] = [
  ["not-pathogenic", "Not classified pathogenic or likely pathogenic"],
  ["not-germline", "Not a germline (inherited) classification"],
  ["conflicting", "Submitters disagree"],
  ["below-two-stars", "Fewer than two review stars"],
  ["condition-not-named", "The record does not name this condition"],
  ["no-grch38-key", "No GRCh38 chromosome position"],
  ["not-simple", "Not a single-letter change or a simple insertion or deletion"],
  ["not-left-aligned", "Not written in its leftmost form"],
  ["assembly-disagreement", "ClinVar's GRCh37 and GRCh38 placements disagree"],
  ["reference-mismatch", "The letters disagree with the reference sequence"],
];

const COMPLEMENT: Record<string, string> = { A: "T", T: "A", C: "G", G: "C" };
const LONG_DELETION = 50;

function thousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function fence(lines: readonly string[]): string {
  return ["```text", ...lines, "```"].join("\n");
}

/** Shape counts over one condition's assertions. */
export function assertionShapes(assertions: readonly ReviewAssertion[]) {
  const snvs = assertions.filter((row) => row.grch38[2].length === 1 && row.grch38[3].length === 1);
  const ambiguous = snvs.filter((row) => COMPLEMENT[row.grch38[2]] === row.grch38[3]);
  const insertions = assertions.filter((row) => row.grch38[2].length === 1 && row.grch38[3].length > 1);
  const deletions = assertions.filter((row) => row.grch38[2].length > 1 && row.grch38[3].length === 1);
  const deleted = deletions.map((row) => row.grch38[2].length - 1);
  return {
    snvs: snvs.length,
    ambiguous: ambiguous.length,
    arrayReadable: snvs.length - ambiguous.length,
    insertions: insertions.length,
    deletions: deletions.length,
    indels: insertions.length + deletions.length,
    withEquivalents: assertions.filter((row) => row.grch38Equivalents.length > 0).length,
    longDeletions: deleted.filter((length) => length > LONG_DELETION).length,
    longestDeletion: deleted.length ? Math.max(...deleted) : 0,
  };
}

function exampleFor(input: ReviewInput, rank = 0): ReviewExample {
  const top = input.assertions.find((row) => row.variationId === input.topTen[rank].variationId)!;
  return {
    gene: input.condition.gene, variantName: top.name, classification: top.classification,
    reviewStatus: top.reviewStatus, reviewStars: top.stars, lastEvaluated: top.lastEvaluated,
    variationId: top.variationId, known: input.assertions.length,
  };
}

/** The whole note, up to and including its sign-off section as first written. */
export function buildReviewNote(input: ReviewInput): string {
  const { condition, assertions, counts, topTen, sources } = input;
  const gene = condition.gene;
  const name = condition.displayName;
  const total = assertions.length;
  const shapes = assertionShapes(assertions);
  const example = exampleFor(input);
  const second = exampleFor(input, 1);
  const seen = reviewScenarios(example, second);
  const byId = new Map(assertions.map((row) => [row.variationId, row]));
  const countOf = (predicate: (row: ReviewAssertion) => boolean) => thousands(assertions.filter(predicate).length);
  const inheritance = condition.inheritanceMode === "autosomal_recessive" ? "Autosomal recessive" : condition.inheritanceMode;
  const excludedTotal = counts.grch38Rows - counts.imported;
  const lines: string[] = [];
  const push = (...more: string[]) => lines.push(...more);

  push(
    `# Carrier condition review: ${name} (${gene})`,
    "",
    `This note is the \`review_reference\` for activating \`${condition.conditionId}\` through`,
    "`review_carrier_condition_v1`, at registry revision 1, from release",
    `\`${REVIEW_RELEASE.releaseId}\`. It was prepared on 28 September 2026 for the owner, who is the named reviewer.`,
    "",
    "- The condition is imported inactive. Nobody sees a result for it until the owner signs the",
    "  checklist at the end and the activation runs with this file as its reference.",
    "- If a later import changes what ClinGen or ClinVar says about the condition, it becomes a new",
    "  revision and goes inactive again. It then needs a new review.",
    "- Everything above the sign-off section is built from the pinned data and the product's own",
    "  components (`scripts/carrier-condition-review.ts`). `scripts/carrier-condition-review.test.ts`",
    "  builds it again and fails if a count, a source or a word has changed.",
    "",
    "## The condition",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Condition | ${name} |`,
    `| MONDO id | ${condition.conditionId} |`,
    `| Gene | ${gene} |`,
    `| Inheritance | ${inheritance} |`,
    `| ClinGen classification | ${condition.clingen.classification}, for ${condition.clingen.moi === "AR" ? "autosomal recessive" : condition.clingen.moi} inheritance |`,
    `| ClinGen disease label | ${condition.clingen.diseaseLabel} |`,
    `| ClinGen date | ${condition.clingen.classifiedOn} |`,
    `| ClinGen panel | ${condition.clingen.gcep} |`,
    `| ClinGen record | ${condition.clingen.url} |`,
    `| ACMG practice resource | ${condition.acmgTable} |`,
    "| Penetrance | Not established: no range is cited, so every finding carries the brief's label |",
    "",
    "Sources, all pinned in `data/ref/carrier/manifest.json`:",
    "",
    `- ClinGen's gene–disease validity download, file dated ${sources.clingenFileCreated}, SHA-256 \`${sources.clingenSha256}\`.`,
    "- Gregg AR et al. Screening for autosomal recessive and X-linked conditions during pregnancy and",
    "  preconception: a practice resource of the ACMG. Genet Med 2021;23(10):1793-1806. PMID 34285390,",
    "  read 28 September 2026.",
    `- ClinVar's \`variant_summary\` for 2026-09, SHA-256 \`${sources.clinvarSha256}\`.`,
    "",
    "## What the release holds",
    "",
    `The release holds ${thousands(total)} assertions for ${name}. Each one is pathogenic or likely pathogenic, has two review`,
    "stars or more, has no conflict, and names this condition.",
    "",
    "| Assertions | Count |",
    "| --- | ---: |",
    `| All | ${thousands(total)} |`,
    ...[4, 3, 2].map((stars) => `| ${STAR_LABELS[stars]} | ${countOf((row) => row.stars === stars)} |`),
    ...["Pathogenic", "Likely pathogenic", "Pathogenic/Likely pathogenic"].map((value) =>
      `| Classified ${cell(value.toLowerCase())} | ${countOf((row) => row.classification === value)} |`),
    `| Single-letter changes | ${thousands(shapes.snvs)} |`,
    `| Insertions | ${thousands(shapes.insertions)} |`,
    `| Deletions | ${thousands(shapes.deletions)} |`,
    `| Insertions or deletions with other spellings listed | ${thousands(shapes.withEquivalents)} |`,
    "",
    "### What the release leaves out",
    "",
    `ClinVar's 2026-09 release has ${thousands(counts.grch38Rows)} GRCh38 records for ${gene}. ${thousands(counts.imported)} meet the bar and`,
    `${thousands(excludedTotal)} do not. Each record left out is counted once, under the first test it fails:`,
    "",
    "| Left out because | Records |",
    "| --- | ---: |",
    ...EXCLUSION_LABELS.filter(([reason]) => (counts.excluded[reason] ?? 0) > 0)
      .map(([reason, label]) => `| ${label} | ${thousands(counts.excluded[reason])} |`),
    "",
    "## The ten most-reported changes",
    "",
    "The pinned sources give no population frequency. So the changes are ranked by how many",
    "laboratories have submitted a classification to ClinVar (`NumberSubmitters` in the pinned",
    "release), then by review stars. This shows how often laboratories meet a change. It is not how",
    "common the change is.",
    "",
    "| Rank | ClinVar name | VariationID | Classification | Stars | Submitters | Last evaluated |",
    "| ---: | --- | ---: | --- | ---: | ---: | --- |",
    ...topTen.map((ranked, index) => {
      const row = byId.get(ranked.variationId)!;
      return `| ${index + 1} | ${cell(row.name)} | [${row.variationId}](https://www.ncbi.nlm.nih.gov/clinvar/variation/${row.variationId}/) | `
        + `${cell(row.classification)} | ${row.stars} | ${ranked.submitters} | ${row.lastEvaluated ?? "none recorded"} |`;
    }),
    "",
    "## What a person sees",
    "",
    "Where carrier results appear:",
    "",
    "- Only on the Family pages, and only between two adults who have both agreed to share. No page",
    "  shows one person their own carrier status on its own.",
    "- Portrait (`/family/portrait/[pairId]`) reads both adults' current prepared files. The health",
    "  picture (`/family/health-picture`) reads only older files, prepared before prepared uploads",
    "  existed. The Overview shows only a count of findings, linked to the health picture.",
    "- Partner results stay off in production, and Family stays closed everywhere (owner decision,",
    "  27 September 2026, `docs/protocol/decisions.md`). Until that changes, activating this",
    "  condition changes what the rule holds, not what anyone sees.",
    "",
    `The words below are rendered from the product's own components. They use the most-reported change,`,
    `VariationID ${example.variationId}, as the example. The reader is "You", and the other adult is`,
    `"${UNNAMED_PERSON_LABEL}", the label used when they have no name of their own.`,
    "",
    "- `{…}` marks a number that differs from pair to pair.",
    "- `[…]` is a small tag beside a name.",
    "- `(read aloud only: …)` is text only a screen reader reads.",
    "- The lines after \"See these numbers as a table\" show only when the person opens the table.",
    "",
    "### Portrait: both adults carry one copy of a change",
    "",
    `Shown when both files show one copy of a reviewed change in ${gene}, both files' runs of matching`,
    "letters were measured below the limit, and nothing else refuses the arithmetic.",
    "",
    fence(seen.portraitBothCarry),
    "",
    "### Portrait: one adult carries, and the other's file shows no copy",
    "",
    `Shown when one file shows one copy, and the other file reads at least one of ${gene}'s reviewed`,
    "positions and shows no change there.",
    "",
    fence(seen.portraitNoSecondCopy),
    "",
    "### Portrait: one adult carries, and the other's file does not cover the gene",
    "",
    `Shown when one file shows one copy, and the other file reads none of ${gene}'s reviewed positions.`,
    "",
    fence(seen.portraitNotCovered),
    "",
    "### Portrait: a carrier finding the arithmetic refuses",
    "",
    "Each of these replaces the chance with a named reason. None shows a number.",
    "",
    ...REVIEW_REFUSALS.flatMap(({ reason, heading, when }) => [
      `#### When ${heading}`,
      "",
      when,
      "",
      fence(seen.portraitRefused[reason]),
      "",
    ]),
    "### Health picture: both adults carry one copy of a change",
    "",
    "The carrier panel above the health picture's table. The \"What this check cannot tell you\" list",
    "and the runs source close the panel once, whatever it holds.",
    "",
    fence(seen.healthPictureBothCarry),
    "",
    "A refused finding on the health picture shows the same block with no chance, no \"1 in 4\" and no",
    "exactness line. This sentence stands in place of the chance, one per reason:",
    "",
    ...REVIEW_REFUSALS.flatMap(({ heading, reason }) => [`- When ${heading}:`, "", fence([seen.healthPictureRefused[reason]]), ""]),
    "### No finding",
    "",
    `A gene with no finding is not named at all when another gene has one: the pages list only genes`,
    `with a card. When nothing is found for either adult, the pages say:`,
    "",
    "Health picture, when the two files share reviewed positions and neither card applies:",
    "",
    fence(seen.healthPictureNone),
    "",
    "Portrait, one sentence in place of every card:",
    "",
    "- When the rule holds nothing, or the database cannot answer:",
    "",
    fence([seen.portraitNone.unavailable]),
    "",
    "- When the two files share no reviewed position:",
    "",
    fence([seen.portraitNone.noSharedPosition]),
    "",
    "- When they share positions and no card applies:",
    "",
    fence([seen.portraitNone.noMatch]),
    "",
    "Overview, only when a pair has at least one finding (with the count of findings):",
    "",
    fence([seen.overviewLine]),
    "",
    "## Known limits",
    "",
    `- **Arrays read single-letter changes only, and not all of them.** An array file is read only at a`,
    `  single-letter change whose two letters are not complements: ${thousands(shapes.arrayReadable)} of the ${thousands(total)}.`,
    "  Inherit holds no list of the positions each array tests, so it cannot say how many of those a",
    "  given array covers. A position an array does not test counts as not covered, never as no copy.",
    shapes.ambiguous > 0
      ? `- **Strand-ambiguous changes are never read from an array.** ${thousands(shapes.ambiguous)} of the single-letter changes swap A`
        + "\n  and T, or C and G. An array cannot show which strand it read, so these are read only from a VCF."
      : "- **Strand-ambiguous changes.** None of the single-letter changes here swaps A and T, or C and G.",
    `- **Insertions and deletions need a GRCh38 VCF that shows the change.** ${thousands(shapes.indels)} of the ${thousands(total)} are`,
    "  insertions or deletions.",
    "  - Arrays never read them.",
    "  - A GRCh37 VCF's insertions and deletions are not carried over to GRCh38, so they are not read.",
    "  - A GRCh38 VCF counts only when it writes the same change, or one of the other spellings",
    `    listed for ${thousands(shapes.withEquivalents)} of them.`,
    "  - A file that does not show the change never counts as covering it. So for these changes the",
    "    other adult's file reads as \"does not cover\", never as \"no second copy\".",
    shapes.deletions === 0
      ? "- **Long deletions.** The release holds no deletion for this condition."
      : shapes.longDeletions > 0
        ? `- **Long deletions.** ${thousands(shapes.longDeletions)} deletions remove more than ${LONG_DELETION} letters; the longest removes`
          + `\n  ${thousands(shapes.longestDeletion)}. They match only a VCF that writes out every removed letter. A file that records a`
          + "\n  large deletion as a symbolic allele (`<DEL>`) or a structural-variant record is not read."
        : `- **Long deletions.** No deletion here removes more than ${LONG_DELETION} letters; the longest removes ${thousands(shapes.longestDeletion)}.`,
    "- **A VCF rarely shows \"no copy\".** Most VCFs list only the positions where a person differs",
    "  from the reference. Inherit counts a VCF as covering a single-letter position only when the file",
    "  writes a row there: a change, or a reference call that carries an rsID. So when the other adult's",
    "  file is a VCF, Portrait most often says it cannot do the calculation, rather than that it found",
    "  no second copy.",
    `- **Only changes that meet the bar.** ${thousands(excludedTotal)} of ClinVar's ${thousands(counts.grch38Rows)} GRCh38 records for ${gene} are left`,
    "  out (table above). A person can carry a disease-causing change that no row here holds. So no",
    "  finding never means not a carrier, and no page says it does.",
    "- **Two copies, and runs of matching letters.** A file that shows two copies gets no chance, and",
    "  neither does a pair where a file's runs are above the limit or were never measured. Each card",
    "  names its reason (above).",
    "- **The per-pregnancy sentence is the brief's.** The health picture says \"For each pregnancy, about",
    "  25 in 100\", as the brief requires. FDA's rule for consumer carrier tests (21 CFR 866.5940)",
    "  requires a warning that the test says nothing about a newborn child's risk, and no wording can",
    "  satisfy both. The owner left that conflict to US counsel on 27 September 2026.",
  );
  if (gene === "CFTR") {
    push(
      "- **A separate own-genome report.** `cystic-fibrosis-cftr-f508del-informational` reads F508del",
      "  on a person's own file. It is a report template, not this rule, and activating this condition",
      "  does not change it. It was reworded on 28 September 2026 (#242).",
    );
  }
  push(
    "",
    SIGN_OFF_HEADING,
    "",
    "The owner ticks every box, then records the review through the activation. The activation's",
    `reference is this file, \`${reviewNotePath(gene)}\`.`,
    "",
    `- [ ] I opened the ClinGen record above. It rates ${gene} and ${condition.clingen.diseaseLabel} ${condition.clingen.classification}`,
    `      for autosomal recessive inheritance, dated ${condition.clingen.classifiedOn}.`,
    `- [ ] The ACMG practice resource lists this condition in ${condition.acmgTable}.`,
    "- [ ] The counts and the ten most-reported changes look right. I checked at least three of the",
    "      ten on ClinVar through the links above.",
    "- [ ] I accept the words above for a carrier finding and for no finding, including the",
    "      laboratory, penetrance and attribution lines.",
    "- [ ] I accept the known limits above for this condition.",
    "- [ ] Severity to record (ADR 0034 asks for this judgement; for a recessive condition it gates",
    "      nothing): `serious` or `not_serious`: ____________",
    `- [ ] I activate ${name} (${condition.conditionId}) at registry revision 1, from release`,
    `      \`${REVIEW_RELEASE.releaseId}\`.`,
    "",
    "Reviewer: <OWNER NAME> · Role: <ROLE> · Date: ____________",
    "",
  );
  return lines.join("\n");
}

/** The part of a note the check compares: everything before the owner's own section. */
export function reviewedPart(note: string): string {
  const at = note.indexOf(`\n${SIGN_OFF_HEADING}\n`);
  return at === -1 ? note : note.slice(0, at);
}

/** The ranked rows a note lists, read back from its table. */
export function rankedFromNote(note: string): ReviewRanked[] {
  return [...note.matchAll(/^\| (\d+) \| .+? \| \[(\d+)\]\(https:\/\/www\.ncbi\.nlm\.nih\.gov\/clinvar\/variation\/\2\/\) \| .+? \| \d \| (\d+) \| .+? \|$/gm)]
    .map((match) => ({ variationId: Number(match[2]), submitters: Number(match[3]) }));
}
