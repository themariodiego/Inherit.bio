import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "State genetic privacy" };

export default function StatePrivacyPage() {
  return <LegalPage eyebrow="Policy" title="State genetic privacy" effectiveDate="2026-09-01" intro={<p>Genetic privacy rules vary by state and change over time. Inherit applies the most restrictive current rule across conflicting signals and keeps restricted features off when location is unknown.</p>} sections={[
    { id: "source", heading: "Rule source", body: <p>Availability is read from the versioned jurisdiction registry. Every production permission requires a current source citation and human review.</p> },
    { id: "correction", heading: "Correcting location", body: <p>You can correct a declared jurisdiction in Settings. Newly available restricted features remain subject to renewed policy acknowledgement and a cooling-off period.</p> },
  ]} />;
}
