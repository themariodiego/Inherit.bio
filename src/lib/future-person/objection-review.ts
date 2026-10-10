import "server-only";
import { z } from "zod";
import { openNoticePackage } from "./notice-package";
import { claimDataKey, openDocumentBytes } from "./document-envelope";
import { ownerObjectionScope } from "./owner-objection";
import { mintPublicFormToken, readPublicFormToken } from "@/lib/embryos/operation-token";
import { sha256Hex } from "./claim-session";
const rev = z.number().int().positive().safe();
const hex = z.string().regex(/^[0-9a-f]+$/u);
const operationRow = z.object({ operation: z.enum(["claim-objection", "claim-release"]), claimId: z.uuid(),
  reviewRevision: rev, noticeId: z.uuid(), noticeRevision: rev,
  noticeDeadline: z.iso.datetime({ offset: true }), deadline: z.iso.datetime({ offset: true }), documentaryRevision: rev,
  photoDocumentId: z.uuid(), photoSha256: hex.length(64), birthDocumentId: z.uuid(), birthSha256: hex.length(64),
  comparisonCiphertext: hex.min(58).max(32768), wrappedComparisonKey: hex.length(144),
  objection: z.object({ id: z.uuid(), objectionRevision: rev, initialNoticeRevision: rev,
    statementCiphertext: hex.min(96).max(32056), wrappedStatementKey: hex.length(144) }).strict().nullable(),
}).strict().refine(row => row.photoDocumentId !== row.birthDocumentId);
const statement = z.string().refine(value => [...value].length >= 20 && [...value].length <= 4000
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value));
/** Called only after own-JWT current operation assignment authorization.
 * Valid cryptography alone never establishes that authority. */
export function shapeObjectionReview(raw: unknown, expectedObjection: string) {
  const parsed = operationRow.safeParse(raw); if (!parsed.success) return null;
  const row = parsed.data, objection = row.objection;
  if (row.operation !== "claim-objection" || !objection || objection.id !== expectedObjection) return null;
  const minimum = openNoticePackage(row.comparisonCiphertext, row.wrappedComparisonKey, { reviewId: row.claimId,
    documentaryRevision: row.documentaryRevision, photoDocumentId: row.photoDocumentId, photoSha256: row.photoSha256,
    birthDocumentId: row.birthDocumentId, birthSha256: row.birthSha256 });
  if (!minimum) return null;
  let key: Buffer | undefined; let bytes: Buffer | null = null;
  try {
    const scope = ownerObjectionScope.parse({ claimId: row.claimId, noticeId: row.noticeId, noticeRevision: objection.initialNoticeRevision });
    key = claimDataKey(objection.wrappedStatementKey);
    bytes = openDocumentBytes(key, `future-person-owner-objection-v1|${JSON.stringify(scope)}`, Buffer.from(objection.statementCiphertext, "hex"));
    if (!bytes) return null;
    const opened = statement.safeParse(bytes.toString("utf8")); if (!opened.success) return null;
    return { objectionId: objection.id, claimId: row.claimId, statement: opened.data,
      objectionRevision: objection.objectionRevision, claimReviewRevision: row.reviewRevision, noticeRevision: row.noticeRevision,
      noticeRecipientRole: "current-owner-pseudonymous-role" as const, deadline: row.deadline,
      claimant: { fullName: minimum.verifiedName, dateOfBirth: minimum.verifiedDateOfBirth },
      reviewPackage: { photoIdentityDocumentId: row.photoDocumentId, birthRecordDocumentId: row.birthDocumentId,
        documentaryAttestation: { outcome: "positive" as const, reviewRevision: row.documentaryRevision },
        selectedProfile: { childDateOfBirth: minimum.verifiedDateOfBirth, childPlaceOfBirth: minimum.childPlaceOfBirth,
          parentNames: minimum.parentNames } } };
  } catch { return null; } finally { key?.fill(0); bytes?.fill(0); }
}
const nonceBinding = (id: string, account: string, session: string) => sha256Hex(JSON.stringify([id, account, session]));
export function mintObjectionReviewNonce(id: string, account: string, session: string, now = Date.now()) {
  return mintPublicFormToken("future-person-claim-objection-review", now, nonceBinding(id, account, session));
}
export function readObjectionReviewNonce(token: string, id: string, account: string, session: string, now = Date.now()) {
  return token.length <= 2048 ? readPublicFormToken(token, "future-person-claim-objection-review", now, nonceBinding(id, account, session))?.nonce ?? null : null;
}

export const objectionDecisionBody = z.object({ decision: z.enum(["uphold-objection", "overrule-objection", "needs-more-information"]),
  objectionRevision: rev, claimReviewRevision: rev, noticeRevision: rev,
  reason: z.string().max(8000).transform(value => value.normalize("NFC").trim())
    .refine(value => [...value].length >= 20 && [...value].length <= 2000
      && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)),
  nonce: z.string().min(1).max(2048),
}).strict();
export function objectionDecisionScope(raw: unknown, expectedObjection: string) {
  const parsed = operationRow.safeParse(raw);
  if (!parsed.success || parsed.data.operation !== "claim-objection" || parsed.data.objection?.id !== expectedObjection
    || !shapeObjectionReview(parsed.data, expectedObjection)) return null;
  return parsed.data;
}
type DecisionBinding = { objectionRevision: number; claimReviewRevision: number; noticeRevision: number };
function currentDecisionBinding(id: string, account: string, session: string, revisions: DecisionBinding) {
  return sha256Hex(JSON.stringify([id, account, session, revisions.objectionRevision, revisions.claimReviewRevision, revisions.noticeRevision]));
}
export function mintAssignedObjectionNonce(id: string, account: string, session: string, revisions: DecisionBinding, now = Date.now()) {
  return mintPublicFormToken("future-person-claim-objection-review", now, currentDecisionBinding(id, account, session, revisions));
}
export function readAssignedObjectionNonce(token: string, id: string, account: string, session: string,
  revisions: DecisionBinding, now = Date.now()) {
  return token.length <= 2048 ? readPublicFormToken(token, "future-person-claim-objection-review", now,
    currentDecisionBinding(id, account, session, revisions))?.nonce ?? null : null;
}
