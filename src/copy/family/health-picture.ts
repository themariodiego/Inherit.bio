/**
 * `/family/health-picture` — two or more adults side by side, and the one
 * carrier-pair panel above the table (design §2.3; brief §5 §5.5-§5.6,
 * §3 §8.4, G4.5, X13). Every user-visible string of that page lives here.
 *
 * Export names carry the readability role (scripts/readability-gate.ts):
 * `*_HEADING` reads as a heading, `*_LABEL` as a label, `*_BUTTON` as a
 * button, `*_STATUS` as a status. Short roles use only words registered in
 * data/plain-vocabulary.json and never a term from data/jargon.json — which
 * is why the section about changes two people share is headed "A change you
 * both carry" rather than by the word for it.
 *
 * The strings the brief quotes ship character-for-character, with U+2019
 * apostrophes and U+2014 dashes. Strings shared with another surface are
 * re-exported from their one home rather than respelled.
 */
import { REPORT_HEADINGS } from "@/copy/reports/headings";
import {
  COUNSELLOR_NO_ROUTE,
  LAYER_DEFINITIONS,
  LAYER_LABELS,
  NOT_DIAGNOSTIC,
  NO_RANGE_YET,
  PROVENANCE_LINE,
} from "@/copy/reports/strings";
import { BASELINE_ABSENT } from "./person";
import type { CarrierReason } from "@/lib/family/carrier-pair";

/** The h1 and the document title. */
export const HEALTH_PICTURE_H1 = "Family health picture";

/**
 * The section of changes both people carry (brief line 346). The word for a
 * person who carries a change is jargon and may not head a section, so the
 * heading says what the section holds in plain words.
 */
export const CARRIER_MATCHES_HEADING = "A change you both carry";

/** The anchor the Overview line and the panel share. */
export const CARRIER_MATCHES_ID = "carrier-matches";

/** The table section. */
export const SIDE_BY_SIDE_HEADING = "Side by side";

/** The last two sections, from the one home of the six report headings. */
export const HOW_SURE_HEADING = REPORT_HEADINGS[3];
export const WHERE_FROM_HEADING = REPORT_HEADINGS[5];

// ---------------------------------------------------------------------------
// The banner and the trade-off panel (brief line 344; G4.5, §9 item 19).
// ---------------------------------------------------------------------------

/**
 * Character-for-character (brief line 344). Non-collapsible, above the
 * table. "baselines" carries its definition on first occurrence.
 */
export const COMPARISON_BANNER =
  "These are different people compared against different baselines. A bigger number in one column does not mean that person is worse off.";

/** The word the banner defines on its first occurrence (X4 retained terms). */
export const BASELINE_TERM_TEXT = "baselines";

/** The accessible name of the trade-off panel; the panel adds no heading. */
export const TRADE_OFF_PANEL_LABEL = "What this page does not do";

/** The joint-selection sentence, written for adults (G4.5). */
export const NOTHING_PICKS_BETWEEN_PEOPLE =
  "Nothing here picks between people. A lower chance on one row for one person says nothing about any other row or person.";

/** Character-for-character (brief line 2632); true here, and the gate matches the string. */
export const NO_RANKING_STATEMENT = "Inherit does not rank embryos and does not recommend one.";

/** Why this page shows these people and nobody else. */
export function availabilityStatement(shown: number): string {
  return `This page shows ${shown} people because ${shown} people have agreed to be seen side by side. It shows nothing about anyone who has not.`;
}

/** One line per column: a count of rows, which is page furniture, not a result. */
export function perPersonTradeOff(name: string, results: number): string {
  return `${name}: ${results} results, none compared with anyone else.`;
}

// ---------------------------------------------------------------------------
// States (design §1.4).
// ---------------------------------------------------------------------------

/** Fewer than two people have agreed to be seen side by side. */
export function needsTwoPeople(shown: number): string {
  return `This page needs two people who have both agreed to be seen side by side. So far there is ${shown}.`;
}

/** Who can change that, said once beside the empty state. */
export const EACH_TURNS_IT_ON =
  "Each person turns this on from their own account. You cannot turn it on for them.";

/** A column whose person has added no file yet (design §2.3, cell state 4). */
export const CELL_NO_FILE = "No file yet";

/** A position that person's file does not cover (design §2.3, cell state 3). */
export function cellNotCovered(name: string): string {
  return `Not in ${name}’s file`;
}

/** The two files disagree about a position, so no letters are shown. */
export const CELL_FILES_DISAGREE = "Two files disagree";

/**
 * Another adult's letters are an individual result of the layer, so they
 * render only under that layer's own grant from that person; the joint
 * grant (`family.heritability`) opens the column, never the cell (register
 * `multiSubjectLayer`, D-038). Without the layer grant the cell says so.
 */
export const CELL_NOT_SHARED = "Not shared with you";

/** The accessible name of the link from a cell to that person's own report. */
export function openReportLabel(title: string, name: string): string {
  return `Open ${title} for ${name}`;
}

export const OPEN_LINK = "Open";

/** The layer chip beside a cell's letters; the definition renders once per table. */
export const LAYER_CHIP_LABELS = LAYER_LABELS;

/** The caption of one table: the layer, then its definition, once (X5.1). */
export function tableCaption(layer: keyof typeof LAYER_LABELS): string {
  return `${LAYER_LABELS[layer]} — ${LAYER_DEFINITIONS[layer]}`;
}

/** The one sentence a column footer carries, from its home on the person page. */
export { BASELINE_ABSENT };

/** The words read out with a cell's letters (the figure's hidden label). */
export function genotypeLabel(name: string): string {
  return `Two letters read for ${name} at this spot`;
}

// ---------------------------------------------------------------------------
// The carrier panel (brief line 346).
// ---------------------------------------------------------------------------

/**
 * The mandated sentence, split around the one figure it contains so the
 * figure renders through the contract and the sentence still reads as one
 * line: "For each pregnancy, about 25 in 100 — a 1 in 4 chance — that a
 * child inherits both copies. Each pregnancy is independent; this is not
 * 1 in 4 of your children." (brief line 346, character-for-character).
 */
export const CARRIER_SENTENCE_LEAD = "For each pregnancy,";

export const CARRIER_SENTENCE_TAIL =
  "— a 1 in 4 chance — that a child inherits both copies. Each pregnancy is independent; this is not 1 in 4 of your children.";

/** The whole sentence, for the tests that pin it; the panel renders it in parts. */
export function carrierProbabilitySentence(figureText: string): string {
  return `${CARRIER_SENTENCE_LEAD} ${figureText} ${CARRIER_SENTENCE_TAIL}`;
}

/**
 * The closed reason table (design §2.3; ADR 0017 §5-6). Six phrases are the
 * design's own; `sex-unknown` is for an X-linked pattern, whose hundred-
 * pregnancy split needs to know which parent carries the change on the X —
 * Inherit records no person's chromosomal sex (`subject_demographics` has
 * no writer), and the split belongs to Portrait rather than to this page
 * (D-031); `two-copies` is for a file that shows two changed copies rather
 * than one, which the brief says must render with a reason, never be
 * dropped (D-035).
 */
export const CARRIER_REASON_PHRASES: Record<CarrierReason, string> = {
  dominant: "the change runs in a dominant pattern",
  harmless: "the change is classed as harmless",
  "unknown-meaning": "nobody yet knows what this change means",
  "copies-unknown": "one file does not show how many copies were read",
  "no-pattern": "Inherit has no recorded inheritance pattern for this gene",
  "sex-unknown":
    "this pattern depends on which parent carries the change on the X, and Inherit does not record that",
  "two-copies": "one file shows two changed copies, not one",
  "not-covered": "one file does not cover the position the other person’s change is at",
  "runs-above-threshold":
    "one file has more long identical stretches than Inherit’s limit allows",
  "runs-unchecked":
    "Inherit could not check how much of one file is made of long identical stretches",
};

/** Character-for-character (brief line 346), with the reason named. */
export function carrierNoProbabilitySentence(gene: string, reason: CarrierReason): string {
  return `Both of you have a change in ${gene}, but Inherit cannot turn that into a chance for a pregnancy. Reason: ${CARRIER_REASON_PHRASES[reason]}.`;
}

/**
 * Nothing was found over a non-empty classified set: the count is of the
 * classified positions both files cover, which is page furniture.
 */
export function noCarrierMatches(positions: number): string {
  return `No change to show that you both carry. Inherit checked the ${positions} positions both files cover.`;
}

/**
 * The classified reference set is empty — the production state today, with
 * every `ref_variants.clinvar_significance` null — so there was nothing to
 * check and no count to print (D-034).
 */
export const NO_CLASSIFIED_POSITIONS =
  "This check is unavailable. Inherit cannot yet verify the evidence for each gene change. This is not a negative carrier screen.";

/** The name each person's own reading is rendered beside, in the block header. */
export function carrierPersonPrefix(name: string): string {
  return `${name}:`;
}

/**
 * One line per person: their own variant and its classification, named as
 * the brief requires ("both variants and both classifications, not just the
 * gene", line 346). The classification is the reference row's own label.
 */
export function personVariantLine(
  name: string,
  rsid: number,
  gene: string,
  classification: string,
): string {
  return `${name}: rs${rsid} in ${gene}, which outside reviewers class as ${classification}.`;
}

/** Rendered under every pair block until a counsellor directory exists (X16.2). */
export { COUNSELLOR_NO_ROUTE };

/**
 * The provenance of the runs check, rendered once in the panel when at
 * least one pair block renders (D-040): the definition of a run is
 * McQuillan et al. 2008's (American Journal of Human Genetics 83(3):359–372),
 * and the link text is the DOI itself. Two sentences, because the one-sentence
 * form graded above 9.
 */
export const RUNS_PROVENANCE =
  "Inherit measured long runs of matching letters in each file. It did so the way McQuillan and colleagues did in 2008.";

export const RUNS_SOURCE_DOI = "10.1016/j.ajhg.2008.08.007";

export const RUNS_SOURCE_URL = `https://doi.org/${RUNS_SOURCE_DOI}`;

// ---------------------------------------------------------------------------
// How sure we are, and where this comes from (X13).
// ---------------------------------------------------------------------------

/** One line per column, above that column's coverage figure. */
export function coverageLead(name: string): string {
  return `What ${name}’s own file covered:`;
}

export const HOW_SURE_LEAD =
  "Each column was read from that person’s own file. Nothing in this table was merged, added up or compared.";

export const WHERE_FROM_LEAD =
  "Every row is a report each person can open on their own page. This page adds no reading of its own.";

/** The two lines shared with the report surface, from their one home. */
export { NOT_DIAGNOSTIC, NO_RANGE_YET, PROVENANCE_LINE };
