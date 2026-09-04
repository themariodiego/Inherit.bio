/**
 * <OutcomeDots> — the distribution renderer (design §2.5; brief §2 §5.6 line
 * 360, §3 §4 line 794, line 801). Server component.
 *
 * One `<figure>`: 100 outcome dots in ten rows of ten, one `<span>` each,
 * standing for 100 possible children; a stacked bar beneath; a legend that
 * names every treatment in words; then, per category, the figure node the
 * claim block rendered for it and the mandated sentence. The three
 * treatments differ by fill AND border (solid ink, half ink with a dashed
 * border, empty with a dotted border), so colour never carries the meaning
 * alone and the grid reads in greyscale; the dots and the bar are decorative
 * (`aria-hidden`), and the words beside them are the accessible content.
 * The sub-1-in-100 category, when one ever exists, is the single outlined
 * dot the distribution gives it.
 *
 * No `img`, `canvas` or `svg` anywhere (G5.9(a)); nothing here is a picture
 * of a child. Every number renders through the figure nodes the parent
 * claim block passed in, so this component prints no quantity of its own;
 * the table fallback behind "See these numbers as a table" repeats the same
 * counts as text for a reader who cannot use the grid.
 */
import type { ReactNode } from "react";
import {
  BAR_LABEL,
  DOTS_CAPTION,
  DOTS_LABEL,
  DOTS_LEGEND_LABEL,
  DOTS_TABLE_LABELS,
  SEE_AS_TABLE_BUTTON,
} from "@/copy/family/portrait";
import type { Distribution } from "@/lib/family/distribution";
import { cn } from "@/lib/utils";

/** The three treatments, by category position; a fourth category would need a fourth. */
const TREATMENTS = [
  { dot: "bg-ink border-solid border-ink", bar: "bg-ink border-solid", swatch: "solid" },
  { dot: "bg-ink/40 border-dashed border-ink", bar: "bg-ink/40 border-dashed", swatch: "half" },
  { dot: "bg-transparent border-dotted border-ink", bar: "bg-transparent border-dotted", swatch: "empty" },
] as const;

/** One outlined dot: the sub-1-in-100 rule (line 360). */
const OUTLINED = { dot: "bg-transparent border-solid border-ink ring-1 ring-ink", swatch: "outlined" } as const;

export interface OutcomeDotsProps<K extends string> {
  distribution: Distribution<K>;
  /** The legend word for each category key. */
  legend: Record<K, string>;
  /** One rendered <Figure> node per category, in category order, from the parent claim block. */
  figureNodes: readonly ReactNode[];
  /** Distinguishes several figures on one page. */
  id: string;
}

export function OutcomeDots<K extends string>({
  distribution,
  legend,
  figureNodes,
  id,
}: OutcomeDotsProps<K>) {
  if (distribution.categories.length > TREATMENTS.length) {
    throw new Error(
      `OutcomeDots renders at most ${TREATMENTS.length} categories; got ${distribution.categories.length}`,
    );
  }
  const captionId = `${id}-caption`;
  const treatmentOf = (index: number) =>
    distribution.categories[index].outlined ? OUTLINED : TREATMENTS[index];
  // The bar segment widths, as CSS, built outside the markup: a width is
  // layout, not a rendered quantity; the quantity is the figure node beside it.
  const segments = distribution.categories.map((category, index) => ({
    key: category.key,
    width: `${category.dots}%`,
    treatment: category.outlined ? OUTLINED.dot : TREATMENTS[index].bar,
  }));
  const dots = distribution.categories.flatMap((category, index) =>
    Array.from({ length: category.dots }, (_, position) => ({
      key: `${category.key}-${position}`,
      category: category.key,
      treatment: treatmentOf(index),
    })),
  );

  return (
    <figure data-slot="outcome-dots" aria-labelledby={captionId} className="space-y-4">
      <div
        aria-hidden="true"
        data-slot="outcome-dot-grid"
        title={DOTS_LABEL}
        className="grid w-fit grid-cols-10 gap-1.5"
      >
        {dots.map((dot) => (
          <span
            key={dot.key}
            data-slot="outcome-dot"
            data-outcome={dot.category}
            data-treatment={dot.treatment.swatch}
            className={cn("block size-4 rounded-full border-2", dot.treatment.dot)}
          />
        ))}
      </div>
      <div
        aria-hidden="true"
        data-slot="outcome-bar"
        title={BAR_LABEL}
        className="flex h-4 w-full max-w-md overflow-hidden rounded-full border-2 border-ink"
      >
        {segments.map((segment) => (
          <span
            key={segment.key}
            data-slot="outcome-bar-segment"
            data-outcome={segment.key}
            style={{ width: segment.width }}
            className={cn("block h-full border-r-2 border-ink last:border-r-0", segment.treatment)}
          />
        ))}
      </div>
      <ul data-slot="outcome-legend" aria-label={DOTS_LEGEND_LABEL} className="space-y-2">
        {distribution.categories.map((category, index) => (
          <li
            key={category.key}
            data-slot="outcome-legend-item"
            data-outcome={category.key}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-ink"
          >
            <span
              aria-hidden="true"
              data-treatment={treatmentOf(index).swatch}
              className={cn("inline-block size-4 shrink-0 rounded-full border-2 align-middle", treatmentOf(index).dot)}
            />
            <span data-slot="outcome-word" className="font-medium">
              {legend[category.key]}
            </span>
            {figureNodes[index]}
            <span data-slot="outcome-sentence" data-finding="true" className="basis-full text-ink">
              {category.sentence}
            </span>
          </li>
        ))}
      </ul>
      <figcaption id={captionId} className="text-sm leading-relaxed text-ink-muted">
        {DOTS_CAPTION}
      </figcaption>
      <details data-slot="outcome-table">
        <summary className="cursor-pointer text-sm text-ink-muted underline decoration-dotted underline-offset-2">
          {SEE_AS_TABLE_BUTTON}
        </summary>
        <table className="mt-3 w-full max-w-md border-collapse text-left text-sm">
          <thead>
            <tr>
              <th scope="col" className="border-b border-line py-1 pr-4 font-medium">
                {DOTS_TABLE_LABELS.outcome}
              </th>
              <th scope="col" className="border-b border-line py-1 font-medium">
                {DOTS_TABLE_LABELS.count}
              </th>
            </tr>
          </thead>
          <tbody>
            {distribution.categories.map((category) => (
              <tr key={category.key} data-outcome={category.key}>
                <th scope="row" className="py-1 pr-4 font-normal">
                  {legend[category.key]}
                </th>
                <td data-slot="outcome-table-count" className="py-1 tabular-nums">
                  {category.dots}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
