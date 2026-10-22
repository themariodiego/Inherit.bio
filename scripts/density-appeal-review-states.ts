import { z } from "zod";
import type { DensityStateCase } from "./density-capture-plan";
import { CLAIM_DENSITY_PROTECTED_TABLES } from "./density-claim-states";

export function isAppealReviewProcessingDensityState(row: DensityStateCase): boolean {
  return row.route.id === "reviews.appeal" && row.route.path === "/reviews/appeals/[id]"
    && row.route.auth === "reviewer" && row.route.stateProfile === "auth-flow" && row.state === "processing";
}

/** Complete means the original fully loaded assigned page, not release or a
 * seeded closed case. The original native refusal still settles afterward. */
export function isAppealReviewCompleteDensityState(row: DensityStateCase): boolean {
  return row.route.id === "reviews.appeal" && row.route.path === "/reviews/appeals/[id]"
    && row.route.auth === "reviewer" && row.route.stateProfile === "auth-flow" && row.state === "complete";
}
export const APPEAL_REVIEW_DENSITY_NATIVE_SOURCES = Object.freeze([
  "scripts/owned-linux-runtime.ts", "e2e/helpers/claim-review-fixture.ts", "e2e/helpers/public-appeal-review-audit.ts",
  "src/app/(review)/reviews/appeals/[id]/page.tsx", "src/app/api/reviews/appeals/[id]/route.ts",
  "src/components/future-person/public-appeal-review.tsx", "src/components/future-person/public-appeal-case-rejection.tsx",
]);
export const APPEAL_REVIEW_DENSITY_TABLES = Object.freeze({
  ...CLAIM_DENSITY_PROTECTED_TABLES,
  appealConfig: "private.new_public_appeal_config", appealNonces: "private.new_public_appeal_nonces",
  appealReviewers: "private.new_public_appeal_reviewers", appealIntakes: "private.new_public_appeal_intakes",
  appeals: "public.appeal_intakes", evidenceState: "private.new_public_appeal_evidence_state",
  pendingReviews: "private.public_appeal_pending_reviews", provisionalTargets: "private.public_appeal_provisional_targets",
  reviewDownloads: "private.public_appeal_review_downloads", reviewChunks: "private.public_appeal_review_chunks",
  documentDecisions: "private.public_appeal_document_decisions", caseDecisions: "private.public_appeal_case_decisions",
  decisionNotices: "private.public_appeal_decision_notices", rightsSessions: "public.rights_sessions",
  mail: "public.mail_outbox", legalAudit: "public.legal_audit_log", reviewerSessions: "auth.sessions",
});
const bag = z.object({ count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const appealReviewDensityFactsSchema = z.object({
  completeBags: z.object(Object.fromEntries(Object.keys(APPEAL_REVIEW_DENSITY_TABLES).map(name => [name, bag]))).strict(),
  scope: z.object({ count: z.literal(1), reviewerMatches: z.literal(true), liveSession: z.literal(true),
    committed: z.literal(true), sealed: z.literal(true) }).strict(),
}).strict();
export type AppealReviewDensityFacts = z.infer<typeof appealReviewDensityFactsSchema>;
