import { ClaimBlock } from "@/components/figures/claim-block";
import {
  TRACK_EMPTY_NOTE, TRACK_LOADED_RANGE_LABEL, TRACK_OUTSIDE_NOTE,
  TRACK_REMOVED_NOTE, TRACK_TEXT_FAILED, TRACK_TEXT_LOADING,
  TRACK_TRUNCATED_NOTE, TRACK_WINDOW_NOTE,
} from "@/copy/genome/data";
import { loadedTrackFigures } from "@/lib/genome/browser-figures";
import { chromToName } from "@/lib/genome/types";
import type { TrackTextSnapshot } from "./igv-track-data";

/** Plain text is present without opening a disclosure or selecting a mark. */
export function TrackTextAlternative({ subjectId, loadedRange, truncated, snapshot }: {
  subjectId: string;
  loadedRange: string;
  truncated: boolean;
  snapshot: TrackTextSnapshot;
}) {
  return <div data-slot="genome-track-alternative" data-track-status={snapshot.status} className="space-y-3 text-sm">
    <p>{TRACK_LOADED_RANGE_LABEL}: <span className="break-all font-mono">{loadedRange}</span></p>
    <p className="max-w-prose text-ink-muted">{TRACK_WINDOW_NOTE}</p>
    {truncated ? <p className="max-w-prose text-ink-muted">{TRACK_TRUNCATED_NOTE}</p> : null}
    <p role="status" className="max-w-prose text-ink-muted">
      {snapshot.status === "loading" ? TRACK_TEXT_LOADING
        : snapshot.status === "removed" ? TRACK_REMOVED_NOTE
          : snapshot.status === "error" ? TRACK_TEXT_FAILED : null}
    </p>
    {snapshot.views.map((view, index) => <div key={index} data-track-view={index} className="space-y-2">
      {/* inherit-figure-exempt: the native viewport range identifies positions. */}
      <p data-track-range className="break-all font-mono">{view.range}</p>
      {view.outsideLoadedRange ? <p className="max-w-prose text-ink-muted">{TRACK_OUTSIDE_NOTE}</p> : null}
      <ClaimBlock subject={{ subjectId }} figures={loadedTrackFigures(view.rows)}
        className="relative"
        renderFigures={figures => <>
          <dl data-track-count={view.rows.length} className="space-y-3">
            {view.rows.map((row, rowIndex) => <div key={row.key} data-track-feature={row.key} className="break-words">
              <dt className="font-mono">
                {/* inherit-figure-exempt: rsID, coordinates and alleles identify the source call. */}
                {row.rsid !== null ? `rs${row.rsid} · ` : ""}
                {`chr${chromToName(row.chrom)}:${row.pos}`}
                {row.ref && row.alt ? ` ${row.ref}→${row.alt}` : null}
              </dt>
              <dd className="mt-1">{figures[rowIndex]}</dd>
            </div>)}
          </dl>
          {!view.rows.length ? <p className="mt-2 text-ink-muted">{TRACK_EMPTY_NOTE}</p> : null}
        </>} />
    </div>)}
  </div>;
}
