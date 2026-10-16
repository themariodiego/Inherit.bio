import { z } from "zod";
import type { DensityStateCase } from "./density-capture-plan";
import { CLAIM_DENSITY_PROTECTED_TABLES } from "./density-claim-states";

export function isClaimReviewDensityState(row: DensityStateCase): boolean {
  return row.route.id === "reviews.future-person-claim" && row.route.path === "/reviews/future-person/claims/[id]"
    && row.route.auth === "reviewer" && row.route.stateProfile === "auth-flow"
    && ["processing", "complete"].includes(row.state);
}
export const CLAIM_REVIEW_DENSITY_NATIVE_SOURCES = Object.freeze([
  "scripts/owned-linux-runtime.ts", "e2e/helpers/claim-review-fixture.ts", "e2e/helpers/density-claim-review-audit.ts",
  "e2e/future-person-review.spec.ts", "e2e/helpers/native-response-observer.ts",
  "src/app/(review)/reviews/future-person/claims/[id]/page.tsx",
  "src/app/api/reviews/future-person/claims/[id]/route.ts", "src/components/future-person/claim-review.tsx",
  "src/lib/future-person/read-review-document.ts", "src/lib/future-person/review-page-contract.ts",
]);
export const CLAIM_REVIEW_DENSITY_TABLES = Object.freeze({ ...CLAIM_DENSITY_PROTECTED_TABLES,
  intakes: "private.future_person_claim_intakes", chunkReceipts: "private.claim_review_chunk_receipts",
  reviewers: "private.claim_reviewers", sessions: "auth.sessions", audit: "public.legal_audit_log" });
const bag = z.object({ count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const scope = z.object({ count: z.literal(1), reviewerMatches: z.literal(true), liveSession: z.literal(true),
  currentAssignment: z.literal(true), reviewState: z.literal("document_review_pending"), reviewRevision: z.literal(1),
  mode: z.literal("keyless"), caseKind: z.literal("keyless_none"), sealed: z.literal(true),
  completedIntake: z.literal(true), cleanDocuments: z.literal(2), decisions: z.literal(0),
  documentReads: z.number().int().nonnegative(), currentDocumentReads: z.literal(true),
}).strict();
export const claimReviewDensityFactsSchema = z.object({
  completeBags: z.object(Object.fromEntries(Object.keys(CLAIM_REVIEW_DENSITY_TABLES).map(name => [name, bag]))).strict(),
  scope,
}).strict();
export type ClaimReviewDensityFacts = z.infer<typeof claimReviewDensityFactsSchema>;
/** Never reinterpret an incomplete read as the complete review page. */
export function checkClaimReviewDensityFacts(value: unknown, state: string): ClaimReviewDensityFacts {
  const facts = claimReviewDensityFactsSchema.parse(value);
  if (!["processing", "complete"].includes(state)
    || facts.scope.documentReads !== (state === "complete" ? 3 : 0))
    throw new Error("Exact original current document delivery state required");
  return facts;
}
