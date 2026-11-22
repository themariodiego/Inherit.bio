import { withAccountCsrf } from "@/lib/security/session-csrf";
import { issueSubjectUpload } from "@/lib/uploads/subject-upload-issuance";

// policy.sameOriginRequired: the proxy and the CSRF wrapper refuse a request
// without `Sec-Fetch-Site: same-origin`, or from another Origin, before any
// resolver runs or the account is read (`@/lib/security/same-origin`).
export const POST = withAccountCsrf("api.subject-upload-issue", issueSubjectUpload);
