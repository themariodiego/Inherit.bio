/**
 * The closed DTOs the embryo pages hand to their renderers (register
 * `shapeBindings.RSC`: `embryos.index` → rscEmbryoListItem[], `embryos.compare`
 * → rscEmbryoComparison, `embryos.detail` → rscEmbryoDetail). Pure builders
 * over plain rows; every result passes `assertEmbryoDto` before it is
 * returned, so an unknown key or a broken cardinality throws
 * `EmbryoShapeError` rather than crossing the server-component boundary.
 *
 * Nothing here computes a result: findings arrive from `embryo_scores` as
 * the worker wrote them and are projected in registry order. The context
 * counts come only from `contextStrip`, the trade-offs only from
 * `deriveTradeOffs`, and the standing statement from its one copy home.
 */
import { STANDING_STATEMENT } from "@/copy/embryos/compare";
import { contextStrip } from "./qc-policy";
import {
  assertEmbryoDto,
  columnOrder,
  displayedFigure,
  resultRowOrder,
  type ComparisonEmbryo,
  type ComparisonResultRow,
  type EmbryoFinding,
  type EmbryoStatus,
  type QcDto,
  type RscEmbryoComparison,
  type RscEmbryoDetail,
  type RscEmbryoListItem,
} from "./policy";
import { deriveTradeOffs } from "./trade-offs";
import { UNKNOWN_EMBRYO_INPUT, type EmbryoInputFacts } from "./input-facts";

/** The `embryos` columns a projection reads. */
export interface EmbryoRow {
  id: string;
  cohort_id: string;
  sample_ordinal: number;
  display_label: string;
  status: EmbryoStatus;
}

/** The `embryo_qc` row, as stored (the twenty projected fields plus its key). */
export interface EmbryoQcRow extends Omit<QcDto, "source_facts"> {
  embryo_id: string;
  source_facts?: EmbryoInputFacts;
}

/** The `embryo_scores` columns a projection reads, with the finding already parsed. */
export interface EmbryoScoreRow {
  embryo_id: string;
  condition_id: string;
  condition_name: string;
  finding: EmbryoFinding["finding"];
  evidence_label: EmbryoFinding["evidence_label"];
  coverage_state: EmbryoFinding["coverage_state"];
  citation_ids: string[];
  not_covered_reason: string | null;
}

const QC_KEYS: readonly (keyof QcDto)[] = [
  "sites_expected",
  "sites_called",
  "call_rate",
  "autosomal_het_rate",
  "mean_depth",
  "parent_a_concordance",
  "parent_b_concordance",
  "allelic_dropout_estimate",
  "allelic_dropout_interval_low",
  "allelic_dropout_interval_high",
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
];

/** Exactly the twenty projected fields, in register order; every number passes `displayedFigure` unchanged. */
export function projectQc(row: EmbryoQcRow): QcDto {
  const qc = {} as Record<keyof QcDto, unknown>;
  for (const key of QC_KEYS) {
    const value = row[key];
    qc[key] = typeof value === "number" ? displayedFigure(value) : value;
  }
  qc.source_facts = row.source_facts ?? { ...UNKNOWN_EMBRYO_INPUT };
  return assertEmbryoDto("qc", qc as unknown as QcDto);
}

export function projectListItem(row: EmbryoRow): RscEmbryoListItem {
  return assertEmbryoDto("rscEmbryoListItem", {
    id: row.id,
    cohort_id: row.cohort_id,
    sample_ordinal: row.sample_ordinal,
    display_label: row.display_label,
    status: row.status,
  });
}

/** One finding leaf from a score row: the eight keys and nothing else. */
export function projectFinding(row: EmbryoScoreRow, embryoLabel: string): EmbryoFinding {
  return assertEmbryoDto("EmbryoFinding", {
    embryo_label: embryoLabel,
    condition_id: row.condition_id,
    condition_name: row.condition_name,
    finding: row.finding,
    evidence_label: row.evidence_label,
    coverage_state: row.coverage_state,
    citation_ids: row.citation_ids,
    not_covered_reason: row.not_covered_reason,
  });
}

export interface DetailInput {
  embryo: EmbryoRow;
  qc: EmbryoQcRow;
  scores: readonly EmbryoScoreRow[];
  /** The exact current registry condition ids; a score outside it is dropped before projection. */
  registeredConditionIds: ReadonlySet<string>;
}

export function projectDetail(input: DetailInput): RscEmbryoDetail {
  const findings = resultRowOrder(
    input.scores
      .filter((row) => row.embryo_id === input.embryo.id && input.registeredConditionIds.has(row.condition_id))
      .map((row) => projectFinding(row, input.embryo.display_label)),
  );
  return assertEmbryoDto("rscEmbryoDetail", {
    ...projectListItem(input.embryo),
    qc: projectQc(input.qc),
    findings,
  });
}

export interface ComparisonInput {
  cohortId: string;
  embryos: readonly EmbryoRow[];
  qcRows: readonly EmbryoQcRow[];
  scores: readonly EmbryoScoreRow[];
  registeredConditionIds: ReadonlySet<string>;
}

/**
 * The comparison: every embryo with a QC row as a column in ordinal order,
 * one row per registered condition every column has a finding for, the
 * three counts and the trade-offs over the full matrix. An embryo without a
 * QC row is not yet terminal and is not a column (the page renders the
 * processing state instead).
 */
export function projectComparison(input: ComparisonInput): RscEmbryoComparison {
  const qcByEmbryo = new Map(input.qcRows.map((row) => [row.embryo_id, row]));
  const embryos: ComparisonEmbryo[] = columnOrder(input.embryos)
    .filter((embryo) => qcByEmbryo.has(embryo.id))
    .map((embryo) => ({
      id: embryo.id,
      sample_ordinal: embryo.sample_ordinal,
      display_label: embryo.display_label,
      status: embryo.status,
      qc: projectQc(qcByEmbryo.get(embryo.id)!),
    }));

  // Every stored finding is validated as it is read, before any row is
  // judged complete: a malformed row fails closed rather than being dropped
  // on the way to the screen.
  const labelByEmbryo = new Map(embryos.map((embryo) => [embryo.id, embryo.display_label]));
  const byCondition = new Map<string, Map<string, EmbryoFinding>>();
  for (const row of input.scores) {
    if (!input.registeredConditionIds.has(row.condition_id)) continue;
    const label = labelByEmbryo.get(row.embryo_id);
    if (label === undefined) continue;
    const perEmbryo = byCondition.get(row.condition_id) ?? new Map<string, EmbryoFinding>();
    perEmbryo.set(row.embryo_id, projectFinding(row, label));
    byCondition.set(row.condition_id, perEmbryo);
  }
  const conditionIds = resultRowOrder([...byCondition.keys()].map((condition_id) => ({ condition_id }))).map(
    (item) => item.condition_id,
  );
  const result_rows: ComparisonResultRow[] = [];
  for (const conditionId of conditionIds) {
    const perEmbryo = byCondition.get(conditionId)!;
    // A row is complete only when every column has its finding; a partial
    // row would show one embryo before the set (canonical-source-publication-v1).
    if (embryos.some((embryo) => !perEmbryo.has(embryo.id))) continue;
    result_rows.push({ findings: embryos.map((embryo) => perEmbryo.get(embryo.id)!) });
  }

  return assertEmbryoDto("rscEmbryoComparison", {
    cohort_id: input.cohortId,
    context_counts: contextStrip(embryos.map((embryo) => embryo.qc)),
    embryos,
    result_rows,
    trade_offs: deriveTradeOffs(result_rows.map((row) => row.findings)),
    standing_statement: STANDING_STATEMENT,
  });
}
