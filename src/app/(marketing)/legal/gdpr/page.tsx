import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { GDPR_LAUNCH, euLaunchOpen, ukLaunchOpen, type GdprContact } from "@/lib/legal/gdpr-launch";

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

/** One published contact: name, postal address and email, as appointed. */
function contactLine(role: string, contact: GdprContact): string {
  return `${role} is ${contact.name}, ${contact.postalAddress}, ${contact.email}.`;
}

export default function GdprPage() {
  const { euRepresentative, ukRepresentative, dataProtectionOfficer } = GDPR_LAUNCH;
  const euOpen = euLaunchOpen();
  const ukOpen = ukLaunchOpen();
  return (
    <LegalPage
      eyebrow="Privacy"
      title={
        <>
          GDPR <span className="accent">status.</span>
        </>
      }
      effectiveDate="2026-09-26"
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
              {euOpen && ukOpen ? (
                <p>
                  The hosted service is offered to people in the EU, the rest
                  of the EEA, and the UK. Family features, embryo storage, and
                  embryo analysis remain off there.
                </p>
              ) : (
                <p>
                  The hosted service is not offered to people in the{" "}
                  {euOpen ? "UK" : ukOpen ? "EU or the rest of the EEA" : "EU or UK"}.
                  {euOpen || ukOpen ? "" : " The same holds for the rest of the EEA."}{" "}
                  Nobody can newly choose one of these countries as where they
                  live. Accounts that chose one before 26 September 2026 keep
                  their own results. Family features, embryo storage, and
                  embryo analysis remain off there. This is a launch
                  restriction, not a claim of GDPR compliance.
                </p>
              )}
              <p>
                The controller is Mario Diego, an individual, reached at
                privacy@inherit.bio. A postal contact has not been published.{" "}
                {dataProtectionOfficer
                  ? contactLine("The data protection officer", dataProtectionOfficer)
                  : "A named data protection officer has not been appointed."}{" "}
                {euRepresentative
                  ? contactLine("The EU Article 27 representative", euRepresentative)
                  : null}{" "}
                {ukRepresentative
                  ? contactLine("The UK representative", ukRepresentative)
                  : null}{" "}
                {!euRepresentative && !ukRepresentative
                  ? "Neither an EU Article 27 representative nor a UK representative has been appointed."
                  : !euRepresentative
                    ? "An EU Article 27 representative has not been appointed."
                    : !ukRepresentative
                      ? "A UK representative has not been appointed."
                      : null}{" "}
                {euOpen && ukOpen
                  ? null
                  : "Their names, working contacts, and postal addresses must appear here before launch."}
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
              {/* The table is wider than a phone, so this container scrolls.
                  A scrolling container that nothing can focus is unreachable
                  by keyboard: axe `scrollable-region-focusable`, found at
                  320x568 and 390x844 once the audit gained the viewports the
                  brief pins. Focusable and named by its own section heading. */}
              <div
                className="overflow-x-auto"
                role="region"
                aria-labelledby="purpose-table-heading"
                tabIndex={0}
              >
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
              <p>
                Processing outside these purposes has its own legal basis.
                Running your account and sending its service email rests on
                our contract with you, under Article 6(1)(b). The research
                digest email rests on your consent, under Article 6(1)(a).
                Keeping proof of your consents rests on a legal duty, under
                Article 6(1)(c). Security logs, the adult age check, and
                refusing connections from places under a full United States
                embargo rest on legitimate interests, under Article 6(1)(f).
                You may object to those.
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
                Every processor is in the United States. A cloud model
                receives genome-derived context only after separate consent
                that names one provider and the data classes sent.
              </p>
              <ul>
                <li>
                  <strong>Supabase</strong> holds the database and files in
                  the United States. It uses standard contractual clauses.
                </li>
                <li>
                  <strong>Vercel</strong> hosts the app in the United States.
                  It is certified under the Data Privacy Framework, with the
                  UK extension.
                </li>
                <li>
                  <strong>Resend</strong> sends email from the United States.
                  It is listed under the Data Privacy Framework, with the UK
                  extension. Its terms also include standard contractual
                  clauses.
                </li>
                <li>
                  <strong>The cloud model you name</strong> is in the United
                  States for the Anthropic, OpenAI and xAI presets. Its
                  transfer method is not yet settled.
                </li>
              </ul>
              <p>
                This list names each actual destination country and its
                transfer method. A current transfer review must support each
                published claim. That review is drafted but not yet approved,
                so no EU or UK launch may rely on this list yet.
              </p>
            </>
          ),
        },
        {
          id: "impact-assessments",
          heading: "Impact assessments",
          body: (
            <>
              <p>
                My Genome, Copilot and export have a drafted impact assessment
                that is not yet approved. Its summary will appear here once a
                reviewer approves it.
              </p>
              <p>
                Family and Embryo Analysis need their own impact assessment
                before any EU or UK launch. Public summaries must describe the
                data flow, risks, safeguards, remaining risk, reviewer, and
                review date. No such summary is published today, so those
                features remain unavailable in both territories.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
