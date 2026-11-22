import { finalizeSubjectUploadV2 } from "@/lib/uploads/subject-finalization";
import { withAccountCsrf } from "@/lib/security/session-csrf";

export const maxDuration = 300;

export const POST = withAccountCsrf("api.subject-upload-complete", handlePost);
async function handlePost(request: Request, context: { params: Promise<{ id: string }> }) {
  return finalizeSubjectUploadV2(request, (await context.params).id);
}
