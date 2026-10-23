import { withAccountCsrf } from "@/lib/security/session-csrf";
import { finalizeSubjectUploadV2 } from "@/lib/uploads/subject-finalization";

export const maxDuration = 300;

// The same finalization as api.subject-upload-complete, under this route's own token.
export const POST = withAccountCsrf("api.file-finalize",
  async (request: Request, context: { params: Promise<{ id: string }> }) =>
    finalizeSubjectUploadV2(request, (await context.params).id));
