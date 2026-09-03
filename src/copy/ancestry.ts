/**
 * Ancestry surface copy (`/genome/[subject]/ancestry`) — every user-visible
 * string on the page in one place (brief §4.6, §4 §7.3–7.6, A.8, G4.4,
 * X16.5). Strings ship character-for-character: typographic apostrophes
 * (U+2019), the em dash (U+2014) where the brief mandates one, sentence
 * case, second person, grade ≤ 9. Strings quoted in the brief ship verbatim.
 *
 * Nothing numeric is retyped here. The lines that name the panel take the
 * constants from `src/lib/ancestry/panel.ts` as arguments, so the page passes
 * `PANEL` and `MIN_MARKERS` through and the client bundle never carries the
 * marker table those constants derive from. The band words a share falls in
 * live with the arithmetic that assigns them (`src/lib/ancestry/present.ts`).
 *
 * Export names carry the readability role: `*_HEADING` and `H1` are checked
 * as headings, `*_LABEL(S)` and `CHIP_*` as labels, `*_BUTTON` as buttons.
 */
import type { PANEL } from "@/lib/ancestry/panel";

/** The panel facts a sentence names: how many markers, and when it was built. */
export type PanelFacts = Pick<typeof PANEL, "markers" | "version">;

// ---------------------------------------------------------------------------
// Headings (six on the page, the X9 cap; nothing else is a heading).
// ---------------------------------------------------------------------------

export const H1 = "What your file supports";

/** The last breadcrumb and the document title's suffix; the same word the nav tile uses. */
export const SECTION_LABEL = "Ancestry";

export const REGIONS_HEADING = "Where DNA like yours is common today";

export const MOTHER_LINE_HEADING = "Mother’s line";

export const FATHER_LINE_HEADING = "Father’s line";

/** Brief §4.6 wording; the eyebrow above it is a paragraph, not a heading. */
export const NEANDERTHAL_HEADING = "How much of your DNA came from Neanderthals";

export const SOURCES_HEADING = "Where this comes from";

/** A `<p class="eyebrow">`: the word is a term of art and may not head a section. */
export const NEANDERTHAL_EYEBROW = "Neanderthal ancestry";

// ---------------------------------------------------------------------------
// The regions section: map, toggle, chips, table, panel.
// ---------------------------------------------------------------------------

/** Accessible name of the inline map. */
export const MAP_LABEL = "World map of five broad regions";

/** The map's caption and the table's caption: one sentence, the same words. */
export const MAP_CAPTION =
  "Five broad regions where DNA like yours is common today. Darker means a larger share.";

/** Brief §4.6, verbatim; default on. */
export const TOGGLE_LABEL = "Show only what’s well supported";

/** Brief §4.6: the two chips, each followed by an ancestry-share figure. */
export const CHIP_LABELS = {
  unassignable: "Not assignable to any region:",
  hidden: "Hidden as not well supported:",
} as const;

/** Table headers. The range is the share figure's own unit, so it has no column. */
export const COLUMN_LABELS = {
  region: "Region",
  share: "Share",
  band: "In words",
} as const;

export const CLOSE_BUTTON = "Close";

/**
 * Once per claim block, always visible (X13): no interval exists yet, and the
 * page says so instead of inventing one (G4.4).
 */
export const RANGE_UNAVAILABLE =
  "Inherit can’t put a range on these shares yet, so each one is a single number. When a range can be computed it will appear beside every share.";

/** Reference panel and version (G4.4), from the shipped constants. */
export function panelLine(panel: PanelFacts): string {
  return `Reference panel: ${panel.markers} ancestry markers from the Kidd and Seldin panels, with 1000 Genomes phase 3 frequencies. Panel built ${panel.version}.`;
}

/** Markers used of required (G4.4); the counts also render as a coverage figure beside it. */
export function markersLine(markersUsed: number, panel: PanelFacts, minMarkers: number): string {
  return `Your file supplied ${markersUsed} of the ${panel.markers} markers this needs. A map needs at least ${minMarkers}.`;
}

/** The ≤25-word gloss on "marker", rendered at its first use on the page (G1.10). */
export const MARKER_GLOSS =
  "A marker is one DNA position that differs between people and helps tell regions apart.";

/** The resolution limit in plain words (G4.4). */
export const RESOLUTION_LIMIT =
  "Five broad regions is the finest this panel can tell apart. It cannot place DNA within a region.";

/** Brief §4.6, verbatim; once in the block and once in the panel. */
export const IDENTITY =
  "An estimate of where DNA like yours is common today. It is not a statement about your identity, nationality, or family history.";

/** Why no segmented control renders: only the continental tier qualifies today. */
export const NO_SEGMENTED_CONTROL =
  "The map shows broad regions only. Your mother’s and father’s lines are below as text, because Inherit has no dated, sourced route for them yet.";

/** Why nothing smaller than a continent is shown: the true statement, not a licence-audit claim. */
export function subContinental(panel: PanelFacts): string {
  return `The ${panel.markers}-marker panel your file was compared with can only tell five broad regions apart. The map shows those and nothing smaller.`;
}

/** Brief §4 §7.4: neighbouring regions are genetically similar. */
export const SIMILAR_NEIGHBOURS =
  "Neighbouring regions in this panel are genetically similar; a percentage may move between them.";

/** One reference population of the selected region: its code and where it was sampled — a place, never a people. */
export function sampledLine(code: string, place: string): string {
  return `${code} — sampled in ${place}`;
}

// ---------------------------------------------------------------------------
// The grey state (below the reliability threshold).
// ---------------------------------------------------------------------------

/** Brief §4.6, verbatim, with the em dash. */
export function greyState(markersUsed: number, panel: PanelFacts): string {
  return `Your file covers only ${markersUsed} of ${panel.markers} ancestry markers — too few to draw a map. This is a limit of the file, not a result about you.`;
}

/** The `<summary>` of the raw-numbers disclosure (pinned by the GIAB E2E). */
export const RAW_NUMBERS_SUMMARY = "Show the unreliable raw numbers anyway";

export const NOISE = "Treat these as statistical noise, not as an estimate of your ancestry.";

/** No stored result for this subject yet (no file has been processed): the map stays grey and each card says so. */
export const NOTHING_READ = "Nothing to show until a file has been processed.";

// ---------------------------------------------------------------------------
// The lineage cards (§4 §7.5) and the Neanderthal card (§4.6).
// ---------------------------------------------------------------------------

/** The one mandated single-line sentence (§4 §7.5), for whichever parent line the card follows. */
export function lineageSentence(parent: "mother" | "father"): string {
  return `This traces one single line — your ${parent}’s ${parent}’s ${parent}, and so on. It says nothing about the rest of your ancestry. Ten generations back you have about 1,024 ancestors; this line is one of them.`;
}

/** Brief §2 §4.6: the lead of the father's-line card when the file has no Y data. */
export const NO_Y_LEAD =
  "Your file has no Y-chromosome data, so no father’s line can be read from it. This says nothing about who your father was.";

/** Plain-language gloss on the stored "XX genomes" note (pinned by the GIAB E2E). */
export const XX_GLOSS =
  "In plain terms: this is expected when the file comes from someone without a Y chromosome, e.g. most women.";

/** The true reason the card shows nothing yet; the capability is registered as withheld. */
export const NEANDERTHAL_BODY =
  "We can’t show this yet. Inherit has not yet built and licence-checked the marker list this needs, and we will not guess. This page will say so until that changes.";

/** Brief §4.6, verbatim. */
export const DENISOVAN =
  "Inherit does not estimate Denisovan ancestry yet, so this number is about Neanderthals only.";
