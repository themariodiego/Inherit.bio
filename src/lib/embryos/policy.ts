/**
 * The embryo non-ranking and closed-shape policy — the runtime mirror of
 * `docs/route-register.json#policyContracts.embryo-autosomal-only-v1`
 * (docs/canonical-artifacts.md names this file for both). Pure.
 *
 * Three things live here and nowhere else:
 *   1. the closed shapes every embryo RSC prop, API byte, export member and
 *      chat context must match, validated recursively before anything
 *      crosses the server-component boundary (`serverComponentBoundary`);
 *      an unknown key, a forbidden field name or a broken cardinality is a
 *      refusal, never a partial render;
 *   2. the forbidden field names — the sex, karyotype and laboratory-label
 *      keys of `forbiddenShapeFields`, and the ranking keys of brief §4 §6.8;
 *   3. the two permitted orders (`filtersAndSorts`): columns ascend by
 *      `sample_ordinal` and result rows ascend by registry `condition_id`,
 *      with no sort control and no ordering by any computed quantity.
 */
import { QC_REASON_IDS, RESULT_NOT_REPORTABLE_REASON_IDS } from "./qc-policy";
import { SOURCE_LABEL_FIELDS, isRegisteredSourceLabel } from "./source-labels";

/** Register `forbiddenShapeFields`, verbatim. */
export const FORBIDDEN_SHAPE_FIELDS = [
  "sex",
  "embryo_sex",
  "karyotype",
  "sex_proxy",
  "chromosome-X",
  "chromosome-Y",
  "chromosome-M",
  "chromosome-MT",
  "discarded-sex-record-present",
  "discarded-sex-record-count",
  "sample_column",
  "lab_identifier",
  "original_filename",
  "original_sample_label",
  "parent_raw_genotype",
  "parent_raw_variant",
] as const;

/** Brief §4 §6.8: the response schema forbids these exact key names anywhere. */
export const FORBIDDEN_RANKING_FIELDS = [
  "rank",
  "overall",
  "composite",
  "best",
  "score",
  "grade",
  "recommendation",
] as const;

const FORBIDDEN_KEYS = new Set<string>([...FORBIDDEN_SHAPE_FIELDS, ...FORBIDDEN_RANKING_FIELDS]);

export const TRADEOFF_COPY_IDS = ["embryo.tradeoffs.exists", "embryo.tradeoffs.none-measurable"] as const;
export type TradeOffCopyId = (typeof TRADEOFF_COPY_IDS)[number];

export const STANDING_STATEMENT_COPY_ID = "embryo.standing-statement";

export const EVIDENCE_LABELS = ["clinical", "established", "emerging", "preliminary"] as const;
export const COVERAGE_STATES = ["covered", "partial", "not_covered", "quality_not_measurable"] as const;
export const CARRIER_STATES = ["carrier", "not_detected", "two_variants"] as const;
export const COMPARATORS = [
  "vs_average_embryo",
  "vs_randomly_selected_embryo",
  "vs_highest_risk_embryo",
  "vs_population_baseline",
] as const;
export const WITHIN_FAMILY_STATUS_VALUES = ["measured", "measured_inconclusive", "not_measured"] as const;
export const QC_VERDICTS = ["pass", "marginal", "fail"] as const;
export const EMBRYO_STATUSES = [
  "pending",
  "qc_pass",
  "qc_marginal",
  "qc_fail",
  "excluded",
  "stored",
  "transferred",
  "donated",
  "discarded",
  "claimed_bound",
] as const;
export type EmbryoStatus = (typeof EMBRYO_STATUSES)[number];

// ---------------------------------------------------------------------------
// The closed shapes, keyed as the register keys them.
// ---------------------------------------------------------------------------

export type ShapeName =
  | "rscEmbryoListItem"
  | "rscEmbryoDetail"
  | "rscEmbryoComparison"
  | "contextCounts"
  | "comparisonEmbryo"
  | "comparisonResultRow"
  | "tradeOffs"
  | "tradeOffConflict"
  | "qc"
  | "EmbryoFinding"
  | "coverageFailureFinding"
  | "absoluteRiskFinding"
  | "embryoRiskModelBinding"
  | "matchedBaseline"
  | "naturalFrequency"
  | "comparatorFinding"
  | "withinFamilyValidation"
  | "carrierFinding";

interface ChildRule {
  shape: ShapeName;
  array?: boolean;
}

interface ShapeDefinition {
  keys: readonly string[];
  children: Readonly<Record<string, ChildRule>>;
}

const QC_KEYS = [
  "sites_expected",
  "sites_called",
  "call_rate",
  "autosomal_het_rate",
  "mean_depth",
  "parent_a_concordance",
  "parent_b_concordance",
  "allelic_dropout_estimate",
  "allelic_dropout_interval_low",
  "allelic_dropout_interval_high",
  "allelic_dropout_method",
  "amplification_method",
  "source_laboratory",
  "source_assay",
  "imputation_performed",
  "imputation_panel",
  "contamination_estimate",
  "qc_verdict",
  "qc_reasons",
  "computed_at",
] as const;

export const SHAPES: Readonly<Record<ShapeName, ShapeDefinition>> = {
  rscEmbryoListItem: {
    keys: ["id", "cohort_id", "sample_ordinal", "display_label", "status"],
    children: {},
  },
  rscEmbryoDetail: {
    keys: ["id", "cohort_id", "sample_ordinal", "display_label", "status", "qc", "findings"],
    children: { qc: { shape: "qc" }, findings: { shape: "EmbryoFinding", array: true } },
  },
  rscEmbryoComparison: {
    keys: ["cohort_id", "context_counts", "embryos", "result_rows", "trade_offs", "standing_statement"],
    children: {
      context_counts: { shape: "contextCounts" },
      embryos: { shape: "comparisonEmbryo", array: true },
      result_rows: { shape: "comparisonResultRow", array: true },
      trade_offs: { shape: "tradeOffs" },
    },
  },
  contextCounts: {
    keys: ["embryos_analysed", "quality_check_passed", "not_measurable"],
    children: {},
  },
  comparisonEmbryo: {
    keys: ["id", "sample_ordinal", "display_label", "status", "qc"],
    children: { qc: { shape: "qc" } },
  },
  comparisonResultRow: {
    keys: ["findings"],
    children: { findings: { shape: "EmbryoFinding", array: true } },
  },
  tradeOffs: {
    keys: ["statement_copy_id", "conflicts"],
    children: { conflicts: { shape: "tradeOffConflict", array: true } },
  },
  tradeOffConflict: {
    keys: ["embryo_label", "lowest_condition_id", "highest_condition_id", "copy_id"],
    children: {},
  },
  qc: { keys: QC_KEYS, children: {} },
  EmbryoFinding: {
    keys: [
      "embryo_label",
      "condition_id",
      "condition_name",
      "finding",
      "evidence_label",
      "coverage_state",
      "citation_ids",
      "not_covered_reason",
    ],
    children: {},
  },
  coverageFailureFinding: {
    keys: ["kind", "metric", "measured_value", "required_minimum", "display_copy_id"],
    children: {},
  },
  absoluteRiskFinding: {
    keys: [
      "kind",
      "risk_model",
      "score_coverage",
      "absolute_risk",
      "interval_low",
      "interval_high",
      "matched_baseline",
      "difference_pp",
      "natural_frequency",
      "number_needed_to_select",
      "comparators",
      "within_family",
    ],
    children: {
      risk_model: { shape: "embryoRiskModelBinding" },
      matched_baseline: { shape: "matchedBaseline" },
      natural_frequency: { shape: "naturalFrequency" },
      comparators: { shape: "comparatorFinding", array: true },
      within_family: { shape: "withinFamilyValidation" },
    },
  },
  embryoRiskModelBinding: {
    keys: ["model_id", "model_version", "age_band", "prevalence_basis", "birth_cohort", "calibration_cohort", "calibration_n"],
    children: {},
  },
  matchedBaseline: {
    keys: ["absolute_risk", "interval_low", "interval_high", "citation_ids"],
    children: {},
  },
  naturalFrequency: {
    keys: ["subject_numerator", "comparator_numerator", "denominator", "fallback_copy_id"],
    children: {},
  },
  comparatorFinding: {
    keys: ["comparator", "relative_difference", "absolute_difference_pp", "number_needed_to_select", "lead"],
    children: {},
  },
  withinFamilyValidation: {
    keys: [
      "status",
      "point_estimate",
      "interval_low",
      "interval_high",
      "family_count",
      "citation_ids",
      "display_copy_id",
      "enabled_by_default",
    ],
    children: {},
  },
  carrierFinding: {
    keys: ["kind", "carrier_state", "inheritance_mode", "confirmation_required", "display_copy_id"],
    children: {},
  },
};

// ---------------------------------------------------------------------------
// TypeScript views of the shapes the pages consume.
// ---------------------------------------------------------------------------

export interface QcDto {
  sites_expected: number;
  sites_called: number;
  call_rate: number;
  autosomal_het_rate: number | null;
  mean_depth: number | null;
  parent_a_concordance: number | null;
  parent_b_concordance: number | null;
  allelic_dropout_estimate: number | null;
  allelic_dropout_interval_low: number | null;
  allelic_dropout_interval_high: number | null;
  allelic_dropout_method: string | null;
  amplification_method: string | null;
  source_laboratory: string | null;
  source_assay: string | null;
  imputation_performed: boolean;
  imputation_panel: string | null;
  contamination_estimate: number | null;
  qc_verdict: (typeof QC_VERDICTS)[number];
  qc_reasons: string[];
  computed_at: string;
}

export interface EmbryoRiskModelBinding {
  model_id: string;
  model_version: string;
  age_band: "lifetime";
  prevalence_basis: "lifetime_risk";
  birth_cohort: string;
  calibration_cohort: string;
  calibration_n: number;
}

export interface MatchedBaseline {
  absolute_risk: number;
  interval_low: number;
  interval_high: number;
  citation_ids: string[];
}

export interface NaturalFrequencyDto {
  subject_numerator: number | null;
  comparator_numerator: number | null;
  denominator: number | null;
  fallback_copy_id: string | null;
}

export interface ComparatorFinding {
  comparator: (typeof COMPARATORS)[number];
  relative_difference: number;
  absolute_difference_pp: number;
  number_needed_to_select: number | null;
  lead: boolean;
}

export interface WithinFamilyValidation {
  status: (typeof WITHIN_FAMILY_STATUS_VALUES)[number];
  point_estimate: number | null;
  interval_low: number | null;
  interval_high: number | null;
  family_count: number | null;
  citation_ids: string[];
  display_copy_id: string | null;
  enabled_by_default: boolean;
}

export interface AbsoluteRiskFinding {
  kind: "absolute_risk";
  risk_model: EmbryoRiskModelBinding;
  score_coverage: number;
  absolute_risk: number;
  interval_low: number;
  interval_high: number;
  matched_baseline: MatchedBaseline;
  difference_pp: number;
  natural_frequency: NaturalFrequencyDto;
  number_needed_to_select: number | null;
  comparators: ComparatorFinding[];
  within_family: WithinFamilyValidation;
}

export interface CarrierFinding {
  kind: "carrier_status";
  carrier_state: (typeof CARRIER_STATES)[number];
  inheritance_mode: string | null;
  confirmation_required: true;
  display_copy_id: string;
}

export interface CoverageFailureFinding {
  kind: "coverage_failure";
  metric: "score_coverage";
  measured_value: number;
  required_minimum: 0.8;
  display_copy_id: "embryo.result.insufficient-coverage";
}

export type FindingBody = AbsoluteRiskFinding | CarrierFinding | CoverageFailureFinding | null;

/** The eight-key leaf (brief line 1982; `private.valid_embryo_findings`). */
export interface EmbryoFinding {
  embryo_label: string;
  condition_id: string;
  condition_name: string;
  finding: FindingBody;
  evidence_label: (typeof EVIDENCE_LABELS)[number];
  coverage_state: (typeof COVERAGE_STATES)[number];
  citation_ids: string[];
  not_covered_reason: string | null;
}

export interface RscEmbryoListItem {
  id: string;
  cohort_id: string;
  sample_ordinal: number;
  display_label: string;
  status: EmbryoStatus;
}

export interface RscEmbryoDetail extends RscEmbryoListItem {
  qc: QcDto;
  findings: EmbryoFinding[];
}

export interface ComparisonEmbryo {
  id: string;
  sample_ordinal: number;
  display_label: string;
  status: EmbryoStatus;
  qc: QcDto;
}

export interface ComparisonResultRow {
  findings: EmbryoFinding[];
}

export interface TradeOffConflict {
  embryo_label: string;
  lowest_condition_id: string;
  highest_condition_id: string;
  copy_id: string;
}

export interface TradeOffs {
  statement_copy_id: TradeOffCopyId;
  conflicts: TradeOffConflict[];
}

export interface ContextCountsDto {
  embryos_analysed: number;
  quality_check_passed: number;
  not_measurable: number;
}

export interface RscEmbryoComparison {
  cohort_id: string;
  context_counts: ContextCountsDto;
  embryos: ComparisonEmbryo[];
  result_rows: ComparisonResultRow[];
  trade_offs: TradeOffs;
  standing_statement: string;
}

// ---------------------------------------------------------------------------
// Validation.
// ---------------------------------------------------------------------------

export type ShapeVerdict = { ok: true } | { ok: false; path: string; reason: string };

export class EmbryoShapeError extends Error {
  constructor(
    public readonly shape: ShapeName,
    public readonly path: string,
    reason: string,
  ) {
    super(`embryo-closed-schema-v1: ${shape} at ${path || "$"}: ${reason}`);
    this.name = "EmbryoShapeError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(path: string, reason: string): ShapeVerdict {
  return { ok: false, path, reason };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isProbability(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isNullOrProbability(value: unknown): boolean {
  return value === null || isProbability(value);
}

function isNullOrString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isEnum(value: unknown, values: readonly string[]): boolean {
  return typeof value === "string" && values.includes(value);
}

/** Every key at every depth, so a forbidden name inside a finding is caught wherever it hides. */
function findForbiddenKey(value: unknown, path: string): { path: string; key: string } | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const found = findForbiddenKey(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) return { path: `${path}.${key}`, key };
    const found = findForbiddenKey(value[key], `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

function scalarVerdict(shape: ShapeName, value: Record<string, unknown>, path: string): ShapeVerdict {
  const at = (key: string) => (path ? `${path}.${key}` : key);
  switch (shape) {
    case "rscEmbryoListItem":
    case "rscEmbryoDetail":
    case "comparisonEmbryo": {
      if (typeof value.id !== "string") return fail(at("id"), "must be a string");
      if (!Number.isInteger(value.sample_ordinal) || (value.sample_ordinal as number) < 0 || (value.sample_ordinal as number) > 63) {
        return fail(at("sample_ordinal"), "must be an integer 0..63");
      }
      if (value.display_label !== `Embryo ${(value.sample_ordinal as number) + 1}`) {
        return fail(at("display_label"), "must be the neutral server label for the ordinal");
      }
      if (!isEnum(value.status, EMBRYO_STATUSES)) return fail(at("status"), "unknown embryo status");
      return { ok: true };
    }
    case "contextCounts": {
      for (const key of SHAPES.contextCounts.keys) {
        const count = value[key];
        if (!Number.isInteger(count) || (count as number) < 0) return fail(at(key), "must be a non-negative integer");
      }
      return { ok: true };
    }
    case "tradeOffs": {
      if (!isEnum(value.statement_copy_id, TRADEOFF_COPY_IDS)) {
        return fail(at("statement_copy_id"), "must be one of the two registered copy ids");
      }
      const conflicts = value.conflicts as unknown[];
      if (value.statement_copy_id === "embryo.tradeoffs.exists" && conflicts.length === 0) {
        return fail(at("conflicts"), "embryo.tradeoffs.exists needs at least one real conflict");
      }
      if (value.statement_copy_id === "embryo.tradeoffs.none-measurable" && conflicts.length !== 0) {
        return fail(at("conflicts"), "embryo.tradeoffs.none-measurable needs an empty conflicts array");
      }
      return { ok: true };
    }
    case "tradeOffConflict": {
      for (const key of SHAPES.tradeOffConflict.keys) {
        if (typeof value[key] !== "string") return fail(at(key), "must be a string");
      }
      return { ok: true };
    }
    case "qc": {
      if (!Number.isInteger(value.sites_expected) || (value.sites_expected as number) < 0) {
        return fail(at("sites_expected"), "must be a non-negative integer");
      }
      if (!Number.isInteger(value.sites_called) || (value.sites_called as number) < 0 || (value.sites_called as number) > (value.sites_expected as number)) {
        return fail(at("sites_called"), "must be a non-negative integer at most sites_expected");
      }
      if (!isProbability(value.call_rate)) return fail(at("call_rate"), "must be 0..1");
      for (const key of ["autosomal_het_rate", "parent_a_concordance", "parent_b_concordance", "allelic_dropout_estimate", "contamination_estimate"]) {
        if (!isNullOrProbability(value[key])) return fail(at(key), "must be null or 0..1");
      }
      if (!(value.mean_depth === null || (isFiniteNumber(value.mean_depth) && value.mean_depth >= 0))) {
        return fail(at("mean_depth"), "must be null or non-negative");
      }
      const low = value.allelic_dropout_interval_low;
      const high = value.allelic_dropout_interval_high;
      const estimate = value.allelic_dropout_estimate;
      const allNull = low === null && high === null && estimate === null;
      const strict = isFiniteNumber(low) && isFiniteNumber(estimate) && isFiniteNumber(high) && low < estimate && estimate < high;
      if (!allNull && !strict) return fail(at("allelic_dropout_interval_low"), "interval must be null as one set or strict low < estimate < high");
      // Source strings are bounded, registered safe labels or null: an
      // original laboratory label never passes the closed shape (R2).
      for (const key of SOURCE_LABEL_FIELDS) {
        if (!isRegisteredSourceLabel(key, value[key])) return fail(at(key), "must be null or a registered source label id");
      }
      if (!isNullOrString(value.imputation_panel)) return fail(at("imputation_panel"), "must be null or a string");
      if (value.imputation_performed !== false) return fail(at("imputation_performed"), "imputation is never performed for an embryo");
      if (value.imputation_panel !== null) return fail(at("imputation_panel"), "must be null");
      if (!isEnum(value.qc_verdict, QC_VERDICTS)) return fail(at("qc_verdict"), "must be pass, marginal or fail");
      if (!isStringArray(value.qc_reasons)) return fail(at("qc_reasons"), "must be an array of reason ids");
      // Membership of the closed table, never a free string (R1).
      if (!value.qc_reasons.every((reason) => isEnum(reason, QC_REASON_IDS))) {
        return fail(at("qc_reasons"), "must contain only registered qc reason ids");
      }
      if (typeof value.computed_at !== "string") return fail(at("computed_at"), "must be a timestamp string");
      return { ok: true };
    }
    case "EmbryoFinding": {
      for (const key of ["embryo_label", "condition_id", "condition_name"]) {
        if (typeof value[key] !== "string") return fail(at(key), "must be a string");
      }
      if (!isEnum(value.evidence_label, EVIDENCE_LABELS)) return fail(at("evidence_label"), "unknown evidence label");
      if (!isEnum(value.coverage_state, COVERAGE_STATES)) return fail(at("coverage_state"), "unknown coverage state");
      if (!isStringArray(value.citation_ids)) return fail(at("citation_ids"), "must be an array of citation ids");
      if (new Set(value.citation_ids).size !== value.citation_ids.length) return fail(at("citation_ids"), "must be deduplicated");
      if (!(value.not_covered_reason === null || isEnum(value.not_covered_reason, RESULT_NOT_REPORTABLE_REASON_IDS))) {
        return fail(at("not_covered_reason"), "must be null or a registered result reason id");
      }
      const finding = value.finding;
      const reason = value.not_covered_reason;
      const state = value.coverage_state;
      if (finding === null) {
        if (!(state === "not_covered" || state === "quality_not_measurable")) {
          return fail(at("finding"), "a null finding needs coverage_state not_covered or quality_not_measurable");
        }
        if (reason === null || reason === "insufficient_coverage") {
          return fail(at("not_covered_reason"), "a null finding needs one mapped reason other than insufficient_coverage");
        }
        // The register's cross-field rule: a quality reason names a
        // quality_not_measurable state and a result-level reason a
        // not_covered one; the pairs never cross (R1).
        const qualityReason = isEnum(reason, QC_REASON_IDS);
        if (qualityReason && state !== "quality_not_measurable") {
          return fail(at("coverage_state"), "a qc reason needs coverage_state quality_not_measurable");
        }
        if (!qualityReason && state !== "not_covered") {
          return fail(at("coverage_state"), "a result-level reason needs coverage_state not_covered");
        }
        return { ok: true };
      }
      if (!isRecord(finding)) return fail(at("finding"), "must be an object or null");
      const kind = finding.kind;
      if (kind === "coverage_failure") {
        if (state !== "not_covered" || reason !== "insufficient_coverage") {
          return fail(at("finding"), "a coverage failure needs not_covered and insufficient_coverage");
        }
        const inner = validateShapeAt("coverageFailureFinding", finding, at("finding"));
        if (!inner.ok) return inner;
        if (value.citation_ids.length !== 0) return fail(at("citation_ids"), "must be empty for a not-covered state");
        return { ok: true };
      }
      if (kind === "absolute_risk" || kind === "carrier_status") {
        if (!(state === "covered" || state === "partial") || reason !== null) {
          return fail(at("finding"), "a reportable finding needs covered or partial and a null reason");
        }
        if (value.citation_ids.length === 0) return fail(at("citation_ids"), "must be non-empty for a reportable finding");
        return validateShapeAt(kind === "absolute_risk" ? "absoluteRiskFinding" : "carrierFinding", finding, at("finding"));
      }
      return fail(at("finding.kind"), "unknown finding kind");
    }
    case "coverageFailureFinding": {
      if (value.kind !== "coverage_failure") return fail(at("kind"), "must be coverage_failure");
      if (value.metric !== "score_coverage") return fail(at("metric"), "must be score_coverage");
      if (value.required_minimum !== 0.8) return fail(at("required_minimum"), "must be the X10.4 floor 0.8");
      if (!isProbability(value.measured_value) || value.measured_value >= 0.8) {
        return fail(at("measured_value"), "must be 0 through less than the floor");
      }
      if (value.display_copy_id !== "embryo.result.insufficient-coverage") return fail(at("display_copy_id"), "wrong copy id");
      return { ok: true };
    }
    case "absoluteRiskFinding": {
      if (value.kind !== "absolute_risk") return fail(at("kind"), "must be absolute_risk");
      if (!isProbability(value.score_coverage) || value.score_coverage < 0.8) {
        return fail(at("score_coverage"), "an absolute-risk finding is permitted only at or above the floor");
      }
      for (const key of ["absolute_risk", "interval_low", "interval_high"]) {
        if (!isProbability(value[key])) return fail(at(key), "must be 0..1");
      }
      const low = value.interval_low as number;
      const point = value.absolute_risk as number;
      const high = value.interval_high as number;
      if (!(low <= point && point <= high && low < high)) return fail(at("interval_low"), "interval must be low <= point <= high with low < high");
      if (!isFiniteNumber(value.difference_pp)) return fail(at("difference_pp"), "must be a number");
      if (!(value.number_needed_to_select === null || (Number.isInteger(value.number_needed_to_select) && (value.number_needed_to_select as number) > 0))) {
        return fail(at("number_needed_to_select"), "must be null or a positive integer");
      }
      const comparators = value.comparators as Record<string, unknown>[];
      const names = comparators.map((item) => item.comparator);
      if (names.length !== COMPARATORS.length || COMPARATORS.some((name) => !names.includes(name))) {
        return fail(at("comparators"), "must hold each comparator exactly once");
      }
      if (comparators.filter((item) => item.lead === true).length !== 1 || comparators.find((item) => item.lead === true)?.comparator !== "vs_randomly_selected_embryo") {
        return fail(at("comparators"), "exactly the random-selection comparator leads");
      }
      return { ok: true };
    }
    case "embryoRiskModelBinding": {
      if (typeof value.model_id !== "string" || typeof value.model_version !== "string") return fail(at("model_id"), "must be strings");
      if (value.age_band !== "lifetime") return fail(at("age_band"), "must be lifetime");
      if (value.prevalence_basis !== "lifetime_risk") return fail(at("prevalence_basis"), "must be lifetime_risk");
      if (typeof value.birth_cohort !== "string" || value.birth_cohort.length === 0) return fail(at("birth_cohort"), "must be non-empty");
      if (typeof value.calibration_cohort !== "string" || value.calibration_cohort.length === 0) return fail(at("calibration_cohort"), "must be non-empty");
      if (!Number.isInteger(value.calibration_n) || (value.calibration_n as number) <= 0) return fail(at("calibration_n"), "must be a positive integer");
      return { ok: true };
    }
    case "matchedBaseline": {
      for (const key of ["absolute_risk", "interval_low", "interval_high"]) {
        if (!isProbability(value[key])) return fail(at(key), "must be 0..1");
      }
      if (!((value.interval_low as number) < (value.absolute_risk as number) && (value.absolute_risk as number) < (value.interval_high as number))) {
        return fail(at("interval_low"), "must be strictly low < point < high");
      }
      if (!isStringArray(value.citation_ids) || value.citation_ids.length === 0) return fail(at("citation_ids"), "must be non-empty");
      return { ok: true };
    }
    case "naturalFrequency": {
      const numerators = [value.subject_numerator, value.comparator_numerator, value.denominator];
      const allNull = numerators.every((item) => item === null);
      const allInts = numerators.every((item) => Number.isInteger(item) && (item as number) > 0);
      if (!allNull && !allInts) return fail(at("denominator"), "numerators and denominator are positive integers or all null");
      if (allNull && typeof value.fallback_copy_id !== "string") return fail(at("fallback_copy_id"), "must name the fallback when null");
      if (allInts && value.fallback_copy_id !== null) return fail(at("fallback_copy_id"), "must be null when counts exist");
      return { ok: true };
    }
    case "comparatorFinding": {
      if (!isEnum(value.comparator, COMPARATORS)) return fail(at("comparator"), "unknown comparator");
      if (!isFiniteNumber(value.relative_difference) || !isFiniteNumber(value.absolute_difference_pp)) return fail(at("relative_difference"), "must be numbers");
      if (!(value.number_needed_to_select === null || Number.isInteger(value.number_needed_to_select))) return fail(at("number_needed_to_select"), "must be null or an integer");
      if (typeof value.lead !== "boolean") return fail(at("lead"), "must be a boolean");
      if (value.lead === true && value.comparator !== "vs_randomly_selected_embryo") return fail(at("lead"), "only the random-selection comparator leads");
      return { ok: true };
    }
    case "withinFamilyValidation": {
      if (!isEnum(value.status, WITHIN_FAMILY_STATUS_VALUES)) return fail(at("status"), "unknown within-family status");
      if (!isStringArray(value.citation_ids)) return fail(at("citation_ids"), "must be an array");
      if (typeof value.enabled_by_default !== "boolean") return fail(at("enabled_by_default"), "must be a boolean");
      if (value.status === "not_measured") {
        const numeric = [value.point_estimate, value.interval_low, value.interval_high, value.family_count];
        if (!numeric.every((item) => item === null)) return fail(at("point_estimate"), "not_measured carries no numbers");
        if (value.citation_ids.length !== 0) return fail(at("citation_ids"), "not_measured carries no citation");
        if (value.display_copy_id !== "embryo.within-family.not-tested") return fail(at("display_copy_id"), "wrong copy id");
        if (value.enabled_by_default !== false) return fail(at("enabled_by_default"), "a not_measured row is disabled by default");
        return { ok: true };
      }
      if (!(Number.isInteger(value.family_count) && (value.family_count as number) > 0)) return fail(at("family_count"), "must be positive");
      if (value.citation_ids.length === 0) return fail(at("citation_ids"), "must be non-empty");
      const low = value.interval_low;
      const point = value.point_estimate;
      const high = value.interval_high;
      if (!(isFiniteNumber(low) && isFiniteNumber(point) && isFiniteNumber(high) && low < point && point < high)) {
        return fail(at("interval_low"), "must be strictly low < point < high");
      }
      return { ok: true };
    }
    case "carrierFinding": {
      if (value.kind !== "carrier_status") return fail(at("kind"), "must be carrier_status");
      if (!isEnum(value.carrier_state, CARRIER_STATES)) return fail(at("carrier_state"), "unknown carrier state");
      if (!isNullOrString(value.inheritance_mode)) return fail(at("inheritance_mode"), "must be null or a string");
      if (value.confirmation_required !== true) return fail(at("confirmation_required"), "must be true");
      if (typeof value.display_copy_id !== "string") return fail(at("display_copy_id"), "must be a string");
      return { ok: true };
    }
    case "rscEmbryoComparison": {
      if (typeof value.cohort_id !== "string") return fail(at("cohort_id"), "must be a string");
      if (typeof value.standing_statement !== "string" || value.standing_statement.length === 0) {
        return fail(at("standing_statement"), "must be the registered standing statement");
      }
      const embryos = value.embryos as Record<string, unknown>[];
      if (embryos.length === 0) return fail(at("embryos"), "must hold at least one embryo");
      for (let index = 1; index < embryos.length; index++) {
        if ((embryos[index].sample_ordinal as number) <= (embryos[index - 1].sample_ordinal as number)) {
          return fail(at(`embryos[${index}]`), "must ascend by sample_ordinal");
        }
      }
      const labels = embryos.map((embryo) => embryo.display_label as string);
      const rows = value.result_rows as Record<string, unknown>[];
      let previousCondition: string | null = null;
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const findings = rows[rowIndex].findings as Record<string, unknown>[];
        if (findings.length !== labels.length) {
          return fail(at(`result_rows[${rowIndex}]`), "must hold exactly one finding per embryo");
        }
        const first = findings[0];
        for (let index = 0; index < findings.length; index++) {
          const finding = findings[index];
          if (finding.embryo_label !== labels[index]) {
            return fail(at(`result_rows[${rowIndex}].findings[${index}]`), "must follow the identical ascending sample_ordinal");
          }
          for (const key of ["condition_id", "condition_name", "evidence_label"]) {
            if (finding[key] !== first[key]) {
              return fail(at(`result_rows[${rowIndex}].findings[${index}]`), `${key} must be byte-identical across the row`);
            }
          }
        }
        const condition = first.condition_id as string;
        if (previousCondition !== null && condition <= previousCondition) {
          return fail(at(`result_rows[${rowIndex}]`), "must ascend by registry condition_id");
        }
        previousCondition = condition;
      }
      const tradeOffs = value.trade_offs as Record<string, unknown>;
      const conditions = new Set(rows.map((row) => ((row.findings as Record<string, unknown>[])[0].condition_id as string)));
      for (const conflict of tradeOffs.conflicts as Record<string, unknown>[]) {
        if (!labels.includes(conflict.embryo_label as string)) return fail(at("trade_offs.conflicts"), "names an embryo outside the matrix");
        if (!conditions.has(conflict.lowest_condition_id as string) || !conditions.has(conflict.highest_condition_id as string)) {
          return fail(at("trade_offs.conflicts"), "names a condition outside the matrix");
        }
      }
      return { ok: true };
    }
    case "comparisonResultRow":
      return { ok: true };
  }
}

function validateShapeAt(shape: ShapeName, value: unknown, path: string): ShapeVerdict {
  const definition = SHAPES[shape];
  if (!isRecord(value)) return fail(path, "must be an object");
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!definition.keys.includes(key)) return fail(path ? `${path}.${key}` : key, "unknown field");
  }
  for (const key of definition.keys) {
    if (!(key in value)) return fail(path ? `${path}.${key}` : key, "missing field");
  }
  for (const [key, rule] of Object.entries(definition.children)) {
    const child = value[key];
    const childPath = path ? `${path}.${key}` : key;
    if (rule.array) {
      if (!Array.isArray(child)) return fail(childPath, "must be an array");
      for (let index = 0; index < child.length; index++) {
        const verdict = validateShapeAt(rule.shape, child[index], `${childPath}[${index}]`);
        if (!verdict.ok) return verdict;
      }
    } else {
      const verdict = validateShapeAt(rule.shape, child, childPath);
      if (!verdict.ok) return verdict;
    }
  }
  return scalarVerdict(shape, value, path);
}

/**
 * Validate one candidate against a closed shape before it is serialised,
 * cached, logged or sent. A forbidden key anywhere in the tree fails first,
 * so a sex or laboratory field can never ride inside a nested object.
 */
export function validateEmbryoDto(shape: ShapeName, value: unknown): ShapeVerdict {
  const forbidden = findForbiddenKey(value, "$");
  if (forbidden) return fail(forbidden.path, `forbidden field "${forbidden.key}"`);
  return validateShapeAt(shape, value, "");
}

/** The throwing form for the RSC boundary: the caller renders the error state and records `feature.blocked`. */
export function assertEmbryoDto<T>(shape: ShapeName, value: T): T {
  const verdict = validateEmbryoDto(shape, value);
  if (!verdict.ok) throw new EmbryoShapeError(shape, verdict.path, verdict.reason);
  return value;
}

// ---------------------------------------------------------------------------
// The two permitted orders, and nothing else.
// ---------------------------------------------------------------------------

/** Columns ascend by `sample_ordinal`, stable; never by any value. */
export function columnOrder<T extends { sample_ordinal: number }>(embryos: readonly T[]): T[] {
  return [...embryos].sort((left, right) => left.sample_ordinal - right.sample_ordinal);
}

/** Rows ascend by registry `condition_id`, stable; never by spread, count or any computed quantity. */
export function resultRowOrder<T extends { condition_id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => (left.condition_id < right.condition_id ? -1 : left.condition_id > right.condition_id ? 1 : 0));
}

/**
 * Brief line 1355: `displayed === stored`. Every figure payload passes
 * through here unchanged on its way to a <Figure>; there is no multiplier,
 * rounding or unit change between the row and the screen.
 */
export function displayedFigure<T extends number>(stored: T): T {
  return stored;
}
