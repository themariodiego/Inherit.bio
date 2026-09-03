import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "GINA, explained",
  description:
    "What the US Genetic Information Nondiscrimination Act actually protects — health insurance and employment — and the gaps it leaves: life, disability, and long-term-care insurance.",
};

export default function GinaPage() {
  return (
    <LegalPage
      eyebrow="Company"
      title={
        <>
          GINA, <span className="accent">explained.</span>
        </>
      }
      effectiveDate="2026-09-01"
      intro={
        <>
          <p>
            The Genetic Information Nondiscrimination Act of 2008 (GINA) is
            the main United States federal law protecting people from genetic
            discrimination. It is real protection — and it is narrower than
            most people assume. Before you sequence, you should know both
            halves.
          </p>
          <p>
            This page is general legal information, not legal advice, and it
            describes US federal law. It is not a reason to avoid or pursue
            testing; it is context for deciding with open eyes.
          </p>
        </>
      }
      sections={[
        {
          id: "what-gina-protects",
          heading: "What GINA protects",
          body: (
            <>
              <p>GINA has two main titles, covering two domains:</p>
              <ul>
                <li>
                  <strong>Health insurance (Title I).</strong> Health plans and
                  insurers may not use genetic information to decide
                  eligibility or set premiums. This includes test results and
                  family history. They also may not ask for a genetic test for
                  underwriting or before enrollment.
                </li>
                <li>
                  <strong>Employment (Title II).</strong> An employer with 15
                  or more employees may not use genetic information to make
                  job decisions. This includes hiring, firing, pay, and
                  promotion. It may not ask for or buy this information except
                  in narrow cases. Examples include accidental receipt and
                  voluntary health programs that meet strict rules.
                </li>
              </ul>
              <p>
                GINA defines genetic information broadly. It includes your
                genetic tests, family members’ tests, and family medical
                history. GINA focuses on risk before symptoms appear. If a
                condition develops, other laws may apply. These include the
                Affordable Care Act for health coverage and the Americans with
                Disabilities Act at work.
              </p>
            </>
          ),
        },
        {
          id: "the-gaps",
          heading: "The gaps: what GINA does not cover",
          body: (
            <>
              <p>
                GINA’s protections stop at health insurance and employment.
                Three major categories of insurance are{" "}
                <strong>not covered by GINA at all</strong>:
              </p>
              <ul>
                <li>
                  <strong>Life insurance.</strong> A life insurer may
                  generally ask whether you have taken a genetic test, ask for
                  the results, and use them to decline coverage or set
                  premiums.
                </li>
                <li>
                  <strong>Disability insurance.</strong> Same gap: genetic
                  results may be used to review an individual policy unless
                  state law adds protection.
                </li>
                <li>
                  <strong>Long-term-care insurance.</strong> Same gap again —
                  and long-term-care underwriting is where results like APOE
                  status are most plausibly material to an insurer.
                </li>
              </ul>
              <p>
                Title II generally covers employers with at least 15 workers.
                GINA does not cover life, disability, or long-term-care
                insurance. Other laws may protect people or settings outside
                GINA. GINA focuses on a genetic <em>predisposition</em>, not a
                condition that has already developed.
              </p>
            </>
          ),
        },
        {
          id: "state-law",
          heading: "State law varies",
          body: (
            <p>
              Some states add protection. Florida protects health, life, and
              long-term-care insurance in defined cases. California protects
              genetic information in housing, public accommodations, and
              state-funded programs. Other states may cover certain policy
              types or require consent. The rules depend on your state and
              the type of insurance. Inherit asks only for country and state
              so it can show relevant rules without collecting your address.
            </p>
          ),
        },
        {
          id: "practical-guidance",
          heading: "Practical points to weigh",
          body: (
            <>
              <p>
                Stated informationally — these are considerations, not
                recommendations:
              </p>
              <ul>
                <li>
                  An insurance form may ask about testing, health, or family
                  history. Read each question closely and answer truthfully.
                  False answers may affect coverage or a later claim. If this
                  worries you, seek legal or insurance advice before testing.
                </li>
                <li>
                  An Inherit report is for information, not diagnosis. An
                  insurance question may still cover consumer testing. Read
                  the exact question on the form.
                </li>
                <li>
                  Inherit creates only the reports you choose to open. You can
                  delete stored files and reports under our{" "}
                  <Link href="/privacy">privacy policy</Link>. Deletion cannot
                  undo a copy that you already shared or that another party
                  already holds.
                </li>
                <li>
                  A genetic counselor can explain test choices, limits, and
                  possible insurance effects. A doctor can help confirm a
                  finding and plan care. Seek clinical advice for any result
                  that could affect your health.
                </li>
              </ul>
              <p>
                For questions about your own circumstances, consult a licensed
                attorney or a genetic counselor in your jurisdiction.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
