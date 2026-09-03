/**
 * <CompareTable> — one layer of the comparison (design §2.4; X5.1; X10.3;
 * brief lines 392, 2242). Server component.
 *
 * Columns are embryos in ascending `sample_ordinal`, every one of them —
 * a failed embryo keeps its full column with the quality chip and its reason
 * in the footer. Rows are conditions in ascending registry `condition_id`.
 * No `<th>` is a button, none carries `aria-sort`, and nothing on the page
 * changes column or row order. The caption carries the layer's definition
 * once. While the registry is empty one sentence stands in for the rows.
 *
 * Every number on the surface is a figure inside an attributed claim block;
 * no colour token renders here.
 */
import type { ReactNode } from "react";
import { ClaimBlock } from "@/components/figures/claim-block";
import { EmbryoChip } from "@/components/embryo/embryo-chip";
import { coverageSpec, rateSpec } from "@/components/embryo/qc-figures";
import { NO_ROWS_SENTENCE, POSITIONS_READ_TH, ROW_LABEL_TH } from "@/copy/embryos/compare";
import { NOT_MEASURABLE_FROM_FILE, QC_FIELD_LABELS, QC_REASON_SENTENCES } from "@/copy/embryos/qc";
import { LAYER_DEFINITIONS, LAYER_LABELS } from "@/copy/reports/strings";
import type { ComparisonEmbryo, ComparisonResultRow } from "@/lib/embryos/policy";
import { mapQcReason, type QcReasonId } from "@/lib/embryos/qc-policy";
import type { FindingLayer } from "@/lib/genome/taxonomy";
import type { StandaloneFigureSpec } from "@/lib/figures/spec";
import { route } from "@/lib/primary-routes";
import { CompareCell } from "./compare-cell";

const HEADER_CELL = "h-14 min-w-[12rem] border-b border-line px-3 py-2 text-left align-top font-medium text-ink";
const STICKY = "sticky left-0 z-10 bg-card";
const CELL_BLOCK_CLASS = "rounded-none border-0 bg-transparent p-0";

export interface CompareTableProps {
  layer: FindingLayer;
  embryos: readonly ComparisonEmbryo[];
  rows: readonly ComparisonResultRow[];
  /** The subject each embryo's blocks are attributed to, by embryo id. */
  subjectIds: ReadonlyMap<string, string>;
}

/** The reasons a footer states, in register order, each once. */
export function footerReasons(embryo: ComparisonEmbryo): QcReasonId[] {
  if (embryo.qc.qc_verdict === "pass") return [];
  const reasons = [...new Set(embryo.qc.qc_reasons.map(mapQcReason))];
  return reasons.length > 0 ? reasons : ["qc_review_required"];
}

/**
 * The footer of one column: the positions read as a coverage figure and,
 * for a failed or marginal embryo, each reason with its measured number as a
 * figure and the parent concordances as figures or the null words
 * (register `comparisonFailureProjection.footer`).
 */
export function ColumnFooter({ embryo, subjectId }: { embryo: ComparisonEmbryo; subjectId: string }) {
  const qc = embryo.qc;
  const reasons = footerReasons(embryo);
  const figures: StandaloneFigureSpec[] = [coverageSpec(qc)];
  const callRateIndex = reasons.some((reason) => QC_REASON_SENTENCES[reason].figure === "call_rate")
    ? figures.push(rateSpec(qc.call_rate)) - 1
    : null;
  const concordances: { key: "parent_a_concordance" | "parent_b_concordance"; index: number | null }[] = [];
  if (reasons.length > 0) {
    for (const key of ["parent_a_concordance", "parent_b_concordance"] as const) {
      const value = qc[key];
      concordances.push({ key, index: value === null ? null : figures.push(rateSpec(value)) - 1 });
    }
  }
  return (
    <ClaimBlock
      subject={{ subjectId }}
      figures={figures}
      className={CELL_BLOCK_CLASS}
      renderFigures={(nodes: ReactNode[]) => (
        <div className="space-y-2 text-sm text-ink">
          <p data-slot="footer-coverage">{nodes[0]}</p>
          {reasons.map((reason) => {
            const sentence = QC_REASON_SENTENCES[reason];
            return (
              <p key={reason} data-slot="footer-reason" data-reason={reason}>
                {embryo.display_label}: {sentence.before}
                {sentence.figure === "call_rate" && callRateIndex !== null ? <> {nodes[callRateIndex]} </> : " "}
                {sentence.after}
              </p>
            );
          })}
          {concordances.map(({ key, index }) => (
            <p key={key} data-slot="footer-concordance" data-field={key}>
              {QC_FIELD_LABELS[key]}: {index === null ? NOT_MEASURABLE_FROM_FILE : nodes[index]}
            </p>
          ))}
        </div>
      )}
    />
  );
}

export function CompareTable({ layer, embryos, rows, subjectIds }: CompareTableProps) {
  return (
    <div data-slot="compare-scroller" className="overflow-x-auto">
      <table
        data-compare-surface="true"
        data-card="true"
        data-layer={layer}
        className="w-full border-separate border-spacing-0 rounded-2xl border border-line bg-card text-sm"
      >
        <caption className="p-3 text-left text-sm text-ink-muted">
          {LAYER_LABELS[layer]}. {LAYER_DEFINITIONS[layer]}
        </caption>
        <thead>
          <tr>
            <th scope="col" className={`${HEADER_CELL} ${STICKY}`}>
              {ROW_LABEL_TH}
            </th>
            {embryos.map((embryo) => (
              <th
                key={embryo.id}
                scope="col"
                data-subject-id={subjectIds.get(embryo.id)}
                data-embryo-id={embryo.id}
                data-sample-ordinal={embryo.sample_ordinal}
                className={HEADER_CELL}
              >
                <EmbryoChip
                  embryo={{ id: embryo.id, displayLabel: embryo.display_label }}
                  href={route("embryos.detail", { embryoId: embryo.id })}
                  qcFailed={embryo.qc.qc_verdict === "fail"}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={embryos.length + 1} data-slot="no-rows" className="h-14 px-3 py-3 text-base leading-relaxed text-ink">
                {NO_ROWS_SENTENCE}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.findings[0].condition_id} data-condition-id={row.findings[0].condition_id}>
                <th scope="row" className={`h-14 border-b border-line px-3 py-2 text-left align-top font-medium text-ink ${STICKY}`}>
                  {row.findings[0].condition_name}
                </th>
                {row.findings.map((finding, index) => (
                  <td key={embryos[index].id} className="h-14 border-b border-line px-3 py-2 align-top">
                    <CompareCell finding={finding} subjectId={subjectIds.get(embryos[index].id) ?? embryos[index].id} />
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className={`h-14 px-3 py-2 text-left align-top font-medium text-ink ${STICKY}`}>
              {POSITIONS_READ_TH}
            </th>
            {embryos.map((embryo) => (
              <td key={embryo.id} data-slot="column-footer" data-embryo-id={embryo.id} className="h-14 px-3 py-2 align-top">
                <ColumnFooter embryo={embryo} subjectId={subjectIds.get(embryo.id) ?? embryo.id} />
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
