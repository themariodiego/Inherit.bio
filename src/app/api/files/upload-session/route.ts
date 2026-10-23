import { withAccountCsrf } from "@/lib/security/session-csrf";
import { issueSubjectUpload } from "@/lib/uploads/subject-upload-issuance";

// The same issuance as api.subject-upload-issue, under this route's own token.
export const POST = withAccountCsrf("api.file-upload-session", issueSubjectUpload);
