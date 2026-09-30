import type { Metadata } from "next";
import { headers } from "next/headers";
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
import { CLAIM_FORM_TOKEN_HEADER } from "@/lib/future-person/claim-session";
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
 */
export default async function FuturePersonClaimPage() {
  const open = futurePersonClaimsOpen();
  const formToken = open ? (await headers()).get(CLAIM_FORM_TOKEN_HEADER) : null;
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
      {open && formToken ? (
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
