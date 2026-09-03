/**
 * <RegionList> — the always-visible table behind the map (brief §4.6, §3
 * §8.3, A.8): the non-visual equivalent, reachable in zero activations and
 * never hidden from assistive technology. One row per region in descending
 * share order; a row the toggle hides carries `hidden`; the selected row
 * carries `aria-selected`. The share cell is the row's `ancestry-share`
 * figure node, rendered by the parent's <ClaimBlock> and handed in here so
 * every figure keeps exactly one attributed ancestor.
 */
import type { ReactNode } from "react";
import { COLUMN_LABELS, MAP_CAPTION } from "@/copy/ancestry";
import type { RegionRowView } from "@/lib/ancestry/view";
import { cn } from "@/lib/utils";

export interface RegionListProps {
  /** Every row, descending by share. */
  rows: RegionRowView[];
  /** One figure node per row, in the same order. */
  figures: ReactNode[];
  /** Codes the toggle currently shows. */
  visibleCodes: ReadonlySet<string>;
  selectedCode: string | null;
}

export function RegionList({ rows, figures, visibleCodes, selectedCode }: RegionListProps) {
  return (
    <table data-slot="region-table" className="w-full border-collapse text-sm">
      {/* The same sentence as the map's caption, for readers who reach the table without the map. */}
      <caption className="sr-only">{MAP_CAPTION}</caption>
      <thead>
        <tr className="border-b border-line text-left text-ink-muted">
          <th scope="col" className="py-2 pr-3 font-medium">
            {COLUMN_LABELS.region}
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            {COLUMN_LABELS.share}
          </th>
          <th scope="col" className="py-2 font-medium">
            {COLUMN_LABELS.band}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const selected = selectedCode === row.code;
          return (
            <tr
              key={row.code}
              data-slot="region-row"
              data-region={row.code}
              aria-selected={selected}
              hidden={!visibleCodes.has(row.code)}
              className={cn("border-b border-line align-baseline", selected && "bg-tint")}
            >
              <th scope="row" data-slot="region-name" className="py-2 pr-3 text-left font-medium text-ink">
                {row.name}
              </th>
              <td className="py-2 pr-3">{figures[index]}</td>
              <td data-slot="region-band" className="py-2 text-ink-muted">
                {row.band}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
