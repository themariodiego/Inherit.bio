import assert from "node:assert/strict";
import type { DensityStateCase } from "./density-capture-plan";

export type PortraitDensityRecipe = "processing" | "partial" | "complete" | "uncovered" | "jurisdiction";
export function portraitDensityRecipe(row: DensityStateCase): PortraitDensityRecipe | null {
  if (row.route.id !== "family.portrait" || row.route.path !== "/family/portrait/[pairId]"
    || row.route.kind !== "page" || row.route.auth !== "authenticated" || row.route.stateProfile !== "product-result") return null;
  const recipes: Readonly<Record<string, PortraitDensityRecipe>> = { processing: "processing", "partial-coverage": "partial",
    complete: "complete", "not-covered": "uncovered", "jurisdiction-unavailable": "jurisdiction" };
  return Object.hasOwn(recipes, row.state) ? recipes[row.state] : null;
}
export const PORTRAIT_DENSITY_NATIVE_SOURCES = Object.freeze([
  "e2e/portrait-reviewed-carrier.spec.ts", "e2e/portrait.spec.ts", "e2e/helpers/density-family-state-fixtures.ts",
  "e2e/helpers.ts", "e2e/own-report-helpers.ts", "e2e/fixtures/carrier-pair-fixture.ts", "e2e/fixtures/carrier-pair-b-fixture.ts",
  "e2e/fixtures/carrier-pair-grch38.vcf", "e2e/fixtures/carrier-pair-b-grch38.vcf", "e2e/fixtures/PROVENANCE.md",
  "data/family-trait-allowlist.json", "src/app/(app)/family/portrait/[pairId]/page.tsx", "src/lib/family/portrait.ts",
  "src/lib/family/carrier-pair.ts", "src/lib/family/carrier-canonical.ts", "src/lib/family/portrait-source-readiness.ts",
  "src/lib/genome/load.ts", "src/app/api/settings/jurisdiction/route.ts",
  "supabase/migrations/20260903120000_family_sharing_runtime.sql", "supabase/migrations/20260927100000_jurisdiction_subdivision.sql",
  "supabase/migrations/20260923101135_family_portrait_navigation.sql", "supabase/migrations/20260907142213_portrait_canonical_source_readiness.sql",
  "supabase/migrations/20260929130000_carrier_assertions.sql",
]);

type Facts = Record<string, Record<string, unknown>[]>;
const same = (a: unknown, b: unknown) => assert.deepEqual(a, b, "Complete Portrait native transition drift");
/** This exact native declaration revokes both Portrait directions and demotes
 * their pair to pending. It does not create results, erase source rows, reset
 * acknowledgement or pretend an ended/foreign resource is available. */
export function checkedPortraitJurisdictionTransition(before: Facts, after: Facts, viewer: string, pairId: string) {
  same(Object.keys(after).sort(), Object.keys(before).sort());
  const pair = before.family_pairs.filter(row => row.id === pairId);
  assert(pair.length === 1 && pair[0].status === "current", "One genuine current Portrait pair required");
  same(after.family_pairs, before.family_pairs.map(row => row.id === pairId ? { ...row, status: "pending" } : row));
  const directions = before.directions.filter(row => row.pair_id === pairId && row.status === "current"
    && row.direction === "subject_to_recipient");
  assert(directions.length === 2 && new Set(directions.map(row => row.grant_id)).size === 2,
    "Both actual current Portrait directions required");
  const ids = new Set(directions.map(row => row.grant_id));
  assert(directions.every(direction => before.grants.some(grant => grant.grant_id === direction.grant_id
    && grant.grant_revision === direction.grant_revision && grant.purpose === "family.portrait" && grant.revoked_at === null)),
    "Both exact revision-bound Portrait grants required");
  same(after.grants.map(row => row.grant_id), before.grants.map(row => row.grant_id));
  for (const old of before.grants) {
    const current = after.grants.find(row => row.grant_id === old.grant_id); assert(current);
    if (ids.has(old.grant_id)) {
      assert(typeof current.revoked_at === "string" && Number.isFinite(Date.parse(current.revoked_at)), "Actual revocation time required");
      same(current, { ...old, revoked_at: current.revoked_at, revocation_reason: "jurisdiction_changed" });
    } else same(current, old);
  }
  same(after.directions.map(row => row.grant_id), before.directions.map(row => row.grant_id));
  for (const old of before.directions) {
    const current = after.directions.find(row => row.grant_id === old.grant_id); assert(current);
    if (ids.has(old.grant_id)) {
      assert(typeof current.ended_at === "string" && Number.isFinite(Date.parse(current.ended_at)), "Actual direction end time required");
      same(current, { ...old, status: "revoked", ended_at: current.ended_at });
    } else same(current, old);
  }
  same(after.profiles.map(row => row.id), before.profiles.map(row => row.id));
  assert(before.profiles.filter(row => row.id === viewer).length === 1, "Actual declaring viewer required");
  for (const old of before.profiles) {
    const current = after.profiles.find(row => row.id === old.id); assert(current);
    if (old.id !== viewer) same(current, old);
    else {
      assert(typeof current.jurisdiction_declared_at === "string" && Number.isFinite(Date.parse(current.jurisdiction_declared_at)), "Actual declaration time required");
      assert(Number.isSafeInteger(current.jurisdiction_attestation_version) && Number(current.jurisdiction_attestation_version) > 0
        && typeof current.jurisdiction_attestation_sha256 === "string" && /^[a-f0-9]{64}$/.test(current.jurisdiction_attestation_sha256),
        "Current actual signed attestation required");
      same(current, { ...old, jurisdiction_code: "XX", jurisdiction_subdivision: null,
        jurisdiction_declared_at: current.jurisdiction_declared_at,
        jurisdiction_attestation_version: current.jurisdiction_attestation_version,
        jurisdiction_attestation_sha256: current.jurisdiction_attestation_sha256 });
    }
  }
  for (const name of Object.keys(before).filter(name => !["profiles", "grants", "directions", "family_pairs"].includes(name))) same(after[name], before[name]);
  return after;
}
