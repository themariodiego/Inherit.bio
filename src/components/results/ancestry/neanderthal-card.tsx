/**
 * <NeanderthalCard> — `#neanderthal` (brief §4.6, acceptance 32). Server
 * component. No marker list for this estimate has been built and
 * licence-checked, so the card states that and nothing else; the capability
 * is registered as withheld. The eyebrow is a paragraph because "ancestry"
 * is a term of art and may not head a section; the mandated Denisovan
 * sentence follows the body verbatim.
 */
import { DENISOVAN, NEANDERTHAL_BODY, NEANDERTHAL_EYEBROW, NEANDERTHAL_HEADING } from "@/copy/ancestry";

export const NEANDERTHAL_SECTION_ID = "neanderthal";

export function NeanderthalCard() {
  return (
    <section
      id={NEANDERTHAL_SECTION_ID}
      aria-labelledby="neanderthal-heading"
      className="surface surface-pad-sm space-y-3"
    >
      <p className="eyebrow">{NEANDERTHAL_EYEBROW}</p>
      <h2 id="neanderthal-heading" className="title text-ink">
        {NEANDERTHAL_HEADING}
      </h2>
      <p className="max-w-measure text-base leading-relaxed text-ink">{NEANDERTHAL_BODY}</p>
      <p className="caption max-w-measure">{DENISOVAN}</p>
    </section>
  );
}
