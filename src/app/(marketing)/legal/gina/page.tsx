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
      effectiveDate="2026-08-28"
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
                  <strong>Health insurance (Title I).</strong> Health insurers
                  and group health plans may not use your genetic information
                  — including test results and family history — to determine
                  eligibility, set premiums, or treat a genetic predisposition
                  as a preexisting condition. They also may not request or
                  require genetic testing for underwriting.
                </li>
                <li>
                  <strong>Employment (Title II).</strong> Employers with 15 or
                  more employees may not use genetic information in hiring,
                  firing, pay, promotion, or any other employment decision,
                  and may not request, require, or purchase genetic
                  information about employees or their family members, with
                  narrow exceptions (such as inadvertent acquisition or
                  voluntary wellness programs with strict consent rules).
                </li>
              </ul>
              <p>
                “Genetic information” under GINA is broad: your test results,
                your family members’ test results, and family medical history
                all count. The Affordable Care Act’s ban on preexisting-
                condition discrimination reinforces the health-insurance side:
                once a genetic condition has actually manifested as disease,
                ACA protections apply where GINA’s stop.
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
                  results can lawfully be considered in underwriting
                  individual disability policies in most states.
                </li>
                <li>
                  <strong>Long-term-care insurance.</strong> Same gap again —
                  and long-term-care underwriting is where results like APOE
                  status are most plausibly material to an insurer.
                </li>
              </ul>
              <p>
                Other limits worth knowing: Title II does not apply to
                employers with fewer than 15 employees; members of the US
                military and, in certain respects, federal programs like the
                Indian Health Service sit under different frameworks; and
                GINA restricts use of a genetic <em>predisposition</em>, not
                of a condition that has already manifested.
              </p>
            </>
          ),
        },
        {
          id: "state-law",
          heading: "State law varies",
          body: (
            <p>
              Some states go further than GINA. Florida, for example,
              prohibits life, disability, and long-term-care insurers from
              using genetic test results in underwriting; California’s
              GINA-style statute (CalGINA) extends nondiscrimination beyond
              insurance and employment into housing, education, and public
              accommodations; and a number of other states restrict specific
              lines of insurance or add consent requirements. Many states,
              however, add little or nothing beyond the federal floor. Your
              actual protection depends on where you live, which is one
              reason Inherit’s optional location field is a country/state
              dropdown — it lets us surface relevant law without collecting
              your address.
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
                  Insurance applications commonly ask whether you have had
                  genetic testing. Answering dishonestly can void a policy, so
                  the time to think about life, disability, or long-term-care
                  coverage is <em>before</em> testing, while there are no
                  results to disclose.
                </li>
                <li>
                  A consumer report from Inherit is informational rather than
                  clinical, but underwriting questions are often phrased
                  broadly enough to include consumer testing. Read the actual
                  question on any application.
                </li>
                <li>
                  Results you never generate cannot be demanded: Inherit
                  computes only the reports you open, and deleting your data
                  here is immediate and real (see the{" "}
                  <Link href="/privacy">privacy policy</Link>). Deletion does
                  not, of course, undo disclosures you have already made
                  elsewhere.
                </li>
                <li>
                  Clinical genetic testing ordered through a physician or
                  genetic counselor comes with formal pre- and post-test
                  counseling, where these tradeoffs are discussed for your
                  specific situation. For medically significant findings,
                  that route is the appropriate one.
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
