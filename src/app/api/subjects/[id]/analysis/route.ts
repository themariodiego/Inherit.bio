import { answerClaimedSubjectRequest } from "@/lib/subject-endpoints/claimed-subject";
import { withAccountCsrf } from "@/lib/security/session-csrf";

/**
 * `DELETE /api/subjects/[id]/analysis` (register
 * api.claimed-subject-analysis-stop): the bound claimant stops future
 * analysis of their claimed subject. Claimant binding is closed, so the
 * route answers resource-not-found-v1 until the binding release (owner
 * decision 2026-10-22). See src/lib/subject-endpoints/claimed-subject.ts.
 */
export const DELETE = withAccountCsrf("api.claimed-subject-analysis-stop", handleDelete);
async function handleDelete(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return answerClaimedSubjectRequest(request, id);
}
