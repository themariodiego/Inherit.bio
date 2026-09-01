import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Genome positions" };

export default function SciencePositionsPage() {
  return <LegalPage eyebrow="Science" title="Positions and genome builds" effectiveDate="2026-09-01" sections={[
    { id: "build", heading: "Canonical build", body: <p>Inherit stores normalized positions on GRCh38. Files declared as GRCh37 are lifted through a versioned chain and unmapped positions remain explicitly unmapped.</p> },
    { id: "strand", heading: "Strand handling", body: <p>Opposite-strand calls are accepted only when resolution is unambiguous. Palindromic alleles are not guessed.</p> },
    { id: "source", heading: "Source fidelity", body: <p>Every derived value remains bound to its subject and source file. Conflicting observed calls suppress interpretation.</p> },
  ]} />;
}
