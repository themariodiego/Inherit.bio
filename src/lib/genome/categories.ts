import { EVIDENCE_PUBLIC_LABELS } from "./taxonomy";

// Legacy fifteen-slug category vocabulary. These slugs remain the storage key
// in report_templates.category and are still read by the report page, the
// sensitive-content gate and the Copilot list_reports tool. The nine-category
// taxonomy in ./taxonomy.ts (CATEGORY_TAXONOMY, categoryFor) is the canonical
// user-facing grouping.
export const CATEGORY_LABELS: Record<string, string> = {
  "heart-cardiovascular": "Heart & cardiovascular",
  "cancer-risk": "Cancer risk",
  "brain-health": "Brain health",
  neurodegenerative: "Neurodegenerative",
  autoimmune: "Autoimmune",
  "mental-health": "Mental health",
  longevity: "Longevity",
  "metabolic-obesity": "Metabolic & obesity",
  gastrointestinal: "Gastrointestinal",
  "environmental-sensitivity": "Environmental sensitivity",
  addiction: "Addiction",
  "reproductive-family": "Reproductive & family planning",
  "aesthetic-cosmetic": "Aesthetics & cosmetic",
  "basic-traits": "Basic traits",
  "lifestyle-wellness": "Lifestyle & wellness",
};

// Five-level evidence rubric labels. The canonical map is
// EVIDENCE_PUBLIC_LABELS in ./taxonomy.ts; this string-keyed view keeps the
// existing `EVIDENCE_LABELS[template.evidence]` lookups working.
export const EVIDENCE_LABELS: Record<string, string> = {
  ...EVIDENCE_PUBLIC_LABELS,
};

export {
  CATEGORY_TAXONOMY,
  EVIDENCE_LEVELS,
  EVIDENCE_PUBLIC_LABELS,
  categoryFor,
} from "./taxonomy";
