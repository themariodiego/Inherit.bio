/**
 * <HowSureBlock> — the mandatory, non-collapsible "How sure we are" block of
 * every Portrait output card (brief §2 §5.6 line 360): the inheritance
 * pattern used, the assumptions it rests on, whether both files covered the
 * positions, and what would change the answer. Server component.
 *
 * It is a labelled section with a description list, never a heading (the
 * surface's six-heading cap) and never a `details`. The heading word comes
 * from the one home of the six report headings.
 */
import { HOW_SURE_HEADING, HOW_SURE_LABELS } from "@/copy/family/portrait";

export interface HowSureBlockProps {
  pattern: string;
  /** One sentence per assumption, in the order the arithmetic names them. */
  assumptions: readonly string[];
  /** What was measured rather than assumed (the runs check on an exact block); absent when nothing was. */
  checked?: readonly string[];
  coverage: string;
  change: string;
}

export function HowSureBlock({ pattern, assumptions, checked = [], coverage, change }: HowSureBlockProps) {
  return (
    <section
      data-slot="how-sure"
      aria-label={HOW_SURE_HEADING}
      className="space-y-2 border-t border-line pt-3 text-sm leading-relaxed text-ink"
    >
      <p className="font-medium">{HOW_SURE_HEADING}</p>
      <dl className="space-y-2">
        <div>
          <dt className="text-ink-muted">{HOW_SURE_LABELS.pattern}</dt>
          <dd data-slot="how-sure-pattern">{pattern}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">{HOW_SURE_LABELS.assumption}</dt>
          {assumptions.map((assumption) => (
            <dd key={assumption} data-slot="how-sure-assumption">
              {assumption}
            </dd>
          ))}
        </div>
        {checked.length > 0 ? (
          <div>
            <dt className="text-ink-muted">{HOW_SURE_LABELS.checked}</dt>
            {checked.map((statement) => (
              <dd key={statement} data-slot="how-sure-checked">
                {statement}
              </dd>
            ))}
          </div>
        ) : null}
        <div>
          <dt className="text-ink-muted">{HOW_SURE_LABELS.coverage}</dt>
          <dd data-slot="how-sure-coverage">{coverage}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">{HOW_SURE_LABELS.change}</dt>
          <dd data-slot="how-sure-change">{change}</dd>
        </div>
      </dl>
    </section>
  );
}
