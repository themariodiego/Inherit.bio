import "server-only";
import { z } from "zod";
import { correctionScope, correctionStatement, sealedCorrection, openNewCorrection } from "./correction-case-envelope";
import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
const revision = z.number().int().positive().safe(), hash = z.string().regex(/^[0-9a-f]{64}$/u);
export function requesterStatementsOpen(env: Readonly<Record<string, string | undefined>> = process.env) {
  return isTestJurisdictionEnabled(env) && env.INHERIT_TEST_REQUESTER_STATEMENTS === "1";
}
export const requesterStatementBinding = z.object({ rightsSessionId: z.uuid(), principalId: z.uuid(), subjectId: z.uuid(),
  authorityRevision: revision, tokenHashId: z.uuid(), principalRevision: revision,
  lifecycleRevision: revision, bindingRevision: revision, sourceReceipt: hash, caseHash: hash }).strict();
export const nativeRequesterStatement = z.object({ scope: correctionScope,
  binding: requesterStatementBinding, envelope: sealedCorrection }).strict();
export const ownStatementDownload = z.object({ correctionId: z.uuid(), statement: correctionStatement }).strict();
/** Native current requester proof is checked again BEFORE this unwrap and
 * AFTER closed serialization. This parser/crypto function grants no authority. */
export function openRequesterCorrectionStatement(raw: unknown, expectedId: string) {
  const parsed = nativeRequesterStatement.safeParse(raw);
  if (!parsed.success || parsed.data.scope.caseId !== expectedId
    || parsed.data.scope.originalAuthorPrincipalId !== parsed.data.binding.principalId
    || parsed.data.scope.originalSubjectId !== parsed.data.binding.subjectId) return null;
  const statement = openNewCorrection(parsed.data.scope, parsed.data.envelope);
  return statement === null ? null : ownStatementDownload.parse({ correctionId: expectedId, statement });
}
