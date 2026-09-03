import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fleschKincaidGrade, readabilitySentences, wordCount } from "../../../scripts/readability";
import { vocabularyWords } from "../../../scripts/readability-gate";
import { NAV_LABELS } from "../navigation";
import { ENTRY_BOXES, STATE_C } from "../overview";
import { KIND_CHIPS, LAYER_LABELS, NOT_DIAGNOSTIC } from "../reports/strings";
import * as hub from "./index";
import * as invite from "./invite";
import * as permissions from "./permissions";
import * as person from "./person";

/**
 * The Family copy registry (design §4). Mandated strings ship
 * character-for-character with U+2019; everything written for these surfaces
 * is graded, capped and checked word by word in its short role, exactly as
 * the readability gate will check it.
 */

const MODULES = { hub, person, permissions, invite };

/** Every exported string, including those the exported functions produce. */
function corpus(): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  for (const registry of Object.values(MODULES)) {
    for (const value of Object.values(registry)) {
      if (typeof value === "function") {
        walk((value as (...args: unknown[]) => string)("Bo", "estimate"));
        walk((value as (...args: unknown[]) => string)("Bo", 3));
      } else walk(value);
    }
  }
  return out;
}

/** The strings the gate checks word by word against the plain vocabulary. */
function shortRoleStrings(): [string, string][] {
  return [
    ["FAMILY_H1", hub.FAMILY_H1],
    ["JURISDICTION_HEADING", hub.JURISDICTION_HEADING],
    ["FUTURE_PERSON_HEADING", hub.FUTURE_PERSON_HEADING],
    ["FUTURE_PERSON_LINK", hub.FUTURE_PERSON_LINK],
    ["OPEN_INHERIT_BUTTON", hub.OPEN_INHERIT_BUTTON],
    ["WHERE_THIS_WORKS_LINK", hub.WHERE_THIS_WORKS_LINK],
    ["ADD_ANOTHER_ADULT_BUTTON", hub.ADD_ANOTHER_ADULT_BUTTON],
    ["CARD_READY_STATUS", hub.CARD_READY_STATUS],
    ["CARD_NO_FILE_STATUS", hub.CARD_NO_FILE_STATUS],
    ["CARD_PAUSED_STATUS", hub.CARD_PAUSED_STATUS],
    ["waitingToShareStatus", hub.waitingToShareStatus("fact")],
    ["PEOPLE_LIST_LABEL", hub.PEOPLE_LIST_LABEL],
    ...hub.HUB_TILES.map(({ id, label }): [string, string] => [`HUB_TILES.${id}`, label]),
    ["PERSON_H1", person.PERSON_H1],
    ["REPORTS_HEADING", person.REPORTS_HEADING],
    ["ANCESTRY_HEADING", person.ANCESTRY_HEADING],
    ["PERMISSIONS_HEADING", person.PERMISSIONS_HEADING],
    ["GATE_HEADING", person.GATE_HEADING],
    ["GATE_CHECKBOX_LABEL", person.GATE_CHECKBOX_LABEL],
    ["GATE_SESSION_NOTE", person.GATE_SESSION_NOTE],
    ["GATE_BUTTON", person.GATE_BUTTON],
    ["GATE_ERROR_STATUS", person.GATE_ERROR_STATUS],
    ["ASK_ABOUT_THIS_LINK", person.ASK_ABOUT_THIS_LINK],
    ["waitingToShare", person.waitingToShare("fact")],
    ["PERMISSIONS_H1", permissions.PERMISSIONS_H1],
    ["theirColumnHeading", permissions.theirColumnHeading("fact")],
    ["yourColumnHeading", permissions.yourColumnHeading("fact")],
    ["onlyTheyCanTurnThisOn", permissions.onlyTheyCanTurnThisOn("fact")],
    ["PAUSE_OR_STOP_HEADING", permissions.PAUSE_OR_STOP_HEADING],
    ["PAUSE_BUTTON", permissions.PAUSE_BUTTON],
    ["RESUME_BUTTON", permissions.RESUME_BUTTON],
    ["STOP_BUTTON", permissions.STOP_BUTTON],
    ["STOP_CONFIRM_BUTTON", permissions.STOP_CONFIRM_BUTTON],
    ["TURN_ON_BUTTON", permissions.TURN_ON_BUTTON],
    ["TURN_OFF_BUTTON", permissions.TURN_OFF_BUTTON],
    ["STOP_CANCEL_BUTTON", permissions.STOP_CANCEL_BUTTON],
    ["PAUSED_STATUS", permissions.PAUSED_STATUS],
    ["SHARING_ERROR_STATUS", permissions.SHARING_ERROR_STATUS],
    ["TOMBSTONE_ITEMS_HEADING", permissions.TOMBSTONE_ITEMS_HEADING],
    ["tombstoneStatus", permissions.tombstoneStatus("fact", 3)],
    ["rowControlLabel", permissions.rowControlLabel("Portrait", "fact")],
    ...permissions.PERMISSION_ROWS.map(({ id, label }): [string, string] => [
      `PERMISSION_ROWS.${id}`,
      label,
    ]),
    ...Object.entries(permissions.PERMISSION_STATES).map(
      ([key, value]): [string, string] => [`PERMISSION_STATES.${key}`, value],
    ),
    ["INVITE_H1", invite.INVITE_H1],
    ["INVITE_THEM_HEADING", invite.INVITE_THEM_HEADING],
    ["EMAIL_LABEL", invite.EMAIL_LABEL],
    ["NOTE_LABEL", invite.NOTE_LABEL],
    ["SEND_BUTTON", invite.SEND_BUTTON],
    ["SENDING_BUTTON", invite.SENDING_BUTTON],
    ["REQUESTED_HEADING", invite.REQUESTED_HEADING],
    ["BLOCKED_HERE_STATUS", invite.BLOCKED_HERE_STATUS],
    ["REQUEST_FAILED_STATUS", invite.REQUEST_FAILED_STATUS],
    ["PATH_B_LINK", invite.PATH_B_LINK],
  ];
}

const VOCABULARY = new Set(
  (
    JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data/plain-vocabulary.json"), "utf8"),
    ) as { words: string[] }
  ).words,
);

const JARGON = (
  JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data/jargon.json"), "utf8"),
  ) as { terms: { term: string; aliases?: string[] }[] }
).terms.flatMap((entry) => [entry.term, ...(entry.aliases ?? [])]);

/**
 * X7.3 keeps registered terms out of short roles. Four strings are exempt
 * because a governing text fixes their wording, and each exemption is named
 * here rather than left implicit:
 *   - the two layer labels are X5.1's mandated renaming, already shipped as
 *     chips, tabs and count nouns;
 *   - "Ancestry" and "Raw genetic data" are two of the five toggle names the
 *     brief quotes (§5 §5.3), and "Ancestry" already ships as a nav label,
 *     an Overview box label and an h1;
 *   - the jurisdiction panel heading is kept verbatim from the public page
 *     this route replaces (design §1.1).
 */
const TERM_EXEMPTIONS = new Map<string, string>([
  ["PERMISSION_ROWS.reports.monogenic", "X5.1 layer label"],
  ["PERMISSION_ROWS.reports.polygenic", "X5.1 layer label"],
  ["PERMISSION_ROWS.ancestry", "brief §5 §5.3 toggle name"],
  ["PERMISSION_ROWS.raw.export", "brief §5 §5.3 toggle name"],
  ["ANCESTRY_HEADING", "the section is the Ancestry surface, named as elsewhere"],
  ["JURISDICTION_HEADING", "kept verbatim from the public panel"],
]);

/** The gate grades text with every registered term replaced, as this does. */
function withTermsReplaced(text: string): string {
  let result = text;
  for (const term of [...JARGON].sort((left, right) => right.length - left.length)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "gi"), "fact");
  }
  return result;
}

describe("family copy", () => {
  it("ships the brief's Family strings character-for-character", () => {
    expect(hub.ADD_ANOTHER_ADULT_BUTTON).toBe("Add another adult");
    expect(hub.NOBODY_YET).toBe("Just you so far.");
    expect(hub.CARD_READY_STATUS).toBe("Reports ready");
    expect(hub.CARD_NO_FILE_STATUS).toBe("No file yet");
    expect(hub.CARD_PAUSED_STATUS).toBe("Sharing paused");
    expect(hub.FUTURE_PERSON_HEADING).toBe("If a child is born from this");
    expect(person.GATE_CHECKBOX_LABEL).toBe(
      "I understand this can tell me something I can’t un-know.",
    );
    expect(person.GATE_SESSION_NOTE).toBe("You won’t be asked again until you sign out.");
    expect(person.GATE_BUTTON).toBe("Show what’s shared");
    expect(person.noFileYet("Bo")).toBe(
      "Bo hasn’t added a file yet. There is nothing to show.",
    );
    expect(person.BASELINE_ABSENT).toBe(
      "No baseline: Inherit does not know this person’s sex and age band.",
    );
    expect(person.COPILOT_LOCAL_ONLY).toBe(
      "For anyone’s genome but your own, Copilot only runs on a model you host yourself. Nothing leaves Inherit.",
    );
    expect(permissions.theirColumnHeading("Bo")).toBe("What you will see about Bo");
    expect(permissions.yourColumnHeading("Bo")).toBe("What Bo will see about you");
    expect(permissions.onlyTheyCanTurnThisOn("Bo")).toBe("Only Bo can turn this on.");
    expect(permissions.asymmetryLine("Bo")).toBe(
      "Bo can see your findings. You cannot see theirs.",
    );
    expect(permissions.PAUSE_BUTTON).toBe("Pause sharing");
    expect(permissions.STOP_BUTTON).toBe("Stop sharing");
    expect(permissions.tombstoneStatus("3 September 2026", 2)).toBe(
      "Sharing ended on 3 September 2026. 2 results built from this pairing were deleted.",
    );
    expect(permissions.stopDialogBody("Bo")).toBe(
      "Stop sharing with Bo? Every result built from the two of you is deleted within 60 seconds. This can’t be undone.",
    );
    expect(invite.PRE_CONSENT_STATEMENT).toBe(
      "Comparing two people’s DNA can show that they are related, or not related, in ways neither expected. Inherit cannot un-see this.",
    );
    expect(invite.INVITE_THEM_HEADING).toBe("Invite them.");
    expect(invite.PATH_B_LINK).toBe("They can’t use Inherit themselves");
    expect(invite.INVITE_H1).toBe("Invite another adult");
  });

  it("reads shared strings from their one home instead of respelling them", () => {
    expect(hub.FAMILY_H1).toBe(NAV_LABELS.family);
    expect(hub.NOBODY_YET).toBe(STATE_C.justYou);
    expect(hub.NOT_DIAGNOSTIC).toBe(NOT_DIAGNOSTIC);
    expect(person.PERSON_H1).toBe(
      ENTRY_BOXES.find((box) => box.id === "family.individual-risks")!.label,
    );
    expect(hub.HUB_TILES.map((tile) => tile.label)).toEqual([
      "Individual risks",
      "Portrait",
      "Copilot",
    ]);
    expect(permissions.PERMISSION_ROWS[0].label).toBe(LAYER_LABELS.variant_call);
    expect(permissions.PERMISSION_ROWS[1].label).toBe(LAYER_LABELS.estimate);
    expect(person.notShared("Bo", "estimate")).toBe(
      `Bo has not shared ${LAYER_LABELS.estimate} with you.`,
    );
    // The card's kind chip is the subject bar's chip, never a second wording.
    expect(KIND_CHIPS.adult_shared).toBe("Shared with you");
  });

  it("names the five permission rows, one purpose each, all default off", () => {
    expect(permissions.PERMISSION_ROWS.map((row) => row.id)).toEqual([
      "reports.monogenic",
      "reports.polygenic",
      "ancestry",
      "raw.export",
      "family.portrait",
    ]);
    expect(permissions.PERMISSION_ROWS.map((row) => row.label)).toEqual([
      "Specific variants",
      "Statistical estimates",
      "Ancestry",
      "Raw genetic data",
      "Portrait",
    ]);
    for (const row of permissions.PERMISSION_ROWS) {
      expect(readabilitySentences(row.consequence)).toHaveLength(1);
    }
    expect(Object.values(permissions.PERMISSION_STATES)).toEqual(["On", "Off", "Expired"]);
  });

  it("renders no Path B link while Path B does not exist", () => {
    expect(invite.PATH_B_AVAILABLE).toBe(false);
  });

  it("uses typographic apostrophes and no straight quote anywhere", () => {
    for (const text of corpus()) {
      expect(text, text).not.toMatch(/'/);
      expect(text, text).not.toMatch(/&(?:apos|#39|quot);/);
    }
  });

  it("keeps every sentence under 26 words and every long block at grade 9 or below", () => {
    for (const text of corpus()) {
      for (const sentence of readabilitySentences(text)) {
        expect(wordCount(sentence), sentence).toBeLessThanOrEqual(25);
      }
      if (wordCount(text) >= 15) {
        expect(fleschKincaidGrade(withTermsReplaced(text)), text).toBeLessThanOrEqual(9);
      }
    }
  });

  it("writes every short role in registered plain words", () => {
    for (const [name, text] of shortRoleStrings()) {
      for (const word of vocabularyWords(text)) {
        if (word === "fact") continue;
        expect(VOCABULARY.has(word), `${name}: ${word} (${text})`).toBe(true);
      }
    }
  });

  it("keeps registered terms out of headings, buttons and labels", () => {
    const pattern = (term: string) =>
      new RegExp(`(?<![A-Za-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "i");
    for (const [name, text] of shortRoleStrings()) {
      if (TERM_EXEMPTIONS.has(name)) continue;
      for (const term of JARGON) {
        expect(pattern(term).test(text), `${name}: ${term} (${text})`).toBe(false);
      }
    }
  });
});
