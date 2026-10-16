import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { hmacSecret } from "@/lib/crypto";
import {
  correctionField,
  correctionReadBinding,
  correctionReason,
  correctionScope,
  openNewCorrection,
  sealedCorrection,
} from "./correction-case-envelope";

/**
 * The named human correction review (register
 * api.future-person-correction-review). The database decides who may read
 * and decide (20261016210000_future_person_correction_review.sql); this
 * module only parses its closed rows, opens the sealed statement for the
 * response and shapes the two registered bodies. Parsing or decrypting is
 * never authority.
 */

export const CORRECTION_REVIEW_CSRF_HEADER = "x-inherit-csrf";
export const CORRECTION_REVIEW_NONCE_HEADER = "x-inherit-review-nonce";

const revision = z.number().int().positive().safe();
const count = z.number().int().nonnegative().safe();
const clock = z.iso.datetime({ offset: true });

/** responseContracts.future-person-correction-review-case-v1.currentProvenance */
export const correctionProvenance = z.object({
  fieldVersion: revision,
  sourceKind: z.enum(["neutral-display-label", "disposition-event", "identity-profile", "report-result", "imported-variant-source"]),
  sourceReference: z.string().regex(/^[0-9a-f]{64}$/u),
  provenanceRevision: revision,
  affectedResultCount: count,
  analysisStopped: z.boolean(),
}).strict();

const SOURCE_KIND = {
  "display-label": "neutral-display-label",
  "disposition-record": "disposition-event",
  "identity-match-profile": "identity-profile",
  "report-provenance": "report-result",
  "variant-call-source": "imported-variant-source",
} as const;

/** The audited read row. */
export const correctionReviewCase = z.object({
  correctionId: z.uuid(),
  field: correctionField,
  correctionRevision: revision,
  reviewRevision: count,
  deadline: clock,
  scope: correctionScope,
  provenance: correctionProvenance,
  binding: correctionReadBinding,
  envelope: sealedCorrection,
}).strict().superRefine((row, context) => {
  if (row.scope.caseId !== row.correctionId || row.scope.requestedField !== row.field
    || Date.parse(row.scope.originalDeadline) !== Date.parse(row.deadline)
    || row.provenance.sourceKind !== SOURCE_KIND[row.field]) {
    context.addIssue({ code: "custom", message: "Correction unavailable" });
  }
});
export type CorrectionReviewCase = z.infer<typeof correctionReviewCase>;

/** The prose-free decision context. */
export const correctionDecisionContext = z.object({
  correctionId: z.uuid(),
  correctionRevision: revision,
  reviewRevision: count,
  deadline: clock,
  scope: correctionScope,
  binding: correctionReadBinding,
  wrappedCaseKeyHex: z.string().regex(/^[0-9a-f]{144}$/u),
}).strict().refine(row => row.scope.caseId === row.correctionId
  && Date.parse(row.scope.originalDeadline) === Date.parse(row.deadline));
export type CorrectionDecisionContext = z.infer<typeof correctionDecisionContext>;

/** methodRequestContracts.POST.closedBody. Unknown or forbidden fields refuse. */
export const correctionReviewBody = z.object({
  decision: z.enum(["approve", "reject", "needs-more-information"]),
  correctionRevision: revision,
  reason: correctionReason,
  nonce: z.string().min(1).max(2048),
}).strict();

/** The only decisions the database accepts today; approval is refused. */
export const DECIDABLE = ["reject", "needs-more-information"] as const;

export const correctionReviewReceipt = z.object({
  correctionId: z.uuid(),
  state: z.enum(["approved", "rejected", "more_information_required"]),
  reviewRevision: revision,
}).strict();

/** The registered GET body, built only after the database read. */
export function correctionReviewCaseBody(row: CorrectionReviewCase) {
  const statement = openNewCorrection(row.scope, row.envelope);
  if (statement === null) return null;
  return {
    correctionId: row.correctionId,
    field: row.field,
    statement,
    correctionRevision: row.correctionRevision,
    currentProvenance: row.provenance,
  };
}

/** X-Inherit-CSRF for one reviewer, session and correction. */
export function correctionReviewCsrf(correctionId: string, accountId: string, sessionId: string): string {
  return hmacSecret(`${correctionId}|${accountId}|${sessionId}`, "correction-review-csrf-v1");
}
export function correctionReviewCsrfMatches(presented: string | null, correctionId: string, accountId: string, sessionId: string): boolean {
  if (!presented || !/^[0-9a-f]{64}$/u.test(presented)) return false;
  return crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(correctionReviewCsrf(correctionId, accountId, sessionId)));
}

/** The binding's actor must be the caller's own verified account and session. */
export function bindingIsCaller(binding: z.infer<typeof correctionReadBinding>, accountId: string, sessionId: string): boolean {
  return binding.actor.accountId === accountId && binding.actor.sessionId === sessionId;
}

export function nonceHash(nonce: string): string {
  return crypto.createHash("sha256").update(nonce, "utf8").digest("hex");
}
