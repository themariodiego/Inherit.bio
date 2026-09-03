import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

const purposeBases = [
  { key: "reports.monogenic", purpose: "Single-gene reports" },
  { key: "reports.polygenic", purpose: "Statistical risk reports" },
  { key: "ancestry", purpose: "Ancestry estimates" },
  { key: "copilot.local", purpose: "Copilot on a model you host" },
  { key: "copilot.cloud", purpose: "Copilot on one named cloud model" },
  { key: "family.heritability", purpose: "Family heritability views" },
  { key: "family.portrait", purpose: "Family Portrait" },
  { key: "export.share-link", purpose: "Share-link exports" },
  { key: "raw.export", purpose: "Raw-data exports" },
  { key: "embryo.analysis", purpose: "Embryo Analysis" },
] as const;

export const metadata: Metadata = {
  title: "GDPR status",
  description:
    "Inherit's GDPR purpose table, rights process, and EU and UK launch restrictions.",
};

export default function GdprPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title={
        <>
          GDPR <span className="accent">status.</span>
        </>
      }
      effectiveDate="2026-09-01"
      intro={
        <p>
          Genetic data is special-category data under Article 9. Each purpose
          needs consent under Article 6(1)(a) and explicit consent under
          Article 9(2)(a). Consent is separate, named, and revocable.
        </p>
      }
      sections={[
        {
          id: "availability",
          heading: "EU and UK launch gate",
          body: (
            <>
              <p>
                The hosted service is not offered to people in the EU or UK.
                Family features, embryo storage, and embryo analysis remain off
                there. This is a launch restriction, not a claim of GDPR
                compliance.
              </p>
              <p>
                The controller&rsquo;s legal identity and postal contact have
                not been published. A named data protection officer has not
                been appointed. Neither an EU Article 27 representative nor a
                UK representative has been appointed. Their names, working
                contacts, and postal addresses must appear here before launch.
              </p>
              <p>
                The same gate requires published impact-assessment summaries
                for Family and Embryo Analysis. It also requires a checked map
                of every destination country and the transfer method for each
                destination. Missing facts cannot be replaced with assumed
                names, addresses, or regions.
              </p>
            </>
          ),
        },
        {
          id: "purpose-table",
          heading: "Purpose and legal-basis table",
          body: (
            <>
              <p>
                The table covers every registered <code>purpose_key</code>.
                The two legal bases apply when that purpose handles genetic or
                genome-derived data. A grant for one row does not enable any
                other row.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="py-2.5 pr-4 font-medium text-ink">
                        purpose_key
                      </th>
                      <th className="py-2.5 pr-4 font-medium text-ink">
                        Purpose
                      </th>
                      <th className="py-2.5 pr-4 font-medium text-ink">
                        Consent
                      </th>
                      <th className="py-2.5 font-medium text-ink">
                        Genetic consent
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {purposeBases.map((row) => (
                      <tr key={row.key} className="border-b border-line">
                        <td className="py-2.5 pr-4 font-mono text-xs text-ink">
                          {row.key}
                        </td>
                        <td className="py-2.5 pr-4">{row.purpose}</td>
                        <td className="py-2.5 pr-4">
                          Article 6(1)(a): consent
                        </td>
                        <td className="py-2.5">
                          Article 9(2)(a): explicit consent
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                Withdrawal stops new processing for that purpose. It does not
                undo lawful work completed before withdrawal. The product must
                explain any retention required by law or a live dispute hold.
              </p>
            </>
          ),
        },
        {
          id: "rights",
          heading: "Your rights and response time",
          body: (
            <>
              <p>
                You may request access, correction, deletion, restriction, or
                portability. You may object where that right applies. You may
                also withdraw consent and complain to the authority that
                oversees data protection where you live or work.
              </p>
              <p>
                Use the product&rsquo;s export and deletion controls or email
                privacy@inherit.bio. We must respond without undue delay and
                within one month. A complex request, or several requests, may
                take up to two more months. We must tell you within the first
                month if an extension is needed and explain why.
              </p>
            </>
          ),
        },
        {
          id: "processors-transfers",
          heading: "Processors and transfers",
          body: (
            <>
              <p>
                The hosted application uses Supabase for its database and
                storage. It uses Vercel for application hosting. A cloud model
                receives genome-derived context only after separate consent
                that names one provider and the data classes sent.
              </p>
              <p>
                No EU or UK launch may rely on this summary alone. Before
                launch, this page must name each actual destination country.
                It must also name the transfer method for that destination,
                such as an adequacy decision or approved contract clauses. A
                current transfer review must support each published claim.
              </p>
            </>
          ),
        },
        {
          id: "impact-assessments",
          heading: "Impact assessments",
          body: (
            <p>
              Family and Embryo Analysis need an impact assessment before any
              EU or UK launch. Public summaries must describe the data flow,
              risks, safeguards, remaining risk, reviewer, and review date. No
              such summary is published today, so those features remain
              unavailable in both territories.
            </p>
          ),
        },
      ]}
    />
  );
}
