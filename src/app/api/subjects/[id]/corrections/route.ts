import { answerClaimedSubjectRequest } from "@/lib/subject-endpoints/claimed-subject";
import { withAccountCsrf } from "@/lib/security/session-csrf";

/**
 * `POST /api/subjects/[id]/corrections` (register
 * api.claimed-subject-correction): the bound claimant asks for a correction
 * on their claimed subject. Claimant binding is closed, so the route answers
 * resource-not-found-v1 until the binding release, before any body is read
 * (owner decision 2026-10-22). See
 * src/lib/subject-endpoints/claimed-subject.ts.
 */
export const POST = withAccountCsrf("api.claimed-subject-correction", handlePost);
async function handlePost(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return answerClaimedSubjectRequest(request, id);
}
