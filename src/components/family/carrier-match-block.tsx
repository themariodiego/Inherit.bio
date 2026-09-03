/**
 * <CarrierMatchBlock> — one change two people both carry (design §2.3;
 * brief lines 211, 346). Server component.
 *
 * One claim block per match, attributed to the pair (`data-subject-pair`)
 * because the arithmetic used both records, with both subject chips in the
 * header. Each person's own reading is a `carrier-status` figure in their
 * own words; the one probability, when it exists, is the exact Mendelian
 * fraction rendered as a natural frequency at the denominator the sentence
 * itself states, so the block carries the exactness label rather than the
 * modelled one.
 *
 * When no probability exists the block renders no number at all: the
 * mandated sentence names the reason, and the counsellor line follows it.
 * Nothing here computes shared DNA, a relationship or a kinship quantity —
 * `evaluateCarrierPairs` has no such value to give it.
 */
import {
  CARRIER_SENTENCE_LEAD,
  CARRIER_SENTENCE_TAIL,
  COUNSELLOR_NO_ROUTE,
  carrierPersonPrefix,
  carrierNoProbabilitySentence,
  classificationLine,
} from "@/copy/family/health-picture";
import { ClaimBlock } from "@/components/figures/claim-block";
import type { CarrierMatch } from "@/lib/family/carrier-pair";
import type { StandaloneFigureSpec } from "@/lib/figures/spec";
import { SubjectChip, type HealthPictureColumn } from "./health-picture-table";

const CARRIER_PROVENANCE = { kind: "computed", module: "family/carrier-pair" } as const;

function statusSpec(status: string): StandaloneFigureSpec {
  return {
    kind: "carrier-status",
    class: "variant-call",
    basis: "observed",
    provenance: CARRIER_PROVENANCE,
    status,
  };
}

export interface CarrierMatchBlockProps {
  match: CarrierMatch;
  /** The two people the pair is about, in the same order as the match. */
  people: readonly [HealthPictureColumn, HealthPictureColumn];
  viewerAccountId: string;
}

export function CarrierMatchBlock({ match, people, viewerAccountId }: CarrierMatchBlockProps) {
  const statuses: StandaloneFigureSpec[] = [
    statusSpec(match.a.copies),
    statusSpec(match.b.copies),
  ];
  const figures: StandaloneFigureSpec[] =
    match.kind === "probability"
      ? [
          ...statuses,
          {
            kind: "natural-frequency",
            class: "variant-call",
            basis: "exact",
            provenance: CARRIER_PROVENANCE,
            value: match.probability,
          },
        ]
      : statuses;

  return (
    <ClaimBlock
      subject={{ subjectPair: [match.a.dataSubjectId, match.b.dataSubjectId] }}
      figures={figures}
      denominator={match.kind === "probability" ? 100 : undefined}
      className="space-y-3"
      renderFigures={(nodes) => (
        <>
          <div data-slot="carrier-chips" className="flex flex-wrap gap-x-6 gap-y-3">
            {people.map((person, index) => (
              <span
                key={person.dataSubjectId}
                data-slot="carrier-person"
                className="flex flex-wrap items-center gap-2 text-sm text-ink"
              >
                <SubjectChip column={person} viewerAccountId={viewerAccountId} />
                <span className="sr-only">
                  {carrierPersonPrefix(person.displayLabel)}
                </span>
                {nodes[index]}
              </span>
            ))}
          </div>
          {match.kind === "probability" ? (
            // inherit-figure-exempt: the "1 in 4" fragment restates this block's own figure as a fraction
            <p data-slot="carrier-sentence" className="text-base leading-relaxed text-ink">
              {CARRIER_SENTENCE_LEAD} {nodes[2]} {CARRIER_SENTENCE_TAIL}
            </p>
          ) : (
            <p data-slot="carrier-sentence" className="text-base leading-relaxed text-ink">
              {carrierNoProbabilitySentence(match.gene, match.reason)}
            </p>
          )}
        </>
      )}
    >
      <p className="text-sm leading-relaxed text-ink-muted">
        {classificationLine(match.gene, match.classification)}
      </p>
      <p data-slot="counsellor-route" className="text-sm leading-relaxed text-ink-muted">
        {COUNSELLOR_NO_ROUTE}
      </p>
    </ClaimBlock>
  );
}
