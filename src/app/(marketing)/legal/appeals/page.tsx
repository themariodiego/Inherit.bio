import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Appeals",
  description:
    "Object to non-consensual or relative-visible processing, or ask a named human to review an Inherit decision.",
};

export default function AppealsPolicyPage() {
  return (
    <LegalPage
      eyebrow="Rights"
      title="Appeals and corrections"
      effectiveDate="2026-09-01"
      intro={
        <p>
          You do not need an Inherit account to object or appeal. Send the
          details listed below to <strong>legal@inherit.bio</strong>. Do not
          send genome data or identity documents by email.
        </p>
      }
      sections={[
        {
          id: "immediate-objections",
          heading: "Immediate objections",
          body: (
            <>
              <p>
                Tell us if a genome uploaded to Inherit is yours and you did
                not consent. A genetic relative may also object to processing
                that other people could see about that relative.
              </p>
              <p>
                After a relative objects, Inherit turns off relative matching,
                pages that others can see about that relative, and
                shared-segment output. This happens for the person’s
                identifiers across every account within 60 seconds. We record
                <code>contradiction.raised</code>. We send written confirmation
                that names exactly what we switched off.
              </p>
            </>
          ),
        },
        {
          id: "other-appeals",
          heading: "Other decisions",
          body: (
            <p>
              You may challenge an identity, authority, access, correction,
              suspension, or future-person claim decision. Include the case
              reference or decision notice if you have one. Explain what you
              think is wrong and the result you seek.
            </p>
          ),
        },
        {
          id: "evidence",
          heading: "How evidence is handled",
          body: (
            <>
              <p>
                Email only your name, contact address, objection or appeal
                type, case reference, and a short explanation. We reply with a
                case-bound way to provide any evidence safely.
              </p>
              <p>
                A public request never grants access, proves ownership, or
                reveals whether a target record exists. Genetic values never
                appear in a public response. Evidence for one case cannot be
                used to decide another case.
              </p>
            </>
          ),
        },
        {
          id: "review",
          heading: "Human review and timing",
          body: (
            <>
              <p>
                A named human reviews every identity or legal decision. An
                automated system cannot approve or reject it. The disputed
                action stays pending until that reviewer records a coded
                decision.
              </p>
              <p>
                We acknowledge a valid request within five business days and
                give a final response within 30 days. Asking for more
                information, changing the reviewer, or retrying a step does not
                restart either clock.
              </p>
            </>
          ),
        },
        {
          id: "result",
          heading: "What the result covers",
          body: (
            <p>
              The written result names the reviewed issue and coded outcome.
              It does not reveal another person’s identity, account, or genetic
              values. A correction or restriction applies only to the exact
              record and authority resolved in that review.
            </p>
          ),
        },
      ]}
    />
  );
}
