import { withAccountCsrf } from "@/lib/security/session-csrf";
import { issueSubjectUpload } from "@/lib/uploads/subject-upload-issuance";

export const POST = withAccountCsrf("api.subject-upload-issue", issueSubjectUpload);
