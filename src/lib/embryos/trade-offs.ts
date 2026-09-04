/**
 * The trade-off panel's derivation (brief §4 §6.8, §2 §6.2; X10.3; register
 * `closedShapes.tradeOffs`). Pure, never persisted, and the one home of the
 * conflict rule (docs/canonical-artifacts.md).
 *
 * Over the full published finding matrix — every embryo, every condition,
 * never a filtered subset — it finds, per embryo, one condition on which that
 * embryo alone has the lowest absolute risk and one on which it alone has the
 * highest. Each such embryo is one real conflict. Ties are excluded: two
 * embryos with the same value are not "lowest" or "highest", and a row with
 * fewer than two numeric findings cannot set one embryo against another.
 *
 * It exposes no per-embryo count, no composite and no order: the output is
 * a statement id and a list of named conflicts, nothing more.
 */
import type { EmbryoFinding, TradeOffCopyId, TradeOffConflict, TradeOffs } from "./policy";

export const CONFLICT_COPY_ID = "embryo.tradeoffs.conflict";

/** One row of the matrix: the findings of one condition, in ascending sample_ordinal. */
export type FindingMatrix = readonly (readonly EmbryoFinding[])[];

function numericRisk(finding: EmbryoFinding): number | null {
  return finding.finding !== null && finding.finding.kind === "absolute_risk"
    ? finding.finding.absolute_risk
    : null;
}

interface RowExtremes {
  conditionId: string;
  /** The label of the one embryo strictly below every other, or null on a tie or a thin row. */
  lowest: string | null;
  highest: string | null;
}

function rowExtremes(row: readonly EmbryoFinding[]): RowExtremes | null {
  if (row.length === 0) return null;
  const numeric = row
    .map((finding) => ({ label: finding.embryo_label, risk: numericRisk(finding) }))
    .filter((item): item is { label: string; risk: number } => item.risk !== null);
  if (numeric.length < 2) return { conditionId: row[0].condition_id, lowest: null, highest: null };
  const minimum = Math.min(...numeric.map((item) => item.risk));
  const maximum = Math.max(...numeric.map((item) => item.risk));
  const atMinimum = numeric.filter((item) => item.risk === minimum);
  const atMaximum = numeric.filter((item) => item.risk === maximum);
  return {
    conditionId: row[0].condition_id,
    lowest: atMinimum.length === 1 && minimum < maximum ? atMinimum[0].label : null,
    highest: atMaximum.length === 1 && minimum < maximum ? atMaximum[0].label : null,
  };
}

/**
 * The statement and the real conflicts, or the none-measurable statement with
 * an empty list. When any conflict exists, no embryo can be lowest on every
 * row, so "No embryo is first on every row." is true by construction.
 */
export function deriveTradeOffs(matrix: FindingMatrix): TradeOffs {
  const extremes = matrix
    .map(rowExtremes)
    .filter((row): row is RowExtremes => row !== null);
  const labels = new Set<string>();
  for (const row of matrix) for (const finding of row) labels.add(finding.embryo_label);

  const conflicts: TradeOffConflict[] = [];
  for (const label of labels) {
    const lowest = extremes.find((row) => row.lowest === label);
    const highest = extremes.find((row) => row.highest === label);
    if (!lowest || !highest) continue;
    conflicts.push({
      embryo_label: label,
      lowest_condition_id: lowest.conditionId,
      highest_condition_id: highest.conditionId,
      copy_id: CONFLICT_COPY_ID,
    });
  }

  const statement_copy_id: TradeOffCopyId =
    conflicts.length > 0 ? "embryo.tradeoffs.exists" : "embryo.tradeoffs.none-measurable";
  return { statement_copy_id, conflicts };
}
