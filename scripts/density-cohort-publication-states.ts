import type { DensityStateCase } from "./density-capture-plan";
import { z } from "zod";

export const COHORT_PUBLICATION_DENSITY_STATES = Object.freeze({
  "embryos.index": "complete",
  "embryos.upload": "complete",
  "embryos.compare": "complete",
  "embryos.detail": "complete",
});
export function isPublishedCohortDensityState(row: DensityStateCase): boolean {
  return Object.hasOwn(COHORT_PUBLICATION_DENSITY_STATES, row.route.id)
    && row.state === COHORT_PUBLICATION_DENSITY_STATES[row.route.id as keyof typeof COHORT_PUBLICATION_DENSITY_STATES];
}

/** These are dependencies of the actual owned parent/worker journey, rather
 * than a completed-cohort seed. Missing composition provides no fixture. */
export const COHORT_DENSITY_NATIVE_SOURCES = Object.freeze([
  "scripts/ci-embryo-journey.ts",
  "scripts/owned-linux-runtime.ts",
  "scripts/comprehension/participant-c-seed.ts",
  "e2e/participant-c-journey.ts",
  "e2e/helpers/embryo-published-audits.ts",
  "e2e/helpers/embryo-qc-cross-surface.ts",
  "e2e/helpers/claim-review-fixture.ts",
]);

const nativeBag = z.object({ count: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const countBag = (count: number) => nativeBag.refine(bag => bag.count === count, "Exact native row count required");
const presentBag = nativeBag.refine(bag => bag.count > 0, "Actual native authority required");
export const publishedCohortBagSchema = z.object({
  cohort: countBag(1), embryos: countBag(2), subjects: countBag(2), files: countBag(2), qc: countBag(2),
  scores: countBag(0), variants: nativeBag, jobs: countBag(1), sessions: countBag(1), basis: countBag(1),
  participants: presentBag, parentHistory: presentBag, grants: presentBag, attestations: presentBag,
  operationHistory: nativeBag, futurePersonProfiles: countBag(0), principals: presentBag, profiles: presentBag,
  sources: countBag(2), parts: countBag(2), memberships: countBag(2),
}).strict();
