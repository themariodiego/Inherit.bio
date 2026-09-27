import type { OwnReportChoicesPanel } from "@/lib/uploads/own-report-purpose";

/**
 * Why an ancestry panel has nothing to show, when it has nothing.
 *
 * `nothing-read`: no file has been processed for this record, or nothing
 * says otherwise. `permission-off`: a file has been processed and the
 * Ancestry choice is off, so "nothing to show until a file has been
 * processed" would be false; the panel says the choice is off and where it
 * is turned back on instead. `not-generated`: a file has been processed and
 * Ancestry is on, but no result has been made from it. Turning a choice on
 * only grants it; the result is made by the separate "Generate selected
 * reports" step on the same Reports section, and until someone takes it
 * this lasts indefinitely, so it is named rather than waited out.
 *
 * There is no "being generated" state. Generation runs inside the one
 * request that asked for it, and the only record of a run in flight is a
 * private journal that nothing on this page may read, so a sentence saying
 * one is under way would have nothing to stand on.
 */
export type AncestryAbsence = "nothing-read" | "permission-off" | "not-generated";

/** The two reasons that send the reader to the Reports page, each with a step to take there. */
export type AncestryReportsStep = Exclude<AncestryAbsence, "nothing-read">;

/**
 * One source of truth: the "Choose your reports" section of the subject's
 * Reports page (`loadOwnReportChoicesPanel`). Called only when the page has
 * no stored ancestry result. It names a step only when that section is
 * shown, so the page never sends anyone to a control that is not there:
 * `permission-off` when its Ancestry choice reads "Off", and `not-generated`
 * when it reads "On" (the section then also offers "Generate selected
 * reports", because a choice is on and a prepared file is there). Every
 * other case, including a section that could not load, keeps
 * `nothing-read`, the sentence this page has always said.
 */
export function ancestryAbsence(panel: OwnReportChoicesPanel): AncestryAbsence {
  if (panel.kind !== "ready") return "nothing-read";
  const choice = panel.view.choices.find(entry => entry.purposeKey === "ancestry");
  if (choice === undefined) return "nothing-read";
  return choice.granted ? "not-generated" : "permission-off";
}
