import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Insurance and discrimination" };

export default function InsurancePage() {
  return <LegalPage eyebrow="Disclosure" title="Insurance and discrimination" effectiveDate="2026-09-01" intro={<section data-legal-summary><p>Genetic privacy laws do not cover every insurer, employer, or country. A result may affect how an application is answered. Learn the rules that apply before generating sensitive information.</p></section>} sections={[
    { id: "limits", heading: "Protection has gaps", body: <p>Rules vary by jurisdiction and product. US federal GINA protections do not generally cover life, disability, or long-term-care insurance. Read the <Link href="/legal/gina">GINA explainer</Link>.</p> },
    { id: "status", heading: "Not legal advice", body: <p>This disclosure is general information. It cannot determine how a specific application, policy, employer, school, or court will treat a result.</p> },
  ]} />;
}
