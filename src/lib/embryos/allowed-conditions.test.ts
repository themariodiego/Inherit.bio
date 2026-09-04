import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_CONDITION_CATEGORIES,
  UnregisteredConditionError,
  allowedConditions,
  allowedConditionsRegistry,
  assertConditionRegistered,
  forbiddenPhenotypeClasses,
  registryIsEmpty,
  validateRegistryEntry,
  type AllowedConditionEntry,
  type RegistryEvidence,
  type RiskModelRow,
} from "./allowed-conditions";

/**
 * Brief §4 §6.9 and line 1417: the committed registry has zero conditions,
 * its five categories are byte-equal to condition_registry's check list,
 * every forbidden class is present, and an entry fails when it sits outside
 * the categories, uses a sex-stratified model, lacks a within-family
 * citation or is absent from condition_registry.
 */

const MIGRATION = path.join(process.cwd(), "supabase/migrations/20260831224126_reference_registries_and_constraints.sql");

function sqlCategories(): string[] {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const block = sql.match(/create table public\.condition_registry[\s\S]*?category text not null check \(category in \(([\s\S]*?)\)\)/)?.[1];
  if (!block) throw new Error("condition_registry category check not found");
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function model(overrides: Partial<RiskModelRow> = {}): RiskModelRow {
  return {
    model_id: "m1",
    condition_id: "c1",
    sex_basis: "combined",
    age_band: "lifetime",
    prevalence_basis: "lifetime_risk",
    birth_cohort: "1990s",
    calibration_cohort: "synthetic",
    calibration_n: 1000,
    baseline_low: 0.04,
    baseline_point: 0.05,
    baseline_high: 0.06,
    within_family_status: "measured",
    within_family_citation_ids: ["synthetic:1"],
    within_family_family_count: 500,
    enabled: true,
    ...overrides,
  };
}

function entry(overrides: Partial<AllowedConditionEntry> = {}): AllowedConditionEntry {
  return {
    condition_id: "c1",
    condition_name: "Synthetic condition",
    category: "Heart and circulation",
    permitted_result_kinds: ["absolute_risk"],
    risk_model_id: "m1",
    enabled_by_default: true,
    ...overrides,
  };
}

function evidence(overrides: Partial<RegistryEvidence> = {}): RegistryEvidence {
  return {
    conditionRegistry: [{ condition_id: "c1", condition_name: "Synthetic condition", category: "Heart and circulation", active: true }],
    riskModels: [model()],
    ...overrides,
  };
}

describe("allowed conditions registry", () => {
  it("is empty today, deliberately, and says so", () => {
    expect(allowedConditions()).toEqual([]);
    expect(registryIsEmpty()).toBe(true);
    expect(allowedConditionsRegistry().status).toBe("withheld_until_calibrated_models_are_registered");
  });

  it("names the five categories byte-equal to condition_registry's check list", () => {
    expect([...ALLOWED_CONDITION_CATEGORIES]).toEqual(sqlCategories());
    expect(allowedConditionsRegistry().allowed_categories).toEqual(sqlCategories());
  });

  it("lists every forbidden phenotype class", () => {
    const classes = forbiddenPhenotypeClasses();
    for (const required of ["cognitive", "educational", "personality", "behavioural", "height", "weight", "bmi", "appearance", "athleticism", "longevity", "sex", "composite"]) {
      expect(classes, required).toContain(required);
    }
    expect(classes).toHaveLength(18);
  });

  it("refuses an unregistered condition before any job is enqueued", () => {
    expect(() => assertConditionRegistered("anything")).toThrow(UnregisteredConditionError);
    expect(assertConditionRegistered("c1", { ...allowedConditionsRegistry(), conditions: [entry()] })).toEqual(entry());
  });

  it("accepts a well-formed entry and fails each broken one by name", () => {
    expect(validateRegistryEntry(entry(), evidence())).toEqual({ ok: true });
    const outside = validateRegistryEntry(entry({ category: "Brain, memory and mood" }), evidence({ conditionRegistry: [{ condition_id: "c1", condition_name: "Synthetic condition", category: "Brain, memory and mood", active: true }] }));
    expect(outside).toMatchObject({ ok: false });
    expect((outside as { reasons: string[] }).reasons.join(" ")).toMatch(/allowed categories/);
    const stratified = validateRegistryEntry(entry(), evidence({ riskModels: [model({ sex_basis: "female" })] }));
    expect((stratified as { reasons: string[] }).reasons.join(" ")).toMatch(/sex-stratified/);
    const uncited = validateRegistryEntry(entry(), evidence({ riskModels: [model({ within_family_citation_ids: [] })] }));
    expect((uncited as { reasons: string[] }).reasons.join(" ")).toMatch(/sibling-validation citation/);
    const absent = validateRegistryEntry(entry(), evidence({ conditionRegistry: [] }));
    expect((absent as { reasons: string[] }).reasons.join(" ")).toMatch(/condition_registry holds 0 rows/);
    const notMeasuredEnabled = validateRegistryEntry(entry(), evidence({ riskModels: [model({ within_family_status: "not_measured", within_family_citation_ids: [], within_family_family_count: null })] }));
    expect((notMeasuredEnabled as { reasons: string[] }).reasons.join(" ")).toMatch(/enabled by default/);
    const carrierOnly = validateRegistryEntry(entry({ category: "Having children" }), evidence({ conditionRegistry: [{ condition_id: "c1", condition_name: "Synthetic condition", category: "Having children", active: true }] }));
    expect((carrierOnly as { reasons: string[] }).reasons.join(" ")).toMatch(/carrier status only/);
  });
});
