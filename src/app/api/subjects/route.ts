import { accountCapability } from "@/lib/legal/jurisdictions";
import { finalizeReviewedDocumentSubject } from "@/lib/uploads/path-b-reviewed-document-server";

/**
 * `POST /api/subjects` (register api.subjects, closed-subject-finalize-v1):
 * the reviewed-document branch of Path B, TEST-LOCAL only. With the exact
 * named-human approved permission document and review, the uploader's own
 * signature and the global contact refusal bar, it asks the person to
 * confirm. An eligible and a barred contact get the same subject-created-v1
 * receipt. The acting uploader's third_party_adult_analysis capability is
 * resolved here, before any transition, and the database rechecks it. See
 * `src/lib/uploads/path-b-reviewed-document-server.ts`.
 */
export async function POST(request: Request) {
  return finalizeReviewedDocumentSubject(request, {
    capability: (accountId) => accountCapability(accountId, "third_party_adult_analysis"),
  });
}
