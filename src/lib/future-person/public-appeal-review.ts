import "server-only";
import { z } from "zod";
import { appealCaseScope, openNewAppealForReviewer } from "./appeal-case-envelope";
import crypto from "node:crypto";
import { unwrapNewCaseKey, sealNewCaseBytes, openNewCaseBytes } from "./new-case-envelope-crypto";
const hex = z.string().regex(/^(?:[0-9a-f]{2})+$/u);
export const appealReviewRow = z.object({ caseId: z.uuid(), caseKind: z.enum(["subject-objection", "genetic-parent-objection", "access-or-review-appeal"]),
 reviewRevision: z.number().int().positive().safe(), evidenceRevision: z.number().int().positive().safe(), deadline: z.iso.datetime({ offset: true }),
 scope: appealCaseScope, wrappedCaseKeyHex: hex.length(144), workingCiphertextHex: hex, statementCiphertextHex: hex, contactCiphertextHex: hex,
 documents: z.array(z.object({ documentId: z.uuid(), documentKind: z.enum(["appeal-photo-identity", "appeal-subject-source-control", "appeal-genetic-parent-authority", "appeal-decision-notice"]),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u), decision: z.enum(["approved", "rejected"]).nullable() }).strict()).min(2).max(3),
}).strict().superRefine((row, context) => {
 const kinds=row.documents.map(doc=>doc.documentKind).sort();
 const fixed=row.caseKind==="subject-objection"?["appeal-photo-identity","appeal-subject-source-control"]
  :row.caseKind==="genetic-parent-objection"?["appeal-genetic-parent-authority","appeal-photo-identity"]:null;
 if ((fixed && JSON.stringify(kinds)!==JSON.stringify(fixed)) || (!fixed && (kinds.length!==3 || !kinds.includes("appeal-photo-identity") || !kinds.includes("appeal-decision-notice")
  || !(kinds.includes("appeal-subject-source-control")!==kinds.includes("appeal-genetic-parent-authority")))))context.addIssue({code:"custom",message:"Appeal unavailable"});
 if (row.caseId !== row.scope.caseId || row.caseKind !== row.scope.intakeKind || Date.parse(row.deadline) !== Date.parse(row.scope.originalDeadline)
  || new Set(row.documents.map(doc => doc.documentId)).size !== row.documents.length
  || new Set(row.documents.map(doc => doc.documentKind)).size !== row.documents.length)
  context.addIssue({ code: "custom", message: "Appeal unavailable" });
});
/** Only call after the named reviewer's own native authorization. Never use
 * parsing or successful decryption as account, contact or target authority. */
export function publicAppealReviewBody(raw: unknown) {
 const parsed = appealReviewRow.safeParse(raw); if (!parsed.success) return null;
 const row = parsed.data; const opened = openNewAppealForReviewer(row.scope, { format: "reviewer-only-case-statement-v1",
  wrappedCaseKeyHex: row.wrappedCaseKeyHex, statementCiphertextHex: row.statementCiphertextHex,
  workingCiphertextHex: row.workingCiphertextHex, contactCiphertextHex: row.contactCiphertextHex });
 if (!opened || opened.intake.kind === "contradiction-suspension-appeal") return null;
 const reference = opened.intake.kind === "subject-objection" ? { kind: "subject", value: opened.intake.subjectReference ?? null }
  : opened.intake.kind === "genetic-parent-objection" ? { kind: "cohort", value: opened.intake.cohortReference ?? null }
   : { kind: "decision", value: opened.intake.decisionReference ?? null };
 return { caseId: row.caseId, kind: row.caseKind, submittedAt: row.scope.originalSubmittedAt, claimantName: opened.intake.claimantName,
  contactEmail: opened.recipient, reference, statement: opened.intake.statement,
  // A provisional hold is not a finalized human target determination.
  targetBinding: { state: "unresolved", kind: "none", safeReference: null, targetRevision: null, principalRevision: null,
   contradictionRevision: null, suspensionRevision: null, nonOverturnedCountRevision: null, counterevidenceRevision: null },
  contradictionOverturnPackage: { state: "not_applicable", allowedGround: "none", originalTriggerProvenanceLocked: false, counterevidenceRevision: null },
  evidence: row.documents.map(doc => ({ documentId: doc.documentId, kind: doc.documentKind, reviewState: doc.decision ?? "pending", evidenceRevision: row.evidenceRevision })),
  reviewRevision: row.reviewRevision, deadline: row.deadline };
}
export const appealDocumentDecisionBody = z.object({ decision: z.enum(["approved", "rejected"]), documentSha256: z.string().regex(/^[0-9a-f]{64}$/u),
 reviewRevision: z.number().int().positive().safe(), nonce: z.string().min(1).max(2048),
 reason: z.string().max(8000).transform(value => value.normalize("NFC").trim()).refine(value => [...value].length >= 20 && [...value].length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)),
}).strict();
export function sealAppealReviewReason(reason: string, wrapped: string, caseId: string, documentId: string, nonceHash: string) {
 const key = unwrapNewCaseKey(wrapped); const bytes = Buffer.from(reason, "utf8"); let sealed: Buffer | undefined;
 try { sealed = sealNewCaseBytes(key, JSON.stringify(["public-appeal-document-reason-v1", caseId, documentId, nonceHash]), bytes); return `\\x${sealed.toString("hex")}`; }
 finally { key.fill(0); bytes.fill(0); sealed?.fill(0); }
}

const referenceAad = (caseId: string, documentId: string, nonceHash: string) => JSON.stringify(["public-appeal-decision-reference-v1", caseId, documentId, nonceHash]);
export function sealAppealDecisionReference(wrapped: string, caseId: string, documentId: string, nonceHash: string) {
 const key = unwrapNewCaseKey(wrapped); const random = crypto.randomBytes(24); const bytes = Buffer.alloc(48); let sealed: Buffer | undefined;
 const digits="0123456789abcdef"; for(let i=0;i<random.length;i++){bytes[i*2]=digits.charCodeAt(random[i]!>>>4);bytes[i*2+1]=digits.charCodeAt(random[i]!&15);}
 try { sealed = sealNewCaseBytes(key, referenceAad(caseId, documentId, nonceHash), bytes);
  return { hash: crypto.createHash("sha256").update(bytes).digest("hex"), ciphertext: `\\x${sealed.toString("hex")}` };
 } finally { key.fill(0); random.fill(0); bytes.fill(0); sealed?.fill(0); }
}
const noticeRow = z.object({ scope: appealCaseScope, wrappedCaseKeyHex: hex.length(144), decisions: z.array(z.object({
 documentId: z.uuid(), documentKind: z.enum(["appeal-photo-identity", "appeal-subject-source-control", "appeal-genetic-parent-authority", "appeal-decision-notice"]),
 decision: z.enum(["approved", "rejected"]), nonceHash: z.string().regex(/^[0-9a-f]{64}$/u),
 referenceCiphertextHex: hex.length(152), referenceHash: z.string().regex(/^[0-9a-f]{64}$/u),
 }).strict()).max(30) }).strict();
/** Only after the native original verified case-session or separate notice-purpose read. No reviewer
 * notes, contact match or target metadata enter the requester notice. */
export function openAppealDecisionNotice(raw: unknown) {
 const parsed = noticeRow.safeParse(raw); if (!parsed.success) return null;
 let key: Buffer | undefined;
 try { key = unwrapNewCaseKey(parsed.data.wrappedCaseKeyHex);
  const decisions = parsed.data.decisions.map(row => {
   const sealed = Buffer.from(row.referenceCiphertextHex, "hex"); let plain: Buffer | null = null;
   try { plain = openNewCaseBytes(key!, referenceAad(parsed.data.scope.caseId, row.documentId, row.nonceHash), sealed);
    if (!plain || plain.length !== 48 || !/^[0-9a-f]{48}$/u.test(plain.toString("ascii"))
     || crypto.createHash("sha256").update(plain).digest("hex") !== row.referenceHash) throw new Error("unavailable");
    return { documentKind: row.documentKind, decision: row.decision,
     decisionReference: row.decision === "rejected" && ["appeal-subject-source-control", "appeal-genetic-parent-authority"].includes(row.documentKind) ? plain.toString("ascii") : null };
   } finally { plain?.fill(0); sealed.fill(0); }
  });
  return { deadline: parsed.data.scope.originalDeadline, decisions };
 } catch { return null; } finally { key?.fill(0); }
}
