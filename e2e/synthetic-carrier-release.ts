import { expect } from "@playwright/test";
import { adminClient } from "./helpers";

/**
 * A synthetic reviewed carrier release for the browser suite, written and
 * activated through the rule's own doors and nothing else
 * (migration 20260929130000_carrier_assertions.sql):
 *
 *   - `import_clinical_assertion_release_v1` imports the release with every
 *     condition INACTIVE. The release id is `synthetic-…` and every condition
 *     id `SYNTHETIC:…`; the database refuses a synthetic condition under a
 *     ClinVar release and the reverse. Importing a release retires the current
 *     synthetic release, so no earlier spec's assertions stay readable.
 *   - `review_carrier_condition_v1` is the one door that may change a
 *     condition's state, and it records who decided. The reviewer here is a
 *     test identity and says so in every field: it is not a person, not a
 *     review and not an approval of anything.
 *
 * No person's data is written, nothing is seeded into a production path, and
 * every spec withdraws what it activated through the same door afterwards.
 */

/** The synthetic reviewer identity, marked as a browser test identity in every field the review door records. */
export function syntheticReviewer(spec: string) {
  return { name: "Synthetic test reviewer", role: "Browser test identity, not a person", reference: spec } as const;
}

export interface SyntheticAssertion {
  variationId: number;
  variantName: string;
  reviewStatus: "practice guideline" | "reviewed by expert panel" | "criteria provided, multiple submitters, no conflicts";
  reviewStars: 2 | 3 | 4;
  lastEvaluated: string | null;
  pos: number;
  ref: string;
  alt: string;
}

export interface SyntheticCondition {
  conditionId: `SYNTHETIC:${number}`;
  conditionName: string;
  gene: string;
  assertions: SyntheticAssertion[];
}

export function syntheticReleasePayload(releaseId: string, conditions: readonly SyntheticCondition[]) {
  expect(releaseId).toMatch(/^synthetic-[a-z0-9][a-z0-9-]{0,47}$/);
  return {
    release: {
      releaseId, source: "synthetic", sourceUrl: `https://example.invalid/${releaseId}`,
      sourceSha256: "a".repeat(64), sourceBytes: 1, sourcePublishedOn: "2026-09-03", retrievedAt: "2026-09-28T08:40:57Z",
      extractSha256: "b".repeat(64), geneValidityUrl: "https://example.invalid/synthetic-gene-validity",
      geneValiditySha256: "c".repeat(64), geneValidityCreatedOn: "2026-09-28",
    },
    conditions: conditions.map((condition) => ({
      conditionId: condition.conditionId, conditionName: condition.conditionName, geneSymbol: condition.gene,
      inheritanceMode: "autosomal_recessive", geneValidityClassification: "Definitive", geneValidityClassifiedOn: "2022-06-01",
      geneValidityUrl: `https://example.invalid/synthetic-validity-${condition.gene.toLowerCase()}`,
    })),
    assertions: conditions.flatMap((condition) => condition.assertions.map((assertion) => ({
      variationId: assertion.variationId, conditionId: condition.conditionId, geneSymbol: condition.gene,
      variantName: assertion.variantName, classification: "Pathogenic", reviewStatus: assertion.reviewStatus,
      reviewStars: assertion.reviewStars, conflict: false, lastEvaluated: assertion.lastEvaluated,
      grch38: [1, assertion.pos, assertion.ref, assertion.alt], grch37: null, grch38Equivalents: [],
    }))),
  };
}

export async function conditionState(conditionId: string): Promise<{ revision: number; active: boolean }> {
  const { data, error } = await adminClient().from("carrier_conditions")
    .select("registry_revision, active").eq("condition_id", conditionId).single();
  expect(error).toBeNull();
  return { revision: Number(data!.registry_revision), active: Boolean(data!.active) };
}

/** A decision through the review door, recorded under the synthetic reviewer identity. */
export async function reviewSynthetic(condition: SyntheticCondition, decision: "activate" | "deactivate", spec: string) {
  const reviewer = syntheticReviewer(spec);
  const { revision } = await conditionState(condition.conditionId);
  const { data, error } = await adminClient().rpc("review_carrier_condition_v1", {
    p_condition_id: condition.conditionId, p_registry_revision: revision, p_decision: decision,
    p_reviewer_name: reviewer.name, p_reviewer_role: reviewer.role, p_review_reference: reviewer.reference,
    p_severity_class: decision === "activate" ? "not_serious" : null,
  });
  expect(error).toBeNull();
  expect(Number(data)).toBeGreaterThan(0);
  expect((await conditionState(condition.conditionId)).active).toBe(decision === "activate");
}

/** Imports the release inactive, withdraws any condition an earlier run left active, and proves the rule holds none of it. */
export async function importSyntheticRelease(releaseId: string, conditions: readonly SyntheticCondition[], spec: string) {
  const imported = await adminClient().rpc("import_clinical_assertion_release_v1", {
    p_payload: syntheticReleasePayload(releaseId, conditions) });
  expect(imported.error).toBeNull();
  expect(imported.data).toMatchObject({ releaseId, conditions: conditions.length,
    assertions: conditions.reduce((sum, condition) => sum + condition.assertions.length, 0) });
  for (const condition of conditions) {
    if ((await conditionState(condition.conditionId)).active) await reviewSynthetic(condition, "deactivate", spec);
  }
}

/** Withdraws every condition still active, through the same door; safe to call in afterAll. */
export async function withdrawSynthetic(conditions: readonly SyntheticCondition[], spec: string) {
  for (const condition of conditions) {
    const state = await conditionState(condition.conditionId).catch(() => null);
    if (state?.active) await reviewSynthetic(condition, "deactivate", spec);
  }
}

/** The genes the rule admits right now, as every carrier surface reads them. */
export async function ruleGenes(): Promise<string[]> {
  const { data, error } = await adminClient().rpc("carrier_assertions_v1");
  expect(error).toBeNull();
  return [...new Set((data as { gene_symbol: string }[]).map((row) => row.gene_symbol))].sort();
}
