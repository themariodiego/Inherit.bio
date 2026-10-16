import assert from "node:assert/strict";
import type { DensityStateCase } from "./density-capture-plan";

export type JurisdictionDensityRecipe = "family-hub-denied" | "invitation-denied" | "health-denied"
  | "cohort-hub-denied" | "cohort-route-denied" | "health-empty";
export const JURISDICTION_DENSITY_STATES: Readonly<Record<string, Readonly<Record<string, JurisdictionDensityRecipe>>>> = {
  "family.index": { "jurisdiction-unavailable": "family-hub-denied" },
  "family.invite": { "jurisdiction-unavailable": "invitation-denied" },
  "family.health-picture": { empty: "health-empty", "jurisdiction-unavailable": "health-denied" },
  "embryos.index": { "jurisdiction-unavailable": "cohort-hub-denied" },
  "embryos.upload": { "jurisdiction-unavailable": "cohort-route-denied" },
  "embryos.request-data": { "jurisdiction-unavailable": "cohort-route-denied" },
  "embryos.compare": { "jurisdiction-unavailable": "cohort-route-denied" },
  "embryos.detail": { "jurisdiction-unavailable": "cohort-route-denied" },
};
export const DENSITY_TEST_DENY_SENTENCE = "This capability is blocked for the TEST-DENY acceptance fixture.";
export function jurisdictionDensityRecipe(row: DensityStateCase): JurisdictionDensityRecipe | null {
  return Object.hasOwn(JURISDICTION_DENSITY_STATES, row.route.id)
    && Object.hasOwn(JURISDICTION_DENSITY_STATES[row.route.id], row.state)
    ? JURISDICTION_DENSITY_STATES[row.route.id][row.state] : null;
}

export const JURISDICTION_DENSITY_TABLES = ["profiles", "subjects", "subject_principals", "genome_files",
  "subject_consents", "consent_signatures", "consent_grants", "directional_grants_received", "family_sharing_pauses",
  "cohorts", "drafts", "account_operation_nonces", "family_pairs", "purpose_grants", "invitations",
  "participant_sets", "published_attestations"] as const;
export type FreshJurisdictionRows = Record<typeof JURISDICTION_DENSITY_TABLES[number], Record<string, unknown>[]>;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object"
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Object.values(Object.getOwnPropertyDescriptors(value)).every(property => "value" in property));

/** Complete native facts, never a jurisdiction inferred from the browser or
 * an empty-looking page. The real route alone declares the TEST denial. */
export function assertFreshJurisdictionRows(value: unknown, accountId: string, denied: boolean): asserts value is FreshJurisdictionRows {
  assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(accountId), "Actual account required");
  assert(record(value) && Object.keys(value).length === JURISDICTION_DENSITY_TABLES.length
    && JURISDICTION_DENSITY_TABLES.every(name => Object.hasOwn(value, name) && Array.isArray(value[name])
      && (value[name] as unknown[]).every(record)), "Complete ordinary native rows required");
  const rows = value as FreshJurisdictionRows;
  assert(rows.profiles.length === 1 && rows.profiles[0].id === accountId, "Exact native actor profile required");
  const profile = rows.profiles[0];
  assert(profile.deletion_requested_at === null, "Live actor required");
  assert(rows.subjects.length === 1 && rows.subjects[0].owner_account_id === accountId
    && rows.subjects[0].subject_account_id === accountId && rows.subjects[0].subject_class === "self"
    && rows.subjects[0].lifecycle === "active", "Only the actual fresh self subject is permitted");
  assert(rows.subject_principals.length === 1 && rows.subject_principals[0].account_id === accountId
    && rows.subject_principals[0].subject_id === rows.subjects[0].id
    && rows.subject_principals[0].principal_kind === "account_subject" && rows.subject_principals[0].status === "active",
  "Exact live actor principal required");
  for (const name of ["genome_files", "subject_consents", "consent_signatures", "consent_grants",
    "directional_grants_received", "family_sharing_pauses", "cohorts", "drafts", "family_pairs",
    "purpose_grants", "invitations", "participant_sets"] as const)
    assert(rows[name].length === 0, "A fresh account cannot hide a source, grant, pair, invitation or cohort");
  assert(rows.account_operation_nonces.every(row => row.account_id === accountId), "Exact actor operation history required");
  assert(rows.published_attestations.length === 1, "One current native jurisdiction attestation required");
  const artifact = rows.published_attestations[0];
  assert(artifact.artifact_key === "attestation.jurisdiction" && artifact.superseded_at === null
    && Number.isSafeInteger(artifact.version) && (artifact.version as number) > 0
    && typeof artifact.body_sha256 === "string" && /^[a-f0-9]{64}$/.test(artifact.body_sha256),
  "The actual current attestation is required");
  if (denied) assert(profile.jurisdiction_code === "XX" && profile.jurisdiction_subdivision === null
    && typeof profile.jurisdiction_declared_at === "string" && Number.isFinite(Date.parse(profile.jurisdiction_declared_at))
    && profile.jurisdiction_attestation_version === artifact.version
    && profile.jurisdiction_attestation_sha256 === artifact.body_sha256, "Actual current TEST-DENY declaration required");
  else assert(typeof profile.jurisdiction_code === "string" && profile.jurisdiction_code !== "XX", "The actual permitted empty page must decide access");
}
