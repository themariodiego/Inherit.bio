/**
 * <CarrierMatchBlock> — one gene two people both carry a change in (design
 * §2.3; brief lines 211, 346). Server component.
 *
 * One claim block per match, attributed to the pair (`data-subject-pair`)
 * because the arithmetic used both records, with both subject chips in the
 * header. Each person's own reading is a `carrier-status` figure in their
 * own words, and one line per person names their own variant and its
 * classification, as the brief requires ("both variants and both
 * classifications, not just the gene"). The one probability, when it
 * exists, is the exact Mendelian fraction rendered as a natural frequency
 * at the denominator the sentence itself states, so the block carries the
 * exactness label rather than the modelled one.
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
  personVariantLine,
} from "@/copy/family/health-picture";
import {
  DOTS_LEGEND_LABEL,
  OUTCOME_LEGEND,
  OUTCOME_PHRASES,
  derivationLine,
} from "@/copy/family/portrait";
import { ClaimBlock } from "@/components/figures/claim-block";
import type { CarrierMatch } from "@/lib/family/carrier-pair";
import { distribute } from "@/lib/family/distribution";
import { crossShares, type MendelOutcome } from "@/lib/family/mendel";
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
  const readings = [match.a, match.b] as const;
  const statuses: StandaloneFigureSpec[] = readings.map((person) =>
    statusSpec(person.variant.copies),
  );
  // An X-linked cross has no single number: it is a split across five
  // outcomes, so the block renders every outcome the cross produces instead
  // of one fraction. `probability` is null exactly there, which is why this
  // reads the number rather than the kind (D-031).
  const recessive = match.kind === "probability" ? match.probability : null;
  const split =
    match.kind === "probability" && recessive === null
      ? distribute<MendelOutcome>(crossShares(match.cross), OUTCOME_PHRASES)
      : null;
  const frequency = (value: number): StandaloneFigureSpec => ({
    kind: "natural-frequency",
    class: "variant-call",
    basis: "exact",
    provenance: CARRIER_PROVENANCE,
    value,
  });
  const figures: StandaloneFigureSpec[] =
    recessive !== null
      ? [...statuses, frequency(recessive)]
      : split
        ? [...statuses, ...split.categories.map((category) => frequency(category.share))]
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
          {recessive !== null ? (
            // inherit-figure-exempt: the "1 in 4" fragment restates this block's own figure as a fraction
            <p data-slot="carrier-sentence" className="text-base leading-relaxed text-ink">
              {CARRIER_SENTENCE_LEAD} {nodes[2]} {CARRIER_SENTENCE_TAIL}
            </p>
          ) : split && match.kind === "probability" ? (
            <>
              <p
                data-slot="carrier-derivation"
                data-finding="true"
                className="text-base font-medium text-ink tabular-nums"
              >
                {derivationLine(match.cross.outcomes)}
              </p>
              <ul
                data-slot="carrier-outcomes"
                aria-label={DOTS_LEGEND_LABEL}
                className="space-y-2 text-sm text-ink"
              >
                {split.categories.map((category, index) => (
                  <li
                    key={category.key}
                    data-slot="carrier-outcome"
                    data-outcome={category.key}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
                  >
                    <span data-slot="outcome-word" className="font-medium">
                      {OUTCOME_LEGEND[category.key]}
                    </span>
                    {nodes[2 + index]}
                    <span data-slot="outcome-sentence" data-finding="true" className="basis-full">
                      {category.sentence}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : match.kind === "no-probability" ? (
            <p data-slot="carrier-sentence" className="text-base leading-relaxed text-ink">
              {carrierNoProbabilitySentence(match.gene, match.reason)}
            </p>
          ) : null}
        </>
      )}
    >
      <ul data-slot="carrier-variants" className="space-y-1 text-sm leading-relaxed text-ink-muted">
        {readings.map((person, index) => (
          <li key={person.dataSubjectId} data-slot="carrier-variant">
            {personVariantLine(
              people[index].displayLabel,
              person.variant.rsid,
              match.gene,
              person.variant.classification,
            )}
          </li>
        ))}
      </ul>
      <p data-slot="counsellor-route" className="text-sm leading-relaxed text-ink-muted">
        {COUNSELLOR_NO_ROUTE}
      </p>
    </ClaimBlock>
  );
}
