import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Scientific limits" };

export default function ScienceLimitsPage() {
  return <LegalPage eyebrow="Science" title="Limits and uncertainty" effectiveDate="2026-09-01" intro={<p>Inherit is not a medical test and cannot tell you what will happen.</p>} sections={[
    { id: "coverage", heading: "Coverage is not absence", body: <p>A missing position means the source did not establish a genotype there. It is never interpreted as a reference call.</p> },
    { id: "association", heading: "Association is not destiny", body: <p>Published associations describe study populations. Environment, ancestry, measurement, and many unobserved factors can change what they mean for one person.</p> },
    { id: "confirmation", heading: "Clinical confirmation", body: <p>Any decision about health or reproduction requires an appropriate clinician and, where relevant, a clinical laboratory.</p> },
  ]} />;
}
