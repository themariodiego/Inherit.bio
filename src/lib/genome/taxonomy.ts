// Canonical user-facing taxonomy for the report library (v2 brief §4.2), the
// five-level evidence rubric (§8) and the finding layer (§1).
//
// The nine categories below are the only user-facing grouping. The fifteen
// legacy `report_templates.category` slugs stay in the database and in
// ./categories.ts because gating, the Copilot list_reports tool and the
// research drafter are keyed on them. `categoryFor` is the total mapping from
// a template to its user-facing category: a named per-slug exception list
// first, then a per-legacy-category default.

import type { Database } from "../supabase/types";

export const CATEGORY_TAXONOMY = [
  { id: "everyday-traits", label: "Everyday traits" },
  { id: "food-drink-metabolism", label: "Food, drink and metabolism" },
  { id: "heart-circulation", label: "Heart and circulation" },
  { id: "immune-allergies", label: "Immune system and allergies" },
  { id: "medicines", label: "Medicines" },
  { id: "brain-memory-mood", label: "Brain, memory and mood" },
  { id: "cancer", label: "Cancer" },
  { id: "having-children", label: "Having children" },
  { id: "ageing-longevity", label: "Ageing and longevity" },
] as const satisfies readonly { id: string; label: string }[];

export type CategoryId = (typeof CATEGORY_TAXONOMY)[number]["id"];

export const LEGACY_CATEGORY_SLUGS = [
  "basic-traits",
  "aesthetic-cosmetic",
  "environmental-sensitivity",
  "lifestyle-wellness",
  "metabolic-obesity",
  "gastrointestinal",
  "heart-cardiovascular",
  "autoimmune",
  "brain-health",
  "mental-health",
  "neurodegenerative",
  "addiction",
  "cancer-risk",
  "reproductive-family",
  "longevity",
] as const;

export type LegacyCategorySlug = (typeof LEGACY_CATEGORY_SLUGS)[number];

/** Per-legacy-category default. Total over the fifteen legacy slugs. */
export const LEGACY_CATEGORY_DEFAULTS: Record<LegacyCategorySlug, CategoryId> = {
  "basic-traits": "everyday-traits",
  "aesthetic-cosmetic": "everyday-traits",
  "environmental-sensitivity": "everyday-traits",
  "lifestyle-wellness": "food-drink-metabolism",
  "metabolic-obesity": "food-drink-metabolism",
  gastrointestinal: "food-drink-metabolism",
  "heart-cardiovascular": "heart-circulation",
  autoimmune: "immune-allergies",
  "brain-health": "brain-memory-mood",
  "mental-health": "brain-memory-mood",
  neurodegenerative: "brain-memory-mood",
  addiction: "brain-memory-mood",
  "cancer-risk": "cancer",
  "reproductive-family": "having-children",
  longevity: "ageing-longevity",
};

/** Named per-template exceptions to the legacy-category default. */
export const TEMPLATE_CATEGORY_EXCEPTIONS: Record<string, CategoryId> = {
  "muscle-composition-actn3-rs1815739": "everyday-traits",
  "endurance-trainability-ppargc1a-rs8192678": "everyday-traits",
  "sleep-duration-abcc9-rs11046205": "everyday-traits",
  "morning-chronotype-rgs16-rs516134": "everyday-traits",
  "allergic-sensitization-il13": "immune-allergies",
  "vitamin-d-sunlight-gc": "food-drink-metabolism",
};

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function isLegacyCategorySlug(value: string): value is LegacyCategorySlug {
  return hasOwn(LEGACY_CATEGORY_DEFAULTS, value);
}

/**
 * Total mapping from a template to its user-facing category: exception first,
 * then the legacy-category default. Throws on an unknown legacy slug so seed
 * validation and tests fail loudly instead of silently dropping a template.
 */
export function categoryFor(template: { slug: string; category: string }): CategoryId {
  if (hasOwn(TEMPLATE_CATEGORY_EXCEPTIONS, template.slug)) {
    return TEMPLATE_CATEGORY_EXCEPTIONS[template.slug];
  }
  if (isLegacyCategorySlug(template.category)) {
    return LEGACY_CATEGORY_DEFAULTS[template.category];
  }
  throw new Error(
    `Unknown legacy category "${template.category}" on template "${template.slug}"`,
  );
}

export function categoryLabel(id: CategoryId): string {
  return CATEGORY_TAXONOMY.find((category) => category.id === id)!.label;
}

// ---------------------------------------------------------------------------
// Evidence rubric (§8.1). The database enum is the source of truth; the list
// below must satisfy it and the label map must cover it, so the two cannot
// drift without a type error.
// ---------------------------------------------------------------------------

export type EvidenceLevel = Database["public"]["Enums"]["evidence_level"];

export const EVIDENCE_LEVELS = [
  "clinical",
  "established",
  "emerging",
  "preliminary",
  "insufficient",
] as const satisfies readonly EvidenceLevel[];

export const EVIDENCE_PUBLIC_LABELS: Record<EvidenceLevel, string> = {
  clinical: "Clinical-grade",
  established: "Established",
  emerging: "Emerging",
  preliminary: "Preliminary",
  insufficient: "Not shipped",
};

export function isEvidenceLevel(value: string): value is EvidenceLevel {
  return (EVIDENCE_LEVELS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Finding layer (§1.1).
// ---------------------------------------------------------------------------

export type FindingLayer = Database["public"]["Enums"]["finding_layer"];

export const LAYERS = ["variant_call", "estimate"] as const satisfies readonly FindingLayer[];

export const ESTIMATE_KINDS = ["single_locus", "polygenic_score"] as const;

export type EstimateKind = (typeof ESTIMATE_KINDS)[number];

// ---------------------------------------------------------------------------
// Gating (§4.2). Gating is per template, not per merged category: the gated
// set is the legacy sensitive categories plus the clinical-confirmation
// content rule, preserved template-for-template across the taxonomy change.
// ---------------------------------------------------------------------------

export const GATED_LEGACY_CATEGORIES: ReadonlySet<string> = new Set([
  "cancer-risk",
  "neurodegenerative",
  "mental-health",
]);

export const CLINICAL_CONFIRMATION_RE =
  /confirm\w*\s+(?:by|with)\s+(?:a\s+)?clinical|clinical(?:[-\s](?:laboratory|quality))?\s+confirmation|confirmation\s+is\s+sensible|deserves\s+confirmation/i;

export function isGatedTemplate(template: {
  category: string;
  variants: readonly { interpretations: Record<string, string> }[];
}): boolean {
  const recommendsClinicalConfirmation = template.variants.some((variant) =>
    Object.values(variant.interpretations).some((text) =>
      CLINICAL_CONFIRMATION_RE.test(text),
    ),
  );
  return GATED_LEGACY_CATEGORIES.has(template.category) || recommendsClinicalConfirmation;
}
