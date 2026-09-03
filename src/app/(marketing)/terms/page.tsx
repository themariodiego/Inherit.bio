import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Terms of service",
  description:
    "The Inherit terms of service: 18+, informational not medical, you own your data, free export forever, real deletion, AGPL-3.0, and Delaware governing law.",
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Trust"
      title={
        <>
          Terms of <span className="accent">service.</span>
        </>
      }
      effectiveDate="2026-08-28"
      intro={
        <p>
          These terms govern your use of the hosted Inherit service. They are
          deliberately short and written in plain language; where they make
          commitments to you — free export, real deletion — those commitments
          are contractual, not marketing. If you self-host Inherit under its
          open-source license, these terms do not apply to your own
          installation.
        </p>
      }
      sections={[
        {
          id: "eligibility",
          heading: "1. Who can use Inherit",
          body: (
            <>
              <p>
                You must be <strong>at least 18 years old</strong> to create an
                account. You may upload only genome data that is your own — not
                a child’s, not a relative’s, not anyone else’s, even with their
                permission. By creating an account you confirm both of these
                things. If we learn an account belongs to a minor or holds
                another person’s genome, we will delete the data as described
                in our <Link href="/privacy">privacy policy</Link>.
              </p>
            </>
          ),
        },
        {
          id: "not-medical",
          heading: "2. Informational, not medical",
          body: (
            <>
              <p>
                Inherit provides <strong>informational and educational</strong>{" "}
                content about your genome. It is{" "}
                <strong>not a medical device</strong>, does not provide medical
                advice, and does not diagnose, treat, cure, or prevent any
                disease or condition. Reports describe published associations
                with stated evidence levels; they are not clinical results and
                have not been reviewed by a physician or validated in a
                clinical laboratory.
              </p>
              <p>
                Do not make medical decisions — starting, stopping, or changing
                any treatment, medication, or screening — based on Inherit
                alone. Consult a physician, pharmacist, or licensed genetic
                counselor, who can order clinical-grade confirmation of any
                variant that matters for your care.
              </p>
            </>
          ),
        },
        {
          id: "your-data",
          heading: "3. Your data is yours",
          body: (
            <>
              <p>
                <strong>You own your data.</strong> Your uploaded files and
                everything derived from them (variants, reports, scores, chat
                history) belong to you. Inherit claims no ownership interest
                in any of it, ever.
              </p>
              <p>
                So that we can operate the service, you grant Inherit only a{" "}
                <strong>limited, revocable processing license</strong>. That
                license is the right to store, parse, and analyze your data
                solely to provide the features you use, on your instructions.
                This license exists only to serve you. It does not permit us to
                sell, license, share, or use your data for research,
                advertising, or model training. It ends when you delete the
                data or your account.
              </p>
            </>
          ),
        },
        {
          id: "export-deletion",
          heading: "4. Export and deletion are contractual",
          body: (
            <>
              <p>We are contractually bound to both of the following:</p>
              <ul>
                <li>
                  <strong>Free export, forever.</strong> You may export your
                  uploaded files and all derived data at any time, in open
                  formats, at no charge. We will never impose a data-transfer,
                  egress, or export fee.
                </li>
                <li>
                  <strong>Real deletion.</strong> When you delete a file or
                  your account, we delete the database rows and the storage
                  objects immediately. There is no grace-period recovery and no
                  restoration from backups. The process is detailed in the{" "}
                  <Link href="/privacy">privacy policy</Link>.
                </li>
              </ul>
              <p>
                These clauses survive any change of control of Inherit. They
                bind any successor for data collected under these terms.
              </p>
            </>
          ),
        },
        {
          id: "open-source",
          heading: "5. Open source (AGPL-3.0)",
          body: (
            <>
              <p>
                The Inherit software is licensed under the GNU Affero General
                Public License, version 3.0, and its source code is available
                at{" "}
                <a
                  href="https://github.com/themariodiego/sequence"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  github.com/themariodiego/sequence
                </a>
                . These terms govern your use of our hosted service; your
                rights to the software itself — to run, study, modify, and
                self-host it — come from the AGPL-3.0 and are not limited by
                anything here.
              </p>
            </>
          ),
        },
        {
          id: "acceptable-use",
          heading: "6. Acceptable use",
          body: (
            <>
              <p>
                Don’t upload data that isn’t yours, don’t attempt to breach or
                probe other users’ data, don’t use the service to violate any
                law, and don’t resell access to the hosted service. That’s the
                whole list.
              </p>
            </>
          ),
        },
        {
          id: "no-warranty",
          heading: "7. No warranty",
          body: (
            <>
              <p>
                The service is provided <strong>“as is”</strong> and{" "}
                <strong>“as available”</strong>, without warranty of any kind,
                express or implied. That exclusion includes the implied
                warranties of merchantability, fitness for a particular
                purpose, accuracy, and non-infringement. Genomic interpretation
                is probabilistic. It evolves as research evolves. We do not
                warrant that any report is complete, current, or correct for
                you. Coverage of your particular file may be partial. Some
                jurisdictions do not allow certain warranty exclusions, so
                parts of this section may not apply to you.
              </p>
            </>
          ),
        },
        {
          id: "liability",
          heading: "8. Limitation of liability",
          body: (
            <>
              <p>
                To the maximum extent permitted by law, Inherit and its
                contributors will not be liable for indirect, incidental,
                special, consequential, or punitive damages arising from your
                use of the service. Nor will they be liable for lost profits or
                data arising from your use of the service. Our total aggregate
                liability for all claims relating to the service is capped. The
                cap is the greater of one hundred US dollars (US$100) or the
                amount you paid us for the service in the twelve months before
                the claim arose. Nothing in this section limits liability that
                cannot be limited by law. That includes liability for willful
                misconduct.
              </p>
            </>
          ),
        },
        {
          id: "termination",
          heading: "9. Termination means deletion",
          body: (
            <>
              <p>
                You can close your account at any time from{" "}
                <Link href="/settings">Settings</Link>. We may terminate an
                account that violates section 6, with notice explaining why
                and — except where legally prohibited — a window to export
                first.
              </p>
              <p>
                Either way, <strong>termination equals deletion</strong>. When
                an account closes, all of its data — rows and storage objects —
                is deleted. That deletion uses the same immediate, unrecoverable
                process as a user-initiated deletion. We do not retain
                “residual copies” of closed accounts.
              </p>
            </>
          ),
        },
        {
          id: "governing-law",
          heading: "10. Governing law",
          body: (
            <>
              <p>
                These terms are governed by the laws of the{" "}
                <strong>State of Delaware, United States of America</strong>,
                without regard to its conflict-of-laws rules. Any dispute that
                cannot be resolved informally will be brought in the state or
                federal courts located in Delaware. Both parties consent to the
                jurisdiction of those courts. If you are a consumer in a
                jurisdiction whose law grants you non-waivable protections or a
                home-court right, those protections remain yours.
              </p>
            </>
          ),
        },
        {
          id: "changes-contact",
          heading: "11. Changes and contact",
          body: (
            <>
              <p>
                If we materially change these terms, we will email account
                holders. That email will go out at least 30 days before the
                change takes effect. The protective commitments in sections 3
                and 4 will never be weakened for existing data without your
                affirmative consent. Continuing to use the service after the
                effective date of other changes constitutes acceptance.
              </p>
              <p>
                Questions about these terms:{" "}
                <strong>legal@inherit.bio</strong>.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
