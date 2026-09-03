/**
 * `/family` — the domain landing, public and signed in (design §2.1, §1.1;
 * brief §2 §5.1, §5 §2.6). Every user-visible string of that page lives
 * here: typographic apostrophes (U+2019), sentence case, second person,
 * grade ≤ 9, no sentence over 25 words.
 *
 * Export names carry the readability role (scripts/readability-gate.ts):
 * `*_HEADING` is read as a heading, `*_LABEL` as a label, `*_BUTTON` as a
 * button, `*_STATUS` and `*_NOTE` as statuses. Short roles use only words
 * registered in data/plain-vocabulary.json and never a term from
 * data/jargon.json.
 *
 * Strings the brief quotes ship character-for-character. Three of them
 * already have a home elsewhere and are re-exported rather than respelled:
 * the nav label that is also the h1, "Just you so far." and the
 * not-diagnostic line.
 */
import { NAV_LABELS } from "@/copy/navigation";
import { NOT_DIAGNOSTIC } from "@/copy/reports/strings";
import { STATE_C } from "@/copy/overview";

/** The h1 and the document title: the same string as the nav item (identity rule). */
export const FAMILY_H1 = NAV_LABELS.family;

// ---------------------------------------------------------------------------
// The two public panels (register family.index publicBranch; L-22).
// ---------------------------------------------------------------------------

export const FAMILY_LEDE =
  "Each adult needs their own account and must choose what they share. A legal expert must also approve the feature for their country.";

/** The jurisdiction panel. Its body is the register's own copy, not a sentence written here. */
export const JURISDICTION_HEADING = "Not available in any production jurisdiction yet";

export const JURISDICTION_PANEL_BODY =
  "No real jurisdiction has the required human sign-off. Invitations, shared analysis, and inheritance portraits remain off.";

/** The future-person panel, above the fold and before any sign-in wall (brief line 1803). */
export const FUTURE_PERSON_HEADING = "If a child is born from this";

export const FUTURE_PERSON_BODY =
  "Their genetic record belongs to them. Any future use must preserve their right to know, not know, correct, export, restrict, and delete it.";

export const FUTURE_PERSON_LINK = "Read the Future Person Charter";

/** The signed-out route into the product. */
export const OPEN_INHERIT_BUTTON = "Open Inherit";

/** Signed in, the jurisdiction panel becomes one line to the legal pages. */
export const WHERE_THIS_WORKS_LINK = "Where Inherit works";

// ---------------------------------------------------------------------------
// The signed-in hub: the people list, one primary action, three tiles.
// ---------------------------------------------------------------------------

/** No people yet (brief line 234); the same words the Overview uses. */
export const NOBODY_YET = STATE_C.justYou;

/** The one primary action on the page (brief line 234). */
export const ADD_ANOTHER_ADULT_BUTTON = "Add another adult";

/**
 * The card state line. "Reports ready" is true only when the person has an
 * annotated file AND a live report-layer grant to the viewer, so a fourth
 * line carries the commonest state — accepted, ungranted — without leaking
 * whether they have added a file (design §2.1, open decision 1).
 */
export const CARD_READY_STATUS = "Reports ready";
export const CARD_NO_FILE_STATUS = "No file yet";
export const CARD_PAUSED_STATUS = "Sharing paused";

export function waitingToShareStatus(name: string): string {
  return `Waiting for ${name} to share`;
}

/** The people list's accessible name; the list itself renders no count. */
export const PEOPLE_LIST_LABEL = "People in your family view";

/**
 * The name a person is shown under when neither their own record nor the
 * record that names them carries a name: every self subject is labelled
 * "You" until an account sets a display name, and "You" is a first-person
 * placeholder, never another person's name. This says what the person is
 * without inventing who they are.
 */
export const UNNAMED_PERSON_LABEL = "Another adult";

/** The label a self subject carries until its account sets a display name. */
export const SELF_PLACEHOLDER_LABEL = "You";

export interface HubTileCopy {
  id: "individual-risks" | "portrait" | "copilot";
  /** Exactly the accessible name of the tile link. */
  label: string;
  /** One line, ≤ 12 words (X6.3 keeps this page under 480 visible characters). */
  description: string;
  /** The sentence the tile carries instead of a link while it has no destination. */
  blocked: string;
}

export const HUB_TILES: readonly HubTileCopy[] = [
  {
    id: "individual-risks",
    label: "Individual risks",
    description: "Each adult’s own reports, never merged.",
    blocked: "Nobody has shared their reports with you yet.",
  },
  {
    id: "portrait",
    label: "Portrait",
    description: "What two DNA files could mean for a child.",
    blocked: "Portrait opens once two people have both turned it on.",
  },
  {
    id: "copilot",
    label: "Copilot",
    description: "Ask about the people in your family view.",
    blocked: "Copilot opens once someone has shared something with you.",
  },
];

/** The one §5 §6.1 line, from its home in src/copy/reports/strings.ts. */
export { NOT_DIAGNOSTIC };
