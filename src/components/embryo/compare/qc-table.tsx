/**
 * <QcTable> — the fixed per-embryo quality table (brief §4 §6.6, line 1398;
 * X10.4). Server component. One column per embryo in ordinal order; every
 * measured rate is a figure inside a claim block attributed to that
 * embryo's subject; every unknown source field prints "Not stated by the
 * source laboratory" and every null computed metric "not measurable from
 * this file" — never a default, a dash or a tick. The dropout estimate and
 * its interval share one row, because one interval figure carries all three.
 */
import { ClaimBlock } from "@/components/figures/claim-block";
import { EmbryoInputProvenance } from "@/components/embryo/input-provenance";
import { INPUT_PROVENANCE_COPY } from "@/copy/reports/input-provenance";
import { coverageSpec, depthSpec, dropoutSpec, isZeroRate, rateSpec } from "@/components/embryo/qc-figures";
import { formatDate } from "@/components/embryo/format";
import {
  DROPOUT_NOT_MEASURED,
  NONE_WORD,
  NOT_MEASURABLE_FROM_FILE,
  NOT_STATED_BY_SOURCE,
  QC_FAILED_CHIP,
  QC_FIELD_LABELS,
  QC_MARGINAL,
  QC_PASSED,
  QC_REASON_WORDS,
} from "@/copy/embryos/qc";
import { QUALITY_CHECK_HEADING } from "@/copy/embryos/compare";
import type { ComparisonEmbryo, QcDto } from "@/lib/embryos/policy";
import { mapQcReason } from "@/lib/embryos/qc-policy";
import { sourceLabelText } from "@/lib/embryos/source-labels";
import { groupNumber } from "@/lib/figures/natural-frequency";

const CELL_BLOCK_CLASS = "rounded-none border-0 bg-transparent p-0";

/** The rows the table renders, in register order; the dropout interval rides with its estimate. */
export const QC_TABLE_ROWS = [
  "sites_expected",
  "sites_called",
  "call_rate",
  "autosomal_het_rate",
  "mean_depth",
  "parent_a_concordance",
  "parent_b_concordance",
  "allelic_dropout_estimate",
  "allelic_dropout_method",
  "amplification_method",
  "source_laboratory",
  "source_assay",
  "imputation_performed",
  "imputation_panel",
  "contamination_estimate",
  "qc_verdict",
  "qc_reasons",
  "computed_at",
  "source_facts",
] as const satisfies readonly (keyof QcDto)[];

export type QcTableRow = (typeof QC_TABLE_ROWS)[number];

export function verdictWord(verdict: QcDto["qc_verdict"]): string {
  switch (verdict) {
    case "pass":
      return QC_PASSED;
    case "marginal":
      return QC_MARGINAL;
    case "fail":
      return QC_FAILED_CHIP;
  }
}

const RATE_ROWS = new Set<QcTableRow>([
  "autosomal_het_rate",
  "parent_a_concordance",
  "parent_b_concordance",
  "contamination_estimate",
]);

function Words({ children }: { children: string }) {
  return <span data-slot="qc-word">{children}</span>;
}

/** One cell: a figure for a measured number, a closed word for everything else. */
export function QcValue({
  row,
  qc,
  embryoId,
  subjectId,
}: {
  row: QcTableRow;
  qc: QcDto;
  embryoId: string;
  subjectId: string;
}) {
  const subject = { subjectId };
  switch (row) {
    case "sites_expected":
      // inherit-figure-exempt: the count of positions the check needs is a count of objects; the share read renders as the coverage figure
      return <Words>{groupNumber(qc.sites_expected)}</Words>;
    case "sites_called":
      // inherit-figure-exempt: the count of positions the file could read is a count of objects; the share read renders as the coverage figure
      return <Words>{groupNumber(qc.sites_called)}</Words>;
    case "call_rate":
      return <ClaimBlock subject={subject} figures={[coverageSpec(qc)]} className={CELL_BLOCK_CLASS} />;
    case "mean_depth":
      if (qc.mean_depth === null) return <Words>{NOT_MEASURABLE_FROM_FILE}</Words>;
      return <ClaimBlock subject={subject} figures={[depthSpec(qc.mean_depth)]} className={CELL_BLOCK_CLASS} />;
    case "allelic_dropout_estimate": {
      const spec = dropoutSpec(qc, embryoId);
      if (!spec) return <Words>{DROPOUT_NOT_MEASURED}</Words>;
      return <ClaimBlock subject={subject} figures={[spec]} className={CELL_BLOCK_CLASS} />;
    }
    case "allelic_dropout_method":
    case "amplification_method":
    case "source_laboratory":
    case "source_assay":
      // A registered label's display text or the not-stated sentence; a
      // source column is never printed (R2).
      return <Words>{sourceLabelText(row, qc[row]) ?? NOT_STATED_BY_SOURCE}</Words>;
    case "imputation_performed":
      return <Words>{INPUT_PROVENANCE_COPY.inheritNoImputation}</Words>;
    case "imputation_panel":
      return <Words>{INPUT_PROVENANCE_COPY.inheritNoPanel}</Words>;
    case "source_facts":
      return <EmbryoInputProvenance facts={qc.source_facts} />;
    case "qc_verdict":
      return <Words>{verdictWord(qc.qc_verdict)}</Words>;
    case "qc_reasons":
      return (
        <Words>
          {qc.qc_reasons.length === 0
            ? NONE_WORD
            : [...new Set(qc.qc_reasons.map(mapQcReason))].map((reason) => QC_REASON_WORDS[reason]).join("; ")}
        </Words>
      );
    case "computed_at":
      // inherit-figure-exempt: the date the check ran is UI chrome
      return <Words>{formatDate(qc.computed_at)}</Words>;
    default: {
      if (RATE_ROWS.has(row)) {
        const value = qc[row] as number | null;
        if (value === null) return <Words>{NOT_MEASURABLE_FROM_FILE}</Words>;
        if (isZeroRate(value)) return <Words>{NONE_WORD}</Words>;
        return <ClaimBlock subject={subject} figures={[rateSpec(value)]} className={CELL_BLOCK_CLASS} />;
      }
      return null;
    }
  }
}

export function QcTable({
  embryos,
  subjectIds,
}: {
  embryos: readonly ComparisonEmbryo[];
  subjectIds: ReadonlyMap<string, string>;
}) {
  return (
    <div className="overflow-x-auto">
      <table data-slot="qc-table" data-card="true" data-compare-surface="true" className="w-full border-separate border-spacing-0 rounded-2xl border border-line bg-card text-sm">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 border-b border-line bg-card px-3 py-2 text-left font-medium text-ink">
              <span className="sr-only">{QUALITY_CHECK_HEADING}</span>
            </th>
            {embryos.map((embryo) => (
              <th key={embryo.id} scope="col" data-embryo-id={embryo.id} className="min-w-[12rem] border-b border-line px-3 py-2 text-left font-medium text-ink">
                {embryo.display_label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {QC_TABLE_ROWS.map((row) => (
            <tr key={row} data-qc-row={row}>
              <th scope="row" className="sticky left-0 z-10 border-b border-line bg-card px-3 py-2 text-left align-top font-medium text-ink">
                {QC_FIELD_LABELS[row]}
              </th>
              {embryos.map((embryo) => (
                <td key={embryo.id} className="border-b border-line px-3 py-2 align-top text-ink">
                  <QcValue row={row} qc={embryo.qc} embryoId={embryo.id} subjectId={subjectIds.get(embryo.id) ?? embryo.id} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
