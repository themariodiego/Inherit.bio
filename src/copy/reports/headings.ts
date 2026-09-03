/**
 * The six fixed report headings (brief X13.1). Canonical home named in
 * docs/canonical-artifacts.md; src/components/reports/report-skeleton.tsx is
 * the renderer. Never renamed or reordered on adult surfaces; the embryo
 * surface substitutes exactly the headings listed below.
 */

export const REPORT_HEADINGS = [
  "What this is",
  "Your result",
  "What this doesn’t mean",
  "How sure we are",
  "What you can do",
  "Where this comes from",
] as const;

export type ReportHeading = (typeof REPORT_HEADINGS)[number];

/** Stable element ids, in heading order. */
export const REPORT_HEADING_IDS: Record<ReportHeading, string> = {
  "What this is": "what-this-is",
  "Your result": "your-result",
  "What this doesn’t mean": "what-this-doesnt-mean",
  "How sure we are": "how-sure-we-are",
  "What you can do": "what-you-can-do",
  "Where this comes from": "where-this-comes-from",
};

export const EMBRYO_HEADING_SUBSTITUTIONS: Partial<Record<ReportHeading, string>> = {
  "What you can do": "What this does and does not tell you",
};

export type ReportSurfaceVariant = "adult" | "embryo";

/** The rendered heading text for a surface variant. */
export function headingText(heading: ReportHeading, variant: ReportSurfaceVariant): string {
  if (variant === "embryo") return EMBRYO_HEADING_SUBSTITUTIONS[heading] ?? heading;
  return heading;
}
