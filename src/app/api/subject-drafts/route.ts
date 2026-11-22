import { NextResponse } from "next/server";
import { z } from "zod";
import { encryptSecret, hmacSecret } from "@/lib/crypto";
import { adultInvitationNote, sealAdultInvitationNote } from "@/lib/adult-invitation-note";
import { contactDigestSet, legacyContactDigest } from "@/lib/hmac-keyring";
import { invitationQuotaKeys } from "@/lib/rate-limit-keys";
import { accountCapability } from "@/lib/legal/jurisdictions";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { isOperationNonceRefusal, personOperationNonceArgs, personOperationNonceFrom } from "@/lib/person-operation-nonce";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isPathBDraftPayload, isPathBReviewedDocumentDraftPayload } from "@/lib/uploads/other-adult-upload";
import { createPathBReviewedDocumentDraft } from "@/lib/uploads/path-b-reviewed-document-server";
import { createPathBDraft } from "@/lib/uploads/path-b-routes";
import { admitAccountCsrf } from "@/lib/security/session-csrf";
import { unauthenticated } from "@/lib/embryos/guards";

/**
 * The register's Path A body (closed-subject-draft-create-v1, owner decision
 * of 23 October 2026, G8.5): `{ kind: "adult", adultFlow:
 * "path-a-own-account", contactEmail, requestId, note? }`. It replaced the
 * route's own `{ kind: "other_adult", email, adultAttestation, ... }`; the
 * form still asks the inviter to confirm the person is an adult, and the
 * browser requires that box before it sends anything, but the registered
 * body carries no field for it, so nothing about it is sent or stored. The
 * request id is the one the route has always used so a retried click
 * reserves one invitation.
 */
const requestSchema = z.object({
  kind: z.literal("adult"),
  adultFlow: z.literal("path-a-own-account"),
  contactEmail: z.string().trim().pipe(z.email().max(254)),
  requestId: z.uuid(),
  // The optional note the invited person reads in the invitation mail
  // (brief §5 §5.2). Plain text only: no control characters, so the mail
  // template can render it as words and never as a link. The worker holds
  // the opened note to the same rule (src/lib/adult-invitation-note.ts).
  note: adultInvitationNote.optional(),
}).strict();

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

export async function POST(request: Request) {
  // Every body carries the page's one-time X-Inherit-CSRF token for the
  // account session, spent before the body is read (G8.5). Each body's own
  // one-time nonce travels in X-Inherit-Operation-Nonce and is checked by the
  // code that answers it: Path A's below, and since 19 November 2026 the two
  // Path B bodies' draft nonce too, which was sent in X-Inherit-CSRF.
  const csrf = await admitAccountCsrf(request, "api.subject-drafts");
  if (csrf.kind === "refused") return csrf.response;
  const response = await draftBody(request);
  return csrf.kind === "admitted" ? csrf.rotate(response) : response;
}

async function draftBody(request: Request): Promise<Response> {
  const payload: unknown = await request.json().catch(() => null);
  // The register's Path B body ("I have their file"): a draft with the
  // person's name, date of birth and address, TEST-LOCAL only
  // (`src/lib/uploads/path-b-routes.ts`). Path A below is unchanged.
  if (isPathBDraftPayload(payload)) return createPathBDraft(request, payload);
  // The register's third body, path-b-reviewed-document (owner decision
  // 2026-10-16): the same person fields, evidence a named human reviews.
  if (isPathBReviewedDocumentDraftPayload(payload)) return createPathBReviewedDocumentDraft(request, payload);
  return pathAInvitation(request, payload);
}

async function pathAInvitation(request: Request, payload: unknown): Promise<Response> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return unauthenticated();

  // The inviter's own declared jurisdiction, read now rather than when the
  // form loaded (G5.1a, G5.1b). Without the acceptance flag every account
  // resolves unreviewed, as before. The refusal is the register's
  // capability-denied-api-v1 (403, with the row's own words), as the Path B
  // bodies answer it; it was a 409 until 23 October 2026.
  const decision = await accountCapability(user.id, "third_party_adult_analysis");
  if (decision.status !== "permitted") {
    return NextResponse.json({ error: "jurisdiction_unavailable", message: decision.userFacingCopy }, { status: 403 });
  }

  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const email = normalizedEmail(parsed.data.contactEmail);
  if (email === normalizedEmail(user.email)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  // The one-time nonce /family/invite rendered for this account and session
  // (G5.6, 23 Oct 2026). The database records its hash before the invitation
  // is reserved, in the same transaction, so the invitation's audit events
  // name the person who invited and a replay reserves nothing.
  const account = await getSensitiveAccountContext();
  if (!account || account.user.id !== user.id) return unauthenticated();
  const nonce = personOperationNonceFrom(request, { accountId: user.id, sessionId: account.sessionId,
    operation: "adult_invitation_create", targetId: user.id });
  if (!nonce) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  // The revision-1 digest keeps the idempotency key stable across a rotation.
  const idempotencyKey = hmacSecret(
    JSON.stringify([
      "adult-subject-invitation-v1",
      user.id,
      legacyContactDigest(email),
      parsed.data.requestId,
    ]),
    "mail-idempotency-v1",
  );
  // D-139: the note is sealed here, for the invitation this key creates, and
  // only its envelope leaves this process. The database writes the envelope
  // onto the invitation's queued mail in the transaction that creates both,
  // so no worker can claim that mail without it, and a replay of the key
  // keeps the first note. It travels only in the mail payload: never in the
  // opaque invitation token, a link, the response or a log.
  const noteEnvelope = parsed.data.note === undefined
    ? undefined
    : sealAdultInvitationNote(parsed.data.note, idempotencyKey);
  const admin = createAdminClient();
  // The address is keyed under every held contact revision, and the RPC
  // counts this attempt against the account and network quotas before it
  // matches anything (global-contact-refusal-bar-v1). An exhausted quota
  // returns no invitation, exactly as a barred address does.
  const { error } = await admin.rpc("create_adult_subject_invitation_with_nonce_v1", {
    p_account_id: user.id,
    p_session_id: account.sessionId,
    p_contact_ciphertext: `\\x${encryptSecret(email).toString("hex")}`,
    p_contact_hmac: null,
    p_contact_hmac_set: contactDigestSet(email),
    p_quota_keys: invitationQuotaKeys(user.id, request.headers),
    p_idempotency_key: idempotencyKey,
    p_test_jurisdiction: true,
    ...personOperationNonceArgs(nonce),
    // Sent only with a note. A database without the parameter (before
    // 20261119134500) has no function that takes it, so the call fails and
    // writes nothing, rather than an invitation going out without its note.
    ...(noteEnvelope === undefined ? {} : { p_note_envelope: noteEnvelope }),
  });
  if (isOperationNonceRefusal(error)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  if (error) {
    return NextResponse.json({ error: "invitation_unavailable" }, { status: 503 });
  }

  return NextResponse.json({ accepted: true }, { status: 202 });
}
