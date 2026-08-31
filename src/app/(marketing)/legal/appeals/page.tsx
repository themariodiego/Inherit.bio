import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Appeals" };

export default function AppealsPolicyPage() {
  return <LegalPage eyebrow="Rights" title="Appeals and corrections" effectiveDate="2026-09-01" sections={[
    { id: "scope", heading: "What can be appealed", body: <p>A person may challenge an identity, authority, access, correction, or future-person claim decision. Genetic values are never placed in a public appeal response.</p> },
    { id: "review", heading: "Human review", body: <p>Appeals requiring identity or legal judgment remain pending until a named human reviewer records a coded decision. Automated systems cannot approve them.</p> },
  ]} />;
}
