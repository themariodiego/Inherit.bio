import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Incident response" };

export default function IncidentResponsePage() {
  return <LegalPage eyebrow="Security" title="Incident response" effectiveDate="2026-09-01" intro={<p>Report a security issue to security@inherit.bio. Do not include genome data or other sensitive personal information in the first message.</p>} sections={[
    { id: "process", heading: "Response process", body: <p>Inherit starts assessment promptly, contains affected systems, preserves necessary evidence, and notifies authorities and affected people when applicable law requires it.</p> },
    { id: "history", heading: "Incident history", body: <><p><time dateTime="2026-09-01">September 1, 2026</time></p><p>No incidents to report.</p></> },
  ]} />;
}
