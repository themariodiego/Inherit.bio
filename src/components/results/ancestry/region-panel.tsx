/**
 * <RegionPanel> — the click panel for one region (brief §4.6, §4 §7.4): a
 * non-modal dialog that never navigates. In order: the region name (a
 * paragraph, not a heading — the page's six headings are fixed), the share
 * figure with its band word, the markers line, the reference populations of
 * the region as "{code} — sampled in {place}" (places, never peoples), the
 * neighbouring-regions sentence, the identity sentence and a 44px Close
 * button. Opening, closing and focus movement are owned by the parent.
 */
import type { ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { CLOSE_BUTTON, IDENTITY, SIMILAR_NEIGHBOURS, sampledLine } from "@/copy/ancestry";
import type { RegionRowView } from "@/lib/ancestry/view";

/** One panel is open at a time, so its title id is fixed. */
export const REGION_PANEL_TITLE_ID = "region-panel-title";

export interface RegionPanelProps {
  row: RegionRowView;
  /** The region's `ancestry-share` figure node, rendered by the parent's <ClaimBlock>. */
  figure: ReactNode;
  /** `markersLine(k)` from the page copy, already worded. */
  markersLine: string;
  knownPanel?: boolean;
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

export function RegionPanel({ row, figure, markersLine, closeRef, onClose, knownPanel = true }: RegionPanelProps) {
  return (
    <aside
      data-slot="region-panel"
      data-region={row.code}
      role="dialog"
      aria-modal="false"
      aria-labelledby={REGION_PANEL_TITLE_ID}
      className="space-y-3 self-start rounded-2xl border border-line bg-card p-4 text-sm text-ink"
    >
      <p id={REGION_PANEL_TITLE_ID} data-slot="region-title" className="font-display text-xl">
        {row.name}
      </p>
      <p className="flex flex-wrap items-baseline gap-x-2">
        {figure}
        <span data-slot="region-band" className="text-ink-muted">
          {row.band}
        </span>
      </p>
      <p className="text-ink-muted">{markersLine}</p>
      {knownPanel ? <ul data-slot="region-populations" className="space-y-1 text-ink-muted">
        {row.populations.map((population) => (
          <li key={population.code}>{sampledLine(population.code, population.place)}</li>
        ))}
      </ul> : null}
      {knownPanel ? <p>{SIMILAR_NEIGHBOURS}</p> : null}
      <p className="text-ink-muted">{IDENTITY}</p>
      <Button ref={closeRef} type="button" variant="outline" onClick={onClose} className="h-11 px-5">
        {CLOSE_BUTTON}
      </Button>
    </aside>
  );
}
