import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Research consent",
  description:
    "Inherit runs no user-data research program and binds any future proposal to specific, separate, reviewed consent.",
};

export default function ResearchConsentPage() {
  return (
    <LegalPage
      eyebrow="Trust"
      title={
        <>
          Research <span className="accent">consent.</span>
        </>
      }
      effectiveDate="2026-09-01"
      intro={
        <p>
          Inherit conducts no research with customer or subject data. This page
          records that promise. It also sets rules for any future proposal.
        </p>
      }
      sections={[
        {
          id: "no-program",
          heading: "No user-data research program",
          body: (
            <>
              <p>
                Inherit runs no study that uses customer or subject data. We do
                not share raw files, variants, reports, chats, or user-derived
                statistics for research. There is no research toggle because
                there is no program to join.
              </p>
              <p>
                Our Research library only summarizes public sources. It does
                not receive user data. A person’s own export and an optional AI
                provider are separate, user-directed choices. Valid legal
                process follows our{" "}
                <Link href="/legal/law-enforcement">
                  law-enforcement policy
                </Link>
                . None of these is research consent.
              </p>
            </>
          ),
        },
        {
          id: "future-program-rules",
          heading: "Rules for any future proposal",
          body: (
            <>
              <p>
                A future research proposal cannot launch unless it meets every
                rule below.
              </p>
              <ul>
                <li>
                  <strong>Separate choice for each use and group.</strong> Each
                  specific purpose and each recipient class needs its own
                  opt-in. One toggle can never approve more than one pair. We
                  do not bundle consent into sign-up or pre-check a box.
                </li>
                <li>
                  <strong>Named recipients and exact data.</strong> Each consent
                  names every recipient, its recipient class, the research
                  purpose, and each data class it would receive. Consent for one
                  item never covers another.
                </li>
                <li>
                  <strong>Published independent review.</strong> An
                  institutional review board, or an equal independent body,
                  must approve the study first. We publish its name, decision,
                  and protocol reference before asking anyone to join.
                </li>
                <li>
                  <strong>No embryo or other-adult data.</strong> An Inherit
                  research program may never use embryo data. It may never use
                  data about another adult that an account holder uploaded.
                  Neither an account holder nor a study may waive this ban.
                </li>
                <li>
                  <strong>Prospective withdrawal.</strong> Withdrawal stops new
                  transfers and any future use that remains under control.
                  Each study must publish, before opt-in, exactly what cannot
                  be recalled after withdrawal. That may include completed
                  analyses or results already made public.
                </li>
                <li>
                  <strong>No model development.</strong> Research consent never
                  permits internal model development or model training. Inherit
                  rules prohibit that use of customer and subject data. This
                  consent page cannot change that rule.
                </li>
                <li>
                  <strong>Complete documents only.</strong> Every consent must
                  contain final, specific text. It may have no blank field,
                  stand-in text, or promise to add details later. An
                  unfinished study is not offered.
                </li>
              </ul>
              <p>
                Declining or withdrawing from research never limits a person’s
                normal use of Inherit.
              </p>
            </>
          ),
        },
        {
          id: "why-this-page-exists",
          heading: "What consent must answer",
          body: (
            <>
              <p>
                A research choice must say what data leaves, why it leaves, who
                receives it, and what withdrawal can still stop. Broad labels
                and hidden defaults do not meet this policy.
              </p>
              <p>
                If we cannot give a complete answer before asking, we do not
                ask.
              </p>
            </>
          ),
        },
        {
          id: "contact",
          heading: "Contact",
          body: (
            <p>
              Send questions to <strong>legal@inherit.bio</strong>. We announce
              a policy change to account holders in advance under the{" "}
              <Link href="/privacy">privacy policy</Link>. A change cannot
              start research or expand a consent already given.
            </p>
          ),
        },
      ]}
    />
  );
}
