import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportLibrary, type LibraryLayerClass } from "./report-library";
import { ScientificCorrectionNotice } from "./scientific-correction-notice";
import { REPORT_SCIENTIFIC_CORRECTION_NOTICE } from "@/lib/genome/report-scientific-corrections";

describe("scientific correction presentation", () => {
  it("renders an explicit historical wording notice with no selected result details", () => {
    const html = renderToStaticMarkup(createElement(ScientificCorrectionNotice));
    expect(html).toContain(REPORT_SCIENTIFIC_CORRECTION_NOTICE);
    expect(html).toContain('data-slot="report-scientific-correction"');
    expect(html).not.toMatch(/data-figure|data-claim|rs75932628|\bTT\b/);
  });
  it.each(["variant-call", "estimate"] as const)("labels the captured %s library card while preserving its summary", (layerClass: LibraryLayerClass) => {
    const html = renderToStaticMarkup(createElement(ReportLibrary, { subject: "person", historySubjectId: "source",
      layerClass, describedBy: "intro", groups: [{ id: "brain", label: "Brain",
        description: "Report references.", cards: [
          { slug: "historical", title: "Historical report", summary: "Exact captured summary.",
            scientificCorrection: true, evidenceLabel: "Emerging", genes: [], status: "covered" },
          { slug: "other", title: "Other report", summary: "Unrelated summary.",
            scientificCorrection: false, evidenceLabel: "Emerging", genes: [], status: "covered" },
        ] }] }));
    expect(html.match(/data-slot="report-scientific-correction"/g)).toHaveLength(1);
    expect(html).toContain(REPORT_SCIENTIFIC_CORRECTION_NOTICE);
    expect(html).toContain("Exact captured summary."); expect(html).toContain("Unrelated summary.");
    expect(html).toContain("/genome/person/reports/historical");
    expect(html).not.toContain("rs75932628");
  });
});
