import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Genome positions" };

export default function SciencePositionsPage() {
  return <LegalPage eyebrow="Science" title="Positions and genome builds" effectiveDate="2026-09-01" sections={[
    { id: "build", heading: "Canonical build", body: <p>Inherit stores each DNA position using GRCh38. It converts files marked as GRCh37 with a versioned map. If a position cannot be mapped, it stays marked as unmapped.</p> },
    { id: "strand", heading: "Strand handling", body: <p>Inherit accepts a result from the other DNA strand only when the match is clear. It does not guess when a DNA pair reads the same in both directions.</p> },
    { id: "source", heading: "Source fidelity", body: <p>Every derived value remains bound to its subject and source file. Conflicting observed calls suppress interpretation.</p> },
  ]} />;
}
