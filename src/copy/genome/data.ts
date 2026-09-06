/**
 * Expert-path copy: `/genome/[subject]/data` and its genome browser at
 * `/genome/[subject]/data/browser` (brief §7.3, §1.4–§1.6, §2.2, §7.6, X4).
 * Every user-visible string on both pages and in the embedded track lives
 * here, in one place: typographic apostrophes (U+2019), sentence case,
 * second person, grade ≤ 9, no sentence over 25 words.
 *
 * Export names carry the readability role (scripts/readability-gate.ts):
 * `*_H1`, `*_HEADING` and `TABLE_HEADINGS` are checked as headings,
 * `*_LABEL(S)` as labels, `*_BUTTON` as buttons, `*_NOTE` and `*Status` as
 * statuses with the 25-word sentence cap. Short roles use only words
 * registered in data/plain-vocabulary.json.
 *
 * Reused from src/copy/reports/strings.ts rather than respelled here:
 * DATA_AND_METHODS (the three entry links), GENOTYPE_LABEL (the genotype
 * figure's hidden label), COVERAGE_PILLS (the not-covered cell) and
 * FILES_DISAGREE (two files that differ at a position).
 */
import type { TraitTopic } from "@/lib/genome/search-guidance";

// ---------------------------------------------------------------------------
// The data page.
// ---------------------------------------------------------------------------

/** The third breadcrumb on both pages. */
export const DATA_CRUMB = "Data";

/** The page's h1 and document title: the same words as the three entry links. */
export const DATA_H1 = "Data and methods";

export const DATA_LEDE =
  "Look up any position in your file, see how much of each score panel it covers, or manage the files themselves.";

/** The two outline links under the lede. */
export const BROWSE_VARIANTS = "Open the genome browser";
export const MANAGE_FILES = "Manage your files";

export const SCORE_COVERAGE_HEADING = "Score panel coverage";
export const SCORE_COVERAGE_NO_FILE = "Add a file to see how much of each score panel it covers.";
export const SCORE_COVERAGE_NONE = "No score panels have been checked against this file yet.";
export function scoreInputLabel(index: number): string { return `File ${index}`; }

// ---------------------------------------------------------------------------
// The genome browser: heading, search and its states.
// ---------------------------------------------------------------------------

/** The h1, the last breadcrumb and the document title. */
export const BROWSER_H1 = "Genome browser";

export const BROWSER_NO_FILE = "Add a file to look up its positions here.";

/** The search box's accessible name and its example text. */
export const SEARCH_LABEL = "Search variants";
export const SEARCH_PLACEHOLDER = "rs762551 · CYP1A2 · chr20:1000000-1100000";
/** The one default-variant button on the page. */
export const SEARCH_BUTTON = "Search";

export const RESULTS_HEADING = "Results";
export const REGION_HEADING = "Region";

/** Column headers of the results table; the genotype column uses the report's own words. */
export const TABLE_HEADINGS = {
  variant: "Variant",
  position: "Position",
  gene: "Gene",
  genotype: "Your two letters",
} as const;

/** Stated once above the table, never inside a header. */
export const POSITIONS_BUILD = "Positions are on GRCh38.";
export const TABLE_INPUT_NOTE = "These are the files checked for the results table.";
export const TABLE_COVERAGE_NOTE = "This count is for the rows shown here. It is not a count of all positions in the gene or region.";
export const TRACK_INPUT_NOTE = "The region track uses the newest processed file. It can differ from the files behind the results table.";

/** Accessible name of the results claim block. */
export function resultsLabel(query: string): string {
  return `Results for ${query}`;
}

/** An rsID the reference knows but the file does not cover. */
export function rsidNotCovered(rsid: number, gene: string | null): string {
  return `Your file does not cover rs${rsid}${gene ? ` (${gene})` : ""}.`;
}

/** An rsID in neither the file nor the reference. */
export function rsidUnknown(rsid: number): string {
  return `rs${rsid} is not in your file and not in the reference store.`;
}

export const UNRECOGNIZED_CHROMOSOME = "Inherit does not know that chromosome name.";

/** A query that is neither an rsID, a locus, a known gene nor a trait word. */
export function noReferenceMatch(query: string): string {
  return `No reference variants known for “${query}”. Try an rsID (rs123…), a gene symbol (CYP1A2), or a position (chr15:74749576).`;
}

/** The link that follows the no-match sentence. */
export const OR_START_FROM_REPORTS = "Or start from your reports.";

/**
 * A hereditary-risk gene the reference deliberately leaves out. A silent
 * empty result would read as reassurance; this says what is going on.
 */
export function clinicalGeneStatus(gene: string): string {
  return `Inherit’s reference has no clinical variants for ${gene}. Consumer DNA chip files also cannot rule out inherited cancer risk. That needs a clinical genetic test. Finding nothing here does not mean you are safe.`;
}

/** The plain-English trait words a query can match, by topic id. */
export const TRAIT_TOPICS: Readonly<Record<TraitTopic, string>> = {
  "eye-color": "eye color",
  alcohol: "alcohol response",
  caffeine: "caffeine",
  sleep: "sleep",
  memory: "memory",
  lactose: "lactose tolerance",
  cilantro: "cilantro taste",
  earwax: "earwax",
  hair: "hair",
  "body-weight": "body weight",
  vitamins: "vitamin levels",
  nicotine: "smoking and nicotine",
  taste: "taste perception",
  muscle: "muscle and endurance",
};

export function lookingFor(topic: string): string {
  return `Looking for ${topic}? These reports cover it.`;
}

export const FULL_LIBRARY = "Browse the full report library";

/** Rendered under the table when the region row limit was reached; the limit is the page's constant, never retyped. */
export function resultsTruncated(limit: number): string {
  return `Only the first ${limit} positions are shown. Narrow the region to see the rest.`;
}

// ---------------------------------------------------------------------------
// The embedded track (src/components/browse/genome-browser.tsx).
// ---------------------------------------------------------------------------

/** Pinned by e2e/upload-vcf.spec.ts and e2e/genome-data.spec.ts; ships verbatim. */
export const FIRST_PARTY_NOTE =
  "This view uses only the DNA data stored in Inherit. It does not contact an outside genome service. The list of positions comes from this Inherit site.";

/** The track's name inside the browser. */
export const TRACK_NAME = "Your variants";

export const BROWSER_LOADING = "Loading the genome browser…";

export const BROWSER_FAILED =
  "The genome browser could not load. Your variants are still listed above.";

export const BROWSER_EMPTY_REGION =
  "Your file has no variants in this region, so the track above is empty. That reflects your file’s coverage, not an error.";

/**
 * Accessible names attached to the library's unlabelled controls after it
 * builds its DOM, and the region's own name.
 */
export const IGV_CONTROL_LABELS = {
  chromosome: "Chromosome",
  locusSearch: "Search by position",
  locusSubmit: "Go to position",
  zoomSlider: "Zoom level",
  zoomOut: "Zoom out",
  zoomIn: "Zoom in",
  region: "Interactive genome browser",
} as const;
