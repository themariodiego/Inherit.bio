/**
 * <CarrierPanel> — the section above the table (design §2.3; brief line
 * 346). Server component.
 *
 * One group per pair of people, one block per change that pair both carry,
 * and one sentence where a pair carries none. The panel never says how many
 * matches there are before it lists them, never orders them by anything but
 * position, and never turns two people's shared letters into a statement
 * about how they are related.
 */
import {
  CARRIER_MATCHES_HEADING,
  CARRIER_MATCHES_ID,
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
  return (
    <section
      id={CARRIER_MATCHES_ID}
      data-slot="carrier-panel"
      aria-labelledby="carrier-matches-heading"
      className="space-y-4"
    >
      <h2 id="carrier-matches-heading" className="text-lg font-semibold">
        {CARRIER_MATCHES_HEADING}
      </h2>
      {unavailableCopy ? (
        <p role="status" className="max-w-prose text-base leading-relaxed text-ink">
          {unavailableCopy}
        </p>
      ) : null}
      {(unavailableCopy ? [] : groups).map((group) => (
        <div key={group.key} data-slot="carrier-group" className="space-y-4">
          {group.matches.length === 0 ? (
            <p className="max-w-prose text-base leading-relaxed text-ink">
              {/* inherit-figure-exempt: a count of positions both files cover, not a result */}
              {noCarrierMatches(group.positionsBothCover)}
            </p>
          ) : (
            <ul className="space-y-4">
              {group.matches.map((match) => (
                <li key={match.rsid}>
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
    </section>
  );
}
