import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "GDPR" };

export default function GdprPage() {
  return <LegalPage eyebrow="Privacy" title="GDPR status" effectiveDate="2026-09-01" intro={<p>Genetic data is special-category data. Inherit relies on consent under Article 6(1)(a) and explicit consent under Article 9(2)(a) for each enabled analytic purpose.</p>} sections={[
    { id: "availability", heading: "Territorial availability", body: <p>The hosted service is not offered as an enabled Family or Embryo Analysis service in the EU or UK. No Article 27 representative or named DPO has been published, so those capabilities remain off there.</p> },
    { id: "rights", heading: "Your rights", body: <p>You may request access, correction, restriction, portability, objection where applicable, and deletion. Use the in-product export and deletion controls or contact privacy@inherit.bio.</p> },
    { id: "transfers", heading: "Processors and transfers", body: <p>The hosted application uses Supabase for database and storage and Vercel for application hosting. A user-selected cloud model receives genome-derived context only after a named, revocable consent.</p> },
  ]} />;
}
