import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Future Person Charter",
  description:
    "Six enforceable rights for a person whose lifelong record began with an embryo analysis.",
};

export default function FuturePersonPage() {
  return (
    <LegalPage
      eyebrow="Charter"
      title="The Future Person Charter"
      effectiveDate="2026-09-01"
      intro={
        <section data-legal-summary>
          <p data-legal-summary>
            If an embryo record later becomes a record about you, it is yours.
            You can obtain it, correct it, stop analysis, or delete it. Inherit
            will not sell it or use it to rank lives.
          </p>
        </section>
      }
      sections={[
        {
          id: "rights",
          heading: "Your six rights",
          body: (
            <ol>
              <li>
                The record is yours. When you turn 18, you can ask us for
                everything we hold about the embryo you came from. This
                includes every result and the full record of who agreed to
                what. It is free. We give it in a format you can read and one a
                scientist can read. We will not include your parents’ own DNA
                results unless they agree separately. Those results are also
                about them.
              </li>
              <li>You can have it corrected.</li>
              <li>
                You can have it deleted completely, and we will do it within
                30 days. You do not have to give a reason. Nobody, including
                your parents, can stop you. We keep one line saying a deletion
                happened. It has no name or identifier that points back to
                you.
              </li>
              <li>
                You can tell us never to analyse it again and keep the copy you
                have.
              </li>
              <li>
                We will never sell it. We will never share it with an insurer,
                an employer, or a school. We will never send it to an outside
                AI company. We will never hand it to anyone without a court
                order that we first tried to resist. For anyone’s genome but
                your own, Copilot only runs on a model you host yourself.
                Nothing leaves Inherit.
              </li>
              <li>
                We keep the record until you are 20. You can claim it for free
                at <Link href="/future-person/claim">/future-person/claim</Link>{" "}
                any time before then. If no one has claimed it by then, we
                delete it. Keeping a genetic record about someone who never
                asked for it is worse than losing it.
              </li>
            </ol>
          ),
        },
        {
          id: "enforcement",
          heading: "These rights can be enforced",
          body: (
            <>
              <p>
                The person who may be born from the embryo is an intended
                beneficiary of rights one through six. That person may enforce
                these rights.
              </p>
              <p>
                For England and Wales, our upload consent and terms state that
                the Contracts (Rights of Third Parties) Act 1999 applies to
                this promise and is not excluded. Elsewhere, embryo service
                stays off until a lawyer confirms this route works or records
                another way to make the rights effective.
              </p>
            </>
          ),
        },
        {
          id: "scope",
          heading: "What a claim can include",
          body: (
            <p>
              A release can include only the claimed embryo subject’s variant
              calls, results, consent signatures, attestations, legal audit
              slice, and provenance. It cannot include another subject’s
              variant rows. It cannot include a parent’s own DNA results unless
              that parent agrees separately.
            </p>
          ),
        },
        {
          id: "availability",
          heading: "Current availability",
          body: (
            <p>
              Family features, embryo storage, and embryo analysis are off on
              the hosted service. They stay off until a named lawyer records
              the required review for each operating jurisdiction. The review
              must approve this Charter, the upload classes, and a route that
              lets the future person enforce these rights.
            </p>
          ),
        },
      ]}
    />
  );
}
