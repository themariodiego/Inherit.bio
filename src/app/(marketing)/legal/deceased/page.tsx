import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Deceased customers",
  description:
    "The documented next-of-kin process for a deceased Sequence customer's account: what a representative must provide, and what Sequence will do within 30 days.",
};

export default function DeceasedPage() {
  return (
    <LegalPage
      eyebrow="Trust"
      title={
        <>
          Deceased <span className="accent">customers.</span>
        </>
      }
      effectiveDate="2026-08-28"
      intro={
        <p>
          A genome outlives its owner, and it carries information about
          relatives who never agreed to share it. This page documents exactly
          how Sequence handles the account of a customer who has died — a
          process families should not have to discover mid-grief.
        </p>
      }
      sections={[
        {
          id: "default",
          heading: "The default: non-disclosure",
          body: (
            <>
              <p>
                Unless and until a verified representative completes the
                process below, a deceased customer’s account and data are
                treated exactly as they were in life:{" "}
                <strong>closed to everyone</strong>. We do not disclose
                account contents to family members, heirs, employers,
                insurers, or anyone else on request, sympathy, or assertion of
                kinship alone. Legal process from investigators is handled
                under our separate{" "}
                <Link href="/legal/law-enforcement">
                  law-enforcement policy
                </Link>
                , which applies unchanged after death.
              </p>
            </>
          ),
        },
        {
          id: "what-to-provide",
          heading: "What a representative must provide",
          body: (
            <>
              <p>
                We act only for an authorized representative of the estate.
                To start, email <strong>legal@sequence-dna.org</strong> with
                all three of the following:
              </p>
              <ol>
                <li>
                  <strong>A death certificate</strong> — a certified copy or a
                  clear scan of one, issued by the relevant civil authority.
                </li>
                <li>
                  <strong>Proof of authority to act for the estate</strong> —
                  letters testamentary or letters of administration naming you
                  as executor or administrator, a court order, or the
                  equivalent instrument in your jurisdiction. Where the estate
                  is small enough that no such instrument exists, a
                  small-estate affidavit valid in the deceased’s jurisdiction
                  is acceptable.
                </li>
                <li>
                  <strong>The email address of the account</strong> — so we
                  can locate it. If you do not know it, we can attempt to
                  locate an account from the deceased’s known email addresses,
                  but we will not confirm whether an account exists until the
                  first two documents are verified.
                </li>
              </ol>
              <p>
                We may ask follow-up questions to verify the documents. We do
                not charge a fee for any part of this process.
              </p>
            </>
          ),
        },
        {
          id: "what-we-do",
          heading: "What Sequence will do",
          body: (
            <>
              <p>
                Once the documentation is verified, the representative chooses
                one of two actions, and we complete it{" "}
                <strong>within 30 days</strong> of verification:
              </p>
              <ul>
                <li>
                  <strong>Deletion.</strong> The account and all of its data —
                  database rows and storage objects, including the raw genome
                  files — are deleted under the same immediate, unrecoverable
                  process described in the{" "}
                  <Link href="/privacy">privacy policy</Link>. This is the
                  default if the representative expresses no preference.
                </li>
                <li>
                  <strong>Export to the estate.</strong> A complete export of
                  the account — original uploaded files, derived variants,
                  reports, and chat history — is delivered to the verified
                  representative, free of charge, after which the account is
                  deleted. We deliver the export to the representative only;
                  distributing it further is the estate’s decision and
                  responsibility.
                </li>
              </ul>
              <p>
                We do not keep deceased customers’ genomes as a matter of
                course, and we do not use them for any purpose while a request
                is pending. If no representative ever comes forward, the
                account simply remains closed and untouched, subject to the
                retention and deletion rules of the privacy policy.
              </p>
            </>
          ),
        },
        {
          id: "planning-ahead",
          heading: "Planning ahead",
          body: (
            <p>
              The simplest gift to your estate is a note. If you use Sequence,
              consider recording the account email address and your preference
              — delete or export — wherever you keep your will or password
              manager’s emergency access. You can also simply export your data
              at any time (free, forever) and store it with your papers, or
              delete your account yourself if you no longer want the data to
              exist at all.
            </p>
          ),
        },
      ]}
    />
  );
}
