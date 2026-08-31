import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Self-hosting policy" };

export default function SelfHostingPolicyPage() {
  return <LegalPage eyebrow="Policy" title="Self-hosting" effectiveDate="2026-09-01" sections={[
    { id: "responsibility", heading: "Operator responsibility", body: <p>A self-hosted operator becomes responsible for security, backups, retention, legal basis, notices, provider contracts, and incident response in that deployment.</p> },
    { id: "code", heading: "Open source is not approval", body: <p>Availability of source code does not enable restricted Family or Embryo capabilities and is not a legal or medical endorsement. The operational guide is maintained in the <Link href="https://github.com/themariodiego/Inherit.bio/blob/main/docs/self-hosting.md">source repository</Link>.</p> },
  ]} />;
}
