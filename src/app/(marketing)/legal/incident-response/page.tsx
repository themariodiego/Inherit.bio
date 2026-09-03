import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Incident response",
  description:
    "How Inherit receives security reports, responds to incidents, gives required notice, and publishes incident history.",
};

export default function IncidentResponsePage() {
  return (
    <LegalPage
      eyebrow="Security"
      title={
        <>
          Incident <span className="accent">response.</span>
        </>
      }
      effectiveDate="2026-09-01"
      intro={
        <>
          <p>
            Report a security issue to security@inherit.bio. In the first
            message, include the affected URL and a short account of what you
            found.
          </p>
          <p>
            Do not include genome data, passwords, access keys, or other
            private information. The public security file does not yet name an
            encryption key.
          </p>
        </>
      }
      sections={[
        {
          id: "reporting",
          heading: "Report an issue",
          body: (
            <>
              <p>
                Use the contact in our{" "}
                <Link href="/.well-known/security.txt">security.txt file</Link>.
                Give us a way to reply, steps that reproduce the issue, and the
                smallest safe example. Do not test against another person&rsquo;s
                account or data.
              </p>
              <p>
                We will confirm receipt when the mailbox is working. A missing
                reply is not permission to collect more data, keep access, or
                publish private material.
              </p>
            </>
          ),
        },
        {
          id: "process",
          heading: "Response process",
          body: (
            <ol>
              <li>
                <strong>Start within four hours.</strong> A credible report
                starts an assessment within four hours. We record its scope,
                affected systems, possible subjects, and first known time.
              </li>
              <li>
                <strong>Contain and preserve.</strong> We stop unsafe access,
                rotate exposed credentials, and keep only the evidence needed
                to understand the event. Recovery does not erase the record.
              </li>
              <li>
                <strong>Assess harm.</strong> We identify the data involved,
                likely effects, people at risk, and steps that can reduce harm.
                We document confirmed incidents even when no data loss is
                found.
              </li>
              <li>
                <strong>Recover and review.</strong> We restore safe service,
                check the fix, and record follow-up work. The public history is
                updated when the facts can be stated safely.
              </li>
            </ol>
          ),
        },
        {
          id: "notice",
          heading: "Notice",
          body: (
            <>
              <p>
                Where GDPR Article 33 applies, we notify the proper authority
                without undue delay. Where feasible, notice is sent within 72
                hours after we become aware of the breach. A late notice must
                explain the delay.
              </p>
              <p>
                Where GDPR Article 34 applies because a breach is likely to
                create a high risk, we notify affected people without undue
                delay. The notice uses plain language and explains the event,
                likely effects, contact point, and steps taken.
              </p>
              <p>
                We also notify US state attorneys general on each timeline that
                applies. Other laws may require more notices or shorter clocks;
                those rules still control.
              </p>
            </>
          ),
        },
        {
          id: "people",
          heading: "Who receives notice",
          body: (
            <>
              <p>
                Notice goes to each affected person, not only the account
                holder. This includes another adult whose genome was uploaded
                and a genetic parent whose data forms part of an embryo record.
              </p>
              <p>
                It also includes the subject of a future-person record when a
                direct contact exists. If that person has made a claim, we
                notify the claimant through the current claim contact.
              </p>
            </>
          ),
        },
        {
          id: "history",
          heading: "Incident history",
          body: (
            <>
              <p>
                This history lists every confirmed incident. That includes an
                incident where our review finds no confirmed data loss. Each
                entry gives a date, scope, notice status, and repair summary
                when publication is safe.
              </p>
              <p>
                <time dateTime="2026-09-01">September 1, 2026</time> — No
                incidents to report.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
