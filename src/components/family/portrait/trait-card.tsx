/**
 * <TraitCard> — one of the five X10.1 traits (design §2.5; brief line 2480,
 * G5.9(c)). Server component.
 *
 * Every entry of the allowlist is `unregistered` today, because no
 * genotype-to-phenotype table and no accuracy figure can be cited, so every
 * card states so in the mandated sentence and renders no figure, no claim
 * block and no chance. A registered entry would render its table's own
 * output; nothing here invents one (C5).
 */
import { TRAIT_HEADINGS, TRAIT_NAMES, unregisteredCard } from "@/copy/family/portrait";
import type { TraitEntry } from "@/lib/family/traits";

export function TraitCard({ entry }: { entry: TraitEntry }) {
  return (
    <article
      data-slot="trait-card"
      data-trait={entry.key}
      data-trait-status={entry.status}
      aria-label={TRAIT_HEADINGS[entry.key]}
      className="space-y-2 rounded-2xl border border-line bg-card p-4"
    >
      <p className="font-medium text-ink">{TRAIT_HEADINGS[entry.key]}</p>
      <p data-slot="trait-status" className="text-sm leading-relaxed text-ink">
        {unregisteredCard(TRAIT_NAMES[entry.key])}
      </p>
    </article>
  );
}
