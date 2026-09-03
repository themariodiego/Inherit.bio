import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Self-hosting policy" };

export default function SelfHostingPolicyPage() {
  return <LegalPage eyebrow="Policy" title="Self-hosting" effectiveDate="2026-09-01" sections={[
    { id: "responsibility", heading: "Operator responsibility", body: <p>If you self-host Inherit, you become the operator of that deployment. As its operator, you are responsible for its security, backups, and retention. You are also responsible for its legal basis, notices, and provider contracts. The same goes for incident response in that deployment.</p> },
    { id: "code", heading: "Open source is not approval", body: <p>Availability of the source code does not enable restricted Family or Embryo capabilities. Nor is it a legal or medical endorsement. The operational guide is maintained in the <Link href="https://github.com/themariodiego/Inherit.bio/blob/main/docs/self-hosting.md">source repository</Link>.</p> },
  ]} />;
}
