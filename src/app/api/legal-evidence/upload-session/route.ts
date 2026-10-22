import { openLegalEvidenceUploadSession } from "@/lib/uploads/path-b-reviewed-document-server";

/**
 * `POST /api/legal-evidence/upload-session` (register
 * api.legal-evidence-upload-session): an evidence-ingest-session-v1 session
 * for one adult-signed permission document of the caller's own
 * reviewed-document draft, TEST-LOCAL only. The bytes then cross
 * api.evidence-chunk and api.evidence-complete. The two embryo-basis document
 * kinds have no built target and answer as an unknown resource.
 */
export async function POST(request: Request) {
  return openLegalEvidenceUploadSession(request);
}
