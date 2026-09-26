import type { OwnReportChoicesPanel } from "@/lib/uploads/own-report-purpose";

/**
 * Why an ancestry panel has nothing to show, when it has nothing.
 *
 * `nothing-read`: no file has been processed for this record, or nothing
 * says otherwise. `permission-off`: a file has been processed and the
 * Ancestry choice is off, so "nothing to show until a file has been
 * processed" would be false; the panel says the choice is off and where it
 * is turned back on instead.
 */
export type AncestryAbsence = "nothing-read" | "permission-off";

/**
 * One source of truth: the "Choose your reports" section of the subject's
 * Reports page (`loadOwnReportChoicesPanel`). This says `permission-off`
 * exactly when that section is shown and its Ancestry choice reads "Off",
 * so the page never sends anyone to a control that is not there. Every other
 * case, including a section that could not load, keeps `nothing-read`, the
 * sentence this page has always said.
 */
export function ancestryAbsence(panel: OwnReportChoicesPanel): AncestryAbsence {
  if (panel.kind !== "ready") return "nothing-read";
  const choice = panel.view.choices.find(entry => entry.purposeKey === "ancestry");
  return choice !== undefined && !choice.granted ? "permission-off" : "nothing-read";
}
