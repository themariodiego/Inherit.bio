/**
 * Copilot for one other adult's record (register `scope-derived-v1`
 * `subject:adult` / `uploader-or-grantee`; owner decision of 19 November
 * 2026, "G8.5: Copilot for another adult's record opens"). Every
 * user-visible string of that branch of `/copilot/[scope]`, and of the links
 * that open it, lives here. None of it is approved yet: the decision sends
 * the wording to the owner before it ships.
 *
 * The unavailable page, the local-model sentence and the settings link are
 * the group scopes' own (src/copy/copilot/group-scopes.ts), so a person sees
 * one wording for every Copilot about someone else.
 *
 * Export names carry the readability role (scripts/readability-gate.ts):
 * `*_HEADING` a heading, `*_BUTTON` a button, `*_LABEL` a label, `*_STATUS`
 * and `*_NOTE` a status; everything else is running text.
 */
import { familyMemberLine } from "@/copy/copilot/group-scopes";
import type { FindingLayer } from "@/lib/genome/taxonomy";

/** The page's h1, which is also the thread header: the one person the thread is about (brief §8.6). */
export function subjectScopeHeading(name: string): string {
  return `Ask about ${name}`;
}

/** The ready page's first paragraph. */
export function subjectCopilotLede(name: string): string {
  return `Copilot answers only about ${name}, from the reports they let it read. It reads only the report types they chose for you, never their whole file.`;
}

/** The box that says what this thread may read. */
export const SUBJECT_LAYERS_HEADING = "What Copilot can read";

/** The one line in that box: the person and the report types they share for Copilot. */
export function subjectLayersLine(name: string, layers: readonly FindingLayer[]): string {
  return familyMemberLine(name, layers);
}

/** The adult has not turned Copilot on for the asker, or shares no report type with it. */
export function subjectPermissionMissingNote(name: string): string {
  return `${name} has not let Copilot read what they share with you.`;
}

/** How it gets turned on, without saying which part is missing. */
export function subjectHowToTurnOn(name: string): string {
  return `Only ${name} can turn this on. They need Copilot and at least one report type on for you.`;
}

/** The mitigation decision holds the record: nothing about why is said. */
export function subjectHeldText(name: string): string {
  return `Copilot cannot read ${name}’s reports right now.`;
}

/** The composer's empty-thread hint. */
export function subjectThreadHint(name: string): string {
  return `Ask about the reports ${name} shared with you. Each answer names whose results it used.`;
}

/** The composer's placeholder. */
export function subjectPlaceholderLabel(name: string): string {
  return `Ask about ${name}…`;
}

/** The entry link, shown only where the scope would open. */
export function askCopilotAboutButton(name: string): string {
  return `Ask Copilot about ${name}`;
}

// The Path B person's Copilot choice lives with their other choices, in
// PATH_B_CHOICES_COPY (src/copy/upload/other-adult.ts: copilotLabel,
// copilotConsequence, affirmCopilot).
