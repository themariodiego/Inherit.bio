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
  SUBMITTED_BODY,
  SUBMITTED_HEADING,
} from "@/copy/rights/future-person-claim";
import { CLAIM_FORM_TOKEN_HEADER, CLAIM_SESSION_COOKIE, claimMutationCsrf, sha256Hex } from "@/lib/future-person/claim-session";
import { mintClaimCompleteNonce, mintClaimDocumentNonce } from "@/lib/future-person/evidence-session";
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
 * of the start form, with one-time nonces bound to its claim cookie and the
 * stored mode its completion must name. One whose claim is complete sees
 * that it was received. The only thing read is that status.
 */
type ClaimStatus =
  | { status: "live"; mode: "record-key" | "claimant-recovery-key" | "keyless"; documentNonce: string; completeNonce: string; documentCsrf: string; completeCsrf: string }
  | { status: "completed" }
  | null;

async function claimStatus(): Promise<ClaimStatus> {
  const secret = (await cookies()).get(CLAIM_SESSION_COOKIE)?.value;
  if (!secret) return null;
  const documentNonce = mintClaimDocumentNonce(secret);
  const completeNonce = mintClaimCompleteNonce(secret);
  if (!documentNonce || !completeNonce) return null;
  const { data, error } = await createAdminClient().rpc("claim_session_status_v1", { p_session_hash: sha256Hex(secret) });
  const value = data as { status?: unknown; mode?: unknown } | null;
  if (error || !value) return null;
  if (value.status === "completed") return { status: "completed" };
  if (value.status === "live" && (value.mode === "record-key" || value.mode === "claimant-recovery-key" || value.mode === "keyless")) {
    return { status: "live", mode: value.mode, documentNonce, completeNonce,
      documentCsrf: claimMutationCsrf(sha256Hex(secret), "documents", documentNonce),
      completeCsrf: claimMutationCsrf(sha256Hex(secret), "complete", completeNonce) };
  }
  return null;
}

export default async function FuturePersonClaimPage() {
  const open = futurePersonClaimsOpen();
  const claim = open ? await claimStatus() : null;
  const formToken = open && !claim ? (await headers()).get(CLAIM_FORM_TOKEN_HEADER) : null;
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
      {claim?.status === "completed" ? (
        <section role="status" className="mt-8 space-y-4 rounded-2xl border border-line bg-card p-6">
          <h2 className="font-medium">{SUBMITTED_HEADING}</h2>
          <p className="text-sm leading-relaxed text-ink-muted">{SUBMITTED_BODY}</p>
        </section>
      ) : claim?.status === "live" ? (
        <div className="mt-8 space-y-4">
          <p className="text-sm leading-relaxed text-ink-muted">{KEEP_LINE}</p>
          <ClaimDocuments nonce={claim.documentNonce} completeNonce={claim.completeNonce} mode={claim.mode}
            documentCsrf={claim.documentCsrf} completeCsrf={claim.completeCsrf} />
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
