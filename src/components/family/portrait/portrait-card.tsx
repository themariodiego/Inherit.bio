/**
 * The Portrait output cards (design §2.5; brief §2 §5.6 lines 354-360, §4
 * §5.1-5.3 lines 1345-1349, A.7 line 2238, G5.9(b) line 2650). Server
 * components.
 *
 * One claim block per output, attributed to the pair (`data-subject-pair`)
 * with both chips in its header, because the arithmetic used both records.
 * Three cards exist today:
 *
 *   - <CarrierPairCard> for a match the carrier rule answered with the one
 *     fraction: the recessive cross from each file's one changed copy
 *     (`autosomalCross`), rendered as the mandated derivation line, the
 *     100-dot distribution with three exact natural-frequency figures at the
 *     forced denominator, the covered-against-known count, the segregation
 *     sentence, the "How sure we are" block and the chance-not-prediction
 *     line. The block carries the exactness label once, from the contract.
 *   - <CarrierPairCard> for a match the rule refused: the same sentence the
 *     side-by-side page prints with its named reason (an X-linked pattern
 *     included, D-031), or the brief's runs refusal, and no figure but the
 *     two status readings. Never a 1-in-4.
 *   - <OneSidedCard> for a gene where one file shows one copy and the other
 *     shows none: the brief's no-second-copy sentence where the other file
 *     reports a known position, its cannot-calculate sentence where it
 *     reports none. No distribution renders, because a distribution would
 *     say "zero affected", which the brief forbids (line 2238).
 *
 * Nothing here computes a relatedness quantity, ranks anything, predicts a
 * sex or shows a picture; and no card is about one child.
 */
import { ClaimBlock } from "@/components/figures/claim-block";
import {
  ASSUMPTION_STATEMENTS,
  BOTH_FILES_COVERED,
  CARRIER_WHAT_WOULD_CHANGE,
  CHANCE_NOT_PREDICTION,
  COUNSELLOR_NO_ROUTE,
  NO_COPY_FOUND_READING,
  NO_PATTERN_DESCRIPTION,
  OUTCOME_LEGEND,
  OUTCOME_PHRASES,
  PATTERN_DESCRIPTIONS,
  POSITIONS_NOT_COVERED_READING,
  REFUSAL_ASSUMPTION,
  REFUSAL_WHAT_WOULD_CHANGE,
  RUNS_ASSUMPTION,
  RUNS_REFUSAL,
  RUNS_WHAT_WOULD_CHANGE,
  SEGREGATION_SENTENCE,
  cannotCalculate,
  carrierNoProbabilitySentence,
  derivationLine,
  knownChangesCovered,
  noSecondCopy,
  oneSidedWhatWouldChange,
  outputHeading,
  personVariantLine,
} from "@/copy/family/portrait";
import type { CarrierMatch, CarrierReason } from "@/lib/family/carrier-pair";
import { distribute } from "@/lib/family/distribution";
import { autosomalCross, crossShares, type MendelCross, type MendelOutcome } from "@/lib/family/mendel";
import type { GeneCoverage, OneSidedReading } from "@/lib/family/portrait";
import type { StandaloneFigureSpec } from "@/lib/figures/spec";
import { SubjectChip, type HealthPictureColumn } from "../health-picture-table";
import { HowSureBlock } from "./how-sure-block";
import { OutcomeDots } from "./outcome-dots";

const PORTRAIT_PROVENANCE = { kind: "computed", module: "family/portrait" } as const;

function statusSpec(status: string): StandaloneFigureSpec {
  return {
    kind: "carrier-status",
    class: "variant-call",
    basis: "observed",
    provenance: PORTRAIT_PROVENANCE,
    status,
  };
}

function frequencySpec(value: number): StandaloneFigureSpec {
  return {
    kind: "natural-frequency",
    class: "variant-call",
    basis: "exact",
    provenance: PORTRAIT_PROVENANCE,
    value,
  };
}

/** The pattern field of a refused match, by the reason the rule gave. */
function refusedPattern(reason: CarrierReason, conditionMode: string | null): string {
  const mode = (conditionMode ?? "").trim().toLowerCase();
  if (reason === "dominant" || mode === "autosomal_dominant") {
    return PATTERN_DESCRIPTIONS.autosomal_dominant;
  }
  if (reason === "sex-unknown" || mode === "x_linked") return PATTERN_DESCRIPTIONS.x_linked;
  if (mode === "autosomal_recessive") return PATTERN_DESCRIPTIONS.autosomal_recessive;
  return NO_PATTERN_DESCRIPTION;
}

export interface PortraitCardPeople {
  /** The two people in the pair's own order, chipped as the side-by-side page chips them. */
  people: readonly [HealthPictureColumn, HealthPictureColumn];
  viewerAccountId: string;
}

function Chips({
  people,
  viewerAccountId,
  nodes,
}: PortraitCardPeople & { nodes: readonly React.ReactNode[] }) {
  return (
    <div data-slot="carrier-chips" className="flex flex-wrap gap-x-6 gap-y-3">
      {people.map((person, index) => (
        <span
          key={person.dataSubjectId}
          data-slot="carrier-person"
          className="flex flex-wrap items-center gap-2 text-sm text-ink"
        >
          <SubjectChip column={person} viewerAccountId={viewerAccountId} />
          {nodes[index]}
        </span>
      ))}
    </div>
  );
}

function Title({ gene }: { gene: string }) {
  return (
    <p data-slot="portrait-output-title" className="font-medium text-ink">
      {outputHeading(gene)}
    </p>
  );
}

/** The lines every output card ends with: the segregation sentence once, then the G5.9(b) line. */
function Closing() {
  return (
    <>
      <p data-slot="segregation" className="text-sm leading-relaxed text-ink">
        {SEGREGATION_SENTENCE}
      </p>
      <p data-slot="chance-not-prediction" data-density-required-accuracy className="text-sm font-medium text-ink">
        {CHANCE_NOT_PREDICTION}
      </p>
      <p data-slot="counsellor-route" className="text-sm leading-relaxed text-ink-muted">
        {COUNSELLOR_NO_ROUTE}
      </p>
    </>
  );
}

export interface CarrierPairCardProps extends PortraitCardPeople {
  match: CarrierMatch;
  /** The registry's mode for the gene, for the pattern field of a refused match. */
  conditionMode: string | null;
  coverage: GeneCoverage;
  /** Distinguishes the figure ids of several cards on one page. */
  id: string;
}

/** The cross a match with the one fraction stands for: one changed copy in each file. */
export function crossForMatch(match: CarrierMatch): MendelCross {
  const copies = (reading: "one copy" | "two copies" | "copies not shown"): 1 | 2 =>
    reading === "two copies" ? 2 : 1;
  return autosomalCross("autosomal_recessive", copies(match.a.variant.copies), copies(match.b.variant.copies));
}

export function CarrierPairCard({
  match,
  conditionMode,
  coverage,
  id,
  people,
  viewerAccountId,
}: CarrierPairCardProps) {
  const statuses = [statusSpec(match.a.variant.copies), statusSpec(match.b.variant.copies)];
  const variantLines = (
    <ul data-slot="carrier-variants" className="space-y-1 text-sm leading-relaxed text-ink-muted">
      {[match.a, match.b].map((person, index) => (
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
  );

  if (match.kind === "probability") {
    const cross = crossForMatch(match);
    const distribution = distribute<MendelOutcome>(crossShares(cross), OUTCOME_PHRASES);
    const figures = [
      ...statuses,
      ...distribution.categories.map((category) => frequencySpec(category.share)),
    ];
    return (
      <ClaimBlock
        subject={{ subjectPair: [match.a.dataSubjectId, match.b.dataSubjectId] }}
        figures={figures}
        denominator={100}
        aria-label={outputHeading(match.gene)}
        className="space-y-4"
        renderFigures={(nodes) => (
          <article data-slot="portrait-output" data-output-kind="carrier-pair" data-gene={match.gene} className="space-y-4">
            <Title gene={match.gene} />
            <Chips people={people} viewerAccountId={viewerAccountId} nodes={nodes.slice(0, 2)} />
            {variantLines}
            <p data-slot="portrait-derivation" data-finding="true" className="text-base font-medium text-ink tabular-nums">
              {derivationLine(cross.outcomes)}
            </p>
            <OutcomeDots
              id={id}
              distribution={distribution}
              legend={OUTCOME_LEGEND}
              figureNodes={nodes.slice(2)}
            />
          </article>
        )}
      >
        {/* inherit-figure-exempt: a count of positions both files report against the registry, not a result */}
        <p data-slot="known-covered" data-finding="true" className="text-sm leading-relaxed text-ink">
          {knownChangesCovered(coverage.covered, coverage.known)}
        </p>
        <HowSureBlock
          pattern={PATTERN_DESCRIPTIONS[cross.pattern]}
          assumptions={cross.assumptions.map((assumption) => ASSUMPTION_STATEMENTS[assumption])}
          coverage={BOTH_FILES_COVERED}
          change={CARRIER_WHAT_WOULD_CHANGE}
        />
        <Closing />
      </ClaimBlock>
    );
  }

  const runs = match.reason === "runs-unchecked";
  return (
    <ClaimBlock
      subject={{ subjectPair: [match.a.dataSubjectId, match.b.dataSubjectId] }}
      figures={statuses}
      aria-label={outputHeading(match.gene)}
      className="space-y-4"
      renderFigures={(nodes) => (
        <article
          data-slot="portrait-output"
          data-output-kind="carrier-pair-refused"
          data-gene={match.gene}
          data-reason={match.reason}
          className="space-y-4"
        >
          <Title gene={match.gene} />
          <Chips people={people} viewerAccountId={viewerAccountId} nodes={nodes} />
          {variantLines}
          <p data-slot="carrier-sentence" data-finding="true" className="text-base leading-relaxed text-ink">
            {runs ? RUNS_REFUSAL : carrierNoProbabilitySentence(match.gene, match.reason)}
          </p>
        </article>
      )}
    >
      <HowSureBlock
        pattern={refusedPattern(match.reason, conditionMode)}
        assumptions={[runs ? RUNS_ASSUMPTION : REFUSAL_ASSUMPTION]}
        coverage={BOTH_FILES_COVERED}
        change={runs ? RUNS_WHAT_WOULD_CHANGE : REFUSAL_WHAT_WOULD_CHANGE}
      />
      <Closing />
    </ClaimBlock>
  );
}

export interface OneSidedCardProps extends PortraitCardPeople {
  reading: OneSidedReading;
}

export function OneSidedCard({ reading, people, viewerAccountId }: OneSidedCardProps) {
  // The statuses in the pair's own order: the carrier's reading, and the
  // other file's, in words.
  const otherStatus =
    reading.kind === "no-second-copy" ? NO_COPY_FOUND_READING : POSITIONS_NOT_COVERED_READING;
  const ordered = people.map((person) =>
    person.dataSubjectId === reading.carrier.dataSubjectId
      ? statusSpec(reading.carrier.variant.copies)
      : statusSpec(otherStatus),
  );
  const carrierPerson = people.find((person) => person.dataSubjectId === reading.carrier.dataSubjectId);
  const otherPerson = people.find((person) => person.dataSubjectId === reading.other.dataSubjectId);
  const carrierName = carrierPerson?.displayLabel ?? reading.carrier.displayLabel;
  const otherName = otherPerson?.displayLabel ?? reading.other.displayLabel;
  const sentence =
    reading.kind === "no-second-copy"
      ? noSecondCopy(otherName)
      : cannotCalculate(otherName, `rs${reading.uncoveredRsid}`);

  return (
    <ClaimBlock
      subject={{ subjectPair: [people[0].dataSubjectId, people[1].dataSubjectId] }}
      figures={ordered}
      aria-label={outputHeading(reading.gene)}
      className="space-y-4"
      renderFigures={(nodes) => (
        <article
          data-slot="portrait-output"
          data-output-kind="one-sided"
          data-one-sided={reading.kind}
          data-gene={reading.gene}
          className="space-y-4"
        >
          <Title gene={reading.gene} />
          <Chips people={people} viewerAccountId={viewerAccountId} nodes={nodes} />
          <ul data-slot="carrier-variants" className="space-y-1 text-sm leading-relaxed text-ink-muted">
            <li data-slot="carrier-variant">
              {personVariantLine(
                carrierName,
                reading.carrier.variant.rsid,
                reading.gene,
                reading.carrier.variant.classification,
              )}
            </li>
          </ul>
          <p data-slot="carrier-sentence" className="text-base leading-relaxed text-ink">
            {sentence}
          </p>
        </article>
      )}
    >
      {reading.kind === "no-second-copy" ? (
        // inherit-figure-exempt: a count of positions both files report against the registry, not a result
        <p data-slot="known-covered" className="text-sm leading-relaxed text-ink">
          {knownChangesCovered(reading.coverage.covered, reading.coverage.known)}
        </p>
      ) : null}
      <HowSureBlock
        pattern={PATTERN_DESCRIPTIONS.autosomal_recessive}
        assumptions={[REFUSAL_ASSUMPTION]}
        coverage={
          reading.kind === "no-second-copy"
            ? knownChangesCovered(reading.coverage.covered, reading.coverage.known)
            : sentence
        }
        change={oneSidedWhatWouldChange(otherName)}
      />
      <Closing />
    </ClaimBlock>
  );
}
