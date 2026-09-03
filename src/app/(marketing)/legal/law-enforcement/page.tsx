import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

const report2026 = [
  { metric: "Requests received — all jurisdictions", count: 0 },
  { metric: "Requests resisted — all jurisdictions", count: 0 },
  { metric: "Requests complied with — all jurisdictions", count: 0 },
  { metric: "Accounts affected — all jurisdictions", count: 0 },
] as const;

const claimReport2026 = [
  { metric: "Future-person claims received", count: 0 },
  { metric: "Future-person claims approved", count: 0 },
  { metric: "Future-person claims refused", count: 0 },
] as const;

export const metadata: Metadata = {
  title: "Law enforcement & transparency",
  description:
    "How Inherit resists demands for genetic data, requires judicial process, gives notice, and reports request counts.",
};

export default function LawEnforcementPage() {
  return (
    <LegalPage
      eyebrow="Trust"
      title={
        <>
          Law enforcement & <span className="accent">transparency.</span>
        </>
      }
      effectiveDate="2026-09-01"
      intro={
        <p>
          Genetic records can draw government interest. This page states the
          process we require before any disclosure. It also publishes every
          count that the law lets us report.
        </p>
      }
      sections={[
        {
          id: "policy",
          heading: "Our policy",
          body: (
            <>
              <ul>
                <li>
                  <strong>We resist before disclosure.</strong> We first
                  challenge any demand for genetic data. We disclose it only
                  when valid legal process compels us after that challenge. We
                  reject informal requests and never give standing access.
                </li>
                <li>
                  <strong>Content needs a judicial order.</strong> We require a
                  search warrant or an equal judicial order for genome files,
                  derived results, chat, or other stored content. A subpoena
                  alone is not enough. We resist subpoenas for genetic data.
                </li>
                <li>
                  <strong>We give notice.</strong> We notify each affected
                  person before we comply, unless the law bars notice. We send
                  notice as soon as that bar ends. This gives the person time
                  to seek a challenge.
                </li>
                <li>
                  <strong>We limit the response.</strong> We challenge requests
                  that are too broad. If we must respond, we give only the data
                  named in the order. A request for account details does not
                  open a genome.
                </li>
                <li>
                  <strong>No forensic matching.</strong> We never upload data
                  to a law-enforcement or forensic genealogy database. We do
                  not let either kind of database match against Inherit data.
                </li>
              </ul>
              <p>
                These rules also cover records about another adult subject and
                future-person records. Account ownership does not lower the
                standard. Notice follows the rights and contact rules for the
                person whose data is involved.
              </p>
              <p>
                We hold no street address or third-party tracking profile. Once
                a purge finishes, its covered rows and storage objects are
                gone. A record may remain if another person has a separate
                right to it. See our <Link href="/privacy">privacy policy</Link>
                .
              </p>
            </>
          ),
        },
        {
          id: "transparency-report",
          heading: "Transparency report — 2026",
          body: (
            <>
              <p>
                This annual report covers January 1, 2026 through the effective
                date above. We received no government or law-enforcement
                request during that period. When a reportable request arrives,
                we add a row for its requesting jurisdiction.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="py-2.5 pr-4 font-medium text-ink">
                        Metric
                      </th>
                      <th className="py-2.5 text-right font-medium text-ink">
                        2026
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report2026.map((row) => (
                      <tr key={row.metric} className="border-b border-line">
                        <td className="py-2.5 pr-4">{row.metric}</td>
                        <td className="py-2.5 text-right font-mono text-ink">
                          {row.count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                We report national-security demands only in the form and after
                the delay that law allows. We do not use a warrant canary. Any
                permitted count will appear in the next report.
              </p>
            </>
          ),
        },
        {
          id: "future-person-claims",
          heading: "Future-person claim volume — 2026",
          body: (
            <>
              <p>
                These are rights claims, not law-enforcement requests. We
                publish their volume here each year.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="py-2.5 pr-4 font-medium text-ink">
                        Metric
                      </th>
                      <th className="py-2.5 text-right font-medium text-ink">
                        2026
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {claimReport2026.map((row) => (
                      <tr key={row.metric} className="border-b border-line">
                        <td className="py-2.5 pr-4">{row.metric}</td>
                        <td className="py-2.5 text-right font-mono text-ink">
                          {row.count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ),
        },
        {
          id: "update-cadence",
          heading: "Update cadence",
          body: (
            <p>
              We update this annual report twice each year, by January 31 and
              July 31. We also update it within 30 days after we comply with
              any reportable request. National-security reporting waits for any
              required delay. Prior reports remain public.
            </p>
          ),
        },
        {
          id: "for-law-enforcement",
          heading: "For law enforcement",
          body: (
            <p>
              Serve valid legal process to <strong>legal@inherit.bio</strong>.
              Name the agency, responsible officer, legal authority, account,
              and exact data sought. The process must be valid in the serving
              jurisdiction. Calling a request an emergency does not waive these
              rules.
            </p>
          ),
        },
      ]}
    />
  );
}
