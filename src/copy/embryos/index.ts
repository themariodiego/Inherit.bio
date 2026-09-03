/**
 * `/embryos` — the domain landing (design §2.1; brief §2 §6.0, §5 §5.4,
 * A.13(c), X6, X9). Every user-visible string of that page lives here:
 * typographic apostrophes (U+2019), sentence case, second person, grade ≤ 9,
 * no sentence over 25 words.
 *
 * Export names carry the readability role (scripts/readability-gate.ts):
 * `*_HEADING` is read as a heading, `*_LABEL` as a label, `*_BUTTON` as a
 * button, `*_STATUS` and `*_NOTE` as statuses. Short roles use only words
 * registered in data/plain-vocabulary.json and never a term from
 * data/jargon.json.
 *
 * Strings the brief quotes ship character-for-character. Strings that already
 * have a home elsewhere are re-exported rather than respelled: the nav label
 * that is also the h1, the Overview's three tile lines, the future-person
 * link, the jurisdiction link and the not-diagnostic line.
 */
import { FUTURE_PERSON_LINK, WHERE_THIS_WORKS_LINK } from "@/copy/family/index";
import { NAV_LABELS } from "@/copy/navigation";
import { ENTRY_BOXES } from "@/copy/overview";
import { KIND_CHIPS, NOT_DIAGNOSTIC } from "@/copy/reports/strings";
import type { EmbryoStatus } from "@/lib/embryos/policy";

/** The h1 and the document title: the same string as the nav item (identity rule). */
export const EMBRYOS_H1 = NAV_LABELS.embryos;

/** The one h2 of the hub, above the cohort list. */
export const YOUR_EMBRYOS_HEADING = "Your embryos";

/** The kind chip beside every embryo label, from its one home. */
export const EMBRYO_KIND_CHIP = KIND_CHIPS.embryo;

// ---------------------------------------------------------------------------
// The empty state (brief line 372, in the four-part form of brief line 930).
// ---------------------------------------------------------------------------

/** Character-for-character (brief line 372). */
export const EMPTY_HEADING = "No embryo files added yet.";

export const EMPTY_WHAT_APPEARS = "When a laboratory’s file is added, each embryo appears here.";

export const EMPTY_HOW_TO_MAKE_IT_APPEAR =
  "Not every clinic produces one. Ask yours for the data behind the report.";

/** Character-for-character (brief line 372); the one primary action, and the request-data page's h1. */
export const REQUEST_DATA_BUTTON = "How to get your embryo files";

// ---------------------------------------------------------------------------
// The cohort card: a date for a label, one status word per embryo, one
// analysis line and one link. No colour, no rank, no laboratory label.
// ---------------------------------------------------------------------------

/** The cohort's only safe label; `date` is already formatted for the reader. */
export function cohortLabel(date: string): string {
  return `Embryos added on ${date}`;
}

/** The closed status table (design §2.1); "Quality check not passed" is brief line 392. */
export const EMBRYO_STATUS: Record<EmbryoStatus, string> = {
  pending: "Checking the file",
  qc_pass: "Ready",
  qc_marginal: "Ready, with a thinner file",
  qc_fail: "Quality check not passed",
  excluded: "Not included",
  stored: "Stored",
  transferred: "Transferred",
  donated: "Donated",
  discarded: "Discarded",
  claimed_bound: "Claimed",
};

/** The role words the analysis line names; nobody is named. */
export const ROLE_YOU = "you";
export const ROLE_OTHER_PARENT = "the other genetic parent";

/** The card line while a grant is missing. */
export function waitingForResultsStatus(role: string): string {
  return `Waiting for ${role} to turn on the results`;
}

/** The blocking sentence on a result surface while a grant is missing. */
export function waitingForResultsBody(role: string): string {
  return `Waiting for ${role} to turn on the results. Nothing shows until then.`;
}

export const COMPARE_THESE_LINK = "Compare these embryos";

/** The card line while the files are still being checked. */
export const STILL_CHECKING_STATUS = "Still checking the files.";

/** The card line before any file has been added to the cohort. */
export const FILES_NOT_ADDED_SENTENCE = "The laboratory’s files for these embryos have not been added yet.";

// ---------------------------------------------------------------------------
// Retention (A.13(c); the numbers are docs/retention.md's).
// ---------------------------------------------------------------------------

export const RETENTION_SENTENCE =
  "Inherit deletes these files 24 months after they were added or last analysed, whichever is later. They stay longer only if every genetic parent renews.";

export const RETENTION_DONATED_OR_DISCARDED = "Donated or discarded: deleted 90 days after that was recorded.";

export const RETENTION_TRANSFERRED =
  "Transferred: kept for the future person until the date on the Record Key Card.";

/** The destructive action either parent may take (brief line 2156); rendered once its route exists. */
export const STOP_AND_DELETE_BUTTON = "Stop and delete these files";

/** The tombstone every recipient's landing carries after a stop. */
export function sharingEndedStatus(date: string): string {
  return `Sharing ended on ${date}. Every result built from these files was deleted.`;
}

// ---------------------------------------------------------------------------
// The three tiles: title-role links, never headings (brief lines 372, 627).
// ---------------------------------------------------------------------------

export interface HubTileCopy {
  id: "upload" | "compare" | "copilot";
  /** Exactly the accessible name of the tile link. */
  label: string;
  /** One line, ≤ 12 words (X6.3 keeps this page under 480 visible characters). */
  description: string;
  /** The sentence the tile carries instead of a link while it has no destination. */
  blocked: string;
}

const UPLOAD_BOX = ENTRY_BOXES.find((box) => box.id === "embryos.upload")!;
const COMPARE_BOX = ENTRY_BOXES.find((box) => box.id === "embryos.compare")!;

export const HUB_TILES: readonly HubTileCopy[] = [
  {
    id: "upload",
    label: UPLOAD_BOX.label,
    description: UPLOAD_BOX.description,
    blocked: "Adding files opens once the legal review for your country is complete.",
  },
  {
    id: "compare",
    label: COMPARE_BOX.label,
    description: COMPARE_BOX.description,
    blocked: "Compare opens once a laboratory’s files have been added.",
  },
  {
    id: "copilot",
    label: "Ask Copilot",
    description: "Ask about the files your laboratory sent.",
    /** docs/canonical-artifacts.md line 42 (copilotCohortUnavailablePage). */
    blocked:
      "Copilot for embryos runs only on a model you host yourself. It is not connected on this site yet.",
  },
];

/** The two links the availability line carries, from their homes. */
export { FUTURE_PERSON_LINK, WHERE_THIS_WORKS_LINK };

/** The one §5 §6.1 line, from its home in src/copy/reports/strings.ts. */
export { NOT_DIAGNOSTIC };
