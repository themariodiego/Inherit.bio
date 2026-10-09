/**
 * <CarrierPanel> — the section above the table (design §2.3; brief line
 * 346). Server component.
 *
 * One group per pair of people, one block per gene that pair both carry a
 * change in, and one sentence where a pair carries none: the count of
 * classified positions both files cover when there was something to check,
 * or the plain statement that the reference table classifies nothing yet
 * (D-034). The panel never says how many matches there are before it lists
 * them, never orders them by anything but gene, and never turns two
 * people's shared letters into a statement about how they are related.
 *
 * Where at least one block renders, the panel ends with the provenance of
 * the runs check every block rests on: the cited definition of a run, with
 * its DOI as the link (D-040).
 *
 * Where the panel shows any result, a shared change or none, it also states
 * once what the check cannot tell you (`CARRIER_LIMITS`, 27 Sep 2026). The
 * "unavailable" sentence is not a result, so it never carries them.
 */
import {
  CARRIER_LIMITS,
  CARRIER_LIMITS_HEADING,
  CARRIER_MATCHES_HEADING,
  CARRIER_MATCHES_ID,
  NO_CLASSIFIED_POSITIONS,
  RUNS_PROVENANCE,
  RUNS_SOURCE_DOI,
  RUNS_SOURCE_URL,
  noCarrierMatches,
} from "@/copy/family/health-picture";
import type { CarrierMatch } from "@/lib/family/carrier-pair";
import { CarrierMatchBlock } from "./carrier-match-block";
import type { HealthPictureColumn } from "./health-picture-table";

export interface CarrierPairGroup {
  key: string;
  /** The two people the matches are about, in the order the matches name them. */
  people: readonly [HealthPictureColumn, HealthPictureColumn];
  matches: readonly CarrierMatch[];
  /** Classified positions in the reference set; zero means nothing could be checked. */
  classifiedPositions: number;
  /** Classified positions both files cover: page furniture, not a result. */
  positionsBothCover: number;
}

export function CarrierPanel({
  groups,
  viewerAccountId,
  unavailableCopy,
}: {
  groups: readonly CarrierPairGroup[];
  viewerAccountId: string;
  /**
   * The register's own sentence when the jurisdiction has not reviewed the
   * carrier response (`response:carrier-arithmetic`). A refusal is never a
   * blank section: the heading stays and the sentence replaces the blocks.
   */
  unavailableCopy?: string;
}) {
  const anyBlock = !unavailableCopy && groups.some((group) => group.matches.length > 0);
  const anyResult = !unavailableCopy
    && groups.some((group) => group.matches.length > 0 || group.classifiedPositions > 0);
  return (
    <section
      id={CARRIER_MATCHES_ID}
      data-slot="carrier-panel"
      aria-labelledby="carrier-matches-heading"
      className="plate"
    >
      <div className="plate-head">
        <h2 id="carrier-matches-heading" className="title text-ink">
          {CARRIER_MATCHES_HEADING}
        </h2>
      </div>
      <div className="plate-body space-y-4">
      {unavailableCopy ? (
        <p role="status" className="max-w-measure text-base leading-relaxed text-ink">
          {unavailableCopy}
        </p>
      ) : null}
      {(unavailableCopy ? [] : groups).map((group) => (
        <div key={group.key} data-slot="carrier-group" className="space-y-4">
          {group.matches.length === 0 ? (
            <p role="status" data-state={group.classifiedPositions === 0 ? "unavailable" : "empty"} data-slot="carrier-empty" className="max-w-measure text-base leading-relaxed text-ink">
              {group.classifiedPositions === 0
                ? NO_CLASSIFIED_POSITIONS
                : // inherit-figure-exempt: a count of positions both files cover, not a result
                  noCarrierMatches(group.positionsBothCover)}
            </p>
          ) : (
            <ul className="space-y-4">
              {group.matches.map((match) => (
                <li key={match.gene}>
                  <CarrierMatchBlock
                    match={match}
                    people={group.people}
                    viewerAccountId={viewerAccountId}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {anyResult ? (
        <div data-slot="carrier-limits" className="max-w-measure space-y-2 border-t border-line pt-4">
          <h3 className="label text-ink">{CARRIER_LIMITS_HEADING}</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink-muted">
            {CARRIER_LIMITS.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {anyBlock ? (
        <p data-slot="runs-provenance" className="caption max-w-measure">
          {RUNS_PROVENANCE}{" "}
          <a
            href={RUNS_SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="prose-link"
          >
            {RUNS_SOURCE_DOI}
          </a>
        </p>
      ) : null}
      </div>
    </section>
  );
}
