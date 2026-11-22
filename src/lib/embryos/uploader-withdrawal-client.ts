import type { CsrfHandle } from "@/lib/security/session-csrf-client";
import { withdrawalOutcome, type WithdrawalOutcome } from "@/lib/uploads/own-upload-withdrawal-client";

/**
 * The browser half of a non-parent uploader's withdrawal of its permission
 * for an embryo upload (owner decision of 19 November 2026, "A non-parent
 * uploader's withdrawal for an embryo upload stops analysis and deletes, as
 * they signed"): the view a page hands the control and the one request it
 * sends. The server half is `uploader-withdrawal.ts`; the steps are the
 * own-file withdrawal's (`withdrawalStep`), which only the confirmation can
 * advance to a request.
 */

/** Which phase the withdrawal runs in, from the database's read, or why it cannot run. */
export type EmbryoUploaderWithdrawalReadiness = "cohort" | "draft" | "unavailable";

export type EmbryoUploaderWithdrawalView = Readonly<{
  /** The uploader's own consent.upload-embryo signature, the id api.consent-revoke resolves. */
  signatureId: string;
  readiness: EmbryoUploaderWithdrawalReadiness;
  /** The one-time consent_revoke code for this signature; only when the request can run. */
  nonce: string | null;
}>;

/**
 * api.consent-revoke for the uploader's signature: `POST
 * /api/consents/[id]/revoke` with no body, the page's one-time code in
 * `X-Inherit-Operation-Nonce` and the route's session token in
 * `X-Inherit-CSRF`, through the token chain, as every other revocation on it
 * is sent. Only 202 is a withdrawal.
 */
export async function requestEmbryoUploaderWithdrawal(csrf: CsrfHandle, signatureId: string, nonce: string):
  Promise<WithdrawalOutcome> {
  try {
    const response = await csrf.send((csrfToken) => fetch(`/api/consents/${signatureId}/revoke`, {
      method: "POST",
      headers: { "X-Inherit-Operation-Nonce": nonce, "X-Inherit-CSRF": csrfToken },
    }));
    return withdrawalOutcome(response.status);
  } catch {
    return withdrawalOutcome(null);
  }
}
