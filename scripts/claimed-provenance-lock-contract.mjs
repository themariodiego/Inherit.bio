import assert from "node:assert/strict";

export const OWNED_PROJECT = "inherit-integrator-20260930";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** These IDs only select a real committed synthetic native fixture. They do
 * not supply source rows, candidates, provider ACKs or deletion authority. */
export function assertClaimedProvenanceFixture(input, project, head) {
  assert(input && typeof input === "object" && !Array.isArray(input));
  assert.deepEqual(Object.keys(input).sort(), ["version", "projectId", "sourceCommit", "accountDeletionId",
    "claimantManifestId", "claimTokenHash"].sort(), "Unexpected concurrency fixture fields");
  assert.equal(project, OWNED_PROJECT, "Only the reserved owned synthetic database may run this proof");
  assert.equal(input.projectId, project);
  assert.equal(input.version, "claimed-provenance-concurrency-fixture-v1");
  assert.match(head, /^[0-9a-f]{40}$/);
  assert.equal(input.sourceCommit, head, "Concurrency fixture must bind the exact checked-out source");
  assert.match(input.accountDeletionId, uuid); assert.match(input.claimantManifestId, uuid);
  assert.notEqual(input.accountDeletionId, input.claimantManifestId);
  assert.match(input.claimTokenHash, /^[0-9a-f]{64}$/);
  return input;
}
export function assertClaimedProvenanceCatalog(actual, pins) {
  assert.deepEqual(actual, pins.map(pin => ({ ...pin, owner: "postgres", language: "plpgsql",
    securityDefiner: true, volatility: "v", parallel: "u", defaults: null,
    apiRoles: [], foreignAcl: 0, ownerAcl: 1 })), "Shared receipt native source or API boundary differs");
}
