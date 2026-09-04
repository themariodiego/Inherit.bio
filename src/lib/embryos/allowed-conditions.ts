/**
 * The embryo condition allow-list (brief §4 §6.9, X10; design §2.6). This
 * module is the one reader of `data/embryo/allowed_conditions.json`, the
 * only condition-eligibility source for every embryo surface, job and export
 * (`docs/route-register.json#policyContracts.embryo-autosomal-only-v1
 * .allowedConditionsRegistry`).
 *
 * Today the committed file holds zero conditions, and that emptiness is a
 * deliberate, valid state: it withholds every numeric embryo finding and
 * drives the honest "no calibrated model is registered" sentence on the
 * compare and detail surfaces. Nothing here may populate it. An entry becomes
 * eligible only when it resolves to exactly one `condition_registry` row with
 * the same id, name and one allowed category, and its risk model meets every
 * `model_constraints` rule; a condition outside the exact current registry is
 * refused before any job is enqueued (`requestRule`).
 */
import registryJson from "../../../data/embryo/allowed_conditions.json";
import type { CategoryId } from "@/lib/genome/taxonomy";

/** The five permitted embryo categories, byte-equal to `condition_registry`'s check list (brief §2 §6.3). */
export const ALLOWED_CONDITION_CATEGORIES = [
  "Heart and circulation",
  "Food, drink and metabolism",
  "Immune system and allergies",
  "Cancer",
  "Having children",
] as const;
export type AllowedConditionCategory = (typeof ALLOWED_CONDITION_CATEGORIES)[number];

/** The user-facing category id each allowed category renders under. */
export const ALLOWED_CATEGORY_IDS: Record<AllowedConditionCategory, CategoryId> = {
  "Heart and circulation": "heart-circulation",
  "Food, drink and metabolism": "food-drink-metabolism",
  "Immune system and allergies": "immune-allergies",
  Cancer: "cancer",
  "Having children": "having-children",
};

/** Carrier status is the only result kind "Having children" may carry (register `carrierFinding.categoryRule`). */
export const CARRIER_ONLY_CATEGORY: AllowedConditionCategory = "Having children";

export const PERMITTED_RESULT_KINDS = ["absolute_risk", "carrier_status"] as const;
export type PermittedResultKind = (typeof PERMITTED_RESULT_KINDS)[number];

export const WITHIN_FAMILY_STATUSES = ["measured", "measured_inconclusive", "not_measured"] as const;
export type WithinFamilyStatus = (typeof WITHIN_FAMILY_STATUSES)[number];

/** One entry of `conditions[]`, in the register's `entryShape` order. */
export interface AllowedConditionEntry {
  condition_id: string;
  condition_name: string;
  category: string;
  permitted_result_kinds: string[];
  risk_model_id: string | null;
  enabled_by_default: boolean;
}

export interface AllowedConditionsFile {
  schema_version: number;
  status: string;
  model_constraints: {
    sex: string;
    age_band: string;
    prevalence_basis: string;
    within_family_status: string[];
  };
  allowed_categories: string[];
  forbidden_phenotype_classes: string[];
  conditions: AllowedConditionEntry[];
}

const FILE = registryJson as unknown as AllowedConditionsFile;

function assertFileShape(file: AllowedConditionsFile): void {
  const listed = file.allowed_categories;
  const expected: readonly string[] = ALLOWED_CONDITION_CATEGORIES;
  if (listed.length !== expected.length || listed.some((value, index) => value !== expected[index])) {
    throw new Error(
      `data/embryo/allowed_conditions.json allowed_categories differ from ALLOWED_CONDITION_CATEGORIES: ${listed.join(", ")}`,
    );
  }
  if (!Array.isArray(file.conditions)) {
    throw new Error("data/embryo/allowed_conditions.json conditions must be an array");
  }
  if (file.model_constraints.sex !== "combined" || file.model_constraints.age_band !== "lifetime") {
    throw new Error("data/embryo/allowed_conditions.json model_constraints must be sex combined, age band lifetime");
  }
}

assertFileShape(FILE);

/** The committed registry, read once. Tests inject a synthetic one through the `registry` argument. */
export function allowedConditionsRegistry(): AllowedConditionsFile {
  return FILE;
}

export function allowedConditions(registry: AllowedConditionsFile = FILE): readonly AllowedConditionEntry[] {
  return registry.conditions;
}

/** True while no condition is registered: every numeric embryo finding is withheld and the surfaces say so. */
export function registryIsEmpty(registry: AllowedConditionsFile = FILE): boolean {
  return registry.conditions.length === 0;
}

export function registryStatus(registry: AllowedConditionsFile = FILE): string {
  return registry.status;
}

export function forbiddenPhenotypeClasses(registry: AllowedConditionsFile = FILE): readonly string[] {
  return registry.forbidden_phenotype_classes;
}

export function isAllowedCategory(value: string): value is AllowedConditionCategory {
  return (ALLOWED_CONDITION_CATEGORIES as readonly string[]).includes(value);
}

export function findAllowedCondition(
  conditionId: string,
  registry: AllowedConditionsFile = FILE,
): AllowedConditionEntry | null {
  return registry.conditions.find((entry) => entry.condition_id === conditionId) ?? null;
}

export class UnregisteredConditionError extends Error {
  constructor(public readonly conditionId: string) {
    super(`Condition "${conditionId}" is not in data/embryo/allowed_conditions.json`);
    this.name = "UnregisteredConditionError";
  }
}

/**
 * The register's `requestRule`: a condition outside the exact current
 * registry is refused before enqueue, retrieval or serialisation and creates
 * no result row. Every embryo job and every result reader calls this first.
 */
export function assertConditionRegistered(
  conditionId: string,
  registry: AllowedConditionsFile = FILE,
): AllowedConditionEntry {
  const entry = findAllowedCondition(conditionId, registry);
  if (!entry) throw new UnregisteredConditionError(conditionId);
  return entry;
}

/** The `condition_registry` columns an eligibility check reads. */
export interface ConditionRegistryRow {
  condition_id: string;
  condition_name: string;
  category: string;
  active: boolean;
}

/** The `risk_models` columns an eligibility check reads, plus the within-family evidence the registry demands. */
export interface RiskModelRow {
  model_id: string;
  condition_id: string;
  sex_basis: string;
  age_band: string;
  prevalence_basis: string;
  birth_cohort: string;
  calibration_cohort: string;
  calibration_n: number;
  baseline_low: number;
  baseline_point: number;
  baseline_high: number;
  within_family_status: string;
  /** The published sibling-validation citations; required unless `not_measured`. */
  within_family_citation_ids: readonly string[];
  within_family_family_count: number | null;
  enabled: boolean;
}

export interface RegistryEvidence {
  conditionRegistry: readonly ConditionRegistryRow[];
  riskModels: readonly RiskModelRow[];
}

export type RegistryEntryVerdict = { ok: true } | { ok: false; reasons: string[] };

/**
 * Whether one registry entry may render (brief §4 §6.9 CI validation;
 * register `conditionRegistryEquality` and `modelConstraints`). Every failure
 * is named, because a silent drop would look like an honest empty state.
 */
export function validateRegistryEntry(
  entry: AllowedConditionEntry,
  evidence: RegistryEvidence,
  registry: AllowedConditionsFile = FILE,
): RegistryEntryVerdict {
  const reasons: string[] = [];
  if (!isAllowedCategory(entry.category)) {
    reasons.push(`category "${entry.category}" is not one of the five allowed categories`);
  }
  const rows = evidence.conditionRegistry.filter((row) => row.condition_id === entry.condition_id);
  if (rows.length !== 1) {
    reasons.push(`condition_registry holds ${rows.length} rows for "${entry.condition_id}", not exactly one`);
  } else {
    const row = rows[0];
    if (row.condition_name !== entry.condition_name) reasons.push("condition_name differs from condition_registry");
    if (row.category !== entry.category) reasons.push("category differs from condition_registry");
    if (!row.active) reasons.push("condition_registry row is not active");
  }
  const kinds = entry.permitted_result_kinds;
  if (kinds.length === 0 || kinds.some((kind) => !(PERMITTED_RESULT_KINDS as readonly string[]).includes(kind))) {
    reasons.push("permitted_result_kinds must be a non-empty subset of absolute_risk and carrier_status");
  }
  if (entry.category === CARRIER_ONLY_CATEGORY && kinds.some((kind) => kind !== "carrier_status")) {
    reasons.push(`"${CARRIER_ONLY_CATEGORY}" permits carrier status only`);
  }
  if (kinds.includes("absolute_risk")) {
    const model = entry.risk_model_id
      ? evidence.riskModels.find(
          (row) => row.model_id === entry.risk_model_id && row.condition_id === entry.condition_id,
        )
      : undefined;
    if (!model) {
      reasons.push("an absolute-risk entry needs a risk_models row for its risk_model_id and condition");
    } else {
      const constraints = registry.model_constraints;
      if (model.sex_basis !== constraints.sex) reasons.push("risk model is sex-stratified; only a combined model is eligible");
      if (model.age_band !== constraints.age_band) reasons.push("risk model age band is not lifetime");
      if (model.prevalence_basis !== constraints.prevalence_basis) reasons.push("risk model prevalence basis is not lifetime risk");
      if (model.birth_cohort.trim().length === 0) reasons.push("risk model birth cohort is empty");
      if (model.calibration_cohort.trim().length === 0) reasons.push("risk model calibration cohort is empty");
      if (!Number.isInteger(model.calibration_n) || model.calibration_n <= 0) reasons.push("risk model calibration_n is not a positive integer");
      if (!(model.baseline_low < model.baseline_point && model.baseline_point < model.baseline_high)) {
        reasons.push("risk model baseline interval is not strictly low < point < high");
      }
      if (!(WITHIN_FAMILY_STATUSES as readonly string[]).includes(model.within_family_status)) {
        reasons.push(`within_family_status "${model.within_family_status}" is not registered`);
      } else if (model.within_family_status !== "not_measured") {
        if (model.within_family_citation_ids.length === 0) reasons.push("a measured within-family status needs a published sibling-validation citation");
        if (!model.within_family_family_count || model.within_family_family_count <= 0) reasons.push("a measured within-family status needs a positive family count");
      }
      if (model.within_family_status === "not_measured" && entry.enabled_by_default) {
        reasons.push("a not_measured row may not be enabled by default (within_family_default)");
      }
      if (!model.enabled) reasons.push("risk model is not enabled");
    }
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/** Every entry's verdict, keyed by condition id. */
export function validateRegistry(
  evidence: RegistryEvidence,
  registry: AllowedConditionsFile = FILE,
): Map<string, RegistryEntryVerdict> {
  return new Map(
    registry.conditions.map((entry) => [entry.condition_id, validateRegistryEntry(entry, evidence, registry)]),
  );
}
