import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

const report2026 = [
  { metric: "Requests received (all types)", count: 0 },
  { metric: "Requests complied with (in whole or in part)", count: 0 },
  { metric: "User accounts affected", count: 0 },
  { metric: "National Security Letters received", count: 0 },
] as const;

export const metadata: Metadata = {
  title: "Law enforcement & transparency",
  description:
    "How Inherit handles government and law-enforcement requests: valid legal process required, user notice unless barred, minimal-scope responses, and a public transparency report.",
};

export default function LawEnforcementPage() {
  return (
    <LegalPage
      eyebrow="Trust"
      title={
        <>
          Law enforcement &{" "}
          <span className="accent">transparency.</span>
        </>
      }
      effectiveDate="2026-08-28"
      intro={
        <p>
          Genetic databases are attractive to investigators, and the industry
          record on this is mixed. This page states exactly how Inherit
          responds to government and law-enforcement requests, and publishes
          the running count of every request we receive.
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
                  <strong>Valid legal process, always.</strong> We disclose
                  user data only in response to valid, binding legal process —
                  a search warrant, court order, or subpoena of appropriate
                  scope, properly served and jurisdictionally valid. We do not
                  respond to informal requests, and we do not grant any
                  government voluntary or standing access to our systems or
                  data. We do not participate in genetic-genealogy searching
                  for investigators.
                </li>
                <li>
                  <strong>We notify you unless legally barred.</strong> If we
                  receive legal process seeking your data, we will notify you
                  before complying so you can seek to challenge it — unless a
                  court order or statute legally prohibits notice. Where
                  notice is delayed by a gag order, we will notify you as soon
                  as the prohibition lapses.
                </li>
                <li>
                  <strong>Minimal-scope responses.</strong> We challenge
                  overbroad requests and, when compelled to respond, produce
                  the narrowest set of data that satisfies the order — never
                  the whole account when a single field is demanded, and never
                  genome data when account metadata is what was ordered.
                </li>
                <li>
                  <strong>Every request is published.</strong> Each request we
                  receive is counted in the transparency report below, in the
                  most granular form the law allows.
                </li>
              </ul>
              <p>
                Note the structural limits, too: we hold no street addresses,
                no third-party tracking profiles, and no data for deleted
                accounts — deletion is immediate and unrecoverable, as
                described in the <Link href="/privacy">privacy policy</Link> —
                so much of what investigators typically seek simply does not
                exist here.
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
                Covering January 1, 2026 through the effective date above. We
                have received no requests of any kind.
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
                On National Security Letters: the count above reflects the
                most precise reporting United States law permits. As of the
                effective date, Inherit has never received a National
                Security Letter or an order under the Foreign Intelligence
                Surveillance Act.
              </p>
            </>
          ),
        },
        {
          id: "update-cadence",
          heading: "Update cadence",
          body: (
            <p>
              We update this report <strong>every six months</strong> — by
              January 31 and July 31 of each year — and additionally within 30
              days of complying with any request, so a non-zero number never
              waits half a year to appear. Each update states its coverage
              period. Prior periods remain published permanently.
            </p>
          ),
        },
        {
          id: "for-law-enforcement",
          heading: "For law enforcement",
          body: (
            <p>
              Serve valid legal process to{" "}
              <strong>legal@inherit.bio</strong>. Include the requesting
              agency, the responsible officer, the legal authority relied
              upon, and the specific account identifier and data sought.
              Emergency disclosure requests are evaluated under the standard
              of imminent danger of death or serious physical injury, must be
              certified in writing by a supervising officer, and are counted
              in the report above like any other request.
            </p>
          ),
        },
      ]}
    />
  );
}
