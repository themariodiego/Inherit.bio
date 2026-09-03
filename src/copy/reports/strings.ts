/**
 * Report-surface strings (brief §2 §4.3–4.5, §3 §2.2, §4 §1.3, §5 §1.6,
 * §5 §6.1, X7.2). Every string here is user copy: plain English, grade ≤ 9,
 * no sentence over 32 words, typographic apostrophes (U+2019). Strings in
 * double quotes in the brief ship character-for-character.
 */
import type { CategoryId } from "@/lib/genome/taxonomy";
import type { FindingLayer } from "@/lib/genome/taxonomy";
import { route } from "@/lib/primary-routes";

// ---------------------------------------------------------------------------
// Not-covered, no-call and disagreement states (§2 §4.5; split per X7.2).
// ---------------------------------------------------------------------------

export const NOT_COVERED_ARRAY =
  "Your file does not cover this position. Array files test a fixed set of positions, and this one isn’t on it. Inherit never guesses a genotype it hasn’t seen.";

export const NOT_COVERED_VCF =
  "Your file does not cover this variant. VCF files from clinical or targeted tests usually list only the positions where you differ from the reference (or only one region). So Inherit cannot tell ‘tested and normal’ apart from ‘not tested’ here, and it never guesses genotypes it hasn’t observed. If your lab can provide a gVCF or whole-genome file, more reports will resolve.";

export const NO_CALL =
  "Your file includes this position but the test could not read it confidently.";

export const LIMIT_OF_FILE = "This is a limit of your file, not a result about you.";

export const FILES_DISAGREE =
  "Your two files disagree about this position, so Inherit shows no result here.";

/** The one sentence rendered when the subject has no processed file. */
export const NO_FILE_YET = "Add a file to see a result here.";

// ---------------------------------------------------------------------------
// Fixed statements under the headings.
// ---------------------------------------------------------------------------

export const NOTHING_TO_DO =
  "There is nothing you need to do about this result. It does not change what any doctor would advise for you today.";

export const NOT_DIAGNOSTIC =
  "This is not a diagnosis. Inherit is not a doctor and no clinician has reviewed this. Talk to a qualified professional before acting on anything here.";

export const NO_RANGE_YET =
  "We can’t put a range on this yet, so we don’t show a single number.";

export const PROVENANCE_LINE =
  "Inherit did not produce this data. It came from a laboratory or a consumer testing company that Inherit has not audited.";

export const CONFIRMATION_BLOCK =
  "This is a reading of a file you uploaded, not a clinical test. Before acting on it, ask a doctor or genetic counsellor to confirm it in an accredited laboratory.";

/** Rendered after the confirmation block until data/counsellors/directory.json exists. */
export const COUNSELLOR_NO_ROUTE =
  "We don’t have a counsellor to point you to where you are. Your doctor can refer you.";

/**
 * "What this doesn’t mean" (D16: fewer claims, not more caveats). One generic
 * bullet on every report — true for traits and for conditions — and one more
 * only when a shown result has a position the file does not cover.
 */
export const WHAT_THIS_DOESNT_MEAN_GENERIC = "It does not say what will happen to you.";

export const WHAT_THIS_DOESNT_MEAN_NOT_COVERED = "A missing result is not a negative result.";

// ---------------------------------------------------------------------------
// Layer labels and definitions (§4 §1.3; X5.1). The definition is repeated
// verbatim wherever the layer name is used as a chip, count or group title.
// ---------------------------------------------------------------------------

export const LAYER_LABELS: Record<FindingLayer, string> = {
  variant_call: "Specific variants",
  estimate: "Statistical estimates",
};

export const LAYER_DEFINITIONS: Record<FindingLayer, string> = {
  variant_call:
    "A result about one or a few exact spots in your DNA, read against an outside clinical classification.",
  estimate:
    "A model that adds up small effects. It is an estimate, not a reading. Scientists call these polygenic scores.",
};

/** Count nouns per figure class, singular and plural (G4.3: counts are layer-labelled). */
export const COUNT_NOUNS = {
  "variant-call": { one: "specific-variant report", other: "specific-variant reports" },
  estimate: { one: "statistical estimate", other: "statistical estimates" },
} as const;

export const CANNOT_NUMBER_WHY = "Why?";

export function cannotNumberSentence(k: number): string {
  return `${k} of these reports cannot give you a number yet.`;
}

/** "{k} of these reports cannot give you a number yet. Why?" — the "Why?" links to CANNOT_NUMBER_HREF. */
export function cannotNumberLine(k: number): string {
  return `${cannotNumberSentence(k)} ${CANNOT_NUMBER_WHY}`;
}

/** The science page's polygenic section, built from its route id. */
export const CANNOT_NUMBER_HREF = route("science.index", { hash: "polygenic" });

export function coverageSentence(x: number, y: number): string {
  return `Your file covered ${x} of the ${y} positions this estimate uses.`;
}

export function supportingStudies(n: number): string {
  return n === 1 ? "1 supporting study" : `${n} supporting studies`;
}

// ---------------------------------------------------------------------------
// Category descriptions: one sentence each, ≤15 words, plain words only.
// ---------------------------------------------------------------------------

export const CATEGORY_DESCRIPTIONS: Record<CategoryId, string> = {
  "everyday-traits": "Things like taste, sleep and muscle type that vary from person to person.",
  "food-drink-metabolism": "How your body handles what you eat and drink, from caffeine to milk.",
  "heart-circulation": "Your heart, your blood vessels and the fats and sugar carried in your blood.",
  "immune-allergies": "How your body fights germs and why it may react to harmless things.",
  medicines: "How your body may respond to some common medicines.",
  "brain-memory-mood": "Thinking, memory, mood and habits, and how they may change with age.",
  cancer: "Common DNA changes linked to a higher or lower chance of some cancers.",
  "having-children": "Trying for a baby, pregnancy and what a parent may pass to a child.",
  "ageing-longevity": "How long people tend to live and how the body changes with age.",
};

// ---------------------------------------------------------------------------
// Chrome: chips, links, pills and counts.
// ---------------------------------------------------------------------------

export const DATA_AND_METHODS = "Data and methods";
export const ASK_ABOUT_THIS = "Ask about this";
export const ALL_REPORTS = "← All reports";
export const ADD_A_FILE = "Add a file";
export const MORE_SOURCES = "More sources";
/** The reports list: the collapsed category strip and the search box above it. */
export const FILTER_REPORTS = "Filter reports";
export const SEARCH_REPORTS_LABEL = "Search reports by title, gene, or category";
export const NO_SEARCH_MATCHES = "No reports match your search.";
/** The h3 above the citations in "Where this comes from". */
export const SOURCES_HEADING = "Sources";
export const TECHNICAL_NOTE = "Technical note";
export const REPORTS_TITLE = "Reports";

export function fileCount(n: number): string {
  return n === 1 ? "1 file" : `${n} files`;
}

/** Kept as FILE_COUNT for the canonical name; identical to fileCount. */
export const FILE_COUNT = fileCount;

export function showAll(n: number): string {
  return `Show all ${n}`;
}

export const KIND_CHIPS = {
  self: "You",
  adult_shared: "Shared with you",
  adult_uploaded: "Uploaded with their permission",
  embryo: "Embryo",
  example: "Example",
} as const;

export type KindChip = keyof typeof KIND_CHIPS;

export const COVERAGE_PILLS = {
  covered: "Covered by your file",
  "not-covered": "Not covered by your file",
  awaiting: "Awaiting your data",
} as const;

/** The strand-flip technical note, collapsible under the genotype. */
export const STRAND_FLIP_NOTE =
  "Your file reports this spot on the opposite DNA strand. Inherit matched the letters to the report without guessing, because the two strands cannot be confused here.";

/** The unrecognised-genotype technical note (A14): the mismatch is logged, never reinterpreted. */
export const UNRECOGNIZED_NOTE =
  "The letters your file shows at this spot are not ones this report expects, so Inherit shows no result rather than guess.";

export const GENOTYPE_LABEL = "Your two letters at this spot";

/** Reports list, no processed file. */
export const LIST_NO_FILE = "Add a file to see which reports it covers.";

/** The reports library has not been seeded. */
export const LIBRARY_EMPTY = "The report library has not been seeded on this deployment yet.";

/**
 * The Medicines category has no report (X15: an absent category is stated,
 * never silent). Three sentences, no promise: how a body handles a medicine
 * depends on more than one DNA position, and Inherit reads one at a time.
 */
export const MEDICINES_ABSENT =
  "Inherit does not offer reports about medicines. How a body handles a medicine depends on more than one DNA position. A report built from one position would say less than it seems to.";
