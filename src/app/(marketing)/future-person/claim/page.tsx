import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { ClaimDocuments } from "@/components/future-person/claim-documents";
import { FuturePersonClaimForm } from "@/components/future-person/claim-form";
import {
  CLAIM_EYEBROW,
  CLAIM_H1,
  CLOSED_BODY,
  CLOSED_HEADING,
  CONTACT_LINE,
  FUTURE_PERSON_CLAIM_COPY,
  KEEP_LINE,
} from "@/copy/rights/future-person-claim";
import { CLAIM_FORM_TOKEN_HEADER, CLAIM_SESSION_COOKIE, sha256Hex } from "@/lib/future-person/claim-session";
import { mintClaimDocumentNonce } from "@/lib/future-person/evidence-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";

export const metadata: Metadata = { title: "Claim a future-person record" };

/**
 * `/future-person/claim` (register rights.future-person-claim). Public, no
 * account, never jurisdiction-blocked.
 *
 * The refusal standard and the keyless no-profile boundary render first, on
 * the server, before any form control and in every state (policy
 * .preFormContent, .ordering). The page reads nothing about any record,
 * profile or earlier claim: its only input is the form token the proxy
 * minted for this request.
 *
 * Where no embryo record can exist on this deployment, the page says claims
 * are not open and offers no form at all, so it collects nothing.
 *
 * A browser that already holds a live claim sees the documents step instead
 * of the start form, with a one-time nonce bound to its claim cookie. The
 * only thing read is whether that claim is live.
 */
async function liveClaimNonce(): Promise<string | null> {
  const secret = (await cookies()).get(CLAIM_SESSION_COOKIE)?.value;
  if (!secret) return null;
  const nonce = mintClaimDocumentNonce(secret);
  if (!nonce) return null;
  const { data, error } = await createAdminClient().rpc("claim_session_live_v1", { p_session_hash: sha256Hex(secret) });
  return !error && data === true ? nonce : null;
}

export default async function FuturePersonClaimPage() {
  const open = futurePersonClaimsOpen();
  const documentNonce = open ? await liveClaimNonce() : null;
  const formToken = open && !documentNonce ? (await headers()).get(CLAIM_FORM_TOKEN_HEADER) : null;
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <p className="eyebrow">{CLAIM_EYEBROW}</p>
      <h1 className="display mt-4 text-4xl">{CLAIM_H1}</h1>
      <section aria-labelledby="refusal-standard" className="mt-8 space-y-4 rounded-2xl border border-line bg-card p-6">
        <h2 id="refusal-standard" className="font-medium">
          {FUTURE_PERSON_CLAIM_COPY["future-person.claim.refusal-standard-heading"]}
        </h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          {FUTURE_PERSON_CLAIM_COPY["future-person.claim.refusal-standard-body"]}
        </p>
        <p className="text-sm leading-relaxed text-ink-muted">
          {FUTURE_PERSON_CLAIM_COPY["future-person.claim.no-profile-condition"]}
        </p>
        <p className="text-sm leading-relaxed text-ink-muted">
          {FUTURE_PERSON_CLAIM_COPY["future-person.claim.no-profile-no-guess"]}
        </p>
      </section>
      {documentNonce ? (
        <div className="mt-8 space-y-4">
          <p className="text-sm leading-relaxed text-ink-muted">{KEEP_LINE}</p>
          <ClaimDocuments nonce={documentNonce} />
        </div>
      ) : open && formToken ? (
        <div className="mt-8 space-y-4">
          <p className="text-sm leading-relaxed text-ink-muted">{KEEP_LINE}</p>
          <FuturePersonClaimForm formToken={formToken} />
        </div>
      ) : (
        <section className="mt-8 space-y-4 rounded-2xl border border-line bg-card p-6">
          <h2 className="font-medium">{CLOSED_HEADING}</h2>
          <p className="text-sm leading-relaxed text-ink-muted">{CLOSED_BODY}</p>
        </section>
      )}
      <p className="mt-8 text-sm leading-relaxed text-ink-muted">{CONTACT_LINE}</p>
    </div>
  );
}
