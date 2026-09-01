import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Consent architecture" };

export default function LegalConsentsPage() {
  return <LegalPage eyebrow="Consent" title="One purpose at a time" effectiveDate="2026-09-01" intro={<p>A consent names one purpose, one subject or cohort, one versioned legal text, and the person who had authority to sign it.</p>} sections={[
    { id: "granular", heading: "Granular grants", body: <p>Reports, ancestry, local Copilot, cloud Copilot, Family, Embryo Analysis, and exports are separate purposes. No control turns them all on.</p> },
    { id: "revocation", heading: "Revocation", body: <p>Revoking a grant stops new use for that purpose. Where the source authority is withdrawn, derived access freezes and the applicable deletion schedule starts.</p> },
    { id: "versions", heading: "Versioned evidence", body: <p>Every signature binds the exact artifact version and body hash. Superseded text remains retrievable.</p> },
  ]} />;
}
