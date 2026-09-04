/**
 * <FindingsSection> — "Your result" on an embryo's page (design §2.3; brief
 * §2 §6.3). Server component. Per allowed category, a label that is not a
 * heading and one attributed claim block per finding; the four excluded
 * categories never render, and no condition outside the registry renders.
 * While the registry is empty the section renders exactly one sentence.
 */
import { CompareCell } from "@/components/embryo/compare/compare-cell";
import { NO_RESULTS_SENTENCE } from "@/copy/embryos/detail";
import {
  ALLOWED_CONDITION_CATEGORIES,
  allowedConditions,
  type AllowedConditionEntry,
} from "@/lib/embryos/allowed-conditions";
import type { EmbryoFinding } from "@/lib/embryos/policy";

export function FindingsSection({
  findings,
  subjectId,
  registry = allowedConditions(),
}: {
  findings: readonly EmbryoFinding[];
  subjectId: string;
  registry?: readonly AllowedConditionEntry[];
}) {
  const categoryOf = new Map(registry.map((entry) => [entry.condition_id, entry.category]));
  const shown = findings.filter((finding) => categoryOf.has(finding.condition_id));
  if (registry.length === 0 || shown.length === 0) {
    return (
      <p data-slot="no-results" className="max-w-prose text-base leading-relaxed text-ink">
        {NO_RESULTS_SENTENCE}
      </p>
    );
  }
  return (
    <div className="space-y-6">
      {ALLOWED_CONDITION_CATEGORIES.map((category) => {
        const group = shown.filter((finding) => categoryOf.get(finding.condition_id) === category);
        if (group.length === 0) return null;
        return (
          <div key={category} data-slot="finding-group" data-category={category} className="space-y-3">
            <p data-slot="category-label" className="font-medium text-ink">
              {category}
            </p>
            <ul className="space-y-3">
              {group.map((finding) => (
                <li key={finding.condition_id} data-condition-id={finding.condition_id} className="space-y-1">
                  <p className="text-sm text-ink-muted">{finding.condition_name}</p>
                  <CompareCell finding={finding} subjectId={subjectId} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
