import type { ReportCallState, ReportMethod } from "@/lib/genome/report-evidence";

export const REPORT_METHOD_COPY: Record<ReportMethod, string> = {
  "guideline-position": "This report reads the listed DNA positions. It does not work out how a medicine will affect you.",
  "specific-position": "This report reads specific DNA positions. It does not combine them into a polygenic score.",
  "position-association": "This report links the listed DNA positions to research findings. It does not calculate a polygenic score.",
  "polygenic-score": "This report names a model that combines DNA positions. Naming the model does not mean a score is ready for you.",
  unavailable: "The method for this report is not fully specified. We cannot describe it as a combined score.",
};

export const REPORT_CALL_LABELS: Record<ReportCallState, string> = {
  interpreted: "Used in this report",
  conflicting: "Files disagree",
  "no-call": "Could not be read",
  unrecognized: "Letters do not match this report",
  unavailable: "No reading available to this report",
};

export const REPORT_CALLS_HEADING = "Positions in this report";
export const REPORT_CALLS_SCOPE =
  "These counts describe the calls available to this report, not a full check of your file. A missing call is not a negative result.";
export const REPORT_SOURCES_SCOPE =
  "A source may be a study or a guideline. The number of links does not tell you how strong the evidence is.";
export const SOURCE_READ_LABEL = "Source read";
export const SOURCE_READ_UNKNOWN = "Source-read date not recorded";
export const SOURCE_READ_SCOPE = "The date shows when the source was read, not when your result was checked.";
export const SCORE_METHOD_LABEL = "Score model";
export function citedSources(count: number): string {
  return count === 1 ? "1 cited source" : `${count} cited sources`;
}
