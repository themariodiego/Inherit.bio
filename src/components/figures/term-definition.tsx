/**
 * <TermDefinition> renders one of the three retained terms of art with its
 * definition inline and expanded — never a hover tooltip, never a `title`.
 * Place it at the term's first occurrence on a page; later occurrences use
 * the bare word.
 */
import type { RetainedTerm } from "@/lib/figures/contract";
import { definitionFor } from "@/copy/figures/reference-groups";
import { cn } from "@/lib/utils";

export interface TermDefinitionProps {
  term: RetainedTerm;
  /** The surface form when it differs from the term, e.g. "Baseline" or "haplogroups". */
  text?: string;
  className?: string;
}

export function TermDefinition({ term, text = term, className }: TermDefinitionProps) {
  return (
    <span data-slot="term-definition" data-term-definition={term} className={cn("inline", className)}>
      <dfn className="font-medium text-ink not-italic">{text}</dfn>
      <span className="text-ink-muted">
        {" — "}
        {definitionFor(term)}
      </span>
    </span>
  );
}
