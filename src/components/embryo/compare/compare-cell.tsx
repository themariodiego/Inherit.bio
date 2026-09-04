/**
 * <CompareCell> — one cell of the comparison and one finding on the detail
 * page (design §2.4 cell contract; A.10 brief line 2270): exactly one number
 * or one named reason plus at most one short qualifier, inside one
 * <ClaimBlock> attributed to the embryo's own subject.
 *
 *   1. absoluteRiskFinding: the absolute figure with the block denominator,
 *      the interval as its one qualifier, the matched baseline as the block's
 *      natural-frequency pair, the modelled marker once, and the within-family
 *      figure or its exact untested string as the third element;
 *   2. carrierFinding: the carrier-status figure in words;
 *   3. coverageFailureFinding: the word "Not read";
 *   4. finding null: the reason word from the closed table.
 *
 * A tie renders the ≈ glyph and "Too close to tell apart" with no ordinal.
 * Server component; no colour token anywhere.
 */
import { ClaimBlock } from "@/components/figures/claim-block";
import {
  CARRIER_WORDS,
  CELL_WORDS,
  GENERAL_POPULATION_GROUP,
  NOT_MEASURED_COMPARISON,
  TIE_GLYPH,
  WITHIN_FAMILY_NOT_TESTED,
  embryoGroup,
  withinFamilyInconclusive,
} from "@/copy/embryos/compare";
import { displayedFigure, type EmbryoFinding } from "@/lib/embryos/policy";
import { QC_REASON_IDS, RESULT_NOT_REPORTABLE_REASON_IDS, mapQcReason } from "@/lib/embryos/qc-policy";
import type { StandaloneFigureSpec } from "@/lib/figures/spec";

const CELL_BLOCK_CLASS = "rounded-none border-0 bg-transparent p-0";

/** The closed word a cell without a number renders, by its reason. */
export function reasonWord(reason: string | null): string {
  if (reason === null) return CELL_WORDS.notMeasurable;
  if ((QC_REASON_IDS as readonly string[]).includes(reason)) {
    return reason === "qc_review_required" ? CELL_WORDS.underReview : CELL_WORDS.notMeasurable;
  }
  switch (reason) {
    case "sex_combined_model_unavailable":
      return CELL_WORDS.noPopulationFigure;
    case "within_family_validation_unavailable":
      return CELL_WORDS.notTestedBetweenSiblings;
    case "source_call_disputed":
      return CELL_WORDS.underReview;
    case "insufficient_coverage":
      return CELL_WORDS.notRead;
    default:
      return CELL_WORDS.notMeasurable;
  }
}

/** The word a cell renders instead of a figure, or null when it renders one. */
export function cellWord(finding: EmbryoFinding): string | null {
  if (finding.finding === null) return reasonWord(finding.not_covered_reason);
  if (finding.finding.kind === "coverage_failure") return CELL_WORDS.notRead;
  return null;
}

/** The registered id a reason maps to; a value outside the closed table becomes the review id, never the raw string. */
export function registeredReason(reason: string | null): string | null {
  if (reason === null) return null;
  if ((RESULT_NOT_REPORTABLE_REASON_IDS as readonly string[]).includes(reason)) return reason;
  return mapQcReason(reason);
}

function Word({ word, reason }: { word: string; reason: string | null }) {
  return (
    <span data-slot="cell-word" data-reason={registeredReason(reason) ?? undefined} className="text-sm text-ink">
      {word}
    </span>
  );
}

export function CompareCell({
  finding,
  subjectId,
  tied = false,
}: {
  finding: EmbryoFinding;
  subjectId: string;
  /** The difference interval with the compared cell includes zero (brief line 390). */
  tied?: boolean;
}) {
  const subject = { subjectId };
  const word = cellWord(finding);
  if (word !== null) {
    return (
      <ClaimBlock subject={subject} figures={[]} className={CELL_BLOCK_CLASS}>
        <Word word={word} reason={finding.not_covered_reason} />
      </ClaimBlock>
    );
  }
  const body = finding.finding!;
  if (body.kind === "carrier_status") {
    const spec: StandaloneFigureSpec = {
      kind: "carrier-status",
      class: "variant-call",
      basis: "observed",
      provenance: { kind: "computed", module: "embryos/carrier" },
      status: CARRIER_WORDS[body.carrier_state],
    };
    return <ClaimBlock subject={subject} figures={[spec]} className={CELL_BLOCK_CLASS} />;
  }
  if (body.kind !== "absolute_risk") return null;
  if (tied) {
    return (
      <ClaimBlock subject={subject} figures={[]} className={CELL_BLOCK_CLASS}>
        <span data-slot="cell-word" data-tie="true" className="text-sm text-ink">
          <span aria-hidden="true">{TIE_GLYPH} </span>
          {CELL_WORDS.tooCloseToTellApart}
        </span>
      </ClaimBlock>
    );
  }
  const provenance = { kind: "seed", table: "risk_models", id: body.risk_model.model_id } as const;
  const modelled = { class: "estimate", basis: "modelled", provenance } as const;
  // The embryo's own figure is captioned as the embryo's ("for Embryo 1"),
  // never as the population: one cell never attributes two numbers to the
  // general population, which keeps the comparator alone (R3).
  const figures: StandaloneFigureSpec[] = [
    { ...modelled, kind: "absolute", value: displayedFigure(body.absolute_risk), group: embryoGroup(finding.embryo_label) },
    {
      ...modelled,
      kind: "interval",
      point: displayedFigure(body.absolute_risk),
      low: displayedFigure(body.interval_low),
      high: displayedFigure(body.interval_high),
    },
    {
      ...modelled,
      kind: "natural-frequency",
      subject: displayedFigure(body.absolute_risk),
      comparator: displayedFigure(body.matched_baseline.absolute_risk),
      subjectGroup: embryoGroup(finding.embryo_label),
      comparatorGroup: GENERAL_POPULATION_GROUP,
    },
  ];
  const withinFamily = body.within_family;
  const hasInterval =
    withinFamily.point_estimate !== null &&
    withinFamily.interval_low !== null &&
    withinFamily.interval_high !== null;
  const measured = withinFamily.status === "measured" && hasInterval;
  // The register's third status: tested between siblings, and the test could
  // not tell (an interval containing the no-attenuation null). Its own true
  // sentence with the citation, and the brief-1318 comparison sentence the
  // register requires beside any score not shown to hold up (R4).
  const inconclusive = withinFamily.status === "measured_inconclusive" && hasInterval;
  if (measured || inconclusive) {
    figures.push({
      kind: "interval",
      class: "estimate",
      basis: "modelled",
      provenance: { kind: "citation", id: withinFamily.citation_ids[0] ?? "" },
      point: displayedFigure(withinFamily.point_estimate!),
      low: displayedFigure(withinFamily.interval_low!),
      high: displayedFigure(withinFamily.interval_high!),
    });
  }
  return (
    <ClaimBlock subject={subject} figures={figures} className={CELL_BLOCK_CLASS}>
      {finding.coverage_state === "partial" ? (
        <Word word={CELL_WORDS.partlyRead} reason={null} />
      ) : null}
      {measured ? null : inconclusive ? (
        <>
          <p data-slot="within-family" data-within-family="measured_inconclusive" className="mt-2 text-sm text-ink">
            {withinFamilyInconclusive(withinFamily.citation_ids[0] ?? "")}
          </p>
          <p data-slot="within-family-comparison" className="mt-2 text-sm text-ink">
            {NOT_MEASURED_COMPARISON}
          </p>
        </>
      ) : (
        <>
          <p data-slot="within-family" data-within-family="not_measured" className="mt-2 text-sm text-ink">
            {WITHIN_FAMILY_NOT_TESTED}
          </p>
          <p data-slot="within-family-comparison" className="mt-2 text-sm text-ink">
            {NOT_MEASURED_COMPARISON}
          </p>
        </>
      )}
    </ClaimBlock>
  );
}
