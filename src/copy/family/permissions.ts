/**
 * `/family/[person]/permissions` — the two independent grant columns and the
 * pause/stop actions (design §2.4; brief §5 §5.3-§5.4, X5.1). Every
 * user-visible string of that page lives here.
 *
 * The five rows are the register's `individualResultPurposeLayers` plus raw
 * data and Portrait. X5.1 renamed the two report layers and forbids the
 * brief's §2 names, so the first two labels are read from their one home in
 * src/copy/reports/strings.ts rather than respelled.
 */
import { LAYER_LABELS } from "@/copy/reports/strings";

export const PERMISSIONS_H1 = "Permissions";

/** Character-for-character (brief line 340). */
export function theirColumnHeading(name: string): string {
  return `What you will see about ${name}`;
}

/** Character-for-character (brief line 340). */
export function yourColumnHeading(name: string): string {
  return `What ${name} will see about you`;
}

/**
 * Character-for-character. The left column may be set only from that
 * person's own session, so in this session every row in it is disabled and
 * says who can change it.
 */
export function onlyTheyCanTurnThisOn(name: string): string {
  return `Only ${name} can turn this on.`;
}

/** Character-for-character; rendered only when the two directions differ that way. */
export function asymmetryLine(name: string): string {
  return `${name} can see your findings. You cannot see theirs.`;
}

export const COLUMN_DEFAULT_NOTE =
  "Every row starts off. There is no switch that turns several rows on at once.";

// ---------------------------------------------------------------------------
// The five rows. One purpose each, no master switch, all default off.
// ---------------------------------------------------------------------------

export type PermissionRowId =
  | "reports.monogenic"
  | "reports.polygenic"
  | "ancestry"
  | "raw.export"
  | "raw.browse"
  | "family.portrait"
  | "family.heritability";

export interface PermissionRowCopy {
  id: PermissionRowId;
  /** Exactly the accessible name of the row's control. */
  label: string;
  /** One sentence saying what turning the row on lets the other person do. */
  consequence: string;
}

export const PERMISSION_ROWS: readonly PermissionRowCopy[] = [
  {
    id: "reports.monogenic",
    label: LAYER_LABELS.variant_call,
    consequence: "They can read what your file says at single spots, one report at a time.",
  },
  {
    id: "reports.polygenic",
    label: LAYER_LABELS.estimate,
    consequence: "They can read reports on links between your DNA and traits found in studies.",
  },
  {
    id: "ancestry",
    label: "Ancestry",
    consequence: "They can see the broad world regions your file is close to.",
  },
  {
    id: "raw.export",
    label: "Raw genetic data",
    consequence: "They can download the letters in your file itself, not only the reports.",
  },
  {
    id: "raw.browse",
    // Not "Raw genetic data ..." like the row above it: that label is exempt
    // from the registered-term rule only because the brief names it verbatim
    // as a §5 §5.3 toggle. This permission is new, the brief does not name it,
    // and claiming the same exemption would be claiming the brief says
    // something it does not. So the label uses the product's own plain word
    // for the same thing — "letters", as the consequence lines already do.
    label: "Read the letters in Inherit",
    consequence: "They can look through the letters in your file inside Inherit, without downloading it.",
  },
  {
    id: "family.portrait",
    label: "Portrait",
    consequence: "The two of you can open Portrait, once you have both turned this on.",
  },
  {
    id: "family.heritability",
    label: "Health picture",
    consequence: "The two of you can see your results side by side, once you have both turned this on.",
  },
];

/** Permission state carries no colour (brief line 652): a glyph and one of these words. */
export const PERMISSION_STATES = {
  on: "On",
  off: "Off",
  expired: "Expired",
} as const;

export type PermissionState = keyof typeof PERMISSION_STATES;

/** The two row controls: what the button does, not what the row is now. */
export const TURN_ON_BUTTON = "Turn on";
export const TURN_OFF_BUTTON = "Turn off";

/**
 * The accessible name of one row's control. It starts with the control's
 * visible words (WCAG 2.5.3: the visible label is part of the name) and
 * names the row and the person, so two columns never collide.
 */
export function rowControlLabel(verb: string, label: string, name: string): string {
  return `${verb} ${label} for ${name}`;
}

// ---------------------------------------------------------------------------
// Pause, resume and stop (brief line 342).
// ---------------------------------------------------------------------------

export const PAUSE_OR_STOP_HEADING = "Pause or stop sharing";

export const PAUSE_BUTTON = "Pause sharing";
export const RESUME_BUTTON = "Resume sharing";
export const STOP_BUTTON = "Stop sharing";

export const PAUSE_BODY =
  "Pausing hides everything the two of you share, both ways, and deletes nothing. Either of you can undo it.";

export const PAUSED_STATUS = "Sharing paused";

export const RESUME_BODY =
  "Sharing is paused. What you had shared comes back as it was; anything you took away stays away.";

/** The confirmation dialog for the one destructive action (tier 2 of brief line 936). */
export function stopDialogHeading(name: string): string {
  return `Stop sharing with ${name}?`;
}

export function stopDialogBody(name: string): string {
  return `Stop sharing with ${name}? Every result built from the two of you is deleted within 60 seconds. This can’t be undone.`;
}

/** The dialog lists by name what will be deleted, never a count alone. */
export const STOP_DELETES: readonly string[] = [
  "Portrait results built from the two of you",
  "side-by-side rows that compare the two of you",
  "answers Copilot kept that used their data",
];

export const STOP_CONFIRM_BUTTON = "Stop sharing for good";
export const STOP_CANCEL_BUTTON = "Keep sharing";

/** Character-for-character; both accounts see it (brief line 342). */
export function tombstoneStatus(date: string, count: number): string {
  return `Sharing ended on ${date}. ${count} results built from this pairing were deleted.`;
}

export const TOMBSTONE_ITEMS_HEADING = "What was deleted";

/** The request failed; nothing changed. */
export const SHARING_ERROR_STATUS = "That did not save. Nothing was changed.";

/**
 * The Portrait row before the independent-login marker is stamped: the row
 * is real and its state is shown, but it cannot be turned on from the
 * session the invitation was accepted in (register auth.callback
 * `independentLoginMarker`; `grant_directional_purpose_v1`).
 */
export const INDEPENDENT_LOGIN_REQUIRED =
  "This row needs a sign-in of your own first. Sign out, sign in again, and it can be turned on.";

/**
 * The three reasons a row can be locked with no control and nothing else to
 * say (D-102, signed 2026-09-14). Before these, `actionFor()` returned
 * `undefined` with no reason set and the reader met an empty paragraph.
 *
 * The cause is `private.family_report_endpoint_v1(..., p_require_adult)`,
 * which requires a date of birth at least eighteen years old and is called
 * for BOTH sides of the pair, so either profile can be the one that fails it.
 *
 * ATTRIBUTED, by owner decision. The unattributed wording was recommended and
 * overruled, and the record of that trade-off is
 * `docs/protocol/copy-for-signature.md`. What attribution accepts is that a
 * reader learns the named person either has not recorded a date of birth or
 * is under 18. What it must never do is say which: `adultOnRecord` collapses
 * the database's three-valued `birthDateState` to one boolean for that reason.
 */
export function adultDateRequiredFrom(name: string): string {
  return `This row needs a date of birth from ${name}. Inherit shares between adults only.`;
}

/** The viewer's own profile is the one missing it: actionable, and it
 *  discloses nothing about anyone else. */
export const YOUR_ADULT_DATE_REQUIRED =
  "This row needs your date of birth. Inherit shares between adults only.";

/** Every other cause: a principal, artifact or profile the page could not
 *  read. A fault, and it says so rather than looking like a rule. */
export const GRANT_UNAVAILABLE =
  "This row cannot be turned on right now. Nothing has changed; please try again.";
