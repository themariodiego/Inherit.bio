import type { EmbryoInputFacts } from "@/lib/embryos/input-facts";
import { INPUT_PROVENANCE_COPY as COPY } from "@/copy/reports/input-provenance";

export function EmbryoInputProvenance({ facts }: { facts: EmbryoInputFacts }) {
  return <div data-slot="embryo-input-provenance" className="space-y-2 text-sm leading-relaxed">
    <p>{COPY.external}</p>
    <p>{COPY.noImputation}</p>
    <p>{facts.coordinate_conversion === "converted" ? COPY.converted : facts.coordinate_conversion === "not-needed" ? COPY.sameBuild :
      facts.coordinate_conversion === "mixed" ? COPY.mixedBuild : COPY.unknownEmbryoBuild}</p>
    <p>{COPY.unknownMeasurement}</p>
  </div>;
}
