/**
 * <PortraitBanner> — the mandatory persistent banner (brief §2 §5.6 line
 * 364), on every Portrait screen including the blocking screen. Server
 * component.
 *
 * Two sentences, character-for-character, in a tinted panel that cannot be
 * dismissed, collapsed or scrolled out of the document: it is a plain
 * section, never a `details`, and carries no control.
 */
import { BANNER_FIRST, BANNER_LABEL, BANNER_SECOND } from "@/copy/family/portrait";

export function PortraitBanner() {
  return (
    <section
      data-slot="portrait-banner"
      data-density-required-accuracy
      aria-label={BANNER_LABEL}
      className="max-w-prose space-y-2 rounded-2xl bg-tint p-6 text-ink"
    >
      <p data-slot="portrait-banner-first" className="text-base leading-relaxed">
        {BANNER_FIRST}
      </p>
      <p data-slot="portrait-banner-second" className="text-base leading-relaxed">
        {BANNER_SECOND}
      </p>
    </section>
  );
}
