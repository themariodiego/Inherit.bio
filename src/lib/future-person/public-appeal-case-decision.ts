import "server-only";
import { z } from "zod";
import { appealCaseScope, openNewAppealForReviewer } from "./appeal-case-envelope";
import { mintPublicFormToken, readPublicFormToken } from "@/lib/embryos/operation-token";
import { sha256Hex } from "./claim-session";
import { sealNewCaseBytes, unwrapNewCaseKey } from "./new-case-envelope-crypto";

const hex = z.string().regex(/^(?:[0-9a-f]{2})+$/u);
const document = z.object({ documentId: z.uuid(), documentKind: z.enum(["appeal-photo-identity", "appeal-subject-source-control",
  "appeal-genetic-parent-authority", "appeal-decision-notice"]), sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  decision: z.enum(["approved", "rejected"]).nullable() }).strict();
const priorDecision = z.object({ decisionId: z.uuid(), sourceCaseId: z.uuid(), decisionRevision: z.number().int().positive().safe(),
  evidenceRevision: z.number().int().positive().safe(), sourceReviewerPrincipalId: z.uuid(),
  decisionReferenceHash: z.string().regex(/^[0-9a-f]{64}$/u),
  requiredAuthorityKind: z.enum(["appeal-subject-source-control", "appeal-genetic-parent-authority"]),
  decisionKind: z.enum(["subject-source-control-review-rejection", "genetic-parent-authority-review-rejection"]),
  sourceDeadline: z.iso.datetime({ offset: true }),
}).strict();
export const appealCaseAllowedDecisions = z.union([z.tuple([z.literal("reject")]), z.tuple([z.literal("reject"), z.literal("uphold")])]);
/** This distinct native context admits incomplete evidence only for case
 * rejection. It does not relax the existing complete documentary decoder. */
export const appealCaseContext = z.object({ contextVersion: z.literal("appeal-case-final-context-v1"), caseId: z.uuid(),
  caseKind: z.enum(["subject-objection", "genetic-parent-objection", "access-or-review-appeal"]),
  reviewRevision: z.number().int().positive().safe(), evidenceRevision: z.number().int().positive().safe(),
  deadline: z.iso.datetime({ offset: true }), scope: appealCaseScope, wrappedCaseKeyHex: hex.length(144),
  workingCiphertextHex: hex, statementCiphertextHex: hex, contactCiphertextHex: hex,
  documents: z.array(document).max(3), documentDecisionsAvailable: z.boolean(), allowedDecisions: appealCaseAllowedDecisions,
  priorDecision: priorDecision.nullable().optional(),
}).strict().superRefine((row, context) => {
  const kinds = row.documents.map(doc => doc.documentKind);
  const permitted = row.caseKind === "subject-objection" ? ["appeal-photo-identity", "appeal-subject-source-control"]
    : row.caseKind === "genetic-parent-objection" ? ["appeal-photo-identity", "appeal-genetic-parent-authority"]
      : ["appeal-photo-identity", "appeal-decision-notice", "appeal-subject-source-control", "appeal-genetic-parent-authority"];
  if (row.caseId !== row.scope.caseId || row.caseKind !== row.scope.intakeKind
    || Date.parse(row.deadline) !== Date.parse(row.scope.originalDeadline)
    || new Set(row.documents.map(doc => doc.documentId)).size !== row.documents.length
    || new Set(kinds).size !== kinds.length || kinds.some(kind => !permitted.includes(kind))
    || kinds.includes("appeal-subject-source-control") && kinds.includes("appeal-genetic-parent-authority")
    || row.documentDecisionsAvailable && (row.documents.length !== (row.caseKind === "access-or-review-appeal" ? 3 : 2))) {
    context.addIssue({ code: "custom", message: "Appeal unavailable" });
  }
  if (row.allowedDecisions.some(decision => decision === "uphold") && (row.caseKind !== "access-or-review-appeal" || !row.priorDecision
    || row.priorDecision.sourceCaseId === row.caseId || !row.documentDecisionsAvailable || row.documents.length !== 3
    || row.documents.some(doc => doc.decision !== "approved")
    || !kinds.includes(row.priorDecision.requiredAuthorityKind)
    || row.priorDecision.decisionKind !== (row.priorDecision.requiredAuthorityKind === "appeal-subject-source-control"
      ? "subject-source-control-review-rejection" : "genetic-parent-authority-review-rejection"))) {
    context.addIssue({ code: "custom", message: "Appeal unavailable" });
  }
});

/** Only after the reviewer's own native current assignment and MFA check. */
export function publicAppealCaseReviewBody(raw: unknown) {
  const parsed = appealCaseContext.safeParse(raw); if (!parsed.success) return null;
  const row = parsed.data;
  const opened = openNewAppealForReviewer(row.scope, { format: "reviewer-only-case-statement-v1",
    wrappedCaseKeyHex: row.wrappedCaseKeyHex, statementCiphertextHex: row.statementCiphertextHex,
    workingCiphertextHex: row.workingCiphertextHex, contactCiphertextHex: row.contactCiphertextHex });
  if (!opened || opened.intake.kind === "contradiction-suspension-appeal") return null;
  const reference = opened.intake.kind === "subject-objection" ? { kind: "subject", value: opened.intake.subjectReference ?? null }
    : opened.intake.kind === "genetic-parent-objection" ? { kind: "cohort", value: opened.intake.cohortReference ?? null }
      : { kind: "decision", value: opened.intake.decisionReference ?? null };
  return { caseId: row.caseId, kind: row.caseKind, submittedAt: row.scope.originalSubmittedAt,
    claimantName: opened.intake.claimantName, contactEmail: opened.recipient, reference, statement: opened.intake.statement,
    targetBinding: { state: "unresolved", kind: "none", safeReference: null, targetRevision: null, principalRevision: null,
      contradictionRevision: null, suspensionRevision: null, nonOverturnedCountRevision: null, counterevidenceRevision: null },
    contradictionOverturnPackage: { state: "not_applicable", allowedGround: "none", originalTriggerProvenanceLocked: false,
      counterevidenceRevision: null },
    evidence: row.documents.map(doc => ({ documentId: doc.documentId, kind: doc.documentKind,
      reviewState: doc.decision ?? "pending", evidenceRevision: row.evidenceRevision })),
    reviewRevision: row.reviewRevision, deadline: row.deadline };
}

/** Server page entry still binds the current case and original deadline. */
export function currentPublicAppealCaseReviewBody(raw: unknown, caseId: string, now = Date.now()) {
  const body = publicAppealCaseReviewBody(raw);
  return body && body.caseId === caseId && Date.parse(body.deadline) > now ? body : null;
}

export const appealCaseDecisionBody = z.object({ decision: z.enum(["reject", "uphold"]), reviewRevision: z.number().int().positive().safe(),
  reason: z.string().max(8000).transform(value => value.normalize("NFC").trim()).refine(value => [...value].length >= 20
    && [...value].length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)),
  nonce: z.string().min(1).max(2048),
}).strict();

type Binding = { caseId: string; accountId: string; sessionId: string; reviewRevision: number; evidenceRevision: number };
const bindingHash = (value: Binding) => sha256Hex(JSON.stringify(["public-appeal-final-review-v1", value.caseId,
  value.accountId, value.sessionId, value.reviewRevision, value.evidenceRevision]));
export function mintAppealCaseReviewNonce(binding: Binding, now = Date.now()) {
  return mintPublicFormToken("appeal-review", now, bindingHash(binding));
}
export function readAppealCaseReviewNonce(token: string, binding: Binding, now = Date.now()) {
  return token.length <= 2048 ? readPublicFormToken(token, "appeal-review", now, bindingHash(binding))?.nonce ?? null : null;
}
export const appealCaseReasonAad = (caseId: string, nonceHash: string) => JSON.stringify(["public-appeal-final-reason-v1", caseId, nonceHash]);
export function sealAppealCaseReason(reason: string, wrapped: string, caseId: string, nonceHash: string) {
  const key = unwrapNewCaseKey(wrapped), bytes = Buffer.from(reason, "utf8"); let sealed: Buffer | undefined;
  try { sealed = sealNewCaseBytes(key, appealCaseReasonAad(caseId, nonceHash), bytes); return `\\x${sealed.toString("hex")}`; }
  finally { key.fill(0); bytes.fill(0); sealed?.fill(0); }
}
