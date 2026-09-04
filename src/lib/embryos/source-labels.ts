import registry from "../../../data/embryo/source_labels.json";

/**
 * The bounded safe labels a QC row may carry for its source fields
 * (register `embryo-autosomal-only-v1.sourceProvenance`; canonical
 * artifacts: original laboratory labels are never rendered). The registry
 * is closed and, today, empty: it is withheld until reviewed organisation
 * and assay names are registered. A source string is either null or one of
 * these ids; the renderers print the id's display text, never the column.
 */
export interface SourceLabel {
  id: string;
  /** Which QC fields the label may fill. */
  fields: readonly SourceLabelField[];
  displayText: string;
}

export const SOURCE_LABEL_FIELDS = [
  "source_laboratory",
  "source_assay",
  "amplification_method",
  "allelic_dropout_method",
] as const;
export type SourceLabelField = (typeof SOURCE_LABEL_FIELDS)[number];

interface SourceLabelRegistry {
  schemaVersion: number;
  note: string;
  labels: SourceLabel[];
}

const REGISTRY = registry as SourceLabelRegistry;

export function sourceLabels(): readonly SourceLabel[] {
  return REGISTRY.labels;
}

/** True when the value is null or a registered id for that field. */
export function isRegisteredSourceLabel(field: SourceLabelField, value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  return REGISTRY.labels.some((label) => label.id === value && label.fields.includes(field));
}

/** The display text of a registered id, or null: a raw column never reaches a page. */
export function sourceLabelText(field: SourceLabelField, value: string | null): string | null {
  if (value === null) return null;
  return REGISTRY.labels.find((label) => label.id === value && label.fields.includes(field))?.displayText ?? null;
}
