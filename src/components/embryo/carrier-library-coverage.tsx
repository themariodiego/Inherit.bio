import { ClaimBlock } from "@/components/figures/claim-block";
import { CARRIER_LIBRARY_CONFIRMATION, CARRIER_LIBRARY_HEADING, CARRIER_LIBRARY_HELD,
  CARRIER_LIBRARY_NOT_NEGATIVE, CARRIER_LIBRARY_QUALITY, CARRIER_LIBRARY_REASONS,
  CARRIER_LIBRARY_REFERENCE_LABEL, CARRIER_LIBRARY_SCOPE } from "@/copy/embryos/carrier-library";
import type { CarrierLibraryCoverageRow } from "@/lib/embryos/carrier-library-read";
import { carrierLibraryCoverageFigure } from "@/lib/embryos/carrier-library-coverage";

/** Separate from the closed finding DTO, report ranking and QC score coverage.
 * The server supplies only a full, current, held coverage read after Tier-2. */
export function CarrierLibraryCoverage({ rows, subjectId, conditionNames }: {
  rows: readonly CarrierLibraryCoverageRow[]; subjectId: string; conditionNames: ReadonlyMap<string, string>;
}) {
  if (rows.length === 0) return null;
  return <div data-slot="carrier-library-coverage" className="space-y-4">
    <p className="label text-ink">{CARRIER_LIBRARY_HEADING}</p>
    {rows.map(row => {
      const coverage = row.coverage;
      if (!coverage) return <div key={row.conditionId} data-condition-id={row.conditionId}
        data-carrier-library-state="quality-not-measurable" className="space-y-2">
        <p className="label text-ink">{conditionNames.get(row.conditionId)}</p>
        <p className="text-sm text-ink">{CARRIER_LIBRARY_QUALITY[row.qualityReason!]}</p>
        <p className="text-sm text-ink-muted">{CARRIER_LIBRARY_HELD}</p>
      </div>;
      const spec = carrierLibraryCoverageFigure(coverage);
      const reasons = [...new Set(coverage.unresolved.flatMap(group => group.reasons))];
      return <div key={row.conditionId} data-condition-id={row.conditionId}
        data-carrier-library-state={coverage.coverageState === "partial" ? "partial-coverage"
          : coverage.coverageState === "not_covered" ? "not-covered" : "covered"} className="space-y-2">
        <p className="label text-ink">{coverage.conditionName}</p>
        <ClaimBlock subject={{ subjectId }} figures={[spec]}
          renderFigures={figures => <p className="text-sm leading-relaxed">{CARRIER_LIBRARY_NOT_NEGATIVE} {figures[0]}</p>}>
          <p className="mt-2 text-sm leading-relaxed">{CARRIER_LIBRARY_SCOPE}</p>
          {reasons.length > 0 ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {reasons.map(reason => <li key={reason}>{CARRIER_LIBRARY_REASONS[reason]}</li>)}
          </ul> : null}
          <p className="mt-2 text-sm leading-relaxed">{CARRIER_LIBRARY_HELD}</p>
          <p className="mt-2 text-sm leading-relaxed">{CARRIER_LIBRARY_CONFIRMATION}</p>
          {/* inherit-figure-exempt: the current reference release is a source identifier */}
          <p className="mt-2 caption">{CARRIER_LIBRARY_REFERENCE_LABEL}: {coverage.referenceReleaseId}.</p>
        </ClaimBlock>
      </div>;
    })}
  </div>;
}
