import { revokeOwnCopilotConsent } from "@/lib/copilot/own-consent";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { isOperationNonceRefusal, personOperationNonceArgs, personOperationNonceFrom } from "@/lib/person-operation-nonce";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { withAccountCsrf } from "@/lib/security/session-csrf";
import { originDenied } from "@/lib/embryos/guards";

/**
 * `POST /api/consents/[id]/revoke` (register api.consent-revoke).
 *
 * The consent kind is resolved from the database, never from the request:
 * the id names either a directional purpose grant or a cloud-model provider
 * grant, and exactly one case must match. A directional revocation runs
 * `revoke_directional_purpose_v1`, which terminalises the base and direction
 * rows together, deletes the exact subject-and-purpose derived rows the
 * recipient held, returns a Portrait pair to pending and enqueues the
 * purpose.derived-60s purge job. Only the account that holds the data
 * subject principal may revoke; every other actor is answered as not found.
 *
 * A directional revocation carries, in the `X-Inherit-Operation-Nonce`
 * header, the one-time nonce the page that offered it rendered for this
 * account, session and grant (G5.6, 23 Oct 2026).
 * `revoke_directional_purpose_with_nonce_v1` records its hash before the
 * revocation runs, in the same transaction, so the revocation's audit events
 * name the person who revoked and a replay writes nothing.
 *
 * Since 24 October 2026 (G8.5, owner decision of 23 October, item 1: the code
 * moves to the register) the other two cases read it too, as the register's
 * `requiredHeader` says of every request: a cloud-model provider grant is
 * revoked by `revoke_cloud_model_consent_with_nonce_v1`, and the own-Copilot
 * permission by `revoke_own_copilot_with_nonce_v1`
 * (`revokeOwnCopilotConsent`), each recording the nonce /settings/consents or
 * /settings/copilot rendered before its unchanged writer runs
 * (20261025200000_consent_revoke_provider_nonce.sql).
 *
 * Since 19 November 2026 (owner decision "A non-parent uploader's withdrawal
 * for an embryo upload stops analysis and deletes, as they signed") the id
 * may also name a non-parent uploader's own consent.upload-embryo signature.
 * Its one-time nonce is the same consent_revoke operation, minted by
 * /embryos or /embryos/upload for this account, session and signature;
 * `withdraw_embryo_uploader_consent_v1` records it and either restricts the
 * finalised cohort under the register's actor case
 * nonparent-required-uploader-basis-loss or deletes the open draft. The
 * answer is lifecycle-accepted-v1; every refusal is the opaque 404.
 */
const NO_STORE = { "Cache-Control": "private, no-store" };
/** `authenticated-api-v1.unauthenticated`. */
const unauthenticated = () => NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
/** `resource-not-found-v1`. */
const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

export const POST = withAccountCsrf("api.consent-revoke", handlePost);
async function handlePost(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthenticated();
  // authenticated-mutation-v1's origin and fetch-metadata check, before any
  // read, as its sibling routes make it (G8.5, 19 November 2026). The CSRF
  // wrapper spends the session token but reads neither header.
  const forbidden = originDenied(request);
  if (forbidden) return forbidden;

  const admin = createAdminClient();
  const [{ data: purposeGrant }, { data: cloudGrant }, { data: signature }] = await Promise.all([
    admin.from("purpose_grants").select("grant_id,target_id,copilot_recipient_revision").eq("grant_id", id).maybeSingle(),
    admin.from("consent_grants").select("id").eq("id", id).maybeSingle(),
    // Since 19 November 2026, one signature-only consent too: a non-parent
    // uploader's own consent.upload-embryo signature (owner decision "A
    // non-parent uploader's withdrawal for an embryo upload stops analysis
    // and deletes, as they signed"). No other signature is resolved here.
    admin.from("consent_signatures").select("id,artifact_key,purpose").eq("id", id).maybeSingle(),
  ]);
  const uploaderSignature = signature && "artifact_key" in signature && signature.artifact_key === "consent.upload-embryo"
    && "purpose" in signature && signature.purpose === "embryo-upload-uploader-class" ? signature : null;
  // One id, one consent kind: an id that names more than one, or none, is
  // refused rather than resolved by order.
  if ([purposeGrant, cloudGrant, uploaderSignature].filter(Boolean).length !== 1) {
    return notFound();
  }

  if (uploaderSignature) {
    const account = await getSensitiveAccountContext();
    if (!account || account.user.id !== user.id) return unauthenticated();
    const nonce = personOperationNonceFrom(request, { accountId: user.id, sessionId: account.sessionId,
      operation: "consent_revoke", targetId: id });
    if (!nonce) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    // The door resolves the phase and the actor case itself: after
    // finalisation the cohort's restriction under
    // nonparent-required-uploader-basis-loss, before it the draft's deletion.
    // Only the signer, as the cohort's own non-parent uploader, can run it.
    const { error } = await admin.rpc("withdraw_embryo_uploader_consent_v1", {
      p_account_id: user.id,
      p_session_id: account.sessionId,
      p_signature_id: id,
      ...personOperationNonceArgs(nonce),
    });
    if (isOperationNonceRefusal(error)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    if (error) {
      // A refusal the caller can cause wrote nothing and is the opaque 404;
      // anything else (the door missing before its migration, an outage)
      // cannot say whether anything committed.
      return error.code === "42501" || error.code === "55000"
        ? notFound()
        : NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
    }
    // The transaction has committed; the purge and the notices it queued
    // complete asynchronously, which is lifecycle-accepted-v1.
    return NextResponse.json({ status: "accepted" }, { status: 202, headers: NO_STORE });
  }

  if (purposeGrant && "copilot_recipient_revision" in purposeGrant && purposeGrant.copilot_recipient_revision != null
    && "target_id" in purposeGrant && typeof purposeGrant.target_id === "string") {
    return revokeOwnCopilotConsent(request, id, purposeGrant.target_id);
  }

  if (purposeGrant) {
    const account = await getSensitiveAccountContext();
    if (!account || account.user.id !== user.id) return unauthenticated();
    const nonce = personOperationNonceFrom(request, { accountId: user.id, sessionId: account.sessionId,
      operation: "consent_revoke", targetId: id });
    if (!nonce) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const { data: revokedAt, error } = await admin.rpc("revoke_directional_purpose_with_nonce_v1", {
      p_account_id: user.id,
      p_session_id: account.sessionId,
      p_grant_id: id,
      ...personOperationNonceArgs(nonce),
    });
    if (isOperationNonceRefusal(error)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    if (error || !revokedAt) return notFound();
    return NextResponse.json(
      { revoked: true, effectiveAt: new Date(revokedAt).toISOString() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const account = await getSensitiveAccountContext();
  if (!account || account.user.id !== user.id) return unauthenticated();
  const nonce = personOperationNonceFrom(request, { accountId: user.id, sessionId: account.sessionId,
    operation: "consent_revoke", targetId: id });
  if (!nonce) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { data: revoked, error } = await admin.rpc("revoke_cloud_model_consent_with_nonce_v1", {
    p_account_id: user.id,
    p_session_id: account.sessionId,
    p_grant_id: id,
    ...personOperationNonceArgs(nonce),
  });
  if (isOperationNonceRefusal(error)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  if (error) return NextResponse.json({ error: "consent_unavailable" }, { status: 503 });
  if (!revoked) return notFound();
  return NextResponse.json({ revoked: true });
}
