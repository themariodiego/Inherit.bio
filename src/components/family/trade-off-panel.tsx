/**
 * <TradeOffPanel> — the standing statement above the table (G4.5; brief
 * §9 item 19). Server component.
 *
 * G4.5 asks a comparison surface to make its joint-selection constraint
 * visible. Here that is satisfied by statement, never by computation: the
 * page says in words that nothing on it picks between people, that Inherit
 * does not rank, why these people and no others appear, and what each
 * column is — a count of that person's own rows, compared with nobody.
 *
 * The panel is not collapsible and adds no heading, so the surface stays
 * inside its heading budget; its accessible name is on the section.
 */
import {
  NOTHING_PICKS_BETWEEN_PEOPLE,
  NO_RANKING_STATEMENT,
  TRADE_OFF_PANEL_LABEL,
  availabilityStatement,
  perPersonTradeOff,
} from "@/copy/family/health-picture";

export interface TradeOffRow {
  dataSubjectId: string;
  displayLabel: string;
  /** How many rows this person's own file answered. */
  results: number;
}

export function TradeOffPanel({ rows }: { rows: readonly TradeOffRow[] }) {
  return (
    <section
      data-trade-off-panel="true"
      aria-label={TRADE_OFF_PANEL_LABEL}
      className="max-w-prose space-y-3 rounded-2xl border border-line bg-card p-6"
    >
      <p className="text-base leading-relaxed text-ink">{NOTHING_PICKS_BETWEEN_PEOPLE}</p>
      <p className="text-base leading-relaxed text-ink">{NO_RANKING_STATEMENT}</p>
      <p className="text-base leading-relaxed text-ink">
        {/* inherit-figure-exempt: a count of the people who agreed, not a result */}
        {availabilityStatement(rows.length)}
      </p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li
            key={row.dataSubjectId}
            data-slot="trade-off-row"
            className="text-sm leading-relaxed text-ink-muted"
          >
            {/* inherit-figure-exempt: a count of this person's own rows, not a result */}
            {perPersonTradeOff(row.displayLabel, row.results)}
          </li>
        ))}
      </ul>
    </section>
  );
}
