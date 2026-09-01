import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Where Inherit works" };

export default function AvailabilityPage() {
  return <LegalPage eyebrow="Policy" title="Where Inherit works" effectiveDate="2026-09-01" intro={<p>My Genome is available for an adult&apos;s own data. Family and Embryo Analysis are off until a real jurisdiction has a current human legal review.</p>} sections={[
    { id: "current", heading: "Current production state", body: <p>No real jurisdiction is marked permitted for Family or Embryo Analysis. Unknown or conflicting jurisdiction signals always deny those capabilities.</p> },
    { id: "change", heading: "How availability changes", body: <p>A capability can be enabled only by a versioned jurisdiction rule backed by a current citation and a human legal sign-off. Automated systems cannot create that sign-off.</p> },
  ]} />;
}
