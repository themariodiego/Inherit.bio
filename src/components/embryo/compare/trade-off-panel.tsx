/**
 * <TradeOffPanel> — the joint-selection constraint (G4.5; brief §4 §6.8,
 * §2 §6.2, §3 §8.5; X10.3). Permanent, non-dismissible, outside any
 * collapsible, computed over the full matrix by `deriveTradeOffs`. It
 * renders a statement and, when one exists, the real conflicts by name —
 * never a per-embryo count, a composite or a "best". Server component.
 */
import {
  CANNOT_HAVE_BEST_OF_EACH,
  NO_RANKING_STATEMENT,
  TRADEOFFS_EXISTS,
  TRADEOFFS_NONE_MEASURABLE,
  TRADEOFF_LINE_ONE,
  availabilityStatement,
  conflictLine,
} from "@/copy/embryos/tradeoffs";
import type { TradeOffs } from "@/lib/embryos/policy";

export interface TradeOffPanelProps {
  tradeOffs: TradeOffs;
  /** The condition names the conflicts refer to, keyed by condition id. */
  conditionNames: ReadonlyMap<string, string>;
  /** How many embryos the page shows: the availability statement's count. */
  embryoCount: number;
}

export function TradeOffPanel({ tradeOffs, conditionNames, embryoCount }: TradeOffPanelProps) {
  const exists = tradeOffs.statement_copy_id === "embryo.tradeoffs.exists";
  return (
    <section
      data-trade-off-panel="true"
      data-slot="trade-off-panel"
      data-statement={tradeOffs.statement_copy_id}
      aria-label={NO_RANKING_STATEMENT}
      className="max-w-prose space-y-2 rounded-2xl border border-line bg-card p-5 text-base leading-relaxed text-ink"
    >
      <p>{TRADEOFF_LINE_ONE}</p>
      <p data-slot="no-ranking-statement" className="font-medium">
        {NO_RANKING_STATEMENT}
      </p>
      <p>{CANNOT_HAVE_BEST_OF_EACH}</p>
      <p data-slot="trade-off-statement">{exists ? TRADEOFFS_EXISTS : TRADEOFFS_NONE_MEASURABLE}</p>
      {exists ? (
        <ul data-slot="trade-off-conflicts" className="list-disc space-y-1 pl-5">
          {tradeOffs.conflicts.map((conflict) => (
            <li key={`${conflict.embryo_label}-${conflict.lowest_condition_id}-${conflict.highest_condition_id}`}>
              {conflictLine(
                conflict.embryo_label,
                conditionNames.get(conflict.lowest_condition_id) ?? conflict.lowest_condition_id,
                conditionNames.get(conflict.highest_condition_id) ?? conflict.highest_condition_id,
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <p data-slot="availability-statement" className="text-sm text-ink-muted">
        {availabilityStatement(embryoCount)}
      </p>
    </section>
  );
}
