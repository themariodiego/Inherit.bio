/**
 * Synthetic embryo fixtures for the unit suite (C7: they describe no one).
 * Every value is invented here for a test; nothing is a real embryo, a real
 * laboratory or a real condition. Production code never imports this file.
 */
import type { EmbryoFinding, QcDto } from "./policy";
import type { EmbryoQcRow } from "./projection";
import { UNKNOWN_EMBRYO_INPUT } from "./input-facts";

export const SYNTHETIC_COMPUTED_AT = "2026-09-03T10:00:00.000Z";

export function syntheticQc(overrides: Partial<QcDto> = {}): QcDto {
  return {
    source_facts: { ...UNKNOWN_EMBRYO_INPUT },
    sites_expected: 1000,
    sites_called: 990,
    call_rate: 0.99,
    autosomal_het_rate: 0.31,
    mean_depth: null,
    parent_a_concordance: null,
    parent_b_concordance: null,
    allelic_dropout_estimate: null,
    allelic_dropout_interval_low: null,
    allelic_dropout_interval_high: null,
    allelic_dropout_method: null,
    amplification_method: null,
    source_laboratory: null,
    source_assay: null,
    imputation_performed: false,
    imputation_panel: null,
    contamination_estimate: null,
    qc_verdict: "pass",
    qc_reasons: [],
    computed_at: SYNTHETIC_COMPUTED_AT,
    ...overrides,
  };
}

export function syntheticQcRow(embryoId: string, overrides: Partial<QcDto> = {}): EmbryoQcRow {
  const { source_facts: _sourceFacts, ...row } = syntheticQc(overrides);
  void _sourceFacts;
  return { embryo_id: embryoId, ...row };
}

export function syntheticAbsoluteFinding(
  embryoLabel: string,
  conditionId: string,
  absoluteRisk: number,
  overrides: Partial<EmbryoFinding> = {},
): EmbryoFinding {
  return {
    embryo_label: embryoLabel,
    condition_id: conditionId,
    condition_name: `Synthetic condition ${conditionId}`,
    finding: {
      kind: "absolute_risk",
      risk_model: {
        model_id: `synthetic-model-${conditionId}`,
        model_version: "1",
        age_band: "lifetime",
        prevalence_basis: "lifetime_risk",
        birth_cohort: "synthetic 1990s",
        calibration_cohort: "synthetic cohort",
        calibration_n: 1000,
      },
      score_coverage: 0.9,
      absolute_risk: absoluteRisk,
      interval_low: absoluteRisk * 0.8,
      interval_high: Math.min(1, absoluteRisk * 1.25),
      matched_baseline: { absolute_risk: 0.05, interval_low: 0.04, interval_high: 0.06, citation_ids: ["synthetic:1"] },
      difference_pp: Number(((absoluteRisk - 0.05) * 100).toFixed(2)),
      natural_frequency: { subject_numerator: 5, comparator_numerator: 5, denominator: 100, fallback_copy_id: null },
      number_needed_to_select: null,
      comparators: [
        { comparator: "vs_average_embryo", relative_difference: 0, absolute_difference_pp: 0, number_needed_to_select: null, lead: false },
        { comparator: "vs_randomly_selected_embryo", relative_difference: 0, absolute_difference_pp: 0, number_needed_to_select: null, lead: true },
        { comparator: "vs_highest_risk_embryo", relative_difference: 0, absolute_difference_pp: 0, number_needed_to_select: null, lead: false },
        { comparator: "vs_population_baseline", relative_difference: 0, absolute_difference_pp: 0, number_needed_to_select: null, lead: false },
      ],
      within_family: {
        status: "not_measured",
        point_estimate: null,
        interval_low: null,
        interval_high: null,
        family_count: null,
        citation_ids: [],
        display_copy_id: "embryo.within-family.not-tested",
        enabled_by_default: false,
      },
    },
    evidence_label: "emerging",
    coverage_state: "covered",
    citation_ids: ["synthetic:1"],
    not_covered_reason: null,
    ...overrides,
  };
}

export function syntheticNullFinding(
  embryoLabel: string,
  conditionId: string,
  reason: string,
  coverageState: EmbryoFinding["coverage_state"] = "quality_not_measurable",
): EmbryoFinding {
  return {
    embryo_label: embryoLabel,
    condition_id: conditionId,
    condition_name: `Synthetic condition ${conditionId}`,
    finding: null,
    evidence_label: "emerging",
    coverage_state: coverageState,
    citation_ids: [],
    not_covered_reason: reason,
  };
}

export function syntheticCarrierFinding(
  embryoLabel: string,
  conditionId: string,
  state: "carrier" | "not_detected" | "two_variants",
): EmbryoFinding {
  return {
    embryo_label: embryoLabel,
    condition_id: conditionId,
    condition_name: `Synthetic condition ${conditionId}`,
    finding: {
      kind: "carrier_status",
      carrier_state: state,
      inheritance_mode: "autosomal_recessive",
      confirmation_required: true,
      display_copy_id: "embryo.carrier.synthetic",
    },
    evidence_label: "clinical",
    coverage_state: "covered",
    citation_ids: ["synthetic:2"],
    not_covered_reason: null,
  };
}

export function syntheticCoverageFailure(embryoLabel: string, conditionId: string): EmbryoFinding {
  return {
    embryo_label: embryoLabel,
    condition_id: conditionId,
    condition_name: `Synthetic condition ${conditionId}`,
    finding: {
      kind: "coverage_failure",
      metric: "score_coverage",
      measured_value: 0.6,
      required_minimum: 0.8,
      display_copy_id: "embryo.result.insufficient-coverage",
    },
    evidence_label: "emerging",
    coverage_state: "not_covered",
    citation_ids: [],
    not_covered_reason: "insufficient_coverage",
  };
}
