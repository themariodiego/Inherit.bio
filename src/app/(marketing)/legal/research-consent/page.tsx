import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Research consent",
  description:
    "Inherit runs no research program and shares nothing by default. This page says so explicitly, and binds any future program to per-study opt-in, named data classes, and revocability.",
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
      effectiveDate="2026-08-28"
      intro={
        <p>
          Most genomics companies publish a research-consent page to get your
          data into a research pipeline. We publish one to tell you, in
          writing, that no such pipeline exists here.
        </p>
      }
      sections={[
        {
          id: "no-program",
          heading: "Inherit does not run a research program",
          body: (
            <>
              <p>
                As of the effective date above, Inherit operates{" "}
                <strong>no research program of any kind</strong>. We do not
                share your genetic data, your derived variants, your reports,
                or any aggregate statistics computed from them with academic
                researchers, pharmaceutical companies, biotech partners, or
                anyone else. There is no “research participation” toggle in
                the product because there is no research participation to
                toggle.
              </p>
              <p>
                <strong>The default is, and will remain, zero sharing.</strong>{" "}
                You do not need to opt out of anything: there is nothing to
                opt out of. The only way any of your data ever leaves our
                infrastructure today is the single user-initiated LLM-chat
                exception described in the{" "}
                <Link href="/privacy">privacy policy</Link>, and disclosures
                compelled by valid legal process under our{" "}
                <Link href="/legal/law-enforcement">
                  law-enforcement policy
                </Link>
                .
              </p>
            </>
          ),
        },
        {
          id: "future-program-rules",
          heading: "Rules that bind any future program",
          body: (
            <>
              <p>
                If Inherit ever proposes a research program in the future, we
                bind ourselves now to the following minimums. A program that
                does not meet every one of them will not launch:
              </p>
              <ul>
                <li>
                  <strong>Separate opt-in, per study.</strong> Consent will be
                  requested for each specific study individually. There will
                  be no blanket “future research” consent, no consent bundled
                  into sign-up or the terms of service, and no pre-checked
                  boxes. Declining will never affect your use of Inherit.
                </li>
                <li>
                  <strong>Named data classes.</strong> Each consent request
                  will state exactly which classes of data the study would
                  receive — for example “genotypes at the 12 listed variants”
                  or “ancestry composition summary” — before you decide.
                  Consent to one class is never consent to another.
                </li>
                <li>
                  <strong>Named recipients and purpose.</strong> Each request
                  will identify who receives the data and for what stated
                  research question.
                </li>
                <li>
                  <strong>Revocable at any time.</strong> You will be able to
                  withdraw from any study in Settings; withdrawal stops all
                  future use and sharing of your data for that study
                  immediately.
                </li>
                <li>
                  <strong>Complete documents only.</strong> Every consent form
                  will be finished, specific text — reviewed before
                  publication so that no unfilled template fields, bracketed
                  stand-in text, or “details to follow” language ever reaches
                  a user. If a blank cannot be filled in honestly, the study
                  is not ready to be offered.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "why-this-page-exists",
          heading: "Why this page exists",
          body: (
            <>
              <p>
                The consumer-genomics industry has a documented history of
                consent documents that promise specificity and deliver
                boilerplate: research consents that were pushed during
                onboarding, defaulted subtly toward yes, described data use in
                open-ended categories, and — in publicly reported cases —
                shipped with template fields still unfilled where the specific
                data types and recipients should have been named. Regulators
                and journalists have flagged these patterns repeatedly. We
                mention them not to disparage any particular company but
                because they are the failure mode this page is designed to
                make impossible here.
              </p>
              <p>
                A consent that does not tell you exactly what is shared, with
                whom, and how to take it back is not consent. Inherit will
                either meet that bar or not ask.
              </p>
            </>
          ),
        },
        {
          id: "contact",
          heading: "Contact",
          body: (
            <p>
              Questions about this policy: <strong>legal@inherit.bio</strong>.
              This page is informational and is part of our binding privacy
              commitments; if it ever changes, the change will be announced to
              account holders in advance, as described in the{" "}
              <Link href="/privacy">privacy policy</Link>.
            </p>
          ),
        },
      ]}
    />
  );
}
