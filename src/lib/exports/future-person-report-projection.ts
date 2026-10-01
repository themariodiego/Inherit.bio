import "server-only";
import { readHistoricalFinding,historicalFindingBasis } from "./historical-embryo-dto";

/** Own historical finding component. This deliberately accepts the complete
 * stored finding, rather than a current-catalog filtered page. The future
 * member reader must bind its exact report ID/revision/source to live custody.
 * Cohort comparisons remain excluded under the claimant export contract.
 * This projector alone is not a complete report/member/export authority. */
export function projectFuturePersonFinding(value:unknown) {
  const row=readHistoricalFinding(value);
  const finding=row.finding;
  const common={conditionId:row.condition_id,conditionName:row.condition_name,evidenceLabel:row.evidence_label,
    coverageState:row.coverage_state,citationIds:[...row.citation_ids],notCoveredReason:row.not_covered_reason,
    classification:historicalFindingBasis(finding)};
  if(finding?.kind!=="absolute_risk")return {...common,finding:structuredClone(finding),withheldComponents:[]};
  const population=finding.comparators.find(item=>item.comparator==="vs_population_baseline")!;
  return {...common,finding:{kind:finding.kind,riskModel:structuredClone(finding.risk_model),scoreCoverage:finding.score_coverage,
    absoluteRisk:finding.absolute_risk,intervalLow:finding.interval_low,intervalHigh:finding.interval_high,
    naturalFrequency:{subjectNumerator:finding.natural_frequency.subject_numerator,denominator:finding.natural_frequency.denominator,
      fallbackCopyId:finding.natural_frequency.fallback_copy_id},
    populationComparison:{comparator:population.comparator,relativeDifference:population.relative_difference,
      absoluteDifferencePP:population.absolute_difference_pp},
    publishedWithinFamilyValidation:structuredClone(finding.within_family)},
    withheldComponents:["matched_baseline","difference_pp","number_needed_to_select","comparators.vs_average_embryo",
      "comparators.vs_randomly_selected_embryo","comparators.vs_highest_risk_embryo","natural_frequency.comparator_numerator","comparators.vs_population_baseline.number_needed_to_select"],
    withholdingReason:"outside-claimed-subject" as const};
}
