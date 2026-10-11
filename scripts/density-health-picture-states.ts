import assert from "node:assert/strict";
import type { DensityStateCase } from "./density-capture-plan";

export type HealthPictureDensityRecipe = "processing" | "partial" | "complete" | "uncovered";
export function healthPictureDensityRecipe(row: DensityStateCase): HealthPictureDensityRecipe | null {
  if (row.route.id !== "family.health-picture" || row.route.path !== "/family/health-picture"
    || row.route.kind !== "page" || row.route.auth !== "authenticated" || row.route.stateProfile !== "product-result") return null;
  const recipes: Readonly<Record<string, HealthPictureDensityRecipe>> = {
    processing: "processing", "partial-coverage": "partial", complete: "complete", "not-covered": "uncovered",
  };
  return Object.hasOwn(recipes, row.state) ? recipes[row.state] : null;
}
export const HEALTH_PICTURE_DENSITY_NATIVE_SOURCES = Object.freeze([
  "e2e/family-health-picture.spec.ts",
  "e2e/family-processing-states.spec.ts",
  "e2e/helpers/density-family-state-fixtures.ts",
  "e2e/helpers/density-portrait-state-fixtures.ts",
  "e2e/helpers.ts",
  "e2e/own-report-helpers.ts",
  "e2e/fixtures/carrier-pair-fixture.ts",
  "e2e/fixtures/carrier-pair-positions.ts",
  "e2e/fixtures/carrier-pair-grch38.vcf",
  "e2e/fixtures/tiny-grch38.vcf",
  "e2e/fixtures/PROVENANCE.md",
  "src/app/(app)/family/health-picture/page.tsx",
  "src/lib/family/health-picture-results.ts",
  "src/lib/family/health-picture-projection.ts",
  "src/lib/family/shared-report-results.ts",
  "src/lib/family/access.ts",
  "src/lib/family/graph.ts",
  "src/lib/family/tier2.ts",
  "src/lib/genome/load.ts",
  "src/components/family/result-gate.tsx",
  "src/app/api/family/acknowledge/route.ts",
  "src/app/api/consents/route.ts",
  "src/app/api/consents/[id]/revoke/route.ts",
  "src/lib/uploads/subject-upload-contract.ts",
  "src/copy/family/health-picture.ts",
  "src/copy/family/person.ts",
  "supabase/migrations/20260903120000_family_sharing_runtime.sql",
  "supabase/migrations/20260906134636_own_upload_normalization.sql",
  "supabase/migrations/20260906143041_own_analysis_generation.sql",
  "supabase/migrations/20260907124212_family_shared_report_results.sql",
  "supabase/migrations/20260907153506_health_picture_canonical_results.sql",
  "supabase/migrations/20260918213000_shared_report_readiness_completed_runs.sql"
]);
export type HealthPictureFacts = Record<string, Record<string, unknown>[]>;
const same = (a: unknown, b: unknown) => assert.deepEqual(a, b, "Complete Health Picture native transition drift");

/** Only the native revocation of one revision-bound directional layer may
 * change these protected bags. Own results, source rows, signatures, snapshot
 * bindings and the joint/other layer grants remain whole and byte-equivalent.
 * The real API's purge/legal audit side effects are not hidden in this bag. */
export function checkedHealthPictureLayerWithdrawal(before: HealthPictureFacts, after: HealthPictureFacts, grantId: string) {
  same(Object.keys(after).sort(), Object.keys(before).sort());
  const grants = before.grants.filter(row => row.grant_id === grantId);
  const directions = before.directions.filter(row => row.grant_id === grantId);
  assert(grants.length === 1 && directions.length === 1, "One actual revision-bound layer grant required");
  const grant = grants[0], direction = directions[0];
  assert(grant.purpose === "reports.polygenic" && grant.revoked_at === null && direction.status === "current"
    && direction.direction === "subject_to_recipient" && direction.grant_revision === grant.grant_revision,
    "Only the actual current directional estimates layer may be withdrawn");
  same(after.grants.map(row => row.grant_id), before.grants.map(row => row.grant_id));
  same(after.directions.map(row => row.grant_id), before.directions.map(row => row.grant_id));
  let revokedAt: string | undefined;
  for (const old of before.grants) {
    const current = after.grants.find(row => row.grant_id === old.grant_id); assert(current);
    if (old.grant_id === grantId) {
      assert(typeof current.revoked_at === "string" && Number.isFinite(Date.parse(current.revoked_at)), "Actual withdrawal timestamp required");
      revokedAt = current.revoked_at;
      same(current, { ...old, revoked_at: revokedAt, revocation_reason: "withdrawn" });
    } else same(current, old);
  }
  for (const old of before.directions) {
    const current = after.directions.find(row => row.grant_id === old.grant_id); assert(current);
    same(current, old.grant_id === grantId ? { ...old, status: "revoked", ended_at: revokedAt } : old);
  }
  for (const name of Object.keys(before).filter(name => !["grants", "directions"].includes(name))) same(after[name], before[name]);
  return after;
}

/** A held preparation is already genuinely finalized and verified, but has
 * no normalization or report. The independently prepared viewer supplies the
 * real table rows. Nothing here writes a status or creates a result. */
export function checkedHealthPicturePreparationHold(facts: HealthPictureFacts, heldId: string, heldSubject: string,
  readyId: string, readySubject: string, expected: { heldSha256: string; readySha256: string }) {
  assert(heldId !== readyId && heldSubject !== readySubject, "Two independent actual sources required");
  const held = facts.files.filter(row => row.id === heldId), ready = facts.files.filter(row => row.id === readyId);
  assert(facts.files.length === 2 && held.length === 1 && ready.length === 1, "Exactly the two owned uploaded sources required");
  assert(held[0].subject_id === heldSubject && held[0].status === "uploaded"
    && held[0].sha256 === expected.heldSha256 && held[0].normalization_completed_at === null
    && held[0].normalization_source_revision === null && typeof held[0].single_logical_sample_verified_at === "string"
    && Number.isFinite(Date.parse(held[0].single_logical_sample_verified_at)), "Actual finalized source must remain in preparation");
  assert(ready[0].subject_id === readySubject && ready[0].status === "stored" && ready[0].sha256 === expected.readySha256
    && typeof ready[0].normalization_completed_at === "string" && Number.isFinite(Date.parse(ready[0].normalization_completed_at))
    && ready[0].normalization_source_revision === ready[0].upload_revision, "Viewer's real prepared source required");
  assert(facts.own_completions.length === 1 && facts.own_completions[0].fileId === readyId
    && facts.own_completions[0].purpose === "reports.polygenic" && facts.own_completions[0].complete === true
    && typeof facts.own_completions[0].completed_at === "string" && Number.isFinite(Date.parse(facts.own_completions[0].completed_at)),
    "Only the independently selected, completed estimate journal may exist");
  for (const name of ["user_prs", "user_variants", "report_observed_calls", "ancestry_results"])
    assert(facts[name].every(row => row.file_id !== heldId), "Held preparation must publish no result rows");
  return facts;
}
