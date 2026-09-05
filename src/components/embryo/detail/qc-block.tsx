/**
 * <QcBlock> — the always-visible quality block under "How sure we are" on
 * an embryo's page (design §2.3; brief line 414, 1398, 1402, 2229). Server
 * component. One claim block attributed to the embryo's subject: the
 * positions read as the coverage figure, the verdict word, every measured
 * rate as a figure sharing the block denominator, the dropout sentence when
 * it was not measured, "Not stated by the source laboratory" for every null
 * source field and "not measurable from this file" for every null metric.
 */
import type { ReactNode } from "react";
import { EmbryoInputProvenance } from "@/components/embryo/input-provenance";
import { ClaimBlock } from "@/components/figures/claim-block";
import { coverageSpec, dropoutSpec, isZeroRate, rateSpec } from "@/components/embryo/qc-figures";
import { verdictWord } from "@/components/embryo/compare/qc-table";
import {
  DROPOUT_NOT_MEASURED,
  NONE_WORD,
  NOT_MEASURABLE_FROM_FILE,
  NOT_STATED_BY_SOURCE,
  QC_FIELD_LABELS,
  QC_MARGINAL_QUALIFIER,
  QC_REASON_WORDS,
} from "@/copy/embryos/qc";
import type { QcDto } from "@/lib/embryos/policy";
import { mapQcReason } from "@/lib/embryos/qc-policy";
import { sourceLabelText, type SourceLabelField } from "@/lib/embryos/source-labels";
import type { StandaloneFigureSpec } from "@/lib/figures/spec";

const RATE_FIELDS = [
  "autosomal_het_rate",
  "parent_a_concordance",
  "parent_b_concordance",
  "contamination_estimate",
] as const;

const SOURCE_FIELDS = ["source_laboratory", "source_assay", "amplification_method", "allelic_dropout_method"] as const;

export function QcBlock({ qc, embryoId, subjectId }: { qc: QcDto; embryoId: string; subjectId: string }) {
  const figures: StandaloneFigureSpec[] = [coverageSpec(qc)];
  const rateIndex = new Map<(typeof RATE_FIELDS)[number], number>();
  for (const field of RATE_FIELDS) {
    const value = qc[field];
    if (value !== null && !isZeroRate(value)) rateIndex.set(field, figures.push(rateSpec(value)) - 1);
  }
  const dropout = dropoutSpec(qc, embryoId);
  const dropoutIndex = dropout ? figures.push(dropout) - 1 : null;
  const reasons = [...new Set(qc.qc_reasons.map(mapQcReason))];

  return (
    <ClaimBlock
      subject={{ subjectId }}
      figures={figures}
      densityPrimaryClaim
      renderFigures={(nodes: ReactNode[]) => (
        <dl data-slot="qc-block" className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="font-medium text-ink">{QC_FIELD_LABELS.call_rate}</dt>
          <dd data-slot="qc-coverage">{nodes[0]}</dd>
          <dt className="font-medium text-ink">{QC_FIELD_LABELS.qc_verdict}</dt>
          <dd data-slot="qc-verdict" data-verdict={qc.qc_verdict}>
            {verdictWord(qc.qc_verdict)}
            {qc.qc_verdict === "marginal" ? <span className="block text-ink-muted">{QC_MARGINAL_QUALIFIER}</span> : null}
            {reasons.length > 0 ? (
              <span className="block text-ink-muted">{reasons.map((reason) => QC_REASON_WORDS[reason]).join("; ")}</span>
            ) : null}
          </dd>
          {RATE_FIELDS.map((field) => (
            <RateRow key={field} label={QC_FIELD_LABELS[field]} field={field} value={qc[field]} node={rateIndex.has(field) ? nodes[rateIndex.get(field)!] : null} />
          ))}
          <dt className="font-medium text-ink">{QC_FIELD_LABELS.allelic_dropout_estimate}</dt>
          <dd data-slot="qc-dropout" data-measured={dropoutIndex !== null ? "true" : "false"}>
            {dropoutIndex !== null ? nodes[dropoutIndex] : DROPOUT_NOT_MEASURED}
          </dd>
          {SOURCE_FIELDS.map((field) => (
            <SourceRow key={field} label={QC_FIELD_LABELS[field]} field={field} value={qc[field]} />
          ))}
          <dt className="font-medium text-ink">{QC_FIELD_LABELS.source_facts}</dt>
          <dd><EmbryoInputProvenance facts={qc.source_facts} /></dd>
        </dl>
      )}
    />
  );
}

function RateRow({ label, field, value, node }: { label: string; field: string; value: number | null; node: ReactNode | null }) {
  return (
    <>
      <dt className="font-medium text-ink">{label}</dt>
      <dd data-slot="qc-rate" data-field={field}>
        {value === null ? NOT_MEASURABLE_FROM_FILE : isZeroRate(value) ? NONE_WORD : node}
      </dd>
    </>
  );
}

function SourceRow({ label, field, value }: { label: string; field: SourceLabelField; value: string | null }) {
  return (
    <>
      <dt className="font-medium text-ink">{label}</dt>
      <dd data-slot="qc-source" data-field={field}>
        {sourceLabelText(field, value) ?? NOT_STATED_BY_SOURCE}
      </dd>
    </>
  );
}
