import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Deceased people",
  description:
    "How Inherit protects genetic records after a death, checks estate authority, and limits deletion or disclosure.",
};

export default function DeceasedPage() {
  return (
    <LegalPage
      eyebrow="Trust"
      title={
        <>
          Deceased <span className="accent">people.</span>
        </>
      }
      effectiveDate="2026-09-01"
      intro={
        <p>
          Genetic data can reveal facts about living relatives. We therefore
          protect a person’s records after death. We disclose them only through
          the process below.
        </p>
      }
      sections={[
        {
          id: "scope",
          heading: "Records this policy covers",
          body: (
            <>
              <p>
                Inherit does not accept a new upload for a person who has died.
                We do not analyze that person’s genome.
              </p>
              <p>This policy covers four types of existing record:</p>
              <ul>
                <li>an account holder’s own data;</li>
                <li>data about another adult who later dies;</li>
                <li>an embryo record after a genetic parent dies; and</li>
                <li>a future-person record.</li>
              </ul>
              <p>
                More than one person may hold rights in a record. We check each
                person’s rights before we act.
              </p>
            </>
          ),
        },
        {
          id: "default",
          heading: "The default is no disclosure",
          body: (
            <>
              <p>
                A death does not open an account or record. It stays closed
                while we review a request. We do not disclose it based only on
                a family link, inheritance claim, or request from an employer
                or insurer.
              </p>
              <p>
                Investigators must use the process in our separate{" "}
                <Link href="/legal/law-enforcement">
                  law-enforcement policy
                </Link>
                . That policy still applies after death.
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
                Email <strong>legal@inherit.bio</strong> with all three items
                below. We charge no fee.
              </p>
              <ol>
                <li>
                  <strong>A death certificate.</strong> Send a clear copy from
                  the civil authority that recorded the death.
                </li>
                <li>
                  <strong>Proof that you may act.</strong> This may be a court’s
                  letters testamentary, letters of administration, or an equal
                  document in your area. A small-estate affidavit may qualify
                  only where local law accepts it.
                </li>
                <li>
                  <strong>Details that identify the record.</strong> Include
                  the account email if you know it. For other records, give the
                  minimum details needed to locate the record.
                </li>
              </ol>
              <p>
                A human reviewer checks the death, the documents, and the
                representative’s authority. We may ask for more proof. We do
                not confirm that a record exists until the first two checks
                pass.
              </p>
            </>
          ),
        },
        {
          id: "wishes-and-notice",
          heading: "Recorded wishes and 30 days’ notice",
          body: (
            <>
              <p>
                The deceased person’s recorded choice comes first. A
                representative cannot replace it. For example, a request to
                delete bars an estate export. A request for no disclosure also
                bars an export.
              </p>
              <p>
                If no choice is on file, an authorized representative may ask
                for deletion or a permitted export. Before any disclosure, we
                give 30 days’ notice through each available contact channel
                tied to the record. No data leaves Inherit during that period.
              </p>
              <p>
                We use the notice period to check for a conflict, a later
                recorded choice, or another person’s rights. A conflict stops
                disclosure and returns the request to human review.
              </p>
            </>
          ),
        },
        {
          id: "living-relatives",
          heading: "Living relatives remain protected",
          body: (
            <>
              <p>
                We never give a representative a genome in a form that shows a
                living relative’s genotype unless that relative consents. We
                remove the protected material. If we cannot separate it safely,
                we refuse the export.
              </p>
              <p>
                Estate authority does not replace the rights of a living adult
                subject or a future person. The{" "}
                <Link href="/legal/future-person">Future Person Charter</Link>
                {" "}continues to govern future-person records.
              </p>
            </>
          ),
        },
        {
          id: "what-we-do",
          heading: "What Inherit will do",
          body: (
            <ul>
              <li>
                <strong>Deletion.</strong> We delete only the records that the
                verified request may control. Account deletion uses its fixed
                seven-day notice and purge process. Rights held by another
                living person may require us to preserve or transfer that
                person’s record instead.
              </li>
              <li>
                <strong>Permitted export.</strong> After the 30-day notice, we
                give the verified representative only the approved parts. The
                export is free. It excludes any record or genotype protected by
                another person’s rights.
              </li>
              <li>
                <strong>No request.</strong> If no representative comes
                forward, the record stays closed. Its normal retention and
                deletion rules still apply.
              </li>
            </ul>
          ),
        },
        {
          id: "planning-ahead",
          heading: "Planning ahead",
          body: (
            <p>
              Record whether you prefer deletion or a permitted estate export.
              Keep that choice with your will or emergency account details. You
              can also export your data for free or request account deletion in{" "}
              <Link href="/settings">Settings</Link> while you are alive.
            </p>
          ),
        },
      ]}
    />
  );
}
