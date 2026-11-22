import { withAccountCsrf } from "@/lib/security/session-csrf";
import { openLegalEvidenceUploadSession } from "@/lib/uploads/path-b-reviewed-document-server";

/**
 * `POST /api/legal-evidence/upload-session` (register
 * api.legal-evidence-upload-session): an evidence-ingest-session-v1 session
 * for one adult-signed permission document of the caller's own
 * reviewed-document draft, TEST-LOCAL only. The bytes then cross
 * api.evidence-chunk and api.evidence-complete. The two embryo-basis document
 * kinds have no built target and answer as an unknown resource.
 *
 * The shell's one-time X-Inherit-CSRF token for the account session is
 * verified and spent before this runs, and the answer carries its successor
 * there (G8.5). The card's operation token travels in
 * X-Inherit-Operation-Nonce, and the evidence session's value in the answer's
 * X-Inherit-Evidence-CSRF.
 */
export const POST = withAccountCsrf("api.legal-evidence-upload-session", handlePost);
async function handlePost(request: Request) {
  return openLegalEvidenceUploadSession(request);
}
