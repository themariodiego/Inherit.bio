import { REPORT_SCIENTIFIC_CORRECTION_NOTICE } from "@/copy/reports/scientific-correction";

/** Public template status only: never identifies a selected genotype or changes a saved call. */
export function ScientificCorrectionNotice() {
  return <p data-slot="report-scientific-correction" className="text-sm leading-relaxed text-ink-muted">
    {REPORT_SCIENTIFIC_CORRECTION_NOTICE}
  </p>;
}
