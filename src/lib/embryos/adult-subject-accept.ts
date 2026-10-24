import "server-only";
import type { SensitiveAccountContext } from "@/lib/account-deletion";
import { contactDigestSet } from "@/lib/hmac-keyring";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  adultSubjectAcceptanceBlockedBy,
  adultSubjectAcceptBody,
  adultSubjectAcceptMatchesOffer,
  readAdultSubjectOffer,
} from "./adult-subject-review";
import { notFound } from "./api";
import { closedResponse, encryptedLiteral } from "./guards";
import { verifyEmbryoOperation } from "./operation-token";
import { normalizeContact } from "./routes";

/**
 * Accepting a Path A invitation through the person's own account
 * (`POST /api/invitations/accept`, the adult-subject body; register
 * adult-subject-confirmation-v1 path-a-account-required, whose route is
 * api.invitation-accept). The owner decided on 23 October 2026 that this
 * acceptance includes the person's typed name, stored encrypted the way
 * Path B's e-signature stores it, and that the confirmation moves here from
 * api.withdraw.
 *
 * The account is authority, so it and the offer this rights session was
 * opened for are read before any field is judged. The body is then held to
 * the offer: the served presentation, the five published statement keys in
 * order, and a name of at least two tokens of two characters. The name is
 * trimmed and encrypted (`encryptedLiteral`, as Path B does) before it
 * leaves this function, so the database, the logs and the response never
 * see it as text; the response never carries it. Every fault, of any kind,
 * is the register's opaque 404 with no database write
 * (requestContract.unknownMissingInvalidStaleOrKindMismatch).
 */

const ACCEPTED_KEYS = [
  "invitationKind", "status", "subjectId", "subjectAccountBound", "accountOrigin", "activationBlock",
] as const;

export async function acceptAdultSubjectInvitation(
  request: Request,
  context: SensitiveAccountContext,
  sessionHash: string,
  json: unknown,
): Promise<Response> {
  const email = context.user.email;
  if (!email || !context.user.email_confirmed_at) return notFound();
  const offer = await readAdultSubjectOffer(request);
  if (!offer || offer.sessionHash !== sessionHash || adultSubjectAcceptanceBlockedBy(context, offer) !== null) {
    return notFound();
  }
  const parsed = adultSubjectAcceptBody.safeParse(json);
  if (!parsed.success) return notFound();
  const body = parsed.data;
  // The one-time nonce the review rendered for this account, its auth
  // session and this rights session (the co-parent body's own rule).
  const claims = verifyEmbryoOperation(body.nonce, {
    accountId: context.user.id,
    sessionId: context.sessionId,
    operation: "invitation_accept",
    targetKind: "rights_session",
    targetId: sessionHash,
  });
  if (!claims || !adultSubjectAcceptMatchesOffer(body, offer)) return notFound();

  const { data, error } = await createAdminClient().rpc("accept_adult_subject_invitation_v1", {
    p_session_hash: sessionHash,
    p_nonce: claims.nonce,
    p_account_id: context.user.id,
    p_auth_session_id: context.sessionId,
    // Keyed under every held contact revision; the database compares the one
    // the invitation was written under with the invited address again.
    p_account_email_hmac_set: contactDigestSet(normalizeContact(email)),
    p_signing_name_ciphertext: encryptedLiteral(body.subjectArtifact.typedName.trim()),
  });
  if (error || data !== offer.subjectId) return notFound();

  // invitation-accepted-v1, the adult body. The register keeps the 72-hour
  // hold for an account a server-owned binding proves was created from this
  // invitation; no such binding exists yet, so no account is proven created
  // from it and every acceptance answers the existing-account body, whose
  // block is the exact purpose grant the person has not made.
  return closedResponse(
    "api.invitation-accept",
    ACCEPTED_KEYS,
    {
      invitationKind: "adult_subject",
      status: "accepted",
      subjectId: data,
      subjectAccountBound: true,
      accountOrigin: "existing_account",
      activationBlock: "pending_exact_purpose",
    },
    200,
  );
}
